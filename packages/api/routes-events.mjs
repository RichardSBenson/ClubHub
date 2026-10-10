/**
 * Routes: a club's calendar — scheduling, revising and cancelling events, and passing them up the tree.
 */
import { problemWithDeclaration } from '../core/domain/calendar.mjs';
import { lookups, eventDetails, events, competition, NotFound, Invalid } from './data.mjs';
import * as V from './views.mjs';
import { toInstant, toLocalInput } from './zones.mjs';
import { typeFor, readType, defaultTitle } from '../core/domain/event-types.mjs';
import { requestRebuild } from '../infrastructure/publishing/rebuild.mjs';
import { eventTypes } from '../infrastructure/region-context.mjs';
import { calendar, organisationFor, mayManageAt, mayScheduleAt, gradesFor } from './access.mjs';

export function registerEventRoutes({ get, post }) {
  // ---- events ---------------------------------------------------------------


  /**
   * A submitted form becomes the fields the entity expects.
   *
   * Every empty text input arrives as '' rather than absent, and '' is not the
   * same as "no value" for a number or a date — `capacity: ''` would become 0.
   * A checkbox that is not ticked does not arrive at all.
   */
  function eventFieldsFrom(form, zone) {
    const text = (k) => (form[k]?.trim() ? form[k].trim() : null);
    const number = (k) => (form[k]?.trim() ? form[k].trim() : null);
    const type = typeFor(readType(form.eventType, eventTypes()), eventTypes());
    return {
      title: form.title?.trim() || (type ? defaultTitle(type.key, eventTypes()) : ''),
      kind: type ? type.kind : form.kind,
      slug: text('slug'),
      summary: text('summary'),
      startsAt: toInstant(text('startsAt'), zone),
      endsAt: toInstant(text('endsAt'), zone),
      allDay: !!form.allDay,
      venueName: text('venueName'),
      addressLine: text('addressLine'),
      visibility: form.visibility ?? 'public',
      minRankOrder: number('minRankOrder'),
      maxRankOrder: number('maxRankOrder'),
      minAge: number('minAge'),
      maxAge: number('maxAge'),
      entriesOpen: toInstant(text('entriesOpen'), zone),
      entriesClose: toInstant(text('entriesClose'), zone),
      capacity: number('capacity'),
      publishDown: !!form.publishDown,
      guardianUnder: number('guardianUnder'),
      consentVersion: text('consentVersion'),
      consentText: text('consentText'),
      guestsAllowed: !!form.guestsAllowed,
    };
  }

  /** Dollars typed in the form → cents. Blank is free. Returns { cents } or { problem }. */
  function readEntryFee(form) {
    const raw = String(form.entryFee ?? '').replace(/[$,\s]/g, '');
    if (!raw) return { cents: 0 };
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100000) return { problem: 'The entry fee must be an amount like 0 or 25.00.' };
    return { cents: Math.round(n * 100) };
  }
  /** Competitions are priced by division, so only the other kinds of event take one flat fee. */
  const takesFlatFee = (kind) => !['tournament', 'fight_night'].includes(kind);
  const flatFeeOf = async (eventId) =>
    ((await lookups.flatEntryFeeCents(eventId)) / 100).toFixed(2).replace(/\.00$/, '');

  const detailAsForm = (d) => d ? { eventType: d.type_key ?? '', contactName: d.contact_name ?? '', contactEmail: d.contact_email ?? '',
    contactPhone: d.contact_phone ?? '', costNote: d.cost_note ?? '', infoUrl: d.info_url ?? '', description: d.description ?? '',
    latitude: d.latitude ?? '', longitude: d.longitude ?? '' } : {};

  /** An Event back into what the form wants: local wall-clock strings. */
  const eventAsForm = (e, zone) => ({
    ...e.toJSON(),
    slug: String(e.slug),
    startsAt: toLocalInput(e.startsAt, zone),
    endsAt: toLocalInput(e.endsAt, zone),
    entriesOpen: toLocalInput(e.entriesOpen, zone),
    entriesClose: toLocalInput(e.entriesClose, zone),
    minRankOrder: e.minRankOrder == null ? '' : String(e.minRankOrder),
    maxRankOrder: e.maxRankOrder == null ? '' : String(e.maxRankOrder),
    minAge: e.minAge == null ? '' : String(e.minAge),
    maxAge: e.maxAge == null ? '' : String(e.maxAge),
    capacity: e.capacity == null ? '' : String(e.capacity),
    guardianUnder: e.guardianUnder == null ? '' : String(e.guardianUnder),
    consentVersion: e.consentVersion ?? '',
    consentText: e.consentText ?? '',
  });

  get('/o/:slug/events', async (ctx) => {
    const org = await organisationFor(ctx);
    const { repo } = await calendar();

    const own = await repo.listFor(org.id);
    // What the old read-only view showed: everything visible here, including
    // events published down from above. Those are read-only, so they are listed
    // separately and the org's own ones are dropped from the inherited list.
    const visible = await events.forOrg(org.slug,
      { isMember: true, viewerRankOrder: 99 });
    const inherited = visible.filter((e) => !e.is_own);

    return ctx.send(200, V.events({
      me: ctx.me, org, own, inherited, zone: org.timezone, csrf: ctx.csrf,
      canSchedule: await mayScheduleAt(ctx, org.id),
      // Asking is for somebody who can speak for the organisation, and only
      // makes sense where there is a federation above to ask.
      canAsk: !!org.parent_id && await mayManageAt(ctx, org.id),
      waiting: await mayManageAt(ctx, org.id)
        ? await events.awaitingDecision(ctx.me.accountId, org.id) : [],
      done: ctx.url.searchParams.get('done'),
      error: ctx.url.searchParams.get('error'),
      rebuild: ctx.url.searchParams.get('rebuild'),
    }));
  });

  get('/o/:slug/events/new', async (ctx) => {
    const org = await organisationFor(ctx, { toSchedule: true });
    return ctx.send(200, V.eventForm({
      me: ctx.me, org, csrf: ctx.csrf, isNew: true,
      zone: org.timezone, grades: await gradesFor(org),
      values: { kind: 'training', visibility: 'public', publishDown: org.type !== 'club' },
    }));
  });

  post('/o/:slug/events/new', async (ctx) => {
    const org = await organisationFor(ctx, { toSchedule: true });
    const form = await ctx.form();
    const { schedule } = await calendar();

    try {
      const detail = eventDetails.read(form);
      if (detail.problems.length) throw Object.assign(new Error(detail.problems.join(' ')), { status: 422 });
      const declared = problemWithDeclaration(eventFieldsFrom(form, org.timezone).kind, form.consentVersion?.trim());
      if (declared) throw Object.assign(new Error(declared), { status: 422 });
      const fee = readEntryFee(form);
      if (fee.problem) throw Object.assign(new Error(fee.problem), { status: 422 });
      const saved = await schedule.execute({
        actorId: ctx.me.accountId, organisationId: org.id,
        ...eventFieldsFrom(form, org.timezone),
        status: form.status === 'published' ? 'published' : 'draft',
      });
      await eventDetails.save(saved.id, detail.d);
      if (takesFlatFee(saved.kind)) await competition.setPrice(ctx.me.accountId, saved.id, { forCount: 1, amountCents: fee.cents, label: 'Entry fee' });
      const rebuild = await requestRebuild({ reason: `event ${org.slug}` });
      return ctx.redirect(`/o/${org.slug}/events?done=`
        + encodeURIComponent(`"${saved.title}" saved.`)
        + '&rebuild=' + encodeURIComponent(rebuild.detail));
    } catch (e) {
      // Back to the form with what they typed still in it. Re-rendering an empty
      // form after a refusal is how somebody loses fifteen fields to a typo in
      // one of them.
      return ctx.send(e.status ?? 422, V.eventForm({
        me: ctx.me, org, csrf: ctx.csrf, isNew: true, error: e.message,
        zone: org.timezone, grades: await gradesFor(org), values: form,
      }));
    }
  });

  get('/o/:slug/events/:eventSlug/edit', async (ctx) => {
    const org = await organisationFor(ctx, { toSchedule: true });
    const { repo } = await calendar();
    const event = await repo.bySlug(org.id, ctx.params.eventSlug);
    if (!event) throw new NotFound('Event');

    return ctx.send(200, V.eventForm({
      me: ctx.me, org, csrf: ctx.csrf, isNew: false, status: event.status,
      zone: org.timezone, grades: await gradesFor(org),
      values: { ...eventAsForm(event, org.timezone), ...detailAsForm(await eventDetails.forEvent(event.id)), entryFee: await flatFeeOf(event.id) },
    }));
  });

  post('/o/:slug/events/:eventSlug/edit', async (ctx) => {
    const org = await organisationFor(ctx, { toSchedule: true });
    const form = await ctx.form();
    const { repo, revise } = await calendar();

    const existing = await repo.bySlug(org.id, ctx.params.eventSlug);
    if (!existing) throw new NotFound('Event');

    try {
      const detail = eventDetails.read(form);
      if (detail.problems.length) throw Object.assign(new Error(detail.problems.join(' ')), { status: 422 });
      const declared = problemWithDeclaration(eventFieldsFrom(form, org.timezone).kind, form.consentVersion?.trim());
      if (declared) throw Object.assign(new Error(declared), { status: 422 });
      const fee = readEntryFee(form);
      if (fee.problem) throw Object.assign(new Error(fee.problem), { status: 422 });
      const saved = await revise.execute({
        actorId: ctx.me.accountId, eventId: existing.id,
        ...eventFieldsFrom(form, org.timezone),
        status: form.status,
      });
      await eventDetails.save(existing.id, detail.d);
      if (takesFlatFee(saved.kind)) await competition.setPrice(ctx.me.accountId, existing.id, { forCount: 1, amountCents: fee.cents, label: 'Entry fee' });
      const rebuild = await requestRebuild({ reason: `event ${org.slug}` });
      return ctx.redirect(`/o/${org.slug}/events?done=`
        + encodeURIComponent(`"${saved.title}" updated.`)
        + '&rebuild=' + encodeURIComponent(rebuild.detail));
    } catch (e) {
      return ctx.send(e.status ?? 422, V.eventForm({
        me: ctx.me, org, csrf: ctx.csrf, isNew: false, status: existing.status,
        error: e.message, zone: org.timezone, grades: await gradesFor(org),
        values: { ...form, slug: String(existing.slug) },
      }));
    }
  });

  post('/o/:slug/events/:eventSlug/cancel', async (ctx) => {
    const org = await organisationFor(ctx, { toSchedule: true });
    await ctx.form();
    const { repo, cancel } = await calendar();

    const existing = await repo.bySlug(org.id, ctx.params.eventSlug);
    if (!existing) throw new NotFound('Event');

    try {
      await cancel.execute({ actorId: ctx.me.accountId, eventId: existing.id });
    } catch (e) {
      return ctx.redirect(
        `/o/${org.slug}/events?error=${encodeURIComponent(e.message)}`);
    }
    const rebuild = await requestRebuild({ reason: `event ${org.slug}` });
    return ctx.redirect(`/o/${org.slug}/events?done=`
      + encodeURIComponent(`"${existing.title}" is cancelled.`)
      + '&rebuild=' + encodeURIComponent(rebuild.detail));
  });

  // The club asks; the federation answers. Same shape as an article, and for the
  // same reason: a club may put what it likes on its own page, but the
  // federation's calendar carries the federation's name.
  post('/o/:slug/events/:eventSlug/ask', async (ctx) => {
    const org = await organisationFor(ctx, { toSchedule: true });
    await ctx.form();
    const { repo } = await calendar();
    const back = `/o/${org.slug}/events`;
    const existing = await repo.bySlug(org.id, ctx.params.eventSlug);
    if (!existing) throw new NotFound('Event');
    try {
      const ev = await events.requestPublishUp(ctx.me.accountId, existing.id);
      return ctx.redirect(`${back}?done=` + encodeURIComponent(
        `Asked for "${ev.title}" to appear on the federation's calendar.`));
    } catch (e) {
      if (e instanceof Invalid)
        return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
      throw e;
    }
  });

  /** Posted at the deciding organisation, whose calendar it would appear on. */
  post('/o/:slug/event-requests/:eventId/decide', async (ctx) => {
    const org = await organisationFor(ctx, { toSchedule: true });
    const form = await ctx.form();
    const approve = form.answer === 'approve';
    const back = `/o/${org.slug}/events`;
    try {
      const ev = await events.decidePublishUp(ctx.me.accountId, ctx.params.eventId,
        approve, { decidedBy: org.id });
      const rebuild = approve
        ? await requestRebuild({ reason: `approve event ${ev.slug}` })
        : { detail: 'Nothing to rebuild — it was not on the site.' };
      return ctx.redirect(`${back}?done=` + encodeURIComponent(approve
        ? `"${ev.title}" now appears on this calendar.`
        : `"${ev.title}" was declined. It stays on their own calendar.`)
        + '&rebuild=' + encodeURIComponent(rebuild.detail));
    } catch (e) {
      if (e instanceof Invalid)
        return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
      throw e;
    }
  });
}
