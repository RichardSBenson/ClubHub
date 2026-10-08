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
  // MOKNZ confers all of its titles from grade: Shihan, Renshi, Kyoshi and
  // Hanshi ARE the 5th to 8th dan grades, so holding the grade is holding the
  // title. That is this federation's choice, not the platform's — the awarded
  // case is proved further down with a federation that works the other way.
  ok('Doug is Hanshi because he holds 8th dan, with nothing awarded',
    doug.some(t => t.label==='Hanshi' && t.how==='conferred'));
  ok('and nobody had to award it to him',
    !doug.some(t => t.how === 'awarded'));

  const tane = await q(`select label, how from person_title pt
    join person p on p.id=pt.person_id where p.display_number='NZ-0288'`);
  ok('Tane at nidan is Senpai, not Sensei',
    tane.some(t=>t.label==='Senpai') && !tane.some(t=>t.label==='Sensei'));
}

console.log('\nANOTHER FEDERATION\'S TITLES DO NOT LEAK');
{
  // Two federations in one database, both with conferred titles on the same grade numbers.
  const { rows:[other] } = await pool.query(`
    insert into organisation (parent_id,type,name,slug,path,country_code)
    values (null,'country','Leak Test Taekwondo','leak-tkd','leak_tkd','NZ') returning id`);
  await pool.query(`insert into title (organisation_id,label,rank_order,min_grade_order,max_grade_order,conferred_by_rank)
    values ($1,'Sabeom',2,11,20,true)`,[other.id]);
  const labels = await q(`select label from person_title pt join person p on p.id=pt.person_id where p.display_number='NZ-0001'`);
  ok('a MOKNZ 8th dan holds no title from the other federation', !labels.some(t => t.label==='Sabeom'));
  ok('and still holds their own', labels.some(t => t.label==='Hanshi'));
  const cur = await q(`select label from person_current_title pt join person p on p.id=pt.person_id where p.display_number='NZ-0001'`);
  ok('the title they are addressed by is their own', cur[0]?.label==='Hanshi');
  await pool.query(`delete from title where organisation_id=$1`,[other.id]);
  await pool.query(`delete from organisation where id=$1`,[other.id]);
}

console.log('\nCONFERRED TITLES MOVE WITH THE GRADE');
{
  const { rows:[aroha] } = await pool.query(
    `select id from person where display_number='NZ-0417'`);
  const before = await q(`select label from person_title where person_id=$1`,[aroha.id]);
  ok('a 4th kyu holds none', before.length === 0);

  // Grade her to shodan — rank 11, where Senpai begins in this federation.
  const { rows:[g] } = await pool.query(
    `select id from grade where label='1st dan' and organisation_id=$1`,[moknz.id]);
  const { rows:[rec] } = await pool.query(`
    insert into grading_record (person_id, grade_id, awarded_on, awarded_by_org)
    values ($1,$2,'2026-09-19',$3) returning id`,[aroha.id,g.id,moknz.id]);

  const after = await q(`select label, how from person_title where person_id=$1`,[aroha.id]);
  ok('grading to shodan makes her Senpai, with no separate record',
    after.length===1 && after[0].label==='Senpai' && after[0].how==='conferred');
  console.log(`      → 4th kyu: nothing  →  1st dan: ${after[0].label}`);

  await pool.query('delete from grading_record where id=$1',[rec.id]);
  ok('and it goes again if the grading is reversed',
    (await q(`select 1 from person_title where person_id=$1`,[aroha.id])).length===0);
}

console.log('\nAWARDED BEATS CONFERRED WHEN ADDRESSING SOMEONE');
{
  const [doug] = await q(`select ct.label, ct.how from person_current_title ct
    join person p on p.id=ct.person_id where p.display_number='NZ-0001'`);
  ok('Doug is addressed by the most senior title he holds',
    doug.label==='Hanshi');

  // The other shape, which MOKNZ does not use and kendo, iaido and BJJ do:
  // a title awarded to a person, independent of grade. Built here rather than
  // relying on a seed, so the capability is proved wherever this runs.
  const { rows:[fed] } = await pool.query(`
    insert into organisation (parent_id,type,name,slug,path,country_code)
    values (null,'country','Awarded Titles Test','awarded-test','awarded_test','NZ')
    returning id`);
  const { rows:[grade] } = await pool.query(`
    insert into grade (organisation_id,label,rank_order,is_dan)
    values ($1,'Black',5,true) returning id`,[fed.id]);
  const { rows:[title] } = await pool.query(`
    insert into title (organisation_id,label,rank_order,min_grade_order,
                       conferred_by_rank,address_as)
    values ($1,'Professor',1,5,false,'Professor') returning id`,[fed.id]);
  const { rows:[a] } = await pool.query(`
    insert into person (display_number,first_name,last_name)
    values ('AT-1','Awarded','One') returning id`);
  const { rows:[b] } = await pool.query(`
    insert into person (display_number,first_name,last_name)
    values ('AT-2','Not','Awarded') returning id`);
  for (const id of [a.id, b.id]) {
    await pool.query(`insert into grading_record (person_id,grade_id,awarded_on,awarded_by_org)
      values ($1,$2,'2020-01-01',$3)`,[id,grade.id,fed.id]);
  }
  await pool.query(`insert into title_award (person_id,title_id,awarded_on,awarded_by_org)
    values ($1,$2,'2021-01-01',$3)`,[a.id,title.id,fed.id]);

  const holders = await q(`select p.display_number, pt.how from person_title pt
    join person p on p.id=pt.person_id where pt.title_id=$1`,[title.id]);
  ok('a title can be awarded rather than conferred',
    holders.length===1 && holders[0].display_number==='AT-1' && holders[0].how==='awarded');
  ok('and the same grade without the award does not carry it',
    !holders.some(h => h.display_number==='AT-2'));
  console.log('      → both hold Black; only one is Professor');

  await pool.query(`delete from title_award where title_id=$1`,[title.id]);
  await pool.query(`delete from grading_record where grade_id=$1`,[grade.id]);
  await pool.query(`delete from person where display_number in ('AT-1','AT-2')`);
  await pool.query(`delete from organisation where id=$1`,[fed.id]);
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
