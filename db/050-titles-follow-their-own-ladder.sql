-- 050 — a title is conferred by the ladder of the organisation that owns it, and by no other.
-- applied-when: select exists (select 1 from pg_views where viewname = 'person_title' and definition like '%g.organisation_id = t.organisation_id%')
--
-- person_title matched every organisation's conferred titles against a person's grade number alone. Where two
-- federations are in one database, a MOKNZ 4th dan could come out as a taekwondo "Sabeom". A conferred title now
-- applies only when it belongs to the organisation whose grade the person holds.

create or replace view person_title as
  select cg.person_id, t.id as title_id, t.organisation_id, t.label,
         t.short_label, t.rank_order, t.address_as,
         'conferred'::text as how, null::date as awarded_on
  from person_current_grade cg
  join grade g on g.id = cg.grade_id
  join title t
    on t.conferred_by_rank
   and g.organisation_id = t.organisation_id
   and cg.rank_order >= coalesce(t.min_grade_order, 0)
   and (t.max_grade_order is null or cg.rank_order <= t.max_grade_order)
  union all
  select ta.person_id, t.id, t.organisation_id, t.label, t.short_label,
         t.rank_order, t.address_as, 'awarded', ta.awarded_on
  from title_award ta
  join title t on t.id = ta.title_id;
