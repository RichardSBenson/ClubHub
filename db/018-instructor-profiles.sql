-- applied-when: select to_regclass('public.instructor_profile') is not null
--
-- How tools/migrate.mjs tells whether this migration is already in a database.

-- ===========================================================================
--  Instructors on the public site, sourced from the register
--
--  The build list asks for this twice: an Instructors page in the website CMS,
--  and "instructor profiles optionally sourced from people/qualification
--  system" in the website/organisation data integration. That word
--  "optionally" is doing real work, and this schema takes it literally.
--
--  Who instructs is already in the register — affiliation.role = 'instructor'.
--  What is NOT in the register is whether that person agreed to have their
--  name, their photograph and their grade on a website that anybody can read.
--  Those are different facts and this platform should not conflate them.
--
--  So: a row here is an opt-in, per organisation, defaulting to unpublished.
--  Deleting the row removes them from the site and leaves the register
--  untouched — they are still an instructor, they are just not on the website.
--
--  A person may instruct at more than one dojo and may be happy to appear on
--  one site and not another, which is why this is keyed by organisation and
--  person rather than hanging off the person alone.
--
--  The photograph is person.photo_asset_id — one picture of a person, not one
--  per dojo. The bio is per organisation, because what a club wants to say
--  about its instructor is not what the national body would say.
-- ===========================================================================

create table if not exists instructor_profile (
  id               uuid primary key default uuid_generate_v4(),
  organisation_id  uuid not null references organisation(id) on delete cascade,
  person_id        uuid not null references person(id) on delete cascade,

  -- What this organisation says about them. Blocks, like every other
  -- authored text in the system, so it goes through the same validator.
  bio              jsonb not null default '{"blocks":[]}',

  -- One line under the name: "Teaches Tuesday and Thursday", "Children's
  -- classes". Free text because no two federations would agree on a list.
  teaches          text,

  -- Unpublished until somebody says otherwise, and that somebody should have
  -- asked the instructor. A default of true here would mean every instructor
  -- in every federation appeared on a website the day this shipped.
  published        boolean not null default false,

  -- Who said yes, and when. Not an audit nicety: if an instructor later asks
  -- why they are on the internet, somebody has to be able to answer.
  published_by     uuid references account(id),
  published_at     timestamptz,

  sort_order       smallint not null default 0,
  created_at       timestamptz not null default now(),

  unique (organisation_id, person_id)
);

create index if not exists instructor_profile_org_idx
  on instructor_profile (organisation_id, sort_order, person_id);

comment on table instructor_profile is
  'An instructor''s opt-in to appear on one organisation''s public site. '
  'Who instructs is affiliation.role; this is whether they agreed to be '
  'published, which is a different fact about a different thing.';
