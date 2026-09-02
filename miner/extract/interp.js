/**
 * Straight-line symbolic interpreter for CIL.
 *
 * It evaluates a method body with a value stack, locals and arguments, following
 * forward unconditional branches and falling through conditional ones, so a method
 * like `SetDefaults` yields "last store wins" constants. Calls into the same assembly
 * (or into tModLoader's `Item` helpers) are inlined a few levels deep, which is what
 * makes base-class patterns (`SafeSetDefaults`, `SetBardDefaults`, `BaseWings`) and
 * helpers (`Item.sellPrice`, `DefaultToRangedWeapon`, `MinutesToFrames`) resolve.
 *
 * In `linear` mode nothing is followed: every instruction is visited once in order,
 * and a *case tracker* attributes stores to the items being compared against:
 *   switch (type - K)            item ids
 *   item.type == N               item ids / ModContent.ItemType<T>() / mod.Find<ModItem>("X").Type
 *   item.ModItem.Name == "X"     class names (with an optional `Mod.Name == "M"` guard)
 *   item.ModItem is X            types
 *   GetType().Namespace.StartsWith("…")   namespaces
 *   _armor[0].type == X && …     several slots at once (vanilla armor sets)
 * Conditions whose value is known (mod configs, ModLoader.HasMod) prune the path; difficulty
 * flags (expert, master, revengeance, death, …) tag the region so consumers can keep
 * such stores as variants.
 *
 * Values:
 *   number | string | null
 *   { k:'this' }                      the ModItem/ModNPC/GlobalItem instance being analysed
 *   { k:'item' }                      the ModItem's own `Item`
 *   { k:'player' }                    the Player argument of Update* hooks
 *   { k:'modplayer', name }           player.GetModPlayer<T>()
 *   { k:'stat', kind, cls }           ref to a StatModifier / float stat on the player
 *   { k:'itemarg', slot }             the Item parameter of a GlobalItem hook (a case key source)
 *   { k:'moditem', slot }             itemArg.ModItem
 *   { k:'prop', slot, path }          a property chain off the key (Name, Mod.Name, GetType().Namespace …)
 *   { k:'keycmp', slot, match, neg }  a boolean comparing a key property with a constant
 *   { k:'key', slot, offset }         a case-tracked id (vanilla `type`, armor slots)
 *   { k:'flag', name }                a difficulty / mode flag (unknown at mine time)
 *   { k:'mod', name }                 a Mod instance from ModLoader.GetMod / TryGetMod
 *   { k:'type', fn, name, id? }       ModContent.ItemType<T>() etc.
 *   { k:'dc', name, full }            a DamageClass instance
 *   { k:'arr', items:[] }             array built with newarr/stelem
 *   { k:'obj', name, props:{} }       something constructed with newobj / a local struct
 *   { k:'ref', get, set }             a byref (ldloca / ldarga / hook-provided)
 *   UNKNOWN
 */
import { decodeIL, ldcValue } from '../clr/il.js';

export const UNKNOWN = Object.freeze({ k: '?' });
export const THIS = Object.freeze({ k: 'this' });
export const ITEM = Object.freeze({ k: 'item' });
export const PLAYER = Object.freeze({ k: 'player' });

export const isNum = (v) => typeof v === 'number';
export const isKnown = (v) => v !== UNKNOWN && v !== undefined;

const BINOPS = {
  add: (a, b) => a + b, sub: (a, b) => a - b, mul: (a, b) => a * b,
  // IL carries no operand types here; constant int arithmetic is folded by the compiler,
  // so runtime division is almost always float (`x / 100f`). A following conv.i4 truncates.
  div: (a, b) => a / b,
  rem: (a, b) => a % b, and: (a, b) => a & b, or: (a, b) => a | b, xor: (a, b) => a ^ b,
  shl: (a, b) => a << b, shr: (a, b) => a >> b, 'shr.un': (a, b) => a >>> b,
  'add.ovf': (a, b) => a + b, 'sub.ovf': (a, b) => a - b, 'mul.ovf': (a, b) => a * b,
  'add.ovf.un': (a, b) => a + b, 'sub.ovf.un': (a, b) => a - b, 'mul.ovf.un': (a, b) => a * b,
  'div.un': (a, b) => a / b, 'rem.un': (a, b) => a % b,
};
const CMP = { ceq: (a, b) => a === b, cgt: (a, b) => a > b, clt: (a, b) => a < b, 'cgt.un': (a, b) => a > b, 'clt.un': (a, b) => a < b };
const BR_CMP = { beq: (a, b) => a === b, bne: (a, b) => a !== b, bge: (a, b) => a >= b, bgt: (a, b) => a > b, ble: (a, b) => a <= b, blt: (a, b) => a < b };
const EQ_BRANCH = /^beq/;
const NE_BRANCH = /^bne/;
const POP2_BRANCH = /^(beq|bge|bgt|ble|blt|bne)/;
const RANGE_BRANCH = /^(bge|bgt|ble|blt)/;
const POP1_BRANCH = /^(brtrue|brfalse)/;
const TERMINATORS = new Set(['ret', 'br', 'br.s', 'throw', 'rethrow', 'leave', 'leave.s', 'switch', 'jmp']);

/** Static fields / getters whose value depends on the world's difficulty or mode. */
export const FLAG_NAMES = /^(expertMode|masterMode|revenge|death|malice|bossRushActive|EternityMode|MasochistMode|InfernumActive|InfernumMode|IsInfernum|CanUseCustomAIs)$/i;
const flagKey = (n) => n.replace(/^(get_)?/, '').replace(/Mode$|Active$/, '').toLowerCase();

const sameKey = (a, b) => a.slot === b.slot && a.value === b.value && a.lo === b.lo && a.hi === b.hi && JSON.stringify(a.match) === JSON.stringify(b.match);
/** Keys of one slot come in kinds (an id, a class name, a mod name …); a new key replaces only its own kind. */
const keyKind = (k) => (k.match ? Object.keys(k.match)[0] : 'id');
const others = (g, k) => g.filter((c) => !(c.slot === k.slot && keyKind(c) === keyKind(k)));
const sameGroup = (g, h) => g.length === h.length && g.every((k) => h.some((x) => sameKey(x, k)));

