-- applied-when: select exists (select 1 from information_schema.check_constraints where constraint_name = 'message_audience_check' and check_clause like '%udansha%')
-- A message can go to black belts only.
alter table message drop constraint if exists message_audience_check;
alter table message add constraint message_audience_check
  check (audience in ('members','instructors','udansha','event','person','selected'));
