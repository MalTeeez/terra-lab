# Items without a known source

Generated 2026-09-03 from data/dataset.json.

The miner reads drops, boss bags, shops, fishing, natural spawns, world-generation chests and recipes from the mod code. What is listed here is what that left open:

- **Unresolved gates** are flags the code checks that the miner cannot place on the boss order. Each one blocks every piece of evidence behind it. Answering "which boss / event makes this true" in `miner/stage/progression.json` (`downedFlags`, `zones`) fixes all of them at once.
- **Equipment with a guessed stage** has no usable evidence: the stage is the rarity guess. The code paths the miner did see are listed so the missing one can be spotted (an event, a locked chest, a mechanic the miner does not read yet).

Not listed: 99 equipment items and 71 materials of rarity 0–1 guessed at Pre-boss (world blocks, common drops) — `--all` includes them.

## Materials that gate equipment

Sorted by how many equipment items need them through their crafting tree.

| material | mod | guessed stage | why | rarity | used by | code paths seen |
| --- | --- | --- | --- | --- | --- | --- |
| Dissolving Aether `SOTS:DissolvingAether` | SOTS | Eater of Worlds / Brain of Cthulhu | rarity guess | 3 | 31 | drop Otherworldly Spirit |
| Acidwood `CalamityMod:Acidwood` | CalamityMod | unknown | no rarity, no evidence |  | 24 |  |
| Acidwood Platform `CalamityMod:AcidwoodPlatform` | CalamityMod | unknown | no rarity, no evidence |  | 24 |  |
| Dissolving Umbra `SOTS:DissolvingUmbra` | SOTS | Wall of Flesh | chest at world generation (SOTSWorld.PostWorldGen), rarity floor | 4 | 22 | drop Evil Spirit; worldgen SOTSWorld.PostWorldGen |
| Sulphuric Scale `CalamityMod:SulphuricScale` | CalamityMod | Eye of Cthulhu | rarity guess | 2 | 20 | drop Acid Eel; drop Nuclear Toad; drop Radiator; drop Skyfin |
| Dissolving Nether `SOTS:DissolvingNether` | SOTS | Wall of Flesh | rarity guess | 4 | 17 | drop Inferno Spirit |
| Astra Jelly `CatalystMod:AstraJelly` | CatalystMod | Moon Lord | rarity guess | 10 | 13 | bag Treasure Pod ({$Mods.CatalystMod.NPCs.Astrageldon.DisplayName}) |
| Strange Plating `ThoriumMod:StrangePlating` | ThoriumMod | Plantera | rarity guess | 6 | 13 |  |
| Dissolving Brilliance `SOTS:DissolvingBrilliance` | SOTS | Wall of Flesh | chest at world generation (SOTSWorld.PostWorldGen), rarity floor | 4 | 11 | worldgen SOTSWorld.PostWorldGen |
| Astral Monolith `CalamityMod:AstralMonolith` | CalamityMod | unknown | no rarity, no evidence |  | 9 |  |
| Astral Monolith Wall `CalamityMod:AstralMonolithWall` | CalamityMod | unknown | no rarity, no evidence |  | 9 |  |
| Alloy of Eden `InfernalEclipseAPI:AlloyofEden` | InfernalEclipseAPI | unknown | no rarity, no evidence |  | 6 |  |
| Hardened Crimsand Block `v:3275` | Terraria | Eye of Cthulhu | rarity guess | 2 | 6 |  |
| Hardened Ebonsand Block `v:3274` | Terraria | Eye of Cthulhu | rarity guess | 2 | 6 |  |
| Rock `CalamityMod:Rock` | CalamityMod | unknown | no rarity, no evidence |  | 6 |  |
| Soul of Plight `ThoriumMod:SoulofPlight` | ThoriumMod | Eater of Worlds / Brain of Cthulhu | rarity guess | 3 | 6 |  |
| Skip Shard `SOTS:SkipShard` | SOTS | unknown | no rarity, no evidence |  | 5 |  |
| Bloom Weave `ThoriumMod:BloomWeave` | ThoriumMod | Golem | rarity guess | 7 | 4 |  |
| Cursed Cloth `ThoriumMod:CursedCloth` | ThoriumMod | Plantera | rarity guess | 6 | 4 |  |
| Life-Powered Energy Cell `ThoriumMod:LifePoweredEnergyCell` | ThoriumMod | Skeletron Prime | rarity guess | 5 | 4 |  |
| Essence Of Wolves `StarsAbove:EssenceOfWolves` | StarsAbove | unknown | no rarity, no evidence |  | 3 |  |
| Pharaoh's Breath `ThoriumMod:PharaohsBreath` | ThoriumMod | Wall of Flesh | rarity guess | 4 | 3 |  |
| Chaos Blaster `InfernalEclipseAPI:ChaosBlaster` | InfernalEclipseAPI | unknown | no rarity, no evidence |  | 2 |  |
| Desert Spirit Lamp `v:3795` | Terraria | Eater of Worlds / Brain of Cthulhu | rarity guess | 3 | 2 | drop Desert Spirit |
| Essence of the Gunlance `StarsAbove:EssenceOfTheGunlance` | StarsAbove | unknown | no rarity, no evidence |  | 2 |  |
| Essence of the Ocean `StarsAbove:EssenceOfTheOcean` | StarsAbove | unknown | no rarity, no evidence |  | 2 |  |
| Prototype Plasma Drive `CalamityMod:PlasmaDriveCore` | CalamityMod | XS-03 Apollo | rarity guess |  | 2 |  |
| Ruby Keystone `SOTS:RubyKeystone` | SOTS | Wall of Flesh | rarity guess | 4 | 2 |  |
| Suspicious Scrap `CalamityMod:SuspiciousScrap` | CalamityMod | XS-03 Apollo | chest at world generation (DraedonStructures.FillWorkshopChest), rarity floor |  | 2 | worldgen DraedonStructures.FillWorkshopChest |
| Brimstone Elemental Suit `CalValEX:BrimmyBody` | CalValEX | Skeletron Prime | rarity guess | 5 | 1 |  |
| Brimstone Flames `CalValEX:BrimmySpirit` | CalValEX | Skeletron Prime | rarity guess | 5 | 1 |  |
| Essence Of A Singularity `StarsAbove:EssenceOfASingularity` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Absolute Chaos `StarsAbove:EssenceOfAbsoluteChaos` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Adagium `StarsAbove:EssenceOfAdagium` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Ash `StarsAbove:EssenceOfAsh` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Authority `StarsAbove:EssenceOfAuthority` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Azakana `StarsAbove:EssenceOfAzakana` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Balance `StarsAbove:EssenceOfBalance` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Bitterfrost `StarsAbove:EssenceOfBitterfrost` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Blasting `StarsAbove:EssenceOfBlasting` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Blood `StarsAbove:EssenceOfBlood` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Butterflies `StarsAbove:EssenceOfButterflies` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Chemtech `StarsAbove:EssenceOfChemtech` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence Of Chionic Energy `StarsAbove:EssenceOfChionicEnergy` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence Of Dancing Seas `StarsAbove:EssenceOfDancingSeas` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Death's Apprentice `StarsAbove:EssenceOfDeathsApprentice` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Despair `StarsAbove:EssenceOfDespair` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Destiny `StarsAbove:EssenceOfDestiny` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence Of Dreams `StarsAbove:EssenceOfDreams` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Driving Thunder `StarsAbove:EssenceOfDrivingThunder` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Duality `StarsAbove:EssenceOfDuality` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence Of Energy `StarsAbove:EssenceOfEnergy` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Eternity `StarsAbove:EssenceOfEternity` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Explosions `StarsAbove:EssenceOfExplosions` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Fingers `StarsAbove:EssenceOfFingers` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence Of Firepower `StarsAbove:EssenceOfFirepower` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Foxfire `StarsAbove:EssenceOfFoxfire` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Gold `StarsAbove:EssenceOfGold` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Hope `StarsAbove:EssenceOfIRyS` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence Of Hydro `StarsAbove:EssenceOfHydro` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Ink `StarsAbove:EssenceOfInk` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Izanagi `StarsAbove:EssenceOfIzanagi` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence Of Kinetics `StarsAbove:EssenceOfKinetics` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence Of Kingslaying `StarsAbove:EssenceOfKingslaying` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Liberation `StarsAbove:EssenceOfLiberation` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Lifethirsting `StarsAbove:EssenceOfLifethirsting` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Lightning `StarsAbove:EssenceOfLightning` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Luminance `StarsAbove:EssenceOfLuminance` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Lunar Dominion `StarsAbove:EssenceOfLunarDominion` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Mania `StarsAbove:EssenceOfMania` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence Of Mew `StarsAbove:EssenceOfCookies` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Misery `StarsAbove:EssenceOfMisery` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Nature `StarsAbove:EssenceOfNature` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence Of Necrosis `StarsAbove:EssenceOfNecrosis` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Outer Gods `StarsAbove:EssenceOfOuterGods` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Piracy `StarsAbove:EssenceOfPiracy` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Quantum `StarsAbove:EssenceOfQuantum` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Radiance `StarsAbove:EssenceOfRadiance` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Sakura `StarsAbove:EssenceOfSakura` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Silence `StarsAbove:EssenceOfSilence` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Silver Ash `StarsAbove:EssenceOfSilverAsh` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Sin `StarsAbove:EssenceOfSin` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Souls `StarsAbove:EssenceOfSouls` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence Of Spinning `StarsAbove:EssenceOfSpinning` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Static Shock `StarsAbove:EssenceOfStaticShock` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Style `StarsAbove:EssenceOfStyle` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence Of Sugar `StarsAbove:EssenceOfSugar` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Surpassing Limits `StarsAbove:EssenceOfSurpassingLimits` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Surya `StarsAbove:EssenceOfSurya` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Technology `StarsAbove:EssenceOfTechnology` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of the Abyss `StarsAbove:EssenceOfTheAbyss` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of the Aegis `StarsAbove:EssenceOfTheAegis` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of the Aerial Ace `StarsAbove:EssenceOfTheAerialAce` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of the Alpha `StarsAbove:EssenceOfAlpha` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of the Anomaly `StarsAbove:EssenceOfTheAnomaly` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of the Ascendant `StarsAbove:EssenceOfTheAscendant` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of the Automaton `StarsAbove:EssenceOfTheAutomaton` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of the Beginning and End `StarsAbove:EssenceOfTheBeginningAndEnd` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of the Behemoth Typhoon `StarsAbove:EssenceOfTheBehemothTyphoon` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of the Bionis `StarsAbove:EssenceOfTheBionis` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of the Bull `StarsAbove:EssenceOfTheBull` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of the Chimera `StarsAbove:EssenceOfTheChimera` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of the Cosmos `StarsAbove:EssenceOfTheCosmos` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence Of The Dark Maker `StarsAbove:EssenceOfTheDarkMaker` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of the Dark Moon `StarsAbove:EssenceOfTheDarkMoon` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence Of The Dragon `StarsAbove:EssenceOfTheDragon` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of the Dragonslayer `StarsAbove:EssenceOfTheDragonslayer` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of the Fallen `StarsAbove:EssenceOfTheFallen` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of The Freeshooter `StarsAbove:EssenceOfTheFreeshooter` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of the Future `StarsAbove:EssenceOfTheFuture` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of the Gardener `StarsAbove:EssenceOfTheGardener` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence Of The Hallownest `StarsAbove:EssenceOfTheHallownest` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of the Harbinger `StarsAbove:EssenceOfTheHarbinger` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of the Hawkmoon `StarsAbove:EssenceOfTheHawkmoon` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of the Hollowheart `StarsAbove:EssenceOfTheHollowheart` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of the Hunt `StarsAbove:EssenceOfTheHunt` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence Of The Huntress `StarsAbove:EssenceOfTheHuntress` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of The Moonlit Adepti `StarsAbove:EssenceOfTheMoonlitAdepti` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of the Observatory `StarsAbove:EssenceOfTheObservatory` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of the Overwhelming Blaze `StarsAbove:EssenceOfTheOverwhelmingBlaze` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of The Pegasus `StarsAbove:EssenceOfThePegasus` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of the Phantom `StarsAbove:EssenceOfThePhantom` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence Of The Phoenix `StarsAbove:EssenceOfThePhoenix` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of the Renegade `StarsAbove:EssenceOfTheRenegade` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence Of The Rifle `StarsAbove:EssenceOfTheRifle` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of The Sharpshooter `StarsAbove:EssenceOfTheSharpshooter` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence Of The Shield `StarsAbove:EssenceOfTheShield` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence Of The Soldier `StarsAbove:EssenceOfTheSoldier` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence Of The Stars `StarsAbove:EssenceOfTheStars` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of the Swarm `StarsAbove:EssenceOfTheSwarm` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of the Timeless `StarsAbove:EssenceOfTheTimeless` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of the Treasury `StarsAbove:EssenceOfTheTreasury` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of the Unyielding Earth `StarsAbove:EssenceOfTheUnyieldingEarth` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence Of The Void `StarsAbove:EssenceOfTheVoid` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of the Watch `StarsAbove:EssenceOfTheWatch` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence Of The White Night `StarsAbove:EssenceOfTheWhiteNight` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Time `StarsAbove:EssenceOfTime` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Twin Stars `StarsAbove:EssenceOfTwinStars` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Essence of Vampirism `StarsAbove:EssenceOfVampirism` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |
| Fusion Module `XDContentMod:FusionModule` | XDContentMod | Golem | rarity guess | 7 | 1 |  |
| Gold Butterfly `v:2891` | Terraria | Eater of Worlds / Brain of Cthulhu | rarity guess | 3 | 1 |  |
| Jewel Egg `SOTS:WonderEgg` | SOTS | Eater of Worlds / Brain of Cthulhu | rarity guess | 3 | 1 |  |
| Legendary Chainmail `ThoriumMod:LegendaryChainmail` | ThoriumMod | Eye of Cthulhu | rarity guess | 2 | 1 |  |
| Legendary Greaves `ThoriumMod:LegendaryGreaves` | ThoriumMod | Eye of Cthulhu | rarity guess | 2 | 1 |  |
| Legendary Helmet `ThoriumMod:LegendaryHelmet` | ThoriumMod | Eye of Cthulhu | rarity guess | 2 | 1 |  |
| Lunar Coin `InfernumMode:LunarCoin` | InfernumMode | unknown | no rarity, no evidence |  | 1 |  |
| Nether Spirit `CalValEX:SignusNether` | CalValEX | unknown | no rarity, no evidence |  | 1 |  |
| Pink Petal `SOTS:InvidiaPetal` | SOTS | Eater of Worlds / Brain of Cthulhu | rarity guess | 3 | 1 |  |
| Spatial Memoriam `StarsAbove:SpatialMemoriam` | StarsAbove | Moon Lord | rarity guess | 10 | 1 |  |

