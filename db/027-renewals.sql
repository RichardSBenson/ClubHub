-- applied-when: select exists (select 1 from information_schema.columns where table_name = 'affiliation' and column_name = 'fee_exempt')
--
-- How tools/migrate.mjs tells whether this migration is already in a database.

-- ===========================================================================
--  Renewing a membership, paying in cash, and not paying at all
--
--  A dojo sets its own prices (fee_schedule, which already existed). A renewal
--  is a payment whose line says which membership it renews and for how many
--  months; when the payment succeeds — online, or recorded by the dojo as cash
--  or a bank transfer — the membership's paid_until moves on.
--
--  A member the dojo has decided does not pay is marked exempt, with a reason.
--  They renew without a payment and are never asked for one.
-- ===========================================================================

alter table affiliation
  add column if not exists fee_exempt        boolean not null default false,
  add column if not exists fee_exempt_reason text
    check (fee_exempt_reason in ('instructor','life','hardship','other'));

alter table payment drop constraint if exists payment_method_check;
alter table payment add constraint payment_method_check
  check (method in ('card','bank','direct_debit','cash','transfer'));

alter table payment
  add column if not exists taken_by    uuid references account(id),   -- who took the cash
  add column if not exists receipt_no  text;
create unique index if not exists payment_receipt_once
  on payment (organisation_id, receipt_no) where receipt_no is not null;

alter table payment_line
  add column if not exists renews_affiliation_id uuid references affiliation(id) on delete set null,
  add column if not exists renews_months smallint check (renews_months > 0);

-- Receipts numbered per organisation per year: R-2026-0001. A counter row,
-- because counting rows is how two people at the door get the same number.
create table if not exists receipt_counter (
  organisation_id uuid not null references organisation(id) on delete cascade,
  year            smallint not null,
  last_number     integer not null default 0,
  primary key (organisation_id, year)
);
