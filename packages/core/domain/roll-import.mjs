/**
 * DOMAIN — reading a club's existing roll
 *
 * A club that joins does not start empty. It arrives with a spreadsheet, and
 * until that spreadsheet is in the register the platform is useless to them —
 * nobody retypes eighty members to try something out.
 *
 * Pure. No database, no HTTP. It takes the text somebody pasted and says what
 * it found, what it would do, and what is wrong with it. Deciding is separate
 * from doing on purpose: nothing should be written until a person has looked
 * at what is about to happen and said yes.
 *
 * Every row carries EVERY problem with it, so one pass through the preview
 * tells somebody everything they need to fix in their spreadsheet.
 */

import { problemsWithPerson, problemsWithMembership, ROLES, isRealDate }
  from './people.mjs';
import { problemsWithRoleAndGrade } from './roles.mjs';

// ---------------------------------------------------------------------------
// what a column might be called
// ---------------------------------------------------------------------------

/**
 * Header synonyms, because nobody's spreadsheet uses our words.
 *
 * Matched after stripping everything but letters and lowercasing, so
 * "First Name", "first_name", "FirstName" and "first name " are one thing.
 * Order matters: the first field whose list contains the header wins, so
 * "emergencyphone" is checked before "phone" would ever see it.
 */
const COLUMNS = [
  ['emergencyName', ['emergencyname', 'emergencycontact', 'emergencycontactname',
                     'icename', 'nextofkin', 'emergency']],
  ['emergencyPhone', ['emergencyphone', 'emergencynumber', 'emergencycontactphone',
                      'emergencycontactnumber', 'icephone']],
  ['firstName', ['firstname', 'first', 'givenname', 'given', 'forename',
                 'christianname', 'fname']],
  ['lastName', ['lastname', 'last', 'surname', 'familyname', 'family', 'lname']],
  ['fullName', ['name', 'fullname', 'membername', 'studentname']],
  ['preferredName', ['preferredname', 'preferred', 'knownas', 'goesby',
                     'nickname', 'displayname']],
  ['dateOfBirth', ['dateofbirth', 'dob', 'birthdate', 'birthday', 'born']],
  ['gender', ['gender', 'sex']],
  ['email', ['email', 'emailaddress', 'mail', 'contactemail']],
  ['phone', ['phone', 'mobile', 'cell', 'telephone', 'phonenumber',
             'contactnumber', 'contactphone', 'tel']],
  ['role', ['role', 'type', 'membertype', 'membershiptype', 'category']],
  ['grade', ['grade', 'rank', 'belt', 'kyu', 'dan', 'currentgrade',
             'currentbelt', 'gradelevel']],
  ['gradedOn', ['gradedon', 'gradeddate', 'dategraded', 'lastgraded',
                'gradingdate', 'beltdate']],
  ['starts', ['starts', 'joined', 'joineddate', 'datejoined', 'startdate',
              'membersince', 'since', 'start']],
  ['paidUntil', ['paiduntil', 'paidto', 'expires', 'expiry', 'expirydate',
                 'renewaldate', 'duedate', 'validuntil', 'subsuntil']],
];

const normalise = (h) => String(h ?? '').toLowerCase().replace(/[^a-z]/g, '');

/** Which of our fields each column of their spreadsheet is, by its heading. */
export function mapHeaders(headers = []) {
  const mapping = [];
  const taken = new Set();

  for (const header of headers) {
    const key = normalise(header);
    const hit = COLUMNS.find(([field, names]) =>
      !taken.has(field) && names.includes(key));
    if (hit) { taken.add(hit[0]); mapping.push(hit[0]); }
    else mapping.push(null);              // a column we do not use
  }
  return mapping;
}

// ---------------------------------------------------------------------------
// reading the text
// ---------------------------------------------------------------------------

/**
 * Tab-separated or comma-separated, decided by counting.
 *
 * Copying a block of cells out of Excel, Numbers or Google Sheets puts tabs on
 * the clipboard, which is how most people will get their roll in here and is
 * far more reliable than a CSV export: no quoting, no escaping, no commas
 * inside addresses. A saved .csv pasted in still works, and quoted fields are
 * handled — a name like "Smith, Jr" would otherwise split into two columns.
 */
export function detectDelimiter(text) {
  const line = String(text).split(/\r?\n/).find((l) => l.trim()) ?? '';
  const tabs = (line.match(/\t/g) ?? []).length;
  const commas = (line.match(/,/g) ?? []).length;
  const semis = (line.match(/;/g) ?? []).length;
  if (tabs >= commas && tabs >= semis && tabs > 0) return '\t';
  // Continental exports use semicolons because the comma is a decimal point.
  if (semis > commas) return ';';
  return ',';
}

