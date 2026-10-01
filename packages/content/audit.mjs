/**
 * HONBU — THE AUDIT LOG, IN WORDS
 *
 * Thirteen places in this codebase write to audit_log and, until now, nothing
 * read it. A log nobody can read is not auditability; it is disk use with a
 * good conscience. "Strong auditability and permissions" is on the build
 * list's own page of differentiators, and federations argue about records —
 * who graded whom, who took a page down, who put a child's photograph on a
 * website. The answer has been in the database all along with no way to ask.
 *
 * This file turns a row into a sentence. It is deliberately separate from the
 * query: the query decides who may see what, this decides what it says, and
 * the two are easier to get right apart than together.
 *
 * Two rules it follows.
 *
 * Name the person, not the account. "Doug Holloway" means something to a
 * committee; a uuid does not, and an email address is a detail about an
 * account rather than a name for a human being.
 *
 * Say what changed, not that something changed. "Changed Aroha Ngata's date of
 * birth" is an audit entry. "Updated person" is a row in a table.
 */

const quote = (s) => `"${s}"`;

/** Whatever this entry was about, named as a person would name it. */
function subject(entry) {
  const a = entry.after ?? {};
  const b = entry.before ?? {};
  return a.title ?? b.title
    ?? a.name ?? b.name
    ?? a.filename ?? b.filename
    ?? a.slug ?? b.slug
    ?? entry.subjectName
    ?? null;
}

/** The fields that differ between before and after, as names a person reads. */
export function fieldsChanged(before, after) {
  if (!before || !after) return [];
  const names = {
    first_name: 'first name', last_name: 'last name',
    date_of_birth: 'date of birth', gender: 'gender',
    display_number: 'member number', email: 'email address',
    phone: 'phone number', publish_up_state: 'federation listing',
    published: 'whether they appear on the website',
  };
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed = [];
  for (const key of keys) {
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
    changed.push(names[key] ?? key.replace(/_/g, ' '));
  }
  return changed;
}

/**
 * What happened, as one sentence, without the actor's name on the front.
 *
 * The screen puts the name there, because every line in a list starting with
 * the same name reads badly and the list is usually filtered by person anyway.
 */
