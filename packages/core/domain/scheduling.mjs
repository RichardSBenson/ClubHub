/**
 * DOMAIN — scheduling a page or article to go live on a date
 *
 * The site is rebuilt by a once-a-day run, so a schedule is a DATE, not a
 * time of day, and the honest promise is "that morning". Said plainly in the
 * screen, because a person who schedules for 9:00 and finds it live at 6:30
 * (or not until the next day) deserves to have been told.
 */
import { isDate, addDays } from './attendance.mjs';

export const MAX_DAYS_AHEAD = 365;

export function problemsWithScheduleDate(date, today) {
  if (!isDate(date)) return ['The date should look like 2026-11-14.'];
  if (date < today) return ['That date has already gone.'];
  if (date > addDays(today, MAX_DAYS_AHEAD)) return ['Scheduling is limited to a year ahead.'];
  return [];
}

export const SCHEDULE_NOTE = 'The site is refreshed once a day, early in the morning, so it goes live that morning.';
