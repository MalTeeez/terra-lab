/**
 * Projectile behaviour: `ModProjectile.SetDefaults` fields plus what the AI does with them
 * (gravity, homing, child projectiles, debuffs on hit, wall pierce), and the same for vanilla
 * projectiles out of `Projectile.SetDefaults1/2` with the case tracker.
 *
 * Output per projectile (see README "Real DPS"):
 *   { id, pen, tile, updates, ai, aiType, life, local, minion, sentry, slots, gravity, homing,
 *     children: [{ type, count, where }], debuffs: [...], stealth, cloneOf }
 */
import { decodeIL } from '../clr/il.js';
import { Machine, THIS, UNKNOWN, isNum, simpleName, tmlStaticHook, tmlStaticLoadHook } from './interp.js';
import { TYPE_ABSTRACT, derivesFromTml, findInherited, refId } from './util.js';

export const isModProjectileType = (asm, td) => derivesFromTml(asm, td, 'ModProjectile');

/** Vanilla aiStyles whose movement is an arc (ProjAIStyleID). */
export const GRAVITY_AI = new Set([2, 5, 8, 10, 14, 16, 25, 47, 81, 113, 115, 131]);
/** Vanilla projectiles that seek targets (ProjectileID). */
export const VANILLA_HOMING = new Set([34, 35, 94, 181, 207, 254, 566, 634, 635, 659, 963, 953, 966, 622, 640, 641, 838, 840]);
const HOMING_RE = /Hom(e|ing)|Closest|Nearest|FindTarget|Seek|Track|CanBeChasedBy|GetTarget|TargetNPC|Chase|AcquireTarget|EnemyInRange|ClosestNPC/i;

const PHASES = [
  ['ai', ['AI', 'PreAI', 'PostAI', 'Kill']],
  ['kill', ['OnKill', 'PreKill']],
  ['hit', ['OnHitNPC', 'ModifyHitNPC', 'OnHitEffects']],
];

const makeObj = (name) => ({ k: 'obj', name, props: {} });

/** The projectile-type argument of a NewProjectile / NewProjectileDirect call. */
export function projTypeArg(callee, args) {
  const n = callee.sig?.params.length ?? args.length;
  return n >= 12 ? args[5] : args[3];
}

/** Iterations of a loop from its backward compare: `i (a) < bound (b)` after one pass. */
export function loopCount(a, b, op) {
  const bound = (v) => (isNum(v) ? v : v?.k === 'rand' ? (v.lo + v.hi) / 2 : null);
  let hi = bound(b);
  let lo = isNum(a) ? a - 1 : bound(a);
  if (hi === null && lo !== null && isNum(b) === false && a !== undefined && !isNum(a)) { hi = bound(a); lo = isNum(b) ? b - 1 : 0; }
  if (hi === null) return 2;
  if (lo === null) lo = 0;
  let n = hi - lo;
  if (op === 'ble' || op === 'bge') n += 1;
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(Math.round(n), 30);
}

/** Convert a symbolic projectile type to a dataset id. */
export function projRef(asm, v) {
  if (isNum(v)) return v >= 0 ? `v:${v}` : null;
  if (v?.k === 'type') return refId(asm, v);
  return null;
}

/** Field reads of `stealthStrike` (Calamity) anywhere in the type's own methods. */
function readsStealth(asm, td) {
  for (const m of td.methods) {
    const body = asm.methodBody(m);
    if (!body) continue;
    let ins;
    try { ins = decodeIL(body.il); } catch { continue; }
    for (const x of ins) {
      if (x.op !== 'ldfld' && x.op !== 'ldflda') continue;
      const f = asm.resolve(x.operand);
      if (f?.name === 'stealthStrike') return true;
    }
  }
  return false;
}

/**
 * Evaluate one ModProjectile: SetDefaults fields and AI traits.
 * @returns {{ fields: Record<string, any>, aiType?: any, cloneOf?: any, gravity: boolean, homing: boolean, wallPierceInAi: boolean, children: Array, debuffs: string[], stealth: boolean }}
 */
