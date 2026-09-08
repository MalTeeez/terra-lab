# Terra Lab


## AI Disclaimer

I did not write most of this app, I had claude work on it. The amount of effort it took to get the rough framework to a reasonable level of parity already took way too long, this would not be a thing if I also had to do that alone.

If you end up reading into the code or some descriptions for some reason, treat it with the typical grain of salt anything AI-generated should get.

I have fixed and covered a lot of edge-cases or weird things mods (and especially the basegamea, huh) do, but expect there to be holes (if it REALLY annoys you feel free to open an issue and if I notice i'll probably look at it).

see below for the AI readme (which is still (mostly) right but obviously annoying to read) v

---

Optimal class loadouts per gamestage for modded Terraria — mined from your own `.tmod` files.

Pick a class and a boss stage and the lab tells you the best armor (full set or mixed pieces),
the top weapons by estimated DPS and a greedy accessory fill, with every score broken down into
the stats it came from. Or view the whole game at once as a timeline of loadout changes. Mark
the gear you own (with its reforge) and solve from that instead; enter a few in-game numbers to
calibrate the model against your pack.

## Working on it

```sh
bun install
bun run mine     # reads enabled.json + tModLoader.dll → data/dataset.json (about 4 s, runs on Node)
bun run dev      # http://localhost:5174
bun run check    # test suite (game-file checks skip when tModLoader is not installed)
bun run build    # → dist/ (serves data/dataset.json as /dataset.json)
```

Svelte 5 + Tailwind 4 + Vite, on Bun. The generated dataset is committed, so the site builds without
the game installed. The miner itself runs under Node (`bun run mine` invokes it): Bun 1.3 segfaults
on the full 78-mod run, Node does not.

## Datasets

The site opens on a start page that asks which dataset to look at: one of the presets we ship
(`PRESETS` in `src/lib/datasets.js`, served out of `data/`) or a `dataset.json` the visitor mined
themselves and dropped on the page. An uploaded one is kept in the browser's Cache API under a URL
that does not exist on the server, so `loadDataset` — on the page and in the timeline worker —
reaches both kinds with one fetch. The choice is remembered in `localStorage` until they come back
to the start page via **Dataset** in the header. Nothing is uploaded anywhere.

Each shipped dataset needs a `<name>.summary.json` beside it (items, stages, content mods, mine date
and the tModLoader / Terraria version it was read from) so the start page can describe it without
pulling all 6 MB; `bun run mine` writes one next to whatever it writes.

With nothing picked yet, `bun run dev` skips the start page and opens on `data/dataset.json`, so the
local loop stays `bun run mine` → reload: the dev server serves that file `no-cache` with an ETag on
its size and mtime, and the timeline worker fetches the same URL, so a reload is the whole story. A
choice you actually make still wins — including a browser-mined one, which then keeps being served
out of the Cache API until you switch back under **Dataset**.

### Mining in the browser

The start page can also mine a pack in the tab: point it at your Mods folder (and/or the Steam
workshop folder) and at `tModLoader.dll`, and it produces the same dataset — byte for byte, verified
against `bun run mine` on the same pack.

Nothing in `miner/` is copied or modified for this. `miner/web/worker.js` runs the real `mine.js`,
with the platform swapped underneath it by five aliases in `vite.config.js`:

| the miner asks for | in the browser |
|---|---|
| `node:fs` | `web/node-fs.js` — the picked files, in memory (`web/vfs.js`) |
| `node:zlib` | `web/node-zlib.js` — never called: `web/tmodpack.js` rewrites each `.tmod` with its entries *stored*, because `readTmod` inflates synchronously and the browser's only inflate is a stream |
| `node:crypto` | `web/node-crypto.js` — md5 for the wiki image path (`web/md5.js`; WebCrypto has no md5) |
| `node:path`, `node:os` | string helpers over those in-memory paths |
| `Buffer`, `process` | `web/buffer.js` as the global — a `Uint8Array` with the reads the CLR parser uses |

Two things decide whether the result matches the desktop: **enabled.json**, which breaks ties in
`loadorder.js` and so decides which balancing mod overlays last (pick the Mods folder and it is used
automatically), and the newest copy of each mod, which `src/lib/mine.js` picks out of a workshop
folder full of old versions. `bun run mine` is plain Node and never goes near any of this.

## The miner

`miner/` is a pure-JavaScript pipeline. No .NET SDK, no decompiler: it reads the mod DLLs itself.

```
.tmod ─▶ tmod.js (container) ─▶ clr/ (PE, ECMA-335 metadata, IL decoder)
                                     │
        extract/interp.js ◀──────────┘   symbolic CIL interpreter (inlining, case tracking, config-aware)
            ├─ items.js        ModItem.SetDefaults → damage, use time, crit, defense, rarity, class
            ├─ effects.js      UpdateEquip / UpdateAccessory / UpdateArmorSet → player stat deltas
            ├─ globals.js      GlobalItem hooks of balancing mods → overrides keyed to other mods' items
            ├─ prefixes.js     vanilla prefix table + every ModPrefix (SetStats, CanRoll, accessory effects)
            ├─ projectiles.js  ModProjectile.SetDefaults + AI traits (gravity k, drag, homing range/speed/inertia,
            │                  pierce, blast radius, children with their damage share, debuffs) + ProjectileID.Sets
            ├─ groups.js       recipe groups (RegisterGroup, ValidItems.Add, vanilla SetupRecipeGroups)
            ├─ tiles.js        ModTile MinPick / Sets.Ore / CanKillTile gates (what a pickaxe can mine, and when)
            ├─ shops.js        NPCShop registrations (mod AddShops / ModifyShop, vanilla NPCShopDatabase, the Travelling Merchant) with conditions
            ├─ flags.js        progression flags as the interpreter sees them (downed*, hardMode, Zone*, events, invasions)
            ├─ spawns.js       where enemies spawn naturally: vanilla NPC.SpawnNPC sites, Old One's Army waves, GlobalNPC.EditSpawnPool
            ├─ fishing.js      fishing catches and crates (vanilla FishingCheck_RollItemDrop, ModPlayer.CatchFish)
            ├─ worldgen.js     chest contents placed at world generation (AddBuriedChest and callers, mod worldgen passes)
            ├─ flageffects.js  ModPlayer code keyed on an item's flag (Calamity's Mollusk slow lives in CalamityPlayer)
            ├─ shoot.js        Shoot / ModifyShootStats → projectiles per use, spread, velocity, stealth paths
            ├─ recipes.js      CreateRecipe … Register → ingredient graph
            ├─ loot.js         ModifyNPCLoot / ModifyItemLoot (mod and global) / OnKill → drops with conditions, bags, ore spawns
            ├─ npcs.js         bosses, minions they spawn, BossChecklist progression values, boss size /
            │                  defense / life / buff immunities (vanilla NPC.SetDefaults + NPCID.Sets)
            └─ vanilla.js      the same for Terraria itself, out of tModLoader.dll
        config.js              the player's ModConfigs/*.json + [DefaultValue] attributes
        loadorder.js           AssemblyRef topological order (balancing mods apply last)
        stage/infer.js         gamestage propagation → data/dataset.json
```

### Where the numbers come from

Everything is read from of compiled code:

- **Item stats** come from each item's `SetDefaults`, evaluated symbolically. Calls into the same
  mod (base classes like Thorium's `BardItem`, Calamity's `BaseWings`) and tModLoader's `Item`
  helpers (`DefaultToRangedWeapon`, `sellPrice`) are inlined, so values set several layers up
  still resolve. `CloneDefaults` inherits the cloned item's stats.
- **Equip effects** come from `UpdateEquip` / `UpdateAccessory` / `UpdateArmorSet`:
  `player.GetDamage<MeleeDamageClass>() += 0.12f`, `maxMinions += 1`, `noKnockback = true`, and
  the mod's own `ModPlayer` fields. Static `readonly` values are read from the class constructor.
- **Pack balancing** comes from every `GlobalItem` hook, in mod load order: `SetDefaults`
  overrides (`item.damage = 50`, `item.defense += 15`), extra `UpdateEquip` / `UpdateAccessory`
  effects, `ModifyWeaponDamage` / `ModifyWeaponCrit` / `UseTimeMultiplier` runtime modifiers.
  The case tracker follows every way these mods pick their targets: `item.type == ItemType<X>()`,
  `mod.Find<ModItem>("X").Type`, `item.ModItem.Name == "X"` (with `Mod.Name` guards),
  `item.ModItem is X`, namespace prefixes, `CountsAsClass<T>()`, `AppliesToEntity` filters.
  Guards on mod configs resolve to your actual `ModConfigs/*.json` (or the `[DefaultValue]`),
  `ModLoader.HasMod` to the enabled list, and classes JIT-gated on absent mods are skipped.
  Guards on difficulty flags (`Main.expertMode`, `CalamityWorld.revenge`, …) become *variants*
  the site applies when you select that difficulty; guards it cannot resolve are kept as
  *uncertain* modifiers, off by default. Each item records `base`, `changes`, `variants`, `mods`.
- **Reforges**: the vanilla 1.4.4 prefix table plus every `ModPrefix` a mod defines, read from
  `SetStats` (Calamity's rogue prefixes, Thorium's bard prefixes, ThoriumRework's magic ones),
  with the classes they roll on from `CanRoll` and accessory effects from `ApplyAccessoryEffects`.
- **Projectiles** come from each `ModProjectile.SetDefaults` (pierce, tile collision, extra
  updates, local immunity frames, hitbox, minion slots, armor penetration) and a walk of its
  AI / OnKill / OnHitNPC: `velocity.Y += k` is gravity with its constant, `velocity *= k` is
  per-tick drag, `Main.player[owner].heldProj = …` marks a projectile the player holds out,
  `velocity = Vector2.Zero` one that parks itself, `Resize` in a Kill is a blast radius,
  `damage = (int)(damage * k)` in OnHitNPC is the pierce falloff. Homing comes out as an object:
  Calamity's `HomeInOnNPC(proj, ignoreTiles, range, speed, inertia)` carries all three numbers,
  a `velocity = (velocity·(N−1) + …)/N` or a `Vector2.Lerp` gives the inertia, and anything that
  merely looks like a seeker gets a pessimistic 300 px range. `NewProjectile` calls (with their
  loop counts) are child projectiles, each with the share of the parent's damage the call passes
  it; `AddBuff` on hit is a debuff; reads of Calamity's `stealthStrike` flag mark stealth-aware
  projectiles. Vanilla projectiles come out of `Projectile.SetDefaults1/2` with the case tracker
  plus an aiStyle table for gravity, and `ProjectileID.Sets` (built by tModLoader's `SetFactory`
  from a default and an `id, value` array) supplies what the case tracker never sees: every yoyo's
  range, top speed and lifetime, and which projectiles are whips.
- **How a weapon works** is one tag per weapon (`arch`), derived from its fields and the projectile
  it fires: `swing`, `shortsword`, `spear`, `yoyo`, `flail`, `boomerang`, `held`, `placed`, `shot`,
  `minion`, `sentry`, `whip`. A held projectile from a weapon that does not `channel` is a stab; one
  that channels is a beam or a drill. The DPS model branches on this and on nothing else.
- **Bosses** get their own table (`dataset.npcs`) for the NPC ids the stages name: width, height,
  defense, max life and the buffs they are immune to, from `NPC.SetDefaults` walked with the case
  tracker (plus `NPCID.Sets.ImmuneToAllBuffs`) for vanilla and from `ModNPC.SetDefaults`
  (`buffImmune[…] = true`) for mods. What a debuff does to the NPC carrying it is a table of its
  own, `miner/stage/debuffs.json`, keyed by buff and never by weapon — those numbers are computed in
  `GlobalNPC.UpdateLifeRegen` at runtime, out of the interpreter's reach, so they come from the
  mods' wikis. A debuff with no entry counts for nothing.
- **What a weapon fires** comes from its `Shoot` / `ModifyShootStats`, run with symbolic
  arguments: every `NewProjectile` is recorded with its type, damage multiplier, velocity
  multiplier, spread (`RotatedBy`, `RotatedByRandom`, `NextFloat`, `Lerp`, `ToRadians`) and the
  loop it sits in (backward branches with their compared bound → count). A `RotatedBy` spread is a
  *fan* — fixed angles a wide boss can catch several of — while `RotatedByRandom` scatters, and the
  model needs the difference. Helper calls inside `Shoot` are counted once per projectile type, not
  once per call site: the same helper reached from five branches (a bard instrument picking one of
  five notes) is one shot, and the miner cannot tell that from a barrage. Calamity rogue
  weapons are split into the normal and the `StealthStrikeAvailable()` path. Vanilla
  multi-shot is read from `Player.ItemCheck_Shoot` keyed on the item type, with a small table
  for the random-count shotguns. Ammo items (`Item.ammo`) form their own list with damage and
  projectile per ammo kind.
- **Vanilla** is harder: `Item.SetDefaults1..5` and `Player.GrantArmorBenefits` /
  `ApplyEquipFunctional` / `UpdateArmorSets` are one giant `switch` / `if` chain each. The case
  tracker follows `switch (type - K)`, `type == N` and `head == X && body == Y && legs == Z`
  comparisons so each store lands on the right item (or armor-slot triple). Stores under a
  nested condition (seed variants) never override the base value.
- **Recipes** follow the fluent `AddIngredient` / `AddTile` / `Register` calls; vanilla's legacy
  `Recipe.currentRecipe` builder is handled separately.
- **Drops** model `ItemDropRule` factories, chained rules (`OnSuccess`), `int[]` option lists
  (including `RuntimeHelpers.InitializeArray` blobs), Calamity's `DropHelper`, treasure bags,
  and `GlobalNPC` hooks keyed by `npc.type`. Drops gated on special world seeds are ignored.
- **Bosses** and their **progression values** come from each mod's BossChecklist registration
  (`LogBoss`, static dictionaries, `ProgressionValue` getters) — one shared scale from King Slime
  (1) to Moon Lord (17) that mods extend. Minions a boss spawns from its own code count as it.

### Gamestage inference

`miner/stage/progression.json` supplies the vanilla bosses, world anchors that code cannot
express (hardmode ores after the Wall of Flesh, souls, Ectoplasm), crafting-station gates,
vanilla pickaxe requirements, vanilla downed flags and zones, keyed chests and the rarity
fallback. `infer.js` then propagates to a fixed point, keeping the earliest evidence per item:

1. anchors and overrides,
2. boss drops (with the drop's own condition: Mollusk Husk from the Giant Clam only in
   Hardmode), boss bags, ore tiles spawned on a boss kill,
3. enemy drops: every way an enemy spawns naturally is a gate alternative and the earliest
   wins — vanilla `NPC.SpawnNPC` sites (`Main.hardMode`, `NPC.downedPlantBoss`, `ZoneDungeon`,
   events like `Main.pumpkinMoon`, `Main.invasionType == N`), the Old One's Army waves
   (`dd2:N`), enemies the bobber spawns, a mod enemy's `SpawnChance` flags and every
   `GlobalNPC.EditSpawnPool` entry; a loot rule's condition (`AddIf(() => downedX, …)`,
   `if (Main.hardMode) loot.Add(...)`) and `Item.NewItem` straight from `OnKill` count too;
   `npc:*` is a drop from any enemy under a flag (an event); a town NPC's own drops follow its
   move-in; a critter item follows the NPC it becomes. An enemy the miner found no gate at all for
   would put its drops at pre-boss; when the item's own mod rates it far above that tier the rating
   is the floor, since a mod's biome enemy is usually gated by something the code does not say
   (a special world seed that genuinely spawns the enemy early is the answer, not a gap, and keeps
   its stage),
4. fishing: `Projectile.FishingCheck_RollItemDrop` and `ModPlayer.CatchFish` (with the helpers
   they call), so crates carry the flags of their roll and their contents follow,
5. chests placed at world generation: `WorldGen.AddBuriedChest` and its callers (the pyramid,
   sky islands, living trees, the temple, the dungeon), gated per `worldgenGates` in the config
   (dungeon → Skeletron, biome chests and the temple → Plantera); a mod's world generation
   (`ModifyWorldGenTasks`, `PostWorldGen`, `GenPass.ApplyPass` and the helpers they call) —
   a chest tile with its own `UnlockChest`, or a hardmode-tier item, keeps its rarity guess as a
   floor (`estimated`) because the code does not say what opens the chest; keyed vanilla chests
   the config lists (Dungeon, Shadow, Biome, Lihzahrd, Calamity's Ancient Treasure Chest),
6. shops: an item a town NPC sells waits for the NPC to move in (mod NPCs: the flags
   `CanTownNPCSpawn` requires; vanilla NPCs: `townNpcs` in the config) and for the entry's own
   condition (`Condition.DownedPlantera`, `Hardmode`, lambdas); the Travelling Merchant's
   stock comes from `Chest.SetupTravelShop`. A shop entry another mod registered (a cross-mod ammo
   dealer stocking Calamity's post-Providence rounds on day one, a vanilla item at Thorium's
   Diverman) is not evidence in either direction — the item's rarity stands, as a ceiling and as a
   floor — while an entry the item's own mod registered is the authority wherever it sells it,
7. ores: an item placing a tile with a `MinPick` (or `Sets.Ore`, or a tile a mod's world
   generation places) is world-generated and gated by
   the earliest pickaxe with enough power — pickaxes come from the same fixed point, so it
   runs in rounds — plus the tile's own `CanKillTile` flags (Astral Ore until Astrum Deus); a
   boss that spawns the tile or an anchor is a floor under that; `pickaxe.worldgenAs` handles
   ores whose world tile is converted by a boss (Disenchanted Aerialite needs 110 until Hive
   Mind / Perforators, then 65),
8. recipes — max over ingredients, recipe groups (earliest member; groups referenced through
   `RecipeGroupID.X` or a mod's static field resolve by the field the registration stored into)
   and the crafting station (mod stations gate on the item that places them), min over
   alternative recipes; a mod's recipe for a vanilla item never makes it later than its rarity,
9. your own research in `miner/stage/sources.json` (`"Mod:Item": { "after": "BossKey", "via":
   "where it comes from" }`), applied like an override — the escape hatch for what the code
   really cannot say,
10. rarity as the last resort (vanilla index or mod rarity class).

Gates are flag lists. `downedX` / `hardMode` / `ZoneX` / `pumpkinMoon` / `invasion:N` / `dd2:N` /
`event:SomeEvent` resolve through `downedFlags` and `zones` in the config and the boss list
(fuzzy: `downedPerforator` finds Perforators, `PostDoG` finds `downedDoG`); `any:X` marks the
alternatives of an OR (the earliest gates), `!X` a block where the flag is false (no
requirement). A flag that does not resolve leaves the evidence behind it unused and is
reported (`unresolved gates: …` at the end of a mine, and in the dataset); answering it in the
config is how the gaps close — never by pinning items.

`node tools/unknown-sources.mjs` writes `data/unknown-sources.md`: the unresolved gates with
what they block, then every equipment item and gating material whose stage is still a guess,
with the code paths the miner did see for it.

`TL_DEBUG_ITEM="name:Sludge Splotch,CalamityMod:AerialiteOre" node miner/mine.js` prints an
item's drops (with conditions), recipes, tile gates, the spawn gates of the enemies dropping
it and the inferred stage.

Each item carries `stage`, `prog` and `stageSource` (`drop`, `bag`, `enemy`, `fish`, `critter`,
`worldgen`, `chest`, `shop`, `craft`, `ore`, `spawn`, `anchor`, `manual`, `override`, `rarity`,
`unknown`). The site shows the source as a tag; **rarity** tags are the ones worth
double-checking — look for the unresolved gate or the code path the miner does not read yet.

### Options

```sh
bun run mine -- --only CalamityMod,ThoriumMod   # subset of enabled.json
bun run mine -- --skip CalamityModMusic
bun run mine -- --tmod path/to/Mod.tmod --tmod path/to/Other.tmod
bun run mine -- --tml "D:/Steam/steamapps/common/tModLoader/tModLoader.dll"
bun run mine -- --list                           # what would be mined
TML_SAVES=… STEAM_DIR=… bun run mine             # non-default install paths
TL_DEBUG_ITEM=CalamityMod:Murasama bun run mine  # print one item's overlays, drops and recipes
```

Mods resolve from tModLoader's save folder, `…/Terraria/tModLoader/Mods/enabled.json`: the local
`Mods/` folder first, then the Steam workshop (newest version folder). `defaultPaths()` guesses the
Windows locations; anywhere else, give it `TML_SAVES` and `STEAM_DIR`.

## The site

### Effective stats

A weapon's numbers go through a visible chain, shown on its item card:

```
mined base → balancing overlays (load order) → difficulty variants → runtime modifiers
           → reforge prefix → calibration factor
```

A balancing overlay is anything another mod does to an item it did not make. Most of it is code —
`GlobalItem.SetDefaults`, `PostAddRecipes` walking `Main.recipe` — but a pack built on **tPackBuilder**
ships its changes as `.itemmod.json` and `.recipemod.json` files inside the .tmod instead, and those
are read too (`miner/extract/packbuilder.js`). Nothing in the IL mentions them, so a miner that only
reads code would miss the whole balancing layer: in this pack that is 608 item stat changes, 554 of
them damage.

Recipe edits carry recipe groups too: a mod may register `new RecipeGroup(…, ShadowScale, TissueSample)`
into a static field and later add it to somebody else's recipe by that field, which is how SOTS's
Frigid Pickaxe ends up costing 12 Frigid Bar *and* 6 Shadow Scale / Tissue Sample and being gated
behind the evil boss.

Difficulty flags found in the pack appear as toggles under *Options*; "Apply uncertain modifiers"
(same panel) includes the ones whose in-code guard the miner could not resolve. Whatever is on
shows up as a chip in the *Active* strip under the controls, and clicking the chip turns it off.

### Solver

Scores are sums of labelled parts so the UI can always say why:

| part | points |
| --- | --- |
| +1% class damage (or all-class) | 1 |
| +1% crit | 0.7 (rogue 1.0, the same as damage; ranged ×1.2, magic ×1.1; summoner 0) |
| +1% attack speed | 0.6 (all-class attack speed only swings melee; class-keyed applies to its class) |
| +1 defense | 0.5 × `defenseScale` (×2.1 pre-boss, ×1 at Wall of Flesh, ×0.67 at the end; melee ×1.25) |
| +1 minion / sentry slot (summoner) | 100 / 30 × `minionSlotScale` (a minion slot is 1/N of DPS: about 33 pre-boss, 19 at WoF, 11 at Moon Lord) |
| +1 max inspiration (bard) | 1.5 before diminishing returns; inspiration regeneration is worth up to 10 points |
| aggro | 0.8 per √unit (80 → 7, 400 → 16) × class sign: melee +0.3, rogue −1.5, summoner −1.3, others −1 |
| class mechanic in text ("Stealth strikes deal 8% more damage", "15% of your throwing damage is duplicated") | the damage / crit / armor pen at half, only what the mined effects do not already cover |
| wings | 10 + flight time (ticks) × 0.04 + (top speed − 6) × 2, from the mined `WingStats`; a flight booster (Soaring Insignia) is a flat 5 |
| boots | run speed 2 (+1 per unit above Hermes); boots have their own tab like wings |
| knockback immunity 1.5, dash 2 (its reach is not mined), extra jump 3, jump speed 1, debuff immunity 5, … | flat |
| +25% acceleration | 1 (from the code's `runAcceleration` delta or the text) |
| stealth strike bonuses (rogue) | in full, and the item is tagged *stealth* |
| a projectile spawned on hit (Scuttler's Jewel's spike, Black Glass Band's flash) | graded like a small weapon: the code's base damage (or its share of the hit that spawned it) × hits per spawn (pierce, life ÷ immunity frames) ÷ seconds per trigger (a stealth strike every 8 s, a plain hit every 3 s, or the cooldown the code or tooltip states) × the gate (a critical hit ~15%, a `NextBool` chance), as a share of a typical weapon's DPS at the stage, capped at 15 |
| +10% throwing velocity (rogue) | 2 |

Stats that stop helping past a point run through `soft(x, cap)` — slope 1 near zero, an
ease-out cubic that flattens to the cap by three times it: crit (cap 25%), attack speed 25%,
movement speed 30%, damage reduction 20%, life regen 8, max life / mana 100, armor pen 25,
defense 12 (accessories only; armor is linear), throwing velocity 30%, inspiration 10,
inspiration regeneration 50%, √aggro 10, flight time 200 ticks. Damage stays linear.
A pill's hover box says when the curve took something off.

`CLASS_PREF` in `src/lib/score.js` holds the per-class multipliers. The IL-mined effects are the
truth when they have a stat; the tooltip-parsed value only fills in what the miner could not
read. An item whose tooltip has `{0}` placeholders *and* whose effects go through a ModPlayer
flag ("damage based on defense") is a runtime formula — the constants read from it are its caps,
so they count at half. A stat that only *conditional* tooltip lines mention ("+5 defense when
submerged") is read from the code without its guard, so it also counts at half. An aura projectile named after an item (Sand Cloak → SandCloakVeil) is
walked too: what its AI does to players inside it is the item's conditional effect.

Wings are ranked in their own tab (everyone wears one pair, so they never compete for a slot);
the accessory grid lists every scoring accessory, the solver's picks first, and scrolls past the
number of rows set under *Options → Accessory rows*.

**Potions** are graded the same way, and by the same `pieceScore` — a buff is a stat bonus that
happens to run out. A potion sets nothing but a buff id, so its stats are the buff's: vanilla's
come out of the `Player.UpdateBuffs` if-chain (walked with the case tracker keyed on
`buffType[i]`, so every store lands under the buff it is guarded by), a mod's out of
`ModBuff.Update` — and where that only sets a ModPlayer flag, what the flag does is folded in like
it is for gear. Two potions granting the same buff are one pick, so the panel keeps the earliest.
A buff nothing in the score model reads (a spelunker, a fishing potion) scores 0 and is listed as
*utility*.

A potion is often a **trade**, and the drawback is mined the same way the bonus is: Conflagration
Potion's +15% damage costs 5 life regen (`if (Destabilized || conflagrate) lifeRegen -= 5` in
Thorium's player code), so it nets 10 for a rogue and 3 for melee, which counts survivability
higher. Where only the text says it, the tooltip parser reads the clause after the turn — `but`,
`at the cost of` — as what the item takes back rather than as a second bonus, so Purple Haze's
"−25% stealth strike damage" lands on a rogue and the item drops off the list it used to lead.
A trade that no longer pays is not a recommendation, so the panel shows what scores and the pure
utility ones, and nothing in between.

Weapons rank by **Real DPS** (`src/lib/dps.js`), damage per second against the boss fought next,
swung by the loadout the solver just picked — its class damage and its crit, summed from the armour,
the set bonus, the accessories, the wings and the boots (`loadoutBonus`). Graded outside a loadout
(the item browser with nothing solved) a weapon falls back to a progression curve instead.

```
value = hits/s × damage per hit × crit × sustain × risk  +  debuff DPS
```

The target is real: the NPCs a stage lists carry their mined `width`, `height`, `defense` and buff
immunities (`dataset.npcs`), so a hit is `damage − defense/2 + armor pen/2` and a debuff only counts
when that boss is not immune to it. A mod boss whose immunity table lives in a data structure the
interpreter cannot walk (Calamity's) counts as immune to everything — the pessimistic answer, and
usually the right one. *Scored against* in the header picks which boss that is: the default is the
one you fight next at the gamestage, and choosing another shows how a weapon holds up against it —
a wide, slow, many-segment worm rewards very different weapons from a small, fast, armoured one.

**Hits per second** start from what kind of weapon it is. The miner tags every weapon with an
*archetype* — decided by mined fields, never by an item's name — following the wiki's weapon-type
lists:

| class | types |
| --- | --- |
| melee | `swing` (broadswords) · `shortsword` · `specialsword` · `spear` · `yoyo` · `flail` · `boomerang` |
| ranged | `bow` · `repeater` (a bow with `autoReuse`) · `gun` · `launcher` · `flamethrower` |
| magic | `shot` · `held` (beams, drills, the Arkhalis) · `truemelee` (a held blade: the game's own `TrueMeleeDamageClass`) · `placed` (rain clouds, mines) |
| summon | `minion` · `sentry` · `whip` |
| rogue | `bomb` · `boomerang` · `dagger` · `javelin` · `spikyball` |

Wands, magic guns and spell tomes stay one tag, because nothing downstream would branch on the
difference — a name is not a mechanism. The rogue split is mechanical: a `bomb` has a blast radius
or dies into a child that does, a `spikyball` comes to rest on the ground and waits to be walked
into, a `javelin` sticks in what it hits. What a weapon *is* comes from every projectile it spawns
when used, not only from the one `Item.shoot` names — a weapon whose real attack is spawned in
`Shoot` would otherwise read as whatever its right-click happens to be.

`ARCHETYPE` in `src/lib/dps.js` is the one place each type is described, and the model reads it
rather than testing the tag anywhere else. Each type says what clock its hits come off: `use` (the
animation), `flight` (only one is out at a time — a boomerang is gone until it returns, so the round
trip is the rate and the use time is only a floor under it), `contact` (the projectile's own
immunity clock times the share of the fight it stays on the boss) or `slot` (a summon, paid for in
minion slots). A whip is scored for the mark it leaves rather than its own lash: what it is worth is
the tag every minion hit then carries, and that is a fixed number of minion hits rather than a
multiplier on the lash — what the minions add does not depend on how many projectiles the whip
throws. A broadsword swings on its *animation*, which is not always the clock what it fires comes
off: a sword whose `useTime` outruns its animation still swings every animation and merely drops its
star less often.

**How much of it lands** is one story, told at the distance the fight actually happens at. `ENGAGE`
is how far from the boss a class would *rather* stand (260 px for melee up to 420 px for summoner,
with a playstyle toggle under *Options*) and nothing about any weapon; what pulls the player in is
the weapon's own reach — its type's (`REACH`) and its projectile's. The gap between the two is what
`RISK` prices, for every class including melee, because "you must stand next to the boss" is exactly
what the guides' `†` mark means and a melee player with a yoyo is not taking that risk.
A whip's lash, a spear's thrust, a minion and a sentry are *attached* — swung or placed at the boss
rather than thrown at it — so none of the flight terms below applies to them; they reach as far as
their `REACH` says and no further:

```
aim       a random spread lands the share of its cone inside the boss's silhouette; a fan puts its
          shots at fixed angles, so a wide boss catches several and a narrow one catches the middle
travel    the boss moves while the shot flies: size / (size + speed_boss × flight ÷ 2)
homing    range, turn speed and inertia read from the AI: a seeker that can correct more lateral
          error than the boss can create cancels the lead; one slower than the boss never catches it
gravity   the arc drops ½·k·t² against the boss's height, with k read from `velocity.Y +=`
range     life × speed with the per-tick drag integrated: short of the distance is zero, and a
          weapon used at the very edge of its reach keeps half
walls     ×1.05 for projectiles that ignore tiles
```

`shootSpeed` is a *launch* speed, and under 4 px/tick it is not a cruising speed at all but a
projectile whose AI takes over the moment it exists — a scythe that accelerates from 0.2, a summoned
knife that homes from 1. Below that floor the number is treated as unread, like an absent
`shootSpeed`, rather than charging the weapon six hundred ticks of travel lead.

**Hits per landed projectile** are the part that separates a weapon that really does hit a lot from
one that only looks like it. Pierce on its own buys nothing: a projectile hits again only once its
immunity frames have run out *and* it is still both alive and inside the target, so the count is

```
1 + time on target / immunity      time on target = min(life left on arrival,
                                                       how long it takes to cross the silhouette)
```

A projectile moves once per *update*, and `extraUpdates` buys it several updates a game tick — so
extra updates make a shot arrive sooner without making it travel further, and they spend its
lifetime proportionally faster in real time. `timeLeft` and a local hit cooldown are both counted in
updates, the boss's movement in ticks, and the model keeps the two clocks apart.

which is why lifetime matters twice — a long flight eats the very life the projectile needed for its
extra hits. A slow, lingering, high-pierce projectile racks up hits; a fast one that clips the boss
once and expires does not, however many targets it could in principle pierce. The extra hits are
also conditioned on the landing chance a second time: the first hit is what the aim already paid
for, every one after it needs the boss to still be in the projectile's path, which a homing
projectile manages and a dumb one thrown across a room mostly does not. A worm multiplies by the
segments in the path; a spear or boomerang hits out and back.

**And the whole weapon shares one clock.** A projectile that sets no immunity of its own goes
through the player's own invincibility window on that NPC — and so does the swing itself — so
everything a weapon throws shares one 10-tick cooldown and it cannot land more than six hits a
second on one part, however many shots or pierces it has. Local immunity is what buys a weapon out
of that, which is why the weapons that really do hit a lot have it. This is the ceiling that stops a
fast sword with a free wall-piercing bolt from outscoring a real multi-hit weapon.

A weapon with a right click has *two* attacks, and the miner reads which one fires each shot from the
`player.altFunctionUse` branch in `Shoot` — the same way it reads Calamity's stealth guard. The model
grades the clicks separately and the weapon is worth its **better** one: two attacks the player
chooses between are not two that happen at once. Stealth is the exception and stays additive, because
stealth builds back while you throw. An on-hit child that the *other* click throws is ammunition this
attack is stocking rather than damage it is dealing, so a weapon that collects on one button and
spends on the other is not paid twice for the same projectile.

Spawned children are read with the damage share the code passes them (`dmgMul`) and conditioned on
the parent — on-hit children only exist if the parent hit, an on-death child helps a miss only when
the blast is wider than the boss — and capped at `CHILD_CAP` extra hits, because the miner reads
what a child does but not how often it may spawn. A child spawned with a *number* for its damage is
its own weapon rather than this one's DPS, and one spawned with `0` is not damage at all — a third
of the children in the pool are sparkles, splatters and bells. Past `DMG_MUL_MAX` a share stops
being a share: Calamity pays a projectile fifteen times the weapon's damage precisely because it is
one branch in ten, and the linear machine cannot see which branch runs. Where `Shoot` picks between
alternatives the miner cannot resolve, the weapon fires the average of them rather than whichever
scores best.

A weapon that shoots but whose `shootSpeed` the miner could not read is flown at
`SHOOT_SPEED_UNKNOWN` rather than exempted from all of this — skipping the landing model would be
the most optimistic answer available, not the pessimistic one. And the class's engagement distance
is a ceiling, not a requirement: a player does not stand where their weapon cannot reach, so a
short-ranged weapon is scored from as close as it needs and pays the risk of standing there,
instead of scoring zero.

A gun and its ammo are two picks a ranged player makes separately, so they are ranked apart. The
weapon takes the *plain* round of its kind and is tagged with it — an `AmmoID` constant is the item
id of the ammo it is named for (`Bullet` is 97, the Musket Ball; `Arrow` is 40, the Wooden Arrow), so
that needs no table — and each ammo is graded by handing the best gun of its kind that round, listed
inside its own kind because a rocket and a musket ball are not alternatives. A close-range
archetype costs a class that would rather not stand there (`RISK`) — the guides' † mark, as a rule
rather than a list.

A weapon paid for out of a bar spends it against what comes back, at the rate it is actually fired,
and the *tightest* pool governs: mana against the stage's regen plus potions, SOTS's void bar,
health for the weapons that cost it, and Thorium's thrower exhaustion — `useTime × 2` a shot against
a bar of 1200 that refills at 1/tick, which works out to a flat half duty cycle for every one of
the 41 non-consumable Thorium throwers however fast they swing.

A charge weapon's clock is not its use time. Where a projectile switches its own `friendly` on
partway through its life (`projectile.windup`) it is out and harmless while the button is held, so
the wind-up is added in front of every shot rather than being invisible.

A summoner wears a whip *and* minions *and* a sentry, so a summon weapon is tagged with the slot it
fills rather than ranked against the other two — whips out-DPS the minions they exist to buff. What
a weapon is comes from what it puts into play: `SummonMeleeSpeedDamageClass` is Terraria's own word
for whip damage, and it is read through a spawner (a held projectile whose only job is to lash with
whips of its own).

Calamity rogue weapons get two numbers that add up. *Spam* is the normal attack; *stealth* is one
stealth strike per 5 s with the multiplier Calamity computes from max stealth (read from the chosen
armor), the weapon's use time and its own `StealthDamageMultiplier`, on the projectiles of the
stealth path. Stealth builds back on its own, so the strike lands on top of the throwing rather
than instead of it; the bigger of the two names the grade the way the guides do, and the item card
shows both halves. Armor compares the best full set (pieces + set bonus) against the best loose
pieces; for rogue, an obtainable full set that supplies maximum stealth is a prerequisite, since
loose pieces cannot enable the class's stealth strikes. Accessories fill the slot count greedily, one per exclusive group (wings, boots, shield,
dash), skipping anything whose bonuses target another class. Where a mod applies its numbers
through flags on its own `ModPlayer`, the tooltip is parsed as a fallback (`15% increased rogue
damage`), conditional lines excluded.

**Reforges** default to "assume the best prefix" for every candidate (the prefix that maximises
DPS or class score among those the item can roll); items you mark as owned keep the prefix you
give them.

### Browsing items

*Items only* (and the panel under every loadout) is a filter column plus one card per item, each
scored for the class and gamestage in view — the same numbers the solver uses, so nothing is
ranked twice.

The column holds the context (what the scores are for), a sort control, and collapsible groups:
slot, class (with the best value in each), gamestage and score as two-handle ranges, features
(wings, dash, stealth strikes, on-hit spawns, pierce, …) as an icon list, source, and mod. Every
count is computed with that group's own selection ignored, so a checkbox never reads zero because
of itself. Above the results, a strip of neighbouring gamestages shows how many items each adds
and jumps the whole view there, and *Columns* folds any of the table's columns away (Mod is folded
by default). The feature icons come from Lucide and are declared once, in
`src/components/FeatureIcon.svelte`, which is also the list of what counts as a feature.

Results are one aligned table, a row per item: name, mod, slot, class (in the class's colour),
where it becomes obtainable (the stage in its era's colour, then the evidence tag), damage / use /
crit / defense, its feature icons, and a bar with the score or DPS. Nothing repeats the column's
own name, and tags sit at the right edge of their cell so they line up down the page. Clicking a
row expands it into a bordered panel with headed columns: *Details* (the item drawn the way the
game draws it — sprite, name in its rarity colour, the stat lines Terraria itself prints, the
tooltip and what it sells for — beside the numbers the lab reads), *Real DPS* / *Score*,
*Sources*, and *Effects* for gear. Weapons keep their damage chain and what they fire in one
tab. The tab row also carries own / pin / exclude, the item's wiki and the full panel. Column
headers sort.

A range filter's handles are the comparison they stand for — `›` keeps what is above it, `‹` what
is below — and each carries its value above it, prefixed `≥` or `≤` while it is actually cutting
something off and dimmed when it is not. Two handles close together stack their labels instead of
overlapping.

A crafting tree in the browser carries its own zoom (`−` / `%` / `+`, the percentage resets it)
and opens full size in the same popover the item panel uses.

Section filters work the same way in the loadout view: armor, weapons and accessories each have a
text box and a *traits* dropdown listing what is actually in that list (`src/lib/traits.js`).

### My gear

Tick "I own this" on any item card (or add items in the *My gear* panel), set its reforge, pin it
(always in the loadout) or exclude it (never picked). *Options → Gear pool → only what I own* solves
from that list alone; the loadout tags picks that are yours.

### Calibration

The *Calibrate* panel takes weapons with the damage the game shows in their tooltip (ideally on a
naked character, otherwise enter your bonus damage / crit so they are divided out). Each sample
yields observed ÷ predicted; the median per class becomes a factor applied to every prediction of
that class, and the residual per sample shows which items the model still gets wrong — those are
the ones whose modifiers live somewhere the miner does not look yet.

### Effects that live in the player code

`UpdateEquip` / `UpdateArmorSet` often only raise a flag on the mod's ModPlayer
(`molluskHelmet = true`); the actual effect sits in the player's update hooks
(`if (molluskHelmet) Player.velocity.X *= 0.996f`). `flageffects.js` walks every ModPlayer
method, opens a tagged region at each `if (<bool field or property>)` and attributes the stat
changes inside to that flag; `mine.js` folds them into the items that set the flag (the item
card lists the flags under `via`). Negative numbers count against the piece in the score; a
per-tick `velocity.X *= k` becomes `velocityDrag` (k per tick, the run clamp refills speed every
tick, so the sustained loss is about 1 − k of top speed).

### Crafting trees

Besides equipment the dataset carries `materials` (every item reachable from equipment through
recipes, groups and pickaxe gates, with their stage and evidence), `recipes`, `groups` and
`stations`. The item card's *How to get it* section (`src/lib/sources.js`, `CraftTree.svelte`)
renders the tree: each node shows its stage, why it is obtainable then (dropped by, chest,
pickaxe needed, crafting station, …), the recipe the inference chose with the gating parts
tagged in orange, alternatives on demand, and group members (`any Boss2Material` → Shadow
Scale or Tissue Sample).

## Checking against the class-setup guides

When a weapon's number looks wrong, `docs/debugging-the-scoring-model.md` is the method: how to
reproduce a score from its own parts list, the bug classes that actually turn up (units, a
time-varying field folded to its spawn value, a renamed hook, a guard dropped from a conditional
read), how to narrow a rule on facts the record already carries instead of a skip-list, and which of
the four instruments — tests, the guide gate, the in-game trials, the sweep — settles what.
`docs/rework-weapon-scoring.md` is the design record and its progress log the changelog.

```sh
node tools/guides.mjs                       # parse the guides → data/guides.json + data/guides.md
node tools/guides.mjs --refresh             # re-download the wikitext first (cached in data/guides/)
node tools/guide-check.mjs                  # every tier and class, full report
node tools/guide-check.mjs --pre --summary  # pre-hardmode metrics only (the tuning set)
node tools/guide-check.mjs --cls rogue      # one class
node tools/guide-check.mjs --why "Ashen Stalactite"   # the pick's DPS parts next to the lab's #1
node tools/guide-check.mjs --pre --summary --json data/guide-baseline.json --vs data/guide-baseline.json   # the gate: exits 1 on any class/family regression, --waive "reason" records why
node tools/unresolved-phases.mjs            # what the model still guesses, ranked by the DPS riding on it
node tools/observed.mjs                     # the in-game trials in data/observed.json, term by term
node tools/il-dump.mjs CalamityMod Viperfish SpawnChance   # the IL the miner sees, operands resolved
node tools/il-dump.mjs ThoriumMod --grep MusicPlayerNotActivated   # every method mentioning a member
```

`tools/guides.mjs` turns both guides into data: the Calamity wiki's class setups (Cargo table
`ClassSetups`) and every Infernal Eclipse of Ragnarok guide template, one record per
recommendation with its tier, class, kind, role (spam / stealth / minion / support / …), the marks
the guides use, the note behind them and the dataset item it resolves to. It writes
`data/guides.json` for the checker and [`data/guides.md`](data/guides.md) to read by eye.

| mark | meaning |
| --- | --- |
| `†` | risky: you have to be next to the boss |
| `C` | crowd control, best on worms |
| `+` | support or a secondary weapon |
| `≤` | upgrades of it are viable too |
| `*` | tedious to get at this tier |
| `ν` | SOTS void subclass |
| `Ω` | use it together with the item in `with` |
| `Δ` | its set bonus changed (Calamity) |

`tools/guide-check.mjs` reads that and reports, per tier and class, what is missing from the
dataset, what the lab stages later than the guide (with the gating evidence), and where the lab
ranks it — including whether a rogue weapon's spam/stealth grade agrees — plus per-class and
per-tier metrics with mean reciprocal rank. Tiers map to the stage just before the named boss
(`pre-X`) or to that boss's own stage (`post-X`).

Three kinds of lead come out of it, and all are leads rather than verdicts:

- **LATE** — the lab stages a pick after the guide's tier. The guides order bosses by difficulty
  (Deerclops before Skeletron) while the lab follows BossChecklist's progression, and the miner's
  answer comes with its evidence.
- **EARLY** — the lab puts an item in a stage's top 5 that no guide lists until two tiers later.
  That is the item wrongly winning a stage, and it is usually a staging bug rather than a scoring one.
- **UNLISTED** — a weapon holding top-8 slots that no guide names for that class at *any* tier, so
  EARLY cannot see it: there is no tier to compare against. These are half the pre-hardmode top-8
  slots, which makes them the ceiling on the metric and the actual worklist. A staging source that
  cannot be right (a Dungeon material staged pre-boss) is a bug; the rest is the guides not
  enumerating a pool this size.

When the evidence is wrong the fix goes into the miner or the config; nothing is pinned to the
guides. Picks marked `+` (support) are reported but left out of the top-k metric: the guides list
them for what they add to the main weapon, so the model *should* rank them below it.

## Known limits

- Real DPS is still a ranking, not a measurement. The boss's size and defense are mined but its
  movement is a stage-scaled constant (`bossSpeed`), not its AI; spawned projectiles are read for
  what they do but not for how often they may spawn, so they are capped; minion AI timers, Thorium
  inspiration spending and bard empowerments are not modelled (equipment's maximum inspiration and
  regeneration are scored); a charged shot's multiplier is counted as if every shot were charged,
  minus that cap.
- A mod boss whose debuff immunities live in a data table (Calamity's `NPCDebuffImmunityData`)
  counts as immune to everything, so debuff DPS only ever shows up against vanilla bosses.
- The engagement distance is a class constant with a playstyle toggle, not something a weapon
  carries: a close-range weapon scores low for a far-standing class as a rule, which is right in
  aggregate and wrong for the occasional weapon you would close in for.
- Effects applied outside the equip hooks (Celestial Shell's buffs) are only partially seen;
  `{0}` placeholders in tooltips and set bonuses are filled from a `Tooltip` getter's
  `WithFormatArgs` and from `GetLocalization("SetBonus").Format(...)` in `UpdateArmorSet` —
  numbers formatted elsewhere (`ModifyTooltips`) stay as placeholders.
- A per-tick velocity multiplier (Calamity's Mollusk set: `velocity.X *= 0.996` per piece) is
  scored as what it does to the sprint: below base run speed the game re-accelerates faster
  than the drag takes, above it (boots) only a third as fast, so the equilibrium caps the sprint —
  one piece costs ~1%, the full set (0.988 per tick) drops you to base run speed. The set is
  scored on the combined drag, not the sum of the pieces.
- Balancing done through reflection (`GetType().GetField(...).SetValue`) or through a mod's own
  player hooks (`ModPlayer.ModifyWeaponDamage`) is not captured; calibration residuals will show it.
- Gold critters (spawned by a transformation the miner does not read), mod events without a
  trigger the config knows (`event:CherryMoonEvent`) and mod biomes without a `zones` entry
  leave their items at the rarity guess; `data/unknown-sources.md` lists them.
- A mod chest placed at world generation may be locked or sit in a structure meant for later;
  the code does not say what opens it, so hardmode-tier contents keep their rarity guess.
- Mods that scale item damage at runtime from player state (Stars Above) show their base numbers.
