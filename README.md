# Honbu

Federation software for martial arts organisations — affiliation, rank, events
and the website, in one system.

Built because nothing else does it. Martial arts software tracks rank and serves
one school. Governing-body software handles federations and serves Olympic sports
with paid staff. Club software does websites and has no concept of a belt.

**Customer zero: Mas Oyama Karate New Zealand.** Sixteen dojo, a branch in Japan,
sixty years of grading records.

---

## What it is

Four things, and deliberately no more:

1. **Affiliation** — organisations in a tree of any depth, members affiliated
   through their dojo, one permanent number for life.
2. **The rank register** — dated grading history that belongs to the person,
   syllabus by grade, eligibility rules, and authority by level.
3. **Identity** — a wallet pass carrying name, photo, number, grade, dojo and
   expiry. Dies when affiliation lapses.
4. **Events and site** — scoped events that publish up and down the tree, and a
   website generated from all of the above.

## What it is not

Not a CMS. Not a payments engine. Not tournament draw software — that is a
separate system this one feeds.

The site is a **projection of the data** plus about fifteen authored pages per
federation. Dojo pages, instructor profiles, event listings, results and honours
boards are generated. Nobody edits them, so nobody can leave them half-filled.

---

## Repository

```
packages/core/domain/      entities and value objects — imports nothing
packages/core/application/ use cases and the ports they define
packages/infrastructure/   postgres and in-memory adapters
tools/check-dependencies   enforces the dependency rule; run it in CI

db/schema.sql              the whole data model
db/seed-moknz.sql          customer zero: 18 orgs, 15 grades, real people
db/tests.sql               the seven behaviours the product rests on
packages/api/              data access — permissions enforced in SQL, not callers
packages/site/             static site generated from the register
packages/content/          block documents — validated in, safe HTML out
packages/wallet/           member cards as Apple and Google Wallet passes
import/                    CSV templates + importer for dojo detail
packages/brand/            crest → accessible design tokens (working)
docs/                      decisions worth writing down
```

## Running it

```bash
createdb honbu
psql -d honbu -f db/schema.sql
psql -d honbu -f db/seed-moknz.sql
psql -d honbu -f db/tests.sql

cd packages/api && npm install && node test.mjs
cd ../site && node build.mjs && node verify.mjs
cd ../content && node test.mjs
cd ../api && node test-pages.mjs
cd ../wallet && node test.mjs
cd ../api && node test-auth.mjs
```

## The authored layer

About fifteen pages per federation that are not projections of the register.

Stored as **structured JSON, never HTML**, so it can render to a web page, a PDF
certificate or a wallet pass from one source — and so nothing pasted in from
Word can inject markup. Anything outside the block whitelist is dropped on save,
with the author told what went.

Three blocks pull live data into an authored page — `dojoList`, `eventList` and
`honours`. That is the point of one system rather than two: an About page can
carry the real dojo list without anyone maintaining a copy of it.

Writing and publishing are separate permissions. Every save keeps a revision,
capped at twenty.

## Why the site is generated

Seventeen dojo pages, each with its own title, description, canonical URL and
`SportsActivityLocation` markup carrying the address, coordinates and opening
hours derived from the training sessions. None of it is authored, so none of it
can be left half-filled — a dojo with no details recorded renders honestly
("Venue to confirm") rather than showing an empty template.

This is the whole SEO argument against a hosted club platform, and it is
verifiable: `node verify.mjs`.

---

## The five decisions everything rests on

**1. Organisations are a tree, not four fixed levels.**
Some federations have three tiers, some five. One self-referencing table with an
`ltree` path. MOKNZ starts with two levels and adds a regional tier later with no
migration.

**2. You can see down your own branch, never sideways.**
Enforced in one SQL function, `has_role_at`. A Whanganui operator sees Whanganui.
The country body sees every dojo. Auckland cannot see Whanganui.

**3. Grading history belongs to the person.**
Not to the dojo. When someone moves — between dojo, countries, or organisations
— the record goes with them. Every federation has lost records when a dojo closed
or an instructor fell out with the body. This is the bit that sells.

**4. Money moves by invoice between levels.**
Not by splitting a card payment four ways across jurisdictions. Members pay their
dojo; each level invoices the level below from the register. That is how these
organisations already work, and it makes the register the thing everyone trusts.

**5a. Titles are not grades.**
Shogo — Renshi, Kyoshi, Hanshi — are awarded separately from dan grade. MOKNZ's
own leadership could not be represented until `title_award` existed. Kendo,
iaido and most Japanese arts work the same way.

**5b. Qualifications expire; rank does not.**
A referee licence, a first aid certificate, a police vet. `qualification_status`
answers the question every governing body is supposed to be able to answer and
most answer from memory: *who may not instruct right now.*

