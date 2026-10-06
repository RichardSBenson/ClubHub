/**
 * HONBU — ADDING A CLUB
 *
 * A federation adds a club: a name, a place, and — usually — the person who
 * will run it, so the club is not an empty box nobody can open.
 *
 * Pure: no database, no request.
 */
import { slugFrom } from './founding.mjs';

/**
 * Addresses a club's slug would collide with. A club's page lives at
 * /<slug> on the federation's website, next to the federation's own pages,
 * and the admin lives at /o/<slug>; a club called "Events" must not be able
 * to take the events page.
 */
export const RESERVED_SLUGS = Object.freeze([
  'events', 'news', 'instructors', 'find-a-dojo', 'about', 'contact', 'vendor',
  'theme', 'admin', 'api', 'o', 'p', 'a', 'signin', 'signout', 'search',
  'dashboard', 'me', 'unsubscribe', 'bootstrap', 'try', 'enter', 'enquire', 'cron', 'sitemap', 'robots', 'assets', 'static',
]);

const EMAIL = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

export const clubSlugFrom = (name) => slugFrom(name).replace(/^federation$/, '');

/** What was typed, as the shape the database takes. Never throws. */
export function readNewClub(form = {}) {
  const t = (k, n) => String(form[k] ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  return {
    name: t('name', 80),
    slug: t('slug', 40).toLowerCase() || null,
    city: t('city', 80),
    adminFirst: t('adminFirst', 60),
    adminLast: t('adminLast', 60),
    adminEmail: t('adminEmail', 160).toLowerCase(),
  };
}

/** What is wrong with it, as sentences. */
export function problemsWithNewClub(c) {
  const out = [];
  if (c.name.length < 2) out.push('The club needs a name.');
  const slug = c.slug ?? clubSlugFrom(c.name);
  if (c.name.length >= 2 && !slug)
    out.push('That name has no letters or numbers to make a web address from.');
  if (c.slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.slug))
    out.push('The web address can only use lower-case letters, numbers and single hyphens.');
  if (slug && RESERVED_SLUGS.includes(slug))
    out.push(`"${slug}" is used by the website itself. Choose another web address.`);

  const anyAdmin = c.adminFirst || c.adminLast || c.adminEmail;
  if (anyAdmin) {
    if (!c.adminFirst || !c.adminLast)
      out.push('Give the club\'s administrator a first and last name, or leave '
        + 'all three administrator fields blank.');
    if (!EMAIL.test(c.adminEmail))
      out.push('The administrator\'s email address does not look right.');
  }
  return out;
}

export const hasAdministrator = (c) => !!(c.adminFirst && c.adminLast && c.adminEmail);
