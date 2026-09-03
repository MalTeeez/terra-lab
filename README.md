# Terra Lab

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
            ├─ projectiles.js  ModProjectile.SetDefaults + AI traits (gravity, homing, pierce, children, debuffs)
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
            ├─ npcs.js         bosses, minions they spawn, BossChecklist progression values
            └─ vanilla.js      the same for Terraria itself, out of tModLoader.dll
        config.js              the player's ModConfigs/*.json + [DefaultValue] attributes
        loadorder.js           AssemblyRef topological order (balancing mods apply last)
        stage/infer.js         gamestage propagation → data/dataset.json
```

### Where the numbers come from

Everything is read out of compiled code, not wikis:

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
  updates, local immunity frames, minion slots) and a walk of its AI / OnKill / OnHitNPC:
  `velocity.Y += k` means gravity, calls named like `HomeInOnNPC` / `FindTarget` /
  `CanBeChasedBy` mean homing, `NewProjectile` calls (with their loop counts) are child
  projectiles, `AddBuff` on hit is a debuff, reads of Calamity's `stealthStrike` flag mark
  stealth-aware projectiles. Vanilla projectiles come out of `Projectile.SetDefaults1/2` with
  the case tracker plus an aiStyle table for gravity.
- **What a weapon fires** comes from its `Shoot` / `ModifyShootStats`, run with symbolic
  arguments: every `NewProjectile` is recorded with its type, damage multiplier, velocity
  multiplier, spread (`RotatedBy`, `RotatedByRandom`, `NextFloat`, `Lerp`, `ToRadians`) and the
  loop it sits in (backward branches with their compared bound → count). Calamity rogue
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
   move-in; a critter item follows the NPC it becomes,
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
   stock comes from `Chest.SetupTravelShop` — vanilla items keep their vanilla sources and are
   never made later by a shop,
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

Mods resolve from `Documents/My Games/Terraria/tModLoader/Mods/enabled.json`: the local `Mods/`
folder first, then the Steam workshop (newest version folder).

## The site

### Effective stats

A weapon's numbers go through a visible chain, shown on its item card:

```
mined base → balancing overlays (load order) → difficulty variants → runtime modifiers
           → reforge prefix → calibration factor
```

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
| +1 minion / sentry slot (summoner) | 100 / 30 × `minionSlotScale` (a slot is 1/N of DPS: 100 pre-boss, 30 at WoF, 15 at Moon Lord) |
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
defense 12 (accessories only; armor is linear), throwing velocity 30%, √aggro 10, flight time 200 ticks. Damage stays linear.
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

Weapons rank by **Real DPS** (`src/lib/dps.js`), damage per second against a boss-sized target:

```
hit      effective damage (+ the best ammo obtainable at the stage for ammo weapons)
rate     uses per second; guns firing several shots per animation count them
crit     1 + crit%                       (minions cannot crit)
hits     projectiles per use, plus child projectiles weighted by where they spawn
         (on death 0.6, on hit 0.5, periodically 0.2); past 4 hits per use only half land
accuracy spread (share of a cone that covers a 100px boss at 350px) × velocity (below 10 px/tick
         a moving boss dodges) × gravity arc 0.85 × contact-only 0.7 for true melee; homing = 1
pierce   against the boss fought next at the stage: infinite pierce ×1.5 on a worm, ×1.2 on a
         multi-part boss, ×1.05 on a single target; finite pierce +8% / +4% per extra target
         on worms / multi-part bosses and nothing on a single target
walls    ×1.05 for projectiles that ignore tiles
debuffs  +3% per on-hit debuff
sustain  magic: 25 mana/s is what potions keep up
minions  damage × hits per second (from local immunity frames, else 2/s) ÷ minion slots
```

Calamity rogue weapons get two numbers. *Spam* is the normal attack; *stealth* is one stealth
strike per 5 s with the multiplier Calamity computes from max stealth (read from the chosen
armor), the weapon's use time and its own `StealthDamageMultiplier`, on the projectiles of the
stealth path. The higher one is the weapon's grade, as the guides do it, and the item card
shows both. Armor compares the best full set (pieces + set bonus) against the best loose
pieces. Accessories fill the slot count greedily, one per exclusive group (wings, boots, shield,
dash), skipping anything whose bonuses target another class. Where a mod applies its numbers
through flags on its own `ModPlayer`, the tooltip is parsed as a fallback (`15% increased rogue
damage`), conditional lines excluded.

**Reforges** default to "assume the best prefix" for every candidate (the prefix that maximises
DPS or class score among those the item can roll); items you mark as owned keep the prefix you
give them.

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

```sh
node tools/guide-check.mjs                  # both guides, every tier and class
node tools/guide-check.mjs --cls rogue      # one class
node tools/guide-check.mjs --refresh        # re-download the wikitext (cached in data/guides/)
node tools/il-dump.mjs CalamityMod Viperfish SpawnChance   # the IL the miner sees, operands resolved
node tools/il-dump.mjs ThoriumMod --grep MusicPlayerNotActivated   # every method mentioning a member
```

The tool reads the Calamity wiki's class setups (Cargo table `ClassSetups`) and the Infernal
Eclipse of Ragnarok guide templates, maps every recommended weapon, armor set and accessory to
a dataset item and reports, per tier and class, what is missing, what the lab stages later than
the guide (with the gating ingredient), and where the lab ranks it — including whether a rogue
weapon's spam/stealth grade agrees. Tiers map to the stage just before the named boss.

A `LATE` pick is a lead, not a verdict: the guides order bosses by difficulty (Deerclops before
Skeletron) while the lab follows BossChecklist's progression, and the miner's answer comes with
its evidence. When the evidence is wrong the fix goes into the miner or the config; nothing is
pinned to the guides.

## Known limits

- Real DPS is still a ranking, not a measurement: hit geometry is a fixed boss silhouette,
  child projectiles are weighted guesses, minion AI timers and Thorium inspiration are not
  modelled, and a stealth strike's special behaviour is a flat bonus.
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
