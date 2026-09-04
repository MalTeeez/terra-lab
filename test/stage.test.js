import { describe, expect, test } from 'bun:test';
import { inferStages } from '../miner/stage/infer.js';

const config = {
  vanillaBosses: [
    { key: 'EyeOfCthulhu', label: 'Eye of Cthulhu', progression: 2, npcs: [4] },
    { key: 'WallOfFlesh', label: 'Wall of Flesh', progression: 7, npcs: [113] },
    { key: 'Plantera', label: 'Plantera', progression: 12, npcs: [262] },
  ],
  anchors: { 'v:CobaltOre': 'WallOfFlesh' },
  stations: { MythrilAnvil: 'WallOfFlesh' },
  rarity: { vanilla: { 0: 'start', 1: 'start', 2: 'EyeOfCthulhu', 6: 'Plantera' }, classes: { Turquoise: 'Providence' } },
  overrides: { 'M:Forced': 'Plantera' },
  classAliases: { M: { thrower: 'rogue' } },
};

const items = [
  { id: 'v:1', name: 'Cobalt Ore', rarity: 1 },
  { id: 'v:2', name: 'Cobalt Bar', rarity: 1 },
  { id: 'v:3', name: 'Cobalt Sword', rarity: 4 },
  { id: 'v:10', name: 'EoC Bag', rarity: 1 },
  { id: 'v:11', name: 'Bag Loot', rarity: 0 },
  { id: 'M:Drop', name: 'Boss drop', rarity: 0 },
  { id: 'M:Crafted', name: 'Crafted from drop', rarity: 0 },
  { id: 'M:Lonely', name: 'No evidence', rarity: 6 },
  { id: 'M:Forced', name: 'Overridden', rarity: 0 },
  { id: 'M:Ore', name: 'Mod ore', rarity: 0, createTile: 'M:OreTile' },
  { id: 'M:NoRarity', name: 'Nothing known' },
  { id: 'M:Mystery', name: 'Mystery material' },
  { id: 'M:MadeOfMystery', name: 'Weapon from a mystery', rarity: 0, slot: 'weapon' },
  { id: 'M:Minion', name: 'Minion drop', rarity: 0 },
  { id: 'v:86', name: 'Shadow Scale', rarity: 6 },
  { id: 'M:Loomed', name: 'Made at a loom', rarity: 0 },
];
const recipes = [
  { result: 'v:2', ingredients: [{ item: 'v:1', n: 3 }], groups: [], tiles: [] },
  { result: 'v:3', ingredients: [{ item: 'v:2', n: 10 }], groups: [], tiles: ['v:tile:134'] },
  { result: 'M:Crafted', ingredients: [{ item: 'M:Drop', n: 1 }, { item: 'v:2', n: 1 }], groups: [], tiles: [] },
  { result: 'M:Forced', ingredients: [{ item: 'v:1', n: 1 }], groups: [], tiles: [] },
  { result: 'M:Loomed', ingredients: [{ item: 'v:11', n: 1 }], groups: [], tiles: ['v:tile:86'] },
  { result: 'M:MadeOfMystery', ingredients: [{ item: 'M:Mystery', n: 1 }], groups: [], tiles: [] },
];
const drops = [
  { source: 'npc:v:4', item: 'v:10' },
  { source: 'bag:v:10', item: 'v:11' },
  { source: 'npc:M:Boss', item: 'M:Drop' },
  { source: 'npc:M:Boss', item: 'tile:M:OreTile' },
  { source: 'npc:M:Helper', item: 'M:Minion' },
];
const bossLogs = [{ kind: 'boss', key: 'Boss', progression: 12.5, npcs: ['M:Boss'], mod: 'M' }];
const npcs = [
  { id: 'M:Boss', mod: 'M', className: 'Boss', name: 'The Boss', boss: true, spawns: ['M:Helper'] },
  { id: 'M:Helper', mod: 'M', className: 'Helper', name: 'Helper', boss: false },
];
const itemIds = new Map([['CobaltOre', 1]]);
const tileIds = new Map([['MythrilAnvil', 134]]);

