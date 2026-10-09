/**
 * HONBU — data access: shared
 *
 * Part of the data layer (see ../data.mjs). Every function that touches an organisation takes an `actor` and
 * checks permission in SQL, not in the caller.
 */

import { pool } from '../../infrastructure/postgres/pool.mjs';
import { DEFAULT_TIMEZONE } from '../../core/domain/defaults.mjs';
import { senderFor } from '../../core/domain/messaging.mjs';
import { statusOf, daysLeft, latestPerQualification, clearance } from '../../core/domain/qualification.mjs';
import { MANAGE, WRITE } from '../../core/domain/access.mjs';
import { people } from './people.mjs';

export const q = async (text, params = []) => (await pool.query(text, params)).rows;

export const one = async (text, params = []) => (await q(text, params))[0] ?? null;

export class Forbidden extends Error {
  constructor(msg = 'Not permitted') { super(msg); this.status = 403; }
}

export class NotFound extends Error {
  constructor(msg = 'Not found') { super(msg); this.status = 404; }
}

export class Invalid extends Error {
  constructor(msg) { super(msg); this.status = 422; }
}

/** Throws unless `actor` holds one of `roles` at or above `orgId`. */
export async function assertRole(actor, orgId, roles = MANAGE) {
  const row = await one('select has_role_at($1,$2,$3) as ok', [actor, orgId, roles]);
  if (!row?.ok) throw new Forbidden();
}

/**
 * Writing a page and publishing one are different jobs. A contributor is
 * somebody trusted to write; putting words in front of the public is the
 * organisation's decision.
 */
export const WRITE_PAGES = WRITE;

/**
 * Store an image and its bytes in one transaction. No role check: the caller has already
 * decided the actor may put a picture here (an administrator adding to the library, or a person
 * or their guardian adding a photograph to their own record).
 */
export async function insertAsset(actor, orgId, { bytes, identified, filename, altText = null,
                                          credit = null, consentRef = null }) {

  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows: [row] } = await client.query(`
      insert into asset (organisation_id, kind, storage_key, filename, mime,
                         width, height, bytes, alt_text, credit, consent_ref)
      values ($1,'image','',$2,$3,$4,$5,$6,$7,$8,$9)
      returning *`,
      [orgId, filename, identified.mime, identified.width, identified.height,
       identified.bytes, altText?.trim() || null, credit?.trim() || null,
       consentRef?.trim() || null]);

    await client.query(
      `insert into asset_blob (asset_id, bytes) values ($1,$2)`,
      [row.id, bytes]);

    await client.query(`
      insert into audit_log (account_id, organisation_id, action, entity,
                             entity_id, after)
      values ($1,$2,'asset_upload','asset',$3,$4)`,
      [actor, orgId, row.id,
       JSON.stringify({ filename, mime: identified.mime,
                        width: identified.width, height: identified.height,
                        bytes: identified.bytes })]);

    await client.query('commit');
    return row;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// families, and a person's own view of themselves
//
// A signed-in member sees themselves and, if they are a parent or guardian,
// the children linked to them while those children are minors. Nothing else:
// every function here starts by working out who this account may act for, and
// refuses anyone outside that set before reading a row.
// ---------------------------------------------------------------------------

export const PERSON_COLUMNS = `p.id, p.display_number, p.first_name, p.last_name, p.preferred_name,
  p.date_of_birth::text as date_of_birth, p.gender, p.email, p.phone`;

export async function homesOf(personId) {
  const { rows } = await pool.query(`
    select organisation_id from affiliation where person_id=$1 and ends is null`, [personId]);
  return rows.map((r) => r.organisation_id);
}

// ---------------------------------------------------------------------------
// fees and renewals
//
// Each dojo sets its own prices. Asking for a renewal creates an ordinary
// payment — to the dojo — whose line says which membership it renews and for
// how long. However it is paid (online, cash, transfer), paying moves the
// membership on. Somebody marked exempt is never asked.
// ---------------------------------------------------------------------------

export const clubOnly = async (orgId) => {
  const org = await one('select * from organisation where id=$1', [orgId]);
  if (!org) throw new NotFound('Organisation');
  if (org.type !== 'club') throw new Invalid('Fees are set by each club.');
  return org;
};

export const feeRows = (orgId) => q(`select id, label, amount_cents, currency, period, applies_to,
        to_char(effective_from,'YYYY-MM-DD') as effective_from,
        to_char(effective_to,'YYYY-MM-DD') as effective_to
      from fee_schedule where organisation_id = $1
      order by period, applies_to, effective_from desc`, [orgId]);

export const todayAt = async (org) =>
  (await one(`select to_char((now() at time zone $1)::date,'YYYY-MM-DD') as d`, [org.timezone])).d;

export async function attendanceClub(orgId) {
  const org = await one('select * from organisation where id=$1', [orgId]);
  if (!org) throw new NotFound('Organisation');
  if (org.type !== 'club') throw new Invalid('Attendance is kept by each club.');
  return org;
}

