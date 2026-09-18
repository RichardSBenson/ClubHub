/**
 * Enforces the dependency rule.
 *
 * "Dependencies point inward." In a language with no module visibility, that is
 * a convention until something checks it. This is the something.
 *
 * Run it in CI. If it fails, the architecture has been broken, not bent.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname;

/** Inner layers first. A layer may import itself and anything above it here. */
const LAYERS = [
  { name: 'domain', dir: 'packages/core/domain', mayImport: ['domain'] },
  { name: 'application', dir: 'packages/core/application',
    mayImport: ['domain', 'application'] },
  { name: 'infrastructure', dir: 'packages/infrastructure',
    mayImport: ['domain', 'application', 'infrastructure'] },
  { name: 'adapters', dir: 'packages/api',
    mayImport: ['domain', 'application', 'infrastructure', 'adapters'] },
];

/** Node built-ins are allowed anywhere except the domain. */
const BUILTIN = /^node:/;

function layerOf(file) {
  for (const l of LAYERS) if (file.includes(l.dir)) return l;
  return null;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (e.name.endsWith('.mjs')) out.push(p);
  }
  return out;
}

const violations = [];

for (const layer of LAYERS) {
  for (const file of walk(path.join(ROOT, layer.dir))) {
    const src = fs.readFileSync(file, 'utf8');
    const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    const rel = file.replace(ROOT, '');

    for (const spec of imports) {
      if (BUILTIN.test(spec)) {
        if (layer.name === 'domain')
          violations.push(`${rel}\n    domain imports the runtime: ${spec}`);
        continue;
      }

      if (!spec.startsWith('.')) {
        // A bare package name is a third-party dependency.
        if (layer.name !== 'adapters' && layer.name !== 'infrastructure')
          violations.push(`${rel}\n    ${layer.name} imports a package: ${spec}`);
        continue;
      }

      const target = path.resolve(path.dirname(file), spec).replace(ROOT, '');
      const targetLayer = LAYERS.find((l) => target.includes(l.dir));
      if (!targetLayer) continue;

      if (!layer.mayImport.includes(targetLayer.name)) {
        violations.push(
          `${rel}\n    ${layer.name} imports ${targetLayer.name}: ${spec}`);
      }
    }
  }
}

if (violations.length) {
  console.error('\nDEPENDENCY RULE BROKEN\n');
  for (const v of violations) console.error('  ' + v + '\n');
  console.error(`${violations.length} violation(s). Dependencies point inward.\n`);
  process.exit(1);
}

const counts = LAYERS.map((l) =>
  `${l.name}: ${walk(path.join(ROOT, l.dir)).length}`).join(', ');
console.log(`\nDependency rule holds. Files by layer — ${counts}\n`);
