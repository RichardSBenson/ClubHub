# Getting in before email works

Sign-in normally means emailing a link. Until a mail provider is wired up
nobody can sign in at all — including you. This is the way round it, and
nothing else.

## Setting it up

1. Generate a secret. Any long random string; here is one:

   ```
   HONBU_BOOTSTRAP=<the value generated for you in chat>
   ```

2. Vercel → **Settings → Environment Variables** → add `HONBU_BOOTSTRAP`
   with that value, all environments.

3. Redeploy.

4. Visit `https://<your-site>/bootstrap/<the value>`.

You land on the dashboard, signed in as the most senior account that already
holds a role.

## What it will not do

- **It creates nothing.** It signs in an account that already exists and
  already has a role. A leaked secret cannot mint an administrator.
- **It grants nothing.** Whatever roles that account had, it still has.
- **It refuses a short secret**, even the correct one. Under 24 characters and
  the route says so rather than accepting it.
- **A wrong secret and a disabled route look identical.** No hint that the
  route exists or that the value was close.

## What it records

Every attempt, successful or not, goes in `login_attempt`. Successes name the
account. The session is marked `bootstrap:` and lasts **two days**, not thirty.

A warning is also written to the Vercel logs each time it is used. That is
deliberate — it should be visible, not quiet.

## Turning it off

Delete the environment variable and redeploy. With nothing set, the route does
not exist.

Do that as soon as email works. The code can stay; it is inert without the
variable.

## Why this and not a password

A password would need a reset flow, which needs email — the thing that is
missing. This is a smaller hole for a shorter time, and it closes with one
deletion rather than a migration.
