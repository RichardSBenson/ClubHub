/**
 * HONBU — block documents
 *
 * The authored layer: about fifteen pages per federation that are not
 * projections of the register.
 *
 * Stored as STRUCTURED JSON, never as HTML. Three reasons:
 *   1. It can be rendered to HTML, to a PDF certificate, to a wallet pass or to
 *      plain text for an email, from one source.
 *   2. Nothing a volunteer pastes in from Word can inject markup or script.
 *   3. It can be validated. HTML soup cannot.
 *
 * Anything not in this file's whitelist is dropped, quietly and completely.
 */

import { esc } from '../core/domain/html.mjs';
import { region } from '../infrastructure/region-context.mjs';

// ---------------------------------------------------------------------------
// the whitelist
// ---------------------------------------------------------------------------

export const BLOCKS = {
  heading:   { fields: { text: 'string', level: 'number' } },
  paragraph: { fields: { text: 'rich' } },
  list:      { fields: { items: 'rich[]', ordered: 'boolean' } },
  quote:     { fields: { text: 'rich', attribution: 'string' } },
  image:     { fields: { assetId: 'string', caption: 'string', alt: 'string' } },
  callout:   { fields: { text: 'rich', tone: 'enum:note,warning' } },
  divider:   { fields: {} },
  embed:     { fields: { provider: 'enum:youtube,vimeo', id: 'string',
                         caption: 'string' } },
  // Pulls live data into an authored page. The point of one system.
  clubList:  { fields: { heading: 'string' } },
  eventList: { fields: { heading: 'string', kind: 'string', limit: 'number' } },
  honours:   { fields: { heading: 'string', award: 'string' } },
  // A written-out roll of honour (name and year), shown as an even grid of cards.
  roll:      { fields: { heading: 'string', entries: 'roll[]' } },
  // Questions and answers, as a no-JavaScript accordion and as FAQPage data.
  faq:       { fields: { heading: 'string', items: 'faq[]' } },
  // A form that writes to the organisation's enquiries inbox.
  contactForm: { fields: { heading: 'string', intro: 'string', kind: 'enum:contact,trial' } },
  // A big "try a free class" panel. With a club it goes to that club's enquiry form; without one
  // it goes to the list of clubs so the visitor can choose their nearest.
  trialCta:  { fields: { heading: 'string', text: 'string', button: 'string', club: 'string' } },
};

const MARKS = new Set(['strong', 'em', 'link']);
const SAFE_PROTOCOL = /^(https?:|mailto:|tel:|\/)/i;

// ---------------------------------------------------------------------------
// rich text — an array of runs, each with optional marks
// ---------------------------------------------------------------------------

/**
 * [{ text: 'Hanshi Doug', marks: ['strong'] },
 *  { text: ' opened the first club' }]
 */
function cleanRich(value) {
  if (typeof value === 'string') return [{ text: value }];
  if (!Array.isArray(value)) return [];
  return value.flatMap((run) => {
    if (typeof run === 'string') return [{ text: run }];
    if (!run || typeof run.text !== 'string') return [];
    const out = { text: run.text };
    const marks = (run.marks ?? []).filter((m) => MARKS.has(m));
    if (marks.length) out.marks = marks;
    if (marks.includes('link')) {
      if (typeof run.href === 'string' && SAFE_PROTOCOL.test(run.href.trim())) {
        out.href = run.href.trim();
      } else {
        out.marks = marks.filter((m) => m !== 'link');   // drop the mark, keep the words
        if (!out.marks.length) delete out.marks;
      }
    }
    return [out];
  }).filter((r) => r.text !== '');
}

/**
 * `origin` is this federation's own site. A link that starts with it is
 * internal; everything else is external and gets rel="noopener". This used to
 * test for "kyokushinkarate" in the URL, which is one federation's domain
 * written into shared code — every other federation's own links would have
 * been treated as somebody else's.
 */
