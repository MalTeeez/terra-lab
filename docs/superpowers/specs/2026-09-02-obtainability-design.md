# Obtainability: pickaxe gates, ingredient sources and the crafting tree — design

Date: 2026-09-02. Extends the 2026-09-01 design and the Real DPS design of the same day.

## Problem

Stage inference only used boss drops, boss tile spawns, recipes (ingredients + stations),
config anchors and rarity. Three gaps showed up in play:

1. **Recipe groups were ignored.** Sludge Splotch needs `any Boss2Material` (Shadow Scale or
   Tissue Sample); only the Blighted Gel counted, so the weapon showed as pre-boss.
2. **Pickaxe power was not modelled.** Aerialite Ore needs a 65 % pickaxe (Nightmare /
   Deathbringer, i.e. after Eater of Worlds / Brain of Cthulhu); the lab pinned it to
   pre-boss by hand.
3. **Non-boss sources had no evidence**: enemies whose spawn or loot is gated on a downed
   flag or zone (abyss layers), chests that need a boss-dropped key, and mod crafting
   stations were all either rarity guesses or manual overrides.

Since the resulting logic is hard to trust blind, the item card must show the crafting tree
with each node's stage and the reason it is gated.

## Mined data (miner)

| what | where | how |
| --- | --- | --- |
| recipe groups | `extract/groups.js` (new) | every `RecipeGroup.RegisterGroup(name, new RecipeGroup(_, items…))`, `group.ValidItems.Add(x)` and additions to vanilla groups via `recipeGroups[recipeGroupIDs["X"]]`; vanilla groups from `Recipe.SetupRecipeGroups` |
| group ids in recipes | `extract/recipes.js` | `recipeGroupIDs["X"]` resolves to the group name instead of `group#?` |
| pickaxe power | `extract/items.js`, `extract/vanilla.js` | `Item.pick` |
| tile requirements | `extract/tiles.js` (new) | `ModTile.SetStaticDefaults`: `MinPick`, `TileID.Sets.Ore`; gates (`downed*`, `hardMode`) referenced by `CanKillTile` / `CanExplode`. Vanilla tile requirements come from `progression.json` (`pickaxe.vanillaTiles`, the `Player.GetPickaxeDamage` table) |
| enemy spawn gates | `extract/npcs.js` | flags referenced by `SpawnChance`: `downed*`, `hardMode`, `Zone*` (via `util.gateRefs`) |
| loot conditions | `extract/loot.js` | `AddIf(() => flag, …)` lambdas (delegates now carry their method through the interpreter), `Conditions.DownedX` / `Post…()` condition objects → `cond: [flags]` on the drop |

## Stage inference (`stage/infer.js`)

New evidence kinds, in the order they are tried (`better()` keeps the earliest):

- `group` inside `craft`: a recipe group counts as the earliest of its members; the chain
  names the group and the member used.
- `enemy`: a drop from a non-boss **mod** NPC, gated at `max(spawn gates, loot conditions)`;
  flags map to bosses by name (`downedHiveMind` → Hive Mind), vanilla flags and zones via
  config (`downedFlags`, `zones`; abyss layers 1–4 → start / Skeletron / Golem / Polterghast
  per the Calamity wiki). Drops from vanilla non-boss NPCs stay unused (their spawn logic
  is not mined) but are listed as sources.
- `chest`: config `chests` — Dungeon (Golden Key), Shadow Chest (Shadow Key), Biome
  chests, Lihzahrd chest, Calamity's Ancient Treasure Chest, with the boss that unlocks
  them.
- `ore`: an item placing a tile with a pick requirement or `Sets.Ore` is worldgen (0)
  gated by `max(pickaxe gate, tile downed gates)`; the pickaxe gate is the earliest stage
  at which any item with `pick ≥ MinPick` is obtainable — pickaxes staged by rarity alone
  do not count. An anchor or a boss that spawns the tile is a floor under that gate.
  `pickaxe.worldgenAs` names an ore whose world tile is another one until a boss converts
  it (Calamity's Disenchanted Aerialite needs 110 until Hive Mind / Perforators, then the
  65 tile applies). Drop evidence still wins when earlier.

Two safety rules keep guesses from becoming gates: enemy evidence never exceeds the
item's rarity fallback (a Hardmode goblin also dropping Yew Wood is not its source), and a
mod's recipe for a vanilla item never stages it later than its rarity (Diamond from coal,
Starfury from Aerialite) — vanilla sources leave no code evidence.

- `shop` (added later the same day): `extract/shops.js` reads `ModNPC.AddShops`,
  `GlobalNPC.ModifyShop` (keyed on `shop.NpcType`) and tModLoader's `NPCShopDatabase.Register*`;
  entries carry their `Condition` flags (statics like `DownedPlantera`, or lambdas). A shop
  item is gated at `max(seller move-in, entry condition)`; mod sellers read `CanTownNPCSpawn`
  (with OR chains → `any:` flags, the earliest alternative), vanilla sellers come from
  `townNpcs` in the config. Vanilla items are never made later by a shop.
- `manual`: `miner/stage/sources.json`, the user's research, applied like overrides with a
  `via` note. `tools/unknown-sources.mjs` lists what still needs one.

Player-side effects (`extract/flageffects.js`): every ModPlayer method is walked linearly;
a load of a bool field / property on `this` opens a tagged region and the stat deltas inside
are attributed to that flag; items carrying the flag get the effects folded in.

Pickaxes are themselves crafted from ores, so the fixed point runs in rounds: infer with
the ores unresolved, derive the pickaxe gates from the pickaxes' stages, seed the ores,
re-run; repeat until no ore changes (≤ 4 rounds).

