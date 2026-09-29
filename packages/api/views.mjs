import fs from 'node:fs';
import path from 'node:path';
/**
 * HONBU — admin views
 *
 * Plain HTML. No client framework, no build step. Every screen works with
 * JavaScript turned off, because these get used on bad connections in halls.
 */

/**
 * What this federation calls things. Read from the same settings file the
 * public site uses, so the admin and the website never disagree about whether
 * a place is a Dojo, a Dojang, an Academy or a Gym.
 *
 * Read once, and neutral if the file is missing or unreadable — the admin
 * failing to load because somebody mistyped a label would be a poor trade.
 */
const VOCABULARY = (() => {
  const fallback = { club: 'Club', clubPlural: 'Clubs', grading: 'Grading',
                     grade: 'Grade' };
  try {
    const dir = process.env.HONBU_DATA
      ?? new URL('../../data/', import.meta.url).pathname;
    const raw = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8');
    const custom = JSON.parse(raw).vocabulary ?? {};
    const clean = Object.fromEntries(
      Object.entries(custom).filter(([k, v]) =>
        !k.startsWith('_') && typeof v === 'string' && v.trim()));
    return { ...fallback, ...clean };
  } catch {
    return fallback;
  }
})();

const V = VOCABULARY;

const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const CSS = `
:root{
  --red:#CE372C; --red-text:#9A2A1F; --gold:#F0CE41;
  --ink:#161617; --ink-2:#252527; --ink-3:#3A3A3D;
  --canvas:#F5F5F5; --canvas-2:#E3E3E3; --silver:#BDBDBF; --muted:#6F6F72;
}
*{box-sizing:border-box}
body{margin:0;background:var(--canvas);color:var(--ink);
  font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:900px;margin:0 auto;padding:0 20px}
a{color:var(--red-text)}
header{background:var(--ink);color:var(--canvas)}
header .wrap{display:flex;align-items:center;gap:16px;padding:12px 20px}
header a{color:var(--canvas);text-decoration:none}
header .who{margin-left:auto;font-size:14px;color:var(--silver)}
header form{display:inline;margin-left:14px}
header button{background:none;border:1px solid var(--silver);color:var(--canvas);
  font:inherit;font-size:13px;padding:4px 10px;cursor:pointer}
h1{font-size:26px;margin:28px 0 6px}
h2{font-size:19px;margin:28px 0 10px}
.sub{color:var(--muted);margin:0 0 20px}
table{width:100%;border-collapse:collapse;background:#fff;font-size:15px}
th{text-align:left;padding:10px 12px;border-bottom:2px solid var(--ink);font-size:13px;
  letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
td{padding:11px 12px;border-bottom:1px solid var(--canvas-2)}
tr:hover td{background:#FAFAFA}
.tag{font-size:12px;font-weight:700;padding:2px 8px;border-radius:2px}
.tag.ok{background:#E4F0E4;color:#2E6B33}
.tag.no{background:var(--canvas-2);color:var(--muted)}
.tag.dan{background:var(--ink);color:var(--gold)}
.card{background:#fff;border:1px solid var(--canvas-2);padding:18px 20px;margin:0 0 14px}
.card h3{margin:0 0 4px;font-size:17px}
.card p{margin:0;color:var(--muted);font-size:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.btn{display:inline-block;background:var(--red);color:#fff;border:0;font:inherit;
  font-weight:600;padding:11px 20px;text-decoration:none;cursor:pointer}
.btn:hover{background:var(--red-text)}
.btn.quiet{background:none;color:var(--red-text);border:1px solid var(--silver)}
input,select{font:inherit;padding:9px 11px;border:1px solid var(--silver);
  background:#fff;width:100%;max-width:340px}
label{display:block;font-size:14px;font-weight:600;margin:14px 0 4px}
.note{background:#FDF6E3;border-left:4px solid var(--gold);padding:12px 16px;margin:16px 0}
.bad{background:#FBE9E7;border-left:4px solid var(--red);padding:12px 16px;margin:16px 0}
.good{background:#E4F0E4;border-left:4px solid #2E6B33;padding:12px 16px;margin:16px 0}
.muted{color:var(--muted);font-size:14px}
ul.plain{list-style:none;padding:0;margin:0}
ul.plain li{padding:8px 0;border-bottom:1px solid var(--canvas-2)}
footer{color:var(--muted);font-size:13px;padding:40px 0}
textarea{font:inherit;padding:9px 11px;border:1px solid var(--silver);
  background:#fff;width:100%;max-width:560px;min-height:90px}
.row{display:flex;flex-wrap:wrap;gap:18px}
.row > div{flex:1 1 200px}
.row input,.row select{max-width:none}
.hint{font-size:13px;color:var(--muted);margin:4px 0 0;font-weight:400}
label .hint{display:block}
.check{display:flex;align-items:flex-start;gap:9px;margin:12px 0;font-size:15px}
.check input{width:auto;margin-top:4px}
fieldset{border:1px solid var(--canvas-2);background:#fff;padding:4px 20px 20px;
  margin:22px 0}
legend{font-size:13px;letter-spacing:.04em;text-transform:uppercase;
  color:var(--muted);font-weight:700;padding:0 6px}
.actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:26px 0 0}
.actions form{display:inline}
.right{margin-left:auto}
td form{display:inline}
td .btn{padding:6px 12px;font-size:14px}
.draft td{background:#FCFCF7}
@media(max-width:600px){
  table{font-size:14px} td,th{padding:9px 8px}
  .hide-sm{display:none}
}`;

