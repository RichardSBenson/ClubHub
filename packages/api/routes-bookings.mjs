/**
 * Routes: a club's classes, bookings and the register.
 */
import { attendance, booking, NotFound, Invalid } from './data.mjs';
import * as V from './views.mjs';
import { readVisitors, isDate } from '../core/domain/attendance.mjs';

export function registerBookingRoutes({ get, post, UUID_RE, mayRegisterAt, organisationFor }) {
  // ---- booking a class: the club's side
  get('/o/:slug/bookings', async (ctx) => {
    const org = await organisationFor(ctx);
    if (org.type !== 'club') return ctx.redirect(`/o/${org.slug}/clubs`);
    return ctx.send(200, V.bookingsScreen({ me: ctx.me, csrf: ctx.csrf, org, ...(await booking.forClub(ctx.me.accountId, org.id)),
      canSet: await mayRegisterAt(ctx, org.id), done: ctx.url.searchParams.get('done'), error: ctx.url.searchParams.get('error') }));
  });
  post('/o/:slug/bookings/:sessionId/places', async (ctx) => {
    const org = await organisationFor(ctx, { toRegister: true });
    if (!UUID_RE.test(ctx.params.sessionId)) throw new NotFound('Class');
    const f = await ctx.form();
    try {
      await booking.setCapacity(ctx.me.accountId, org.id, ctx.params.sessionId, f.capacity);
      return ctx.redirect(`/o/${org.slug}/bookings?done=${encodeURIComponent('Saved.')}`);
    } catch (e) { if (e instanceof Invalid) return ctx.redirect(`/o/${org.slug}/bookings?error=${encodeURIComponent(e.message)}`); throw e; }
  });

  // Instructors take the roll. The timetable itself is the club's page.

  async function rollScreen(ctx, org, extra = {}) {
    const sheet = await attendance.sheet(ctx.me.accountId, org.id, ctx.params.sessionId,
      String(ctx.url.searchParams.get('date') ?? ''));
    return ctx.send(extra.status ?? 200, V.rollScreen({ me: ctx.me, org, csrf: ctx.csrf, ...sheet,
      done: ctx.url.searchParams.get('done'), ...extra }));
  }

  get('/o/:slug/attendance', async (ctx) => {
    const org = await organisationFor(ctx);
    if (org.type !== 'club') return ctx.redirect(`/o/${org.slug}/clubs`);
    const wanted = String(ctx.url.searchParams.get('date') ?? '');
    return ctx.send(200, V.attendanceScreen({ me: ctx.me, org, csrf: ctx.csrf,
      ...(await attendance.overview(ctx.me.accountId, org.id, { date: isDate(wanted) ? wanted : null })),
      done: ctx.url.searchParams.get('done') }));
  });

  get('/o/:slug/attendance/:sessionId', async (ctx) => {
    const org = await organisationFor(ctx);
    if (!UUID_RE.test(ctx.params.sessionId)) throw new NotFound('Class');
    try { return await rollScreen(ctx, org); }
    catch (e) {
      if (e instanceof Invalid) return ctx.redirect(`/o/${org.slug}/attendance?error=${encodeURIComponent(e.message)}`);
      throw e;
    }
  });

  post('/o/:slug/attendance/:sessionId', async (ctx) => {
    const org = await organisationFor(ctx);
    const form = await ctx.form();
    if (!UUID_RE.test(ctx.params.sessionId)) throw new NotFound('Class');
    const date = String(form.date ?? '');
    const personIds = Object.keys(form).filter((k) => k.startsWith('here_') && form[k] === '1')
      .map((k) => k.slice(5)).filter((id) => UUID_RE.test(id));
    try {
      const newcomerIds = Object.keys(form).filter((k) => k.startsWith('new_') && form[k] === '1')
        .map((k) => k.slice(4)).filter((id) => UUID_RE.test(id));
      const out = await attendance.save(ctx.me.accountId, org.id, ctx.params.sessionId, date,
        { personIds, visitorNumbers: readVisitors(form.visitors), newcomerIds });
      return ctx.redirect(`/o/${org.slug}/attendance?date=${encodeURIComponent(date)}&done=${
        encodeURIComponent(`Saved. ${out.came} came.`)}`);
    } catch (e) {
      if (e instanceof Invalid) {
        ctx.url.searchParams.set('date', date);
        return rollScreen(ctx, org, { status: 422, error: e.message, visitorText: form.visitors });
      }
      throw e;
    }
  });
}
