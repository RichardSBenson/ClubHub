-- Pages that need regenerating. The build reads this instead of rebuilding
-- everything, which is what stops a bulk edit becoming a wave of work.

create table rebuild_queue (
  path       text primary key,
  reason     text,
  queued_at  timestamptz not null default now(),
  built_at   timestamptz
);

create index on rebuild_queue (queued_at) where built_at is null;
