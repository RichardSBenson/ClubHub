/**
 * Security rules. Each takes a file { path, src, lines, lex } and returns findings { rule, line, message }.
 *
 * Suppressing a finding is allowed, but it has to be a decision: put `// security-ok: <why>` on the line or the line above.
 * A suppression with no reason is itself a finding.
 */
import { lex } from './lex.mjs';

const isTest = (p) => /(^|\/)test[-.\w]*\.mjs$|\/test\//.test(p) || /^tools\/(test-|security\/)/.test(p) || /^packages\/api\/(reset|dev)\.mjs$/.test(p);
const isApp = (p) => /^packages\//.test(p) && !isTest(p);
const isViews = (p) => /^packages\/(api\/views|site\/render|api\/render)\.mjs$/.test(p) || /(^|\/)views\.mjs$|(^|\/)render\.mjs$/.test(p);
const isComment = (l) => /^\s*(\/\/|\*|\/\*)/.test(l);

const SQL_SHAPE = /\b(select\b[\s\S]*?\bfrom\b|insert\s+into\b|update\s+[\w."]+\s+set\b|delete\s+from\b|\bwhere\b[\s\S]*?(=|\bin\b|\blike\b)\s*\$\d)/i;
// Expressions that are safe to put inside SQL text: our own constants and fixed fragments, never request data.
const SQL_SAFE_EXPR = [
  /^[A-Z][A-Z0-9_]*$/,                                  // CONSTANT fragments: PAYMENT_SELECT, FORM_COLS
  /^[a-z]\w*Cols?$|^[a-z]\w*Select$|^[a-z]\w*Sql$/,    // fragments named as such
  /^\$\{?\d+\}?$/,
  /^UTC_ISO\(\s*'[\w.]+'\s*\)$/,                       // our own date-formatting helper on a fixed column
  /^[\w.$ ?]+\?\s*(`[^`$]*`|'[^']*')\s*:\s*(`[^`$]*`|'[^']*')$/, // cond ? 'fixed sql' : 'fixed sql'
];
const TAINT = /\b(ctx\.(url|req|params|form|me)|searchParams|req\.(url|headers|query|body)|fields\.|params\.|form\.|input\.|raw\.)/;
// Words that name text a person typed. If one of these ends a bare interpolation in HTML, it needs esc().
const USER_TEXT = /(?:\.|^)(name|title|label|note|notes|description|message|text|email|address|summary|caption|detail|bio|about|blurb|venue_name|reason|subject|first_name|last_name|preferred_name|display_name|signed_name|person_name|dojo|club|org_name|club_name|headline|alt|alt_text|filename|city|suburb|directions|phone|url|href)$/;
const HTML_SAFE_CALL = /^\s*(esc|escAttr|escapeHtml|encodeURIComponent|JSON\.stringify|String\(\s*Number|Number|Math\.\w+|cents|money|when|whenAt|dateWords|fmt\w*)\s*\(/;

export const RULES = {
  /** SQL text built with a ${...} that is not one of our own constants. */
  'sql-injection'(f) {
    if (!isApp(f.path) && !/^tools\//.test(f.path)) return [];
    const out = [];
    for (const t of f.lex.templates) {
      const text = t.parts.filter((p) => p.kind === 'text').map((p) => p.value).join(' ');
      if (!SQL_SHAPE.test(text)) continue;
      if (/<\/?[a-z][a-z0-9]*[\s>/]/i.test(text)) continue;   // HTML that happens to contain the words "select ... from"
      t.parts.forEach((p, i) => {
        if (p.kind !== 'expr') return;
        const e = p.value.trim();
        if (SQL_SAFE_EXPR.some((r) => r.test(e))) return;
        if (/\$$/.test(t.parts[i - 1]?.value ?? '')) return;    // $${n}: a placeholder number we computed
        out.push({ rule: 'sql-injection', line: p.line, message: `\${${e.slice(0, 60)}} is put straight into SQL text. Use a $1 placeholder, or an uppercase constant for a fixed fragment.` });
      });
    }
    return out;
  },

  /** Request data written into HTML without escaping. */
  'xss-unescaped'(f) {
    if (!isViews(f.path) && !isApp(f.path)) return [];
    const out = [];
    for (const t of f.lex.templates) {
      const text = t.parts.filter((p) => p.kind === 'text').map((p) => p.value).join(' ');
      if (!/<\/?[a-z][\w-]*[\s>/]/i.test(text)) continue;                  // not HTML
      for (const p of t.parts.filter((x) => x.kind === 'expr')) {
        const e = p.value.trim();
        const bare = /^[\w$]+(\??\.[\w$]+)*(\s*(\?\?|\|\|)\s*(''|""|'[^']*'))?$/.test(e);
        const path = e.replace(/\s*(\?\?|\|\|).*$/, '').replace(/\?\./g, '.');
        if ((TAINT.test(e) && !HTML_SAFE_CALL.test(e) && !/\besc\(/.test(e) && !/encodeURIComponent/.test(e))
          || (bare && USER_TEXT.test(path)))
          out.push({ rule: 'xss-unescaped', line: p.line, message: `\${${e.slice(0, 60)}} puts text into HTML without esc().` });
      }
    }
    return out;
  },

  /** Browser scripts that write markup. */
  'dom-xss'(f) {
    if (!/\.(js|mjs)$/.test(f.path) || /vendor\/easymde/.test(f.path)) return [];
    if (!/^vendor\/honbu\//.test(f.path) && !isViews(f.path)) return [];
    const out = [];
    f.lines.forEach((l, i) => { if (!isComment(l) && /\.(innerHTML|outerHTML)\s*=(?!\s*(''|""|``)\s*;)|insertAdjacentHTML\s*\(|document\.write(ln)?\s*\(|\beval\s*\(|new Function\s*\(/.test(l))
      out.push({ rule: 'dom-xss', line: i + 1, message: 'Writes markup or runs text as code in the browser. Use textContent or DOM methods.' }); });
    return out;
  },

  /** Code that runs text as code, or shells out with built strings. */
  'dangerous-api'(f) {
    if (!isApp(f.path)) return [];
    const out = [];
    f.lines.forEach((l, i) => {
      if (isComment(l)) return;
      const add = (m) => out.push({ rule: 'dangerous-api', line: i + 1, message: m });
      if (/\beval\s*\(|new Function\s*\(/.test(l)) add('eval / new Function runs text as code.');
      if (/\b(exec|execSync|spawn|spawnSync)\s*\(\s*[`'"].*(\$\{|\+)/.test(l) || /child_process/.test(l)) add('A shell command is built from strings, or child_process is imported. Never put request data in one.');
      if (/rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED/.test(l)) add('TLS certificate checking is switched off.');
      if (/createHash\(\s*['"](md5|sha1)['"]\s*\)/i.test(l)) add('MD5 and SHA-1 are broken for security use. Use SHA-256 or better.');
      if (/Math\.random\(\)/.test(l) && /(token|secret|password|session|key|nonce|salt|csrf|otp|code)/i.test(l)) add('Math.random is not unpredictable. Use crypto.randomBytes / randomUUID for anything secret.');
      if (/access-control-allow-origin['"\]]*\s*[:,=]\s*['"]\*/i.test(l)) add('CORS is open to every website.');
      if (/\bvm\.(runIn|Script)|require\(\s*[^'"`)]/.test(l)) add('Loads or runs code chosen at run time.');
    });
    return out;
  },

  /** Secrets compared with === leak how much matched, through timing. */
  'secret-compare'(f) {
    if (!isApp(f.path)) return [];
    const out = [];
    f.lines.forEach((l, i) => {
      if (isComment(l)) return;
      if (/typeof\s+\w+\s*(===|!==)/.test(l)) return;
      if (/\b(secret|signature|sig|mac|hmac|password|apikey|api_key)\w*\s*(===|!==|==(?!=)|!=(?!=))(?!\s*(['"`]|null\b|undefined\b|false\b|true\b|\d))/i.test(l)
        || /(?<!['"`\w.])\b(given|provided|supplied|presented)\w*\s*(===|!==)\s*\w*(secret|token|hash|sig)/i.test(l))
        out.push({ rule: 'secret-compare', line: i + 1, message: 'A secret is compared with ===. Use crypto.timingSafeEqual on equal-length buffers.' });
    });
    return out;
  },

  /** Loose equality in code that decides who gets in. */
  'loose-equality'(f) {
    if (!isApp(f.path)) return [];
    const out = [];
    f.lines.forEach((l, i) => {
      if (isComment(l)) return;
      const stripped = l.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""').replace(/\/(?:\\.|[^/\n])+\/[a-z]*/g, '/re/');
      if (/[^=!<>]==[^=]|!=[^=]/.test(stripped) && !/[!=]=\s*null\b|\bnull\s*[!=]=/.test(stripped))
        out.push({ rule: 'loose-equality', line: i + 1, message: '== or != converts types before comparing. Use === or !==.' });
    });
    return out;
  },

  /** Secrets committed in code. */
  'hardcoded-secret'(f) {
    if (isTest(f.path) || /^docs\//.test(f.path)) return [];
    const out = [];
    const pats = [
      [/AKIA[0-9A-Z]{16}/, 'an AWS access key'],
      [/\bsk_(live|test)_[0-9a-zA-Z]{16,}/, 'a Stripe secret key'],
      [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'a GitHub token'],
      [/-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/, 'a private key'],
      [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'a Slack token'],
      [/\b(password|passwd|secret|api[_-]?key|token)\b['"]?\s*[:=]\s*['"][^'"\s]{8,}['"]/i, 'a password, key or token written into the code'],
      [/\bpostgres(ql)?:\/\/[^:\s/]+:[^@\s]{3,}@/, 'a database address with a password in it'],
    ];
    f.lines.forEach((l, i) => { if (isComment(l)) return; for (const [re, what] of pats) if (re.test(l) && !/process\.env|example|placeholder|change-?me|xxxx|<[a-z-]+>/i.test(l)) out.push({ rule: 'hardcoded-secret', line: i + 1, message: `Looks like ${what}.` }); });
    return out;
  },

  /** A redirect to an address taken from the request. */
  'open-redirect'(f) {
    if (!isApp(f.path)) return [];
    const out = [];
    f.lines.forEach((l, i) => {
      if (isComment(l)) return;
      // Only a target that BEGINS with request data can leave the site; `/o/${slug}/...` and our own helpers cannot.
      if (/\bredirect\(\s*(`\$\{\s*)?(ctx\.(url|req|form|query)|searchParams|req\.|fields\.|form\.|input\.|raw\.|params\.)/.test(l) && !/safeNext|encodeURIComponent/.test(l))
        out.push({ rule: 'open-redirect', line: i + 1, message: 'Redirects to something taken from the request. Pass it through safeNext() so it can only be a path on this site.' });
    });
    return out;
  },

  /** Files opened using a path from the request. */
  'path-traversal'(f) {
    if (!isApp(f.path)) return [];
    const out = [];
    f.lines.forEach((l, i) => {
      if (isComment(l)) return;
      if (/\b(fs\w*\.(readFile|readFileSync|createReadStream|writeFile|writeFileSync|unlink|rm|readdir|stat)\w*|readFile|createReadStream|sendFile)\s*\(/.test(l) && TAINT.test(l))
        out.push({ rule: 'path-traversal', line: i + 1, message: 'Opens a file using a path built from the request. Never do this; look the file up by id instead.' });
    });
    return out;
  },

  /** Every POST must read its form through the CSRF-checked readers. Every route must say who may use it. */
  'route-guards'(f) {
    if (f.path !== 'packages/api/server.mjs') return [];
    const out = [];
    const re = /^(get|post)\(\s*(['`])([^'`]+)\2\s*,\s*(?:async\s*)?\(?\s*ctx\s*\)?\s*=>\s*/gm;
    let m;
    // Helpers that read the form themselves; a route that hands off to one of them is covered.
    const readers = [...f.src.matchAll(/^(?:async )?function (\w+)\(ctx\b[\s\S]*?\n\}\n/gm)].filter((h) => /ctx\.(form|upload|publicForm)\(/.test(h[0])).map((h) => h[1]);
    const viaReader = (b) => readers.some((n) => new RegExp(`\\b${n}\\(`).test(b));
    while ((m = re.exec(f.src))) {
      const at = m.index + m[0].length;
      let body;
      if (f.src[at] === '{') { let d = 0, j = at; for (; j < f.src.length; j++) { if (f.src[j] === '{') d++; else if (f.src[j] === '}' && !--d) break; } body = f.src.slice(at, j + 1); }
      else { const j = f.src.indexOf('\n});', at); const k = f.src.indexOf(');\n', at); body = f.src.slice(at, Math.min(...[j, k].filter((x) => x > 0))); }
      const line = f.lex.lineAt(m.index);
      if (m[1] === 'post' && !/ctx\.(form|upload|publicForm)\(|\bcheckEntryForm\(|readFormOnce\(/.test(body) && !viaReader(body))
        out.push({ rule: 'route-guards', line, message: `POST ${m[3]} never reads its form through ctx.form()/upload()/publicForm(), which is where the CSRF check lives.` });
      if (!/requireActor|organisationFor|apiCall|assertMayActFor|Screen\(ctx|fillScreen|bookScreen|autoScreen|CRON_SECRET|publicForm|\.gate\(|ctx\.me\b|sameSite|orgs\.bySlug|signer|verify|token|slug|ctx\.params/.test(body))
        out.push({ rule: 'route-guards', line, message: `${m[1].toUpperCase()} ${m[3]} shows no sign of an access check. If it is public on purpose, say why with // security-ok.` });
    }
    return out;
  },

  /** Cookies and headers. */
  'transport'(f) {
    const out = [];
    if (f.path === 'packages/api/server.mjs') {
      const csp = /'content-security-policy':\s*([\s\S]*?),\n\s*\};/.exec(f.src)?.[1] ?? '';
      const need = [[/default-src 'self'/, "default-src 'self'"], [/frame-ancestors 'none'/, "frame-ancestors 'none'"], [/base-uri 'none'/, "base-uri 'none'"], [/form-action 'self'/, "form-action 'self'"]];
      for (const [re, w] of need) if (!re.test(csp)) out.push({ rule: 'transport', line: 1, message: `The content security policy must include ${w}.` });
      if (/unsafe-eval|script-src[^;]*unsafe-inline|default-src[^;]*\*/.test(csp)) out.push({ rule: 'transport', line: 1, message: 'The content security policy allows inline or eval scripts, or any source.' });
      if (!/'x-content-type-options':\s*'nosniff'/.test(f.src)) out.push({ rule: 'transport', line: 1, message: 'nosniff header is missing.' });
      if (!/'x-frame-options':\s*'DENY'/.test(f.src)) out.push({ rule: 'transport', line: 1, message: 'x-frame-options DENY is missing.' });
    }
    if (/^packages\/api\/(server|auth)\.mjs$/.test(f.path)) {
      f.lines.forEach((l, i) => { if (/Set-Cookie|serializeCookie|cookie\(/i.test(l) && /=.*[`'"]/.test(l) && !/HttpOnly/i.test(l) && /session/i.test(l)) out.push({ rule: 'transport', line: i + 1, message: 'A session cookie is set without HttpOnly on the same line. Check its flags.' }); });
    }
    return out;
  },

  /** A role name typed wrongly lets nobody in, or somebody the wrong people. */
  'role-typo'(f) {
    if (!isApp(f.path)) return [];
    const ROLES = ['owner', 'administrator', 'registrar', 'instructor', 'member', 'assistant', 'official', 'supporter'];
    const OK = new Set([...ROLES, 'instructors', 'members', 'registrars', 'owners', 'administrators', 'officials', 'assistants', 'supporters', 'own', 'officer', 'memberships', 'membership', 'ownership', 'register', 'instruct', 'number', 'registered', 'members']);
    const dist = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j;
      for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
    const out = [];
    f.lines.forEach((l, i) => {
      if (isComment(l) || !/role|MANAGE|REGISTER|TEACH|grant|assertRole|has_role_at/i.test(l)) return;
      for (const [, w] of l.matchAll(/['"`]([a-z]{5,14})['"`]/g)) {
        if (OK.has(w)) continue;
        const near = ROLES.find((r) => dist(w, r) <= 2 && Math.abs(w.length - r.length) <= 2);
        if (near) out.push({ rule: 'role-typo', line: i + 1, message: `"${w}" looks like a misspelling of the role "${near}". A role that matches nothing quietly refuses everyone.` });
      }
    });
    return out;
  },
};

/** Suppression comments: `// security-ok: reason` here or on the line above. A bare one is a finding. */
export function applySuppressions(file, findings) {
  const out = [];
  const marks = new Map();
  file.lines.forEach((l, i) => { const m = /security-ok(?::\s*(.*))?$/.exec(l); if (m) marks.set(i + 1, (m[1] ?? '').trim()); });
  for (const [line, why] of marks) if (why.length < 8) out.push({ rule: 'suppression', line, message: 'security-ok needs a reason of a few words, so the next reader can judge it.' });
  for (const f of findings) {
    const why = marks.get(f.line) ?? marks.get(f.line - 1);
    if (why && why.length >= 8) continue;
    out.push(f);
  }
  return out;
}

export function scanFile(path, src) {
  const file = { path, src, lines: src.split('\n'), lex: lex(src) };
  const found = Object.values(RULES).flatMap((r) => r(file));
  return applySuppressions(file, found).sort((a, b) => a.line - b.line);
}
