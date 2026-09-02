# Terra Lab — design

Optimal class loadouts for modded Terraria, per gamestage, from a dataset mined out of the
player's own `.tmod` files.

## Goals

- **Mine** a set of tModLoader mods (plus vanilla) into one comprehensive item dataset with no
  manual data entry: every weapon, armor piece and accessory with its stats, class, tooltip and
  an inferred *gamestage* at which it becomes obtainable.
- **Solve** the best loadout for a chosen class at a chosen gamestage, or for every stage at
  once, and show *why* each pick scored the way it did.
- **Browse** the dataset: filter by mod, class, slot, stage; search by name.
- Ship as a static site (Svelte 5 + Tailwind 4 + Vite on Bun, same stack as turret-lab) with
  the generated dataset committed, so the site builds without the game installed.

Non-goals (for now): potions/buffs, weapon projectile simulation, per-boss matchups, mounts,
multiplayer roles.

## Architecture

```
miner/                       Bun/Node scripts — no .NET SDK needed
  tmod.js                    .tmod container reader (deflate entries)
  clr/pe.js                  PE → CLI metadata streams
  clr/metadata.js            ECMA-335 tables (TypeDef, MethodDef, MemberRef, MethodSpec, …)
  clr/il.js                  IL decoder (opcode table, method bodies)
  extract/items.js           ModItem discovery, SetDefaults symbolic execution, armor attrs
  extract/recipes.js         Recipe graph from IL (CreateRecipe/AddIngredient/Register)
  extract/drops.js           NPC & treasure-bag loot from IL (ModifyNPCLoot/ModifyItemLoot)
  extract/localization.js    hjson → DisplayName / Tooltip / SetBonus
  extract/vanilla.js         Item.SetDefaults switch walker over tModLoader.dll + vanilla
                             recipes / loot registration
  stage/infer.js             Gamestage propagation (config → drops → recipes → rarity)
  stage/progression.json     Ordered stage list, boss NPC names, base materials, rarity map
  classify.js                DamageClass → class; tooltip stat parsing
  mine.js                    CLI: resolve mods, run pipeline, write data/dataset.json
src/                         Svelte app
  lib/dataset.js             Load + index the dataset
  lib/score.js               Weapon DPS estimate, armor & accessory class scores
  lib/solver.js              Loadout solver (armor set, weapons, accessory slots)
  lib/state.svelte.js        Global UI state, persisted settings
  components/…               Controls, LoadoutPanel, StageTimeline, ItemTable, ItemCard
data/dataset.json            Generated, committed
test/                        bun test — reader fixtures, extractor, stage inference, solver
```

Data flows one way: `.tmod` files → miner → `data/dataset.json` → site. The site never
touches the game.

## Miner

### Mod resolution
`bun run mine` reads `enabled.json` from the tModLoader save folder and resolves each name
to a `.tmod`: local `Mods/<name>.tmod` first, else the workshop folder
(`steamapps/workshop/content/1281930/<id>/<version>/<name>.tmod`, newest version folder).
Explicit paths and `--only`/`--skip` filters are accepted. Vanilla comes from
`steamapps/common/tModLoader/tModLoader.dll`.

### .tmod container
`TMOD`, tML version string, 20-byte hash, 256-byte signature, uint32 data length, then
mod name, mod version, entry count, entries (path, length, compressedLength) and blobs;
compressed entries are raw deflate. Only `<Mod>.dll` and `Localization/**/*.hjson` are read.

### CLR reader
A minimal ECMA-335 reader: PE headers → CLI header → `#~`, `#Strings`, `#Blob`, `#US`
heaps; all table row schemas (needed to compute row sizes) but only the tables we resolve
are decoded to objects. Method bodies are located via RVA → section mapping; tiny and fat
headers; IL decoded to `{offset, opcode, operand}` with the full one- and two-byte opcode
table. Signatures are parsed only as far as needed (generic method instantiation type args,
field/method names and declaring types).

### Item extraction
A type is a `ModItem` if its base chain reaches a TypeRef named `ModItem` in
`Terraria.ModLoader` (walking through mod-defined base classes). For each:

- **SetDefaults**: symbolic execution with a small constant stack. Recognised sinks are
  `stfld Item::<field>` and `callvirt Item::set_<prop>` on the `this.Item` receiver.
  Sources: `ldc.*`, `conv.*`, `DamageClass::get_X` (static property), `ldsfld X::Instance`,
  `ModContent::GetInstance<T>()`, `ModContent::RarityType<T>()`, `ModContent::ItemType<T>()`,
  `Item::CloneDefaults(int)`. Anything else pushes *unknown*. Fields kept: damage, defense,
  useTime, useAnimation, crit, knockBack, mana, rare, value, accessory, shoot, useStyle,
  width, height, DamageType, and armor slots.
- **Armor**: `[AutoloadEquip(EquipType.X)]` custom attribute (fixed enum arg). Set membership
  from generic type args referenced in `IsArmorSet`. Set bonus text from localization.
- **Accessories**: `Item.accessory = true`. Wings/boots/etc. are tagged from EquipType.
- **Localization**: merge all `en-US` hjson under `Localization/`, keyed
  `Mods.<Mod>.Items.<Class>.{DisplayName,Tooltip,SetBonus}`; fall back to a de-camel-cased
  class name.

Base-class inheritance is honoured: a ModItem whose `SetDefaults` calls
`base.SetDefaults()` inherits the base's recorded constants.

### Recipes & drops
- Every method in the assembly is scanned for `CreateRecipe`/`Recipe.Create` … `Register`
  sequences; ingredients from `AddIngredient(<T>|int, n)`, result from the enclosing
  `ModItem` or explicit item id; tiles from `AddTile`.
