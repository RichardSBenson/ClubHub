-- ===========================================================================
--  HONBU — complete database setup
--
--  Paste this whole file into the Neon SQL editor and run it once, on an
--  empty database. It creates every table, applies every migration in order,
--  and loads MOKNZ as customer zero.
--
--  Safe to run once. Running it a second time will fail on the first
--  "create table" — that is the protection against running it twice by
--  accident, not a bug.
--
--  DEMO DATA: the four people in this file (Doug, Tane, Aroha, Mia) are
--  test records with invented dates of birth and example.nz email addresses.
--  They exist so the admin has something to show. Replace them with real
--  members through the importer, not by editing this file.
-- ===========================================================================


-- ============================================================
--  schema.sql
-- ============================================================

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


-- ============================================================
--  002-revisions.sql
-- ============================================================

-- Page and article revisions. Federations argue about who changed what.

create table page_revision (
  id          uuid primary key default uuid_generate_v4(),
  page_id     uuid not null references page(id) on delete cascade,
  title       text not null,
  body        jsonb not null,
  meta_title  text,
  meta_description text,
  saved_by    uuid references person(id),
  saved_at    timestamptz not null default now(),
  note        text
);
create index on page_revision (page_id, saved_at desc);

-- Keep the last 20 revisions per page; beyond that, history stops being useful
-- and starts being storage.
create or replace function trim_page_revisions() returns trigger
language plpgsql as $$
begin
  delete from page_revision
  where page_id = new.page_id
    and id not in (
      select id from page_revision where page_id = new.page_id
      order by saved_at desc limit 20);
  return null;
end $$;

create trigger page_revision_trim after insert on page_revision
for each row execute function trim_page_revisions();

-- ============================================================
--  003-auth.sql
-- ============================================================

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

-- ============================================================
--  004-routing.sql
-- ============================================================

-- ===========================================================================
--  Routing lives in the register, not in code.
--
--  Renaming a dojo slug, retiring a page, or absorbing one dojo into another
--  must not break every link pointing at the old path. In a hand-rolled JS
--  stack this is the thing nobody builds until it has already cost them.
-- ===========================================================================

create table redirect (
  id          uuid primary key default uuid_generate_v4(),
  from_path   text not null unique,
  to_path     text not null,
  permanent   boolean not null default true,
  reason      text,
  created_at  timestamptz not null default now(),
  hits        integer not null default 0,
  last_hit_at timestamptz,
  check (from_path <> to_path),
  check (from_path like '/%' and to_path like '/%')
);

-- Renaming an organisation's slug writes its own redirect. Nobody has to
-- remember.
create or replace function organisation_slug_redirect() returns trigger
language plpgsql as $$
begin
  if new.slug is distinct from old.slug then
    insert into redirect (from_path, to_path, permanent, reason)
    values ('/' || old.slug, '/' || new.slug, true,
            format('%s renamed %s to %s', now()::date, old.slug, new.slug))
    on conflict (from_path) do update
      set to_path = excluded.to_path, reason = excluded.reason;

    -- Any redirect that used to point at the old slug now points at the new one,
    -- so chains never form.
    update redirect set to_path = '/' || new.slug
    where to_path = '/' || old.slug and from_path <> '/' || new.slug;
  end if;
  return new;
end $$;

create trigger organisation_slug_moved
after update of slug on organisation
for each row execute function organisation_slug_redirect();

-- Same for authored pages.
create or replace function page_slug_redirect() returns trigger
language plpgsql as $$
begin
  if new.slug is distinct from old.slug then
    insert into redirect (from_path, to_path, permanent, reason)
    values ('/' || old.slug, '/' || new.slug, true, 'page renamed')
    on conflict (from_path) do update set to_path = excluded.to_path;
  end if;
  return new;
end $$;

create trigger page_slug_moved
after update of slug on page
for each row execute function page_slug_redirect();

-- Every internal link an editor writes, so a broken one can be found before a
-- visitor does. Populated by the site build.
create table internal_link (
  id            uuid primary key default uuid_generate_v4(),
  from_kind     text not null,          -- 'page' | 'article' | 'dojo'
  from_id       uuid not null,
  to_path       text not null,
  resolved      boolean,
  checked_at    timestamptz,
  unique (from_kind, from_id, to_path)
);

