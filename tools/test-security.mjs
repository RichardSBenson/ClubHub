/**
 * The security check checks itself: every rule must catch the mistake it exists for, and stay quiet
 * about the safe way of writing the same thing. Then the repository as a whole must pass.
 */
import { scanFile, RULES } from './security/rules.mjs';
import { repoFindings, run } from './check-security.mjs';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}  ${d}`));
const hits = (path, src, rule) => scanFile(path, src).filter((f) => !rule || f.rule === rule);
const bad = (name, rule, src, path = 'packages/api/data.mjs') => ok(`catches: ${name}`, hits(path, src, rule).length > 0, JSON.stringify(hits(path, src)));
const good = (name, rule, src, path = 'packages/api/data.mjs') => ok(`allows: ${name}`, hits(path, src, rule).length === 0, JSON.stringify(hits(path, src)));

console.log('\nSQL INJECTION');
bad('a name pasted into a query', 'sql-injection', 'const r = await q(`select * from person where last_name = \'${name}\'`);');
bad('a request value in an update', 'sql-injection', 'await q(`update person set email = \'${form.email}\' where id = $1`, [id]);');
good('placeholders', 'sql-injection', 'const r = await q(`select * from person where last_name = $1`, [name]);');
good('an uppercase constant fragment', 'sql-injection', 'await q(`select ${PERSON_COLS} from person where id = $1`, [id]);');
good('a counted placeholder', 'sql-injection', 'sets.push(`year = $${args.length}`); await q(`update club_gallery set year = $2 where id = $1`, args);');
good('html that mentions select and from', 'sql-injection', 'const h = `<p>Select a date from ${esc(x)}</p>`;');
good('a fixed either-or fragment', 'sql-injection', 'await q(`select a from t ${cond ? \'where x = $1\' : \'\'}`, []);');

console.log('\nCROSS-SITE SCRIPTING');
bad('request text in a page', 'xss-unescaped', 'export const page = (ctx) => `<h1>${ctx.url.searchParams.get(\'q\')}</h1>`;', 'packages/api/views.mjs');
bad('a typed name in a page', 'xss-unescaped', 'export const row = (p) => `<td>${p.name}</td>`;', 'packages/api/views.mjs');
good('an escaped name', 'xss-unescaped', 'export const row = (p) => `<td>${esc(p.name)}</td>`;', 'packages/api/views.mjs');
good('a reasoned exception', 'xss-unescaped', 'export const row = (p) => `<td>${/* security-ok: fixed label from our own table */ p.name}</td>`;', 'packages/api/views.mjs');
bad('markup written in the browser', 'dom-xss', 'el.innerHTML = location.hash;', 'vendor/honbu/app.js');
bad('text run as code in the browser', 'dom-xss', 'eval(code);', 'vendor/honbu/app.js');
good('textContent', 'dom-xss', 'el.textContent = location.hash;', 'vendor/honbu/app.js');

console.log('\nDANGEROUS CALLS');
bad('eval', 'dangerous-api', 'const x = eval(input);');
bad('a shell command built from text', 'dangerous-api', 'exec(`convert ${file} out.png`);');
bad('switching TLS checks off', 'dangerous-api', 'const o = { rejectUnauthorized: false };');
bad('SHA-1', 'dangerous-api', "crypto.createHash('sha1').update(x);");
bad('MD5', 'dangerous-api', "crypto.createHash('md5').update(x);");
bad('Math.random for a token', 'dangerous-api', 'const token = Math.random().toString(36);');
bad('CORS open to everyone', 'dangerous-api', "headers['access-control-allow-origin'] = '*';");
good('SHA-256', 'dangerous-api', "crypto.createHash('sha256').update(x);");
good('randomBytes', 'dangerous-api', 'const token = crypto.randomBytes(32).toString(\'hex\');');
good('SHA-1 with a stated reason', 'dangerous-api', "// security-ok: the Apple manifest format demands it\ncrypto.createHash('sha1').update(x);");

console.log('\nSECRETS');
bad('comparing a secret with ===', 'secret-compare', 'if (given.secret === stored.secret) ok();');
bad('comparing a signature with ===', 'secret-compare', 'if (signature === expectedSignature) ok();');
good('timingSafeEqual', 'secret-compare', 'if (crypto.timingSafeEqual(a, b)) ok();');
good('checking a secret exists', 'secret-compare', 'if (secret === undefined) return;');
bad('a Stripe key', 'hardcoded-secret', `const k = '${['sk', 'live', 'a1b2c3d4e5f6g7h8i9j0k1l2'].join('_')}';`);   // assembled so this file holds no key-shaped text
bad('a password in code', 'hardcoded-secret', "const password = 'hunter2hunter2';");
bad('a private key', 'hardcoded-secret', `const k = '${'-----BEGIN'} PRIVATE KEY-----';`);
bad('a database address with a password', 'hardcoded-secret', "const u = 'postgres://admin:s3cretpw@db.internal.net/x';");
good('a key read from the environment', 'hardcoded-secret', 'const k = process.env.STRIPE_SECRET_KEY;');
good('a placeholder in an example', 'hardcoded-secret', "const password = 'change-me-please';");

