-- ===========================================================================
--  SEED (DEMO) — two more federations on the same platform
--
--  These exist to show a prospective federation that this is not a karate
--  system with other arts bolted on. Same code, same tables, same admin: what
--  differs is data.
--
--    Kaimai Taekwondo Federation   Dojang   · geup/dan · Sabeom
--    Southern Cross Jiu-Jitsu      Academy  · belts    · Professor
--
--  Both are invented. They are not, and must not be made to look like, any
--  real organisation. Every club, person and grade below is fictional, and
--  each federation carries demo:true in its settings so its pages say so.
--
--  Three deliberately different configurations, because the point is that the
--  platform assumes none of them:
--
--    karate  kyu then dan; 2nd and 1st kyu need a 5th dan on the panel
--    tkd     geup at the dojang, every dan grade at national level
--    bjj     the academy awards to brown; black belt needs a Professor —
--            a TITLE, not a rank, which is why that column exists
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- Re-runnable. A demo seed gets run twice: once to try it, once after someone
-- has clicked around and wants it clean. Everything below is removed first, in
-- dependency order, and nothing outside the two demo federations is touched.
-- ---------------------------------------------------------------------------

delete from article
 where organisation_id in (select id from organisation
                            where path <@ 'demo_tkd' or path <@ 'demo_bjj');
delete from event
 where organisation_id in (select id from organisation
                            where path <@ 'demo_tkd' or path <@ 'demo_bjj');
delete from grading_record
 where awarded_by_org in (select id from organisation
                           where path <@ 'demo_tkd' or path <@ 'demo_bjj');
delete from title_award
 where awarded_by_org in (select id from organisation
                           where path <@ 'demo_tkd' or path <@ 'demo_bjj');
delete from affiliation
 where organisation_id in (select id from organisation
                            where path <@ 'demo_tkd' or path <@ 'demo_bjj');
delete from person
 where display_number like 'KTF-%' or display_number like 'SCJJ-%';
delete from grade_authority
 where organisation_id in (select id from organisation
                            where path <@ 'demo_tkd' or path <@ 'demo_bjj');
delete from organisation
 where path <@ 'demo_tkd' or path <@ 'demo_bjj';

-- ---------------------------------------------------------------------------
-- Vocabulary for the federation everyone already has.
-- organisation.settings is inherited down the tree, so a club says whatever
-- its federation says unless it overrides it.
-- ---------------------------------------------------------------------------

update organisation
   set settings = settings || jsonb_build_object(
         'vocabulary', jsonb_build_object(
           'club', 'Dojo', 'clubPlural', 'Dojo',
           'grading', 'Grading', 'grade', 'Grade'))
 where slug = 'moknz';

-- ===========================================================================
--  Kaimai Taekwondo Federation
-- ===========================================================================

insert into organisation (id, parent_id, type, name, short_name, slug, path,
                          country_code, timezone, founded, settings)
values ('44444444-0000-0000-0000-000000000001', null, 'country',
        'Kaimai Taekwondo Federation', 'KTF', 'demo-tkd', 'demo_tkd',
        'NZ', 'Pacific/Auckland', '1988-03-01',
        jsonb_build_object(
          'demo', true,
          'discipline', 'Taekwondo',
          'homePage', jsonb_build_object(
            'heroHeading', 'Start where everyone starts.',
            'heroText', 'Taekwondo for adults and children across the Waikato and Bay of Plenty. Your first class is free.',
            'heroButton', 'Find a dojang'),
          'vocabulary', jsonb_build_object(
            'club', 'Dojang', 'clubPlural', 'Dojangs',
            'grading', 'Promotion test', 'grade', 'Rank')));

insert into organisation (parent_id, type, name, slug, path, country_code, timezone)
select '44444444-0000-0000-0000-000000000001', 'club', name, slug,
       ('demo_tkd.' || replace(slug, '-', '_'))::ltree, 'NZ', 'Pacific/Auckland'
