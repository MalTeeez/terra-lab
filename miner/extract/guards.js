/**
 * Which parts of a method run only when some condition holds.
 *
 * A weapon's `Shoot` and a projectile's `AI` are both full of "…but only if": only on a stealth
 * strike, only on the right click, only on a one-in-ten roll. Read without the guard, every one of
 * those becomes something the weapon does on every use, which is the most optimistic reading
 * available and the source of a whole family of over-scores.
 *
 * Shared by `shoot.js` and `projectiles.js`, which is why it lives here rather than in either: the
 * projectile side needs the same reading and cannot import from the weapon side without a cycle.
 */
import { decodeIL, ldcValue } from '../clr/il.js';

/**
 * Ranges of a method guarded by a condition the miner can name, as `[{ lo, hi, on }]` — `on` marks
 * the side of the branch the condition holds on. `scan(ins, branchAt)` walks the IL and calls
 * `branchAt(i)` at each branch that consumes the condition, which is what differs between one guard
 * and the next; the region arithmetic below is the same for all of them.
 */
export function guardRanges(asm, m, scan) {
  const body = asm.methodBody(m);
  if (!body) return [];
  let ins;
  try { ins = decodeIL(body.il); } catch { return []; }
  const out = [];
  const byOffset = new Map(ins.map((x, i) => [x.offset, i]));
  // every forward if-block, so an inner else can be clamped to the block that encloses it: the
  // `br` that ends `if (bolts > 0) { … }` jumps to the end of the *outer* click check, and read
  // as the else's end it put the other click's whole code inside this branch
  const blocks = [];
  for (let i = 0; i < ins.length; i++) {
    const x = ins[i];
    if (!/^(brfalse|brtrue|beq|bne\.un|blt|ble|bgt|bge)(\.un)?(\.s)?$/.test(x.op) || x.operand <= x.offset) continue;
    blocks.push({ lo: ins[i + 1]?.offset ?? x.offset, hi: x.operand });
  }
  const clampElse = (target, elseEnd) => blocks.reduce((end, b) => (b.lo <= target && target < b.hi && b.hi < end && b.hi > target ? b.hi : end), elseEnd);
  /** `extra` rides along on both sides of the branch — a probability, say, for the guard that has one. */
  const branchAt = (i, extra = null) => {
    const x = ins[i];
    if (!x) return;
    const push = (r) => out.push(extra ? { ...r, ...extra } : r);
    // `brfalse` and `bne.un` both jump away when the condition fails, so the fall-through is the
    // side it holds on; `brtrue` and `beq` jump *to* that side.
    const isFalse = /^brfalse/.test(x.op) || /^bne\.un/.test(x.op);
    // a comparison branch jumps *to* the side its comparison holds on, like brtrue does
    if (!isFalse && !/^brtrue/.test(x.op) && !/^beq/.test(x.op) && !/^(blt|ble|bgt|bge)/.test(x.op)) return;
    const target = x.operand;
    if (target <= x.offset) return;
    const next = ins[i + 1]?.offset ?? x.offset;
    const ti = byOffset.get(target);
    const before = ti !== undefined ? ins[ti - 1] : null;
    const elseEnd = before && /^br(\.s)?$/.test(before.op) && before.operand > target ? clampElse(target, before.operand) : null;
    if (isFalse) {
      push({ lo: next, hi: target, on: true });
      if (elseEnd) push({ lo: target, hi: elseEnd, on: false });
    } else {
      push({ lo: next, hi: target, on: false });
      if (elseEnd) push({ lo: target, hi: elseEnd, on: true });
      else {
        // `if (cond) { ... return; }` - the block ends at its first terminator
        const end = ins.slice(ti).find((y) => /^(ret|br|br\.s|throw)$/.test(y.op));
        push({ lo: target, hi: end ? end.offset + 1 : Infinity, on: true });
      }
    }
  };
  scan(ins, branchAt);
  return out;
}

/**
 * The odds a `NextBool` guard passes, read off the constants pushed for its arguments.
 *
 *   NextBool()      1 in 2
 *   NextBool(n)     1 in n
 *   NextBool(a, b)  a in b
 *
 * The extension form carries the random itself as the first argument, and that is not a constant,
 * so taking the trailing constants handles both spellings without asking which one this is.
 */
