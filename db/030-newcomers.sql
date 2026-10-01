-- applied-when: select exists (select 1 from information_schema.tables where table_name = 'newcomer')
--
-- How tools/migrate.mjs tells whether this migration is already in a database.

-- ===========================================================================
--  Newcomers: people trying a class before they are members
--
--  Deliberately NOT a person with a "pending" membership. A person record
--  appears on rolls, in grading candidate lists and in search, and takes a
--  permanent member number nobody can reuse. Somebody who came once and never
--  returned must not do any of that. A newcomer is a short-lived record that
--  becomes a person only when they join; their visits are then moved onto the
--  member's own attendance, so the classes they came to before joining count.
-- ===========================================================================

create table newcomer (
  id               uuid primary key default uuid_generate_v4(),
  organisation_id  uuid not null references organisation(id) on delete cascade,
  first_name       text not null,
  last_name        text not null,
  email            citext,
  phone            text,
  date_of_birth    date not null,
  guardian_name    text,
  guardian_phone   text,
  emergency_name   text,
  emergency_phone  text,
  medical_notes    text,
  consent_by       text not null,                    -- who accepted the waiver
  consent_at       timestamptz not null default now(),
  consent_taken_by uuid references account(id),
  status           text not null default 'trialling'
                   check (status in ('trialling','joined','not_continuing')),
  person_id        uuid references person(id) on delete set null,   -- once they join
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index on newcomer (organisation_id, status);

create table newcomer_attendance (
  id              uuid primary key default uuid_generate_v4(),
  newcomer_id     uuid not null references newcomer(id) on delete cascade,
  organisation_id uuid not null references organisation(id) on delete cascade,
  session_id      uuid references training_session(id) on delete set null,
  session_date    date not null,
  unique (newcomer_id, session_id, session_date)
);
create index on newcomer_attendance (organisation_id, session_date desc);
