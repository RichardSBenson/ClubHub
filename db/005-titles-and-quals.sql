-- ===========================================================================
--  Titles and qualifications
--
--  Rank is not the only thing a federation records, and this was a real gap:
--  MOKNZ's own leadership could not be represented.
--
--  Hanshi Doug Holloway is 8th dan AND Hanshi. Kyoshi Mike Kenworthy is 7th
--  dan AND Kyoshi. Shogo (Renshi, Kyoshi, Hanshi) are teaching titles awarded
--  separately from grade — you can hold 7th dan without being Kyoshi. Kendo,
--  iaido, kyudo and most Japanese arts work the same way.
--
--  Qualifications are different again: they EXPIRE. A referee licence, a first
--  aid certificate, a police vet. Rank never lapses; these do, and a federation
--  needs to know whose has.
-- ===========================================================================

create table title (
  id              uuid primary key default uuid_generate_v4(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  label           text not null,                 -- 'Hanshi'
  short_label     text,
  rank_order      smallint not null,             -- Renshi 1, Kyoshi 2, Hanshi 3
  min_grade_order smallint,                      -- usually requires a dan grade
  description     text,
  unique (organisation_id, rank_order)
);

create table title_award (
  id              uuid primary key default uuid_generate_v4(),
  person_id       uuid not null references person(id) on delete restrict,
  title_id        uuid not null references title(id) on delete restrict,
  awarded_on      date not null,
  awarded_by_org  uuid not null references organisation(id) on delete restrict,
  certificate_no  text,
  notes           text,
  created_at      timestamptz not null default now()
);

create index on title_award (person_id, awarded_on desc);

-- Highest title held. Like grade, derived — never a column on the person.
create view person_current_title as
select distinct on (ta.person_id)
  ta.person_id, t.id as title_id, t.label, t.short_label, t.rank_order,
  ta.awarded_on
from title_award ta
join title t on t.id = ta.title_id
order by ta.person_id, t.rank_order desc, ta.awarded_on desc;

-- ---------------------------------------------------------------------------
-- qualifications — these expire, and that is the whole point
-- ---------------------------------------------------------------------------

create table qualification (
  id              uuid primary key default uuid_generate_v4(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  code            text not null,                 -- 'referee-a', 'first-aid'
  label           text not null,
  category        text not null default 'other'
                  check (category in ('instructing','officiating','safety',
                                      'safeguarding','medical','other')),
  valid_months    smallint,                      -- null = never expires
  required_for    text[] not null default '{}',  -- 'instruct','judge','panel'
  unique (organisation_id, code)
);

create table qualification_award (
  id              uuid primary key default uuid_generate_v4(),
  person_id       uuid not null references person(id) on delete cascade,
  qualification_id uuid not null references qualification(id) on delete restrict,
  awarded_on      date not null,
  expires_on      date,                          -- set from valid_months
  issued_by_org   uuid references organisation(id),
  issued_by_other text,                          -- 'NZ Red Cross'
  reference       text,
  document_asset_id uuid,
  created_at      timestamptz not null default now()
);

create index on qualification_award (person_id);
create index on qualification_award (expires_on)
  where expires_on is not null;

-- Fill the expiry from the qualification's own validity period, so nobody has
-- to work it out by hand.
create or replace function set_qualification_expiry() returns trigger
language plpgsql as $$
declare months smallint;
begin
  if new.expires_on is null then
    select valid_months into months from qualification where id = new.qualification_id;
    if months is not null then
      new.expires_on := new.awarded_on + (months || ' months')::interval;
    end if;
  end if;
  return new;
end $$;

create trigger qualification_expiry
before insert or update on qualification_award
for each row execute function set_qualification_expiry();

-- What is current, what has lapsed, and what lapses soon. The query a
-- registrar actually runs.
create view qualification_status as
select qa.person_id, q.code, q.label, q.category, q.required_for,
       qa.awarded_on, qa.expires_on,
       case
         when qa.expires_on is null then 'permanent'
         when qa.expires_on < current_date then 'expired'
         when qa.expires_on < current_date + 60 then 'expiring'
         else 'current'
       end as status,
       qa.expires_on - current_date as days_left
from qualification_award qa
join qualification q on q.id = qa.qualification_id;
