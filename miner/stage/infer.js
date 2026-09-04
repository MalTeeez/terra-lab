/**
 * Gamestage inference.
 *
 * Every boss (vanilla from config, mods from their BossChecklist registration) has a
 * progression value on one shared scale. An item's progression is the earliest point
 * it can be obtained, found by propagating to a fixed point:
 *   anchors / overrides       config says "after boss X"
 *   drops                     dropped by a boss, or by a boss's treasure bag (drop conditions apply)
 *   enemy                     dropped by an enemy whose natural spawn is gated on a downed flag,
 *                             a zone or an event (vanilla SpawnNPC, mod SpawnChance / EditSpawnPool)
 *   fish                      fishing catches and crates (vanilla and ModPlayer.CatchFish)
 *   worldgen                  chest contents placed at world generation
 *   chest                     config: chests that need a boss-dropped key
 *   shop                      sold by a town NPC (its move-in condition + the entry's condition)
 *   tile spawns               ore tile spawned by a boss kill → the ore item
 *   ore                       worldgen ore / tile, gated by the pickaxe power it needs (and tile downed gates)
 *   recipes                   max over ingredients (+ recipe groups + crafting station), min over recipes
 *   rarity                    fallback when nothing else is known
 * Gates are flag lists: `downedX` / `hardMode` / `ZoneX` / `pumpkinMoon` / `invasion:N` resolve
 * through the config and the boss list; `any:X` marks alternatives (the earliest gates);
 * a flag that does not resolve leaves the evidence unusable and is reported.
 * Pickaxes are crafted from ores, so the whole thing runs in rounds: infer, derive the
 * pickaxe gates from the pickaxes' stages, seed the ores, infer again until stable.
 * Stages shown to the user are the bosses in progression order (plus "Pre-boss").
 */

import { seedGroup } from '../extract/flags.js';

export const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const EQUIP_SLOTS = new Set(['weapon', 'head', 'body', 'legs', 'accessory']);
/** Sources a craft at the same stage explains a material better than (see `better`). */
const DROP_KINDS = new Set(['drop', 'enemy', 'bag']);

/**
 * @param {object} input
 * @param {object[]} input.items        all items (all mods + vanilla), with id, rarity, rarityClass, createTile, pick
 * @param {object[]} input.recipes      { result, ingredients:[{item,n}], groups, tiles }
 * @param {object[]} input.drops        { source: 'npc:<id>'|'npc:*'|'bag:<id>', item: '<id>'|'tile:<id>', cond?: [flags] }
 * @param {object[]} input.bossLogs     { kind, key, progression, npcs:[], mod }
 * @param {object[]} input.npcs         { id, name, boss, gates?, natural?, town?, townGates? }
 * @param {object[]} [input.groups]     recipe groups { name, items }
 * @param {object[]} [input.tiles]      mod tiles { id, minPick, ore, gates }
 * @param {object[]} [input.shops]      { npc, item, cond? }
 * @param {Map} [input.spawns]          vanilla npc id → alternative gate lists (NPC.SpawnNPC)
 * @param {object[]} [input.pools]      { npc, gates } from GlobalNPC.EditSpawnPool
 * @param {object[]} [input.fish]       { item, cond?, via } fishing catches
 * @param {object[]} [input.worldgen]   { item, via, cond?, after?, estimated? } chest contents at world generation
 * @param {Set<string>} [input.worldgenTiles]  tiles a mod's world generation places
 * @param {Set<string>} [input.vanillaZones]   Terraria.Player Zone* names (a zone not in config is reachable from the start)
 * @param {object} input.config         progression.json
 * @param {Map<string, number>} input.itemIds   vanilla ItemID name → id
 * @param {Map<string, number>} input.tileIds   vanilla TileID name → id
 * @param {string[]} input.mods         mod ids present (for class aliases)
 * @param {Set<string>} [input.seeds]   special world seeds that are on (SEED_GROUPS keys); their
 *                                      `seed:` gates then cost nothing instead of killing the evidence
 */
