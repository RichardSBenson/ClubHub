/**
 * DOMAIN — content types
 *
 * A federation defines what kinds of thing it publishes, and what each carries.
 * Instructor, Kata, Technique, Sponsor, Venue — none of which a developer
 * should have to add.
 *
 * The line this draws, deliberately:
 *
 *   A federation controls WHAT it records.  (configurable — here)
 *   The theme controls HOW it is laid out.  (fixed — packages/site)
 *
 * So a registrar can add a "Kata" type with the fields they want, and the pages
 * that display kata are generated from it. What nobody can do is drag a
 * carousel into the middle of a dojo page, because a canvas is how volunteer
 * organisations end up with broken sites.
 *
 * Imports only ./values.mjs and ./publishing.mjs.
 */

import { DomainError } from './values.mjs';
import { Slug } from './publishing.mjs';

// ---------------------------------------------------------------------------
// field definitions
// ---------------------------------------------------------------------------

/**
 * The field types on offer. Narrow on purpose — every one has to render
 * sensibly in a form, on a page, in an export and in structured data, and each
 * addition is a permanent commitment.
 */
export const FieldType = Object.freeze({
  TEXT: 'text',
  LONG_TEXT: 'longText',
  RICH_TEXT: 'richText',
  NUMBER: 'number',
  DATE: 'date',
  BOOLEAN: 'boolean',
  CHOICE: 'choice',
  IMAGE: 'image',
  DOCUMENT: 'document',
  LINK: 'link',
  /** A pointer to another entry of a named type. */
  REFERENCE: 'reference',
  all: ['text','longText','richText','number','date','boolean','choice',
        'image','document','link','reference'],
  isValid(t) { return FieldType.all.includes(t); },
});

export class FieldDefinition {
  constructor({ name, label, type, required = false, help = null,
                choices = null, referenceType = null, many = false,
                min = null, max = null, sortOrder = 0 }) {
    if (!name) throw new DomainError('A field needs a name');
    if (!/^[a-z][a-zA-Z0-9]*$/.test(name))
      throw new DomainError(
        `Field name "${name}" must start with a lowercase letter and contain ` +
        'only letters and numbers — it becomes a key in stored data');
    if (!FieldType.isValid(type))
      throw new DomainError(`Unknown field type "${type}" for "${name}" — ` +
        `choose from: ${FieldType.all.join(', ')}`);
    if (type === FieldType.CHOICE && (!choices || !choices.length))
      throw new DomainError(`Field "${name}" is a choice with nothing to choose`);
    if (type === FieldType.REFERENCE && !referenceType)
      throw new DomainError(`Field "${name}" references nothing — name a type`);

    this.name = name;
    this.label = label ?? name;
    this.type = type;
    this.required = !!required;
    this.help = help;
    this.choices = choices;
    this.referenceType = referenceType;
    this.many = !!many;
    this.min = min;
    this.max = max;
    this.sortOrder = sortOrder;
  }

  /**
   * Checks one value. Returns problems, never throws — an editor needs every
   * problem with a form at once, not the first one.
   */
  check(value) {
    const problems = [];
    const empty = value == null || value === '' ||
      (Array.isArray(value) && !value.length);

    if (empty) {
      if (this.required) problems.push(`${this.label} is required`);
      return problems;
    }

    const values = this.many ? (Array.isArray(value) ? value : [value]) : [value];
    if (this.many && !Array.isArray(value))
      problems.push(`${this.label} takes a list`);

    for (const v of values) {
      switch (this.type) {
        case FieldType.TEXT:
          if (typeof v !== 'string') problems.push(`${this.label} must be text`);
          else if (v.length > (this.max ?? 200))
            problems.push(`${this.label} is longer than ${this.max ?? 200} characters`);
          break;

        case FieldType.LONG_TEXT:
          if (typeof v !== 'string') problems.push(`${this.label} must be text`);
          break;

        case FieldType.RICH_TEXT:
          if (typeof v !== 'object' || !Array.isArray(v?.blocks))
            problems.push(`${this.label} must be a block document`);
          break;

        case FieldType.NUMBER: {
          const n = Number(v);
          if (Number.isNaN(n)) problems.push(`${this.label} must be a number`);
          else {
            if (this.min != null && n < this.min)
              problems.push(`${this.label} must be at least ${this.min}`);
            if (this.max != null && n > this.max)
              problems.push(`${this.label} must be no more than ${this.max}`);
          }
          break;
        }

        case FieldType.DATE:
          if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)))
            problems.push(`${this.label} must be a date like 2026-10-17`);
          break;

        case FieldType.BOOLEAN:
          if (typeof v !== 'boolean')
            problems.push(`${this.label} must be yes or no`);
          break;

        case FieldType.CHOICE:
          if (!this.choices.includes(v))
            problems.push(`${this.label} must be one of: ${this.choices.join(', ')}`);
          break;

        case FieldType.LINK:
          if (!/^(https?:\/\/|\/|mailto:|tel:)/.test(String(v)))
            problems.push(`${this.label} must be a link starting with https://, ` +
              '/, mailto: or tel:');
          break;

        case FieldType.IMAGE:
        case FieldType.DOCUMENT:
        case FieldType.REFERENCE:
          if (typeof v !== 'string' || !v)
            problems.push(`${this.label} must be an id`);
          break;
      }
    }
    return problems;
  }
}

// ---------------------------------------------------------------------------
// content types
// ---------------------------------------------------------------------------

/**
 * How a type's entries get their URL. Chosen from a fixed list, because a
 * federation inventing its own URL scheme is how a site ends up with
 * /Content/Item.aspx?id=47.
 */
