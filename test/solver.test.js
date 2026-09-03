import { describe, expect, test } from 'bun:test';
import { indexDataset } from '../src/lib/dataset.js';
import { SOFT, accessoryGroup, defenseScale, foreignClass, minionSlotScale, pieceScore, soft, typicalDps, weaponDps } from '../src/lib/score.js';
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
    // damage for aggro, a runtime formula behind a ModPlayer flag, a summoner slot, a tooltip-only stat
    { id: 'M:taunt', mod: 'M', name: 'Taunt Charm', slot: 'accessory', effects: { damage: { all: 0.15 }, aggro: 400 }, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:ring', mod: 'M', name: 'Formula Ring', slot: 'accessory', placeholders: true, effects: { damage: { classless: 0.3 }, defense: { all: -10 }, via: ['ring'], flags: ['ring'] }, stats: { allDamage: 0.08 }, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:slot', mod: 'M', name: 'Summon Charm', slot: 'accessory', effects: { minionSlots: 1 }, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:textonly', mod: 'M', name: 'Text Charm', slot: 'accessory', stats: { allDamage: 0.1, allCrit: 4 }, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:dogtooth', mod: 'M', name: 'Dogtooth', slot: 'accessory', stats: { rogueStealthDamage: 0.08, rogueStealthArmorPen: 8 }, textClasses: ['rogue'], stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:tboots', mod: 'M', name: 'Traveler Boots', slot: 'accessory', boots: true, effects: { moveSpeed: 0.05, runAccel: 0.02 }, stage: 0, stageSource: { kind: 'rarity' } },
    // on-hit spawns: a spike per stealth strike (rogue only), a flash on any hit with a 5 s cooldown (any class)
    { id: 'M:jewel', mod: 'M', name: 'Jewel', slot: 'accessory', effects: { flags: ['jewel'], onHit: [{ type: 'M:spike', name: 'Spike', damage: 10, cls: 'rogue', stealth: true, pen: 3, life: 80 }] }, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:band', mod: 'M', name: 'Band', slot: 'accessory', effects: { flags: ['band'], onHit: [{ type: 'M:flash', name: 'Flash', damage: 20, cooldown: 300, pen: 1 }] }, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:echo', mod: 'M', name: 'Echo', slot: 'accessory', effects: { flags: ['echo'], onHit: [{ type: 'M:echo', name: 'Echo', share: 0.5, pen: 2 }] }, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:veil', mod: 'M', name: 'Veil Cloak', slot: 'accessory', effects: { defense: { all: 3 }, via: ['VeilCloakAura'] }, stats: { condDefense: 3, condAccel: 0.75 }, condStats: ['defense', 'accel'], stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'v:boots', mod: 'v', name: 'Hermes Boots', slot: 'accessory', effects: { runSpeed: 6 }, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:ocean', mod: 'M', name: 'Ocean Shield', slot: 'accessory', defense: 2, effects: { defense: { all: 5 }, moveSpeed: 0.1 }, condStats: ['defense', 'moveSpeed'], stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:wreath', mod: 'M', name: 'Wreath', slot: 'accessory', effects: { mod: { ThrownVelocity: 0.1 } }, stage: 0, stageSource: { kind: 'rarity' } },
  ],
};

const ds = indexDataset(structuredClone(raw));

