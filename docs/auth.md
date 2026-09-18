# Signing in

No passwords. Emailed links only.

## Why

Volunteer organisations forget passwords, and a reset flow is a support burden
nobody signed up for. The same mechanism serves a dojo operator logging in once
a month and a member checking their grade once a year.

It is also one fewer secret to leak. There is no password to reuse from another
site, and no password database to breach.

## How it works

1. Someone enters their email. A link is emailed, good for 15 minutes, once.
2. Following it creates a session, good for 30 days.
3. The session cookie is the only thing the browser holds.

## Four decisions worth keeping

**Requesting a link tells you nothing.** A known address and an unknown one get
the same response. An endpoint that says "no such account" is a membership list
anyone can enumerate — and for a federation whose members include children, that
list matters.

**Nothing usable is stored.** Links and sessions are kept as SHA-256 hashes. A
database dump does not let anyone sign in.

**Five links per email per hour.** A sign-in form that emails anyone is a spam
cannon otherwise. Every attempt is recorded — sent, unknown, or rate limited —
so abuse is visible.

**Sign out everywhere exists.** The "I lost my phone" button. It is one query,
and people will ask for it.

## Never log the token

`requestLink()` returns the raw token for the caller to email. That is the only
moment it exists in plaintext. It must not reach a log, an error report or an
analytics event.
