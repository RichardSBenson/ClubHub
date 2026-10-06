/**
 * HONBU — site renderer
 *
 * The public site is a PROJECTION of the register, not a separate CMS.
 * Dojo pages, event listings and results are generated. Nobody edits them, so
 * nobody can leave one half-filled.
 *
 * The advantage over every hosted club platform is here: real slugs, per-page
 * meta, and JSON-LD on every dojo so Google reads it as a physical business.
 *
 * This file was written with no imports at all, which was a nice property
 * while it lasted. It buys one exception, for a domain value: writing a second
 * way to turn a date into 'YYYY-MM-DD' is what put a wrong founding date — in
 * fact no founding date — into the structured data on every page.
 */
import { bannerLines, typeFor, mapLinks } from '../core/domain/event-types.mjs';
import { CalendarDay } from '../core/domain/values.mjs';

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

const clock = (d, tz = 'Pacific/Auckland') => new Date(d).toLocaleTimeString('en-NZ',
  { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz }).replace(/\s/g, '').toLowerCase();

/** "3 October", or "3–5 October" across days, or "30 Oct – 2 Nov" across months. */
function shortRange(starts, ends, tz = 'Pacific/Auckland') {
  const f = (d, o) => new Date(d).toLocaleDateString('en-NZ', { timeZone: tz, ...o });
  const a = new Date(starts);
  if (!ends || f(starts, { dateStyle: 'short' }) === f(ends, { dateStyle: 'short' })) return `${f(a, { day: 'numeric' })} ${f(a, { month: 'long' })}`;
  if (f(starts, { month: 'long' }) === f(ends, { month: 'long' }))
    return `${f(starts, { day: 'numeric' })}–${f(ends, { day: 'numeric' })} ${f(starts, { month: 'long' })}`;
  return `${f(starts, { day: 'numeric', month: 'short' })} – ${f(ends, { day: 'numeric', month: 'short' })}`;
}

/**
 * The announcement for an event, made of text: the federation's crest and up to
 * three lines. Nothing here is a picture of words, so a changed date is a
 * changed line, and it stays sharp, searchable and readable by a screen reader.
 */
function eventBanner(ev, { logoUrl = null, federationName = '', small = false } = {}) {
  const { top, main } = bannerLines(ev);
  return `<div class="evbanner${small ? ' small' : ''}">
  ${logoUrl ? `<img class="crest" src="${esc(logoUrl)}" alt="${esc(federationName)} crest">` : ''}
  <div class="evtext">
    ${top ? `<span class="evtop">${esc(top)}</span>` : ''}
    <span class="evmain">${esc(main)}</span>
    <span class="evwhen">${esc(shortRange(ev.starts_at, ev.ends_at))}</span>
  </div>
</div>`;
}

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

/**
 * What schema.org should call the sport. Karate is MOKNZ's answer, not the
 * platform's — build.mjs puts the federation's own on the object from
 * settings. The fallback only covers a federation record that has not been
 * given one.
 */
const capitalise = (t) => t.charAt(0).toUpperCase() + t.slice(1);

const disciplineOf = (federation) => federation?.discipline ?? 'Martial arts';

/**
 * The phrase a page uses when the federation has not written its own copy.
 *
 * It is built from the federation's own discipline and vocabulary, never from
 * a sentence about Kyokushin. The old defaults said "Full-contact Kyokushin
 * karate, taught in New Zealand since 1965", which is true of exactly one
 * customer and appeared on every other federation's pages the moment there
 * was more than one.
 */
const artOf = (federation) =>
  federation?.artName ?? federation?.discipline ?? 'martial arts';
const clubWord = (v = {}) => (v.club ?? 'club').toLowerCase();
const clubsWordOf = (v = {}) => (v.clubPlural ?? v.club ?? 'clubs').toLowerCase();

