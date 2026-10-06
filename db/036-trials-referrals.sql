-- applied-when: select exists (select 1 from information_schema.tables where table_name = 'member_trial')

-- ===========================================================================
--  Adult free trials and referrals
--
--  A trial is a real person on a real membership, flagged 'trial'. Joining is then a change of
--  status on the same rows, never a second person. A trial person has no member number until
--  they join, so a month of curiosity never uses one up.
-- ===========================================================================

alter table affiliation drop constraint if exists affiliation_status_check;
alter table affiliation add constraint affiliation_status_check
  check (status in ('pending','active','lapsed','suspended','resigned','trial'));

create table member_trial (
  id              uuid primary key default uuid_generate_v4(),
  person_id       uuid not null references person(id) on delete cascade,
  organisation_id uuid not null references organisation(id) on delete cascade,
  starts          date not null,
  ends            date not null,
  status          text not null default 'trialling' check (status in ('trialling','converted','ended')),
  source          text not null default 'website' check (source in ('website','referral')),
  consent_by      text not null,
  consent_at      timestamptz not null default now(),
  sent_week       timestamptz,                       -- the “a week left” email
  sent_last_days  timestamptz,                       -- the “last couple of days” email
  converted_at    timestamptz,
  ended_at        timestamptz,
  ip_hash         text,
  created_at      timestamptz not null default now(),
  unique (person_id, organisation_id)
);
create index on member_trial (organisation_id, status, ends);
create index on member_trial (ip_hash, created_at) where ip_hash is not null;

-- A member's own code, made the first time they ask for it.
create table referral_code (
  person_id  uuid primary key references person(id) on delete cascade,
  code       text not null unique,
  created_at timestamptz not null default now()
);

create table referral (
  id              uuid primary key default uuid_generate_v4(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  referrer_id     uuid not null references person(id) on delete cascade,
  referred_id     uuid not null unique references person(id) on delete cascade,   -- a person is referred once
  code            text not null,
  status          text not null default 'trial' check (status in ('trial','member','rewarded','void')),
  note            text,                              -- why it is void, or why it has not yet earned a reward
  created_at      timestamptz not null default now(),
  converted_at    timestamptz,
  rewarded_at     timestamptz
);
create index on referral (organisation_id, status);
create index on referral (referrer_id, rewarded_at);

create table referral_reward (
  id          uuid primary key default uuid_generate_v4(),
  referral_id uuid not null references referral(id) on delete cascade,
  person_id   uuid not null references person(id) on delete cascade,        -- who it is for
  kind        text not null,
  weeks       int not null default 0,
  cents       int not null default 0,
  note        text,
  status      text not null default 'owed' check (status in ('owed','given')),
  given_at    timestamptz,
  given_by    uuid references account(id),
  notified_at timestamptz,                           -- the email telling them, sent by the daily run
  created_at  timestamptz not null default now()
);
create index on referral_reward (person_id, status);
