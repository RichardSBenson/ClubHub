/** INFRASTRUCTURE — the PhotoStore port on Postgres. The picture's bytes live in the database, apart from its metadata. */

import { PostgresStore } from './store-base.mjs';

export class PostgresPhotoStore extends PostgresStore {
  async dateOfBirthOf(personId) { return (await this.one('select date_of_birth::text as dob from person where id = $1', [personId]))?.dob ?? null; }
  async nameOf(personId) { return (await this.one(`select first_name || ' ' || last_name as name from person where id = $1`, [personId]))?.name; }

  async addPhotoAsset({ organisationId, bytes, identified, filename, altText, consentRef, uploadedBy }) {
    const row = await this.one(`
      insert into asset (organisation_id, kind, storage_key, filename, mime, width, height, bytes, alt_text, credit, consent_ref)
      values ($1,'image','',$2,$3,$4,$5,$6,$7,null,$8) returning *`,
      [organisationId, filename, identified.mime, identified.width, identified.height, identified.bytes, altText, consentRef]);
    await this.db.query('insert into asset_blob (asset_id, bytes) values ($1,$2)', [row.id, bytes]);
    await this.db.query(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after) values ($1,$2,'asset_upload','asset',$3,$4)`,
      [uploadedBy, organisationId, row.id, JSON.stringify({ filename, mime: identified.mime, width: identified.width, height: identified.height, bytes: identified.bytes })]);
    return row;
  }

  async setPhoto(personId, assetId) { await this.db.query('update person set photo_asset_id = $2, updated_at = now() where id = $1', [personId, assetId]); }
  async clearPhoto(personId) { await this.db.query('update person set photo_asset_id = null, updated_at = now() where id = $1', [personId]); }
  async setAbout(personId, text) { await this.db.query('update person set about = $2, updated_at = now() where id = $1', [personId, text]); }

  async photoAssetIdOf(personId) { return (await this.one('select photo_asset_id from person where id = $1', [personId]))?.photo_asset_id ?? null; }

  async photoFile(assetId) {
    const a = await this.one('select mime from asset where id = $1', [assetId]);
    const b = await this.one('select bytes from asset_blob where asset_id = $1', [assetId]);
    return b?.bytes ? { mime: a.mime, bytes: b.bytes } : null;
  }
}
