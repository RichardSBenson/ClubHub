/**
 * Screens: money — what a member owes and pays, what a club has been paid, renewals and automatic renewal.
 */
import { region } from '../infrastructure/region-context.mjs';
import { esc } from '../core/domain/html.mjs';
import { money as cents } from '../core/domain/money.mjs';
import { PERIODS as FEE_PERIODS, CATEGORIES as FEE_CATEGORIES, EXEMPT_REASONS, MANUAL_METHODS, STANDING_WORDS } from '../core/domain/membership.mjs';
import { KINDS as PAY_KINDS, ASKABLE as PAY_ASKABLE, METHODS as PAY_METHODS, STATUSES as PAY_STATUSES } from '../core/domain/payments.mjs';
import { page } from './views.mjs';
import { clubWord, taxNote } from './views-shared.mjs';

const FEE_METHOD_LABEL = { card: 'Card', bank: 'Internet banking', direct_debit: 'Direct debit' };

const payStatus = (st) => esc(PAY_STATUSES[st] ?? st);

const testBanner = (test) => test ? `<div class="note"><strong>Test payments.</strong>
  No money moves. Card 4000 0000 0000 0002 is declined; any other number is accepted.</div>` : '';

export const myPayments = ({ me, csrf, groups = [], test = false, done }) => page({
  title: 'Payments', me, csrf, body: `
  <h1>Payments</h1>
  <p class="sub"><a href="/me">Back</a>${groups.length ? groups.map(({ person }) => ` · <a href="/me/${esc(person.id)}/auto-renew">Automatic renewal${groups.length > 1 ? ` for ${esc(person.first_name)}` : ''}</a>`).join('') : ''}</p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${testBanner(test)}
  ${groups.map(({ person, rows }) => `
    <h2>${esc(person.first_name)} ${esc(person.last_name)}</h2>
    ${rows.length ? `<table><thead><tr><th>For</th><th>Pay to</th><th>Amount</th><th></th></tr></thead><tbody>${
      rows.map((r) => `<tr>
        <td>${r.lines.map((l) => esc(l.description)).join('<br>')}</td>
        <td>${esc(r.payee_name)}</td>
        <td>${esc(cents(r.amount_cents, r.currency))}</td>
        <td>${['pending', 'failed'].includes(r.status)
          ? `<a class="btn" href="/me/payments/${esc(r.id)}">Pay</a>`
          : `<span class="tag ${r.status === 'succeeded' ? 'ok' : 'no'}">${payStatus(r.status)}</span>`}</td>
      </tr>`).join('')}</tbody></table>` : '<p class="muted">Nothing to pay and nothing paid.</p>'}`).join('')}` });

export const payScreen = ({ me, csrf, payment, test = false, error, done }) => {
  const open = ['pending', 'failed'].includes(payment.status);
  return page({ title: 'Pay', me, csrf, body: `
  <h1>${esc(cents(payment.amount_cents, payment.currency))}</h1>
  <p class="sub">To ${esc(payment.payee_name)} · for ${esc(payment.person_name ?? '')} · <a href="/me/payments">Back</a></p>
  ${testBanner(test)}
  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  <ul class="plain">${payment.lines.map((l) => `<li>${esc(l.description)} — ${esc(cents(l.amount_cents, payment.currency))}</li>`).join('')}</ul>
  ${payment.status === 'failed' && payment.detail ? `<div class="bad">${esc(payment.detail)} You can try again.</div>` : ''}
  ${open ? `<form method="post" action="/me/payments/${esc(payment.id)}">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <fieldset><legend>How would you like to pay?</legend>
      ${Object.entries(PAY_METHODS).map(([k, m], i) => `<label><input type="radio" name="method" value="${k}"${i === 0 ? ' checked' : ''}> ${esc(m.label)}</label>`).join('')}
    </fieldset>
    <label for="card">Card number <span class="muted">(card payments only)</span></label>
    <input id="card" name="card" inputmode="numeric" autocomplete="off" maxlength="23">
    <p class="muted">The card number is checked by the payment provider and is never stored here.</p>
    <div class="actions"><button class="btn" type="submit">Pay ${esc(cents(payment.amount_cents, payment.currency))}</button></div>
  </form>` : payment.status === 'awaiting' ? `
    <div class="note"><strong>${payStatus('awaiting')}.</strong> ${esc(payment.detail ?? '')}
      You do not need to do anything. It will show as paid when it is confirmed.</div>
    ${test ? `<form method="post" action="/me/payments/${esc(payment.id)}/complete" style="display:inline">
      <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
      <button class="btn quiet" name="ok" value="1">Test: the bank confirmed</button>
      <button class="btn quiet" name="ok" value="0">Test: the bank refused</button></form>` : ''}`
  : `<div class="good"><strong>${payStatus(payment.status)}.</strong> ${esc(payment.detail ?? '')}</div>`}` });
};