## Equipment with a guessed stage

### ThoriumMod (259)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Aloe Leaf `ThoriumMod:AloeLeaf` | accessory | Eye of Cthulhu | rarity guess | Green |  |
| Arsenal Staff `ThoriumMod:ArsenalStaff` | weapon (summon) | Eye of Cthulhu | rarity guess | Green |  |
| Bat Scythe `ThoriumMod:BatScythe` | weapon (healer) | Eye of Cthulhu | rarity guess | Green |  |
| Bat Wing `ThoriumMod:BatWing` | weapon (melee) | Eye of Cthulhu | rarity guess | Green |  |
| Bloody Wand `ThoriumMod:BloodyWand` | weapon (magic) | Eye of Cthulhu | rarity guess | Green |  |
| Buccaneer's Blunderbuss `ThoriumMod:BuccaneerBlunderBuss` | weapon (ranged) | Eye of Cthulhu | rarity guess | Green |  |
| Conch Shell `ThoriumMod:ConchShell` | weapon (bard) | Eye of Cthulhu | rarity guess | Green |  |
| Cursed Sawblade `ThoriumMod:SawbladeCursed` | weapon (ranged) | Eye of Cthulhu | rarity guess | Green |  |
| Dazzling Sawblade `ThoriumMod:SawbladeLight` | weapon (ranged) | Eye of Cthulhu | rarity guess | Green |  |
| Fragrant Corsage `ThoriumMod:FragrantCorsage` | accessory | Eye of Cthulhu | rarity guess | Green |  |
| Frozen Sawblade `ThoriumMod:SawbladeFrozen` | weapon (ranged) | Eye of Cthulhu | rarity guess | Green |  |
| Giant Glowstick `ThoriumMod:GiantGlowstick` | weapon (melee) | Eye of Cthulhu | rarity guess | Green |  |
| Guano Gunner `ThoriumMod:GuanoGunner` | weapon (ranged) | Eye of Cthulhu | rarity guess | Green |  |
| Hollow's Ring `ThoriumMod:HollowRing` | accessory | Eye of Cthulhu | rarity guess | Green |  |
| Jelly Pond Wand `ThoriumMod:JellyPondWand` | weapon (magic) | Eye of Cthulhu | rarity guess | Green |  |
| Life Quartz Claymore `ThoriumMod:LifeQuartzClaymore` | weapon (healer) | Eye of Cthulhu | rarity guess | Green |  |
| Life Quartz Shield `ThoriumMod:LifeQuartzShield` | accessory | Eye of Cthulhu | rarity guess | Green |  |
| Man Hacker `ThoriumMod:ManHacker` | weapon (ranged) | Eye of Cthulhu | rarity guess | Green |  |
| Molten Sawblade `ThoriumMod:SawbladeMolten` | weapon (ranged) | Eye of Cthulhu | rarity guess | Green |  |
| Moonlight `ThoriumMod:Moonlight` | weapon (melee) | Eye of Cthulhu | rarity guess | Green |  |
| Phantom Camera `ThoriumMod:PhantomCamera` | weapon (magic) | Eye of Cthulhu | rarity guess | Green |  |
| Sawblade `ThoriumMod:Sawblade` | weapon (ranged) | Eye of Cthulhu | rarity guess | Green |  |
| Sonar Cannon `ThoriumMod:SonarCannon` | weapon (bard) | Eye of Cthulhu | rarity guess | Green |  |
| Sparking Jelly Ball `ThoriumMod:SparkingJellyBall` | weapon (melee) | Eye of Cthulhu | rarity guess | Green |  |
| Strange Skull `ThoriumMod:StrangeSkull` | weapon (summon) | Eye of Cthulhu | rarity guess | Green |  |
| The Ring `ThoriumMod:TheRing` | accessory | Eye of Cthulhu | rarity guess | Green |  |
| Totem Caller `ThoriumMod:TotemCaller` | weapon (summon) | Eye of Cthulhu | rarity guess | Green |  |
| Up-Down Balloon `ThoriumMod:UpDownBalloon` | accessory | Eye of Cthulhu | rarity guess | Green |  |
| Vampire Scepter `ThoriumMod:VampireScepter` | weapon (magic) | Eye of Cthulhu | rarity guess | Green |  |
| Vile Sawblade `ThoriumMod:SawbladeIchor` | weapon (ranged) | Eye of Cthulhu | rarity guess | Green |  |
| Viscount's Cane `ThoriumMod:ViscountCane` | weapon (summon) | Eye of Cthulhu | rarity guess | Green |  |
| Whip `ThoriumMod:Whip` | weapon (melee) | Eye of Cthulhu | rarity guess | Green |  |
| Boulder Probe Staff `ThoriumMod:BoulderProbeStaff` | weapon (summon) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Champion's Bomber Staff `ThoriumMod:ChampionBomberStaff` | weapon (magic) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Champion's God Hand `ThoriumMod:ChampionsGodHand` | weapon (thrower) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Champion's Rebuttal `ThoriumMod:ChampionsRebuttal` | accessory | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Champion's Swift Blade `ThoriumMod:ChampionSwiftBlade` | weapon (melee) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Champion's Trifecta-Shot `ThoriumMod:ChampionsTrifectaShot` | weapon (ranged) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Distress Caller `ThoriumMod:DistressCaller` | weapon (summon) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Energy Projector `ThoriumMod:EnergyProjector` | weapon (magic) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Energy Storm Bolter `ThoriumMod:EnergyStormBolter` | weapon (ranged) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Energy Storm Partisan `ThoriumMod:EnergyStormPartisan` | weapon (melee) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Gauss Flinger `ThoriumMod:GaussFlinger` | weapon (thrower) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Hellfire Minigun `ThoriumMod:HellfireMinigun` | weapon (ranged) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Hit Scanner `ThoriumMod:HitScanner` | weapon (ranged) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Honey Heart `ThoriumMod:HoneyHeart` | accessory | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Infernal Animator `ThoriumMod:InfernalAnimator` | weapon (summon) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Music Player Damage `ThoriumMod:MusicPlayerDamage` | accessory | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Music Player Damage Reduction `ThoriumMod:MusicPlayerDamageReduction` | accessory | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Music Player Life Regen `ThoriumMod:MusicPlayerLifeRegen` | accessory | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Music Player Movement Speed `ThoriumMod:MusicPlayerMovementSpeed` | accessory | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Obsidian Staff `ThoriumMod:ObsidianStaff` | weapon (magic) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Particle Whip `ThoriumMod:ParticleWhip` | weapon (magic) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Pocket Fusion Generator `ThoriumMod:PocketFusionGenerator` | accessory | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Pollen Pike `ThoriumMod:PollenPike` | weapon (melee) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Roboboe `ThoriumMod:Roboboe` | weapon (bard) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Shock Absorber `ThoriumMod:ShockAbsorber` | accessory | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Star Trail `ThoriumMod:StarTrail` | weapon (melee) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Thor's Hammer: Magic `ThoriumMod:MagicThorHammer` | weapon (magic) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Thor's Hammer: Ranged `ThoriumMod:RangedThorHammer` | weapon (ranged) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Adamantite Ricochet `ThoriumMod:AdamantiteGlaive` | weapon (thrower) | Wall of Flesh | rarity guess | Light Red |  |
| Aphrodisiac Vial `ThoriumMod:AphrodisiacVial` | weapon (thrower) | Wall of Flesh | rarity guess | Light Red |  |
| Balance Bloom `ThoriumMod:BalanceBloom` | weapon (healer) | Wall of Flesh | rarity guess | Light Red |  |
| Bard Emblem `ThoriumMod:BardEmblem` | accessory | Wall of Flesh | rarity guess | Light Red |  |
| Cleric Emblem `ThoriumMod:ClericEmblem` | accessory | Wall of Flesh | rarity guess | Light Red |  |
| Cobalt Throwing Spear `ThoriumMod:CobaltThrowingSpear` | weapon (thrower) | Wall of Flesh | rarity guess | Light Red |  |
| Combustion Vial `ThoriumMod:CombustionFlask` | weapon (thrower) | Wall of Flesh | rarity guess | Light Red |  |
| Corrosive Vial `ThoriumMod:CorrosionBeaker` | weapon (thrower) | Wall of Flesh | rarity guess | Light Red |  |
| Corrupter's Balloon `ThoriumMod:CorrupterBalloon` | weapon (thrower) | Wall of Flesh | rarity guess | Light Red |  |
| Crystal Balloon `ThoriumMod:CrystalBalloon` | weapon (thrower) | Wall of Flesh | rarity guess | Light Red |  |
| Cupid's String `ThoriumMod:CupidString` | weapon (ranged) | Wall of Flesh | rarity guess | Light Red |  |
| Cursed Hammer `ThoriumMod:CursedHammer` | weapon (healer) | Wall of Flesh | rarity guess | Light Red |  |
| Draconic Magma Staff `ThoriumMod:DraconicMagmaStaff` | weapon (summon) | Wall of Flesh | rarity guess | Light Red |  |
| Ebony Tail `ThoriumMod:EbonyTail` | weapon (melee) | Wall of Flesh | rarity guess | Light Red | drop Sand Poacher; drop Sand Poacher |
| Festering Balloon `ThoriumMod:FesteringBalloon` | weapon (thrower) | Wall of Flesh | rarity guess | Light Red |  |
| Gas Container `ThoriumMod:GasContainer` | weapon (thrower) | Wall of Flesh | rarity guess | Light Red |  |
| Geomancer's Brush `ThoriumMod:GeomancersBrush` | weapon (magic) | Wall of Flesh | rarity guess | Light Red |  |
| Heaven's Gate `ThoriumMod:HeavensGate` | weapon (magic) | Wall of Flesh | rarity guess | Light Red |  |
| Lady's Light `ThoriumMod:LadyLight` | weapon (summon) | Wall of Flesh | rarity guess | Light Red |  |
| Mantle of the Protector `ThoriumMod:MantleoftheProtector` | accessory | Wall of Flesh | rarity guess | Light Red |  |
| Master's Libram `ThoriumMod:MastersLibram` | weapon (summon) | Wall of Flesh | rarity guess | Light Red |  |
| Night Staff `ThoriumMod:NightStaff` | weapon (magic) | Wall of Flesh | rarity guess | Light Red |  |
| Ninja Emblem `ThoriumMod:NinjaEmblem` | accessory | Wall of Flesh | rarity guess | Light Red |  |
| Nitrogen Vial `ThoriumMod:NitrogenVial` | weapon (thrower) | Wall of Flesh | rarity guess | Light Red |  |
| Omniwrench `ThoriumMod:Omniwrench` | weapon (thrower) | Wall of Flesh | rarity guess | Light Red |  |
| Palladium Throwing Spear `ThoriumMod:PalladiumThrowingSpear` | weapon (thrower) | Wall of Flesh | rarity guess | Light Red |  |
| Resonator's Arm `ThoriumMod:ResonatorsArm` | weapon (bard) | Wall of Flesh | rarity guess | Light Red |  |
| Saba `ThoriumMod:Saba` | weapon (melee) | Wall of Flesh | rarity guess | Light Red |  |
| Shu's Wrath `ThoriumMod:ShusWrath` | weapon (ranged) | Wall of Flesh | rarity guess | Light Red |  |
| Stellar Rod `ThoriumMod:StellarRod` | weapon (summon) | Wall of Flesh | rarity guess | Light Red |  |
| Titanium Ricochet `ThoriumMod:TitaniumGlaive` | weapon (thrower) | Wall of Flesh | rarity guess | Light Red |  |
| Useless Staff `ThoriumMod:UselessStaff` | weapon (magic) | Wall of Flesh | rarity guess | Light Red |  |
| 24-Carat Tuba `ThoriumMod:TwentyFourCaratTuba` | weapon (bard) | Skeletron Prime | rarity guess | Pink |  |
| Arthropod `ThoriumMod:Arthropod` | weapon (melee) | Skeletron Prime | rarity guess | Pink |  |
| Beholder Staff `ThoriumMod:BeholderStaff` | weapon (summon) | Skeletron Prime | rarity guess | Pink |  |
| Beholder's Gaze `ThoriumMod:BeholderGaze` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Blizzard Pouch `ThoriumMod:BlizzardPouch` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Bloody High Claw `ThoriumMod:BloodyHighClaws` | weapon (melee) | Skeletron Prime | rarity guess | Pink |  |
| Borean Fang Staff `ThoriumMod:BoreanFangStaff` | weapon (magic) | Skeletron Prime | rarity guess | Pink |  |
| Cello `ThoriumMod:Cello` | weapon (bard) | Skeletron Prime | rarity guess | Pink |  |
| Charged Splasher `ThoriumMod:ChargedSplasher` | weapon (ranged) | Skeletron Prime | rarity guess | Pink |  |
| Drider's Grace `ThoriumMod:DridersGrace` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Dutchman's Avarice `ThoriumMod:DutchmansAvarice` | weapon (magic) | Skeletron Prime | rarity guess | Pink |  |
| Freeze Ray `ThoriumMod:FreezeRay` | weapon (ranged) | Skeletron Prime | rarity guess | Pink |  |
| Glacial Sting `ThoriumMod:GlacialSting` | weapon (ranged) | Skeletron Prime | rarity guess | Pink |  |
| Glacier `ThoriumMod:Glacier` | weapon (melee) | Skeletron Prime | rarity guess | Pink |  |
| Greedful Gurdy `ThoriumMod:GreedfulGurdy` | weapon (bard) | Skeletron Prime | rarity guess | Pink |  |
| Guilty Pleasure `ThoriumMod:GuiltyPleasure` | weapon (bard) | Skeletron Prime | rarity guess | Pink |  |
| Hand Cannon `ThoriumMod:HandCannon` | weapon (ranged) | Skeletron Prime | rarity guess | Pink |  |
| Hell Roller `ThoriumMod:HellRoller` | weapon (thrower) | Skeletron Prime | rarity guess | Pink |  |
| Hellish Halberd `ThoriumMod:HellishHalberd` | weapon (melee) | Skeletron Prime | rarity guess | Pink |  |
| Ice Bound Strider Hide `ThoriumMod:IceBoundStriderHide` | accessory | Skeletron Prime | rarity guess | Pink | bag Borean Strider Treasure Bag |
| Icy Gaze `ThoriumMod:IcyGaze` | weapon (magic) | Skeletron Prime | rarity guess | Pink |  |
| Metabolic Pills `ThoriumMod:MetabolicPills` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Mineral Launcher `ThoriumMod:MineralLauncher` | weapon (ranged) | Skeletron Prime | rarity guess | Pink |  |
| Mirror of the Beholder `ThoriumMod:MirroroftheBeholder` | accessory | Skeletron Prime | rarity guess | Pink | bag Fallen Beholder Treasure Bag |
| Obliterator `ThoriumMod:Obliterator` | weapon (ranged) | Skeletron Prime | rarity guess | Pink |  |
| Omega Blaster `ThoriumMod:OmegaBlaster` | weapon (magic) | Skeletron Prime | rarity guess | Pink |  |
| Plasma Staff `ThoriumMod:PlasmaStaff` | weapon (magic) | Skeletron Prime | rarity guess | Pink |  |
| Portable Wintergatan `ThoriumMod:PortableWintergatan` | weapon (bard) | Skeletron Prime | rarity guess | Pink |  |
| Pyroclast Staff `ThoriumMod:PyroclastStaff` | weapon (magic) | Skeletron Prime | rarity guess | Pink |  |
| Sacred Heart `ThoriumMod:SacredHeart` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Ship's Helm `ThoriumMod:ShipsHelm` | weapon (melee) | Skeletron Prime | rarity guess | Pink |  |
| Shockbuster `ThoriumMod:Shockbuster` | weapon (ranged) | Skeletron Prime | rarity guess | Pink |  |
| Smiting Hammer `ThoriumMod:SmitingHammer` | weapon (healer) | Skeletron Prime | rarity guess | Pink |  |
| Static Prod `ThoriumMod:StaticProd` | weapon (magic) | Skeletron Prime | rarity guess | Pink |  |
| Stellar System `ThoriumMod:StellarSystem` | weapon (summon) | Skeletron Prime | rarity guess | Pink |  |
| The Cryo-Fang `ThoriumMod:TheCryoFang` | weapon (thrower) | Skeletron Prime | rarity guess | Pink |  |
| The Juggernaut `ThoriumMod:TheJuggernaut` | weapon (melee) | Skeletron Prime | rarity guess | Pink |  |
| Tune Player Damage `ThoriumMod:TunePlayerDamage` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Tune Player Damage Reduction `ThoriumMod:TunePlayerDamageReduction` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Tune Player Life Regen `ThoriumMod:TunePlayerLifeRegen` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Tune Player Movement Speed `ThoriumMod:TunePlayerMovementSpeed` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Zunpet `ThoriumMod:Zunpet` | weapon (bard) | Skeletron Prime | rarity guess | Pink |  |
| Bass Booster `ThoriumMod:BassBooster` | weapon (magic) | Plantera | rarity guess | Light Purple |  |
| Cadaver's Cornet `ThoriumMod:CadaverCornet` | weapon (bard) | Plantera | rarity guess | Light Purple |  |
| Cape of the Survivor `ThoriumMod:CapeoftheSurvivor` | accessory | Plantera | rarity guess | Light Purple |  |
| Climber's Ice Axe `ThoriumMod:ClimbersIceAxe` | weapon (melee) | Plantera | rarity guess | Light Purple |  |
| Decaying Sorrow `ThoriumMod:DecayingSorrow` | weapon (ranged) | Plantera | rarity guess | Light Purple |  |
| Golden Locks `ThoriumMod:GoldenLocks` | weapon (melee) | Plantera | rarity guess | Light Purple |  |
| Jetstream Sheath `ThoriumMod:JetstreamSheath` | accessory | Plantera | rarity guess | Light Purple |  |
| Little Red `ThoriumMod:LittleRed` | weapon (ranged) | Plantera | rarity guess | Light Purple |  |
| Phantom Wand `ThoriumMod:PhantomWand` | weapon (summon) | Plantera | rarity guess | Light Purple |  |
| Snow White `ThoriumMod:SnowWhite` | weapon (magic) | Plantera | rarity guess | Light Purple |  |
| Soul Cleaver `ThoriumMod:SoulCleaver` | weapon (thrower) | Plantera | rarity guess | Light Purple |  |
| Soul Render `ThoriumMod:SoulRender` | weapon (melee) | Plantera | rarity guess | Light Purple |  |
| Subspace Wings `ThoriumMod:SubspaceWings` | accessory | Plantera | rarity guess | Light Purple |  |
| Sweet Vengeance `ThoriumMod:SweetVengeance` | accessory | Plantera | rarity guess | Light Purple |  |
| The Lost Cross `ThoriumMod:TheLostCross` | accessory | Plantera | rarity guess | Light Purple |  |
| Titan Breastplate `ThoriumMod:TitanBreastplate` | body | Plantera | rarity guess | Light Purple |  |
| Titan Greaves `ThoriumMod:TitanGreaves` | legs | Plantera | rarity guess | Light Purple |  |
| Titan Headgear `ThoriumMod:TitanHeadgear` | head | Plantera | rarity guess | Light Purple |  |
| Titan Helmet `ThoriumMod:TitanHelmet` | head | Plantera | rarity guess | Light Purple |  |
| Titan Mask `ThoriumMod:TitanMask` | head | Plantera | rarity guess | Light Purple |  |
| Titan Wings `ThoriumMod:TitanWings` | accessory | Plantera | rarity guess | Light Purple |  |
| Valkyrie Blade `ThoriumMod:ValkyrieBlade` | weapon (summon) | Plantera | rarity guess | Light Purple |  |
| Wither Staff `ThoriumMod:WitherStaff` | weapon (magic) | Plantera | rarity guess | Light Purple |  |
| Wondrous Wand `ThoriumMod:WondrousWand` | weapon (magic) | Plantera | rarity guess | Light Purple |  |
| Dark Flame `ThoriumMod:DarkFlame` | weapon (magic) | Golem | rarity guess | Lime |  |
| Flawless Chrysalis `ThoriumMod:FlawlessChrysalis` | accessory | Golem | rarity guess | Lime |  |
| Razorlash `ThoriumMod:Razorlash` | weapon (magic) | Golem | rarity guess | Lime |  |
| Scythe of Undoing `ThoriumMod:ScytheofUndoing` | weapon (healer) | Golem | rarity guess | Lime |  |
| Strawberry Heart `ThoriumMod:StrawberryHeart` | weapon (bard) | Golem | rarity guess | Lime |  |
| Turtle Drums `ThoriumMod:TurtleDrum` | weapon (bard) | Golem | rarity guess | Lime |  |
| Verdant Ornament `ThoriumMod:VerdantOrnament` | accessory | Golem | rarity guess | Lime |  |
| Vuvuzela Blue `ThoriumMod:VuvuzelaBlue` | weapon (bard) | Golem | rarity guess | Lime |  |
| Abyssal Shell `ThoriumMod:AbyssalShell` | accessory | Duke Fishron | rarity guess | Yellow | bag Forgotten One Treasure Bag |
| Beetle Blaster `ThoriumMod:BeetleBlaster` | weapon (ranged) | Duke Fishron | rarity guess | Yellow |  |
| Betsy's Bellow `ThoriumMod:BetsysBellow` | weapon (bard) | Duke Fishron | rarity guess | Yellow |  |
| Bloody Pagan Staff `ThoriumMod:BloodyPaganStaff` | weapon (summon) | Duke Fishron | rarity guess | Yellow |  |
| Brinefang `ThoriumMod:Brinefang` | weapon (thrower) | Duke Fishron | rarity guess | Yellow |  |
| Buffalo Launcher `ThoriumMod:BuffaloLauncher` | weapon (ranged) | Duke Fishron | rarity guess | Yellow |  |
| Call of Cthulhu `ThoriumMod:CallofCthulhu` | weapon (bard) | Duke Fishron | rarity guess | Yellow |  |
| Cosmic Dagger `ThoriumMod:CosmicDagger` | weapon (thrower) | Duke Fishron | rarity guess | Yellow |  |
| Dark Grip `ThoriumMod:DarkGrip` | weapon (magic) | Duke Fishron | rarity guess | Yellow |  |
| Demon Blood Bow `ThoriumMod:DemonBloodBow` | weapon (ranged) | Duke Fishron | rarity guess | Yellow |  |
| DMR `ThoriumMod:DMR` | weapon (ranged) | Duke Fishron | rarity guess | Yellow |  |
| Dragon Fang `ThoriumMod:DragonFang` | weapon (thrower) | Duke Fishron | rarity guess | Yellow |  |
| Duke's Regal Carnyx `ThoriumMod:DukesRegalCarnyx` | weapon (bard) | Duke Fishron | rarity guess | Yellow |  |
| Erupting Flare `ThoriumMod:EruptingFlare` | weapon (magic) | Duke Fishron | rarity guess | Yellow |  |
| Eye of Odin `ThoriumMod:EyeofOdin` | weapon (summon) | Duke Fishron | rarity guess | Yellow |  |
| Fishbone `ThoriumMod:Fishbone` | weapon (bard) | Duke Fishron | chest at world generation (WorldGenerationSystem.GenerateBiomeChests), rarity floor | Yellow | worldgen WorldGenerationSystem.GenerateBiomeChests |
| Friendly-Fire Staff `ThoriumMod:FriendlyFireStaff` | weapon (healer) | Duke Fishron | rarity guess | Yellow |  |
| Gardener's Sheath `ThoriumMod:GardenersSheath` | accessory | Duke Fishron | rarity guess | Yellow |  |
| Ghastly Carapace `ThoriumMod:GhastlyCarapace` | accessory | Duke Fishron | rarity guess | Yellow |  |
| God Killer `ThoriumMod:GodKiller` | weapon (magic) | Duke Fishron | rarity guess | Yellow |  |
| Golem's Gaze `ThoriumMod:GolemsGaze` | weapon (melee) | Duke Fishron | rarity guess | Yellow |  |
| Holy Hammer `ThoriumMod:HolyHammer` | weapon (healer) | Duke Fishron | rarity guess | Yellow |  |
| Hungering Blossom `ThoriumMod:HungeringBlossom` | accessory | Duke Fishron | rarity guess | Yellow |  |
| Idol's Microphone `ThoriumMod:IdolsMicrophone` | weapon (bard) | Duke Fishron | rarity guess | Yellow |  |
| Kineto-scythe `ThoriumMod:Kinetoscythe` | weapon (healer) | Duke Fishron | rarity guess | Yellow |  |
| Legacy `ThoriumMod:Legacy` | weapon (magic) | Duke Fishron | rarity guess | Yellow |  |
| Lightning Staff `ThoriumMod:LightningStaff` | weapon (magic) | Duke Fishron | rarity guess | Yellow |  |
| Lingering Will `ThoriumMod:LingeringWill` | weapon (melee) | Duke Fishron | rarity guess | Yellow |  |
| Livewire Crasher `ThoriumMod:LivewireCrasher` | weapon (melee) | Duke Fishron | rarity guess | Yellow |  |
| Mantis Shrimp Punch `ThoriumMod:MantisShrimpPunch` | weapon (melee) | Duke Fishron | rarity guess | Yellow |  |
| Nova Rifle `ThoriumMod:NovaRifle` | weapon (ranged) | Duke Fishron | rarity guess | Yellow |  |
| Old God's Vision `ThoriumMod:OldGodsVision` | weapon (magic) | Duke Fishron | rarity guess | Yellow |  |
| Phantom Arm Cannon `ThoriumMod:PhantomArmCannon` | weapon (ranged) | Duke Fishron | rarity guess | Yellow |  |
| Pharaoh's Slab `ThoriumMod:PharaohsSlab` | weapon (thrower) | Duke Fishron | chest at world generation (ThoriumWorld.PostWorldGen), rarity floor | Yellow | worldgen ThoriumWorld.PostWorldGen |
| Pill Popper `ThoriumMod:PillPopper` | weapon (healer) | Duke Fishron | rarity guess | Yellow |  |
| Plasma Generator `ThoriumMod:PlasmaGenerator` | accessory | Duke Fishron | rarity guess | Yellow |  |
| Plasma Vial `ThoriumMod:PlasmaVial` | weapon (thrower) | Duke Fishron | rarity guess | Yellow |  |
| Rude Wand `ThoriumMod:RudeWand` | weapon (summon) | Duke Fishron | rarity guess | Yellow |  |
| Shadow-Flare Bow `ThoriumMod:ShadowFlareBow` | weapon (ranged) | Duke Fishron | rarity guess | Yellow |  |
| Shinobi Sigil `ThoriumMod:ShinobiSigil` | accessory | Duke Fishron | rarity guess | Yellow |  |
| Siren's Lyre `ThoriumMod:SirensLyre` | weapon (bard) | Duke Fishron | rarity guess | Yellow |  |
| Soul Reaver `ThoriumMod:SoulReaver` | weapon (melee) | Duke Fishron | rarity guess | Yellow |  |
| Spirit Breaker `ThoriumMod:SpiritBreaker` | weapon (ranged) | Duke Fishron | rarity guess | Yellow |  |
| Super Plasma Cannon `ThoriumMod:SuperPlasmaCannon` | weapon (magic) | Duke Fishron | rarity guess | Yellow |  |
| The Black Blade `ThoriumMod:TheBlackBlade` | weapon (melee) | Duke Fishron | rarity guess | Yellow |  |
| The Black Bow `ThoriumMod:TheBlackBow` | weapon (ranged) | Duke Fishron | rarity guess | Yellow |  |
| The Black Cane `ThoriumMod:TheBlackCane` | weapon (summon) | Duke Fishron | rarity guess | Yellow |  |
| The Black Dagger `ThoriumMod:TheBlackDagger` | weapon (thrower) | Duke Fishron | rarity guess | Yellow |  |
| The Black Otamatone `ThoriumMod:TheBlackOtamatone` | weapon (bard) | Duke Fishron | rarity guess | Yellow |  |
| The Black Scythe `ThoriumMod:TheBlackScythe` | weapon (healer) | Duke Fishron | rarity guess | Yellow |  |
| The Black Staff `ThoriumMod:TheBlackStaff` | weapon (magic) | Duke Fishron | rarity guess | Yellow |  |
| The Incubator `ThoriumMod:TheIncubator` | weapon (summon) | Duke Fishron | rarity guess | Yellow |  |
| The Massacre `ThoriumMod:TheMassacre` | weapon (ranged) | Duke Fishron | rarity guess | Yellow |  |
| The Triangle `ThoriumMod:TheTriangle` | weapon (bard) | Duke Fishron | rarity guess | Yellow |  |
| Trench Spitter `ThoriumMod:TrenchSpitter` | weapon (ranged) | Duke Fishron | rarity guess | Yellow |  |
| Turntable `ThoriumMod:Turntable` | weapon (bard) | Duke Fishron | rarity guess | Yellow |  |
| Umbra Blaster `ThoriumMod:UmbraBlaster` | weapon (ranged) | Duke Fishron | rarity guess | Yellow |  |
| Whispering Hood `ThoriumMod:WhisperingHood` | head | Duke Fishron | rarity guess | Yellow |  |
| Whispering Leggings `ThoriumMod:WhisperingLeggings` | legs | Duke Fishron | rarity guess | Yellow |  |
| Whispering Tabard `ThoriumMod:WhisperingTabard` | body | Duke Fishron | rarity guess | Yellow |  |
| Yuma's Pendant `ThoriumMod:YumasPendant` | accessory | Duke Fishron | rarity guess | Yellow |  |
| Ancient Flame `ThoriumMod:AncientFlame` | weapon (healer) | Lunatic Cultist | rarity guess | Cyan |  |
| Ancient Frost `ThoriumMod:AncientFrost` | weapon (magic) | Lunatic Cultist | rarity guess | Cyan |  |
| Ancient Spark `ThoriumMod:AncientSpark` | weapon (magic) | Lunatic Cultist | rarity guess | Cyan |  |
| Cataclysmic Garb `ThoriumMod:CataclysmicsGarb` | accessory | Lunatic Cultist | rarity guess | Cyan |  |
| Cosmic Flux Staff `ThoriumMod:CosmicFluxStaff` | weapon (healer) | Lunatic Cultist | rarity guess | Cyan |  |
| Eclipse Fang `ThoriumMod:EclipseFang` | weapon (melee) | Lunatic Cultist | rarity guess | Cyan |  |
| Halcandran Deluxe Apparel `ThoriumMod:HalcandranDeluxeApparel` | accessory | Lunatic Cultist | rarity guess | Cyan |  |
| Phonic Wings `ThoriumMod:PhonicWings` | accessory | Lunatic Cultist | rarity guess | Cyan |  |
| Angel's End `ThoriumMod:AngelsEnd` | weapon (thrower) | Moon Lord | rarity guess | Red |  |
| Arcane Spike `ThoriumMod:ArcaneSpike` | weapon (magic) | Moon Lord | rarity guess | Blood Orange |  |
| Basic Pickaxe `ThoriumMod:BasicPickaxe` | weapon (melee) | Moon Lord | rarity guess | Blood Orange |  |
| Black MIDI `ThoriumMod:BlackMIDI` | weapon (bard) | Moon Lord | rarity guess | Blood Orange |  |
| Blood & Glory `ThoriumMod:BloodGlory` | weapon (melee) | Moon Lord | rarity guess | Red |  |
| Cat's Eye Great Staff `ThoriumMod:CatsEyeGreatStaff` | weapon (magic) | Moon Lord | rarity guess | Red |  |
| Destiny Weaver `ThoriumMod:DestinyWeaver` | weapon (classless) | Moon Lord | rarity guess | Blood Orange |  |
| Emperor's Will `ThoriumMod:EmperorsWill` | weapon (ranged) | Moon Lord | rarity guess | Red |  |
| Essence of Flame `ThoriumMod:EssenceofFlame` | weapon (melee) | Moon Lord | rarity guess | Red |  |
| Fragment of Heaven `ThoriumMod:GodMode` | accessory | Moon Lord | rarity guess | Blood Orange |  |
| Inferno Lord's Focus `ThoriumMod:InfernoLordsFocus` | accessory | Moon Lord | rarity guess | Blood Orange |  |
| Life and Death `ThoriumMod:LifeAndDeath` | weapon (healer) | Moon Lord | rarity guess | Red |  |
| Nebula's Reflection `ThoriumMod:NebulaReflection` | weapon (summon) | Moon Lord | rarity guess | Red |  |
| Northern Light `ThoriumMod:NorthernLight` | weapon (magic) | Moon Lord | rarity guess | Blood Orange |  |
| Plague Lord's Flask `ThoriumMod:PlagueLordFlask` | accessory | Moon Lord | rarity guess | Blood Orange |  |
| Quake Gauntlet `ThoriumMod:QuakeGauntlet` | weapon (melee) | Moon Lord | rarity guess | Red |  |
| Quasar's Flare `ThoriumMod:QuasarsFlare` | weapon (ranged) | Moon Lord | rarity guess | Blood Orange |  |
| Shadow Orb Staff `ThoriumMod:ShadowOrbStaff` | weapon (summon) | Moon Lord | rarity guess | Red |  |
| Skadoosh `ThoriumMod:Skadoosh` | weapon (melee) | Moon Lord | rarity guess | Red |  |
| Sonic Amplifier `ThoriumMod:SonicAmplifier` | weapon (bard) | Moon Lord | rarity guess | Red |  |
| Soul Gem `ThoriumMod:SoulGem` | accessory | Moon Lord | rarity guess | Blood Orange |  |
| Teleologic Imposition `ThoriumMod:TeleologicImposition` | weapon (magic) | Moon Lord | rarity guess | Red |  |
| Terrarian's Last Knife `ThoriumMod:TerrariansLastKnife` | weapon (melee) | Moon Lord | rarity guess | Blood Orange |  |
| Unassuming Purple Stone `ThoriumMod:StonePurple` | weapon (other) | Moon Lord | rarity guess | Blood Orange |  |

