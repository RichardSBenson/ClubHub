/**
 * Routes: entering an open event without signing in.
 */
import { outsiders, NotFound, Invalid } from './data.mjs';
import * as auth from './auth.mjs';
import * as V from './views.mjs';
import { readOutsider } from '../core/domain/outsider.mjs';
import { signEntryToken, readEntryToken } from './entry-token.mjs';
import { looksLikeRobot } from '../core/domain/enquiry.mjs';
import { messengerFrom } from '../infrastructure/messaging/messengers.mjs';
import { originOf } from './route-helpers.mjs';

export function registerPublicEntryRoutes({ SESSION_COOKIE, get, post }) {
  // ---- entering an open event from outside ------------------------------------------
  //
  // "Have you entered before?" — an email or mobile. A known person is sent a
  // sign-in link that lands on their one-click screen; an unknown one is sent a
  // link to say who they are. Both get the same answer on screen, so the form
  // cannot be used to find out who is on the register.

  const ENTER_NOTE = 'If we know you, a link is on its way to the email address we have. '
    + 'If we do not, a link to get you started is. Either way, open it on this device. It works for 60 minutes.';

  async function openEventOr404(ctx) {
    const ev = await outsiders.eventFor(ctx.params.slug, ctx.params.eventSlug);
    if (!ev) throw new NotFound('Event');
    return ev;
  }

  const enterBase = (ev) => `/enter/${ev.host_slug}/${ev.slug}`;

  get('/enter/:slug/:eventSlug', async (ctx) => {
    const ev = await openEventOr404(ctx);
    if (ctx.me?.personId) return ctx.redirect(`${enterBase(ev)}/go`);
    return ctx.send(200, V.enterStart({ csrf: ctx.csrf, ev, action: enterBase(ev),
      sent: ctx.url.searchParams.get('sent') === '1', note: ENTER_NOTE }));
  });

  post('/enter/:slug/:eventSlug', async (ctx) => {
    const ev = await openEventOr404(ctx);
    const form = await ctx.form();
    if (looksLikeRobot(form)) return ctx.redirect(`${enterBase(ev)}?sent=1`);
    const contact = String(form.contact ?? '').trim().slice(0, 120);
    if (!contact) return ctx.send(422, V.enterStart({ csrf: ctx.csrf, ev, action: enterBase(ev),
      error: 'Please give your email address or mobile number.' }));

    const origin = process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : originOf(ctx);
    const messenger = messengerFrom();
    const say = (to, subject, lines) => messenger.send({ to, subject,
      text: ['Kia ora,', '', ...lines, '', 'If you did not ask for this, ignore it.'].join('\n'), kind: 'sign-in' });

    try {
      const known = await outsiders.addressesFor(contact);
      if (known.length) {
        for (const email of known) {
          const account = await outsiders.ensureAccount(email);
          if (!account) continue;
          const issue = await auth.requestLink(email, { ip: ctx.ip, redirectTo: `${enterBase(ev)}/go` });
          if (issue.token) await say(email, `Your entry to ${ev.title}`,
            [`Here is your link to enter ${ev.title}:`, '', `${origin}/signin/${issue.token}`,
             '', 'It works once and expires in 15 minutes.']);
        }
      } else if (contact.includes('@')) {
        const token = signEntryToken({ email: contact.toLowerCase(), eventId: ev.id });
        if (token) await say(contact, `Start your entry to ${ev.title}`,
          [`Here is your link to start your entry to ${ev.title}:`, '', `${origin}${enterBase(ev)}/new?t=${token}`,
           '', 'It expires in 60 minutes.']);
      }
      // A mobile number we do not know has nowhere to send a link, and says nothing different.
    } catch (e) {
      if (e.status !== 429 && e.name !== 'RateLimited') {
        if (e.name === 'MessengerError') {
          console.error('entry link not sent:', e.message);
          return ctx.send(503, V.enterStart({ csrf: ctx.csrf, ev, action: enterBase(ev),
            error: 'We could not send the link just now. Try again shortly.' }));
        }
        throw e;
      }
    }
    return ctx.redirect(`${enterBase(ev)}?sent=1`);
  });

  /** Signed in and known: straight to the one-click screen or the form. */
  get('/enter/:slug/:eventSlug/go', async (ctx) => {
    const ev = await openEventOr404(ctx);
    if (!ctx.me?.personId) return ctx.redirect(enterBase(ev));
    return ctx.redirect(`/me/events/${ev.id}/${ctx.me.personId}`);
  });

  /** A person we have not met. The link proves the address is theirs. */
  get('/enter/:slug/:eventSlug/new', async (ctx) => {
    const ev = await openEventOr404(ctx);
    const t = readEntryToken(ctx.url.searchParams.get('t'), { eventId: ev.id });
    if (!t) return ctx.send(403, V.enterStart({ csrf: ctx.csrf, ev, action: enterBase(ev),
      error: 'That link has expired or is not valid. Ask for another.' }));
    return ctx.send(200, V.enterNew({ csrf: ctx.csrf, ev, action: `${enterBase(ev)}/new`,
      token: ctx.url.searchParams.get('t'), values: { email: t.email } }));
  });

  post('/enter/:slug/:eventSlug/new', async (ctx) => {
    const ev = await openEventOr404(ctx);
    const form = await ctx.form();
    const t = readEntryToken(form.t, { eventId: ev.id });
    if (!t) return ctx.send(403, V.enterStart({ csrf: ctx.csrf, ev, action: enterBase(ev),
      error: 'That link has expired or is not valid. Ask for another.' }));
    const input = { ...readOutsider(form), email: t.email };
    try {
      const made = await outsiders.register(input);
      // They proved the address by opening the link; sign them in now.
      const issue = await auth.requestLink(made.email, { ip: ctx.ip });
      const { token } = await auth.redeemLink(issue.token, { userAgent: ctx.req.headers['user-agent'], ip: ctx.ip });
      ctx.cookie(`${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; `
        + `Max-Age=${auth.SESSION_TTL_DAYS * 86400}${ctx.secure ? '; Secure' : ''}`);
      return ctx.redirect(`/me/events/${ev.id}/${made.personId}`);
    } catch (e) {
      if (e instanceof Invalid)
        return ctx.send(422, V.enterNew({ csrf: ctx.csrf, ev, action: `${enterBase(ev)}/new`,
          token: form.t, values: input, error: e.message }));
      throw e;
    }
  });
}
