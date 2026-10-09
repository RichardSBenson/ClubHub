/**
 * One box of text, in and out.
 *
 * The test that matters is the round trip. Somebody opens a page written two
 * years ago in the new editor, saves it without touching it, and must get the
 * same document back. Anything else loses a block quietly, which is the
 * failure this whole feature could most easily cause.
 */
import { textFromDocument, documentFromText, WRITING_HELP }
  from './document-text.mjs';
import { validate, renderBlocks, toText } from './blocks.mjs';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`))
                               : (fail++, console.log(`  ✗ ${n}  ${d}`));

const rich = (s) => [{ text: s }];

/** Every block type, with something in every field. */
const EVERYTHING = { blocks: [
  { type: 'heading', level: 2, text: 'Grading results' },
  { type: 'paragraph', text: [
    { text: 'Eleven students graded on ' },
    { text: 'Saturday', marks: ['strong'] },
    { text: ' at ' },
    { text: 'Whanganui', marks: ['em'] },
    { text: '. See ' },
    { text: 'the roll', marks: ['link'], href: 'https://moknz.nz/roll' },
    { text: '.' },
  ] },
  { type: 'list', ordered: false, items: [rich('Kata'), rich('Kumite')] },
  { type: 'list', ordered: true, items: [rich('First'), rich('Second')] },
  { type: 'quote', text: rich('The ultimate truth.'), attribution: 'Mas Oyama' },
  { type: 'image', assetId: 'a1b2c3d4-0000-0000-0000-000000000001',
    alt: 'Doug bowing in', caption: 'Before the grading' },
  { type: 'callout', tone: 'note', text: rich('Bring your licence.') },
  { type: 'callout', tone: 'warning', text: rich('No entry after 9am.') },
  { type: 'divider' },
  { type: 'embed', provider: 'youtube', id: 'dQw4w9WgXcQ', caption: 'The kata' },
  { type: 'clubList', heading: 'Where we train' },
  { type: 'eventList', heading: 'Coming up', kind: 'grading', limit: 3 },
  { type: 'honours', heading: 'Honours', award: 'Kokoro' },
  { type: 'faq', heading: 'Questions', items: [
    { q: 'How much does it cost?', a: [{ text: 'It is ' }, { text: 'free', marks: ['strong'] }, { text: ' for the first class.' }] },
    { q: 'Do I need a uniform?', a: rich('Not at first.\nWear loose clothes.') } ] },
  { type: 'contactForm', heading: 'Get in touch', intro: 'We reply within a day.', kind: 'contact' },
  { type: 'contactForm', heading: 'Try a class', intro: '', kind: 'trial' },
] };

console.log('\nEVERY BLOCK TYPE SURVIVES THE ROUND TRIP');
{
  const text = textFromDocument(EVERYTHING);
  const back = documentFromText(text);

  ok('nothing is lost', back.blocks.length === EVERYTHING.blocks.length,
    `${EVERYTHING.blocks.length} in, ${back.blocks.length} out`);
  ok('and the types are in the same order',
    back.blocks.map((b) => b.type).join() ===
    EVERYTHING.blocks.map((b) => b.type).join(),
    back.blocks.map((b) => b.type).join());

  // Converting twice must be identical to converting once. If it is not,
  // every save would drift the document a little further.
  const twice = textFromDocument(back);
  ok('converting twice changes nothing', twice === text,
    `first:\n${text}\n\nsecond:\n${twice}`);
}

console.log('\nTHE DETAILS SURVIVE, NOT JUST THE SHAPES');
{
  const b = documentFromText(textFromDocument(EVERYTHING)).blocks;
  const of = (type) => b.find((x) => x.type === type);

  ok('a heading keeps its level', of('heading').level === 2);
  ok('and its words', of('heading').text === 'Grading results');

  const para = of('paragraph');
  ok('bold survives', para.text.some((r) => r.marks?.includes('strong')
    && r.text === 'Saturday'), JSON.stringify(para.text));
  ok('italic survives', para.text.some((r) => r.marks?.includes('em')));
  ok('a link keeps its address', para.text.some((r) =>
    r.href === 'https://moknz.nz/roll'));

  const lists = b.filter((x) => x.type === 'list');
  ok('a bulleted list stays bulleted', lists[0].ordered === false);
  ok('a numbered list stays numbered', lists[1].ordered === true);
  ok('with its items', lists[0].items.length === 2);

  ok('a quotation keeps its attribution',
    of('quote').attribution === 'Mas Oyama');

  const img = of('image');
  ok('an image keeps the asset it points at',
    img.assetId === 'a1b2c3d4-0000-0000-0000-000000000001');
  ok('its description', img.alt === 'Doug bowing in');
  ok('and its caption', img.caption === 'Before the grading');

  const callouts = b.filter((x) => x.type === 'callout');
  ok('a note stays a note', callouts[0].tone === 'note');
  ok('and a warning stays a warning', callouts[1].tone === 'warning');

  const video = of('embed');
  ok('a video keeps its provider and id',
    video.provider === 'youtube' && video.id === 'dQw4w9WgXcQ');

  ok('the live club list keeps its heading',
    of('clubList').heading === 'Where we train');
  ok('the live event list keeps its settings',
    of('eventList').kind === 'grading' && of('eventList').limit === 3);
  ok('and the honours board keeps its award',
    of('honours').award === 'Kokoro');
}

console.log('\nWHAT COMES OUT STILL PASSES THE WHITELIST');
{
  // The one-box editor must not be a way around blocks.mjs.
  const { doc, dropped } = validate(documentFromText(textFromDocument(EVERYTHING)));
  ok('the whole document validates', dropped.length === 0, dropped.join('; '));
  ok('and keeps every block', doc.blocks.length === EVERYTHING.blocks.length);

  const nasty = documentFromText(
    '{{raw {"type":"script","src":"https://evil.example/x.js"}}}');
  const checked = validate(nasty);
  ok('a block type nobody whitelisted is dropped by the validator',
    checked.doc.blocks.length === 0, JSON.stringify(checked.doc.blocks));
  ok('and says so rather than silently', checked.dropped.length > 0);
}

console.log('\nWRITING IT BY HAND, THE WAY SOMEBODY ACTUALLY WOULD');
{
  const typed = documentFromText(`
