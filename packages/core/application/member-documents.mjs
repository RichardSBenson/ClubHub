/**
 * USE CASES — documents a member sends to their club: send, list, open, review, and what is waiting.
 *
 * Who may do what: the person, a parent or guardian, or an official of their club may send and list; the file itself is
 * opened only by those people, and an official opening somebody else's is written down. Only an official reviews.
 */

import { problemsWithDocument } from '../domain/documents.mjs';
import { REGISTER } from '../domain/access.mjs';
import { requirePort, Refused, NotPermitted, Missing, AUTHORISATION, MEMBER_DOCUMENT_STORE } from './ports.mjs';

class DocumentUseCase {
  /** `howMayActFor(accountId, personId)` → 'self' | 'guardian' | null — the self-service door. */
  constructor({ store, auth, howMayActFor }) {
    this.store = requirePort(store, MEMBER_DOCUMENT_STORE);
    this.auth = requirePort(auth, AUTHORISATION);
    this.howMayActFor = howMayActFor;
  }

  /** The club of this person's at which the actor keeps the register, or null. */
  async officialHome(actorId, personId, store = this.store) {
    for (const home of await store.homesOf(personId)) {
      if (await this.auth.hasRoleAt(actorId, home, REGISTER)) return home;
    }
    return null;
  }
}

/** Qualifications the person's club asks for, for the "what is it?" list. */
export class DocumentChoices extends DocumentUseCase {
  async execute({ personId }) {
    const home = await this.store.homeOf(personId);
    return home ? this.store.qualificationChoices(home) : [];
  }
}

export class ListDocuments extends DocumentUseCase {
  async execute({ actorId, personId }) {
    const official = await this.officialHome(actorId, personId);
    if (!official && !await this.howMayActFor(actorId, personId)) throw new NotPermitted('Not permitted');
    return { rows: await this.store.documentsOf(personId), official: !!official };
  }
}

export class SendDocument extends DocumentUseCase {
  async execute({ actorId, personId, file, qualificationId = null, title = '', awardedOn = null, expiresOn = null, note = '' }) {
    if (!await this.howMayActFor(actorId, personId) && !await this.officialHome(actorId, personId)) throw new NotPermitted('Not permitted');
    const home = await this.store.homeOf(personId);
    if (!home) throw new Refused("This person is not on a club's roll yet, so there is nobody to send it to.");
    const qual = qualificationId ? await this.store.qualificationAt(home, qualificationId) : null;
    if (qualificationId && !qual) throw new Refused('That is not something this club asks for.');
    const today = await this.store.todayAt(home);
    const problems = problemsWithDocument({ title, awardedOn: awardedOn || '', expiresOn: expiresOn || '', hasQualification: !!qual },
      { size: file?.bytes?.length ?? 0 }, { today });
    if (problems.length) throw new Refused(problems.join('; '));

    return this.store.atomically(async (store) => {
      const row = await store.addDocument({
        personId, organisationId: home, qualificationId: qual?.id ?? null, title: (qual?.label ?? String(title).trim()).slice(0, 120),
        awardedOn: awardedOn || null, expiresOn: expiresOn || null, note: String(note ?? '').trim().slice(0, 300) || null,
        file, uploadedBy: actorId });
      await store.audit({ actorId, organisationId: home, action: 'document_sent', entityId: personId,
        after: { documentId: row.id, title: qual?.label ?? title } });
      return row;
    });
  }
}

export class OpenDocument extends DocumentUseCase {
  async execute({ actorId, personId, docId }) {
    const official = await this.officialHome(actorId, personId);
    const own = await this.howMayActFor(actorId, personId);
    if (!official && !own) throw new NotPermitted('Not permitted');
    const file = await this.store.documentFile(personId, docId);
    if (!file) throw new Missing('Document');
    // Somebody opening another person's document is the thing worth being able to answer for later.
    if (official && !own) await this.store.audit({ actorId, organisationId: official, action: 'document_opened', entityId: personId,
      after: { documentId: docId, title: file.title } });
    return file;
  }
}

/** A registrar accepts or declines. Accepting a qualification records it, with this file as the proof. */
export class ReviewDocument extends DocumentUseCase {
  async execute({ actorId, personId, docId, accept, note = '', awardedOn = null, expiresOn = null }) {
    const home = await this.officialHome(actorId, personId);
    if (!home) throw new NotPermitted('Not permitted');
    return this.store.atomically(async (store) => {
      const doc = await store.documentToReview(personId, docId);
      if (!doc) throw new Missing('Document');
      if (doc.status !== 'pending') throw new Refused('That one has already been dealt with.');
      let awardId = null;
      if (accept && doc.qualification_id) {
        const on = awardedOn || doc.awarded_on;
        if (!on) throw new Refused('There is no issue date on this one. Add the date it was issued before accepting.');
        awardId = (await store.addAward({ personId, qualificationId: doc.qualification_id, awardedOn: on,
          expiresOn: expiresOn || doc.expires_on || null, reference: 'Sent in by the member', recordedBy: actorId })).id;
      }
      await store.markReviewed({ docId, accepted: !!accept, reviewedBy: actorId, note: String(note ?? '').trim().slice(0, 300) || null, awardId });
      await store.audit({ actorId, organisationId: home, action: accept ? 'document_accepted' : 'document_declined', entityId: personId,
        after: { documentId: docId, title: doc.title } });
    });
  }
}

export class WaitingDocuments extends DocumentUseCase {
  async execute({ actorId, organisationId }) {
    if (!await this.auth.hasRoleAt(actorId, organisationId, REGISTER)) throw new NotPermitted('Not permitted');
    return this.store.waitingUnder(organisationId);
  }
}
