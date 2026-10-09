/**
 * HONBU — data access: reporting
 *
 * Part of the data layer (see ../data.mjs). Every function that touches an organisation takes an `actor` and
 * checks permission in SQL, not in the caller.
 */

import { pool } from '../../infrastructure/postgres/pool.mjs';
import { DEFAULT_TIMEZONE } from '../../core/domain/defaults.mjs';
import { region } from '../../infrastructure/region-context.mjs';
import { nextGrading } from '../../core/domain/next-grading.mjs';
import { standing } from '../../core/domain/membership.mjs';
import { readQuery, fold } from '../../content/search.mjs';
import { REPORTS, readRange, cents } from '../../core/domain/csv.mjs';
import { STATE_WORDS } from '../../core/domain/qualification.mjs';
import { nextSession, actionsFor, messageText } from '../../core/domain/portal.mjs';
import { MANAGE, REGISTER, TEACH } from '../../core/domain/access.mjs';
import { attendance } from './attendance.mjs';
import { payments } from './billing.mjs';
import { events, memberEvents } from './events.mjs';
import { forms } from './forms.mjs';
import { gradings, qualifications } from './grading.mjs';
import { clubs, terms } from './organisations.mjs';
import { declarations, family, people } from './people.mjs';
import { AWARD_SELECT, NotFound, PERSON_COLUMNS, ageOnDate, assertRole, complianceData, describeAwards, homesOf, localNow, one, q, qualToday } from './shared.mjs';
import { trials } from './visitors.mjs';

// ---------------------------------------------------------------------------
// the audit log
//
// Thirteen places write to it and, until this, nothing read it. Reading is
// restricted to MANAGE and scoped to the subtree, because the log says who did
// what to whom: a club's administrator may see their own club's history and
// not the federation's, exactly as with every other record.
// ---------------------------------------------------------------------------

export const audit = {
  /**
   * What has happened at this organisation and anything beneath it.
   *
   * Names are resolved here rather than in the view: an audit entry naming a
   * uuid is a row in a table, and the point of this screen is that somebody
   * can settle an argument with it.
   */
  async forOrganisation(actor, orgId, {
    action = null, accountId = null, since = null, limit = 100, before = null,
  } = {}) {
    await assertRole(actor, orgId, MANAGE);

    const { rows } = await pool.query(`
      select l.id, l.at, l.action, l.entity, l.entity_id as "entityId",
             l.before, l.after,
             l.account_id as "accountId",
             coalesce(
               nullif(trim(concat_ws(' ', ap.first_name, ap.last_name)), ''),
               acct.email, 'the system') as "actorName",
             o.name as "organisationName", o.slug as "organisationSlug",
             -- Whatever the entry was about, if it is a person we still hold.
             nullif(trim(concat_ws(' ', sp.first_name, sp.last_name)), '')
               as "subjectName"
      from audit_log l
      join organisation o on o.id = l.organisation_id
      join organisation root on root.id = $1 and o.path <@ root.path
      left join account acct on acct.id = l.account_id
      left join person ap on ap.id = acct.person_id
      left join person sp on sp.id = l.entity_id and l.entity = 'person'
      where ($2::text is null or l.action = $2)
        and ($3::uuid is null or l.account_id = $3)
        and ($4::timestamptz is null or l.at >= $4)
        and ($5::bigint is null or l.id < $5)
      order by l.id desc
      limit least($6::int, 500)`,
      [orgId, action, accountId, since, before, limit]);

    return rows;
  },

  /**
   * Everything that has happened to one record.
   *
   * Asked from a person's own page, which is where somebody looks when a
   * grading or a member number is disputed.
   */
  async forEntity(actor, orgId, entity, entityId, { limit = 50 } = {}) {
    await assertRole(actor, orgId, MANAGE);
    const { rows } = await pool.query(`
      select l.id, l.at, l.action, l.entity, l.entity_id as "entityId",
             l.before, l.after,
             coalesce(
               nullif(trim(concat_ws(' ', ap.first_name, ap.last_name)), ''),
               acct.email, 'the system') as "actorName"
      from audit_log l
      join organisation o on o.id = l.organisation_id
      join organisation root on root.id = $1 and o.path <@ root.path
      left join account acct on acct.id = l.account_id
      left join person ap on ap.id = acct.person_id
      where l.entity = $2 and l.entity_id = $3
      order by l.id desc
      limit least($4::int, 200)`, [orgId, entity, entityId, limit]);
    return rows;
  },

  /** Who has done things here, for a filter that lists real names. */
  async actorsAt(actor, orgId) {
    await assertRole(actor, orgId, MANAGE);
    const { rows } = await pool.query(`
      select distinct l.account_id as "accountId",
             coalesce(
               nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
               a.email, 'the system') as name
      from audit_log l
      join organisation o on o.id = l.organisation_id
      join organisation root on root.id = $1 and o.path <@ root.path
      left join account a on a.id = l.account_id
      left join person p on p.id = a.person_id
      where l.account_id is not null
      order by name`, [orgId]);
    return rows;
  },
};

