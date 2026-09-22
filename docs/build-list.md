# Build list

Consolidated from the four project documents, the conversation, and what is
actually in the repository.

---

## The drift, named

The last several sessions went into rank, titles and shogo. That is **profile
depth**, and nobody signs in to admire a profile.

What the documents actually describe is an **operational system**: a dojo
operator taking attendance in a rented hall, a parent checking in three
children, a national body sending a grading notice to seventeen dojo, a
competitor entering a tournament without retyping their life.

The register is the foundation. It is not the product.

---

## Where the build actually stands

| | Built | Partial | Not started |
|---|---|---|---|
| **Foundation** | tree, permissions, auth, publishing, content types, events, wallet cards | | |
| **Public site** | generated pages, SEO, settings, files-first deploy | editor UI | preview |
| **Register** | gradings, authority, titles, qualifications | | certificates |
| **Daily operations** | | | **attendance, check-in, churn alarms** |
| **Communications** | | | **all of it** |
| **Family** | | | **payer accounts, batch anything** |
| **Money** | invoicing between levels | | subs, payment rails, retention |
| **Tournament** | entry fields spec | | magic-link entry, the engine |
| **Member portal** | | | **all of it** |

Four of those rows are empty, and they are the four a dojo operator touches
every week.

---

## Priority 1 — Communications

**Nothing exists.** This is the gap between "a website" and "how the federation
runs", and it is what MOKNZ would notice on day one.

1. **Notice** as a domain concept — a message with an audience, a scope and a
   record of who it reached. Not an email integration; the thing being sent.
2. **Audiences from the register.** "Every 1st kyu nationally", "Whanganui
   juniors and their parents", "everyone entered in the November tournament".
   The register already answers these — nothing else can.
3. **Send through the tree.** National sends to seventeen dojo; a dojo operator
   sends to their own students only. Scoping is the same rule as everything
   else.
4. **Delivery adapters** — email first, then push. A `Notice` does not know how
   it travelled.
5. **Read state**, because "did they see it" is the actual question.

Three or four days. It is the highest-value thing left.

## Priority 2 — Attendance and check-in

Attendance is already a table and the eligibility engine reads it, but nothing
writes to it.

1. **Session** — a class that happened, at a venue, on a date.
2. **Instructor-generated session code.** The documents are explicit: dojos rent
   community halls hourly and cannot fix hardware to walls. A tablet at the mat
   edge showing a rotating code, expiring when class ends.
3. **Offline first.** Halls have no reception. The app caches the handshake and
   syncs later — which means the check-in client is a PWA, and conflict
   resolution is a real design problem, not a detail.
4. **Family batch check-in.** One scan, a parent sees their children, eligible
   ones pre-ticked, ineligible ones greyed with the reason.
5. **Churn alarm.** A sudden attendance drop is the strongest predictor of
   someone leaving. The register can see it; nobody else can.

Geofencing and BLE beacons are in the documents. **Defer both.** QR plus offline
covers the case; the other two are a second product's worth of platform work.

## Priority 3 — Family and payer accounts

Currently a person is a person. The documents are emphatic that families are
the demographic engine, and nothing models them.

1. **Payer account** governing several student profiles.
2. **Guardian relationships**, with consent and waivers attached to the right
   person.
3. **Unified billing**, sibling discounts, one payment for three children.
4. Batch operations everywhere: check-in, entry, renewal, notices.

This blocks check-in, tournament entry and subscriptions. Build it before them,
not alongside.

## Priority 4 — The editor

The content model is built and validated; there is no screen to type into.
Editing is currently a JSON file in GitHub, which works for one technical person
and nobody else.

Build it **against ContentType**, not hardcoded blocks, or it gets rewritten.

## Priority 5 — Tournament entry

The engine is a separate system. What belongs here is the **entry flow**, and
the documents describe it precisely:

- Magic link on email or mobile, no account
- Profile data pulled forward; only what changes is asked
- Previous-tournament count **derived, never asked**
- Weight and height confirmed every time
- Consent recorded per event, not on the profile
- Merchandise in the same flow

## Priority 6 — Member portal

Twenty sections of the CMS document. Needs the database connected and payer
accounts modelled first, or it sits untested.

---

## Things in the documents I would argue against, for now

**Cryptographically signed ranks.** The intent is right — a dan grade should
survive a federation trying to strip it. But an immutable signed ledger is
months of work and the same outcome comes from export plus an independent
registry. Revisit when a second federation asks.

**Graph database for re-parenting.** `ltree` already moves a subtree in one
update. A graph database is a rewrite to solve a problem that is solved.

**Geofencing and BLE.** As above — the QR path covers it.

**Multi-gateway payment orchestration.** GoCardless, SEPA, PIX all matter
eventually. Stripe plus bank transfer covers New Zealand, and a second country
is the right trigger.

---

## The order, and why

```
1. Communications     nothing exists, highest daily value
2. Family accounts    blocks three things below it
3. Attendance         needs family; enables churn alarms
4. Editor             makes the CMS usable by non-developers
5. Tournament entry   needs family and profiles
6. Member portal      needs all of the above
```

## Two things to do before any of it

**Connect Postgres.** Four of the six need writes. Building them against files
means building them untested.

**Confirm the belt ladder with Hanshi Doug.** It is still a placeholder and it
runs through eligibility, authority, conferred titles and the site furniture.

## The rule for the rest of this build

Every session ends with something a dojo operator could use, or it was the
wrong session. Rank modelling was interesting and it was not that.
