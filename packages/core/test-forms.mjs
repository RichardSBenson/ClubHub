import { cleanField, problemsWithForm, problemsWithPublishing, readAnswers, standingOn, expiryFor, appliesTo, isMinor,
         problemsWithSignature, STARTERS } from './domain/forms.mjs';
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : (fail++, console.log('  ✗', n)); };
const ids = () => { let i = 0; return () => `f${++i}`; };

const agree = cleanField({ type: 'agree', label: 'I accept the risk' }, ids());
ok('a statement to agree to is always required', agree.required === true && agree.type === 'agree');
ok('a question with no wording is dropped', cleanField({ type: 'text', label: '  ' }) === null);
ok('an unknown type becomes a short answer', cleanField({ type: 'nonsense', label: 'x' }).type === 'text');
const choice = cleanField({ type: 'choice', label: 'Pick', options: 'A\nB\nA\n  \nC' }, ids());
ok('choices are tidied: blanks and repeats go', JSON.stringify(choice.options) === '["A","B","C"]');
ok('an ordinary question is optional unless ticked required', cleanField({ type: 'text', label: 'x' }).required === false && cleanField({ type: 'text', label: 'x', required: 'on' }).required === true);

ok('a form needs a name', problemsWithForm({ title: ' ', fields: [] }).length === 1);
ok('a choice with one option is refused', problemsWithForm({ title: 'T', fields: [{ id: 'a', type: 'choice', label: 'L', options: ['x'] }] }).some((p) => /two choices/.test(p)));
ok('renewal must be a sensible number of months', problemsWithForm({ title: 'T', renewMonths: 0, fields: [] }).length === 1 && problemsWithForm({ title: 'T', renewMonths: 12, fields: [] }).length === 0);
ok('an empty form cannot be published', problemsWithPublishing({ title: 'T', fields: [] }).some((p) => /at least one question/.test(p)));
ok('too many questions are refused', problemsWithForm({ title: 'T', fields: Array.from({ length: 41 }, (_, i) => ({ id: `x${i}`, type: 'text', label: 'q', options: [] })) }).some((p) => /up to 40/.test(p)));

const fields = [
  agree,
  { id: 'n', type: 'text', label: 'Name of doctor', required: true, options: [] },
  { id: 'c', type: 'choice', label: 'Photos?', required: true, options: ['Yes', 'No'] },
  { id: 'k', type: 'checkboxes', label: 'Where', required: false, options: ['Web', 'Facebook'] },
  { id: 'd', type: 'date', label: 'Injury date', required: false, options: [] },
];
let r = readAnswers(fields, {});
ok('required questions not answered are named', r.problems.length === 3 && r.problems.some((p) => /I accept the risk/.test(p)) && r.problems.some((p) => /Name of doctor/.test(p)));
r = readAnswers(fields, { [`q_${agree.id}`]: 'on', q_n: ' Dr Who ', q_c: 'Maybe' });
ok('a choice must be one of the choices', r.problems.length === 1 && /choose one of the options/.test(r.problems[0]));
r = readAnswers(fields, { [`q_${agree.id}`]: 'on', q_n: 'Dr Who', q_c: 'Yes', q_k_1: 'on', q_d: '2025-02-30x' });
ok('a bad date is refused', r.problems.length === 1 && /give a date/.test(r.problems[0]));
r = readAnswers(fields, { [`q_${agree.id}`]: 'on', q_n: 'Dr Who', q_c: 'Yes', q_k_1: 'on', q_d: '2025-02-10' });
ok('good answers are kept, trimmed, with ticked boxes by name', r.problems.length === 0 && r.answers.n === 'Dr Who' && JSON.stringify(r.answers.k) === '["Facebook"]' && r.answers.d === '2025-02-10' && r.answers[agree.id] === true);
r = readAnswers([{ id: 'x', type: 'longtext', label: 'L', required: false, options: [] }], { q_x: 'a'.repeat(9000) });
ok('a very long answer is cut', r.answers.x.length === 4000);

const form = { version: 2, renew_months: 12, audience: 'all' };
ok('no answer is missing', standingOn(form, null, '2026-10-07') === 'missing');
ok('an answer to the current version is current', standingOn(form, { form_version: 2, expires_on: '2027-10-07' }, '2026-10-07') === 'current');
ok('an answer to an older version counts as missing', standingOn(form, { form_version: 1, expires_on: '2027-10-07' }, '2026-10-07') === 'missing');
ok('an answer past its date is expired', standingOn(form, { form_version: 2, expires_on: '2026-10-06' }, '2026-10-07') === 'expired');
ok('a form that never renews never expires', standingOn({ version: 1 }, { form_version: 1, expires_on: null }, '2030-01-01') === 'current');
ok('a withdrawn answer is missing', standingOn(form, { form_version: 2, withdrawn_at: '2026-01-01' }, '2026-10-07') === 'missing');
ok('renewal is that many months on', expiryFor({ renew_months: 12 }, '2026-10-07') === '2027-10-07' && expiryFor({ renew_months: null }, '2026-10-07') === null);

ok('under 18 is a minor, on the birthday they are not', isMinor('2010-10-08', '2026-10-07') && !isMinor('2008-10-07', '2026-10-07') && !isMinor(null, '2026-10-07'));
ok('juniors-only forms apply to children', appliesTo({ audience: 'juniors' }, { dob: '2015-01-01' }, '2026-10-07') && !appliesTo({ audience: 'juniors' }, { dob: '1990-01-01' }, '2026-10-07'));
ok('seniors-only forms apply to adults', appliesTo({ audience: 'seniors' }, { dob: '1990-01-01' }, '2026-10-07') && !appliesTo({ audience: 'seniors' }, { dob: '2015-01-01' }, '2026-10-07'));
ok('a signature needs a name', problemsWithSignature('A').length === 1 && problemsWithSignature('Aroha Nikora').length === 0);

for (const [k, t] of Object.entries(STARTERS)) {
  const gen = ids(); const fs = t.fields.map((f) => cleanField(f, gen));
  ok(`the ${k} starter is a complete, publishable form`, fs.every(Boolean) && problemsWithPublishing({ ...t, fields: fs }).length === 0);
}
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
