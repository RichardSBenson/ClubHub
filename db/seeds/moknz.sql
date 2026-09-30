-- ===========================================================================
--  Mas Oyama Karate New Zealand — one federation's data
--
--  Customer zero. Load it after db/install/schema.sql to get the development
--  and test database this repository's tests expect.
--
--  Nothing here is part of the product. Every belt colour, every title, every
--  club and every person in this file is MOKNZ's, and another federation
--  founds its own through tools/found.mjs rather than editing any of it.
--
--  That distinction is the reason this file exists separately: what is
--  structure and what is one customer's configuration had become impossible
--  to tell apart, and it was the thing standing between this and being
--  software somebody else can install.
-- ===========================================================================

-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- the tree
-- ---------------------------------------------------------------------------

-- The vocabulary lives here, on the federation, not in data/settings.json.
-- The file is the deployment's; this is MOKNZ's, and it stays right even when
-- a federation in another art appears on the same screen. Dojo is deliberately
-- its own plural — 道場 does not inflect, and MOKNZ kept that in English.
insert into organisation (id, parent_id, type, name, short_name, slug, path,
                          country_code, timezone, founded, settings)
values ('11111111-1111-1111-1111-111111111111', null, 'country',
        'Mas Oyama Karate New Zealand', 'MOKNZ', 'moknz', 'moknz',
        'NZ', 'Pacific/Auckland', '1965-01-01',
        '{"vocabulary":{"club":"Dojo","clubPlural":"Dojo",
                        "grade":"Grade","grading":"Grading"}}'::jsonb);

insert into organisation (parent_id, type, name, slug, path, country_code, timezone)
select '11111111-1111-1111-1111-111111111111', 'club', name, slug,
       ('moknz.' || replace(slug,'-','_'))::ltree, 'NZ', 'Pacific/Auckland'
from (values
  ('Far North','far-north'), ('Auckland','auckland'), ('Gisborne','gisborne'),
  ('Inglewood','taranaki'), ('Stratford','stratford'), ('New Plymouth','new-plymouth'),
  ('Hawera','hawera'), ('Taumarunui','taumarunui'), ('Napier','napier'),
  ('Whanganui','whanganui'), ('Carterton','carterton'), ('Wellington','wellington'),
  ('Christchurch','christchurch'), ('Dunedin','dunedin'), ('Waikouaiti','waikouaiti'),
  ('Milton','milton')
) as d(name, slug);

-- Japan sits under MOKNZ but outside NZ payment rails.
insert into organisation (parent_id, type, name, slug, path, country_code, timezone)
values ('11111111-1111-1111-1111-111111111111', 'club', 'Japan Branch', 'japan',
        'moknz.japan', 'JP', 'Asia/Tokyo');

-- ---------------------------------------------------------------------------
-- the grade ladder  [PLACEHOLDER — confirm with the executive]
-- ---------------------------------------------------------------------------

insert into grade (organisation_id, label, short_label, belt_colour, belt_stripes,
                   rank_order, is_dan, min_months_at_previous, min_age, min_sessions)
select '11111111-1111-1111-1111-111111111111', label, short_label, colour, stripes,
       rank_order, is_dan, months, min_age, sessions
from (values
  ('10th kyu','10k','#F4F4F5',0, 1,false,null,null,null),
  ('9th kyu', '9k','#D9761F',0, 2,false,3,   5,   24),
  ('8th kyu', '8k','#D9761F',1, 3,false,3,   5,   24),
  ('7th kyu', '7k','#1F4E8C',0, 4,false,4,   6,   32),
  ('6th kyu', '6k','#1F4E8C',1, 5,false,4,   6,   32),
  ('5th kyu', '5k','#F0CE41',0, 6,false,6,   7,   48),
  ('4th kyu', '4k','#F0CE41',1, 7,false,6,   7,   48),
  ('3rd kyu', '3k','#2E6B33',0, 8,false,6,   8,   48),
  ('2nd kyu', '2k','#2E6B33',1, 9,false,6,   8,   48),
  ('1st kyu', '1k','#6B4322',0,10,false,12, 10,   96),
  ('Shodan',  '1d','#1C1C1E',1,11,true, 18, 16,  144),
  ('Nidan',   '2d','#1C1C1E',2,12,true, 24, 18,  192),
  ('Sandan',  '3d','#1C1C1E',3,13,true, 36, 21,  240),
  ('Yondan',  '4d','#1C1C1E',4,14,true, 48, 25,  288),
  ('Godan',   '5d','#1C1C1E',5,15,true, 60, 30,  336)
) as g(label, short_label, colour, stripes, rank_order, is_dan, months, min_age, sessions);

