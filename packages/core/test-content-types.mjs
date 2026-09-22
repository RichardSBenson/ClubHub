/**
 * Content types, with no database.
 */

import { DefineContentType } from './application/define-content-type.mjs';
import { SaveEntry } from './application/save-entry.mjs';
import { Refused, NotPermitted } from './application/ports.mjs';
import { ContentType, FieldDefinition, FieldType, RoutePattern, ContentEntry }
  from './domain/content-types.mjs';
import { DomainError } from './domain/values.mjs';
import { InMemoryContentTypes, InMemoryContentEntries, AllowAll, DenyAll,
         FixedClock } from '../infrastructure/memory/repositories.mjs';

let pass = 0, fail = 0;
const ok = (n,c,d='') => c ? (pass++,console.log(`  ✓ ${n}`))
                           : (fail++,console.log(`  ✗ ${n} ${d}`));
const throws = async (n,fn,T,m) => {
  try { await fn(); fail++; console.log(`  ✗ ${n} — did not throw`); }
  catch (e) { (e instanceof T && (!m || e.message.includes(m)))
    ? (pass++, console.log(`  ✓ ${n} — ${e.message.split(';')[0]}`))
    : (fail++, console.log(`  ✗ ${n} — ${e.name}: ${e.message}`)); }
};

const KATA = {
  name: 'kata', label: 'Kata', pluralLabel: 'Kata',
  routePattern: RoutePattern.UNDER_TYPE, titleField: 'title',
  fields: [
    { name:'title', label:'Name', type:FieldType.TEXT, required:true, sortOrder:1 },
    { name:'japanese', label:'Japanese', type:FieldType.TEXT, sortOrder:2 },
    { name:'movements', label:'Movements', type:FieldType.NUMBER,
      min:1, max:200, sortOrder:3 },
    { name:'grade', label:'Introduced at', type:FieldType.CHOICE,
      choices:['10th kyu','9th kyu','8th kyu','7th kyu'], sortOrder:4 },
    { name:'video', label:'Video', type:FieldType.LINK, sortOrder:5 },
    { name:'notes', label:'Notes', type:FieldType.RICH_TEXT, sortOrder:6 },
  ],
};

console.log('\nA FIELD DEFINITION IS ITS OWN VALIDATOR');
{
  const f = new FieldDefinition({ name:'movements', label:'Movements',
    type:FieldType.NUMBER, min:1, max:200 });
  ok('a good value passes', f.check(24).length === 0);
  ok('below the minimum is caught', f.check(0)[0].includes('at least 1'));
  ok('above the maximum is caught', f.check(500)[0].includes('no more than 200'));
  ok('not a number is caught', f.check('lots')[0].includes('must be a number'));
  ok('empty is fine when optional', f.check(null).length === 0);

  const req = new FieldDefinition({ name:'title', type:FieldType.TEXT,
    required:true, label:'Name' });
  ok('empty is not fine when required', req.check('')[0] === 'Name is required');
}

console.log('\nA TYPE REFUSES TO BE BUILT WRONG');
{
  const bad = (def, contains) => {
    try { new ContentType(def); return `did not throw`; }
    catch (e) { return e instanceof DomainError && e.message.includes(contains)
      ? true : e.message; };
  };
  ok('two fields with the same name',
    bad({ ...KATA, fields:[{name:'a',type:'text'},{name:'a',type:'text'}],
      titleField:'a' }, 'both called') === true);
  ok('a title field that does not exist',
    bad({ ...KATA, titleField:'nope' }, 'no such field') === true);
  ok('a choice with no choices',
    bad({ ...KATA, fields:[{name:'title',type:'choice'}] }, 'nothing to choose') === true);
  ok('a reference to nothing',
    bad({ ...KATA, fields:[{name:'title',type:'reference'}] }, 'references nothing') === true);
  ok('a field name that is not a valid key',
    bad({ ...KATA, fields:[{name:'my field',type:'text'}] }, 'becomes a key') === true);
}

console.log('\nROUTING IS CHOSEN, NOT INVENTED');
{
  const kata = new ContentType({ ...KATA, organisationId:'moknz' });
  ok('under its type', kata.pathFor({ slug:'pinan-sono-ichi' })
    === '/kata/pinan-sono-ichi');

  const instructor = new ContentType({ ...KATA, name:'instructor',
    label:'Instructor', pluralLabel:'Instructors',
    routePattern: RoutePattern.UNDER_ORGANISATION, organisationId:'moknz' });
  ok('or under its organisation',
    instructor.pathFor({ slug:'jane-smith', organisationSlug:'whanganui' })
      === '/whanganui/instructors/jane-smith');

  const sponsor = new ContentType({ ...KATA, name:'sponsor',
    routePattern: RoutePattern.NONE, organisationId:'moknz' });
  ok('or nowhere, for things that only appear inside other pages',
    sponsor.pathFor({ slug:'acme' }) === null);
}

const build = (auth = new AllowAll()) => {
  const types = new InMemoryContentTypes();
  const entries = new InMemoryContentEntries();
  return { types, entries,
    define: new DefineContentType({ types, auth }),
    save: new SaveEntry({ types, entries, auth,
      clock: new FixedClock('2026-09-19') }) };
};

console.log('\nA FEDERATION DEFINES ITS OWN TYPES');
{
  const { define } = build();
  const out = await define.execute({ actorId:'a', organisationId:'moknz',
    definition: KATA });
  ok('the type is created', out.created && out.type.name === 'kata');
  ok('with its fields in order',
    out.type.fields.map(f => f.name).join() === 'title,japanese,movements,grade,video,notes');
  ok('no developer required', true);

  await throws('but not by someone without the role', () =>
    new DefineContentType({ types: new InMemoryContentTypes(),
      auth: new DenyAll() }).execute({ actorId:'a', organisationId:'moknz',
        definition: KATA }), NotPermitted);
}

