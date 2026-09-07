# Items without a known source

Generated 2026-09-07 from data/dataset.json.

The miner reads drops, boss bags, shops, fishing, natural spawns, world-generation chests and recipes from the mod code. What is listed here is what that left open:

- **Unresolved gates** are flags the code checks that the miner cannot place on the boss order. Each one blocks every piece of evidence behind it. Answering "which boss / event makes this true" in `miner/stage/progression.json` (`downedFlags`, `zones`) fixes all of them at once.
- **Equipment with a guessed stage** has no usable evidence: the stage is the rarity guess. The code paths the miner did see are listed so the missing one can be spotted (an event, a locked chest, a mechanic the miner does not read yet).

Not listed: 6 equipment items and 13 materials of rarity 0–1 guessed at Pre-boss (world blocks, common drops) — `--all` includes them.

## Materials that gate equipment

Sorted by how many equipment items need them through their crafting tree.

| material | mod | guessed stage | why | rarity | used by | code paths seen |
| --- | --- | --- | --- | --- | --- | --- |
| Mana Berry `ThoriumMod:ManaBerry` | ThoriumMod | Wall of Flesh | rarity guess | 4 | 1 |  |

## Equipment with a guessed stage

### ThoriumMod (11)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Bat Repellent `ThoriumMod:BatRepellent` | potion | Eye of Cthulhu | rarity guess | Green |  |
| Fish Repellent `ThoriumMod:FishRepellent` | potion | Eye of Cthulhu | rarity guess | Green |  |
| Insect Repellent `ThoriumMod:InsectRepellent` | potion | Eye of Cthulhu | rarity guess | Green |  |
| Kumquat `ThoriumMod:Kumquat` | potion | Eye of Cthulhu | rarity guess | Green |  |
| Persimmon `ThoriumMod:Persimmon` | potion | Eye of Cthulhu | rarity guess | Green |  |
| Skeleton Repellent `ThoriumMod:SkeletonRepellent` | potion | Eye of Cthulhu | rarity guess | Green |  |
| Zombie Repellent `ThoriumMod:ZombieRepellent` | potion | Eye of Cthulhu | rarity guess | Green |  |
| Cranberry `ThoriumMod:Cranberry` | potion | Wall of Flesh | rarity guess | Light Red |  |
| Mangosteen `ThoriumMod:Mangosteen` | potion | Wall of Flesh | rarity guess | Light Red |  |
| Raspberry `ThoriumMod:Raspberry` | potion | Wall of Flesh | rarity guess | Light Red |  |
| Soursop `ThoriumMod:Soursop` | potion | Wall of Flesh | rarity guess | Light Red |  |

### CalamityMod (5)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Barberry `CalamityMod:Barberry` | potion | Eye of Cthulhu | rarity guess | Green |  |
| Cometfruit `CalamityMod:Cometfruit` | potion | Eye of Cthulhu | rarity guess | Green |  |
| Lotus `CalamityMod:Lotus` | potion | Eye of Cthulhu | rarity guess | Green |  |
| Mangosteen `CalamityMod:Mangosteen` | potion | Eye of Cthulhu | rarity guess | Green |  |
| Quality Slop `CalamityMod:QualitySlop` | potion | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |

### CalamityBardHealer (2)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Procioplexon `CalamityBardHealer:Procioplexon` | weapon (healer) | unknown | no rarity, no evidence |  |  |
| Vivapollum `CalamityBardHealer:Vivapollum` | weapon (bard) | unknown | no rarity, no evidence |  |  |

### RagnarokMod (2)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Anahita's Arpeggio `RagnarokMod:AnahitasArpeggioOverride` | weapon (bard) | Golem | rarity guess | Lime |  |
| Cant Stop Wont Stop `RagnarokMod:CantStopWontStop` | accessory | unknown | no rarity, no evidence |  |  |

### ThoriumRework (2)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Magical Harp `ThoriumRework:MagicalHarp` | weapon (bard) | Skeletron Prime | rarity guess | Pink |  |
| Stellar Tune `ThoriumRework:StellarTune` | weapon (bard) | Skeletron Prime | rarity guess | Pink |  |

### NoxusBoss (1)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Cinnamon Rollyn `NoxusBoss:CinnamonRollyn` | potion | unknown | no rarity, no evidence | Solyn Reward |  |

### InfernalEclipseAPI (1)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Genesis `InfernalEclipseAPI:Genesis` | weapon (bard) | unknown | no rarity, no evidence | Nameless Deity |  |
