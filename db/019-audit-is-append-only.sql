-- applied-when: select exists (select 1 from pg_trigger where tgname = 'audit_log_is_append_only')
--
-- How tools/migrate.mjs tells whether this migration is already in a database.

-- ===========================================================================
--  An audit log you can edit is not an audit log
--
--  Thirteen places write to this table. Until now nothing read it, and
--  nothing stopped anybody changing it either — a row could be updated or
--  deleted by the same connection that wrote it, which makes the whole table
--  a record of what somebody was last willing to admit to.
--
--  Federations argue about records. Who graded whom, who took a page down,
--  who put a child's photograph on a website. The value of this table is that
--  it answers those questions even when the answer is inconvenient, and that
--  is only true if it cannot be tidied up afterwards.
--
--  So: inserts are allowed, updates and deletes are refused at the database,
--  by everybody, including the application's own connection. Not a permission
--  that an administrator could grant themselves — a rule in the table.
--
--  What this deliberately does NOT do is stop a federation deleting a person.
--  A person row can go; the log of what was done to it stays, with the id and
--  whatever the before/after recorded. Honouring an erasure request is a
--  decision somebody makes with full knowledge, and it should be made by
--  dropping the subject rather than by quietly editing history.
--
--  A log that must grow forever also needs pruning eventually. That is a
--  retention policy, which is a decision a federation makes and not something
--  to assume here. When it exists it will be a deliberate, recorded operation
--  that lifts this rule for the duration, not a DELETE somebody runs.
-- ===========================================================================

create or replace function audit_log_refuse_change() returns trigger
language plpgsql as $$
begin
  raise exception
    'audit_log is append-only: % is not permitted. The point of this table '
    'is that it still says what happened when that is inconvenient.',
    tg_op
    using errcode = 'restrict_violation';
end $$;

drop trigger if exists audit_log_is_append_only on audit_log;

create trigger audit_log_is_append_only
  before update or delete on audit_log
  for each row execute function audit_log_refuse_change();

-- Reading it is the whole point of this work, and a log is read by
-- organisation and by the thing that was changed. The organisation index
-- already exists; this is the one for "what happened to this record".
create index if not exists audit_log_actor_idx on audit_log (account_id, at desc);