export function evalProjectile(asm, td, { tml }) {
  const rec = { fields: {}, children: [], debuffs: [], gravity: false, homing: false, wallPierceInAi: false, stealth: false };
  const PROJ = makeObj('projectile');
  const VEL = makeObj('velocity');
  let phase = 'defaults';
  let loops = [];
  const machine = new Machine(asm, {
    tml,
    concreteType: td,
    linear: true,
    maxDepth: 3,
    budget: 80000,
    onLoad(recv, name) {
      if (recv === PROJ) {
        if (name === 'velocity') return VEL;
        return rec.fields[name] ?? UNKNOWN;
      }
      if (recv === VEL) return { k: 'adj', slot: 'vel', field: name, add: 0, mul: 1 };
      return undefined;
    },
    onStore(recv, name, value, ctx) {
      if (recv === PROJ) {
        if (phase === 'defaults') {
          if (name === 'DamageType') { if (value?.k === 'dc') rec.damageClass = value.name; return; }
          rec.fields[name] = value;
        } else if (name === 'tileCollide' && value === 0 && !ctx.conditional) rec.wallPierceInAi = true;
        return;
      }
      if (recv === THIS && phase === 'defaults' && (name === 'AIType' || name === 'aiType')) { rec.aiType = value; return; }
      if (recv === VEL && name === 'Y' && phase === 'ai' && value?.k === 'adj' && value.slot === 'vel' && value.field === 'Y' && value.add > 0) rec.gravity = true;
    },
    onCall(callee, args, ctx) {
      const hooked = tmlStaticHook(callee, args, ctx);
      if (hooked !== undefined) return hooked;
      const name = callee.name;
      const decl = callee.declaringType?.fullName ?? callee.declaringType?.name ?? '';
      if (ctx.recv === THIS && name === 'get_Projectile') return PROJ;
      if (phase === 'defaults') {
        if (decl === 'Terraria.Projectile' && name === 'CloneDefaults') { rec.cloneOf = args[0]; return UNKNOWN; }
        return undefined;
      }
      if (decl === 'Terraria.Projectile' && /^NewProjectile(Direct)?$/.test(name)) {
        rec.children.push({ type: projTypeArg(callee, args), where: phase, offset: ctx.offset, method: ctx.method });
        return UNKNOWN;
      }
      if (phase === 'ai' && HOMING_RE.test(name)) rec.homing = true;
      if (phase === 'hit' && name === 'AddBuff' && args.length >= 2) {
        const b = args[0];
        rec.debuffs.push(isNum(b) ? `v:${b}` : b?.k === 'type' ? simpleName(b.name) : '?');
      }
      if (decl === 'Microsoft.Xna.Framework.Vector2' && name === 'op_Addition' && phase === 'ai') {
        const other = args[0] === VEL ? args[1] : args[1] === VEL ? args[0] : null;
        if (other?.k === 'obj' && isNum(other.args?.[1]) && other.args[1] > 0 && (other.args[0] === 0 || !isNum(other.args[0]))) rec.gravity = true;
        if (other) return VEL;
      }
      return undefined;
    },
    onStaticLoad: tmlStaticLoadHook,
    onBackJump(x, a, b, op, ctx) { loops.push({ lo: x.operand, hi: x.offset, n: loopCount(a, b, op), method: ctx.method }); },
  });

  const sd = findInherited(asm, td, 'SetDefaults');
  if (sd) machine.run(sd, THIS, []);
  const seen = new Set();
  for (const [ph, names] of PHASES) {
    phase = ph;
    for (const n of names) {
      const m = findInherited(asm, td, n);
      if (!m || seen.has(m)) continue;
      seen.add(m);
      loops = [];
      try { machine.run(m, THIS, symbolicArgs(asm, m)); } catch { /* keep what we have */ }
      for (const c of rec.children) {
        if (c.method !== m || c.count) continue;
        c.count = loops.filter((l) => l.method === m && c.offset >= l.lo && c.offset <= l.hi).reduce((p, l) => p * l.n, 1);
      }
    }
  }
  rec.stealth = readsStealth(asm, td);
  return rec;
}

function symbolicArgs(asm, m) {
  const sig = asm.methodSig(m);
  return sig.params.map(() => makeObj('arg'));
}

const num = (v) => (isNum(v) ? v : undefined);
const bool = (v) => (v === 1 || v === true ? true : v === 0 || v === false ? false : undefined);

