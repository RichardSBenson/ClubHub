/**
 * HONBU — data access: people
 *
 * Part of the data layer (see ../data.mjs). Every function that touches an organisation takes an `actor` and
 * checks permission in SQL, not in the caller.
 */

import { applyRegister } from '../register-import.mjs';
import { parseCsv } from '../../core/domain/register-csv.mjs';
import { pool } from '../../infrastructure/postgres/pool.mjs';
import { DEFAULT_TIMEZONE } from '../../core/domain/defaults.mjs';
import { region } from '../../infrastructure/region-context.mjs';
import { nextGrading } from '../../core/domain/next-grading.mjs';
import { problemsWithPerson, problemsWithMembership, normaliseGender, ageOn, findTwin, twinMessage } from '../../core/domain/people.mjs';
import { seal, open as unseal, sealBytes, openBytes } from '../../infrastructure/crypto/vault.mjs';
import { problemsWithDocument, photoNeedsConsent } from '../../core/domain/documents.mjs';
import { whyNotInstructor, problemsWithRoleAndGrade } from '../../core/domain/roles.mjs';
import { validate } from '../../content/blocks.mjs';
import { assertMayPublish, reasonNotToPublish } from '../../core/domain/instructing.mjs';
import { problemsWithGuardianLink, problemsWithSelfEdit } from '../../core/domain/family.mjs';
import { clearance } from '../../core/domain/qualification.mjs';
import { stateOf as declarationState, problemsWithSigning, problemsWithPublishing as problemsWithDeclarationText, needsGuardian } from '../../core/domain/declarations.mjs';
import { MANAGE, REGISTER, TEACH } from '../../core/domain/access.mjs';
import { EnrolPerson } from '../../core/application/enrol-person.mjs';
import { LinkGuardian, SetGuardianContact, UnlinkGuardian, ListGuardians } from '../../core/application/guardians.mjs';
import { PostgresGuardianRegister } from '../../infrastructure/postgres/guardian-register.mjs';
import { ImportRoll, ReadRoll } from '../../core/application/import-roll.mjs';
import { UpdatePerson, TransferMember } from '../../core/application/change-person.mjs';
import { Refused, NotPermitted, Missing } from '../../core/application/ports.mjs';
import { PostgresPersonRegister } from '../../infrastructure/postgres/person-register.mjs';
import { PostgresAuthorisation } from '../../infrastructure/postgres/repositories.mjs';
import { fees } from './billing.mjs';
import { webhooks } from './messaging.mjs';
import { orgs } from './organisations.mjs';
import { AWARD_SELECT, CATALOGUE_FROM, Forbidden, Invalid, NotFound, PERSON_COLUMNS, assertRole, describeAwards, homesOf, insertAsset, localNow, one, q, qualToday } from './shared.mjs';

/** The use cases speak in their own words; callers of this layer expect Forbidden, Invalid and NotFound. */
async function speakingForThisLayer(run) {
  try { return await run(); } catch (e) {
    if (e instanceof NotPermitted) throw new Forbidden();
    if (e instanceof Refused) throw new Invalid(e.message);
    if (e instanceof Missing) throw new NotFound(e.message);
    throw e;
  }
}

const register = new PostgresPersonRegister(pool);
const auth = new PostgresAuthorisation(pool);
const updatePerson = new UpdatePerson({ register, auth });
const transferMember = new TransferMember({ register, auth });
const guardians = new PostgresGuardianRegister(pool);
const linkGuardian = new LinkGuardian({ register: guardians, auth, adultAge: () => region().adultAge });
const setGuardianContact = new SetGuardianContact({ register: guardians, auth });
const unlinkGuardian = new UnlinkGuardian({ register: guardians, auth });
const listGuardians = new ListGuardians({ register: guardians, auth });
const importRoll = new ImportRoll({ register, auth });
const readRoll = new ReadRoll({ register, auth });
const enrolPerson = new EnrolPerson({
  register, auth,
  announcer: { announce: (orgId, event, data) => webhooks.emitNow(orgId, event, data) },
});

