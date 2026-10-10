/**
 * Screens: events — the calendar, the event form, competition set-up, entering competitors, and the entry list.
 */
import { region, eventTypes } from '../infrastructure/region-context.mjs';
import { esc } from '../core/domain/html.mjs';
import { money as cents } from '../core/domain/money.mjs';
import { page } from './views.mjs';
import { option, genderOptions, EVENT_KIND_WORDS } from './views-shared.mjs';

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
