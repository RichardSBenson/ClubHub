# Decisions

Written down so they are not relitigated at 11pm in month four.

## 1. Organisations are a tree of arbitrary depth
Four fixed levels would make this bespoke for one federation. `ltree` path,
self-referencing parent. MOKNZ ships with two levels.

## 2. Visibility is down-branch only
`has_role_at()` in schema.sql. No sideways visibility between siblings, ever.
A role granted at a node applies to everything beneath it.

## 3. Age is derived from date of birth, never stored
An age typed into a form in March is wrong by August. Tournament divisions,
grading eligibility and junior class rules all compute it at the moment of use.

## 4. Current grade is a view, not a column
`person_current_grade` derives from the highest passed `grading_record`. A
stored column drifts from the register and then nobody trusts either.

## 5. Events carry explicit publish_up and publish_down flags
Not inferred from type. Seventeen dojo pushing weekly training onto one national
calendar makes it unusable, so upward publishing is per event and approvable.

## 6. Entries allow a person OR a guest
Open tournaments take entries from other organisations and other martial arts.
Most entrants have no record. They get one on entry, tagged as an open entrant,
and are never counted as members.

## 7. Invoices between levels, not split card payments
Chained transfers across currencies and jurisdictions are a support nightmare.
Each level invoices the level below from the register.

## 8. Personal detail does not flow to the international tier by default
`person_private` is a separate table for exactly this reason. The country body
is the data controller. Get this wrong and Europe is closed.

## 9. Audit everything
Federations argue about records, sometimes years later. `audit_log` keeps before
and after for every change.
