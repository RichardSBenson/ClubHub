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


import { region } from '../infrastructure/region-context.mjs';

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

    case 'guardian_link':
      return `made ${a.guardian ?? 'somebody'} a ${(a.relationship ?? 'parent').replace('_', '-')} of ${a.child ?? 'a child'}`;
    case 'guardian_unlink':
      return `ended ${a.guardian ?? 'a guardian'}'s link to ${a.child ?? 'a child'}`;
    case 'self_update':
      return `${a.by === 'guardian' ? 'a guardian' : 'the member'} updated ${
        (a.fields ?? []).map((f) => f.replace(/_/g, ' ')).join(', ')}`;

    case 'club_profile_saved': {
      const was = b ?? {};
      const bits = [];
      if (was.name && a.name && was.name !== a.name) bits.push(`renamed it from ${quote(was.name)} to ${quote(a.name)}`);
      if (was.status && a.status && was.status !== a.status)
        bits.push(a.status === 'dormant' ? 'put the club on a break' : 'marked the club as running again');
      return bits.length ? bits.join(' and ') : `updated the club's details`;
    }

    case 'message_sent': {
      const who = { members: 'the members', instructors: 'the instructors', selected: 'people picked from the renewals list',
                    event: 'people entered in an event', person: 'one person' }[a.audience] ?? 'people';
      return `wrote ${a.subject ? quote(a.subject) : 'a message'} to ${who} (${a.recipients ?? 0} `
        + `address${a.recipients === 1 ? '' : 'es'}${a.skipped ? `, ${a.skipped} skipped` : ''})`;
    }
    case 'payment_requested':
      return `asked ${a.person ?? 'a member'} for ${(a.amountCents / 100).toLocaleString(region().locale, { style: 'currency', currency: region().currency })}`
        + ` — ${a.description ?? 'a payment'}`;
    case 'payment_made':
      return `took a payment of ${((a.amountCents ?? 0) / 100).toLocaleString(region().locale, { style: 'currency', currency: region().currency })}`;
    case 'payment_failed':
      return 'a payment did not go through';
    case 'payment_recorded':
      return `recorded ${((a.amountCents ?? 0) / 100).toLocaleString(region().locale, { style: 'currency', currency: region().currency })} received by ${
        a.method === 'cash' ? 'cash' : 'bank transfer'}${a.receipt ? ` (receipt ${a.receipt})` : ''}`
        + (a.paidUntil ? `, fees now paid to ${a.paidUntil}` : '');
    case 'fee_set':
      return `set the price ${a.label ? quote(a.label) : ''} at ${((a.amountCents ?? 0) / 100).toLocaleString(region().locale, { style: 'currency', currency: region().currency })}`.trim();
    case 'fee_removed':
      return `removed the price ${a.label ? quote(a.label) : ''}`.trim();
    case 'fee_exemption':
      return a.exempt ? `stopped charging ${a.person ?? 'a member'} fees (${a.reason ?? 'no reason given'})`
                      : `started charging ${a.person ?? 'a member'} fees again`;
    case 'membership_carried_on':
      return `carried a membership on to ${a.paidUntil ?? 'a later date'} with no payment`;
    case 'reminders_setting':
      return a.enabled ? 'switched automatic fees reminders on' : 'switched automatic fees reminders off';
    case 'newcomer_added':
      return `added a newcomer${a.child ? ` (under ${region().adultAge})` : ''}; waiver accepted by ${a.consent_by ?? 'someone'}`;
    case 'newcomer_joined':
      return `made a newcomer a member${a.person ? ` (${a.person})` : ''}`;
    case 'newcomer_left':
      return 'removed a newcomer who is not continuing';
    case 'report_exported':
      return `downloaded the ${a.report ?? ''} report (${a.rows ?? 0} rows)`;
    case 'grading_fee_set':
      return `set the grading fee to $${((a.fee_cents ?? 0) / 100).toFixed(2)}`;
    case 'grading_entered':
      return `entered somebody for ${a.grade ? quote(a.grade) : 'a grade'} at ${a.event ? quote(a.event) : 'a grading'}`;
    case 'grading_finalised':
      return `finalised the grading ${a.title ? quote(a.title) : ''}: ${a.passed ?? 0} of ${a.entered ?? 0} awarded`.replace('  ', ' ');
    case 'entrant_registered':
      return 'registered as a new competitor';
    case 'publish_scheduled':
      return `scheduled ${a.title ? quote(a.title) : 'something'} to go live on ${a.date ?? '?'}`;
    case 'publish_unscheduled':
      return `cancelled the schedule for ${a.title ? quote(a.title) : 'something'}`;
    case 'published_on_schedule':
      return `${a.title ? quote(a.title) : 'Something'} went live on its scheduled date`;
    case 'enquiry_deleted':
      return 'deleted a website enquiry';
    case 'qualification_defined':
      return `started tracking ${a.label ? quote(a.label) : 'a qualification'}`;
    case 'qualification_removed':
      return `stopped tracking ${a.label ? quote(a.label) : 'a qualification'}`;
    case 'qualification_recorded':
      return `recorded ${a.qualification ? quote(a.qualification) : 'a qualification'} (issued ${a.awarded_on ?? '?'}, until ${a.expires_on ?? 'n/a'})`;
    case 'qualification_deleted':
      return `deleted a record of ${a.qualification ? quote(a.qualification) : 'a qualification'}`;
    case 'qualification_reminders_setting':
      return a.enabled ? 'switched qualification reminders on' : 'switched qualification reminders off';
    case 'roll_taken':
      return `took the roll for ${a.label ? quote(a.label) : 'a class'} on ${a.date ?? 'a day'}: ${a.came ?? 0} came`
        + (b?.came != null && b.came !== a.came ? ` (was ${b.came})` : '');
    case 'email_preference':
      return a.optedOut ? 'a member stopped getting announcement emails'
                        : 'a member started getting announcement emails again';

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
  ['guardian_link', 'Guardian linked'],
  ['guardian_unlink', 'Guardian link ended'],
  ['self_update', 'Member updated their own details'],
  ['club_profile_saved', 'Club details changed'],
  ['message_sent', 'Message sent'],
  ['roll_taken', 'Roll taken'],
  ['entrant_registered', 'Competitor registered'],
  ['publish_scheduled', 'Publishing scheduled'],
  ['publish_unscheduled', 'Schedule cancelled'],
  ['published_on_schedule', 'Published on schedule'],
  ['enquiry_deleted', 'Enquiry deleted'],
  ['qualification_defined', 'Qualification tracked'],
  ['qualification_removed', 'Qualification untracked'],
  ['qualification_recorded', 'Qualification recorded'],
  ['qualification_deleted', 'Qualification record deleted'],
  ['qualification_reminders_setting', 'Qualification reminders changed'],
  ['grading_fee_set', 'Grading fee set'],
  ['grading_entered', 'Entered for grading'],
  ['grading_finalised', 'Grading finalised'],
  ['report_exported', 'Report downloaded'],
  ['newcomer_added', 'Newcomer added'],
  ['newcomer_joined', 'Newcomer became a member'],
  ['newcomer_left', 'Newcomer removed'],
  ['reminders_setting', 'Automatic reminders changed'],
  ['payment_requested', 'Payment asked for'],
  ['payment_made', 'Payment made'],
  ['payment_failed', 'Payment failed'],
  ['payment_recorded', 'Cash or transfer recorded'],
  ['fee_set', 'Price set'],
  ['fee_removed', 'Price removed'],
  ['fee_exemption', 'Fees waived or restored'],
  ['membership_carried_on', 'Membership carried on'],
  ['email_preference', 'Email preference changed'],
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
