import { describe, expect, test } from 'bun:test';
import { indexDataset } from '../src/lib/dataset.js';
import { gradeHealerWeapon, healerSetStyles } from '../src/lib/healer.js';
import { packTimeline, solveLoadout, solveTimeline, unpackTimeline } from '../src/lib/solver.js';

const at = { stage: 0, stageSource: { kind: 'rarity' } };
const raw = {
  generatedAt: '2026-09-01', tml: 'test',
  mods: [{ id: 'T', name: 'Thorium', equipment: 10 }],
  stages: [{ index: 0, key: 'start', label: 'Pre-boss', progression: 0, mod: 'T', kind: 'start' }, { index: 1, key: 'EoC', label: 'Eye of Cthulhu', progression: 2, mod: 'T', kind: 'boss' }],
  classAliases: {},
  items: [
    { id: 'T:staff', mod: 'T', name: 'Heart Staff', slot: 'weapon', class: 'healer', dc: 'HealerTool', useTime: 20, useAnimation: 20, mana: 4, heal: { type: 1, amount: 6 }, ...at },
    { id: 'T:scythe', mod: 'T', name: 'Bone Scythe', slot: 'weapon', class: 'healer', dc: 'HealerDamage', damage: 20, useTime: 22, useAnimation: 22, scythe: 2, ...at },
    { id: 'T:bolt', mod: 'T', name: 'Light Bolt', slot: 'weapon', class: 'healer', dc: 'HealerDamage', damage: 18, useTime: 25, useAnimation: 25, ...at },
    // a radiant mace whose hits drop heals for you and your allies: filed with the radiant weapons, and played by Support too
    { id: 'T:mace', mod: 'T', name: 'Mending Mace', slot: 'weapon', class: 'healer', dc: 'HealerDamage', damage: 16, useTime: 24, useAnimation: 24, heal: { type: 3, amount: 0, bonusMax: 4 }, ...at },
    { id: 'T:dark', mod: 'T', name: 'Dark Bolt', slot: 'weapon', class: 'healer', dc: 'HealerDamage', damage: 18, useTime: 25, useAnimation: 25, lifeCost: 4, radiantLifeCost: true, ...at },
    { id: 'T:gem', mod: 'T', name: 'Life Gem', slot: 'accessory', stats: { healerHealing: 3 }, effects: { mod: { healBonus: 3 } }, ...at },
    { id: 'T:idol', mod: 'T', name: 'Dark Idol', slot: 'accessory', effects: { flags: ['darkAura'] }, tooltip: 'Empowers certain radiant attacks with dark energy', ...at },
    // a head with a mod of its own over a body whose healing bonus must still tag the set
    { id: 'T:h', mod: 'T', name: 'Cleric Hood', slot: 'head', defense: 3, effects: { mod: { radiantLifeCost: 2 } }, set: ['T:b', 'T:l'], setBonus: 'halves radiant life costs', setEffects: { mod: { radiantLifeCost: 2 } }, ...at },
    { id: 'T:b', mod: 'T', name: 'Cleric Robe', slot: 'body', defense: 4, stats: { healerHealing: 2 }, effects: { mod: { healBonus: 2 } }, ...at },
    { id: 'T:l', mod: 'T', name: 'Cleric Skirt', slot: 'legs', defense: 3, ...at },
  ],
};
const ds = indexDataset(structuredClone(raw));
const solve = (playstyle, more = {}) => solveLoadout(ds, { cls: 'healer', stage: 0, slots: 6, reforge: 'none', playstyle, ...more });

