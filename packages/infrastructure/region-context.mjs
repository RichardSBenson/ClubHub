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

const store = new AsyncLocalStorage();
const fresh = (stored = {}, types = null) => ({ region: resolveRegion(stored), eventTypes: resolveEventTypes(types) });

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

/** For a script that has no request to wrap (the site build): apply these settings to everything that follows. */
export const enterRegion = (stored, types = null) => {
  const s = store.getStore();
  if (s) { s.region = resolveRegion(stored); s.eventTypes = resolveEventTypes(types); }
  else store.enterWith(fresh(stored, types));
};
