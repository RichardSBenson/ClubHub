# API, webhooks and the platform screen

Under **Organisation → API and webhooks** (owner or administrator).

## API tokens

Read-only access for other software. A token belongs to one organisation and sees that organisation and everything beneath it: a dojo's token sees only its dojo; the federation's sees everything. Choose what it may read: organisations, members, events. The token is shown **once** when made; only a SHA-256 fingerprint is stored. Revoking stops it at once.

```
curl -H "Authorization: Bearer hb_…" https://<your-site>/api/v1/members?limit=100
curl -H "Authorization: Bearer hb_…" "https://<your-site>/api/v1/members?limit=100&after=<next from the last page>"
```

Answers are JSON: `{ "data": [...], "next": "<id or null>" }` (organisations has no paging). Members show number, name, dojo, role, status, fees-paid-to date, joined date and current grade, and **never** date of birth, contact details, medical or payment information. Not rate-limited yet: revoke a token that misbehaves.

## Webhooks

Give an https address and choose what to be told about: a member added, a payment made, a form signed, a class place booked. An endpoint on the federation hears about everything beneath it; a dojo's hears only its own.

- Each message is JSON `{ id, event, created, organisation, data }` with minimal data (ids and names, no contact details).
- It is signed: `X-Honbu-Signature: t=<unix time>,v1=<hex>` where `v1` is HMAC-SHA256 of `<t>.<raw body>` with the secret shown once when you made the webhook. Reject old timestamps and compare in constant time. `X-Honbu-Event` and `X-Honbu-Delivery` are sent too.
- A 2xx answer is success. Anything else is retried after 1, 5, 30 minutes, 2 and 12 hours, then abandoned. Twenty failures in a row switch the webhook off (it says so on the screen); switch it on again when fixed.
- **Safe by construction**: https only; addresses that are or resolve to private, loopback or link-local networks are never called (checked again at delivery time); redirects are not followed.
- "Send a test" delivers a `ping` straight away. Retries and the 30-day log tidy run with the daily job (`/cron/renewals`); the first attempt is made at the moment the event happens.

## The platform screen

`/platform`, visible to the owner of the federation at the top of the installation: what is switched on (daily-job secret, live payments, email, notifications), counts of what is here, and the latest activity.