export class Machine {
  /**
   * @param {import('../clr/metadata.js').Assembly} asm
   * @param {object} opts
   * @param {import('../clr/metadata.js').Assembly} [opts.tml]   tModLoader assembly for inlining Item helpers
   * @param {object} [opts.concreteType]  TypeDef of the concrete object `this` refers to (virtual dispatch)
   * @param {(receiver, name, value, ctx) => void} [opts.onStore]     stfld / property setter / stind sink
   * @param {(receiver, name, ctx) => any} [opts.onLoad]              ldfld / property getter source
   * @param {(callee, args, ctx) => any} [opts.onCall]                 return a value to short-circuit a call
   * @param {(callee, args, ctx) => any} [opts.onNew]                  return a value to replace a constructed object
   * @param {(field) => any} [opts.onStaticLoad]
   * @param {(value, ctx) => void} [opts.onReturn]                     linear mode: every `ret` with a value
   * @param {(ins, a, b, op, ctx) => void} [opts.onBackJump]           backward conditional jump (loop) with its compared values
   * @param {Set<string>} [opts.enabledMods]                            resolves ModLoader.HasMod / TryGetMod
   * @param {boolean} [opts.linear]  visit every instruction once, never jump (case tracking)
   * @param {number} [opts.maxDepth]
   * @param {number} [opts.budget]   max instructions per machine
   */
  constructor(asm, opts = {}) {
    this.asm = asm;
    this.tml = opts.tml ?? null;
    this.concreteType = opts.concreteType ?? null;
    this.onStore = opts.onStore ?? (() => {});
    this.onLoad = opts.onLoad ?? (() => undefined);
    this.onCall = opts.onCall ?? (() => undefined);
    this.onNew = opts.onNew ?? (() => undefined);
    this.onStaticLoad = opts.onStaticLoad ?? (() => undefined);
    this.onReturn = opts.onReturn ?? (() => {});
    /** linear mode: every backward conditional jump (a loop) with the two compared values */
    this.onBackJump = opts.onBackJump ?? null;
    this.enabledMods = opts.enabledMods ?? null;
    this.linear = opts.linear ?? false;
    this.maxDepth = opts.maxDepth ?? 5;
    this.budget = opts.budget ?? 60000;
    this.used = 0;
    this.itemTypeDef = this.tml?.typeByName.get('Terraria.Item') ?? null;
    this.statics = new Map(); // TypeDef → Map<fieldName, value>
    this._staticCapture = null;
    this._thisFields = null; // Map<fieldName, value> from the concrete type's constructor
    this._thisCapture = null;
    /** Case tracker state: the keys the current block is guarded by (flat). */
    this.cases = [];
    /** The same as alternatives: each group is one complete key combination. */
    this.caseGroups = [];
    /** `type = N` inside a case block: those cases take N's defaults. */
    this.keyAliases = [];
    /** linear mode: inside a nested if/else within the current case block */
    this.conditional = false;
    /** linear mode: difficulty/mode flags guarding the current instruction */
    this.condTags = [];
    /** linear mode: inside a block a known-false condition skips */
    this.dead = false;
  }

