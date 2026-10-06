-- 040 — a written description for an event, beside the one-line summary.
-- applied-when: select exists (select 1 from information_schema.columns where table_name = 'event_detail' and column_name = 'description')

alter table event_detail add column if not exists description text;
