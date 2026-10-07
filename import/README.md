# Importing dojo data

Two CSVs, one command. Blank means unknown — the database stores NULL and the
site says "to confirm". Never type a placeholder into a cell.

```bash
cp dojos-template.csv dojos.csv
cp sessions-template.csv sessions.csv
# fill them in
node import.mjs dojos.csv sessions.csv
```

Re-runnable. Importing twice changes nothing extra.

## The publish gate

Setting `publish=yes` is a request, not an instruction. A dojo page goes live
only when a visitor could actually turn up:

- an address, or at least a suburb (a venue's own name is optional)
- training times
- a phone number or an email

Anything missing and the importer holds the page back and tells you what is
needed. That is deliberate. A page reading "Sensei [Name]" is worse than no page.

## What to ask each dojo operator for

| Column | Example |
|---|---|
| venue_name | Springvale Community Hall |
| address_line | 21 Hadfield Street |
| suburb / city / postcode | Springvale, Whanganui, 4501 |
| latitude / longitude | -39.9187, 175.0200 — right-click the pin in Google Maps |
| phone / email | the one that reaches the dojo operator directly |
| directions | "Park at the back; side door by the playground." |
| country / timezone | optional, only for a dojo outside the federation's own country: JP, Asia/Tokyo |
| blurb | two or three sentences in their own words |
| who_trains | one sentence on who actually trains there |

`blurb` and `who_trains` must be original per dojo. Seventeen pages with the
same paragraph and the town swapped is duplicate content, and Google ranks none
of them.

## Sessions

One row per class per night. The site groups them, so
`Tuesday 17:30` and `Thursday 17:30` with the same label render as one row
reading "Tuesday & Thursday".

## Instructors

`instructors.csv` puts people on a dojo's roll as members who also instruct, at the dan grade they hold:

```bash
node import.mjs dojos.csv sessions.csv instructors.csv
```

Columns: `slug, first_name, last_name, dan` (1 to 8), and `distinct` (`yes` when the same name
elsewhere is a different person). Re-runnable: a person already on the roll is found by name
and not added twice, the same name on another dojo's roll is the same person (two people who
teach at two dojo get a second affiliation), and a grade they already hold or beat is left alone.

Grades are recorded as held on joining, not awarded here. Dojo operators are not made
administrators by this import; giving someone access to run a dojo is a separate, deliberate step.

This puts people on the roll. It does not put them on the website: that still needs each
instructor's own consent, a write-up of up to 280 characters, and current first aid, police
vetting and child protection checks (see docs/instructors.md).
