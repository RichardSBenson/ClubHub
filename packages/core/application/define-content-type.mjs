/**
 * USE CASE — define or change a content type.
 *
 * This is the answer to the developer bottleneck: a federation adds an
 * "Instructor" or "Kata" type itself, with the fields it wants, and the pages
 * that display them are generated.
 *
 * What it will not do is let someone quietly break data that already exists.
 * Adding a field is safe and proceeds. Removing one, changing its type, or
 * making it required is named and refused unless the caller says so
 * deliberately — with the count of affected entries in front of them.
 */

import { ContentType } from '../domain/content-types.mjs';
import { requirePort, Refused, NotPermitted,
         CONTENT_TYPE_REPOSITORY, AUTHORISATION } from './ports.mjs';

const MAY_DEFINE = ['owner', 'administrator'];

export class DefineContentType {
  constructor({ types, auth }) {
    this.types = requirePort(types, CONTENT_TYPE_REPOSITORY);
    this.auth = requirePort(auth, AUTHORISATION);
  }

  async execute({ actorId, organisationId, definition, acceptBreaking = false }) {
    if (!await this.auth.hasRoleAt(actorId, organisationId, MAY_DEFINE))
      throw new NotPermitted('You may not define content types here');

    // The constructor is the validator — an invalid type cannot be built.
    const type = new ContentType({ ...definition, organisationId });

    // Only this organisation's own definition. If a parent defined this type,
    // we are creating an override, not editing theirs — and breaking changes
    // are judged against what we had before, not against the parent's.
    const existing = await this.types.ownedBy(organisationId, type.name);
    const { safe, breaking } = type.changesFrom(existing);

    if (!safe) {
      const affected = await this.types.countEntries(type.name, organisationId);
      if (!acceptBreaking) {
        throw new Refused([
          ...breaking,
          `${affected} ${affected === 1 ? 'entry uses' : 'entries use'} this type`,
        ]);
      }
      const saved = await this.types.save({ ...type, id: existing?.id ?? null });
      return { type: saved, created: !existing, breaking, affected };
    }

    const saved = await this.types.save({ ...type, id: existing?.id ?? null });
    return { type: saved, created: !existing, breaking: [], affected: 0 };
  }
}
