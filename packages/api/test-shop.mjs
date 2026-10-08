/**
 * The shop: who sees which range, server-side prices, ordering for yourself or a child, and the dojo's side.
 */
import './reset.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(exec);
import handler from './server.mjs';
import { pool, people, shop } from './data.mjs';
import * as auth from './auth.mjs';

process.env.HONBU_STORE = 'postgres';
process.env.MESSENGER_PROVIDER = 'none';
process.env.CRON_SECRET = 'test-cron-secret';
const OUT = '/tmp/honbu-shop';
const server = http.createServer(handler);
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`))
                               : (fail++, console.log(`  ✗ ${n}  ${d}`));
const jar = {};
const cookie = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
const keep = (res) => {
  for (const sc of res.headers.getSetCookie?.() ?? []) {
    const [k, v] = sc.split(';')[0].split('=');
    if (v === '') delete jar[k]; else jar[k] = v;
  }
};
async function req(p, { method = 'GET', form } = {}) {
  const headers = {};
  if (cookie()) headers.cookie = cookie();
  if (form) headers['content-type'] = 'application/x-www-form-urlencoded';
  const res = await fetch(base + p, { method, headers, redirect: 'manual',
    body: form ? new URLSearchParams({ _csrf: jar.honbu_csrf ?? '', ...form }).toString()
               : undefined });
  keep(res);
  return { status: res.status, location: res.headers.get('location'),
           headers: res.headers, html: await res.text() };
}
async function multi(p, fields = {}, file = null) {
  const fd = new FormData();
  fd.append('_csrf', jar.honbu_csrf ?? '');
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  if (file) fd.append(file.field, new Blob([file.bytes], { type: 'image/png' }), file.name);
  const res = await fetch(base + p, { method: 'POST', headers: { cookie: cookie() }, redirect: 'manual', body: fd });
  keep(res);
  return { status: res.status, location: res.headers.get('location'), html: await res.text() };
}
const one = async (sql, a = []) => (await pool.query(sql, a)).rows[0] ?? null;
const signIn = async (email) => {
  delete jar.honbu_session;
  await req('/signin');
  const { token } = await auth.requestLink(email);
  await req(`/signin/${token}`);
};

const wh = await one(`select * from organisation where slug='whanganui'`);
const other = await one(`select * from organisation where type='club' and slug <> 'whanganui' order by slug limit 1`);
const root = await one(`select * from organisation where parent_id is null order by created_at limit 1`);
const doug = await one(`select id from account where email='doug@example.nz'`);
const enrolAt = (org, first, last, dob, email = null) => people.enrol(doug.id, { organisationId: org.id, firstName: first, lastName: last, dateOfBirth: dob, email });
const login = (person, email) => pool.query(`insert into account (email, person_id) values ($1,$2) on conflict do nothing`, [email, person.id]);
const product = async (org, name, cents, sizes = [], category = 'gi') => (await one(`insert into product (organisation_id, name, category, sizes, price_cents) values ($1,$2,$3,$4,$5) returning id`, [org.id, name, category, sizes, cents])).id;

const gi = await product(root, 'National gi', 12000, ['0', '1', '2']);
const gloves = await product(root, 'National gloves', 4500, [], 'gloves');
const whTee = await product(wh, 'Whanganui tournament tee', 3500, ['S', 'M', 'L'], 'tournament_tee');
const otherTee = await product(other, 'Other dojo tournament tee', 3000, ['S', 'M'], 'tournament_tee');

const ann = await enrolAt(wh, 'Ann', 'Shopper', '1990-01-01', 'ann@example.nz'); await login(ann, 'ann@example.nz');
const ollie = await enrolAt(other, 'Ollie', 'Other', '1990-01-01', 'ollie@example.nz'); await login(ollie, 'ollie@example.nz');
const nobody = await enrolAt(wh, 'Nina', 'Nobody', '1990-01-01', 'nina@example.nz'); await login(nobody, 'nina@example.nz');
const reg = await enrolAt(wh, 'Rita', 'Registrar', '1980-01-01', 'rita@example.nz'); await login(reg, 'rita@example.nz');
await pool.query(`insert into grant_role (account_id, organisation_id, role) select a.id, $1, 'registrar' from account a where a.email='rita@example.nz'`, [wh.id]);

const names = (r) => r.range.map((p) => p.name);

console.log('\nWHO SEES WHAT');
{
  const mine = await shop.forPerson((await one(`select id from account where email='ann@example.nz'`)).id, ann.id);
  ok('a member sees the national range', names(mine.clubs[0]).includes('National gi') && names(mine.clubs[0]).includes('National gloves'));
  ok('and their own dojo\'s items', names(mine.clubs[0]).includes('Whanganui tournament tee'));
  ok('but never another dojo\'s', !names(mine.clubs[0]).includes('Other dojo tournament tee'));
  const theirs = await shop.forPerson((await one(`select id from account where email='ollie@example.nz'`)).id, ollie.id);
  ok('the other dojo\'s member sees their own tee and not Whanganui\'s', names(theirs.clubs[0]).includes('Other dojo tournament tee') && !names(theirs.clubs[0]).includes('Whanganui tournament tee'));
}
await signIn('ann@example.nz');
{
  let r = await req('/me/shop');
  ok('/me/shop goes to the member\'s own shop', r.status === 302 && r.location === `/me/${ann.id}/shop`);
  r = await req(`/me/${ann.id}/shop`);
  ok('the page shows the range and prices', /National gi/.test(r.html) && /\$120\.00/.test(r.html) && /Whanganui tournament tee/.test(r.html));
  ok('the page never shows another dojo\'s tee', !/Other dojo tournament tee/.test(r.html));
  r = await req(`/me/${ollie.id}/shop`);
  ok('a stranger cannot open someone else\'s shop', r.status === 403 || r.status === 404);
}

console.log('\nORDERING');
let order;
{
  const f = { clubId: wh.id, [`qty_${gi}`]: '2', [`size_${gi}`]: '1', [`qty_${whTee}`]: '1', [`size_${whTee}`]: 'M', price: '1', [`price_${gi}`]: '1', note: 'For the camp' };
  let r = await req(`/me/${ann.id}/shop`, { method: 'POST', form: f });
  ok('an order is placed', /done=/.test(r.location));
  order = await one(`select * from shop_order where person_id=$1`, [ann.id]);
  ok('the dojo that fills it is theirs', order.organisation_id === wh.id && order.status === 'placed');
  ok('the total uses the server\'s prices, not the form\'s', order.total_cents === 2 * 12000 + 3500);
  r = await req(`/me/${ann.id}/shop`, { method: 'POST', form: { clubId: wh.id, [`qty_${otherTee}`]: '1', [`size_${otherTee}`]: 'S' } });
  ok('another dojo\'s item cannot be ordered even by guessing its id', /error=/.test(r.location));
  r = await req(`/me/${ann.id}/shop`, { method: 'POST', form: { clubId: other.id, [`qty_${otherTee}`]: '1', [`size_${otherTee}`]: 'S' } });
  ok('nor an order placed at a dojo they do not belong to', r.status === 404 || r.status === 403);
  r = await req(`/me/${ann.id}/shop`, { method: 'POST', form: { clubId: wh.id, [`qty_${gi}`]: '1' } });
  ok('a size is required where there are sizes', /error=/.test(r.location));
  r = await req(`/me/${ann.id}/shop`, { method: 'POST', form: { clubId: wh.id, [`qty_${gi}`]: '1', [`size_${gi}`]: '99' } });
  ok('and it must be one on offer', /error=/.test(r.location));
  r = await req(`/me/${ann.id}/shop`, { method: 'POST', form: { clubId: wh.id } });
  ok('an empty basket is refused', /error=/.test(r.location));
  ok('only the one order exists', (await one(`select count(*)::int n from shop_order`)).n === 1);
}
await signIn('nina@example.nz');
{
  const r = await req(`/me/${ann.id}/shop`, { method: 'POST', form: { clubId: wh.id, [`qty_${gloves}`]: '1' } });
  ok('someone else cannot order for Ann', r.status === 403 || r.status === 404);
  const c = await req(`/me/${ann.id}/shop/${order.id}/cancel`, { method: 'POST', form: {} });
  ok('or cancel her order', (c.status === 403 || c.status === 404) && (await one('select status from shop_order where id=$1', [order.id])).status === 'placed');
  const a = await req(`/o/whanganui/shop`);
  ok('a plain member cannot open the dojo\'s shop screen', a.status === 403 || a.status === 404);
}

console.log('\nTHE DOJO\'S SIDE');
await signIn('rita@example.nz');
{
  let r = await req('/o/whanganui/shop');
  ok('the registrar sees the order and the national range', r.status === 200 && /Ann/.test(r.html) && /National gi/.test(r.html) && /For the camp/.test(r.html));
  r = await req('/o/whanganui/shop/listing/' + gi, { method: 'POST', form: { price: '99.50' } });
  ok('the dojo sets its own price on a national item', (await one(`select price_cents from product_listing where product_id=$1 and organisation_id=$2`, [gi, wh.id])).price_cents === 9950);
  r = await req('/o/whanganui/shop/listing/' + otherTee, { method: 'POST', form: { price: '1' } });
  ok('but cannot touch another dojo\'s item', r.status === 404 || r.status === 403);
  r = await req('/o/whanganui/shop/listing/' + gloves, { method: 'POST', form: { hidden: 'on', price: '' } });
  r = await req('/o/whanganui/shop/products', { method: 'POST', form: { name: 'Shin pads', category: 'shin_pads', price: '40', sizes: 'S, M, L', description: '' } });
  ok('the dojo adds its own item', /done=/.test(r.location) && (await one(`select 1 x from product where organisation_id=$1 and name='Shin pads'`, [wh.id])));
  r = await req(`/o/whanganui/shop/products/${gi}`, { method: 'POST', form: { name: 'Hijacked', category: 'gi', price: '1', sizes: '' } });
  ok('it cannot edit the national item itself', (r.status === 404 || r.status === 403) && (await one('select name from product where id=$1', [gi])).name === 'National gi');
  r = await req(`/o/whanganui/shop/products`, { method: 'POST', form: { name: 'Free thing', category: 'gi', price: 'free' } });
  ok('a bad price is refused with a message', /error=/.test(r.location));
}
await signIn('ann@example.nz');
{
  let r = await req(`/me/${ann.id}/shop`);
  ok('the dojo\'s price shows to its member', /\$99\.50/.test(r.html));
  ok('a hidden national item disappears for them', !/National gloves/.test(r.html));
  ok('their own dojo\'s new item appears', /Shin pads/.test(r.html));
  const o2 = await req(`/me/${ann.id}/shop`, { method: 'POST', form: { clubId: wh.id, [`qty_${gloves}`]: '1' } });
  ok('a hidden item cannot be ordered', /error=/.test(o2.location));
  const o3 = await req(`/me/${ann.id}/shop`, { method: 'POST', form: { clubId: wh.id, [`qty_${gi}`]: '1', [`size_${gi}`]: '0' } });
  const last = await one(`select total_cents from shop_order order by created_at desc limit 1`);
  ok('the new price applies to new orders only', last.total_cents === 9950 && (await one('select total_cents from shop_order where id=$1', [order.id])).total_cents === 27500);
  r = await req(`/me/${ann.id}/shop/${order.id}/cancel`, { method: 'POST', form: {} });
  ok('a member can cancel an order the dojo has not touched', (await one('select status from shop_order where id=$1', [order.id])).status === 'cancelled');
}
await signIn('rita@example.nz');
{
  const o = await one(`select id from shop_order where status='placed' limit 1`);
  let r = await req(`/o/whanganui/shop/orders/${o.id}/status`, { method: 'POST', form: { status: 'paid' } });
  r = await req(`/o/whanganui/shop/orders/${o.id}/status`, { method: 'POST', form: { status: 'ready' } });
  r = await req(`/o/whanganui/shop/orders/${o.id}/status`, { method: 'POST', form: { status: 'collected' } });
  ok('the dojo moves an order along to collected', (await one('select status from shop_order where id=$1', [o.id])).status === 'collected');
  r = await req(`/o/whanganui/shop/orders/${o.id}/status`, { method: 'POST', form: { status: 'placed' } });
  ok('and cannot take it backwards', /error=/.test(r.location) && (await one('select status from shop_order where id=$1', [o.id])).status === 'collected');
  const cancelled = await one(`select id from shop_order where status='cancelled' limit 1`);
  r = await req(`/o/whanganui/shop/orders/${cancelled.id}/status`, { method: 'POST', form: { status: 'paid' } });
  ok('a cancelled order stays cancelled', (await one('select status from shop_order where id=$1', [cancelled.id])).status === 'cancelled');
}
await signIn('ann@example.nz');
{
  const o = await one(`select id from shop_order where status='collected' limit 1`);
  const r = await req(`/me/${ann.id}/shop/${o.id}/cancel`, { method: 'POST', form: {} });
  ok('a collected order cannot be cancelled by the member', /error=/.test(r.location) && (await one('select status from shop_order where id=$1', [o.id])).status === 'collected');
}

console.log('\nTHE NATIONAL RANGE');
await signIn('doug@example.nz');
{
  let r = await req(`/o/${root.slug}/shop`);
  ok('the federation\'s owner sees the national range screen', r.status === 200 && /National gi/.test(r.html) && !/Orders/.test(r.html));
  r = await req(`/o/${root.slug}/shop/products`, { method: 'POST', form: { name: 'National tee', category: 'tournament_tee', price: '30', sizes: 'S, M' } });
  ok('and adds to it', (await one(`select 1 x from product where organisation_id=$1 and name='National tee'`, [root.id])));
}
{
  const a = await req('/shop');
  ok('/shop sends a signed-in person to their shop', a.status === 302);
}
delete jar.honbu_session;
{
  const r = await req('/shop');
  ok('/shop for a visitor explains and invites a sign-in', r.status === 200 && /Sign in to the shop/.test(r.html) && !/National gi/.test(r.html));
}

console.log(`\n${pass} passed, ${fail} failed`);
server.close(); await pool.end();
process.exit(fail ? 1 : 0);