from (values
  ('Tauranga', 'tauranga-tkd'), ('Rotorua', 'rotorua-tkd'),
  ('Hamilton', 'hamilton-tkd'), ('Matamata', 'matamata-tkd')
) as d(name, slug);

insert into brand (organisation_id, tokens, theme, fonts)
values ('44444444-0000-0000-0000-000000000001',
        '{"primary":"#1B5E9C","accent":"#E4B429","ink":"#14181D","canvas":"#F4F6F8","neutral":"#B7BFC7"}',
        'classic',
        '{"display":"Georgia","body":"system-ui"}');

-- geup counts DOWN to 1st geup, then dan counts up. Same shape as kyu/dan,
-- different words — which is the whole point.
insert into grade (organisation_id, label, short_label, belt_colour, belt_stripes,
                   rank_order, is_dan, min_months_at_previous, min_age, min_sessions)
select '44444444-0000-0000-0000-000000000001', label, short_label, colour, stripes,
       rank_order, is_dan, months, min_age, sessions
from (values
  ('10th geup','10g','#F4F4F5',0, 1,false,null,null,null),
  ('9th geup', '9g','#F0CE41',0, 2,false,3,   5,   20),
  ('8th geup', '8g','#F0CE41',1, 3,false,3,   5,   24),
  ('7th geup', '7g','#2E8B57',0, 4,false,4,   6,   28),
  ('6th geup', '6g','#2E8B57',1, 5,false,4,   6,   32),
  ('5th geup', '5g','#1B5E9C',0, 6,false,6,   7,   36),
  ('4th geup', '4g','#1B5E9C',1, 7,false,6,   7,   40),
  ('3rd geup', '3g','#B03030',0, 8,false,6,   8,   48),
  ('2nd geup', '2g','#B03030',1, 9,false,6,   9,   48),
  ('1st geup', '1g','#B03030',2,10,false,9,  10,   64),
  ('1st dan',  '1d','#1C1C1E',1,11,true, 12, 15,  120),
  ('2nd dan',  '2d','#1C1C1E',2,12,true, 24, 17,  180),
  ('3rd dan',  '3d','#1C1C1E',3,13,true, 36, 21,  240),
  ('4th dan',  '4d','#1C1C1E',4,14,true, 48, 25,  300),
  ('5th dan',  '5d','#1C1C1E',5,15,true, 60, 30,  360)
) as g(label, short_label, colour, stripes, rank_order, is_dan, months, min_age, sessions);

-- Korean titles, conferred by rank. Nothing in the code knows these words.
insert into title (organisation_id, label, short_label, rank_order,
                   min_grade_order, max_grade_order, conferred_by_rank,
                   address_as, description)
values
 ('44444444-0000-0000-0000-000000000001','Boosabeom','Boosabeom',1,11,12,true,'Boosabeom',
  'Assistant instructor. 1st and 2nd dan.'),
 ('44444444-0000-0000-0000-000000000001','Sabeom','Sabeom',2,13,14,true,'Sabeomnim',
  'Instructor. 3rd and 4th dan.'),
 ('44444444-0000-0000-0000-000000000001','Kwanjang','Kwanjang',3,15,null,true,'Kwanjangnim',
  'Head of the federation. 5th dan and above.');

-- The dojang promotes to 1st geup; every dan grade is national, panel of three.
insert into grade_authority (organisation_id, from_rank_order, to_rank_order,
                             awarded_by_type, ratified_by_type,
                             min_panel_size, min_panel_rank)
values
 ('44444444-0000-0000-0000-000000000001', 1, 10, 'club',    'country', 1, 11),
 ('44444444-0000-0000-0000-000000000001',11, 15, 'country', 'country', 3, 13);

-- ===========================================================================
--  Southern Cross Jiu-Jitsu
-- ===========================================================================

insert into organisation (id, parent_id, type, name, short_name, slug, path,
                          country_code, timezone, founded, settings)
