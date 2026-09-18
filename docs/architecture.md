# Architecture

Clean Architecture, applied where business rules live and nowhere else.

## The dependency rule

Dependencies point inward. Enforced, not encouraged:

```bash
node tools/check-dependencies.mjs
```

It reads every import in every layer and fails the build on a violation. The
domain may not import the runtime — not even `node:crypto`.

```
domain          imports nothing
application     imports domain
infrastructure  imports domain, application
adapters        imports all of the above
```

## The layers

```
packages/core/domain/          entities and value objects
  values.mjs                   RankOrder, MemberNumber, GradingDate, Age
  rank.mjs                     Grade, GradingAuthority, GradingRecord, RankHistory

packages/core/application/     use cases and the ports they need
  ports.mjs                    interfaces DEFINED BY the core
  check-eligibility.mjs        is this person ready for their next grade
  award-grade.mjs              record a grading, with every rule applied

packages/infrastructure/
  memory/                      in-memory adapters — prove the inversion
  postgres/                    the only place that knows SQL exists

packages/api/                  HTTP adapters: routes, views, session
packages/site/                 static site adapter
```

## The proof

`packages/core/test.mjs` runs both use cases with **no database, no HTTP, no
I/O of any kind** — 33 assertions in a few milliseconds.

`packages/core/test-against-postgres.mjs` constructs the *same use case objects*
with Postgres adapters and asserts identical behaviour. Not one line of core
code differs between the two.

```
memory:   4th kyu → 3rd kyu, eligible true
postgres: 4th kyu → 3rd kyu, eligible true
```

If the inversion were decorative, that second file could not exist.

## What the core owns

- Whether a grade may be awarded by a dojo or only nationally
- How large a panel must be and how senior
- Whether a person is eligible, and by how much they fall short
- What a person's current grade is, derived from their history
- That an override is possible but never silent — the waived reasons come back

None of it lives in a controller. The same `AwardGrade` object serves the web
form, and would serve a CLI, a bulk import after a national shinsa, or the
tournament system, unchanged. There is no second path to the register.

## What is deliberately NOT abstracted

Views are template functions. The importer is a script. Auth is a module.
Routing is a table.

Clean Architecture applied everywhere produces forty files to change one field.
Applied where business rules exist, it produces a core that can be reasoned
about on its own — which is the whole point, and the part usually lost.

## Ports fail at wiring time

JavaScript has no interface keyword, so `requirePort()` checks the contract when
a use case is constructed:

```
LadderRepository is missing: gradesFor, authorityFor
```

Better than `undefined is not a function` three layers deep, at runtime, in
production, during a grading.

## Two bugs the rewrite found

**The ladder was assumed to start at rank 1.** An ungraded person was offered
nothing if a federation numbered its ladder differently. Now the bottom rung is
whatever the lowest grade is.

**The in-memory fake let panel ranks be set directly.** That made the test
easier and proved less: panel seniority must come from the register. The fake now
holds the examiners' own gradings, like the real thing does.
