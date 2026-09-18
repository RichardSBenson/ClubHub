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

- a venue
- an address or at least a suburb
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
| blurb | two or three sentences in their own words |
| who_trains | one sentence on who actually trains there |

`blurb` and `who_trains` must be original per dojo. Seventeen pages with the
same paragraph and the town swapped is duplicate content, and Google ranks none
of them.

## Sessions

One row per class per night. The site groups them, so
`Tuesday 17:30` and `Thursday 17:30` with the same label render as one row
reading "Tuesday & Thursday".