// ---------------------------------------------------------------------------
// search
//
// Scoped in the query, never filtered afterwards. Search is the classic place
// an authorisation model leaks: a query that reads everything and then removes
// what the actor may not see still tells them it existed, through a count,
// through an ordering, through how long it took. Every branch below starts
// from visible_orgs($1), which is the same gate the rest of the system uses.
// ---------------------------------------------------------------------------

export const search = {
  /**
   * Everything this account may see that matches.
   *
   * Returns a flat list, typed, best first. One query per kind rather than one
   * enormous union: they have genuinely different shapes and different
   * permission rules, and a union of six selects with padding columns is how
   * somebody later adds a seventh and forgets the scoping.
   */
  async everything(actor, raw, { limit = 40 } = {}) {
    const q = readQuery(raw);
    if (q.kind === 'empty' || q.kind === 'too-short') return { query: q, results: [] };

    const like = `%${q.folded}%`;
    const results = [];

    // People. TEACH, not MANAGE: an instructor needs to find somebody in the
    // hall. Private detail is never selected here — a search result shows
    // what a roll already shows.
    const { rows: people } = await pool.query(`
      select distinct on (p.id)
             p.id, p.first_name as "firstName", p.last_name as "lastName",
             p.display_number as "displayNumber",
             cg.label as grade, o.name as "organisationName", o.slug as "orgSlug"
      from visible_orgs($1) v
      join organisation o on o.id = v.organisation_id
      join affiliation a on a.organisation_id = o.id and a.ends is null
      join person p on p.id = a.person_id
      left join person_current_grade cg on cg.person_id = p.id
      where has_role_at($1, o.id,
              array['owner','administrator','registrar','instructor']::role_name[])
        and (fold(concat_ws(' ', p.first_name, p.last_name)) like $2
          or fold(coalesce(p.display_number,'')) like $2
          or fold(coalesce(cg.label,'')) like $2)
      order by p.id, o.name
      limit $3`, [actor, like, limit]);
    for (const p of people)
      results.push({ kind: 'person', ...p,
        title: `${p.firstName} ${p.lastName}`.trim(),
        detail: [p.displayNumber, p.grade, p.organisationName]
          .filter(Boolean).join(' · ') });

    // An email finds an account, and only for somebody who may manage where
    // that person trains. An address is a way to reach a person, not a label.
    if (q.kind === 'email') {
      const { rows } = await pool.query(`
        select distinct on (p.id) p.id, acct.email,
               p.first_name as "firstName", p.last_name as "lastName",
               o.name as "organisationName", o.slug as "orgSlug"
        from visible_orgs($1) v
        join organisation o on o.id = v.organisation_id
        join affiliation a on a.organisation_id = o.id and a.ends is null
        join person p on p.id = a.person_id
        join account acct on acct.person_id = p.id
        where has_role_at($1, o.id, array['owner','administrator']::role_name[])
          and fold(acct.email) like $2
        order by p.id, o.name
        limit $3`, [actor, like, limit]);
      for (const r of rows)
        if (!results.some((x) => x.kind === 'person' && x.id === r.id))
          results.push({ kind: 'person', ...r,
            title: `${r.firstName} ${r.lastName}`.trim(),
            detail: [r.email, r.organisationName].filter(Boolean).join(' · ') });
    }

    const { rows: orgs_ } = await pool.query(`
      select o.id, o.name, o.slug, o.type
      from visible_orgs($1) v
      join organisation o on o.id = v.organisation_id
      where fold(o.name) like $2 or fold(o.slug) like $2
      order by o.name
      limit $3`, [actor, like, limit]);
    for (const o of orgs_)
      results.push({ kind: 'organisation', ...o,
        title: o.name, detail: o.type });

    const { rows: evs } = await pool.query(`
      select e.id, e.title, e.slug, e.starts_at as "startsAt",
             o.slug as "orgSlug", o.name as "organisationName"
      from visible_orgs($1) v
      join organisation o on o.id = v.organisation_id
      join event e on e.organisation_id = o.id
      where fold(e.title) like $2 or fold(coalesce(e.venue_name,'')) like $2
      order by e.starts_at desc nulls last
      limit $3`, [actor, like, limit]);
    for (const e of evs)
      results.push({ kind: 'event', ...e, detail: [e.organisationName,
        e.startsAt ? new Date(e.startsAt).toISOString().slice(0, 10) : null]
        .filter(Boolean).join(' · ') });

    // Pages and news need the right to write them — a draft is not public,
    // and search must not be the way somebody reads one.
    const { rows: pgs } = await pool.query(`
      select pg.id, pg.title, pg.slug, pg.status,
             o.slug as "orgSlug", o.name as "organisationName"
      from visible_orgs($1) v
      join organisation o on o.id = v.organisation_id
      join page pg on pg.organisation_id = o.id
      where has_role_at($1, o.id,
              array['owner','administrator','contributor']::role_name[])
        and (fold(pg.title) like $2 or fold(pg.slug) like $2
          or fold(pg.body::text) like $2)
      order by pg.updated_at desc nulls last
      limit $3`, [actor, like, limit]);
    for (const pg of pgs)
      results.push({ kind: 'page', ...pg,
        detail: [pg.organisationName, pg.status].filter(Boolean).join(' · ') });

    const { rows: arts } = await pool.query(`
      select ar.id, ar.title, ar.slug, ar.status,
             o.slug as "orgSlug", o.name as "organisationName"
      from visible_orgs($1) v
      join organisation o on o.id = v.organisation_id
      join article ar on ar.organisation_id = o.id
      where has_role_at($1, o.id,
              array['owner','administrator','contributor']::role_name[])
        and (fold(ar.title) like $2 or fold(coalesce(ar.summary,'')) like $2
          or fold(ar.body::text) like $2)
      order by ar.published_at desc nulls last
      limit $3`, [actor, like, limit]);
    for (const ar of arts)
      results.push({ kind: 'article', ...ar,
        detail: [ar.organisationName, ar.status].filter(Boolean).join(' · ') });

    const { rows: imgs } = await pool.query(`
      select a.id, a.filename, a.alt_text as "altText",
             o.slug as "orgSlug", o.name as "organisationName"
      from visible_orgs($1) v
      join organisation o on o.id = v.organisation_id
      join asset a on a.organisation_id = o.id
      where has_role_at($1, o.id,
              array['owner','administrator','contributor']::role_name[])
        and (fold(coalesce(a.filename,'')) like $2
          or fold(coalesce(a.alt_text,'')) like $2)
      order by a.created_at desc
      limit $3`, [actor, like, limit]);
    for (const a of imgs)
      results.push({ kind: 'image', ...a,
        title: a.filename ?? 'image', detail: a.altText ?? a.organisationName });

    // A member number or an email was typed because somebody wanted one exact
    // thing; put the exact match first and leave the rest in the order each
    // query returned.
    const exact = (r) => (
      fold(r.displayNumber ?? '') === q.folded
      || fold(r.email ?? '') === q.folded
      || fold(r.title ?? '') === q.folded) ? 0 : 1;
    results.sort((a, b) => exact(a) - exact(b));

    return { query: q, results: results.slice(0, limit) };
  },
};