-- ---------------------------------------------------------------------------
-- who may award what — the rule nobody else models
-- ---------------------------------------------------------------------------

-- MOKNZ's rule. The Shihan requirement for 2nd and 1st kyu is attached in
-- 010-grading-authority-title.sql, because it points at a title and the titles
-- are seeded after this file.
insert into grade_authority (organisation_id, from_rank_order, to_rank_order,
                             awarded_by_type, ratified_by_type,
                             min_panel_size, min_panel_rank)
values
  -- 10th to 3rd kyu: the dojo grades, the country ratifies
  ('11111111-1111-1111-1111-111111111111', 1,  8, 'club',    'country', 1, 11),
  -- 2nd and 1st kyu: still the dojo's grading, but a Shihan must see it
  ('11111111-1111-1111-1111-111111111111', 9, 10, 'club',    'country', 1, 11),
  -- Shodan and above: national grading, panel of three, 4th dan or above
  ('11111111-1111-1111-1111-111111111111',11, 15, 'country', 'country', 3, 14);

-- ---------------------------------------------------------------------------
-- people
-- ---------------------------------------------------------------------------

insert into person (id, display_number, first_name, last_name, date_of_birth, gender, email)
values
 ('22222222-0000-0000-0000-000000000001','NZ-0001','Doug','Holloway','1945-03-12','M','doug@example.nz'),
 ('22222222-0000-0000-0000-000000000002','NZ-0417','Aroha','Nikora','2011-08-04','F','aroha@example.nz'),
 ('22222222-0000-0000-0000-000000000003','NZ-0288','Tane','Walker','1988-01-22','M','tane@example.nz'),
 ('22222222-0000-0000-0000-000000000004','NZ-0901','Mia','Chen','2017-06-30','F',null);

-- Aroha trains at Whanganui, Tane at Wellington, Mia at Whanganui.
insert into affiliation (person_id, organisation_id, role, starts, status, paid_until)
select p.id, o.id, r.role, r.starts, 'active', '2026-12-31'
from (values
  ('22222222-0000-0000-0000-000000000001','whanganui','instructor','1965-01-01'::date),
  ('22222222-0000-0000-0000-000000000002','whanganui','member',    '2019-02-01'::date),
  ('22222222-0000-0000-0000-000000000003','wellington','instructor','2004-05-01'::date),
  ('22222222-0000-0000-0000-000000000004','whanganui','member',    '2024-03-01'::date)
) as r(pid, slug, role, starts)
join person p on p.id = r.pid::uuid
join organisation o on o.slug = r.slug;

-- ---------------------------------------------------------------------------
-- gradings — history, not a current value
-- ---------------------------------------------------------------------------

insert into grading_record (person_id, grade_id, awarded_on, awarded_by_org, result)
select p.id, g.id, r.on_date, o.id, 'pass'
from (values
  -- Aroha's progression, dojo then national
  ('22222222-0000-0000-0000-000000000002','10th kyu','2019-06-15'::date,'whanganui'),
  ('22222222-0000-0000-0000-000000000002','9th kyu', '2019-12-07'::date,'whanganui'),
  ('22222222-0000-0000-0000-000000000002','8th kyu', '2020-06-20'::date,'whanganui'),
  ('22222222-0000-0000-0000-000000000002','7th kyu', '2021-06-19'::date,'whanganui'),
  ('22222222-0000-0000-0000-000000000002','6th kyu', '2022-06-18'::date,'whanganui'),
  ('22222222-0000-0000-0000-000000000002','5th kyu', '2023-06-17'::date,'moknz'),
  ('22222222-0000-0000-0000-000000000002','4th kyu', '2024-10-19'::date,'moknz'),
  -- Tane to nidan
  ('22222222-0000-0000-0000-000000000003','1st kyu', '2012-10-20'::date,'moknz'),
  ('22222222-0000-0000-0000-000000000003','Shodan',  '2014-10-18'::date,'moknz'),
  ('22222222-0000-0000-0000-000000000003','Nidan',   '2025-10-18'::date,'moknz'),
  -- Mia, one grading
  ('22222222-0000-0000-0000-000000000004','10th kyu','2024-09-21'::date,'whanganui'),
  -- Hanshi Doug
  ('22222222-0000-0000-0000-000000000001','Godan',   '1990-01-01'::date,'moknz')
) as r(pid, grade, on_date, org)
join person p on p.id = r.pid::uuid
join grade g on g.label = r.grade
join organisation o on o.slug = r.org;