`stageSource` gets richer: `craft` carries the recipe index and the chain of gating
ingredients (groups as `any X → member`), `ore` carries `{ need, pickaxe, boss }`, `enemy`
carries `{ via: npc, boss, gate }`, `chest` carries `{ via: chest, boss }`.

## Dataset

Besides the equipment `items`:

- `materials`: every item reachable through recipes / groups / ore gates from equipment,
  with `{ name, mod, stage, prog, src }`.
- `recipes`: `{ resultId: [[[item, n]…], [groups], [tiles]]… }` for equipment and
  materials.
- `groups`: `{ name: [ids] }`, `stations`: `{ tileRef: { name, stage } }`.

## Site

`src/lib/sources.js` builds a tree for an item: the node's stage and source, the recipe
the inference chose (earliest) plus the alternatives, each ingredient / group / station as
a child, and a `gating` flag on the children that decide the parent's stage. `CraftTree.svelte`
renders it (collapsible, gating path expanded by default, equipment nodes clickable) and
replaces the flat "Sources" list on the item card.

## Testing

Unit tests on `inferStages` fixtures (group gating, pickaxe rounds, converted world tile,
enemy gate, chest), dataset pins (Sludge Splotch at Eater of Worlds, Aerialite Ore at Hive
Mind with a pickaxe source, Cryonic Ore spawned by Cryogen, Astral Ore gated on Astrum
Deus, Desert Prowler still pre-boss), and `tools/guide-check.mjs` must stay at 0 late picks.

## Addendum (2026-09-02, later): sources the code does hold

The user rejected manual pinning (`guide-overrides.json`, per-item `sources.json` entries): the
miner should read every path an item can come from and the user only answers what the code cannot
say (which boss or event makes a flag true). Added:

- Interpreter: region tags carry negation (`!x`) and OR alternatives (`any:x`, `any:*`); an
  else-branch is tagged with the negated conditions of *all* `&&` regions ending at the if-block;
  the region stack is restored at jump targets after a terminator; a flag reaching a join with
  `0` from the other path stays the flag and remembers the flags guarding the jump (`a && b`
  through a bool local); different constants meeting at a join become a `phi` (`hardMode ? 3981 :
  2336`) with each arm's flags; conditionally stored locals load as `maybe`; `noDead` disables
  known-outcome dead blocks for gate walks; `onStoreLocal` / `onStoreArg` / `onStaticStore` hooks;
  array literals (`InitializeArray`) and `494 + rand.Next(2)` ranges.
- `extract/flags.js`: progression statics, `Zone*` / `*Biome` members, `Main.invasionType` as a
  key, mod event state (`event:CherryMoonEvent`), `siteGates(ctx)`, `expandValue`.
- `extract/spawns.js`: vanilla `NPC.SpawnNPC` sites (+ Old One's Army waves as `dd2:N`) and
  `GlobalNPC.EditSpawnPool` entries as spawn alternatives per NPC (earliest wins).
- `extract/fishing.js`: `Projectile.FishingCheck_RollItemDrop` / `_RollEnemySpawns` and
  `ModPlayer.CatchFish` with its by-ref helpers.
- `extract/worldgen.js`: `WorldGen.AddBuriedChest` picks (keyed on style / chest tile) and its
  callers (a local chosen by a switch counts every constant stored into it); mod world generation
  closure (`ModifyWorldGenTasks`, `PostWorldGen`, `GenPass.ApplyPass`, `*World*`/`*Gen*` helpers) →
  chest items and placed tiles; a chest tile with `UnlockChest` marks its items `locked`.
- `extract/loot.js`: `GlobalItem.ModifyItemLoot` keyed on `item.type`, `Item.NewItem` from
  `OnKill`, condition factories with arguments (`DropHelper.Hardmode(ui)`), the flags around a
  rule call, mod helpers building rules inside (`loot.AddRevBagAccessories()`), ranges
  (`(uint)(type - 586) <= 1`), `npc:*` for any-enemy drops under a flag.
- `extract/shops.js`: the Travelling Merchant (`Chest.SetupTravelShop_GetItem` +
  `_CanAddItemToShop`). `groups.js` / `recipes.js`: group ids stored in static fields
  (`RecipeGroupID.Wood`, Thorium's `AnyGoldBarGroup`).
- `stage/infer.js`: `usableGate` — an unresolved required flag leaves the evidence unused and
  is reported (`unresolvedFlags`, dataset `unresolved`); vanilla zones default to start; config
  flags match by core name (`DownedMechBossAny` ↔ `downedMechBossAny`) with Calamity's
  `PostEoC`-style aliases listed; boss drops honour drop conditions; `fish`, `worldgen`
  (`estimated` for locked / hardmode-tier mod chests), `critter` evidence; commons (rarity ≤ 1)
  keep their rarity guess against gated enemies.
- Tooltips: `{0}` placeholders filled from `Tooltip` getters (`WithFormatArgs`) and
  `UpdateArmorSet` (`GetLocalization("SetBonus").Format(...)`); `{$Key@1}` references renumber.
- Scoring: `sprintFactor(drag)` models a per-tick `velocity.X *= k` against the game's run /
  sprint acceleration (3 → 6.75 with boots); a set is scored on its combined drag.
- Tools: `tools/il-dump.mjs`; `tools/unknown-sources.mjs` leads with unresolved gates;
  `guide-check.mjs` no longer writes overrides. Result: rarity guesses 1189 → 786 equipment items.
