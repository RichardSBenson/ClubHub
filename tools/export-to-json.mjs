/**
 * Dumps the database into the flat files the site can run from.
 *
 * Run it after any change to the register. Commit the result. The public site
 * then deploys with no database at all — which is both cheaper and one less
 * thing to be down.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pool } from '../packages/api/data.mjs';

const OUT = process.env.HONBU_DATA
  ?? new URL('../data/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const write = (name, rows) => {
  fs.writeFileSync(path.join(OUT, `${name}.json`),
    JSON.stringify(rows, null, 2) + '\n');
  console.log(`  ${String(rows.length).padStart(5)}  ${name}.json`);
};

const q = async (sql) => (await pool.query(sql)).rows;

write('organisations', await q(`
  select id, parent_id as "parentId", type, name, slug, country_code as "countryCode",
         timezone, founded, status
  from organisation order by path`));

write('dojo-profiles', await q(`
  select organisation_id as "organisationId", venue_name as "venueName",
         address_line as "addressLine", suburb, city, postcode,
         latitude, longitude, directions, phone, email, blurb,
         who_trains as "whoTrains", first_class_free as "firstClassFree", published
  from dojo_profile where published`));

write('training-sessions', await q(`
  select organisation_id as "organisationId", label, weekday,
         starts::text as starts, ends::text as ends,
         min_age as "minAge", max_age as "maxAge"
  from training_session order by organisation_id, sort_order`));

write('grades', await q(`
  select id, organisation_id as "organisationId", label, short_label as "shortLabel",
         belt_colour as "beltColour", belt_stripes as "beltStripes",
         rank_order as "rankOrder", is_dan as "isDan",
         min_months_at_previous as "minMonthsAtPrevious",
         min_age as "minAge", min_sessions as "minSessions"
  from grade order by organisation_id, rank_order`));

write('grade-authorities', await q(`
  select organisation_id as "organisationId",
         from_rank_order as "fromRankOrder", to_rank_order as "toRankOrder",
         awarded_by_type as "awardedByType", ratified_by_type as "ratifiedByType",
         min_panel_size as "minPanelSize", min_panel_rank as "minPanelRank"
  from grade_authority order by from_rank_order`));

// People and gradings are the register. Only export what the PUBLIC site needs
// — instructor names and grades — never dates of birth or contact details.
write('people', await q(`
  select p.id, p.first_name as "firstName", p.last_name as "lastName",
         p.display_number as "displayNumber",
         a.organisation_id as "organisationId", a.role
  from person p
  join affiliation a on a.person_id = p.id and a.ends is null
  where a.role in ('instructor','assistant')`));

write('events', await q(`
  select e.id, e.organisation_id as "organisationId", e.kind, e.title, e.slug,
         e.summary, e.starts_at as "startsAt", e.ends_at as "endsAt",
         e.venue_name as "venueName", e.visibility,
         e.publish_down as "publishDown", e.entries_close as "entriesClose"
  from event e where e.status='published' and e.visibility='public'
  order by e.starts_at`));

write('articles', await q(`
  select a.slug, a.title, a.summary, a.body, a.tags,
         a.published_at as "publishedAt",
         o.name as "aboutOrg", o.slug as "aboutOrgSlug"
  from article a
  left join organisation o on o.id = a.about_org_id
  where a.status='published' order by a.published_at desc`));

write('pages', await q(`
  select slug, title, meta_title as "metaTitle",
         meta_description as "metaDescription", body
  from page where status='published'`));

write('brand', await q(`
  select organisation_id as "organisationId", tokens, theme, fonts from brand`));

write('redirects', await q(`
  select from_path as "fromPath", to_path as "toPath", permanent from redirect`));

console.log('\nCommit the data/ directory. The site now runs with no database.\n');
await pool.end();
