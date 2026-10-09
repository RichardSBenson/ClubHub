// Sales tax: the tax inside an amount, the setting, and where it shows.
import { taxInside, taxLine, problemsWithTax } from '../core/domain/tax.mjs';
import { resolveRegion, problemsWithRegion, readRegionForm } from '../core/domain/region.mjs';
import { whyNotInstructor } from '../core/domain/roles.mjs';
import { phoneKey } from '../core/domain/outsider.mjs';
import { enterRegion, words } from '../infrastructure/region-context.mjs';

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL', n); } };

ok('15% inside $11.50 is $1.50', taxInside(1150, 15) === 150);
ok('no rate, no tax', taxInside(1150, 0) === 0);
ok('rounds to the cent', taxInside(1000, 15) === 130);
ok('the line says what it includes', taxLine(1150, { taxName: 'GST', taxPercent: 15 }, (c) => `$${c / 100}`) === 'includes GST of $1.5');
ok('nothing to say without a tax', taxLine(1150, { taxName: '', taxPercent: 0 }, String) === '');
ok('a rate needs a name', problemsWithTax({ taxName: '', taxPercent: 15 }).length === 1);
ok('a silly rate is refused', problemsWithTax({ taxName: 'VAT', taxPercent: 90 }).length === 1);
ok('region carries the tax', resolveRegion({ taxName: 'VAT', taxPercent: 20 }).taxPercent === 20 && resolveRegion({}).taxPercent === 0);
ok('region refuses a bad tax', problemsWithRegion({ currency: 'GBP', locale: 'en-GB', adultAge: 18, taxName: '', taxPercent: 20 }).length === 1);
ok('the form reads the tax', readRegionForm({ taxName: ' GST ', taxPercent: '15', taxNumber: '12-345' }).taxPercent === 15);

ok('instructor rule names no belt system of one country', !/shodan/i.test(whyNotInstructor(null)));
ok('phones match across country formats', phoneKey('+61 412 345 678') === phoneKey('0412 345 678') && phoneKey('+1 415 555 0134') === phoneKey('(415) 555-0134'));
enterRegion({}, null, { club: 'Dojang' });
ok('the organisation\'s own word for a club is available', words().club === 'Dojang');
enterRegion({}, null, null);
ok('and neutral otherwise', words().club === 'Club');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