export const people = {
  /** Roster for one organisation. Private detail only for registrars and above. */
  async roster(actor, orgId, { includePrivate = false, subtree = false } = {}) {
    await assertRole(actor, orgId, TEACH);
    if (includePrivate) {
      await assertRole(actor, orgId, REGISTER);
      await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id)
        values ($1,$2,'roster_private_viewed','organisation',$2)`, [actor, orgId]);
    }

    // A national grading draws candidates from every club beneath it, not from
    // the federation's own roll — which is empty, because members affiliate to
    // a club.
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
             o.name as club, o.slug as club_slug
             ${includePrivate ? `, pv.emergency_name, pv.emergency_phone` : ''}
      from affiliation a
      join person p on p.id = a.person_id
      join organisation o on o.id = a.organisation_id
      left join person_current_grade cg on cg.person_id = p.id
      ${includePrivate ? 'left join person_private pv on pv.person_id = p.id' : ''}
      where ${scope} and a.ends is null /* security-ok: scope is one of two fixed fragments chosen just above */
      order by cg.rank_order desc nulls last, p.last_name`, [orgId])
      .then((rows) => includePrivate ? rows.map((r) => ({ ...r, emergency_name: unseal(r.emergency_name), emergency_phone: unseal(r.emergency_phone) })) : rows);
  },

  /** One person, with their whole grading history. Follows them between club. */
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
    const priv = await one('select * from person_private where person_id = $1', [personId]);
    return priv && { ...priv, emergency_name: unseal(priv.emergency_name), emergency_phone: unseal(priv.emergency_phone),
      medical_notes: unseal(priv.medical_notes) };
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
  async enrol(actor, fields) {
    return speakingForThisLayer(() => enrolPerson.execute({ actorId: actor, ...fields }));
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
        `select a.person_id, p.first_name, p.last_name, p.display_number, p.date_of_birth::text as dob
           from account a left join person p on p.id = a.person_id where a.email = $1`, [address]);
      if (clash && clash.person_id && clash.person_id !== personId) {
        // Say whose it is. Most often it is the same person entered twice, and the register should say so.
        const mine = (await client.query(`select first_name, last_name, date_of_birth::text as dob from person where id = $1`, [personId])).rows[0];
        const same = mine && clash.first_name?.toLowerCase() === mine.first_name.toLowerCase()
          && clash.last_name?.toLowerCase() === mine.last_name.toLowerCase() && clash.dob === mine.dob;
        throw new Invalid(same
          ? `${address} already has an account on ${clash.first_name} ${clash.last_name} (${clash.display_number}), who looks like the same person entered twice. Open ${clash.display_number} instead.`
          : `${address} already belongs to ${clash.first_name} ${clash.last_name}'s account (${clash.display_number}).`);
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
    return speakingForThisLayer(() => importRoll.execute({ actorId: actor, organisationId, rows }));
  },

  /** Who is already on this roll, in the shape the import planner compares. */
  async rollFor(actor, organisationId) {
    return speakingForThisLayer(() => readRoll.execute({ actorId: actor, organisationId }));
  },

  /**
   * Change what the register says about someone.
   *
   * Grade is not here, and never will be: a grade changes by being awarded,
   * through the authority rules, not by someone editing a field.
   */
  async update(actor, personId, fields = {}) {
    return speakingForThisLayer(() => updatePerson.execute({ actorId: actor, personId, fields }));
  },

  /** Move someone to another club. The grading history is untouched: it belongs to the person. */
  async transfer(actor, personId, toOrgId, on = new Date()) {
    return speakingForThisLayer(() => transferMember.execute({ actorId: actor, personId, toOrganisationId: toOrgId, on }));
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
 * Load the club register's three CSV files (clubs, class times, instructors) into this federation.
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
    const clubs = read(files.clubs), sessions = read(files.sessions), instructors = read(files.instructors);
    if (!clubs.length && !sessions.length && !instructors.length) throw new Invalid('Paste at least one file.');
    for (const [name, rows, cols] of [['clubs', clubs, ['slug']], ['sessions', sessions, ['slug', 'weekday', 'starts', 'ends']],
                                      ['instructors', instructors, ['slug', 'first_name', 'last_name', 'dan']]]) {
      if (rows.length) for (const c of cols) if (!(c in rows[0])) throw new Invalid(`The ${name} file has no "${c}" column. The first line must be the column names. I found: ${rows.columns.slice(0, 8).join(', ')}${rows.columns.length > 8 ? ', ...' : ''}.`);
    }
    const client = await pool.connect();
    try {
      await client.query('begin');
      const report = await applyRegister(client, { clubs, sessions, instructors });
      if (confirm) {
        await client.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
          values ($1,$2,'register_import','organisation',$2,$3::jsonb)`,
          [actor, orgId, JSON.stringify({ clubs: clubs.length, sessions: sessions.length, instructors: instructors.length,
                                          updated: report.updated, published: report.published, people: report.people })]);
        await client.query('commit');
      } else await client.query('rollback');
      return report;
    } catch (e) { await client.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
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
   * Why somebody cannot be shown on their club's website yet, or an empty list if they can. Shown only when
   * they are 18 or over, every check the federation requires of instructors is current, and they have written
   * their few words. `never` is set when the reason is one nothing can fix by waiting for paperwork (a minor).
   */
  async readiness(clubId, personId) {
    const who = await one(`select date_of_birth::text as dob, nullif(about, '') as about from person where id=$1`, [personId]);
    const org = await one('select settings from organisation where id=$1', [clubId]);
    const why = reasonNotToPublish({ person: { dateOfBirth: who?.dob }, isInstructor: true,
      on: new Date().toISOString().slice(0, 10), settings: org?.settings ?? {} });
    if (why) return { never: /under/.test(why) ? `under ${region().adultAge}` : 'no date of birth recorded', missing: [] };
    const required = await q(`select q.id, q.label ${CATALOGUE_FROM} and 'instruct' = any(q.required_for) order by q.label`, [clubId]);
    const awards = await q(`${AWARD_SELECT} where qa.person_id = $1`, [personId]);
    const c = clearance(required, awards, await qualToday(clubId));
    const missing = c.barred.map((b) => (b.state === 'expired' ? `${b.label} (expired)` : b.label));
    if (!who?.about) missing.push('a write-up about themselves');
    return { never: null, missing };
  },

  /** For the roll: who holds the instructor role, whether the website shows them, and what holds them back. */
  async stateFor(personIds) {
    const out = new Map();
    if (!personIds.length) return out;
    const rows = await q(`
      select a.person_id, a.organisation_id as club_id, coalesce(ip.published, false) as published
      from affiliation a
      left join instructor_profile ip on ip.person_id = a.person_id and ip.organisation_id = a.organisation_id
      where a.person_id = any($1::uuid[]) and a.role = 'instructor' and a.ends is null and a.status = 'active'`, [personIds]);
    for (const r of rows) {
      const ready = r.published ? { never: null, missing: [] } : await this.readiness(r.club_id, r.person_id);
      out.set(r.person_id, { published: r.published, ...ready });
    }
    return out;
  },

  /**
   * Make several people instructors in one go, optionally showing them on the website, or take the role away.
   * `scopeOrgId` is where the actor is working (a club, a region or the federation): people must be on the roll
   * of a club beneath it, and each is dealt with at their own club. Nobody is skipped silently.
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
      const club = homes.get(id);
      if (!who || !club) { out.skipped.push({ name: who?.name ?? 'Someone', reason: 'not on the roll here' }); continue; }
      if (mode === 'off') {
        if ((await instructorRole.set(actor, id, false)).changed) out.changed += 1;
        continue;
      }
      if ((await instructorRole.set(actor, id, true)).changed) out.changed += 1;
      if (mode !== 'show') continue;

      // Shown only when ready; anything missing is named, not just refused.
      const r = await this.readiness(club, id);
      if (r.never) { out.skipped.push({ name: who.name, reason: `an instructor, but not shown on the website: ${r.never}` }); continue; }
      if (r.missing.length) { out.skipped.push({ name: who.name, reason: 'an instructor, not shown yet. Still needs ' + r.missing.join(', ') }); continue; }

      const cur = await one(`select bio, teaches, sort_order, started_year, show_checks, published from instructor_profile
        where organisation_id=$1 and person_id=$2`, [club, id]);
      await this.save(actor, club, id, { bio: cur?.bio ?? { blocks: [] }, teaches: cur?.teaches ?? null, published: true,
        sortOrder: cur?.sort_order ?? 0, startedYear: cur?.started_year ?? null, showChecks: true });
      if (!cur?.published) out.shown += 1;
    }
    return out;
  },

  /** Where this person is an instructor, and whether the club's website shows them yet. */
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

export const family = {
  /** Which of these people are children with nobody linked as parent or guardian. */
  async withoutGuardian(ids = []) {
    if (!ids.length) return new Set();
    const { rows } = await pool.query(`
      select p.id from person p
      where p.id = any($1::uuid[]) and p.date_of_birth > current_date - make_interval(years => $2)
        and not exists (select 1 from guardian_link gl where gl.child_id = p.id and gl.ended_on is null)`, [ids, region().adultAge]);
    return new Set(rows.map((r) => r.id));
  },

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
        and p.date_of_birth > current_date - make_interval(years => $2)
      order by p.first_name`, [self.id, region().adultAge]);
    return { self, dependants };
  },

  /** 'self', 'guardian', or null. The only door every self-service screen uses. */
  async mayActFor(actor, personId) {
    const { self, dependants } = await this.mine(actor);
    if (!self) return null;
    if (self.id === personId) return 'self';
    return dependants.some((d) => d.id === personId) ? 'guardian' : null;
  },

  /**
   * Whether this person may see and pay what the child owes. Yourself, always. A linked adult, unless the
   * child has somebody marked as looking after the fees and it is not them.
   */
  async mayPayFor(actor, personId) {
    const how = await this.mayActFor(actor, personId);
    if (how !== 'guardian') return how === 'self';
    const self = await one('select person_id from account where id=$1', [actor]);
    const row = await one(`select bool_or(pays_fees) as any_set, bool_or(pays_fees and guardian_id = $2) as mine
      from guardian_link where child_id=$1 and ended_on is null`, [personId, self.person_id]);
    return !row?.any_set || !!row.mine;
  },

  async assertMayActFor(actor, personId) {
    const how = await this.mayActFor(actor, personId);
    if (!how) throw new Forbidden();
    return how;
  },

  /** A registrar links a parent or guardian to a child at the child's club. */
  async link(actor, { guardianId, childId, relationship = 'parent' }) {
    return speakingForThisLayer(() => linkGuardian.execute({ actorId: actor, guardianId, childId, relationship }));
  },

  /** Choose who a child's club mail goes to (see SetGuardianContact). */
  async setContact(actor, linkId, { main = false, copy = false, fees = false }) {
    return speakingForThisLayer(() => setGuardianContact.execute({ actorId: actor, linkId, main, copy, fees }));
  },

  async unlink(actor, linkId) {
    return speakingForThisLayer(() => unlinkGuardian.execute({ actorId: actor, linkId }));
  },

  /** The guardians of a child, for the child's own record. */
  async guardiansOf(actor, childId) {
    return speakingForThisLayer(() => listGuardians.execute({ actorId: actor, childId }));
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
    priv.medical_notes = unseal(priv.medical_notes);
    priv.emergency_name = unseal(priv.emergency_name);
    priv.emergency_phone = unseal(priv.emergency_phone);
    const grade = await one(`select cg.label, cg.rank_order, cg.awarded_on::text as awarded_on,
        (select n.label from grade g join grade n on n.organisation_id = g.organisation_id
           and n.rank_order = g.rank_order + 1 where g.id = cg.grade_id) as next_label,
        hg.usual_months_to_next as usual_months, hg.next_by_invitation as by_invitation
      from person_current_grade cg join grade hg on hg.id = cg.grade_id where cg.person_id=$1`, [personId]);
    if (grade) grade.next_grading = nextGrading({ held: { awardedOn: grade.awarded_on, usualMonths: grade.usual_months, byInvitation: grade.by_invitation },
      next: grade.next_label ? { label: grade.next_label } : null, today: localNow(DEFAULT_TIMEZONE).date });
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
         seal(input.emergency_name), seal(input.emergency_phone), seal(input.medical_notes)]);

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

