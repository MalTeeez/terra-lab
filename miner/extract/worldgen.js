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
import { TYPE_ABSTRACT, callsMethodNamed, contentRefs, derivesFromTml, gateRefs, refId } from './util.js';

const VANILLA_GEN_TYPES = /^Terraria\.(WorldGen|GameContent\.Biomes|GameContent\.Generation|WorldBuilding)/;

/** A compiler-generated closure class: `<>c`, `<>c__DisplayClass288_0`, `<>o__12`. */
const CLOSURE = /^<>/;
const labelCache = new WeakMap(); // asm → "Type::Method" → { lambda name → the string it was registered under }

/**
 * The string a lambda was registered under, by the name of the method the compiler gave it. Gen
 * passes are written `new PassLegacy("Water Chests", new WorldGenLegacyMethod(<lambda>))`, so the
 * `ldstr` before the `ldftn` is the pass's own name.
 */
function lambdaLabels(asm, ownerFull, methodName) {
  let byMethod = labelCache.get(asm);
  if (!byMethod) labelCache.set(asm, (byMethod = new Map()));
  const key = `${ownerFull}::${methodName}`;
  let out = byMethod.get(key);
  if (out) return out;
  byMethod.set(key, (out = new Map()));
  const md = asm.typeByName.get(ownerFull)?.methods.find((m) => m.name === methodName);
  let body;
  try { body = md && asm.methodBody(md); } catch { body = null; }
  if (!body) return out;
  let ins;
  try { ins = decodeIL(body.il); } catch { return out; }
  let last;
  for (const x of ins) {
    if (x.op === 'ldstr') { try { last = asm.userString(x.operand); } catch { last = undefined; } continue; }
    if (x.op !== 'ldftn' || !last) continue;
    try { const n = asm.resolve(x.operand)?.name; if (n) out.set(n, last); } catch { /* unresolvable */ }
  }
  return out;
}

/**
 * A readable owner for the method a chest was filled from — and the key `worldgenGates` is written
 * against, so it has to be stable and writable by hand. A gen pass registered as a lambda lives on
 * a closure class under a mangled name: the Flipper's water chests came out as
 * `<>c.<AddGenPasses>b__288_61`, which says nothing and cannot be pinned. The closure resolves to
 * the type that wrote it, and the lambda to the name it was registered under ("Water Chests"), or
 * failing that to the method it was written inside.
 */
export function viaName(asm, td, md) {
  const ownerFull = td.fullName.split('/').filter((p) => !CLOSURE.test(p.split('.').pop())).pop() ?? td.fullName;
  const enclosing = /^<(.+?)>[a-z]__/.exec(md.name)?.[1];
  const name = enclosing ? lambdaLabels(asm, ownerFull, enclosing).get(md.name) ?? enclosing : md.name;
  return `${ownerFull.split('.').pop()}.${name}`;
}

/**
 * @returns {Array<{ item: string, style?: number, tile?: number, via: string, cond?: string[] }>}
 */
export function extractVanillaChests(tml) {
  const out = [];
  const seen = new Set();
  const add = (id, ctx, via, style, tile, filler) => {
    if (!isNum(id) || id <= 0) return;
    const st = style ?? ctx?.cases?.find((c) => c.slot === 'style' && isNum(c.value))?.value;
    const tt = tile ?? ctx?.cases?.find((c) => c.slot === 'tile' && isNum(c.value))?.value;
    const k = `${id}|${st}|${tt}`;
    if (seen.has(k)) return;
    seen.add(k);
    const gates = siteGates(ctx).filter((g) => !/^Zone/.test(g));
    // a filler the case tracker could not key to a chest style is a last resort, not a source that
    // beats real evidence: it waits until everything else has had its turn (see `estimated`)
    out.push({ item: `v:${id}`, style: st, tile: tt, via, cond: gates.length ? gates : undefined, estimated: filler ? true : undefined });
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
        // `chest.item[k].SetDefaults(id)` fills the rest of the chest — mostly potions and torches,
        // but the Spear, the Blowpipe and the Flare Gun are only ever placed this way. The style
        // the block sits under is still on the case tracker, so a Shadow Chest weapon keeps its key.
        if (callee.name === 'SetDefaults' && isNum(args[0])) { add(args[0], ctx, 'AddBuriedChest', undefined, undefined, true); return UNKNOWN; }
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
            const via = viaName(tml, td, md);
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
  const items = new Map();
  const tiles = new Set();
  for (const [md, hardmode] of seen) {
    const via = viaName(asm, md.declaringType, md);
    // the chest tiles this method places into (another mod's as often as its own): `extractChestLocks`
    // says which of them are locked, and behind what
    const tileRefs = contentRefs(asm, md, 'TileType').map((t) => refId(asm, t));
    const locked = /Locked|BiomeChest/i.test(md.name);
    for (const t of contentRefs(asm, md, 'ItemType')) {
      const id = refId(asm, t);
      const prev = items.get(id);
      const rec = { item: id, via, cond: hardmode ? ['hardMode'] : undefined, locked: locked || undefined, chests: tileRefs.length ? tileRefs : undefined };
      if (!prev || (prev.cond && !hardmode) || (prev.locked && !locked)) items.set(id, rec);
    }
    for (const t of tileRefs) tiles.add(t);
  }
  return { items: [...items.values()].map((i) => ({ ...i, mod: modId })), tiles: [...tiles] };
}

/**
 * Chest tiles that need a boss or a key (`ModTile.UnlockChest`): tile id → the progression flags the
 * lock reads. Calamity's Abyss chest opens at Skeletron, and a mod placing an item in one — its own
 * chest or another mod's — places it behind that gate; an empty list is a lock the code does not
 * name (a key item), which only keeps the item's rarity guess as a floor.
 */
export function extractChestLocks(asm, { modId }) {
  const out = new Map();
  for (const td of asm.types) {
    if (td.flags & TYPE_ABSTRACT || !derivesFromTml(asm, td, 'ModTile')) continue;
    // UnlockChest only: it answers "can this be opened", the same polarity as CanKillTile.
    // IsLockedChest / LockChest answer the inverse, and their flags would read backwards.
    const m = td.methods.find((x) => x.name === 'UnlockChest' && asm.methodBody(x));
    if (!m) continue;
    out.set(`${modId}:${td.name}`, [...gateRefs(asm, m)]);
  }
  return out;
}
