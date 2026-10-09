import { typeFor as typeFor0, defaultTitle as defaultTitle0, bannerLines as bannerLines0, readType as readType0, problemsWithDetail, mapLinks } from './domain/event-types.mjs';
// A federation's list, as MOKNZ keeps it in its own data. The code carries no list of its own.
const EVENT_TYPES = [
  { key: 'camp_north', label: 'Training Camp — North Island', kind: 'camp', top: 'North Island', main: 'Training Camp' },
  { key: 'camp_south', label: 'Training Camp — South Island', kind: 'camp', top: 'South Island', main: 'Training Camp' },
  { key: 'shinsa_north', label: 'Shinsa — North Island', kind: 'grading', top: 'North Island', main: 'Shinsa' },
  { key: 'shinsa_south', label: 'Shinsa — South Island', kind: 'grading', top: 'South Island', main: 'Shinsa' },
  { key: 'nationals', label: 'Nationals', kind: 'tournament', top: 'New Zealand', main: 'Nationals' },
  { key: 'kyu_grading', label: 'Kyu Grading', kind: 'grading', top: 'Kyu', main: 'Grading' },
  { key: 'seminar', label: 'Seminar', kind: 'seminar', top: null, main: 'Seminar' },
  { key: 'operators', label: 'Dojo Operators Meeting', kind: 'other', top: 'Dojo Operators', main: 'Meeting' },
];
const typeFor = (k) => typeFor0(k, EVENT_TYPES), defaultTitle = (k) => defaultTitle0(k, EVENT_TYPES);
const bannerLines = (e) => bannerLines0(e, EVENT_TYPES), readType = (v) => readType0(v, EVENT_TYPES);
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : (fail++, console.log('  ✗', n)); };
ok('the eight types are there', EVENT_TYPES.length === 8 && ['camp_north', 'camp_south', 'shinsa_north', 'shinsa_south', 'nationals', 'kyu_grading', 'seminar', 'operators'].every((k) => typeFor(k)));
ok('keys are unique', new Set(EVENT_TYPES.map((t) => t.key)).size === EVENT_TYPES.length);
ok('every kind is one the register knows', EVENT_TYPES.every((t) => ['grading', 'tournament', 'camp', 'seminar', 'fight_night', 'training', 'social', 'other'].includes(t.kind)));
ok('a default title reads as a name', defaultTitle('camp_north') === 'North Island Training Camp' && defaultTitle('seminar') === 'Seminar' && defaultTitle('nope') === '');
ok('a banner takes its lines from the type', JSON.stringify(bannerLines({ type_key: 'shinsa_north', title: 'x' })) === JSON.stringify({ top: 'North Island', main: 'Shinsa' }));
ok('a seminar puts its own title on top', bannerLines({ type_key: 'seminar', title: 'Karate Seminar with Shihan Tanaka' }).top === 'Karate Seminar with Shihan Tanaka');
ok('no type shows the title and the kind', bannerLines({ title: 'Grading', kind: 'fight_night' }).main === 'fight night');
ok('only known types are read', readType('camp_north') === 'camp_north' && readType('<script>') === null && readType('') === null);
ok('a bad email, link and half a pin are each caught', problemsWithDetail({ contactEmail: 'x' }).length === 1
  && problemsWithDetail({ infoUrl: 'http://x.nz' }).length === 1 && problemsWithDetail({ infoUrl: 'javascript:1' }).length === 1
  && problemsWithDetail({ latitude: 1, longitude: null }).length === 1 && problemsWithDetail({ latitude: 91, longitude: 0 }).length === 1);
ok('good details have no problems', problemsWithDetail({ contactEmail: 'a@b.nz', infoUrl: 'https://b.nz/x', latitude: -39.9, longitude: 175 }).length === 0);
const m = mapLinks({ latitude: -39.93, longitude: 175.05 });
ok('a pin gives an embed and two links', /marker=-39.93/.test(m.embed) && /openstreetmap/.test(m.osm) && /google/.test(m.google));
const a = mapLinks({ venue: 'Hall', address: '1 Road, Town' });
ok('an address gives links but no embed', a.embed === null && /query=Hall%2C%201%20Road%2C%20Town/.test(a.google));
ok('nothing gives nothing', mapLinks({}) === null);
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
