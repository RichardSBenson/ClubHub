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
  <h1>Send a message</h1>
  <p class="sub">${sender
    ? `From <strong>${esc(sender.name)}</strong> (${esc(sender.address)})${sender.replyTo ? `. Replies go to ${esc(sender.replyTo)}` : ''}.`
    : 'Email is not set up to send yet — phone notifications still work.'}</p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${sender && !sender.replyTo ? `<div class="note">Add a contact email on the club's page so replies have
    somewhere to go. Until then, send by phone notification only.</div>` : ''}

  <style>
    .compose{max-width:640px}
    .compose label{display:block;margin:20px 0 6px}
    .compose select,.compose textarea,.compose input[type=text]{width:100%;box-sizing:border-box}
    .compose .sub-part{margin-top:12px}
    .compose .pickbox{border:1px solid var(--line-2);border-radius:8px;background:#fff;max-height:300px;overflow:auto}
    .compose .tick{display:flex;align-items:center;gap:12px;margin:0;padding:12px 14px;font-weight:500;
      border-bottom:1px solid var(--line)}
    .compose .tick:last-child{border-bottom:0}
    .compose .tick input{flex:none;width:20px;height:20px;margin:0}
    .compose .tick .muted{font-weight:400;font-size:13px}
    .compose .tick.all{background:var(--soft);font-weight:600}
    .compose .help{font-size:13px;color:var(--muted);margin:6px 0 0}
    .compose .go{margin-top:26px}
    .compose .go .btn{width:100%;padding:14px;font-size:16px}
    .compose [hidden]{display:none}
  </style>
  <form class="compose" method="post" action="/o/${esc(org.slug)}/messages" id="compose">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">

    <label for="audience">To</label>
    <select id="audience" name="audience">${AUDIENCE_CHOICES.map(([k, label]) =>
      `<option value="${k}"${aud === k ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>

    <div class="sub-part" data-for="selected">
      ${people.length ? `<div class="pickbox">
        <label class="tick all" for="pickall" hidden><input type="checkbox" id="pickall" hidden> Tick everyone</label>
        ${people.map((p) => `<label class="tick"><input class="pick" type="checkbox"
          name="pick_${esc(p.id)}" value="1"${values?.[`pick_${p.id}`] === '1' ? ' checked' : ''}>
          <span>${esc(p.name)}${p.grade ? ` <span class="muted">· ${esc(p.grade)}</span>` : ''}${
          p.club && p.club !== org.name ? ` <span class="muted">· ${esc(p.club)}</span>` : ''}</span></label>`).join('')}
      </div>` : '<p class="help">Nobody is on the roll yet.</p>'}
    </div>

    <div class="sub-part" data-for="event">
      <label for="eventId">Which event</label>
      <select id="eventId" name="eventId"><option value="">Choose…</option>${events.map((e) =>
        `<option value="${esc(e.id)}"${values?.eventId === e.id ? ' selected' : ''}>${
          esc(e.day)} · ${esc(e.title)}</option>`).join('')}</select>
      <label class="tick" style="padding-left:0;border:0"><input type="checkbox" name="kind" value="event"${
        kind === 'event' ? ' checked' : ''}> <span>It is about the event they entered
        <span class="muted">(sent even to people who have turned announcements off)</span></span></label>
    </div>

    <div class="sub-part" data-for="person">
      <label for="personNumber">Member number</label>
      <input type="text" id="personNumber" name="personNumber" maxlength="30" value="${v('personNumber')}">
    </div>

    <label for="channel">Send by</label>
    <select id="channel" name="channel">${CHANNEL_CHOICES.map(([k, label]) =>
      `<option value="${k}"${channel === k ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>
    <p class="help">A phone only gets a notification once its owner has turned them on in
      <em>My details → Notifications</em>. Anyone who hasn't is listed afterwards as “No app on their phone”.</p>

    <label for="subject">Subject</label>
    <input type="text" id="subject" name="subject" required maxlength="150" value="${v('subject')}">
    <label for="body">Message</label>
    <textarea id="body" name="body" rows="7" required maxlength="10000">${v('body')}</textarea>
    <p class="help">A child's message goes to their parents. One address gets one copy.</p>

    <div class="go"><button class="btn" type="submit">Send</button></div>
  </form>
  <script src="/vendor/select-all.js" defer></script>
  <script src="/vendor/message-form.js" defer></script>

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
  ['members', 'Everyone (including the clubs under this one)'], ['instructors', 'Instructors only'], ['udansha', 'Black belts only (udansha)'],
  ['selected', 'People I pick'], ['event', 'People entered in an event'], ['person', 'One person'],
];
const CHANNEL_CHOICES = [['both', 'Email and phone notification'], ['app', 'Phone notification only']];

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
