/**
 * Gamestage inference.
 *
 * Every boss (vanilla from config, mods from their BossChecklist registration) has a
 * progression value on one shared scale. An item's progression is the earliest point
 * it can be obtained, found by propagating to a fixed point:
 *   anchors / overrides       config says "after boss X"
 *   drops                     dropped by a boss, or by a boss's treasure bag
 *   tile spawns               ore tile spawned by a boss kill → the ore item
 *   recipes                   max over ingredients (+ crafting station), min over recipes
 *   rarity                    fallback when nothing else is known
 * Stages shown to the user are the bosses in progression order (plus "Pre-boss").
 */

export const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * @param {object} input
 * @param {object[]} input.items        all items (all mods + vanilla), with id, rarity, rarityClass, createTile
 * @param {object[]} input.recipes      { result, ingredients:[{item,n}], groups, tiles }
 * @param {object[]} input.drops        { source: 'npc:<id>'|'bag:<id>'|'spawn:<npc>', item: '<id>'|'tile:<id>' }
 * @param {object[]} input.bossLogs     { kind, key, progression, npcs:[], mod }
 * @param {object[]} input.npcs         { id, name, boss }
 * @param {object} input.config         progression.json
 * @param {Map<string, number>} input.itemIds   vanilla ItemID name → id
 * @param {Map<string, number>} input.tileIds   vanilla TileID name → id
 * @param {string[]} input.mods         mod ids present (for class aliases)
 */
