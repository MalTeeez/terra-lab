import { describe, expect, test } from 'bun:test';
import { indexDataset } from '../src/lib/dataset.js';
import { CLASS_PREF, SOFT, dupCapLoss, loadoutBonus, STEALTH_SHARE, TYPICAL_CRIT, W, accessoryGroup, defenseScale, foreignClass, minionSlotScale, pieceScore, round1, soft, typicalDefense, typicalDps, weaponDps } from '../src/lib/score.js';

const MELEE_TANK = CLASS_PREF.melee.tank; // melee counts survivability higher than everyone else
import { CALIBRATION, REACH, STEALTH_RECHARGE, bladeCoverage, bladeLanding, bossSpeed, playerDamage } from '../src/lib/dps.js';
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
    { id: 'v:h4', mod: 'v', name: 'Weak Helmet', slot: 'head', defense: 1, set: ['v:b4', 'v:l4'], setEffects: { damage: { melee: 0.02 } }, setBonus: '2% melee', stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'v:b4', mod: 'v', name: 'Weak Plate', slot: 'body', defense: 1, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'v:l4', mod: 'v', name: 'Weak Greaves', slot: 'legs', defense: 1, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'v:h2', mod: 'v', name: 'Tank Helmet', slot: 'head', defense: 12, stage: 0, stageSource: { kind: 'rarity' } },
    // a rogue set whose stealth is a set bonus, with the other two pieces a stage further on
    { id: 'M:rhead', mod: 'M', name: 'Stealth Hood', slot: 'head', defense: 3, effects: { damage: { thrower: 0.25 } }, set: ['M:rbody', 'M:rlegs'], setEffects: { mod: { rogueStealthMax: 0.9 }, damage: { thrower: 0.3 } }, setBonus: '90 max stealth', stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:rbody', mod: 'M', name: 'Stealth Coat', slot: 'body', defense: 10, stage: 2, stageSource: { kind: 'rarity' } },
    { id: 'M:rlegs', mod: 'M', name: 'Stealth Greaves', slot: 'legs', defense: 8, stage: 2, stageSource: { kind: 'rarity' } },
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
    { id: 'M:sheath', mod: 'M', name: 'Sheath', slot: 'accessory', effects: { mod: { rogueStealthMax: 0.1 } }, stage: 0, stageSource: { kind: 'rarity' } },
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
    { id: 'M:scythe', mod: 'M', name: 'Scythe Charm', slot: 'accessory', effects: { mod: { CritBonusMultiplier: 0.2 } }, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:coin', mod: 'M', name: 'Coin', slot: 'accessory', effects: { mod: { CritBonusDamage: 30 } }, stats: { critFlatChance: 0.5 }, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:belt', mod: 'M', name: 'Belt', slot: 'accessory', effects: { flags: ['dodge'], onHit: [{ type: 'M:cloud', name: 'Cloud' }] }, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:deceit', mod: 'M', name: 'Deceit Coin', slot: 'accessory', stats: { stealthCost: 0.9 }, textClasses: ['rogue'], stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:clump', mod: 'M', name: 'Clump', slot: 'accessory', effects: { spawns: [{ type: 'M:clumpling', name: 'Clumpling', damage: 10, local: 10, life: 90000, seeks: true }] }, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:shieldaura', mod: 'M', name: 'Aura Shield', slot: 'accessory', effects: { spawns: [{ type: 'M:hitbox', name: 'Hitbox', damage: 10, local: 10, life: 700 }] }, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'v:bow', mod: 'v', name: 'Bow', slot: 'weapon', class: 'ranged', arch: 'bow', damage: 10, useTime: 20, useAnimation: 20, crit: 4, useAmmo: 40, shootSpeed: 8, noMelee: true, useStyle: 5, stage: 0, stageSource: { kind: 'rarity' } },
  ],
  ammo: [
    { id: 'v:40', mod: 'v', name: 'Wooden Arrow', kind: 40, damage: 5, stage: 0 },
    { id: 'M:hot', mod: 'M', name: 'Hot Arrow', kind: 40, damage: 25, stage: 0 },
  ],
};

const ds = indexDataset(structuredClone(raw));