const IN_TREE = `(select o.id from organisation root join organisation o on o.path <@ root.path where root.id = $1)`;

const REPORT_ROLES = { register: REGISTER, manage: MANAGE, teach: TEACH };

export const reports = {
  list: REPORTS,

  async run(actor, orgId, name, { from = null, to = null, download = false } = {}) {
    const def = REPORTS[name];
    if (!def) throw new NotFound('Report');
    await assertRole(actor, orgId, REPORT_ROLES[def.needs]);
    const org = await one('select id, name, slug, type, timezone from organisation where id=$1', [orgId]);
    if (!org) throw new NotFound('Organisation');
    const today = (await one(`select to_char((now() at time zone $1)::date,'YYYY-MM-DD') as d`, [org.timezone])).d;
    const range = readRange(from, to, today);
    const out = await reports[`_${name}`](orgId, today, range);

    if (download) await q(`insert into audit_log (account_id, organisation_id, action, entity, entity_id, after)
      values ($1,$2,'report_exported','organisation',$2,$3)`, [actor, orgId,
      JSON.stringify({ report: name, rows: out.rows.length, ...(def.dates ? range : {}) })]);
    return { org, today, name, label: def.label, range: def.dates ? range : null, ...out };
  },

  async _members(orgId, today) {
    const rows = await q(`
      select o.name as club, p.display_number as number, p.first_name, p.last_name, a.role, a.status,
             to_char(p.date_of_birth,'YYYY-MM-DD') as date_of_birth,
             case when p.date_of_birth is null then null else date_part('year', age($2::date, p.date_of_birth))::int end as age,
             p.gender, p.email, p.phone, cg.label as grade, to_char(cg.awarded_on,'YYYY-MM-DD') as graded_on,
             to_char(a.starts,'YYYY-MM-DD') as joined, to_char(a.paid_until,'YYYY-MM-DD') as paid_until,
             a.fee_exempt,
             (select to_char(max(t.session_date),'YYYY-MM-DD') from attendance t where t.person_id = p.id) as last_trained
      from affiliation a join person p on p.id = a.person_id join organisation o on o.id = a.organisation_id
      left join person_current_grade cg on cg.person_id = p.id
      where a.organisation_id in ${IN_TREE} and a.ends is null and a.role in ('member','instructor','assistant')
        and a.status in ('active','lapsed','pending')
      order by o.name, p.last_name, p.first_name`, [orgId, today]);
    return { columns: [['club', 'Club'], ['number', 'Member number'], ['first_name', 'First name'], ['last_name', 'Last name'],
      ['role', 'Role'], ['status', 'Status'], ['date_of_birth', 'Date of birth'], ['age', 'Age'], ['gender', 'Gender'],
      ['email', 'Email'], ['phone', 'Phone'], ['grade', 'Grade'], ['graded_on', 'Graded on'], ['joined', 'Joined'],
      ['paid_until', 'Paid until'], ['standing', 'Fees'], ['last_trained', 'Last trained']]
      .map(([key, label]) => ({ key, label })),
      rows: rows.map((r) => ({ ...r, standing: standing({ paidUntil: r.paid_until, exempt: r.fee_exempt }, today) })) };
  },

  async _fees(orgId, today) {
    const { rows } = await reports._members(orgId, today);
    const owing = rows.filter((r) => ['unpaid', 'overdue', 'due'].includes(r.standing)).map((r) => ({
      ...r, days_late: r.standing === 'overdue' ? Math.round((Date.parse(today) - Date.parse(r.paid_until)) / 864e5) : null }));
    owing.sort((a, b) => (b.days_late ?? -1) - (a.days_late ?? -1));
    return { columns: [['club', 'Club'], ['number', 'Member number'], ['first_name', 'First name'], ['last_name', 'Last name'],
      ['standing', 'Fees'], ['paid_until', 'Paid until'], ['days_late', 'Days overdue'], ['age', 'Age'], ['email', 'Email'], ['phone', 'Phone']]
      .map(([key, label]) => ({ key, label })), rows: owing };
  },

  async _payments(orgId, _today, { from, to }) {
    const rows = await q(`
      select to_char(coalesce(py.settled_at, py.created_at),'YYYY-MM-DD') as date, py.receipt_no as receipt,
             po.name as payee, p.display_number as number,
             nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') as payer,
             (select string_agg(l.kind, ' + ' order by l.id) from payment_line l where l.payment_id = py.id) as kinds,
             (select string_agg(l.description, '; ' order by l.id) from payment_line l where l.payment_id = py.id) as description,
             py.method, py.amount_cents
      from payment py join organisation po on po.id = py.organisation_id left join person p on p.id = py.person_id
      where py.organisation_id in ${IN_TREE} and py.status = 'succeeded'
        and coalesce(py.settled_at, py.created_at)::date between $2::date and $3::date
      order by coalesce(py.settled_at, py.created_at), py.receipt_no`, [orgId, from, to]);
    return { columns: [['date', 'Date'], ['receipt', 'Receipt'], ['payee', 'Paid to'], ['number', 'Member number'],
      ['payer', 'Paid by'], ['kinds', 'For'], ['description', 'Details'], ['method', 'Method'], ['amount', 'Amount']]
      .map(([key, label]) => ({ key, label })),
      rows: rows.map((r) => ({ ...r, amount: cents(r.amount_cents) })),
      total: rows.reduce((s, r) => s + r.amount_cents, 0) };
  },

  async _attendance(orgId, _today, { from, to }) {
    const rows = await q(`
      select o.name as club, p.display_number as number, p.first_name, p.last_name,
             count(*)::int as classes, count(distinct t.session_date)::int as days,
             to_char(max(t.session_date),'YYYY-MM-DD') as last_trained
      from attendance t join person p on p.id = t.person_id join organisation o on o.id = t.organisation_id
      where t.organisation_id in ${IN_TREE} and t.session_date between $2::date and $3::date
      group by o.name, p.id, p.display_number, p.first_name, p.last_name
      order by o.name, classes desc, p.last_name`, [orgId, from, to]);
    return { columns: [['club', 'Club'], ['number', 'Member number'], ['first_name', 'First name'], ['last_name', 'Last name'],
      ['classes', 'Classes'], ['days', 'Days'], ['last_trained', 'Last trained']].map(([key, label]) => ({ key, label })), rows };
  },

  async _compliance(orgId) {
    const c = await complianceData(orgId);
    const rows = [];
    for (const r of c.rows) for (const i of r.items)
      rows.push({ club: r.club, number: r.display_number, name: r.name, role: r.role, qualification: i.label,
        state: STATE_WORDS[i.state], expires_on: i.expires_on, cleared: r.cleared ? 'Yes' : 'No' });
    for (const e of c.expiring) rows.push({ club: e.club, number: '', name: e.name, role: '', qualification: e.label,
      state: STATE_WORDS[e.state], expires_on: e.expires_on, cleared: '' });
    return { columns: [['club', 'Club'], ['number', 'Member number'], ['name', 'Name'], ['role', 'Role'], ['qualification', 'Qualification'],
      ['state', 'Status'], ['expires_on', 'Runs out'], ['cleared', 'Cleared to teach']].map(([key, label]) => ({ key, label })), rows };
  },

  async _gradings(orgId, _today, { from, to }) {
    const rows = await q(`
      select to_char(gr.awarded_on,'YYYY-MM-DD') as date, p.display_number as number, p.first_name, p.last_name,
             g.label as grade, gr.result, o.name as awarded_by, gr.certificate_no as certificate,
             to_char(gr.ratified_on,'YYYY-MM-DD') as ratified_on, e.title as event
      from grading_record gr join person p on p.id = gr.person_id join grade g on g.id = gr.grade_id
      join organisation o on o.id = gr.awarded_by_org left join event e on e.id = gr.event_id
      where gr.awarded_by_org in ${IN_TREE} and gr.awarded_on between $2::date and $3::date
      order by gr.awarded_on desc, p.last_name`, [orgId, from, to]);
    return { columns: [['date', 'Date'], ['number', 'Member number'], ['first_name', 'First name'], ['last_name', 'Last name'],
      ['grade', 'Grade'], ['result', 'Result'], ['awarded_by', 'Awarded by'], ['certificate', 'Certificate'],
      ['ratified_on', 'Ratified'], ['event', 'Event']].map(([key, label]) => ({ key, label })), rows };
  },
};

