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
import { decodeIL } from '../clr/il.js';
import { Machine, PLAYER, THIS, UNKNOWN, isNum, tmlStaticHook, tmlStaticLoadHook } from './interp.js';
import { findInherited } from './util.js';
import { loopCount, projTypeArg } from './projectiles.js';

const VEC = Object.freeze({ k: 'vec', mul: 1, spread: 0 });
const DMG = Object.freeze({ k: 'adj', slot: 'dmg', field: 'damage', add: 0, mul: 1 });
const SHOOT_TYPE = Object.freeze({ k: 'shootType' });
const isVec = (v) => v?.k === 'vec';
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
      const v = isVec(a) ? a : isVec(b) ? b : null;
      if (v) return { ...v, perturbed: true };
      return undefined;
    }
    if (name === 'op_UnaryNegation') return isVec(a) ? a : undefined;
    if (name === 'Normalize' && isVec(a)) return { ...a, unit: true, mul: 1 };
    if (name === 'get_Length' && isVec(ctx.recv)) return UNKNOWN;
    return undefined;
  }
  if (short === 'Utils' || short === 'CalamityUtils' || short === 'ThoriumUtils' || /Utils$/.test(short)) {
    const v = args[0];
    if (name === 'RotatedBy' && isVec(v)) { const m = mag(args[1]); return { ...v, spread: Math.max(v.spread, m ?? 0.2) }; }
    if (name === 'RotatedByRandom' && isVec(v)) { const m = mag(args[1]); return { ...v, spread: Math.max(v.spread, m ?? 0.2) }; }
    if (name === 'SafeNormalize' && isVec(v)) return { ...v, unit: true, mul: 1 };
    if (name === 'ToRotation' && isVec(v)) return { k: 'adj', slot: 'angle', field: 'rot', add: 0, mul: 1 };
    if (name === 'ToRotationVector2') return { ...VEC, unit: true };
    if (name === 'NextVector2Circular' || name === 'NextVector2Unit' || name === 'NextVector2CircularEdge') return { ...VEC, unit: true, spread: Math.PI };
  }
  return undefined;
}

/** Ranges of a Shoot method guarded by Calamity's StealthStrikeAvailable(): [{ lo, hi, stealth }]. */
export function stealthRanges(asm, m) {
  const body = asm.methodBody(m);
  if (!body) return [];
  let ins;
  try { ins = decodeIL(body.il); } catch { return []; }
  const out = [];
  const byOffset = new Map(ins.map((x, i) => [x.offset, i]));
  const branchAt = (i) => {
    const x = ins[i];
    if (!x) return;
    if (!/^br(true|false)/.test(x.op)) return;
    const target = x.operand;
    const isFalse = x.op.startsWith('brfalse');
    const next = ins[i + 1]?.offset ?? x.offset;
    const ti = byOffset.get(target);
    const before = ti !== undefined ? ins[ti - 1] : null;
    const elseEnd = before && /^br(\.s)?$/.test(before.op) && before.operand > target ? before.operand : null;
    if (isFalse) {
      out.push({ lo: next, hi: target, stealth: true });
      if (elseEnd) out.push({ lo: target, hi: elseEnd, stealth: false });
    } else {
      out.push({ lo: next, hi: target, stealth: false });
      if (elseEnd) out.push({ lo: target, hi: elseEnd, stealth: true });
      else {
        // `if (stealth) { ... return; }` - the block ends at its first terminator
        const end = ins.slice(ti).find((y) => /^(ret|br|br\.s|throw)$/.test(y.op));
        out.push({ lo: target, hi: end ? end.offset + 1 : Infinity, stealth: true });
      }
    }
  };
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
  return out;
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
  let cur = null;
  const machine = new Machine(asm, {
    tml,
    concreteType: td,
    linear: true,
    maxDepth: 3,
    budget: 60000,
    onLoad(recv, name) {
      if (isVec(recv)) return { k: 'adj', slot: 'vel', field: name, add: 0, mul: recv.mul };
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
          // float variant: velocity.X * k
          if (vel?.k === 'adj' && vel.slot === 'vel') vel = { ...VEC, mul: vel.mul, perturbed: vel.add !== 0 };
          else if (isNum(vel) && vel !== 0) vel = { ...VEC, abs: Math.abs(vel) };
          else vel = { ...VEC, unknown: true };
        }
        calls.push({ offset: ctx.offset, method: ctx.method, type, dmg, vel, depth: ctx.depth, region: ctx.region });
        return UNKNOWN;
      }
      if (name === 'StealthStrikeAvailable') return UNKNOWN;
      return vectorHook(callee, args, ctx);
    },
    onNew(callee, args) {
      const decl = callee.declaringType?.fullName ?? '';
      if (decl.endsWith('Vector2') && args.length === 2) {
        const [x, y] = args;
        if (isNum(x) && isNum(y)) return { ...VEC, abs: Math.hypot(x, y) };
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
    onBackJump(x, a, b, op, ctx) { loops.push({ lo: x.operand, hi: x.offset, n: loopCount(a, b, op), method: ctx.method }); },
  });

  const out = { calls: [], returnsTrue: true, hasShoot: !!shoot };
  let at = 0;
  machine.trace = (x) => { at = x.offset; };
  if (modify) {
    cur = modify;
    const ranges = stealthRanges(asm, modify);
    const inStealth = (o) => ranges.some((r) => r.stealth && o >= r.lo && o < r.hi) && !ranges.some((r) => !r.stealth && o >= r.lo && o < r.hi);
    const cells = { velocity: VEC, type: SHOOT_TYPE, damage: DMG, position: UNKNOWN, knockback: UNKNOWN };
    const stealthCells = {};
    const ref = (k) => ({ k: 'ref', get: () => stealthCells[k] ?? cells[k], set: (v) => { if (inStealth(at)) stealthCells[k] = v; else cells[k] = v; } });
    try { machine.run(modify, THIS, [PLAYER, ref('position'), ref('velocity'), ref('type'), ref('damage'), ref('knockback')]); } catch { /* partial */ }
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
    const variantAt = (o) => {
      const r = ranges.filter((x) => o >= x.lo && o < x.hi);
      return r.length ? (r.every((x) => x.stealth) ? 'stealth' : r.every((x) => !x.stealth) ? 'spam' : 'both') : 'both';
    };
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
        variant: variantAt(c.offset),
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
    // helpers such as CalamityUtils.ProjectileBarrage inside Shoot: count nested calls once each
    const nested = calls.filter((c) => c.depth > 0);
    if (!out.calls.length && nested.length) {
      for (const c of nested) out.calls.push({ type: c.type === SHOOT_TYPE ? 'shoot' : projRef(c.type), count: 1, dmgMul: 1, velMul: 1, abs: null, spread: 0.1, variant: 'both' });
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
