# Eliminating the eighteen

Each named problem, and what Honbu does about it. Where something is not solved
yet, it says so.

**Two constraints decide most of these before design does:**

1. **Deployment is a phone, GitHub's web editor, and Vercel.** No terminal, no
   local dev, no build step to debug. Anything that needs a toolchain is out.
2. **One runtime dependency: `pg`.** Fifteen directories in `node_modules`,
   almost all of them Postgres protocol internals.

Those two rule out entire categories below rather than mitigating them.

---

## 1. Architectural and routing gaps

### 1.1 The do-it-yourself routing burden — **solved**

Routing is not code. It is the register.

- **Pages come from records.** Seventeen dojo pages exist because seventeen dojo
  rows exist. There is no route file to keep in step.
- **Sitemap is generated** from what was actually written, and a test asserts
  the count matches the files on disk. It cannot drift.
- **Redirects are a table**, and a rename writes its own. `db/004-routing.sql`
  has a trigger: change a dojo's slug and `/whanganui → /whanganui-city` appears
  automatically. It also rewrites existing redirects pointing at the old slug,
  so chains never form. Tested.
- **Broken-link detection** has a table (`internal_link`) that the build
  populates, with an index on unresolved rows. The build can fail on a broken
  internal link rather than shipping one.

### 1.2 SEO fragmentation — **solved by having one owner**

The fragmentation happens because meta tags live in the frontend, slugs in the
CMS, and headers at the edge. Here they are all one function.

`packages/site/render.mjs` owns title, description, canonical, Open Graph and
JSON-LD together, from the same record. Twenty-eight checks in `verify.mjs`
assert it — including that two different dojo get two different descriptions,
and that opening hours in the structured data match the rows rendered on the
page.

There is no edge configuration to forget, because there is no edge layer.

### 1.3 Auth, CSRF and JWT overheads — **mostly eliminated by not having the problem**

No JWT. No client application. No cross-origin anything. There is nothing to
pass between an SPA, an edge function and an API.

What remains is one session cookie: `HttpOnly`, `SameSite=Lax`, `Secure` behind
a proxy, holding an opaque token whose SHA-256 hash is what the database stores.

**CSRF was a real gap and is now closed.** `SameSite=Lax` does not stop a
top-level form POST from another site, and every state change here writes to a
federation's register. Double-submit cookie, compared in constant time, checked
inside `ctx.form()` — so reading a body and validating the token are the same
call and there is nothing to forget. Three tests cover no token, wrong token,
and the happy path.

---

## 2. Schema evolution and the paradox of fields

### 2.1 The developer bottleneck — **partly solved, and partly a deliberate refusal**

Honest answer: adding a new block type needs code.

That is a choice. The alternative — letting anyone compose arbitrary layouts —
is how you end up building Webflow, and how volunteer-run organisations end up
with ugly, broken pages. Federations get a **theme with fixed sections**, not a
canvas.

What removes most of the bottleneck instead: **most pages are not authored at
all.** Dojo pages, event listings, results and honours boards are projections of
the register. Nobody requests a field for them because nobody fills them in.

The authored layer is about fifteen pages per federation, and three of its
blocks (`dojoList`, `eventList`, `honours`) pull live data — so an About page can
carry the real dojo list without a developer or a duplicate.

### 2.2 Schema drift — **eliminated**

There is no ORM. `db/schema.sql` is the only definition of anything, and queries
are hand-written SQL against it. Nothing to synchronise, so nothing to drift.

This is also why the schema runs on plain Postgres 16 with no migration tool:
`psql -f schema.sql`, then numbered files for changes.

### 2.3 Over- and under-modelling — **solved by splitting the two cases**

Both traps come from forcing one approach on everything.

- **Structured data is typed and rigid**: organisation, person, grading, event.
  These have real invariants — a grading has a date, a grade and an awarding
  body — and rigidity is correct.
- **Authored content is one flexible document**: a validated block array, no
  nesting deeper than a list item.

Editors never meet a deeply nested form, because the deep structure is in the
register and the register has purpose-built screens.

---

## 3. Editorial friction and preview

### 3.1 Flying blind — **not solved yet. Planned.**

