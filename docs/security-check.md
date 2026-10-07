# The security check

`npm run check` reads every source file in the repository and fails if it finds the kind of mistake that lets
an unwanted visitor in. It runs with no database and no network, takes about a second, and is also run as a
test (`tools/test-security.mjs`) so the full suite keeps it honest.

    node tools/check-security.mjs          # human-readable, exit 1 on any finding
    node tools/check-security.mjs --json   # for other tools

## What it looks for

| Rule | The mistake |
|---|---|
| `sql-injection` | A `${...}` pasted into SQL text. Values must be `$1` placeholders; fixed fragments must be UPPERCASE constants (or named `...Cols`/`...Select`/`...Sql`). |
| `xss-unescaped` | Request data, or a field a person typed (name, title, note...), written into HTML without `esc()`. |
| `dom-xss` | `innerHTML`, `insertAdjacentHTML`, `document.write`, `eval` in browser scripts. |
| `dangerous-api` | `eval`, `new Function`, shell commands built from strings, TLS checks switched off, MD5/SHA-1, `Math.random` for secrets, CORS open to all, run-time `require`. |
| `secret-compare` | A secret, signature or password compared with `===` (timing leak). Use `crypto.timingSafeEqual`. |
| `loose-equality` | `==` / `!=` in code that decides who gets in. |
| `hardcoded-secret` | Cloud keys, tokens, private keys, passwords or database URLs written into code. |
| `open-redirect` | A redirect whose target begins with request data. Pass it through `safeNext()`. |
| `path-traversal` | Files opened with a path from the request. |
| `route-guards` | A POST that never reads its form through `ctx.form()` / `ctx.upload()` / `ctx.publicForm()` (that is where the CSRF check lives; helper functions that do so count), or a route with no sign of an access check. |
| `transport` | Content-security-policy missing `default-src 'self'`, `frame-ancestors 'none'`, `base-uri 'none'`, `form-action 'self'`, or allowing inline/eval scripts; missing `nosniff` / `X-Frame-Options`; session cookies without `HttpOnly`. |
| `role-typo` | A role name one or two letters off a real role. A role that matches nothing quietly refuses everybody. |
| `repo` | A committed `.env`, key or certificate file; unpinned or git dependencies; install scripts; dependencies without a lockfile. |

The scanner tokenises each file, so it reads template strings and skips comments instead of matching text blindly.
Test files and the scanner itself are not held to the app rules.

## When it is wrong

A finding is either a real hole (fix it) or a deliberate exception (say so). Exceptions are written where they
happen, with a reason of a few words, on the same line or the line above:

    // security-ok: public by design, the sign-in page is how anyone gets in
    get('/signin', ...)

Inside an HTML template, where a line comment would be output, put it inside the expression:

    <td>${/* security-ok: label comes from the fixed ACTION_TAGS table */ label}</td>

A `security-ok` with no reason is itself a finding, and one more than a line away from the code does nothing.
Prefer fixing the code to excusing it.

## Adding a rule

Add it to `RULES` in `tools/security/rules.mjs`, then add one example it must catch and one it must allow to
`tools/test-security.mjs`; that test fails for any rule with no example.

## What it does not do

It is a net for common slips, not a proof. It does not replace review, does not follow data across functions, and
cannot see dependencies' own code. The database layer (row security, `has_role_at`) and the route isolation test
(`packages/api/test-isolation.mjs`) cover what a source scan cannot.
