-- 045 — booking a place in a class, with a waiting list.
-- applied-when: select exists (select 1 from information_schema.tables where table_name = 'class_booking')

alter table training_session add column if not exists capacity smallint
  check (capacity is null or capacity between 1 and 500);

create table if not exists class_booking (
  id            uuid primary key default uuid_generate_v4(),
  session_id    uuid not null references training_session(id) on delete cascade,
  session_date  date not null,
  person_id     uuid not null references person(id) on delete cascade,
  status        text not null default 'booked' check (status in ('booked','waiting','cancelled')),
  booked_by     uuid references account(id),
  created_at    timestamptz not null default now(),
  promoted_at   timestamptz,
  cancelled_at  timestamptz
);
create unique index if not exists class_booking_one_live on class_booking (session_id, session_date, person_id) where status <> 'cancelled';
create index if not exists class_booking_day on class_booking (session_id, session_date, status, created_at);
create index if not exists class_booking_person on class_booking (person_id, session_date);
