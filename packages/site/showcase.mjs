/**
 * HONBU — THE SHOWCASE LAYOUT
 *
 * One of the layouts a theme can choose by name (see theme.mjs). It is the look the Mas Oyama
 * federation approved from its clickable prototype: a belt stripe above a dark masthead with the
 * crest, a hero with a "find your nearest club" box, a proof strip, a first-night explainer, a
 * pathway, a dark band of club grouped by region, event cards, and a club page built from the
 * same parts.
 *
 * Why this is code and not part of a theme file: a theme is DATA a federation may download from a
 * stranger, and the one thing it must never carry is markup or CSS. A layout is shipped with
 * Honbu, reviewed with Honbu, and a theme only picks one by name.
 *
 * Why the words are not here: a layout carries no sentences. Everything a visitor reads comes
 * from the federation (data/settings.json, `homePage` and `clubPage`), the register, or the
 * database. A section whose words the federation has not written is left out, never filled with
 * somebody else's.
 *
 * Pure: strings in, strings out. The helpers it needs from render.mjs are handed in, so this file
 * imports nothing and there is no cycle.
 */

const HEX = /^#[0-9a-fA-F]{6}$/;
const SAFE_PATH = /^\/[A-Za-z0-9._~\-/]*$/;
const MEDIA_PATH = /^\/media\/[A-Za-z0-9._-]+$/;

import { titledName, gradeMarkup } from './honorifics.mjs';
import { DEFAULT_TIMEZONE } from '../core/domain/defaults.mjs';
import { region } from '../infrastructure/region-context.mjs';

/**
 * Where a link may point: this site, or an https address. Never javascript:, data: or a
 * protocol-relative //host — copy comes from a settings file somebody edits on a phone.
 */