- Every `ModNPC.ModifyNPCLoot` and `ModItem.ModifyItemLoot` (treasure bags) is scanned for
  item references (`ModContent::ItemType<T>()`, vanilla `ldc.i4`) — an over-approximation
  that says "this NPC/bag can drop these items".
- Vanilla: `Item.SetDefaults*` is walked with a *case tracker* (`switch` jump tables and
  `type == N` comparisons set the current case; `stfld this::x` records into it);
  `Recipes.AddRecipes` and `ItemDropDatabase.RegisterBoss_*` use inline constants only.

### Gamestage inference
`progression.json` defines an ordered list of stages, each with: key, label, era
(pre-hardmode / hardmode / post-Moon Lord / post-Yharon …), boss NPC class names
(vanilla ids and mod classes across Calamity, Thorium, SOTS …), and *anchored materials*
(ores, souls, bars whose availability is tied to the stage). A rarity → stage fallback
table (vanilla indices and mod rarity class names) covers items with no source.

Propagation (to fixed point):
1. Anchored materials and boss drops get their stage from config.
2. Bag contents inherit the bag's stage; bag stage = stage of the boss dropping it.
3. Crafted items = max(stage of ingredients, stage of crafting tile) when all ingredients
   are known; recipe groups resolve to the min over members.
4. Anything still unknown falls back to the rarity table, flagged `stageSource: "rarity"`.
Each item records `stage`, `stageSource` (`drop:<boss>`, `craft`, `rarity`, `override`)
and its source chain for the UI. A per-mod override file allows corrections.

### Dataset shape
```jsonc
{
  "generatedAt": "...", "tml": "2026.6.3.4",
  "mods": [{ "id": "CalamityMod", "name": "Calamity", "version": "2.2.4", "items": 1900 }],
  "stages": [{ "key": "post-eoc", "label": "Post Eye of Cthulhu", "era": "prehm", "index": 3 }],
  "items": [{
    "id": "CalamityMod:Murasama", "mod": "CalamityMod", "name": "Murasama",
    "slot": "weapon" | "head" | "body" | "legs" | "accessory" | "wings" | …,
    "class": "melee" | "ranged" | "magic" | "summon" | "rogue" | "bard" | "healer" | "other",
    "damage": 0, "useTime": 0, "useAnimation": 0, "crit": 0, "knockback": 0, "mana": 0,
    "defense": 0, "rarity": 0, "rarityName": "…", "value": 0,
    "tooltip": "…", "setBonus": "…", "set": ["CalamityMod:AuricTeslaBodyArmor", …],
    "stage": 27, "stageSource": "drop:CalamityMod:Yharon", "sources": ["…"],
    "stats": { "meleeDamage": 0.1, "crit": 5, "minionSlots": 1, "moveSpeed": 0.1, … }
  }]
}
```
`stats` is parsed from tooltip text with a regex library (`(\d+)% increased (melee|…) damage`,
`\+(\d+) (defense|max minions)`, `critical strike chance`, `movement speed`, `life regen`,
`max life/mana`, `immune to …`, `flight`) and is the basis of accessory/armor scoring.

## Solver (site)

Inputs: class, stage (or all), included mods, accessory slot count (default 6), whether to
require full armor sets. Candidates are items with `stage ≤ chosen` from included mods.

- **Weapons**: `dps = damage × 60 / (melee ? useAnimation : useTime) × (1 + crit/100)`;
  summon weapons rank by damage (labelled "per hit"). Top 5 shown with the formula visible.
- **Armor**: for each complete set (head+body+legs sharing a set bonus) score =
  defense + class-affinity of set bonus + parsed stat bonuses; sets whose bonus names another
  class are penalised. Falls back to best individual pieces. Helmets that exist as class
  variants of one set (Auric Tesla) resolve to the class's variant.
- **Accessories**: score = parsed class stats + defense + utility; one per exclusive group
  (wings, boots, shield/knockback immunity), greedy fill of the slot count, with class-foreign
  accessories excluded. Every pick lists its score breakdown.
- **All stages**: run per stage, render a timeline table (stage rows × armor / weapons /
  accessories), highlighting where the pick changes from the previous stage.

## UI

Light theme, green accents, near-square corners (`--radius: 2px`). Paper-white ground
(`#f6f7f4`), ink (`#161a17`), accent green (`#1e7a3c` / `#2f9e44`), hairline borders,
uppercase tracked small labels, tabular mono numerals. Sans for text, mono for numbers.
Layout: header (title, dataset provenance), control bar (class chips, stage select, mods,
slots), then either a **Loadout** panel (armor set card, weapons table with DPS bars,
accessories grid with score breakdown) or a **Timeline** view; below, an **Item table**
with filters and an inline item card. Mobile stacks vertically.

## Error handling

- A mod whose DLL fails to parse is reported and skipped; the run continues.
- Unknown IL patterns push *unknown* values; stats never silently take a wrong constant.
- Items with no stage source are flagged, not dropped. The site shows `stageSource`.
- The site validates the dataset version at load and shows a banner if missing.

## Testing

`bun test`:
- The CLR reader is tested against the real `tModLoader.dll` and a small mod when present;
  those tests skip when the game is not installed. Deterministic unit tests cover the
  container parser (synthetic buffer), the IL decoder (hand-assembled byte sequences), the
  SetDefaults interpreter (hand-assembled IL), tooltip stat parsing, stage propagation on a
  fixture graph, and the solver on a fixture dataset.
- Parity tests pin known values from the generated dataset (e.g. Murasama's damage, Auric
  Tesla defense, Solar Flare set defense) so a regression in the miner is caught.
