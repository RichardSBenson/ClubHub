/**
 * HONBU — data access
 *
 * Every function that touches an organisation takes an `actor` and checks
 * permission in SQL, not in the caller. There is no way to query a branch you
 * do not have a grant on, because the check is in the query itself.
 */

// The pool lives in infrastructure, where it belongs. Re-exported here because
// plenty of adapter code already imports it from this module.
export { pool } from '../infrastructure/postgres/pool.mjs';
import { applyRegister } from './register-import.mjs';
import { parseCsv } from '../core/domain/register-csv.mjs';
import { pool } from '../infrastructure/postgres/pool.mjs';
import { problemsWithPerson, problemsWithMembership, normaliseGender }
  from '../core/domain/people.mjs';
import { payeeFor, groupByPayee, problemsWithPaymentRequest, problemsWithPayment, KINDS as PAY_KINDS }
  from '../core/domain/payments.mjs';
import { isTestProvider } from '../infrastructure/payments/providers.mjs';
import { dueForReminder, reminderText, PERIODS, extendedUntil, standing, feeFor, problemsWithFee, problemsWithExemption,
         MANUAL_METHODS } from '../core/domain/membership.mjs';
import { centsFrom } from '../core/domain/payments.mjs';
import { problemsWithMessage, senderFor, chooseRecipients, renderBody }
  from '../core/domain/messaging.mjs';
import crypto from 'node:crypto';

const q = async (text, params = []) => (await pool.query(text, params)).rows;
const one = async (text, params = []) => (await q(text, params))[0] ?? null;

export class Forbidden extends Error {
  constructor(msg = 'Not permitted') { super(msg); this.status = 403; }
}
export class NotFound extends Error {
  constructor(msg = 'Not found') { super(msg); this.status = 404; }
}
export class Invalid extends Error {
  constructor(msg) { super(msg); this.status = 422; }
}

const MANAGE = ['owner', 'administrator'];
const REGISTER = ['owner', 'administrator', 'registrar'];
const TEACH = ['owner', 'administrator', 'registrar', 'instructor'];

/** Throws unless `actor` holds one of `roles` at or above `orgId`. */
export async function assertRole(actor, orgId, roles = MANAGE) {
  const row = await one('select has_role_at($1,$2,$3) as ok', [actor, orgId, roles]);
  if (!row?.ok) throw new Forbidden();
}

// ---------------------------------------------------------------------------
// organisations
// ---------------------------------------------------------------------------

export const orgs = {
  async bySlug(slug) {
    return one(`select * from organisation where slug = $1`, [slug]);
  },

  /**
   * What this organisation calls things.
   *
   * Settings are inherited down the tree, so the nearest ancestor that
   * declares a vocabulary wins — a federation sets it once and every club
   * under it speaks the same way, unless one of them says otherwise.
   *
   * The admin serves more than one federation from one deployment, so this
   * cannot come from a settings file. A taekwondo federation reading the word
   * "Dojo" in its own register is the whole problem in one word.
   */
  async vocabulary(orgId) {
    if (!orgId) return {};
    const row = await one(`
      select a.settings->'vocabulary' as vocabulary
      from organisation target
      join organisation a on target.path <@ a.path
      where target.id = $1
        and a.settings ? 'vocabulary'
      order by nlevel(a.path) desc
      limit 1`, [orgId]);
    const v = row?.vocabulary ?? {};
    return Object.fromEntries(Object.entries(v)
      .filter(([k, val]) => !k.startsWith('_') && typeof val === 'string' && val.trim()));
  },

  /**
   * Whose grading ladder applies here.
   *
   * The nearest ancestor, itself included, that defines grades. Not "the
   * federation": a multinational body and each of its national members can
   * both keep a ladder, and the one nearest the club is the one it grades on.
   * A club that defines none inherits from whoever above it does.
   */
  async ladderOwnerOf(orgId) {
    if (!orgId) return null;
    return one(`
      select a.*
      from organisation target
      join organisation a on target.path <@ a.path
      where target.id = $1
        and exists (select 1 from grade g where g.organisation_id = a.id)
      order by nlevel(a.path) desc
      limit 1`, [orgId]);
  },

  /** The whole subtree beneath (and including) an organisation. */
  async subtree(rootId) {
    return q(`
      select o.*, (select count(*) from organisation c where c.parent_id = o.id) as children
      from organisation root
      join organisation o on o.path <@ root.path
      where root.id = $1
      order by o.path`, [rootId]);
  },

  /** Every organisation this account may act on. */
  async visibleTo(actor) {
    return q(`
      select o.* from visible_orgs($1) v
      join organisation o on o.id = v.organisation_id
      order by o.path`, [actor]);
  },

  /** Public dojo list for the website. No auth — this is the front page. */
  async publicDojos(rootSlug) {
    return q(`
      select o.id, o.name, o.slug, o.country_code,
             d.venue_name, d.city, d.suburb, d.latitude, d.longitude,
             d.phone, d.email, d.first_class_free,
             coalesce(json_agg(json_build_object(
               'label', t.label, 'weekday', t.weekday,
               'starts', t.starts, 'ends', t.ends
             ) order by t.weekday, t.starts)
               filter (where t.id is not null), '[]') as sessions
      from organisation root
      join organisation o on o.path <@ root.path and o.type = 'club'
      left join dojo_profile d on d.organisation_id = o.id
      left join training_session t on t.organisation_id = o.id
      where root.slug = $1 and o.status = 'active'
      group by o.id, o.name, o.slug, o.country_code, d.venue_name, d.city,
               d.suburb, d.latitude, d.longitude, d.phone, d.email,
               d.first_class_free
      order by o.name`, [rootSlug]);
  },

  async create(actor, { parentId, type, name, slug, countryCode, timezone }) {
    await assertRole(actor, parentId, MANAGE);
    const parent = await one('select path from organisation where id = $1', [parentId]);
    if (!parent) throw new NotFound('Parent organisation');
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug))
      throw new Invalid('Slug must be lowercase letters, numbers and hyphens');
    const path = `${parent.path}.${slug.replace(/-/g, '_')}`;
    return one(`
      insert into organisation (parent_id, type, name, slug, path, country_code, timezone)
      values ($1,$2,$3,$4,$5,$6,coalesce($7,'Pacific/Auckland'))
      returning *`,
      [parentId, type, name, slug, path, countryCode, timezone]);
  },
};

// ---------------------------------------------------------------------------
// people and affiliation
// ---------------------------------------------------------------------------

export const people = {
  /** Roster for one organisation. Private detail only for registrars and above. */
  async roster(actor, orgId, { includePrivate = false, subtree = false } = {}) {
    await assertRole(actor, orgId, TEACH);
    if (includePrivate) await assertRole(actor, orgId, REGISTER);

    // A national grading draws candidates from every dojo beneath it, not from
    // the federation's own roll — which is empty, because members affiliate to
    // a dojo.
    const scope = subtree
      ? `a.organisation_id in (
           select o.id from organisation root
           join organisation o on o.path <@ root.path where root.id = $1)`
      : `a.organisation_id = $1`;

    return q(`
      select p.id, p.display_number, p.first_name, p.last_name,
             -- Age TODAY, which is what a roster wants to show, and the
             -- date of birth, which is what anything deciding an age
             -- division needs. Only the derived age used to come back, so a
             -- tournament entry could not tell how old somebody would be on
             -- the day: every competitor in an age division silently failed
             -- to place, and no under-16 was ever asked for a guardian.
             date_part('year', age(p.date_of_birth))::int as age,
             p.date_of_birth, p.gender,
             cg.label as grade, cg.grade_id, cg.rank_order, cg.is_dan, cg.awarded_on as graded_on,
             a.role, a.status, a.paid_until,
             o.name as dojo, o.slug as dojo_slug
             ${includePrivate ? `, pv.emergency_name, pv.emergency_phone` : ''}
      from affiliation a
      join person p on p.id = a.person_id
      join organisation o on o.id = a.organisation_id
      left join person_current_grade cg on cg.person_id = p.id
      ${includePrivate ? 'left join person_private pv on pv.person_id = p.id' : ''}
      where ${scope} and a.ends is null /* security-ok: scope is one of two fixed fragments chosen just above */
      order by cg.rank_order desc nulls last, p.last_name`, [orgId]);
  },

  /** One person, with their whole grading history. Follows them between dojo. */
  async record(actor, personId) {
    // Any current affiliation, not just 'member' — instructors, officials and
    // supporters have records too, and they were invisible until this was fixed.
    const home = await one(`
      select organisation_id from affiliation
      where person_id = $1 and ends is null
      order by case role when 'member' then 0 else 1 end
      limit 1`, [personId]);
    if (!home) throw new NotFound('Person has no current affiliation');
    await assertRole(actor, home.organisation_id, TEACH);

    const person = await one(`
      select p.*, date_part('year', age(p.date_of_birth))::int as age
      from person p where p.id = $1`, [personId]);

    const history = await q(`
      select gr.id as record_id, g.label, g.rank_order, g.is_dan, gr.awarded_on, gr.result,
             gr.certificate_no, o.name as awarded_by, gr.ratified_on
      from grading_record gr
      join grade g on g.id = gr.grade_id
      join organisation o on o.id = gr.awarded_by_org
      where gr.person_id = $1
      order by gr.awarded_on`, [personId]);

    const affiliations = await q(`
      select o.name as organisation, a.role, a.starts, a.ends, a.status
      from affiliation a join organisation o on o.id = a.organisation_id
      where a.person_id = $1 order by a.starts`, [personId]);

    // The current organisation, so callers do not have to guess which
    // federation's ladder or vocabulary applies to this person.
    const at = await one(`
      select o.id, o.slug, o.name, o.type from affiliation a
      join organisation o on o.id = a.organisation_id
      where a.person_id = $1 and a.ends is null
      order by case a.role when 'member' then 0 else 1 end
      limit 1`, [personId]);

    return { person, history, affiliations, at };
  },

  /**
   * The restricted fields, behind the registrar role.
   *
   * Emergency contacts and medical notes are not roster data. An instructor
   * needs to know who is in the hall; they do not need everybody's medical
   * history to teach a class, and for a roll that includes children the
   * difference matters.
   */
  async privateDetail(actor, personId) {
    const home = await one(`
      select organisation_id from affiliation
      where person_id = $1 and ends is null
      order by case role when 'member' then 0 else 1 end limit 1`, [personId]);
    if (!home) throw new NotFound('Person');
    await assertRole(actor, home.organisation_id, REGISTER);
    return one('select * from person_private where person_id = $1', [personId]);
  },

  /** The membership that is running now, if there is one. */
  async currentAffiliation(personId) {
    return one(`
      select * from affiliation
      where person_id = $1 and ends is null
      order by case role when 'member' then 0 else 1 end limit 1`, [personId]);
  },

  /**
   * Put a person on the register at a club.
   *
   * Person and affiliation in one transaction, because a person with no
   * affiliation is a record nobody can find and nobody is responsible for.
   *
   * The member number is allocated here rather than typed. Federations that
   * number their members care a great deal about it, and a number chosen by
   * whoever happened to be filling in the form is how two people end up with
   * the same one.
   */
  async enrol(actor, { organisationId, firstName, lastName, preferredName = null,
                       dateOfBirth = null, gender = null, email = null,
                       phone = null, role = 'member', starts = null,
                       paidUntil = null, emergencyName = null,
                       emergencyPhone = null }) {
    await assertRole(actor, organisationId, REGISTER);

    // The same rules the import applies, so a row typed into the form and a
    // row read out of a spreadsheet are judged identically.
    const problems = [
      ...problemsWithPerson({ firstName, lastName, dateOfBirth, email, gender }),
      ...problemsWithMembership({ role, starts, paidUntil }),
    ];
    if (problems.length) throw new Invalid(problems.join('; '));

    const client = await pool.connect();
    try {
      await client.query('begin');

      // The federation's prefix, and the next number in its sequence. Inside
      // the transaction so two registrars saving at once cannot collide.
      const { rows: [fed] } = await client.query(`
        select coalesce(f.short_name, f.slug) as prefix, f.id
        from organisation target
        join organisation f on target.path <@ f.path and f.parent_id is null
        where target.id = $1`, [organisationId]);

      const prefix = (fed?.prefix ?? 'M').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5)
        || 'M';
      const { rows: [seq] } = await client.query(`
        select coalesce(max(substring(display_number from '[0-9]+$')::int), 0) + 1 as next
        from person where display_number like $1`, [`${prefix}-%`]);
      const number = `${prefix}-${String(seq.next).padStart(4, '0')}`;

      const { rows: [person] } = await client.query(`
        insert into person (display_number, first_name, last_name, preferred_name,
                            date_of_birth, gender, email, phone)
        values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [number, firstName.trim(), lastName.trim(), preferredName || null,
         dateOfBirth || null, normaliseGender(gender) ?? null, email || null, phone || null]);

      if (emergencyName || emergencyPhone) {
        await client.query(`
          insert into person_private (person_id, emergency_name, emergency_phone)
          values ($1,$2,$3)
          on conflict (person_id) do update
            set emergency_name = excluded.emergency_name,
                emergency_phone = excluded.emergency_phone`,
          [person.id, emergencyName || null, emergencyPhone || null]);
      }

      await client.query(`
        insert into affiliation (person_id, organisation_id, role, starts,
                                 status, paid_until)
        values ($1,$2,$3,coalesce($4::date, current_date),'active',$5)`,
        [person.id, organisationId, role, starts || null, paidUntil || null]);

      await client.query(`
        insert into audit_log (account_id, organisation_id, action, entity,
                               entity_id, after)
        values ($1,$2,'enrol','person',$3,$4::jsonb)`,
        [actor, organisationId, person.id,
         JSON.stringify({ role, number })]);

      await client.query('commit');
      await webhooks.emitNow(organisationId, 'member.created', { id: person.id, number, first_name: person.first_name, last_name: person.last_name, role });
      return person;
    } catch (e) {
      await client.query('rollback'); throw e;
    } finally { client.release(); }
  },

  /**
   * Give somebody access to the register.
   *
   * Creates the account if they have not got one, grants the role, and hands
   * back a sign-in link the administrator can pass on — by message, on paper,
   * or read out over the phone.
   *
   * ## Why a link an administrator can see
   *
   * Sign-in is a link emailed to you, which is right, and which means the
   * system cannot let anybody in until email is configured for that
   * federation's own domain. That is a wall in front of the first thing a new
   * install needs to do: add a second administrator.
   *
   * It is also a permanent need. A member with no email address, or an
   * address that bounces, or somebody standing in the hall who cannot receive
   * anything right now — a registrar has to be able to get them in. Every
   * membership system has this; it is what "resend the invitation" is.
   *
   * ## What it is not
   *
   * Not a way to read somebody's mail, and not a password. The link expires
   * in fifteen minutes, works once, and is recorded in the audit log with who
   * created it. An administrator who creates a link for a member can sign in
   * as that member — which is true of every system where an administrator can
   * reset a password, and is the reason this is restricted to the roles that
   * already administer the register, scoped to the organisations they
   * administer, and written down every time.
   */
  async grantAccess(actor, personId, { role = 'member', email = null,
                                       organisationId = null } = {}) {
    const person = await one('select * from person where id = $1', [personId]);
    if (!person) throw new NotFound('Person');

    const home = organisationId ?? (await one(`
      select organisation_id from affiliation
      where person_id = $1 and ends is null
      order by case role when 'member' then 0 else 1 end limit 1`,
      [personId]))?.organisation_id;
    if (!home) throw new NotFound('Person has no current affiliation');
    await assertRole(actor, home, MANAGE);

    const address = (email ?? person.email ?? '').trim().toLowerCase();
    if (!address) {
      throw new Invalid(
        `${person.first_name} has no email address on file. Add one to their `
        + 'record first — an account is identified by its address, even when '
        + 'the link is handed over rather than sent.');
    }
    if (!/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(address))
      throw new Invalid(`"${address}" does not look like an email address`);

    const client = await pool.connect();
    try {
      await client.query('begin');

      // An address already used by somebody else is a different person, not
      // this one. Silently attaching it would hand over their account.
      const { rows: [clash] } = await client.query(
        `select person_id from account where email = $1`, [address]);
      if (clash && clash.person_id && clash.person_id !== personId) {
        throw new Invalid(
          `${address} already belongs to somebody else's account.`);
      }

      const { rows: [account] } = await client.query(`
        insert into account (person_id, email) values ($1,$2)
        on conflict (email) do update set person_id = coalesce(account.person_id,
          excluded.person_id)
        returning *`, [personId, address]);

      await client.query(`
        insert into grant_role (account_id, organisation_id, role, granted_by)
        values ($1,$2,$3,$4)
        on conflict (account_id, organisation_id, role) do nothing`,
        [account.id, home, role, actor]);

      await client.query(`
        insert into audit_log (account_id, organisation_id, action, entity,
                               entity_id, after)
        values ($1,$2,'grant_access','account',$3,$4::jsonb)`,
        [actor, home, account.id, JSON.stringify({ personId, role, address })]);

      await client.query('commit');
      return { account, organisationId: home, role };
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally { client.release(); }
  },

  /** Who already has a way in, and what they may do. */
  /**
   * The titles this person currently holds.
   *
   * person_current_title has carried an address_as column since titles were
   * built and no screen has ever read it, so a federation could record that
   * somebody is Shihan and then have nowhere that said so. In a martial art
   * that is not decoration: a title is how a person is addressed in the hall,
   * and getting it wrong in front of their own students is a real discourtesy.
   */
  async titlesOf(actor, personId) {
    const row = await one(`
      select a.organisation_id from affiliation a
      where a.person_id = $1 and a.ends is null limit 1`, [personId]);
    if (row) await assertRole(actor, row.organisation_id, TEACH);
    const { rows } = await pool.query(`
      select label, short_label, address_as, how, awarded_on
      from person_current_title
      where person_id = $1
      order by rank_order desc nulls last, label`, [personId]);
    return rows;
  },

  async accessFor(actor, personId) {
    const account = await one(
      'select * from account where person_id = $1', [personId]);
    if (!account) return null;
    const roles = await q(`
      select gr.role, o.name, o.slug from grant_role gr
      join organisation o on o.id = gr.organisation_id
      where gr.account_id = $1 order by o.path`, [account.id]);
    return { account, roles };
  },

  /**
   * Write an agreed import.
   *
   * Takes the rows a person has already looked at and approved — this does not
   * decide anything, it carries out what the preview said would happen. The
   * planning is pure and lives in core/domain/roll-import.mjs; only the
   * writing is here.
   *
   * One transaction for the whole spreadsheet. A half-imported roll is the
   * worst outcome available: nobody can tell which eighty of their hundred
   * members made it, and running it again to catch the rest creates duplicates
   * of the ones that did. Either the roll is in or the club's records are
   * exactly as they were.
   *
   * Member numbers are allocated here, in sequence, inside that transaction,
   * so a second registrar importing at the same moment cannot take the same
   * numbers.
   */
  async importRoll(actor, organisationId, rows = []) {
    await assertRole(actor, organisationId, REGISTER);
    const adding = rows.filter((r) => r.action === 'add');
    if (!adding.length) throw new Invalid('There is nothing to import');

    const client = await pool.connect();
    try {
      await client.query('begin');

      const { rows: [fed] } = await client.query(`
        select coalesce(f.short_name, f.slug) as prefix
        from organisation target
        join organisation f on target.path <@ f.path and f.parent_id is null
        where target.id = $1`, [organisationId]);
      const prefix = (fed?.prefix ?? 'M').toUpperCase().replace(/[^A-Z]/g, '')
        .slice(0, 5) || 'M';

      const { rows: [seq] } = await client.query(`
        select coalesce(max(substring(display_number from '[0-9]+$')::int), 0) as last
        from person where display_number like $1`, [`${prefix}-%`]);
      let next = seq.last;

      const created = [];
      let graded = 0;

      for (const row of adding) {
        const v = row.values;
        next += 1;
        const number = `${prefix}-${String(next).padStart(4, '0')}`;

        const { rows: [person] } = await client.query(`
          insert into person (display_number, first_name, last_name,
            preferred_name, date_of_birth, gender, email, phone)
          values ($1,$2,$3,$4,$5,$6,$7,$8) returning id, display_number`,
          [number, v.firstName.trim(), v.lastName.trim(),
           v.preferredName || null, v.dateOfBirth || null, normaliseGender(v.gender) ?? null,
           v.email || null, v.phone || null]);

        if (v.emergencyName || v.emergencyPhone) {
          await client.query(`
            insert into person_private (person_id, emergency_name, emergency_phone)
            values ($1,$2,$3)`,
            [person.id, v.emergencyName || null, v.emergencyPhone || null]);
        }

        await client.query(`
          insert into affiliation (person_id, organisation_id, role, starts,
                                   status, paid_until)
          values ($1,$2,$3,coalesce($4::date, current_date),'active',$5)`,
          [person.id, organisationId, v.role ?? 'member',
           v.starts || null, v.paidUntil || null]);

        // A grade the club already holds is RECORDED, not awarded. It did not
        // happen here, there was no panel, and nothing ratified it — writing
        // it as though this system conferred it would put a fiction in the
        // one place a federation has to be able to trust. The note says where
        // it came from, so anybody reading the history later knows.
        if (v.gradeId) {
          await client.query(`
            insert into grading_record (person_id, grade_id, awarded_on,
              awarded_by_org, result, panel, notes)
            values ($1,$2,coalesce($3::date, current_date),$4,'pass','[]',$5)`,
            [person.id, v.gradeId, v.gradedOn || null, organisationId,
             'Held on joining. Imported from the club\'s own records; not '
             + 'graded through this system.']);
          graded += 1;
        }

        created.push({ id: person.id, number: person.display_number,
                       line: row.line,
                       name: `${v.firstName} ${v.lastName}`.trim() });
      }

      await client.query(`
        insert into audit_log (account_id, organisation_id, action, entity,
                               entity_id, after)
        values ($1,$2,'import','organisation',$2,$3::jsonb)`,
        [actor, organisationId,
         JSON.stringify({ added: created.length, graded,
                          numbers: created.map((c) => c.number) })]);

      await client.query('commit');
      return { added: created.length, graded, created };
    } catch (e) {
      await client.query('rollback'); throw e;
    } finally { client.release(); }
  },

  /** Who is already on this roll, in the shape the import planner compares. */
  async rollFor(actor, organisationId) {
    await assertRole(actor, organisationId, REGISTER);
    const rows = await q(`
      select p.id, p.first_name, p.last_name, p.email, p.date_of_birth
      from affiliation a join person p on p.id = a.person_id
      where a.organisation_id = $1 and a.ends is null`, [organisationId]);
    return rows.map((r) => ({
      id: r.id, firstName: r.first_name, lastName: r.last_name,
      email: r.email, dateOfBirth: r.date_of_birth,
    }));
  },

  /**
   * Change what the register says about someone.
   *
   * Grade is not here, and never will be: a grade changes by being awarded,
   * through the authority rules, not by someone editing a field.
   */
  async update(actor, personId, fields = {}) {
    const home = await one(`
      select organisation_id from affiliation
      where person_id = $1 and ends is null and role = 'member'
      union all
      select organisation_id from affiliation
      where person_id = $1 and ends is null
      limit 1`, [personId]);
    if (!home) throw new NotFound('Person');
    await assertRole(actor, home.organisation_id, REGISTER);

    const allowed = {
      first_name: fields.firstName, last_name: fields.lastName,
      preferred_name: fields.preferredName, date_of_birth: fields.dateOfBirth,
      gender: fields.gender === undefined ? undefined : (normaliseGender(fields.gender) ?? null),
      email: fields.email, phone: fields.phone,
    };
    const sets = Object.entries(allowed).filter(([, v]) => v !== undefined);

    const touchesPrivate = fields.emergencyName !== undefined
      || fields.emergencyPhone !== undefined;
    const touchesAffiliation = fields.paidUntil !== undefined
      || fields.status !== undefined;

    if (!sets.length && !touchesPrivate && !touchesAffiliation)
      throw new Invalid('Nothing to change');

    // Checked on the way in, not only on enrolment. A correction is exactly
    // where a bad date of birth gets typed, and an unvalidated update is a
    // hole straight through rules the enrolment form enforces.
    const problems = [
      ...problemsWithPerson({
        // Only what is being changed. A field left alone keeps whatever it
        // has, so demanding a first name here would refuse every edit that
        // is not also re-sending the name.
        firstName: fields.firstName ?? 'unchanged',
        lastName: fields.lastName ?? 'unchanged',
        dateOfBirth: fields.dateOfBirth,
        email: fields.email,
        gender: fields.gender,
      }),
      ...problemsWithMembership({ status: fields.status, paidUntil: fields.paidUntil }),
    ];
    if (problems.length) throw new Invalid(problems.join('; '));

    // What it said beforehand, so the audit log records a change rather than
    // just an intention. Read before the transaction opens: it is a snapshot
    // for the record, not something the write depends on.
    const was = await one(`
      select first_name, last_name, preferred_name, date_of_birth, gender,
             email, phone
      from person where id = $1`, [personId]);

    const client = await pool.connect();
    try {
      await client.query('begin');

      if (sets.length) {
        const cols = sets.map(([c], i) => `${c} = $${i + 2}`).join(', ');
        await client.query(
          `update person set ${cols}, updated_at = now() where id = $1`, /* security-ok: column names come from a fixed whitelist of person fields, values are placeholders */
          [personId, ...sets.map(([, v]) => (v === '' ? null : v))]);
      }

      // The emergency contact was not editable at all: it could be set when
      // somebody enrolled and never corrected afterwards. A phone number that
      // changed two years ago is worse than no phone number, because it is
      // the one that gets rung.
      if (touchesPrivate) {
        await client.query(`
          insert into person_private (person_id, emergency_name, emergency_phone)
          values ($1,$2,$3)
          on conflict (person_id) do update set
            emergency_name = coalesce($2, person_private.emergency_name),
            emergency_phone = coalesce($3, person_private.emergency_phone),
            updated_at = now()`,
          [personId,
           fields.emergencyName === undefined ? null : (fields.emergencyName || null),
           fields.emergencyPhone === undefined ? null : (fields.emergencyPhone || null)]);
      }

      if (touchesAffiliation) {
        await client.query(`
          update affiliation
             set paid_until = coalesce($2::date, paid_until),
                 status = coalesce($3, status)
           where person_id = $1 and ends is null`,
          [personId, fields.paidUntil || null, fields.status || null]);
      }

      await client.query(`
        insert into audit_log (account_id, organisation_id, action, entity,
                               entity_id, before, after)
        values ($1,$2,'update','person',$3,$4::jsonb,$5::jsonb)`,
        [actor, home.organisation_id, personId,
         JSON.stringify(was ?? {}), JSON.stringify(fields)]);

      await client.query('commit');
    } catch (e) {
      await client.query('rollback'); throw e;
    } finally { client.release(); }
  },

  /**
   * Move someone to another dojo. Closes the old affiliation, opens a new one.
   * The grading history is untouched — it belongs to the person.
   */
  async transfer(actor, personId, toOrgId, on = new Date()) {
    const current = await one(`
      select id, organisation_id from affiliation
      where person_id = $1 and ends is null and role = 'member'`, [personId]);
    if (!current) throw new NotFound('No current membership');
    await assertRole(actor, current.organisation_id, REGISTER);
    await assertRole(actor, toOrgId, REGISTER);

    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('update affiliation set ends = $2 where id = $1',
        [current.id, on]);
      const { rows } = await client.query(`
        insert into affiliation (person_id, organisation_id, role, starts, status)
        values ($1,$2,'member',$3,'active') returning *`,
        [personId, toOrgId, on]);
      await client.query('commit');
      return rows[0];
    } catch (e) {
      await client.query('rollback'); throw e;
    } finally { client.release(); }
  },
};

// ---------------------------------------------------------------------------
// rank
// ---------------------------------------------------------------------------

