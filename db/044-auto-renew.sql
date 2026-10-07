-- 044 — automatic renewal: a member lets their dojo charge a saved payment method when fees run out.
-- applied-when: select exists (select 1 from information_schema.tables where table_name = 'payment_agreement')

create table if not exists payment_agreement (
  id              uuid primary key default uuid_generate_v4(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  affiliation_id  uuid not null references affiliation(id) on delete cascade,
  person_id       uuid not null references person(id) on delete cascade,
  period          text not null check (period in ('annual','term','monthly')),
  method          text not null check (method in ('card','direct_debit')),
  provider        text not null,
  provider_ref    text not null,
  label           text not null,
  status          text not null default 'active' check (status in ('active','paused','cancelled')),
  failures        smallint not null default 0,
  next_attempt_on date,
  last_error      text,
  agreed_by       uuid references account(id),
  agreed_at       timestamptz not null default now(),
  cancelled_at    timestamptz,
  cancelled_by    uuid references account(id)
);
create unique index if not exists payment_agreement_one_live on payment_agreement (affiliation_id) where status <> 'cancelled';
create index if not exists payment_agreement_org on payment_agreement (organisation_id, status);
