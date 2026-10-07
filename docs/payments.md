# Payments

## Who gets paid

Decided by what is being bought — never by who is buying or what card they use.
The rule lives in one place, `packages/core/domain/payments.mjs`.

| For                                  | Paid to                                   |
|--------------------------------------|-------------------------------------------|
| Dojo fees                            | the member's dojo                         |
| Kyu grading                          | the member's dojo                         |
| Tournament entry                     | whoever runs the tournament (usually a dojo) |
| Black belt grading                   | the federation (national)                 |
| Uniforms                             | the member's dojo                         |
| All other equipment                  | the member's dojo                         |

A charge has exactly one payee. A basket with two payees is two payments. If
there is no clear payee (a member not in any club) the charge is refused rather
than sent "to the federation by default".

A club asks a member for a payment from **Payments** in the admin; a black belt
grading asked for by a club is still the federation's money. Entering an event
with a fee creates the payment automatically, and the member is taken straight
to paying it.

## Who can pay

The person it is for, or a parent or guardian of a minor. Nobody else, and a
club sees only what it has been paid.

## Providers

`packages/infrastructure/payments/providers.mjs` is the port. Today only the
**test provider** exists (`PAYMENTS_PROVIDER` defaults to `test`): no money
moves, card `4000 0000 0000 0002` is declined, any other number is accepted, and
internet banking and direct debit come back *waiting* — as the real ones do —
until the "bank" confirms. Every screen says "Test payments" while it is on.

Real providers are one file each behind the same calls (`start`, `check`, and for automatic renewal `saveMethod`, `charge`):

- **Stripe** — cards. Needs a Stripe account per payee (Connect), because the
  money goes to the dojo or the federation, not through one account.
- **Debitsuccess** — direct debit, settles overnight, confirms by webhook.
- **POLi** — bank-to-bank; availability is limited, so last.
- **VostroPay / Sport$pay** — needs their documentation.

A card number reaches only the provider and is never stored.

## Not built yet

Each payee's own provider account and settings, webhooks, refunds, receipts by
email, and membership renewals.

## Renewals, cash, and people who do not pay

**Prices are each dojo's own.** A dojo's administrator sets its prices under
**Renewals**: a name, who it is for (juniors under 18, adults, or everyone), how
often (year, term, month, or a one-off joining fee) and the amount. A new price
for the same people and period takes over from its start date; the old one ends
the day before. Nothing is shared between dojos.

**Renewing.** A registrar ticks who to renew and the period. Each person is asked
for the dojo's price for their age; asking charges nobody, it puts a payment in
front of them (a parent sees their child's). When it is paid — card, bank, cash or
transfer — "fees run to" moves on from the **later of today and where it already
runs to**: paying early keeps the days already paid for, paying late is not
backdated, and a lapsed member becomes active again. A declined card or a bank
that has not confirmed moves nothing.

**Cash and bank transfers.** The dojo records them — a member cannot record their
own. Each is numbered per dojo per year (`R-2026-0001`), says who took it, and is
in the history. People paying at the door can be asked and recorded in one step
("Already handed over?"). The Payments screen totals what came in by method, so
the cash in the tin can be matched against the record. A dojo cannot record the
federation's money (a black belt grading) as received; that is the federation's
to record.

**People who do not pay.** An administrator marks a member *not charged* with a
reason — instructor, life member, hardship, other — and it is kept in the history.
They stay members, are never asked for money, anything already asked is withdrawn,
and **Carry membership on a year** moves their date on with no payment. It is a
decision about a person, not a rule about a role, because dojos differ: some
instructors pay, some do not.

## Automatic renewal

A member (or a parent) can turn on **Automatic renewal** from My payments: pick how often (year, term or month — only periods the dojo has a price for), pay by card or bank debit, and tick that they agree. The card number goes straight to the payment provider; we keep the provider's token and the last four digits (`payment_agreement`, migration 044).

- **When**: the daily run (`/cron/renewals`) charges 3 days before fees run out, at the dojo's price for the member's age, through the ordinary payment path — so the membership extends from the later of today and where it already ran to, and the receipt is in the history like any other.
- **If it fails**: tried again after 3 days, then after 7. The third failure pauses it, and the member is written to each time. Nothing is charged while paused.
- **Stopping**: one press, immediate; anyone who may act for the person can do it. Members not charged by the dojo cannot be put on it.
- **Reminders**: people on automatic renewal are left out of renewal reminders.
- **The dojo** sees "Renewing themselves" on the Renewals screen, with anyone whose payments are failing or have stopped.
- **Providers**: `saveMethod` and `charge` are the two calls a real provider adds beside `start`/`check`. The test provider implements them (card `4000 0000 0000 9995` saves but every later charge is declined). Stripe and Debitsuccess are not connected, so no real money moves yet.