export const rank = {
  async ladder(orgId) {
    return q(`select * from grade where organisation_id = $1 order by rank_order`,
      [orgId]);
  },

  /** Who may award this grade, with what panel, ratified by whom. */
  async authorityFor(orgId, rankOrder) {
    return one(`
      select ga.*, g.label as panel_must_hold
      from grade_authority ga
      left join grade g on g.rank_order = ga.min_panel_rank
                       and g.organisation_id = ga.organisation_id
      where ga.organisation_id = $1
        and $2 between ga.from_rank_order and ga.to_rank_order`,
      [orgId, rankOrder]);
  },

  /**
   * Eligibility, computed. Returns every unmet requirement rather than a bare
   * no, because a dojo operator needs to tell the student what is missing.
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

    const grade = await one('select * from grade where id = $1', [gradeId]);
    if (!grade) throw new NotFound('Grade');
    const org = await one('select * from organisation where id = $1', [awardedByOrg]);

    const auth = await this.authorityFor(grade.organisation_id, grade.rank_order);
    if (!auth) throw new Invalid(`No authority rule covers ${grade.label}`);

    if (auth.awarded_by_type !== org.type)
      throw new Invalid(
        `${grade.label} must be awarded by a ${auth.awarded_by_type}, not a ${org.type}`);

    if (panel.length < auth.min_panel_size)
      throw new Invalid(
        `${grade.label} requires a panel of ${auth.min_panel_size}, got ${panel.length}`);

    if (auth.min_panel_rank) {
      const ranks = await q(`
        select cg.rank_order from person_current_grade cg
        where cg.person_id = any($1::uuid[])`, [panel]);
      const tooJunior = ranks.filter((r) => r.rank_order < auth.min_panel_rank);
      if (ranks.length < panel.length || tooJunior.length)
        throw new Invalid(
          `Every examiner must hold ${auth.panel_must_hold} or above`);
    }

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
   * person's own dojo, dan by an official of the federation that owns the ladder. A dojo cannot
   * type in a black belt. Nothing here is awarded: no panel, no certificate.
   */
  async recognisable(actor, personId) {
    const home = await one(`select organisation_id from affiliation
      where person_id = $1 and ends is null order by (role = 'member') desc limit 1`, [personId]);
    if (!home) return { grades: [], current: null, fed: null, mayKyu: false, mayDan: false };
    const fed = await orgs.ladderOwnerOf(home.organisation_id);
    if (!fed) return { grades: [], current: null, fed: null, mayKyu: false, mayDan: false };
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
      insert into entry_price (event_id, for_count, amount_cents, members_only, label)
      values ($1,$2,$3,$4,$5)
      on conflict (event_id, for_count, members_only) do update set
        amount_cents = excluded.amount_cents, label = excluded.label
      returning *`, [eventId, forCount, amountCents, membersOnly, label]);
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
    amountCents = null, currency = 'NZD', consent = null, notes = null,
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

export const billing = {
  /**
   * Build the affiliation invoice a parent sends a child organisation.
   * Every line names a person, so both sides can audit it.
   */
  async draftAffiliationInvoice(actor, { fromOrg, toOrg, periodStart, periodEnd,
                                         unitCents, currency = 'NZD' }) {
    await assertRole(actor, fromOrg, MANAGE);

    const members = await q(`
      select p.id, p.display_number, p.first_name, p.last_name
      from affiliation a join person p on p.id = a.person_id
      where a.organisation_id = $1 and a.role = 'member'
        and a.status = 'active' and a.ends is null
      order by p.last_name`, [toOrg]);

    const client = await pool.connect();
    try {
      await client.query('begin');
      const { rows: [inv] } = await client.query(`
        insert into invoice (from_org, to_org, period_start, period_end, currency,
                             subtotal_cents, status)
        values ($1,$2,$3,$4,$5,$6,'draft') returning *`,
        [fromOrg, toOrg, periodStart, periodEnd, currency,
         members.length * unitCents]);

      for (const m of members) {
        await client.query(`
          insert into invoice_line (invoice_id, person_id, description, quantity, unit_cents)
          values ($1,$2,$3,1,$4)`,
          [inv.id, m.id,
           `${m.first_name} ${m.last_name} (${m.display_number ?? 'no number'})`,
           unitCents]);
      }
      await client.query('commit');
      return { invoice: inv, lines: members.length };
    } catch (e) {
      await client.query('rollback'); throw e;
    } finally { client.release(); }
  },
};

// ---------------------------------------------------------------------------
// authored pages
// ---------------------------------------------------------------------------

import { validate, excerpt, toText } from '../content/blocks.mjs';
import { assertMayPublish, reasonNotToPublish } from '../core/domain/instructing.mjs';
import { readTheme } from '../site/theme.mjs';
import { problemsWithClubProfile, changesTheSite }
  from '../core/domain/club-profile.mjs';
import { problemsWithGuardianLink, isMinor, readSelfEdit, problemsWithSelfEdit }
  from '../core/domain/family.mjs';
import { problemsWithNewClub, clubSlugFrom, hasAdministrator }
  from '../core/domain/new-club.mjs';
import { destinations, problemsWithNavigation, navigationFrom, MAX_ITEMS }
  from '../content/navigation.mjs';
import { readQuery, fold } from '../content/search.mjs';

/**
 * Writing a page and publishing one are different jobs. A contributor is
 * somebody trusted to write; putting words in front of the public is the
 * organisation's decision.
 */
const WRITE_PAGES = ['owner', 'administrator', 'contributor'];

export const pages = {
  async published(orgId, slug) {
    return one(`select * from page
      where organisation_id=$1 and slug=$2 and status='published'`, [orgId, slug]);
  },

  async listPublished(orgId) {
    return q(`select slug, title, meta_description, published_at from page
      where organisation_id=$1 and status='published' order by title`, [orgId]);
  },

  /** Every page an editor may work on, drafts included. */
  async list(actor, orgId) {
    await assertRole(actor, orgId, WRITE_PAGES);
    return q(`
      select p.id, p.slug, p.title, p.status, p.published_at, p.updated_at,
             per.first_name || ' ' || per.last_name as updated_by,
             (select count(*)::int from page_revision r where r.page_id = p.id)
               as revisions
      from page p
      left join person per on per.id = p.updated_by
      where p.organisation_id = $1
      order by p.status, p.title`, [orgId]);
  },

  async byId(actor, pageId) {
    const page = await one('select * from page where id = $1', [pageId]);
    if (!page) throw new NotFound('Page');
    await assertRole(actor, page.organisation_id, WRITE_PAGES);
    return page;
  },

  /**
   * Save a draft. The document is validated on the way in — anything not in the
   * block whitelist is dropped here, not at render time.
   * Returns what was dropped so the editor can tell the author.
   */
  async save(actor, { pageId, organisationId, slug, title, body,
                      metaTitle, metaDescription, note }) {
    const orgId = organisationId ??
      (await one('select organisation_id from page where id=$1', [pageId]))?.organisation_id;
    if (!orgId) throw new NotFound('Page');
    await assertRole(actor, orgId, WRITE_PAGES);

    const { doc, dropped } = validate(body);
    if (!toText(doc).trim()) throw new Invalid('The page has no content');

    const person = await one('select person_id from account where id=$1', [actor]);
    const client = await pool.connect();
    try {
      await client.query('begin');
      let page;
      if (pageId) {
        // The address can change. A page whose web address is fixed at
        // creation is one somebody has to delete and rewrite to rename, and
        // they will — losing its revisions with it.
        ({ rows: [page] } = await client.query(`
          update page set title=$2, body=$3, meta_title=$4, meta_description=$5,
                          slug=coalesce($7, slug),
                          updated_by=$6, updated_at=now()
          where id=$1 returning *`,
          [pageId, title, doc, metaTitle, metaDescription ?? excerpt(doc),
           person?.person_id, slug || null]));
      } else {
        ({ rows: [page] } = await client.query(`
          insert into page (organisation_id, slug, title, body, meta_title,
                            meta_description, status, updated_by)
          values ($1,$2,$3,$4,$5,$6,'draft',$7) returning *`,
          [orgId, slug, title, doc, metaTitle, metaDescription ?? excerpt(doc),
           person?.person_id]));
      }

      await client.query(`
        insert into page_revision (page_id, title, body, meta_title,
                                   meta_description, saved_by, note)
        values ($1,$2,$3,$4,$5,$6,$7)`,
        [page.id, page.title, page.body, page.meta_title, page.meta_description,
         person?.person_id, note ?? null]);

      await client.query('commit');
      return { page, dropped };
    } catch (e) {
      await client.query('rollback');
      if (e.code === '23505')
        throw new Invalid(`This organisation already has a page at "${slug}".`);
      throw e;
    }
    finally { client.release(); }
  },

  /**
   * Publishing is a separate permission from writing.
   *
   * A contributor can write and correct; putting something in front of the
   * public is the organisation's decision, not the author's. Which is also
   * why unpublishing is here rather than a status field on the form.
   */
  async publish(actor, pageId) {
    const page = await one('select * from page where id=$1', [pageId]);
    if (!page) throw new NotFound('Page');
    await assertRole(actor, page.organisation_id, MANAGE);
    return one(`update page set status='published', published_at=now(), publish_at=null
      where id=$1 returning *`, [pageId]);
  },

  /**
   * Take it down without losing it.
   *
   * Back to a draft, not deleted: the words, the revisions and the address
   * all stay, so a page pulled for a correction can go back up as it was.
   */
  async unpublish(actor, pageId) {
    const page = await one('select * from page where id=$1', [pageId]);
    if (!page) throw new NotFound('Page');
    await assertRole(actor, page.organisation_id, MANAGE);
    return one(`update page set status='draft', updated_at=now()
      where id=$1 returning *`, [pageId]);
  },

  async revisions(actor, pageId) {
    const page = await one('select organisation_id from page where id=$1', [pageId]);
    if (!page) throw new NotFound('Page');
    await assertRole(actor, page.organisation_id, WRITE_PAGES);
    return q(`select r.id, r.title, r.saved_at, r.note,
                     p.first_name || ' ' || p.last_name as saved_by
              from page_revision r
              left join person p on p.id = r.saved_by
              where r.page_id=$1 order by r.saved_at desc`, [pageId]);
  },

  async restore(actor, revisionId) {
    const rev = await one(`select r.*, pg.organisation_id
      from page_revision r join page pg on pg.id = r.page_id
      where r.id=$1`, [revisionId]);
    if (!rev) throw new NotFound('Revision');
    await assertRole(actor, rev.organisation_id, MANAGE);
    return one(`update page set title=$2, body=$3, meta_title=$4,
                                meta_description=$5, updated_at=now()
      where id=$1 returning *`,
      [rev.page_id, rev.title, rev.body, rev.meta_title, rev.meta_description]);
  },
};

// ---------------------------------------------------------------------------
// assets
//
// Images belonging to a federation. The bytes are in this database, not in a
// blob service — see db/016 for why. Metadata and bytes are separate tables so
// that listing a media library does not pull megabytes through the connection
// to show a filename.
// ---------------------------------------------------------------------------

/**
 * Load the dojo register's three CSV files (dojos, class times, instructors) into this federation.
 *
 * `confirm: false` runs the whole thing and rolls it back, so the preview is exactly what saving
 * would do. Owners and administrators of the federation only.
 */
export const registerImport = {
  async run(actor, orgId, files, { confirm = false } = {}) {
    await assertRole(actor, orgId, MANAGE);
    const parent = await one('select type, parent_id from organisation where id = $1', [orgId]);
    if (!parent) throw new NotFound('Organisation');
    if (parent.type === 'club') throw new Invalid('A club cannot import other clubs.');
    const read = (t) => (String(t ?? '').trim() ? parseCsv(String(t)) : []);
    const dojos = read(files.dojos), sessions = read(files.sessions), instructors = read(files.instructors);
    if (!dojos.length && !sessions.length && !instructors.length) throw new Invalid('Paste at least one file.');
    for (const [name, rows, cols] of [['dojos', dojos, ['slug']], ['sessions', sessions, ['slug', 'weekday', 'starts', 'ends']],
                                      ['instructors', instructors, ['slug', 'first_name', 'last_name', 'dan']]]) {
      if (rows.length) for (const c of cols) if (!(c in rows[0])) throw new Invalid(`The ${name} file has no "${c}" column. The first line must be the column names. I found: ${rows.columns.slice(0, 8).join(', ')}${rows.columns.length > 8 ? ', ...' : ''}.`);
    }
    const client = await pool.connect();
    try {
      await client.query('begin');
      const report = await applyRegister(client, { dojos, sessions, instructors });
      if (confirm) {
        await client.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
          values ($1,$2,'register_import','organisation',$2,$3::jsonb)`,
          [actor, orgId, JSON.stringify({ dojos: dojos.length, sessions: sessions.length, instructors: instructors.length,
                                          updated: report.updated, published: report.published, people: report.people })]);
        await client.query('commit');
      } else await client.query('rollback');
      return report;
    } catch (e) { await client.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
  },
};

/**
 * Store an image and its bytes in one transaction. No role check: the caller has already
 * decided the actor may put a picture here (an administrator adding to the library, or a person
 * or their guardian adding a photograph to their own record).
 */
async function insertAsset(actor, orgId, { bytes, identified, filename, altText = null,
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

export const assets = {
  /** One federation's images, newest first. Never the bytes. */
  async list(actor, orgId) {
    await assertRole(actor, orgId, TEACH);
    const { rows } = await pool.query(`
      select id, filename, mime, width, height, bytes, alt_text, credit,
             created_at
      from asset
      where organisation_id = $1
      order by created_at desc`, [orgId]);
    return rows;
  },

  /**
   * An asset's metadata, with the organisation it belongs to.
   *
   * Deliberately does not check a role: the caller has to, because the check
   * depends on what it is about to do, and a function that both fetches and
   * authorises tempts a caller into thinking the fetch alone was enough.
   */
  async byId(id) {
    return one(`select * from asset where id = $1`, [id]);
  },

  /**
   * An image and its bytes, for somebody allowed to see it.
   *
   * Fetch and permission are one call here, on purpose, and it is the only way
   * to reach the bytes. An asset id is an unguessable uuid, but unguessable is
   * not a permission model — ids end up in drafts, in logs, in a browser
   * history — so the viewer must hold a role at the federation that owns it,
   * exactly as for every other record.
   */
  async forViewing(actor, id) {
    const asset = await this.byId(id);
    if (!asset) throw new NotFound('Image');
    await assertRole(actor, asset.organisation_id, TEACH);
    const row = await one(`select bytes from asset_blob where asset_id = $1`, [id]);
    if (!row?.bytes) throw new NotFound('Image');
    return { asset, bytes: row.bytes };
  },

  /** The bytes alone, for the build. No actor: the build is not a person. */
  async bytesOf(id) {
    const row = await one(`select bytes from asset_blob where asset_id = $1`, [id]);
    return row?.bytes ?? null;
  },

  /**
   * Store an image.
   *
   * `identified` comes from images.mjs, which read it out of the bytes — the
   * mime recorded here is never the one the uploader declared.
   */
  async create(actor, orgId, input) {
    await assertRole(actor, orgId, MANAGE);
    return insertAsset(actor, orgId, input);
  },

  /** Change what an image says about itself. Not its bytes — those are fixed. */
  async describe(actor, id, { altText, credit, consentRef }) {
    const asset = await this.byId(id);
    if (!asset) throw new NotFound('Image');
    await assertRole(actor, asset.organisation_id, MANAGE);
    return one(`update asset set alt_text=$2, credit=$3, consent_ref=$4
                where id=$1 returning *`,
      [id, altText?.trim() || null, credit?.trim() || null,
       consentRef?.trim() || null]);
  },

  /**
   * Which published pages use this image.
   *
   * Asked before deleting one. A page's body is a block document, and an image
   * block holds the asset's id as a string, so this looks for that id anywhere
   * in the document rather than trying to walk the block tree in SQL.
   */
  async usedBy(actor, id) {
    const asset = await this.byId(id);
    if (!asset) throw new NotFound('Image');
    await assertRole(actor, asset.organisation_id, TEACH);
    const { rows } = await pool.query(`
      select id, title, slug, status from page
      where organisation_id = $1 and body::text like $2
      order by title`, [asset.organisation_id, `%${id}%`]);
    return rows;
  },

  /**
   * Remove an image, unless a page is still pointing at it.
   *
   * Deleting one that is in use would empty that page's image block silently,
   * which is the exact failure this whole feature exists to end. So the
   * refusal names the pages and lets somebody go and fix them.
   */
  async remove(actor, id) {
    const asset = await this.byId(id);
    if (!asset) throw new NotFound('Image');
    await assertRole(actor, asset.organisation_id, MANAGE);

    const used = await this.usedBy(actor, id);
    if (used.length)
      throw new Invalid(
        `That image is used by ${used.map((p) => `"${p.title}"`).join(', ')}. `
        + 'Remove it from those pages first.');

    await pool.query(`
      insert into audit_log (account_id, organisation_id, action, entity,
                             entity_id, before)
      values ($1,$2,'asset_delete','asset',$3,$4)`,
      [actor, asset.organisation_id, id,
       JSON.stringify({ filename: asset.filename, mime: asset.mime })]);

    await pool.query(`delete from asset where id = $1`, [id]);
    return { deleted: true, filename: asset.filename };
  },
};

// ---------------------------------------------------------------------------
// news
//
// Articles are pages with a date, a hero image and somewhere to go. The one
// thing that makes them different is that a dojo's article can ask to appear
// on the federation's site, and the federation decides — see db/017. A
// federation's name on a page reads as an endorsement whether it was meant as
// one or not.
// ---------------------------------------------------------------------------

export const news = {
  /** One organisation's articles, newest first. Drafts included. */
  async list(actor, orgId) {
    await assertRole(actor, orgId, WRITE_PAGES);
    const { rows } = await pool.query(`
      select a.id, a.slug, a.title, a.summary, a.status, a.published_at,
             a.publish_up, a.publish_up_state, a.tags, a.hero_asset_id,
             about.name as about_org
      from article a
      left join organisation about on about.id = a.about_org_id
      where a.organisation_id = $1
      order by coalesce(a.published_at, 'infinity'::timestamptz) desc,
               a.title`, [orgId]);
    return rows;
  },

  /** Articles beneath this organisation that are waiting on its decision. */
  async awaitingDecision(actor, orgId) {
    await assertRole(actor, orgId, MANAGE);
    const { rows } = await pool.query(`
      select a.id, a.slug, a.title, a.summary, a.published_at,
             o.name as from_org, o.slug as from_slug
      from article a
      join organisation o on o.id = a.organisation_id
      join organisation root on root.id = $1 and o.path <@ root.path
      where a.publish_up_state = 'requested' and o.id <> $1
      order by a.published_at desc nulls last`, [orgId]);
    return rows;
  },

  async byId(actor, id) {
    const row = await one(`select * from article where id = $1`, [id]);
    if (!row) throw new NotFound('Article');
    await assertRole(actor, row.organisation_id, WRITE_PAGES);
    return row;
  },

  /**
   * Create or update a draft.
   *
   * The body goes through the same validator pages use, so a block type
   * nobody whitelisted cannot arrive here by being posted at a different URL.
   */
  async save(actor, { articleId, organisationId, slug, title, summary, body,
                      heroAssetId = null, tags = [], aboutOrgId = null }) {
    const orgId = organisationId ?? (await one(
      'select organisation_id from article where id=$1', [articleId]))?.organisation_id;
    if (!orgId) throw new NotFound('Article');
    await assertRole(actor, orgId, WRITE_PAGES);

    const { doc, dropped } = validate(body);
    if (!toText(doc).trim()) throw new Invalid('The article has no content');

    // A hero image has to belong to this federation. Otherwise an article
    // could point at another federation's photograph by id, and the build
    // would dutifully copy it onto this site.
    if (heroAssetId) {
      const owns = await one(`
        select 1 from asset a
        join organisation o on o.id = a.organisation_id
        join organisation mine on mine.id = $2
        where a.id = $1 and (o.path <@ mine.path or mine.path <@ o.path)`,
        [heroAssetId, orgId]);
      if (!owns) throw new Invalid('That image does not belong to this organisation');
    }

    const clean = (tags ?? []).map((t) => String(t).trim().toLowerCase())
      .filter(Boolean).slice(0, 12);

    const row = articleId
      ? await one(`
          update article set slug=$2, title=$3, summary=$4, body=$5,
                             hero_asset_id=$6, tags=$7, about_org_id=$8
          where id=$1 returning *`,
          [articleId, slug, title, summary, doc, heroAssetId, clean, aboutOrgId])
      : await one(`
          insert into article (organisation_id, slug, title, summary, body,
                               hero_asset_id, tags, about_org_id, status,
                               author_id)
          values ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9) returning *`,
          [orgId, slug, title, summary, doc, heroAssetId, clean, aboutOrgId,
           // Who wrote it. The column has existed since articles did and
           // nothing ever filled it in, so every article in the register was
           // anonymous. Set on creation only: later edits do not make the
           // editor the author.
           (await one('select person_id from account where id=$1', [actor]))
             ?.person_id ?? null]);

    await pool.query(`
      insert into audit_log (account_id, organisation_id, action, entity,
                             entity_id, after)
      values ($1,$2,$3,'article',$4,$5)`,
      [actor, orgId, articleId ? 'article_update' : 'article_create', row.id,
       JSON.stringify({ slug, title })]);

    return { article: row, dropped };
  },

  async publish(actor, id) {
    const a = await this.byId(actor, id);
    await assertRole(actor, a.organisation_id, MANAGE);
    return one(`update article set status='published', publish_at = null,
                  published_at = coalesce(published_at, now())
                where id=$1 returning *`, [id]);
  },

  async unpublish(actor, id) {
    const a = await this.byId(actor, id);
    await assertRole(actor, a.organisation_id, MANAGE);
    return one(`update article set status='draft' where id=$1 returning *`, [id]);
  },

  /** The author asks for it to appear on the federation's site. */
  async requestPublishUp(actor, id) {
    const a = await this.byId(actor, id);
    await assertRole(actor, a.organisation_id, MANAGE);
    if (a.status !== 'published')
      throw new Invalid('Publish it on your own site before asking for it to '
        + 'appear on the federation\'s.');
    return one(`update article set publish_up=true, publish_up_state='requested'
                where id=$1 returning *`, [id]);
  },

  /**
   * The federation decides.
   *
   * Declining is not deleting: the article stays published on the author's own
   * site. What is refused is the federation's endorsement, and an author told
   * no should be able to see that they were told no.
   */
  async decidePublishUp(actor, id, approve, { decidedBy }) {
    const a = await one(`select * from article where id=$1`, [id]);
    if (!a) throw new NotFound('Article');
    await assertRole(actor, decidedBy, MANAGE);

    // The decision belongs to an organisation this article sits beneath, and
    // not to the article's own, or a dojo would approve itself.
    const beneath = await one(`
      select 1 from organisation mine, organisation theirs
      where mine.id = $1 and theirs.id = $2
        and theirs.path <@ mine.path and theirs.id <> mine.id`,
      [decidedBy, a.organisation_id]);
    if (!beneath)
      throw new Invalid('That article does not sit beneath this organisation.');

    const row = await one(`
      update article set publish_up_state=$2, publish_up=$3
      where id=$1 returning *`,
      [id, approve ? 'approved' : 'declined', approve]);

    await pool.query(`
      insert into audit_log (account_id, organisation_id, action, entity,
                             entity_id, before, after)
      values ($1,$2,'article_publish_up','article',$3,$4,$5)`,
      [actor, decidedBy, id,
       JSON.stringify({ publish_up_state: a.publish_up_state }),
       JSON.stringify({ publish_up_state: row.publish_up_state,
                        title: row.title })]);

    return row;
  },
};

// ---------------------------------------------------------------------------
// instructors on the public site
//
// Who instructs is affiliation.role, and the website follows the register
// rather than the other way round. Whether somebody agreed to have their name,
// photograph and grade on a page anybody can read is a different fact, kept in
// instructor_profile, defaulting to no. See db/018 and the domain rules in
// core/domain/instructing.mjs.
// ---------------------------------------------------------------------------

export const instructors = {
  /**
   * Why somebody cannot be shown on their dojo's website yet, or an empty list if they can. Shown only when
   * they are 18 or over, every check the federation requires of instructors is current, and they have written
   * their few words. `never` is set when the reason is one nothing can fix by waiting for paperwork (a minor).
   */
  async readiness(dojoId, personId) {
    const who = await one(`select date_of_birth::text as dob, nullif(about, '') as about from person where id=$1`, [personId]);
    const org = await one('select settings from organisation where id=$1', [dojoId]);
    const why = reasonNotToPublish({ person: { dateOfBirth: who?.dob }, isInstructor: true,
      on: new Date().toISOString().slice(0, 10), settings: org?.settings ?? {} });
    if (why) return { never: /under/.test(why) ? 'under 18' : 'no date of birth recorded', missing: [] };
    const required = await q(`select q.id, q.label ${CATALOGUE_FROM} and 'instruct' = any(q.required_for) order by q.label`, [dojoId]);
    const awards = await q(`${AWARD_SELECT} where qa.person_id = $1`, [personId]);
    const c = clearance(required, awards, await qualToday(dojoId));
    const missing = c.barred.map((b) => (b.state === 'expired' ? `${b.label} (expired)` : b.label));
    if (!who?.about) missing.push('a write-up about themselves');
    return { never: null, missing };
  },

  /** For the roll: who holds the instructor role, whether the website shows them, and what holds them back. */
  async stateFor(personIds) {
    const out = new Map();
    if (!personIds.length) return out;
    const rows = await q(`
      select a.person_id, a.organisation_id as dojo_id, coalesce(ip.published, false) as published
      from affiliation a
      left join instructor_profile ip on ip.person_id = a.person_id and ip.organisation_id = a.organisation_id
      where a.person_id = any($1::uuid[]) and a.role = 'instructor' and a.ends is null and a.status = 'active'`, [personIds]);
    for (const r of rows) {
      const ready = r.published ? { never: null, missing: [] } : await this.readiness(r.dojo_id, r.person_id);
      out.set(r.person_id, { published: r.published, ...ready });
    }
    return out;
  },

  /**
   * Make several people instructors in one go, optionally showing them on the website, or take the role away.
   * `scopeOrgId` is where the actor is working (a dojo, a region or the federation): people must be on the roll
   * of a dojo beneath it, and each is dealt with at their own dojo. Nobody is skipped silently.
   */
  async bulk(actor, scopeOrgId, personIds, mode) {
    await assertRole(actor, scopeOrgId, MANAGE);
    const ids = [...new Set(personIds)];
    const homes = new Map((await q(`
      select distinct on (a.person_id) a.person_id, a.organisation_id
      from affiliation a join organisation o on o.id = a.organisation_id
      join organisation scope on scope.id = $1 and o.path <@ scope.path
      where a.role = 'member' and a.ends is null and a.status = 'active' and a.person_id = any($2::uuid[])
      order by a.person_id, a.starts desc`, [scopeOrgId, ids])).map((r) => [r.person_id, r.organisation_id]));
    const out = { changed: 0, shown: 0, skipped: [] };
    for (const id of ids) {
      const who = await one(`select first_name || ' ' || last_name as name from person where id=$1`, [id]);
      const dojo = homes.get(id);
      if (!who || !dojo) { out.skipped.push({ name: who?.name ?? 'Someone', reason: 'not on the roll here' }); continue; }
      if (mode === 'off') {
        if ((await instructorRole.set(actor, id, false)).changed) out.changed += 1;
        continue;
      }
      if ((await instructorRole.set(actor, id, true)).changed) out.changed += 1;
      if (mode !== 'show') continue;

      // Shown only when ready; anything missing is named, not just refused.
      const r = await this.readiness(dojo, id);
      if (r.never) { out.skipped.push({ name: who.name, reason: `an instructor, but not shown on the website: ${r.never}` }); continue; }
      if (r.missing.length) { out.skipped.push({ name: who.name, reason: 'an instructor, not shown yet. Still needs ' + r.missing.join(', ') }); continue; }

      const cur = await one(`select bio, teaches, sort_order, started_year, show_checks, published from instructor_profile
        where organisation_id=$1 and person_id=$2`, [dojo, id]);
      await this.save(actor, dojo, id, { bio: cur?.bio ?? { blocks: [] }, teaches: cur?.teaches ?? null, published: true,
        sortOrder: cur?.sort_order ?? 0, startedYear: cur?.started_year ?? null, showChecks: true });
      if (!cur?.published) out.shown += 1;
    }
    return out;
  },

  /** Where this person is an instructor, and whether the dojo's website shows them yet. */
  async siteStatus(personId) {
    return one(`select o.slug, o.name, coalesce(ip.published, false) as published
      from affiliation a join organisation o on o.id = a.organisation_id
      left join instructor_profile ip on ip.person_id = a.person_id and ip.organisation_id = a.organisation_id
      where a.person_id = $1 and a.role = 'instructor' and a.ends is null and a.status = 'active'
      order by o.path limit 1`, [personId]);
  },

  /**
   * Everybody holding the instructor role here, with their profile if they
   * have one. Instructors without a profile are included deliberately: the
   * screen's job is partly to show who could be listed and is not.
   */
  async listFor(actor, orgId) {
    await assertRole(actor, orgId, MANAGE);
    const { rows } = await pool.query(`
      select p.id as person_id, p.first_name, p.last_name, p.date_of_birth,
             p.photo_asset_id,
             cg.label as grade, cg.is_dan,
             ct.label as title, ct.address_as,
             ip.id as profile_id, ip.bio, ip.teaches, ip.published,
             ip.published_at, ip.sort_order, ip.started_year, ip.show_checks
      from affiliation a
      join person p on p.id = a.person_id
      left join person_current_grade cg on cg.person_id = p.id
      left join person_current_title ct on ct.person_id = p.id
      left join instructor_profile ip
             on ip.person_id = p.id and ip.organisation_id = $1
      where a.organisation_id = $1 and a.ends is null
        and a.role = 'instructor' and a.status = 'active'
      order by ip.sort_order nulls last, cg.rank_order desc nulls last,
               p.last_name`, [orgId]);
    return rows;
  },

  /**
   * Add somebody to the site, or change what it says about them.
   *
   * Publishing is checked against the domain rule every time, not only when
   * the box is first ticked — somebody's birthday does not move, but a
   * federation raising its minimum age should take effect on the next save.
   */
  async save(actor, orgId, personId, { bio, teaches, published, sortOrder = 0, startedYear = null, showChecks = false }) {
    await assertRole(actor, orgId, MANAGE);

    const person = await one(`
      select p.id, p.date_of_birth,
             exists (select 1 from affiliation a
                     where a.person_id = p.id and a.organisation_id = $2
                       and a.ends is null and a.role = 'instructor'
                       and a.status = 'active') as is_instructor
      from person p where p.id = $1`, [personId, orgId]);
    if (!person) throw new NotFound('Person');

    const org = await one('select settings from organisation where id=$1', [orgId]);
    const today = new Date().toISOString().slice(0, 10);

    if (published) {
      // Throws a DomainError naming the reason, which the route shows as-is.
      assertMayPublish({
        person: { dateOfBirth: person.date_of_birth },
        isInstructor: person.is_instructor,
        on: today,
        settings: org?.settings ?? {},
      });
    }

    const { doc } = validate(bio ?? { blocks: [] });

    const year = startedYear == null || startedYear === '' ? null : Number(startedYear);
    if (year != null && !(Number.isInteger(year) && year >= 1930 && year <= new Date().getFullYear()))
      throw new Invalid('"Training since" must be a year, such as 1998.');

    const row = await one(`
      insert into instructor_profile (organisation_id, person_id, bio, teaches,
                                      published, published_by, published_at,
                                      sort_order, started_year, show_checks)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      on conflict (organisation_id, person_id) do update set
        bio = excluded.bio,
        started_year = excluded.started_year,
        show_checks = excluded.show_checks,
        teaches = excluded.teaches,
        published = excluded.published,
        -- Only stamped when it becomes published, so the record keeps who
        -- first agreed rather than whoever last edited a typo.
        published_by = case when excluded.published and not instructor_profile.published
                            then excluded.published_by
                            else instructor_profile.published_by end,
        published_at = case when excluded.published and not instructor_profile.published
                            then excluded.published_at
                            else instructor_profile.published_at end,
        sort_order = excluded.sort_order
      returning *`,
      [orgId, personId, doc, teaches?.trim() || null, !!published,
       published ? actor : null, published ? new Date() : null, sortOrder, year, !!showChecks]);

    await pool.query(`
      insert into audit_log (account_id, organisation_id, action, entity,
                             entity_id, after)
      values ($1,$2,$3,'instructor_profile',$4,$5)`,
      [actor, orgId, published ? 'instructor_publish' : 'instructor_save',
       row.id, JSON.stringify({ personId, published: !!published })]);

    return row;
  },

  /**
   * Take somebody off the site.
   *
   * Deletes the profile rather than flipping a flag, because "remove me from
   * your website" should not leave a row that somebody can tick again without
   * asking. They remain an instructor on the roll.
   */
  async remove(actor, orgId, personId) {
    await assertRole(actor, orgId, MANAGE);
    const row = await one(`delete from instructor_profile
      where organisation_id=$1 and person_id=$2 returning *`, [orgId, personId]);
    if (!row) throw new NotFound('Instructor profile');
    await pool.query(`
      insert into audit_log (account_id, organisation_id, action, entity,
                             entity_id, before)
      values ($1,$2,'instructor_remove','instructor_profile',$3,$4)`,
      [actor, orgId, row.id, JSON.stringify({ personId, was: row.published })]);
    return row;
  },
};

// ---------------------------------------------------------------------------
// the site menu
//
// Stored on the organisation, because a federation's menu is the federation's.
// data/settings.json remains the fallback for a single-federation install that
// has never opened the editor — see packages/content/navigation.mjs.
// ---------------------------------------------------------------------------

export const navigation = {
  /** What this federation has stored, and everywhere its site has a page. */
  async forEditing(actor, orgId) {
    await assertRole(actor, orgId, WRITE_PAGES);
    const org = await one('select settings from organisation where id=$1', [orgId]);
    const { rows: authored } = await pool.query(`
      select slug, title from page
      where organisation_id=$1 and status='published' order by title`, [orgId]);
    return { stored: org?.settings?.navigation ?? null, authored };
  },

  /**
   * Replace the menu.
   *
   * Validated against what the site will actually have a page for, so an item
   * pointing nowhere is refused here rather than disappearing during a build.
   */
  async save(actor, orgId, items, { vocabulary = {} } = {}) {
    await assertRole(actor, orgId, MANAGE);
    const { authored } = await this.forEditing(actor, orgId);
    const existing = destinations({ authored, vocabulary });

    const problems = problemsWithNavigation(items, existing);
    if (problems.length) throw new Invalid(problems.join(' '));

    const clean = items.map((i) => ({ href: i.href.trim(), label: i.label.trim() }));
    const row = await one(`
      update organisation
         set settings = jsonb_set(settings, '{navigation}', $2::jsonb, true),
             updated_at = now()
       where id = $1 returning settings`,
      [orgId, JSON.stringify({ items: clean })]);

    await pool.query(`
      insert into audit_log (account_id, organisation_id, action, entity,
                             entity_id, after)
      values ($1,$2,'navigation_save','organisation',$2,$3)`,
      [actor, orgId, JSON.stringify({ items: clean })]);

    return row?.settings?.navigation?.items ?? clean;
  },
};

// ---------------------------------------------------------------------------
// adding a club
// ---------------------------------------------------------------------------

export const clubs = {
  /** Every club beneath this organisation, with what a federation wants to see. */
  async beneath(actor, orgId) {
    await assertRole(actor, orgId, MANAGE);
    const { rows } = await pool.query(`
      select o.id, o.name, o.slug, o.status, o.created_at,
             coalesce(d.city, '') as city,
             (select count(*)::int from affiliation a
               where a.organisation_id = o.id and a.ends is null
                 and a.status = 'active') as members,
             exists (select 1 from grant_role g
                      where g.organisation_id = o.id
                        and g.role in ('owner','administrator')) as has_administrator,
             coalesce(d.published, false) as page_live
      from organisation root
      join organisation o on o.path <@ root.path and o.type = 'club'
      left join dojo_profile d on d.organisation_id = o.id
      where root.id = $1
      order by o.name`, [orgId]);
    return rows;
  },

  /**
   * Add a club beneath a federation or region.
   *
   * The club starts with no public page — that is the club's to ask for and
   * the federation's to approve — and, if an administrator is named, with
   * that person enrolled and able to sign in. Both happen or neither does: a
   * club with no way in is the failure this exists to prevent.
   */
  async create(actor, parentId, input) {
    await assertRole(actor, parentId, MANAGE);
    const parent = await one('select * from organisation where id = $1', [parentId]);
    if (!parent) throw new NotFound('Organisation');
    if (parent.type === 'club') throw new Invalid('A club cannot have clubs beneath it.');

    const problems = problemsWithNewClub(input);
    if (problems.length) throw new Invalid(problems.join(' '));

    const slug = input.slug ?? clubSlugFrom(input.name);
    // Slugs are looked up on their own in /o/<slug>, so unique means unique
    // everywhere, not just beneath this parent.
    if (await one('select 1 from organisation where slug = $1', [slug]))
      throw new Invalid(`There is already an organisation at "${slug}". Choose a different web address.`);

    if (hasAdministrator(input)) {
      const taken = await one('select person_id from account where email = $1',
        [input.adminEmail]);
      if (taken)
        throw new Invalid(`${input.adminEmail} already has an account. Add the club first, `
          + 'then give that person access to it from their own record.');
    }

    const client = await pool.connect();
    let club;
    try {
      await client.query('begin');
      ({ rows: [club] } = await client.query(`
        insert into organisation (parent_id, type, name, short_name, slug, path,
                                  country_code, timezone, status)
        values ($1,'club',$2,null,$3,($4 || '.' || $5)::ltree,$6,$7,'active')
        returning *`,
        [parent.id, input.name, slug, parent.path, slug.replace(/-/g, '_'),
         parent.country_code, parent.timezone]));

      if (input.city)
        await client.query(`
          insert into dojo_profile (organisation_id, city) values ($1,$2)`,
          [club.id, input.city]);

      await client.query(`
        insert into audit_log (account_id, organisation_id, action, entity,
                               entity_id, after)
        values ($1,$2,'club_added','organisation',$3,$4::jsonb)`,
        [actor, parent.id, club.id,
         JSON.stringify({ name: club.name, slug, parent: parent.name })]);
      await client.query('commit');
    } catch (e) {
      await client.query('rollback'); throw e;
    } finally { client.release(); }

    // The administrator goes through the same two functions a registrar uses
    // for anybody, so there is one way to enrol a person and one way to give
    // them access, and both are already tested and audited.
    let admin = null;
    if (hasAdministrator(input)) {
      try {
        const person = await people.enrol(actor, {
          organisationId: club.id, firstName: input.adminFirst,
          lastName: input.adminLast, email: input.adminEmail, role: 'member' });
        admin = await people.grantAccess(actor, person.id,
          { role: 'administrator', email: input.adminEmail, organisationId: club.id });
      } catch (e) {
        // The club exists; say so, and say what did not happen, rather than
        // leaving a half-finished club behind a generic error.
        e.club = club;
        throw e;
      }
    }
    return { club, admin };
  },
};

// ---------------------------------------------------------------------------
// families, and a person's own view of themselves
//
// A signed-in member sees themselves and, if they are a parent or guardian,
// the children linked to them while those children are minors. Nothing else:
// every function here starts by working out who this account may act for, and
// refuses anyone outside that set before reading a row.
// ---------------------------------------------------------------------------

const PERSON_COLUMNS = `p.id, p.display_number, p.first_name, p.last_name, p.preferred_name,
  p.date_of_birth::text as date_of_birth, p.gender, p.email, p.phone`;

async function homesOf(personId) {
  const { rows } = await pool.query(`
    select organisation_id from affiliation where person_id=$1 and ends is null`, [personId]);
  return rows.map((r) => r.organisation_id);
}

export const family = {
  /** The person behind an account, and the children they may act for. */
  async mine(actor) {
    const self = await one(`
      select ${PERSON_COLUMNS} from account a join person p on p.id = a.person_id
      where a.id = $1`, [actor]);
    if (!self) return { self: null, dependants: [] };
    const { rows: dependants } = await pool.query(`
      select ${PERSON_COLUMNS}, gl.relationship
      from guardian_link gl join person p on p.id = gl.child_id
      where gl.guardian_id = $1 and gl.ended_on is null
        and p.date_of_birth is not null
        and p.date_of_birth > current_date - interval '18 years'
      order by p.first_name`, [self.id]);
    return { self, dependants };
  },

  /** 'self', 'guardian', or null. The only door every self-service screen uses. */
  async mayActFor(actor, personId) {
    const { self, dependants } = await this.mine(actor);
    if (!self) return null;
    if (self.id === personId) return 'self';
    return dependants.some((d) => d.id === personId) ? 'guardian' : null;
  },

  async assertMayActFor(actor, personId) {
    const how = await this.mayActFor(actor, personId);
    if (!how) throw new Forbidden();
    return how;
  },

  /** A registrar links a parent or guardian to a child at the child's club. */
  async link(actor, { guardianId, childId, relationship = 'parent' }) {
    const guardian = await one(`select ${PERSON_COLUMNS} from person p where p.id=$1`, [guardianId]);
    const child = await one(`select ${PERSON_COLUMNS} from person p where p.id=$1`, [childId]);
    if (!guardian || !child) throw new NotFound('Person');

    const homes = await homesOf(childId);
    let home = null;
    for (const h of homes) {
      const ok = await one('select has_role_at($1,$2,$3) as ok', [actor, h, REGISTER]);
      if (ok?.ok) { home = h; break; }
    }
    if (!home) throw new Forbidden();

    const problems = problemsWithGuardianLink({ guardian, child, relationship });
    if (problems.length) throw new Invalid(problems.join(' '));

    const row = await one(`
      insert into guardian_link (guardian_id, child_id, relationship, created_by)
      values ($1,$2,$3,$4)
      on conflict (guardian_id, child_id) where ended_on is null do nothing
      returning *`, [guardianId, childId, relationship, actor]);
    if (!row) throw new Invalid(`${guardian.first_name} is already linked to ${child.first_name}.`);

    await pool.query(`
      insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
      values ($1,$2,'guardian_link','person',$3,$4)`,
      [actor, home, childId, JSON.stringify({
        guardian: `${guardian.first_name} ${guardian.last_name}`,
        child: `${child.first_name} ${child.last_name}`, relationship })]);
    return row;
  },

  async unlink(actor, linkId) {
    const link = await one(`
      select gl.*, g.first_name as g_first, g.last_name as g_last,
             c.first_name as c_first, c.last_name as c_last
      from guardian_link gl
      join person g on g.id = gl.guardian_id join person c on c.id = gl.child_id
      where gl.id=$1 and gl.ended_on is null`, [linkId]);
    if (!link) throw new NotFound('Link');
    let home = null;
    for (const h of await homesOf(link.child_id)) {
      const ok = await one('select has_role_at($1,$2,$3) as ok', [actor, h, REGISTER]);
      if (ok?.ok) { home = h; break; }
    }
    if (!home) throw new Forbidden();
    await pool.query('update guardian_link set ended_on = current_date where id=$1', [linkId]);
    await pool.query(`
      insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
      values ($1,$2,'guardian_unlink','person',$3,$4)`,
      [actor, home, link.child_id, JSON.stringify({
        guardian: `${link.g_first} ${link.g_last}`, child: `${link.c_first} ${link.c_last}` })]);
  },

  /** The guardians of a child, for the child's own record. */
  async guardiansOf(actor, childId) {
    let allowed = false;
    for (const h of await homesOf(childId)) {
      const ok = await one('select has_role_at($1,$2,$3) as ok', [actor, h, REGISTER]);
      if (ok?.ok) { allowed = true; break; }
    }
    if (!allowed) throw new Forbidden();
    const { rows } = await pool.query(`
      select gl.id, gl.relationship, g.id as person_id, g.first_name, g.last_name,
             g.email, exists(select 1 from account a where a.person_id = g.id) as can_sign_in
      from guardian_link gl join person g on g.id = gl.guardian_id
      where gl.child_id=$1 and gl.ended_on is null order by gl.created_at`, [childId]);
    return rows;
  },
};

export const myself = {
  /** Everything a member sees about themselves or a child they look after. */
  async get(actor, personId) {
    const how = await family.assertMayActFor(actor, personId);
    const person = await one(`select ${PERSON_COLUMNS}, p.photo_asset_id, p.about from person p where p.id=$1`, [personId]);
    if (!person) throw new NotFound('Person');
    const priv = await one(`select address_line, suburb, city, postcode, emergency_name,
      emergency_phone, medical_notes from person_private where person_id=$1`, [personId]) ?? {};
    const grade = await one(`select label, rank_order, awarded_on::text as awarded_on
      from person_current_grade where person_id=$1`, [personId]);
    const { rows: memberships } = await pool.query(`
      select o.name, o.slug, a.role, a.status, a.paid_until::text as paid_until
      from affiliation a join organisation o on o.id = a.organisation_id
      where a.person_id=$1 and a.ends is null order by o.name`, [personId]);
    const certificates = await q(`select gr.id, g.label, gr.awarded_on::text as awarded_on, gr.certificate_no
      from grading_record gr join grade g on g.id = gr.grade_id
      where gr.person_id = $1 and gr.certificate_no is not null and gr.result in ('pass','provisional')
      order by gr.awarded_on desc`, [personId]);
    const home = (await homesOf(personId))[0];
    const today = home ? await qualToday(home) : null;
    const quals = today ? describeAwards(await q(`${AWARD_SELECT} where qa.person_id = $1`, [personId]), today).filter((a) => a.counts) : [];
    return { how, person, private: priv, grade, memberships, certificates, qualifications: quals,
             instructorSite: await instructors.siteStatus(personId) };
  },

  /** Only the fields a person may change about themselves. */
  async update(actor, personId, input) {
    await family.assertMayActFor(actor, personId);
    const problems = problemsWithSelfEdit(input);
    if (problems.length) throw new Invalid(problems.join(' '));

    const before = await this.get(actor, personId);
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`update person set preferred_name=$2, phone=$3, email=$4, about=$5 where id=$1`,
        [personId, input.preferred_name, input.phone, input.email, input.about ?? null]);
      await client.query(`
        insert into person_private (person_id, address_line, suburb, city, postcode,
          emergency_name, emergency_phone, medical_notes, updated_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8, now())
        on conflict (person_id) do update set address_line=excluded.address_line,
          suburb=excluded.suburb, city=excluded.city, postcode=excluded.postcode,
          emergency_name=excluded.emergency_name, emergency_phone=excluded.emergency_phone,
          medical_notes=excluded.medical_notes, updated_at=now()`,
        [personId, input.address_line, input.suburb, input.city, input.postcode,
         input.emergency_name, input.emergency_phone, input.medical_notes]);

      // Which fields, never what they said: medical notes are the most
      // sensitive thing on the register and the history is read by more people
      // than the notes are.
      const changed = [];
      for (const k of ['preferred_name', 'phone', 'email', 'about'])
        if ((before.person[k] ?? null) !== (input[k] ?? null)) changed.push(k);
      for (const k of ['address_line', 'suburb', 'city', 'postcode',
                       'emergency_name', 'emergency_phone', 'medical_notes'])
        if ((before.private[k] ?? null) !== (input[k] ?? null)) changed.push(k);
      const org = (await client.query(`select organisation_id from affiliation
        where person_id=$1 and ends is null order by starts desc limit 1`, [personId])).rows[0]
        ?.organisation_id ?? null;
      if (changed.length)
        await client.query(`
          insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
          values ($1,$2,'self_update','person',$3,$4)`,
          [actor, org, personId, JSON.stringify({ fields: changed, by: before.how })]);
      await client.query('commit');
    } catch (e) { await client.query('rollback'); throw e; }
    finally { client.release(); }
  },
};

