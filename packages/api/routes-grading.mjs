/**
 * Routes: running a grading — who sat, who passed, and the awards.
 */
import { orgs, people, rank } from './data.mjs';
import * as V from './views.mjs';
import { organisationFor } from './access.mjs';

export function registerGradingRoutes({ get, post }) {
  // ---- grading --------------------------------------------------------------

  get('/o/:slug/grading', async (ctx) => {
    // The same role the submission needs. Showing somebody a grading sheet
    // they will not be allowed to submit is the form-you-cannot-send problem,
    // and it was relying on people.roster to refuse rather than saying so.
    const org = await organisationFor(ctx, { toRegister: true });
    // Whose syllabus this club grades on, rather than one federation's slug.
    const fed = await orgs.ladderOwnerOf(org.id) ?? org;
    const roster = await people.roster(ctx.me.accountId, org.id,
      { subtree: org.type !== 'club' });

    const candidates = [];
    for (const p of roster) {
      if (p.role !== 'member') continue;
      candidates.push({ ...p, eligibility: await rank.eligibility(p.id, fed.id) });
    }
    return ctx.send(200, V.grading({
      me: ctx.me, org, candidates, ladder: await rank.ladder(fed.id),
      done: ctx.url.searchParams.get('done'),
      error: ctx.url.searchParams.get('error'),
      csrf: ctx.csrf,
    }));
  });

  post('/o/:slug/grading', async (ctx) => {
    // Checked HERE, not left to rank.award.
    //
    // This route used to rely entirely on award() refusing, which it does —
    // but only when it is called. Submitted with nobody ticked, the loop never
    // ran, nothing refused anything, and a stranger got back "done=0" as though
    // their grading had been recorded. And a real attempt came back as a 302
    // with an error in the query string rather than a refusal, so the route
    // could not tell the difference between "not allowed" and "did not work".
    //
    // Exactly the shape of the /o/:slug/events hole: a route trusting a lower
    // layer that is not always reached.
    const org = await organisationFor(ctx, { toRegister: true });
    const form = await ctx.form();
    const panel = (form.panel ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const passed = Object.keys(form).filter((k) => k.startsWith('pass_'))
      .map((k) => k.slice(5));

    // All or nothing. A half-recorded grading is worse than none.
    try {
      for (const personId of passed) {
        await rank.award(ctx.me.accountId, {
          personId, gradeId: form[`grade_${personId}`], awardedByOrg: org.id,
          awardedOn: form.awarded_on, panel,
        });
      }
    } catch (e) {
      return ctx.redirect(
        `/o/${org.slug}/grading?error=${encodeURIComponent(e.message)}`);
    }
    return ctx.redirect(`/o/${org.slug}/grading?done=${passed.length}`);
  });
}
