/**
 * Shops: `ModNPC.AddShops` (`new NPCShop(Type).Add(item, conditions…).Register()`),
 * `GlobalNPC.ModifyShop` keyed on `shop.NpcType`, and tModLoader's vanilla shops in
 * `NPCShopDatabase.Register*`. Conditions are `Terraria.Condition` statics (DownedPlantera,
 * Hardmode, …) or `new Condition(text, () => flags)` lambdas; both become flag lists.
 */
import { ET } from '../clr/sig.js';
import { Machine, THIS, UNKNOWN, isNum, tmlStaticHook, tmlStaticLoadHook } from './interp.js';
import { expandValue, progressionHooks, siteGates } from './flags.js';
import { TYPE_ABSTRACT, derivesFromTml, findInherited, gateRefs, refId } from './util.js';

/**
 * @returns {Array<{ npc: string, item: string, cond?: string[] }>}
 */
export function extractShops(asm, { tml, modId }) {
  const out = [];
  for (const td of asm.types) {
    if (td.flags & TYPE_ABSTRACT) continue;
    if (td.name.includes('`') || td.name.startsWith('<')) continue;
    if (derivesFromTml(asm, td, 'ModNPC')) {
      const m = findInherited(asm, td, 'AddShops');
      if (m) runShopMethod(asm, m, { tml, thisVal: THIS, args: [], out, selfNpc: `${modId}:${td.name}` });
    } else if (derivesFromTml(asm, td, 'GlobalNPC')) {
      const m = td.methods.find((x) => x.name === 'ModifyShop' && asm.methodBody(x));
      if (m) runShopMethod(asm, m, { tml, thisVal: THIS, args: [{ k: 'obj', name: 'shopArg', props: {} }], out, selfNpc: null });
    }
  }
  return dedupe(out);
}

/** Vanilla shops from `NPCShopDatabase.Register*` (tModLoader.dll). */
export function extractVanillaShops(tml) {
  const out = [];
  const db = tml.typeByName.get('Terraria.ModLoader.NPCShopDatabase');
  if (!db) return out;
  for (const m of db.methods) {
    if (!/^Register[A-Z]/.test(m.name) || m.name === 'RegisterVanillaNPCShops' || !tml.methodBody(m)) continue;
    runShopMethod(tml, m, { tml, thisVal: THIS, args: [], out, selfNpc: null });
  }
  return dedupe(out);
}

function dedupe(list) {
  const seen = new Map();
  const out = [];
  for (const d of list) {
    const k = `${d.npc}|${d.item}`;
    const prev = seen.get(k);
    if (prev) { if (prev.cond && !d.cond) delete prev.cond; continue; }
    seen.set(k, d);
    out.push(d);
  }
  return out;
}

const condFlags = (asm, a) => {
  if (a?.k === 'delegate') return [...gateRefs(a.asm ?? asm, a.method)];
  if (a?.k === 'cond') return a.flags;
  if (a?.k === 'arr') return a.items.flatMap((x) => condFlags(asm, x));
  return [];
};

function runShopMethod(asm, md, { tml, thisVal, args, out, selfNpc }) {
  const itemOf = (a, callee) => {
    if (callee?.kind === 'methodSpec' && callee.typeArgs?.length) return refId(asm, callee.typeArgs[0]);
    if (isNum(a) && a > 0) return `v:${a}`;
    if (a?.k === 'type' && a.fn === 'ItemType') return refId(asm, a);
    if (a?.k === 'obj' && /Terraria\.Item$/.test(a.name ?? '') && a.args) return itemOf(a.args[0]);
    if (a?.k === 'obj' && a.props?.type !== undefined) return itemOf(a.props.type);
    return null;
  };
  const npcOf = (shop, cases) => {
    if (shop?.k === 'shop') return shop.npc;
    if (shop?.k === 'obj' && shop.name === 'shopArg') {
      const c = cases?.find((x) => x.slot === 0);
      if (!c) return null;
      return isNum(c.value) ? `v:${c.value}` : `npc:${refId(asm, c.value)}`.slice(4);
    }
    return null;
  };
  const machine = new Machine(asm, {
    tml,
    concreteType: md.declaringType,
    linear: true,
    maxDepth: 2,
    budget: 400000,
    onLoad(recv, name) {
      if (recv?.k === 'obj' && recv.name === 'shopArg') return name === 'NpcType' ? { k: 'key', slot: 0 } : UNKNOWN;
      return undefined;
    },
    onStaticLoad(f) {
      if ((f.declaringType?.fullName ?? '') === 'Terraria.Condition') return { k: 'cond', flags: /^Not|Moon|^In[A-Z]|Time|Near|World$|Multiplayer|Happy|Nearby|Shimmered|Christmas|Halloween|Party/.test(f.name) ? [] : [f.name] };
      return tmlStaticLoadHook(f);
    },
    onNew(callee, cargs) {
      const decl = callee.declaringType?.fullName ?? callee.declaringType?.name ?? '';
      if (decl === 'Terraria.ModLoader.NPCShop') {
        const npc = cargs[0]?.k === 'type' ? refId(asm, cargs[0]) : isNum(cargs[0]) ? `v:${cargs[0]}` : selfNpc;
        return { k: 'shop', npc, items: [] };
      }
      if (decl === 'Terraria.Condition') return { k: 'cond', flags: cargs.flatMap((a) => condFlags(asm, a)) };
      return undefined;
    },
    onCall(callee, cargs, ctx) {
      const hooked = tmlStaticHook(callee, cargs, ctx);
      if (hooked !== undefined) return hooked;
      const name = callee.name;
      const recv = ctx.recv;
      if (name === 'get_Type' && recv === THIS && selfNpc) return { k: 'type', fn: 'NPCType', name: selfNpc.split(':').pop(), id: selfNpc };
      if (name === 'get_NpcType' && recv?.k === 'obj' && recv.name === 'shopArg') return { k: 'key', slot: 0 };
      const shop = recv?.k === 'shop' || (recv?.k === 'obj' && recv.name === 'shopArg') ? recv : cargs[0]?.k === 'shop' ? cargs[0] : null;
      if (shop && /^(Add|InsertAt|InsertBefore|InsertAfter)$/.test(name)) {
        const args = recv === shop ? cargs : cargs.slice(1);
        const item = itemOf(args.find((a) => isNum(a) || a?.k === 'type' || a?.k === 'obj'), callee);
        const npc = npcOf(shop, ctx.cases);
        const cond = args.flatMap((a) => condFlags(asm, a));
        if (item && npc) out.push(cond.length ? { npc, item, cond } : { npc, item });
        return shop;
      }
      if (shop && (name === 'Register' || name === 'AllowFillingLastSlot')) return shop;
      return undefined;
    },
  });
  try { machine.run(md, thisVal, args, asm); } catch { /* keep going */ }
}