export function inferStages({ items, recipes, drops, bossLogs, npcs, groups = [], tiles = [], shops = [], spawns = new Map(), pools = [], fish = [], worldgen = [], worldgenTiles = new Set(), vanillaZones = new Set(), config, itemIds, tileIds, npcIds = new Map(), mods, seeds = new Set() }) {
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
  // minibosses are stages too: they gate real loot (Calamity's Giant Clam lets the Sea King move in),
  // and without one the item lands on whatever stage happens to sit below it on the scale
  const stageBosses = merged.filter((b) => b.kind === 'boss' || b.kind === 'event' || b.kind === 'miniboss');
  const stages = [{ key: 'start', label: 'Pre-boss', progression: 0, npcs: [], mod: 'v', kind: 'start' }, ...stageBosses];
  stages.forEach((s, i) => { s.index = i; });

  const bossByKey = new Map();
  for (const b of merged) bossByKey.set(norm(b.key), b);
  for (const b of merged) for (const n of b.npcs) { const nm = npcName.get(n); if (nm) bossByKey.set(norm(nm), bossByKey.get(norm(nm)) ?? b); }
  bossByKey.set('start', stages[0]);
  const progOfKey = (key) => bossByKey.get(norm(key))?.progression ?? null;
  const labelOfKey = (key) => bossByKey.get(norm(key))?.label;
  /** label of the stage an item at progression p belongs to */
  const stageOf = (p) => {
    let idx = 0;
    for (const s of stages) if (s.progression <= p + 1e-6) idx = s.index; else break;
    return idx;
  };
  const labelOfProg = (p) => stages[stageOf(p)].label;

  // ---- progression flags (downed*, hardMode, Zone*, events) → progression ----------------
  const flagCache = new Map();
  // config flags by their core name: `downedMechBossAny` answers for `DownedMechBossAny` too
  const cfgByCore = new Map();
  for (const [k, v] of Object.entries(config.downedFlags ?? {})) if (!k.startsWith('$')) cfgByCore.set(norm(k.replace(/^(downed|Post|Downed|Is)/, '').replace(/(DropCondition|Condition)$/, '')), v);
  /** { p, label } for a flag, null when it does not resolve. `!x` / `any:*` / `any:!x` never gate. */
  const flagProg = (flag) => {
    if (flagCache.has(flag)) return flagCache.get(flag);
    let out = null;
    if (flag.startsWith('seed:')) { // only a seed that is switched on lets its evidence through
      const g = seedGroup(flag);
      out = g && seeds.has(g.key) ? { p: 0, label: null } : null;
      flagCache.set(flag, out);
      return out;
    }
    const core = (f) => norm(f.replace(/^(downed|Post|Downed|Is)/, '').replace(/(DropCondition|Condition)$/, ''));
    const cfg = config.downedFlags?.[flag] ?? config.zones?.[flag] ?? cfgByCore.get(core(flag));
    if (cfg) out = { p: progOfKey(cfg), label: labelOfKey(cfg) };
    else if (/^Zone[A-Z]/.test(flag) && vanillaZones.has(flag)) out = { p: 0, label: null }; // a vanilla biome not in the config: reachable from the start
    else if (/^[A-Z]\w*Biome$/.test(flag)) out = { p: 0, label: null }; // likewise a mod biome the config does not gate
    else if (/^(downed|Post|Downed|Is)/.test(flag)) {
      const name = core(flag);
      let b = bossByKey.get(name) ?? bossByKey.get(name.replace(/^the/, ''));
      if (!b && name.length >= 4) {
        // `downedPerforator` vs key `Perforators`, `downedCLAM` vs `GiantClam`; `downedDoG` is config
        const cands = merged.filter((x) => { const k = norm(x.key); const l = norm(x.label).replace(/^the/, ''); return k.startsWith(name) || name.startsWith(k) || l.startsWith(name) || (name.length >= 4 && (k.includes(name) || l.includes(name))); });
        if (cands.length) b = cands.sort((a, c) => a.progression - c.progression)[0];
      }
      if (b) out = { p: b.progression, label: b.label };
    }
    if (out && out.p === null) out = null;
    flagCache.set(flag, out);
    return out;
  };
  const seedsSeen = new Set(); // seed groups whose gates actually blocked evidence in this run
  const unresolved = new Map(); // flag → { count, examples: Set }
  const noteUnresolved = (flags, example) => {
    for (const f of flags) {
      let u = unresolved.get(f);
      if (!u) unresolved.set(f, (u = { count: 0, examples: new Set() }));
      u.count++;
      if (example && u.examples.size < 8) u.examples.add(example);
    }
  };
  /**
   * Required flags AND together (the latest), `any:` alternatives OR (the earliest).
   * @returns {{ p, label, flag, unresolved: string[] } | null}  null when there are no flags at all;
   * `unresolved` lists what did not resolve — evidence with an unresolved requirement is unusable
   */
  const gateProg = (flags) => {
    if (!flags?.length) return null;
    let best = null;
    let anyBest = null;
    let anyCount = 0;
    const bad = [];
    for (const f of flags) {
      if (f.startsWith('!')) continue; // the flag is false there: no requirement
      const alt = f.startsWith('any:');
      const name = alt ? f.slice(4) : f;
      if (alt && (name === '*' || name.startsWith('!'))) { anyCount++; if (!anyBest || anyBest.p > 0) anyBest = { p: 0, label: null, flag: null }; continue; }
      const g = flagProg(name);
      if (!g) { if (alt) anyCount++; bad.push(name); continue; }
      if (alt) { anyCount++; if (!anyBest || g.p < anyBest.p) anyBest = { ...g, flag: name }; }
      else if (!best || g.p > best.p) best = { ...g, flag: name };
    }
    // alternatives: one resolved alternative is enough; a required flag must resolve
    const requiredBad = flags.filter((f) => !f.startsWith('any:') && !f.startsWith('!') && bad.includes(f));
    const altBad = anyCount > 0 && !anyBest ? bad.filter((f) => !requiredBad.includes(f)) : [];
    if (anyBest && (!best || anyBest.p > best.p)) best = anyBest;
    return { ...(best ?? { p: 0, label: null, flag: null }), unresolved: [...requiredBad, ...altBad] };
  };
  /** gateProg for evidence: null when unusable (an unresolved requirement), else the gate; reports the flags. */
  const usableGate = (flags, example) => {
    const g = gateProg(flags);
    if (!g) return { p: 0, label: null, flag: null };
    // a special-seed gate is unusable rather than unknown: it is offered as a toggle instead
    if (g.unresolved.length) { for (const f of g.unresolved) { const s = seedGroup(f); if (s) seedsSeen.add(s.key); } noteUnresolved(g.unresolved.filter((f) => !f.startsWith('seed:')), example); return null; }
    return g;
  };

  // ---- evidence ------------------------------------------------------------------------
  const byId = new Map(items.map((i) => [i.id, i]));
  const nameOf = (id) => byId.get(id)?.name ?? id;
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
  const rarityProg = (it) => {
    if (it.rarityClass && config.rarity.classes[it.rarityClass]) return progOfKey(config.rarity.classes[it.rarityClass]);
    if (it.rarity !== undefined && it.rarity !== null) {
      const key = config.rarity.vanilla[String(it.rarity)] ?? (it.rarity > 11 ? 'MoonLord' : 'start');
      return progOfKey(key) ?? 0;
    }
    return null;
  };

  // boss npcs (minions / phases spawned by a boss's own code count as that boss)
  const npcProg = new Map();
  for (const b of merged) for (const n of b.npcs) npcProg.set(n, b);
  for (const n of npcs) {
    const boss = npcProg.get(n.id);
    if (!boss || !n.spawns) continue;
    for (const s of n.spawns) if (!npcProg.has(s)) npcProg.set(s, boss);
  }
  const npcById = new Map(npcs.map((n) => [n.id, n]));
  const vanillaNpcName = new Map();
  for (const [name, id] of npcIds) if (typeof id === 'number' && !vanillaNpcName.has(`v:${id}`)) vanillaNpcName.set(`v:${id}`, name);
  // town NPCs: what must be down before they move in (mod: CanTownNPCSpawn; vanilla: config)
  const townProg = new Map();
  const townGate = (npcId) => {
    if (townProg.has(npcId)) return townProg.get(npcId);
    let g;
    if (npcId.startsWith('v:')) {
      const key = config.townNpcs?.[vanillaNpcName.get(npcId)];
      g = key ? { p: progOfKey(key), label: labelOfKey(key), flag: null } : undefined; // unknown vanilla seller: no evidence
      if (g && g.p === null) g = undefined;
    } else {
      const n = npcById.get(npcId);
      g = n?.town ? usableGate(n.townGates, npcName.get(npcId)) ?? undefined : undefined;
    }
    townProg.set(npcId, g);
    return g;
  };
  // enemy gates: the earliest of every way an enemy spawns naturally — a mod NPC's SpawnChance
  // flags, pool entries (EditSpawnPool), vanilla SpawnNPC sites; a town NPC's move-in condition
  const spawnAlts = new Map(); // npc id → gate lists
  const addAlt = (id, gates) => { let l = spawnAlts.get(id); if (!l) spawnAlts.set(id, (l = [])); l.push(gates); };
  for (const [id, alts] of spawns) for (const a of alts) addAlt(id, a);
  for (const p of pools) addAlt(p.npc, p.gates);
  for (const n of npcs) {
    if (n.mod === 'v' || npcProg.has(n.id)) continue;
    if (n.gates?.length) addAlt(n.id, n.gates);
    else if (n.natural) addAlt(n.id, []);
  }
  // config gates for enemies whose real spawn condition is not in the IL the miner reads: vanilla by
  // NPCID name, mod NPCs by Mod:Class. An enemy the code says nothing about has no gate at all, so
  // this is the gate itself and not only a floor — otherwise the config cannot answer for the enemy
  // the miner learned the least about (the Desert Spirit's hardmode desert is one such spawn site).
  const npcByModName = new Map(); // "Mod:display name" and "display name", both normalized
  for (const n of npcs) for (const k of [`${n.mod}:${norm(n.name)}`, norm(n.name)]) if (n.name && !npcByModName.has(k)) npcByModName.set(k, n.id);
  const enemyFloor = new Map();
  for (const [name, key] of Object.entries(config.enemies ?? {})) {
    if (name.startsWith('$')) continue;
    const p = progOfKey(key);
    if (p === null) continue;
    const [mod, ...rest] = name.split(':');
    const bare = rest.join(':');
    const id = rest.length
      ? npcByModClass.get(`${mod}:${norm(bare)}`) ?? npcByModName.get(`${mod}:${norm(bare)}`)
      : npcIds.get(name) !== undefined ? `v:${npcIds.get(name)}` : npcByModName.get(norm(name));
    if (id !== undefined) enemyFloor.set(id, { p, label: labelOfKey(key), flag: null, cfg: true });
  }
  const enemyGate = new Map(); // npc id → { p, label, flag } | null (unusable) ; absent = no spawn evidence
  const enemyGateOf = (id) => {
    if (enemyGate.has(id)) return enemyGate.get(id);
    let g = null;
    const n = npcById.get(id);
    if (n?.town && !spawnAlts.has(id)) g = townGate(id) ?? null;
    else if (spawnAlts.has(id)) {
      const label = npcName.get(id) ?? id;
      const resolved = spawnAlts.get(id).map((a) => usableGate(a, label)).filter(Boolean);
      if (resolved.length) g = resolved.sort((a, b) => a.p - b.p)[0];
    } else g = undefined;
    const floor = enemyFloor.get(id);
    if (floor && (g == null || g.p < floor.p)) g = floor;
    enemyGate.set(id, g);
    return g;
  };

  // crafting stations
  const tileProg = new Map();
  const tileName = new Map();
  for (const [name, id] of tileIds) if (typeof id === 'number' && !tileName.has(`v:tile:${id}`)) tileName.set(`v:tile:${id}`, deCamelKey(name));
  for (const [name, key] of Object.entries(config.stations)) {
    if (name.startsWith('$')) continue;
    const tid = tileIds.get(name);
    const p = progOfKey(key);
    if (tid !== undefined && p !== null) tileProg.set(`v:tile:${tid}`, { p, label: deCamelKey(name), boss: labelOfKey(key) });
  }
  const placedBy = new Map(); // tile ref → item ids that place it
  for (const it of items) if (it.createTile) { let l = placedBy.get(it.createTile); if (!l) placedBy.set(it.createTile, (l = [])); l.push(it.id); }
  const stationLabel = (tileRef) => tileProg.get(tileRef)?.label ?? tileName.get(tileRef) ?? byId.get(placedBy.get(tileRef)?.[0])?.name ?? tileRef.split(':').pop();
  /**
   * When a crafting station can first be used: the config's gate, else the earliest item that
   * places the tile — vanilla ones too (the Tinkerer's Workshop is sold by the Goblin Tinkerer,
   * who moves in only after the goblin army).
   */
  const stationGate = (tileRef, prog, relaxed = true) => {
    const cfg = tileProg.get(tileRef);
    if (cfg) return { p: cfg.p, boss: cfg.boss };
    let best = null;
    let pending = false;
    for (const id of placedBy.get(tileRef) ?? []) {
      const pr = prog.get(id);
      if (!pr) { pending = true; continue; }
      if (best === null || pr.p < best.p) best = { p: pr.p, boss: pr.src?.boss };
    }
    if (best) return best;
    const pr = tileRef.startsWith('v:') ? null : prog.get(tileRef); // older mods: item and tile share the class name
    if (pr) return { p: pr.p, boss: pr.src?.boss };
    // Something places this station but its own progression has not arrived yet: judging the recipe
    // now would call the station pre-boss and lock the result there, since the earliest wins
    // (SOTS's Transmutation Altar turns Twilight Gel into Meteorite Bars, and the Star Cannon
    // followed it to pre-boss). Blocked until it resolves, then its rarity guess, like an
    // ingredient. A tile nothing places — a Demon Altar — is open from the start.
    if (!pending) return { p: 0 };
    if (!relaxed) return null;
    for (const id of placedBy.get(tileRef) ?? []) {
      const q = byId.has(id) ? rarityProg(byId.get(id)) : null;
      if (q !== null && (best === null || q < best.p)) best = { p: q, boss: labelOfProg(q) };
    }
    return best ?? { p: 0 };
  };

  // recipe groups
  const groupMembers = new Map();
  for (const g of groups) { let l = groupMembers.get(g.name); if (!l) groupMembers.set(g.name, (l = new Set())); for (const x of g.items) l.add(x); }
  const groupLabel = (name) => `any ${name.replace(/^(any|Any)/, '').replace(/^[A-Za-z]+:/, '')}`;

  // tiles that gate mining (config for vanilla, MinPick / CanKillTile for mods); tiles a mod's
  // world generation places are minable with any pickaxe unless they say otherwise
  const tileGate = new Map(); // tile ref → { minPick, ore, gates }
  for (const [name, need] of Object.entries(config.pickaxe?.vanillaTiles ?? {})) {
    const tid = tileIds.get(name);
    if (tid !== undefined) tileGate.set(`v:tile:${tid}`, { minPick: need, ore: true });
  }
  for (const name of config.pickaxe?.vanillaOres ?? []) {
    const tid = tileIds.get(name);
    if (tid !== undefined && !tileGate.has(`v:tile:${tid}`)) tileGate.set(`v:tile:${tid}`, { minPick: 0, ore: true });
  }
  for (const t of tiles) tileGate.set(t.id, { id: t.id, minPick: t.minPick ?? 0, ore: !!t.ore, gates: t.gates });
  for (const t of worldgenTiles) if (!tileGate.has(t)) tileGate.set(t, { id: t, minPick: 0, ore: false, worldgen: true });
  const oreItems = items.filter((it) => it.createTile && tileGate.has(it.createTile));
  const pickaxes = items.filter((it) => it.pick > 0);

  const recipesByResult = new Map();
  for (const r of recipes) {
    if (!r.result) continue;
    let l = recipesByResult.get(r.result);
    if (!l) recipesByResult.set(r.result, (l = []));
    l.push(r);
  }
  // A decraft loop — vanilla Wood ⇄ Thorium's Smooth Wood, each Lunar fragment from the other three
  // — says nothing about where either side comes from, and staging one on the other only walks in
  // circles.
  const craftedFrom = new Map(); // result → the ids its recipes consume
  for (const [result, list] of recipesByResult) craftedFrom.set(result, new Set(list.flatMap((r) => r.ingredients.map((i) => i.item).filter(Boolean))));
  /**
   * A loop says nothing only while both sides know nothing but each other. Once the ingredient's
   * stage comes from somewhere else — vanilla Ebonwood is simply there from the start — the recipe
   * is evidence like any other: Thorium's Chiseled Ebonwood is made of Ebonwood, whatever the
   * decraft turns it back into. Without this every block and wall a mod adds on top of a vanilla
   * material stayed sourceless, and with it the equipment behind them.
   */
  const isDecraftLoop = (result, r, prog) => r.ingredients.some((i) => i.item && craftedFrom.get(i.item)?.has(result) && (prog.get(i.item)?.src.kind ?? 'craft') === 'craft');
  /**
   * Does making `result` eventually consume `want`? The same circular-evidence question one step
   * further out, for the pickaxe an ore is unlocked by: a pickaxe crafted out of the ore it would
   * mine cannot be the reason that ore is reachable. Thorium's Aquaite needs pick 65 and the miner
   * was answering with the Hydro Pickaxe — which is made of Aquaite Bar, which is made of Aquaite.
   */
  const needsCache = new Map();
  const craftNeeds = (result, want) => {
    const key = `${result}|${want}`;
    const hit = needsCache.get(key);
    if (hit !== undefined) return hit;
    needsCache.set(key, false); // a cycle answers "no" while it is still being decided
    let out = false;
    for (const ing of craftedFrom.get(result) ?? []) if (ing === want || craftNeeds(ing, want)) { out = true; break; }
    needsCache.set(key, out);
    return out;
  };

  const dropsByBag = new Map();  // bag id → [{ item, cond gate }]
  const bossDrops = [];   // { item, boss, p, gate? }
  const enemyDrops = [];  // { item, npc, gate }
  const tileSpawns = [];  // { boss, tile }
  const common = (id) => id.startsWith('v:') && (byId.get(id)?.rarity ?? 0) <= 1;
  for (const d of drops) {
    const [kind, ...rest] = d.source.split(':');
    const src = rest.join(':');
    if (kind === 'npc') {
      const boss = npcProg.get(src);
      if (boss) {
        if (d.item.startsWith('tile:')) { tileSpawns.push({ boss, tile: d.item.slice(5) }); continue; }
        // a mod boss dropping a common vanilla material (Jungle Spores from Corpse Bloom) is never
        // its earliest source; the material's vanilla enemies are not in the drop evidence
        if (common(d.item) && (!src.startsWith('v:') || (boss.mod && boss.mod !== 'v'))) continue;
        // the drop's own condition (Mollusk Husk from the Giant Clam only in hardmode)
        const cond = d.cond ? usableGate(d.cond, `${nameOf(d.item)} from ${boss.label}`) : null;
        if (d.cond && !cond) continue;
        const p = Math.max(boss.progression, cond?.p ?? 0);
        bossDrops.push({ item: d.item, boss, p, gate: cond && cond.p > boss.progression ? cond : null });
        continue;
      }
      if (d.item.startsWith('tile:')) continue;
      const label = `${nameOf(d.item)} from ${src === '*' ? 'any enemy' : npcName.get(src) ?? src}`;
      const cond = d.cond ? usableGate(d.cond, label) : null;
      if (d.cond && !cond) continue;
      let g;
      if (src === '*') { if (!cond) continue; g = cond; } // any enemy while X: only the condition gates
      else {
        const gate = enemyGateOf(src);
        if (gate === undefined || gate === null) continue; // no spawn evidence, or a gate that does not resolve
        g = cond && cond.p > gate.p ? cond : gate;
      }
      // a gated enemy that also drops something common (Yew Wood from a hardmode goblin) is not
      // its earliest source: commons keep their rarity guess
      if (common(d.item) && g.p > 0) continue;
      // An enemy the miner found no gate for spawns "from the start" only as far as the code says;
      // a mod's biome enemy is usually gated by the biome existing, by a downed flag the spawn pool
      // holds, or by nothing readable at all. When the item's own mod rates it far above the tier
      // that would put it in, believe the mod's rating: the drop stays the source, the tier moves.
      // (a special world seed that pulls the enemy forward — Mimics before hardmode in Don't Dig Up
      // — is the answer, not a gap in the evidence: the floor does not apply there)
      // — but a vanilla enemy's spawn is spelled out in `NPC.SpawnNPC`, and when that says "from the
      // start" it is evidence rather than a gap: a Fire Imp needs the Underworld and nothing else,
      // so what it drops is pre-boss however the mod painted the item's rarity
      // — and an enemy answered for in the config (`enemies`) is not a gap either: that is a person
      // saying where it spawns, which outranks the rarity the mod painted on what it drops
      const guessed = !spawns.has(src) && !g.cfg;
      const rp = guessed && g.p === 0 && !g.flag?.startsWith('seed:') && byId.has(d.item) ? rarityProg(byId.get(d.item)) : null;
      if (rp !== null && rp > g.p) g = { p: rp, label: labelOfProg(rp), flag: null };
      enemyDrops.push({ item: d.item, npc: src, gate: g });
    } else if (kind === 'bag') {
      const cond = d.cond ? usableGate(d.cond, `${nameOf(d.item)} from ${nameOf(src)}`) : null;
      if (d.cond && !cond) continue;
      let list = dropsByBag.get(src);
      if (!list) dropsByBag.set(src, (list = []));
      list.push({ item: d.item, cond });
    }
  }

  // critters: the item is the caught NPC, so it follows the NPC's spawn gate
  const critters = []; // { item, npc, gate }
  for (const it of items) {
    if (!it.makeNPC) continue;
    const g = enemyGateOf(it.makeNPC);
    if (g) critters.push({ item: it.id, npc: it.makeNPC, gate: g });
  }

  // Floors: the earliest an item can possibly be, whatever evidence turns up. An anchor already
  // works this way for ores ("Meteorite falls after the evil boss"); it means the same for a
  // hardmode drop the miner reads a spawn site of without its guard, so it is a floor everywhere.
  const floors = new Map(); // item id → { p, boss, via }
  for (const [prefix, s] of Object.entries(config.structures ?? {})) {
    if (prefix.startsWith('$')) continue;
    const p = progOfKey(typeof s === 'string' ? s : s.after);
    if (p === null) continue;
    const rec = { p, boss: labelOfKey(typeof s === 'string' ? s : s.after), via: typeof s === 'string' ? undefined : s.via };
    for (const it of items) if (it.fullName?.startsWith(prefix)) { const cur = floors.get(it.id); if (!cur || cur.p < p) floors.set(it.id, rec); }
  }

  const anchorProg = new Map();
  for (const [ref, key] of Object.entries(config.anchors)) {
    if (ref.startsWith('$')) continue;
    const id = resolveRef(ref);
    const p = progOfKey(key);
    if (id && p !== null) {
      anchorProg.set(id, p);
      anchorProg.set(id + '#label', labelOfKey(key));
      const cur = floors.get(id);
      if (!cur || cur.p < p) floors.set(id, { p, boss: labelOfKey(key), anchor: true });
    }
  }

  // shops: the seller's move-in condition plus the entry's own condition
  const shopDrops = []; // { item, npc, gate }
  for (const sh of shops) {
    const tg = townGate(sh.npc);
    if (!tg) continue;
    const cond = sh.cond ? usableGate(sh.cond, `${nameOf(sh.item)} sold by ${npcName.get(sh.npc) ?? vanillaNpcName.get(sh.npc) ?? sh.npc}`) : null;
    if (sh.cond && !cond) continue;
    let g = cond && cond.p > tg.p ? cond : tg;
    // A shop entry another mod registered stocks the item behind progression its own mod cannot
    // see — a vanilla item at Thorium's Diverman, Calamity's post-Providence ammo at a cross-mod
    // ammo dealer who moves in on day one. Such an entry is not evidence in either direction: the
    // item's rarity stands, both as a ceiling (it is obtainable earlier anyway) and as a floor (the
    // shop does not make an endgame item a pre-boss one). An entry the item's own mod registered is
    // the authority, wherever it sells it: the Spell Tome has no source but its vanilla vendor.
    const rp = sh.from && sh.from !== sh.item.split(':')[0] && byId.has(sh.item) ? rarityProg(byId.get(sh.item)) : null;
    if (rp !== null && rp < g.p) continue;
    if (rp !== null && rp > g.p) g = { p: rp, label: labelOfProg(rp), flag: null };
    shopDrops.push({ item: sh.item, npc: sh.npc, gate: g });
  }
  // fishing catches and crates
  const fishDrops = []; // { item, gate, via }
  for (const f of fish) {
    const g = usableGate(f.cond, `${nameOf(f.item)} by fishing`);
    if (!g) continue;
    fishDrops.push({ item: f.item, gate: g, via: f.via });
  }
  // chest contents placed at world generation; a mod's chest may be locked or in a late structure,
  // which the code does not say: those keep their rarity guess as a floor (`estimated`)
  const chestItems = new Set();
  for (const c of Object.values(config.chests ?? {})) if (c?.items) for (const ref of c.items) { const id = resolveRef(ref); if (id) chestItems.add(id); }
  const worldgenDrops = []; // { item, p, via, boss?, estimated? }
  for (const w of worldgen) {
    if (chestItems.has(w.item)) continue; // a locked chest the config knows about
    const g = usableGate(w.cond, `${nameOf(w.item)} in a chest (${w.via})`);
    if (!g) continue;
    let p = g.p;
    let boss = g.label;
    const after = w.after ? progOfKey(w.after) : null;
    if (after !== null && after !== undefined && after > p) { p = after; boss = labelOfKey(w.after); }
    let estimated = false;
    // a mod's chest may be locked (a chest tile with UnlockChest) or sit in a structure that is not
    // meant to be reached early, which the code does not say: locked chests and hardmode-tier items
    // keep their rarity guess as a floor
    const rp = byId.has(w.item) ? rarityProg(byId.get(w.item)) : null;
    const lateTier = w.mod && w.mod !== 'v' && rp !== null && rp >= (progOfKey('WallOfFlesh') ?? 7);
    if ((w.estimated || lateTier) && rp !== null && rp > p) { p = rp; boss = labelOfProg(p); estimated = true; }
    worldgenDrops.push({ item: w.item, p, via: w.via, boss: p > 0 ? boss : undefined, estimated });
  }
  // manual sources (miner/stage/sources.json): the user's own research, applied like overrides
  const manual = [];
  const unobtainable = new Map(); // id → why: the answer is "you cannot get this", not a stage
  for (const [ref, m] of Object.entries(config.manual ?? {})) {
    if (ref.startsWith('$')) continue;
    const id = resolveRef(ref);
    const key = typeof m === 'string' ? m : m.after;
    if (!id) continue;
    if (key === 'unobtainable') { unobtainable.set(id, typeof m === 'string' ? undefined : m.via); continue; }
    const p = progOfKey(key);
    if (p !== null) manual.push({ item: id, p, boss: labelOfKey(key), via: typeof m === 'string' ? undefined : m.via });
  }

  const bagItems = new Set([...dropsByBag.values()].flat().map((d) => d.item));

  const spawnFloor = new Map(); // ore item → earliest boss that spawns its tile
  for (const { boss, tile } of tileSpawns) for (const id of placedBy.get(tile) ?? []) { const cur = spawnFloor.get(id); if (!cur || boss.progression < cur.p) spawnFloor.set(id, { p: boss.progression, label: boss.label }); }

  const chests = [];
  for (const [name, c] of Object.entries(config.chests ?? {})) {
    if (name.startsWith('$')) continue;
    const p = progOfKey(c.after);
    if (p === null) continue;
    for (const ref of c.items) {
      const id = resolveRef(ref);
      if (!id) continue;
      chests.push({ item: id, p, chest: name, boss: labelOfKey(c.after) });
      // The key gates the chest, so its contents do not arrive earlier by some other route either:
      // the Obsidian Lock Box holds the shadow chest's weapons and asks for nothing but lava
      // fishing, and nobody calls a Sunfury pre-Skeletron on the strength of that.
      const cur = floors.get(id);
      if (!cur || cur.p < p) floors.set(id, { p, boss: labelOfKey(c.after), via: name, kind: 'chest' });
    }
  }

  // ---- one inference pass ------------------------------------------------------------------
  const run = (oreSeed) => {
    /** prog[id] = { p, src } — the earliest known progression and why. */
    const prog = new Map();
    const better = (id, p, src) => {
      if (p === null || p === undefined || !Number.isFinite(p)) return false;
      // a structure's loot cannot predate the structure, whichever route found it
      const f = floors.get(id);
      if (f && p < f.p) { p = f.p; src = f.anchor ? { kind: 'anchor', boss: f.boss } : { kind: f.kind ?? 'structure', boss: f.boss, via: f.via }; }
      const cur = prog.get(id);
      // at an equal stage, a material is better explained by what it is made of than by the odd
      // enemy that happens to drop one: a Gold Bar is 4 Gold Ore at a furnace, not a Gilded Lycan.
      // Equipment keeps the drop — that is how you get a boss weapon, whatever else can also make it
      const tie = cur && cur.p === p && src.kind === 'craft' && DROP_KINDS.has(cur.src.kind) && !EQUIP_SLOTS.has(byId.get(id)?.slot);
      if (cur && cur.p <= p && !tie) return false;
      prog.set(id, { p, src });
      return true;
    };

    for (const [ref, key] of Object.entries(config.anchors)) {
      if (ref.startsWith('$')) continue;
      const id = resolveRef(ref);
      const p = progOfKey(key);
      if (id && p !== null) better(id, p, { kind: 'anchor', boss: labelOfKey(key) });
    }
    // the ore round's answer (pickaxe + world gates) goes first: at an equal stage it explains an ore better than a bare spawn or an enemy drop
    for (const [id, seed] of oreSeed) better(id, seed.p, seed.src);
    for (const { item, boss, p, gate } of bossDrops) better(item, p, gate ? { kind: 'drop', boss: boss.label, gate: gate.flag ?? undefined, until: gate.label ?? undefined } : { kind: 'drop', boss: boss.label });
    for (const { item, npc, gate } of enemyDrops) better(item, gate.p, { kind: 'enemy', via: npc === '*' ? 'any enemy' : npcName.get(npc) ?? vanillaNpcName.get(npc) ?? npc, boss: gate.label ?? undefined, gate: gate.flag ?? undefined });
    for (const { boss, tile } of tileSpawns) for (const id of placedBy.get(tile) ?? []) if (!oreSeed.has(id)) better(id, boss.progression, { kind: 'spawn', boss: boss.label });
    for (const c of chests) better(c.item, c.p, { kind: 'chest', via: c.chest, boss: c.boss });
    for (const { item, npc, gate } of shopDrops) better(item, gate.p, { kind: 'shop', via: npcName.get(npc) ?? vanillaNpcName.get(npc) ?? npc, boss: gate.label ?? undefined, gate: gate.flag ?? undefined });
    for (const { item, gate, via } of fishDrops) better(item, gate.p, { kind: 'fish', via, boss: gate.label ?? undefined, gate: gate.flag ?? undefined });
    for (const { item, npc, gate } of critters) better(item, gate.p, { kind: 'critter', via: npcName.get(npc) ?? vanillaNpcName.get(npc) ?? npc, boss: gate.label ?? undefined, gate: gate.flag ?? undefined });
    // A chest whose reach the code does not spell out is a guess dressed as evidence, and the
    // earliest evidence wins: Thorium fills every chest style in the world from one method, so its
    // Aquaite Bar looked like pre-boss chest loot and the recipe that actually makes it — Aquaite,
    // which wants a 65% pickaxe — never got a say. Estimated chests wait until the fixpoint has had
    // its turn (below), the way rarity does.
    for (const { item, p, via, boss, estimated } of worldgenDrops) if (!estimated) better(item, p, { kind: 'worldgen', via, boss });
    // The bottom layer, seeded before the recipes rather than after them: a vanilla material no code
    // path produces is simply there from the start — wood, stone, sand, moss, herbs. Chopping a tree
    // leaves no IL behind, and the mod block made of that wood needs the answer while the recipes are
    // still being solved, not after (Thorium's Chiseled Ebonwood is Ebonwood and nothing else).
    // Anything with evidence of its own has it by now and keeps it; ores are the ore round's to answer.
    // (a recipe that only decrafts what is made of it is not a way of making the base material:
    // Wood is a tree, whatever Thorium's Smooth Wood turns back into. Anything with a real recipe —
    // a Cobalt Bar — waits for it.)
    for (const it of items) {
      if (prog.has(it.id) || !it.id.startsWith('v:') || EQUIP_SLOTS.has(it.slot)) continue;
      if (it.createTile && tileGate.has(it.createTile)) continue;
      if (bagItems.has(it.id)) continue; // a treasure bag answers for it further down this pass
      if (!(recipesByResult.get(it.id) ?? []).every((r) => isDecraftLoop(it.id, r, prog))) continue;
      if (rarityProg(it) === 0) prog.set(it.id, { p: 0, src: { kind: 'start' } });
    }

    const stationProg = (tileRef, relaxed) => stationGate(tileRef, prog, relaxed)?.p ?? null;
    /**
     * The progression of one ingredient. While the propagation is still running an ingredient
     * whose own evidence has not arrived yet blocks the recipe: falling back to its rarity there
     * would pin the result at the guess (Opal Striker at pre-boss because Meteorite Bar had not
     * been resolved when its recipe was first visited) and nothing later can raise it again, since
     * the earliest evidence wins. Only once the fixpoint has settled does rarity fill the gaps.
     */
    const progOfIngredient = (id, relaxed) => {
      const ip = prog.get(id);
      if (ip) return ip.p;
      if (!relaxed) return null;
      const it = byId.get(id);
      return it ? rarityProg(it) : null;
    };

    // overrides seed the propagation too, so what is crafted from an overridden item follows it
    const applyOverrides = () => {
      for (const [ref, key] of Object.entries(config.overrides)) {
        if (ref.startsWith('$')) continue;
        const id = resolveRef(ref);
        const p = progOfKey(key);
        if (id && p !== null) prog.set(id, { p, src: { kind: 'override', boss: labelOfKey(key) } });
      }
      for (const m of manual) prog.set(m.item, { p: m.p, src: { kind: 'manual', boss: m.boss, via: m.via } });
    };
    applyOverrides();

    // two fixpoints: the first with every ingredient's own evidence only, the second letting the
    // gaps that never resolved fall back to rarity. Doing it in one pass pins a result at the guess
    // of an ingredient that had simply not been reached yet, and the earliest evidence wins forever.
    for (const relaxed of [false, true]) {
    for (let iter = 0; iter < 40; iter++) {
      let changed = false;
      for (const [bag, list] of dropsByBag) {
        const bp = prog.get(bag);
        if (!bp) continue;
        const bagName = byId.get(bag)?.name ?? bag;
        for (const { item: id, cond } of list) {
          // a mod boss bag holding a common vanilla material is never the material's earliest source
          if (id.startsWith('v:') && !bag.startsWith('v:') && (byId.get(id)?.rarity ?? 0) <= 1) continue;
          const p = Math.max(bp.p, cond?.p ?? 0);
          if (better(id, p, { kind: 'bag', boss: cond && cond.p > bp.p ? cond.label : bp.src.boss ?? bagName, via: bagName })) changed = true;
        }
      }
      for (const [result, list] of recipesByResult) {
        const resultItem = byId.get(result);
        // a vanilla item has its own vanilla sources (chests, drops, the world) that leave no code
        // evidence; a mod's added recipe (Diamond from coal, Starfury from Aerialite) may only make
        // it earlier than its rarity suggests, never later
        const vanillaCap = result.startsWith('v:') && resultItem ? rarityProg(resultItem) : null;
        list.forEach((r, index) => {
          if (!r.ingredients.length && !r.groups.length) return;
          if (isDecraftLoop(result, r, prog)) return;
          const modRecipe = r.method && !r.method.startsWith('Terraria.');
          let p = 0;
          let ok = true;
          const chain = [];
          const push = (q, label) => { if (q > p) { p = q; chain.length = 0; chain.push(label); } else if (q === p) chain.push(label); };
          for (const ing of r.ingredients) {
            if (!ing.item) { ok = false; break; }
            const q = progOfIngredient(ing.item, relaxed);
            if (q === null) { ok = false; break; }
            push(q, byId.get(ing.item)?.name ?? ing.item);
          }
          if (!ok) return;
          for (const g of r.groups) {
            const members = groupMembers.get(g);
            if (!members) continue; // unknown group: cannot gate
            let best = null;
            for (const m of members) { const q = progOfIngredient(m, relaxed); if (q !== null && (best === null || q < best.q)) best = { q, id: m }; }
            if (!best) continue;
            push(best.q, `${groupLabel(g)} (${byId.get(best.id)?.name ?? best.id})`);
          }
          for (const t of r.tiles) {
            const tp = stationProg(t, relaxed);
            if (tp === null) { ok = false; break; }
            if (tp > p) { p = tp; chain.length = 0; chain.push(stationLabel(t)); }
          }
          if (!ok) return;
          if (modRecipe && vanillaCap !== null && p > vanillaCap) return;
          if (better(result, p, { kind: 'craft', from: chain.slice(0, 3), recipe: index })) changed = true;
        });
      }
      if (!changed) break;
    }
    }

    // the estimated chests, now that everything with a real source has one
    for (const { item, p, via, boss, estimated } of worldgenDrops) if (estimated && !prog.has(item)) prog.set(item, { p, src: { kind: 'worldgen', via, boss, estimated: true } });

    // overrides win
    applyOverrides();

    // rarity fallback
    for (const it of items) {
      if (prog.has(it.id)) continue;
      // A piece of equipment the code *does* describe — it is the result of a recipe — whose
      // ingredients never resolved is not an item with no evidence. Guessing from its rarity there
      // says the gate is whatever colour the mod happened to paint it, and a mod that does not tier
      // its rarities (StarsAbove paints a 440-damage sword green) lands that guess at pre-boss,
      // where it then wins every list for twenty stages. Admitting the stage is unknown is both
      // truer and the pessimistic answer: the pool leaves it out until asked for it.
      if (EQUIP_SLOTS.has(it.slot) && recipesByResult.has(it.id)) continue;
      const p = rarityProg(it);
      // the bottom layer: a vanilla material nothing in the code produces, at the first stage —
      // wood, stone, sand, moss, herbs. Chopping a tree leaves no IL behind, and no guess is needed
      // either: you have it from the start. Equipment stays a rarity guess (the Angler's hat is a
      // quest reward, the Candy Cane Sword a Christmas drop — both white, neither lying around)
      const base = p === 0 && it.id.startsWith('v:') && !EQUIP_SLOTS.has(it.slot);
      if (p !== null) prog.set(it.id, { p, src: { kind: base ? 'start' : 'rarity' } });
    }
    // and the structure floors over whatever the fallbacks and the overrides landed on
    for (const [id, f] of floors) {
      const cur = prog.get(id);
      if (!cur || cur.p < f.p) prog.set(id, { p: f.p, src: f.anchor ? { kind: 'anchor', boss: f.boss } : { kind: 'structure', boss: f.boss, via: f.via } });
    }
    return prog;
  };

  // ---- rounds: ores need pickaxes, pickaxes need ores ----------------------------------------
  let prog = run(new Map());
  let oreSeed = new Map();
  for (let round = 0; round < 4; round++) {
    const next = new Map();
    // a pickaxe staged by rarity alone is a guess and cannot vouch for an ore
    const picks = pickaxes.map((it) => ({ it, p: prog.get(it.id)?.p, kind: prog.get(it.id)?.src.kind })).filter((x) => x.p !== undefined && x.kind !== 'rarity' && x.kind !== 'unknown').sort((a, c) => a.p - c.p || c.it.pick - a.it.pick);
    /** pickaxe + downed gates of one tile → { p, src } or null when nothing can mine it yet */
    const gateOfTile = (t, oreId = null) => {
      let p = 0;
      const src = {};
      if (t.minPick > 0) {
        const pick = picks.find((x) => x.it.pick >= t.minPick && !(oreId && craftNeeds(x.it.id, oreId)));
        if (!pick) return null;
        p = pick.p;
        src.need = t.minPick;
        src.pickaxe = pick.it.name;
        src.boss = labelOfProg(pick.p);
      }
      const g = t.gates?.length ? usableGate(t.gates, `tile ${t.id ?? ''}`) : null;
      if (t.gates?.length && !g) return null;
      if (g && g.p > p) { p = g.p; src.boss = g.label; src.gate = g.flag; }
      return { p, src };
    };
    for (const it of oreItems) {
      const t = tileGate.get(it.createTile);
      // an anchor on an ore is the world gate (Meteorite falls after the evil boss), a boss that spawns
      // the tile likewise: the floor under the pickaxe gate
      const spawn = spawnFloor.get(it.id);
      const floor = Math.max(anchorProg.get(it.id) ?? 0, spawn?.p ?? 0);
      let own = gateOfTile(t, it.id);
      if (!own) continue; // nothing mines it: leave the other evidence / rarity
      let p = own.p;
      let src = { kind: 'ore', ...own.src };
      // worldgen places a different tile until a boss converts it (Calamity's disenchanted Aerialite)
      const alt = config.pickaxe?.worldgenAs?.[it.id];
      if (alt && tileGate.has(alt.tile)) {
        const altGate = gateOfTile(tileGate.get(alt.tile), it.id);
        const until = progOfKey(alt.until);
        if (until !== null) {
          const after = Math.max(p, until);
          if (altGate && altGate.p < after) { p = altGate.p; src = { kind: 'ore', ...altGate.src, before: labelOfKey(alt.until) }; }
          else { p = after; src = { kind: 'ore', ...own.src, boss: until >= own.p ? labelOfKey(alt.until) : own.src.boss, until: labelOfKey(alt.until), altNeed: altGate ? altGate.src.need : tileGate.get(alt.tile).minPick }; }
        }
      }
      if (floor > p) {
        p = floor;
        const bySpawn = spawn && spawn.p >= (anchorProg.get(it.id) ?? 0);
        // a converted world tile (`worldgenAs`) whose converting boss also spawns it keeps the pickaxe story
        if (src.until && bySpawn) src = { ...src, boss: spawn.label };
        else { src = { kind: bySpawn ? 'spawn' : 'ore', need: t.minPick || undefined, boss: bySpawn ? spawn.label : anchorProg.get(it.id + '#label') }; if (src.kind === 'ore') src.anchor = true; }
      }
      if (p === 0 && !src.need && !src.gate) src.kind = 'worldgen';
      if (p === 0) delete src.boss;
      for (const k of Object.keys(src)) if (src[k] === undefined) delete src[k];
      next.set(it.id, { p, src });
    }
    const same = next.size === oreSeed.size && [...next].every(([id, s]) => oreSeed.get(id)?.p === s.p);
    oreSeed = next;
    prog = run(oreSeed);
    if (same) break;
  }

  const byItem = new Map();
  for (const [id, { p, src }] of prog) byItem.set(id, { progression: p, stage: stageOf(p), source: src });
  // no stage at all, on purpose: the mod removed it or left it unreachable, and saying so is an
  // answer — it keeps the item out of every pool without it coming back as an open question
  for (const [id, via] of unobtainable) byItem.set(id, { progression: null, stage: null, source: { kind: 'unobtainable', via } });

  // class aliases for the mods present
  const classAliases = {};
  for (const [mod, aliases] of Object.entries(config.classAliases)) {
    if (mod.startsWith('$') || !mods.includes(mod)) continue;
    Object.assign(classAliases, aliases);
  }

  const stations = new Map();
  for (const r of recipes) for (const t of r.tiles ?? []) if (!stations.has(t)) {
    const g = stationGate(t, prog);
    const q = Number.isFinite(g.p) ? g.p : 0;
    stations.set(t, { name: stationLabel(t), progression: q, stage: stageOf(q), boss: g.boss });
  }

  return {
    stages, bosses: merged, byItem, classAliases,
    groups: Object.fromEntries([...groupMembers].map(([k, v]) => [k, [...v]])),
    stations,
    enemyGates: enemyGate,
    /** flags that gate evidence but did not resolve: [{ flag, count, examples }] — the config's downedFlags / zones fill these in */
    unresolvedFlags: [...unresolved].map(([flag, u]) => ({ flag, count: u.count, examples: [...u.examples] })).sort((a, b) => b.count - a.count),
    /** special world seeds whose gates blocked evidence here — worth re-running with each one on */
    seedsSeen: [...seedsSeen],
    tileGate,
  };
}

function deCamelKey(k) {
  return String(k).replace(/([a-z\d])([A-Z])/g, '$1 $2');
}
