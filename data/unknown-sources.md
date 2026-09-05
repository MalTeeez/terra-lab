# Items without a known source

Generated 2026-09-04 from data/dataset.json.

The miner reads drops, boss bags, shops, fishing, natural spawns, world-generation chests and recipes from the mod code. What is listed here is what that left open:

- **Unresolved gates** are flags the code checks that the miner cannot place on the boss order. Each one blocks every piece of evidence behind it. Answering "which boss / event makes this true" in `miner/stage/progression.json` (`downedFlags`, `zones`) fixes all of them at once.
- **Equipment with a guessed stage** has no usable evidence: the stage is the rarity guess. The code paths the miner did see are listed so the missing one can be spotted (an event, a locked chest, a mechanic the miner does not read yet).



## Materials that gate equipment

Sorted by how many equipment items need them through their crafting tree.

| material | mod | guessed stage | why | rarity | used by | code paths seen |
| --- | --- | --- | --- | --- | --- | --- |

## Equipment with a guessed stage
