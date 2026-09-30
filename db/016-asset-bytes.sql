-- applied-when: select to_regclass('public.asset_blob') is not null
--
-- How tools/migrate.mjs tells whether this migration is already in a
-- database. True means it is, and the migration is recorded without being
-- run again — which is what lets a database that predates the runner be
-- baselined honestly rather than guessed at.

-- ===========================================================================
--  Where a federation's images actually live
--
--  The asset table was written with a storage_key — a pointer into somewhere
--  else, S3 or a blob service. Nothing ever wrote one, so every image block
--  on every page has rendered as nothing at all. The renderer looks up
--  data.assets[assetId], misses, and returns an empty string without
--  complaining.
--
--  The bytes go here instead, in the federation's own database.
--
--  One install is one federation, with its own database, possibly in another
--  country. That is the whole architecture, and data residency is the reason
--  for it. A blob service means another account to open, another set of
--  credentials to keep, another thing to misconfigure, and photographs of a
--  federation's children sitting in a region nobody chose. Putting the bytes
--  in the database it already has means residency follows the database,
--  backups already cover it, and there is nothing extra to set up on install.
--
--  The public site is built at deploy, so these are written out as real files
--  into the build. Nothing serves an image from the database on the public
--  side; the serving route exists for the admin preview alone.
--
--  A separate table, not a column on asset, so that listing a media library
--  does not drag megabytes through the connection to show a filename.
-- ===========================================================================

create table if not exists asset_blob (
  asset_id  uuid primary key references asset(id) on delete cascade,
  bytes     bytea not null
);

comment on table asset_blob is
  'Image bytes. Separate from asset so listing metadata stays cheap.';

-- storage_key was the pointer into a store that never existed. It stays, but
-- it is no longer something the caller must invent: an asset whose bytes are
-- here is keyed by its own id. Making it default lets the insert leave it out
-- rather than pass a fiction.
alter table asset alter column storage_key set default '';

-- The media library lists one federation's assets, newest first.
create index if not exists asset_organisation_idx on asset (organisation_id, created_at desc);

-- Note for later, not solved here: a page's image block holds an assetId, and
-- nothing stops the asset being deleted while a published page still points at
-- it. The block would silently empty again, which is the exact failure this
-- migration exists to end. Deleting an asset should either refuse while it is
-- referenced or report which pages use it — a job for the media library, once
-- there is something in it to delete.
