/**
 * USE CASES — what an organisation says about itself and how its site looks: the menu, the club profile, the look, the
 * crest and the home page.
 *
 * A federation's look is stored on the organisation and read by the same reader the build uses, so what is saved is exactly
 * what will be built. Pictures must be the organisation's own. A club has no look of its own.
 */

import { problemsWithClubProfile, changesTheSite } from '../domain/club-profile.mjs';
import { MANAGE, WRITE } from '../domain/access.mjs';
import { requirePort, Refused, NotPermitted, Missing, AUTHORISATION, SETTINGS_STORE } from './ports.mjs';

class SettingsUseCase {
  /**
   * The rules about menus and themes belong to the site, so they are handed in: `destinations({ authored, vocabulary })`,
   * `problemsWithNavigation(items, existing)` and `readTheme(doc)`.
   */
  constructor({ store, auth, destinations, problemsWithNavigation, readTheme }) {
    this.store = requirePort(store, SETTINGS_STORE);
    this.auth = requirePort(auth, AUTHORISATION);
    Object.assign(this, { destinations, problemsWithNavigation, readTheme });
  }

  async may(actorId, organisationId, roles) {
    if (!await this.auth.hasRoleAt(actorId, organisationId, roles)) throw new NotPermitted('Not permitted');
  }

  async ownPicture(organisationId, assetId) {
    if ((await this.store.assetOwner(assetId)) !== organisationId) throw new Refused("Choose one of this organisation's own pictures.");
  }
}

/** Reads the writers of pages are allowed to see. */
export class ReadSiteSettings extends SettingsUseCase {
  /** What this federation has stored for its menu, and everywhere its site has a page. */
  async navigation({ actorId, organisationId }) {
    await this.may(actorId, organisationId, WRITE);
    return { stored: (await this.store.settingsOf(organisationId))?.navigation ?? null, authored: await this.store.authoredPages(organisationId) };
  }

  async theme({ actorId, organisationId }) {
    await this.may(actorId, organisationId, WRITE);
    return (await this.store.settingsOf(organisationId))?.theme ?? null;
  }

  async crest({ actorId, organisationId }) {
    await this.may(actorId, organisationId, WRITE);
    return (await this.store.settingsOf(organisationId))?.logoAssetId ?? null;
  }

  /** What the home page says and shows at the top. Blank words fall back to the defaults. */
  async home({ actorId, organisationId }) {
    await this.may(actorId, organisationId, WRITE);
    const h = (await this.store.settingsOf(organisationId))?.homePage ?? {};
    return { heroAssetId: h.heroAssetId ?? null, heroHeading: h.heroHeading ?? '', heroText: h.heroText ?? '', heroButton: h.heroButton ?? '', shareAssetId: h.shareAssetId ?? null };
  }
}

/** Replace the menu, validated against what the site will actually have a page for. */
export class SaveNavigation extends SettingsUseCase {
  async execute({ actorId, organisationId, items, vocabulary = {} }) {
    await this.may(actorId, organisationId, MANAGE);
    const authored = await this.store.authoredPages(organisationId);
    const problems = this.problemsWithNavigation(items, this.destinations({ authored, vocabulary }));
    if (problems.length) throw new Refused(problems.join(' '));
    const clean = items.map((i) => ({ href: i.href.trim(), label: i.label.trim() }));
    return this.store.atomically(async (store) => {
      await store.putSetting(organisationId, 'navigation', { items: clean });
      await store.audit({ actorId, organisationId, action: 'navigation_save', after: { items: clean } });
      return clean;
    });
  }
}

export class ApplyTheme extends SettingsUseCase {
  async execute({ actorId, organisationId, doc }) {
    await this.may(actorId, organisationId, MANAGE);
    const read = this.readTheme(doc);
    if (!read.ok) throw new Refused(read.problems.join(' '));
    const before = (await this.store.settingsOf(organisationId))?.theme ?? null;
    await this.store.atomically(async (store) => {
      await store.putSetting(organisationId, 'theme', read.theme);
      await store.audit({ actorId, organisationId, action: 'theme_apply', before: before ? { name: before.name } : null, after: { name: read.theme.name } });
    });
    return read;
  }
}

