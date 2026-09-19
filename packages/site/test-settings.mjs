import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSettings, SettingsError } from './settings.mjs';

let pass = 0, fail = 0;
const ok = (n,c,d='') => c ? (pass++,console.log(`  ✓ ${n}`))
                           : (fail++,console.log(`  ✗ ${n} ${d}`));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'honbu-'));
const write = (obj) => {
  fs.writeFileSync(path.join(tmp, 'settings.json'), JSON.stringify(obj, null, 2));
  return tmp;
};
const fails = (name, obj, contains) => {
  try { loadSettings(write(obj)); fail++; console.log(`  ✗ ${name} — allowed it`); }
  catch (e) {
    const right = e instanceof SettingsError
      && e.problems.some(p => p.includes(contains));
    right ? (pass++, console.log(`  ✓ ${name}`))
          : (fail++, console.log(`  ✗ ${name} — ${e.message.slice(0,90)}`));
    if (right) console.log('      → ' + e.problems.find(p=>p.includes(contains)));
  }
};

const GOOD = {
  organisation: { name: 'MOKNZ' },
  colours: { primary:'#CE372C', accent:'#F0CE41', ink:'#161617',
             canvas:'#F5F5F5', neutral:'#BDBDBF' },
  fonts: { display:'Shippori Mincho', body:'Zen Kaku Gothic New' },
  homePage: { sections:['hero','dojoGrid','events'] },
  dojoPage: { sections:['hero','facts','times'] },
  navigation: { items:[{ href:'/find-a-dojo', label:'Find a dojo' }] },
};

console.log('\nA GOOD FILE LOADS AND FILLS IN THE REST');
{
  const s = loadSettings(write(GOOD));
  ok('the five chosen colours survive', s.tokens.primary === '#CE372C');
  ok('the rest are derived', !!s.tokens.primaryTextStrong && !!s.tokens.canvasAlt);
  ok('links are darkened until readable',
    s.tokens.primaryTextStrong !== s.tokens.primary);
  ok('comments never reach the templates',
    !JSON.stringify(s).includes('_readme'));
  console.log(`      → links ${s.tokens.primaryTextStrong}, ` +
    `muted ${s.tokens.muted}, alt ${s.tokens.canvasAlt}`);
}

console.log('\nUNREADABLE CHOICES FAIL THE BUILD');
{
  fails('pale grey body text', { ...GOOD,
    colours: { ...GOOD.colours, ink:'#BBBBBB' } }, 'body text');

  fails('white text on a yellow button', { ...GOOD,
    colours: { ...GOOD.colours, primary:'#F0CE41' } }, 'button text');

  fails('a dark page background with dark headers', { ...GOOD,
    colours: { ...GOOD.colours, canvas:'#222222' } }, 'needs 4.5:1');
}

console.log('\nMISTAKES ARE EXPLAINED, NOT JUST REJECTED');
{
  fails('a colour that is not a colour', { ...GOOD,
    colours: { ...GOOD.colours, primary:'red' } }, 'hex colour');
  fails('a section that does not exist', { ...GOOD,
    homePage: { sections:['hero','carousel'] } }, 'choose from');
  fails('a dojo page with no facts strip', { ...GOOD,
    dojoPage: { sections:['hero','times'] } }, 'where, when and who');
  fails('a sixth menu item', { ...GOOD, navigation: { items:
    [1,2,3,4,5,6].map(n => ({ href:`/p${n}`, label:`Page ${n}` })) } },
    'five is the limit');
}

console.log('\nBROKEN JSON IS CAUGHT KINDLY');
{
  fs.writeFileSync(path.join(tmp,'settings.json'), '{ "colours": { }, }');
  try { loadSettings(tmp); fail++; console.log('  ✗ allowed broken JSON'); }
  catch (e) {
    ok('it says what is wrong', e.problems[0].includes('not valid JSON'));
    ok('and names the usual cause', e.problems[1].includes('trailing'));
  }
}

console.log('\nNO FILE AT ALL STILL BUILDS');
{
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'honbu-empty-'));
  const s = loadSettings(empty);
  ok('sensible defaults', s.tokens.primary === '#CE372C' && s.navigation.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
