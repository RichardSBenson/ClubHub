import { pool } from '../api/data.mjs';
import { signToken, verifyToken, applePass, appleManifest,
         googleClass, googleObject, googleJwt, cardFor } from './index.mjs';

const SECRET = 'test-secret-not-for-production';
let pass = 0, fail = 0;
const ok = (n,c,d='') => c ? (pass++,console.log(`  ✓ ${n}`))
                           : (fail++,console.log(`  ✗ ${n} ${d}`));

const AROHA = '22222222-0000-0000-0000-000000000002';
const MIA   = '22222222-0000-0000-0000-000000000004';

console.log('\nTHE DOOR TOKEN — verifiable with no connection');
{
  const t = signToken({ memberNumber:'NZ-0417', rankOrder:7,
    expires:'2026-12-31', orgSlug:'moknz' }, SECRET);
  ok('token is short enough for a QR code', t.length < 60, `${t.length} chars`);
  console.log(`      → ${t}`);

  const v = verifyToken(t, SECRET, new Date('2026-09-17'));
  ok('verifies offline', v.valid && v.memberNumber === 'NZ-0417');
  ok('carries the grade, so eligibility can be checked at the door',
    v.rankOrder === 7);

  const [head, tail] = t.split('.');
  const bad = Buffer.from(head, 'base64url').toString().replace('NZ-0417','NZ-0001');
  ok('a tampered payload fails',
    !verifyToken(`${Buffer.from(bad).toString('base64url')}.${tail}`, SECRET).valid);
  ok('a tampered signature fails',
    !verifyToken(`${head}.${tail.slice(0,-1)}A`, SECRET).valid);
  ok('the wrong key fails', !verifyToken(t, 'other-secret').valid);

  const late = verifyToken(t, SECRET, new Date('2027-03-01'));
  ok('an expired card is refused', !late.valid && late.reason.startsWith('Expired'));
  ok('but still identifies who it was', late.memberNumber === 'NZ-0417');
  console.log(`      → ${late.reason}`);
}

console.log('\nISSUING FROM THE REGISTER');
{
  const card = await cardFor(pool, AROHA, { secret: SECRET, includeHistory: true });
  ok('a paid-up member gets a card', card.issued);
  ok('with their number, grade and dojo',
    card.member.memberNumber === 'NZ-0417' &&
    card.member.grade === '4th kyu' && card.member.dojo === 'Whanganui');
  ok('and the whole grading history for the back of the card',
    card.member.history.length === 7);
  ok('expiry is a real ISO date, not a Date cast to string',
    /^\d{4}-\d{2}-\d{2}$/.test(card.member.expires), card.member.expires);

  await pool.query(`update affiliation set paid_until = null
    where person_id = $1 and ends is null`, [MIA]);
  const unpaid = await cardFor(pool, MIA, { secret: SECRET });
  ok('no paid-until, no card', !unpaid.issued, unpaid.reason);
  console.log(`      → ${unpaid.reason}`);

  await pool.query(`update affiliation set status='lapsed'
    where person_id=$1 and ends is null`, [MIA]);
  const lapsed = await cardFor(pool, MIA, { secret: SECRET });
  ok('a lapsed member gets no card', !lapsed.issued);
  await pool.query(`update affiliation set status='active', paid_until='2026-12-31'
    where person_id=$1 and ends is null`, [MIA]);
}

console.log('\nAPPLE WALLET');
{
  const card = await cardFor(pool, AROHA, { secret: SECRET, includeHistory: true });
  const p = applePass(card.member, card.federation, {
    passTypeIdentifier: 'pass.nz.co.kyokushinkarate.member',
    teamIdentifier: 'ABCDE12345',
    tokens: { ink:'#1C1C1E', accent:'#F0CE41', canvas:'#F4F4F5' },
  });

  ok('serial number is the member number', p.serialNumber === 'NZ-0417');
  ok('expires when affiliation does',
    p.expirationDate.startsWith('2026-12-31'));
  ok('not voided while still paid', p.voided === false);
  ok('barcode carries the signed token', p.barcodes[0].message === card.member.token);
  ok('and shows the member number as fallback text',
    p.barcodes[0].altText === 'NZ-0417');
  ok('brand colours converted to Apple rgb()',
    p.backgroundColor === 'rgb(28,28,30)' && p.labelColor === 'rgb(240,206,65)');
  ok('grade and dojo on the front', 
    p.generic.secondaryFields.map(f=>f.key).join() === 'grade,dojo');
  ok('grading history on the back',
    p.generic.backFields.some(f => f.key === 'history' && f.value.includes('4th kyu')));

  const expired = applePass({ ...card.member, expires: '2020-01-01' },
    card.federation, { passTypeIdentifier:'x', teamIdentifier:'y' });
  ok('a past date marks the pass voided', expired.voided === true);

  const files = { 'pass.json': Buffer.from(JSON.stringify(p)),
                  'icon.png': Buffer.from('fake-png') };
  const man = appleManifest(files);
  ok('manifest hashes every file',
    Object.keys(man).length === 2 && /^[0-9a-f]{40}$/.test(man['pass.json']));
  ok('changing a file changes its hash',
    appleManifest({ 'pass.json': Buffer.from('different') })['pass.json']
      !== man['pass.json']);
}

console.log('\nGOOGLE WALLET');
{
  const card = await cardFor(pool, AROHA, { secret: SECRET });
  const cfg = { issuerId: '3388000000012345678',
    serviceAccountEmail: 'honbu@example.iam.gserviceaccount.com',
    origins: ['https://www.kyokushinkarate.co.nz'],
    tokens: { ink: '#1C1C1E' } };

  const cls = googleClass(card.federation, cfg);
  ok('one class per federation', cls.id.endsWith('.moknz'));

  const obj = googleObject(card.member, card.federation, cfg);
  ok('one object per member', obj.id.includes('NZ-0417'));
  ok('active while paid', obj.state === 'ACTIVE');
  ok('grade, dojo and number as modules', obj.textModulesData.length === 3);

  const dead = googleObject({ ...card.member, expires:'2020-01-01' },
    card.federation, cfg);
  ok('expired state set from the date', dead.state === 'EXPIRED');

  const { claims } = googleJwt([obj], cfg);
  ok('JWT claims are the shape Google expects',
    claims.typ === 'savetowallet' && claims.aud === 'google' &&
    Array.isArray(claims.payload.genericObjects));
}

console.log('\nTHE FAMILY CASE — the reason for all of this');
{
  const kids = [AROHA, MIA];
  const cards = [];
  for (const id of kids) {
    const c = await cardFor(pool, id, { secret: SECRET });
    if (c.issued) cards.push(c);
  }
  ok('two children, two independent passes', cards.length === 2);
  ok('with different serial numbers',
    new Set(cards.map(c => c.member.memberNumber)).size === 2);
  ok('both verify separately at the door',
    cards.every(c => verifyToken(c.member.token, SECRET,
      new Date('2026-10-01')).valid));
  console.log(`      → ${cards.map(c => `${c.member.name} (${c.member.memberNumber})`).join(', ')}`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
await pool.end();
process.exit(fail ? 1 : 0);
