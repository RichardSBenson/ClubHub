/**
 * HONBU — data access: visitors
 *
 * Part of the data layer (see ../data.mjs). Every function that touches an organisation takes an `actor` and
 * checks permission in SQL, not in the caller.
 */

import { pool } from '../../infrastructure/postgres/pool.mjs';
import { region } from '../../infrastructure/region-context.mjs';
import { normaliseGender } from '../../core/domain/people.mjs';
import { seal, open as unseal } from '../../infrastructure/crypto/vault.mjs';
import { PERIODS, feeFor } from '../../core/domain/membership.mjs';
import { senderFor } from '../../core/domain/messaging.mjs';
import { problemsWithNewcomer, isChild, timeToTalk, RETAIN_DAYS } from '../../core/domain/newcomer.mjs';
import { problemsWithEnquiry, emailBody, PER_VISITOR_PER_HOUR, PER_ORGANISATION_PER_DAY, RETAIN_DAYS as ENQUIRY_RETAIN_DAYS } from '../../core/domain/enquiry.mjs';
import { problemsWithOutsider, phoneKey } from '../../core/domain/outsider.mjs';
import { readGrowth, readGrowthForm, problemsWithGrowth, problemsWithTrialSignup, trialEnds, daysLeft as trialDaysLeft, trialsDue, newCode, normaliseCode, referralVerdict, referralQualifies, rewardsFor, rewardText, AUTOMATIC } from '../../core/domain/growth.mjs';
import { MANAGE, REGISTER, TEACH } from '../../core/domain/access.mjs';
import { attendance } from './attendance.mjs';
import { clubs } from './organisations.mjs';
import { family, people } from './people.mjs';
import { Forbidden, Invalid, NotFound, ageOnDate, assertRole, attendanceClub, clubMail, clubOnly, feeRows, one, q, todayAt } from './shared.mjs';

// ---------------------------------------------------------------------------
// what a member may enter
//
// The events a person's own club and the organisations above it have opened for
// entries, filtered by the same visibility rules the public calendar uses. A
// member is offered nothing they could not see, and the check made when they
// submit is this same query, not a copy of it.
// ---------------------------------------------------------------------------

export const ENTERABLE_KINDS = ['grading', 'tournament', 'fight_night', 'seminar', 'camp'];