export function dojoJsonLd(dojo, federation, origin, base = '') {
  const federationUrl = `${origin}${base}`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'SportsActivityLocation',
    name: `${federation.name} — ${dojo.name} Dojo`,
    url: `${origin}${base}/${dojo.slug}`,
    parentOrganization: { '@type': 'SportsOrganization', name: federation.name,
      url: federationUrl },
    sport: disciplineOf(federation),
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

export function eventJsonLd(ev, org, origin, base = '') {
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: ev.title,
    startDate: ev.starts_at,
    endDate: ev.ends_at ?? undefined,
    eventStatus: ev.status === 'cancelled'
      ? 'https://schema.org/EventCancelled' : 'https://schema.org/EventScheduled',
    url: `${origin}${base}/events/${ev.slug}`,
    organizer: { '@type': 'SportsOrganization', name: ev.from_org ?? org.name },
    location: ev.venue_name
      ? { '@type': 'Place', name: ev.venue_name }
      : { '@type': 'VirtualLocation', url: `${origin}${base}/events/${ev.slug}` },
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
.brandmark{display:flex;align-items:center;gap:10px;font-family:var(--display);font-weight:700;font-size:19px;line-height:1.2}
.brandmark span{display:block;font-family:var(--body);font-size:11.5px;
  color:var(--neutral);letter-spacing:.09em;font-weight:400}
nav.main{margin-left:auto;display:flex;gap:20px;font-size:15px;font-weight:500}
nav.main a{border-bottom:2px solid transparent;padding-bottom:3px}
nav.main a:hover{border-bottom-color:var(--primary)}
/* The menu button and its backdrop exist only on a phone. No script: a hidden
   checkbox holds open/closed, so the menu works wherever the page does. */
.navtoggle,.navbtn,.navscrim,.navclose{display:none}

.hero{position:relative;color:var(--canvas);padding:clamp(72px,14vw,150px) 0 clamp(56px,10vw,110px);
  min-height:min(72vh,640px);display:flex;align-items:center;overflow:hidden;
  background:
    linear-gradient(115deg,rgba(0,0,0,.0) 0 62%,rgba(255,255,255,.04) 62% 63%,rgba(0,0,0,0) 63%),
    radial-gradient(120% 90% at 85% 10%,var(--primary) 0,transparent 55%),
    linear-gradient(160deg,var(--ink-soft),var(--ink))}
.hero>.wrap{position:relative;width:100%}
.hero h1{font-family:var(--display);font-size:clamp(36px,6.4vw,68px);font-weight:700;
  margin:0 0 16px;line-height:1.04;letter-spacing:-.025em;max-width:22ch;text-wrap:balance}
.hero p{font-size:clamp(17px,2.2vw,21px);color:var(--canvas);opacity:.88;margin:0 0 28px;max-width:46ch}
.hero.photo{background-size:cover;background-position:center}
.hero .actions{display:flex;flex-wrap:wrap;gap:12px}
.hero.small{min-height:0;padding:56px 0}
.btn{display:inline-block;font-weight:700;padding:15px 30px;text-decoration:none;font-size:17px;
  border:2px solid var(--primary);background:var(--primary);color:#fff;border-radius:2px;
  transition:transform .15s ease,background .15s ease,box-shadow .15s ease}
.btn:hover{background:var(--primary-hover);border-color:var(--primary-hover);transform:translateY(-1px);
  box-shadow:0 6px 18px rgba(0,0,0,.25)}
.btn.ghost{background:rgba(0,0,0,.25);color:var(--canvas);border-color:var(--canvas)}
.btn.ghost:hover{background:var(--canvas);color:var(--ink)}
.btn.light{background:var(--canvas);color:var(--ink);border-color:var(--canvas)}

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

.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}
.grid a{position:relative;display:flex;flex-direction:column;justify-content:flex-end;min-height:150px;
  padding:16px 18px;text-decoration:none;color:#fff;overflow:hidden;border-radius:2px;
  background:linear-gradient(160deg,var(--ink-soft),var(--ink));background-size:cover;background-position:center;
  transition:transform .15s ease,box-shadow .15s ease}
.grid a::before{content:"";position:absolute;inset:0;
  background:linear-gradient(to top,rgba(0,0,0,.78),rgba(0,0,0,.05) 70%)}
.grid a::after{content:"";position:absolute;left:0;right:0;bottom:0;height:4px;background:var(--primary)}
.grid a>*{position:relative}
.grid a:hover{transform:translateY(-3px);box-shadow:0 10px 24px rgba(0,0,0,.28)}
.grid strong{display:block;font-family:var(--display);font-size:20px}
.grid span{font-size:14px;opacity:.9}
.trialcta{background:var(--primary);color:#fff;text-align:center;padding:36px 24px;border-radius:12px;margin:32px 0}
.trialcta h2{color:#fff;margin:0 0 10px}.trialcta h2::after{display:none}.trialcta p{margin:0 auto 20px;max-width:46ch;opacity:.92}
.cta{background:var(--primary);color:#fff;text-align:center;padding:48px 0}
.cta h2{color:#fff;margin:0 0 18px}.cta h2::after{display:none}
.stickycta{display:none}

.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.evbanner{background:#000;display:flex;align-items:center;justify-content:center;gap:clamp(20px,5vw,72px);
  padding:clamp(28px,6vw,64px) clamp(16px,4vw,48px);color:var(--neutral);
  font-family:"Anton","Oswald",Impact,"Arial Narrow",sans-serif;text-transform:none}
.evbanner .crest{height:clamp(140px,26vw,300px);width:auto;max-width:44%;object-fit:contain}
.evtext{display:flex;flex-direction:column;line-height:1.02;letter-spacing:.01em}
.evtop{font-size:clamp(28px,5.4vw,68px);color:var(--neutral)}
.evmain{font-size:clamp(34px,7vw,92px);color:var(--accent);text-transform:uppercase}
.evwhen{font-size:clamp(26px,5vw,64px);color:var(--neutral)}
.evbanner.small{justify-content:flex-start;padding:16px 20px;gap:16px}
.evbanner.small .crest{height:72px;max-width:30%}
.evbanner.small .evtop{font-size:20px}.evbanner.small .evmain{font-size:26px}.evbanner.small .evwhen{font-size:18px}
a.evcard{display:block;text-decoration:none;border-bottom:4px solid var(--primary);border-radius:2px;overflow:hidden;
  transition:transform .15s ease,box-shadow .15s ease}
a.evcard:hover{transform:translateY(-2px);box-shadow:0 10px 24px rgba(0,0,0,.25)}
.evcards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}
.evgrid{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:40px;align-items:start}
.evside{background:var(--canvas-alt);padding:22px 24px;border-top:4px solid var(--primary)}
.evside h2{font-size:22px}.evside h2::after{display:none}
.evside dt{font-family:var(--display);font-weight:700;font-size:13px;letter-spacing:.06em;text-transform:uppercase;
  color:var(--muted);margin-top:16px}
.evside dd{margin:2px 0 0}
.evmap{margin-top:20px}.evmap iframe{width:100%;height:260px;border:0;display:block;background:#ddd}
.evmap .links{display:flex;gap:14px;flex-wrap:wrap;margin-top:8px;font-size:15px}
.icards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}
.icard{background:var(--canvas-alt);border-top:4px solid var(--primary);padding:16px 18px 18px}
.icard .iphoto{width:100%;aspect-ratio:1/1;object-fit:cover;object-position:center 30%;border-radius:2px;margin-bottom:12px}
.icard .iphoto.none{display:flex;align-items:center;justify-content:center;background:var(--ink-soft);
  color:var(--neutral);font-family:var(--display);font-size:44px}
.icard h3{font-family:var(--display);font-size:21px;margin:0 0 2px}
.icard .irank{margin:0 0 8px;color:var(--muted);font-weight:700}
.icard .iclub{margin:0 0 8px;font-size:15px}
.icard ul{list-style:none;margin:0 0 10px;padding:0;font-size:15px}
.icard .ifacts b{font-family:var(--display);font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin-right:6px}
.icard .ichecks li{display:inline-block;margin:0 6px 6px 0;padding:2px 10px;border:1px solid var(--primary);
  border-radius:999px;font-size:13px;font-weight:700;color:var(--primary-text-strong)}
.icard .ichecks li::before{content:"✓ "}
.icard p{font-size:15.5px;margin:0 0 10px}
.gallery{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:0;padding:0;list-style:none}
.gallery li{margin:0}
.gallery img{width:100%;aspect-ratio:3/2;object-fit:cover;border-radius:2px}
.gallery figcaption{font-size:14px;color:var(--muted);margin-top:4px}
.gallery figure{margin:0}
.crestmark{height:40px;width:auto;flex:none}
@media (max-width:860px){.icards{grid-template-columns:repeat(2,minmax(0,1fr))}.evgrid{grid-template-columns:1fr}.evcards{grid-template-columns:1fr}.gallery{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:600px){.icards{grid-template-columns:1fr}.evbanner{flex-direction:column;text-align:center}.evbanner .crest{max-width:70%}
  .evbanner.small{flex-direction:row;text-align:left}.evbanner.small .crest{max-width:30%}}

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
  .grid{grid-template-columns:repeat(3,minmax(0,1fr))}
  .navbtn{display:flex;margin-left:auto;width:44px;height:44px;align-items:center;
    justify-content:center;cursor:pointer;flex-direction:column;gap:5px}
  .navbtn i{display:block;width:24px;height:2px;background:var(--canvas)}
  .navtoggle{display:block;position:absolute;opacity:0;width:1px;height:1px}
  .navtoggle:focus-visible~.navbtn{outline:3px solid var(--primary);outline-offset:2px}
  nav.main{position:fixed;top:0;left:0;bottom:0;width:min(280px,82vw);z-index:30;
    margin:0;flex-direction:column;gap:0;background:var(--ink);padding:64px 0 24px;
    overflow-y:auto;transform:translateX(-100%);visibility:hidden;
    transition:transform .2s ease,visibility 0s .2s;font-size:17px}
  nav.main a{padding:14px 24px;border-bottom:1px solid var(--ink-soft)}
  .navclose{display:flex;position:absolute;top:10px;right:10px;width:44px;height:44px;
    align-items:center;justify-content:center;font-size:28px;cursor:pointer;color:var(--canvas)}
  .navscrim{display:block;position:fixed;inset:0;z-index:20;background:rgba(0,0,0,.5);
    opacity:0;pointer-events:none;transition:opacity .2s ease}
  .navtoggle:checked~nav.main{transform:none;visibility:visible;transition:transform .2s ease}
  .navtoggle:checked~.navscrim{opacity:1;pointer-events:auto}
}
@media (max-width:860px) and (prefers-reduced-motion:reduce){
  nav.main,.navscrim{transition:none!important}
}
@media (max-width:600px){
  .grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .grid a{min-height:120px}
  /* On a phone the bar that stays at the bottom is the call to action; the closing band would repeat it. */
  .cta{display:none}
  .stickycta{display:block;position:sticky;bottom:0;z-index:15;padding:10px 16px;
    background:var(--ink);border-top:3px solid var(--primary)}
  .stickycta .btn{display:block;text-align:center;width:100%}
  ul.events li{grid-template-columns:64px 1fr;gap:14px}
}`;
}

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

/**
 * `base` is the path this federation's site is published under: '' for the
 * one at the root, '/demo/tkd' for a second federation on the same
 * deployment. Every internal link goes through it. Absolute links worked
 * while there was one federation and silently send a visitor to another
 * federation's page once there are three.
 */
export function layout({ title, description, canonical, body, jsonLd = [],
                         federation, fonts, nav = [], base = '', vocabulary = {}, logoUrl = null, image = null }) {
  const at = (p) => `${base}${p}`;
  logoUrl = logoUrl ?? federation.logoUrl ?? null;
  // The picture a chat app or Facebook shows when the page is shared. A page can offer its own;
  // otherwise it is the federation's share picture. It has to be an absolute address.
  let shareHref = null;
  try { const pic = image ?? federation.shareUrl; if (pic) shareHref = new URL(pic, canonical).href; } catch { /* no picture */ }
  const clubsWord = vocabulary.clubPlural ?? vocabulary.club ?? 'Clubs';
  // Anton has one weight; asking Google for more makes the whole request fail.
  const fontHref = [...[fonts.display, fonts.body].filter(Boolean)
    .map((f) => `family=${f.replace(/ /g, '+')}:wght@400;500;700`), 'family=Anton'].join('&');

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
<meta name="twitter:card" content="${shareHref ? 'summary_large_image' : 'summary'}">
${shareHref ? `<meta property="og:image" content="${esc(shareHref)}">\n<meta name="twitter:image" content="${esc(shareHref)}">\n` : ''}<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?${fontHref}&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${at('/theme.css')}">
${jsonLd.map((l) => `<script type="application/ld+json">${JSON.stringify(l)}</script>`).join('\n')}
</head>
<body>
<header class="site"><div class="wrap">
  <a class="brandmark" href="${at('/')}">${logoUrl ? `<img class="crestmark" src="${esc(logoUrl)}" alt="">` : ''}<div>${esc(federation.name)}<span>${esc(federation.country_code ?? '')}</span></div></a>
  <input type="checkbox" class="navtoggle" id="navtoggle" aria-label="Open the menu">
  <label class="navbtn" for="navtoggle" aria-hidden="true"><i></i><i></i><i></i></label>
  <label class="navscrim" for="navtoggle" aria-hidden="true"></label>
  <nav class="main" aria-label="Main"><label class="navclose" for="navtoggle" aria-hidden="true">×</label>${nav.map((n) => `<a href="${at(n.href)}">${esc(n.label)}</a>`).join('')}</nav>
</div></header>
${body}
<footer class="site"><div class="wrap">
  ${esc(federation.name)} · <a href="${at('/find-a-dojo')}">${esc(clubsWord)}</a> · <a href="${at('/events')}">Events</a>
</div></footer>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// pages
// ---------------------------------------------------------------------------

export const DOJO_DEFAULT = ['hero', 'facts', 'startAnyWeek', 'times', 'about', 'instructors', 'gallery', 'events', 'findUs'];
export const HOME_DEFAULT = ['hero', 'dojoGrid', 'events', 'news'];

/**
 * Sections are laid out in the order a federation chose. `hero` and `facts`
 * are full-width bands; the rest share one narrow column, so consecutive
 * narrow ones are grouped under a single wrapper rather than each opening its
 * own. A name nobody built is skipped, never rendered as an empty box.
 */
function arrange(order, parts, bands) {
  const out = [];
  let column = [];
  const flush = () => {
    if (column.length) {
      out.push(`<section><div class="wrap narrow">${column.join('\n')}</div></section>`);
      column = [];
    }
  };
  for (const name of order) {
    const html = parts[name]?.();
    if (!html) continue;
    if (bands.has(name)) { flush(); out.push(html); } else column.push(html);
  }
  flush();
  return out.join('\n');
}

export function dojoPage({ dojo, federation, events, origin, fonts, nav,
                           base = '', vocabulary = {}, logoUrl = null, gallery = [], instructors = [],
                           sections = DOJO_DEFAULT, startAnyWeekText = null,
                           showFirstClassFree = true }) {
  logoUrl = logoUrl ?? federation.logoUrl ?? null;
  const at = (p) => `${base}${p}`;
  const groups = groupSessions(dojo.sessions ?? []);
  const town = dojo.name;
  const daysLine = groups.length
    ? [...new Set(groups.flatMap((g) => g.days))].join(', ')
    : 'Training nights to confirm';
  const free = showFirstClassFree && dojo.first_class_free;

  const parts = {
    hero: () => `
<div class="hero${dojo.hero_url ? ' photo' : ''}"${dojo.hero_url
  ? ` style="background-image:linear-gradient(100deg,rgba(10,10,12,.78),rgba(10,10,12,.35)),url('${esc(dojo.hero_url)}')"`
  : ''}><div class="wrap">
  <h1>${esc(federation.name)} in ${esc(town)}</h1>
  <p>${esc(capitalise(artOf(federation)))} for adults and children. ${esc(daysLine)}.${
    free ? ' Your first class is free.' : ''}</p>
  <div class="actions"><a class="btn" href="${free ? `/enquire/${esc(dojo.slug)}?kind=trial` : '#visit'}">${
    free ? 'Book your free class' : 'Come to a class'}</a>
  <a class="btn ghost" href="#times">See class times</a></div>
</div></div>`,

    facts: () => `
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
</div></div>`,

    // A claim on the federation's behalf, so it is only made when the
    // federation wrote it. It used to be hardcoded for everybody.
    startAnyWeek: () => startAnyWeekText
      ? `<div class="notice">${esc(startAnyWeekText)}</div>` : '',

    times: () => `<h2 id="times">Training times</h2>
  ${groups.length ? `<table class="times">
    <thead><tr><th>Class</th><th>Day</th><th>Time</th></tr></thead>
    <tbody>${groups.map((g) => `<tr>
      <td><strong>${esc(g.label)}</strong></td>
      <td>${esc(g.days.join(' & '))}</td>
      <td>${time(g.starts)} – ${time(g.ends)}</td></tr>`).join('')}
    </tbody></table>`
    : '<p>Training times to be confirmed.</p>'}`,

    about: () => dojo.blurb ? `<h2 style="margin-top:40px">About this ${esc(clubWord(vocabulary))}</h2>
    <p>${esc(dojo.blurb)}</p>
    ${dojo.who_trains ? `<p>${esc(dojo.who_trains)}</p>` : ''}` : '',

    // Always on the page, so a visitor sees where the instructor will be. With nobody published yet it
    // is an honest placeholder in the same layout, not an empty gap.
    instructors: () => `<h2 style="margin-top:40px">${instructors.length === 1 ? 'Your instructor' : 'Your instructors'}</h2>
  <div class="icards" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">${instructors.length
    ? instructors.map((i) => instructorCard(i, { at })).join('')
    : `<article class="icard waiting"><div class="iphoto none" aria-hidden="true">?</div>
    <h3>Meet your instructor</h3><p class="irank">Introductions coming soon</p>
    <p>Come along to a class and meet them in person.</p></article>`}</div>
  ${instructors.length ? `<p><a href="${at('/instructors')}">All instructors</a></p>` : ''}`,

    gallery: () => gallery.length ? `<h2 style="margin-top:40px">In the dojo</h2>
  <ul class="gallery">${gallery.map((g) => `<li><figure><img src="${esc(g.url)}" alt="${esc(g.alt ?? '')}" loading="lazy">${
    g.caption ? `<figcaption>${esc(g.caption)}</figcaption>` : ''}</figure></li>`).join('')}</ul>` : '',

    events: () => events.length ? `<h2 style="margin-top:40px">What's on</h2>
  <div class="evcards" style="grid-template-columns:1fr">${events.map((e) => `<a class="evcard" href="${at(e.is_own ? `/${esc(dojo.slug)}/events/${esc(e.slug)}` : `/events/${esc(e.slug)}`)}">
    ${eventBanner(e, { logoUrl, federationName: federation.name, small: true })}</a>`).join('')}</div>` : '',

    findUs: () => `<h2 id="visit" style="margin-top:40px">Finding us</h2>
  <p>${esc(dojo.venue_name ?? '')}<br>${esc([dojo.address_line, dojo.suburb, dojo.city].filter(Boolean).join(', '))}
  ${dojo.directions ? `<br>${esc(dojo.directions)}` : ''}</p>`,
  };

  // "Come to a class" points at #visit, so a layout without findUs would
  // leave the button going nowhere. Facts too: where, when and who to ask is
  // the reason anybody is on this page.
  const order = [...sections];
  if (!order.includes('facts')) order.splice(Math.min(1, order.length), 0, 'facts');
  if (!order.includes('findUs')) order.push('findUs');
  // A gallery appears once a dojo has pictures, whatever layout the federation saved before galleries existed.
  const before = (name) => { const i = order.indexOf(name); return i < 0 ? order.length - 1 : i; };
  if (!order.includes('instructors')) order.splice(before('gallery') < order.length - 1 && order.includes('gallery') ? order.indexOf('gallery') : before('events'), 0, 'instructors');
  if (gallery.length && !order.includes('gallery')) order.splice(before('events'), 0, 'gallery');

  const trial = free ? `/enquire/${esc(dojo.slug)}?kind=trial` : '#visit';
  const body = arrange(order, parts, new Set(['hero', 'facts']))
    + `\n<section class="cta"><div class="wrap"><h2>${free ? 'Your first class is free' : 'Come and see a class'}</h2>`
    + `<a class="btn light" href="${trial}">${free ? 'Book your free class' : 'Visit us'}</a></div></section>`
    + `\n<div class="stickycta"><a class="btn" href="${trial}">${free ? 'Book your free class' : 'Visit us'}</a></div>`;

  return layout({
    title: `${capitalise(artOf(federation))} in ${town} — ${federation.name}`,
    description: `${capitalise(artOf(federation))} classes in ${town} for adults and ` +
      `children.${dojo.first_class_free ? ' First class free.' : ''}` +
      (groups.length ? ` ${daysLine} at ${dojo.venue_name}.` : ''),
    canonical: `${origin}${at(`/${dojo.slug}`)}`,
    jsonLd: [dojoJsonLd(dojo, federation, origin, base)],
    image: dojo.hero_url ?? null,
    federation, fonts, nav, base, vocabulary, logoUrl, body,
  });
}

/**
 * A page somebody wrote, as opposed to one projected from the register.
 *
 * Pulled out of build.mjs so that the admin's preview and the published site
 * are the same function. A preview that renders a page a second way is a
 * preview of something nobody will ever see, and it will drift — the only
 * question is when somebody notices.
 */
export function authoredPage({ page, html, federation, origin, fonts, nav,
                               base = '', vocabulary = {}, description }) {
  const at = (p) => `${base}${p}`;
  return layout({
    title: page.meta_title ?? `${page.title} — ${federation.name}`,
    description: page.meta_description ?? description ?? '',
    canonical: `${origin}${at('/' + page.slug)}`,
    federation, fonts, nav, base, vocabulary,
    body: `<section><div class="wrap narrow">
      <h1 style="font-family:var(--display);font-size:clamp(30px,5vw,46px);margin:0 0 20px">${esc(page.title)}</h1>
      ${html}
    </div></section>`,
  });
}

/**
 * What can honestly be said about all of them at once.
 *
 * This line used to read "Every one takes beginners, and your first class is
 * free" — printed over every federation's list regardless of what any dojo had
 * said. Three of MOKNZ's seventeen clubs have a profile row at all, so the
 * national site was making a promise to the public on behalf of fourteen
 * businesses that had never been asked.
 *
 * accepts_beginners and first_class_free are real per-dojo columns. A claim
 * about all of them is made only when all of them have actually said so;
 * otherwise the page says nothing and the individual dojo pages speak for
 * themselves. Silence is free, and a wrong promise is somebody turning up to
 * a class expecting not to pay.
 */
function welcomeLine(dojos = []) {
  if (!dojos.length) return '';
  const all = (field) => dojos.every((d) => d[field] === true);
  const beginners = all('accepts_beginners');
  const free = all('first_class_free');
  if (beginners && free) return ' Every one takes beginners, and your first class is free.';
  if (beginners) return ' Every one takes beginners.';
  if (free) return ' Your first class is free.';
  return '';
}

/**
 * The instructors page.
 *
 * Every word on it comes from the register: the grade from the grading
 * record, the title from the title award, the name from the person. Nobody
 * retypes any of it into a website, which is the whole claim of this product
 * and the reason a federation stops having a site that says somebody is a
 * 3rd dan four years after they were awarded 4th.
 *
 * Only people whose organisation has published them appear here. An empty
 * page is the correct answer when nobody has been asked yet.
 */
/**
 * An instructor, in one fixed format wherever they appear (a dojo's page, the Instructors page): photograph, name,
 * title and grade, what they teach, how long they have trained, a few words about them, and the checks they have
 * chosen to show. Every instructor is the same shape; only the data differs.
 */
function bioText(b) {
  return (b?.blocks ?? []).map((blk) => (typeof blk.text === 'string' ? blk.text : '')).filter(Boolean);
}
function excerpt(text, max = 280) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 200)).replace(/[\s,;:.\-–]+$/, '')}…`;
}
export function instructorCard(i, { at = (x) => x, federationSlug = null, full = false, showClub = false, assets = {} } = {}) {
  const name = `${i.firstName} ${i.lastName}`;
  const photo = i.photoUrl ?? (i.photoAssetId ? assets[i.photoAssetId] : null);
  const paras = i.paragraphs ?? bioText(i.bio);
  const about = full ? paras.map((t) => `<p>${esc(t)}</p>`).join('')
    : paras.length ? `<p>${esc(excerpt(paras.join(' ')))}</p>` : '';
  const rank = [...new Set([i.title, i.grade].filter(Boolean))].map(esc).join(' · ');
  const facts = [
    i.teaches ? `<li><b>Teaches</b> ${esc(i.teaches)}</li>` : '',
    i.startedYear ? `<li><b>Training since</b> ${esc(i.startedYear)}</li>` : '',
  ].filter(Boolean).join('');
  const checks = (i.checks ?? []).map((c) => `<li>${esc(c)}</li>`).join('');
  return `<article class="icard">
    ${photo ? `<img class="iphoto" src="${esc(photo)}" alt="${esc(name)}" loading="lazy">`
            : `<div class="iphoto none" aria-hidden="true">${esc(`${i.firstName[0] ?? ''}${i.lastName[0] ?? ''}`)}</div>`}
    <h3>${esc(name)}</h3>
    ${rank ? `<p class="irank">${rank}</p>` : ''}
    ${showClub && i.organisationName && i.organisationSlug !== federationSlug
      ? `<p class="iclub"><a href="${at(`/${esc(i.organisationSlug)}`)}">${esc(i.organisationName)}</a></p>` : ''}
    ${facts ? `<ul class="ifacts">${facts}</ul>` : ''}
    ${about}
    ${checks ? `<ul class="ichecks" aria-label="Checks">${checks}</ul>` : ''}
  </article>`;
}

export function instructorsPage({ instructors = [], federation, origin, fonts,
                                  nav, base = '', vocabulary = {}, assets = {} }) {
  const at = (p) => `${base}${p}`;
  const card = (i) => instructorCard(i, { at, federationSlug: federation.slug, full: true, showClub: true, assets });

  const body = `
<section><div class="wrap">
  <h1 style="font-family:var(--display);font-size:clamp(30px,5vw,46px);margin:0 0 12px">Instructors</h1>
  ${instructors.length
    ? `<div class="icards" style="margin-top:28px">${instructors.map(card).join('')}</div>`
    : `<p style="font-size:19px;max-width:60ch">No instructor has been listed
        here yet.</p>`}
</div></section>`;

  return layout({
    title: `Instructors — ${federation.name}`,
    description: instructors.length
      ? `${instructors.length} instructor${instructors.length === 1 ? '' : 's'} `
        + `teaching ${artOf(federation)} with ${federation.name}.`
      : `Instructors teaching ${artOf(federation)} with ${federation.name}.`,
    canonical: `${origin}${at('/instructors')}`,
    jsonLd: instructors.length ? [{
      '@context': 'https://schema.org', '@type': 'ItemList',
      itemListElement: instructors.map((i, n) => ({
        '@type': 'ListItem', position: n + 1,
        item: { '@type': 'Person', name: `${i.firstName} ${i.lastName}`,
                jobTitle: i.title ?? 'Instructor',
                memberOf: { '@type': 'SportsOrganization',
                            name: i.organisationName ?? federation.name } },
      })),
    }] : [],
    federation, fonts, nav, base, vocabulary, body,
  });
}

export function findADojoPage({ dojos, federation, origin, fonts, nav,
                                base = '', vocabulary = {} }) {
  const at = (p) => `${base}${p}`;
  const ready = dojos.filter((d) => d.published);
  const body = `
<section><div class="wrap">
  <h1 style="font-family:var(--display);font-size:clamp(30px,5vw,46px);margin:0 0 12px">Find a dojo</h1>
  <p style="font-size:19px;max-width:60ch">${dojos.length} ${
    clubsWordOf(vocabulary).toLowerCase()}.${esc(welcomeLine(dojos))}</p>
  <div class="grid" style="margin-top:28px">
    ${dojos.map((d) => `<a href="${at(`/${esc(d.slug)}`)}"><strong>${esc(d.name)}</strong>
      <span>${esc(d.published ? (d.city ?? 'See times and address')
                                : 'Details coming')}</span></a>`).join('')}
  </div>
  <p style="margin-top:22px;color:var(--muted);font-size:15px">
    ${ready.length} of ${dojos.length} pages complete.</p>
</div></section>`;

  return layout({
    title: `Find a dojo — ${federation.name}`,
    description: `${dojos.length} ${clubsWordOf(vocabulary)}. `
      + `Find your nearest.${welcomeLine(dojos)}`,
    canonical: `${origin}${at('/find-a-dojo')}`,
    jsonLd: [{
      '@context':'https://schema.org','@type':'SportsOrganization',
      name: federation.name, url: `${origin}${base}`,
      subOrganization: dojos.map((d) => ({
        '@type':'SportsActivityLocation',
        name: `${d.name} ${vocabulary.club ?? 'Club'}`,
        url: `${origin}${at(`/${d.slug}`)}` })),
    }],
    federation, fonts, nav, base, vocabulary, body,
  });
}

export function eventPage({ ev, federation, origin, fonts, nav,
                            base = '', vocabulary = {}, logoUrl = null, path = null }) {
  logoUrl = logoUrl ?? federation.logoUrl ?? null;
  const at = (p) => `${base}${p}`;
  const map = mapLinks({ latitude: ev.latitude, longitude: ev.longitude, venue: ev.venue_name, address: ev.address_line });
  const raw = !ev.is_own && ev.from_slug && ev.slug.endsWith(`-${ev.from_slug}`)
    ? ev.slug.slice(0, -(ev.from_slug.length + 1)) : ev.slug;
  const canEnter = ev.entries_close && new Date(ev.entries_close) > new Date();
  const when = ev.all_day
    ? date(ev.starts_at)
    : `${date(ev.starts_at)}, ${clock(ev.starts_at)}${ev.ends_at ? ` – ${clock(ev.ends_at)}` : ''}`;
  const detail = [
    ['When', esc(when)],
    ev.venue_name || ev.address_line ? ['Where', `${ev.venue_name ? `<strong>${esc(ev.venue_name)}</strong><br>` : ''}${esc(ev.address_line ?? '')}`] : null,
    ev.cost_note ? ['Cost', esc(ev.cost_note)] : null,
    ev.entries_close ? ['Entries close', esc(date(ev.entries_close))] : null,
    ev.contact_name || ev.contact_phone || ev.contact_email ? ['Contact',
      [ev.contact_name ? esc(ev.contact_name) : '',
       ev.contact_phone ? `<a href="tel:${esc(String(ev.contact_phone).replace(/[^+\d]/g, ''))}">${esc(ev.contact_phone)}</a>` : '',
       ev.contact_email ? `<a href="mailto:${esc(ev.contact_email)}">${esc(ev.contact_email)}</a>` : ''].filter(Boolean).join('<br>')] : null,
    ev.info_url ? ['More information', `<a href="${esc(ev.info_url)}" rel="noopener">${esc(ev.info_url.replace(/^https:\/\//, ''))}</a>`] : null,
  ].filter(Boolean);

  const body = `
<h1 class="sr">${esc(ev.title)}</h1>
${eventBanner(ev, { logoUrl, federationName: federation.name })}
<section><div class="wrap evgrid">
  <div>
    ${ev.summary ? `<p style="font-size:20px">${esc(ev.summary)}</p>` : ''}
    ${ev.status === 'cancelled' ? '<div class="notice">This event has been cancelled.</div>' : ''}
    ${String(ev.description ?? '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
      .map((p) => `<p class="evdesc">${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}
    ${ev.status === 'cancelled' ? '' : `<p><a class="btn ghost" href="${at(`${path ?? `/events/${ev.slug}`}/event.ics`)}" download>Add to calendar</a></p>`}
    ${canEnter ? `<p><a class="btn" href="/enter/${esc(ev.from_slug ?? '')}/${esc(raw)}">Enter this event</a></p>` : ''}
    ${ev.from_org ? `<p class="muted">Run by ${esc(ev.from_org)}.</p>` : ''}
  </div>
  <aside class="evside" aria-label="Event details">
    <h2>Details</h2>
    <dl style="margin:0">${detail.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    ${map ? `<div class="evmap">${map.embed
      ? `<iframe src="${esc(map.embed)}" title="Map of ${esc(ev.venue_name ?? 'the venue')}" loading="lazy" referrerpolicy="no-referrer"></iframe>` : ''}
      <div class="links"><a href="${esc(map.google)}" rel="noopener">Open in Google Maps</a><a href="${esc(map.osm)}" rel="noopener">OpenStreetMap</a></div></div>` : ''}
  </aside>
</div></section>`;

  return layout({
    title: `${ev.title} — ${federation.name}`,
    description: ev.summary ?? `${ev.title}, ${date(ev.starts_at)}.`,
    canonical: `${origin}${at(path ?? `/events/${ev.slug}`)}`,
    jsonLd: [eventJsonLd(ev, federation, origin, base)],
    federation, fonts, nav, base, vocabulary, logoUrl, body,
  });
}

/**
 * Every event, and every article, on a page of their own.
 *
 * These did not exist. The navigation offered /events and the home page linked
 * to /news/<slug>, and neither was ever built — so the one link in the menu
 * that a visitor is most likely to press went to a 404, on every federation
 * including MOKNZ. A menu that offers a page which is not there is worse than
 * a menu with one fewer item.
 */
export function eventsPage({ events, federation, origin, fonts, nav,
                             base = '', vocabulary = {}, logoUrl = null }) {
  logoUrl = logoUrl ?? federation.logoUrl ?? null;
  const at = (p) => `${base}${p}`;
  const body = `
<div class="hero small"><div class="wrap">
  <h1>Events</h1>
  <p>${events.length
    ? `${events.length} coming up.`
    : 'Nothing on the calendar at the moment.'}</p>
</div></div>
<section><div class="wrap">
  ${events.length ? `<div class="evcards">${events.map((e) => `<a class="evcard" href="${at(`/events/${esc(e.slug)}`)}">
    ${eventBanner(e, { logoUrl, federationName: federation.name, small: true })}
  </a>`).join('')}</div>`
  : '<p>Check back closer to the season.</p>'}
</div></section>`;

  return layout({
    title: `Events — ${federation.name}`,
    description: `Gradings, tournaments, camps and seminars run by ${federation.name}.`,
    canonical: `${origin}${at('/events')}`,
    federation, fonts, nav, base, vocabulary, logoUrl, body,
  });
}

export function newsPage({ articles, federation, origin, fonts, nav,
                           base = '', vocabulary = {} }) {
  const at = (p) => `${base}${p}`;
  const body = `
<div class="hero small"><div class="wrap">
  <h1>News</h1>
</div></div>
<section><div class="wrap narrow">
  ${articles.length ? `<ul class="list">${articles.map((a) => `<li>
    <h3><a href="${at(`/news/${esc(a.slug)}`)}">${esc(a.title)}</a></h3>
    ${a.published_at ? `<p class="muted">${esc(date(a.published_at))}${
      a.about_org ? ' · ' + esc(a.about_org) : ''}</p>` : ''}
    ${a.summary ? `<p>${esc(a.summary)}</p>` : ''}
  </li>`).join('')}</ul>` : '<p>Nothing published yet.</p>'}
</div></section>`;

  return layout({
    title: `News — ${federation.name}`,
    description: `News from ${federation.name}.`,
    canonical: `${origin}${at('/news')}`,
    federation, fonts, nav, base, vocabulary, body,
  });
}

export function articlePage({ article, html, federation, origin, fonts, nav,
                              base = '', vocabulary = {} }) {
  const at = (p) => `${base}${p}`;
  const body = `
<div class="hero small"><div class="wrap">
  <h1>${esc(article.title)}</h1>
  ${article.published_at ? `<p>${esc(date(article.published_at))}${
    article.about_org ? ' · ' + esc(article.about_org) : ''}</p>` : ''}
</div></div>
<section><div class="wrap narrow">${html}</div></section>`;

  return layout({
    title: `${article.title} — ${federation.name}`,
    description: article.summary ?? article.title,
    canonical: `${origin}${at(`/news/${article.slug}`)}`,
    federation, fonts, nav, base, vocabulary, body,
  });
}

/**
 * The hero copy comes from settings. It used to be written here, which made
 * data/settings.json a liar: it offered heroHeading, heroText and heroButton
 * and nothing read them. The defaults below are MOKNZ's words, kept only so an
 * empty settings file still renders something.
 */
export function homePage({ federation, dojos, events, articles, origin, fonts,
                           nav, homeCopy = {}, base = '', vocabulary = {}, heroUrl = null,
                           sections = HOME_DEFAULT }) {
  const at = (p) => `${base}${p}`;
  const heading = homeCopy.heroHeading ?? 'Everyone starts somewhere.';
  const heroText = homeCopy.heroText
    ?? `${capitalise(artOf(federation))} taught at ${dojos.length} `
     + `${clubsWordOf(vocabulary)}.`;
  const heroButton = homeCopy.heroButton ?? `Find your ${clubWord(vocabulary)}`;

  const parts = {
    hero: () => `
<div class="hero${heroUrl ? ' photo' : ''}"${heroUrl
  ? ` style="background-image:linear-gradient(100deg,rgba(10,10,12,.78),rgba(10,10,12,.3)),url('${esc(heroUrl)}')"`
  : ''}><div class="wrap">
  <h1>${esc(heading)}</h1>
  <p>${esc(heroText)}</p>
  <div class="actions"><a class="btn" href="${at('/find-a-dojo')}">${esc(heroButton)}</a>
  <a class="btn ghost" href="${at('/events')}">Events</a></div>
</div></div>`,

    // Only what each club has said. "Book a free class" was printed under
    // every club whether it offered one or not.
    dojoGrid: () => dojos.length ? `<section><div class="wrap">
  <h2>Where we train</h2>
  <div class="grid">${dojos.slice(0,16).map((d) =>
    `<a href="${at(`/${esc(d.slug)}`)}"${d.hero_url
      ? ` style="background-image:url('${esc(d.hero_url)}')"` : ''}><strong>${esc(d.name)}</strong><span>${
      d.first_class_free ? 'First class free' : 'See times'}</span></a>`).join('')}</div>
</div></section>` : '',

    events: () => events.length ? `<section style="background:var(--canvas-alt)"><div class="wrap">
  <h2>Coming up</h2>
  <ul class="events">${events.slice(0,5).map((e) => {
    const d = new Date(e.starts_at);
    return `<li><div class="d"><b>${d.getDate()}</b>
      <span>${d.toLocaleDateString('en-NZ',{month:'short'})}</span></div>
      <div><h3><a href="${at(`/events/${esc(e.slug)}`)}">${esc(e.title)}</a></h3>
      <p>${esc(e.venue_name ?? e.from_org ?? '')}</p></div></li>`;
  }).join('')}</ul>
</div></section>` : '',

    news: () => articles.length ? `<section><div class="wrap">
  <h2>News</h2>
  <ul class="events">${articles.map((a) =>
    `<li><div class="d"><b>${new Date(a.published_at).getDate()}</b>
      <span>${new Date(a.published_at).toLocaleDateString('en-NZ',{month:'short'})}</span></div>
      <div>${a.about_org ? `<span class="tag">${esc(a.about_org)}</span>` : ''}
      <h3><a href="${at(`/news/${esc(a.slug)}`)}">${esc(a.title)}</a></h3>
      <p>${esc(a.summary ?? '')}</p></div></li>`).join('')}</ul>
</div></section>` : '',
  };

  // Every home-page section is its own full-width band.
  const body = sections.map((name) => parts[name]?.() ?? '').filter(Boolean).join('\n');

  return layout({
    title: `${federation.name} — ${capitalise(artOf(federation))}`,
    description: `${capitalise(artOf(federation))}. ${dojos.length} ${clubsWordOf(vocabulary)} ` +
      `nationwide.`,
    canonical: `${origin}${base}`,
    jsonLd: [{
      '@context':'https://schema.org','@type':'SportsOrganization',
      name: federation.name, url: `${origin}${base}`, sport: disciplineOf(federation),
      foundingDate: CalendarDay.from(federation.founded)?.value ?? undefined,
    }],
    federation, fonts, nav, base, vocabulary, body,
  });
}

export { esc, groupSessions, time, date };