describe('inferStages', () => {
  const r = inferStages({ items, recipes, drops, bossLogs, npcs, config, itemIds, tileIds, mods: ['M'] });
  const stage = (id) => r.byItem.get(id);
  const label = (id) => r.stages[stage(id).stage].label;

  test('orders stages by progression with a pre-boss start', () => {
    expect(r.stages.map((s) => s.label)).toEqual(['Pre-boss', 'Eye of Cthulhu', 'Wall of Flesh', 'Plantera', 'The Boss']);
  });

  test('anchors propagate through recipes and crafting stations', () => {
    expect(stage('v:1').source.kind).toBe('anchor');
    expect(label('v:2')).toBe('Wall of Flesh');
    expect(stage('v:2').source.kind).toBe('craft');
    expect(label('v:3')).toBe('Wall of Flesh');
  });

  test('vanilla station tile ids never resolve as items', () => {
    expect(label('M:Loomed')).toBe('Eye of Cthulhu'); // tile 86 is the Loom, not item 86 (Shadow Scale)
  });

  test('boss drops and treasure bags', () => {
    expect(label('v:10')).toBe('Eye of Cthulhu');
    expect(stage('v:11').source).toMatchObject({ kind: 'bag', boss: 'Eye of Cthulhu' });
    expect(label('M:Drop')).toBe('The Boss');
    expect(label('M:Crafted')).toBe('The Boss');
  });

  test('tile spawns and boss minions', () => {
    expect(stage('M:Ore').source.kind).toBe('spawn');
    expect(label('M:Ore')).toBe('The Boss');
    expect(label('M:Minion')).toBe('The Boss');
  });

  test('rarity fallback, overrides, and unknowns', () => {
    expect(stage('M:Lonely').source.kind).toBe('rarity');
    expect(label('M:Lonely')).toBe('Plantera');
    expect(stage('M:Forced').source.kind).toBe('override');
    expect(label('M:Forced')).toBe('Plantera');
    expect(stage('M:NoRarity')).toBeUndefined();
    // equipment whose recipe never resolved is *not* an item with no evidence: guessing from its
    // rarity would say pre-boss for a weapon gated by something nobody could read
    expect(stage('M:MadeOfMystery')).toBeUndefined();
  });

  test('class aliases apply for the mods present', () => {
    expect(r.classAliases).toEqual({ thrower: 'rogue' });
  });
});