export const newcomers = {
  async list(actor, orgId) {
    await assertRole(actor, orgId, TEACH);
    const org = await attendanceClub(orgId);
    const today = await todayAt(org);
    const rows = await q(`select n.id, n.first_name, n.last_name, n.email, n.phone, n.status,
        to_char(n.date_of_birth,'YYYY-MM-DD') as date_of_birth, n.guardian_name, n.guardian_phone,
        n.emergency_name, n.emergency_phone, n.medical_notes, n.consent_by,
        to_char(n.consent_at at time zone $2,'YYYY-MM-DD') as consent_on, n.person_id,
        (select count(*)::int from newcomer_attendance v where v.newcomer_id = n.id) as visits,
        (select to_char(max(v.session_date),'YYYY-MM-DD') from newcomer_attendance v where v.newcomer_id = n.id) as last_visit
      from newcomer n where n.organisation_id = $1
        and (n.status = 'trialling' or n.updated_at > now() - interval '30 days')
      order by (n.status = 'trialling') desc, n.created_at desc`, [orgId, org.timezone]);
    return { org, today, newcomers: rows.map((r) => ({ ...r, medical_notes: unseal(r.medical_notes),
      child: isChild(r.date_of_birth, today, region().adultAge), readyToTalk: r.status === 'trialling' && timeToTalk(r.visits) })) };
  },

  /** Add a newcomer, and — if asked — mark them as at a class today. */
  async add(actor, orgId, input, { sessionId = null, date = null } = {}) {
    await assertRole(actor, orgId, TEACH);
    const org = await attendanceClub(orgId);
    const today = await todayAt(org);
    const problems = problemsWithNewcomer(input, today, region().adultAge);
    if (problems.length) throw new Invalid(problems.join(' '));

    if (input.email) {
      const member = await one(`select 1 from person p join affiliation a on a.person_id = p.id
        where lower(p.email) = $2 and a.organisation_id = $1 and a.ends is null`, [orgId, input.email]);
      if (member) throw new Invalid('That email belongs to somebody who is already a member here — find them on the roll.');
    }
    const twin = await one(`select 1 from newcomer where organisation_id = $1 and status = 'trialling'
        and ((email is not null and email = $2) or (phone is not null and phone = $3 and lower(last_name) = lower($4)))`,
      [orgId, input.email || null, input.phone || null, input.lastName]);
    if (twin) throw new Invalid('They are already on the newcomers list.');

    let sheet = null;
    if (sessionId) sheet = await attendance.sheet(actor, orgId, sessionId, date);   // validates class and date

    const client = await pool.connect();
    try {
      await client.query('begin');
      const { rows: [n] } = await client.query(`insert into newcomer (organisation_id, first_name, last_name, email, phone,
          date_of_birth, guardian_name, guardian_phone, emergency_name, emergency_phone, medical_notes, consent_by, consent_taken_by)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
        [orgId, input.firstName, input.lastName, input.email || null, input.phone || null, input.dateOfBirth,
         input.guardianName || null, input.guardianPhone || null, input.emergencyName || null,
         input.emergencyPhone || null, seal(input.medicalNotes || null), input.consentName, actor]);
      if (sheet) await client.query(`insert into newcomer_attendance (newcomer_id, organisation_id, session_id, session_date)
        values ($1,$2,$3,$4::date)`, [n.id, orgId, sessionId, date]);
      await client.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
        values ($1,$2,'newcomer_added','newcomer',$3,$4)`, [actor, orgId, n.id,
        JSON.stringify({ child: isChild(input.dateOfBirth, today, region().adultAge), consent_by: input.consentName })]);
      await client.query('commit');
      return { id: n.id };
    } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
  },

  /** They are staying: make them a member. Their classes so far count. */
  async join(actor, orgId, newcomerId, { paidUntil = null } = {}) {
    await assertRole(actor, orgId, REGISTER);
    const n = await one(`select *, to_char(date_of_birth,'YYYY-MM-DD') as dob from newcomer
      where id=$1 and organisation_id=$2`, [newcomerId, orgId]);
    if (!n) throw new NotFound('Newcomer');
    if (n.status === 'joined') throw new Invalid('They have already joined.');

    const child = isChild(n.dob, (await todayAt(await one('select timezone from organisation where id=$1', [orgId]))), region().adultAge);
    const person = await people.enrol(actor, { organisationId: orgId, firstName: n.first_name, lastName: n.last_name,
      dateOfBirth: n.dob, email: n.email, phone: n.phone, role: 'member', paidUntil,
      emergencyName: n.emergency_name ?? (child ? n.guardian_name : null),
      emergencyPhone: n.emergency_phone ?? (child ? n.guardian_phone : null) });

    const client = await pool.connect();
    try {
      await client.query('begin');
      if (n.medical_notes) await client.query(`insert into person_private (person_id, medical_notes) values ($1,$2)
        on conflict (person_id) do update set medical_notes = excluded.medical_notes`, [person.id, n.medical_notes]);
      await client.query(`insert into attendance (person_id, organisation_id, session_date, session_id, recorded_by)
        select $1, v.organisation_id, v.session_date, v.session_id, null from newcomer_attendance v
        where v.newcomer_id = $2 and v.session_id is not null
        on conflict (person_id, organisation_id, session_date, session_id) do nothing`, [person.id, newcomerId]);
      // What was collected for the trial now lives on the member; keep only the consent record here.
      await client.query(`update newcomer set status='joined', person_id=$2, medical_notes=null, guardian_name=null,
        guardian_phone=null, emergency_name=null, emergency_phone=null, email=null, phone=null, updated_at=now()
        where id=$1`, [newcomerId, person.id]);
      await client.query(`delete from newcomer_attendance where newcomer_id=$1`, [newcomerId]);
      await client.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
        values ($1,$2,'newcomer_joined','newcomer',$3,$4)`, [actor, orgId, newcomerId,
        JSON.stringify({ person: person.display_number })]);
      await client.query('commit');
    } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
    return { person };
  },

  /** They are not coming back. Their details go now, not in six months. */
  async notContinuing(actor, orgId, newcomerId) {
    await assertRole(actor, orgId, TEACH);
    const n = await one('select status from newcomer where id=$1 and organisation_id=$2', [newcomerId, orgId]);
    if (!n) throw new NotFound('Newcomer');
    if (n.status !== 'trialling') throw new Invalid('They are not trialling.');
    await q(`update newcomer set status='not_continuing', email=null, phone=null, medical_notes=null,
      guardian_name=null, guardian_phone=null, emergency_name=null, emergency_phone=null, updated_at=now()
      where id=$1`, [newcomerId]);
    await q(`insert into audit_log (account_id, organisation_id, action, entity, entity_id)
      values ($1,$2,'newcomer_left','newcomer',$3)`, [actor, orgId, newcomerId]);
  },

  /** Daily: forget people who tried a class and went quiet. Returns how many. */
  async purgeStale() {
    const gone = await q(`delete from newcomer n where n.status <> 'joined'
      and greatest(n.updated_at, coalesce((select max(v.session_date)::timestamptz from newcomer_attendance v
        where v.newcomer_id = n.id), n.created_at)) < now() - make_interval(days => $1) returning 1`, [RETAIN_DAYS]);
    return gone.length;
  },
};

export class TooMany extends Error {
  constructor(message) { super(message); this.status = 429; this.name = 'TooMany'; }
}

export const enquiries = {
  /**
   * A visitor writes. Stored first; emailed second; refused politely when one
   * visitor or one organisation is writing too often.
   */
  async submit({ slug, input, ipHash, messenger, baseFrom }) {
    const org = await one(`select id, name, slug, type from organisation where slug = $1 and status = 'active'`, [slug]);
    if (!org) throw new NotFound('Organisation');
    const problems = problemsWithEnquiry(input);
    if (problems.length) throw new Invalid(problems.join(' '));

    if (ipHash) {
      const n = (await one(`select count(*)::int as n from enquiry where ip_hash = $1 and created_at > now() - interval '1 hour'`, [ipHash])).n;
      if (n >= PER_VISITOR_PER_HOUR) throw new TooMany('You have sent several messages already. Please try again later.');
    }
    const day = (await one(`select count(*)::int as n from enquiry where organisation_id = $1 and created_at > now() - interval '1 day'`, [org.id])).n;
    if (day >= PER_ORGANISATION_PER_DAY) throw new TooMany('This form is very busy at the moment. Please try again tomorrow.');

    const row = await one(`insert into enquiry (organisation_id, kind, name, email, phone, who, message, ip_hash)
      values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`, [org.id, input.kind, input.name, input.email,
      input.phone || null, input.who || null, input.message || null, ipHash || null]);

    // Delivery is best-effort. The enquiry is already safe in the inbox.
    let emailed = false;
    try {
      const contact = (await one('select email from dojo_profile where organisation_id=$1', [org.id]))?.email ?? null;
      const to = contact ? [contact] : (await q(`select distinct a.email from grant_role g join account a on a.id = g.account_id
        where g.organisation_id = $1 and g.role in ('owner','administrator') order by a.email limit 3`, [org.id])).map((r) => r.email);
      const sender = senderFor({ club: org, baseFrom, contactEmail: null });
      if (messenger && sender && to.length) {
        for (const addr of to) {
          await messenger.send({ to: addr, subject: `${input.kind === 'trial' ? 'Free class enquiry' : 'Website message'} from ${input.name}`.slice(0, 150),
            text: emailBody(input, org.name), kind: 'enquiry', sender: { ...sender, replyTo: input.email } });
        }
        emailed = true;
      }
    } catch { /* stored; the inbox has it */ }
    if (emailed) await q('update enquiry set emailed = true where id = $1', [row.id]);
    return { id: row.id, emailed };
  },

  async inbox(actor, orgId, { status = null } = {}) {
    await assertRole(actor, orgId, REGISTER);
    const rows = await q(`select e.id, e.kind, e.name, e.email, e.phone, e.who, e.message, e.status, e.emailed,
        to_char(e.created_at at time zone o.timezone, 'YYYY-MM-DD HH24:MI') as received
      from enquiry e join organisation o on o.id = e.organisation_id
      where e.organisation_id = $1 and ($2::text is null or e.status = $2)
      order by (e.status = 'new') desc, e.created_at desc limit 200`, [orgId, status]);
    return { rows, waiting: rows.filter((r) => r.status === 'new').length };
  },

  async mark(actor, orgId, id, handled) {
    await assertRole(actor, orgId, REGISTER);
    const row = await one(`update enquiry set status = $3, handled_at = case when $3 = 'handled' then now() end,
        handled_by = case when $3 = 'handled' then $4::uuid end where id = $1 and organisation_id = $2 returning id`,
      [id, orgId, handled ? 'handled' : 'new', actor]);
    if (!row) throw new NotFound('Enquiry');
  },

  async remove(actor, orgId, id) {
    await assertRole(actor, orgId, REGISTER);
    const row = await one('delete from enquiry where id=$1 and organisation_id=$2 returning kind', [id, orgId]);
    if (!row) throw new NotFound('Enquiry');
    await q(`insert into audit_log (account_id, organisation_id, action, entity, after)
      values ($1,$2,'enquiry_deleted','enquiry',$3)`, [actor, orgId, JSON.stringify({ kind: row.kind })]);
  },

  /** Daily: forget visitor addresses after two days, and old enquiries after a year. */
  async tidy() {
    await q(`update enquiry set ip_hash = null where ip_hash is not null and created_at < now() - interval '2 days'`);
    return (await q(`delete from enquiry where created_at < now() - make_interval(days => $1) returning 1`, [ENQUIRY_RETAIN_DAYS])).length;
  },
};

export const outsiders = {
  /** The event, if it is open to people who are not on a roll. */
  async eventFor(hostSlug, eventSlug) {
    return one(`
      select e.id, e.title, e.slug, e.kind, e.starts_at, e.venue_name, e.summary,
             o.name as host_name, o.slug as host_slug, o.timezone as host_timezone
      from event e join organisation o on o.id = e.organisation_id
      where o.slug = $1 and e.slug = $2 and o.status = 'active'
        and e.status = 'published' and e.guests_allowed and e.visibility = 'public'
        and e.kind = any($3::event_kind[]) and e.starts_at > now()
        and (e.entries_open is null or e.entries_open <= now())
        and (e.entries_close is null or e.entries_close > now())`,
      [hostSlug, eventSlug, ENTERABLE_KINDS]);
  },

  /**
   * Who is this contact? By email, or by mobile. Returns the addresses to send a
   * link to, never the people — the caller must not be able to read the register.
   */
  async addressesFor(contact) {
    const c = String(contact ?? '').trim();
    if (c.includes('@')) {
      const rows = await q(`select distinct lower(email::text) as email from person where email = $1
        union select lower(email::text) from account where email = $1`, [c.toLowerCase()]);
      return rows.map((r) => r.email);
    }
    const key = phoneKey(c);
    if (!key) return [];
    const rows = await q(`select distinct lower(email::text) as email from person
      where email is not null and phone is not null and right(regexp_replace(phone, '\\D', '', 'g'), 8) = $1
      limit 3`, [key]);
    return rows.map((r) => r.email);
  },

  /** Make sure an address that belongs to a person can sign in. Idempotent. */
  async ensureAccount(email) {
    const have = await one('select id from account where email = $1', [email]);
    if (have) return have.id;
    // Several people can share an address (a parent's, on a child's record).
    // The sign-in belongs to the eldest; the children come through guardianship.
    const person = await one(`select id from person where email = $1
      order by date_of_birth asc nulls last, created_at asc limit 1`, [email]);
    if (!person) return null;
    const made = await one(`insert into account (email, person_id) values ($1,$2)
      on conflict (email) do nothing returning id`, [email, person.id]);
    return made?.id ?? (await one('select id from account where email = $1', [email])).id;
  },

  /** A person seen for the first time. Refused if the address is already known. */
  async register(input) {
    const problems = problemsWithOutsider(input);
    if (problems.length) throw new Invalid(problems.join('; '));
    const email = input.email.toLowerCase();
    if ((await this.addressesFor(email)).length)
      throw new Invalid('We already know that address. Ask for a sign-in link instead.');

    const client = await pool.connect();
    try {
      await client.query('begin');
      const { rows: [person] } = await client.query(`
        insert into person (first_name, last_name, date_of_birth, gender, email, phone)
        values ($1,$2,$3,$4,$5,$6) returning id`,
        [input.firstName.trim(), input.lastName.trim(), input.dateOfBirth || null,
         normaliseGender(input.gender) ?? null, email, input.phone || null]);
      const { rows: [account] } = await client.query(
        `insert into account (email, person_id) values ($1,$2) returning id`, [email, person.id]);
      await client.query(`insert into audit_log (account_id, action, entity, entity_id, after)
        values ($1,'entrant_registered','person',$2,$3::jsonb)`,
        [account.id, person.id, JSON.stringify({ via: 'event entry' })]);
      await client.query('commit');
      return { personId: person.id, accountId: account.id, email };
    } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
  },
};

const TRIAL_RETAIN_DAYS = 180;

const TRIALS_PER_VISITOR_PER_HOUR = 3;

const TRIALS_PER_CLUB_PER_DAY = 30;

const growthClub = async (slug) => {
  const org = await one(`select id, name, slug, type, timezone, settings from organisation
    where slug = $1 and type = 'club' and status = 'active'`, [slug]);
  if (!org) return null;
  return { ...org, growth: readGrowth(org.settings?.growth) };
};

export const trials = {
  /** The public sign-up page's facts: the club, and whether it offers a trial at all. */
  async offer(slug) {
    const org = await growthClub(slug);
    if (!org || !org.growth.trial.enabled) return null;
    return { name: org.name, slug: org.slug, days: org.growth.trial.days, minAge: org.growth.trial.minAge };
  },

  /**
   * Start a trial. Somebody the register already knows (same email, same mobile, or same name and
   * birthday) does not get a second record: the caller is told, and sends them a sign-in link.
   */
  async start({ slug, input, ipHash = null }) {
    const org = await growthClub(slug);
    if (!org || !org.growth.trial.enabled) throw new NotFound('Free trial');
    const today = await todayAt(org);
    const problems = problemsWithTrialSignup(input, { today, minAge: org.growth.trial.minAge });
    if (problems.length) throw new Invalid(problems.join(' '));

    if (ipHash && (await one(`select count(*)::int as n from member_trial where ip_hash = $1 and created_at > now() - interval '1 hour'`, [ipHash])).n
        >= TRIALS_PER_VISITOR_PER_HOUR) throw new TooMany('Several trials have been started from here already. Please try again later.');
    if ((await one(`select count(*)::int as n from member_trial where organisation_id = $1 and created_at > now() - interval '1 day'`, [org.id])).n
        >= TRIALS_PER_CLUB_PER_DAY) throw new TooMany('This page is very busy at the moment. Please try again tomorrow.');

    const known = await one(`select p.id, p.email::text as email from person p
      where p.email = $1
         or ($2::text is not null and right(regexp_replace(coalesce(p.phone,''), '\\D', '', 'g'), 8) = $2)
         or (lower(p.first_name) = lower($3) and lower(p.last_name) = lower($4) and p.date_of_birth = $5::date)
      order by (p.email = $1) desc limit 1`,
      [input.email, phoneKey(input.phone), input.firstName, input.lastName, input.dateOfBirth]);
    if (known) return { existing: true, email: known.email === input.email ? input.email : null, org };

    const ends = trialEnds(today, org.growth.trial.days);
    const client = await pool.connect();
    let person, referralState = null, source = 'website';
    try {
      await client.query('begin');
      ({ rows: [person] } = await client.query(`insert into person (first_name, last_name, date_of_birth, email, phone)
        values ($1,$2,$3,$4,$5) returning id`, [input.firstName, input.lastName, input.dateOfBirth, input.email, input.phone]));
      await client.query(`insert into person_private (person_id, emergency_name, emergency_phone, medical_notes) values ($1,$2,$3,$4)`,
        [person.id, input.emergencyName, input.emergencyPhone, seal(input.medical || null)]);
      await client.query(`insert into affiliation (person_id, organisation_id, role, starts, status, paid_until)
        values ($1,$2,'member',$3::date,'trial',$4::date)`, [person.id, org.id, today, ends]);
      await client.query(`insert into account (email, person_id) values ($1,$2) on conflict (email) do nothing`, [input.email, person.id]);

      // Was somebody's code used, and does it count?
      if (input.code) {
        const ref = (await client.query(`select c.person_id, p.email::text as email, p.phone,
            exists (select 1 from affiliation a where a.person_id = c.person_id and a.organisation_id = $2
                      and a.role = 'member' and a.status = 'active' and a.ends is null) as active,
            (select count(*)::int from referral r where r.referrer_id = c.person_id and r.created_at > now() - interval '1 day') as recent
          from referral_code c join person p on p.id = c.person_id where c.code = $1`, [input.code, org.id])).rows[0];
        if (ref) {
          const verdict = referralVerdict({ referrer: ref, referred: input, recent: ref.recent, settings: org.growth });
          await client.query(`insert into referral (organisation_id, referrer_id, referred_id, code, status, note)
            values ($1,$2,$3,$4,$5,$6)`, [org.id, ref.person_id, person.id, input.code, verdict.ok ? 'trial' : 'void', verdict.reason]);
          if (verdict.ok) source = 'referral';
          referralState = verdict.ok ? 'counted' : 'not counted';
        }
      }
      await client.query(`insert into member_trial (person_id, organisation_id, starts, ends, source, consent_by, ip_hash)
        values ($1,$2,$3::date,$4::date,$5,$6,$7)`, [person.id, org.id, today, ends, source, `${input.firstName} ${input.lastName}`, ipHash]);
      await client.query(`insert into audit_log (organisation_id, action, entity, entity_id, after)
        values ($1,'trial_started','person',$2,$3)`, [org.id, person.id, JSON.stringify({ ends, source, referral: referralState })]);
      await client.query('commit');
    } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
    return { existing: false, personId: person.id, email: input.email, ends, org, source };
  },

  /** A person's own trial, for their home screen. Null when there is none. */
  async mine(actor, personId) {
    await family.assertMayActFor(actor, personId);
    return one(`select t.id, t.status, to_char(t.starts,'YYYY-MM-DD') as starts, to_char(t.ends,'YYYY-MM-DD') as ends,
        o.name as club, o.slug, o.timezone,
        (select count(*)::int from attendance a where a.person_id = t.person_id and a.organisation_id = t.organisation_id
          and a.session_date >= t.starts) as classes
      from member_trial t join organisation o on o.id = t.organisation_id
      where t.person_id = $1 and t.status <> 'converted' order by t.created_at desc limit 1`, [personId]);
  },

  /** The prices on offer to somebody joining, at their club. */
  async prices(actor, personId) {
    const t = await this.mine(actor, personId);
    if (!t) throw new NotFound('Trial');
    const org = await one('select id, timezone from organisation where slug = $1', [t.slug]);
    const today = await todayAt(org);
    const p = await one('select date_of_birth::text as dob from person where id = $1', [personId]);
    const schedule = await feeRows(org.id);
    const options = Object.entries(PERIODS).filter(([, v]) => v.months)
      .map(([period, v]) => ({ period, label: v.label, fee: feeFor(schedule, { adultAge: region().adultAge, ageYears: ageOnDate(p.dob, today), period, today }) }))
      .filter((o) => o.fee);
    return { trial: t, options, orgId: org.id };
  },

  /**
   * "Join now". Asks for the first membership payment at the club's own price. When it is paid, the
   * membership starts from the day the trial ends (or today, if it already has).
   */
  async joinNow(actor, personId, period) {
    const { trial, options, orgId } = await this.prices(actor, personId);
    const choice = options.find((o) => o.period === period);
    if (!choice) throw new Invalid('Choose how you would like to pay.');
    const org = await one('select * from organisation where id=$1', [orgId]);

    const client = await pool.connect();
    try {
      await client.query('begin');
      let { rows: [a] } = await client.query(`select id, status from affiliation where person_id=$1 and organisation_id=$2
        and role='member' and ends is null for update`, [personId, orgId]);
      if (a?.status === 'active') throw new Invalid('You are already a member.');
      if (!a) {
        // The trial ran out. Joining now starts an ordinary membership that becomes active once it is paid.
        ({ rows: [a] } = await client.query(`insert into affiliation (person_id, organisation_id, role, starts, status)
          values ($1,$2,'member',$3::date,'lapsed') returning id, status`, [personId, orgId, await todayAt(org)]));
      }
      const open = (await client.query(`select py.id from payment py join payment_line l on l.payment_id = py.id
        where l.renews_affiliation_id = $1 and py.status in ('pending','awaiting','failed')`, [a.id])).rows[0];
      if (open) { await client.query('commit'); return { paymentId: open.id, existing: true }; }
      const { rows: [pay] } = await client.query(`insert into payment (organisation_id, person_id, amount_cents, currency, status, requested_by)
        values ($1,$2,$3,$4,'pending',$5) returning id`, [orgId, personId, choice.fee.amount_cents, choice.fee.currency ?? region().currency, actor]);
      await client.query(`insert into payment_line (payment_id, kind, description, amount_cents, renews_affiliation_id, renews_months)
        values ($1,'dojo_fee',$2,$3,$4,$5)`, [pay.id, `${choice.fee.label} — membership ${choice.label.toLowerCase()}`,
        choice.fee.amount_cents, a.id, PERIODS[period].months]);
      await client.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
        values ($1,$2,'trial_join_requested','payment',$3,$4)`, [actor, orgId, pay.id, JSON.stringify({ period, amountCents: choice.fee.amount_cents })]);
      await client.query('commit');
      return { paymentId: pay.id, existing: false };
    } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
  },
};

