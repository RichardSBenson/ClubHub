import { readGrowth, readGrowthForm, problemsWithGrowth, rewardText, problemsWithTrialSignup, readTrialSignup, trialEnds, daysLeft, ageOn,
  trialsDue, newCode, normaliseCode, referralVerdict, referralQualifies, rewardsFor, CODE_LENGTH } from './domain/growth.mjs';
let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}  ${d}`));

console.log('\nWHAT A CLUB HAS CHOSEN');
{
  const g = readGrowth({});
  ok('nothing is on until the club turns it on', !g.trial.enabled && !g.referral.enabled);
  ok('a month, adults, by default', g.trial.days === 30 && g.trial.minAge === 18);
  const w = readGrowth({ trial: { enabled: true, days: '9000', minAge: 'x' }, referral: { enabled: true, minClasses: -4, maxPerYear: 0 } });
  ok('silly numbers are pulled back into range', w.trial.days === 90 && w.trial.minAge === 18 && w.referral.minClasses === 0 && w.referral.maxPerYear === 1);
  ok('an unknown reward kind falls back', readGrowth({ referral: { referrer: { kind: 'unicorn' } } }).referral.referrer.kind === 'free_weeks');
  const f = readGrowthForm({ trial_enabled: '1', trial_days: '14', referral_enabled: '1', min_classes: '3', max_per_year: '4',
    referrer_kind: 'credit', referrer_amount: '$25.50', referred_kind: 'merchandise', referred_note: 'A T-shirt' });
  ok('the form is read the way it is typed', f.trial.days === 14 && f.referral.referrer.cents === 2550 && f.referral.referred.note === 'A T-shirt');
  ok('money is only kept for money rewards', readGrowth({ referral: { referrer: { kind: 'free_weeks', weeks: 2, cents: 999 } } }).referral.referrer.cents === 0);
  ok('referrals need the trial', problemsWithGrowth(readGrowth({ referral: { enabled: true } })).some((p) => /turn the trial on/.test(p)));
  ok('a credit needs an amount', problemsWithGrowth(readGrowth({ trial: { enabled: true }, referral: { enabled: true, referrer: { kind: 'credit' } } })).some((p) => /how much/.test(p)));
  ok('a custom reward needs words', problemsWithGrowth(readGrowth({ trial: { enabled: true }, referral: { enabled: true, referrer: { kind: 'custom' } } })).some((p) => /what/.test(p)));
  ok('a sensible setting has no problems', problemsWithGrowth(readGrowth({ trial: { enabled: true }, referral: { enabled: true } })).length === 0);
  ok('says rewards in words', rewardText({ kind: 'free_weeks', weeks: 1 }) === '1 free week' && rewardText({ kind: 'free_weeks', weeks: 4 }) === '4 free weeks'
    && rewardText({ kind: 'credit', cents: 2000 }) === '$20 account credit' && rewardText({ kind: 'none' }) === '' && rewardText({ kind: 'custom', note: 'A drink' }) === 'A drink');
}

console.log('\nSTARTING A TRIAL');
{
  const today = '2026-10-06';
  const good = readTrialSignup({ firstName: ' Ana ', lastName: 'Lee', email: 'ANA@Example.nz', phone: '021 555 1234', dateOfBirth: '1990-05-05',
    emergencyName: 'Sam', emergencyPhone: '021 555 9999', accepted: '1', code: 'ab-c 123' });
  ok('reads and tidies the form', good.firstName === 'Ana' && good.email === 'ana@example.nz' && good.code === 'ABC123' && good.accepted);
  ok('a complete form is fine', problemsWithTrialSignup(good, { today }).length === 0);
  ok('the trial ends the right day', trialEnds(today, 30) === '2026-11-05' && daysLeft('2026-11-05', today) === 30);
  ok('age counts birthdays', ageOn('2008-10-07', today) === 17 && ageOn('2008-10-06', today) === 18);
  ok('under the minimum age is turned away kindly', problemsWithTrialSignup({ ...good, dateOfBirth: '2010-01-01' }, { today }).some((p) => /aged 18 and over/.test(p)));
  ok('a made-up date is refused', problemsWithTrialSignup({ ...good, dateOfBirth: '1990-02-31' }, { today }).some((p) => /date of birth/.test(p)));
  ok('a future birthday is refused', problemsWithTrialSignup({ ...good, dateOfBirth: '2030-01-01' }, { today }).some((p) => /date of birth/.test(p)));
  ok('needs a mobile', problemsWithTrialSignup({ ...good, phone: '12' }, { today }).some((p) => /mobile/.test(p)));
  ok('needs an emergency contact', problemsWithTrialSignup({ ...good, emergencyPhone: '' }, { today }).some((p) => /emergency/.test(p)));
  ok('needs the waiver', problemsWithTrialSignup({ ...good, accepted: false }, { today }).some((p) => /waiver/.test(p)));
  ok('needs a real email', problemsWithTrialSignup({ ...good, email: 'nope' }, { today }).some((p) => /email/.test(p)));
  ok('a club can ask for older', problemsWithTrialSignup({ ...good, dateOfBirth: '2006-01-01' }, { today, minAge: 21 }).length === 1);
}

console.log('\nWHO IS EMAILED WHEN');
{
  const row = (id, ends, extra = {}) => ({ id, ends, status: 'trialling', sent7: false, sent2: false, ...extra });
  const d = trialsDue([row(1, '2026-10-12'), row(2, '2026-10-07'), row(3, '2026-10-05'), row(4, '2026-11-30'),
    row(5, '2026-10-12', { sent7: true }), row(6, '2026-10-07', { sent2: true }), row(7, '2026-10-05', { status: 'converted' })], '2026-10-06');
  ok('a week to go', d.week.map((r) => r.id).join() === '1');
  ok('the last days', d.lastDays.map((r) => r.id).join() === '2');
  ok('ended', d.ended.map((r) => r.id).join() === '3');
  ok('nothing yet for a long trial, and nobody twice', ![...d.week, ...d.lastDays, ...d.ended].some((r) => [4, 5, 6, 7].includes(r.id)));
  ok('a trial that is joined is left alone even if its date has passed', !d.ended.some((r) => r.id === 7));
}

console.log('\nREFERRALS');
{
  const on = readGrowth({ trial: { enabled: true }, referral: { enabled: true, minClasses: 3, maxPerYear: 2 } });
  const referrer = { active: true, email: 'mum@example.nz', phone: '021 555 1111' };
  ok('a code', newCode().length === CODE_LENGTH && !/[01OIL]/.test(newCode(() => 0.5)) && normaliseCode(' ab-12 cd ') === 'AB12CD');
  ok('codes differ', new Set(Array.from({ length: 50 }, () => newCode())).size > 45);
  ok('counts when everything is in order', referralVerdict({ referrer, referred: { email: 'x@example.nz', phone: '021 555 2222' }, settings: on }).ok);
  ok('not when the club has switched referrals off', !referralVerdict({ referrer, referred: {}, settings: readGrowth({ trial: { enabled: true } }) }).ok);
  ok('not from somebody who is no longer a member', !referralVerdict({ referrer: { ...referrer, active: false }, referred: {}, settings: on }).ok);
  ok('not to oneself, by email', /email/.test(referralVerdict({ referrer, referred: { email: 'MUM@example.nz' }, settings: on }).reason));
  ok('not to oneself, by mobile in another format', /phone/.test(referralVerdict({ referrer, referred: { phone: '+64 21 555 1111' }, settings: on }).reason));
  ok('not a flood', !referralVerdict({ referrer, referred: { email: 'z@example.nz' }, recent: 5, settings: on }).ok);

  const q = (o) => referralQualifies({ trialClasses: 3, referrerActive: true, rewardsThisYear: 0, settings: on, ...o });
  ok('earns the reward when they have been enough', q({}).ok);
  ok('waits, rather than refusing, while they are still coming', (() => { const r = q({ trialClasses: 1 }); return !r.ok && r.wait && /1 of the 3/.test(r.reason); })());
  ok('not when the referrer has gone', !q({ referrerActive: false }).ok && !q({ referrerActive: false }).wait);
  ok('not past the yearly limit', !q({ rewardsThisYear: 2 }).ok && /limit of 2/.test(q({ rewardsThisYear: 2 }).reason));

  ok('both sides only when the club offers both', rewardsFor(on).length === 1 && rewardsFor(readGrowth({ referral: { referred: { kind: 'custom', note: 'x' } } })).length === 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