### StarsAbove (128)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Adornment of the Chaotic God `StarsAbove:AdornmentOfTheChaoticGod` | weapon (summon) | Eye of Cthulhu | rarity guess | Green |  |
| Afterburner Wings `StarsAbove:AfterburnerWings` | accessory | Eye of Cthulhu | rarity guess | Green |  |
| Carian Dark Moon `StarsAbove:CarianDarkMoon` | weapon (other) | Eye of Cthulhu | rarity guess | Green |  |
| Irminsul's Dream `StarsAbove:IrminsulDream` | weapon (magic) | Eye of Cthulhu | rarity guess | Green |  |
| Konpaku Katana `StarsAbove:KonpakuKatana` | weapon (summon) | Eye of Cthulhu | rarity guess | Green |  |
| Legendary Shield `StarsAbove:LegendaryShield` | accessory | Eye of Cthulhu | rarity guess | Green |  |
| Melee Wings `StarsAbove:MeleeWings` | accessory | Eye of Cthulhu | rarity guess | Green |  |
| Orbital Expressway Plush `StarsAbove:OrbitalExpresswayPlush` | weapon (melee) | Eye of Cthulhu | rarity guess | Green |  |
| Pod Zero-42 `StarsAbove:PodZero42` | weapon (summon) | Eye of Cthulhu | rarity guess | Green |  |
| Shield Wings `StarsAbove:ShieldWings` | accessory | Eye of Cthulhu | rarity guess | Green |  |
| Sniper Wings `StarsAbove:SniperWings` | accessory | Eye of Cthulhu | rarity guess | Green |  |
| Trickspin Two-Step `StarsAbove:TrickspinTwoStep` | weapon (summon) | Eye of Cthulhu | rarity guess | Green |  |
| Ashen Ambition `StarsAbove:AshenAmbition` | weapon (melee) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Death In Four Acts `StarsAbove:DeathInFourActs` | weapon (ranged) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Der Freischutz `StarsAbove:DerFreischutz` | weapon (other) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Devoted Havoc `StarsAbove:DevotedHavoc` | weapon (ranged) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Gossamer Needle `StarsAbove:GossamerNeedle` | weapon (melee) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Misery's Company `StarsAbove:MiserysCompany` | weapon (melee) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Neo Dealmaker `StarsAbove:NeoDealmaker` | weapon (ranged) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Shock & Awe `StarsAbove:ShockAndAwe` | weapon (ranged) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Soliloquy Of Sovereign Seas `StarsAbove:SoliloquyOfSovereignSeas` | weapon (other) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| String of Curses `StarsAbove:StringOfCurses` | weapon (ranged) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Dragged Below `StarsAbove:DraggedBelow` | weapon (magic) | Wall of Flesh | rarity guess | Light Red |  |
| Dreadnought Chemtank `StarsAbove:DreadnoughtChemtank` | weapon (ranged) | Wall of Flesh | rarity guess | Light Red |  |
| Gund-bit Siege `StarsAbove:GundbitStaves` | weapon (magic) | Wall of Flesh | rarity guess | Light Red |  |
| Hunter's Symphony `StarsAbove:HunterSymphony` | weapon (magic) | Wall of Flesh | rarity guess | Light Red |  |
| Ruptured Heaven `StarsAbove:RupturedHeaven` | weapon (summon) | Wall of Flesh | rarity guess | Light Red |  |
| Sanguine Despair `StarsAbove:SanguineDespair` | weapon (magic) | Wall of Flesh | rarity guess | Light Red |  |
| Skofnung `StarsAbove:Skofnung` | weapon (melee) | Wall of Flesh | rarity guess | Light Red |  |
| Sparkblossom's Beacon `StarsAbove:SparkblossomBeacon` | weapon (summon) | Wall of Flesh | rarity guess | Light Red |  |
| Takonomicon `StarsAbove:AncientBook` | weapon (summon) | Wall of Flesh | rarity guess | Light Red |  |
| The Morning Star `StarsAbove:MorningStar` | weapon (summon) | Wall of Flesh | rarity guess | Light Red |  |
| Wavedancer `StarsAbove:Wavedancer` | weapon (summon) | Wall of Flesh | rarity guess | Light Red |  |
| Aurum Edge `StarsAbove:GoldenKatana` | weapon (other) | Skeletron Prime | rarity guess | Pink |  |
| Candied Sugar Ball `StarsAbove:CandiedSugarball` | weapon (summon) | Skeletron Prime | rarity guess | Pink |  |
| Chronoclock `StarsAbove:Chronoclock` | weapon (summon) | Skeletron Prime | rarity guess | Pink |  |
| Every Moment Matters `StarsAbove:EveryMomentMatters` | weapon (ranged) | Skeletron Prime | rarity guess | Pink |  |
| Hawkmoon `StarsAbove:Hawkmoon` | weapon (ranged) | Skeletron Prime | rarity guess | Pink |  |
| Hollowheart Albion `StarsAbove:HollowheartAlbion` | weapon (summon) | Skeletron Prime | rarity guess | Pink |  |
| Izanagi's Edge `StarsAbove:IzanagiEdge` | weapon (ranged) | Skeletron Prime | rarity guess | Pink |  |
| Kariumu's Favor `StarsAbove:BrilliantSpectrum` | weapon (other) | Skeletron Prime | rarity guess | Pink |  |
| Karlan Truesilver `StarsAbove:KarlanTruesilver` | weapon (melee) | Skeletron Prime | rarity guess | Pink |  |
| Kifrosse `StarsAbove:Kifrosse` | weapon (summon) | Skeletron Prime | rarity guess | Pink |  |
| Luminary Wand `StarsAbove:LuminaryWand` | weapon (summon) | Skeletron Prime | rarity guess | Pink |  |
| Wolvesbane `StarsAbove:Wolvesbane` | weapon (ranged) | Skeletron Prime | rarity guess | Pink |  |
| Memento Muse `StarsAbove:MementoMuse` | weapon (melee) | Plantera | rarity guess | Light Purple |  |
| Rad Gun `StarsAbove:RadGun` | weapon (other) | Plantera | rarity guess | Light Purple |  |
| Veneration Of Butterflies `StarsAbove:VenerationOfButterflies` | weapon (magic) | Plantera | rarity guess | Light Purple |  |
| Xenoblade `StarsAbove:Xenoblade` | weapon (melee) | Plantera | rarity guess | Light Purple |  |
| Apalistik `StarsAbove:Apalistik` | weapon (summon) | Golem | rarity guess | Lime |  |
| Drachenlance `StarsAbove:Drachenlance` | weapon (melee) | Golem | rarity guess | Lime |  |
| Dreamer's Inkwell `StarsAbove:DreamersInkwell` | weapon (other) | Golem | rarity guess | Lime |  |
| El Capitan's Hardware `StarsAbove:ElCapitansHardware` | weapon (ranged) | Golem | rarity guess | Lime |  |
| Maniacal Justice `StarsAbove:ManiacalJustice` | weapon (melee) | Golem | rarity guess | Lime |  |
| Ride the Bull `StarsAbove:RideTheBull` | weapon (ranged) | Golem | rarity guess | Lime |  |
| Aegis Driver `StarsAbove:AegisDriver` | weapon (other) | Duke Fishron | rarity guess | Yellow |  |
| Crimson Outbreak `StarsAbove:CrimsonOutbreak` | weapon (ranged) | Duke Fishron | rarity guess | Yellow |  |
| Dragalia Found `StarsAbove:DragaliaFound` | weapon (summon) | Duke Fishron | rarity guess | Yellow |  |
| Force-of-Nature `StarsAbove:ForceOfNature` | weapon (ranged) | Duke Fishron | rarity guess | Yellow |  |
| Genocide `StarsAbove:Genocide` | weapon (ranged) | Duke Fishron | rarity guess | Yellow |  |
| Gloves of the Black Silence `StarsAbove:BlackSilenceWeapon` | weapon (other) | Duke Fishron | rarity guess | Yellow |  |
| Kazimierz Seraphim `StarsAbove:KazimierzSeraphim` | weapon (summon) | Duke Fishron | rarity guess | Yellow |  |
| Mercy `StarsAbove:Mercy` | weapon (melee) | Duke Fishron | rarity guess | Yellow |  |
| Persephone `StarsAbove:Persephone` | weapon (melee) | Duke Fishron | rarity guess | Yellow |  |
| Saltwater Scourge `StarsAbove:SaltwaterScourge` | weapon (ranged) | Duke Fishron | rarity guess | Yellow |  |
| Starphoenix Funnel `StarsAbove:StarphoenixFunnel` | weapon (summon) | Duke Fishron | rarity guess | Yellow |  |
| The Blood Blade `StarsAbove:BloodBlade` | weapon (melee) | Duke Fishron | rarity guess | Yellow |  |
| The Kiss of Death `StarsAbove:KissOfDeath` | weapon (ranged) | Duke Fishron | rarity guess | Yellow |  |
| Voice of the Fallen `StarsAbove:VoiceOfTheFallen` | weapon (other) | Duke Fishron | rarity guess | Yellow |  |
| Arachnid Needlepoint `StarsAbove:ArachnidNeedlepoint` | weapon (summon) | Lunatic Cultist | rarity guess | Cyan |  |
| Cæsura of Despair `StarsAbove:CaesuraOfDespair` | weapon (summon) | Lunatic Cultist | rarity guess | Cyan |  |
| Clarent Rebellion `StarsAbove:RebellionBloodArthur` | weapon (melee) | Lunatic Cultist | rarity guess | Cyan |  |
| Inugami Ripsaw `StarsAbove:InugamiRipsaw` | weapon (melee) | Lunatic Cultist | rarity guess | Cyan |  |
| Phasmasaber `StarsAbove:Phasmasaber` | weapon (ranged) | Lunatic Cultist | rarity guess | Cyan |  |
| Plenilune Gaze `StarsAbove:PleniluneGaze` | weapon (ranged) | Lunatic Cultist | rarity guess | Cyan |  |
| Stygian Nymph `StarsAbove:StygianNymph` | weapon (magic) | Lunatic Cultist | rarity guess | Cyan |  |
| Tartaglia `StarsAbove:Tartaglia` | weapon (ranged) | Lunatic Cultist | rarity guess | Cyan |  |
| Twin Stars of Albiero `StarsAbove:TwinStars` | weapon (magic) | Lunatic Cultist | rarity guess | Cyan |  |
| Umbra `StarsAbove:Umbra` | weapon (melee) | Lunatic Cultist | rarity guess | Cyan |  |
| Architect's Luminance `StarsAbove:ArchitectLuminance` | weapon (melee) | Moon Lord | rarity guess | Red |  |
| Armaments of the Sky Striker `StarsAbove:SkyStrikerArms` | weapon (melee) | Moon Lord | rarity guess | Purple |  |
| Black Silence's Gloves `StarsAbove:BlackSilenceGloves` | accessory | Moon Lord | rarity guess | Red |  |
| Boltstorm Axe `StarsAbove:LevinstormAxe` | weapon (melee) | Moon Lord | rarity guess | Red |  |
| Burning Desire `StarsAbove:BurningDesire` | weapon (melee) | Moon Lord | rarity guess | Red |  |
| Bury The Light `StarsAbove:BuryTheLight` | weapon (other) | Moon Lord | rarity guess | Purple |  |
| Catalyst's Memory `StarsAbove:CatalystMemory` | weapon (other) | Moon Lord | rarity guess | Red |  |
| Claimh Solais `StarsAbove:ClaimhSolais` | weapon (melee) | Moon Lord | rarity guess | Purple |  |
| Cloak of An Arbiter `StarsAbove:CloakOfAnArbiter` | weapon (magic) | Moon Lord | rarity guess | Red |  |
| Cloak Of An Arbiter Cape `StarsAbove:CloakOfAnArbiterCape` | accessory | Moon Lord | rarity guess | Red |  |
| Cosmic Destroyer `StarsAbove:CosmicDestroyer` | weapon (ranged) | Moon Lord | rarity guess | Red |  |
| Crimson Sakura Alpha `StarsAbove:CrimsonSakuraAlpha` | weapon (melee) | Moon Lord | rarity guess | Red |  |
| Dragged Below Gloves `StarsAbove:DraggedBelowGloves` | accessory | Moon Lord | rarity guess | Red |  |
| Dreadmother Claw `StarsAbove:DreadmotherClaw` | accessory | Moon Lord | rarity guess | Red |  |
| Dreadmother's Dark Idol `StarsAbove:DreadmotherDarkIdol` | weapon (melee) | Moon Lord | rarity guess | Red |  |
| E.G.O. Cape/Tail `StarsAbove:ManifestationCape` | accessory | Moon Lord | rarity guess | Red |  |
| Eternal Star `StarsAbove:EternalStar` | weapon (magic) | Moon Lord | rarity guess | Purple |  |
| Hullwrought `StarsAbove:Hullwrought` | weapon (melee) | Moon Lord | rarity guess | Red |  |
| Ignition Astra `StarsAbove:IgnitionAstra` | weapon (other) | Moon Lord | rarity guess | Purple |  |
| Inherited Case, M4A1 `StarsAbove:InheritedCaseM4A1` | weapon (ranged) | Moon Lord | rarity guess | Red |  |
| Key of the King's Law `StarsAbove:KeyOfTheKingsLaw` | weapon (summon) | Moon Lord | rarity guess | Red |  |
| Key of the Sinner `StarsAbove:CrimsonKey` | weapon (summon) | Moon Lord | rarity guess | Red |  |
| Kroniic Principality `StarsAbove:KroniicAccelerator` | weapon (summon) | Moon Lord | rarity guess | Red |  |
| Legendary Shield Accessory `StarsAbove:LegendaryShieldAccessory` | accessory | Moon Lord | rarity guess | Red |  |
| Liberation Blazing `StarsAbove:LiberationBlazing` | weapon (melee) | Moon Lord | rarity guess | Red |  |
| Light Unrelenting `StarsAbove:LightUnrelenting` | weapon (other) | Moon Lord | rarity guess | Purple |  |
| Naganadel `StarsAbove:Naganadel` | weapon (melee) | Moon Lord | rarity guess | Purple |  |
| Neopursuant Plasteel Cape `StarsAbove:NeopursuantPlasteelCape` | accessory | Moon Lord | rarity guess | Red |  |
| Neopursuant Roguegarb Cape `StarsAbove:NeopursuantRoguegarbCape` | accessory | Moon Lord | rarity guess | Red |  |
| Origin Infinity `StarsAbove:OriginInfinity` | weapon (other) | Moon Lord | rarity guess | Purple |  |
| Ozma Ascendant `StarsAbove:Ozma` | weapon (other) | Moon Lord | rarity guess | Red |  |
| Paradise Lost `StarsAbove:ParadiseLost` | weapon (other) | Moon Lord | rarity guess | Purple |  |
| Penthesilea's Muse `StarsAbove:PenthesileaMuse` | weapon (melee) | Moon Lord | rarity guess | Red |  |
| Phantom in the Mirror `StarsAbove:PhantomInTheMirror` | weapon (summon) | Moon Lord | rarity guess | Red |  |
| Quis Ut Deus `StarsAbove:QuisUtDeus` | weapon (ranged) | Moon Lord | rarity guess | Red |  |
| Red Mist's Gloves `StarsAbove:RedMistGloves` | accessory | Moon Lord | rarity guess | Red |  |
| Rex Lapis `StarsAbove:RexLapis` | weapon (melee) | Moon Lord | rarity guess | Red |  |
| Sakura's Vengeance `StarsAbove:SakuraVengeance` | weapon (melee) | Moon Lord | rarity guess | Red |  |
| Shadowless Cerulean `StarsAbove:ShadowlessCerulean` | weapon (melee) | Moon Lord | rarity guess | Red |  |
| Soul Reaver `StarsAbove:SoulReaver` | weapon (melee) | Moon Lord | rarity guess | Red |  |
| Sunset of the Sun God `StarsAbove:SunsetOfTheSunGod` | weapon (melee) | Moon Lord | rarity guess | Red |  |
| Supreme Authority `StarsAbove:SupremeAuthority` | weapon (other) | Moon Lord | rarity guess | Purple |  |
| The Everlasting Pickaxe `StarsAbove:EverlastingPickaxe` | weapon (other) | Moon Lord | rarity guess | Red |  |
| Two-Crown Bow `StarsAbove:TwoCrownBow` | weapon (ranged) | Moon Lord | rarity guess | Red |  |
| Unforgotten `StarsAbove:Unforgotten` | weapon (melee) | Moon Lord | rarity guess | Red |  |
| Vermilion Daemon `StarsAbove:VermillionDaemon` | weapon (other) | Moon Lord | rarity guess | Red |  |
| Vermilion Riposte `StarsAbove:RedMage` | weapon (other) | Moon Lord | rarity guess | Red |  |
| Virtue's Edge `StarsAbove:VirtuesEdge` | weapon (other) | Moon Lord | rarity guess | Red |  |
| Yunlai Stiletto `StarsAbove:YunlaiStiletto` | weapon (melee) | Moon Lord | rarity guess | Red |  |

