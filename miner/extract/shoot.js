/**
 * What a weapon fires: `Shoot` / `ModifyShootStats` overrides run with symbolic arguments.
 *
 *   velocity  → { k: 'vec', mul, spread, abs?, perturbed? }   multiplier on shootSpeed, max angle
 *   damage    → { k: 'adj', slot: 'dmg', add, mul }            multiplier on the item's damage
 *   type      → { k: 'shootType' }                             the item's `shoot`
 *
 * Every `Projectile.NewProjectile*` call is recorded with the loop it sits in (count) and, for
 * Calamity rogue weapons, whether it is on the stealth-strike or the normal path of a
 * `StealthStrikeAvailable()` check.
 */
import { decodeIL, ldcValue } from '../clr/il.js';
import { Machine, PLAYER, THIS, UNKNOWN, isNum, tmlStaticHook, tmlStaticLoadHook } from './interp.js';
import { chanceAt as chanceOf, chanceRanges, guardRanges } from './guards.js';
import { findInherited } from './util.js';
import { loopTracker, projTypeArg } from './projectiles.js';

const VEC = Object.freeze({ k: 'vec', mul: 1, spread: 0 });
const DMG = Object.freeze({ k: 'adj', slot: 'dmg', field: 'damage', add: 0, mul: 1 });
const SHOOT_TYPE = Object.freeze({ k: 'shootType' });
const isVec = (v) => v?.k === 'vec';
/** Calamity's "is this a stealth strike" test, as a branch tag. */
const STEALTH_FLAG = 'stealthStrike';
// `if (StealthStrikeAvailable() || AdditionalStealthCheck())` tags the block it guards `any:…`,
// because either test getting there is enough
const taggedStealth = (tags) => !!tags?.some((t) => t === STEALTH_FLAG || t === `any:${STEALTH_FLAG}`);
const rand = (lo, hi) => ({ k: 'rand', lo, hi });
const mag = (v) => (isNum(v) ? Math.abs(v) : v?.k === 'rand' ? Math.max(Math.abs(v.lo), Math.abs(v.hi)) : v?.k === 'adj' && v.slot === 'angle' ? Math.abs(v.add) : null);

