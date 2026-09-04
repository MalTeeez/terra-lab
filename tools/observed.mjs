#!/usr/bin/env node
/**
 * Model against the game: the in-game readings we have, next to what `Real DPS` predicts for them.
 *
 *   node tools/observed.mjs            # against the stage's next boss (how the lab normally grades)
 *   node tools/observed.mjs --dummy    # against a stationary, defenseless target
 *
 * The player block is the one the Stat Meter reported for these readings, so the loadout bonus is
 * measured rather than solved: this compares the *delivery* model, not the gear.
 */
import { readFileSync } from 'node:fs';
import { indexDataset } from '../src/lib/dataset.js';
import { weaponDps } from '../src/lib/score.js';
import { BOSS_DEFAULT } from '../src/lib/dps.js';

const ds = indexDataset(JSON.parse(readFileSync(new URL('../data/dataset.json', import.meta.url), 'utf8')));
const dummy = process.argv.includes('--dummy');

// Stat Meter, post-Giant-Clam: 181.09% thrower damage, 16% crit (the 4% base included), Max Stealth 50
const PLAYER = { stage: 4, loadout: { damage: 0.8109, crit: 12 }, stealthMax: 0.5 };
const SAMPLES = [
  { name: 'Ashen Stalactite', prefix: 'CalamityMod:Flawless', mode: 'spam', shown: 202, crit: 21, dps: 190, note: 'close range' },
  { name: 'Contaminated Bile', prefix: 'CalamityMod:Sleek', mode: 'stealth', shown: 70, crit: 16, dps: 230, note: 'close range' },
  { name: 'Thorium Dagger', prefix: 'CalamityMod:Sharp', mode: 'spam', shown: 141, crit: 16, dps: 130, note: 'mid range, stationary' },
  { name: 'Scourge of the Desert', prefix: 'CalamityMod:Flawless', mode: 'stealth', shown: 67, crit: 21, dps: 300, note: 'single target' },
];

const target = dummy ? { ...BOSS_DEFAULT, name: 'target dummy', defense: 0, w: 32, h: 48, parts: 1, worm: false, immuneAll: true, still: true } : null;
const pad = (v, n) => String(v).padStart(n);
console.log(`vs ${dummy ? 'a stationary dummy (0 defense)' : "the stage's next boss"}\n`);
console.log('weapon                 shown  model   crit        observed   model    ratio   grade');
let ratios = [];
for (const s of SAMPLES) {
  const it = ds.items.find((x) => x.name === s.name);
  const prefix = ds.prefixById.get(s.prefix) ?? null;
  const v = weaponDps(it, { ds, stage: PLAYER.stage, prefix, loadout: PLAYER.loadout, stealthMax: PLAYER.stealthMax, conds: new Set(), ...(target ? { boss: target } : {}) });
  // what the game prints on the item: damage after the prefix, times what the loadout carries
  // every screenshot was taken with the bar full, so the printed damage carries the stealth multiplier
  const shownModel = v.eff.damage * (1 + PLAYER.loadout.damage) * (v.stealthParts?.find((p) => /stealth strike ×/.test(p.label))?.mul ?? 1);
  // spamming is the spam grade; "using stealth strikes" is still mostly throwing, so it is the total
  const got = s.mode === 'stealth' ? v.value : v.spam ?? v.value;
  const ratio = got / s.dps;
  ratios.push(ratio);
  console.log(`${s.name.padEnd(22)} ${pad(s.shown, 5)} ${pad(Math.round(shownModel), 6)}  ${pad(s.crit, 2)}/${pad(Math.round(v.eff.crit + PLAYER.loadout.crit), 2)}  ${pad(s.dps, 9)} ${pad(Math.round(got), 7)}   ${ratio.toFixed(2)}×   ${s.mode}`);
}
const sorted = [...ratios].sort((a, b) => a - b);
console.log(`\nmedian model/observed ${sorted[Math.floor(sorted.length / 2)].toFixed(2)}×  (1.00 = the model is right)`);
