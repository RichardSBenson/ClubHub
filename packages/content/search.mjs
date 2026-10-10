/**
 * HONBU — WHAT SOMEBODY MEANT WHEN THEY TYPED THAT
 *
 * A club secretary looking for a person does not type a query language. They
 * type "aroha", or "MOK-0042", or "aroha@", or "4th kyu". What they typed says
 * what they are looking for, and reading it properly is the difference between
 * a search box and a text filter.
 *
 * Folding happens here as well as in SQL, so that what is highlighted and what
 * matched agree. A result that cannot be seen to match looks like a bug.
 */

/** The same mapping as db/020's fold(), and it must stay the same. */
const FROM = 'āēīōūãáàâäåéèêëíìîïóòôöõúùûüñçýÿšžœæ';
const TO   = 'aeiouaaaaaaeeeeiiiiooooouuuuncyyszoa';

const MAP = new Map([...FROM].map((c, i) => [c, TO[i]]));

/** Lowercased and stripped of diacritics, exactly as the database does it. */
export function fold(value = '') {
  return [...String(value).toLowerCase()]
    .map((c) => MAP.get(c) ?? c).join('');
}

/**
 * What kind of thing this looks like.
 *
 * Not a guess that changes the results — every kind is searched regardless.
 * It decides what is tried FIRST and what is shown at the top, because
 * somebody typing a member number wants that member, not everybody whose
 * notes happen to contain the digits.
 */
export function readQuery(raw = '') {
  const text = String(raw).trim();
  const folded = fold(text);

  if (!text) return { kind: 'empty', text: '', folded: '', terms: [] };

  if (text.length < 2)
    return { kind: 'too-short', text, folded, terms: [] };

  // An email, or the start of one. Administrators look people up this way
  // because it is what they have in front of them in a message.
  if (/@/.test(text))
    return { kind: 'email', text, folded, terms: [folded] };

  // A member number: letters, digits and dashes with at least one digit, and
  // no spaces. MOK-0042, 0042, mok0042.
  if (/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(text) && /\d/.test(text))
    return { kind: 'number', text, folded, terms: [folded] };

  // A grade, which people type as it is written on a certificate.
  if (/^\d+(st|nd|rd|th)\s+(kyu|dan)$/i.test(text) || /^(sho|ni|san|yon|go)dan$/i.test(text))
    return { kind: 'grade', text, folded, terms: [folded] };

  return {
    kind: 'name',
    text,
    folded,
    // Each word searched separately so "aroha ngata" finds her when the
    // surname is recorded with a macron and the first name is not.
    terms: folded.split(/\s+/).filter((t) => t.length >= 2),
  };
}

/**
 * Where to send somebody who picks this result.
 *
 * Here rather than in the view because the audit screen, the roll and the
 * search box should all agree about where a person lives.
 */
export function linkTo(result) {
  switch (result.kind) {
    case 'person':       return `/p/${result.id}`;
    case 'organisation': return `/o/${result.slug}/roll`;
    case 'event':        return `/o/${result.orgSlug}/events/${result.slug}`;
    case 'page':         return `/o/${result.orgSlug}/pages/${result.id}`;
    case 'article':      return `/o/${result.orgSlug}/news/${result.id}`;
    case 'image':        return `/o/${result.orgSlug}/media`;
    default:             return '/dashboard';
  }
}

/** What a result is, in the federation's own words where it has any. */
export function labelFor(kind, vocabulary = {}) {
  switch (kind) {
    case 'person':       return 'Person';
    case 'organisation': return vocabulary.club ?? 'Club';
    case 'event':        return 'Event';
    case 'page':         return 'Page';
    case 'article':      return 'News';
    case 'image':        return 'Image';
    default:             return 'Result';
  }
}

/**
 * The matched part of a string, for showing somebody why this came back.
 *
 * Returns the pieces rather than HTML: the view escapes them. Building markup
 * here would mean an unescaped name from the register reaching a page, and a
 * search box is exactly where somebody's surname with an angle bracket in it
 * would arrive.
 */
export function highlight(value = '', folded = '') {
  const text = String(value);
  if (!folded) return [{ text, match: false }];

  const haystack = fold(text);
  const at = haystack.indexOf(folded);
  if (at < 0) return [{ text, match: false }];

  // Folding is character-for-character, so offsets in the folded string are
  // offsets in the original. That is why fold() maps one character to one
  // character and never expands — ß to ss would break this quietly.
  return [
    { text: text.slice(0, at), match: false },
    { text: text.slice(at, at + folded.length), match: true },
    { text: text.slice(at + folded.length), match: false },
  ].filter((p) => p.text.length);
}
