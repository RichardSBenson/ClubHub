-- applied-when: select not exists (select 1 from organisation d where d.parent_id is null and coalesce((d.settings->>'demo')::boolean, false)) or not exists (select 1 from organisation r where r.parent_id is null and not coalesce((r.settings->>'demo')::boolean, false))
--
-- True when there is nothing for this to do: no demonstration federation, or
-- no real one beside it. That second half is deliberate. A database holding
-- only a demonstration is somebody evaluating Honbu, and is left alone.
--
-- How tools/migrate.mjs tells whether this migration is already in a database.

-- ===========================================================================
--  A real install has no demonstration federations in it
--
--  The demonstration federations (a taekwondo one and a jiu-jitsu one) were
--  loaded into the hosted database so Honbu could be shown running. They
--  stayed. A federation's own people then signed in, saw other arts' dojang
--  and academies on their dashboard, and rightly asked why.
--
--  This removes any federation marked demo:true from a database that also
--  holds a real one. It touches nothing else: not the real federation, not
--  its people, and not anyone's sign-in beyond the demonstration accounts.
--
--  It cannot fail a deploy. Each demonstration is removed inside its own
--  sub-transaction, and one that cannot be removed is left where it is with a
--  notice saying why. In particular, anything with history in the audit log
--  stays: that table is append-only on purpose, and a migration is not the
--  place to make an exception to it.
-- ===========================================================================

do $$
declare
  demo   record;
  ids    uuid[];
  gone   uuid[];
begin
  for demo in
    select id, name, slug, path from organisation
    where parent_id is null and coalesce((settings->>'demo')::boolean, false)
  loop
    if not exists (select 1 from organisation r
                   where r.parent_id is null
                     and not coalesce((r.settings->>'demo')::boolean, false)) then
      raise notice 'Left % alone: it is the only federation here.', demo.name;
      continue;
    end if;

    select array_agg(id) into ids from organisation where path <@ demo.path;

    if exists (select 1 from audit_log where organisation_id = any(ids)) then
      raise notice 'Left % in place: it has history in the audit log.', demo.name;
      continue;
    end if;

    begin
      -- People who belong only to this demonstration. Anybody who is also on
      -- another organisation's roll is a real person and stays.
      select array_agg(distinct a.person_id) into gone
      from affiliation a
      where a.organisation_id = any(ids)
        and not exists (select 1 from affiliation b
                        where b.person_id = a.person_id
                          and b.organisation_id <> all(ids));

      delete from article        where organisation_id = any(ids);
      delete from event          where organisation_id = any(ids);
      delete from grading_record where awarded_by_org  = any(ids);
      delete from title_award    where awarded_by_org  = any(ids);
      delete from affiliation    where organisation_id = any(ids);
      delete from person         where id = any(coalesce(gone, '{}'));
      delete from grade_authority where organisation_id = any(ids);
      -- The account that "Try the demo" signs in as, and nobody else's.
      delete from account where email = 'demo+' || demo.slug || '@example.invalid';
      delete from organisation   where id = any(ids);

      raise notice 'Removed the demonstration federation %.', demo.name;
    exception when others then
      raise notice 'Could not remove % (%), so it was left in place.',
        demo.name, sqlerrm;
    end;
  end loop;
end $$;
