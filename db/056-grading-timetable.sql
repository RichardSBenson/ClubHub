-- applied-when: select exists (select 1 from information_schema.columns where table_name = 'grade' and column_name = 'usual_months_to_next')
-- How long people usually stay at a grade before the next one, set per grade by each federation (a guide, not a gate:
-- the minimum that is enforced is min_months_at_previous). Null means "no set timetable". `next_by_invitation` says
-- the next grade is offered by invitation rather than simply sat.
alter table grade add column if not exists usual_months_to_next smallint check (usual_months_to_next is null or usual_months_to_next between 1 and 240);
alter table grade add column if not exists next_by_invitation boolean not null default false;
