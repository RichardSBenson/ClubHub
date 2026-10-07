-- 046 — push notifications: the devices that have said yes.
-- applied-when: select exists (select 1 from information_schema.tables where table_name = 'push_subscription')

create table if not exists push_subscription (
  id          uuid primary key default uuid_generate_v4(),
  account_id  uuid not null references account(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_sent_at timestamptz,
  failures    smallint not null default 0
);
create index if not exists push_subscription_account on push_subscription (account_id);