  /** Run a MethodDef of `owner` with the given this/args. */
  run(method, thisVal, args = [], owner = this.asm, depth = 0) {
    const body = owner.methodBody(method);
    if (!body) return UNKNOWN;
    const sig = owner.methodSig(method);
    let ins;
    try {
      ins = decodeIL(body.il);
    } catch {
      return UNKNOWN;
    }
    const byOffset = new Map(ins.map((x, i) => [x.offset, i]));
    const stack = [];
    const locals = [];
    const argv = sig.hasThis ? [thisVal, ...args] : [...args];
    const pop = () => (stack.length ? stack.pop() : UNKNOWN);
    const push = (v) => stack.push(v === undefined ? UNKNOWN : v);
    const caseMap = this.linear ? new Map() : null; // offset → groups[] (each a keys[])
    const addGroup = (offset, group) => {
      const list = caseMap.get(offset) ?? [];
      if (!list.some((g) => sameGroup(g, group))) list.push(group);
      caseMap.set(offset, list);
    };
    const setGroups = (groupsIn) => {
      const groups = [];
      for (const g of groupsIn) if (!groups.some((h) => sameGroup(h, g))) groups.push(g);
      this.caseGroups = groups;
      const flat = [];
      for (const g of groups) for (const k of g) if (!flat.some((c) => sameKey(c, k))) flat.push(k);
      this.cases = flat;
    };
    const ctxBase = { owner, method, depth, machine: this };
    let pc = 0;
    const ctx = () => ({ ...ctxBase, cases: this.cases, caseGroups: this.caseGroups, conditional: this.conditional, condTags: this.condTags, offset: ins[pc]?.offset, region: regions.length ? regions[regions.length - 1].end : null });
    // linear mode: the stack a jump would arrive with, per target offset
    const stackAt = caseMap ? new Map() : null;
    // …and the key context a *conditional* jump carries: the keys guarding the branch itself
    // stay valid on both paths (`if (mod == "X") { if (spear) …; else return CountsAs(Melee); }`).
    const groupsAt = caseMap ? new Map() : null;
    const noteJump = (target, withGroups = false, groups = this.caseGroups) => {
      if (!stackAt) return;
      if (!stackAt.has(target)) stackAt.set(target, [...stack]);
      if (withGroups && !groupsAt.has(target)) groupsAt.set(target, groups.map((g) => [...g]));
    };
    // linear mode: forward conditional jumps open a region whose stores are "conditional"
    const regions = []; // { end, tag, groups } — groups = the key context the if statement sits in
    const openRegion = (target, tag = null) => { if (caseMap && target > 0) regions.push({ end: target, tag, groups: this.caseGroups.map((g) => [...g]) }); };
    // linear mode: a branch with a known outcome does not jump (that would skip the other cases of
    // a keyed method); the block it skips is dead while the key context stays the same.
    const groupsKey = () => JSON.stringify(this.caseGroups);
    const openDead = (target) => { if (caseMap && target > x0.offset) regions.push({ end: target, tag: null, dead: true, key: groupsKey(), groups: [] }); };
    let x0 = { offset: 0 };
    // `if (key == N) { … }` compiles to `bne.un END`: at END the key condition is over.
    const releaseAt = caseMap ? new Map() : null;
    const releaseKey = (offset, key) => {
      const list = releaseAt.get(offset) ?? [];
      list.push(key);
      releaseAt.set(offset, list);
    };
    const dropKey = (g, key) => g.filter((c) => !(c.slot === key.slot && (key.value !== undefined ? c.value === key.value : key.match ? JSON.stringify(c.match) === JSON.stringify(key.match) : c.value === undefined && !c.match)));
    void dropKey;
    const jumpTo = (target) => { if (target > 0 && byOffset.has(target)) { pc = byOffset.get(target) - 1; return true; } return false; };
    /** A key comparison decided the branch: bne-like (fallthrough = match) or beq-like (target = match). */
    const applyKeyBranch = (k, target, targetIsMatch) => {
      const groups = this.caseGroups.length ? this.caseGroups : [[]];
      if (targetIsMatch) for (const g of groups) addGroup(target, [...others(g, k), k]);
      else { setGroups(groups.map((g) => [...others(g, k), k])); if (target > 0) releaseKey(target, k); }
    };

    for (pc = 0; pc < ins.length; pc++) {
      if (++this.used > this.budget) return UNKNOWN;
      const x = ins[pc];
      const op = x.op;

      x0 = x;
      if (caseMap) {
        for (let i = regions.length - 1; i >= 0; i--) if (regions[i].end <= x.offset || (regions[i].dead && regions[i].key !== groupsKey())) regions.splice(i, 1);
        this.dead = regions.some((r) => r.dead);
        this.conditional = regions.some((r) => !r.dead);
        this.condTags = regions.map((r) => r.tag).filter(Boolean);
        const prev = pc > 0 ? ins[pc - 1].op : 'ret';
        const released = releaseAt.get(x.offset);
        if (released && !TERMINATORS.has(prev)) {
          let groups = this.caseGroups;
          for (const key of released) groups = groups.map((g) => dropKey(g, key));
          setGroups(groups.filter((g) => g.length));
        }
        if (TERMINATORS.has(prev)) {
          // only reachable by a jump: restore the stack that jump carried (or nothing)
          const saved = stackAt.get(x.offset);
          stack.length = 0;
          if (saved) stack.push(...saved);
        }
        const mapped = caseMap.get(x.offset);
        if (mapped) setGroups(TERMINATORS.has(prev) ? [...mapped] : [...this.caseGroups, ...mapped]);
        else if (TERMINATORS.has(prev)) setGroups(groupsAt.get(x.offset) ?? []);
        // (a terminator keeps its groups while it executes — `ret value` reports them — and
        // the next instruction starts from what its own jump sources carried)
      }

      if (this.trace) this.trace(x, stack, this.caseGroups, regions);
      const v = ldcValue(x);
      if (v !== undefined) { push(v); continue; }
      switch (op) {
        case 'nop': case 'break': case 'volatile.': case 'tail.': case 'readonly.': case 'unaligned.': case 'constrained.': case 'no.': case 'endfinally': case 'endfilter':
          continue;
        case 'ldc.i8': push(Number(x.operand)); continue;
        case 'ldc.r4': case 'ldc.r8': push(x.operand); continue;
        case 'ldnull': push(null); continue;
        case 'ldstr': push(owner.userString(x.operand)); continue;
        case 'ldarg.0': case 'ldarg.1': case 'ldarg.2': case 'ldarg.3': push(argv[+op.slice(6)]); continue;
        case 'ldarg.s': case 'ldarg': push(argv[x.operand]); continue;
        case 'ldarga.s': case 'ldarga': {
          const i = x.operand;
          const cur = argv[i];
          push(cur?.k === 'ref' ? cur : { k: 'ref', get: () => argv[i], set: (v) => { argv[i] = v; } });
          continue;
        }
        case 'starg.s': case 'starg': {
          const val = pop();
          // `case 51: type = 52; goto case 52;` — keep the symbolic key, remember the alias.
          if (caseMap && argv[x.operand]?.k === 'key') {
            if (isNum(val) && this.cases.length) this.keyAliases.push({ from: this.cases.map((c) => c.value), to: val });
            continue;
          }
          argv[x.operand] = val;
          continue;
        }
        case 'ldloc.0': case 'ldloc.1': case 'ldloc.2': case 'ldloc.3': push(locals[+op.slice(6)]); continue;
        case 'ldloc.s': case 'ldloc': push(locals[x.operand]); continue;
        case 'ldloca.s': case 'ldloca': {
          const i = x.operand;
          if (locals[i] === undefined || locals[i] === UNKNOWN) locals[i] = { k: 'obj', name: 'local', props: {} };
          push({ k: 'ref', get: () => locals[i], set: (v) => { locals[i] = v; } });
          continue;
        }
        case 'stloc.0': case 'stloc.1': case 'stloc.2': case 'stloc.3': locals[+op.slice(6)] = pop(); continue;
        case 'stloc.s': case 'stloc': locals[x.operand] = pop(); continue;
        case 'dup': { const t = pop(); push(t); push(t); continue; }
        case 'pop': pop(); continue;
        case 'ret':
          if (this.linear) {
            if (sig.ret.et !== 0x01) { const rv = pop(); if (!this.dead) this.onReturn(rv, ctx()); }
            stack.length = 0;
            continue;
          }
          return sig.ret.et === 0x01 ? undefined : pop();
        case 'throw': case 'rethrow': case 'jmp':
          if (this.linear) { stack.length = 0; continue; }
          return UNKNOWN;
        case 'br': case 'br.s': case 'leave': case 'leave.s': {
          if (this.linear) {
            // inside an if/else the join point keeps the keys the if statement had
            const inner = regions.length ? regions[regions.length - 1] : null;
            noteJump(x.operand, !!inner, inner?.groups ?? this.caseGroups);
            if (inner && x.operand > x.offset) openRegion(x.operand, inner.tag); // else-branch of an if
            stack.length = 0;
            continue;
          }
          if (x.operand > x.offset) jumpTo(x.operand);
          continue;
        }
        case 'switch': {
          const key = pop();
          if (caseMap) for (const t of x.operand) noteJump(t);
          if (caseMap && key?.k === 'key') {
            const rest = others(this.cases, { slot: key.slot });
            x.operand.forEach((target, i) => addGroup(target, [...rest, { slot: key.slot, value: i + (key.offset ?? 0) }]));
          } else if (!caseMap && isNum(key) && key >= 0 && key < x.operand.length) {
            jumpTo(x.operand[key]);
            continue;
          }
          if (caseMap) setGroups([]);
          continue;
        }
        case 'neg': { const a = pop(); push(isNum(a) ? -a : UNKNOWN); continue; }
        case 'not': { const a = pop(); push(isNum(a) ? ~a : UNKNOWN); continue; }
        case 'ldlen': { const a = pop(); push(a?.k === 'arr' ? a.items.length : UNKNOWN); continue; }
        case 'isinst': {
          const a = pop();
          if (a?.k === 'moditem') {
            const t = owner.resolve(x.operand);
            push({ k: 'keycmp', slot: a.slot, match: { is: t?.fullName ?? t?.name ?? '?' } });
          } else push(a);
          continue;
        }
        case 'box': case 'unbox': case 'unbox.any': case 'castclass': case 'mkrefany': case 'refanyval': continue;
        case 'ldobj': { const r = pop(); push(r?.k === 'ref' ? r.get() : r); continue; }
        case 'ldtoken': push({ k: 'token', token: x.operand }); continue;
        case 'initobj': { const r = pop(); if (r?.k === 'ref') r.set({ k: 'obj', name: 'struct', props: {} }); continue; }
        case 'stobj': { const v = pop(); const r = pop(); if (r?.k === 'ref') r.set(v); continue; }
        case 'cpobj': pop(); pop(); continue;
        case 'localloc': pop(); push(UNKNOWN); continue;
        case 'sizeof': case 'arglist': case 'refanytype': case 'ldftn': case 'ldvirtftn': push(UNKNOWN); continue;
        case 'ckfinite': continue;
        case 'calli': pop(); push(UNKNOWN); continue;
        case 'cpblk': case 'initblk': pop(); pop(); pop(); continue;
      }
      if (op.startsWith('conv.')) {
        const a = pop();
        if (!isNum(a)) { push(a?.k === 'key' || a?.k === 'adj' ? a : UNKNOWN); continue; }
        push(/conv\.(r4|r8|r\.un)/.test(op) ? a : Math.trunc(a));
        continue;
      }
      if (op in BINOPS) {
        const b = pop(); const a = pop();
        if (isNum(a) && isNum(b)) push(BINOPS[op](a, b));
        else if (op === 'sub' && a?.k === 'key' && isNum(b)) push({ ...a, offset: (a.offset ?? 0) + b });
        else if (op === 'add' && a?.k === 'stat' && isNum(b)) push({ ...a, delta: b });
        // `item.defense += 15` / `item.damage = (int)(item.damage * 1.2f)` on a keyed item
        else if ((a?.k === 'adj' || (a?.k === 'prop' && a.path?.length === 1)) && isNum(b) && /^(add|sub|mul|div)$/.test(op)) {
          const base = a.k === 'adj' ? a : { k: 'adj', slot: a.slot, field: a.path[0], add: 0, mul: 1 };
          const r = { ...base };
          if (op === 'add') r.add += b; else if (op === 'sub') r.add -= b; else if (op === 'mul') { r.mul *= b; r.add *= b; } else { r.mul /= b; r.add /= b; }
          push(r);
        }
        else push(UNKNOWN);
        continue;
      }
      if (op in CMP) {
        const b = pop(); const a = pop();
        if (isNum(a) && isNum(b)) push(CMP[op](a, b) ? 1 : 0);
        else if (op === 'ceq' && (a?.k === 'keycmp' || b?.k === 'keycmp') && (a === 0 || b === 0)) {
          const kc = a?.k === 'keycmp' ? a : b; // `x == false` negates
          push({ ...kc, neg: !kc.neg });
        } else if (op === 'ceq' && a?.k === 'key' && (isNum(b) || b?.k === 'type')) {
          push({ k: 'keycmp', slot: a.slot, match: null, value: isNum(b) ? b + (a.offset ?? 0) : b.id ?? b.name });
        } else if (op === 'ceq' && b?.k === 'key' && (isNum(a) || a?.k === 'type')) {
          push({ k: 'keycmp', slot: b.slot, match: null, value: isNum(a) ? a + (b.offset ?? 0) : a.id ?? a.name });
        } else if (op === 'ceq' && (a?.k === 'flag' || b?.k === 'flag')) push(a?.k === 'flag' ? a : b);
        else push(UNKNOWN);
        continue;
      }
      if (POP2_BRANCH.test(op)) {
        const b = pop(); const a = pop();
        const base = op.replace(/\.un|\.s/g, '');
        if (this.onBackJump && x.operand < x.offset) this.onBackJump(x, a, b, base, ctx());
        if (isNum(a) && isNum(b)) {
          // known outcome: take exactly one path (linear mode: the skipped block is dead instead)
          if (BR_CMP[base](a, b) && x.operand > x.offset) { noteJump(x.operand, true); if (this.linear && !process.env.TL_NO_DEAD) openDead(x.operand); else jumpTo(x.operand); }
          continue;
        }
        noteJump(x.operand, true);
        if (caseMap) {
          const key = a?.k === 'key' ? a : b?.k === 'key' ? b : null;
          if (!key && x.operand > x.offset) openRegion(x.operand, a?.k === 'flag' ? flagKey(a.name) : b?.k === 'flag' ? flagKey(b.name) : null);
          const other = key === a ? b : a;
          const val = isNum(other) ? other + (key?.offset ?? 0) : other?.k === 'type' ? other.id ?? other.name : null;
          if (key && val !== null) {
            const k = { slot: key.slot, value: val };
            if (EQ_BRANCH.test(op)) applyKeyBranch(k, x.operand, true);
            else if (NE_BRANCH.test(op)) applyKeyBranch(k, x.operand, false);
            else if (RANGE_BRANCH.test(op) && isNum(val)) {
              // Fall-through of a range check bounds the key: `head >= 103` compiles to `ldc 103; blt FAIL`.
              const keyIsA = key === a;
              let lo = -Infinity, hi = Infinity;
              if (keyIsA) { if (base === 'blt') lo = val; else if (base === 'ble') lo = val + 1; else if (base === 'bgt') hi = val; else hi = val - 1; }
              else { if (base === 'blt') hi = val; else if (base === 'ble') hi = val - 1; else if (base === 'bgt') lo = val; else lo = val + 1; }
              const groups = this.caseGroups.length ? this.caseGroups : [[]];
              setGroups(groups.map((g) => {
                const prev = g.find((c) => c.slot === k.slot && c.value === undefined && !c.match);
                const bnd = { slot: k.slot, lo: Math.max(prev?.lo ?? -Infinity, lo), hi: Math.min(prev?.hi ?? Infinity, hi) };
                return [...others(g, k), bnd];
              }));
              if (x.operand > x.offset) releaseKey(x.operand, { slot: k.slot });
            }
          }
        }
        continue;
      }
      if (POP1_BRANCH.test(op)) {
        const c = pop();
        const isTrue = op.startsWith('brtrue');
        if (isNum(c) || c === null) {
          const truthy = isNum(c) ? c !== 0 : false;
          if (truthy === isTrue && x.operand > x.offset) { noteJump(x.operand, true); if (this.linear && !process.env.TL_NO_DEAD) openDead(x.operand); else jumpTo(x.operand); }
          continue;
        }
        noteJump(x.operand, true);
        if (caseMap) {
          if (c?.k === 'keycmp' && x.operand > x.offset) {
            const k = c.value !== undefined ? { slot: c.slot, value: c.value } : { slot: c.slot, match: c.match };
            // brfalse: fall-through is the "true" path (match) unless negated
            const targetIsMatch = isTrue !== !!c.neg;
            applyKeyBranch(k, x.operand, targetIsMatch);
          } else if (c?.k === 'prop' && c.path.length === 1 && x.operand > x.offset) {
            const k = { slot: c.slot, match: { prop: c.path[0], value: !isTrue } };
            applyKeyBranch(k, x.operand, false);
          } else if (x.operand > x.offset) {
            openRegion(x.operand, c?.k === 'flag' ? flagKey(c.name) : null);
          }
        }
        continue;
      }
      if (op.startsWith('ldind.')) {
        const ref = pop();
        push(ref?.k === 'stat' ? 0 : ref?.k === 'ref' ? ref.get() : ref?.k === 'obj' ? ref : UNKNOWN);
        continue;
      }
      if (op.startsWith('stind.')) {
        const val = pop(); const ref = pop();
        if (ref?.k === 'stat' && !this.dead) this.onStore(ref, '@ind', val, ctx());
        else if (ref?.k === 'ref') ref.set(val);
        continue;
      }
      if (op === 'newarr') {
        const n = pop();
        push({ k: 'arr', items: isNum(n) ? new Array(n).fill(UNKNOWN) : [] });
        continue;
      }
      if (op.startsWith('stelem')) {
        const val = pop(); const idx = pop(); const arr = pop();
        if (arr?.k === 'arr' && isNum(idx)) arr.items[idx] = val;
        continue;
      }
      if (op === 'ldelema' || op.startsWith('ldelem')) {
        const idx = pop(); const arr = pop();
        if (arr?.k === 'arr' && isNum(idx)) push(arr.items[idx]);
        else if (arr?.k === 'slots' && isNum(idx)) push({ k: 'obj', name: 'armorSlot', slot: idx, props: {} });
        else push(UNKNOWN);
        continue;
      }
      if (op === 'ldsfld' || op === 'ldsflda') {
        const f = owner.resolve(x.operand);
        push(f ? this.staticValue(f, owner) : UNKNOWN);
        continue;
      }
      if (op === 'stsfld') {
        const val = pop();
        if (this._staticCapture) {
          const f = owner.resolve(x.operand);
          if (f) this._staticCapture.set(f.name, val);
        }
        continue;
      }
      if (op === 'ldfld' || op === 'ldflda') {
        const f = owner.resolve(x.operand);
        let recv = pop();
        if (recv?.k === 'ref') recv = recv.get();
        push(this.loadField(recv, f, ctx()));
        continue;
      }
      if (op === 'stfld') {
        const f = owner.resolve(x.operand);
        const val = pop(); let recv = pop();
        if (recv?.k === 'ref') recv = recv.get();
        this.storeField(recv, f, val, { ...ctx(), field: f });
        continue;
      }
      if (op === 'newobj') {
        const callee = owner.resolve(x.operand);
        const n = callee?.sig?.params.length ?? 0;
        const args = [];
        for (let i = 0; i < n; i++) args.unshift(pop());
        const made = callee ? this.onNew(callee, args, ctx()) : undefined;
        push(made !== undefined ? made : { k: 'obj', name: callee?.declaringType?.fullName ?? callee?.declaringType?.name ?? '?', args, props: {} });
        continue;
      }
      if (op === 'call' || op === 'callvirt') {
        const callee = owner.resolve(x.operand);
        if (!callee?.sig) { push(UNKNOWN); continue; }
        const n = callee.sig.params.length;
        const args = [];
        for (let i = 0; i < n; i++) args.unshift(pop());
        let recv = callee.sig.hasThis ? pop() : undefined;
        if (recv?.k === 'ref') {
          if (recv.get() === undefined || recv.get() === UNKNOWN) recv.set({ k: 'obj', name: 'struct', props: {} });
          recv = recv.get();
        }
        const result = this.call(callee, recv, args, { ...ctx(), recv });
        if (callee.sig.ret.et !== 0x01) push(result);
        continue;
      }
      push(UNKNOWN);
    }
    return UNKNOWN;
  }