The plan is specific: **the preview uses the same render function as the live
site.** `renderBlocks()` is a pure function of document and data, so a draft
renders through exactly the code that renders production. There is no second
pipeline to diverge.

Not built. Named as the next piece.

### 3.2 Preview infrastructure complexity — **eliminated architecturally**

The complexity comes from a decoupled frontend needing authenticated
draft-fetching across a network boundary. There is no boundary. Rendering
happens in the same process as the query, behind the same session cookie.

### 3.3 Workflow bottlenecks — **mostly solved**

| | |
|---|---|
| Versioning | Done. Every save writes a revision, trimmed to twenty, restorable. Tested. |
| Granular RBAC | Done. Six roles granted at any node, inherited downward, enforced in one SQL function used by both the data layer and the routes. |
| Review track | Partial. `article.status` has a `review` state and pages can be submitted for someone else to publish; no reviewer assignment or comments yet. |
| Scheduled publishing | Partial. `published_at` exists; needs a nightly job to flip status. |

Writing and publishing are already separate permissions — a contributor can save
but not publish, tested.

---

## 4. Caching, build-time and state

### 4.1 Webhook dropouts and stale data — **eliminated**

There are no webhooks, because there is no second system to notify. Content is
queried at request time or regenerated in the same process that wrote it. A
dropped packet cannot leave production stale, because nothing is being told
about anything.

### 4.2 Cache-invalidation storms — **eliminated by scope**

A bulk edit here touches at most a few hundred pages, not a few hundred
thousand, and there is no CDN purge API in the loop. Pages regenerate from a
query.

If it ever matters, the register already knows exactly which pages a record
appears on — that is what `internal_link` is for — so invalidation would be
targeted rather than a wave.

### 4.3 External ID coupling — **avoided**

No external system is a source of truth. Stripe references are stored as
nullable `provider_ref` columns, never as keys or joins. If Stripe changes,
nothing structural breaks.

The tournament system integrates through two endpoints, with the register as the
authority on both sides.

---

## 5. Dependency and supply-chain fragility

### 5.1 node_modules surface — **eliminated as far as it can be**

One direct dependency. No framework, no bundler, no CSS pipeline, no admin UI
library, no test runner. Tests are plain `.mjs` files that count their own
assertions.

This is not asceticism. It is the only responsible answer when deployment is a
phone and the maintainer is one person with a full-time job.

### 5.2 Ecosystem churn — **eliminated**

Nothing in this stack can be deprecated. Node's standard library, HTML, CSS and
SQL are the whole surface. There is no plugin to become unmaintained in eighteen
months, because there are no plugins.

The one wager is Postgres, which is a safe one.

---

## 6. Localisation and relational complexity

### 6.1 Multi-locale — **not solved. Designed for, not built.**

Honest gap. Nothing in the schema is localised yet.

The good news is that the tree makes it natural rather than bolted on: a country
organisation is already the unit that owns its own content, so locale belongs on
the organisation, and translations are sibling rows rather than a parallel
payload. That avoids the bloat that comes from carrying ten locales in one
document.

MOKNZ needs English and te reo Māori. Japan's branch needs Japanese. That is the
first real test and it is not urgent yet — but the design decision should be
made before the second country signs up, not after.

### 6.2 Deeply nested graph queries — **eliminated**

No GraphQL. No ORM, so no lazy-loading cascade. One explicit SQL query per page,
written to return exactly what that page renders.

The dojo page query returns the dojo, its profile and its sessions aggregated
into one JSON column — a single round trip, no N+1, no over-fetching. Nothing
can ask for a graph three levels deep because there is no resolver to ask.

---

## Score

| | |
|---|---|
| Eliminated by architecture | 10 |
| Solved and tested | 4 |
| Partly solved | 2 — review workflow, scheduled publishing |
| Not built, designed for | 2 — visual preview, localisation |

## What to hold to

- **No framework enters this repository.** The moment one does, most of section
  5 comes back.
- **No new block type without a federation asking for it twice.** Once is a
  preference; twice is a pattern.
- **Routing stays in the register.** The instant a hand-maintained route list
  appears, 1.1 returns.
- **Preview must use the live renderer.** Two render paths is how 3.1 becomes
  permanent.