// ---------------------------------------------------------------------------
// what a member may enter
//
// The events a person's own club and the organisations above it have opened for
// entries, filtered by the same visibility rules the public calendar uses. A
// member is offered nothing they could not see, and the check made when they
// submit is this same query, not a copy of it.
// ---------------------------------------------------------------------------

const ENTERABLE_KINDS = ['grading', 'tournament', 'fight_night', 'seminar', 'camp'];

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
             to_char(x.created_at at time zone 'Pacific/Auckland','YYYY-MM-DD') as entered_on,
             coalesce((select json_agg(json_build_object('discipline', d.name, 'division', v.label) order by d.sort_order)
                         from entry_selection s join event_discipline d on d.id = s.discipline_id
                         left join event_division v on v.id = s.division_id
                        where s.entry_id = x.id), '[]'::json) as picks
      from event_entry x
      where x.person_id = $1 and x.status in ('entered','confirmed') and x.weight_kg is not null
      order by x.created_at desc limit 1`, [personId]);
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
             e.kind, o.timezone as host_timezone
      from event_entry x join event e on e.id = x.event_id
      join organisation o on o.id = e.organisation_id
      where x.person_id = $1 and x.status in ('entered','confirmed')
      order by e.starts_at`, [personId]);
    return rows;
  },
};

// ---------------------------------------------------------------------------
// a club's own profile
// ---------------------------------------------------------------------------

export const clubProfile = {
  /** The club, and who runs it, who trains in it, and what is coming up. */
  async get(actor, orgId) {
    await assertRole(actor, orgId, MANAGE);
    // The date as text: pg hands a DATE back as a JS Date at local midnight,
    // and turning that into a string shifts it a day on a server east of UTC.
    const club = await one(`select *, to_char(founded,'YYYY-MM-DD') as founded_iso
      from organisation where id=$1 and type='club'`, [orgId]);
    if (!club) throw new NotFound('Club');

    const { rows: administrators } = await pool.query(`
      select a.email, p.first_name, p.last_name, g.role
      from grant_role g
      join account a on a.id = g.account_id
      left join person p on p.id = a.person_id
      where g.organisation_id = $1 and g.role in ('owner','administrator')
      order by g.granted_at`, [orgId]);

    const counts = await one(`
      select
        (select count(*)::int from affiliation
          where organisation_id=$1 and ends is null and status='active') as members,
        (select count(*)::int from affiliation
          where organisation_id=$1 and ends is null and status='active'
            and role in ('instructor','coach')) as instructors,
        (select count(*)::int from event
          where organisation_id=$1 and status='published'
            and starts_at > now()) as upcoming`, [orgId]);

    const page = await one(`select published, page_requested_at from dojo_profile
      where organisation_id=$1`, [orgId]);
    const parent = await one('select name, slug from organisation where id=$1', [club.parent_id]);
    return { club, parent, administrators, counts, page };
  },

  async save(actor, orgId, input) {
    await assertRole(actor, orgId, MANAGE);
    const before = await one(`select *, to_char(founded,'YYYY-MM-DD') as founded_iso
      from organisation where id=$1 and type='club'`, [orgId]);
    if (!before) throw new NotFound('Club');

    const problems = problemsWithClubProfile(input);
    if (problems.length) throw new Invalid(problems.join(' '));

    const row = await one(`
      update organisation
         set name=$2, short_name=$3, founded=$4::date, timezone=$5, status=$6,
             updated_at=now()
       where id=$1 returning *, to_char(founded,'YYYY-MM-DD') as founded_iso`,
      [orgId, input.name, input.shortName, input.founded, input.timezone, input.status]);

    const was = { name: before.name, status: before.status, timezone: before.timezone,
                  short_name: before.short_name, founded: before.founded_iso };
    const now = { name: row.name, status: row.status, timezone: row.timezone,
                  short_name: row.short_name, founded: row.founded_iso };
    await pool.query(`
      insert into audit_log (account_id, organisation_id, action, entity,
                             entity_id, before, after)
      values ($1,$2,'club_profile_saved','organisation',$2,$3,$4)`,
      [actor, orgId, JSON.stringify(was), JSON.stringify(now)]);

    return { club: row, siteChanged: changesTheSite(before, row) };
  },
};

// ---------------------------------------------------------------------------
// appearance
//
// A federation's look is stored on the organisation, like its menu, and is
// validated by the same reader the build uses, so what is saved is exactly
// what will be built. A club has no look of its own: its page is the
// federation speaking in the federation's design.
// ---------------------------------------------------------------------------

export const appearance = {
  async current(actor, orgId) {
    await assertRole(actor, orgId, WRITE_PAGES);
    const org = await one('select settings from organisation where id=$1', [orgId]);
    return org?.settings?.theme ?? null;
  },

  async apply(actor, orgId, doc) {
    await assertRole(actor, orgId, MANAGE);
    const read = readTheme(doc);
    if (!read.ok) throw new Invalid(read.problems.join(' '));
    const before = (await one('select settings from organisation where id=$1', [orgId]))
      ?.settings?.theme ?? null;
    await one(`
      update organisation
         set settings = jsonb_set(settings, '{theme}', $2::jsonb, true),
             updated_at = now()
       where id = $1 returning id`, [orgId, JSON.stringify(read.theme)]);
    await pool.query(`
      insert into audit_log (account_id, organisation_id, action, entity,
                             entity_id, before, after)
      values ($1,$2,'theme_apply','organisation',$2,$3,$4)`,
      [actor, orgId, before ? JSON.stringify({ name: before.name }) : null,
       JSON.stringify({ name: read.theme.name })]);
    return read;
  },

  /** The crest: the picture used in the site header and on every event banner. null removes it. */
  async setLogo(actor, orgId, assetId) {
    await assertRole(actor, orgId, MANAGE);
    if (assetId) {
      const a = await one('select organisation_id from asset where id = $1', [assetId]);
      if (!a || a.organisation_id !== orgId) throw new Invalid('Choose one of this organisation\'s own pictures.');
    }
    await one(`update organisation set settings = case when $2::text is null then settings - 'logoAssetId'
        else jsonb_set(settings, '{logoAssetId}', to_jsonb($2::text), true) end, updated_at = now()
      where id = $1 returning id`, [orgId, assetId]);
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
      values ($1,$2,'crest_set','organisation',$2,$3)`, [actor, orgId, JSON.stringify({ assetId })]);
  },

  async logo(actor, orgId) {
    await assertRole(actor, orgId, WRITE_PAGES);
    return (await one('select settings from organisation where id=$1', [orgId]))?.settings?.logoAssetId ?? null;
  },

  /** What the home page says and shows at the top. Blank words fall back to the defaults. */
  async home(actor, orgId) {
    await assertRole(actor, orgId, WRITE_PAGES);
    const h = (await one('select settings from organisation where id=$1', [orgId]))?.settings?.homePage ?? {};
    return { heroAssetId: h.heroAssetId ?? null, heroHeading: h.heroHeading ?? '',
             heroText: h.heroText ?? '', heroButton: h.heroButton ?? '',
             shareAssetId: h.shareAssetId ?? null };
  },

  /**
   * Set the home-page top picture, wording and link-preview picture. `undefined` leaves a
   * field alone; null or '' clears it. Pictures must be this organisation's own.
   */
  async setHome(actor, orgId, { heroAssetId, shareAssetId, heroHeading, heroText, heroButton }) {
    await assertRole(actor, orgId, MANAGE);
    for (const [label, v] of [['heading', heroHeading], ['button', heroButton]])
      if (v != null && String(v).length > 80) throw new Invalid(`The ${label} is too long (80 characters at most).`);
    if (heroText != null && String(heroText).length > 300) throw new Invalid('The text under the heading is too long (300 characters at most).');
    for (const id of [heroAssetId, shareAssetId].filter(Boolean)) {
      const a = await one('select organisation_id from asset where id = $1', [id]);
      if (!a || a.organisation_id !== orgId) throw new Invalid('Choose one of this organisation\'s own pictures.');
    }
    const before = (await one('select settings from organisation where id=$1', [orgId]))?.settings?.homePage ?? {};
    const next = { ...before };
    const put = (k, v) => {
      if (v === undefined) return;
      const s = typeof v === 'string' ? v.trim() : v;
      if (s === null || s === '') delete next[k]; else next[k] = s;
    };
    put('heroAssetId', heroAssetId); put('shareAssetId', shareAssetId);
    put('heroHeading', heroHeading); put('heroText', heroText); put('heroButton', heroButton);
    await one(`update organisation set settings = jsonb_set(settings, '{homePage}', $2::jsonb, true),
        updated_at = now() where id = $1 returning id`, [orgId, JSON.stringify(next)]);
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, before, after)
      values ($1,$2,'home_page_set','organisation',$2,$3,$4)`,
      [actor, orgId, JSON.stringify(before), JSON.stringify(next)]);
  },

  /** Back to the deployment's own look (settings file, then defaults). */
  async reset(actor, orgId) {
    await assertRole(actor, orgId, MANAGE);
    await one(`
      update organisation set settings = settings - 'theme', updated_at = now()
       where id = $1 returning id`, [orgId]);
    await pool.query(`
      insert into audit_log (account_id, organisation_id, action, entity,
                             entity_id, after)
      values ($1,$2,'theme_reset','organisation',$2,'{}')`, [actor, orgId]);
  },
};

// ---------------------------------------------------------------------------
// the audit log
//
// Thirteen places write to it and, until this, nothing read it. Reading is
// restricted to MANAGE and scoped to the subtree, because the log says who did
// what to whom: a club's administrator may see their own club's history and
// not the federation's, exactly as with every other record.
// ---------------------------------------------------------------------------

export const audit = {
  /**
   * What has happened at this organisation and anything beneath it.
   *
   * Names are resolved here rather than in the view: an audit entry naming a
   * uuid is a row in a table, and the point of this screen is that somebody
   * can settle an argument with it.
   */
  async forOrganisation(actor, orgId, {
    action = null, accountId = null, since = null, limit = 100, before = null,
  } = {}) {
    await assertRole(actor, orgId, MANAGE);

    const { rows } = await pool.query(`
      select l.id, l.at, l.action, l.entity, l.entity_id as "entityId",
             l.before, l.after,
             l.account_id as "accountId",
             coalesce(
               nullif(trim(concat_ws(' ', ap.first_name, ap.last_name)), ''),
               acct.email, 'the system') as "actorName",
             o.name as "organisationName", o.slug as "organisationSlug",
             -- Whatever the entry was about, if it is a person we still hold.
             nullif(trim(concat_ws(' ', sp.first_name, sp.last_name)), '')
               as "subjectName"
      from audit_log l
      join organisation o on o.id = l.organisation_id
      join organisation root on root.id = $1 and o.path <@ root.path
      left join account acct on acct.id = l.account_id
      left join person ap on ap.id = acct.person_id
      left join person sp on sp.id = l.entity_id and l.entity = 'person'
      where ($2::text is null or l.action = $2)
        and ($3::uuid is null or l.account_id = $3)
        and ($4::timestamptz is null or l.at >= $4)
        and ($5::bigint is null or l.id < $5)
      order by l.id desc
      limit least($6::int, 500)`,
      [orgId, action, accountId, since, before, limit]);

    return rows;
  },

  /**
   * Everything that has happened to one record.
   *
   * Asked from a person's own page, which is where somebody looks when a
   * grading or a member number is disputed.
   */
  async forEntity(actor, orgId, entity, entityId, { limit = 50 } = {}) {
    await assertRole(actor, orgId, MANAGE);
    const { rows } = await pool.query(`
      select l.id, l.at, l.action, l.entity, l.entity_id as "entityId",
             l.before, l.after,
             coalesce(
               nullif(trim(concat_ws(' ', ap.first_name, ap.last_name)), ''),
               acct.email, 'the system') as "actorName"
      from audit_log l
      join organisation o on o.id = l.organisation_id
      join organisation root on root.id = $1 and o.path <@ root.path
      left join account acct on acct.id = l.account_id
      left join person ap on ap.id = acct.person_id
      where l.entity = $2 and l.entity_id = $3
      order by l.id desc
      limit least($4::int, 200)`, [orgId, entity, entityId, limit]);
    return rows;
  },

  /** Who has done things here, for a filter that lists real names. */
  async actorsAt(actor, orgId) {
    await assertRole(actor, orgId, MANAGE);
    const { rows } = await pool.query(`
      select distinct l.account_id as "accountId",
             coalesce(
               nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
               a.email, 'the system') as name
      from audit_log l
      join organisation o on o.id = l.organisation_id
      join organisation root on root.id = $1 and o.path <@ root.path
      left join account a on a.id = l.account_id
      left join person p on p.id = a.person_id
      where l.account_id is not null
      order by name`, [orgId]);
    return rows;
  },
};

// ---------------------------------------------------------------------------
// search
//
// Scoped in the query, never filtered afterwards. Search is the classic place
// an authorisation model leaks: a query that reads everything and then removes
// what the actor may not see still tells them it existed, through a count,
// through an ordering, through how long it took. Every branch below starts
// from visible_orgs($1), which is the same gate the rest of the system uses.
// ---------------------------------------------------------------------------

export const search = {
  /**
   * Everything this account may see that matches.
   *
   * Returns a flat list, typed, best first. One query per kind rather than one
   * enormous union: they have genuinely different shapes and different
   * permission rules, and a union of six selects with padding columns is how
   * somebody later adds a seventh and forgets the scoping.
   */
  async everything(actor, raw, { limit = 40 } = {}) {
    const q = readQuery(raw);
    if (q.kind === 'empty' || q.kind === 'too-short') return { query: q, results: [] };

    const like = `%${q.folded}%`;
    const results = [];

    // People. TEACH, not MANAGE: an instructor needs to find somebody in the
    // hall. Private detail is never selected here — a search result shows
    // what a roll already shows.
    const { rows: people } = await pool.query(`
      select distinct on (p.id)
             p.id, p.first_name as "firstName", p.last_name as "lastName",
             p.display_number as "displayNumber",
             cg.label as grade, o.name as "organisationName", o.slug as "orgSlug"
      from visible_orgs($1) v
      join organisation o on o.id = v.organisation_id
      join affiliation a on a.organisation_id = o.id and a.ends is null
      join person p on p.id = a.person_id
      left join person_current_grade cg on cg.person_id = p.id
      where has_role_at($1, o.id,
              array['owner','administrator','registrar','instructor']::role_name[])
        and (fold(concat_ws(' ', p.first_name, p.last_name)) like $2
          or fold(coalesce(p.display_number,'')) like $2
          or fold(coalesce(cg.label,'')) like $2)
      order by p.id, o.name
      limit $3`, [actor, like, limit]);
    for (const p of people)
      results.push({ kind: 'person', ...p,
        title: `${p.firstName} ${p.lastName}`.trim(),
        detail: [p.displayNumber, p.grade, p.organisationName]
          .filter(Boolean).join(' · ') });

    // An email finds an account, and only for somebody who may manage where
    // that person trains. An address is a way to reach a person, not a label.
    if (q.kind === 'email') {
      const { rows } = await pool.query(`
        select distinct on (p.id) p.id, acct.email,
               p.first_name as "firstName", p.last_name as "lastName",
               o.name as "organisationName", o.slug as "orgSlug"
        from visible_orgs($1) v
        join organisation o on o.id = v.organisation_id
        join affiliation a on a.organisation_id = o.id and a.ends is null
        join person p on p.id = a.person_id
        join account acct on acct.person_id = p.id
        where has_role_at($1, o.id, array['owner','administrator']::role_name[])
          and fold(acct.email) like $2
        order by p.id, o.name
        limit $3`, [actor, like, limit]);
      for (const r of rows)
        if (!results.some((x) => x.kind === 'person' && x.id === r.id))
          results.push({ kind: 'person', ...r,
            title: `${r.firstName} ${r.lastName}`.trim(),
            detail: [r.email, r.organisationName].filter(Boolean).join(' · ') });
    }

    const { rows: orgs_ } = await pool.query(`
      select o.id, o.name, o.slug, o.type
      from visible_orgs($1) v
      join organisation o on o.id = v.organisation_id
      where fold(o.name) like $2 or fold(o.slug) like $2
      order by o.name
      limit $3`, [actor, like, limit]);
    for (const o of orgs_)
      results.push({ kind: 'organisation', ...o,
        title: o.name, detail: o.type });

    const { rows: evs } = await pool.query(`
      select e.id, e.title, e.slug, e.starts_at as "startsAt",
             o.slug as "orgSlug", o.name as "organisationName"
      from visible_orgs($1) v
      join organisation o on o.id = v.organisation_id
      join event e on e.organisation_id = o.id
      where fold(e.title) like $2 or fold(coalesce(e.venue_name,'')) like $2
      order by e.starts_at desc nulls last
      limit $3`, [actor, like, limit]);
    for (const e of evs)
      results.push({ kind: 'event', ...e, detail: [e.organisationName,
        e.startsAt ? new Date(e.startsAt).toISOString().slice(0, 10) : null]
        .filter(Boolean).join(' · ') });

    // Pages and news need the right to write them — a draft is not public,
    // and search must not be the way somebody reads one.
    const { rows: pgs } = await pool.query(`
      select pg.id, pg.title, pg.slug, pg.status,
             o.slug as "orgSlug", o.name as "organisationName"
      from visible_orgs($1) v
      join organisation o on o.id = v.organisation_id
      join page pg on pg.organisation_id = o.id
      where has_role_at($1, o.id,
              array['owner','administrator','contributor']::role_name[])
        and (fold(pg.title) like $2 or fold(pg.slug) like $2
          or fold(pg.body::text) like $2)
      order by pg.updated_at desc nulls last
      limit $3`, [actor, like, limit]);
    for (const pg of pgs)
      results.push({ kind: 'page', ...pg,
        detail: [pg.organisationName, pg.status].filter(Boolean).join(' · ') });

    const { rows: arts } = await pool.query(`
      select ar.id, ar.title, ar.slug, ar.status,
             o.slug as "orgSlug", o.name as "organisationName"
      from visible_orgs($1) v
      join organisation o on o.id = v.organisation_id
      join article ar on ar.organisation_id = o.id
      where has_role_at($1, o.id,
              array['owner','administrator','contributor']::role_name[])
        and (fold(ar.title) like $2 or fold(coalesce(ar.summary,'')) like $2
          or fold(ar.body::text) like $2)
      order by ar.published_at desc nulls last
      limit $3`, [actor, like, limit]);
    for (const ar of arts)
      results.push({ kind: 'article', ...ar,
        detail: [ar.organisationName, ar.status].filter(Boolean).join(' · ') });

    const { rows: imgs } = await pool.query(`
      select a.id, a.filename, a.alt_text as "altText",
             o.slug as "orgSlug", o.name as "organisationName"
      from visible_orgs($1) v
      join organisation o on o.id = v.organisation_id
      join asset a on a.organisation_id = o.id
      where has_role_at($1, o.id,
              array['owner','administrator','contributor']::role_name[])
        and (fold(coalesce(a.filename,'')) like $2
          or fold(coalesce(a.alt_text,'')) like $2)
      order by a.created_at desc
      limit $3`, [actor, like, limit]);
    for (const a of imgs)
      results.push({ kind: 'image', ...a,
        title: a.filename ?? 'image', detail: a.altText ?? a.organisationName });

    // A member number or an email was typed because somebody wanted one exact
    // thing; put the exact match first and leave the rest in the order each
    // query returned.
    const exact = (r) => (
      fold(r.displayNumber ?? '') === q.folded
      || fold(r.email ?? '') === q.folded
      || fold(r.title ?? '') === q.folded) ? 0 : 1;
    results.sort((a, b) => exact(a) - exact(b));

    return { query: q, results: results.slice(0, limit) };
  },
};

// ---------------------------------------------------------------------------
// a club's page on the federation's website
//
// What the page says belongs to the club. Whether it appears under the
// federation's name belongs to the federation, so the two are separate
// permissions and the club cannot approve itself. See domain/club-page.mjs.
// ---------------------------------------------------------------------------

import { readinessProblems, readinessGaps, ClubPageNotReady, stateOf }
  from '../core/domain/club-page.mjs';

