/**
 * HONBU — data access: grading
 *
 * Part of the data layer (see ../data.mjs). Every function that touches an organisation takes an `actor` and
 * checks permission in SQL, not in the caller.
 */

import { pool } from '../../infrastructure/postgres/pool.mjs';
import { region } from '../../infrastructure/region-context.mjs';
import { SUPPORTER_NO_RANK } from '../../core/domain/roles.mjs';
import { payeeFor } from '../../core/domain/payments.mjs';
import { GradingAuthority } from '../../core/domain/rank.mjs';
import { AWARDS, problemsWithResults, certificateNumber, entriesOpen } from '../../core/domain/grading.mjs';
import { CATEGORIES as QUAL_CATEGORIES, REQUIRED_FOR, STARTERS, problemsWithQualification, problemsWithAward, latestPerQualification, clearance, remindersDue, reminderText as qualReminderText, STATE_WORDS } from '../../core/domain/qualification.mjs';
import { MANAGE, REGISTER } from '../../core/domain/access.mjs';
import { competition } from './events.mjs';
import { messages } from './messaging.mjs';
import { clubs, orgs } from './organisations.mjs';
import { family } from './people.mjs';
import { AWARD_SELECT, CATALOGUE_FROM, Forbidden, Invalid, NotFound, assertRole, complianceData, describeAwards, homesOf, one, q, qualToday } from './shared.mjs';

// ---------------------------------------------------------------------------
// people and affiliation
// ---------------------------------------------------------------------------

/**
 * A supporter is somebody whose only current tie to a club is as a supporter.
 * They have no part in ranking, so nothing that writes a grade, a grading
 * entry or a recognition may proceed for them.
 */
async function assertNoRankingForSupporter(personId, client = null) {
  const run = (client ?? pool);
  const { rows: [r] } = await run.query(`
    select bool_or(role = 'supporter') as sup, bool_or(role <> 'supporter') as other
    from affiliation where person_id = $1 and ends is null`, [personId]);
  if (r?.sup && !r?.other) throw new Invalid(SUPPORTER_NO_RANK);
}

// ---------------------------------------------------------------------------
// rank
// ---------------------------------------------------------------------------

