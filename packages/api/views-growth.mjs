/**
 * Screens: bringing people in — enquiries, trials, referrals, joining, and school terms.
 */
import { region } from '../infrastructure/region-context.mjs';
import { esc } from '../core/domain/html.mjs';
import { money as cents } from '../core/domain/money.mjs';
import { REWARD_KINDS as REWARD_KINDS_ } from '../core/domain/growth.mjs';
import { MID_TERM } from '../core/domain/terms.mjs';
import { page } from './views.mjs';
import { cardCss } from './views-shared.mjs';

export const enquiriesScreen = ({ me, csrf, org, rows = [], waiting = 0, done, error }) => {
  const tok = `<input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">`;
  const base = `/o/${esc(org.slug)}/enquiries`;
  return page({ title: `${org.name} — enquiries`, me, csrf, body: `
  <h1>Enquiries</h1>
  <p class="sub">Messages and free-class requests from your website's forms. ${waiting ? `${waiting} waiting.` : 'Nothing waiting.'}
    Each one is also emailed to your club's contact address; replying to that email answers the visitor.</p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${rows.length ? `<table><thead><tr><th>Received</th><th>From</th><th>About</th><th></th></tr></thead><tbody>
  ${rows.map((r) => `<tr><td>${esc(r.received)}<br>${r.status === 'new' ? '<span class="tag wait">New</span>' : '<span class="tag ok">Handled</span>'}</td>
    <td>${esc(r.name)}<br><a href="mailto:${esc(r.email)}">${esc(r.email)}</a>${r.phone ? `<br>${esc(r.phone)}` : ''}</td>
    <td>${r.kind === 'trial' ? '<strong>Free class</strong>' : 'Message'}${r.who ? ` for ${esc(r.who)}` : ''}
      ${r.message ? `<br><span style="white-space:pre-wrap">${esc(r.message)}</span>` : ''}</td>
    <td><form method="post" action="${base}/${esc(r.id)}/handled" style="display:inline">${tok}
        <input type="hidden" name="handled" value="${r.status === 'new' ? '1' : '0'}">
        <button class="btn secondary" type="submit">${r.status === 'new' ? 'Mark handled' : 'Reopen'}</button></form>
      <form method="post" action="${base}/${esc(r.id)}/delete" style="display:inline">${tok}<button class="btn quiet" type="submit">Delete</button></form></td></tr>`).join('')}
  </tbody></table>` : '<p class="muted">No enquiries yet. Add a contact form to a page from the page editor.</p>'}
  <p class="muted">Enquiries are kept for a year, then deleted.</p>` });
};

/** The form on its own address — for a link in a poster or a social post. */
export const enquiryPage = ({ csrf, club, kind = 'contact', action, values = {}, error, sent = false }) => page({
  title: `${club} — get in touch`, me: null, csrf, body: `
  <h1>${esc(club)}</h1>
  ${sent ? '<div class="good">Thank you — your message has been sent. They will be in touch.</div>' : `
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  <form method="post" action="${esc(action)}">
    <input type="hidden" name="kind" value="${kind === 'trial' ? 'trial' : 'contact'}">
    <div style="position:absolute;left:-9999px" aria-hidden="true"><label>Leave this empty <input name="website" tabindex="-1" autocomplete="off"></label></div>
    <label for="name">Your name</label><input id="name" name="name" maxlength="100" required value="${esc(values.name ?? '')}">
    <label for="email">Email</label><input id="email" name="email" type="email" maxlength="120" required value="${esc(values.email ?? '')}">
    <label for="phone">Phone (optional)</label><input id="phone" name="phone" maxlength="30" value="${esc(values.phone ?? '')}">
    ${kind === 'trial' ? `<label for="who">Who is it for?</label><input id="who" name="who" maxlength="100" value="${esc(values.who ?? '')}">` : ''}
    <label for="message">Message</label><textarea id="message" name="message" rows="5" maxlength="2000">${esc(values.message ?? '')}</textarea>
    <button class="btn" type="submit">Send</button>
  </form>`}` });

const WAIVER = 'I have read and accept the club\'s waiver. I understand martial arts training involves physical contact and a risk of injury, I am fit to train, and the details I have given are true.';