/** One line into fields, honouring "quoted, fields" and "" as an escaped quote. */
export function splitLine(line, delimiter) {
  const out = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') {
      quoted = true;
    } else if (c === delimiter) {
      out.push(field); field = '';
    } else field += c;
  }
  out.push(field);
  return out.map((f) => f.trim());
}

export function parseTable(text) {
  const delimiter = detectDelimiter(text);
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { delimiter, headers: [], rows: [] };

  const headers = splitLine(lines[0], delimiter);
  const rows = lines.slice(1).map((l) => splitLine(l, delimiter));
  return { delimiter, headers, rows };
}

// ---------------------------------------------------------------------------
// dates, as people actually write them
// ---------------------------------------------------------------------------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun',
                'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * A date out of a spreadsheet, or null with a reason.
 *
 * The dangerous case is 03/04/2015, which is the 3rd of April to a New
 * Zealander and the 4th of March to an American, and no amount of inspection
 * can tell them apart. Guessing silently is how a child ends up in the wrong
 * age division. So an ambiguous slash date is REFUSED and named, with the
 * unambiguous form to use. A day above twelve resolves itself and is accepted
 * day-first, which is what this part of the world writes.
 */
export function readDate(value, { dayFirst = true } = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) return { date: null };

  // Already the unambiguous form.
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const made = `${iso[1]}-${pad(iso[2])}-${pad(iso[3])}`;
    return isRealDate(made) ? { date: made }
                            : { date: null, problem: `there is no such date as ${raw}` };
  }

  // 5 March 2015, 5 Mar 15, March 5 2015
  const named = raw.match(/^(\d{1,2})[\s-]*([a-z]{3,})[\s-]*(\d{2,4})$/i)
             ?? raw.match(/^([a-z]{3,})[\s-]*(\d{1,2}),?[\s-]*(\d{2,4})$/i);
  if (named) {
    const monthFirst = /^[a-z]/i.test(named[1]);
    const day = +(monthFirst ? named[2] : named[1]);
    const month = MONTHS.indexOf((monthFirst ? named[1] : named[2])
      .slice(0, 3).toLowerCase()) + 1;
    if (month) {
      const made = `${fourDigit(named[3])}-${pad(month)}-${pad(day)}`;
      return isRealDate(made) ? { date: made }
                              : { date: null, problem: `there is no such date as ${raw}` };
    }
  }

  const slash = raw.match(/^(\d{1,2})[/.\\-](\d{1,2})[/.\\-](\d{2,4})$/);
  if (slash) {
    const [, a, b, y] = slash;
    const year = fourDigit(y);
    if (+a > 12 && +b <= 12) return finish(year, b, a, raw);       // must be d/m
    if (+b > 12 && +a <= 12) return finish(year, a, b, raw);       // must be m/d
    if (+a <= 12 && +b <= 12) {
      return { date: null, problem:
        `"${raw}" could be ${+a} ${monthName(+b)} or ${+b} ${monthName(+a)}. `
        + `Write it as ${year}-${pad(dayFirst ? b : a)}-${pad(dayFirst ? a : b)} `
        + 'so it cannot be read two ways.' };
    }
    return { date: null, problem: `"${raw}" is not a date` };
  }

  return { date: null, problem: `"${raw}" is not a date this can read` };
}

const pad = (n) => String(n).padStart(2, '0');
const monthName = (m) => ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'][m - 1] ?? '?';

/**
 * Two digits into four.
 *
 * 65 is 1965, not 2065 — a founding member's date of birth, not a date that
 * has not happened. The pivot is deliberately generous: nobody on a martial
 * arts roll was born after this year, and plenty were born in the forties.
 */
function fourDigit(y) {
  const n = +y;
  if (String(y).length === 4) return String(n);
  return String(n <= 30 ? 2000 + n : 1900 + n);
}

function finish(year, month, day, raw) {
  const made = `${year}-${pad(month)}-${pad(day)}`;
  return isRealDate(made) ? { date: made }
                          : { date: null, problem: `there is no such date as ${raw}` };
}

// ---------------------------------------------------------------------------
// what we would do with each row
// ---------------------------------------------------------------------------

/**
 * Turn the parsed table into a decision per row.
 *
 * `existing` is what is already on the roll: [{ id, firstName, lastName,
 * email, dateOfBirth }]. `grades` is the federation's ladder: [{ id, label,
 * shortLabel, rankOrder }].
 *
 * Each result is { line, values, action, problems, notes, matchedId }.
 *   action 'add'       a new person, will be created
 *          'duplicate' already on this roll, will be skipped
 *          'refuse'    something is wrong; nothing will be written
 */
