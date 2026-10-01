-- applied-when: select exists (select 1 from information_schema.tables where table_name = 'grading_event')
--
-- How tools/migrate.mjs tells whether this migration is already in a database.

-- ===========================================================================
--  Grading events
--
--  A grading is an ordinary event (kind 'grading'). Clubs enter members the
--  same way they enter any event (event_entry); these tables add what only a
--  grading has: its fee, which grade each entrant is sitting for, and what the
--  panel decided. Results become grading_record rows — the register — only
--  when the organiser finalises, all together or not at all.
-- ===========================================================================

create table grading_event (
  event_id      uuid primary key references event(id) on delete cascade,
  fee_cents     integer not null default 0 check (fee_cents >= 0),
  finalised_on  date,
  finalised_by  uuid references account(id)
);

create table grading_entry (
  entry_id   uuid primary key references event_entry(id) on delete cascade,
  grade_id   uuid not null references grade(id),
  outcome    text check (outcome in ('pass','provisional','fail','absent')),
  notes      text,
  record_id  uuid references grading_record(id) on delete set null
);

-- Certificate numbers: one running count per federation per year.
create table certificate_counter (
  federation_id uuid not null references organisation(id) on delete cascade,
  year          integer not null,
  last_number   integer not null default 0,
  primary key (federation_id, year)
);

create unique index grading_record_certificate_no_key
  on grading_record (certificate_no) where certificate_no is not null;
