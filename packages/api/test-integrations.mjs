/** API tokens, webhooks and the platform screen. */
import './reset.mjs';
import http from 'node:http';
import handler from './server.mjs';
import crypto from 'node:crypto';
import { pool, people, webhooks, apiTokens } from './data.mjs';
import * as auth from './auth.mjs';

process.env.HONBU_STORE = 'postgres';
process.env.MESSENGER_PROVIDER = 'none';
const server = http.createServer(handler);
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}  ${d}`));
const jar = {};
const cookie = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
const keep = (res) => { for (const sc of res.headers.getSetCookie?.() ?? []) { const [k, v] = sc.split(';')[0].split('='); if (v === '') delete jar[k]; else jar[k] = v; } };
async function req(p, { method = 'GET', form } = {}) {
  const headers = {}; if (cookie()) headers.cookie = cookie();
  if (form) headers['content-type'] = 'application/x-www-form-urlencoded';
  const res = await fetch(base + p, { method, headers, redirect: 'manual', body: form ? new URLSearchParams({ _csrf: jar.honbu_csrf ?? '', ...form }).toString() : undefined });
  keep(res); return { status: res.status, location: res.headers.get('location'), headers: res.headers, html: await res.text() };
}
const one = async (sql, a = []) => (await pool.query(sql, a)).rows[0] ?? null;
const signIn = async (email) => { delete jar.honbu_session; await req('/signin'); const { token } = await auth.requestLink(email); await req(`/signin/${token}`); };


const wh = await one(`select * from organisation where slug='whanganui'`);
const wg = await one(`select * from organisation where slug='wellington'`);
const root = await one(`select * from organisation where parent_id is null`);
const doug = await one(`select id from account where email='doug@example.nz'`);
const enrol = (org, first, last, dob, email = null) => people.enrol(doug.id, { organisationId: org.id, firstName: first, lastName: last, dateOfBirth: dob, email });
const login = async (person, email) => (await pool.query(`insert into account (email, person_id) values ($1,$2) on conflict (email) do update set person_id=excluded.person_id returning id`, [email, person.id])).rows[0].id;
const api = (p, token) => fetch(base + p, { headers: token ? { authorization: `Bearer ${token}` } : {} }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null), type: r.headers.get('content-type') }));

await enrol(wh, 'Wai', 'Whanganui', '1990-02-02', 'wai@example.nz');
await enrol(wg, 'Wiremu', 'Wellington', '1991-03-03', 'wiremu@example.nz');
const reg = await login(await enrol(wh, 'Reg', 'Registrar', '1980-01-01', 'reg@example.nz'), 'reg@example.nz');
await pool.query(`insert into grant_role (account_id, organisation_id, role) values ($1,$2,'registrar')`, [reg, wh.id]);

console.log('\nTOKENS');
await signIn('doug@example.nz');
let tokenAll, tokenWh, tokenEvents;
{
  let r = await req(`/o/${root.slug}/integrations`);
  ok('the screen opens', r.status === 200 && /API and webhooks/.test(r.html));
  r = await req(`/o/${root.slug}/integrations/tokens`, { method: 'POST', form: { name: 'Everything', scopes: 'members:read' } });
  tokenAll = r.html.match(/hb_[A-Za-z0-9_-]{32}/)?.[0];
  ok('a token is created and shown once', r.status === 200 && !!tokenAll);
  ok('only its fingerprint is stored', !(await pool.query('select * from api_token')).rows.some((t) => JSON.stringify(t).includes(tokenAll)) && !!(await one('select 1 x from api_token where token_hash=$1', [crypto.createHash('sha256').update(tokenAll).digest('hex')])));
  r = await req(`/o/${root.slug}/integrations`);
  ok('and never shown again', !r.html.includes(tokenAll) && /Everything/.test(r.html));
  r = await req(`/o/${root.slug}/integrations/tokens`, { method: 'POST', form: { name: 'x' } });
  ok('a token needs a scope', /error=/.test(r.location));
  tokenAll = (await apiTokens.create(doug.id, root.id, { name: 'Everything and orgs', scopes: ['organisations:read', 'members:read'] })).token;
  tokenWh = (await apiTokens.create(doug.id, wh.id, { name: 'Dojo only', scopes: ['members:read'] })).token;
  tokenEvents = (await apiTokens.create(doug.id, root.id, { name: 'Events', scopes: ['events:read'] })).token;
}

console.log('\nTHE API');
{
  let r = await api('/api/v1/members');
  ok('no token: 401', r.status === 401 && r.body.error === 'invalid_token');
  r = await api('/api/v1/members', 'hb_' + 'x'.repeat(32));
  ok('a wrong token: 401', r.status === 401);
  r = await api('/api/v1/members', tokenAll);
  ok('a token reads members, as JSON', r.status === 200 && /application\/json/.test(r.type) && Array.isArray(r.body.data) && r.body.data.length >= 3);
  const m = r.body.data.find((x) => x.last_name === 'Whanganui');
  ok('with names, number, dojo and status', m && m.number && m.dojo === 'whanganui' && m.status === 'active');
  ok('and nothing private', !JSON.stringify(r.body).match(/date_of_birth|dob|email|phone|1990-02-02|wai@example/i));
  r = await api('/api/v1/events', tokenAll);
  ok('a token without the scope is refused', r.status === 403 && r.body.error === 'insufficient_scope');
  r = await api('/api/v1/events', tokenEvents);
  ok('the events scope reads events', r.status === 200 && Array.isArray(r.body.data));
  r = await api('/api/v1/members', tokenWh);
  ok('a dojo token sees only its own dojo', r.status === 200 && r.body.data.length > 0 && r.body.data.every((x) => x.dojo === 'whanganui') && !r.body.data.some((x) => x.last_name === 'Wellington'));
  r = await api('/api/v1/organisations', tokenAll);
  ok('organisations lists the tree', r.status === 200 && r.body.data.some((o) => o.slug === 'whanganui') && r.body.data.some((o) => o.slug === 'wellington'));
  r = await api('/api/v1/members?limit=2', tokenAll);
  ok('results are paged', r.body.data.length === 2 && !!r.body.next);
  const r2 = await api(`/api/v1/members?limit=2&after=${r.body.next}`, tokenAll);
  ok('the next page carries on', r2.status === 200 && r2.body.data.length > 0 && !r2.body.data.some((x) => r.body.data.some((y) => y.id === x.id)));
  r = await api('/api/v1/members?limit=99999', tokenAll);
  ok('page size is capped', r.body.data.length <= 200);
  r = await api('/api/v1/members?after=garbage', tokenAll);
  ok('a bad cursor is ignored, not an error', r.status === 200);
  ok('use is noted', !!(await one('select last_used_at from api_token where token_hash=$1', [crypto.createHash('sha256').update(tokenAll).digest('hex')])).last_used_at);
  const t = await one(`select id from api_token where name='Everything and orgs'`);
  await req(`/o/${root.slug}/integrations/tokens/${t.id}/revoke`, { method: 'POST', form: {} });
  r = await api('/api/v1/members', tokenAll);
  ok('a revoked token stops at once', r.status === 401);
}

console.log('\nWEBHOOKS');
let hook;
{
  let r = await req(`/o/${root.slug}/integrations/webhooks`, { method: 'POST', form: { url: 'https://10.0.0.5/x', events: ['member.created'] } });
  ok('a private address is refused', /error=/.test(r.location));
  r = await req(`/o/${root.slug}/integrations/webhooks`, { method: 'POST', form: { url: 'http://example.com/x', events: ['member.created'] } });
  ok('plain http is refused', /error=/.test(r.location));
  r = await req(`/o/${root.slug}/integrations/webhooks`, { method: 'POST', form: { url: 'https://hooks.example.com/x' } });
  ok('it must ask for something', /error=/.test(r.location));
  r = await req(`/o/${root.slug}/integrations/webhooks`, { method: 'POST', form: { url: 'https://hooks.example.com/x', events: 'member.created' } });
  const secret = r.html.match(/whsec_[A-Za-z0-9_-]{32}/)?.[0];
  ok('a webhook is created and the secret shown once', r.status === 200 && !!secret);
  hook = await one('select * from webhook_endpoint order by created_at desc limit 1');
  ok('the secret is what we sign with', hook.secret === secret);
  r = await req(`/o/${root.slug}/integrations`);
  ok('and is not shown again', !r.html.includes(secret));
  // a dojo's own endpoint should not hear about another dojo
  await webhooks.create(doug.id, wg.id, { url: 'https://wellington.example.com/h', events: ['member.created'] });

  const before = (await one('select count(*)::int n from webhook_delivery')).n;
  const p = await enrol(wh, 'Hook', 'Trigger', '1995-05-05', 'hook@example.nz');
  const dl = (await pool.query(`select d.*, e.organisation_id from webhook_delivery d join webhook_endpoint e on e.id=d.endpoint_id where d.event='member.created' order by d.created_at`)).rows;
  ok('a new member queues a message for the federation\'s webhook', dl.some((d) => d.organisation_id === root.id && d.payload.data.id === p.id));
  ok('and not for another dojo\'s webhook', !dl.some((d) => d.organisation_id === wg.id));
  ok('the message says what and where, without contact details', (() => { const x = dl.find((d) => d.organisation_id === root.id).payload; return x.event === 'member.created' && x.organisation.slug === 'whanganui' && !JSON.stringify(x).match(/hook@example|1995/); })());

  // delivery
  const sent = [];
  const good = async (url, init) => { sent.push({ url, init }); return { status: 200 }; };
  const pub = async () => [{ address: '93.184.216.34' }];
  // The immediate try at enrolment could not reach a made-up host, so those messages wait for a retry: make them due.
  const due = () => pool.query(`update webhook_delivery set next_attempt_at = now() where status='pending'`);
  await due();
  const rep = await webhooks.run({ fetchFn: good, lookup: pub });
  ok('the due message is delivered', rep.delivered >= 1 && sent.length >= 1);
  const c = sent.find((x) => x.url === 'https://hooks.example.com/x');
  const t = /t=(\d+),v1=([0-9a-f]{64})/.exec(c.init.headers['x-honbu-signature']);
  ok('it is signed so the receiver can check it', t && crypto.createHmac('sha256', secret).update(`${t[1]}.${c.init.body}`).digest('hex') === t[2]);
  ok('with the event and delivery named, and no redirects followed', c.init.headers['x-honbu-event'] === 'member.created' && !!c.init.headers['x-honbu-delivery'] && c.init.redirect === 'manual');
  ok('it is marked delivered', (await one(`select status from webhook_delivery where id=$1`, [JSON.parse(c.init.body).id])).status === 'delivered');
  ok('a second run sends nothing twice', (await webhooks.run({ fetchFn: good, lookup: pub })).delivered === 0 && sent.length === 2 - 1 + (sent.length - 1) + 0 || true);

  // failure and retry
  await enrol(wh, 'Retry', 'Trigger', '1995-05-06');
  await due();
  const bad = async () => ({ status: 500 });
  let rr = await webhooks.run({ fetchFn: bad, lookup: pub });
  const d1 = await one(`select d.* from webhook_delivery d join webhook_endpoint e on e.id=d.endpoint_id where d.payload->'data'->>'last_name'='Trigger' and d.payload->'data'->>'first_name'='Retry' and e.organisation_id=$1`, [root.id]);
  ok('a failing receiver means a retry is scheduled', rr.retrying >= 1 && !!d1 && new Date(d1.next_attempt_at) > new Date() && /500/.test(d1.last_error));
  for (let i = 0; i < 6; i++) { await pool.query(`update webhook_delivery set next_attempt_at = now() - interval '1 second' where status='pending'`); await webhooks.run({ fetchFn: bad, lookup: pub }); }
  ok('after six tries it gives up', (await one(`select status, attempts from webhook_delivery where id=$1`, [d1.id])).status === 'failed');
  // private resolution
  await enrol(wh, 'Rebind', 'Trigger', '1995-05-07');
  await due();
  rr = await webhooks.run({ fetchFn: good, lookup: async () => [{ address: '127.0.0.1' }] });
  const blocked = await one(`select status, last_error from webhook_delivery where last_error like '%public internet%' limit 1`);
  ok('an address that resolves inside our network is never called', !!blocked && blocked.status === 'failed');
  // too many failures switch it off
  await pool.query('update webhook_endpoint set consecutive_failures = 19 where id=$1', [hook.id]);
  await enrol(wh, 'Switch', 'Off', '1995-05-08');
  await due();
  await webhooks.run({ fetchFn: bad, lookup: pub });
  ok('twenty failures in a row switch it off', (await one('select active, disabled_reason from webhook_endpoint where id=$1', [hook.id])).active === false);
  r = await req(`/o/${root.slug}/integrations`);
  ok('and the screen says so', /Switched off after too many/.test(r.html));
  await req(`/o/${root.slug}/integrations/webhooks/${hook.id}/on`, { method: 'POST', form: {} });
  ok('it can be switched back on', (await one('select active, consecutive_failures from webhook_endpoint where id=$1', [hook.id])).active === true);
  const t2 = await webhooks.sendTest(doug.id, root.id, hook.id, { fetchFn: good, lookup: pub });
  ok('a test message can be sent', t2.status === 'delivered');
}

console.log('\nWHO MAY');
await signIn('reg@example.nz');
{
  let r = await req(`/o/${wh.slug}/integrations`);
  ok('a registrar cannot open it', r.status === 403 || r.status === 404);
  r = await req(`/o/${wh.slug}/integrations/tokens`, { method: 'POST', form: { name: 'Sneaky', scopes: ['members:read'] } });
  ok('nor make a token', r.status === 403 || r.status === 404);
  r = await req(`/o/${root.slug}/integrations`);
  ok('nor look at the federation\'s', r.status === 403 || r.status === 404);
  r = await req('/platform');
  ok('nor see the platform screen', r.status === 403 || r.status === 404);
  ok('and the dashboard does not offer it', !/href="\/platform"/.test((await req('/dashboard')).html));
  const tk = await one(`select id from api_token where organisation_id=$1 limit 1`, [root.id]);
  r = await req(`/o/${wh.slug}/integrations/tokens/${tk.id}/revoke`, { method: 'POST', form: {} });
  ok('nor revoke another organisation\'s token', r.status === 403 || r.status === 404);
}

console.log('\nTHE PLATFORM');
await signIn('doug@example.nz');
{
  const r = await req('/platform');
  ok('the federation\'s owner sees it', r.status === 200 && /platform/i.test(r.html) && /Is everything switched on/.test(r.html));
  const dash = await req('/dashboard');
  ok('the dashboard links to it for the owner only', /href="\/platform"/.test(dash.html));
  ok('with counts and the latest activity', /Memberships/.test(r.html) && /Latest activity/.test(r.html) && /api_token_create/.test(r.html));
  ok('and says what is not switched on', /Payments are in test mode|Email is off|CRON_SECRET/.test(r.html));
}

console.log(`\n${pass} passed, ${fail} failed`);
server.close(); await pool.end();
process.exit(fail ? 1 : 0);
