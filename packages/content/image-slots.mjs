/**
 * CONTENT — where a picture goes, and how big it should be
 *
 * The site never resizes anything (it stores the bytes it was given), so the
 * person uploading has to know what to give it. Each place a picture appears
 * is a slot with a size to aim for, a smallest size that still looks sharp,
 * and a note on what to keep out of the edges, because the browser crops to fit.
 *
 * `fitFor` says whether a particular upload suits a slot. It only ever warns;
 * a small picture is better than none, and a person on a phone cannot always
 * make a larger one.
 */

export const SLOTS = Object.freeze({
  hero: {
    label: 'Top-of-page picture',
    width: 2400, height: 1000, minWidth: 1600,
    ratio: '12:5 (wide)',
    safe: 'Keep faces and the main action in the middle 60%. On a phone the sides are cropped away.',
    where: 'Full width behind the heading on the home page and on each club page.',
  },
  card: {
    label: 'News and event picture',
    width: 1200, height: 675, minWidth: 800,
    ratio: '16:9',
    safe: 'Keep the subject in the centre; the edges are trimmed in lists.',
    where: 'Top of a news article, and beside it in lists.',
  },
  gallery: {
    label: 'Gallery picture',
    width: 1200, height: 800, minWidth: 800,
    ratio: '3:2',
    safe: 'Landscape works best. Portrait pictures are cropped to landscape.',
    where: 'The photo strip on a club page.',
  },
  portrait: {
    label: 'Instructor portrait',
    width: 600, height: 600, minWidth: 400,
    ratio: '1:1 (square)',
    safe: 'Head and shoulders, with the face in the upper half.',
    where: 'Instructors page.',
  },
  share: {
    label: 'Link preview picture',
    width: 1200, height: 630, minWidth: 1200,
    ratio: '1.91:1',
    safe: 'Keep text and faces away from the edges; chat apps crop them.',
    where: 'What shows when the page is shared on Facebook or in a message.',
  },
});

const kb = (n) => `${Math.round(n / 1024)} KB`;
const mb = (n) => `${Math.round(n / (1024 * 1024))} MB`;

/** One line to print beside the upload box. */
export function slotHint(name, maxBytes = null) {
  const s = SLOTS[name];
  if (!s) return '';
  return `Best at ${s.width} × ${s.height} pixels (${s.ratio}), at least ${s.minWidth} wide. ${s.safe}`
    + (maxBytes ? ` JPEG, PNG or WebP, up to ${mb(maxBytes)}.` : '');
}

/**
 * What is wrong with this picture for this slot, as plain sentences. An empty
 * list means it will look right. `identified` is what images.mjs returned.
 */
export function fitFor(name, identified) {
  const s = SLOTS[name];
  if (!s || !identified?.width || !identified?.height) return [];
  const out = [];
  const { width: w, height: h } = identified;
  if (w < s.minWidth)
    out.push(`This picture is ${w} pixels wide. It will look soft on a large screen; ${s.minWidth} or more is better.`);
  const want = s.width / s.height, have = w / h;
  if (have < want * 0.6 || have > want * 1.7)
    out.push(`It is shaped quite differently from the ${s.ratio} space it goes in, so a lot of it will be cropped. Check it in the preview.`);
  return out;
}

/** The table shown on the media screen, so people can prepare pictures before uploading. */
export function slotTable() {
  return Object.values(SLOTS).map((s) => ({
    label: s.label, size: `${s.width} × ${s.height}`, min: s.minWidth, ratio: s.ratio, where: s.where, safe: s.safe,
  }));
}

export { kb };
