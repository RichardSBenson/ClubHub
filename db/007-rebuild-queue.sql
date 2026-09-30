-- applied-when: select to_regclass('public.rebuild_queue') is not null
--
-- How tools/migrate.mjs tells whether this migration is already in a
-- database. True means it is, and the migration is recorded without being
-- run again — which is what lets a database that predates the runner be
-- baselined honestly rather than guessed at.

-- Pages that need regenerating. The build reads this instead of rebuilding
-- everything, which is what stops a bulk edit becoming a wave of work.

create table rebuild_queue (
  path       text primary key,
  reason     text,
  queued_at  timestamptz not null default now(),
  built_at   timestamptz
);

create index on rebuild_queue (queued_at) where built_at is null;