export const clubPages = {
  async _club(clubId) {
    const club = await one(
      `select id, name, slug, type, parent_id from organisation where id = $1`,
      [clubId]);
    if (!club) throw new NotFound('Club');
    if (club.type !== 'club')
      throw new Invalid('Only a club has a page of its own.');
    return club;
  },

  async _sessionsOf(clubId) {
    return q(`
      select id, label, weekday, to_char(starts, 'HH24:MI') as starts,
             to_char(ends, 'HH24:MI') as ends, min_age, max_age
      from training_session where organisation_id = $1
      order by sort_order, weekday, starts`, [clubId]);
  },

  /**
   * `at` is whose history it appears in. A club's own edits are the club's;
   * the federation's answer is the federation's — and since history reads
   * downward, it shows at the club as well.
   */
  async _audit(actor, at, clubId, action, before, after) {
    const club = await one(`select name from organisation where id = $1`, [clubId]);
    await pool.query(`
      insert into audit_log (account_id, organisation_id, action, entity,
                             entity_id, before, after)
      values ($1,$2,$3,'club_page',$4,$5,$6)`,
      [actor, at, action, clubId, JSON.stringify(before ?? {}),
       JSON.stringify({ ...(after ?? {}), club: club?.name ?? null })]);
  },

  /** The club's profile and times, for its own screen. */
  async forClub(actor, clubId) {
    await assertRole(actor, clubId, WRITE_PAGES);
    const club = await this._club(clubId);
    const profile = await one(
      `select * from dojo_profile where organisation_id = $1`, [clubId]) ?? {};
    const sessions = await this._sessionsOf(clubId);
    return { club, profile, sessions, state: stateOf(profile),
             problems: readinessProblems(profile, sessions) };
  },

  /**
   * Save what the club has said about itself.
   *
   * Does not touch whether the page is live. It does refuse an edit that
   * would leave a live page half empty: the checks on the way in only mean
   * something if they also hold on the way through.
   */
  async save(actor, clubId, { profile, sessions, removed = [] }) {
    await assertRole(actor, clubId, WRITE_PAGES);
    await this._club(clubId);

    if (profile.hero_asset_id) {
      const own = await one(
        `select 1 from asset where id = $1 and organisation_id = $2`,
        [profile.hero_asset_id, clubId]);
      if (!own) throw new Invalid(
        'That picture is not in this club\'s library. Upload it here first.');
    }

    const was = await one(
      `select * from dojo_profile where organisation_id = $1`, [clubId]);
    if (was?.published) {
      const problems = readinessProblems(profile, sessions);
      if (problems.length) throw new ClubPageNotReady(
        ['Your page is live, so this would leave it unfinished.', ...problems]);
    }

    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`
        insert into dojo_profile (organisation_id, venue_name, address_line,
          suburb, city, postcode, directions, phone, email, blurb, who_trains,
          first_class_free, accepts_beginners, hero_asset_id, updated_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
        on conflict (organisation_id) do update set
          venue_name = excluded.venue_name, address_line = excluded.address_line,
          suburb = excluded.suburb, city = excluded.city,
          postcode = excluded.postcode, directions = excluded.directions,
          phone = excluded.phone, email = excluded.email, blurb = excluded.blurb,
          who_trains = excluded.who_trains,
          first_class_free = excluded.first_class_free,
          accepts_beginners = excluded.accepts_beginners,
          hero_asset_id = excluded.hero_asset_id, updated_at = now()`,
        [clubId, profile.venue_name, profile.address_line, profile.suburb,
         profile.city, profile.postcode, profile.directions, profile.phone,
         profile.email, profile.blurb, profile.who_trains,
         profile.first_class_free, profile.accepts_beginners,
         profile.hero_asset_id]);

      // Times are edited in place, never deleted and recreated, because
      // attendance points at them. An emptied row is a time the club has
      // stopped running; only that one goes.
      const mine = (await client.query(
        `select id::text from training_session where organisation_id = $1`,
        [clubId])).rows.map((r) => r.id);
      for (const id of removed.filter((r) => mine.includes(r)))
        await client.query(
          `delete from training_session where id = $1 and organisation_id = $2`,
          [id, clubId]);

      let order = 0;
      for (const s of sessions) {
        order += 1;
        if (s.id && mine.includes(s.id)) {
          await client.query(`
            update training_session set label=$3, weekday=$4, starts=$5,
              ends=$6, min_age=$7, max_age=$8, sort_order=$9
            where id = $1 and organisation_id = $2`,
            [s.id, clubId, s.label, s.weekday, s.starts, s.ends,
             s.minAge, s.maxAge, order]);
        } else {
          await client.query(`
            insert into training_session (organisation_id, label, weekday,
              starts, ends, min_age, max_age, sort_order)
            values ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [clubId, s.label, s.weekday, s.starts, s.ends,
             s.minAge, s.maxAge, order]);
        }
      }
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }

    await this._audit(actor, clubId, clubId, 'club_page_saved',
      { venue: was?.venue_name ?? null }, { venue: profile.venue_name });
    return this.forClub(actor, clubId);
  },

  /** The club asks to be on the federation's website. */
  async request(actor, clubId) {
    await assertRole(actor, clubId, MANAGE);
    const club = await this._club(clubId);
    if (!club.parent_id) throw new Invalid('This club has no federation to ask.');

    const profile = await one(
      `select * from dojo_profile where organisation_id = $1`, [clubId]) ?? {};
    const problems = readinessProblems(profile, await this._sessionsOf(clubId));
    if (problems.length) throw new ClubPageNotReady(problems);
    if (profile.published) throw new Invalid('Your page is already live.');

    await pool.query(`
      update dojo_profile set page_requested_at = now(), page_note = null
      where organisation_id = $1`, [clubId]);
    await this._audit(actor, clubId, clubId, 'club_page_requested', {}, { state: 'requested' });
    return this.forClub(actor, clubId);
  },

  /**
   * The club takes its own page down, or withdraws a request, whenever it
   * likes. Putting a page up needs a second party; taking it down does not.
   */
  async takeDown(actor, clubId) {
    await assertRole(actor, clubId, MANAGE);
    await this._club(clubId);
    const was = await one(
      `select published, page_requested_at from dojo_profile
       where organisation_id = $1`, [clubId]);
    await pool.query(`
      update dojo_profile set published = false, page_requested_at = null
      where organisation_id = $1`, [clubId]);
    await this._audit(actor, clubId, clubId, 'club_page_taken_down',
      { state: stateOf(was) }, { state: 'off' });
    return this.forClub(actor, clubId);
  },

  /**
   * The federation answers — or switches a club on without being asked,
   * which is the other way in and equally legitimate: a federation that has
   * filled in a club's details itself does not need the club to request.
   *
   * The decision belongs to somebody STRICTLY above the club. Without that a
   * club's own administrator would be able to approve its own request.
   */
  async decide(actor, clubId, approve, { decidedBy, note = null }) {
    await assertRole(actor, decidedBy, MANAGE);
    await this._club(clubId);

    const above = await one(`
      select 1 from organisation mine, organisation theirs
      where mine.id = $1 and theirs.id = $2
        and theirs.path <@ mine.path and theirs.id <> mine.id`,
      [decidedBy, clubId]);
    if (!above) throw new Invalid('That club does not sit beneath this organisation.');

    const profile = await one(
      `select * from dojo_profile where organisation_id = $1`, [clubId]) ?? {};

    if (approve) {
      const problems = readinessProblems(profile, await this._sessionsOf(clubId));
      if (problems.length) throw new ClubPageNotReady(problems);
      await pool.query(`
        update dojo_profile set published = true, page_requested_at = null,
          page_note = null, published_by = $2, published_at = now()
        where organisation_id = $1`, [clubId, actor]);
    } else {
      await pool.query(`
        update dojo_profile set published = false, page_requested_at = null,
          page_note = $2
        where organisation_id = $1`, [clubId, (note ?? '').trim().slice(0, 400) || null]);
    }
    await this._audit(actor, decidedBy, clubId,
      approve ? 'club_page_approved' : 'club_page_declined',
      { state: stateOf(profile) }, { state: approve ? 'live' : 'off' });
    return this.forClub(actor, clubId);
  },

  /**
   * Every club beneath this organisation and where its page stands.
   * Only for somebody who can decide, and only what sits beneath them.
   */
  async beneath(actor, orgId) {
    await assertRole(actor, orgId, MANAGE);
    const { rows } = await pool.query(`
      select o.id, o.name, o.slug,
             d.venue_name, d.city, d.phone, d.email, d.blurb, d.who_trains,
             coalesce(d.published, false) as published,
             d.page_requested_at, d.page_note, d.published_at,
             (select count(*) from training_session t
               where t.organisation_id = o.id)::int as sessions
      from organisation root
      join organisation o on o.path <@ root.path and o.id <> root.id
                          and o.type = 'club' and o.status = 'active'
      left join dojo_profile d on d.organisation_id = o.id
      where root.id = $1
      order by (d.page_requested_at is not null and not coalesce(d.published, false)) desc,
               o.name`, [orgId]);
    return rows.map((r) => ({
      ...r,
      state: stateOf(r),
      gaps: readinessGaps(r, Array.from({ length: r.sessions }, () => ({})))
        .map((g) => g.short),
    }));
  },
};


// ---------------------------------------------------------------------------
// messages
//
// A club writes to its own people, as the club. Only an administrator of the
// organisation (or of one above it) may. Everything sent is recorded against
// the people it reached, so "did they get it?" has an answer afterwards.
// ---------------------------------------------------------------------------

const peopleIn = async (org, audience, { eventId, personId, personIds }) => {
  if (audience === 'selected') {
    // Only people actually in this organisation: an id from anywhere else is dropped, not trusted.
    const r = await q(`
      select distinct a.person_id as id from affiliation a
      join organisation o on o.id = a.organisation_id
      where a.person_id = any($2::uuid[]) and a.ends is null and o.path <@ $1::ltree`,
      [org.path, personIds]);
    return r.map((x) => x.id);
  }
  if (audience === 'person') {
    const r = await q(`
      select distinct a.person_id as id from affiliation a
      join organisation o on o.id = a.organisation_id
      where a.person_id = $2 and a.ends is null and o.path <@ $1::ltree`,
      [org.path, personId]);
    if (!r.length) throw new NotFound('Person');
    return r.map((x) => x.id);
  }
  if (audience === 'event') {
    const r = await q(`
      select distinct en.person_id as id from event_entry en
      join event e on e.id = en.event_id
      join organisation o on o.id = e.organisation_id
      where e.id = $2 and o.path <@ $1::ltree and en.person_id is not null`,
      [org.path, eventId]);
    return r.map((x) => x.id);
  }
  const roles = audience === 'instructors' ? ['instructor'] : ['member', 'instructor', 'assistant', 'official'];
  const r = await q(`
    select distinct a.person_id as id from affiliation a
    join organisation o on o.id = a.organisation_id
    where o.path <@ $1::ltree and a.ends is null and a.status = 'active'
      and a.role = any($2::text[])`, [org.path, roles]);
  return r.map((x) => x.id);
};

export const messages = {
  /** What the compose screen offers, and what a message would be sent as. */
  async options(actor, orgId, { baseFrom, trusted = false }) {
    if (!trusted) await assertRole(actor, orgId, MANAGE);
    const org = await one('select * from organisation where id=$1', [orgId]);
    if (!org) throw new NotFound('Organisation');
    const events = await q(`
      select e.id, e.title, to_char(e.starts_at at time zone o.timezone,'YYYY-MM-DD') as day
      from event e join organisation o on o.id = e.organisation_id
      where o.path <@ $1::ltree and e.status = 'published'
        and e.starts_at > now() - interval '60 days'
      order by e.starts_at desc limit 40`, [org.path]);
    const contact = org.type === 'club'
      ? (await one('select email from dojo_profile where organisation_id=$1', [orgId]))?.email : null;
    const me = actor ? await one('select email from account where id=$1', [actor]) : null;
    const sender = senderFor({ club: org, baseFrom, contactEmail: contact, actorEmail: me?.email });
    return { org, events, sender, contactEmail: contact };
  },

  async history(actor, orgId, { limit = 50 } = {}) {
    await assertRole(actor, orgId, MANAGE);
    return q(`
      select m.id, m.subject, m.audience, m.kind, m.created_at,
        count(r.*)::int as total,
        count(*) filter (where r.status = 'sent')::int as sent,
        count(*) filter (where r.status = 'failed')::int as failed,
        count(*) filter (where r.status in ('queued','sending'))::int as waiting,
        count(*) filter (where r.status in ('opted_out','no_email'))::int as skipped
      from message m left join message_recipient r on r.message_id = m.id
      where m.organisation_id = $1
      group by m.id order by m.created_at desc limit $2`, [orgId, limit]);
  },

  /** One message and who it went to. Scoped to the organisation asked about. */
  async get(actor, orgId, messageId) {
    await assertRole(actor, orgId, MANAGE);
    const message = await one(`select m.*, e.title as event_title from message m
      left join event e on e.id = m.event_id
      where m.id = $1 and m.organisation_id = $2`, [messageId, orgId]);
    if (!message) throw new NotFound('Message');
    const recipients = await q(`
      select r.id, r.email, r.status, r.error, r.sent_at,
        nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') as name,
        nullif(trim(concat_ws(' ', c.first_name, c.last_name)), '') as about
      from message_recipient r
      left join person p on p.id = r.person_id
      left join person c on c.id = r.about_id
      where r.message_id = $1
      order by r.status, p.last_name, p.first_name`, [messageId]);
    return { message, recipients };
  },

  /**
   * Work out who this reaches and write the message down, every recipient
   * queued. Nothing is sent here.
   */
  async prepare(actor, orgId, input, { baseFrom, trusted = false }) {
    if (!trusted) await assertRole(actor, orgId, MANAGE);
    const problems = problemsWithMessage(input);
    if (problems.length) throw new Invalid(problems.join(' '));

    const { org, sender } = await messages.options(actor, orgId, { baseFrom, trusted });
    if (!sender)
      throw new Invalid('Email is not set up to send from this system yet — ask whoever installed it to add a sending address.');
    if (!sender.replyTo)
      throw new Invalid('Add a contact email on the club\'s page first, so replies have somewhere to go.');
    if (input.audience === 'selected' && !input.personIds?.length)
      throw new Invalid('Choose who this is for.');

    let personId = null;
    if (input.audience === 'person') {
      personId = (await one('select id from person where upper(display_number) = upper($1)',
        [input.personNumber]))?.id;
      if (!personId) throw new Invalid(`There is no member numbered ${input.personNumber}.`);
    }
    const ids = await peopleIn(org, input.audience, { ...input, personId });
    if (!ids.length && input.audience === 'selected')
      throw new Invalid('None of those people are in this club.');
    const candidates = ids.length ? (await q(`
      select p.id as "personId", p.email,
        (p.date_of_birth is not null and p.date_of_birth > current_date - interval '18 years') as "isMinor",
        coalesce(ep.opted_out, false) as "optedOut",
        coalesce((select json_agg(json_build_object('personId', g.id, 'email', g.email,
                                                    'optedOut', coalesce(gp.opted_out, false)))
                  from guardian_link gl join person g on g.id = gl.guardian_id
                  left join email_preference gp on gp.person_id = g.id
                  where gl.child_id = p.id and gl.ended_on is null), '[]'::json) as guardians
      from person p left join email_preference ep on ep.person_id = p.id
      where p.id = any($1::uuid[])`, [ids])) : [];

    const { recipients, skipped } = chooseRecipients(candidates,
      { honourOptOut: input.kind === 'announcement' });
    if (!recipients.length)
      throw new Invalid(ids.length
        ? 'Nobody here can be emailed — they have no address on file, or have opted out.'
        : 'That group has nobody in it.');

    const message = await one(`
      insert into message (organisation_id, sent_by, kind, audience, event_id, subject, body,
                           sender_name, sender_address, reply_to)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [orgId, actor, input.kind, input.audience,
       input.audience === 'event' ? input.eventId : null,
       input.subject, input.body, sender.name, sender.address, sender.replyTo]);

    const rows = [
      ...recipients.map((r) => ({ ...r, status: 'queued' })),
      ...skipped.map((r) => ({ personId: r.personId, email: r.email ?? null,
                               status: r.reason, via: null })),
    ];
    await pool.query(`
      insert into message_recipient (message_id, person_id, email, about_id, status)
      select $1, x.p, x.e, x.a, x.s
      from unnest($2::uuid[], $3::text[], $4::uuid[], $5::text[]) as x(p, e, a, s)`,
      [message.id, rows.map((r) => r.personId), rows.map((r) => r.email),
       rows.map((r) => r.via ?? null), rows.map((r) => r.status)]);

    // A way out for each person we are about to write to.
    const who = [...new Set(recipients.map((r) => r.personId))];
    await pool.query(`
      insert into email_preference (person_id, token)
      select x.p, x.t from unnest($1::uuid[], $2::text[]) as x(p, t)
      on conflict (person_id) do nothing`,
      [who, who.map(() => crypto.randomBytes(18).toString('base64url'))]);

    await pool.query(`
      insert into audit_log (account_id, organisation_id, action, entity, entity_id, before, after)
      values ($1,$2,'message_sent','message',$3,null,$4)`,
      [actor, orgId, message.id, JSON.stringify({
        subject: input.subject, audience: input.audience, kind: input.kind,
        recipients: recipients.length, skipped: skipped.length })]);

    return { message, recipients: recipients.length, skipped: skipped.length };
  },

  /**
   * Send what is still queued, until the time budget runs out. Safe to call
   * again: a recipient is claimed before it is sent, so two presses of the
   * button do not write to anybody twice.
   */
  async sendBatch(actor, orgId, messageId, { messenger, origin, budgetMs = 6000, concurrency = 5, trusted = false }) {
    if (!trusted) await assertRole(actor, orgId, MANAGE);
    const message = await one('select * from message where id=$1 and organisation_id=$2',
      [messageId, orgId]);
    if (!message) throw new NotFound('Message');
    const org = await one('select name from organisation where id=$1', [orgId]);
    const started = Date.now();
    const sender = { name: message.sender_name, address: message.sender_address,
                     replyTo: message.reply_to };
    let sent = 0, failed = 0;

    const claim = () => q(`
      update message_recipient set status = 'sending', sent_at = now()
      where id in (select id from message_recipient
                   where message_id = $1
                     and (status = 'queued'
                          or (status = 'sending' and sent_at < now() - interval '3 minutes'))
                   order by id limit $2 for update skip locked)
      returning id, person_id, email`, [messageId, concurrency]);

    while (Date.now() - started < budgetMs) {
      const batch = await claim();
      if (!batch.length) break;
      const tokens = new Map((await q(
        'select person_id, token from email_preference where person_id = any($1::uuid[])',
        [batch.map((b) => b.person_id)])).map((t) => [t.person_id, t.token]));
      await Promise.all(batch.map(async (r) => {
        const token = tokens.get(r.person_id);
        const url = token && origin ? `${origin}/unsubscribe/${token}` : null;
        try {
          const res = await messenger.send({
            to: r.email, subject: message.subject, kind: 'message', sender,
            text: renderBody({ text: String(message.body)
                .replaceAll('{club}', org.name).replaceAll('{payLink}', origin ? `${origin}/me/payments` : 'your club'),
              club: org, unsubscribeUrl: url,
                               optOutHonoured: message.kind === 'announcement',
                               serviceNote: message.kind === 'renewal' ? 'This is about your membership fees, so it is sent whatever your email settings.' : undefined }),
            headers: url && message.kind === 'announcement' ? { 'List-Unsubscribe': `<${url}>` } : null,
          });
          await pool.query(`update message_recipient set status='sent', sent_at=now(),
            provider_id=$2, error=null where id=$1`, [r.id, res?.id ?? null]);
          sent++;
          await push.toPerson(r.person_id, { title: org.name, body: message.subject, url: "/me/messages" }).catch(() => {});
        } catch (e) {
          await pool.query(`update message_recipient set status='failed', error=$2 where id=$1`,
            [r.id, String(e.message ?? e).slice(0, 300)]);
          failed++;
        }
      }));
    }
    const left = await one(`select count(*)::int as n from message_recipient
      where message_id=$1 and status in ('queued','sending')`, [messageId]);
    return { sent, failed, waiting: left.n };
  },

  /** Put failed ones back in the queue. */
  async retryFailed(actor, orgId, messageId) {
    await assertRole(actor, orgId, MANAGE);
    const m = await one('select id from message where id=$1 and organisation_id=$2', [messageId, orgId]);
    if (!m) throw new NotFound('Message');
    await pool.query(`update message_recipient set status='queued', error=null
      where message_id=$1 and status='failed'`, [messageId]);
  },
};

/** The way out. The token is the authority, so it is looked up by nothing else. */
export const emailPreferences = {
  async byToken(token) {
    return one(`select ep.opted_out, p.first_name from email_preference ep
      join person p on p.id = ep.person_id where ep.token = $1`, [String(token)]);
  },
  async setOptOut(token, optedOut) {
    const row = await one(`update email_preference set opted_out=$2, updated_at=now()
      where token=$1 returning person_id`, [String(token), !!optedOut]);
    if (row) await pool.query(`
      insert into audit_log (account_id, organisation_id, action, entity, entity_id, before, after)
      select null::uuid, a.organisation_id, 'email_preference', 'person', $1::uuid, null::jsonb, $2::jsonb
      from affiliation a where a.person_id = $1 and a.ends is null limit 1`,
      [row.person_id, JSON.stringify({ optedOut: !!optedOut })]);
    return !!row;
  },
};


// ---------------------------------------------------------------------------
// payments
//
// A payment has one payee, decided by what it is for (core/domain/payments).
// It is made by the person it is for, or by a parent or guardian of a minor.
// A club sees what it has been paid; it does not see another club's.
// ---------------------------------------------------------------------------

const PAYMENT_SELECT = `
  select py.id, py.organisation_id, py.person_id, py.amount_cents, py.currency, py.status,
         py.method, py.detail, py.provider, py.provider_ref, py.created_at, py.settled_at, py.receipt_no,
         po.name as payee_name,
         nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') as person_name,
         p.display_number,
         (select coalesce(json_agg(json_build_object('kind', l.kind, 'description', l.description,
                          'amount_cents', l.amount_cents) order by l.id), '[]'::json)
            from payment_line l where l.payment_id = py.id) as lines
  from payment py
  join organisation po on po.id = py.organisation_id
  left join person p on p.id = py.person_id`;

/** A receipt number for cash: R-2026-0007. One counter per organisation per year. */
async function nextReceipt(orgId) {
  const r = await one(`
    insert into receipt_counter (organisation_id, year, last_number)
    values ($1, extract(year from now())::int, 1)
    on conflict (organisation_id, year) do update set last_number = receipt_counter.last_number + 1
    returning year, last_number`, [orgId]);
  return `R-${r.year}-${String(r.last_number).padStart(4, '0')}`;
}

/**
 * Carry a membership on. From the later of today and where it already runs to,
 * so paying early loses nothing and paying late is not backdated.
 */
async function renewMembership(affiliationId, months) {
  const a = await one(`select a.id, a.paid_until::text as paid_until, a.status,
      to_char((now() at time zone o.timezone)::date, 'YYYY-MM-DD') as today
    from affiliation a join organisation o on o.id = a.organisation_id where a.id = $1`, [affiliationId]);
  if (!a) return null;
  const until = extendedUntil(a.paid_until, a.today, months);
  await pool.query(`update affiliation set paid_until = $2::date,
      status = case when status in ('lapsed','trial') then 'active' else status end where id = $1`,
    [affiliationId, until]);
  // Somebody's first payment makes them a member: a number, and the trial and any referral follow.
  if (['trial', 'lapsed'].includes(a.status)) await becameMember(affiliationId);
  return until;
}

async function settle(paymentId, ok, detail, { actor = null, ref = undefined, manual = null } = {}) {
  const row = await one(`
    update payment set status = $2, detail = $3, updated_at = now(),
           settled_at = case when $2 = 'succeeded' then now() else settled_at end,
           provider_ref = coalesce($4, provider_ref),
           method = coalesce($5, method), taken_by = coalesce($6, taken_by),
           receipt_no = coalesce($7, receipt_no), provider = coalesce($8, provider)
     where id = $1 and status in ('awaiting','pending','failed')
     returning organisation_id, person_id, amount_cents, receipt_no`,
    [paymentId, ok ? 'succeeded' : 'failed', detail, ref ?? null,
     manual?.method ?? null, manual ? actor : null, manual?.receiptNo ?? null, manual ? 'manual' : null]);
  if (!row) return false;
  let renewed = [];
  if (ok) {
    await pool.query(`update event_entry set paid = true, updated_at = now()
      where id in (select event_entry_id from payment_line where payment_id = $1)`, [paymentId]);
    await pool.query(`update term_enrolment set paid = true
      where id in (select term_enrolment_id from payment_line where payment_id = $1 and term_enrolment_id is not null)`, [paymentId]);
    const lines = await q(`select renews_affiliation_id as id, renews_months as months
      from payment_line where payment_id = $1 and renews_affiliation_id is not null`, [paymentId]);
    for (const l of lines) renewed.push(await renewMembership(l.id, l.months));
  }
  await pool.query(`
    insert into audit_log (account_id, organisation_id, action, entity, entity_id, before, after)
    values ($1,$2,$3,'payment',$4,null,$5)`,
    [actor, row.organisation_id,
     manual ? 'payment_recorded' : ok ? 'payment_made' : 'payment_failed', paymentId,
     JSON.stringify({ amountCents: row.amount_cents, personId: row.person_id,
       ...(manual ? { method: manual.method, receipt: row.receipt_no } : {}),
       ...(renewed.length ? { paidUntil: renewed[0] } : {}) })]);
  if (ok) await webhooks.emitNow(row.organisation_id, 'payment.succeeded', { payment_id: paymentId, person_id: row.person_id, amount_cents: row.amount_cents });
  return true;
}

export const payments = {
  /** What one person owes and has paid. Authority is theirs or their guardian's. */
  async forPerson(actor, personId) {
    await family.assertMayActFor(actor, personId);
    return q(`${PAYMENT_SELECT} where py.person_id = $1 and py.status <> 'void'
      order by (py.status in ('pending','failed','awaiting')) desc, py.created_at desc`, [personId]);
  },

  /** Everything the signed-in person and their children owe, for the home screen. */
  async owedBy(actor) {
    const { self, dependants } = await family.mine(actor);
    const ids = [self, ...dependants].filter(Boolean).map((x) => x.id);
    if (!ids.length) return [];
    return q(`${PAYMENT_SELECT} where py.person_id = any($1::uuid[])
      and py.status in ('pending','failed','awaiting') order by py.created_at`, [ids]);
  },

  async get(actor, paymentId) {
    const row = await one(`${PAYMENT_SELECT} where py.id = $1`, [paymentId]);
    if (!row || !row.person_id) throw new NotFound('Payment');
    await family.assertMayActFor(actor, row.person_id);
    return row;
  },

  /**
   * Pay. The row is claimed first (pending/failed → awaiting), so pressing the
   * button twice reaches the provider once.
   */
  async pay(actor, paymentId, input, { provider }) {
    const row = await payments.get(actor, paymentId);
    const problems = problemsWithPayment(input);
    if (problems.length) throw new Invalid(problems.join(' '));

    const claimed = await one(`update payment set status='awaiting', method=$2, paid_by=$3,
        provider=$4, updated_at=now()
      where id=$1 and status in ('pending','failed') returning id`,
      [paymentId, input.method, actor, provider.name]);
    if (!claimed) throw new Invalid('This has already been paid, or is being paid.');

    let result;
    try {
      result = await provider.start({ amountCents: row.amount_cents, currency: row.currency,
        method: input.method, card: input.card, reference: paymentId });
    } catch (e) {
      await settle(paymentId, false, `The payment provider could not be reached: ${e.message}`.slice(0, 250), { actor });
      throw new Invalid('The payment could not be started. Nothing was charged — try again.');
    }
    if (result.status === 'succeeded') await settle(paymentId, true, result.detail, { actor, ref: result.ref });
    else if (result.status === 'failed') await settle(paymentId, false, result.detail, { actor, ref: result.ref });
    else await pool.query(`update payment set provider_ref=$2, detail=$3, updated_at=now() where id=$1`,
      [paymentId, result.ref, result.detail]);
    return payments.get(actor, paymentId);
  },

  /** Test provider only: stands in for the bank telling us the money arrived. */
  async completeTest(actor, paymentId, ok, { provider }) {
    if (!isTestProvider(provider)) throw new Forbidden('This is only available with test payments.');
    const row = await payments.get(actor, paymentId);
    if (row.status !== 'awaiting') throw new Invalid('Nothing is waiting on this payment.');
    await settle(paymentId, ok, ok ? 'Confirmed by the test bank.' : 'Refused by the test bank.', { actor });
    return payments.get(actor, paymentId);
  },

  /** What this organisation has been paid, and what is owed to it. */
  async receivedBy(actor, orgId, { limit = 100 } = {}) {
    await assertRole(actor, orgId, MANAGE);
    const rows = await q(`${PAYMENT_SELECT} where py.organisation_id = $1 and py.status <> 'void'
      order by py.created_at desc limit $2`, [orgId, limit]);
    const totals = await q(`
      select l.kind, py.status, count(*)::int as n, sum(l.amount_cents)::int as cents
      from payment py join payment_line l on l.payment_id = py.id
      where py.organisation_id = $1 and py.status in ('succeeded','pending','awaiting')
      group by l.kind, py.status`, [orgId]);
    const methods = await q(`select py.method, sum(py.amount_cents)::int as cents
      from payment py where py.organisation_id = $1 and py.status = 'succeeded' and py.method is not null
      group by py.method order by cents desc`, [orgId]);
    return { rows, totals, methods };
  },

  /**
   * A club asks one of its members for money. The payee is worked out from
   * what it is for: a kyu grading or a uniform is the club's, a black belt
   * grading is the federation's.
   */
  async request(actor, orgId, input) {
    await assertRole(actor, orgId, REGISTER);
    const problems = problemsWithPaymentRequest(input);
    if (problems.length) throw new Invalid(problems.join(' '));

    const org = await one('select * from organisation where id=$1', [orgId]);
    const person = await one(`select id, first_name, last_name from person
      where upper(display_number) = upper($1)`, [input.personNumber]);
    const home = person && await one(`
      select o.id from affiliation a join organisation o on o.id = a.organisation_id
      where a.person_id = $1 and a.ends is null and a.status = 'active' and o.type = 'club'
        and o.path <@ $2::ltree order by a.starts limit 1`, [person.id, org.path]);
    if (!person || !home) throw new Invalid(`There is no member numbered ${input.personNumber} here.`);

    const root = await one(`select id from organisation where parent_id is null and $1::ltree <@ path`, [org.path]);
    let payeeId;
    try { payeeId = payeeFor(input.kind, { clubId: home.id, federationId: root?.id }); }
    catch (e) { throw new Invalid(e.message); }

    if (input.received) {
      if (!MANUAL_METHODS[input.received]) throw new Invalid('Choose how it was paid.');
      const may = await one('select has_role_at($1,$2,$3) as ok', [actor, payeeId, REGISTER]);
      if (!may?.ok) throw new Invalid('This money belongs to the federation, so a dojo cannot record it as received. Ask for it instead.');
    }
    const description = input.description || PAY_KINDS[input.kind].label;
    const client = await pool.connect();
    try {
      await client.query('begin');
      const { rows: [pay] } = await client.query(`
        insert into payment (organisation_id, person_id, amount_cents, currency, status, requested_by)
        values ($1,$2,$3,'NZD','pending',$4) returning *`,
        [payeeId, person.id, input.amountCents, actor]);
      await client.query(`insert into payment_line (payment_id, kind, description, amount_cents)
        values ($1,$2,$3,$4)`, [pay.id, input.kind, description, input.amountCents]);
      await client.query(`
        insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
        values ($1,$2,'payment_requested','payment',$3,$4)`,
        [actor, payeeId, pay.id, JSON.stringify({ kind: input.kind, amountCents: input.amountCents,
          person: `${person.first_name} ${person.last_name}`, description })]);
      await client.query('commit');
      if (input.received) await payments.recordManual(actor, pay.id, input.received);
      return pay;
    } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
  },

  /**
   * The dojo has been handed the money — cash, or a transfer into its account.
   * Only somebody who looks after the organisation being paid can say so, and
   * it is numbered, attributed and in the history: a cash tin with no record is
   * the thing treasurers lose sleep over.
   */
  async recordManual(actor, paymentId, method) {
    if (!MANUAL_METHODS[method]) throw new Invalid('Choose how it was paid.');
    const pay = await one('select organisation_id, status from payment where id=$1', [paymentId]);
    if (!pay) throw new NotFound('Payment');
    await assertRole(actor, pay.organisation_id, REGISTER);
    if (!['pending', 'failed'].includes(pay.status)) throw new Invalid('This has already been dealt with.');
    const receiptNo = await nextReceipt(pay.organisation_id);
    const done = await settle(paymentId, true, `${MANUAL_METHODS[method]} received.`,
      { actor, manual: { method, receiptNo } });
    if (!done) throw new Invalid('This has already been dealt with.');
    return one('select * from payment where id=$1', [paymentId]);
  },

  /** Take back a request nobody has paid. */
  async cancel(actor, orgId, paymentId) {
    await assertRole(actor, orgId, REGISTER);
    const row = await one(`update payment set status='void', updated_at=now()
      where id=$1 and organisation_id=$2 and status in ('pending','failed') returning id`,
      [paymentId, orgId]);
    if (!row) throw new NotFound('Payment');
  },
};

// ---------------------------------------------------------------------------
// fees and renewals
//
// Each dojo sets its own prices. Asking for a renewal creates an ordinary
// payment — to the dojo — whose line says which membership it renews and for
// how long. However it is paid (online, cash, transfer), paying moves the
// membership on. Somebody marked exempt is never asked.
// ---------------------------------------------------------------------------

const clubOnly = async (orgId) => {
  const org = await one('select * from organisation where id=$1', [orgId]);
  if (!org) throw new NotFound('Organisation');
  if (org.type !== 'club') throw new Invalid('Fees are set by each club.');
  return org;
};

const feeRows = (orgId) => q(`select id, label, amount_cents, currency, period, applies_to,
        to_char(effective_from,'YYYY-MM-DD') as effective_from,
        to_char(effective_to,'YYYY-MM-DD') as effective_to
      from fee_schedule where organisation_id = $1
      order by period, applies_to, effective_from desc`, [orgId]);

export const fees = {
  /** Anybody who runs renewals may see the prices; setting them is for administrators. */
  async list(actor, orgId) {
    await assertRole(actor, orgId, REGISTER);
    await clubOnly(orgId);
    return feeRows(orgId);
  },

  async save(actor, orgId, input) {
    await assertRole(actor, orgId, MANAGE);
    const org = await clubOnly(orgId);
    const problems = problemsWithFee(input, centsFrom);
    if (problems.length) throw new Invalid(problems.join(' '));
    const today = (await one(`select to_char((now() at time zone $1)::date,'YYYY-MM-DD') as d`, [org.timezone])).d;
    const from = input.effectiveFrom || today;
    // A new price for the same people and period replaces the old one from its
    // start date; the old one stops the day before, so there is never an
    // ambiguity about which applies.
    await pool.query(`update fee_schedule set effective_to = ($4::date - 1)
      where organisation_id=$1 and applies_to=$2 and period=$3
        and effective_from < $4::date and (effective_to is null or effective_to >= $4::date)`,
      [orgId, input.appliesTo, input.period, from]);
    const row = await one(`insert into fee_schedule (organisation_id, label, amount_cents, period,
        applies_to, effective_from) values ($1,$2,$3,$4,$5,$6::date) returning id`,
      [orgId, input.label, centsFrom(input.amountText), input.period, input.appliesTo, from]);
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
      values ($1,$2,'fee_set','fee_schedule',$3,$4)`, [actor, orgId, row.id,
      JSON.stringify({ label: input.label, amountCents: centsFrom(input.amountText), period: input.period,
        appliesTo: input.appliesTo })]);
    return row;
  },

  async remove(actor, orgId, feeId) {
    await assertRole(actor, orgId, MANAGE);
    const row = await one(`delete from fee_schedule where id=$1 and organisation_id=$2
      returning label, amount_cents`, [feeId, orgId]);
    if (!row) throw new NotFound('Price');
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, after)
      values ($1,$2,'fee_removed','fee_schedule',$3)`, [actor, orgId,
      JSON.stringify({ label: row.label, amountCents: row.amount_cents })]);
  },
};

