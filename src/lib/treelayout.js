/**
 * Geometry for the crafting-tree graph.
 *
 * A crafting tree is already a tree — `craftTree` cuts cycles and picks one recipe per node — so
 * the classic dendrogram is all it needs: one column per depth, one row per leaf, every parent
 * centred between its first and last child. No layout library for twenty lines of arithmetic.
 */

export const DEFAULTS = { nodeW: 236, nodeH: 42, colGap: 36, rowH: 50 };

/**
 * Flatten one craftTree node into the boxes the graph draws: the chosen recipe's ingredients,
 * the best member of each recipe group, and the crafting stations.
 */
export function toDisplay(node, extra = {}) {
  const rec = {
    id: node.id,
    name: node.name,
    kind: node.prog === null || node.prog === undefined ? 'unknown' : 'item',
    stageLabel: node.stageLabel ?? '?',
    prog: node.prog,
    gate: node.gate,
    equip: node.equip,
    ...extra,
    children: [],
  };
  const chosen = node.recipes?.find((r) => r.chosen);
  if (!chosen) return rec;
  for (const c of chosen.ingredients) rec.children.push(toDisplay(c.node, { n: c.n, gating: c.gating }));
  for (const g of chosen.groups) {
    if (g.best) {
      rec.children.push(toDisplay(g.best, {
        gating: g.gating,
        via: g.label,
        alt: g.members.filter((m) => m !== g.best).map((m) => `${m.name} (${m.stageLabel})`),
      }));
    } else {
      rec.children.push({ name: g.label, kind: 'group', stageLabel: '?', gate: 'no member in the dataset', children: [] });
    }
  }
  for (const s of chosen.stations) {
    rec.children.push({
      name: s.name, kind: 'station', stageLabel: s.stageLabel, prog: s.prog, gating: s.gating,
      gate: `crafting station${s.boss ? ` (after ${s.boss})` : ''}`, children: [],
    });
  }
  return rec;
}

/**
 * Place a display tree. Returns absolutely-positionable boxes and the elbow edges between them.
 * @returns {{ nodes: Array, edges: Array<{from, to, gating}>, width: number, height: number }}
 */
export function layout(display, opts = {}) {
  const { nodeW, nodeH, colGap, rowH } = { ...DEFAULTS, ...opts };
  const nodes = [];
  const edges = [];
  let row = 0;
  let maxDepth = 0;

  const place = (d, depth) => {
    maxDepth = Math.max(maxDepth, depth);
    const box = { ...d, depth, x: depth * (nodeW + colGap), w: nodeW, h: nodeH, i: 0 };
    // children first: a parent sits between the rows its subtree ended up on
    const kids = d.children.map((c) => place(c, depth + 1));
    box.y = kids.length ? (kids[0].y + kids[kids.length - 1].y) / 2 : row++ * rowH;
    box.i = nodes.push(box) - 1;
    for (const k of kids) edges.push({ from: box, to: k, gating: !!k.gating });
    return box;
  };
  const root = place(display, 0);

  return {
    nodes,
    edges,
    root,
    width: (maxDepth + 1) * nodeW + maxDepth * colGap,
    height: Math.max(1, row) * rowH,
  };
}

/** Orthogonal connector from a parent's right edge to a child's left edge. */
export function elbow({ from, to }) {
  const x1 = from.x + from.w;
  const y1 = from.y + from.h / 2;
  const x2 = to.x;
  const y2 = to.y + to.h / 2;
  const mid = Math.round((x1 + x2) / 2);
  return `M${x1} ${y1}H${mid}V${y2}H${x2}`;
}