export const portal = {
  /** One person's card on the dashboard. */
  async summary(actor, person, how) {
    const { rows: memberships } = await pool.query(`
      select a.id, o.id as org_id, o.name, o.slug, o.type, o.timezone, a.role, a.status,
             a.paid_until::text as paid_until, a.fee_exempt,
             (select json_agg(json_build_object('name', x.name, 'type', x.type) order by nlevel(x.path))
                from organisation x where o.path <@ x.path) as chain
      from affiliation a join organisation o on o.id = a.organisation_id
      where a.person_id = $1 and a.ends is null order by o.type, o.name`, [person.id]);

    const tz = memberships[0]?.timezone ?? DEFAULT_TIMEZONE;
    const now = localNow(tz);
    for (const m of memberships)
      m.standing = m.status === 'trial' ? 'trial'
        : m.role === 'member' ? standing({ paidUntil: m.paid_until, exempt: m.fee_exempt }, localNow(m.timezone).date) : null;

    const grade = await one(`select cg.label, cg.rank_order, cg.awarded_on::text as awarded_on,
        (select n.label from grade g join grade n on n.organisation_id = g.organisation_id
           and n.rank_order = g.rank_order + 1 where g.id = cg.grade_id) as next_label
      from person_current_grade cg where cg.person_id = $1`, [person.id]);
    if (grade) grade.next_grading = nextGrading({ held: { label: grade.label, awardedOn: grade.awarded_on },
      next: grade.next_label ? { label: grade.next_label } : null, today: now.date });

    const sessions = memberships.length ? await q(`
      select ts.id, ts.label, ts.weekday, to_char(ts.starts,'HH24:MI') as starts, to_char(ts.ends,'HH24:MI') as ends,
             ts.min_age, ts.max_age, g.rank_order as min_rank_order, o.name as club
      from training_session ts join organisation o on o.id = ts.organisation_id
      left join grade g on g.id = ts.min_grade_id
      where ts.organisation_id = any($1::uuid[])`,
      [memberships.filter((m) => m.role === 'member' && ['active', 'trial'].includes(m.status)).map((m) => m.org_id)]) : [];
    const next = nextSession(sessions, now, { ageYears: ageOnDate(person.date_of_birth, now.date), rankOrder: grade?.rank_order ?? null });

    const nextEvent = await one(`
      select e.title, e.kind, e.starts_at, x.status, e.venue_name, o.name as host_name, o.timezone as host_timezone
      from event_entry x join event e on e.id = x.event_id join organisation o on o.id = e.organisation_id
      where x.person_id = $1 and x.status in ('entered','confirmed') and e.starts_at > now()
      order by e.starts_at limit 1`, [person.id]);

    const open = await memberEvents.openFor(person.id);
    const closing = open.filter((e) => e.entries_close && new Date(e.entries_close) < new Date(Date.now() + 7 * 864e5));

    const owed = (await payments.owedBy(actor)).filter((p) => p.person_id === person.id)
      .map((p) => ({ id: p.id, amount_cents: p.amount_cents, currency: p.currency,
                     description: p.lines.map((l) => l.description).join('; ') }));

    const home = (await homesOf(person.id))[0];
    const qToday = home ? await qualToday(home) : null;
    const quals = qToday ? describeAwards(await q(`${AWARD_SELECT} where qa.person_id = $1`, [person.id]), qToday)
      .filter((a) => a.counts) : [];
    const priv = await one('select emergency_name, emergency_phone from person_private where person_id = $1', [person.id]);

    const counts = await one(`
      select (select count(*)::int from grading_record where person_id = $1 and certificate_no is not null
                 and result in ('pass','provisional')) as certificates,
             (select count(*)::int from entry_consent c join event_entry x on x.id = c.entry_id where x.person_id = $1) as consents,
             (select count(*)::int from attendance where person_id = $1 and session_date > current_date - 90) as recent_classes,
             (select to_char(max(session_date),'YYYY-MM-DD') from attendance where person_id = $1) as last_trained`, [person.id]);

    const trial = await trials.mine(actor, person.id);
    const trialLeft = trial && trial.status !== 'converted'
      ? Math.round((Date.parse(`${trial.ends}T00:00:00Z`) - Date.parse(`${now.date}T00:00:00Z`)) / 864e5) : null;
    const declarationNow = await declarations.statusFor(person.id);
    const actions = actionsFor({ personId: person.id, owed, closing, qualifications: quals,
      formsDue: await forms.dueFor(person.id),
      trial: trial ? { left: trialLeft } : null,
      termsOpen: (await terms.forPerson(actor, person.id)).items.filter((i) => i.mayEnrol && !i.enrolment).slice(0, 1).map((i) => ({ name: i.term.name, first: person.first_name })),
      memberships: memberships.filter((m) => m.standing).map((m) => ({ name: m.name, standing: m.standing, paid_until: m.paid_until })),
      declaration: declarationNow.state,
      details: { emergencyContact: !!(priv?.emergency_name && priv?.emergency_phone) } });

    return { person, how, memberships, grade, next, nextEvent, trial: trial ? { ...trial, left: trialLeft } : null, openCount: open.length, closing: closing.length,
      owed, owedTotal: owed.reduce((n, p) => n + p.amount_cents, 0), currency: owed[0]?.currency ?? region().currency,
      counts, qualifications: quals, actions, declaration: declarationNow };
  },

  /** The whole dashboard: me and the children I look after, and my messages. */
  async dashboard(actor) {
    const { self, dependants } = await family.mine(actor);
    if (!self) return { people: [], unread: 0, messages: [] };
    const people = [await this.summary(actor, self, 'self')];
    for (const d of dependants) people.push(await this.summary(actor, d, 'guardian'));
    const inbox = await this.inbox(actor, { limit: 5 });
    return { people, unread: inbox.unread, messages: inbox.rows };
  },

  /** Messages written to me, or to me about a child. */
  async inbox(actor, { limit = 50 } = {}) {
    const { self, dependants } = await family.mine(actor);
    const ids = [self, ...dependants].filter(Boolean).map((p) => p.id);
    if (!ids.length) return { rows: [], unread: 0 };
    const rows = await q(`
      select r.id, m.subject, o.name as club, r.sent_at, r.read_at,
             nullif(trim(concat_ws(' ', ab.first_name, ab.last_name)), '') as about
      from message_recipient r join message m on m.id = r.message_id
      join organisation o on o.id = m.organisation_id left join person ab on ab.id = r.about_id
      where r.person_id = any($1::uuid[]) and r.status = 'sent'
      order by r.sent_at desc limit $2`, [ids, limit]);
    const unread = (await one(`select count(*)::int as n from message_recipient
      where person_id = any($1::uuid[]) and status = 'sent' and read_at is null`, [ids])).n;
    return { rows, unread };
  },

  /** Open one message. Marks it read. Somebody else's recipient row is not found, not forbidden. */
  async message(actor, recipientId) {
    const { self, dependants } = await family.mine(actor);
    const ids = [self, ...dependants].filter(Boolean).map((p) => p.id);
    const row = await one(`
      select r.id, m.subject, m.body, o.name as club, r.sent_at, r.read_at, m.sender_name,
             nullif(trim(concat_ws(' ', ab.first_name, ab.last_name)), '') as about
      from message_recipient r join message m on m.id = r.message_id
      join organisation o on o.id = m.organisation_id left join person ab on ab.id = r.about_id
      where r.id = $1 and r.person_id = any($2::uuid[]) and r.status = 'sent'`, [recipientId, ids]);
    if (!row) throw new NotFound('Message');
    if (!row.read_at) await pool.query('update message_recipient set read_at = now() where id = $1 and read_at is null', [recipientId]);
    return { ...row, text: messageText(row.body, { club: row.club }) };
  },

  /** Grade history, attendance and events: the person's own record. */
  async record(actor, personId) {
    const how = await family.assertMayActFor(actor, personId);
    const person = await one(`select ${PERSON_COLUMNS} from person p where p.id = $1`, [personId]);
    const gradings = await q(`
      select g.label, to_char(gr.awarded_on,'YYYY-MM-DD') as awarded_on, gr.result, gr.certificate_no,
             ao.name as awarded_by, gr.id
      from grading_record gr join grade g on g.id = gr.grade_id
      left join organisation ao on ao.id = gr.awarded_by_org
      where gr.person_id = $1 order by gr.awarded_on desc, g.rank_order desc`, [personId]);
    const attendance = await q(`
      select to_char(a.session_date,'YYYY-MM-DD') as day, ts.label, o.name as club
      from attendance a join organisation o on o.id = a.organisation_id
      left join training_session ts on ts.id = a.session_id
      where a.person_id = $1 order by a.session_date desc limit 30`, [personId]);
    const stats = await one(`
      select count(*) filter (where session_date > current_date - 30)::int as last30,
             count(*) filter (where session_date > current_date - 365)::int as last365,
             count(*)::int as total, to_char(min(session_date),'YYYY-MM-DD') as since
      from attendance where person_id = $1`, [personId]);
    const events = await q(`
      select e.title, e.kind, e.starts_at, x.status, o.timezone as host_timezone,
             (select py.status from payment py where py.event_entry_id = x.id order by py.created_at desc limit 1) as pay_status,
             coalesce((select json_agg(json_build_object('discipline', d.name, 'division', v.label) order by d.sort_order)
                         from entry_selection s join event_discipline d on d.id = s.discipline_id
                         left join event_division v on v.id = s.division_id where s.entry_id = x.id), '[]'::json) as picks
      from event_entry x join event e on e.id = x.event_id join organisation o on o.id = e.organisation_id
      where x.person_id = $1 order by e.starts_at desc`, [personId]);
    return { how, person, gradings, attendance, stats, events,
      upcoming: events.filter((e) => new Date(e.starts_at) > new Date()).reverse(),
      past: events.filter((e) => new Date(e.starts_at) <= new Date()) };
  },

  /** What I have been given and what I have signed. */
  async documents(actor, personId) {
    const how = await family.assertMayActFor(actor, personId);
    const person = await one(`select ${PERSON_COLUMNS} from person p where p.id = $1`, [personId]);
    const certificates = await q(`select gr.id, g.label, gr.awarded_on::text as awarded_on, gr.certificate_no
      from grading_record gr join grade g on g.id = gr.grade_id
      where gr.person_id = $1 and gr.certificate_no is not null and gr.result in ('pass','provisional')
      order by gr.awarded_on desc`, [personId]);
    const consents = await q(`
      select c.id, c.version, c.accepted_name, c.accepted_at, c.guardian, e.title, e.consent_text, e.starts_at
      from entry_consent c join event_entry x on x.id = c.entry_id join event e on e.id = x.event_id
      where x.person_id = $1 order by c.accepted_at desc`, [personId]);
    const home = (await homesOf(personId))[0];
    const today = home ? await qualToday(home) : null;
    const qualifications = today ? describeAwards(await q(`${AWARD_SELECT} where qa.person_id = $1`, [personId]), today)
      .filter((a) => a.counts) : [];
    const receipts = await q(`select py.id, py.receipt_no, py.amount_cents, py.currency, py.settled_at, po.name as payee,
        (select string_agg(l.description, '; ') from payment_line l where l.payment_id = py.id) as description
      from payment py join organisation po on po.id = py.organisation_id
      where py.person_id = $1 and py.status = 'succeeded' order by py.settled_at desc nulls last limit 50`, [personId]);
    return { how, person, certificates, consents, qualifications, receipts };
  },

  /** The classes at the clubs I and my children belong to, with who each is for. */
  async timetable(actor) {
    const { self, dependants } = await family.mine(actor);
    const out = [];
    for (const person of [self, ...dependants].filter(Boolean)) {
      const clubs = await q(`select o.id, o.name, o.timezone from affiliation a join organisation o on o.id = a.organisation_id
        where a.person_id = $1 and a.ends is null and a.role = 'member' and a.status in ('active','trial')`, [person.id]);
      const grade = await one('select rank_order from person_current_grade where person_id = $1', [person.id]);
      for (const club of clubs) {
        const now = localNow(club.timezone);
        const sessions = await q(`
          select ts.id, ts.label, ts.weekday, to_char(ts.starts,'HH24:MI') as starts, to_char(ts.ends,'HH24:MI') as ends,
                 ts.min_age, ts.max_age, ts.notes, g.rank_order as min_rank_order, g.label as min_grade_label
          from training_session ts left join grade g on g.id = ts.min_grade_id
          where ts.organisation_id = $1 order by ts.weekday, ts.starts`, [club.id]);
        const who = { ageYears: ageOnDate(person.date_of_birth, now.date), rankOrder: grade?.rank_order ?? null };
        const next = nextSession(sessions, now, who);
        out.push({ person, club: club.name, next, sessions: sessions.map((s) => ({ ...s, forMe: nextSession([s], now, who) !== null })) });
      }
    }
    return out;
  },
};