values ('55555555-0000-0000-0000-000000000001', null, 'country',
        'Southern Cross Jiu-Jitsu', 'SCJJ', 'demo-bjj', 'demo_bjj',
        'AU', 'Australia/Sydney', '2009-06-01',
        jsonb_build_object(
          'demo', true,
          'discipline', 'Brazilian Jiu-Jitsu',
          'homePage', jsonb_build_object(
            'heroHeading', 'Everyone gets tapped. That is the lesson.',
            'heroText', 'Brazilian jiu-jitsu, gi and no-gi, at three academies. Beginners train in their own class for the first three months.',
            'heroButton', 'Find an academy'),
          'vocabulary', jsonb_build_object(
            'club', 'Academy', 'clubPlural', 'Academies',
            'grading', 'Promotion', 'grade', 'Belt')));

insert into organisation (parent_id, type, name, slug, path, country_code, timezone)
select '55555555-0000-0000-0000-000000000001', 'club', name, slug,
       ('demo_bjj.' || replace(slug, '-', '_'))::ltree, 'AU', 'Australia/Sydney'
from (values
  ('Newtown', 'newtown-bjj'), ('Fremantle', 'fremantle-bjj'),
  ('Brunswick', 'brunswick-bjj')
) as d(name, slug);

insert into brand (organisation_id, tokens, theme, fonts)
values ('55555555-0000-0000-0000-000000000001',
        '{"primary":"#2F4858","accent":"#E08A3C","ink":"#161A1D","canvas":"#F6F5F2","neutral":"#B3B8BC"}',
        'classic',
        '{"display":"Georgia","body":"system-ui"}');

-- No kyu, no dan, no numbers. Five belts, and the time between them is the
-- requirement that actually bites in this art.
insert into grade (organisation_id, label, short_label, belt_colour, belt_stripes,
                   rank_order, is_dan, min_months_at_previous, min_age, min_sessions)
select '55555555-0000-0000-0000-000000000001', label, short_label, colour, stripes,
       rank_order, is_dan, months, min_age, sessions
from (values
  ('White',  'W', '#F4F4F5', 0, 1, false, null, null, null),
  ('Blue',   'B', '#1F4E8C', 0, 2, false, 24,  16,  200),
  ('Purple', 'P', '#5B3A87', 0, 3, false, 18,  16,  300),
  ('Brown',  'Br','#6B4322', 0, 4, false, 12,  18,  300),
  ('Black',  'Bl','#1C1C1E', 0, 5, true,  12,  19,  400)
) as g(label, short_label, colour, stripes, rank_order, is_dan, months, min_age, sessions);

-- Professor is AWARDED, not conferred: a black belt is not automatically one.
insert into title (organisation_id, label, short_label, rank_order,
                   min_grade_order, max_grade_order, conferred_by_rank,
                   address_as, description)
values
 ('55555555-0000-0000-0000-000000000001','Coach','Coach',1,4,null,true,'Coach',
  'Runs classes. Held from brown belt.'),
 ('55555555-0000-0000-0000-000000000001','Professor','Professor',2,5,null,false,'Professor',
  'Awarded by the federation. A black belt is not automatically a Professor.');

-- The academy awards up to brown on its own. Black belt needs a Professor in
-- the room — a title, not a rank, because here the two are not the same thing.
insert into grade_authority (organisation_id, from_rank_order, to_rank_order,
                             awarded_by_type, ratified_by_type,
                             min_panel_size, min_panel_rank)
values ('55555555-0000-0000-0000-000000000001', 1, 4, 'club', null, 1, 4);

insert into grade_authority (organisation_id, from_rank_order, to_rank_order,
                             awarded_by_type, ratified_by_type,
                             min_panel_size, min_panel_rank, requires_title_id)
select '55555555-0000-0000-0000-000000000001', 5, 5, 'club', 'country', 1, 5, t.id
from title t
where t.organisation_id = '55555555-0000-0000-0000-000000000001'
  and t.label = 'Professor';

