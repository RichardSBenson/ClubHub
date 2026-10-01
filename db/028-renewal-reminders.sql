-- applied-when: select exists (select 1 from information_schema.check_constraints where constraint_name = 'message_audience_check' and check_clause like '%selected%')
--
-- How tools/migrate.mjs tells whether this migration is already in a database.

-- ===========================================================================
--  Fees reminders
--
--  A message can be addressed to people picked from a list (the renewals
--  list), and can be a fees reminder. A fees reminder is a service message:
--  like one about an event somebody entered, it is not stopped by opting out
--  of announcements, and says so.
-- ===========================================================================

alter table message drop constraint if exists message_audience_check;
alter table message add constraint message_audience_check
  check (audience in ('members','instructors','event','person','selected'));
alter table message drop constraint if exists message_kind_check;
alter table message add constraint message_kind_check
  check (kind in ('announcement','event','renewal'));
