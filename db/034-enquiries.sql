-- applied-when: select exists (select 1 from information_schema.tables where table_name = 'enquiry')
--
-- How tools/migrate.mjs tells whether this migration is already in a database.

-- ===========================================================================
--  Enquiries: what visitors send through the website's contact and
--  "try a class" forms.
--
--  Always stored, then emailed: a provider outage or a bounced address must
--  not lose somebody's message. The visitor's address is kept only as a salted
--  hash for rate limiting, and cleared after two days; the enquiry itself is
--  removed after a year.
-- ===========================================================================

create table enquiry (
  id              uuid primary key default uuid_generate_v4(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  kind            text not null default 'contact' check (kind in ('contact','trial')),
  name            text not null,
  email           citext not null,
  phone           text,
  who             text,                              -- trial: who it is for
  message         text,
  status          text not null default 'new' check (status in ('new','handled')),
  emailed         boolean not null default false,
  ip_hash         text,
  created_at      timestamptz not null default now(),
  handled_at      timestamptz,
  handled_by      uuid references account(id)
);
create index on enquiry (organisation_id, status, created_at desc);
create index on enquiry (ip_hash, created_at) where ip_hash is not null;

-- Pages and news can be scheduled to go live on a date.
alter table page    add column if not exists publish_at timestamptz;
alter table article add column if not exists publish_at timestamptz;
create index if not exists page_publish_at_idx on page (publish_at) where publish_at is not null and status = 'draft';
create index if not exists article_publish_at_idx on article (publish_at) where publish_at is not null and status = 'draft';
