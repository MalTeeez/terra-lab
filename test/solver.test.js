import { describe, expect, test } from 'bun:test';
import { indexDataset } from '../src/lib/dataset.js';
import { accessoryGroup, foreignClass, pieceScore, weaponDps } from '../src/lib/score.js';
import { solveLoadout, solveTimeline } from '../src/lib/solver.js';

const raw = {
  generatedAt: '2026-09-01', tml: 'test',
  mods: [{ id: 'v', name: 'Terraria', equipment: 10 }, { id: 'M', name: 'Mod', equipment: 10 }],
  stages: [
    { index: 0, key: 'start', label: 'Pre-boss', progression: 0, mod: 'v', kind: 'start' },
    { index: 1, key: 'EoC', label: 'Eye of Cthulhu', progression: 2, mod: 'v', kind: 'boss' },
    { index: 2, key: 'WoF', label: 'Wall of Flesh', progression: 7, mod: 'v', kind: 'boss' },
  ],
  classAliases: { thrower: 'rogue' },
  items: [
    // weapons
    { id: 'v:sword', mod: 'v', name: 'Sword', slot: 'weapon', class: 'melee', damage: 20, useAnimation: 20, useTime: 20, crit: 4, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'v:fast', mod: 'v', name: 'Fast Blade', slot: 'weapon', class: 'melee', damage: 12, useAnimation: 8, useTime: 8, crit: 4, stage: 1, stageSource: { kind: 'drop' } },
    { id: 'v:late', mod: 'v', name: 'Late Blade', slot: 'weapon', class: 'melee', damage: 90, useAnimation: 20, useTime: 20, crit: 10, stage: 2, stageSource: { kind: 'drop' } },
    { id: 'M:knife', mod: 'M', name: 'Knife', slot: 'weapon', class: 'thrower', damage: 30, useTime: 15, useAnimation: 15, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:staff', mod: 'M', name: 'Minion Staff', slot: 'weapon', class: 'summon', damage: 9, useTime: 30, useAnimation: 30, stage: 0, stageSource: { kind: 'rarity' } },
    // armor: a set with bonus, and a loose helmet with more defense but no set
    { id: 'v:h1', mod: 'v', name: 'Set Helmet', slot: 'head', defense: 4, effects: { damage: { melee: 0.05 } }, set: ['v:b1', 'v:l1'], setEffects: { damage: { melee: 0.1 } }, setBonus: '10% melee', stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'v:b1', mod: 'v', name: 'Set Plate', slot: 'body', defense: 5, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'v:l1', mod: 'v', name: 'Set Greaves', slot: 'legs', defense: 4, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'v:h2', mod: 'v', name: 'Tank Helmet', slot: 'head', defense: 12, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'v:h3', mod: 'v', name: 'Mage Hat', slot: 'head', defense: 3, effects: { damage: { magic: 0.3 } }, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'v:b2', mod: 'v', name: 'Late Plate', slot: 'body', defense: 40, stage: 2, stageSource: { kind: 'drop' } },
    // accessories
    { id: 'v:emblem', mod: 'v', name: 'Warrior Emblem', slot: 'accessory', effects: { damage: { melee: 0.15 } }, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'v:wings1', mod: 'v', name: 'Small Wings', slot: 'accessory', wings: true, effects: { wingTime: 100 }, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'v:wings2', mod: 'v', name: 'Big Wings', slot: 'accessory', wings: true, effects: { wingTime: 200 }, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'v:shield', mod: 'v', name: 'Shield', slot: 'accessory', defense: 4, effects: { flags: ['noKnockback'] }, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'v:mage', mod: 'v', name: 'Sorcerer Emblem', slot: 'accessory', effects: { damage: { magic: 0.15 } }, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'v:vanity', mod: 'v', name: 'Vanity Thing', slot: 'accessory', stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'v:unknown', mod: 'v', name: 'Mystery Emblem', slot: 'accessory', effects: { damage: { all: 0.5 } }, stage: null, stageSource: { kind: 'unknown' } },
    { id: 'M:rogueacc', mod: 'M', name: 'Throwing Charm', slot: 'accessory', effects: { damage: { thrower: 0.2 } }, stage: 0, stageSource: { kind: 'rarity' } },
  ],
};

const ds = indexDataset(structuredClone(raw));

describe('score', () => {
  test('weapon DPS uses animation for melee and crit as expected value', () => {
    const r = weaponDps(ds.byId.get('v:sword'));
    expect(r.kind).toBe('dps');
    expect(r.value).toBeCloseTo(20 * 3 * 1.04 * 0.8); // true melee: contact range factor
    expect(weaponDps(ds.byId.get('M:staff')).kind).toBe('per hit');
  });
  test('piece score reads effects for the class and ignores other classes', () => {
    expect(pieceScore(ds.byId.get('v:emblem'), 'melee').score).toBe(15);
    expect(pieceScore(ds.byId.get('v:emblem'), 'magic').score).toBe(0);
    expect(foreignClass(ds.byId.get('v:mage'), 'melee')).toBe(true);
    expect(foreignClass(ds.byId.get('v:shield'), 'melee')).toBe(false);
  });
  test('aliases fold thrower bonuses into rogue', () => {
    expect(pieceScore(ds.byId.get('M:rogueacc'), 'rogue', ds.aliases).score).toBe(20);
    expect(foreignClass(ds.byId.get('M:rogueacc'), 'rogue', ds.aliases)).toBe(false);
  });
  test('exclusive groups', () => {
    expect(accessoryGroup(ds.byId.get('v:wings1'))).toBe('wings');
    expect(accessoryGroup(ds.byId.get('v:shield'))).toBe('shield');
    expect(accessoryGroup(ds.byId.get('v:emblem'))).toBeNull();
  });
});

describe('solveLoadout', () => {
  test('respects the stage cutoff and ranks weapons by DPS', () => {
    const lo = solveLoadout(ds, { cls: 'melee', stage: 1, slots: 6 });
    expect(lo.weapons.map((w) => w.item.id)).toEqual(['v:fast', 'v:sword']);
    const later = solveLoadout(ds, { cls: 'melee', stage: 2, slots: 6 });
    expect(later.weapons[0].item.id).toBe('v:late');
  });
  test('prefers the full set when its bonus beats loose pieces, else mixes', () => {
    const lo = solveLoadout(ds, { cls: 'melee', stage: 0, slots: 6 });
    expect(lo.armor.isSet).toBe(true);
    expect(lo.armor.head.item.id).toBe('v:h1');
    const magic = solveLoadout(ds, { cls: 'magic', stage: 0, slots: 6 });
    expect(magic.armor.head.item.id).toBe('v:h3');
    expect(magic.armor.isSet).toBe(false);
  });
  test('requireSet forces a set even when mixed pieces score higher', () => {
    const lo = solveLoadout(ds, { cls: 'melee', stage: 2, slots: 6, requireSet: true });
    expect(lo.armor.isSet).toBe(true);
    const free = solveLoadout(ds, { cls: 'melee', stage: 2, slots: 6 });
    expect(free.armor.body.item.id).toBe('v:b2');
  });
  test('accessories: one per group, no foreign class, no zero-score, no unknown stage by default', () => {
    const lo = solveLoadout(ds, { cls: 'melee', stage: 0, slots: 3 });
    const ids = lo.accessories.map((a) => a.item.id);
    expect(ids).toContain('v:emblem');
    expect(ids).toContain('v:wings2');
    expect(ids).not.toContain('v:wings1');
    expect(ids).not.toContain('v:mage');
    expect(ids).not.toContain('v:vanity');
    expect(ids).not.toContain('v:unknown');
    expect(lo.accessories.length).toBe(3);
    const withUnknown = solveLoadout(ds, { cls: 'melee', stage: 0, slots: 3, unknownStage: true });
    expect(withUnknown.accessories[0].item.id).toBe('v:unknown');
  });
  test('excluded mods are not drawn from', () => {
    const lo = solveLoadout(ds, { cls: 'rogue', stage: 0, slots: 6, excludedMods: new Set(['M']) });
    expect(lo.weapons.length).toBe(0);
    const inc = solveLoadout(ds, { cls: 'rogue', stage: 0, slots: 6 });
    expect(inc.weapons[0].item.id).toBe('M:knife');
    expect(inc.accessories.map((a) => a.item.id)).toContain('M:rogueacc');
  });
});

describe('solveTimeline', () => {
  test('flags the stages where the loadout changes', () => {
    const rows = solveTimeline(ds, { cls: 'melee', slots: 6 });
    expect(rows.length).toBe(3);
    expect(rows[0].changes.has('weapon')).toBe(true);
    expect(rows[1].changes.has('weapon')).toBe(true);
    expect(rows[1].changes.has('armor')).toBe(false);
    expect(rows[2].changes.has('armor')).toBe(true);
  });
});