  loadField(recv, f, ctx) {
    if (!f) return UNKNOWN;
    const v = this.onLoad(recv, f.name, ctx);
    if (v !== undefined) return v;
    if (recv?.k === 'itemarg') return f.name === 'type' ? { k: 'key', slot: recv.slot } : { k: 'prop', slot: recv.slot, path: [f.name] };
    if (recv?.k === 'obj') return recv.props[f.name] ?? UNKNOWN;
    if (recv === THIS) return this.thisField(f.name);
    return UNKNOWN;
  }

  storeField(recv, f, val, ctx) {
    if (!f) return;
    if (recv?.k === 'obj') recv.props[f.name] = val;
    if (recv === THIS && this._thisCapture) this._thisCapture.set(f.name, val);
    if (!this.dead) this.onStore(recv, f.name, val, ctx);
  }

  /** Fields assigned in the concrete type's constructor / `Load` (e.g. a dictionary of values). */
  thisField(name) {
    if (!this.concreteType || this._thisCapture) return UNKNOWN;
    if (!this._thisFields) {
      this._thisFields = new Map();
      this._thisCapture = this._thisFields;
      const savedLinear = this.linear;
      const savedCases = this.cases;
      const savedGroups = this.caseGroups;
      this.linear = false;
      try {
        let cur = this.concreteType;
        for (let i = 0; i < 8 && cur; i++) {
          for (const m of cur.methods) {
            if ((m.name === '.ctor' || m.name === 'Load' || m.name === 'OnModLoad') && this.asm.methodBody(m)?.il.length < 20000 && this.asm.methodSig(m).params.length === 0) {
              this.run(m, THIS, [], this.asm, this.maxDepth - 1);
            }
          }
          const base = this.asm.baseOf(cur);
          cur = base?.kind === 'typeDef' ? base.def : null;
        }
      } finally {
        this._thisCapture = null;
        this.linear = savedLinear;
        this.cases = savedCases;
        this.caseGroups = savedGroups;
      }
    }
    return this._thisFields.get(name) ?? UNKNOWN;
  }

