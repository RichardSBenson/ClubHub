-- applied-when: select exists (select 1 from information_schema.columns where table_name = 'message' and column_name = 'channel')
-- A message can go by email and app notification together (the default) or by app notification alone, so a club can
-- reach a member who has the app but no email address. A person with no app installed is recorded as 'no_app'.
alter table message add column if not exists channel text not null default 'both' check (channel in ('both','app'));
alter table message_recipient drop constraint if exists message_recipient_status_check;
alter table message_recipient add constraint message_recipient_status_check
  check (status in ('queued','sending','sent','failed','opted_out','no_email','no_app'));
