/**
 * HONBU — site renderer
 *
 * The public site is a PROJECTION of the register, not a separate CMS.
 * Dojo pages, event listings and results are generated. Nobody edits them, so
 * nobody can leave one half-filled.
 *
 * The advantage over every hosted club platform is here: real slugs, per-page
 * meta, and JSON-LD on every dojo so Google reads it as a physical business.
 */

const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

const time = (t) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h < 12 ? 'am' : 'pm';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hr}.${String(m).padStart(2,'0')}${ampm}` : `${hr}${ampm}`;
};

const date = (d, tz = 'Pacific/Auckland') => new Date(d).toLocaleDateString('en-NZ',
  { weekday:'long', day:'numeric', month:'long', timeZone: tz });

/** Group sessions so 'Tuesday & Thursday, 5.30-6.30pm' appears once, not twice. */
function groupSessions(sessions) {
  const byLabel = new Map();
  for (const s of sessions) {
    const key = `${s.label}|${s.starts}|${s.ends}`;
    if (!byLabel.has(key)) byLabel.set(key, { ...s, days: [] });
    byLabel.get(key).days.push(DAYS[s.weekday]);
  }
  return [...byLabel.values()];
}

// ---------------------------------------------------------------------------
// structured data — the thing Sporty cannot do
// ---------------------------------------------------------------------------

export function dojoJsonLd(dojo, federation, origin) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'SportsActivityLocation',
    name: `${federation.name} — ${dojo.name} Dojo`,
    url: `${origin}/${dojo.slug}`,
    parentOrganization: { '@type': 'SportsOrganization', name: federation.name,
      url: origin },
    sport: 'Karate',
  };
  if (dojo.venue_name || dojo.city) {
    ld.address = { '@type': 'PostalAddress', addressCountry: dojo.country_code ?? 'NZ' };
    if (dojo.address_line) ld.address.streetAddress = dojo.address_line;
    if (dojo.suburb) ld.address.addressLocality = dojo.suburb;
    if (dojo.city) ld.address.addressRegion = dojo.city;
    if (dojo.postcode) ld.address.postalCode = dojo.postcode;
  }
  if (dojo.latitude) ld.geo = { '@type': 'GeoCoordinates',
    latitude: dojo.latitude, longitude: dojo.longitude };
  if (dojo.phone && !dojo.phone.startsWith('[')) ld.telephone = dojo.phone;
  if (dojo.email) ld.email = dojo.email;

  const hours = groupSessions(dojo.sessions ?? []).map((g) => ({
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: g.days.map((d) => `https://schema.org/${d}`),
    opens: g.starts, closes: g.ends,
  }));
  if (hours.length) ld.openingHoursSpecification = hours;
  return ld;
}

export function eventJsonLd(ev, org, origin) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: ev.title,
    startDate: ev.starts_at,
    endDate: ev.ends_at ?? undefined,
    eventStatus: ev.status === 'cancelled'
      ? 'https://schema.org/EventCancelled' : 'https://schema.org/EventScheduled',
    url: `${origin}/events/${ev.slug}`,
    organizer: { '@type': 'SportsOrganization', name: ev.from_org ?? org.name },
    location: ev.venue_name
      ? { '@type': 'Place', name: ev.venue_name }
      : { '@type': 'VirtualLocation', url: `${origin}/events/${ev.slug}` },
  };
}

// ---------------------------------------------------------------------------
// theme — CSS built from the brand tokens, nothing hand-authored per customer
// ---------------------------------------------------------------------------

