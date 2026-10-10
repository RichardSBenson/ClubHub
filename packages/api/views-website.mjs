/**
 * Screens: the website a club writes — pages, news, images, menu, appearance — plus search and the history of changes.
 */
import { describe as auditDescribe, weight as auditWeight } from '../content/audit.mjs';
import { highlight as searchHighlight, linkTo as searchLinkTo } from '../content/search.mjs';
import { slotHint, slotTable } from '../content/image-slots.mjs';
import { WRITING_HELP } from '../content/document-text.mjs';
import { esc } from '../core/domain/html.mjs';
import { SCHEDULE_NOTE } from '../core/domain/scheduling.mjs';
import { page } from './views.mjs';
import { VOCABULARY, clubWord } from './views-shared.mjs';

/** Every page this organisation has, drafts and all. */
export const pageList = ({ me, csrf, org, pages = [], canPublish = false,
                           rebuild = null, done, error }) => page({
  title: `Website — ${org.name}`, me, csrf, body: `
  <h1>Website</h1>
  <p class="sub">${esc(org.name)} ·
    <a href="/o/${esc(org.slug)}/news">News</a> ·
    <a href="/o/${esc(org.slug)}/instructors">Instructors</a> ·
    <a href="/o/${esc(org.slug)}/media">Images</a> ·
    <a href="/o/${esc(org.slug)}/menu">Menu</a> ·
    <a href="/o/${esc(org.slug)}/roster">Back to the roll</a></p>

  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${rebuild ? `<div class="note">${esc(rebuild)}</div>` : ''}

  <p><a class="btn" href="/o/${esc(org.slug)}/pages/new">Write a new page</a></p>

  ${pages.length ? `<table>
    <thead><tr><th>Page</th><th class="hide-sm">Address</th><th>Status</th>
      <th class="hide-sm">Last changed</th><th></th></tr></thead>
    <tbody>${pages.map((p) => `<tr${p.status === 'draft' ? ' class="draft"' : ''}>
      <td><strong>${esc(p.title)}</strong>
        ${p.revisions > 1 ? `<div class="muted">${p.revisions} versions</div>` : ''}</td>
      <td class="hide-sm"><code>/${esc(p.slug)}</code></td>
      <td>${p.status === 'published'
        ? '<span class="tag ok">Live</span>'
        : '<span class="tag no">Draft</span>'}</td>
      <td class="hide-sm muted">${p.updated_at
        ? esc(new Date(p.updated_at).toISOString().slice(0, 10)) : ''}
        ${p.updated_by ? `<div>${esc(p.updated_by)}</div>` : ''}</td>
      <td>
        <a class="btn quiet" href="/o/${esc(org.slug)}/pages/${esc(p.id)}">Edit</a>
        <a class="btn quiet" href="/o/${esc(org.slug)}/pages/${esc(p.id)}/preview">View</a>
      </td>
    </tr>`).join('')}</tbody></table>`
    : `<div class="note">No pages yet. The parts of the site that come from the
        register — ${esc(VOCABULARY.clubPlural.toLowerCase())}, events, news —
        are there already; these are the pages somebody writes.</div>`}

  ${canPublish ? '' : `<p class="muted">You can write and change pages here.
    Putting one in front of the public needs an owner or administrator.</p>`}` });

/**
 * The media library.
 *
 * A federation's images, and the form that puts one there. The alt text field
 * is not optional-looking by accident: an image block renders an <img> with
 * whatever alt it is given, and a page full of undescribed photographs is
 * unusable with a screen reader and invisible to a search engine.
 *
 * consent_ref is here because a federation photographing children needs to be
 * able to say where the permission for a given photograph is recorded. The
 * platform does not know what form that takes — a signed slip in a folder, a
 * row in somebody's spreadsheet — so it stores a reference and does not
 * pretend to validate it.
 */
export const mediaLibrary = ({ me, csrf, org, assets = [], accepted = [],
                               maxBytes = 0, done, error }) => page({
  title: `Images — ${org.name}`, me, csrf, body: `
  <h1>Images</h1>
  <p class="sub">${esc(org.name)} ·
    <a href="/o/${esc(org.slug)}/pages">Back to the website</a></p>

  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}

  <form method="post" action="/o/${esc(org.slug)}/media"
        enctype="multipart/form-data" class="card" style="margin-bottom:24px">
    <input type="hidden" name="_csrf" value="${esc(csrf)}">
    <h3>Add an image</h3>
    <p><label>File<br>
      <input type="file" name="file" required accept="${esc(accepted.join(','))}">
    </label></p>
    <p class="muted">PNG, JPEG, GIF or WebP, up to
      ${Math.round(maxBytes / 1024 / 1024)}MB. Not SVG — an SVG can carry
      script, so it is refused.</p>
    <p><label>Describe it for somebody who cannot see it<br>
      <input type="text" name="alt_text" maxlength="300"
             placeholder="Doug Holloway bowing in before a grading"></label></p>
    <p><label>Credit <span class="muted">optional</span><br>
      <input type="text" name="credit" maxlength="200"></label></p>
    <p><label>Where the permission for this photograph is recorded
      <span class="muted">optional</span><br>
      <input type="text" name="consent_ref" maxlength="200"
             placeholder="2026 consent folder, p14"></label></p>
    <p><button class="btn" type="submit">Upload</button></p>
  </form>

  <details class="card" style="margin-bottom:24px"><summary><strong>What size should pictures be?</strong></summary>
    <p class="muted">The website crops a picture to fit its space and never stretches it. Bigger is fine
      (up to the limit above); smaller than the minimum looks soft.</p>
    <table><thead><tr><th>Picture</th><th>Aim for (pixels)</th><th>At least</th><th>Shape</th><th>Notes</th></tr></thead>
    <tbody>${slotTable().map((r) => `<tr><td><strong>${esc(r.label)}</strong><br>
      <span class="muted">${esc(r.where)}</span></td><td>${esc(r.size)}</td><td>${r.min} wide</td>
      <td>${esc(r.ratio)}</td><td>${esc(r.safe)}</td></tr>`).join('')}</tbody></table>
  </details>

  ${assets.length ? `<div class="grid">${assets.map((a) => `
    <div class="card">
      <img src="/a/${esc(a.id)}" alt="${esc(a.alt_text ?? '')}"
           style="max-width:100%;height:auto;display:block;margin-bottom:8px">
      <p><strong>${esc(a.filename ?? 'untitled')}</strong><br>
        <span class="muted">${a.width}×${a.height} ·
          ${Math.round((a.bytes ?? 0) / 1024)}KB ·
          ${esc((a.mime ?? '').replace('image/', '').toUpperCase())}</span></p>
      ${a.alt_text ? '' : `<p class="bad" style="padding:6px 10px">
        No description. Add one before using it on a page.</p>`}
      <p class="muted">Reference for an image block:<br>
        <code>${esc(a.id)}</code></p>

      <details>
        <summary>Change its description</summary>
        <form method="post"
              action="/o/${esc(org.slug)}/media/${esc(a.id)}/describe">
          <input type="hidden" name="_csrf" value="${esc(csrf)}">
          <p><label>Description<br>
            <input type="text" name="alt_text" maxlength="300"
                   value="${esc(a.alt_text ?? '')}"></label></p>
          <p><label>Credit<br>
            <input type="text" name="credit" maxlength="200"
                   value="${esc(a.credit ?? '')}"></label></p>
          <p><label>Permission recorded at<br>
            <input type="text" name="consent_ref" maxlength="200"
                   value="${esc(a.consent_ref ?? '')}"></label></p>
          <p><button class="btn quiet" type="submit">Save</button></p>
        </form>
      </details>

      <form method="post" action="/o/${esc(org.slug)}/media/${esc(a.id)}/delete"
            style="margin-top:8px">
        <input type="hidden" name="_csrf" value="${esc(csrf)}">
        <button class="btn quiet" type="submit">Delete</button>
      </form>
    </div>`).join('')}</div>`
    : `<div class="note">No images yet. Upload one above, then put its
        reference into an image block on a page.</div>`}` });

