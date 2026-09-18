-- ===========================================================================
--  HONBU — federation platform schema
--  Postgres 15+ / Supabase
--
--  Design rules:
--   1. Organisations are a TREE of arbitrary depth, not four fixed levels.
--   2. You can see DOWN your own branch. Never sideways into a sibling.
--   3. Grading history belongs to the PERSON, not to the dojo.
--   4. Money moves by invoice between levels, not by splitting a card payment.
--   5. Every public page is a projection of this data, not a separate CMS.
-- ===========================================================================

create extension if not exists "uuid-ossp";
create extension if not exists ltree;          -- fast ancestor/descendant queries
create extension if not exists citext;

-- ---------------------------------------------------------------------------
-- ORGANISATIONS
-- ---------------------------------------------------------------------------

create type org_type as enum ('international','country','region','dojo');

create table organisation (
  id            uuid primary key default uuid_generate_v4(),
  parent_id     uuid references organisation(id) on delete restrict,
  type          org_type    not null,
  name          text        not null,
  short_name    text,
  slug          text        not null,              -- 'whanganui'
  path          ltree       not null,              -- 'moknz.whanganui' — ancestry
  country_code  char(2),                           -- ISO 3166-1
  timezone      text        not null default 'Pacific/Auckland',
  founded       date,
  status        text        not null default 'active'
                check (status in ('active','dormant','closed','pending')),
  settings      jsonb       not null default '{}', -- inherited unless overridden
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (parent_id, slug)
);

create index on organisation using gist (path);
create index on organisation (parent_id);
create index on organisation (type);

-- A dojo's public detail. Separate table so the org table stays small and the
-- website can be generated from here without touching governance data.
create table dojo_profile (
  organisation_id uuid primary key references organisation(id) on delete cascade,
  venue_name      text,
  address_line    text,
  suburb          text,
  city            text,
  postcode        text,
  latitude        numeric(9,6),
  longitude       numeric(9,6),
  directions      text,                            -- "park at the back, side door"
  phone           text,
  email           citext,
  blurb           text,                            -- the operator's own words
  who_trains      text,                            -- "mostly families, a few shift workers"
  first_class_free boolean not null default true,
  accepts_beginners boolean not null default true,
  published       boolean not null default false,  -- never publish a half-filled page
  updated_at      timestamptz not null default now()
);

