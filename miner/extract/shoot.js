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
import { ITEM, Machine, PLAYER, THIS, UNKNOWN, isNum, tmlStaticHook, tmlStaticLoadHook } from './interp.js';
import { alwaysRanges, branchRanges, chanceAt as chanceOf, chanceRanges, counterRanges, followLoads, gatesAt, guardRanges, requiresRanges } from './guards.js';
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

/**
 * Counters earned by actually landing an item hit. A `Shoot` branch can only see that a field has
 * reached three; `OnHitNPC` says whether the three came from clicks or successful attacks. Keeping
 * that distinction is what stops a charged alternate attack being fired on a perfect every-N-use
 * schedule.
 */
function hitCounters(asm, td) {
  const out = new Set();
  const hit = findInherited(asm, td, 'OnHitNPC');
  const body = hit && asm.methodBody(hit);
  if (!body) return out;
  let ins;
  try { ins = decodeIL(body.il); } catch { return out; }
  for (let i = 3; i < ins.length; i++) {
    const store = ins[i];
    if (store.op !== 'stfld' || ins[i - 1]?.op !== 'add' || ldcValue(ins[i - 2]) !== 1 || ins[i - 3]?.op !== 'ldfld') continue;
    const from = asm.resolve(ins[i - 3].operand);
    const to = asm.resolve(store.operand);
    if (from?.name === to?.name) out.add(to.name);
  }
  return out;
}

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
    // IL exposes `Vector2.Zero` as its getter call, not always as a static field load. A projectile
    // spawned this way has deliberately not been launched at the item's shoot speed.
    if (name === 'get_Zero') return { ...VEC, abs: 0 };
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
export const sideAt = (ranges, o) => {
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
  const ranges = guardRanges(asm, m, (ins, branchAt) => {
    for (let i = 0; i < ins.length; i++) {
      if (ins[i].op !== 'ldfld' || asm.resolve(ins[i].operand)?.name !== 'altFunctionUse') continue;
      // `altFunctionUse` is 0 or 2, so every spelling reduces to "is the value truthy": `== 2`,
      // `!= 2`, `== 1` (never true, read as the left click), `> 1`, or the bare field. `right`
      // says whether a truthy value on the stack means the right click.
      const k = ldcValue(ins[i + 1]);
      let at = i + 1;
      let right = true;
      if (k !== undefined) {
        at = i + 2;
        const cmp = ins[at]?.op ?? '';
        if (/^ceq/.test(cmp)) { right = k === 2; at++; }
        else if (/^clt/.test(cmp)) { right = false; at++; }
        else if (/^cgt/.test(cmp)) { right = true; at++; }
        else if (/^beq/.test(cmp)) right = k === 2;
        else if (/^bne\.un/.test(cmp)) right = k === 2; // guardRanges reads bne.un as "on = equal"
        else if (/^(blt|ble)/.test(cmp)) right = false;
        else if (/^(bgt|bge)/.test(cmp)) right = true;
        else continue;
        // a negation between the compare and the branch
        if (ldcValue(ins[at]) === 0 && ins[at + 1]?.op === 'ceq') { right = !right; at += 2; }
      }
      followLoads(ins, at - 1, branchAt, { right });
    }
  });
  return ranges.map((r) => ({ lo: r.lo, hi: r.hi, on: r.right ? r.on : !r.on }));
}

/**
 * Which projectile the weapon puts in `Item.shoot` before the shot goes out.
 *
 * `Shoot` and `ModifyShootStats` are not the only places a weapon picks its attack. Malachite has
 * one `Shoot` override — the stealth fan — and does its real branching in `CanUseItem`, where
 * `Item.shoot` is assigned one of three projectiles: `MalachiteStealth` when a stealth strike is
 * available, `MalachiteBolt` on the right click, `MalachiteProj` otherwise. `SetDefaults` only ever
 * writes the third, so the model flew the plain kunai for all three — the stealth strike lost the
 * homing that is the only reason its tooltip line exists, and the right click did not exist at all.
 *
 * The buckets are the ones `ModifyShootStats` already fills, so what comes out is the same
 * `typeOverride` / `stealthMods.type` / `altMods.type` the model already reads. Only the hooks that
 * run *per use* are read: `HoldItem` swaps (Calamity's biome blade attunements) are a mode the
 * player sets, not a click, and belong to whatever reads that mode.
 * @returns {{ default?: string, stealth?: string, alt?: string }}
 */
