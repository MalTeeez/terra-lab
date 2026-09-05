/**
 * Id-keyed reward tables.
 *
 * A mod hands an item over inside one big `switch (dialogueId)` / `if (questId == 12)` method, and
 * what decides *when* is somewhere else entirely: the call site that starts dialogue 103 is the one
 * standing behind `if (NPC.downedQueenBee)`. The two halves are joined only by the number.
 *
 * So: find the tables (a method that gives different items out for different values of one of its
 * int parameters), then find the dispatch that feeds them (a method that calls the same thing over
 * and over with those same numbers, each call under its own gate) and take the flags from there.
 * Stars Above hands out all 109 of its Essences this way — nothing else in the mod names them.
 */
import { ET } from '../clr/sig.js';
import { decodeIL, ldcValue } from '../clr/il.js';
import { Machine, UNKNOWN, THIS, isNum, tmlStaticHook, tmlStaticLoadHook } from './interp.js';
import { progressionHooks, siteGates } from './flags.js';
import { TYPE_ABSTRACT, refId } from './util.js';

const GIVE_RE = /^(QuickSpawnItem|QuickSpawnItemDirect|QuickSpawnClonedItem|GiveItem|NewItem)$/;
const MIN_KEYS = 3; // fewer than this is an ordinary method with a couple of magic numbers, not a table
/** A plausible dispatch id: small enough to be a table key, big enough not to be a flag or a count. */
const isId = (v) => isNum(v) && v > 2 && v < 100000 && Number.isInteger(v);

/**
 * @returns {Array<{ item: string, cond: string[], via: string }>}
 */
export function extractIdRewards(asm, { tml, modId }) {
  const tables = []; // { md, byKey: Map<number, Set<string>> }
  for (const td of asm.types) {
    if (td.flags & TYPE_ABSTRACT || td.name.startsWith('<')) continue;
    for (const md of td.methods) {
      const body = asm.methodBody(md);
      if (!body) continue;
      let ins;
      try { ins = decodeIL(body.il); } catch { continue; }
      if (!ins.some((x) => (x.op === 'call' || x.op === 'callvirt') && GIVE_RE.test(asm.resolve(x.operand)?.name ?? ''))) continue;
      const sig = asm.methodSig(md);
      // `ref int chosenDialogue` counts: Stars Above passes its dialogue id by reference
      const ints = sig.params.map((p, i) => (p.et === ET.I4 || p.et === ET.BYREF ? i : -1)).filter((i) => i >= 0);
      if (!ints.length || ints.length > 8) continue;
      let best = null;
      for (const slot of ints) {
        const byKey = runTable(asm, tml, md, sig, slot, modId);
        if (byKey.size >= MIN_KEYS && (!best || byKey.size > best.size)) best = byKey;
      }
      if (best) tables.push({ md, byKey: best });
    }
  }
  if (!tables.length) return [];

  // the dispatch side: gates per key, from methods that fire the same call with many different ids
  const keys = new Set(tables.flatMap((t) => [...t.byKey.keys()]));
  const gatesByKey = dispatchGates(asm, tml, keys);
  if (process.env.TL_TRACE_REWARDS) console.log(`rewards ${modId}: ${tables.length} tables, ${keys.size} ids, ${gatesByKey.size} gated`, tables.map((t) => `${t.md.declaringType.name}::${t.md.name} ${t.byKey.size}`).join(' | '), '\n  ungated ids:', [...keys].filter((k) => !gatesByKey.has(k)).join(','));
  const out = [];
  for (const t of tables) {
    for (const [key, items] of t.byKey) {
      const gates = gatesByKey.get(key);
      if (!gates?.length) continue;
      const via = t.md.declaringType.name.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
      for (const item of items) out.push({ item, cond: gates, via });
    }
  }
  return out;
}