### Terraria (112)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Black Golf Ball `v:4242` | accessory | Eye of Cthulhu | rarity guess | Green |  |
| Bladed Glove `v:1827` | weapon (melee) | Eye of Cthulhu | rarity guess | Green |  |
| Bloody Machete `v:1825` | weapon (melee) | Eye of Cthulhu | rarity guess | Green |  |
| Blue Golf Ball `v:4243` | accessory | Eye of Cthulhu | rarity guess | Green |  |
| Brown Golf Ball `v:4244` | accessory | Eye of Cthulhu | rarity guess | Green |  |
| Classy Cane `v:3351` | weapon (other) | Eye of Cthulhu | rarity guess | Green |  |
| Cyan Golf Ball `v:4245` | accessory | Eye of Cthulhu | rarity guess | Green |  |
| Flymeal `v:5129` | weapon (melee) | Eye of Cthulhu | rarity guess | Green |  |
| Green Golf Ball `v:4246` | accessory | Eye of Cthulhu | rarity guess | Green |  |
| Lime Golf Ball `v:4247` | accessory | Eye of Cthulhu | rarity guess | Green |  |
| Moon Lord Legs `v:5001` | legs | Eye of Cthulhu | rarity guess | Green |  |
| Orange Golf Ball `v:4248` | accessory | Eye of Cthulhu | rarity guess | Green |  |
| Pink Golf Ball `v:4249` | accessory | Eye of Cthulhu | rarity guess | Green |  |
| Purple Golf Ball `v:4250` | accessory | Eye of Cthulhu | rarity guess | Green |  |
| Red Golf Ball `v:4251` | accessory | Eye of Cthulhu | rarity guess | Green |  |
| Sky Blue Golf Ball `v:4252` | accessory | Eye of Cthulhu | rarity guess | Green |  |
| Teal Golf Ball `v:4253` | accessory | Eye of Cthulhu | rarity guess | Green |  |
| Violet Golf Ball `v:4254` | accessory | Eye of Cthulhu | rarity guess | Green |  |
| Water Bolt `v:165` | weapon (magic) | Eye of Cthulhu | rarity guess | Green |  |
| Yellow Golf Ball `v:4255` | accessory | Eye of Cthulhu | rarity guess | Green |  |
| Abigail's Flower `v:5114` | weapon (summon) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Ballista Rod `v:3824` | weapon (summon) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Cascade `v:3282` | weapon (melee) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Explosive Trap Rod `v:3832` | weapon (summon) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Flameburst Rod `v:3818` | weapon (summon) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Lightning Aura Rod `v:3829` | weapon (summon) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Amarok `v:3289` | weapon (melee) | Wall of Flesh | rarity guess | Light Red |  |
| Djinn's Curse `v:3770` | legs | Wall of Flesh | rarity guess | Light Red | drop Desert Spirit |
| Fast Clock `v:889` | accessory | Wall of Flesh | rarity guess | Light Red | drop Necromancer; drop Necromancer |
| Fin Wings `v:2494` | accessory | Wall of Flesh | rarity guess | Light Red |  |
| Hel-Fire `v:3290` | weapon (melee) | Wall of Flesh | rarity guess | Light Red |  |
| Megaphone `v:890` | accessory | Wall of Flesh | rarity guess | Light Red |  |
| Amphibian Boots `v:3990` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Arcane Flower `v:3991` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Ballista Cane `v:3825` | weapon (summon) | Skeletron Prime | rarity guess | Pink |  |
| Berserker's Glove `v:3992` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Chromatic Cloak `v:5355` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Explosive Trap Cane `v:3833` | weapon (summon) | Skeletron Prime | rarity guess | Pink |  |
| Fairy Boots `v:3993` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Flameburst Cane `v:3819` | weapon (summon) | Skeletron Prime | rarity guess | Pink |  |
| Frog Flipper `v:3994` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Frog Gear `v:3995` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Frog Webbing `v:3996` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Frozen Shield `v:3997` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Glass Slipper `v:5077` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Hero Shield `v:3998` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Lightning Aura Cane `v:3830` | weapon (summon) | Skeletron Prime | rarity guess | Pink |  |
| Magma Skull `v:3999` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Magnet Flower `v:4000` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Mana Cloak `v:4001` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Molten Charm `v:4038` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Molten Quiver `v:4002` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Obsidian Skull Rose `v:4004` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Prince Cape `v:5080` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Recon Scope `v:4005` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Stalker's Quiver `v:4006` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Stinger Necklace `v:4007` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Ultrabright Helmet `v:4008` | head | Skeletron Prime | rarity guess | Pink |  |
| Molten Skull Rose `v:4003` | accessory | Plantera | rarity guess | Light Purple |  |
| Hellfire Treads `v:4874` | accessory | Golem | rarity guess | Lime |  |
| Yelets `v:3286` | weapon (melee) | Golem | rarity guess | Lime |  |
| Apprentice's Hat `v:3797` | head | Duke Fishron | rarity guess | Yellow |  |
| Apprentice's Robe `v:3798` | body | Duke Fishron | rarity guess | Yellow |  |
| Apprentice's Trousers `v:3799` | legs | Duke Fishron | rarity guess | Yellow |  |
| Ballista Staff `v:3826` | weapon (summon) | Duke Fishron | rarity guess | Yellow |  |
| Dark Artist's Hat `v:3874` | head | Duke Fishron | rarity guess | Yellow |  |
| Dark Artist's Leggings `v:3876` | legs | Duke Fishron | rarity guess | Yellow |  |
| Dark Artist's Robes `v:3875` | body | Duke Fishron | rarity guess | Yellow |  |
| Explosive Trap Staff `v:3834` | weapon (summon) | Duke Fishron | rarity guess | Yellow |  |
| Flameburst Staff `v:3820` | weapon (summon) | Duke Fishron | rarity guess | Yellow |  |
| Huntress's Jerkin `v:3804` | body | Duke Fishron | rarity guess | Yellow |  |
| Huntress's Pants `v:3805` | legs | Duke Fishron | rarity guess | Yellow |  |
| Huntress's Wig `v:3803` | head | Duke Fishron | rarity guess | Yellow |  |
| Lightning Aura Staff `v:3831` | weapon (summon) | Duke Fishron | rarity guess | Yellow |  |
| Monk's Bushy Brow Bald Cap `v:3806` | head | Duke Fishron | rarity guess | Yellow |  |
| Monk's Pants `v:3808` | legs | Duke Fishron | rarity guess | Yellow |  |
| Monk's Shirt `v:3807` | body | Duke Fishron | rarity guess | Yellow |  |
| Red Riding Dress `v:3878` | body | Duke Fishron | rarity guess | Yellow |  |
| Red Riding Hood `v:3877` | head | Duke Fishron | rarity guess | Yellow |  |
| Red Riding Leggings `v:3879` | legs | Duke Fishron | rarity guess | Yellow |  |
| Shinobi Infiltrator's Helmet `v:3880` | head | Duke Fishron | rarity guess | Yellow |  |
| Shinobi Infiltrator's Pants `v:3882` | legs | Duke Fishron | rarity guess | Yellow |  |
| Shinobi Infiltrator's Torso `v:3881` | body | Duke Fishron | rarity guess | Yellow |  |
| Squire's Great Helm `v:3800` | head | Duke Fishron | rarity guess | Yellow |  |
| Squire's Greaves `v:3802` | legs | Duke Fishron | rarity guess | Yellow |  |
| Squire's Plating `v:3801` | body | Duke Fishron | rarity guess | Yellow |  |
| Valhalla Knight's Breastplate `v:3872` | body | Duke Fishron | rarity guess | Yellow |  |
| Valhalla Knight's Greaves `v:3873` | legs | Duke Fishron | rarity guess | Yellow |  |
| Valhalla Knight's Helm `v:3871` | head | Duke Fishron | rarity guess | Yellow |  |
| Aether Monolith `v:5347` | accessory | Lunatic Cultist | rarity guess | Cyan |  |
| Arkhalis `v:3368` | weapon (melee) | Lunatic Cultist | rarity guess | Cyan |  |
| Arkhalis' Lightwings `v:3924` | accessory | Lunatic Cultist | rarity guess | Cyan |  |
| Cenx's Wings `v:1586` | accessory | Lunatic Cultist | rarity guess | Cyan |  |
| Crowno's Wings `v:1585` | accessory | Lunatic Cultist | rarity guess | Cyan |  |
| D-Town's Wings `v:1583` | accessory | Lunatic Cultist | rarity guess | Cyan |  |
| FoodBarbarian's Tattered Dragon Wings `v:4750` | accessory | Lunatic Cultist | rarity guess | Cyan |  |
| Ghostar's Infinity Eight `v:4730` | accessory | Lunatic Cultist | rarity guess | Cyan |  |
| Grox The Great's Wings `v:4754` | accessory | Lunatic Cultist | rarity guess | Cyan |  |
| Jim's Wings `v:3582` | accessory | Lunatic Cultist | rarity guess | Cyan |  |
| Lazure's Barrier Platform `v:3228` | accessory | Lunatic Cultist | rarity guess | Cyan |  |
| Leinfors' Luxury Shampoo `v:3929` | accessory | Lunatic Cultist | rarity guess | Cyan |  |
| Leinfors' Prehensile Cloak `v:3928` | accessory | Lunatic Cultist | rarity guess | Cyan |  |
| Loki's Wings `v:3592` | accessory | Lunatic Cultist | rarity guess | Cyan |  |
| Red's Throw `v:3287` | weapon (melee) | Lunatic Cultist | rarity guess | Cyan |  |
| Red's Wings `v:665` | accessory | Lunatic Cultist | rarity guess | Cyan |  |
| Safeman's Blanket Cape `v:4746` | accessory | Lunatic Cultist | rarity guess | Cyan |  |
| Skiphs' Paws `v:3588` | accessory | Lunatic Cultist | rarity guess | Cyan |  |
| Valkyrie Yoyo `v:3288` | weapon (melee) | Lunatic Cultist | rarity guess | Cyan |  |
| Will's Wings `v:1584` | accessory | Lunatic Cultist | rarity guess | Cyan |  |
| Yoraiz0r's Scowl `v:3581` | accessory | Lunatic Cultist | rarity guess | Cyan |  |
| Yoraiz0r's Spell `v:3580` | accessory | Lunatic Cultist | rarity guess | Cyan |  |
| FirstFractal `v:4722` | weapon (melee) | Moon Lord | rarity guess | Red |  |

