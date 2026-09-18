/**
 * HONBU — admin views
 *
 * Plain HTML. No client framework, no build step. Every screen works with
 * JavaScript turned off, because these get used on bad connections in halls.
 */

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

export const dashboard = ({ me, csrf, orgs }) => {
  const dojos = orgs.filter((o) => o.type === 'dojo');
  const parents = orgs.filter((o) => o.type !== 'dojo');
  const total = dojos.reduce((n, o) => n + Number(o.members), 0);
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

  <h2>Dojo</h2>
  <div class="grid">${dojos.map((o) => `<div class="card">
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
      <td>${p.grade ? `<span class="tag ${p.rank_order >= 11 ? 'dan' : 'ok'}">${esc(p.grade)}</span>`
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

export const events = ({ me, csrf, org, events }) => page({
  title: `Events — ${org.name}`, me, csrf, body: `
  <h1>Events</h1>
  <p class="sub">${esc(org.name)} · <a href="/o/${esc(org.slug)}/roster">Back to roster</a></p>
  ${events.length ? `<table>
    <thead><tr><th>Date</th><th>Event</th><th class="hide-sm">From</th>
      <th>Visibility</th></tr></thead>
    <tbody>${events.map((e) => `<tr>
      <td>${String(new Date(e.starts_at).toISOString().slice(0,10))}</td>
      <td><strong>${esc(e.title)}</strong></td>
      <td class="hide-sm">${esc(e.from_org)}${e.is_own ? '' : ' <span class="muted">(inherited)</span>'}</td>
      <td><span class="tag ${e.visibility === 'public' ? 'ok' : 'no'}">${esc(e.visibility)}</span></td>
    </tr>`).join('')}</tbody></table>`
    : '<div class="note">Nothing scheduled.</div>'}` });

export const error = ({ me, csrf, status, message }) => page({
  title: `Error ${status}`, me, csrf, body: `
  <h1>${status}</h1>
  <div class="bad">${esc(message)}</div>
  <p><a class="btn quiet" href="/dashboard">Back</a></p>` });
