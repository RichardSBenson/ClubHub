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

Real providers are one file each behind the same two calls (`start`, `check`):

- **Stripe** — cards. Needs a Stripe account per payee (Connect), because the
  money goes to the dojo or the federation, not through one account.
- **Debitsuccess** — direct debit, settles overnight, confirms by webhook.
- **POLi** — bank-to-bank; availability is limited, so last.
- **VostroPay / Sport$pay** — needs their documentation.

A card number reaches only the provider and is never stored.

## Not built yet

Each payee's own provider account and settings, webhooks, refunds, receipts by
email, and membership renewals.
