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
  });

  test('class aliases apply for the mods present', () => {
    expect(r.classAliases).toEqual({ thrower: 'rogue' });
  });
});
