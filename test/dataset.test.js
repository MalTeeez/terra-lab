/**
 * Parity pins against the generated dataset (this pack's mods). Skips when the dataset
 * has not been mined. Values here were cross-checked against the mods' own code; when
 * a mod update changes them, the pin should be updated deliberately, not silently.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { applySeeds, indexDataset } from '../src/lib/dataset.js';
import { weaponDps } from '../src/lib/score.js';
import { craftTree, gatingChain } from '../src/lib/sources.js';
import { ARCHETYPE } from '../src/lib/dps.js';

const path = new URL('../data/dataset.json', import.meta.url);
const has = existsSync(path);
const it = (cond) => (cond ? test : test.skip);
const ds = has ? JSON.parse(readFileSync(path, 'utf8')) : null;
const byName = (n) => ds.items.find((i) => i.name === n);

describe('dataset.json', () => {
  test('a recipe group added by another mod lands on the recipe', () => {
    // InfernalEclipseAPI parks its `EvilSkinRecipeGroup` in a static field, registers it, then adds
    // it to SOTS's Frigid Pickaxe in `PostAddRecipes` — so the pickaxe costs 12 Frigid Bar *and* 6
    // Shadow Scale / Tissue Sample, and is gated behind the evil boss like every other pick 65.
    expect(ds.groups['LimitedResourcesRecipes:EvilSkin']).toEqual(['v:86', 'v:1329']);
    const [recipe] = ds.recipes['SOTS:FrigidPickaxe'];
    expect(recipe[0]).toEqual([['SOTS:FrigidBar', 12]]);
    expect(recipe[1]).toEqual(['LimitedResourcesRecipes:EvilSkin']);
    const pick = ds.items.find((i) => i.id === 'SOTS:FrigidPickaxe');
    expect(ds.stages[pick.stage].label).toMatch(/Eater of Worlds/);
  });
  test('every weapon type the miner emits is one the model knows how to score', () => {
    // `ARCHETYPE` is the only thing the DPS model branches on, so a type it has no entry for would
    // quietly fall back to "fires once per use" — this is the check that a new tag cannot do that
    const emitted = [...new Set(ds.items.filter((i) => i.slot === 'weapon' && i.arch).map((i) => i.arch))];
    expect(emitted.length).toBeGreaterThan(10);
    expect(emitted.filter((a) => !ARCHETYPE[a])).toEqual([]);
  });
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
    // CalamityBardHealer doubles Thorium melee, but `AppliesToEntity` names thirteen swords and nine
    // spears it skips when ThoriumRework is loaded — Titan Sword is one of them, and reading only the
    // hook's `return true` paths used to hand it the ×2 anyway
    // …and WHummus takes the reworked 107 back down to 88 — through a tPackBuilder `.itemmod.json`,
    // which is data inside the .tmod rather than anything in its IL
    expect(ts.changes.map((c) => c.mod)).toEqual(['ThoriumRework', 'ThoriumRework', 'ThoriumRework', 'ThoriumRework', 'WHummusMultiModBalancing']);
    expect(ts.changes.at(-1)).toMatchObject({ hook: 'tPackBuilder', field: 'damage', from: 107, to: 88 });
    expect(ts.damage).toBe(88);
    expect(ts.crit).toBe(16);
    // …while a Thorium melee weapon the hook does not name still gets it
    expect(byName('Bellerose').changes.some((c) => c.mod === 'CalamityBardHealer' && c.field === 'damage')).toBe(true);
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
    // MinPick set in a method the base class calls, not in SetStaticDefaults: 210% is post-Golem,
    // so everything made of Scoria Bars is too (it used to read as a free pre-hardmode block)
    expect(ds.materials['CalamityMod:ScoriaOre'].src).toMatchObject({ kind: 'ore', need: 210 });
    expect(ds.stages[byName('Subduction Slicer').stage].key).toBe('Golem');
    expect(ds.recipes['CalamityMod:SludgeSplotch'][0][1]).toEqual(['Boss2Material']);
    expect(ds.stations['v:tile:134']).toMatchObject({ name: 'Mythril Anvil', boss: 'Wall of Flesh' });
    // a station whose own stage has not resolved yet blocks its recipes rather than reading as
    // pre-boss: SOTS's Transmutation Altar makes Meteorite Bars out of Twilight Gel
    expect(ds.materials['v:117'].src).toMatchObject({ kind: 'craft', from: ['Meteorite'] });
    expect(ds.stages[byName('Star Cannon').stage].key).toBe('EaterOfWorlds');
  });

  it(has && !!ds?.items.some((i) => i.id === 'ThoriumMod:FlightMask'))('shops gate on the seller moving in; player-side flag effects fold into items', () => {
    const fab = ds.materials['ThoriumMod:ArcaneArmorFabricator']; // sold by the Blacksmith, who needs the Eye of Cthulhu
    expect(fab.src).toMatchObject({ kind: 'shop', via: 'Blacksmith', boss: 'Eye of Cthulhu' });
    // the entry's own Condition outranks the seller moving in (the Bandit arrives after Skeletron)
    expect(byName('Celestial Reaper').stageSource).toMatchObject({ kind: 'shop', via: 'Bandit', boss: 'Moon Lord' });
    expect(ds.stages[byName('Flight Hat').stage].key).toBe('EyeOfCthulhu');
    const shell = byName('Mollusk Shellmet'); // CalamityPlayer: if (molluskHelmet) Player.velocity.X *= 0.996f
    expect(shell.effects.velocityDrag).toBeCloseTo(0.996);
    expect(shell.effects.via).toContain('molluskHelmet');
    // a drawback: `player.AddBuff(BuffID.Bleeding, 1020)` behind a coin flip the interpreter cannot
    // settle, so it takes a second linear pass to see it at all
    expect(byName('Bloodstained Coin').effects.selfDebuffs).toEqual(['Bleeding']);
    // `Main.debuff` also holds the station buffs, which cost nothing: The Camper is not a drawback
    expect(byName('The Camper').effects.selfDebuffs).toBeUndefined();
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
    // `{0}` filled from UpdateArmorSet — and rounded the way `CalamityUtils.Round` does, which
    // drops the zero `N1` writes, so this reads exactly as the game prints it
    expect(byName('Mollusk Shellmet').setBonus).toMatch(/^10% increased damage reduction/);
    expect(byName('Mollusk Shellmet').tooltip).toMatch(/^5% increased damage and 4% increased critical strike chance/);
    // `{^N:second;seconds}` picks its arm from format argument N — 10 seconds, but 1 minute
    expect(byName("Beholder's Gaze").tooltip).toMatch(/for 10 seconds\nFor 1 minute afterwards/);
    // Thorium registers a boss's table with a registry of its own from SetStaticDefaults; the rules
    // are in a closure on the NPC type, not in ModifyNPCLoot
    expect(byName('Sonar Cannon').stageSource).toMatchObject({ kind: 'drop', boss: 'Viscount' });
    // same registry for vanilla bosses: the closure is on the GlobalNPC, keyed by the npc id
    // pushed before the delegate (The Stalker is Brain of Cthulhu loot, not a rarity guess)
    expect(byName('The Stalker').sources).toContainEqual({ kind: 'drop', from: 'Brain of Cthulhu' });
    // ThoriumRework picks the cosmetic of whichever boss this is in an `npc.ModNPC.Name == "…"`
    // chain, then adds the local it filled once at the end: each arm belongs to its own boss
    expect(byName('Zephyr Wings').stageSource).toMatchObject({ kind: 'drop', boss: 'The Grand Thunder Bird' });
    expect(byName('Antlion Skewer').stageSource).toMatchObject({ kind: 'enemy', via: 'Antlion' }); // vanilla SpawnNPC: desert, no flag
    // the Antlion's spawn has no downed flag and vanilla spells its conditions out, so the drop is
    // pre-boss whatever tier the mod's rarity would suggest
    expect(ds.stages[byName('Antlion Skewer').stage].label).toBe('Pre-boss');
    // Fire Imps need the Underworld and nothing else — and `enemies` in progression.json is where a
    // vanilla enemy whose real gate is not in the IL (the Lihzahrd needs the temple) gets its floor
    expect(byName('Ashen Stalactite').stageSource).toMatchObject({ kind: 'enemy', via: 'Fire Imp' });
    expect(ds.stages[byName('Ashen Stalactite').stage].label).toBe('Pre-boss');
    expect(ds.stages[byName('Lihzahrd Tail').stage].label).toBe('Plantera');
    // Dark Casters and Cursed Skulls spawn in `ZoneDungeon`, so everything made of Spirit Droplets
    // waits for Skeletron — an override pinning the droplet to pre-boss used to override that
    expect(ds.materials['ThoriumMod:SpiritDroplet'].src).toMatchObject({ kind: 'enemy', gate: 'ZoneDungeon', boss: 'Skeletron' });
    expect(ds.stages[byName('Waterwick Candle').stage].label).toBe('Skeletron');
    // Hallow trees do not exist until the Wall of Flesh is down, and a growing tree leaves no IL
    // behind for the miner to read: `anchors` is the floor for what only the world can hand you
    expect(ds.materials['v:621'].src).toMatchObject({ kind: 'anchor', boss: 'Wall of Flesh' }); // Pearlwood
    expect(ds.stages[byName('Pearlwood Sword').stage].label).toBe('Wall of Flesh');
    // the Skeleton Merchant's Magic Dagger is a Don't Dig Up entry: a world seed is a requirement,
    // not a repeating condition, so in a normal world the Mimic is the source
    expect(byName('Magic Dagger').stageSource).toMatchObject({ kind: 'enemy', via: 'Mimic', gate: 'hardMode' });
    expect(ds.seeds.find((s) => s.key === 'remix').items['v:517'].prog).toBe(0);
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
    // the tree bottoms out: an ingredient with a source of its own is a leaf, whatever it can also
    // be crafted from (the four Lunar fragments make each other, Gold Ore transmutes from Silver)
    const frag = craftTree(indexed, 'v:3458'); // Solar Fragment, staged by the Lunar Events anchor
    expect(frag.recipes[0].ingredients.every((c) => c.node.recipes.length === 0)).toBe(true);
    expect(gatingChain(frag).map((e) => e.node?.name)).toEqual(['Solar Fragment']);
    // and a base resource nothing in the code produces is the base, not a rarity guess
    expect(indexed.materials['v:9'].src.kind).toBe('start'); // Wood
    // a bar is its ore, not the odd enemy that drops one at the same stage
    expect(ds.materials['v:19'].src).toMatchObject({ kind: 'craft', from: ['Gold Ore'] });
    expect(ds.materials['v:19'].drops.some((s) => s.from === 'Gilded Lycan')).toBe(true);
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

// ---- phase coverage: every kind of weapon has to be described, not just the ones that shoot -----
describe('attack phases cover every weapon type', () => {
  const it_ = has ? test : test.skip;
  it_('no archetype is left with nothing describing how it deals damage', () => {
    const indexed = indexDataset(JSON.parse(readFileSync(path, 'utf8'))); // indexing mutates: keep `ds` clean
    const ctx = (w) => ({ conds: new Set(), uncertain: false, prefix: null, calibration: null, ds: indexed, stage: w.stage ?? 0, targets: 'auto' });
    const byArch = new Map();
    for (const w of indexed.items) {
      if (w.slot !== 'weapon' || !(w.damage > 0)) continue;
      const a = byArch.get(w.arch ?? '?') ?? { n: 0, bare: 0 };
      a.n++;
      // the root `primary` phase is the use clock and every weapon has one — it says nothing about
      // what the weapon *does*, so a weapon with only that is one the phase model cannot explain
      const phases = weaponDps(w, ctx(w)).phases ?? [];
      if (!phases.some((p) => p.kind !== 'primary' && (p.projId || p.kind === 'contact' || p.kind === 'minion'))) a.bare++;
      byArch.set(w.arch ?? '?', a);
    }
    // A broadsword deals its damage by touching the target, not by firing: before the swing phase
    // existed, 294 of 395 `swing` weapons had no phase at all and the model could not say a word
    // about the single largest archetype in the pool.
    for (const [arch, a] of byArch) expect({ arch, described: a.n - a.bare > 0 }).toEqual({ arch, described: true });
    const bare = [...byArch.values()].reduce((n, a) => n + a.bare, 0);
    // a pin, not a target: it may only be lowered deliberately
    expect(bare).toBeLessThanOrEqual(30);
  });
});