/** Static XNA / Terraria helpers that shape velocity vectors and angles. */
export function vectorHook(callee, args, ctx) {
  const name = callee.name;
  const decl = callee.declaringType?.fullName ?? callee.declaringType?.name ?? '';
  const short = decl.split('.').pop();
  if (short === 'MathHelper') {
    if (name === 'ToRadians') { const a = args[0]; if (isNum(a)) return (a * Math.PI) / 180; if (a?.k === 'rand') return rand((a.lo * Math.PI) / 180, (a.hi * Math.PI) / 180); return UNKNOWN; }
    if (name === 'Lerp' && isNum(args[0]) && isNum(args[1])) return isNum(args[2]) ? args[0] + (args[1] - args[0]) * args[2] : rand(args[0], args[1]);
    if (name === 'Clamp' && isNum(args[0]) && isNum(args[1]) && isNum(args[2])) return Math.min(Math.max(args[0], args[1]), args[2]);
    return UNKNOWN;
  }
  // The polar form: `len = velocity.Length(); θ = Atan2(velocity.Y, velocity.X); new Vector2(len·k·Sin(θ±d), len·k·Cos(θ±d))`.
  // The aim comes back as an angle, an offset rides on it, and the trig call turns it into a
  // component that `new Vector2` can read the fan off. 22 Thorium `Shoot`s are written this way
  // (Midas' Gavel: three stars at ±0.16 rad, ×1.45 speed) and read as "unknown velocity" — the
  // weapon's own speed and no spread at all.
  if (short === 'Math' || short === 'MathF') {
    if (name === 'Atan2') { const [y, x] = args; return (y?.k === 'adj' && y.slot === 'vel') || (x?.k === 'adj' && x.slot === 'vel') ? { k: 'adj', slot: 'angle', field: 'rot', add: 0, mul: 1 } : UNKNOWN; }
    if (name === 'Sin' || name === 'Cos') { const a = args[0]; if (isNum(a)) return Math[name.toLowerCase()](a); return a?.k === 'adj' && a.slot === 'angle' ? { k: 'trig', off: a.add, jitter: a.jitter ?? 0 } : UNKNOWN; }
    if (name === 'Abs' && isNum(args[0])) return Math.abs(args[0]);
    return UNKNOWN;
  }
  if (short === 'UnifiedRandom' || (short === 'Utils' && /^Next/.test(name))) {
    const a = short === 'Utils' ? args.slice(1) : args; // extension methods carry the random as arg 0
    if (name === 'NextFloat' || name === 'NextDouble') { if (a.length === 0) return rand(0, 1); if (a.length === 1) return rand(0, a[0]); return isNum(a[0]) && isNum(a[1]) ? rand(a[0], a[1]) : rand(-1, 1); }
    if (name === 'Next') { if (a.length === 1 && isNum(a[0])) return rand(0, a[0]); if (a.length === 2 && isNum(a[0]) && isNum(a[1])) return rand(a[0], a[1]); return UNKNOWN; }
    if (name === 'NextBool') return UNKNOWN;
    return UNKNOWN;
  }
  if (short === 'Vector2') {
    const [a, b] = args;
    if (name === 'op_Multiply') {
      if (isVec(a) && isNum(b)) return { ...a, mul: a.mul * Math.abs(b) };
      if (isVec(b) && isNum(a)) return { ...b, mul: b.mul * Math.abs(a) };
      if (isVec(a) || isVec(b)) return isVec(a) ? a : b;
      return undefined;
    }
    if (name === 'op_Division') { if (isVec(a) && isNum(b) && b !== 0) return { ...a, mul: a.mul / Math.abs(b) }; return isVec(a) ? a : undefined; }
    if (name === 'op_Addition' || name === 'op_Subtraction') {
      if (isVec(a) && isVec(b)) return a;
      // `target - spawnPosition`: a direction *to* somewhere, not the vector on the right nudged —
      // Supernova Storm's stars spawn 160 px out at a random angle and then fly at the cursor, and
      // the spawn offset was being read as their velocity (160 px/tick, scattered over 2π)
      if (name === 'op_Subtraction' && !isVec(a) && isVec(b)) return { ...VEC, unknown: true };
      const v = isVec(a) ? a : isVec(b) ? b : null;
      if (v) return { ...v, perturbed: true };
      return undefined;
    }
    if (name === 'op_UnaryNegation') return isVec(a) ? a : undefined;
    if (name === 'Normalize' && isVec(a)) return { ...a, unit: true, mul: 1 };
    // the vector's length is the launch speed with whatever it has been scaled by, and it keeps
    // the vector so a component rebuilt from it still knows what it was aimed along
    if ((name === 'get_Length' || name === 'Length') && isVec(ctx.recv)) return { k: 'adj', slot: 'vel', field: 'len', add: 0, mul: ctx.recv.mul, vec: ctx.recv };
    return undefined;
  }
  if (short === 'Utils' || short === 'CalamityUtils' || short === 'ThoriumUtils' || /Utils$/.test(short)) {
    const v = args[0];
    // a fan (`RotatedBy` once per loop index) puts its shots at fixed angles, so a wide boss can
    // catch several of them; `RotatedByRandom` scatters them and only the share inside the
    // silhouette lands. The model needs the difference, not just the half-angle.
    if (name === 'RotatedBy' && isVec(v)) { const m = mag(args[1]); return { ...v, spread: Math.max(v.spread, m ?? 0.2), fan: true }; }
    if (name === 'RotatedByRandom' && isVec(v)) { const m = mag(args[1]); return { ...v, spread: Math.max(v.spread, m ?? 0.2), fan: false }; }
    if (name === 'SafeNormalize' && isVec(v)) return { ...v, unit: true, mul: 1 };
    if (name === 'ToRotation' && isVec(v)) return { k: 'adj', slot: 'angle', field: 'rot', add: 0, mul: 1 };
    // `(aim.ToRotation() + d).ToRotationVector2() * speed` — Calamity's polar form: a unit vector
    // at the aim plus an offset, a fixed one being a fan and a rolled one a scatter
    if (name === 'ToRotationVector2') {
      if (v?.k === 'adj' && v.slot === 'angle' && (v.add !== 0 || v.jitter > 0)) return { ...VEC, unit: true, spread: Math.abs(v.add) + (v.jitter ?? 0), fan: !(v.jitter > 0) };
      return { ...VEC, unit: true };
    }
    if (name === 'NextVector2Circular' || name === 'NextVector2Unit' || name === 'NextVector2CircularEdge') return { ...VEC, unit: true, spread: Math.PI };
  }
  return undefined;
}

/** Which side of a set of guard ranges an offset sits on: true, false, or neither. */
const sideAt = (ranges, o) => {
  const r = ranges.filter((x) => o >= x.lo && o < x.hi);
  if (!r.length) return undefined;
  return r.every((x) => x.on) ? true : r.every((x) => !x.on) ? false : undefined;
};

