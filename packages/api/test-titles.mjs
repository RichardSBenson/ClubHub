import { pool } from '../infrastructure/postgres/pool.mjs';
let pass=0, fail=0;
const ok=(n,c,d='')=>c?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n} ${d}`));
const q=async(s,p=[])=>(await pool.query(s,p)).rows;
const { rows:[moknz] } = await pool.query(`select id from organisation where slug='moknz'`);

console.log('\nSOME TITLES ARE CONFERRED BY RANK');
{
  const doug = await q(`select label, how from person_title pt
    join person p on p.id=pt.person_id where p.display_number='NZ-0001'
    order by pt.rank_order`);
  ok('Doug is Shihan without anyone awarding it',
    doug.some(t => t.label==='Shihan' && t.how==='conferred'));
  ok('and Hanshi because it was awarded',
    doug.some(t => t.label==='Hanshi' && t.how==='awarded'));
  ok('holding both at once', doug.length === 2);

  const tane = await q(`select label, how from person_title pt
    join person p on p.id=pt.person_id where p.display_number='NZ-0288'`);
  ok('Tane at nidan is Sensei, not Shihan',
    tane.some(t=>t.label==='Sensei') && !tane.some(t=>t.label==='Shihan'));
}

console.log('\nCONFERRED TITLES MOVE WITH THE GRADE');
{
  const { rows:[aroha] } = await pool.query(
    `select id from person where display_number='NZ-0417'`);
  const before = await q(`select label from person_title where person_id=$1`,[aroha.id]);
  ok('a 4th kyu holds none', before.length === 0);

  // Grade her to 3rd kyu — rank 8, where Senpai begins.
  const { rows:[g] } = await pool.query(
    `select id from grade where label='3rd kyu' and organisation_id=$1`,[moknz.id]);
  const { rows:[rec] } = await pool.query(`
    insert into grading_record (person_id, grade_id, awarded_on, awarded_by_org)
    values ($1,$2,'2026-09-19',$3) returning id`,[aroha.id,g.id,moknz.id]);

  const after = await q(`select label, how from person_title where person_id=$1`,[aroha.id]);
  ok('grading to 3rd kyu makes her Senpai, with no separate record',
    after.length===1 && after[0].label==='Senpai' && after[0].how==='conferred');
  console.log(`      → 4th kyu: nothing  →  3rd kyu: ${after[0].label}`);

  await pool.query('delete from grading_record where id=$1',[rec.id]);
  ok('and it goes again if the grading is reversed',
    (await q(`select 1 from person_title where person_id=$1`,[aroha.id])).length===0);
}

console.log('\nAWARDED BEATS CONFERRED WHEN ADDRESSING SOMEONE');
{
  const [doug] = await q(`select ct.label, ct.how from person_current_title ct
    join person p on p.id=ct.person_id where p.display_number='NZ-0001'`);
  ok('Doug is addressed as Hanshi, not Shihan',
    doug.label==='Hanshi' && doug.how==='awarded');
}

console.log('\nTHE VOCABULARY IS NOT IN THE CODE');
{
  // A Korean art, defined entirely as data.
  const { rows:[ttnz] } = await pool.query(`
    insert into organisation (parent_id,type,name,slug,path,country_code)
    select id,'country','Test Taekwondo NZ','ttnz','ttnz','NZ'
    from organisation where slug='moknz' limit 1 returning id`);
  for (const [i,label] of ['9th geup','1st geup','1st dan','4th dan'].entries())
    await pool.query(`insert into grade (organisation_id,label,rank_order,is_dan)
      values ($1,$2,$3,$4)`,[ttnz.id,label,i+1,label.includes('dan')]);
  for (const [label,min,max,conf] of [
      ['Kyosa',3,3,true], ['Sabeom',4,null,true], ['Kwanjang',4,null,false]])
    await pool.query(`insert into title (organisation_id,label,rank_order,
      min_grade_order,max_grade_order,conferred_by_rank)
      values ($1,$2,$3,$4,$5,$6)`,
      [ttnz.id,label,['Kyosa','Sabeom','Kwanjang'].indexOf(label)+1,min,max,conf]);

  const titles = await q(`select label, conferred_by_rank from title
    where organisation_id=$1 order by rank_order`,[ttnz.id]);
  ok('a Korean art defines its own titles with no code change',
    titles.map(t=>t.label).join() === 'Kyosa,Sabeom,Kwanjang');
  ok('choosing for itself which are conferred and which awarded',
    titles[0].conferred_by_rank && !titles[2].conferred_by_rank);
  console.log('      → ' + titles.map(t =>
    `${t.label} (${t.conferred_by_rank?'conferred':'awarded'})`).join(', '));

  await pool.query('delete from organisation where id=$1',[ttnz.id]);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
await pool.end();
process.exit(fail?1:0);
