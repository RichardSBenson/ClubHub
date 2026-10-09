/**
 * Seals what was stored before sealing was switched on: medical notes (people and newcomers) and sent documents.
 * Safe to run any number of times; anything already sealed is left alone. Runs on every deploy after the
 * migrations, and does nothing at all when there is no key or no database.
 */
import pg from 'pg';
import { seal, sealBytes, isSealed, isSealedBytes } from '../packages/infrastructure/crypto/vault.mjs';

if (!process.env.HONBU_DATA_KEY || !process.env.DATABASE_URL) {
  console.log('seal-existing: no key or no database here; nothing to do.');
  process.exit(0);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'insecure' ? { rejectUnauthorized: false } : undefined });
await client.connect();
let notes = 0, files = 0;
try {
  for (const [table, idCol] of [['person_private', 'person_id'], ['newcomer', 'id']]) {
    const { rows } = await client.query(`select ${idCol} as id, medical_notes from ${table} where medical_notes is not null and medical_notes <> '' and medical_notes not like 'enc:v1:%'`);  // security-ok: table and idCol come from the fixed pair list just above
    for (const r of rows) {
      await client.query(`update ${table} set medical_notes = $2 where ${idCol} = $1`, [r.id, seal(r.medical_notes)]);  // security-ok: table and idCol come from the fixed pair list just above
      notes += 1;
    }
  }
  if ((await client.query(`select to_regclass('public.member_document') as t`)).rows[0].t) {
    const { rows } = await client.query(`select id, bytes from member_document where substring(bytes from 1 for 4) <> 'HNB1'::bytea`);
    for (const r of rows) {
      await client.query('update member_document set bytes = $2 where id = $1', [r.id, sealBytes(r.bytes)]);
      files += 1;
    }
  }
} finally { await client.end(); }
console.log(`seal-existing: sealed ${notes} medical note(s) and ${files} document(s).`);
