/**
 * Carries out the dojo register's three CSV files against the database.
 *
 * Used by the Register import screen and by import/import.mjs. It runs inside the caller's
 * transaction on the caller's client, so a preview is the same code as the real thing followed by
 * a rollback: what is shown is what would happen.
 *
 * Re-runnable. Blank means unknown and is stored as NULL.
 */

import { nul, num, yes, DAYS, publishable } from '../core/domain/register-csv.mjs';

export async function applyRegister(client, { dojos = [], sessions = [], instructors = [] }) {
  const report = { notes: [], added: [], updated: 0, published: 0, held: [], people: { added: 0, instructors: 0, graded: 0 } };
  const byDojo = new Map();
  for (const s of sessions) { if (!byDojo.has(s.slug)) byDojo.set(s.slug, []); byDojo.get(s.slug).push(s); }

  const { rows: [root] } = await client.query(
    'select id, path, country_code, timezone, coalesce(short_name, slug) as prefix from organisation where parent_id is null order by created_at limit 1');
  if (!root) { report.notes.push('There is no federation to put dojo under.'); return report; }

  for (const row of dojos) {
    let { rows: [org] } = await client.query('select id, name from organisation where slug = $1', [row.slug]);
    if (!org && row.name) {
      // A dojo the register does not have yet is added beneath the federation, the way Add a club does.
      ({ rows: [org] } = await client.query(`
        insert into organisation (parent_id, type, name, slug, path, country_code, timezone, status)
        values ($1,'club',$2,$3,($4 || '.' || $5)::ltree,$6,$7,'active') returning id, name`,
        [root.id, row.name, row.slug, root.path, row.slug.replace(/-/g, '_'),
         nul(row.country) ?? root.country_code, nul(row.timezone) ?? root.timezone]));
      report.added.push(row.name);
    }
    if (!org) { report.notes.push(`No organisation with slug "${row.slug}": skipped.`); continue; }

    const mine = byDojo.get(row.slug) ?? [];
    const missing = publishable(row, mine.length);
    const willPublish = yes(row.publish) && missing.length === 0;
    if (yes(row.publish) && missing.length) report.held.push({ slug: row.slug, name: row.name || row.slug, missing });

    await client.query(`
      insert into dojo_profile (organisation_id, venue_name, address_line, suburb,
        city, postcode, latitude, longitude, directions, phone, email, blurb,
        who_trains, published, updated_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
      on conflict (organisation_id) do update set
        venue_name=excluded.venue_name, address_line=excluded.address_line,
        suburb=excluded.suburb, city=excluded.city, postcode=excluded.postcode,
        latitude=excluded.latitude, longitude=excluded.longitude,
        directions=excluded.directions, phone=excluded.phone, email=excluded.email,
        blurb=excluded.blurb, who_trains=excluded.who_trains,
        published=excluded.published, updated_at=now()`,
      [org.id, nul(row.venue_name), nul(row.address_line), nul(row.suburb),
       nul(row.city), nul(row.postcode), num(row.latitude), num(row.longitude),
       nul(row.directions), nul(row.phone), nul(row.email), nul(row.blurb),
       nul(row.who_trains), willPublish]);

    if (mine.length) {
      await client.query('delete from training_session where organisation_id = $1', [org.id]);
      let order = 0;
      for (const s of mine) {
        const wd = DAYS.indexOf(String(s.weekday).trim().toLowerCase());
        if (wd < 0) { report.notes.push(`"${s.weekday}" is not a weekday: skipped (${row.slug}).`); continue; }
        await client.query(`
          insert into training_session (organisation_id, label, weekday, starts, ends, min_age, max_age, sort_order)
          values ($1,$2,$3,$4::time,$5::time,$6,$7,$8)`,
          [org.id, s.label, wd, s.starts, s.ends, num(s.min_age), num(s.max_age), order++]);
      }
    }
    report.updated++;
    if (willPublish) report.published++;
  }

  // Instructors: on their dojo's roll as instructors, at the dan they hold. This does not put them on the
  // website; that needs their own consent, a write-up and current checks.
  if (instructors.length) {
    const prefix = String(root.prefix).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5) || 'M';
    const { rows: [seq] } = await client.query(
      `select coalesce(max(substring(display_number from '[0-9]+$')::int), 0) as last from person where display_number like $1`, [`${prefix}-%`]);
    let next = seq.last;
    const { rows: ladder } = await client.query('select id, rank_order from grade where organisation_id = $1 and is_dan', [root.id]);
    for (const r of instructors) {
      const { rows: [org] } = await client.query('select id from organisation where slug = $1', [r.slug]);
      if (!org) { report.notes.push(`No dojo "${r.slug}" for ${r.first_name} ${r.last_name}: skipped.`); continue; }
      const first = String(r.first_name).trim(), last = String(r.last_name).trim();
      // The same name on another dojo's roll is the same person (two people teach at two dojo), unless the row says it is not.
      let { rows: [who] } = await client.query(
        `select p.id from person p where lower(p.first_name) = lower($1) and lower(p.last_name) = lower($2)
           and ($3 or exists (select 1 from affiliation a where a.person_id = p.id and a.organisation_id = $4))
         order by p.created_at limit 1`, [first, last, !yes(r.distinct), org.id]);
      if (!who) {
        next += 1;
        ({ rows: [who] } = await client.query(
          `insert into person (display_number, first_name, last_name) values ($1,$2,$3) returning id`,
          [`${prefix}-${String(next).padStart(4, '0')}`, first, last]));
        report.people.added++;
      }
      const { rows: [aff] } = await client.query(
        'select id, role from affiliation where person_id = $1 and organisation_id = $2 and ends is null', [who.id, org.id]);
      if (!aff) {
        await client.query(`insert into affiliation (person_id, organisation_id, role, starts, status) values ($1,$2,'instructor',current_date,'active')`, [who.id, org.id]);
        report.people.instructors++;
      } else if (aff.role === 'member') {
        await client.query(`update affiliation set role = 'instructor' where id = $1`, [aff.id]);
        report.people.instructors++;
      }
      const target = ladder.find((g) => g.rank_order === 10 + Number(r.dan));
      if (target) {
        const { rows: [held] } = await client.query(
          `select max(g.rank_order) as top from grading_record gr join grade g on g.id = gr.grade_id where gr.person_id = $1 and gr.result = 'pass'`, [who.id]);
        if (!held.top || held.top < target.rank_order) {
          await client.query(`insert into grading_record (person_id, grade_id, awarded_on, awarded_by_org, result, panel, notes) values ($1,$2,current_date,$3,'pass','[]',$4)`,
            [who.id, target.id, org.id, "Held on joining. Imported from the dojo's own records; not graded through this system."]);
          report.people.graded++;
        }
      }
    }
  }
  return report;
}
