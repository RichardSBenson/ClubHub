# Installing Honbu for a federation

One install is one federation. Its own database, its own domain, its own
country if that is what its law requires — the way a self-hosted site is its
own site rather than a row in somebody else's platform.

That is not only a preference. A federation holding children's names, dates of
birth and emergency contacts may be legally required to keep them inside its
own borders. "It is in a shared database in Virginia" ends that conversation.

Nothing below is shared with any other federation. There is no central
account, no platform database, nothing to sign up to.

## What you need

- A Postgres database. Neon's free tier is enough to start, and you choose the
  region — put it where the federation's law says it has to be.
- Somewhere to run Node 22. Vercel's free tier is enough.
- An email address for the first administrator.

## 1. The structure

Load `db/install/schema.sql` into the empty database. Every table, function
and index; no federation's data.

```
psql "$DATABASE_URL" -f db/install/schema.sql
```

Or paste it into Neon's SQL editor. It runs once — a second run stops at
`type "org_type" already exists`, which is the protection, not a fault.

## 2. Found the federation

```
DATABASE_URL="postgresql://..." \
node tools/found.mjs \
  --name "British Kung Fu Association" \
  --art  "Kung Fu" \
  --country GB \
  --email secretary@bkfa.org.uk
```

Four answers. That is the whole install.

It creates the federation, three starting grades, a grading authority
permissive enough that nothing is blocked on day one, an "About" page to edit,
and the first administrator's account as owner.

It reads the martial art to pick the starting vocabulary — a kung fu
federation's clubs are kwoons and its instructors are sifu, a taekwondo
federation's are dojangs and sabeom — so nobody opens their own register and
reads somebody else's language. An art it does not recognise gets neutral
words rather than a guess.

It refuses to run on a database that already holds a federation.

Everything it creates is a starting point. The grades in particular are three
placeholders with gaps in the numbering so the federation can insert their own
between them; they are not a suggestion about how anybody should grade.

## 3. Deploy

Set on the host:

```
DATABASE_URL     the database from step 1
FEDERATION       the slug found.mjs printed, e.g. british-kung-fu-association
REBUILD_HOOK_URL optional: a deploy hook, so publishing a page rebuilds the site
```

Then deploy. The build reads the federation out of the database and writes
their website.

## 4. Get in

Sign-in is a link emailed to the address from step 2, so wire up a mail
provider first.

If you need in before email works, set `HONBU_BOOTSTRAP` to a long random
string, visit `/bootstrap/<that string>` once, and **delete the variable
afterwards**. It is a door, and it stays open until you close it.

## What is not shared

Worth being explicit, because this is the question every federation asks:

- **No shared database.** Nothing in this install can see another federation's
  data, because there is no connection to one.
- **No shared accounts.** An administrator here is an administrator here.
- **No phoning home.** Nothing reports to a central service.
- **Their data is theirs.** It is one Postgres database they own and can dump,
  move or delete without asking anybody.

A competitor from another art entering one of this federation's tournaments is
a guest entrant on *this* install, recognised by a magic link when they come
back. Their own federation's install is not involved and never sees it.
