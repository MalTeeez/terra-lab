import { describe, expect, test } from 'bun:test';
import { accuracy, bestAmmo, realDps, stealthMultiplier } from '../src/lib/dps.js';
import { indexDataset } from '../src/lib/dataset.js';

const raw = {
  mods: [{ id: 'v', name: 'Terraria', equipment: 1 }, { id: 'M', name: 'Mod', equipment: 1 }],
  stages: [{ index: 0, key: 'start', label: 'Pre-boss', progression: 0, mod: 'v', kind: 'start' }, { index: 1, key: 'b', label: 'Boss', progression: 1, mod: 'v', kind: 'boss' }],
  classAliases: { thrower: 'rogue' },
  prefixes: [],
  ammoKinds: { 97: 'Bullet' },
  ammo: [
    { id: 'v:97', name: 'Musket Ball', kind: 97, damage: 7, shoot: 'v:14', stage: 0 },
    { id: 'M:bigshot', name: 'Big Shot', kind: 97, damage: 20, shoot: 'v:14', stage: 1 },
  ],
  projectiles: {
    'v:14': { pen: 1, updates: 1 },
    'v:1': { ai: 1, gravity: true },
    'M:knife': { pen: 1, stealth: true },
    'M:spear': { pen: -1, gravity: true, debuffs: ['Bleeding'] },
    'M:bomb': { pen: 1, gravity: true, children: [{ type: 'M:boom', count: 1, where: 'kill' }] },
    'M:boom': { pen: -1 },
    'M:minion': { minion: true, slots: 1, local: 20 },
    'M:missile': { homing: true, updates: 0 },
  },
  items: [
    { id: 'v:sword', mod: 'v', name: 'Sword', slot: 'weapon', class: 'melee', damage: 20, useTime: 20, useAnimation: 20, crit: 4, useStyle: 1, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'v:gun', mod: 'v', name: 'Gun', slot: 'weapon', class: 'ranged', damage: 10, useTime: 10, useAnimation: 10, crit: 4, useAmmo: 97, shoot: 'v:10', shootSpeed: 8, noMelee: true, useStyle: 5, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'v:bow', mod: 'v', name: 'Bow', slot: 'weapon', class: 'ranged', damage: 10, useTime: 10, useAnimation: 10, crit: 4, shoot: 'v:1', shootSpeed: 4, noMelee: true, useStyle: 5, stage: 0, stageSource: { kind: 'rarity' },
      fire: { calls: [{ type: 'shoot', count: 3, spread: 0.5 }], defaultShot: { spam: false, stealth: false } } },
    { id: 'M:rogue', mod: 'M', name: 'Knife', slot: 'weapon', class: 'thrower', damage: 30, useTime: 20, useAnimation: 20, crit: 4, shoot: 'M:knife', shootSpeed: 12, noMelee: true, useStyle: 1, stage: 0, stageSource: { kind: 'rarity' },
      fire: { calls: [{ type: 'M:spear', count: 6, variant: 'stealth', region: 50 }], defaultShot: { spam: true, stealth: false }, stealthMods: { dmgMul: 1.5 }, stealth: true } },
    { id: 'M:staff', mod: 'M', name: 'Staff', slot: 'weapon', class: 'summon', damage: 12, useTime: 30, useAnimation: 30, shoot: 'M:minion', stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:tome', mod: 'M', name: 'Tome', slot: 'weapon', class: 'magic', damage: 40, useTime: 6, useAnimation: 6, crit: 4, mana: 10, shoot: 'M:missile', shootSpeed: 12, noMelee: true, useStyle: 5, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:bomb', mod: 'M', name: 'Bomb', slot: 'weapon', class: 'thrower', damage: 30, useTime: 30, useAnimation: 30, crit: 4, shoot: 'M:bomb', shootSpeed: 8, noMelee: true, useStyle: 1, stage: 0, stageSource: { kind: 'rarity' } },
  ],
};
const ds = indexDataset(structuredClone(raw));
const ctx = (extra = {}) => ({ conds: new Set(), uncertain: false, prefix: null, calibration: null, ds, stage: 0, ...extra });

describe('realDps', () => {
  test('true melee: damage × rate × crit × contact range', () => {
    const r = realDps(ds.byId.get('v:sword'), ctx());
    expect(r.kind).toBe('dps');
    expect(r.value).toBeCloseTo(20 * 3 * 1.04 * 0.8);
    expect(r.parts.map((p) => p.label)).toContain('contact range');
  });
  test('ammo weapons add the best ammo at the stage and use its projectile', () => {
    const gun = ds.byId.get('v:gun');
    const r0 = realDps(gun, ctx({ stage: 0 }));
    expect(r0.hit).toBe(17);
    expect(bestAmmo(ds, 97, 1).name).toBe('Big Shot');
    expect(realDps(gun, ctx({ stage: 1 })).hit).toBe(30);
    // bullet: 16 px/tick effective (8 × 2 updates) → no velocity penalty
    expect(r0.parts.some((p) => /velocity/.test(p.label))).toBe(false);
    expect(r0.value).toBeCloseTo(17 * 6 * 1.04);
  });
  test('spread, gravity and slow projectiles reduce accuracy; count multiplies', () => {
    const r = realDps(ds.byId.get('v:bow'), ctx());
    const acc = accuracy(ds.projectiles['v:1'], { spread: 0.5, velocity: 4 });
    expect(acc.f).toBeCloseTo((0.14 / 0.5) * 0.55 * 0.85);
    expect(r.parts.find((p) => /projectiles per use/.test(p.label)).mul).toBe(3);
    expect(r.value).toBeCloseTo(10 * 6 * 1.04 * 3 * acc.f);
  });
  test('homing ignores spread and gravity, magic pays for mana', () => {
    const r = realDps(ds.byId.get('M:tome'), ctx());
    expect(r.parts.some((p) => p.label === 'homing')).toBe(true);
    const mana = r.parts.find((p) => /mana\/s/.test(p.label));
    expect(mana.mul).toBeCloseTo(0.5); // 100 mana/s → floor
    expect(r.value).toBeCloseTo(40 * 10 * 1.04 * 0.5);
  });
  test('pierce, debuffs and child projectiles add hits', () => {
    const r = realDps(ds.byId.get('M:bomb'), ctx());
    expect(r.parts.some((p) => /child projectiles/.test(p.label))).toBe(true);
    expect(r.value).toBeGreaterThan(30 * 2 * 1.04 * 0.85 * 0.55);
  });
  test('summons rank by damage per slot × attack rate', () => {
    const r = realDps(ds.byId.get('M:staff'), ctx());
    expect(r.mode).toBe('minion');
    expect(r.value).toBeCloseTo(12 * 3); // 60/20 = 3 hits/s
  });
  test('rogue weapons are graded stealth or spam, whichever is higher', () => {
    const r = realDps(ds.byId.get('M:rogue'), ctx({ stealthMax: 1 }));
    expect(r.mode).toBe('stealth');
    expect(r.spam).toBeCloseTo(30 * 3 * 1.04);
    const mult = stealthMultiplier(20, 1, 1.5);
    expect(mult).toBeGreaterThan(3);
    // stealth: six spears (infinite pierce, gravity, 1 debuff) once per 5 s; past 4 hits per use only half land
    expect(r.stealth).toBeCloseTo((30 * mult * 1.04 * 5 * (1.35 * 1.03 * 0.85) * 1.15) / 5);
    expect(r.value).toBe(r.stealth);
    const low = realDps(ds.byId.get('M:rogue'), ctx({ stealthMax: 0.1 }));
    expect(low.mode).toBe('spam');
  });
});