  /** Static field value: hook first, then the declaring type's `.cctor` (evaluated once). */
  staticValue(f, owner) {
    const hooked = this.onStaticLoad(f);
    if (hooked !== undefined) return hooked;
    if (FLAG_NAMES.test(f.name)) return { k: 'flag', name: f.name };
    const td = f.declaringType?.def;
    if (!td || owner !== this.asm) return UNKNOWN;
    let map = this.statics.get(td);
    if (!map) {
      map = new Map();
      this.statics.set(td, map);
      const cctor = td.methods.find((m) => m.name === '.cctor');
      if (cctor && this.asm.methodBody(cctor)?.il.length < 20000) {
        const saved = this._staticCapture;
        const savedLinear = this.linear;
        const savedCases = this.cases;
        const savedGroups = this.caseGroups;
        this._staticCapture = map;
        this.linear = false;
        try {
          this.run(cctor, undefined, [], this.asm, this.maxDepth - 1);
        } finally {
          this._staticCapture = saved;
          this.linear = savedLinear;
          this.cases = savedCases;
          this.caseGroups = savedGroups;
        }
      }
    }
    return map.get(f.name) ?? UNKNOWN;
  }

  /** Dispatch a call: hooks first, then property accessors, then inlining. */
  call(callee, recv, args, ctx) {
    // `new int[] { … }` compiles to newarr + ldtoken + RuntimeHelpers.InitializeArray(arr, field)
    if (callee.name === 'InitializeArray' && args[0]?.k === 'arr' && args[1]?.k === 'token') {
      const data = ctx.owner.fieldData(args[1].token, args[0].items.length * 4);
      if (data && data.length === args[0].items.length * 4) {
        for (let i = 0; i < args[0].items.length; i++) args[0].items[i] = data.readInt32LE(i * 4);
      }
      return undefined;
    }
    const name = callee.name;
    const declName = callee.declaringType?.fullName ?? callee.declaringType?.name ?? '';
    if (declName === 'System.String') {
      const sv = stringOp(name, recv, args);
      if (sv !== undefined) return sv;
    }
    if (this.dead && ctx.depth === 0) return UNKNOWN; // dead block of a keyed method: no hooks, no inlining
    const hooked = this.onCall(callee, args, ctx);
    if (hooked !== undefined) return hooked;

    // The key item of a GlobalItem hook and property chains off it.
    const kv = this.keyChain(callee, recv, args);
    if (kv !== undefined) return kv;

    // Mod presence / lookups by name (ModLoader.HasMod, TryGetMod, mod.Find<ModItem>("X"))
    if (declName === 'Terraria.ModLoader.ModLoader' && this.enabledMods) {
      if (name === 'HasMod' && typeof args[0] === 'string') return this.enabledMods.has(args[0]) ? 1 : 0;
      if (name === 'TryGetMod' && typeof args[0] === 'string') {
        if (!this.enabledMods.has(args[0])) return 0;
        if (args[1]?.k === 'ref') args[1].set({ k: 'mod', name: args[0] });
        return 1;
      }
      if (name === 'GetMod' && typeof args[0] === 'string') return this.enabledMods.has(args[0]) ? { k: 'mod', name: args[0] } : UNKNOWN;
    }
    if (recv?.k === 'mod' && (name === 'Find' || name === 'TryFind') && typeof args[0] === 'string') {
      const t = { k: 'type', fn: 'ItemType', name: args[0], id: `${recv.name}:${args[0]}` };
      if (name === 'TryFind') { if (args[1]?.k === 'ref') args[1].set(t); return 1; }
      return t;
    }
    if (declName === 'Terraria.ModLoader.ModContent' && name === 'TryFind' && typeof args[0] === 'string' && args[0].includes('/')) {
      const [m, c] = args[0].split('/');
      if (this.enabledMods && !this.enabledMods.has(m)) return 0;
      if (args[1]?.k === 'ref') args[1].set({ k: 'type', fn: 'ItemType', name: c, id: `${m}:${c}` });
      return 1;
    }
    if (recv?.k === 'type' && name === 'get_Type') return recv;
    if (recv?.k === 'mod' && name === 'get_Name') return recv.name;
    if (!callee.sig.hasThis && FLAG_NAMES.test(name)) return { k: 'flag', name };

    // List<T> / Dictionary<K,V> built in code: keep their contents.
    if (recv?.k === 'obj') {
      if (name === 'Add' && args.length === 1) { (recv.list ??= []).push(args[0]); return undefined; }
      if (name === 'Add' && args.length === 2 && (typeof args[0] === 'string' || isNum(args[0]))) { recv.props[args[0]] = args[1]; return undefined; }
      if (name === 'set_Item' && args.length === 2 && (typeof args[0] === 'string' || isNum(args[0]))) { recv.props[args[0]] = args[1]; return undefined; }
      if (name === 'get_Item' && args.length === 1 && (typeof args[0] === 'string' || isNum(args[0]))) {
        return recv.props[args[0]] ?? recv.list?.[args[0]] ?? UNKNOWN;
      }
      if (name === 'TryGetValue' && args.length === 2 && args[1]?.k === 'ref') {
        const v = recv.props[args[0]];
        if (v !== undefined) { args[1].set(v); return 1; }
        return UNKNOWN;
      }
      if (name === 'ContainsKey' && args.length === 1) return recv.props[args[0]] !== undefined ? 1 : UNKNOWN;
      if (name === 'get_Count') return recv.list?.length ?? UNKNOWN;
    }
    const isItem = declName === 'Terraria.Item';

    if (recv === THIS && name === 'get_Item') return ITEM;
    if (recv === THIS && name === 'get_NPC') return ITEM;

    const tracked = recv === ITEM || recv === THIS || recv === PLAYER || recv?.k === 'obj' || recv?.k === 'modplayer' || recv?.k === 'itemarg';
    if (tracked && name.startsWith('set_') && args.length === 1) {
      if (recv?.k === 'obj') recv.props[name.slice(4)] = args[0];
      if (!this.dead) this.onStore(recv, name.slice(4), args[0], { ...ctx, prop: true });
      return undefined;
    }
    if (tracked && name.startsWith('get_') && args.length === 0) {
      const v = this.onLoad(recv, name.slice(4), ctx);
      if (v !== undefined) return v;
      if (recv?.k === 'obj') return recv.props[name.slice(4)] ?? UNKNOWN;
      if (recv?.k === 'itemarg') return { k: 'prop', slot: recv.slot, path: [name.slice(4)] };
      // a getter on `this` may be a real (virtual) method — fall through and inline it
      if (recv !== THIS) return UNKNOWN;
    }

    if (ctx.depth >= this.maxDepth) return UNKNOWN;

    // Inline tModLoader Item helpers (DefaultToRangedWeapon, sellPrice, …) — small, straight-line.
    if (isItem && this.tml && this.itemTypeDef && (recv === ITEM || !callee.sig.hasThis)) {
      if (name === 'SetDefaults' || name === 'CloneDefaults' || name === 'netDefaults' || name === 'ResetStats') return UNKNOWN;
      const target = this.findMethod(this.itemTypeDef, name, args.length, this.tml);
      if (target && this.tml.methodBody(target)?.il.length < 4000) {
        return this.runNested(target, recv, args, this.tml, ctx.depth + 1);
      }
      return UNKNOWN;
    }

    // Inline same-assembly methods.
    let def = callee.def ?? callee.method?.def;
    const declTd = callee.declaringType?.def ?? callee.method?.declaringType?.def;
    if (!def && declTd) def = this.findMethod(declTd, name, args.length, ctx.owner);
    if (def && ctx.owner === this.asm) {
      if (callee.sig.hasThis && recv === THIS && this.concreteType && (def.flags & 0x40)) {
        def = this.findOverride(this.concreteType, def) ?? def;
      }
      const body = this.asm.methodBody(def);
      if (body && body.il.length < 30000) return this.runNested(def, recv, args, this.asm, ctx.depth + 1);
    }
    return UNKNOWN;
  }