-- ---------------------------------------------------------------------------
-- Guards — a demo that half-loaded is worse than no demo
-- ---------------------------------------------------------------------------

do $$
declare uncovered text;
begin
  select string_agg(o.name || ': ' || g.label, ', ')
    into uncovered
  from grade g
  join organisation o on o.id = g.organisation_id
  where o.slug in ('demo-tkd', 'demo-bjj')
    and not exists (
      select 1 from grade_authority ga
      where ga.organisation_id = g.organisation_id
        and g.rank_order between ga.from_rank_order and ga.to_rank_order);

  if uncovered is not null then
    raise exception 'no grading authority covers: %', uncovered;
  end if;

  if not exists (
    select 1 from grade_authority ga
    join organisation o on o.id = ga.organisation_id
    where o.slug = 'demo-bjj' and ga.requires_title_id is not null
  ) then
    raise exception 'the BJJ black belt rule lost its Professor requirement';
  end if;
end $$;

-- ===========================================================================
--  SEED (DEMO) part 2 — enough content that the demo looks like a going concern
--
--  Same transaction as part one. A demo that half-loaded looks broken in a
--  way nobody can diagnose from the outside.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Venues and timetables
-- ---------------------------------------------------------------------------

insert into dojo_profile (organisation_id, venue_name, address_line, suburb, city,
                          postcode, phone, email, blurb, who_trains,
                          first_class_free, published)
select o.id, d.venue, d.addr, d.suburb, d.city, d.pc, d.phone, d.email,
       d.blurb, d.who, true, true
from (values
  ('tauranga-tkd','Greerton Hall','1230 Cameron Road','Greerton','Tauranga','3112',
   '+64 7 000 0000','tauranga@example.test',
   'We train in a sprung-floor hall with room for forty. Patterns, sparring and a lot of kicking.',
   'Families, mostly. Juniors early, adults after.'),
  ('rotorua-tkd','Westbrook School Hall','42 Devon Street','Westbrook','Rotorua','3015',
   '+64 7 000 0001','rotorua@example.test',
   'A small club that has run for twenty years out of the same school hall.',
   'A lot of teenagers, and their parents who joined later.'),
  ('hamilton-tkd','Te Rapa Sports Centre','88 Kahikatea Drive','Te Rapa','Hamilton','3200',
   '+64 7 000 0002','hamilton@example.test',
   'The federation''s largest dojang, and where the national promotion tests are held.',
   'Everyone from five-year-olds to competitors.'),
  ('matamata-tkd','Matamata Memorial Hall','24 Tainui Street',null,'Matamata','3400',
   '+64 7 000 0003','matamata@example.test',
   'Two nights a week in the memorial hall. Beginners are welcome any week.',
   'Small town, small club, everyone knows everyone.'),
  ('newtown-bjj','Newtown Academy','18 Wilson Street','Newtown','Sydney','2042',
   '+61 2 0000 0000','newtown@example.test',
   'Mats down seven days a week. Gi and no-gi, beginners in their own class for the first three months.',
   'Shift workers early, everyone else at six.'),
  ('fremantle-bjj','Fremantle Academy','7 Wray Avenue',null,'Fremantle','6160',
   '+61 8 0000 0001','fremantle@example.test',
   'A small room, a lot of rounds. Competition team trains Saturday mornings.',
   'Competitors and people who used to be competitors.'),
  ('brunswick-bjj','Brunswick Academy','410 Sydney Road',null,'Melbourne','3056',
   '+61 3 0000 0002','brunswick@example.test',
   'Fundamentals every evening, advanced class after. Women''s class Thursdays.',
   'Beginners, mostly. About a third have never trained before.')
) as d(slug, venue, addr, suburb, city, pc, phone, email, blurb, who)
join organisation o on o.slug = d.slug;

insert into training_session (organisation_id, label, weekday, starts, ends,
                              min_age, max_age, sort_order)
