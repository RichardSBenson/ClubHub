-- 041 — gallery pictures belong to a year and, optionally, to one of the dojo's events.
-- applied-when: select exists (select 1 from information_schema.columns where table_name = 'club_gallery' and column_name = 'year')

alter table club_gallery
  add column if not exists year smallint check (year between 1950 and 2100),
  add column if not exists event_id uuid references event(id) on delete set null;
update club_gallery set year = extract(year from created_at)::smallint where year is null;
create index if not exists club_gallery_year on club_gallery (organisation_id, year desc, event_id);
