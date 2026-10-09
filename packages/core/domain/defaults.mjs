/**
 * The assumptions that stand when an organisation has not said otherwise. Named once, here, so changing one for a
 * different country is a one-line change and not a hunt (tools/check-architecture.mjs stops them being typed again).
 */
export const DEFAULT_TIMEZONE = 'Pacific/Auckland';
export const DEFAULT_LOCALE = 'en-NZ';
export const DEFAULT_CURRENCY = 'NZD';
export const DEFAULT_COUNTRY = 'NZ';

/** The age at which a person stops needing a parent or guardian to act for them. */
export const ADULT_AGE = 18;

/** Today as YYYY-MM-DD (UTC) at `now`. The domain reads the clock only through here, or takes the day as an argument. */
export const todayIso = (now = new Date()) => now.toISOString().slice(0, 10);
