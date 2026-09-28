-- ===========================================================================
--  011 — MOKNZ's dan ladder is named, not numbered, from 5th dan up
--
--  Corrects 010 and the original seed. The ladder is:
--
--    11  Shodan      1st dan
--    12  Nidan       2nd dan
--    13  Sandan      3rd dan
--    14  Yondan      4th dan
--    15  Shihan      5th dan
--    16  Renshi      6th dan
--    17  Kyoshi      7th dan
--    18  Hanshi      8th dan
--
--  Shihan, Renshi, Kyoshi and Hanshi are GRADES here, not titles awarded
--  alongside a numbered grade. That reverses the decision 010 made. 010
--  expressed "2nd and 1st kyu must be seen by a Shihan" as a required title,
--  on the reasoning that a title is not a rank. In MOKNZ it is: Shihan is 5th
--  dan, and the requirement is 5th dan or above.
--
--  Which also settles it the other way round. Encoding it as a title would
--  now be wrong, because seniority is cumulative and a title band is not: a
--  Hanshi is obviously entitled to see a 1st kyu grading, and a rule that
--  asked for the Shihan title would have turned the most senior person in the
--  federation away. min_panel_rank says "15 or above" and means it.
--
--  requires_title_id stays on the table. Federations that award titles
--  independently of grade still need it; MOKNZ simply does not.
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
values ('11111111-1111-1111-1111-111111111111', 1, 8, 'dojo', 'country', 1, 11);

-- 2nd and 1st kyu: the dojo's grading, seen by a Shihan — 5th dan or above.
insert into grade_authority (organisation_id, from_rank_order, to_rank_order,
                             awarded_by_type, ratified_by_type,
                             min_panel_size, min_panel_rank)
values ('11111111-1111-1111-1111-111111111111', 9, 10, 'dojo', 'country', 1, 15);

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
