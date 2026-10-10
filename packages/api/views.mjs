import fs from 'node:fs';
import { describe as auditDescribe, weight as auditWeight }
  from '../content/audit.mjs';
import { highlight as searchHighlight, linkTo as searchLinkTo }
  from '../content/search.mjs';
import { REASON_WORDS } from '../core/domain/repeat-entry.mjs';
import { region, eventTypes, words } from '../infrastructure/region-context.mjs';
import { nextGradingWords } from '../core/domain/next-grading.mjs';
import { photoNeedsConsent } from '../core/domain/documents.mjs';
import { ageOn as personAgeOn } from '../core/domain/people.mjs';
import { slotHint, slotTable } from '../content/image-slots.mjs';
import { WRITING_HELP } from '../content/document-text.mjs';
import path from 'node:path';
import { BLOCKS, paragraphs } from '../content/blocks.mjs';
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
 * a place is a Club, a Dojang, an Academy or a Gym.
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

import { esc } from '../core/domain/html.mjs';
const clubWord = () => words().club.toLowerCase();
const ClubWord = () => words().club;
const clubsWord = () => words().clubPlural.toLowerCase();
import { DEFAULT_TIMEZONE } from '../core/domain/defaults.mjs';
import { money as cents, dollars as money } from '../core/domain/money.mjs';
import { taxLine } from '../core/domain/tax.mjs';
const taxNote = (amount, currency) => { const t = taxLine(amount, region(), (c) => cents(c, currency)); return t ? ` <span class="muted">${esc(t)}</span>` : ''; };

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
  .shell:has(.rail) .top .brand{display:block;order:0;flex:1 1 calc(100% - 70px)}
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
export const menuButton = () => '<label class="railbtn" for="railtoggle" aria-hidden="true"><i></i><i></i><i></i></label>';

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
    <a href="/o/${esc(org.slug)}/messages">Messages</a> ·
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

/**
 * The calendar as the person running it sees it.
 *
 * Two lists, deliberately separate. Its own events, which it may change, and
 * events inherited from above, which it may not. Mixing them into one table
 * with some rows editable is how somebody ends up trying to cancel the
 * national grading from their club page.
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
      <td>${statusTag(e.status)}${seenTag(e)}${reachTag(e.publishUpState, canAsk)}</td>
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
const FAMILY_LABELS = { parent: 'Parent', step_parent: 'Step-parent',
  guardian: 'Legal guardian', grandparent: 'Grandparent', aunt_uncle: 'Aunt or uncle', other_family: 'Other family', carer: 'Carer' };
const kindLabel = (k) => KIND_LABELS[k] ?? k;

const reachTag = (state, show) => !show ? '' : ({
  requested: ' <span class="tag">Waiting for the federation</span>',
  approved: ' <span class="tag ok">On the federation\'s calendar</span>',
  declined: ' <span class="tag no">Federation declined</span>',
}[state] ?? '');

/**
 * Who can actually see a published event. "Published" alone reads as "on the website", and for an event
 * limited to members, a grade range or invited people it is not: the public site shows public events only.
 */
const SEEN_BY = {
  members: 'Members only', own_org: 'This organisation only', by_grade: 'A grade range only', invite: 'Invited only',
};
const seenTag = (e) => e.status !== 'published' ? ''
  : e.visibility === 'public'
    ? '<div class="muted">On the public website</div>'
    : `<div class="muted"><span class="tag">${esc(SEEN_BY[e.visibility] ?? e.visibility)}</span> Not on the public website. To show it, edit the event and choose "Anyone".</div>`;

const VISIBILITY_LABELS = {
  public: 'Anyone, including the public website',
  members: 'All members once signed in (not on the public website)',
  own_org: 'Only people on this organisation\'s own roll (for the federation, just its officials). Not on the public website',
  by_grade: 'Hidden from everyone outside the grade range below',
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
    return new Intl.DateTimeFormat(region().locale, {
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
    <input type="checkbox" id="${/* security-ok: name is a developer-chosen field name, never request data */ name}" name="${/* security-ok: name is a developer-chosen field name, never request data */ name}" value="1"${checked ? ' checked' : ''}>
    <label for="${/* security-ok: name is a developer-chosen field name, never request data */ name}" style="margin:0;font-weight:400">${esc(label)}
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

    <label for="eventType">What sort of event is it?
      <span class="hint">The website announces it with a banner made from this and the date.</span></label>
    <select id="eventType" name="eventType" style="max-width:360px">
      <option value="">Something else</option>
      ${eventTypes().map((t) => option(t.key, t.label, v('eventType'))).join('')}
    </select>

    <label for="title">Title
      <span class="hint">Leave blank to use the type's name. For a seminar, say what it is: it shows above the word SEMINAR.</span></label>
    <input id="title" name="title" maxlength="200"
      value="${esc(v('title'))}" style="max-width:560px">

    <div class="row">
      <div>
        <label for="kind">Kind</label>
        <select id="kind" name="kind">
          ${Object.keys(KIND_LABELS).map((k) =>
            option(k, KIND_LABELS[k], v('kind', 'training'))).join('')}
        </select>
      </div>
      ${v('slug') ? `<input type="hidden" name="slug" value="${esc(v('slug'))}">` : ''}
    </div>

    <label for="summary">One line about it</label>
    <input id="summary" name="summary" maxlength="300"
      value="${esc(v('summary'))}" style="max-width:560px">

    <label for="description">About this event
      <span class="hint">Optional. What happens, who it is for, what to bring. A blank line starts a new paragraph.</span></label>
    <textarea id="description" name="description" rows="8" maxlength="4000" style="max-width:640px">${esc(v('description'))}</textarea>

    <fieldset><legend>Where, who to ask and what it costs</legend>
      <div class="row">
        <div><label for="contactName">Contact name</label>
          <input id="contactName" name="contactName" maxlength="120" value="${esc(v('contactName'))}"></div>
        <div><label for="contactPhone">Contact phone</label>
          <input id="contactPhone" name="contactPhone" maxlength="40" value="${esc(v('contactPhone'))}"></div>
      </div>
      <label for="contactEmail">Contact email</label>
      <input id="contactEmail" name="contactEmail" type="email" maxlength="200" value="${esc(v('contactEmail'))}" style="max-width:420px">
      <label for="costNote">Cost
        <span class="hint">In words: "$60 adults, $40 juniors. Includes lunch."</span></label>
      <input id="costNote" name="costNote" maxlength="300" value="${esc(v('costNote'))}" style="max-width:560px">
      <label for="entryFee">Entry fee ($)
        <span class="hint">0 if it is free. This is what members are charged when they enter a seminar or camp. A tournament is priced by division instead.</span></label>
      <input id="entryFee" name="entryFee" inputmode="decimal" maxlength="10" value="${esc(v('entryFee') ?? '0')}" style="max-width:140px">
      <label for="infoUrl">Link for more information
        <span class="hint">Starts with https://</span></label>
      <input id="infoUrl" name="infoUrl" maxlength="300" value="${esc(v('infoUrl'))}" style="max-width:560px">
      <div class="row">
        <div><label for="latitude">Map pin: latitude
          <span class="hint">Optional. Right-click the place in Google Maps and copy the numbers.</span></label>
          <input id="latitude" name="latitude" inputmode="decimal" value="${esc(v('latitude'))}" placeholder="-39.9301"></div>
        <div><label for="longitude">longitude</label>
          <input id="longitude" name="longitude" inputmode="decimal" value="${esc(v('longitude'))}" placeholder="175.0479"></div>
      </div>
      <p class="hint">Without a pin the map links use the venue name and address above.</p>
    </fieldset>

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
      <label for="visibility">Who can see it
        <span class="hint">Only "Anyone" puts the event on the public website. Every other choice keeps it off.</span></label>
      <select id="visibility" name="visibility" style="max-width:420px">
        ${Object.keys(VISIBILITY_LABELS).map((k) =>
          option(k, VISIBILITY_LABELS[k], v('visibility', 'public'))).join('')}
      </select>

      <div class="row">
        <div>
          <label for="minRankOrder">Lowest grade who can enter
            <span class="hint">Leave blank for no limit. Anyone can still SEE a public event; these limits decide who can enter it. For a black belt event choose 1st dan.</span></label>
          <select id="minRankOrder" name="minRankOrder">
            ${option('', 'No limit', v('minRankOrder'))}
            ${grades.map((g) => option(String(g.rankOrder), g.label,
              v('minRankOrder'))).join('')}
          </select>
        </div>
        <div>
          <label for="maxRankOrder">Highest grade who can enter</label>
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
      <p class="hint">The declaration (a waiver or consent) is for tournaments,
        camps and fight nights. Seminars and gradings do not carry one, so leave
        the declaration blank for them.</p>
      <div class="row">
        <div>
          <label for="guardianUnder">A parent or guardian signs for anyone under
            <span class="hint">Usually ${region().adultAge}, or younger if you prefer.
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
        !!v('publishDown'), 'Needed for the clubs under this organisation, and their members, to see it. Without it only this organisation\'s own page and roll can.')}
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
            <div><label for="divGender">Gender</label>
              <select id="divGender" name="gender">${genderOptions('', 'Any')}</select></div>
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
                               total = null, currency = region().currency, error }) => {
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
                            divisions = [], entryFeeCents = 0, canAssign = false, done, error }) => {
  const unplaced = entries.flatMap((e) =>
    e.selections.filter((s) => !s.division_id).map((s) => ({ entry: e, s })));

  // An event with no disciplines (a grading, a seminar) has entries and no
  // selections. They are named here, or the list counts people it never shows.
  const attending = entries.filter((e) => !e.selections.length);
  // Divisions and fees are for competitions. A seminar or a free grading has neither, so the page does not mention them.
  const hasDivisions = ['tournament', 'fight_night'].includes(event.kind) || divisions.length > 0 || entries.some((e) => e.selections.length);
  const hasDeclaration = !!(event.consentVersion ?? event.consent_version);

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
  <p class="sub">${esc(event.title)} (${esc((EVENT_KIND_WORDS[event.kind] ?? 'Event').toLowerCase())}) · ${esc(org.name)} ·
    ${hasDivisions ? `<a href="/o/${esc(org.slug)}/events/${esc(event.slug)}/setup">Divisions and fees</a>` : `<strong>Entry fee ${esc(cents(entryFeeCents))}</strong> · <a href="/o/${esc(org.slug)}/events/${esc(event.slug)}/edit">Change</a>`}</p>
  <p><a class="btn" href="/o/${esc(org.slug)}/events/${esc(event.slug)}/entries.csv">Download entries (CSV)</a></p>

  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}

  <div class="note"><strong>${entries.length} entered</strong>${hasDivisions ? `
    across ${Object.keys(byDivision).length}
    division${Object.keys(byDivision).length === 1 ? '' : 's'}` : ''}${unplaced.length
      ? `, with ${unplaced.length} still to place` : ''}.</div>

  ${attending.length ? `
  <h2>Entered to attend</h2>
  <table>
    <thead><tr><th>Name</th><th class="hide-sm">Club</th><th class="hide-sm">Grade</th>
      ${hasDeclaration ? '<th>Declaration signed</th>' : ''}</tr></thead>
    <tbody>${attending.map((e) => `<tr>
      <td><strong>${esc(e.first_name ?? '')} ${esc(e.last_name ?? '')}</strong>
        <div class="muted">${esc(e.display_number ?? '')}${e.status === 'entered' ? '' : ' · ' + esc(e.status)}</div></td>
      <td class="hide-sm">${esc(e.entered_for ?? e.club_name ?? '')}</td>
      <td class="hide-sm">${e.grade ? esc(e.grade) : '<span class="muted">—</span>'}</td>
      ${hasDeclaration ? `<td>${e.consents ? '<span class="tag ok">Signed</span>' : '<span class="tag wait">Not signed</span>'}</td>` : ''}
    </tr>`).join('')}</tbody></table>
  ${hasDeclaration ? '<p class="muted">A declaration is the waiver or consent wording you attach to this event. Each person agrees to it by typing their name when they enter.</p>' : ''}` : ''}

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
import { SCHEDULE_NOTE } from '../core/domain/scheduling.mjs';
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

/** Load the club register's CSV files into a federation: paste, preview, confirm. */
export const registerImportScreen = ({ me, csrf, org, files = {}, report = null, saved = false, error, bundled = false }) => {
  const box = (id, label, hint) => `<label for="${id}">${esc(label)}</label>
    <p class="muted">${hint}</p>
    <textarea id="${id}" name="${id}" rows="6" spellcheck="false" style="font-family:monospace">${esc(files[id] ?? '')}</textarea>`;
  const list = (rows) => rows.length ? `<ul>${rows.map((r) => `<li>${r}</li>`).join('')}</ul>` : '';
  return page({ title: `Import ${clubsWord()} — ${org.name}`, me, csrf, body: `
  <h1>Import ${clubsWord()}, class times and instructors</h1>
  <p class="sub">${esc(org.name)}</p>
  <p><a href="/o/${esc(org.slug)}/clubs">Back to clubs</a></p>
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${report ? `<div class="${saved ? 'good' : 'note'}"><strong>${saved ? 'Saved.' : 'Preview. Nothing is saved yet.'}</strong>
    ${report.updated} ${clubWord()}s ${saved ? 'updated' : 'would be updated'}, ${report.published} ${saved ? 'published' : 'would be published'}.
    ${report.people.added || report.people.instructors ? `${report.people.added} people ${saved ? 'added' : 'would be added'}, ${report.people.instructors} ${saved ? 'made' : 'would be made'} instructors, ${report.people.graded} grades recorded.` : ''}
    ${list(report.added.map((n) => `${esc(n)} ${saved ? 'was' : 'would be'} added as a new ${clubWord()}`))}
    ${report.held.length ? `<p>Held back, not published, because something a visitor needs is missing:</p>${list(report.held.map((h) => `${esc(h.name)} needs ${esc(h.missing.join(', '))}`))}` : ''}
    ${list(report.notes.map(esc))}
  </div>` : ''}
  ${report || error || (files.clubs ?? '') ? '' : `<p><a class="btn" href="/o/${esc(org.slug)}/register-import?use=bundled">Fill the boxes from the files that came with this version</a></p>`}
  ${bundled ? '<div class="note">The boxes are filled from the files that came with this version. Press Preview to see what would happen. Nothing is saved yet.</div>' : ''}
  <p>Paste the contents of each CSV file, or use the button above. Blank means unknown and is never filled in for you.
  Importing twice does not duplicate anything. This puts instructors on their ${clubWord()}'s roll; showing them on the
  website still needs their own consent, a write-up and current checks.</p>
  <form method="post" action="/o/${esc(org.slug)}/register-import">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    ${box('clubs', ClubWord(), 'Columns: slug, name, venue_name, address_line, suburb, city, postcode, latitude, longitude, phone, email, directions, blurb, who_trains, instructor_name, instructor_grade, publish (and optionally country, timezone)')}
    ${box('sessions', 'Class times', 'Columns: slug, label, weekday, starts, ends, min_age, max_age')}
    ${box('instructors', 'Instructors', 'Columns: slug, first_name, last_name, dan, distinct')}
    <div class="actions">
      <button class="btn" type="submit">${report && !saved ? 'Check again' : 'Preview'}</button>
      ${report && !saved ? '<button class="btn" type="submit" name="confirm" value="yes">Save these changes</button>' : ''}
    </div>
  </form>`, });
};

/**
 * The clubs beneath an organisation, and adding one.
 *
 * Adding a club and naming its administrator is one step because a club with
 * nobody able to open it is the thing this screen exists to stop producing.
 */
export const clubsScreen = ({ me, csrf, org, clubs = [], values = {}, error,
                              done, added = null, adminName = null,
                              link = null, linkExpires = null }) => {
  const v = (k) => esc(values[k] ?? '');
  return page({ title: `Clubs — ${org.name}`, me, csrf, body: `
  <h1>Clubs</h1>
  <p class="sub">${esc(org.name)}</p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${added ? `<div class="good"><strong>${esc(added.name)}</strong> is added.
    <a href="/o/${esc(added.slug)}/roster">Open it</a>.
    It has no page on the website yet — the club asks for that from its own
    screen and you approve it under ${ClubWord()} pages.
    ${adminName ? `<br>${esc(adminName)} can run it. ${link
      ? `Give them this sign-in link (it works once, for ${esc(String(linkExpires ?? 15))}
         minutes, and is not shown again):<br><code style="word-break:break-all">${esc(link)}</code>`
      : ''}` : ''}</div>` : ''}

  <p><a href="/o/${esc(org.slug)}/register-import">Import ${clubsWord()}, class times and instructors from CSV files</a></p>
  <h2>Add a club</h2>
  <form method="post" action="/o/${esc(org.slug)}/clubs/new">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <div class="row">
      <div><label for="name">Club name</label>
        <input id="name" name="name" required maxlength="80" value="${v('name')}"></div>
      <div><label for="city">Town or city</label>
        <input id="city" name="city" maxlength="80" value="${v('city')}"></div>
    </div>
    <label for="slug">Web address <span class="muted">(optional — made from the name)</span></label>
    <input id="slug" name="slug" maxlength="40" value="${v('slug')}" placeholder="whanganui">
    <fieldset><legend>Who runs it</legend>
      <p class="muted">They are enrolled as a member and given administrator access
        to this club only. Leave all three blank to add the club now and give
        somebody access later.</p>
      <div class="row">
        <div><label for="adminFirst">First name</label>
          <input id="adminFirst" name="adminFirst" maxlength="60" value="${v('adminFirst')}"></div>
        <div><label for="adminLast">Last name</label>
          <input id="adminLast" name="adminLast" maxlength="60" value="${v('adminLast')}"></div>
      </div>
      <label for="adminEmail">Email</label>
      <input id="adminEmail" name="adminEmail" type="email" maxlength="160" value="${v('adminEmail')}">
    </fieldset>
    <div class="actions"><button class="btn" type="submit">Add the club</button></div>
  </form>

  <h2>${clubs.length} club${clubs.length === 1 ? '' : 's'}</h2>
  ${clubs.length ? `<table><thead><tr><th>Club</th><th class="hide-sm">Town</th>
    <th>Members</th><th>Administrator</th><th>Website</th></tr></thead><tbody>${
    clubs.map((c) => `<tr>
      <td><a href="/o/${esc(c.slug)}/roster"><strong>${esc(c.name)}</strong></a></td>
      <td class="hide-sm">${esc(c.city)}</td>
      <td>${c.members}</td>
      <td>${c.has_administrator ? 'Yes' : '<span class="tag no">Nobody yet</span>'}</td>
      <td>${c.page_live ? '<span class="tag ok">Live</span>' : '<span class="muted">Not listed</span>'}</td>
    </tr>`).join('')}</tbody></table>` : '<div class="note">No clubs yet.</div>'}` });
};

/**
 * A club's own screen: what it is, who runs it, what is happening.
 *
 * One page to start from rather than five. Contact details and training
 * times are not here on purpose — they are the club's page, and a second
 * place to type a phone number is how two of them end up different.
 */
export const clubProfileScreen = ({ me, csrf, org, club, parent, administrators = [],
                                    counts = {}, page: pageRow, values = null, error, done,
                                    rebuild }) => {
  const v = (k, fallback) => esc(values?.[k] ?? fallback ?? '');
  const founded = club.founded_iso ?? '';
  const zones = Intl.supportedValuesOf('timeZone');
  const state = values?.status ?? club.status;
  const pageState = pageRow?.published ? 'Live on the website'
    : pageRow?.page_requested_at ? 'Waiting for the federation' : 'Not on the website';

  return page({ title: `${club.name} — details`, me, csrf, body: `
  <h1>${esc(club.name)}</h1>
  <p class="sub">${parent ? `Part of ${esc(parent.name)} · ` : ''}${esc(pageState)}</p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${rebuild ? `<div class="note">${esc(rebuild)}</div>` : ''}

  <div class="row">
    <div><a href="/o/${esc(org.slug)}/roster"><strong>${counts.members ?? 0}</strong> members</a></div>
    <div><strong>${counts.instructors ?? 0}</strong> instructors</div>
    <div><a href="/o/${esc(org.slug)}/events"><strong>${counts.upcoming ?? 0}</strong> upcoming events</a></div>
    <div><a href="/o/${esc(org.slug)}/club-page">Edit the club's page</a></div>
  </div>

  <h2>Details</h2>
  <form method="post" action="/o/${esc(org.slug)}/profile">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <div class="row">
      <div><label for="name">Name</label>
        <input id="name" name="name" required maxlength="80" value="${v('name', club.name)}"></div>
      <div><label for="shortName">Short name <span class="muted">(optional)</span></label>
        <input id="shortName" name="shortName" maxlength="12" value="${v('shortName', club.short_name)}"></div>
    </div>
    <div class="row">
      <div><label for="founded">Began <span class="muted">(optional, 2009-03-14)</span></label>
        <input id="founded" name="founded" maxlength="10" value="${v('founded', founded)}"></div>
      <div><label for="timezone">Timezone</label>
        <input id="timezone" name="timezone" list="zones" required value="${v('timezone', club.timezone)}">
        <datalist id="zones">${zones.map((z) => `<option value="${esc(z)}">`).join('')}</datalist></div>
    </div>
    <fieldset><legend>Is the club running?</legend>
      <label><input type="radio" name="status" value="active"${state === 'active' ? ' checked' : ''}> Running</label>
      <label><input type="radio" name="status" value="dormant"${state === 'dormant' ? ' checked' : ''}> On a break
        <span class="muted">— comes off the website; nothing is deleted</span></label>
    </fieldset>
    <div class="actions"><button class="btn" type="submit">Save</button></div>
  </form>

  <h2>Who runs it</h2>
  ${administrators.length ? `<table><tbody>${administrators.map((a) => `<tr>
    <td>${esc([a.first_name, a.last_name].filter(Boolean).join(' ') || '—')}</td>
    <td>${esc(a.email)}</td><td>${esc(a.role)}</td></tr>`).join('')}</tbody></table>`
    : '<div class="note">Nobody has administrator access yet. Open a member\'s record to give it.</div>'}` });
};

/**
 * A signed-in member's own home: themselves, and any children they look after.
 */
export const myHome = ({ me, csrf, self, dependants = [] }) => page({
  title: 'My details', me, csrf, body: `
  <h1>${self ? `Kia ora, ${esc(self.preferred_name || self.first_name)}` : 'My details'}</h1>
  ${self ? `
  <p class="sub">${esc(self.display_number ?? '')}</p>
  <div class="row">
    <div><h2>${esc(self.first_name)} ${esc(self.last_name)}</h2>
      <p><a class="btn" href="/me/${esc(self.id)}">See and update my details</a>
        <a class="btn" href="/me/events">Events I can enter</a>
        <a class="btn" href="/me/payments">Payments</a></p></div>
  </div>
  ${dependants.length ? `<h2>Children I look after</h2>
  <table><tbody>${dependants.map((d) => `<tr>
    <td><strong>${esc(d.first_name)} ${esc(d.last_name)}</strong>
      <div class="muted">${esc(FAMILY_LABELS[d.relationship] ?? d.relationship)}</div></td>
    <td><a class="btn quiet" href="/me/${esc(d.id)}">See and update</a></td>
  </tr>`).join('')}</tbody></table>` : ''}`
  : `<div class="note">This sign-in is not linked to a member record yet, so there is
    nothing to show here. Ask your club to link it.</div>`}` });

