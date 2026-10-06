import { builtInFor, builtInYears, yearToOffer, termState, mayEnrol, holidays, inHoliday, termPrice, readMidTerm, problemsWithMidTerm, problemsWithTerm, offersDue } from './domain/terms.mjs';
let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}  ${d}`));

console.log('\nCALENDARS BY COUNTRY');
{
  const nz = builtInFor('nz', 2026);
  ok('New Zealand has four terms for 2026', nz.terms.length === 4 && nz.terms[3].name === 'Term 4');
  ok('with the Ministry\'s dates', nz.terms[1].starts === '2026-04-20' && nz.terms[1].ends === '2026-07-03' && nz.terms[2].starts === '2026-07-20' && nz.terms[3].starts === '2026-10-12');
  ok('and for 2027', builtInFor('NZ', 2027).terms[1].starts === '2027-04-27');
  ok('it says where it came from, and what is approximate', /education\.govt\.nz/.test(nz.source) && /vary by school/.test(nz.note));
  ok('countries set by state are not invented', builtInFor('AU', 2026) === null && builtInFor('US', 2026) === null && builtInFor(null, 2026) === null);
  ok('years known', builtInYears('NZ').join() === '2026,2027' && builtInYears('FR').length === 0);
  ok('every shipped term runs forwards and none overlap', ['2026', '2027'].every((y) => { const t = builtInFor('NZ', Number(y)).terms; return problemsWithTerm(t[0], t).length === 0 && t.every((x, i) => x.starts < x.ends && (i === 0 || t[i - 1].ends < x.starts)); }));
  ok('next year is offered from September', yearToOffer([2026], '2026-09-01') === 2027 && yearToOffer([2026], '2026-03-01') === null && yearToOffer([], '2026-03-01') === 2026);
  ok('and not again once loaded', yearToOffer([2026, 2027], '2026-10-06') === null);
}

console.log('\nWHERE A TERM IS');
{
  const t = { starts: '2026-10-12', ends: '2026-12-18' };
  ok('not open until four weeks before', termState(t, '2026-09-01') === 'upcoming' && termState(t, '2026-09-14') === 'open');
  ok('running', termState(t, '2026-11-01') === 'current');
  ok('finished', termState(t, '2026-12-19') === 'ended');
  ok('the club can set its own opening and closing', termState({ ...t, enrol_opens: '2026-08-01' }, '2026-08-02') === 'open' && termState({ ...t, enrol_closes: '2026-10-20' }, '2026-10-25') === 'closed');
  ok('you can enrol when it is open or running, not before or after', mayEnrol(t, '2026-10-01') && mayEnrol(t, '2026-11-01') && !mayEnrol(t, '2026-08-01') && !mayEnrol(t, '2027-01-01'));
}

console.log('\nHOLIDAYS');
{
  const terms = builtInFor('NZ', 2026).terms;
  const h = holidays(terms);
  ok('three gaps in the year', h.length === 3);
  ok('the April holidays', h[0].from === '2026-04-03' && h[0].to === '2026-04-19' && h[0].after === 'Term 1');
  ok('finds a day in them', inHoliday(terms, '2026-04-10')?.before === 'Term 2' && inHoliday(terms, '2026-05-10') === null);
}

console.log('\nWHAT A CHILD PAYS');
{
  const term = { starts: '2026-10-12', ends: '2026-12-18' };      // 10 weeks
  const p = (today, rule, weekdays = []) => termPrice({ fullCents: 12000, term, today, rule, weekdays });
  ok('the full price from the first day, and before', p('2026-10-12', { mode: 'weeks' }).cents === 12000 && p('2026-10-01', { mode: 'weeks' }).cents === 12000);
  ok('by weeks left', p('2026-10-26', { mode: 'weeks' }).cents === 9600 && /8 of 10 weeks/.test(p('2026-10-26', { mode: 'weeks' }).note));
  ok('a part week counts as a week', p('2026-12-17', { mode: 'weeks' }).cents === 1200);
  ok('by classes left, for the days they train', p('2026-10-26', { mode: 'classes' }, [2, 4]).cents === 9600 && /16 of 20 classes/.test(p('2026-10-26', { mode: 'classes' }, [2, 4]).note));
  ok('classes falls back to weeks when there is no timetable', /weeks/.test(p('2026-10-26', { mode: 'classes' }, []).note));
  ok('a fixed reduced price, never more than full', p('2026-10-26', { mode: 'fixed', fixedCents: 7000 }).cents === 7000 && p('2026-10-26', { mode: 'fixed', fixedCents: 99999 }).cents === 12000);
  ok('full price whenever, if the club says so', p('2026-11-20', { mode: 'full' }).cents === 12000);
  ok('no joining part-way, if the club says so', p('2026-10-26', { mode: 'none' }) === null && p('2026-10-01', { mode: 'none' }).cents === 12000);
  ok('nothing after the term', p('2026-12-19', { mode: 'weeks' }) === null);
  ok('rounded to the nearest five cents', p('2026-10-26', { mode: 'weeks' }).cents % 5 === 0);
  ok('the rule is read from a form', readMidTerm({ mid_term: 'fixed', fixed: '$60' }).fixedCents === 6000 && readMidTerm({ mid_term: 'bogus' }).mode === 'weeks');
  ok('a fixed price needs an amount', problemsWithMidTerm(readMidTerm({ mid_term: 'fixed' })).length === 1);
}

console.log('\nENTERING TERMS BY HAND');
{
  const ok1 = { name: 'Term 1', starts: '2030-02-01', ends: '2030-04-05' };
  ok('a sensible term', problemsWithTerm(ok1).length === 0);
  ok('needs a name', problemsWithTerm({ ...ok1, name: ' ' }).length === 1);
  ok('real dates', problemsWithTerm({ ...ok1, starts: 'soon' }).length === 1);
  ok('not backwards', problemsWithTerm({ ...ok1, ends: '2030-01-01' }).some((p) => /before it starts/.test(p)));
  ok('not a year long', problemsWithTerm({ ...ok1, ends: '2031-01-01' }).some((p) => /longer than any/.test(p)));
  ok('not overlapping another', problemsWithTerm({ ...ok1, starts: '2030-03-01', ends: '2030-05-01' }, [{ id: 'x', starts: '2030-02-01', ends: '2030-04-05' }]).some((p) => /overlaps/.test(p)));
  ok('but may replace itself', problemsWithTerm({ ...ok1, id: 'x' }, [{ id: 'x', starts: '2030-02-01', ends: '2030-04-05' }]).length === 0);
}

console.log('\nWHEN FAMILIES ARE OFFERED THE NEXT TERM');
{
  const terms = builtInFor('NZ', 2026).terms.map((t) => ({ ...t, id: t.number }));
  ok('once the next term is open and before it starts', offersDue(terms, '2026-09-20')?.next.number === 4 && offersDue(terms, '2026-09-20')?.prev.number === 3);
  ok('not before it opens', offersDue(terms, '2026-07-30') === null);
  ok('not once it has started', offersDue(terms, '2026-10-13') === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
