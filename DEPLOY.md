# Deploying

**No database needed.** The site runs from the JSON files in `data/`.

## First deploy

1. Push to GitHub.
2. Import the repository in Vercel.
3. Deploy. Nothing to configure.

Vercel runs `node packages/site/build.mjs`, which reads `data/` and writes
`dist/`. No environment variables, no connection string, no schema to run.

If the build says `store: files`, it worked.

## What you get

- The public site: home, find a dojo, seventeen dojo pages, events, news,
  authored pages, sitemap, robots
- Structured data on every dojo page
- The theme generated from the crest

## What you do not get yet

The admin — sign-in, roster, register, grading. Those need writes, and a
serverless filesystem is read-only. Visiting one returns a 503 that says so
rather than an error.

## Editing content

Edit the JSON in `data/` through GitHub's web interface. Commit. Vercel
rebuilds. Every change is a commit with an author and a date.

`data/organisations.json` — the dojo list
`data/dojo-profiles.json` — venue, address, times, contact
`data/events.json` — what is on
`data/pages.json` — authored pages
`data/brand.json` — colours and fonts

## Adding the database later

When the admin needs to work:

1. Create a Supabase project (free tier is ample).
2. Run `db/schema.sql`, then the numbered migrations, in their SQL editor.
3. Set `DATABASE_URL` in Vercel.
4. Redeploy.

Nothing in the application changes. The factory sees the variable and switches
adapters; the core never knew which it was talking to.

To refresh the flat files from the database afterwards:

```bash
npm run export      # writes data/
```

Commit the result. The public site keeps running from files even once the
database exists — which means the site stays up when the database does not.

## Why this order

The database is not the centre of the application and never should be. The
application talks to ports; Postgres is one implementation, files are another.
Proving the whole thing works before provisioning anything is the point of
building it that way.
