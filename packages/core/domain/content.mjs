/**
 * DOMAIN — content types
 *
 * A federation defines what it stores. Instructor, Kata, Technique, Sponsor,
 * Venue — whatever that organisation actually has. Fields are data, not code,
 * so adding one does not need a developer.
 *
 * What is NOT configurable is layout. A type says what an Instructor *is*; it
 * does not say where on the page their photo goes. That line is deliberate:
 * configurable content answers the developer bottleneck, a configurable canvas
 * produces broken pages.
 *
 * Imports only ./values.mjs and ./publishing.mjs (for Slug).
 */

import { DomainError } from './values.mjs';
import { Slug } from './publishing.mjs';

// ---------------------------------------------------------------------------
// field kinds
// ---------------------------------------------------------------------------

/**
 * Deliberately short. Every kind here has an obvious editor control and an
 * obvious way to render. A kind nobody can draw is a kind nobody should define.
 */
export const FieldKind = Object.freeze({
  TEXT: 'text',            // one line
  LONG_TEXT: 'longText',   // a paragraph, plain
  RICH_TEXT: 'richText',   // a block document
  NUMBER: 'number',
  DATE: 'date',
  BOOLEAN: 'boolean',
  CHOICE: 'choice',        // one of a fixed list
  REFERENCE: 'reference',  // another entry, person or organisation
  IMAGE: 'image',
  all: ['text','longText','richText','number','date','boolean','choice',
        'reference','image'],
  isValid(k) { return FieldKind.all.includes(k); },
});

export class FieldDefinition {
  constructor({ name, label, kind, required = false, unique = false,
                repeats = false, options = null, referenceTo = null,
                helpText = null, min = null, max = null,
                requiredFrom = null }) {
    if (!/^[a-z][a-zA-Z0-9]*$/.test(String(name ?? '')))
      throw new DomainError(
        `Field name must start lowercase and contain no spaces, got "${name}"`);
    if (!FieldKind.isValid(kind))
      throw new DomainError(`Unknown field kind "${kind}" — one of: ` +
        FieldKind.all.join(', '));
    if (kind === FieldKind.CHOICE && !(options?.length))
      throw new DomainError(`Field "${name}" is a choice but lists no options`);
    if (kind === FieldKind.REFERENCE && !referenceTo)
      throw new DomainError(`Field "${name}" is a reference but says to what`);

    this.name = name;
    this.label = label ?? humanise(name);
    this.kind = kind;
    this.required = !!required;
    this.unique = !!unique;
    this.repeats = !!repeats;
    this.options = options ?? null;
    this.referenceTo = referenceTo ?? null;
    this.helpText = helpText;
    this.min = min;
    this.max = max;

    /**
     * The schema-evolution escape hatch. A field made required today cannot
     * retrospectively invalidate entries written last year — the organisation
     * would find every old entry unsaveable and nobody would know why.
     *
     * Set when a field becomes required; entries created before it are exempt.
     */
    this.requiredFrom = requiredFrom;
  }

  /** Is this field required for an entry created on this date? */
  isRequiredFor(createdOn) {
    if (!this.required) return false;
    if (!this.requiredFrom) return true;
    return String(createdOn ?? '') >= String(this.requiredFrom);
  }

  /** Returns a list of problems. Empty means the value is acceptable. */
  check(value, { createdOn = null } = {}) {
    const problems = [];
    const empty = value === null || value === undefined || value === ''
      || (Array.isArray(value) && value.length === 0);

    if (empty) {
      if (this.isRequiredFor(createdOn))
        problems.push(`${this.label} is required`);
      return problems;
    }

    const values = this.repeats
      ? (Array.isArray(value) ? value : [value])
      : [value];

    if (this.repeats && !Array.isArray(value))
      problems.push(`${this.label} takes a list`);

    for (const v of values) problems.push(...this.#checkOne(v));
    return problems;
  }

  #checkOne(v) {
    const p = [];
    switch (this.kind) {
      case FieldKind.TEXT:
      case FieldKind.LONG_TEXT:
        if (typeof v !== 'string') { p.push(`${this.label} must be text`); break; }
        if (this.max && v.length > this.max)
          p.push(`${this.label} is longer than ${this.max} characters`);
        if (this.min && v.length < this.min)
          p.push(`${this.label} is shorter than ${this.min} characters`);
        break;

      case FieldKind.RICH_TEXT:
        if (typeof v !== 'object' || !Array.isArray(v?.blocks))
          p.push(`${this.label} must be a block document`);
        break;

      case FieldKind.NUMBER:
        if (typeof v !== 'number' || Number.isNaN(v))
          { p.push(`${this.label} must be a number`); break; }
        if (this.min != null && v < this.min)
          p.push(`${this.label} must be at least ${this.min}`);
        if (this.max != null && v > this.max)
          p.push(`${this.label} must be at most ${this.max}`);
        break;

      case FieldKind.DATE:
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)))
          p.push(`${this.label} must be a date like 2026-10-17`);
        break;

      case FieldKind.BOOLEAN:
        if (typeof v !== 'boolean') p.push(`${this.label} must be yes or no`);
        break;

      case FieldKind.CHOICE:
        if (!this.options.includes(v))
          p.push(`${this.label} must be one of: ${this.options.join(', ')}`);
        break;

      case FieldKind.REFERENCE:
      case FieldKind.IMAGE:
        if (typeof v !== 'string' || !v)
          p.push(`${this.label} must reference something`);
        break;
    }
    return p;
  }
}