**5. Grading authority is configurable.**
Kyu by the dojo, dan by the country, senior dan by the international body — every
federation's rules differ and every one is currently enforced by someone
remembering. `grade_authority` makes it data.

---

## Brand engine — working now

`packages/brand` turns a crest into a checked token set. Run it:

```bash
cd packages/brand && node test.mjs
```

Against the MOKNZ crest it extracts `#CE372C` (16.5%), `#F0CE41` (10.4%) and
`#BDBDBF` (54.9%), then derives a full palette and checks every combination.

**Contrast is computed, never generated.** A language model will hand you gold
text on white and tell you it looks smart. This module measures it:

```
accent (#F0CE41) reads at only 1.42:1 on the page background
but 11.72:1 on dark. Use it in dark sections only.
```

It also derives `#9A2A1F` at 7.07:1 as the readable version of the brand red for
links and small text, because `#CE372C` only just scrapes 4.58:1.

Type pairings are a **curated list**, not generated. A model choosing freely
produces Lobster and Papyrus.

---

## Build order

| | | Status |
|---|---|---|
| 1 | Schema | **runs clean on Postgres 16 — 24 tables** |
| 2 | Brand engine | **working, tested on the MOKNZ crest** |
| 3 | Organisations, people, affiliation, permissions | **modelled and proven in SQL** |
| 4 | Grade ladder, authority rules, grading records | **modelled and proven in SQL** |
| 5 | Data access layer with permissions enforced in SQL | **34 tests passing** |
| 6 | Generated site: dojo pages, events, schema.org markup | **28 checks passing** |
| 7 | CSV import with a publish gate | **working** |
| 8 | Authored pages: block model, revisions, split publish | **37 tests passing** |
| 9 | Wallet passes — Apple and Google, offline verification | **34 tests passing** |
| 10 | Auth — sign-in links, sessions, rate limiting | **32 tests passing** |
| 11 | Admin screens and editor UI | next |
| 5 | Generated site: dojo pages, events, schema.org markup | |
| 6 | Authored pages, block editor | |
| 7 | Wallet passes | |
| 8 | Invoicing between levels | |
| 9 | Onboarding: upload crest → see your site | |
| 10 | Tournament integration | separate system |

**Steps 3 and 4 are the product.** Everything before is scaffolding and
everything after is surface. If the project stalls, stall it after step 4 with a
working register, not after step 6 with a half-built editor.

---

## Architecture

Clean Architecture, applied where business rules live and nowhere else. The
dependency rule is enforced by `tools/check-dependencies.mjs`, which fails the
build if any layer imports outward — the domain may not even import `node:`.

The proof it is real, not decorative: the same use case objects run against
in-memory adapters with no I/O at all, and against Postgres, with identical
results and no change to core code. See `docs/architecture.md`.

## Changing how the site looks

`data/settings.json` — colours, fonts, which sections appear on the home and
dojo pages, and the menu. Edit it in GitHub, commit, Vercel rebuilds.

Every choice is checked when the site builds. A palette that would make text
unreadable **fails the build** with the numbers:

```
body text: #BBBBBB on #F5F5F5 is 1.76:1, needs 4.5:1
— unreadable on a phone in daylight
```

Settings, not a canvas: someone can change anything about how it looks and
nothing about how it is laid out. That is the line that keeps volunteer-run
sites from breaking.

## Storage

**No `DATABASE_URL` → runs from JSON files in `data/`.** Deploys with nothing to
provision. **`DATABASE_URL` set → Postgres.** One variable; the core never knew
the difference.

Files serve reads and refuse writes with a 503 that says why. Add the database
when the admin app needs to record a grading. See `docs/storage.md`.

## Constraints this is built around

- **Deployment is a phone, GitHub's web editor, and Vercel.** No terminal, no
  local dev, no build step to debug. Anything needing a toolchain is out.
- **One runtime dependency: `pg`.** No framework, no bundler, no CSS pipeline,
  no test runner. Tests are plain `.mjs` files.
- **Server-rendered HTML, works with JavaScript off.** These screens get used on
  phones in halls with bad reception.

`docs/eliminating-cms-problems.md` works through the eighteen known failure
modes of JS/TS content platforms against this design — ten eliminated by
architecture, four solved and tested, two partial, two named as gaps.

## Stack

Postgres (Supabase) · Next.js · TipTap for the authored layer · Stripe per
organisation · wallet passes via PassKit and the Google Wallet API · Cloudflare
R2 for media.

Chosen for one part-time maintainer, not a team.

---

## Rules for this build

- **Two tiers in the interface, any number in the schema.** Ship this year.
- **No feature enters without a federation asking for it.** MOKNZ is customer
  zero, not a focus group of one.
- **AI drafts content, never states facts.** Lineage, dates and grades come from
  the customer. Organisations have split over less.
- **The repository belongs to MOKNZ, not to a personal account**, and there is a
  written plan for what happens if the maintainer stops.
