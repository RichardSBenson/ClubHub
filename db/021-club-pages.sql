-- applied-when: select exists (select 1 from information_schema.columns where table_name in ('dojo_profile','club_profile') and column_name = 'hero_asset_id')
--
-- How tools/migrate.mjs tells whether this migration is already in a database.

-- ===========================================================================
--  A club's page on the federation's website is switched on, not assumed
--
--  dojo_profile.published has existed since the first schema, commented
--  "never publish a half-filled page", and nothing ever read it: the build
--  wrote a page for every active club, so a club that had told the federation
--  nothing was published with "[Two or three sentences from the dojo operator]"
--  in it. This gives the column its meaning and the rest of what it needs.
--
--    published          live on the federation's site
--    page_requested_at  the club has asked; the federation has not answered
--    page_note          the federation's reason, when it says no
--
--  Nothing here is backfilled. A club with no profile has told nobody
--  anything, and a page for it was never something it chose.
-- ===========================================================================

alter table dojo_profile
  add column hero_asset_id     uuid references asset(id) on delete set null,
  add column page_requested_at timestamptz,
  add column page_note         text,
  add column published_by      uuid references account(id),
  add column published_at      timestamptz;
