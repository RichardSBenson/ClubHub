/**
 * Screens: setting a club up — the clubs list, a club's profile, importing a roll, notifications, integrations, the platform page, check-in, and the gallery.
 */
import { region, words } from '../infrastructure/region-context.mjs';
import { slotHint } from '../content/image-slots.mjs';
import { esc } from '../core/domain/html.mjs';
import { page } from './views.mjs';
import { cardCss, clubWord, ClubWord, when } from './views-shared.mjs';

const clubsWord = () => words().clubPlural.toLowerCase();

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