console.log('\nADDING A FIELD IS SAFE; BREAKING ONE IS NAMED');
{
  const { define, types } = build();
  await define.execute({ actorId:'a', organisationId:'moknz', definition: KATA });

  const added = await define.execute({ actorId:'a', organisationId:'moknz',
    definition: { ...KATA, fields:[...KATA.fields,
      { name:'origin', label:'Origin', type:FieldType.TEXT, sortOrder:7 }] } });
  ok('adding a field just works', added.breaking.length === 0
    && added.type.fields.length === 7);

  types.entryCounts.set('kata', 14);

  await throws('removing one is refused', () =>
    define.execute({ actorId:'a', organisationId:'moknz',
      definition: { ...KATA, fields: KATA.fields.slice(0, 3) } }),
    Refused, 'discards data');

  await throws('and says how many entries are affected', () =>
    define.execute({ actorId:'a', organisationId:'moknz',
      definition: { ...KATA, fields: KATA.fields.slice(0, 3) } }),
    Refused, '14 entries use this type');

  await throws('making a field required is refused too', () =>
    define.execute({ actorId:'a', organisationId:'moknz',
      definition: { ...KATA, fields: KATA.fields.map(f =>
        f.name === 'japanese' ? { ...f, required:true } : f) } }),
    Refused, 'leave existing entries invalid');

  await throws('and removing a choice, which orphans entries', () =>
    define.execute({ actorId:'a', organisationId:'moknz',
      definition: { ...KATA, fields: KATA.fields.map(f =>
        f.name === 'grade' ? { ...f, choices:['10th kyu'] } : f) } }),
    Refused, 'orphans entries');

  const forced = await define.execute({ actorId:'a', organisationId:'moknz',
    definition: { ...KATA, fields: KATA.fields.slice(0, 3) },
    acceptBreaking: true });
  // Three fields removed, plus the earlier 'origin' addition being dropped.
  ok('but it can be done deliberately, with every consequence listed',
    forced.breaking.length === 4, `${forced.breaking.length}`);
  ok('with the consequences returned, not hidden',
    forced.affected === 14);
  console.log('      → ' + forced.breaking[0]);
}

console.log('\nENTRIES ARE CHECKED AGAINST THEIR TYPE');
{
  const { define, save } = build();
  await define.execute({ actorId:'a', organisationId:'moknz', definition: KATA });

  const out = await save.execute({ actorId:'a', organisationId:'moknz',
    typeName:'kata', values:{ title:'Pinan Sono Ichi', japanese:'平安初段',
      movements:21, grade:'7th kyu', video:'https://example.nz/v' } });
  ok('a good entry saves', !!out.entry.id);
  ok('with a slug from the title', out.entry.slug.value === 'pinan-sono-ichi');
  ok('as a draft, because saving is not publishing', out.entry.status === 'draft');
  ok('and a revision alongside it', !!out.revisionId);

  await throws('every problem comes back at once', () =>
    save.execute({ actorId:'a', organisationId:'moknz', typeName:'kata',
      values:{ movements: 999, grade:'bogus', video:'not a link' } }),
    Refused, 'required');

  try {
    await save.execute({ actorId:'a', organisationId:'moknz', typeName:'kata',
      values:{ movements: 999, grade:'bogus', video:'not a link' } });
  } catch (e) {
    ok('all four, not just the first', e.reasons.length === 4, e.reasons.length);
    e.reasons.forEach(r => console.log('      → ' + r));
  }

  await throws('a field that is not on the type is rejected', () =>
    save.execute({ actorId:'a', organisationId:'moknz', typeName:'kata',
      values:{ title:'X', colour:'red' } }), Refused, 'not a field');

  await throws('an unknown type is rejected', () =>
    save.execute({ actorId:'a', organisationId:'moknz', typeName:'nope',
      values:{} }), Refused, 'No content type');
}

console.log('\nSLUGS DO NOT FOLLOW THE TITLE AROUND');
{
  const { define, save } = build();
  await define.execute({ actorId:'a', organisationId:'moknz', definition: KATA });
  const first = await save.execute({ actorId:'a', organisationId:'moknz',
    typeName:'kata', values:{ title:'Pinan Sono Ichi' } });

  const renamed = await save.execute({ actorId:'a', entryId:first.entry.id,
    organisationId:'moknz', typeName:'kata',
    values:{ title:'Pinan Shodan' } });
  ok('correcting a title does not move the page',
    renamed.entry.slug.value === 'pinan-sono-ichi');
  ok('the title itself did change',
    renamed.entry.values.title === 'Pinan Shodan');

  await save.execute({ actorId:'a', organisationId:'moknz', typeName:'kata',
    values:{ title:'Taikyoku Sono Ichi' } });
  await throws('two entries cannot share a slug', () =>
    save.execute({ actorId:'a', organisationId:'moknz', typeName:'kata',
      values:{ title:'Pinan Sono Ichi' } }), Refused, 'already uses');
}

console.log('\nA PARTIAL UPDATE IS JUDGED ON THE RESULT');
{
  const { define, save } = build();
  await define.execute({ actorId:'a', organisationId:'moknz', definition: KATA });
  const first = await save.execute({ actorId:'a', organisationId:'moknz',
    typeName:'kata', values:{ title:'Sanchin', movements:20 } });

  const updated = await save.execute({ actorId:'a', entryId:first.entry.id,
    organisationId:'moknz', typeName:'kata', values:{ movements:22 } });
  ok('sending one field does not wipe the others',
    updated.entry.values.title === 'Sanchin' && updated.entry.values.movements === 22);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
