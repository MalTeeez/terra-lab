import { describe, expect, test } from 'bun:test';
import { fitCalibration } from '../src/lib/calibration.js';
import { indexDataset } from '../src/lib/dataset.js';
import { weaponDps } from '../src/lib/score.js';
import { solveLoadout } from '../src/lib/solver.js';
import { bestPrefix, effectiveStats, prefixesFor } from '../src/lib/stats.js';

const raw = {
  mods: [{ id: 'v', name: 'Terraria', equipment: 1 }, { id: 'M', name: 'Mod', equipment: 1 }],
  stages: [{ index: 0, key: 'start', label: 'Pre-boss', progression: 0, mod: 'v', kind: 'start' }],
  classAliases: { thrower: 'rogue' },
  conditions: ['revenge'],
  prefixes: [
    { id: 'v:Legendary', mod: 'v', name: 'Legendary', category: 'melee', dmg: 0.15, useTime: -0.1, crit: 5, kb: 0.15 },
    { id: 'v:Ruthless', mod: 'v', name: 'Ruthless', category: 'weapon', dmg: 0.18, useTime: 0, crit: 0, kb: -0.1 },
    { id: 'v:Unreal', mod: 'v', name: 'Unreal', category: 'ranged', dmg: 0.15, useTime: -0.1, crit: 5 },
    { id: 'M:Flawless', mod: 'M', name: 'Flawless', category: 'weapon', dmg: 0.15, useTime: -0.1, crit: 5, rollsFor: ['thrower'] },
    { id: 'v:Menacing', mod: 'v', name: 'Menacing', category: 'accessory', effects: { damage: { all: 0.04 } } },
    { id: 'v:Warding', mod: 'v', name: 'Warding', category: 'accessory', effects: { defense: 4 } },
  ],
  items: [
    { id: 'M:sword', mod: 'M', name: 'Sword', slot: 'weapon', class: 'melee', damage: 104, useTime: 24, useAnimation: 24, crit: 16, stage: 0, stageSource: { kind: 'rarity' },
      base: { damage: 52, useTime: 16, useAnimation: 16, crit: 6 },
      changes: [{ mod: 'A', hook: 'SetDefaults', field: 'damage', from: 52, to: 104 }, { mod: 'B', hook: 'SetDefaults', field: 'useTime', from: 16, to: 24 }, { mod: 'B', hook: 'SetDefaults', field: 'useAnimation', from: 16, to: 24 }, { mod: 'B', hook: 'SetDefaults', field: 'crit', from: 6, to: 16 }],
      variants: [{ mod: 'C', cond: ['revenge'], field: 'damage', to: 150 }],
      mods: [{ mod: 'D', hook: 'ModifyWeaponDamage', kind: 'damage', mul: 1.5, conditional: true }, { mod: 'E', hook: 'UseTimeMultiplier', kind: 'useTime', mul: 0.5 }] },
    { id: 'M:knife', mod: 'M', name: 'Knife', slot: 'weapon', class: 'thrower', damage: 30, useTime: 15, useAnimation: 15, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:acc', mod: 'M', name: 'Charm', slot: 'accessory', effects: { damage: { melee: 0.1 } }, stage: 0, stageSource: { kind: 'rarity' } },
  ],
};
const ds = indexDataset(structuredClone(raw));
const base = { conds: new Set(), uncertain: false, prefix: null, calibration: null };

describe('effectiveStats', () => {
  test('replays balancing overlays and reports the chain', () => {
    const e = effectiveStats(ds.byId.get('M:sword'), base);
    expect(e.chain[0]).toMatchObject({ label: "mined from the item's own mod", damage: 52, crit: 6, useTime: 16 });
    expect(e.chain[1]).toMatchObject({ damage: 104 });
    expect(e.chain.at(-2).label).toBe('E UseTimeMultiplier ×0.5');
    expect(e.chain.at(-1).label).toBe('after runtime modifiers');
    expect(e.damage).toBe(104);
    expect(e.useTime).toBe(12); // unconditional use-time modifier applies
    expect(e.crit).toBe(16);
  });
  test('difficulty variants and uncertain modifiers are opt-in', () => {
    const it = ds.byId.get('M:sword');
    expect(effectiveStats(it, { ...base, conds: new Set(['revenge']) }).damage).toBe(150);
    expect(effectiveStats(it, { ...base, uncertain: true }).damage).toBe(156);
  });
  test('prefix and calibration apply last', () => {
    const it = ds.byId.get('M:sword');
    const e = effectiveStats(it, { ...base, prefix: ds.prefixById.get('v:Legendary'), calibration: { factor: () => 1.1 } });
    expect(e.damage).toBe(Math.round(104 * 1.15 * 1.1));
    expect(e.crit).toBe(21);
    expect(e.useTime).toBeCloseTo(12 * 0.9);
  });
});

describe('prefixes', () => {
  test('melee weapons roll melee + universal prefixes; thrower rolls mod prefixes via aliases', () => {
    expect(prefixesFor(ds.byId.get('M:sword'), ds.prefixes, ds.aliases).map((p) => p.name)).toEqual(['Legendary', 'Ruthless']);
    expect(prefixesFor(ds.byId.get('M:knife'), ds.prefixes, ds.aliases).map((p) => p.name)).toEqual(['Ruthless', 'Flawless']);
    expect(prefixesFor(ds.byId.get('M:acc'), ds.prefixes).map((p) => p.name)).toEqual(['Menacing', 'Warding']);
  });
  test('best prefix maximises DPS / class score', () => {
    const b = bestPrefix(ds.byId.get('M:sword'), ds.prefixes, { ...base, aliases: ds.aliases }, { dpsOf: (i, p) => weaponDps(i, { ...base, prefix: p }).value, scoreOf: () => 0 });
    expect(b.name).toBe('Legendary');
  });
});

describe('solver with owned gear', () => {
  test('owned prefix is kept, assumed-best otherwise, and owned-only source restricts the pool', () => {
    const lo = solveLoadout(ds, { cls: 'melee', stage: 0, slots: 2, reforge: 'best', owned: { 'M:sword': { prefix: 'v:Ruthless' } } });
    expect(lo.weapons[0].prefix.name).toBe('Ruthless');
    expect(lo.weapons[0].owned).toBe(true);
    expect(lo.accessories[0].prefix.name).toBe('Menacing');
    const onlyOwned = solveLoadout(ds, { cls: 'melee', stage: 0, slots: 2, source: 'owned', owned: { 'M:sword': { prefix: null } } });
    expect(onlyOwned.weapons[0].prefix).toBeNull();
    expect(onlyOwned.accessories.length).toBe(0);
  });
  test('excluded items never appear, pinned ones always do', () => {
    const lo = solveLoadout(ds, { cls: 'melee', stage: 0, slots: 2, excluded: new Set(['M:sword']) });
    expect(lo.weapons.length).toBe(0);
    const pinned = solveLoadout(ds, { cls: 'melee', stage: 0, slots: 1, pinned: new Set(['M:acc']) });
    expect(pinned.accessories[0].pinned).toBe(true);
  });
});

describe('calibration', () => {
  test('fits a per-class factor from observed damage and reports residuals', () => {
    const fit = fitCalibration([{ id: 'M:sword', damage: 114, prefix: null, bonusDamage: 0 }], ds, { conds: new Set(), uncertain: false });
    expect(fit.factors.melee).toBeCloseTo(114 / 104);
    expect(fit.factor('melee')).toBeCloseTo(1.096, 2);
    expect(fit.factor('ranged')).toBeCloseTo(1.096, 2); // falls back to the overall median
    expect(fit.rows[0].err).toBeCloseTo(9.6, 0);
    const naked = fitCalibration([{ id: 'M:sword', damage: 125, bonusDamage: 0.2 }], ds, { conds: new Set(), uncertain: false });
    expect(naked.factors.melee).toBeCloseTo(125 / (104 * 1.2), 3);
  });
});
