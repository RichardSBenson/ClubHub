# Publishing

## The idea

A publication has an **identity and a version**. The system can answer *"what is
live right now, and which revision is it"* without regenerating anything.

Without that entity there is no rollback, no scheduling, and no honest basis for
cache invalidation. It is the thing everything else leans on.

## Publications are never edited

Publishing again creates a new one and marks the old **superseded**. Nothing is
overwritten, so the whole sequence is on record.

Which makes rollback ordinary: publishing an earlier revision again is just
another publication. There is no special path, nothing to reconstruct.

```
pub-1  /about  rev r1  superseded
pub-2  /about  rev r2  superseded
pub-3  /about  rev r1  live          ← rolled back
```

## "Publish the current version" is not allowed

If no revision is named, the newest is pinned **at publish time** and recorded.
Publishing "whatever is current" is how nobody can tell afterwards what actually
went out.

## The domain announces; adapters listen

```
publication.created     what went live, what it replaced, and the path it left
publication.withdrawn   so a redirect can be written
publication.scheduled
path.changed            both paths, so a redirect can be written
```

The domain does not know or care who listens. Whether an event rebuilds a page,
warms a cache or notifies a dojo is an adapter's business — and events are
stored, so a failed subscriber can be retried and *"why did that page change"*
has an answer months later.

## Uniqueness is the database's job

```sql
create unique index one_live_per_entry
  on publication (entry_id, locale) where status = 'live';

create unique index one_live_per_path
  on publication (path, locale) where status = 'live';
```

Not the application's. Two code paths publishing at once is exactly when
application-level checking loses.

## The bug this found

The use case originally saved the new publication and *then* superseded the old
— leaving two live for an instant. The in-memory adapter allowed it. Postgres
refused it, correctly.

The fix was not to reorder but to add `replace(next, previous)` to the port: the
use case still decides what supersedes what, and the adapter guarantees the two
changes happen together. Postgres does it in a transaction; the in-memory one
does it in sequence.

**That is the argument for testing against both.** A fake that is more permissive
than the real thing hides exactly this class of bug.

## Scheduling

`RunScheduledPublications` brings due publications live. No actor, because
nobody is present — which is why authorisation happened when the publication was
scheduled, not now.

Deliberately tolerant: one failure is reported and the rest continue. A single
bad entry must not silently hold back everything behind it.
