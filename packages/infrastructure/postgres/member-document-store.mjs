/** INFRASTRUCTURE — the MemberDocumentStore port on Postgres. The file bytes are sealed at rest here. */

import { sealBytes, openBytes } from '../crypto/vault.mjs';
import { DEFAULT_TIMEZONE } from '../../core/domain/defaults.mjs';
import { inTransaction } from './transaction.mjs';

const CATALOGUE = `from organisation me join organisation a on me.path <@ a.path
  join qualification q on q.organisation_id = a.id where me.id = $1`;

export class PostgresMemberDocumentStore {
  /** `db` is the pool, or one client inside a transaction. */
  constructor(pool, db = pool) { this.pool = pool; this.db = db; }

  atomically(work) {
    return inTransaction(this.pool, (client) => work(new PostgresMemberDocumentStore(this.pool, client)));
  }

  async #rows(sql, params) { return (await this.db.query(sql, params)).rows; }
  async #one(sql, params) { return (await this.#rows(sql, params))[0] ?? null; }

  async homeOf(personId) {
    return (await this.#one(`select organisation_id from affiliation where person_id = $1 and ends is null order by (role = 'member') desc limit 1`, [personId]))?.organisation_id ?? null;
  }

  async homesOf(personId) {
    return (await this.#rows('select organisation_id from affiliation where person_id=$1 and ends is null', [personId])).map((r) => r.organisation_id);
  }

  async todayAt(organisationId) {
    const o = await this.#one('select timezone from organisation where id=$1', [organisationId]);
    return (await this.#one(`select to_char((now() at time zone $1)::date,'YYYY-MM-DD') as d`, [o?.timezone ?? DEFAULT_TIMEZONE])).d;
  }

  qualificationChoices(organisationId) { return this.#rows(`select q.id, q.label ${CATALOGUE} order by q.label`, [organisationId]); }
  qualificationAt(organisationId, id) { return this.#one(`select q.id, q.label ${CATALOGUE} and q.id = $2`, [organisationId, id]); }

  documentsOf(personId) {
    return this.#rows(`select d.id, d.title, d.awarded_on::text as awarded_on, d.expires_on::text as expires_on, d.note, d.filename,
        d.mime, d.size_bytes, d.status, d.created_at, d.review_note, qq.label as qualification
      from member_document d left join qualification qq on qq.id = d.qualification_id
      where d.person_id = $1 order by d.created_at desc`, [personId]);
  }

  addDocument(d) {
    return this.#one(`insert into member_document (person_id, organisation_id, qualification_id, title, awarded_on, expires_on, note,
        filename, mime, bytes, size_bytes, uploaded_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
      [d.personId, d.organisationId, d.qualificationId, d.title, d.awardedOn, d.expiresOn, d.note,
       d.file.filename ?? null, d.file.mime, sealBytes(d.file.bytes), d.file.bytes.length, d.uploadedBy]);
  }

  async documentFile(personId, docId) {
    const d = await this.#one('select mime, bytes, filename, title from member_document where id = $1 and person_id = $2', [docId, personId]);
    return d && { ...d, bytes: openBytes(d.bytes) };
  }

  documentToReview(personId, docId) {
    return this.#one(`select id, status, title, qualification_id, awarded_on::text as awarded_on, expires_on::text as expires_on
      from member_document where id = $1 and person_id = $2`, [docId, personId]);
  }

  addAward(a) {
    return this.#one(`insert into qualification_award (person_id, qualification_id, awarded_on, expires_on, reference, recorded_by)
      values ($1,$2,$3,$4,$5,$6) returning id`, [a.personId, a.qualificationId, a.awardedOn, a.expiresOn, a.reference, a.recordedBy]);
  }

  async markReviewed({ docId, accepted, reviewedBy, note, awardId }) {
    await this.db.query(`update member_document set status = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4, award_id = $5 where id = $1`,
      [docId, accepted ? 'accepted' : 'declined', reviewedBy, note, awardId]);
  }

  waitingUnder(organisationId) {
    return this.#rows(`select d.id, d.title, d.person_id, p.first_name, p.last_name, d.created_at from member_document d join person p on p.id = d.person_id
      join organisation o on o.id = d.organisation_id
      where d.status = 'pending' and o.path <@ (select path from organisation where id = $1) order by d.created_at`, [organisationId]);
  }

  async audit({ actorId, organisationId, action, entityId, after }) {
    await this.db.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after) values ($1,$2,$3,'person',$4,$5)`,
      [actorId, organisationId, action, entityId, JSON.stringify(after)]);
  }
}
