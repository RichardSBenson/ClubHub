/**
 * Screens: the shop. What a member sees of their own club's range, the public page, and the club's (or the
 * federation's) admin. Re-exported by views.mjs, so callers still say V.shopScreen and so on.
 */
import { page, when } from './views.mjs';
import { esc } from '../core/domain/html.mjs';
import { money as cents } from '../core/domain/money.mjs';
import { words } from '../infrastructure/region-context.mjs';

const clubWord = () => words().club.toLowerCase();

// ---------------------------------------------------------------------------
// the shop
// ---------------------------------------------------------------------------

import { CATEGORIES as SHOP_CATEGORIES, ORDER_STATUSES as SHOP_STATUSES, mayMoveOrder as shopMayMove } from '../core/domain/shop.mjs';

const plainAmount = (c) => c == null ? '' : (c / 100).toFixed(2).replace(/\.00$/, '');
const shopLines = (o) => (o.lines ?? []).map((l) => `${esc(l.name)}${l.size ? ` (${esc(l.size)})` : ''} × ${esc(l.quantity)}`).join(', ');

/** What a signed-in member sees: only their own club's range. */
export const shopScreen = ({ me, csrf, person, clubs = [], done, error }) => {
  const tok = `<input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">`;
  const base = `/me/${esc(person.id)}/shop`;
  return page({ title: `Shop — ${person.first_name}`, me, csrf, body: `
  <p><a href="/me">&larr; Home</a></p>
  <h1>Shop</h1>
  <p class="sub">Gear for ${esc(person.first_name)}, ordered through the ${clubWord()}. You pay the ${clubWord()} when you collect it.</p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${clubs.map(({ club, range, orders }) => `<h2>${esc(club.name)}</h2>
  ${range.length ? `<form method="post" action="${base}">${tok}<input type="hidden" name="clubId" value="${esc(club.id)}">
    <table><thead><tr><th>Item</th><th>Price</th><th>Size</th><th>How many</th></tr></thead><tbody>${range.map((p) => `<tr>
      <td><strong>${esc(p.name)}</strong> <span class="muted">${esc(SHOP_CATEGORIES[p.category] ?? '')}</span>${p.description ? `<div class="muted">${esc(p.description)}</div>` : ''}</td>
      <td>${esc(cents(p.price_cents, p.currency))}</td>
      <td>${p.sizes.length ? `<select name="size_${esc(p.id)}" aria-label="Size for ${esc(p.name)}"><option value="">Choose</option>${p.sizes.map((s) => `<option>${esc(s)}</option>`).join('')}</select>` : '<span class="muted">—</span>'}</td>
      <td><input name="qty_${esc(p.id)}" inputmode="numeric" maxlength="2" size="3" placeholder="0" aria-label="How many ${esc(p.name)}"></td></tr>`).join('')}</tbody></table>
    <p><label>A note for the ${clubWord()} <span class="muted">(optional)</span><br><input name="note" maxlength="300" size="50"></label></p>
    <button class="btn" type="submit">Place order</button></form>`
    : `<p class="muted">${esc(club.name)} has not put anything in its shop yet.</p>`}
  ${orders.length ? `<h3>Your orders</h3><table><tbody>${orders.map((o) => `<tr>
    <td>${esc(when(o.created_at))}</td><td>${shopLines(o)}</td><td>${esc(cents(o.total_cents, o.currency))}</td>
    <td><span class="tag ${o.status === 'cancelled' ? 'no' : o.status === 'placed' ? 'wait' : 'ok'}">${esc(SHOP_STATUSES[o.status] ?? o.status)}</span>
      ${o.status === 'placed' ? `<form method="post" action="${base}/${esc(o.id)}/cancel" style="display:inline">${tok}<button class="btn quiet" type="submit">Cancel</button></form>` : ''}</td></tr>`).join('')}</tbody></table>` : ''}`).join('')
    || '<div class="note">You are not on a club\'s roll, so there is no shop to show.</div>'}` });
};

/** Shown to someone who is not signed in. */
export const shopPublic = ({ me, csrf }) => page({ title: 'Shop', me, csrf, body: `
  <h1>Shop</h1>
  <p class="lede">Gi, gloves, shin pads and tournament tee shirts, ordered through your own ${clubWord()}.</p>
  <p>Each ${clubWord()} has its own range and its own prices, so sign in and the shop shows you what <em>your</em> ${clubWord()} offers.</p>
  <p><a class="btn" href="/signin">Sign in to the shop</a></p>
  <p class="muted">Not a member yet? <a href="/find-a-club">Find your nearest ${clubWord()}</a>.</p>` });

