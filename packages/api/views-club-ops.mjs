/**
 * Screens: running a club — attendance and the roll, newcomers, reports, grading days and certificates, compliance, bookings.
 */
import { region } from '../infrastructure/region-context.mjs';
import { esc } from '../core/domain/html.mjs';
import { DEFAULT_TIMEZONE } from '../core/domain/defaults.mjs';
import { dollars as money } from '../core/domain/money.mjs';
import { page } from './views.mjs';
import { QUAL_WORDS, DAY_NAMES_ } from './views-shared.mjs';

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
