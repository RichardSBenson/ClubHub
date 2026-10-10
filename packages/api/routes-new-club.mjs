/**
 * Routes: adding a club to the federation.
 */
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { clubs, registerImport, Forbidden, Invalid } from './data.mjs';
import * as auth from './auth.mjs';
import * as V from './views.mjs';
import { readNewClub } from '../core/domain/new-club.mjs';

export function registerNewClubRoutes({ get, post, organisationFor }) {
  // ---- adding a club ---------------------------------------------------------

  async function clubsScreen(ctx, org, extra = {}) {
    return ctx.send(extra.status ?? 200, V.clubsScreen({
      me: ctx.me, org, csrf: ctx.csrf,
      clubs: await clubs.beneath(ctx.me.accountId, org.id),
      done: ctx.url.searchParams.get('done'),
      ...extra,
    }));
  }

  get('/o/:slug/clubs', async (ctx) => {
    const org = await organisationFor(ctx);
    if (org.type === 'club') return ctx.redirect(`/o/${org.slug}/club-page`);
    return clubsScreen(ctx, org);
  });

  // Loading the club register's CSV files: clubs, class times and instructors. Preview first; nothing is saved until confirmed.
  async function registerImportScreen(ctx, org, extra = {}) {
    return ctx.send(extra.status ?? 200, V.registerImportScreen({ me: ctx.me, org, csrf: ctx.csrf, ...extra }));
  }

  // The three files that ship with this version (import/*.csv), for filling the boxes without pasting.
  const BUNDLED_REGISTER = ['clubs', 'sessions', 'instructors'];
  function bundledRegisterFiles() {
    const files = {};
    for (const name of BUNDLED_REGISTER) {
      try { files[name] = readFileSync(new URL(`../../import/${name}.csv`, import.meta.url), 'utf8'); } catch { files[name] = ''; }
    }
    return files;
  }

  get('/o/:slug/register-import', async (ctx) => {
    const org = await organisationFor(ctx);
    if (org.type === 'club') throw new Forbidden('Only a federation or region can import clubs.');
    const bundled = ctx.url.searchParams.get('use') === 'bundled';
    return registerImportScreen(ctx, org, bundled ? { files: bundledRegisterFiles(), bundled: true } : {});
  });

  post('/o/:slug/register-import', async (ctx) => {
    const org = await organisationFor(ctx);
    if (org.type === 'club') throw new Forbidden('Only a federation or region can import clubs.');
    const form = await ctx.form();
    const files = { clubs: form.clubs ?? form.clubs ?? '', sessions: form.sessions ?? '', instructors: form.instructors ?? '' };
    try {
      const confirm = form.confirm === 'yes';
      const report = await registerImport.run(ctx.me.accountId, org.id, files, { confirm });
      return registerImportScreen(ctx, org, { files, report, saved: confirm });
    } catch (e) {
      if (e instanceof Invalid) return registerImportScreen(ctx, org, { status: 422, files, error: e.message });
      throw e;
    }
  });

  post('/o/:slug/clubs/new', async (ctx) => {
    const org = await organisationFor(ctx);
    if (org.type === 'club') throw new Forbidden('A club cannot have clubs beneath it.');
    const form = await ctx.form();
    const values = readNewClub(form);
    try {
      const { club, admin } = await clubs.create(ctx.me.accountId, org.id, values);
      // Issued the ordinary way, and shown once: the same fifteen minutes and
      // single use as any sign-in link, for an administrator who may not have
      // working email yet.
      let link = null, linkExpires = null;
      if (admin) {
        const issued = await auth.requestLink(values.adminEmail, { ip: ctx.ip });
        const origin = `${ctx.secure ? 'https' : 'http'}://${ctx.req.headers.host}`;
        link = issued.token ? `${origin}/signin/${issued.token}` : null;
        linkExpires = issued.expiresInMinutes;
      }
      return clubsScreen(ctx, org, { added: club, adminName:
        admin ? `${values.adminFirst} ${values.adminLast}` : null, link, linkExpires });
    } catch (e) {
      if (e instanceof Invalid)
        return clubsScreen(ctx, org, { status: 422, error: e.message, values: form,
          added: e.club ?? null });
      throw e;
    }
  });
}
