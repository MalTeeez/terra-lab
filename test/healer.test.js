import { describe, expect, test } from 'bun:test';
import { DARK_EMPOWER, HEAL_DEMAND, bonusTaken, gradeHealerWeapon, healOutput, healerCategory, healerStyle, healsAllies, isSupport, selfHeal, supportValue, typicalHps } from '../src/lib/healer.js';
import { pieceScore } from '../src/lib/score.js';

const staff = (over = {}) => ({ dc: 'HealerTool', useTime: 20, useAnimation: 20, heal: { type: 1, amount: 4 }, ...over });

describe('healer support model', () => {
  test('only the Support playstyle on the healer turns it on', () => {
    expect(isSupport('healer', { healer: 'support' })).toBe(true);
    expect(isSupport('healer', {})).toBe(false);
    expect(isSupport('magic', { healer: 'support' })).toBe(false);
  });

  test('heal types: allies (1) and allies-and-player (3) reach a team, self (2) and life steal (4) do not', () => {
    expect([1, 2, 3, 4].map((type) => healsAllies({ type }))).toEqual([true, false, true, false]);
  });

  test('bonus healing: all of it by default, capped by healBonusMax, none at a cap of 0', () => {
    expect(bonusTaken({ amount: 4 }, 7)).toBe(7);
    expect(bonusTaken({ amount: 4, bonusMax: -1 }, 7)).toBe(7);
    expect(bonusTaken({ amount: 0, bonusMax: 4 }, 7)).toBe(4); // Rotten Cod's healing orbs
    expect(bonusTaken({ amount: 4, bonusMax: 0 }, 7)).toBe(0);
  });

  test('a cast that costs mana is held to what the bar sustains', () => {
    const free = healOutput(staff(), { progression: 0, bonus: 0 });
    expect(free.casts).toBeCloseTo(3);
    const paid = healOutput(staff({ mana: 10 }), { progression: 0, bonus: 0 });
    expect(paid.limited).toBe(true);
    expect(paid.casts).toBeLessThan(free.casts);
    // …and a cheaper cast buys some of it back
    expect(healOutput(staff({ mana: 10 }), { progression: 0, manaCost: 0.3 }).casts).toBeGreaterThan(paid.casts);
  });

  test('a heal is cast at the weapon\'s effective use time and mana: a reforge counts', () => {
    const bare = healOutput(staff(), { progression: 0 });
    expect(healOutput(staff(), { progression: 0, eff: { useTime: 18, useAnimation: 18, mana: 0 } }).casts).toBeGreaterThan(bare.casts);
    const paid = healOutput(staff({ mana: 10 }), { progression: 0 });
    expect(healOutput(staff({ mana: 10 }), { progression: 0, eff: { useTime: 20, useAnimation: 20, mana: 8.5 } }).casts).toBeGreaterThan(paid.casts);
  });

  test('healing speed reaches healing staffs and hybrids, never a plain radiant weapon', () => {
    const tool = healOutput(staff(), { progression: 0, healSpeed: 0.2 });
    expect(tool.casts).toBeCloseTo(3.6);
    const radiant = healOutput(staff({ dc: 'HealerDamage', damage: 20, heal: { type: 3, amount: 0, bonusMax: 4 } }), { progression: 0, bonus: 3, healSpeed: 0.2 });
    expect(radiant.casts).toBeCloseTo(3);
    // …and a heal riding on a hit reaches an ally half the time
    expect(radiant.delivery).toBe(0.5);
  });

  test('healing past what a team loses flattens out', () => {
    const fast = supportValue(staff({ useTime: 6, useAnimation: 6, heal: { type: 1, amount: 40 } }), 0, { progression: 0 });
    expect(fast.hps).toBeGreaterThan(fast.demand);
    expect(fast.useful).toBeLessThanOrEqual(HEAL_DEMAND * typicalHps(0));
  });

  test('bonus healing is the support healer\'s main stat, and a token solo', () => {
    const lifeGem = { stats: { maxLife: 20, healerHealing: 1 }, effects: { maxLife: 20, mod: { healBonus: 1 } } };
    const solo = pieceScore(lifeGem, 'healer', {}, { progression: 0 });
    const support = pieceScore(lifeGem, 'healer', {}, { progression: 0, playstyle: 'support' });
    expect(support.score).toBeGreaterThan(solo.score * 5);
  });

  test('healing speed is worth nothing to a solo healer and something to a support one', () => {
    const idol = { stats: { healSpeed: 0.18 }, effects: { attackSpeed: { healing: 0.18 } } };
    expect(pieceScore(idol, 'healer', {}, { progression: 7 }).score).toBe(0);
    expect(pieceScore(idol, 'healer', {}, { progression: 7, playstyle: 'support' }).score).toBeGreaterThan(5);
  });
});

