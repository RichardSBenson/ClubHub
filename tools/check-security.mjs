/**
 * Security check. Reads every source file and looks for the mistakes that let unwanted people in:
 * SQL built from request data, HTML written without escaping, secrets in code, secrets compared the slow way,
 * redirects to anywhere, POST routes that skip the CSRF check, loose comparisons, misspelt roles, weak headers,
 * risky dependencies. Nothing is run and nothing is sent anywhere.
 *
 *   node tools/check-security.mjs            exit 1 if anything is found
 *   node tools/check-security.mjs --json     the findings, for other tools
 *
 * To accept a finding on purpose, put `// security-ok: <the reason>` on that line or the one above.
 * Rules are in tools/security/rules.mjs, each with a test in tools/test-security.mjs.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanFile } from './security/rules.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const SKIP = /(^|\/)(node_modules|dist|data|\.git|\.vercel|\.claude)(\/|$)|^vendor\/easymde\//;

function files() {
  try { return execSync('git ls-files', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean); }
  catch { const out = []; (function walk(d) { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) { const p = d ? `${d}/${e.name}` : e.name; if (SKIP.test(p)) continue; e.isDirectory() ? walk(p) : out.push(p); } })(''); return out; }
}

/** Things about the repository as a whole rather than one file. */
export function repoFindings(all, read) {
  const out = [];
  for (const p of all) if (/(^|\/)\.env(\.|$)/.test(p) && !/\.example$|\.sample$/.test(p)) out.push({ file: p, line: 1, rule: 'repo', message: 'An environment file is committed. Secrets belong in the host\'s settings, not in git.' });
  for (const p of all) if (/\.(pem|key|p12|pfx)$/.test(p) || /(^|\/)id_(rsa|ed25519)$/.test(p)) out.push({ file: p, line: 1, rule: 'repo', message: 'A key or certificate file is committed.' });
  for (const p of all.filter((x) => /(^|\/)package\.json$/.test(x) && !SKIP.test(x))) {
    let pkg; try { pkg = JSON.parse(read(p)); } catch { continue; }
    for (const [name, v] of Object.entries({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
      if (/^(\*|latest|x|)$/.test(v) || /^(git|http|github:|file:|link:)/.test(v) || /\//.test(v) && !/^[\^~]?\d/.test(v)) out.push({ file: p, line: 1, rule: 'repo', message: `Dependency ${name}@"${v}" is not a plain version. Pin it to a released version.` });
    }
    for (const s of ['preinstall', 'install', 'postinstall', 'prepare']) if (pkg.scripts?.[s]) out.push({ file: p, line: 1, rule: 'repo', message: `The "${s}" script runs code on every install: ${pkg.scripts[s].slice(0, 60)}` });
  }
  const rootPkg = all.includes('package.json') ? JSON.parse(read('package.json')) : null;
  if (rootPkg && Object.keys(rootPkg.dependencies ?? {}).length && !all.some((p) => /package-lock\.json$|pnpm-lock\.yaml$|yarn\.lock$/.test(p) && !p.includes('/')))
    out.push({ file: 'package.json', line: 1, rule: 'repo', message: 'Dependencies are used but no lockfile is committed at the top, so installs are not reproducible.' });
  return out;
}

export function run({ json = false } = {}) {
  const all = files();
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
  const found = [];
  let scanned = 0;
  for (const p of all) {
    if (SKIP.test(p) || !/\.(mjs|js)$/.test(p) || /\.min\.js$/.test(p)) continue;
    let src; try { src = read(p); } catch { continue; }
    scanned++;
    for (const f of scanFile(p, src)) found.push({ file: p, ...f });
  }
  found.push(...repoFindings(all, read));
  if (json) { console.log(JSON.stringify(found, null, 1)); return found; }
  if (!found.length) { console.log(`Security check passes. ${scanned} source files read; nothing found.`); return found; }
  const byRule = Map.groupBy(found, (f) => f.rule);
  console.log(`Security check found ${found.length} thing(s) in ${new Set(found.map((f) => f.file)).size} file(s):\n`);
  for (const [rule, list] of byRule) {
    console.log(`── ${rule} (${list.length})`);
    for (const f of list.slice(0, 40)) console.log(`   ${f.file}:${f.line}  ${f.message}`);
    if (list.length > 40) console.log(`   … and ${list.length - 40} more`);
  }
  console.log('\nFix them, or accept one on purpose with  // security-ok: <reason>  on that line or the one above.');
  return found;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const found = run({ json: process.argv.includes('--json') });
  process.exit(found.length ? 1 : 0);
}