export const RoutePattern = Object.freeze({
  /** /kata/pinan-sono-ichi */
  UNDER_TYPE: 'underType',
  /** /pinan-sono-ichi */
  TOP_LEVEL: 'topLevel',
  /** /whanganui/instructors/jane-smith — nested under its organisation */
  UNDER_ORGANISATION: 'underOrganisation',
  /** No page of its own; it only appears inside other pages. */
  NONE: 'none',
  all: ['underType','topLevel','underOrganisation','none'],
});

export class ContentType {
  constructor({ id = null, organisationId, name, label, pluralLabel = null,
                fields = [], routePattern = RoutePattern.UNDER_TYPE,
                titleField = 'title', slugField = null, icon = null,
                describedAs = null, schemaType = null }) {
    if (!/^[a-z][a-zA-Z0-9]*$/.test(name ?? ''))
      throw new DomainError(
        `Type name "${name}" must start with a lowercase letter and contain ` +
        'only letters and numbers');
    if (!RoutePattern.all.includes(routePattern))
      throw new DomainError(`Unknown route pattern "${routePattern}"`);

    this.id = id;
    this.organisationId = organisationId;
    this.name = name;
    this.label = label ?? name;
    this.pluralLabel = pluralLabel ?? `${this.label}s`;
    this.routePattern = routePattern;
    this.titleField = titleField;
    this.slugField = slugField;
    this.icon = icon;
    this.describedAs = describedAs;
    /** Optional schema.org type, so generated pages carry structured data. */
    this.schemaType = schemaType;

    this.fields = fields.map((f) =>
      f instanceof FieldDefinition ? f : new FieldDefinition(f))
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const names = this.fields.map((f) => f.name);
    const duplicate = names.find((n, i) => names.indexOf(n) !== i);
    if (duplicate) throw new DomainError(`Two fields both called "${duplicate}"`);

    if (this.routePattern !== RoutePattern.NONE
        && !names.includes(this.titleField))
      throw new DomainError(
        `"${this.titleField}" is the title field but this type has no such field`);
  }

  field(name) { return this.fields.find((f) => f.name === name) ?? null; }

  /** Every problem with a set of values, so a form can show them all at once. */
  check(values = {}) {
    const problems = [];
    for (const f of this.fields) problems.push(...f.check(values[f.name]));

    for (const key of Object.keys(values)) {
      if (!this.field(key))
        problems.push(`"${key}" is not a field on ${this.label}`);
    }
    return problems;
  }

  /**
   * Where an entry of this type lives. Returns a path string, or null when the
   * type has no page of its own.
   */
  pathFor({ slug, organisationSlug = null }) {
    const s = Slug.of(slug).value;
    switch (this.routePattern) {
      case RoutePattern.TOP_LEVEL: return `/${s}`;
      case RoutePattern.UNDER_TYPE:
        return `/${Slug.of(this.pluralLabel.toLowerCase()).value}/${s}`;
      case RoutePattern.UNDER_ORGANISATION:
        if (!organisationSlug)
          throw new DomainError(
            `${this.label} is routed under its organisation, but none was given`);
        return `/${Slug.of(organisationSlug).value}/` +
          `${Slug.of(this.pluralLabel.toLowerCase()).value}/${s}`;
      default: return null;
    }
  }

  /**
   * Adding a field is safe. Removing one, renaming one, or making an optional
   * field required breaks entries that already exist — so those are named, and
   * the caller decides.
   */
  changesFrom(previous) {
    if (!previous) return { safe: true, breaking: [] };
    const breaking = [];

    for (const old of previous.fields) {
      const now = this.field(old.name);
      if (!now) {
        breaking.push(`removing "${old.label}" discards data already entered`);
        continue;
      }
      if (now.type !== old.type)
        breaking.push(`changing "${old.label}" from ${old.type} to ${now.type} ` +
          'may not convert cleanly');
      if (now.required && !old.required)
        breaking.push(`making "${old.label}" required will leave existing ` +
          'entries invalid');
      if (now.type === FieldType.CHOICE && old.type === FieldType.CHOICE) {
        const gone = old.choices.filter((c) => !now.choices.includes(c));
        if (gone.length)
          breaking.push(`removing the choices ${gone.join(', ')} from ` +
            `"${old.label}" orphans entries using them`);
      }
    }
    return { safe: breaking.length === 0, breaking };
  }
}

// ---------------------------------------------------------------------------
// entries
// ---------------------------------------------------------------------------

export class ContentEntry {
  constructor({ id = null, typeName, organisationId, slug, values = {},
                status = 'draft', createdAt = null, updatedAt = null }) {
    if (!typeName) throw new DomainError('An entry needs a type');
    if (!['draft','review','published','archived'].includes(status))
      throw new DomainError(`Unknown entry status "${status}"`);
    this.id = id;
    this.typeName = typeName;
    this.organisationId = organisationId;
    this.slug = slug ? Slug.of(slug) : null;
    this.values = values;
    this.status = status;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  titleUnder(type) { return this.values[type.titleField] ?? '(untitled)'; }

  /** A slug from the title, unless the type nominates a field for it. */
  slugUnder(type) {
    if (this.slug) return this.slug;
    const source = type.slugField
      ? this.values[type.slugField]
      : this.values[type.titleField];
    return Slug.from(source ?? '');
  }

  withValues(values) {
    return new ContentEntry({ ...this, slug: this.slug?.value ?? null,
      values: { ...this.values, ...values } });
  }
}
