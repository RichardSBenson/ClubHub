/**
 * DOMAIN — a tournament's entries as rows an organiser can put in a spreadsheet.
 *
 * Pure: entries in, columns and rows out. The CSV writing is csv.mjs, which
 * already guards against formulas and writes the byte-order mark Excel needs.
 *
 * Age is the age ON THE DAY OF THE EVENT, because that is what a division is
 * decided on, not the age today.
 */
import { ageOn } from './people.mjs';

export const ENTRY_COLUMNS = Object.freeze([
  { key: 'last', label: 'Last name' },
  { key: 'first', label: 'First name' },
  { key: 'number', label: 'Member number' },
  { key: 'gender', label: 'Gender' },
  { key: 'dob', label: 'Date of birth' },
  { key: 'age', label: 'Age on the day' },
  { key: 'weight', label: 'Weight (kg)' },
  { key: 'height', label: 'Height (cm)' },
  { key: 'grade', label: 'Grade' },
  { key: 'experience', label: 'Years training' },
  { key: 'prior', label: 'Previous tournaments' },
  { key: 'club', label: 'Club' },
  { key: 'disciplines', label: 'Disciplines' },
  { key: 'divisions', label: 'Divisions' },
  { key: 'status', label: 'Status' },
  { key: 'paid', label: 'Paid' },
  { key: 'consent', label: 'Declaration signed' },
  { key: 'guardian', label: 'Parent or guardian' },
  { key: 'guardianContact', label: 'Guardian contact' },
  { key: 'type', label: 'Member or guest' },
  { key: 'entered', label: 'Entered on' },
  { key: 'notes', label: 'Notes' },
]);

const text = (v) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());
const day = (v) => (v == null ? '' : (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)));

/** The one row for one entry. `eventDay` is YYYY-MM-DD in the event's own timezone. */
export function entryRow(e, eventDay) {
  const guest = e.guest ?? {};
  const isGuest = !e.person_id && !e.first_name && !e.last_name;
  const guestName = text(guest.name ?? '');
  const [gFirst, ...gRest] = guestName.split(' ');
  const dob = day(e.date_of_birth ?? guest.dateOfBirth ?? guest.date_of_birth);
  const age = ageOn(dob, eventDay);
  const guardian = e.consent_guardian ?? {};
  const sel = e.selections ?? [];
  const unique = (xs) => [...new Set(xs.filter(Boolean))].join('; ');

  return {
    last: text(e.last_name ?? gRest.join(' ')),
    first: text(e.first_name ?? gFirst),
    number: text(e.display_number),
    gender: text(e.person_gender ?? guest.gender),
    dob,
    age: age ?? '',
    weight: e.weight_kg ?? '',
    height: e.height_cm ?? '',
    grade: text(e.grade ?? e.declared_grade ?? guest.grade),
    experience: e.years_training ?? '',
    prior: e.prior_events ?? '',
    club: text(e.entered_for ?? e.club_name ?? guest.club),
    disciplines: unique(sel.map((s) => s.discipline)),
    divisions: unique(sel.map((s) => (s.division ? `${s.discipline}: ${s.division}` : `${s.discipline}: not placed`))),
    status: text(e.status),
    paid: e.paid || e.paid_at ? 'Yes' : 'No',
    consent: e.consents ? 'Yes' : 'No',
    guardian: text(guardian.name),
    guardianContact: text(guardian.contact),
    type: isGuest ? 'Guest' : 'Member',
    entered: day(e.created_at),
    notes: text(e.notes),
  };
}

/** Withdrawn entries are kept, marked; an organiser filters, not the system. */
export function entryRows(entries = [], eventDay) {
  return entries.map((e) => entryRow(e, eventDay))
    .sort((a, b) => (a.last + a.first).localeCompare(b.last + b.first));
}
