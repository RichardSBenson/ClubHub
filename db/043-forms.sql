-- 043 — forms and consent: a form an organisation builds, and what people answer.
-- applied-when: select exists (select 1 from information_schema.tables where table_name = 'club_form')

create table if not exists club_form (
  id              uuid primary key default uuid_generate_v4(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  title           text not null check (char_length(title) between 1 and 120),
  kind            text not null default 'other' check (kind in ('waiver','consent','medical','other')),
  intro           text check (intro is null or char_length(intro) <= 3000),
  fields          jsonb not null default '[]',
  audience        text not null default 'all' check (audience in ('all','juniors','seniors')),
  renew_months    smallint check (renew_months is null or renew_months between 1 and 60),
  status          text not null default 'draft' check (status in ('draft','published','archived')),
  version         integer not null default 1,
  created_by      uuid references account(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  published_at    timestamptz
);
create index if not exists club_form_org on club_form (organisation_id, status);

create table if not exists form_response (
  id              uuid primary key default uuid_generate_v4(),
  form_id         uuid not null references club_form(id) on delete cascade,
  form_version    integer not null,
  person_id       uuid not null references person(id) on delete cascade,
  answers         jsonb not null default '{}',
  signed_name     text not null,
  signed_by       uuid references account(id),
  signed_for_minor boolean not null default false,
  signed_ip       text,
  answered_at     timestamptz not null default now(),
  expires_on      date,
  withdrawn_at    timestamptz
);
create index if not exists form_response_person on form_response (person_id, form_id, answered_at desc);