export function themeCss(tokens, fonts) {
  const v = Object.entries(tokens)
    .filter(([, x]) => x)
    .map(([k, x]) => `  --${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}: ${x};`)
    .join('\n');

  return `:root{
${v}
  --display: "${fonts.display ?? 'Georgia'}", Georgia, serif;
  --body: "${fonts.body ?? 'system-ui'}", system-ui, sans-serif;
}
*{box-sizing:border-box}
body{margin:0;background:var(--canvas);color:var(--ink);font-family:var(--body);
  font-size:17px;line-height:1.7}
.wrap{max-width:1100px;margin:0 auto;padding:0 24px}
.narrow{max-width:780px}
a{color:var(--primary-text-strong)}
img{max-width:100%;display:block}
:focus-visible{outline:3px solid var(--primary);outline-offset:3px}

header.site{background:var(--ink);color:var(--canvas)}
header.site .wrap{display:flex;align-items:center;gap:16px;padding-top:14px;padding-bottom:14px}
header.site a{color:var(--canvas);text-decoration:none}
.brandmark{font-family:var(--display);font-weight:700;font-size:19px;line-height:1.2}
.brandmark span{display:block;font-family:var(--body);font-size:11.5px;
  color:var(--neutral);letter-spacing:.09em;font-weight:400}
nav.main{margin-left:auto;display:flex;gap:20px;font-size:15px;font-weight:500}
nav.main a{border-bottom:2px solid transparent;padding-bottom:3px}
nav.main a:hover{border-bottom-color:var(--primary)}

.hero{background:var(--ink-soft);color:var(--canvas);padding:56px 0}
.hero h1{font-family:var(--display);font-size:clamp(32px,5.4vw,52px);font-weight:700;
  margin:0 0 14px;line-height:1.05;letter-spacing:-.02em}
.hero p{font-size:19px;color:var(--neutral);margin:0 0 22px;max-width:46ch}
.btn{display:inline-block;font-weight:700;padding:13px 26px;text-decoration:none;
  border:2px solid var(--primary);background:var(--primary);color:#fff}
.btn:hover{background:var(--primary-hover);border-color:var(--primary-hover)}
.btn.ghost{background:none;color:var(--canvas);border-color:var(--canvas)}
.btn.ghost:hover{background:var(--canvas);color:var(--ink)}

.facts{background:var(--ink);color:var(--canvas)}
.facts .wrap{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));padding:0}
.facts div{padding:22px 24px;border-right:1px solid var(--ink-soft)}
.facts div:last-child{border-right:0}
.facts b{display:block;font-family:var(--display);font-size:14px;color:var(--accent);
  letter-spacing:.04em;margin-bottom:6px}
.facts p{margin:0;font-size:16px}
.facts small{display:block;color:var(--neutral);font-size:14px;margin-top:4px}

section{padding:52px 0}
h2{font-family:var(--display);font-size:clamp(24px,3.4vw,34px);font-weight:700;
  margin:0 0 6px;letter-spacing:-.02em}
h2::after{content:"";display:block;width:48px;height:4px;background:var(--primary);
  margin:12px 0 20px}
p{margin:0 0 16px}

table.times{width:100%;border-collapse:collapse;font-size:16px}
table.times th{text-align:left;font-family:var(--display);padding:10px 0;
  border-bottom:2px solid var(--ink)}
table.times td{padding:12px 0;border-bottom:1px solid var(--neutral)}
table.times td:last-child{text-align:right;color:var(--muted)}

.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:2px;
  background:var(--neutral)}
.grid a{background:var(--canvas);padding:16px 18px;text-decoration:none;display:block;
  color:var(--ink)}
.grid a:hover{background:var(--primary);color:#fff}
.grid strong{display:block;font-family:var(--display);font-size:18px}
.grid span{font-size:14px;color:var(--muted)}
.grid a:hover span{color:#fff}

ul.events{list-style:none;padding:0;margin:0}
ul.events li{display:grid;grid-template-columns:96px 1fr;gap:20px;padding:18px 0;
  border-bottom:1px solid var(--neutral)}
ul.events .d{font-family:var(--display);font-weight:700;line-height:1}
ul.events .d b{display:block;font-size:30px}
ul.events .d span{font-size:14px;color:var(--muted)}
ul.events h3{font-family:var(--display);font-size:20px;margin:0 0 4px}
ul.events p{margin:0;color:var(--muted);font-size:15px}
.tag{display:inline-block;font-size:12px;font-weight:700;letter-spacing:.06em;
  padding:2px 8px;background:var(--ink);color:var(--accent);margin-bottom:6px}

.notice{background:var(--accent);color:var(--ink);padding:14px 18px;margin:20px 0;
  font-family:var(--display);font-weight:700}
footer.site{background:var(--ink);color:var(--neutral);padding:32px 0;font-size:14px}
footer.site a{color:var(--neutral)}

@media (max-width:860px){
  .facts .wrap{grid-template-columns:1fr}
  .facts div{border-right:0;border-bottom:1px solid var(--ink-soft)}
  .grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  nav.main{display:none}
}
@media (max-width:600px){
  .grid{grid-template-columns:1fr}
  ul.events li{grid-template-columns:64px 1fr;gap:14px}
}`;
}

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