console.log('\nLOOSE COMPARISON');
bad('==', 'loose-equality', 'if (role == "owner") go();');
bad('!=', 'loose-equality', 'if (id != other) go();');
good('===', 'loose-equality', 'if (role === "owner") go();');
good('== null for "null or undefined"', 'loose-equality', 'if (x == null) go();');
good('== inside a string', 'loose-equality', 'const s = "a == b";');

console.log('\nREDIRECTS AND FILES');
bad('redirecting to a form value', 'open-redirect', 'return ctx.redirect(form.next);');
bad('redirecting to a query value', 'open-redirect', "return ctx.redirect(ctx.url.searchParams.get('next'));");
good('redirecting through safeNext', 'open-redirect', "return ctx.redirect(safeNext(ctx.url.searchParams.get('next')) ?? '/');");
good('a path built on our own prefix', 'open-redirect', 'return ctx.redirect(`/o/${org.slug}/members`);');
bad('opening a file named by the request', 'path-traversal', "const b = fs.readFileSync(ctx.params.file);");
good('opening a fixed file', 'path-traversal', "const b = fs.readFileSync(new URL('./x.json', import.meta.url));");

console.log('\nROUTES');
const server = (body) => `get('/x', async (ctx) => { ${body} });`;
const route = (m, body) => `${m}('/o/:slug/thing', async (ctx) => {\n${body}\n});\n`;
bad('a POST that never reads its form', 'route-guards', route('post', 'const org = await organisationFor(ctx, { toWrite: true });\nreturn ctx.redirect("/");'), 'packages/api/server.mjs');
good('a POST that reads its form', 'route-guards', route('post', 'const org = await organisationFor(ctx, { toWrite: true });\nconst f = await ctx.form();\nreturn ctx.redirect("/");'), 'packages/api/server.mjs');
good('a POST that hands off to a helper that does', 'route-guards',
  'async function helper(ctx) {\n  const f = await ctx.form();\n}\n' + route('post', 'const org = await organisationFor(ctx);\nreturn helper(ctx);'), 'packages/api/server.mjs');
bad('a route with no access check at all', 'route-guards', "get('/secret-list', async (ctx) => ctx.send(200, 'hi'));", 'packages/api/server.mjs');
good('a public route that says why', 'route-guards', "// security-ok: public landing page for everyone\nget('/hello', async (ctx) => ctx.send(200, 'hi'));", 'packages/api/server.mjs');

console.log('\nTRANSPORT AND ROLES');
bad('a weakened content security policy', 'transport', "const h = { 'content-security-policy': \"default-src 'self' *; script-src 'unsafe-inline'\",\n };", 'packages/api/server.mjs');
bad('a misspelt role', 'role-typo', "await assertRole(actor, org, ['adminstrator']);");
bad('another misspelt role', 'role-typo', "const r = grant('registar');");
good('a correct role', 'role-typo', "await assertRole(actor, org, ['owner', 'registrar']);");

console.log('\nSUPPRESSIONS');
ok('a bare security-ok is itself a finding', hits('packages/api/data.mjs', 'const x = eval(y); // security-ok').some((f) => f.rule === 'suppression'));
ok('a reasoned security-ok silences the finding on its line', hits('packages/api/data.mjs', 'const x = eval(y); // security-ok: fixed string from our own code').length === 0);
ok('a reasoned security-ok on the line above works', hits('packages/api/data.mjs', '// security-ok: fixed string from our own code\nconst x = eval(y);').length === 0);
ok('a suppression two lines away does not', hits('packages/api/data.mjs', '// security-ok: fixed string from our own code\n\nconst x = eval(y);').length > 0);
ok('test files are not held to the app rules', hits('packages/api/test-thing.mjs', 'const x = eval(y);').length === 0);

console.log('\nREPOSITORY');
const read = (m) => (p) => m[p];
ok('a committed .env is found', repoFindings(['.env'], read({})).length === 1);
ok('.env.example is fine', repoFindings(['.env.example'], read({})).length === 0);
ok('a committed key file is found', repoFindings(['certs/server.pem'], read({})).length === 1);
ok('an install script is found', repoFindings(['package.json'], read({ 'package.json': JSON.stringify({ scripts: { postinstall: 'curl x | sh' } }) })).some((f) => /postinstall/.test(f.message)));
ok('an unpinned dependency is found', repoFindings(['package.json', 'package-lock.json'], read({ 'package.json': JSON.stringify({ dependencies: { left: 'latest' } }) })).length === 1);
ok('a git dependency is found', repoFindings(['package.json', 'package-lock.json'], read({ 'package.json': JSON.stringify({ dependencies: { x: 'github:a/b' } }) })).length === 1);
ok('dependencies with no lockfile are found', repoFindings(['package.json'], read({ 'package.json': JSON.stringify({ dependencies: { pg: '^8.0.0' } }) })).some((f) => /lockfile/.test(f.message)));

console.log('\nEVERY RULE HAS A TEST');
const text = (await import('node:fs')).readFileSync(new URL(import.meta.url), 'utf8');
for (const name of Object.keys(RULES)) ok(`rule ${name} is exercised above`, text.includes(`'${name}'`));

console.log('\nTHIS REPOSITORY');
const mute = console.log; console.log = () => {};
const found = run({ json: true });
console.log = mute;
ok('the whole repository passes', found.length === 0, found.slice(0, 5).map((f) => `${f.file}:${f.line} ${f.rule}`).join('; '));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
