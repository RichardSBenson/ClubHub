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

const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

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
  dojoList:  { fields: { heading: 'string' } },
  eventList: { fields: { heading: 'string', kind: 'string', limit: 'number' } },
  honours:   { fields: { heading: 'string', award: 'string' } },
};

const MARKS = new Set(['strong', 'em', 'link']);
const SAFE_PROTOCOL = /^(https?:|mailto:|tel:|\/)/i;

// ---------------------------------------------------------------------------
// rich text — an array of runs, each with optional marks
// ---------------------------------------------------------------------------

/**
 * [{ text: 'Hanshi Doug', marks: ['strong'] },
 *  { text: ' opened the first dojo' }]
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

function renderRich(runs) {
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
        const ext = /^https?:/i.test(r.href) && !r.href.includes('kyokushinkarate');
        html = `<a href="${esc(r.href)}"${ext ? ' rel="noopener"' : ''}>${html}</a>`;
      }
    }
    return html;
  }).join('');
}

// ---------------------------------------------------------------------------
// validation — returns a clean document and a list of what was dropped
// ---------------------------------------------------------------------------

export function validate(doc) {
  const dropped = [];
  const blocks = [];

  for (const [i, raw] of (doc?.blocks ?? []).entries()) {
    const spec = BLOCKS[raw?.type];
    if (!spec) { dropped.push(`block ${i}: unknown type "${raw?.type}"`); continue; }

    const block = { type: raw.type };
    for (const [field, kind] of Object.entries(spec.fields)) {
      const v = raw[field];
      if (v === undefined || v === null) continue;

      if (kind === 'rich') block[field] = cleanRich(v);
      else if (kind === 'rich[]') block[field] = (Array.isArray(v) ? v : []).map(cleanRich);
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
 * `data` supplies the live blocks: { dojos, events, honours }.
 * Absent data renders nothing rather than an empty shell.
 */
export function renderBlocks(doc, data = {}) {
  return (doc?.blocks ?? []).map((b) => {
    switch (b.type) {
      case 'heading':
        return `<h${b.level}>${esc(b.text ?? '')}</h${b.level}>`;

      case 'paragraph':
        return `<p>${renderRich(b.text ?? [])}</p>`;

      case 'list': {
        const tag = b.ordered ? 'ol' : 'ul';
        const items = Array.isArray(b.items) ? b.items : [];
        return `<${tag}>${items
          .map((i) => `<li>${renderRich(i)}</li>`).join('')}</${tag}>`;
      }

      case 'quote':
        return `<blockquote><p>${renderRich(b.text ?? [])}</p>` +
          (b.attribution ? `<cite>${esc(b.attribution)}</cite>` : '') + `</blockquote>`;

      case 'image': {
        const src = data.assets?.[b.assetId];
        if (!src) return '';                               // missing asset: nothing
        return `<figure><img src="${esc(src)}" alt="${esc(b.alt ?? '')}" loading="lazy">` +
          (b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : '') + `</figure>`;
      }

      case 'callout':
        return `<div class="callout ${b.tone === 'warning' ? 'warn' : 'note'}">` +
          `<p>${renderRich(b.text ?? [])}</p></div>`;

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

      case 'dojoList': {
        const dojos = data.dojos ?? [];
        if (!dojos.length) return '';
        return (b.heading ? `<h2>${esc(b.heading)}</h2>` : '') +
          `<div class="grid">${dojos.map((d) =>
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
              `<span>${d.toLocaleDateString('en-NZ', { month: 'short' })}</span></div>` +
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

      default:
        return '';
    }
  }).filter(Boolean).join('\n');
}

/** First paragraph, trimmed — a fallback meta description. */
export function excerpt(doc, max = 155) {
  const p = (doc?.blocks ?? []).find((b) => b.type === 'paragraph');
  if (!p) return '';
  const text = (p.text ?? []).map((r) => r.text).join('');
  return text.length <= max ? text
    : text.slice(0, text.lastIndexOf(' ', max)) + '…';
}

/** Plain text, for search indexing and for checking a page is not empty. */
export function toText(doc) {
  return (doc?.blocks ?? []).map((b) => {
    if (b.type === 'heading') return b.text ?? '';
    if (b.type === 'paragraph' || b.type === 'callout' || b.type === 'quote')
      return (b.text ?? []).map((r) => r.text).join('');
    if (b.type === 'list')
      return (b.items ?? []).map((i) => i.map((r) => r.text).join('')).join(' ');
    return '';
  }).filter(Boolean).join('\n');
}

export { esc, renderRich, cleanRich };
