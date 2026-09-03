/**
 * Items placed into chests at world generation, and tiles the world generator places.
 *
 * Vanilla: `WorldGen.AddBuriedChest` picks most chest contents itself (`contain = 848` under
 * `Style == 17` and depth checks); its callers (Pyramid, IslandHouse, living trees, the temple,
 * cave houses, gen passes) pass the main item in - a constant, or a local chosen by a switch.
 * Mods: `ModSystem.ModifyWorldGenTasks` / `PostWorldGen` / `ModifyHardmodeTasks`, `GenPass.ApplyPass`
 * and the world-generation helpers they call: every `ItemType<X>()` there is a chest item, every
 * `TileType<T>()` a tile that exists in a fresh world.
 */
import { decodeIL } from '../clr/il.js';
import { Machine, THIS, UNKNOWN, isNum, tmlStaticHook, tmlStaticLoadHook } from './interp.js';
import { expandValue, progressionHooks, siteGates } from './flags.js';
import { TYPE_ABSTRACT, callsMethodNamed, contentRefs, derivesFromTml, refId } from './util.js';

const VANILLA_GEN_TYPES = /^Terraria\.(WorldGen|GameContent\.Biomes|GameContent\.Generation|WorldBuilding)/;

/**
 * @returns {Array<{ item: string, style?: number, tile?: number, via: string, cond?: string[] }>}
 */
export function extractVanillaChests(tml) {
  const out = [];
  const seen = new Set();
  const add = (id, ctx, via, style, tile) => {
    if (!isNum(id) || id <= 0) return;
    const st = style ?? ctx?.cases?.find((c) => c.slot === 'style' && isNum(c.value))?.value;
    const tt = tile ?? ctx?.cases?.find((c) => c.slot === 'tile' && isNum(c.value))?.value;
    const k = `${id}|${st}|${tt}`;
    if (seen.has(k)) return;
    seen.add(k);
    const gates = siteGates(ctx).filter((g) => !/^Zone/.test(g));
    out.push({ item: `v:${id}`, style: st, tile: tt, via, cond: gates.length ? gates : undefined });
  };
  const prog = progressionHooks();
  const wg = tml.typeByName.get('Terraria.WorldGen');
  const abc = wg?.methods.find((m) => m.name === 'AddBuriedChest' && tml.methodSig(m).params.length === 7 && tml.methodBody(m));
  if (!abc) return out;
  // 1. the picks inside AddBuriedChest, keyed on Style (arg 4) and chestTileType (arg 6)
  {
    const machine = new Machine(tml, {
      tml, linear: true, noDead: true, phi: true, maxDepth: 0, budget: 400_000,
      onStaticLoad: (f) => prog.onStaticLoad(f) ?? tmlStaticLoadHook(f),
      onLoad: (recv, name) => prog.onLoad(recv, name),
      onStoreArg(i, val, ctx) { if (i === 2) for (const e of expandValue(val, ctx)) add(e.v, e.ctx, 'AddBuriedChest'); },
      onCall(callee, args, ctx) {
        const hooked = tmlStaticHook(callee, args, ctx);
        if (hooked !== undefined) return hooked;
        // (the secondary `chest.item[k].SetDefaults(id)` fillers are potions, torches and the temple's
        // tablets - the style keys are lost by then, so they are not taken as chest sources)
        if (/^(NextFromList|SelectRandom)$/.test(callee.name)) { const arr = args.find((a) => a?.k === 'arr'); return arr ? { k: 'oneof', items: arr.items.filter(isNum) } : UNKNOWN; }
        return prog.onCall(callee);
      },
    });
    try { machine.run(abc, undefined, [UNKNOWN, UNKNOWN, UNKNOWN, UNKNOWN, { k: 'key', slot: 'style' }, UNKNOWN, { k: 'key', slot: 'tile' }], tml); } catch (e) { if (process.env.TL_STRICT) throw e; }
  }
  // 2. callers: AddBuriedChest(i, j, contain, notNear, Style, trySlope, chestTileType) with the
  //    main item as a constant or a local picked by a switch (every constant stored into it counts)
  const names = new Set(['AddBuriedChest']);
  for (const td of tml.types) {
    if (!VANILLA_GEN_TYPES.test(td.fullName)) continue;
    for (const md of td.methods) {
      if (md === abc || !tml.methodBody(md) || !callsMethodNamed(tml, md, names)) continue;
      const cands = new Map(); // local index → constants stored (since the last unconditional store)
      const machine = new Machine(tml, {
        tml, linear: true, noDead: true, phi: true, maxDepth: 0, budget: 1_000_000,
        onStaticLoad: (f) => prog.onStaticLoad(f) ?? tmlStaticLoadHook(f),
        onLoad: (recv, name) => prog.onLoad(recv, name),
        onStoreLocal(i, val, ctx) {
          if (!isNum(val)) { if (!ctx.conditional) cands.delete(i); return; }
          if (ctx.conditional) { let l = cands.get(i); if (!l) cands.set(i, (l = [])); l.push(val); } else cands.set(i, [val]);
        },
        onCall(callee, args, ctx) {
          const hooked = tmlStaticHook(callee, args, ctx);
          if (hooked !== undefined) return hooked;
          if (callee.name === 'AddBuriedChest' && args.length === 7) {
            const contain = args[2];
            const style = isNum(args[4]) ? args[4] : args[4]?.k === 'maybe' ? args[4].value : undefined;
            const tile = isNum(args[6]) ? args[6] : undefined;
            const via = `${td.name}.${md.name}`;
            if (contain?.k === 'maybe') for (const v of cands.get(contain.local) ?? [contain.value]) add(v, ctx, via, style, tile);
            else for (const e of expandValue(contain, ctx)) add(e.v, e.ctx, via, style, tile);
            return UNKNOWN;
          }
          return prog.onCall(callee);
        },
      });
      const n = tml.methodSig(md).params.length;
      try { machine.run(md, THIS, new Array(n).fill(UNKNOWN), tml); } catch (e) { if (process.env.TL_STRICT) throw e; }
    }
  }
  return out;
}

