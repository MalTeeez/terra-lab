/**
 * Parity pins against the generated dataset (this pack's mods). Skips when the dataset
 * has not been mined. Values here were cross-checked against the mods' own code; when
 * a mod update changes them, the pin should be updated deliberately, not silently.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { applySeeds, indexDataset } from '../src/lib/dataset.js';
import { craftTree } from '../src/lib/sources.js';

const path = new URL('../data/dataset.json', import.meta.url);
const has = existsSync(path);
const it = (cond) => (cond ? test : test.skip);
const ds = has ? JSON.parse(readFileSync(path, 'utf8')) : null;
const byName = (n) => ds.items.find((i) => i.name === n);

describe('dataset.json', () => {
  it(has)('has the expected shape', () => {
    expect(ds.items.length).toBeGreaterThan(4000);
    expect(ds.stages[0].label).toBe('Pre-boss');
    expect(ds.stages.length).toBeGreaterThan(20);
    expect(ds.prefixes.length).toBeGreaterThan(70);
    expect(ds.loadOrder.at(-1)).toMatch(/InfernalEclipseAPI|WHummusMultiModBalancing/);
  });

  it(has && !!ds?.items.some((i) => i.id === 'CalamityMod:Murasama'))('Calamity values survive the balancing overlays untouched', () => {
    const m = byName('Murasama');
    expect(m.damage).toBe(2200);
    expect(m.changes).toBeUndefined();
    expect(m.class).toBe('melee');
    const auric = byName('Auric Tesla Royal Helm');
    expect(auric.defense).toBe(54);
    expect(auric.effects.damage.melee).toBeCloseTo(0.12);
    expect(ds.stages[auric.stage].label).toMatch(/Yharon/);
  });

  it(has && !!ds?.items.some((i) => i.id === 'ThoriumMod:TitanSword'))('pack balancing is applied in load order', () => {
    const ts = byName('Titan Sword');
    expect(ts.base.damage).toBe(52);
    expect(ts.changes.map((c) => c.mod)).toEqual(['CalamityBardHealer', 'ThoriumRework', 'ThoriumRework', 'ThoriumRework', 'ThoriumRework']);
    expect(ts.damage).toBe(107);
    expect(ts.crit).toBe(16);
  });

  it(has)('vanilla items and Calamity\'s vanilla rebalance', () => {
    expect(byName('Zenith').damage).toBe(310); // 190 in vanilla, InfernalEclipseAPI's VanillaBalanceChanges (config default on)
    expect(byName('Katana').damage).toBe(18);
    expect(byName('Terra Blade').damage).toBe(85);
    const sfh = byName('Solar Flare Helmet');
    expect(sfh.defense).toBe(24);
    expect(sfh.effects.crit.melee).toBe(20); // 26 in vanilla, -6 from CalamityGlobalItem.UpdateEquip
    expect(sfh.setEffects.endurance).toBeCloseTo(0.12);
    expect(byName('Avenger Emblem').effects.damage.all).toBeCloseTo(0.12);
    // Broken Hero Sword is Mothron after all three mechs (1.4.4); the pack's recipe edits also put
    // 3 Souls of Plight (Polaris, 11.01) into True Night's Edge, one bucket past Skeletron Prime
    expect(ds.stages[byName('Terra Blade').stage].key).toBe('NewPolaris');
    expect(ds.recipes['SOTS:ShoeIce'][0][2]).toEqual(['v:tile:114']); // anvil → Tinkerer's Workbench, InfernalEclipseAPI's PostAddRecipes
    expect(ds.stages[byName('Keybrand').stage].label).toBe('Plantera');
  });

  it(has && !!ds?.items.some((i) => i.id === 'CalamityMod:DesertProwlerHat'))('vanilla crafting-station tiles do not collide with item ids', () => {
    // Loom is tile 86; item 86 is Shadow Scale - the set used to land at Eater of Worlds
    expect(ds.stages[byName('Desert Prowler Hat').stage].label).toBe('Pre-boss');
  });

  it(has && !!ds?.items.some((i) => i.id === 'CalamityMod:SludgeSplotch'))('recipe groups, pickaxe power and boss-spawned ores gate the stage', () => {
    const sludge = byName('Sludge Splotch'); // 50 Blighted Gel + any Boss2Material (Shadow Scale / Tissue Sample)
    expect(ds.stages[sludge.stage].key).toBe('EaterOfWorlds');
    expect(sludge.stageSource).toMatchObject({ kind: 'craft', from: ['any Boss2Material (Shadow Scale)'] });
    expect(ds.groups.Boss2Material).toContain('v:86');
    const aer = ds.materials['CalamityMod:AerialiteOre']; // disenchanted (110) until Hive Mind / Perforators, then 65
    // the 110 tile is minable earlier (SOTS's Phantaray drops Seaside Crates with Palladium Bars), the boss that re-enchants it is the floor
    expect(aer.src).toMatchObject({ kind: expect.stringMatching(/^(ore|spawn)$/), need: 65 });
    expect(ds.stages[aer.stage].label).toMatch(/Hive Mind|Perforator/);
    const cryo = ds.materials['CalamityMod:CryonicOre']; // spawned by Cryogen, 180% pickaxe
    expect(cryo.src).toMatchObject({ kind: 'spawn', boss: 'Cryogen' });
    const astral = ds.materials['CalamityMod:AstralOre']; // unminable until Astrum Deus
    expect(astral.src).toMatchObject({ kind: 'ore', gate: 'downedAstrumDeus' });
    expect(ds.recipes['CalamityMod:SludgeSplotch'][0][1]).toEqual(['Boss2Material']);
    expect(ds.stations['v:tile:134']).toMatchObject({ name: 'Mythril Anvil', boss: 'Wall of Flesh' });
  });

  it(has && !!ds?.items.some((i) => i.id === 'ThoriumMod:FlightMask'))('shops gate on the seller moving in; player-side flag effects fold into items', () => {
    const fab = ds.materials['ThoriumMod:ArcaneArmorFabricator']; // sold by the Blacksmith, who needs the Eye of Cthulhu
    expect(fab.src).toMatchObject({ kind: 'shop', via: 'Blacksmith', boss: 'Eye of Cthulhu' });
    expect(ds.stages[byName('Flight Hat').stage].key).toBe('EyeOfCthulhu');
    const shell = byName('Mollusk Shellmet'); // CalamityPlayer: if (molluskHelmet) Player.velocity.X *= 0.996f
    expect(shell.effects.velocityDrag).toBeCloseTo(0.996);
    expect(shell.effects.via).toContain('molluskHelmet');
  });

  it(has)('weapons carry projectile behaviour and ammo', () => {
    const mini = byName('Minishark');
    expect(mini.useAmmo).toBe(97);
    expect(ds.ammoKinds['97']).toBe('Bullet');
    expect(ds.ammo.some((a) => a.name === 'Musket Ball' && a.kind === 97 && a.damage === 7)).toBe(true);
    expect(ds.projectiles['v:14']).toMatchObject({ pen: 1, updates: 1 }); // Bullet
    expect(ds.projectiles['v:1']).toMatchObject({ gravity: true }); // Wooden Arrow
    if (ds.items.some((i) => i.id === 'CalamityMod:WulfrumKnife')) {
      const wk = byName('Wulfrum Knife');
      expect(wk.fire.stealth).toBe(true);
      expect(wk.fire.stealthMods.dmgMul).toBeCloseTo(1.5);
      expect(ds.projectiles['CalamityMod:ContaminatedBileFlask']).toMatchObject({ gravity: true, stealth: true });
      expect(ds.projectiles['CalamityMod:ContaminatedBileFlask'].children[0]).toMatchObject({ type: 'CalamityMod:BileExplosion', where: 'kill' });
    }
  });

  it(has)('prefixes include mined mod prefixes', () => {
    const names = new Set(ds.prefixes.map((p) => p.name));
    expect(names.has('Legendary')).toBe(true);
    expect(names.has('Menacing')).toBe(true);
    if (ds.mods.some((m) => m.id === 'CalamityMod')) {
      const sharp = ds.prefixes.find((p) => p.mod === 'CalamityMod' && p.name === 'Sharp');
      expect(sharp.dmg).toBeCloseTo(0.15);
      expect(sharp.rollsFor).toContain('thrower');
    }
  });

  it(has && !!ds?.items.some((i) => i.id === 'CalamityMod:MolluskShellmet'))('spawns, fishing, world generation and drop conditions stage what used to be a rarity guess', () => {
    const husk = ds.materials['CalamityMod:MolluskHusk']; // Giant Clam, only in hardmode
    expect(husk.src).toMatchObject({ kind: 'drop', boss: 'Giant Clam', gate: 'Hardmode' });
    expect(ds.stages[husk.stage].key).toBe('WallOfFlesh');
    expect(ds.stages[byName('Mollusk Shellmet').stage].key).toBe('WallOfFlesh');
    expect(byName('Mollusk Shellmet').setBonus).toMatch(/^10\.0% increased damage reduction/); // {0} filled from UpdateArmorSet
    expect(byName('Mollusk Shellmet').tooltip).toMatch(/^5\.0% increased damage and 4% increased critical strike chance/);
    expect(byName('Antlion Skewer').stageSource).toMatchObject({ kind: 'enemy', via: 'Antlion' }); // vanilla SpawnNPC: desert, no flag
    expect(ds.stages[byName('Antlion Skewer').stage].label).toBe('Pre-boss');
    expect(byName('Wizard Hat').stageSource).toMatchObject({ kind: 'enemy', via: 'Tim' });
    expect(byName('Feral Claws').stageSource).toMatchObject({ kind: 'bag' }); // Jungle / Bramble crate, fished pre-hardmode
    expect(ds.stages[byName('Feral Claws').stage].label).toBe('Pre-boss');
    expect(byName('Magic Hat').stageSource).toMatchObject({ kind: 'shop', via: 'Traveling Merchant' });
    expect(ds.items.find((i) => i.id === 'ThoriumMod:SpittingFish').stageSource).toMatchObject({ kind: 'fish' });
    expect(byName("Squire's Shield").stageSource).toMatchObject({ kind: 'enemy', via: 'Dark Mage', gate: 'dd2:1' });
    // `Player.InModBiome<T>()` is a gate like a Zone field (SOTS spells the same thing as a
    // get_XBiome property, and the miner has to read both)
    expect(byName('Zephyrous Zeppelin').stageSource).toMatchObject({ kind: 'fish', gate: 'PyramidBiome' });
    // Stars Above's subworld enemies only spawn on a Cosmic Voyage, which is pinned to the mod's
    // first boss — so the Vagrant's own bag, not a voyage, is the earliest 'To Murder'
    expect(ds.stages[byName("'To Murder'").stage].key).toBe('VagrantBoss');
    expect(ds.materials['StarsAbove:StellarRemnant'].prog).toBeCloseTo(2.9);
    // a miniboss is a stage: the Sea King moves in after the Giant Clam and sells the Sand Dollar
    expect(ds.stages.some((s) => s.kind === 'miniboss' && s.label === 'Giant Clam')).toBe(true);
    expect(ds.stages[byName('Sand Dollar').stage].label).toBe('Giant Clam');
    // a vanilla town NPC is the authority on a vanilla item it sells: these have no other source
    expect(ds.materials['v:531'].src).toMatchObject({ kind: 'shop', via: 'Wizard' }); // Spell Tome
    expect(ds.stages[ds.materials['v:531'].stage].key).toBe('WallOfFlesh');
    expect(ds.stages[byName('Death Valley Duster').stage].key).toBe('WallOfFlesh'); // needs a Spell Tome
    expect(ds.materials['v:398'].src).toMatchObject({ kind: 'shop', via: 'Goblin Tinkerer' }); // Tinkerer's Workshop
    expect(ds.stages[ds.materials['v:398'].stage].key).toBe('EyeOfCthulhu');
    // an anchor is a floor: vanilla spawns the Ice Elemental from a site the miner reads unguarded
    expect(ds.stages[byName('Frost Staff').stage].key).toBe('WallOfFlesh');
    expect(ds.stages[byName('Ice Sickle').stage].key).toBe('WallOfFlesh');
    // structure loot: a floor no route undercuts. The pyramid needs the evil boss; the Planetarium
    // chests need a Strange Key, which the Archaeologist only sells after The Advisor (6.9 on the
    // scale — Thorium's Star Scouter ties with it, so the stage label can be either)
    const sands = ds.items.find((i) => i.id === 'SOTS:ShiftingSands');
    expect(sands.stageSource).toMatchObject({ kind: 'structure', via: 'the pyramid' });
    expect(ds.stages[sands.stage].key).toBe('EaterOfWorlds');
    expect(ds.stages[ds.items.find((i) => i.id === 'SOTS:CodeCorrupter').stage].progression).toBeCloseTo(6.9);
    expect(ds.materials['SOTS:HardlightAlloy'].prog).toBeCloseTo(6.9); // not the pre-boss Planetarium Crate
    // Thorium's spawn pool is `if (!hardMode) { …; return; }` + the hardmode half after it
    expect(ds.stages[byName("Hydromancer's Catalyst").stage].key).toBe('WallOfFlesh');
    expect(byName("Hydromancer's Catalyst").stageSource).toMatchObject({ kind: 'enemy', via: 'Submerged Mimic', gate: 'hardMode' });
    const antlion = byName('Antlion Skewer');
    expect(antlion.sources.some((s) => s.kind === 'drop')).toBe(true);
    expect(ds.unresolved.every((u) => typeof u.flag === 'string' && u.count > 0)).toBe(true);
  });

  it(has)('every item builds a crafting tree, including recipes with an ingredient the miner could not read', () => {
    const indexed = indexDataset(JSON.parse(readFileSync(path, 'utf8')));
    for (const it of indexed.items) craftTree(indexed, it.id); // used to throw on a null ingredient
    const nullIng = Object.entries(ds.recipes).find(([, list]) => list.some(([ings]) => ings.some(([iid]) => !iid)));
    if (nullIng) {
      const tree = craftTree(indexed, nullIng[0]);
      const unknown = tree.recipes.flatMap((r) => r.ingredients).find((g) => !g.node.id);
      expect(unknown.node.name).toBe('unknown ingredient');
    }
  });

  it(has && !!ds?.seeds?.length)('special world seeds are off until switched on, then only ever earlier', () => {
    const remix = ds.seeds.find((s) => s.key === 'remix');
    expect(remix.label).toBe("Don't Dig Up"); // remixWorld / RemixSeed / RemixSeedEasymode all group here
    // Mimics spawn before hardmode there; a normal world still says Wall of Flesh
    const glove = byName('Titan Glove');
    expect(ds.stages[glove.stage].key).toBe('WallOfFlesh');
    expect(ds.stages[remix.items[glove.id].stage].label).toBe('Pre-boss');
    for (const s of ds.seeds) {
      for (const [id, v] of Object.entries(s.items)) {
        const node = ds.items.find((i) => i.id === id) ?? ds.materials[id];
        expect(node).toBeTruthy();
        expect(v.prog).toBeLessThan(node.prog);
      }
    }
    const indexed = indexDataset(JSON.parse(readFileSync(path, 'utf8'))); // indexing mutates: keep `ds` clean
    const titan = indexed.byId.get(glove.id);
    expect(applySeeds(indexed, ['remix'])).toBe(true);
    expect(titan.stageLabel).toBe('Pre-boss');
    expect(applySeeds(indexed, [])).toBe(true); // and back off again
    expect(indexed.stages[titan.stage].key).toBe('WallOfFlesh');
  });
});