create index on internal_link (resolved) where resolved is false;

-- ============================================================
--  005-titles-and-quals.sql
-- ============================================================

-- ===========================================================================
--  Titles and qualifications
--
--  Rank is not the only thing a federation records, and this was a real gap:
--  MOKNZ's own leadership could not be represented.
--
--  Hanshi Doug Holloway is 8th dan AND Hanshi. Kyoshi Mike Kenworthy is 7th
--  dan AND Kyoshi. Shogo (Renshi, Kyoshi, Hanshi) are teaching titles awarded
--  separately from grade — you can hold 7th dan without being Kyoshi. Kendo,
--  iaido, kyudo and most Japanese arts work the same way.
--
--  Qualifications are different again: they EXPIRE. A referee licence, a first
--  aid certificate, a police vet. Rank never lapses; these do, and a federation
--  needs to know whose has.
-- ===========================================================================

create table title (
  id              uuid primary key default uuid_generate_v4(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  label           text not null,                 -- 'Hanshi'
  short_label     text,
  rank_order      smallint not null,             -- Renshi 1, Kyoshi 2, Hanshi 3
  min_grade_order smallint,                      -- usually requires a dan grade
  description     text,
  unique (organisation_id, rank_order)
);

create table title_award (
  id              uuid primary key default uuid_generate_v4(),
  person_id       uuid not null references person(id) on delete restrict,
  title_id        uuid not null references title(id) on delete restrict,
  awarded_on      date not null,
  awarded_by_org  uuid not null references organisation(id) on delete restrict,
  certificate_no  text,
  notes           text,
  created_at      timestamptz not null default now()
);

create index on title_award (person_id, awarded_on desc);

-- Highest title held. Like grade, derived — never a column on the person.
create view person_current_title as
select distinct on (ta.person_id)
  ta.person_id, t.id as title_id, t.label, t.short_label, t.rank_order,
  ta.awarded_on
from title_award ta
join title t on t.id = ta.title_id
order by ta.person_id, t.rank_order desc, ta.awarded_on desc;

-- ---------------------------------------------------------------------------
-- qualifications — these expire, and that is the whole point
-- ---------------------------------------------------------------------------

create table qualification (
  id              uuid primary key default uuid_generate_v4(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  code            text not null,                 -- 'referee-a', 'first-aid'
  label           text not null,
  category        text not null default 'other'
                  check (category in ('instructing','officiating','safety',
                                      'safeguarding','medical','other')),
  valid_months    smallint,                      -- null = never expires
  required_for    text[] not null default '{}',  -- 'instruct','judge','panel'
  unique (organisation_id, code)
);

create table qualification_award (
  id              uuid primary key default uuid_generate_v4(),
  person_id       uuid not null references person(id) on delete cascade,
  qualification_id uuid not null references qualification(id) on delete restrict,
  awarded_on      date not null,
  expires_on      date,                          -- set from valid_months
  issued_by_org   uuid references organisation(id),
  issued_by_other text,                          -- 'NZ Red Cross'
  reference       text,
  document_asset_id uuid,
  created_at      timestamptz not null default now()
);

create index on qualification_award (person_id);
create index on qualification_award (expires_on)
  where expires_on is not null;

-- Fill the expiry from the qualification's own validity period, so nobody has
-- to work it out by hand.
create or replace function set_qualification_expiry() returns trigger
language plpgsql as $$
declare months smallint;
begin
  if new.expires_on is null then
    select valid_months into months from qualification where id = new.qualification_id;
    if months is not null then
      new.expires_on := new.awarded_on + (months || ' months')::interval;
    end if;
  end if;
  return new;
end $$;

create trigger qualification_expiry
before insert or update on qualification_award
for each row execute function set_qualification_expiry();

-- What is current, what has lapsed, and what lapses soon. The query a
-- registrar actually runs.
create view qualification_status as
select qa.person_id, q.code, q.label, q.category, q.required_for,
       qa.awarded_on, qa.expires_on,
       case
         when qa.expires_on is null then 'permanent'
         when qa.expires_on < current_date then 'expired'
         when qa.expires_on < current_date + 60 then 'expiring'
         else 'current'
       end as status,
       qa.expires_on - current_date as days_left
from qualification_award qa
join qualification q on q.id = qa.qualification_id;

-- ============================================================
--  006-publishing.sql
-- ============================================================

-- ===========================================================================
--  Publishing
--
--  A publication has an identity and a version. The system can answer "what is
--  live right now, and which revision is it" without regenerating anything.
--
--  Publications are never edited. Publishing again creates a new row and marks
--  the old one superseded — which is what makes rollback ordinary and gives a
--  cache adapter something honest to work from.
-- ===========================================================================

create table publication (
  id              uuid primary key default uuid_generate_v4(),
  entry_id        uuid not null,
  entry_kind      text not null check (entry_kind in ('page','article','dojo','event')),
  revision_id     uuid not null,
  path            text not null,
  locale          text not null default 'en-NZ',
  organisation_id uuid not null references organisation(id) on delete cascade,
  status          text not null default 'live'
                  check (status in ('scheduled','live','superseded','withdrawn')),
  published_at    date,
  scheduled_for   date,
  published_by    uuid references account(id),
  superseded_at   date,
  withdrawn_at    date,
  created_at      timestamptz not null default now(),

  check (path like '/%'),
  check (status <> 'scheduled' or scheduled_for is not null)
);

-- One live publication per entry per locale. The database enforces it, not the
-- application — because two code paths publishing at once is exactly when it
-- would otherwise go wrong.
create unique index one_live_per_entry
  on publication (entry_id, locale) where status = 'live';

-- And one live publication per path per locale. Two pages cannot share a URL.
create unique index one_live_per_path
  on publication (path, locale) where status = 'live';

create index on publication (entry_id, created_at desc);
create index on publication (scheduled_for) where status = 'scheduled';
create index on publication (organisation_id, status);

-- What is live, for the site build. One row per path.
create view live_publication as
select p.*, o.slug as organisation_slug
from publication p
join organisation o on o.id = p.organisation_id
where p.status = 'live';

-- ---------------------------------------------------------------------------
-- domain events, kept
-- ---------------------------------------------------------------------------

-- The domain announces; adapters subscribe. Storing them means a failed
-- subscriber can be retried, and that "why did that page change" has an answer.
create table domain_event (
  id            bigserial primary key,
  name          text not null,
  payload       jsonb not null,
  occurred_at   timestamptz not null default now(),
  handled_at    timestamptz,
  attempts      smallint not null default 0,
  last_error    text
);

create index on domain_event (name, occurred_at desc);
create index on domain_event (occurred_at) where handled_at is null;

-- ============================================================
--  007-rebuild-queue.sql
-- ============================================================

-- Pages that need regenerating. The build reads this instead of rebuilding
-- everything, which is what stops a bulk edit becoming a wave of work.

create table rebuild_queue (
  path       text primary key,
  reason     text,
  queued_at  timestamptz not null default now(),
  built_at   timestamptz
);

create index on rebuild_queue (queued_at) where built_at is null;

-- ============================================================
--  008-content-types.sql
-- ============================================================

-- ===========================================================================
--  Content types
--
--  A federation defines what kinds of thing it publishes. Instructor, Kata,
--  Technique, Sponsor — none of which a developer should have to add.
--
--  Types are per organisation and inherited down the tree, so a national body
--  can define "Instructor" once and every dojo uses it.
-- ===========================================================================

create table content_type (
  id              uuid primary key default uuid_generate_v4(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  name            text not null,
  label           text not null,
  plural_label    text,
  route_pattern   text not null default 'underType'
                  check (route_pattern in ('underType','topLevel',
                                           'underOrganisation','none')),
  title_field     text not null default 'title',
  slug_field      text,
  icon            text,
  described_as    text,
  schema_type     text,
  fields          jsonb not null default '[]',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organisation_id, name),
  check (name ~ '^[a-z][a-zA-Z0-9]*$')
);

create table content_entry (
  id              uuid primary key default uuid_generate_v4(),
  type_name       text not null,
  organisation_id uuid not null references organisation(id) on delete cascade,
  slug            text not null,
  values          jsonb not null default '{}',
  status          text not null default 'draft'
                  check (status in ('draft','review','published','archived')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organisation_id, type_name, slug),
  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

create index on content_entry (organisation_id, type_name, status);
create index on content_entry using gin (values);

-- Every save keeps a revision, like pages do. Publishing names one.
create table content_revision (
  id          uuid primary key default uuid_generate_v4(),
  entry_id    uuid not null references content_entry(id) on delete cascade,
  values      jsonb not null,
  saved_by    uuid references account(id),
  saved_at    timestamptz not null default now(),
  note        text
);

create index on content_revision (entry_id, saved_at desc);

-- Same cap as pages: twenty is history, beyond that is storage.
create or replace function trim_content_revisions() returns trigger
language plpgsql as $$
begin
  delete from content_revision
  where entry_id = new.entry_id
    and id not in (select id from content_revision
                   where entry_id = new.entry_id
                   order by saved_at desc limit 20);
  return null;
end $$;

create trigger content_revision_trim after insert on content_revision
for each row execute function trim_content_revisions();

-- ============================================================
--  009-title-conferral.sql
-- ============================================================

-- ===========================================================================
--  How a title is obtained is itself configuration
--
--  I had assumed every title is awarded separately, which is true of shogo
--  (Renshi, Kyoshi, Hanshi) and wrong of most others. In many organisations
--  Senpai, Sensei and Shihan are conferred by reaching a grade — nobody awards
--  them, you simply are one.
--
--  And the vocabulary is not Japanese. Korean arts use Sabeom, Kyosa,
--  Kwanjang. Chinese arts use Sifu and Sigung. Brazilian jiu-jitsu uses
--  Professor and Coach. Capoeira uses Mestre and Contramestre.
--
--  So: the titles are rows, and how each is obtained is a column.
-- ===========================================================================

alter table title
  add column conferred_by_rank boolean not null default false,
  add column max_grade_order smallint,
  add column address_as text;

comment on column title.conferred_by_rank is
  'true: held automatically by anyone at min_grade_order and above. '
  'false: awarded individually and recorded in title_award.';

comment on column title.max_grade_order is
  'For conferred titles that stop applying once someone outranks them — '
  'a 2nd dan is Sensei, a 5th dan is Shihan, and only one applies.';

comment on column title.address_as is
  'How the person is addressed in writing, if it differs from the label.';

-- Every title a person holds: conferred by grade, and awarded individually.
create or replace view person_title as
  -- conferred
  select cg.person_id, t.id as title_id, t.organisation_id, t.label,
         t.short_label, t.rank_order, t.address_as,
         'conferred'::text as how, null::date as awarded_on
  from person_current_grade cg
  join title t
    on t.conferred_by_rank
   and cg.rank_order >= coalesce(t.min_grade_order, 0)
   and (t.max_grade_order is null or cg.rank_order <= t.max_grade_order)
  union all
  -- awarded
  select ta.person_id, t.id, t.organisation_id, t.label, t.short_label,
         t.rank_order, t.address_as, 'awarded', ta.awarded_on
  from title_award ta
  join title t on t.id = ta.title_id;

-- The one to use when addressing someone: highest held, awarded beating
-- conferred at the same level because it was earned separately.
drop view if exists person_current_title;
create view person_current_title as
select distinct on (person_id)
  person_id, title_id, organisation_id, label, short_label, rank_order,
  address_as, how, awarded_on
from person_title
order by person_id, rank_order desc,
         (how = 'awarded') desc, awarded_on desc nulls last;

-- ============================================================
--  seed-moknz.sql
-- ============================================================

-- ===========================================================================
--  Seed: Mas Oyama Karate New Zealand — customer zero
--
--  Belt ladder is a PLACEHOLDER until the executive confirms MOKNZ's actual
--  kyu progression. Structure is right; colours and count may not be.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- the tree
-- ---------------------------------------------------------------------------

insert into organisation (id, parent_id, type, name, short_name, slug, path,
                          country_code, timezone, founded)
values ('11111111-1111-1111-1111-111111111111', null, 'country',
        'Mas Oyama Karate New Zealand', 'MOKNZ', 'moknz', 'moknz',
        'NZ', 'Pacific/Auckland', '1965-01-01');

insert into organisation (parent_id, type, name, slug, path, country_code, timezone)
select '11111111-1111-1111-1111-111111111111', 'dojo', name, slug,
       ('moknz.' || replace(slug,'-','_'))::ltree, 'NZ', 'Pacific/Auckland'
from (values
  ('Far North','far-north'), ('Auckland','auckland'), ('Gisborne','gisborne'),
  ('Inglewood','taranaki'), ('Stratford','stratford'), ('New Plymouth','new-plymouth'),
  ('Hawera','hawera'), ('Taumarunui','taumarunui'), ('Napier','napier'),
  ('Whanganui','whanganui'), ('Carterton','carterton'), ('Wellington','wellington'),
  ('Christchurch','christchurch'), ('Dunedin','dunedin'), ('Waikouaiti','waikouaiti'),
  ('Milton','milton')
) as d(name, slug);

-- Japan sits under MOKNZ but outside NZ payment rails.
insert into organisation (parent_id, type, name, slug, path, country_code, timezone)
values ('11111111-1111-1111-1111-111111111111', 'dojo', 'Japan Branch', 'japan',
        'moknz.japan', 'JP', 'Asia/Tokyo');

-- ---------------------------------------------------------------------------
-- the grade ladder  [PLACEHOLDER — confirm with the executive]
-- ---------------------------------------------------------------------------

insert into grade (organisation_id, label, short_label, belt_colour, belt_stripes,
                   rank_order, is_dan, min_months_at_previous, min_age, min_sessions)
select '11111111-1111-1111-1111-111111111111', label, short_label, colour, stripes,
       rank_order, is_dan, months, min_age, sessions
from (values
  ('10th kyu','10k','#F4F4F5',0, 1,false,null,null,null),
  ('9th kyu', '9k','#D9761F',0, 2,false,3,   5,   24),
  ('8th kyu', '8k','#D9761F',1, 3,false,3,   5,   24),
  ('7th kyu', '7k','#1F4E8C',0, 4,false,4,   6,   32),
  ('6th kyu', '6k','#1F4E8C',1, 5,false,4,   6,   32),
  ('5th kyu', '5k','#F0CE41',0, 6,false,6,   7,   48),
  ('4th kyu', '4k','#F0CE41',1, 7,false,6,   7,   48),
  ('3rd kyu', '3k','#2E6B33',0, 8,false,6,   8,   48),
  ('2nd kyu', '2k','#2E6B33',1, 9,false,6,   8,   48),
  ('1st kyu', '1k','#6B4322',0,10,false,12, 10,   96),
  ('Shodan',  '1d','#1C1C1E',1,11,true, 18, 16,  144),
  ('Nidan',   '2d','#1C1C1E',2,12,true, 24, 18,  192),
  ('Sandan',  '3d','#1C1C1E',3,13,true, 36, 21,  240),
  ('Yondan',  '4d','#1C1C1E',4,14,true, 48, 25,  288),
  ('Godan',   '5d','#1C1C1E',5,15,true, 60, 30,  336)
) as g(label, short_label, colour, stripes, rank_order, is_dan, months, min_age, sessions);

-- ---------------------------------------------------------------------------
-- who may award what — the rule nobody else models
-- ---------------------------------------------------------------------------

insert into grade_authority (organisation_id, from_rank_order, to_rank_order,
                             awarded_by_type, ratified_by_type,
                             min_panel_size, min_panel_rank)
values
  -- 10th to 4th kyu: the dojo grades, the country ratifies
  ('11111111-1111-1111-1111-111111111111', 1,  7, 'dojo',    'country', 1, 11),
  -- 3rd to 1st kyu: national grading
  ('11111111-1111-1111-1111-111111111111', 8, 10, 'country', 'country', 2, 12),
  -- dan grades: national panel of three, 4th dan or above
  ('11111111-1111-1111-1111-111111111111',11, 15, 'country', 'country', 3, 14);

-- ---------------------------------------------------------------------------
-- people
-- ---------------------------------------------------------------------------

insert into person (id, display_number, first_name, last_name, date_of_birth, gender, email)
values
 ('22222222-0000-0000-0000-000000000001','NZ-0001','Doug','Holloway','1945-03-12','M','doug@example.nz'),
 ('22222222-0000-0000-0000-000000000002','NZ-0417','Aroha','Nikora','2011-08-04','F','aroha@example.nz'),
 ('22222222-0000-0000-0000-000000000003','NZ-0288','Tane','Walker','1988-01-22','M','tane@example.nz'),
 ('22222222-0000-0000-0000-000000000004','NZ-0901','Mia','Chen','2017-06-30','F',null);

-- Aroha trains at Whanganui, Tane at Wellington, Mia at Whanganui.
insert into affiliation (person_id, organisation_id, role, starts, status, paid_until)
select p.id, o.id, r.role, r.starts, 'active', '2026-12-31'
from (values
  ('22222222-0000-0000-0000-000000000001','whanganui','instructor','1965-01-01'::date),
  ('22222222-0000-0000-0000-000000000002','whanganui','member',    '2019-02-01'::date),
  ('22222222-0000-0000-0000-000000000003','wellington','instructor','2004-05-01'::date),
  ('22222222-0000-0000-0000-000000000004','whanganui','member',    '2024-03-01'::date)
) as r(pid, slug, role, starts)
join person p on p.id = r.pid::uuid
join organisation o on o.slug = r.slug;

-- ---------------------------------------------------------------------------
-- gradings — history, not a current value
-- ---------------------------------------------------------------------------

insert into grading_record (person_id, grade_id, awarded_on, awarded_by_org, result)
select p.id, g.id, r.on_date, o.id, 'pass'
from (values
  -- Aroha's progression, dojo then national
  ('22222222-0000-0000-0000-000000000002','10th kyu','2019-06-15'::date,'whanganui'),
  ('22222222-0000-0000-0000-000000000002','9th kyu', '2019-12-07'::date,'whanganui'),
  ('22222222-0000-0000-0000-000000000002','8th kyu', '2020-06-20'::date,'whanganui'),
  ('22222222-0000-0000-0000-000000000002','7th kyu', '2021-06-19'::date,'whanganui'),
  ('22222222-0000-0000-0000-000000000002','6th kyu', '2022-06-18'::date,'whanganui'),
  ('22222222-0000-0000-0000-000000000002','5th kyu', '2023-06-17'::date,'moknz'),
  ('22222222-0000-0000-0000-000000000002','4th kyu', '2024-10-19'::date,'moknz'),
  -- Tane to nidan
  ('22222222-0000-0000-0000-000000000003','1st kyu', '2012-10-20'::date,'moknz'),
  ('22222222-0000-0000-0000-000000000003','Shodan',  '2014-10-18'::date,'moknz'),
  ('22222222-0000-0000-0000-000000000003','Nidan',   '2025-10-18'::date,'moknz'),
  -- Mia, one grading
  ('22222222-0000-0000-0000-000000000004','10th kyu','2024-09-21'::date,'whanganui'),
  -- Hanshi Doug
  ('22222222-0000-0000-0000-000000000001','Godan',   '1990-01-01'::date,'moknz')
) as r(pid, grade, on_date, org)
join person p on p.id = r.pid::uuid
join grade g on g.label = r.grade
join organisation o on o.slug = r.org;

-- attendance for Aroha, enough to matter
insert into attendance (person_id, organisation_id, session_date)
select '22222222-0000-0000-0000-000000000002', o.id, d::date
from organisation o,
     generate_series('2025-02-04'::date, '2026-09-01'::date, '3 days') d
where o.slug = 'whanganui'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- accounts and roles
-- ---------------------------------------------------------------------------

insert into account (id, person_id, email) values
 ('33333333-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001','doug@example.nz'),
 ('33333333-0000-0000-0000-000000000003','22222222-0000-0000-0000-000000000003','tane@example.nz');

-- Doug is owner at national level. Tane administers Wellington only.
insert into grant_role (account_id, organisation_id, role)
select '33333333-0000-0000-0000-000000000001', id, 'owner'
from organisation where slug = 'moknz';

insert into grant_role (account_id, organisation_id, role)
select '33333333-0000-0000-0000-000000000003', id, 'administrator'
from organisation where slug = 'wellington';

-- ---------------------------------------------------------------------------
-- an event that publishes down, and a dojo one that does not
-- ---------------------------------------------------------------------------

insert into event (organisation_id, kind, title, slug, starts_at, visibility,
                   publish_down, entries_close, status)
select id, 'grading', 'National kyu grading', 'national-kyu-grading-oct',
       '2026-10-17 09:00+13', 'public', true, '2026-10-03 23:59+13', 'published'
from organisation where slug = 'moknz';

insert into event (organisation_id, kind, title, slug, starts_at, visibility,
                   min_rank_order, publish_down, status)
select id, 'seminar', 'Black belt seminar', 'black-belt-seminar-nov',
       '2026-11-21 10:00+13', 'by_grade', 11, true, 'published'
from organisation where slug = 'moknz';

insert into event (organisation_id, kind, title, slug, starts_at, visibility,
                   publish_down, publish_up, status)
select id, 'fight_night', 'Dojo fight night', 'fight-night-sep',
       '2026-09-26 19:00+12', 'own_org', false, false, 'published'
from organisation where slug = 'whanganui';


-- ---------------------------------------------------------------------------
-- dojo detail — only Whanganui is complete, on purpose.
-- A page does not publish until its facts are in. Proving that is the point.
-- ---------------------------------------------------------------------------

insert into dojo_profile (organisation_id, venue_name, address_line, suburb, city,
                          postcode, latitude, longitude, directions, phone, email,
                          blurb, who_trains, published)
select o.id, d.venue, d.addr, d.suburb, d.city, d.pc, d.lat, d.lng, d.dir,
       d.phone, d.email, d.blurb, d.who, d.pub
from (values
  ('whanganui','Springvale Community Hall','21 Hadfield Street','Springvale',
   'Whanganui','4501', -39.9187, 175.0200,
   'Park at the back; come in the side door by the playground.',
   '+64 6 000 0000','whanganui@kyokushinkarate.co.nz',
   '[Two or three sentences from the dojo operator, in their own words.]',
   'Twelve active black belt instructors train and teach here.', true),
  ('christchurch',null,null,null,'Christchurch',null,null,null,
   null,null,null,null,null, false),
  ('new-plymouth',null,null,null,'New Plymouth',null,null,null,
   null,null,null,null,null, false)
) as d(slug,venue,addr,suburb,city,pc,lat,lng,dir,phone,email,blurb,who,pub)
join organisation o on o.slug = d.slug;

insert into training_session (organisation_id, label, weekday, starts, ends,
                              min_age, max_age, sort_order)
select o.id, t.label, t.wd, t.st::time, t.en::time, t.mn, t.mx, t.so
from (values
  ('whanganui','Juniors, 6-12 years', 2,'17:30','18:30', 6,12,1),
  ('whanganui','Juniors, 6-12 years', 4,'17:30','18:30', 6,12,2),
  ('whanganui','Seniors, 13 and over',2,'18:45','20:15',13,null,3),
  ('whanganui','Seniors, 13 and over',4,'18:45','20:15',13,null,4),
  ('whanganui','Open training',       6,'09:00','10:30',null,null,5)
) as t(slug,label,wd,st,en,mn,mx,so)
join organisation o on o.slug = t.slug;

-- brand tokens, as produced by packages/brand from the MOKNZ crest
insert into brand (organisation_id, tokens, theme, fonts)
select id, '{
  "primary":"#CE372C","primaryText":"#CE372C","primaryTextStrong":"#9A2A1F",
  "primaryHover":"#AC2E25","accent":"#F0CE41","neutral":"#BDBDBF",
  "ink":"#161617","inkSoft":"#252527","canvas":"#F5F5F5","canvasAlt":"#E3E3E3",
  "muted":"#6F6F72"
}'::jsonb, 'classic',
 '{"display":"Shippori Mincho","body":"Zen Kaku Gothic New"}'::jsonb
from organisation where slug = 'moknz';

-- a couple of authored pages and one news item
insert into page (organisation_id, slug, title, meta_title, meta_description,
                  body, status, published_at)
select id, 'about', 'About us',
  'About Mas Oyama Karate New Zealand',
  'Kyokushin karate in New Zealand since 1965, with a direct lineage through Sosai Mas Oyama.',
  '{"blocks":[{"type":"paragraph","text":"Hanshi Doug Holloway, 8th dan, set up the first Kyokushin karate dojo in New Zealand in 1965, after returning from Japan as a student of Sosai Mas Oyama."},{"type":"paragraph","text":"Kyokushin means the ultimate truth. It is taught here by people who learned it from the source."}]}'::jsonb,
  'published', now()
from organisation where slug = 'moknz';

insert into article (organisation_id, slug, title, summary, body, tags,
                     about_org_id, status, published_at)
select m.id, 'eleven-students-grade-to-8th-kyu',
  'Eleven students grade to 8th kyu',
  'The largest dojo grading since 2019, with four families testing together.',
  '{"blocks":[{"type":"paragraph","text":"Saturday''s grading was the largest the dojo has run since 2019."}]}'::jsonb,
  array['grading','whanganui'], w.id, 'published', now() - interval '11 days'
from organisation m, organisation w
where m.slug = 'moknz' and w.slug = 'whanganui';

commit;

-- ============================================================
--  seed-titles.sql
-- ============================================================

-- ===========================================================================
--  Titles — MOKNZ's vocabulary, as an example of configuration, not a default
--
--  Another federation types its own. Korean: Sabeom, Kyosa, Kwanjang.
--  Chinese: Sifu, Sigung. BJJ: Coach, Professor. Capoeira: Contramestre,
--  Mestre. None of it is in the code.
-- ===========================================================================

insert into title (organisation_id, label, short_label, rank_order,
                   min_grade_order, max_grade_order, conferred_by_rank,
                   address_as, description)
select o.id, t.label, t.short, t.ord, t.min_g, t.max_g, t.conferred, t.address,
       t.descr
from organisation o, (values
  -- Conferred by grade. Nobody awards these; you reach the rank and you are one.
  ('Senpai','Senpai', 1,  8, 10, true,  'Senpai',
   'Senior student. Held from 3rd kyu until black belt.'),
  ('Sensei','Sensei', 2, 11, 13, true,  'Sensei',
   'Teacher. Held from shodan to sandan.'),
  ('Shihan','Shihan', 3, 14, null, true, 'Shihan',
   'Senior teacher. Held from yondan.'),

  -- Awarded individually, and independent of grade. A 7th dan is not
  -- automatically Kyoshi.
  ('Renshi','Renshi', 4, 13, null, false, 'Renshi',
   'Polished instructor. Awarded, not conferred.'),
  ('Kyoshi','Kyoshi', 5, 14, null, false, 'Kyoshi',
   'Senior teacher. Awarded by the organisation.'),
  ('Hanshi','Hanshi', 6, 15, null, false, 'Hanshi',
   'Master teacher. The organisation''s most senior title.')
) as t(label,short,ord,min_g,max_g,conferred,address,descr)
where o.slug = 'moknz';

-- Only the awarded ones are recorded against a person.
insert into title_award (person_id, title_id, awarded_on, awarded_by_org)
select p.id, t.id, a.on_date, o.id
from (values
  ('NZ-0001','Hanshi','1995-01-01'::date),
  ('NZ-0288','Renshi','2019-06-01'::date)
) as a(num, title, on_date)
join person p on p.display_number = a.num
join title t on t.label = a.title
join organisation o on o.slug = 'moknz';

insert into qualification (organisation_id, code, label, category, valid_months, required_for)
select o.id, q.code, q.label, q.cat, q.months, q.req
from organisation o, (values
  ('police-vet','Police vetting','safeguarding',36,array['instruct']),
  ('first-aid','First aid certificate','medical',24,array['instruct']),
  ('referee-a','Referee, national','officiating',48,array['judge']),
  ('panel-examiner','Grading examiner','instructing',null::smallint,array['panel']),
  ('child-protection','Child protection training','safeguarding',24,array['instruct'])
) as q(code,label,cat,months,req)
where o.slug = 'moknz';

insert into qualification_award (person_id, qualification_id, awarded_on, issued_by_org)
select p.id, q.id, d.on_date, o.id
from (values
  ('NZ-0001','police-vet','2025-03-01'::date),
  ('NZ-0001','panel-examiner','1990-01-01'::date),
  ('NZ-0288','police-vet','2021-05-01'::date),
  ('NZ-0288','first-aid','2025-08-01'::date)
) as d(num,code,on_date)
join person p on p.display_number = d.num
join organisation o on o.slug = 'moknz'
join qualification q on q.code = d.code and q.organisation_id = o.id;
