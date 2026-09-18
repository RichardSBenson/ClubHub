-- ===========================================================================
--  Seed: Mas Oyama Karate New Zealand — customer zero
--
--  Belt ladder is a PLACEHOLDER until the executive confirms MOKNZ's actual
--  kyu progression. Structure is right; colours and count may not be.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- the tree
-- ---------------------------------------------------------------------------

insert into organisation (id, parent_id, type, name, short_name, slug, path,
                          country_code, timezone, founded)
values ('11111111-1111-1111-1111-111111111111', null, 'country',
        'Mas Oyama Karate New Zealand', 'MOKNZ', 'moknz', 'moknz',
        'NZ', 'Pacific/Auckland', '1965-01-01');

insert into organisation (parent_id, type, name, slug, path, country_code, timezone)
select '11111111-1111-1111-1111-111111111111', 'dojo', name, slug,
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
values ('11111111-1111-1111-1111-111111111111', 'dojo', 'Japan Branch', 'japan',
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

insert into grade_authority (organisation_id, from_rank_order, to_rank_order,
                             awarded_by_type, ratified_by_type,
                             min_panel_size, min_panel_rank)
values
  -- 10th to 4th kyu: the dojo grades, the country ratifies
  ('11111111-1111-1111-1111-111111111111', 1,  7, 'dojo',    'country', 1, 11),
  -- 3rd to 1st kyu: national grading
  ('11111111-1111-1111-1111-111111111111', 8, 10, 'country', 'country', 2, 12),
  -- dan grades: national panel of three, 4th dan or above
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
