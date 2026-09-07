import { describe, expect, test } from 'bun:test';
import { classOf, cleanText, parseTooltipStats } from '../miner/classify.js';
import { archetypeOf } from '../miner/extract/items.js';
import { extractPackBuilder } from '../miner/extract/packbuilder.js';
import { REACH } from '../src/lib/dps.js';

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
    // no condition: the full stat, plus the duplicated share on its own so a cap can be priced against it
    expect(parseTooltipStats('15% of your throwing damage is duplicated').stats).toEqual({ throwerDamage: 0.15, throwerDuplicated: 0.15 });
    expect(parseTooltipStats('12.5% of your rogue damage is duplicated\nDuplication damage caps at 50.').stats)
      .toEqual({ rogueDamage: 0.125, rogueDuplicated: 0.125, damageCap: 50 });
    expect(parseTooltipStats('Stealth strikes grant 15% critical strike chance to non-stealth strikes for 10 seconds').stats).toEqual({ rogueCondCrit: 15 }); // a timed buff, not the strike itself
    expect(parseTooltipStats('Stealth strikes have +8 armor penetration and deal 8% more damage').stats).toEqual({ rogueStealthArmorPen: 8, rogueStealthDamage: 0.08 });
    // Coin of Deceit: a strike that costs 90% of the bar comes round more often
    expect(parseTooltipStats('Stealth strikes only expend 90% of your max stealth\n6% increased rogue crit chance').stats).toEqual({ stealthCost: 0.9, rogueCrit: 6 });
    expect(parseTooltipStats('Stealth generates 10% faster').stats).toEqual({ stealthRegen: 0.1 });
    expect(parseTooltipStats('Enemies you hit take 200% more damage from poison').stats).toEqual({});
    expect(parseTooltipStats('Increases rocket damage by 100% and ranged damage briefly stuns enemies').stats).toEqual({});
  });
  test('critical strike damage is its own stat, not crit chance', () => {
    expect(parseTooltipStats('Increases critical strike damage by 20%').stats).toEqual({ critDamage: 0.2 });
    expect(parseTooltipStats('10% increased critical strike damage').stats).toEqual({ critDamage: 0.1 });
    expect(parseTooltipStats('5% increased critical strike chance').stats).toEqual({ allCrit: 5 });
  });
  test('flat crit bonuses keep the chance that comes with them', () => {
    expect(parseTooltipStats('Critical strikes deal 40 more damage').stats).toEqual({ critFlat: 40 });
    expect(parseTooltipStats('Critical strikes have a 50% chance to deal 30 more damage').stats).toEqual({ critFlat: 30, critFlatChance: 0.5 });
  });
  test('abilities read the same in a conditional line as in a flat one', () => {
    expect(parseTooltipStats('Gives a chance to dodge attacks').flags).toContain('dodge');
    expect(parseTooltipStats('Grants or improves the ability to dodge attacks').flags).toContain('dodge');
    // named debuffs are not a blanket immunity, and fire blocks are not knockback
    expect(parseTooltipStats('Immunity to Poison and Bleeding').flags).toEqual(['debuffResist']);
    expect(parseTooltipStats('Immunity to most debuffs').flags).toEqual(['debuffImmune']);
    expect(parseTooltipStats('Grants immunity to fire blocks').flags).toEqual(['lava']);
    const sulphurous = parseTooltipStats('Attacking and being attacked by enemies inflicts Poisoned for 1 second\nGrants an additional jump that summons a sulphurous bubble');
    expect(sulphurous.flags).toContain('jump');
    expect(sulphurous.debuffs).toEqual(['Poisoned']);
  });
  test('reads the stats a class calls by its own name', () => {
    expect(parseTooltipStats('Reduces damage taken by 17%').stats).toEqual({ damageReduction: 0.17 });
    expect(parseTooltipStats('5% increased symphonic playing speed').stats).toEqual({ bardSpeed: 0.05 });
    expect(parseTooltipStats('15% increased healing speed').stats).toEqual({ healerSpeed: 0.15 });
    expect(parseTooltipStats('Increases whip range by 30%').stats).toEqual({ whipRange: 0.3 });
    expect(parseTooltipStats('You constantly generate a 20 life shield').stats).toEqual({ maxLife: 20 });
    // the sentence can put its percentage last
    expect(parseTooltipStats('After dodging, summon damage and crit chance are boosted by 10%').stats).toEqual({ summonCondCrit: 10, summonCondDamage: 0.1 });
  });
  test('potions: healing, mana, and the clause that shares its line with life regen', () => {
    expect(parseTooltipStats('Increases healing and mana received from potions by 40').stats).toEqual({ potionHeal: 0.4, potionMana: 0.4 });
    expect(parseTooltipStats('Increases mana received from potions by 40').stats).toEqual({ potionMana: 0.4 });
    expect(parseTooltipStats('Reduces healing received from potions by 20').stats).toEqual({ potionHeal: -0.2 });
    expect(parseTooltipStats('Healing Potions are 33% more effective').stats).toEqual({ potionHeal: 0.33 });
    // the potion half used to be eaten by the life regen rule's `continue`
    expect(parseTooltipStats('+2 HP/s life regen and reduces the cooldown of healing potions by 25%').stats).toEqual({ potionHeal: 0.25, lifeRegen: 3 });
  });
  test('stats only conditional lines mention are reported, and jump speed is not an extra jump', () => {
    const r = parseTooltipStats('Increased defense by 5 when submerged in liquid\n10% increased movement speed and +1 HP/s life regen while wearing Victide armor');
    expect(r.stats).toEqual({ condLifeRegen: 2 }); // "+1 HP/s" only while the armour is on: a conditional value, not a stat
    expect(r.conditional.sort()).toEqual(['defense', 'lifeRegen', 'moveSpeed']);
    const u = parseTooltipStats('+4 defense\nIncreased defense by 5 when submerged');
    expect(u.conditional).toEqual([]); // an unconditional line covers it
    expect(parseTooltipStats('12% increased movement and jump speed').flags).not.toContain('jump');
    const victide = parseTooltipStats('5% increased damage reduction\n+5 defense and 10% increased damage reduction while submerged in liquid');
    expect(victide.stats).toMatchObject({ damageReduction: 0.05, condEndurance: 0.1 });
    expect(parseTooltipStats('10% increased throwing velocity').stats).toEqual({ rogueVelocity: 0.1 });
    expect(parseTooltipStats('Enemy hits create an obsidian flash\nThis effect has a 5 second cooldown, but is halved if the flash kills an enemy').stats).toEqual({ cooldown: 5 });
    const veil = parseTooltipStats('The veil slowly follows you, and any player inside it gains 3 defense and 75.0% acceleration');
    expect(veil.stats).toEqual({ condDefense: 3, condAccel: 0.75 });
    expect(veil.conditional.sort()).toEqual(['accel', 'defense']);
    // "up to" is a ceiling on something that scales, not a stat you carry: Necklace of Vexation is
    // worth 30% only at a sliver of health, and the sentry line is 15% only after two minutes
    const vex = parseTooltipStats('Up to 30% increased damage the lower your life is');
    expect(vex.stats).toEqual({ allCondDamage: 0.3 });
    expect(vex.conditional).toEqual(['damage']);
    expect(parseTooltipStats('Your sentries last forever and gain up to 15% damage over the course of 2 minutes').stats)
      .toEqual({ summonCondDamage: 0.15 });
    // damage only a slice of what you fight is subject to, gated on the target instead of on you
    const core = parseTooltipStats("20% increased damage dealt to Old One's Army enemies");
    expect(core.stats).toEqual({ allCondDamage: 0.2 });
    expect(core.conditional).toEqual(['damage']);
    // a class named in the same shape stays that class's conditional stat, and a weapon describing
    // its own attack ("deals … to nearby foes") is not a stat you wear at all
    expect(parseTooltipStats('8% increased damage to all other classes').stats).toEqual({ allDamage: 0.08 });
    expect(parseTooltipStats('Deal 150% damage to up to 2 enemies surrounding the initially hit enemy').stats).toEqual({});
  });
  // one tooltip, one stat, two conditions that are not worth the same: the Galeflame Feather's 5%
  // is a stance you steer, the 18% needs a hit taken first. They stay apart so score.js can price
  // each one, instead of a flat 23% that reads like an unconditional damage accessory.
  test('splits a stat gated two ways on one item into its part-time and state-gated arms', () => {
    const gale = parseTooltipStats('Gain 5% increased damage in the air\nImmunity frames in the air grant an additional 18% increased damage and Swiftness');
    expect(gale.stats).toEqual({ allCondDamage: 0.05, allStateDamage: 0.18 });
  });
});