async function rosterFor(orgId) {
  const org = await clubOnly(orgId);
    const rows = await q(`
      select a.id as affiliation_id, a.role, a.status, a.fee_exempt, a.fee_exempt_reason,
             a.paid_until::text as paid_until, p.id as person_id, p.display_number,
             nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') as name,
             case when p.date_of_birth is null then null
                  else date_part('year', age((now() at time zone $2)::date, p.date_of_birth))::int end as age,
             exists (select 1 from payment_line l join payment py on py.id = l.payment_id
                      where l.renews_affiliation_id = a.id and py.status in ('pending','awaiting','failed')) as asked,
             exists (select 1 from payment_agreement g where g.affiliation_id = a.id and g.status = 'active') as auto_renew,
             (select max(mr.sent_at)::date::text from message_recipient mr join message m on m.id = mr.message_id
               where m.kind = 'renewal' and mr.status = 'sent' and (mr.person_id = p.id or mr.about_id = p.id)) as last_reminded
      from affiliation a join person p on p.id = a.person_id
      where a.organisation_id = $1 and a.ends is null
        and a.role in ('member','instructor','assistant') and a.status in ('active','lapsed','pending','trial')
      order by p.last_name, p.first_name`, [orgId, org.timezone]);
    const today = (await one(`select to_char((now() at time zone $1)::date,'YYYY-MM-DD') as d`, [org.timezone])).d;
    return { today, rows: rows.map((r) => ({ ...r, standing: r.status === 'trial' ? 'trial' : standing({ paidUntil: r.paid_until, exempt: r.fee_exempt }, today) })) };
}

export const renewals = {
  /** Everybody at the club, and where their fees stand. */
  async roster(actor, orgId) {
    await assertRole(actor, orgId, REGISTER);
    return rosterFor(orgId);
  },

  /** Write to the ticked members about their fees, as the club. */
  async remind(actor, orgId, { affiliationIds, subject, body }, { baseFrom }) {
    await assertRole(actor, orgId, REGISTER);
    const { rows } = await rosterFor(orgId);
    const people = rows.filter((r) => affiliationIds.includes(r.affiliation_id) && !r.fee_exempt)
      .map((r) => r.person_id);
    if (!people.length) throw new Invalid('Tick the people to remind. Anybody who is not charged is left out.');
    return messages.prepare(actor, orgId, { audience: 'selected', kind: 'renewal', personIds: people,
      subject: String(subject ?? '').replace(/\s+/g, ' ').trim().slice(0, 150),
      body: String(body ?? '').trim().slice(0, 10_000), eventId: null, personNumber: null },
      { baseFrom, trusted: true });
  },

  /** Whether this club writes its own reminders automatically. */
  async reminderSetting(orgId) {
    return (await one(`select coalesce((settings->'reminders'->>'enabled')::boolean, false) as on
      from organisation where id=$1`, [orgId])).on;
  },

  async setReminders(actor, orgId, enabled) {
    await assertRole(actor, orgId, MANAGE);
    await clubOnly(orgId);
    await pool.query(`update organisation set settings = coalesce(settings,'{}'::jsonb) || jsonb_build_object('reminders',
      coalesce(settings->'reminders','{}'::jsonb) || jsonb_build_object('enabled', $2::boolean)), updated_at = now() where id = $1`, [orgId, !!enabled]);
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
      values ($1,$2,'reminders_setting','organisation',$2,$3)`, [actor, orgId, JSON.stringify({ enabled: !!enabled })]);
  },

  /**
   * Ask a set of members to renew, at the dojo's own price for each. Nothing is
   * charged by asking. Returns who was asked and who was not, and why.
   */
  async ask(actor, orgId, { affiliationIds, period, received = null }) {
    await assertRole(actor, orgId, REGISTER);
    await clubOnly(orgId);
    if (!PERIODS[period] || !PERIODS[period].months) throw new Invalid('Choose how long to renew for.');
    if (!affiliationIds?.length) throw new Invalid('Tick the people to ask.');
    if (received && !MANUAL_METHODS[received]) throw new Invalid('Choose how it was paid.');

    const { today, rows } = await renewals.roster(actor, orgId);
    const schedule = await feeRows(orgId);
    const chosen = rows.filter((r) => affiliationIds.includes(r.affiliation_id));
    let asked = 0; const skipped = [];
    for (const r of chosen) {
      if (r.fee_exempt) { skipped.push({ name: r.name, reason: 'not charged' }); continue; }
      if (r.asked) { skipped.push({ name: r.name, reason: 'already asked' }); continue; }
      const fee = feeFor(schedule, { ageYears: r.age, period, today });
      if (!fee) { skipped.push({ name: r.name, reason: `no ${r.age != null && r.age < 18 ? 'junior' : 'adult'} price for “${PERIODS[period].label.toLowerCase()}”` }); continue; }
      const client = await pool.connect();
      try {
        await client.query('begin');
        const { rows: [pay] } = await client.query(`insert into payment (organisation_id, person_id,
            amount_cents, currency, status, requested_by) values ($1,$2,$3,$4,'pending',$5) returning id`,
          [orgId, r.person_id, fee.amount_cents, fee.currency ?? 'NZD', actor]);
        await client.query(`insert into payment_line (payment_id, kind, description, amount_cents,
            renews_affiliation_id, renews_months) values ($1,'dojo_fee',$2,$3,$4,$5)`,
          [pay.id, `${fee.label} — membership ${PERIODS[period].label.toLowerCase()}`, fee.amount_cents,
           r.affiliation_id, PERIODS[period].months]);
        await client.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
          values ($1,$2,'payment_requested','payment',$3,$4)`, [actor, orgId, pay.id,
          JSON.stringify({ kind: 'dojo_fee', amountCents: fee.amount_cents, person: r.name,
            description: `${fee.label} renewal` })]);
        await client.query('commit'); asked++;
        if (received) await payments.recordManual(actor, pay.id, received);
      } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
    }
    return { asked, skipped };
  },

  /** The dojo decides somebody does not pay — and says why. */
  async setExemption(actor, orgId, affiliationId, input) {
    await assertRole(actor, orgId, MANAGE);
    await clubOnly(orgId);
    const problems = problemsWithExemption(input);
    if (problems.length) throw new Invalid(problems.join(' '));
    const row = await one(`update affiliation set fee_exempt=$3, fee_exempt_reason=$4
      where id=$1 and organisation_id=$2 and ends is null returning person_id`,
      [affiliationId, orgId, input.exempt, input.exempt ? input.reason : null]);
    if (!row) throw new NotFound('Member');
    // Anything already asked of them is withdrawn: they were never to be asked.
    if (input.exempt) await pool.query(`update payment set status='void', updated_at=now()
      where status in ('pending','failed') and id in
        (select payment_id from payment_line where renews_affiliation_id = $1)`, [affiliationId]);
    const who = await one(`select nullif(trim(concat_ws(' ', first_name, last_name)), '') as name
      from person where id=$1`, [row.person_id]);
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
      values ($1,$2,'fee_exemption','person',$3,$4)`, [actor, orgId, row.person_id,
      JSON.stringify({ exempt: input.exempt, reason: input.reason || null, person: who?.name })]);
  },

  /** An exempt member's membership carried on a year, with no payment. */
  async carryOn(actor, orgId, affiliationId) {
    await assertRole(actor, orgId, REGISTER);
    await clubOnly(orgId);
    const a = await one(`select a.id, a.person_id, a.fee_exempt from affiliation a
      where a.id=$1 and a.organisation_id=$2 and a.ends is null`, [affiliationId, orgId]);
    if (!a) throw new NotFound('Member');
    if (!a.fee_exempt) throw new Invalid('Only somebody who is not charged can be renewed without paying.');
    const until = await renewMembership(affiliationId, 12);
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
      values ($1,$2,'membership_carried_on','person',$3,$4)`, [actor, orgId, a.person_id,
      JSON.stringify({ paidUntil: until })]);
    return until;
  },
};


// ---------------------------------------------------------------------------
// automatic renewal
// ---------------------------------------------------------------------------

import { chargeDue, afterFailure, problemsWithSetup, cardLabel, METHODS as AUTO_METHODS, PERIOD_CHOICES, CHARGE_LEAD_DAYS, MAX_FAILURES }
  from '../core/domain/autorenew.mjs';

const AGREEMENT_SELECT = `select g.id, g.organisation_id, g.affiliation_id, g.person_id, g.period, g.method, g.label, g.status, g.failures,
    g.next_attempt_on::text as next_attempt_on, g.last_error, g.agreed_at, o.name as dojo,
    a.paid_until::text as paid_until, a.fee_exempt,
    nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') as person_name
  from payment_agreement g join organisation o on o.id = g.organisation_id
  join affiliation a on a.id = g.affiliation_id join person p on p.id = g.person_id`;

export const autoRenew = {
  AUTO_METHODS, PERIOD_CHOICES, CHARGE_LEAD_DAYS, MAX_FAILURES,

  /** Where this person stands: each club membership, whether it renews itself, and what it would cost. */
  async forPerson(actor, personId) {
    await family.assertMayActFor(actor, personId);
    const mem = await q(`select a.id as affiliation_id, a.organisation_id, o.name as dojo, a.paid_until::text as paid_until, a.fee_exempt
      from affiliation a join organisation o on o.id = a.organisation_id
      where a.person_id = $1 and a.ends is null and a.role in ('member','instructor','assistant') and o.type = 'club'
        and a.status in ('active','lapsed') order by o.name`, [personId]);
    const live = await q(`${AGREEMENT_SELECT} where g.person_id = $1 and g.status <> 'cancelled'`, [personId]);
    const person = await one(`select id, first_name, last_name, date_of_birth::text as dob from person where id = $1`, [personId]);
    const out = [];
    for (const m of mem) {
      const today = await qualToday(m.organisation_id);
      const age = person.dob ? Math.floor((Date.parse(today) - Date.parse(person.dob)) / 31_557_600_000) : null;
      const schedule = await feeRows(m.organisation_id);
      const prices = Object.fromEntries(PERIOD_CHOICES.map((pd) => [pd, feeFor(schedule, { ageYears: age, period: pd, today })]).filter(([, f]) => f));
      out.push({ ...m, agreement: live.find((g) => g.affiliation_id === m.affiliation_id) ?? null, prices });
    }
    return { person, memberships: out };
  },

  /** The person (or their parent) agrees to automatic renewal and gives a method. Only a token is kept. */
  async start(actor, personId, affiliationId, input, { provider }) {
    await family.assertMayActFor(actor, personId);
    const problems = problemsWithSetup({ method: input.method, period: input.period, agreed: input.agreed });
    if (problems.length) throw new Invalid(problems.join(' '));
    const a = await one(`select a.id, a.organisation_id, a.fee_exempt, o.type from affiliation a join organisation o on o.id = a.organisation_id
      where a.id = $1 and a.person_id = $2 and a.ends is null and a.role in ('member','instructor','assistant')`, [affiliationId, personId]);
    if (!a || a.type !== 'club') throw new NotFound('Membership');
    if (a.fee_exempt) throw new Invalid('You are not charged here, so there is nothing to renew.');
    const today = await qualToday(a.organisation_id);
    const person = await one('select date_of_birth::text as dob from person where id=$1', [personId]);
    const age = person.dob ? Math.floor((Date.parse(today) - Date.parse(person.dob)) / 31_557_600_000) : null;
    if (!feeFor(await feeRows(a.organisation_id), { ageYears: age, period: input.period, today }))
      throw new Invalid('The dojo has not set a price for that yet. Choose another, or ask the dojo.');
    if (await one(`select 1 x from payment_agreement where affiliation_id=$1 and status <> 'cancelled'`, [affiliationId]))
      throw new Invalid('Automatic renewal is already set up. Stop it first to change it.');
    let saved;
    try { saved = await provider.saveMethod({ method: input.method, card: input.card }); }
    catch { throw new Invalid('We could not reach the payment provider. Nothing was saved — try again.'); }
    if (saved.status !== 'saved') throw new Invalid(saved.detail || 'That payment method was not accepted.');
    const row = await one(`insert into payment_agreement (organisation_id, affiliation_id, person_id, period, method, provider, provider_ref, label, agreed_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [a.organisation_id, affiliationId, personId, input.period, input.method, provider.name, saved.ref,
       input.method === 'card' ? cardLabel(input.card) : 'Bank direct debit', actor]);
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after) values ($1,$2,'auto_renew_start','person',$3,$4)`,
      [actor, a.organisation_id, personId, JSON.stringify({ period: input.period, method: input.method })]);
    return row.id;
  },

  /** One press. After it, nothing more is charged. */
  async cancel(actor, personId, agreementId) {
    await family.assertMayActFor(actor, personId);
    const g = await one(`update payment_agreement set status='cancelled', cancelled_at=now(), cancelled_by=$3, next_attempt_on=null
      where id=$1 and person_id=$2 and status <> 'cancelled' returning organisation_id`, [agreementId, personId, actor]);
    if (!g) throw new NotFound('Automatic renewal');
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after) values ($1,$2,'auto_renew_stop','person',$3,'{}')`,
      [actor, g.organisation_id, personId]);
  },

  /** A dojo's view: who renews themselves, who is failing. */
  async forClub(actor, orgId) {
    await assertRole(actor, orgId, REGISTER);
    await clubOnly(orgId);
    return q(`${AGREEMENT_SELECT} where g.organisation_id = $1 and g.status <> 'cancelled'
      order by (g.status = 'paused') desc, (g.failures > 0) desc, p.last_name, p.first_name`, [orgId]);
  },

  /**
   * The daily run. For each agreement whose membership is about to run out: ask for the dojo's price, charge the saved
   * method, and let the ordinary payment path extend the membership. Safe to run twice: the payment is claimed before
   * the provider is asked, and a second run finds the membership already extended or an attempt already waiting.
   */
  async run({ provider, messenger = null, origin = '', baseFrom = '', budgetMs = 9000 }) {
    const started = Date.now();
    const rows = await q(`${AGREEMENT_SELECT} where g.status = 'active' order by g.agreed_at`);
    const report = { charged: 0, failed: 0, paused: 0, skipped: 0 };
    for (const g of rows) {
      if (Date.now() - started > budgetMs) break;
      const today = await qualToday(g.organisation_id);
      if (!chargeDue({ status: g.status, nextAttemptOn: g.next_attempt_on, paidUntil: g.paid_until, exempt: g.fee_exempt }, today)) { report.skipped++; continue; }
      const person = await one('select date_of_birth::text as dob from person where id=$1', [g.person_id]);
      const age = person.dob ? Math.floor((Date.parse(today) - Date.parse(person.dob)) / 31_557_600_000) : null;
      const fee = feeFor(await feeRows(g.organisation_id), { ageYears: age, period: g.period, today });
      if (!fee) { report.skipped++; continue; }
      // Reuse an attempt already waiting rather than asking twice.
      let pay = await one(`select py.id from payment py join payment_line l on l.payment_id = py.id
        where l.renews_affiliation_id = $1 and py.status in ('pending','failed') order by py.created_at desc limit 1`, [g.affiliation_id]);
      if (!pay) {
        const client = await pool.connect();
        try {
          await client.query('begin');
          const { rows: [p] } = await client.query(`insert into payment (organisation_id, person_id, amount_cents, currency, status)
            values ($1,$2,$3,$4,'pending') returning id`, [g.organisation_id, g.person_id, fee.amount_cents, fee.currency ?? 'NZD']);
          await client.query(`insert into payment_line (payment_id, kind, description, amount_cents, renews_affiliation_id, renews_months)
            values ($1,'dojo_fee',$2,$3,$4,$5)`, [p.id, `${fee.label} — automatic renewal ${PERIODS[g.period].label.toLowerCase()}`, fee.amount_cents, g.affiliation_id, PERIODS[g.period].months]);
          await client.query('commit'); pay = p;
        } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
      }
      const claimed = await one(`update payment set status='awaiting', method=$2, provider=$3, updated_at=now()
        where id=$1 and status in ('pending','failed') returning id`, [pay.id, g.method === 'card' ? 'card' : 'direct_debit', provider.name]);
      if (!claimed) { report.skipped++; continue; }
      let result;
      try { result = await provider.charge({ ref: (await one('select provider_ref from payment_agreement where id=$1', [g.id])).provider_ref,
        amountCents: fee.amount_cents, currency: fee.currency ?? 'NZD', reference: pay.id }); }
      catch (e) { result = { status: 'failed', detail: 'The payment provider could not be reached.' }; }
      if (result.status === 'succeeded') {
        await settle(pay.id, true, result.detail, { ref: result.ref });
        await pool.query(`update payment_agreement set failures=0, next_attempt_on=null, last_error=null where id=$1`, [g.id]);
        report.charged++;
      } else if (result.status === 'awaiting') {
        await pool.query(`update payment set provider_ref=$2, detail=$3, updated_at=now() where id=$1`, [pay.id, result.ref, result.detail]);
        report.charged++;
      } else {
        await settle(pay.id, false, result.detail ?? 'Declined.', { ref: result.ref });
        const next = afterFailure(g.failures, today);
        await pool.query(`update payment_agreement set failures=$2, status=$3, next_attempt_on=$4, last_error=$5 where id=$1`,
          [g.id, next.failures, next.status, next.nextAttemptOn, String(result.detail ?? 'Declined.').slice(0, 250)]);
        report.failed++;
        if (next.status === 'paused') report.paused++;
        await push.toPerson(g.person_id, { title: next.status === 'paused' ? 'Automatic renewal has stopped' : 'Your membership payment did not go through',
          body: `${g.dojo}: ${g.person_name}`, url: `/me/${g.person_id}/auto-renew` });
        if (messenger) {
          const text = next.status === 'paused'
            ? { subject: 'Automatic renewal has stopped', body: `We could not take your membership payment for ${g.person_name} at ${g.dojo} after several tries, so automatic renewal is paused. Please sign in, go to My payments, and pay or set up automatic renewal again.` }
            : { subject: 'Your membership payment did not go through', body: `We tried to renew ${g.person_name}'s membership at ${g.dojo} and the payment did not go through (${result.detail ?? 'declined'}). We will try again on ${next.nextAttemptOn}. You can also pay now from My payments.` };
          try {
            const made = await messages.prepare(null, g.organisation_id, { audience: 'selected', kind: 'renewal', personIds: [g.person_id],
              subject: text.subject, body: text.body, eventId: null, personNumber: null }, { baseFrom, trusted: true });
            await messages.sendBatch(null, g.organisation_id, made.message.id, { messenger, origin, trusted: true, budgetMs: 3000 });
          } catch { /* the failure is recorded either way; a missing address must not stop the run */ }
        }
      }
    }
    return report;
  },
};

/**
 * The daily run: for every club that has switched automatic reminders on, write
 * to members whose fees are about to run out or have recently. Meant to be
 * called by a scheduler; it is safe to run twice, because nobody is written to
 * again within REMIND_EVERY_DAYS and a half-sent message is resumed, not remade.
 *
 * There is no signed-in person here. Each message is the club's, from the
 * club's sender, and records that nobody in particular sent it.
 */
export const reminders = {
  async run({ messenger, origin, baseFrom, budgetMs = 9000 }) {
    const started = Date.now();
    const clubs = await q(`select id, name, slug from organisation
      where type = 'club' and status = 'active' and (settings->'reminders'->>'enabled')::boolean is true
      order by name`);
    const report = [];

    for (const club of clubs) {
      const line = { club: club.slug, written: 0, skipped: null };
      try {
        // First, finish anything an earlier run left unsent.
        const open = await q(`select distinct m.id from message m join message_recipient r on r.message_id = m.id
          where m.organisation_id = $1 and m.kind = 'renewal' and m.sent_by is null
            and r.status in ('queued','sending')`, [club.id]);
        for (const m of open) {
          if (Date.now() - started > budgetMs) break;
          await messages.sendBatch(null, club.id, m.id, { messenger, origin, trusted: true,
            budgetMs: Math.max(1000, budgetMs - (Date.now() - started)) });
        }

        const { today, rows } = await rosterFor(club.id);
        const groups = dueForReminder(rows, today);
        for (const [which, list] of [['due', groups.due], ['overdue', groups.overdue]]) {
          if (!list.length || Date.now() - started > budgetMs) continue;
          const text = reminderText(which);
          const made = await messages.prepare(null, club.id, { audience: 'selected', kind: 'renewal',
            personIds: list.slice(0, 200).map((r) => r.person_id), subject: text.subject, body: text.body,
            eventId: null, personNumber: null }, { baseFrom, trusted: true });
          line.written += made.recipients;
          await messages.sendBatch(null, club.id, made.message.id, { messenger, origin, trusted: true,
            budgetMs: Math.max(1000, budgetMs - (Date.now() - started)) });
        }
      } catch (e) {
        // One club's missing contact address must not stop the others.
        line.skipped = String(e.message ?? e).slice(0, 200);
      }
      report.push(line);
    }
    return report;
  },
};

// ---------------------------------------------------------------------------
// classes and attendance
//
// A class is a line on the club's timetable. The roll for a class on a day is
// the people who came. Instructors keep it; the same records are what grading
// eligibility counts.
// ---------------------------------------------------------------------------

import { problemsWithSheet, classesOn, notSeenSince, perWeek, isDate, addDays, BACKFILL_DAYS }
  from '../core/domain/attendance.mjs';

const TEACHERS = ['owner', 'administrator', 'registrar', 'instructor'];

const todayAt = async (org) =>
  (await one(`select to_char((now() at time zone $1)::date,'YYYY-MM-DD') as d`, [org.timezone])).d;

async function attendanceClub(orgId) {
  const org = await one('select * from organisation where id=$1', [orgId]);
  if (!org) throw new NotFound('Organisation');
  if (org.type !== 'club') throw new Invalid('Attendance is kept by each club.');
  return org;
}

export const attendance = {
  /** The classes that run on a day, how many came, and who has not been seen lately. */
  async overview(actor, orgId, { date = null, days = 30 } = {}) {
    await assertRole(actor, orgId, TEACHERS);
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
    await assertRole(actor, orgId, TEACHERS);
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
    await assertRole(actor, orgId, TEACHERS);
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


// ---------------------------------------------------------------------------
// newcomers: people trying a class before they join
//
// Kept apart from people on purpose (see domain/newcomer.mjs). An instructor
// can add one on the night; a registrar turns them into a member.
// ---------------------------------------------------------------------------

import { readNewcomer, problemsWithNewcomer, isChild, timeToTalk, RETAIN_DAYS }
  from '../core/domain/newcomer.mjs';

export const newcomers = {
  async list(actor, orgId) {
    await assertRole(actor, orgId, TEACHERS);
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
    return { org, today, newcomers: rows.map((r) => ({ ...r,
      child: isChild(r.date_of_birth, today), readyToTalk: r.status === 'trialling' && timeToTalk(r.visits) })) };
  },

  /** Add a newcomer, and — if asked — mark them as at a class today. */
  async add(actor, orgId, input, { sessionId = null, date = null } = {}) {
    await assertRole(actor, orgId, TEACHERS);
    const org = await attendanceClub(orgId);
    const today = await todayAt(org);
    const problems = problemsWithNewcomer(input, today);
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
         input.emergencyPhone || null, input.medicalNotes || null, input.consentName, actor]);
      if (sheet) await client.query(`insert into newcomer_attendance (newcomer_id, organisation_id, session_id, session_date)
        values ($1,$2,$3,$4::date)`, [n.id, orgId, sessionId, date]);
      await client.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
        values ($1,$2,'newcomer_added','newcomer',$3,$4)`, [actor, orgId, n.id,
        JSON.stringify({ child: isChild(input.dateOfBirth, today), consent_by: input.consentName })]);
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

    const child = isChild(n.dob, (await todayAt(await one('select timezone from organisation where id=$1', [orgId]))));
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
    await assertRole(actor, orgId, TEACHERS);
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

// ---------------------------------------------------------------------------
// reports: what the treasurer, the registrar and the national office ask for
//
// Each report is a list of rows with named columns; the route turns it into a
// CSV or a table. They work for a club or for any organisation above clubs,
// which sees everybody beneath it. Downloading personal data is itself written
// to the audit log, because "who took the member list" is a fair question.
// ---------------------------------------------------------------------------

import { REPORTS, readRange, cents } from '../core/domain/csv.mjs';

const IN_TREE = `(select o.id from organisation root join organisation o on o.path <@ root.path where root.id = $1)`;
const REPORT_ROLES = { register: REGISTER, manage: ['owner', 'administrator'], teach: TEACHERS };

export const reports = {
  list: REPORTS,

  async run(actor, orgId, name, { from = null, to = null, download = false } = {}) {
    const def = REPORTS[name];
    if (!def) throw new NotFound('Report');
    await assertRole(actor, orgId, REPORT_ROLES[def.needs]);
    const org = await one('select id, name, slug, type, timezone from organisation where id=$1', [orgId]);
    if (!org) throw new NotFound('Organisation');
    const today = (await one(`select to_char((now() at time zone $1)::date,'YYYY-MM-DD') as d`, [org.timezone])).d;
    const range = readRange(from, to, today);
    const out = await reports[`_${name}`](orgId, today, range);

    if (download) await q(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
      values ($1,$2,'report_exported','organisation',$2,$3)`, [actor, orgId,
      JSON.stringify({ report: name, rows: out.rows.length, ...(def.dates ? range : {}) })]);
    return { org, today, name, label: def.label, range: def.dates ? range : null, ...out };
  },

  async _members(orgId, today) {
    const rows = await q(`
      select o.name as club, p.display_number as number, p.first_name, p.last_name, a.role, a.status,
             to_char(p.date_of_birth,'YYYY-MM-DD') as date_of_birth,
             case when p.date_of_birth is null then null else date_part('year', age($2::date, p.date_of_birth))::int end as age,
             p.gender, p.email, p.phone, cg.label as grade, to_char(cg.awarded_on,'YYYY-MM-DD') as graded_on,
             to_char(a.starts,'YYYY-MM-DD') as joined, to_char(a.paid_until,'YYYY-MM-DD') as paid_until,
             a.fee_exempt,
             (select to_char(max(t.session_date),'YYYY-MM-DD') from attendance t where t.person_id = p.id) as last_trained
      from affiliation a join person p on p.id = a.person_id join organisation o on o.id = a.organisation_id
      left join person_current_grade cg on cg.person_id = p.id
      where a.organisation_id in ${IN_TREE} and a.ends is null and a.role in ('member','instructor','assistant')
        and a.status in ('active','lapsed','pending')
      order by o.name, p.last_name, p.first_name`, [orgId, today]);
    return { columns: [['club', 'Club'], ['number', 'Member number'], ['first_name', 'First name'], ['last_name', 'Last name'],
      ['role', 'Role'], ['status', 'Status'], ['date_of_birth', 'Date of birth'], ['age', 'Age'], ['gender', 'Gender'],
      ['email', 'Email'], ['phone', 'Phone'], ['grade', 'Grade'], ['graded_on', 'Graded on'], ['joined', 'Joined'],
      ['paid_until', 'Paid until'], ['standing', 'Fees'], ['last_trained', 'Last trained']]
      .map(([key, label]) => ({ key, label })),
      rows: rows.map((r) => ({ ...r, standing: standing({ paidUntil: r.paid_until, exempt: r.fee_exempt }, today) })) };
  },

  async _fees(orgId, today) {
    const { rows } = await reports._members(orgId, today);
    const owing = rows.filter((r) => ['unpaid', 'overdue', 'due'].includes(r.standing)).map((r) => ({
      ...r, days_late: r.standing === 'overdue' ? Math.round((Date.parse(today) - Date.parse(r.paid_until)) / 864e5) : null }));
    owing.sort((a, b) => (b.days_late ?? -1) - (a.days_late ?? -1));
    return { columns: [['club', 'Club'], ['number', 'Member number'], ['first_name', 'First name'], ['last_name', 'Last name'],
      ['standing', 'Fees'], ['paid_until', 'Paid until'], ['days_late', 'Days overdue'], ['age', 'Age'], ['email', 'Email'], ['phone', 'Phone']]
      .map(([key, label]) => ({ key, label })), rows: owing };
  },

  async _payments(orgId, _today, { from, to }) {
    const rows = await q(`
      select to_char(coalesce(py.settled_at, py.created_at),'YYYY-MM-DD') as date, py.receipt_no as receipt,
             po.name as payee, p.display_number as number,
             nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') as payer,
             (select string_agg(l.kind, ' + ' order by l.id) from payment_line l where l.payment_id = py.id) as kinds,
             (select string_agg(l.description, '; ' order by l.id) from payment_line l where l.payment_id = py.id) as description,
             py.method, py.amount_cents
      from payment py join organisation po on po.id = py.organisation_id left join person p on p.id = py.person_id
      where py.organisation_id in ${IN_TREE} and py.status = 'succeeded'
        and coalesce(py.settled_at, py.created_at)::date between $2::date and $3::date
      order by coalesce(py.settled_at, py.created_at), py.receipt_no`, [orgId, from, to]);
    return { columns: [['date', 'Date'], ['receipt', 'Receipt'], ['payee', 'Paid to'], ['number', 'Member number'],
      ['payer', 'Paid by'], ['kinds', 'For'], ['description', 'Details'], ['method', 'Method'], ['amount', 'Amount']]
      .map(([key, label]) => ({ key, label })),
      rows: rows.map((r) => ({ ...r, amount: cents(r.amount_cents) })),
      total: rows.reduce((s, r) => s + r.amount_cents, 0) };
  },

  async _attendance(orgId, _today, { from, to }) {
    const rows = await q(`
      select o.name as club, p.display_number as number, p.first_name, p.last_name,
             count(*)::int as classes, count(distinct t.session_date)::int as days,
             to_char(max(t.session_date),'YYYY-MM-DD') as last_trained
      from attendance t join person p on p.id = t.person_id join organisation o on o.id = t.organisation_id
      where t.organisation_id in ${IN_TREE} and t.session_date between $2::date and $3::date
      group by o.name, p.id, p.display_number, p.first_name, p.last_name
      order by o.name, classes desc, p.last_name`, [orgId, from, to]);
    return { columns: [['club', 'Club'], ['number', 'Member number'], ['first_name', 'First name'], ['last_name', 'Last name'],
      ['classes', 'Classes'], ['days', 'Days'], ['last_trained', 'Last trained']].map(([key, label]) => ({ key, label })), rows };
  },

  async _compliance(orgId) {
    const c = await complianceData(orgId);
    const rows = [];
    for (const r of c.rows) for (const i of r.items)
      rows.push({ club: r.club, number: r.display_number, name: r.name, role: r.role, qualification: i.label,
        state: STATE_WORDS[i.state], expires_on: i.expires_on, cleared: r.cleared ? 'Yes' : 'No' });
    for (const e of c.expiring) rows.push({ club: e.club, number: '', name: e.name, role: '', qualification: e.label,
      state: STATE_WORDS[e.state], expires_on: e.expires_on, cleared: '' });
    return { columns: [['club', 'Club'], ['number', 'Member number'], ['name', 'Name'], ['role', 'Role'], ['qualification', 'Qualification'],
      ['state', 'Status'], ['expires_on', 'Runs out'], ['cleared', 'Cleared to teach']].map(([key, label]) => ({ key, label })), rows };
  },

  async _gradings(orgId, _today, { from, to }) {
    const rows = await q(`
      select to_char(gr.awarded_on,'YYYY-MM-DD') as date, p.display_number as number, p.first_name, p.last_name,
             g.label as grade, gr.result, o.name as awarded_by, gr.certificate_no as certificate,
             to_char(gr.ratified_on,'YYYY-MM-DD') as ratified_on, e.title as event
      from grading_record gr join person p on p.id = gr.person_id join grade g on g.id = gr.grade_id
      join organisation o on o.id = gr.awarded_by_org left join event e on e.id = gr.event_id
      where gr.awarded_by_org in ${IN_TREE} and gr.awarded_on between $2::date and $3::date
      order by gr.awarded_on desc, p.last_name`, [orgId, from, to]);
    return { columns: [['date', 'Date'], ['number', 'Member number'], ['first_name', 'First name'], ['last_name', 'Last name'],
      ['grade', 'Grade'], ['result', 'Result'], ['awarded_by', 'Awarded by'], ['certificate', 'Certificate'],
      ['ratified_on', 'Ratified'], ['event', 'Event']].map(([key, label]) => ({ key, label })), rows };
  },
};