/** The club's (or federation's) side: orders, its own items, and the national range it can hide or reprice. */
export const shopAdminScreen = ({ me, csrf, org, isClub, own = [], national = [], orders = [], done, error }) => {
  const tok = `<input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">`;
  const base = `/o/${esc(org.slug)}/shop`;
  const fields = (p = {}) => `<label>Name <input name="name" maxlength="100" required value="${esc(p.name ?? '')}"></label>
    <label>Kind <select name="category">${Object.entries(SHOP_CATEGORIES).map(([k, v]) => `<option value="${k}"${p.category === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
    <label>Price <input name="price" inputmode="decimal" size="7" required value="${esc(plainAmount(p.price_cents))}"></label>
    <label>Sizes <input name="sizes" size="30" placeholder="S, M, L  — leave blank if it has none" value="${esc((p.sizes ?? []).join(', '))}"></label>
    <label>Description <input name="description" maxlength="500" size="50" value="${esc(p.description ?? '')}"></label>`;
  return page({ title: `${org.name} — shop`, me, csrf, body: `
  <h1>Shop</h1>
  <p class="sub">${isClub
    ? `Members of this ${clubWord()} see the national range and the items you add here, and nothing from any other ${clubWord()}. You collect the money when they collect the gear.`
    : `Items you add here are the national range. Every ${clubWord()} can offer them, hide the ones it does not want, and set its own price.`}</p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}${error ? `<div class="bad">${esc(error)}</div>` : ''}
  ${isClub ? `<h2>Orders</h2>${orders.length ? `<table><thead><tr><th>When</th><th>Who</th><th>Order</th><th>Total</th><th>Status</th></tr></thead><tbody>${orders.map((o) => `<tr>
    <td>${esc(when(o.created_at))}</td><td><a href="/p/${esc(o.person_id)}">${esc(o.first_name)} ${esc(o.last_name)}</a></td>
    <td>${shopLines(o)}${o.note ? `<div class="muted">${esc(o.note)}</div>` : ''}</td><td>${esc(cents(o.total_cents, o.currency))}</td>
    <td><span class="tag ${o.status === 'cancelled' ? 'no' : o.status === 'collected' ? 'ok' : 'wait'}">${esc(SHOP_STATUSES[o.status] ?? o.status)}</span>
      ${Object.keys(SHOP_STATUSES).filter((s) => shopMayMove(o.status, s)).map((s) => `<form method="post" action="${base}/orders/${esc(o.id)}/status" style="display:inline">${tok}<input type="hidden" name="status" value="${s}"><button class="btn quiet" type="submit">${esc(s === 'cancelled' ? 'Cancel order' : `Mark ${SHOP_STATUSES[s].toLowerCase()}`)}</button></form>`).join('')}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">No orders yet.</p>'}` : ''}
  ${isClub ? `<h2>The national range</h2>${national.length ? `<table><thead><tr><th>Item</th><th>National price</th><th>Your price</th><th></th></tr></thead><tbody>${national.map((p) => `<tr>
    <td>${esc(p.name)} <span class="muted">${esc(SHOP_CATEGORIES[p.category] ?? '')}</span></td><td>${esc(cents(p.price_cents, p.currency))}</td>
    <td colspan="2"><form method="post" action="${base}/listing/${esc(p.id)}" style="display:inline">${tok}
      <input name="price" inputmode="decimal" size="7" placeholder="${esc(plainAmount(p.price_cents))}" value="${esc(plainAmount(p.own_price_cents))}" aria-label="Your price for ${esc(p.name)}">
      <label><input type="checkbox" name="hidden"${p.hidden ? ' checked' : ''}> Hide from my members</label>
      <button class="btn quiet" type="submit">Save</button></form></td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">The federation has not set up a national range yet.</p>'}` : ''}
  <h2>${isClub ? 'Your own items' : 'National range'}</h2>
  ${own.length ? own.map((p) => `<div class="card"><details><summary><strong>${esc(p.name)}</strong> · ${esc(SHOP_CATEGORIES[p.category] ?? '')} · ${esc(cents(p.price_cents, p.currency))}${p.sizes.length ? ` · sizes ${esc(p.sizes.join(', '))}` : ''}${p.active ? '' : ' <span class="tag no">Not for sale</span>'}</summary>
    <form method="post" action="${base}/products/${esc(p.id)}">${tok}${fields(p)}<button class="btn" type="submit">Save</button></form></details>
    <form method="post" action="${base}/products/${esc(p.id)}/active">${tok}<input type="hidden" name="active" value="${p.active ? '' : 'yes'}"><button class="btn quiet" type="submit">${p.active ? 'Take off sale' : 'Put back on sale'}</button></form></div>`).join('')
    : '<p class="muted">Nothing here yet.</p>'}
  <h3>Add an item</h3>
  <form method="post" action="${base}/products">${tok}${fields()}<button class="btn" type="submit">Add</button></form>` });
};
