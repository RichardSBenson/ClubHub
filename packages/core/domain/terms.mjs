/**
 * DOMAIN — school terms
 *
 * A child's class enrolment belongs to a school term; their membership is a separate thing. Terms differ
 * by country (and in some countries by state), so nothing here assumes one calendar: a country's terms are
 * data, set once at the level that owns them and inherited by every club below.
 */
import { addDays, weekdayOf } from './attendance.mjs';

const days = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);

/**
 * Calendars that ship with Honbu. Each one names where it came from, so a club can check it. Only countries
 * whose terms are set nationally belong here; where states or districts differ (Australia, the UK, the US,
 * Canada), a federation enters its own once and every club beneath inherits it.
 */
export const CALENDARS = Object.freeze({
  NZ: {
    name: 'New Zealand state schools',
    source: 'Ministry of Education, education.govt.nz/term-dates-and-holidays',
    note: 'Term 1 start and Term 4 end vary by school within a range; the dates here are the common ones.',
    years: {
      2026: [['2026-02-02', '2026-04-02'], ['2026-04-20', '2026-07-03'], ['2026-07-20', '2026-09-25'], ['2026-10-12', '2026-12-18']],
      2027: [['2027-02-01', '2027-04-09'], ['2027-04-27', '2027-07-02'], ['2027-07-19', '2027-09-24'], ['2027-10-11', '2027-12-17']],
    },
  },
});

export const builtInFor = (country, year) => {
  const c = CALENDARS[String(country ?? '').toUpperCase()];
  const t = c?.years?.[year];
  return t ? { ...c, terms: t.map(([starts, ends], i) => ({ number: i + 1, name: `Term ${i + 1}`, starts, ends })) } : null;
};
export const builtInYears = (country) => Object.keys(CALENDARS[String(country ?? '').toUpperCase()]?.years ?? {}).map(Number);

/** Which year to offer next: this year's terms are loaded; from September, offer the following year. */
export function yearToOffer(loadedYears, today) {
  const y = Number(today.slice(0, 4));
  const want = (today.slice(5, 7) >= '09' ? [y, y + 1] : [y]).find((n) => !loadedYears.includes(n));
  return want ?? null;
}

export const ENROL_LEAD_DAYS = 28;

/** upcoming (not yet open) · open (can enrol) · current (running) · ended */
export function termState(t, today) {
  if (today > t.ends) return 'ended';
  if (today >= t.starts) return t.enrol_closes && today > t.enrol_closes ? 'closed' : 'current';
  const opens = t.enrol_opens ?? addDays(t.starts, -ENROL_LEAD_DAYS);
  return today >= opens ? 'open' : 'upcoming';
}
export const mayEnrol = (t, today) => ['open', 'current'].includes(termState(t, today));

/** The gaps between terms: the school holidays. */
export function holidays(terms) {
  const s = [...terms].sort((a, b) => a.starts.localeCompare(b.starts));
  return s.slice(1).map((t, i) => ({ from: addDays(s[i].ends, 1), to: addDays(t.starts, -1), after: s[i].name, before: t.name }))
    .filter((h) => h.from <= h.to);
}
export const inHoliday = (terms, date) => holidays(terms).find((h) => date >= h.from && date <= h.to) ?? null;

export const MID_TERM = Object.freeze({
  none: 'No joining part-way through',
  full: 'Full price whenever they join',
  weeks: 'Pro-rata by the weeks left',
  classes: 'Pro-rata by the classes left',
  fixed: 'A fixed reduced price',
});

const classesBetween = (weekdays, from, to) => {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (weekdays.includes(weekdayOf(d))) n++;
  return n;
};

/**
 * What a child pays for a term, given the day they enrol. `fullCents` is the club's term price.
 * `weekdays` the weekdays they train on (0–6), for pro-rata by classes. Returns null when the club does not
 * take mid-term joiners and the term has begun.
 */
export function termPrice({ fullCents, term, today, rule = { mode: 'weeks' }, weekdays = [] }) {
  const from = today > term.starts ? today : term.starts;
  if (from > term.ends) return null;
  if (from === term.starts || rule.mode === 'full') return { cents: fullCents, kind: 'full', note: 'The full term' };
  if (rule.mode === 'none') return null;
  if (rule.mode === 'fixed') return { cents: Math.min(rule.fixedCents ?? fullCents, fullCents), kind: 'fixed', note: 'Joining part-way through the term' };
  const [left, total] = rule.mode === 'classes' && weekdays.length
    ? [classesBetween(weekdays, from, term.ends), classesBetween(weekdays, term.starts, term.ends)]
    : [Math.ceil((days(from, term.ends) + 1) / 7), Math.ceil((days(term.starts, term.ends) + 1) / 7)];
  const unit = rule.mode === 'classes' && weekdays.length ? 'classes' : 'weeks';
  return { cents: Math.round(fullCents * Math.min(left, total) / total / 5) * 5, kind: 'prorata', note: `${left} of ${total} ${unit} left` };
}

export function readMidTerm(f = {}) {
  const mode = Object.hasOwn(MID_TERM, f.mid_term) ? f.mid_term : 'weeks';
  const fixed = Math.round(Number.parseFloat(String(f.fixed ?? '').replace(/[^0-9.]/g, '')) * 100) || 0;
  return { mode, fixedCents: mode === 'fixed' ? fixed : 0 };
}
export const problemsWithMidTerm = (r) => r.mode === 'fixed' && !r.fixedCents ? ['Say what the reduced price is.'] : [];

export function problemsWithTerm(t, others = []) {
  const out = [];
  const real = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? '') && !Number.isNaN(Date.parse(d));
  if (!String(t.name ?? '').trim()) out.push('Give the term a name.');
  if (!real(t.starts) || !real(t.ends)) return [...out, 'Give the first and last day as YYYY-MM-DD.'];
  if (t.ends < t.starts) out.push('A term cannot end before it starts.');
  if (days(t.starts, t.ends) > 120) out.push('That is longer than any school term.');
  if (others.some((o) => o.id !== t.id && t.starts <= o.ends && t.ends >= o.starts)) out.push('That overlaps another term.');
  return out;
}

/** Who should be offered the next term today: enrolled in the term that just ended or is ending, not yet in the next. */
export function offersDue(terms, today) {
  const s = [...terms].sort((a, b) => a.starts.localeCompare(b.starts));
  const next = s.find((t) => termState(t, today) === 'open' && today <= t.starts);
  const prev = next && [...s].reverse().find((t) => t.ends < next.starts);
  return next && prev ? { next, prev } : null;
}

/** A club's rule for joining part-way through a term; by default, pro rata by the weeks that remain. */
export const midTermOf = (org) => {
  const r = org?.settings?.terms?.midTerm;
  return r?.mode ? { mode: r.mode, fixedCents: r.fixedCents ?? 0 } : { mode: 'weeks', fixedCents: 0 };
};