// ---------------------------------------------------------------------------
// grading events: enter, sit, finalise, certify
// ---------------------------------------------------------------------------

import { OUTCOMES, AWARDS, problemsWithResults, certificateNumber, entriesOpen }
  from '../core/domain/grading.mjs';

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
          entryId = (await client.query(`insert into event_entry (event_id, person_id, entered_by, entered_for_org, amount_cents, status)
            values ($1,$2,$3,$4,$5,'entered') returning id`, [eventId, m.id, actor, clubId, fee || null])).rows[0].id;
          await client.query(`insert into grading_entry (entry_id, grade_id) values ($1,$2)`, [entryId, gradeId]);
        }
        if (fee > 0) {
          const payee = payeeFor(kind, { clubId, organiserId: ev.organisation_id, federationId: root.id });
          const { rows: [pay] } = await client.query(`insert into payment (organisation_id, person_id, event_entry_id, amount_cents, currency, status, requested_by)
            values ($1,$2,$3,$4,'NZD','pending',$5) returning id`, [payee, m.id, entryId, fee, actor]);
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


// ---------------------------------------------------------------------------
// qualifications and compliance
//
// What a federation requires of the people who teach and judge, and who has it
// right now. The catalogue is the federation's (clubs inherit it); the awards
// are each person's. See core/domain/qualification.mjs for the rules.
// ---------------------------------------------------------------------------

import { CATEGORIES as QUAL_CATEGORIES, REQUIRED_FOR, STARTERS, readQualification, problemsWithQualification,
         problemsWithAward, statusOf, daysLeft, latestPerQualification, clearance, remindersDue,
         reminderText as qualReminderText, STATE_WORDS } from '../core/domain/qualification.mjs';

const CATALOGUE_FROM = `from organisation me join organisation a on me.path <@ a.path
  join qualification q on q.organisation_id = a.id where me.id = $1`;

const qualToday = async (orgId) => {
  const o = await one('select timezone from organisation where id=$1', [orgId]);
  return (await one(`select to_char((now() at time zone $1)::date,'YYYY-MM-DD') as d`, [o?.timezone ?? 'Pacific/Auckland'])).d;
};

const AWARD_SELECT = `
  select qa.id, qa.person_id, qa.qualification_id, to_char(qa.awarded_on,'YYYY-MM-DD') as awarded_on,
         to_char(qa.expires_on,'YYYY-MM-DD') as expires_on, qa.issued_by_other, qa.reference,
         q.label, q.code, q.category, q.required_for
  from qualification_award qa join qualification q on q.id = qa.qualification_id`;

/** An award with its state, newest-counting first. Superseded awards are flagged. */
function describeAwards(rows, today) {
  const latest = new Set(latestPerQualification(rows).map((a) => a.id));
  return rows.map((a) => ({ ...a, state: statusOf(a.expires_on, today), days_left: daysLeft(a.expires_on, today),
    counts: latest.has(a.id) })).sort((x, y) => (y.counts - x.counts) || String(y.awarded_on).localeCompare(x.awarded_on));
}

async function complianceData(orgId) {
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


// ---------------------------------------------------------------------------
// scheduled publishing
//
// A draft with a date goes live on that morning's run. Authority is checked
// when it is SCHEDULED (an owner or administrator), because nobody is present
// when it runs.
// ---------------------------------------------------------------------------

import { problemsWithScheduleDate } from '../core/domain/scheduling.mjs';

const schedulable = (table, label) => ({
  async schedule(actor, id, date) {
    const row = await one(`select t.id, t.organisation_id, t.title, t.status, o.timezone from ${table} t /* security-ok: table is a literal passed by schedulable() for page or article only */
      join organisation o on o.id = t.organisation_id where t.id = $1`, [id]);
    if (!row) throw new NotFound(label);
    await assertRole(actor, row.organisation_id, MANAGE);
    if (row.status === 'published') throw new Invalid('It is already live.');
    const today = (await one(`select to_char((now() at time zone $1)::date,'YYYY-MM-DD') as d`, [row.timezone])).d;
    const problems = problemsWithScheduleDate(date, today);
    if (problems.length) throw new Invalid(problems.join(' '));
    await q(`update ${table} set publish_at = ($2::date)::timestamp at time zone $3 where id = $1`, [id, date, row.timezone]); /* security-ok: table is a literal passed by schedulable() for page or article only */
    await q(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
      values ($1,$2,'publish_scheduled',$3,$4,$5)`, [actor, row.organisation_id, table, id, JSON.stringify({ title: row.title, date })]);
    return { date };
  },

  async unschedule(actor, id) {
    const row = await one(`select organisation_id, title from ${table} where id=$1`, [id]); /* security-ok: table is a literal passed by schedulable() for page or article only */
    if (!row) throw new NotFound(label);
    await assertRole(actor, row.organisation_id, MANAGE);
    await q(`update ${table} set publish_at = null where id=$1`, [id]); /* security-ok: table is a literal passed by schedulable() for page or article only */
    await q(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
      values ($1,$2,'publish_unscheduled',$3,$4,$5)`, [actor, row.organisation_id, table, id, JSON.stringify({ title: row.title })]);
  },

  async scheduledFor(id) {
    return (await one(`select to_char(publish_at at time zone o.timezone,'YYYY-MM-DD') as d from ${table} t /* security-ok: table is a literal passed by schedulable() for page or article only */
      join organisation o on o.id = t.organisation_id where t.id=$1 and t.status='draft' and t.publish_at is not null`, [id]))?.d ?? null;
  },
});
Object.assign(pages, schedulable('page', 'Page'));
Object.assign(news, schedulable('article', 'Article'));

export const scheduledPublishing = {
  /** Bring everything that is due live. Returns what went live, so the caller can rebuild the site once. */
  async run() {
    const made = [];
    for (const [table, label] of [['page', 'page'], ['article', 'article']]) {
      const rows = await q(`update ${table} set status='published', publish_at = null,
          published_at = coalesce(published_at, now())
        where status = 'draft' and publish_at is not null and publish_at <= now()
        returning id, organisation_id, title`);
      for (const r of rows) {
        await q(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
          values (null,$1,'published_on_schedule',$2,$3,$4)`, [r.organisation_id, table, r.id, JSON.stringify({ title: r.title })]);
        made.push({ kind: label, id: r.id, title: r.title });
      }
    }
    return made;
  },
};

// ---------------------------------------------------------------------------
// enquiries from the website's forms
// ---------------------------------------------------------------------------

import { readEnquiry, problemsWithEnquiry, emailBody, PER_VISITOR_PER_HOUR, PER_ORGANISATION_PER_DAY, RETAIN_DAYS as ENQUIRY_RETAIN_DAYS }
  from '../core/domain/enquiry.mjs';

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


// ---------------------------------------------------------------------------
// people who are not on any roll: finding them again, and registering them once
//
// The persistent identity is the PERSON. A returning competitor is recognised by
// the email or mobile they gave before and signs in with a link; a new one is
// created once. Nobody gets a second record because they used another door.
// ---------------------------------------------------------------------------

import { problemsWithOutsider, phoneKey } from '../core/domain/outsider.mjs';

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


// ---------------------------------------------------------------------------
// the member's own home: dashboard, inbox, record, documents, timetable
//
// Everything is for the signed-in person and the children they look after, by
// family.mayActFor. Nothing here takes an organisation or a role.
// ---------------------------------------------------------------------------

import { nextSession, actionsFor, messageText } from '../core/domain/portal.mjs';

const localNow = (tz) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Pacific/Auckland',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
};

const ageOnDate = (dob, date) => {
  if (!dob) return null;
  const [y, m, d] = String(dob).slice(0, 10).split('-').map(Number);
  const [cy, cm, cd] = date.split('-').map(Number);
  return cy - y - ((cm < m || (cm === m && cd < d)) ? 1 : 0);
};

export const portal = {
  /** One person's card on the dashboard. */
  async summary(actor, person, how) {
    const { rows: memberships } = await pool.query(`
      select a.id, o.id as org_id, o.name, o.slug, o.type, o.timezone, a.role, a.status,
             a.paid_until::text as paid_until, a.fee_exempt,
             (select json_agg(json_build_object('name', x.name, 'type', x.type) order by nlevel(x.path))
                from organisation x where o.path <@ x.path) as chain
      from affiliation a join organisation o on o.id = a.organisation_id
      where a.person_id = $1 and a.ends is null order by o.type, o.name`, [person.id]);

    const tz = memberships[0]?.timezone ?? 'Pacific/Auckland';
    const now = localNow(tz);
    for (const m of memberships)
      m.standing = m.status === 'trial' ? 'trial'
        : m.role === 'member' ? standing({ paidUntil: m.paid_until, exempt: m.fee_exempt }, localNow(m.timezone).date) : null;

    const grade = await one(`select label, rank_order, awarded_on::text as awarded_on
      from person_current_grade where person_id = $1`, [person.id]);

    const sessions = memberships.length ? await q(`
      select ts.id, ts.label, ts.weekday, to_char(ts.starts,'HH24:MI') as starts, to_char(ts.ends,'HH24:MI') as ends,
             ts.min_age, ts.max_age, g.rank_order as min_rank_order, o.name as club
      from training_session ts join organisation o on o.id = ts.organisation_id
      left join grade g on g.id = ts.min_grade_id
      where ts.organisation_id = any($1::uuid[])`,
      [memberships.filter((m) => m.role === 'member' && ['active', 'trial'].includes(m.status)).map((m) => m.org_id)]) : [];
    const next = nextSession(sessions, now, { ageYears: ageOnDate(person.date_of_birth, now.date), rankOrder: grade?.rank_order ?? null });

    const nextEvent = await one(`
      select e.title, e.starts_at, x.status, o.timezone as host_timezone
      from event_entry x join event e on e.id = x.event_id join organisation o on o.id = e.organisation_id
      where x.person_id = $1 and x.status in ('entered','confirmed') and e.starts_at > now()
      order by e.starts_at limit 1`, [person.id]);

    const open = await memberEvents.openFor(person.id);
    const closing = open.filter((e) => e.entries_close && new Date(e.entries_close) < new Date(Date.now() + 7 * 864e5));

    const owed = (await payments.owedBy(actor)).filter((p) => p.person_id === person.id)
      .map((p) => ({ id: p.id, amount_cents: p.amount_cents, currency: p.currency,
                     description: p.lines.map((l) => l.description).join('; ') }));

    const home = (await homesOf(person.id))[0];
    const qToday = home ? await qualToday(home) : null;
    const quals = qToday ? describeAwards(await q(`${AWARD_SELECT} where qa.person_id = $1`, [person.id]), qToday)
      .filter((a) => a.counts) : [];
    const priv = await one('select emergency_name, emergency_phone from person_private where person_id = $1', [person.id]);

    const counts = await one(`
      select (select count(*)::int from grading_record where person_id = $1 and certificate_no is not null
                 and result in ('pass','provisional')) as certificates,
             (select count(*)::int from entry_consent c join event_entry x on x.id = c.entry_id where x.person_id = $1) as consents,
             (select count(*)::int from attendance where person_id = $1 and session_date > current_date - 90) as recent_classes,
             (select to_char(max(session_date),'YYYY-MM-DD') from attendance where person_id = $1) as last_trained`, [person.id]);

    const trial = await trials.mine(actor, person.id);
    const trialLeft = trial && trial.status !== 'converted'
      ? Math.round((Date.parse(`${trial.ends}T00:00:00Z`) - Date.parse(`${now.date}T00:00:00Z`)) / 864e5) : null;
    const actions = actionsFor({ personId: person.id, owed, closing, qualifications: quals,
      formsDue: await forms.dueFor(person.id),
      trial: trial ? { left: trialLeft } : null,
      termsOpen: (await terms.forPerson(actor, person.id)).items.filter((i) => i.mayEnrol && !i.enrolment).slice(0, 1).map((i) => ({ name: i.term.name, first: person.first_name })),
      memberships: memberships.filter((m) => m.standing).map((m) => ({ name: m.name, standing: m.standing, paid_until: m.paid_until })),
      details: { emergencyContact: !!(priv?.emergency_name && priv?.emergency_phone) } });

    return { person, how, memberships, grade, next, nextEvent, trial: trial ? { ...trial, left: trialLeft } : null, openCount: open.length, closing: closing.length,
      owed, owedTotal: owed.reduce((n, p) => n + p.amount_cents, 0), currency: owed[0]?.currency ?? 'NZD',
      counts, qualifications: quals, actions };
  },

  /** The whole dashboard: me and the children I look after, and my messages. */
  async dashboard(actor) {
    const { self, dependants } = await family.mine(actor);
    if (!self) return { people: [], unread: 0, messages: [] };
    const people = [await this.summary(actor, self, 'self')];
    for (const d of dependants) people.push(await this.summary(actor, d, 'guardian'));
    const inbox = await this.inbox(actor, { limit: 5 });
    return { people, unread: inbox.unread, messages: inbox.rows };
  },

  /** Messages written to me, or to me about a child. */
  async inbox(actor, { limit = 50 } = {}) {
    const { self, dependants } = await family.mine(actor);
    const ids = [self, ...dependants].filter(Boolean).map((p) => p.id);
    if (!ids.length) return { rows: [], unread: 0 };
    const rows = await q(`
      select r.id, m.subject, o.name as club, r.sent_at, r.read_at,
             nullif(trim(concat_ws(' ', ab.first_name, ab.last_name)), '') as about
      from message_recipient r join message m on m.id = r.message_id
      join organisation o on o.id = m.organisation_id left join person ab on ab.id = r.about_id
      where r.person_id = any($1::uuid[]) and r.status = 'sent'
      order by r.sent_at desc limit $2`, [ids, limit]);
    const unread = (await one(`select count(*)::int as n from message_recipient
      where person_id = any($1::uuid[]) and status = 'sent' and read_at is null`, [ids])).n;
    return { rows, unread };
  },

  /** Open one message. Marks it read. Somebody else's recipient row is not found, not forbidden. */
  async message(actor, recipientId) {
    const { self, dependants } = await family.mine(actor);
    const ids = [self, ...dependants].filter(Boolean).map((p) => p.id);
    const row = await one(`
      select r.id, m.subject, m.body, o.name as club, r.sent_at, r.read_at, m.sender_name,
             nullif(trim(concat_ws(' ', ab.first_name, ab.last_name)), '') as about
      from message_recipient r join message m on m.id = r.message_id
      join organisation o on o.id = m.organisation_id left join person ab on ab.id = r.about_id
      where r.id = $1 and r.person_id = any($2::uuid[]) and r.status = 'sent'`, [recipientId, ids]);
    if (!row) throw new NotFound('Message');
    if (!row.read_at) await pool.query('update message_recipient set read_at = now() where id = $1 and read_at is null', [recipientId]);
    return { ...row, text: messageText(row.body, { club: row.club }) };
  },

  /** Grade history, attendance and events: the person's own record. */
  async record(actor, personId) {
    const how = await family.assertMayActFor(actor, personId);
    const person = await one(`select ${PERSON_COLUMNS} from person p where p.id = $1`, [personId]);
    const gradings = await q(`
      select g.label, to_char(gr.awarded_on,'YYYY-MM-DD') as awarded_on, gr.result, gr.certificate_no,
             ao.name as awarded_by, gr.id
      from grading_record gr join grade g on g.id = gr.grade_id
      left join organisation ao on ao.id = gr.awarded_by_org
      where gr.person_id = $1 order by gr.awarded_on desc, g.rank_order desc`, [personId]);
    const attendance = await q(`
      select to_char(a.session_date,'YYYY-MM-DD') as day, ts.label, o.name as club
      from attendance a join organisation o on o.id = a.organisation_id
      left join training_session ts on ts.id = a.session_id
      where a.person_id = $1 order by a.session_date desc limit 30`, [personId]);
    const stats = await one(`
      select count(*) filter (where session_date > current_date - 30)::int as last30,
             count(*) filter (where session_date > current_date - 365)::int as last365,
             count(*)::int as total, to_char(min(session_date),'YYYY-MM-DD') as since
      from attendance where person_id = $1`, [personId]);
    const events = await q(`
      select e.title, e.kind, e.starts_at, x.status, o.timezone as host_timezone,
             (select py.status from payment py where py.event_entry_id = x.id order by py.created_at desc limit 1) as pay_status,
             coalesce((select json_agg(json_build_object('discipline', d.name, 'division', v.label) order by d.sort_order)
                         from entry_selection s join event_discipline d on d.id = s.discipline_id
                         left join event_division v on v.id = s.division_id where s.entry_id = x.id), '[]'::json) as picks
      from event_entry x join event e on e.id = x.event_id join organisation o on o.id = e.organisation_id
      where x.person_id = $1 order by e.starts_at desc`, [personId]);
    return { how, person, gradings, attendance, stats, events,
      upcoming: events.filter((e) => new Date(e.starts_at) > new Date()).reverse(),
      past: events.filter((e) => new Date(e.starts_at) <= new Date()) };
  },

  /** What I have been given and what I have signed. */
  async documents(actor, personId) {
    const how = await family.assertMayActFor(actor, personId);
    const person = await one(`select ${PERSON_COLUMNS} from person p where p.id = $1`, [personId]);
    const certificates = await q(`select gr.id, g.label, gr.awarded_on::text as awarded_on, gr.certificate_no
      from grading_record gr join grade g on g.id = gr.grade_id
      where gr.person_id = $1 and gr.certificate_no is not null and gr.result in ('pass','provisional')
      order by gr.awarded_on desc`, [personId]);
    const consents = await q(`
      select c.id, c.version, c.accepted_name, c.accepted_at, c.guardian, e.title, e.consent_text, e.starts_at
      from entry_consent c join event_entry x on x.id = c.entry_id join event e on e.id = x.event_id
      where x.person_id = $1 order by c.accepted_at desc`, [personId]);
    const home = (await homesOf(personId))[0];
    const today = home ? await qualToday(home) : null;
    const qualifications = today ? describeAwards(await q(`${AWARD_SELECT} where qa.person_id = $1`, [personId]), today)
      .filter((a) => a.counts) : [];
    const receipts = await q(`select py.id, py.receipt_no, py.amount_cents, py.currency, py.settled_at, po.name as payee,
        (select string_agg(l.description, '; ') from payment_line l where l.payment_id = py.id) as description
      from payment py join organisation po on po.id = py.organisation_id
      where py.person_id = $1 and py.status = 'succeeded' order by py.settled_at desc nulls last limit 50`, [personId]);
    return { how, person, certificates, consents, qualifications, receipts };
  },

  /** The classes at the clubs I and my children belong to, with who each is for. */
  async timetable(actor) {
    const { self, dependants } = await family.mine(actor);
    const out = [];
    for (const person of [self, ...dependants].filter(Boolean)) {
      const clubs = await q(`select o.id, o.name, o.timezone from affiliation a join organisation o on o.id = a.organisation_id
        where a.person_id = $1 and a.ends is null and a.role = 'member' and a.status in ('active','trial')`, [person.id]);
      const grade = await one('select rank_order from person_current_grade where person_id = $1', [person.id]);
      for (const club of clubs) {
        const now = localNow(club.timezone);
        const sessions = await q(`
          select ts.id, ts.label, ts.weekday, to_char(ts.starts,'HH24:MI') as starts, to_char(ts.ends,'HH24:MI') as ends,
                 ts.min_age, ts.max_age, ts.notes, g.rank_order as min_rank_order, g.label as min_grade_label
          from training_session ts left join grade g on g.id = ts.min_grade_id
          where ts.organisation_id = $1 order by ts.weekday, ts.starts`, [club.id]);
        const who = { ageYears: ageOnDate(person.date_of_birth, now.date), rankOrder: grade?.rank_order ?? null };
        const next = nextSession(sessions, now, who);
        out.push({ person, club: club.name, next, sessions: sessions.map((s) => ({ ...s, forMe: nextSession([s], now, who) !== null })) });
      }
    }
    return out;
  },
};

// ---------------------------------------------------------------------------
// the digital card and class check-in
//
// A card is shown on the member's own screen (or a guardian's, for a child). Anyone can read the
// QR; only the signature makes it worth anything, and what an official sees depends on who they are.
// ---------------------------------------------------------------------------
import { cardValidThrough, cardRefusal, verdictFor, checkinPlan } from '../core/domain/card.mjs';
import { signCard, readCard, signCheckin, readCheckin, CARD_DAYS } from './card-token.mjs';

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
    if (actor && row) official = !!(await one('select has_role_at($1,$2,$3) as ok', [actor, row.org_id, TEACHERS_ROLES]))?.ok;
    return { verdict, official, stale, federation: row?.federation ?? null,
      member: official && row ? { name: row.name, number: row.display_number, club: row.club, grade: row.grade,
        paidUntil: row.paid_until, exempt: row.fee_exempt, hasPhoto: !!row.photo_asset_id, isInstructor: row.is_instructor, name: row.name, personId: row.id } : null };
  },
};
const TEACHERS_ROLES = ['owner', 'administrator', 'registrar', 'instructor'];

export const checkin = {
  /** The code an instructor shows for one class today. */
  async code(actor, orgId, sessionId) {
    await assertRole(actor, orgId, TEACHERS_ROLES);
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

// ---------------------------------------------------------------------------
// adult free trials and referrals
//
// A trial is a real person on a membership whose status is 'trial'. Joining is the club's first
// membership payment (settle → renewMembership → becameMember): the same person gets a number,
// the trial is marked converted and a referral that brought them in is looked at for its reward.
// ---------------------------------------------------------------------------

import { readGrowth, readGrowthForm, problemsWithGrowth, problemsWithTrialSignup, trialEnds, daysLeft as trialDaysLeft,
  trialsDue, newCode, normaliseCode, referralVerdict, referralQualifies, rewardsFor, rewardText, AUTOMATIC }
  from '../core/domain/growth.mjs';

const TRIAL_RETAIN_DAYS = 180;
const TRIALS_PER_VISITOR_PER_HOUR = 3;
const TRIALS_PER_CLUB_PER_DAY = 30;

const growthClub = async (slug) => {
  const org = await one(`select id, name, slug, type, timezone, settings from organisation
    where slug = $1 and type = 'club' and status = 'active'`, [slug]);
  if (!org) return null;
  return { ...org, growth: readGrowth(org.settings?.growth) };
};

/** The next number in the federation's own sequence. Inside the caller's transaction. */
async function allocateNumber(client, orgId) {
  const { rows: [fed] } = await client.query(`
    select coalesce(f.short_name, f.slug) as prefix from organisation target
    join organisation f on target.path <@ f.path and f.parent_id is null where target.id = $1`, [orgId]);
  const prefix = (fed?.prefix ?? 'M').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5) || 'M';
  const { rows: [seq] } = await client.query(`select coalesce(max(substring(display_number from '[0-9]+$')::int), 0) + 1 as next
    from person where display_number like $1`, [`${prefix}-%`]);
  return `${prefix}-${String(seq.next).padStart(4, '0')}`;
}

/** Best-effort email from the club. A message that cannot be sent never undoes what it was about. */
async function clubMail(org, { messenger, baseFrom }, to, subject, text) {
  try {
    const contact = (await one('select email from dojo_profile where organisation_id=$1', [org.id]))?.email ?? null;
    const sender = senderFor({ club: org, baseFrom, contactEmail: contact });
    if (!messenger || !sender || !to) return false;
    await messenger.send({ to, subject: String(subject).slice(0, 150), text, kind: 'trial', sender });
    return true;
  } catch { return false; }
}

export const clubMailer = clubMail;

async function becameMember(affiliationId) {
  const a = await one('select person_id, organisation_id from affiliation where id = $1', [affiliationId]);
  if (!a) return;
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows: [p] } = await client.query('select display_number from person where id = $1 for update', [a.person_id]);
    if (p && !p.display_number)
      await client.query('update person set display_number = $2 where id = $1', [a.person_id, await allocateNumber(client, a.organisation_id)]);
    await client.query(`update member_trial set status = 'converted', converted_at = now()
      where person_id = $1 and organisation_id = $2 and status <> 'converted'`, [a.person_id, a.organisation_id]);
    await client.query(`update referral set status = 'member', converted_at = now() where referred_id = $1 and status = 'trial'`, [a.person_id]);
    await client.query('commit');
  } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
  const r = await one(`select id from referral where referred_id = $1 and status = 'member'`, [a.person_id]);
  if (r) await referrals.qualify(r.id);
}

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
        [person.id, input.emergencyName, input.emergencyPhone, input.medical || null]);
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
      .map(([period, v]) => ({ period, label: v.label, fee: feeFor(schedule, { ageYears: ageOnDate(p.dob, today), period, today }) }))
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
        values ($1,$2,$3,$4,'pending',$5) returning id`, [orgId, personId, choice.fee.amount_cents, choice.fee.currency ?? 'NZD', actor]);
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

// ---------------------------------------------------------------------------
// school terms
//
// A country's terms are set once, at the top of the tree, and inherited. A child's enrolment in a term is
// its own record: a membership can run all year while the classes are paid for a term at a time.
// ---------------------------------------------------------------------------

import { builtInFor, builtInYears, yearToOffer, termState, mayEnrol, holidays as termHolidays, inHoliday, termPrice, readMidTerm,
  problemsWithMidTerm, problemsWithTerm, offersDue, CALENDARS } from '../core/domain/terms.mjs';

const termRow = `st.id, st.organisation_id, st.year, st.number, st.name, to_char(st.starts,'YYYY-MM-DD') as starts,
  to_char(st.ends,'YYYY-MM-DD') as ends, st.source`;

/** The terms that apply to this organisation for a year: its own, or the nearest ancestor's. */
async function effectiveTerms(orgId, year) {
  const rows = await q(`select ${termRow}, o.name as owner, nlevel(o.path) as depth /* security-ok: termRow is a fixed column list defined at module level */
    from school_term st join organisation o on o.id = st.organisation_id
    join organisation me on me.id = $1 and me.path <@ o.path
    where st.year = $2 order by nlevel(o.path) desc, st.number`, [orgId, year]);
  if (!rows.length) return { terms: [], owner: null };
  const top = rows[0].organisation_id;
  const terms = rows.filter((r) => r.organisation_id === top);
  return { terms, owner: { id: top, name: terms[0].owner }, inherited: top !== orgId };
}

/** The country an organisation is in: its own, or the nearest ancestor that says. */
const countryOf = async (orgId) => (await one(`select o.country_code from organisation me join organisation o on me.path <@ o.path
  where me.id = $1 and o.country_code is not null order by nlevel(o.path) desc limit 1`, [orgId]))?.country_code ?? null;

const midTermOf = (org) => { const r = org.settings?.terms?.midTerm; return r?.mode ? { mode: r.mode, fixedCents: r.fixedCents ?? 0 } : { mode: 'weeks', fixedCents: 0 }; };

export const terms = {
  /** The calendar as this organisation sees it, this year and next. */
  async overview(actor, orgId) {
    await assertRole(actor, orgId, REGISTER);
    const org = await one('select * from organisation where id = $1', [orgId]);
    const today = await todayAt(org);
    const y = Number(today.slice(0, 4));
    const country = await countryOf(orgId);
    const years = [];
    for (const year of [y, y + 1]) {
      const e = await effectiveTerms(orgId, year);
      const counts = e.terms.length ? await q(`select term_id, count(*)::int as n, count(*) filter (where paid)::int as paid, coalesce(sum(fee_cents) filter (where paid),0)::int as cents
        from term_enrolment where organisation_id = $1 and status = 'enrolled' and term_id = any($2::uuid[]) group by term_id`, [orgId, e.terms.map((t) => t.id)]) : [];
      years.push({ year, ...e, terms: e.terms.map((t) => ({ ...t, state: termState(t, today), ...(counts.find((c) => c.term_id === t.id) ?? { n: 0, paid: 0, cents: 0 }) })),
        holidays: termHolidays(e.terms), builtIn: !e.terms.length || !e.inherited ? builtInFor(country, year) : null });
    }
    const here = years.flatMap((yr) => yr.terms);
    return { org, today, country, years, midTerm: midTermOf(org), isClub: org.type === 'club',
      current: here.find((t) => t.starts <= today && today <= t.ends) ?? null,
      next: here.find((t) => t.starts > today) ?? null,
      holiday: inHoliday(here, today), calendar: CALENDARS[String(country ?? '').toUpperCase()] ?? null };
  },

  /** Load the country's own calendar for a year. */
  async loadBuiltIn(actor, orgId, year, { quiet = false } = {}) {
    if (!quiet) await assertRole(actor, orgId, MANAGE);
    const country = await countryOf(orgId);
    const cal = builtInFor(country, year);
    if (!cal) throw new Invalid(`There is no built-in calendar for ${country ?? 'this country'} in ${year}. Add the terms yourself.`);
    if ((await one('select 1 as x from school_term where organisation_id = $1 and year = $2', [orgId, year])))
      throw new Invalid(`${year} already has terms here.`);
    for (const t of cal.terms)
      await pool.query(`insert into school_term (organisation_id, year, number, name, starts, ends, source) values ($1,$2,$3,$4,$5,$6,'built-in')`,
        [orgId, year, t.number, t.name, t.starts, t.ends]);
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
      values ($1,$2,'terms_loaded','organisation',$2,$3)`, [quiet ? null : actor, orgId, JSON.stringify({ year, country, source: cal.source })]);
    return cal.terms.length;
  },

  async save(actor, orgId, input) {
    await assertRole(actor, orgId, MANAGE);
    const t = { id: input.id || null, name: String(input.name ?? '').trim().slice(0, 40), starts: String(input.starts ?? '').trim(), ends: String(input.ends ?? '').trim() };
    const year = Number(t.starts.slice(0, 4));
    const others = await q(`select id, to_char(starts,'YYYY-MM-DD') as starts, to_char(ends,'YYYY-MM-DD') as ends from school_term where organisation_id = $1`, [orgId]);
    const problems = problemsWithTerm(t, others);
    if (problems.length) throw new Invalid(problems.join(' '));
    if (t.id) {
      const row = await one(`update school_term set name=$3, starts=$4, ends=$5, year=$6, source='manual' where id=$1 and organisation_id=$2 returning id`, [t.id, orgId, t.name, t.starts, t.ends, year]);
      if (!row) throw new NotFound('Term');
    } else {
      const n = (await one('select coalesce(max(number),0)+1 as n from school_term where organisation_id=$1 and year=$2', [orgId, year])).n;
      await pool.query(`insert into school_term (organisation_id, year, number, name, starts, ends) values ($1,$2,$3,$4,$5,$6)`, [orgId, year, n, t.name, t.starts, t.ends]);
    }
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after) values ($1,$2,'term_saved','organisation',$2,$3)`, [actor, orgId, JSON.stringify(t)]);
  },

  async remove(actor, orgId, termId) {
    await assertRole(actor, orgId, MANAGE);
    if ((await one(`select 1 as x from term_enrolment where term_id = $1 and status = 'enrolled'`, [termId])))
      throw new Invalid('Children are enrolled in that term. Withdraw them first.');
    const row = await one('delete from school_term where id = $1 and organisation_id = $2 returning id', [termId, orgId]);
    if (!row) throw new NotFound('Term');
  },

  async setRule(actor, orgId, form) {
    await assertRole(actor, orgId, MANAGE);
    const org = await clubOnly(orgId);
    const rule = readMidTerm(form);
    const problems = problemsWithMidTerm(rule);
    if (problems.length) throw new Invalid(problems.join(' '));
    await pool.query(`update organisation set settings = coalesce(settings,'{}'::jsonb) || jsonb_build_object('terms',
      coalesce(settings->'terms','{}'::jsonb) || jsonb_build_object('midTerm', $2::jsonb)), updated_at = now() where id = $1`, [org.id, JSON.stringify(rule)]);
  },

  /** Who is enrolled in one term at one club. */
  async roster(actor, orgId, termId) {
    await assertRole(actor, orgId, REGISTER);
    const term = await one(`select ${termRow} from school_term st where st.id = $1`, [termId]); /* security-ok: termRow is a fixed column list defined at module level */
    if (!term) throw new NotFound('Term');
    const rows = await q(`select e.id, e.status, e.paid, e.fee_cents, e.price_note, to_char(e.enrolled_on,'YYYY-MM-DD') as enrolled_on, p.id as person_id,
        trim(concat_ws(' ', p.first_name, p.last_name)) as name, date_part('year', age(p.date_of_birth))::int as age
      from term_enrolment e join person p on p.id = e.person_id where e.term_id = $1 and e.organisation_id = $2 order by e.status, p.last_name, p.first_name`, [termId, orgId]);
    return { term, rows };
  },

  /** The terms a child could be enrolled in now, and what each costs them. */
  async forPerson(actor, personId) {
    const how = await family.assertMayActFor(actor, personId);
    const person = await one(`select ${PERSON_COLUMNS} from person p where p.id = $1`, [personId]);
    const home = await one(`select o.* from affiliation a join organisation o on o.id = a.organisation_id
      where a.person_id = $1 and a.role = 'member' and a.status in ('active') and a.ends is null limit 1`, [personId]);
    if (!home) return { how, person, club: null, items: [] };
    const today = await todayAt(home);
    const age = ageOnDate(person.date_of_birth, today);
    if (age == null || age >= 18) return { how, person, club: null, items: [] };
    const y = Number(today.slice(0, 4));
    const grade = await one('select rank_order from person_current_grade where person_id = $1', [personId]);
    const sessions = await q('select weekday, min_age, max_age, min_grade_id from training_session where organisation_id = $1', [home.id]);
    const weekdays = [...new Set(sessions.filter((s) => (s.min_age == null || age >= s.min_age) && (s.max_age == null || age <= s.max_age)).map((s) => s.weekday))];
    const schedule = await feeRows(home.id);
    const fee = feeFor(schedule, { ageYears: age, period: 'term', today });
    const rule = midTermOf(home);
    const items = [];
    for (const year of [y, y + 1]) {
      for (const t of (await effectiveTerms(home.id, year)).terms) {
        if (t.ends < today) continue;
        const enrolment = await one(`select id, status, paid, fee_cents, price_note from term_enrolment where term_id = $1 and person_id = $2`, [t.id, personId]);
        const state = termState(t, today);
        const price = fee ? termPrice({ fullCents: fee.amount_cents, term: t, today, rule, weekdays }) : { cents: 0, kind: 'free', note: 'No term fee set' };
        items.push({ term: t, state, enrolment, price, mayEnrol: mayEnrol(t, today) && !!price && (!enrolment || enrolment.status === 'withdrawn') });
      }
    }
    return { how, person, club: home.name, items, fee, rule };
  },

  async enrol(actor, personId, termId) {
    const info = await this.forPerson(actor, personId);
    const item = info.items.find((i) => i.term.id === termId);
    if (!item) throw new NotFound('Term');
    if (!item.mayEnrol) throw new Invalid(item.enrolment?.status === 'enrolled' ? 'Already enrolled.' : item.price ? 'Enrolment is not open for that term yet.' : 'The club does not take enrolments part-way through this term.');
    const home = await one(`select o.id, o.timezone from affiliation a join organisation o on o.id = a.organisation_id where a.person_id=$1 and a.role='member' and a.status='active' and a.ends is null`, [personId]);
    const today = await todayAt(home);
    const cents = item.price.cents;
    const client = await pool.connect();
    try {
      await client.query('begin');
      const { rows: [e] } = await client.query(`insert into term_enrolment (term_id, person_id, organisation_id, status, fee_cents, price_note, paid, enrolled_on, enrolled_by)
        values ($1,$2,$3,'enrolled',$4,$5,$6,$7::date,$8)
        on conflict (term_id, person_id) do update set status='enrolled', fee_cents=$4, price_note=$5, paid=$6, enrolled_on=$7::date, enrolled_by=$8 returning id`,
        [termId, personId, home.id, cents, item.price.note, cents === 0, today, actor]);
      let paymentId = null;
      if (cents > 0) {
        const { rows: [pay] } = await client.query(`insert into payment (organisation_id, person_id, amount_cents, currency, status, requested_by)
          values ($1,$2,$3,$4,'pending',$5) returning id`, [home.id, personId, cents, info.fee?.currency ?? 'NZD', actor]);
        await client.query(`insert into payment_line (payment_id, kind, description, amount_cents, term_enrolment_id) values ($1,'dojo_fee',$2,$3,$4)`,
          [pay.id, `${item.term.name} ${item.term.year} classes — ${info.person.first_name}${item.price.kind === 'full' ? '' : ` (${item.price.note})`}`, cents, e.id]);
        paymentId = pay.id;
      }
      await client.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after) values ($1,$2,'term_enrolled','term_enrolment',$3,$4)`,
        [actor, home.id, e.id, JSON.stringify({ term: item.term.name, year: item.term.year, cents })]);
      await client.query('commit');
      return { paymentId };
    } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
  },

  /** Withdraw before the term starts. An unpaid bill is cancelled; a paid one is left for the club to refund. */
  async withdraw(actor, personId, termId) {
    await family.assertMayActFor(actor, personId);
    const e = await one(`select e.id, e.paid, e.organisation_id, to_char(st.starts,'YYYY-MM-DD') as starts, o.timezone from term_enrolment e
      join school_term st on st.id = e.term_id join organisation o on o.id = e.organisation_id
      where e.term_id = $1 and e.person_id = $2 and e.status = 'enrolled'`, [termId, personId]);
    if (!e) throw new NotFound('Enrolment');
    if ((await todayAt(e)) >= e.starts) throw new Invalid('The term has started. Please ask the club.');
    await pool.query(`update payment set status='void', updated_at=now() where status in ('pending','failed') and id in (select payment_id from payment_line where term_enrolment_id = $1)`, [e.id]);
    await pool.query(`update term_enrolment set status='withdrawn' where id=$1`, [e.id]);
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after) values ($1,$2,'term_withdrawn','term_enrolment',$3,$4)`,
      [actor, e.organisation_id, e.id, JSON.stringify({ paid: e.paid })]);
    return { paid: e.paid };
  },

  /** Daily: load each country's next calendar where it is known, and offer the next term to families. */
  async run({ messenger, baseFrom, origin }) {
    const report = { loaded: [], offered: 0 };
    const roots = await q(`select id, name, country_code, settings from organisation where parent_id is null and status = 'active' and country_code is not null`);
    for (const r of roots) {
      if (r.settings?.terms?.auto === false) continue;
      const today = await todayAt({ timezone: (await one('select timezone from organisation where id=$1', [r.id])).timezone });
      const loaded = (await q('select distinct year from school_term where organisation_id = $1', [r.id])).map((x) => x.year);
      const year = yearToOffer(loaded, today);
      if (year && builtInYears(r.country_code).includes(year)) {
        try { await this.loadBuiltIn(null, r.id, year, { quiet: true }); report.loaded.push(`${r.name} ${year}`); } catch { /* already there */ }
      }
    }
    const clubs = await q(`select * from organisation where type = 'club' and status = 'active'`);
    for (const club of clubs) {
      const today = await todayAt(club);
      const y = Number(today.slice(0, 4));
      const all = [...(await effectiveTerms(club.id, y)).terms, ...(await effectiveTerms(club.id, y + 1)).terms];
      const due = offersDue(all, today);
      if (!due) continue;
      if (await one('select 1 as x from term_offer where term_id = $1 and organisation_id = $2', [due.next.id, club.id])) continue;
      const kids = await q(`select p.id, p.first_name, p.email::text as email,
          coalesce((select json_agg(g.email::text) from guardian_link gl join person g on g.id = gl.guardian_id where gl.child_id = p.id and gl.ended_on is null and g.email is not null), '[]'::json) as guardians
        from term_enrolment e join person p on p.id = e.person_id
        where e.term_id = $1 and e.organisation_id = $2 and e.status = 'enrolled'
          and not exists (select 1 from term_enrolment n where n.term_id = $3 and n.person_id = p.id)
          and exists (select 1 from affiliation a where a.person_id = p.id and a.organisation_id = $2 and a.status = 'active' and a.ends is null)`,
        [due.prev.id, club.id, due.next.id]);
      const byAddress = new Map();
      for (const k of kids) for (const addr of (k.guardians.length ? k.guardians : [k.email]).filter(Boolean)) byAddress.set(addr, [...(byAddress.get(addr) ?? []), k.first_name]);
      await pool.query('insert into term_offer (term_id, organisation_id) values ($1,$2) on conflict do nothing', [due.next.id, club.id]);
      for (const [to, names] of byAddress) {
        const sent = await clubMail(club, { messenger, baseFrom }, to, `${due.next.name} enrolment is open at ${club.name}`,
          `Hello,\n\nEnrolment for ${due.next.name} (${due.next.starts} to ${due.next.ends}) is open for ${names.join(' and ')}.\nEnrol online: ${origin}/me/terms\n\nSee you in class.`);
        if (sent) report.offered++;
      }
    }
    return report;
  },
};

// ---------------------------------------------------------------------------
// How an event is announced: its type, contacts, cost and map pin
// ---------------------------------------------------------------------------

import { readType, problemsWithDetail } from '../core/domain/event-types.mjs';

export const eventDetails = {
  async forEvent(eventId) {
    return one(`select type_key, contact_name, contact_email, contact_phone, cost_note, info_url, description,
      latitude::float as latitude, longitude::float as longitude from event_detail where event_id = $1`, [eventId]);
  },

  /** Read the extra fields off a submitted form; says what is wrong with them. */
  read(form) {
    const t = (k) => (String(form[k] ?? '').trim() || null);
    const n = (k) => { const v = t(k); return v == null ? null : Number(v); };
    const d = { typeKey: readType(form.eventType), contactName: t('contactName'), contactEmail: t('contactEmail'),
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

// ---------------------------------------------------------------------------
// A dojo's photo gallery
// ---------------------------------------------------------------------------

export const MAX_GALLERY = 300;

/** The year a picture belongs to when nobody said: this one, in the dojo's own calendar. */
const thisYear = () => new Date().getFullYear();

/** A year somebody typed, checked; blank means "work it out". */
function readYear(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1950 || n > thisYear() + 1) throw new Invalid(`The year must be between 1950 and ${thisYear() + 1}.`);
  return n;
}

export const gallery = {
  /** Newest year first, then by event, then in the order the dojo set. */
  async list(actor, orgId, { year = null, eventId = null } = {}) {
    await assertRole(actor, orgId, TEACH);
    return q(`select g.id, g.asset_id, g.caption, g.position, g.year, g.event_id, g.created_at,
        e.title as event_title, e.starts_at as event_starts,
        a.filename, a.width, a.height, a.alt_text
      from club_gallery g join asset a on a.id = g.asset_id
      left join event e on e.id = g.event_id
      where g.organisation_id = $1
        and ($2::int is null or g.year = $2)
        and ($3::uuid is null or g.event_id = $3)
      order by g.year desc nulls last, e.starts_at desc nulls last, g.event_id nulls last, g.position, g.created_at`,
      [orgId, year, eventId]);
  },

  /** The events a picture can be filed under: this dojo's own, newest first. */
  async events(actor, orgId) {
    await assertRole(actor, orgId, TEACH);
    return q(`select id, title, starts_at from event where organisation_id = $1 and status <> 'cancelled'
      order by starts_at desc limit 300`, [orgId]);
  },

  /** Years that have pictures, newest first, with how many. */
  async years(actor, orgId) {
    await assertRole(actor, orgId, TEACH);
    return q(`select year, count(*)::int as n from club_gallery where organisation_id = $1 and year is not null
      group by year order by year desc`, [orgId]);
  },

  /** Checks an event belongs to this dojo and returns it (or null for "no event"). */
  async _event(orgId, eventId) {
    if (!eventId) return null;
    const e = await one('select id, starts_at from event where id = $1 and organisation_id = $2', [eventId, orgId]);
    if (!e) throw new Invalid('Choose one of this club\'s own events.');
    return e;
  },

  async add(actor, orgId, assetId, caption = null, { year = null, eventId = null } = {}) {
    await assertRole(actor, orgId, TEACH);
    const a = await one('select organisation_id, alt_text from asset where id = $1', [assetId]);
    if (!a || a.organisation_id !== orgId) throw new Invalid('Choose one of this club\'s own pictures.');
    const count = (await one('select count(*)::int as n from club_gallery where organisation_id = $1', [orgId])).n;
    if (count >= MAX_GALLERY) throw new Invalid(`A gallery holds up to ${MAX_GALLERY} pictures. Remove some first.`);
    if (await one('select 1 as x from club_gallery where organisation_id = $1 and asset_id = $2', [orgId, assetId]))
      throw new Invalid('That picture is already in the gallery.');
    const ev = await this._event(orgId, eventId);
    // An event gives a picture its year unless somebody said otherwise.
    const y = readYear(year) ?? (ev ? new Date(ev.starts_at).getFullYear() : thisYear());
    const cap = String(caption ?? '').trim().slice(0, 160) || null;
    await pool.query('insert into club_gallery (organisation_id, asset_id, caption, position, year, event_id) values ($1,$2,$3,$4,$5,$6)',
      [orgId, assetId, cap, count, y, ev?.id ?? null]);
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id) values ($1,$2,'gallery_added','asset',$3)`, [actor, orgId, assetId]);
  },

  /**
   * Set the year and/or event on several pictures at once. `undefined` leaves a field alone;
   * eventId '' or null takes the picture out of its event.
   */
  async file(actor, orgId, ids, { year, eventId }) {
    await assertRole(actor, orgId, TEACH);
    if (!ids.length) throw new Invalid('Tick at least one picture first.');
    const sets = [], args = [orgId, ids];
    if (year !== undefined) {
      const y = readYear(year);
      if (y != null) { args.push(y); sets.push(`year = $${args.length}`); }
    }
    if (eventId !== undefined) {
      const ev = await this._event(orgId, eventId || null);
      args.push(ev?.id ?? null); sets.push(`event_id = $${args.length}`);
      // Putting pictures into an event with no year chosen files them under the event's year.
      if (ev && (year === undefined || String(year).trim() === '')) {
        args.push(new Date(ev.starts_at).getFullYear()); sets.push(`year = $${args.length}`);
      }
    }
    if (!sets.length) throw new Invalid('Choose a year or an event to file them under.');
    await pool.query(`update club_gallery set ${sets.join(', ')} where organisation_id = $1 and id = any($2::uuid[])`, args); /* security-ok: sets holds only fragments we wrote, values are $n placeholders */
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, after) values ($1,$2,'gallery_filed','club_gallery',$3)`,
      [actor, orgId, JSON.stringify({ count: ids.length, year: year ?? null, eventId: eventId ?? null })]);
  },

  async remove(actor, orgId, id) { return this.removeMany(actor, orgId, [id]); },

  async removeMany(actor, orgId, ids) {
    await assertRole(actor, orgId, TEACH);
    if (!ids.length) throw new Invalid('Tick at least one picture first.');
    await pool.query('delete from club_gallery where organisation_id = $1 and id = any($2::uuid[])', [orgId, ids]);
    await pool.query(`update club_gallery g set position = s.rn from (select id, row_number() over (order by position, created_at) - 1 as rn
      from club_gallery where organisation_id = $1) s where g.id = s.id`, [orgId]);
  },

  async caption(actor, orgId, id, caption) {
    await assertRole(actor, orgId, TEACH);
    await pool.query('update club_gallery set caption = $3 where id = $1 and organisation_id = $2',
      [id, orgId, String(caption ?? '').trim().slice(0, 160) || null]);
  },

  /** direction -1 = earlier, +1 = later. Swaps with its neighbour in the same year and event. */
  async move(actor, orgId, id, direction) {
    await assertRole(actor, orgId, TEACH);
    const me = await one('select year, event_id from club_gallery where id = $1 and organisation_id = $2', [id, orgId]);
    if (!me) return;
    const rows = await q(`select id, position from club_gallery where organisation_id = $1
      and year is not distinct from $2 and event_id is not distinct from $3 order by position, created_at`, [orgId, me.year, me.event_id]);
    const i = rows.findIndex((r) => r.id === id), j = i + (direction < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= rows.length) return;
    // Give the group a clean run of positions, then swap the two.
    const order = rows.map((r) => r.id);
    [order[i], order[j]] = [order[j], order[i]];
    const base = Math.min(...rows.map((r) => r.position));
    for (let k = 0; k < order.length; k++)
      await pool.query('update club_gallery set position = $2 where id = $1', [order[k], base + k]);
  },
};

// ---------------------------------------------------------------------------
// A person's photograph: one picture on their record, used wherever they appear
// ---------------------------------------------------------------------------

export const photos = {
  /** Who may change a photograph: the person, a guardian, or an official of their club who keeps the register. */
  async assertMay(actor, personId) {
    if (await family.mayActFor(actor, personId)) return;
    const homes = await q('select organisation_id from affiliation where person_id = $1 and ends is null', [personId]);
    for (const h of homes)
      if ((await one('select has_role_at($1,$2,$3) as ok', [actor, h.organisation_id, REGISTER]))?.ok) return;
    throw new Forbidden();
  },

  /**
   * Set or replace somebody's photograph. The person, a guardian, or an official of their club may do it
   * (the same people who may edit the record), and somebody has to say the photograph may be kept: for a
   * child that is a parent's yes, so it is asked every time rather than assumed.
   */
  async set(actor, personId, { bytes, identified, filename }, { consent } = {}) {
    await this.assertMay(actor, personId);
    if (!consent) throw new Invalid('Please confirm that the person (or their parent or guardian) agrees to this photograph being kept.');
    const home = await one(`select organisation_id from affiliation where person_id = $1 and ends is null
      order by (role = 'member') desc limit 1`, [personId]);
    if (!home) throw new NotFound('Person has no current affiliation');
    const who = await one(`select first_name || ' ' || last_name as name from person where id = $1`, [personId]);
    const asset = await insertAsset(actor, home.organisation_id, { bytes, identified, filename,
      altText: `Photograph of ${who.name}`, consentRef: `Agreed to by the person or their guardian, recorded ${new Date().toISOString().slice(0, 10)}` });
    await pool.query('update person set photo_asset_id = $2, updated_at = now() where id = $1', [personId, asset.id]);
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
      values ($1,$2,'person_photo_set','person',$3,$4)`, [actor, home.organisation_id, personId, JSON.stringify({ assetId: asset.id })]);
    return asset;
  },

  async clear(actor, personId) {
    await this.assertMay(actor, personId);
    await pool.query('update person set photo_asset_id = null, updated_at = now() where id = $1', [personId]);
    await pool.query(`insert into audit_log (account_id, action, entity, entity_id) values ($1,'person_photo_cleared','person',$2)`, [actor, personId]);
  },

  async forPerson(personId) {
    return (await one('select photo_asset_id from person where id = $1', [personId]))?.photo_asset_id ?? null;
  },
};

// ---------------------------------------------------------------------------
// The instructor switch
// ---------------------------------------------------------------------------

export const instructorRole = {
  /** Is this person recorded as an instructor right now? */
  async is(personId) {
    return !!(await one(`select 1 as x from affiliation where person_id = $1 and ends is null
      and role = 'instructor' and status = 'active'`, [personId]));
  },

  /**
   * Tick or untick "is an instructor" for somebody. Done at their own club by an owner or administrator
   * there, or by one above (a region or the federation): has_role_at reaches down the tree.
   * Unticking ends the role today and keeps the history; it also takes them off the public website,
   * because a profile for someone who no longer instructs would be a claim nobody is making.
   */
  async set(actor, personId, on) {
    const home = await one(`select organisation_id from affiliation where person_id = $1 and ends is null
      order by (role = 'member') desc limit 1`, [personId]);
    if (!home) throw new NotFound('Person has no current affiliation');
    await assertRole(actor, home.organisation_id, MANAGE);
    const club = home.organisation_id;
    const now = await is_(personId);
    if (on && !now) {
      await pool.query(`insert into affiliation (person_id, organisation_id, role, starts, status)
        values ($1,$2,'instructor', current_date, 'active')`, [personId, club]);
    } else if (!on && now) {
      await pool.query(`update affiliation set ends = current_date, status = 'resigned'
        where person_id = $1 and role = 'instructor' and ends is null`, [personId]);
      await pool.query('update instructor_profile set published = false where person_id = $1', [personId]);
    } else return { changed: false };
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
      values ($1,$2,$3,'person',$4,$5)`, [actor, club, on ? 'instructor_on' : 'instructor_off', personId, JSON.stringify({ instructor: !!on })]);
    return { changed: true };
  },
};
const is_ = (personId) => instructorRole.is(personId);

photos.bytes = async function bytes(actor, personId) {
  const asset = await one('select photo_asset_id from person where id = $1', [personId]);
  if (!asset?.photo_asset_id) throw new NotFound('Photograph');
  let allowed = false;
  try { await family.assertMayActFor(actor, personId); allowed = true; } catch { /* maybe an official */ }
  if (!allowed) {
    const homes = await q('select organisation_id from affiliation where person_id = $1 and ends is null', [personId]);
    for (const h of homes) if ((await one('select has_role_at($1,$2,$3) as ok', [actor, h.organisation_id, TEACH]))?.ok) { allowed = true; break; }
  }
  if (!allowed) throw new Forbidden();
  const a = await one('select mime from asset where id = $1', [asset.photo_asset_id]);
  const b = await one('select bytes from asset_blob where asset_id = $1', [asset.photo_asset_id]);
  if (!b?.bytes) throw new NotFound('Photograph');
  return { mime: a.mime, bytes: b.bytes };
};

// ---------------------------------------------------------------------------
// forms and consent
// ---------------------------------------------------------------------------

import { cleanField, problemsWithForm, problemsWithPublishing, readAnswers, standingOn, expiryFor, appliesTo,
         isMinor as isMinorOn, problemsWithSignature, STARTERS as FORM_STARTERS } from '../core/domain/forms.mjs';

const FORM_COLS = `f.id, f.organisation_id, f.title, f.kind, f.intro, f.fields, f.audience, f.renew_months, f.status, f.version,
  f.created_at, f.updated_at, f.published_at, o.name as org_name, o.slug as org_slug, o.type as org_type, o.timezone`;
const formAudit = (actor, orgId, action, formId, after = {}) => pool.query(
  `insert into audit_log (account_id, organisation_id, action, entity, entity_id, after) values ($1,$2,$3,'club_form',$4,$5)`,
  [actor, orgId, action, formId, JSON.stringify(after)]);
const todayFor = async (orgId) => qualToday(orgId);

export const forms = {
  STARTERS: FORM_STARTERS,

  async find(formId) {
    return one(`select ${FORM_COLS} from club_form f join organisation o on o.id = f.organisation_id where f.id = $1`, [formId]);
  },

  /** For officials: any form here (they may read; MANAGE edits). A form from somewhere else is "not found". */
  async get(actor, orgId, formId, { edit = false } = {}) {
    await assertRole(actor, orgId, edit ? MANAGE : REGISTER);
    const f = await this.find(formId);
    if (!f || f.organisation_id !== orgId) throw new NotFound('Form');
    return f;
  },

  async list(actor, orgId) {
    await assertRole(actor, orgId, REGISTER);
    const rows = await q(`select ${FORM_COLS},
        (select count(distinct r.person_id)::int from form_response r where r.form_id = f.id and r.form_version = f.version and r.withdrawn_at is null) as signed
      from club_form f join organisation o on o.id = f.organisation_id
      where f.organisation_id = $1 and f.status <> 'archived' order by f.created_at desc`, [orgId]);
    // Forms from above (the federation's) that apply here, for information.
    const inherited = await q(`select ${FORM_COLS} from club_form f join organisation o on o.id = f.organisation_id
      join organisation me on me.id = $1 and me.path <@ o.path and o.id <> me.id
      where f.status = 'published' order by f.title`, [orgId]);
    return { rows, inherited };
  },

  async create(actor, orgId, { starter = null, title = '', kind = 'other' } = {}) {
    await assertRole(actor, orgId, MANAGE);
    const t = starter ? FORM_STARTERS[starter] : null;
    if (starter && !t) throw new Invalid('Choose one of the starting forms.');
    const gen = (() => { let n = 0; return () => `q${++n}`; })();
    const fields = t ? t.fields.map((f) => cleanField(f, gen)) : [];
    const data = { title: String(t?.title ?? title).trim(), kind: t?.kind ?? kind, audience: t?.audience ?? 'all',
                   renewMonths: t?.renewMonths ?? null, fields };
    const problems = problemsWithForm(data);
    if (problems.length) throw new Invalid(problems.join(' '));
    const row = await one(`insert into club_form (organisation_id, title, kind, intro, fields, audience, renew_months, created_by)
      values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8) returning id`,
      [orgId, data.title, data.kind, t?.intro ?? null, JSON.stringify(fields), data.audience, data.renewMonths, actor]);
    await formAudit(actor, orgId, 'form_create', row.id, { title: data.title, starter });
    return row.id;
  },

  async save(actor, orgId, formId, { title, kind, intro, audience, renewMonths }) {
    const f = await this.get(actor, orgId, formId, { edit: true });
    const data = { title: String(title ?? '').trim(), kind, audience, fields: f.fields,
      renewMonths: renewMonths === '' || renewMonths == null ? null : Number(renewMonths) };
    const problems = problemsWithForm(data);
    if (problems.length) throw new Invalid(problems.join(' '));
    await pool.query(`update club_form set title=$2, kind=$3, intro=$4, audience=$5, renew_months=$6, updated_at=now() where id=$1`,
      [formId, data.title, kind, String(intro ?? '').replace(/\r\n/g, '\n').trim().slice(0, 3000) || null, audience, data.renewMonths]);
    await formAudit(actor, orgId, 'form_save', formId, { title: data.title });
  },

  async _writeFields(formId, fields) {
    await pool.query('update club_form set fields=$2::jsonb, updated_at=now() where id=$1', [formId, JSON.stringify(fields)]);
  },

  async addField(actor, orgId, formId, raw) {
    const f = await this.get(actor, orgId, formId, { edit: true });
    const field = cleanField(raw);
    if (!field) throw new Invalid('Write the question first.');
    const fields = [...f.fields, field];
    const problems = problemsWithForm({ title: f.title, kind: f.kind, audience: f.audience, fields });
    if (problems.length) throw new Invalid(problems.join(' '));
    await this._writeFields(formId, fields);
    return field;
  },

  async updateField(actor, orgId, formId, fieldId, raw) {
    const f = await this.get(actor, orgId, formId, { edit: true });
    const at = f.fields.findIndex((x) => x.id === fieldId);
    if (at < 0) throw new NotFound('Question');
    const field = cleanField({ ...raw, id: fieldId });
    if (!field) throw new Invalid('A question needs some wording.');
    const fields = f.fields.map((x, i) => (i === at ? field : x));
    const problems = problemsWithForm({ title: f.title, kind: f.kind, audience: f.audience, fields });
    if (problems.length) throw new Invalid(problems.join(' '));
    await this._writeFields(formId, fields);
  },

  async removeField(actor, orgId, formId, fieldId) {
    const f = await this.get(actor, orgId, formId, { edit: true });
    await this._writeFields(formId, f.fields.filter((x) => x.id !== fieldId));
  },

  async moveField(actor, orgId, formId, fieldId, delta) {
    const f = await this.get(actor, orgId, formId, { edit: true });
    const i = f.fields.findIndex((x) => x.id === fieldId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= f.fields.length) return;
    const fields = [...f.fields];
    [fields[i], fields[j]] = [fields[j], fields[i]];
    await this._writeFields(formId, fields);
  },

  async setStatus(actor, orgId, formId, status) {
    const f = await this.get(actor, orgId, formId, { edit: true });
    if (status === 'published') {
      const problems = problemsWithPublishing({ title: f.title, kind: f.kind, audience: f.audience, renewMonths: f.renew_months, fields: f.fields });
      if (problems.length) throw new Invalid(problems.join(' '));
    }
    await pool.query(`update club_form set status=$2, updated_at=now(), published_at = case when $2 = 'published' then coalesce(published_at, now()) else published_at end where id=$1`, [formId, status]);
    await formAudit(actor, orgId, `form_${status}`, formId, { title: f.title });
  },

  /** Make everybody sign again: the form has changed in a way that matters. Earlier answers are kept as history. */
  async askAgain(actor, orgId, formId) {
    const f = await this.get(actor, orgId, formId, { edit: true });
    await pool.query('update club_form set version = version + 1, updated_at=now() where id=$1', [formId]);
    await formAudit(actor, orgId, 'form_ask_again', formId, { title: f.title, version: f.version + 1 });
  },

  /** Everyone this form is asked of beneath its organisation, and where they stand. */
  async report(actor, orgId, formId) {
    const f = await this.get(actor, orgId, formId);
    const day = await todayFor(orgId);
    const people = await q(`select distinct on (p.id) p.id as person_id, p.display_number, p.first_name, p.last_name, p.date_of_birth::text as dob, o.name as dojo
      from organisation fo join organisation o on o.path <@ fo.path
      join affiliation a on a.organisation_id = o.id and a.role = 'member' and a.ends is null and a.status in ('active','trial')
      join person p on p.id = a.person_id where fo.id = $1 order by p.id`, [orgId]);
    const latest = new Map((await q(`select distinct on (person_id) id, person_id, form_version, signed_name, signed_for_minor, answered_at, expires_on::text as expires_on, withdrawn_at, answers
      from form_response where form_id = $1 order by person_id, answered_at desc`, [formId])).map((r) => [r.person_id, r]));
    const rows = people.filter((p) => appliesTo(f, { dob: p.dob }, day)).map((p) => {
      const r = latest.get(p.person_id) ?? null;
      return { ...p, standing: standingOn(f, r, day), response: r };
    }).sort((a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name));
    const count = (s) => rows.filter((r) => r.standing === s).length;
    return { form: f, rows, counts: { current: count('current'), missing: count('missing'), expired: count('expired'), total: rows.length } };
  },

  /** One person's answers to one form. Medical answers go only to those who run the dojo or teach there. */
  async answers(actor, orgId, formId, personId) {
    const f = await this.get(actor, orgId, formId);
    const r = await one(`select * from form_response where form_id = $1 and person_id = $2 order by answered_at desc limit 1`, [formId, personId]);
    if (!r) return { form: f, response: null };
    if (f.kind === 'medical') {
      let ok = false;
      for (const h of await homesOf(personId)) if ((await one('select has_role_at($1,$2,$3) as ok', [actor, h, TEACH]))?.ok) { ok = true; break; }
      if (!ok) throw new Forbidden();
    }
    return { form: f, response: r };
  },

  // ---- the person's side --------------------------------------------------

  /** Published forms that apply to this person through where they train, with where they stand on each. */
  async _applicable(personId) {
    const person = await one(`select p.id, p.first_name, p.last_name, p.date_of_birth::text as dob from person p where p.id = $1`, [personId]);
    if (!person) throw new NotFound('Person');
    const rows = await q(`select distinct on (f.id) ${FORM_COLS} from club_form f join organisation o on o.id = f.organisation_id
      where f.status = 'published' and exists (select 1 from affiliation a join organisation x on x.id = a.organisation_id
        where a.person_id = $1 and a.role = 'member' and a.ends is null and a.status in ('active','trial') and x.path <@ o.path)
      order by f.id`, [personId]);
    const home = (await homesOf(personId))[0];
    const day = home ? await todayFor(home) : new Date().toISOString().slice(0, 10);
    const latest = new Map((await q(`select distinct on (form_id) form_id, form_version, expires_on::text as expires_on, withdrawn_at, answered_at, signed_name
      from form_response where person_id = $1 order by form_id, answered_at desc`, [personId])).map((r) => [r.form_id, r]));
    const items = rows.filter((f) => appliesTo(f, { dob: person.dob }, day))
      .map((f) => ({ form: f, standing: standingOn(f, latest.get(f.id) ?? null, day), last: latest.get(f.id) ?? null }));
    return { person, items, day };
  },

  async forPerson(actor, personId) {
    const how = await family.assertMayActFor(actor, personId);
    const { person, items, day } = await this._applicable(personId);
    return { how, person, minor: isMinorOn(person.dob, day),
      todo: items.filter((i) => i.standing !== 'current').sort((a, b) => a.form.title.localeCompare(b.form.title)),
      done: items.filter((i) => i.standing === 'current').sort((a, b) => a.form.title.localeCompare(b.form.title)) };
  },

  async open(actor, personId, formId) {
    const how = await family.assertMayActFor(actor, personId);
    const { person, items, day } = await this._applicable(personId);
    const item = items.find((i) => i.form.id === formId);
    if (!item) throw new NotFound('Form');
    return { how, person, item, minor: isMinorOn(person.dob, day), day };
  },

  async submit(actor, personId, formId, raw, { signedName, ip = null } = {}) {
    const { how, person, item, minor, day } = await this.open(actor, personId, formId);
    if (minor && how === 'self') throw new Invalid('A parent or guardian answers this for anyone under 18. Ask them to sign in and do it.');
    const { answers, problems } = readAnswers(item.form.fields, raw);
    const sig = problemsWithSignature(signedName);
    if (problems.length || sig.length) throw new Invalid([...problems, ...sig].join(' '));
    const row = await one(`insert into form_response (form_id, form_version, person_id, answers, signed_name, signed_by, signed_for_minor, signed_ip, expires_on)
      values ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9) returning id`,
      [formId, item.form.version, personId, JSON.stringify(answers), String(signedName).trim().slice(0, 120), actor, minor, ip, expiryFor(item.form, day)]);
    await formAudit(actor, item.form.organisation_id, 'form_signed', formId, { personId, version: item.form.version });
    await webhooks.emitNow(item.form.organisation_id, 'form.signed', { form_id: formId, title: item.form.title, person_id: personId, version: item.form.version });
    return { id: row.id, form: item.form, person };
  },

  /** For the dashboard's "Action required". */
  async dueFor(personId) {
    const { person, items } = await this._applicable(personId);
    return items.filter((i) => i.standing !== 'current').map((i) => ({ id: i.form.id, title: i.form.title, first: person.first_name, personId, expired: i.standing === 'expired' }));
  },
};

// ---------------------------------------------------------------------------
// booking a place in a class, with a waiting list
// ---------------------------------------------------------------------------

import { mayAttend } from '../core/domain/portal.mjs';
import { bookableDates, placeFor, problemWithBooking, placesFree, nextInQueue, queuePosition, readCapacity, BOOK_DAYS_AHEAD }
  from '../core/domain/booking.mjs';

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

// ---------------------------------------------------------------------------
// push notifications
// ---------------------------------------------------------------------------

import { pushFromEnv } from '../infrastructure/push/webpush.mjs';

const MAX_DEVICES = 10;
const problemsWithSubscription = (s) => {
  const out = [];
  let url; try { url = new URL(String(s?.endpoint ?? '')); } catch { out.push('That device did not give a usable address.'); }
  if (url && url.protocol !== 'https:') out.push('That device did not give a usable address.');
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(String(s?.p256dh ?? ''))) out.push('That device did not give a usable key.');
  if (!/^[A-Za-z0-9_-]{16,32}$/.test(String(s?.auth ?? ''))) out.push('That device did not give a usable key.');
  if (String(s?.endpoint ?? '').length > 1000) out.push('That device address is too long.');
  return out;
};

export const push = {
  /** Which provider sends: from the environment unless one is handed in (tests). null means push is off. */
  provider: () => pushFromEnv(),

  async status(actor) {
    const p = this.provider();
    const mine = await q('select id, user_agent, created_at from push_subscription where account_id=$1 order by created_at desc', [actor]);
    return { available: !!p, publicKey: p?.publicKey ?? null, devices: mine };
  },

  async subscribe(actor, sub, userAgent = null) {
    if (!this.provider()) throw new Invalid('Notifications are not switched on for this site yet.');
    const problems = problemsWithSubscription(sub);
    if (problems.length) throw new Invalid([...new Set(problems)].join(' '));
    // The same device signing in as somebody else takes the subscription with it.
    await pool.query(`insert into push_subscription (account_id, endpoint, p256dh, auth, user_agent) values ($1,$2,$3,$4,$5)
      on conflict (endpoint) do update set account_id=$1, p256dh=$3, auth=$4, user_agent=$5, failures=0`,
      [actor, sub.endpoint, sub.p256dh, sub.auth, String(userAgent ?? '').slice(0, 200) || null]);
    await pool.query(`delete from push_subscription where id in (select id from push_subscription where account_id=$1 order by created_at desc offset $2)`, [actor, MAX_DEVICES]);
  },

  async unsubscribe(actor, endpoint) {
    await pool.query('delete from push_subscription where account_id=$1 and endpoint=$2', [actor, String(endpoint ?? '')]);
  },

  async removeDevice(actor, id) {
    const r = await pool.query('delete from push_subscription where account_id=$1 and id=$2', [actor, id]);
    if (!r.rowCount) throw new NotFound('Device');
  },

  /**
   * Tell a person (and, for a child, their parents) something short. Best effort and never an error to the caller:
   * a dead device is forgotten, a slow one is skipped. Returns how many devices were reached.
   */
  async toPerson(personId, message, provider = this.provider()) {
    if (!provider) return 0;
    const subs = await q(`select s.id, s.endpoint, s.p256dh, s.auth from push_subscription s join account a on a.id = s.account_id
      where a.person_id = $1 or a.person_id in (select guardian_id from guardian_link where child_id = $1 and ended_on is null)`, [personId]);
    let reached = 0;
    for (const s of subs) {
      let r; try { r = await provider.send(s, message); } catch { r = 'failed'; }
      if (r === 'sent') { reached++; await pool.query('update push_subscription set last_sent_at=now(), failures=0 where id=$1', [s.id]); }
      else if (r === 'gone') await pool.query('delete from push_subscription where id=$1', [s.id]);
      else await pool.query('update push_subscription set failures = failures + 1 where id=$1', [s.id]);
    }
    return reached;
  },
};

// ---------------------------------------------------------------------------
// API tokens and webhooks
// ---------------------------------------------------------------------------

import dns from 'node:dns/promises';
import { SCOPES as API_SCOPES, EVENTS as WEBHOOK_EVENTS, MAX_TOKENS, MAX_WEBHOOKS, MAX_ATTEMPTS, retryAt, problemsWithToken, problemsWithWebhook,
         isPrivateAddress, DISABLE_AFTER_FAILED_DELIVERIES, pageSize } from '../core/domain/integrations.mjs';

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

export const apiTokens = {
  SCOPES: API_SCOPES,

  async list(actor, orgId) {
    await assertRole(actor, orgId, MANAGE);
    return q(`select id, name, prefix, scopes, created_at, last_used_at, revoked_at from api_token where organisation_id = $1 order by revoked_at nulls first, created_at desc`, [orgId]);
  },

  /** The token itself is returned once, here, and never stored. */
  async create(actor, orgId, { name, scopes }) {
    await assertRole(actor, orgId, MANAGE);
    const problems = problemsWithToken({ name, scopes });
    if (problems.length) throw new Invalid(problems.join(' '));
    if ((await one(`select count(*)::int n from api_token where organisation_id=$1 and revoked_at is null`, [orgId])).n >= MAX_TOKENS)
      throw new Invalid(`There are already ${MAX_TOKENS} tokens. Revoke one you no longer use.`);
    const token = `hb_${crypto.randomBytes(24).toString('base64url')}`;
    const row = await one(`insert into api_token (organisation_id, name, prefix, token_hash, scopes, created_by) values ($1,$2,$3,$4,$5,$6) returning id`,
      [orgId, String(name).trim().slice(0, 80), token.slice(0, 9), sha256(token), scopes, actor]);
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after) values ($1,$2,'api_token_create','api_token',$3,$4)`,
      [actor, orgId, row.id, JSON.stringify({ name, scopes })]);
    return { id: row.id, token };
  },

  async revoke(actor, orgId, tokenId) {
    await assertRole(actor, orgId, MANAGE);
    const row = await one(`update api_token set revoked_at = now() where id=$1 and organisation_id=$2 and revoked_at is null returning id`, [tokenId, orgId]);
    if (!row) throw new NotFound('Token');
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after) values ($1,$2,'api_token_revoke','api_token',$3,'{}')`, [actor, orgId, tokenId]);
  },

  /** A bearer string → who it speaks for, or null. */
  async authenticate(bearer) {
    const t = String(bearer ?? '').trim();
    if (!/^hb_[A-Za-z0-9_-]{32}$/.test(t)) return null;
    const row = await one(`select id, organisation_id, scopes, last_used_at from api_token where token_hash = $1 and revoked_at is null`, [sha256(t)]);
    if (!row) return null;
    if (!row.last_used_at || Date.now() - new Date(row.last_used_at).getTime() > 60_000) await pool.query('update api_token set last_used_at = now() where id=$1', [row.id]);
    return { tokenId: row.id, orgId: row.organisation_id, scopes: row.scopes };
  },
};

