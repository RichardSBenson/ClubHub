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
