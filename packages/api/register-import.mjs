/**
 * Carries out the dojo register's three CSV files against the database.
 *
 * Used by the Register import screen and by import/import.mjs. It runs inside the caller's
 * transaction on the caller's client, so a preview is the same code as the real thing followed by
 * a rollback: what is shown is what would happen.
 *
 * Re-runnable. Blank means unknown and is stored as NULL.
 *
 * Written as a few bulk queries rather than one per row: on the live site every round trip to the database
 * costs real time, and a few hundred of them ran past the function's time limit.
 */

import { randomUUID } from 'node:crypto';
import { nul, num, yes, DAYS, publishable } from '../core/domain/register-csv.mjs';

export async function applyRegister(client, { dojos = [], sessions = [], instructors = [] }) {
  const report = { notes: [], added: [], updated: 0, published: 0, held: [], people: { added: 0, instructors: 0, graded: 0 } };
  const byDojo = new Map();
  for (const s of sessions) { if (!byDojo.has(s.slug)) byDojo.set(s.slug, []); byDojo.get(s.slug).push(s); }

  const { rows: [root] } = await client.query(
    'select id, path, country_code, timezone, coalesce(short_name, slug) as prefix from organisation where parent_id is null order by created_at limit 1');
  if (!root) { report.notes.push('There is no federation to put dojo under.'); return report; }

  // Every organisation any of the three files names, in one query.
  const slugs = [...new Set([...dojos, ...sessions, ...instructors].map((r) => r.slug).filter(Boolean))];
  const { rows: found } = await client.query('select id, name, slug from organisation where slug = any($1::text[])', [slugs]);
  const orgBySlug = new Map(found.map((o) => [o.slug, o]));

  // ---- dojo: add the ones the register does not have, then one upsert for all profiles --------------------------
  const profiles = [];
  for (const row of dojos) {
    let org = orgBySlug.get(row.slug);
    if (!org && row.name) {
      // A dojo the register does not have yet is added beneath the federation, the way Add a club does.
      ({ rows: [org] } = await client.query(`
        insert into organisation (parent_id, type, name, slug, path, country_code, timezone, status)
        values ($1,'club',$2,$3,($4 || '.' || $5)::ltree,$6,$7,'active') returning id, name, slug`,
        [root.id, row.name, row.slug, root.path, row.slug.replace(/-/g, '_'),
         nul(row.country) ?? root.country_code, nul(row.timezone) ?? root.timezone]));
      orgBySlug.set(row.slug, org);
      report.added.push(row.name);
    }
    if (!org) { report.notes.push(`No organisation with slug "${row.slug}": skipped.`); continue; }

    const mine = byDojo.get(row.slug) ?? [];
    const missing = publishable(row, mine.length);
    const willPublish = yes(row.publish) && missing.length === 0;
    if (yes(row.publish) && missing.length) report.held.push({ slug: row.slug, name: row.name || row.slug, missing });
    profiles.push({ org, row, willPublish });
    report.updated++;
    if (willPublish) report.published++;
  }
  if (profiles.length) {
    const col = (f) => profiles.map(({ row }) => nul(row[f]));
    await client.query(`
      insert into dojo_profile (organisation_id, venue_name, address_line, suburb, city, postcode,
        latitude, longitude, directions, phone, email, blurb, who_trains, published, updated_at)
      select * , now() from unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
        $7::numeric[], $8::numeric[], $9::text[], $10::text[], $11::text[], $12::text[], $13::text[], $14::boolean[])
      on conflict (organisation_id) do update set
        venue_name=excluded.venue_name, address_line=excluded.address_line,
        suburb=excluded.suburb, city=excluded.city, postcode=excluded.postcode,
        latitude=excluded.latitude, longitude=excluded.longitude,
        directions=excluded.directions, phone=excluded.phone, email=excluded.email,
        blurb=excluded.blurb, who_trains=excluded.who_trains,
        published=excluded.published, updated_at=now()`,
      [profiles.map((p) => p.org.id), col('venue_name'), col('address_line'), col('suburb'), col('city'), col('postcode'),
       profiles.map(({ row }) => num(row.latitude)), profiles.map(({ row }) => num(row.longitude)),
       col('directions'), col('phone'), col('email'), col('blurb'), col('who_trains'), profiles.map((p) => p.willPublish)]);
  }

  // ---- class times: a dojo that has any in the file has them replaced, in two queries ----------------------------
  const timed = [], ids = [];
  for (const { org, row } of profiles) {
    const mine = byDojo.get(row.slug) ?? [];
    if (!mine.length) continue;
    ids.push(org.id);
    let order = 0;
    for (const s of mine) {
      const wd = DAYS.indexOf(String(s.weekday).trim().toLowerCase());
      if (wd < 0) { report.notes.push(`"${s.weekday}" is not a weekday: skipped (${row.slug}).`); continue; }
      timed.push({ org: org.id, s, wd, order: order++ });
    }
  }
  if (ids.length) await client.query('delete from training_session where organisation_id = any($1::uuid[])', [ids]);
  if (timed.length) await client.query(`
    insert into training_session (organisation_id, label, weekday, starts, ends, min_age, max_age, sort_order)
    select * from unnest($1::uuid[], $2::text[], $3::int[], $4::time[], $5::time[], $6::int[], $7::int[], $8::int[])`,
    [timed.map((t) => t.org), timed.map((t) => t.s.label), timed.map((t) => t.wd), timed.map((t) => t.s.starts), timed.map((t) => t.s.ends),
     timed.map((t) => num(t.s.min_age)), timed.map((t) => num(t.s.max_age)), timed.map((t) => t.order)]);

  // ---- instructors: decided in memory from three lookups, written in four inserts -----------------------------
  // They go on the roll as members who also instruct. That does not put them on the website, which needs their
  // consent, a write-up and checks.
  if (instructors.length) {
    const prefix = String(root.prefix).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5) || 'M';
    const [{ rows: [seq] }, { rows: ladder }] = await Promise.all([
      client.query(`select coalesce(max(substring(display_number from '[0-9]+$')::int), 0) as last from person where display_number like $1`, [`${prefix}-%`]),
      client.query('select id, rank_order from grade where organisation_id = $1 and is_dan', [root.id]),
    ]);
    let next = seq.last;
    const key = (f, l) => `${String(f).trim().toLowerCase()}|${String(l).trim().toLowerCase()}`;
    const { rows: people } = await client.query(
      `select id, lower(first_name) f, lower(last_name) l from person
        where lower(first_name) = any($1::text[]) and lower(last_name) = any($2::text[]) order by created_at`,
      [instructors.map((r) => String(r.first_name).trim().toLowerCase()), instructors.map((r) => String(r.last_name).trim().toLowerCase())]);
    const byName = new Map();
    for (const p of people) { const k = `${p.f}|${p.l}`; if (!byName.has(k)) byName.set(k, []); byName.get(k).push(p.id); }
    const known = people.map((p) => p.id);
    const [{ rows: affs }, { rows: tops }] = await Promise.all([
      client.query('select id, person_id, organisation_id, role from affiliation where person_id = any($1::uuid[]) and ends is null', [known]),
      client.query(`select gr.person_id, max(g.rank_order) top from grading_record gr join grade g on g.id = gr.grade_id
                     where gr.person_id = any($1::uuid[]) and gr.result = 'pass' group by gr.person_id`, [known]),
    ]);
    // An instructor is a member who also instructs: two rows, the way the instructor tick on a profile does it.
    const has = new Set(affs.map((a) => `${a.person_id}|${a.organisation_id}|${a.role}`));
    const top = new Map(tops.map((t) => [t.person_id, t.top]));
    // A person is a member of ONE dojo (their home); at any other dojo where they teach they are an instructor only.
    const homed = new Set(affs.filter((a) => a.role === 'member').map((a) => a.person_id));

    const newPeople = [], newAffs = [], newGrades = [];
    for (const r of instructors) {
      const org = orgBySlug.get(r.slug);
      if (!org) { report.notes.push(`No dojo "${r.slug}" for ${r.first_name} ${r.last_name}: skipped.`); continue; }
      const first = String(r.first_name).trim(), last = String(r.last_name).trim();
      const k = key(first, last);
      // The same name on another dojo's roll is the same person (two people teach at two dojo), unless the row says it is not.
      const candidates = byName.get(k) ?? [];
      let id = yes(r.distinct) ? candidates.find((c) => has.has(`${c}|${org.id}|member`) || has.has(`${c}|${org.id}|instructor`)) : candidates[0];
      if (!id) {
        id = randomUUID(); next += 1;
        newPeople.push({ id, number: `${prefix}-${String(next).padStart(4, '0')}`, first, last });
        byName.set(k, [...candidates, id]);
        report.people.added++;
      }
      for (const role of ['member', 'instructor']) {
        if (has.has(`${id}|${org.id}|${role}`)) continue;
        if (role === 'member' && homed.has(id)) continue;
        if (role === 'member') homed.add(id);
        newAffs.push({ id, org: org.id, role });
        has.add(`${id}|${org.id}|${role}`);
        if (role === 'instructor') report.people.instructors++;
      }
      const target = ladder.find((g) => g.rank_order === 10 + Number(r.dan));
      if (target && !(top.get(id) >= target.rank_order)) {
        newGrades.push({ id, grade: target.id, org: org.id });
        top.set(id, target.rank_order);
        report.people.graded++;
      }
    }
    if (newPeople.length) await client.query(
      `insert into person (id, display_number, first_name, last_name) select * from unnest($1::uuid[], $2::text[], $3::text[], $4::text[])`,
      [newPeople.map((p) => p.id), newPeople.map((p) => p.number), newPeople.map((p) => p.first), newPeople.map((p) => p.last)]);
    if (newAffs.length) await client.query(
      `insert into affiliation (person_id, organisation_id, role, starts, status)
       select p, o, r::role_name, current_date, 'active' from unnest($1::uuid[], $2::uuid[], $3::text[]) as t(p, o, r)`,
      [newAffs.map((a) => a.id), newAffs.map((a) => a.org), newAffs.map((a) => a.role)]);
    if (newGrades.length) await client.query(
      `insert into grading_record (person_id, grade_id, awarded_on, awarded_by_org, result, panel, notes)
       select p, g, current_date, o, 'pass', '[]', $4 from unnest($1::uuid[], $2::uuid[], $3::uuid[]) as t(p, g, o)`,
      [newGrades.map((x) => x.id), newGrades.map((x) => x.grade), newGrades.map((x) => x.org),
       "Held on joining. Imported from the dojo's own records; not graded through this system."]);
  }
  return report;
}
