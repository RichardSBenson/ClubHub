/**
 * USE CASES — a person's photograph and "about me" words.
 *
 * The person, a parent or guardian, or an official of their club who keeps the register may change them. A child's
 * photograph is kept only with a parent's yes, asked every time rather than assumed. Anyone who teaches at their club may
 * see the photograph.
 */

import { ageOn } from '../domain/people.mjs';
import { photoNeedsConsent } from '../domain/documents.mjs';
import { REGISTER, TEACH } from '../domain/access.mjs';
import { requirePort, Refused, NotPermitted, Missing, AUTHORISATION, PHOTO_STORE } from './ports.mjs';

const MAX_ABOUT = 280;

class PhotoUseCase {
  /** `howMayActFor(accountId, personId)` → 'self' | 'guardian' | null. */
  constructor({ store, auth, howMayActFor, adultAge, today }) {
    this.store = requirePort(store, PHOTO_STORE);
    this.auth = requirePort(auth, AUTHORISATION);
    this.howMayActFor = howMayActFor;
    this.adultAge = adultAge;
    this.today = today;
  }

  async mayChange(actorId, personId) {
    if (await this.howMayActFor(actorId, personId)) return true;
    for (const home of await this.store.homesOf(personId)) if (await this.auth.hasRoleAt(actorId, home, REGISTER)) return true;
    return false;
  }

  async assertMayChange(actorId, personId) {
    if (!await this.mayChange(actorId, personId)) throw new NotPermitted('Not permitted');
  }
}

/** Throws unless the actor may change this person's photograph. */
export class CheckMayChangePhoto extends PhotoUseCase {
  execute({ actorId, personId }) { return this.assertMayChange(actorId, personId); }
}

export class SetPhoto extends PhotoUseCase {
  async execute({ actorId, personId, bytes, identified, filename, consent = false }) {
    await this.assertMayChange(actorId, personId);
    if (photoNeedsConsent(ageOn(await this.store.dateOfBirthOf(personId), null), this.adultAge()) && !consent)
      throw new Refused('Please confirm that their parent or guardian agrees to this photograph being kept.');
    const home = await this.store.homeOf(personId);
    if (!home) throw new Missing('Person has no current affiliation');
    const name = await this.store.nameOf(personId);
    return this.store.atomically(async (store) => {
      const asset = await store.addPhotoAsset({ organisationId: home, bytes, identified, filename, uploadedBy: actorId,
        altText: `Photograph of ${name}`,
        consentRef: `Kept with the agreement of the person or their guardian, recorded ${this.today()}` });
      await store.setPhoto(personId, asset.id);
      await store.audit({ actorId, organisationId: home, action: 'person_photo_set', entityId: personId, after: { assetId: asset.id } });
      return asset;
    });
  }
}

export class ClearPhoto extends PhotoUseCase {
  async execute({ actorId, personId }) {
    await this.assertMayChange(actorId, personId);
    await this.store.atomically(async (store) => {
      await store.clearPhoto(personId);
      await store.audit({ actorId, organisationId: null, action: 'person_photo_cleared', entityId: personId, after: null });
    });
  }
}

export class SetAbout extends PhotoUseCase {
  async execute({ actorId, personId, text }) {
    await this.assertMayChange(actorId, personId);
    const about = String(text ?? '').replace(/\r\n/g, '\n').trim();
    if (about.length > MAX_ABOUT) throw new Refused(`Keep it to ${MAX_ABOUT} characters.`);
    await this.store.atomically(async (store) => {
      await store.setAbout(personId, about || null);
      await store.audit({ actorId, organisationId: null, action: 'person_about_changed', entityId: personId, after: null });
    });
  }
}

export class OpenPhoto extends PhotoUseCase {
  async execute({ actorId, personId }) {
    const assetId = await this.store.photoAssetIdOf(personId);
    if (!assetId) throw new Missing('Photograph');
    let allowed = !!await this.howMayActFor(actorId, personId);
    if (!allowed) for (const home of await this.store.homesOf(personId)) {
      if (await this.auth.hasRoleAt(actorId, home, TEACH)) { allowed = true; break; }
    }
    if (!allowed) throw new NotPermitted('Not permitted');
    const file = await this.store.photoFile(assetId);
    if (!file) throw new Missing('Photograph');
    return file;
  }
}