create table training_session (
  id              uuid primary key default uuid_generate_v4(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  label           text not null,                   -- 'Juniors, 6-12 years'
  weekday         smallint not null check (weekday between 0 and 6),
  starts          time not null,
  ends            time not null,
  min_age         smallint,
  max_age         smallint,
  min_grade_id    uuid,                            -- fk added after grade table
  notes           text,
  sort_order      smallint not null default 0
);

-- ---------------------------------------------------------------------------
-- PEOPLE
-- ---------------------------------------------------------------------------

create table person (
  id              uuid primary key default uuid_generate_v4(),
  -- permanent, global, never reissued. display_number is the human-facing one.
  display_number  text unique,                     -- 'NZ-0417'
  first_name      text not null,
  last_name       text not null,
  preferred_name  text,
  date_of_birth   date,                            -- age is DERIVED, never stored
  gender          text,
  email           citext,
  phone           text,
  photo_asset_id  uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index on person (last_name, first_name);
create index on person (email);

-- Sensitive detail, split out so the international tier can be denied it by
-- policy AND by permission. See docs/data-sovereignty.md
create table person_private (
  person_id       uuid primary key references person(id) on delete cascade,
  address_line    text,
  suburb          text,
  city            text,
  postcode        text,
  emergency_name  text,
  emergency_phone text,
  medical_notes   text,
  updated_at      timestamptz not null default now()
);

-- Dated history. A person can move dojo, region or country; every appearance
-- is kept.
create table affiliation (
  id              uuid primary key default uuid_generate_v4(),
  person_id       uuid not null references person(id) on delete cascade,
  organisation_id uuid not null references organisation(id) on delete restrict,
  role            text not null default 'member'
                  check (role in ('member','instructor','assistant','official','supporter')),
  starts          date not null,
  ends            date,                            -- null = current
  status          text not null default 'active'
                  check (status in ('pending','active','lapsed','suspended','resigned')),
  paid_until      date,
  notes           text,
  created_at      timestamptz not null default now()
);

create index on affiliation (person_id);
create index on affiliation (organisation_id, status);
create unique index one_current_dojo
  on affiliation (person_id) where ends is null and role = 'member';

-- ---------------------------------------------------------------------------
-- RANK
-- ---------------------------------------------------------------------------

-- Each federation defines its own ladder. Kyu count down, dan count up.
create table grade (
  id              uuid primary key default uuid_generate_v4(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  label           text not null,                   -- '8th kyu'
  short_label     text,                            -- '8k'
  belt_colour     text,                            -- '#D8B21E'
  belt_stripes    smallint not null default 0,
  rank_order      smallint not null,               -- 1 = lowest. THE sort key.
  is_dan          boolean not null default false,
  min_months_at_previous smallint,
  min_age         smallint,
  min_sessions    smallint,                        -- attendance requirement
  syllabus        jsonb not null default '{}',
  unique (organisation_id, rank_order)
);

alter table training_session
  add constraint training_session_min_grade_fk
  foreign key (min_grade_id) references grade(id) on delete set null;

-- WHO MAY AWARD WHAT. The feature nobody else has.
create table grade_authority (
  id                uuid primary key default uuid_generate_v4(),
  organisation_id   uuid not null references organisation(id) on delete cascade,
  from_rank_order   smallint not null,
  to_rank_order     smallint not null,
  awarded_by_type   org_type not null,             -- who may run the grading
  ratified_by_type  org_type,                      -- who signs it off after
  min_panel_size    smallint not null default 1,
  min_panel_rank    smallint,                      -- examiners must be >= this
  check (to_rank_order >= from_rank_order)
);

-- The register. Dated, permanent, belongs to the person.
create table grading_record (
  id                uuid primary key default uuid_generate_v4(),
  person_id         uuid not null references person(id) on delete restrict,
  grade_id          uuid not null references grade(id) on delete restrict,
  awarded_on        date not null,
  awarded_by_org    uuid not null references organisation(id) on delete restrict,
  event_id          uuid,                          -- fk added after event table
  result            text not null default 'pass'
                    check (result in ('pass','provisional','fail','withdrawn')),
  panel             jsonb not null default '[]',   -- [{person_id, grade, role}]
  ratified_on       date,
  ratified_by_org   uuid references organisation(id),
  certificate_no    text,
  certificate_asset_id uuid,
  notes             text,
  created_at        timestamptz not null default now()
);

create index on grading_record (person_id, awarded_on desc);
create index on grading_record (awarded_by_org, awarded_on desc);

-- Attendance, because eligibility depends on it.
create table attendance (
  id              uuid primary key default uuid_generate_v4(),
  person_id       uuid not null references person(id) on delete cascade,
  organisation_id uuid not null references organisation(id) on delete cascade,
  session_date    date not null,
  session_id      uuid references training_session(id) on delete set null,
  recorded_by     uuid references person(id),
  unique (person_id, organisation_id, session_date, session_id)
);

create index on attendance (person_id, session_date desc);

-- Current grade, derived. Never stored on the person.
create view person_current_grade as
select distinct on (gr.person_id)
  gr.person_id, gr.grade_id, g.label, g.rank_order, g.is_dan,
  gr.awarded_on, gr.awarded_by_org
from grading_record gr
join grade g on g.id = gr.grade_id
where gr.result in ('pass','provisional')
order by gr.person_id, g.rank_order desc, gr.awarded_on desc;

-- ---------------------------------------------------------------------------
-- EVENTS
-- ---------------------------------------------------------------------------

create type event_kind as enum
  ('grading','tournament','camp','seminar','fight_night','training','social','other');

create type event_visibility as enum
  ('public','members','own_org','by_grade','invite');

create table event (
  id              uuid primary key default uuid_generate_v4(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  kind            event_kind not null,
  title           text not null,
  slug            text not null,
  summary         text,
  body            jsonb,                           -- editor document
  starts_at       timestamptz not null,
  ends_at         timestamptz,
  all_day         boolean not null default false,
  venue_name      text,
  address_line    text,
  latitude        numeric(9,6),
  longitude       numeric(9,6),

  visibility      event_visibility not null default 'public',
  min_rank_order  smallint,                        -- dan-only seminars
  max_rank_order  smallint,
  min_age         smallint,
  max_age         smallint,

  -- syndication, both directions, explicitly controlled
  publish_down    boolean not null default false,  -- appears on descendants' sites
  publish_up      boolean not null default false,  -- requested onto ancestor calendar
  publish_up_state text not null default 'none'
                  check (publish_up_state in ('none','requested','approved','declined')),

  entries_open    timestamptz,
  entries_close   timestamptz,
  capacity        smallint,
  status          text not null default 'draft'
                  check (status in ('draft','published','cancelled','completed')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organisation_id, slug)
);

create index on event (organisation_id, starts_at desc);
create index on event (kind, starts_at desc);

alter table grading_record
  add constraint grading_record_event_fk
  foreign key (event_id) references event(id) on delete set null;

-- Fees can differ by who you are: member vs open entrant, junior vs adult.
create table event_fee (
  id          uuid primary key default uuid_generate_v4(),
  event_id    uuid not null references event(id) on delete cascade,
  label       text not null,                       -- 'Junior kumite'
  amount_cents integer not null,
  currency    char(3) not null default 'NZD',
  members_only boolean not null default false,
  min_age     smallint,
  max_age     smallint
);

-- Entries. Deliberately allows a person_id OR a guest, because our tournaments
-- are open to people with no record.
create table event_entry (
  id            uuid primary key default uuid_generate_v4(),
  event_id      uuid not null references event(id) on delete cascade,
  person_id     uuid references person(id) on delete set null,
  guest         jsonb,                             -- name, club, style, grade claim
  fee_id        uuid references event_fee(id),
  divisions     text[],                            -- 'kumite','kata'
  weight_kg     numeric(5,2),
  height_cm     smallint,
  years_training smallint,
  prior_events  smallint,
  declared_grade text,                             -- unverified, for outside entrants
  club_name     text,                              -- normalised before the draw
  waiver_ok     boolean not null default false,
  guardian      jsonb,                             -- name + contact, under 18s
  status        text not null default 'entered'
                check (status in ('entered','confirmed','withdrawn','disqualified')),
  paid          boolean not null default false,
  created_at    timestamptz not null default now(),
  check (person_id is not null or guest is not null)
);

create index on event_entry (event_id, status);

-- ---------------------------------------------------------------------------
-- MONEY — invoices between levels, not split card payments
-- ---------------------------------------------------------------------------

create table fee_schedule (
  id              uuid primary key default uuid_generate_v4(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  label           text not null,
  amount_cents    integer not null,
  currency        char(3) not null default 'NZD',
  period          text not null default 'annual'
                  check (period in ('annual','term','monthly','once')),
  applies_to      text not null default 'member'
                  check (applies_to in ('member','junior','adult','family','dojo')),
  effective_from  date not null,
  effective_to    date
);

create table invoice (
  id              uuid primary key default uuid_generate_v4(),
  from_org        uuid not null references organisation(id) on delete restrict,
  to_org          uuid not null references organisation(id) on delete restrict,
  period_start    date not null,
  period_end      date not null,
  currency        char(3) not null default 'NZD',
  subtotal_cents  integer not null default 0,
  status          text not null default 'draft'
                  check (status in ('draft','sent','paid','overdue','void')),
  issued_on       date,
  due_on          date,
  paid_on         date,
  reference       text,
  created_at      timestamptz not null default now()
);

-- Every line traceable to a person, so both sides can audit it.
create table invoice_line (
  id            uuid primary key default uuid_generate_v4(),
  invoice_id    uuid not null references invoice(id) on delete cascade,
  person_id     uuid references person(id) on delete set null,
  description   text not null,
  quantity      integer not null default 1,
  unit_cents    integer not null
);

create table payment (
  id            uuid primary key default uuid_generate_v4(),
  organisation_id uuid not null references organisation(id),
  person_id     uuid references person(id),
  invoice_id    uuid references invoice(id),
  event_entry_id uuid references event_entry(id),
  amount_cents  integer not null,
  currency      char(3) not null default 'NZD',
  provider      text not null default 'stripe',
  provider_ref  text,
  status        text not null default 'pending'
                check (status in ('pending','succeeded','failed','refunded')),
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- CONTENT — the site is a projection of the data, plus a small authored layer
-- ---------------------------------------------------------------------------

create table page (
  id              uuid primary key default uuid_generate_v4(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  slug            text not null,
  title           text not null,
  meta_title      text,
  meta_description text,
  body            jsonb not null default '{}',     -- block editor document
  template        text not null default 'standard',
  status          text not null default 'draft'
                  check (status in ('draft','published','archived')),
  published_at    timestamptz,
  updated_by      uuid references person(id),
  updated_at      timestamptz not null default now(),
  unique (organisation_id, slug)
);

create table article (
  id              uuid primary key default uuid_generate_v4(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  slug            text not null,                   -- keyword slug, never numeric
  title           text not null,
  summary         text,
  body            jsonb not null default '{}',
  hero_asset_id   uuid,
  tags            text[] not null default '{}',
  about_org_id    uuid references organisation(id), -- 'this post is about Whanganui'
  publish_down    boolean not null default true,
  publish_up      boolean not null default false,
  status          text not null default 'draft'
                  check (status in ('draft','review','published','archived')),
  published_at    timestamptz,
  author_id       uuid references person(id),
  unique (organisation_id, slug)
);

create index on article (organisation_id, published_at desc);
create index on article using gin (tags);

create table asset (
  id              uuid primary key default uuid_generate_v4(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  kind            text not null default 'image',
  storage_key     text not null,
  filename        text,
  mime            text,
  width           smallint,
  height          smallint,
  bytes           integer,
  alt_text        text,
  credit          text,
  consent_ref     text,                            -- photo permission on file
  created_at      timestamptz not null default now()
);

-- Brand tokens, generated from the crest at onboarding. One row per org;
-- descendants inherit unless they have their own.
create table brand (
  organisation_id uuid primary key references organisation(id) on delete cascade,
  crest_asset_id  uuid references asset(id),
  tokens          jsonb not null default '{}',     -- see packages/brand
  theme           text not null default 'classic',
  fonts           jsonb not null default '{}',
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- ACCESS
-- ---------------------------------------------------------------------------

create type role_name as enum
  ('owner','administrator','registrar','instructor','contributor','member');

create table account (
  id            uuid primary key default uuid_generate_v4(),
  person_id     uuid unique references person(id) on delete cascade,
  email         citext unique not null,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now()
);

-- Granted at a node, effective for that node and everything beneath it.
create table grant_role (
  id              uuid primary key default uuid_generate_v4(),
  account_id      uuid not null references account(id) on delete cascade,
  organisation_id uuid not null references organisation(id) on delete cascade,
  role            role_name not null,
  granted_by      uuid references account(id),
  granted_at      timestamptz not null default now(),
  unique (account_id, organisation_id, role)
);

-- Does this account hold `role` at or above `org`?
create or replace function has_role_at(
  p_account uuid, p_org uuid, p_roles role_name[]
) returns boolean language sql stable as $$
  select exists (
    select 1
    from grant_role gr
    join organisation granted on granted.id = gr.organisation_id
    join organisation target  on target.id  = p_org
    where gr.account_id = p_account
      and gr.role = any(p_roles)
      and target.path <@ granted.path        -- target is at or below the grant
  );
$$;

-- Every organisation this account can act on.
create or replace function visible_orgs(p_account uuid)
returns table (organisation_id uuid) language sql stable as $$
  select o.id
  from organisation o
  join organisation granted on o.path <@ granted.path
  join grant_role gr on gr.organisation_id = granted.id
  where gr.account_id = p_account
  group by o.id;
$$;

-- ---------------------------------------------------------------------------
-- AUDIT — federations argue about records. Keep everything.
-- ---------------------------------------------------------------------------

create table audit_log (
  id            bigserial primary key,
  account_id    uuid references account(id),
  organisation_id uuid references organisation(id),
  entity        text not null,
  entity_id     uuid,
  action        text not null,
  before        jsonb,
  after         jsonb,
  at            timestamptz not null default now()
);

create index on audit_log (entity, entity_id, at desc);
create index on audit_log (organisation_id, at desc);

-- see db/002-revisions.sql
