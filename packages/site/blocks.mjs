/**
 * HONBU — block documents
 *
 * The authored layer. About fifteen pages per federation: about us, history,
 * the dojo kun, affiliation, safeguarding.
 *
 * The point of having one system rather than two is DYNAMIC BLOCKS. An authored
 * page can drop in live register data — the dojo grid, upcoming events, the
 * grade ladder, an honours board — and it stays correct without anyone editing
 * it. A separate CMS can only ever hold a stale copy.
 *
 * Documents are stored as JSON, never as HTML. HTML is produced at render time,
 * escaped, from a closed set of block types. Nothing a contributor types can
 * emit a tag.
 */

import { esc, groupSessions, time } from './render.mjs';

// ---------------------------------------------------------------------------
// schema
// ---------------------------------------------------------------------------

/** Static blocks a contributor writes. */
export const STATIC_BLOCKS = {
  heading:   { fields: ['text', 'level'] },
  paragraph: { fields: ['text'] },
  list:      { fields: ['items', 'ordered'] },
  quote:     { fields: ['text', 'attribution'] },
  callout:   { fields: ['text', 'tone'] },
  button:    { fields: ['label', 'href'] },
  image:     { fields: ['assetId', 'alt', 'caption'] },
  divider:   { fields: [] },
  video:     { fields: ['provider', 'id', 'caption'] },
  table:     { fields: ['head', 'rows'] },
};

/** Dynamic blocks that read the register at build time. */
export const DYNAMIC_BLOCKS = {
  dojoGrid:      { fields: ['columns'],        reads: 'dojos' },
  eventList:     { fields: ['limit', 'kind'],  reads: 'events' },
  gradeLadder:   { fields: ['showSyllabus'],   reads: 'grades' },
  honoursBoard:  { fields: ['title', 'entries'], reads: 'honours' },
  sessionTable:  { fields: ['dojoSlug'],       reads: 'sessions' },
  statBand:      { fields: ['stats'],          reads: 'counts' },
};

export const ALL_BLOCKS = { ...STATIC_BLOCKS, ...DYNAMIC_BLOCKS };

const TONES = ['note', 'warning', 'success'];
const PROVIDERS = ['youtube', 'vimeo'];

/**
 * Validate a document. Returns problems rather than throwing, because an editor
 * needs to show them all at once.
 */
