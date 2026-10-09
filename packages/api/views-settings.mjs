/**
 * Screens for an organisation's own settings: country, grading timetable, kinds of event.
 * Re-exported by views.mjs, so callers still say V.regionSettings and so on.
 */
import { page } from './views.mjs';
import { esc } from '../core/domain/html.mjs';

/** Currency, language and the age of adulthood: set once for a federation, inherited by its clubs. */
export const regionSettings = ({ me, csrf, org, own, inherited, values = null, done, error }) => {
  const v = values ?? own ?? inherited;
  return page({ title: `Country settings — ${org.name}`, me, csrf, body: `
  <h1>Country settings</h1>
  <p class="sub">${esc(org.name)} · what money, dates and "under age" mean here.
    ${org.type === 'club' ? 'A club normally uses its federation\'s settings; set these only if this club differs.'
      : 'Every club beneath this organisation uses these unless it sets its own.'}</p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  <form method="post" class="card">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <div class="row">
      <div><label for="currency">Currency</label>
        <input id="currency" name="currency" maxlength="3" size="4" required value="${esc(v.currency)}">
        <span class="hint">A three-letter code: NZD, AUD, USD, GBP, EUR, CAD…</span></div>
      <div><label for="locale">Language and date style</label>
        <input id="locale" name="locale" maxlength="20" size="8" required value="${esc(v.locale)}">
        <span class="hint">en-NZ, en-AU, en-US, en-GB, fr-CA, ja…</span></div>
      <div><label for="adultAge">Age of adulthood</label>
        <input id="adultAge" name="adultAge" type="number" min="16" max="21" required value="${esc(v.adultAge)}">
        <span class="hint">Under this age a parent or guardian signs for a person, and photographs need their consent.</span></div>
    </div>
    <h2>Sales tax</h2>
    <p class="hint">Prices are the amount a member pays, tax included. Leave the rate at 0 if you charge no tax. Receipts and the payments report then show the tax inside each amount.</p>
    <div class="row">
      <div><label for="taxName">Name of the tax</label>
        <input id="taxName" name="taxName" maxlength="20" size="8" value="${esc(v.taxName ?? '')}">
        <span class="hint">GST, VAT, sales tax…</span></div>
      <div><label for="taxPercent">Rate (%)</label>
        <input id="taxPercent" name="taxPercent" type="number" step="0.01" min="0" max="30" size="6" value="${esc(v.taxPercent ?? 0)}"></div>
      <div><label for="taxNumber">Your tax number</label>
        <input id="taxNumber" name="taxNumber" maxlength="30" size="14" value="${esc(v.taxNumber ?? '')}">
        <span class="hint">Shown on receipts. Optional.</span></div>
    </div>
    <p><button class="btn" type="submit">Save</button></p>
  </form>` });
};

/** How long people usually stay at each grade. A guide shown on profiles and the roll; it never stops anyone grading. */
export const gradingTimetable = ({ me, csrf, org, owner, ladder, done, error }) => page({ title: `Grading timetable — ${org.name}`, me, csrf, body: `
  <h1>Grading timetable</h1>
  <p class="sub">${esc(owner.name)} · how long people usually stay at each grade before the next. It is a guide shown on
    profiles and the roll ("due from…"); it never stops anyone grading. Leave months blank where there is no set timetable.</p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  <form method="post" class="card">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <table><thead><tr><th>Grade</th><th>Usual months before the next</th><th>Next is by invitation</th></tr></thead><tbody>
    ${[...ladder].sort((a, b) => a.rank_order - b.rank_order).map((g) => `<tr><td>${esc(g.label)}</td>
      <td><input name="months_${esc(g.id)}" type="number" min="1" max="240" size="4" value="${esc(g.usual_months_to_next ?? '')}" aria-label="Months after ${esc(g.label)}"></td>
      <td><input type="checkbox" name="invite_${esc(g.id)}"${g.next_by_invitation ? ' checked' : ''} aria-label="By invitation after ${esc(g.label)}"></td></tr>`).join('')}
    </tbody></table>
    <p><button class="btn" type="submit">Save</button></p>
  </form>` });

/** The kinds of event a federation runs. The website announces an event with a banner made from its kind and date. */
export const eventTypesEditor = ({ me, csrf, org, types, own, done, error }) => {
  const rows = [...types, ...Array.from({ length: 3 }, () => ({ key: '', label: '', kind: '', top: '', main: '' }))];
  const kinds = [['grading', 'Grading'], ['tournament', 'Tournament'], ['camp', 'Camp'], ['seminar', 'Seminar'], ['fight_night', 'Fight night'],
    ['training', 'Training'], ['social', 'Social'], ['other', 'Other']];
  return page({ title: `Kinds of event — ${org.name}`, me, csrf, body: `
  <h1>Kinds of event</h1>
  <p class="sub">${esc(org.name)} · what people can choose when they add an event. Each one is announced on the website with a banner:
    an optional line above (a region, say), the main word, and the date. ${own ? '' : 'You are using the standard list until you save your own.'}</p>
  ${done ? `<div class="good">${esc(done)}</div>` : ''}
  ${error ? `<div class="bad">${esc(error)}</div>` : ''}
  <form method="post" class="card">
    <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
    <table><thead><tr><th>Code</th><th>Name</th><th>Sort of event</th><th>Line above</th><th>Main word</th><th>Remove</th></tr></thead><tbody>
    ${rows.map((t, i) => `<tr>
      <td><input name="key_${i}" size="12" maxlength="40" value="${esc(t.key)}" aria-label="Code"></td>
      <td><input name="label_${i}" size="22" maxlength="80" value="${esc(t.label)}" aria-label="Name"></td>
      <td><select name="kind_${i}" aria-label="Sort of event"><option value=""></option>${kinds.map(([k, l]) => `<option value="${k}"${t.kind === k ? ' selected' : ''}>${l}</option>`).join('')}</select></td>
      <td><input name="top_${i}" size="14" maxlength="80" value="${esc(t.top ?? '')}" aria-label="Line above"></td>
      <td><input name="main_${i}" size="14" maxlength="80" value="${esc(t.main)}" aria-label="Main word"></td>
      <td>${t.key ? `<input type="checkbox" name="remove_${i}" aria-label="Remove ${esc(t.label)}">` : ''}</td></tr>`).join('')}
    </tbody></table>
    <p class="hint">The code never changes once events use it. Removing a kind does not touch events already added; they just lose their banner wording.</p>
    <p><button class="btn" type="submit">Save</button></p>
  </form>` });
};