### CalValEX (65)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Budget Desert Medallion `CalValEX:DesertMedallion` | accessory | Eye of Cthulhu | rarity guess | Green |  |
| Prism Shell `CalValEX:PrismShell` | accessory | Eye of Cthulhu | rarity guess | Green | drop v:-1 |
| Shuttle Balloon `CalValEX:ShuttleBalloon` | accessory | Eye of Cthulhu | rarity guess | Green | drop v:-1 |
| Cuboidal Balloon `CalValEX:BoxBalloon` | accessory | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange | drop v:-1 |
| Moldy Hoody `CalValEX:MoldyHoody` | accessory | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Scryllian Wings `CalValEX:ScryllianWings` | accessory | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange | drop v:-1 |
| Aero Wings `CalValEX:AeroWings` | accessory | Wall of Flesh | rarity guess | Light Red | drop v:-1 |
| Eidolist's Cape `CalValEX:Eidcape` | accessory | Wall of Flesh | rarity guess | Light Red | drop v:-1 |
| Tower Shield of the Elemental `CalValEX:EarthShield` | accessory | Wall of Flesh | rarity guess | Light Red | drop v:-1 |
| Foil Spoon `CalValEX:FoilSpoon` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Trilobuckler `CalValEX:TrilobiteShield` | accessory | Skeletron Prime | rarity guess | Pink | drop v:-1 |
| Valkyrian Garments `CalValEX:CloudWaistbelt` | accessory | Skeletron Prime | rarity guess | Pink | drop v:-1 |
| Ancient Mirage Balloon `CalValEX:OldMirage` | accessory | Plantera | rarity guess | Light Purple | drop v:-1 |
| Astral Bandana `CalValEX:AstBandana` | accessory | Plantera | rarity guess | Light Purple |  |
| Burning Eye `CalValEX:BurningEye` | accessory | Plantera | rarity guess | Light Purple |  |
| Mirage Balloon `CalValEX:Mirballoon` | accessory | Plantera | rarity guess | Light Purple | drop v:-1 |
| Perennial Tulip `CalValEX:PerennialFlower` | accessory | Plantera | rarity guess | Light Purple | drop v:-1 |
| Puffer Balloon `CalValEX:ChaosBalloon` | accessory | Plantera | rarity guess | Light Purple | drop v:-1 |
| Ancient Perennial Tulip `CalValEX:AncientPerennialFlower` | accessory | Golem | rarity guess | Lime | drop v:-1 |
| Aureus Bulwark `CalValEX:AureusShield` | accessory | Golem | rarity guess | Lime |  |
| Foil Atlantis `CalValEX:FoilAtlantis` | accessory | Golem | rarity guess | Lime |  |
| Leviathan Fin Wings `CalValEX:LeviWings` | accessory | Golem | rarity guess | Lime |  |
| Stone Pile `CalValEX:StonePile` | head | Golem | rarity guess | Lime |  |
| Beelzebooster `CalValEX:PlaguePack` | accessory | Duke Fishron | rarity guess | Yellow |  |
| Plaguebringer Wings `CalValEX:PlaugeWings` | accessory | Duke Fishron | rarity guess | Yellow | drop v:-1 |
| Skull Balloon `CalValEX:SkullBalloon` | accessory | Duke Fishron | rarity guess | Yellow |  |
| Nyanthrop `CalValEX:Nyanthrop` | weapon (melee) | Lunatic Cultist | rarity guess | Cyan | drop Meldosaurus |
| The Shade's Bane `CalValEX:ShadesBane` | weapon (melee) | Lunatic Cultist | rarity guess | Cyan | drop Meldosaurus |
| Exodium Orbiter `CalValEX:ExodiumMoon` | accessory | Moon Lord | rarity guess | Purple | drop v:-1 |
| Folly Wings `CalValEX:FollyWings` | accessory | Moon Lord | rarity guess | Purple |  |
| Profaned Balloon `CalValEX:ProfanedBalloon` | accessory | Moon Lord | rarity guess | Purple | drop v:-1 |
| Profaned Cultist Robes `CalValEX:ProfanedCultistRobes` | body | Moon Lord | rarity guess | Purple |  |
| Wings of Termina `CalValEX:TerminalWings` | accessory | Moon Lord | rarity guess | Purple |  |
| Aestheticrest `CalValEX:Aestheticrown` | head | unknown | no rarity, no evidence | Aqua |  |
| Apollo Balloon `CalValEX:ApolloBalloonSmall` | accessory | unknown | no rarity, no evidence |  |  |
| Arsenal Soldier Chestplate `CalValEX:DraedonChestplate` | body | unknown | no rarity, no evidence |  |  |
| Arsenal Soldier Helmet `CalValEX:DraedonHelmet` | head | unknown | no rarity, no evidence |  |  |
| Artemis Balloon `CalValEX:ArtemisBalloonSmall` | accessory | unknown | no rarity, no evidence |  |  |
| Auric Balloon `CalValEX:AuricBalloon` | accessory | unknown | no rarity, no evidence |  |  |
| Auric Mantle `CalValEX:YharimCapeBaby` | accessory | unknown | no rarity, no evidence |  |  |
| Backpack Server `CalValEX:BackpackServer` | accessory | unknown | no rarity, no evidence |  |  |
| Bloodworm Scarf `CalValEX:BloodwormScarf` | accessory | unknown | no rarity, no evidence |  |  |
| Bloody Mary Dress `CalValEX:BloodyMaryDress` | body | unknown | no rarity, no evidence |  |  |
| Cosmic Lantern Balloon `CalValEX:SignusBalloon` | accessory | unknown | no rarity, no evidence |  |  |
| Cosmic Worm Scarf `CalValEX:CosmicWormScarf` | accessory | unknown | no rarity, no evidence |  |  |
| Godspeed Boosters `CalValEX:GodspeedBoosters` | accessory | unknown | no rarity, no evidence |  |  |
| MiniMacDon's Cloak `CalValEX:AldebaranCloak` | accessory | unknown | no rarity, no evidence | Aqua |  |
| Old Duke Wings `CalValEX:OldWings` | accessory | unknown | no rarity, no evidence |  |  |
| Prototype Ring `CalValEX:ProtoRing` | accessory | unknown | no rarity, no evidence | Aqua |  |
| Raptured Worm Scarf `CalValEX:RapturedWormScarf` | accessory | unknown | no rarity, no evidence |  |  |
| Revoided Wings `CalValEX:OldVoidWings` | accessory | unknown | no rarity, no evidence |  |  |
| Signus Emblem `CalValEX:SignusEmblem` | accessory | unknown | no rarity, no evidence |  |  |
| Signus' Cape `CalValEX:SigCape` | accessory | unknown | no rarity, no evidence |  |  |
| Storm Bandanna `CalValEX:StormBandana` | accessory | unknown | no rarity, no evidence |  |  |
| True Cosmic Cone `CalValEX:TrueCosmicCone` | head | unknown | no rarity, no evidence |  |  |
| Twilight Charm `CalValEX:Signus` | accessory | unknown | no rarity, no evidence |  |  |
| Tyrant's Cape `CalValEX:YharimCape` | accessory | unknown | no rarity, no evidence |  |  |
| Unholy Charm `CalValEX:ProviCrystal` | accessory | unknown | no rarity, no evidence |  |  |
| Universal Worm Scarf `CalValEX:UniversalWormScarf` | accessory | unknown | no rarity, no evidence |  |  |
| Void Wings `CalValEX:VoidWings` | accessory | unknown | no rarity, no evidence |  |  |
| XF Model Chestplate `CalValEX:AresChestplate` | body | unknown | no rarity, no evidence |  |  |
| XS Leash Bundle `CalValEX:ExoTwinsBalloon` | accessory | unknown | no rarity, no evidence |  |  |
| XS Leash-01 `CalValEX:ArtemisBalloon` | accessory | unknown | no rarity, no evidence |  |  |
| XS Leash-03 `CalValEX:ApolloBalloon` | accessory | unknown | no rarity, no evidence |  |  |
| Yharon's Shackle `CalValEX:YharonShackle` | accessory | unknown | no rarity, no evidence |  |  |

