-- 053 — documents a member sends to their club: a first aid certificate, a police vet, anything else.
-- applied-when: select to_regclass('public.member_document') is not null
--
-- The file is kept here, not in the media library, so it is never offered as a website image and is only ever
-- read by the person, their parent or guardian, or an official of their club. A registrar checks it; accepting a
-- document that is one of the club's qualifications records the qualification, with the file as its proof.

create table if not exists member_document (
  id               uuid primary key default uuid_generate_v4(),
  person_id        uuid not null references person(id) on delete cascade,
  organisation_id  uuid not null references organisation(id) on delete cascade,
  qualification_id uuid references qualification(id) on delete set null,
  title            text not null,
  awarded_on       date,
  expires_on       date,
  note             text,
  filename         text,
  mime             text not null,
  bytes            bytea not null,
  size_bytes       integer not null,
  status           text not null default 'pending' check (status in ('pending','accepted','declined')),
  uploaded_by      uuid references account(id),
  created_at       timestamptz not null default now(),
  reviewed_by      uuid references account(id),
  reviewed_at      timestamptz,
  review_note      text,
  award_id         uuid references qualification_award(id) on delete set null
);
create index if not exists member_document_person on member_document (person_id);
create index if not exists member_document_waiting on member_document (organisation_id) where status = 'pending';
