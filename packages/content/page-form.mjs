/**
 * CONTENT — a submitted form becomes a block document, and back
 *
 * Every admin screen here has to work with JavaScript switched off. That is
 * not a preference: these get used in halls with bad reception, and a page
 * editor that needs a working connection to load a script is a page editor
 * that does not work where the people using it are.
 *
 * So there is no drag and drop and no live editing surface. A block is a
 * fieldset; moving one, deleting one or adding one is a button that submits
 * the whole form. Every structural change is therefore also a save, which
 * sounds wasteful and is actually the right trade: each one leaves a revision,
 * so nothing anybody does to a page is unrecoverable.
 *
 * Field names carry the block's position: `b3_text`, `b3_level`. Position
 * rather than an id because a block has no identity of its own — it is part of
 * a document, and two identical paragraphs are genuinely the same thing.
 *
 * Pure. Takes a plain object of form fields, returns a document.
 */

import { BLOCKS } from './blocks.mjs';
import { richFromText, textFromRich } from './marks.mjs';

/** Which of a block's fields are rich text, and so use the shorthand. */
const RICH = new Set(['rich', 'rich[]']);

/**
 * The editor offers these, in this order, with words rather than type names.
 * `dojoList`, `eventList` and `honours` pull live data into an authored page,
 * which is the whole point of the register and the website being one system.
 */
export const BLOCK_MENU = [
  ['heading', 'Heading'],
  ['paragraph', 'Paragraph'],
  ['list', 'List'],
  ['quote', 'Quotation'],
  ['callout', 'Callout box'],
  ['image', 'Image'],
  ['embed', 'Video'],
  ['divider', 'Divider'],
  ['dojoList', 'List of clubs (live)'],
  ['eventList', 'Upcoming events (live)'],
  ['honours', 'Honours board (live)'],
];

/** A new block of this type, with nothing in it yet. */
export function emptyBlock(type) {
  if (!BLOCKS[type]) return null;
  const block = { type };
  for (const [name, kind] of Object.entries(BLOCKS[type].fields)) {
    if (kind === 'number') block[name] = type === 'heading' ? 2 : null;
    else if (kind === 'boolean') block[name] = false;
    else if (kind === 'rich[]') block[name] = [];
    else if (RICH.has(kind)) block[name] = [];
    else block[name] = '';
  }
  return block;
}

// ---------------------------------------------------------------------------
// document → form
// ---------------------------------------------------------------------------

/**
 * What the editor puts in the inputs.
 *
 * Rich text comes back as the shorthand the author typed; a list comes back as
 * one item per line, because that is how somebody writes a list.
 */
export function formFromDocument(doc) {
  const blocks = doc?.blocks ?? [];
  const values = {};

  blocks.forEach((block, i) => {
    const spec = BLOCKS[block.type];
    if (!spec) return;
    values[`b${i}_type`] = block.type;
    for (const [name, kind] of Object.entries(spec.fields)) {
      const key = `b${i}_${name}`;
      const value = block[name];
      if (kind === 'rich[]') {
        values[key] = (value ?? []).map(textFromRich).join('\n');
      } else if (RICH.has(kind)) {
        values[key] = textFromRich(value);
      } else if (kind === 'boolean') {
        values[key] = value ? '1' : '';
      } else {
        values[key] = value == null ? '' : String(value);
      }
    }
  });

  values.blockCount = String(blocks.length);
  return values;
}

// ---------------------------------------------------------------------------
// form → document
// ---------------------------------------------------------------------------

/**
 * Read the blocks back out of a submitted form.
 *
 * Nothing is validated here — that is blocks.mjs's job, and it happens on the
 * way into the database where it cannot be skipped. This only reassembles.
 */
export function documentFromForm(form = {}) {
  const count = Math.max(0, Math.min(200, Number(form.blockCount) || 0));
  const blocks = [];

  for (let i = 0; i < count; i++) {
    const type = form[`b${i}_type`];
    const spec = BLOCKS[type];
    if (!spec) continue;                       // a type we do not know: drop it

    const block = { type };
    for (const [name, kind] of Object.entries(spec.fields)) {
      const raw = form[`b${i}_${name}`];
      if (kind === 'rich[]') {
        block[name] = String(raw ?? '').split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map(richFromText);
      } else if (RICH.has(kind)) {
        block[name] = richFromText(raw);
      } else if (kind === 'number') {
        const n = Number(raw);
        block[name] = raw === '' || raw == null || Number.isNaN(n) ? null : n;
      } else if (kind === 'boolean') {
        block[name] = !!raw;
      } else {
        block[name] = String(raw ?? '').trim();
      }
    }
    blocks.push(block);
  }

  return { blocks };
}

// ---------------------------------------------------------------------------
// structural changes
// ---------------------------------------------------------------------------

/**
 * Which button was pressed.
 *
 * A form with several submit buttons sends only the one that was clicked, so
 * `op=up:3` in the button's value is how a no-JavaScript page says "move the
 * fourth block up" without a line of script.
 */
export function applyOperation(doc, op) {
  const blocks = [...(doc?.blocks ?? [])];
  const [kind, argument] = String(op ?? '').split(':');
  const at = Number(argument);

  switch (kind) {
    case 'up':
      if (at > 0 && at < blocks.length)
        [blocks[at - 1], blocks[at]] = [blocks[at], blocks[at - 1]];
      break;

    case 'down':
      if (at >= 0 && at < blocks.length - 1)
        [blocks[at], blocks[at + 1]] = [blocks[at + 1], blocks[at]];
      break;

    case 'remove':
      if (at >= 0 && at < blocks.length) blocks.splice(at, 1);
      break;

    case 'add': {
      const block = emptyBlock(argument);
      // Added at the end, where somebody writing a page is looking. An
      // insert-at-position would need a second control for no real gain when
      // moving it up two is one click.
      if (block) blocks.push(block);
      break;
    }

    default:                                   // 'save', or anything unknown
      break;
  }

  return { blocks };
}

/**
 * Whether this document would survive being saved.
 *
 * `pages.save` refuses a document with no text in it, which is correct — an
 * empty page is not a page. But somebody who has just added a heading and not
 * yet typed in it should be told that, before they lose the rest of their
 * work to a refusal they did not expect.
 */
export function looksEmpty(doc) {
  const blocks = doc?.blocks ?? [];
  if (!blocks.length) return true;
  return !blocks.some((b) => {
    if (b.type === 'divider') return false;
    // A live block is content even with nothing typed into it: it pulls the
    // clubs or the events in at render time.
    if (b.type === 'dojoList' || b.type === 'eventList' || b.type === 'honours')
      return true;
    // `type` is skipped deliberately: it is always a non-empty string, so
    // counting it would make every block look like it had content in it.
    return Object.entries(b).some(([k, v]) =>
      k !== 'type'
      && ((typeof v === 'string' && v.trim())
          || (Array.isArray(v) && v.length)));
  });
}
