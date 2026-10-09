/**
 * INFRASTRUCTURE — which organisation's assumptions apply to the work in hand
 *
 * A request (or one site build) is about one organisation, and that organisation's currency, language, age of
 * adulthood and kinds of event apply to everything it shows. Carrying them in the async context means nothing has to
 * pass them through forty function signatures, and two requests running at once can never see each other's.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { resolveRegion } from '../core/domain/region.mjs';
import { resolveEventTypes } from '../core/domain/event-types.mjs';
import { NEUTRAL_VOCABULARY } from '../core/domain/founding.mjs';

const store = new AsyncLocalStorage();
const fresh = (stored = {}, types = null, words = null) => ({ region: resolveRegion(stored), eventTypes: resolveEventTypes(types), words: { ...NEUTRAL_VOCABULARY, ...(words ?? {}) } });

/** Run `fn` with its own settings, starting from the platform defaults. */
export const withRegion = (fn, stored = {}) => store.run(fresh(stored), fn);

/** Say which organisation's region applies from here on. A no-op outside withRegion. */
export const setRegion = (stored) => { const s = store.getStore(); if (s) s.region = resolveRegion(stored); };

/** The current assumptions: { currency, locale, adultAge }. */
export const region = () => store.getStore()?.region ?? resolveRegion({});

/** Say which kinds of event apply from here on (the organisation's own list, or the generic one when none). */
export const setEventTypes = (stored) => { const s = store.getStore(); if (s) s.eventTypes = resolveEventTypes(stored); };

/** The kinds of event this organisation runs. */
export const eventTypes = () => store.getStore()?.eventTypes ?? resolveEventTypes(null);

/** Say what this organisation calls things (its club, grade, instructor). */
export const setWords = (words) => { const s = store.getStore(); if (s) s.words = { ...NEUTRAL_VOCABULARY, ...(words ?? {}) }; };

/** The words in use: { club, clubPlural, grade, grading, instructor }. Neutral unless the organisation chose its own. */
export const words = () => store.getStore()?.words ?? NEUTRAL_VOCABULARY;

/** For a script that has no request to wrap (the site build): apply these settings to everything that follows. */
export const enterRegion = (stored, types = null, vocab = null) => {
  const s = store.getStore();
  if (s) { s.region = resolveRegion(stored); s.eventTypes = resolveEventTypes(types); s.words = { ...NEUTRAL_VOCABULARY, ...(vocab ?? {}) }; }
  else store.enterWith(fresh(stored, types, vocab));
};
