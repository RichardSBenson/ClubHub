/**
 * Currency, language and the age of adulthood belong to the organisation, are inherited down the tree, and never
 * leak between two requests running at once.
 */
import './reset.mjs';
import { pool, orgs, Forbidden, Invalid } from './data.mjs';
import { resolveRegion, problemsWithRegion } from '../core/domain/region.mjs';
import { withRegion, setRegion, region } from '../infrastructure/region-context.mjs';
import { money, tidyMoney } from '../core/domain/money.mjs';
import { needsGuardian } from '../core/domain/declarations.mjs';
import { isMinor } from '../core/domain/forms.mjs';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}${c ? '' : '  ' + d}`); };

console.log('\nTHE RULES');
ok('nothing set means the platform defaults', resolveRegion({}).currency === 'NZD' && resolveRegion().adultAge === 18);
ok('what is set wins', resolveRegion({ currency: 'USD', locale: 'en-US', adultAge: 21 }).adultAge === 21);
ok('a good setting has no problems', problemsWithRegion({ currency: 'AUD', locale: 'en-AU', adultAge: 18 }).length === 0);
ok('a bad currency is refused', problemsWithRegion({ currency: 'dollars', locale: 'en-AU', adultAge: 18 }).length === 1);
ok('a bad language is refused', problemsWithRegion({ currency: 'AUD', locale: 'not a locale', adultAge: 18 }).length === 1);
ok('an absurd age is refused', problemsWithRegion({ currency: 'AUD', locale: 'en-AU', adultAge: 7 }).length === 1);

console.log('\nTHE WORDS FOLLOW THE SETTING');
ok('dollars in New Zealand', money(1250, 'NZD', 'en-NZ') === '$12.50', money(1250, 'NZD', 'en-NZ'));
ok('pounds in Britain', money(1250, 'GBP', 'en-GB') === '£12.50', money(1250, 'GBP', 'en-GB'));
ok('whole amounts lose their noughts', tidyMoney(1200, 'GBP', 'en-GB') === '£12');
ok('adulthood is the age given', needsGuardian(19, 21) === true && needsGuardian(19) === false);
ok('so is being a minor', isMinor('2007-01-01', '2026-10-10', 21) && !isMinor('2007-01-01', '2026-10-10', 18));

console.log('\nTWO REQUESTS AT ONCE');
{
  const seen = await Promise.all([
    withRegion(async () => { setRegion({ currency: 'USD' }); await new Promise((r) => setTimeout(r, 20)); return region().currency; }),
    withRegion(async () => { setRegion({ currency: 'GBP' }); await new Promise((r) => setTimeout(r, 5)); return region().currency; }),
    withRegion(async () => { await new Promise((r) => setTimeout(r, 10)); return region().currency; }),
  ]);
  ok('each keeps its own', seen[0] === 'USD' && seen[1] === 'GBP' && seen[2] === 'NZD', seen.join());
}

console.log('\nSET ONCE, INHERITED BELOW');
const doug = (await pool.query(`select id from account where email='doug@example.nz'`)).rows[0];
const fed = (await pool.query(`select id from organisation where parent_id is null and type <> 'club' limit 1`)).rows[0];
const club = (await pool.query(`select id from organisation where slug='whanganui'`)).rows[0];
ok('nothing saved yet: the defaults', (await orgs.regionOf(club.id)).currency === 'NZD');
await orgs.saveRegion(doug.id, fed.id, { currency: 'AUD', locale: 'en-AU', adultAge: 18 });
ok('a club uses its federation\'s', (await orgs.regionOf(club.id)).currency === 'AUD');
await orgs.saveRegion(doug.id, club.id, { currency: 'USD', locale: 'en-US', adultAge: 21 });
ok('unless it sets its own', (await orgs.regionOf(club.id)).adultAge === 21 && (await orgs.regionOf(fed.id)).currency === 'AUD');
ok('a bad setting is refused', await orgs.saveRegion(doug.id, club.id, { currency: 'x', locale: 'en', adultAge: 18 }).then(() => false, (e) => e instanceof Invalid));
const nobody = (await pool.query(`insert into account (email) values ('nobody@example.nz') returning id`)).rows[0];
ok('only an administrator may', await orgs.saveRegion(nobody.id, club.id, { currency: 'AUD', locale: 'en-AU', adultAge: 18 }).then(() => false, (e) => e instanceof Forbidden));

console.log(`\n${pass} passed, ${fail} failed\n`);
await pool.end();
process.exit(fail ? 1 : 0);
