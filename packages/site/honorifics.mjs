/**
 * HONBU — how an instructor is named on the public site
 *
 *   Sensei Richard Benson
 *   3rd dan 三段
 *
 * The title (Sensei, Shihan, Hanshi...) comes first when the person holds one; the dan grade follows with its Japanese
 * written the way a dojo writes it. The kanji is worked out from the dan number, so it needs no extra data.
 * A kyu grade has no kanji here and is shown as it is.
 */

const KANJI = ['', '初段', '二段', '三段', '四段', '五段', '六段', '七段', '八段', '九段', '十段'];

/** 3 from "3rd dan"; null for anything that is not a dan grade of 1 to 10. */
export function danNumber(label) {
  const m = /^\s*(\d{1,2})(?:st|nd|rd|th)\s+dan\s*$/i.exec(String(label ?? ''));
  const n = m ? +m[1] : 0;
  return n >= 1 && n <= 10 ? n : null;
}

/** "三段" for "3rd dan"; null when there is none to give. */
export const japaneseGrade = (label) => KANJI[danNumber(label) ?? 0] || null;

/** "Sensei Richard Benson", or just "Richard Benson" for a person who holds no title. */
export function titledName(i) {
  const name = [i.firstName, i.lastName].filter(Boolean).join(' ') || (i.name ?? i.displayName ?? '');
  return [i.title, name].filter(Boolean).join(' ');
}

/** The grade line as markup: "3rd dan <span lang="ja">三段</span>". `esc` is the caller's escaper. */
export function gradeMarkup(grade, esc) {
  if (!grade) return '';
  const ja = japaneseGrade(grade);
  return ja ? `${esc(grade)} <span lang="ja">${esc(ja)}</span>` : esc(grade);
}
