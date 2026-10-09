/**
 * INFRASTRUCTURE — which country's assumptions apply to the work in hand
 *
 * A request (or one site build) is about one organisation, and that organisation's currency, language and age of
 * adulthood apply to everything it shows. Carrying them in the async context means nothing has to pass them through
 * forty function signatures, and two requests running at once can never see each other's.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { resolveRegion } from '../core/domain/region.mjs';

const store = new AsyncLocalStorage();

/** Run `fn` with its own region, starting from the platform defaults. */
export const withRegion = (fn, stored = {}) => store.run({ region: resolveRegion(stored) }, fn);

/** Say which organisation's assumptions apply from here on. A no-op outside withRegion. */
export const setRegion = (stored) => { const s = store.getStore(); if (s) s.region = resolveRegion(stored); };

/** The current assumptions: { currency, locale, adultAge }. */
export const region = () => store.getStore()?.region ?? resolveRegion({});

/** For a script that has no request to wrap (the site build): apply this region to everything that follows. */
export const enterRegion = (stored) => store.enterWith({ region: resolveRegion(stored) });
