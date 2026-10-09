-- applied-when: select to_regclass('public.dojo_profile') is null
-- 059 — the temporary dojo_profile view (058) is no longer needed: nothing deployed refers to it.
-- 'dojo_fee' stops being accepted as a payment line kind.
drop view if exists dojo_profile;
alter table payment_line drop constraint if exists payment_line_kind_check;
alter table payment_line add constraint payment_line_kind_check check (kind in ('club_fee','tournament_entry','kyu_grading',
  'dan_grading','uniform','equipment'));
