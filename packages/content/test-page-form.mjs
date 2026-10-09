/**
 * The editor with JavaScript off: a form goes in, a block document comes out,
 * and every structural change is a button rather than a script.
 */

import { documentFromForm, formFromDocument, applyOperation, emptyBlock,
         looksEmpty, BLOCK_MENU } from './page-form.mjs';
import { validate, renderBlocks } from './blocks.mjs';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`))
                               : (fail++, console.log(`  ✗ ${n}  ${d}`));

const DOC = { blocks: [
  { type: 'heading', text: 'Our dojo', level: 2 },
  { type: 'paragraph', text: [
    { text: 'Founded by ' },
    { text: 'Hanshi Doug', marks: ['strong'] },
    { text: ' in 1965.' }] },
  { type: 'list', ordered: false, items: [
    [{ text: 'Tuesdays 6pm' }], [{ text: 'Thursdays 6pm' }]] },
  { type: 'clubList', heading: 'Where to train' },
]};

console.log('\nA DOCUMENT FILLS THE FORM');
{
  const f = formFromDocument(DOC);
  ok('every block is numbered by position', f.blockCount === '4', f.blockCount);
  ok('the heading text is there', f.b0_text === 'Our dojo');
  ok('and its level', f.b0_level === '2');
  ok('rich text comes back as the shorthand that was typed',
    f.b1_text === 'Founded by **Hanshi Doug** in 1965.', f.b1_text);
  ok('a list is one item per line',
    f.b2_items === 'Tuesdays 6pm\nThursdays 6pm', JSON.stringify(f.b2_items));
  ok('a checkbox is empty when off', f.b2_ordered === '');
  ok('and the live block keeps its heading', f.b3_heading === 'Where to train');
}

console.log('\nAND THE FORM REBUILDS THE DOCUMENT');
{
  const back = documentFromForm(formFromDocument(DOC));
  ok('the same number of blocks', back.blocks.length === 4);
  ok('in the same order',
    back.blocks.map((b) => b.type).join(',') === 'heading,paragraph,list,clubList');
  ok('the bold survives the round trip',
    JSON.stringify(back.blocks[1].text) === JSON.stringify(DOC.blocks[1].text),
    JSON.stringify(back.blocks[1].text));
  ok('so do both list items', back.blocks[2].items.length === 2);
  ok('and the heading level is a number, not a string',
    back.blocks[0].level === 2, typeof back.blocks[0].level);
}

console.log('\nWHAT THE BUTTONS DO');
{
  const order = (d) => d.blocks.map((b) => b.type).join(',');

  ok('move up', order(applyOperation(DOC, 'up:1'))
    === 'paragraph,heading,list,clubList');
  ok('move down', order(applyOperation(DOC, 'down:0'))
    === 'paragraph,heading,list,clubList');
  ok('remove', order(applyOperation(DOC, 'remove:2'))
    === 'heading,paragraph,clubList');
  ok('add one at the end', order(applyOperation(DOC, 'add:quote'))
    === 'heading,paragraph,list,clubList,quote');

  ok('the first block cannot move up', order(applyOperation(DOC, 'up:0'))
    === order(DOC));
  ok('the last cannot move down', order(applyOperation(DOC, 'down:3'))
    === order(DOC));
  ok('a position that is not there changes nothing',
    order(applyOperation(DOC, 'remove:99')) === order(DOC));
  ok('and so does a button we do not know',
    order(applyOperation(DOC, 'explode:0')) === order(DOC));
  ok('plain save leaves the order alone',
    order(applyOperation(DOC, 'save')) === order(DOC));

  ok('the original is never mutated', order(DOC)
    === 'heading,paragraph,list,clubList');
}

console.log('\nA NEW BLOCK OF EVERY KIND THE MENU OFFERS');
{
  for (const [type, label] of BLOCK_MENU) {
    const b = emptyBlock(type);
    ok(`${label} can be added`, !!b && b.type === type, type);
  }
  ok('a heading starts at level 2, not 1 — the page title is the h1',
    emptyBlock('heading').level === 2);
  ok('a type that does not exist makes nothing',
    emptyBlock('marquee') === null);
}

console.log('\nWHAT A HALF-FINISHED PAGE LOOKS LIKE');
{
  ok('nothing at all is empty', looksEmpty({ blocks: [] }));
  ok('a heading with no words is empty',
    looksEmpty({ blocks: [emptyBlock('heading')] }));
  ok('a divider alone is empty',
    looksEmpty({ blocks: [{ type: 'divider' }] }));
  ok('but one word is not',
    !looksEmpty({ blocks: [{ type: 'heading', text: 'Hi', level: 2 }] }));
  ok('and a live block on its own is a page — it pulls the clubs in',
    !looksEmpty({ blocks: [emptyBlock('clubList')] }));
}

console.log('\nWHAT A SUBMITTED FORM ACTUALLY LOOKS LIKE');
{
  // Exactly what a browser posts: every value a string, checkboxes absent.
  const doc = documentFromForm({
    blockCount: '3',
    b0_type: 'heading', b0_text: 'Classes', b0_level: '2',
    b1_type: 'paragraph', b1_text: 'See [the timetable](/classes).',
    b2_type: 'list', b2_items: ' Monday \n\n Wednesday \n', // stray whitespace
  });
  ok('three blocks', doc.blocks.length === 3);
  ok('the level is a number', doc.blocks[0].level === 2);
  ok('the link is parsed',
    doc.blocks[1].text.some((r) => r.marks?.includes('link')),
    JSON.stringify(doc.blocks[1].text));
  ok('blank lines in a list are not empty items',
    doc.blocks[2].items.length === 2, JSON.stringify(doc.blocks[2].items));
  ok('and the items are trimmed',
    doc.blocks[2].items[0][0].text === 'Monday',
    JSON.stringify(doc.blocks[2].items[0]));
  ok('an unticked checkbox is false', doc.blocks[2].ordered === false);
}

console.log('\nNOTHING A FORM CAN SAY GETS PAST THE WHITELIST');
{
  const doc = documentFromForm({
    blockCount: '3',
    b0_type: 'script', b0_src: 'evil.js',
    b1_type: 'paragraph', b1_text: 'Kept.',
    b2_type: 'heading', b2_text: '<img src=x onerror=alert(1)>', b2_level: '2',
  });
  ok('a block type nobody offers is dropped before it is stored',
    doc.blocks.length === 2, JSON.stringify(doc.blocks.map((b) => b.type)));

  const { doc: clean, dropped } = validate(doc);
  ok('and the validator agrees there is nothing to drop',
    dropped.length === 0, JSON.stringify(dropped));
  const html = renderBlocks(clean);
  ok('the pasted tag is escaped, not rendered',
    !html.includes('<img') && html.includes('&lt;img'), html);
}

console.log('\nA FORM CLAIMING MORE BLOCKS THAN IT HAS');
{
  ok('missing blocks are simply not there',
    documentFromForm({ blockCount: '50', b0_type: 'divider' }).blocks.length === 1);
  ok('an absurd count is capped rather than looped over',
    documentFromForm({ blockCount: '999999' }).blocks.length === 0);
  ok('and no count at all is no blocks',
    documentFromForm({}).blocks.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
