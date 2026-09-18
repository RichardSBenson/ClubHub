-- ===========================================================================
--  Auth
--
--  No passwords. Volunteer-run organisations forget them, and a password reset
--  flow is a support burden nobody signed up for. Emailed sign-in links only.
--
--  Nothing here stores a usable secret: links and sessions are stored as
--  SHA-256 hashes, so a database dump does not let anyone sign in.
-- ===========================================================================

create table login_link (
  id           uuid primary key default uuid_generate_v4(),
  account_id   uuid not null references account(id) on delete cascade,
  token_hash   text not null unique,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  used_at      timestamptz,
  requested_ip inet,
  -- where to land them after sign-in
  redirect_to  text
);

create index on login_link (account_id, created_at desc);

create table session (
  id            uuid primary key default uuid_generate_v4(),
  account_id    uuid not null references account(id) on delete cascade,
  token_hash    text not null unique,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  last_seen_at  timestamptz not null default now(),
  user_agent    text,
  ip            inet,
  revoked_at    timestamptz
);

create index on session (account_id, created_at desc);
create index on session (expires_at) where revoked_at is null;

-- Rate limiting. A sign-in form that emails anyone is a spam cannon otherwise.
create table login_attempt (
  id          bigserial primary key,
  email       citext not null,
  ip          inet,
  at          timestamptz not null default now(),
  outcome     text not null check (outcome in ('sent','unknown_email','rate_limited'))
);

create index on login_attempt (email, at desc);
create index on login_attempt (ip, at desc);