export function planImport({ headers, rows }, {
  existing = [], grades = [], today = null, defaultRole = 'member',
} = {}) {
  const mapping = mapHeaders(headers);
  const unmapped = headers.filter((h, i) => mapping[i] === null && h);
  const found = mapping.filter(Boolean);
  const plan = [];

  const byEmail = new Map(existing
    .filter((p) => p.email)
    .map((p) => [String(p.email).toLowerCase(), p]));
  const byName = new Map(existing.map((p) => [nameKey(p), p]));

  // Matched loosely: '1st kyu', '1 kyu', '1k', 'Shodan' should all find their
  // grade. A federation's own labels are the only list consulted — nothing
  // here knows what a kyu is.
  const gradeIndex = new Map();
  for (const g of grades) {
    for (const key of [g.label, g.shortLabel].filter(Boolean))
      gradeIndex.set(gradeKey(key), g);
  }

  // Within the pasted text itself, not just against the roll: the same person
  // twice in one spreadsheet is common and would otherwise be created twice.
  const seen = new Map();

  rows.forEach((cells, index) => {
    const line = index + 2;                         // 1 is the header row
    const values = {};
    mapping.forEach((field, i) => {
      if (field && cells[i] != null && cells[i] !== '') values[field] = cells[i];
    });

    if (!Object.keys(values).length) return;        // a blank line

    if (values.fullName && !values.firstName && !values.lastName) {
      const parts = values.fullName.split(/\s+/).filter(Boolean);
      values.firstName = parts.shift() ?? '';
      values.lastName = parts.join(' ');
    }
    delete values.fullName;

    const problems = [];
    const notes = [];

    for (const [field, label] of [['dateOfBirth', 'date of birth'],
                                  ['starts', 'joining date'],
                                  ['paidUntil', 'paid-until date'],
                                  ['gradedOn', 'grading date']]) {
      if (values[field] == null) continue;
      const { date, problem } = readDate(values[field]);
      if (problem) problems.push(`${label}: ${problem}`);
      values[field] = date;
    }

    if (values.role) {
      const role = String(values.role).toLowerCase().trim();
      const known = ROLES.find((r) => r === role)
        ?? (role.startsWith('instruct') ? 'instructor' : null)
        ?? (role.startsWith('assist') ? 'assistant' : null)
        ?? (/^(student|adult|junior|senior|child|kid)/.test(role) ? 'member' : null);
      if (known) {
        if (known !== role) notes.push(`"${values.role}" read as ${known}`);
        values.role = known;
      } else {
        notes.push(`"${values.role}" is not a role here — will be added as `
          + `${defaultRole}`);
        values.role = defaultRole;
      }
    } else values.role = defaultRole;

    if (values.grade) {
      const match = gradeIndex.get(gradeKey(values.grade));
      if (match) {
        values.gradeId = match.id;
        notes.push(`grade ${match.label} will be recorded as already held`);
      } else {
        // Not a problem — the person still imports. Losing eighty members
        // because one belt is spelled differently helps nobody.
        notes.push(`"${values.grade}" is not a grade in this federation's `
          + 'ladder, so no grade will be recorded');
        delete values.gradeId;
      }
    }

    problems.push(...problemsWithPerson(values, { today }));
    problems.push(...problemsWithMembership(values));
    {
      const g = values.gradeId ? [...gradeIndex.values()].find((x) => x.id === values.gradeId) : null;
      problems.push(...problemsWithRoleAndGrade({ role: values.role, grade: g, hasGrade: !!values.gradeId }));
    }

    const key = nameKey(values);
    const email = values.email ? String(values.email).toLowerCase() : null;
    const already = (email && byEmail.get(email)) || byName.get(key) || null;
    const twice = seen.get(email ?? key);

    let action = 'add';
    if (problems.length) action = 'refuse';
    else if (already) action = 'duplicate';
    else if (twice) { action = 'duplicate'; notes.push(`same as line ${twice}`); }

    if (action === 'add') seen.set(email ?? key, line);

    plan.push({ line, values, action, problems, notes,
                matchedId: already?.id ?? null });
  });

  return {
    plan,
    found,
    unmapped,
    missing: ['firstName', 'lastName'].filter((f) => !found.includes(f)
      && !found.includes('fullName')),
    counts: {
      add: plan.filter((r) => r.action === 'add').length,
      duplicate: plan.filter((r) => r.action === 'duplicate').length,
      refuse: plan.filter((r) => r.action === 'refuse').length,
    },
  };
}

const nameKey = (p) =>
  `${String(p.firstName ?? '').trim().toLowerCase()}|`
  + `${String(p.lastName ?? '').trim().toLowerCase()}|`
  + `${p.dateOfBirth ?? ''}`;

const gradeKey = (label) => String(label).toLowerCase()
  .replace(/(\d+)(st|nd|rd|th)\b/g, '$1')          // 1st kyu → 1 kyu
  .replace(/[^a-z0-9]/g, '');