export const referrals = {
  /** A member's own code and what has come of it. Made the first time it is asked for. */
  async mine(actor, personId) {
    const how = await family.assertMayActFor(actor, personId);
    if (how !== 'self') throw new Forbidden();
    const home = await one(`select o.id, o.name, o.slug, o.settings from affiliation a join organisation o on o.id = a.organisation_id
      where a.person_id = $1 and a.role = 'member' and a.status = 'active' and a.ends is null limit 1`, [personId]);
    if (!home) return { eligible: false, reason: 'Only current members can refer a friend.' };
    const settings = readGrowth(home.settings?.growth);
    if (!settings.referral.enabled || !settings.trial.enabled) return { eligible: false, reason: `${home.name} is not running a referral offer at the moment.` };

    let code = (await one('select code from referral_code where person_id = $1', [personId]))?.code;
    for (let tries = 0; !code && tries < 8; tries++) {
      const made = await one(`insert into referral_code (person_id, code) values ($1,$2) on conflict do nothing returning code`, [personId, newCode()]);
      code = made?.code ?? (await one('select code from referral_code where person_id = $1', [personId]))?.code;
    }
    const rows = await q(`select r.id, r.status, r.note, p.first_name, to_char(r.created_at,'YYYY-MM-DD') as when
      from referral r join person p on p.id = r.referred_id where r.referrer_id = $1 order by r.created_at desc`, [personId]);
    const rewards = await q(`select w.id, w.kind, w.weeks, w.cents, w.note, w.status, to_char(w.created_at,'YYYY-MM-DD') as when
      from referral_reward w where w.person_id = $1 order by w.created_at desc`, [personId]);
    return { eligible: true, club: home.name, slug: home.slug, code, offer: rewardText(settings.referral.referrer), referred: rewardText(settings.referral.referred),
      days: settings.trial.days, rows, rewards: rewards.map((w) => ({ ...w, text: rewardText({ kind: w.kind, weeks: w.weeks, cents: w.cents, note: w.note }) })) };
  },

  /** What somebody sees when they follow a code: who invited them, and where to sign up. */
  async landing(code) {
    const c = normaliseCode(code);
    if (!c) return null;
    const row = await one(`select p.first_name, o.slug, o.name, o.settings
      from referral_code rc join person p on p.id = rc.person_id
      join affiliation a on a.person_id = p.id and a.role = 'member' and a.status = 'active' and a.ends is null
      join organisation o on o.id = a.organisation_id where rc.code = $1 limit 1`, [c]);
    if (!row) return null;
    const g = readGrowth(row.settings?.growth);
    if (!g.trial.enabled || !g.referral.enabled) return null;
    return { friend: row.first_name, club: row.name, slug: row.slug, days: g.trial.days, reward: rewardText(g.referral.referred), code: c };
  },

  /**
   * Has this referral earned its reward? Called when the referred person joins, and again by the daily
   * run while they are still working towards the club's conditions.
   */
  async qualify(referralId) {
    const r = await one(`select r.*, o.settings, o.timezone, t.starts::text as trial_starts
      from referral r join organisation o on o.id = r.organisation_id
      left join member_trial t on t.person_id = r.referred_id and t.organisation_id = r.organisation_id
      where r.id = $1`, [referralId]);
    if (!r || r.status !== 'member') return null;
    const settings = readGrowth(r.settings?.growth);
    const classes = (await one(`select count(*)::int as n from attendance where person_id = $1 and organisation_id = $2 and session_date >= $3::date`,
      [r.referred_id, r.organisation_id, r.trial_starts ?? r.created_at.toISOString().slice(0, 10)])).n;
    const active = !!(await one(`select 1 as x from affiliation where person_id = $1 and organisation_id = $2
      and role='member' and status='active' and ends is null`, [r.referrer_id, r.organisation_id]));
    const rewardsThisYear = (await one(`select count(*)::int as n from referral where referrer_id = $1 and status = 'rewarded'
      and rewarded_at > now() - interval '1 year'`, [r.referrer_id])).n;
    const verdict = referralQualifies({ trialClasses: classes, referrerActive: active, rewardsThisYear, settings });

    if (!verdict.ok) {
      await pool.query(`update referral set note = $2, status = case when $3 then status else 'void' end where id = $1`, [referralId, verdict.reason, !!verdict.wait]);
      return { rewarded: false, reason: verdict.reason };
    }
    const today = await todayAt({ timezone: r.timezone });
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`update referral set status = 'rewarded', rewarded_at = now(), note = null where id = $1 and status = 'member'`, [referralId]);
      for (const reward of rewardsFor(settings)) {
        const to = reward.to === 'referrer' ? r.referrer_id : r.referred_id;
        const auto = AUTOMATIC.includes(reward.kind);
        await client.query(`insert into referral_reward (referral_id, person_id, kind, weeks, cents, note, status, given_at)
          values ($1,$2,$3,$4,$5,$6,$7, case when $7 = 'given' then now() end)`,
          [referralId, to, reward.kind, reward.weeks, reward.cents, reward.note || null, auto ? 'given' : 'owed']);
        if (auto && reward.kind === 'free_weeks')
          await client.query(`update affiliation set paid_until = greatest(coalesce(paid_until, $3::date), $3::date) + ($4::int * 7)
            where person_id = $1 and organisation_id = $2 and role = 'member' and ends is null and status = 'active'`,
            [to, r.organisation_id, today, reward.weeks]);
      }
      await client.query(`insert into audit_log (organisation_id, action, entity, entity_id, after)
        values ($1,'referral_rewarded','referral',$2,$3)`, [r.organisation_id, referralId, JSON.stringify({ classes })]);
      await client.query('commit');
    } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
    return { rewarded: true };
  },
};