export const paymentsScreen = ({ me, csrf, org, rows = [], totals = [], methods = [], test = false,
                                 values = null, error, done }) => {
  const v = (k) => esc(values?.[k] ?? '');
  const sum = (status) => totals.filter((t) => t.status === status).reduce((n, t) => n + t.cents, 0);
  return page({ title: `${org.name} — payments`, me, csrf, body: `
  <h1>Payments</h1>
  <p class="sub">What ${esc(org.name)} has been paid. Money goes to the organisation it is for:
    ${clubWord()} fees, kyu gradings, uniforms and equipment to the ${clubWord()}; tournament entries to whoever runs
    the tournament; black belt gradings to the federation.</p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${testBanner(test)}
  <div class="row">
    <div><strong>${esc(cents(sum('succeeded')))}</strong> paid</div>
    <div><strong>${esc(cents(sum('awaiting')))}</strong> waiting for the bank</div>
    <div><strong>${esc(cents(sum('pending')))}</strong> asked for, not yet paid</div>
  </div>
  ${methods.length ? `<p class="muted">Paid so far: ${methods.map((m) => `${esc((MANUAL_METHODS[m.method] ?? FEE_METHOD_LABEL[m.method] ?? m.method).toLowerCase())} ${esc(cents(m.cents))}`).join(' · ')}</p>` : ''}
  ${totals.some((t) => t.status === 'succeeded') ? `<table><thead><tr><th>Paid, by kind</th><th>Payments</th><th>Total</th></tr></thead><tbody>${
    totals.filter((t) => t.status === 'succeeded').map((t) => `<tr><td>${esc(PAY_KINDS[t.kind]?.label ?? t.kind)}</td>
    <td>${t.n}</td><td>${esc(cents(t.cents))}</td></tr>`).join('')}</tbody></table>` : ''}

  <h2>Ask a member for a payment</h2>
  <form method="post" action="/o/${esc(org.slug)}/payments">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <div class="row">
      <div><label for="personNumber">Member number</label>
        <input id="personNumber" name="personNumber" required maxlength="30" value="${v('personNumber')}"></div>
      <div><label for="kind">For</label>
        <select id="kind" name="kind">${PAY_ASKABLE.map((k) => `<option value="${k}"${values?.kind === k ? ' selected' : ''}>${
          esc(PAY_KINDS[k].label)}${PAY_KINDS[k].payee === 'federation' ? ' (paid to the federation)' : ''}</option>`).join('')}</select></div>
      <div><label for="amount">Amount (${region().currency})</label>
        <input id="amount" name="amount" required inputmode="decimal" maxlength="12" value="${v('amountText')}"></div>
    </div>
    <label for="description">What it is <span class="muted">(optional, e.g. “Gi, size 150”)</span></label>
    <input id="description" name="description" maxlength="140" value="${v('description')}">
    <label for="received">Already handed over?</label>
    <select id="received" name="received">
      <option value="">No — ask them to pay</option>
      ${Object.entries(MANUAL_METHODS).map(([k, l]) => `<option value="${k}"${values?.received === k ? ' selected' : ''}>Yes — ${esc(l.toLowerCase())}</option>`).join('')}
    </select>
    <div class="actions"><button class="btn" type="submit">Save</button></div>
  </form>

  <h2>Payments</h2>
  ${rows.length ? `<table><thead><tr><th>When</th><th>Who</th><th>For</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>${
    rows.map((r) => `<tr>
      <td>${esc(new Date(r.created_at).toISOString().slice(0, 10))}</td>
      <td>${esc(r.person_name ?? '—')}</td>
      <td>${r.lines.map((l) => esc(l.description)).join('<br>')}</td>
      <td>${esc(cents(r.amount_cents, r.currency))}${r.status === 'succeeded' ? taxNote(r.amount_cents, r.currency) : ''}</td>
      <td>${payStatus(r.status)}${r.method && r.status === 'succeeded'
          ? ` <span class="muted">· ${esc((MANUAL_METHODS[r.method] ?? FEE_METHOD_LABEL[r.method] ?? r.method).toLowerCase())}${
              r.receipt_no ? ` · ${esc(r.receipt_no)}` : ''}</span>` : ''}</td>
      <td>${['pending', 'failed'].includes(r.status) ? `<form method="post" action="/o/${esc(org.slug)}/payments/${esc(r.id)}/received" style="display:inline">
        <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
        <button class="btn quiet" name="method" value="cash">Paid cash</button>
        <button class="btn quiet" name="method" value="transfer">Paid by transfer</button></form>
        <form method="post" action="/o/${esc(org.slug)}/payments/${esc(r.id)}/cancel" style="display:inline">
        <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}"><button class="btn quiet">Cancel</button></form>` : ''}</td>
    </tr>`).join('')}</tbody></table>` : '<p class="muted">Nothing yet.</p>'}` });
};

const STANDING_TAG = { exempt: 'ok', current: 'ok', due: 'warn', overdue: 'no', unpaid: 'no' };

export const renewalsScreen = ({ me, csrf, org, today, rows = [], prices = [], auto = [], canSetPrices = false,
                                 canExempt = false, reminderText: remind = null, autoReminders = false, values = null, error, done, notes = [] }) => {
  const v = (k) => esc(values?.[k] ?? '');
  const periods = [...new Set(prices.map((f) => f.period))].filter((p) => FEE_PERIODS[p].months);
  const due = rows.filter((r) => ['overdue', 'due', 'unpaid'].includes(r.standing) && !r.asked);
  return page({ title: `${org.name} — renewals`, me, csrf, body: `
  <h1>Renewals</h1>
  <p class="sub">${esc(org.name)} sets its own prices. Asking for a renewal charges nobody —
    it puts a payment in front of them. However it is paid, online or in cash,
    paying moves their membership on.</p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${notes.length ? `<div class="note">${notes.map(esc).join('<br>')}</div>` : ''}

  <h2>Renewing themselves (${auto.length})</h2>
  ${auto.length ? `<table><thead><tr><th>Member</th><th>Pays</th><th>With</th><th>Fees run to</th><th></th></tr></thead><tbody>${auto.map((g) => `<tr>
    <td>${esc(g.person_name)}</td><td>${esc(FEE_PERIODS[g.period]?.label ?? g.period)}</td><td>${esc(g.label)}</td><td>${esc(g.paid_until ?? '—')}</td>
    <td>${g.status === 'paused' ? '<span class="tag bad">Stopped after failed payments</span>' : g.failures ? `<span class="tag wait">Last payment failed — trying again ${esc(g.next_attempt_on ?? '')}</span>` : '<span class="tag ok">Active</span>'}</td></tr>`).join('')}</tbody></table>
    <p class="muted">Members who renew themselves are not sent renewal reminders.</p>`
    : '<p class="muted">Nobody has set up automatic renewal yet. Members can do it from My payments.</p>'}

  <h2>Prices</h2>
  ${prices.length ? `<table><thead><tr><th>Price</th><th>For</th><th>How often</th><th>Amount</th><th>From</th><th></th></tr></thead><tbody>${
    prices.map((f) => `<tr><td>${esc(f.label)}</td><td>${esc(feeCategories()[f.applies_to] ?? f.applies_to)}</td>
      <td>${esc(FEE_PERIODS[f.period]?.label ?? f.period)}</td><td>${esc(cents(f.amount_cents, f.currency))}</td>
      <td>${esc(f.effective_from)}${f.effective_to ? ` to ${esc(f.effective_to)}` : ''}</td>
      <td>${canSetPrices ? `<form method="post" action="/o/${esc(org.slug)}/renewals/fees/${esc(f.id)}/remove">
        <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}"><button class="btn quiet">Remove</button></form>` : ''}</td></tr>`).join('')}</tbody></table>`
    : '<div class="note">No prices set yet. Add the first one below, then ask people to renew.</div>'}
  ${canSetPrices ? `<form method="post" action="/o/${esc(org.slug)}/renewals/fees">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <div class="row">
      <div><label for="label">Name</label><input id="label" name="label" required maxlength="80" placeholder="Adult annual" value="${v('label')}"></div>
      <div><label for="appliesTo">For</label><select id="appliesTo" name="appliesTo">${Object.entries(feeCategories()).map(([k, l]) =>
        `<option value="${k}"${values?.appliesTo === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <div><label for="period">How often</label><select id="period" name="period">${Object.entries(FEE_PERIODS).map(([k, l]) =>
        `<option value="${k}"${values?.period === k ? ' selected' : ''}>${esc(l.label)}</option>`).join('')}</select></div>
      <div><label for="amount">Amount (${region().currency})</label><input id="amount" name="amount" required inputmode="decimal" maxlength="12" value="${v('amountText')}"></div>
      <div><label for="effectiveFrom">From <span class="muted">(optional)</span></label><input id="effectiveFrom" name="effectiveFrom" maxlength="10" placeholder="${esc(today)}" value="${v('effectiveFrom')}"></div>
    </div>
    <p class="muted">A new price for the same people and period takes over from its start date; the old one ends the day before.</p>
    <div class="actions"><button class="btn" type="submit">Save price</button></div>
  </form>` : ''}

  <h2>Who is due</h2>
  <form method="post" action="/o/${esc(org.slug)}/renewals">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <table><thead><tr><th></th><th>Member</th><th>Fees run to</th><th></th><th>Last reminded</th></tr></thead><tbody>${
    rows.map((r) => `<tr>
      <td>${r.standing === 'exempt' || r.asked ? '' : `<input type="checkbox" name="pick_${esc(r.affiliation_id)}" value="1"${
        ['overdue', 'due', 'unpaid'].includes(r.standing) ? ' checked' : ''} aria-label="Ask ${esc(r.name)}">`}</td>
      <td><a href="/p/${esc(r.person_id)}">${esc(r.name)}</a>
        <span class="muted">${esc(r.display_number ?? '')}${r.role !== 'member' ? ` · ${esc(r.role)}` : ''}</span></td>
      <td>${esc(r.paid_until ?? '—')}</td>
      <td><span class="tag ${STANDING_TAG[r.standing]}">${esc(STANDING_WORDS[r.standing])}</span>${
        r.asked ? ' <span class="muted">asked</span>' : ''}${
        r.fee_exempt ? ` <span class="muted">${esc(EXEMPT_REASONS[r.fee_exempt_reason] ?? '')}</span>` : ''}</td>
      <td class="muted">${esc(r.last_reminded ?? '—')}</td></tr>`).join('')}</tbody></table>
    ${periods.length ? `<div class="row">
      <div><label for="renewPeriod">Ask them to renew</label><select id="renewPeriod" name="period">${periods.map((p) =>
        `<option value="${p}">${esc(FEE_PERIODS[p].label.toLowerCase())}</option>`).join('')}</select></div>
      <div><label for="received">Already handed over?</label><select id="received" name="received">
        <option value="">No — ask them to pay</option>${Object.entries(MANUAL_METHODS).map(([k, l]) =>
          `<option value="${k}">Yes — ${esc(l.toLowerCase())}</option>`).join('')}</select></div></div>
    <p class="muted">${due.length} need renewing. Tick who to include. “Already handed over” records the payment
      and a receipt number straight away, for people paying at the door.</p>
    <div class="actions"><button class="btn" type="submit" name="action" value="renew">Renew the ticked</button></div>` : ''}

    <h2>Remind the ticked</h2>
    <p class="muted">Writes to the ticked members as ${esc(org.name)}. Children are written to through their parent
      or guardian. Anybody not charged is left out. A fees reminder is sent even to people who have
      stopped announcements, and says so. <code>{club}</code> and <code>{payLink}</code> are filled in for you.</p>
    <label for="subject">Subject</label>
    <input id="subject" name="subject" maxlength="150" value="${esc(values?.subject ?? remind?.subject ?? '')}">
    <label for="body">Message</label>
    <textarea id="body" name="body" rows="8" maxlength="10000">${esc(values?.body ?? remind?.body ?? '')}</textarea>
    <div class="actions"><button class="btn" type="submit" name="action" value="remind">Send the reminder</button></div>
  </form>

  ${canExempt ? `<h2>Automatic reminders</h2>
  <form method="post" action="/o/${esc(org.slug)}/renewals/reminders">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <p>${autoReminders ? '<strong>On.</strong>' : '<strong>Off.</strong>'}
      Each morning ${esc(org.name)} writes to members whose fees run out within 30 days, and again to those whose
      fees ran out in the last 60 days — never more than once every 14 days, never to anybody not charged,
      and never to somebody with no paid-until date at all (so an imported roll is not a flood).
      It needs the club's contact email on its page, so replies have somewhere to go.</p>
    <input type="hidden" name="enabled" value="${autoReminders ? '0' : '1'}">
    <div class="actions"><button class="btn quiet" type="submit">${autoReminders ? 'Turn automatic reminders off' : 'Turn automatic reminders on'}</button></div>
  </form>` : ''}

  ${canExempt ? `<h2>People who are not charged</h2>
  <p class="muted">Some people do not pay — an instructor who gives their time, a life member. They stay members and
    are never asked for money. Say why; it is kept in the history.</p>
  <table><tbody>${rows.map((r) => `<tr><td>${esc(r.name)}</td><td>
    <form method="post" action="/o/${esc(org.slug)}/renewals/${esc(r.affiliation_id)}/exempt" style="display:inline">
      <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
      ${r.fee_exempt ? `<input type="hidden" name="exempt" value="0"><button class="btn quiet">Charge ${esc(r.name.split(' ')[0])} fees again</button>`
        : `<input type="hidden" name="exempt" value="1">
           <select name="reason" aria-label="Why ${esc(r.name)} is not charged">${Object.entries(EXEMPT_REASONS).map(([k, l]) =>
             `<option value="${k}"${r.role === 'instructor' && k === 'instructor' ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
           <button class="btn quiet">Do not charge</button>`}
    </form>
    ${r.fee_exempt ? `<form method="post" action="/o/${esc(org.slug)}/renewals/${esc(r.affiliation_id)}/carry-on" style="display:inline">
      <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}"><button class="btn quiet">Carry membership on a year</button></form>` : ''}</td></tr>`).join('')}</tbody></table>` : ''}` });
};

/** The fee categories, with the age of adulthood that applies here in the junior label. */
const feeCategories = () => ({ ...FEE_CATEGORIES, junior: `Juniors (under ${region().adultAge})` });

export const autoRenewScreen = ({ me, csrf, person, memberships = [], test = false, done, error }) => {
  const tok = `<input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">`;
  const base = `/me/${esc(person.id)}/auto-renew`;
  return page({ title: `Automatic renewal — ${person.first_name}`, me, csrf, body: `
  <p><a href="/me/payments">&larr; Payments</a></p>
  <h1>Automatic renewal for ${esc(person.first_name)}</h1>
  <p class="sub">The ${clubWord()} charges your saved card or bank a few days before fees run out, so membership never lapses. You can stop it at any time with one press.</p>
  ${testBanner(test)}
  ${done ? `<div class="good">${esc(done)}</div>` : ''}${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${memberships.length ? memberships.map((m) => `<div class="card"><h2>${esc(m.club)}</h2>
    <p class="muted">Fees run to ${esc(m.paid_until ?? 'not paid yet')}</p>
    ${m.fee_exempt ? `<p>You are not charged by this ${clubWord()}.</p>`
    : m.agreement ? `<p><span class="tag ${m.agreement.status === 'paused' ? 'bad' : 'ok'}">${m.agreement.status === 'paused' ? 'Stopped' : 'On'}</span>
      ${esc(FEE_PERIODS[m.agreement.period]?.label ?? m.agreement.period)} with ${esc(m.agreement.label)}</p>
      ${m.agreement.status === 'paused' ? '<p class="bad">The last payments did not go through, so this has stopped. Stop it here, then set it up again with another card — or pay from My payments.</p>'
        : m.agreement.failures ? `<p class="muted">The last payment did not go through. We will try again on ${esc(m.agreement.next_attempt_on ?? 'soon')}.</p>` : ''}
      <form method="post" action="${base}/${esc(m.agreement.id)}/stop">${tok}<button class="btn quiet" type="submit">Stop automatic renewal</button></form>`
    : Object.keys(m.prices).length ? `<form method="post" action="${base}">${tok}<input type="hidden" name="affiliationId" value="${esc(m.affiliation_id)}">
      <p><label>Renew <select name="period">${Object.entries(m.prices).map(([k, f]) => `<option value="${esc(k)}">${esc(FEE_PERIODS[k]?.label ?? k)} — ${esc(cents(f.amount_cents, f.currency))}</option>`).join('')}</select></label></p>
      <p><label>Pay with <select name="method"><option value="card">Credit or debit card</option><option value="direct_debit">Bank direct debit</option></select></label></p>
      <p><label>Card number (we never keep it — the payment provider does)<br><input name="card" inputmode="numeric" autocomplete="cc-number" maxlength="23"></label></p>
      <p><label><input type="checkbox" name="agreed"> I agree that ${esc(m.club)} may charge this automatically each time fees are due, at the price shown. I can stop it at any time.</label></p>
      <button class="btn" type="submit">Turn on automatic renewal</button></form>`
    : `<p class="muted">This ${clubWord()} has not set prices for automatic renewal yet.</p>`}</div>`).join('') : '<p class="muted">No club memberships to renew.</p>'}` });
};
