-- applied-when: select not exists (select 1 from organisation where path='moknz' and not (settings ? 'vocabulary'))
--
-- Reads as "there is no MOKNZ row still missing its vocabulary", which is
-- true both after this has run and on any install that has no MOKNZ at all.
-- This is the one migration here that repairs a particular federation's data
-- rather than changing the schema, and a buyer installing Honbu for their own
-- federation should never see it run.
--
-- How tools/migrate.mjs tells whether this migration is already in a
-- database. True means it is, and the migration is recorded without being
-- run again — which is what lets a database that predates the runner be
-- baselined honestly rather than guessed at.

-- ===========================================================================
--  A federation's words belong to the federation, not to the deployment
--
--  data/settings.json holds MOKNZ's vocabulary — Dojo, Grading, Grade — and
--  that was right while one install meant one federation. It is read once at
--  startup and applied to every screen.
--
--  It stopped being right the moment an account could see more than one
--  federation. The file is the deployment's settings, belonging to whichever
--  federation was installed first, so a jiu-jitsu academy on the same screen
--  was being called a dojo. Federations founded through tools/found.mjs never
--  had this problem: it writes their words into organisation.settings, where
--  they are the federation's own and travel with it.
--
--  MOKNZ predates that tool, so its words were only ever in the file. This
--  puts them where everyone else's live. The file stays — the public site
--  build reads it, and on a single-federation install it is still the natural
--  place to hand-edit them.
--
--  Idempotent: merges into settings rather than replacing, and leaves any
--  vocabulary already there alone.
-- ===========================================================================

update organisation
   set settings = jsonb_set(
         settings, '{vocabulary}',
         '{"club":"Dojo","clubPlural":"Dojo","grade":"Grade","grading":"Grading"}'::jsonb,
         true),
       updated_at = now()
 where path = 'moknz'
   and not (settings ? 'vocabulary');

-- Dojo is deliberately its own plural. 道場 does not inflect, and MOKNZ chose
-- to keep that in English; the settings file has said so in a comment for as
-- long as it has existed. Another karate federation may well prefer "Dojos",
-- and tools/found.mjs offers exactly that. Both are the federation's call,
-- which is the whole point.
