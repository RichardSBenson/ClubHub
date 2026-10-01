import { reasonNotToPublish, assertMayPublish, minimumAgeFor,
         PUBLIC_PROFILE_MINIMUM_AGE } from './domain/instructing.mjs';
import { DomainError } from './domain/values.mjs';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`))
                               : (fail++, console.log(`  ✗ ${n}  ${d}`));

const TODAY = '2026-10-01';
const adult = { dateOfBirth: '1980-04-02' };
const sixteen = { dateOfBirth: '2010-04-02' };
const justEighteen = { dateOfBirth: '2008-10-01' };
const dayShort = { dateOfBirth: '2008-10-02' };

const why = (over = {}) => reasonNotToPublish({
  person: adult, isInstructor: true, on: TODAY, ...over });

console.log('\nWHO MAY APPEAR ON A PUBLIC WEBSITE');
{
  ok('an adult instructor may', why() === null, why());

  ok('somebody who is not an instructor may not',
    (why({ isInstructor: false }) ?? '').includes('not recorded as an instructor'));
  ok('and is told the register comes first',
    (why({ isInstructor: false }) ?? '').includes('follows the register'));

  ok('a person who does not exist may not',
    (why({ person: null }) ?? '').includes('no such person'));
}

console.log('\nMINORS ARE NOT PUBLISHED, WHATEVER ANYBODY TICKS');
{
  const r = why({ person: sixteen });
  ok('a sixteen-year-old assistant instructor is refused', !!r);
  ok('the refusal says their age', (r ?? '').includes('They are 16'));
  ok('and says they can still hold the role',
    (r ?? '').includes('without being on the website'));

  ok('exactly eighteen today is allowed', why({ person: justEighteen }) === null,
    why({ person: justEighteen }));
  ok('one day short is not', why({ person: dayShort }) !== null);

  // The rule is in the domain, so a second route cannot route around it.
  let threw = null;
  try { assertMayPublish({ person: sixteen, isInstructor: true, on: TODAY }); }
  catch (e) { threw = e; }
  ok('assertMayPublish throws a DomainError', threw instanceof DomainError);
}

console.log('\nAN UNKNOWN AGE IS NOT AN ADULT');
{
  const r = why({ person: { dateOfBirth: null } });
  ok('a missing date of birth is refused', !!r);
  ok('and says why, rather than failing silently',
    (r ?? '').includes('date of birth is not recorded'));
}

console.log('\nA FEDERATION MAY RAISE THE BAR, NEVER LOWER IT');
{
  ok('the default is eighteen', minimumAgeFor({}) === PUBLIC_PROFILE_MINIMUM_AGE);
  ok('twenty-one is honoured', minimumAgeFor({ publicProfileMinimumAge: 21 }) === 21);
  ok('sixteen is ignored', minimumAgeFor({ publicProfileMinimumAge: 16 }) === 18);
  ok('so is zero', minimumAgeFor({ publicProfileMinimumAge: 0 }) === 18);
  ok('and so is nonsense', minimumAgeFor({ publicProfileMinimumAge: 'yes' }) === 18);

  const r = reasonNotToPublish({ person: { dateOfBirth: '2007-01-01' },
    isInstructor: true, on: TODAY, settings: { publicProfileMinimumAge: 21 } });
  ok('a nineteen-year-old is refused where the bar is twenty-one',
    (r ?? '').includes('under 21'), r);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
