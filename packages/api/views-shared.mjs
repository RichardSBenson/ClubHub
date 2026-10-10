/**
 * Words, labels and small helpers that more than one screen module uses. A leaf: it imports no screens, so every screen module can load it first.
 */
import { words, region } from '../infrastructure/region-context.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { esc } from '../core/domain/html.mjs';
import { DEFAULT_TIMEZONE } from '../core/domain/defaults.mjs';
import { money as cents } from '../core/domain/money.mjs';
import { taxLine } from '../core/domain/tax.mjs';

export const clubWord = () => words().club.toLowerCase();

/**
 * What this federation calls things. Read from the same settings file the
 * public site uses, so the admin and the website never disagree about whether
 * a place is a Club, a Dojang, an Academy or a Gym.
 *
 * Read once, and neutral if the file is missing or unreadable — the admin
 * failing to load because somebody mistyped a label would be a poor trade.
 */
export const NEUTRAL = Object.freeze({ club: 'Club', clubPlural: 'Clubs',
                                grading: 'Grading', grade: 'Grade' });

export const VOCABULARY = (() => {
  const fallback = NEUTRAL;
  try {
    const dir = process.env.HONBU_DATA
      ?? new URL('../../data/', import.meta.url).pathname;
    const raw = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8');
    const custom = JSON.parse(raw).vocabulary ?? {};
    const clean = Object.fromEntries(
      Object.entries(custom).filter(([k, v]) =>
        !k.startsWith('_') && typeof v === 'string' && v.trim()));
    return { ...fallback, ...clean };
  } catch {
    return fallback;
  }
})();

export const ClubWord = () => words().club;

export const FAMILY_LABELS = { parent: 'Parent', step_parent: 'Step-parent',
  guardian: 'Legal guardian', grandparent: 'Grandparent', aunt_uncle: 'Aunt or uncle', other_family: 'Other family', carer: 'Carer' };

export const option = (value, label, selected) =>
  `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`;

export const when = (instant, zone) => new Intl.DateTimeFormat(region().locale, {
  timeZone: zone || DEFAULT_TIMEZONE, weekday: 'short', day: 'numeric', month: 'short',
  year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(instant));

/** M or F only. Older records that say "male" or "Female" show as M and F. */
export const genderOptions = (current, blank) => {
  const c = ['m', 'male'].includes(String(current ?? '').trim().toLowerCase()) ? 'M'
    : ['f', 'female'].includes(String(current ?? '').trim().toLowerCase()) ? 'F' : '';
  return [['', blank], ['M', 'M'], ['F', 'F']].map(([v, l]) => `<option value="${v}"${c === v ? ' selected' : ''}>${l}</option>`).join('');
};

export const DOC_STATUS = { pending: ['wait', 'Waiting for your club'], accepted: ['ok', 'Accepted'], declined: ['no', 'Declined'] };

/**
 * One identity head for everybody: photograph (or initials), name, and chips for what they are.
 * The member's own card, the check an official sees, and the profile page all draw this, so a
 * person looks the same wherever they appear and the only difference between two people is the data.
 */
export const identityCss = `
.idhead{display:flex;gap:14px;align-items:center;text-align:left}
.idphoto{width:84px;height:104px;border-radius:8px;object-fit:cover;flex:none;background:#3a3a3d}
.idphoto.none{display:flex;align-items:center;justify-content:center;font-size:1.8rem;font-weight:700;color:#bbb}
.idwho h2,.idwho h1{margin:0 0 4px}
.idchips{display:flex;gap:6px;flex-wrap:wrap;margin:0}
.idchip{display:inline-block;font-size:.75rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:2px 8px;border-radius:999px;border:1px solid currentColor}
`;

export const taxNote = (amount, currency) => { const t = taxLine(amount, region(), (c) => cents(c, currency)); return t ? ` <span class="muted">${esc(t)}</span>` : ''; };

export const EVENT_KIND_WORDS = { grading: 'Grading', tournament: 'Tournament', camp: 'Training camp', seminar: 'Seminar', fight_night: 'Fight night', training: 'Training', social: 'Social', other: 'Event' };

export const QUAL_WORDS = { permanent: 'Does not expire', current: 'Current', expiring: 'Expiring soon', expired: 'Expired', missing: 'Not recorded' };

export const DAY_NAMES_ = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const cardCss = `<style>${identityCss}
.idcard{max-width:340px;margin:16px auto;padding:20px;border-radius:14px;background:#1c1c1e;color:#fff;text-align:center}
.idcard .org{font-size:.8rem;letter-spacing:.12em;text-transform:uppercase;color:#f0ce41}
.idcard h2{margin:.4em 0 .1em;color:#fff}
.idcard .qr{background:#fff;border-radius:8px;padding:4px;margin:14px auto 6px;max-width:260px}
.idcard .qr svg{display:block;width:100%;height:auto}
.idcard p{margin:.25em 0}.idcard .muted{color:#bbb}
.idcard dl{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;text-align:left;margin:12px 0}
.idcard dt{color:#f0ce41;font-size:.8rem;text-transform:uppercase}.idcard dd{margin:0}
.bigverdict{font-size:1.6rem;font-weight:700;margin:.2em 0}
</style>`;

export const formTok = (csrf) => `<input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">`;