  /** Property chains off a GlobalItem hook's Item argument, turned into case keys. */
  keyChain(callee, recv, args) {
    const name = callee.name;
    if (recv?.k === 'itemarg') {
      if (name === 'get_ModItem') return { k: 'moditem', slot: recv.slot };
      if (name === 'CountsAsClass' && callee.kind === 'methodSpec') return { k: 'keycmp', slot: recv.slot, match: { cls: simpleName(callee.typeArgs[0]) } };
      if (name === 'CountsAsClass' && args[0]?.k === 'dc') return { k: 'keycmp', slot: recv.slot, match: { cls: args[0].name } };
      if (name === 'get_Name') return { k: 'prop', slot: recv.slot, path: ['displayName'] };
      if (name === 'get_type') return { k: 'key', slot: recv.slot };
      return undefined;
    }
    if (recv?.k === 'moditem') {
      if (name === 'get_Name') return { k: 'prop', slot: recv.slot, path: ['className'] };
      if (name === 'get_FullName') return { k: 'prop', slot: recv.slot, path: ['fullName'] };
      if (name === 'get_Mod') return { k: 'prop', slot: recv.slot, path: ['mod'] };
      if (name === 'get_Type') return { k: 'key', slot: recv.slot };
      if (name === 'GetType') return { k: 'prop', slot: recv.slot, path: ['type'] };
      return undefined;
    }
    if (recv?.k === 'prop') {
      const last = recv.path[recv.path.length - 1];
      if (last === 'mod' && name === 'get_Name') return { k: 'prop', slot: recv.slot, path: ['modName'] };
      if (last === 'type' && name === 'get_Namespace') return { k: 'prop', slot: recv.slot, path: ['namespace'] };
      if (last === 'type' && name === 'get_FullName') return { k: 'prop', slot: recv.slot, path: ['typeName'] };
      if (last === 'type' && name === 'get_Name') return { k: 'prop', slot: recv.slot, path: ['className'] };
      return undefined;
    }
    return undefined;
  }

