/**
 * Routes: who teaches at a club, and the public write-up of each instructor.
 */
import { instructors, Invalid } from './data.mjs';
import { requestRebuild } from '../infrastructure/publishing/rebuild.mjs';

export function registerInstructorRoutes({ get, post, UUID_RE, organisationFor }) {
  // ---- instructors -----------------------------------------------------------

  // The roll is where instructors are chosen; this address is kept so old links and menu entries still land.
  get('/o/:slug/instructors', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    return ctx.redirect(`/o/${org.slug}/roster?show=instructors`);
  });

  post('/o/:slug/instructors/bulk', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    const form = await ctx.form();
    const keep = new URLSearchParams();
    if (form.grade && form.grade !== 'all') keep.set('grade', form.grade);
    if (form.band) keep.set('band', form.band);
    if (form.show) keep.set('show', form.show);
    const back = `/o/${org.slug}/roster`;
    const go = (extra) => ctx.redirect(`${back}?${keep}${keep.size ? '&' : ''}${extra}`);
    const picked = Object.keys(form).filter((k) => k.startsWith('pick_')).map((k) => k.slice(5)).filter((id) => UUID_RE.test(id));
    if (!picked.length) return go('error=' + encodeURIComponent('Tick the people first.'));
    const mode = { show: 'show', role: 'role', off: 'off' }[form.action];
    if (!mode) return go('error=' + encodeURIComponent('Choose what to do with them.'));
    try {
      const r = await instructors.bulk(ctx.me.accountId, org.id, picked, mode);
      const rebuild = mode === 'role' ? { detail: 'Not on the website, so nothing to rebuild.' }
        : await requestRebuild({ reason: `instructors ${mode} ${org.slug}` });
      const said = mode === 'off' ? `${r.changed} taken off as instructors.`
        : mode === 'role' ? `${r.changed} made instructors.`
        : `${r.changed} made instructors, ${r.shown} newly on the website.`;
      const extra = r.skipped.length ? ' ' + r.skipped.map((x) => `${x.name}: ${x.reason}.`).join(' ') : '';
      return go('done=' + encodeURIComponent(said + extra) + '&rebuild=' + encodeURIComponent(rebuild.detail));
    } catch (e) {
      if (e instanceof Invalid || e?.name === 'DomainError') return go('error=' + encodeURIComponent(e.message));
      throw e;
    }
  });

  post('/o/:slug/instructors/:personId', async (ctx) => {
    const org = await organisationFor(ctx, { toWrite: true });
    const form = await ctx.form();
    const back = `/o/${org.slug}/instructors`;

    try {
      if (form.op === 'remove') {
        await instructors.remove(ctx.me.accountId, org.id, ctx.params.personId);
        const rebuild = await requestRebuild({ reason: `instructor off ${org.slug}` });
        return ctx.redirect(`${back}?done=`
          + encodeURIComponent('Taken off the website. They are still on the roll.')
          + '&rebuild=' + encodeURIComponent(rebuild.detail));
      }

      const published = form.published === 'on';
      const row = await instructors.save(ctx.me.accountId, org.id,
        ctx.params.personId, {
          bio: { blocks: String(form.bio ?? '').split(/\n{2,}/)
            .map((t) => t.trim()).filter(Boolean)
            .map((text) => ({ type: 'paragraph', text })) },
          teaches: form.teaches,
          published,
          sortOrder: Number(form.sortOrder) || 0,
          startedYear: form.startedYear, showChecks: form.showChecks === 'on',
        });

      const rebuild = row.published
        ? await requestRebuild({ reason: `instructor on ${org.slug}` })
        : { detail: 'Not on the site, so nothing to rebuild.' };
      return ctx.redirect(`${back}?done=` + encodeURIComponent(row.published
        ? 'Saved and on the website.' : 'Saved. Not on the website.')
        + '&rebuild=' + encodeURIComponent(rebuild.detail));
    } catch (e) {
      // A DomainError here is the minimum-age rule or the register rule, and its
      // message is written to be read by a person, so it is shown as it is.
      if (e.name === 'DomainError' || e instanceof Invalid)
        return ctx.redirect(`${back}?error=${encodeURIComponent(e.message)}`);
      throw e;
    }
  });
}
