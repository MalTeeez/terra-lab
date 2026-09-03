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

describe('parseTooltipStats', () => {
  test('class mechanics in prose become conditional class stats', () => {
    expect(parseTooltipStats('Stealth strikes inflict Crumbling and deal 8% more damage').stats).toEqual({ rogueStealthDamage: 0.08 });
    expect(parseTooltipStats('15% of your throwing damage is duplicated').stats).toEqual({ throwerDamage: 0.15 }); // no condition: the full stat
    expect(parseTooltipStats('Stealth strikes grant 15% critical strike chance to non-stealth strikes for 10 seconds').stats).toEqual({ rogueCondCrit: 15 }); // a timed buff, not the strike itself
    expect(parseTooltipStats('Stealth strikes have +8 armor penetration and deal 8% more damage').stats).toEqual({ rogueStealthArmorPen: 8, rogueStealthDamage: 0.08 });
    expect(parseTooltipStats('Stealth strikes only expend 90% of your max stealth\n6% increased rogue crit chance').stats).toEqual({ rogueCrit: 6 });
    expect(parseTooltipStats('Enemies you hit take 200% more damage from poison').stats).toEqual({});
    expect(parseTooltipStats('Increases rocket damage by 100% and ranged damage briefly stuns enemies').stats).toEqual({});
  });
  test('stats only conditional lines mention are reported, and jump speed is not an extra jump', () => {
    const r = parseTooltipStats('Increased defense by 5 when submerged in liquid\n10% increased movement speed and +1 HP/s life regen while wearing Victide armor');
    expect(r.stats).toEqual({});
    expect(r.conditional.sort()).toEqual(['defense', 'lifeRegen', 'moveSpeed']);
    const u = parseTooltipStats('+4 defense\nIncreased defense by 5 when submerged');
    expect(u.conditional).toEqual([]); // an unconditional line covers it
    expect(parseTooltipStats('12% increased movement and jump speed').flags).not.toContain('jump');
    expect(parseTooltipStats('10% increased throwing velocity').stats).toEqual({ rogueVelocity: 0.1 });
    expect(parseTooltipStats('Enemy hits create an obsidian flash\nThis effect has a 5 second cooldown, but is halved if the flash kills an enemy').stats).toEqual({ cooldown: 5 });
    const veil = parseTooltipStats('The veil slowly follows you, and any player inside it gains 3 defense and 75.0% acceleration');
    expect(veil.stats).toEqual({ condDefense: 3, condAccel: 0.75 });
    expect(veil.conditional.sort()).toEqual(['accel', 'defense']);
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
    expect(r.stats).toEqual({ rogueStealthDamage: 0.05 }); // the stealth line is the rogue's own mechanic
  });

  test('handles "Increases X by N%" phrasing and placeholders', () => {
    const r = parseTooltipStats('Increases melee damage by 12%\nIncreases your max number of minions by 1\n{0}% increased radiant damage');
    expect(r.stats.meleeDamage).toBeCloseTo(0.12);
    expect(r.stats.minionSlots).toBe(1);
    expect(r.stats.healerDamage).toBeGreaterThan(0);
    expect(r.placeholders).toBe(true);
  });
});