/** Date field and buttons to put a draft live on a morning of the author's choosing. */
const scheduleControls = ({ canPublish, isNew, status, scheduledFor, today }) => {
  if (isNew || !canPublish || status === 'published') return '';
  return `<fieldset class="schedule"><legend>Or put it live on a date</legend>
    ${scheduledFor ? `<p><span class="tag wait">Scheduled</span> It goes live on ${esc(scheduledFor)}.</p>` : ''}
    <label for="publishOn">Date</label>
    <input id="publishOn" name="publishOn" type="date" value="${esc(scheduledFor ?? '')}"${today ? ` min="${esc(today)}"` : ''}>
    <p class="muted">${esc(SCHEDULE_NOTE)}</p>
    <button class="btn secondary" type="submit" name="op" value="schedule">${scheduledFor ? 'Change the date' : 'Save and schedule'}</button>
    ${scheduledFor ? '<button class="btn quiet" type="submit" name="op" value="unschedule">Cancel the schedule</button>' : ''}
  </fieldset>`;
};

export const pageEditor = ({ me, csrf, org, page: pg, values = {},
                             dropped = [], revisions = [], images = [],
                             canPublish = false, scheduledFor = null, today = null, done, error, warning }) => {
  const isNew = !pg;
  const action = isNew
    ? `/o/${org.slug}/pages/new`
    : `/o/${org.slug}/pages/${pg.id}`;

  return page({
    title: isNew ? `New page — ${org.name}` : `${pg.title} — ${org.name}`,
    me, csrf, body: `
  <h1>${isNew ? 'Write a page' : esc(pg.title)}</h1>
  <p class="sub">${esc(org.name)} ·
    <a href="/o/${esc(org.slug)}/pages">Back to the website</a>
    ${isNew ? '' : ` · ${pg.status === 'published'
      ? '<span class="tag ok">Live</span>' : '<span class="tag no">Draft</span>'}
      · <a href="/o/${esc(org.slug)}/pages/${esc(pg.id)}/preview">See it as a
        visitor would</a>`}</p>

  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${warning ? `<div class="note">${esc(warning)}</div>` : ''}
  ${dropped.length ? `<div class="note"><strong>Some of that could not be
    kept.</strong> ${dropped.map(esc).join('; ')}</div>` : ''}

  <form method="post" action="${esc(action)}">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">

    <fieldset>
      <legend>The page itself</legend>
      <div class="row">
        <div>
          <label for="title">Title</label>
          <input id="title" name="title" required maxlength="200"
            value="${esc(values.title ?? '')}">
        </div>
        <div>
          <label for="slug">Web address
            <span class="hint">It will live at /${esc(values.slug ?? '…')}</span></label>
          <input id="slug" name="slug" maxlength="120"
            pattern="[a-z0-9]+(-[a-z0-9]+)*" value="${esc(values.slug ?? '')}">
        </div>
      </div>
      <label for="metaDescription">What search engines show
        <span class="hint">One sentence. Left blank, the first words of the
          page are used.</span></label>
      <input id="metaDescription" name="metaDescription" maxlength="300"
        value="${esc(values.metaDescription ?? '')}" style="max-width:560px">
    </fieldset>

    <h2>What is on it</h2>
    ${writingBox({ name: 'body', value: values.body ?? '', images, org })}

    <div class="actions">
      <button class="btn" type="submit" name="op" value="save">
        ${isNew ? 'Create this page' : 'Save changes'}</button>
      ${isNew || !canPublish ? '' : (pg.status === 'published'
        ? `<button class="btn quiet" type="submit" name="op" value="unpublish">
            Take it off the site</button>`
        : `<button class="btn quiet" type="submit" name="op" value="publish">
            Save and put it live</button>`)}
      <a class="btn quiet" href="/o/${esc(org.slug)}/pages">Cancel</a>
    </div>
    ${scheduleControls({ canPublish, isNew, status: pg?.status, scheduledFor, today })}
  </form>

  ${revisions.length ? `<h2>Earlier versions</h2>
  <p class="muted">Every save keeps one. Nothing anybody does to a page is
    unrecoverable.</p>
  <table>
    <thead><tr><th>Saved</th><th class="hide-sm">By</th><th>Title then</th>
      <th></th></tr></thead>
    <tbody>${revisions.slice(0, 20).map((r, i) => `<tr>
      <td>${esc(new Date(r.saved_at).toISOString().slice(0, 16).replace('T', ' '))}</td>
      <td class="hide-sm muted">${esc(r.saved_by ?? '')}</td>
      <td>${esc(r.title)}</td>
      <td>${i === 0 ? '<span class="muted">current</span>' : (canPublish
        ? `<form method="post" action="/o/${esc(org.slug)}/pages/${esc(pg.id)}/restore">
            <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
            <input type="hidden" name="revisionId" value="${esc(r.id)}">
            <button class="btn quiet" type="submit">Go back to this</button>
          </form>` : '')}</td>
    </tr>`).join('')}</tbody></table>` : ''}` });
};

