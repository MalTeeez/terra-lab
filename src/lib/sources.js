/**
 * Crafting trees with gate annotations.
 *
 * A node is an item (equipment or material) with its stage and the evidence the miner used
 * (`src`). Its recipes list every ingredient, recipe group and crafting station as child
 * nodes; the children whose stage decides the recipe's stage are marked `gating`, and the
 * recipe the inference picked (the earliest) is `chosen`.
 */
import { nodeOf } from './dataset.js';

/** Human sentence for why a node is obtainable when it is. */
export function gateText(node, ds) {
  const s = node.src ?? {};
  const after = s.boss ? ` (after ${s.boss})` : '';
  switch (s.kind) {
    case 'drop': return s.until ? `dropped by ${s.boss} after ${s.until}` : `dropped by ${s.boss}`;
    case 'fish': return `caught by fishing${s.boss ? ` (after ${s.boss})` : ''}`;
    case 'critter': return `caught as a critter (${s.via})${s.boss ? `, after ${s.boss}` : ''}`;
    case 'worldgen': return s.via && !/^mined/.test(s.via) ? `in a chest placed at world generation (${s.via})${s.estimated ? ` — the code does not say if the chest is locked, so the rarity guess${s.boss ? ` (${s.boss})` : ''} stands` : s.boss ? ` (after ${s.boss})` : ''}` : 'generated in the world, any pickaxe';
    case 'bag': return `${s.via ?? 'treasure bag'} (${s.boss})`;
    case 'enemy': return `dropped by ${s.via}${s.boss ? `, which needs ${s.boss}` : ''}${s.gate && !s.boss ? ` (${s.gate})` : ''}`;
    case 'chest': return `${s.via}${after}`;
    case 'shop': return `sold by ${s.via}${s.boss ? ` (after ${s.boss})` : ''}`;
    case 'manual': return `${s.via ? s.via + ' — ' : ''}after ${s.boss} (your sources.json)`;
    case 'spawn': return `ore spawned by ${s.boss}`;
    case 'ore': {
      const parts = [];
      if (s.until) parts.push(`the world tile needs a ${s.altNeed}% pickaxe until ${s.until}`);
      if (s.need) parts.push(`${s.until ? 'then ' : ''}needs a ${s.need}% pickaxe${s.pickaxe ? `: ${s.pickaxe}` : ''}${s.pickaxe && s.boss && !s.gate && !s.until ? ` (${s.boss})` : ''}`);
      if (s.before) parts.push(`the world tile, before ${s.before} converts it`);
      if (s.gate) parts.push(`minable after ${s.boss}`);
      if (s.anchor && s.boss) parts.push(`in the world after ${s.boss}`);
      return parts.join('; ') || 'mined';
    }

    case 'anchor': return `after ${s.boss} (world progression)`;
    case 'override': return `after ${s.boss} (pinned from the class-setup guides)`;
    case 'craft': return s.from?.length ? `crafted — gated by ${s.from.join(', ')}` : 'crafted';
    case 'rarity': return 'no source found — guessed from rarity';
    default: return node.stage === null ? 'unknown' : '';
  }
}

const groupLabel = (name) => `any ${name.replace(/^(any|Any)/, '').replace(/^[A-Za-z]+:/, '')}`;

/**
 * Build the tree for an item id.
 * @returns {{ id, name, stage, stageLabel, prog, src, equip, gate, drops, recipes: Array<{ chosen, prog, ingredients, groups, stations }>, children: number } | null}
 */
export function craftTree(ds, id, { depth = 5, seen = new Set() } = {}) {
  const node = nodeOf(ds, id);
  if (!node) return null;
  node.gate = gateText(node, ds);
  node.recipes = [];
  if (depth <= 0 || seen.has(id)) return node;
  const raw = ds.recipes[id] ?? [];
  const nextSeen = new Set(seen).add(id);
  raw.forEach(([ings, groups, tiles], index) => {
    const rec = { index, ingredients: [], groups: [], stations: [], prog: 0, chosen: false };
    const bump = (p) => { if (p !== null && p !== undefined && p > rec.prog) rec.prog = p; };
    for (const [iid, n] of ings) {
      // an ingredient the miner could not resolve to an item is null: the recipe needs *something*
      // there, so show it as unknown rather than pretending the recipe is one ingredient shorter
      const child = (iid ? craftTree(ds, iid, { depth: depth - 1, seen: nextSeen }) : null)
        ?? { id: iid, name: iid ? iid.split(':').pop() : 'unknown ingredient', stage: null, prog: null, src: { kind: 'unknown' }, recipes: [], gate: iid ? 'not in the dataset' : 'the miner could not read this ingredient' };
      rec.ingredients.push({ node: child, n });
      bump(child.prog);
    }
    for (const g of groups) {
      const members = (ds.groups[g] ?? []).map((m) => craftTree(ds, m, { depth: depth - 1, seen: nextSeen })).filter(Boolean);
      let best = null;
      for (const m of members) if (m.prog !== null && (best === null || m.prog < best.prog)) best = m;
      rec.groups.push({ name: g, label: groupLabel(g), members, best });
      if (best) bump(best.prog);
    }
    for (const t of tiles) {
      const st = ds.stations[t];
      const stage = st?.stage ?? 0;
      const prog = ds.stages[stage]?.progression ?? 0;
      rec.stations.push({ ref: t, name: st?.name ?? t.split(':').pop(), stage, stageLabel: ds.stages[stage]?.label ?? '?', prog, boss: st?.boss });
      bump(prog);
    }
    node.recipes.push(rec);
  });
  // gating children: those at the recipe's progression
  for (const rec of node.recipes) {
    for (const c of rec.ingredients) c.gating = c.node.prog !== null && c.node.prog >= rec.prog && rec.prog > 0;
    for (const g of rec.groups) g.gating = !!g.best && g.best.prog >= rec.prog && rec.prog > 0;
    for (const s of rec.stations) s.gating = s.prog >= rec.prog && rec.prog > 0;
  }
  const chosen = node.src?.kind === 'craft' && node.recipes[node.src.recipe] ? node.recipes[node.src.recipe] : node.recipes.slice().sort((a, b) => a.prog - b.prog)[0];
  if (chosen) chosen.chosen = true;
  node.recipes.sort((a, b) => (b.chosen ? 1 : 0) - (a.chosen ? 1 : 0) || a.prog - b.prog);
  return node;
}

/** Everything that gates an item: the chain of gating nodes down the chosen recipes, deduplicated. */
export function gatingChain(tree) {
  const out = [];
  const walk = (node, viaGroup) => {
    if (!node) return;
    const rec = node.recipes.find((r) => r.chosen);
    if (!rec || rec.prog === 0) { if (node.prog > 0) out.push({ node, viaGroup }); return; }
    for (const c of rec.ingredients) if (c.gating) walk(c.node);
    for (const g of rec.groups) if (g.gating) walk(g.best, g.label);
    for (const s of rec.stations) if (s.gating) out.push({ station: s });
  };
  walk(tree);
  const seen = new Set();
  return out.filter((e) => { const k = e.node?.id ?? e.station?.ref; if (seen.has(k)) return false; seen.add(k); return true; });
}
