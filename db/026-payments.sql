-- applied-when: select exists (select 1 from information_schema.tables where table_name = 'payment_line')
--
-- How tools/migrate.mjs tells whether this migration is already in a database.

-- ===========================================================================
--  Payments: one payee each, and what each is for
--
--  `payment` existed and nothing wrote to it. It now carries a payee
--  (organisation_id), the person it is for, how it is paid, and who asked.
--  Each payment has lines saying what it is for; the KIND of a line decided
--  the payee (see packages/core/domain/payments.mjs).
--
--  Status gains 'awaiting' (started, the bank has not confirmed) and 'void'.
-- ===========================================================================

alter table payment drop constraint if exists payment_status_check;
alter table payment add constraint payment_status_check
  check (status in ('pending','awaiting','succeeded','failed','refunded','void'));
alter table payment alter column provider drop not null;
alter table payment alter column provider drop default;

alter table payment
  add column if not exists method       text check (method in ('card','bank','direct_debit')),
  add column if not exists requested_by uuid references account(id),
  add column if not exists paid_by      uuid references account(id),
  add column if not exists detail       text,
  add column if not exists settled_at   timestamptz,
  add column if not exists updated_at   timestamptz not null default now();

create table payment_line (
  id             uuid primary key default uuid_generate_v4(),
  payment_id     uuid not null references payment(id) on delete cascade,
  kind           text not null check (kind in ('dojo_fee','tournament_entry','kyu_grading',
                                               'dan_grading','uniform','equipment')),
  description    text not null,
  amount_cents   integer not null check (amount_cents > 0),
  event_entry_id uuid references event_entry(id) on delete set null
);
create index on payment_line (payment_id);
create index on payment (organisation_id, status, created_at desc);
create index on payment (person_id, status);