export function describe(entry) {
  const name = subject(entry);
  const a = entry.after ?? {};
  const b = entry.before ?? {};

  switch (entry.action) {
    case 'enrol':
      return `added ${name ?? 'somebody'} to the roll`;

    case 'update': {
      const changed = fieldsChanged(b, a);
      if (!changed.length) return `saved ${name ?? 'a record'} without changing it`;
      return `changed ${name ? `${name}'s ` : ''}${changed.join(', ')}`;
    }

    case 'import':
      return a.added != null
        ? `imported a roll — ${a.added} added, ${a.updated ?? 0} updated`
        : 'imported a roll';

    case 'grant_access':
      return `gave ${name ?? 'somebody'} a way to sign in`
        + (a.role ? ` as ${a.role}` : '');

    case 'enter':
      return `entered ${name ?? 'a competitor'} in an event`;

    case 'asset_upload':
      return `uploaded ${name ? quote(name) : 'an image'}`
        + (a.width ? ` (${a.width}×${a.height})` : '');

    case 'asset_delete':
      return `deleted the image ${name ? quote(name) : ''}`.trim();

    case 'article_create':
      return `wrote ${name ? quote(name) : 'an article'}`;

    case 'article_update':
      return `edited ${name ? quote(name) : 'an article'}`;

    case 'article_publish_up': {
      const to = a.publish_up_state;
      const subject_ = name ? quote(name) : 'an article';
      if (to === 'approved') return `approved ${subject_} for this site`;
      if (to === 'declined') return `declined ${subject_}`;
      return `changed where ${subject_} appears`;
    }

    case 'instructor_publish':
      return `put an instructor on the public website`;

    case 'instructor_save':
      return `changed an instructor's profile`;

    case 'instructor_remove':
      return b.was === true || a.was === true
        ? 'took an instructor off the public website'
        : 'removed an instructor profile that was not published';

    case 'navigation_save':
      return `changed the site menu to ${(a.items ?? []).length} item`
        + ((a.items ?? []).length === 1 ? '' : 's');

    case 'club_profile_saved': {
      const was = b ?? {};
      const bits = [];
      if (was.name && a.name && was.name !== a.name) bits.push(`renamed it from ${quote(was.name)} to ${quote(a.name)}`);
      if (was.status && a.status && was.status !== a.status)
        bits.push(a.status === 'dormant' ? 'put the club on a break' : 'marked the club as running again');
      return bits.length ? bits.join(' and ') : `updated the club's details`;
    }

    case 'club_added':
      return `added the club ${a.name ? quote(a.name) : ''}`.trim();

    case 'event_publish_up_asked':
      return `asked for ${a.title ? quote(a.title) : 'an event'} to go on the federation's calendar`;
    case 'event_publish_up':
      return a.publish_up_state === 'approved'
        ? `approved ${a.title ? quote(a.title) : 'an event'} for this calendar`
        : `declined ${a.title ? quote(a.title) : 'an event'}`;

    case 'theme_apply':
      return `changed the website's look to ${a.name ? quote(a.name) : 'a new theme'}`;
    case 'theme_reset':
      return `returned the website to its default look`;

    case 'club_page_saved':
      return `edited the page for ${a.club ? quote(a.club) : 'a club'}`;
    case 'club_page_requested':
      return `asked for ${a.club ? quote(a.club) : 'a club'}'s page to go on the federation's site`;
    case 'club_page_approved':
      return `put ${a.club ? quote(a.club) : 'a club'}'s page on the website`;
    case 'club_page_declined':
      return `declined ${a.club ? quote(a.club) : 'a club'}'s page`;
    case 'club_page_taken_down':
      return `took ${a.club ? quote(a.club) : 'a club'}'s page off the website`;

    default:
      // An action nobody wrote a sentence for still has to read as something.
      // Better a plain description than a blank line, and better a blank line
      // than a crash in the one screen somebody opens during an argument.
      return `${String(entry.action ?? 'did something').replace(/_/g, ' ')}`
        + (name ? ` — ${name}` : '');
  }
}

/**
 * How serious this is, for somebody scanning a long list.
 *
 * Not a severity ranking. It marks the entries a federation would want to find
 * quickly: things that changed who can get in, or what the public can see.
 */
export function weight(entry) {
  switch (entry.action) {
    case 'grant_access':
    case 'instructor_publish':
    case 'article_publish_up':
    case 'club_page_approved':
      return 'notable';
    case 'asset_delete':
    case 'instructor_remove':
    case 'club_page_taken_down':
      return 'removal';
    default:
      return 'ordinary';
  }
}

/** Every action with a sentence written for it, for a filter dropdown. */
export const ACTIONS = Object.freeze([
  ['enrol', 'Added to the roll'],
  ['update', 'Record changed'],
  ['import', 'Roll imported'],
  ['grant_access', 'Sign-in granted'],
  ['enter', 'Event entry'],
  ['asset_upload', 'Image uploaded'],
  ['asset_delete', 'Image deleted'],
  ['article_create', 'Article written'],
  ['article_update', 'Article edited'],
  ['article_publish_up', 'Federation listing decided'],
  ['instructor_publish', 'Instructor published'],
  ['instructor_save', 'Instructor profile changed'],
  ['instructor_remove', 'Instructor removed from site'],
  ['navigation_save', 'Menu changed'],
  ['club_added', 'Club added'],
  ['club_profile_saved', 'Club details changed'],
  ['event_publish_up_asked', 'Event listing requested'],
  ['event_publish_up', 'Event listing decided'],
  ['theme_apply', 'Website look changed'],
  ['theme_reset', 'Website look reset'],
  ['club_page_saved', 'Club page edited'],
  ['club_page_requested', 'Club page requested'],
  ['club_page_approved', 'Club page approved'],
  ['club_page_declined', 'Club page declined'],
  ['club_page_taken_down', 'Club page taken down'],
]);