function nextBoolChance(ins, i, callee) {
  const argc = callee?.sig?.params?.length ?? 0;
  const consts = [];
  for (let j = i - 1; j >= 0 && consts.length < argc; j--) {
    const v = ldcValue(ins[j]);
    if (typeof v !== 'number') break;
    consts.unshift(v);
  }
  const p = consts.length === 0 ? 0.5 : consts.length === 1 ? 1 / consts[0] : consts[0] / consts[1];
  return Number.isFinite(p) && p > 0 && p <= 1 ? p : null;
}

/**
 * Ranges of a method guarded by a `NextBool` roll, carrying the odds.
 *
 * Without this a one-in-ten branch is a certainty: the machine cannot say which way the roll went,
 * so a projectile fired only on that roll was counted on every use. It is why Calamity can afford
 * to pay a rare projectile fifteen times the weapon's damage and why the model had to treat a
 * multiplier that large as unreadable — the rarity was the part that went missing, not the damage.
 */
export function chanceRanges(asm, m) {
  return guardRanges(asm, m, (ins, branchAt) => {
    for (let i = 0; i < ins.length; i++) {
      const x = ins[i];
      if (x.op !== 'call' && x.op !== 'callvirt') continue;
      const r = asm.resolve(x.operand);
      if (r?.name === 'Next' && /UnifiedRandom/.test(r.declaringType?.fullName ?? '')) {
        // `Main.rand.Next(N) == K` and its relatives: the roll is a share of N — compared where
        // it is rolled, or parked in a local and compared later
        const N = constOf(ins[i - 1]);
        if (!(N > 1)) continue;
        const uses = [];
        if (/^stloc/.test(ins[i + 1]?.op ?? '')) {
          const nx = ins[i + 1];
          const slot = nx.op === 'stloc.s' || nx.op === 'stloc' ? nx.operand : +nx.op.slice(6);
          for (let j = i + 2; j < ins.length; j++) { const y = ins[j]; if (y.op === 'ldloc.s' || y.op === 'ldloc' ? y.operand === slot : y.op === `ldloc.${slot}`) uses.push(j); }
        } else uses.push(i);
        for (const u of uses) {
          const K = constOf(ins[u + 1]);
          const cmp = ins[u + 2]?.op ?? '';
          if (K === undefined) continue;
          let p = null;
          if (/^(ceq|beq|bne\.un)/.test(cmp)) p = 1 / N;
          else if (/^(clt|blt)/.test(cmp)) p = K / N;
          else if (/^(cgt|bgt)/.test(cmp)) p = (N - 1 - K) / N;
          else if (/^bge/.test(cmp)) p = (N - K) / N;
          else if (/^ble/.test(cmp)) p = (K + 1) / N;
          if (!(p > 0 && p < 1)) continue;
          // the branch follows the compare directly, or the compare feeds a branch
          branchAt(/^(ceq|clt|cgt)/.test(cmp) ? u + 3 : u + 2, { p });
        }
        continue;
      }
      if (r?.name !== 'NextBool') continue;
      const p = nextBoolChance(ins, i, r);
      if (p === null) continue;
      followLoads(ins, i, branchAt, { p });
    }
  });
}

/**
 * How many of a projectile the player may own at once, from the near-universal shape
 * `player.ownedProjectileCounts[type] < N`.
 *
 * It is the fact that decides what a persistent weapon is really worth. A cloud you drop, a tether
 * you maintain, a wall of thorns: what they do per second is the hit rate of *one* of them times how
 * many are alive, and how many are alive is this number — not how many the weapon throws per use,
 * and not a flat share of the fight. Without it the model has to guess an uptime for the whole
 * archetype, which is the same guess for a cloud that lasts one second and one that lasts ten.
 *
 * The same spelling appears in `CanUseItem` (the weapon refusing to fire another) and in the
 * projectile's own `AI` (the projectile killing the oldest of its kind), so one reader serves both.
 * @returns {number|undefined}
 */
