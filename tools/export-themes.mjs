/**
 * Writes the built-in themes to themes/*.json — the files a federation can
 * download, edit and import elsewhere. The modules are the source of truth
 * (they are traced into the serverless bundle; a JSON read at runtime is not);
 * a test fails if the two drift, so run this after changing a built-in.
 */
import fs from 'node:fs';
import { BUILT_IN } from '../packages/site/builtin-themes.mjs';
import { readTheme, serialise } from '../packages/site/theme.mjs';

fs.mkdirSync(new URL('../themes/', import.meta.url), { recursive: true });
for (const [key, doc] of Object.entries(BUILT_IN)) {
  const read = readTheme(doc);
  if (!read.ok) { console.error(`${key}: ${read.problems.join(' ')}`); process.exit(1); }
  fs.writeFileSync(new URL(`../themes/${key}.json`, import.meta.url), serialise(read.theme));
  console.log(`themes/${key}.json`);
}