describe('inferStages: sources beyond boss drops', () => {
  const config2 = {
    ...config,
    vanillaBosses: [
      { key: 'EyeOfCthulhu', label: 'Eye of Cthulhu', progression: 2, npcs: [4] },
      { key: 'EaterOfWorlds', label: 'Eater of Worlds', progression: 3, npcs: [13, 266] },
      { key: 'Skeletron', label: 'Skeletron', progression: 5, npcs: [35] },
      { key: 'WallOfFlesh', label: 'Wall of Flesh', progression: 7, npcs: [113] },
    ],
    anchors: {},
    overrides: {},
    pickaxe: { vanillaTiles: { Demonite: 55 }, vanillaOres: ['Copper'], worldgenAs: { 'M:LateOre': { tile: 'M:LateWorldTile', until: 'Skeletron' } } },
    downedFlags: { downedBoss2: 'EaterOfWorlds', hardMode: 'WallOfFlesh' },
    zones: { ZoneDungeon: 'Skeletron' },
    chests: { 'Shadow Chest': { after: 'Skeletron', items: ['v:DarkLance'] } },
  };
  const items2 = [
    { id: 'v:1', name: 'Copper Ore', rarity: 0, createTile: 'v:tile:7' },
    { id: 'v:2', name: 'Copper Pickaxe', rarity: 0, pick: 35 },
    { id: 'v:3', name: 'Demonite Ore', rarity: 1, createTile: 'v:tile:22' },
    { id: 'v:4', name: 'Nightmare Pickaxe', rarity: 1, pick: 65 },
    { id: 'v:5', name: 'Gold Pickaxe', rarity: 0, pick: 55 },
    { id: 'v:6', name: 'Shadow Scale', rarity: 1 },
    { id: 'v:7', name: 'Tissue Sample', rarity: 1 },
    { id: 'v:8', name: 'Dark Lance', rarity: 2 },
    { id: 'M:Gel', name: 'Blighted Gel', rarity: 0 },
    { id: 'M:Sludge', name: 'Sludge Splotch', rarity: 2 },
    { id: 'M:Aer', name: 'Aerialite Ore', rarity: 2, createTile: 'M:AerTile' },
    { id: 'M:AerBar', name: 'Aerialite Bar', rarity: 2 },
    { id: 'M:LateOre', name: 'Relaxed Ore', rarity: 2, createTile: 'M:LateTile' },
    { id: 'M:Loot', name: 'Enemy loot' },
    { id: 'M:CondLoot', name: 'Conditional loot' },
    { id: 'M:Pure', name: 'Worldgen ore', rarity: 3, createTile: 'M:PureTile' },
    { id: 'M:Anvil', name: 'Mod Anvil', rarity: 0, createTile: 'M:AnvilTile' },
    { id: 'M:AnvilMade', name: 'Made at the mod anvil', rarity: 0 },
  ];
  const recipes2 = [
    { result: 'v:4', ingredients: [{ item: 'v:3', n: 12 }, { item: 'v:6', n: 6 }], groups: [], tiles: [] },
    { result: 'v:5', ingredients: [{ item: 'v:1', n: 12 }], groups: [], tiles: [] },
    { result: 'v:2', ingredients: [{ item: 'v:1', n: 12 }], groups: [], tiles: [] },
    { result: 'M:Sludge', ingredients: [{ item: 'M:Gel', n: 50 }], groups: ['Boss2Material'], tiles: [] },
    { result: 'M:AerBar', ingredients: [{ item: 'M:Aer', n: 4 }], groups: [], tiles: [] },
    { result: 'M:Anvil', ingredients: [{ item: 'M:AerBar', n: 4 }], groups: [], tiles: [] },
    { result: 'M:AnvilMade', ingredients: [{ item: 'v:1', n: 1 }], groups: [], tiles: ['M:AnvilTile'] },
  ];
  const drops2 = [
    { source: 'npc:v:13', item: 'v:6' },
    { source: 'npc:v:266', item: 'v:7' },
    { source: 'npc:M:Ghoul', item: 'M:Loot' },
    { source: 'npc:M:Slime', item: 'M:CondLoot', cond: ['hardMode'] },
  ];
  const npcs2 = [
    { id: 'M:Ghoul', mod: 'M', className: 'Ghoul', name: 'Ghoul', boss: false, gates: ['ZoneDungeon'] },
    { id: 'M:Slime', mod: 'M', className: 'Slime', name: 'Slime', boss: false, gates: ['ZoneOverworldHeight'] },
  ];
  const groups2 = [{ name: 'Boss2Material', items: ['v:6', 'v:7'] }];
  const tiles2 = [{ id: 'M:AerTile', minPick: 65, ore: true }, { id: 'M:LateTile', minPick: 65 }, { id: 'M:LateWorldTile', minPick: 110 }, { id: 'M:PureTile', ore: true }];
  const itemIds2 = new Map([['DarkLance', 8]]);
  const tileIds2 = new Map([['Copper', 7], ['Demonite', 22]]);
  const r = inferStages({ items: items2, recipes: recipes2, drops: drops2, bossLogs: [], npcs: npcs2, groups: groups2, tiles: tiles2, config: config2, itemIds: itemIds2, tileIds: tileIds2, mods: ['M'], vanillaZones: new Set(['ZoneOverworldHeight']) });
  const stage = (id) => r.byItem.get(id);
  const label = (id) => r.stages[stage(id).stage].label;

  test('recipe groups gate on their earliest member', () => {
    expect(label('M:Sludge')).toBe('Eater of Worlds');
    expect(stage('M:Sludge').source).toMatchObject({ kind: 'craft', from: ['any Boss2Material (Shadow Scale)'] });
  });

  test('ores wait for a pickaxe that can mine them', () => {
    expect(label('v:1')).toBe('Pre-boss');
    expect(stage('v:1').source.kind).toBe('worldgen');
    expect(label('v:3')).toBe('Pre-boss'); // Demonite needs 55: the Gold Pickaxe
    expect(stage('v:3').source).toMatchObject({ kind: 'ore', need: 55, pickaxe: 'Gold Pickaxe' });
    expect(label('M:Aer')).toBe('Eater of Worlds'); // 65: Nightmare Pickaxe, crafted from EoW drops
    expect(stage('M:Aer').source).toMatchObject({ kind: 'ore', need: 65, pickaxe: 'Nightmare Pickaxe', boss: 'Eater of Worlds' });
    expect(label('M:AerBar')).toBe('Eater of Worlds');
    expect(stage('M:Pure').source.kind).toBe('worldgen'); // Sets.Ore without a requirement beats the rarity guess
    expect(label('M:Pure')).toBe('Pre-boss');
  });

  test('an ore whose world tile is converted by a boss waits for that boss', () => {
    expect(label('M:LateOre')).toBe('Skeletron'); // the 110 world tile has no pickaxe; after Skeletron the 65 tile (Nightmare) applies
    expect(stage('M:LateOre').source).toMatchObject({ kind: 'ore', need: 65, until: 'Skeletron', boss: 'Skeletron' });
  });

  test('mod crafting stations gate on the item that places them', () => {
    expect(label('M:AnvilMade')).toBe('Eater of Worlds');
    expect(stage('M:AnvilMade').source.from).toEqual(['Mod Anvil']);
    expect(r.stations.get('M:AnvilTile')).toMatchObject({ name: 'Mod Anvil', stage: stage('M:Anvil').stage });
  });

  test('enemy drops follow spawn gates and loot conditions', () => {
    expect(stage('M:Loot').source).toMatchObject({ kind: 'enemy', via: 'Ghoul', boss: 'Skeletron', gate: 'ZoneDungeon' });
    expect(stage('M:CondLoot').source).toMatchObject({ kind: 'enemy', via: 'Slime', boss: 'Wall of Flesh', gate: 'hardMode' });
  });

  test('keyed chests', () => {
    expect(stage('v:8').source).toMatchObject({ kind: 'chest', via: 'Shadow Chest', boss: 'Skeletron' });
    expect(label('v:8')).toBe('Skeletron');
  });
});

