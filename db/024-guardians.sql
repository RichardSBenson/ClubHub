-- applied-when: select exists (select 1 from information_schema.tables where table_name = 'guardian_link')
--
-- How tools/migrate.mjs tells whether this migration is already in a database.

-- ===========================================================================
--  A parent or guardian is a person, linked to the child
--
--  Until now a guardian was a name typed into an event entry. A parent with
--  three children in two clubs needs to be one person who can act for all of
--  them, and a club needs to be able to say who that person is.
--
--  The authority lasts while the child is a minor. That is not stored: it is
--  worked out from the child's date of birth every time, so a link cannot
--  outlive the child's eighteenth birthday by somebody forgetting to end it.
--  (ended_on exists for a link that is wrong or has been withdrawn.)
-- ===========================================================================

create table guardian_link (
  id            uuid primary key default uuid_generate_v4(),
  guardian_id   uuid not null references person(id) on delete cascade,
  child_id      uuid not null references person(id) on delete cascade,
  relationship  text not null default 'parent'
                check (relationship in ('parent','step_parent','guardian',
                                        'grandparent','carer')),
  created_by    uuid references account(id),
  created_at    timestamptz not null default now(),
  ended_on      date,
  check (guardian_id <> child_id)
);

create unique index one_current_guardian_link
  on guardian_link (guardian_id, child_id) where ended_on is null;
create index on guardian_link (child_id) where ended_on is null;
create index on guardian_link (guardian_id) where ended_on is null;
