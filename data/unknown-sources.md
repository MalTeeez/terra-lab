# Items without a known source

Generated 2026-09-04 from data/dataset.json.

The miner reads drops, boss bags, shops, fishing, natural spawns, world-generation chests and recipes from the mod code. What is listed here is what that left open:

- **Unresolved gates** are flags the code checks that the miner cannot place on the boss order. Each one blocks every piece of evidence behind it. Answering "which boss / event makes this true" in `miner/stage/progression.json` (`downedFlags`, `zones`) fixes all of them at once.
- **Equipment with a guessed stage** has no usable evidence: the stage is the rarity guess. The code paths the miner did see are listed so the missing one can be spotted (an event, a locked chest, a mechanic the miner does not read yet).

Not listed: 68 equipment items and 5 materials of rarity 0–1 guessed at Pre-boss (world blocks, common drops) — `--all` includes them.

## Materials that gate equipment

Sorted by how many equipment items need them through their crafting tree.

| material | mod | guessed stage | why | rarity | used by | code paths seen |
| --- | --- | --- | --- | --- | --- | --- |
| Aquaite Bar `ThoriumMod:AquaiteBar` | ThoriumMod | Eye of Cthulhu | chest at world generation (WorldGenerationSystem.AddChestWithDefaultLoot), rarity floor | 2 | 24 | bag Wondrous Crate (Plantera); bag Strange Crate; bag Aquatic Depths Crate; bag Abyssal Crate (FallenBeholderCondition); worldgen WorldGenerationSystem.AddChestWithDefaultLoot | <!-- C: can be crafted from aquaite, requires min 65% pickaxe power (https://thoriummod.wiki.gg/wiki/Aquaite). Can also be obtained from biome chests, but those are post-plantera -->
| Essence of Despair `StarsAbove:EssenceOfDespair` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  | <!-- C: again see https://starsabovemod.wiki.gg/wiki/Essences , "Have a Guide Voodoo Doll in the inventory while on a Hardcore character. " -->
| Essence of the Cosmos `StarsAbove:EssenceOfTheCosmos` | StarsAbove | unknown | no rarity, no evidence |  | 1 |  |  <!-- C: cant be obtained currently -->

## Equipment with a guessed stage

### Terraria (120)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Bladed Glove `v:1827` | weapon (melee) | Eye of Cthulhu | rarity guess | Green |  |
| Bloody Machete `v:1825` | weapon (melee) | Eye of Cthulhu | rarity guess | Green |  |
| Classy Cane `v:3351` | weapon (other) | Eye of Cthulhu | rarity guess | Green |  |
| Combat Wrench `v:4818` | weapon (melee) | Eye of Cthulhu | rarity guess | Green | shop Mechanic |
| Moon Lord Legs `v:5001` | legs | Eye of Cthulhu | rarity guess | Green |  |
| Terragrim `v:4144` | weapon (melee) | Eye of Cthulhu | rarity guess | Green | shop Archaeologist; shop Princess (seed:TenthAnniversaryWorld) |
| Abigail's Flower `v:5114` | weapon (summon) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Ballista Rod `v:3824` | weapon (summon) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Cascade `v:3282` | weapon (melee) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Explosive Trap Rod `v:3832` | weapon (summon) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Flameburst Rod `v:3818` | weapon (summon) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Lightning Aura Rod `v:3829` | weapon (summon) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Amarok `v:3289` | weapon (melee) | Wall of Flesh | rarity guess | Light Red |  |
| Fin Wings `v:2494` | accessory | Wall of Flesh | rarity guess | Light Red |  |
| Hel-Fire `v:3290` | weapon (melee) | Wall of Flesh | rarity guess | Light Red |  |
| Ballista Cane `v:3825` | weapon (summon) | Skeletron Prime | rarity guess | Pink |  |
| Chromatic Cloak `v:5355` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Explosive Trap Cane `v:3833` | weapon (summon) | Skeletron Prime | rarity guess | Pink |  |
| Flameburst Cane `v:3819` | weapon (summon) | Skeletron Prime | rarity guess | Pink |  |
| Glass Slipper `v:5077` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Lightning Aura Cane `v:3830` | weapon (summon) | Skeletron Prime | rarity guess | Pink |  |
| Prince Cape `v:5080` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Resonance Scepter `v:5065` | weapon (magic) | Skeletron Prime | rarity guess | Pink | shop Princess (Hardmode) |
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
| Amphibian Boots `v:3990` | accessory | unknown | no rarity, no evidence | Pink |  |
| Arcane Flower `v:3991` | accessory | unknown | no rarity, no evidence | Pink |  |
| Ash Wood Bow `v:5282` | weapon (ranged) | unknown | no rarity, no evidence | White |  |
| Ash Wood Breastplate `v:5280` | body | unknown | no rarity, no evidence | White |  |
| Ash Wood Greaves `v:5281` | legs | unknown | no rarity, no evidence | White |  |
| Ash Wood Hammer `v:5283` | weapon (melee) | unknown | no rarity, no evidence | White |  |
| Ash Wood Helmet `v:5279` | head | unknown | no rarity, no evidence | White |  |
| Ash Wood Sword `v:5284` | weapon (melee) | unknown | no rarity, no evidence | White |  |
| Berserker's Glove `v:3992` | accessory | unknown | no rarity, no evidence | Pink |  |
| Black Golf Ball `v:4242` | accessory | unknown | no rarity, no evidence | Green |  |
| Blue Golf Ball `v:4243` | accessory | unknown | no rarity, no evidence | Green |  |
| Brown Golf Ball `v:4244` | accessory | unknown | no rarity, no evidence | Green |  |
| Cyan Golf Ball `v:4245` | accessory | unknown | no rarity, no evidence | Green |  |
| Fairy Boots `v:3993` | accessory | unknown | no rarity, no evidence | Pink |  |
| Fast Clock `v:889` | accessory | unknown | no rarity, no evidence | Light Red | drop Necromancer; drop Necromancer |
| Flymeal `v:5129` | weapon (melee) | unknown | no rarity, no evidence | Green |  |
| Frog Flipper `v:3994` | accessory | unknown | no rarity, no evidence | Pink |  |
| Frog Gear `v:3995` | accessory | unknown | no rarity, no evidence | Pink |  |
| Frog Webbing `v:3996` | accessory | unknown | no rarity, no evidence | Pink |  |
| Frozen Shield `v:3997` | accessory | unknown | no rarity, no evidence | Pink |  |
| Green Golf Ball `v:4246` | accessory | unknown | no rarity, no evidence | Green |  |
| Hellfire Treads `v:4874` | accessory | unknown | no rarity, no evidence | Lime |  |
| Hero Shield `v:3998` | accessory | unknown | no rarity, no evidence | Pink |  |
| Lime Golf Ball `v:4247` | accessory | unknown | no rarity, no evidence | Green |  |
| Magma Skull `v:3999` | accessory | unknown | no rarity, no evidence | Pink |  |
| Magnet Flower `v:4000` | accessory | unknown | no rarity, no evidence | Pink |  |
| Mana Cloak `v:4001` | accessory | unknown | no rarity, no evidence | Pink |  |
| Megaphone `v:890` | accessory | unknown | no rarity, no evidence | Light Red |  |
| Molten Charm `v:4038` | accessory | unknown | no rarity, no evidence | Pink |  |
| Molten Quiver `v:4002` | accessory | unknown | no rarity, no evidence | Pink |  |
| Molten Skull Rose `v:4003` | accessory | unknown | no rarity, no evidence | Light Purple |  |
| Obsidian Skull Rose `v:4004` | accessory | unknown | no rarity, no evidence | Pink |  |
| Orange Golf Ball `v:4248` | accessory | unknown | no rarity, no evidence | Green |  |
| Pink Golf Ball `v:4249` | accessory | unknown | no rarity, no evidence | Green |  |
| Purple Golf Ball `v:4250` | accessory | unknown | no rarity, no evidence | Green |  |
| Recon Scope `v:4005` | accessory | unknown | no rarity, no evidence | Pink |  |
| Red Golf Ball `v:4251` | accessory | unknown | no rarity, no evidence | Green |  |
| Sky Blue Golf Ball `v:4252` | accessory | unknown | no rarity, no evidence | Green |  |
| Stalker's Quiver `v:4006` | accessory | unknown | no rarity, no evidence | Pink |  |
| Stinger Necklace `v:4007` | accessory | unknown | no rarity, no evidence | Pink |  |
| Teal Golf Ball `v:4253` | accessory | unknown | no rarity, no evidence | Green |  |
| Ultrabright Helmet `v:4008` | head | unknown | no rarity, no evidence | Pink |  |
| Violet Golf Ball `v:4254` | accessory | unknown | no rarity, no evidence | Green |  |
| Water Bolt `v:165` | weapon (magic) | unknown | no rarity, no evidence | Green |  |
| Yellow Golf Ball `v:4255` | accessory | unknown | no rarity, no evidence | Green |  |

### ThoriumMod (71)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Aloe Leaf `ThoriumMod:AloeLeaf` | accessory | Eye of Cthulhu | rarity guess | Green |  |
| Cursed Sawblade `ThoriumMod:SawbladeCursed` | weapon (ranged) | Eye of Cthulhu | rarity guess | Green |  |
| Dazzling Sawblade `ThoriumMod:SawbladeLight` | weapon (ranged) | Eye of Cthulhu | rarity guess | Green |  |
| Frozen Sawblade `ThoriumMod:SawbladeFrozen` | weapon (ranged) | Eye of Cthulhu | rarity guess | Green |  |
| Molten Sawblade `ThoriumMod:SawbladeMolten` | weapon (ranged) | Eye of Cthulhu | rarity guess | Green |  |
| Totem Caller `ThoriumMod:TotemCaller` | weapon (summon) | Eye of Cthulhu | rarity guess | Green |  |
| Vile Sawblade `ThoriumMod:SawbladeIchor` | weapon (ranged) | Eye of Cthulhu | rarity guess | Green |  |
| Whip `ThoriumMod:Whip` | weapon (melee) | Eye of Cthulhu | rarity guess | Green |  |
| Molten Knife `ThoriumMod:MoltenKnife` | weapon (thrower) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Music Player Damage `ThoriumMod:MusicPlayerDamage` | accessory | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Music Player Damage Reduction `ThoriumMod:MusicPlayerDamageReduction` | accessory | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Music Player Life Regen `ThoriumMod:MusicPlayerLifeRegen` | accessory | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Music Player Movement Speed `ThoriumMod:MusicPlayerMovementSpeed` | accessory | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Thor's Hammer: Magic `ThoriumMod:MagicThorHammer` | weapon (magic) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Thor's Hammer: Ranged `ThoriumMod:RangedThorHammer` | weapon (ranged) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Adamantite Ricochet `ThoriumMod:AdamantiteGlaive` | weapon (thrower) | Wall of Flesh | rarity guess | Light Red |  |
| Aphrodisiac Vial `ThoriumMod:AphrodisiacVial` | weapon (thrower) | Wall of Flesh | rarity guess | Light Red |  |
| Cobalt Throwing Spear `ThoriumMod:CobaltThrowingSpear` | weapon (thrower) | Wall of Flesh | rarity guess | Light Red |  |
| Combustion Vial `ThoriumMod:CombustionFlask` | weapon (thrower) | Wall of Flesh | rarity guess | Light Red |  |
| Corrosive Vial `ThoriumMod:CorrosionBeaker` | weapon (thrower) | Wall of Flesh | rarity guess | Light Red |  |
| Corrupter's Balloon `ThoriumMod:CorrupterBalloon` | weapon (thrower) | Wall of Flesh | rarity guess | Light Red |  |
| Crystal Balloon `ThoriumMod:CrystalBalloon` | weapon (thrower) | Wall of Flesh | rarity guess | Light Red |  |
| Cursed Hammer `ThoriumMod:CursedHammer` | weapon (healer) | Wall of Flesh | rarity guess | Light Red |  |
| Ebony Tail `ThoriumMod:EbonyTail` | weapon (melee) | Wall of Flesh | rarity guess | Light Red | drop Sand Poacher; drop Sand Poacher |
| Festering Balloon `ThoriumMod:FesteringBalloon` | weapon (thrower) | Wall of Flesh | rarity guess | Light Red |  |
| Gas Container `ThoriumMod:GasContainer` | weapon (thrower) | Wall of Flesh | rarity guess | Light Red |  |
| Nitrogen Vial `ThoriumMod:NitrogenVial` | weapon (thrower) | Wall of Flesh | rarity guess | Light Red |  |
| Palladium Throwing Spear `ThoriumMod:PalladiumThrowingSpear` | weapon (thrower) | Wall of Flesh | rarity guess | Light Red |  |
| Titanium Ricochet `ThoriumMod:TitaniumGlaive` | weapon (thrower) | Wall of Flesh | rarity guess | Light Red |  |
| Arthropod `ThoriumMod:Arthropod` | weapon (melee) | Skeletron Prime | rarity guess | Pink |  |
| Borean Fang Staff `ThoriumMod:BoreanFangStaff` | weapon (magic) | Skeletron Prime | rarity guess | Pink |  |
| Drider's Grace `ThoriumMod:DridersGrace` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Freeze Ray `ThoriumMod:FreezeRay` | weapon (ranged) | Skeletron Prime | rarity guess | Pink |  |
| Glacial Sting `ThoriumMod:GlacialSting` | weapon (ranged) | Skeletron Prime | rarity guess | Pink |  |
| Glacier `ThoriumMod:Glacier` | weapon (melee) | Skeletron Prime | rarity guess | Pink |  |
| Ice Bound Strider Hide `ThoriumMod:IceBoundStriderHide` | accessory | Skeletron Prime | rarity guess | Pink | bag Borean Strider Treasure Bag |
| Icy Gaze `ThoriumMod:IcyGaze` | weapon (magic) | Skeletron Prime | rarity guess | Pink |  |
| The Cryo-Fang `ThoriumMod:TheCryoFang` | weapon (thrower) | Skeletron Prime | rarity guess | Pink |  |
| Tune Player Damage `ThoriumMod:TunePlayerDamage` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Tune Player Damage Reduction `ThoriumMod:TunePlayerDamageReduction` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Tune Player Life Regen `ThoriumMod:TunePlayerLifeRegen` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Tune Player Movement Speed `ThoriumMod:TunePlayerMovementSpeed` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Titan Breastplate `ThoriumMod:TitanBreastplate` | body | Plantera | rarity guess | Light Purple |  |
| Titan Greaves `ThoriumMod:TitanGreaves` | legs | Plantera | rarity guess | Light Purple |  |
| Titan Headgear `ThoriumMod:TitanHeadgear` | head | Plantera | rarity guess | Light Purple |  |
| Titan Helmet `ThoriumMod:TitanHelmet` | head | Plantera | rarity guess | Light Purple |  |
| Titan Mask `ThoriumMod:TitanMask` | head | Plantera | rarity guess | Light Purple |  |
| Titan Wings `ThoriumMod:TitanWings` | accessory | Plantera | rarity guess | Light Purple |  |
| Flawless Chrysalis `ThoriumMod:FlawlessChrysalis` | accessory | Golem | rarity guess | Lime |  |
| Demon Blood Bow `ThoriumMod:DemonBloodBow` | weapon (ranged) | Duke Fishron | rarity guess | Yellow |  |
| Fishbone `ThoriumMod:Fishbone` | weapon (bard) | Duke Fishron | chest at world generation (WorldGenerationSystem.GenerateBiomeChests), rarity floor | Yellow | worldgen WorldGenerationSystem.GenerateBiomeChests |
| God Killer `ThoriumMod:GodKiller` | weapon (magic) | Duke Fishron | rarity guess | Yellow |  |
| Pharaoh's Slab `ThoriumMod:PharaohsSlab` | weapon (thrower) | Duke Fishron | chest at world generation (ThoriumWorld.PostWorldGen), rarity floor | Yellow | worldgen ThoriumWorld.PostWorldGen |
| Plasma Vial `ThoriumMod:PlasmaVial` | weapon (thrower) | Duke Fishron | rarity guess | Yellow |  |
| The Black Blade `ThoriumMod:TheBlackBlade` | weapon (melee) | Duke Fishron | rarity guess | Yellow |  |
| The Black Bow `ThoriumMod:TheBlackBow` | weapon (ranged) | Duke Fishron | rarity guess | Yellow |  |
| The Black Cane `ThoriumMod:TheBlackCane` | weapon (summon) | Duke Fishron | rarity guess | Yellow |  |
| The Black Dagger `ThoriumMod:TheBlackDagger` | weapon (thrower) | Duke Fishron | rarity guess | Yellow |  |
| The Black Otamatone `ThoriumMod:TheBlackOtamatone` | weapon (bard) | Duke Fishron | rarity guess | Yellow |  |
| The Black Scythe `ThoriumMod:TheBlackScythe` | weapon (healer) | Duke Fishron | rarity guess | Yellow |  |
| The Black Staff `ThoriumMod:TheBlackStaff` | weapon (magic) | Duke Fishron | rarity guess | Yellow |  |
| Cataclysmic Garb `ThoriumMod:CataclysmicsGarb` | accessory | Lunatic Cultist | rarity guess | Cyan |  |
| Halcandran Deluxe Apparel `ThoriumMod:HalcandranDeluxeApparel` | accessory | Lunatic Cultist | rarity guess | Cyan |  |
| Phonic Wings `ThoriumMod:PhonicWings` | accessory | Lunatic Cultist | rarity guess | Cyan |  |
| Arcane Spike `ThoriumMod:ArcaneSpike` | weapon (magic) | Moon Lord | rarity guess | Blood Orange |  |
| Basic Pickaxe `ThoriumMod:BasicPickaxe` | weapon (melee) | Moon Lord | rarity guess | Blood Orange |  |
| Destiny Weaver `ThoriumMod:DestinyWeaver` | weapon (classless) | Moon Lord | rarity guess | Blood Orange |  |
| Fragment of Heaven `ThoriumMod:GodMode` | accessory | Moon Lord | rarity guess | Blood Orange |  |
| Soul Gem `ThoriumMod:SoulGem` | accessory | Moon Lord | rarity guess | Blood Orange |  |
| Unassuming Purple Stone `ThoriumMod:StonePurple` | weapon (other) | Moon Lord | rarity guess | Blood Orange |  |
| The Ring `ThoriumMod:TheRing` | accessory | unknown | no rarity, no evidence | Green |  |

### CalValEX (66)

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
| Burning Eye `CalValEX:BurningEye` | accessory | unknown | no rarity, no evidence | Light Purple |  |
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
| Wings of Termina `CalValEX:TerminalWings` | accessory | unknown | no rarity, no evidence | Purple |  |
| Wulfrum Helipack `CalValEX:WulfrumHelipack` | accessory | unknown | no rarity, no evidence | Blue | drop v:-1 |
| XF Model Chestplate `CalValEX:AresChestplate` | body | unknown | no rarity, no evidence |  |  |
| XS Leash Bundle `CalValEX:ExoTwinsBalloon` | accessory | unknown | no rarity, no evidence |  |  |
| XS Leash-01 `CalValEX:ArtemisBalloon` | accessory | unknown | no rarity, no evidence |  |  |
| XS Leash-03 `CalValEX:ApolloBalloon` | accessory | unknown | no rarity, no evidence |  |  |
| Yharon's Shackle `CalValEX:YharonShackle` | accessory | unknown | no rarity, no evidence |  |  |

### SOTS (32)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Amulet of Emptiness `SOTS:EmptyNecklace` | accessory | Eye of Cthulhu | chest at world generation (SanctuaryWorldgenHelper.FillChestsWithLoot), rarity floor | Green | worldgen SanctuaryWorldgenHelper.FillChestsWithLoot |
| Dreamcatcher `SOTS:Dreamcatcher` | accessory | Eye of Cthulhu | chest at world generation (SanctuaryWorldgenHelper.FillChestsWithLoot), rarity floor | Green | worldgen SanctuaryWorldgenHelper.FillChestsWithLoot |
| Anomaly Locator `SOTS:AnomalyLocator` | accessory | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange | shop Archaeologist |
| Crushing Capacitor `SOTS:CrushingCapacitor` | accessory | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Enchanted Pickaxe `SOTS:EnchantedPickaxe` | weapon (melee) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Golden Trowel `SOTS:GoldenTrowel` | accessory | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange | shop Archaeologist |
| Recursive Bow `SOTS:RecursiveBow` | weapon (ranged) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Dreaming Lamp `SOTS:DreamLamp` | weapon (void) | Wall of Flesh | rarity guess | Light Red | shop Archaeologist |
| Vorpal Knife `SOTS:VorpalKnife` | weapon (void) | Wall of Flesh | chest at world generation (GemStructureWorldgenHelper.FillChestsWithLoot), rarity floor | Light Red | shop Archaeologist; worldgen GemStructureWorldgenHelper.FillChestsWithLoot |
| Bone Clapper `SOTS:BoneClapper` | weapon (void) | Skeletron Prime | chest at world generation (SOTSWorld.PostWorldGen), rarity floor | Pink | shop Archaeologist (Boss3); worldgen SOTSWorld.PostWorldGen |
| Colossus `SOTS:Colossus` | weapon (melee) | Skeletron Prime | rarity guess | Pink |  |
| Tesseract Sword `SOTS:TesseractSword` | weapon (void) | Skeletron Prime | rarity guess | Pink |  |
| Cursed Apple `SOTS:CursedApple` | accessory | Plantera | rarity guess | Light Purple | shop Archaeologist |
| Photon Geyser `SOTS:PhotonGeyser` | weapon (magic) | Plantera | rarity guess | Light Purple | shop Archaeologist |
| Dune Splicer `SOTS:DuneSplicer` | weapon (void) | Duke Fishron | chest at world generation (SOTSWorld.PostWorldGen), rarity floor | Yellow | worldgen SOTSWorld.PostWorldGen |
| Pathogen Regurgitator `SOTS:PathogenRegurgitator` | weapon (ranged) | Duke Fishron | chest at world generation (SOTSWorld.PostWorldGen), rarity floor | Yellow | worldgen SOTSWorld.PostWorldGen |
| Rebar Rifle `SOTS:RebarRifle` | weapon (ranged) | Duke Fishron | chest at world generation (SOTSWorld.PostWorldGen), rarity floor | Yellow | worldgen SOTSWorld.PostWorldGen |
| Sawflake `SOTS:Sawflake` | weapon (melee) | Duke Fishron | chest at world generation (SOTSWorld.PostWorldGen), rarity floor | Yellow | worldgen SOTSWorld.PostWorldGen |
| Starcaller Staff `SOTS:StarcallerStaff` | weapon (summon) | Duke Fishron | chest at world generation (SOTSWorld.PostWorldGen), rarity floor | Yellow | worldgen SOTSWorld.PostWorldGen |
| Tangle Staff `SOTS:TangleStaff` | weapon (magic) | Duke Fishron | chest at world generation (SOTSWorld.PostWorldGen), rarity floor | Yellow | worldgen SOTSWorld.PostWorldGen |
| The Dark Eye `SOTS:TheDarkEye` | accessory | Duke Fishron | rarity guess | Yellow | drop Wall Mimic |
| Train Gun `SOTS:Traingun` | weapon (ranged) | Lunatic Cultist | rarity guess | Cyan |  |
| Continuum Collapse `SOTS:ContinuumCollapse` | weapon (void) | Moon Lord | rarity guess | Purple |  |
| Infinite Void `SOTS:InfiniteVoid` | accessory | Moon Lord | rarity guess | Purple |  |
| Suprem `SOTS:SupremSticker` | accessory | Moon Lord | rarity guess | Red |  |
| Atlantis `SOTS:Atlantis` | weapon (void) | unknown | no rarity, no evidence | Anomaly |  |
| Digital Daito `SOTS:DigitalDaito` | weapon (melee) | unknown | no rarity, no evidence | Cyan |  |
| Infinity Pouch `SOTS:InfinityPouch` | accessory | unknown | no rarity, no evidence | Anomaly |  |
| Mr. Glorp `SOTS:MrGlorp` | accessory | unknown | no rarity, no evidence | Anomaly |  |
| Obsidian Eruption `SOTS:ObsidianEruption` | weapon (melee) | unknown | no rarity, no evidence | Orange |  |
| Void Anomaly `SOTS:VoidAnomaly` | accessory | unknown | no rarity, no evidence | Anomaly |  |
| Voidmage Incubator `SOTS:VoidmageIncubator` | accessory | unknown | no rarity, no evidence | Yellow |  |

### CalamityMod (30)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Experimental Wulfrum Fusion Array `CalamityMod:WulfrumFusionCannon` | weapon (summon) | Eye of Cthulhu | rarity guess | Green |  |
| Ha-pu Fruit `CalamityMod:HapuFruit` | accessory | Eye of Cthulhu | rarity guess | Green | bag Starter Bag |
| Sea Spirit Amulet `CalamityMod:SeaSpiritAmulet` | accessory | Eye of Cthulhu | rarity guess | Green |  |
| Sparkling Empress `CalamityMod:SparklingEmpress` | weapon (magic) | Eye of Cthulhu | rarity guess | Green |  |
| Clothier's Wrath `CalamityMod:ClothiersWrath` | weapon (magic) | Wall of Flesh | rarity guess | Light Red | drop Clothier (Hardmode) |
| Elephant Killer `CalamityMod:ElephantKiller` | weapon (rogue) | Wall of Flesh | rarity guess | Light Red | drop Shady Salesman (Hardmode) |
| Evil Smasher `CalamityMod:EvilSmasher` | weapon (classless) | Wall of Flesh | rarity guess | Light Red |  |
| Spelunker's Amulet `CalamityMod:SpelunkersAmulet` | accessory | Wall of Flesh | chest at world generation (UndergroundShrines.FillDesertShrineChest), rarity floor | Light Red | worldgen UndergroundShrines.FillDesertShrineChest |
| The Pact `CalamityMod:ThePact` | accessory | Wall of Flesh | rarity guess | Light Red | shop Shady Salesman (Dreadnautilus) |
| Electrician's Glove `CalamityMod:ElectriciansGlove` | accessory | Skeletron Prime | rarity guess | Pink |  |
| Flak Toxicannon `CalamityMod:FlakToxicannon` | weapon (ranged) | Skeletron Prime | rarity guess | Pink | drop Flak Crab |
| Orthocera Shell `CalamityMod:OrthoceraShell` | weapon (summon) | Skeletron Prime | rarity guess | Pink | drop Orthocera |
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
| Cinder Blossom Staff `CalamityMod:CinderBlossomStaff` | weapon (summon) | unknown | no rarity, no evidence | Orange |  |
| Hellwing Staff `CalamityMod:HellwingStaff` | weapon (magic) | unknown | no rarity, no evidence | Orange |  |
| Infernal Kris `CalamityMod:InfernalKris` | weapon (rogue) | unknown | no rarity, no evidence | Orange |  |
| Lemon 'nade `CalamityMod:LemonNade` | weapon (rogue) | unknown | no rarity, no evidence | Green |  |

### CalamityBardHealer (29)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Aerospec Biretta `CalamityBardHealer:AerospecBiretta` | head | unknown | no rarity, no evidence | Orange |  |
| Aerospec Headphones `CalamityBardHealer:AerospecHeadphones` | head | unknown | no rarity, no evidence | Orange |  |
| Auric Tesla Feathered Headwear `CalamityBardHealer:AuricTeslaFeatheredHeadwear` | head | unknown | no rarity, no evidence |  |  |
| Auric Tesla Feathered Headwear[c/70f4f4:+] `CalamityBardHealer:AugmentedAuricTeslaFeatheredHeadwear` | head | unknown | no rarity, no evidence |  |  |
| Auric Tesla Valkyrie Visage `CalamityBardHealer:AuricTeslaValkyrieVisage` | head | unknown | no rarity, no evidence |  |  |
| Auric Tesla Valkyrie Visage[c/70f4f4:+] `CalamityBardHealer:AugmentedAuricTeslaValkyrieVisage` | head | unknown | no rarity, no evidence |  |  |
| Bloodflare Ritualist Mask `CalamityBardHealer:BloodflareRitualistMask` | head | unknown | no rarity, no evidence |  |  |
| Bloodflare Siren Skull `CalamityBardHealer:BloodflareSirenSkull` | head | unknown | no rarity, no evidence |  |  |
| Blooming Saintess Statue `CalamityBardHealer:BloomingSaintessStatue` | accessory | unknown | no rarity, no evidence |  |  |
| Daedalus Cowl `CalamityBardHealer:DaedalusCowl` | head | unknown | no rarity, no evidence | Pink |  |
| Daedalus Hat `CalamityBardHealer:DaedalusHat` | head | unknown | no rarity, no evidence | Pink |  |
| Elemental Bloom `CalamityBardHealer:ElementalBloom` | accessory | unknown | no rarity, no evidence |  |  |
| God Slayer Deathsinger's Cowl `CalamityBardHealer:GodSlayerDeathsingerCowl` | head | unknown | no rarity, no evidence |  |  |
| Hydrothermic Gas Mask `CalamityBardHealer:HydrothermicGasMask` | head | unknown | no rarity, no evidence | Yellow |  |
| Hydrothermic Hat `CalamityBardHealer:HydrothermicHat` | head | unknown | no rarity, no evidence | Yellow |  |
| Intergelactic Cloche `CalamityBardHealer:IntergelacticCloche` | head | unknown | no rarity, no evidence |  |  |
| Intergelactic Protector Helm `CalamityBardHealer:IntergelacticProtectorHelm` | head | unknown | no rarity, no evidence |  |  |
| Noisebringer Goliath `CalamityBardHealer:NoisebringerGoliath` | accessory | unknown | no rarity, no evidence | Yellow |  |
| Omni-Speaker `CalamityBardHealer:OmniSpeaker` | accessory | unknown | no rarity, no evidence |  |  |
| Silva Guardian's Helmet `CalamityBardHealer:SilvaGuardianHelmet` | head | unknown | no rarity, no evidence |  |  |
| Statigel Earrings `CalamityBardHealer:StatigelEarrings` | head | unknown | no rarity, no evidence | Light Red |  |
| Statigel Fox Mask `CalamityBardHealer:StatigelFoxMask` | head | unknown | no rarity, no evidence | Light Red |  |
| Tarragon Chapeau `CalamityBardHealer:TarragonChapeau` | head | unknown | no rarity, no evidence |  |  |
| Tarragon Paragon Crown `CalamityBardHealer:TarragonParagonCrown` | head | unknown | no rarity, no evidence |  |  |
| Tree Whisperer Amulet `CalamityBardHealer:TreeWhispererAmulet` | accessory | unknown | no rarity, no evidence |  |  |
| Victide Ammonite Hat `CalamityBardHealer:VictideAmmoniteHat` | head | unknown | no rarity, no evidence | Green |  |
| Void Faquir Deathsinger Chapeau `CalamityBardHealer:VoidFaquirChapeau` | head | unknown | no rarity, no evidence |  |  |
| Void Faquir Warpriest Biretta `CalamityBardHealer:VoidFaquirBiretta` | head | unknown | no rarity, no evidence |  |  |
| Yharim's Jam `CalamityBardHealer:YharimsJam` | accessory | unknown | no rarity, no evidence |  |  |

### StarsAbove (20)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Afterburner Wings `StarsAbove:AfterburnerWings` | accessory | Eye of Cthulhu | rarity guess | Green |  |
| Melee Wings `StarsAbove:MeleeWings` | accessory | Eye of Cthulhu | rarity guess | Green |  |
| Shield Wings `StarsAbove:ShieldWings` | accessory | Eye of Cthulhu | rarity guess | Green |  |
| Sniper Wings `StarsAbove:SniperWings` | accessory | Eye of Cthulhu | rarity guess | Green |  |
| Ruptured Heaven `StarsAbove:RupturedHeaven` | weapon (summon) | Wall of Flesh | rarity guess | Light Red |  |
| Every Moment Matters `StarsAbove:EveryMomentMatters` | weapon (ranged) | Skeletron Prime | rarity guess | Pink |  |
| Persephone `StarsAbove:Persephone` | weapon (melee) | Duke Fishron | rarity guess | Yellow |  |
| Black Silence's Gloves `StarsAbove:BlackSilenceGloves` | accessory | Moon Lord | rarity guess | Red |  |
| Cloak Of An Arbiter Cape `StarsAbove:CloakOfAnArbiterCape` | accessory | Moon Lord | rarity guess | Red |  |
| Dragged Below Gloves `StarsAbove:DraggedBelowGloves` | accessory | Moon Lord | rarity guess | Red |  |
| Dreadmother Claw `StarsAbove:DreadmotherClaw` | accessory | Moon Lord | rarity guess | Red |  |
| E.G.O. Cape/Tail `StarsAbove:ManifestationCape` | accessory | Moon Lord | rarity guess | Red |  |
| Legendary Shield Accessory `StarsAbove:LegendaryShieldAccessory` | accessory | Moon Lord | rarity guess | Red |  |
| Neopursuant Plasteel Cape `StarsAbove:NeopursuantPlasteelCape` | accessory | Moon Lord | rarity guess | Red |  |
| Neopursuant Roguegarb Cape `StarsAbove:NeopursuantRoguegarbCape` | accessory | Moon Lord | rarity guess | Red |  |
| Origin Infinity `StarsAbove:OriginInfinity` | weapon (other) | Moon Lord | rarity guess | Purple |  |
| Red Mist's Gloves `StarsAbove:RedMistGloves` | accessory | Moon Lord | rarity guess | Red |  |
| Ignition Astra `StarsAbove:IgnitionAstra` | weapon (other) | unknown | no rarity, no evidence | Purple |  |
| Kariumu's Favor `StarsAbove:BrilliantSpectrum` | weapon (other) | unknown | no rarity, no evidence | Pink |  |
| Sanguine Despair `StarsAbove:SanguineDespair` | weapon (magic) | unknown | no rarity, no evidence | Light Red |  |

### ThoriumRework (18)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Whistler's Hat `ThoriumRework:WhistlersHat` | head | Eye of Cthulhu | rarity guess | Green |  |
| Whistler's Tunic `ThoriumRework:WhistlersTunic` | body | Eye of Cthulhu | rarity guess | Green |  |
| Pocket Energy Storm `ThoriumRework:PocketEnergyStorm` | weapon (other) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Repurposed Star Caller `ThoriumRework:RepurposedStarCaller` | weapon (summon) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Spitting Shroom Staff `ThoriumRework:SpittingShroomStaff` | weapon (summon) | Skeletron Prime | rarity guess | Pink |  |
| Will of Coznix `ThoriumRework:BeholderBlade` | weapon (melee) | Skeletron Prime | rarity guess | Pink |  |
| Instrument of Torment `ThoriumRework:LichWhip` | weapon (summon) | Plantera | rarity guess | Light Purple |  |
| Titan Hat `ThoriumRework:TitanHat` | head | Plantera | rarity guess | Light Purple |  |
| Titan Hood `ThoriumRework:TitanHood` | head | Plantera | rarity guess | Light Purple |  |
| Titan Visage `ThoriumRework:TitanVisage` | head | Plantera | rarity guess | Light Purple |  |
| Titan Visor `ThoriumRework:TitanVisor` | head | Plantera | rarity guess | Light Purple |  |
| Concussive Instrument `ThoriumRework:ConcussiveInstrument` | accessory | unknown | no rarity, no evidence | Blue |  |
| Executioner's Contract `ThoriumRework:ExecutionersContract` | accessory | unknown | no rarity, no evidence | Lime |  |
| Fan Donations `ThoriumRework:FanDonations` | accessory | unknown | no rarity, no evidence | Lime |  |
| Impulse Amplifier `ThoriumRework:ImpulseAmplifier` | accessory | unknown | no rarity, no evidence | Orange |  |
| Lunate Charm `ThoriumRework:LunateCharm` | accessory | unknown | no rarity, no evidence | Blue |  |
| Oneirophobia `ThoriumRework:Oneirophobia` | weapon (classless) | unknown | no rarity, no evidence |  |  |
| Sealed Contract `ThoriumRework:SealedContract` | accessory | unknown | no rarity, no evidence | Red |  |

### InfernalEclipseAPI (12)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Shattered Subcommunity `InfernalEclipseAPI:ShatteredSubcommunity` | accessory | Supreme Witch, Calamitas | rarity guess | Hot Pink |  |
| Celestial Illumination `InfernalEclipseAPI:CelestialIllumination` | weapon (magic) | unknown | no rarity, no evidence | Infernum Profaned |  |
| Destinary `InfernalEclipseAPI:Destinary` | weapon (melee) | unknown | no rarity, no evidence | Hot Pink |  |
| Exo Sights `InfernalEclipseAPI:ExoSights` | accessory | unknown | no rarity, no evidence | Exotic Rainbow |  |
| Lycanroc `InfernalEclipseAPI:Lycanroc` | weapon (ranged) | unknown | no rarity, no evidence | Infernum Profaned |  |
| Nova Bomb `InfernalEclipseAPI:NovaBomb` | weapon (magic) | unknown | no rarity, no evidence | Hot Pink |  |
| Streetsign `InfernalEclipseAPI:Streetsign` | weapon (melee) | unknown | no rarity, no evidence | Calamity Red |  |
| Sword of the Corrupted `InfernalEclipseAPI:Swordofthe13thGlitch` | weapon (melee) | unknown | no rarity, no evidence |  |  |
| Sword of the First `InfernalEclipseAPI:Swordofthe1stGlitch` | weapon (melee) | unknown | no rarity, no evidence |  |  |
| Sword of the Zenith `InfernalEclipseAPI:Swordofthe14thGlitch` | weapon (melee) | unknown | no rarity, no evidence |  |  |
| The Chicken Wing `InfernalEclipseAPI:TheChickenWing` | weapon (melee) | unknown | no rarity, no evidence | Infernum Egg |  |
| Tix-Burnt Ring `InfernalEclipseAPI:RingofTix` | accessory | unknown | no rarity, no evidence | Hot Pink |  |

### InfernalEclipseWeaponsDLC (11)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Obsidian Sickle `InfernalEclipseWeaponsDLC:ObsidianSickle` | weapon (melee) | Skeletron Prime | rarity guess | Pink |  |
| All Seer's Glass `InfernalEclipseWeaponsDLC:AllSeersGlass` | accessory | Golem | rarity guess | Lime |  |
| Garuda Wings `InfernalEclipseWeaponsDLC:GarudaWings` | accessory | Golem | rarity guess | Lime |  |
| The Ultimate Stick of Supreme Power and Infinite Destruction `InfernalEclipseWeaponsDLC:Stick` | weapon (melee) | Moon Lord | rarity guess | Purple |  |
| Arckane Staff `InfernalEclipseWeaponsDLC:ArckaneStaff` | weapon (magic) | unknown | no rarity, no evidence | Yellow |  |
| Blighted Badge `InfernalEclipseWeaponsDLC:BlightedBadge` | accessory | unknown | no rarity, no evidence | Turquoise |  |
| Eclipse Helm `InfernalEclipseWeaponsDLC:EclipseHelm` | head | unknown | no rarity, no evidence | Lime |  |
| Garuda Circlet `InfernalEclipseWeaponsDLC:SuperCellCirclet` | head | unknown | no rarity, no evidence | Purple |  |
| Garuda Guard `InfernalEclipseWeaponsDLC:SuperCellGuard` | body | unknown | no rarity, no evidence | Purple |  |
| Garuda Sabatons `InfernalEclipseWeaponsDLC:SuperCellSabatons` | legs | unknown | no rarity, no evidence | Purple |  |
| Star Scepter `InfernalEclipseWeaponsDLC:StarScepter` | weapon (magic) | unknown | no rarity, no evidence | Light Red |  |

### CalamitySimpleWhipAddon (6)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Ancient Bonds `CalamitySimpleWhipAddon:AncientBonds` | weapon (summon) | Eater of Worlds / Brain of Cthulhu | rarity guess | Orange |  |
| Kusari Gama `CalamitySimpleWhipAddon:KusariGama` | weapon (summon) | Wall of Flesh | rarity guess | Light Red |  |
| Loadout `CalamitySimpleWhipAddon:Loadout` | weapon (summon) | Duke Fishron | rarity guess | Yellow |  |
| Bleached Nucleogenesis `CalamitySimpleWhipAddon:BleachedNucleogenesis` | accessory | The Devourer of Gods | rarity guess | Cosmic Purple |  |
| Chorus of Execration `CalamitySimpleWhipAddon:ChorusofExecration` | weapon (summon) | Supreme Witch, Calamitas | rarity guess | Calamity Red |  |
| Droptide `CalamitySimpleWhipAddon:Droptide` | weapon (summon) | unknown | no rarity, no evidence | Green |  |

### SOTSBardHealer (6)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| 4-Dimensional Tuner `SOTSBardHealer:TesseractTuner` | accessory | unknown | no rarity, no evidence | Purple |  |
| Hypersonic Tuner `SOTSBardHealer:HypersonicTuner` | accessory | unknown | no rarity, no evidence | Cyan |  |
| Infrasonic Tuner `SOTSBardHealer:InfrasonicTuner` | accessory | unknown | no rarity, no evidence | Yellow |  |
| Ring of Rest `SOTSBardHealer:RingofRest` | accessory | unknown | no rarity, no evidence | Pink |  |
| Serpent's Tongue `SOTSBardHealer:SerpentsTongue` | accessory | unknown | no rarity, no evidence | Yellow |  |
| Subsonic Tuner `SOTSBardHealer:SubsonicTuner` | accessory | unknown | no rarity, no evidence | Blue |  |

### XDContentMod (5)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Baidu Tieba Huájí Disc `XDContentMod:BaiduTiebaHuajiDisc` | weapon (melee) | Skeletron Prime | rarity guess | Pink |  |
| Hupu Disc `XDContentMod:HupuDisc` | weapon (melee) | Skeletron Prime | rarity guess | Pink |  |
| iFlytek Disc `XDContentMod:iFlytekDisc` | weapon (melee) | Skeletron Prime | rarity guess | Pink |  |
| LOOK Disc `XDContentMod:LOOKDisc` | weapon (melee) | Skeletron Prime | rarity guess | Pink |  |
| Pururu Disc `XDContentMod:PururuDisc` | weapon (melee) | Skeletron Prime | rarity guess | Pink |  |

### CalamityHunt (4)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Replica Gauntlets `CalamityHunt:ReplicaGauntlets` | accessory | unknown | no rarity, no evidence |  |  |
| Thousand-Fold Paper Fans `CalamityHunt:ShogunWings` | accessory | unknown | no rarity, no evidence |  |  |
| Trailblazed Goggles `CalamityHunt:TrailblazerGoggles` | accessory | unknown | no rarity, no evidence |  |  |
| Trailblazed Tactical Backpack `CalamityHunt:TrailblazerBackpack` | accessory | unknown | no rarity, no evidence |  |  |

### InfernumMode (4)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| Eye of Madness `InfernumMode:EyeOfMadness` | weapon (magic) | Yharon, Dragon of Rebirth | rarity guess | Burnished Auric | drop Primordial Wyrm |
| Illusioner's Reverie `InfernumMode:IllusionersReverie` | weapon (magic) | Yharon, Dragon of Rebirth | rarity guess | Burnished Auric | drop Primordial Wyrm |
| Flower of the Ocean `InfernumMode:FlowerOfTheOcean` | accessory | unknown | no rarity, no evidence | Infernum Ocean Flower |  |
| Sakura Bloom `InfernumMode:SakuraBloom` | accessory | unknown | no rarity, no evidence | Infernum Sakura |  |

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
| Suspended Shotgun Shell Launcher `CalamityAmmo:GrapeLauncher` | weapon (ranged) | unknown | no rarity, no evidence | Orange |  |

### CalamityAddon (1)

| item | slot | guessed stage | why | rarity | code paths seen |
| --- | --- | --- | --- | --- | --- |
| W.D.A.S. `CalamityAddon:WDAS` | accessory | Eye of Cthulhu | rarity guess | Green | drop Wulfrum Jumper |
