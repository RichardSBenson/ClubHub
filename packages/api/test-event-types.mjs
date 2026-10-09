/** A federation's kinds of event are its own data; one with none gets a generic list. */
import './reset.mjs';
import { pool, orgs, Forbidden, Invalid } from './data.mjs';
import { resolveEventTypes, problemsWithEventTypes, readEventTypesForm, bannerLines, typeFor, readType, defaultTitle, GENERIC_EVENT_TYPES } from '../core/domain/event-types.mjs';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${n}${c ? '' : '  ' + d}`); };

console.log('\nTHE RULES');
ok('no list: the generic one', resolveEventTypes(null) === GENERIC_EVENT_TYPES && resolveEventTypes([]) === GENERIC_EVENT_TYPES);
ok('the generic list names no region or school', GENERIC_EVENT_TYPES.every((t) => !/island|zealand|dojo|kyu|shinsa/i.test(JSON.stringify(t))));
const mine = [{ key: 'state_champs', label: 'State championships', kind: 'tournament', top: 'Victoria', main: 'Champions' }];
ok('an own list is used', resolveEventTypes(mine)[0].key === 'state_champs');
ok('a broken list falls back rather than breaking pages', resolveEventTypes([{ key: 'X', label: '', kind: 'nope', main: '' }]) === GENERIC_EVENT_TYPES);
ok('problems are sentences', problemsWithEventTypes([{ key: 'Bad Key', label: '', kind: 'x', main: '' }]).length === 4);
ok('a repeated code is refused', problemsWithEventTypes([mine[0], mine[0]]).some((p) => /twice/.test(p)));
ok('the banner follows the list', bannerLines({ type_key: 'state_champs', title: 'x' }, mine).top === 'Victoria');
ok('an unknown type shows title and kind', bannerLines({ type_key: 'gone', title: 'Open day', kind: 'social' }, mine).top === 'Open day');
ok('a typed value is only accepted if listed', readType('state_champs', mine) === 'state_champs' && readType('camp_north', mine) === null);
ok('the default title joins line above and main word', defaultTitle('state_champs', mine) === 'Victoria Champions');
ok('the form is read, blank rows ignored, removed rows dropped', readEventTypesForm({ key_0: 'a', label_0: 'A', kind_0: 'camp', main_0: 'A', key_1: '', key_2: 'b', label_2: 'B', kind_2: 'camp', main_2: 'B', remove_2: 'on' }).length === 1);

console.log('\nPER FEDERATION');
const doug = (await pool.query(`select id from account where email='doug@example.nz'`)).rows[0];
const fed = (await pool.query(`select id from organisation where slug='moknz'`)).rows[0];
const club = (await pool.query(`select id from organisation where slug='whanganui'`)).rows[0];
ok('MOKNZ keeps its own kinds (seeded)', (await orgs.eventTypesOf(fed.id)).some((t) => t.key === 'camp_north'));
ok('and its clubs see them too', (await orgs.eventTypesOf(club.id)).some((t) => t.key === 'nationals'));
await orgs.saveEventTypes(doug.id, fed.id, mine);
ok('changed', (await orgs.eventTypesOf(club.id)).length === 1);
ok('a bad list is refused', await orgs.saveEventTypes(doug.id, fed.id, []).then(() => false, (e) => e instanceof Invalid));
const nobody = (await pool.query(`insert into account (email) values ('nobody@example.nz') returning id`)).rows[0];
ok('only an administrator may', await orgs.saveEventTypes(nobody.id, fed.id, mine).then(() => false, (e) => e instanceof Forbidden));
ok('an organisation with none uses the generic list', (await orgs.eventTypesOf(null)) === GENERIC_EVENT_TYPES);

console.log(`\n${pass} passed, ${fail} failed\n`);
await pool.end();
process.exit(fail ? 1 : 0);
