-- applied-when: select exists (select 1 from information_schema.tables where table_name = 'school_term')

-- ===========================================================================
--  School terms
--
--  Terms belong to the organisation that sets them (usually the top of the tree, from the country's
--  calendar) and every club below inherits them unless it has terms of its own for that year.
--  A child's enrolment in a term is separate from their membership.
-- ===========================================================================

create table school_term (
  id              uuid primary key default uuid_generate_v4(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  year            int  not null,
  number          int  not null,
  name            text not null,
  starts          date not null,
  ends            date not null check (ends >= starts),
  source          text not null default 'manual' check (source in ('manual','built-in')),
  created_at      timestamptz not null default now(),
  unique (organisation_id, year, number)
);

create table term_enrolment (
  id              uuid primary key default uuid_generate_v4(),
  term_id         uuid not null references school_term(id) on delete cascade,
  person_id       uuid not null references person(id) on delete cascade,
  organisation_id uuid not null references organisation(id) on delete cascade,   -- the club
  status          text not null default 'enrolled' check (status in ('enrolled','withdrawn')),
  fee_cents       int  not null default 0,
  price_note      text,
  paid            boolean not null default false,
  enrolled_on     date not null,
  enrolled_by     uuid references account(id),
  created_at      timestamptz not null default now(),
  unique (term_id, person_id)
);
create index on term_enrolment (organisation_id, term_id, status);

alter table payment_line add column if not exists term_enrolment_id uuid references term_enrolment(id) on delete set null;

-- One "enrolment is open" email per club per term.
create table term_offer (
  term_id         uuid not null references school_term(id) on delete cascade,
  organisation_id uuid not null references organisation(id) on delete cascade,
  sent_at         timestamptz not null default now(),
  primary key (term_id, organisation_id)
);
