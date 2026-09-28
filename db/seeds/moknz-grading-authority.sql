-- ===========================================================================
--  SEED (MOKNZ) — grading authority bands
--
--  MOKNZ's actual rule, which the placeholder bands did not express:
--
--    10th kyu to 3rd kyu   the dojo grades them
--    2nd kyu and 1st kyu   a Shihan must see it
--    Shodan and above      a national grading
--
--  The middle band is the reason for this migration. It is not a rank rule.
--  MOKNZ confers Shihan from yondan, so today "a Shihan" and "4th dan or
--  above" pick out the same people — but they are not the same rule, and a
--  federation that awards its senior titles individually would find the rank
--  version quietly promoting anyone who reached the grade. Ask the register
--  who holds the title.
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
-- Guards
--
-- The 2nd/1st kyu band is inserted from a select against title. If the titles
-- have not been seeded that select matches nothing, the insert quietly adds no
-- row, and the band simply ceases to exist — nobody finds out until a dojo
-- tries to grade a 1st kyu and is told no rule covers it. So check, here,
-- while there is still someone watching the migration run.
-- ---------------------------------------------------------------------------

do $$
declare
  uncovered text;
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
    raise exception
      'no grading authority covers: %. Seed the titles before this migration.',
      uncovered;
  end if;

  select count(*) into dangling
  from grade_authority ga
  where ga.requires_title_id is not null
    and not exists (select 1 from title t where t.id = ga.requires_title_id);

  if dangling > 0 then
    raise exception 'grade_authority references % title(s) that do not exist', dangling;
  end if;
end $$;
