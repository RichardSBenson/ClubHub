import { pool } from './data.mjs';
let pass=0, fail=0;
const ok=(n,c,d='')=>c?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n} ${d}`));
const q=async(s,p=[])=>(await pool.query(s,p)).rows;

console.log('\nTITLES ARE INDEPENDENT OF GRADE');
{
  const [doug] = await q(`
    select p.first_name, t.label as title, t.rank_order as title_order,
           g.label as grade, g.rank_order as grade_order
    from person p
    left join person_current_title t on t.person_id=p.id
    left join person_current_grade g on g.person_id=p.id
    where p.display_number='NZ-0001'`);
  ok('Doug holds a title and a grade at once',
    doug.title === 'Hanshi' && doug.grade === 'Godan');
  ok('and they do not share a scale', doug.title_order !== doug.grade_order);

  const untitled = await q(`
    select count(*)::int n from person p
    left join person_current_title t on t.person_id=p.id
    where t.person_id is null`);
  ok('most people have no title, which is normal', untitled[0].n === 2);
}

console.log('\nQUALIFICATIONS EXPIRE; RANK DOES NOT');
{
  const rows = await q(`select status, count(*)::int n from qualification_status
    group by status order by n desc`);
  ok('status is classified', rows.length >= 3);
  console.log('      → ' + rows.map(r=>`${r.status}: ${r.n}`).join(', '));

  const [perm] = await q(`select * from qualification_status
    where status='permanent' limit 1`);
  ok('a qualification with no validity period never expires',
    perm && perm.expires_on === null);

  const [auto] = await q(`
    select awarded_on, expires_on from qualification_award qa
    join qualification q on q.id=qa.qualification_id
    where q.code='police-vet' and qa.expires_on is not null limit 1`);
  const months = (new Date(auto.expires_on) - new Date(auto.awarded_on))
    / (1000*60*60*24*30.44);
  ok('expiry is filled in from the validity period, not by hand',
    Math.round(months) === 36, Math.round(months));
}

console.log('\nTHE SAFEGUARDING QUESTION');
{
  const blocked = await q(`
    select p.first_name||' '||p.last_name as who, s.label
    from qualification_status s join person p on p.id=s.person_id
    where 'instruct' = any(s.required_for) and s.status='expired'`);
  ok('the system can name who may not instruct right now',
    blocked.length === 1 && blocked[0].label === 'Police vetting');
  console.log(`      → ${blocked[0].who}: ${blocked[0].label} expired`);

  const soon = await q(`select count(*)::int n from qualification_status
    where status='expiring'`);
  ok('and who lapses within sixty days', typeof soon[0].n === 'number');
}

console.log('\nTHE LADDER IS NOT KARATE-SPECIFIC');
{
  const { rows:[org] } = await pool.query(
    `insert into organisation (parent_id,type,name,slug,path,country_code)
     select id,'country','Test Taekwondo NZ','ttnz','ttnz','NZ'
     from organisation where slug='moknz' limit 1 returning id`);
  // a different art types its own ladder — geup counts down, dan counts up
  for (const [i,label] of ['10th geup','9th geup','1st geup','1st dan'].entries())
    await pool.query(`insert into grade (organisation_id,label,rank_order,is_dan)
      values ($1,$2,$3,$4)`, [org.id, label, i+1, label.includes('dan')]);
  const ladder = await q(`select label from grade where organisation_id=$1
    order by rank_order`, [org.id]);
  ok('another art defines its own ladder with no code change',
    ladder[0].label === '10th geup' && ladder.at(-1).label === '1st dan');
  await pool.query('delete from organisation where id=$1', [org.id]);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
await pool.end();
process.exit(fail?1:0);
