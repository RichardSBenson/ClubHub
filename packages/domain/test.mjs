/**
 * Domain tests. No database, no server, no fixtures loaded from anywhere.
 * These run in about a millisecond, which is the point of the inner circle.
 */
import { Slug, MemberNumber, Grade, Title, Ladder, Organisation, GradingRecord,
         Member, GradingAuthority, EligibilityPolicy, EventVisibilityPolicy,
         AccessPolicy, Qualification, DomainError } from './index.mjs';

let pass=0, fail=0;
const ok=(n,c,d='')=>c?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n} ${d}`));
const throws=(n,fn)=>{ try{ fn(); fail++; console.log(`  ✗ ${n} — did not throw`);}
  catch(e){ e instanceof DomainError ? (pass++,console.log(`  ✓ ${n} — ${e.message}`))
    : (fail++,console.log(`  ✗ ${n} — wrong error: ${e.message}`)); } };

console.log('\nINVALID VALUES CANNOT EXIST');
{
  ok('a slug normalises', new Slug('Whanganui'.toLowerCase()).value === 'whanganui');
  throws('a slug with spaces is refused', () => new Slug('new plymouth'));
  throws('a slug with capitals is refused', () => new Slug('ABOUTUS1'));
  ok('Slug.from makes one from free text',
    Slug.from('New Plymouth Dojo!').value === 'new-plymouth-dojo');
  ok('a member number knows its country',
    new MemberNumber('NZ-0417').countryCode === 'NZ');
  throws('a malformed member number is refused', () => new MemberNumber('417'));
  throws('an unknown organisation type is refused',
    () => new Organisation({ id:'1', name:'x', slug:'x', type:'branch' }));
}

console.log('\nTHE TREE DECIDES ITS OWN CONTAINMENT');
{
  const nat = new Organisation({ id:'n', name:'MOKNZ', slug:'moknz', type:'country' });
  const wh  = new Organisation({ id:'w', name:'Whanganui', slug:'whanganui',
    type:'dojo', ancestry:['n'] });
  const we  = new Organisation({ id:'e', name:'Wellington', slug:'wellington',
    type:'dojo', ancestry:['n'] });
  ok('national contains a dojo', nat.contains(wh));
  ok('a dojo contains itself', wh.contains(wh));
  ok('but not a sibling', !wh.contains(we));
  ok('and not its parent', !wh.contains(nat));
}

console.log('\nCURRENT GRADE IS DERIVED, NOT STORED');
{
  const g = (order,label,extra={}) => new Grade({ id:label, label, order, ...extra });
  const eighth = g(3,'8th kyu'), fourth = g(7,'4th kyu'), third = g(8,'3rd kyu');
  const m = new Member({ id:'p', firstName:'Aroha', lastName:'Nikora',
    dateOfBirth:'2011-08-04', memberNumber:'NZ-0417', gradings:[
      new GradingRecord({ personId:'p', grade:eighth, awardedOn:'2020-06-20', awardedByOrgId:'w' }),
      new GradingRecord({ personId:'p', grade:fourth, awardedOn:'2024-10-19', awardedByOrgId:'n' }),
      new GradingRecord({ personId:'p', grade:third, awardedOn:'2025-01-01',
        awardedByOrgId:'n', result:'fail' }),
    ]});
  ok('the highest passed grade wins', m.currentGrade().label === '4th kyu');
  ok('a failed grading does not count', m.currentGrade().order === 7);
  ok('age is computed on a date, never stored', m.ageOn(new Date('2026-09-18')) === 15);
  ok('and is different the year before', m.ageOn(new Date('2025-09-18')) === 14);
}

console.log('\nTITLES ARE A SEPARATE SCALE');
{
  const m = new Member({ id:'d', firstName:'Doug', lastName:'Holloway',
    gradings:[new GradingRecord({ personId:'d',
      grade:new Grade({ id:'5d', label:'Godan', order:15, isDan:true }),
      awardedOn:'1990-01-01', awardedByOrgId:'n' })],
    titles:[new Title({ id:'h', label:'Hanshi', order:3 }),
            new Title({ id:'k', label:'Kyoshi', order:2 })]});
  ok('the highest title is derived', m.currentTitle().label === 'Hanshi');
  ok('independently of grade', m.currentGrade().label === 'Godan');
}

console.log('\nGRADING AUTHORITY');
{
  const dojo = new Organisation({ id:'w', name:'Whanganui', slug:'whanganui',
    type:'dojo', ancestry:['n'] });
  const nat = new Organisation({ id:'n', name:'MOKNZ', slug:'moknz', type:'country' });
  const grade = (o,l) => new Grade({ id:l, label:l, order:o });
  const examiner = (o) => new Member({ id:'e'+o, firstName:'E', lastName:String(o),
    gradings:[new GradingRecord({ personId:'e', grade:grade(o,'g'),
      awardedOn:'2000-01-01', awardedByOrgId:'n' })]});

  const authority = new GradingAuthority([
    { fromOrder:1, toOrder:7,  awardedByType:'dojo',    minPanelSize:1, minPanelOrder:11 },
    { fromOrder:8, toOrder:10, awardedByType:'country', minPanelSize:2, minPanelOrder:12 },
    { fromOrder:11,toOrder:15, awardedByType:'country', minPanelSize:3, minPanelOrder:14 },
  ]);

  ok('a dojo may award 8th kyu',
    authority.check({ grade:grade(3,'8th kyu'), awardingOrg:dojo,
      panel:[examiner(11)] }).length === 0);

  const wrongLevel = authority.check({ grade:grade(8,'3rd kyu'), awardingOrg:dojo,
    panel:[examiner(14), examiner(14)] });
  ok('but not 3rd kyu', wrongLevel.length === 1);
  console.log('      → ' + wrongLevel[0]);

  const small = authority.check({ grade:grade(11,'Shodan'), awardingOrg:nat,
    panel:[examiner(15)] });
  ok('shodan needs a panel of three', small.some(p => p.includes('panel of 3')));

  const junior = authority.check({ grade:grade(11,'Shodan'), awardingOrg:nat,
    panel:[examiner(15), examiner(15), examiner(12)] });
  ok('and every examiner senior enough',
    junior.some(p => p.includes('order 14 or above')));
  console.log('      → ' + junior[0]);

  ok('all problems are reported at once, not the first',
    authority.check({ grade:grade(11,'Shodan'), awardingOrg:dojo,
      panel:[examiner(12)] }).length === 3);
}

console.log('\nELIGIBILITY REPORTS WHAT IS MISSING');
{
  const ladder = new Ladder([
    new Grade({ id:'a', label:'4th kyu', order:7 }),
    new Grade({ id:'b', label:'3rd kyu', order:8,
      minMonthsAtPrevious:6, minSessions:48, minAge:8 }),
  ]);
  const policy = new EligibilityPolicy({ ladder });
  const at = (order,label,on) => new Member({ id:'p', firstName:'A', lastName:'N',
    dateOfBirth:'2011-08-04', gradings:[new GradingRecord({ personId:'p',
      grade:ladder.at(order), awardedOn:on, awardedByOrgId:'n' })]});

  const ready = policy.assess({ member: at(7,'4th kyu','2024-10-19'),
    sessionsSinceLastGrading: 192, on: new Date('2026-09-18') });
  ok('someone who has done the work is eligible', ready.eligible);
  ok('and the next grade is named', ready.next.label === '3rd kyu');

  const short = policy.assess({ member: at(7,'4th kyu','2026-06-01'),
    sessionsSinceLastGrading: 10, on: new Date('2026-09-18') });
  ok('someone who has not is told exactly what is missing', !short.eligible);
  console.log('      → ' + short.unmet.join('; '));
  ok('both shortfalls named', short.unmet.length === 2);

  const top = policy.assess({ member: at(8,'3rd kyu','2020-01-01'),
    sessionsSinceLastGrading: 999, on: new Date('2026-09-18') });
  ok('the top of the ladder is a state, not an error',
    !top.eligible && top.reason === 'Top of the ladder');
}

console.log('\nEVENT VISIBILITY');
{
  const vis = new EventVisibilityPolicy();
  const nat = new Organisation({ id:'n', name:'MOKNZ', slug:'moknz', type:'country' });
  const wh  = new Organisation({ id:'w', name:'Whanganui', slug:'whanganui',
    type:'dojo', ancestry:['n'] });
  const dan = new Member({ id:'m', firstName:'T', lastName:'W',
    gradings:[new GradingRecord({ personId:'m',
      grade:new Grade({ id:'2d', label:'Nidan', order:12 }),
      awardedOn:'2020-01-01', awardedByOrgId:'n' })]});
  const kyu = new Member({ id:'k', firstName:'A', lastName:'N',
    gradings:[new GradingRecord({ personId:'k',
      grade:new Grade({ id:'4k', label:'4th kyu', order:7 }),
      awardedOn:'2024-01-01', awardedByOrgId:'n' })]});

  const grading = { organisationId:'n', visibility:'public', publishDown:true };
  const seminar = { organisationId:'n', visibility:'by_grade', publishDown:true,
    minGradeOrder:11 };
  const fightNight = { organisationId:'w', visibility:'own_org', publishDown:false };

  ok('the public sees a national grading on a dojo page',
    vis.canSee({ event:grading, viewingOrg:wh }));
  ok('the public does not see a dojo-only fight night',
    !vis.canSee({ event:fightNight, viewingOrg:wh }));
  ok('a member of that dojo does',
    vis.canSee({ event:fightNight, viewingOrg:wh, viewer:{ isMember:true } }));
  ok('a member of another dojo does not',
    !vis.canSee({ event:fightNight, viewingOrg:
      new Organisation({ id:'e', name:'W', slug:'wellington', type:'dojo', ancestry:['n'] }),
      viewer:{ isMember:true } }));
  ok('a 4th kyu does not see a dan seminar',
    !vis.canSee({ event:seminar, viewingOrg:wh, viewer:{ isMember:true, member:kyu } }));
  ok('a nidan does',
    vis.canSee({ event:seminar, viewingOrg:wh, viewer:{ isMember:true, member:dan } }));

  const blocked = vis.blockedFrom({ event:seminar, member:kyu, isMember:true });
  ok('and entry is blocked with a reason', blocked.length === 1);
  console.log('      → ' + blocked[0]);
}

console.log('\nACCESS IS DOWN-BRANCH ONLY');
{
  const nat = new Organisation({ id:'n', name:'MOKNZ', slug:'moknz', type:'country' });
  const wh  = new Organisation({ id:'w', name:'Whanganui', slug:'whanganui',
    type:'dojo', ancestry:['n'] });
  const we  = new Organisation({ id:'e', name:'Wellington', slug:'wellington',
    type:'dojo', ancestry:['n'] });

  const doug = new AccessPolicy([{ role:'owner', organisation:nat }]);
  const tane = new AccessPolicy([{ role:'administrator', organisation:we }]);

  ok('national owner manages a dojo', doug.canManage(wh));
  ok('dojo admin manages their own', tane.canManage(we));
  ok('but not a sibling', !tane.canManage(wh));
  ok('and not upward', !tane.canManage(nat));
  ok('an instructor cannot manage', 
    !new AccessPolicy([{ role:'instructor', organisation:we }]).canManage(we));
  ok('but can teach',
    new AccessPolicy([{ role:'instructor', organisation:we }]).canTeach(we));
}

console.log('\nQUALIFICATIONS LAPSE');
{
  const vet = new Qualification({ id:'v', code:'police-vet', label:'Police vetting',
    category:'safeguarding', validMonths:36, requiredFor:['instruct'] });
  const panel = new Qualification({ id:'p', code:'panel', label:'Examiner',
    validMonths:null });

  const exp = vet.expiryFor('2025-03-01');
  ok('expiry is computed from the validity period',
    exp.toISOString().slice(0,7) === '2028-03');
  ok('a permanent qualification has none', panel.expiryFor('2000-01-01') === null);
  ok('and never expires',
    panel.statusOn('2000-01-01', null, new Date('2030-01-01')) === 'permanent');
  ok('a lapsed one reads expired',
    vet.statusOn('2021-05-01', vet.expiryFor('2021-05-01'), new Date('2026-09-18'))
      === 'expired');
  ok('and one due soon reads expiring',
    vet.statusOn('2023-11-01', vet.expiryFor('2023-11-01'), new Date('2026-09-18'))
      === 'expiring');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail?1:0);
