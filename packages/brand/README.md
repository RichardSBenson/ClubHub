# @honbu/brand

Crest in, accessible design tokens out.

```js
import { buildBrand } from './index.mjs';
const brand = buildBrand(rgbaPixels, { discipline: 'karate' });
```

Returns `palette`, `tokens`, `rules`, `warnings`, `typePairings` and `css`.

## Why it exists

Every federation has a crest and no brand guidelines. This derives a usable
palette from the crest in about a second — the moment in onboarding where a
committee stops evaluating and starts wanting it.

## The rule

**Contrast is computed, never generated.** Every token carries its measured
ratio against both backgrounds, and `warnings` names anything that cannot be
used as text. A model asked to pick colours will confidently produce gold on
white.

## Running the test

Generate a fixture from any PNG, then:

```bash
node test.mjs
```
