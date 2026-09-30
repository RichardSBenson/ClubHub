-- applied-when: select exists (select 1 from information_schema.columns where table_name='grade_authority' and column_name='requires_title_id')
--
-- How tools/migrate.mjs tells whether this migration is already in a
-- database. True means it is, and the migration is recorded without being
-- run again — which is what lets a database that predates the runner be
-- baselined honestly rather than guessed at.

-- ===========================================================================
--  010 — a grading authority may require a title on the panel
--
--  Schema only. Some federations gate a grading on a title rather than a rank:
--  kendo, iaido and kyudo award shogo separately from dan grade, so "a Kyoshi
--  must sit on this panel" is not expressible as a number. Others confer their
--  titles from grade, where a rank says the same thing more simply.
--
--  Which of those a federation does is its own business. This column only
--  makes the first one possible.
-- ===========================================================================

alter table grade_authority
  add column if not exists requires_title_id uuid references title(id);

comment on column grade_authority.requires_title_id is
  'At least one panel member must hold this title. Null means no requirement.';
