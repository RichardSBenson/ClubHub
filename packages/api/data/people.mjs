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
import { InstructorReadiness, InstructorStates, ListInstructorProfiles, SaveInstructorProfile, RemoveInstructorProfile, BulkInstructors } from '../../core/application/instructor-profiles.mjs';
import { PostgresInstructorProfileStore } from '../../infrastructure/postgres/instructor-profile-store.mjs';
import { CheckMayChangePhoto, SetPhoto, ClearPhoto, SetAbout, OpenPhoto } from '../../core/application/photos.mjs';
import { SetInstructor } from '../../core/application/instructor-role.mjs';
import { PostgresPhotoStore } from '../../infrastructure/postgres/photo-store.mjs';
import { PostgresInstructorStore } from '../../infrastructure/postgres/instructor-store.mjs';
import { DocumentChoices, ListDocuments, SendDocument, OpenDocument, ReviewDocument, WaitingDocuments } from '../../core/application/member-documents.mjs';
import { PostgresMemberDocumentStore } from '../../infrastructure/postgres/member-document-store.mjs';
import { DeclarationStanding, PublishDeclaration, SignDeclaration } from '../../core/application/declarations.mjs';
import { PostgresDeclarationStore } from '../../infrastructure/postgres/declaration-store.mjs';
import { GrantAccess } from '../../core/application/grant-access.mjs';
import { SelfService } from '../../core/application/self-service.mjs';
import { PostgresSelfServiceReads } from '../../infrastructure/postgres/self-service-reads.mjs';
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
const grantAccess = new GrantAccess({ register, auth });
const selfService = new SelfService({ reads: new PostgresSelfServiceReads(pool), adultAge: () => region().adultAge });
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
  async grantAccess(actor, personId, { role = 'member', email = null, organisationId = null } = {}) {
    return speakingForThisLayer(() => grantAccess.execute({ actorId: actor, personId, role, email, organisationId }));
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

const profileStore = new PostgresInstructorProfileStore(pool);
const profileDeps = { store: profileStore, auth, adultAge: () => region().adultAge, validateBio: (bio) => validate(bio),
  setInstructor: (actor, personId, on) => instructorRole.set(actor, personId, on) };
const instructorReadiness = new InstructorReadiness(profileDeps);
const instructorStates = new InstructorStates(profileDeps);
const listInstructorProfiles = new ListInstructorProfiles(profileDeps);
const saveInstructorProfile = new SaveInstructorProfile(profileDeps);
const removeInstructorProfile = new RemoveInstructorProfile(profileDeps);
const bulkInstructors = new BulkInstructors(profileDeps);

export const instructors = {
  /** Why somebody cannot be shown on their club's website yet (see InstructorReadiness). */
  readiness: (clubId, personId) => instructorReadiness.execute({ clubId, personId }),
  /** For the roll: who holds the instructor role, whether the website shows them, and what holds them back. */
  stateFor: (personIds) => instructorStates.execute({ personIds }),
  /** Make several people instructors in one go, show them, or take the role away (see BulkInstructors). */
  bulk: (actor, scopeOrgId, personIds, mode) => speakingForThisLayer(() => bulkInstructors.execute({ actorId: actor, scopeOrgId, personIds, mode })),
  /** Where this person is an instructor, and whether the club's website shows them yet. */
  siteStatus: (personId) => profileStore.siteStatus(personId),
  listFor: (actor, orgId) => speakingForThisLayer(() => listInstructorProfiles.execute({ actorId: actor, organisationId: orgId })),
  save: (actor, orgId, personId, fields) => speakingForThisLayer(() => saveInstructorProfile.execute({ actorId: actor, organisationId: orgId, personId, ...fields })),
  remove: (actor, orgId, personId) => speakingForThisLayer(() => removeInstructorProfile.execute({ actorId: actor, organisationId: orgId, personId })),
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
  async mine(actor) { return selfService.mine(actor); },

  /** 'self', 'guardian', or null. The only door every self-service screen uses. */
  async mayActFor(actor, personId) { return selfService.mayActFor(actor, personId); },

  /** Whether this person may see and pay what the child owes (see SelfService). */
  async mayPayFor(actor, personId) { return selfService.mayPayFor(actor, personId); },

  async assertMayActFor(actor, personId) {
    return speakingForThisLayer(() => selfService.assertMayActFor(actor, personId));
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
const declarationStore = new PostgresDeclarationStore(pool, { ladderOwnerOf: (id) => orgs.ladderOwnerOf(id) });
const declarationStanding = new DeclarationStanding({ store: declarationStore });
const publishDeclaration = new PublishDeclaration({ store: declarationStore, auth });
const signDeclaration = new SignDeclaration({ store: declarationStore, standing: declarationStanding,
  howMayActFor: (accountId, personId) => selfService.mayActFor(accountId, personId), adultAge: () => region().adultAge });

export const declarations = {
  /** The organisation that owns the declaration for this one: the federation whose ladder it follows. */
  ownerOf: (orgId) => declarationStore.ownerOf(orgId),
  current: (federationId) => declarationStore.currentOf(federationId),
  publish: (actor, orgId, { version, body }) => speakingForThisLayer(() => publishDeclaration.execute({ actorId: actor, organisationId: orgId, version, body })),
  /** Where one person stands: nothing to sign, to sign, or signed. */
  statusFor: (personId) => declarationStanding.execute({ personId }),
  sign: (actor, personId, { accepted, name, ip = null }) => speakingForThisLayer(() => signDeclaration.execute({ actorId: actor, personId, accepted, name, ip })),
  /** Of these people, who has not signed the current version. Empty when nothing is published. */
  async unsignedAmong(orgId, ids = []) {
    if (!ids.length) return new Set();
    const owner = await declarationStore.ownerOf(orgId);
    const current = owner ? await declarationStore.currentOf(owner.id) : null;
    if (!current) return new Set();
    const signed = await declarationStore.signedAmong(current.id, ids);
    return new Set(ids.filter((id) => !signed.has(id)));
  },
  async counts(orgId) {
    const owner = await declarationStore.ownerOf(orgId);
    const current = owner ? await declarationStore.currentOf(owner.id) : null;
    if (!current) return { current: null, signed: 0 };
    return { owner, current, signed: await declarationStore.signedCount(current.id) };
  },
};

const documentStore = new PostgresMemberDocumentStore(pool);
const documentDeps = { store: documentStore, auth, howMayActFor: (accountId, personId) => selfService.mayActFor(accountId, personId) };
const documentChoices = new DocumentChoices(documentDeps);
const listDocuments = new ListDocuments(documentDeps);
const sendDocument = new SendDocument(documentDeps);
const openDocument = new OpenDocument(documentDeps);
const reviewDocument = new ReviewDocument(documentDeps);
const waitingDocuments = new WaitingDocuments(documentDeps);

export const memberDocuments = {
  /** Qualifications the person's club asks for, for the "what is it?" list. */
  choices: (personId) => documentChoices.execute({ personId }),

  /** The person, a parent or guardian, or an official of their club: never the file itself. */
  list: (actor, personId) => speakingForThisLayer(() => listDocuments.execute({ actorId: actor, personId })),
  add: (actor, personId, fields) => speakingForThisLayer(() => sendDocument.execute({ actorId: actor, personId, ...fields })),
  file: (actor, personId, docId) => speakingForThisLayer(() => openDocument.execute({ actorId: actor, personId, docId })),

  /** A registrar accepts or declines. Accepting a qualification records it, with this file as the proof. */
  review: (actor, personId, docId, fields) => speakingForThisLayer(() => reviewDocument.execute({ actorId: actor, personId, docId, ...fields })),
  waiting: (actor, orgId) => speakingForThisLayer(() => waitingDocuments.execute({ actorId: actor, organisationId: orgId })),
};

// ---------------------------------------------------------------------------
// A person's photograph: one picture on their record, used wherever they appear
// ---------------------------------------------------------------------------

const photoDeps = { store: new PostgresPhotoStore(pool), auth, adultAge: () => region().adultAge,
  howMayActFor: (accountId, personId) => selfService.mayActFor(accountId, personId), today: () => new Date().toISOString().slice(0, 10) };
const checkMayChangePhoto = new CheckMayChangePhoto(photoDeps);
const setPhoto = new SetPhoto(photoDeps);
const clearPhoto = new ClearPhoto(photoDeps);
const setAbout = new SetAbout(photoDeps);
const openPhoto = new OpenPhoto(photoDeps);

export const photos = {
  /** Who may change a photograph: the person, a guardian, or an official of their club who keeps the register. */
  assertMay: (actor, personId) => speakingForThisLayer(() => checkMayChangePhoto.execute({ actorId: actor, personId })),

  /**
   * Set or replace somebody's photograph. Somebody has to say it may be kept: for a child that is a parent's yes,
   * so it is asked every time rather than assumed.
   */
  set: (actor, personId, { bytes, identified, filename }, { consent } = {}) =>
    speakingForThisLayer(() => setPhoto.execute({ actorId: actor, personId, bytes, identified, filename, consent })),
  clear: (actor, personId) => speakingForThisLayer(() => clearPhoto.execute({ actorId: actor, personId })),

  /** The few words about themselves that go beside the photograph. */
  setAbout: (actor, personId, text) => speakingForThisLayer(() => setAbout.execute({ actorId: actor, personId, text })),
  forPerson: (personId) => photoDeps.store.photoAssetIdOf(personId),
  bytes: (actor, personId) => speakingForThisLayer(() => openPhoto.execute({ actorId: actor, personId })),
};

// ---------------------------------------------------------------------------
// The instructor switch
// ---------------------------------------------------------------------------

const instructorStore = new PostgresInstructorStore(pool);
const setInstructor = new SetInstructor({ store: instructorStore, auth });

export const instructorRole = {
  /** Is this person recorded as an instructor right now? */
  is: (personId) => instructorStore.isInstructor(personId),
  /** Tick or untick "is an instructor" (see SetInstructor). */
  set: (actor, personId, on) => speakingForThisLayer(() => setInstructor.execute({ actorId: actor, personId, on })),
};
