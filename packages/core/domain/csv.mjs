/**
 * DOMAIN — writing a CSV that opens correctly in Excel and cannot run code.
 *
 * Two traps. A cell beginning with = + - @ (or a tab/return) is read by
 * spreadsheets as a formula, so a member who types `=HYPERLINK(...)` as their
 * name would turn the treasurer's export into an attack; such cells are
 * prefixed with an apostrophe. And Excel only reads UTF-8 reliably with a byte
 * order mark, so macrons in "Whānganui" survive.
 */
const FORMULA = /^[=+\-@\t\r]/;

export function cell(v) {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  // A plain negative number is a number, not a formula.
  if (FORMULA.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** columns: [{ key, label }]; rows: objects. */
export function toCsv(columns, rows) {
  const lines = [columns.map((c) => cell(c.label)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => cell(r[c.key])).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

export const cents = (n) => (n == null ? '' : (n / 100).toFixed(2));

export const REPORTS = Object.freeze({
  members:    { label: 'Members',            needs: 'register', dates: false },
  fees:       { label: 'Fees owing',         needs: 'register', dates: false },
  payments:   { label: 'Payments received',  needs: 'manage',   dates: true  },
  attendance: { label: 'Attendance',         needs: 'teach',    dates: true  },
  gradings:   { label: 'Grading history',    needs: 'register', dates: true  },
});

/** A date range from a query string: both ends optional, bad input ignored. */
export function readRange(from, to, today) {
  const ok = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? '') && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
  const start = ok(from) ? from : new Date(Date.parse(`${today}T00:00:00Z`) - 365 * 864e5).toISOString().slice(0, 10);
  const end = ok(to) ? to : today;
  return start <= end ? { from: start, to: end } : { from: end, to: start };
}

export const fileName = (slug, report, to) => `${slug}-${report}-${to}.csv`.replace(/[^\w.-]/g, '_');
