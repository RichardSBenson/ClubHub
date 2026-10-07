/**
 * A small JavaScript reader, just enough for security rules: it finds template literals (with the code inside their
 * ${...} holes), strings and comments, so rules look at real code and not at text that merely sits in a comment or string.
 * It is not a parser. Where it is unsure it errs towards reading more as code, which makes the rules stricter, not looser.
 */
const REGEX_AFTER = /[(,=:[!&|?{};+\-*%<>~^]$|\breturn$|\btypeof$|\bcase$|\bin$|\bof$/;

export function lex(src) {
  const templates = [];      // { start, end, line, parts:[{kind:'text'|'expr', value, line}] }
  const comments = [];       // { line, text }
  const lineOf = (i) => { let n = 1; for (let k = 0; k < i; k++) if (src.charCodeAt(k) === 10) n++; return n; };
  // Faster line lookup for many calls.
  const lineStarts = [0]; for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) lineStarts.push(i + 1);
  const lineAt = (i) => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (lineStarts[m] <= i) lo = m; else hi = m - 1; } return lo + 1; };

  function skipString(i, q) { i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; if (src[i] === '\n') break; i++; } return i + 1; }

  function readTemplate(i) {      // src[i] === '`'
    const start = i, parts = []; let text = '', textStart = i + 1; i++;
    while (i < src.length && src[i] !== '`') {
      if (src[i] === '\\') { text += src.slice(i, i + 2); i += 2; continue; }
      if (src[i] === '$' && src[i + 1] === '{') {
        parts.push({ kind: 'text', value: text, line: lineAt(textStart) }); text = '';
        const exprStart = i + 2; let depth = 1; i += 2;
        while (i < src.length && depth > 0) {
          const c = src[i];
          if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) break; }
          else if (c === "'" || c === '"') { i = skipString(i, c) - 1; }
          else if (c === '`') { const inner = readTemplate(i); i = inner.end - 1; }
          else if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; }
          else if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2); if (i < 0) i = src.length; else i++; }
          i++;
        }
        parts.push({ kind: 'expr', value: src.slice(exprStart, i), line: lineAt(exprStart) });
        i++; textStart = i; continue;
      }
      text += src[i]; i++;
    }
    parts.push({ kind: 'text', value: text, line: lineAt(textStart) });
    const t = { start, end: i + 1, line: lineAt(start), parts };
    templates.push(t);
    return t;
  }

  let i = 0, last = '';
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { const j = src.indexOf('\n', i); const e = j < 0 ? src.length : j; comments.push({ line: lineAt(i), text: src.slice(i, e) }); i = e; continue; }
    if (c === '/' && src[i + 1] === '*') { const j = src.indexOf('*/', i + 2); const e = j < 0 ? src.length : j + 2; comments.push({ line: lineAt(i), text: src.slice(i, e) }); i = e; continue; }
    if (c === "'" || c === '"') { i = skipString(i, c); last = 'x'; continue; }
    if (c === '`') { i = readTemplate(i).end; last = 'x'; continue; }
    if (c === '/' && REGEX_AFTER.test(last.trimEnd())) {      // a regular expression literal
      i++; let cls = false;
      while (i < src.length && src[i] !== '\n') { if (src[i] === '\\') i++; else if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false; else if (src[i] === '/' && !cls) break; i++; }
      i++; while (/[a-z]/.test(src[i] ?? '')) i++; last = 'x'; continue;
    }
    if (!/\s/.test(c)) last = (last + c).slice(-8); 
    i++;
  }
  return { templates, comments, lineAt };
}
