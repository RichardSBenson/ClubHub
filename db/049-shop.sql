-- 049 — the shop: gear a member can order from their own dojo.
-- applied-when: select exists (select 1 from information_schema.tables where table_name = 'shop_order')
--
-- A product belongs to ONE organisation. A product owned by the federation is its national range and every
-- dojo beneath it can offer it; a product owned by a dojo is that dojo's own (its tournament tee) and
-- nobody else is ever shown it. A dojo can hide a national item or set its own price for it (product_listing).
-- An order is placed with the member's own dojo, which collects the money and hands the gear over.

create table if not exists product (
  id              uuid primary key default uuid_generate_v4(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  category        text not null default 'other'
                  check (category in ('gi','gloves','shin_pads','tournament_tee','other')),
  name            text not null,
  description     text,
  sizes           text[] not null default '{}',
  price_cents     integer not null check (price_cents >= 0 and price_cents <= 1000000),
  currency        text not null default 'NZD',
  active          boolean not null default true,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists product_owner on product (organisation_id, active, category, sort_order);

-- A dojo's say over a product it did not make: hide it, or charge its own price.
create table if not exists product_listing (
  product_id      uuid not null references product(id) on delete cascade,
  organisation_id uuid not null references organisation(id) on delete cascade,
  hidden          boolean not null default false,
  price_cents     integer check (price_cents is null or (price_cents >= 0 and price_cents <= 1000000)),
  primary key (product_id, organisation_id)
);

create table if not exists shop_order (
  id              uuid primary key default uuid_generate_v4(),
  organisation_id uuid not null references organisation(id) on delete cascade,   -- the dojo that fills it
  person_id       uuid not null references person(id) on delete cascade,         -- who the gear is for
  ordered_by      uuid references account(id),
  status          text not null default 'placed' check (status in ('placed','paid','ready','collected','cancelled')),
  note            text,
  total_cents     integer not null check (total_cents >= 0),
  currency        text not null default 'NZD',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists shop_order_club on shop_order (organisation_id, status, created_at desc);
create index if not exists shop_order_person on shop_order (person_id, created_at desc);

create table if not exists shop_order_line (
  id          uuid primary key default uuid_generate_v4(),
  order_id    uuid not null references shop_order(id) on delete cascade,
  product_id  uuid references product(id) on delete set null,
  name        text not null,                  -- the words at the time, so a later rename changes nothing
  size        text,
  quantity    smallint not null check (quantity between 1 and 20),
  unit_cents  integer not null check (unit_cents >= 0)
);
create index if not exists shop_order_line_order on shop_order_line (order_id);