  /** Nested runs never use linear mode: the callee is a helper, not a case-keyed method. */
  runNested(method, recv, args, owner, depth) {
    const savedLinear = this.linear;
    this.linear = false;
    try {
      return this.run(method, recv, args, owner, depth);
    } finally {
      this.linear = savedLinear;
    }
  }

  findMethod(td, name, paramCount, owner) {
    for (const m of td.methods) {
      if (m.name !== name) continue;
      const sig = owner.methodSig(m);
      if (sig.params.length === paramCount) return m;
    }
    return null;
  }

  /** Walk from the concrete type up to (not including) the declaring type looking for an override. */
  findOverride(concrete, def) {
    const sig = this.asm.methodSig(def);
    let cur = concrete;
    for (let i = 0; i < 32 && cur; i++) {
      if (cur === def.declaringType) return null;
      const m = cur.methods.find((x) => x.name === def.name && this.asm.methodSig(x).params.length === sig.params.length && this.asm.methodBody(x));
      if (m) return m;
      const base = this.asm.baseOf(cur);
      cur = base?.kind === 'typeDef' ? base.def : null;
    }
    return null;
  }
}

/** String operations on constants and on key property chains. */
function stringOp(name, recv, args) {
  const a = recv !== undefined ? recv : args[0];
  const b = recv !== undefined ? args[0] : args[1];
  if (name === 'Concat' && args.length && args.every((x) => typeof x === 'string')) return args.join('');
  if (typeof a === 'string' && typeof b === 'string') {
    if (name === 'op_Equality' || name === 'Equals') return a === b ? 1 : 0;
    if (name === 'op_Inequality') return a !== b ? 1 : 0;
    if (name === 'StartsWith') return a.startsWith(b) ? 1 : 0;
    if (name === 'EndsWith') return a.endsWith(b) ? 1 : 0;
    if (name === 'Contains') return a.includes(b) ? 1 : 0;
  }
  const prop = a?.k === 'prop' ? a : b?.k === 'prop' ? b : null;
  const str = a?.k === 'prop' ? b : a;
  if (prop && typeof str === 'string') {
    const kind = prop.path[prop.path.length - 1];
    if (name === 'op_Equality' || name === 'Equals') return { k: 'keycmp', slot: prop.slot, match: { [kind]: str } };
    if (name === 'op_Inequality') return { k: 'keycmp', slot: prop.slot, match: { [kind]: str }, neg: true };
    if (name === 'StartsWith') return { k: 'keycmp', slot: prop.slot, match: { [`${kind}StartsWith`]: str } };
    if (name === 'EndsWith') return { k: 'keycmp', slot: prop.slot, match: { [`${kind}EndsWith`]: str } };
    if (name === 'Contains') return { k: 'keycmp', slot: prop.slot, match: { [`${kind}Contains`]: str } };
  }
  return undefined;
}