export function ownedCapOf(asm, m) {
  const body = m && asm.methodBody(m);
  if (!body) return undefined;
  let ins;
  try { ins = decodeIL(body.il); } catch { return undefined; }
  let cap;
  for (let i = 0; i < ins.length; i++) {
    const f = ins[i].op === 'ldfld' ? asm.resolve(ins[i].operand) : null;
    if (f?.name !== 'ownedProjectileCounts') continue;
    // …[index] then a compare against the cap: `< N` and `<= N-1` are the two spellings
    for (let j = i + 1; j < Math.min(i + 12, ins.length); j++) {
      const n = ldcValue(ins[j]);
      if (typeof n !== 'number') continue;
      const op = ins[j + 1]?.op ?? '';
      // The *largest* of them, not the first. A method can ask two different questions of the same
      // counter: Marine Wine Glass's `CanPlayInstrument` opens with the right click's "is there at
      // least one glass to shatter" (`>= 1`) and only then states the left click's cap of six, and
      // both spell `bge`, so the opcode alone cannot tell a minimum from a maximum. Where the two
      // appear together the cap is the bigger number; where only a minimum of one appears this
      // returns the same 1 it always did.
      if (/^(clt|blt|bge)/.test(op)) cap = Math.max(cap ?? 0, 1, n);
      else if (/^(cgt|ble|bgt)/.test(op)) cap = Math.max(cap ?? 0, 1, n + 1);
      break;
    }
  }
  return cap;
}

// ---- the guards that carry a gate -------------------------------------------------------------

/** A numeric constant an instruction pushes: ints and floats both (`ai[]` is float). */
const constOf = (x) => { if (!x) return undefined; const v = ldcValue(x); if (typeof v === 'number') return v; return x.op === 'ldc.r4' || x.op === 'ldc.r8' ? x.operand : undefined; };
/** Any conditional branch. */
const COND = /^(brfalse|brtrue|beq|bne\.un|blt|ble|bgt|bge)(\.un)?(\.s)?$/;
const shortOf = (decl) => String(decl ?? '').split('.').pop();
/**
 * A condition stored to a local and branched on later: call `branchAt` at every branch that reads
 * the local back, or at the branch right after the value when it is consumed directly.
 */
export function followLoads(ins, i, branchAt, extra) {
  const nx = ins[i + 1];
  if (nx && /^stloc/.test(nx.op)) {
    const slot = nx.op === 'stloc.s' || nx.op === 'stloc' ? nx.operand : +nx.op.slice(6);
    for (let j = i + 2; j < ins.length; j++) {
      const y = ins[j];
      const isLd = y.op === 'ldloc.s' || y.op === 'ldloc' ? y.operand === slot : y.op === `ldloc.${slot}`;
      if (isLd) branchAt(j + 1, extra);
    }
  } else branchAt(i + 1, extra);
}
/** The innermost of the ranges an offset sits inside. */
export const innermostAt = (ranges, o) => ranges.filter((r) => o >= r.lo && o < r.hi).sort((a, b) => (a.hi - a.lo) - (b.hi - b.lo))[0];

const storedCache = new WeakMap();
/** Does any method of the field's own type store to it? (the combo toggle is flipped in UseItem) */
function storedSomewhere(asm, f) {
  const td = f?.declaringType?.def ?? f?.declaringType; // a field ref names its type; the def carries the methods
  if (!td?.methods) return false;
  let m = storedCache.get(td);
  if (!m) { m = new Map(); storedCache.set(td, m); }
  if (m.has(f.name)) return m.get(f.name);
  let found = false;
  for (const meth of td.methods) {
    const body = asm.methodBody(meth);
    if (!body) continue;
    let ins;
    try { ins = decodeIL(body.il); } catch { continue; }
    if (ins.some((y) => y.op === 'stfld' && asm.resolve(y.operand)?.name === f.name)) { found = true; break; }
  }
  m.set(f.name, found);
  return found;
}

/**
 * What a compare or branch at `i` is reading, if it is a counter: `ai[n]`, `localAI[n]`, or a
 * numeric field of the mod's own type. Anything on a Terraria type (`timeLeft`, `frameCounter`,
 * `alpha`) is a duration or a state, not a counter, and is left alone.
 */
