import fs from 'node:fs';
import { describe as auditDescribe, weight as auditWeight }
  from '../content/audit.mjs';
import { highlight as searchHighlight, linkTo as searchLinkTo }
  from '../content/search.mjs';
import { WRITING_HELP } from '../content/document-text.mjs';
import path from 'node:path';
import { BLOCKS } from '../content/blocks.mjs';
import { BLOCK_MENU } from '../content/page-form.mjs';
import { SHORTHAND_HELP } from '../content/marks.mjs';
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
const NEUTRAL = Object.freeze({ club: 'Club', clubPlural: 'Clubs',
                                grading: 'Grading', grade: 'Grade' });

const VOCABULARY = (() => {
  const fallback = NEUTRAL;
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
  --ink:#15171A; --ink-2:#394047; --muted:#68777F;
  --canvas:#FFFFFF; --wash:#F5F6F7; --soft:#ECEEF0; --line:#E2E6E9; --line-2:#CED4D9;
  --accent:#3451D1; --accent-ink:#263CA3; --accent-wash:#EEF1FD;
  --ok:#1E6B35; --ok-wash:#E8F4EB; --warn:#7A5200; --warn-wash:#FFF7E0;
  --bad:#A8261B; --bad-wash:#FDEDEB;
  --radius:10px;
}
*{box-sizing:border-box}
body{margin:0;background:var(--wash);color:var(--ink);
  font:15.5px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  -webkit-font-smoothing:antialiased}
a{color:var(--accent-ink)}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.skip{position:absolute;left:-999px;top:8px;background:var(--ink);color:#fff;
  padding:8px 14px;border-radius:6px;z-index:10}
.skip:focus{left:8px}

/* ---- the frame ------------------------------------------------------ */
.shell{display:grid;grid-template-columns:auto minmax(0,1fr);
  grid-template-areas:"rail stage";min-height:100vh}
.rail{grid-area:rail;width:248px;background:var(--canvas);border-right:1px solid var(--line);
  padding:20px 14px 28px;position:sticky;top:0;height:100vh;overflow-y:auto}
.rail .brand{display:block;font-weight:700;font-size:18px;letter-spacing:-.02em;
  color:var(--ink);text-decoration:none;padding:2px 10px 16px}
.rail .here{background:var(--wash);border:1px solid var(--line);
  border-radius:var(--radius);padding:10px 12px;margin:0 0 18px;line-height:1.35}
.rail .here strong{display:block;font-size:14.5px}
.rail .here span{font-size:12.5px;color:var(--muted)}
.rail h6{margin:18px 10px 6px;font-size:11.5px;font-weight:700;letter-spacing:.07em;
  text-transform:uppercase;color:var(--muted)}
.rail nav a{display:block;padding:7px 10px;border-radius:7px;color:var(--ink-2);
  text-decoration:none;font-size:14.5px}
.rail nav a:hover{background:var(--soft)}
.rail nav a[aria-current="page"]{background:var(--accent-wash);color:var(--accent-ink);
  font-weight:600}
.rail .all{margin-top:20px;border-top:1px solid var(--line);padding-top:12px}
.stage{grid-area:stage;min-width:0;display:flex;flex-direction:column}
.top{display:flex;align-items:center;gap:14px;padding:12px 32px;
  background:var(--canvas);border-bottom:1px solid var(--line)}
.top .brand{font-weight:700;font-size:18px;letter-spacing:-.02em;
  color:var(--ink);text-decoration:none}
.top .find{display:flex;gap:6px;align-items:center;margin-left:auto}
.top .find input{padding:7px 12px;border-radius:8px;border:1px solid var(--line-2);
  background:var(--wash);min-width:200px;font-size:14px}
.top .find label{color:var(--muted);font-size:13px;margin:0;font-weight:500}
.top .find .btn{padding:7px 14px;font-size:14px}
.shell:has(.rail) .top .brand{display:none}
.top .who{font-size:14px;color:var(--muted);display:flex;align-items:center;gap:10px}
.top .who form{display:inline;margin:0}
.top .who button{background:none;border:1px solid var(--line-2);color:var(--ink-2);
  font:inherit;font-size:13px;padding:5px 11px;border-radius:7px;cursor:pointer}
.top .who button:hover{background:var(--soft)}
.page{width:100%;max-width:980px;margin:0 auto;padding:6px 32px 64px;flex:1}
.page.wide{max-width:1180px}
footer.foot{color:var(--muted);font-size:13px;padding:0 32px 36px}

/* ---- type ----------------------------------------------------------- */
h1{font-size:28px;line-height:1.2;letter-spacing:-.02em;margin:30px 0 6px}
h2{font-size:18px;letter-spacing:-.01em;margin:32px 0 10px}
.sub{color:var(--muted);margin:0 0 22px}
.sub a{color:var(--muted)}
.muted{color:var(--muted);font-size:14px}
.hint{font-size:13px;color:var(--muted);margin:4px 0 0;font-weight:400}
label .hint{display:block}

/* ---- surfaces ------------------------------------------------------- */
table{width:100%;border-collapse:separate;border-spacing:0;background:var(--canvas);
  border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;font-size:15px}
th{text-align:left;padding:11px 14px;border-bottom:1px solid var(--line);font-size:12px;
  letter-spacing:.06em;text-transform:uppercase;color:var(--muted);background:var(--wash)}
td{padding:12px 14px;border-bottom:1px solid var(--line)}
tr:last-child td{border-bottom:0}
tr:hover td{background:#FBFBFC}
.draft td{background:#FCFCF8}
.card{background:var(--canvas);border:1px solid var(--line);border-radius:var(--radius);
  padding:18px 20px;margin:0 0 14px}
.card h3{margin:0 0 4px;font-size:16.5px}
.card p{margin:0;color:var(--muted);font-size:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
fieldset{border:1px solid var(--line);background:var(--canvas);border-radius:var(--radius);
  padding:6px 22px 22px;margin:22px 0}
legend{font-size:12px;letter-spacing:.07em;text-transform:uppercase;
  color:var(--muted);font-weight:700;padding:0 8px}
.tag{display:inline-block;font-size:12px;font-weight:600;padding:2px 9px;
  border-radius:999px;background:var(--soft);color:var(--ink-2)}
.tag.ok{background:var(--ok-wash);color:var(--ok)}
.tag.no{background:var(--soft);color:var(--muted)}
.tag.dan{background:var(--ink);color:#fff}
.tag.wait{background:var(--warn-wash);color:var(--warn)}

/* ---- messages ------------------------------------------------------- */
.note,.bad,.good{padding:12px 16px;margin:16px 0;border-radius:var(--radius);
  border:1px solid transparent}
.note{background:var(--warn-wash);border-color:#F1DFAA;color:#4F3600}
.bad{background:var(--bad-wash);border-color:#F3C4BF;color:#6F1A12}
.good{background:var(--ok-wash);border-color:#BCDDC5;color:#14462A}

/* ---- controls ------------------------------------------------------- */
.btn{display:inline-block;background:var(--accent);color:#fff;border:1px solid var(--accent);
  font:inherit;font-weight:600;padding:9px 18px;text-decoration:none;cursor:pointer;
  border-radius:8px}
.btn:hover{background:var(--accent-ink);border-color:var(--accent-ink)}
.btn.quiet{background:var(--canvas);color:var(--ink-2);border-color:var(--line-2)}
.btn.quiet:hover{background:var(--soft)}
td .btn{padding:5px 12px;font-size:14px}
td form{display:inline}
input,select,textarea{font:inherit;padding:9px 12px;border:1px solid var(--line-2);
  background:var(--canvas);width:100%;max-width:360px;border-radius:8px;color:var(--ink)}
input:focus,select:focus,textarea:focus{border-color:var(--accent)}
textarea{max-width:600px;min-height:92px}
label{display:block;font-size:14px;font-weight:600;margin:16px 0 5px}
.check{display:flex;align-items:flex-start;gap:9px;margin:12px 0;font-size:15px}
.check input{width:auto;margin-top:5px}
.row{display:flex;flex-wrap:wrap;gap:18px}
.row > div{flex:1 1 200px}
.row input,.row select{max-width:none}
.actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:26px 0 0}
.actions form{display:inline}
.right{margin-left:auto}
ul.plain{list-style:none;padding:0;margin:0}
ul.plain li{padding:9px 0;border-bottom:1px solid var(--line)}

/* ---- writing -------------------------------------------------------- */
textarea.writing{width:100%;max-width:none;min-height:340px;
  font:15px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace}
.editor-toolbar button.mde-text{width:auto;padding:0 9px;font-size:13px;font-weight:600}
.hint-block{margin:10px 0 18px}
.hint-block summary{cursor:pointer;color:var(--muted);font-size:14px}
table.writing-help{margin-top:8px;border:0;background:none}
table.writing-help td{padding:3px 12px 3px 0;font-size:14px;border:0}
table.writing-help code{background:var(--soft);padding:2px 6px;border-radius:4px}

/* ---- a club's times: one row per class ------------------------------- */
.times-edit{display:grid;gap:8px;margin:6px 0 0}
.times-edit .t{display:grid;grid-template-columns:minmax(0,2fr) 130px 100px 100px 70px 70px;
  gap:8px;align-items:center}
.times-edit .t input,.times-edit .t select{max-width:none}
.times-edit .head{font-size:11.5px;font-weight:700;letter-spacing:.06em;
  text-transform:uppercase;color:var(--muted)}

@media(max-width:860px){
  .shell{grid-template-columns:minmax(0,1fr);grid-template-areas:"rail" "stage"}
  .rail{width:auto;position:static;height:auto;border-right:0;border-bottom:1px solid var(--line);
    padding:14px 16px}
  .rail .brand{padding-bottom:10px}
  .rail .here{margin-bottom:8px}
  .rail h6{display:none}
  .rail nav{display:flex;flex-wrap:wrap;gap:2px 4px}
  .rail .all{margin-top:6px;padding-top:6px}
  .top{padding:10px 16px;flex-wrap:wrap}
  .top .find{margin-left:0;flex:1 1 100%;order:3}
  .top .find input{min-width:0;flex:1}
  .page{padding:4px 16px 48px}
  footer.foot{padding:0 16px 28px}
  .times-edit .t{grid-template-columns:1fr 1fr;}
  .times-edit .head{display:none}
}
@media(max-width:600px){
  table{font-size:14px} td,th{padding:9px 10px}
  .hide-sm{display:none}
}`;

/**
 * The frame every screen sits in.
 *
 * The side rail is not built here. It depends on who is asking and what they
 * may do at the organisation they are looking at, which the views do not
 * know, so the server fills in the marker below on the way out (see
 * ctx.send). A screen with no organisation behind it — the dashboard, the
 * sign-in page — simply has no rail.
 */
const RAIL_MARKER = '<!--honbu:rail-->';

function page({ title, me, body, csrf, query = '', wide = false }) {
  const search = me ? `<form method="get" action="/search" class="find" role="search">
    <label class="hide-sm" for="q">Find</label>
    <input id="q" name="q" type="search" placeholder="a name, a number, anything"
      value="${esc(query ?? '')}">
    <button class="btn quiet">Find</button>
  </form>` : '';
  const who = me ? `<span class="who">${esc(me.name)}
    <form method="post" action="/signout">
      <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
      <button>Sign out</button></form></span>` : '';

  return `<!DOCTYPE html><html lang="en-NZ"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — Honbu</title><style>${CSS}</style></head><body>
<a class="skip" href="#main">Skip to the content</a>
<div class="shell">
  ${me ? RAIL_MARKER : ''}
  <div class="stage">
    <header class="top">
      <a class="brand" href="${me ? '/dashboard' : '/signin'}">Honbu</a>
      ${search}${who}
    </header>
    <main id="main" class="page${wide ? ' wide' : ''}">${body}</main>
    <footer class="foot">Honbu — federation register</footer>
  </div>
</div>
</body></html>`;
}

/**
 * The side rail for one organisation.
 *
 * Only what this person may actually do is listed. A link that ends in
 * "You do not have permission" is a screen the person was invited to walk
 * into and refused at the door.
 */
export function rail({ org, vocabulary = {}, can = {}, path = '' }) {
  const club = vocabulary.club ?? 'Club';
  const isClub = org.type === 'club';
  const base = `/o/${org.slug}`;

  const link = (href, label) => `<a href="${esc(href)}"${
    path === href || path.startsWith(href + '/') ? ' aria-current="page"' : ''}>${esc(label)}</a>`;

  const group = (name, items) => {
    const shown = items.filter(Boolean);
    return shown.length ? `<h6>${esc(name)}</h6><nav aria-label="${esc(name)}">${
      shown.join('')}</nav>` : '';
  };

  return `<aside class="rail">
  <a class="brand" href="/dashboard">Honbu</a>
  <div class="here"><strong>${esc(org.name)}</strong>
    <span>${isClub ? esc(club) : 'Federation'}</span></div>
  ${group('People', [
    link(`${base}/roster`, 'Roll'),
    can.register && link(`${base}/members/new`, 'Add a member'),
    can.register && link(`${base}/members/import`, 'Import a roll'),
    can.register && link(`${base}/grading`, vocabulary.grading ?? 'Grading'),
  ])}
  ${group('Events', [link(`${base}/events`, 'Events')])}
  ${can.write ? group('Website', [
    link(`${base}/pages`, 'Pages'),
    link(`${base}/news`, 'News'),
    link(`${base}/media`, 'Images'),
    link(`${base}/menu`, 'Menu'),
    !isClub && can.manage && link(`${base}/appearance`, 'Appearance'),
    link(`${base}/instructors`, 'Instructors'),
    isClub ? link(`${base}/club-page`, `${club} page`)
           : link(`${base}/club-pages`, `${club} pages`),
  ]) : ''}
  ${can.manage ? group('Organisation', [link(`${base}/history`, 'History')]) : ''}
  <div class="all"><nav aria-label="All organisations">
    ${link('/dashboard', 'Everything I look after')}</nav></div>
</aside>`;
}

export { RAIL_MARKER };

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

/**
 * The one screen that can show several federations at once, so the one screen
 * where a single vocabulary is wrong. Each group carries its own words.
 */
export const dashboard = ({ me, csrf, orgs, parents = [], groups = [] }) => {
  const total = groups.reduce((n, g) =>
    n + g.clubs.reduce((m, o) => m + Number(o.members), 0), 0);

  // Which words to fall back on when a federation defines none of its own.
  //
  // On a single-federation install — the ordinary case — data/settings.json is
  // that federation's own settings, hand-edited in GitHub, and falling back to
  // it is right. As soon as two federations share a screen it stops being
  // anybody's in particular: it is the deployment's, and it belongs to
  // whichever federation was installed first. Falling back to it there would
  // hand MOKNZ's words to a jiu-jitsu academy, which is the bug this function
  // exists to fix, one level further down. So with several federations on the
  // page, a federation that has said nothing gets the neutral words.
  const base = groups.length > 1 ? NEUTRAL : VOCABULARY;

  // With one federation the heading is just its word for a club, as it always
  // was. With several, each needs saying whose clubs these are — otherwise
  // there are two headings on the page and no way to tell them apart.
  const heading = (group) => {
    const V = { ...base, ...(group.vocabulary ?? {}) };
    return groups.length > 1 && group.federation
      ? `${esc(group.federation.name)} — ${esc(V.clubPlural.toLowerCase())}`
      : esc(V.clubPlural);
  };

  return page({ title: 'Dashboard', me, csrf, body: `
  <h1>${esc(me.name)}</h1>
  <p class="sub">${orgs.length} organisation${orgs.length === 1 ? '' : 's'},
    ${total} active member${total === 1 ? '' : 's'}</p>

  ${parents.map((o) => `<div class="card">
    <h3>${esc(o.name)}</h3>
    <p>${esc(o.type)} · <a href="/o/${esc(o.slug)}/roster">Members</a>
       · <a href="/o/${esc(o.slug)}/events">Events</a>
       · <a href="/o/${esc(o.slug)}/grading">Grading</a>
       · <a href="/o/${esc(o.slug)}/pages">Website</a></p>
  </div>`).join('')}

  ${groups.map((group) => `
  <h2>${heading(group)}</h2>
  <div class="grid">${group.clubs.map((o) => `<div class="card">
    <h3><a href="/o/${esc(o.slug)}/roster">${esc(o.name)}</a></h3>
    <p>${o.members} member${Number(o.members) === 1 ? '' : 's'}</p>
  </div>`).join('')}</div>`).join('')}` });
};

export const roster = ({ me, csrf, org, roster, canRegister = false,
                        done }) => page({
  title: `${org.name} roster`, me, csrf, body: `
  <h1>${esc(org.name)}</h1>
  <p class="sub">${roster.length} on the roll ·
    <a href="/o/${esc(org.slug)}/grading">Run a grading</a> ·
    <a href="/o/${esc(org.slug)}/history">History</a> ·
    <a href="/o/${esc(org.slug)}/events">Events</a> ·
    <a href="/o/${esc(org.slug)}/pages">Website</a></p>

  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${canRegister ? `<p class="actions" style="margin:0 0 20px">
    <a class="btn" href="/o/${esc(org.slug)}/members/new">Add someone</a>
    <a class="btn quiet" href="/o/${esc(org.slug)}/members/import">Import a spreadsheet</a>
  </p>` : ''}
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

export const person = ({ me, csrf, person, history, affiliations, eligibility,
                        titles = [], changes = [],
                        canEdit = false, access = null, link = null,
                        linkExpires = 15, error = null }) => page({
  title: `${person.first_name} ${person.last_name}`, me, csrf, body: `
  <h1>${esc(person.first_name)} ${esc(person.last_name)}</h1>
  <p class="sub">${esc(person.display_number ?? 'no member number')}
    ${person.age ? ` · ${person.age} years old` : ''}
    ${canEdit ? ` · <a href="/p/${esc(person.id)}/edit">Correct this record</a>` : ''}</p>

  ${titles.length ? `<p class="sub">${titles.map((t) => `<span class="tag dan">${
    esc(t.label)}</span>`).join(' ')}
    ${titles[0].address_as && titles[0].address_as !== titles[0].label
      ? `<span class="muted">addressed as ${esc(titles[0].address_as)}</span>`
      : ''}</p>` : ''}

  ${!eligibility?.next && history.length
    ? `<div class="note"><strong>Top of the ladder.</strong>
       No higher grade is defined in this federation's syllabus.</div>` : ''}
  ${eligibility?.next ? (eligibility.eligible
    ? `<div class="good"><strong>Eligible for ${esc(eligibility.next)}.</strong>
       ${eligibility.months.has} months at grade, ${eligibility.sessions.has} sessions since.</div>`
    : `<div class="note"><strong>Not yet eligible for ${esc(eligibility.next)}.</strong>
       Needs ${eligibility.unmet.map(esc).join(', ')}.</div>`) : ''}

  ${changes.length ? `<h2>Changes to this record</h2>
  <p class="muted">Who changed what, and when. Cannot be edited or deleted.</p>
  <table>
    <thead><tr><th class="hide-sm">When</th><th>Who</th><th>What</th></tr></thead>
    <tbody>${changes.map((c) => `<tr>
      <td class="hide-sm muted">${esc(new Date(c.at).toISOString()
        .slice(0, 16).replace('T', ' '))}</td>
      <td>${esc(c.actorName)}</td>
      <td>${esc(auditDescribe(c))}</td>
    </tr>`).join('')}</tbody>
  </table>` : ''}

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

  ${link ? `<div class="good">
    <strong>Their way in — copy it now.</strong>
    <p style="margin:8px 0">This is shown once. It works for
      ${linkExpires} minutes and can only be used a single time.
      Send it to them however you like, or let them open it here.</p>
    <input readonly value="${esc(link)}" onclick="this.select()"
      style="max-width:100%;font-family:ui-monospace,monospace;font-size:13px">
    <p class="muted" style="margin:8px 0 0">Lost it? Make another — there is
      no limit, and the old one stops working as soon as it is used.</p>
  </div>` : ''}

  ${error ? `<div class="bad">${esc(error)}</div>` : ''}

  ${canEdit ? `
  <h2>Signing in</h2>
  ${access
    ? `<p>They have an account as <strong>${esc(access.account.email)}</strong>${
        access.roles.length
          ? `, with ${access.roles.map((r) =>
              `${esc(r.role)} at ${esc(r.name)}`).join(' and ')}`
          : ', with no role anywhere yet'}.</p>`
    : '<p class="muted">They have no account, so they cannot sign in.</p>'}

  <form method="post" action="/p/${esc(person.id)}/access">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <div class="row">
      <div>
        <label for="access_email">Their email
          <span class="hint">How the account is identified, even when you
            hand the link over rather than send it.</span></label>
        <input id="access_email" name="email" type="email" maxlength="200"
          value="${esc(access?.account?.email ?? person.email ?? '')}">
      </div>
      <div>
        <label for="access_role">What they may do</label>
        <select id="access_role" name="role">
          ${[['member', 'Member — see their own record'],
             ['instructor', 'Instructor — see the roll'],
             ['registrar', 'Registrar — add and correct members, run gradings'],
             ['administrator', 'Administrator — everything, including the website'],
             ['owner', 'Owner — everything, including other administrators']]
            .map(([v, l]) => option(v, l, 'member')).join('')}
        </select>
      </div>
    </div>
    <div class="actions">
      <button class="btn" type="submit">
        ${access ? 'Make them a new sign-in link' : 'Give them access'}</button>
    </div>
    <p class="hint">Nothing is emailed. You get a link to pass on — useful
      before a federation's own email is set up, and afterwards for anybody
      whose address bounces or who is standing in front of you.</p>
  </form>` : ''}

  <h2>Affiliation</h2>
  <ul class="plain">${affiliations.map((a) => `<li>
    <strong>${esc(a.organisation)}</strong> — ${esc(a.role)},
    from ${String(new Date(a.starts).toISOString().slice(0,10))}
    ${a.ends ? `to ${String(new Date(a.ends).toISOString().slice(0,10))}`
             : '<span class="tag ok">current</span>'}
  </li>`).join('')}</ul>` });

/**
 * Adding somebody to the roll, and correcting what the register says later.
 *
 * One form for both, for the same reason the event form is one form: two would
 * drift, and a field you can set on enrolment but never correct afterwards is
 * how a register goes stale. The emergency contact was exactly that until now.
 *
 * `values` is whatever was last submitted when something was refused, so a
 * mistake in one field does not throw away the other twelve.
 */
export const memberForm = ({ me, csrf, org, values = {}, error, isNew = true,
                             person = null, vocabulary = {} }) => {
  const V = { ...VOCABULARY, ...vocabulary };
  const v = (k, fallback = '') => values[k] ?? fallback;
  const action = isNew ? `/o/${org.slug}/members/new` : `/p/${person.id}/edit`;

  return page({
    title: isNew ? `Add to ${org.name}` : `Edit ${person.first_name} ${person.last_name}`,
    me, csrf, body: `
  <h1>${isNew ? `Add someone to ${esc(org.name)}`
              : `${esc(person.first_name)} ${esc(person.last_name)}`}</h1>
  <p class="sub">${isNew
    ? `<a href="/o/${esc(org.slug)}/roster">Back to the roll</a>
       · <a href="/o/${esc(org.slug)}/members/import">Import a spreadsheet instead</a>`
    : `${esc(person.display_number ?? '')} ·
       <a href="/p/${esc(person.id)}">Back to their record</a>`}</p>

  ${error ? `<div class="bad">${esc(error)}</div>` : ''}

  <form method="post" action="${esc(action)}">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">

    <fieldset>
      <legend>Who they are</legend>
      <div class="row">
        <div>
          <label for="firstName">First name</label>
          <input id="firstName" name="firstName" required maxlength="100"
            value="${esc(v('firstName'))}">
        </div>
        <div>
          <label for="lastName">Last name</label>
          <input id="lastName" name="lastName" required maxlength="100"
            value="${esc(v('lastName'))}">
        </div>
      </div>
      <div class="row">
        <div>
          <label for="preferredName">Goes by
            <span class="hint">If it is not their first name.</span></label>
          <input id="preferredName" name="preferredName" maxlength="100"
            value="${esc(v('preferredName'))}">
        </div>
        <div>
          <label for="dateOfBirth">Date of birth
            <span class="hint">Decides age divisions. Age is never stored.</span></label>
          <input id="dateOfBirth" name="dateOfBirth" type="date" max="9999-12-31"
            value="${esc(v('dateOfBirth'))}">
        </div>
      </div>
      <label for="gender">Gender
        <span class="hint">Free text. Used for divisions where a federation has them.</span></label>
      <input id="gender" name="gender" maxlength="50" value="${esc(v('gender'))}">
    </fieldset>

    <fieldset>
      <legend>How to reach them</legend>
      <div class="row">
        <div>
          <label for="email">Email
            <span class="hint">This is how they sign in. No password is ever set.</span></label>
          <input id="email" name="email" type="email" maxlength="200"
            value="${esc(v('email'))}">
        </div>
        <div>
          <label for="phone">Phone</label>
          <input id="phone" name="phone" maxlength="40" value="${esc(v('phone'))}">
        </div>
      </div>
      <div class="row">
        <div>
          <label for="emergencyName">Emergency contact</label>
          <input id="emergencyName" name="emergencyName" maxlength="100"
            value="${esc(v('emergencyName'))}">
        </div>
        <div>
          <label for="emergencyPhone">Emergency phone</label>
          <input id="emergencyPhone" name="emergencyPhone" maxlength="40"
            value="${esc(v('emergencyPhone'))}">
        </div>
      </div>
    </fieldset>

    <fieldset>
      <legend>Their membership</legend>
      ${isNew ? `
      <div class="row">
        <div>
          <label for="role">Role</label>
          <select id="role" name="role">
            ${ROLE_LABELS.map(([k, label]) =>
              option(k, label, v('role', 'member'))).join('')}
          </select>
        </div>
        <div>
          <label for="starts">Joined
            <span class="hint">Blank means today.</span></label>
          <input id="starts" name="starts" type="date" value="${esc(v('starts'))}">
        </div>
      </div>` : `
      <label for="status">Standing</label>
      <select id="status" name="status" style="max-width:300px">
        ${STATUS_LABELS.map(([k, label]) =>
          option(k, label, v('status', 'active'))).join('')}
      </select>`}

      <label for="paidUntil">Paid until
        <span class="hint">What the ${esc(V.club.toLowerCase())} card expires on.</span></label>
      <input id="paidUntil" name="paidUntil" type="date" value="${esc(v('paidUntil'))}"
        style="max-width:220px">
    </fieldset>

    ${isNew ? '' : `<div class="note">Grade is not on this form and never will be.
      A grade changes by being awarded, through the grading rules — not by
      somebody editing a field.</div>`}

    <div class="actions">
      <button class="btn" type="submit">${isNew ? 'Add them to the roll'
                                                : 'Save changes'}</button>
      <a class="btn quiet" href="${isNew ? `/o/${esc(org.slug)}/roster`
                                         : `/p/${esc(person.id)}`}">Cancel</a>
    </div>
  </form>` });
};

/**
 * Bringing an existing roll in.
 *
 * Pasting, not a file upload. Selecting the cells in Excel, Numbers or Google
 * Sheets and pressing copy puts tab-separated text on the clipboard, which has
 * no quoting to get wrong, no encoding to guess and no commas hiding inside
 * addresses — and it works from a phone. Handling a multipart upload would
 * mean either a dependency or eighty lines of parser, for a worse result. A
 * saved .csv pasted in works just as well.
 */
export const importRoll = ({ me, csrf, org, text = '', preview = null, error,
                             vocabulary = {} }) => {
  const V = { ...VOCABULARY, ...vocabulary };
  return page({
    title: `Import — ${org.name}`, me, csrf, body: `
  <h1>Bring in an existing roll</h1>
  <p class="sub">${esc(org.name)} ·
    <a href="/o/${esc(org.slug)}/roster">Back to the roll</a></p>

  ${error ? `<div class="bad">${esc(error)}</div>` : ''}

  ${preview ? previewOf(preview, org, csrf, text) : `
  <div class="note">
    <strong>Open your spreadsheet, select the rows including the heading row,
    copy, and paste below.</strong>
    Nothing is saved until you have seen exactly what will happen to each row.
  </div>

  <p class="muted">The headings can say whatever your spreadsheet says —
    <em>Surname</em>, <em>DOB</em>, <em>Mobile</em>, <em>Expiry</em> and most
    other names are understood. A first and last name are the only columns
    that must be there. Dates written <em>03/04/2015</em> are refused rather
    than guessed at, because that is the 3rd of April here and the 4th of
    March in America.</p>`}

  <form method="post" action="/o/${esc(org.slug)}/members/import">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <label for="text">${preview ? 'Change the rows and check again'
                                : 'Paste here'}</label>
    <textarea id="text" name="text" style="min-height:${preview ? 140 : 220}px"
      placeholder="First Name&#9;Last Name&#9;DOB&#9;Email&#9;Grade">${esc(text)}</textarea>
    <div class="actions">
      <button class="btn${preview ? ' quiet' : ''}" type="submit">
        ${preview ? 'Check again' : 'Check what would happen'}</button>
      ${preview ? '' : `<a class="btn quiet"
        href="/o/${esc(org.slug)}/members/new">Add one person instead</a>`}
    </div>
  </form>` });
};

const ACTION_TAGS = {
  add: ['ok', 'will be added'],
  duplicate: ['no', 'already on the roll'],
  refuse: ['no', 'not imported'],
};

function previewOf(p, org, csrf, text) {
  const { counts, plan, unmapped, missing, found } = p;
  const nothing = counts.add === 0;

  return `
  ${missing.length ? `<div class="bad">
    <strong>This is missing a column it needs.</strong>
    There is no ${missing.map((m) => m === 'firstName' ? 'first name' : 'last name')
      .join(' or ')} column, so there is nobody to add. Check that the first
    row you pasted is the heading row.</div>` : ''}

  <div class="${nothing ? 'note' : 'good'}">
    <strong>${counts.add} to add${counts.duplicate
      ? `, ${counts.duplicate} already on the roll` : ''}${counts.refuse
      ? `, ${counts.refuse} that cannot go in` : ''}.</strong>
    ${nothing ? 'Nothing has been saved, and nothing would be.'
              : 'Nothing has been saved yet.'}
  </div>

  ${found.length ? `<p class="muted">Columns understood:
    ${found.map((f) => `<strong>${esc(FIELD_LABELS[f] ?? f)}</strong>`).join(', ')}.
    ${unmapped.length ? `Ignored: ${unmapped.map(esc).join(', ')}.` : ''}</p>` : ''}

  <table>
    <thead><tr><th>Row</th><th>Name</th><th class="hide-sm">Born</th>
      <th>What happens</th></tr></thead>
    <tbody>${plan.map((r) => {
      const [cls, label] = ACTION_TAGS[r.action];
      return `<tr${r.action === 'refuse' ? ' class="draft"' : ''}>
      <td class="muted">${r.line}</td>
      <td><strong>${esc([r.values.firstName, r.values.lastName]
        .filter(Boolean).join(' ') || '—')}</strong>
        ${r.values.email ? `<div class="muted">${esc(r.values.email)}</div>` : ''}</td>
      <td class="hide-sm">${esc(r.values.dateOfBirth ?? '')}</td>
      <td><span class="tag ${cls}">${label}</span>
        ${r.problems.length ? `<div class="muted">${
          r.problems.map(esc).join('; ')}</div>` : ''}
        ${r.notes.length ? `<div class="muted">${
          r.notes.map(esc).join('; ')}</div>` : ''}
      </td></tr>`;
    }).join('')}</tbody>
  </table>

  ${counts.add ? `
  <form method="post" action="/o/${esc(org.slug)}/members/import">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <input type="hidden" name="text" value="${esc(text)}">
    <input type="hidden" name="confirm" value="yes">
    <div class="actions">
      <button class="btn" type="submit">Import the ${counts.add}
        ${counts.add === 1 ? 'person' : 'people'} above</button>
      <span class="muted">${counts.refuse
        ? `The ${counts.refuse} marked "not imported" will be left out. `
        : ''}${counts.duplicate
        ? `The ${counts.duplicate} already on the roll will be skipped.` : ''}</span>
    </div>
  </form>` : ''}`;
}

const FIELD_LABELS = {
  firstName: 'first name', lastName: 'last name', fullName: 'name',
  preferredName: 'goes by', dateOfBirth: 'date of birth', gender: 'gender',
  email: 'email', phone: 'phone', role: 'role', grade: 'grade',
  gradedOn: 'graded on', starts: 'joined', paidUntil: 'paid until',
  emergencyName: 'emergency contact', emergencyPhone: 'emergency phone',
};

const ROLE_LABELS = [
  ['member', 'Member'], ['instructor', 'Instructor'],
  ['assistant', 'Assistant instructor'], ['official', 'Official'],
  ['supporter', 'Supporter'],
];

const STATUS_LABELS = [
  ['active', 'Active'], ['pending', 'Pending'], ['lapsed', 'Lapsed'],
  ['suspended', 'Suspended'], ['resigned', 'Resigned'],
];

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
                         canSchedule = true, canAsk = false, waiting = [],
                         done, error, rebuild }) => page({
  title: `Events — ${org.name}`, me, csrf, body: `
  <h1>Events</h1>
  <p class="sub">${esc(org.name)} ·
    <a href="/o/${esc(org.slug)}/roster">Back to roster</a></p>

  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${rebuild ? `<div class="note">${esc(rebuild)}</div>` : ''}

  ${waiting.length ? `<h2>Asking to go on this calendar</h2>
  <p class="muted">Events from the clubs beneath ${esc(org.name)}. Approving one
    puts it on this website under your name; declining leaves it on the club's own.</p>
  <table><tbody>${waiting.map((w) => `<tr>
    <td>${esc(readable(w.starts_at, org.timezone, true))}</td>
    <td><strong>${esc(w.title)}</strong>
      <div class="muted">${esc(w.from_org)} · ${esc(kindLabel(w.kind))}${
        w.venue_name ? ' · ' + esc(w.venue_name) : ''}</div></td>
    <td><form method="post" action="/o/${esc(org.slug)}/event-requests/${esc(w.id)}/decide"
        style="display:inline">
      <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
      <button class="btn" name="answer" value="approve" type="submit">Put it on our calendar</button>
      <button class="btn quiet" name="answer" value="decline" type="submit">Decline</button>
    </form></td></tr>`).join('')}</tbody></table>` : ''}

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
      <td>${statusTag(e.status)}${reachTag(e.publishUpState, canAsk)}</td>
      <td>${canAsk && e.status === 'published' && e.visibility !== 'own_org'
          && ['none', 'declined'].includes(e.publishUpState ?? 'none')
        ? `<form method="post" style="display:inline"
            action="/o/${esc(org.slug)}/events/${esc(String(e.slug))}/ask">
            <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
            <button class="btn quiet" type="submit">Ask the federation to list it</button></form>`
        : ''}
        ${canSchedule ? `<a class="btn quiet"
        href="/o/${esc(org.slug)}/events/${esc(String(e.slug))}/edit">Edit</a>` : ''}
        ${ENTERABLE.has(e.kind) ? `<a class="btn quiet"
          href="/o/${esc(org.slug)}/events/${esc(String(e.slug))}/entries">Entries</a>`
        : ''}</td>
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

/**
 * The kinds people enter rather than just turn up to.
 *
 * A guess about which events want an entry list, so the link is offered where
 * it is wanted and not on a social. Only a link — any event can have entries
 * if somebody navigates to them.
 */
const ENTERABLE = new Set(['tournament', 'grading', 'fight_night', 'seminar', 'camp']);

const KIND_LABELS = {
  grading: 'Grading', tournament: 'Tournament', camp: 'Camp',
  seminar: 'Seminar', fight_night: 'Fight night', training: 'Training',
  social: 'Social', other: 'Other',
};
const kindLabel = (k) => KIND_LABELS[k] ?? k;

const reachTag = (state, show) => !show ? '' : ({
  requested: ' <span class="tag">Waiting for the federation</span>',
  approved: ' <span class="tag ok">On the federation\'s calendar</span>',
  declined: ' <span class="tag no">Federation declined</span>',
}[state] ?? '');

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
      <legend>Entries and the declaration</legend>
      <p class="hint">Only needed for an event people enter — a tournament or
        a grading. Leave blank otherwise.</p>
      <div class="row">
        <div>
          <label for="guardianUnder">A parent or guardian signs for anyone under
            <span class="hint">16 at the Kokoro Cup. 18 at plenty of others.
              Blank asks for nobody's guardian.</span></label>
          <input id="guardianUnder" name="guardianUnder" type="number" min="1"
            max="30" value="${esc(v('guardianUnder'))}" style="max-width:140px">
        </div>
        <div>
          <label for="consentVersion">Declaration version
            <span class="hint">Change it when the wording changes. Entries keep
              the version they agreed to.</span></label>
          <input id="consentVersion" name="consentVersion" maxlength="40"
            value="${esc(v('consentVersion'))}" placeholder="2026.1">
        </div>
      </div>
      <label for="consentText">The declaration itself</label>
      <textarea id="consentText" name="consentText">${esc(v('consentText'))}</textarea>
      ${checkbox('guestsAllowed', 'People who are not on any roll may enter',
        !!v('guestsAllowed'), 'An open championship. Leave off for members only.')}
    </fieldset>

    <fieldset>
      <legend>Where it appears</legend>
      ${checkbox('publishDown', 'Show on the calendars below this organisation',
        !!v('publishDown'), 'Every club under it sees it on their own page.')}
      <p class="muted">To ask for it to appear on the federation's calendar,
        publish it and use "Ask the federation to list it" on the Events list.
        The federation decides.</p>
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

// ---------------------------------------------------------------------------
// competition
// ---------------------------------------------------------------------------

const cents = (c, currency = 'NZD') => c == null ? '—'
  : new Intl.NumberFormat('en-NZ', { style: 'currency', currency }).format(c / 100);

/** A division's bounds, in words rather than a row of nullable numbers. */
function boundsOf(d, gradeLabels = {}) {
  const parts = [];
  const band = (min, max, unit, name) => {
    if (min == null && max == null) return;
    if (min != null && max != null) parts.push(`${name} ${min}–${max}${unit}`);
    else if (min != null) parts.push(`${name} ${min}${unit} and over`);
    else parts.push(`${name} up to ${max}${unit}`);
  };

  if (d.min_rank_order != null || d.max_rank_order != null) {
    const lo = gradeLabels[d.min_rank_order] ?? d.min_rank_order;
    const hi = gradeLabels[d.max_rank_order] ?? d.max_rank_order;
    if (d.min_rank_order != null && d.max_rank_order != null)
      parts.push(`${lo} to ${hi}`);
    else if (d.min_rank_order != null) parts.push(`${lo} and above`);
    else parts.push(`up to ${hi}`);
  }
  band(d.min_age, d.max_age, '', 'age');
  band(d.min_weight_kg, d.max_weight_kg, ' kg', 'weight');
  if (d.gender) parts.push(String(d.gender));
  band(d.min_years_training, d.max_years_training, ' yrs', 'training');
  band(d.min_prior_events, d.max_prior_events, '', 'previous events');

  return parts.length ? parts.join(' · ') : 'open to anybody';
}

/**
 * Setting a tournament up: what it runs, who may be in which division, and
 * what it costs.
 *
 * Everything on this page is the organiser's words. Nothing here — and
 * nothing behind it — knows what a kata is, which is the only reason the same
 * screen sets up a BJJ open or a taekwondo championship.
 */
export const eventSetup = ({ me, csrf, org, event, disciplines = [],
                             byDiscipline = {}, prices = [], grades = [],
                             done, error }) => {
  const gradeLabels = Object.fromEntries(grades.map((g) => [g.rankOrder, g.label]));
  const gradeOptions = (selected) =>
    option('', 'no limit', selected)
    + grades.map((g) => option(String(g.rankOrder), g.label, selected)).join('');

  return page({
    title: `Set up — ${event.title}`, me, csrf, body: `
  <h1>${esc(event.title)}</h1>
  <p class="sub">${esc(org.name)} ·
    <a href="/o/${esc(org.slug)}/events/${esc(event.slug)}/edit">Edit the event</a> ·
    <a href="/o/${esc(org.slug)}/events/${esc(event.slug)}/entries">Entries</a></p>

  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}

  <h2>What this event runs</h2>
  ${disciplines.length ? disciplines.map((d) => `
    <fieldset>
      <legend>${esc(d.name)}</legend>
      ${d.summary ? `<p class="muted">${esc(d.summary)}</p>` : ''}
      ${(byDiscipline[d.id] ?? []).length ? `<table>
        <thead><tr><th>Division</th><th>Who is in it</th></tr></thead>
        <tbody>${byDiscipline[d.id].map((v) => `<tr>
          <td><strong>${esc(v.label)}</strong>
            ${v.summary ? `<div class="muted">${esc(v.summary)}</div>` : ''}</td>
          <td class="muted">${esc(boundsOf(v, gradeLabels))}</td>
        </tr>`).join('')}</tbody></table>`
        : `<div class="note">No divisions yet. Until there is at least one,
             nobody can be placed in ${esc(d.name)}.</div>`}

      <details>
        <summary class="muted" style="cursor:pointer;margin:14px 0 0">
          Add a division to ${esc(d.name)}</summary>
        <form method="post"
          action="/o/${esc(org.slug)}/events/${esc(event.slug)}/setup/division">
          <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
          <input type="hidden" name="disciplineId" value="${esc(d.id)}">
          <div class="row">
            <div><label>Name it</label>
              <input name="label" required maxlength="100"
                placeholder="Development Kata"></div>
            <div><label>Describe it <span class="hint">Shown to competitors.</span></label>
              <input name="summary" maxlength="200"
                placeholder="White/orange/blue belt to 7th kyu"></div>
          </div>
          <p class="hint" style="margin:16px 0 0">Leave a bound blank for no
            limit. A division with no bounds at all is an open.</p>
          <div class="row">
            <div><label>Lowest grade</label>
              <select name="minRankOrder">${gradeOptions('')}</select></div>
            <div><label>Highest grade</label>
              <select name="maxRankOrder">${gradeOptions('')}</select></div>
          </div>
          <div class="row">
            <div><label>Youngest age <span class="hint">On the day.</span></label>
              <input name="minAge" type="number" min="0" max="120"></div>
            <div><label>Oldest age</label>
              <input name="maxAge" type="number" min="0" max="120"></div>
            <div><label>Gender <span class="hint">Blank for any.</span></label>
              <input name="gender" maxlength="30" placeholder="male"></div>
          </div>
          <div class="row">
            <div><label>Lightest (kg)</label>
              <input name="minWeightKg" type="number" step="0.01" min="0"></div>
            <div><label>Heaviest (kg)</label>
              <input name="maxWeightKg" type="number" step="0.01" min="0"></div>
          </div>
          <div class="actions">
            <button class="btn" type="submit">Add this division</button>
          </div>
        </form>
      </details>
    </fieldset>`).join('')
    : '<div class="note">Nothing is set up yet. Add what this event runs below.</div>'}

  <fieldset>
    <legend>Add a discipline</legend>
    <form method="post"
      action="/o/${esc(org.slug)}/events/${esc(event.slug)}/setup/discipline">
      <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
      <div class="row">
        <div><label>Name</label>
          <input name="name" required maxlength="100"
            placeholder="Full-Contact Kumite"></div>
        <div><label>Describe it</label>
          <input name="summary" maxlength="200"></div>
      </div>
      <div class="actions"><button class="btn" type="submit">Add it</button></div>
    </form>
  </fieldset>

  <h2>What it costs</h2>
  <p class="muted">A price for how many disciplines somebody enters, not a
    price each. Set one for each number: one event $60, any two $70, all
    three $80.</p>
  ${prices.length ? `<table>
    <thead><tr><th>Disciplines entered</th><th>Price</th><th>Who</th></tr></thead>
    <tbody>${prices.map((p) => `<tr>
      <td>${p.for_count}</td>
      <td><strong>${esc(cents(p.amount_cents, p.currency))}</strong></td>
      <td class="muted">${p.members_only ? 'members only' : 'anybody'}</td>
    </tr>`).join('')}</tbody></table>`
    : '<div class="note">No prices set. Nobody can be charged until there are.</div>'}

  <form method="post" action="/o/${esc(org.slug)}/events/${esc(event.slug)}/setup/price">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <div class="row">
      <div><label>For entering this many</label>
        <input name="forCount" type="number" min="1" max="20" required value="1"></div>
      <div><label>Price <span class="hint">In dollars.</span></label>
        <input name="amount" type="number" step="0.01" min="0" required></div>
    </div>
    ${checkbox('membersOnly', 'Members only', false,
      'A separate price for people affiliated to this federation.')}
    <div class="actions"><button class="btn" type="submit">Set this price</button></div>
  </form>

  <h2>The declaration</h2>
  <p class="muted">What every competitor agrees to, recorded against their
    entry with who agreed and when. Set on
    <a href="/o/${esc(org.slug)}/events/${esc(event.slug)}/edit">the event
    itself</a>, along with the age below which a parent or guardian must sign.</p>
  <ul class="plain">
    <li>Declaration version:
      <strong>${esc(event.consent_version ?? 'not set')}</strong></li>
    <li>Guardian signs for anyone under:
      <strong>${event.guardian_under ?? 'not set'}</strong></li>
  </ul>` });
};

/**
 * Entering your own club's people.
 *
 * Their names, dates of birth and grades are already in the register, so this
 * does not ask for them again — only for what changes between tournaments and
 * what this event needs: weight, height, which disciplines. That is the whole
 * point of having a register.
 */
export const enterCompetitors = ({ me, csrf, org, host, event, disciplines = [],
                                   roster = [], eventDate, consent = {},
                                   error, values = {} }) => page({
  title: `Enter — ${event.title}`, me, csrf, body: `
  <h1>Enter ${esc(org.name)}</h1>
  <p class="sub">${esc(event.title)} · ${esc(host.name)} ·
    <a href="/o/${esc(org.slug)}/events">Back</a></p>

  ${error ? `<div class="bad">${esc(error)}</div>` : ''}

  ${!disciplines.length ? `<div class="note">
    This event has no disciplines set up yet, so there is nothing to enter.
  </div>` : !roster.length ? `<div class="note">
    Nobody is on ${esc(org.name)}'s roll yet.
    <a href="/o/${esc(org.slug)}/members/import">Bring your roll in</a> first.
  </div>` : `

  <div class="note">Tick who is competing and what they are entering. Their
    age and grade come from the register — you only need the things that
    change: weight and height on the day.</div>

  <form method="post" action="${esc(`/o/${org.slug}/events/${event.slug}/enter`)}">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">

    <table>
      <thead><tr>
        <th>Competitor</th>
        <th class="hide-sm">Age on the day</th>
        <th class="hide-sm">Grade</th>
        <th>Weight (kg)</th>
        <th>Height (cm)</th>
        ${disciplines.map((d) => `<th>${esc(d.name)}</th>`).join('')}
      </tr></thead>
      <tbody>${roster.map((p) => `<tr>
        <td><strong>${esc(p.first_name)} ${esc(p.last_name)}</strong>
          <div class="muted">${esc(p.display_number ?? '')}</div></td>
        <td class="hide-sm">${p.ageOnDay ?? '<span class="tag no">no date of birth</span>'}</td>
        <td class="hide-sm">${p.grade ? esc(p.grade)
          : '<span class="tag no">ungraded</span>'}</td>
        <td><input name="weight_${esc(p.id)}" type="number" step="0.01" min="0"
          max="400" style="max-width:110px" value="${esc(values[`weight_${p.id}`] ?? '')}"></td>
        <td><input name="height_${esc(p.id)}" type="number" min="0" max="280"
          style="max-width:110px" value="${esc(values[`height_${p.id}`] ?? '')}"></td>
        ${disciplines.map((d) => `<td style="text-align:center">
          <input type="checkbox" name="enter_${esc(p.id)}_${esc(d.id)}" value="1"
            style="width:auto"${values[`enter_${p.id}_${d.id}`] ? ' checked' : ''}>
        </td>`).join('')}
      </tr>`).join('')}</tbody>
    </table>

    <fieldset>
      <legend>The declaration</legend>
      ${consent.version ? `
        <p class="muted">Version ${esc(consent.version)}.
          ${consent.guardianUnder
            ? `A parent or guardian must sign for anyone under
               ${consent.guardianUnder} on the day — this form records you as
               having their authority to enter them.`
            : 'This event has not set an age below which a guardian must sign.'}</p>
        ${consent.text ? `<div class="note" style="max-height:220px;overflow:auto">
          ${esc(consent.text)}</div>` : ''}
        ${checkbox('accepted',
          'I confirm every competitor above, or their parent or guardian, has '
          + 'agreed to this declaration', !!values.accepted)}
        <label for="acceptedName">Your name</label>
        <input id="acceptedName" name="acceptedName" required maxlength="100"
          value="${esc(values.acceptedName ?? me.name ?? '')}" style="max-width:340px">`
      : `<div class="note">This event has no declaration set, so none will be
          recorded against these entries.</div>`}
    </fieldset>

    <div class="actions">
      <button class="btn" type="submit">See what this would enter</button>
    </div>
  </form>`}` });

/**
 * What the rules worked out, before anything is written.
 *
 * Nobody is entered until this has been looked at. The unplaced are listed
 * first and in full: "If no match available, your instructor will be advised"
 * is on the real form, and a screen that buried them would be worse than the
 * paper it replaces.
 */
export const entryPreview = ({ me, csrf, org, event, rows = [], text,
                               total = null, currency = 'NZD', error }) => {
  const ready = rows.filter((r) => r.ready);
  const stuck = rows.filter((r) => !r.ready);

  return page({
    title: `Check — ${event.title}`, me, csrf, body: `
  <h1>Before anybody is entered</h1>
  <p class="sub">${esc(event.title)} · ${esc(org.name)}</p>

  ${error ? `<div class="bad">${esc(error)}</div>` : ''}

  <div class="${ready.length ? 'good' : 'note'}">
    <strong>${ready.length} ready to enter${stuck.length
      ? `, ${stuck.length} needing attention` : ''}.</strong>
    Nothing has been saved yet.
    ${total != null ? ` Total ${esc(cents(total, currency))}.` : ''}
  </div>

  ${stuck.length ? `<h2>These cannot go in yet</h2>
  <table>
    <thead><tr><th>Competitor</th><th>What is wrong</th></tr></thead>
    <tbody>${stuck.map((r) => `<tr class="draft">
      <td><strong>${esc(r.name)}</strong></td>
      <td>${r.placements.map((p) => p.outcome === 'placed' ? ''
        : `<div><strong>${esc(p.discipline.name)}</strong> —
           <span class="muted">${esc(p.reasons.join('; '))}</span></div>`)
        .join('')}</td>
    </tr>`).join('')}</tbody>
  </table>
  <p class="muted">Fix these by recording the missing detail — a weight, a
    date of birth, a grade — or by entering them and moving them yourself once
    the entry list is up.</p>` : ''}

  ${ready.length ? `<h2>These are ready</h2>
  <table>
    <thead><tr><th>Competitor</th><th>Entering</th>
      <th class="hide-sm">Fee</th></tr></thead>
    <tbody>${ready.map((r) => `<tr>
      <td><strong>${esc(r.name)}</strong>
        <div class="muted">${r.weightKg ? `${r.weightKg} kg` : ''}</div></td>
      <td>${r.placements.map((p) => `<div>${esc(p.discipline.name)} —
        <span class="tag ok">${esc(p.division.label)}</span></div>`).join('')}</td>
      <td class="hide-sm">${esc(cents(r.amountCents, currency))}</td>
    </tr>`).join('')}</tbody>
  </table>

  <form method="post" action="/o/${esc(org.slug)}/events/${esc(event.slug)}/enter">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    ${Object.entries(text).map(([k, v]) =>
      `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('')}
    <input type="hidden" name="confirm" value="yes">
    <div class="actions">
      <button class="btn" type="submit">Enter these ${ready.length}</button>
      <a class="btn quiet"
        href="/o/${esc(org.slug)}/events/${esc(event.slug)}/enter">Go back</a>
    </div>
  </form>` : ''}` });
};

/** Who is entered, by division, with the unplaced impossible to miss. */
export const entryList = ({ me, csrf, org, event, entries = [],
                            divisions = [], canAssign = false, done, error }) => {
  const unplaced = entries.flatMap((e) =>
    e.selections.filter((s) => !s.division_id).map((s) => ({ entry: e, s })));

  const byDivision = {};
  for (const e of entries) {
    for (const s of e.selections) {
      if (!s.division_id) continue;
      (byDivision[s.division_id] ??= { label: s.division, discipline: s.discipline,
        people: [] }).people.push({ e, s });
    }
  }

  return page({
    title: `Entries — ${event.title}`, me, csrf, body: `
  <h1>Entries</h1>
  <p class="sub">${esc(event.title)} · ${esc(org.name)} ·
    <a href="/o/${esc(org.slug)}/events/${esc(event.slug)}/setup">Divisions and fees</a></p>

  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}

  <div class="note"><strong>${entries.length} entered</strong>
    across ${Object.keys(byDivision).length}
    division${Object.keys(byDivision).length === 1 ? '' : 's'}${unplaced.length
      ? `, with ${unplaced.length} still to place` : ''}.</div>

  ${unplaced.length ? `
  <h2>Nobody has a division for these yet</h2>
  <p class="muted">The form says an instructor will be advised where there is
    no match. These are those.</p>
  <table>
    <thead><tr><th>Competitor</th><th>Discipline</th>
      <th class="hide-sm">Club</th><th>Put them in</th></tr></thead>
    <tbody>${unplaced.map(({ entry, s }) => `<tr class="draft">
      <td><strong>${esc(entry.first_name ?? '')} ${esc(entry.last_name ?? '')}</strong>
        <div class="muted">${entry.date_of_birth ? `born ${esc(entry.date_of_birth)}` : ''}
          ${entry.weight_kg ? ` · ${entry.weight_kg} kg` : ''}
          ${entry.grade ? ` · ${esc(entry.grade)}` : ''}</div></td>
      <td>${esc(s.discipline)}</td>
      <td class="hide-sm">${esc(entry.entered_for ?? entry.club_name ?? '')}</td>
      <td>${canAssign ? `<form method="post"
        action="/o/${esc(org.slug)}/events/${esc(event.slug)}/entries/assign">
        <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
        <input type="hidden" name="selectionId" value="${esc(s.id)}">
        <select name="divisionId" style="max-width:220px">
          <option value="">leave unplaced</option>
          ${divisions.filter((d) => d.discipline_id === s.discipline_id)
            .map((d) => `<option value="${esc(d.id)}">${esc(d.label)}</option>`).join('')}
        </select>
        <button class="btn quiet" type="submit">Place</button>
      </form>` : ''}</td>
    </tr>`).join('')}</tbody>
  </table>` : ''}

  ${Object.entries(byDivision).map(([id, d]) => `
  <h2>${esc(d.discipline)} — ${esc(d.label)}</h2>
  <table>
    <thead><tr><th>Competitor</th><th class="hide-sm">Club</th>
      <th class="hide-sm">Grade</th><th>Weight</th><th>How</th></tr></thead>
    <tbody>${d.people.map(({ e, s }) => `<tr>
      <td><strong>${esc(e.first_name ?? '')} ${esc(e.last_name ?? '')}</strong>
        ${e.status !== 'entered'
          ? ` <span class="tag no">${esc(e.status)}</span>` : ''}
        ${e.consents ? '' : ' <span class="tag no">no declaration</span>'}</td>
      <td class="hide-sm">${esc(e.entered_for ?? e.club_name ?? '')}</td>
      <td class="hide-sm">${esc(e.grade ?? '')}</td>
      <td>${e.weight_kg ?? '—'}</td>
      <td class="muted">${s.placed_by === 'assigned'
        ? '<span class="tag dan">moved by hand</span>' : esc(s.placed_by)}</td>
    </tr>`).join('')}</tbody>
  </table>`).join('')}

  ${entries.length ? '' : `<div class="note">Nobody has entered yet.</div>`}` });
};

// ---------------------------------------------------------------------------
// the website
// ---------------------------------------------------------------------------

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

const BLOCK_NAMES = Object.fromEntries(BLOCK_MENU);

/**
 * The page editor.
 *
 * No drag and drop, no editing surface, no script of any kind. Every block is
 * a fieldset and every structural change is a button that submits the form —
 * because these get used in halls with bad reception, and an editor that needs
 * a script to load is an editor that does not work where the people using it
 * are. It also means every change leaves a revision.
 */
export const pageEditor = ({ me, csrf, org, page: pg, values = {},
                             dropped = [], revisions = [], images = [],
                             canPublish = false, done, error, warning }) => {
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
 * Who is on the public site, and who could be.
 *
 * Everybody with the instructor role is listed, including those with no
 * profile, because half this screen's job is showing an administrator who is
 * not on the website — a federation whose site lists two of its nine
 * instructors usually has not decided that, it has just not got round to it.
 *
 * The wording is deliberate. Publishing somebody is phrased as a thing done to
 * a person, because it is: their name, their photograph and their grade on a
 * page anybody can read, indefinitely.
 */
export const instructorList = ({ me, csrf, org, instructors = [],
                                 done, error, rebuild }) => {
  const age = (dob) => {
    if (!dob) return null;
    const d = new Date(dob), now = new Date();
    let y = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) y -= 1;
    return y;
  };

  const bioText = (bio) => (bio?.blocks ?? [])
    .map((b) => typeof b.text === 'string' ? b.text : '')
    .filter(Boolean).join('\n\n');

  const card = (i) => {
    const years = age(i.date_of_birth);
    const tooYoung = years !== null && years < 18;
    const noDob = !i.date_of_birth;

    return `<div class="card">
      <h3>${esc(i.first_name)} ${esc(i.last_name)}
        ${i.title ? `<span class="tag dan">${esc(i.title)}</span>` : ''}</h3>
      <p class="muted">${i.grade ? esc(i.grade) : 'ungraded'}${
        // Hanshi is both an MOKNZ dan grade and the title it confers, so
        // "Hanshi · addressed as Hanshi" says one thing twice.
        i.address_as && i.address_as !== i.grade && i.address_as !== i.title
          ? ` · addressed as ${esc(i.address_as)}` : ''}${
        i.published ? '' : ' · not on the website'}</p>

      ${tooYoung ? `<div class="note"><strong>Under 18.</strong>
        They can hold the instructor role on the roll, but this platform does
        not put a name, photograph and grade of anybody under 18 on a page
        that anybody can read.</div>` : ''}
      ${noDob ? `<div class="note">Their date of birth is not recorded, so the
        system cannot tell whether they are old enough to be published.
        <a href="/p/${esc(i.person_id)}/edit">Add it</a> first.</div>` : ''}

      <form method="post"
            action="/o/${esc(org.slug)}/instructors/${esc(i.person_id)}">
        <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">

        <p><label>What they teach
          <span class="hint">One line. "Tuesday and Thursday evenings",
            "Children's classes".</span><br>
          <input type="text" name="teaches" maxlength="200"
            value="${esc(i.teaches ?? '')}"></label></p>

        <p><label>About them<br>
          <textarea name="bio" rows="4">${esc(bioText(i.bio))}</textarea>
          <span class="hint">Leave a blank line between paragraphs.</span>
        </label></p>

        <p><label>Order on the page
          <span class="hint">Lower numbers first.</span><br>
          <input type="number" name="sortOrder" min="0" max="999"
            style="max-width:120px" value="${i.sort_order ?? 0}"></label></p>

        ${tooYoung || noDob ? '' : `<p><label>
          <input type="checkbox" name="published"${i.published ? ' checked' : ''}>
          Show them on the public website</label>
          <span class="hint">Ask them first. This puts their name, grade and
            photograph on a page anybody can read.</span></p>`}

        <p><button class="btn" type="submit">Save</button>
        ${i.profile_id ? `<button class="btn quiet" type="submit"
          name="op" value="remove">Take off the website</button>` : ''}</p>
      </form>

      ${i.published && i.published_at ? `<p class="hint">On the site since
        ${esc(new Date(i.published_at).toISOString().slice(0, 10))}.</p>` : ''}
      ${i.photo_asset_id ? '' : `<p class="hint">No photograph on their record.
        <a href="/o/${esc(org.slug)}/media">Upload one</a> and set it on their
        page.</p>`}
    </div>`;
  };

  const shown = instructors.filter((i) => i.published).length;

  return page({ title: `Instructors — ${org.name}`, me, csrf, body: `
  <h1>Instructors</h1>
  <p class="sub">${esc(org.name)} ·
    <a href="/o/${esc(org.slug)}/pages">Website</a> ·
    <a href="/o/${esc(org.slug)}/roster">Back to the roll</a></p>

  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${rebuild ? `<div class="note">${esc(rebuild)}</div>` : ''}

  ${instructors.length ? `<p class="muted">${instructors.length} with the
    instructor role here; ${shown} on the public website.</p>` : ''}

  ${instructors.length ? instructors.map(card).join('')
    : `<div class="note">Nobody here holds the instructor role. The website
        follows the roll, so give somebody that role on the
        <a href="/o/${esc(org.slug)}/roster">roll</a> first.</div>`}` });
};

/**
 * A federation or dojo's news.
 *
 * Two lists, and the second one only exists for somebody who can decide:
 * articles from beneath this organisation whose authors have asked for them to
 * appear here. A dojo may say what it likes on its own site; putting it in the
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
                                canPublish = false, done, error }) => {
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


// ---------------------------------------------------------------------------
// a club's page on the federation's website
// ---------------------------------------------------------------------------

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
    <button class="${cls}" type="submit">${label}</button></form>`;

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
              t.weekday === n ? ' selected' : ''}>${name}</option>`).join('')}</select>
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
    <button class="${cls}" type="submit" name="answer" value="${answer}">${label}</button>
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

export const error = ({ me, csrf, status, message }) => page({
  title: `Error ${status}`, me, csrf, body: `
  <h1>${status}</h1>
  <div class="bad">${esc(message)}</div>
  <p><a class="btn quiet" href="/dashboard">Back</a></p>` });

/**
 * Appearance: choose a built-in theme, import one, or download this one.
 *
 * Import is paste-a-file rather than upload, so the screen works without
 * JavaScript and the file is read by the same validator the build uses.
 */
export const appearanceEditor = ({ me, csrf, org, current, builtIn = [],
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
