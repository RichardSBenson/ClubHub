import { validate, renderBlocks, excerpt, toText } from './blocks.mjs';

let pass = 0, fail = 0;
const ok = (n, c, d='') => c ? (pass++, console.log(`  ✓ ${n}`))
                             : (fail++, console.log(`  ✗ ${n}  ${d}`));

console.log('\nANYTHING NOT WHITELISTED IS DROPPED');
{
  const { doc, dropped } = validate({ blocks: [
    { type: 'script', src: 'evil.js' },
    { type: 'paragraph', text: 'Kept.' },
    { type: 'paragraph', text: 'Also kept.', onclick: 'steal()' },
  ]});
  ok('unknown block type removed', doc.blocks.length === 2);
  ok('and reported', dropped.some(d => d.includes('unknown type')));
  ok('unexpected field reported', dropped.some(d => d.includes('onclick')));
  ok('and stripped', !JSON.stringify(doc).includes('onclick'));
}

console.log('\nNOTHING PASTED IN CAN INJECT MARKUP');
{
  const { doc } = validate({ blocks: [
    { type: 'paragraph', text: '<script>alert(1)</script> and <b>bold</b>' },
    { type: 'heading', text: '"><img src=x onerror=alert(1)>', level: 2 },
  ]});
  const html = renderBlocks(doc);
  ok('script tag escaped', !html.includes('<script>') && html.includes('&lt;script&gt;'));
  ok('no raw tag can escape the text node',
    !/<(?!\/?(h2|h4|p|strong|em|a|br)\b)/i.test(html), html);
  ok('the quote that would break an attribute is encoded',
    html.includes('&quot;&gt;&lt;img'));
  ok('the words survive', html.includes('and &lt;b&gt;bold&lt;/b&gt;'));
}

console.log('\nLINKS ARE CHECKED, NOT TRUSTED');
{
  const { doc } = validate({ blocks: [{ type: 'paragraph', text: [
    { text: 'safe', marks: ['link'], href: 'https://example.nz' },
    { text: ' and ' },
    { text: 'nasty', marks: ['link'], href: 'javascript:alert(1)' },
  ]}]});
  const html = renderBlocks(doc);
  ok('https link kept', html.includes('href="https://example.nz"'));
  ok('javascript: link removed', !html.includes('javascript:'));
  ok('but its text is kept', html.includes('nasty'));
  ok('external links get rel=noopener', html.includes('rel="noopener"'));
}

console.log('\nHEADINGS CANNOT STEAL THE H1');
{
  const { doc } = validate({ blocks: [
    { type: 'heading', text: 'Top', level: 1 },
    { type: 'heading', text: 'Deep', level: 9 },
  ]});
  const html = renderBlocks(doc);
  ok('level 1 demoted to h2', html.includes('<h2>Top</h2>'));
  ok('level 9 clamped to h4', html.includes('<h4>Deep</h4>'));
}

console.log('\nLIVE BLOCKS PULL FROM THE REGISTER');
{
  const { doc } = validate({ blocks: [
    { type: 'dojoList', heading: 'Where we train' },
    { type: 'eventList', heading: 'Gradings', kind: 'grading', limit: 2 },
    { type: 'honours', heading: 'The 50 Man Kumite', award: 'kumite50' },
  ]});

  const empty = renderBlocks(doc, {});
  ok('no data renders nothing, not an empty shell', empty === '');

  const html = renderBlocks(doc, {
    dojos: [{ slug: 'whanganui', name: 'Whanganui', city: 'Whanganui' }],
    events: [
      { slug: 'g1', title: 'National grading', kind: 'grading', starts_at: '2026-10-17' },
      { slug: 't1', title: 'Nationals', kind: 'tournament', starts_at: '2026-11-08' },
    ],
    honours: { kumite50: [{ name: 'Graeme Gavegan', year: 1993 }] },
  });
  ok('dojo list rendered from data', html.includes('href="/whanganui"'));
  ok('event list filtered by kind', html.includes('National grading') && !html.includes('Nationals<'));
  ok('honours board rendered', html.includes('Graeme Gavegan'));
}

console.log('\nEMBEDS ARE NARROW ON PURPOSE');
{
  const { doc } = validate({ blocks: [
    { type: 'embed', provider: 'youtube', id: 'dQw4w9WgXcQ', caption: 'A class' },
    { type: 'embed', provider: 'youtube', id: '"><script>' },
  ]});
  const html = renderBlocks(doc);
  ok('valid id embedded, cookieless', html.includes('youtube-nocookie.com/embed/dQw4w9WgXcQ'));
  ok('malformed id renders nothing',
    (html.match(/<iframe/g) || []).length === 1,
    `${(html.match(/<iframe/g) || []).length} iframes`);
}

console.log('\nDERIVED TEXT');
{
  const { doc } = validate({ blocks: [
    { type: 'heading', text: 'Our lineage', level: 2 },
    { type: 'paragraph', text: 'Hanshi Doug Holloway, 8th dan, set up the first Kyokushin karate dojo in New Zealand in 1965, after returning from Japan as a student of Sosai Mas Oyama.' },
  ]});
  const ex = excerpt(doc);
  ok('excerpt fits a meta description', ex.length <= 156, ex.length);
  const long = excerpt(validate({ blocks: [{ type: 'paragraph',
    text: 'word '.repeat(80) }] }).doc);
  ok('longer text is truncated on a word boundary',
    long.endsWith('…') && long.length <= 156 && !long.includes('wor…'));
  ok('and starts with the real first sentence', ex.startsWith('Hanshi Doug Holloway'));
  ok('plain text includes the heading', toText(doc).startsWith('Our lineage'));
  console.log(`      → "${ex}"`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
