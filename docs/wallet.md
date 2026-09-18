# Member cards

Wallet passes, not an app screen.

## Why

A parent can hold three children's cards at once. The one-card-per-phone limit
that makes app-based cards unusable for families does not exist in Apple Wallet
or Google Wallet — this was the specific failure that ruled out the alternative.

It also works with no signal, expires by itself when affiliation lapses, and
there is nothing to install.

## The door token

The barcode does not carry a member id to be looked up. It carries a short
signed token:

```
NZ-0417|7|2026-12-31|moknz     →  TlotMDQxN3w3fDIwMjYtMTItMzF8bW9rbno.HfNOm_RtqdyH3VN_
```

Member number, rank order, expiry, federation. Signed with HMAC and truncated to
12 bytes of signature — 51 characters total, which survives being printed as a QR
code and scanned off a cracked phone screen in a badly lit hall.

A scanner verifies it **with no connection**. That matters: the venues these get
used in have bad reception, and a door check that needs wifi is a door check that
does not happen.

Because the rank is in the token, a grading steward can also check eligibility at
the door without a database.

Comparison is constant-time. A public scanner is otherwise an oracle.

## What is needed to go live

**Apple** — a Developer account (US$99/year) and a Pass Type ID certificate.
`applePass()` builds pass.json and `appleManifest()` the SHA-1 manifest; the
signature is the only missing step, and it is a `openssl smime` call with that
certificate.

**Google** — a Google Wallet issuer account (free) and a service account key.
`googleClass()` is created once per federation, `googleObject()` per member, and
`googleJwt()` produces the JWT to sign with the service account.

## The bug this nearly shipped with

Postgres returns dates as JS `Date` objects. `String(date).slice(0,10)` gives
`"Thu Dec 31"`, which then fails to parse — so every card would have been issued
already expired, and nobody would have noticed until a grading.

`isoDate()` exists for that reason. Never cast a date with `String()`.

## Rules

- No paid-until date, no card.
- Lapsed or suspended, no card.
- No member number, no card.
- A card that outlives affiliation is worse than no card at all.
