/**
 * Documents a member sends to their club, and the photograph rule: an adult needs nobody's permission.
 */
import './reset.mjs';
import http from 'node:http';
import handler from './server.mjs';
import * as auth from './auth.mjs';
import { pool, people, family, memberDocuments, photos, qualifications } from './data.mjs';
import { isPdf, photoNeedsConsent } from '../core/domain/documents.mjs';

process.env.HONBU_STORE = 'postgres';
let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}  ${d}`));
const one = async (sql, a = []) => (await pool.query(sql, a)).rows[0] ?? null;
const refused = async (fn) => { try { await fn(); return null; } catch (e) { return e.message ?? String(e); } };

const wh = await one(`select * from organisation where slug='whanganui'`);
const root = await one(`select * from organisation where parent_id is null`);
const doug = await one(`select id from account where email='doug@example.nz'`);
const enrol = (first, last, dob) => people.enrol(doug.id, { organisationId: wh.id, firstName: first, lastName: last, dateOfBirth: dob });
const acc = async (p, email) => (await pool.query(`insert into account (email, person_id) values ($1,$2) returning id`, [email, p.id])).rows[0].id;
const PDF = Buffer.from('%PDF-1.4\n%fake\n');

console.log('\nPURE');
ok('a PDF is recognised by its first bytes', isPdf(PDF) && !isPdf(Buffer.from('hello world')));
ok('an adult needs nobody\'s yes for a photograph', !photoNeedsConsent(18) && !photoNeedsConsent(40));
ok('a child does, and an unknown age is treated as a child', photoNeedsConsent(9) && photoNeedsConsent(null));

console.log('\nSENDING A DOCUMENT');
{
  await one(`insert into qualification (organisation_id, code, label, category, valid_months, required_for) values ($1,'first-aid','First aid','medical',36,'{instruct}') on conflict do nothing returning id`, [root.id]);
  const adult = await enrol('Ada', 'Adult', '1985-05-05');
  const child = await enrol('Cleo', 'Child', new Date(Date.now() - 9 * 365.25 * 864e5).toISOString().slice(0, 10));
  const parent = await enrol('Pam', 'Parent', '1980-02-02');
  const other = await enrol('Oli', 'Other', '1990-02-02');
  const aa = await acc(adult, 'ada.docs@example.nz'), pa = await acc(parent, 'pam.docs@example.nz'), oa = await acc(other, 'oli.docs@example.nz');
  await family.link(doug.id, { guardianId: parent.id, childId: child.id, relationship: 'parent' });
  const fa = (await memberDocuments.choices(adult.id)).find((c) => /first aid/i.test(c.label));
  ok('the club\'s first aid is on offer', !!fa);
  const file = { bytes: PDF, mime: 'application/pdf', filename: 'cert.pdf' };
  const a1 = await memberDocuments.add(aa, adult.id, { file, qualificationId: fa.id, awardedOn: '2025-06-01' });
  ok('an adult sends their own', !!a1.id);
  ok('a parent sends for a child', !!(await memberDocuments.add(pa, child.id, { file, qualificationId: fa.id, awardedOn: '2025-06-01' })).id);
  ok('a stranger cannot', /./.test(await refused(() => memberDocuments.add(oa, adult.id, { file, qualificationId: fa.id, awardedOn: '2025-06-01' })) ?? ''));
  ok('a date is asked for', /issued/.test(await refused(() => memberDocuments.add(aa, adult.id, { file, qualificationId: fa.id })) ?? ''));
  ok('"something else" needs a name', /what this document is/.test(await refused(() => memberDocuments.add(aa, adult.id, { file })) ?? ''));
  ok('a stranger cannot read it', /./.test(await refused(() => memberDocuments.file(oa, adult.id, a1.id)) ?? ''));
  ok('the person can read it back', (await memberDocuments.file(aa, adult.id, a1.id)).mime === 'application/pdf');
  const opened = async (who) => (await one(`select count(*)::int n from audit_log where action='document_opened' and account_id=$1`, [who])).n;
  ok('the person opening their own is not logged', await opened(aa) === 0);
  await memberDocuments.file(doug.id, adult.id, a1.id);
  ok('an official opening it is logged, with which document', await opened(doug.id) === 1
    && JSON.stringify((await one(`select after from audit_log where action='document_opened' and account_id=$1`, [doug.id])).after).includes(a1.id));
  ok('the club sees one waiting per person', (await memberDocuments.waiting(doug.id, wh.id)).length === 2);
  await memberDocuments.review(doug.id, adult.id, a1.id, { accept: true });
  const award = await one(`select qa.expires_on::text e from qualification_award qa where person_id=$1`, [adult.id]);
  ok('accepting records the qualification with its expiry', !!award?.e && award.e > '2025-06-01', JSON.stringify(award));
  ok('it cannot be reviewed twice', /already/.test(await refused(() => memberDocuments.review(doug.id, adult.id, a1.id, { accept: true })) ?? ''));

  console.log('\nPHOTOGRAPH');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const ident = { mime: 'image/png', width: 1, height: 1, bytes: png.length };
  ok('an adult can save a photograph with no tick', !!(await photos.set(aa, adult.id, { bytes: png, identified: ident, filename: 'a.png' }, {})));
  ok('a child cannot without a parent\'s tick', /parent or guardian/.test(await refused(() => photos.set(pa, child.id, { bytes: png, identified: ident, filename: 'c.png' }, {})) ?? ''));
  ok('a child can with it', !!(await photos.set(pa, child.id, { bytes: png, identified: ident, filename: 'c.png' }, { consent: true })));
}

console.log('\nTHROUGH THE SCREENS');
{
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const jar = {};
  const keep = (res) => { for (const sc of res.headers.getSetCookie?.() ?? []) { const [k, v] = sc.split(';')[0].split('='); if (v === '') delete jar[k]; else jar[k] = v; } };
  const ck = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  const get = async (p) => { const r = await fetch(base + p, { headers: { cookie: ck() }, redirect: 'manual' }); keep(r); return r; };
  const upload = async (p, fields, file) => {
    const fd = new FormData(); fd.append('_csrf', jar.honbu_csrf ?? '');
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    fd.append('document', new Blob([file.bytes], { type: file.type }), file.name);
    const r = await fetch(base + p, { method: 'POST', headers: { cookie: ck() }, redirect: 'manual', body: fd }); keep(r); return r;
  };
  const me = await enrol('Web', 'Adult', '1988-08-08');
  await pool.query(`insert into account (email, person_id) values ('web.adult@example.nz',$1)`, [me.id]);
  await get('/signin');
  const { token } = await auth.requestLink('web.adult@example.nz');
  const so = await fetch(base + `/signin/${token}`, { method: 'POST', redirect: 'manual', headers: { cookie: ck(), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: jar.honbu_csrf ?? '' }).toString() }); keep(so);
  const fa = (await memberDocuments.choices(me.id)).find((c) => /first aid/i.test(c.label));
  let html = await (await get(`/me/${me.id}`)).text();
  ok('an adult is not asked for anybody\'s agreement to the photograph', !/name="consent"/.test(html) && /photo-pick\.js/.test(html));
  ok('their profile points to one place for documents', new RegExp(`/me/${me.id}/documents`).test(html));
  html = await (await get(`/me/${me.id}/documents`)).text();
  ok('the documents page has the upload form', /name="document"/.test(html) && />First aid/.test(html), html.slice(html.indexOf('doc-kind'), html.indexOf('doc-kind') + 300));
  let r = await upload(`/me/${me.id}/documents`, { qualificationId: fa.id, awardedOn: '2025-07-01' }, { bytes: PDF, type: 'application/pdf', name: 'fa.pdf' });
  ok('a PDF is accepted', r.status === 302 && /done=/.test(r.headers.get('location')), r.headers.get('location'));
  const d = await one('select id from member_document where person_id=$1', [me.id]);
  r = await get(`/p/${me.id}/document/${d.id}`);
  ok('they can open it again', r.status === 200 && r.headers.get('content-type') === 'application/pdf');
  r = await upload(`/me/${me.id}/documents`, { qualificationId: fa.id, awardedOn: '2025-07-01' }, { bytes: Buffer.from('just some text'), type: 'application/pdf', name: 'fake.pdf' });
  ok('a text file called .pdf is refused', /error=/.test(r.headers.get('location')) && (await one('select count(*)::int n from member_document where person_id=$1', [me.id])).n === 1);
  server.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
await pool.end();
process.exit(fail ? 1 : 0);