const humanise = (name) => name
  .replace(/([A-Z])/g, ' $1')
  .replace(/^./, (c) => c.toUpperCase())
  .trim();

// ---------------------------------------------------------------------------
// content type
// ---------------------------------------------------------------------------

export class ContentType {
  constructor({ id = null, organisationId, name, slug = null, fields = [],
                titleField = null, slugField = null, routePrefix = null,
                icon = null, describedBy = null }) {
    if (!name) throw new DomainError('A content type needs a name');
    if (!organisationId)
      throw new DomainError('A content type belongs to an organisation');

    this.id = id;
    this.organisationId = organisationId;
    this.name = name;
    this.slug = Slug.of(slug ?? Slug.from(name).value);
    this.icon = icon;
    this.describedBy = describedBy;
    this.routePrefix = routePrefix;

    this.fields = fields.map((f) =>
      f instanceof FieldDefinition ? f : new FieldDefinition(f));

    const names = this.fields.map((f) => f.name);
    const duplicate = names.find((n, i) => names.indexOf(n) !== i);
    if (duplicate)
      throw new DomainError(`"${name}" defines "${duplicate}" twice`);

    this.titleField = titleField ?? this.fields.find((f) =>
      f.kind === FieldKind.TEXT)?.name ?? null;
    if (this.titleField && !names.includes(this.titleField))
      throw new DomainError(`titleField "${this.titleField}" is not a field`);

    this.slugField = slugField ?? this.titleField;
  }

  field(name) { return this.fields.find((f) => f.name === name) ?? null; }

  /**
   * Check a whole entry. Returns every problem, because an editor needs the
   * list, not the first one.
   */
  check(values = {}, { createdOn = null } = {}) {
    const problems = [];

    for (const field of this.fields)
      problems.push(...field.check(values[field.name], { createdOn })
        .map((p) => ({ field: field.name, message: p })));

    for (const key of Object.keys(values)) {
      if (!this.field(key))
        problems.push({ field: key,
          message: `"${key}" is not a field on ${this.name}` });
    }

    return problems;
  }

  /**
   * What changes safely, and what does not.
   *
   * Over-modelling and under-modelling are both traps; the way out is being
   * able to change a type later without breaking what is already stored. This
   * says when that is safe.
   */
  changesFrom(previous) {
    const breaking = [], safe = [];
    const was = new Map(previous.fields.map((f) => [f.name, f]));

    for (const f of this.fields) {
      const before = was.get(f.name);
      if (!before) {
        (f.required && !f.requiredFrom
          ? breaking : safe).push(
          f.required && !f.requiredFrom
            ? `"${f.label}" is new and required — existing entries would ` +
              `become invalid. Set requiredFrom, or leave it optional.`
            : `"${f.label}" added`);
        continue;
      }
      if (before.kind !== f.kind)
        breaking.push(`"${f.label}" changes from ${before.kind} to ${f.kind} — ` +
          `existing values may not fit`);
      if (!before.required && f.required && !f.requiredFrom)
        breaking.push(`"${f.label}" becomes required — entries without it ` +
          `would become invalid. Set requiredFrom.`);
      if (before.repeats !== f.repeats)
        breaking.push(`"${f.label}" changes between one value and a list`);
      if (before.kind === FieldKind.CHOICE && f.kind === FieldKind.CHOICE) {
        const gone = before.options.filter((o) => !f.options.includes(o));
        if (gone.length)
          breaking.push(`"${f.label}" no longer allows: ${gone.join(', ')}`);
      }
    }

    for (const [name, f] of was)
      if (!this.field(name))
        breaking.push(`"${f.label}" is removed — its values would be lost`);

    return { safe, breaking, isSafe: breaking.length === 0 };
  }
}

// ---------------------------------------------------------------------------
// content entry
// ---------------------------------------------------------------------------

export class ContentEntry {
  constructor({ id = null, typeId, organisationId, slug, values = {},
                createdOn = null, status = 'draft' }) {
    if (!typeId) throw new DomainError('An entry needs a type');
    if (!['draft', 'review', 'published', 'archived'].includes(status))
      throw new DomainError(`Unknown entry status "${status}"`);

    this.id = id;
    this.typeId = typeId;
    this.organisationId = organisationId;
    this.slug = Slug.of(slug);
    this.values = values;
    this.createdOn = createdOn;
    this.status = status;
  }

  get title() { return this.values?.title ?? this.slug.value; }

  titleFor(type) {
    return type.titleField ? this.values[type.titleField] ?? this.slug.value
                           : this.slug.value;
  }

  withValues(values) {
    return new ContentEntry({ ...this, slug: this.slug.value, values });
  }
}
