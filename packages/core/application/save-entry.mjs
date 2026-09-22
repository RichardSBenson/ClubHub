/**
 * USE CASE — create or update an entry.
 *
 * Every value is checked against its type's field definitions before anything
 * is written, and every problem comes back at once — an editor filling a form
 * needs the whole list, not the first thing that failed.
 *
 * Saving never publishes. That is a separate act, with its own record.
 */

import { ContentEntry } from '../domain/content-types.mjs';
import { Slug } from '../domain/publishing.mjs';
import { requirePort, Refused, NotPermitted,
         CONTENT_TYPE_REPOSITORY, CONTENT_ENTRY_REPOSITORY,
         AUTHORISATION, CLOCK } from './ports.mjs';

const MAY_WRITE = ['owner', 'administrator', 'contributor'];

export class SaveEntry {
  constructor({ types, entries, auth, clock }) {
    this.types = requirePort(types, CONTENT_TYPE_REPOSITORY);
    this.entries = requirePort(entries, CONTENT_ENTRY_REPOSITORY);
    this.auth = requirePort(auth, AUTHORISATION);
    this.clock = requirePort(clock, CLOCK);
  }

  async execute({ actorId, entryId = null, organisationId, typeName,
                  values = {}, slug = null }) {
    if (!await this.auth.hasRoleAt(actorId, organisationId, MAY_WRITE))
      throw new NotPermitted('You may not write content here');

    const type = await this.types.byName(organisationId, typeName);
    if (!type) throw new Refused(`No content type called "${typeName}"`);

    const existing = entryId ? await this.entries.byId(entryId) : null;
    if (entryId && !existing) throw new Refused('No such entry');
    if (existing && existing.typeName !== typeName)
      throw new Refused('That entry is a different type');

    // Merge before checking, so a partial update is judged on the result.
    const merged = existing ? { ...existing.values, ...values } : values;
    const problems = type.check(merged);
    if (problems.length) throw new Refused(problems);

    const entry = new ContentEntry({
      id: entryId, typeName, organisationId,
      slug: slug ?? existing?.slug?.value ?? null,
      values: merged,
      status: existing?.status ?? 'draft',
      createdAt: existing?.createdAt ?? this.clock.today(),
      updatedAt: this.clock.today(),
    });

    // A slug is derived once and then kept. Letting it follow the title means
    // every correction to a headline silently moves the page.
    if (!entry.slug) entry.slug = entry.slugUnder(type);

    const clash = await this.entries.bySlug(
      organisationId, typeName, entry.slug.value);
    if (clash && clash.id !== entryId)
      throw new Refused(
        `Another ${type.label} already uses "${entry.slug.value}"`);

    const saved = await this.entries.save(entry);
    const revisionId = await this.entries.saveRevision(
      saved.id, merged, actorId);

    return { entry: saved, revisionId, type };
  }
}
