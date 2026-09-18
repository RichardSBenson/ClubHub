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