/** One run of a reward method with parameter `slot` as the key: which items each value hands out. */
function runTable(asm, tml, md, sig, slot, modId) {
  const byKey = new Map();
  const key = { k: 'key', slot: 0 };
  const args = sig.params.map((p, i) => {
    if (i === slot) return p.et === ET.BYREF ? { k: 'ref', get: () => key, set: () => {} } : key;
    // the mod the dialogue looks its items up in is a parameter of the method, not a static
    const name = asm.paramNames(md)[i] ?? '';
    if (/^mod$/i.test(name)) return { k: 'mod', name: modId };
    return UNKNOWN;
  });
  const machine = new Machine(asm, {
    tml,
    concreteType: md.declaringType,
    linear: true,
    noDead: true,
    maxDepth: 2,
    budget: 600_000,
    onStaticLoad: (f) => tmlStaticLoadHook(f),
    onCall(callee, cargs, ctx) {
      const hooked = tmlStaticHook(callee, cargs, ctx);
      if (hooked !== undefined) return hooked;
      if (!GIVE_RE.test(callee.name)) return undefined;
      const t = cargs.find((a) => a?.k === 'type' && a.fn === 'ItemType');
      const item = t ? refId(asm, t) : null;
      if (!item) return UNKNOWN;
      for (const c of ctx.cases ?? []) {
        if (c.slot !== 0 || !isNum(c.value)) continue;
        let s = byKey.get(c.value);
        if (!s) byKey.set(c.value, (s = new Set()));
        s.add(item);
      }
      return UNKNOWN;
    },
  });
  try { machine.run(md, THIS, args, asm); } catch { /* partial is fine */ }
  return byKey;
}

/**
 * The dispatch's own bookkeeping, straight off the IL.
 *
 * `if (SkeletonDialogue == 2) SetupActiveDialogue(ref …, 101, ref SkeletonWeaponDialogue, …)` says
 * two things: dialogue 101 is behind whatever set `SkeletonDialogue`, and 101 is what sets
 * `SkeletonWeaponDialogue` in turn. Chaining those hands each conversation the flags of the one
 * that unlocked it. Only the plain compiled shape is read — `ldfld F; ldc n; ceq; …; brfalse END`
 * for the guard, an `ldflda` among the call's arguments for what the call advances.
 */
function scanProgressChain(asm, ins, guards, owner) {
  const open = []; // { field, end } — progress guards the walk is currently inside
  const fieldName = (x) => { try { const d = asm.resolve(x.operand); return d?.declaringType ? `${d.declaringType.fullName}::${d.name}` : null; } catch { return null; } };
  for (let i = 0; i < ins.length; i++) {
    const x = ins[i];
    while (open.length && open[open.length - 1].end <= x.offset) open.pop();
    // `ldfld F; ldc n; ceq; stloc; ldloc; brfalse END`  (a `brtrue` there is the negation: not a gate)
    if (x.op === 'ldfld' && /^ldc\.i4/.test(ins[i + 1]?.op ?? '') && ins[i + 2]?.op === 'ceq') {
      const br = ins.slice(i + 3, i + 7).find((y) => /^br(true|false)/.test(y.op));
      const f = fieldName(x);
      if (f && br && /^brfalse/.test(br.op) && br.operand > x.offset) open.push({ field: f, end: br.operand });
      continue;
    }
    if (x.op !== 'call' && x.op !== 'callvirt') continue;
    // the arguments of this call: everything since the previous call, up to 24 instructions back
    let start = i - 1;
    while (start > 0 && i - start < 24 && !/^(call|callvirt|newobj)$/.test(ins[start].op)) start--;
    let key = null;
    let advances = null;
    for (let k = start + 1; k < i; k++) {
      const v = ldcValue(ins[k]);
      if (isId(v) && (key === null || v > key)) key = v; // the id, not the `0`/`1` flags beside it
      if (ins[k].op === 'ldflda') advances = fieldName(ins[k]) ?? advances;
    }
    if (key === null) continue;
    if (open.length && !guards.has(key)) guards.set(key, open.map((o) => o.field));
    if (advances && !owner.has(advances)) owner.set(advances, key);
  }
}

