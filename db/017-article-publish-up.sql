-- applied-when: select exists (select 1 from information_schema.columns where table_name='article' and column_name='publish_up_state')
--
-- How tools/migrate.mjs tells whether this migration is already in a database.

-- ===========================================================================
--  A dojo asks; the federation decides
--
--  article.publish_up and publish_down existed and nothing honoured them, so
--  anything a dojo posted appeared on the national site whether the dojo meant
--  it to or not — and whether the federation wanted its name on it or not.
--
--  Richard's reason for wanting approval, which is the right one: people write
--  strange things, sincerely held and not factual, and a federation's name on
--  a page is an endorsement whether it was meant as one or not. A dojo should
--  be free to say what it likes on its own site and should not be able to put
--  it in the federation's voice by itself.
--
--  Events already work exactly this way. This gives articles the same column
--  and the same four states rather than inventing a second mechanism that
--  behaves almost the same.
--
--    none       nobody has asked
--    requested  the dojo has asked and is waiting
--    approved   the federation has agreed; it appears on their site
--    declined   the federation has said no; it stays on the dojo's own site
--
--  Declined is a real state and not a deletion. The article is still the
--  dojo's, still published, still on their own site. What was refused is the
--  federation's endorsement, and a dojo that is told "no" should be able to
--  see that it was told no.
-- ===========================================================================

alter table article
  add column if not exists publish_up_state text not null default 'none';

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'article_publish_up_state_check') then
    alter table article add constraint article_publish_up_state_check
      check (publish_up_state in ('none','requested','approved','declined'));
  end if;
end $$;

-- Anything already marked publish_up was marked before anybody could approve
-- it, so it is a request, not a decision. Setting it to 'approved' would put
-- words in the federation's mouth retrospectively.
update article
   set publish_up_state = 'requested'
 where publish_up and publish_up_state = 'none';

comment on column article.publish_up_state is
  'none | requested | approved | declined. Only approved appears on an '
  'ancestor''s site. Declined still appears on the author''s own.';