/** The federation's one declaration: written once, signed once per person, kept by version. */
export const declarations = {
  /** The organisation that owns the declaration for this one: the federation whose ladder it follows. */
  async ownerOf(orgId) {
    return (await orgs.ladderOwnerOf(orgId)) ?? (await one('select * from organisation where id = $1', [orgId]));
  },
  async current(federationId) {
    return one(`select id, version, body, to_char(published_at at time zone $2,'YYYY-MM-DD') as published_on
      from federation_declaration where organisation_id = $1 order by published_at desc limit 1`, [federationId, DEFAULT_TIMEZONE]);
  },
  async publish(actor, orgId, { version, body }) {
    const owner = await this.ownerOf(orgId);
    await assertRole(actor, owner.id, REGISTER);
    const problems = problemsWithDeclarationText({ version, body });
    if (problems.length) throw new Invalid(problems.join(' '));
    try {
      return await one(`insert into federation_declaration (organisation_id, version, body, published_by)
        values ($1,$2,$3,$4) returning id, version`, [owner.id, String(version).trim(), String(body).trim(), actor]);
    } catch (e) {
      if (e.code === '23505') throw new Invalid(`Version ${String(version).trim()} has already been used. Give the new wording a new version.`);
      throw e;
    }
  },
  /** Where one person stands: nothing to sign, to sign, or signed. */
  async statusFor(personId) {
    const home = (await homesOf(personId))[0];
    if (!home) return { state: 'none' };
    const owner = await this.ownerOf(home);
    const current = owner ? await this.current(owner.id) : null;
    if (!current) return { state: 'none', owner };
    const signed = await one(`select signed_name, guardian, to_char(signed_at at time zone $3,'YYYY-MM-DD') as signed_on
      from declaration_signing where person_id = $1 and declaration_id = $2`, [personId, current.id, DEFAULT_TIMEZONE]);
    return { state: declarationState({ current, signed }), owner, current, signed };
  },
  async sign(actor, personId, { accepted, name, ip = null }) {
    const how = await family.assertMayActFor(actor, personId);
    const st = await this.statusFor(personId);
    if (st.state === 'none') throw new Invalid('There is no declaration to sign yet.');
    if (st.state === 'signed') return st;
    const age = (await one(`select date_part('year', age(date_of_birth))::int as age from person where id = $1`, [personId]))?.age ?? null;
    const problems = problemsWithSigning({ accepted, name, isChild: needsGuardian(age, region().adultAge), how });
    if (problems.length) throw new Invalid(problems.join(' '));
    await pool.query(`insert into declaration_signing (person_id, declaration_id, signed_name, signed_by, guardian, ip)
      values ($1,$2,$3,$4,$5,$6) on conflict (person_id, declaration_id) do nothing`,
      [personId, st.current.id, String(name).trim(), actor, how !== 'self', ip]);
    return this.statusFor(personId);
  },
  /** Of these people, who has not signed the current version. Empty when nothing is published. */
  async unsignedAmong(orgId, ids = []) {
    if (!ids.length) return new Set();
    const owner = await this.ownerOf(orgId);
    const current = owner ? await this.current(owner.id) : null;
    if (!current) return new Set();
    const { rows } = await pool.query(`select person_id from declaration_signing where declaration_id = $1 and person_id = any($2::uuid[])`, [current.id, ids]);
    const signed = new Set(rows.map((r) => r.person_id));
    return new Set(ids.filter((id) => !signed.has(id)));
  },
  async counts(orgId) {
    const owner = await this.ownerOf(orgId);
    const current = owner ? await this.current(owner.id) : null;
    if (!current) return { current: null, signed: 0 };
    const row = await one(`select count(*)::int as n from declaration_signing where declaration_id = $1`, [current.id]);
    return { owner, current, signed: row.n };
  },
};