/**
 * The Travelling Merchant (`Chest.SetupTravelShop`): the items `SetupTravelShop_GetItem` can roll,
 * each gated by what `SetupTravelShop_CanAddItemToShop` requires for it (`Main.hardMode`, downed
 * flags). Entries are keyed to NPCID.TravellingMerchant (368).
 * @returns {Array<{ npc: string, item: string, cond?: string[] }>}
 */
export function extractTravelShop(tml) {
  const out = [];
  const chest = tml.typeByName.get('Terraria.Chest');
  const getItem = chest?.methods.find((m) => m.name === 'SetupTravelShop_GetItem' && tml.methodBody(m));
  const canAdd = chest?.methods.find((m) => m.name === 'SetupTravelShop_CanAddItemToShop' && tml.methodBody(m));
  if (!getItem) return out;
  const prog = progressionHooks();
  const items = new Map(); // id -> gates of the roll
  const ref = { k: 'stat', kind: 'travel', cls: 'all' };
  const m1 = new Machine(tml, {
    tml, linear: true, noDead: true, phi: true, maxDepth: 0, budget: 400_000,
    onStaticLoad: (f) => prog.onStaticLoad(f) ?? tmlStaticLoadHook(f),
    onLoad: (recv, name) => (recv?.k === 'stat' ? (name === '@ind' ? 0 : UNKNOWN) : prog.onLoad(recv, name)),
    onStore(recv, name, val, ctx) {
      if (recv !== ref) return;
      for (const e of expandValue(val, ctx)) { const gates = siteGates(e.ctx); if (isNum(e.v) && e.v > 0) { const prev = items.get(e.v); if (!prev || gates.length < prev.length) items.set(e.v, gates); } } // `if (Main.hardMode) item = X` in the roll itself
    },
    onCall(callee, args, ctx) {
      const h = tmlStaticHook(callee, args, ctx);
      if (h !== undefined) return h;
      if (/^(NextFromList|SelectRandom)$/.test(callee.name)) { const arr = args.find((a) => a?.k === 'arr'); return arr ? { k: 'oneof', items: arr.items.filter(isNum) } : UNKNOWN; }
      return prog.onCall(callee);
    },
  });
  const sig = tml.methodSig(getItem);
  const args = sig.params.map((p) => (p.et === ET.BYREF ? ref : UNKNOWN));
  try { m1.run(getItem, undefined, args, tml); } catch (e) { if (process.env.TL_STRICT) throw e; }
  // per-item requirements: `case 2275: return Main.hardMode;` / `if (item == X && !downedY) return false;`
  const conds = new Map();
  if (canAdd) {
    const m2 = new Machine(tml, {
      tml, linear: true, noDead: true, maxDepth: 0, budget: 200_000,
      onStaticLoad: (f) => prog.onStaticLoad(f) ?? tmlStaticLoadHook(f),
      onLoad: (recv, name) => prog.onLoad(recv, name),
      onCall(callee, a, ctx) { const h = tmlStaticHook(callee, a, ctx); return h !== undefined ? h : prog.onCall(callee); },
      onReturn(v, ctx) {
        const ids = (ctx.cases ?? []).filter((c) => c.slot === 0 && isNum(c.value)).map((c) => c.value);
        if (!ids.length) return;
        let gates = null;
        if (v?.k === 'flag') gates = [...siteGates(ctx), (v.neg ? '!' : '') + v.name, ...(v.also ?? [])];
        else if (v === 0) gates = (ctx.condTags ?? []).filter((t) => t.startsWith('!')).map((t) => t.slice(1)); // returns false unless the flags hold
        else gates = siteGates(ctx);
        for (const id of ids) { const prev = conds.get(id); if (!prev || gates.length < prev.length) conds.set(id, gates); }
      },
    });
    try { m2.run(canAdd, undefined, [{ k: 'key', slot: 0 }], tml); } catch (e) { if (process.env.TL_STRICT) throw e; }
  }
  for (const [id, rollGates] of items) { const cond = [...new Set([...rollGates, ...(conds.get(id) ?? [])])].filter((g) => !g.startsWith('!')); out.push(cond.length ? { npc: 'v:368', item: `v:${id}`, cond } : { npc: 'v:368', item: `v:${id}` }); }
  return out;
}