### CalamityMod (42)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Acid Gun `CalamityMod:AcidGun` | weapon (magic) | Eye of Cthulhu | rarity guess | Green |  |
| Basher `CalamityMod:Basher` | weapon (melee) | Eye of Cthulhu | rarity guess | Green |  |
| Caustic Croaker Staff `CalamityMod:CausticCroakerStaff` | weapon (summon) | Eye of Cthulhu | rarity guess | Green | drop Nuclear Toad (AquaticScourge) |
| Experimental Wulfrum Fusion Array `CalamityMod:WulfrumFusionCannon` | weapon (summon) | Eye of Cthulhu | rarity guess | Green |  |
| Ha-pu Fruit `CalamityMod:HapuFruit` | accessory | Eye of Cthulhu | rarity guess | Green | bag Starter Bag |
| Lemon 'nade `CalamityMod:LemonNade` | weapon (rogue) | Eye of Cthulhu | rarity guess | Green |  |
| Parasitic Scepter `CalamityMod:ParasiticSceptor` | weapon (magic) | Eye of Cthulhu | rarity guess | Green |  |
| Sea Spirit Amulet `CalamityMod:SeaSpiritAmulet` | accessory | Eye of Cthulhu | rarity guess | Green |  |
| Sparkling Empress `CalamityMod:SparklingEmpress` | weapon (magic) | Eye of Cthulhu | rarity guess | Green |  |
| Sulphurous Breastplate `CalamityMod:SulphurousBreastplate` | body | Eye of Cthulhu | rarity guess | Green |  |
| Sulphurous Helmet `CalamityMod:SulphurousHelmet` | head | Eye of Cthulhu | rarity guess | Green |  |
| Sulphurous Leggings `CalamityMod:SulphurousLeggings` | legs | Eye of Cthulhu | rarity guess | Green |  |
| Toxibow `CalamityMod:Toxibow` | weapon (ranged) | Eye of Cthulhu | rarity guess | Green |  |
| Cinder Blossom Staff `CalamityMod:CinderBlossomStaff` | weapon (summon) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Hellwing Staff `CalamityMod:HellwingStaff` | weapon (magic) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Infernal Kris `CalamityMod:InfernalKris` | weapon (rogue) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Tainted Blade `CalamityMod:TaintedBlade` | weapon (melee) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Clothier's Wrath `CalamityMod:ClothiersWrath` | weapon (magic) | Wall of Flesh | rarity guess | Light Red | drop Clothier (Hardmode) |
| Elephant Killer `CalamityMod:ElephantKiller` | weapon (rogue) | Wall of Flesh | rarity guess | Light Red | drop Shady Salesman (Hardmode) |
| Evil Smasher `CalamityMod:EvilSmasher` | weapon (classless) | Wall of Flesh | rarity guess | Light Red |  |
| Spelunker's Amulet `CalamityMod:SpelunkersAmulet` | accessory | Wall of Flesh | chest at world generation (UndergroundShrines.FillDesertShrineChest), rarity floor | Light Red | worldgen UndergroundShrines.FillDesertShrineChest |
| The Pact `CalamityMod:ThePact` | accessory | Wall of Flesh | rarity guess | Light Red | shop Shady Salesman (Dreadnautilus) |
| Titan Heart Boots `CalamityMod:TitanHeartBoots` | legs | Wall of Flesh | rarity guess | Light Red |  |
| Titan Heart Mantle `CalamityMod:TitanHeartMantle` | body | Wall of Flesh | rarity guess | Light Red |  |
| Titan Heart Mask `CalamityMod:TitanHeartMask` | head | Wall of Flesh | rarity guess | Light Red |  |
| Flak Toxicannon `CalamityMod:FlakToxicannon` | weapon (ranged) | Skeletron Prime | rarity guess | Pink | drop Flak Crab |
| Orthocera Shell `CalamityMod:OrthoceraShell` | weapon (summon) | Skeletron Prime | rarity guess | Pink | drop Orthocera |
| Slithering Eels `CalamityMod:SlitheringEels` | weapon (magic) | Skeletron Prime | rarity guess | Pink | drop Acid Eel (PostAS) |
| Sulphurous Grabber `CalamityMod:SulphurousGrabber` | weapon (melee) | Skeletron Prime | rarity guess | Pink | drop Sulphurous Skater |
| Heavenfallen Stardisk `CalamityMod:HeavenfallenStardisk` | weapon (rogue) | Duke Fishron | chest at world generation (AstralChestGeneration.PlaceAstralChest), rarity floor | Yellow | worldgen AstralChestGeneration.PlaceAstralChest |
| The Omnigun `CalamityMod:OmniGun` | weapon (ranged) | Duke Fishron | rarity guess | Yellow | shop Shady Salesman (Golem) |
| Little E `CalamityMod:LittleE` | accessory | Moon Lord | rarity guess | Red | bag Starter Bag |
| Murasama `CalamityMod:Murasama` | weapon (melee) | The Devourer of Gods | chest at world generation (DraedonStructures.FillHellLaboratoryChest), rarity floor | Cosmic Purple | worldgen DraedonStructures.FillHellLaboratoryChest |
| Lilies of Finality `CalamityMod:LiliesOfFinality` | weapon (summon) | Yharon, Dragon of Rebirth | rarity guess | Burnished Auric |  |
| The Wand `CalamityMod:TheWand` | weapon (magic) | Yharon, Dragon of Rebirth | rarity guess | Burnished Auric | drop The Devourer of Gods (seed:GFB); shop Shady Salesman (Yharon) |
| Xyk's Blessing (Orange) `CalamityMod:XyksBlessingOrange` | accessory | XS-03 Apollo | rarity guess | Dark Orange |  |
| Cinders of Lament `CalamityMod:CindersOfLament` | weapon (summon) | Supreme Witch, Calamitas | rarity guess | Calamity Red |  |
| Gruesome Eminence `CalamityMod:GruesomeEminence` | weapon (magic) | Supreme Witch, Calamitas | rarity guess | Calamity Red |  |
| Halibut Cannon `CalamityMod:HalibutCannon` | weapon (ranged) | Supreme Witch, Calamitas | rarity guess | Hot Pink | drop Primordial Wyrm |
| Metastasis `CalamityMod:Metastasis` | weapon (summon) | Supreme Witch, Calamitas | rarity guess | Calamity Red |  |
| Rancor `CalamityMod:Rancor` | weapon (magic) | Supreme Witch, Calamitas | rarity guess | Calamity Red |  |
| Shattered Community `CalamityMod:ShatteredCommunity` | accessory | Supreme Witch, Calamitas | rarity guess | Hot Pink | drop The Old Duke (seed:GFB) |