export function shootSwaps(asm, td, { tml, projRef }) {
  const out = {};
  for (const name of ['CanUseItem', 'UseItem']) {
    const m = findInherited(asm, td, name);
    if (!m || m.declaringType !== td) continue;
    const body = asm.methodBody(m);
    if (!body) continue;
    // cheap gate: run the machine only for the handful of items that actually write the field
    let ins;
    try { ins = decodeIL(body.il); } catch { continue; }
    const writes = ins.some((x) => {
      if (x.op !== 'stfld') return false;
      let d; try { d = asm.resolve(x.operand); } catch { return false; }
      return d?.name === 'shoot' && (d.declaringType?.name ?? '') === 'Item';
    });
    if (!writes) continue;
    const stealth = stealthRanges(asm, m);
    const alts = altRanges(asm, m);
    let at = 0;
    const machine = new Machine(asm, {
      tml,
      concreteType: td,
      linear: true, // every arm of the switch is a real attack: walk them all
      maxDepth: 1,
      budget: 20000,
      onStore(recv, field, value) {
        if (recv !== ITEM || field !== 'shoot' || value?.k !== 'type') return;
        const bucket = sideAt(alts, at) === true ? 'alt' : sideAt(stealth, at) === true ? 'stealth' : 'default';
        out[bucket] = projRef(value) ?? out[bucket];
      },
      onCall(callee, args, ctx) {
        if (callee.name === 'StealthStrikeAvailable' || callee.name === 'AdditionalStealthCheck') return { k: 'flag', name: STEALTH_FLAG };
        return tmlStaticHook(callee, args, ctx);
      },
      onStaticLoad: tmlStaticLoadHook,
    });
    machine.trace = (x) => { at = x.offset; };
    try { machine.run(m, THIS, [PLAYER]); } catch { /* partial */ }
  }
  return out;
}

/**
 * What one use costs the player in health: `player.statLife -= N` in the item's own use hooks.
 *
 * A weapon that pays in life is the one cost the model had no way to see — `mana` and SOTS's void
 * are fields, this is a subtraction in the middle of `Shoot` — so a weapon that spends ten health
 * a cast was being graded as if it spent nothing. The pool it draws on is the one keeping the
 * player alive, which is why it is worth reading rather than assuming.
 *
 * Only a constant is read. A share of the bar (`statLifeMax2 * 0.1`) stays unread rather than
 * guessed at, and the `KillMe` on the branch where the player cannot pay is the failure case, not
 * the cost. A cost behind `altFunctionUse == 2` belongs to the right click alone and is skipped:
 * charging Butcher's Bloodmaker's 50-life Blood Rage to its ordinary shots would price a free
 * attack as a lethal one.
 *
 * ponytail: one number per item, so a right-click-only cost is dropped rather than carried per
 * click — give it `alt` the way `fire.calls` has it if a weapon ever turns on that difference.
 */
export function lifeCostOf(asm, td) {
  let cost = 0;
  for (const hook of ['Shoot', 'UseItem', 'CanUseItem', 'ConsumeItem']) {
    const m = findInherited(asm, td, hook);
    const body = m && asm.methodBody(m);
    if (!body) continue;
    let ins;
    try { ins = decodeIL(body.il); } catch { continue; }
    const alts = altRanges(asm, m);
    for (let i = 3; i < ins.length; i++) {
      if (ins[i].op !== 'stfld' || asm.resolve(ins[i].operand)?.name !== 'statLife') continue;
      if (ins[i - 1].op !== 'sub' || ins[i - 3].op !== 'ldfld' || asm.resolve(ins[i - 3].operand)?.name !== 'statLife') continue;
      const n = ldcValue(ins[i - 2]);
      if (!(n > 0) || sideAt(alts, ins[i].offset) === true) continue;
      cost = Math.max(cost, n);
    }
  }
  return cost || undefined;
}

/**
 * A call's damage is recorded as what it *is*: `dmgMul` where the machine read a share of the
 * `damage` argument, `dmgAbs` where it read a number, and neither where it could read nothing.
 * The share is relative to the argument `Shoot` receives, which `ModifyShootStats` has already
 * scaled by `dmgMul` on the record itself — the two multiply. Astral's End carries 1.5 on the
 * whole shot and 0.667 on each of five calls, which is ×1.0 in play, and writing the call's 0.667
 * as the answer underpriced every asteroid by a third.
 * @returns {{ calls: Array<{ type: string|null, count: number, dmgMul?: number, dmgAbs?: number, velMul: number, abs: number|null, spread: number, variant: 'both'|'spam'|'stealth' }>, returnsTrue: boolean, hasShoot: boolean, typeOverride?: any, velMul?: number, dmgMul?: number, stealthMult?: number } | null}
 */
