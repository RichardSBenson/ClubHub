/**
 * HONBU — data access: attendance
 *
 * Part of the data layer (see ../data.mjs). Every function that touches an organisation takes an `actor` and
 * checks permission in SQL, not in the caller.
 */

import { pool } from '../../infrastructure/postgres/pool.mjs';
import { problemsWithSheet, classesOn, notSeenSince, perWeek, isDate } from '../../core/domain/attendance.mjs';
import { cardValidThrough, cardRefusal, verdictFor, checkinPlan } from '../../core/domain/card.mjs';
import { signCard, readCard, signCheckin, readCheckin, CARD_DAYS } from '../card-token.mjs';
import { mayAttend } from '../../core/domain/portal.mjs';
import { bookableDates, placeFor, problemWithBooking, placesFree, nextInQueue, queuePosition, readCapacity, BOOK_DAYS_AHEAD } from '../../core/domain/booking.mjs';
import { REGISTER, TEACH } from '../../core/domain/access.mjs';
import { messages, push, webhooks } from './messaging.mjs';
import { clubs } from './organisations.mjs';
import { family, people } from './people.mjs';
import { Invalid, NotFound, ageOnDate, assertRole, attendanceClub, clubOnly, localNow, one, q, todayAt } from './shared.mjs';

export const attendance = {
  /** The classes that run on a day, how many came, and who has not been seen lately. */
  async overview(actor, orgId, { date = null, days = 30 } = {}) {
    await assertRole(actor, orgId, TEACH);
    const org = await attendanceClub(orgId);
    const today = await todayAt(org);
    const day = date && isDate(date) ? date : today;

    const sessions = await q(`select id, label, weekday, to_char(starts,'HH24:MI') as starts,
        to_char(ends,'HH24:MI') as ends from training_session
      where organisation_id = $1 order by sort_order, weekday, starts`, [orgId]);
    const counts = await q(`select session_id, count(*)::int as n from attendance
      where organisation_id = $1 and session_date = $2::date group by session_id`, [orgId, day]);
    const classes = classesOn(sessions, day).map((s) => ({
      ...s, came: counts.find((c) => c.session_id === s.id)?.n ?? null }));

    const members = await q(`
      select p.id as person_id, p.display_number,
             nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') as name,
             to_char(a.starts, 'YYYY-MM-DD') as joined,
             (select to_char(max(t.session_date), 'YYYY-MM-DD') from attendance t
               where t.person_id = p.id) as last_seen,
             (select count(*)::int from attendance t where t.person_id = p.id
                and t.organisation_id = $1 and t.session_date > ($2::date - $3::int)) as recent
      from affiliation a join person p on p.id = a.person_id
      where a.organisation_id = $1 and a.ends is null and a.status = 'active'
        and a.role in ('member','instructor','assistant')
      order by p.last_name, p.first_name`, [orgId, today, days]);

    const totals = await one(`select count(*)::int as sessions,
        count(distinct person_id)::int as people from attendance
      where organisation_id = $1 and session_date > ($2::date - $3::int)`, [orgId, today, days]);
    return { org, today, day, classes, hasTimetable: sessions.length > 0,
      notSeen: notSeenSince(members, today, days),
      busiest: [...members].sort((a, b) => b.recent - a.recent).slice(0, 5).filter((m) => m.recent > 0),
      days, totals: { ...totals, perWeek: perWeek(totals.sessions, days) } };
  },

  /** One class on one day: everybody the club might expect, and who is marked. */
  async sheet(actor, orgId, sessionId, date) {
    await assertRole(actor, orgId, TEACH);
    const org = await attendanceClub(orgId);
    const session = await one(`select id, label, weekday, to_char(starts,'HH24:MI') as starts,
        to_char(ends,'HH24:MI') as ends from training_session where id=$1 and organisation_id=$2`,
      [sessionId, orgId]);
    if (!session) throw new NotFound('Class');
    const today = await todayAt(org);
    const problems = problemsWithSheet({ date, sessionWeekday: session.weekday }, today);
    if (problems.length) throw new Invalid(problems.join(' '));

    const here = await q(`select person_id from attendance where organisation_id=$1
      and session_id=$2 and session_date=$3::date`, [orgId, sessionId, date]);
    const present = new Set(here.map((r) => r.person_id));
    const members = await q(`
      select p.id as person_id, p.display_number,
             nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') as name,
             case when p.date_of_birth is null then null
               else date_part('year', age($2::date, p.date_of_birth))::int end as age
      from affiliation a join person p on p.id = a.person_id
      where a.organisation_id = $1 and a.ends is null and a.status in ('active','trial')
        and a.role in ('member','instructor','assistant')
      order by p.last_name, p.first_name`, [orgId, date]);
    const memberIds = new Set(members.map((m) => m.person_id));
    const visitors = (await q(`select p.id as person_id, p.display_number,
        nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') as name
      from attendance t join person p on p.id = t.person_id
      where t.organisation_id=$1 and t.session_id=$2 and t.session_date=$3::date`, [orgId, sessionId, date]))
      .filter((v) => !memberIds.has(v.person_id));
    const tryers = await q(`select n.id, n.first_name, n.last_name, n.status,
        (select count(*)::int from newcomer_attendance v where v.newcomer_id = n.id) as visits,
        exists (select 1 from newcomer_attendance v where v.newcomer_id = n.id
          and v.session_id = $2 and v.session_date = $3::date) as present
      from newcomer n where n.organisation_id = $1
        and (n.status = 'trialling' or exists (select 1 from newcomer_attendance v where v.newcomer_id = n.id
          and v.session_id = $2 and v.session_date = $3::date))
      order by n.first_name, n.last_name`, [orgId, sessionId, date]);
    return { org, session, date, today, members: members.map((m) => ({ ...m, present: present.has(m.person_id) })), visitors,
      newcomers: tryers };
  },

  /**
   * Set the roll for a class on a day to exactly these people. Taking the roll
   * twice is fine — it is a set, not a log of button presses.
   */
  async save(actor, orgId, sessionId, date, { personIds = [], visitorNumbers = [], newcomerIds = [] }) {
    const sheet = await attendance.sheet(actor, orgId, sessionId, date);   // authority, date, class
    const allowed = new Set([...sheet.members, ...sheet.visitors].map((m) => m.person_id));
    const ids = new Set(personIds.filter((id) => allowed.has(id)));
    const allowedNew = new Set(sheet.newcomers.map((n) => n.id));
    const newIds = [...new Set(newcomerIds.filter((id) => allowedNew.has(id)))];

    // A visitor is somebody from another club in the same federation.
    const unknown = [];
    for (const raw of visitorNumbers) {
      const number = String(raw).trim().toUpperCase();
      const v = await one(`select p.id from person p
        where upper(p.display_number) = $1 and exists (
          select 1 from affiliation a join organisation o on o.id = a.organisation_id
          join organisation mine on mine.id = $2
          where a.person_id = p.id and a.ends is null and a.status = 'active'
            and subpath(o.path, 0, 1) = subpath(mine.path, 0, 1))`, [number, orgId]);
      if (v) ids.add(v.id); else unknown.push(number);
    }
    if (unknown.length) throw new Invalid(`No member found for ${unknown.join(', ')}.`);

    const by = (await one('select person_id from account where id=$1', [actor]))?.person_id ?? null;
    const client = await pool.connect();
    let before, after;
    try {
      await client.query('begin');
      before = (await client.query(`select count(*)::int as n from attendance where organisation_id=$1
        and session_id=$2 and session_date=$3::date`, [orgId, sessionId, date])).rows[0].n;
      await client.query(`delete from attendance where organisation_id=$1 and session_id=$2
        and session_date=$3::date and not (person_id = any($4::uuid[]))`, [orgId, sessionId, date, [...ids]]);
      if (ids.size) await client.query(`insert into attendance (person_id, organisation_id, session_date, session_id, recorded_by)
        select x, $1, $2::date, $3, $4 from unnest($5::uuid[]) as x
        on conflict (person_id, organisation_id, session_date, session_id) do nothing`,
        [orgId, date, sessionId, by, [...ids]]);
      after = ids.size;
      await client.query(`delete from newcomer_attendance where organisation_id=$1 and session_id=$2
        and session_date=$3::date and not (newcomer_id = any($4::uuid[]))`, [orgId, sessionId, date, newIds]);
      if (newIds.length) await client.query(`insert into newcomer_attendance (newcomer_id, organisation_id, session_id, session_date)
        select x, $1, $2, $3::date from unnest($4::uuid[]) as x
        on conflict (newcomer_id, session_id, session_date) do nothing`, [orgId, sessionId, date, newIds]);
      await client.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, before, after)
        values ($1,$2,'roll_taken','training_session',$3,$4,$5)`, [actor, orgId, sessionId,
        JSON.stringify({ came: before }), JSON.stringify({ came: after, date, label: sheet.session.label,
          visitors: visitorNumbers.length, newcomers: newIds.length })]);
      await client.query('commit');
    } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
    return { came: after + newIds.length };
  },

  /** How much one person has trained. For those who look after them. */
  async forPerson(actor, personId, orgId) {
    await assertRole(actor, orgId, TEACH);
    const org = await one('select timezone from organisation where id=$1', [orgId]);
    const today = await todayAt(org);
    return one(`select
        count(*) filter (where session_date > ($2::date - 90))::int as last90,
        count(*) filter (where session_date > ($2::date - 30))::int as last30,
        count(*)::int as ever,
        to_char(max(session_date), 'YYYY-MM-DD') as last_seen
      from attendance where person_id = $1`, [personId, today]);
  },
};

const cardRow = (personId) => one(`
  select p.id, p.display_number, coalesce(p.preferred_name, p.first_name) || ' ' || p.last_name as name,
         p.photo_asset_id, a.role, a.status, a.paid_until::text as paid_until, a.fee_exempt, a.starts::text as since,
         o.id as org_id, o.name as club, o.timezone,
         root.name as federation, root.slug as federation_slug,
         cg.label as grade, cg.rank_order,
         exists (select 1 from affiliation i where i.person_id = p.id and i.ends is null
                 and i.role = 'instructor' and i.status = 'active') as is_instructor
  from person p
  join affiliation a on a.person_id = p.id and a.ends is null and a.role = 'member'
  join organisation o on o.id = a.organisation_id
  join organisation root on o.path <@ root.path and root.parent_id is null
  left join person_current_grade cg on cg.person_id = p.id
  where p.id = $1 order by a.starts limit 1`, [personId]);

export const cards = {
  /** The card on one person's own (or child's) screen. */
  async forPerson(actor, personId) {
    const how = await family.assertMayActFor(actor, personId);
    const m = await cardRow(personId);
    if (!m) return { how, issued: false, reason: 'Only members have a card.' };
    const today = localNow(m.timezone).date;
    const why = cardRefusal({ role: m.role, status: m.status, paidUntil: m.paid_until, exempt: m.fee_exempt,
      displayNumber: m.display_number }, today);
    if (why) return { how, issued: false, reason: why, member: m };
    const validThrough = cardValidThrough({ paidUntil: m.paid_until, exempt: m.fee_exempt }, today, CARD_DAYS);
    const token = signCard({ memberNumber: m.display_number, rankOrder: m.rank_order, expires: validThrough, orgSlug: m.federation_slug });
    if (!token) return { how, issued: false, reason: 'Cards are not switched on for this installation yet.', member: m };
    return { how, issued: true, member: m, validThrough, token };
  },

  /**
   * What a scan says. Signed in as an official of the member's club or above: who they are. Anybody
   * else: only whether the code is good — a stranger who scans a card learns nothing about the person.
   */
  async verify(actor, token) {
    const signature = readCard(token);
    const live = signature.memberNumber ? await one(`select p.id from person p where upper(p.display_number) = upper($1)`,
      [signature.memberNumber]) : null;
    const row = live ? await cardRow(live.id) : null;
    const today = localNow(row?.timezone).date;
    const verdict = verdictFor({ signature, today, live: row && { role: row.role, status: row.status,
      paidUntil: row.paid_until, exempt: row.fee_exempt, displayNumber: row.display_number } });
    // The signed rank must still be the real one; a grade changed since the code was made is worth a flag.
    const stale = row && signature.valid && (signature.rankOrder ?? null) !== (row.rank_order ?? null);
    let official = false;
    if (actor && row) official = !!(await one('select has_role_at($1,$2,$3) as ok', [actor, row.org_id, TEACH]))?.ok;
    return { verdict, official, stale, federation: row?.federation ?? null,
      member: official && row ? { name: row.name, number: row.display_number, club: row.club, grade: row.grade,
        paidUntil: row.paid_until, exempt: row.fee_exempt, hasPhoto: !!row.photo_asset_id, isInstructor: row.is_instructor, name: row.name, personId: row.id } : null };
  },
};

export const checkin = {
  /** The code an instructor shows for one class today. */
  async code(actor, orgId, sessionId) {
    await assertRole(actor, orgId, TEACH);
    const org = await attendanceClub(orgId);
    const date = await todayAt(org);
    const session = await one(`select id, label, weekday, to_char(starts,'HH24:MI') as starts,
        to_char(ends,'HH24:MI') as ends from training_session where id=$1 and organisation_id=$2`, [sessionId, orgId]);
    if (!session) throw new NotFound('Class');
    if (session.weekday !== new Date(`${date}T00:00:00Z`).getUTCDay()) throw new Invalid('That class does not run today.');
    const token = signCheckin({ sessionId, date });
    if (!token) throw new Invalid('Check-in codes are not switched on for this installation yet.');
    const here = (await one(`select count(*)::int as n from attendance where organisation_id=$1 and session_id=$2
      and session_date=$3::date`, [orgId, sessionId, date])).n;
    return { org, session, date, token, here };
  },

  /** What a parent sees after scanning: their family, who can go in and who cannot. */
  async plan(actor, token) {
    const t = readCheckin(token);
    if (!t) throw new NotFound('Check-in code');
    if (t.expired) return { expired: true };
    const session = await one(`select ts.id, ts.label, ts.weekday, ts.organisation_id, to_char(ts.starts,'HH24:MI') as starts,
        to_char(ts.ends,'HH24:MI') as ends, ts.min_age, ts.max_age, g.rank_order as min_rank_order, o.name as club, o.timezone
      from training_session ts join organisation o on o.id = ts.organisation_id left join grade g on g.id = ts.min_grade_id
      where ts.id = $1`, [t.sessionId]);
    if (!session) throw new NotFound('Class');
    const today = localNow(session.timezone).date;
    if (today !== t.date) return { expired: true };
    const { self, dependants } = await family.mine(actor);
    const folk = [];
    for (const p of [self, ...dependants].filter(Boolean)) {
      const member = !!(await one(`select 1 as x from affiliation where person_id=$1 and organisation_id=$2 and ends is null
        and status in ('active','trial') and role in ('member','instructor','assistant')`, [p.id, session.organisation_id]));
      const grade = await one('select rank_order from person_current_grade where person_id = $1', [p.id]);
      folk.push({ id: p.id, name: p.first_name, ageYears: ageOnDate(p.date_of_birth, today), rankOrder: grade?.rank_order ?? null, member });
    }
    const here = new Set((await q(`select person_id from attendance where organisation_id=$1 and session_id=$2 and session_date=$3::date`,
      [session.organisation_id, session.id, t.date])).map((r) => r.person_id));
    return { expired: false, session, date: t.date, people: checkinPlan(folk, session, here) };
  },

  /** Check these people in. Anything the plan would not allow is quietly left out. */
  async confirm(actor, token, personIds) {
    const plan = await this.plan(actor, token);
    if (plan.expired) throw new Invalid('That code has run out — scan the screen again.');
    const ok = plan.people.filter((p) => p.state === 'can' && personIds.includes(p.id));
    if (!ok.length) return { came: [], plan };
    const by = (await one('select person_id from account where id=$1', [actor]))?.person_id ?? null;
    const orgId = plan.session.organisation_id;
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`insert into attendance (person_id, organisation_id, session_date, session_id, recorded_by)
        select x, $1, $2::date, $3, $4 from unnest($5::uuid[]) as x
        on conflict (person_id, organisation_id, session_date, session_id) do nothing`,
        [orgId, plan.date, plan.session.id, by, ok.map((p) => p.id)]);
      await client.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, before, after)
        values ($1,$2,'self_check_in','training_session',$3,null,$4)`, [actor, orgId, plan.session.id,
        JSON.stringify({ date: plan.date, label: plan.session.label, people: ok.map((p) => p.id) })]);
      await client.query('commit');
    } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
    return { came: ok.map((p) => p.name), plan };
  },
};

