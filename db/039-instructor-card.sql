-- 039 — the instructor card: how long they have trained, and whether to show their checks.
-- applied-when: select exists (select 1 from information_schema.columns where table_name = 'instructor_profile' and column_name = 'started_year')

alter table instructor_profile
  add column if not exists started_year smallint check (started_year between 1930 and 2100),
  -- Showing that somebody is police vetted or first-aid trained is a statement about them, so it is
  -- the instructor's choice, per club, and off until somebody turns it on.
  add column if not exists show_checks boolean not null default false;