function counterAt(asm, ins, j) {
  const x = ins[j];
  if (!x) return null;
  if (/^ldelem/.test(x.op) || (/^ldind/.test(x.op) && /^ldelema/.test(ins[j - 1]?.op ?? ''))) {
    for (let q = j - 1; q >= Math.max(0, j - 4); q--) {
      if (ins[q].op !== 'ldfld') continue;
      const f = asm.resolve(ins[q].operand);
      return f?.name === 'ai' || f?.name === 'localAI' ? `${f.name}[${constOf(ins[q + 1]) ?? '?'}]` : null;
    }
    return null;
  }
  if (x.op === 'ldfld' || x.op === 'ldsfld') {
    const f = asm.resolve(x.operand);
    const decl = f?.declaringType?.fullName ?? '';
    if (!f || /^(Terraria|Microsoft|System)\./.test(decl)) return null;
    return f.name;
  }
  return null;
}

/**
 * A counter compared to a constant, feeding the branch at `i`: `counter % N == 0`, `counter >= K`,
 * `counter == K`. Returns the period and which side of the branch is the counter hitting its mark
 * (`truthyReached`: whether a truthy value on the stack means "reached").
 *
 * The syntax alone does not say what an event is — `ai[0] % 10` in `AI` is every ten ticks, a
 * field in `Shoot` every ten uses, a counter in `OnHitNPC` every ten hits — so the caller names
 * the domain, and `>= K` without a reset is a phase transition rather than a period (see
 * `counterRanges`). Off-by-one is read off the shape: `> K` is a period of K+1.
 */
/** A debug build parks every value in a local first: `stloc.N; ldloc.N` right before the use. */
const skipLocal = (ins, j) => {
  while (ins[j] && /^ldloc/.test(ins[j].op) && ins[j - 1] && /^stloc/.test(ins[j - 1].op)) {
    const ld = ins[j].op === 'ldloc.s' || ins[j].op === 'ldloc' ? ins[j].operand : +ins[j].op.slice(6);
    const st = ins[j - 1].op === 'stloc.s' || ins[j - 1].op === 'stloc' ? ins[j - 1].operand : +ins[j - 1].op.slice(6);
    if (ld !== st) break;
    j -= 2;
  }
  return j;
};

/** The instruction that produced the value a `ldloc` at `j` reloads: the one before its last store. */
const producerOf = (ins, j) => {
  const x = ins[j];
  if (!x || !/^ldloc/.test(x.op)) return j;
  const slot = x.op === 'ldloc.s' || x.op === 'ldloc' ? x.operand : +x.op.slice(6);
  for (let q = j - 1; q >= 0; q--) {
    const y = ins[q];
    const st = y.op === 'stloc.s' || y.op === 'stloc' ? y.operand : /^stloc\.\d$/.test(y.op) ? +y.op.slice(6) : null;
    if (st === slot) return q - 1;
  }
  return j;
};

