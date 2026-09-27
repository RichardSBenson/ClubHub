# Getting messages out

No email provider. The system works anyway, and adding one later changes
nothing above the adapter.

## How it is arranged

```
SendSignInLink          knows there is a link and who it is for
  ↓ Messenger port      defined by the core
LogMessenger            writes it to the log          ← in use now
MemoryMessenger         keeps it in an array          ← tests
HttpMessenger           posts to a provider           ← when you want it
```

The use case names no provider, calls no `fetch`, and reads no environment
variable. There are tests asserting all three, because that is the property
worth protecting.

## Today

Nothing configured means the log messenger. Someone asks for a sign-in link and
the whole message appears in the Vercel log:

```
─── sign-in for doug@example.nz ───
Sign in to Mas Oyama Karate New Zealand

Kia ora Doug,

Here is your sign-in link for Mas Oyama Karate New Zealand:

https://clubhub.example.nz/signin/xR3k…

It works once, and expires in 15 minutes.
─── not sent: no messenger configured ───
```

Copy the link, paste it, you are in. Good enough to test the whole flow. Not
good enough for anyone without log access — which is exactly the point.

## Later

Two environment variables:

```
MESSENGER_PROVIDER = postmark        (or resend)
MESSENGER_API_KEY  = …
MESSENGER_FROM     = noreply@kyokushinkarate.co.nz
```

Redeploy. Nothing else changes.

## Why HTTP and never SMTP

A serverless function stops once it responds. SMTP needs DNS, TCP, TLS, auth
and transfer to complete on one socket before that happens, and when it does not
the connection drops mid-sequence **with no error** — clean logs, no message.

An HTTP send is a single awaited request. No socket, no pool, no port.

## The three failures this guards against

**Returning before the send completes.** The most common one, and it throws
nothing. The route awaits the messenger and the response waits for it.

**A 200 with no message id.** The provider accepted the request but not the
message. `HttpMessenger` treats a missing id as a failure, because otherwise it
looks exactly like success.

**A hung provider.** Ten-second timeout, so a slow provider cannot hold a
function open until the platform kills it.

When a send fails the person gets a 503 and *"we could not send the sign-in link
just now"* — not a confirmation page for a link that was never sent.

## Before pointing DNS at Vercel

Vercel does not run a mail service, and moving nameservers does **not** carry
existing MX records across. Every address at kyokushinkarate.co.nz would stop
receiving mail while sending kept working — a failure in the direction nobody
tests.

Write the current MX records down first.
