-- applied-when: select not exists (select 1 from organisation d where d.parent_id is null and d.status = 'active' and coalesce((d.settings->>'demo')::boolean, false)) or not exists (select 1 from organisation r where r.parent_id is null and not coalesce((r.settings->>'demo')::boolean, false))
--
-- True when no demonstration federation is still open, or there is no real
-- federation beside one. See 022 for why a demonstration-only database is
-- left alone.
--
-- How tools/migrate.mjs tells whether this migration is already in a database.

-- ===========================================================================
--  A demonstration that cannot be deleted is closed and shut away
--
--  022 removed the demonstration federations from a real install, and left
--  alone any with history in the audit log. On the hosted database one of the
--  two was left, because somebody had clicked around in it, and the person
--  signed in still saw a taekwondo federation on their dashboard.
--
--  The audit log is append-only on purpose and this does not touch that. What
--  it does instead, for each demonstration still open:
--
--    1. try to remove it, exactly as 022 did
--    2. if that cannot be done, close it — status 'closed' — and take away
--       every grant that reaches it
--
--  Nobody can then see it, sign in to it or find it in a search, and the site
--  build no longer publishes it. Its history stays in the log, attached to a
--  federation that still exists, which is the point of a log.
-- ===========================================================================

do $$
declare
  demo   record;
  ids    uuid[];
  gone   uuid[];
  tidy   boolean;
begin
  for demo in
    select id, name, slug, path from organisation
    where parent_id is null and status = 'active'
      and coalesce((settings->>'demo')::boolean, false)
  loop
    if not exists (select 1 from organisation r
                   where r.parent_id is null
                     and not coalesce((r.settings->>'demo')::boolean, false)) then
      raise notice 'Left % alone: it is the only federation here.', demo.name;
      continue;
    end if;

    select array_agg(id) into ids from organisation where path <@ demo.path;
    tidy := false;

    if exists (select 1 from audit_log where organisation_id = any(ids)) then
      raise notice '% has history in the audit log, so it will be closed, not deleted.',
        demo.name;
    else
      begin
        select array_agg(distinct a.person_id) into gone
        from affiliation a
        where a.organisation_id = any(ids)
          and not exists (select 1 from affiliation b
                          where b.person_id = a.person_id
                            and b.organisation_id <> all(ids));

        delete from article         where organisation_id = any(ids);
        delete from event           where organisation_id = any(ids);
        delete from grading_record  where awarded_by_org  = any(ids);
        delete from title_award     where awarded_by_org  = any(ids);
        delete from affiliation     where organisation_id = any(ids);
        delete from person          where id = any(coalesce(gone, '{}'));
        delete from grade_authority where organisation_id = any(ids);
        delete from account where email = 'demo+' || demo.slug || '@example.invalid';
        delete from organisation    where id = any(ids);
        raise notice 'Removed the demonstration federation %.', demo.name;
        tidy := true;
      exception when others then
        raise notice 'Could not delete % (%), so it will be closed instead.',
          demo.name, sqlerrm;
      end;
    end if;

    if not tidy then
      update organisation set status = 'closed', updated_at = now()
      where id = any(ids);
      delete from grant_role where organisation_id = any(ids);
      delete from account where email = 'demo+' || demo.slug || '@example.invalid';
      raise notice 'Closed the demonstration federation % and removed every grant to it.',
        demo.name;
    end if;
  end loop;
end $$;