/** Back to the deployment's own look (settings file, then defaults). */
export class ResetTheme extends SettingsUseCase {
  async execute({ actorId, organisationId }) {
    await this.may(actorId, organisationId, MANAGE);
    await this.store.atomically(async (store) => {
      await store.removeSetting(organisationId, 'theme');
      await store.audit({ actorId, organisationId, action: 'theme_reset', after: {} });
    });
  }
}

/** The crest: the picture used in the site header and on every event banner. null removes it. */
export class SetCrest extends SettingsUseCase {
  async execute({ actorId, organisationId, assetId }) {
    await this.may(actorId, organisationId, MANAGE);
    if (assetId) await this.ownPicture(organisationId, assetId);
    await this.store.atomically(async (store) => {
      if (assetId) await store.putSetting(organisationId, 'logoAssetId', assetId); else await store.removeSetting(organisationId, 'logoAssetId');
      await store.audit({ actorId, organisationId, action: 'crest_set', after: { assetId } });
    });
  }
}

/** Set the home-page top picture, wording and link-preview picture. `undefined` leaves a field alone; null or '' clears it. */
export class SetHomePage extends SettingsUseCase {
  async execute({ actorId, organisationId, heroAssetId, shareAssetId, heroHeading, heroText, heroButton }) {
    await this.may(actorId, organisationId, MANAGE);
    for (const [label, v] of [['heading', heroHeading], ['button', heroButton]])
      if (v != null && String(v).length > 80) throw new Refused(`The ${label} is too long (80 characters at most).`);
    if (heroText != null && String(heroText).length > 300) throw new Refused('The text under the heading is too long (300 characters at most).');
    for (const id of [heroAssetId, shareAssetId].filter(Boolean)) await this.ownPicture(organisationId, id);

    const before = (await this.store.settingsOf(organisationId))?.homePage ?? {};
    const next = { ...before };
    const put = (k, v) => {
      if (v === undefined) return;
      const s = typeof v === 'string' ? v.trim() : v;
      if (s === null || s === '') delete next[k]; else next[k] = s;
    };
    put('heroAssetId', heroAssetId); put('shareAssetId', shareAssetId);
    put('heroHeading', heroHeading); put('heroText', heroText); put('heroButton', heroButton);
    await this.store.atomically(async (store) => {
      await store.putSetting(organisationId, 'homePage', next);
      await store.audit({ actorId, organisationId, action: 'home_page_set', before, after: next });
    });
  }
}

/** The club, and who runs it, who trains in it, and what is coming up. */
export class ViewClubProfile extends SettingsUseCase {
  async execute({ actorId, organisationId }) {
    await this.may(actorId, organisationId, MANAGE);
    const club = await this.store.clubRow(organisationId);
    if (!club) throw new Missing('Club');
    return { club, ...await this.store.clubOverview(organisationId, club.parent_id) };
  }
}

export class SaveClubProfile extends SettingsUseCase {
  async execute({ actorId, organisationId, input }) {
    await this.may(actorId, organisationId, MANAGE);
    const before = await this.store.clubRow(organisationId);
    if (!before) throw new Missing('Club');
    const problems = problemsWithClubProfile(input);
    if (problems.length) throw new Refused(problems.join(' '));
    return this.store.atomically(async (store) => {
      const row = await store.updateClub(organisationId, input);
      const pick = (r) => ({ name: r.name, status: r.status, timezone: r.timezone, short_name: r.short_name, founded: r.founded_iso });
      await store.audit({ actorId, organisationId, action: 'club_profile_saved', before: pick(before), after: pick(row) });
      return { club: row, siteChanged: changesTheSite(before, row) };
    });
  }
}
