-- applied-when: select exists (select 1 from information_schema.columns where table_name = 'message_recipient' and column_name = 'read_at')
--
-- How tools/migrate.mjs tells whether this migration is already in a database.

-- ===========================================================================
--  A member's own inbox
--
--  Messages a club sends are already recorded per recipient. Reading them in
--  the member portal needs only one more fact: when the recipient opened it.
-- ===========================================================================

alter table message_recipient add column if not exists read_at timestamptz;
create index if not exists message_recipient_unread
  on message_recipient (person_id, sent_at desc) where status = 'sent' and read_at is null;