export const growth = {
  /** The club's trials, referrals and rewards, and how well it is all working. */
  async overview(actor, orgId) {
    await assertRole(actor, orgId, REGISTER);
    const org = await clubOnly(orgId);
    const today = await todayAt(org);
    const settings = readGrowth(org.settings?.growth);
    const trialRows = await q(`select t.id, p.id as person_id, trim(concat_ws(' ', p.first_name, p.last_name)) as name, p.email::text as email, p.phone,
        t.status, t.source, to_char(t.starts,'YYYY-MM-DD') as starts, to_char(t.ends,'YYYY-MM-DD') as ends, p.display_number,
        (select count(*)::int from attendance a where a.person_id = t.person_id and a.organisation_id = t.organisation_id and a.session_date >= t.starts) as classes
      from member_trial t join person p on p.id = t.person_id where t.organisation_id = $1 order by t.created_at desc limit 200`, [orgId]);
    const referralRows = await q(`select r.id, r.status, r.note, to_char(r.created_at,'YYYY-MM-DD') as when,
        trim(concat_ws(' ', a.first_name, a.last_name)) as referrer, trim(concat_ws(' ', b.first_name, b.last_name)) as referred
      from referral r join person a on a.id = r.referrer_id join person b on b.id = r.referred_id
      where r.organisation_id = $1 order by r.created_at desc limit 200`, [orgId]);
    const owed = await q(`select w.id, w.kind, w.weeks, w.cents, w.note, trim(concat_ws(' ', p.first_name, p.last_name)) as name, p.display_number
      from referral_reward w join referral r on r.id = w.referral_id join person p on p.id = w.person_id
      where r.organisation_id = $1 and w.status = 'owed' order by w.created_at`, [orgId]);
    const c = (st) => trialRows.filter((t) => t.status === st).length;
    const revenue = (await one(`select coalesce(sum(py.amount_cents),0)::int as cents from payment py join referral r on r.referred_id = py.person_id
      where r.organisation_id = $1 and py.organisation_id = $1 and py.status = 'succeeded'`, [orgId])).cents;
    const top = await q(`select trim(concat_ws(' ', p.first_name, p.last_name)) as name, count(*)::int as n,
        count(*) filter (where r.status = 'rewarded')::int as rewarded
      from referral r join person p on p.id = r.referrer_id where r.organisation_id = $1 and r.status <> 'void'
      group by p.id, p.first_name, p.last_name order by n desc, name limit 5`, [orgId]);
    return { org, today, settings, offer: rewardText(settings.referral.referrer),
      trials: trialRows.map((t) => ({ ...t, left: t.status === 'trialling' ? trialDaysLeft(t.ends, today) : null })),
      referrals: referralRows, owed: owed.map((w) => ({ ...w, text: rewardText(w) })), top,
      report: { started: trialRows.length, trialling: c('trialling'), converted: c('converted'), ended: c('ended'),
        conversion: trialRows.length - c('trialling') ? Math.round((c('converted') / (trialRows.length - c('trialling'))) * 100) : null,
        referrals: referralRows.length, referralTrials: referralRows.filter((r) => r.status !== 'void').length,
        referralMembers: referralRows.filter((r) => ['member', 'rewarded'].includes(r.status)).length,
        rewarded: referralRows.filter((r) => r.status === 'rewarded').length, revenueCents: revenue } };
  },

  async save(actor, orgId, input) {
    await assertRole(actor, orgId, MANAGE);
    await clubOnly(orgId);
    const settings = readGrowthForm(input);
    const problems = problemsWithGrowth(settings);
    if (problems.length) throw new Invalid(problems.join(' '));
    await pool.query(`update organisation set settings = coalesce(settings,'{}'::jsonb) || jsonb_build_object('growth', $2::jsonb), updated_at = now() where id = $1`,
      [orgId, JSON.stringify(settings)]);
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
      values ($1,$2,'growth_settings','organisation',$2,$3)`, [actor, orgId, JSON.stringify(settings)]);
  },

  /** Somebody handed over a reward that the system cannot give itself. */
  async markGiven(actor, orgId, rewardId) {
    await assertRole(actor, orgId, REGISTER);
    const row = await one(`update referral_reward w set status = 'given', given_at = now(), given_by = $3
      from referral r where w.id = $1 and r.id = w.referral_id and r.organisation_id = $2 and w.status = 'owed' returning w.id`, [rewardId, orgId, actor]);
    if (!row) throw new NotFound('Reward');
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id) values ($1,$2,'reward_given','referral_reward',$3)`, [actor, orgId, rewardId]);
  },

  /**
   * The daily run: remind people their trial is ending, end the ones that have, look again at referrals
   * still working towards their conditions, tell people about rewards, and forget trials nobody joined.
   * `signInLink(email, redirectTo)` gives a one-use link; it lives in the server because it needs auth.
   */
  async run({ messenger, baseFrom, origin, signInLink }) {
    const report = { reminded: 0, ended: 0, requalified: 0, told: 0, forgotten: 0 };
    const clubs = await q(`select id, name, slug, timezone, settings from organisation where type = 'club' and status = 'active'
      and (settings->'growth'->'trial'->>'enabled')::boolean is true`);
    for (const org of clubs) {
      const today = await todayAt(org);
      const rows = await q(`select t.id, t.person_id, t.status, to_char(t.ends,'YYYY-MM-DD') as ends, t.sent_week is not null as sent7,
          t.sent_last_days is not null as sent2, p.email::text as email, p.first_name
        from member_trial t join person p on p.id = t.person_id where t.organisation_id = $1 and t.status = 'trialling'`, [org.id]);
      const due = trialsDue(rows, today);
      const link = async (r) => (signInLink && r.email ? await signInLink(r.email, `/me/${r.person_id}/join`) : `${origin}/signin`);
      for (const [list, col, subject, text] of [
        [due.week, 'sent_week', (r) => `Your free month at ${org.name}: a week to go`,
          (r, url) => `Hi ${r.first_name},\n\nYour free month at ${org.name} ends on ${r.ends}. If you would like to carry on training, you can join online:\n${url}\n\nSee you in class.`],
        [due.lastDays, 'sent_last_days', (r) => `Your free month at ${org.name} ends soon`,
          (r, url) => `Hi ${r.first_name},\n\nYour free month at ${org.name} ends on ${r.ends}. To keep training without a gap, join here:\n${url}\n\nIf it is not for you, no need to do anything.`]]) {
        for (const r of list) {
          const sent = await clubMail(org, { messenger, baseFrom }, r.email, subject(r), text(r, await link(r)));
          await pool.query(`update member_trial set ${col} = now() where id = $1`, [r.id]);   // marked even if the mail failed: do not nag daily /* security-ok: col is one of two literal column names in the loop above */
          if (sent) report.reminded++;
        }
      }
      for (const r of due.ended) {
        const client = await pool.connect();
        try {
          await client.query('begin');
          await client.query(`update member_trial set status = 'ended', ended_at = now() where id = $1 and status = 'trialling'`, [r.id]);
          await client.query(`update affiliation set status = 'resigned', ends = $3::date where person_id = $1 and organisation_id = $2
            and role = 'member' and status = 'trial' and ends is null`, [r.person_id, org.id, r.ends]);
          await client.query('commit');
        } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
        await clubMail(org, { messenger, baseFrom }, r.email, `Your free month at ${org.name} has ended`,
          `Hi ${r.first_name},\n\nYour free month at ${org.name} has finished. Thank you for coming along. If you would like to join, sign in and choose how to pay:\n${await link(r)}\n\nWe will keep your details for ${TRIAL_RETAIN_DAYS} days in case you do, then remove them.`);
        report.ended++;
      }
    }

    // Referrals still working towards the club's conditions.
    for (const r of await q(`select id from referral where status = 'member' and converted_at > now() - interval '60 days'`))
      if ((await referrals.qualify(r.id))?.rewarded) report.requalified++;

    // Tell people about rewards they have earned.
    const fresh = await q(`select w.id, w.person_id, w.kind, w.weeks, w.cents, w.note, w.status, r.organisation_id, r.referrer_id, p.email::text as email, p.first_name,
        o.name as club, o.slug, o.timezone
      from referral_reward w join referral r on r.id = w.referral_id join person p on p.id = w.person_id
      join organisation o on o.id = r.organisation_id where w.notified_at is null limit 100`);
    for (const w of fresh) {
      const what = rewardText(w);
      const mine = w.person_id === w.referrer_id;
      const sent = await clubMail({ id: w.organisation_id, name: w.club, slug: w.slug }, { messenger, baseFrom }, w.email,
        mine ? 'A friend you invited has joined' : `Welcome to ${w.club}: your reward`,
        `Hi ${w.first_name},\n\n${mine ? 'Somebody you invited has joined' : 'Thank you for joining'} ${w.club}, so there is a reward for you: ${what}.\n${
          w.status === 'given' ? 'It has already been added to your membership.' : 'The club will arrange it with you.'}`);
      await pool.query('update referral_reward set notified_at = now() where id = $1', [w.id]);
      if (sent) report.told++;
    }

    // Forget trials nobody joined, after a while. A person with any other tie to the club is left alone.
    const stale = (await q(`select p.id from person p join member_trial t on t.person_id = p.id
      where t.status = 'ended' and t.ended_at < now() - make_interval(days => $1) and p.display_number is null
        and not exists (select 1 from affiliation a where a.person_id = p.id and a.ends is null)
        and not exists (select 1 from payment py where py.person_id = p.id)
        and not exists (select 1 from event_entry x where x.person_id = p.id)
        and not exists (select 1 from grading_record g where g.person_id = p.id)`, [TRIAL_RETAIN_DAYS])).map((r) => r.id);
    if (stale.length) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        // Their sign-in goes with them. The audit trail is append-only and points at the account row, so
        // the row stays — emptied of the address and of the person — and the trail keeps what happened
        // without saying who it happened to.
        const { rows: gone } = await client.query(`select id, email::text as email from account where person_id = any($1::uuid[])`, [stale]);
        const ids = gone.map((a) => a.id);
        await client.query('delete from session where account_id = any($1::uuid[])', [ids]);
        await client.query('delete from login_link where account_id = any($1::uuid[])', [ids]);
        await client.query('delete from login_attempt where email = any($1::citext[])', [gone.map((a) => a.email)]);
        await client.query(`update account set person_id = null, email = 'forgotten-' || id::text || '@invalid.example' where id = any($1::uuid[])`, [ids]);
        await client.query('delete from person where id = any($1::uuid[])', [stale]);
        await client.query('commit');
      } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
    }
    const gone = stale;
    report.forgotten = gone.length;
    await q(`update member_trial set ip_hash = null where ip_hash is not null and created_at < now() - interval '2 days'`);
    return report;
  },
};
