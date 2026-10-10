/**
 * Screens: what a club writes to its people — the compose screen (who, how, what) and one sent message with who it
 * reached. Re-exported by views.mjs, so callers still say V.messagesScreen and so on.
 */
import { page } from './views.mjs';
import { esc } from '../core/domain/html.mjs';

const STATUS_WORDS = { queued: 'Waiting', sending: 'Sending', sent: 'Sent', failed: 'Failed',
  opted_out: 'Opted out', no_email: 'No email address', no_app: 'No app on their phone' };

export const messagesScreen = ({ me, csrf, org, history = [], events = [], people = [], sender = null,
                                 values = null, error, done }) => {
  const v = (k) => esc(values?.[k] ?? '');
  const aud = values?.audience ?? 'members';
  const kind = values?.kind ?? 'announcement';
  const channel = values?.channel ?? 'both';
  return page({ title: `${org.name} — messages`, me, csrf, body: `
  <h1>Messages</h1>
  <p class="sub">${sender
    ? `Goes out as <strong>${esc(sender.name)}</strong> from ${esc(sender.address)}.
       ${sender.replyTo ? `Replies go to ${esc(sender.replyTo)}.` : ''}`
    : 'Email is not set up to send yet.'}</p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${sender && !sender.replyTo ? `<div class="note">Add a contact email on the club's page so
    replies have somewhere to go — until then nothing can be sent by email. A notification on
    their phone needs no address, so choose that under “How is it sent?”.</div>` : ''}

  <h2>Write a message</h2>
  <form method="post" action="/o/${esc(org.slug)}/messages">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <fieldset><legend>Who is it for?</legend>
      ${AUDIENCE_CHOICES.map(([k, label]) => `<label><input type="radio" name="audience"
        value="${k}"${aud === k ? ' checked' : ''}> ${esc(label)}</label>`).join('')}
    </fieldset>
    <fieldset id="picklist"><legend>People I tick <span class="muted">(only for “people I tick from the list”)</span></legend>
      ${people.length ? `<p><input type="checkbox" id="pickall" hidden> <label for="pickall" hidden>Tick everyone shown</label></p>
      <div style="max-height:260px;overflow:auto">${people.map((p) => `<label><input class="pick" type="checkbox"
        name="pick_${esc(p.id)}" value="1"${values?.[`pick_${p.id}`] === '1' ? ' checked' : ''}> ${esc(p.name)}${
        p.grade ? ` <span class="muted">· ${esc(p.grade)}</span>` : ''}${
        p.club && p.club !== org.name ? ` <span class="muted">· ${esc(p.club)}</span>` : ''}</label>`).join('')}</div>
      <script src="/vendor/select-all.js" defer></script>` : '<p class="muted">Nobody is on the roll yet.</p>'}
    </fieldset>
    <div class="row">
      <div><label for="eventId">Event <span class="muted">(only for “people entered in an event”)</span></label>
        <select id="eventId" name="eventId"><option value="">—</option>${events.map((e) =>
          `<option value="${esc(e.id)}"${values?.eventId === e.id ? ' selected' : ''}>${
            esc(e.day)} · ${esc(e.title)}</option>`).join('')}</select></div>
      <div><label for="personNumber">Member number <span class="muted">(only for “one person”)</span></label>
        <input id="personNumber" name="personNumber" maxlength="30" value="${v('personNumber')}"></div>
    </div>
    <fieldset><legend>How is it sent?</legend>
      ${CHANNEL_CHOICES.map(([k, label]) => `<label><input type="radio" name="channel"
        value="${k}"${channel === k ? ' checked' : ''}> ${esc(label)}</label>`).join('')}
      <p class="muted">A phone only gets a notification once its owner has turned them on under
        <em>My details → Notifications</em>. Anyone who has not is shown as “No app on their phone”
        on the message afterwards, so you know who to tell another way.</p>
    </fieldset>
    <fieldset><legend>What kind of message?</legend>
      ${KIND_CHOICES.map(([k, label]) => `<label><input type="radio" name="kind"
        value="${k}"${kind === k ? ' checked' : ''}> ${esc(label)}</label>`).join('')}
      <p class="muted">Announcements stop for anyone who has opted out. A message about an event
        they entered is sent regardless, and says so.</p>
    </fieldset>
    <label for="subject">Subject</label>
    <input id="subject" name="subject" required maxlength="150" value="${v('subject')}">
    <label for="body">Message</label>
    <textarea id="body" name="body" rows="9" required maxlength="10000">${v('body')}</textarea>
    <p class="muted">Children with a parent or guardian linked are written to through them.
      One address gets one copy.</p>
    <div class="actions"><button class="btn" type="submit">Send</button></div>
  </form>

  <h2>Sent</h2>
  ${history.length ? `<table><thead><tr><th>When</th><th>Subject</th><th>Reached</th><th></th></tr></thead><tbody>${
    history.map((m) => `<tr>
      <td>${esc(new Date(m.created_at).toISOString().slice(0, 10))}</td>
      <td>${esc(m.subject)}</td>
      <td>${m.sent} of ${m.sent + m.failed + m.waiting}${m.waiting ? ` · ${m.waiting} waiting` : ''}${
        m.failed ? ` · ${m.failed} failed` : ''}${m.skipped ? ` · ${m.skipped} skipped` : ''}</td>
      <td><a href="/o/${esc(org.slug)}/messages/${esc(m.id)}">Open</a></td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">Nothing sent yet.</p>'}` });
};

const AUDIENCE_CHOICES = [
  ['members', 'Everyone (every member of this organisation and the clubs under it)'], ['instructors', 'Instructors only'], ['udansha', 'Black belts only (udansha)'],
  ['selected', 'People I tick from the list below'], ['event', 'People entered in an event'], ['person', 'One person'],
];
const CHANNEL_CHOICES = [['both', 'Email and a notification on their phone'], ['app', 'A notification on their phone only (no email)']];
const KIND_CHOICES = [['announcement', 'Announcement'], ['event', 'About an event they entered']];

export const messageDetail = ({ me, csrf, org, message, recipients = [], done, error }) => {
  const count = (s) => recipients.filter((r) => r.status === s).length;
  const waiting = count('queued') + count('sending');
  return page({ title: `${message.subject} — message`, me, csrf, body: `
  <p><a href="/o/${esc(org.slug)}/messages">← Messages</a></p>
  <h1>${esc(message.subject)}</h1>
  <p class="sub">From ${esc(message.sender_name)} · ${esc(new Date(message.created_at).toISOString().slice(0, 16).replace('T', ' '))} UTC${
    message.event_title ? ` · about ${esc(message.event_title)}` : ''}</p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  <div class="row">
    <div><strong>${count('sent')}</strong> sent</div>
    <div><strong>${waiting}</strong> waiting</div>
    <div><strong>${count('failed')}</strong> failed</div>
    <div><strong>${count('opted_out') + count('no_email') + count('no_app')}</strong> skipped</div>
  </div>
  ${waiting ? `<form method="post" action="/o/${esc(org.slug)}/messages/${esc(message.id)}/send">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <p>Sending is done in batches. ${waiting} still to go.</p>
    <div class="actions"><button class="btn" type="submit">Send the next batch</button></div></form>` : ''}
  ${count('failed') ? `<form method="post" action="/o/${esc(org.slug)}/messages/${esc(message.id)}/retry">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <div class="actions"><button class="btn quiet" type="submit">Try the failed ones again</button></div></form>` : ''}
  <h2>Message</h2>
  <pre style="white-space:pre-wrap">${esc(message.body)}</pre>
  <h2>Who</h2>
  <table><thead><tr><th>Person</th><th>Address</th><th>Status</th></tr></thead><tbody>${
    recipients.map((r) => `<tr><td>${esc(r.name ?? '—')}${r.about ? ` <span class="muted">(for ${esc(r.about)})</span>` : ''}</td>
      <td>${esc(r.email ?? '—')}</td>
      <td>${esc(STATUS_WORDS[r.status] ?? r.status)}${r.error ? ` <span class="muted">— ${esc(r.error)}</span>` : ''}</td></tr>`).join('')}</tbody></table>` });
};