## Saturday's grading

Eleven students graded. **Well done** to all of them.

- Aroha Ngata
- Tama Rewiri

> Train hard.
> — Doug

---

{{events limit=3}}
`);
  const types = typed.blocks.map((b) => b.type).join();
  ok('reads as you would expect',
    types === 'heading,paragraph,list,quote,divider,eventList', types);
  ok('the apostrophe in the heading is untouched',
    typed.blocks[0].text === "Saturday's grading");
  ok('the quotation found its attribution',
    typed.blocks[3].attribution === 'Doug');
}

console.log('\nIT IS FORGIVING, BECAUSE A TEXTAREA IS NOT A FILE FORMAT');
{
  ok('nothing typed is an empty document',
    documentFromText('').blocks.length === 0);
  ok('and so is whitespace',
    documentFromText('\n\n   \n').blocks.length === 0);

  ok('a lone paragraph works',
    documentFromText('Just a sentence.').blocks[0].type === 'paragraph');

  // Unrecognised braces become text rather than an error or a lost line.
  const braces = documentFromText('{{nonsense}}');
  ok('something that looks like a live block but is not becomes text',
    braces.blocks[0].type === 'paragraph'
    && braces.blocks[0].text[0].text.includes('nonsense'),
    JSON.stringify(braces.blocks));

  ok('headings deeper than four are clamped, not lost',
    documentFromText('###### Deep').blocks[0].level === 4);

  ok('asterisks are a divider too',
    documentFromText('***').blocks[0].type === 'divider');

  // A list immediately after a paragraph, with no blank line. People do this.
  const tight = documentFromText('Here they are:\n- one\n- two');
  ok('a list right under a paragraph is still a list',
    tight.blocks.map((b) => b.type).join() === 'paragraph,list',
    tight.blocks.map((b) => b.type).join());

  // The parser must never spin on input it cannot consume.
  const started = Date.now();
  documentFromText('{{unclosed\n'.repeat(200));
  ok('unterminated braces do not hang it', Date.now() - started < 1000);
}

console.log('\nIMAGES ARE REFERRED TO BY NAME, NOT BY UUID');
{
  const images = [
    { id: 'a1b2c3d4-0000-0000-0000-000000000001', filename: 'crest.png' },
    { id: 'a1b2c3d4-0000-0000-0000-000000000002', filename: 'doug.jpg' },
  ];

  const text = textFromDocument(EVERYTHING, { images });
  ok('the image is written out as its filename',
    text.includes('![Doug bowing in](crest.png)'),
    text.split('\n').find((l) => l.startsWith('![')));

  const back = documentFromText(text, { images });
  const img = back.blocks.find((b) => b.type === 'image');
  ok('and reading it back finds the right image',
    img.assetId === 'a1b2c3d4-0000-0000-0000-000000000001', img.assetId);

  ok('typing the name in any case works',
    documentFromText('![x](CREST.PNG)', { images }).blocks[0].assetId
      === 'a1b2c3d4-0000-0000-0000-000000000001');

  ok('a uuid still works, for anything written before this',
    documentFromText('![x](a1b2c3d4-0000-0000-0000-000000000002)', { images })
      .blocks[0].assetId === 'a1b2c3d4-0000-0000-0000-000000000002');

  ok('a name nobody has is left alone rather than guessed at',
    documentFromText('![x](missing.png)', { images }).blocks[0].assetId
      === 'missing.png');

  // Two files with the same name cannot both be that name.
  const clashing = [
    { id: 'id-one', filename: 'photo.png' },
    { id: 'id-two', filename: 'photo.png' },
  ];
  const ambiguous = textFromDocument(
    { blocks: [{ type: 'image', assetId: 'id-one', alt: 'x', caption: '' }] },
    { images: clashing });
  ok('a duplicated filename stays a uuid rather than pointing at the wrong one',
    ambiguous.includes('](id-one)'), ambiguous);

  ok('and with no images known, it still round-trips on ids',
    documentFromText(textFromDocument(EVERYTHING)).blocks
      .find((b) => b.type === 'image').assetId
      === 'a1b2c3d4-0000-0000-0000-000000000001');
}

console.log('\nTHE HELP IS SHORT ENOUGH TO READ');
{
  ok('nine lines at most', WRITING_HELP.length <= 9);
  ok('each one is an example and what it does',
    WRITING_HELP.every(([ex, what]) => ex.length && what.length));
}

console.log('\nFAQ AND CONTACT FORM');
{
  const b = documentFromText(textFromDocument(EVERYTHING)).blocks;
  const faq = b.find((x) => x.type === 'faq');
  ok('a FAQ keeps its questions and answers', faq.items.length === 2 && faq.items[0].q === 'How much does it cost?'
    && faq.items[0].a.some((r) => r.marks?.includes('strong')) && faq.heading === 'Questions');
  ok('a multi-line answer stays together', faq.items[1].a.map((r) => r.text).join('').includes('Wear loose clothes'));
  const forms = b.filter((x) => x.type === 'contactForm');
  ok('both kinds of form survive', forms.length === 2 && forms[0].kind === 'contact' && forms[1].kind === 'trial' && forms[0].intro === 'We reply within a day.');
  const typed = documentFromText('Hello\n\n{{faq heading=FAQs}}\n? One?\nYes.\n\n? Two?\nNo.\n{{/faq}}\n\nAfter');
  ok('typed by hand, a FAQ parses and the text after it is kept', typed.blocks.map((x) => x.type).join() === 'paragraph,faq,paragraph' && typed.blocks[1].items.length === 2);
  ok('an unclosed FAQ does not eat the page forever', documentFromText('{{faq}}\n? Q\nA').blocks[0].items.length === 1);
  const v = validate({ blocks: [{ type: 'faq', items: [{ q: 'Q', a: 'A' }, { q: '', a: 'x' }, { q: 'No answer', a: '' }] }, { type: 'faq', items: [] }] });
  ok('validation keeps only complete questions, and drops an empty FAQ', v.doc.blocks.length === 1 && v.doc.blocks[0].items.length === 1 && v.dropped.length === 1);
  const html = renderBlocks({ blocks: [faq] }, {});
  ok('a FAQ renders as an accordion with no script', html.includes('<details><summary>How much does it cost?</summary>') && !/<script(?![^>]*ld\+json)/.test(html));
  const hostile = renderBlocks({ blocks: [{ type: 'faq', items: [{ q: '</script><b>x', a: [{ text: 'a' }] }] }] }, {});
  ok('a hostile question cannot close the data script', !hostile.includes('</script><b>') && hostile.split('</script>').length === 2);
  ok('FAQPage data is included', /FAQPage/.test(html));
  const form = renderBlocks({ blocks: [forms[0]] }, { enquiryAction: '/enquire/whanganui' });
  ok('a contact form posts to the server and carries a hidden honeypot', /action="\/enquire\/whanganui"/.test(form) && /name="website"/.test(form) && /aria-hidden="true"/.test(form));
  ok('the trial form asks who it is for', renderBlocks({ blocks: [forms[1]] }, { enquiryAction: '/enquire/x' }).includes('name="who"'));
  ok('with nowhere to post, no dead form is shown', renderBlocks({ blocks: [forms[0]] }, {}) === '');
  ok('the answers are searchable', toText({ blocks: [faq] }).includes('free for the first class'));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
