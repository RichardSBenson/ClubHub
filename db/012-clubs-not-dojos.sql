-- ===========================================================================
--  012 — the leaf organisation is a club, not a dojo
--
--  Dojo is karate's and judo's word. A taekwondo school is a dojang, a kung fu
--  school a kwoon, a BJJ school an academy, a Muay Thai school a gym. Having
--  one art's vocabulary in a shared enum means every other federation reads
--  somebody else's language in its own register.
--
--  The stored value becomes the neutral token. What each federation CALLS its
--  clubs is a label it configures, and the website and the admin both read it
--  from the same place, so a member's card says Dojang if that is the word.
--
--  Renaming the enum value keeps every existing row valid — no rewrite, no
--  downtime. The application compares on ::text and accepts both spellings, so
--  this migration and the code that goes with it can be applied in either
--  order without a window where clubs disappear from the site.
-- ===========================================================================

do $$
begin
  if exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'org_type' and e.enumlabel = 'dojo'
  ) then
    alter type org_type rename value 'dojo' to 'club';
  end if;
end $$;

do $$
declare leftover int;
begin
  select count(*) into leftover
  from pg_enum e join pg_type t on t.oid = e.enumtypid
  where t.typname = 'org_type' and e.enumlabel = 'dojo';

  if leftover > 0 then
    raise exception 'org_type still has a dojo value';
  end if;
end $$;
