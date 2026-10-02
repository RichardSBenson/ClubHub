-- applied-when: select exists (select 1 from information_schema.tables where table_name = 'qualification_reminder')
--
-- How tools/migrate.mjs tells whether this migration is already in a database.

-- Each qualification award is reminded about at most once when it enters its
-- expiring window and once when it lapses. This is the record of having done so,
-- which is what makes the daily run safe to repeat.
create table qualification_reminder (
  award_id uuid not null references qualification_award(id) on delete cascade,
  stage    text not null check (stage in ('expiring','expired')),
  sent_on  date not null default current_date,
  primary key (award_id, stage)
);

-- Who recorded an award, for the audit trail.
alter table qualification_award add column if not exists recorded_by uuid references account(id);