export function layout({ title, description, canonical, body, jsonLd = [],
                         federation, fonts, nav = [] }) {
  const fontHref = [fonts.display, fonts.body].filter(Boolean)
    .map((f) => `family=${f.replace(/ /g, '+')}:wght@400;500;700`).join('&');

  return `<!DOCTYPE html>
<html lang="en-NZ">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:type" content="website">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?${fontHref}&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/theme.css">
${jsonLd.map((l) => `<script type="application/ld+json">${JSON.stringify(l)}</script>`).join('\n')}
</head>
<body>
<header class="site"><div class="wrap">
  <a class="brandmark" href="/">${esc(federation.name)}<span>${esc(federation.country_code ?? '')}</span></a>
  <nav class="main">${nav.map((n) => `<a href="${n.href}">${esc(n.label)}</a>`).join('')}</nav>
</div></header>
${body}
<footer class="site"><div class="wrap">
  ${esc(federation.name)} · <a href="/find-a-dojo">Dojo</a> · <a href="/events">Events</a>
</div></footer>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// pages
// ---------------------------------------------------------------------------

export function dojoPage({ dojo, federation, events, origin, fonts, nav }) {
  const groups = groupSessions(dojo.sessions ?? []);
  const town = dojo.name;
  const daysLine = groups.length
    ? [...new Set(groups.flatMap((g) => g.days))].join(', ')
    : 'Training nights to confirm';

  const body = `
<div class="hero"><div class="wrap">
  <h1>Kyokushin karate in ${esc(town)}</h1>
  <p>Full-contact karate for adults and children. ${esc(daysLine)}.${
    dojo.first_class_free ? ' Your first class is free.' : ''}</p>
  <a class="btn" href="#visit">Come to a class</a>
</div></div>

<div class="facts"><div class="wrap">
  <div><b>WHERE</b><p>${esc(dojo.venue_name ?? 'Venue to confirm')}
    <small>${esc([dojo.suburb, dojo.city, dojo.postcode].filter(Boolean).join(', ') || 'Address to confirm')}</small></p></div>
  <div><b>WHEN</b><p>${esc(daysLine)}<small>${
    groups.map((g) => `${esc(g.label)} ${time(g.starts)}`).slice(0,2).join(' · ') || 'Times to confirm'}</small></p></div>
  <div><b>CONTACT</b><p>${
    dojo.phone && !String(dojo.phone).startsWith('[')
      ? `<a href="tel:${esc(dojo.phone.replace(/\s/g,''))}" style="color:var(--canvas)">${esc(dojo.phone)}</a>`
      : 'Phone to confirm'}
    <small>${esc(dojo.email ?? '')}</small></p></div>
</div></div>

<section><div class="wrap narrow">
  <div class="notice">You can start any week — there is no term to wait for.</div>
  <h2>Training times</h2>
  ${groups.length ? `<table class="times">
    <thead><tr><th>Class</th><th>Day</th><th>Time</th></tr></thead>
    <tbody>${groups.map((g) => `<tr>
      <td><strong>${esc(g.label)}</strong></td>
      <td>${esc(g.days.join(' & '))}</td>
      <td>${time(g.starts)} – ${time(g.ends)}</td></tr>`).join('')}
    </tbody></table>`
    : '<p>Training times to be confirmed.</p>'}

  ${dojo.blurb ? `<h2 style="margin-top:40px">About this dojo</h2>
    <p>${esc(dojo.blurb)}</p>
    ${dojo.who_trains ? `<p>${esc(dojo.who_trains)}</p>` : ''}` : ''}

  ${events.length ? `<h2 style="margin-top:40px">What's on</h2>
  <ul class="events">${events.map((e) => {
    const d = new Date(e.starts_at);
    return `<li>
      <div class="d"><b>${d.getDate()}</b><span>${d.toLocaleDateString('en-NZ',{month:'short'})}</span></div>
      <div>${e.is_own ? '' : `<span class="tag">${esc(e.from_org)}</span>`}
        <h3><a href="/events/${esc(e.slug)}">${esc(e.title)}</a></h3>
        <p>${esc(e.venue_name ?? '')}</p></div></li>`;
  }).join('')}</ul>` : ''}

  <h2 id="visit" style="margin-top:40px">Finding us</h2>
  <p>${esc(dojo.venue_name ?? '')}<br>${esc([dojo.address_line, dojo.suburb, dojo.city].filter(Boolean).join(', '))}
  ${dojo.directions ? `<br>${esc(dojo.directions)}` : ''}</p>
</div></section>`;

  return layout({
    title: `Kyokushin karate in ${town} — ${federation.name}`,
    description: `Full-contact Kyokushin karate classes in ${town} for adults and ` +
      `children.${dojo.first_class_free ? ' First class free.' : ''}` +
      (groups.length ? ` ${daysLine} at ${dojo.venue_name}.` : ''),
    canonical: `${origin}/${dojo.slug}`,
    jsonLd: [dojoJsonLd(dojo, federation, origin)],
    federation, fonts, nav, body,
  });
}

export function findADojoPage({ dojos, federation, origin, fonts, nav }) {
  const ready = dojos.filter((d) => d.published);
  const body = `
<section><div class="wrap">
  <h1 style="font-family:var(--display);font-size:clamp(30px,5vw,46px);margin:0 0 12px">Find a dojo</h1>
  <p style="font-size:19px;max-width:60ch">${dojos.length} dojo. Every one takes
  beginners, and your first class is free.</p>
  <div class="grid" style="margin-top:28px">
    ${dojos.map((d) => `<a href="/${esc(d.slug)}"><strong>${esc(d.name)}</strong>
      <span>${esc(d.published ? (d.city ?? 'Book a free class') : 'Details coming')}</span></a>`).join('')}
  </div>
  <p style="margin-top:22px;color:var(--muted);font-size:15px">
    ${ready.length} of ${dojos.length} pages complete.</p>
</div></section>`;

  return layout({
    title: `Find a dojo — ${federation.name}`,
    description: `${dojos.length} Kyokushin karate dojo. Find your nearest and book a free first class.`,
    canonical: `${origin}/find-a-dojo`,
    jsonLd: [{
      '@context':'https://schema.org','@type':'SportsOrganization',
      name: federation.name, url: origin,
      subOrganization: dojos.map((d) => ({
        '@type':'SportsActivityLocation', name: `${d.name} Dojo`,
        url: `${origin}/${d.slug}` })),
    }],
    federation, fonts, nav, body,
  });
}

export function eventPage({ ev, federation, origin, fonts, nav }) {
  const body = `
<div class="hero"><div class="wrap">
  <span class="tag">${esc(ev.kind.replace('_',' ').toUpperCase())}</span>
  <h1>${esc(ev.title)}</h1>
  <p>${esc(date(ev.starts_at))}${ev.venue_name ? ' · ' + esc(ev.venue_name) : ''}</p>
</div></div>
<section><div class="wrap narrow">
  ${ev.summary ? `<p style="font-size:19px">${esc(ev.summary)}</p>` : ''}
  ${ev.entries_close ? `<div class="notice">Entries close ${esc(date(ev.entries_close))}.</div>` : ''}
  <p><a class="btn" href="#">Enter</a></p>
</div></section>`;

  return layout({
    title: `${ev.title} — ${federation.name}`,
    description: ev.summary ?? `${ev.title}, ${date(ev.starts_at)}.`,
    canonical: `${origin}/events/${ev.slug}`,
    jsonLd: [eventJsonLd(ev, federation, origin)],
    federation, fonts, nav, body,
  });
}

export function homePage({ federation, dojos, events, articles, origin, fonts, nav }) {
  const body = `
<div class="hero"><div class="wrap">
  <h1>Everyone starts as a white belt.</h1>
  <p>Full-contact Kyokushin karate, taught in New Zealand since 1965.
  Your first class is free.</p>
  <a class="btn" href="/find-a-dojo">Find your dojo</a>
  <a class="btn ghost" href="/events" style="margin-left:8px">Events</a>
</div></div>

<section><div class="wrap">
  <h2>Where we train</h2>
  <div class="grid">${dojos.slice(0,16).map((d) =>
    `<a href="/${esc(d.slug)}"><strong>${esc(d.name)}</strong><span>Book a free class</span></a>`).join('')}</div>
</div></section>

${events.length ? `<section style="background:var(--canvas-alt)"><div class="wrap">
  <h2>Coming up</h2>
  <ul class="events">${events.slice(0,5).map((e) => {
    const d = new Date(e.starts_at);
    return `<li><div class="d"><b>${d.getDate()}</b>
      <span>${d.toLocaleDateString('en-NZ',{month:'short'})}</span></div>
      <div><h3><a href="/events/${esc(e.slug)}">${esc(e.title)}</a></h3>
      <p>${esc(e.venue_name ?? e.from_org ?? '')}</p></div></li>`;
  }).join('')}</ul>
</div></section>` : ''}

${articles.length ? `<section><div class="wrap">
  <h2>News</h2>
  <ul class="events">${articles.map((a) =>
    `<li><div class="d"><b>${new Date(a.published_at).getDate()}</b>
      <span>${new Date(a.published_at).toLocaleDateString('en-NZ',{month:'short'})}</span></div>
      <div>${a.about_org ? `<span class="tag">${esc(a.about_org)}</span>` : ''}
      <h3><a href="/news/${esc(a.slug)}">${esc(a.title)}</a></h3>
      <p>${esc(a.summary ?? '')}</p></div></li>`).join('')}</ul>
</div></section>` : ''}`;

  return layout({
    title: `Kyokushin karate in New Zealand — ${federation.name}`,
    description: `Full-contact Kyokushin karate since 1965. ${dojos.length} dojo ` +
      `nationwide, all welcoming beginners. Your first class is free.`,
    canonical: origin,
    jsonLd: [{
      '@context':'https://schema.org','@type':'SportsOrganization',
      name: federation.name, url: origin, sport: 'Karate',
      foundingDate: federation.founded?.toISOString?.().slice(0,10),
    }],
    federation, fonts, nav, body,
  });
}

export { esc, groupSessions, time, date };
