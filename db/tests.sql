-- ===========================================================================
--  Tests — the five behaviours the whole product rests on
-- ===========================================================================

\echo ''
\echo '=== 1. CURRENT GRADE IS DERIVED, NEVER STORED ==='
select p.display_number, p.first_name || ' ' || p.last_name as name,
       cg.label as current_grade, cg.awarded_on,
       date_part('year', age(p.date_of_birth))::int as age
from person p
left join person_current_grade cg on cg.person_id = p.id
order by cg.rank_order desc nulls last;

\echo ''
\echo '=== 2. THE REGISTER IS A HISTORY, AND IT BELONGS TO THE PERSON ==='
select p.first_name, g.label, gr.awarded_on, o.name as awarded_by
from grading_record gr
join person p on p.id = gr.person_id
join grade g on g.id = gr.grade_id
join organisation o on o.id = gr.awarded_by_org
where p.display_number = 'NZ-0417'
order by g.rank_order;

\echo ''
\echo '=== 3. VISIBILITY IS DOWN-BRANCH ONLY ==='
\echo '-- Doug (owner at national) can act on:'
select count(*) as orgs_visible from visible_orgs('33333333-0000-0000-0000-000000000001');

\echo '-- Tane (administrator at Wellington) can act on:'
select o.name from visible_orgs('33333333-0000-0000-0000-000000000003') v
join organisation o on o.id = v.organisation_id;

\echo '-- Can Tane act on Whanganui? (must be false)'
select has_role_at('33333333-0000-0000-0000-000000000003',
        (select id from organisation where slug='whanganui'),
        array['owner','administrator']::role_name[]) as tane_sees_whanganui;

\echo '-- Can Doug act on Whanganui? (must be true)'
select has_role_at('33333333-0000-0000-0000-000000000001',
        (select id from organisation where slug='whanganui'),
        array['owner','administrator']::role_name[]) as doug_sees_whanganui;

\echo ''
\echo '=== 4. GRADING AUTHORITY — WHO MAY AWARD WHAT ==='
select g.label,
       ga.awarded_by_type as awarded_by,
       ga.ratified_by_type as ratified_by,
       ga.min_panel_size as panel,
       pg.label as panel_must_hold
from grade g
join grade_authority ga
  on g.rank_order between ga.from_rank_order and ga.to_rank_order
 and ga.organisation_id = g.organisation_id
left join grade pg on pg.rank_order = ga.min_panel_rank
                  and pg.organisation_id = ga.organisation_id
where g.label in ('8th kyu','2nd kyu','Shodan','Sandan')
order by g.rank_order;

\echo ''
\echo '=== 5. ELIGIBILITY — COMPUTED, NOT REMEMBERED ==='
\echo '-- Who is eligible for their next grade right now?'
with current as (
  select p.id, p.first_name, p.date_of_birth,
         cg.rank_order, cg.awarded_on, cg.label as holds
  from person p join person_current_grade cg on cg.person_id = p.id
),
next as (
  select c.*, g.label as next_grade, g.rank_order as next_order,
         g.min_months_at_previous, g.min_age, g.min_sessions
  from current c
  join grade g on g.rank_order = c.rank_order + 1
             and g.organisation_id = '11111111-1111-1111-1111-111111111111'
),
checked as (
  select n.*,
    (select count(*) from attendance a
      where a.person_id = n.id and a.session_date > n.awarded_on) as sessions_since,
    (date_part('year', age(n.awarded_on))*12
     + date_part('month', age(n.awarded_on)))::int as months_since,
    date_part('year', age(n.date_of_birth))::int as age_now
  from next n
)
select first_name, holds, next_grade,
       months_since || '/' || coalesce(min_months_at_previous,0) as months,
       sessions_since || '/' || coalesce(min_sessions,0) as sessions,
       age_now || '/' || coalesce(min_age,0) as age,
       case when months_since >= coalesce(min_months_at_previous,0)
             and sessions_since >= coalesce(min_sessions,0)
             and age_now >= coalesce(min_age,0)
            then 'ELIGIBLE' else 'not yet' end as verdict
from checked
order by next_order desc;

\echo ''
\echo '=== 6. EVENT SCOPING ==='
\echo '-- What appears on the Whanganui dojo page?'
select e.title, o.name as from_org, e.visibility,
       case when e.min_rank_order is not null
            then 'min ' || (select label from grade where rank_order = e.min_rank_order
                            and organisation_id = '11111111-1111-1111-1111-111111111111')
            else 'all' end as restricted_to
from event e
join organisation o on o.id = e.organisation_id
join organisation w on w.slug = 'whanganui'
where e.status = 'published'
  and (
    e.organisation_id = w.id                                  -- its own events
    or (e.publish_down and w.path <@ o.path)                  -- inherited from above
  )
order by e.starts_at;

\echo ''
\echo '-- What appears on the Wellington dojo page? (no fight night — not theirs)'
select e.title
from event e
join organisation o on o.id = e.organisation_id
join organisation w on w.slug = 'wellington'
where e.status = 'published'
  and (e.organisation_id = w.id or (e.publish_down and w.path <@ o.path))
order by e.starts_at;

\echo ''
\echo '-- Can Aroha (4th kyu) enter the black belt seminar? (must be false)'
select e.title,
       cg.label as her_grade,
       cg.rank_order >= e.min_rank_order as eligible
from event e
cross join person_current_grade cg
where e.slug = 'black-belt-seminar-nov'
  and cg.person_id = '22222222-0000-0000-0000-000000000002';

\echo ''
\echo '=== 7. AFFILIATION INVOICE — GENERATED FROM THE REGISTER ==='
select o.name as dojo,
       count(*) filter (where a.status = 'active') as active_members,
       to_char(count(*) filter (where a.status='active') * 40.00, 'FM$999,990.00') as owed_to_national
from organisation o
join affiliation a on a.organisation_id = o.id and a.role = 'member' and a.ends is null
where o.type = 'dojo'
group by o.name
order by active_members desc;
