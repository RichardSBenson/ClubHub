/**
 * HONBU — data access: events
 *
 * Part of the data layer (see ../data.mjs). Every function that touches an organisation takes an `actor` and
 * checks permission in SQL, not in the caller.
 */

import { pool } from '../../infrastructure/postgres/pool.mjs';
import { DEFAULT_TIMEZONE } from '../../core/domain/defaults.mjs';
import { region, eventTypes } from '../../infrastructure/region-context.mjs';
import { normaliseGender } from '../../core/domain/people.mjs';
import { readType, problemsWithDetail } from '../../core/domain/event-types.mjs';
import { MANAGE, REGISTER, TEACH } from '../../core/domain/access.mjs';
import { family } from './people.mjs';
import { Invalid, NotFound, assertRole, one, q } from './shared.mjs';
import { ENTERABLE_KINDS } from './visitors.mjs';

// ---------------------------------------------------------------------------
// events
// ---------------------------------------------------------------------------

export const events = {
  /**
   * What shows on one organisation's page: its own events, plus anything an
   * ancestor published downward. Never a sibling's.
   */
  async forOrg(orgSlug, { viewerRankOrder = null, isMember = false } = {}) {
    return q(`
      select e.id, e.title, e.slug, e.kind, e.summary, e.starts_at, e.ends_at,
             e.venue_name, e.visibility, e.min_rank_order, e.entries_close,
             o.name as from_org, o.slug as from_slug,
             (o.id = target.id) as is_own
      from organisation target
      join organisation o on target.path <@ o.path
      join event e on e.organisation_id = o.id
      where target.slug = $1
        and e.status = 'published'
        and (e.organisation_id = target.id or e.publish_down)
        and (
          e.visibility = 'public'
          or (e.visibility = 'members' and $2::boolean)
          or (e.visibility = 'own_org' and e.organisation_id = target.id
              and $2::boolean)
          or (e.visibility = 'by_grade' and $3::smallint is not null
              and $3::smallint >= coalesce(e.min_rank_order, 0))
        )
      order by e.starts_at`, [orgSlug, isMember, viewerRankOrder]);
  },

  /** Events beneath this organisation that are waiting on its decision. */
  async awaitingDecision(actor, orgId) {
    await assertRole(actor, orgId, MANAGE);
    const { rows } = await pool.query(`
      select e.id, e.title, e.kind, e.summary, e.starts_at, e.venue_name,
             o.name as from_org, o.slug as from_slug
      from event e
      join organisation o on o.id = e.organisation_id
      join organisation root on root.id = $1 and o.path <@ root.path
      where e.publish_up_state = 'requested' and e.status = 'published'
        and o.id <> $1
      order by e.starts_at`, [orgId]);
    return rows;
  },

  /**
   * A dojo asks for its event to appear on the parent calendar.
   *
   * Same rule as an article: it has to be live on the dojo's own calendar
   * first, because what is being asked for is the federation's endorsement of
   * something that already exists, not a place to draft it.
   */
  async requestPublishUp(actor, eventId) {
    const ev = await one('select * from event where id = $1', [eventId]);
    if (!ev) throw new NotFound('Event');
    await assertRole(actor, ev.organisation_id, MANAGE);
    if (ev.visibility === 'own_org')
      throw new Invalid('A dojo-only event cannot be published upward');
    if (ev.status !== 'published')
      throw new Invalid('Publish it on your own calendar before asking for it to '
        + 'appear on the federation\'s.');
    const up = await one(`select 1 from organisation where id = $1 and parent_id is not null`,
      [ev.organisation_id]);
    if (!up) throw new Invalid('There is no federation above this organisation to ask.');
    const row = await one(`
      update event set publish_up = true, publish_up_state = 'requested'
      where id = $1 returning *`, [eventId]);
    await pool.query(`
      insert into audit_log (account_id, organisation_id, action, entity,
                             entity_id, before, after)
      values ($1,$2,'event_publish_up_asked','event',$3,$4,$5)`,
      [actor, ev.organisation_id, eventId,
       JSON.stringify({ publish_up_state: ev.publish_up_state }),
       JSON.stringify({ publish_up_state: 'requested', title: ev.title })]);
    return row;
  },

  /**
   * The federation decides.
   *
   * Declining leaves the event on the dojo's own calendar and page; what is
   * refused is a place on the federation's.
   */
  async decidePublishUp(actor, eventId, approve, { decidedBy = null } = {}) {
    const ev = await one(`
      select e.*, o.parent_id from event e
      join organisation o on o.id = e.organisation_id where e.id = $1`, [eventId]);
    if (!ev) throw new NotFound('Event');
    if (!ev.parent_id) throw new Invalid('No parent organisation');
    const by = decidedBy ?? ev.parent_id;
    await assertRole(actor, by, MANAGE);

    // Strictly above the event's own organisation, or a dojo would approve
    // itself.
    const beneath = await one(`
      select 1 from organisation mine, organisation theirs
      where mine.id = $1 and theirs.id = $2
        and theirs.path <@ mine.path and theirs.id <> mine.id`,
      [by, ev.organisation_id]);
    if (!beneath)
      throw new Invalid('That event does not sit beneath this organisation.');
    if (ev.publish_up_state !== 'requested')
      throw new Invalid('Nobody is asking for that event to be listed.');

    const row = await one(`
      update event set publish_up_state = $2, publish_up = $3
      where id = $1 returning *`,
      [eventId, approve ? 'approved' : 'declined', approve]);
    await pool.query(`
      insert into audit_log (account_id, organisation_id, action, entity,
                             entity_id, before, after)
      values ($1,$2,'event_publish_up','event',$3,$4,$5)`,
      [actor, by, eventId,
       JSON.stringify({ publish_up_state: ev.publish_up_state }),
       JSON.stringify({ publish_up_state: row.publish_up_state, title: row.title })]);
    return row;
  },

  /** Can this person enter? Grade, age and membership all checked. */
  async canEnter(eventId, personId) {
    const row = await one(`
      select e.title, e.visibility, e.min_rank_order, e.max_rank_order,
             e.min_age, e.max_age, e.entries_close,
             cg.rank_order, cg.label as grade,
             date_part('year', age(p.date_of_birth))::int as age,
             exists(select 1 from affiliation a
                    where a.person_id = p.id and a.ends is null
                      and a.status = 'active') as is_member
      from event e
      cross join person p
      left join person_current_grade cg on cg.person_id = p.id
      where e.id = $1 and p.id = $2`, [eventId, personId]);
    if (!row) throw new NotFound('Event or person');

    const blocked = [];
    if (row.entries_close && new Date(row.entries_close) < new Date())
      blocked.push('Entries have closed');
    if (row.visibility !== 'public' && !row.is_member)
      blocked.push('Members only');
    if (row.min_rank_order && (row.rank_order ?? 0) < row.min_rank_order)
      blocked.push(`Requires a higher grade — holds ${row.grade ?? 'none'}`);
    if (row.max_rank_order && (row.rank_order ?? 0) > row.max_rank_order)
      blocked.push('Above the grade limit for this event');
    if (row.min_age && row.age < row.min_age) blocked.push(`Minimum age ${row.min_age}`);
    if (row.max_age && row.age > row.max_age) blocked.push(`Maximum age ${row.max_age}`);

    return { event: row.title, canEnter: blocked.length === 0, blocked };
  },
};

