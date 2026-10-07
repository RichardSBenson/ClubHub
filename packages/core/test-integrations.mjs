import { SCOPES, EVENTS, readScopes, problemsWithToken, isPrivateAddress, problemWithUrl, problemsWithWebhook, readEvents, retryAt, MAX_ATTEMPTS, wants, pageSize } from './domain/integrations.mjs';
let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}  ${d}`));

console.log('\nTOKENS');
ok('only known scopes survive', readScopes({ scopes: ['members:read', 'admin:everything'] }).join() === 'members:read');
ok('a single scope as a string works', readScopes({ scopes: 'events:read' }).join() === 'events:read');
ok('a token needs a name and a scope', problemsWithToken({ name: '', scopes: [] }).length === 2 && problemsWithToken({ name: 'Xero', scopes: ['members:read'] }).length === 0);
ok('all scopes are read-only', Object.keys(SCOPES).every((s) => s.endsWith(':read')));

console.log('\nADDRESSES WE WILL NOT CALL');
for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '224.0.0.1', 'garbage'])
  ok(`${ip} is private`, isPrivateAddress(ip));
for (const ip of ['8.8.8.8', '172.32.0.1', '1.1.1.1', '2606:4700::1111']) ok(`${ip} is public`, !isPrivateAddress(ip));
ok('an https address is fine', problemWithUrl('https://hooks.example.com/honbu') === null);
for (const bad of ['http://example.com/x', 'ftp://example.com', 'https://localhost/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://10.0.0.5/x', 'https://user:pw@example.com/x', 'https://intranet/x', 'https://thing.local/x', 'nonsense', '', 'https://metadata.google.internal/x'])
  ok(`"${bad}" is refused`, !!problemWithUrl(bad));
ok('a webhook needs an event', problemsWithWebhook({ url: 'https://a.example.com/x', events: [] }).length === 1);
ok('ping cannot be subscribed to', !readEvents({ events: ['ping', 'member.created'] }).includes('ping'));
ok('unknown events are dropped', readEvents({ events: ['member.created', 'nope'] }).join() === 'member.created');

console.log('\nRETRIES');
const t0 = new Date('2026-01-01T00:00:00Z');
ok('after the first failure, one minute', retryAt(1, t0).getTime() - t0.getTime() === 60_000);
ok('then five, thirty, 120, 720', [2, 3, 4, 5].map((n) => (retryAt(n, t0) - t0) / 60_000).join() === '5,30,120,720');
ok('after the last attempt, give up', retryAt(MAX_ATTEMPTS, t0) === null);
ok('a disabled or inactive endpoint hears nothing', !wants({ active: false, events: ['ping'] }, 'ping') && !wants({ active: true, disabled_at: 'x', events: ['ping'] }, 'ping') && wants({ active: true, events: ['ping'] }, 'ping'));
ok('page sizes are bounded', pageSize('5000') === 200 && pageSize('x') === 50 && pageSize('10') === 10 && pageSize('-4') === 50);
ok('events have wording', Object.values(EVENTS).every((w) => w.length > 5));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
