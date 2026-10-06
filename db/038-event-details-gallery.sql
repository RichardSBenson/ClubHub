-- 038 — how an event is announced, and a dojo's photo gallery.
-- applied-when: select to_regclass('public.club_gallery') is not null
--
-- event_detail sits beside event rather than inside it: the type chosen from the
-- federation's list, who to contact, what it costs, where the pin goes. One row
-- per event, only when somebody filled something in.
-- club_gallery is a dojo's photo strip: pictures from its own library, in order.

create table if not exists event_detail (
  event_id      uuid primary key references event(id) on delete cascade,
  type_key      text,
  contact_name  text,
  contact_email text,
  contact_phone text,
  cost_note     text,
  info_url      text,
  latitude      numeric(9,6),
  longitude     numeric(9,6)
);

create table if not exists club_gallery (
  id              uuid primary key default uuid_generate_v4(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  asset_id        uuid not null references asset(id) on delete cascade,
  caption         text,
  position        integer not null default 0,
  created_at      timestamptz not null default now(),
  unique (organisation_id, asset_id)
);
create index if not exists club_gallery_org on club_gallery (organisation_id, position);