export function analyzeShoot(asm, td, { tml, projRef }) {
  // Thorium's bards do not override `Shoot`. `BardItem.Shoot` is an eighteen-byte forwarder to a
  // virtual `BardShoot` with the identical seven-parameter signature, and the machine was not
  // following it through — so of 208 bard weapons only 64 had a `Shoot` read at all and only 34
  // their projectile calls, against 52–62% for every other class that shoots. Taking `BardShoot`
  // where the type declares one reads the real method instead of its wrapper.
  const shoot = findInherited(asm, td, 'BardShoot') ?? findInherited(asm, td, 'Shoot');
  const modify = findInherited(asm, td, 'ModifyShootStats');
  // a weapon can pick its attack by assigning `Item.shoot` per click instead of in either of those
  const swaps = shootSwaps(asm, td, { tml, projRef });
  if (!shoot && !modify && !Object.keys(swaps).length) return null;
  const calls = [];
  const rets = [];
  /** the projectile handed to `Player.SpawnMinionOnCursor` — the game's own word for "a minion" */
  let minionType;
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
      const name = callee.name;
      const decl = callee.declaringType?.fullName ?? callee.declaringType?.name ?? '';
      // `Vector2.Zero` is a getter call. Recognise it before the generic tML static hook turns it
      // into an opaque value, otherwise a zero-launch custom animation is indistinguishable from
      // the item's ordinary shoot-speed projectile.
      if (decl.endsWith('Vector2') && name === 'get_Zero') return { ...VEC, abs: 0 };
      const hooked = tmlStaticHook(callee, args, ctx);
      if (hooked !== undefined) return hooked;
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
      // `player.SpawnMinionOnCursor(source, whoAmI, type, damage, knockback, …)` is Terraria's own
      // way of saying "this weapon summons a minion", and for SOTS's nine Spirit Staves it is the
      // *only* way it is said: `SpiritMinion.SetDefaults` never sets `Projectile.minion`, it only
      // registers the type in `ProjectileID.Sets.MinionTargettingFeature`. Read as an ordinary
      // shot, a permanent minion was being re-thrown twice a second and billed its 135-void summon
      // cost every time — 225 void/s against a 200 bar, which is where their scores went.
      if (decl === 'Terraria.Player' && name === 'SpawnMinionOnCursor') { minionType ??= args[2]; return UNKNOWN; }
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
    // A custom melee image commonly starts at the player with `Vector2.Zero` and moves under its
    // own AI. It is not a projectile launched at `item.shootSpeed`; preserving zero lets scoring
    // refuse the free-flight/pierce model for that delivery.
    if (decl.endsWith('Vector2') && (f.name === 'Zero' || f.name === 'get_Zero')) return { ...VEC, abs: 0 };
      return tmlStaticLoadHook(f);
    },
    onReturn(v, ctx) { if (ctx.method === cur) rets.push({ v, offset: ctx.offset }); },
    onStoreLocal: track.onStoreLocal,
    // `bound` is kept because the odds that built it are not read until after the walk: see the
    // `track.expected` pass below, where a rolled-for count stops being its maximum
    onBackJump(x, a, b, op, ctx) { loops.push({ lo: x.operand, hi: x.offset, n: track.count(x, a, b, op), bound: b, method: ctx.method }); },
  });

  const out = { calls: [], returnsTrue: true, hasShoot: !!shoot, minion: undefined };
  let at = 0;
  machine.trace = (x) => { at = x.offset; };
  if (modify) {
    let ranges = stealthRanges(asm, modify);
    // `ModifyShootStats` branches on the right click exactly as it branches on a stealth strike, and
    // the swap it makes there belongs to that click alone. Wulfrum Prosthesis is the whole story:
    // `if (player.altFunctionUse == 2) type = WulfrumManaDrain;` — read without the guard, the left
    // click's bolt became the right click's 36 px mana drain and the weapon scored a flat zero.
    let alts = altRanges(asm, modify);
    const inStealth = (o) => sideAt(ranges, o) === true;
    const inAlt = (o) => sideAt(alts, o) === true;
    const cells = { velocity: VEC, type: SHOOT_TYPE, damage: DMG, position: UNKNOWN, knockback: UNKNOWN };
    const stealthCells = {};
    const altCells = {};
    const ref = (k) => ({ k: 'ref', get: () => altCells[k] ?? stealthCells[k] ?? cells[k], set: (v, sctx) => { if (inAlt(at)) altCells[k] = v; else if (inStealth(at) || taggedStealth(sctx?.condTags)) stealthCells[k] = v; else cells[k] = v; } });
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
      delete cells.type; delete stealthCells.type; delete altCells.type;
      cells.type = SHOOT_TYPE;
      ranges = stealthRanges(asm, extra);
      alts = altRanges(asm, extra);
      cur = extra;
      try { machine.run(extra, THIS, args()); } catch { /* partial */ }
    }
    if (isVec(cells.velocity) && cells.velocity !== VEC) out.velMul = cells.velocity.abs ? null : cells.velocity.mul;
    if (cells.type !== SHOOT_TYPE) out.typeOverride = projRef(cells.type) ?? undefined;
    if (cells.damage?.k === 'adj' && cells.damage.mul !== 1) out.dmgMul = cells.damage.mul;
    if (altCells.type && altCells.type !== SHOOT_TYPE) {
      // ponytail: the swapped projectile only. A right click that also changes the velocity or the
      // damage there would need the same treatment; none in the pack does yet.
      out.altMods = { type: projRef(altCells.type) ?? undefined };
    }
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
    // A burst whose size the weapon rolls for fires its *average*, not its best roll. The odds are
    // the same `NextBool` regions priced above; `track.expected` weighs the increments that built
    // each loop bound by them, and a bound written once comes back unchanged.
    for (const l of loops) {
      const e = track.expected(l.bound, l.lo, chanceAt);
      if (isNum(e) && isNum(l.bound) && l.bound > 0 && e !== l.bound) l.n = Math.round((l.n * e) / l.bound * 100) / 100;
    }
    // the gates a call sits behind, and the branches nobody has a reader for yet
    const counters = counterRanges(asm, shoot, 'use');
    const onHit = hitCounters(asm, td);
    for (const r of counters) if (onHit.has(r.counter)) r.gate.event = 'hit';
    // arg 5 of `Shoot(player, source, position, velocity, type, damage, knockback)` is the type
    const reqs = requiresRanges(asm, shoot, { typeArg: 5 }).map((r) => (r.gate.what === 'ammoType' ? { ...r, gate: { ...r.gate, id: projRef(r.gate.id) ?? r.gate.id } } : r));
    const always = alwaysRanges(asm, shoot);
    const guards = { counters: counters.filter((r) => r.gate), requires: reqs, always, explained: [...ranges, ...alts, ...chances, ...counters, ...reqs, ...always], all: branchRanges(asm, shoot) };
    for (const c of calls) {
      if (c.depth !== 0) continue; // helpers called from Shoot are counted through their own calls
      const n = loops.filter((l) => l.method === shoot && c.offset >= l.lo && c.offset <= l.hi).reduce((p, l) => p * l.n, 1);
      out.calls.push({
        type: c.type === SHOOT_TYPE ? 'shoot' : projRef(c.type),
        count: n,
        dmgMul: c.dmg?.k === 'adj' && c.dmg.slot === 'dmg' ? c.dmg.mul : undefined,
        dmgAbs: isNum(c.dmg) ? c.dmg : undefined,
        velMul: c.vel.abs ? null : c.vel.mul,
        abs: c.vel.abs ?? null,
        spread: c.vel.spread + (c.vel.perturbed ? 0.08 : 0),
        fan: c.vel.fan === true && !c.vel.perturbed ? true : undefined,
        variant: variantAt(c.offset),
        alt: altAt(c.offset),
        chance: chanceAt(c.offset),
        region: c.region ?? undefined,
        ...gatesAt(guards, c.offset),
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
  // `Item.shoot` assigned per click sits in the same three buckets `ModifyShootStats` fills, and
  // loses to it: that hook runs later and is the more specific answer where a weapon has both.
  if (swaps.stealth) out.stealthMods = { ...out.stealthMods, type: out.stealthMods?.type ?? swaps.stealth };
  if (swaps.alt) out.altMods = { ...out.altMods, type: out.altMods?.type ?? swaps.alt };
  if (swaps.default) out.typeOverride ??= swaps.default;
  if (minionType !== undefined) out.minion = minionType === SHOOT_TYPE ? 'shoot' : projRef(minionType) ?? undefined;
  const sm = findInherited(asm, td, 'get_StealthDamageMultiplier');
  if (sm) {
    const v = new Machine(asm, { tml, concreteType: td, budget: 2000, onStaticLoad: tmlStaticLoadHook }).run(sm, THIS, []);
    if (isNum(v) && v > 0) out.stealthMult = v;
  }
  return out;
}
