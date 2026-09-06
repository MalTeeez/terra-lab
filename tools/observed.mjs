#!/usr/bin/env node
/**
 * Model against the game: the in-game trials in `data/observed.json`, next to what `Real DPS`
 * predicts for them — and, where a trial recorded the raw quantities, the model's *terms* next to
 * the observed ones, one at a time.
 *
 *   node tools/observed.mjs            # every trial, against the target it was taken on
 *   node tools/observed.mjs --dummy    # every trial against a stationary, defenseless target
 *
 * A trial is one row of `trials`, and each field it carries unlocks one comparison:
 *
 *   dps                       the meter's number                → the model's value
 *   hits, seconds             raw hit events over the trial     → hit events per second (the clock)
 *   overlap, seconds          seconds the projectile sat on it  → uptime (the archetype knob)
 *   hits, overlap             hits while it was in contact      → the contact clock (60 / local)
 *   projectiles               how many were out at once         → `maxActive` / the cap of 4
 *   target: 'dummy' | 'boss'  a stationary dummy isolates the clock; the boss is where uptime lives
 *
 * Two aggregate DPS numbers cannot separate the clock from the uptime from the landing; the raw
 * fields can, and they are what a knob in the registry (`docs/rework-weapon-scoring.md`) is
 * calibrated against. The player block is what the Stat Meter reported, so the loadout bonus is
 * measured rather than solved: this compares the *delivery* model, not the gear.
 */
import { readFileSync } from 'node:fs';
import { indexDataset } from '../src/lib/dataset.js';
import { weaponDps } from '../src/lib/score.js';
import { ARCHETYPE, BOSS_DEFAULT, IMMUNITY } from '../src/lib/dps.js';

const ds = indexDataset(JSON.parse(readFileSync(new URL('../data/dataset.json', import.meta.url), 'utf8')));
const obs = JSON.parse(readFileSync(new URL('../data/observed.json', import.meta.url), 'utf8'));
const dummyAll = process.argv.includes('--dummy');
const PLAYER = obs.player;
const DUMMY = { ...BOSS_DEFAULT, name: 'target dummy', defense: 0, w: 32, h: 48, parts: 1, worm: false, immuneAll: true, still: true };

const pad = (v, n) => String(v).padStart(n);
const r1 = (v) => Math.round(v * 10) / 10;
console.log(`${obs.trials.length} trials${dummyAll ? ', all against a stationary dummy (0 defense)' : ''}\n`);
console.log('weapon                 shown  model   crit        observed   model    ratio   grade   target');
const ratios = [];
const terms = [];
for (const s of obs.trials) {
  const it = ds.items.find((x) => x.name === s.name);
  if (!it) { console.log(`${s.name.padEnd(22)} not in the dataset`); continue; }
  const prefix = ds.prefixById.get(s.prefix) ?? null;
  const onDummy = dummyAll || s.target === 'dummy';
  const v = weaponDps(it, { ds, stage: s.stage ?? PLAYER.stage, prefix, loadout: s.loadout ?? PLAYER.loadout, stealthMax: s.stealthMax ?? PLAYER.stealthMax, conds: new Set(), ...(onDummy ? { boss: DUMMY } : {}) });
  // what the game prints on the item: damage after the prefix, times what the loadout carries;
  // a screenshot taken with the bar full carries the stealth multiplier
  const shownModel = v.eff.damage * (1 + (s.loadout ?? PLAYER.loadout).damage) * (s.mode === 'stealth' ? v.stealthParts?.find((p) => /stealth strike ×/.test(p.label))?.mul ?? 1 : 1);
  // each trial is one loop: continuous throwing, or throw-pause-strike
  const got = s.mode === 'stealth' ? v.stealth ?? v.value : v.spam ?? v.value;
  const dps = s.dps ?? (s.damage && s.seconds ? s.damage / s.seconds : null);
  const ratio = dps ? got / dps : null;
  if (ratio) ratios.push(ratio);
  console.log(`${s.name.padEnd(22)} ${pad(s.shown ?? '-', 5)} ${pad(Math.round(shownModel), 6)}  ${pad(s.crit ?? '-', 2)}/${pad(Math.round(v.eff.crit + (s.loadout ?? PLAYER.loadout).crit), 2)}  ${pad(dps ? Math.round(dps) : '-', 9)} ${pad(Math.round(got), 7)}   ${ratio ? ratio.toFixed(2) + '×' : '   - '}   ${(s.mode ?? '').padEnd(7)} ${onDummy ? 'dummy' : 'boss'}${s.note ? `  (${s.note})` : ''}`);

  // ---- the terms, where the trial carries the raw numbers for them
  const grade = s.mode === 'stealth' ? 'stealth' : 'spam';
  const phases = (v.phases ?? []).filter((p) => (p.grade ?? 'spam') === grade);
  const modelEvents = phases.reduce((sum, p) => sum + (p.eventsSec ?? 0), 0);
  if (s.hits && s.seconds) terms.push({ name: s.name, term: 'hit events / s', observed: r1(s.hits / s.seconds), model: r1(modelEvents) });
  if (s.overlap && s.seconds) terms.push({ name: s.name, term: `uptime (${v.arch})`, observed: r1(s.overlap / s.seconds), model: ARCHETYPE[v.arch]?.uptime ?? 1 });
  if (s.hits && s.overlap) {
    const local = ds.projectiles?.[it.shoot]?.local;
    terms.push({ name: s.name, term: 'contact clock, hits / s in contact', observed: r1(s.hits / s.overlap), model: r1(60 / (local > 0 ? local : IMMUNITY)), note: local > 0 ? `local ${local}` : `the ${IMMUNITY}-tick fallback` });
  }
  if (s.projectiles) terms.push({ name: s.name, term: 'projectiles out at once', observed: s.projectiles, model: it.maxOut ?? ds.projectiles?.[it.shoot]?.maxActive ?? 4, note: it.maxOut || ds.projectiles?.[it.shoot]?.maxActive ? 'read' : 'the cap of 4' });
}
if (ratios.length) {
  const sorted = [...ratios].sort((a, b) => a - b);
  console.log(`\nmedian model/observed ${sorted[Math.floor(sorted.length / 2)].toFixed(2)}×  (1.00 = the model is right)`);
}
if (terms.length) {
  console.log('\nterm by term (a knob is calibrated against these, never against the aggregate)');
  for (const t of terms) console.log(`  ${t.name.padEnd(22)} ${t.term.padEnd(36)} observed ${pad(t.observed, 6)}   model ${pad(t.model, 6)}${t.note ? `   (${t.note})` : ''}`);
} else console.log('\nno trial carries raw hits, overlap or projectile counts yet: the aggregate is all there is to compare (see the protocol in data/observed.json)');