select o.id, s.label, s.wd, s.st::time, s.en::time, s.mina, s.maxa, s.ord
from (values
  ('tauranga-tkd','Juniors',            2,'16:30','17:15', 5, 12, 1),
  ('tauranga-tkd','Seniors',            2,'18:00','19:30',13,null,2),
  ('tauranga-tkd','All grades',         4,'18:00','19:30', 8,null,3),
  ('rotorua-tkd','Juniors',             1,'17:00','17:45', 5, 12, 1),
  ('rotorua-tkd','Seniors',             1,'18:00','19:30',13,null,2),
  ('hamilton-tkd','Little Dragons',     0,'16:00','16:40', 4,  6, 1),
  ('hamilton-tkd','Juniors',            0,'16:45','17:30', 7, 12, 2),
  ('hamilton-tkd','Seniors',            0,'18:00','19:45',13,null,3),
  ('hamilton-tkd','Black belt class',   5,'09:00','10:30',15,null,4),
  ('matamata-tkd','All grades',         1,'18:00','19:30', 7,null,1),
  ('matamata-tkd','All grades',         3,'18:00','19:30', 7,null,2),
  ('newtown-bjj','Fundamentals',        0,'06:00','07:00',16,null,1),
  ('newtown-bjj','Fundamentals',        0,'18:00','19:00',16,null,2),
  ('newtown-bjj','Advanced, gi',        0,'19:00','20:15',16,null,3),
  ('newtown-bjj','No-gi',               2,'18:00','19:15',16,null,4),
  ('fremantle-bjj','All levels',        1,'18:30','20:00',16,null,1),
  ('fremantle-bjj','Competition team',  5,'09:00','11:00',16,null,2),
  ('brunswick-bjj','Fundamentals',      3,'18:00','19:00',16,null,1),
  ('brunswick-bjj','Advanced',          3,'19:00','20:15',16,null,2),
  ('brunswick-bjj','Women''s class',    4,'18:30','19:45',16,null,3)
) as s(slug, label, wd, st, en, mina, maxa, ord)
join organisation o on o.slug = s.slug;

-- ---------------------------------------------------------------------------
-- People. Invented, and numbered so they cannot be mistaken for real records.
-- ---------------------------------------------------------------------------

insert into person (display_number, first_name, last_name, date_of_birth, gender, email)
values
 ('KTF-0001','Hana','Reweti','1979-04-11','F','hana@example.test'),
 ('KTF-0002','Peter','Nalder','1986-09-02','M','peter@example.test'),
 ('KTF-0003','Amira','Haddad','2009-01-19','F','amira@example.test'),
 ('KTF-0004','Josh','Fletcher','2014-07-23','M',null),
 ('KTF-0005','Linda','Cho','1971-11-30','F','linda@example.test'),
 ('SCJJ-0001','Marco','Ferreira','1984-02-14','M','marco@example.test'),
 ('SCJJ-0002','Kate','Ngata','1992-06-08','F','kate@example.test'),
 ('SCJJ-0003','Danny','Oyelaran','1998-10-27','M','danny@example.test'),
 ('SCJJ-0004','Priya','Raman','1995-03-05','F','priya@example.test');

insert into affiliation (person_id, organisation_id, role, starts, status, paid_until)
select p.id, o.id, a.role, a.starts::date, 'active', a.paid::date
from (values
  ('KTF-0005','hamilton-tkd','instructor','2001-02-01','2027-03-31'),
  ('KTF-0001','tauranga-tkd','instructor','2006-05-01','2027-03-31'),
  ('KTF-0002','rotorua-tkd','instructor','2012-02-01','2027-03-31'),
  ('KTF-0003','tauranga-tkd','member',    '2018-02-01','2027-03-31'),
  ('KTF-0004','matamata-tkd','member',    '2023-02-01','2026-12-31'),
  ('SCJJ-0001','newtown-bjj','instructor','2009-06-01','2027-06-30'),
  ('SCJJ-0002','fremantle-bjj','instructor','2013-01-01','2027-06-30'),
  ('SCJJ-0003','newtown-bjj','member',    '2019-08-01','2026-11-30'),
  ('SCJJ-0004','brunswick-bjj','member',  '2022-04-01','2027-06-30')
) as a(num, slug, role, starts, paid)
join person p on p.display_number = a.num
join organisation o on o.slug = a.slug;