function page({ title, me, body, csrf }) {
  return `<!DOCTYPE html><html lang="en-NZ"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — Honbu</title><style>${CSS}</style></head><body>
<header><div class="wrap">
  <a href="/dashboard"><strong>Honbu</strong></a>
  ${me ? `<span class="who">${esc(me.name)}
    <form method="post" action="/signout">
      <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
      <button>Sign out</button></form></span>` : ''}
</div></header>
<div class="wrap">${body}</div>
<footer class="wrap">Honbu — federation register</footer>
</body></html>`;
}

// ---------------------------------------------------------------------------

export const signIn = ({ sent, error, csrf } = {}) => page({
  title: 'Sign in', me: null,
  body: `
  <h1>Sign in</h1>
  ${sent ? `<div class="good"><strong>Check your email.</strong>
    If that address is registered, a sign-in link is on its way. It works once
    and expires in 15 minutes.</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${sent ? '' : `
  <p class="sub">No password. We email you a link.</p>
  <form method="post" action="/signin">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <label for="email">Email address</label>
    <input id="email" name="email" type="email" required autocomplete="email">
    <p><button class="btn" type="submit">Email me a link</button></p>
  </form>`}`,
});

export const dashboard = ({ me, csrf, orgs, vocabulary = {} }) => {
  // The federation being looked at decides the words, not the deployment.
  const V = { ...VOCABULARY, ...vocabulary };
  const clubs = orgs.filter((o) => o.type === 'club' || o.type === 'dojo');
  const parents = orgs.filter((o) => !(o.type === 'club' || o.type === 'dojo'));
  const total = clubs.reduce((n, o) => n + Number(o.members), 0);
  return page({ title: 'Dashboard', me, csrf, body: `
  <h1>${esc(me.name)}</h1>
  <p class="sub">${orgs.length} organisation${orgs.length === 1 ? '' : 's'},
    ${total} active member${total === 1 ? '' : 's'}</p>

  ${parents.map((o) => `<div class="card">
    <h3>${esc(o.name)}</h3>
    <p>${esc(o.type)} · <a href="/o/${esc(o.slug)}/roster">Members</a>
       · <a href="/o/${esc(o.slug)}/events">Events</a>
       · <a href="/o/${esc(o.slug)}/grading">Grading</a></p>
  </div>`).join('')}

  <h2>${esc(V.clubPlural)}</h2>
  <div class="grid">${clubs.map((o) => `<div class="card">
    <h3><a href="/o/${esc(o.slug)}/roster">${esc(o.name)}</a></h3>
    <p>${o.members} member${Number(o.members) === 1 ? '' : 's'}</p>
  </div>`).join('')}</div>` });
};

export const roster = ({ me, csrf, org, roster }) => page({
  title: `${org.name} roster`, me, csrf, body: `
  <h1>${esc(org.name)}</h1>
  <p class="sub">${roster.length} on the roll ·
    <a href="/o/${esc(org.slug)}/grading">Run a grading</a> ·
    <a href="/o/${esc(org.slug)}/events">Events</a></p>
  ${roster.length ? `<table>
    <thead><tr><th>Name</th><th>Grade</th><th class="hide-sm">Age</th>
      <th class="hide-sm">Role</th><th>Paid until</th></tr></thead>
    <tbody>${roster.map((p) => `<tr>
      <td><a href="/p/${p.id}">${esc(p.first_name)} ${esc(p.last_name)}</a>
        <span class="muted">${esc(p.display_number ?? '')}</span></td>
      <td>${p.grade ? `<span class="tag ${p.is_dan ? 'dan' : 'ok'}">${esc(p.grade)}</span>`
        : '<span class="tag no">ungraded</span>'}</td>
      <td class="hide-sm">${p.age ?? ''}</td>
      <td class="hide-sm">${esc(p.role)}</td>
      <td>${p.paid_until ? String(new Date(p.paid_until).toISOString().slice(0,10)) : '—'}</td>
    </tr>`).join('')}</tbody></table>`
    : '<div class="note">Nobody on the roll yet.</div>'}` });

export const person = ({ me, csrf, person, history, affiliations, eligibility }) => page({
  title: `${person.first_name} ${person.last_name}`, me, csrf, body: `
  <h1>${esc(person.first_name)} ${esc(person.last_name)}</h1>
  <p class="sub">${esc(person.display_number ?? 'no member number')}
    ${person.age ? ` · ${person.age} years old` : ''}</p>

  ${!eligibility?.next && history.length
    ? `<div class="note"><strong>Top of the ladder.</strong>
       No higher grade is defined in this federation's syllabus.</div>` : ''}
  ${eligibility?.next ? (eligibility.eligible
    ? `<div class="good"><strong>Eligible for ${esc(eligibility.next)}.</strong>
       ${eligibility.months.has} months at grade, ${eligibility.sessions.has} sessions since.</div>`
    : `<div class="note"><strong>Not yet eligible for ${esc(eligibility.next)}.</strong>
       Needs ${eligibility.unmet.map(esc).join(', ')}.</div>`) : ''}

  <h2>Grading history</h2>
  ${history.length ? `<table>
    <thead><tr><th>Grade</th><th>Awarded</th><th class="hide-sm">By</th>
      <th class="hide-sm">Ratified</th></tr></thead>
    <tbody>${history.map((h) => `<tr>
      <td><strong>${esc(h.label)}</strong></td>
      <td>${String(new Date(h.awarded_on).toISOString().slice(0,10))}</td>
      <td class="hide-sm">${esc(h.awarded_by)}</td>
      <td class="hide-sm">${h.ratified_on
        ? String(new Date(h.ratified_on).toISOString().slice(0,10))
        : '<span class="muted">pending</span>'}</td>
    </tr>`).join('')}</tbody></table>`
    : '<div class="note">No gradings on file.</div>'}

  <h2>Affiliation</h2>
  <ul class="plain">${affiliations.map((a) => `<li>
    <strong>${esc(a.organisation)}</strong> — ${esc(a.role)},
    from ${String(new Date(a.starts).toISOString().slice(0,10))}
    ${a.ends ? `to ${String(new Date(a.ends).toISOString().slice(0,10))}`
             : '<span class="tag ok">current</span>'}
  </li>`).join('')}</ul>` });

export const grading = ({ me, csrf, org, candidates, ladder, done, error }) => {
  const byOrder = Object.fromEntries(ladder.map((g) => [g.rank_order, g]));
  return page({ title: `Grading — ${org.name}`, me, csrf, body: `
  <h1>Run a grading</h1>
  <p class="sub">${esc(org.name)} · <a href="/o/${esc(org.slug)}/roster">Back to roster</a></p>

  ${done ? `<div class="good"><strong>${esc(done)} grading${done === '1' ? '' : 's'} recorded.</strong></div>` : ''}
  ${error ? `<div class="bad"><strong>Nothing was recorded.</strong> ${esc(error)}</div>` : ''}

  <form method="post" action="/o/${esc(org.slug)}/grading">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <label for="awarded_on">Date of grading</label>
    <input id="awarded_on" name="awarded_on" type="date" required
      value="${new Date().toISOString().slice(0,10)}">

    <label for="panel">Examining panel</label>
    <input id="panel" name="panel" placeholder="member ids, comma separated">
    <p class="muted">The panel is checked against the grade being awarded —
      size and seniority both.</p>

    <h2>Candidates</h2>
    ${candidates.length ? `<table>
      <thead><tr><th>Pass</th><th>Name</th><th>Holds</th><th>For</th>
        <th class="hide-sm">Eligibility</th></tr></thead>
      <tbody>${candidates.map((c) => {
        const next = byOrder[(c.rank_order ?? 0) + 1];
        return `<tr>
        <td><input type="checkbox" name="pass_${c.id}" style="width:auto"
          ${c.eligibility?.eligible ? '' : 'disabled'}></td>
        <td>${esc(c.first_name)} ${esc(c.last_name)}</td>
        <td>${esc(c.grade ?? '—')}</td>
        <td>${next ? `${esc(next.label)}
          <input type="hidden" name="grade_${c.id}" value="${next.id}">` : '—'}</td>
        <td class="hide-sm">${c.eligibility?.eligible
          ? '<span class="tag ok">eligible</span>'
          : `<span class="muted">${esc((c.eligibility?.unmet ?? []).join(', ') || 'no next grade')}</span>`}</td>
      </tr>`; }).join('')}</tbody></table>
      <p><button class="btn" type="submit">Record gradings</button></p>`
      : '<div class="note">Nobody on this roll yet.</div>'}
  </form>` });
};

/**
 * The calendar as the person running it sees it.
 *
 * Two lists, deliberately separate. Its own events, which it may change, and
 * events inherited from above, which it may not. Mixing them into one table
 * with some rows editable is how somebody ends up trying to cancel the
 * national grading from their dojo page.
 */
export const events = ({ me, csrf, org, own = [], inherited = [], zone,
                         canSchedule = true, done, error }) => page({
  title: `Events — ${org.name}`, me, csrf, body: `
  <h1>Events</h1>
  <p class="sub">${esc(org.name)} ·
    <a href="/o/${esc(org.slug)}/roster">Back to roster</a></p>

  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}

  ${canSchedule
    ? `<p><a class="btn" href="/o/${esc(org.slug)}/events/new">Add an event</a></p>`
    : '<p class="muted">You can see this calendar but not change it.</p>'}

  ${own.length ? `<table>
    <thead><tr><th>When</th><th>Event</th><th class="hide-sm">Kind</th>
      <th>Status</th><th></th></tr></thead>
    <tbody>${own.map((e) => `<tr${e.status === 'draft' ? ' class="draft"' : ''}>
      <td>${esc(readable(e.startsAt, zone, !e.allDay))}</td>
      <td><strong>${esc(e.title)}</strong>
        ${e.venueName ? `<div class="muted">${esc(e.venueName)}</div>` : ''}</td>
      <td class="hide-sm">${esc(kindLabel(e.kind))}</td>
      <td>${statusTag(e.status)}</td>
      <td>${canSchedule ? `<a class="btn quiet"
        href="/o/${esc(org.slug)}/events/${esc(String(e.slug))}/edit">Edit</a>` : ''}</td>
    </tr>`).join('')}</tbody></table>`
    : '<div class="note">Nothing on this calendar yet.</div>'}

  ${inherited.length ? `<h2>From further up</h2>
  <p class="muted">Published to this calendar by a parent organisation. Edit
    these where they were created.</p>
  <table>
    <thead><tr><th>When</th><th>Event</th><th class="hide-sm">From</th></tr></thead>
    <tbody>${inherited.map((e) => `<tr>
      <td>${esc(readable(e.starts_at, zone, true))}</td>
      <td>${esc(e.title)}</td>
      <td class="hide-sm">${esc(e.from_org ?? '')}</td>
    </tr>`).join('')}</tbody></table>` : ''}` });

const KIND_LABELS = {
  grading: 'Grading', tournament: 'Tournament', camp: 'Camp',
  seminar: 'Seminar', fight_night: 'Fight night', training: 'Training',
  social: 'Social', other: 'Other',
};
const kindLabel = (k) => KIND_LABELS[k] ?? k;

const VISIBILITY_LABELS = {
  public: 'Anyone, including the public website',
  members: 'Members anywhere in the federation',
  own_org: 'This organisation only',
  by_grade: 'Only within a grade range',
  invite: 'Invited people only',
};

const STATUS_TAGS = {
  draft: ['no', 'Draft'], published: ['ok', 'Published'],
  cancelled: ['no', 'Cancelled'], completed: ['dan', 'Completed'],
};
const statusTag = (s) => {
  const [cls, label] = STATUS_TAGS[s] ?? ['no', s];
  return `<span class="tag ${cls}">${esc(label)}</span>`;
};

/**
 * Rendering a time is the view's job, so the view is given the zone rather
 * than the formatted string: a table that formats its own dates cannot get
 * half of them in one zone and half in another.
 */
const readable = (instant, zone, withTime = true) => {
  if (!instant) return '';
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-NZ', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
      ...(withTime ? { hour: 'numeric', minute: '2-digit', hour12: true } : {}),
      timeZone: zone || 'UTC',
    }).format(d);
  } catch { return d.toISOString().slice(0, 16).replace('T', ' '); }
};

const option = (value, label, selected) =>
  `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`;

const checkbox = (name, label, checked, hint = '') => `
  <div class="check">
    <input type="checkbox" id="${name}" name="${name}" value="1"${checked ? ' checked' : ''}>
    <label for="${name}" style="margin:0;font-weight:400">${esc(label)}
      ${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</label>
  </div>`;

/**
 * One form for creating and for changing.
 *
 * Two forms would drift: a field added to one and forgotten in the other means
 * an event you can create with a capacity and then never edit it. `values` is
 * whatever the person last submitted when something was refused, so a mistake
 * in one field does not throw away the other fifteen.
 */
export const eventForm = ({ me, csrf, org, values = {}, zone, error,
                            isNew = true, status = 'draft', grades = [] }) => {
  const v = (k, fallback = '') => values[k] ?? fallback;
  const action = isNew
    ? `/o/${org.slug}/events/new`
    : `/o/${org.slug}/events/${values.slug}/edit`;

  return page({
    title: `${isNew ? 'New event' : values.title} — ${org.name}`, me, csrf, body: `
  <h1>${isNew ? 'Add an event' : 'Edit event'}</h1>
  <p class="sub">${esc(org.name)} ·
    <a href="/o/${esc(org.slug)}/events">Back to the calendar</a>
    ${isNew ? '' : ` · ${statusTag(status)}`}</p>

  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${zone ? `<p class="muted">Times are ${esc(zone.replace('_', ' '))}
    — the local time where the event is.</p>` : ''}

  <form method="post" action="${esc(action)}">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">

    <label for="title">Title</label>
    <input id="title" name="title" required maxlength="200"
      value="${esc(v('title'))}" style="max-width:560px">

    <div class="row">
      <div>
        <label for="kind">Kind</label>
        <select id="kind" name="kind">
          ${Object.keys(KIND_LABELS).map((k) =>
            option(k, KIND_LABELS[k], v('kind', 'training'))).join('')}
        </select>
      </div>
      <div>
        <label for="slug">Web address
          <span class="hint">Leave blank and it is made from the title.</span></label>
        <input id="slug" name="slug" value="${esc(v('slug'))}"
          pattern="[a-z0-9]+(-[a-z0-9]+)*">
      </div>
    </div>

    <label for="summary">One line about it</label>
    <input id="summary" name="summary" maxlength="300"
      value="${esc(v('summary'))}" style="max-width:560px">

    <fieldset>
      <legend>When</legend>
      <div class="row">
        <div>
          <label for="startsAt">Starts</label>
          <input id="startsAt" name="startsAt" type="datetime-local" required
            value="${esc(v('startsAt'))}">
        </div>
        <div>
          <label for="endsAt">Ends <span class="hint">Optional.</span></label>
          <input id="endsAt" name="endsAt" type="datetime-local"
            value="${esc(v('endsAt'))}">
        </div>
      </div>
      ${checkbox('allDay', 'All day', !!v('allDay'),
        'Hides the time wherever this is shown.')}
    </fieldset>

    <fieldset>
      <legend>Where</legend>
      <div class="row">
        <div>
          <label for="venueName">Venue</label>
          <input id="venueName" name="venueName" maxlength="200"
            value="${esc(v('venueName'))}">
        </div>
        <div>
          <label for="addressLine">Address</label>
          <input id="addressLine" name="addressLine" maxlength="300"
            value="${esc(v('addressLine'))}">
        </div>
      </div>
    </fieldset>

    <fieldset>
      <legend>Who it is for</legend>
      <label for="visibility">Who can see it</label>
      <select id="visibility" name="visibility" style="max-width:420px">
        ${Object.keys(VISIBILITY_LABELS).map((k) =>
          option(k, VISIBILITY_LABELS[k], v('visibility', 'public'))).join('')}
      </select>

      <div class="row">
        <div>
          <label for="minRankOrder">Lowest grade
            <span class="hint">Leave blank for no limit.</span></label>
          <select id="minRankOrder" name="minRankOrder">
            ${option('', 'No limit', v('minRankOrder'))}
            ${grades.map((g) => option(String(g.rankOrder), g.label,
              v('minRankOrder'))).join('')}
          </select>
        </div>
        <div>
          <label for="maxRankOrder">Highest grade</label>
          <select id="maxRankOrder" name="maxRankOrder">
            ${option('', 'No limit', v('maxRankOrder'))}
            ${grades.map((g) => option(String(g.rankOrder), g.label,
              v('maxRankOrder'))).join('')}
          </select>
        </div>
      </div>

      <div class="row">
        <div>
          <label for="minAge">Youngest age</label>
          <input id="minAge" name="minAge" type="number" min="0" max="120"
            value="${esc(v('minAge'))}">
        </div>
        <div>
          <label for="maxAge">Oldest age</label>
          <input id="maxAge" name="maxAge" type="number" min="0" max="120"
            value="${esc(v('maxAge'))}">
        </div>
      </div>
    </fieldset>

    <fieldset>
      <legend>Entries</legend>
      <div class="row">
        <div>
          <label for="entriesOpen">Entries open</label>
          <input id="entriesOpen" name="entriesOpen" type="datetime-local"
            value="${esc(v('entriesOpen'))}">
        </div>
        <div>
          <label for="entriesClose">Entries close</label>
          <input id="entriesClose" name="entriesClose" type="datetime-local"
            value="${esc(v('entriesClose'))}">
        </div>
        <div>
          <label for="capacity">Places <span class="hint">Blank for no limit.</span></label>
          <input id="capacity" name="capacity" type="number" min="1" max="32000"
            value="${esc(v('capacity'))}">
        </div>
      </div>
    </fieldset>

    <fieldset>
      <legend>Where it appears</legend>
      ${checkbox('publishDown', 'Show on the calendars below this organisation',
        !!v('publishDown'), 'Every club under it sees it on their own page.')}
      ${checkbox('publishUp', 'Ask for it to appear on the parent calendar',
        !!v('publishUp'), 'The parent has to approve it.')}
    </fieldset>

    <div class="actions">
      ${isNew ? `
        <button class="btn" type="submit" name="status" value="draft">Save as draft</button>
        <button class="btn quiet" type="submit" name="status" value="published">
          Save and publish</button>`
      : `
        <button class="btn" type="submit" name="status" value="${esc(status)}">
          Save changes</button>
        ${status === 'draft'
          ? `<button class="btn quiet" type="submit" name="status" value="published">
              Save and publish</button>` : ''}
        ${status === 'published'
          ? `<button class="btn quiet" type="submit" name="status" value="draft">
              Save and unpublish</button>` : ''}`}
      <a class="btn quiet" href="/o/${esc(org.slug)}/events">Cancel</a>
    </div>
  </form>

  ${isNew || status === 'cancelled' || status === 'completed' ? '' : `
  <fieldset>
    <legend>Call it off</legend>
    <p class="muted">The event stays on the record as cancelled. People who have
      it in their diary can see what happened to it.</p>
    <form method="post"
      action="/o/${esc(org.slug)}/events/${esc(values.slug)}/cancel">
      <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
      <button class="btn quiet" type="submit">Cancel this event</button>
    </form>
  </fieldset>`}` });
};

export const error = ({ me, csrf, status, message }) => page({
  title: `Error ${status}`, me, csrf, body: `
  <h1>${status}</h1>
  <div class="bad">${esc(message)}</div>
  <p><a class="btn quiet" href="/dashboard">Back</a></p>` });
