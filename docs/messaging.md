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

## Clubs writing to their people

Administrators write to their club from **Messages** in the admin. Every club
sends as itself: the name shown is the club's, the address is
`<club-slug>@<your sending domain>`, and replies go to the club's contact email
(its page's contact address, or failing that the administrator who sent it).

**One step is yours, once.** `MESSENGER_FROM` supplies the sending domain
(`noreply@mail.moknz.nz` → clubs send from `whanganui@mail.moknz.nz`). Resend or
Postmark will only send from a domain you have verified with them — add the DNS
records they give you. Until that is done, sends to people outside your own
account will be refused and show as *failed* on the message, with the reason.

With SMTP the mailbox can only be itself, so a club lends its *name* and its
*reply address* but not its sending address.

- Audiences: the whole club, instructors, people entered in an event, one person.
  A federation administrator writing from the federation reaches every club.
- A child with a linked parent or guardian is written to through them; one
  address gets one copy.
- Every message carries an unsubscribe link. It opens a page and changes nothing
  until the button is pressed. Announcements honour it; a message *about an
  event they entered* does not, and says so.
- Sending is in batches, with the first sent immediately and the rest behind a
  **Send the next batch** button, because a serverless function has seconds.
  Every recipient is on the record with sent, failed, opted out, or no address.
