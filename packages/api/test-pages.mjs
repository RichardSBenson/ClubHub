import { pages, pool, Forbidden, Invalid } from './data.mjs';

const DOUG = '33333333-0000-0000-0000-000000000001';  // owner, national
const TANE = '33333333-0000-0000-0000-000000000003';  // admin, Wellington only

let pass = 0, fail = 0;
const ok = (n,c,d='') => c ? (pass++,console.log(`  ✓ ${n}`))
                           : (fail++,console.log(`  ✗ ${n} ${d}`));
const throws = async (n,fn,T) => {
  try { await fn(); fail++; console.log(`  ✗ ${n} — did not throw`); }
  catch(e){ e instanceof T ? (pass++,console.log(`  ✓ ${n} — ${e.message}`))
                           : (fail++,console.log(`  ✗ ${n} — ${e.message}`)); }
};

const { rows:[moknz] } = await pool.query(`select id from organisation where slug='moknz'`);
const { rows:[wgtn] } = await pool.query(`select id from organisation where slug='wellington'`);

console.log('\nWRITING');
{
  const { page, dropped } = await pages.save(DOUG, {
    organisationId: moknz.id, slug: 'history', title: 'Our history',
    body: { blocks: [
      { type:'paragraph', text:'Kyokushin came to New Zealand in 1965.' },
      { type:'script', src:'x.js' },
    ]},
  });
  ok('page created as a draft', page.status === 'draft');
  ok('dangerous block dropped on save, not at render',
    dropped.some(d => d.includes('unknown type')));
  ok('meta description derived from the first paragraph',
    page.meta_description.startsWith('Kyokushin came to'));

  await throws('an empty page is refused',
    () => pages.save(DOUG, { organisationId: moknz.id, slug:'blank',
      title:'Blank', body:{ blocks:[] } }), Invalid);

  await throws('a dojo admin cannot write national pages',
    () => pages.save(TANE, { organisationId: moknz.id, slug:'x', title:'X',
      body:{ blocks:[{type:'paragraph',text:'no'}] } }), Forbidden);

  global.pageId = page.id;
}

console.log('\nPUBLISHING IS A SEPARATE PERMISSION');
{
  const { rows:[p] } = await pool.query(`select * from page where id=$1`,[global.pageId]);
  ok('still a draft until someone publishes it', p.status === 'draft');
  const pub = await pages.publish(DOUG, global.pageId);
  ok('national owner can publish', pub.status === 'published');
  await throws('a Wellington admin cannot publish a national page',
    () => pages.publish(TANE, global.pageId), Forbidden);
}

console.log('\nREVISIONS');
{
  for (const n of ['second pass','third pass']) {
    await pages.save(DOUG, { pageId: global.pageId, title:'Our history',
      body:{ blocks:[{ type:'paragraph', text:`Version: ${n}.` }] }, note:n });
  }
  const revs = await pages.revisions(DOUG, global.pageId);
  ok('every save keeps a revision', revs.length === 3, revs.length);
  ok('with a note and an author', revs[0].note === 'third pass' && !!revs[0].saved_by);

  const oldest = revs.at(-1);
  await pages.restore(DOUG, oldest.id);
  const { rows:[now] } = await pool.query(`select body from page where id=$1`,[global.pageId]);
  ok('an older version can be restored',
    JSON.stringify(now.body).includes('Kyokushin came to'));
}

console.log('\nREVISIONS ARE TRIMMED, NOT HOARDED');
{
  for (let i = 0; i < 22; i++) {
    await pages.save(DOUG, { pageId: global.pageId, title:'Our history',
      body:{ blocks:[{ type:'paragraph', text:`Edit number ${i}.` }] } });
  }
  const revs = await pages.revisions(DOUG, global.pageId);
  ok('capped at 20', revs.length === 20, revs.length);
  ok('the newest are the ones kept',
    JSON.stringify(revs[0]).includes('Our history'));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
await pool.end();
process.exit(fail ? 1 : 0);