export const rank = {
  async ladder(orgId) {
    return q(`select * from grade where organisation_id = $1 order by rank_order`,
      [orgId]);
  },

  /** Set the usual gap after each grade (a guide, not a gate). `rows`: [{ gradeId, months|null, byInvitation }]. */
  async setTimetable(actor, orgId, rows) {
    await assertRole(actor, orgId, MANAGE);
    const client = await pool.connect();
    try {
      await client.query('begin');
      for (const r of rows)
        await client.query(`update grade set usual_months_to_next = $3, next_by_invitation = $4 where id = $1 and organisation_id = $2`,
          [r.gradeId, orgId, r.months, r.byInvitation]);
      await client.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id) values ($1,$2,'grading_timetable_changed','organisation',$2)`, [actor, orgId]);
      await client.query('commit');
    } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
  },

  /** Who may award this grade, with what panel, ratified by whom. */
  async authorityFor(orgId, rankOrder) {
    return one(`
      select ga.*, g.label as panel_must_hold, t.label as requires_title_label
      from grade_authority ga
      left join title t on t.id = ga.requires_title_id
      left join grade g on g.rank_order = ga.min_panel_rank
                       and g.organisation_id = ga.organisation_id
      where ga.organisation_id = $1
        and $2 between ga.from_rank_order and ga.to_rank_order`,
      [orgId, rankOrder]);
  },

  /**
   * Eligibility, computed. Returns every unmet requirement rather than a bare
   * no, because a club operator needs to tell the student what is missing.
   */
  async eligibility(personId, federationId) {
    const row = await one(`
      with cur as (
        select p.id, p.date_of_birth, cg.rank_order, cg.awarded_on, cg.label
        from person p
        left join person_current_grade cg on cg.person_id = p.id
        where p.id = $1
      )
      select cur.label as holds, cur.rank_order,
             g.id as next_grade_id, g.label as next_grade, g.rank_order as next_order,
             g.min_months_at_previous, g.min_age, g.min_sessions,
             coalesce((date_part('year', age(cur.awarded_on))*12
                     + date_part('month', age(cur.awarded_on)))::int, 999) as months_since,
             (select count(*) from attendance a
               where a.person_id = cur.id
                 and a.session_date > coalesce(cur.awarded_on,'1900-01-01')) as sessions_since,
             date_part('year', age(cur.date_of_birth))::int as age_now
      from cur
      join grade g on g.rank_order = coalesce(cur.rank_order, 0) + 1
                  and g.organisation_id = $2`, [personId, federationId]);

    if (!row) return { eligible: false, reason: 'No next grade defined' };

    const unmet = [];
    if (row.months_since < (row.min_months_at_previous ?? 0))
      unmet.push(`${row.min_months_at_previous - row.months_since} more months at grade`);
    if (+row.sessions_since < (row.min_sessions ?? 0))
      unmet.push(`${row.min_sessions - row.sessions_since} more training sessions`);
    if (row.age_now < (row.min_age ?? 0))
      unmet.push(`minimum age ${row.min_age}`);

    return {
      holds: row.holds, next: row.next_grade, nextGradeId: row.next_grade_id,
      months: { has: row.months_since, needs: row.min_months_at_previous },
      sessions: { has: +row.sessions_since, needs: row.min_sessions },
      age: { has: row.age_now, needs: row.min_age },
      eligible: unmet.length === 0,
      unmet,
    };
  },

  /**
   * Record a grading. Refuses if the awarding organisation is not permitted to
   * award that grade, or the panel is too small or too junior.
   */
  async award(actor, { personId, gradeId, awardedByOrg, awardedOn, panel = [],
                       eventId = null, result = 'pass' }, client = null) {
    await assertRole(actor, awardedByOrg, REGISTER);
    await assertNoRankingForSupporter(personId, client);

    const grade = await one('select * from grade where id = $1', [gradeId]);
    if (!grade) throw new NotFound('Grade');
    const org = await one('select * from organisation where id = $1', [awardedByOrg]);

    const row = await this.authorityFor(grade.organisation_id, grade.rank_order);
    if (!row) throw new Invalid(`No authority rule covers ${grade.label}`);

    // The rule itself lives in the domain, so this path and the use case judge a grading identically.
    const ranks = new Map((await q('select person_id, rank_order from person_current_grade where person_id = any($1::uuid[])', [panel]))
      .map((r) => [r.person_id, r.rank_order]));
    const titles = await q('select distinct person_id, title_id from title_award where person_id = any($1::uuid[])', [panel]);
    const objections = GradingAuthority.fromRow(row).objectionsTo({
      grade: { label: grade.label }, awardingOrgType: org.type,
      panel: panel.map((id) => ({ personId: id, rankOrder: ranks.get(id) ?? null,
        titleIds: titles.filter((t) => t.person_id === id).map((t) => t.title_id) })),
    });
    if (objections.length) throw new Invalid(objections.join('; '));

    // Inside somebody else's transaction when one is passed, so a whole
    // grading night can be awarded together or not at all.
    return (await (client ?? pool).query(`
      insert into grading_record
        (person_id, grade_id, awarded_on, awarded_by_org, event_id, result, panel)
      values ($1,$2,$3,$4,$5,$6,$7::jsonb) returning *`,
      [personId, gradeId, awardedOn, awardedByOrg, eventId, result,
       JSON.stringify(panel.map((id) => ({ person_id: id })))])).rows[0];
  },

  /**
   * Grades this actor may RECORD for a person who already holds them: kyu by an official of the
   * person's own club, dan by an official of the federation that owns the ladder. A club cannot
   * type in a black belt. Nothing here is awarded: no panel, no certificate.
   */
  async recognisable(actor, personId) {
    const home = await one(`select organisation_id from affiliation
      where person_id = $1 and ends is null order by (role = 'member') desc limit 1`, [personId]);
    if (!home) return { grades: [], current: null, fed: null, mayKyu: false, mayDan: false };
    const fed = await orgs.ladderOwnerOf(home.organisation_id);
    if (!fed) return { grades: [], current: null, fed: null, mayKyu: false, mayDan: false };
    const sup = await one(`select bool_or(role = 'supporter') as sup, bool_or(role <> 'supporter') as other
      from affiliation where person_id = $1 and ends is null`, [personId]);
    if (sup?.sup && !sup?.other) return { grades: [], current: null, fed, home, mayKyu: false, mayDan: false };
    const mayKyu = (await one('select has_role_at($1,$2,$3) as ok', [actor, home.organisation_id, REGISTER]))?.ok;
    const mayDan = (await one('select has_role_at($1,$2,$3) as ok', [actor, fed.id, REGISTER]))?.ok;
    const current = await one('select rank_order from person_current_grade where person_id = $1', [personId]);
    const all = await this.ladder(fed.id);
    const grades = all.filter((g) => (g.is_dan ? mayDan : mayKyu) && g.rank_order > (current?.rank_order ?? 0));
    return { grades, current, fed, home, mayKyu: !!mayKyu, mayDan: !!mayDan };
  },

  async recognise(actor, { personId, gradeId, heldOn, note }) {
    const { grades, fed, home, mayKyu, mayDan } = await this.recognisable(actor, personId);
    if (!mayKyu && !mayDan) throw new Forbidden();
    await assertNoRankingForSupporter(personId);
    const grade = grades.find((g) => g.id === gradeId);
    if (!grade) {
      const any = fed ? (await this.ladder(fed.id)).find((g) => g.id === gradeId) : null;
      if (any?.is_dan && !mayDan) throw new Forbidden();
      throw new Invalid('Choose a grade higher than the one already on the record.');
    }
    const day = String(heldOn ?? '').slice(0, 10) || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day)) || day > new Date().toISOString().slice(0, 10))
      throw new Invalid('Give the date the grade was earned, not a date in the future.');
    const text = String(note ?? '').trim().slice(0, 300);
    const row = (await pool.query(`
      insert into grading_record (person_id, grade_id, awarded_on, awarded_by_org, result, panel, notes)
      values ($1,$2,$3,$4,'pass','[]',$5) returning id`,
      [personId, gradeId, day, grade.is_dan ? fed.id : home.organisation_id,
       'Recognised: held before joining, not graded through this system.' + (text ? ' ' + text : '')])).rows[0];
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
      values ($1,$2,'grade_recognised','person',$3,$4)`,
      [actor, home.organisation_id, personId, JSON.stringify({ gradeId, label: grade.label, heldOn: day, recordId: row.id })]);
    return grade;
  },
};