/** What the API shows. Deliberately small: no dates of birth, contact details, medical or payment information. */
export const api = {
  async organisations(auth) {
    return q(`select o.id, o.slug, o.name, o.type, p.slug as parent_slug from organisation o join organisation me on me.id = $1 and o.path <@ me.path
      left join organisation p on p.id = o.parent_id where o.status = 'active' order by o.path`, [auth.orgId]);
  },
  async members(auth, { limit, after }) {
    const n = pageSize(limit);
    const rows = await q(`select p.id, p.display_number as number, p.first_name, p.last_name, o.slug as dojo, a.role, a.status, a.paid_until::text as paid_until,
        a.starts::text as joined, g.label as grade
      from affiliation a join organisation o on o.id = a.organisation_id join organisation me on me.id = $1 and o.path <@ me.path
      join person p on p.id = a.person_id left join person_current_grade g on g.person_id = p.id
      where a.ends is null and a.role in ('member','instructor','assistant') and ($3::uuid is null or p.id > $3::uuid)
      order by p.id limit $2`, [auth.orgId, n + 1, UUID_OK.test(String(after ?? '')) ? after : null]);
    return { data: rows.slice(0, n), next: rows.length > n ? rows[n - 1].id : null };
  },
  async events(auth, { limit, after }) {
    const n = pageSize(limit);
    const rows = await q(`select e.id, e.slug, e.title, e.kind, e.starts_at, e.ends_at, e.status, e.venue_name, o.slug as organisation
      from event e join organisation o on o.id = e.organisation_id join organisation me on me.id = $1 and o.path <@ me.path
      where ($3::uuid is null or e.id > $3::uuid) order by e.id limit $2`, [auth.orgId, n + 1, UUID_OK.test(String(after ?? '')) ? after : null]);
    return { data: rows.slice(0, n), next: rows.length > n ? rows[n - 1].id : null };
  },
};
const UUID_OK = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const webhooks = {
  EVENTS: WEBHOOK_EVENTS,

  async list(actor, orgId) {
    await assertRole(actor, orgId, MANAGE);
    const endpoints = await q(`select id, url, events, active, disabled_at, disabled_reason, consecutive_failures, created_at from webhook_endpoint where organisation_id=$1 order by created_at desc`, [orgId]);
    const recent = await q(`select d.id, d.endpoint_id, d.event, d.status, d.attempts, d.last_status, d.last_error, d.created_at, d.delivered_at, d.next_attempt_at
      from webhook_delivery d join webhook_endpoint e on e.id = d.endpoint_id where e.organisation_id=$1 order by d.created_at desc limit 20`, [orgId]);
    return { endpoints, recent };
  },

  /** The secret is returned once, here. */
  async create(actor, orgId, { url, events }) {
    await assertRole(actor, orgId, MANAGE);
    const problems = problemsWithWebhook({ url, events });
    if (problems.length) throw new Invalid(problems.join(' '));
    if ((await one('select count(*)::int n from webhook_endpoint where organisation_id=$1', [orgId])).n >= MAX_WEBHOOKS)
      throw new Invalid(`There are already ${MAX_WEBHOOKS} webhooks. Remove one you no longer use.`);
    const secret = `whsec_${crypto.randomBytes(24).toString('base64url')}`;
    const row = await one(`insert into webhook_endpoint (organisation_id, url, secret, events, created_by) values ($1,$2,$3,$4,$5) returning id`,
      [orgId, String(url).trim(), secret, events, actor]);
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after) values ($1,$2,'webhook_create','webhook_endpoint',$3,$4)`,
      [actor, orgId, row.id, JSON.stringify({ url, events })]);
    return { id: row.id, secret };
  },

  async setActive(actor, orgId, id, active) {
    await assertRole(actor, orgId, MANAGE);
    const row = await one(`update webhook_endpoint set active=$3, disabled_at = null, disabled_reason = null, consecutive_failures = 0 where id=$1 and organisation_id=$2 returning id`, [id, orgId, !!active]);
    if (!row) throw new NotFound('Webhook');
  },

  async remove(actor, orgId, id) {
    await assertRole(actor, orgId, MANAGE);
    const row = await one('delete from webhook_endpoint where id=$1 and organisation_id=$2 returning id', [id, orgId]);
    if (!row) throw new NotFound('Webhook');
  },

  /**
   * Something happened at `orgId`. Every endpoint at that organisation or above it that asked for this event gets a
   * delivery queued. Never throws: whatever happened has happened, and telling others is best effort.
   */
  async emit(orgId, event, data, { only = null } = {}) {
    try {
      const org = await one('select id, slug, name from organisation where id=$1', [orgId]);
      if (!org) return [];
      const endpoints = await q(`select e.id from webhook_endpoint e join organisation o on o.id = e.organisation_id
        join organisation at on at.id = $1 and at.path <@ o.path
        where e.active and e.disabled_at is null and $2 = any(e.events) and ($3::uuid is null or e.id = $3::uuid)`, [orgId, event, only]);
      const ids = [];
      for (const e of endpoints) {
        const id = crypto.randomUUID();
        const payload = { id, event, created: new Date().toISOString(), organisation: { id: org.id, slug: org.slug, name: org.name }, data };
        await pool.query(`insert into webhook_delivery (id, endpoint_id, event, payload) values ($1,$2,$3,$4::jsonb)`, [id, e.id, event, JSON.stringify(payload)]);
        ids.push(id);
      }
      return ids;
    } catch { return []; }
  },

  /** Emit, and try to deliver straight away (briefly). Anything that does not go through is retried by the daily run. */
  async emitNow(orgId, event, data) {
    const ids = await this.emit(orgId, event, data);
    if (ids.length) await this.run({ ids, budgetMs: 3000 }).catch(() => {});
    return ids.length;
  },

  async sendTest(actor, orgId, id, deps = {}) {
    await assertRole(actor, orgId, MANAGE);
    const e = await one('select id from webhook_endpoint where id=$1 and organisation_id=$2', [id, orgId]);
    if (!e) throw new NotFound('Webhook');
    const ids = await this.emit(orgId, 'ping', { message: 'This is a test from Honbu.' }, { only: id });
    // A test is sent even if the endpoint did not ask for "ping".
    if (!ids.length) {
      const org = await one('select id, slug, name from organisation where id=$1', [orgId]);
      const did = crypto.randomUUID();
      await pool.query(`insert into webhook_delivery (id, endpoint_id, event, payload) values ($1,$2,'ping',$3::jsonb)`,
        [did, id, JSON.stringify({ id: did, event: 'ping', created: new Date().toISOString(), organisation: org, data: { message: 'This is a test from Honbu.' } })]);
      ids.push(did);
    }
    await this.run({ ids, budgetMs: 8000, ...deps });
    return one('select status, last_status, last_error from webhook_delivery where id=$1', [ids[0]]);
  },

  /** Deliver what is due (or just these). Each delivery is claimed first so two runs never send the same one twice. */
  async run({ ids = null, budgetMs = 9000, fetchFn = fetch, lookup = (h) => dns.lookup(h, { all: true }) } = {}) {
    const started = Date.now();
    const report = { delivered: 0, retrying: 0, failed: 0 };
    while (Date.now() - started < budgetMs) {
      const due = await q(`update webhook_delivery set next_attempt_at = now() + interval '2 minutes'
        where id in (select id from webhook_delivery where status='pending' and next_attempt_at <= now() and ($1::uuid[] is null or id = any($1::uuid[]))
          order by next_attempt_at limit 10 for update skip locked) returning id, endpoint_id, event, payload, attempts`, [ids]);
      if (!due.length) break;
      for (const d of due) {
        const e = await one('select id, url, secret, active, disabled_at from webhook_endpoint where id=$1', [d.endpoint_id]);
        const attempts = d.attempts + 1;
        let status = null, error = null, ok = false, permanent = false;
        if (!e || !e.active || e.disabled_at) { error = 'The webhook is switched off.'; permanent = true; }
        else {
          try {
            const host = new URL(e.url).hostname.replace(/^\[|\]$/g, '');
            const addrs = /^[\d.]+$|:/.test(host) ? [{ address: host }] : await lookup(host);
            if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) { error = 'The address is not on the public internet.'; permanent = true; }
            else {
              const body = JSON.stringify(d.payload), t = Math.floor(Date.now() / 1000);
              const sig = crypto.createHmac('sha256', e.secret).update(`${t}.${body}`).digest('hex');
              const res = await fetchFn(e.url, { method: 'POST', body, redirect: 'manual', signal: AbortSignal.timeout(8000), headers: {
                'content-type': 'application/json', 'user-agent': 'Honbu-Webhooks/1', 'x-honbu-event': d.event, 'x-honbu-delivery': d.payload.id,
                'x-honbu-signature': `t=${t},v1=${sig}` } });
              status = res.status; ok = res.status >= 200 && res.status < 300;
              if (!ok) error = `The receiver answered ${res.status}.`;
            }
          } catch (err) { error = `Could not reach the receiver (${String(err.cause?.code ?? err.name ?? 'error').slice(0, 40)}).`; }
        }
        if (ok) {
          await pool.query(`update webhook_delivery set status='delivered', attempts=$2, last_status=$3, last_error=null, delivered_at=now(), next_attempt_at=null where id=$1`, [d.id, attempts, status]);
          await pool.query('update webhook_endpoint set consecutive_failures = 0 where id=$1', [d.endpoint_id]);
          report.delivered++;
        } else {
          const next = permanent ? null : retryAt(attempts);
          await pool.query(`update webhook_delivery set status=$2, attempts=$3, last_status=$4, last_error=$5, next_attempt_at=$6 where id=$1`,
            [d.id, next ? 'pending' : 'failed', attempts, status, error, next]);
          if (next) report.retrying++; else report.failed++;
          if (e) {
            const f = await one('update webhook_endpoint set consecutive_failures = consecutive_failures + 1 where id=$1 returning consecutive_failures', [e.id]);
            if (f.consecutive_failures >= DISABLE_AFTER_FAILED_DELIVERIES)
              await pool.query(`update webhook_endpoint set active=false, disabled_at=now(), disabled_reason='Switched off after too many failed deliveries.' where id=$1`, [e.id]);
          }
        }
      }
      if (ids) break;
    }
    // Keep the log short: delivered or failed history is kept for 30 days.
    if (!ids) await pool.query(`delete from webhook_delivery where status <> 'pending' and created_at < now() - interval '30 days'`);
    return report;
  },
};

// ---------------------------------------------------------------------------
// the platform: how this installation is doing, for the federation's owner
// ---------------------------------------------------------------------------

export const platform = {
  /** Only the owner of the federation at the top of this installation. */
  async overview(actor, { env = process.env, provider = null, pushOn = false } = {}) {
    const root = await one(`select id, slug, name from organisation where parent_id is null order by created_at limit 1`);
    if (!root) throw new NotFound('Federation');
    await assertRole(actor, root.id, ['owner']);
    const count = async (sql, a = []) => (await one(sql, a)).n;
    const orgs = await q(`select type, count(*)::int n from organisation where status='active' group by type order by type`);
    const members = await q(`select status, count(*)::int n from affiliation where ends is null and role in ('member','instructor','assistant') group by status order by status`);
    const stats = {
      people: await count('select count(*)::int n from person'),
      accounts: await count('select count(*)::int n from account'),
      upcomingEvents: await count(`select count(*)::int n from event where starts_at > now()`),
      formsPublished: await count(`select count(*)::int n from club_form where status='published'`),
      autoRenewing: await count(`select count(*)::int n from payment_agreement where status='active'`),
      autoRenewStopped: await count(`select count(*)::int n from payment_agreement where status='paused'`),
      bookingsAhead: await count(`select count(*)::int n from class_booking where status='booked' and session_date >= current_date`),
      pushDevices: await count('select count(*)::int n from push_subscription'),
      tokens: await count('select count(*)::int n from api_token where revoked_at is null'),
      webhooks: await count('select count(*)::int n from webhook_endpoint where active'),
      webhooksOff: await count('select count(*)::int n from webhook_endpoint where not active'),
      deliveriesFailed24h: await count(`select count(*)::int n from webhook_delivery where status='failed' and created_at > now() - interval '24 hours'`),
      deliveriesWaiting: await count(`select count(*)::int n from webhook_delivery where status='pending'`),
    };
    const recent = await q(`select l.at as created_at, l.action, o.name as organisation, nullif(a.email,'') as who
      from audit_log l left join organisation o on o.id = l.organisation_id left join account a on a.id = l.account_id order by l.at desc limit 15`);
    const check = (ok, good, bad) => ({ ok, text: ok ? good : bad });
    const health = [
      check(!!env.CRON_SECRET, 'The daily job is locked with a secret.', 'CRON_SECRET is not set, so the daily job (reminders, automatic renewals, webhook retries) cannot run.'),
      check(provider && provider.name !== 'test', 'Payments are live.', 'Payments are in test mode — no real money moves.'),
      check((env.MESSENGER_PROVIDER ?? 'none') !== 'none', 'Email is switched on.', 'Email is off, so messages and sign-in links are not sent.'),
      check(pushOn, 'Notifications are switched on.', 'Notifications are off (no VAPID keys set).'),
    ];
    return { root, orgs, members, stats, recent, health, store: env.HONBU_STORE ?? 'postgres' };
  },
};

// ---------------------------------------------------------------------------
// the shop: gear ordered from your own dojo
// ---------------------------------------------------------------------------

import { readBasket, readNote, mayMoveOrder, ORDER_STATUSES } from '../core/domain/shop.mjs';

/**
 * The range a dojo offers: its own products, plus those of every organisation above it (the national range),
 * less what the dojo has hidden, at the dojo's own price where it set one. This is the ONLY query that decides what
 * a member sees, so a tee shirt owned by one dojo can never reach another dojo's members.
 */
const RANGE = `
  select p.id, p.organisation_id, p.category, p.name, p.description, p.sizes, p.currency,
         p.price_cents as national_price_cents, coalesce(l.price_cents, p.price_cents) as price_cents,
         (p.organisation_id = club.id) as own
    from organisation club
    join organisation owner on club.path <@ owner.path
    join product p on p.organisation_id = owner.id
    left join product_listing l on l.product_id = p.id and l.organisation_id = club.id
   where club.id = $1 and p.active and not coalesce(l.hidden, false)
   order by (p.organisation_id = club.id), p.category, p.sort_order, p.name`;

const ORDERS = `
  select o.id, o.status, o.note, o.total_cents, o.currency, o.created_at, o.person_id,
         p.first_name, p.last_name,
         coalesce((select json_agg(json_build_object('name', l.name, 'size', l.size, 'quantity', l.quantity, 'unit_cents', l.unit_cents) order by l.name)
                     from shop_order_line l where l.order_id = o.id), '[]'::json) as lines
    from shop_order o join person p on p.id = o.person_id`;

const mayShopFor = (personId, clubId) => one(
  `select 1 x from affiliation where person_id=$1 and organisation_id=$2 and ends is null
     and role in ('member','instructor','assistant') and status in ('active','trial')`, [personId, clubId]);

export const shop = {
  ORDER_STATUSES,

  /** The member's side: for each dojo they belong to, what they may order and what they have ordered. */
  async forPerson(actor, personId) {
    await family.assertMayActFor(actor, personId);
    const person = await one('select id, first_name, last_name from person where id=$1', [personId]);
    if (!person) throw new NotFound('Person');
    const clubs = await q(`select o.id, o.name from affiliation a join organisation o on o.id = a.organisation_id
      where a.person_id=$1 and a.ends is null and a.role in ('member','instructor','assistant') and a.status in ('active','trial') and o.type='club' order by o.name`, [personId]);
    const out = [];
    for (const club of clubs) {
      out.push({ club, range: await q(RANGE, [club.id]),
        orders: await q(`${ORDERS} where o.person_id=$1 and o.organisation_id=$2 order by o.created_at desc limit 20`, [personId, club.id]) });
    }
    return { person, clubs: out };
  },

  /** Place an order. Prices, sizes and what is on offer are all decided here, from the dojo's range, never from the form. */
  async place(actor, personId, clubId, form) {
    await family.assertMayActFor(actor, personId);
    if (!await mayShopFor(personId, clubId)) throw new NotFound('Dojo');
    const range = await q(RANGE, [clubId]);
    const basket = readBasket(form ?? {}, range);
    if (basket.problem) throw new Invalid(basket.problem);
    const currency = range[0]?.currency ?? 'NZD';
    const client = await pool.connect();
    try {
      await client.query('begin');
      const o = (await client.query(
        `insert into shop_order (organisation_id, person_id, ordered_by, note, total_cents, currency) values ($1,$2,$3,$4,$5,$6) returning id`,
        [clubId, personId, actor, readNote(form?.note), basket.total_cents, currency])).rows[0];
      for (const l of basket.value)
        await client.query(`insert into shop_order_line (order_id, product_id, name, size, quantity, unit_cents) values ($1,$2,$3,$4,$5,$6)`,
          [o.id, l.product_id, l.name, l.size, l.quantity, l.unit_cents]);
      await client.query('commit');
      return { id: o.id, total_cents: basket.total_cents };
    } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
  },

  /** A member can take back an order the dojo has not yet touched. */
  async cancelMine(actor, personId, orderId) {
    await family.assertMayActFor(actor, personId);
    const r = await one(`update shop_order set status='cancelled', updated_at=now() where id=$1 and person_id=$2 and status='placed' returning id`, [orderId, personId]);
    if (!r) throw new Invalid('That order can no longer be cancelled here. Please ask the dojo.');
  },

  /** The dojo's (or the federation's) side. A dojo: orders, its own products, and the national range to hide or reprice. */
  async forOrg(actor, orgId) {
    const org = await one('select * from organisation where id=$1', [orgId]);
    if (!org) throw new NotFound('Organisation');
    const isClub = org.type === 'club';
    await assertRole(actor, orgId, isClub ? REGISTER : MANAGE);
    const own = await q(`select id, category, name, description, sizes, price_cents, currency, active from product where organisation_id=$1 order by active desc, category, sort_order, name`, [orgId]);
    if (!isClub) return { org, isClub, own, national: [], orders: [] };
    const national = await q(`select p.id, p.category, p.name, p.sizes, p.price_cents, p.currency, p.organisation_id,
        coalesce(l.hidden, false) as hidden, l.price_cents as own_price_cents
      from organisation club join organisation owner on club.path <@ owner.path and owner.id <> club.id
      join product p on p.organisation_id = owner.id and p.active
      left join product_listing l on l.product_id = p.id and l.organisation_id = club.id
      where club.id=$1 order by p.category, p.sort_order, p.name`, [orgId]);
    const orders = await q(`${ORDERS} where o.organisation_id=$1 order by (o.status in ('placed','paid','ready')) desc, o.created_at desc limit 200`, [orgId]);
    return { org, isClub, own, national, orders };
  },

  async saveProduct(actor, orgId, productId, v) {
    const org = await one('select type from organisation where id=$1', [orgId]);
    if (!org) throw new NotFound('Organisation');
    await assertRole(actor, orgId, org.type === 'club' ? REGISTER : MANAGE);
    if (productId) {
      const r = await one(`update product set name=$3, category=$4, description=$5, sizes=$6, price_cents=$7, updated_at=now()
        where id=$1 and organisation_id=$2 returning id`, [productId, orgId, v.name, v.category, v.description, v.sizes, v.price_cents]);
      if (!r) throw new NotFound('Item');
      return r.id;
    }
    return (await one(`insert into product (organisation_id, name, category, description, sizes, price_cents) values ($1,$2,$3,$4,$5,$6) returning id`,
      [orgId, v.name, v.category, v.description, v.sizes, v.price_cents])).id;
  },

  async setActive(actor, orgId, productId, active) {
    const org = await one('select type from organisation where id=$1', [orgId]);
    if (!org) throw new NotFound('Organisation');
    await assertRole(actor, orgId, org.type === 'club' ? REGISTER : MANAGE);
    const r = await one(`update product set active=$3, updated_at=now() where id=$1 and organisation_id=$2 returning id`, [productId, orgId, !!active]);
    if (!r) throw new NotFound('Item');
  },

  /** A dojo's say over a national item: hide it, or set its own price. Only for items owned above it. */
  async setListing(actor, clubId, productId, v) {
    await clubOnly(clubId);
    await assertRole(actor, clubId, REGISTER);
    const p = await one(`select p.id from product p join organisation owner on owner.id = p.organisation_id
      join organisation club on club.path <@ owner.path and club.id <> owner.id where p.id=$1 and club.id=$2`, [productId, clubId]);
    if (!p) throw new NotFound('Item');
    await pool.query(`insert into product_listing (product_id, organisation_id, hidden, price_cents) values ($1,$2,$3,$4)
      on conflict (product_id, organisation_id) do update set hidden=excluded.hidden, price_cents=excluded.price_cents`,
      [productId, clubId, !!v.hidden, v.price_cents]);
  },

  async setOrderStatus(actor, clubId, orderId, status) {
    await clubOnly(clubId);
    await assertRole(actor, clubId, REGISTER);
    const o = await one('select id, status from shop_order where id=$1 and organisation_id=$2', [orderId, clubId]);
    if (!o) throw new NotFound('Order');
    if (!Object.hasOwn(ORDER_STATUSES, status) || !mayMoveOrder(o.status, status)) throw new Invalid('That order cannot be moved there.');
    await pool.query(`update shop_order set status=$2, updated_at=now() where id=$1`, [orderId, status]);
  },
};
