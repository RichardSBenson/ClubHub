-- 054 — one declaration for the whole federation, signed once and reused for every event.
-- applied-when: select to_regclass('public.federation_declaration') is not null
--
-- The federation writes its declaration (a waiver and consent) once. A member, or a parent or guardian for a child,
-- signs it once; the signing keeps the exact version, who signed and when. Publishing new wording makes everyone
-- sign again. An event can still carry extra wording of its own (a camp, a tournament).

create table if not exists federation_declaration (
  id              uuid primary key default uuid_generate_v4(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  version         text not null,
  body            text not null,
  published_by    uuid references account(id),
  published_at    timestamptz not null default now(),
  unique (organisation_id, version)
);

create table if not exists declaration_signing (
  id              uuid primary key default uuid_generate_v4(),
  person_id       uuid not null references person(id) on delete cascade,
  declaration_id  uuid not null references federation_declaration(id) on delete cascade,
  signed_name     text not null,
  signed_by       uuid references account(id),
  guardian        boolean not null default false,
  ip              text,
  signed_at       timestamptz not null default now(),
  unique (person_id, declaration_id)
);
create index if not exists declaration_signing_person on declaration_signing (person_id);
