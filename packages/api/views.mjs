import { describe as auditDescribe } from '../content/audit.mjs';
import { region, words } from '../infrastructure/region-context.mjs';
import { photoNeedsConsent } from '../core/domain/documents.mjs';
import { slotHint } from '../content/image-slots.mjs';
import { BLOCK_MENU } from '../content/page-form.mjs';
/**
 * HONBU — admin views
 *
 * Plain HTML. No client framework, no build step. Every screen works with
 * JavaScript turned off, because these get used on bad connections in halls.
 */



import { esc } from '../core/domain/html.mjs';
export const clubWord = () => words().club.toLowerCase();
import { VOCABULARY, NEUTRAL, ClubWord, identityCss, option, FAMILY_LABELS, when, DOC_STATUS, genderOptions } from './views-shared.mjs';
import { identityHead } from './views-member.mjs';

const V = VOCABULARY;


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
.top .msgbtn{margin-left:auto;font-weight:600}
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
.tag.bad{background:var(--bad-wash);color:var(--bad)}

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
  .shell{grid-template-columns:minmax(0,1fr);grid-template-areas:"stage"}
  /* The menu is a drawer that slides in from the left, opened by the button at the top right.
     No script: the button is a label for a hidden checkbox. */
  .railtoggle{position:absolute;opacity:0;pointer-events:none}
  .rail{position:fixed;top:0;left:0;bottom:0;z-index:30;width:min(84vw,300px);height:100%;
    border-right:1px solid var(--line);padding:18px 14px 28px;overflow-y:auto;
    transform:translateX(-102%);visibility:hidden;
    transition:transform .2s ease,visibility 0s linear .2s;box-shadow:none}
  .railtoggle:checked ~ .rail{transform:none;visibility:visible;transition:transform .2s ease;
    box-shadow:6px 0 28px rgba(0,0,0,.22)}
  .railscrim{position:fixed;top:0;left:0;right:0;bottom:0;width:100%;height:100%;margin:0;z-index:20;background:rgba(10,10,12,.45);display:none}
  .railtoggle:checked ~ .railscrim{display:block}
  .railtoggle:focus-visible ~ .rail{outline:3px solid var(--accent);outline-offset:-3px}
  .railclose{position:absolute;top:10px;right:10px;width:40px;height:40px;display:flex;
    align-items:center;justify-content:center;font-size:28px;line-height:1;cursor:pointer;
    color:var(--ink-2);border-radius:8px;margin:0}
  .railclose:hover{background:var(--soft)}
  .rail .brand{padding-bottom:12px}
  .rail nav a{padding:11px 10px;font-size:16px}
  .rail .all{margin-top:20px}
  .railbtn{display:flex;order:1;margin:0 0 0 auto;width:44px;height:44px;align-items:center;
    justify-content:center;flex-direction:column;gap:5px;cursor:pointer;border:1px solid var(--line-2);
    border-radius:8px;background:var(--canvas)}
  .railbtn i{display:block;width:20px;height:2px;background:var(--ink);border-radius:2px}
  .top{padding:10px 16px;flex-wrap:wrap}
  .shell:has(.rail) .top .brand{display:block;order:0;flex:1 1 0;min-width:0}
  .top > .msgbtn{order:1;margin:0}
  .top > .btn,.top .who{order:2}
  .top .find{margin-left:0;flex:1 1 100%;order:3}
  .top .find input{min-width:0;flex:1}
  .page{padding:4px 16px 48px}
  footer.foot{padding:0 16px 28px}
  .times-edit .t{grid-template-columns:1fr 1fr;}
  .times-edit .head{display:none}
}
@media(min-width:861px){
  .railtoggle,.railscrim,.railclose,.railbtn{display:none}
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
const MENU_BUTTON_MARKER = '<!--honbu:menubutton-->';

export function page({ title, me, body, csrf, query = '', wide = false, head = '' }) {
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

  return `<!DOCTYPE html><html lang="${region().locale}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — Honbu</title><link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#3451D1"><link rel="apple-touch-icon" href="/icons/icon-192.png">${head}<style>${CSS}</style></head><body>
<a class="skip" href="#main">Skip to the content</a>
<div class="shell">
  ${me ? RAIL_MARKER : ''}
  <div class="stage">
    <header class="top">
      <a class="brand" href="${me ? '/dashboard' : '/signin'}">Honbu</a>
      ${me ? MENU_BUTTON_MARKER : ''}${search}${me?.personId ? '<a class="btn quiet" href="/me">My details</a>' : ''}${who}
    </header>
    <main id="main" class="page${wide ? ' wide' : ''}">${body}</main>
    <footer class="foot">Honbu — federation register</footer>
  </div>
</div>
<script src="/vendor/pwa.js" defer></script>
<script src="/vendor/day-of-week.js" defer></script>
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

  return `<input type="checkbox" id="railtoggle" class="railtoggle" aria-label="Open the menu">
<label class="railscrim" for="railtoggle" aria-hidden="true"></label>
<aside class="rail">
  <label class="railclose" for="railtoggle" aria-hidden="true">×</label>
  <a class="brand" href="/dashboard">Honbu</a>
  <div class="here"><strong>${esc(org.name)}</strong>
    <span>${isClub ? esc(club) : 'Federation'}</span></div>
  ${group('People', [
    link(`${base}/roster`, 'Roll'),
    can.register && link(`${base}/members/new`, 'Add a member'),
    can.register && link(`${base}/members/import`, 'Import a roll'),
    can.register && link(`${base}/enquiries`, 'Enquiries'),
    isClub && can.register && link(`${base}/growth`, 'Trials and referrals'),
    can.register && link(`${base}/terms`, 'School terms'),
    can.register && link(`${base}/gradings`, 'Grading events'),
    can.register && link(`${base}/compliance`, 'Compliance'),
    can.register && link(`${base}/forms`, 'Forms and consent'),
    can.register && link(`${base}/grading`, vocabulary.grading ?? 'Grading'),
    isClub && can.teach && link(`${base}/attendance`, 'Attendance'),
    isClub && can.teach && link(`${base}/bookings`, 'Class bookings'),
    (isClub ? can.register : can.manage) && link(`${base}/shop`, 'Shop'),
    isClub && can.teach && link(`${base}/newcomers`, 'Newcomers'),
    isClub && can.register && link(`${base}/renewals`, 'Renewals'),
    can.manage && link(`${base}/messages`, 'Messages'),
    can.manage && link(`${base}/payments`, 'Payments'),
    can.teach && link(`${base}/reports`, 'Reports'),
  ])}
  ${group('Events', [link(`${base}/events`, 'Events')])}
  ${can.write ? group('Website', [
    link(`${base}/pages`, 'Pages'),
    link(`${base}/news`, 'News'),
    link(`${base}/media`, 'Images'),
    isClub && link(`${base}/gallery`, 'Gallery'),
    link(`${base}/menu`, 'Menu'),
    !isClub && can.manage && link(`${base}/appearance`, 'Appearance'),
    can.manage && link(`${base}/region`, 'Country settings'),
    can.manage && link(`${base}/timetable`, 'Grading timetable'),
    can.manage && link(`${base}/event-types`, 'Kinds of event'),
    link(`${base}/instructors`, 'Instructors'),
    isClub ? link(`${base}/club-page`, `${club} page`)
           : link(`${base}/club-pages`, `${club} pages`),
  ]) : ''}
  ${can.manage ? group('Organisation', [
    !isClub && link(`${base}/clubs`, vocabulary.clubPlural ?? `${club}s`),
    isClub && link(`${base}/profile`, `${club} details`),
    link(`${base}/history`, 'History'),
    link(`${base}/integrations`, 'API and webhooks'),
  ]) : ''}
  <div class="all"><nav aria-label="All organisations">
    ${link('/dashboard', 'Everything I look after')}</nav></div>
</aside>`;
}

/** The button that opens the menu on a phone. Only where there is a menu to open. */
// The menu button, and — for anybody who may write to this organisation's people — one tap to do it, on every page.
export const menuButton = (rail = null) => `${rail?.can?.manage
  ? `<a class="btn msgbtn" href="/o/${esc(rail.org.slug)}/messages">Send message</a>` : ''}<label class="railbtn" for="railtoggle" aria-hidden="true"><i></i><i></i><i></i></label>`;

export { RAIL_MARKER, MENU_BUTTON_MARKER };

// ---------------------------------------------------------------------------

export const signIn = ({ sent, error, csrf, next = '' } = {}) => page({
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
    ${next ? `<input type="hidden" name="next" value="${esc(next)}">` : ''}
    <label for="email">Email address</label>
    <input id="email" name="email" type="email" required autocomplete="email">
    <p><button class="btn" type="submit">Email me a link</button></p>
  </form>`}`,
});

/** What opening an emailed link shows: one button, because only a person presses it. */
export const signInConfirm = ({ csrf, token }) => page({
  title: 'Sign in', me: null,
  body: `
  <h1>Sign in</h1>
  <p class="sub">Press the button to finish signing in on this device.</p>
  <form method="post" action="/signin/${esc(token)}">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <p><button class="btn" type="submit">Sign in</button></p>
  </form>`,
});

/**
 * The one screen that can show several federations at once, so the one screen
 * where a single vocabulary is wrong. Each group carries its own words.
 */
export const dashboard = ({ me, csrf, orgs, parents = [], groups = [], platformOwner = false }) => {
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
    ${o.canMessage ? `<p><a class="btn" href="/o/${esc(o.slug)}/messages">Send a message</a></p>` : ''}
    <p>${esc(o.type)} · <a href="/o/${esc(o.slug)}/roster">Members</a>
       · <a href="/o/${esc(o.slug)}/events">Events</a>
       · <a href="/o/${esc(o.slug)}/grading">Grading</a>
       · <a href="/o/${esc(o.slug)}/pages">Website</a>${platformOwner && !String(o.path).includes('.') ? ` · <a href="/platform">Platform</a>` : ''}</p>
  </div>`).join('')}

  ${groups.map((group) => `
  <h2>${heading(group)}</h2>
  <div class="grid">${group.clubs.map((o) => `<div class="card">
    <h3><a href="/o/${esc(o.slug)}/roster">${esc(o.name)}</a></h3>
    <p>${o.members} member${Number(o.members) === 1 ? '' : 's'}</p>
    ${o.canMessage ? `<p><a class="btn" href="/o/${esc(o.slug)}/messages">Send a message</a></p>` : ''}
  </div>`).join('')}</div>`).join('')}` });
};

export const roster = ({ me, csrf, org, roster, total = null, canRegister = false, canManage = false, unlinked = [], waitingDocs = [],
                        filter = {}, ladder = [], dueCount = 0, declarationUnsigned = 0, done, error, rebuild }) => {
  const here = `/o/${esc(org.slug)}/roster`;
  const withClub = org.type !== 'club';
  const q = (extra = {}) => new URLSearchParams(Object.entries({ grade: filter.grade !== 'all' ? filter.grade : '', band: filter.band, show: filter.show, ...extra })
    .filter(([, v]) => v)).toString();
  const filtered = filter.grade !== 'all' && filter.grade || filter.band || filter.show;
  const nextCell = (n) => !n ? '<span class="muted">—</span>'
    : !n.dueFrom ? `<span class="muted">${esc(n.rhythm)}</span>`
    : `${n.due ? '<span class="tag wait">due now</span> ' : ''}<span class="muted">${esc(n.nextLabel)}${n.due ? '' : ` · ${esc(n.dueFrom)}`}${n.byInvitation ? ' · by invitation' : ''}</span>`;
  const nowCell = (p) => {
    if (!p.isInstructor) return '';
    const i = p.instructor;
    if (!canManage || !i) return '<span class="tag">Instructor</span>';
    if (i.published) return '<span class="tag ok">Instructor · on the website</span>';
    const why = i.never ? `never shown: ${i.never}` : i.missing.length ? `needs ${i.missing.join(', ')}` : 'ready to show';
    return `<span class="tag wait">Instructor · not shown</span> <span class="muted">${esc(why)}</span>`;
  };
  return page({
  title: `${org.name} roster`, me, csrf, body: `
  <h1>${esc(org.name)} roll</h1>
  <p class="sub">${total ?? roster.length} on the roll ·
    <a href="/o/${esc(org.slug)}/grading">Run a grading</a> ·
    <a href="/o/${esc(org.slug)}/history">History</a> ·
    <a href="/o/${esc(org.slug)}/events">Events</a> ·${canManage ? `
    <a href="/o/${esc(org.slug)}/messages"><strong>Send a message</strong></a> ·
    <a href="/o/${esc(org.slug)}/declaration">Declaration</a> ·` : ''}
    <a href="/o/${esc(org.slug)}/pages">Website</a></p>

  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${rebuild ? `<div class="note">${esc(rebuild)}</div>` : ''}
  ${waitingDocs.length ? `<div class="note"><strong>${waitingDocs.length} document${waitingDocs.length === 1 ? ' is' : 's are'} waiting to be checked.</strong>
    ${waitingDocs.slice(0, 6).map((d) => `<a href="/p/${esc(d.person_id)}">${esc(d.first_name)} ${esc(d.last_name)}</a> (${esc(d.title)})`).join(', ')}${waitingDocs.length > 6 ? ' …' : ''}</div>` : ''}
  ${declarationUnsigned && canManage ? `<div class="note"><strong>${declarationUnsigned} ${declarationUnsigned === 1 ? 'person has' : 'people have'} not signed the federation declaration.</strong>
    They are marked below. Each is asked to sign the next time they open their page or enter an event. <a href="/o/${esc(org.slug)}/declaration">The declaration</a></div>` : ''}
  ${unlinked.length ? `<div class="note"><strong>${unlinked.length} ${unlinked.length === 1 ? 'child has' : 'children have'} no parent or guardian linked.</strong>
    A child should always sit under a parent. They are marked below; open each one and link a parent.
    <a href="${here}?band=junior">Show the children</a></div>` : ''}
  ${canRegister ? `<p class="actions" style="margin:0 0 20px">
    <a class="btn" href="/o/${esc(org.slug)}/members/new">Add someone</a>
    <a class="btn quiet" href="/o/${esc(org.slug)}/members/import">Import a spreadsheet</a>
  </p>` : ''}

  <form method="get" action="${here}" class="card" style="margin:0 0 16px">
    <div class="row">
      <div><label for="f-grade">Grade</label><select id="f-grade" name="grade">
        <option value="all"${filter.grade === 'all' || !filter.grade ? ' selected' : ''}>Every grade</option>
        <option value="dan"${filter.grade === 'dan' ? ' selected' : ''}>All black belts</option>
        ${[...ladder].sort((a, b) => b.rank_order - a.rank_order).map((g) => `<option value="${esc(g.id)}"${filter.grade === g.id ? ' selected' : ''}>${esc(g.label)}</option>`).join('')}
      </select></div>
      <div><label for="f-band">Age</label><select id="f-band" name="band">
        <option value=""${!filter.band ? ' selected' : ''}>Juniors and seniors</option>
        <option value="senior"${filter.band === 'senior' ? ' selected' : ''}>Seniors (${region().adultAge} and over)</option>
        <option value="junior"${filter.band === 'junior' ? ' selected' : ''}>Juniors (under ${region().adultAge})</option>
      </select></div>
      <div><label for="f-show">Show</label><select id="f-show" name="show">
        <option value=""${!filter.show ? ' selected' : ''}>Everyone</option>
        <option value="instructors"${filter.show === 'instructors' ? ' selected' : ''}>Instructors only</option>
        <option value="due"${filter.show === 'due' ? ' selected' : ''}>Due to grade (${dueCount})</option>
      </select></div>
    </div>
    <p style="margin-bottom:0"><button class="btn quiet" type="submit">Filter</button>
      ${filtered ? `<a href="${here}">Clear</a> <span class="muted">${roster.length} of ${total}</span>` : ''}</p>
  </form>

  ${roster.length ? `
  ${canManage ? `<form method="post" action="/o/${esc(org.slug)}/instructors/bulk">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <input type="hidden" name="grade" value="${esc(filter.grade ?? 'all')}"><input type="hidden" name="band" value="${esc(filter.band ?? '')}"><input type="hidden" name="show" value="${esc(filter.show ?? '')}">
    <p><input type="checkbox" id="pickall" hidden> <label for="pickall" hidden style="display:inline">Select all ${roster.length} shown</label>
      <a id="pickall-link" href="${here}?${esc(q({ all: '1' }))}">Select everyone shown (${roster.length})</a></p>` : ''}
  <table>
    <thead><tr>${canManage ? '<th></th>' : ''}<th>Name</th><th>Grade</th><th class="hide-sm">Next grading</th><th class="hide-sm">Age</th>
      ${withClub ? `<th class="hide-sm">${ClubWord()}</th>` : ''}<th>${canManage ? 'Instructor' : 'Role'}</th><th>Paid until</th></tr></thead>
    <tbody>${roster.map((p) => `<tr>
      ${canManage ? `<td>${p.is_dan || p.isInstructor ? `<input class="pick" type="checkbox" name="pick_${esc(p.id)}" aria-label="Choose ${esc(p.first_name)} ${esc(p.last_name)}"${filter.all ? ' checked' : ''}>` : ''}</td>` : ''}
      <td><a href="/p/${p.id}">${esc(p.first_name)} ${esc(p.last_name)}</a>
        <span class="muted">${esc(p.display_number ?? '')}</span>${p.age != null && p.age < region().adultAge ? ' <span class="tag">junior</span>' : ''}</td>
      <td>${p.grade ? `<span class="tag ${p.is_dan ? 'dan' : 'ok'}">${esc(p.grade)}</span>`
        : '<span class="tag no">ungraded</span>'}</td>
      <td class="hide-sm">${nextCell(p.nextGrading)}</td>
      <td class="hide-sm">${p.age ?? ''}</td>
      ${withClub ? `<td class="hide-sm">${esc(p.club ?? '')}</td>` : ''}
      <td>${p.noGuardian ? '<span class="tag wait">No parent linked</span> ' : ''}${p.noDeclaration ? '<span class="tag wait">Declaration not signed</span> ' : ''}${canManage ? nowCell(p) : (p.isInstructor ? '<span class="tag">Instructor</span>' : '<span class="hide-sm">' + esc(p.role) + '</span>')}</td>
      <td>${p.paid_until ? String(new Date(p.paid_until).toISOString().slice(0,10)) : '—'}</td>
    </tr>`).join('')}</tbody></table>
  ${canManage ? `<p style="margin-top:12px"><button class="btn" type="submit" name="action" value="show">Make instructors and show on the website</button>
      <button class="btn quiet" type="submit" name="action" value="role">Make instructors only</button>
      <button class="btn quiet" type="submit" name="action" value="off">Take off as instructors</button></p>
    <p class="hint">Tick the people who teach. They are shown on their ${clubWord()}'s website once they are ${region().adultAge} or over, their first aid, police vetting and child
      protection are current, and they have written a few words about themselves (on their profile, in the <em>Write-up</em> box under the photograph); anyone not ready is made an instructor and
      the screen says what is missing. Showing puts their name, grade and photograph on a page anybody can read, so only do it for people who have agreed.</p>
  </form>
  <script src="/vendor/select-all.js" defer></script>` : ''}`
    : `<div class="note">${filtered ? 'Nobody matches those filters.' : 'Nobody on the roll yet.'}</div>`}` });
};

export const person = ({ me, csrf, person, history, affiliations, eligibility,
                        titles = [], changes = [], guardians = null, training = null,
                        canEdit = false, about = "", access = null, link = null, isInstructor = false, mayInstruct = false, documents = [], canManage = false, done = null, photoError = null, recognisable = [], instructorSite = null,
                        linkExpires = 15, error = null }) => page({
  title: `${person.first_name} ${person.last_name}`, me, csrf, body: `<style>${identityCss}
  .idphoto{background:#ddd}.idphoto.none{color:#666}.idchip{color:#9a2a1f}</style>
  ${identityHead({ personId: person.id, name: `${person.first_name} ${person.last_name}`, hasPhoto: !!person.photo_asset_id, isInstructor, tag: 'h1' })}
  <p class="sub">${esc(person.display_number ?? 'no member number')}
    ${person.age ? ` · ${person.age} years old` : ''}
    ${canEdit ? ` · <a href="/p/${esc(person.id)}/edit">Correct this record</a>` : ''}</p>

  ${titles.length ? `<p class="sub">${titles.map((t) => `<span class="tag dan">${
    esc(t.label)}</span>`).join(' ')}
    ${titles[0].address_as && titles[0].address_as !== titles[0].label
      ? `<span class="muted">addressed as ${esc(titles[0].address_as)}</span>`
      : ''}</p>` : ''}

  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${photoError ? `<div class="bad">${esc(photoError)}</div>` : ''}

  ${canManage && (mayInstruct || isInstructor) ? `<form method="post" action="/p/${esc(person.id)}/instructor" class="card" style="margin:12px 0">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <label style="display:flex;gap:10px;align-items:center;font-weight:700">
      <input type="checkbox" name="instructor"${isInstructor ? ' checked' : ''} style="width:22px;height:22px">
      This person is an instructor</label>
    <p class="hint">Ticked, they are listed as an instructor of their club and can be shown on its website
      (you choose that on the Instructors screen). Taking the tick off ends it today and keeps the history.
      Signing in to take the roll is a separate thing, under Access.</p>
    <button class="btn" type="submit">Save</button>
  </form>` : ''}

  ${instructorSite ? `<div class="card" style="margin:12px 0"><h3 style="margin-top:0">On the ${esc(instructorSite.name)} website</h3>
    <p>${instructorSite.published ? `<span class="tag ok">Shown</span> on the ${clubWord()} page and the Instructors page.` : `<span class="tag wait">Not shown yet</span> The ${clubWord()} page says "Introductions coming soon".`}</p>
    ${canManage ? `<p><a class="btn" href="/o/${esc(instructorSite.slug)}/instructors">${instructorSite.published ? 'See instructors on the roll' : 'Show them on the website'}</a></p>
    <p class="hint">On the roll, tick them and press <strong>Make instructors and show on the website</strong>. They are shown once they have a write-up and their first aid, police vetting and child protection are current.</p>`
      : `<p class="hint">An owner or administrator of the ${clubWord()} (or the federation) switches this on, under Instructors.</p>`}</div>` : ''}

  ${recognisable.length ? `<form method="post" action="/p/${esc(person.id)}/recognise-grade" class="card" style="margin:12px 0">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <h3 style="margin-top:0">Record a grade they already hold</h3>
    <p class="hint">For somebody who earned a grade elsewhere or before joining. It goes on the record as held on joining: no panel, no certificate, no fee.</p>
    <div class="row">
      <div><label for="rg-grade">Grade</label><select id="rg-grade" name="gradeId" required>${recognisable.map((g) => `<option value="${esc(g.id)}">${esc(g.label)}</option>`).join('')}</select></div>
      <div><label for="rg-on">Date earned <span class="muted">(if known)</span></label><input id="rg-on" type="date" name="heldOn"></div>
    </div>
    <label for="rg-note">Where from <span class="muted">(optional)</span></label>
    <input id="rg-note" name="note" maxlength="300" placeholder="e.g. Awarded by Shihan Smith, Tokyo, 2019">
    <p><button class="btn" type="submit">Record this grade</button></p>
  </form>` : ''}

  ${canEdit ? `<form method="post" action="/p/${esc(person.id)}/about" class="card" style="margin:12px 0">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <h3 style="margin-top:0">Write-up</h3>
    <label for="about">A few words about ${esc(person.first_name)} <span class="muted">(up to 280 characters)</span></label>
    <textarea id="about" name="about" rows="3" maxlength="280">${esc(about ?? '')}</textarea>
    <p class="hint">Shown on their instructor card on the website, if they are shown there. ${about ? '' : 'An instructor is not shown until there is one.'}</p>
    <p><button class="btn" type="submit">Save write-up</button></p>
  </form>` : ''}

  ${canEdit ? `<form method="post" action="/p/${esc(person.id)}/photo" enctype="multipart/form-data" class="card" style="margin:12px 0">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <h3 style="margin-top:0">Photograph</h3>
    <input type="file" name="photo" data-photo accept="image/png,image/jpeg,image/webp" hidden>
    <p>Tap the photograph at the top to ${person.photo_asset_id ? 'change it' : 'add one'}.</p>
    <p class="hint">${esc(slotHint('portrait'))} The same photograph is used on their membership card and, if they are shown on the website, on their instructor card.</p>
    ${photoNeedsConsent(person.age, region().adultAge) ? `<label class="check"><input type="checkbox" name="consent">
      Their parent or guardian agrees to this photograph being kept on their record.</label>
    <p class="hint" id="photo-wait" hidden>Tick the box above and the photograph will be sent.</p>` : ''}
    <noscript><p><input type="file" name="photo" accept="image/png,image/jpeg,image/webp"></p><p><button class="btn" type="submit">Save photograph</button></p></noscript>
    ${person.photo_asset_id ? '<p><button class="btn quiet" type="submit" name="remove" value="1">Remove photograph</button></p>' : ''}
  </form><script src="/vendor/photo-pick.js" defer></script>` : ''}

  ${!eligibility?.next && history.length
    ? `<div class="note"><strong>Top of the ladder.</strong>
       No higher grade is defined in this federation's syllabus.</div>` : ''}
  ${eligibility?.next ? (eligibility.eligible
    ? `<div class="good"><strong>Eligible for ${esc(eligibility.next)}.</strong>
       ${eligibility.months.has} months at grade, ${eligibility.sessions.has} sessions since.</div>`
    : `<div class="note"><strong>Not yet eligible for ${esc(eligibility.next)}.</strong>
       Needs ${eligibility.unmet.map(esc).join(', ')}.</div>`) : ''}

  ${training ? `<h2>Training</h2>
  <p>${training.ever ? `<strong>${training.last30}</strong> classes in the last 30 days,
    <strong>${training.last90}</strong> in the last 90. Last seen ${esc(training.last_seen)}.
    <span class="muted">${training.ever} in all.</span>`
    : '<span class="muted">No classes recorded yet.</span>'}</p>` : ''}

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

  <p><a href="/p/${esc(person.id)}/qualifications">Qualifications and checks</a></p>

  <h2>Grading history</h2>
  ${history.length ? `<table>
    <thead><tr><th>Grade</th><th>Awarded</th><th class="hide-sm">By</th>
      <th class="hide-sm">Ratified</th></tr></thead>
    <tbody>${history.map((h) => `<tr>
      <td><strong>${esc(h.label)}</strong>${h.result === 'fail' ? ' <span class="muted">(not passed)</span>' : ''}${h.certificate_no
        ? ` <a href="/p/${esc(person.id)}/certificate/${esc(h.record_id)}">Certificate</a>` : ''}</td>
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

  ${canEdit && guardians && (guardians.length || (person.age != null && person.age < region().adultAge)) ? `
  <h2>Parents and guardians</h2>
  ${guardians.length ? `<table><tbody>${guardians.map((g) => `<tr>
    <td><a href="/p/${esc(g.person_id)}">${esc(g.first_name)} ${esc(g.last_name)}</a></td>
    <td>${esc(FAMILY_LABELS[g.relationship] ?? g.relationship)}</td>
    <td>${g.can_sign_in ? 'Can sign in' : '<span class="muted">No account yet</span>'}</td>
    <td><form method="post" action="/p/${esc(person.id)}/guardians/${esc(g.id)}/contact">
      <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
      <label><input type="checkbox" name="main"${g.is_main_contact ? ' checked' : ''}> Main contact</label>
      <label><input type="checkbox" name="fees"${g.pays_fees ? ' checked' : ''}> Looks after the fees</label>
      ${g.is_main_contact ? '' : `<label><input type="checkbox" name="copy"${g.also_copy ? ' checked' : ''}> Also copy</label>`}
      <button class="btn quiet" type="submit">Save</button></form></td>
    <td><form method="post" action="/p/${esc(person.id)}/guardians/${esc(g.id)}/end">
      <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
      <button class="btn quiet" type="submit">Remove</button></form></td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">Nobody is linked yet. A parent or guardian can then sign in and enter this child in events.</p>'}
  ${guardians.length > 1 ? '<p class="hint">Club emails go to every adult, unless one is the main contact: then to them alone, plus anyone marked "Also copy". Fees and renewal reminders go to whoever "Looks after the fees"; the others no longer see them.</p>' : ''}
  <form method="post" action="/p/${esc(person.id)}/guardians">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <div class="row">
      <div><label for="guardian_number">Their member number
        <span class="hint">They need to be on the register too, so add them first if they are not.</span></label>
        <input id="guardian_number" name="guardian_number" maxlength="20" placeholder="Member number"></div>
      <div><label for="relationship">Related as</label>
        <select id="relationship" name="relationship">${Object.entries(FAMILY_LABELS)
          .map(([v, l]) => option(v, l, 'parent')).join('')}</select></div>
    </div>
    <div class="actions"><button class="btn" type="submit">Link them</button></div>
  </form>` : ''}

  ${documents.length ? `<h2>Documents sent in</h2><table><tbody>${documents.map((d) => `<tr>
    <td><a href="/p/${esc(person.id)}/document/${esc(d.id)}">${esc(d.title)}</a>
      <div class="muted">${esc(when(d.created_at))}${d.awarded_on ? ` · issued ${esc(d.awarded_on)}` : ''}${d.expires_on ? ` · runs out ${esc(d.expires_on)}` : ''}${d.note ? ` · ${esc(d.note)}` : ''}</div></td>
    <td>${d.status === 'pending' && canEdit ? `<form method="post" action="/p/${esc(person.id)}/document/${esc(d.id)}/review">
      <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
      <input name="note" maxlength="300" placeholder="Note (optional)" aria-label="Note">
      <button class="btn" type="submit" name="decision" value="accept">${d.qualification ? 'Accept and record' : 'Accept'}</button>
      <button class="btn quiet" type="submit" name="decision" value="decline">Decline</button></form>`
      : `<span class="tag ${DOC_STATUS[d.status][0]}">${DOC_STATUS[d.status][1]}</span>`}</td></tr>`).join('')}</tbody></table>` : ''}

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
        <span class="hint">Used for men's and women's divisions.</span></label>
      <select id="gender" name="gender">${genderOptions(values?.gender ?? person?.gender, 'Not given')}</select>
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
      <td><span class="tag ${cls}">${/* security-ok: label comes from the fixed ACTION_TAGS table */ label}</span>
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












// ---------------------------------------------------------------------------
// competition
// ---------------------------------------------------------------------------







// ---------------------------------------------------------------------------
// the website
// ---------------------------------------------------------------------------



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










// ---------------------------------------------------------------------------
// a club's page on the federation's website
// ---------------------------------------------------------------------------




export const error = ({ me, csrf, status, message }) => page({
  title: `Error ${status}`, me, csrf, body: `
  <h1>${status}</h1>
  <div class="bad">${esc(message)}</div>
  <p><a class="btn quiet" href="/dashboard">Back</a></p>` });














// ---------------------------------------------------------------------------
// messages
// ---------------------------------------------------------------------------





// ---------------------------------------------------------------------------
// payments
// ---------------------------------------------------------------------------






// ---------------------------------------------------------------------------
// renewals
// ---------------------------------------------------------------------------




// ---------------------------------------------------------------------------
// classes and attendance
// ---------------------------------------------------------------------------






// ---------------------------------------------------------------------------
// newcomers
// ---------------------------------------------------------------------------




// ---------------------------------------------------------------------------
// reports
// ---------------------------------------------------------------------------




// ---------------------------------------------------------------------------
// grading events
// ---------------------------------------------------------------------------






// ---------------------------------------------------------------------------
// qualifications and compliance
// ---------------------------------------------------------------------------





// ---- website enquiries ---------------------------------------------------------




// ---- entering an open event from outside ------------------------------------------





// ---- the member's home -----------------------------------------------------------------

















// ---------------------------------------------------------------------------
// the digital card and class check-in
// ---------------------------------------------------------------------------








// ---------------------------------------------------------------------------
// adult free trials and referrals
// ---------------------------------------------------------------------------











// ---------------------------------------------------------------------------
// school terms
// ---------------------------------------------------------------------------







// ---------------------------------------------------------------------------
// forms and consent
// ---------------------------------------------------------------------------















export * from './views-shop.mjs';
export * from './views-messages.mjs';
export * from './views-settings.mjs';
export * from './views-money.mjs';
export * from './views-events.mjs';
export * from './views-website.mjs';
export * from './views-member.mjs';
export * from './views-club-ops.mjs';
export * from './views-growth.mjs';
export * from './views-forms.mjs';
export * from './views-admin.mjs';