/** One person, as they and their guardians may see and change it. */
export const myPerson = ({ me, csrf, how, person, private: priv = {}, grade, memberships = [], certificates = [], qualifications = [],
                           values = null, error, done, instructorSite = null }) => {
  const v = (k, fallback) => esc(values?.[k] ?? fallback ?? '');
  const mine = how === 'self';
  return page({ title: `${person.first_name} ${person.last_name}`, me, csrf, body: `<style>${identityCss}</style>
  ${identityHead({ personId: person.id, name: `${person.first_name} ${person.last_name}`, hasPhoto: !!person.photo_asset_id, tag: 'h1' })}
  <p class="sub">${esc(person.display_number ?? '')}${mine ? '' : ' · you look after this person'}
    · <a href="/me">Back to my family</a></p>
  ${mine ? '' : `<div class="note" role="status"><strong>You are viewing ${esc(person.first_name)}'s profile.</strong>
    Anything you change here is changed for ${esc(person.first_name)}, not for you. <a href="/me">Back to my own home</a></div>`}
  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}

  <h2>Their place in the club</h2>
  <p>${grade ? `Current grade: <strong>${esc(grade.label)}</strong>${grade.awarded_on ? ` <span class="muted">(since ${esc(grade.awarded_on)})</span>` : ''}` : '<span class="muted">No grade recorded yet.</span>'}</p>
  ${grade?.next_grading ? `<p>${esc(nextGradingWords(grade.next_grading))} <span class="muted">A guide only — your instructor decides when you are ready.</span></p>` : ''}
  ${qualifications.length ? `<h2>Qualifications</h2><table><tbody>${qualifications.map((a) => `<tr><td>${esc(a.label)}</td>
    <td>${esc(QUAL_WORDS[a.state])}${a.expires_on ? ` · until ${esc(a.expires_on)}` : ''}</td></tr>`).join('')}</tbody></table>
    <p class="muted">Send new certificates to your club to be recorded.</p>` : ''}
  ${certificates.length ? `<p>Certificates: ${certificates.map((c) => `<a href="/p/${esc(person.id)}/certificate/${esc(c.id)}">${esc(c.label)} (${esc(c.awarded_on)})</a>`).join(' · ')}</p>` : ''}
  ${memberships.length ? `<ul class="plain">${memberships.map((m) => `<li>
    <strong>${esc(m.name)}</strong> — ${esc(m.role)}, ${esc(m.status)}${
      m.paid_until ? `, paid until ${esc(m.paid_until)}` : ''}</li>`).join('')}</ul>` : ''}
  <p class="muted">Name, date of birth, grade and membership are kept by the club
    and federation. Ask them if one is wrong.</p>

  ${instructorSite && mine ? `<h2>Instructor</h2>
  <div class="card"><p>You are an instructor at ${esc(instructorSite.name)}.
    ${instructorSite.published ? `<span class="tag ok">Shown on the ${clubWord()} website</span>` : `<span class="tag wait">Not on the ${clubWord()} website yet</span>`}</p>
    ${instructorSite.published ? '' : `<p class="hint">Appearing on the website is the ${clubWord()}'s choice and yours: an owner or administrator of the ${clubWord()} (or the federation) switches it on from the Instructors screen, once they have your photograph and a few words. Add your photograph below, and ask them.</p>`}</div>
  ` : ''}
  <h2>Photograph</h2>
  <form method="post" action="/p/${esc(person.id)}/photo" enctype="multipart/form-data" class="card" style="margin:12px 0">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <input type="hidden" name="return" value="me">
    <input type="file" name="photo" data-photo accept="image/png,image/jpeg,image/webp" hidden>
    <p>Tap ${mine ? 'your' : 'their'} photograph at the top to ${person.photo_asset_id ? 'change it' : 'add one'}.</p>
    <p class="hint">${esc(slotHint('portrait'))} It is used on ${mine ? 'your' : 'their'} membership card and, if ${mine ? 'you are' : 'they are'} shown on the website, on the instructor card.</p>
    ${photoNeedsConsent(personAgeOn(person.date_of_birth, null), region().adultAge) ? `<label class="check"><input type="checkbox" name="consent">
      ${mine ? 'My parent or guardian agrees' : 'I agree, as their parent or guardian,'} to this photograph being kept on the record.</label>
    <p class="hint" id="photo-wait" hidden>Tick the box above and the photograph will be sent.</p>` : ''}
    <noscript><p><input type="file" name="photo" accept="image/png,image/jpeg,image/webp"></p><p><button class="btn" type="submit">Save photograph</button></p></noscript>
    ${person.photo_asset_id ? '<p><button class="btn quiet" type="submit" name="remove" value="1">Remove photograph</button></p>' : ''}
  </form>
  <script src="/vendor/photo-pick.js" defer></script>

  <h2>Documents</h2>
  <p>Certificates, first aid, declarations and receipts are all in one place.
    <a class="btn" href="/me/${esc(person.id)}/documents">Open ${mine ? 'my' : 'their'} documents</a></p>

  <h2>Contact and safety details</h2>
  <form method="post" action="/me/${esc(person.id)}">
    <label for="about">A few words about ${mine ? 'yourself' : esc(person.first_name)} <span class="muted">(up to 280 characters)</span></label>
    <textarea id="about" name="about" rows="3" maxlength="280">${v('about', person.about)}</textarea>
    <p class="hint">Shown on ${mine ? 'your' : 'their'} instructor card if ${mine ? 'you are' : 'they are'} listed on the ${clubWord()}'s website: where ${mine ? 'you' : 'they'} trained, what ${mine ? 'you' : 'they'} enjoy teaching. Not shown anywhere else.</p>
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <div class="row">
      <div><label for="preferred_name">Preferred name</label>
        <input id="preferred_name" name="preferred_name" maxlength="60" value="${v('preferred_name', person.preferred_name)}"></div>
      <div><label for="phone">Phone</label>
        <input id="phone" name="phone" maxlength="40" value="${v('phone', person.phone)}"></div>
    </div>
    <label for="email">Email</label>
    <input id="email" name="email" type="email" maxlength="160" value="${v('email', person.email)}">
    <p class="hint">This is the address on the register. It does not change the address you sign in with.</p>
    <label for="address_line">Address</label>
    <input id="address_line" name="address_line" maxlength="160" value="${v('address_line', priv.address_line)}">
    <div class="row">
      <div><label for="suburb">Suburb</label><input id="suburb" name="suburb" maxlength="80" value="${v('suburb', priv.suburb)}"></div>
      <div><label for="city">Town or city</label><input id="city" name="city" maxlength="80" value="${v('city', priv.city)}"></div>
      <div><label for="postcode">Postcode</label><input id="postcode" name="postcode" maxlength="12" value="${v('postcode', priv.postcode)}"></div>
    </div>
    <fieldset><legend>Emergency contact</legend>
      <div class="row">
        <div><label for="emergency_name">Name</label><input id="emergency_name" name="emergency_name" maxlength="80" value="${v('emergency_name', priv.emergency_name)}"></div>
        <div><label for="emergency_phone">Phone</label><input id="emergency_phone" name="emergency_phone" maxlength="40" value="${v('emergency_phone', priv.emergency_phone)}"></div>
      </div>
    </fieldset>
    <label for="medical_notes">Medical notes <span class="muted">(injuries, conditions, allergies)</span></label>
    <textarea id="medical_notes" name="medical_notes" rows="4" maxlength="2000">${v('medical_notes', priv.medical_notes)}</textarea>
    <p class="hint">Only ${how === 'self' ? 'you' : 'you and the child\'s other guardians'} can see this here.
      Club staff cannot read it from the register yet.</p>
    <div class="actions"><button class="btn" type="submit">Save</button></div>
  </form>` });
};