const ROOT_METHODS = /^(ModifyWorldGenTasks|PostWorldGen|PreWorldGen|ModifyHardmodeTasks|ApplyPass)$/;
const GEN_TYPE = /World|Gen|Structure|Chest|Shrine|Planetoid|Island|Biome|Dungeon|Temple|Pyramid|Cave|Ruins|Village/i;

/**
 * Chest items and placed tiles of a mod's world generation.
 * @returns {{ items: Array<{ item: string, via: string, cond?: string[] }>, tiles: string[] }}
 */
export function extractModWorldgen(asm, { modId }) {
  const roots = [];
  for (const td of asm.types) {
    if (td.flags & TYPE_ABSTRACT) continue;
    const sys = derivesFromTml(asm, td, 'ModSystem');
    const pass = !sys && asm.derivesFrom(td, (b) => b.name === 'GenPass');
    if (!sys && !pass) continue;
    for (const md of td.methods) if (ROOT_METHODS.test(md.name) && asm.methodBody(md)) roots.push({ md, hardmode: md.name === 'ModifyHardmodeTasks' });
  }
  // closure over calls into world-generation code (same type, nested lambdas, *World*/*Gen* types)
  const seen = new Map(); // method → hardmode?
  const queue = roots.map((r) => ({ md: r.md, hardmode: r.hardmode, depth: 0 }));
  while (queue.length) {
    const { md, hardmode, depth } = queue.shift();
    if (seen.has(md)) { if (!hardmode) seen.set(md, false); continue; }
    seen.set(md, hardmode);
    if (depth >= 4) continue;
    const body = asm.methodBody(md);
    if (!body) continue;
    let ins;
    try { ins = decodeIL(body.il); } catch { continue; }
    for (const x of ins) {
      if (x.op !== 'call' && x.op !== 'callvirt' && x.op !== 'ldftn' && x.op !== 'newobj') continue;
      let d;
      try { d = asm.resolve(x.operand); } catch { continue; }
      const def = d?.def;
      if (!def || !def.declaringType || !asm.methodBody(def)) continue;
      const dt = def.declaringType;
      const own = dt === md.declaringType || dt.fullName.startsWith(`${md.declaringType.fullName}/`);
      if (!own && !GEN_TYPE.test(dt.fullName)) continue;
      queue.push({ md: def, hardmode, depth: depth + 1 });
    }
  }
  // a chest tile with its own lock (ModTile.UnlockChest / LockChest) needs a key the code does not
  // name: what such a method places keeps its rarity guess as a floor (`locked`)
  const lockedTiles = new Set();
  for (const td of asm.types) if (!(td.flags & TYPE_ABSTRACT) && derivesFromTml(asm, td, 'ModTile') && td.methods.some((x) => (x.name === 'UnlockChest' || x.name === 'LockChest') && asm.methodBody(x))) lockedTiles.add(td.fullName);
  const items = new Map();
  const tiles = new Set();
  for (const [md, hardmode] of seen) {
    const via = `${md.declaringType.name}.${md.name}`;
    const tileRefs = contentRefs(asm, md, 'TileType');
    const locked = tileRefs.some((t) => lockedTiles.has(t)) || /Locked|BiomeChest/i.test(md.name);
    for (const t of contentRefs(asm, md, 'ItemType')) {
      const id = refId(asm, t);
      const prev = items.get(id);
      const rec = { item: id, via, cond: hardmode ? ['hardMode'] : undefined, locked: locked || undefined };
      if (!prev || (prev.cond && !hardmode) || (prev.locked && !locked)) items.set(id, rec);
    }
    for (const t of tileRefs) tiles.add(refId(asm, t));
  }
  return { items: [...items.values()].map((i) => ({ ...i, mod: modId })), tiles: [...tiles] };
}