describe('inferStages: shops and manual sources', () => {
  const config3 = {
    ...config,
    vanillaBosses: [
      { key: 'EyeOfCthulhu', label: 'Eye of Cthulhu', progression: 2, npcs: [4] },
      { key: 'Skeletron', label: 'Skeletron', progression: 5, npcs: [35] },
      { key: 'WallOfFlesh', label: 'Wall of Flesh', progression: 7, npcs: [113] },
    ],
    anchors: {}, overrides: {},
    downedFlags: { downedBoss1: 'EyeOfCthulhu', Hardmode: 'WallOfFlesh', DownedSkeletron: 'Skeletron' },
    townNpcs: { Merchant: 'start', Wizard: 'WallOfFlesh' },
    manual: { 'M:Researched': { after: 'Skeletron', via: 'fished in the dungeon' } },
  };
  const items3 = [
    { id: 'M:Fabricator', name: 'Fabricator', rarity: 0 },
    { id: 'M:Sold', name: 'Sold by a vanilla NPC', rarity: 0 },
    { id: 'M:Wiz', name: 'Wizard wares', rarity: 0 },
    { id: 'M:Late', name: 'Sold after Skeletron', rarity: 0 },
    { id: 'M:Researched', name: 'Researched', rarity: 0 },
    { id: 'M:Made', name: 'Made at the fabricator', rarity: 0, createTile: undefined },
    { id: 'M:Station', name: 'Fabricator station', rarity: 0, createTile: 'M:FabTile' },
  ];
  const recipes3 = [{ result: 'M:Made', ingredients: [{ item: 'M:Sold', n: 1 }], groups: [], tiles: ['M:FabTile'] }];
  const npcs3 = [{ id: 'M:Smith', mod: 'M', className: 'Smith', name: 'Blacksmith', boss: false, town: true, townGates: ['any:downedBoss1'] }];
  const shops3 = [
    { npc: 'M:Smith', item: 'M:Station' },
    { npc: 'M:Smith', item: 'M:Late', cond: ['DownedSkeletron'] },
    { npc: 'v:17', item: 'M:Sold' },
    { npc: 'v:108', item: 'M:Wiz' },
  ];
  const npcIds3 = new Map([['Merchant', 17], ['Wizard', 108]]);
  const r = inferStages({ items: items3, recipes: recipes3, drops: [], bossLogs: [], npcs: npcs3, shops: shops3, config: config3, itemIds: new Map(), tileIds: new Map(), npcIds: npcIds3, mods: ['M'] });
  const stage = (id) => r.byItem.get(id);
  const label = (id) => r.stages[stage(id).stage].label;

  test('shop items wait for the seller to move in, then for their own condition', () => {
    expect(stage('M:Station').source).toMatchObject({ kind: 'shop', via: 'Blacksmith', boss: 'Eye of Cthulhu' });
    expect(label('M:Late')).toBe('Skeletron');
    expect(stage('M:Sold').source).toMatchObject({ kind: 'shop', via: 'Merchant' });
    expect(label('M:Sold')).toBe('Pre-boss');
    expect(label('M:Wiz')).toBe('Wall of Flesh');
  });

  test('a bought crafting station gates what is made at it', () => {
    expect(label('M:Made')).toBe('Eye of Cthulhu');
    expect(stage('M:Made').source.from).toEqual(['Fabricator station']);
  });

  test('manual sources apply like overrides and keep their note', () => {
    expect(stage('M:Researched').source).toMatchObject({ kind: 'manual', boss: 'Skeletron', via: 'fished in the dungeon' });
  });
});

