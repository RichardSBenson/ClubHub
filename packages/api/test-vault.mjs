/**
 * Sealed health notes and documents: what is in the database is unreadable without the key, what the screens
 * show is readable, and a missing key on a real deployment is a refusal, not a quiet plaintext.
 */
import './reset.mjs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pool, people, myself, memberDocuments } from './data.mjs';
import { seal, open, sealBytes, openBytes, isSealed, VaultError } from '../infrastructure/crypto/vault.mjs';

process.env.HONBU_STORE = 'postgres';
let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}  ${d}`));
const one = async (sql, a = []) => (await pool.query(sql, a)).rows[0] ?? null;
const throws = (fn) => { try { fn(); return null; } catch (e) { return e; } };

const LOCAL_DB = 'postgresql:///honbu?host=/tmp/pgrun&port=5433&user=postgres';
const KEY = crypto.randomBytes(32).toString('base64');
process.env.HONBU_DATA_KEY = KEY;

console.log('\nTHE VAULT');
{
  const s = seal('asthma, allergic to penicillin');
  ok('sealed text is not the text', isSealed(s) && !s.includes('asthma'));
  ok('and opens back to it', open(s) === 'asthma, allergic to penicillin');
  ok('every sealing is different (a fresh nonce)', seal('x') !== seal('x'));
  ok('old plain text is read as it is', open('old note') === 'old note');
  ok('empty and null stay as they are', seal('') === '' && seal(null) === null);
  ok('sealing twice does not double-seal', seal(s) === s);
  const tampered = s.slice(0, -3) + (s.endsWith('AAA') ? 'BBB' : 'AAA');
  ok('an altered value refuses to open', throws(() => open(tampered)) instanceof VaultError);
  process.env.HONBU_DATA_KEY = crypto.randomBytes(32).toString('base64');
  ok('the wrong key refuses to open it', throws(() => open(s)) instanceof VaultError);
  process.env.HONBU_DATA_KEY = KEY;
  const b = sealBytes(Buffer.from('%PDF-1.4 secret certificate bytes ......................'));
  ok('sealed bytes hide the contents', !b.includes('secret') && b.subarray(0, 4).toString() === 'HNB1');
  ok('and open back', openBytes(b).toString().includes('secret certificate'));
  ok('plain bytes pass through', openBytes(Buffer.from('plain bytes')).toString() === 'plain bytes');
  delete process.env.HONBU_DATA_KEY; process.env.VERCEL = '1';
  ok('a real deployment with no key refuses to store anything sensitive', throws(() => seal('x')) instanceof VaultError);
  delete process.env.VERCEL; process.env.HONBU_DATA_KEY = KEY;
}

console.log('\nIN THE DATABASE');
{
  const wh = await one(`select * from organisation where slug='whanganui'`);
  const doug = await one(`select id from account where email='doug@example.nz'`);
  const p = await people.enrol(doug.id, { organisationId: wh.id, firstName: 'Sealed', lastName: 'Person', dateOfBirth: '1990-01-01' });
  const acc = (await pool.query(`insert into account (email, person_id) values ('sealed@example.nz',$1) returning id`, [p.id])).rows[0].id;
  const form = { preferred_name: null, phone: null, email: null, about: null, address_line: null, suburb: null, city: null, postcode: null,
    emergency_name: 'Mum', emergency_phone: '021 000 000', medical_notes: 'epilepsy, takes medication at 8am' };
  await myself.update(acc, p.id, form);
  const raw = await one('select medical_notes from person_private where person_id=$1', [p.id]);
  ok('the database holds it sealed', isSealed(raw.medical_notes) && !/epilepsy/.test(raw.medical_notes));
  const rawEc = await one('select emergency_name, emergency_phone from person_private where person_id=$1', [p.id]);
  ok('the emergency contact is sealed in the database too', isSealed(rawEc.emergency_name) && isSealed(rawEc.emergency_phone) && !/Mum|021/.test(rawEc.emergency_name + rawEc.emergency_phone));
  const readBack = (await myself.get(acc, p.id)).private;
  ok('and the screen reads it plainly', readBack.emergency_name === 'Mum' && readBack.emergency_phone === '021 000 000');
  ok('the screen reads it plainly', (await myself.get(acc, p.id)).private.medical_notes === 'epilepsy, takes medication at 8am');
  await myself.update(acc, p.id, { ...form, medical_notes: 'epilepsy, takes medication at 8am' });
  const hist = await one(`select after from audit_log where action='update' and entity_id=$1 order by at desc limit 1`, [p.id]);
  ok('saving the same note again is not seen as a change', !/medical_notes/.test(JSON.stringify(hist?.after ?? '')));

  const doc = await memberDocuments.add(acc, p.id, { file: { bytes: Buffer.from('%PDF-1.4 vetting certificate ................................'), mime: 'application/pdf', filename: 'v.pdf' }, title: 'Police vet' });
  const stored = await one('select bytes from member_document where id=$1', [doc.id]);
  ok('a sent document is sealed in the database', stored.bytes.subarray(0, 4).toString() === 'HNB1' && !stored.bytes.includes('vetting'));
  ok('and the person can still open it', (await memberDocuments.file(acc, p.id, doc.id)).bytes.toString().includes('vetting certificate'));

  console.log('\nSEALING WHAT WAS THERE BEFORE');
  await pool.query(`update person_private set medical_notes = 'plain old note', emergency_name = 'Old Aunt', emergency_phone = '021 555' where person_id=$1`, [p.id]);
  await pool.query(`update member_document set bytes = $2 where id = $1`, [doc.id, Buffer.from('%PDF-1.4 unsealed old file ..............................')]);
  const out = execFileSync('node', ['tools/seal-existing.mjs'], { cwd: new URL('../..', import.meta.url).pathname,
    env: { ...process.env, HONBU_DATA_KEY: KEY, DATABASE_URL: LOCAL_DB } }).toString();
  const after = await one('select medical_notes from person_private where person_id=$1', [p.id]);
  const afterEc = await one('select emergency_name, emergency_phone from person_private where person_id=$1', [p.id]);
  ok('and an old plain emergency contact', isSealed(afterEc.emergency_name) && open(afterEc.emergency_phone) === '021 555');
  ok('an old plain note is sealed by the tool', isSealed(after.medical_notes) && open(after.medical_notes) === 'plain old note', out);
  ok('and an old file', (await one('select substring(bytes from 1 for 4) b from member_document where id=$1', [doc.id])).b.toString() === 'HNB1');
  const again = execFileSync('node', ['tools/seal-existing.mjs'], { cwd: new URL('../..', import.meta.url).pathname, env: { ...process.env, HONBU_DATA_KEY: KEY, DATABASE_URL: LOCAL_DB } }).toString();
  ok('running it again changes nothing', /sealed 0 record\(s\) of medical notes and emergency contacts and 0 document\(s\)/.test(again), again);
}

console.log(`\n${pass} passed, ${fail} failed`);
await pool.end();
process.exit(fail ? 1 : 0);
