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
