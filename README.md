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
            ├─ shoot.js        Shoot / ModifyShootStats → projectiles per use, spread, velocity, stealth paths
            ├─ recipes.js      CreateRecipe … Register → ingredient graph
            ├─ loot.js         ModifyNPCLoot / ModifyItemLoot / OnKill → boss drops, bags, ore spawns
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
express (hardmode ores after the Wall of Flesh, souls, Ectoplasm), crafting-station gates and the
rarity fallback. `infer.js` then propagates to a fixed point:

1. anchors and overrides,
2. boss drops, boss bags, ore tiles spawned on a boss kill,
3. recipes — max over ingredients and station, min over alternative recipes,
4. rarity as the last resort (vanilla index or mod rarity class).

Items that only drop from ordinary enemies, chests, fishing or shops leave no evidence in code
and would fall back to rarity, so `miner/stage/guide-overrides.json` (generated from the
class-setup guides, see below) and the manual `overrides` in `progression.json` pin them.

Each item carries `stage`, `prog` and `stageSource` (`drop`, `bag`, `craft`, `spawn`, `anchor`,
`override`, `rarity`, `unknown`). The site shows the source as a tag; **rarity** tags are the ones
worth double-checking, and `overrides` in the config is where to fix them.

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

Difficulty flags found in the pack appear as toggles; "Apply uncertain modifiers" includes the
ones whose in-code guard the miner could not resolve.

### Solver

Scores are sums of labelled parts so the UI can always say why:

| part | points |
| --- | --- |
| +1% class damage (or all-class) | 1 |
| +1% crit | 0.5 |
| +1% attack speed (melee, ranged, rogue) | 0.6 |
| +1 defense | 0.4 |
| +1 minion / sentry slot (summoner) | 18 / 8 |
| flight, knockback immunity, dash, … | flat |

Weapons rank by **Real DPS** (`src/lib/dps.js`), damage per second against a boss-sized target:

```
hit      effective damage (+ the best ammo obtainable at the stage for ammo weapons)
rate     uses per second; guns firing several shots per animation count them
crit     1 + crit%                       (minions cannot crit)
hits     projectiles per use, plus child projectiles weighted by where they spawn
         (on death 0.6, on hit 0.5, periodically 0.2); past 4 hits per use only half land
accuracy spread (share of a cone that covers a 100px boss at 350px) × velocity (below 10 px/tick
         a moving boss dodges) × gravity arc 0.85 × contact-only 0.8 for true melee; homing = 1
pierce   infinite ×1.35 (worm segments, multi-part bosses), n > 1 → +8% per extra target
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
(always in the loadout) or exclude it (never picked). "Gear from: only what I own" solves from that
list alone; the loadout tags picks that are yours.

### Calibration

The *Calibrate* panel takes weapons with the damage the game shows in their tooltip (ideally on a
naked character, otherwise enter your bonus damage / crit so they are divided out). Each sample
yields observed ÷ predicted; the median per class becomes a factor applied to every prediction of
that class, and the residual per sample shows which items the model still gets wrong — those are
the ones whose modifiers live somewhere the miner does not look yet.

## Checking against the class-setup guides

```sh
node tools/guide-check.mjs                  # both guides, every tier and class
node tools/guide-check.mjs --cls rogue      # one class
node tools/guide-check.mjs --refresh        # re-download the wikitext (cached in data/guides/)
node tools/guide-check.mjs --write-overrides  # pin late-staged guide picks, then bun run mine
```

The tool reads the Calamity wiki's class setups (Cargo table `ClassSetups`) and the Infernal
Eclipse of Ragnarok guide templates, maps every recommended weapon, armor set and accessory to
a dataset item and reports, per tier and class, what is missing, what the lab stages later than
the guide (with the gating ingredient), and where the lab ranks it — including whether a rogue
weapon's spam/stealth grade agrees. Tiers map to the stage just before the named boss.

## Known limits

- Real DPS is still a ranking, not a measurement: hit geometry is a fixed boss silhouette,
  child projectiles are weighted guesses, minion AI timers and Thorium inspiration are not
  modelled, and a stealth strike's special behaviour is a flat bonus.
- Effects applied outside the equip hooks (Celestial Shell's buffs, Thorium's `{0}` tooltips whose
  numbers live in `ModifyTooltips`) are only partially seen; class affinity still is.
- Balancing done through reflection (`GetType().GetField(...).SetValue`) or through a mod's own
  player hooks (`ModPlayer.ModifyWeaponDamage`) is not captured; calibration residuals will show it.
- Shop-bought items, biome chests and non-boss enemy drops have no progression evidence and fall
  back to rarity.
- Mods that scale item damage at runtime from player state (Stars Above) show their base numbers.
