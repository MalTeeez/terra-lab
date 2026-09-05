/**
 * Fishing catches as sources.
 *
 * Vanilla: `Projectile.FishingCheck_RollItemDrop(ref FishingAttempt)` walked linearly - every
 * `attempt.rolledItemDrop = X` (and `NextFromList(...)` pick) is tagged with the flags around it
 * (`Main.hardMode` for hardmode crates, `Player.ZoneX` biomes, `NPC.downedBoss3` ...).
 * Mods: `ModPlayer.CatchFish(attempt, ref itemDrop, ...)` and the helpers it calls with the same
 * `ref int` - stores through that ref are the catches.
 */
import { decodeIL } from '../clr/il.js';
import { ET } from '../clr/sig.js';
import { Machine, THIS, UNKNOWN, isNum, tmlStaticHook, tmlStaticLoadHook } from './interp.js';
import { expandValue, progressionHooks, siteGates } from './flags.js';
import { TYPE_ABSTRACT, derivesFromTml, refId } from './util.js';

const push = (out, item, ctx, via) => {
  if (!item) return;
  const gates = siteGates(ctx);
  out.push(gates.length ? { item, cond: gates, via } : { item, via });
};
const itemsOf = (asm, v) => {
  if (isNum(v) && v > 0) return [`v:${v}`];
  if (v?.k === 'type' && v.fn === 'ItemType') return [refId(asm, v)];
  if (v?.k === 'arr' || v?.k === 'oneof') return v.items.flatMap((x) => itemsOf(asm, x));
  return [];
};

/** @returns {Array<{ item: string, cond?: string[], via: string }>} */
export function extractVanillaFishing(tml) {
  const out = [];
  const td = tml.typeByName.get('Terraria.Projectile');
  const m = td?.methods.find((x) => x.name === 'FishingCheck_RollItemDrop' && tml.methodBody(x));
  if (!m) return out;
  const prog = progressionHooks();
  const attempt = { k: 'obj', name: 'attempt', props: {} };
  const machine = new Machine(tml, {
    tml,
    linear: true,
    noDead: true,
    phi: true,
    maxDepth: 0,
    budget: 400_000,
    onStaticLoad: (f) => prog.onStaticLoad(f) ?? tmlStaticLoadHook(f),
    onLoad: (recv, name) => prog.onLoad(recv, name) ?? (recv === attempt ? UNKNOWN : undefined),
    onStore(recv, name, val, ctx) { if (recv === attempt && name === 'rolledItemDrop') for (const e of expandValue(val, ctx)) for (const it of itemsOf(tml, e.v)) push(out, it, e.ctx, 'fishing'); },
    onCall(callee, args, ctx) {
      const hooked = tmlStaticHook(callee, args, ctx);
      if (hooked !== undefined) return hooked;
      const p = prog.onCall(callee);
      if (p !== undefined) return p;
      if (/^(NextFromList|SelectRandom)$/.test(callee.name)) { const arr = args.find((a) => a?.k === 'arr'); return arr ? { k: 'oneof', items: arr.items } : UNKNOWN; }
      return undefined;
    },
  });
  try { machine.run(m, THIS, [{ k: 'ref', get: () => attempt, set: () => {} }], tml); } catch (e) { if (process.env.TL_STRICT) throw e; }
  return dedupe(out);
}

/**
 * The Angler's quest rewards (`Player.GetAnglerReward_MainReward` / `_Decoration`): every
 * `reward.type = X` in the branch tree. Those branches are quest counts rather than progression,
 * so his accessories are pre-boss — which is what makes them fishing catches and not a rarity guess.
 * @returns {Array<{ item: string, cond?: string[], via: string }>}
 */
export function extractAnglerRewards(tml) {
  const out = [];
  const td = tml.typeByName.get('Terraria.Player');
  const prog = progressionHooks();
  for (const name of ['GetAnglerReward_MainReward', 'GetAnglerReward_Decoration']) {
    const m = td?.methods.find((x) => x.name === name && tml.methodBody(x));
    if (!m) continue;
    const machine = new Machine(tml, {
      tml, linear: true, noDead: true, phi: true, maxDepth: 1, budget: 400_000,
      onStaticLoad: (f) => prog.onStaticLoad(f) ?? tmlStaticLoadHook(f),
      onLoad: (recv, field) => prog.onLoad(recv, field),
      onStore(recv, field, val, ctx) {
        if (field !== 'type' || recv?.k !== 'obj' || !/Terraria\.Item$/.test(recv.name ?? '')) return;
        for (const e of expandValue(val, ctx)) for (const it of itemsOf(tml, e.v)) push(out, it, e.ctx, 'an Angler quest');
      },
      onCall(callee, args, ctx) {
        const hooked = tmlStaticHook(callee, args, ctx);
        if (hooked !== undefined) return hooked;
        // `reward.SetDefaults(2428)` is the same statement written the other way
        if (callee.name === 'SetDefaults' && ctx.recv?.k === 'obj' && /Terraria\.Item$/.test(ctx.recv.name ?? '')) {
          for (const e of expandValue(args[0], ctx)) for (const it of itemsOf(tml, e.v)) push(out, it, e.ctx, 'an Angler quest');
          return undefined;
        }
        return prog.onCall(callee);
      },
    });
    try { machine.run(m, THIS, tml.methodSig(m).params.map(() => UNKNOWN), tml); } catch (e) { if (process.env.TL_STRICT) throw e; }
  }
  return dedupe(out);
}

