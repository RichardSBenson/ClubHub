-- ===========================================================================
--  Publishing
--
--  A publication has an identity and a version. The system can answer "what is
--  live right now, and which revision is it" without regenerating anything.
--
--  Publications are never edited. Publishing again creates a new row and marks
--  the old one superseded — which is what makes rollback ordinary and gives a
--  cache adapter something honest to work from.
-- ===========================================================================

create table publication (
  id              uuid primary key default uuid_generate_v4(),
  entry_id        uuid not null,
  entry_kind      text not null check (entry_kind in ('page','article','dojo','event')),
  revision_id     uuid not null,
  path            text not null,
  locale          text not null default 'en-NZ',
  organisation_id uuid not null references organisation(id) on delete cascade,
  status          text not null default 'live'
                  check (status in ('scheduled','live','superseded','withdrawn')),
  published_at    date,
  scheduled_for   date,
  published_by    uuid references account(id),
  superseded_at   date,
  withdrawn_at    date,
  created_at      timestamptz not null default now(),

  check (path like '/%'),
  check (status <> 'scheduled' or scheduled_for is not null)
);

-- One live publication per entry per locale. The database enforces it, not the
-- application — because two code paths publishing at once is exactly when it
-- would otherwise go wrong.
create unique index one_live_per_entry
  on publication (entry_id, locale) where status = 'live';

-- And one live publication per path per locale. Two pages cannot share a URL.
create unique index one_live_per_path
  on publication (path, locale) where status = 'live';

create index on publication (entry_id, created_at desc);
create index on publication (scheduled_for) where status = 'scheduled';
create index on publication (organisation_id, status);

-- What is live, for the site build. One row per path.
create view live_publication as
select p.*, o.slug as organisation_slug
from publication p
join organisation o on o.id = p.organisation_id
where p.status = 'live';

-- ---------------------------------------------------------------------------
-- domain events, kept
-- ---------------------------------------------------------------------------

-- The domain announces; adapters subscribe. Storing them means a failed
-- subscriber can be retried, and that "why did that page change" has an answer.
create table domain_event (
  id            bigserial primary key,
  name          text not null,
  payload       jsonb not null,
  occurred_at   timestamptz not null default now(),
  handled_at    timestamptz,
  attempts      smallint not null default 0,
  last_error    text
);

create index on domain_event (name, occurred_at desc);
create index on domain_event (occurred_at) where handled_at is null;