const UTC_ISO = (col) => `to_char(${col} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

async function gradingEvent(eventId) {
  const ev = await one(`select e.id, e.organisation_id, e.title, e.slug, e.status, e.kind,
      ${UTC_ISO('e.starts_at')} as starts_iso, o.name as organiser, o.slug as organiser_slug, o.timezone,
      ${UTC_ISO('e.entries_open')} as entries_open, ${UTC_ISO('e.entries_close')} as entries_close,
      coalesce(g.fee_cents, 0) as fee_cents, to_char(g.finalised_on,'YYYY-MM-DD') as finalised_on,
      (g.event_id is not null) as has_setup
    from event e join organisation o on o.id = e.organisation_id
    left join grading_event g on g.event_id = e.id where e.id = $1`, [eventId]);
  if (!ev || ev.kind !== 'grading') throw new NotFound('Grading');
  return ev;
}

/** A club may deal with an event its own organisation, or one above it, runs. */
async function clubSeesEvent(clubId, ev) {
  return !!(await one(`select 1 from organisation c join organisation o on o.id = $2
    where c.id = $1 and c.path <@ o.path
      and (c.id = o.id or exists (select 1 from event e where e.id = $3 and e.publish_down))`, [clubId, ev.organisation_id, ev.id]));
}

const entryRows = (eventId, clubId = null) => q(`
  select en.id as entry_id, en.status, en.person_id, en.notes as entry_notes,
         p.display_number, nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') as name,
         c.name as club, c.id as club_id, g.id as grade_id, g.label as grade, g.is_dan,
         cg.label as holds, ge.outcome, ge.notes, ge.record_id,
         (select py.status from payment py where py.event_entry_id = en.id and py.status <> 'void'
            order by py.created_at desc limit 1) as payment
  from event_entry en
  join grading_entry ge on ge.entry_id = en.id
  join grade g on g.id = ge.grade_id
  join person p on p.id = en.person_id
  left join organisation c on c.id = en.entered_for_org
  left join person_current_grade cg on cg.person_id = p.id
  where en.event_id = $1 and ($2::uuid is null or en.entered_for_org = $2)
  order by c.name, p.last_name, p.first_name`, [eventId, clubId]);

export const gradings = {
  /** Grading events this organisation may see: its own, and those above it open to its clubs. */
  async list(actor, orgId) {
    await assertRole(actor, orgId, REGISTER);
    const org = await one('select * from organisation where id=$1', [orgId]);
    if (!org) throw new NotFound('Organisation');
    const rows = await q(`
      select e.id, e.title, e.status, ${UTC_ISO('e.starts_at')} as starts_iso, o.name as organiser,
             (e.organisation_id = $1) as own, coalesce(g.fee_cents, 0) as fee_cents,
             to_char(g.finalised_on,'YYYY-MM-DD') as finalised_on,
             (select count(*)::int from event_entry en where en.event_id = e.id and en.status <> 'withdrawn'
                and ($2::boolean is false or en.entered_for_org = $1 or e.organisation_id = $1)) as entered
      from organisation me join organisation o on me.path <@ o.path
      join event e on e.organisation_id = o.id and e.kind = 'grading'
      left join grading_event g on g.event_id = e.id
      where me.id = $1 and e.status in ('published','completed')
        and (e.organisation_id = me.id or e.publish_down)
        and e.starts_at > now() - interval '120 days'
      order by e.starts_at desc`, [orgId, org.type === 'club']);
    return { org, events: rows };
  },

  /** What one grading looks like to one organisation: its entries, who it could enter, and — if it runs it — the results. */
  async get(actor, orgId, eventId) {
    await assertRole(actor, orgId, REGISTER);
    const ev = await gradingEvent(eventId);
    const org = await one('select * from organisation where id=$1', [orgId]);
    const organiser = ev.organisation_id === orgId;
    if (!organiser && !(org.type === 'club' && await clubSeesEvent(orgId, ev))) throw new NotFound('Grading');
    const open = entriesOpen({ ...ev, status: ev.status }, new Date().toISOString().replace(/\.\d+Z$/, 'Z'));

    const entries = await entryRows(eventId, organiser ? null : orgId);
    let candidates = [];
    if (org.type === 'club') {
      const fed = await orgs.ladderOwnerOf(orgId) ?? org;
      const have = new Set(entries.filter((e) => e.status !== 'withdrawn').map((e) => e.person_id));
      const members = await q(`select p.id, p.display_number,
          nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') as name
        from affiliation a join person p on p.id = a.person_id
        where a.organisation_id = $1 and a.ends is null and a.status = 'active' and a.role = 'member'
        order by p.last_name, p.first_name`, [orgId]);
      for (const m of members) {
        if (have.has(m.id)) continue;
        const el = await rank.eligibility(m.id, fed.id);
        candidates.push({ ...m, holds: el.holds ?? null, next: el.next ?? null, eligible: !!el.eligible,
          unmet: el.unmet ?? [el.reason].filter(Boolean) });
      }
    }
    const panelOptions = organiser ? await q(`select p.display_number, nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') as name,
        cg.label as grade from person p join person_current_grade cg on cg.person_id = p.id
        where cg.is_dan order by cg.rank_order desc, p.last_name limit 60`) : [];
    const today = (await one(`select to_char((now() at time zone $1)::date,'YYYY-MM-DD') as d`, [ev.timezone])).d;
    return { org, ev, organiser, open, entries, candidates, panelOptions, today };
  },

  async setFee(actor, eventId, feeCents) {
    const ev = await gradingEvent(eventId);
    await assertRole(actor, ev.organisation_id, REGISTER);
    const n = Math.round(Number(feeCents) * 100);
    if (!Number.isFinite(n) || n < 0 || n > 100_000_00) throw new Invalid('The fee should be a dollar amount like 45 or 45.50.');
    if (ev.finalised_on) throw new Invalid('This grading is finished.');
    await q(`insert into grading_event (event_id, fee_cents) values ($1,$2)
      on conflict (event_id) do update set fee_cents = excluded.fee_cents`, [eventId, n]);
    await q(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
      values ($1,$2,'grading_fee_set','event',$3,$4)`, [actor, ev.organisation_id, eventId, JSON.stringify({ fee_cents: n })]);
  },

  /** A club registrar enters members. Anybody who has not met the syllabus is refused, by name. */
  async enter(actor, clubId, eventId, personIds) {
    await assertRole(actor, clubId, REGISTER);
    const ev = await gradingEvent(eventId);
    const club = await one('select * from organisation where id=$1', [clubId]);
    if (club.type !== 'club' || !(await clubSeesEvent(clubId, ev))) throw new NotFound('Grading');
    const open = entriesOpen(ev, new Date().toISOString().replace(/\.\d+Z$/, 'Z'));
    if (!open.open) throw new Invalid(open.why);
    if (!personIds.length) throw new Invalid('Tick the members to enter.');

    const fed = await orgs.ladderOwnerOf(clubId) ?? club;
    const plan = [];
    for (const id of personIds) {
      const m = await one(`select p.id, nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') as name
        from affiliation a join person p on p.id = a.person_id
        where a.organisation_id = $1 and a.person_id = $2 and a.ends is null and a.status = 'active' and a.role = 'member'`, [clubId, id]);
      if (!m) throw new Invalid('Somebody ticked is not a current member of this club.');
      const el = await rank.eligibility(id, fed.id);
      if (!el.eligible) throw new Invalid(`${m.name} is not ready: ${(el.unmet ?? [el.reason]).join(', ')}.`);
      plan.push({ m, gradeId: el.nextGradeId });
    }
    const gradeRows = await q('select id, label, is_dan from grade where id = any($1::uuid[])', [plan.map((p) => p.gradeId)]);
    const root = await one(`select id from organisation where parent_id is null and $1::ltree <@ path`, [fed.path ?? club.path])
      ?? { id: fed.id };

    const client = await pool.connect();
    try {
      await client.query('begin');
      for (const { m, gradeId } of plan) {
        await assertNoRankingForSupporter(m.id, client);
        const g = gradeRows.find((r) => r.id === gradeId);
        const kind = g.is_dan ? 'dan_grading' : 'kyu_grading';
        const fee = ev.fee_cents;
        const existing = (await client.query(`select id, status from event_entry where event_id=$1 and person_id=$2`, [eventId, m.id])).rows[0];
        let entryId;
        if (existing && existing.status !== 'withdrawn') throw new Invalid(`${m.name} is already entered.`);
        if (existing) {
          entryId = existing.id;
          await client.query(`update event_entry set status='entered', entered_by=$2, entered_for_org=$3, amount_cents=$4, updated_at=now() where id=$1`,
            [entryId, actor, clubId, fee || null]);
          await client.query(`update grading_entry set grade_id=$2, outcome=null, notes=null, record_id=null where entry_id=$1`, [entryId, gradeId]);
        } else {
          entryId = (await client.query(`insert into event_entry (event_id, person_id, entered_by, entered_for_org, amount_cents, status, currency)
            values ($1,$2,$3,$4,$5,'entered',$6) returning id`, [eventId, m.id, actor, clubId, fee || null, region().currency])).rows[0].id;
          await client.query(`insert into grading_entry (entry_id, grade_id) values ($1,$2)`, [entryId, gradeId]);
        }
        if (fee > 0) {
          const payee = payeeFor(kind, { clubId, organiserId: ev.organisation_id, federationId: root.id });
          const { rows: [pay] } = await client.query(`insert into payment (organisation_id, person_id, event_entry_id, amount_cents, currency, status, requested_by)
            values ($1,$2,$3,$4,$6,'pending',$5) returning id`, [payee, m.id, entryId, fee, actor, region().currency]);
          await client.query(`insert into payment_line (payment_id, kind, description, amount_cents, event_entry_id)
            values ($1,$2,$3,$4,$5)`, [pay.id, kind, `${g.label} grading — ${ev.title}`, fee, entryId]);
        }
        await client.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
          values ($1,$2,'grading_entered','event_entry',$3,$4)`, [actor, clubId, entryId, JSON.stringify({ event: ev.title, grade: g.label, fee_cents: fee })]);
      }
      await client.query('commit');
    } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
    return { entered: plan.length };
  },

  async withdraw(actor, orgId, entryId) {
    const e = await one(`select en.id, en.event_id, en.entered_for_org, ev.organisation_id from event_entry en
      join grading_entry ge on ge.entry_id = en.id join event ev on ev.id = en.event_id where en.id=$1`, [entryId]);
    if (!e) throw new NotFound('Entry');
    if (orgId !== e.entered_for_org && orgId !== e.organisation_id) throw new NotFound('Entry');
    await assertRole(actor, orgId, REGISTER);
    const ev = await gradingEvent(e.event_id);
    if (ev.finalised_on) throw new Invalid('This grading is finished.');
    await competition.withdraw(actor, entryId, 'Withdrawn from grading');
  },

  /**
   * The night is over. Record every result, award the passes, number the
   * certificates — in one transaction, so a bad panel or a missing result
   * leaves the register exactly as it was.
   */
  async finalise(actor, eventId, { results, panelNumbers, date }) {
    const ev = await gradingEvent(eventId);
    await assertRole(actor, ev.organisation_id, REGISTER);
    if (ev.finalised_on) throw new Invalid('This grading has already been finalised.');
    const today = (await one(`select to_char((now() at time zone $1)::date,'YYYY-MM-DD') as d`, [ev.timezone])).d;
    const entries = await entryRows(eventId);
    const panel = [];
    const unknown = [];
    for (const n of panelNumbers) {
      const p = await one(`select id from person where upper(display_number) = $1`, [n]);
      if (p) panel.push(p.id); else unknown.push(n);
    }
    if (unknown.length) throw new Invalid(`No member found for ${unknown.join(', ')}.`);
    const problems = problemsWithResults({ entries, results, panel: panelNumbers, date }, today);
    if (problems.length) throw new Invalid(problems.join(' '));
    // A qualification the federation requires of examiners is enforced, not just recorded.
    const unqualified = await qualifications.lacking(panel, 'panel', ev.organisation_id);
    if (unqualified.length) throw new Invalid(`${unqualified.map((u) => `${u.name} (${u.barred.map((b) => `${b.label}: ${b.state === 'missing' ? 'not recorded' : 'expired'}`).join(', ')})`).join('; ')} cannot sit on the panel.`);

    const root = await one(`select r.id, coalesce(r.short_name, r.slug) as prefix from organisation o
      join organisation r on r.parent_id is null and o.path <@ r.path where o.id = $1`, [ev.organisation_id]);
    const client = await pool.connect();
    const awarded = [];
    try {
      await client.query('begin');
      for (const e of entries.filter((x) => x.status !== 'withdrawn')) {
        const { outcome, notes } = results[e.entry_id];
        let recordId = null;
        if (AWARDS.has(outcome)) {
          const rec = await rank.award(actor, { personId: e.person_id, gradeId: e.grade_id, awardedByOrg: ev.organisation_id,
            awardedOn: date, panel, eventId, result: outcome }, client);
          const { rows: [c] } = await client.query(`insert into certificate_counter (federation_id, year, last_number)
            values ($1, $2, 1) on conflict (federation_id, year) do update set last_number = certificate_counter.last_number + 1
            returning last_number`, [root.id, +date.slice(0, 4)]);
          const no = certificateNumber(root.prefix, +date.slice(0, 4), c.last_number);
          await client.query('update grading_record set certificate_no=$2 where id=$1', [rec.id, no]);
          recordId = rec.id;
          awarded.push({ person: e.name, grade: e.grade, certificate: no });
        } else if (outcome === 'fail') {
          recordId = (await client.query(`insert into grading_record (person_id, grade_id, awarded_on, awarded_by_org, event_id, result, panel)
            values ($1,$2,$3,$4,$5,'fail',$6::jsonb) returning id`, [e.person_id, e.grade_id, date, ev.organisation_id, eventId,
            JSON.stringify(panel.map((id) => ({ person_id: id })))])).rows[0].id;
        }
        await client.query(`update grading_entry set outcome=$2, notes=$3, record_id=$4 where entry_id=$1`, [e.entry_id, outcome, notes || null, recordId]);
        await client.query(`update event_entry set status='confirmed', updated_at=now() where id=$1`, [e.entry_id]);
      }
      await client.query(`insert into grading_event (event_id, finalised_on, finalised_by) values ($1,$2,$3)
        on conflict (event_id) do update set finalised_on = excluded.finalised_on, finalised_by = excluded.finalised_by`, [eventId, today, actor]);
      await client.query(`update event set status='completed', updated_at=now() where id=$1`, [eventId]);
      await client.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
        values ($1,$2,'grading_finalised','event',$3,$4)`, [actor, ev.organisation_id, eventId,
        JSON.stringify({ title: ev.title, passed: awarded.length, entered: entries.length })]);
      await client.query('commit');
    } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
    return { awarded };
  },

  /** The certificate for one grading record. For the person, their guardian, or their club's and the organiser's staff. */
  async certificate(actor, personId, recordId) {
    const r = await one(`
      select gr.id, gr.person_id, gr.awarded_on::text as awarded_on, gr.certificate_no, gr.result, gr.panel, gr.awarded_by_org,
             g.label as grade, g.is_dan, p.display_number, nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') as name,
             o.name as awarded_by, e.title as event,
             (select r2.name from organisation r2 where r2.parent_id is null and o.path <@ r2.path) as federation
      from grading_record gr join grade g on g.id = gr.grade_id join person p on p.id = gr.person_id
      join organisation o on o.id = gr.awarded_by_org left join event e on e.id = gr.event_id
      where gr.id = $1 and gr.person_id = $2`, [recordId, personId]);
    if (!r || !r.certificate_no || !['pass', 'provisional'].includes(r.result)) throw new NotFound('Certificate');
    const self = await family.mayActFor(actor, personId);
    if (!self) {
      let ok = (await one('select has_role_at($1,$2,$3) as ok', [actor, r.awarded_by_org, REGISTER]))?.ok;
      if (!ok) for (const h of await homesOf(personId))
        if ((await one('select has_role_at($1,$2,$3) as ok', [actor, h, REGISTER]))?.ok) { ok = true; break; }
      if (!ok) throw new Forbidden();
    }
    const examiners = r.panel?.length ? await q(`select p.display_number, nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') as name, cg.label as grade
      from person p left join person_current_grade cg on cg.person_id = p.id where p.id = any($1::uuid[]) order by cg.rank_order desc nulls last`,
      [r.panel.map((x) => x.person_id)]) : [];
    return { ...r, examiners };
  },
};

