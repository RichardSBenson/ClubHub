/**
 * Routes: the club's reports.
 */
import { reports, Forbidden } from './data.mjs';
import * as V from './views.mjs';
import { toCsv, fileName } from '../core/domain/csv.mjs';

export function registerReportRoutes({ get, organisationFor }) {
  // ---- reports -------------------------------------------------------------------

  get('/o/:slug/reports', async (ctx) => {
    const org = await organisationFor(ctx);
    const allowed = [];
    for (const [name, def] of Object.entries(reports.list)) {
      try { await reports.run(ctx.me.accountId, org.id, name); allowed.push({ name, ...def }); }
      catch (e) { if (!(e instanceof Forbidden)) throw e; }
    }
    if (!allowed.length) throw new Forbidden();
    return ctx.send(200, V.reportsScreen({ me: ctx.me, org, csrf: ctx.csrf, reports: allowed }));
  });

  get('/o/:slug/reports/:name', async (ctx) => {
    const org = await organisationFor(ctx);
    const sp = ctx.url.searchParams;
    const csv = sp.get('format') === 'csv';
    const r = await reports.run(ctx.me.accountId, org.id, ctx.params.name,
      { from: sp.get('from'), to: sp.get('to'), download: csv });
    if (csv) return ctx.download(fileName(org.slug, r.name, r.range?.to ?? r.today), 'text/csv', toCsv(r.columns, r.rows));
    return ctx.send(200, V.reportScreen({ me: ctx.me, org, csrf: ctx.csrf, report: r }));
  });
}
