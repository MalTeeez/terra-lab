import { describe, expect, test } from 'bun:test';
import { classOf, cleanText, parseTooltipStats } from '../miner/classify.js';

describe('classOf', () => {
  test('maps damage class names from several mods', () => {
    expect(classOf('Melee')).toBe('melee');
    expect(classOf('TrueMeleeNoSpeedDamageClass')).toBe('melee');
    expect(classOf('RogueDamageClass')).toBe('rogue');
    expect(classOf('BardDamage')).toBe('bard');
    expect(classOf('HealerDamage')).toBe('healer');
    expect(classOf('SummonMeleeSpeed')).toBe('summon');
    expect(classOf('MagicSummonHybrid')).toBe('magic');
    expect(classOf('Throwing')).toBe('thrower');
    expect(classOf('Generic')).toBe('classless');
    expect(classOf('AverageDamageClass')).toBe('classless');
    expect(classOf(null)).toBeNull();
  });
});

describe('cleanText', () => {
  test('strips chat tags and colour codes', () => {
    expect(cleanText("[c/F41A31:'There will be blood!']")).toBe("'There will be blood!'");
    expect(cleanText('Curses with [cbuff:CalamityMod/BrimstoneFlames]')).toBe('Curses with Brimstone Flames');
    expect(cleanText('[DAMAGELINE]\nfoo\n\n\nbar')).toBe('foo\nbar');
  });
});

describe('parseTooltipStats', () => {
  test('reads flat class stats', () => {
    const r = parseTooltipStats('15% increased rogue damage and 15% increased rogue velocity\n+2 max minions\n5% increased critical strike chance\n+4 defense\nImmune to knockback\nAllows flight');
    expect(r.stats.rogueDamage).toBeCloseTo(0.15);
    expect(r.stats.minionSlots).toBe(2);
    expect(r.stats.allCrit).toBe(5);
    expect(r.stats.defense).toBe(4);
    expect(r.flags).toContain('knockbackImmune');
    expect(r.flags).toContain('flight');
    expect(r.classes).toContain('rogue');
  });

  test('ignores conditional and descriptive lines', () => {
    const r = parseTooltipStats('Critical strikes may cause a flaming explosion, dealing 100% damage\nDeals 75% increased damage to enemies above 90% health\nBows fire additional arrows behind you for 50% damage\nStealth strikes have lifesteal, deal 5% more damage\nIncreases melee speed by 100% of the increases received to mining speed');
    expect(r.stats).toEqual({});
  });

  test('handles "Increases X by N%" phrasing and placeholders', () => {
    const r = parseTooltipStats('Increases melee damage by 12%\nIncreases your max number of minions by 1\n{0}% increased radiant damage');
    expect(r.stats.meleeDamage).toBeCloseTo(0.12);
    expect(r.stats.minionSlots).toBe(1);
    expect(r.stats.healerDamage).toBeGreaterThan(0);
    expect(r.placeholders).toBe(true);
  });
});
