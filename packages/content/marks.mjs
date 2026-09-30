/**
 * CONTENT — plain text in, rich runs out, and back again
 *
 * A block document stores rich text as runs with marks:
 *
 *   [{ text: 'Hanshi Doug', marks: ['strong'] },
 *    { text: ' opened the first dojo in ' },
 *    { text: 'Whanganui', marks: ['link'], href: '/whanganui' }]
 *
 * That is the right thing to store — it can be rendered to HTML, to a PDF
 * certificate or to plain text for an email, and nothing pasted in from Word
 * can inject markup. It is also the wrong thing to ask somebody to type.
 *
 * So the editor shows text with a very small, very familiar shorthand:
 *
 *   **bold**   *italic*   [words](https://example.nz)
 *
 * Three marks, because those are the three the block whitelist allows. Not a
 * markdown parser: no headings, no lists, no images, no tables, no HTML — a
 * block document has proper blocks for all of those and a shorthand that
 * quietly created them would be a second, worse way to build a page.
 *
 * It round-trips. Text typed in comes back out the same, which is what makes
 * it safe to edit a page over and over rather than only write it once.
 *
 * Pure. No DOM, no database, no HTML.
 */

const SAFE_PROTOCOL = /^(https?:|mailto:|tel:|\/)/i;

// ---------------------------------------------------------------------------
// text → runs
// ---------------------------------------------------------------------------

/**
 * `**bold**`, `*italic*`, `[words](url)`.
 *
 * Scanned left to right rather than replaced by regex, because regex
 * replacement on nested or unbalanced markers produces runs that do not match
 * what the author saw, and the author is a volunteer on a phone who will not
 * be told why their page looks wrong.
 *
 * An unmatched marker is left as literal text. Somebody typing "2 * 3 * 4" or
 * "see **" gets what they typed, not a silently italicised sentence.
 */
export function richFromText(text) {
  const source = String(text ?? '');
  if (!source.trim()) return [];

  const runs = [];
  let plain = '';
  let i = 0;

  const flush = () => { if (plain) { runs.push({ text: plain }); plain = ''; } };
  const push = (t, marks, href) => {
    if (!t) return;
    flush();
    const run = { text: t };
    if (marks?.length) run.marks = marks;
    if (href) run.href = href;
    runs.push(run);
  };

  while (i < source.length) {
    // A link: [words](target)
    if (source[i] === '[') {
      const close = source.indexOf('](', i);
      if (close !== -1) {
        const end = source.indexOf(')', close + 2);
        if (end !== -1) {
          const label = source.slice(i + 1, close);
          const href = source.slice(close + 2, end).trim();
          // A link nobody can safely follow is not a link. The label stays —
          // losing the author's words because the address was wrong would be
          // worse than losing the link.
          if (label && SAFE_PROTOCOL.test(href)) {
            push(label, ['link'], href);
            i = end + 1;
            continue;
          }
        }
      }
    }

    // Bold before italic: ** would otherwise match * twice.
    if (source.startsWith('**', i)) {
      const end = source.indexOf('**', i + 2);
      if (end !== -1 && end > i + 2) {
        push(source.slice(i + 2, end), ['strong']);
        i = end + 2;
        continue;
      }
    }

    if (source[i] === '*') {
      const end = source.indexOf('*', i + 1);
      // Not `**` immediately after, which is the start of a bold run.
      if (end !== -1 && end > i + 1 && !source.startsWith('**', i)) {
        push(source.slice(i + 1, end), ['em']);
        i = end + 1;
        continue;
      }
    }

    plain += source[i];
    i += 1;
  }

  flush();
  return runs;
}

// ---------------------------------------------------------------------------
// runs → text
// ---------------------------------------------------------------------------

/**
 * Back to the shorthand, so an author opening a page they wrote last year sees
 * what they typed rather than somebody's idea of it.
 *
 * Marks the shorthand cannot express are dropped to plain text rather than
 * invented syntax: a run is never rendered as something that would parse back
 * into a different document.
 */
export function textFromRich(rich) {
  if (typeof rich === 'string') return rich;
  if (!Array.isArray(rich)) return '';

  return rich.map((run) => {
    if (typeof run === 'string') return run;
    const text = String(run?.text ?? '');
    if (!text) return '';
    const marks = new Set(run.marks ?? []);

    if (marks.has('link') && run.href) return `[${text}](${run.href})`;
    if (marks.has('strong')) return `**${text}**`;
    if (marks.has('em')) return `*${text}*`;
    return text;
  }).join('');
}

/** One line of help, so the shorthand is never a secret. */
export const SHORTHAND_HELP =
  '**bold**, *italic*, [words](https://example.nz)';
