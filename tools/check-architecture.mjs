/**
 * Keeps the code DRY and the layers honest, beyond what check-dependencies.mjs (imports only) can see.
 *
 * These are the mistakes that crept in once and must not again:
 *   1. A helper defined a second time (esc, money, addMonths) instead of imported.
 *   2. The same role list typed out again instead of imported from access.mjs.
 *   3. The default timezone typed out instead of DEFAULT_TIMEZONE.
 *   4. A route (server.mjs) or a screen (views.mjs) talking to the database itself.
 *   5. The domain reading the clock, so its answers change with the time of day.
 *   6. The same block of code pasted into two files.
 *   7. A file growing without limit (see CAPS: a cap may be lowered, never raised).
 *
 * To satisfy a rule, change the code. A line that is genuinely an exception ends with `// arch-ok: <reason>`.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname;
const bad = [];
const fail = (file, line, msg) => bad.push(`  ${path.relative(ROOT, file)}${line ? `:${line}` : ''}  ${msg}`);

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['node_modules', 'vendor', '.git', '.claude'].includes(e.name)) walk(p, out); }
    else if (p.endsWith('.mjs') && !/(^|\/)test[^/]*\.mjs$/.test(p)) out.push(p);
  }
  return out;
};
const files = walk(path.join(ROOT, 'packages'));
const read = (f) => fs.readFileSync(f, 'utf8').split('\n');
const is = (f, tail) => f.endsWith(tail);

// 1–3, 5: single definitions
const SINGLE = [
  { re: /^\s*(export\s+)?(const|function)\s+esc(ape\w*)?\b/, owner: 'core/domain/html.mjs', what: 'esc', skip: 'calendar-file.mjs' },
  { re: /^\s*(export\s+)?(const|function)\s+(money|tidyMoney)\b|Intl\.NumberFormat\([^)]*currency/, owner: 'core/domain/money.mjs', what: 'a money formatter (import money / dollars / tidyMoney)' },
  { re: /^\s*(export\s+)?(const|function)\s+addMonths\b/, owner: 'core/domain/membership.mjs', what: 'addMonths' },
  { re: /\[\s*'owner',\s*'administrator'/, owner: 'core/domain/access.mjs', what: 'a role list (import MANAGE / REGISTER / TEACH / WRITE)', skipSql: true },
  { re: /'Pacific\/Auckland'/, owner: 'core/domain/time.mjs', what: 'the default timezone (import DEFAULT_TIMEZONE)', skipComment: true },
];
for (const f of files) {
  const lines = read(f);
  lines.forEach((l, i) => {
    if (/arch-ok:/.test(l)) return;
    for (const r of SINGLE) {
      if (is(f, r.owner)) continue;
      if (r.skip && is(f, r.skip)) continue;
      if (r.skipComment && /^\s*(\/\/|\*|\/\*)/.test(l)) continue;
      if (r.skipSql && /array\[/.test(l)) continue;
      if (r.re.test(l)) fail(f, i + 1, `defines ${r.what} again; it lives in ${r.owner}`);
    }
  });
}

// 4: routes and screens do not touch the database
for (const f of files.filter((x) => is(x, 'api/server.mjs') || is(x, 'api/views.mjs')))
  read(f).forEach((l, i) => {
    if (!/arch-ok:/.test(l) && /\bpool\.(query|connect)\b|\bclient\.query\b/.test(l))
      fail(f, i + 1, 'talks to the database; add a function to data.mjs and call that');
  });

// 5: the domain does not read the clock (a default argument may; time.mjs is the one place)
const DEFAULT_ARG = /\b\w+ = new Date\(\)(\.toISOString\(\)(\.slice\(\d+, ?\d+\))?)?\s*[,)}]/;
for (const f of files.filter((x) => x.includes('core/domain/') && !is(x, 'time.mjs')))
  read(f).forEach((l, i) => {
    if (/arch-ok:/.test(l) || /^\s*(\/\/|\*)/.test(l)) return;
    if (/new Date\(\)|Date\.now\(\)/.test(l) && !DEFAULT_ARG.test(l))
      fail(f, i + 1, 'reads the clock inside the domain; take the time as an argument (or use todayIso from time.mjs)');
  });

// 6: no block of 8+ lines pasted into two files
{
  const W = 8, seen = new Map(), pairs = new Map();
  for (const f of files) {
    const L = read(f).map((l) => l.trim())
      .filter((l) => l && !/^(\/\/|\*|\/\*|import )/.test(l) && l.length > 3);
    for (let i = 0; i + W <= L.length; i++) {
      const block = L.slice(i, i + W).join('\n');
      if (block.length < 200) continue;
      const set = seen.get(block) ?? seen.set(block, new Set()).get(block);
      set.add(f);
    }
  }
  for (const set of seen.values()) if (set.size > 1) {
    const k = [...set].map((f) => path.relative(ROOT, f)).sort().join('  and  ');
    pairs.set(k, (pairs.get(k) ?? 0) + 1);
  }
  for (const [k, n] of pairs) bad.push(`  duplicated code (${n} overlapping block${n > 1 ? 's' : ''}): ${k}\n    move it to one place and import it`);
}

// 7: size caps. Lower these as the big files are split; never raise them.
const CAPS = { 'packages/api/data.mjs': 8000, 'packages/api/server.mjs': 4800, 'packages/api/views.mjs': 5300 };
const DEFAULT_CAP = 1500;
for (const f of files) {
  const rel = path.relative(ROOT, f), n = read(f).length, cap = CAPS[rel] ?? DEFAULT_CAP;
  if (n > cap) fail(f, 0, `${n} lines, over its cap of ${cap}. Split it by subject (one module per file) rather than raising the cap`);
}

if (bad.length) {
  console.error(`\nArchitecture check FAILED (${bad.length}):\n${bad.join('\n')}\n`);
  process.exit(1);
}
console.log(`Architecture holds. ${files.length} source files: one definition each of the shared helpers, no database calls in routes or screens, no clock in the domain, no pasted blocks, no file over its cap.`);
