/**
 * Screens: forms and consent a club builds, and the federation's declaration.
 */
import { region } from '../infrastructure/region-context.mjs';
import { esc } from '../core/domain/html.mjs';
import { page } from './views.mjs';
import { formTok, ClubWord } from './views-shared.mjs';

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

const FORM_STATUS = { draft: 'Not published', published: 'Published', archived: 'Archived' };


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

const KIND_WORDS = { waiver: 'Waiver', consent: 'Consent', medical: 'Medical', other: 'Other' };

const TYPE_WORDS = { agree: 'A statement to agree to (a tick)', text: 'Short answer', longtext: 'Long answer', choice: 'Pick one', checkboxes: 'Pick any', date: 'Date' };

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

export const formAnswers = ({ me, csrf, org, form: f, response: r }) => page({ title: `${f.title} — answers`, me, csrf, body: `
  <p><a href="/o/${esc(org.slug)}/forms/${esc(f.id)}/status">&larr; Who has signed</a></p>
  <h1>${esc(f.title)}</h1>
  ${r ? `<p class="sub">Signed by ${esc(r.signed_name)}${r.signed_for_minor ? ' (parent or guardian)' : ''} on ${esc(String(r.answered_at.toISOString?.() ?? r.answered_at).slice(0, 10))}${r.expires_on ? `, until ${esc(r.expires_on)}` : ''}</p>
  <table><tbody>${f.fields.map((q) => { const a = r.answers?.[q.id]; return `<tr><td>${esc(q.label)}</td><td>${esc(Array.isArray(a) ? a.join(', ') : a === true ? 'Agreed' : a === false ? 'Not ticked' : a ?? '')}</td></tr>`; }).join('')}</tbody></table>` : '<p class="muted">Nothing signed yet.</p>'}` });