describe('cleanText', () => {
  test('strips chat tags and colour codes', () => {
    expect(cleanText("[c/F41A31:'There will be blood!']")).toBe("'There will be blood!'");
    expect(cleanText('Curses with [cbuff:CalamityMod/BrimstoneFlames]')).toBe('Curses with Brimstone Flames');
    expect(cleanText('[DAMAGELINE]\nfoo\n\n\nbar')).toBe('foo\nbar');
    // plural marker whose argument never resolved: keep the plural arm
    expect(cleanText('lasts {2} {^2:second;seconds}')).toBe('lasts {2} seconds');
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

describe('archetypeOf', () => {
  const weapon = (item, ...projectiles) => archetypeOf({ useStyle: 5, noMelee: true, shoot: 'p', ...item }, projectiles, item.cls ?? 'melee');

  test('reads every projectile the weapon spawns, not just the one `shoot` names', () => {
    // Sahara Slicers' shape: `shoot` is the right-click bolt, the daggers are spawned in `Shoot`
    const bolt = { pen: 2, life: 300 };
    const blade = { held: true, dc: 'Melee' };
    expect(weapon({ channel: true }, bolt, bolt, blade)).toBe('held');
    expect(weapon({ channel: true }, bolt)).toBe('shot'); // the old answer, from the bolt alone
  });
  test("a held projectile the game calls true melee is at arm's length, not a beam", () => {
    expect(weapon({ channel: true }, { held: true, dc: 'TrueMeleeDamageClass' })).toBe('truemelee');
    expect(weapon({ channel: true }, { held: true, dc: 'Melee' })).toBe('held');
    expect(REACH.truemelee).toBeLessThan(REACH.held);
  });
  test('a whip spawned by a spawner is still a whip', () => {
    // Catalyst's Congealed Duo-Whip: `shoot` is a held spawner whose only job is to lash with two
    // whips of its own. Without the child it read as a beam and out-scored every minion at the stage.
    const lash = { held: true, dc: 'SummonMeleeSpeedDamageClass' };
    const spawner = { held: true, dc: 'Summon', kids: [lash, lash] };
    expect(weapon({ cls: 'summon', channel: true }, spawner)).toBe('whip');
    expect(weapon({ cls: 'summon', channel: true }, { ...spawner, kids: [] })).toBe('held'); // the old answer
    expect(weapon({ cls: 'summon' }, lash)).toBe('whip');
  });
  test('ammo names the weapon before anything it holds does', () => {
    // a charge bow puts a drawn-bow sprite in the player's hands; the damage leaves in the arrow
    expect(weapon({ cls: 'ranged', useAmmo: 40 }, { ai: 20 })).toBe('bow');
    expect(weapon({ cls: 'ranged', useAmmo: 40, autoReuse: true }, { ai: 20 })).toBe('repeater');
    expect(weapon({ cls: 'magic' }, { ai: 20 })).toBe('held');
  });
});

describe('extractPackBuilder', () => {
  // a .tmod entry is anything with a `read()` returning a Buffer
  const tmod = (files) => ({ entries: new Map(Object.entries(files).map(([k, v]) => [k, { read: () => Buffer.from(JSON.stringify(v)) }])) });
  const opts = { modId: 'Pack', itemIds: new Map([['TissueSample', 3212]]), tileIds: new Map([['Anvils', 16]]) };

  test('reads item stat changes, mod items and vanilla alike', () => {
    const { items } = extractPackBuilder(tmod({
      'a.itemmod.json': { Items: ['ThoriumMod/PearlPike'], Changes: [{ $type: 'X.VanillaItemChange, PackBuilder', Damage: 30, UseTime: 22.0 }] },
    }), opts);
    expect(items).toEqual([
      { mod: 'Pack', id: 'ThoriumMod:PearlPike', field: 'damage', to: 30, file: 'a.itemmod.json' },
      { mod: 'Pack', id: 'ThoriumMod:PearlPike', field: 'useTime', to: 22, file: 'a.itemmod.json' },
    ]);
  });
  test('a recipe change needs exactly one CreatesResult and nothing it cannot read', () => {
    const change = { $type: 'X.RemoveIngredient, PackBuilder', Item: 'Terraria/TissueSample' };
    const pinned = { $type: 'X.CreatesResult, PackBuilder', Item: 'ThoriumMod/JestersMask', Count: -1 };
    const one = extractPackBuilder(tmod({ 'r.recipemod.json': { Conditions: [pinned], Changes: [change] } }), opts);
    expect(one.recipes).toEqual([{ mod: 'Pack', result: 'ThoriumMod:JestersMask', method: 'r.recipemod.json', kind: 'removeIngredient', item: 'v:3212' }]);
    // an ingredient condition narrows a set the miner cannot enumerate: applying it anyway would
    // hit every recipe in the game
    const wide = extractPackBuilder(tmod({ 'r.recipemod.json': { Conditions: [pinned, { $type: 'X.RequiresIngredient, PackBuilder' }], Changes: [change] } }), opts);
    expect(wide.recipes).toEqual([]);
    expect(wide.skipped.get('RequiresIngredient')).toBe(1);
  });
  test('a tile swap is a remove and an add, so the stage graph sees both', () => {
    const { recipes } = extractPackBuilder(tmod({
      't.recipemod.json': {
        Conditions: [{ $type: 'X.CreatesResult, PackBuilder', Item: 'ThoriumMod/JestersMask' }],
        Changes: [{ $type: 'X.ChangeTile, PackBuilder', Tile: 'Terraria/Anvils', NewTile: 'ThoriumMod/ArcaneArmorFabricator' }],
      },
    }), opts);
    expect(recipes.map((r) => [r.kind, r.tile])).toEqual([['removeTile', 'v:tile:16'], ['addTile', 'ThoriumMod:ArcaneArmorFabricator']]);
  });
});
