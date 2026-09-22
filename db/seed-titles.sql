-- ===========================================================================
--  Titles — MOKNZ's vocabulary, as an example of configuration, not a default
--
--  Another federation types its own. Korean: Sabeom, Kyosa, Kwanjang.
--  Chinese: Sifu, Sigung. BJJ: Coach, Professor. Capoeira: Contramestre,
--  Mestre. None of it is in the code.
-- ===========================================================================

insert into title (organisation_id, label, short_label, rank_order,
                   min_grade_order, max_grade_order, conferred_by_rank,
                   address_as, description)
select o.id, t.label, t.short, t.ord, t.min_g, t.max_g, t.conferred, t.address,
       t.descr
from organisation o, (values
  -- Conferred by grade. Nobody awards these; you reach the rank and you are one.
  ('Senpai','Senpai', 1,  8, 10, true,  'Senpai',
   'Senior student. Held from 3rd kyu until black belt.'),
  ('Sensei','Sensei', 2, 11, 13, true,  'Sensei',
   'Teacher. Held from shodan to sandan.'),
  ('Shihan','Shihan', 3, 14, null, true, 'Shihan',
   'Senior teacher. Held from yondan.'),

  -- Awarded individually, and independent of grade. A 7th dan is not
  -- automatically Kyoshi.
  ('Renshi','Renshi', 4, 13, null, false, 'Renshi',
   'Polished instructor. Awarded, not conferred.'),
  ('Kyoshi','Kyoshi', 5, 14, null, false, 'Kyoshi',
   'Senior teacher. Awarded by the organisation.'),
  ('Hanshi','Hanshi', 6, 15, null, false, 'Hanshi',
   'Master teacher. The organisation''s most senior title.')
) as t(label,short,ord,min_g,max_g,conferred,address,descr)
where o.slug = 'moknz';

-- Only the awarded ones are recorded against a person.
insert into title_award (person_id, title_id, awarded_on, awarded_by_org)
select p.id, t.id, a.on_date, o.id
from (values
  ('NZ-0001','Hanshi','1995-01-01'::date),
  ('NZ-0288','Renshi','2019-06-01'::date)
) as a(num, title, on_date)
join person p on p.display_number = a.num
join title t on t.label = a.title
join organisation o on o.slug = 'moknz';

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
