import { expect, test } from 'bun:test';
import { DEFAULTS, elbow, layout, toDisplay } from '../src/lib/treelayout.js';

const { nodeW, nodeH, colGap, rowGap, lineH } = DEFAULTS;
const rowH = nodeH + rowGap;

test('layout: one column per depth, one row per leaf, parents centred', () => {
  //        root
  //        /  \
  //       a    b        (a has two leaves, b is a leaf)
  //      / \
  //    a1   a2
  const tree = {
    name: 'root',
    children: [
      { name: 'a', children: [{ name: 'a1', children: [] }, { name: 'a2', children: [] }] },
      { name: 'b', children: [] },
    ],
  };
  const g = layout(tree);
  const at = (name) => g.nodes.find((n) => n.name === name);

  expect(g.nodes).toHaveLength(5);
  expect(g.edges).toHaveLength(4);
  // depth decides x
  expect(at('root').x).toBe(0);
  expect(at('a').x).toBe(nodeW + colGap);
  expect(at('a1').x).toBe(2 * (nodeW + colGap));
  // leaves get their own row, in reading order
  expect([at('a1').y, at('a2').y, at('b').y]).toEqual([0, rowH, 2 * rowH]);
  // parents sit between their first and last child
  expect(at('a').y).toBe(rowH / 2);
  expect(at('root').y).toBe((at('a').y + at('b').y) / 2);
  expect(g.width).toBe(3 * nodeW + 2 * colGap);
  expect(g.height).toBe(3 * rowH - rowGap); // no dead gap under the last row
});

test('toDisplay: only the chosen recipe, with groups and stations as children', () => {
  const station = { ref: 'Tiles/Anvil', name: 'Anvil', stageLabel: 'Pre-boss', prog: 0, gating: false };
  const groupBest = { id: 'v:Wood', name: 'Wood', stageLabel: 'Pre-boss', prog: 0, equip: false, recipes: [] };
  const groupOther = { id: 'v:Ebonwood', name: 'Ebonwood', stageLabel: 'Pre-boss', prog: 0, recipes: [] };
  const tree = {
    id: 'v:Sword', name: 'Sword', stageLabel: 'Post Skeletron', prog: 3, equip: true, gate: 'crafted',
    recipes: [
      { chosen: false, ingredients: [{ node: { id: 'v:Gold', name: 'Gold Bar', stageLabel: 'Pre-boss', prog: 0, recipes: [] }, n: 8 }], groups: [], stations: [] },
      {
        chosen: true,
        ingredients: [{ node: { id: 'v:Hellstone', name: 'Hellstone Bar', stageLabel: 'Post Skeletron', prog: 3, recipes: [] }, n: 20, gating: true }],
        groups: [{ name: 'Wood', label: 'any Wood', best: groupBest, members: [groupBest, groupOther], gating: false }],
        stations: [station],
      },
    ],
  };
  const d = toDisplay(tree);
  expect(d.children.map((c) => c.name)).toEqual(['Hellstone Bar', 'Wood', 'Anvil']);
  expect(d.children[0].gating).toBe(true);
  expect(d.children[0].n).toBe(20);
  expect(d.children[1].via).toBe('any Wood');
  expect(d.children[1].alt).toEqual(['Ebonwood (Pre-boss)']);
  expect(d.children[2].kind).toBe('station');
  // the non-chosen recipe's Gold Bar is not in the graph
  expect(JSON.stringify(d)).not.toContain('Gold Bar');
});

test('layout: only the node that needs a second line grows, and the column closes up after it', () => {
  const tree = { name: 'root', children: [{ name: 'tall', children: [] }, { name: 'short', children: [] }] };
  const g = layout(tree, { heightOf: (n) => (n.name === 'tall' ? nodeH + lineH : 0) });
  const at = (name) => g.nodes.find((n) => n.name === name);
  expect([at('tall').h, at('short').h, at('root').h]).toEqual([nodeH + lineH, nodeH, nodeH]);
  // the short box starts below the tall one, not a fixed row down
  expect(at('short').y).toBe(nodeH + lineH + rowGap);
  // the parent centres on its children's centres, not their top edges
  const mid = (name) => at(name).y + at(name).h / 2;
  expect(mid('root')).toBe((mid('tall') + mid('short')) / 2);
  expect(g.height).toBe(2 * nodeH + lineH + rowGap);
});

test('elbow: parent right edge, midway trunk, child left edge', () => {
  const from = { x: 0, y: 0, w: 100, h: 40 };
  const to = { x: 140, y: 60, w: 100, h: 40 };
  expect(elbow({ from, to })).toBe('M100 20H120V80H140');
});

test('an unresolved ingredient still gets a box', () => {
  const d = toDisplay({ name: 'Mystery', prog: null, recipes: [] });
  expect(d.kind).toBe('unknown');
  expect(layout(d).nodes).toHaveLength(1);
});