export const CATALOGUE_FROM = `from organisation me join organisation a on me.path <@ a.path
  join qualification q on q.organisation_id = a.id where me.id = $1`;

export const qualToday = async (orgId) => {
  const o = await one('select timezone from organisation where id=$1', [orgId]);
  return (await one(`select to_char((now() at time zone $1)::date,'YYYY-MM-DD') as d`, [o?.timezone ?? DEFAULT_TIMEZONE])).d;
};

export const AWARD_SELECT = `
  select qa.id, qa.person_id, qa.qualification_id, to_char(qa.awarded_on,'YYYY-MM-DD') as awarded_on,
         to_char(qa.expires_on,'YYYY-MM-DD') as expires_on, qa.issued_by_other, qa.reference,
         q.label, q.code, q.category, q.required_for
  from qualification_award qa join qualification q on q.id = qa.qualification_id`;

/** An award with its state, newest-counting first. Superseded awards are flagged. */
export function describeAwards(rows, today) {
  const latest = new Set(latestPerQualification(rows).map((a) => a.id));
  return rows.map((a) => ({ ...a, state: statusOf(a.expires_on, today), days_left: daysLeft(a.expires_on, today),
    counts: latest.has(a.id) })).sort((x, y) => (y.counts - x.counts) || String(y.awarded_on).localeCompare(x.awarded_on));
}

export async function complianceData(orgId) {
  const org = await one('select * from organisation where id=$1', [orgId]);
  const today = await qualToday(orgId);
  const required = await q(`select q.id, q.label ${CATALOGUE_FROM} and 'instruct' = any(q.required_for) order by q.label`, [orgId]);
  const people = await q(`
    select p.id as person_id, p.display_number, nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') as name,
           a.role, o.name as club
    from organisation root join organisation o on o.path <@ root.path and o.type = 'club'
    join affiliation a on a.organisation_id = o.id and a.ends is null and a.status = 'active'
      and a.role in ('instructor','assistant')
    join person p on p.id = a.person_id
    where root.id = $1 order by o.name, p.last_name, p.first_name`, [orgId]);
  const awards = people.length ? await q(`${AWARD_SELECT} where qa.person_id = any($1::uuid[])`, [people.map((p) => p.person_id)]) : [];
  const rows = people.map((p) => {
    const c = clearance(required, awards.filter((a) => a.person_id === p.person_id), today);
    return { ...p, ...c };
  });
  // Anything lapsing among everybody, instructor or not.
  const soon = await q(`
    select p.id as person_id, nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') as name, o.name as club,
           qa.id, qa.qualification_id, to_char(qa.awarded_on,'YYYY-MM-DD') as awarded_on, to_char(qa.expires_on,'YYYY-MM-DD') as expires_on, q.label
    from organisation root join organisation o on o.path <@ root.path and o.type = 'club'
    join affiliation a on a.organisation_id = o.id and a.ends is null and a.status = 'active'
    join person p on p.id = a.person_id
    join qualification_award qa on qa.person_id = p.id join qualification q on q.id = qa.qualification_id
    where root.id = $1 and qa.expires_on is not null and qa.expires_on < current_date + $2::int + 1
    order by qa.expires_on`, [orgId, 60]);
  const expiring = latestPerQualification(soon).map((a) => ({ ...a, state: statusOf(a.expires_on, today), days_left: daysLeft(a.expires_on, today) }))
    .filter((a) => ['expiring', 'expired'].includes(a.state)).sort((a, b) => a.expires_on.localeCompare(b.expires_on));
  return { org, today, required, rows, notCleared: rows.filter((r) => !r.cleared), expiring,
    reminders: org.type === 'club' ? (await one(`select coalesce((settings->'reminders'->>'qualifications')::boolean,false) as on from organisation where id=$1`, [orgId])).on : null };
}

export const localNow = (tz) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz || DEFAULT_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
};

export const ageOnDate = (dob, date) => {
  if (!dob) return null;
  const [y, m, d] = String(dob).slice(0, 10).split('-').map(Number);
  const [cy, cm, cd] = date.split('-').map(Number);
  return cy - y - ((cm < m || (cm === m && cd < d)) ? 1 : 0);
};

/** Best-effort email from the club. A message that cannot be sent never undoes what it was about. */
export async function clubMail(org, { messenger, baseFrom }, to, subject, text) {
  try {
    const contact = (await one('select email from dojo_profile where organisation_id=$1', [org.id]))?.email ?? null;
    const sender = senderFor({ club: org, baseFrom, contactEmail: contact });
    if (!messenger || !sender || !to) return false;
    await messenger.send({ to, subject: String(subject).slice(0, 150), text, kind: 'trial', sender });
    return true;
  } catch { return false; }
}

export const clubMailer = clubMail;