const SESSION_BOOKING = `select ts.id, ts.organisation_id, ts.label, ts.weekday, to_char(ts.starts,'HH24:MI') as starts, to_char(ts.ends,'HH24:MI') as ends,
    ts.min_age, ts.max_age, ts.capacity, g.rank_order as min_rank_order
  from training_session ts left join grade g on g.id = ts.min_grade_id`;

const countsFor = (sessionId, date) => q(`select status, count(*)::int n from class_booking where session_id=$1 and session_date=$2 and status <> 'cancelled' group by status`, [sessionId, date]);

export const booking = {
  BOOK_DAYS_AHEAD,

  /** The club's side: its classes, places, and who is booked on the next dates. */
  async forClub(actor, orgId) {
    await assertRole(actor, orgId, TEACH);
    await clubOnly(orgId);
    const now = localNow((await one('select timezone from organisation where id=$1', [orgId])).timezone);
    const sessions = await q(`${SESSION_BOOKING} where ts.organisation_id = $1 order by ts.weekday, ts.starts`, [orgId]);
    const out = [];
    for (const s of sessions) {
      const dates = s.capacity == null ? [] : bookableDates(s, now);
      const days = [];
      for (const date of dates) {
        const people = await q(`select b.id, b.status, b.created_at, p.id as person_id, p.display_number,
            nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') as name
          from class_booking b join person p on p.id = b.person_id
          where b.session_id = $1 and b.session_date = $2 and b.status <> 'cancelled' order by b.status, b.created_at`, [s.id, date]);
        days.push({ date, booked: people.filter((x) => x.status === 'booked'), waiting: people.filter((x) => x.status === 'waiting') });
      }
      out.push({ ...s, days });
    }
    return { today: now.date, sessions: out };
  },

  async setCapacity(actor, orgId, sessionId, raw) {
    await assertRole(actor, orgId, REGISTER);
    await clubOnly(orgId);
    const c = readCapacity(raw);
    if (c.problem) throw new Invalid(c.problem);
    const row = await one(`update training_session set capacity=$3 where id=$1 and organisation_id=$2 returning id`, [sessionId, orgId, c.value]);
    if (!row) throw new NotFound('Class');
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after) values ($1,$2,'class_places','training_session',$3,$4)`,
      [actor, orgId, sessionId, JSON.stringify({ capacity: c.value })]);
    // More room: bring people up from the waiting list for every date.
    if (c.value != null) {
      const dates = await q(`select distinct session_date::text d from class_booking where session_id=$1 and status='waiting' and session_date >= current_date`, [sessionId]);
      for (const { d } of dates) await this._fill(sessionId, d);
    }
  },

  /** What one person can book, and what they hold. */
  async forPerson(actor, personId) {
    await family.assertMayActFor(actor, personId);
    const person = await one('select id, first_name, last_name, date_of_birth::text as dob from person where id=$1', [personId]);
    const grade = await one('select rank_order from person_current_grade where person_id=$1', [personId]);
    const clubs = await q(`select o.id, o.name, o.timezone from affiliation a join organisation o on o.id = a.organisation_id
      where a.person_id = $1 and a.ends is null and a.role in ('member','instructor','assistant') and a.status in ('active','trial') and o.type='club' order by o.name`, [personId]);
    const out = [];
    for (const club of clubs) {
      const now = localNow(club.timezone);
      const who = { ageYears: ageOnDate(person.dob, now.date), rankOrder: grade?.rank_order ?? null };
      const sessions = await q(`${SESSION_BOOKING} where ts.organisation_id=$1 and ts.capacity is not null order by ts.weekday, ts.starts`, [club.id]);
      const slots = [];
      for (const s of sessions) {
        if (!mayAttend(s, who)) continue;
        for (const date of bookableDates(s, now)) {
          const c = Object.fromEntries((await countsFor(s.id, date)).map((r) => [r.status, r.n]));
          const mine = await one(`select id, status, created_at from class_booking where session_id=$1 and session_date=$2 and person_id=$3 and status <> 'cancelled'`, [s.id, date, personId]);
          let position = null;
          if (mine?.status === 'waiting') {
            const w = await q(`select id, created_at from class_booking where session_id=$1 and session_date=$2 and status='waiting' order by created_at, id`, [s.id, date]);
            position = queuePosition(w, mine.id);
          }
          slots.push({ session: s, date, booked: c.booked ?? 0, waiting: c.waiting ?? 0, free: Math.max(0, s.capacity - (c.booked ?? 0)), mine, position });
        }
      }
      slots.sort((a, b) => a.date.localeCompare(b.date) || a.session.starts.localeCompare(b.session.starts));
      out.push({ club, slots });
    }
    return { person, clubs: out };
  },

  async book(actor, personId, sessionId, date) {
    await family.assertMayActFor(actor, personId);
    const person = await one('select id, date_of_birth::text as dob from person where id=$1', [personId]);
    const s = await one(`${SESSION_BOOKING} where ts.id=$1`, [sessionId]);
    if (!s) throw new NotFound('Class');
    if (!await one(`select 1 x from affiliation where person_id=$1 and organisation_id=$2 and ends is null and role in ('member','instructor','assistant') and status in ('active','trial')`, [personId, s.organisation_id]))
      throw new NotFound('Class');
    const now = localNow((await one('select timezone from organisation where id=$1', [s.organisation_id])).timezone);
    const grade = await one('select rank_order from person_current_grade where person_id=$1', [personId]);
    const problem = problemWithBooking({ session: s, date, now, who: { ageYears: ageOnDate(person.dob, now.date), rankOrder: grade?.rank_order ?? null } });
    if (problem) throw new Invalid(problem);
    const client = await pool.connect();
    try {
      await client.query('begin');
      // One booker at a time per class: the places are counted while the row is held.
      await client.query('select id from training_session where id=$1 for update', [sessionId]);
      const have = (await client.query(`select id, status from class_booking where session_id=$1 and session_date=$2 and person_id=$3 and status <> 'cancelled'`, [sessionId, date, personId])).rows[0];
      if (have) { await client.query('rollback'); return { status: have.status, already: true }; }
      const booked = (await client.query(`select count(*)::int n from class_booking where session_id=$1 and session_date=$2 and status='booked'`, [sessionId, date])).rows[0].n;
      const status = placeFor({ capacity: s.capacity, booked });
      await client.query(`insert into class_booking (session_id, session_date, person_id, status, booked_by) values ($1,$2,$3,$4,$5)`, [sessionId, date, personId, status, actor]);
      await client.query('commit');
      await webhooks.emitNow(s.organisation_id, 'class.booked', { session_id: sessionId, date, person_id: personId, status });
      return { status, already: false };
    } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
  },

  /** Give up a place (or leave the queue). The longest-waiting person moves up. */
  async cancel(actor, personId, bookingId, { notify = null } = {}) {
    await family.assertMayActFor(actor, personId);
    const b = await one(`update class_booking set status='cancelled', cancelled_at=now() where id=$1 and person_id=$2 and status <> 'cancelled' and session_date >= current_date - 1
      returning session_id, session_date::text as d, (select organisation_id from training_session where id = session_id) as org`, [bookingId, personId]);
    if (!b) throw new NotFound('Booking');
    const moved = await this._fill(b.session_id, b.d);
    if (notify) for (const m of moved) await this._tell(b.org, m, b.d, notify);
    return { moved: moved.length };
  },

  /** Fill free places from the queue. Returns the people moved up. */
  async _fill(sessionId, date) {
    const client = await pool.connect();
    const moved = [];
    try {
      await client.query('begin');
      const s = (await client.query('select id, capacity from training_session where id=$1 for update', [sessionId])).rows[0];
      if (s?.capacity != null) {
        const booked = (await client.query(`select count(*)::int n from class_booking where session_id=$1 and session_date=$2 and status='booked'`, [sessionId, date])).rows[0].n;
        const waiting = (await client.query(`select id, person_id, created_at from class_booking where session_id=$1 and session_date=$2 and status='waiting' order by created_at, id`, [sessionId, date])).rows;
        for (const w of nextInQueue(waiting, placesFree({ capacity: s.capacity, booked }))) {
          await client.query(`update class_booking set status='booked', promoted_at=now() where id=$1`, [w.id]);
          moved.push(w.person_id);
        }
      }
      await client.query('commit');
    } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
    return moved;
  },

  async _tell(orgId, personId, date, { messenger, origin = '', baseFrom = '' }) {
    await push.toPerson(personId, { title: 'A place has opened up', body: `You are now booked in for ${date}. Cancel from My classes if you cannot come.`, url: `/me/${personId}/book` });
    try {
      const s = await one(`select o.name from organisation o where o.id=$1`, [orgId]);
      const made = await messages.prepare(null, orgId, { audience: 'selected', kind: 'announcement', personIds: [personId],
        subject: 'A place has opened up', body: `Good news: a place has opened in the class you were waiting for at ${s.name} on ${date}. You are now booked in. If you cannot come, please cancel from My classes so somebody else can have it.`,
        eventId: null, personNumber: null }, { baseFrom, trusted: true });
      await messages.sendBatch(null, orgId, made.message.id, { messenger, origin, trusted: true, budgetMs: 3000 });
    } catch { /* the place is theirs either way */ }
  },
};