-- attendance for Aroha, enough to matter
insert into attendance (person_id, organisation_id, session_date)
select '22222222-0000-0000-0000-000000000002', o.id, d::date
from organisation o,
     generate_series('2025-02-04'::date, '2026-09-01'::date, '3 days') d
where o.slug = 'whanganui'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- accounts and roles
-- ---------------------------------------------------------------------------

insert into account (id, person_id, email) values
 ('33333333-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001','doug@example.nz'),
 ('33333333-0000-0000-0000-000000000003','22222222-0000-0000-0000-000000000003','tane@example.nz');

-- Doug is owner at national level. Tane administers Wellington only.
insert into grant_role (account_id, organisation_id, role)
select '33333333-0000-0000-0000-000000000001', id, 'owner'
from organisation where slug = 'moknz';

insert into grant_role (account_id, organisation_id, role)
select '33333333-0000-0000-0000-000000000003', id, 'administrator'
from organisation where slug = 'wellington';

-- ---------------------------------------------------------------------------
-- an event that publishes down, and a dojo one that does not
-- ---------------------------------------------------------------------------

insert into event (organisation_id, kind, title, slug, starts_at, visibility,
                   publish_down, entries_close, status)
select id, 'grading', 'National kyu grading', 'national-kyu-grading-oct',
       '2026-10-17 09:00+13', 'public', true, '2026-10-03 23:59+13', 'published'
from organisation where slug = 'moknz';

insert into event (organisation_id, kind, title, slug, starts_at, visibility,
                   min_rank_order, publish_down, status)
select id, 'seminar', 'Black belt seminar', 'black-belt-seminar-nov',
       '2026-11-21 10:00+13', 'by_grade', 11, true, 'published'
from organisation where slug = 'moknz';

insert into event (organisation_id, kind, title, slug, starts_at, visibility,
                   publish_down, publish_up, status)
select id, 'fight_night', 'Dojo fight night', 'fight-night-sep',
       '2026-09-26 19:00+12', 'own_org', false, false, 'published'
from organisation where slug = 'whanganui';


-- ---------------------------------------------------------------------------
-- dojo detail — only Whanganui is complete, on purpose.
-- A page does not publish until its facts are in. Proving that is the point.
-- ---------------------------------------------------------------------------

insert into dojo_profile (organisation_id, venue_name, address_line, suburb, city,
                          postcode, latitude, longitude, directions, phone, email,
                          blurb, who_trains, published)
select o.id, d.venue, d.addr, d.suburb, d.city, d.pc, d.lat, d.lng, d.dir,
       d.phone, d.email, d.blurb, d.who, d.pub
from (values
  ('whanganui','Springvale Community Hall','21 Hadfield Street','Springvale',
   'Whanganui','4501', -39.9187, 175.0200,
   'Park at the back; come in the side door by the playground.',
   '+64 6 000 0000','whanganui@kyokushinkarate.co.nz',
   '[Two or three sentences from the dojo operator, in their own words.]',
   'Twelve active black belt instructors train and teach here.', true),
  ('christchurch',null,null,null,'Christchurch',null,null,null,
   null,null,null,null,null, false),
  ('new-plymouth',null,null,null,'New Plymouth',null,null,null,
   null,null,null,null,null, false)
) as d(slug,venue,addr,suburb,city,pc,lat,lng,dir,phone,email,blurb,who,pub)
join organisation o on o.slug = d.slug;

insert into training_session (organisation_id, label, weekday, starts, ends,
                              min_age, max_age, sort_order)
select o.id, t.label, t.wd, t.st::time, t.en::time, t.mn, t.mx, t.so
from (values
  ('whanganui','Juniors, 6-12 years', 2,'17:30','18:30', 6,12,1),
  ('whanganui','Juniors, 6-12 years', 4,'17:30','18:30', 6,12,2),
  ('whanganui','Seniors, 13 and over',2,'18:45','20:15',13,null,3),
  ('whanganui','Seniors, 13 and over',4,'18:45','20:15',13,null,4),
  ('whanganui','Open training',       6,'09:00','10:30',null,null,5)
) as t(slug,label,wd,st,en,mn,mx,so)
join organisation o on o.slug = t.slug;

-- brand tokens, as produced by packages/brand from the MOKNZ crest
insert into brand (organisation_id, tokens, theme, fonts)
select id, '{
  "primary":"#CE372C","primaryText":"#CE372C","primaryTextStrong":"#9A2A1F",
  "primaryHover":"#AC2E25","accent":"#F0CE41","neutral":"#BDBDBF",
  "ink":"#161617","inkSoft":"#252527","canvas":"#F5F5F5","canvasAlt":"#E3E3E3",
  "muted":"#6F6F72"
}'::jsonb, 'classic',
 '{"display":"Shippori Mincho","body":"Zen Kaku Gothic New"}'::jsonb