export const trialPage = ({ csrf, offer, values = {}, error, action, code = '', friend = '' }) => page({
  title: `${offer.name} — free month`, me: null, csrf, body: `
  <h1>${esc(offer.name)}</h1>
  <p class="sub">${friend ? `${esc(friend)} thought you would enjoy this. ` : ''}Your first ${offer.days} days are free. Come to any class that suits you.</p>
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  <form method="post" action="${esc(action)}">
    <div style="position:absolute;left:-9999px" aria-hidden="true"><label>Leave this empty <input name="website" tabindex="-1" autocomplete="off"></label></div>
    <label for="firstName">First name</label><input id="firstName" name="firstName" maxlength="60" required autocomplete="given-name" value="${esc(values.firstName ?? '')}">
    <label for="lastName">Last name</label><input id="lastName" name="lastName" maxlength="60" required autocomplete="family-name" value="${esc(values.lastName ?? '')}">
    <label for="email">Email</label><input id="email" name="email" type="email" maxlength="120" required autocomplete="email" value="${esc(values.email ?? '')}">
    <label for="phone">Mobile</label><input id="phone" name="phone" maxlength="30" required autocomplete="tel" value="${esc(values.phone ?? '')}">
    <label for="dateOfBirth">Date of birth <span class="muted">(1988-03-14)</span></label>
    <input id="dateOfBirth" name="dateOfBirth" maxlength="10" required inputmode="numeric" value="${esc(values.dateOfBirth ?? '')}">
    <fieldset><legend>In an emergency</legend>
      <label for="emergencyName">Name</label><input id="emergencyName" name="emergencyName" maxlength="80" required value="${esc(values.emergencyName ?? '')}">
      <label for="emergencyPhone">Phone</label><input id="emergencyPhone" name="emergencyPhone" maxlength="30" required value="${esc(values.emergencyPhone ?? '')}">
    </fieldset>
    <label for="medical">Anything the instructor should know — injuries, asthma, allergies <span class="muted">(optional)</span></label>
    <textarea id="medical" name="medical" rows="3" maxlength="1000">${esc(values.medical ?? '')}</textarea>
    <label for="code">Invited by a member? Their code <span class="muted">(optional)</span></label>
    <input id="code" name="code" maxlength="12" value="${esc(values.code ?? code)}" autocomplete="off">
    <label class="check"><input type="checkbox" name="accepted" value="1"${values.accepted ? ' checked' : ''}> ${esc(WAIVER)}</label>
    <div class="actions"><button class="btn" type="submit">Start my free month</button></div>
  </form>` });

// The same words whether or not we already knew them, so this page cannot be used to find out who is on the register.
export const trialThanks = ({ club, days }) => page({
  title: `${club} — free month`, me: null, body: `
  <h1>${esc(club)}</h1>
  <div class="good"><strong>Check your email.</strong>
    A sign-in link is on its way. Through it you can see the timetable and check in to classes${days ? `; your ${days} days start today if you are new to us` : ''}.</div>
  <p class="muted">The link works once and expires in 15 minutes.</p>` });

export const referralLanding = ({ friend, club, days, reward, code, slug }) => page({
  title: `${club} — an invitation`, me: null, body: `
  <h1>${esc(friend)} invited you to ${esc(club)}</h1>
  <p class="sub">Try it free for ${days} days${reward ? ` — and when you join you get ${esc(reward)}` : ''}.</p>
  <p><a class="btn" href="/trial/${esc(slug)}?ref=${esc(code)}">Start my free month</a></p>` });