export function safeHref(href) {
  const h = String(href ?? '').trim();
  if (SAFE_PATH.test(h) && !h.startsWith('//')) return h;
  if (/^https:\/\/[A-Za-z0-9.-]+(\/[^\s"'<>]*)?$/.test(h)) return h;
  return null;
}

/** An image a federation points at: one of its own files under /media, or nothing. */
export function safeImage(src) {
  const s = String(src ?? '').trim();
  return MEDIA_PATH.test(s) ? s : null;
}

const asText = (v, max = 400) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const list = (v) => (Array.isArray(v) ? v : []);

/**
 * The stylesheet. It REPLACES the classic layout's shell (header, hero, buttons, facts, sections,
 * grid) and keeps its components (event banners, instructor cards, gallery, lightbox), which are
 * the same on every layout. render.mjs puts them together.
 *
 * The prototype's names for colours are mapped onto the theme's tokens, so a federation that
 * chooses this layout with its own five colours gets its own colours in the same arrangement.
 */
export const SHOWCASE_CSS = `
:root{
  --red:var(--primary);--red-dark:var(--primary-text-strong);--red-deep:var(--primary-hover);
  --gold:var(--accent);--ink-2:var(--ink-soft);
  --ink-3:color-mix(in srgb,var(--ink) 78%,var(--neutral));
  --canvas-2:var(--canvas-alt);--silver:var(--neutral);
}
*{box-sizing:border-box}
body{margin:0;background:var(--canvas);color:var(--ink);font-family:var(--body);font-size:17px;line-height:1.75}
.wrap{max-width:1140px;margin:0 auto;padding:0 28px}
.narrow{max-width:820px}
a{color:var(--red-dark)}
img{max-width:100%;display:block}
:focus-visible{outline:3px solid var(--red);outline-offset:3px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

.belt{height:9px;display:flex;gap:1px;background:#8C857A;border-top:1px solid #8C857A;border-bottom:1px solid #8C857A}
.belt i{flex:1}

.masthead{background:var(--ink);color:var(--canvas);position:sticky;top:0;z-index:20}
.masthead .wrap{display:flex;align-items:center;gap:15px;padding-top:12px;padding-bottom:12px}
.brand{display:flex;align-items:center;gap:15px;color:var(--canvas);text-decoration:none}
.brand img{width:46px;height:auto;flex:none}
.wordmark{font-family:var(--display);font-size:18px;font-weight:800;line-height:1.2;color:var(--canvas)}
.wordmark span{display:block;font-family:var(--body);font-size:11.5px;font-weight:400;color:var(--silver);letter-spacing:.09em}
.nav{margin-left:auto;display:flex;gap:22px;font-size:15px;font-weight:500;align-items:center}
.nav a{color:var(--canvas);text-decoration:none;border-bottom:2px solid transparent;padding-bottom:3px}
.nav a:hover{border-bottom-color:var(--red)}
.navtoggle{position:absolute;opacity:0;width:1px;height:1px}
.menubtn{display:none;margin-left:auto;padding:8px;cursor:pointer;line-height:0}
.menubtn span{display:block;width:26px;height:2px;background:var(--canvas);margin:5px 0;transition:transform .18s,opacity .18s}
.navtoggle:focus-visible~.menubtn{outline:3px solid var(--red);outline-offset:2px}
.navtoggle:checked~.menubtn span:nth-child(1){transform:translateY(7px) rotate(45deg)}
.navtoggle:checked~.menubtn span:nth-child(2){opacity:0}
.navtoggle:checked~.menubtn span:nth-child(3){transform:translateY(-7px) rotate(-45deg)}

.crumb{background:var(--ink-2);color:var(--silver);font-size:14px}
.crumb .wrap{padding-top:9px;padding-bottom:9px}
.crumb a{color:var(--silver)}

.hero{position:relative;background:var(--ink);color:var(--canvas);overflow:hidden}
.hero.tall{min-height:min(74vh,620px);display:flex;align-items:flex-end}
.hero.tall>.wrap{width:100%}
.hero .photo{position:absolute;inset:0}
.hero .photo img{width:100%;height:100%;object-fit:cover}
.hero .veil{position:absolute;inset:0;
  background:linear-gradient(90deg,rgba(28,28,30,.94) 0%,rgba(28,28,30,.84) 42%,rgba(28,28,30,.55) 72%,rgba(28,28,30,.45) 100%)}
.hero.plain{background-color:var(--ink);
  background-image:radial-gradient(ellipse 80% 70% at 78% 45%,rgba(255,255,255,.07) 0%,rgba(0,0,0,0) 70%)}
.hero .crestwrap{position:absolute;right:0;top:0;bottom:0;width:min(58%,660px);display:grid;place-items:center;pointer-events:none}
.hero .crest{position:relative;width:min(32vw,360px);opacity:.3}
.hero .wrap{position:relative;padding-top:74px;padding-bottom:56px}
.hero h1{font-family:var(--display);font-weight:800;font-size:clamp(38px,7vw,84px);line-height:1;margin:0 0 16px;max-width:15ch;letter-spacing:-.02em}
.hero p{font-size:19px;color:#CFCFD1;max-width:44ch;margin:0 0 26px}
.hero .kicker{color:var(--gold);font-weight:700;letter-spacing:.1em;font-size:13.5px;margin:0 0 12px}

.btn{display:inline-block;font-family:var(--body);font-size:16px;font-weight:700;padding:14px 28px;text-decoration:none;
  border:2px solid var(--red);background:var(--red);color:#fff;cursor:pointer;line-height:1.5}
.btn:hover,.btn-solid:hover{background:var(--red-deep);border-color:var(--red-deep)}
.btn-ghost,.btn.ghost{background:none;border-color:currentColor;color:var(--canvas)}
.btn-ghost:hover,.btn.ghost:hover{background:var(--canvas);border-color:var(--canvas);color:var(--ink)}
.btn.outline{background:none;color:var(--ink);border-color:var(--ink)}
.btn.outline:hover{background:var(--ink);color:var(--canvas)}
.btn.light{background:var(--canvas);border-color:var(--canvas);color:var(--ink)}
.actions{display:flex;gap:12px;flex-wrap:wrap}

.finder{background:var(--canvas);color:var(--ink);padding:20px 22px;max-width:560px;border-top:6px solid var(--red)}
.finder label{display:block;font-weight:700;font-size:16px;margin:0 0 10px}
.finder .row{display:flex;gap:10px;flex-wrap:wrap}
.finder select{flex:1;min-width:190px;font-family:var(--body);font-size:16px;padding:13px 14px;border:2px solid var(--ink);background:#fff;color:var(--ink)}
.finder p{margin:12px 0 0;font-size:14.5px;color:var(--muted)}

.proof{background:var(--ink-2);color:var(--canvas)}
.proof .wrap{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:24px;padding-top:28px;padding-bottom:28px}
.proof b{display:block;font-family:var(--display);font-size:32px;font-weight:800;color:var(--gold);line-height:1.1}
.proof span{font-size:15px;color:#C4C4C6}

section{padding:62px 0}
h1.page{font-family:var(--display);font-weight:800;font-size:clamp(34px,5.4vw,54px);margin:0 0 14px;letter-spacing:-.02em;line-height:1.06}
h2{font-family:var(--display);font-weight:800;font-size:clamp(26px,3.6vw,40px);margin:0 0 6px;letter-spacing:-.02em;line-height:1.15}
h2::after{content:"";display:block;width:52px;height:4px;background:var(--red);margin:14px 0 24px}
h3{font-family:var(--display)}
p{margin:0 0 18px}
.lede{font-size:19.5px;color:#3C3C40}
.sechead{display:flex;align-items:baseline;gap:16px;flex-wrap:wrap}
.sechead a{margin-left:auto;font-size:15px;font-weight:500}

.three{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:28px}
.three .pic{aspect-ratio:4/3;margin-bottom:15px;background:var(--ink-2)}
.three .pic img{width:100%;height:100%;object-fit:cover}
.three h3{font-size:23px;font-weight:800;margin:0 0 8px;line-height:1.25}
.three p{margin:0;color:#46464A;font-size:16px}

.path{background:var(--canvas-2)}
.steps{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:0;margin-top:8px}
.step{position:relative;padding:26px 18px 22px;border-top:5px solid var(--silver)}
.step b{display:block;font-family:var(--display);font-size:13px;letter-spacing:.09em;color:var(--muted);margin-bottom:8px}
.step h3{font-size:21px;font-weight:800;margin:0 0 8px;line-height:1.2}
.step p{margin:0;font-size:15px;color:#46464A}

.says{background:var(--canvas-2)}
.quotes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:30px}
.quote{border-top:4px solid var(--red);padding-top:20px}
.quote p{font-family:var(--display);font-size:clamp(18px,2.2vw,21px);font-weight:600;line-height:1.5;margin:0 0 14px;color:var(--ink)}
.quote cite{font-style:normal;font-size:14.5px;color:var(--muted);font-weight:500}
.quote cite b{display:block;color:var(--ink);font-weight:700;font-size:15.5px}

.club-band{background:var(--ink);color:var(--canvas)}
.club-band h2{color:var(--canvas)}
.region{margin-bottom:30px}
.region h3{font-size:17px;font-weight:600;color:var(--gold);margin:0 0 13px;padding-bottom:8px;border-bottom:1px solid var(--ink-3)}
.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:2px;background:var(--ink-3)}
.grid a{background:var(--ink-2);padding:17px 20px;text-decoration:none;display:block;color:var(--canvas)}
.grid a:hover{background:var(--red)}
.grid strong{display:block;font-family:var(--display);font-size:19px;font-weight:800}
.grid span{font-size:14px;color:var(--silver)}
.grid a:hover span{color:#F6D8D5}

.ev{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}
.card{background:#fff;display:flex;flex-direction:column;border-top:5px solid var(--gold);text-decoration:none;color:var(--ink)}
.card.local{border-top-color:var(--red)}
.card .pic{background:#000;overflow:hidden}
.card .pic .evbanner{padding:20px 18px;min-height:150px}
.card .body{padding:18px 20px 22px;display:flex;flex-direction:column;flex:1}
.badge{font-size:12px;font-weight:700;letter-spacing:.08em;padding:3px 9px;align-self:flex-start;margin-bottom:10px}
.badge.local{background:var(--red);color:#fff}
.badge.national{background:var(--ink);color:var(--gold)}
.card .when{font-family:var(--display);font-size:14.5px;font-weight:600;color:var(--muted);margin:0 0 4px}
.card h3{font-size:20px;font-weight:800;margin:0 0 8px;line-height:1.25}
.card p{margin:0 0 14px;font-size:15px;color:#46464A;flex:1}
.card .more{font-size:14.5px;font-weight:700;color:var(--red-dark)}

.facts{background:var(--ink-2);color:var(--canvas)}
.facts .wrap{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));padding:0}
.facts div{padding:24px 28px;border-right:1px solid var(--ink-3)}
.facts div:last-child{border-right:0}
.facts b{display:block;font-family:var(--display);font-size:14.5px;color:var(--gold);font-weight:600;margin-bottom:6px;letter-spacing:.03em}
.facts p{margin:0;font-size:16.5px;line-height:1.6}
.facts small{display:block;color:var(--silver);font-size:14.5px;margin-top:4px}
.callrow{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}
.callbtn{display:inline-flex;align-items:center;gap:8px;background:var(--red);color:#fff;font-weight:700;font-size:16px;padding:13px 22px;text-decoration:none}
.callbtn:hover{background:var(--red-deep)}
.turnup{background:var(--gold);color:var(--ink);padding:16px 20px;margin:0 0 22px;font-family:var(--display);font-size:19px;font-weight:800;line-height:1.4}

table.times{width:100%;border-collapse:collapse;margin:0 0 20px;font-size:16.5px}
table.times th{text-align:left;font-family:var(--display);font-size:16px;font-weight:700;padding:11px 0;border-bottom:2px solid var(--ink)}
table.times td{padding:13px 0;border-bottom:1px solid var(--silver)}
table.times td:first-child{font-weight:700;width:36%}
table.times td:last-child{color:var(--muted);text-align:right}

.split{display:grid;grid-template-columns:1fr 1fr;gap:50px;align-items:center}
.portrait{aspect-ratio:4/5;background:var(--ink-2)}
.portrait img{width:100%;height:100%;object-fit:cover;object-position:center 30%}
.dark{background:var(--ink);color:var(--canvas)}
.dark h2{color:var(--canvas)}
.dark p{color:#C4C4C6}
.dark ol{margin:0;padding:0;list-style:none;counter-reset:s;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:28px}
.dark ol li{counter-increment:s;padding-top:15px;border-top:3px solid var(--red)}
.dark ol li::before{content:counter(s);font-family:var(--display);font-size:15px;color:var(--gold);font-weight:700;display:block;margin-bottom:8px}
.dark ol h3{font-size:20px;font-weight:800;margin:0 0 8px}
.dark ol p{color:#B8B8BB;font-size:15.5px;margin:0}

.gal{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;list-style:none;margin:0;padding:0}
.gal .t{aspect-ratio:1}
.gal .t img{width:100%;height:100%;object-fit:cover}

.box{background:#fff;color:var(--ink);padding:30px;border-top:6px solid var(--red);box-shadow:0 1px 0 var(--silver)}
.row{display:grid;grid-template-columns:1fr 1fr;gap:16px}
label{display:block;font-size:14.5px;font-weight:700;margin:0 0 6px}
label .opt{font-weight:400;color:var(--muted)}
input,textarea,select.f{width:100%;font-family:var(--body);font-size:16px;padding:12px 14px;border:2px solid var(--ink-3);background:#fff;color:var(--ink);margin-bottom:16px}
textarea{min-height:96px;resize:vertical}

.national{background:var(--ink-2);color:var(--canvas)}
.national .wrap{display:flex;gap:22px;align-items:center;flex-wrap:wrap;padding-top:32px;padding-bottom:32px}
.national img{width:54px;flex:none}
.national h2{font-size:22px;margin:0;color:var(--canvas)}
.national h2::after{display:none}
.national p{margin:2px 0 0;color:var(--silver);font-size:15.5px}
.national .btn{margin-left:auto;background:none;border-color:currentColor;color:var(--canvas);font-size:15px;padding:12px 24px}
.national .btn:hover{background:var(--canvas);border-color:var(--canvas);color:var(--ink)}

.notice{background:var(--gold);color:var(--ink);padding:14px 18px;margin:20px 0;font-family:var(--display);font-weight:700}
.trialcta{background:var(--red);color:#fff;text-align:center;padding:36px 24px;margin:32px 0}
.trialcta h2{color:#fff;margin:0 0 10px}.trialcta h2::after{display:none}.trialcta p{margin:0 auto 20px;max-width:46ch}

footer.site{background:var(--ink);color:var(--silver);padding:36px 0;font-size:14.5px}
footer.site .wrap{display:flex;gap:20px;flex-wrap:wrap;align-items:center}
footer.site img{width:40px}
footer.site a{color:var(--silver)}
footer.site .links{margin-left:auto;display:flex;gap:18px;flex-wrap:wrap}

@media (max-width:900px){
  .menubtn{display:block}
  .nav{display:none;position:absolute;top:100%;left:0;right:0;margin:0;flex-direction:column;align-items:stretch;gap:0;
    background:var(--ink-2);border-top:1px solid var(--ink-3)}
  .navtoggle:checked~.nav{display:flex}
  .nav a{padding:15px 28px;font-size:17px;border-bottom:1px solid var(--ink-3)}
  .nav a:last-child{border-bottom:0}
  .three,.ev,.dark ol{grid-template-columns:1fr}
  .grid,.proof .wrap{grid-template-columns:repeat(2,minmax(0,1fr))}
  .steps,.quotes{grid-template-columns:1fr}
  .step{border-top-width:4px}
  .facts .wrap{grid-template-columns:1fr}
  .facts div{border-right:0;border-bottom:1px solid var(--ink-3)}
  .split{grid-template-columns:1fr;gap:32px}
  .icards{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media (max-width:620px){
  .wrap{padding:0 20px}
  section{padding:46px 0}
  .hero .crestwrap{width:100%}
  .hero .crest{width:56vw;opacity:.11}
  .grid{grid-template-columns:1fr}
  .row{grid-template-columns:1fr}
  .hero .veil{background:linear-gradient(180deg,rgba(28,28,30,.5) 0%,rgba(28,28,30,.95) 60%)}
  .national .btn{margin-left:0}
  .icards{grid-template-columns:1fr}
}
@media (prefers-reduced-motion:reduce){.menubtn span{transition:none}}
`;

/**
 * Builds the layout's pieces from the helpers render.mjs hands in.
 * `h` = { esc, groupSessions, time, capitalise, artOf, clubWord, clubsWordOf, eventBanner, instructorCard }
 */
export function makeShowcase(h) {
  const { esc } = h;

  const stripeOf = (federation) => list(federation.stripe).filter((c) => HEX.test(c));

  // `known` is the set of paths this site will have a page for. A link to one it will not have is dropped,
  // because a button that leads to a 404 is worse than no button. Set by the build; absent means no check.
  const link = (item, at, known = null) => {
    const href = safeHref(item?.href);
    const label = asText(item?.label, 60);
    if (!href || !label) return null;
    if (href.startsWith('/') && known && !known.has(href.replace(/[?#].*$/, ''))) return null;
    return { href: href.startsWith('/') ? at(href) : href, label };
  };

  function belt(federation) {
    const colours = stripeOf(federation);
    return colours.length
      ? `<div class="belt" aria-hidden="true">${colours.map((c) => `<i style="background:${c}"></i>`).join('')}</div>`
      : '';
  }

  /** The belt stripe, the masthead and its menu. */
  function header({ federation, nav, at, logoUrl }) {
    const w = federation.wordmark ?? {};
    const main = asText(w.main, 40) || federation.name;
    const sub = asText(w.sub, 40) || (federation.wordmark ? '' : (federation.country_code ?? ''));
    return `${belt(federation)}
<header class="masthead"><div class="wrap">
  <a class="brand" href="${at('/')}">${logoUrl ? `<img src="${esc(logoUrl)}" alt="">` : ''}<span class="wordmark">${esc(main)}${sub ? `<span>${esc(sub)}</span>` : ''}</span></a>
  <input type="checkbox" class="navtoggle" id="navtoggle" aria-label="Open the menu">
  <label class="menubtn" for="navtoggle" aria-hidden="true"><span></span><span></span><span></span></label>
  <nav class="nav" aria-label="Main">${nav.map((n) => `<a href="${at(n.href)}">${esc(n.label)}</a>`).join('')}</nav>
</div></header>`;
  }

  function footer({ federation, at, logoUrl, footerLinks = [] }) {
    const line = asText(federation.footerLine, 160) || federation.name;
    return `${belt(federation)}
<footer class="site"><div class="wrap">
  ${logoUrl ? `<img src="${esc(logoUrl)}" alt="">` : ''}<span>${esc(line)}</span>
  <span class="links">${footerLinks.map((l) => `<a href="${at(l.href)}">${esc(l.label)}</a>`).join('')}</span>
</div></footer>`;
  }

  const crumb = (at, trail) => `<div class="crumb"><div class="wrap"><a href="${at('/')}">Home</a>${
    trail.map((t) => ` › ${t.href ? `<a href="${at(t.href)}">${esc(t.label)}</a>` : esc(t.label)}`).join('')}</div></div>`;

  // ---- the shared pieces ---------------------------------------------------

  // In the timezone of the place the event is held, never the server's own: a Saturday event must not read as Friday.
  const day = (d, tz = DEFAULT_TIMEZONE) => new Date(d).toLocaleDateString(region().locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz });

  /** An event as a card: the federation's text banner, then what, when and where. */
  function eventCard(e, { at, federation, logoUrl, vocabulary, clubSlug = null }) {
    // The federation's own events are NATIONAL; anything else carries the name of the club running it.
    const national = e.from_org === federation.name;
    const href = clubSlug && e.is_own ? `/${clubSlug}/events/${e.slug}` : `/events/${e.slug}`;
    const where = e.venue_name ? ` · ${esc(e.venue_name)}` : '';
    return `<a class="card${national ? '' : ' local'}" href="${at(href)}">
  <div class="pic">${h.eventBanner(e, { logoUrl, federationName: federation.name, small: true, vocabulary })}</div>
  <div class="body"><span class="badge ${national ? 'national' : 'local'}">${esc(national ? 'NATIONAL' : String(e.from_org ?? '').toUpperCase())}</span>
  <p class="when">${esc(day(e.starts_at, e.host_timezone ?? undefined))}${where}</p><h3>${esc(e.title)}</h3>
  ${e.summary ? `<p>${esc(e.summary)}</p>` : '<p></p>'}<span class="more">Details →</span></div>
</a>`;
  }

  function federationBand({ copy, at, logoUrl, federation, clubCount }) {
    const known = federation.knownPaths ?? null;
    const c = copy?.federationBand;
    const title = asText(c?.heading, 120);
    if (!title) return '';
    const text = asText(c?.text, 240).replace(/\{clubs\}/g, String(clubCount ?? ''));
    const b = link(c?.button, at, known);
    return `<div class="national"><div class="wrap">
  ${logoUrl ? `<img src="${esc(logoUrl)}" alt="">` : ''}
  <div><h2>${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ''}</div>
  ${b ? `<a class="btn" href="${esc(b.href)}">${esc(b.label)}</a>` : ''}
</div></div>`;
  }

  // ---- the home page --------------------------------------------------------

  function homeParts({ federation, clubs, events, articles, at, copy, heroUrl, logoUrl, vocabulary,
                       heading, heroText }) {
    const clubWordL = h.clubWord(vocabulary);
    const clubsWordL = h.clubsWordOf(vocabulary);
    const known = federation.knownPaths ?? null;
    const stat = (v) => String(v ?? '').replace(/\{clubs\}/g, String(clubs.length));
    const allFree = clubs.length > 0 && clubs.every((d) => d.first_class_free === true);
    const media = (src, alt, extra = '') => { const s = safeImage(src); return s ? `<img src="${esc(s)}" alt="${esc(asText(alt, 200))}"${extra} loading="lazy">` : ''; };

    return {
      hero: () => {
        const photo = heroUrl ? `<div class="photo" aria-hidden="true"><img src="${esc(heroUrl)}" alt=""></div><div class="veil"></div>`
          : (logoUrl ? `<div class="crestwrap" aria-hidden="true"><img class="crest" src="${esc(logoUrl)}" alt=""></div>` : '');
        return `<div class="hero tall${heroUrl ? '' : ' plain'}">${photo}
  <div class="wrap">
    <h1>${esc(heading)}</h1>
    <p>${esc(heroText)}</p>
    ${clubs.length ? `<div class="finder">
      <label for="finder-select">Find your nearest ${esc(clubWordL)}</label>
      <div class="row"><select id="finder-select" data-finder><option value="">Choose your town</option>${
        clubs.map((d) => `<option value="${esc(at(`/${d.slug}`))}">${esc(d.name)}</option>`).join('')}</select>
      <a class="btn btn-solid" href="${at('/find-a-club')}" data-finder-go>Go</a></div>
      <p>Not sure? <a href="${at('/find-a-club')}">See all ${clubs.length} ${esc(clubsWordL)}</a>.</p>
    </div>` : ''}
  </div>
</div>`;
      },

      proof: () => {
        const items = list(copy.stats)
          .filter((s) => asText(s?.value, 20) && asText(s?.label, 80))
          .filter((s) => s.when !== 'allFree' || allFree);
        return items.length ? `<div class="proof"><div class="wrap">${
          items.map((s) => `<div><b>${esc(stat(asText(s.value, 20)))}</b><span>${esc(asText(s.label, 80))}</span></div>`).join('')
        }</div></div>` : '';
      },

      firstNight: () => {
        const c = copy.firstNight; const items = list(c?.items).filter((i) => asText(i?.title, 80));
        if (!items.length) return '';
        const more = link(c.link, at, known);
        return `<section><div class="wrap">
    <div class="sechead"><h2>${esc(asText(c.heading, 120))}</h2>${more ? `<a href="${esc(more.href)}">${esc(more.label)}</a>` : ''}</div>
    <div class="three">${items.slice(0, 3).map((i) => `<article>${safeImage(i.image) ? `<div class="pic">${media(i.image, i.alt)}</div>` : ''}
      <h3>${esc(asText(i.title, 80))}</h3><p>${esc(asText(i.text, 280))}</p></article>`).join('')}</div>
  </div></section>`;
      },

      pathway: () => {
        const c = copy.pathway; const steps = list(c?.steps).filter((s) => asText(s?.title, 60));
        if (!steps.length) return '';
        const b = link(c.button, at, known);
        return `<div class="path"><section><div class="wrap">
    <div class="sechead"><div><h2>${esc(asText(c.heading, 120))}</h2></div>${c.intro ? `<p>${esc(asText(c.intro, 240))}</p>` : ''}</div>
    <div class="steps">${steps.slice(0, 5).map((s) => `<div class="step"${HEX.test(s.colour ?? '') ? ` style="border-top-color:${s.colour}"` : ''}>
      ${s.kicker ? `<b>${esc(asText(s.kicker, 30).toUpperCase())}</b>` : ''}<h3>${esc(asText(s.title, 60))}</h3><p>${esc(asText(s.text, 200))}</p></div>`).join('')}</div>
    ${b ? `<p style="margin-top:26px"><a class="btn btn-solid" href="${esc(b.href)}">${esc(b.label)}</a></p>` : ''}
  </div></section></div>`;
      },

      // Real quotes only. A federation that has none yet has no section, not three bracketed gaps.
      quotes: () => {
        const c = copy.quotes; const items = list(c?.items).filter((q) => asText(q?.text, 300) && asText(q?.name, 60));
        if (!items.length) return '';
        return `<div class="says"><section><div class="wrap"><h2>${esc(asText(c.heading, 120) || 'In their own words')}</h2>
    <div class="quotes">${items.slice(0, 3).map((q) => `<div class="quote"><p>&ldquo;${esc(asText(q.text, 300))}&rdquo;</p>
      <cite><b>${esc(asText(q.name, 60))}</b>${esc(asText(q.role, 80))}</cite></div>`).join('')}</div></div></section></div>`;
      },

      photoBand: () => {
        const c = copy.photoBand; const src = safeImage(c?.image);
        return src ? `<div style="position:relative;height:min(46vh,380px);overflow:hidden"><img src="${esc(src)}" alt="${esc(asText(c.alt, 200))}"
    style="width:100%;height:100%;object-fit:cover;object-position:center ${Number.isFinite(+c.position) ? +c.position : 38}%"></div>` : '';
      },

      clubGrid: () => {
        if (!clubs.length) return '';
        const tile = (d) => `<a href="${at(`/${esc(d.slug)}`)}"><strong>${esc(d.name)}</strong><span>${d.first_class_free ? 'Book a free class' : 'See times'}</span></a>`;
        const bySlug = new Map(clubs.map((d) => [d.slug, d]));
        const used = new Set();
        const regions = list(copy.regions).map((r) => ({ name: asText(r?.name, 60),
          clubs: list(r?.slugs).map((s) => bySlug.get(s)).filter(Boolean) })).filter((r) => r.name && r.clubs.length);
        regions.forEach((r) => r.clubs.forEach((d) => used.add(d.slug)));
        const rest = clubs.filter((d) => !used.has(d.slug));
        const groups = regions.length ? [...regions, ...(rest.length ? [{ name: 'More', clubs: rest }] : [])]
          : [{ name: '', clubs }];
        return `<div class="club-band"><section><div class="wrap">
    <div class="sechead"><h2>Where we train</h2><a href="${at('/find-a-club')}" style="color:var(--gold)">All ${esc(clubsWordL)}</a></div>
    ${groups.map((g) => `<div class="region">${g.name ? `<h3>${esc(g.name)}</h3>` : ''}<div class="grid">${g.clubs.map(tile).join('')}</div></div>`).join('')}
  </div></section></div>`;
      },

      lineage: () => {
        const c = copy.lineage; if (!asText(c?.heading, 120)) return '';
        const b = link(c.button, at, known);
        return `<section style="background:var(--canvas-2)"><div class="wrap"><div class="split">
    <div><h2>${esc(asText(c.heading, 120))}</h2>${list(c.paragraphs).slice(0, 4).map((p) => `<p>${esc(asText(p, 400))}</p>`).join('')}
      ${b ? `<a class="btn btn-solid" href="${esc(b.href)}">${esc(b.label)}</a>` : ''}</div>
    ${safeImage(c.image) ? `<div class="portrait">${media(c.image, c.alt)}</div>` : ''}
  </div></div></section>`;
      },

      events: () => {
        const upcoming = events.slice(0, 3);
        if (!upcoming.length) return '';
        return `<section><div class="wrap">
    <div class="sechead"><h2>Coming up</h2><a href="${at('/events')}">Full calendar</a></div>
    <div class="ev">${upcoming.map((e) => eventCard(e, { at, federation, logoUrl, vocabulary })).join('')}</div>
  </div></section>`;
      },

      spotlight: () => {
        const c = copy.spotlight; if (!asText(c?.heading, 120)) return '';
        const b = link(c.button, at, known);
        return `<div class="dark"><section style="padding:56px 0"><div class="wrap"><div class="split">
    <div><h2>${esc(asText(c.heading, 120))}</h2>${list(c.paragraphs).slice(0, 3).map((p) => `<p>${esc(asText(p, 400))}</p>`).join('')}
      ${b ? `<a class="btn btn-solid" href="${esc(b.href)}">${esc(b.label)}</a>` : ''}</div>
    ${safeImage(c.image) ? `<div class="portrait" style="aspect-ratio:3/4">${media(c.image, c.alt, ' style="object-position:center top"')}</div>` : ''}
  </div></div></section></div>`;
      },

      news: () => articles.length ? `<section><div class="wrap">
  <div class="sechead"><h2>News</h2><a href="${at('/news')}">All news</a></div>
  <ul class="events">${articles.map((a) =>
    `<li><div class="d"><b>${h.dayNum(a.published_at)}</b>
      <span>${h.monthShort(a.published_at)}</span></div>
      <div>${a.about_org ? `<span class="tag">${esc(a.about_org)}</span>` : ''}
      <h3><a href="${at(`/news/${esc(a.slug)}`)}">${esc(a.title)}</a></h3>
      <p>${esc(a.summary ?? '')}</p></div></li>`).join('')}</ul>
</div></section>` : '',

      memberBand: () => {
        const c = copy.memberBand; if (!asText(c?.heading, 120)) return '';
        const b = link(c.button, at, known);
        return `<div class="national"><div class="wrap">
  ${logoUrl ? `<img src="${esc(logoUrl)}" alt="">` : ''}
  <div><h2>${esc(asText(c.heading, 120))}</h2>${c.text ? `<p>${esc(asText(c.text, 240))}</p>` : ''}</div>
  ${b ? `<a class="btn" href="${esc(b.href)}">${esc(b.label)}</a>` : ''}
</div></div>`;
      },
    };
  }

  // ---- a club's page --------------------------------------------------------

  function clubParts({ club, federation, events, at, copy, logoUrl, vocabulary, gallery, galleryTotal,
                       instructors, groups, daysLine, free, startAnyWeekText, clubCount }) {
    const town = club.name;
    const phone = club.phone && !String(club.phone).startsWith('[') ? club.phone : null;
    const lead = instructors[0] ?? null;

    return {
      hero: () => `<div class="hero${club.hero_url ? '' : ' plain'}">
  ${club.hero_url ? `<div class="photo" aria-hidden="true"><img src="${esc(club.hero_url)}" alt=""></div><div class="veil"></div>`
    : (logoUrl ? `<div class="crestwrap" aria-hidden="true"><img class="crest" src="${esc(logoUrl)}" alt=""></div>` : '')}
  <div class="wrap">
    <h1>${esc(h.capitalise(h.artOf(federation)))} in ${esc(town)}</h1>
    <p>Classes for adults and children. ${esc(daysLine)}.${free ? ' Your first class is free.' : ''}</p>
    <div class="actions">
      <a class="btn btn-solid" href="#enquire">${free ? 'Come to a free class' : 'Come to a class'}</a>
      <a class="btn btn-ghost" href="#times">See training times</a>
    </div>
  </div>
</div>`,

      facts: () => `<div class="facts"><div class="wrap">
  <div><b>WHERE</b><p>${esc(club.venue_name ?? club.address_line ?? 'Venue to confirm')}
    <small>${esc([club.venue_name ? club.address_line : null, club.suburb, club.city, club.postcode].filter(Boolean).join(', ') || 'Address to confirm')}</small></p></div>
  <div><b>WHEN</b><p>${esc(daysLine)}<small>${
    groups.map((g) => `${esc(g.label)} ${h.time(g.starts)}`).slice(0, 2).join(' · ') || 'Times to confirm'}</small></p></div>
  <div><b>WHO TO ASK</b><p>${esc(lead ? titledName(lead) || `The ${h.clubWord(vocabulary)}` : `The ${h.clubWord(vocabulary)}`)}<small>${esc(club.email ?? (phone ? '' : 'Contact details to confirm'))}</small>
    ${phone ? `<span class="callrow"><a class="callbtn" href="tel:${esc(phone.replace(/[^\d+]/g, ''))}">Call ${esc(phone)}</a></span>` : ''}</p></div>
</div></div>`,

      startAnyWeek: () => startAnyWeekText ? `<div class="turnup">${esc(startAnyWeekText)}</div>` : '',

      times: () => `<h2 id="times">Training times</h2>
  ${groups.length ? `<table class="times"><thead><tr><th>Class</th><th>Day</th><th>Time</th></tr></thead>
    <tbody>${groups.map((g) => `<tr><td>${esc(g.label)}</td><td>${esc(g.days.join(' & '))}</td><td>${h.time(g.starts)} – ${h.time(g.ends)}</td></tr>`).join('')}</tbody></table>`
    : '<p>Training times to be confirmed.</p>'}`,

      about: () => club.blurb ? `<h2 style="margin-top:44px">About this ${esc(h.clubWord(vocabulary))}</h2>
    <p>${esc(club.blurb)}</p>${club.who_trains ? `<p>${esc(club.who_trains)}</p>` : ''}` : '',

      instructors: () => {
        if (!instructors.length) return '';
        const [first, ...others] = instructors;
        const paras = first.paragraphs ?? [];
        return `<section style="background:var(--canvas-2)"><div class="wrap">
    <div class="split">
      <div><h2>${instructors.length === 1 ? 'Who teaches here' : 'Who teaches here'}</h2>
        <p style="font-family:var(--display);font-size:24px;font-weight:800;margin:0 2px 2px 0">${esc(titledName(first))}</p>
        ${first.grade ? `<p style="color:var(--red-dark);font-weight:700;margin:0 0 18px">${gradeMarkup(first.grade, esc)}</p>` : ''}
        ${paras.slice(0, 2).map((p) => `<p>${esc(p)}</p>`).join('')}</div>
      ${first.photoUrl ? `<div class="portrait"><img src="${esc(first.photoUrl)}" alt="${esc(titledName(first))}"></div>` : ''}
    </div>
    ${others.length ? `<div class="icards" style="margin-top:40px;grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">${others.map((i) => h.instructorCard(i, { at })).join('')}</div>` : ''}
  </div></section>`;
      },

      firstNight: () => {
        const c = copy.firstNight; const items = list(c?.items).filter((i) => asText(i?.title, 80));
        if (!items.length) return '';
        return `<div class="dark"><section><div class="wrap"><h2>${esc(asText(c.heading, 120) || 'Your first night')}</h2>
    <ol>${items.slice(0, 3).map((i) => `<li><h3>${esc(asText(i.title, 80))}</h3><p>${esc(asText(i.text, 280))}</p></li>`).join('')}</ol>
  </div></section></div>`;
      },

      events: () => events.length ? `<section style="background:var(--canvas-2)"><div class="wrap">
    <div class="sechead"><h2>What's on</h2><a href="${at('/events')}">All events</a></div>
    <div class="ev">${events.slice(0, 3).map((e) => eventCard(e, { at, federation, logoUrl, vocabulary, clubSlug: club.slug })).join('')}</div>
  </div></section>` : '',

      gallery: () => gallery.length ? `<section><div class="wrap narrow"><h2>In the ${esc(h.clubWord(vocabulary))}</h2>
    <ul class="gal">${gallery.slice(0, 6).map((g) => `<li class="t"><a class="glink" href="${esc(g.url)}"><img src="${esc(g.url)}" alt="${esc(g.alt ?? '')}" loading="lazy"></a></li>`).join('')}</ul>
    <p style="margin-top:14px"><a href="${at(`/${esc(club.slug)}/gallery`)}">${(galleryTotal ?? gallery.length) > gallery.length
      ? `See all ${galleryTotal} photos` : 'Photos by year and event'}</a></p>
  </div></section>` : '',

      findUs: () => `<section><div class="wrap narrow" id="visit"><h2>Finding us</h2>
    <p style="line-height:1.7"><strong style="font-family:var(--display);font-size:19px">${esc(club.venue_name ?? '')}</strong><br>${
      esc([club.address_line, club.suburb, club.city].filter(Boolean).join(', '))}${club.directions ? `<br>${esc(club.directions)}` : ''}</p>
  </div></section>`,

      enquire: () => `<section id="enquire"><div class="wrap narrow">
    <h2>${free ? 'Come along' : 'Get in touch'}</h2>
    <p>Send this and the ${esc(town)} ${esc(h.clubWord(vocabulary))} will get back to you with the next class you can walk into. You can also just turn up.</p>
    <form class="box" method="post" action="/enquire/${esc(club.slug)}">
      <input type="hidden" name="kind" value="${free ? 'trial' : 'contact'}">
      <div class="row"><div><label for="enq-name">Your name</label><input id="enq-name" name="name" maxlength="100" required autocomplete="name"></div>
      <div><label for="enq-email">Email</label><input id="enq-email" name="email" type="email" maxlength="120" required autocomplete="email"></div></div>
      <div class="row"><div><label for="enq-who">Who is this for?</label>
        <select id="enq-who" name="who" class="f"><option>Myself</option><option>My child</option><option>Both of us</option></select></div>
      <div><label for="enq-phone">Phone <span class="opt">— optional</span></label><input id="enq-phone" name="phone" maxlength="30" autocomplete="tel"></div></div>
      <label for="enq-message">Anything you'd like to ask? <span class="opt">— optional</span></label>
      <textarea id="enq-message" name="message" maxlength="2000"></textarea>
      <div style="position:absolute;left:-9999px" aria-hidden="true"><label>Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label></div>
      <button class="btn btn-solid" type="submit">Send to the ${esc(town)} ${esc(h.clubWord(vocabulary))}</button>
    </form>
    <p style="margin-top:14px;font-size:14.5px;color:var(--muted)">Goes straight to this ${esc(h.clubWord(vocabulary))}. We don't add you to any mailing list.</p>
  </div></section>`,

      federationBand: () => federationBand({ copy, at, logoUrl, federation, clubCount }),
    };
  }

  // ---- find a club & events lists -----------------------------------------

  function findBody({ clubs, federation, at, copy, vocabulary, lede }) {
    const clubsWordL = h.clubsWordOf(vocabulary);
    const tile = (d) => `<a href="${at(`/${esc(d.slug)}`)}"><strong>${esc(d.name)}</strong><span>${esc(d.published
      ? (d.first_class_free ? 'Book a free class' : (d.city ?? 'See times and address')) : 'Details coming')}</span></a>`;
    const bySlug = new Map(clubs.map((d) => [d.slug, d]));
    const used = new Set();
    const regions = list(copy.regions).map((r) => ({ name: asText(r?.name, 60),
      clubs: list(r?.slugs).map((s) => bySlug.get(s)).filter(Boolean) })).filter((r) => r.name && r.clubs.length);
    regions.forEach((r) => r.clubs.forEach((d) => used.add(d.slug)));
    const rest = clubs.filter((d) => !used.has(d.slug));
    const groups = regions.length ? [...regions, ...(rest.length ? [{ name: 'More', clubs: rest }] : [])] : [{ name: '', clubs }];
    return `${crumb(at, [{ label: `Find a ${h.clubWord(vocabulary)}` }])}
<section><div class="wrap">
  <h1 class="page">Find a ${esc(h.clubWord(vocabulary))}</h1>
  <p class="lede" style="max-width:60ch">${clubs.length} ${esc(clubsWordL)}.${esc(lede)}</p>
</div></section>
<div class="club-band" style="padding-bottom:20px" id="clublist"><section style="padding-top:44px">
  <div class="wrap">${groups.map((g) => `<div class="region">${g.name ? `<h3>${esc(g.name)}</h3>` : ''}<div class="grid">${g.clubs.map(tile).join('')}</div></div>`).join('')}</div>
</section></div>`;
  }

  function eventsBody({ events, at, federation, logoUrl, vocabulary, intro }) {
    return `${crumb(at, [{ label: 'Events' }])}
<section><div class="wrap">
  <h1 class="page">Events</h1>
  ${intro ? `<p class="lede" style="max-width:60ch">${esc(intro)}</p>` : ''}
</div></section>
<section style="padding-top:0"><div class="wrap">${events.length
    ? `<div class="ev">${events.map((e) => eventCard(e, { at, federation, logoUrl, vocabulary })).join('')}</div>`
    : '<p>No events are on the calendar yet.</p>'}</div></section>`;
  }

  return { header, footer, crumb, homeParts, clubParts, findBody, eventsBody, federationBand };
}
