/**
 * Routes: giving somebody a way in — sign-in links and roles.
 */
import { people, NotFound } from './data.mjs';
import * as auth from './auth.mjs';
import * as V from './views.mjs';

export function registerInviteRoutes({ post }) {
  // ---- giving somebody a way in ---------------------------------------------

  /**
   * Create an account for somebody on the roll and hand back a sign-in link.
   *
   * Shown on screen rather than emailed. Sign-in is normally a link in an
   * email, which is right, and which means nobody can get in until that
   * federation's mail is configured — a wall in front of the very first thing a
   * new install has to do, which is add a second administrator.
   *
   * It stays useful afterwards. A member with no address, one that bounces, or
   * somebody standing in the hall right now: a registrar has to be able to get
   * them in. This is what "resend the invitation" is in every other system.
   */
  post('/p/:id/access', async (ctx) => {
    ctx.requireActor();
    const { person, at } = await people.record(ctx.me.accountId, ctx.params.id);
    if (!at) throw new NotFound('Person has no current affiliation');
    const form = await ctx.form();

    try {
      const { account } = await people.grantAccess(ctx.me.accountId, person.id, {
        role: form.role || 'member',
        email: form.email?.trim() || null,
      });

      // Issued through the ordinary path: the same fifteen minutes, the same
      // single use, the same row in login_link. A link made here is not a
      // different kind of link, and nothing about it is weaker.
      const { token, expiresInMinutes } = await auth.requestLink(account.email,
        { ip: ctx.ip });

      const origin = `${ctx.secure ? 'https' : 'http'}://${ctx.req.headers.host}`;
      return ctx.send(200, V.person({
        me: ctx.me, person, at,
        ...(await people.record(ctx.me.accountId, person.id)),
        eligibility: null, canEdit: true,
        access: await people.accessFor(ctx.me.accountId, person.id),
        // Held in memory for this one response and never written anywhere we
        // could show it again. If it is lost, another is one click away.
        link: token ? `${origin}/signin/${token}` : null,
        linkExpires: expiresInMinutes,
        csrf: ctx.csrf,
      }));
    } catch (e) {
      const record = await people.record(ctx.me.accountId, person.id);
      return ctx.send(e.status ?? 422, V.person({
        me: ctx.me, ...record, eligibility: null, canEdit: true,
        access: await people.accessFor(ctx.me.accountId, person.id),
        error: e.message, csrf: ctx.csrf,
      }));
    }
  });
}
