-- MOKNZ shogo and the qualifications a federation actually tracks.

insert into title (organisation_id, label, short_label, rank_order, min_grade_order, description)
select o.id, t.label, t.short, t.ord, t.min_grade, t.descr
from organisation o, (values
  ('Renshi','Renshi',1,13,'Polished instructor. Awarded separately from grade.'),
  ('Kyoshi','Kyoshi',2,14,'Senior teacher.'),
  ('Hanshi','Hanshi',3,15,'Master teacher. The organisation''s most senior title.')
) as t(label,short,ord,min_grade,descr)
where o.slug = 'moknz';

-- Doug is 5th dan in the seed but Hanshi; the two are independent by design.
insert into title_award (person_id, title_id, awarded_on, awarded_by_org)
select p.id, t.id, '1995-01-01', o.id
from person p, title t, organisation o
where p.display_number = 'NZ-0001' and t.label = 'Hanshi' and o.slug = 'moknz';

insert into title_award (person_id, title_id, awarded_on, awarded_by_org)
select p.id, t.id, '2019-06-01', o.id
from person p, title t, organisation o
where p.display_number = 'NZ-0288' and t.label = 'Renshi' and o.slug = 'moknz';

insert into qualification (organisation_id, code, label, category, valid_months, required_for)
select o.id, q.code, q.label, q.cat, q.months, q.req
from organisation o, (values
  ('police-vet','Police vetting','safeguarding',36,array['instruct']),
  ('first-aid','First aid certificate','medical',24,array['instruct']),
  ('referee-a','Referee, national','officiating',48,array['judge']),
  ('panel-examiner','Grading examiner','instructing',null::smallint,array['panel']),
  ('child-protection','Child protection training','safeguarding',24,array['instruct'])
) as q(code,label,cat,months,req)
where o.slug = 'moknz';

-- Doug: current. Tane: a police vet that lapsed last year.
insert into qualification_award (person_id, qualification_id, awarded_on, issued_by_org)
select p.id, q.id, d.on_date, o.id
from (values
  ('NZ-0001','police-vet','2025-03-01'::date),
  ('NZ-0001','panel-examiner','1990-01-01'::date),
  ('NZ-0288','police-vet','2021-05-01'::date),
  ('NZ-0288','first-aid','2025-08-01'::date)
) as d(num,code,on_date)
join person p on p.display_number = d.num
join organisation o on o.slug = 'moknz'
join qualification q on q.code = d.code and q.organisation_id = o.id;