describe('score', () => {
  test('weapon DPS uses animation for melee and crit as expected value', () => {
    const r = weaponDps(ds.byId.get('v:sword'));
    expect(r.kind).toBe('dps');
    // a swing at contact range, against the default boss (8 defense eats half a point per point)
    expect(r.arch).toBe('swing');
    expect(r.hit).toBeCloseTo(20 * playerDamage(undefined) - 4, 5); // no dataset: the knob's own fallback
    // …times the swing's reach, what fighting at that reach costs a melee player, and the blade's
    // own landing (the boss drifts while the arc comes round; a blade only just reaching is a tip)
    const risk = r.parts.find((p) => /fights at .* px of the/.test(p.label))?.mul ?? 1;
    const blade = bladeLanding({ D: r.distance, boss: r.boss, vb: bossSpeed(r.boss.progression), reach: REACH.swing, ticks: 20 });
    // …and how much of the fight a blade of that reach is in contact at all. That used to be a flat
    // ×0.85; it is `bladeCoverage` now, which is 1 at the baseline broadsword reach and falls away
    // steeply below it, so the expectation tracks the model's own curve rather than a stale literal.
    expect(r.value).toBeCloseTo(r.hit * 3 * 1.04 * bladeCoverage(REACH.swing) * blade.f * risk * CALIBRATION, 0); // `risk` is the rounded part
    expect(weaponDps(ds.byId.get('M:staff')).kind).toBe('per hit');
  });
  test('piece score reads effects for the class and ignores other classes', () => {
    expect(pieceScore(ds.byId.get('v:emblem'), 'melee').score).toBe(15);
    expect(pieceScore(ds.byId.get('v:emblem'), 'magic').score).toBe(0);
    expect(foreignClass(ds.byId.get('v:mage'), 'melee')).toBe(true);
    expect(foreignClass(ds.byId.get('v:shield'), 'melee')).toBe(false);
  });
  test('crit damage counts as damage on the hits that crit, and never for a summoner', () => {
    const s = pieceScore(ds.byId.get('M:scythe'), 'melee');
    expect(s.parts[0].label).toBe('+20% critical strike damage');
    expect(s.score).toBeCloseTo(20 * TYPICAL_CRIT / (1 + TYPICAL_CRIT), 1); // ≈ 2.6, against 20 for +20% damage
    expect(pieceScore(ds.byId.get('M:scythe'), 'rogue').score).toBeCloseTo(s.score * 1.43, 1); // a rogue crits more
    expect(pieceScore(ds.byId.get('M:scythe'), 'summon').score).toBe(0);
  });
  test('a flat crit bonus is worth its share of a hit, and fades as hits grow', () => {
    const coin = ds.byId.get('M:coin');
    const early = pieceScore(coin, 'melee', {}, { progression: 2 });
    // 30 damage at a 50% chance, on the 15% of hits that crit, against a typical hit at this stage
    expect(early.parts[0].value).toBeCloseTo(((30 * 0.5 * TYPICAL_CRIT) / (typicalDps(2) / 3)) * 100, 1);
    expect(pieceScore(coin, 'melee', {}, { progression: 20 }).score).toBeLessThan(early.score / 5);
    expect(pieceScore(coin, 'summon', {}, { progression: 2 }).score).toBe(0); // summons do not crit
  });
  test('a permanent minion is graded like a small summon weapon, and capped at a minion slot', () => {
    const clump = ds.byId.get('M:clump');
    // 10 damage past half the stage's boss armour, 3 hits/s (10-tick immunity), 90% of the time on
    // the boss and swinging for half of that (nothing reads its AI), against a typical weapon
    const early = pieceScore(clump, 'melee', {}, { progression: 2 });
    const hit = 10 - typicalDefense(2) / 2;
    expect(early.parts[0].value).toBeCloseTo(((hit * 3 * 0.9 * 0.5) / typicalDps(2)) * 100, 1);
    // it never outscores the slot a summoner would have put its own minion in…
    const big = { ...clump, effects: { spawns: [{ ...clump.effects.spawns[0], damage: 200 }] } };
    expect(pieceScore(big, 'melee', {}, { progression: 2 }).score).toBeCloseTo(W.minionSlot * minionSlotScale(2), 1);
    expect(early.score).toBeLessThan(W.minionSlot * minionSlotScale(2));
    // …and a fixed 10 damage is worth nothing by the end
    expect(pieceScore(clump, 'melee', {}, { progression: 20 }).score).toBeLessThan(1);
    // a hitbox that sits on the player is not a minion: it does not chase the boss, so it is not graded here
    expect(pieceScore(ds.byId.get('M:shieldaura'), 'melee', {}, { progression: 2 }).score).toBe(0);
  });
  test('a cheaper stealth strike is more stealth strikes', () => {
    const s = pieceScore(ds.byId.get('M:deceit'), 'rogue', ds.aliases);
    expect(s.stealth).toBe(true);
    // expending 90% of the bar means 1/0.9 as many strikes
    expect(s.parts[0].value).toBeCloseTo((1 / 0.9 - 1) * W.damage * STEALTH_SHARE, 1);
    expect(pieceScore(ds.byId.get('M:deceit'), 'melee').score).toBe(0);
  });
  test('bard armor values its inspiration pool and regeneration', () => {
    const item = { id: 'M:bard-head', slot: 'head', effects: { mod: { bardResourceMax2: 5, inspirationRegenBonus: 0.25 } } };
    const bard = pieceScore(item, 'bard');
    expect(bard.parts.find((p) => /max inspiration/.test(p.label))?.value).toBeGreaterThan(0);
    expect(bard.parts.find((p) => /inspiration regeneration/.test(p.label))?.value).toBeGreaterThan(0);
    expect(pieceScore(item, 'magic').score).toBe(0);
  });
  test('a dodge and an unreadable on-hit spawn still count for something', () => {
    const s = pieceScore(ds.byId.get('M:belt'), 'melee');
    expect(s.parts.map((p) => p.value)).toEqual([W.onHitUnknown, W.dodge * MELEE_TANK]);
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
    // an aura: both stats are state-gated (in condStats), so the bigger counts at 15% and the
    // second — it hangs off the same condition — at a quarter of that
    const veil = pieceScore(ds.byId.get('M:veil'), 'rogue', {}, { progression: 7 });
    expect(veil.parts.find((p) => /acceleration/.test(p.label)).value).toBe(round1(0.75 * 0.15 * 4));
    expect(veil.parts.find((p) => /defense/.test(p.label)).value).toBeCloseTo(soft(3 * 0.15, SOFT.defense) * 0.5 * defenseScale(7) * 0.25, 1);
    expect(pieceScore(ds.byId.get('M:tboots'), 'rogue').parts.find((p) => /acceleration/.test(p.label)).value).toBe(1); // +25% acceleration
    // on-hit spawns: 10 dmg × 3 hits per stealth strike, one strike per 1.6 × the mined recharge,
    // against a ~60 DPS weapon at progression 2
    const jewel = pieceScore(ds.byId.get('M:jewel'), 'rogue', {}, { progression: 2 });
    expect(jewel.score).toBeCloseTo(((10 * 3) / (STEALTH_RECHARGE * 1.6) / typicalDps(2)) * 100, 1);
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
  test('defense from a per-class effects table counts, scaled by progression, and formula items are taken at a quarter', () => {
    const ring = ds.byId.get('M:ring');
    const early = pieceScore(ring, 'rogue', {}, { progression: 0 });
    expect(early.parts.find((p) => /damage/.test(p.label)).value).toBe(7.5); // 30% cap taken at a quarter
    expect(early.parts.find((p) => /defense/.test(p.label)).value).toBeCloseTo(soft(-2.5, SOFT.defense) * 0.5 * defenseScale(0), 1);
    expect(early.score).toBeLessThan(11);
    const late = pieceScore(ring, 'rogue', {}, { progression: 28 });
    expect(late.score).toBeGreaterThan(early.score); // losing defense hurts less late
    expect(pieceScore(ring, 'melee', {}, { progression: 0 }).score).toBeLessThan(early.score); // melee values defense more
    expect(defenseScale(0)).toBeGreaterThan(2);
    expect(defenseScale(7)).toBeCloseTo(1, 1);
    expect(defenseScale(28)).toBeLessThan(0.7);
    // "+5 defense when submerged", "+10% movement speed while wearing X": the code's value at 15%
    // (state-gated), the item's own defense in full; the smaller gated stat at a quarter of that
    const ocean = pieceScore(ds.byId.get('M:ocean'), 'rogue', {}, { progression: 7 });
    expect(ocean.parts.find((p) => p.label === '+2 defense').value).toBeCloseTo(soft(2, SOFT.defense) * 0.5 * defenseScale(7), 1);
    expect(ocean.parts.find((p) => p.label === '+5 defense ⅙').value).toBe(0.1); // second gated stat: quarter weight
    expect(ocean.parts.find((p) => /movement/.test(p.label)).value).toBeCloseTo(soft(0.1 * 0.15, SOFT.moveSpeed) * 25, 1);
  });
  test('a duplicated share of your damage is only worth its cap once your hits outgrow it', () => {
    // "12.5% of your rogue damage is duplicated" + "Duplication damage caps at 50": free while a
    // hit is small, worth cap ÷ hit once it is not (a typical hit is a third of typicalDps)
    const guide = { id: 'g', slot: 'accessory', stats: { rogueDamage: 0.125, rogueDuplicated: 0.125, damageCap: 50 } };
    expect(dupCapLoss(guide, 2, 0.125, 'rogue')).toBe(0); // 50 caps nothing against a 30-damage hit
    expect(pieceScore(guide, 'rogue', {}, { progression: 2 }).score).toBe(12.5);
    const late = pieceScore(guide, 'rogue', {}, { progression: 25 });
    expect(late.score).toBeLessThan(2); // a 2900-damage hit: the copy is a flat 50
    expect(late.parts[0].detail).toMatch(/capped at 50/);
    // the cap can only take back the share that is inside the number being scored
    expect(dupCapLoss({ stats: { rogueDuplicated: 0.175, damageCap: 200 } }, 25, 0.1, 'rogue')).toBeLessThanOrEqual(0.1);
    expect(accessoryGroup({ noStack: 'Guides' })).toBe('nostack:Guides'); // only one Guide at a time
  });
  test('the diminishing-returns curve: slope 1 near zero, flat at the cap', () => {
    expect(soft(1, 10)).toBeCloseTo(0.97, 2);
    expect(soft(30, 10)).toBe(10);
    expect(soft(300, 10)).toBe(10);
    expect(soft(-30, 10)).toBe(-10);
    const regen = pieceScore({ id: 'x', slot: 'accessory', effects: { lifeRegen: 20 } }, 'melee');
    expect(regen.score).toBeCloseTo(soft(20, SOFT.lifeRegen) * W.lifeRegen * MELEE_TANK, 1); // +20 regen is not +20
    expect(regen.parts[0].detail).toMatch(/Diminishing returns/);
  });
  test("a minion slot is worth a share of the summoner's DPS: huge pre-boss, modest late", () => {
    const slot = ds.byId.get('M:slot');
    // a slot is 1/N of the minions' damage, counting the ~3 slots a pre-boss summoner already has
    expect(pieceScore(slot, 'summon', {}, { progression: 0 }).score).toBe(33.3);
    expect(pieceScore(slot, 'summon', {}, { progression: 7 }).score).toBe(18.7);
    expect(pieceScore(slot, 'summon', {}, { progression: 27 }).score).toBe(8.3);
    expect(minionSlotScale(0)).toBeCloseTo(1 / 3, 2);
    expect(pieceScore(slot, 'melee').score).toBe(0);
  });
  test('exclusive groups', () => {
    expect(accessoryGroup(ds.byId.get('v:wings1'))).toBe('wings');
    expect(accessoryGroup(ds.byId.get('v:shield'))).toBe('shield');
    expect(accessoryGroup(ds.byId.get('v:emblem'))).toBeNull();
  });
});

describe('solveLoadout', () => {
  test('weapons are graded with the damage and crit the solved loadout actually carries', () => {
    const lo = solveLoadout(ds, { cls: 'melee', stage: 1, slots: 6 });
    // whatever the solver picked, the bonus is the sum of what those pieces give — not a curve
    const worn = [lo.armor.head, lo.armor.body, lo.armor.legs, ...lo.accessories, lo.wings[0], lo.boots[0]].filter(Boolean);
    if (lo.armor.isSet) worn.push({ item: { effects: lo.armor.head.item.setEffects, stats: lo.armor.head.item.setStats } });
    expect(lo.bonus).toEqual(loadoutBonus(worn, 'melee', ds.aliases));
    expect(lo.bonus.damage).toBeGreaterThan(0.2); // the set bonus and the Warrior Emblem at least
    const w = lo.weapons.find((x) => x.item.id === 'v:sword');
    expect(w.parts.find((p) => /% melee damage from the standard loadout at this stage/.test(p.label)).mul).toBeCloseTo(1 + lo.bonus.damage, 2);
    // …and graded on its own the model falls back to the progression curve, not to nothing
    const alone = weaponDps(ds.byId.get('v:sword'), { ds, stage: 1 });
    expect(alone.parts.find((p) => /loadout carries/.test(p.label))).toBeTruthy();
  });

  test('a gun and its ammo are two picks: the weapon takes the plain round, the ammo is ranked apart', () => {
    const lo = solveLoadout(ds, { cls: 'ranged', stage: 1, slots: 6 });
    expect(lo.weapons[0].ammo.name).toBe('Wooden Arrow'); // not the Hot Arrow it could be holding
    expect(lo.ammo.map((a) => a.item.name)).toEqual(['Hot Arrow', 'Wooden Arrow']);
    expect(lo.ammo[0].gun.id).toBe('v:bow');
    expect(lo.ammo[0].value).toBeGreaterThan(lo.weapons[0].value); // 25 damage a round is worth having
  });

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
  test('max stealth comes from what is worn: a set bonus only in a full set', () => {
    // stage 0: the hood is worn but its coat and greaves are a stage away, so the set bonus that
    // carries the stealth never fires — only the accessory's own 10 counts
    const mixed = solveLoadout(ds, { cls: 'rogue', stage: 0, slots: 6 });
    expect(mixed.armor.head.item.id).toBe('M:rhead');
    expect(mixed.armor.isSet).toBe(false);
    expect(mixed.stealthMax).toBeCloseTo(mixed.accessories.some((a) => a.item.id === 'M:sheath') ? 0.1 : 0, 5);
    // stage 2: all three pieces, so the bonus applies
    const full = solveLoadout(ds, { cls: 'rogue', stage: 2, slots: 6 });
    expect(full.armor.isSet).toBe(true);
    expect(full.stealthMax).toBeGreaterThanOrEqual(0.9);
  });

  test('a rogue prefers functional stealth armor over stronger mixed pieces or a generic set', () => {
    const fixture = structuredClone(raw);
    fixture.items.push(
      { id: 'M:powerhead', mod: 'M', name: 'Power Helm', slot: 'head', defense: 20, effects: { damage: { rogue: 0.8 } }, set: ['M:powerbody', 'M:powerlegs'], setEffects: { damage: { rogue: 0.8 } }, setBonus: '80% rogue damage', stage: 2, stageSource: { kind: 'drop' } },
      { id: 'M:powerbody', mod: 'M', name: 'Power Plate', slot: 'body', defense: 30, effects: { damage: { rogue: 0.8 } }, stage: 2, stageSource: { kind: 'drop' } },
      { id: 'M:powerlegs', mod: 'M', name: 'Power Greaves', slot: 'legs', defense: 25, effects: { damage: { rogue: 0.8 } }, stage: 2, stageSource: { kind: 'drop' } },
    );
    const lo = solveLoadout(indexDataset(fixture), { cls: 'rogue', stage: 2, slots: 6 });
    expect(lo.armor.isSet).toBe(true);
    expect(lo.armor.head.item.id).toBe('M:rhead');
    expect(lo.stealthMax).toBeGreaterThanOrEqual(0.9);
    expect(lo.armorAlternatives.map((a) => a.head.item.id)).not.toContain('M:powerhead');
  });

  test('armorPick wears a runner-up set, and the best one takes its place in the list', () => {
    const lo = solveLoadout(ds, { cls: 'melee', stage: 0, slots: 6 });
    const alt = lo.armorAlternatives[0].head.item.id;
    const on = solveLoadout(ds, { cls: 'melee', stage: 0, slots: 6, armorPick: alt });
    expect(on.armor.head.item.id).toBe(alt);
    expect(on.armorPicked).toBe(true);
    expect(on.armorBestScore).toBe(lo.armor.score);
    expect(on.armorAlternatives.map((s) => s.head.item.id)).toContain(lo.armor.head.item.id);
    expect(lo.armorPicked).toBe(false);
    // a set that is not obtainable here falls back to the solver's own pick
    expect(solveLoadout(ds, { cls: 'melee', stage: 0, slots: 6, armorPick: 'v:nope' }).armor.head.item.id).toBe(lo.armor.head.item.id);
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