function counterGuard(asm, ins, i, event) {
  const op = ins[i].op;
  let j = skipLocal(ins, i - 1);
  let neg = false;
  if (ins[j]?.op === 'ceq' && constOf(ins[j - 1]) === 0) { neg = true; j = skipLocal(ins, j - 2); }
  const cmp = ins[j]?.op ?? '';
  let truthy;
  let k;
  let n;
  if (/^(ceq|clt|cgt)(\.un)?$/.test(cmp)) {
    truthy = !/^clt/.test(cmp);
    j--;
    k = constOf(ins[j]);
    if (k === undefined) return null;
    n = /^cgt/.test(cmp) ? k + 1 : k;
    j--;
  } else if (/^(blt|ble|bgt|bge|beq)/.test(op)) {
    k = constOf(ins[j]);
    if (k === undefined) return null;
    truthy = !/^(blt|ble)/.test(op);
    n = /^bgt/.test(op) ? k + 1 : k;
    j--;
  } else if (/^bne\.un/.test(op)) {
    k = constOf(ins[j]);
    if (k === undefined) return null;
    truthy = true; // guardRanges reads bne.un as "jump away when not equal": the on side is equal
    n = k;
    j--;
  } else if (/^br(true|false)/.test(op)) {
    // a bool field of the mod's own type, branched on directly and flipped somewhere in the type:
    // the swing-A / swing-B combo, one arm per use. Only a use is a combo; a flag in a
    // projectile's AI or OnHitNPC is an "already done" latch, and stays unread.
    if (event === 'use' && ins[j]?.op === 'ldfld') {
      const f = asm.resolve(ins[j].operand);
      const decl = f?.declaringType?.fullName ?? '';
      if (f && !/^(Terraria|Microsoft|System)\./.test(decl) && storedSomewhere(asm, f)) return { n: 2, truthyReached: true, counter: f.name, alternation: true };
    }
    truthy = false; // the remainder itself: nonzero is "not yet"
  } else return null;
  if (neg) truthy = !truthy;
  let isRem = false;
  if (ins[j]?.op === 'rem' || ins[j]?.op === 'rem.un') {
    const N = constOf(ins[j - 1]);
    if (!(N > 1)) return null;
    n = N;
    j -= 2;
    isRem = true;
  } else if (k === undefined) return null;
  while (ins[j] && /^conv\./.test(ins[j].op)) j--;
  j = producerOf(ins, j);
  while (ins[j] && /^conv\./.test(ins[j].op)) j--;
  const counter = counterAt(asm, ins, j);
  if (!counter) return null;
  const counterField = ins[j]?.op === 'ldfld' || ins[j]?.op === 'ldsfld' ? asm.resolve(ins[j].operand) : null;
  // `state == K` on a field the method also advances is a state machine: one arm per state, and
  // the states are the constants it is compared against (`currentAttack` 0, 1, 2 → three arms)
  const equality = !isRem && (/^ceq/.test(cmp) || /^(beq|bne\.un)/.test(op));
  if (equality && !/\[/.test(counter) && counterField && storedSomewhere(asm, counterField)) {
    const states = new Set([k]);
    for (let q = 1; q < ins.length; q++) {
      if (ins[q - 1].op !== 'ldfld' || asm.resolve(ins[q - 1].operand)?.name !== counter) continue;
      const v = constOf(ins[q]);
      if (v !== undefined && /^(ceq|beq|bne\.un)/.test(ins[q + 1]?.op ?? '')) states.add(v);
    }
    n = Math.max(2, Math.max(...states) + 1);
  }
  if (!(n > 1) || !Number.isFinite(n)) return null;
  return { n: Math.round(n), truthyReached: truthy, counter };
}

/**
 * Ranges guarded by a counter hitting its mark, with the gate they carry:
 * `{ gate: { kind: 'threshold', n, event, reset }, reached }` — `reached` is the side the counter
 * is at its mark on, `reset` whether that side puts the counter back to zero (a period) or not (a
 * one-off transition: a charge finishing, a homing delay ending).
 */
export function counterRanges(asm, m, event) {
  const body = m && asm.methodBody(m);
  if (!body) return [];
  let ins;
  try { ins = decodeIL(body.il); } catch { return []; }
  const ranges = guardRanges(asm, m, (all, branchAt) => {
    for (let i = 0; i < all.length; i++) {
      if (!COND.test(all[i].op)) continue;
      const g = counterGuard(asm, all, i, event);
      if (g) branchAt(i, { gate: { kind: 'threshold', n: g.n, event, reset: false }, truthyReached: g.truthyReached, counter: g.counter });
    }
  });
  for (const r of ranges) {
    r.reached = r.truthyReached ? r.on : !r.on;
    delete r.truthyReached;
    if (!r.reached) continue;
    // a store of 0 to the same counter inside the reached side
    const arr = /^(ai|localAI)\[/.exec(r.counter)?.[1];
    for (let q = 0; q < ins.length; q++) {
      const x = ins[q];
      if (x.offset < r.lo || x.offset >= r.hi) continue;
      let v = q - 1;
      while (ins[v] && /^conv\./.test(ins[v].op)) v--;
      if (constOf(ins[v]) !== 0) continue;
      if (x.op === 'stfld' && asm.resolve(x.operand)?.name === r.counter) { r.gate.reset = true; break; }
      if (arr && /^stelem/.test(x.op)) {
        const back = ins.slice(Math.max(0, q - 6), q).some((y) => y.op === 'ldfld' && asm.resolve(y.operand)?.name === arr);
        if (back) { r.gate.reset = true; break; }
      }
    }
  }
  return ranges;
}

/** The type argument of a generic call such as `ModContent.BuffType<T>()`, by name. */
const typeArgOf = (asm, x) => (x && (x.op === 'call' || x.op === 'callvirt') ? asm.resolve(x.operand)?.typeArgs?.[0] ?? null : null);

/**
 * Ranges guarded by something the player has to *have*: a buff (`player.HasBuff(X)`) or a flag on
 * a mod's own player class. `has` is the side the player has it on. Difficulty, target, owner and
 * initialisation guards are not requirements and are not read here.
 */
export function requiresRanges(asm, m, { typeArg = null } = {}) {
  return guardRanges(asm, m, (ins, branchAt) => {
    // `if (type == ProjectileID.Bullet) fire the orb; else fire the ammo`: which arm runs depends
    // on the ammo loaded, and the model grades a gun with its plain ammo — so the arm is a
    // requirement on the ammo's projectile, and the model decides whether the plain one meets it
    if (typeArg !== null) {
      for (let i = 0; i + 2 < ins.length; i++) {
        const x = ins[i];
        if (!((x.op === 'ldarg.s' && x.operand === typeArg) || x.op === `ldarg.${typeArg}`)) continue;
        const K = constOf(ins[i + 1]);
        const cmp = ins[i + 2].op;
        if (K === undefined) continue;
        if (/^(beq|bne\.un)/.test(cmp)) branchAt(i + 2, { gate: { kind: 'requires', what: 'ammoType', id: K }, truthyHas: true });
        else if (/^ceq/.test(cmp)) {
          let at = i + 3;
          let neg = false;
          if (constOf(ins[at]) === 0 && ins[at + 1]?.op === 'ceq') { neg = true; at += 2; }
          followLoads(ins, at - 1, branchAt, { gate: { kind: 'requires', what: 'ammoType', id: K }, truthyHas: !neg });
        }
      }
    }
    for (let i = 0; i < ins.length; i++) {
      if (!/^br(true|false)/.test(ins[i].op)) continue;
      let j = skipLocal(ins, i - 1);
      let neg = false;
      if (ins[j]?.op === 'ceq' && constOf(ins[j - 1]) === 0) { neg = true; j = skipLocal(ins, j - 2); }
      const x = ins[j];
      if (!x) continue;
      let gate = null;
      if (x.op === 'call' || x.op === 'callvirt') {
        const r = asm.resolve(x.operand);
        // the plain ammo is what the model grades a gun with: the other side needs ammo it is not holding
        if (r?.name === 'CheckWoodenAmmo') gate = { kind: 'requires', what: 'ammo', id: 'special', ammo: true };
      } else if (x.op === 'ldsfld') {
        const f = asm.resolve(x.operand);
        if (f && /^(zenithWorld|drunkWorld|remixWorld|getGoodWorld|tenthAnniversaryWorld|dontStarveWorld|notTheBeesWorld|noTrapsWorld)$/.test(f.name)) gate = { kind: 'requires', what: 'world', id: f.name };
      } else if (x.op === 'ldfld') {
        // `if (player.accMixtape) spawn six extra notes` — a ModPlayer flag a *piece of gear* sets,
        // which makes the spawn a fact about the loadout and not about the weapon. Thorium routes
        // every bard projectile through one `BardProjectile.OnHitNPC`, so five of these hang off
        // 123 of the 137 bard weapons that spawn anything at all — 568 children the model was
        // paying for whether or not the player owns a single one of the accessories. No other class
        // has one. The naming convention is the mods' own: `accX` for an accessory, `setX` for an
        // armour set bonus, on a type whose name ends in `Player`.
        const f = asm.resolve(x.operand);
        const decl = f?.declaringType?.name ?? '';
        if (f && /Player$/.test(decl) && /^(acc|set)[A-Z]/.test(f.name)) gate = { kind: 'requires', what: 'gear', id: f.name };
      }
      if (gate) branchAt(i, { gate, truthyHas: !neg });
    }
  }).map((r) => {
    // the wooden-ammo check holds on the side the plain ammo fires: that side needs nothing
    const has = r.truthyHas ? r.on : !r.on;
    delete r.truthyHas;
    return r.gate.ammo ? { ...r, has: !has } : { ...r, has };
  });
}

/** Guards that always hold for the player swinging the weapon: the owner and netcode checks. */
const ALWAYS = /^(myPlayer|whoAmI|netMode|dedServ|get_dedServ|get_myPlayer|direction|statMana|CanHit|CanHitLine|WithinBounds|DistanceSQ|Distance|LengthSquared|stealthStrike|StealthStrikeAvailable|owner|maxMinions|type|active|maxNPCs|dontTakeDamage|IsHostile|friendly|CanBeChasedBy|lifeMax|immortal|townNPC)$/;
export function alwaysRanges(asm, m) {
  return guardRanges(asm, m, (ins, branchAt) => {
    for (let i = 0; i < ins.length; i++) {
      if (!COND.test(ins[i].op)) continue;
      for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
        const x = ins[j];
        if (!/^(ldsfld|ldfld|call|callvirt)$/.test(x.op)) continue;
        if (ALWAYS.test(asm.resolve(x.operand)?.name ?? '')) { branchAt(i, { always: true }); break; }
      }
    }
  });
}

/** Ranges guarded by the hit being a crit (`hit.Crit`): `on` is the crit side. */
export function critRanges(asm, m) {
  return guardRanges(asm, m, (ins, branchAt) => {
    for (let i = 0; i < ins.length; i++) {
      if (!/^br(true|false)/.test(ins[i].op)) continue;
      let j = skipLocal(ins, i - 1);
      let neg = false;
      if (ins[j]?.op === 'ceq' && constOf(ins[j - 1]) === 0) { neg = true; j = skipLocal(ins, j - 2); }
      const x = ins[j];
      if (!x || !/^(ldfld|call|callvirt)$/.test(x.op)) continue;
      const r = asm.resolve(x.operand);
      if (r?.name !== 'Crit' && r?.name !== 'get_Crit') continue;
      branchAt(i, { crit: true, truthyCrit: !neg });
    }
  }).map((r) => { const onCrit = r.truthyCrit ? r.on : !r.on; delete r.truthyCrit; return { ...r, onCrit }; });
}

/**
 * Every conditional branch of a method, each with an id (the branch's offset: one id for both sides
 * of an if/else) and a short name for what it tested. The residual after the classified guards are
 * taken out is what the model still has to guess at, and the name is what a further reader would
 * be written for.
 */
export function branchRanges(asm, m) {
  return guardRanges(asm, m, (ins, branchAt) => {
    for (let i = 0; i < ins.length; i++) {
      if (!COND.test(ins[i].op)) continue;
      let cond = ins[i].op.replace(/\.s$/, '');
      for (let j = i - 1; j >= Math.max(0, i - 8); j--) {
        const x = ins[j];
        if (x.op === 'rem' || x.op === 'rem.un') { cond = '%'; break; }
        if (/^ldelem/.test(x.op)) { cond = 'ai[]'; break; }
        if (/^(ldsfld|ldfld|call|callvirt)$/.test(x.op)) { const r = asm.resolve(x.operand); if (r?.name) { cond = `${shortOf(r.declaringType?.fullName ?? r.declaringType?.name)}.${r.name}`; break; } }
      }
      branchAt(i, { id: ins[i].offset, cond });
    }
  });
}

/**
 * The gates a call site sits behind, given every classified range of its method: the innermost
 * counter and requirement, and — when a branch it sits inside is none of the classified kinds —
 * the innermost *unread* branch, as `{ id, side, cond }`. Two calls with the same id on opposite
 * sides are the two arms of one if/else; an id with calls on one side only has a no-op arm.
 */
export function gatesAt({ counters = [], requires = [], crits = [], always = [], explained = [], all = [] }, o) {
  const out = {};
  const mirror = innermostAt(always, o);
  if (mirror) { const a = all.find((r) => r.lo === mirror.lo && r.hi === mirror.hi); if (a) out.branch = { id: a.id, side: a.on, cond: a.cond, known: true }; }
  const cr = innermostAt(crits, o);
  if (cr) out.crit = cr.onCrit;
  const t = innermostAt(counters, o);
  if (t) out.threshold = { n: t.gate.n, event: t.gate.event, reset: t.gate.reset, reached: t.reached };
  const q = innermostAt(requires, o);
  if (q) out.requires = { what: q.gate.what, id: q.gate.id, negated: !q.has };
  const unread = all.filter((r) => o >= r.lo && o < r.hi && !explained.some((e) => e.lo === r.lo && e.hi === r.hi));
  const u = innermostAt(unread, o);
  if (u) out.branch = { id: u.id, side: u.on, cond: u.cond };
  return out;
}

/** The odds of reaching an offset: every priced guard it sits inside, multiplied. */
export function chanceAt(ranges, o) {
  const rs = ranges.filter((x) => o >= x.lo && o < x.hi);
  if (!rs.length) return undefined;
  const p = rs.reduce((acc, r) => acc * (r.on ? r.p : 1 - r.p), 1);
  return p > 0 && p < 1 ? p : undefined;
}

/**
 * A use cooldown a weapon enforces with a buff of its own:
 *
 *   CanUseItem:  if (player.altFunctionUse == 2 && player.HasBuff<SurgingVampirismCooldown>()) return false;
 *   Shoot:       player.AddBuff(BuffType<SurgingVampirismCooldown>(), 1800);
 *
 * — which is how Stars Above builds every one of its right-click ultimates, and how mods write a
 * use cooldown generally. Both halves are plain IL: which buff refuses the use, and how long the
 * use puts it on for. The tooltip usually states the same number in prose ("30 second cooldown"),
 * but only the code says *which click* it gates, and it says it in every language.
 *
 * `alt` is set when the refusal sits inside the `altFunctionUse == 2` arm: then it is the right
 * click that waits out the cooldown and the left click is unaffected.
 *
 * @returns {{ ticks: number, alt: boolean } | undefined}
 */
export function buffCooldownOf(asm, td, findInherited, refId) {
  const callee = (x) => {
    if (x.op !== 'call' && x.op !== 'callvirt') return null;
    try { return asm.resolve(x.operand); } catch { return null; }
  };
  const buffArg = (d) => (d?.kind === 'methodSpec' && d.name === 'BuffType' && d.declaringType?.fullName === 'Terraria.ModLoader.ModContent' ? refId(asm, d.typeArgs[0]) : null);
  const decode = (m) => { const body = m && asm.methodBody(m); if (!body) return null; try { return decodeIL(body.il); } catch { return null; } };

  // 1. the gate: which buff makes `CanUseItem` say no, and whether it only says no to the right click
  const gates = new Map(); // buff id → alt?
  for (const hook of ['CanUseItem', 'CanShoot']) {
    const ins = decode(findInherited(asm, td, hook));
    if (!ins) continue;
    let altEnd = -1;
    let buff = null;
    for (const x of ins) {
      if (x.op === 'ldfld') {
        let f;
        try { f = asm.resolve(x.operand); } catch { f = null; }
        // the `== 2` arm runs to wherever the branch that tests it lands
        if (f?.name === 'altFunctionUse' && altEnd < 0) altEnd = ins.find((y) => COND.test(y.op) && y.offset > x.offset && y.operand > y.offset)?.operand ?? -1;
        continue;
      }
      const d = callee(x);
      if (!d) continue;
      const b = buffArg(d);
      if (b) { buff = b; continue; }
      if (d.name === 'HasBuff' && buff) { gates.set(buff, x.offset < altEnd); buff = null; }
    }
  }
  if (!gates.size) return undefined;

  // 2. the duration: what the item's own code puts that buff on for
  for (const md of td.methods) {
    const ins = decode(md);
    if (!ins) continue;
    let buff = null;
    let ticks = null;
    for (const x of ins) {
      const d = callee(x);
      if (d) {
        const b = buffArg(d);
        if (b) { buff = b; ticks = null; continue; }
        if (d.name === 'AddBuff' && buff && ticks > 0 && gates.has(buff)) return { ticks, alt: gates.get(buff) };
        continue;
      }
      if (buff && ticks === null) { const n = ldcValue(x); if (typeof n === 'number') ticks = n; }
    }
  }
  return undefined;
}