function renderRich(runs, origin = '') {
  // Never trust the input. Documents can arrive from a migration, a seed or an
  // older schema version, and a renderer that throws takes the whole site down.
  const safe = Array.isArray(runs) && runs.every((r) => r && typeof r === 'object')
    ? runs : cleanRich(runs);
  return safe.map((r) => {
    let html = esc(r.text);
    for (const m of r.marks ?? []) {
      if (m === 'strong') html = `<strong>${html}</strong>`;
      if (m === 'em') html = `<em>${html}</em>`;
      if (m === 'link' && r.href) {
        // External means "not this federation's own site". Which site that is
        // is configuration, not something to recognise by name.
        const ext = /^https?:/i.test(r.href)
          && !(origin && r.href.startsWith(origin));
        html = `<a href="${esc(r.href)}"${ext ? ' rel="noopener"' : ''}>${html}</a>`;
      }
    }
    return html;
  }).join('');
}

// ---------------------------------------------------------------------------
// validation — returns a clean document and a list of what was dropped
// ---------------------------------------------------------------------------

/** Pages saved before the platform stopped using karate's word for a club call this block by its old name. */
const LEGACY_TYPE = { 'dojoList': 'clubList' }; // arch-ok: reading names saved before the rename
const typeOf = (t) => LEGACY_TYPE[t] ?? t;

