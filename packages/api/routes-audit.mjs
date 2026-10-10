/**
 * Routes: who changed what.
 */
import { audit } from './data.mjs';
import * as V from './views.mjs';
import { ACTIONS as AUDIT_ACTIONS } from '../content/audit.mjs';
import { organisationFor } from './access.mjs';

export function registerAuditRoutes({ get }) {
  // ---- the audit log ---------------------------------------------------------

  /**
   * What has happened here.
   *
   * MANAGE only, and scoped to the subtree by the query: this screen says who
   * did what to whom, which is the most sensitive reading in the system. A club
   * administrator sees their own club's history and not the federation's.
   */
  get('/o/:slug/history', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    const q = ctx.url.searchParams;

    const since = {
      week: () => new Date(Date.now() - 7 * 864e5).toISOString(),
      month: () => new Date(Date.now() - 30 * 864e5).toISOString(),
      year: () => new Date(Date.now() - 365 * 864e5).toISOString(),
    }[q.get('since')]?.() ?? null;

    const entries = await audit.forOrganisation(ctx.me.accountId, org.id, {
      action: q.get('action') || null,
      accountId: q.get('who') || null,
      since,
      before: q.get('before') || null,
      limit: 100,
    });

    return ctx.send(200, V.history({
      me: ctx.me, org, csrf: ctx.csrf, entries,
      actors: await audit.actorsAt(ctx.me.accountId, org.id),
      actions: AUDIT_ACTIONS,
      filters: { action: q.get('action') ?? '', who: q.get('who') ?? '',
                 since: q.get('since') ?? '' },
    }));
  });
}
