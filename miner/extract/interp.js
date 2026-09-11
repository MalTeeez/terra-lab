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
/** An NPC out of `Main.npc[i]`, so a hook can tell "reads an enemy" from "reads the player". */
export const NPC = Object.freeze({ k: 'npc' });

// NaN/Infinity are not values: they come out of arithmetic on stand-ins the machine could not
// resolve (`statLife / statLifeMax2` is `0 / 0`), and one of them poisons every stat downstream.
export const isNum = (v) => Number.isFinite(v);
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
/** Values that stand for the key a hook was called about (see `keyChain`). */
const KEYISH = new Set(['prop', 'key', 'keycmp', 'moditem', 'itemarg']);
const TERMINATORS = new Set(['ret', 'br', 'br.s', 'throw', 'rethrow', 'leave', 'leave.s', 'switch', 'jmp']);

/** Static fields / getters whose value depends on the world's difficulty or mode. */
export const FLAG_NAMES = /^(expertMode|masterMode|revenge|death|malice|bossRushActive|EternityMode|MasochistMode|InfernumActive|InfernumMode|IsInfernum|CanUseCustomAIs)$/i;
/** Difficulty flags keep their short lowercase form (expertMode -> expert); progression flags keep their name. */
const flagKey = (n) => { const b = n.replace(/^get_/, ''); return FLAG_NAMES.test(b) ? b.replace(/Mode$|Active$/, '').toLowerCase() : b; };
/** `x` <-> `!x` (region tags: a block that runs when the flag is false). */
export const negTag = (t) => (t.startsWith('!') ? t.slice(1) : `!${t}`);
/** Tags that hold plainly (no `!x` / `any:x`). */
export const plainTags = (tags) => (tags ?? []).filter((t) => !/^!|^any:/.test(t));

