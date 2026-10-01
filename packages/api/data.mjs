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
import { pool } from '../infrastructure/postgres/pool.mjs';
import { problemsWithPerson, problemsWithMembership }
  from '../core/domain/people.mjs';

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
             cg.label as grade, cg.rank_order, cg.is_dan, cg.awarded_on as graded_on,
             a.role, a.status, a.paid_until,
             o.name as dojo, o.slug as dojo_slug
             ${includePrivate ? `, pv.emergency_name, pv.emergency_phone` : ''}
      from affiliation a
      join person p on p.id = a.person_id
      join organisation o on o.id = a.organisation_id
      left join person_current_grade cg on cg.person_id = p.id
      ${includePrivate ? 'left join person_private pv on pv.person_id = p.id' : ''}
      where ${scope} and a.ends is null
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
      select g.label, g.rank_order, g.is_dan, gr.awarded_on, gr.result,
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
      ...problemsWithPerson({ firstName, lastName, dateOfBirth, email }),
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
         dateOfBirth || null, gender || null, email || null, phone || null]);

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
           v.preferredName || null, v.dateOfBirth || null, v.gender || null,
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
      gender: fields.gender, email: fields.email, phone: fields.phone,
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
          `update person set ${cols}, updated_at = now() where id = $1`,
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
                       eventId = null, result = 'pass' }) {
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

    return one(`
      insert into grading_record
        (person_id, grade_id, awarded_on, awarded_by_org, event_id, result, panel)
      values ($1,$2,$3,$4,$5,$6,$7::jsonb) returning *`,
      [personId, gradeId, awardedOn, awardedByOrg, eventId, result,
       JSON.stringify(panel.map((id) => ({ person_id: id })))]);
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
       fields.gender || null,
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
               as consents
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
  }) {
    const ev = await one('select organisation_id from event where id = $1', [eventId]);
    if (!ev) throw new NotFound('Event');
    // A club enters its own people, so the role is checked where they are
    // being entered FROM, not at the host organisation — a dojo sensei has no
    // grant at the federation running the tournament.
    await assertRole(actor, enteredForOrg ?? ev.organisation_id, REGISTER);

    if (!personId && !guest)
      throw new Invalid('An entry needs either a person or a guest');
    if (!placements.length)
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
    // say somebody pulled out rather than that they never entered.
    return one(`
      update event_entry set status = 'withdrawn', notes = coalesce($2, notes),
             updated_at = now()
       where id = $1 returning *`, [entryId, reason]);
  },
};

const blank = (v) => (v === '' || v === undefined ? null : v);

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
import { assertMayPublish } from '../core/domain/instructing.mjs';
import { readTheme } from '../site/theme.mjs';
import { problemsWithClubProfile, changesTheSite }
  from '../core/domain/club-profile.mjs';
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
    return one(`update page set status='published', published_at=now()
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
  async create(actor, orgId, { bytes, identified, filename, altText = null,
                               credit = null, consentRef = null }) {
    await assertRole(actor, orgId, MANAGE);

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
    return one(`update article set status='published',
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
             ip.published_at, ip.sort_order
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
  async save(actor, orgId, personId, { bio, teaches, published, sortOrder = 0 }) {
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

    const row = await one(`
      insert into instructor_profile (organisation_id, person_id, bio, teaches,
                                      published, published_by, published_at,
                                      sort_order)
      values ($1,$2,$3,$4,$5,$6,$7,$8)
      on conflict (organisation_id, person_id) do update set
        bio = excluded.bio,
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
       published ? actor : null, published ? new Date() : null, sortOrder]);

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
// a club's own profile
// ---------------------------------------------------------------------------

export const clubProfile = {
  /** The club, and who runs it, who trains in it, and what is coming up. */
  async get(actor, orgId) {
    await assertRole(actor, orgId, MANAGE);
    const club = await one(`select * from organisation where id=$1 and type='club'`, [orgId]);
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
    const before = await one(`select * from organisation where id=$1 and type='club'`, [orgId]);
    if (!before) throw new NotFound('Club');

    const problems = problemsWithClubProfile(input);
    if (problems.length) throw new Invalid(problems.join(' '));

    const row = await one(`
      update organisation
         set name=$2, short_name=$3, founded=$4::date, timezone=$5, status=$6,
             updated_at=now()
       where id=$1 returning *`,
      [orgId, input.name, input.shortName, input.founded, input.timezone, input.status]);

    const was = { name: before.name, status: before.status, timezone: before.timezone,
                  short_name: before.short_name,
                  founded: before.founded ? String(before.founded.toISOString?.().slice(0, 10) ?? before.founded) : null };
    const now = { name: row.name, status: row.status, timezone: row.timezone,
                  short_name: row.short_name,
                  founded: row.founded ? String(row.founded.toISOString?.().slice(0, 10) ?? row.founded) : null };
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