/** Simple name of a type (`CalamityMod.RogueDamageClass` → `RogueDamageClass`). */
/** Static field values assigned in a type's class constructor (`static readonly int X = 97`). */
export function evalStatics(asm, td, tml = null) {
  const out = new Map();
  const cctor = td?.methods.find((m) => m.name === '.cctor');
  if (!cctor) return out;
  const machine = new Machine(asm, { tml, budget: 20000, maxDepth: 2 });
  machine._staticCapture = out;
  try { machine.run(cctor, undefined, []); } catch { /* partial */ }
  return out;
}

export const simpleName = (full) => (full ?? '').split(/[./]/).pop().replace(/`\d+$/, '');

/**
 * Default `onCall` for tModLoader statics: ModContent.XType<T>(), DamageClass.X,
 * GetInstance<T>(), ThoriumDamageBase<T>.Instance, player.GetModPlayer<T>().
 */
export function tmlStaticHook(callee, args, ctx) {
  const decl = callee.declaringType;
  const declName = decl?.fullName ?? decl?.name ?? '';
  const name = callee.name;
  if (declName === 'Terraria.ModLoader.ModContent' && callee.kind === 'methodSpec') {
    if (name === 'GetInstance') return { k: 'dc', name: simpleName(callee.typeArgs[0]), full: callee.typeArgs[0] };
    if (name.endsWith('Type')) return { k: 'type', fn: name, name: callee.typeArgs[0] };
  }
  if (declName === 'Terraria.ModLoader.DamageClass' && name.startsWith('get_') && !callee.sig.hasThis) {
    return { k: 'dc', name: name.slice(4), full: `Terraria.ModLoader.DamageClass.${name.slice(4)}` };
  }
  if (name === 'get_Instance' && decl?.kind === 'typeSpec' && decl.args?.length) {
    return { k: 'dc', name: simpleName(decl.args[0]), full: decl.args[0] };
  }
  if (name === 'get_Instance' && /Damage/.test(declName)) return { k: 'dc', name: simpleName(declName), full: declName };
  if (name === 'GetModPlayer' && callee.kind === 'methodSpec' && ctx?.recv === PLAYER) {
    return { k: 'modplayer', name: simpleName(callee.typeArgs[0]) };
  }
  return undefined;
}

export function tmlStaticLoadHook(field) {
  const declName = field.declaringType?.fullName ?? field.declaringType?.name ?? '';
  if (field.name === 'Instance' && /Damage|Class/.test(declName)) return { k: 'dc', name: simpleName(declName), full: declName };
  if (declName === 'Terraria.Item' && field.name === 'CommonMaxStack') return 9999;
  return undefined;
}