/** Enemies that spawn from the bobber (`FishingCheck_RollEnemySpawns`: Zombie Merman on a blood moon …). */
export function extractVanillaFishingEnemies(tml) {
  const out = [];
  const td = tml.typeByName.get('Terraria.Projectile');
  const m = td?.methods.find((x) => x.name === 'FishingCheck_RollEnemySpawns' && tml.methodBody(x));
  if (!m) return out;
  const prog = progressionHooks();
  const attempt = { k: 'obj', name: 'attempt', props: {} };
  const machine = new Machine(tml, {
    tml, linear: true, noDead: true, phi: true, maxDepth: 0, budget: 200_000,
    onStaticLoad: (f) => prog.onStaticLoad(f) ?? tmlStaticLoadHook(f),
    onLoad: (recv, name) => prog.onLoad(recv, name) ?? (recv === attempt ? UNKNOWN : undefined),
    onStore(recv, name, val, ctx) {
      if (recv !== attempt || name !== 'rolledEnemySpawn') return;
      for (const e of expandValue(val, ctx)) if (isNum(e.v) && e.v > 0) out.push({ npc: `v:${e.v}`, gates: siteGates(e.ctx), mod: 'v' });
    },
    onCall(callee, args, ctx) {
      const h = tmlStaticHook(callee, args, ctx);
      if (h !== undefined) return h;
      if (/^(NextFromList|SelectRandom)$/.test(callee.name)) { const arr = args.find((a) => a?.k === 'arr'); return arr ? { k: 'oneof', items: arr.items } : UNKNOWN; }
      return prog.onCall(callee);
    },
  });
  try { machine.run(m, THIS, [{ k: 'ref', get: () => attempt, set: () => {} }], tml); } catch (e) { if (process.env.TL_STRICT) throw e; }
  return out;
}

/** @returns {Array<{ item: string, cond?: string[], via: string }>} */
export function extractModFishing(asm, { tml, modId }) {
  const out = [];
  const prog = progressionHooks();
  for (const td of asm.types) {
    if (td.flags & TYPE_ABSTRACT) continue;
    if (td.name.includes('`') || td.name.startsWith('<')) continue;
    if (!derivesFromTml(asm, td, 'ModPlayer')) continue;
    const root = td.methods.find((x) => x.name === 'CatchFish' && asm.methodBody(x));
    if (!root) continue;
    // the hook plus the helpers it calls on the same type that take the attempt / ref int along;
    // a helper inherits the flags around its call (`if (planetarium) CatchFish_Planetarium(...)`)
    const methods = new Map([[root, []]]);
    const helperOf = (callee) => { const d = callee.def; return d && d.declaringType === td && asm.methodBody(d) && asm.methodSig(d).params.some((p) => p.et === ET.BYREF) ? d : null; };
    {
      const scout = new Machine(asm, {
        tml, concreteType: td, linear: true, noDead: true, maxDepth: 0, budget: 200_000,
        onStaticLoad: (f) => prog.onStaticLoad(f) ?? tmlStaticLoadHook(f),
        onLoad: (recv, name) => prog.onLoad(recv, name) ?? UNKNOWN,
        onCall(callee, cargs, ctx) {
          const h = tmlStaticHook(callee, cargs, ctx);
          if (h !== undefined) return h;
          const d = helperOf(callee);
          if (d) { const g = siteGates(ctx); const prev = methods.get(d); if (!prev || g.length < prev.length) methods.set(d, g); return UNKNOWN; }
          return prog.onCall(callee);
        },
      });
      try { scout.run(root, THIS, asm.methodSig(root).params.map(() => UNKNOWN), asm); } catch (e) { if (process.env.TL_STRICT) throw e; }
    }
    for (const [md, callTags] of methods) {
      const sig = asm.methodSig(md);
      const args = sig.params.map((p) => (p.et === ET.BYREF ? { k: 'stat', kind: 'fishref', cls: 'all' } : { k: 'obj', name: 'attempt', props: {} }));
      let first = true;
      const machine = new Machine(asm, {
        tml,
        concreteType: td,
        linear: true,
        noDead: true,
        phi: true,
        maxDepth: 0,
        budget: 400_000,
        onStaticLoad: (f) => prog.onStaticLoad(f) ?? tmlStaticLoadHook(f),
        onLoad(recv, name) {
          const p = prog.onLoad(recv, name);
          if (p !== undefined) return p;
          if (recv?.k === 'stat') return name === '@ind' ? 0 : UNKNOWN;
          if (recv?.k === 'obj' && recv.name === 'attempt') return name === 'playerFishingConditions' ? { k: 'obj', name: 'conds', props: {} } : UNKNOWN;
          return undefined;
        },
        onStore(recv, name, val, ctx) {
          // the first by-ref int is `itemDrop`; the second (`npcSpawn`) is ignored
          if (recv?.k === 'stat' && recv === args.find((a) => a?.k === 'stat')) for (const e of expandValue(val, { ...ctx, condTags: [...callTags, ...(ctx.condTags ?? [])] })) for (const it of itemsOf(asm, e.v)) push(out, it, e.ctx, 'fishing');
        },
        onCall(callee, cargs, ctx) {
          const hooked = tmlStaticHook(callee, cargs, ctx);
          if (hooked !== undefined) return hooked;
          const p = prog.onCall(callee);
          if (p !== undefined) return p;
          if (/^(NextFromList|SelectRandom)$/.test(callee.name)) { const arr = cargs.find((a) => a?.k === 'arr'); return arr ? { k: 'oneof', items: arr.items } : UNKNOWN; }
          return undefined;
        },
      });
      void first;
      try { machine.run(md, THIS, args, asm); } catch { /* keep going */ }
    }
  }
  return dedupe(out).map((d) => ({ ...d, mod: modId }));
}

function dedupe(list) {
  const seen = new Map();
  const out = [];
  for (const d of list) {
    const prev = seen.get(d.item);
    if (prev) { if (prev.cond && !d.cond) delete prev.cond; continue; }
    seen.set(d.item, d);
    out.push(d);
  }
  return out;
}