from organisation where slug = 'moknz';

-- a couple of authored pages and one news item
insert into page (organisation_id, slug, title, meta_title, meta_description,
                  body, status, published_at)
select id, 'about', 'About us',
  'About Mas Oyama Karate New Zealand',
  'Kyokushin karate in New Zealand since 1965, with a direct lineage through Sosai Mas Oyama.',
  '{"blocks":[{"type":"paragraph","text":"Hanshi Doug Holloway, 8th dan, set up the first Kyokushin karate dojo in New Zealand in 1965, after returning from Japan as a student of Sosai Mas Oyama."},{"type":"paragraph","text":"Kyokushin means the ultimate truth. It is taught here by people who learned it from the source."}]}'::jsonb,
  'published', now()
from organisation where slug = 'moknz';

insert into article (organisation_id, slug, title, summary, body, tags,
                     about_org_id, status, published_at)
select m.id, 'eleven-students-grade-to-8th-kyu',
  'Eleven students grade to 8th kyu',
  'The largest dojo grading since 2019, with four families testing together.',
  '{"blocks":[{"type":"paragraph","text":"Saturday''s grading was the largest the dojo has run since 2019."}]}'::jsonb,
  array['grading','whanganui'], w.id, 'published', now() - interval '11 days'
from organisation m, organisation w
where m.slug = 'moknz' and w.slug = 'whanganui';

commit;

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

-- ===========================================================================

-- ---------------------------------------------------------------------------
-- MOKNZ's bands, replacing the placeholders
-- ---------------------------------------------------------------------------

delete from grade_authority
where organisation_id = '11111111-1111-1111-1111-111111111111';

-- 10th to 3rd kyu (rank order 1-8): the dojo runs it, the country ratifies.
-- One examiner, who must hold at least shodan.
insert into grade_authority (organisation_id, from_rank_order, to_rank_order,
                             awarded_by_type, ratified_by_type,
                             min_panel_size, min_panel_rank)
values ('11111111-1111-1111-1111-111111111111', 1, 8, 'club', 'country', 1, 11);

-- 2nd and 1st kyu (9-10): still run by the dojo, but a Shihan must see it.
-- In practice that is usually the North or South Island branch chief; the rule
-- the system enforces is the title, because that is the part that is actually
-- a rule. Who travels to which dojo is scheduling, not authority.
insert into grade_authority (organisation_id, from_rank_order, to_rank_order,
                             awarded_by_type, ratified_by_type,
                             min_panel_size, min_panel_rank, requires_title_id)
select '11111111-1111-1111-1111-111111111111', 9, 10, 'club', 'country', 1, 11,
       t.id
from title t
join organisation o on o.id = t.organisation_id
where o.slug = 'moknz' and t.label = 'Shihan';

-- Shodan and above (11+): a national grading, panel of three, 4th dan or above.
insert into grade_authority (organisation_id, from_rank_order, to_rank_order,
                             awarded_by_type, ratified_by_type,
                             min_panel_size, min_panel_rank)
values ('11111111-1111-1111-1111-111111111111', 11, 15, 'country', 'country', 3, 14);

-- ---------------------------------------------------------------------------
-- No coverage guard here.
--
-- There was one, and it was a trap: it asserted that every grade on the
-- ladder falls inside a band, but the very next seed ADDS Renshi, Kyoshi and
-- Hanshi above the top band. Correct the first time it ran, and a hard error
-- on every run after — which is how it failed against a database that already
-- had the later seed applied.
--
-- moknz-dan-ladder.sql sets the final bands and carries the guard, which is
-- the right place for it: the file that has the last word on the ladder is the
-- one that should check the ladder is covered.
-- ---------------------------------------------------------------------------

-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The ladder
-- ---------------------------------------------------------------------------

-- Godan was a placeholder for what MOKNZ calls Shihan. Renaming rather than
-- replacing keeps every grading_record that points at it.
update grade
   set label = 'Shihan', short_label = '5d'
 where organisation_id = '11111111-1111-1111-1111-111111111111'
   and rank_order = 15;

insert into grade (organisation_id, label, short_label, belt_colour,
                   belt_stripes, rank_order, is_dan, min_months_at_previous,
                   min_age, min_sessions)
select '11111111-1111-1111-1111-111111111111', label, short_label, '#1C1C1E',
       stripes, rank_order, true, months, min_age, sessions
