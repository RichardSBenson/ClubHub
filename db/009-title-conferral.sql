-- ===========================================================================
--  How a title is obtained is itself configuration
--
--  I had assumed every title is awarded separately, which is true of shogo
--  (Renshi, Kyoshi, Hanshi) and wrong of most others. In many organisations
--  Senpai, Sensei and Shihan are conferred by reaching a grade — nobody awards
--  them, you simply are one.
--
--  And the vocabulary is not Japanese. Korean arts use Sabeom, Kyosa,
--  Kwanjang. Chinese arts use Sifu and Sigung. Brazilian jiu-jitsu uses
--  Professor and Coach. Capoeira uses Mestre and Contramestre.
--
--  So: the titles are rows, and how each is obtained is a column.
-- ===========================================================================

alter table title
  add column conferred_by_rank boolean not null default false,
  add column max_grade_order smallint,
  add column address_as text;

comment on column title.conferred_by_rank is
  'true: held automatically by anyone at min_grade_order and above. '
  'false: awarded individually and recorded in title_award.';

comment on column title.max_grade_order is
  'For conferred titles that stop applying once someone outranks them — '
  'a 2nd dan is Sensei, a 5th dan is Shihan, and only one applies.';

comment on column title.address_as is
  'How the person is addressed in writing, if it differs from the label.';

-- Every title a person holds: conferred by grade, and awarded individually.
create or replace view person_title as
  -- conferred
  select cg.person_id, t.id as title_id, t.organisation_id, t.label,
         t.short_label, t.rank_order, t.address_as,
         'conferred'::text as how, null::date as awarded_on
  from person_current_grade cg
  join title t
    on t.conferred_by_rank
   and cg.rank_order >= coalesce(t.min_grade_order, 0)
   and (t.max_grade_order is null or cg.rank_order <= t.max_grade_order)
  union all
  -- awarded
  select ta.person_id, t.id, t.organisation_id, t.label, t.short_label,
         t.rank_order, t.address_as, 'awarded', ta.awarded_on
  from title_award ta
  join title t on t.id = ta.title_id;

-- The one to use when addressing someone: highest held, awarded beating
-- conferred at the same level because it was earned separately.
drop view if exists person_current_title;
create view person_current_title as
select distinct on (person_id)
  person_id, title_id, organisation_id, label, short_label, rank_order,
  address_as, how, awarded_on
from person_title
order by person_id, rank_order desc,
         (how = 'awarded') desc, awarded_on desc nulls last;