export function validate(doc) {
  const problems = [];
  if (!doc || !Array.isArray(doc.blocks)) return ['Document has no blocks array'];

  doc.blocks.forEach((b, i) => {
    const at = `block ${i + 1}`;
    if (!b.type) return problems.push(`${at}: no type`);
    if (!ALL_BLOCKS[b.type]) return problems.push(`${at}: unknown type "${b.type}"`);

    switch (b.type) {
      case 'heading':
        if (!b.text?.trim()) problems.push(`${at}: heading has no text`);
        if (b.level && ![2, 3, 4].includes(b.level))
          problems.push(`${at}: heading level must be 2, 3 or 4 — the page title is the h1`);
        break;
      case 'paragraph':
        if (!b.text?.trim()) problems.push(`${at}: empty paragraph`);
        break;
      case 'list':
        if (!Array.isArray(b.items) || !b.items.length)
          problems.push(`${at}: list has no items`);
        break;
      case 'quote':
        if (!b.text?.trim()) problems.push(`${at}: quote has no text`);
        break;
      case 'callout':
        if (b.tone && !TONES.includes(b.tone))
          problems.push(`${at}: tone must be one of ${TONES.join(', ')}`);
        break;
      case 'button':
        if (!b.label?.trim()) problems.push(`${at}: button has no label`);
        if (!b.href) problems.push(`${at}: button has no link`);
        else if (!/^(\/|https?:\/\/|mailto:|tel:)/.test(b.href))
          problems.push(`${at}: link must start with /, http, mailto: or tel:`);
        break;
      case 'image':
        if (!b.assetId) problems.push(`${at}: image has no asset`);
        if (!b.alt?.trim())
          problems.push(`${at}: image needs alt text — describe it for someone who cannot see it`);
        break;
      case 'video':
        if (!PROVIDERS.includes(b.provider))
          problems.push(`${at}: video provider must be ${PROVIDERS.join(' or ')}`);
        if (!/^[A-Za-z0-9_-]+$/.test(b.id ?? ''))
          problems.push(`${at}: video id looks wrong — paste the id, not the whole URL`);
        break;
      case 'table':
        if (!Array.isArray(b.rows) || !b.rows.length)
          problems.push(`${at}: table has no rows`);
        break;
      case 'sessionTable':
        if (!b.dojoSlug) problems.push(`${at}: which dojo's timetable?`);
        break;
      case 'honoursBoard':
        if (!Array.isArray(b.entries) || !b.entries.length)
          problems.push(`${at}: honours board has no entries`);
        break;
    }
  });
  return problems;
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

/**
 * Inline formatting. A deliberately tiny subset: **bold**, *italic*, [text](href).
 * Everything is escaped first, so a contributor cannot emit a tag.
 */
export function inline(text = '') {
  let s = esc(text);
  s = s.replace(/\[([^\]]+)\]\((\/[^)\s]*|https?:\/\/[^)\s]+|mailto:[^)\s]+|tel:[^)\s]+)\)/g,
    (_, label, href) => `<a href="${href}">${label}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  return s;
}

/**
 * Render a document.
 * `ctx` supplies whatever the dynamic blocks need: dojos, events, grades,
 * an asset resolver, and the origin.
 */
export function renderDocument(doc, ctx = {}) {
  if (!doc?.blocks) return '';
  return doc.blocks.map((b) => renderBlock(b, ctx)).filter(Boolean).join('\n');
}

function renderBlock(b, ctx) {
  switch (b.type) {
    case 'heading': {
      const l = [2, 3, 4].includes(b.level) ? b.level : 2;
      return `<h${l}>${inline(b.text)}</h${l}>`;
    }
    case 'paragraph':
      return `<p>${inline(b.text)}</p>`;
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul';
      return `<${tag}>${b.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${tag}>`;
    }
    case 'quote':
      return `<blockquote><p>${inline(b.text)}</p>${
        b.attribution ? `<cite>${inline(b.attribution)}</cite>` : ''}</blockquote>`;
    case 'callout':
      return `<div class="callout ${TONES.includes(b.tone) ? b.tone : 'note'}">${
        inline(b.text)}</div>`;
    case 'button':
      return `<p><a class="btn" href="${esc(b.href)}">${esc(b.label)}</a></p>`;
    case 'divider':
      return '<hr>';
    case 'image': {
      const src = ctx.asset?.(b.assetId) ?? '';
      if (!src) return '';
      return `<figure><img src="${esc(src)}" alt="${esc(b.alt)}" loading="lazy">${
        b.caption ? `<figcaption>${inline(b.caption)}</figcaption>` : ''}</figure>`;
    }
    case 'video': {
      const src = b.provider === 'youtube'
        ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(b.id)}`
        : `https://player.vimeo.com/video/${encodeURIComponent(b.id)}`;
      return `<figure class="video"><iframe src="${src}" loading="lazy"
        title="${esc(b.caption ?? 'Video')}" allowfullscreen
        referrerpolicy="strict-origin-when-cross-origin"></iframe>${
        b.caption ? `<figcaption>${inline(b.caption)}</figcaption>` : ''}</figure>`;
    }
    case 'table':
      return `<table class="doc">${
        b.head ? `<thead><tr>${b.head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead>` : ''
      }<tbody>${b.rows.map((r) =>
        `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

    // ---- dynamic: read the register, never a copy of it --------------------
    case 'dojoGrid': {
      const dojos = ctx.dojos ?? [];
      if (!dojos.length) return '';
      return `<div class="grid">${dojos.map((d) =>
        `<a href="/${esc(d.slug)}"><strong>${esc(d.name)}</strong>
          <span>${esc(d.published ? (d.city ?? 'Book a free class') : 'Details coming')}</span></a>`
      ).join('')}</div>`;
    }
    case 'eventList': {
      let evs = ctx.events ?? [];
      if (b.kind) evs = evs.filter((e) => e.kind === b.kind);
      evs = evs.slice(0, b.limit ?? 5);
      if (!evs.length) return '';
      return `<ul class="events">${evs.map((e) => {
        const d = new Date(e.starts_at);
        return `<li><div class="d"><b>${d.getDate()}</b>
          <span>${d.toLocaleDateString('en-NZ', { month: 'short' })}</span></div>
          <div><h3><a href="/events/${esc(e.slug)}">${esc(e.title)}</a></h3>
          <p>${esc(e.venue_name ?? e.from_org ?? '')}</p></div></li>`;
      }).join('')}</ul>`;
    }
    case 'gradeLadder': {
      const grades = ctx.grades ?? [];
      if (!grades.length) return '';
      return `<table class="doc ladder"><thead><tr><th>Grade</th><th>Belt</th>
        <th>Minimum time</th></tr></thead><tbody>${
        grades.map((g) => `<tr>
          <td><strong>${esc(g.label)}</strong></td>
          <td><span class="belt" style="background:${esc(g.belt_colour ?? '#ccc')}"></span>${
            g.belt_stripes ? ` ${g.belt_stripes} stripe${g.belt_stripes > 1 ? 's' : ''}` : ''}</td>
          <td>${g.min_months_at_previous
            ? `${g.min_months_at_previous} months at previous grade` : '—'}</td>
        </tr>`).join('')}</tbody></table>`;
    }
    case 'sessionTable': {
      const sessions = ctx.sessionsBySlug?.[b.dojoSlug] ?? [];
      const groups = groupSessions(sessions);
      if (!groups.length) return '<p>Training times to be confirmed.</p>';
      return `<table class="times"><thead><tr><th>Class</th><th>Day</th><th>Time</th>
        </tr></thead><tbody>${groups.map((g) => `<tr>
          <td><strong>${esc(g.label)}</strong></td>
          <td>${esc(g.days.join(' & '))}</td>
          <td>${time(g.starts)} – ${time(g.ends)}</td></tr>`).join('')}</tbody></table>`;
    }
    case 'honoursBoard':
      return `<table class="doc honours">${
        b.title ? `<caption>${inline(b.title)}</caption>` : ''
      }<tbody>${b.entries.map((e) =>
        `<tr><td>${inline(e.name)}</td><td class="year">${esc(e.year)}</td></tr>`
      ).join('')}</tbody></table>`;
    case 'statBand': {
      const stats = b.stats ?? [];
      if (!stats.length) return '';
      return `<div class="statband">${stats.map((s) => {
        const value = s.count ? String(ctx.counts?.[s.count] ?? '—') : s.value;
        return `<div><b>${esc(value)}</b><span>${esc(s.label)}</span></div>`;
      }).join('')}</div>`;
    }
    default:
      return '';
  }
}

