/**
 * The shorthand a volunteer types, and what it becomes.
 *
 * The round trip matters more than any single case: somebody edits a page,
 * saves, comes back a month later and edits it again. If the text they are
 * shown is not the text they typed, every save quietly degrades the page.
 */

import { richFromText, textFromRich } from './marks.mjs';
import { validate, renderBlocks } from './blocks.mjs';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`))
                               : (fail++, console.log(`  ✗ ${n}  ${d}`));

const round = (t) => textFromRich(richFromText(t));

console.log('\nTHE THREE MARKS');
{
  ok('bold', JSON.stringify(richFromText('**Hanshi Doug**'))
    === '[{"text":"Hanshi Doug","marks":["strong"]}]',
    JSON.stringify(richFromText('**Hanshi Doug**')));
  ok('italic', JSON.stringify(richFromText('*kiai*'))
    === '[{"text":"kiai","marks":["em"]}]');
  ok('a link carries its address',
    JSON.stringify(richFromText('[our dojo](/whanganui)'))
      === '[{"text":"our dojo","marks":["link"],"href":"/whanganui"}]',
    JSON.stringify(richFromText('[our dojo](/whanganui)')));
}

console.log('\nMIXED WITH ORDINARY WORDS');
{
  const runs = richFromText('Founded by **Hanshi Doug** in *1965*, see [the history](/about).');
  ok('the marked and plain runs come out in order', runs.length === 7,
    JSON.stringify(runs));
  ok('the plain words survive', runs[0].text === 'Founded by ');
  ok('the bold is bold', runs[1].marks[0] === 'strong');
  ok('the italic is italic', runs[3].marks[0] === 'em');
  ok('and the link is a link', runs[5].marks[0] === 'link'
    && runs[5].href === '/about', JSON.stringify(runs[5]));
}

console.log('\nIT ROUND-TRIPS, WHICH IS THE WHOLE POINT');
{
  for (const text of [
    'Plain words with nothing in them.',
    '**All bold**',
    'Founded by **Hanshi Doug** in *1965*.',
    'See [the history](/about) or [email us](mailto:a@b.nz).',
    'A [link](https://example.nz/a?b=c&d=e) with a query string.',
    '**Bold** then *italic* then **bold** again.',
  ]) {
    ok(`"${text.slice(0, 38)}${text.length > 38 ? '…' : ''}"`,
      round(text) === text, round(text));
  }
}

console.log('\nWHAT SOMEBODY TYPES THAT IS NOT SHORTHAND');
{
  // A volunteer writing about class times should not have half a sentence
  // italicised because they used an asterisk as a bullet or a multiply sign.
  ok('a lone asterisk is a lone asterisk',
    round('Tuesdays * Thursdays') === 'Tuesdays * Thursdays',
    round('Tuesdays * Thursdays'));
  ok('an unclosed bold marker is left alone',
    round('Important ** note') === 'Important ** note',
    round('Important ** note'));
  ok('an unclosed bracket too',
    round('See [the history') === 'See [the history',
    round('See [the history'));
  ok('and a bracket with no address',
    round('A [word] in brackets') === 'A [word] in brackets',
    round('A [word] in brackets'));
  ok('empty emphasis is not a run',
    JSON.stringify(richFromText('**')) === '[{"text":"**"}]',
    JSON.stringify(richFromText('**')));
}

console.log('\nA LINK NOBODY SHOULD FOLLOW');
{
  // javascript: is the one that matters. The author's words are kept — losing
  // a sentence because the address was wrong is worse than losing the link.
  const runs = richFromText('Click [here](javascript:alert(1)) now');
  // The safety property is that it never becomes a link — not that the
  // author's typing is scrubbed. Text stays text; text is escaped at render.
  ok('nothing is marked as a link',
    !runs.some((r) => r.marks?.includes('link')), JSON.stringify(runs));
  ok('and no address is carried anywhere',
    !runs.some((r) => r.href), JSON.stringify(runs));
  ok('the author\'s words survive',
    runs.map((r) => r.text).join('').includes('here'), JSON.stringify(runs));

  for (const bad of ['data:text/html,<script>', 'vbscript:x', 'javascript:x']) {
    ok(`${bad.split(':')[0]}: is refused`,
      !richFromText(`[x](${bad})`).some((r) => r.marks?.includes('link')));
  }
  for (const good of ['https://example.nz', 'http://example.nz',
                      'mailto:a@b.nz', 'tel:+6421000000', '/about']) {
    ok(`${good} is allowed`,
      richFromText(`[x](${good})`).some((r) => r.marks?.includes('link')),
      good);
  }
}

console.log('\nNOTHING PASTED IN CAN BECOME MARKUP');
{
  const runs = richFromText('<script>alert(1)</script> and <b>bold</b>');
  const { doc } = validate({ blocks: [{ type: 'paragraph', text: runs }] });
  const html = renderBlocks(doc);
  ok('the script tag is escaped', !html.includes('<script>')
    && html.includes('&lt;script&gt;'), html);
  ok('so is the bold tag', html.includes('&lt;b&gt;'), html);
  ok('and the shorthand never produces a tag of its own',
    !/<(?!\/?(p|strong|em|a|br)\b)/i.test(html), html);
}

console.log('\nWHAT COMES BACK FROM A DOCUMENT WRITTEN BEFORE ANY OF THIS');
{
  // Older documents store a bare string, and blocks.mjs already accepts that.
  ok('a plain string reads back as itself',
    textFromRich('just a string') === 'just a string');
  ok('so does an array of bare strings',
    textFromRich(['one ', 'two']) === 'one two');
  ok('a run with a mark the shorthand cannot express falls back to its words',
    textFromRich([{ text: 'x', marks: ['underline'] }]) === 'x');
  ok('and a link with no address is not written as one',
    textFromRich([{ text: 'x', marks: ['link'] }]) === 'x');
  ok('nothing at all is an empty string', textFromRich(null) === '');
  ok('and empty text makes no runs', JSON.stringify(richFromText('   ')) === '[]');
}

console.log('\nTHROUGH THE BLOCK VALIDATOR, WHICH IS WHERE IT ACTUALLY GOES');
{
  const { doc, dropped } = validate({ blocks: [
    { type: 'paragraph', text: richFromText('Founded by **Hanshi Doug**.') },
    { type: 'heading', text: 'Our dojo', level: 2 },
  ]});
  ok('the marks survive validation', dropped.length === 0, JSON.stringify(dropped));
  const html = renderBlocks(doc);
  ok('and render as real emphasis', html.includes('<strong>Hanshi Doug</strong>'),
    html);
  ok('with the words around them intact', html.includes('Founded by'));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
