-- applied-when: select exists (select 1 from pg_indexes where indexname='session_kind_idx')
--
-- How tools/migrate.mjs tells whether this migration is already in a
-- database. True means it is, and the migration is recorded without being
-- run again — which is what lets a database that predates the runner be
-- baselined honestly rather than guessed at.

-- ===========================================================================
--  013 — a session knows whether it is a demonstration
--
--  A demo visitor gets a real session against a real federation, because a
--  register you cannot click around is not a demonstration of anything. What
--  they must not get is the ability to change a record, or any sight of
--  another federation's.
--
--  The second part is already handled: visibility is by grant, and a grant at
--  one federation sees that federation's subtree and nothing else.
--
--  The first part is this column. Role alone would nearly do it — an
--  instructor cannot award a grade or publish a page — but "nearly" is the
--  wrong standard for a door left open on the internet. The server refuses
--  every write on a demo session outright, whatever the role says, so a new
--  route added later is safe by default rather than safe if someone
--  remembered.
-- ===========================================================================

alter table session
  add column if not exists kind text not null default 'normal'
  check (kind in ('normal', 'bootstrap', 'demo'));

comment on column session.kind is
  'demo sessions are refused every write by the server, regardless of role.';

create index if not exists session_kind_idx on session (kind)
  where kind <> 'normal';