export function inferStages({ items, recipes, drops, bossLogs, npcs, config, itemIds, tileIds, mods }) {
  // ---- bosses & stages -------------------------------------------------------------
  const npcName = new Map(npcs.map((n) => [n.id, n.name]));
  const bosses = [];
  for (const b of config.vanillaBosses) {
    bosses.push({ key: b.key, label: b.label, progression: b.progression, npcs: b.npcs.map((n) => `v:${n}`), mod: 'v', kind: b.kind ?? 'boss' });
  }
  const npcByModClass = new Map(npcs.map((n) => [`${n.mod}:${norm(n.className)}`, n.id]));
  for (const b of bossLogs) {
    if (!b.npcs.length && b.mod) {
      const guess = npcByModClass.get(`${b.mod}:${norm(b.key)}`);
      if (guess) b.npcs = [guess];
    }
    const npcsU = [...new Set(b.npcs)];
    const label = npcsU.map((n) => npcName.get(n)).find(Boolean) ?? deCamelKey(b.key);
    bosses.push({ key: b.key, label, progression: b.progression, npcs: npcsU, mod: b.mod, kind: b.kind });
  }
  // merge duplicates by npc set (a mod may log the same boss twice)
  const byNpc = new Map();
  const merged = [];
  for (const b of bosses.sort((a, c) => a.progression - c.progression)) {
    const hit = b.npcs.map((n) => byNpc.get(n)).find(Boolean);
    if (hit) { for (const n of b.npcs) byNpc.set(n, hit); continue; }
    merged.push(b);
    for (const n of b.npcs) byNpc.set(n, b);
  }
  const stageBosses = merged.filter((b) => b.kind === 'boss' || b.kind === 'event');
  const stages = [{ key: 'start', label: 'Pre-boss', progression: 0, npcs: [], mod: 'v', kind: 'start' }, ...stageBosses];
  stages.forEach((s, i) => { s.index = i; });

  const bossByKey = new Map();
  for (const b of merged) bossByKey.set(norm(b.key), b);
  for (const b of merged) for (const n of b.npcs) { const nm = npcName.get(n); if (nm) bossByKey.set(norm(nm), bossByKey.get(norm(nm)) ?? b); }
  bossByKey.set('start', stages[0]);
  const progOfKey = (key) => bossByKey.get(norm(key))?.progression ?? null;

  // ---- evidence ------------------------------------------------------------------------
  const byId = new Map(items.map((i) => [i.id, i]));
  const vanillaId = (name) => {
    const n = itemIds.get(name);
    return n !== undefined ? `v:${n}` : null;
  };
  const resolveRef = (ref) => {
    if (!ref) return null;
    if (byId.has(ref)) return ref;
    if (ref.startsWith('v:') && !/^v:\d+$/.test(ref)) return vanillaId(ref.slice(2));
    return ref;
  };

  /** prog[id] = { p, src } — the earliest known progression and why. */
  const prog = new Map();
  const better = (id, p, src) => {
    if (p === null || p === undefined || !Number.isFinite(p)) return false;
    const cur = prog.get(id);
    if (cur && cur.p <= p) return false;
    prog.set(id, { p, src });
    return true;
  };

  // anchors & overrides
  for (const [ref, key] of Object.entries(config.anchors)) {
    if (ref.startsWith('$')) continue;
    const id = resolveRef(ref);
    const p = progOfKey(key);
    if (id && p !== null) better(id, p, { kind: 'anchor', boss: bossByKey.get(norm(key))?.label });
  }

  // boss drops (bags and tile spawns propagate in the loop)
  const npcProg = new Map();
  for (const b of merged) for (const n of b.npcs) npcProg.set(n, b);
  // minions / phases spawned by a boss's own code count as that boss
  for (const n of npcs) {
    const boss = npcProg.get(n.id);
    if (!boss || !n.spawns) continue;
    for (const s of n.spawns) if (!npcProg.has(s)) npcProg.set(s, boss);
  }
  const dropsByBag = new Map();
  const tileSpawns = []; // { boss, tile }
  for (const d of drops) {
    const [kind, ...rest] = d.source.split(':');
    const src = rest.join(':');
    if (kind === 'npc') {
      const boss = npcProg.get(src);
      if (!boss) continue;
      if (d.item.startsWith('tile:')) { tileSpawns.push({ boss, tile: d.item.slice(5) }); continue; }
      // a mod boss dropping a common vanilla material (Jungle Spores from Corpse Bloom) is never
      // its earliest source; the material's vanilla enemies are not in the drop evidence
      if (d.item.startsWith('v:') && (!src.startsWith('v:') || (boss.mod && boss.mod !== 'v')) && (byId.get(d.item)?.rarity ?? 0) <= 1) continue;
      better(d.item, boss.progression, { kind: 'drop', boss: boss.label });
    } else if (kind === 'bag') {
      let list = dropsByBag.get(src);
      if (!list) dropsByBag.set(src, (list = []));
      list.push(d.item);
    }
  }
  // ore tiles spawned on boss kill → items that place that tile
  const byTile = new Map();
  for (const it of items) if (it.createTile) { let l = byTile.get(it.createTile); if (!l) byTile.set(it.createTile, (l = [])); l.push(it.id); }
  for (const { boss, tile } of tileSpawns) for (const id of byTile.get(tile) ?? []) better(id, boss.progression, { kind: 'spawn', boss: boss.label });

  // crafting station gates
  const tileProg = new Map();
  for (const [name, key] of Object.entries(config.stations)) {
    if (name.startsWith('$')) continue;
    const tid = tileIds.get(name);
    const p = progOfKey(key);
    if (tid !== undefined && p !== null) tileProg.set(`v:tile:${tid}`, { p, label: name });
  }
  const stationProg = (tileRef) => {
    if (tileProg.has(tileRef)) return tileProg.get(tileRef).p;
    if (tileRef.startsWith('v:')) return 0; // vanilla tiles never share ids with items
    // mod stations: the item that places it usually shares the class name
    const pr = prog.get(tileRef);
    return pr ? pr.p : 0;
  };

  // recipes, bags: iterate to a fixed point
  const recipesByResult = new Map();
  for (const r of recipes) {
    if (!r.result) continue;
    let l = recipesByResult.get(r.result);
    if (!l) recipesByResult.set(r.result, (l = []));
    l.push(r);
  }
  const rarityProg = (it) => {
    if (it.rarityClass && config.rarity.classes[it.rarityClass]) return progOfKey(config.rarity.classes[it.rarityClass]);
    if (it.rarity !== undefined && it.rarity !== null) {
      const key = config.rarity.vanilla[String(it.rarity)] ?? (it.rarity > 11 ? 'MoonLord' : 'start');
      return progOfKey(key) ?? 0;
    }
    return null;
  };

  // overrides seed the propagation too, so what is crafted from an overridden item follows it
  const applyOverrides = () => {
    for (const [ref, key] of Object.entries(config.overrides)) {
      if (ref.startsWith('$')) continue;
      const id = resolveRef(ref);
      const p = progOfKey(key);
      if (id && p !== null) prog.set(id, { p, src: { kind: 'override', boss: bossByKey.get(norm(key))?.label } });
    }
  };
  applyOverrides();

  for (let iter = 0; iter < 40; iter++) {
    let changed = false;
    for (const [bag, list] of dropsByBag) {
      const bp = prog.get(bag);
      if (!bp) continue;
      const bagName = byId.get(bag)?.name ?? bag;
      for (const id of list) {
        // a mod boss bag holding a common vanilla material is never the material's earliest source
        if (id.startsWith('v:') && !bag.startsWith('v:') && (byId.get(id)?.rarity ?? 0) <= 1) continue;
        if (better(id, bp.p, { kind: 'bag', boss: bp.src.boss ?? bagName, via: bagName })) changed = true;
      }
    }
    for (const [result, list] of recipesByResult) {
      for (const r of list) {
        if (!r.ingredients.length && !r.groups.length) continue;
        let p = 0;
        let ok = true;
        const chain = [];
        for (const ing of r.ingredients) {
          if (!ing.item) { ok = false; break; }
          const ip = prog.get(ing.item);
          if (!ip) {
            // ingredients with no evidence: use their rarity fallback so a recipe still resolves
            const it = byId.get(ing.item);
            const rp = it ? rarityProg(it) : null;
            if (rp === null) { ok = false; break; }
            if (rp > p) { p = rp; chain.length = 0; chain.push(it.name); } else if (rp === p) chain.push(it.name);
            continue;
          }
          if (ip.p > p) { p = ip.p; chain.length = 0; chain.push(byId.get(ing.item)?.name ?? ing.item); } else if (ip.p === p) chain.push(byId.get(ing.item)?.name ?? ing.item);
        }
        if (!ok) continue;
        for (const t of r.tiles) {
          const tp = stationProg(t);
          if (tp > p) { p = tp; chain.length = 0; chain.push(tileProg.get(t)?.label ?? byId.get(t)?.name ?? t); }
        }
        if (better(result, p, { kind: 'craft', from: chain.slice(0, 3) })) changed = true;
      }
    }
    if (!changed) break;
  }

  // overrides win
  applyOverrides();

  // rarity fallback
  for (const it of items) {
    if (prog.has(it.id)) continue;
    const p = rarityProg(it);
    if (p !== null) prog.set(it.id, { p, src: { kind: 'rarity' } });
  }

  // stage index: last stage whose progression <= item progression
  const stageOf = (p) => {
    let idx = 0;
    for (const s of stages) if (s.progression <= p + 1e-6) idx = s.index; else break;
    return idx;
  };
  const byItem = new Map();
  for (const [id, { p, src }] of prog) byItem.set(id, { progression: p, stage: stageOf(p), source: src });

  // class aliases for the mods present
  const classAliases = {};
  for (const [mod, aliases] of Object.entries(config.classAliases)) {
    if (mod.startsWith('$') || !mods.includes(mod)) continue;
    Object.assign(classAliases, aliases);
  }

  return { stages, bosses: merged, byItem, classAliases };
}

function deCamelKey(k) {
  return String(k).replace(/([a-z\d])([A-Z])/g, '$1 $2');
}