describe('healer playstyles', () => {
  test('the playstyle is read off the healer only', () => {
    expect(healerStyle('healer', { healer: 'reaper' })).toBe('reaper');
    expect(healerStyle('healer', { healer: 'dark' })).toBe('dark');
    expect(healerStyle('healer', {})).toBe(null);
    expect(healerStyle('melee', { healer: 'dark' })).toBe(null);
  });

  test('weapons are filed by what they are', () => {
    expect(healerCategory({ cls: 'healer', dc: 'HealerTool', heal: { type: 1, amount: 4 } })).toBe('heal');
    expect(healerCategory({ cls: 'healer', dc: 'HealerDamage', scythe: 2 })).toBe('scythe');
    expect(healerCategory({ cls: 'healer', dc: 'HealerDamage', radiantLifeCost: true })).toBe('dark');
    expect(healerCategory({ cls: 'healer', dc: 'HealerDamage', darkAura: true })).toBe('dark');
    expect(healerCategory({ cls: 'healer', dc: 'HealerToolDamageHybrid', damage: 10, heal: { type: 1, amount: 4 } })).toBe('radiant');
    expect(healerCategory({ cls: 'magic' })).toBe(null);
  });

  test('a reaper\'s scythe heals it for 1 + bonus healing every five soul essence', () => {
    const scythe = { cls: 'healer', damage: 40, useAnimation: 30, scythe: 2 };
    // two swings a second × 2 essence = 4 a second; ÷ 5 × (1 + 4) = 4 life a second
    expect(selfHeal(scythe, { style: 'reaper', bonus: 4, uses: 2 }).hps).toBeCloseTo(4);
    const graded = gradeHealerWeapon(scythe, { value: 100, hit: 50 }, { style: 'reaper', progression: 7, loadout: { healBonus: 4 } });
    expect(graded.value).toBeGreaterThan(100);
    expect(graded.category).toBe('scythe');
  });

  test('the dark gear empowers the weapons that read it, only while it is worn', () => {
    const bolt = { cls: 'healer', damage: 40, useAnimation: 20, darkAura: true };
    const d = { value: 100, hit: 40 };
    const worn = gradeHealerWeapon(bolt, d, { style: 'dark', progression: 7, loadout: { darkAura: true } });
    const bare = gradeHealerWeapon(bolt, d, { style: 'dark', progression: 7, loadout: {} });
    expect(worn.value).toBeCloseTo(100 * (1 + DARK_EMPOWER));
    expect(bare.value).toBe(100);
  });

  test('with no playstyle a healer weapon keeps its DPS untouched', () => {
    const d = { value: 123, kind: 'dps' };
    const g = gradeHealerWeapon({ cls: 'healer', damage: 10, scythe: 1 }, d, { style: null, progression: 7 });
    expect(g.value).toBe(123);
    expect(g.kind).toBe('dps');
  });

  test('a dark piece scores for the dark healer and not by default', () => {
    const tongue = { effects: { flags: ['darkAura'], damage: { healer: 0.1 }, mod: { radiantLifeCost: 2 } }, tooltip: 'Empowers certain radiant attacks with dark energy' };
    expect(pieceScore(tongue, 'healer', {}, { progression: 7, playstyle: 'dark' }).score).toBeGreaterThan(pieceScore(tongue, 'healer', {}, { progression: 7 }).score + 10);
  });
});
