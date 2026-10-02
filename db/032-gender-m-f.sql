-- applied-when: select exists (select 1 from information_schema.table_constraints where constraint_name = 'person_gender_m_f')
--
-- How tools/migrate.mjs tells whether this migration is already in a database.

-- Gender is M or F. Existing free text is read the way the forms now read it
-- ("male", "Female", "m" …); anything that is neither is cleared, because the
-- column can no longer hold it.
update person set gender = case
    when lower(trim(gender)) in ('m','male','man','men','boy','boys') then 'M'
    when lower(trim(gender)) in ('f','female','woman','women','girl','girls') then 'F'
    else null end
  where gender is not null;
update event_division set gender = case
    when lower(trim(gender)) in ('m','male','man','men','boy','boys') then 'M'
    when lower(trim(gender)) in ('f','female','woman','women','girl','girls') then 'F'
    else null end
  where gender is not null;

alter table person add constraint person_gender_m_f check (gender is null or gender in ('M','F'));
alter table event_division add constraint event_division_gender_m_f check (gender is null or gender in ('M','F'));