/**
 * Search results.
 *
 * Grouped by what the thing is, because "a person called Ngata" and "a page
 * mentioning Ngata" are different answers to the same word and a flat list
 * makes somebody read them all to find out which is which.
 *
 * The matched part is marked. A result that cannot be seen to match looks
 * like a bug, and somebody who cannot see why a page came back does not trust
 * the next search either.
 */
export const searchResults = ({ me, csrf, query, results = [],
                                vocabulary = {} }) => {
  const mark = (value) => searchHighlight(value, query?.folded ?? '')
    .map((part) => part.match ? `<mark>${esc(part.text)}</mark>` : esc(part.text))
    .join('');

  const kinds = ['person', 'organisation', 'event', 'page', 'article', 'image'];
  const groups = kinds
    .map((kind) => ({ kind, rows: results.filter((r) => r.kind === kind) }))
    .filter((g) => g.rows.length);

  const heading = {
    person: 'People', organisation: 'Organisations', event: 'Events',
    page: 'Pages', article: 'News', image: 'Images',
  };

  return page({ title: query?.text ? `${query.text} — search` : 'Search',
    me, csrf, query: query?.text ?? '', body: `
  <h1>${query?.text ? `Results for ${esc(query.text)}` : 'Find something'}</h1>

  ${query?.kind === 'too-short' ? `<div class="note">Two letters at least —
    one letter matches most of the register and tells you nothing.</div>` : ''}

  ${query?.kind === 'empty' ? `<div class="note">Type a name, a member number,
    an email address or a grade. Searching looks through people, ${
      esc((vocabulary.clubPlural ?? 'clubs').toLowerCase())}, events, pages,
    news and images — but only the ones you can already see.</div>` : ''}

  ${query?.text && query.kind !== 'too-short' && query.kind !== 'empty'
    && !results.length
    ? `<div class="note"><strong>Nothing found.</strong> Searching only looks
        at what you have permission to see, so something you expected may
        belong to an organisation you are not part of. Macrons do not matter
        either way — "Tamati" and "Tāmati" find each other.</div>` : ''}

  ${groups.map((g) => `
  <h2>${esc(heading[g.kind])}</h2>
  <div class="grid">${g.rows.map((r) => `<a class="card"
    href="${esc(searchLinkTo(r))}" style="display:block;text-decoration:none">
    <strong>${mark(r.title ?? '')}</strong>
    ${r.detail ? `<div class="muted">${mark(r.detail)}</div>` : ''}
  </a>`).join('')}</div>`).join('')}

  ${results.length >= 40 ? `<p class="muted">The first 40. Type more of it to
    narrow this down.</p>` : ''}` });
};

/**
 * What has happened here.
 *
 * Thirteen places in this system write to the audit log and nothing read it
 * until this screen. Federations argue about records — who graded whom, who
 * took a page down, who put a child's photograph on a website — and the
 * answer has been in the database the whole time with no way to ask.
 *
 * Every line names a person, says what they did in a sentence, and gives the
 * time. Not an action code and a uuid: those are a row in a table, and a row
 * in a table does not settle an argument.
 */