export const memberDocuments = {
  async _homeOf(personId) {
    return (await one(`select organisation_id from affiliation where person_id = $1 and ends is null
      order by (role = 'member') desc limit 1`, [personId]))?.organisation_id ?? null;
  },
  async _isOfficial(actor, personId) {
    for (const h of await homesOf(personId))
      if ((await one('select has_role_at($1,$2,$3) as ok', [actor, h, REGISTER]))?.ok) return h;
    return null;
  },

  /** Qualifications the person's club asks for, for the "what is it?" list. */
  async choices(personId) {
    const home = await this._homeOf(personId);
    return home ? q(`select q.id, q.label ${CATALOGUE_FROM} order by q.label`, [home]) : [];
  },

  /** The person, a parent or guardian, or an official of their club: never the file itself. */
  async list(actor, personId) {
    const official = await this._isOfficial(actor, personId);
    if (!official && !(await family.mayActFor(actor, personId))) throw new Forbidden();
    const rows = await q(`select d.id, d.title, d.awarded_on::text as awarded_on, d.expires_on::text as expires_on, d.note, d.filename,
        d.mime, d.size_bytes, d.status, d.created_at, d.review_note, qq.label as qualification
      from member_document d left join qualification qq on qq.id = d.qualification_id
      where d.person_id = $1 order by d.created_at desc`, [personId]);
    return { rows, official: !!official };
  },

  async add(actor, personId, { file, qualificationId = null, title = '', awardedOn = null, expiresOn = null, note = '' }) {
    if (!(await family.mayActFor(actor, personId)) && !(await this._isOfficial(actor, personId))) throw new Forbidden();
    const home = await this._homeOf(personId);
    if (!home) throw new Invalid('This person is not on a club\'s roll yet, so there is nobody to send it to.');
    const qual = qualificationId
      ? await one(`select q.id, q.label ${CATALOGUE_FROM} and q.id = $2`, [home, qualificationId]) : null;
    if (qualificationId && !qual) throw new Invalid('That is not something this club asks for.');
    const today = await qualToday(home);
    const problems = problemsWithDocument({ title, awardedOn: awardedOn || '', expiresOn: expiresOn || '', hasQualification: !!qual },
      { size: file?.bytes?.length ?? 0 }, { today });
    if (problems.length) throw new Invalid(problems.join(' '));
    const row = await one(`insert into member_document (person_id, organisation_id, qualification_id, title, awarded_on, expires_on, note,
        filename, mime, bytes, size_bytes, uploaded_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
      [personId, home, qual?.id ?? null, (qual?.label ?? String(title).trim()).slice(0, 120), awardedOn || null, expiresOn || null,
       String(note ?? '').trim().slice(0, 300) || null, file.filename ?? null, file.mime, sealBytes(file.bytes), file.bytes.length, actor]);
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
      values ($1,$2,'document_sent','person',$3,$4)`, [actor, home, personId, JSON.stringify({ documentId: row.id, title: qual?.label ?? title })]);
    return row;
  },

  async file(actor, personId, docId) {
    const official = await this._isOfficial(actor, personId);
    const own = await family.mayActFor(actor, personId);
    if (!official && !own) throw new Forbidden();
    const d = await one('select mime, bytes, filename, title from member_document where id = $1 and person_id = $2', [docId, personId]);
    if (!d) throw new NotFound('Document');
    // Somebody opening another person's document is the thing worth being able to answer for later.
    if (official && !own)
      await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
        values ($1,$2,'document_opened','person',$3,$4)`, [actor, official, personId, JSON.stringify({ documentId: docId, title: d.title })]);
    return { ...d, bytes: openBytes(d.bytes) };
  },

  /** A registrar accepts or declines. Accepting a qualification records it, with this file as the proof. */
  async review(actor, personId, docId, { accept, note = '', awardedOn = null, expiresOn = null }) {
    const home = await this._isOfficial(actor, personId);
    if (!home) throw new Forbidden();
    const d = await one('select id, status, title, qualification_id, awarded_on::text as awarded_on, expires_on::text as expires_on from member_document where id = $1 and person_id = $2', [docId, personId]);
    if (!d) throw new NotFound('Document');
    if (d.status !== 'pending') throw new Invalid('That one has already been dealt with.');
    let awardId = null;
    if (accept && d.qualification_id) {
      const on = awardedOn || d.awarded_on;
      if (!on) throw new Invalid('There is no issue date on this one. Add the date it was issued before accepting.');
      const a = await one(`insert into qualification_award (person_id, qualification_id, awarded_on, expires_on, reference, recorded_by)
        values ($1,$2,$3,$4,$5,$6) returning id`, [personId, d.qualification_id, on, expiresOn || d.expires_on || null, 'Sent in by the member', actor]);
      awardId = a.id;
    }
    await pool.query(`update member_document set status = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4, award_id = $5 where id = $1`,
      [docId, accept ? 'accepted' : 'declined', actor, String(note ?? '').trim().slice(0, 300) || null, awardId]);
    await pool.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
      values ($1,$2,$3,'person',$4,$5)`, [actor, home, accept ? 'document_accepted' : 'document_declined', personId, JSON.stringify({ documentId: docId, title: d.title })]);
  },

  async waiting(actor, orgId) {
    await assertRole(actor, orgId, REGISTER);
    return q(`select d.id, d.title, d.person_id, p.first_name, p.last_name, d.created_at from member_document d join person p on p.id = d.person_id
      join organisation o on o.id = d.organisation_id
      where d.status = 'pending' and o.path <@ (select path from organisation where id = $1) order by d.created_at`, [orgId]);
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
    const kid = await one('select date_of_birth::text as dob from person where id = $1', [personId]);
    if (photoNeedsConsent(ageOn(kid?.dob, null), region().adultAge) && !consent)
      throw new Invalid('Please confirm that their parent or guardian agrees to this photograph being kept.');
    const home = await one(`select organisation_id from affiliation where person_id = $1 and ends is null
      order by (role = 'member') desc limit 1`, [personId]);
    if (!home) throw new NotFound('Person has no current affiliation');
    const who = await one(`select first_name || ' ' || last_name as name from person where id = $1`, [personId]);
    const asset = await insertAsset(actor, home.organisation_id, { bytes, identified, filename,
      altText: `Photograph of ${who.name}`, consentRef: `Kept with the agreement of the person or their guardian, recorded ${new Date().toISOString().slice(0, 10)}` });
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

  /** The few words about themselves that go beside the photograph. Same people may write it as may change the photograph. */
  async setAbout(actor, personId, text) {
    await this.assertMay(actor, personId);
    const about = String(text ?? '').replace(/\r\n/g, '\n').trim();
    if (about.length > 280) throw new Invalid('Keep it to 280 characters.');
    await pool.query('update person set about = $2, updated_at = now() where id = $1', [personId, about || null]);
    await pool.query(`insert into audit_log (account_id, action, entity, entity_id) values ($1,'person_about_changed','person',$2)`, [actor, personId]);
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
      const g = await one('select label, is_dan from person_current_grade where person_id = $1', [personId]);
      const why = whyNotInstructor(g);
      if (why) throw new Invalid(why);
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
