/**
 * HONBU — data access: forms
 *
 * Part of the data layer (see ../data.mjs). Every function that touches an organisation takes an `actor` and
 * checks permission in SQL, not in the caller.
 */

import { pool } from '../../infrastructure/postgres/pool.mjs';
import { cleanField, problemsWithForm, problemsWithPublishing, readAnswers, standingOn, expiryFor, appliesTo, isMinor as isMinorOn, problemsWithSignature, STARTERS as FORM_STARTERS } from '../../core/domain/forms.mjs';
import { MANAGE, REGISTER, TEACH } from '../../core/domain/access.mjs';
import { webhooks } from './messaging.mjs';
import { family, people } from './people.mjs';
import { Forbidden, Invalid, NotFound, assertRole, homesOf, one, q, qualToday } from './shared.mjs';

const FORM_COLS = `f.id, f.organisation_id, f.title, f.kind, f.intro, f.fields, f.audience, f.renew_months, f.status, f.version,
  f.created_at, f.updated_at, f.published_at, o.name as org_name, o.slug as org_slug, o.type as org_type, o.timezone`;

const formAudit = (actor, orgId, action, formId, after = {}) => pool.query(
  `insert into audit_log (account_id, organisation_id, action, entity, entity_id, after) values ($1,$2,$3,'club_form',$4,$5)`,
  [actor, orgId, action, formId, JSON.stringify(after)]);

const todayFor = async (orgId) => qualToday(orgId);