insert into grading_record (person_id, grade_id, awarded_on, awarded_by_org, result)
select p.id, g.id, r.on_date::date, o.id, 'pass'
from (values
  ('KTF-0005','5th dan',  '2016-11-12','demo-tkd'),
  ('KTF-0001','4th dan',  '2019-11-09','demo-tkd'),
  ('KTF-0002','3rd dan',  '2021-11-13','demo-tkd'),
  ('KTF-0003','2nd geup', '2025-06-21','tauranga-tkd'),
  ('KTF-0004','8th geup', '2025-09-13','matamata-tkd'),
  ('SCJJ-0001','Black',   '2015-12-12','demo-bjj'),
  ('SCJJ-0002','Black',   '2021-12-04','demo-bjj'),
  ('SCJJ-0003','Purple',  '2024-07-20','newtown-bjj'),
  ('SCJJ-0004','Blue',    '2024-11-16','brunswick-bjj')
) as r(num, grade, on_date, org)
join person p on p.display_number = r.num
join organisation o on o.slug = r.org
join organisation fed on fed.id = coalesce(o.parent_id, o.id)
join grade g on g.label = r.grade and g.organisation_id = fed.id;

-- Marco is the one Professor, which is what lets the academy award a black belt.
insert into title_award (person_id, title_id, awarded_on, awarded_by_org)
select p.id, t.id, '2018-03-01'::date, o.id
from person p, title t, organisation o
where p.display_number = 'SCJJ-0001'
  and o.slug = 'demo-bjj' and t.organisation_id = o.id and t.label = 'Professor';

-- ---------------------------------------------------------------------------
-- Something on the calendar and something in the news
-- ---------------------------------------------------------------------------

insert into event (organisation_id, kind, title, slug, starts_at, visibility,
                   publish_down, entries_close, status)
select o.id, e.kind::event_kind, e.title, e.slug, e.starts::timestamptz, 'public', true,
       e.closes::timestamptz, 'published'
from (values
  ('demo-tkd','grading','National promotion test','national-promotion-test',
   '2026-11-14 09:00+13','2026-10-31 23:59+13'),
  ('demo-bjj','tournament','Southern Cross Open','southern-cross-open',
   '2026-11-28 08:00+11','2026-11-14 23:59+11')
) as e(slug_org, kind, title, slug, starts, closes)
join organisation o on o.slug = e.slug_org;

insert into article (organisation_id, slug, title, summary, body, tags,
                     about_org_id, status, published_at)
select o.id, a.slug, a.title, a.summary, a.body::jsonb, a.tags::text[],
       ab.id, 'published', now() - (a.days || ' days')::interval
from (values
  ('demo-tkd','hamilton-hosts-the-november-test','Hamilton hosts the November test',
   'Thirty-one candidates across four dojangs, and the first 4th dan test in three years.',
   '{"blocks":[{"type":"paragraph","text":"Thirty-one candidates are entered for the November promotion test at Te Rapa."}]}',
   '{grading}', 'hamilton-tkd', 6),
  ('demo-bjj','three-new-blue-belts-at-brunswick','Three new blue belts at Brunswick',
   'All three started in the beginners course eighteen months ago.',
   '{"blocks":[{"type":"paragraph","text":"Three new blue belts were awarded at Brunswick on Thursday night."}]}',
   '{promotion}', 'brunswick-bjj', 3)
) as a(fed, slug, title, summary, body, tags, about, days)
join organisation o on o.slug = a.fed
join organisation ab on ab.slug = a.about;

commit;
