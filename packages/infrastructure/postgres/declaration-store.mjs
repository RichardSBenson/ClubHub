/** INFRASTRUCTURE — the DeclarationStore port on Postgres. */

import { DEFAULT_TIMEZONE } from '../../core/domain/defaults.mjs';

export class PostgresDeclarationStore {
  /** `ladderOwnerOf(organisationId)` finds the federation whose ladder (and so declaration) an organisation follows. */
  constructor(pool, { ladderOwnerOf }) { this.pool = pool; this.ladderOwnerOf = ladderOwnerOf; }

  async #one(sql, params) { return (await this.pool.query(sql, params)).rows[0] ?? null; }

  async ownerOf(organisationId) {
    return (await this.ladderOwnerOf(organisationId)) ?? this.#one('select * from organisation where id = $1', [organisationId]);
  }

  currentOf(ownerId) {
    return this.#one(`select id, version, body, to_char(published_at at time zone $2,'YYYY-MM-DD') as published_on
      from federation_declaration where organisation_id = $1 order by published_at desc limit 1`, [ownerId, DEFAULT_TIMEZONE]);
  }

  async firstHomeOf(personId) {
    const { rows } = await this.pool.query('select organisation_id from affiliation where person_id=$1 and ends is null', [personId]);
    return rows[0]?.organisation_id ?? null;
  }

  signingOf(personId, declarationId) {
    return this.#one(`select signed_name, guardian, to_char(signed_at at time zone $3,'YYYY-MM-DD') as signed_on
      from declaration_signing where person_id = $1 and declaration_id = $2`, [personId, declarationId, DEFAULT_TIMEZONE]);
  }

  async ageOf(personId) {
    return (await this.#one(`select date_part('year', age(date_of_birth))::int as age from person where id = $1`, [personId]))?.age ?? null;
  }

  async addSigning({ personId, declarationId, name, signedBy, guardian, ip }) {
    await this.pool.query(`insert into declaration_signing (person_id, declaration_id, signed_name, signed_by, guardian, ip)
      values ($1,$2,$3,$4,$5,$6) on conflict (person_id, declaration_id) do nothing`, [personId, declarationId, name, signedBy, guardian, ip]);
  }

  async publish({ ownerId, version, body, publishedBy }) {
    try {
      return await this.#one(`insert into federation_declaration (organisation_id, version, body, published_by)
        values ($1,$2,$3,$4) returning id, version`, [ownerId, version, body, publishedBy]);
    } catch (e) {
      if (e.code === '23505') return null;
      throw e;
    }
  }

  async signedAmong(declarationId, personIds) {
    const { rows } = await this.pool.query(
      'select person_id from declaration_signing where declaration_id = $1 and person_id = any($2::uuid[])', [declarationId, personIds]);
    return new Set(rows.map((r) => r.person_id));
  }

  async signedCount(declarationId) {
    return (await this.#one('select count(*)::int as n from declaration_signing where declaration_id = $1', [declarationId])).n;
  }
}