// ---------------------------------------------------------------------------
// money
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// competition
//
// The queries behind the entry engine. The RULES are in
// core/domain/competition.mjs and none of them are here: this reads the
// organiser's configuration out and writes entries back, and would give the
// same answers if the tournament were BJJ.
// ---------------------------------------------------------------------------

export const competition = {
  /** An event's disciplines with their divisions, ready for the engine. */
  async setupFor(eventId) {
    const disciplines = await q(`
      select * from event_discipline where event_id = $1
      order by sort_order, name`, [eventId]);

    const divisions = await q(`
      select d.* from event_division d
      join event_discipline ed on ed.id = d.discipline_id
      where ed.event_id = $1
      order by d.sort_order, d.label`, [eventId]);

    const prices = await q(`
      select * from entry_price where event_id = $1 order by for_count`,
      [eventId]);

    const byDiscipline = {};
    for (const d of disciplines) byDiscipline[d.id] = [];
    for (const d of divisions) (byDiscipline[d.discipline_id] ??= []).push(d);

    return { disciplines, divisions, byDiscipline, prices };
  },

  async addDiscipline(actor, eventId, { name, summary = null, sortOrder = 0 }) {
    const ev = await one('select organisation_id from event where id = $1', [eventId]);
    if (!ev) throw new NotFound('Event');
    await assertRole(actor, ev.organisation_id, REGISTER);
    if (!String(name ?? '').trim()) throw new Invalid('A discipline needs a name');

    return one(`
      insert into event_discipline (event_id, name, summary, sort_order)
      values ($1,$2,$3,$4)
      on conflict (event_id, name) do update set
        summary = excluded.summary, sort_order = excluded.sort_order
      returning *`, [eventId, name.trim(), summary || null, sortOrder]);
  },

  async addDivision(actor, disciplineId, fields = {}) {
    const d = await one(`
      select e.organisation_id from event_discipline ed
      join event e on e.id = ed.event_id where ed.id = $1`, [disciplineId]);
    if (!d) throw new NotFound('Discipline');
    await assertRole(actor, d.organisation_id, REGISTER);
    if (!String(fields.label ?? '').trim())
      throw new Invalid('A division needs a label');

    return one(`
      insert into event_division (discipline_id, label, summary,
        min_rank_order, max_rank_order, min_age, max_age,
        min_weight_kg, max_weight_kg, gender,
        min_years_training, max_years_training,
        min_prior_events, max_prior_events, options, sort_order, capacity)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17)
      on conflict (discipline_id, label) do update set
        summary = excluded.summary,
        min_rank_order = excluded.min_rank_order,
        max_rank_order = excluded.max_rank_order,
        min_age = excluded.min_age, max_age = excluded.max_age,
        min_weight_kg = excluded.min_weight_kg,
        max_weight_kg = excluded.max_weight_kg,
        gender = excluded.gender,
        min_years_training = excluded.min_years_training,
        max_years_training = excluded.max_years_training,
        min_prior_events = excluded.min_prior_events,
        max_prior_events = excluded.max_prior_events,
        options = excluded.options, sort_order = excluded.sort_order,
        capacity = excluded.capacity
      returning *`,
      [disciplineId, fields.label.trim(), fields.summary || null,
       blank(fields.minRankOrder), blank(fields.maxRankOrder),
       blank(fields.minAge), blank(fields.maxAge),
       blank(fields.minWeightKg), blank(fields.maxWeightKg),
       divisionGender(fields.gender),
       blank(fields.minYearsTraining), blank(fields.maxYearsTraining),
       blank(fields.minPriorEvents), blank(fields.maxPriorEvents),
       JSON.stringify(fields.options ?? {}),
       fields.sortOrder ?? 0, blank(fields.capacity)]);
  },

  async setPrice(actor, eventId, { forCount, amountCents, membersOnly = false,
                                   label = null }) {
    const ev = await one('select organisation_id from event where id = $1', [eventId]);
    if (!ev) throw new NotFound('Event');
    await assertRole(actor, ev.organisation_id, REGISTER);
    return one(`
      insert into entry_price (event_id, for_count, amount_cents, members_only, label, currency)
      values ($1,$2,$3,$4,$5,$6)
      on conflict (event_id, for_count, members_only) do update set
        amount_cents = excluded.amount_cents, label = excluded.label
      returning *`, [eventId, forCount, amountCents, membersOnly, label, region().currency]);
  },

  /**
   * Who is already entered, with the division each one landed in.
   *
   * The unplaced come back too, and deliberately first: "If no match
   * available, your instructor will be advised" is printed on the form, so an
   * entry list that quietly omits them is the one thing it must not do.
   */
  async entriesFor(actor, eventId) {
    const ev = await one('select organisation_id from event where id = $1', [eventId]);
    if (!ev) throw new NotFound('Event');
    await assertRole(actor, ev.organisation_id, TEACH);

    const entries = await q(`
      select e.*, p.first_name, p.last_name, p.display_number, p.date_of_birth,
             p.gender as person_gender, o.name as entered_for,
             cg.label as grade, cg.rank_order,
             (select count(*)::int from entry_consent c where c.entry_id = e.id)
               as consents,
             (select c.guardian from entry_consent c where c.entry_id = e.id
               order by c.accepted_at desc limit 1) as consent_guardian
      from event_entry e
      left join person p on p.id = e.person_id
      left join organisation o on o.id = e.entered_for_org
      left join person_current_grade cg on cg.person_id = p.id
      where e.event_id = $1
      order by p.last_name, p.first_name`, [eventId]);

    const selections = await q(`
      select s.*, ed.name as discipline, dv.label as division
      from entry_selection s
      join event_discipline ed on ed.id = s.discipline_id
      left join event_division dv on dv.id = s.division_id
      join event_entry e on e.id = s.entry_id
      where e.event_id = $1
      order by ed.sort_order, ed.name`, [eventId]);

    const byEntry = {};
    for (const s of selections) (byEntry[s.entry_id] ??= []).push(s);

    return entries.map((e) => ({ ...e, selections: byEntry[e.id] ?? [] }));
  },

  /**
   * Enter one competitor, with everything they are entering.
   *
   * One transaction: an entry whose selections half-wrote is a competitor who
   * turns up expecting to fight in two divisions and is in the draw for one.
   *
   * `placements` comes from the engine and is written as given — this does not
   * re-decide anything. Where the organiser has moved somebody by hand, the
   * placement arrives marked 'assigned' and stays that way.
   */
  async enterCompetitor(actor, eventId, {
    personId = null, guest = null, enteredForOrg = null,
    weightKg = null, heightCm = null, yearsTraining = null, priorEvents = null,
    declaredGrade = null, clubName = null, placements = [],
    amountCents = null, currency = region().currency, consent = null, notes = null,
    byFamily = false, allowNoPlacements = false,
  }) {
    const ev = await one('select organisation_id from event where id = $1', [eventId]);
    if (!ev) throw new NotFound('Event');
    if (byFamily) {
      // A member, or the parent of a minor, entering somebody they are
      // entitled to act for. The right is the family link, not a role at any
      // organisation, and the event must be one that is open to that person.
      if (!personId) throw new Invalid('An entry needs a person');
      await family.assertMayActFor(actor, personId);
      const open = await memberEvents.get(personId, eventId);
      if (!open) throw new NotFound('Event');
      enteredForOrg = open.home_org;
    } else {
      // A club enters its own people, so the role is checked where they are
      // being entered FROM, not at the host organisation — a dojo sensei has no
      // grant at the federation running the tournament.
      await assertRole(actor, enteredForOrg ?? ev.organisation_id, REGISTER);
    }

    if (!personId && !guest)
      throw new Invalid('An entry needs either a person or a guest');
    // An event with no disciplines (a grading, a seminar) is entered by turning
    // up, so there is nothing to place. A competition with disciplines still
    // needs at least one chosen.
    if (!placements.length && !(allowNoPlacements))
      throw new Invalid('Nothing has been entered');

    const client = await pool.connect();
    try {
      await client.query('begin');

      const { rows: [entry] } = await client.query(`
        insert into event_entry (event_id, person_id, guest, entered_by,
          entered_for_org, weight_kg, height_cm, years_training, prior_events,
          declared_grade, club_name, amount_cents, currency, notes, status)
        values ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'entered')
        returning *`,
        [eventId, personId, guest ? JSON.stringify(guest) : null, actor,
         enteredForOrg, weightKg, heightCm, yearsTraining, priorEvents,
         declaredGrade, clubName, amountCents, currency, notes]);

      for (const p of placements) {
        await client.query(`
          insert into entry_selection (entry_id, discipline_id, division_id,
            placed_by, placed_note, options)
          values ($1,$2,$3,$4,$5,$6::jsonb)`,
          [entry.id, p.disciplineId, p.divisionId ?? null,
           p.placedBy ?? 'calculated', p.note ?? null,
           JSON.stringify(p.options ?? {})]);
      }

      if (consent) {
        await client.query(`
          insert into entry_consent (entry_id, version, document_hash,
            accepted_name, accepted_by, accepted_ip, guardian)
          values ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
          [entry.id, consent.version, consent.documentHash ?? null,
           consent.acceptedName, actor, consent.ip ?? null,
           consent.guardian ? JSON.stringify(consent.guardian) : null]);
      }

      // An entry with a fee is a payment waiting to be made, to whoever runs
      // the event. The entry exists whether or not it is ever paid.
      if (personId && amountCents > 0) {
        const title = (await client.query('select title from event where id=$1', [eventId])).rows[0]?.title;
        const { rows: [pay] } = await client.query(`
          insert into payment (organisation_id, person_id, event_entry_id, amount_cents,
                               currency, status, requested_by)
          values ($1,$2,$3,$4,$5,'pending',$6) returning id`,
          [ev.organisation_id, personId, entry.id, amountCents, currency, actor]);
        await client.query(`
          insert into payment_line (payment_id, kind, description, amount_cents, event_entry_id)
          values ($1,'tournament_entry',$2,$3,$4)`,
          [pay.id, `Entry — ${title ?? 'event'}`, amountCents, entry.id]);
      }

      await client.query(`
        insert into audit_log (account_id, organisation_id, action, entity,
                               entity_id, after)
        values ($1,$2,'enter','event_entry',$3,$4::jsonb)`,
        [actor, enteredForOrg ?? ev.organisation_id, entry.id,
         JSON.stringify({ personId, placements: placements.length, amountCents })]);

      await client.query('commit');
      return entry;
    } catch (e) {
      await client.query('rollback');
      // The unique index, in words somebody can act on.
      if (e.code === '23505' && String(e.constraint ?? '').includes('one_per_person'))
        throw new Invalid('That person is already entered in this event');
      throw e;
    } finally { client.release(); }
  },

  /**
   * Move somebody to a different division.
   *
   * "ALL divisions subject to change" is printed on the form. A placement
   * moved by hand is marked 'assigned' so that nothing recalculates it back —
   * the organiser looked at two competitors and made a judgement the rules
   * could not.
   */
  async assignDivision(actor, selectionId, divisionId, note = null) {
    const s = await one(`
      select e.organisation_id from entry_selection s
      join event_entry en on en.id = s.entry_id
      join event e on e.id = en.event_id
      where s.id = $1`, [selectionId]);
    if (!s) throw new NotFound('Entry');
    await assertRole(actor, s.organisation_id, REGISTER);

    return one(`
      update entry_selection
         set division_id = $2, placed_by = 'assigned', placed_note = $3
       where id = $1 returning *`, [selectionId, divisionId || null, note]);
  },

  async withdraw(actor, entryId, reason = null) {
    const e = await one(`
      select ev.organisation_id, en.entered_for_org from event_entry en
      join event ev on ev.id = en.event_id where en.id = $1`, [entryId]);
    if (!e) throw new NotFound('Entry');
    await assertRole(actor, e.entered_for_org ?? e.organisation_id, REGISTER);
    // Withdrawn, not deleted: they paid, and a federation has to be able to
    // say somebody pulled out rather than that they never entered. A payment
    // not yet made is cancelled; one already made is left for the organiser to
    // refund, because that is their money and their decision.
    await pool.query(`update payment set status='void', updated_at=now()
      where event_entry_id = $1 and status in ('pending','failed')`, [entryId]);
    return one(`
      update event_entry set status = 'withdrawn', notes = coalesce($2, notes),
             updated_at = now()
       where id = $1 returning *`, [entryId, reason]);
  },
};

const blank = (v) => (v === '' || v === undefined ? null : v);

const divisionGender = (g) => {
  const n = normaliseGender(g);
  if (n === undefined) throw new Invalid('A division is for M or F, or left blank for any.');
  return n;
};

async function memberEventsQuery(personId, eventId = null) {
    const { rows } = await pool.query(`
      select e.id, e.title, e.slug, e.kind, e.summary, e.starts_at, e.venue_name,
             e.entries_open, e.entries_close, e.visibility, e.organisation_id as host_id,
             o.name as host_name, o.timezone as host_timezone,
             club.id as home_org, club.name as home_name,
             exists (select 1 from event_entry x
                      where x.event_id = e.id and x.person_id = $1
                        and x.status in ('entered','confirmed')) as already_entered
      from affiliation a
      join organisation club on club.id = a.organisation_id
      join organisation o on club.path <@ o.path
      join event e on e.organisation_id = o.id
      left join person_current_grade g on g.person_id = a.person_id
      where a.person_id = $1 and a.ends is null and a.role = 'member'
        and a.status = 'active'
        and e.status = 'published'
        and (e.organisation_id = club.id or e.publish_down)
        and e.kind = any($3::event_kind[])
        and e.starts_at > now()
        and (e.entries_open is null or e.entries_open <= now())
        and (e.entries_close is null or e.entries_close > now())
        and (e.visibility in ('public','members')
             or (e.visibility = 'own_org' and e.organisation_id = club.id)
             or (e.visibility = 'by_grade'
                 and coalesce(g.rank_order, -1) >= coalesce(e.min_rank_order, 0)))
        -- Anybody may SEE a public event; the grade limits decide who may ENTER it (a black belt seminar).
        and (e.min_rank_order is null or coalesce(g.rank_order, 0) >= e.min_rank_order)
        and (e.max_rank_order is null or coalesce(g.rank_order, 0) <= e.max_rank_order)
        and ($2::uuid is null or e.id = $2)
      order by e.starts_at`, [personId, eventId, ENTERABLE_KINDS]);

    // Somebody on no roll at all may enter an event its organiser has opened to
    // outsiders. A member is not offered these here: theirs come through their club.
    const { rows: open } = await pool.query(`
      select e.id, e.title, e.slug, e.kind, e.summary, e.starts_at, e.venue_name,
             e.entries_open, e.entries_close, e.visibility, e.organisation_id as host_id,
             o.name as host_name, o.timezone as host_timezone,
             null::uuid as home_org, null::text as home_name,
             exists (select 1 from event_entry x
                      where x.event_id = e.id and x.person_id = $1
                        and x.status in ('entered','confirmed')) as already_entered
      from event e join organisation o on o.id = e.organisation_id
      where e.status = 'published' and e.guests_allowed and e.visibility = 'public'
        and e.kind = any($3::event_kind[])
        and e.starts_at > now()
        and (e.entries_open is null or e.entries_open <= now())
        and (e.entries_close is null or e.entries_close > now())
        and not exists (select 1 from affiliation a where a.person_id = $1 and a.ends is null
                         and a.role = 'member' and a.status = 'active')
        and ($2::uuid is null or e.id = $2)
      order by e.starts_at`, [personId, eventId, ENTERABLE_KINDS]);
    return [...rows, ...open].sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
}

export const memberEvents = {
  /** What is open to this person to enter, and not already entered. */
  async openFor(personId) {
    return (await memberEventsQuery(personId)).filter((e) => !e.already_entered);
  },

  /** One event, if it is open to this person. */
  async get(personId, eventId) {
    return (await memberEventsQuery(personId, eventId))[0] ?? null;
  },

  /**
   * What this person gave the last time they entered something with a weight,
   * for reuse. Only what they TOLD us; age, grade and experience are never
   * stored for reuse, they are worked out each time.
   */
  async lastEntry(personId) {
    const row = await one(`
      select x.weight_kg::float8 as weight_kg, x.height_cm, x.club_name, x.declared_grade,
             to_char(x.created_at at time zone $2,'YYYY-MM-DD') as entered_on,
             coalesce((select json_agg(json_build_object('discipline', d.name, 'division', v.label) order by d.sort_order)
                         from entry_selection s join event_discipline d on d.id = s.discipline_id
                         left join event_division v on v.id = s.division_id
                        where s.entry_id = x.id), '[]'::json) as picks
      from event_entry x
      where x.person_id = $1 and x.status in ('entered','confirmed') and x.weight_kg is not null
      order by x.created_at desc limit 1`, [personId, DEFAULT_TIMEZONE]);
    return row ? { weightKg: row.weight_kg, heightCm: row.height_cm, enteredOn: row.entered_on, picks: row.picks,
      clubName: row.club_name, declaredGrade: row.declared_grade } : null;
  },

  /** Experience, derived from the record rather than asked: past fights and years on the roll. */
  async experience(personId) {
    const row = await one(`
      select (select count(*)::int from event_entry x join event e on e.id = x.event_id
               where x.person_id = $1 and x.status in ('entered','confirmed')
                 and e.kind in ('tournament','fight_night') and e.starts_at < now()) as prior_events,
             (select floor(extract(year from age(now(), min(a.starts))))::int
                from affiliation a where a.person_id = $1 and a.role = 'member') as years_training`, [personId]);
    return { priorEvents: row?.prior_events ?? 0, yearsTraining: row?.years_training ?? null };
  },

  /** What they have already entered. */
  async entriesOf(personId) {
    const { rows } = await pool.query(`
      select x.id, x.status, x.amount_cents, x.currency, e.title, e.starts_at,
             e.kind, e.venue_name, o.name as host_name, o.timezone as host_timezone
      from event_entry x join event e on e.id = x.event_id
      join organisation o on o.id = e.organisation_id
      where x.person_id = $1 and x.status in ('entered','confirmed')
      order by e.starts_at`, [personId]);
    return rows;
  },
};

export const eventDetails = {
  async forEvent(eventId) {
    return one(`select type_key, contact_name, contact_email, contact_phone, cost_note, info_url, description,
      latitude::float as latitude, longitude::float as longitude from event_detail where event_id = $1`, [eventId]);
  },

  /** Read the extra fields off a submitted form; says what is wrong with them. */
  read(form) {
    const t = (k) => (String(form[k] ?? '').trim() || null);
    const n = (k) => { const v = t(k); return v == null ? null : Number(v); };
    const d = { typeKey: readType(form.eventType, eventTypes()), contactName: t('contactName'), contactEmail: t('contactEmail'),
      contactPhone: t('contactPhone'), costNote: t('costNote'), infoUrl: t('infoUrl'),
      description: (String(form.description ?? '').replace(/\r\n?/g, '\n').trim() || null),
      latitude: n('latitude'), longitude: n('longitude') };
    if ((d.latitude != null && Number.isNaN(d.latitude)) || (d.longitude != null && Number.isNaN(d.longitude)))
      return { d, problems: ['Latitude and longitude must be numbers, such as -39.93 and 175.05.'] };
    return { d, problems: problemsWithDetail(d) };
  },

  /** Written after the event itself is saved, by whoever was allowed to save it. */
  async save(eventId, d) {
    const empty = Object.values(d).every((v) => v == null);
    if (empty) { await pool.query('delete from event_detail where event_id = $1', [eventId]); return; }
    await pool.query(`insert into event_detail (event_id, type_key, contact_name, contact_email, contact_phone, cost_note, info_url, latitude, longitude, description)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      on conflict (event_id) do update set type_key=$2, contact_name=$3, contact_email=$4, contact_phone=$5,
        cost_note=$6, info_url=$7, latitude=$8, longitude=$9, description=$10`,
      [eventId, d.typeKey, d.contactName, d.contactEmail, d.contactPhone, d.costNote, d.infoUrl, d.latitude, d.longitude, d.description]);
  },
};
