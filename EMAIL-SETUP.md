# Turning on email

Sign-in is a link emailed to you. Until this is set up nobody can be invited,
which is why `HONBU_BOOTSTRAP` exists — a door left open because there was no
other way in. **Set this up, then delete that variable.**

No account to open, no domain to verify, no service to sign up to. Honbu
speaks SMTP directly, so any mailbox the federation already has will do.

## Use an app password, never your account password

Both providers below need one, and both require two-factor authentication to
be on before they will issue one. That is a feature: an app password does
nothing but send mail, it can be revoked on its own, and if it leaks nobody
gets your inbox.

## Outlook / Hotmail / Microsoft 365

1. **account.live.com/proofs/manage** → turn on two-step verification.
2. Same page → **App passwords** → create one. Copy it; it is shown once.
3. Set these on the host:

```
MESSENGER_PROVIDER  smtp
SMTP_HOST           smtp-mail.outlook.com
SMTP_PORT           587
SMTP_USER           you@outlook.com
SMTP_PASS           the app password
SMTP_FROM           you@outlook.com
SMTP_FROM_NAME      Mas Oyama Karate New Zealand
```

## Gmail / Google Workspace

1. **myaccount.google.com/security** → turn on 2-Step Verification.
2. **myaccount.google.com/apppasswords** → create one.
3. Same variables, with:

```
SMTP_HOST           smtp.gmail.com
SMTP_PORT           587
```

## A mailbox with your own domain

Whatever your host's documentation calls the outgoing server. Port 587 is the
usual one. If yours wants TLS from the first byte instead, use port 465 — that
switches automatically, or set `SMTP_SECURE=true` if it listens somewhere else.

## Then

Redeploy so the variables are picked up, and ask for a sign-in link. It should
arrive in a few seconds.

Then **delete `HONBU_BOOTSTRAP`**. It is a URL that signs somebody in as an
administrator with no password and no email, and it stays open until you
remove it.

## What it does and does not do

- **Always encrypted.** On 587 it issues STARTTLS and will not continue
  without it; on 465 the connection is encrypted from the first byte. A
  server that cannot encrypt gets nothing — not the password, not the link.
- **Certificates are verified.** `SMTP_TLS=insecure` turns that off for a
  server whose certificate cannot be verified. It is a way out, not something
  to set and forget.
- **It waits.** The route does not answer until the mail server has accepted
  the message, so "check your email" is only ever said once that is true.
- **Nothing is retried.** A failure is reported to whoever asked, rather than
  queued and forgotten. Retrying belongs with background jobs, which do not
  exist yet.

## Sending as an address you do not own

Don't. Put your own address in `SMTP_FROM`. Sending from an address at a
domain you have not authorised gets the message dropped by most receivers,
and your members will not know it was sent.

## If it does not work

The message says which step failed and what the mail server said. Common ones:

- *Authentication credentials invalid* — an account password rather than an
  app password, or two-factor is not on.
- *Could not reach the mail server* — wrong host, or the port is blocked.
- *The mail server stopped responding* — wrong port for the mode; try 465
  with `SMTP_SECURE=true`, or 587 without it.
