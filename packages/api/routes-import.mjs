/**
 * Routes: bringing an existing roll in from a spreadsheet.
 */
import { orgs, people, rank, Forbidden, NotFound } from './data.mjs';
import * as V from './views.mjs';
import { parseTable, planImport } from '../core/domain/roll-import.mjs';
import { mayRegisterAt, organisationFor } from './access.mjs';

export function registerImportRoutes({ get, post, memberFieldsFrom }) {
  // ---- bringing an existing roll in -----------------------------------------

  /**
   * Plan the import from the pasted text.
   *
   * Re-planned on the confirm step rather than held between requests. The
   * planning is pure and deterministic, so the same text gives the same plan,
   * and a serverless instance that never sees the second request cannot lose
   * somebody's half-finished import. It also means the rules are applied again
   * at the moment of writing rather than trusted from a previous one.
   */
  async function planFor(ctx, org, text) {
    const grades = (await rank.ladder((await orgs.ladderOwnerOf(org.id))?.id ?? org.id))
      .map((g) => ({ id: g.id, label: g.label, shortLabel: g.short_label,
                     rankOrder: g.rank_order }));
    const existing = await people.rollFor(ctx.me.accountId, org.id);
    return planImport(parseTable(text), { existing, grades });
  }

  get('/o/:slug/members/import', async (ctx) => {
    const org = await organisationFor(ctx, { toRegister: true });
    return ctx.send(200, V.importRoll({
      me: ctx.me, org, csrf: ctx.csrf,
      vocabulary: await orgs.vocabulary(org.id),
    }));
  });

  post('/o/:slug/members/import', async (ctx) => {
    const org = await organisationFor(ctx, { toRegister: true });
    const form = await ctx.form();
    const text = form.text ?? '';
    const vocabulary = await orgs.vocabulary(org.id);

    if (!text.trim()) {
      return ctx.send(422, V.importRoll({
        me: ctx.me, org, csrf: ctx.csrf, vocabulary,
        error: 'There is nothing pasted in yet.' }));
    }

    const preview = await planFor(ctx, org, text);

    // Two buttons, one route. Without the confirm flag this only ever shows what
    // would happen — the preview is not a formality to click through, it is the
    // only thing that runs until somebody says go.
    if (form.confirm !== 'yes') {
      return ctx.send(200, V.importRoll({
        me: ctx.me, org, csrf: ctx.csrf, text, preview, vocabulary }));
    }

    try {
      const result = await people.importRoll(ctx.me.accountId, org.id, preview.plan);
      return ctx.redirect(`/o/${org.slug}/roll?done=` + encodeURIComponent(
        `${result.added} added to the roll`
        + (result.graded ? `, ${result.graded} with the grade they already held` : '')
        + '.'));
    } catch (e) {
      return ctx.send(e.status ?? 422, V.importRoll({
        me: ctx.me, org, csrf: ctx.csrf, text, preview, vocabulary,
        error: e.message }));
    }
  });

  get('/p/:id/edit', async (ctx) => {
    ctx.requireActor();
    const { person, at } = await people.record(ctx.me.accountId, ctx.params.id);
    if (!at) throw new NotFound('Person has no current affiliation');
    if (!await mayRegisterAt(ctx, at.id))
      throw new Forbidden(`You can see this record but not change it. `
        + 'Correcting the register needs an owner, administrator or registrar role.');

    const priv = await people.privateDetail(ctx.me.accountId, person.id);
    const current = await people.currentAffiliation(person.id);

    return ctx.send(200, V.memberForm({
      me: ctx.me, org: at, person, csrf: ctx.csrf, isNew: false,
      vocabulary: await orgs.vocabulary(at.id),
      values: {
        firstName: person.first_name, lastName: person.last_name,
        preferredName: person.preferred_name ?? '',
        dateOfBirth: person.date_of_birth ?? '',
        gender: person.gender ?? '', email: person.email ?? '',
        phone: person.phone ?? '',
        emergencyName: priv?.emergency_name ?? '',
        emergencyPhone: priv?.emergency_phone ?? '',
        status: current?.status ?? 'active',
        paidUntil: current?.paid_until ?? '',
      },
    }));
  });

  post('/p/:id/edit', async (ctx) => {
    ctx.requireActor();
    const { person, at } = await people.record(ctx.me.accountId, ctx.params.id);
    if (!at) throw new NotFound('Person has no current affiliation');
    const form = await ctx.form();

    try {
      await people.update(ctx.me.accountId, person.id, {
        ...memberFieldsFrom(form),
        status: form.status || undefined,
      });
      return ctx.redirect(`/p/${person.id}`);
    } catch (e) {
      return ctx.send(e.status ?? 422, V.memberForm({
        me: ctx.me, org: at, person, csrf: ctx.csrf, isNew: false,
        error: e.message, vocabulary: await orgs.vocabulary(at.id), values: form,
      }));
    }
  });
}