export const referPage = ({ me, csrf, eligible, reason, club, code, offer, referred, days, rows = [], rewards = [], svg, link }) => page({
  title: 'Refer a friend', me, csrf, body: `${cardCss}
  <h1>Refer a friend</h1>
  <p class="sub"><a href="/me">Back</a></p>
  ${!eligible ? `<div class="note">${esc(reason)}</div>` : `
  <p>Friends you invite get ${days} days free at ${esc(club)}. When one of them joins${offer ? `, you receive <strong>${esc(offer)}</strong>` : ''}${referred ? ` and they receive ${esc(referred)}` : ''}.</p>
  <div class="idcard"><div class="org">Your invitation</div>
    <div class="qr">${svg}</div>
    <p style="font-size:1.4rem;letter-spacing:.2em"><strong>${esc(code)}</strong></p>
    <p class="muted" style="word-break:break-all">${esc(link)}</p></div>
  <p class="muted">Show the code, or let them scan it. They can also type the code when they sign up.</p>
  <h2>Who you have invited</h2>
  ${rows.length ? `<table><tbody>${rows.map((r) => `<tr><td>${esc(r.first_name)}</td><td class="muted">${esc(r.when)}</td>
    <td>${esc(REFERRAL_WORDS[r.status] ?? r.status)}${r.note && r.status !== 'rewarded' ? ` <span class="muted">${esc(r.note)}</span>` : ''}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">Nobody yet.</p>'}
  <h2>Your rewards</h2>
  ${rewards.length ? `<table><tbody>${rewards.map((w) => `<tr><td>${esc(w.text)}</td><td class="muted">${esc(w.when)}</td>
    <td>${w.status === 'given' ? 'Given' : 'The club will arrange it'}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">None yet.</p>'}`}` });

const REFERRAL_WORDS = { trial: 'On their free month', member: 'Joined', rewarded: 'Joined — reward earned', void: 'Not counted' };

export const joinPage = ({ me, csrf, trial, options = [], error }) => page({
  title: 'Join', me, csrf, body: `
  <h1>Join ${esc(trial.club)}</h1>
  <p class="sub"><a href="/me">Back</a></p>
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  <p>${trial.status === 'trialling' ? `Your free month runs until ${esc(trial.ends)}. Whatever you choose, your membership carries on from the day it ends.`
      : 'Your free month has ended. Choose how you would like to join.'}</p>
  ${options.length ? `<form method="post"><input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <fieldset><legend>How would you like to pay?</legend>
    ${options.map((o, i) => `<label class="check"><input type="radio" name="period" value="${esc(o.period)}"${i === 0 ? ' checked' : ''}>
      ${esc(o.fee.label)} — ${esc(cents(o.fee.amount_cents, o.fee.currency))} <span class="muted">${esc(o.label.toLowerCase())}</span></label>`).join('')}
    </fieldset><div class="actions"><button class="btn" type="submit">Continue to payment</button></div></form>`
    : '<div class="note">The club has not published its prices yet. Please ask them how to join.</div>'}` });

const GROWTH_KIND_OPTIONS = (sel) => Object.entries(REWARD_KINDS_).map(([k, v]) => `<option value="${k}"${sel === k ? ' selected' : ''}>${esc(v)}</option>`).join('');

export const growthScreen = ({ me, csrf, org, settings, trials = [], referrals = [], owed = [], top = [], report, offer, canManage, done, error, origin }) => {
  const rf = (p, r) => `<fieldset><legend>${p === 'referrer' ? 'The member who invited them gets' : 'The new member gets (optional)'}</legend>
    <select name="${p}_kind">${GROWTH_KIND_OPTIONS(r.kind)}</select>
    <label>Weeks <input name="${p}_weeks" value="${r.weeks || ''}" size="3" inputmode="numeric"></label>
    <label>Amount $ <input name="${p}_amount" value="${r.cents ? (r.cents / 100) : ''}" size="6" inputmode="decimal"></label>
    <label>What <input name="${p}_note" value="${esc(r.note)}" maxlength="120"></label>
    <p class="muted">Free weeks are added to their membership automatically. Anything else is listed below until somebody hands it over.</p></fieldset>`;
  return page({
    title: `${org.name} — trials and referrals`, me, csrf, body: `
  <h1>Trials and referrals</h1>
  <p class="sub">Adults try a month free, join, and bring friends. Every trial is a real person on your register.</p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${settings.trial.enabled ? `<div class="note">Share this link on your website and social media: <strong>${esc(origin)}/trial/${esc(org.slug)}</strong></div>` : ''}

  <h2>How it is going</h2>
  <div class="row">
    <div><strong>${report.started}</strong> trials started</div>
    <div><strong>${report.trialling}</strong> trialling now</div>
    <div><strong>${report.converted}</strong> joined${report.conversion != null ? ` (${report.conversion}% of finished trials)` : ''}</div>
    <div><strong>${report.referrals}</strong> referrals</div>
    <div><strong>${report.referralMembers}</strong> became members</div>
    <div><strong>${report.rewarded}</strong> rewards earned</div>
    <div><strong>${esc(cents(report.revenueCents, region().currency))}</strong> paid by referred members</div>
  </div>
  ${top.length ? `<p class="muted">Top referrers: ${top.map((t) => `${esc(t.name)} (${t.n})`).join(', ')}.</p>` : ''}

  ${owed.length ? `<h2>Rewards to hand over</h2><table><tbody>${owed.map((w) => `<tr><td>${esc(w.name)} <span class="muted">${esc(w.display_number ?? '')}</span></td><td>${esc(w.text)}</td>
    <td><form method="post" action="/o/${esc(org.slug)}/growth/rewards/${esc(w.id)}/given"><input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
      <button class="btn quiet" type="submit">Mark as given</button></form></td></tr>`).join('')}</tbody></table>` : ''}

  <h2>Free trials</h2>
  ${trials.length ? `<table><thead><tr><th>Who</th><th>Started</th><th>Ends</th><th>Classes</th><th>Status</th></tr></thead><tbody>${trials.map((t) => `<tr>
    <td>${esc(t.name)}${t.source === 'referral' ? ' <span class="tag ok">referred</span>' : ''}<div class="muted">${esc(t.email ?? '')} ${esc(t.phone ?? '')}</div></td>
    <td>${esc(t.starts)}</td><td>${esc(t.ends)}${t.left != null ? ` <span class="muted">(${t.left < 0 ? 'ended' : t.left + ' days left'})</span>` : ''}</td>
    <td>${t.classes}</td><td>${esc({ trialling: 'Trialling', converted: 'Joined', ended: 'Ended' }[t.status])}${t.display_number ? ` <span class="muted">${esc(t.display_number)}</span>` : ''}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">No trials yet.</p>'}

  <h2>Referrals</h2>
  ${referrals.length ? `<table><thead><tr><th>Invited by</th><th>Friend</th><th>When</th><th>Where it is</th></tr></thead><tbody>${referrals.map((r) => `<tr>
    <td>${esc(r.referrer)}</td><td>${esc(r.referred)}</td><td>${esc(r.when)}</td>
    <td>${esc(REFERRAL_WORDS[r.status] ?? r.status)}${r.note ? ` <span class="muted">${esc(r.note)}</span>` : ''}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">No referrals yet.</p>'}

  <h2>What you offer</h2>
  ${canManage ? `<form method="post" action="/o/${esc(org.slug)}/growth/settings">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <fieldset><legend>Free trial for adults</legend>
      <label class="check"><input type="checkbox" name="trial_enabled" value="1"${settings.trial.enabled ? ' checked' : ''}> Offer a free trial on the website</label>
      <label>Days free <input name="trial_days" value="${settings.trial.days}" size="3" inputmode="numeric"></label>
      <label>Youngest allowed <input name="trial_min_age" value="${settings.trial.minAge}" size="3" inputmode="numeric"></label>
    </fieldset>
    <fieldset><legend>Referrals</legend>
      <label class="check"><input type="checkbox" name="referral_enabled" value="1"${settings.referral.enabled ? ' checked' : ''}> Members can invite friends</label>
      <label>Classes the friend must attend before the reward <input name="min_classes" value="${settings.referral.minClasses}" size="3" inputmode="numeric"></label>
      <label>Most rewards one member can earn in a year <input name="max_per_year" value="${settings.referral.maxPerYear}" size="3" inputmode="numeric"></label>
      ${rf('referrer', settings.referral.referrer)}${rf('referred', settings.referral.referred)}
    </fieldset>
    <div class="actions"><button class="btn" type="submit">Save</button></div></form>`
  : '<p class="muted">An administrator sets these.</p>'}` });
};

const TERM_STATE = { upcoming: 'Not open yet', open: 'Enrolment open', current: 'Running', closed: 'Enrolment closed', ended: 'Finished' };

export const termsScreen = ({ me, csrf, org, today, country, years = [], midTerm, isClub, current, next, holiday, calendar, canManage, done, error }) => page({
  title: `${org.name} — school terms`, me, csrf, body: `
  <h1>School terms</h1>
  <p class="sub">Children enrol class by class for each school term. Terms are set once, for a whole country or federation, and every club beneath uses them.</p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}${error ? `<div class="bad">${esc(error)}</div>` : ''}
  <p>${current ? `Right now: <strong>${esc(current.name)}</strong> (to ${esc(current.ends)}).` : holiday ? `Right now: <strong>school holidays</strong> until ${esc(holiday.to)}.` : 'No term is running today.'}
    ${next ? ` Next: <strong>${esc(next.name)}</strong> starts ${esc(next.starts)}.` : ''}</p>
  ${years.map((y) => `<h2>${y.year}</h2>
    ${y.terms.length ? `<p class="muted">${y.inherited ? `Inherited from ${esc(y.owner.name)}.` : `Set here${y.terms[0].source === 'built-in' ? ` from the ${esc(calendar?.name ?? 'built-in')} calendar` : ''}.`}</p>
    <table><thead><tr><th>Term</th><th>Starts</th><th>Ends</th><th>State</th>${isClub ? '<th>Enrolled</th>' : ''}<th></th></tr></thead><tbody>${y.terms.map((t) => `<tr>
      <td>${esc(t.name)}</td><td>${esc(t.starts)}</td><td>${esc(t.ends)}</td><td>${esc(TERM_STATE[t.state] ?? t.state)}</td>
      ${isClub ? `<td>${t.n}${t.n ? ` <span class="muted">(${t.paid} paid)</span>` : ''}</td>` : ''}
      <td>${isClub ? `<a href="/o/${esc(org.slug)}/terms/${esc(t.id)}">Who</a>` : ''}
        ${canManage && !y.inherited ? `<form method="post" action="/o/${esc(org.slug)}/terms/${esc(t.id)}/remove" style="display:inline"><input type="hidden" name="_csrf" value="${esc(csrf ?? '')}"><button class="btn quiet" type="submit">Remove</button></form>` : ''}</td></tr>`).join('')}</tbody></table>
    ${y.holidays.length ? `<p class="muted">Holidays: ${y.holidays.map((h) => `${esc(h.from)} to ${esc(h.to)}`).join(' · ')}</p>` : ''}
    ${calendar?.note && y.terms[0]?.source === 'built-in' ? `<p class="muted">${esc(calendar.note)} Source: ${esc(calendar.source)}.</p>` : ''}`
    : `<div class="note">No terms for ${y.year} yet.${y.builtIn ? ` The ${esc(y.builtIn.name)} calendar is available.` : country ? ` There is no built-in calendar for ${esc(country)}: add the terms below once and every club beneath will use them.` : ''}</div>`}
    ${canManage && y.builtIn && !(y.terms.length && !y.inherited) ? `<form method="post" action="/o/${esc(org.slug)}/terms/load"><input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
      <input type="hidden" name="year" value="${y.year}"><button class="btn" type="submit">Use the ${esc(y.builtIn.name)} calendar for ${y.year}</button></form>` : ''}`).join('')}
  ${canManage ? `<h2>Add a term</h2><form method="post" action="/o/${esc(org.slug)}/terms">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <label for="name">Name</label><input id="name" name="name" maxlength="40" placeholder="Term 1" required>
    <label for="starts">First day <span class="muted">(2027-02-01)</span></label><input id="starts" name="starts" maxlength="10" required>
    <label for="ends">Last day</label><input id="ends" name="ends" maxlength="10" required>
    <div class="actions"><button class="btn" type="submit">Add term</button></div></form>
    <p class="muted">Terms added here are used by this organisation and everything beneath it.</p>` : ''}
  ${isClub ? `<h2>Joining part-way through a term</h2>
    ${canManage ? `<form method="post" action="/o/${esc(org.slug)}/terms/rule"><input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
      <select name="mid_term">${Object.entries(MID_TERM).map(([k, v]) => `<option value="${k}"${midTerm.mode === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>
      <label>Reduced price $ <input name="fixed" value="${midTerm.fixedCents ? midTerm.fixedCents / 100 : ''}" size="6"></label>
      <button class="btn" type="submit">Save</button></form>` : `<p>${esc(MID_TERM[midTerm.mode])}</p>`}
    <p class="muted">The full-term price is your junior “Per term” price on the <a href="/o/${esc(org.slug)}/renewals">Renewals</a> screen. With no price set, enrolment is free.</p>` : ''}` });

export const termRoster = ({ me, csrf, org, term, rows = [] }) => page({
  title: `${term.name} — enrolled`, me, csrf, body: `
  <p><a href="/o/${esc(org.slug)}/terms">← School terms</a></p>
  <h1>${esc(term.name)} ${esc(term.year)}</h1><p class="sub">${esc(term.starts)} to ${esc(term.ends)}</p>
  ${rows.length ? `<table><thead><tr><th>Child</th><th>Age</th><th>Enrolled</th><th>Price</th><th></th></tr></thead><tbody>${rows.map((r) => `<tr>
    <td><a href="/p/${esc(r.person_id)}">${esc(r.name)}</a></td><td>${r.age ?? ''}</td><td>${esc(r.enrolled_on)}</td>
    <td>${esc(cents(r.fee_cents, region().currency))}${r.price_note && r.price_note !== 'The full term' ? ` <span class="muted">${esc(r.price_note)}</span>` : ''}</td>
    <td>${r.status === 'withdrawn' ? 'Withdrawn' : r.paid ? '<span class="tag ok">Paid</span>' : '<span class="tag wait">Not paid</span>'}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">Nobody is enrolled yet.</p>'}` });
