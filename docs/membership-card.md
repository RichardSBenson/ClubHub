# The digital card and class check-in

## The card

A member opens **My home → Membership card** (a parent opens their child's from the same tile). It shows
the federation, name, member number, club, grade, paid-until date and a QR code. It is drawn on demand on
the member's own phone and is not meant to be printed.

The QR holds a link, `/v/<token>`, so any phone camera opens it. The token is the wallet package's door
token (member number, rank, expiry, federation, HMAC signature), so a scanner that wants to work with no
signal can read the signature from the last part of the link.

- **Lasts a week**, or until the membership runs out if that is sooner. A screenshot passed around stops
  working; opening the page again gives a fresh one.
- **No card** for a lapsed, suspended or unnumbered member, or one with no paid-until date (unless they are
  fee-exempt). The screen says why.
- **Carries nothing personal**: the number and the grade rank. Not a name, date of birth or weight.

### What a scan shows

| Scanner | Sees |
|---|---|
| Not signed in, or a member | Whether the code is good, and the federation. Nothing about who. |
| An instructor, registrar or administrator of that member's club (or above) | Name, number, club, grade, paid-until, a link to the record, and a warning if their grade has changed since the code was made. |

The answer is checked against the live register, not only the signature: a code made last Tuesday for
someone whose membership has since lapsed says **Not a current member**.

## Class check-in

On the **Attendance** screen, each class that runs today has a **Check-in code** button. It opens a full
page with a QR for that class and that day, to leave open on a tablet at the door.

- The page **refreshes itself every minute** (no script needed) and each code lives **five minutes**, so a
  photo of it taken at home is useless by the time anyone gets there.
- A parent scans it with their phone camera. If they are signed out they are sent to sign in and brought
  straight back (the sign-in link remembers where they were going — a path on this site only).
- They see their family: children the class suits are ticked, others are greyed with the reason (age or
  grade limit, not on this club's roll, already in). One tap checks everyone in.
- It writes the same attendance rows the instructor's roll does, so grading eligibility, “not seen in 30
  days” and the member's record all see it. The roll screen shows them ticked and the instructor can still
  untick anyone.
- The form cannot be used to check in someone the class does not suit: the server works the plan out again.
- Every check-in is in the audit log (`self_check_in`).

## Setup

Both tokens are signed with `CARD_SECRET`, falling back to `ENTRY_SECRET`, then `CRON_SECRET`. With none
set, cards and check-in codes are not issued — shut rather than open.

## The QR itself

`packages/core/domain/qr.mjs` draws QR codes with no library: byte mode, error correction M, versions 1–10
(up to 213 bytes). It was checked against an independent decoder at every size.

## Not built

- Apple / Google Wallet signing (needs your developer accounts; see `wallet.md`).
- GPS geofence and Bluetooth beacons from the check-in spec. A rotating code is enough for a hall.
- Photo on the card (the record has a photo field; no upload screen yet).
- A scanner that works fully offline (the signature is readable offline; the live check is not).
- Certificate and document QR verification (§27).
