/**
 * HONBU — A WHOLE DOCUMENT AS ONE PIECE OF TEXT
 *
 * Writing an article a block at a time — add a block, pick a type, type into
 * a field, add another — is tedious, and Richard was right to say so. What
 * people want is one box they can write in.
 *
 * What they do NOT want, whatever they think they are asking for, is a rich
 * editor that stores HTML. The block document is why the same page can become
 * a website today and a PDF or an app screen later, and it is why a page can
 * contain a list of clubs that is never out of date — that block is a query,
 * not text, and no HTML editor can hold one.
 *
 * So: one box, written in a small markup, parsed back into blocks on save.
 * The markup is close enough to Markdown that anybody who has used a forum
 * will guess most of it, and the parts that are not Markdown are the live
 * blocks, which no Markdown dialect has a notion of.
 *
 *     ## A heading
 *
 *     A paragraph, with **bold**, *italic* and [links](https://example.nz).
 *
 *     - a list
 *     - of things
 *
 *     1. or a numbered
 *     2. one
 *
 *     > A quotation
 *     > — Mas Oyama
 *
 *     ![Doug bowing in](a1b2c3d4-...)
 *
 *     !> Note: a callout box
 *     !! Warning: the other kind
 *
 *     ---
 *
 *     {{clubs}}
 *     {{events kind=grading limit=3}}
 *     {{honours award=Kokoro}}
 *     {{video youtube=dQw4w9WgXcQ}}
 *     {{trial club=whanganui heading=Try_a_free_class button=Book_now}}
 *
 * The round trip is the thing to get right. A document read into text and
 * written back must be the same document, or somebody opens an old page in
 * the new editor, saves it, and quietly loses a block. There is a test that
 * takes every block type, converts both ways twice, and compares.
 */
import { richFromText, textFromRich } from './marks.mjs';

const BLANK = /^\s*$/;

// ---------------------------------------------------------------------------
// blocks → text
// ---------------------------------------------------------------------------

/** A live block's settings, written back as the attributes they came from. */
function attrs(pairs) {
  const parts = Object.entries(pairs)
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
    .map(([k, v]) => `${k}=${String(v).replace(/\s+/g, '_')}`);
  return parts.length ? ` ${parts.join(' ')}` : '';
}

function blockToText(block, names) {
  switch (block.type) {
    case 'heading': {
      const level = Math.min(Math.max(Number(block.level) || 2, 2), 4);
      return `${'#'.repeat(level)} ${block.text ?? ''}`;
    }

    case 'paragraph':
      return textFromRich(block.text ?? []);

    case 'list': {
      const items = (block.items ?? []).map((item, i) =>
        block.ordered ? `${i + 1}. ${textFromRich(item)}`
                      : `- ${textFromRich(item)}`);
      return items.join('\n');
    }

    case 'quote': {
      const lines = textFromRich(block.text ?? []).split('\n')
        .map((l) => `> ${l}`);
      if (block.attribution) lines.push(`> — ${block.attribution}`);
      return lines.join('\n');
    }

    case 'image': {
      // By filename when we know one. Nobody can remember
      // a1b2c3d4-5e6f-… , and an editor that asks them to is an editor
      // people leave in order to go and look it up.
      const ref = names?.get(block.assetId) ?? block.assetId ?? '';
      return `![${block.alt ?? ''}](${ref})`
        + (block.caption ? `\n*${block.caption}*` : '');
    }

    case 'callout': {
      const marker = block.tone === 'warning' ? '!!' : '!>';
      return textFromRich(block.text ?? []).split('\n')
        .map((l) => `${marker} ${l}`).join('\n');
    }

    case 'divider':
      return '---';

    case 'embed':
      return `{{video ${block.provider ?? 'youtube'}=${block.id ?? ''}${
        block.caption ? ` caption=${block.caption.replace(/\s+/g, '_')}` : ''}}}`;

    case 'dojoList':
      return `{{clubs${attrs({ heading: block.heading })}}}`;

    case 'eventList':
      return `{{events${attrs({ heading: block.heading, kind: block.kind,
                                limit: block.limit })}}}`;

    case 'honours':
      return `{{honours${attrs({ heading: block.heading, award: block.award })}}}`;

    case 'roll':
      return `{{roll${attrs({ heading: block.heading })}}}\n`
        + (block.entries ?? []).map((e) => `${e.name} | ${e.year}`).join('\n')
        + '\n{{/roll}}';

    case 'faq':
      return `{{faq${attrs({ heading: block.heading })}}}\n`
        + (block.items ?? []).map((it) => `? ${it.q}\n${textFromRich(it.a ?? [])}`).join('\n\n')
        + '\n{{/faq}}';

    case 'contactForm':
      return `{{contact${attrs({ heading: block.heading, intro: block.intro,
                                 kind: block.kind === 'trial' ? 'trial' : '' })}}}`;

    case 'trialCta':
      return `{{trial${attrs({ heading: block.heading, text: block.text, button: block.button,
                               club: block.club })}}}`;

    default:
      // A block type nobody taught this about must survive being edited in
      // the one-box editor. Losing it silently is exactly the failure this
      // whole file is built to avoid, so it is written out as something the
      // parser gives straight back.
      return `{{raw ${JSON.stringify(block)}}}`;
  }
}