export const qualifications = {
  STATE_WORDS, QUAL_CATEGORIES, REQUIRED_FOR,

  /** What this organisation (and the federation above it) requires, plus starters not yet added. */
  async catalogue(actor, orgId) {
    await assertRole(actor, orgId, REGISTER);
    const rows = await q(`select q.id, q.code, q.label, q.category, q.valid_months, q.required_for, a.name as owner,
        (a.id = me.id) as own, (select count(*)::int from qualification_award qa where qa.qualification_id = q.id) as awards
      ${CATALOGUE_FROM} order by q.category, q.label`, [orgId]);
    const have = new Set(rows.map((r) => r.code));
    return { catalogue: rows, starters: STARTERS.filter((s) => !have.has(s.code)) };
  },

  async define(actor, orgId, input) {
    await assertRole(actor, orgId, MANAGE);
    const problems = problemsWithQualification(input);
    if (problems.length) throw new Invalid(problems.join(' '));
    try {
      await q(`insert into qualification (organisation_id, code, label, category, valid_months, required_for)
        values ($1,$2,$3,$4,$5,$6)`, [orgId, input.code, input.label, input.category,
        input.validMonths === '' || input.validMonths == null ? null : Number(input.validMonths), input.requiredFor]);
    } catch (e) {
      if (e.code === '23505') throw new Invalid('There is already a qualification with that name.');
      throw e;
    }
    await q(`insert into audit_log (account_id, organisation_id, action, entity, after)
      values ($1,$2,'qualification_defined','qualification',$3)`, [actor, orgId, JSON.stringify({ label: input.label, requiredFor: input.requiredFor })]);
  },

  async addStarter(actor, orgId, code) {
    const s = STARTERS.find((x) => x.code === code);
    if (!s) throw new NotFound('Qualification');
    return qualifications.define(actor, orgId, { ...s, validMonths: s.validMonths ? String(s.validMonths) : '' });
  },

  async retire(actor, orgId, qualificationId) {
    await assertRole(actor, orgId, MANAGE);
    const row = await one('select label from qualification where id=$1 and organisation_id=$2', [qualificationId, orgId]);
    if (!row) throw new NotFound('Qualification');
    try { await q('delete from qualification where id=$1', [qualificationId]); }
    catch (e) { if (e.code === '23503') throw new Invalid('Somebody holds this qualification, so it cannot be removed.'); throw e; }
    await q(`insert into audit_log (account_id, organisation_id, action, entity, after)
      values ($1,$2,'qualification_removed','qualification',$3)`, [actor, orgId, JSON.stringify({ label: row.label })]);
  },

  /** A person's own record: for them, their guardian, or their club's registrar. */
  async forPerson(actor, personId, { staffOnly = false } = {}) {
    const homes = await homesOf(personId);
    let mayEdit = false;
    for (const h of homes) if ((await one('select has_role_at($1,$2,$3) as ok', [actor, h, REGISTER]))?.ok) { mayEdit = true; break; }
    if (!mayEdit) { if (staffOnly || !(await family.mayActFor(actor, personId))) throw new Forbidden(); }
    const home = homes[0];
    const today = await qualToday(home);
    const awards = describeAwards(await q(`${AWARD_SELECT} where qa.person_id = $1`, [personId]), today);
    const available = home ? (await q(`select q.id, q.label ${CATALOGUE_FROM} order by q.label`, [home])) : [];
    return { awards, available, mayEdit, today };
  },

  async record(actor, personId, input) {
    const homes = await homesOf(personId);
    let home = null;
    for (const h of homes) if ((await one('select has_role_at($1,$2,$3) as ok', [actor, h, REGISTER]))?.ok) { home = h; break; }
    if (!home) throw new Forbidden();
    const today = await qualToday(home);
    const problems = problemsWithAward(input, today);
    if (problems.length) throw new Invalid(problems.join(' '));
    const qual = await one(`select q.id, q.label ${CATALOGUE_FROM} and q.id = $2`, [home, input.qualificationId]);
    if (!qual) throw new Invalid('That qualification is not one this organisation uses.');
    await q(`insert into qualification_award (person_id, qualification_id, awarded_on, expires_on, issued_by_other, reference, recorded_by)
      values ($1,$2,$3,$4,$5,$6,$7)`, [personId, qual.id, input.awardedOn, input.expiresOn || null,
      input.issuedBy || null, input.reference || null, actor]);
    await q(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
      values ($1,$2,'qualification_recorded','person',$3,$4)`, [actor, home, personId,
      JSON.stringify({ qualification: qual.label, awarded_on: input.awardedOn, expires_on: input.expiresOn || 'by default' })]);
    return { qualification: qual.label };
  },

  async removeAward(actor, personId, awardId) {
    const homes = await homesOf(personId);
    let home = null;
    for (const h of homes) if ((await one('select has_role_at($1,$2,$3) as ok', [actor, h, REGISTER]))?.ok) { home = h; break; }
    if (!home) throw new Forbidden();
    const row = await one(`select q.label from qualification_award qa join qualification q on q.id = qa.qualification_id
      where qa.id=$1 and qa.person_id=$2`, [awardId, personId]);
    if (!row) throw new NotFound('Record');
    await q('delete from qualification_award where id=$1', [awardId]);
    await q(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
      values ($1,$2,'qualification_deleted','person',$3,$4)`, [actor, home, personId, JSON.stringify({ qualification: row.label })]);
  },

  /**
   * Who may not instruct right now, and what is about to lapse — for a club,
   * or for everybody beneath a federation or region.
   */
  async compliance(actor, orgId) {
    await assertRole(actor, orgId, REGISTER);
    return complianceData(orgId);
  },

  async setReminders(actor, orgId, enabled) {
    await assertRole(actor, orgId, MANAGE);
    const org = await one('select type from organisation where id=$1', [orgId]);
    if (org?.type !== 'club') throw new Invalid('Reminders are set by each club.');
    await q(`update organisation set settings = coalesce(settings,'{}'::jsonb) || jsonb_build_object('reminders',
      coalesce(settings->'reminders','{}'::jsonb) || jsonb_build_object('qualifications', $2::boolean)), updated_at = now() where id = $1`, [orgId, !!enabled]);
    await q(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
      values ($1,$2,'qualification_reminders_setting','organisation',$2,$3)`, [actor, orgId, JSON.stringify({ enabled: !!enabled })]);
  },

  /** Does everybody named hold every qualification this organisation requires for `gate`? Returns who does not. */
  async lacking(personIds, gate, orgId) {
    if (!personIds.length) return [];
    const today = await qualToday(orgId);
    const required = await q(`select q.id, q.label ${CATALOGUE_FROM} and $2 = any(q.required_for)`, [orgId, gate]);
    if (!required.length) return [];
    const awards = await q(`${AWARD_SELECT} where qa.person_id = any($1::uuid[])`, [personIds]);
    const names = await q(`select id, nullif(trim(concat_ws(' ', first_name, last_name)), '') as name from person where id = any($1::uuid[])`, [personIds]);
    return personIds.map((id) => ({ id, name: names.find((n) => n.id === id)?.name ?? 'Somebody',
      ...clearance(required, awards.filter((a) => a.person_id === id), today) })).filter((r) => !r.cleared);
  },

  /**
   * The daily run: tell people (and their club's administrators) when a
   * qualification is about to lapse or has. Opt-in per club. Each award is
   * reminded about once per stage, whatever the number of runs.
   */
  async remind({ messenger, origin, baseFrom, budgetMs = 9000 }) {
    const started = Date.now();
    const clubs = await q(`select id, name, slug from organisation where type='club' and status='active'
      and (settings->'reminders'->>'qualifications')::boolean is true order by name`);
    const report = [];
    for (const club of clubs) {
      const line = { club: club.slug, written: 0, skipped: null };
      try {
        const today = await qualToday(club.id);
        const awards = await q(`select qa.id, qa.person_id, qa.qualification_id, to_char(qa.awarded_on,'YYYY-MM-DD') as awarded_on,
            to_char(qa.expires_on,'YYYY-MM-DD') as expires_on, q.label
          from affiliation a join qualification_award qa on qa.person_id = a.person_id
          join qualification q on q.id = qa.qualification_id
          where a.organisation_id = $1 and a.ends is null and a.status = 'active'`, [club.id]);
        const done = new Set((await q(`select award_id || '|' || stage as k from qualification_reminder
          where award_id = any($1::uuid[])`, [awards.map((a) => a.id)])).map((r) => r.k));
        const latest = latestPerQualification(awards);
        const due = remindersDue(latest, today, done).slice(0, 100);
        const digest = [];
        for (const d of due) {
          if (Date.now() - started > budgetMs) break;
          const a = latest.find((x) => x.id === d.awardId);
          const text = qualReminderText(d.stage, { label: a.label, expiresOn: a.expires_on });
          const made = await messages.prepare(null, club.id, { audience: 'selected', kind: 'renewal', personIds: [a.person_id],
            subject: text.subject, body: text.body, eventId: null, personNumber: null }, { baseFrom, trusted: true });
          line.written += made.recipients;
          await messages.sendBatch(null, club.id, made.message.id, { messenger, origin, trusted: true,
            budgetMs: Math.max(1000, budgetMs - (Date.now() - started)) });
          await q(`insert into qualification_reminder (award_id, stage, sent_on) values ($1,$2,$3::date) on conflict do nothing`, [a.id, d.stage, today]);
          digest.push({ person: a.person_id, label: a.label, stage: d.stage, expires_on: a.expires_on });
        }
        if (digest.length) {
          const names = await q(`select id, nullif(trim(concat_ws(' ', first_name, last_name)), '') as name from person where id = any($1::uuid[])`,
            [digest.map((x) => x.person)]);
          const staff = await q(`select distinct acc.person_id from grant_role gr join account acc on acc.id = gr.account_id
            where gr.organisation_id = $1 and gr.role in ('owner','administrator','registrar') and acc.person_id is not null`, [club.id]);
          if (staff.length) {
            const lines = digest.map((x) => `- ${names.find((n) => n.id === x.person)?.name ?? 'Somebody'}: ${x.label} ${x.stage === 'expired' ? 'ran out' : 'runs out'} ${x.expires_on}`);
            const made = await messages.prepare(null, club.id, { audience: 'selected', kind: 'renewal', personIds: staff.map((s) => s.person_id),
              subject: `Qualifications to renew at ${club.name}`, body: `Kia ora,\n\nThese qualifications need attention:\n\n${lines.join('\n')}\n\nRecord the renewed ones under Compliance.\n\n{club}`,
              eventId: null, personNumber: null }, { baseFrom, trusted: true });
            await messages.sendBatch(null, club.id, made.message.id, { messenger, origin, trusted: true,
              budgetMs: Math.max(1000, budgetMs - (Date.now() - started)) });
          }
        }
      } catch (e) { line.skipped = String(e.message ?? e).slice(0, 200); }
      report.push(line);
    }
    return report;
  },
};
