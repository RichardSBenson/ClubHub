-- 047 — API tokens and webhooks.
-- applied-when: select exists (select 1 from information_schema.tables where table_name = 'api_token')

create table if not exists api_token (
  id              uuid primary key default uuid_generate_v4(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  name            text not null check (char_length(name) between 2 and 80),
  prefix          text not null,
  token_hash      text not null unique,
  scopes          text[] not null,
  created_by      uuid references account(id),
  created_at      timestamptz not null default now(),
  last_used_at    timestamptz,
  revoked_at      timestamptz
);
create index if not exists api_token_org on api_token (organisation_id);

create table if not exists webhook_endpoint (
  id              uuid primary key default uuid_generate_v4(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  url             text not null check (char_length(url) <= 500),
  secret          text not null,
  events          text[] not null,
  active          boolean not null default true,
  disabled_at     timestamptz,
  disabled_reason text,
  consecutive_failures integer not null default 0,
  created_by      uuid references account(id),
  created_at      timestamptz not null default now()
);
create index if not exists webhook_endpoint_org on webhook_endpoint (organisation_id);

create table if not exists webhook_delivery (
  id              uuid primary key default uuid_generate_v4(),
  endpoint_id     uuid not null references webhook_endpoint(id) on delete cascade,
  event           text not null,
  payload         jsonb not null,
  status          text not null default 'pending' check (status in ('pending','delivered','failed')),
  attempts        smallint not null default 0,
  next_attempt_at timestamptz default now(),
  last_status     integer,
  last_error      text,
  created_at      timestamptz not null default now(),
  delivered_at    timestamptz
);
create index if not exists webhook_delivery_due on webhook_delivery (status, next_attempt_at);
create index if not exists webhook_delivery_endpoint on webhook_delivery (endpoint_id, created_at desc);
