/** The timezone used when an organisation has not set one. Named once so it is changed once. */
export const DEFAULT_TIMEZONE = 'Pacific/Auckland';

/** Today as YYYY-MM-DD (UTC) at `now`. The domain reads the clock only through here, or takes the day as an argument. */
export const todayIso = (now = new Date()) => now.toISOString().slice(0, 10);