/** Dataset record from an evaluated projectile. */
export function projectileRecord(asm, id, rec, { vanillaId = null } = {}) {
  const f = rec.fields;
  const children = new Map();
  for (const c of rec.children) {
    const t = projRef(asm, c.type);
    if (!t) continue;
    const key = `${t}|${c.where}`;
    const prev = children.get(key);
    if (prev) prev.count += c.count || 1;
    else children.set(key, { type: t, count: c.count || 1, where: c.where });
  }
  const aiType = isNum(rec.aiType) ? rec.aiType : rec.aiType?.k === 'type' ? null : undefined;
  const ai = num(f.aiStyle);
  const out = {
    id,
    pen: num(f.penetrate),
    tile: bool(f.tileCollide),
    updates: (num(f.extraUpdates) ?? 0) + (num(f.MaxUpdates) ? num(f.MaxUpdates) - 1 : 0) || undefined,
    ai,
    aiType: aiType ?? undefined,
    life: num(f.timeLeft),
    local: bool(f.usesLocalNPCImmunity) ? num(f.localNPCHitCooldown) ?? 10 : bool(f.usesIDStaticNPCImmunity) ? num(f.idStaticNPCHitCooldown) ?? 10 : undefined,
    minion: bool(f.minion) || undefined,
    sentry: bool(f.sentry) || undefined,
    slots: num(f.minionSlots),
    width: num(f.width),
    dc: rec.damageClass,
    gravity: rec.gravity || (ai !== undefined && GRAVITY_AI.has(ai)) || (ai === 1 && bool(f.arrow)) || undefined,
    homing: rec.homing || (vanillaId !== null && VANILLA_HOMING.has(vanillaId)) || undefined,
    walls: rec.wallPierceInAi || bool(f.tileCollide) === false || undefined,
    children: children.size ? [...children.values()] : undefined,
    debuffs: rec.debuffs.length ? [...new Set(rec.debuffs)] : undefined,
    stealth: rec.stealth || undefined,
    cloneOf: rec.cloneOf === undefined ? undefined : projRef(asm, rec.cloneOf) ?? undefined,
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

/** Every ModProjectile of a mod. */
export function extractProjectiles(asm, { tml, modId }) {
  const out = [];
  for (const td of asm.types) {
    if (td.flags & TYPE_ABSTRACT) continue;
    if (td.name.includes('`') || td.name.startsWith('<')) continue;
    if (!isModProjectileType(asm, td)) continue;
    let rec;
    try { rec = evalProjectile(asm, td, { tml }); } catch { continue; }
    out.push(projectileRecord(asm, `${modId}:${td.name}`, rec));
  }
  return out;
}

/** Vanilla projectiles: Projectile.SetDefaults1/2 walked with the case tracker. */
export function vanillaProjectiles(tml) {
  const projTd = tml.typeByName.get('Terraria.Projectile');
  const KEY0 = Object.freeze({ k: 'key', slot: 0 });
  const PROJ = makeObj('projectile');
  const byType = new Map();
  const rec = (type, name, value, conditional) => {
    let m = byType.get(type);
    if (!m) byType.set(type, (m = { fields: {}, children: [], debuffs: [], gravity: false, homing: false, wallPierceInAi: false, stealth: false }));
    if (name === 'DamageType') { if (value?.k === 'dc') m.damageClass = value.name; return; }
    if (conditional && name in m.fields) return;
    m.fields[name] = value;
  };
  const machine = new Machine(tml, {
    tml,
    linear: true,
    maxDepth: 1,
    budget: 3_000_000,
    onLoad(recv, name) {
      if (recv === PROJ) return name === 'type' ? KEY0 : UNKNOWN;
      return undefined;
    },
    onStore(recv, name, value, ctx) {
      if (recv !== PROJ) return;
      for (const c of ctx.cases ?? []) if (c.slot === 0 && isNum(c.value)) rec(c.value, name, value, ctx.conditional);
    },
    onCall(callee, args, ctx) {
      const hooked = tmlStaticHook(callee, args, ctx);
      if (hooked !== undefined) return hooked;
      if (ctx.recv === PROJ) return UNKNOWN;
      return undefined;
    },
    onStaticLoad: tmlStaticLoadHook,
  });
  for (const m of projTd.methods) {
    if (!/^SetDefaults\d$/.test(m.name)) continue;
    machine.run(m, PROJ, [KEY0]);
  }
  const out = [];
  for (const [type, r] of byType) {
    if (type <= 0) continue;
    out.push(projectileRecord(tml, `v:${type}`, r, { vanillaId: type }));
  }
  return out;
}
