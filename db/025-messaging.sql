-- applied-when: select exists (select 1 from information_schema.tables where table_name = 'message')
--
-- How tools/migrate.mjs tells whether this migration is already in a database.

-- ===========================================================================
--  Messages a club or federation sends, and who they reached
--
--  The record is the point. "Did the Whanganui parents get the grading
--  notice?" has to be answerable afterwards, person by person, including the
--  ones who were skipped and why.
--
--  A message is written first, with every recipient 'queued', and sent in
--  batches. A serverless function has a few seconds; a club has two hundred
--  members. Sending is resumable rather than hoped-for.
-- ===========================================================================

create table message (
  id              uuid primary key default uuid_generate_v4(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  sent_by         uuid references account(id),
  kind            text not null default 'announcement'
                  check (kind in ('announcement','event')),
  audience        text not null check (audience in ('members','instructors','event','person')),
  event_id        uuid references event(id) on delete set null,
  subject         text not null,
  body            text not null,
  sender_name     text not null,
  sender_address  text not null,
  reply_to        text,
  created_at      timestamptz not null default now()
);
create index on message (organisation_id, created_at desc);

create table message_recipient (
  id          uuid primary key default uuid_generate_v4(),
  message_id  uuid not null references message(id) on delete cascade,
  person_id   uuid references person(id) on delete set null,
  email       text,
  about_id    uuid references person(id) on delete set null,   -- the child, when a guardian was written to
  status      text not null default 'queued'
              check (status in ('queued','sending','sent','failed','opted_out','no_email')),
  error       text,
  provider_id text,
  sent_at     timestamptz
);
create index on message_recipient (message_id, status);

-- One row per person who has ever been written to; the token is their way out.
create table email_preference (
  person_id  uuid primary key references person(id) on delete cascade,
  token      text not null unique,
  opted_out  boolean not null default false,
  updated_at timestamptz not null default now()
);