/** Ranges of a Shoot method guarded by Calamity's StealthStrikeAvailable(): [{ lo, hi, on }]. */
export function stealthRanges(asm, m) {
  return guardRanges(asm, m, (ins, branchAt) => {
    for (let i = 0; i < ins.length; i++) {
      const x = ins[i];
      if (x.op !== 'call' && x.op !== 'callvirt') continue;
      const r = asm.resolve(x.operand);
      if (r?.name !== 'StealthStrikeAvailable') continue;
      const nx = ins[i + 1];
      if (nx && /^stloc/.test(nx.op)) {
        const slot = nx.op === 'stloc.s' || nx.op === 'stloc' ? nx.operand : +nx.op.slice(6);
        for (let j = i + 2; j < ins.length; j++) {
          const y = ins[j];
          const isLd = (y.op === 'ldloc.s' || y.op === 'ldloc') ? y.operand === slot : y.op === `ldloc.${slot}`;
          if (isLd) branchAt(j + 1);
        }
      } else branchAt(i + 1);
    }
  });
}

/**
 * Ranges of a Shoot method guarded by `player.altFunctionUse == 2` — the right-click attack.
 *
 * A weapon with two clicks has two attacks, and the player uses one at a time. Without this the
 * miner hands both to the model as one use, which then either sums them or averages them as if a
 * coin decided which fired: Sahara Slicers stabs on the left button and throws the bolts its stabs
 * collected on the right, and read together the throw was a free extra on every stab.
 */
export function altRanges(asm, m) {
  return guardRanges(asm, m, (ins, branchAt) => {
    for (let i = 0; i < ins.length; i++) {
      if (ins[i].op !== 'ldfld' || asm.resolve(ins[i].operand)?.name !== 'altFunctionUse') continue;
      if (ldcValue(ins[i + 1]) !== 2) continue;
      // `== 2` compared straight into a branch, or through a `ceq` the branch then reads
      branchAt(ins[i + 2]?.op === 'ceq' ? i + 3 : i + 2);
    }
  });
}

/**
 * @returns {{ calls: Array<{ type: string|null, count: number, dmgMul: number, velMul: number, abs: number|null, spread: number, variant: 'both'|'spam'|'stealth' }>, returnsTrue: boolean, hasShoot: boolean, typeOverride?: any, velMul?: number, stealthMult?: number } | null}
 */
