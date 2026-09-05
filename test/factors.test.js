import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { FACTORS, factorOf, factorTip } from '../src/lib/factors.js';
import { realDps } from '../src/lib/dps.js';
import { indexDataset } from '../src/lib/dataset.js';

const ds = indexDataset(JSON.parse(readFileSync(new URL('../data/dataset.json', import.meta.url), 'utf8')));

describe('factorOf', () => {
  test('a tagged part is taken at its word, whatever its prose says', () => {
    // the label that started this: a hits multiplier that mentions the target three times
    const p = { fac: 'hits', label: 'infinite pierce: 2.6 hits (0 ticks on target, 5-tick immunity, 6 targets, 52% stay on target)' };
    expect(factorOf(p, true)).toBe('hits');
    expect(factorTip(p, true).startsWith('Hits')).toBe(true);
    // …and without the tag the regexes get it wrong, which is why the tag exists
    expect(factorOf(p.label, true)).toBe('target');
  });

  test('gear parts still classify off their label', () => {
    expect(factorOf({ label: '+20 defense' })).toBe('survival');
    expect(factorOf({ label: '+12% movement speed' })).toBe('mobility');
    expect(factorOf({ label: '+12% melee damage' })).toBe('damage');
  });

  /**
   * The check that cannot rot: every line dps.js prints has to say which factor it is. Reword a
   * label, add a new part, and this fails rather than quietly showing the wrong description.
   */
  test('every weapon part declares its factor', () => {
    const weapons = ds.items.filter((i) => i.slot === 'weapon');
    const stride = Math.ceil(weapons.length / 400); // a spread across the pool, not the first 400
    const missing = new Map();
    for (let i = 0; i < weapons.length; i += stride) {
      const w = weapons[i];
      const out = realDps(w, { ds, stage: w.stage ?? 0, conds: new Set() });
      for (const p of [...(out.parts ?? []), ...(out.stealthParts ?? [])]) {
        if (FACTORS[p.fac]) continue;
        if (!missing.has(p.label)) missing.set(p.label, w.id);
      }
    }
    expect([...missing]).toEqual([]);
  });
});
