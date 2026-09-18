# Storage: files first, database later

## The problem this fixes

The application used to open a database connection when its modules loaded.
On a serverless host that means a cold start fails before any route runs —
including routes that need no data at all. Nothing loads, and the cause is
three layers away from the symptom.

Worse, it meant you could not deploy anything until a database existed,
credentials were set, and the schema had been run. That is a lot of waiting
before you find out whether the thing works.

## What happens now

**No `DATABASE_URL` set → the system runs from JSON files in `data/`.**

Push to GitHub, Vercel builds, the site is up. Nothing to provision.

**`DATABASE_URL` set → Postgres.**

One environment variable. Nothing in the core changes, because the core never
knew which it was talking to — that is what the ports are for, and this is the
third adapter set built against them.

## Why files are genuinely good here, not just a stopgap

- **Content is editable from a phone.** JSON in the repo, edited through
  GitHub's web interface — the same way this gets deployed.
- **Every change is a commit** with an author, a date and a message. A better
  audit trail than most content systems manage.
- **It cannot be down.** There is no database to be unreachable.
- **It costs nothing**, and at seventeen dojo the whole dataset is a few
  kilobytes read once per instance.

## The limit, stated plainly

A serverless filesystem is **read-only**. Files serve reads perfectly and refuse
writes:

```
Cannot record a grading: this deployment is running from files,
which are read-only. Connect a database to record changes.
```

A 503, not a 500 — this is a deployment state, not a fault.

So the split is:

| | Files | Database |
|---|---|---|
| Public website | yes | yes |
| Dojo pages, events, news | yes | yes |
| Reading the register | yes | yes |
| Recording a grading | no | yes |
| Members signing in | no | yes |
| Renewals and payments | no | yes |

**Deploy on files. Add the database when the admin app needs to write.**

## Keeping them in step

```bash
node tools/export-to-json.mjs
```

Dumps the register into `data/`. Commit it. The public site then runs from that
snapshot with no database.

Note what the exporter deliberately leaves out: dates of birth, contact details,
private notes, and every member who is not a named instructor. The public site
has no business carrying them, and a file in a repository is the last place they
should be.
