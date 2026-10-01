-- applied-when: select exists (select 1 from pg_indexes where indexname = 'attendance_org_date_idx')
--
-- How tools/migrate.mjs tells whether this migration is already in a database.

-- "Who came to this class on this day" and "who has been this month" both ask
-- by organisation and date.
create index if not exists attendance_org_date_idx
  on attendance (organisation_id, session_date desc);