export const history = ({ me, csrf, org, entries = [], actors = [],
                          actions = [], filters = {} }) => {
  const when = (at) => {
    const d = new Date(at);
    return d.toISOString().slice(0, 16).replace('T', ' ');
  };

  const day = (at) => new Date(at).toISOString().slice(0, 10);

  // Grouped by day, because "what happened on the 14th" is how somebody asks.
  const days = [];
  for (const e of entries) {
    const d = day(e.at);
    if (!days.length || days[days.length - 1].day !== d)
      days.push({ day: d, rows: [] });
    days[days.length - 1].rows.push(e);
  }

  const mark = (e) => {
    const w = auditWeight(e);
    if (w === 'notable') return '<span class="tag ok">access</span>';
    if (w === 'removal') return '<span class="tag no">removed</span>';
    return '';
  };

  const oldest = entries.length ? entries[entries.length - 1].id : null;

  return page({ title: `History — ${org.name}`, me, csrf, body: `
  <h1>History</h1>
  <p class="sub">${esc(org.name)} ·
    <a href="/o/${esc(org.slug)}/roster">Back to the roll</a></p>

  <form method="get" action="/o/${esc(org.slug)}/history" class="card">
    <div class="row">
      <div>
        <label for="action">What</label>
        <select id="action" name="action">
          <option value="">Everything</option>
          ${actions.map(([value, label]) => `<option value="${esc(value)}"${
            filters.action === value ? ' selected' : ''}>${esc(label)}</option>`).join('')}
        </select>
      </div>
      <div>
        <label for="who">Who</label>
        <select id="who" name="who">
          <option value="">Anybody</option>
          ${actors.map((a) => `<option value="${esc(a.accountId)}"${
            filters.who === a.accountId ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}
        </select>
      </div>
      <div>
        <label for="since">When</label>
        <select id="since" name="since">
          <option value=""${filters.since === '' ? ' selected' : ''}>All of it</option>
          <option value="week"${filters.since === 'week' ? ' selected' : ''}>Last week</option>
          <option value="month"${filters.since === 'month' ? ' selected' : ''}>Last month</option>
          <option value="year"${filters.since === 'year' ? ' selected' : ''}>Last year</option>
        </select>
      </div>
    </div>
    <p><button class="btn quiet" type="submit">Show these</button>
      <a class="btn quiet" href="/o/${esc(org.slug)}/history">Clear</a></p>
  </form>

  ${entries.length ? days.map((d) => `
  <h2>${esc(d.day)}</h2>
  <table>
    <thead><tr><th class="hide-sm">Time</th><th>Who</th><th>What</th>
      <th class="hide-sm">Where</th></tr></thead>
    <tbody>${d.rows.map((e) => `<tr>
      <td class="hide-sm muted">${esc(when(e.at).slice(11))}</td>
      <td><strong>${esc(e.actorName)}</strong></td>
      <td>${esc(auditDescribe(e))} ${mark(e)}</td>
      <td class="hide-sm muted">${esc(e.organisationName ?? '')}</td>
    </tr>`).join('')}</tbody>
  </table>`).join('')
    : `<div class="note">Nothing recorded yet for these. Every enrolment,
        grading, upload and publication is written here as it happens —
        an empty list means it has not happened, not that it was not kept.</div>`}

  ${entries.length >= 100 ? `<p><a class="btn quiet"
    href="/o/${esc(org.slug)}/history?before=${esc(oldest)}${
      filters.action ? `&action=${esc(filters.action)}` : ''}${
      filters.who ? `&who=${esc(filters.who)}` : ''}${
      filters.since ? `&since=${esc(filters.since)}` : ''}">Older</a></p>` : ''}

  <p class="muted" style="margin-top:24px">This record cannot be edited or
    deleted, by anybody, including whoever runs the server. That is enforced
    by the database rather than by permissions — the value of it is that it
    still says what happened when that is inconvenient.</p>` });
};

/**
 * The site menu.
 *
 * Five rows, each a destination and a label. Destinations are a dropdown of
 * pages this federation actually has, rather than a text box, because the
 * failure this screen exists to end is an item pointing at a page nobody
 * wrote — which the build used to drop in silence, mentioning it only in a
 * log nobody reads.
 */
export const menuEditor = ({ me, csrf, org, items = [], destinations = [],
                             vocabulary = {}, max = 5, stored = false,
                             done, error, rebuild }) => {
  const rows = Array.from({ length: max }, (_, i) => items[i] ?? null);

  const choices = (selected) => destinations
    .filter((d) => d.href !== '/')
    .map((d) => `<option value="${esc(d.href)}"${
      d.href === selected ? ' selected' : ''}>${esc(d.label ?? d.href)} — ${
      esc(d.href)}${d.kind === 'written' ? '' : ' (built in)'}</option>`).join('');

  return page({ title: `Menu — ${org.name}`, me, csrf, body: `
  <h1>Menu</h1>
  <p class="sub">${esc(org.name)} ·
    <a href="/o/${esc(org.slug)}/pages">Website</a> ·
    <a href="/o/${esc(org.slug)}/news">News</a> ·
    <a href="/o/${esc(org.slug)}/instructors">Instructors</a></p>

  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${rebuild ? `<div class="note">${esc(rebuild)}</div>` : ''}

  ${stored ? '' : `<div class="note">This is the menu the site builds with by
    default. Saving it makes it this federation's own, and it stops following
    the deployment's settings file.</div>`}

  <form method="post" action="/o/${esc(org.slug)}/menu">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">

    ${rows.map((row, i) => `<fieldset>
      <legend>${i + 1}</legend>
      <div class="row">
        <div>
          <label for="href${i}">Goes to</label>
          <select id="href${i}" name="href${i}">
            <option value="">— nothing —</option>
            ${choices(row?.href)}
          </select>
        </div>
        <div>
          <label for="label${i}">Called</label>
          <input id="label${i}" name="label${i}" maxlength="40"
            value="${esc(row?.label ?? '')}"
            placeholder="leave blank for the page's own name">
        </div>
      </div>
    </fieldset>`).join('')}

    <div class="actions">
      <button class="btn" type="submit">Save the menu</button>
      <a class="btn quiet" href="/o/${esc(org.slug)}/pages">Cancel</a>
    </div>
  </form>

  <p class="muted" style="margin-top:20px">${max} items, and that is the
    limit. Adding a sixth means removing one — it is the rule that stops a
    menu becoming forty links in five years.</p>

  <p class="muted">Only pages this site has are offered. Write a page first
    and it appears in this list.</p>` });
};

/**
 * A federation or club's news.
 *
 * Two lists, and the second one only exists for somebody who can decide:
 * articles from beneath this organisation whose authors have asked for them to
 * appear here. A club may say what it likes on its own site; putting it in the
 * federation's voice is the federation's call, because its name on a page
 * reads as an endorsement whether or not it was meant as one.
 */
export const newsList = ({ me, csrf, org, articles = [], waiting = [],
                           canPublish = false, done, error, rebuild }) => {
  const state = (a) => {
    if (a.publish_up_state === 'approved')
      return '<span class="tag ok">On the federation site</span>';
    if (a.publish_up_state === 'requested')
      return '<span class="tag">Waiting on the federation</span>';
    if (a.publish_up_state === 'declined')
      return '<span class="tag no">Federation declined</span>';
    return '';
  };

  return page({ title: `News — ${org.name}`, me, csrf, body: `
  <h1>News</h1>
  <p class="sub">${esc(org.name)} ·
    <a href="/o/${esc(org.slug)}/pages">Website</a> ·
    <a href="/o/${esc(org.slug)}/media">Images</a></p>

  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${rebuild ? `<div class="note">${esc(rebuild)}</div>` : ''}

  ${waiting.length ? `
  <h2>Asking to appear here</h2>
  <p class="muted">Published on their own site already. Approving puts it on
    this one, under this organisation's name.</p>
  ${waiting.map((a) => `<div class="card">
    <h3>${esc(a.title)}</h3>
    <p class="muted">${esc(a.from_org)}${a.published_at
      ? ` · ${esc(new Date(a.published_at).toISOString().slice(0, 10))}` : ''}</p>
    ${a.summary ? `<p>${esc(a.summary)}</p>` : ''}
    <form method="post"
          action="/o/${esc(org.slug)}/news/${esc(a.id)}/decide">
      <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
      <button class="btn" type="submit" name="answer" value="approve">
        Put it on this site</button>
      <button class="btn quiet" type="submit" name="answer" value="decline">
        Decline</button>
    </form>
    <p class="hint">Declining leaves it published on their own site. It is
      their article; what is being decided is whether it appears here.</p>
  </div>`).join('')}` : ''}

  <h2>${esc(org.name)}'s own</h2>
  <p><a class="btn" href="/o/${esc(org.slug)}/news/new">Write something</a></p>

  ${articles.length ? `<table>
    <thead><tr><th>Headline</th><th>Status</th>
      <th class="hide-sm">Published</th><th></th></tr></thead>
    <tbody>${articles.map((a) => `<tr${a.status === 'draft' ? ' class="draft"' : ''}>
      <td><strong>${esc(a.title)}</strong>
        ${a.about_org ? `<div class="muted">about ${esc(a.about_org)}</div>` : ''}
        ${(a.tags ?? []).length
          ? `<div class="muted">${(a.tags ?? []).map(esc).join(' · ')}</div>` : ''}</td>
      <td>${a.status === 'published'
        ? '<span class="tag ok">Live</span>'
        : '<span class="tag no">Draft</span>'} ${state(a)}</td>
      <td class="hide-sm muted">${a.published_at
        ? esc(new Date(a.published_at).toISOString().slice(0, 10)) : ''}</td>
      <td>
        <a class="btn quiet" href="/o/${esc(org.slug)}/news/${esc(a.id)}">Edit</a>
        ${a.status === 'published' && a.publish_up_state === 'none' ? `
        <form method="post" action="/o/${esc(org.slug)}/news/${esc(a.id)}/ask"
              style="display:inline">
          <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
          <button class="btn quiet" type="submit">Ask the federation</button>
        </form>` : ''}
      </td>
    </tr>`).join('')}</tbody></table>`
    : `<div class="note">Nothing written yet. News is the part of a site that
        shows somebody it is still alive — a grading result, a visiting
        instructor, a change of training night.</div>`}` });
};

/**
 * Writing one. The same block editor pages use, with the things an article
 * has and a page does not: a summary, a hero image and tags.
 */
export const articleEditor = ({ me, csrf, org, article: a = null, values = {},
                                dropped = [], images = [],
                                canPublish = false, scheduledFor = null, today = null, done, error }) => {
  const isNew = !a;
  const action = isNew
    ? `/o/${org.slug}/news/new`
    : `/o/${org.slug}/news/${a.id}`;

  return page({
    title: isNew ? `Write news — ${org.name}` : `${a.title} — ${org.name}`,
    me, csrf, body: `
  <h1>${isNew ? 'Write something' : esc(a.title)}</h1>
  <p class="sub">${esc(org.name)} ·
    <a href="/o/${esc(org.slug)}/news">Back to news</a>
    ${isNew ? '' : ` · ${a.status === 'published'
      ? '<span class="tag ok">Live</span>' : '<span class="tag no">Draft</span>'}`}</p>

  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${dropped.length ? `<div class="note"><strong>Some of that could not be
    kept.</strong> ${dropped.map(esc).join('; ')}</div>` : ''}

  <form method="post" action="${esc(action)}" enctype="multipart/form-data">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">

    <fieldset>
      <legend>The article</legend>
      <div class="row">
        <div>
          <label for="title">Headline</label>
          <input id="title" name="title" required maxlength="200"
            value="${esc(values.title ?? '')}">
        </div>
        <div>
          <label for="slug">Web address
            <span class="hint">/news/${esc(values.slug ?? '…')}</span></label>
          <input id="slug" name="slug" maxlength="120"
            pattern="[a-z0-9]+(-[a-z0-9]+)*" value="${esc(values.slug ?? '')}">
        </div>
      </div>

      <label for="summary">Summary
        <span class="hint">One or two sentences. This is what shows on the
          news list and what a search engine quotes.</span></label>
      <input id="summary" name="summary" maxlength="400"
        value="${esc(values.summary ?? '')}" style="max-width:560px">

      <div class="row">
        <div>
          <label for="heroAssetId">Picture at the top</label>
          <select id="heroAssetId" name="heroAssetId" style="max-width:340px">
            <option value="">None</option>
            ${images.map((img) => `<option value="${esc(img.id)}"${
              values.heroAssetId === img.id ? ' selected' : ''}>${
              esc(img.filename ?? img.id)}${img.alt_text ? '' : ' — no description'}</option>`).join('')}
          </select>

          <p style="margin-top:8px"><label for="heroFile">…or add one now
            <span class="hint">It is uploaded when you save, and goes into
              your images as well.</span><br>
            <input id="heroFile" type="file" name="heroFile"
              accept="image/png,image/jpeg,image/gif,image/webp"></label></p>
          <p class="hint">${esc(slotHint('card'))}</p>
          <p><label for="heroAlt">Describe it for somebody who cannot see it<br>
            <input id="heroAlt" type="text" name="heroAlt" maxlength="300"
              value="${esc(values.heroAlt ?? '')}"></label></p>
        </div>
        <div>
          <label for="tags">Tags
            <span class="hint">Separated by commas. Up to twelve.</span></label>
          <input id="tags" name="tags" maxlength="300"
            value="${esc(values.tags ?? '')}">
        </div>
      </div>
    </fieldset>

    <h2>What it says</h2>
    ${writingBox({ name: 'body', value: values.body ?? '', images, org })}

    <div class="actions">
      <button class="btn" type="submit" name="op" value="save">
        ${isNew ? 'Create it' : 'Save changes'}</button>
      ${isNew || !canPublish ? '' : (a.status === 'published'
        ? `<button class="btn quiet" type="submit" name="op" value="unpublish">
            Take it off the site</button>`
        : `<button class="btn quiet" type="submit" name="op" value="publish">
            Save and put it live</button>`)}
      <a class="btn quiet" href="/o/${esc(org.slug)}/news">Cancel</a>
    </div>
    ${scheduleControls({ canPublish, isNew, status: a?.status, scheduledFor, today })}
  </form>` });
};

/**
 * One box to write the whole thing in, with a toolbar when scripts are on.
 *
 * The textarea is the real editor. EasyMDE enhances it — a toolbar, a live
 * preview — and when the script does not load, which in a hall with bad
 * reception is a normal Tuesday, the box is still there and still works.
 *
 * The toolbar is configured with text labels rather than icons because the
 * stock configuration expects Font Awesome, and vendoring a webfont to draw
 * the letter B was not a trade worth making. "B" is also clearer than a
 * glyph to somebody who has not used an editor like this before.
 *
 * Output is markdown TEXT, never HTML. It is parsed into blocks on save, so
 * the stored document is the same shape it has always been.
 */
function writingBox({ name = 'body', value = '', rows = 18,
                      images = [], org = null }) {
  // The images this organisation already has, shown here rather than on
  // another screen. Leaving a half-written article to go and look up what a
  // picture was called is how somebody loses a draft, and it was the only way
  // to find out until now.
  const picker = images.length ? `
  <details class="hint-block">
    <summary>Pictures you can use (${images.length})</summary>
    <div class="grid" style="margin-top:10px">${images.map((img) => `
      <div class="card" style="padding:10px">
        <img src="/a/${esc(img.id)}" alt="${esc(img.alt_text ?? '')}"
          loading="lazy"
          style="width:100%;height:auto;display:block;margin-bottom:6px">
        <code>![${esc(img.alt_text || 'describe it')}](${
          esc(img.filename ?? img.id)})</code>
        ${img.alt_text ? '' : `<p class="hint">No description yet.</p>`}
      </div>`).join('')}</div>
    <p class="hint">Copy a line into the box where you want the picture.
      ${org ? `<a href="/o/${esc(org.slug)}/media">Add more</a>.` : ''}</p>
  </details>` : (org ? `
  <p class="hint">No pictures yet —
    <a href="/o/${esc(org.slug)}/media">add some</a> and they appear here to
    drop into the text.</p>` : '');

  return `
  <textarea id="${esc(name)}" name="${esc(name)}" rows="${rows}"
    class="writing">${esc(value)}</textarea>

  ${picker}

  <details class="hint-block">
    <summary>How to write it</summary>
    <table class="writing-help"><tbody>${WRITING_HELP.map(([ex, what]) =>
      `<tr><td><code>${esc(ex)}</code></td><td>${esc(what)}</td></tr>`).join('')}
    </tbody></table>
  </details>

  <link rel="stylesheet" href="/vendor/easymde.min.css">
  <script src="/vendor/easymde.min.js" defer></script>
  <script defer>
    window.addEventListener('DOMContentLoaded', function () {
      if (typeof EasyMDE !== 'function') return;   // script blocked or offline
      var area = document.getElementById(${JSON.stringify(name)});
      if (!area) return;
      var label = function (text, action, title) {
        return { name: title, action: action, title: title, text: text,
                 className: 'mde-text' };
      };
      new EasyMDE({
        element: area,
        spellChecker: false,
        autoDownloadFontAwesome: false,
        status: false,
        toolbar: [
          label('B', EasyMDE.toggleBold, 'Bold'),
          label('I', EasyMDE.toggleItalic, 'Italic'),
          label('H', EasyMDE.toggleHeadingSmaller, 'Heading'),
          '|',
          label('Link', EasyMDE.drawLink, 'Link'),
          label('List', EasyMDE.toggleUnorderedList, 'List'),
          label('1.', EasyMDE.toggleOrderedList, 'Numbered list'),
          label('Quote', EasyMDE.toggleBlockquote, 'Quotation'),
          '|',
          label('Preview', EasyMDE.togglePreview, 'Preview'),
          label('Wide', EasyMDE.toggleSideBySide, 'Side by side'),
        ],
      });
    });
  </script>`;
}

const WEEKDAYS = [[1, 'Monday'], [2, 'Tuesday'], [3, 'Wednesday'],
                  [4, 'Thursday'], [5, 'Friday'], [6, 'Saturday'], [0, 'Sunday']];

/**
 * The club's own screen for its page. What it says is the club's to write;
 * whether it goes up is the federation's to decide, and this screen says
 * which of those is happening.
 */
export const clubPageEditor = ({ me, csrf, org, profile = {}, sessions = [],
                                 state = 'off', problems = [], images = [],
                                 canAsk = false, values = null,
                                 done, error, rebuild }) => {
  const p = values?.profile ?? profile;
  const rows = (values?.sessions ?? sessions).map((t, i) => ({
    id: t.id ?? '', label: t.label ?? '', weekday: t.weekday,
    starts: t.starts ?? '', ends: t.ends ?? '',
    min: t.minAge ?? t.min_age ?? '', max: t.maxAge ?? t.max_age ?? '',
  }));
  const total = Math.min(12, Math.max(6, rows.length + 2));
  while (rows.length < total)
    rows.push({ id: '', label: '', weekday: null, starts: '', ends: '', min: '', max: '' });

  const base = `/o/${org.slug}/club-page`;
  const post = (path, label, cls = 'btn') => `<form method="post" action="${base}/${path}">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <button class="${cls}" type="submit">${/* security-ok: label is a literal passed by the calling screen */ label}</button></form>`;

  const status = {
    live: `<div class="good"><strong>Your page is on the website.</strong>
      Anything you save here goes up with the next update of the site.
      <div class="actions">${post('takedown', 'Take it off the website', 'btn quiet')}</div></div>`,
    requested: `<div class="note"><strong>Waiting for the federation.</strong>
      You asked to be on their website. They will answer here.
      <div class="actions">${post('takedown', 'Withdraw the request', 'btn quiet')}</div></div>`,
    off: `<div class="note"><strong>Not on the website yet.</strong>
      ${profile.page_note ? `The federation said: “${esc(profile.page_note)}” ` : ''}
      A page appears under the federation's name once you ask and they agree.
      ${problems.length ? `<ul style="margin:8px 0 0 18px;padding:0">${
        problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${problems.length ? '' : `<div class="actions">${
        canAsk ? post('request', 'Ask to go on the website')
               : '<span class="muted">Asking needs an owner or administrator.</span>'}</div>`}</div>`,
  }[state];

  return page({ title: `Page — ${org.name}`, me, csrf, body: `
  <h1>${esc(org.name)}'s page</h1>
  <p class="sub">What visitors see on the federation's website, in the
    federation's design. You write what it says; the federation decides
    whether it goes up.</p>

  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${rebuild ? `<div class="note">${esc(rebuild)}</div>` : ''}
  ${status}

  <form method="post" action="${base}" enctype="multipart/form-data">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">

    <fieldset><legend>Where you train</legend>
      <div class="row">
        <div><label for="venue_name">Venue</label>
          <input id="venue_name" name="venue_name" maxlength="120"
            value="${esc(p.venue_name ?? '')}"></div>
        <div><label for="address_line">Street address</label>
          <input id="address_line" name="address_line" maxlength="160"
            value="${esc(p.address_line ?? '')}"></div>
      </div>
      <div class="row">
        <div><label for="suburb">Suburb</label>
          <input id="suburb" name="suburb" maxlength="80" value="${esc(p.suburb ?? '')}"></div>
        <div><label for="city">Town or city</label>
          <input id="city" name="city" maxlength="80" value="${esc(p.city ?? '')}"></div>
        <div><label for="postcode">Postcode</label>
          <input id="postcode" name="postcode" maxlength="12" value="${esc(p.postcode ?? '')}"></div>
      </div>
      <label for="directions">Getting in
        <span class="hint">“Park at the back, side door by the playground.”</span></label>
      <textarea id="directions" name="directions" maxlength="400"
        style="min-height:64px">${esc(p.directions ?? '')}</textarea>
    </fieldset>

    <fieldset><legend>How to reach you</legend>
      <div class="row">
        <div><label for="phone">Phone</label>
          <input id="phone" name="phone" maxlength="40" value="${esc(p.phone ?? '')}"></div>
        <div><label for="email">Email</label>
          <input id="email" name="email" type="email" maxlength="160"
            value="${esc(p.email ?? '')}"></div>
      </div>
    </fieldset>

    <fieldset><legend>About you</legend>
      <label for="blurb">A few sentences in your own words
        <span class="hint">Who you are and what training with you is like.</span></label>
      <textarea id="blurb" name="blurb" maxlength="1200">${esc(p.blurb ?? '')}</textarea>
      <label for="who_trains">Who trains with you
        <span class="hint">“Mostly families, a few shift workers.”</span></label>
      <input id="who_trains" name="who_trains" maxlength="400"
        value="${esc(p.who_trains ?? '')}" style="max-width:600px">
      <div class="check"><input id="accepts_beginners" type="checkbox"
        name="accepts_beginners"${p.accepts_beginners ? ' checked' : ''}>
        <label for="accepts_beginners" style="margin:0;font-weight:400">
          New people are welcome at any time</label></div>
      <div class="check"><input id="first_class_free" type="checkbox"
        name="first_class_free"${p.first_class_free ? ' checked' : ''}>
        <label for="first_class_free" style="margin:0;font-weight:400">
          The first class is free</label></div>
      <p class="hint">The website only says these things if you tick them.</p>
    </fieldset>

    <fieldset><legend>Picture at the top</legend>
      <label for="hero_asset_id">Choose one of your pictures</label>
      <select id="hero_asset_id" name="hero_asset_id">
        <option value="">None — the plain banner</option>
        ${images.map((img) => `<option value="${esc(img.id)}"${
          p.hero_asset_id === img.id ? ' selected' : ''}>${
          esc(img.filename ?? img.id)}</option>`).join('')}
      </select>
      <label for="heroFile">…or add one now
        <span class="hint">It is uploaded when you save, and goes into your images too.</span></label>
      <input id="heroFile" type="file" name="heroFile"
        accept="image/png,image/jpeg,image/gif,image/webp">
      <p class="hint">${esc(slotHint('hero'))}</p>
      <label for="heroAlt">Describe it for somebody who cannot see it</label>
      <input id="heroAlt" name="heroAlt" maxlength="300" style="max-width:600px">
    </fieldset>

    <fieldset><legend>Training times</legend>
      <p class="hint" style="margin-top:12px">One row for each class. Empty a row to
        remove it. Times are 24-hour, like 18:30.</p>
      <div class="times-edit">
        <div class="t head"><span>Class</span><span>Day</span><span>Starts</span>
          <span>Ends</span><span>From age</span><span>To age</span></div>
        ${rows.map((t, i) => `<div class="t">
          <input type="hidden" name="session_id_${i}" value="${esc(t.id)}">
          <input name="session_label_${i}" maxlength="80" value="${esc(t.label)}"
            ${i === 0 ? 'placeholder="Juniors" ' : ''}aria-label="Class ${i + 1} name">
          <select name="session_day_${i}" aria-label="Class ${i + 1} day">
            <option value=""></option>${WEEKDAYS.map(([n, name]) => `<option value="${n}"${
              t.weekday === n ? ' selected' : ''}>${/* security-ok: name comes from the fixed WEEKDAYS table */ name}</option>`).join('')}</select>
          <input name="session_starts_${i}" type="time" value="${esc(t.starts)}"
            aria-label="Class ${i + 1} starts">
          <input name="session_ends_${i}" type="time" value="${esc(t.ends)}"
            aria-label="Class ${i + 1} ends">
          <input name="session_min_${i}" type="number" min="0" max="99"
            value="${esc(t.min)}" aria-label="Class ${i + 1} youngest">
          <input name="session_max_${i}" type="number" min="0" max="99"
            value="${esc(t.max)}" aria-label="Class ${i + 1} oldest">
        </div>`).join('')}
      </div>
    </fieldset>

    <div class="actions">
      <button class="btn" type="submit">Save</button>
      <a class="btn quiet" href="${base}/preview" target="_blank" rel="noopener">
        See it as visitors will</a>
    </div>
  </form>` });
};

/**
 * The federation's side: every club beneath it, where its page stands, and
 * the decision. Also the other way in — a federation that has filled in a
 * club's details itself can switch it on without being asked.
 */
export const clubPageList = ({ me, csrf, org, clubs = [], vocabulary = {},
                               done, error, rebuild }) => {
  const word = vocabulary.club ?? 'Club';
  const plural = vocabulary.clubPlural ?? `${word}s`;
  const waiting = clubs.filter((c) => c.state === 'requested');

  const decide = (c, answer, label, cls) => `<form method="post"
    action="/o/${esc(org.slug)}/club-pages/${esc(c.id)}/decide" style="display:inline">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <button class="${cls}" type="submit" name="answer" value="${answer}">${/* security-ok: label is a literal passed by the calling screen */ label}</button>
  </form>`;

  const tag = (c) => ({
    live: '<span class="tag ok">On the website</span>',
    requested: '<span class="tag wait">Asking</span>',
    off: '<span class="tag no">No page</span>',
  }[c.state]);

  return page({ title: `${plural} pages — ${org.name}`, me, csrf, body: `
  <h1>${esc(word)} pages</h1>
  <p class="sub">${esc(org.name)} · each ${esc(word.toLowerCase())} chooses what its
    page says; you choose which go on your website. They all use your design.</p>

  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${rebuild ? `<div class="note">${esc(rebuild)}</div>` : ''}

  ${waiting.length ? `<h2>Asking to go on the website</h2>
  ${waiting.map((c) => `<div class="card">
    <h3>${esc(c.name)}</h3>
    <p>${esc([c.venue_name, c.city].filter(Boolean).join(', '))}</p>
    ${c.blurb ? `<p style="margin-top:8px;color:var(--ink-2)">${esc(c.blurb)}</p>` : ''}
    <div class="actions">
      ${decide(c, 'approve', 'Put it on the website', 'btn')}
      <a class="btn quiet" href="/o/${esc(c.slug)}/club-page/preview"
        target="_blank" rel="noopener">Preview</a>
    </div>
    <form method="post" action="/o/${esc(org.slug)}/club-pages/${esc(c.id)}/decide"
          style="margin-top:12px">
      <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
      <label for="note-${esc(c.id)}">If not yet, tell them why
        <span class="hint">They will see this on their own screen.</span></label>
      <input id="note-${esc(c.id)}" name="note" maxlength="400" style="max-width:480px">
      <p><button class="btn quiet" type="submit" name="answer" value="decline">
        Not yet</button></p>
    </form>
  </div>`).join('')}` : ''}

  <h2>Every ${esc(word.toLowerCase())}</h2>
  ${clubs.length ? `<table>
    <thead><tr><th>${esc(word)}</th><th>Page</th><th class="hide-sm">What is missing</th>
      <th></th></tr></thead>
    <tbody>${clubs.map((c) => `<tr>
      <td><strong>${esc(c.name)}</strong>
        ${c.city ? `<div class="muted">${esc(c.city)}</div>` : ''}</td>
      <td>${tag(c)}</td>
      <td class="hide-sm muted">${c.state === 'live' ? ''
        : c.gaps.length ? `Needs ${esc(c.gaps.join(', '))}` : 'Ready'}</td>
      <td><a class="btn quiet" href="/o/${esc(c.slug)}/club-page">Open</a>
        ${c.state === 'off' && !c.gaps.length
          ? decide(c, 'approve', 'Switch on', 'btn') : ''}</td>
    </tr>`).join('')}</tbody></table>`
    : `<div class="note">There are no ${esc(plural.toLowerCase())} beneath
        ${esc(org.name)} yet.</div>`}` });
};

/**
 * Appearance: choose a built-in theme, import one, or download this one.
 *
 * Import is paste-a-file rather than upload, so the screen works without
 * JavaScript and the file is read by the same validator the build uses.
 */
export const appearanceEditor = ({ me, csrf, org, current, builtIn = [], home = {},
                                   preview = null, pasted = '', problems = [],
                                   done, error, rebuild }) => {
  const swatches = (t) => ['primary', 'accent', 'ink', 'canvas', 'neutral']
    .map((k) => `<span title="${k} ${esc(t.colours[k])}" style="display:inline-block;`
      + `width:22px;height:22px;border:1px solid #0003;margin-right:2px;background:${
        esc(t.colours[k])}"></span>`).join('');
  const action = `/o/${esc(org.slug)}/appearance`;
  return page({ title: `Appearance — ${org.name}`, me, csrf, body: `
  <h1>Appearance</h1>
  <p class="sub">${esc(org.name)} · colours, fonts and which sections appear.
    Words stay yours; a theme never carries any.</p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${rebuild ? `<div class="note">${esc(rebuild)}</div>` : ''}
  ${problems.length ? `<div class="bad"><strong>That theme was not used:</strong><ul>${
    problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}

  <h2>Crest</h2>
  <form method="post" action="${action}/logo" enctype="multipart/form-data" class="card" style="margin-bottom:24px">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <p>Your crest shows in the site header and on every event banner. A transparent PNG on a dark background works best.</p>
    <p><label>Add a crest<br><input type="file" name="logoFile" accept="image/png,image/jpeg,image/webp"></label></p>
    <p class="hint">At least 600 pixels high, with nothing but the crest in the picture.</p>
    <p><button class="btn" type="submit">Use this crest</button>
      <button class="btn" type="submit" name="remove" value="1">Remove the crest</button></p>
  </form>

  <h2>Home page</h2>
  <form method="post" action="${action}/home" enctype="multipart/form-data" class="card" style="margin-bottom:24px">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <label for="heroHeading">Heading</label>
    <input id="heroHeading" name="heroHeading" maxlength="80" value="${esc(home.heroHeading ?? '')}" placeholder="Everyone starts somewhere.">
    <label for="heroText">Line under the heading</label>
    <input id="heroText" name="heroText" maxlength="300" value="${esc(home.heroText ?? '')}">
    <label for="heroButton">Button</label>
    <input id="heroButton" name="heroButton" maxlength="80" value="${esc(home.heroButton ?? '')}" placeholder="Find your ${clubWord()}">
    <p class="hint">Leave a box empty to use the standard words.</p>
    <p><label>Big picture at the top${home.heroAssetId ? ' (one is set — choosing another replaces it)' : ''}<br>
      <input type="file" name="heroFile" accept="image/png,image/jpeg,image/webp"></label></p>
    <p class="hint">${esc(slotHint('hero'))}</p>
    <p><label>Picture shown when the site is shared${home.shareAssetId ? ' (one is set)' : ''}<br>
      <input type="file" name="shareFile" accept="image/png,image/jpeg,image/webp"></label></p>
    <p class="hint">${esc(slotHint('share'))}</p>
    <p><button class="btn" type="submit">Save the home page</button>
      ${home.heroAssetId ? '<button class="btn quiet" type="submit" name="removeHero" value="1">Remove the big picture</button>' : ''}
      ${home.shareAssetId ? '<button class="btn quiet" type="submit" name="removeShare" value="1">Remove the share picture</button>' : ''}</p>
  </form>

  <h2>Now</h2>
  ${current
    ? `<p><strong>${esc(current.name)}</strong> ${swatches(current)}
       <span class="muted">${esc(current.fonts.display)} / ${esc(current.fonts.body)}</span></p>
       <form method="post" action="${action}/reset" style="display:inline">
         <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
         <button class="btn quiet" type="submit">Go back to the default look</button></form>
       <a class="btn quiet" href="${action}/export">Download this theme</a>`
    : `<p class="muted">Nothing chosen here, so the site uses the deployment's
       settings file, or the neutral default.</p>`}

  <h2>Built-in themes</h2>
  ${builtIn.map((t) => `<form method="post" action="${action}" class="row"
      style="align-items:center;margin-bottom:8px">
      <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
      <input type="hidden" name="builtin" value="${esc(t.key)}">
      <div><strong>${esc(t.name)}</strong> ${swatches(t)}<br>
        <span class="muted">${esc(t.description ?? '')}</span></div>
      <div><button class="btn" type="submit">Use this</button></div></form>`).join('')}

  <h2>Import a theme</h2>
  <p class="muted">Paste a theme file (JSON). It is checked before anything
    changes: only colours, fonts and section order are accepted, and a palette
    that would be hard to read is refused.</p>
  <form method="post" action="${action}">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <label for="theme_json">Theme file</label>
    <textarea id="theme_json" name="theme_json" rows="12" spellcheck="false"
      style="font-family:monospace">${esc(pasted)}</textarea>
    <div class="actions"><button class="btn" type="submit">Check and use</button></div>
  </form>`, });
};