export const forms = {
  STARTERS: FORM_STARTERS,

  async find(formId) {
    return one(`select ${FORM_COLS} from club_form f join organisation o on o.id = f.organisation_id where f.id = $1`, [formId]);
  },

  /** For officials: any form here (they may read; MANAGE edits). A form from somewhere else is "not found". */
  async get(actor, orgId, formId, { edit = false } = {}) {
    await assertRole(actor, orgId, edit ? MANAGE : REGISTER);
    const f = await this.find(formId);
    if (!f || f.organisation_id !== orgId) throw new NotFound('Form');
    return f;
  },

  async list(actor, orgId) {
    await assertRole(actor, orgId, REGISTER);
    const rows = await q(`select ${FORM_COLS},
        (select count(distinct r.person_id)::int from form_response r where r.form_id = f.id and r.form_version = f.version and r.withdrawn_at is null) as signed
      from club_form f join organisation o on o.id = f.organisation_id
      where f.organisation_id = $1 and f.status <> 'archived' order by f.created_at desc`, [orgId]);
    // Forms from above (the federation's) that apply here, for information.
    const inherited = await q(`select ${FORM_COLS} from club_form f join organisation o on o.id = f.organisation_id
      join organisation me on me.id = $1 and me.path <@ o.path and o.id <> me.id
      where f.status = 'published' order by f.title`, [orgId]);
    return { rows, inherited };
  },

  async create(actor, orgId, { starter = null, title = '', kind = 'other' } = {}) {
    await assertRole(actor, orgId, MANAGE);
    const t = starter ? FORM_STARTERS[starter] : null;
    if (starter && !t) throw new Invalid('Choose one of the starting forms.');
    const gen = (() => { let n = 0; return () => `q${++n}`; })();
    const fields = t ? t.fields.map((f) => cleanField(f, gen)) : [];
    const data = { title: String(t?.title ?? title).trim(), kind: t?.kind ?? kind, audience: t?.audience ?? 'all',
                   renewMonths: t?.renewMonths ?? null, fields };
    const problems = problemsWithForm(data);
    if (problems.length) throw new Invalid(problems.join(' '));
    const row = await one(`insert into club_form (organisation_id, title, kind, intro, fields, audience, renew_months, created_by)
      values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8) returning id`,
      [orgId, data.title, data.kind, t?.intro ?? null, JSON.stringify(fields), data.audience, data.renewMonths, actor]);
    await formAudit(actor, orgId, 'form_create', row.id, { title: data.title, starter });
    return row.id;
  },

  async save(actor, orgId, formId, { title, kind, intro, audience, renewMonths }) {
    const f = await this.get(actor, orgId, formId, { edit: true });
    const data = { title: String(title ?? '').trim(), kind, audience, fields: f.fields,
      renewMonths: renewMonths === '' || renewMonths == null ? null : Number(renewMonths) };
    const problems = problemsWithForm(data);
    if (problems.length) throw new Invalid(problems.join(' '));
    await pool.query(`update club_form set title=$2, kind=$3, intro=$4, audience=$5, renew_months=$6, updated_at=now() where id=$1`,
      [formId, data.title, kind, String(intro ?? '').replace(/\r\n/g, '\n').trim().slice(0, 3000) || null, audience, data.renewMonths]);
    await formAudit(actor, orgId, 'form_save', formId, { title: data.title });
  },

  async _writeFields(formId, fields) {
    await pool.query('update club_form set fields=$2::jsonb, updated_at=now() where id=$1', [formId, JSON.stringify(fields)]);
  },

  async addField(actor, orgId, formId, raw) {
    const f = await this.get(actor, orgId, formId, { edit: true });
    const field = cleanField(raw);
    if (!field) throw new Invalid('Write the question first.');
    const fields = [...f.fields, field];
    const problems = problemsWithForm({ title: f.title, kind: f.kind, audience: f.audience, fields });
    if (problems.length) throw new Invalid(problems.join(' '));
    await this._writeFields(formId, fields);
    return field;
  },

  async updateField(actor, orgId, formId, fieldId, raw) {
    const f = await this.get(actor, orgId, formId, { edit: true });
    const at = f.fields.findIndex((x) => x.id === fieldId);
    if (at < 0) throw new NotFound('Question');
    const field = cleanField({ ...raw, id: fieldId });
    if (!field) throw new Invalid('A question needs some wording.');
    const fields = f.fields.map((x, i) => (i === at ? field : x));
    const problems = problemsWithForm({ title: f.title, kind: f.kind, audience: f.audience, fields });
    if (problems.length) throw new Invalid(problems.join(' '));
    await this._writeFields(formId, fields);
  },

  async removeField(actor, orgId, formId, fieldId) {
    const f = await this.get(actor, orgId, formId, { edit: true });
    await this._writeFields(formId, f.fields.filter((x) => x.id !== fieldId));
  },

  async moveField(actor, orgId, formId, fieldId, delta) {
    const f = await this.get(actor, orgId, formId, { edit: true });
    const i = f.fields.findIndex((x) => x.id === fieldId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= f.fields.length) return;
    const fields = [...f.fields];
    [fields[i], fields[j]] = [fields[j], fields[i]];
    await this._writeFields(formId, fields);
  },

  async setStatus(actor, orgId, formId, status) {
    const f = await this.get(actor, orgId, formId, { edit: true });
    if (status === 'published') {
      const problems = problemsWithPublishing({ title: f.title, kind: f.kind, audience: f.audience, renewMonths: f.renew_months, fields: f.fields });
      if (problems.length) throw new Invalid(problems.join(' '));
    }
    await pool.query(`update club_form set status=$2, updated_at=now(), published_at = case when $2 = 'published' then coalesce(published_at, now()) else published_at end where id=$1`, [formId, status]);
    await formAudit(actor, orgId, `form_${status}`, formId, { title: f.title });
  },

  /** Make everybody sign again: the form has changed in a way that matters. Earlier answers are kept as history. */
  async askAgain(actor, orgId, formId) {
    const f = await this.get(actor, orgId, formId, { edit: true });
    await pool.query('update club_form set version = version + 1, updated_at=now() where id=$1', [formId]);
    await formAudit(actor, orgId, 'form_ask_again', formId, { title: f.title, version: f.version + 1 });
  },

  /** Everyone this form is asked of beneath its organisation, and where they stand. */
  async report(actor, orgId, formId) {
    const f = await this.get(actor, orgId, formId);
    const day = await todayFor(orgId);
    const people = await q(`select distinct on (p.id) p.id as person_id, p.display_number, p.first_name, p.last_name, p.date_of_birth::text as dob, o.name as dojo
      from organisation fo join organisation o on o.path <@ fo.path
      join affiliation a on a.organisation_id = o.id and a.role = 'member' and a.ends is null and a.status in ('active','trial')
      join person p on p.id = a.person_id where fo.id = $1 order by p.id`, [orgId]);
    const latest = new Map((await q(`select distinct on (person_id) id, person_id, form_version, signed_name, signed_for_minor, answered_at, expires_on::text as expires_on, withdrawn_at, answers
      from form_response where form_id = $1 order by person_id, answered_at desc`, [formId])).map((r) => [r.person_id, r]));
    const rows = people.filter((p) => appliesTo(f, { dob: p.dob }, day)).map((p) => {
      const r = latest.get(p.person_id) ?? null;
      return { ...p, standing: standingOn(f, r, day), response: r };
    }).sort((a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name));
    const count = (s) => rows.filter((r) => r.standing === s).length;
    return { form: f, rows, counts: { current: count('current'), missing: count('missing'), expired: count('expired'), total: rows.length } };
  },

  /** One person's answers to one form. Medical answers go only to those who run the dojo or teach there. */
  async answers(actor, orgId, formId, personId) {
    const f = await this.get(actor, orgId, formId);
    const r = await one(`select * from form_response where form_id = $1 and person_id = $2 order by answered_at desc limit 1`, [formId, personId]);
    if (!r) return { form: f, response: null };
    if (f.kind === 'medical') {
      let ok = false;
      for (const h of await homesOf(personId)) if ((await one('select has_role_at($1,$2,$3) as ok', [actor, h, TEACH]))?.ok) { ok = true; break; }
      if (!ok) throw new Forbidden();
    }
    return { form: f, response: r };
  },

  // ---- the person's side --------------------------------------------------

  /** Published forms that apply to this person through where they train, with where they stand on each. */
  async _applicable(personId) {
    const person = await one(`select p.id, p.first_name, p.last_name, p.date_of_birth::text as dob from person p where p.id = $1`, [personId]);
    if (!person) throw new NotFound('Person');
    const rows = await q(`select distinct on (f.id) ${FORM_COLS} from club_form f join organisation o on o.id = f.organisation_id
      where f.status = 'published' and exists (select 1 from affiliation a join organisation x on x.id = a.organisation_id
        where a.person_id = $1 and a.role = 'member' and a.ends is null and a.status in ('active','trial') and x.path <@ o.path)
      order by f.id`, [personId]);
    const home = (await homesOf(personId))[0];
    const day = home ? await todayFor(home) : new Date().toISOString().slice(0, 10);
    const latest = new Map((await q(`select distinct on (form_id) form_id, form_version, expires_on::text as expires_on, withdrawn_at, answered_at, signed_name
      from form_response where person_id = $1 order by form_id, answered_at desc`, [personId])).map((r) => [r.form_id, r]));
    const items = rows.filter((f) => appliesTo(f, { dob: person.dob }, day))
      .map((f) => ({ form: f, standing: standingOn(f, latest.get(f.id) ?? null, day), last: latest.get(f.id) ?? null }));
    return { person, items, day };
  },

  async forPerson(actor, personId) {
    const how = await family.assertMayActFor(actor, personId);
    const { person, items, day } = await this._applicable(personId);
    return { how, person, minor: isMinorOn(person.dob, day),
      todo: items.filter((i) => i.standing !== 'current').sort((a, b) => a.form.title.localeCompare(b.form.title)),
      done: items.filter((i) => i.standing === 'current').sort((a, b) => a.form.title.localeCompare(b.form.title)) };
  },

  async open(actor, personId, formId) {
    const how = await family.assertMayActFor(actor, personId);
    const { person, items, day } = await this._applicable(personId);
    const item = items.find((i) => i.form.id === formId);
    if (!item) throw new NotFound('Form');
    return { how, person, item, minor: isMinorOn(person.dob, day), day };
  },

  async submit(actor, personId, formId, raw, { signedName, ip = null } = {}) {
    const { how, person, item, minor, day } = await this.open(actor, personId, formId);
    if (minor && how === 'self') throw new Invalid('A parent or guardian answers this for anyone under 18. Ask them to sign in and do it.');
    const { answers, problems } = readAnswers(item.form.fields, raw);
    const sig = problemsWithSignature(signedName);
    if (problems.length || sig.length) throw new Invalid([...problems, ...sig].join(' '));
    const row = await one(`insert into form_response (form_id, form_version, person_id, answers, signed_name, signed_by, signed_for_minor, signed_ip, expires_on)
      values ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9) returning id`,
      [formId, item.form.version, personId, JSON.stringify(answers), String(signedName).trim().slice(0, 120), actor, minor, ip, expiryFor(item.form, day)]);
    await formAudit(actor, item.form.organisation_id, 'form_signed', formId, { personId, version: item.form.version });
    await webhooks.emitNow(item.form.organisation_id, 'form.signed', { form_id: formId, title: item.form.title, person_id: personId, version: item.form.version });
    return { id: row.id, form: item.form, person };
  },

  /** For the dashboard's "Action required". */
  async dueFor(personId) {
    const { person, items } = await this._applicable(personId);
    return items.filter((i) => i.standing !== 'current').map((i) => ({ id: i.form.id, title: i.form.title, first: person.first_name, personId, expired: i.standing === 'expired' }));
  },
};