/** Extra CSS the authored blocks need, appended to the theme. */
export const blockCss = `
blockquote{margin:24px 0;padding:0 0 0 20px;border-left:4px solid var(--primary)}
blockquote p{font-family:var(--display);font-size:20px;margin:0 0 8px}
blockquote cite{font-style:normal;font-size:15px;color:var(--muted)}
.callout{padding:14px 18px;margin:20px 0;border-left:5px solid var(--primary);
  background:var(--canvas-alt)}
.callout.warning{border-left-color:var(--accent)}
.callout.success{border-left-color:var(--primary-hover)}
figure{margin:24px 0}
figcaption{font-size:14px;color:var(--muted);margin-top:8px}
figure.video{position:relative;padding-bottom:56.25%;height:0;overflow:hidden}
figure.video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
table.doc{width:100%;border-collapse:collapse;margin:20px 0;font-size:16px}
table.doc th{text-align:left;font-family:var(--display);padding:10px 8px 10px 0;
  border-bottom:2px solid var(--ink)}
table.doc td{padding:11px 8px 11px 0;border-bottom:1px solid var(--neutral)}
table.doc caption{font-family:var(--display);font-size:20px;font-weight:700;
  text-align:left;padding-bottom:10px}
table.honours .year{text-align:right;color:var(--muted);width:6em}
span.belt{display:inline-block;width:34px;height:10px;vertical-align:middle;
  border:1px solid var(--neutral)}
.statband{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px;
  background:var(--ink);color:var(--canvas);padding:26px 24px;margin:26px 0}
.statband b{display:block;font-family:var(--display);font-size:30px;color:var(--accent)}
.statband span{font-size:14px;color:var(--neutral)}
hr{border:0;border-top:1px solid var(--neutral);margin:32px 0}
@media (max-width:700px){.statband{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;