### SOTS (37)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Amulet of Emptiness `SOTS:EmptyNecklace` | accessory | Eye of Cthulhu | chest at world generation (SanctuaryWorldgenHelper.FillChestsWithLoot), rarity floor | Green | worldgen SanctuaryWorldgenHelper.FillChestsWithLoot |
| Dreamcatcher `SOTS:Dreamcatcher` | accessory | Eye of Cthulhu | chest at world generation (SanctuaryWorldgenHelper.FillChestsWithLoot), rarity floor | Green | worldgen SanctuaryWorldgenHelper.FillChestsWithLoot |
| Anomaly Locator `SOTS:AnomalyLocator` | accessory | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange | shop Archaeologist |
| Crushing Capacitor `SOTS:CrushingCapacitor` | accessory | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Enchanted Pickaxe `SOTS:EnchantedPickaxe` | weapon (melee) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Golden Trowel `SOTS:GoldenTrowel` | accessory | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange | shop Archaeologist |
| Obsidian Eruption `SOTS:ObsidianEruption` | weapon (melee) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Recursive Bow `SOTS:RecursiveBow` | weapon (ranged) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Dreaming Lamp `SOTS:DreamLamp` | weapon (melee) | Wall of Flesh | rarity guess | Light Red | shop Archaeologist |
| Vorpal Knife `SOTS:VorpalKnife` | weapon (melee) | Wall of Flesh | chest at world generation (GemStructureWorldgenHelper.FillChestsWithLoot), rarity floor | Light Red | shop Archaeologist; worldgen GemStructureWorldgenHelper.FillChestsWithLoot |
| Bone Clapper `SOTS:BoneClapper` | weapon (melee) | Skeletron Prime | chest at world generation (SOTSWorld.PostWorldGen), rarity floor | Pink | shop Archaeologist (Boss3); worldgen SOTSWorld.PostWorldGen |
| Colossus `SOTS:Colossus` | weapon (melee) | Skeletron Prime | rarity guess | Pink |  |
| Tesseract Sword `SOTS:TesseractSword` | weapon (melee) | Skeletron Prime | rarity guess | Pink |  |
| Cursed Apple `SOTS:CursedApple` | accessory | Plantera | rarity guess | Light Purple | shop Archaeologist |
| Photon Geyser `SOTS:PhotonGeyser` | weapon (magic) | Plantera | rarity guess | Light Purple | shop Archaeologist |
| Dune Splicer `SOTS:DuneSplicer` | weapon (melee) | Duke Fishron | chest at world generation (SOTSWorld.PostWorldGen), rarity floor | Yellow | worldgen SOTSWorld.PostWorldGen |
| Pathogen Regurgitator `SOTS:PathogenRegurgitator` | weapon (ranged) | Duke Fishron | chest at world generation (SOTSWorld.PostWorldGen), rarity floor | Yellow | worldgen SOTSWorld.PostWorldGen |
| Rebar Rifle `SOTS:RebarRifle` | weapon (ranged) | Duke Fishron | chest at world generation (SOTSWorld.PostWorldGen), rarity floor | Yellow | worldgen SOTSWorld.PostWorldGen |
| Sawflake `SOTS:Sawflake` | weapon (melee) | Duke Fishron | chest at world generation (SOTSWorld.PostWorldGen), rarity floor | Yellow | worldgen SOTSWorld.PostWorldGen |
| Starcaller Staff `SOTS:StarcallerStaff` | weapon (summon) | Duke Fishron | chest at world generation (SOTSWorld.PostWorldGen), rarity floor | Yellow | worldgen SOTSWorld.PostWorldGen |
| Tangle Staff `SOTS:TangleStaff` | weapon (magic) | Duke Fishron | chest at world generation (SOTSWorld.PostWorldGen), rarity floor | Yellow | worldgen SOTSWorld.PostWorldGen |
| The Dark Eye `SOTS:TheDarkEye` | accessory | Duke Fishron | rarity guess | Yellow | drop Wall Mimic |
| Voidmage Incubator `SOTS:VoidmageIncubator` | accessory | Duke Fishron | rarity guess | Yellow |  |
| Digital Daito `SOTS:DigitalDaito` | weapon (melee) | Lunatic Cultist | rarity guess | Cyan |  |
| Train Gun `SOTS:Traingun` | weapon (ranged) | Lunatic Cultist | rarity guess | Cyan |  |
| Continuum Collapse `SOTS:ContinuumCollapse` | weapon (melee) | Moon Lord | rarity guess | Purple |  |
| Infinite Void `SOTS:InfiniteVoid` | accessory | Moon Lord | rarity guess | Purple |  |
| Suprem `SOTS:SupremSticker` | accessory | Moon Lord | rarity guess | Red |  |
| Tesseract `SOTS:Tesseract` | weapon (melee) | Moon Lord | rarity guess | Purple |  |
| Accretion Disc `SOTS:AccretionDisc` | weapon (melee) | unknown | no rarity, no evidence | Anomaly |  |
| Atlantis `SOTS:Atlantis` | weapon (melee) | unknown | no rarity, no evidence | Anomaly |  |
| Blink Blade `SOTS:BlinkBlade` | weapon (melee) | unknown | no rarity, no evidence | Anomaly |  |
| Infinity Pouch `SOTS:InfinityPouch` | accessory | unknown | no rarity, no evidence | Anomaly |  |
| Mr. Glorp `SOTS:MrGlorp` | accessory | unknown | no rarity, no evidence | Anomaly |  |
| Selene `SOTS:SkipScythe` | weapon (melee) | unknown | no rarity, no evidence | Anomaly |  |
| Skip Shot `SOTS:SkipShot` | weapon (melee) | unknown | no rarity, no evidence | Anomaly |  |
| Void Anomaly `SOTS:VoidAnomaly` | accessory | unknown | no rarity, no evidence | Anomaly |  |

### CalamityBardHealer (30)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Screaming Clam `CalamityBardHealer:ScreamingClam` | accessory | Eye of Cthulhu | rarity guess | Green |  |
| Victide Ammonite Hat `CalamityBardHealer:VictideAmmoniteHat` | head | Eye of Cthulhu | rarity guess | Green |  |
| Aerospec Biretta `CalamityBardHealer:AerospecBiretta` | head | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Aerospec Headphones `CalamityBardHealer:AerospecHeadphones` | head | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Statigel Earrings `CalamityBardHealer:StatigelEarrings` | head | Wall of Flesh | rarity guess | Light Red |  |
| Statigel Fox Mask `CalamityBardHealer:StatigelFoxMask` | head | Wall of Flesh | rarity guess | Light Red |  |
| Daedalus Cowl `CalamityBardHealer:DaedalusCowl` | head | Skeletron Prime | rarity guess | Pink |  |
| Daedalus Hat `CalamityBardHealer:DaedalusHat` | head | Skeletron Prime | rarity guess | Pink |  |
| Hydrothermic Gas Mask `CalamityBardHealer:HydrothermicGasMask` | head | Duke Fishron | rarity guess | Yellow |  |
| Hydrothermic Hat `CalamityBardHealer:HydrothermicHat` | head | Duke Fishron | rarity guess | Yellow |  |
| Noisebringer Goliath `CalamityBardHealer:NoisebringerGoliath` | accessory | Duke Fishron | rarity guess | Yellow |  |
| Auric Tesla Feathered Headwear `CalamityBardHealer:AuricTeslaFeatheredHeadwear` | head | unknown | no rarity, no evidence |  |  |
| Auric Tesla Feathered Headwear[c/70f4f4:+] `CalamityBardHealer:AugmentedAuricTeslaFeatheredHeadwear` | head | unknown | no rarity, no evidence |  |  |
| Auric Tesla Valkyrie Visage `CalamityBardHealer:AuricTeslaValkyrieVisage` | head | unknown | no rarity, no evidence |  |  |
| Auric Tesla Valkyrie Visage[c/70f4f4:+] `CalamityBardHealer:AugmentedAuricTeslaValkyrieVisage` | head | unknown | no rarity, no evidence |  |  |
| Bloodflare Ritualist Mask `CalamityBardHealer:BloodflareRitualistMask` | head | unknown | no rarity, no evidence |  |  |
| Bloodflare Siren Skull `CalamityBardHealer:BloodflareSirenSkull` | head | unknown | no rarity, no evidence |  |  |
| Blooming Saintess Statue `CalamityBardHealer:BloomingSaintessStatue` | accessory | unknown | no rarity, no evidence |  |  |
| Elemental Bloom `CalamityBardHealer:ElementalBloom` | accessory | unknown | no rarity, no evidence |  |  |
| God Slayer Deathsinger's Cowl `CalamityBardHealer:GodSlayerDeathsingerCowl` | head | unknown | no rarity, no evidence |  |  |
| Intergelactic Cloche `CalamityBardHealer:IntergelacticCloche` | head | unknown | no rarity, no evidence |  |  |
| Intergelactic Protector Helm `CalamityBardHealer:IntergelacticProtectorHelm` | head | unknown | no rarity, no evidence |  |  |
| Omni-Speaker `CalamityBardHealer:OmniSpeaker` | accessory | unknown | no rarity, no evidence |  |  |
| Silva Guardian's Helmet `CalamityBardHealer:SilvaGuardianHelmet` | head | unknown | no rarity, no evidence |  |  |
| Tarragon Chapeau `CalamityBardHealer:TarragonChapeau` | head | unknown | no rarity, no evidence |  |  |
| Tarragon Paragon Crown `CalamityBardHealer:TarragonParagonCrown` | head | unknown | no rarity, no evidence |  |  |
| Tree Whisperer Amulet `CalamityBardHealer:TreeWhispererAmulet` | accessory | unknown | no rarity, no evidence |  |  |
| Void Faquir Deathsinger Chapeau `CalamityBardHealer:VoidFaquirChapeau` | head | unknown | no rarity, no evidence |  |  |
| Void Faquir Warpriest Biretta `CalamityBardHealer:VoidFaquirBiretta` | head | unknown | no rarity, no evidence |  |  |
| Yharim's Jam `CalamityBardHealer:YharimsJam` | accessory | unknown | no rarity, no evidence |  |  |

