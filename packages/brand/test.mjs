import fs from 'node:fs';
import { buildBrand, contrast } from './index.mjs';

const pixels = JSON.parse(fs.readFileSync('./fixture-moknz.json', 'utf8'));
const b = buildBrand(pixels, { discipline: 'karate' });

console.log('EXTRACTED FROM CREST');
for (const c of b.palette) console.log(`  ${c.hex}  ${(c.share*100).toFixed(1)}%`);

console.log('\nDERIVED TOKENS');
for (const [k,v] of Object.entries(b.tokens)) if (v) {
  const r = b.rules[k];
  console.log(`  ${k.padEnd(18)} ${v}   on canvas ${String(r.onCanvas).padStart(5)}:1` +
    `   on ink ${String(r.onInk).padStart(5)}:1` +
    (r.darkOnly ? '   [DARK ONLY]' : '') +
    (r.textOnCanvas ? '   [body text ok]' : ''));
}

console.log('\nWARNINGS');
b.warnings.forEach(w => console.log('  ! ' + w));

console.log('\nTYPE');
b.typePairings.slice(0,2).forEach(p => console.log(`  ${p.display} / ${p.body} — ${p.note}`));

console.log('\nCHECKS');
const t = b.tokens;
console.log('  white on primary      ', contrast('#FFFFFF', t.primary).toFixed(2));
console.log('  primaryText on canvas ', contrast(t.primaryText, t.canvas).toFixed(2));
console.log('  accent on canvas      ', contrast(t.accent, t.canvas).toFixed(2));
console.log('  accent on ink         ', contrast(t.accent, t.ink).toFixed(2));

console.log('\n' + b.css);
