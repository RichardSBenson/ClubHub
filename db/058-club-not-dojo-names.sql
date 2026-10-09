-- applied-when: select to_regclass('public.club_profile') is not null
-- 058 — the platform's own names stop saying "dojo".
--
-- Dojo is karate's and judo's word; a taekwondo school is a dojang, a BJJ school an academy. The label people see has
-- followed each organisation's own vocabulary for a long time (012, 015); this brings the names underneath into line.
--   dojo_profile      -> club_profile
--   'dojo_fee'        -> 'club_fee'  (the kind of a payment line)
--   'dojo' as a kind  -> 'club'      (fee audience, link source, publication kind: none in use)
-- A view called dojo_profile stays for a release so code deployed before this runs keeps working; 059 removes it.
alter table dojo_profile rename to club_profile;
alter index if exists one_current_dojo rename to one_current_club;
create view dojo_profile as select * from club_profile;

do $$
declare c record;
begin
  for c in
    select conrelid::regclass as tbl, conname from pg_constraint
    where contype = 'c' and (
      (conrelid = 'payment_line'::regclass and pg_get_constraintdef(oid) like '%dojo_fee%')
   or (conrelid = 'fee_schedule'::regclass and pg_get_constraintdef(oid) like '%''dojo''%')
   or (conrelid = 'publication'::regclass and pg_get_constraintdef(oid) like '%''dojo''%'))
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;
end $$;

update payment_line set kind = 'club_fee' where kind = 'dojo_fee';
update fee_schedule set applies_to = 'club' where applies_to = 'dojo';
update internal_link set from_kind = 'club' where from_kind = 'dojo';  -- (no constraint on this one)
update publication set entry_kind = 'club' where entry_kind = 'dojo';

-- 'dojo_fee' is still accepted until 059, for code that has not been replaced yet.
alter table payment_line add constraint payment_line_kind_check check (kind in ('club_fee','dojo_fee','tournament_entry','kyu_grading',
  'dan_grading','uniform','equipment'));
alter table fee_schedule add constraint fee_schedule_applies_to_check check (applies_to in ('member','junior','adult','family','club'));
alter table publication add constraint publication_entry_kind_check check (entry_kind in ('page','article','club','event'));
