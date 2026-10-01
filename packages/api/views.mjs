import fs from 'node:fs';
import { describe as auditDescribe, weight as auditWeight }
  from '../content/audit.mjs';
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

const FIELD_LABELS_PAGE = {
  text: 'Text', level: 'Heading level', items: 'One per line',
  ordered: 'Numbered', attribution: 'Who said it', assetId: 'Image reference',
  caption: 'Caption', alt: 'Describe the image for somebody who cannot see it',
  tone: 'Tone', provider: 'Where the video is', id: 'Video reference',
  heading: 'Heading', kind: 'Only this kind', limit: 'How many at most',
  award: 'Which award',
};

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
                             blocks = [], dropped = [], revisions = [],
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
    <input type="hidden" name="blockCount" value="${blocks.length}">

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
    <p class="muted">${esc(SHORTHAND_HELP)} — anywhere you can type a sentence.</p>

    ${blocks.map((b, i) => blockFieldset(b, i, values)).join('')}

    ${blocks.length ? '' : `<div class="note">Nothing on this page yet.
      Add something below.</div>`}

    <fieldset>
      <legend>Add something</legend>
      <div class="row">
        <div>
          <select name="addType" style="max-width:280px">
            ${BLOCK_MENU.map(([t, label]) => option(t, label, 'paragraph')).join('')}
          </select>
        </div>
        <div>
          <button class="btn quiet" type="submit" name="op" value="add">
            Add it to the page</button>
        </div>
      </div>
      <p class="hint">The three marked "live" fill themselves in from the
        register — add the clubs block once and it stays right as clubs come
        and go.</p>
    </fieldset>

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
                                blocks = [], dropped = [], images = [],
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

  <form method="post" action="${esc(action)}">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <input type="hidden" name="blockCount" value="${blocks.length}">

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
          ${images.length ? '' : `<p class="hint">No images yet.
            <a href="/o/${esc(org.slug)}/media">Upload one</a> first.</p>`}
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
    <p class="muted">${esc(SHORTHAND_HELP)} — anywhere you can type a sentence.</p>

    ${blocks.map((b, i) => blockFieldset(b, i, values)).join('')}

    ${blocks.length ? '' : `<div class="note">Nothing written yet.
      Add something below.</div>`}

    <fieldset>
      <legend>Add something</legend>
      <div class="row">
        <div>
          <select name="addType" style="max-width:280px">
            ${BLOCK_MENU.map(([t, label]) => option(t, label, 'paragraph')).join('')}
          </select>
        </div>
        <div>
          <button class="btn quiet" type="submit" name="op" value="add">
            Add it</button>
        </div>
      </div>
    </fieldset>

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

/** One block, as a set of inputs somebody can actually fill in. */
function blockFieldset(block, i, values) {
  const spec = BLOCKS[block.type];
  if (!spec) return '';
  const v = (name) => values[`b${i}_${name}`] ?? '';

  const input = (name, kind) => {
    const id = `b${i}_${name}`;
    const label = FIELD_LABELS_PAGE[name] ?? name;

    if (kind === 'rich[]') {
      return `<label for="${id}">${esc(label)}</label>
        <textarea id="${id}" name="${id}">${esc(v(name))}</textarea>`;
    }
    if (kind === 'rich') {
      return `<label for="${id}">${esc(label)}</label>
        <textarea id="${id}" name="${id}">${esc(v(name))}</textarea>`;
    }
    if (kind === 'boolean') {
      return `<div class="check">
        <input type="checkbox" id="${id}" name="${id}" value="1"${v(name) ? ' checked' : ''}>
        <label for="${id}" style="margin:0;font-weight:400">${esc(label)}</label></div>`;
    }
    if (kind === 'number') {
      return `<label for="${id}">${esc(label)}</label>
        <input id="${id}" name="${id}" type="number" min="1" max="6"
          value="${esc(v(name))}" style="max-width:120px">`;
    }
    if (kind.startsWith('enum:')) {
      const choices = kind.slice(5).split(',');
      return `<label for="${id}">${esc(label)}</label>
        <select id="${id}" name="${id}" style="max-width:240px">
          ${choices.map((c) => option(c, c, v(name))).join('')}
        </select>`;
    }
    return `<label for="${id}">${esc(label)}</label>
      <input id="${id}" name="${id}" maxlength="300" value="${esc(v(name))}"
        style="max-width:560px">`;
  };

  return `
  <fieldset>
    <legend>${esc(BLOCK_NAMES[block.type] ?? block.type)}</legend>
    <input type="hidden" name="b${i}_type" value="${esc(block.type)}">
    ${Object.entries(spec.fields).map(([name, kind]) => input(name, kind)).join('')}
    ${Object.keys(spec.fields).length ? '' :
      '<p class="muted">A line across the page. Nothing to fill in.</p>'}
    <div class="actions" style="margin-top:14px">
      <button class="btn quiet" type="submit" name="op" value="up:${i}"
        title="Move up"${i === 0 ? ' disabled' : ''}>↑</button>
      <button class="btn quiet" type="submit" name="op" value="down:${i}"
        title="Move down">↓</button>
      <button class="btn quiet right" type="submit" name="op" value="remove:${i}"
        title="Remove this block">Remove</button>
    </div>
  </fieldset>`;
}

export const error = ({ me, csrf, status, message }) => page({
  title: `Error ${status}`, me, csrf, body: `
  <h1>${status}</h1>
  <div class="bad">${esc(message)}</div>
  <p><a class="btn quiet" href="/dashboard">Back</a></p>` });