/** A whole document as one piece of text. */
export function textFromDocument(doc, { images = [] } = {}) {
  // id → filename, so an image block comes back as the name somebody chose
  // rather than the uuid the database uses. Ambiguous names are left as ids:
  // two files called photo.png cannot both be "photo.png" in the text.
  const counts = new Map();
  for (const i of images)
    counts.set(i.filename, (counts.get(i.filename) ?? 0) + 1);
  const names = new Map();
  for (const i of images)
    if (i.filename && counts.get(i.filename) === 1) names.set(i.id, i.filename);

  return (doc?.blocks ?? []).map((b) => blockToText(b, names)).join('\n\n').trim();
}

// ---------------------------------------------------------------------------
// text → blocks
// ---------------------------------------------------------------------------

/** `kind=grading limit=3` → { kind: 'grading', limit: '3' } */
function readAttrs(rest = '') {
  const out = {};
  for (const [, k, v] of rest.matchAll(/([a-zA-Z]+)=([^\s]+)/g))
    out[k] = v.replace(/_/g, ' ');
  return out;
}

function liveBlock(inner) {
  const [name, ...rest] = inner.trim().split(/\s+/);
  const a = readAttrs(rest.join(' '));

  switch (name) {
    case 'clubs':
    case 'dojos':
      return { type: 'dojoList', heading: a.heading ?? '' };

    case 'events':
      return { type: 'eventList', heading: a.heading ?? '',
               kind: a.kind ?? '', limit: a.limit ? Number(a.limit) : null };

    case 'honours':
      return { type: 'honours', heading: a.heading ?? '', award: a.award ?? '' };

    case 'contact':
    case 'enquiry':
      return { type: 'contactForm', heading: a.heading ?? '', intro: a.intro ?? '',
               kind: a.kind === 'trial' ? 'trial' : 'contact' };

    case 'trial':
      return { type: 'trialCta', heading: a.heading ?? '', text: a.text ?? '',
               button: a.button ?? '', club: a.club ?? '' };

    case 'video': {
      const provider = a.vimeo ? 'vimeo' : 'youtube';
      return { type: 'embed', provider,
               id: a.youtube ?? a.vimeo ?? '', caption: a.caption ?? '' };
    }

    case 'raw':
      try { return JSON.parse(rest.join(' ')); } catch { return null; }

    default:
      return null;
  }
}

/**
 * Parse one box of text into blocks.
 *
 * Deliberately forgiving. Somebody typing into a textarea is not writing a
 * document format, and anything this does not recognise becomes a paragraph
 * rather than an error — losing what they wrote to teach them a syntax would
 * be the wrong trade every time.
 */