describe('healer solve', () => {
  test('a playstyle keeps its own category of weapons, and the counts cover them all', () => {
    const support = solve({ healer: 'support' });
    expect(support.styleCounts).toEqual({ radiant: 2, reaper: 1, dark: 1, support: 2 });
    expect(solve({ healer: 'radiant' }).weapons.map((w) => w.item.id).sort()).toEqual(['T:bolt', 'T:mace']);
    expect(solve({ healer: 'reaper' }).weapons.map((w) => w.item.id)).toEqual(['T:scythe']);
    expect(solve({ healer: 'dark' }).weapons.map((w) => w.item.id)).toEqual(['T:dark']);
  });

  test('Support plays every weapon that heals allies, not only the healing staffs', () => {
    const support = solve({ healer: 'support' });
    expect(support.weapons.map((w) => w.item.id).sort()).toEqual(['T:mace', 'T:staff']);
    const mace = support.weapons.find((w) => w.item.id === 'T:mace');
    // graded on its heals (half of them land on an ally: they ride on its hits) plus its own DPS
    expect(mace.kind).toBe('support');
    expect(mace.support.heal.delivery).toBe(0.5);
    expect(mace.category).toBe('radiant');
  });

  test('without a playstyle the healer is graded on damage and a staff that deals none is left out', () => {
    const lo = solve({});
    expect(lo.weapons.map((w) => w.item.id).sort()).toEqual(['T:bolt', 'T:dark', 'T:mace', 'T:scythe']);
    expect(lo.playstyle).toBe(null);
  });

  test('every playstyle has its own gear list, read on demand', () => {
    const lo = solve({});
    expect(Object.keys(lo.styleGear)).toEqual(['radiant', 'reaper', 'dark', 'support']);
    // the accessories built for a playstyle, ranked under it
    expect(lo.styleGear.support.accessories.map((a) => a.item.id)).toContain('T:gem');
    expect(lo.styleGear.support.accessories.map((a) => a.item.id)).not.toContain('T:idol');
    expect(lo.styleGear.dark.accessories.map((a) => a.item.id)).toContain('T:idol');
    // a non-healer never builds them, and the timeline skips them
    expect(solveLoadout(ds, { cls: 'melee', stage: 0, slots: 6, reforge: 'none' }).styleGear).toBe(null);
    expect(solve({}, { styleGear: false }).styleGear).toBe(null);
  });

  test('a set is tagged by any of its pieces: a head with a mod of its own does not hide the body\'s bonus healing', () => {
    const set = solve({}).armor;
    expect(set.isSet).toBe(true);
    expect(healerSetStyles(set).sort()).toEqual(['dark', 'reaper', 'support']);
  });

  test('a playstyle\'s gear list survives packing a timeline', () => {
    const rows = solveTimeline(ds, { cls: 'healer', slots: 6, reforge: 'none', playstyle: {} });
    expect(rows.every((r) => r.loadout.styleGear === null)).toBe(true);
    const lo = solve({});
    const packed = packTimeline([{ stage: 0, loadout: lo, changes: [] }]);
    const [back] = unpackTimeline(ds, packed);
    expect(back.loadout.styleGear.support.accessories.map((a) => a.item.id)).toEqual(lo.styleGear.support.accessories.map((a) => a.item.id));
  });

  test('a healing staff is reforged on what Support grades it on', () => {
    // vanilla's universal weapon prefixes, in the shape the miner writes them; Dull first, so a tie
    // (every prefix worth the same, as when the heal ignored the reforge) would come back Dull
    const prefixes = [
      { id: 'v:Dull', name: 'Dull', category: 'weapon', dmg: -0.15, useTime: 0, crit: 0, kb: 0, mana: 0 },
      { id: 'v:Hasty', name: 'Hasty', category: 'weapon', dmg: 0, useTime: -0.1, crit: 0, kb: 0, mana: 0 },
    ];
    const withPrefixes = indexDataset({ ...structuredClone(raw), prefixes });
    const support = (reforge) => solveLoadout(withPrefixes, { cls: 'healer', stage: 0, slots: 6, reforge, playstyle: { healer: 'support' } }).weapons.find((w) => w.item.id === 'T:staff');
    const staff = support('best');
    // a damage-less staff ties at 0 on DPS: only its heals can tell the reforges apart, and casting
    // 10% faster heals more
    expect(staff.prefix?.name).toBe('Hasty');
    expect(staff.value).toBeGreaterThan(support('none').value);
  });
});

describe('gradeHealerWeapon consumables', () => {
  const d = { value: 100, parts: [] };
  const opts = { progression: 7 };
  test('are cut under a playstyle only', () => {
    const potion = { cls: 'healer', damage: 10, scythe: 1, consumable: true };
    expect(gradeHealerWeapon(potion, d, { ...opts, style: null }).value).toBe(100);
    expect(gradeHealerWeapon(potion, d, { ...opts, style: 'reaper' }).value).toBeLessThan(
      gradeHealerWeapon({ ...potion, consumable: false }, d, { ...opts, style: 'reaper' }).value);
  });
});