/**
 * Gates per id, read off the dispatch: a method that calls one thing at least `MIN_KEYS` times with
 * different constants is an id table, and each call carries the flags of the block it sits in.
 * Anything else that happens to mention the number is not evidence and is left alone.
 */
function dispatchGates(asm, tml, keys) {
  const found = []; // one entry per (method, callee, argument) that looks like a dispatch
  const guards = new Map(); // id → the mod's own progress fields its block is behind
  const owner = new Map();  // progress field → the id that advances it
  const prog = progressionHooks();
  for (const td of asm.types) {
    if (td.name.startsWith('<')) continue;
    for (const md of td.methods) {
      const body = asm.methodBody(md);
      if (!body) continue;
      let ins;
      try { ins = decodeIL(body.il); } catch { continue; }
      // cheap prefilter: does this body push several of the keys as constants?
      const seen = new Set();
      for (const x of ins) { const v = ldcValue(x); if (keys.has(v)) seen.add(v); }
      if (seen.size < MIN_KEYS) continue;
      const perCallee = new Map(); // callee name → Map(argIndex → Set(constants))
      const machine = new Machine(asm, {
        tml,
        concreteType: td,
        linear: true,
        noDead: true,
        maxDepth: 0,
        budget: 2_000_000,
        onStaticLoad: (f) => prog.onStaticLoad(f) ?? tmlStaticLoadHook(f),
        onLoad: (recv, name) => prog.onLoad(recv, name),
        onCall(callee, cargs, ctx) {
          const hooked = tmlStaticHook(callee, cargs, ctx);
          if (hooked !== undefined) return hooked;
          for (let i = 0; i < cargs.length; i++) {
            // every id the dispatch fires, not only the ones that hand an item over: the Starfarer's
            // Skeletron conversation gives nothing, and it is what unlocks the one that does
            if (!isId(cargs[i])) continue;
            let m = perCallee.get(callee.name);
            if (!m) perCallee.set(callee.name, (m = new Map()));
            let s = m.get(i);
            if (!s) m.set(i, (s = new Map()));
            const gates = siteGates(ctx).filter((g) => !g.startsWith('!'));
            const prev = s.get(cargs[i]);
            if (!prev || gates.length < prev.length) s.set(cargs[i], gates);
          }
          return prog.onCall(callee);
        },
      });
      try { machine.run(md, THIS, new Array(asm.methodSig(md).params.length).fill(UNKNOWN), asm); } catch { /* partial */ }
      scanProgressChain(asm, ins, guards, owner);
      for (const slots of perCallee.values()) for (const byConst of slots.values()) {
        if (byConst.size >= MIN_KEYS) found.push(byConst); // one magic number in an argument is not a dispatch
      }
    }
  }
  // the dispatch that knows the most ids is the one the table is keyed to; the others only fill
  // gaps, so a passing mention of the same number somewhere else cannot overrule it
  const out = new Map();
  for (const byConst of found.sort((a, b) => b.size - a.size)) {
    for (const [key, gates] of byConst) if (gates.length && !out.has(key)) out.set(key, gates);
  }
  // …and the ones behind no boss flag at all are usually behind the mod's own bookkeeping: the
  // Starfarer only offers this conversation once you have had the one before it. That earlier
  // conversation is the dialogue that advances the counter, and whatever gates *it* gates this too.
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const [id, fields] of guards) {
      if (out.has(id)) continue;
      // (a counter nothing else in the dispatch advances is bookkeeping this cannot follow; the
      // ones it can still gate the conversation, so they are taken and the rest left alone)
      const gates = [];
      for (const f of fields) {
        const src = owner.get(f);
        const g = src !== undefined && src !== id ? out.get(src) : null;
        if (g) gates.push(...g);
      }
      if (gates.length) { out.set(id, [...new Set(gates)]); changed = true; }
    }
    if (!changed) break;
  }
  return out;
}