export const when = (instant, zone) => new Intl.DateTimeFormat(region().locale, {
  timeZone: zone || DEFAULT_TIMEZONE, weekday: 'short', day: 'numeric', month: 'short',
  year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(instant));

/** What is open to enter, and what has been entered, for me and my children. */
export const myEvents = ({ me, csrf, groups = [], done }) => page({
  title: 'Events', me, csrf, body: `
  <h1>Events</h1>
  <p class="sub"><a href="/me">Back to my details</a></p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${groups.length ? groups.map((g) => `
  <h2>${g.how === 'self' ? 'For me' : `For ${esc(g.person.first_name)}`}</h2>
  ${g.open.length ? `<table><thead><tr><th>When</th><th>Event</th><th></th></tr></thead><tbody>${
    g.open.map((e) => `<tr>
      <td>${esc(when(e.starts_at, e.host_timezone))}</td>
      <td><strong>${esc(e.title)}</strong>
        <div class="muted">${esc(e.host_name)}${e.venue_name ? ' · ' + esc(e.venue_name) : ''}${
          e.entries_close ? ` · entries close ${esc(when(e.entries_close, e.host_timezone))}` : ''}</div></td>
      <td>${e.direct ? `<form method="post" action="/me/events/${esc(e.id)}/${esc(g.person.id)}/quick">
          <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
          <button class="btn" type="submit">Enter${g.how === 'self' ? '' : ` ${esc(g.person.first_name)}`}</button>
          ${e.sameAs ? `<div class="muted">${esc(e.sameAs)}</div>` : ''}</form>`
        : `<a class="btn" href="/me/events/${esc(e.id)}/${esc(g.person.id)}">Enter${
        g.how === 'self' ? '' : ` ${esc(g.person.first_name)}`}</a>${e.sameAs ? `<div class="muted">${esc(e.sameAs)}</div>` : ''}`}</td></tr>`).join('')
  }</tbody></table>` : '<p class="muted">Nothing is open for entries right now.</p>'}
  ${g.entries.length ? `<h3>Already entered</h3><ul class="plain">${g.entries.map((x) => `<li>
    <strong>${esc(x.title)}</strong> <span class="tag">${esc(EVENT_KIND_WORDS[x.kind] ?? 'Event')}</span> — ${esc(when(x.starts_at, x.host_timezone))}${
      x.venue_name ? ` · ${esc(x.venue_name)}` : ''}${x.host_name ? ` · run by ${esc(x.host_name)}` : ''}${
      x.amount_cents != null ? ` · fee ${esc(cents(x.amount_cents, x.currency))}` : ''}</li>`).join('')}</ul>` : ''}
  `).join('') : '<div class="note">This sign-in is not linked to a member record yet.</div>'}` });

const consentBlock = ({ event, need, how, values = {} }) => event.consentVersion ? `
  <fieldset><legend>${need.guardian ? 'A parent or guardian must agree' : 'Declaration'}</legend>
    <div class="note" style="white-space:pre-wrap">${esc(event.consentText ?? '')}</div>
    <label><input type="checkbox" name="accepted" value="1"${values.accepted ? ' checked' : ''}>
      ${need.guardian
        ? 'I am this person\'s parent or guardian and I agree to the declaration above.'
        : how === 'guardian'
          ? 'I agree to the declaration above on their behalf.'
          : 'I agree to the declaration above.'}</label>
    <label for="acceptedName">Type your full name to sign</label>
    <input id="acceptedName" name="acceptedName" maxlength="120" value="${esc(values.acceptedName ?? '')}">
  </fieldset>` : '';

export const memberEntryForm = ({ me, csrf, how, open, event, setup, mine, eventDate,
                                  need, problems = [], values = {}, reasons = [], changed = [], outsider = false, grades = [] }) => page({
  title: `Enter — ${event.title}`, me, csrf, body: `
  <h1>${esc(event.title)}</h1>
  <p class="sub">${esc(when(open.starts_at, open.host_timezone))} · ${esc(open.host_name)} ·
    <a href="/me/events">Back</a></p>
  <p>Entering <strong>${esc(mine.person.first_name)} ${esc(mine.person.last_name)}</strong>${
    mine.grade ? ` (${esc(mine.grade.label)})` : ''}. Their age and grade come from the register.</p>
  ${problems.length ? `<div class="bad"><ul>${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}
  ${reasons.filter((r) => r !== 'problems').length ? `<div class="note"><ul>${reasons.filter((r) => r !== 'problems').map((r) => `<li>${esc(REASON_WORDS[r] ?? r)}${
    r === 'division_changed' ? ' ' + changed.map((c) => `${esc(c.discipline)}: ${esc(c.was ?? 'none')} → ${esc(c.now ?? 'none')}.`).join(' ') : ''}</li>`).join('')}</ul>
    What you gave last time is filled in below.</div>` : ''}

  <form method="post" action="/me/events/${esc(event.id)}/${esc(mine.person.id)}">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    ${setup.disciplines.length ? `<fieldset><legend>What are they entering?</legend>
      ${setup.disciplines.map((d) => `<label><input type="checkbox" name="disc_${esc(d.id)}"
        value="1"${values[`disc_${d.id}`] ? ' checked' : ''}> ${esc(d.name)}${
        d.summary ? ` <span class="muted">— ${esc(d.summary)}</span>` : ''}</label>`).join('')}
      ${outsider ? `<div class="row">
        <div><label for="club">Club or school you train at</label>
          <input id="club" name="club" maxlength="100" value="${esc(values.club ?? '')}"></div>
        <div><label for="grade">Your grade <span class="muted">(your own word — not checked)</span></label>
          <select id="grade" name="grade"><option value="">Choose…</option>${grades.map((g) =>
            `<option value="${esc(g.rankOrder)}"${String(values.grade ?? '') === String(g.rankOrder) ? ' selected' : ''}>${esc(g.label)}</option>`).join('')}</select></div>
      </div>` : ''}
      <div class="row">
        <div><label for="weight">Weight (kg)</label>
          <input id="weight" name="weight" type="number" step="0.01" min="0" max="400" value="${esc(values.weight ?? '')}"></div>
        <div><label for="height">Height (cm)</label>
          <input id="height" name="height" type="number" min="0" max="280" value="${esc(values.height ?? '')}"></div>
      </div></fieldset>` : '<p class="muted">There is nothing to choose for this event — entering puts them on the list.</p>'}
    ${consentBlock({ event, need, how, values })}
    <div class="actions"><button class="btn" type="submit">Check my entry</button></div>
  </form>` });

/** The whole entry, already worked out, and one button. */
export const memberQuickEntry = ({ me, csrf, how, open, event, mine, competitor, need, placements = [],
                                   amountCents, currency, last, weightKg, heightCm, relationship }) => page({
  title: `Enter — ${event.title}`, me, csrf, body: `
  <h1>${esc(event.title)}</h1>
  <p class="sub">${esc(when(open.starts_at, open.host_timezone))} · ${esc(open.host_name)} ·
    <a href="/me/events">Back</a></p>
  <p>Entering <strong>${esc(mine.person.first_name)} ${esc(mine.person.last_name)}</strong>${
    mine.grade ? ` (${esc(mine.grade.label)})` : ''}.</p>
  <table><tbody>
    ${placements.length ? placements.map((p) => `<tr><th>${esc(p.discipline.name)}</th>
      <td>${p.division ? `<span class="tag ok">${esc(p.division.label)}</span>` : '<span class="muted">no division yet</span>'}</td></tr>`).join('') : ''}
    ${weightKg ? `<tr><th>Weight</th><td>${esc(weightKg)} kg <span class="muted">as given on ${esc(last?.enteredOn ?? '')}</span></td></tr>` : ''}
    ${heightCm ? `<tr><th>Height</th><td>${esc(heightCm)} cm</td></tr>` : ''}
    ${amountCents != null ? `<tr><th>Entry fee</th><td>${esc(cents(amountCents, currency))}</td></tr>` : ''}
  </tbody></table>
  <p class="muted">Their grade, age on the day and experience come from the register, not from what was typed last time.</p>
  ${event.consentVersion ? `<fieldset><legend>${need.guardian ? 'A parent or guardian agrees' : 'Declaration'}</legend>
    <div class="note" style="white-space:pre-wrap">${esc(event.consentText ?? '')}</div></fieldset>` : ''}
  <form method="post" action="/me/events/${esc(event.id)}/${esc(mine.person.id)}/quick">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <div class="actions"><button class="btn" type="submit">${
      event.consentVersion ? `I agree${need.guardian ? ' as their parent or guardian' : ''} — enter` : 'Enter'}</button>
      <a class="btn quiet" href="/me/events/${esc(event.id)}/${esc(mine.person.id)}?edit=1">Something has changed</a></div>
  </form>` });

export const memberEntryPreview = ({ me, csrf, how, open, event, mine, placements = [],
                                     amountCents, currency, text = {} }) => page({
  title: `Check — ${event.title}`, me, csrf, body: `
  <h1>Check the entry</h1>
  <p class="sub">${esc(event.title)} · <a href="/me/events">Cancel</a></p>
  <div class="note"><strong>Nothing is saved until you confirm.</strong></div>
  <p><strong>${esc(mine.person.first_name)} ${esc(mine.person.last_name)}</strong></p>
  ${placements.length ? `<ul class="plain">${placements.map((p) => `<li>${esc(p.discipline.name)}${
    p.division ? ` — <span class="tag ok">${esc(p.division.label)}</span>` : ''}</li>`).join('')}</ul>` : ''}
  ${amountCents != null ? `<p>Entry fee: <strong>${esc(cents(amountCents, currency))}</strong>.
    <span class="muted">You can pay straight after you confirm.</span></p>` : ''}
  <form method="post" action="/me/events/${esc(event.id)}/${esc(mine.person.id)}">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    ${Object.entries(text).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('')}
    <input type="hidden" name="confirm" value="yes">
    <div class="actions"><button class="btn" type="submit">Confirm the entry</button></div>
  </form>` });


// ---------------------------------------------------------------------------
// messages
// ---------------------------------------------------------------------------

import { PERIODS as FEE_PERIODS, CATEGORIES as FEE_CATEGORIES, EXEMPT_REASONS, MANUAL_METHODS,
         STANDING_WORDS } from '../core/domain/membership.mjs';
import { KINDS as PAY_KINDS, ASKABLE as PAY_ASKABLE, METHODS as PAY_METHODS, STATUSES as PAY_STATUSES }
  from '../core/domain/payments.mjs';


export const unsubscribePage = ({ csrf, token, first, optedOut, changed }) => page({
  title: 'Email settings', me: null, csrf, body: `
  <h1>Email from your club</h1>
  ${changed ? `<div class="good">${optedOut
    ? 'Done. You will no longer get announcements.' : 'Done. Announcements are back on.'}</div>` : ''}
  <p>${first ? `${esc(first)}, ` : ''}announcements ${optedOut ? 'are <strong>off</strong>' : 'are <strong>on</strong>'}.
    Messages about an event you entered still reach you.</p>
  <form method="post" action="/unsubscribe/${esc(token)}">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <input type="hidden" name="optOut" value="${optedOut ? '0' : '1'}">
    <div class="actions"><button class="btn" type="submit">${optedOut
      ? 'Turn announcements back on' : 'Stop announcements'}</button></div>
  </form>` });


// ---------------------------------------------------------------------------
// payments
// ---------------------------------------------------------------------------

const FEE_METHOD_LABEL = { card: 'Card', bank: 'Internet banking', direct_debit: 'Direct debit' };
const payStatus = (st) => esc(PAY_STATUSES[st] ?? st);
const testBanner = (test) => test ? `<div class="note"><strong>Test payments.</strong>
  No money moves. Card 4000 0000 0000 0002 is declined; any other number is accepted.</div>` : '';

export const myPayments = ({ me, csrf, groups = [], test = false, done }) => page({
  title: 'Payments', me, csrf, body: `
  <h1>Payments</h1>
  <p class="sub"><a href="/me">Back</a>${groups.length ? groups.map(({ person }) => ` · <a href="/me/${esc(person.id)}/auto-renew">Automatic renewal${groups.length > 1 ? ` for ${esc(person.first_name)}` : ''}</a>`).join('') : ''}</p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${testBanner(test)}
  ${groups.map(({ person, rows }) => `
    <h2>${esc(person.first_name)} ${esc(person.last_name)}</h2>
    ${rows.length ? `<table><thead><tr><th>For</th><th>Pay to</th><th>Amount</th><th></th></tr></thead><tbody>${
      rows.map((r) => `<tr>
        <td>${r.lines.map((l) => esc(l.description)).join('<br>')}</td>
        <td>${esc(r.payee_name)}</td>
        <td>${esc(cents(r.amount_cents, r.currency))}</td>
        <td>${['pending', 'failed'].includes(r.status)
          ? `<a class="btn" href="/me/payments/${esc(r.id)}">Pay</a>`
          : `<span class="tag ${r.status === 'succeeded' ? 'ok' : 'no'}">${payStatus(r.status)}</span>`}</td>
      </tr>`).join('')}</tbody></table>` : '<p class="muted">Nothing to pay and nothing paid.</p>'}`).join('')}` });

export const payScreen = ({ me, csrf, payment, test = false, error, done }) => {
  const open = ['pending', 'failed'].includes(payment.status);
  return page({ title: 'Pay', me, csrf, body: `
  <h1>${esc(cents(payment.amount_cents, payment.currency))}</h1>
  <p class="sub">To ${esc(payment.payee_name)} · for ${esc(payment.person_name ?? '')} · <a href="/me/payments">Back</a></p>
  ${testBanner(test)}
  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  <ul class="plain">${payment.lines.map((l) => `<li>${esc(l.description)} — ${esc(cents(l.amount_cents, payment.currency))}</li>`).join('')}</ul>
  ${payment.status === 'failed' && payment.detail ? `<div class="bad">${esc(payment.detail)} You can try again.</div>` : ''}
  ${open ? `<form method="post" action="/me/payments/${esc(payment.id)}">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <fieldset><legend>How would you like to pay?</legend>
      ${Object.entries(PAY_METHODS).map(([k, m], i) => `<label><input type="radio" name="method" value="${k}"${i === 0 ? ' checked' : ''}> ${esc(m.label)}</label>`).join('')}
    </fieldset>
    <label for="card">Card number <span class="muted">(card payments only)</span></label>
    <input id="card" name="card" inputmode="numeric" autocomplete="off" maxlength="23">
    <p class="muted">The card number is checked by the payment provider and is never stored here.</p>
    <div class="actions"><button class="btn" type="submit">Pay ${esc(cents(payment.amount_cents, payment.currency))}</button></div>
  </form>` : payment.status === 'awaiting' ? `
    <div class="note"><strong>${payStatus('awaiting')}.</strong> ${esc(payment.detail ?? '')}
      You do not need to do anything. It will show as paid when it is confirmed.</div>
    ${test ? `<form method="post" action="/me/payments/${esc(payment.id)}/complete" style="display:inline">
      <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
      <button class="btn quiet" name="ok" value="1">Test: the bank confirmed</button>
      <button class="btn quiet" name="ok" value="0">Test: the bank refused</button></form>` : ''}`
  : `<div class="good"><strong>${payStatus(payment.status)}.</strong> ${esc(payment.detail ?? '')}</div>`}` });
};

export const paymentsScreen = ({ me, csrf, org, rows = [], totals = [], methods = [], test = false,
                                 values = null, error, done }) => {
  const v = (k) => esc(values?.[k] ?? '');
  const sum = (status) => totals.filter((t) => t.status === status).reduce((n, t) => n + t.cents, 0);
  return page({ title: `${org.name} — payments`, me, csrf, body: `
  <h1>Payments</h1>
  <p class="sub">What ${esc(org.name)} has been paid. Money goes to the organisation it is for:
    ${clubWord()} fees, kyu gradings, uniforms and equipment to the ${clubWord()}; tournament entries to whoever runs
    the tournament; black belt gradings to the federation.</p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${testBanner(test)}
  <div class="row">
    <div><strong>${esc(cents(sum('succeeded')))}</strong> paid</div>
    <div><strong>${esc(cents(sum('awaiting')))}</strong> waiting for the bank</div>
    <div><strong>${esc(cents(sum('pending')))}</strong> asked for, not yet paid</div>
  </div>
  ${methods.length ? `<p class="muted">Paid so far: ${methods.map((m) => `${esc((MANUAL_METHODS[m.method] ?? FEE_METHOD_LABEL[m.method] ?? m.method).toLowerCase())} ${esc(cents(m.cents))}`).join(' · ')}</p>` : ''}
  ${totals.some((t) => t.status === 'succeeded') ? `<table><thead><tr><th>Paid, by kind</th><th>Payments</th><th>Total</th></tr></thead><tbody>${
    totals.filter((t) => t.status === 'succeeded').map((t) => `<tr><td>${esc(PAY_KINDS[t.kind]?.label ?? t.kind)}</td>
    <td>${t.n}</td><td>${esc(cents(t.cents))}</td></tr>`).join('')}</tbody></table>` : ''}

  <h2>Ask a member for a payment</h2>
  <form method="post" action="/o/${esc(org.slug)}/payments">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <div class="row">
      <div><label for="personNumber">Member number</label>
        <input id="personNumber" name="personNumber" required maxlength="30" value="${v('personNumber')}"></div>
      <div><label for="kind">For</label>
        <select id="kind" name="kind">${PAY_ASKABLE.map((k) => `<option value="${k}"${values?.kind === k ? ' selected' : ''}>${
          esc(PAY_KINDS[k].label)}${PAY_KINDS[k].payee === 'federation' ? ' (paid to the federation)' : ''}</option>`).join('')}</select></div>
      <div><label for="amount">Amount (${region().currency})</label>
        <input id="amount" name="amount" required inputmode="decimal" maxlength="12" value="${v('amountText')}"></div>
    </div>
    <label for="description">What it is <span class="muted">(optional, e.g. “Gi, size 150”)</span></label>
    <input id="description" name="description" maxlength="140" value="${v('description')}">
    <label for="received">Already handed over?</label>
    <select id="received" name="received">
      <option value="">No — ask them to pay</option>
      ${Object.entries(MANUAL_METHODS).map(([k, l]) => `<option value="${k}"${values?.received === k ? ' selected' : ''}>Yes — ${esc(l.toLowerCase())}</option>`).join('')}
    </select>
    <div class="actions"><button class="btn" type="submit">Save</button></div>
  </form>

  <h2>Payments</h2>
  ${rows.length ? `<table><thead><tr><th>When</th><th>Who</th><th>For</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>${
    rows.map((r) => `<tr>
      <td>${esc(new Date(r.created_at).toISOString().slice(0, 10))}</td>
      <td>${esc(r.person_name ?? '—')}</td>
      <td>${r.lines.map((l) => esc(l.description)).join('<br>')}</td>
      <td>${esc(cents(r.amount_cents, r.currency))}${r.status === 'succeeded' ? taxNote(r.amount_cents, r.currency) : ''}</td>
      <td>${payStatus(r.status)}${r.method && r.status === 'succeeded'
          ? ` <span class="muted">· ${esc((MANUAL_METHODS[r.method] ?? FEE_METHOD_LABEL[r.method] ?? r.method).toLowerCase())}${
              r.receipt_no ? ` · ${esc(r.receipt_no)}` : ''}</span>` : ''}</td>
      <td>${['pending', 'failed'].includes(r.status) ? `<form method="post" action="/o/${esc(org.slug)}/payments/${esc(r.id)}/received" style="display:inline">
        <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
        <button class="btn quiet" name="method" value="cash">Paid cash</button>
        <button class="btn quiet" name="method" value="transfer">Paid by transfer</button></form>
        <form method="post" action="/o/${esc(org.slug)}/payments/${esc(r.id)}/cancel" style="display:inline">
        <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}"><button class="btn quiet">Cancel</button></form>` : ''}</td>
    </tr>`).join('')}</tbody></table>` : '<p class="muted">Nothing yet.</p>'}` });
};


// ---------------------------------------------------------------------------
// renewals
// ---------------------------------------------------------------------------

const STANDING_TAG = { exempt: 'ok', current: 'ok', due: 'warn', overdue: 'no', unpaid: 'no' };

export const renewalsScreen = ({ me, csrf, org, today, rows = [], prices = [], auto = [], canSetPrices = false,
                                 canExempt = false, reminderText: remind = null, autoReminders = false, values = null, error, done, notes = [] }) => {
  const v = (k) => esc(values?.[k] ?? '');
  const periods = [...new Set(prices.map((f) => f.period))].filter((p) => FEE_PERIODS[p].months);
  const due = rows.filter((r) => ['overdue', 'due', 'unpaid'].includes(r.standing) && !r.asked);
  return page({ title: `${org.name} — renewals`, me, csrf, body: `
  <h1>Renewals</h1>
  <p class="sub">${esc(org.name)} sets its own prices. Asking for a renewal charges nobody —
    it puts a payment in front of them. However it is paid, online or in cash,
    paying moves their membership on.</p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${notes.length ? `<div class="note">${notes.map(esc).join('<br>')}</div>` : ''}

  <h2>Renewing themselves (${auto.length})</h2>
  ${auto.length ? `<table><thead><tr><th>Member</th><th>Pays</th><th>With</th><th>Fees run to</th><th></th></tr></thead><tbody>${auto.map((g) => `<tr>
    <td>${esc(g.person_name)}</td><td>${esc(FEE_PERIODS[g.period]?.label ?? g.period)}</td><td>${esc(g.label)}</td><td>${esc(g.paid_until ?? '—')}</td>
    <td>${g.status === 'paused' ? '<span class="tag bad">Stopped after failed payments</span>' : g.failures ? `<span class="tag wait">Last payment failed — trying again ${esc(g.next_attempt_on ?? '')}</span>` : '<span class="tag ok">Active</span>'}</td></tr>`).join('')}</tbody></table>
    <p class="muted">Members who renew themselves are not sent renewal reminders.</p>`
    : '<p class="muted">Nobody has set up automatic renewal yet. Members can do it from My payments.</p>'}

  <h2>Prices</h2>
  ${prices.length ? `<table><thead><tr><th>Price</th><th>For</th><th>How often</th><th>Amount</th><th>From</th><th></th></tr></thead><tbody>${
    prices.map((f) => `<tr><td>${esc(f.label)}</td><td>${esc(feeCategories()[f.applies_to] ?? f.applies_to)}</td>
      <td>${esc(FEE_PERIODS[f.period]?.label ?? f.period)}</td><td>${esc(cents(f.amount_cents, f.currency))}</td>
      <td>${esc(f.effective_from)}${f.effective_to ? ` to ${esc(f.effective_to)}` : ''}</td>
      <td>${canSetPrices ? `<form method="post" action="/o/${esc(org.slug)}/renewals/fees/${esc(f.id)}/remove">
        <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}"><button class="btn quiet">Remove</button></form>` : ''}</td></tr>`).join('')}</tbody></table>`
    : '<div class="note">No prices set yet. Add the first one below, then ask people to renew.</div>'}
  ${canSetPrices ? `<form method="post" action="/o/${esc(org.slug)}/renewals/fees">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <div class="row">
      <div><label for="label">Name</label><input id="label" name="label" required maxlength="80" placeholder="Adult annual" value="${v('label')}"></div>
      <div><label for="appliesTo">For</label><select id="appliesTo" name="appliesTo">${Object.entries(feeCategories()).map(([k, l]) =>
        `<option value="${k}"${values?.appliesTo === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <div><label for="period">How often</label><select id="period" name="period">${Object.entries(FEE_PERIODS).map(([k, l]) =>
        `<option value="${k}"${values?.period === k ? ' selected' : ''}>${esc(l.label)}</option>`).join('')}</select></div>
      <div><label for="amount">Amount (${region().currency})</label><input id="amount" name="amount" required inputmode="decimal" maxlength="12" value="${v('amountText')}"></div>
      <div><label for="effectiveFrom">From <span class="muted">(optional)</span></label><input id="effectiveFrom" name="effectiveFrom" maxlength="10" placeholder="${esc(today)}" value="${v('effectiveFrom')}"></div>
    </div>
    <p class="muted">A new price for the same people and period takes over from its start date; the old one ends the day before.</p>
    <div class="actions"><button class="btn" type="submit">Save price</button></div>
  </form>` : ''}

  <h2>Who is due</h2>
  <form method="post" action="/o/${esc(org.slug)}/renewals">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <table><thead><tr><th></th><th>Member</th><th>Fees run to</th><th></th><th>Last reminded</th></tr></thead><tbody>${
    rows.map((r) => `<tr>
      <td>${r.standing === 'exempt' || r.asked ? '' : `<input type="checkbox" name="pick_${esc(r.affiliation_id)}" value="1"${
        ['overdue', 'due', 'unpaid'].includes(r.standing) ? ' checked' : ''} aria-label="Ask ${esc(r.name)}">`}</td>
      <td><a href="/p/${esc(r.person_id)}">${esc(r.name)}</a>
        <span class="muted">${esc(r.display_number ?? '')}${r.role !== 'member' ? ` · ${esc(r.role)}` : ''}</span></td>
      <td>${esc(r.paid_until ?? '—')}</td>
      <td><span class="tag ${STANDING_TAG[r.standing]}">${esc(STANDING_WORDS[r.standing])}</span>${
        r.asked ? ' <span class="muted">asked</span>' : ''}${
        r.fee_exempt ? ` <span class="muted">${esc(EXEMPT_REASONS[r.fee_exempt_reason] ?? '')}</span>` : ''}</td>
      <td class="muted">${esc(r.last_reminded ?? '—')}</td></tr>`).join('')}</tbody></table>
    ${periods.length ? `<div class="row">
      <div><label for="renewPeriod">Ask them to renew</label><select id="renewPeriod" name="period">${periods.map((p) =>
        `<option value="${p}">${esc(FEE_PERIODS[p].label.toLowerCase())}</option>`).join('')}</select></div>
      <div><label for="received">Already handed over?</label><select id="received" name="received">
        <option value="">No — ask them to pay</option>${Object.entries(MANUAL_METHODS).map(([k, l]) =>
          `<option value="${k}">Yes — ${esc(l.toLowerCase())}</option>`).join('')}</select></div></div>
    <p class="muted">${due.length} need renewing. Tick who to include. “Already handed over” records the payment
      and a receipt number straight away, for people paying at the door.</p>
    <div class="actions"><button class="btn" type="submit" name="action" value="renew">Renew the ticked</button></div>` : ''}

    <h2>Remind the ticked</h2>
    <p class="muted">Writes to the ticked members as ${esc(org.name)}. Children are written to through their parent
      or guardian. Anybody not charged is left out. A fees reminder is sent even to people who have
      stopped announcements, and says so. <code>{club}</code> and <code>{payLink}</code> are filled in for you.</p>
    <label for="subject">Subject</label>
    <input id="subject" name="subject" maxlength="150" value="${esc(values?.subject ?? remind?.subject ?? '')}">
    <label for="body">Message</label>
    <textarea id="body" name="body" rows="8" maxlength="10000">${esc(values?.body ?? remind?.body ?? '')}</textarea>
    <div class="actions"><button class="btn" type="submit" name="action" value="remind">Send the reminder</button></div>
  </form>

  ${canExempt ? `<h2>Automatic reminders</h2>
  <form method="post" action="/o/${esc(org.slug)}/renewals/reminders">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <p>${autoReminders ? '<strong>On.</strong>' : '<strong>Off.</strong>'}
      Each morning ${esc(org.name)} writes to members whose fees run out within 30 days, and again to those whose
      fees ran out in the last 60 days — never more than once every 14 days, never to anybody not charged,
      and never to somebody with no paid-until date at all (so an imported roll is not a flood).
      It needs the club's contact email on its page, so replies have somewhere to go.</p>
    <input type="hidden" name="enabled" value="${autoReminders ? '0' : '1'}">
    <div class="actions"><button class="btn quiet" type="submit">${autoReminders ? 'Turn automatic reminders off' : 'Turn automatic reminders on'}</button></div>
  </form>` : ''}

  ${canExempt ? `<h2>People who are not charged</h2>
  <p class="muted">Some people do not pay — an instructor who gives their time, a life member. They stay members and
    are never asked for money. Say why; it is kept in the history.</p>
  <table><tbody>${rows.map((r) => `<tr><td>${esc(r.name)}</td><td>
    <form method="post" action="/o/${esc(org.slug)}/renewals/${esc(r.affiliation_id)}/exempt" style="display:inline">
      <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
      ${r.fee_exempt ? `<input type="hidden" name="exempt" value="0"><button class="btn quiet">Charge ${esc(r.name.split(' ')[0])} fees again</button>`
        : `<input type="hidden" name="exempt" value="1">
           <select name="reason" aria-label="Why ${esc(r.name)} is not charged">${Object.entries(EXEMPT_REASONS).map(([k, l]) =>
             `<option value="${k}"${r.role === 'instructor' && k === 'instructor' ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
           <button class="btn quiet">Do not charge</button>`}
    </form>
    ${r.fee_exempt ? `<form method="post" action="/o/${esc(org.slug)}/renewals/${esc(r.affiliation_id)}/carry-on" style="display:inline">
      <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}"><button class="btn quiet">Carry membership on a year</button></form>` : ''}</td></tr>`).join('')}</tbody></table>` : ''}` });
};


// ---------------------------------------------------------------------------
// classes and attendance
// ---------------------------------------------------------------------------

/** M or F only. Older records that say "male" or "Female" show as M and F. */
const genderOptions = (current, blank) => {
  const c = ['m', 'male'].includes(String(current ?? '').trim().toLowerCase()) ? 'M'
    : ['f', 'female'].includes(String(current ?? '').trim().toLowerCase()) ? 'F' : '';
  return [['', blank], ['M', 'M'], ['F', 'F']].map(([v, l]) => `<option value="${v}"${c === v ? ' selected' : ''}>${l}</option>`).join('');
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const attendanceScreen = ({ me, csrf, org, today, day, classes = [], hasTimetable,
                                   notSeen = [], busiest = [], days, totals, done, error }) => page({
  title: `${org.name} — attendance`, me, csrf, body: `
  <h1>Attendance</h1>
  <p class="sub">The roll is who came. Taking it is also what makes “sessions since the last grading” true.</p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}

  <h2>${esc(DAY_NAMES[new Date(`${day}T00:00:00Z`).getUTCDay()])} ${esc(day)}${day === today ? ' · today' : ''}</h2>
  <form method="get" action="/o/${esc(org.slug)}/attendance">
    <label for="date">Another day</label>
    <input id="date" name="date" value="${esc(day)}" maxlength="10" size="12">
    <button class="btn quiet" type="submit">Show</button>
  </form>
  ${classes.length ? `<table><thead><tr><th>Class</th><th>Time</th><th>Came</th><th></th></tr></thead><tbody>${
    classes.map((c) => `<tr><td>${esc(c.label)}</td><td>${esc(c.starts)}–${esc(c.ends)}</td>
      <td>${c.came == null ? '<span class="muted">not taken</span>' : esc(String(c.came))}</td>
      <td><a class="btn" href="/o/${esc(org.slug)}/attendance/${esc(c.id)}?date=${esc(day)}">${
        c.came == null ? 'Take the roll' : 'Change'}</a>${day === today
        ? ` <a class="btn quiet" href="/o/${esc(org.slug)}/attendance/${esc(c.id)}/code">Check-in code</a>` : ''}</td></tr>`).join('')}</tbody></table>`
    : hasTimetable ? '<p class="muted">No class runs on this day.</p>'
    : `<div class="note">No classes yet. Add the times you train on <a href="/o/${esc(org.slug)}/club-page">the club's page</a>,
        then take the roll here.</div>`}

  <h2>The last ${days} days</h2>
  <div class="row">
    <div><strong>${totals.sessions}</strong> attendances</div>
    <div><strong>${totals.people}</strong> different people</div>
    <div><strong>${totals.perWeek}</strong> a week</div>
  </div>
  ${busiest.length ? `<p class="muted">Most regular: ${busiest.map((m) => `${esc(m.name)} (${m.recent})`).join(', ')}.</p>` : ''}
  ${notSeen.length ? `<h3>Not seen in ${days} days</h3>
  <p class="muted">Worth a kind word — it is not a penalty.</p>
  <table><tbody>${notSeen.map((m) => `<tr><td><a href="/p/${esc(m.person_id)}">${esc(m.name)}</a></td>
    <td class="muted">${m.last_seen ? `last seen ${esc(m.last_seen)}` : 'never recorded'}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">Everybody has been in recently.</p>'}` });

export const rollScreen = ({ me, csrf, org, session, date, members = [], visitors = [], newcomers = [], visitorText = '', error, done }) => page({
  title: `${session.label} — roll`, me, csrf, body: `
  <p><a href="/o/${esc(org.slug)}/attendance?date=${esc(date)}">← Attendance</a></p>
  <h1>${esc(session.label)}</h1>
  <p class="sub">${esc(DAY_NAMES[session.weekday])} ${esc(date)} · ${esc(session.starts)}–${esc(session.ends)}</p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  <form method="post" action="/o/${esc(org.slug)}/attendance/${esc(session.id)}">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <input type="hidden" name="date" value="${esc(date)}">
    <fieldset><legend>Who came?</legend>
      ${members.length ? members.map((m) => `<label class="check"><input type="checkbox" name="here_${esc(m.person_id)}" value="1"${m.present ? ' checked' : ''}>
        ${esc(m.name)}${m.age != null && m.age < region().adultAge ? ` <span class="muted">(${m.age})</span>` : ''}</label>`).join('')
        : '<p class="muted">Nobody is on the roll yet.</p>'}
    </fieldset>
    ${visitors.length ? `<fieldset><legend>Visitors already here</legend>${visitors.map((v) => `<label class="check">
      <input type="checkbox" name="here_${esc(v.person_id)}" value="1" checked> ${esc(v.name)} <span class="muted">${esc(v.display_number ?? '')}</span></label>`).join('')}</fieldset>` : ''}
    <fieldset><legend>Giving it a go</legend>
      ${newcomers.map((n) => `<label class="check"><input type="checkbox" name="new_${esc(n.id)}" value="1"${n.present ? ' checked' : ''}>
        ${esc(n.first_name)} ${esc(n.last_name)} <span class="muted">(${n.visits} ${n.visits === 1 ? 'class' : 'classes'} so far)</span></label>`).join('')}
      <p><a href="/o/${esc(org.slug)}/newcomers/new?session=${esc(session.id)}&amp;date=${esc(date)}">+ Somebody new today</a></p>
    </fieldset>
    <label for="visitors">Visitors from another club <span class="muted">(member numbers, separated by spaces or commas)</span></label>
    <input id="visitors" name="visitors" value="${esc(visitorText ?? '')}" maxlength="300">
    <div class="actions"><button class="btn" type="submit">Save the roll</button></div>
  </form>` });


// ---------------------------------------------------------------------------
// newcomers
// ---------------------------------------------------------------------------

export const newcomerForm = ({ me, csrf, org, values = {}, error, sessionId = '', date = '' }) => {
  const v = (k) => esc(values[k] ?? '');
  const f = (id, label, extra = '') => `<label for="${id}">${/* security-ok: label is a literal passed by the calling screen */ label}</label><input id="${id}" name="${id}" value="${v(id)}" ${extra}>`;
  return page({ title: `${org.name} — new person`, me, csrf, body: `
  <p><a href="/o/${esc(org.slug)}/${sessionId ? `attendance/${esc(sessionId)}?date=${esc(date)}` : 'newcomers'}">← Back</a></p>
  <h1>Somebody new</h1>
  <p class="sub">Trying a class. They are not a member and take no member number.</p>
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  <form method="post" action="/o/${esc(org.slug)}/newcomers">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <input type="hidden" name="session" value="${esc(sessionId)}">
    <input type="hidden" name="date" value="${esc(date)}">
    ${f('firstName', 'First name', 'required maxlength="60"')}
    ${f('lastName', 'Last name', 'required maxlength="60"')}
    ${f('dateOfBirth', 'Date of birth <span class="muted">(2015-03-14)</span>', 'required maxlength="10" inputmode="numeric"')}
    ${f('email', 'Email', 'type="email" maxlength="120"')}
    ${f('phone', 'Phone', 'maxlength="30"')}
    <fieldset><legend>Under ${region().adultAge}? A parent or guardian</legend>
      ${f('guardianName', 'Name', 'maxlength="100"')}
      ${f('guardianPhone', 'Phone', 'maxlength="30"')}
    </fieldset>
    <fieldset><legend>In an emergency</legend>
      ${f('emergencyName', 'Name', 'maxlength="100"')}
      ${f('emergencyPhone', 'Phone <span class="muted">(a child\'s parent\'s phone will do)</span>', 'maxlength="30"')}
    </fieldset>
    <label for="medicalNotes">Anything the instructor should know — injuries, asthma, allergies</label>
    <textarea id="medicalNotes" name="medicalNotes" rows="3" maxlength="1000">${v('medicalNotes')}</textarea>
    <fieldset><legend>Waiver</legend>
      <label class="check"><input type="checkbox" name="consent" value="1"${values.consentGiven ? ' checked' : ''}>
        They (or their parent or guardian) accept the club's waiver and understand karate involves physical contact.</label>
      ${f('consentName', 'Accepted by — full name', 'maxlength="100"')}
    </fieldset>
    <div class="actions"><button class="btn" type="submit">${sessionId ? 'Add and mark as here' : 'Add'}</button></div>
  </form>` });
};

export const newcomersScreen = ({ me, csrf, org, today, newcomers = [], error, done }) => page({
  title: `${org.name} — newcomers`, me, csrf, body: `
  <h1>Giving it a go</h1>
  <p class="sub">People trying a class. They are not members until you make them one. If they stop coming, their details are removed.</p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  <p><a class="btn" href="/o/${esc(org.slug)}/newcomers/new">Add somebody</a></p>
  ${newcomers.length ? `<table><thead><tr><th>Name</th><th>Classes</th><th>Contact</th><th></th></tr></thead><tbody>
  ${newcomers.map((n) => `<tr>
    <td>${esc(n.first_name)} ${esc(n.last_name)}${n.child ? ` <span class="muted">(under ${region().adultAge})</span>` : ''}
      ${n.medical_notes ? `<br><span class="muted">Medical: ${esc(n.medical_notes)}</span>` : ''}</td>
    <td>${n.status === 'trialling' ? `${n.visits}${n.last_visit ? ` · last ${esc(n.last_visit)}` : ''}${n.readyToTalk ? ' <strong>— ask about joining</strong>' : ''}`
      : n.status === 'joined' ? 'Joined' : 'Not continuing'}</td>
    <td>${n.status === 'trialling' ? `${esc(n.child ? `${n.guardian_name ?? ''} ${n.guardian_phone ?? ''}` : [n.email, n.phone].filter(Boolean).join(' · '))}` : ''}</td>
    <td>${n.status === 'trialling' ? `<form method="post" action="/o/${esc(org.slug)}/newcomers/${esc(n.id)}/join" style="display:inline">
        <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}"><button class="btn" type="submit">Make a member</button></form>
      <form method="post" action="/o/${esc(org.slug)}/newcomers/${esc(n.id)}/stop" style="display:inline">
        <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}"><button class="btn secondary" type="submit">Not continuing</button></form>`
      : n.person_id ? `<a href="/p/${esc(n.person_id)}">View</a>` : ''}</td></tr>`).join('')}
  </tbody></table>` : '<p class="muted">Nobody is trying a class at the moment.</p>'}` });


// ---------------------------------------------------------------------------
// reports
// ---------------------------------------------------------------------------

export const reportsScreen = ({ me, csrf, org, reports = [] }) => page({
  title: `${org.name} — reports`, me, csrf, body: `
  <h1>Reports</h1>
  <p class="sub">${org.type === 'club' ? 'For this club.' : 'Everybody beneath this organisation.'} Downloads open in Excel or Sheets. A download of personal details is noted in the audit log.</p>
  <table><tbody>${reports.map((r) => `<tr><td><strong>${esc(r.label)}</strong></td>
    <td><a class="btn" href="/o/${esc(org.slug)}/reports/${esc(r.name)}">View</a>
        <a class="btn secondary" href="/o/${esc(org.slug)}/reports/${esc(r.name)}?format=csv">Download CSV</a></td></tr>`).join('')}</tbody></table>` });

export const reportScreen = ({ me, csrf, org, report }) => {
  const SHOWN = 200;
  const q = report.range ? `from=${esc(report.range.from)}&amp;to=${esc(report.range.to)}` : '';
  return page({ title: `${org.name} — ${report.label}`, me, csrf, body: `
  <p><a href="/o/${esc(org.slug)}/reports">← Reports</a></p>
  <h1>${esc(report.label)}</h1>
  ${report.range ? `<form method="get" action="/o/${esc(org.slug)}/reports/${esc(report.name)}">
    <label for="from">From</label><input id="from" name="from" value="${esc(report.range.from)}" maxlength="10">
    <label for="to">To</label><input id="to" name="to" value="${esc(report.range.to)}" maxlength="10">
    <button class="btn secondary" type="submit">Show</button></form>` : ''}
  <p>${report.rows.length} ${report.rows.length === 1 ? 'row' : 'rows'}${report.total != null ? ` · total $${(report.total / 100).toFixed(2)}` : ''}
    · <a class="btn" href="/o/${esc(org.slug)}/reports/${esc(report.name)}?format=csv${q ? `&amp;${q}` : ''}">Download CSV</a></p>
  ${report.rows.length ? `<table><thead><tr>${report.columns.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>
    ${report.rows.slice(0, SHOWN).map((r) => `<tr>${report.columns.map((c) => `<td>${esc(r[c.key] ?? '')}</td>`).join('')}</tr>`).join('')}
  </tbody></table>${report.rows.length > SHOWN ? `<p class="muted">Showing the first ${SHOWN}. The download has all of them.</p>` : ''}`
    : '<p class="muted">Nothing to show.</p>'}` });
};


// ---------------------------------------------------------------------------
// grading events
// ---------------------------------------------------------------------------

const nz = (iso, tz = DEFAULT_TIMEZONE) => iso
  ? new Date(iso).toLocaleString(region().locale, { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }) : '';

export const gradingEventsScreen = ({ me, csrf, org, events = [] }) => page({
  title: `${org.name} — grading events`, me, csrf, body: `
  <h1>Grading events</h1>
  <p class="sub">${org.type === 'club' ? 'Enter your members into gradings run by you or by your federation.' : 'Gradings you run, and the results.'}
    Schedule a new one under <a href="/o/${esc(org.slug)}/events">Events</a> (kind: grading).
    To record a result with no event, use <a href="/o/${esc(org.slug)}/grading">Grading</a>.</p>
  ${events.length ? `<table><thead><tr><th>Grading</th><th>When</th><th>Run by</th><th>Fee</th><th>Entered</th></tr></thead><tbody>
  ${events.map((e) => `<tr><td><a href="/o/${esc(org.slug)}/gradings/${esc(e.id)}">${esc(e.title)}</a></td>
    <td>${esc(nz(e.starts_iso, org.timezone))}</td><td>${esc(e.organiser)}</td>
    <td>${e.fee_cents ? money(e.fee_cents) : '—'}</td>
    <td>${e.finalised_on ? `Finished ${esc(e.finalised_on)}` : e.entered}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">No gradings are scheduled.</p>'}` });

export const gradingEventScreen = ({ me, csrf, org, ev, organiser, open, entries = [], candidates = [],
                                     panelOptions = [], today, values = {}, done, error }) => {
  const tok = `<input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">`;
  const base = `/o/${esc(org.slug)}/gradings/${esc(ev.id)}`;
  const live = entries.filter((e) => e.status !== 'withdrawn');
  const chosen = (id) => values.results?.[id]?.outcome ?? '';
  return page({ title: `${ev.title} — grading`, me, csrf, body: `
  <p><a href="/o/${esc(org.slug)}/gradings">← Grading events</a></p>
  <h1>${esc(ev.title)}</h1>
  <p class="sub">${esc(nz(ev.starts_iso, ev.timezone))} · run by ${esc(ev.organiser)} · fee ${ev.fee_cents ? money(ev.fee_cents) : 'none'}
    ${ev.finalised_on ? ` · <strong>finished ${esc(ev.finalised_on)}</strong>` : ''}</p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}

  ${organiser && !ev.finalised_on ? `<form method="post" action="${base}/fee">${tok}
    <label for="fee">Grading fee (dollars)</label>
    <input id="fee" name="fee" value="${ev.fee_cents ? (ev.fee_cents / 100).toFixed(2) : ''}" inputmode="decimal" maxlength="9">
    <p class="muted">Kyu fees go to the member's club; black belt fees go to the federation.</p>
    <button class="btn secondary" type="submit">Save fee</button></form>` : ''}

  ${org.type === 'club' ? `<h2>Enter members</h2>
  ${open.open ? (candidates.length ? `<form method="post" action="${base}/enter">${tok}
    <table><thead><tr><th></th><th>Name</th><th>Holds</th><th>Sitting for</th></tr></thead><tbody>
    ${candidates.map((c) => `<tr><td><input type="checkbox" name="pick_${esc(c.id)}" value="1" style="width:auto"${c.eligible ? '' : ' disabled'}></td>
      <td>${esc(c.name)}</td><td>${esc(c.holds ?? '—')}</td>
      <td>${c.eligible ? esc(c.next) : `<span class="muted">${esc(c.unmet.join(', '))}</span>`}</td></tr>`).join('')}</tbody></table>
    <p><button class="btn" type="submit">Enter ticked members</button></p></form>`
      : '<p class="muted">Everybody is entered, or nobody is a member yet.</p>')
    : `<p class="muted">${esc(open.why)}</p>`}` : ''}

  <h2>${organiser ? 'Everybody entered' : 'Your entries'}</h2>
  ${organiser && !ev.finalised_on && live.length ? `<form method="post" action="${base}/results">${tok}` : '<div>'}
  ${entries.length ? `<table><thead><tr><th>Name</th><th>Club</th><th>Holds</th><th>Sitting for</th><th>Payment</th>
    <th>${organiser ? (ev.finalised_on ? 'Result' : 'Result') : 'Result'}</th><th></th></tr></thead><tbody>
  ${entries.map((e) => `<tr${e.status === 'withdrawn' ? ' class="muted"' : ''}>
    <td>${esc(e.name)} <span class="muted">${esc(e.display_number ?? '')}</span></td><td>${esc(e.club ?? '')}</td>
    <td>${esc(e.holds ?? '—')}</td><td>${esc(e.grade)}</td><td>${esc(e.payment ?? (ev.fee_cents ? '' : 'no fee'))}</td>
    <td>${e.status === 'withdrawn' ? 'Withdrawn'
      : ev.finalised_on ? esc({ pass: 'Passed', provisional: 'Provisional', fail: 'Did not pass', absent: 'Did not attend' }[e.outcome] ?? '')
      : organiser ? `<select name="result_${esc(e.entry_id)}" aria-label="Result for ${esc(e.name)}">
          <option value="">—</option>${[['pass', 'Passed'], ['provisional', 'Provisional pass'], ['fail', 'Did not pass'], ['absent', 'Did not attend']]
            .map(([v, l]) => `<option value="${v}"${chosen(e.entry_id) === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
          <input name="note_${esc(e.entry_id)}" placeholder="Note" maxlength="300" aria-label="Note for ${esc(e.name)}">` : ''}</td>
    <td>${e.status !== 'withdrawn' && !ev.finalised_on
      ? `<button class="btn quiet" type="submit" form="w_${esc(e.entry_id)}">Withdraw</button>` : ''}
      ${e.record_id && e.outcome && ['pass', 'provisional'].includes(e.outcome) ? `<a href="/p/${esc(e.person_id)}/certificate/${esc(e.record_id)}">Certificate</a>` : ''}</td></tr>`).join('')}
  </tbody></table>` : '<p class="muted">Nobody is entered yet.</p>'}
  ${organiser && !ev.finalised_on && live.length ? `
    <h3>Finalise</h3>
    <label for="date">Date of the grading</label><input id="date" name="date" value="${esc(values.date ?? today)}" maxlength="10">
    <label for="panel">Examining panel <span class="muted">(member numbers, separated by spaces or commas)</span></label>
    <input id="panel" name="panel" value="${esc(values.panel ?? '')}" maxlength="200">
    ${panelOptions.length ? `<p class="muted">Black belts: ${panelOptions.slice(0, 12).map((p) => `${esc(p.name)} ${esc(p.display_number)} (${esc(p.grade)})`).join(' · ')}</p>` : ''}
    <p class="muted">Finalising puts every pass in the register, issues certificate numbers, and cannot be undone here.</p>
    <p><button class="btn" type="submit">Finalise grading</button></p></form>` : '</div>'}
  ${entries.filter((e) => e.status !== 'withdrawn' && !ev.finalised_on).map((e) => `<form id="w_${esc(e.entry_id)}" method="post" action="${base}/withdraw/${esc(e.entry_id)}">${tok}</form>`).join('')}` });
};

export const certificate = ({ cert }) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Certificate — ${esc(cert.name)}</title>
<style>
  :root{color-scheme:light}
  body{margin:0;background:#f3f1ec;font-family:Georgia,'Times New Roman',serif;color:#1a1a1a}
  .sheet{box-sizing:border-box;max-width:900px;margin:24px auto;padding:56px 48px;background:#fff;border:10px double #8a1c1c;text-align:center}
  .fed{letter-spacing:.2em;text-transform:uppercase;font-size:14px;color:#8a1c1c}
  h1{font-size:40px;margin:18px 0 6px;font-weight:normal}
  .name{font-size:36px;margin:24px 0 8px;border-bottom:1px solid #999;display:inline-block;padding:0 28px 6px}
  .grade{font-size:28px;margin:12px 0;color:#8a1c1c}
  .meta{margin-top:28px;font-size:15px;color:#444;line-height:1.7}
  .panel{margin-top:28px;font-size:14px;color:#444}
  .no{margin-top:30px;font-size:12px;color:#777;letter-spacing:.08em}
  .bar{max-width:900px;margin:12px auto;text-align:right;font:14px system-ui,sans-serif}
  .bar button{padding:8px 14px;font:inherit;cursor:pointer}
  @media print{body{background:#fff}.sheet{margin:0;max-width:none;border-width:10px}.bar{display:none}}
</style></head><body>
<div class="bar">Print this page (Ctrl/Cmd + P) or choose “Save as PDF”.</div>
<div class="sheet">
  <div class="fed">${esc(cert.federation ?? cert.awarded_by)}</div>
  <h1>Certificate of Grading</h1>
  <p>This certifies that</p>
  <div class="name">${esc(cert.name)}</div>
  <p>has been awarded the grade of</p>
  <div class="grade">${esc(cert.grade)}${cert.result === 'provisional' ? ' (provisional)' : ''}</div>
  <div class="meta">Awarded on ${esc(cert.awarded_on)} by ${esc(cert.awarded_by)}${cert.event ? `<br>${esc(cert.event)}` : ''}</div>
  ${cert.examiners.length ? `<div class="panel"><strong>Examining panel</strong><br>${cert.examiners.map((x) =>
    `${esc(x.name)}${x.grade ? `, ${esc(x.grade)}` : ''}`).join('<br>')}</div>` : ''}
  <div class="no">Member ${esc(cert.display_number)} · Certificate ${esc(cert.certificate_no)}</div>
</div></body></html>`;


// ---------------------------------------------------------------------------
// qualifications and compliance
// ---------------------------------------------------------------------------

const QUAL_WORDS = { permanent: 'Does not expire', current: 'Current', expiring: 'Expiring soon', expired: 'Expired', missing: 'Not recorded' };
const QUAL_CATEGORIES = { instructing: 'Instructing', officiating: 'Officiating', safety: 'Safety',
  safeguarding: 'Safeguarding', medical: 'Medical', other: 'Other' };
const QUAL_FOR = { instruct: 'Teaching a class', judge: 'Judging or refereeing', panel: 'Sitting on a grading panel' };
const stateTag = (s) => `<span class="tag ${s === 'expired' || s === 'missing' ? 'bad' : s === 'expiring' ? 'wait' : 'ok'}">${esc(QUAL_WORDS[s] ?? s)}</span>`;

export const complianceScreen = ({ me, csrf, org, today, required = [], rows = [], notCleared = [], expiring = [],
                                   catalogue = [], starters = [], canDefine = false, reminders = null, done, error }) => {
  const tok = `<input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">`;
  const base = `/o/${esc(org.slug)}`;
  return page({ title: `${org.name} — compliance`, me, csrf, body: `
  <h1>Compliance</h1>
  <p class="sub">Who is cleared to teach, and what is about to run out. Records hold the fact and dates of a check — never what it found.</p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}

  <h2>${notCleared.length ? `Not cleared to teach (${notCleared.length})` : 'Everybody who teaches is cleared'}</h2>
  ${!required.length ? `<p class="muted">Nothing is required of instructors yet. Add the qualifications below and tick "Teaching a class" on the ones that must be current.</p>` : ''}
  ${notCleared.length ? `<table><thead><tr><th>Name</th><th>Club</th><th>Problem</th><th></th></tr></thead><tbody>
  ${notCleared.map((r) => `<tr><td><a href="/p/${esc(r.person_id)}/qualifications">${esc(r.name)}</a></td><td>${esc(r.club)}</td>
    <td>${r.barred.map((b) => `${esc(b.label)}: ${stateTag(b.state)}${b.expires_on ? ` ${esc(b.expires_on)}` : ''}`).join('<br>')}</td>
    <td><a href="/p/${esc(r.person_id)}/qualifications">Record</a></td></tr>`).join('')}</tbody></table>` : ''}

  <h2>Running out or run out</h2>
  ${expiring.length ? `<table><thead><tr><th>Name</th><th>Club</th><th>Qualification</th><th>When</th></tr></thead><tbody>
  ${expiring.map((a) => `<tr><td><a href="/p/${esc(a.person_id)}/qualifications">${esc(a.name)}</a></td><td>${esc(a.club)}</td><td>${esc(a.label)}</td>
    <td>${stateTag(a.state)} ${esc(a.expires_on)}${a.days_left != null ? ` <span class="muted">(${a.days_left < 0 ? `${-a.days_left} days ago` : `${a.days_left} days`})</span>` : ''}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">Nothing is due in the next 60 days.</p>'}

  ${reminders !== null ? `<form method="post" action="${base}/compliance/reminders">${tok}
    <label class="check"><input type="checkbox" name="enabled" value="1"${reminders ? ' checked' : ''}> Remind people automatically when a qualification is about to run out or has (and tell the club's administrators)</label>
    <button class="btn secondary" type="submit">Save</button></form>` : ''}

  <h2>What is tracked</h2>
  ${catalogue.length ? `<table><thead><tr><th>Qualification</th><th>Valid for</th><th>Required for</th><th>Held by</th><th></th></tr></thead><tbody>
  ${catalogue.map((c) => `<tr><td>${esc(c.label)} <span class="muted">${esc(QUAL_CATEGORIES[c.category] ?? c.category)}${c.own ? '' : ` · from ${esc(c.owner)}`}</span></td>
    <td>${c.valid_months ? `${c.valid_months} months` : 'Does not expire'}</td>
    <td>${esc((c.required_for ?? []).map((k) => QUAL_FOR[k]).join(', ') || '—')}</td><td>${c.awards}</td>
    <td>${canDefine && c.own ? `<form method="post" action="${base}/compliance/qualifications/${esc(c.id)}/remove" style="display:inline">${tok}<button class="btn quiet" type="submit">Remove</button></form>` : ''}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">Nothing is tracked yet.</p>'}
  ${canDefine ? `
    ${starters.length ? `<form method="post" action="${base}/compliance/qualifications">${tok}<p>Start with the usual ones:
      ${starters.map((s) => `<button class="btn secondary" name="starter" value="${esc(s.code)}" type="submit">${esc(s.label)}</button>`).join(' ')}</p>
      <p class="muted">Validity periods are suggestions — change them to match your federation's rules by adding your own below.</p></form>` : ''}
    <form method="post" action="${base}/compliance/qualifications">${tok}<h3>Add your own</h3>
    <label for="label">Name</label><input id="label" name="label" maxlength="80" required>
    <label for="category">Kind</label><select id="category" name="category">${Object.entries(QUAL_CATEGORIES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
    <label for="validMonths">Valid for (months — blank if it never expires)</label><input id="validMonths" name="validMonths" inputmode="numeric" maxlength="3">
    <fieldset><legend>Must be current for</legend>${Object.entries(QUAL_FOR).map(([k, v]) => `<label class="check"><input type="checkbox" name="for_${k}" value="1"> ${v}</label>`).join('')}</fieldset>
    <button class="btn" type="submit">Add</button></form>` : '<p class="muted">An owner or administrator can change what is tracked.</p>'}` });
};

export const personQualifications = ({ me, csrf, person, awards = [], available = [], mayEdit, today, values = {}, done, error }) => {
  const tok = `<input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">`;
  const name = [person.first_name, person.last_name].filter(Boolean).join(' ');
  return page({ title: `${name} — qualifications`, me, csrf, body: `
  <p><a href="/p/${esc(person.id)}">← ${esc(name)}</a></p>
  <h1>Qualifications and checks</h1>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${awards.length ? `<table><thead><tr><th>Qualification</th><th>Issued</th><th>Until</th><th>Status</th><th>Reference</th><th></th></tr></thead><tbody>
  ${awards.map((a) => `<tr${a.counts ? '' : ' class="muted"'}><td>${esc(a.label)}${a.counts ? '' : ' <span class="muted">(replaced)</span>'}</td>
    <td>${esc(a.awarded_on)}</td><td>${esc(a.expires_on ?? '—')}</td><td>${a.counts ? stateTag(a.state) : ''}</td>
    <td>${esc([a.issued_by_other, a.reference].filter(Boolean).join(' · '))}</td>
    <td>${mayEdit ? `<form method="post" action="/p/${esc(person.id)}/qualifications/${esc(a.id)}/remove" style="display:inline">${tok}<button class="btn quiet" type="submit">Delete</button></form>` : ''}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">Nothing recorded.</p>'}
  ${mayEdit ? (available.length ? `<h2>Record one</h2><form method="post" action="/p/${esc(person.id)}/qualifications">${tok}
    <label for="qualificationId">Qualification</label><select id="qualificationId" name="qualificationId">${available.map((q) => `<option value="${esc(q.id)}"${values.qualificationId === q.id ? ' selected' : ''}>${esc(q.label)}</option>`).join('')}</select>
    <label for="awardedOn">Issued on <span class="muted">(2026-03-14)</span></label><input id="awardedOn" name="awardedOn" maxlength="10" value="${esc(values.awardedOn ?? '')}" required>
    <label for="expiresOn">Runs out on <span class="muted">(leave blank to use the usual period)</span></label><input id="expiresOn" name="expiresOn" maxlength="10" value="${esc(values.expiresOn ?? '')}">
    <label for="issuedBy">Issued by <span class="muted">(e.g. NZ Red Cross)</span></label><input id="issuedBy" name="issuedBy" maxlength="100" value="${esc(values.issuedBy ?? '')}">
    <label for="reference">Certificate or reference number</label><input id="reference" name="reference" maxlength="100" value="${esc(values.reference ?? '')}">
    <p class="muted">Record only that it was done and when. Do not enter what a check found.</p>
    <button class="btn" type="submit">Record</button></form>` : '<p class="muted">Nothing is tracked yet — add qualifications under Compliance first.</p>') : ''}` });
};


// ---- website enquiries ---------------------------------------------------------

export const enquiriesScreen = ({ me, csrf, org, rows = [], waiting = 0, done, error }) => {
  const tok = `<input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">`;
  const base = `/o/${esc(org.slug)}/enquiries`;
  return page({ title: `${org.name} — enquiries`, me, csrf, body: `
  <h1>Enquiries</h1>
  <p class="sub">Messages and free-class requests from your website's forms. ${waiting ? `${waiting} waiting.` : 'Nothing waiting.'}
    Each one is also emailed to your club's contact address; replying to that email answers the visitor.</p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${rows.length ? `<table><thead><tr><th>Received</th><th>From</th><th>About</th><th></th></tr></thead><tbody>
  ${rows.map((r) => `<tr><td>${esc(r.received)}<br>${r.status === 'new' ? '<span class="tag wait">New</span>' : '<span class="tag ok">Handled</span>'}</td>
    <td>${esc(r.name)}<br><a href="mailto:${esc(r.email)}">${esc(r.email)}</a>${r.phone ? `<br>${esc(r.phone)}` : ''}</td>
    <td>${r.kind === 'trial' ? '<strong>Free class</strong>' : 'Message'}${r.who ? ` for ${esc(r.who)}` : ''}
      ${r.message ? `<br><span style="white-space:pre-wrap">${esc(r.message)}</span>` : ''}</td>
    <td><form method="post" action="${base}/${esc(r.id)}/handled" style="display:inline">${tok}
        <input type="hidden" name="handled" value="${r.status === 'new' ? '1' : '0'}">
        <button class="btn secondary" type="submit">${r.status === 'new' ? 'Mark handled' : 'Reopen'}</button></form>
      <form method="post" action="${base}/${esc(r.id)}/delete" style="display:inline">${tok}<button class="btn quiet" type="submit">Delete</button></form></td></tr>`).join('')}
  </tbody></table>` : '<p class="muted">No enquiries yet. Add a contact form to a page from the page editor.</p>'}
  <p class="muted">Enquiries are kept for a year, then deleted.</p>` });
};

/** The form on its own address — for a link in a poster or a social post. */
export const enquiryPage = ({ csrf, club, kind = 'contact', action, values = {}, error, sent = false }) => page({
  title: `${club} — get in touch`, me: null, csrf, body: `
  <h1>${esc(club)}</h1>
  ${sent ? '<div class="good">Thank you — your message has been sent. They will be in touch.</div>' : `
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  <form method="post" action="${esc(action)}">
    <input type="hidden" name="kind" value="${kind === 'trial' ? 'trial' : 'contact'}">
    <div style="position:absolute;left:-9999px" aria-hidden="true"><label>Leave this empty <input name="website" tabindex="-1" autocomplete="off"></label></div>
    <label for="name">Your name</label><input id="name" name="name" maxlength="100" required value="${esc(values.name ?? '')}">
    <label for="email">Email</label><input id="email" name="email" type="email" maxlength="120" required value="${esc(values.email ?? '')}">
    <label for="phone">Phone (optional)</label><input id="phone" name="phone" maxlength="30" value="${esc(values.phone ?? '')}">
    ${kind === 'trial' ? `<label for="who">Who is it for?</label><input id="who" name="who" maxlength="100" value="${esc(values.who ?? '')}">` : ''}
    <label for="message">Message</label><textarea id="message" name="message" rows="5" maxlength="2000">${esc(values.message ?? '')}</textarea>
    <button class="btn" type="submit">Send</button>
  </form>`}` });


// ---- entering an open event from outside ------------------------------------------

const eventLine = (ev) => `${esc(when(ev.starts_at, ev.host_timezone))} · ${esc(ev.host_name)}`;

export const enterStart = ({ csrf, ev, action, sent = false, note = '', error }) => page({
  title: `Enter — ${ev.title}`, me: null, csrf, body: `
  <h1>${esc(ev.title)}</h1>
  <p class="sub">${eventLine(ev)}</p>
  ${sent ? `<div class="good">Check your email. ${esc(note)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  <h2>Have you entered before?</h2>
  <p>Give the email address or mobile number you used last time. We will send you a link that
    brings your details back, so you only confirm what has changed. New here? Use your email
    and we will start you off.</p>
  <form method="post" action="${esc(action)}">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <div style="position:absolute;left:-9999px" aria-hidden="true"><label>Leave this empty <input name="website" tabindex="-1" autocomplete="off"></label></div>
    <label for="contact">Email address or mobile number</label>
    <input id="contact" name="contact" maxlength="120" autocomplete="email" required>
    <div class="actions"><button class="btn" type="submit">Send me a link</button></div>
  </form>` });

export const enterNew = ({ csrf, ev, action, token, values = {}, error }) => page({
  title: `Enter — ${ev.title}`, me: null, csrf, body: `
  <h1>${esc(ev.title)}</h1>
  <p class="sub">${eventLine(ev)}</p>
  <h2>Tell us who you are</h2>
  <p>You only do this once. Next time, one click.</p>
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  <form method="post" action="${esc(action)}">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <input type="hidden" name="t" value="${esc(token ?? '')}">
    <p>Email: <strong>${esc(values.email ?? '')}</strong></p>
    <div class="row">
      <div><label for="firstName">First name</label><input id="firstName" name="firstName" maxlength="60" required value="${esc(values.firstName ?? '')}"></div>
      <div><label for="lastName">Last name</label><input id="lastName" name="lastName" maxlength="60" required value="${esc(values.lastName ?? '')}"></div>
    </div>
    <div class="row">
      <div><label for="dateOfBirth">Date of birth <span class="muted">(YYYY-MM-DD)</span></label>
        <input id="dateOfBirth" name="dateOfBirth" type="date" required value="${esc(values.dateOfBirth ?? '')}"></div>
      <div><label for="gender">Gender</label><select id="gender" name="gender" required>
        <option value="">Choose…</option>${[['M', 'M'], ['F', 'F']].map(([v, l]) => `<option value="${v}"${values.gender === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
    </div>
    <label for="phone">Mobile <span class="muted">(optional — lets us recognise you next time)</span></label>
    <input id="phone" name="phone" maxlength="30" value="${esc(values.phone ?? '')}">
    <p class="muted">Entering for a child? Use your own email, and give the child's details above.</p>
    <div class="actions"><button class="btn" type="submit">Continue</button></div>
  </form>` });


// ---- the member's home -----------------------------------------------------------------

import { STANDING_WORDS as STANDING_WORDS_ } from '../core/domain/membership.mjs';

const dashCss = `<style>
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px;margin:12px 0 20px}
.tile{border:1px solid var(--line,#ddd);border-radius:10px;padding:12px 14px;background:var(--panel,transparent)}
.tile h3{margin:0 0 6px;font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;opacity:.7}
.tile .big{font-size:1.15rem;font-weight:600}
.tile p{margin:.3em 0}
.todo{border-left:4px solid var(--accent,#b00);padding:8px 12px;margin:8px 0;background:rgba(200,0,0,.06);border-radius:4px}
.todo.soft{border-left-color:#c80;background:rgba(200,130,0,.07)}
.unread{font-weight:700}
</style>`;

const personTiles = (p, csrf) => {
  const base = `/me/${esc(p.person.id)}`;
  const m = p.memberships.filter((x) => x.role === 'member');
  const sup = p.memberships.filter((x) => x.role === 'supporter');
  const supporterOnly = !!sup.length && !p.memberships.some((x) => x.role !== 'supporter');
  return `
  <h2>${p.how === 'self' ? esc(p.person.preferred_name || p.person.first_name) + ' ' + esc(p.person.last_name)
    : esc(p.person.first_name) + ' ' + esc(p.person.last_name)}${p.how === 'self' ? '' : ' <span class="muted">· you look after this person</span>'}</h2>
  ${p.actions.length ? p.actions.map((a) => `<div class="todo${a.urgent ? '' : ' soft'}">
    <a href="${esc(a.href)}">${esc(a.text)}${a.total ? ` — ${esc(cents(a.total, p.currency))}` : ''}</a></div>`).join('') : ''}
  <div class="tiles">
    <div class="tile"><h3>Membership</h3>
      ${m.length ? m.map((x) => `<p><span class="big">${esc(x.name)}</span><br>
        <span class="muted">${esc((x.chain ?? []).slice(0, -1).map((c) => c.name).join(' › '))}</span><br>
        ${x.status !== 'active' ? `<span class="tag no">${esc(x.status)}</span> ` : ''}${
          x.standing ? `<span class="tag ${['current', 'exempt'].includes(x.standing) ? 'ok' : 'wait'}">${esc(STANDING_WORDS_[x.standing] ?? x.standing)}</span>` : ''}${
          x.paid_until ? ` <span class="muted">until ${esc(x.paid_until)}</span>` : ''}</p>`).join('')
        : supporterOnly ? sup.map((x) => `<p><span class="big">Supporter</span><br><span class="muted">${esc(x.name)} · not a member</span></p>`).join('')
        : '<p class="muted">Not on a club\'s roll.</p>'}
      <p><a href="${base}">Details</a>${m.length ? ` · <a href="${base}/card">Membership card</a>` : ''}</p></div>
    ${supporterOnly ? '' : `<div class="tile"><h3>Current grade</h3>
      ${p.grade ? `<p class="big">${esc(p.grade.label)}</p><p class="muted">since ${esc(p.grade.awarded_on)}</p>${p.grade.next_grading ? `<p>${esc(nextGradingWords(p.grade.next_grading))}</p>` : ''}`
        : '<p class="muted">No grade recorded yet.</p>'}
      <p><a href="${base}/record">Grade history</a></p></div>`}
    <div class="tile"><h3>Next class</h3>
      ${p.next ? `<p class="big">${p.next.daysAway === 0 ? 'Today' : p.next.daysAway === 1 ? 'Tomorrow' : esc(p.next.weekdayName)} ${esc(p.next.starts)}</p>
        <p>${esc(p.next.label)}<br><span class="muted">${esc(p.next.club)}</span></p>`
        : '<p class="muted">No class found for you.</p>'}
      <p><a href="/me/classes">Timetable</a> · <a href="/me/shop">Shop</a></p></div>
    <div class="tile"><h3>Next event</h3>
      ${p.nextEvent ? `<p class="muted" style="margin:0">${esc(EVENT_KIND_WORDS[p.nextEvent.kind] ?? 'Event')}${p.nextEvent.status === 'confirmed' ? ' · you are confirmed' : ' · you are entered'}</p>
        <p class="big">${esc(p.nextEvent.title)}</p>
        <p class="muted">${esc(when(p.nextEvent.starts_at, p.nextEvent.host_timezone))}${p.nextEvent.venue_name ? `<br>${esc(p.nextEvent.venue_name)}` : ''}<br>Run by ${esc(p.nextEvent.host_name)}</p>`
        : '<p class="muted">You are not entered in anything.</p>'}
      <p><a href="/me/events">${p.openCount ? `${p.openCount} open to enter` : 'Events'}</a></p></div>
    <div class="tile"><h3>Payments</h3>
      ${p.owed.length ? `<p class="big">${esc(cents(p.owedTotal, p.currency))} to pay</p>` : '<p class="big">Nothing to pay</p>'}
      <p><a href="/me/payments">${p.owed.length ? 'Pay now' : 'Payment history'}</a></p></div>
    <div class="tile"><h3>Documents</h3>
      <p>${p.counts.certificates} certificate${p.counts.certificates === 1 ? '' : 's'} ·
        ${p.counts.consents} signed declaration${p.counts.consents === 1 ? '' : 's'} ·
        ${p.qualifications.length} qualification${p.qualifications.length === 1 ? '' : 's'}</p>
      ${p.declaration?.state === 'signed' ? `<p><span class="tag ok">Federation declaration signed</span></p>`
        : p.declaration?.state === 'unsigned' ? `<p><span class="tag wait">Federation declaration not signed</span> <a href="${base}/declaration">Sign it</a></p>` : ''}
      <p><a href="${base}/documents">Open</a></p></div>
    ${supporterOnly ? '' : `<div class="tile"><h3>Training</h3>
      <p class="big">${p.counts.recent_classes} class${p.counts.recent_classes === 1 ? '' : 'es'}</p>
      <p class="muted">in the last 90 days${p.counts.last_trained ? ` · last on ${esc(p.counts.last_trained)}` : ''}</p>
      <p><a href="${base}/record">Attendance</a></p></div>`}
  </div>`;
};

export const memberHome = ({ me, csrf, people = [], unread = 0, messages = [] }) => page({
  title: 'My home', me, csrf, body: `${dashCss}
  ${people.length ? `<h1>Kia ora, ${esc(people[0].person.preferred_name || people[0].person.first_name)}</h1>
  <p class="sub">${esc(people[0].person.display_number ?? '')}
    · <a href="/me/${esc(people[0].person.id)}">See and update my details</a>
    · <a href="/me/notifications">Notifications</a>
    · <a href="/me/terms">Term enrolment</a>
    · <a href="/me/forms/${esc(people[0].person.id)}">Forms</a>
    · <a href="/me/refer">Refer a friend</a>
    · <a href="/me/messages">Messages${unread ? ` <span class="tag wait">${unread} new</span>` : ''}</a></p>
  ${people.length > 1 ? '<p class="muted">Children I look after are below.</p>' : ''}
  ${people.map((p) => personTiles(p, csrf)).join('')}
  <h2>Notifications</h2>
  ${messages.length ? `<table><tbody>${messages.map((m) => `<tr>
    <td class="${m.read_at ? '' : 'unread'}"><a href="/me/messages/${esc(m.id)}">${esc(m.subject)}</a>
      <div class="muted">${esc(m.club)}${m.about ? ` · about ${esc(m.about)}` : ''}</div></td>
    <td class="muted">${esc(when(m.sent_at))}</td></tr>`).join('')}</tbody></table>
    <p><a href="/me/messages">All messages</a></p>` : '<p class="muted">Nothing yet. Messages from your club appear here.</p>'}`
  : `<h1>My home</h1><div class="note">This sign-in is not linked to a member record yet, so there is
    nothing to show here. Ask your club to link it.</div>`}` });

export const messagesInbox = ({ me, csrf, rows = [], unread = 0 }) => page({
  title: 'Messages', me, csrf, body: `
  <h1>Messages</h1>
  <p class="sub"><a href="/me">Back</a>${unread ? ` · ${unread} unread` : ''}</p>
  ${rows.length ? `<table><thead><tr><th>Message</th><th>From</th><th>When</th></tr></thead><tbody>${rows.map((m) => `<tr>
    <td class="${m.read_at ? '' : 'unread'}"><a href="/me/messages/${esc(m.id)}">${esc(m.subject)}</a>${m.about ? ` <span class="muted">about ${esc(m.about)}</span>` : ''}</td>
    <td>${esc(m.club)}</td><td class="muted">${esc(when(m.sent_at))}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">Nothing yet. Messages from your club appear here as well as in your email.</p>'}` });

export const messageView = ({ me, csrf, message: m }) => page({
  title: m.subject, me, csrf, body: `
  <h1>${esc(m.subject)}</h1>
  <p class="sub">From ${esc(m.sender_name)}, ${esc(m.club)} · ${esc(when(m.sent_at))}${m.about ? ` · about ${esc(m.about)}` : ''}
    · <a href="/me/messages">Back</a></p>
  <div style="white-space:pre-wrap">${esc(m.text)}</div>` });

const RESULT_WORDS = { pass: 'Passed', provisional: 'Passed (provisional)', fail: 'Not yet', deferred: 'Deferred', absent: 'Absent' };

export const myRecord = ({ me, csrf, how, person, gradings = [], attendance = [], stats, upcoming = [], past = [] }) => page({
  title: `${person.first_name} — record`, me, csrf, body: `
  <h1>${esc(person.first_name)} ${esc(person.last_name)}</h1>
  <p class="sub"><a href="/me">Back</a> · <a href="/me/${esc(person.id)}/documents">Documents</a></p>

  <h2>Grade history</h2>
  ${gradings.length ? `<table><thead><tr><th>Grade</th><th>Date</th><th>Result</th><th>Awarded by</th></tr></thead><tbody>${gradings.map((g) => `<tr>
    <td>${esc(g.label)}</td><td>${esc(g.awarded_on)}</td><td>${esc(RESULT_WORDS[g.result] ?? g.result)}</td>
    <td>${esc(g.awarded_by ?? '')}${g.certificate_no ? ` · <a href="/p/${esc(person.id)}/certificate/${esc(g.id)}">certificate</a>` : ''}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">No gradings recorded yet.</p>'}

  <h2>Training</h2>
  <p>${stats.last30} class${stats.last30 === 1 ? '' : 'es'} in the last 30 days · ${stats.last365} in the last year · ${stats.total} in all${stats.since ? ` since ${esc(stats.since)}` : ''}.</p>
  ${attendance.length ? `<table><tbody>${attendance.map((a) => `<tr><td>${esc(a.day)}</td><td>${esc(a.label ?? 'Class')}</td><td class="muted">${esc(a.club)}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">No classes recorded yet.</p>'}

  <h2>Events coming up</h2>
  ${upcoming.length ? eventRows(upcoming) : '<p class="muted">Nothing coming up. <a href="/me/events">See what is open</a>.</p>'}
  <h2>Event history</h2>
  ${past.length ? eventRows(past) : '<p class="muted">No past events.</p>'}
  <p class="muted">Results are not shown here yet.</p>` });

const ENTRY_WORDS = { entered: 'Entered', confirmed: 'Confirmed', withdrawn: 'Withdrawn', disqualified: 'Disqualified' };
const eventRows = (rows) => `<table><thead><tr><th>When</th><th>Event</th><th>Status</th></tr></thead><tbody>${rows.map((e) => `<tr>
  <td>${esc(when(e.starts_at, e.host_timezone))}</td>
  <td><strong>${esc(e.title)}</strong>${(e.picks ?? []).length ? `<div class="muted">${e.picks.map((p) => esc(p.discipline) + (p.division ? ' — ' + esc(p.division) : '')).join('; ')}</div>` : ''}</td>
  <td><span class="tag ${['entered', 'confirmed'].includes(e.status) ? 'ok' : 'no'}">${esc(ENTRY_WORDS[e.status] ?? e.status)}</span>${
    e.pay_status && e.pay_status !== 'succeeded' ? ' <span class="tag wait">Not paid</span>' : ''}</td></tr>`).join('')}</tbody></table>`;

/** Read and sign the federation's declaration, once, for yourself or for a child. */
export const declarationSign = ({ me, csrf, person, how, status, next = null, done = null, error = null }) => page({
  title: 'Federation declaration', me, csrf, body: `
  <h1>Federation declaration</h1>
  <p class="sub"><a href="/me">Back</a> · for ${esc(person.first_name)} ${esc(person.last_name)}</p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${status.state === 'none' ? '<p class="muted">The federation has not published a declaration yet. There is nothing to sign.</p>' : `
  <div class="note" style="white-space:pre-wrap">${esc(status.current.body)}</div>
  <p class="muted">Version ${esc(status.current.version)}, published ${esc(status.current.published_on)}. One signature covers every event and class; you are only asked again if the wording changes.</p>
  ${status.state === 'signed'
    ? `<div class="good">Signed${status.signed.guardian ? ' by a parent or guardian' : ''}: ${esc(status.signed.signed_name)} on ${esc(status.signed.signed_on)}.</div>
       ${next ? `<p><a class="btn" href="${esc(next)}">Carry on</a></p>` : ''}`
    : `<form method="post" action="/me/${esc(person.id)}/declaration" class="card">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    ${next ? `<input type="hidden" name="next" value="${esc(next)}">` : ''}
    <label><input type="checkbox" name="accepted" value="1">
      ${how === 'self' ? 'I agree to the declaration above.' : `I am ${esc(person.first_name)}'s parent or guardian and I agree to the declaration above on their behalf.`}</label>
    <label for="acceptedName">Type your full name to sign</label>
    <input id="acceptedName" name="acceptedName" maxlength="120" autocomplete="name" required>
    <p><button class="btn" type="submit">Sign</button></p>
  </form>`}`}` });

/** Where the federation writes its declaration. */
export const declarationAdmin = ({ me, csrf, org, owner, current, signed = 0, starter = '', values = null, done = null, error = null }) => page({
  title: 'Declaration', me, csrf, body: `
  <h1>Federation declaration</h1>
  <p class="sub">${esc(owner.name)} · <a href="/o/${esc(org.slug)}/roster">Back to the roll</a></p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  <p>One waiver and consent for the whole federation. Each member, or a parent or guardian for a child, signs it once, and it covers every class, grading, seminar, camp and tournament.
    ${current ? `Version <strong>${esc(current.version)}</strong> is current, and ${signed} ${signed === 1 ? 'person has' : 'people have'} signed it.` : 'Nothing is published yet, so nobody is asked to sign.'}</p>
  <form method="post" action="/o/${esc(org.slug)}/declaration" class="card">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <label for="version">Version <span class="hint">Change it every time the wording changes. Publishing new wording asks everybody to sign again.</span></label>
    <input id="version" name="version" maxlength="40" value="${esc(values?.version ?? '')}" placeholder="2026.1" style="max-width:200px" required>
    <label for="body">The declaration</label>
    <textarea id="body" name="body" rows="14" required>${esc(values?.body ?? current?.body ?? starter)}</textarea>
    ${current ? '' : '<p class="hint">This is plain starting wording. It is not legal advice, so have the federation\'s advisers read it before publishing.</p>'}
    <p><button class="btn" type="submit">Publish</button></p>
  </form>` });

const DOC_STATUS = { pending: ['wait', 'Waiting for your club'], accepted: ['ok', 'Accepted'], declined: ['no', 'Declined'] };

export const myDocuments = ({ me, csrf, how, person, certificates = [], consents = [], qualifications = [], receipts = [],
                             sent = [], choices = [], done = null, error = null }) => page({
  title: `${person.first_name} — documents`, me, csrf, body: `
  <h1>${esc(person.first_name)} ${esc(person.last_name)} — documents</h1>
  <p class="sub"><a href="/me">Back</a> · <a href="/me/${esc(person.id)}/record">Record</a> ·
    <a href="/me/${esc(person.id)}">Photograph and details</a></p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}

  <h2>Send a document to the club</h2>
  <form method="post" action="/me/${esc(person.id)}/documents" enctype="multipart/form-data" class="card">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <p class="hint">A first aid certificate, police vet, or anything else the club needs. Take a photograph of it or send a PDF.
      The club checks it and records it for ${how === 'self' ? 'you' : esc(person.first_name)}.</p>
    <label for="doc-kind">What is it?</label>
    <select id="doc-kind" name="qualificationId">
      ${choices.map((c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('')}
      <option value="">Something else</option>
    </select>
    <label for="doc-title">If something else, what? <span class="muted">(optional otherwise)</span></label>
    <input id="doc-title" name="title" maxlength="120">
    <div class="row">
      <div><label for="doc-on">Date it was issued</label><input id="doc-on" type="date" name="awardedOn"></div>
      <div><label for="doc-exp">Runs out <span class="muted">(if it says)</span></label><input id="doc-exp" type="date" name="expiresOn"></div>
    </div>
    <label for="doc-file">The file</label>
    <input id="doc-file" type="file" name="document" accept="image/png,image/jpeg,image/webp,application/pdf" required>
    <label for="doc-note">Anything the club should know <span class="muted">(optional)</span></label>
    <input id="doc-note" name="note" maxlength="300">
    <p><button class="btn" type="submit">Send</button></p>
  </form>

  ${sent.length ? `<h2>Sent to the club</h2><table><tbody>${sent.map((d) => `<tr>
    <td><a href="/p/${esc(person.id)}/document/${esc(d.id)}">${esc(d.title)}</a>
      <div class="muted">${esc(when(d.created_at))}${d.awarded_on ? ` · issued ${esc(d.awarded_on)}` : ''}</div></td>
    <td><span class="tag ${DOC_STATUS[d.status][0]}">${DOC_STATUS[d.status][1]}</span>
      ${d.review_note ? `<div class="muted">${esc(d.review_note)}</div>` : ''}</td></tr>`).join('')}</tbody></table>` : ''}

  <h2>Certificates</h2>
  ${certificates.length ? `<ul class="plain">${certificates.map((c) => `<li><a href="/p/${esc(person.id)}/certificate/${esc(c.id)}">${esc(c.label)}</a>
    <span class="muted">${esc(c.awarded_on)} · ${esc(c.certificate_no)}</span></li>`).join('')}</ul>` : '<p class="muted">None yet.</p>'}

  <h2>Qualifications</h2>
  ${qualifications.length ? `<table><tbody>${qualifications.map((a) => `<tr><td>${esc(a.label)}</td>
    <td>${esc(QUAL_WORDS[a.state] ?? a.state)}${a.expires_on ? ` · until ${esc(a.expires_on)}` : ''}</td></tr>`).join('')}</tbody></table>
    ` : '<p class="muted">None recorded yet. Send a certificate above and the club will record it.</p>'}

  <h2>Declarations signed</h2>
  ${consents.length ? consents.map((c) => `<details><summary><strong>${esc(c.title)}</strong>
    <span class="muted">${esc(when(c.accepted_at))} · version ${esc(c.version)} · agreed by ${esc(c.accepted_name)}${c.guardian ? ` (${esc(c.guardian.relationship ?? 'guardian')})` : ''}</span></summary>
    <div class="note" style="white-space:pre-wrap">${esc(c.consent_text ?? 'The text of this version is not kept with the event any more.')}</div></details>`).join('')
    : '<p class="muted">Nothing signed yet.</p>'}

  <h2>Receipts</h2>
  ${receipts.length ? `<table><tbody>${receipts.map((r) => `<tr><td>${esc(r.settled_at ? when(r.settled_at) : '')}</td><td>${esc(r.description ?? '')}</td>
    <td>${esc(cents(r.amount_cents, r.currency))}${taxNote(r.amount_cents, r.currency)}</td><td class="muted">${esc(r.receipt_no ?? '')} · ${esc(r.payee)}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">No payments yet.</p>'}` });

export const myClasses = ({ me, csrf, groups = [] }) => page({
  title: 'Classes', me, csrf, body: `
  <h1>Classes</h1>
  <p class="sub"><a href="/me">Back</a></p>
  ${groups.length ? groups.map((g) => `
  <h2>${esc(g.club)}${g.person ? ` <span class="muted">· ${esc(g.person.first_name)}</span>` : ''}</h2>
  ${g.next ? `<p>Next for ${esc(g.person.first_name)}: <strong>${g.next.daysAway === 0 ? 'today' : esc(g.next.weekdayName)} ${esc(g.next.starts)}</strong> — ${esc(g.next.label)}.</p>` : ''}
  ${g.sessions.length ? `<table><thead><tr><th>Day</th><th>Time</th><th>Class</th><th></th></tr></thead><tbody>${g.sessions.map((s) => `<tr>
    <td>${esc(DAY_NAMES_[s.weekday])}</td><td>${esc(s.starts)}–${esc(s.ends)}</td>
    <td>${esc(s.label)}${s.notes ? `<div class="muted">${esc(s.notes)}</div>` : ''}</td>
    <td>${s.forMe ? '<span class="tag ok">For you</span>' : '<span class="muted">Not for you</span>'}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">The club has not published a timetable.</p>'}`).join('')
  : '<div class="note">You are not on a club\'s roll, so there is no timetable to show.</div>'}
  ${groups.length ? [...new Map(groups.map((g) => [g.person.id, g.person])).values()].map((p) => `<p><a class="btn" href="/me/${esc(p.id)}/book">Book a class${groups.length > 1 ? ` for ${esc(p.first_name)}` : ''}</a></p>`).join('') : ''}` });

const DAY_NAMES_ = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];


// ---------------------------------------------------------------------------
// the digital card and class check-in
// ---------------------------------------------------------------------------

/**
 * One identity head for everybody: photograph (or initials), name, and chips for what they are.
 * The member's own card, the check an official sees, and the profile page all draw this, so a
 * person looks the same wherever they appear and the only difference between two people is the data.
 */
const identityCss = `
.idhead{display:flex;gap:14px;align-items:center;text-align:left}
.idphoto{width:84px;height:104px;border-radius:8px;object-fit:cover;flex:none;background:#3a3a3d}
.idphoto.none{display:flex;align-items:center;justify-content:center;font-size:1.8rem;font-weight:700;color:#bbb}
.idwho h2,.idwho h1{margin:0 0 4px}
.idchips{display:flex;gap:6px;flex-wrap:wrap;margin:0}
.idchip{display:inline-block;font-size:.75rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:2px 8px;border-radius:999px;border:1px solid currentColor}
`;
export const identityHead = ({ personId, name, hasPhoto = false, isInstructor = false, tag = 'h2' }) => {
  const initials = String(name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  return `<div class="idhead">
    ${hasPhoto ? `<img class="idphoto" src="/p/${esc(personId)}/photo" alt="Photograph of ${esc(name)}">`
               : `<div class="idphoto none" aria-hidden="true">${esc(initials)}</div>`}
    <div class="idwho"><${tag}>${esc(name)}</${tag}>
      <p class="idchips">${isInstructor ? '<span class="idchip">Instructor</span>' : ''}</p></div>
  </div>`;
};

const cardCss = `<style>${identityCss}
.idcard{max-width:340px;margin:16px auto;padding:20px;border-radius:14px;background:#1c1c1e;color:#fff;text-align:center}
.idcard .org{font-size:.8rem;letter-spacing:.12em;text-transform:uppercase;color:#f0ce41}
.idcard h2{margin:.4em 0 .1em;color:#fff}
.idcard .qr{background:#fff;border-radius:8px;padding:4px;margin:14px auto 6px;max-width:260px}
.idcard .qr svg{display:block;width:100%;height:auto}
.idcard p{margin:.25em 0}.idcard .muted{color:#bbb}
.idcard dl{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;text-align:left;margin:12px 0}
.idcard dt{color:#f0ce41;font-size:.8rem;text-transform:uppercase}.idcard dd{margin:0}
.bigverdict{font-size:1.6rem;font-weight:700;margin:.2em 0}
</style>`;

export const memberCard = ({ me, csrf, how, issued, reason, member, validThrough, svg, url }) => page({
  title: member ? `${member.name} — card` : 'Membership card', me, csrf, body: `${cardCss}
  <p class="sub"><a href="/me">Back</a></p>
  ${issued ? `<div class="idcard">
    <div class="org">${esc(member.federation)}</div>
    ${identityHead({ personId: member.id, name: member.name, hasPhoto: !!member.photo_asset_id, isInstructor: member.is_instructor })}
    <dl><dt>Number</dt><dd>${esc(member.display_number)}</dd>
      <dt>Club</dt><dd>${esc(member.club)}</dd>
      ${member.grade ? `<dt>Grade</dt><dd>${esc(member.grade)}</dd>` : ''}
      <dt>${member.fee_exempt ? 'Membership' : 'Paid until'}</dt><dd>${member.fee_exempt ? 'No fee' : esc(member.paid_until)}</dd></dl>
    <div class="qr">${svg}</div>
    <p class="muted">Show this at the door. This code works until ${esc(validThrough)} — open this page again for a fresh one.</p>
  </div>
  <p class="muted">${how === 'guardian' ? 'This is their card. Keep it on your own phone; it is not for printing.' : 'Keep this on your own phone rather than printing it.'}
    The code carries your number and nothing about you; an official who scans it while signed in sees who you are and whether you are current.</p>`
  : `<h1>Membership card</h1><div class="note">${esc(reason ?? 'No card is available.')}</div>`}` });

export const cardVerdict = ({ me, csrf, token, verdict, official, stale, federation, member }) => page({
  title: 'Card check', me, csrf, body: `${cardCss}
  <div style="max-width:420px;margin:16px auto;text-align:center">
    <div class="bigverdict" style="color:${verdict.ok ? '#0a7a2f' : '#b00020'}">${verdict.ok ? '✓ ' : '✗ '}${esc(verdict.headline)}</div>
    ${federation ? `<p class="muted">${esc(federation)}</p>` : ''}
    ${verdict.why ? `<p>${esc(verdict.why)}</p>` : ''}
    ${member ? `<div class="idcard" style="text-align:left">${identityHead({ personId: member.personId, name: member.name, hasPhoto: member.hasPhoto, isInstructor: member.isInstructor })}
      <dl><dt>Number</dt><dd>${esc(member.number)}</dd><dt>Club</dt><dd>${esc(member.club)}</dd>
      ${member.grade ? `<dt>Grade</dt><dd>${esc(member.grade)}</dd>` : ''}
      <dt>${member.exempt ? 'Membership' : 'Paid until'}</dt><dd>${member.exempt ? 'No fee' : esc(member.paidUntil)}</dd></dl></div>
      ${member.hasPhoto ? '' : '<p class="muted">No photograph on their record.</p>'}
      <p><a href="/p/${esc(member.personId)}">Open their record</a></p>`
    : me ? '<p class="muted">You are not an official of this member\'s club, so you only see whether the code is good.</p>'
         : `<p class="muted">Officials: <a href="/signin?next=${encodeURIComponent('/v/' + token)}">sign in</a> to see who this is.</p>`}
    ${stale && member ? '<div class="note">Their grade has changed since this code was made. Go by the record above.</div>' : ''}
  </div>` });

export const checkinCode = ({ me, csrf, org, session, date, here, svg, refresh }) => page({
  title: `${session.label} — check-in`, me, csrf, head: `<meta http-equiv="refresh" content="${refresh}">`, body: `${cardCss}
  <p><a href="/o/${esc(org.slug)}/attendance?date=${esc(date)}">← Attendance</a></p>
  <h1>${esc(session.label)}</h1>
  <p class="sub">${esc(session.starts)}–${esc(session.ends)} · ${esc(date)}</p>
  <div style="max-width:420px;margin:0 auto;text-align:center">
    <div class="qr" style="background:#fff;padding:8px;border-radius:8px">${svg}</div>
    <p><strong>Scan to check in</strong></p>
    <p class="muted">${here} checked in so far. This code changes every minute, so a photo of it is no use to someone at home.
      Keep this page open on the tablet; it refreshes itself.</p>
  </div>` });

export const checkinScreen = ({ me, csrf, token, expired, session, date, people = [], came = null, error }) => page({
  title: 'Check in', me, csrf, body: expired
  ? `<h1>Check in</h1><div class="note">That code has run out. Scan the screen at the front of the class again.</div>`
  : `<h1>${esc(session.label)}</h1>
  <p class="sub">${esc(session.club)} · ${esc(session.starts)}–${esc(session.ends)}</p>
  ${came ? `<div class="good">${came.length ? `Checked in: ${came.map(esc).join(', ')}.` : 'Nobody new to check in.'}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${people.some((p) => p.state === 'can') ? `<form method="post" action="/checkin/${esc(token)}">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <fieldset><legend>Who is here?</legend>
    ${people.map((p) => p.state === 'can'
      ? `<label class="check"><input type="checkbox" name="here_${esc(p.id)}" value="1" checked> ${esc(p.name)}</label>`
      : `<p class="muted"><s>${esc(p.name)}</s> — ${esc(p.reason)}</p>`).join('')}
    </fieldset>
    <div class="actions"><button class="btn" type="submit">Check in</button></div></form>`
  : `<fieldset><legend>Who is here?</legend>${people.map((p) => `<p>${p.state === 'here' ? '✓ ' : ''}${esc(p.name)} <span class="muted">— ${esc(p.reason)}</span></p>`).join('')
      || '<p class="muted">Nobody on your account is on this club\'s roll.</p>'}</fieldset>`}` });


// ---------------------------------------------------------------------------
// adult free trials and referrals
// ---------------------------------------------------------------------------

const WAIVER = 'I have read and accept the club\'s waiver. I understand martial arts training involves physical contact and a risk of injury, I am fit to train, and the details I have given are true.';

export const trialPage = ({ csrf, offer, values = {}, error, action, code = '', friend = '' }) => page({
  title: `${offer.name} — free month`, me: null, csrf, body: `
  <h1>${esc(offer.name)}</h1>
  <p class="sub">${friend ? `${esc(friend)} thought you would enjoy this. ` : ''}Your first ${offer.days} days are free. Come to any class that suits you.</p>
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  <form method="post" action="${esc(action)}">
    <div style="position:absolute;left:-9999px" aria-hidden="true"><label>Leave this empty <input name="website" tabindex="-1" autocomplete="off"></label></div>
    <label for="firstName">First name</label><input id="firstName" name="firstName" maxlength="60" required autocomplete="given-name" value="${esc(values.firstName ?? '')}">
    <label for="lastName">Last name</label><input id="lastName" name="lastName" maxlength="60" required autocomplete="family-name" value="${esc(values.lastName ?? '')}">
    <label for="email">Email</label><input id="email" name="email" type="email" maxlength="120" required autocomplete="email" value="${esc(values.email ?? '')}">
    <label for="phone">Mobile</label><input id="phone" name="phone" maxlength="30" required autocomplete="tel" value="${esc(values.phone ?? '')}">
    <label for="dateOfBirth">Date of birth <span class="muted">(1988-03-14)</span></label>
    <input id="dateOfBirth" name="dateOfBirth" maxlength="10" required inputmode="numeric" value="${esc(values.dateOfBirth ?? '')}">
    <fieldset><legend>In an emergency</legend>
      <label for="emergencyName">Name</label><input id="emergencyName" name="emergencyName" maxlength="80" required value="${esc(values.emergencyName ?? '')}">
      <label for="emergencyPhone">Phone</label><input id="emergencyPhone" name="emergencyPhone" maxlength="30" required value="${esc(values.emergencyPhone ?? '')}">
    </fieldset>
    <label for="medical">Anything the instructor should know — injuries, asthma, allergies <span class="muted">(optional)</span></label>
    <textarea id="medical" name="medical" rows="3" maxlength="1000">${esc(values.medical ?? '')}</textarea>
    <label for="code">Invited by a member? Their code <span class="muted">(optional)</span></label>
    <input id="code" name="code" maxlength="12" value="${esc(values.code ?? code)}" autocomplete="off">
    <label class="check"><input type="checkbox" name="accepted" value="1"${values.accepted ? ' checked' : ''}> ${esc(WAIVER)}</label>
    <div class="actions"><button class="btn" type="submit">Start my free month</button></div>
  </form>` });

// The same words whether or not we already knew them, so this page cannot be used to find out who is on the register.
export const trialThanks = ({ club, days }) => page({
  title: `${club} — free month`, me: null, body: `
  <h1>${esc(club)}</h1>
  <div class="good"><strong>Check your email.</strong>
    A sign-in link is on its way. Through it you can see the timetable and check in to classes${days ? `; your ${days} days start today if you are new to us` : ''}.</div>
  <p class="muted">The link works once and expires in 15 minutes.</p>` });

export const referralLanding = ({ friend, club, days, reward, code, slug }) => page({
  title: `${club} — an invitation`, me: null, body: `
  <h1>${esc(friend)} invited you to ${esc(club)}</h1>
  <p class="sub">Try it free for ${days} days${reward ? ` — and when you join you get ${esc(reward)}` : ''}.</p>
  <p><a class="btn" href="/trial/${esc(slug)}?ref=${esc(code)}">Start my free month</a></p>` });

export const referPage = ({ me, csrf, eligible, reason, club, code, offer, referred, days, rows = [], rewards = [], svg, link }) => page({
  title: 'Refer a friend', me, csrf, body: `${cardCss}
  <h1>Refer a friend</h1>
  <p class="sub"><a href="/me">Back</a></p>
  ${!eligible ? `<div class="note">${esc(reason)}</div>` : `
  <p>Friends you invite get ${days} days free at ${esc(club)}. When one of them joins${offer ? `, you receive <strong>${esc(offer)}</strong>` : ''}${referred ? ` and they receive ${esc(referred)}` : ''}.</p>
  <div class="idcard"><div class="org">Your invitation</div>
    <div class="qr">${svg}</div>
    <p style="font-size:1.4rem;letter-spacing:.2em"><strong>${esc(code)}</strong></p>
    <p class="muted" style="word-break:break-all">${esc(link)}</p></div>
  <p class="muted">Show the code, or let them scan it. They can also type the code when they sign up.</p>
  <h2>Who you have invited</h2>
  ${rows.length ? `<table><tbody>${rows.map((r) => `<tr><td>${esc(r.first_name)}</td><td class="muted">${esc(r.when)}</td>
    <td>${esc(REFERRAL_WORDS[r.status] ?? r.status)}${r.note && r.status !== 'rewarded' ? ` <span class="muted">${esc(r.note)}</span>` : ''}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">Nobody yet.</p>'}
  <h2>Your rewards</h2>
  ${rewards.length ? `<table><tbody>${rewards.map((w) => `<tr><td>${esc(w.text)}</td><td class="muted">${esc(w.when)}</td>
    <td>${w.status === 'given' ? 'Given' : 'The club will arrange it'}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">None yet.</p>'}`}` });

const REFERRAL_WORDS = { trial: 'On their free month', member: 'Joined', rewarded: 'Joined — reward earned', void: 'Not counted' };

export const joinPage = ({ me, csrf, trial, options = [], error }) => page({
  title: 'Join', me, csrf, body: `
  <h1>Join ${esc(trial.club)}</h1>
  <p class="sub"><a href="/me">Back</a></p>
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  <p>${trial.status === 'trialling' ? `Your free month runs until ${esc(trial.ends)}. Whatever you choose, your membership carries on from the day it ends.`
      : 'Your free month has ended. Choose how you would like to join.'}</p>
  ${options.length ? `<form method="post"><input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <fieldset><legend>How would you like to pay?</legend>
    ${options.map((o, i) => `<label class="check"><input type="radio" name="period" value="${esc(o.period)}"${i === 0 ? ' checked' : ''}>
      ${esc(o.fee.label)} — ${esc(cents(o.fee.amount_cents, o.fee.currency))} <span class="muted">${esc(o.label.toLowerCase())}</span></label>`).join('')}
    </fieldset><div class="actions"><button class="btn" type="submit">Continue to payment</button></div></form>`
    : '<div class="note">The club has not published its prices yet. Please ask them how to join.</div>'}` });

const GROWTH_KIND_OPTIONS = (sel) => Object.entries(REWARD_KINDS_).map(([k, v]) => `<option value="${k}"${sel === k ? ' selected' : ''}>${esc(v)}</option>`).join('');
import { REWARD_KINDS as REWARD_KINDS_ } from '../core/domain/growth.mjs';

export const growthScreen = ({ me, csrf, org, settings, trials = [], referrals = [], owed = [], top = [], report, offer, canManage, done, error, origin }) => {
  const rf = (p, r) => `<fieldset><legend>${p === 'referrer' ? 'The member who invited them gets' : 'The new member gets (optional)'}</legend>
    <select name="${p}_kind">${GROWTH_KIND_OPTIONS(r.kind)}</select>
    <label>Weeks <input name="${p}_weeks" value="${r.weeks || ''}" size="3" inputmode="numeric"></label>
    <label>Amount $ <input name="${p}_amount" value="${r.cents ? (r.cents / 100) : ''}" size="6" inputmode="decimal"></label>
    <label>What <input name="${p}_note" value="${esc(r.note)}" maxlength="120"></label>
    <p class="muted">Free weeks are added to their membership automatically. Anything else is listed below until somebody hands it over.</p></fieldset>`;
  return page({
    title: `${org.name} — trials and referrals`, me, csrf, body: `
  <h1>Trials and referrals</h1>
  <p class="sub">Adults try a month free, join, and bring friends. Every trial is a real person on your register.</p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${settings.trial.enabled ? `<div class="note">Share this link on your website and social media: <strong>${esc(origin)}/trial/${esc(org.slug)}</strong></div>` : ''}

  <h2>How it is going</h2>
  <div class="row">
    <div><strong>${report.started}</strong> trials started</div>
    <div><strong>${report.trialling}</strong> trialling now</div>
    <div><strong>${report.converted}</strong> joined${report.conversion != null ? ` (${report.conversion}% of finished trials)` : ''}</div>
    <div><strong>${report.referrals}</strong> referrals</div>
    <div><strong>${report.referralMembers}</strong> became members</div>
    <div><strong>${report.rewarded}</strong> rewards earned</div>
    <div><strong>${esc(cents(report.revenueCents, region().currency))}</strong> paid by referred members</div>
  </div>
  ${top.length ? `<p class="muted">Top referrers: ${top.map((t) => `${esc(t.name)} (${t.n})`).join(', ')}.</p>` : ''}

  ${owed.length ? `<h2>Rewards to hand over</h2><table><tbody>${owed.map((w) => `<tr><td>${esc(w.name)} <span class="muted">${esc(w.display_number ?? '')}</span></td><td>${esc(w.text)}</td>
    <td><form method="post" action="/o/${esc(org.slug)}/growth/rewards/${esc(w.id)}/given"><input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
      <button class="btn quiet" type="submit">Mark as given</button></form></td></tr>`).join('')}</tbody></table>` : ''}

  <h2>Free trials</h2>
  ${trials.length ? `<table><thead><tr><th>Who</th><th>Started</th><th>Ends</th><th>Classes</th><th>Status</th></tr></thead><tbody>${trials.map((t) => `<tr>
    <td>${esc(t.name)}${t.source === 'referral' ? ' <span class="tag ok">referred</span>' : ''}<div class="muted">${esc(t.email ?? '')} ${esc(t.phone ?? '')}</div></td>
    <td>${esc(t.starts)}</td><td>${esc(t.ends)}${t.left != null ? ` <span class="muted">(${t.left < 0 ? 'ended' : t.left + ' days left'})</span>` : ''}</td>
    <td>${t.classes}</td><td>${esc({ trialling: 'Trialling', converted: 'Joined', ended: 'Ended' }[t.status])}${t.display_number ? ` <span class="muted">${esc(t.display_number)}</span>` : ''}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">No trials yet.</p>'}

  <h2>Referrals</h2>
  ${referrals.length ? `<table><thead><tr><th>Invited by</th><th>Friend</th><th>When</th><th>Where it is</th></tr></thead><tbody>${referrals.map((r) => `<tr>
    <td>${esc(r.referrer)}</td><td>${esc(r.referred)}</td><td>${esc(r.when)}</td>
    <td>${esc(REFERRAL_WORDS[r.status] ?? r.status)}${r.note ? ` <span class="muted">${esc(r.note)}</span>` : ''}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">No referrals yet.</p>'}

  <h2>What you offer</h2>
  ${canManage ? `<form method="post" action="/o/${esc(org.slug)}/growth/settings">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <fieldset><legend>Free trial for adults</legend>
      <label class="check"><input type="checkbox" name="trial_enabled" value="1"${settings.trial.enabled ? ' checked' : ''}> Offer a free trial on the website</label>
      <label>Days free <input name="trial_days" value="${settings.trial.days}" size="3" inputmode="numeric"></label>
      <label>Youngest allowed <input name="trial_min_age" value="${settings.trial.minAge}" size="3" inputmode="numeric"></label>
    </fieldset>
    <fieldset><legend>Referrals</legend>
      <label class="check"><input type="checkbox" name="referral_enabled" value="1"${settings.referral.enabled ? ' checked' : ''}> Members can invite friends</label>
      <label>Classes the friend must attend before the reward <input name="min_classes" value="${settings.referral.minClasses}" size="3" inputmode="numeric"></label>
      <label>Most rewards one member can earn in a year <input name="max_per_year" value="${settings.referral.maxPerYear}" size="3" inputmode="numeric"></label>
      ${rf('referrer', settings.referral.referrer)}${rf('referred', settings.referral.referred)}
    </fieldset>
    <div class="actions"><button class="btn" type="submit">Save</button></div></form>`
  : '<p class="muted">An administrator sets these.</p>'}` });
};


// ---------------------------------------------------------------------------
// school terms
// ---------------------------------------------------------------------------

const TERM_STATE = { upcoming: 'Not open yet', open: 'Enrolment open', current: 'Running', closed: 'Enrolment closed', ended: 'Finished' };
import { MID_TERM } from '../core/domain/terms.mjs';

export const termsScreen = ({ me, csrf, org, today, country, years = [], midTerm, isClub, current, next, holiday, calendar, canManage, done, error }) => page({
  title: `${org.name} — school terms`, me, csrf, body: `
  <h1>School terms</h1>
  <p class="sub">Children enrol class by class for each school term. Terms are set once, for a whole country or federation, and every club beneath uses them.</p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}${error ? `<div class="bad">${esc(error)}</div>` : ''}
  <p>${current ? `Right now: <strong>${esc(current.name)}</strong> (to ${esc(current.ends)}).` : holiday ? `Right now: <strong>school holidays</strong> until ${esc(holiday.to)}.` : 'No term is running today.'}
    ${next ? ` Next: <strong>${esc(next.name)}</strong> starts ${esc(next.starts)}.` : ''}</p>
  ${years.map((y) => `<h2>${y.year}</h2>
    ${y.terms.length ? `<p class="muted">${y.inherited ? `Inherited from ${esc(y.owner.name)}.` : `Set here${y.terms[0].source === 'built-in' ? ` from the ${esc(calendar?.name ?? 'built-in')} calendar` : ''}.`}</p>
    <table><thead><tr><th>Term</th><th>Starts</th><th>Ends</th><th>State</th>${isClub ? '<th>Enrolled</th>' : ''}<th></th></tr></thead><tbody>${y.terms.map((t) => `<tr>
      <td>${esc(t.name)}</td><td>${esc(t.starts)}</td><td>${esc(t.ends)}</td><td>${esc(TERM_STATE[t.state] ?? t.state)}</td>
      ${isClub ? `<td>${t.n}${t.n ? ` <span class="muted">(${t.paid} paid)</span>` : ''}</td>` : ''}
      <td>${isClub ? `<a href="/o/${esc(org.slug)}/terms/${esc(t.id)}">Who</a>` : ''}
        ${canManage && !y.inherited ? `<form method="post" action="/o/${esc(org.slug)}/terms/${esc(t.id)}/remove" style="display:inline"><input type="hidden" name="_csrf" value="${esc(csrf ?? '')}"><button class="btn quiet" type="submit">Remove</button></form>` : ''}</td></tr>`).join('')}</tbody></table>
    ${y.holidays.length ? `<p class="muted">Holidays: ${y.holidays.map((h) => `${esc(h.from)} to ${esc(h.to)}`).join(' · ')}</p>` : ''}
    ${calendar?.note && y.terms[0]?.source === 'built-in' ? `<p class="muted">${esc(calendar.note)} Source: ${esc(calendar.source)}.</p>` : ''}`
    : `<div class="note">No terms for ${y.year} yet.${y.builtIn ? ` The ${esc(y.builtIn.name)} calendar is available.` : country ? ` There is no built-in calendar for ${esc(country)}: add the terms below once and every club beneath will use them.` : ''}</div>`}
    ${canManage && y.builtIn && !(y.terms.length && !y.inherited) ? `<form method="post" action="/o/${esc(org.slug)}/terms/load"><input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
      <input type="hidden" name="year" value="${y.year}"><button class="btn" type="submit">Use the ${esc(y.builtIn.name)} calendar for ${y.year}</button></form>` : ''}`).join('')}
  ${canManage ? `<h2>Add a term</h2><form method="post" action="/o/${esc(org.slug)}/terms">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <label for="name">Name</label><input id="name" name="name" maxlength="40" placeholder="Term 1" required>
    <label for="starts">First day <span class="muted">(2027-02-01)</span></label><input id="starts" name="starts" maxlength="10" required>
    <label for="ends">Last day</label><input id="ends" name="ends" maxlength="10" required>
    <div class="actions"><button class="btn" type="submit">Add term</button></div></form>
    <p class="muted">Terms added here are used by this organisation and everything beneath it.</p>` : ''}
  ${isClub ? `<h2>Joining part-way through a term</h2>
    ${canManage ? `<form method="post" action="/o/${esc(org.slug)}/terms/rule"><input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
      <select name="mid_term">${Object.entries(MID_TERM).map(([k, v]) => `<option value="${k}"${midTerm.mode === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>
      <label>Reduced price $ <input name="fixed" value="${midTerm.fixedCents ? midTerm.fixedCents / 100 : ''}" size="6"></label>
      <button class="btn" type="submit">Save</button></form>` : `<p>${esc(MID_TERM[midTerm.mode])}</p>`}
    <p class="muted">The full-term price is your junior “Per term” price on the <a href="/o/${esc(org.slug)}/renewals">Renewals</a> screen. With no price set, enrolment is free.</p>` : ''}` });

export const termRoster = ({ me, csrf, org, term, rows = [] }) => page({
  title: `${term.name} — enrolled`, me, csrf, body: `
  <p><a href="/o/${esc(org.slug)}/terms">← School terms</a></p>
  <h1>${esc(term.name)} ${esc(term.year)}</h1><p class="sub">${esc(term.starts)} to ${esc(term.ends)}</p>
  ${rows.length ? `<table><thead><tr><th>Child</th><th>Age</th><th>Enrolled</th><th>Price</th><th></th></tr></thead><tbody>${rows.map((r) => `<tr>
    <td><a href="/p/${esc(r.person_id)}">${esc(r.name)}</a></td><td>${r.age ?? ''}</td><td>${esc(r.enrolled_on)}</td>
    <td>${esc(cents(r.fee_cents, region().currency))}${r.price_note && r.price_note !== 'The full term' ? ` <span class="muted">${esc(r.price_note)}</span>` : ''}</td>
    <td>${r.status === 'withdrawn' ? 'Withdrawn' : r.paid ? '<span class="tag ok">Paid</span>' : '<span class="tag wait">Not paid</span>'}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">Nobody is enrolled yet.</p>'}` });

export const myTerms = ({ me, csrf, groups = [], error, done }) => page({
  title: 'Term enrolment', me, csrf, body: `
  <h1>Term enrolment</h1><p class="sub"><a href="/me">Back</a></p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${groups.some((g) => g.items.length) ? groups.filter((g) => g.items.length).map((g) => `<h2>${esc(g.person.first_name)} <span class="muted">· ${esc(g.club)}</span></h2>
    <table><tbody>${g.items.map((i) => `<tr><td><strong>${esc(i.term.name)}</strong> ${esc(i.term.year)}<div class="muted">${esc(i.term.starts)} to ${esc(i.term.ends)}</div></td>
      <td>${i.enrolment?.status === 'enrolled' ? `<span class="tag ok">Enrolled</span>${i.enrolment.paid ? '' : ' <span class="tag wait">Not paid</span>'}`
        : i.mayEnrol ? `${i.price.cents ? esc(cents(i.price.cents, region().currency)) : 'Free'} <span class="muted">${esc(i.price.note)}</span>`
        : i.state === 'upcoming' ? '<span class="muted">Opens soon</span>' : '<span class="muted">Not available</span>'}</td>
      <td>${i.mayEnrol ? `<form method="post" action="/me/terms/${esc(i.term.id)}/${esc(g.person.id)}"><input type="hidden" name="_csrf" value="${esc(csrf ?? '')}"><button class="btn" type="submit">Enrol</button></form>`
        : i.enrolment?.status === 'enrolled' && i.state !== 'current' ? `<form method="post" action="/me/terms/${esc(i.term.id)}/${esc(g.person.id)}/withdraw"><input type="hidden" name="_csrf" value="${esc(csrf ?? '')}"><button class="btn quiet" type="submit">Withdraw</button></form>` : ''}</td></tr>`).join('')}</tbody></table>`).join('')
  : '<div class="note">There are no school terms to enrol in. They appear here for children who are members of a club that follows school terms.</div>'}` });

/**
 * A club's photo gallery: add many at once, file them by year and event, and tidy them in bulk.
 * Works without a script; the script (served from this site) shrinks big photos and sends them one at a time.
 */
export const galleryScreen = ({ me, csrf, org, items = [], total = 0, years = [], events = [], filter = {}, library = [], max = 300,
                                done, error, rebuild }) => {
  const base = `/o/${esc(org.slug)}/gallery`;
  const nowYear = new Date().getFullYear();
  const day = (d) => new Date(d).toLocaleDateString(region().locale, { day: 'numeric', month: 'short', year: 'numeric' });
  const eventOptions = (selected, { keep = false } = {}) =>
    (keep ? '<option value="">— leave as it is —</option>' : '<option value="">No event</option>')
    + (keep ? '<option value="none">Take out of its event</option>' : '')
    + events.map((e) => `<option value="${esc(e.id)}"${selected === e.id ? ' selected' : ''}>${esc(e.title)} · ${esc(day(e.starts_at))}</option>`).join('');

  // Group: year, then event.
  const groups = [];
  for (const g of items) {
    const key = `${g.year ?? ''}`;
    let y = groups.find((x) => x.key === key);
    if (!y) groups.push(y = { key, year: g.year, events: [] });
    const ek = g.event_id ?? '';
    let e = y.events.find((x) => x.key === ek);
    if (!e) y.events.push(e = { key: ek, title: g.event_title ?? null, pics: [] });
    e.pics.push(g);
  }

  const card = (g, flat, i) => `
    <div class="card">
      <label class="check" style="margin:0 0 8px"><input type="checkbox" name="pick_${esc(g.id)}" form="bulk"> Select</label>
      <img src="/a/${esc(g.asset_id)}" alt="${esc(g.alt_text ?? '')}" loading="lazy" style="max-width:100%;height:auto;display:block;margin-bottom:8px">
      <form method="post" action="${base}/${esc(g.id)}/details">
        <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
        <input name="caption" maxlength="160" value="${esc(g.caption ?? '')}" placeholder="Caption" aria-label="Caption">
        <div class="row" style="margin-top:6px">
          <div><input name="year" type="number" min="1950" max="${nowYear + 1}" value="${esc(g.year ?? '')}" aria-label="Year"></div>
          <div><select name="eventId" aria-label="Event">${eventOptions(g.event_id, { keep: true })}</select></div>
        </div>
        <button class="btn quiet" type="submit" style="margin-top:6px">Save</button>
      </form>
      <p style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
        ${['up', 'down'].map((d) => `<form method="post" action="${base}/${esc(g.id)}/move">
          <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}"><input type="hidden" name="direction" value="${d}">
          <button class="btn quiet" type="submit"${(d === 'up' && i === 0) || (d === 'down' && i === flat.length - 1) ? ' disabled' : ''}>${d === 'up' ? 'Earlier' : 'Later'}</button></form>`).join('')}
        <form method="post" action="${base}/${esc(g.id)}/remove">
          <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}"><button class="btn quiet" type="submit">Remove</button></form>
      </p>
    </div>`;

  return page({ title: `Gallery — ${org.name}`, me, csrf, body: `
  <h1>Gallery</h1>
  <p class="sub">${esc(org.name)} · your photos, by year and event. ${total} of ${max}.
    <a href="/o/${esc(org.slug)}/club-page/preview">See your page</a></p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${rebuild ? `<div class="note">${esc(rebuild)}</div>` : ''}

  <form method="post" action="${base}" enctype="multipart/form-data" class="card" style="margin-bottom:24px" data-gallery-upload>
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <h3>Add pictures</h3>
    <p><label>Choose as many as you like<br>
      <input type="file" name="file" multiple accept="image/png,image/jpeg,image/gif,image/webp"></label></p>
    <p class="hint">Big phone photos are made smaller for you before they are sent. ${esc(slotHint('gallery'))}</p>
    <div class="row">
      <div><label for="g-year">Year <span class="muted">for all of these</span></label>
        <input id="g-year" name="year" type="number" min="1950" max="${nowYear + 1}" value="${nowYear}" style="max-width:120px"></div>
      <div><label for="g-event">Event <span class="muted">optional</span></label>
        <select id="g-event" name="eventId">${eventOptions('')}</select></div>
    </div>
    ${library.length ? `<p><label>…or one you have already uploaded<br>
      <select name="assetId"><option value="">—</option>${library.map((a) =>
        `<option value="${esc(a.id)}">${esc(a.filename ?? a.id)}</option>`).join('')}</select></label></p>` : ''}
    <p><label>Caption <span class="muted">optional, when adding just one</span><br>
      <input name="caption" maxlength="160" style="max-width:420px" placeholder="Juniors after a grading"></label></p>
    <p><label>Describe it for somebody who cannot see it <span class="muted">optional</span><br>
      <input name="alt_text" maxlength="300" style="max-width:560px"></label></p>
    <p class="muted">Only photographs you have permission to show, especially of children.</p>
    <p><button class="btn" type="submit">Add to gallery</button></p>
    <ul id="upload-progress" class="plain" aria-live="polite"></ul>
  </form>
  <form id="upload-finish" method="post" action="${base}/done" hidden class="card">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <p>Pictures are in. Update the website so they appear.</p>
    <button class="btn" type="submit">Finish and update the website</button>
  </form>

  ${total ? `<form method="get" action="${base}" class="card" style="margin-bottom:16px">
    <p style="margin:0 0 8px"><strong>Show</strong>
      <a href="${base}"${!filter.year && !filter.eventId ? ' aria-current="page"' : ''}>All</a>
      ${years.map((y) => ` · <a href="${base}?year=${y.year}"${filter.year === y.year ? ' aria-current="page"' : ''}>${y.year} <span class="muted">(${y.n})</span></a>`).join('')}</p>
    <div class="row" style="align-items:end">
      <div><label for="f-event">One event</label>
        <select id="f-event" name="event"><option value="">All events</option>${eventOptions(filter.eventId).replace('<option value="">No event</option>', '')}</select></div>
      <div><button class="btn quiet" type="submit">Show</button></div>
    </div>
  </form>` : ''}

  ${items.length ? `
  <form id="bulk" method="post" action="${base}/bulk" class="card" style="margin-bottom:16px">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <h3>Tidy several at once</h3>
    <p class="muted">Tick the pictures below, then file them or remove them.</p>
    <div class="row" style="align-items:end">
      <div><label for="b-year">Year</label>
        <input id="b-year" name="year" type="number" min="1950" max="${nowYear + 1}" placeholder="leave as it is"></div>
      <div><label for="b-event">Event</label><select id="b-event" name="eventId">${eventOptions('', { keep: true })}</select></div>
    </div>
    <p style="margin-top:12px"><button class="btn" type="submit" name="action" value="file">File the ticked ones</button>
      <button class="btn quiet" type="submit" name="action" value="remove">Remove the ticked ones</button></p>
  </form>` : ''}

  ${groups.map((y) => `
    <h2>${y.year ?? 'No year'}</h2>
    ${y.events.map((e) => `
      <h3 style="margin:18px 0 8px">${e.title ? esc(e.title) : 'Not part of an event'} <span class="muted">${e.pics.length}</span></h3>
      <div class="grid">${e.pics.map((g) => card(g, e.pics, e.pics.indexOf(g))).join('')}</div>`).join('')}`).join('')}
  ${!items.length ? `<p class="muted">${total ? 'Nothing matches that.' : 'No pictures yet. The gallery shows on your page once it has one.'}</p>` : ''}
  <script src="/vendor/gallery-upload.js" defer></script>
`, });
};


// ---------------------------------------------------------------------------
// forms and consent
// ---------------------------------------------------------------------------

const FORM_STATUS = { draft: 'Not published', published: 'Published', archived: 'Archived' };
const formTok = (csrf) => `<input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">`;
const optText = (opts) => (opts ?? []).join('\n');

export const formList = ({ me, csrf, org, rows = [], inherited = [], starters = {}, canManage = false, done, error }) => {
  const tok = formTok(csrf), base = `/o/${esc(org.slug)}`;
  return page({ title: `${org.name} — forms`, me, csrf, body: `
  <h1>Forms and consent</h1>
  <p class="sub">Waivers, photo consent and medical forms. People sign once, or again every so many months, and you can see who has not.</p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${rows.length ? `<table><thead><tr><th>Form</th><th>Kind</th><th>Status</th><th>Signed</th></tr></thead><tbody>${rows.map((f) => `<tr>
    <td><a href="${base}/forms/${esc(f.id)}">${esc(f.title)}</a></td><td>${esc(KIND_WORDS[f.kind] ?? f.kind)}</td>
    <td><span class="tag ${f.status === 'published' ? 'ok' : 'wait'}">${esc(FORM_STATUS[f.status])}</span></td><td>${f.signed}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">No forms yet.</p>'}
  ${inherited.length ? `<h2>From the organisation above</h2><ul>${inherited.map((f) => `<li>${esc(f.title)} <span class="muted">(${esc(f.org_name)})</span></li>`).join('')}</ul>` : ''}
  ${canManage ? `<h2>Start a form</h2>
  <form method="post" action="${base}/forms">${tok}
    <p>${Object.entries(starters).map(([k, s]) => `<button class="btn quiet" name="starter" value="${esc(k)}" type="submit">${esc(s.title)}</button>`).join(' ')}</p></form>
  <form method="post" action="${base}/forms">${tok}<p><label>Or start from blank: <input name="title" maxlength="120" placeholder="Form title"></label>
    <button class="btn" type="submit">Create</button></p></form>` : ''}` });
};
const EVENT_KIND_WORDS = { grading: 'Grading', tournament: 'Tournament', camp: 'Training camp', seminar: 'Seminar', fight_night: 'Fight night', training: 'Training', social: 'Social', other: 'Event' };
const KIND_WORDS = { waiver: 'Waiver', consent: 'Consent', medical: 'Medical', other: 'Other' };
const TYPE_WORDS = { agree: 'A statement to agree to (a tick)', text: 'Short answer', longtext: 'Long answer', choice: 'Pick one', checkboxes: 'Pick any', date: 'Date' };
/** The fee categories, with the age of adulthood that applies here in the junior label. */
const feeCategories = () => ({ ...FEE_CATEGORIES, junior: `Juniors (under ${region().adultAge})` });
const audWords = () => ({ all: 'Everyone on the roll', juniors: `Juniors (under ${region().adultAge})`, seniors: `Seniors (${region().adultAge} and over)` });
const sel = (name, words, cur) => `<select name="${/* security-ok: name is a developer-chosen field name, never request data */ name}">${Object.entries(words).map(([k, w]) => `<option value="${esc(k)}"${k === cur ? ' selected' : ''}>${esc(w)}</option>`).join('')}</select>`;

export const formEditor = ({ me, csrf, org, form: f, canManage = false, done, error }) => {
  const tok = formTok(csrf), base = `/o/${esc(org.slug)}/forms/${esc(f.id)}`;
  const fieldForm = (q) => `<form method="post" action="${base}/fields${q ? `/${esc(q.id)}` : ''}">${tok}
    <p><label>Question or statement<br><textarea name="label" rows="2" maxlength="1000" required>${esc(q?.label ?? '')}</textarea></label></p>
    <p><label>Type ${sel('type', TYPE_WORDS, q?.type ?? 'agree')}</label>
       <label><input type="checkbox" name="required"${q?.required ? ' checked' : ''}> Must be answered</label></p>
    <p><label>Choices (one per line, for the pick types)<br><textarea name="options" rows="3">${esc(optText(q?.options))}</textarea></label></p>
    <button class="btn${q ? ' quiet' : ''}" type="submit">${q ? 'Save question' : 'Add question'}</button></form>`;
  return page({ title: `${f.title} — form`, me, csrf, body: `
  <p><a href="/o/${esc(org.slug)}/forms">&larr; Forms</a></p>
  <h1>${esc(f.title)} <span class="tag ${f.status === 'published' ? 'ok' : 'wait'}">${esc(FORM_STATUS[f.status])}</span></h1>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}${error ? `<div class="bad">${esc(error)}</div>` : ''}
  <p><a href="${base}/status">Who has signed</a></p>
  ${canManage ? `<form method="post" action="${base}">${tok}
    <p><label>Title <input name="title" value="${esc(f.title)}" maxlength="120" required></label></p>
    <p><label>Kind ${sel('kind', KIND_WORDS, f.kind)}</label> <label>Asked of ${sel('audience', audWords(), f.audience)}</label>
       <label>Ask again every <input name="renewMonths" type="number" min="1" max="60" value="${esc(f.renew_months ?? '')}" style="width:4em"> months (blank = once)</label></p>
    <p><label>Introduction<br><textarea name="intro" rows="3" maxlength="3000">${esc(f.intro ?? '')}</textarea></label></p>
    <button class="btn" type="submit">Save details</button></form>` : ''}
  <h2>Questions (${/* security-ok: a number: the count of fields */ f.fields.length})</h2>
  ${f.fields.map((q, i) => `<div class="card"><p><strong>${i + 1}.</strong> ${esc(q.label)} <span class="muted">— ${esc(TYPE_WORDS[q.type])}${q.required ? ', required' : ''}</span></p>
    ${q.options?.length ? `<p class="muted">${q.options.map(esc).join(' · ')}</p>` : ''}
    ${canManage ? `<details><summary>Edit</summary>${fieldForm(q)}</details>
    <form method="post" action="${base}/fields/${esc(q.id)}/move" style="display:inline">${tok}<button class="btn quiet" name="dir" value="up" type="submit">Up</button>
      <button class="btn quiet" name="dir" value="down" type="submit">Down</button></form>
    <form method="post" action="${base}/fields/${esc(q.id)}/remove" style="display:inline">${tok}<button class="btn quiet" type="submit">Remove</button></form>` : ''}</div>`).join('')}
  ${canManage ? `<h3>Add a question</h3>${fieldForm(null)}
  <h2>Publishing</h2>
  <form method="post" action="${base}/status">${tok}
    ${f.status !== 'published' ? '<button class="btn" name="status" value="published" type="submit">Publish</button>' : '<button class="btn quiet" name="status" value="draft" type="submit">Take down</button>'}
    ${f.status !== 'archived' ? '<button class="btn quiet" name="status" value="archived" type="submit">Archive</button>' : ''}</form>
  ${f.status === 'published' ? `<form method="post" action="${base}/ask-again">${tok}<p class="muted">Changed something that matters? Everyone will need to sign again. Wording fixes do not.</p>
    <button class="btn quiet" type="submit">Ask everyone to sign again</button></form>` : ''}` : ''}` });
};

export const formStatus = ({ me, csrf, org, form: f, rows = [], counts = {}, filter = 'all' }) => {
  const base = `/o/${esc(org.slug)}/forms/${esc(f.id)}`;
  const words = { current: ['Signed', 'ok'], missing: ['Not signed', 'bad'], expired: ['Run out', 'bad'] };
  return page({ title: `${f.title} — who has signed`, me, csrf, body: `
  <p><a href="${base}">&larr; ${esc(f.title)}</a></p>
  <h1>Who has signed</h1>
  <p class="sub">${counts.current} signed · ${counts.missing} not yet · ${counts.expired} run out · ${counts.total} asked.
    <a href="${base}/status?filter=todo">Only those to chase</a> · <a href="${base}/status">Everyone</a> · <a href="${base}/status.csv">Download CSV</a></p>
  <table><thead><tr><th>Name</th><th>${ClubWord()}</th><th>Status</th><th>Signed by</th><th>Until</th></tr></thead><tbody>
  ${rows.filter((r) => filter !== 'todo' || r.standing !== 'current').map((r) => { const [w, c] = words[r.standing]; return `<tr>
    <td><a href="/p/${esc(r.person_id)}">${esc(r.last_name)}, ${esc(r.first_name)}</a>${r.response ? ` <a class="muted" href="${base}/people/${esc(r.person_id)}">answers</a>` : ''}</td><td>${esc(r.club)}</td>
    <td><span class="tag ${c}">${w}</span></td><td>${esc(r.response?.signed_name ?? '')}</td><td>${esc(r.response?.expires_on ?? '')}</td></tr>`; }).join('')}
  </tbody></table>` });
};

export const myForms = ({ me, csrf, person, todo = [], done = [], minor = false, how }) => page({
  title: `Forms — ${person.first_name}`, me, csrf, body: `
  <p><a href="/me">&larr; Home</a></p>
  <h1>Forms for ${esc(person.first_name)}</h1>
  ${minor && how === 'self' ? `<p class="muted">A parent or guardian signs these for anyone under ${region().adultAge}.</p>` : ''}
  <h2>To do</h2>
  ${todo.length ? `<ul>${todo.map((i) => `<li><a href="/me/forms/${esc(i.form.id)}/${esc(person.id)}">${esc(i.form.title)}</a>${i.standing === 'expired' ? ' <span class="tag bad">run out</span>' : ''}</li>`).join('')}</ul>` : '<p class="muted">Nothing to sign.</p>'}
  <h2>Signed</h2>
  ${done.length ? `<ul>${done.map((i) => `<li>${esc(i.form.title)} <span class="muted">signed ${esc(String(i.last?.answered_at ?? '').slice(0, 10))}${i.last?.expires_on ? `, until ${esc(i.last.expires_on)}` : ''}</span></li>`).join('')}</ul>` : '<p class="muted">Nothing yet.</p>'}` });

export const fillForm = ({ me, csrf, person, item, minor = false, values = {}, error }) => {
  const f = item.form;
  const v = (id) => values[`q_${id}`];
  const input = (q) => {
    const n = `q_${esc(q.id)}`;
    if (q.type === 'agree') return `<label><input type="checkbox" name="${n}"${v(q.id) ? ' checked' : ''}> ${esc(q.label)}</label>`;
    const lab = `<label for="${n}"><strong>${esc(q.label)}</strong>${q.required ? ' *' : ''}</label>${q.help ? `<br><span class="muted">${esc(q.help)}</span>` : ''}<br>`;
    if (q.type === 'longtext') return `${lab}<textarea id="${n}" name="${n}" rows="4" maxlength="2000">${esc(v(q.id) ?? '')}</textarea>`;
    if (q.type === 'date') return `${lab}<input id="${n}" type="date" name="${n}" value="${esc(v(q.id) ?? '')}">`;
    if (q.type === 'choice') return `${lab}${q.options.map((o) => `<label><input type="radio" name="${n}" value="${esc(o)}"${v(q.id) === o ? ' checked' : ''}> ${esc(o)}</label>`).join('<br>')}`;
    if (q.type === 'checkboxes') return `${lab}${q.options.map((o, i) => `<label><input type="checkbox" name="${n}_${i}"${values[`${n}_${i}`] ? ' checked' : ''}> ${esc(o)}</label>`).join('<br>')}`;
    return `${lab}<input id="${n}" name="${n}" maxlength="300" value="${esc(v(q.id) ?? '')}">`;
  };
  return page({ title: f.title, me, csrf, body: `
  <p><a href="/me/forms/${esc(person.id)}">&larr; Forms</a></p>
  <h1>${esc(f.title)}</h1><p class="sub">For ${esc(person.first_name)} ${esc(person.last_name)}</p>
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${f.intro ? `<p style="white-space:pre-wrap">${esc(f.intro)}</p>` : ''}
  <form method="post" action="/me/forms/${esc(f.id)}/${esc(person.id)}">${formTok(csrf)}
    ${/* security-ok: input() escapes every value it writes */ f.fields.map((q) => `<p>${input(q)}</p>`).join('')}
    <h2>Sign</h2>
    <p><label>${minor ? `Your full name, as ${esc(person.first_name)}'s parent or guardian` : 'Your full name'}<br><input name="signedName" maxlength="120" required autocomplete="name" value="${esc(values.signedName ?? '')}"></label></p>
    <button class="btn" type="submit">Sign and submit</button></form>` });
};

export const formAnswers = ({ me, csrf, org, form: f, response: r }) => page({ title: `${f.title} — answers`, me, csrf, body: `
  <p><a href="/o/${esc(org.slug)}/forms/${esc(f.id)}/status">&larr; Who has signed</a></p>
  <h1>${esc(f.title)}</h1>
  ${r ? `<p class="sub">Signed by ${esc(r.signed_name)}${r.signed_for_minor ? ' (parent or guardian)' : ''} on ${esc(String(r.answered_at.toISOString?.() ?? r.answered_at).slice(0, 10))}${r.expires_on ? `, until ${esc(r.expires_on)}` : ''}</p>
  <table><tbody>${f.fields.map((q) => { const a = r.answers?.[q.id]; return `<tr><td>${esc(q.label)}</td><td>${esc(Array.isArray(a) ? a.join(', ') : a === true ? 'Agreed' : a === false ? 'Not ticked' : a ?? '')}</td></tr>`; }).join('')}</tbody></table>` : '<p class="muted">Nothing signed yet.</p>'}` });

export const autoRenewScreen = ({ me, csrf, person, memberships = [], test = false, done, error }) => {
  const tok = `<input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">`;
  const base = `/me/${esc(person.id)}/auto-renew`;
  return page({ title: `Automatic renewal — ${person.first_name}`, me, csrf, body: `
  <p><a href="/me/payments">&larr; Payments</a></p>
  <h1>Automatic renewal for ${esc(person.first_name)}</h1>
  <p class="sub">The ${clubWord()} charges your saved card or bank a few days before fees run out, so membership never lapses. You can stop it at any time with one press.</p>
  ${testBanner(test)}
  ${done ? `<div class="good">${esc(done)}</div>` : ''}${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${memberships.length ? memberships.map((m) => `<div class="card"><h2>${esc(m.club)}</h2>
    <p class="muted">Fees run to ${esc(m.paid_until ?? 'not paid yet')}</p>
    ${m.fee_exempt ? `<p>You are not charged by this ${clubWord()}.</p>`
    : m.agreement ? `<p><span class="tag ${m.agreement.status === 'paused' ? 'bad' : 'ok'}">${m.agreement.status === 'paused' ? 'Stopped' : 'On'}</span>
      ${esc(FEE_PERIODS[m.agreement.period]?.label ?? m.agreement.period)} with ${esc(m.agreement.label)}</p>
      ${m.agreement.status === 'paused' ? '<p class="bad">The last payments did not go through, so this has stopped. Stop it here, then set it up again with another card — or pay from My payments.</p>'
        : m.agreement.failures ? `<p class="muted">The last payment did not go through. We will try again on ${esc(m.agreement.next_attempt_on ?? 'soon')}.</p>` : ''}
      <form method="post" action="${base}/${esc(m.agreement.id)}/stop">${tok}<button class="btn quiet" type="submit">Stop automatic renewal</button></form>`
    : Object.keys(m.prices).length ? `<form method="post" action="${base}">${tok}<input type="hidden" name="affiliationId" value="${esc(m.affiliation_id)}">
      <p><label>Renew <select name="period">${Object.entries(m.prices).map(([k, f]) => `<option value="${esc(k)}">${esc(FEE_PERIODS[k]?.label ?? k)} — ${esc(cents(f.amount_cents, f.currency))}</option>`).join('')}</select></label></p>
      <p><label>Pay with <select name="method"><option value="card">Credit or debit card</option><option value="direct_debit">Bank direct debit</option></select></label></p>
      <p><label>Card number (we never keep it — the payment provider does)<br><input name="card" inputmode="numeric" autocomplete="cc-number" maxlength="23"></label></p>
      <p><label><input type="checkbox" name="agreed"> I agree that ${esc(m.club)} may charge this automatically each time fees are due, at the price shown. I can stop it at any time.</label></p>
      <button class="btn" type="submit">Turn on automatic renewal</button></form>`
    : `<p class="muted">This ${clubWord()} has not set prices for automatic renewal yet.</p>`}</div>`).join('') : '<p class="muted">No club memberships to renew.</p>'}` });
};

export const bookScreen = ({ me, csrf, person, clubs = [], done, error }) => {
  const tok = `<input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">`;
  const base = `/me/${esc(person.id)}/book`;
  return page({ title: `Book a class — ${person.first_name}`, me, csrf, body: `
  <p><a href="/me/classes">&larr; Classes</a></p>
  <h1>Book a class for ${esc(person.first_name)}</h1>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${clubs.map(({ club, slots }) => `<h2>${esc(club.name)}</h2>
  ${slots.length ? `<table><thead><tr><th>When</th><th>Class</th><th>Places</th><th></th></tr></thead><tbody>${slots.map((s) => `<tr>
    <td>${esc(DAY_NAMES_[s.session.weekday])} ${esc(s.date)}<br><span class="muted">${esc(s.session.starts)}–${esc(s.session.ends)}</span></td>
    <td>${esc(s.session.label)}</td>
    <td>${s.free ? `${s.free} left` : '<span class="tag wait">Full</span>'}${s.waiting ? ` <span class="muted">${s.waiting} waiting</span>` : ''}</td>
    <td>${s.mine ? `<span class="tag ${s.mine.status === 'booked' ? 'ok' : 'wait'}">${s.mine.status === 'booked' ? 'Booked' : `Waiting list — number ${s.position}`}</span>
      <form method="post" action="${base}/${esc(s.mine.id)}/cancel" style="display:inline">${tok}<button class="btn quiet" type="submit">${s.mine.status === 'booked' ? 'Cancel' : 'Leave list'}</button></form>`
      : `<form method="post" action="${base}">${tok}<input type="hidden" name="sessionId" value="${esc(s.session.id)}"><input type="hidden" name="date" value="${esc(s.date)}">
        <button class="btn" type="submit">${s.free ? 'Book' : 'Join waiting list'}</button></form>`}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">Nothing needs booking at the moment — just turn up to your usual class.</p>'}`).join('') || '<p class="muted">Not on a club\'s roll.</p>'}
  <p class="muted">Please cancel if you cannot come, so somebody on the waiting list can have your place.</p>` });
};

export const bookingsScreen = ({ me, csrf, org, today, sessions = [], canSet = false, done, error }) => {
  const tok = `<input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">`;
  return page({ title: `${org.name} — class bookings`, me, csrf, body: `
  <h1>Class bookings</h1>
  <p class="sub">Give a class a number of places and members book a place on the day, with a waiting list when it is full. Leave it blank and people just turn up.</p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${sessions.length ? sessions.map((s) => `<div class="card"><h2>${esc(s.label)} <span class="muted">· ${esc(DAY_NAMES_[s.weekday])} ${esc(s.starts)}–${esc(s.ends)}</span></h2>
    ${canSet ? `<form method="post" action="/o/${esc(org.slug)}/bookings/${esc(s.id)}/places">${tok}
      <label>Places <input name="capacity" inputmode="numeric" maxlength="3" size="4" value="${esc(s.capacity ?? '')}" placeholder="no booking"></label>
      <button class="btn quiet" type="submit">Save</button></form>` : `<p>${s.capacity ? `${s.capacity} places` : 'No booking'}</p>`}
    ${s.days.map((d) => `<h3>${esc(d.date)} — ${d.booked.length} of ${s.capacity} booked${d.waiting.length ? `, ${d.waiting.length} waiting` : ''}</h3>
      ${d.booked.length ? `<p>${d.booked.map((x) => `<a href="/p/${esc(x.person_id)}">${esc(x.name)}</a>`).join(', ')}</p>` : '<p class="muted">Nobody yet.</p>'}
      ${d.waiting.length ? `<p class="muted">Waiting: ${d.waiting.map((x) => esc(x.name)).join(', ')}</p>` : ''}`).join('')}</div>`).join('')
    : '<p class="muted">This club has no classes on its timetable yet. Add them on the club page.</p>'}` });
};

export const notificationsScreen = ({ me, csrf, available = false, publicKey = null, devices = [], done }) => {
  const tok = `<input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">`;
  return page({ title: 'Notifications', me, csrf, body: `
  <p><a href="/me">&larr; Home</a></p>
  <h1>Notifications on this device</h1>
  <p class="sub">Get a short alert when a message arrives, a place opens in a class you are waiting for, or a payment needs attention. You can turn it off at any time.</p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${available ? `<div id="push-box" data-key="${esc(publicKey)}" data-csrf="${esc(csrf ?? '')}">
    <p><button id="push-on" class="btn" type="button">Turn on notifications</button>
       <button id="push-off" class="btn quiet" type="button" hidden>Turn off for this device</button></p>
    <p id="push-msg" class="muted" role="status"></p></div><script src="/vendor/push.js" defer></script>
    <noscript><p class="muted">Turning notifications on needs JavaScript.</p></noscript>`
  : '<div class="note">Notifications have not been switched on for this site yet. Ask the person who runs it.</div>'}
  <h2>Your devices</h2>
  ${devices.length ? `<table><tbody>${devices.map((d) => `<tr><td>${esc((d.user_agent ?? 'A device').slice(0, 80))}</td><td>${esc(String(d.created_at.toISOString?.() ?? d.created_at).slice(0, 10))}</td>
    <td><form method="post" action="/me/notifications/${esc(d.id)}/remove">${tok}<button class="btn quiet" type="submit">Remove</button></form></td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">No devices yet.</p>'}
  <p class="muted">On an iPhone or iPad, first choose Share, then Add to Home Screen, and open the app from there.</p>` });
};

const whenAt = (d) => esc(String(d?.toISOString?.() ?? d ?? '').slice(0, 16).replace('T', ' '));

export const integrationsScreen = ({ me, csrf, org, tokens = [], endpoints = [], recent = [], scopes = {}, events = {}, origin = '', newToken = null, newSecret = null, done, error }) => {
  const tok = `<input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">`;
  const base = `/o/${esc(org.slug)}/integrations`;
  return page({ title: `${org.name} — API and webhooks`, me, csrf, body: `
  <h1>API and webhooks</h1>
  <p class="sub">Connect ${esc(org.name)} to other systems — an accounting package, a website, a spreadsheet — without giving anybody a login.</p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${newToken ? `<div class="note"><strong>Copy your token now.</strong> It is shown this once; we keep only a fingerprint.<br><code>${esc(newToken)}</code></div>` : ''}
  ${newSecret ? `<div class="note"><strong>Copy the signing secret now.</strong> You need it to check that messages come from us. It is shown this once.<br><code>${esc(newSecret)}</code></div>` : ''}

  <h2>API tokens</h2>
  <p class="muted">Read-only. A token sees ${esc(org.name)} and everything beneath it, and never dates of birth, contact details, medical or payment information.
    Use it as <code>Authorization: Bearer &lt;token&gt;</code> against <code>${esc(origin)}/api/v1/organisations</code>, <code>/members</code> and <code>/events</code> (add <code>?limit=100&amp;after=&lt;id&gt;</code> to page through).</p>
  ${tokens.length ? `<table><thead><tr><th>Name</th><th>Starts</th><th>Can read</th><th>Last used</th><th></th></tr></thead><tbody>${tokens.map((t) => `<tr>
    <td>${esc(t.name)}</td><td><code>${esc(t.prefix)}…</code></td><td>${t.scopes.map((s) => esc(s.split(':')[0])).join(', ')}</td>
    <td>${t.last_used_at ? when(t.last_used_at) : 'never'}</td>
    <td>${t.revoked_at ? '<span class="tag bad">Revoked</span>' : `<form method="post" action="${base}/tokens/${esc(t.id)}/revoke">${tok}<button class="btn quiet" type="submit">Revoke</button></form>`}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No tokens yet.</p>'}
  <form method="post" action="${base}/tokens">${tok}
    <p><label>Name <input name="name" maxlength="80" placeholder="Accounting export" required></label></p>
    <p>${Object.entries(scopes).map(([k, w]) => `<label style="display:block"><input type="checkbox" name="scopes" value="${esc(k)}"> ${esc(w)}</label>`).join('')}</p>
    <button class="btn" type="submit">Create a token</button></form>

  <h2>Webhooks</h2>
  <p class="muted">We send a signed message to your address when something happens here or beneath ${esc(org.name)}. Each is signed: the header
    <code>X-Honbu-Signature: t=&lt;time&gt;,v1=&lt;hex&gt;</code> is an HMAC-SHA256 of <code>&lt;time&gt;.&lt;body&gt;</code> with your secret. If your server is down we try again a few times over about 15 hours.</p>
  ${endpoints.length ? `<table><thead><tr><th>Address</th><th>Tells you about</th><th></th></tr></thead><tbody>${endpoints.map((e) => `<tr>
    <td>${esc(e.url)}${e.disabled_at ? `<br><span class="tag bad">${esc(e.disabled_reason ?? 'Switched off')}</span>` : e.active ? '' : '<br><span class="tag wait">Off</span>'}</td>
    <td>${e.events.map((x) => esc(events[x] ?? x)).join('<br>')}</td>
    <td><form method="post" action="${base}/webhooks/${esc(e.id)}/test" style="display:inline">${tok}<button class="btn quiet" type="submit">Send a test</button></form>
      <form method="post" action="${base}/webhooks/${esc(e.id)}/${e.active && !e.disabled_at ? 'off' : 'on'}" style="display:inline">${tok}<button class="btn quiet" type="submit">${e.active && !e.disabled_at ? 'Switch off' : 'Switch on'}</button></form>
      <form method="post" action="${base}/webhooks/${esc(e.id)}/remove" style="display:inline">${tok}<button class="btn quiet" type="submit">Remove</button></form></td></tr>`).join('')}</tbody></table>` : '<p class="muted">No webhooks yet.</p>'}
  <form method="post" action="${base}/webhooks">${tok}
    <p><label>Address <input name="url" type="url" maxlength="500" placeholder="https://example.com/honbu-hook" required style="width:28em;max-width:100%"></label></p>
    <p>${Object.entries(events).filter(([k]) => k !== 'ping').map(([k, w]) => `<label style="display:block"><input type="checkbox" name="events" value="${esc(k)}"> ${esc(w)}</label>`).join('')}</p>
    <button class="btn" type="submit">Add a webhook</button></form>
  ${recent.length ? `<h3>Recent messages</h3><table><thead><tr><th>When</th><th>What</th><th>Result</th></tr></thead><tbody>${recent.map((d) => `<tr><td>${whenAt(d.created_at)}</td><td>${esc(events[d.event] ?? d.event)}</td>
    <td>${d.status === 'delivered' ? '<span class="tag ok">Delivered</span>' : d.status === 'failed' ? `<span class="tag bad">Gave up</span> ${esc(d.last_error ?? '')}` : `<span class="tag wait">Trying again</span> ${esc(d.last_error ?? '')}`}</td></tr>`).join('')}</tbody></table>` : ''}` });
};

export const platformScreen = ({ me, csrf, root, orgs = [], members = [], stats = {}, recent = [], health = [], store }) => page({
  title: 'Platform', me, csrf, body: `
  <p><a href="/dashboard">&larr; Everything I look after</a></p>
  <h1>${esc(root.name)} — platform</h1>
  <p class="sub">How this installation is doing. Only the federation's owner sees this.</p>
  <h2>Is everything switched on?</h2>
  <ul>${health.map((h) => `<li><span class="tag ${h.ok ? 'ok' : 'wait'}">${h.ok ? 'OK' : 'Check'}</span> ${esc(h.text)}</li>`).join('')}</ul>
  <h2>What is here</h2>
  <table><tbody>
    <tr><td>Organisations</td><td>${orgs.map((o) => `${o.n} ${esc(o.type)}${o.n === 1 ? '' : 's'}`).join(', ') || 'none'}</td></tr>
    <tr><td>Memberships</td><td>${members.map((m) => `${m.n} ${esc(m.status)}`).join(', ') || 'none'}</td></tr>
    <tr><td>People / sign-in accounts</td><td>${stats.people} / ${stats.accounts}</td></tr>
    <tr><td>Upcoming events</td><td>${stats.upcomingEvents}</td></tr>
    <tr><td>Published forms</td><td>${stats.formsPublished}</td></tr>
    <tr><td>Renewing themselves (stopped)</td><td>${stats.autoRenewing} (${stats.autoRenewStopped})</td></tr>
    <tr><td>Class places booked ahead</td><td>${stats.bookingsAhead}</td></tr>
    <tr><td>Devices with notifications</td><td>${stats.pushDevices}</td></tr>
    <tr><td>API tokens in use</td><td>${stats.tokens}</td></tr>
    <tr><td>Webhooks on / off</td><td>${stats.webhooks} / ${stats.webhooksOff}</td></tr>
    <tr><td>Webhook messages waiting / gave up in 24h</td><td>${stats.deliveriesWaiting} / ${stats.deliveriesFailed24h}</td></tr>
  </tbody></table>
  <h2>Latest activity</h2>
  <table><tbody>${recent.map((r) => `<tr><td>${whenAt(r.created_at)}</td><td>${esc(r.action)}</td><td>${esc(r.organisation ?? '')}</td><td class="muted">${esc(r.who ?? 'the system')}</td></tr>`).join('')}</tbody></table>
  <p class="muted">Data store: ${esc(store)}.</p>` });

export * from './views-shop.mjs';
export * from './views-messages.mjs';
export * from './views-settings.mjs';
