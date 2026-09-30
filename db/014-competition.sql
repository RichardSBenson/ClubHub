-- ===========================================================================
--  014 — disciplines, divisions, entries
--
--  The platform must not know what a kata is.
--
--  A tournament's shape is configuration. The 2026 Kokoro Cup runs Kata,
--  Non-Contact Kumite and Full-Contact Kumite, with kata divisions banded by
--  grade and kumite matched on age, weight, grade and experience. A BJJ event
--  runs gi and no-gi with weight classes and an absolute. A taekwondo event
--  runs sparring, poomsae and breaking. Every one of those has to work here
--  without a line of code that names any of them.
--
--  So a division is a set of BOUNDS — grade, age, weight, gender — and a
--  label the organiser chose. The system decides who fits which; it has no
--  opinion about what the division means.
--
--  What this replaces: event_entry.divisions was text[], which cannot carry a
--  rule, a fee or a result. It is dropped below. Nothing is in it — entries
--  have never been enterable.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- what an event runs
-- ---------------------------------------------------------------------------

create table if not exists event_discipline (
  id          uuid primary key default uuid_generate_v4(),
  event_id    uuid not null references event(id) on delete cascade,
  name        text not null,                    -- 'Kata', 'Full-Contact Kumite'
  summary     text,
  sort_order  smallint not null default 0,
  -- Whether a competitor may enter this one more than once. Team kata is a
  -- second entry in the same discipline; a weight class is not.
  allows_team boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (event_id, name)
);

comment on table event_discipline is
  'What an event runs. Configuration — the platform never reads these names.';

-- ---------------------------------------------------------------------------
-- who may be in which division
-- ---------------------------------------------------------------------------

create table if not exists event_division (
  id            uuid primary key default uuid_generate_v4(),
  discipline_id uuid not null references event_discipline(id) on delete cascade,
  label         text not null,                  -- 'Development Kata'
  summary       text,                           -- 'White/orange/blue to 7th kyu'

  -- Bounds. Every one is nullable and a null means "no limit that way", so a
  -- division with none admits everybody — which is exactly what an open or
  -- absolute division is.
  min_rank_order smallint,                      -- grade, by the federation's ladder
  max_rank_order smallint,
  min_age       smallint,                       -- age ON THE DAY of the event
  max_age       smallint,
  min_weight_kg numeric(5,2),
  max_weight_kg numeric(5,2),
  gender        text,                           -- null = any; otherwise matched
  min_years_training smallint,
  max_years_training smallint,
  min_prior_events smallint,
  max_prior_events smallint,

  -- Anything the organiser needs that the platform must not interpret: the
  -- permitted kata for this division, the rules link, the mat number. Held as
  -- data and shown to the competitor; never read as a rule.
  options       jsonb not null default '{}',

  sort_order    smallint not null default 0,
  capacity      smallint,
  created_at    timestamptz not null default now(),

  -- Bounds that cross over are always a mistake, and the database is the last
  -- place able to say so.
  constraint division_rank_order_sane
    check (min_rank_order is null or max_rank_order is null
           or min_rank_order <= max_rank_order),
  constraint division_age_sane
    check (min_age is null or max_age is null or min_age <= max_age),
  constraint division_weight_sane
    check (min_weight_kg is null or max_weight_kg is null
           or min_weight_kg <= max_weight_kg),
  unique (discipline_id, label)
);

create index if not exists event_division_discipline_idx
  on event_division (discipline_id, sort_order);

-- ---------------------------------------------------------------------------
-- what it costs
-- ---------------------------------------------------------------------------

-- The Kokoro Cup charges $60 for one event, $70 for any two, $80 for all
-- three. That is a price for a COUNT, not a price per discipline, and adding
-- up per-discipline fees gives the wrong answer at every count above one.
create table if not exists entry_price (
  id            uuid primary key default uuid_generate_v4(),
  event_id      uuid not null references event(id) on delete cascade,
  for_count     smallint not null,              -- how many disciplines entered
  amount_cents  integer not null,
  currency      char(3) not null default 'NZD',
  members_only  boolean not null default false,
  label         text,
  check (for_count >= 1),
  check (amount_cents >= 0),
  unique (event_id, for_count, members_only)
);

comment on table entry_price is
  'Price for entering N disciplines. Configuration, never arithmetic in code.';

