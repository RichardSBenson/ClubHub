/**
 * Routes: the entry list for an event.
 */
import { competition } from './data.mjs';
import * as V from './views.mjs';
import { toCsv, fileName } from '../core/domain/csv.mjs';
import { ENTRY_COLUMNS, entryRows } from '../core/domain/entry-export.mjs';
import { DEFAULT_TIMEZONE } from '../core/domain/defaults.mjs';
import { mayScheduleAt } from './access.mjs';

export function registerEntryListRoutes({ get, post, eventFor, entryContextFor }) {
  // ---- the entry list --------------------------------------------------------

  get('/o/:slug/events/:eventSlug/entries', async (ctx) => {
    const { org, host, event } = await entryContextFor(ctx);
    const setup = await competition.setupFor(event.id);
    return ctx.send(200, V.entryList({
      me: ctx.me, org: host, event, csrf: ctx.csrf,
      entries: await competition.entriesFor(ctx.me.accountId, event.id),
      divisions: setup.divisions,
      entryFeeCents: setup.prices.find((p) => p.for_count === 1 && !p.members_only)?.amount_cents ?? 0,
      canAssign: await mayScheduleAt(ctx, host.id),
      done: ctx.url.searchParams.get('done'),
      error: ctx.url.searchParams.get('error'),
    }));
  });

  // Every entry as a spreadsheet: who, how heavy, how old on the day, what grade, which club.
  // The same people who may see the list may download it (entriesFor checks the role).
  get('/o/:slug/events/:eventSlug/entries.csv', async (ctx) => {
    const { host, event } = await entryContextFor(ctx);
    const entries = await competition.entriesFor(ctx.me.accountId, event.id);
    const start = event.startsAt ?? event.starts_at;
    const zone = host.timezone || DEFAULT_TIMEZONE;
    const eventDay = start
      ? new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(start))
      : null;
    return ctx.download(fileName(event.slug, 'entries', eventDay ?? new Date().toISOString().slice(0, 10)),
      'text/csv', toCsv(ENTRY_COLUMNS, entryRows(entries, eventDay)));
  });

  post('/o/:slug/events/:eventSlug/entries/assign', async (ctx) => {
    const { org, event } = await eventFor(ctx, { toSchedule: true });
    const form = await ctx.form();
    const back = `/o/${org.slug}/events/${event.slug}/entries`;
    try {
      await competition.assignDivision(ctx.me.accountId, form.selectionId,
        form.divisionId || null, 'Placed by the organiser');
      return ctx.redirect(`${back}?done=${encodeURIComponent('Placed.')}`);
    } catch (e) {
      return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
    }
  });
}