export function documentFromText(text = '', { images = [] } = {}) {
  // filename → id, so what somebody typed finds the image they meant.
  // Case-insensitive, because nobody types Crest.PNG the same way twice.
  const byName = new Map();
  for (const i of images)
    if (i.filename) byName.set(String(i.filename).toLowerCase(), i.id);
  const resolve = (ref) => byName.get(String(ref).toLowerCase()) ?? ref;

  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;

  const push = (b) => { if (b) blocks.push(b); };

  while (i < lines.length) {
    const line = lines[i];

    if (BLANK.test(line)) { i += 1; continue; }

    // {{roll}} … {{/roll}}: one "Name | year" per line.
    if (/^\s*\{\{roll\b/.test(line)) {
      const opener = line.trim().replace(/^\{\{/, '').replace(/\}\}$/, '');
      const a = readAttrs(opener.replace(/^roll\s*/, ''));
      const entries = [];
      i += 1;
      while (i < lines.length && !/^\s*\{\{\/roll\}\}\s*$/.test(lines[i])) {
        const [name, ...rest] = lines[i].split('|');
        if (name.trim()) entries.push({ name: name.trim(), year: rest.join('|').trim() });
        i += 1;
      }
      i += 1;
      push({ type: 'roll', heading: a.heading ?? '', entries });
      continue;
    }

    // {{faq}} … {{/faq}}: questions start with "? ", answers follow.
    if (/^\s*\{\{faq\b/.test(line)) {
      const opener = line.trim().replace(/^\{\{/, '').replace(/\}\}$/, '');
      const a = readAttrs(opener.replace(/^faq\s*/, ''));
      const items = [];
      let cur = null;
      i += 1;
      while (i < lines.length && !/^\s*\{\{\/faq\}\}\s*$/.test(lines[i])) {
        const m = lines[i].match(/^\s*\?\s+(.*)$/);
        if (m) { cur = { q: m[1].trim(), answer: [] }; items.push(cur); }
        else if (cur) cur.answer.push(lines[i]);
        i += 1;
      }
      i += 1;                       // past {{/faq}} (or the end)
      push({ type: 'faq', heading: a.heading ?? '',
             items: items.map((it) => ({ q: it.q, a: richFromText(it.answer.join('\n').trim()) })) });
      continue;
    }

    // {{...}} possibly spanning lines, because {{raw {...}}} is long.
    if (line.trimStart().startsWith('{{')) {
      let inner = line.trim();
      while (!inner.endsWith('}}') && i + 1 < lines.length) {
        i += 1; inner += `\n${lines[i]}`;
      }
      const parsed = liveBlock(inner.replace(/^\{\{/, '').replace(/\}\}$/, ''));
      if (parsed) { push(parsed); i += 1; continue; }

      // Not a live block anybody taught this about. It becomes a paragraph
      // saying what they typed.
      //
      // An earlier version let this fall through to the paragraph branch
      // below, which refuses lines starting with {{ — so it consumed nothing,
      // advanced past the line, and the text was gone. Somebody mistyping
      // {{clubs}} would have lost the line and never been told.
      push({ type: 'paragraph', text: richFromText(inner) });
      i += 1; continue;
    }

    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      push({ type: 'divider' });
      i += 1; continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      push({ type: 'heading',
             level: Math.min(Math.max(heading[1].length, 2), 4),
             text: heading[2].trim() });
      i += 1; continue;
    }

    // An image, with an optional italic caption on the next line.
    const image = line.match(/^!\[([^\]]*)\]\(([^)]*)\)\s*$/);
    if (image) {
      const block = { type: 'image', alt: image[1].trim(),
                      assetId: resolve(image[2].trim()), caption: '' };
      const next = lines[i + 1];
      const caption = next?.match(/^\*([^*]+)\*\s*$/);
      if (caption) { block.caption = caption[1].trim(); i += 1; }
      push(block);
      i += 1; continue;
    }

    const callout = line.match(/^(!!|!>)\s?(.*)$/);
    if (callout) {
      const marker = callout[1];
      const body = [callout[2]];
      while (i + 1 < lines.length) {
        const m = lines[i + 1].match(/^(!!|!>)\s?(.*)$/);
        if (!m || m[1] !== marker) break;
        body.push(m[2]); i += 1;
      }
      push({ type: 'callout',
             tone: marker === '!!' ? 'warning' : 'note',
             text: richFromText(body.join('\n').trim()) });
      i += 1; continue;
    }

    if (/^\s*>/.test(line)) {
      const body = [];
      let attribution = '';
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        const content = lines[i].replace(/^\s*>\s?/, '');
        const dash = content.match(/^[—–-]\s*(.+)$/);
        if (dash && body.length) attribution = dash[1].trim();
        else body.push(content);
        i += 1;
      }
      push({ type: 'quote', text: richFromText(body.join('\n').trim()),
             attribution });
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/;
    const number = /^\s*\d+[.)]\s+(.*)$/;
    if (bullet.test(line) || number.test(line)) {
      const ordered = number.test(line);
      const pattern = ordered ? number : bullet;
      const items = [];
      while (i < lines.length && pattern.test(lines[i])) {
        items.push(richFromText(lines[i].match(pattern)[1].trim()));
        i += 1;
      }
      push({ type: 'list', ordered, items });
      continue;
    }

    // Everything else is a paragraph, running until a blank line or until
    // something that is plainly a different kind of block starts.
    const body = [];
    while (i < lines.length && !BLANK.test(lines[i])
           && !/^(#{1,6}\s|>|!!|!>|\s*[-*+]\s|\s*\d+[.)]\s|!\[)/.test(lines[i])
           && !lines[i].trimStart().startsWith('{{')
           && !/^\s*(---+|\*\*\*+)\s*$/.test(lines[i])) {
      body.push(lines[i]); i += 1;
    }
    if (body.length) push({ type: 'paragraph',
                            text: richFromText(body.join('\n').trim()) });
    else i += 1;          // nothing consumed: do not spin
  }

  return { blocks };
}

/** Shown under the box. Short on purpose — a wall of syntax teaches nobody. */
export const WRITING_HELP = [
  ['## Heading', 'a heading'],
  ['**bold**  *italic*', 'emphasis'],
  ['[words](https://…)', 'a link'],
  ['- item', 'a list'],
  ['> quoted', 'a quotation'],
  ['![description](image reference)', 'a picture'],
  ['!> Note', 'a note box'],
  ['---', 'a dividing line'],
  ['{{clubs}} {{events}} {{faq}} {{roll}} {{contact}}', 'live lists, questions and answers, a roll of honour, a contact form'],
];