from (values
  ('Renshi', '6d', 6, 16, 72,  35, 384),
  ('Kyoshi', '7d', 7, 17, 84,  42, 432),
  ('Hanshi', '8d', 8, 18, 96,  50, 480)
) as g(label, short_label, stripes, rank_order, months, min_age, sessions)
where not exists (
  select 1 from grade x
  where x.organisation_id = '11111111-1111-1111-1111-111111111111'
    and x.rank_order = g.rank_order);

-- Hanshi Doug is 8th dan. He was seeded at Godan with the Hanshi title awarded
-- separately, which was the old model's way of saying the same thing.
update grading_record gr
   set grade_id = (select id from grade
                    where organisation_id = '11111111-1111-1111-1111-111111111111'
                      and rank_order = 18)
 where gr.person_id = '22222222-0000-0000-0000-000000000001'
   and gr.grade_id = (select id from grade
                       where organisation_id = '11111111-1111-1111-1111-111111111111'
                         and rank_order = 15);

-- ---------------------------------------------------------------------------
-- Titles are now purely how someone is addressed, and all of them follow the
-- grade.
--
-- Senpai is also used relatively — to a 6th kyu, a 4th kyu is senpai — and
-- that is deliberately not stored. It is a relation between two people, not a
-- property of one, and a column claiming otherwise would be false for
-- everybody senior to its holder.
-- ---------------------------------------------------------------------------

delete from title_award
 where title_id in (
   select t.id from title t
   join organisation o on o.id = t.organisation_id
   where o.slug = 'moknz'
     and t.label in ('Shihan', 'Renshi', 'Kyoshi', 'Hanshi'));

update title t
   set conferred_by_rank = true,
       min_grade_order = v.min_g,
       max_grade_order = v.max_g
from (values
  ('Senpai', 11, 12),
  ('Sensei', 13, 14),
  ('Shihan', 15, 15),
  ('Renshi', 16, 16),
  ('Kyoshi', 17, 17),
  ('Hanshi', 18, 18)
) as v(label, min_g, max_g)
where t.label = v.label
  and t.organisation_id = '11111111-1111-1111-1111-111111111111';

-- ---------------------------------------------------------------------------
-- Authority, with the dan band extended to the top of the ladder
-- ---------------------------------------------------------------------------

delete from grade_authority
 where organisation_id = '11111111-1111-1111-1111-111111111111';

-- 10th to 3rd kyu: the dojo grades, the country ratifies.
insert into grade_authority (organisation_id, from_rank_order, to_rank_order,
                             awarded_by_type, ratified_by_type,
                             min_panel_size, min_panel_rank)
values ('11111111-1111-1111-1111-111111111111', 1, 8, 'club', 'country', 1, 11);

-- 2nd and 1st kyu: the dojo's grading, seen by a Shihan — 5th dan or above.
insert into grade_authority (organisation_id, from_rank_order, to_rank_order,
                             awarded_by_type, ratified_by_type,
                             min_panel_size, min_panel_rank)
values ('11111111-1111-1111-1111-111111111111', 9, 10, 'club', 'country', 1, 15);

-- Shodan and above: a national grading.
insert into grade_authority (organisation_id, from_rank_order, to_rank_order,
                             awarded_by_type, ratified_by_type,
                             min_panel_size, min_panel_rank)
values ('11111111-1111-1111-1111-111111111111', 11, 18, 'country', 'country', 3, 14);

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

do $$
declare
  uncovered text;
  ladder    text;
  dangling  int;
begin
  select string_agg(g.label, ', ' order by g.rank_order)
    into uncovered
  from grade g
  where g.organisation_id = '11111111-1111-1111-1111-111111111111'
    and not exists (
      select 1 from grade_authority ga
      where ga.organisation_id = g.organisation_id
        and g.rank_order between ga.from_rank_order and ga.to_rank_order);

  if uncovered is not null then
    raise exception 'no grading authority covers: %', uncovered;
  end if;

  select count(*) into dangling
  from grade_authority ga
  where ga.requires_title_id is not null
    and not exists (select 1 from title t where t.id = ga.requires_title_id);

  if dangling > 0 then
    raise exception 'grade_authority references % title(s) that do not exist', dangling;
  end if;

  select string_agg(label, ' ' order by rank_order) into ladder
  from grade
  where organisation_id = '11111111-1111-1111-1111-111111111111' and is_dan;

  if ladder is distinct from 'Shodan Nidan Sandan Yondan Shihan Renshi Kyoshi Hanshi' then
    raise exception 'dan ladder is "%", expected the eight named grades', ladder;
  end if;
end $$;