export function validate(doc) {
  const dropped = [];
  const blocks = [];

  for (const [i, raw] of (doc?.blocks ?? []).entries()) {
    const spec = BLOCKS[typeOf(raw?.type)];
    if (!spec) { dropped.push(`block ${i}: unknown type "${raw?.type}"`); continue; }

    const block = { type: typeOf(raw.type) };
    for (const [field, kind] of Object.entries(spec.fields)) {
      const v = raw[field];
      if (v === undefined || v === null) continue;

      if (kind === 'rich') block[field] = cleanRich(v);
      else if (kind === 'rich[]') block[field] = (Array.isArray(v) ? v : []).map(cleanRich);
      else if (kind === 'faq[]') {
        block[field] = (Array.isArray(v) ? v : []).slice(0, 60).flatMap((it) => {
          const q = String(it?.q ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
          const a = cleanRich(it?.a);
          return q && a.some((r) => r.text.trim()) ? [{ q, a }] : [];
        });
      }
      else if (kind === 'roll[]') {
        block[field] = (Array.isArray(v) ? v : []).slice(0, 200).flatMap((it) => {
          const name = String(it?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
          const year = String(it?.year ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
          return name ? [{ name, year }] : [];
        });
      }
      else if (kind === 'string') block[field] = String(v).slice(0, 2000);
      else if (kind === 'number') block[field] = Number(v) || 0;
      else if (kind === 'boolean') block[field] = !!v;
      else if (kind.startsWith('enum:')) {
        const allowed = kind.slice(5).split(',');
        if (allowed.includes(v)) block[field] = v;
        else dropped.push(`block ${i}: "${v}" is not a valid ${field}`);
      }
    }

    for (const key of Object.keys(raw)) {
      if (key !== 'type' && !(key in spec.fields))
        dropped.push(`block ${i}: unexpected field "${key}"`);
    }

    if (block.type === 'heading')
      block.level = Math.min(4, Math.max(2, block.level ?? 2));   // never h1
    if (block.type === 'faq' && !block.items?.length) {
      dropped.push(`block ${i}: a FAQ with no complete question and answer`); continue;
    }
    if (block.type === 'roll' && !block.entries?.length) {
      dropped.push(`block ${i}: a roll of honour with no names`); continue;
    }
    if (block.type === 'paragraph' && !block.text?.length) {
      dropped.push(`block ${i}: empty paragraph`); continue;
    }

    blocks.push(block);
  }

  return { doc: { blocks }, dropped };
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

/**
 * `data` supplies the live blocks: { clubs, events, honours }.
 * Absent data renders nothing rather than an empty shell.
 */
export function renderBlocks(doc, data = {}, { origin = '' } = {}) {
  return (doc?.blocks ?? []).map((b) => {
    switch (typeOf(b.type)) {
      case 'heading':
        return `<h${b.level}>${esc(b.text ?? '')}</h${b.level}>`;

      case 'paragraph':
        return `<p>${renderRich(b.text ?? [], origin)}</p>`;

      case 'list': {
        const tag = b.ordered ? 'ol' : 'ul';
        const items = Array.isArray(b.items) ? b.items : [];
        return `<${tag}>${items
          .map((i) => `<li>${renderRich(i, origin)}</li>`).join('')}</${tag}>`;
      }

      case 'quote':
        return `<blockquote><p>${renderRich(b.text ?? [], origin)}</p>` +
          (b.attribution ? `<cite>${esc(b.attribution)}</cite>` : '') + `</blockquote>`;

      case 'image': {
        const src = data.assets?.[b.assetId];
        if (!src) return '';                               // missing asset: nothing
        return `<figure><img src="${esc(src)}" alt="${esc(b.alt ?? '')}" loading="lazy">` +
          (b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : '') + `</figure>`;
      }

      case 'callout':
        return `<div class="callout ${b.tone === 'warning' ? 'warn' : 'note'}">` +
          `<p>${renderRich(b.text ?? [], origin)}</p></div>`;

      case 'divider':
        return '<hr>';

      case 'embed': {
        if (b.provider === 'youtube' && /^[\w-]{6,20}$/.test(b.id ?? ''))
          return `<figure class="embed"><iframe loading="lazy" ` +
            `src="https://www.youtube-nocookie.com/embed/${esc(b.id)}" ` +
            `title="${esc(b.caption ?? 'Video')}" allowfullscreen></iframe>` +
            (b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : '') + `</figure>`;
        return '';
      }

      case 'clubList': {
        const clubs = data.clubs ?? [];
        if (!clubs.length) return '';
        return (b.heading ? `<h2>${esc(b.heading)}</h2>` : '') +
          `<div class="grid">${clubs.map((d) =>
            `<a href="/${esc(d.slug)}"><strong>${esc(d.name)}</strong>` +
            `<span>${esc(d.city ?? '')}</span></a>`).join('')}</div>`;
      }

      case 'eventList': {
        let evs = data.events ?? [];
        if (b.kind) evs = evs.filter((e) => e.kind === b.kind);
        evs = evs.slice(0, b.limit || 5);
        if (!evs.length) return '';
        return (b.heading ? `<h2>${esc(b.heading)}</h2>` : '') +
          `<ul class="events">${evs.map((e) => {
            const d = new Date(e.starts_at);
            return `<li><div class="d"><b>${d.getDate()}</b>` +
              `<span>${d.toLocaleDateString(region().locale, { month: 'short' })}</span></div>` +
              `<div><h3><a href="/events/${esc(e.slug)}">${esc(e.title)}</a></h3></div></li>`;
          }).join('')}</ul>`;
      }

      case 'honours': {
        const rows = data.honours?.[b.award] ?? [];
        if (!rows.length) return '';
        return (b.heading ? `<h2>${esc(b.heading)}</h2>` : '') +
          `<table class="times"><tbody>${rows.map((r) =>
            `<tr><td><strong>${esc(r.name)}</strong></td>` +
            `<td>${esc(String(r.year))}</td></tr>`).join('')}</tbody></table>`;
      }

      case 'roll': {
        const rows = b.entries ?? [];
        return (b.heading ? `<h2>${esc(b.heading)}</h2>` : '') +
          `<table class="roll"><thead><tr><th scope="col">Name</th>` +
          `<th scope="col">Year</th></tr></thead><tbody>${rows.map((r) =>
            `<tr><td>${esc(r.name)}</td><td>${esc(r.year)}</td></tr>`).join('')}</tbody></table>`;
      }

      case 'faq': {
        const items = (Array.isArray(b.items) ? b.items : []).filter((it) => it?.q);
        if (!items.length) return '';
        // <details> is an accordion with no script, and works with a screen reader.
        // The same questions go out as FAQPage data for search engines; '<' is
        // escaped so a question cannot close the script element.
        const ld = JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage',
          mainEntity: items.map((it) => ({ '@type': 'Question', name: it.q,
            acceptedAnswer: { '@type': 'Answer', text: wordsOf(it.a) } })) }).replace(/</g, '\\u003c');
        return (b.heading ? `<h2>${esc(b.heading)}</h2>` : '') +
          `<div class="faq">${items.map((it) => `<details><summary>${esc(it.q)}</summary>` +
            `<p>${renderRich(it.a, origin)}</p></details>`).join('')}</div>` +
          `<script type="application/ld+json">${ld}</script>`;
      }

      case 'contactForm': {
        // The form posts to the server (the site itself is static). Without
        // somewhere to post to, nothing is shown rather than a dead form.
        const action = data.enquiryAction;
        if (!action) return '';
        const trial = b.kind === 'trial';
        return `<form class="enquiry" method="post" action="${esc(action)}">` +
          (b.heading ? `<h2>${esc(b.heading)}</h2>` : '') +
          (b.intro ? `<p>${esc(b.intro)}</p>` : '') +
          `<input type="hidden" name="kind" value="${trial ? 'trial' : 'contact'}">` +
          `<label for="enq-name">Your name</label><input id="enq-name" name="name" maxlength="100" required autocomplete="name">` +
          `<label for="enq-email">Email</label><input id="enq-email" name="email" type="email" maxlength="120" required autocomplete="email">` +
          `<label for="enq-phone">Phone <span>(optional)</span></label><input id="enq-phone" name="phone" maxlength="30" autocomplete="tel">` +
          (trial ? `<label for="enq-who">Who is it for, and how old? <span>(for example: my son, 9)</span></label><input id="enq-who" name="who" maxlength="100">` : '') +
          `<label for="enq-message">${trial ? 'Anything we should know (experience, injuries)?' : 'Your message'}</label>` +
          `<textarea id="enq-message" name="message" rows="5" maxlength="2000"${trial ? '' : ' required'}></textarea>` +
          // A box people never see. Anything that fills it in is not a person.
          `<div style="position:absolute;left:-9999px" aria-hidden="true"><label>Leave this empty` +
          `<input name="website" tabindex="-1" autocomplete="off"></label></div>` +
          `<button type="submit">${trial ? 'Ask about a free class' : 'Send'}</button></form>`;
      }

      case 'trialCta': {
        const club = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(b.club ?? '') ? b.club : null;
        const href = club ? `/enquire/${club}?kind=trial` : '/find-a-club';
        return `<div class="trialcta"><h2>${esc(b.heading || 'Try a free class')}</h2>`
          + (b.text ? `<p>${esc(b.text)}</p>` : '')
          + `<a class="btn light" href="${esc(href)}">${esc(b.button || (club ? 'Book a free class' : 'Find your nearest club'))}</a></div>`;
      }

      default:
        return '';
    }
  }).filter(Boolean).join('\n');
}

/**
 * The words out of a rich-text value, whatever shape it is in.
 *
 * Rich text is an array of runs. It is also, legally, a bare string — cleanRich
 * accepts one and this file has always said so. But a document that came from a
 * seed, a migration or somebody's SQL console never went through cleanRich, so
 * it arrives exactly as it was written.
 *
 * Both readers below used to assume the array. A single page with a plain
 * string in it killed the whole site build with "(p.text ?? []).map is not a
 * function" — no page name, no slug, just a stack. Reading is where a document
 * from outside arrives, so reading is where it has to be tolerated.
 */
function wordsOf(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((run) =>
    typeof run === 'string' ? run : String(run?.text ?? '')).join('');
}

/** First paragraph, trimmed — a fallback meta description. */
export function excerpt(doc, max = 155) {
  const p = (doc?.blocks ?? []).find((b) => b.type === 'paragraph');
  if (!p) return '';
  const text = wordsOf(p.text);
  if (text.length <= max) return text;
  // lastIndexOf returns -1 when there is no space to break on, and slicing to
  // -1 drops the last character instead of cutting at the limit.
  const cut = text.lastIndexOf(' ', max);
  return text.slice(0, cut > 0 ? cut : max) + '…';
}

/** Plain text, for search indexing and for checking a page is not empty. */
export function toText(doc) {
  return (doc?.blocks ?? []).map((b) => {
    if (b.type === 'heading') return typeof b.text === 'string' ? b.text : wordsOf(b.text);
    if (b.type === 'paragraph' || b.type === 'callout' || b.type === 'quote')
      return wordsOf(b.text);
    if (b.type === 'list')
      return (b.items ?? []).map(wordsOf).join(' ');
    if (b.type === 'roll')
      return (b.entries ?? []).map((e) => `${e.name} ${e.year}`).join('\n');
    if (b.type === 'faq')
      return (b.items ?? []).map((it) => `${it.q ?? ''} ${wordsOf(it.a)}`).join('\n');
    return '';
  }).filter(Boolean).join('\n');
}

export { esc, renderRich, cleanRich };

/** The paragraphs of a document as plain strings, whether stored as text or as runs. */
export function paragraphs(doc) {
  return (doc?.blocks ?? []).filter((b) => b.type === 'paragraph').map((b) => wordsOf(b.text).trim()).filter(Boolean);
}