describe('score', () => {
  test('weapon DPS uses animation for melee and crit as expected value', () => {
    const r = weaponDps(ds.byId.get('v:sword'));
    expect(r.kind).toBe('dps');
    expect(r.value).toBeCloseTo(20 * 3 * 1.04 * 0.7); // true melee: contact range factor
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
  test('class preferences: aggro is a cost for a rogue and a mild plus for melee, crit counts more for rogues', () => {
    const taunt = ds.byId.get('M:taunt');
    const a400 = soft(Math.sqrt(400), SOFT.aggro) * 0.8; // √400 = 20 on the curve → 9.63 × 0.8
    expect(pieceScore(taunt, 'melee').score).toBeCloseTo(15 + a400 * 0.3, 1);
    expect(pieceScore(taunt, 'rogue').score).toBeCloseTo(15 - a400 * 1.5, 1);
    expect(pieceScore(taunt, 'rogue').parts.find((p) => /aggro/.test(p.label)).value).toBeCloseTo(-a400 * 1.5, 1);
    // −800 aggro is not four times −200: the curve flattens
    const big = { ...taunt, effects: { aggro: -800 } };
    const small = { ...taunt, effects: { aggro: -200 } };
    expect(pieceScore(big, 'rogue').score / pieceScore(small, 'rogue').score).toBeLessThan(1.5);
    expect(pieceScore(big, 'rogue').score).toBeLessThan(13);
    const dog = ds.byId.get('M:dogtooth');
    expect(pieceScore(dog, 'rogue').score).toBe(12); // stealth strikes: 8% in full + 8 armor pen × 0.5
    expect(pieceScore(dog, 'rogue').stealth).toBe(true);
    expect(pieceScore(dog, 'melee').score).toBe(0);
    // an aura: the code's +3 defense at half (it is in the item's condStats), acceleration from the text at half
    const veil = pieceScore(ds.byId.get('M:veil'), 'rogue', {}, { progression: 7 });
    expect(veil.parts.find((p) => /defense/.test(p.label)).value).toBeCloseTo(soft(1.5, SOFT.defense) * 0.5 * defenseScale(7), 1);
    expect(veil.parts.find((p) => /acceleration/.test(p.label)).value).toBe(1.5);
    expect(pieceScore(ds.byId.get('M:tboots'), 'rogue').parts.find((p) => /acceleration/.test(p.label)).value).toBe(1); // +25% acceleration
    // on-hit spawns: 10 dmg × 3 hits per stealth strike (one per 8 s) = 3.75 DPS, against a ~60 DPS weapon at progression 2
    const jewel = pieceScore(ds.byId.get('M:jewel'), 'rogue', {}, { progression: 2 });
    expect(jewel.score).toBeCloseTo((3.75 / typicalDps(2)) * 100, 1);
    // a spawn dealing half the hit, 2 hits, every 3 s: 0.5 × 2 / 3 hits per second / 3 s = 11% of the weapon's DPS
    expect(pieceScore(ds.byId.get('M:echo'), 'melee', {}, { progression: 2 }).score).toBeCloseTo(11.1, 1);
    expect(jewel.stealth).toBe(true);
    expect(pieceScore(ds.byId.get('M:jewel'), 'melee', {}, { progression: 2 }).score).toBe(0);
    const band = pieceScore(ds.byId.get('M:band'), 'melee', {}, { progression: 2 });
    expect(band.score).toBeCloseTo((20 / 5 / typicalDps(2)) * 100, 1); // the code's 300-tick cooldown
    const text = ds.byId.get('M:textonly');
    expect(pieceScore(text, 'rogue').score).toBeCloseTo(10 + soft(4, SOFT.crit) * 1, 1); // 1 point per 1% crit for a rogue (as damage), on the curve
    expect(pieceScore(ds.byId.get('M:wreath'), 'rogue').score).toBeCloseTo(soft(0.1, SOFT.velocity) * 20, 1); // +10% throwing velocity
    expect(pieceScore(ds.byId.get('M:wreath'), 'melee').score).toBe(0);
    expect(pieceScore(text, 'magic').score).toBeCloseTo(10 + soft(4, SOFT.crit) * 0.7 * 1.1, 1);
    expect(pieceScore(text, 'summon').score).toBe(10); // minions cannot crit
  });
  test('defense from a per-class effects table counts, scaled by progression, and formula items are taken at half', () => {
    const ring = ds.byId.get('M:ring');
    const early = pieceScore(ring, 'rogue', {}, { progression: 0 });
    expect(early.parts.find((p) => /damage/.test(p.label)).value).toBe(15); // 30% cap taken at half
    expect(early.parts.find((p) => /defense/.test(p.label)).value).toBeCloseTo(soft(-5, SOFT.defense) * 0.5 * defenseScale(0), 1);
    expect(early.score).toBeLessThan(11);
    const late = pieceScore(ring, 'rogue', {}, { progression: 28 });
    expect(late.score).toBeGreaterThan(early.score); // losing defense hurts less late
    expect(pieceScore(ring, 'melee', {}, { progression: 0 }).score).toBeLessThan(early.score); // melee values defense more
    expect(defenseScale(0)).toBeGreaterThan(2);
    expect(defenseScale(7)).toBeCloseTo(1, 1);
    expect(defenseScale(28)).toBeLessThan(0.7);
    // "+5 defense when submerged", "+10% movement speed while wearing X": the code's value at half, the item's own defense in full
    const ocean = pieceScore(ds.byId.get('M:ocean'), 'rogue', {}, { progression: 7 });
    expect(ocean.parts.find((p) => /defense/.test(p.label)).value).toBeCloseTo(soft(2 + 2.5, SOFT.defense) * 0.5 * defenseScale(7), 1);
    expect(ocean.parts.find((p) => /movement/.test(p.label)).value).toBeCloseTo(soft(0.05, SOFT.moveSpeed) * 25, 1);
  });
  test('the diminishing-returns curve: slope 1 near zero, flat at the cap', () => {
    expect(soft(1, 10)).toBeCloseTo(0.97, 2);
    expect(soft(30, 10)).toBe(10);
    expect(soft(300, 10)).toBe(10);
    expect(soft(-30, 10)).toBe(-10);
    const regen = pieceScore({ id: 'x', slot: 'accessory', effects: { lifeRegen: 20 } }, 'melee');
    expect(regen.score).toBeCloseTo(soft(20, SOFT.lifeRegen) * 1.2, 1); // +20 regen is not +20
    expect(regen.parts[0].detail).toMatch(/Diminishing returns/);
  });
  test("a minion slot is worth a share of the summoner's DPS: huge pre-boss, modest late", () => {
    const slot = ds.byId.get('M:slot');
    expect(pieceScore(slot, 'summon', {}, { progression: 0 }).score).toBe(100);
    expect(pieceScore(slot, 'summon', {}, { progression: 7 }).score).toBe(30);
    expect(pieceScore(slot, 'summon', {}, { progression: 27 }).score).toBe(10);
    expect(minionSlotScale(0)).toBe(1);
    expect(pieceScore(slot, 'melee').score).toBe(0);
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
    expect(ids).not.toContain('v:wings2'); // wings have their own list
    expect(lo.wings.map((a) => a.item.id)).toEqual(['v:wings2', 'v:wings1']);
    expect(lo.boots.map((a) => a.item.id).sort()).toEqual(['M:tboots', 'v:boots']); // a shoe slot counts as boots without a run speed
    expect(ids).not.toContain('v:boots');
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

describe('per-tick velocity drag', () => {
  test('sprintFactor: one Mollusk piece barely shows, the set kills the sprint', async () => {
    const { sprintFactor } = await import('../src/lib/score.js');
    expect(sprintFactor(1)).toBe(1);
    expect(sprintFactor(0.996)).toBeCloseTo(0.988, 2); // 0.0267 / 0.004 = 6.67 of 6.75
    expect(sprintFactor(0.988)).toBeCloseTo(3 / 6.75, 3); // 2.2 < base run speed 3: no sprint at all
  });
});