const ELEM_SIZE = { 'System.Byte': 1, 'System.SByte': 1, 'System.Boolean': 1, 'System.Int16': 2, 'System.UInt16': 2, 'System.Char': 2, 'System.Int32': 4, 'System.UInt32': 4, 'System.Single': 4, 'System.Int64': 8, 'System.UInt64': 8, 'System.Double': 8 };
/** Array literal blob (`<PrivateImplementationDetails>` field) into an `arr` value. */
function fillArray(owner, arr, token) {
  const size = ELEM_SIZE[arr.elem] ?? 4;
  if (!size || !arr.items.length || !owner.fieldData) return;
  let buf;
  try { buf = owner.fieldData(token, arr.items.length * size); } catch { return; }
  if (!buf || buf.length < arr.items.length * size) return;
  const e = arr.elem;
  const rd = (o) => size === 1 ? (e === 'System.SByte' ? buf.readInt8(o) : buf.readUInt8(o))
    : size === 2 ? (e === 'System.Int16' ? buf.readInt16LE(o) : buf.readUInt16LE(o))
    : size === 4 ? (e === 'System.Single' ? buf.readFloatLE(o) : e === 'System.UInt32' ? buf.readUInt32LE(o) : buf.readInt32LE(o))
    : e === 'System.Double' ? buf.readDoubleLE(o) : Number(buf.readBigInt64LE(o));
  for (let i = 0; i < arr.items.length; i++) arr.items[i] = rd(i * size);
}

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
    this.onArrayStore = opts.onArrayStore ?? (() => undefined); // stores into tagged arrays (static sets like TileID.Sets.Ore)
    this.onCast = opts.onCast ?? null; // (type, value, ctx) for isinst: return a value to replace the result (a flag tags the branch)
    this.onStoreLocal = opts.onStoreLocal ?? null; // linear mode: (index, value, ctx) for every stloc
    this.noDead = opts.noDead ?? false; // linear mode: a branch with a known outcome never makes the skipped block dead (gate walks)
    this.phi = opts.phi ?? false; // linear mode: different constants meeting at a join become a phi value with each arm's flags
    this.onStoreArg = opts.onStoreArg ?? null; // (index, value, ctx) for every starg
    this.onStaticStore = opts.onStaticStore ?? null; // (field, value, ctx) for every stsfld
    this.onStaticLoad = opts.onStaticLoad ?? (() => undefined);
    this.onReturn = opts.onReturn ?? (() => {});
    /** linear mode: every backward conditional jump (a loop) with the two compared values */
    this.onBackJump = opts.onBackJump ?? null;
    this.enabledMods = opts.enabledMods ?? null;
    this.loadFields = opts.loadFields ?? null; // "Type::Field" → value, from evalLoadStatics (load-time constants)
    // walk calls into the assembly of a mod this one extends (see the call handler); off by default:
    // a helper of that mod is opaque on purpose everywhere the extractor reads the *call* as the
    // evidence (a drop helper is a drop rule, whatever it does inside)
    this.crossAsm = opts.crossAsm ?? false;
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
  run(method, thisVal, args = [], owner = this.asm, depth = 0, typeArgs = null) {
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
    const localMaybe = new Map(); // phi mode: locals whose last store sat under a condition → the flags of that store
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
    const ctxBase = { owner, method, depth, machine: this, typeArgs };
    let pc = 0;
    const ctx = () => ({ ...ctxBase, cases: this.cases, caseGroups: this.caseGroups, conditional: this.conditional, condTags: this.condTags, offset: ins[pc]?.offset, region: regions.length ? regions[regions.length - 1].end : null, untagged: regions.filter((r) => !r.dead && !r.tags.length).map((r) => r.end) });
    // linear mode: the stack a jump would arrive with, per target offset
    const stackAt = caseMap ? new Map() : null;
    // …and the key context a *conditional* jump carries: the keys guarding the branch itself
    // stay valid on both paths (`if (mod == "X") { if (spear) …; else return CountsAs(Melee); }`).
    const groupsAt = caseMap ? new Map() : null;
    const noteJump = (target, withGroups = false, groups = this.caseGroups) => {
      if (!stackAt) return;
      // a flag carried to a join point keeps the flags guarding the jump: `a ? b : false` is a && b
      const also = plainTags(this.condTags);
      if (!stackAt.has(target)) { stackAt.set(target, stack.map((v) => (v?.k === 'flag' && also.length ? { ...v, also: [...new Set([...(v.also ?? []), ...also])] } : v))); stackTagsAt.set(target, [...this.condTags]); }
      if (!regionsAt.has(target)) regionsAt.set(target, { at: x0.offset, list: regions.filter((r) => !r.dead && r.end > target) });
      if (withGroups && !groupsAt.has(target)) groupsAt.set(target, groups.map((g) => [...g]));
      if (!jumpsAt.has(target)) jumpsAt.set(target, new Set());
      jumpsAt.get(target).add(x0.offset);
    };
    // every offset that jumps to a target, not just the first: what tells an else-branch from a join
    const jumpsAt = caseMap ? new Map() : null;
    // linear mode: forward conditional jumps open a region whose stores are "conditional"
    const regions = []; // { end, tag, groups } — groups = the key context the if statement sits in; els = an else-branch, not a condition of the if
    const openRegion = (target, tags = [], els = false) => { if (caseMap && target > 0) regions.push({ end: target, tags: tags.filter(Boolean), groups: this.caseGroups.map((g) => [...g]), at: x0.offset, els }); };
    // ...and the regions a jump target sits in: after an unconditional jump the next instruction
    // is only reachable by jumping there, so its context is the jump source's (first jump wins)
    const regionsAt = caseMap ? new Map() : null;
    const stackTagsAt = caseMap ? new Map() : null; // the flags in force at the jump, for `phi` values
    // `A || B` compiles to `A; brtrue BODY; B; brfalse END; BODY:` - the `!A` region ends exactly
    // where the B region starts, so BODY is guarded by any of the alternatives (an untagged
    // region ending there is an alternative without a flag: `any:*`, no requirement)
    const orAlternatives = (start) => regions.filter((r) => !r.dead && r.end === start && r.tags.length <= 1 && !r.tags[0]?.startsWith('any:')).map((r) => (r.tags.length ? `any:${negTag(r.tags[0])}` : 'any:*'));
    const flagRegion = (target, flagVal, negate) => {
      if (target <= 0) return;
      const neg = flagVal?.k === 'flag' ? negate !== !!flagVal.neg : false;
      const tag = flagVal?.k === 'flag' ? (neg ? '!' : '') + flagKey(flagVal.name) : null;
      const alts = tag ? orAlternatives(ins[pc + 1]?.offset ?? -1) : [];
      // a flag that stands for `a && b` (see noteJump): true needs all, false is any of them false
      const also = flagVal?.also ?? [];
      const own = neg ? [tag, ...also.map((t) => `any:!${t}`)] : [tag, ...also];
      openRegion(target, alts.length ? [...alts, `any:${tag}`] : own);
    };
    // linear mode: a branch with a known outcome does not jump (that would skip the other cases of
    // a keyed method); the block it skips is dead while the key context stays the same.
    /**
     * `if (c) { X; br/ret END } ELSE:` — everything from here is the condition's negation. Every
     * region ending where the if-block ends is one of its `&&` conditions (any of them false gets
     * here); the else cannot outlive the region enclosing the if, so it is clamped to `limit` and
     * to the enclosing ends. An else-branch clamped to the same end is not a condition of this if:
     * `if (!hardMode) { if (n < 2) … else { …; br END } }` must still say `hardMode` here.
     * Only fires when a live region closes right after this instruction *and* the jump leaves every
     * region opened inside it; a br out of a block nested in a larger region is a plain jump.
     * The innermost region is not always the one that closes: Meteor Fist's `if (numHits == 0) { …
     * if (timeLeft == 2) SetUpLeftoverWire(); br END }` ends with a nested `if` whose own region
     * runs to the same END as the br, so asking only the top of the stack never saw the arm close
     * and the post-hit block below read as unconditional — the fist's drag and its 0.2 drop were
     * taken for its flight.
     */
    const openElse = (limit) => {
      const at = ins[pc + 1]?.offset;
      const closing = regions.filter((r) => r.end === at);
      const inner = closing.length ? closing[closing.length - 1] : null;
      if (!inner) return;
      // …and everything opened inside it leaves with the jump: a region outliving `limit` is one
      // this br is still inside, which makes the br a plain jump out of a nested block.
      if (regions.slice(regions.indexOf(inner) + 1).some((r) => r.end > limit)) return;
      // `if (!config.X) return;` with X known on: the early return is dead, so the rest of the
      // method is the *only* path, not the else-branch of a live condition. Opening a region here
      // put every recipe edit in the method under an untagged condition and dropped all of them.
      if (inner.dead) return;
      const same = regions.filter((r) => !r.dead && !r.els && r.end === inner.end);
      // …and the block is only the *else* of this if when this if is the only way in. SOTS guards
      // `if (isConduitItem && !ConduitBelt) return false;` — the `isConduitItem` test also jumps
      // past the return, so the rest of the method runs with or without the belt, and reading it
      // as the else-arm hung every later proc in `CanUseItem` (a shrimp laser, the Wishing Star)
      // on the Archaeologist's Toolbelt. A join is not a negation.
      const ats = new Set(same.map((r) => r.at));
      for (const src of jumpsAt.get(inner.end) ?? []) if (!ats.has(src)) return;
      const tags = !same.length || same.some((r) => !r.tags.length) ? [] : same.length === 1 ? same[0].tags.map(negTag) : same.flatMap((r) => (r.tags.length === 1 ? [`any:${negTag(r.tags[0])}`] : []));
      const outer = regions.filter((r) => r.end > inner.end).map((r) => r.end);
      openRegion(Math.min(limit, ...outer), tags, true);
    };
    const groupsKey = () => JSON.stringify(this.caseGroups);
    const openDead = (target) => { if (caseMap && target > x0.offset) regions.push({ end: target, tags: [], dead: true, key: groupsKey(), groups: [], at: x0.offset }); };
    let x0 = { offset: 0 };
    // `if (key == N) { … }` compiles to `bne.un END`: at END the key condition is over.
    const releaseAt = caseMap ? new Map() : null;
    // `type == A || type == B` compiles to `beq BODY; <B test>; bne END; BODY:`. The fall-through
    // key (B) is released at END by its own `bne`, but the one the `beq` carries in arrives at BODY
    // through `caseMap` with no end at all — so it stayed keyed on every block after the chain.
    // Ocram's Roar, added several blocks later under `TryGetMod("Consolaria")`, was read as loot of
    // the crate the chain had tested. A jump target's key belongs to the block that target opens.
    const keyAt = caseMap ? new Map() : null; // jump target → the keys a `beq`-shaped branch carried there
    /**
     * Where the block opened at `from` ends: the nearest offset something already jumps to. Only
     * jumps read before `from` are recorded, so a nested `if` inside the block cannot end it early,
     * and a block that runs to the end of the method reports 0 (nothing to release).
     */
    const endOfBlock = (from) => {
      let end = Infinity;
      for (const t of stackAt.keys()) if (t > from && t < end) end = t;
      if (!Number.isFinite(end)) return 0;
      // …unless the block leaves a value on the stack, which makes it a ternary arm and not a
      // statement block: `Add(npc.type == EvilConstruct ? DeathSpiral : StreetCleaner)` picks the
      // item under the key and adds it *after* the join, so there the key is the value's, not the
      // block's, and letting it go loses the drop entirely.
      return stackAt.get(end)?.length ? 0 : end;
    };
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
      if (targetIsMatch) {
        for (const g of groups) addGroup(target, [...others(g, k), k]);
        // …and remember that this key is the *branch's* own, not the block's: it has to be let go
        // again where the block the jump opens ends (see `endOfBlock`)
        const list = keyAt.get(target) ?? [];
        if (!list.some((c) => sameKey(c, k))) list.push(k);
        keyAt.set(target, list);
      } else { setGroups(groups.map((g) => [...others(g, k), k])); if (target > 0) releaseKey(target, k); }
    };

    for (pc = 0; pc < ins.length; pc++) {
      if (++this.used > this.budget) return UNKNOWN;
      const x = ins[pc];
      const op = x.op;

      x0 = x;
      const closedTags = []; // tags of the regions ending right here: the arm a fall-through value came from
      if (caseMap) {
        for (let i = regions.length - 1; i >= 0; i--) if (regions[i].end <= x.offset || (regions[i].dead && regions[i].key !== groupsKey())) { if (regions[i].end === x.offset) closedTags.push(...(regions[i].tags ?? [])); regions.splice(i, 1); }
        this.dead = regions.some((r) => r.dead);
        this.conditional = regions.some((r) => !r.dead);
        this.condTags = regions.flatMap((r) => r.tags ?? []);
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
          // regions too: what the jumps here carried, plus what the terminator itself opened (an else-branch)
          const prevOff = pc > 0 ? ins[pc - 1].offset : -1;
          const keep = regions.filter((r) => r.at === prevOff || r.dead);
          // A loop body sitting after a `br` over it is reached only by the backward jump at its
          // end, which the linear walk has not read yet — so nothing has been recorded for this
          // offset and clearing the regions would say the body is unconditional. What still
          // encloses the offset is the honest answer until a jump says otherwise.
          const enclosing = regionsAt.has(x.offset) ? [] : regions.filter((r) => !r.dead && r.end > x.offset);
          regions.length = 0;
          for (const r of regionsAt.get(x.offset)?.list ?? enclosing) if (!regions.includes(r)) regions.push(r);
          for (const r of keep) if (!regions.includes(r)) regions.push(r);
          this.dead = regions.some((r) => r.dead);
          this.conditional = regions.some((r) => !r.dead);
          this.condTags = regions.flatMap((r) => r.tags ?? []);
        }
        if (!TERMINATORS.has(prev) && regionsAt.has(x.offset)) {
          // a join reached by fall-through and by a jump: a region the jump did not pass through
          // (`(y < surface || (remix && deep)) && eclipse`: the remix check sits between the jump and
          // here) cannot gate what follows
          const via = new Set(regionsAt.get(x.offset).list);
          // …except the region an `A || B` chain opens on its last test (see `orAlternatives`). Its
          // body is entered *both* ways — by A's jump and by falling through B — and its tags
          // already say "any of these", so the jump that arrives here is one of its alternatives
          // rather than a path that missed it. Dropping it lost the whole block's guard:
          // `if (Destabilized || conflagrate) lifeRegen -= 5` read as an unconditional −5.
          const prevOff = ins[pc - 1].offset;
          const isOrChain = (r) => r.at === prevOff && r.tags?.length && r.tags.every((t) => t.startsWith('any:'));
          for (let i = regions.length - 1; i >= 0; i--) if (!regions[i].dead && !via.has(regions[i]) && !isOrChain(regions[i])) regions.splice(i, 1);
          this.conditional = regions.some((r) => !r.dead);
          this.condTags = regions.flatMap((r) => r.tags ?? []);
        }
        if (!TERMINATORS.has(prev) && stackAt.has(x.offset)) {
          // join point reached by fall-through too: a flag from one path and 0 from the other is the flag;
          // two different constants (`hardMode ? 3981 : 2336`) become a `phi` carrying each arm's flags
          const saved = stackAt.get(x.offset);
          const savedTags = stackTagsAt.get(x.offset) ?? [];
          for (let i = 0; i < Math.min(saved.length, stack.length); i++) {
            const a = stack[stack.length - 1 - i]; const b = saved[saved.length - 1 - i];
            if (a?.k === 'flag' && (b === 0 || b === null)) continue;
            if (b?.k === 'flag' && (a === 0 || a === null)) { stack[stack.length - 1 - i] = b; continue; }
            // `item.ModItem?.Name ?? ""`: the empty string is the arm where there is nothing to
            // key on, so the key survives the merge — otherwise the chain of `name == "XBag"`
            // comparisons after it has a constant on the left and keys nothing
            if (KEYISH.has(a?.k) && (b === '' || b === null)) continue;
            if (KEYISH.has(b?.k) && (a === '' || a === null)) { stack[stack.length - 1 - i] = b; continue; }
            const phiable = (v) => isNum(v) || v?.k === 'oneof' || v?.k === 'phi' || v?.k === 'type';
            if (this.phi && a !== b && phiable(a) && phiable(b) && !(a?.k === 'type' && b?.k === 'type' && a.id === b.id && a.name === b.name)) {
              const alts = [...(a?.k === 'phi' ? a.alts : [{ v: a, tags: [...closedTags] }]), ...(b?.k === 'phi' ? b.alts : [{ v: b, tags: [...savedTags] }])];
              stack[stack.length - 1 - i] = { k: 'phi', alts };
            }
          }
        }
        const mapped = caseMap.get(x.offset);
        if (mapped) {
          setGroups(TERMINATORS.has(prev) ? [...mapped] : [...this.caseGroups, ...mapped]);
          const end = endOfBlock(x.offset);
          if (end) for (const k of keyAt.get(x.offset) ?? []) releaseKey(end, k);
        }
        else if (TERMINATORS.has(prev)) {
          // A loop body sitting after a `br` over it — the same shape the regions above keep — is
          // reached only by the backward jump at its end, which the linear walk has not read yet.
          // The key block the `br` jumps *within* still encloses it, and clearing the keys made
          // every store in such a loop unkeyed: `if (item.type == X) foreach (line in tooltips) …`
          // lost the item it was about.
          const brTo = /^br(\.s)?$/.test(prev) ? ins[pc - 1].operand : null;
          const inBlock = brTo > x.offset && [...releaseAt.keys()].some((t) => t > brTo);
          setGroups(groupsAt.get(x.offset) ?? (inBlock ? this.caseGroups : []));
        }
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
          if (this.onStoreArg && !this.dead) this.onStoreArg(x.operand, val, ctx());
          continue;
        }
        case 'ldloc.0': case 'ldloc.1': case 'ldloc.2': case 'ldloc.3': case 'ldloc.s': case 'ldloc': {
          const i = op === 'ldloc.s' || op === 'ldloc' ? x.operand : +op.slice(6);
          const v = locals[i];
          // linear mode: a number stored under a condition is not known on every path (`flag = false;
          // if (x) flag = true; if (flag) ...` must not make the block dead)
          push(this.phi && localMaybe.has(i) && (isNum(v) || v?.k === 'type' || v?.k === 'oneof') ? { k: 'maybe', value: v, local: i, tags: localMaybe.get(i) } : v);
          continue;
        }
        case 'ldloca.s': case 'ldloca': {
          const i = x.operand;
          if (locals[i] === undefined || locals[i] === UNKNOWN) locals[i] = { k: 'obj', name: 'local', props: {} };
          push({ k: 'ref', get: () => locals[i], set: (v) => { locals[i] = v; } });
          continue;
        }
        case 'stloc.0': case 'stloc.1': case 'stloc.2': case 'stloc.3': case 'stloc.s': case 'stloc': {
          const i = op === 'stloc.s' || op === 'stloc' ? x.operand : +op.slice(6);
          const val = pop();
          // `v = flagA; if (!flagB) v = false;` — v stands for flagA && flagB (the dungeon crate is
          // ZoneDungeon && downedBoss3). Only the innermost region counts; outer flags do not apply.
          const inner = regions.length ? regions[regions.length - 1] : null;
          const negs = val === 0 && locals[i]?.k === 'flag' && !locals[i].neg && inner && !inner.dead && inner.tags.length && inner.tags.every((t) => t.startsWith('!')) ? inner.tags.map((t) => t.slice(1)) : null;
          if (negs) { locals[i] = { ...locals[i], also: [...new Set([...(locals[i].also ?? []), ...negs])] }; localMaybe.delete(i); continue; }
          locals[i] = val;
          if (this.phi) { if (this.conditional) localMaybe.set(i, [...this.condTags]); else localMaybe.delete(i); }
          if (this.onStoreLocal && !this.dead) this.onStoreLocal(i, val, ctx());
          continue;
        }
        case 'dup': { const t = pop(); push(t); push(t); continue; }
        case 'pop': pop(); continue;
        case 'ret':
          if (this.linear) {
            if (sig.ret.et !== 0x01) { const rv = pop(); if (!this.dead) this.onReturn(rv, ctx()); }
            // `if (c) { … return; } ELSE:` — an if-block can end in a return just as well as a br
            openElse(ins[ins.length - 1].offset + 1);
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
            // else-branch of an if: the condition is false there. Every region ending where the
            // if-block ends is one of its `&&` conditions (any of them false gets here); the else
            // cannot outlive the region enclosing the if.
            // (only when the innermost region closes right after the br: `if (c) { X; br END } ELSE:`;
            // a br out of a block nested in a larger region is a plain jump)
            if (x.operand > x.offset) openElse(x.operand);
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
          } else {
            const h = this.onCast ? this.onCast(owner.resolve(x.operand), a, ctx()) : undefined;
            push(h !== undefined ? h : a);
          }
          continue;
        }
        case 'box': case 'unbox': case 'unbox.any': case 'castclass': case 'mkrefany': case 'refanyval': continue;
        case 'ldobj': { const r = pop(); push(r?.k === 'ref' ? r.get() : r); continue; }
        case 'ldtoken': push({ k: 'token', token: x.operand }); continue;
        case 'initobj': { const r = pop(); if (r?.k === 'ref') r.set({ k: 'obj', name: 'struct', props: {} }); continue; }
        case 'stobj': { const v = pop(); const r = pop(); if (r?.k === 'ref') r.set(v, ctx()); continue; }
        case 'cpobj': pop(); pop(); continue;
        case 'localloc': pop(); push(UNKNOWN); continue;
        case 'sizeof': case 'arglist': case 'refanytype': case 'ldvirtftn': push(UNKNOWN); continue;
        case 'ldftn': { const m = owner.resolve(x.operand); push(m?.def ? { k: 'fn', method: m.def, asm: owner } : UNKNOWN); continue; }
        case 'ckfinite': continue;
        case 'calli': pop(); push(UNKNOWN); continue;
        case 'cpblk': case 'initblk': pop(); pop(); pop(); continue;
      }
      if (op.startsWith('conv.')) {
        const a = pop();
        // a flag widened to a number still stands for the flag: `ai[0] = stealthStrike > 0` keeps
        // the fact alive for the branch further down that reads it back
        if (!isNum(a)) { push(a?.k === 'key' || a?.k === 'adj' || a?.k === 'flag' || a?.k === 'rand' || a?.k === 'trig' ? a : UNKNOWN); continue; }
        push(/conv\.(r4|r8|r\.un)/.test(op) ? a : Math.trunc(a));
        continue;
      }
      if (op in BINOPS) {
        const b = pop(); const a = pop();
        if (isNum(a) && isNum(b)) push(BINOPS[op](a, b));
        else if (op === 'sub' && a?.k === 'key' && isNum(b)) push({ ...a, offset: (a.offset ?? 0) + b });
        // `shoot = type - 3278 + ProjectileID.WoodenYoyo` (the vanilla yoyo block): the key keeps
        // its running offset so the consumer can resolve it per item id
        else if (op === 'add' && a?.k === 'key' && isNum(b)) push({ ...a, offset: (a.offset ?? 0) - b });
        else if (op === 'add' && b?.k === 'key' && isNum(a)) push({ ...b, offset: (b.offset ?? 0) - a });
        // `494 + Main.rand.Next(2)` (a hook returns `randn` for the roll): one of a small range
        else if (op === 'add' && ((isNum(a) && b?.k === 'randn') || (isNum(b) && a?.k === 'randn'))) { const base = isNum(a) ? a : b; const n = (isNum(a) ? b : a).n; push({ k: 'oneof', items: Array.from({ length: n }, (_, i) => base + i) }); }
        else if (op === 'add' && a?.k === 'stat' && isNum(b)) push({ ...a, delta: b });
        // `unknown && flag` (not short-circuited): true still needs the flag; false says nothing,
        // and a `!flag` region is no requirement anyway
        else if (op === 'and' && a?.k === 'flag' && b === UNKNOWN) push(a);
        else if (op === 'and' && b?.k === 'flag' && a === UNKNOWN) push(b);
        // `item.defense += 15` / `item.damage = (int)(item.damage * 1.2f)` on a keyed item
        else if ((a?.k === 'adj' || (a?.k === 'prop' && a.path?.length === 1)) && isNum(b) && /^(add|sub|mul|div)$/.test(op)) {
          const base = a.k === 'adj' ? a : { k: 'adj', slot: a.slot, field: a.path[0], add: 0, mul: 1 };
          const r = { ...base };
          if (op === 'add') r.add += b; else if (op === 'sub') r.add -= b; else if (op === 'mul') { r.mul *= b; r.add *= b; } else { r.mul /= b; r.add /= b; }
          push(r);
        }
        // `2f * damage`: the constant on the left
        else if (isNum(a) && b?.k === 'adj' && op === 'mul') push({ ...b, mul: b.mul * a, add: b.add * a });
        // `NextFloat() * 0.2f + 0.95f`: a roll scaled and shifted is still a roll, over the new range
        else if ((a?.k === 'rand' && isNum(b)) || (isNum(a) && b?.k === 'rand')) {
          const r = a?.k === 'rand' ? a : b; const n = a?.k === 'rand' ? b : a;
          if (op === 'mul') push({ k: 'rand', lo: Math.min(r.lo * n, r.hi * n), hi: Math.max(r.lo * n, r.hi * n) });
          else if (op === 'add') push({ k: 'rand', lo: r.lo + n, hi: r.hi + n });
          else if (op === 'sub') push(a === r ? { k: 'rand', lo: r.lo - n, hi: r.hi - n } : { k: 'rand', lo: n - r.hi, hi: n - r.lo });
          else if (op === 'div' && a === r && n !== 0) push({ k: 'rand', lo: Math.min(r.lo / n, r.hi / n), hi: Math.max(r.lo / n, r.hi / n) });
          else push(UNKNOWN);
        }
        // `len * rand(0.95, 1.15)`: scaled by a roll is scaled by its middle; `angle + rand(-d, d)`:
        // an angle with a roll on it keeps the roll as jitter, which is a scatter rather than a fan
        else if (a?.k === 'adj' && b?.k === 'rand' && op === 'mul') { const m = (b.lo + b.hi) / 2; push({ ...a, mul: a.mul * m, add: a.add * m }); }
        else if (a?.k === 'adj' && b?.k === 'rand' && (op === 'add' || op === 'sub')) push({ ...a, add: a.add + (op === 'add' ? 1 : -1) * ((b.lo + b.hi) / 2), jitter: (a.jitter ?? 0) + Math.abs(b.hi - b.lo) / 2 });
        // `len * Math.Sin(angle ± d)`: the length turned back into a component at an angle — the
        // offset rides along so `new Vector2(x, y)` can read the fan it makes
        else if (op === 'mul' && ((a?.k === 'adj' && b?.k === 'trig') || (a?.k === 'trig' && b?.k === 'adj'))) { const adj = a.k === 'adj' ? a : b; const t = a.k === 'trig' ? a : b; push({ ...adj, trig: t.off, jitter: (adj.jitter ?? 0) + (t.jitter ?? 0) }); }
        // A marker its owner declared `taint` survives being computed with. "This number came from
        // the player's position" is a fact about *where the value came from*, not about its value,
        // so `player.Center.X - Center.X`, its square, its length and the unit vector built out of
        // it are all still that fact — and a boomerang spells its return exactly that way, one
        // component at a time. Without this the marker died at the first `sub` and Calamity's
        // boomerangs read as fire-and-forget daggers thrown on the use timer.
        else if (a?.taint || b?.taint) push(a?.taint ? a : b);
        else push(UNKNOWN);
        continue;
      }
      if (op in CMP) {
        const b = pop(); const a = pop();
        if (isNum(a) && isNum(b)) push(CMP[op](a, b) ? 1 : 0);
        else if ((op === 'ceq' || op === 'cgt.un') && (a?.k === 'keycmp' || b?.k === 'keycmp') && (a === 0 || b === 0 || a === null || b === null)) {
          // `x == false` / `x == null` negates; `item.ModItem is IVoidHybrid` compiles to
          // `isinst; ldnull; cgt.un` and is the test itself
          const kc = a?.k === 'keycmp' ? a : b;
          push(op === 'ceq' ? { ...kc, neg: !kc.neg } : kc);
        } else if (op === 'ceq' && a?.k === 'key' && (isNum(b) || b?.k === 'type')) {
          push({ k: 'keycmp', slot: a.slot, match: null, value: isNum(b) ? b + (a.offset ?? 0) : b.id ?? b.name });
        } else if (op === 'ceq' && b?.k === 'key' && (isNum(a) || a?.k === 'type')) {
          push({ k: 'keycmp', slot: b.slot, match: null, value: isNum(a) ? a + (b.offset ?? 0) : a.id ?? a.name });
        } else if (op === 'ceq' && (a?.k === 'dcof' || b?.k === 'dcof')) {
          const d = a?.k === 'dcof' ? a : b;
          const v = d === a ? b : a;
          push(v?.k === 'dc' ? { k: 'keycmp', slot: d.slot, match: { dcIs: v.name } } : UNKNOWN);
        } else if (op === 'ceq' && (a?.k === 'flag' || b?.k === 'flag')) {
          const fv = a?.k === 'flag' ? a : b;
          const n = fv === a ? b : a;
          push(n === 0 ? { ...fv, neg: !fv.neg } : fv); // `flag == false` negates
        } else if (/^(cgt|clt)/.test(op) && (a?.k === 'flag' || b?.k === 'flag')) {
          // `flag > 0` is how a bool is turned back into a number before it is stashed somewhere;
          // it still stands for the flag, and `0 < flag` is the same test the other way round
          const fv = a?.k === 'flag' ? a : b;
          const n = fv === a ? b : a;
          push(n === 0 ? fv : UNKNOWN);
        }
        else push(UNKNOWN);
        continue;
      }
      if (POP2_BRANCH.test(op)) {
        const b = pop(); const a = pop();
        const base = op.replace(/\.un|\.s/g, '');
        if (this.onBackJump && x.operand < x.offset) this.onBackJump(x, a, b, base, ctx());
        if (isNum(a) && isNum(b)) {
          // known outcome: take exactly one path (linear mode: the skipped block is dead instead)
          if (BR_CMP[base](a, b) && x.operand > x.offset) { noteJump(x.operand, true); if (this.linear) { if (!this.noDead && !process.env.TL_NO_DEAD) openDead(x.operand); } else jumpTo(x.operand); }
          else if (this.linear && x.operand > x.offset) noteJump(x.operand, true); // the block it skips is walked anyway: give it the stack it would have had
          continue;
        }
        noteJump(x.operand, true);
        if (caseMap) {
          // `if (item.DamageType != DamageClass.Melee) return;` — the class is the key here
          const dcof = a?.k === 'dcof' ? a : b?.k === 'dcof' ? b : null;
          const dcv = dcof ? (dcof === a ? b : a) : null;
          if (dcof && dcv?.k === 'dc' && x.operand > x.offset && (EQ_BRANCH.test(op) || NE_BRANCH.test(op))) {
            applyKeyBranch({ slot: dcof.slot, match: { dcIs: dcv.name } }, x.operand, EQ_BRANCH.test(op));
          }
          const key = a?.k === 'key' ? a : b?.k === 'key' ? b : null;
          // (a class test is a key, not a condition: leaving a region open here would mark the
          // change "conditional" and hold it back from the items it plainly applies to)
          if (!key && !dcof && x.operand > x.offset) {
            const fv = a?.k === 'flag' ? a : b?.k === 'flag' ? b : null;
            const n = fv === a ? b : a;
            // `flag == 0` / `flag != 1`: the fall-through runs when the flag is false
            const fallTrue = !isNum(n) ? true : NE_BRANCH.test(op) ? n !== 0 : n === 0;
            flagRegion(x.operand, fv, !fallTrue);
          }
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
              // `(uint)(type - 586) <= 1` is `type in [586, 587]`: the jump target gets that range
              if (op.endsWith('.un') && key.offset !== undefined && (base === 'ble' || base === 'blt') && keyIsA && x.operand > x.offset) {
                const hi = base === 'ble' ? val : val - 1;
                for (const g of groups) addGroup(x.operand, [...others(g, k), { slot: k.slot, lo: key.offset, hi }]);
              }
            }
          }
        }
        continue;
      }
      if (POP1_BRANCH.test(op)) {
        const c = pop();
        const isTrue = op.startsWith('brtrue');
        // A resolved `Mod` instance is a mod that is loaded, so `if (thorium != null)` is a question
        // already answered — and leaving it open made every recipe edit under a `sots && thorium`
        // guard read as conditional and get dropped.
        if (isNum(c) || c === null || c?.k === 'mod') {
          const truthy = isNum(c) ? c !== 0 : c?.k === 'mod';
          if (truthy === isTrue && x.operand > x.offset) { noteJump(x.operand, true); if (this.linear) { if (!this.noDead && !process.env.TL_NO_DEAD) openDead(x.operand); } else jumpTo(x.operand); }
          // …and a jump the value says is *not* taken still has to leave the stack the block it
          // skips over will be walked with. `IsCorruption ? 86 : 1329` ends the live arm with a
          // `br` over the dead one, and a `br` clears the stack: without this the dead arm ran on
          // an empty stack, ate the recipe off it and every call after it in the method was lost.
          else if (this.linear && x.operand > x.offset) noteJump(x.operand, true);
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
            flagRegion(x.operand, c, isTrue); // brtrue skips the block when the flag is true: the block is its negation
          }
        }
        continue;
      }
      if (op.startsWith('ldind.') && stack[stack.length - 1]?.k === 'stat') {
        // a hook may know the current value of a stat ref (velocity.X *= k keeps k)
        const v = this.onLoad(stack[stack.length - 1], '@ind', ctx());
        if (v !== undefined) { pop(); push(v); continue; }
      }
      if (op.startsWith('ldind.')) {
        const ref = pop();
        // the address of a tracked slot reads back as that slot, so `velocity.Y += k` written
        // through a by-ref helper still arrives at the store as an adjustment of velocity.Y
        push(ref?.k === 'stat' ? 0 : ref?.k === 'adj' ? ref : ref?.k === 'ref' ? ref.get() : ref?.k === 'obj' ? ref : UNKNOWN);
        continue;
      }
      if (op.startsWith('stind.')) {
        const val = pop(); const ref = pop();
        if ((ref?.k === 'stat' || ref?.k === 'adj') && !this.dead) this.onStore(ref, '@ind', val, ctx());
        else if (ref?.k === 'ref') ref.set(val, ctx());
        continue;
      }
      if (op === 'newarr') {
        const n = pop();
        let elem;
        try { elem = owner.resolve(x.operand)?.fullName; } catch { /* unknown element type */ }
        push({ k: 'arr', items: isNum(n) ? new Array(n).fill(UNKNOWN) : [], elem });
        continue;
      }
      if (op.startsWith('stelem')) {
        const val = pop(); const idx = pop(); const arr = pop();
        if (arr?.k === 'arr' && isNum(idx)) arr.items[idx] = val;
        if (arr?.k === 'arr' && arr.tag && !this.dead) this.onArrayStore(arr, idx, val, ctx());
        continue;
      }
      if (op === 'ldelema' || op.startsWith('ldelem')) {
        const idx = pop(); const arr = pop();
        // the address of an element: a struct built in place (`stats[i] = new WingStats(…)` compiles to
        // ldelema + call .ctor) lands in the array, and a tagged array hears about it
        if (op === 'ldelema' && arr?.k === 'arr' && (isNum(idx) || arr.tag)) {
          push({ k: 'ref', get: () => (isNum(idx) ? arr.items[idx] : undefined), set: (v) => { if (isNum(idx)) arr.items[idx] = v; if (arr.tag && !this.dead) this.onArrayStore(arr, idx, v, ctx()); } });
          continue;
        }
        // an array whose every element *is* the key the case tracker keys on: `player.buffType[i]`
        // in `Player.UpdateBuffs`, where the whole buff table is one if-chain over that element
        if (arr?.k === 'arr' && arr.tag === 'keys') push({ k: 'key', slot: arr.slot ?? 0 });
        else if (arr?.k === 'arr' && isNum(idx)) push(arr.items[idx]);
        else if (arr?.k === 'arr' && arr.tag === 'players') push(PLAYER); // Main.player[i]
        else if (arr?.k === 'arr' && arr.tag === 'npcs') push(NPC); // Main.npc[i]
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
        if (this._staticCapture || this.onStaticStore) {
          const f = owner.resolve(x.operand);
          if (f && this._staticCapture) this._staticCapture.set(f.name, val);
          if (f && this.onStaticStore && !this.dead) this.onStaticStore(f, val, ctx());
        }
        continue;
      }
      if (op === 'ldfld' || op === 'ldflda') {
        const f = owner.resolve(x.operand);
        let recv = pop();
        if (recv?.k === 'ref') recv = recv.get();
        const fctx = { ...ctx(), field: f };
        const v = this.loadField(recv, f, fctx);
        // `TryGetMod("CalamityMod", out this.calamity)` writes its answer through a field address:
        // an address the machine has no value for is a ref, or the out-parameter lands nowhere and
        // the mod stays unknown. An address it *does* know (a hook's stat sentinel) stays itself.
        if (op === 'ldflda' && v === UNKNOWN) push({ k: 'ref', get: () => this.loadField(recv, f, fctx), set: (x) => this.storeField(recv, f, x, fctx) });
        else push(v);
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
        // delegate construction: new Func<…>(target, ldftn method) keeps the method for gate scans
        // (the ctor of an external generic delegate often has no readable signature: peek instead)
        if (n === 0 && stack[stack.length - 1]?.k === 'fn') { const f = pop(); const target = pop(); push({ k: 'delegate', method: f.method, asm: f.asm, target }); continue; }
        for (let i = 0; i < n; i++) args.unshift(pop());
        if (n === 2 && args[1]?.k === 'fn') { push({ k: 'delegate', method: args[1].method, asm: args[1].asm, target: args[0] }); continue; }
        const made = callee ? this.onNew(callee, args, ctx()) : undefined;
        // `new List<int>(pool)` keeps what it was handed: vanilla copies the Angler's reward pool
        // before striking the accessories you already own off it
        const copied = args.length === 1 && (args[0]?.list || args[0]?.items) ? [...(args[0].list ?? args[0].items)] : undefined;
        push(made !== undefined ? made : { k: 'obj', name: callee?.declaringType?.fullName ?? callee?.declaringType?.name ?? '?', args, props: {}, ...(copied ? { list: copied } : {}) });
        continue;
      }
      if (op === 'call' || op === 'callvirt') {
        const callee = owner.resolve(x.operand);
        if (!callee?.sig) { push(UNKNOWN); continue; }
        const n = callee.sig.params.length;
        const args = [];
        for (let i = 0; i < n; i++) args.unshift(pop());
        let recv = callee.sig.hasThis ? pop() : undefined;
        // `new short[] { ... }` compiles to newarr + RuntimeHelpers.InitializeArray(arr, ldtoken blob)
        if (callee.name === 'InitializeArray' && args[0]?.k === 'arr' && args[1]?.k === 'token') { fillArray(owner, args[0], args[1].token); continue; }
        if (recv?.k === 'ref') {
          if (recv.get() === undefined || recv.get() === UNKNOWN) recv.set({ k: 'obj', name: 'struct', props: {} });
          recv = recv.get();
        }
        const result = this.call(callee, recv, args, { ...ctx(), recv, virt: op === 'callvirt' });
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
    // a field the mod fills in once at load time — whichever instance it is read off, that is what
    // is in it (CalValEX reads `instance.calamity` through a singleton the miner never builds)
    const lf = this.loadFields?.get(`${f.declaringType?.fullName ?? ''}::${f.name}`);
    if (lf !== undefined) return lf;
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
            // SetStaticDefaults counts as load-time setup: an addon's item looks the mods it
            // bridges up there (`TryGetMod("CalamityBardHealer", out calBardHealer)`) and its
            // AddRecipes then asks that mod for the ingredient
            if ((m.name === '.ctor' || m.name === 'Load' || m.name === 'OnModLoad' || m.name === 'SetStaticDefaults') && this.asm.methodBody(m)?.il.length < 20000 && this.asm.methodSig(m).params.length === 0) {
              // …from depth zero, because a constructor chain is one object setting itself up, not
              // a call graph worth rationing. Started one below the ceiling, only a ctor that
              // stores its own fields was ever read: Thorium's bard prefixes pass their numbers to
              // `BardPrefix(dmg, shootSpeed, useTime, …)` through a second overload, one hop too
              // far, and eight of the twelve came out with no stats at all and were dropped.
              this.run(m, THIS, [], this.asm, 0);
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
    // a static the mod fills in at load time — `evalLoadStatics` reads exactly these `stsfld`
    // stores, and a `Load` that caches another mod's item ids is where the keys of its balancing
    // hooks come from (`ItemBalancer.throwingGuideType = thorium.Find<ModItem>("ThrowingGuide")`)
    const lf = this.loadFields?.get(`${f.declaringType?.fullName ?? ''}::${f.name}`);
    if (lf !== undefined) return lf;
    if (FLAG_NAMES.test(f.name)) return { k: 'flag', name: f.name };
    let td = f.declaringType?.def;
    let asm = this.asm;
    // …and a constant an addon reads out of the mod it extends. Ragnarok's rebalancing takes
    // Thorium's own `TheRing.FlatDamage` back off the ring before granting a percentage instead;
    // leaving that `ldsfld` unknown dropped the subtraction and kept a flat bonus the rework had
    // just removed — the overcount, in the one place it would not show up as a missing effect.
    // (not gated on `crossAsm`: reading a constant out of a sibling is a `.cctor` under a length
    // cap, nothing like inlining that mod's methods, and every extractor wants the right number)
    if (!td && f.declaringType?.kind === 'typeRef' && this.asm.siblings) {
      const other = this.asm.siblings.get(f.declaringType.assembly);
      const def = other && other !== this.asm ? other.typeByName.get(f.declaringType.fullName) : null;
      if (def) { td = def; asm = other; }
    }
    if (!td || (asm === this.asm && owner !== this.asm)) return UNKNOWN;
    let map = this.statics.get(td);
    if (!map) {
      map = new Map();
      this.statics.set(td, map);
      const cctor = td.methods.find((m) => m.name === '.cctor');
      if (cctor && asm.methodBody(cctor)?.il.length < 20000) {
        const saved = this._staticCapture;
        const savedLinear = this.linear;
        const savedCases = this.cases;
        const savedGroups = this.caseGroups;
        this._staticCapture = map;
        this.linear = false;
        try {
          this.run(cctor, undefined, [], asm, this.maxDepth - 1);
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
    if (NUMERIC.test(declName)) {
      const nv = numberOp(name, recv, args);
      if (nv !== undefined) return nv;
    }
    if (MATHY.test(declName)) {
      const mv = mathOp(name, args);
      if (mv !== undefined) return mv;
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
        // null, not "could not read": a mod that is not in the pack is a mod that is not there, and
        // the `out` slot has to say so or the caller's null check goes unresolved
        if (args[1]?.k === 'ref') args[1].set(this.enabledMods.has(args[0]) ? { k: 'mod', name: args[0] } : null);
        return this.enabledMods.has(args[0]) ? 1 : 0;
      }
      if (name === 'GetMod' && typeof args[0] === 'string') return this.enabledMods.has(args[0]) ? { k: 'mod', name: args[0] } : null;
    }
    if (recv?.k === 'mod' && (name === 'Find' || name === 'TryFind') && typeof args[0] === 'string') {
      // `cal.Find<ModNPC>("HiveMind")` is an NPC, not an item: what is asked for decides the kind
      const kind = simpleName(this.typeArg(callee.typeArgs?.[0], ctx) ?? '').replace(/^Mod/, '');
      const t = { k: 'type', fn: /^(NPC|Tile|Projectile|Buff)$/.test(kind) ? `${kind}Type` : 'ItemType', name: args[0], id: `${recv.name}:${args[0]}` };
      if (name === 'TryFind') { if (args[1]?.k === 'ref') args[1].set(t); return 1; }
      return t;
    }
    if (declName === 'Terraria.ModLoader.ModContent' && name === 'TryFind' && typeof args[0] === 'string' && args[0].includes('/')) {
      const [m, c] = args[0].split('/');
      if (this.enabledMods && !this.enabledMods.has(m)) return 0;
      if (args[1]?.k === 'ref') args[1].set({ k: 'type', fn: 'ItemType', name: c, id: `${m}:${c}` });
      return 1;
    }
    // a random pick out of a list is one of the things in it, wherever it is asked for
    if (/^(NextFromList|SelectRandom)$/.test(name)) {
      const arr = args.find((a) => a?.k === 'arr');
      if (arr) return { k: 'oneof', items: arr.items.filter((v) => isNum(v) || v?.k === 'type') };
    }
    if (recv?.k === 'type' && name === 'get_Type') return recv;
    if (recv?.k === 'mod' && name === 'get_Name') return recv.name;
    // `this.Mod.TryFind<ModItem>("ZephyrWingsCosmetic", out item)`: a mod's own content by name,
    // which is how it reaches a class another mod may or may not have loaded
    if (recv === THIS && name === 'get_Mod') return { k: 'mod', name: (ctx.owner ?? this.asm).name };
    if (!callee.sig.hasThis && FLAG_NAMES.test(name)) return { k: 'flag', name };

    // List<T> / Dictionary<K,V> built in code: keep their contents.
    if (recv?.k === 'obj') {
      if (name === 'Add' && args.length === 1) { (recv.list ??= []).push(args[0]); return undefined; }
      if (name === 'Add' && args.length === 2 && (typeof args[0] === 'string' || isNum(args[0]))) { recv.props[args[0]] = args[1]; return undefined; }
      if (name === 'set_Item' && args.length === 2 && (typeof args[0] === 'string' || isNum(args[0]))) { recv.props[args[0]] = args[1]; return undefined; }
      if (name === 'get_Item' && args.length === 1 && (typeof args[0] === 'string' || isNum(args[0]))) {
        return recv.props[args[0]] ?? recv.list?.[args[0]] ?? UNKNOWN;
      }
      // a list built in code and then indexed at random is one of the things in it — vanilla builds
      // the Angler's accessory reward pool that way and picks a member for `reward.SetDefaults`
      if (name === 'get_Item' && args.length === 1 && recv.list?.length) return { k: 'oneof', items: recv.list.filter((v) => isNum(v)) };
      if (name === 'TryGetValue' && args.length === 2 && args[1]?.k === 'ref') {
        const v = recv.props[args[0]];
        if (v !== undefined) { args[1].set(v); return 1; }
        return UNKNOWN;
      }
      if (name === 'ContainsKey' && args.length === 1) return recv.props[args[0]] !== undefined ? 1 : UNKNOWN;
      if (name === 'get_Count') return recv.list?.length ?? UNKNOWN;
      if (name === 'ToArray' && recv.list) return { k: 'arr', items: [...recv.list] };
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
      // …but UNKNOWN from a hook on `this` is "I have no opinion", not an answer: the fall-through
      // below inlines the real getter, which is where the value actually is. Thorium's gem rings
      // add `GetDamage(cls).Flat += this.StatIncrease`, a two-instruction `return 1` on their base
      // class, and taking the hook's UNKNOWN as final made the whole flat bonus unreadable.
      if (v !== undefined && !(recv === THIS && v === UNKNOWN)) return v;
      // a property the object does not carry is UNKNOWN — unless its concrete type is known, in
      // which case the getter itself is the answer (a sheath's `DamageMultiplier` is a `return 12f`)
      if (recv?.k === 'obj' && (recv.props[name.slice(4)] !== undefined || !recv.td)) return recv.props[name.slice(4)] ?? UNKNOWN;
      if (recv?.k === 'itemarg') return { k: 'prop', slot: recv.slot, path: [name.slice(4)] };
      // a getter on `this` — or on an object whose concrete type is known — may be a real
      // (virtual) method: fall through and inline it
      if (recv !== THIS && !recv?.td) return UNKNOWN;
    }

    // a getter over a field the mod filled in at load time (`CalValEX.Calamity` is the `calamity`
    // field `Load` looked up): answer it here rather than spending a frame inlining the getter,
    // which is what the depth limit runs out on three helpers deep into a cross-mod lookup
    // (a static one only: an instance getter is the type's own logic, and `JestersMask2` says which
    // evil its recipe is for by overriding `IsCorruption`)
    if (this.loadFields && !callee.sig.hasThis && args.length === 0 && /^get_[A-Z]/.test(name)) {
      const p = name.slice(4);
      const v = this.loadFields.get(`${declName}::${p}`) ?? this.loadFields.get(`${declName}::${p[0].toLowerCase()}${p.slice(1)}`);
      if (v !== undefined) return v;
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
    // …and, once the walk has already crossed into the extended mod, its own methods too: Thorium's
    // `BardItem.SetDefaults` calls `SetBardDefaults` calls the virtual `SafeSetBardDefaults`, all
    // three inside ThoriumMod, and the addon's item only ever overrides the last one. Reading only
    // same-assembly calls stopped at the first hop and left every such weapon with no stats at all.
    if (def && (ctx.owner === this.asm || (this.crossAsm && ctx.owner !== this.asm))) {
      let owner = ctx.owner;
      // …but only for a *virtual* call. `base.Tooltip` inside an override compiles to a plain
      // `call` on the base, and sending that back to the override is infinite recursion: Thorium's
      // sheaths (`TitanSlayerSheath.Tooltip => base.Tooltip.WithFormatArgs(…)`) ran themselves down
      // to the depth limit and every one of them came out with raw `{0}` placeholders.
      if (ctx.virt !== false && callee.sig.hasThis && recv === THIS && this.concreteType && (def.flags & 0x40)) {
        const ov = this.findOverride(this.concreteType, def, owner);
        if (ov) { def = ov; owner = this.asm; }
      }
      // …and a virtual call on a value whose concrete type is known dispatches there too: Thorium's
      // sheaths read their numbers off `SheathDataLoader.Get<LeatherSheathData>()`, and stopping at
      // the abstract `SheathData` getter left every sheath's tooltip as raw `{0}` placeholders
      if (callee.sig.hasThis && recv?.k === 'obj' && recv.td && (def.flags & 0x40)) {
        const ov = this.findOverride(recv.td, def, owner);
        if (ov) { def = ov; owner = this.asm; }
      }
      const body = owner.methodBody(def);
      if (body && body.il.length < 30000) return this.runNested(def, recv, args, owner, ctx.depth + 1, (callee.typeArgs ?? []).map((t) => this.typeArg(t, ctx)));
    }
    // …and into the assembly of the mod an addon extends: Ragnarok's scythes are set up by
    // `ThoriumMod.ScytheItem.SetDefaultsToScythe`, which is where their healer damage class, their
    // use time and half their stats live. Without it they are weapons of no class at all.
    if (!def && this.crossAsm && callee.declaringType?.kind === 'typeRef' && this.asm.siblings) {
      const other = this.asm.siblings.get(callee.declaringType.assembly);
      const td = other && other !== this.asm ? other.typeByName.get(callee.declaringType.fullName) : null;
      const target = td ? this.findMethod(td, name, args.length, other) : null;
      const body = target ? other.methodBody(target) : null;
      // (a setup helper is short; a whole hook of the other mod is not what this is for)
      if (body && body.il.length < 4000) return this.runNested(target, recv, args, other, ctx.depth + 1, (callee.typeArgs ?? []).map((t) => this.typeArg(t, ctx)));
    }
    return UNKNOWN;
  }

  /**
   * A generic method's type argument, with `!!N` resolved against the call that got us here —
   * CalValEX asks Calamity for an NPC through `CalamityContent<ModNPC>(name, out npc)`, and inside
   * that helper the lookup reads `TryFind<!!0>`, which is only an NPC because the caller said so.
   */
  typeArg(t, ctx) {
    const m = /^!!(\d+)$/.exec(String(t ?? ''));
    return m ? ctx?.typeArgs?.[+m[1]] : t;
  }

  /** Property chains off a GlobalItem hook's Item argument, turned into case keys. */
  keyChain(callee, recv, args) {
    const name = callee.name;
    if (recv?.k === 'itemarg') {
      if (name === 'get_ModItem') return { k: 'moditem', slot: recv.slot };
      if (name === 'CountsAsClass' && callee.kind === 'methodSpec') return { k: 'keycmp', slot: recv.slot, match: { cls: simpleName(callee.typeArgs[0]) } };
      if (name === 'CountsAsClass' && args[0]?.k === 'dc') return { k: 'keycmp', slot: recv.slot, match: { cls: args[0].name } };
      // `item.DamageType == DamageClass.Melee` keys as surely as `CountsAsClass<T>()` does: it is
      // how Calamity picks out true melee (`shoot == 0 && DamageType == Melee`), and reading it as
      // an unresolved guard put that reassignment on every item in the game that does not shoot
      if (name === 'get_DamageType') return { k: 'dcof', slot: recv.slot };
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
  runNested(method, recv, args, owner, depth, typeArgs = null) {
    const savedLinear = this.linear;
    this.linear = false;
    try {
      return this.run(method, recv, args, owner, depth, typeArgs);
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
  findOverride(concrete, def, owner = this.asm) {
    const sig = owner.methodSig(def);
    let cur = concrete;
    for (let i = 0; i < 32 && cur; i++) {
      if (owner === this.asm && cur === def.declaringType) return null;
      const m = cur.methods.find((x) => x.name === def.name && this.asm.methodSig(x).params.length === sig.params.length && this.asm.methodBody(x));
      if (m) return m;
      const base = this.asm.baseOf(cur);
      cur = base?.kind === 'typeDef' ? base.def : null;
    }
    return null;
  }
}

const NUMERIC = /^System\.(Single|Double|Decimal|U?Int(16|32|64)|S?Byte)$/;

/**
 * A number turned into text and back: `x.ToString("N1")`, `float.Parse(s)`.
 *
 * Mods write their own "print this stat" helpers over exactly these two — Calamity's `Round` is
 * `Single.Parse(x.ToString(fmt)).ToString()`, and `ToPercent`, `ToStealth` and `FramesToSeconds`
 * are one multiply on top of it. Answering the two BCL calls lets all of them evaluate on their
 * own IL, so a set bonus that states `+{0} maximum stealth` gets its number instead of a hook per
 * helper — and gets the game's own rounding, which drops the trailing zero `N1` writes.
 */
function numberOp(name, recv, args) {
  if (name === 'Parse' && typeof args[0] === 'string') {
    const n = Number(args[0].replace(/,/g, ''));
    return Number.isNaN(n) ? undefined : n;
  }
  if (name !== 'ToString' || !isNum(recv)) return undefined;
  const fmt = typeof args[0] === 'string' ? args[0] : null;
  if (!fmt) return String(recv); // C#'s default is the shortest round-tripping form, as JS prints
  // "N" groups thousands, "F" does not; both default to 2 decimals with no digit count
  const m = /^([NnFf])(\d*)$/.exec(fmt);
  if (!m) return undefined;
  const d = m[2] === '' ? 2 : +m[2];
  return /[Nn]/.test(m[1])
    ? recv.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
    : recv.toFixed(d);
}

const MATHY = /^(System\.Math[F]?|Microsoft\.Xna\.Framework\.MathHelper|.*\.MathHelper)$/;
/**
 * `Math.Round(cooldown / 60.0, 2)` — the arithmetic a tooltip's own numbers are built from.
 * Constants only: anything with an unknown in it stays unknown.
 */
function mathOp(name, args) {
  if (!args.length || !args.every((a) => isNum(a))) return undefined;
  const [a, b, c] = args;
  switch (name) {
    case 'Round': return b === undefined ? Math.round(a) : Math.round(a * 10 ** b) / 10 ** b;
    case 'Floor': return Math.floor(a);
    case 'Ceiling': return Math.ceil(a);
    case 'Truncate': return Math.trunc(a);
    case 'Abs': return Math.abs(a);
    case 'Sqrt': return Math.sqrt(a);
    case 'Pow': return a ** b;
    case 'Min': return Math.min(a, b);
    case 'Max': return Math.max(a, b);
    case 'Clamp': return Math.min(Math.max(a, b), c);
    default: return undefined;
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

/**
 * Cross-mod id tables: the `static int` fields a mod fills in at load time out of another mod's
 * content (CalValEX's `CalNPCID.HiveMind = NPCRelation("HiveMind", 13)`, which is Calamity's NPC
 * when Calamity is in the pack and a vanilla fallback when it is not). Nothing keyed on one can be
 * read until the pack is known — CalValEX hangs every one of its wing drops off exactly these.
 * @returns {Map<string, any>} "Type::Field" → value
 */
export function evalLoadStatics(asm, { tml = null, enabledMods = null } = {}) {
  const out = new Map();
  for (const td of asm.types) {
    for (const m of td.methods) {
      if (!/^(Load|PostSetupContent)$/.test(m.name)) continue;
      let body;
      try { body = asm.methodBody(m); } catch { continue; }
      if (!body) continue;
      let il;
      try { il = decodeIL(body.il); } catch { continue; }
      if (!il.some((x) => x.op === 'stsfld' || x.op === 'stfld' || x.op === 'ldflda')) continue;
      const keep = (val) => val?.k === 'type' || val?.k === 'mod' || isNum(val);
      // `Load` starts with `instance = this`, and every later read of the singleton goes through it
      const self = asm.derivesFrom(td, (b) => b.name === 'Mod' && b.namespace === 'Terraria.ModLoader') ? { k: 'mod', name: asm.name } : null;
      const machine = new Machine(asm, {
        tml,
        enabledMods,
        budget: 100000,
        maxDepth: 3,
        onStaticStore(f, val) { const v = val === THIS ? self : val; if (keep(v)) out.set(`${f.declaringType?.fullName ?? ''}::${f.name}`, v); },
        // the same table on the mod's own singleton rather than a static: `Load` is the one place
        // that writes them, so the field answers for every instance it is later read off
        onStore(recv, name, val, sctx) { if (recv === THIS && sctx?.field && keep(val)) out.set(`${sctx.field.declaringType?.fullName ?? ''}::${name}`, val); },
      });
      // deliberately without an `onStaticLoad` off this same map: letting the pass answer its own
      // reads decides branches the extractors were reading both ways on purpose, and whole blocks
      // of drops fall out of the ones it gets wrong. A table that needs another to resolve stays open.
      try { machine.run(m, THIS, []); } catch { /* partial is fine */ }
    }
  }
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