export function analyzeShoot(asm, td, { tml, projRef }) {
  const shoot = findInherited(asm, td, 'Shoot');
  const modify = findInherited(asm, td, 'ModifyShootStats');
  if (!shoot && !modify) return null;
  const calls = [];
  const rets = [];
  let loops = [];
  const track = loopTracker();
  let cur = null;
  const machine = new Machine(asm, {
    tml,
    concreteType: td,
    linear: true,
    maxDepth: 3,
    budget: 60000,
    onLoad(recv, name) {
      // `NewProjectile(v.X * k, v.Y * k, …)` passes the components, not the vector — keep the
      // vector on the adjustment so the angle it was rotated by survives to the call
      if (isVec(recv)) return { k: 'adj', slot: 'vel', field: name, add: 0, mul: recv.mul, vec: recv };
      return undefined;
    },
    onCall(callee, args, ctx) {
      const hooked = tmlStaticHook(callee, args, ctx);
      if (hooked !== undefined) return hooked;
      const name = callee.name;
      const decl = callee.declaringType?.fullName ?? callee.declaringType?.name ?? '';
      if (ctx.recv === THIS && name === 'get_Item') return undefined; // machine maps it to ITEM
      if (decl === 'Terraria.Projectile' && /^NewProjectile(Direct)?$/.test(name)) {
        const n = callee.sig?.params.length ?? args.length;
        const type = projTypeArg(callee, args);
        const dmg = n >= 12 ? args[6] : args[4];
        let vel = n >= 12 ? args[3] : args[2];
        if (!isVec(vel)) {
          // float variant: velocity.X * k — or a component rebuilt from the length at an angle
          if (vel?.k === 'adj' && vel.slot === 'vel' && vel.trig !== undefined) vel = { ...VEC, mul: vel.mul, spread: Math.abs(vel.trig) + (vel.jitter ?? 0), fan: !(vel.jitter > 0) };
          else if (vel?.k === 'adj' && vel.slot === 'vel') vel = { ...(vel.vec ?? VEC), mul: vel.mul, perturbed: (vel.vec?.perturbed ?? false) || vel.add !== 0 };
          else if (isNum(vel) && vel !== 0) vel = { ...VEC, abs: Math.abs(vel) };
          else vel = { ...VEC, unknown: true };
        }
        calls.push({ offset: ctx.offset, method: ctx.method, type, dmg, vel, depth: ctx.depth, region: ctx.region });
        return UNKNOWN;
      }
      // Calamity asks this to decide what a stealth strike changes, and it asks it inside helpers
      // the machine inlines (`RogueWeapon.ModifyShootStats` calls `ModifyStatsExtra`, which is
      // where a weapon swaps in its stealth projectile). Handing it back as a flag tags the branch,
      // which survives inlining — matching offsets against the outer method's IL does not.
      if (name === 'StealthStrikeAvailable' || name === 'AdditionalStealthCheck') return { k: 'flag', name: STEALTH_FLAG };
      return vectorHook(callee, args, ctx);
    },
    onNew(callee, args) {
      const decl = callee.declaringType?.fullName ?? '';
      if (decl.endsWith('Vector2') && args.length === 2) {
        const [x, y] = args;
        if (isNum(x) && isNum(y)) return { ...VEC, abs: Math.hypot(x, y) };
        // a component rebuilt from the length and an angle: the offset from the aim is the spread,
        // fixed (a fan) unless a roll was added to the angle
        if (x?.k === 'adj' && x.slot === 'vel' && x.trig !== undefined) return { ...VEC, mul: x.mul, spread: Math.abs(x.trig) + (x.jitter ?? 0), fan: !(x.jitter > 0) };
        if (x?.k === 'adj' && x.slot === 'vel') return { ...VEC, mul: x.mul, perturbed: x.add !== 0 || (y?.k === 'adj' && y.add !== 0) };
        return { ...VEC, unknown: true };
      }
      return undefined;
    },
    onStaticLoad(f) {
      const decl = f.declaringType?.fullName ?? '';
      if (decl.endsWith('MathHelper')) return { Pi: Math.PI, TwoPi: 2 * Math.PI, PiOver2: Math.PI / 2, PiOver4: Math.PI / 4 }[f.name] ?? UNKNOWN;
      if (decl.endsWith('Vector2') && (f.name === 'UnitX' || f.name === 'UnitY')) return { ...VEC, unit: true };
      return tmlStaticLoadHook(f);
    },
    onReturn(v, ctx) { if (ctx.method === cur) rets.push({ v, offset: ctx.offset }); },
    onStoreLocal: track.onStoreLocal,
    onBackJump(x, a, b, op, ctx) { loops.push({ lo: x.operand, hi: x.offset, n: track.count(x, a, b, op), method: ctx.method }); },
  });

  const out = { calls: [], returnsTrue: true, hasShoot: !!shoot };
  let at = 0;
  machine.trace = (x) => { at = x.offset; };
  if (modify) {
    let ranges = stealthRanges(asm, modify);
    const inStealth = (o) => sideAt(ranges, o) === true;
    const cells = { velocity: VEC, type: SHOOT_TYPE, damage: DMG, position: UNKNOWN, knockback: UNKNOWN };
    const stealthCells = {};
    const ref = (k) => ({ k: 'ref', get: () => stealthCells[k] ?? cells[k], set: (v, sctx) => { if (inStealth(at) || taggedStealth(sctx?.condTags)) stealthCells[k] = v; else cells[k] = v; } });
    const args = () => [PLAYER, ref('position'), ref('velocity'), ref('type'), ref('damage'), ref('knockback')];
    cur = modify;
    try { machine.run(modify, THIS, args()); } catch { /* partial */ }
    // Calamity's `RogueWeapon.ModifyShootStats` calls `ModifyStatsExtra` from *outside* its stealth
    // branch, and that is where a weapon swaps in its stealth projectile. Inlined, the callee's
    // offsets mean nothing against the caller's stealth ranges and nested runs carry no branch
    // tags, so the swap read as unconditional — Ashen Stalactite threw its stealth stalagmite on
    // every normal attack. Running the override on its own, against its own ranges, sees it.
    const extra = findInherited(asm, td, 'ModifyStatsExtra');
    if (extra && extra.declaringType === td) {
      delete cells.type; delete stealthCells.type;
      cells.type = SHOOT_TYPE;
      ranges = stealthRanges(asm, extra);
      cur = extra;
      try { machine.run(extra, THIS, args()); } catch { /* partial */ }
    }
    if (isVec(cells.velocity) && cells.velocity !== VEC) out.velMul = cells.velocity.abs ? null : cells.velocity.mul;
    if (cells.type !== SHOOT_TYPE) out.typeOverride = projRef(cells.type) ?? undefined;
    if (cells.damage?.k === 'adj' && cells.damage.mul !== 1) out.dmgMul = cells.damage.mul;
    if (Object.keys(stealthCells).length) {
      out.stealthMods = {};
      if (isVec(stealthCells.velocity)) out.stealthMods.velMul = stealthCells.velocity.abs ? null : stealthCells.velocity.mul;
      if (stealthCells.type && stealthCells.type !== SHOOT_TYPE) out.stealthMods.type = projRef(stealthCells.type) ?? undefined;
      if (stealthCells.damage?.k === 'adj') out.stealthMods.dmgMul = stealthCells.damage.mul;
    }
  }
  if (shoot) {
    cur = shoot;
    loops = [];
    try { machine.run(shoot, THIS, [PLAYER, UNKNOWN, { k: 'obj', name: 'position', props: {} }, VEC, SHOOT_TYPE, DMG, UNKNOWN]); } catch { /* partial */ }
    const ranges = stealthRanges(asm, shoot);
    const alts = altRanges(asm, shoot);
    const chances = chanceRanges(asm, shoot);
    const variantAt = (o) => { const s = sideAt(ranges, o); return s === true ? 'stealth' : s === false ? 'spam' : 'both'; };
    // which click fires it: true = only the right one does, false = only the left, undefined = both
    const altAt = (o) => sideAt(alts, o);
    const chanceAt = (o) => chanceOf(chances, o);
    for (const c of calls) {
      if (c.depth !== 0) continue; // helpers called from Shoot are counted through their own calls
      const n = loops.filter((l) => l.method === shoot && c.offset >= l.lo && c.offset <= l.hi).reduce((p, l) => p * l.n, 1);
      out.calls.push({
        type: c.type === SHOOT_TYPE ? 'shoot' : projRef(c.type),
        count: n,
        dmgMul: c.dmg?.k === 'adj' ? c.dmg.mul : c.dmg === DMG ? 1 : isNum(c.dmg) ? null : 1,
        velMul: c.vel.abs ? null : c.vel.mul,
        abs: c.vel.abs ?? null,
        spread: c.vel.spread + (c.vel.perturbed ? 0.08 : 0),
        fan: c.vel.fan === true && !c.vel.perturbed ? true : undefined,
        variant: variantAt(c.offset),
        alt: altAt(c.offset),
        chance: chanceAt(c.offset),
        region: c.region ?? undefined,
      });
    }
    // does the default shot fire too? per path: `return true` on the normal / stealth path
    const known = rets.filter((r) => isNum(r.v));
    const truthy = (variant) => {
      const specific = known.filter((r) => variantAt(r.offset) === variant);
      return specific.length ? specific : known.filter((r) => variantAt(r.offset) === 'both');
    };
    const dflt = (variant) => { const k = truthy(variant); return k.length ? k.some((r) => r.v !== 0) : out.calls.filter((c) => c.variant === 'both' || c.variant === variant).length === 0; };
    out.defaultShot = { spam: dflt('spam'), stealth: dflt('stealth') };
    out.returnsTrue = out.defaultShot.spam;
    // Helpers such as CalamityUtils.ProjectileBarrage inside Shoot: one call per projectile type,
    // not per call site. The same helper reached from several branches (a bard instrument picking
    // one of five notes at random) is one shot, and the miner cannot tell that apart from a
    // barrage — so it assumes the fewer projectiles.
    const nested = calls.filter((c) => c.depth > 0);
    if (!out.calls.length && nested.length) {
      const seen = new Set();
      for (const c of nested) {
        const type = c.type === SHOOT_TYPE ? 'shoot' : projRef(c.type);
        if (seen.has(type)) continue;
        seen.add(type);
        out.calls.push({ type, count: 1, dmgMul: 1, velMul: 1, abs: null, spread: 0.1, variant: 'both' });
      }
      out.returnsTrue = known.length ? known.some((v) => v !== 0) : false;
    }
  }
  const sm = findInherited(asm, td, 'get_StealthDamageMultiplier');
  if (sm) {
    const v = new Machine(asm, { tml, concreteType: td, budget: 2000, onStaticLoad: tmlStaticLoadHook }).run(sm, THIS, []);
    if (isNum(v) && v > 0) out.stealthMult = v;
  }
  return out;
}