-- ---------------------------------------------------------------------------
-- the entry itself
-- ---------------------------------------------------------------------------

-- text[] could hold the names of divisions and nothing else: no eligibility,
-- no fee, no result, no record of an organiser moving somebody. Entries have
-- never been enterable, so there is nothing in it to preserve.
alter table event_entry drop column if exists divisions;

-- What was recorded on the day, which is not what the register holds. Weight
-- and height change between tournaments and the entry has to keep the figure
-- the draw was made from — correcting somebody's profile a year later must
-- not silently rewrite last year's division.
alter table event_entry
  add column if not exists entered_by uuid references account(id),
  add column if not exists entered_for_org uuid references organisation(id),
  add column if not exists amount_cents integer,
  add column if not exists currency char(3) not null default 'NZD',
  add column if not exists notes text,
  add column if not exists updated_at timestamptz not null default now();

-- A person enters an event once. Two entries for one competitor is a
-- duplicate, not a second competitor, and it splits them across the draw.
create unique index if not exists event_entry_one_per_person
  on event_entry (event_id, person_id) where person_id is not null;

create index if not exists event_entry_event_idx on event_entry (event_id);

-- ---------------------------------------------------------------------------
-- which disciplines, and which division in each
-- ---------------------------------------------------------------------------

create table if not exists entry_selection (
  id            uuid primary key default uuid_generate_v4(),
  entry_id      uuid not null references event_entry(id) on delete cascade,
  discipline_id uuid not null references event_discipline(id) on delete cascade,

  -- Null means the system found no division this competitor fits. The form
  -- says so out loud — "If no match available, your instructor will be
  -- advised" — so it is a state to carry and report, not an error.
  division_id   uuid references event_division(id) on delete set null,

  -- How it got there. 'calculated' by the rules, 'chosen' by the competitor
  -- where the organiser allows it, 'assigned' by the organiser overruling
  -- either. The form says "ALL divisions subject to change", and a division
  -- that has been moved by hand must never be silently recalculated back.
  placed_by     text not null default 'calculated'
                check (placed_by in ('calculated', 'chosen', 'assigned')),
  placed_note   text,

  -- Whatever the division asked for: the kata they will perform, a team name.
  -- Data, never a rule.
  options       jsonb not null default '{}',

  created_at    timestamptz not null default now(),
  unique (entry_id, discipline_id)
);

create index if not exists entry_selection_division_idx
  on entry_selection (division_id);

-- ---------------------------------------------------------------------------
-- consent, which is not a boolean
-- ---------------------------------------------------------------------------

-- event_entry.waiver_ok was exactly the `consent = true` that is worth
-- nothing: it does not say WHAT was agreed to, by whom, or when, so it proves
-- nothing at the point it would ever be needed. The column stays for now
-- because dropping it would break nothing and prove nothing either; this is
-- what is actually relied on.
create table if not exists entry_consent (
  id            uuid primary key default uuid_generate_v4(),
  entry_id      uuid not null references event_entry(id) on delete cascade,

  -- Which declaration. A federation revises its terms; an entry from before
  -- the revision agreed to the old ones, and saying otherwise is a lie the
  -- system would be telling on the federation's behalf.
  version       text not null,
  document_hash text,                           -- of the exact text shown

  accepted_at   timestamptz not null default now(),
  accepted_name text not null,                  -- typed by whoever accepted
  accepted_by   uuid references account(id),    -- if they were signed in
  accepted_ip   text,

  -- The Kokoro Cup requires a parent or guardian to sign for anyone under 16
  -- — not 18. Which is why the threshold is an event's setting and not a
  -- constant anywhere in the code.
  guardian      jsonb,                          -- { name, relationship, contact }

  unique (entry_id, version)
);

comment on table entry_consent is
  'What was agreed to, by whom, and when. A boolean proves none of that.';

-- ---------------------------------------------------------------------------
-- the event''s own entry settings
-- ---------------------------------------------------------------------------

alter table event
  -- 16 at the Kokoro Cup, 18 elsewhere, 21 somewhere. Never a constant.
  add column if not exists guardian_under smallint,
  add column if not exists consent_version text,
  add column if not exists consent_text text,
  -- Whether somebody who is not on any roll may enter at all.
  add column if not exists guests_allowed boolean not null default false;