### ThoriumRework (25)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Queen Jelly-Pin `ThoriumRework:QueenJellyPinCosmetic` | accessory | Eye of Cthulhu | rarity guess | Green |  |
| Vampire Bat Cape `ThoriumRework:VampireCapeCosmetic` | accessory | Eye of Cthulhu | rarity guess | Green |  |
| Whistler's Hat `ThoriumRework:WhistlersHat` | head | Eye of Cthulhu | rarity guess | Green |  |
| Whistler's Tunic `ThoriumRework:WhistlersTunic` | body | Eye of Cthulhu | rarity guess | Green |  |
| Band of Cratons `ThoriumRework:BandofCratonsCosmetic` | accessory | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Banner of War `ThoriumRework:BannerofWarCosmetic` | accessory | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Impulse Amplifier `ThoriumRework:ImpulseAmplifier` | accessory | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Pocket Energy Storm `ThoriumRework:PocketEnergyStorm` | weapon (other) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Repurposed Star Caller `ThoriumRework:RepurposedStarCaller` | weapon (summon) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Star Scout Reticle `ThoriumRework:StarScoutReticleCosmetic` | accessory | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Beholder's Tentacles `ThoriumRework:BeholderTentaclesCosmetic` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Spitting Shroom Staff `ThoriumRework:SpittingShroomStaff` | weapon (summon) | Skeletron Prime | rarity guess | Pink |  |
| Strider Mouthguard `ThoriumRework:StriderMouthguardCosmetic` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Will of Coznix `ThoriumRework:BeholderBlade` | weapon (melee) | Skeletron Prime | rarity guess | Pink |  |
| Instrument of Torment `ThoriumRework:LichWhip` | weapon (summon) | Plantera | rarity guess | Light Purple |  |
| Titan Hat `ThoriumRework:TitanHat` | head | Plantera | rarity guess | Light Purple |  |
| Titan Hood `ThoriumRework:TitanHood` | head | Plantera | rarity guess | Light Purple |  |
| Titan Visage `ThoriumRework:TitanVisage` | head | Plantera | rarity guess | Light Purple |  |
| Titan Visor `ThoriumRework:TitanVisor` | head | Plantera | rarity guess | Light Purple |  |
| Undying Gaze `ThoriumRework:UndyingGazeCosmetic` | accessory | Plantera | rarity guess | Light Purple |  |
| Executioner's Contract `ThoriumRework:ExecutionersContract` | accessory | Golem | rarity guess | Lime |  |
| Fan Donations `ThoriumRework:FanDonations` | accessory | Golem | rarity guess | Lime |  |
| Deep Dark Shell Shield `ThoriumRework:DeepDarkShellShieldCosmetic` | accessory | Duke Fishron | rarity guess | Yellow |  |
| Sealed Contract `ThoriumRework:SealedContract` | accessory | Moon Lord | rarity guess | Red |  |
| Oneirophobia `ThoriumRework:Oneirophobia` | weapon (classless) | unknown | no rarity, no evidence |  |  |

### InfernalEclipseAPI (14)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Destinary `InfernalEclipseAPI:Destinary` | weapon (melee) | Supreme Witch, Calamitas | rarity guess | Hot Pink |  |
| Exo Sights `InfernalEclipseAPI:ExoSights` | accessory | Supreme Witch, Calamitas | rarity guess | Exotic Rainbow |  |
| Nova Bomb `InfernalEclipseAPI:NovaBomb` | weapon (magic) | Supreme Witch, Calamitas | rarity guess | Hot Pink |  |
| Shattered Subcommunity `InfernalEclipseAPI:ShatteredSubcommunity` | accessory | Supreme Witch, Calamitas | rarity guess | Hot Pink |  |
| Streetsign `InfernalEclipseAPI:Streetsign` | weapon (melee) | Supreme Witch, Calamitas | rarity guess | Calamity Red |  |
| Tix-Burnt Ring `InfernalEclipseAPI:RingofTix` | accessory | Supreme Witch, Calamitas | rarity guess | Hot Pink |  |
| Celestial Illumination `InfernalEclipseAPI:CelestialIllumination` | weapon (magic) | unknown | no rarity, no evidence | Infernum Profaned |  |
| Exo Disintegrator `InfernalEclipseAPI:ExoDisintegrator` | weapon (ranged) | unknown | no rarity, no evidence | Genesis Component |  |
| Lycanroc `InfernalEclipseAPI:Lycanroc` | weapon (ranged) | unknown | no rarity, no evidence | Infernum Profaned |  |
| Nebula Gigabeam `InfernalEclipseAPI:NebulaGigabeam` | weapon (magic) | unknown | no rarity, no evidence | Nameless Deity |  |
| Sword of the Corrupted `InfernalEclipseAPI:Swordofthe13thGlitch` | weapon (melee) | unknown | no rarity, no evidence |  |  |
| Sword of the First `InfernalEclipseAPI:Swordofthe1stGlitch` | weapon (melee) | unknown | no rarity, no evidence |  |  |
| Sword of the Zenith `InfernalEclipseAPI:Swordofthe14thGlitch` | weapon (melee) | unknown | no rarity, no evidence |  |  |
| The Chicken Wing `InfernalEclipseAPI:TheChickenWing` | weapon (melee) | unknown | no rarity, no evidence | Infernum Egg |  |

### InfernalEclipseWeaponsDLC (11)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Star Scepter `InfernalEclipseWeaponsDLC:StarScepter` | weapon (magic) | Wall of Flesh | rarity guess | Light Red |  |
| Obsidian Sickle `InfernalEclipseWeaponsDLC:ObsidianSickle` | weapon (melee) | Skeletron Prime | rarity guess | Pink |  |
| All Seer's Glass `InfernalEclipseWeaponsDLC:AllSeersGlass` | accessory | Golem | rarity guess | Lime |  |
| Eclipse Helm `InfernalEclipseWeaponsDLC:EclipseHelm` | head | Golem | rarity guess | Lime |  |
| Garuda Wings `InfernalEclipseWeaponsDLC:GarudaWings` | accessory | Golem | rarity guess | Lime |  |
| Arckane Staff `InfernalEclipseWeaponsDLC:ArckaneStaff` | weapon (magic) | Duke Fishron | rarity guess | Yellow |  |
| Garuda Circlet `InfernalEclipseWeaponsDLC:SuperCellCirclet` | head | Moon Lord | rarity guess | Purple |  |
| Garuda Guard `InfernalEclipseWeaponsDLC:SuperCellGuard` | body | Moon Lord | rarity guess | Purple |  |
| Garuda Sabatons `InfernalEclipseWeaponsDLC:SuperCellSabatons` | legs | Moon Lord | rarity guess | Purple |  |
| The Ultimate Stick of Supreme Power and Infinite Destruction `InfernalEclipseWeaponsDLC:Stick` | weapon (melee) | Moon Lord | rarity guess | Purple |  |
| Blighted Badge `InfernalEclipseWeaponsDLC:BlightedBadge` | accessory | Providence, the Profaned Goddess | rarity guess | Turquoise |  |

### CalamitySimpleWhipAddon (7)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Droptide `CalamitySimpleWhipAddon:Droptide` | weapon (summon) | Eye of Cthulhu | rarity guess | Green |  |
| Ancient Bonds `CalamitySimpleWhipAddon:AncientBonds` | weapon (summon) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Kusari Gama `CalamitySimpleWhipAddon:KusariGama` | weapon (summon) | Wall of Flesh | rarity guess | Light Red |  |
| Loadout `CalamitySimpleWhipAddon:Loadout` | weapon (summon) | Duke Fishron | rarity guess | Yellow |  |
| Bleached Nucleogenesis `CalamitySimpleWhipAddon:BleachedNucleogenesis` | accessory | The Devourer of Gods | rarity guess | Cosmic Purple |  |
| Aurelian Sanctum `CalamitySimpleWhipAddon:AurelianSanctum` | weapon (summon) | Supreme Witch, Calamitas | rarity guess | Hot Pink |  |
| Chorus of Execration `CalamitySimpleWhipAddon:ChorusofExecration` | weapon (summon) | Supreme Witch, Calamitas | rarity guess | Calamity Red |  |

### XDContentMod (5)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Baidu Tieba Huájí Disc `XDContentMod:BaiduTiebaHuajiDisc` | weapon (melee) | Skeletron Prime | rarity guess | Pink |  |
| Hupu Disc `XDContentMod:HupuDisc` | weapon (melee) | Skeletron Prime | rarity guess | Pink |  |
| iFlytek Disc `XDContentMod:iFlytekDisc` | weapon (melee) | Skeletron Prime | rarity guess | Pink |  |
| LOOK Disc `XDContentMod:LOOKDisc` | weapon (melee) | Skeletron Prime | rarity guess | Pink |  |
| Pururu Disc `XDContentMod:PururuDisc` | weapon (melee) | Skeletron Prime | rarity guess | Pink |  |

### InfernumMode (5)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Eye of Madness `InfernumMode:EyeOfMadness` | weapon (magic) | Yharon, Dragon of Rebirth | rarity guess | Burnished Auric | drop Primordial Wyrm |
| Illusioner's Reverie `InfernumMode:IllusionersReverie` | weapon (magic) | Yharon, Dragon of Rebirth | rarity guess | Burnished Auric | drop Primordial Wyrm |
| Flower of the Ocean `InfernumMode:FlowerOfTheOcean` | accessory | unknown | no rarity, no evidence | Infernum Ocean Flower |  |
| Purity `InfernumMode:Purity` | accessory | unknown | no rarity, no evidence | Infernum Purity |  |
| Sakura Bloom `InfernumMode:SakuraBloom` | accessory | unknown | no rarity, no evidence | Infernum Sakura |  |

### SOTSBardHealer (5)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Ring of Rest `SOTSBardHealer:RingofRest` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Infrasonic Tuner `SOTSBardHealer:InfrasonicTuner` | accessory | Duke Fishron | rarity guess | Yellow |  |
| Serpent's Tongue `SOTSBardHealer:SerpentsTongue` | accessory | Duke Fishron | rarity guess | Yellow |  |
| Hypersonic Tuner `SOTSBardHealer:HypersonicTuner` | accessory | Lunatic Cultist | rarity guess | Cyan |  |
| 4-Dimensional Tuner `SOTSBardHealer:TesseractTuner` | accessory | Moon Lord | rarity guess | Purple |  |

### CalamityHunt (4)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Replica Gauntlets `CalamityHunt:ReplicaGauntlets` | accessory | unknown | no rarity, no evidence |  |  |
| Thousand-Fold Paper Fans `CalamityHunt:ShogunWings` | accessory | unknown | no rarity, no evidence |  |  |
| Trailblazed Goggles `CalamityHunt:TrailblazerGoggles` | accessory | unknown | no rarity, no evidence |  |  |
| Trailblazed Tactical Backpack `CalamityHunt:TrailblazerBackpack` | accessory | unknown | no rarity, no evidence |  |  |

### RagnarokMod (4)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Victide Hatanemone `RagnarokMod:VictideHeadBard` | head | Eye of Cthulhu | rarity guess | Green |  |
| Victide Sponge Hood `RagnarokMod:VictideHeadHealer` | head | Eye of Cthulhu | rarity guess | Green |  |
| Intergelactic Ramhelm `RagnarokMod:IntergelacticRamhelm` | head | unknown | no rarity, no evidence |  |  |
| True Squirrel Scarf `RagnarokMod:TrueSquirrelScarf` | accessory | unknown | no rarity, no evidence |  |  |

### CatalystMod (3)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Catharsis `CatalystMod:Catharsis` | weapon (summon) | Supreme Witch, Calamitas | rarity guess | Calamity Red |  |
| Influx Cluster `CatalystMod:InfluxCluster` | accessory | unknown | no rarity, no evidence |  | bag Treasure Pod ({$Mods.CatalystMod.NPCs.Astrageldon.DisplayName}) |
| Scythe of the Abandoned God `CatalystMod:ScytheoftheAbandonedGod` | weapon (other) | unknown | no rarity, no evidence |  |  |

### NoxusBoss (2)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Autoloadable Music Box Item `NoxusBoss:AutoloadableMusicBoxItem` | accessory | Wall of Flesh | rarity guess | Light Red |  |
| Staff Of Rejuvenation `NoxusBoss:StaffOfRejuvenation` | weapon (melee) | unknown | no rarity, no evidence | Solyn Reward |  |

### FishingMinigame (1)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Soothing Lure `FishingMinigame:SoothingLure` | accessory | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |

### CalamityAmmo (1)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Suspended Shotgun Shell Launcher `CalamityAmmo:GrapeLauncher` | weapon (ranged) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |

### CalamityAddon (1)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| W.D.A.S. `CalamityAddon:WDAS` | accessory | Eye of Cthulhu | rarity guess | Green | drop Wulfrum Jumper |
