import '../api/reset.mjs';
import { execSync } from 'node:child_process';
import { pool } from '../infrastructure/postgres/pool.mjs';
import { DefineContentType } from './application/define-content-type.mjs';
import { SaveEntry } from './application/save-entry.mjs';
import { Refused } from './application/ports.mjs';
import { FieldType, RoutePattern } from './domain/content-types.mjs';
import { PostgresContentTypes, PostgresContentEntries,
         PostgresAuthorisation, SystemClock } from '../infrastructure/postgres/repositories.mjs';

for (const f of ['003-auth','008-content-types'])
  execSync(`su postgres -c "psql -h /tmp/pgrun -p 5433 -U postgres -d honbu -q -f /tmp/${f}.sql"`);

let pass = 0, fail = 0;
const ok = (n,c,d='') => c ? (pass++,console.log(`  ✓ ${n}`))
                           : (fail++,console.log(`  ✗ ${n} ${d}`));
const throws = async (n,fn,m) => {
  try { await fn(); fail++; console.log(`  ✗ ${n} — did not throw`); }
  catch (e) { (!m || e.message.includes(m))
    ? (pass++, console.log(`  ✓ ${n}`))
    : (fail++, console.log(`  ✗ ${n} — ${e.message}`)); }
};

const DOUG = '33333333-0000-0000-0000-000000000001';
const { rows: [moknz] } = await pool.query(
  `select id from organisation where slug='moknz'`);
const { rows: [wh] } = await pool.query(
  `select id from organisation where slug='whanganui'`);

const types = new PostgresContentTypes(pool);
const entries = new PostgresContentEntries(pool);
const deps = { types, entries, auth: new PostgresAuthorisation(pool),
               clock: new SystemClock() };
const define = new DefineContentType(deps);
const save = new SaveEntry(deps);

const INSTRUCTOR = {
  name:'instructor', label:'Instructor', pluralLabel:'Instructors',
  routePattern: RoutePattern.UNDER_ORGANISATION, schemaType:'Person',
  fields:[
    { name:'title', label:'Name', type:FieldType.TEXT, required:true, sortOrder:1 },
    { name:'grade', label:'Grade', type:FieldType.TEXT, sortOrder:2 },
    { name:'since', label:'Teaching since', type:FieldType.DATE, sortOrder:3 },
    { name:'bio', label:'About', type:FieldType.LONG_TEXT, sortOrder:4 },
  ],
};

console.log('\nTHE SAME USE CASES, WIRED TO POSTGRES');
{
  const out = await define.execute({ actorId: DOUG, organisationId: moknz.id,
    definition: INSTRUCTOR });
  ok('a type is defined nationally', out.created && !!out.type.id);
  ok('with its fields stored as data', out.type.fields.length === 4);
}

console.log('\nTYPES ARE INHERITED DOWN THE TREE');
{
  const seen = await types.byName(wh.id, 'instructor');
  ok('a dojo sees a type defined by national', !!seen);
  ok('without redefining it', seen.organisationId === moknz.id);

  const all = await types.allFor(wh.id);
  ok('and it appears in their list', all.some(t => t.name === 'instructor'));
}

console.log('\nA DOJO CAN OVERRIDE ITS PARENT');
{
  await define.execute({ actorId: DOUG, organisationId: wh.id,
    definition: { ...INSTRUCTOR, label:'Sensei',
      fields:[...INSTRUCTOR.fields,
        { name:'dojoRole', label:'Role here', type:FieldType.TEXT, sortOrder:5 }] } });

  const local = await types.byName(wh.id, 'instructor');
  ok('the nearest definition wins', local.label === 'Sensei');
  ok('with the extra field', local.fields.length === 5);

  const national = await types.byName(moknz.id, 'instructor');
  ok('and national is untouched', national.label === 'Instructor'
    && national.fields.length === 4);
}

console.log('\nENTRIES SAVE AND VALIDATE AGAINST THE REAL TYPE');
{
  const out = await save.execute({ actorId: DOUG, organisationId: wh.id,
    typeName:'instructor',
    values:{ title:'Jane Smith', grade:'3rd dan', since:'2011-03-01',
             dojoRole:'Head instructor' } });
  ok('an entry saves', !!out.entry.id);
  ok('with a slug from the name', out.entry.slug.value === 'jane-smith');
  ok('a revision is kept', !!out.revisionId);

  await throws('a field only the dojo defines is rejected nationally', () =>
    save.execute({ actorId: DOUG, organisationId: moknz.id,
      typeName:'instructor', values:{ title:'X', dojoRole:'Y' } }),
    'not a field');

  await throws('a bad date is caught', () =>
    save.execute({ actorId: DOUG, organisationId: wh.id, typeName:'instructor',
      values:{ title:'Bob', since:'last March' } }), 'must be a date');
}

console.log('\nROUTING COMES FROM THE TYPE');
{
  const type = await types.byName(wh.id, 'instructor');
  ok('nested under the organisation',
    type.pathFor({ slug:'jane-smith', organisationSlug:'whanganui' })
      === '/whanganui/instructors/jane-smith');
}

console.log('\nBREAKING CHANGES COUNT REAL ENTRIES');
{
  const n = await types.countEntries('instructor', moknz.id);
  ok('the count is real', n === 1, n);

  await throws('and a destructive change is refused with it', () =>
    define.execute({ actorId: DOUG, organisationId: wh.id,
      definition: { ...INSTRUCTOR, label:'Sensei',
        fields: INSTRUCTOR.fields.slice(0, 2) } }), 'discards data');
}

console.log('\nREVISIONS ARE CAPPED');
{
  const { rows:[e] } = await pool.query(
    `select id from content_entry limit 1`);
  for (let i = 0; i < 24; i++)
    await entries.saveRevision(e.id, { title:`v${i}` }, DOUG);
  const { rows:[r] } = await pool.query(
    `select count(*)::int n from content_revision where entry_id=$1`, [e.id]);
  ok('twenty kept, the rest dropped', r.n === 20, r.n);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
await pool.end();
process.exit(fail ? 1 : 0);
