/**
 * Screens: what a member sees of their own record — home, details, events, messages, documents, classes, card and terms.
 */
import { REASON_WORDS } from '../core/domain/repeat-entry.mjs';
import { region } from '../infrastructure/region-context.mjs';
import { nextGradingWords } from '../core/domain/next-grading.mjs';
import { photoNeedsConsent } from '../core/domain/documents.mjs';
import { ageOn as personAgeOn } from '../core/domain/people.mjs';
import { slotHint } from '../content/image-slots.mjs';
import { esc } from '../core/domain/html.mjs';
import { money as cents } from '../core/domain/money.mjs';
import { STANDING_WORDS as STANDING_WORDS_ } from '../core/domain/membership.mjs';
import { page } from './views.mjs';
import { EVENT_KIND_WORDS, taxNote, clubWord, FAMILY_LABELS, when, QUAL_WORDS, DOC_STATUS, DAY_NAMES_, identityCss, cardCss, formTok } from './views-shared.mjs';


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

export const identityHead = ({ personId, name, hasPhoto = false, isInstructor = false, tag = 'h2' }) => {
  const initials = String(name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  return `<div class="idhead">
    ${hasPhoto ? `<img class="idphoto" src="/p/${esc(personId)}/photo" alt="Photograph of ${esc(name)}">`
               : `<div class="idphoto none" aria-hidden="true">${esc(initials)}</div>`}
    <div class="idwho"><${tag}>${esc(name)}</${tag}>
      <p class="idchips">${isInstructor ? '<span class="idchip">Instructor</span>' : ''}</p></div>
  </div>`;
};

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