describe('inferStages: spawns, fishing, world generation and unresolved gates', () => {
  const config4 = {
    ...config,
    vanillaBosses: [
      { key: 'EyeOfCthulhu', label: 'Eye of Cthulhu', progression: 2, npcs: [4] },
      { key: 'Skeletron', label: 'Skeletron', progression: 5, npcs: [35] },
      { key: 'WallOfFlesh', label: 'Wall of Flesh', progression: 7, npcs: [113] },
      { key: 'Plantera', label: 'Plantera', progression: 12, npcs: [262] },
    ],
    anchors: {}, overrides: {}, chests: {},
    downedFlags: { hardMode: 'WallOfFlesh', downedPlantBoss: 'Plantera', Hardmode: 'WallOfFlesh', 'dd2:1': 'EyeOfCthulhu', bloodMoon: 'start' },
    zones: { ZoneDungeon: 'Skeletron' },
    rarity: { vanilla: { 0: 'start', 1: 'start', 2: 'EyeOfCthulhu', 3: 'Skeletron', 4: 'WallOfFlesh', 5: 'Plantera', 9: 'Plantera' }, classes: {} },
  };
  const items4 = [
    { id: 'v:10', name: 'Wraith drop', rarity: 4 },
    { id: 'v:11', name: 'Paladin drop', rarity: 4 },
    { id: 'v:12', name: 'Zombie drop', rarity: 3 },
    { id: 'v:13', name: 'Dark Mage drop', rarity: 5 },
    { id: 'v:14', name: 'Hardmode crate', rarity: 3 },
    { id: 'v:15', name: 'Crate loot', rarity: 4 },
    { id: 'v:16', name: 'Sky chest sword', rarity: 2 },
    { id: 'v:17', name: 'Dungeon chest item', rarity: 3 },
    { id: 'M:Husk', name: 'Husk', mod: 'M', rarity: 5 },
    { id: 'M:LockedLoot', name: 'Locked loot', mod: 'M', rarity: 5 },
    { id: 'M:OpenLoot', name: 'Open loot', mod: 'M', rarity: 3 },
    { id: 'M:LateLoot', name: 'Late loot', mod: 'M', rarity: 9 },
    { id: 'M:EventLoot', name: 'Event loot', mod: 'M', rarity: 3 },
    { id: 'M:PoolDrop', name: 'Pool drop', mod: 'M', rarity: 3 },
    { id: 'M:Critter', name: 'Gold Bug', mod: 'M', rarity: 3, makeNPC: 'v:3' },
  ];
  const npcs4 = [
    { id: 'M:Clam', mod: 'M', className: 'Clam', name: 'Giant Clam', boss: true },
    { id: 'M:Ghoul', mod: 'M', className: 'Ghoul', name: 'Ghoul', boss: false, gates: ['ZoneDungeon'] },
    { id: 'M:Slime', mod: 'M', className: 'Slime', name: 'Pool slime', boss: false },
  ];
  const drops4 = [
    { source: 'npc:v:82', item: 'v:10' },
    { source: 'npc:v:290', item: 'v:11' },
    { source: 'npc:v:3', item: 'v:12' },
    { source: 'npc:v:564', item: 'v:13' },
    { source: 'bag:v:14', item: 'v:15' },
    { source: 'npc:M:Clam', item: 'M:Husk', cond: ['Hardmode'] },
    { source: 'npc:*', item: 'M:EventLoot', cond: ['event:MysteryMoon'] },
    { source: 'npc:M:Slime', item: 'M:PoolDrop' },
  ];
  const spawns4 = new Map([
    ['v:82', [['hardMode']]],
    ['v:290', [['ZoneDungeon', 'hardMode', 'downedPlantBoss']]],
    ['v:3', [[], ['hardMode', 'ZoneGraveyard']]],
    ['v:564', [['dd2:1']]],
  ]);
  const pools4 = [{ npc: 'M:Slime', gates: ['any:!hardMode', 'any:downedPlantBoss'] }];
  const fish4 = [{ item: 'v:14', cond: ['hardMode'], via: 'fishing' }];
  const worldgen4 = [
    { item: 'v:16', via: 'AddBuriedChest (style 13)' },
    { item: 'v:17', via: 'WorldGen.MakeDungeon (style 0)', after: 'Skeletron' },
    { item: 'M:LockedLoot', via: 'Gen.FillLockedChest', mod: 'M', estimated: true },
    { item: 'M:OpenLoot', via: 'Gen.FillChest', mod: 'M' },
    { item: 'M:LateLoot', via: 'Gen.FillChest', mod: 'M' },
  ];
  const r = inferStages({ items: items4, recipes: [], drops: drops4, bossLogs: [{ kind: 'miniboss', key: 'GiantClam', progression: 1.6, npcs: ['M:Clam'], mod: 'M' }], npcs: npcs4, spawns: spawns4, pools: pools4, fish: fish4, worldgen: worldgen4, vanillaZones: new Set(['ZoneGraveyard']), config: config4, itemIds: new Map(), tileIds: new Map(), mods: ['M'] });
  const stage = (id) => r.byItem.get(id);
  const label = (id) => r.stages[stage(id).stage].label;

  test('vanilla enemies gate on their SpawnNPC sites: the earliest alternative wins', () => {
    expect(stage('v:10').source).toMatchObject({ kind: 'enemy', via: 'v:82', boss: 'Wall of Flesh', gate: 'hardMode' });
    expect(label('v:11')).toBe('Plantera'); // dungeon + hardmode + Plantera: the latest required flag
    // an ungated site beats the graveyard-only one, so the drop is the source — and `SpawnNPC`
    // saying "no conditions" is evidence, not a gap: the item's own rarity does not float it up
    expect(stage('v:12').source).toMatchObject({ kind: 'enemy', via: 'v:3' });
    expect(stage('v:12').source.gate).toBeUndefined();
    expect(label('v:12')).toBe('Pre-boss'); // rarity 3, but the enemy is there from the start
    expect(stage('v:13').source).toMatchObject({ kind: 'enemy', gate: 'dd2:1' });
    expect(label('v:13')).toBe('Eye of Cthulhu');
  });

  test('spawn pools: an alternative without a requirement means no gate', () => {
    expect(stage('M:PoolDrop').source).toMatchObject({ kind: 'enemy' });
    expect(stage('M:PoolDrop').source.gate).toBeUndefined(); // the pool has an alternative with no requirement
    expect(label('M:PoolDrop')).toBe('Skeletron'); // …but rarity 3 is the floor for an ungated enemy
  });

  test('a boss drop keeps the drop condition', () => {
    expect(stage('M:Husk').source).toMatchObject({ kind: 'drop', boss: 'Giant Clam', gate: 'Hardmode', until: 'Wall of Flesh' });
    expect(label('M:Husk')).toBe('Wall of Flesh');
  });

  test('fishing catches and crates propagate to their contents', () => {
    expect(stage('v:14').source).toMatchObject({ kind: 'fish', gate: 'hardMode' });
    expect(stage('v:15').source).toMatchObject({ kind: 'bag', via: 'Hardmode crate' });
    expect(label('v:15')).toBe('Wall of Flesh');
  });

  test('world-generation chests: open ones from the start, locked ones behind their key, unknown mod chests floored by rarity', () => {
    expect(stage('v:16').source).toMatchObject({ kind: 'worldgen' });
    expect(label('v:16')).toBe('Pre-boss');
    expect(label('v:17')).toBe('Skeletron');
    expect(label('M:OpenLoot')).toBe('Pre-boss');
    expect(stage('M:LockedLoot').source).toMatchObject({ kind: 'worldgen', estimated: true });
    expect(label('M:LockedLoot')).toBe('Plantera');
    expect(stage('M:LateLoot').source.estimated).toBe(true); // rarity 9 in a mod chest: hardmode tier stays a guess
  });

  test('a critter item follows the spawn of the NPC it becomes', () => {
    expect(stage('M:Critter').source).toMatchObject({ kind: 'critter', via: 'v:3' });
    expect(label('M:Critter')).toBe('Pre-boss');
  });

  test('an unresolved gate leaves the evidence unused and is reported', () => {
    expect(stage('M:EventLoot').source.kind).toBe('rarity');
    expect(r.unresolvedFlags).toContainEqual(expect.objectContaining({ flag: 'event:MysteryMoon', count: 1 }));
  });
});
