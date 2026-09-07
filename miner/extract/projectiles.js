/**
 * Projectile behaviour: `ModProjectile.SetDefaults` fields plus what the AI does with them
 * (gravity, homing, child projectiles, debuffs on hit, wall pierce), and the same for vanilla
 * projectiles out of `Projectile.SetDefaults1/2` with the case tracker.
 *
 * Output per projectile (see README "Real DPS"):
 *   { id, pen, tile, updates, ai, aiType, life, local, minion, sentry, slots, width, height,
 *     gravity, gravityK, drag, homing: { range, speed, inertia, delay }, held, windup, still, sticks, returns, explode, digs,
 *     falloff, ramp, armorPen, children: [{ type, count, where, stealth, dmgMul, dmgAbs }], debuffs: [...],
 *     stealth, cloneOf }
 *
 * `gravityK` is the per-tick pull on `velocity.Y`, `drag` the per-tick multiplier on the velocity
 * (flamethrower cones, shotgun pellets), `held` a projectile the player holds (`player.heldProj`),
 * `still` one that parks itself (a rain cloud, a sentry), `explode` the radius its Kill resizes it
 * to. They are what the DPS model needs to say how far a shot reaches and whether it lands.
 */
import { decodeIL } from '../clr/il.js';
import { alwaysRanges, branchRanges, chanceAt, chanceRanges, counterRanges, critRanges, gatesAt, ownedCapOf, requiresRanges } from './guards.js';
import { applyVanillaBehaviour } from './vanilla-behaviour.js';
import { Machine, NPC, PLAYER, THIS, UNKNOWN, isNum, simpleName, tmlStaticHook, tmlStaticLoadHook } from './interp.js';
import { TYPE_ABSTRACT, derivesFromTml, findInherited, refId } from './util.js';

export const isModProjectileType = (asm, td) => derivesFromTml(asm, td, 'ModProjectile');

/** Vanilla aiStyles whose movement is an arc (ProjAIStyleID). */
export const GRAVITY_AI = new Set([2, 5, 8, 10, 14, 16, 25, 47, 81, 113, 115, 131]);
/** Vanilla projectiles that seek targets (ProjectileID). */
export const VANILLA_HOMING = new Set([34, 35, 94, 181, 207, 254, 566, 634, 635, 659, 963, 953, 966, 622, 640, 641, 838, 840]);
/**
 * Calls that take the world apart: vanilla's own `WorldGen.KillTile/KillWall`, the `ExplodeTiles`
 * helper every explosive goes through, and the mods' equivalents. A projectile that reaches one of
 * these anywhere in its code digs — the call sitting behind an `if` changes nothing, since the
 * player still ends up with a hole in their arena the one time the branch is taken.
 * `PickTile` is deliberately not here: that is a drill mining on purpose, not collateral.
 */
const DIGS_RE = /^(KillTile|KillWall|KillTiles|ExplodeTiles?|DestroyTiles?|ExplodeWalls?)$/;

const DIG_CACHE = new Map();
/**
 * The same question asked of a method the projectile calls. Calamity routes every rocket through
 * `CalamityUtils.RocketBehavior`, which calls `ExplodeTiles` itself — and a helper handed unknown
 * arguments is not inlined, so the interpreter never sees it. Reading the callee's own IL costs a
 * decode per method, memoized, and one level below that is enough for the wrappers mods write.
 */
function methodDigs(asm, md, depth = 0) {
  if (!md) return false;
  const seen = DIG_CACHE.get(md);
  if (seen !== undefined) return seen;
  DIG_CACHE.set(md, false); // a recursive helper answers "no" to itself rather than looping
  const body = asm.methodBody(md);
  if (!body) return false;
  let ins;
  try { ins = decodeIL(body.il); } catch { return false; }
  let digs = false;
  for (const x of ins) {
    if (x.op !== 'call' && x.op !== 'callvirt') continue;
    let d;
    try { d = asm.resolve(x.operand); } catch { continue; }
    if (!d) continue;
    if (DIGS_RE.test(d.name ?? '') || (depth < 1 && d.def && methodDigs(asm, d.def, depth + 1))) { digs = true; break; }
  }
  DIG_CACHE.set(md, digs);
  return digs;
}

/** What mods call the flag on a projectile that embeds itself in what it hits. */
const STICKY_RE = /isStickingToTarget|StickToTarget|StickingTo/i;
const HOMING_RE = /Hom(e|ing)|Closest|Nearest|FindTarget|Seek|Track|CanBeChasedBy|GetTarget|TargetNPC|Chase|AcquireTarget|EnemyInRange|ClosestNPC/i;
/**
 * The three numbers a homing helper takes, by the *name* its parameters carry rather than by
 * counting numbers off the front of the call.
 *
 * `CalamityUtils.HomeInOnNPC(projectile, ignoreTiles, distanceRequired, homingVelocity, inertia,
 * respectIFrames)` opens with a bool, and a bool is the number 1 to the interpreter — so the
 * positional read handed back `range 1, speed 300, inertia 10` for a call that says the projectile
 * seeks anything within 300 px at 10 px/tick. Malachite's stealth kunai is the one that showed it:
 * homing from one pixel away is homing that never fires. The names are in the metadata, and reading
 * them also gets `HomeInOnSelectedNPC` right, which has no range argument at all and had been
 * handing its `homingVelocity` over as one.
 *
 * Falls back to the positional read (null) when the names are not readable — a helper in another
 * assembly, or one whose parameters are named something else.
 */
const HOMING_PARAM = { distanceRequired: 'range', homingRange: 'range', homingVelocity: 'speed', speed: 'speed', inertia: 'inertia', N: 'inertia' };
function homingByName(asm, callee, args) {
  let names;
  try { names = callee.def ? asm.paramNames(callee.def) : null; } catch { return null; }
  if (!names?.length) return null;
  const out = {};
  for (let i = 0; i < names.length; i++) { const k = HOMING_PARAM[names[i]]; if (k && isNum(args[i]) && out[k] === undefined) out[k] = args[i]; }
  return out.speed !== undefined || out.range !== undefined ? out : null;
}

/** Per-tick `velocity.Y +=` of the vanilla arc aiStyles, when the AI itself could not be read. */
export const GRAVITY_K = 0.1;
/** The largest per-update `velocity.Y +=` that is still an arc and not a misread steering blend. */
export const GRAVITY_MAX = 1.5;
/** How far a projectile with no readable search radius is assumed to see (pessimistic). */
export const HOMING_RANGE = 300;

const PHASES = [
  ['ai', ['AI', 'PreAI', 'PostAI', 'Kill']],
  ['kill', ['OnKill', 'PreKill']],
  ['hit', ['OnHitNPC', 'ModifyHitNPC', 'OnHitEffects']],
];

/**
 * Fields whose `SetDefaults` value is only what they are at *spawn*, because the game or the AI
 * moves them every update. Handing the spawn number back to an AI that branches on one makes the
 * branch statically decidable and the linear walk then takes a single arm for ever, so whatever the
 * other arm does is invisible.
 *
 * `timeLeft` was the one that showed it: Fungicide's split orb homes inside `if (timeLeft < 150)`
 * and spawns at 180, so the guard folded and the `HomeInOnNPC(450f, 6.5f, 20f)` under it was never
 * seen. Every field here counts down or is toggled the same way — `alpha` and `Opacity` fade,
 * `penetrate` drops on each pierce, `soundDelay` and the frame counters tick, `friendly` and
 * `tileCollide` are switched mid-flight (a charge arming, a shot turning off collision).
 *
 * Deliberately *not* here: `width`, `height` and `scale`. Those are read six thousand times over for
 * geometry — dust offsets, hitbox maths, blast radii — and an unknown there loses real arithmetic
 * rather than freeing a branch. The *stores* to every one of these are still read as before; this is
 * only about what a load hands back.
 */
const MUTATES = new Set(['timeLeft', 'alpha', 'Opacity', 'penetrate', 'soundDelay', 'frame', 'frameCounter', 'friendly', 'tileCollide']);

const makeObj = (name) => ({ k: 'obj', name, props: {} });

/** The projectile-type argument of a NewProjectile / NewProjectileDirect call. */
export function projTypeArg(callee, args) {
  const n = callee.sig?.params.length ?? args.length;
  return n >= 12 ? args[5] : args[3];
}

/**
 * Loop bookkeeping shared by every extractor that counts how many projectiles a burst fires.
 *
 * The count comes from the backward compare at the bottom of the loop, but that compare only says
 * where the counter is and where it stops — not how far it moves each pass. Assuming it moves by
 * one turns Calamity's `for (i = -5; i <= 5; i += 5)` fan into eleven javelins instead of three,
 * and the same mistake inflates every spread that steps in degrees. Remembering where each local
 * was written recovers the counter's starting value, and the step is what one pass moved it by.
 */
export function loopTracker() {
  const hist = new Map(); // local index -> [{ offset, value }], in execution order
  return {
    onStoreLocal(i, val, ctx) {
      let l = hist.get(i);
      if (!l) hist.set(i, (l = []));
      l.push({ offset: ctx.offset, value: val });
    },
    /** Iterations of the loop closed by this backward jump. */
    count(x, a, b, op) {
      if (!isNum(a)) return loopCount(a, b, op);
      const lo = x.operand, hi = x.offset;
      // the counter is the local the body just wrote and the compare just read
      let init = null;
      for (const l of hist.values()) {
        const inBody = l.filter((e) => e.offset >= lo && e.offset <= hi);
        if (!inBody.length || inBody[inBody.length - 1].value !== a) continue;
        const before = l.filter((e) => e.offset < lo && isNum(e.value));
        if (before.length) init = before[before.length - 1].value;
        break;
      }
      const step = init === null ? null : a - init;
      if (step === null || !step || !isNum(b)) return loopCount(a, b, op);
      const n = Math.floor((b - init) / step) + (op === 'ble' || op === 'bge' ? 1 : 0);
      if (!Number.isFinite(n) || n < 1) return 1;
      return Math.min(n, 30);
    },
  };
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

/** Calamity's per-projectile "this was a stealth strike" flag. */
const STEALTH_FIELD = 'stealthStrike';
/**
 * Whether a branch is inside the stealth-strike test, from the tags the interpreter carries: `true`
 * only a stealth strike gets here, `false` only a normal hit does, `undefined` either.
 */
function stealthTag(tags) {
  if (!tags?.length) return undefined;
  const re = new RegExp(`^(any:)?!?${STEALTH_FIELD}$`, 'i');
  for (const t of tags) if (re.test(t)) return !t.replace(/^any:/, '').startsWith('!');
  return undefined;
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
 * Does the type turn `Projectile.friendly` **on** anywhere outside `SetDefaults`?
 *
 * `friendly = false` in `SetDefaults` is two completely different statements depending on this. On
 * its own it says the thing can never damage an NPC — a charge marker, a bow holdout, a minion
 * anchor. With a write anywhere else it says the opposite: the projectile is armed later, and the
 * `SetDefaults` value is just where it starts.
 *
 * The store is very often out of reach of the phase walk. Ragnarok's Astral Ripper writes it
 * through a property — `set_CanHit(bool value) { Projectile.friendly = value; }` — called from
 * `HandleSwing`, and reading only the AI phases had a swung scythe scored as a prop that cannot
 * hit, 3993 → 1163/s. So the question is asked of every method the type has, the same way
 * `readsStealth` asks its own. Only run for the ~130 types that write a `false` at all.
 *
 * `Terraria.NPC` has a `friendly` of its own, which is why the declaring type is checked.
 */
function armsFriendly(asm, td) {
  // …up the chain, because the `false` itself usually comes from a base class: SOTS routes fourteen
  // Void crushers through `CrusherProjectile`, which is where both the `SetDefaults` and the arming
  // live. Asking only the leaf type found neither.
  for (let cur = td, i = 0; cur && i < 32; i++, cur = asm.baseOf(cur)?.kind === 'typeDef' ? asm.baseOf(cur).def : null) {
    for (const m of cur.methods) {
      if (m.name === 'SetDefaults') continue;
      const body = asm.methodBody(m);
      if (!body) continue;
      let ins;
      try { ins = decodeIL(body.il); } catch { continue; }
      for (const x of ins) {
        if (x.op !== 'stfld') continue;
        let f;
        try { f = asm.resolve(x.operand); } catch { continue; }
        if (f?.name === 'friendly' && /(^|\.)Projectile$/.test(f.declaringType?.fullName ?? f.declaringType?.name ?? '')) return true;
      }
    }
  }
  return false;
}

/**
 * Evaluate one ModProjectile: SetDefaults fields and AI traits.
 * @returns {{ fields: Record<string, any>, aiType?: any, cloneOf?: any, gravity: boolean, homing: boolean, wallPierceInAi: boolean, children: Array, debuffs: string[], stealth: boolean }}
 */
export function evalProjectile(asm, td, { tml }) {
  const rec = { fields: {}, self: {}, children: [], mentions: [], debuffs: [], gravity: false, velYAdds: [], velXAdds: new Set(), homing: false, wallPierceInAi: false, stealth: readsStealth(asm, td) };
  const PROJ = makeObj('projectile');
  const VEL = makeObj('velocity');
  const AI = { k: 'arr', items: [] };
  const LOCAL_AI = { k: 'arr', items: [] };
  const DMG = Object.freeze({ k: 'adj', slot: 'dmg', field: 'damage', add: 0, mul: 1 });
  let phase = 'defaults';
  let loops = [];
  const track = loopTracker();
  /**
   * `velocity.X *= k` / `velocity *= k`: the slowest per-tick multiplier wins. Only when it runs
   * every tick — a multiply inside a branch (stick into what you hit, slow down while charging,
   * stop on tile collision) is a one-off, and taking it for a permanent decay made `v/(1−k)` say a
   * projectile travels a handful of pixels.
   */
  const noteDrag = (k, ctx) => { if (isNum(k) && k > 0 && k < 1 && !ctx?.conditional) rec.drag = Math.min(rec.drag ?? 1, k); };
  /**
   * `velocity.Y += k`: the arc, but only when it is really one. `k` is a pull *per update*, and two
   * things that are not gravity are spelled the same way.
   *
   * The first is a bounded steering delta: 22 projectiles came back with a `k` of 2 to 6, and
   * Valediction's 5 had the model dropping its boomerang 300 px inside three ticks of flight. Every
   * genuine pull in the pack is a round number under 1.25 — 0.1 alone accounts for 234 of them,
   * then 0.4, 0.2, 0.35, 0.5 — so `GRAVITY_MAX` separates them.
   *
   * The second is a seeker's turn rate, and it hides inside the plausible range where no bound can
   * reach it. What gives it away is the axis: **gravity only ever touches Y**, while steering
   * pushes the same constant along both axes toward the target (`if (velocity.X < to.X)
   * velocity.X += turn; if (velocity.Y < to.Y) velocity.Y += turn;`). Scourge of the Desert's real
   * arc is `+= 0.15` in its pre-burrow branch and its turn rate is `+= 0.2` in the chase block;
   * `Math.max` took the 0.2, and the model then charged a javelin that steers onto the boss a 123 px
   * parabola. So a `k` also seen added to X is not a pull, and is refused whichever order the two
   * writes come in — the decision is deferred to the end of the walk.
   *
   * Deliberately *not* gated on `ctx.conditional` the way `noteDrag` is: 213 projectiles apply
   * their gravity inside a branch (`if (!sticking)`, `if (timeLeft < n)`) and every one of them
   * really does arc, so refusing those trades a handful of bad reads for a much larger, and
   * optimistic, hole.
   */
  const noteGravity = (k) => { if (isNum(k) && k > 0) rec.velYAdds.push(k); };
  /** …and the same constant on the X axis, which is what marks one of them as steering. */
  const noteVelX = (k) => { if (isNum(k) && k > 0) rec.velXAdds.add(k); };
  /**
   * `velocity * k` on its own is not drag yet. The same expression is half of every steering blend
   * in the game — `velocity = velocity * 0.9f + toTarget * 0.1f`, `(velocity * (N-1) + dir) / N` —
   * where the multiplier is a weight and the velocity is put straight back by what is added to it.
   * So the scale is carried until it is seen being stored, and anything added to it on the way
   * turns it back into a plain velocity.
   */
  const VEL_MUL = (mul) => ({ k: 'velMul', mul });
  /** A velocity something was added to — the numerator of a steering blend, and not a decay. */
  const VEL_SUM = { k: 'velMul', mul: 1, sum: true };
  /**
   * …divided by N: the steering blend's shape, `(velocity * (N-1) + toTarget * speed) / N`. Carried
   * rather than noted, because the same division is written for reasons that have nothing to do
   * with a target — the Acid Gun's stream spaces its dust trail with `velocity / 3f` and was read
   * as a seeker with an inertia of 3. It is only steering if it is put *back into the velocity*.
   */
  const VEL_BLEND = (inertia) => ({ k: 'velMul', mul: 1, blend: inertia });
  const isVel = (v) => v === VEL || v?.k === 'velMul';
  const noteHoming = (o) => { rec.homing = true; rec.homingArgs = { ...(rec.homingArgs ?? {}), ...o }; };
  // A projectile that sets its own centre *from* an NPC's is riding that NPC: it stuck into the
  // first thing it hit and goes no further. A homing projectile also reads an NPC's centre, but it
  // steers with it — it never writes its own position from it — so the value has to be followed
  // rather than the two facts merely counted. Terraria's own example calls the flag
  // `isStickingToTarget` and mods copy it, so the name is a second route to the same fact.
  const NPC_POS = Object.freeze({ k: 'npcPos' });
  const fromNpc = (v) => v === NPC_POS;
  // …and the same trick for the owner: a projectile that steers by `player.Center - Center` is on
  // its way home. That is a boomerang however it is spelled — the design note asked for "an `ai`
  // that returns to the owner" and this is it. Thorium's baseball does it in `OnHitNPC`, which is
  // why it read as infinite pierce: it does not go through what it hits, it bounces back to you.
  const OWNER_POS = Object.freeze({ k: 'ownerPos' });
  const fromOwner = (v) => v === OWNER_POS;
  // A weapon that builds that vector one component at a time through a local struct — Thorium's
  // baseball does — would lose the marker, so the components carry it too.
  const OWNER_AXIS = Object.freeze({ k: 'ownerAxis', taint: true });
  const carriesOwner = (v) => v === OWNER_POS || v === OWNER_AXIS
    || (v?.k === 'obj' && Object.values(v.props ?? {}).some((x) => x === OWNER_AXIS))
    || (v?.k === 'obj' && (v.args ?? []).some((x) => x === OWNER_AXIS));
  const machine = new Machine(asm, {
    tml,
    concreteType: td,
    linear: true,
    maxDepth: 3,
    budget: 80000,
    onLoad(recv, name) {
      // `Projectile.Calamity().stealthStrike` decides half of what a rogue projectile does. Handing
      // it back as a flag makes the branch it guards a *tagged* region, so a child spawned inside
      // it can be told from one the projectile always spawns.
      if (name === STEALTH_FIELD) return { k: 'flag', name: STEALTH_FIELD };
      if (recv === PROJ) {
        if (name === 'velocity') return VEL;
        // `Projectile.ai[]` is where a mod stashes what it decided earlier — Calamity writes the
        // stealth-strike flag into `ai[0]` in OnKill and branches on it further down. Handing back
        // one array per run lets a value survive that round trip instead of becoming UNKNOWN.
        if (name === 'ai' || name === 'localAI') return name === 'ai' ? AI : LOCAL_AI;
        // the child's damage argument is usually the parent's, scaled: keep it symbolic so the
        // arithmetic that follows lands as a multiplier rather than as UNKNOWN
        if (name === 'damage' && phase !== 'defaults') return DMG;
        // `timeLeft` counts *down*, so the number `SetDefaults` gave it is only what it is at the
        // moment it spawns. Handing that back to the AI makes every "later in its life" branch
        // statically decidable and the walk takes one arm for ever: Fungicide's split orb homes
        // inside `if (timeLeft < 150)` and its `timeLeft` is 180, so the guard folded to false and
        // the `HomeInOnNPC(450f, 6.5f, 20f)` under it was never seen. 26 Calamity projectiles that
        // call the helper carried no homing at all, nearly all of them a split or secondary shot
        // that starts seeking partway through. Unknown is the truth: it is 180 once and then it is
        // not.
        if (MUTATES.has(name) && phase !== 'defaults') return UNKNOWN;
        return rec.fields[name] ?? UNKNOWN;
      }
      // `player.position` reached as a *field* is the same fact as `player.Center` reached as a
      // property, and only the property was being recognised. Thorium's Whip returns by
      // `player.position.X + player.width * 0.5f - Center.X` and so read as a projectile that
      // simply flies away — its `maxOut: 1` round trip never got priced.
      // …and `damage` read off a projectile the walk reached through `Main.projectile[…]` — the
      // parent, in every case in the pool — is the same weapon's damage in the model's unit, so it
      // keeps the marker rather than losing the whole term to an unknown receiver. A beam that
      // scales itself off the prism holding it (`damage = prism.damage * multiplier`) is spelled
      // exactly that way, and so is a child spawned at its parent's damage.
      if (name === 'damage' && phase !== 'defaults' && recv !== NPC && recv !== PLAYER) return DMG;
      if (recv === PLAYER && (name === 'position' || name === 'Center' || name === 'MountedCenter')) return OWNER_POS;
      if (recv === OWNER_POS && (name === 'X' || name === 'Y')) { if (phase === 'ai') rec.ownerAxis = true; return OWNER_AXIS; }
      if (recv === VEL) return { k: 'adj', slot: 'vel', field: name, add: 0, mul: 1 };
      return undefined;
    },
    onStore(recv, name, value, ctx) {
      if (recv === PROJ) {
        if (phase === 'defaults') {
          if (name === 'DamageType') { if (value?.k === 'dc') rec.damageClass = value.name; return; }
          rec.fields[name] = value;
          return;
        }
        // SetDefaults is not the last word on pierce: Calamity's rogue projectiles set it again on
        // their first AI tick, and typically as `penetrate = stealthStrike ? 4 : 2`. A ternary
        // leaves the store at the join with no branch tag, so the value cannot be attributed by
        // tag — but an AI raising pierce above what SetDefaults gave, in a type that reads the
        // stealth flag at all, is the stealth copy being made stronger. It is recorded as the
        // strike's pierce only, leaving the ordinary throw on the SetDefaults number, so the
        // reading can only ever under-credit. An *unconditional* store is simply the later word.
        if (name === 'penetrate' && phase === 'ai' && isNum(value)) {
          const rank = (v) => (v === -1 ? Infinity : v);
          if (!ctx.conditional) rec.fields.penetrate = value;
          else if (rec.stealth && rank(value) > rank(rec.fields.penetrate ?? 1)) rec.stealthPen = value;
        }
        if (name === 'tileCollide' && value === 0 && !ctx.conditional) rec.wallPierceInAi = true;
        // A projectile that decides every tick whether it is friendly is not dealing damage for
        // part of its life: `Projectile.friendly = DoneCharging` is how a charge weapon holds the
        // shot on the player until you let go, and the same store is how a mine arms itself after
        // a delay. Either way the weapon's use time is not its clock — there is a wind-up in front
        // of every shot that the item's `useTime` says nothing about. `SetDefaults` writing the
        // constant 1 is the ordinary case and is not this; only an unconditional store of a value
        // the interpreter could not fold is, which is the flag being read back out of a field.
        if (name === 'friendly' && phase === 'ai' && !isNum(value)) rec.windup = true;
        // …and any write outside `SetDefaults` at all is what tells the two readings below apart:
        // one that arms the projectile later is a wind-up, and a `SetDefaults` false with no such
        // write anywhere is a projectile that never becomes able to damage anything. `armsFriendly`
        // asks the same of the methods this walk does not reach.
        if (name === 'friendly' && phase !== 'defaults') rec.friendlyLater = true;
        // …and turning it *off* the moment it connects is the projectile spending itself. Whatever
        // its `penetrate` and its immunity cooldown say, it lands exactly one hit and everything
        // after that is a dead sprite. SOTS's Star Laser is `penetrate = -1` with a 10-tick window
        // of its own, and `OnHitNPC` calls `TriggerStop()`: velocity to zero, `tileCollide` off,
        // `friendly` off. The pierce model read the pierce and the window and gave it 19 hits.
        if (name === 'friendly' && phase === 'hit' && isNum(value) && !value) rec.spent = true;
        // `damage = (int)(damage * 0.8f)` in OnHitNPC: the pierce falloff per successive hit
        if (name === 'damage' && phase === 'hit' && value?.k === 'adj' && value.slot === 'dmg' && value.mul > 0 && value.mul < 1) rec.falloff = Math.min(rec.falloff ?? 1, value.mul);
        // …and the same store in the *AI* is the opposite thing: a projectile that scales its own
        // damage up while it lives. That is how a charge weapon states its ramp — Yharim's Crystal's
        // beam sets `damage = <the prism's damage> * GetDamageMultiplier(charge)`, and the helper is
        // `Lerp(1f, 3f, x³)` over 180 ticks — and the model had no way to know the printed number is
        // not what a held beam is doing after three seconds. Only ever a *rise*: anything at or below
        // ×1 in the AI is a fade, a reset, or the walk folding a branch, and the pessimistic reading
        // of those is the printed damage the record already carries.
        if (name === 'damage' && phase === 'ai' && value?.k === 'adj' && value.slot === 'dmg' && value.mul > 1) rec.ramp = Math.max(rec.ramp ?? 1, value.mul);
        // the blast radius a Kill resizes the projectile to
        if ((name === 'width' || name === 'height') && phase !== 'ai' && isNum(value) && value > (rec.explode ?? 0)) rec.explode = value;
        if (name === 'velocity' && carriesOwner(value)) { rec.returns = true; return; }
        // It changes course when it hits something, so it is not passing cleanly through: it
        // bounces off, or turns round and comes home. Either way its pierce is not a pass.
        if (name === 'velocity' && phase === 'hit') { rec.bounces = true; return; }
        if (name === 'velocity' && carriesOwner(value)) { rec.returns = true; return; }
        // It changes course when it hits something, so it is not passing cleanly through: it
        // bounces off, or turns round and comes home. Either way its pierce is not a pass.
        if (name === 'velocity' && phase === 'hit') { rec.bounces = true; return; }
        // The mirror of the `sticks` rule two blocks up: a projectile that writes its own centre from
        // the *owner's*, every tick, is anchored to the player rather than flying anywhere. On its
        // own this says very little — 129 projectiles do it, and most are held beams, swung blades
        // and minions, all of which are anchored by design and already tagged. It earns its keep in
        // one conjunction, in `archetypeOf`: anchored to the player *and* launched at a `shootSpeed`
        // of nothing is a thing you carry, not a thing you throw.
        if (name === 'Center' && phase === 'ai' && !ctx.conditional && carriesOwner(value)) { rec.ridesOwner = true; return; }
        if (name === 'velocity' && phase === 'ai') {
          // …and here is where a scale that survived intact becomes the per-tick drag, and where a
          // blend that was really put back into the velocity becomes the steering it is
          if (value?.blend) { noteHoming({ inertia: value.blend }); return; }
          if (value?.k === 'velMul') { noteDrag(value.mul, ctx); return; }
          if (value === VEL) return;
          if (value?.k === 'vecZero' || (value?.k === 'obj' && value.args?.every((a) => a === 0))) rec.still = true;
        }
        return;
      }
      if (recv === THIS && phase === 'defaults' && (name === 'AIType' || name === 'aiType')) { rec.aiType = value; return; }
      // …and every other number the type writes to a field of its **own** in `SetDefaults`. Most of
      // them are private bookkeeping and nobody reads them, but a charge weapon states its whole
      // mechanism there — how long it winds up for, and what the wind-up buys — and until now the
      // walk threw all of it away because the receiver was not `Terraria.Projectile`.
      if (recv === THIS && phase === 'defaults' && isNum(value)) { rec.self[name] = value; return; }
      // The player holds this projectile out (a spear, a drill, a beam): it never travels on its
      // own. Only when that happens every tick — a charge-up weapon sets `heldProj` inside the
      // wind-up branch and then throws the thing, which is not a held weapon at all.
      if (recv === PLAYER && name === 'heldProj' && !ctx.conditional) rec.held = true;
      // …and one that writes the player's *animation* every tick is holding the use open for as long
      // as it is out (`player.itemTime = 2`). The item's `useTime` is then not the weapon's clock at
      // all: it never comes round while the button is down, and the moment the projectile ends the
      // animation has two ticks left. Nothing bounds a re-click but the player's own hand — which is
      // what makes tapping such a weapon a different attack from holding it, at a rate the item's own
      // numbers cannot state.
      if (recv === PLAYER && (name === 'itemTime' || name === 'itemAnimation') && phase === 'ai') rec.pinsUse = true;
      // `velocity.Y += k` written through a helper that takes the component by reference — Thorium
      // routes 40-odd of its thrown projectiles through `ProjectileExtras.ThrowingKnifeAI`, so
      // without this their arc and their decay are both invisible and they never pay for either
      if (name === '@ind' && recv?.k === 'adj' && recv.slot === 'vel' && phase === 'ai' && value?.k === 'adj' && value.slot === 'vel') {
        if (recv.field === 'Y' && value.field === 'Y') noteGravity(value.add);
        if (recv.field === 'X' && value.field === 'X') noteVelX(value.add);
        if (value.mul !== 1 && value.add === 0) noteDrag(value.mul, ctx);
        return;
      }
      if (recv === VEL && phase === 'ai' && value?.k === 'adj' && value.slot === 'vel') {
        if (name === 'Y' && value.field === 'Y') noteGravity(value.add);
        if (name === 'X' && value.field === 'X') noteVelX(value.add);
        if (value.mul !== 1 && value.add === 0) noteDrag(value.mul, ctx);
      }
    },
    onCall(callee, args, ctx) {
      const hooked = tmlStaticHook(callee, args, ctx);
      if (hooked !== undefined) {
        // Every projectile type this one so much as names. The machine walks the code linearly, so
        // of two `NewProjectile` calls on either side of a branch it only ever resolves one — and
        // the branch it drops is exactly where a mod puts the nastier variant (Catalyst's satchel
        // charge swaps its harmless blast for the tile-breaking one on a stealth strike). A mention
        // is not a child and is used for nothing else; for tile damage it is evidence enough.
        if (hooked?.k === 'type' && hooked.fn === 'ProjectileType') rec.mentions.push(hooked);
        return hooked;
      }
      const name = callee.name;
      const decl = callee.declaringType?.fullName ?? callee.declaringType?.name ?? '';
      if (ctx.recv === THIS && name === 'get_Projectile') return PROJ;
      if (phase === 'defaults') {
        if (decl === 'Terraria.Projectile' && name === 'CloneDefaults') { rec.cloneOf = args[0]; return UNKNOWN; }
        // `DefaultToWhip()` is how a mod declares a whip: it sets the whip aiStyle, the whip damage
        // class and the settings struct in one call, none of which the interpreter would otherwise
        // see. Vanilla whips come from `ProjectileID.Sets.IsAWhip` instead.
        if (decl === 'Terraria.Projectile' && name === 'DefaultToWhip') { rec.whip = true; return UNKNOWN; }
        return undefined;
      }
      if (decl === 'Terraria.Projectile' && /^NewProjectile(Direct)?$/.test(name)) {
        const n = callee.sig?.params.length ?? args.length;
        const dmg = n >= 12 ? args[6] : args[4];
        rec.children.push({
          type: projTypeArg(callee, args),
          where: phase,
          offset: ctx.offset,
          method: ctx.method,
          // which strike spawns it: true = only a stealth strike does, false = only a normal hit
          stealth: stealthTag(ctx.condTags),
          dmgMul: dmg?.k === 'adj' && dmg.slot === 'dmg' ? dmg.mul : undefined,
          dmgAbs: isNum(dmg) ? dmg : undefined,
        });
        return UNKNOWN;
      }
      if (!rec.digs && (DIGS_RE.test(name) || methodDigs(asm, callee.def))) rec.digs = true;
      if (name === 'get_Center' && ctx.recv === NPC) return NPC_POS;
      if (/^get_(Center|MountedCenter|position)$/.test(name) && ctx.recv === PLAYER) return OWNER_POS;
      if (phase === 'ai' && (name === 'set_Center' || name === 'set_position') && ctx.recv === PROJ && fromNpc(args[0])) { rec.sticks = true; return UNKNOWN; }
      if (decl === 'Terraria.Projectile' && name === 'Resize' && isNum(args[0])) { rec.explode = Math.max(rec.explode ?? 0, args[0], isNum(args[1]) ? args[1] : 0); return UNKNOWN; }
      if (HOMING_RE.test(name)) {
        // Calamity's `HomeInOnNPC(proj, ignoreTiles, range, speed, inertia)` and its variants carry
        // the three numbers the model needs; anything else only says that it homes
        if (phase === 'ai') {
          const named = homingByName(asm, callee, args);
          const nums = args.filter(isNum);
          if (named) noteHoming(named);
          else if (/^HomeInOn/.test(name) && nums.length >= 3) noteHoming({ range: nums[0], speed: nums[1], inertia: nums[2] });
          else noteHoming({});
        }
        // …and the search for a target is not evidence that there is none. Inlined, these helpers
        // walk a loop over `Main.npc` the machine cannot run and hand back the `null` they were
        // initialised with — and the `if (target != null)` the payload sits under then folds to
        // *false*, which marks every projectile, debuff and child the weapon fires at what it found
        // as dead code. Eternity summons its crystals, its beam and its flower burst inside exactly
        // that guard and came out of the miner with no children at all.
        return UNKNOWN;
      }
      if (phase === 'hit' && name === 'AddBuff' && args.length >= 2) {
        const b = args[0];
        rec.debuffs.push(isNum(b) ? `v:${b}` : b?.k === 'type' ? simpleName(b.name) : '?');
      }
      // `velocity.Y += MathHelper.Clamp(ai[1] / 40f, 0f, 1f)` is a gravity that ramps up; the value
      // inside is a counter the interpreter cannot follow, but the bounds say where it ends up, so
      // the middle of the range stands in rather than the whole term going unread.
      if (name === 'Clamp' && !isNum(args[0]) && isNum(args[1]) && isNum(args[2])) return (args[1] + args[2]) / 2;
      // `MathHelper.Lerp(a, b, t)` between two numbers is a value somewhere between them, and where
      // `t` is a charge the walk cannot follow the middle stands in for it, exactly as `Clamp` does
      // above. It is how a weapon states its own damage ramp: Yharim's Crystal's beam scales itself
      // by `Lerp(1f, 3f, x³)`, so the beam is worth twice the printed number rather than the
      // unknown that made the whole term unreadable.
      if (name === 'Lerp' && args.length === 3 && isNum(args[0]) && isNum(args[1])) return (args[0] + args[1]) / 2;
      if (decl === 'Microsoft.Xna.Framework.Vector2' && name === 'get_Zero') return { k: 'vecZero' };
      if (decl === 'Microsoft.Xna.Framework.Vector2' && phase === 'ai') {
        // `Projectile.Center = npc.Center - offset` and its variants stay "an NPC's position"
        if (/^op_(Addition|Subtraction)$/.test(name) && (fromNpc(args[0]) || fromNpc(args[1]))) return NPC_POS;
        if (/^op_(Addition|Subtraction|Multiply|Division)$/.test(name) && (carriesOwner(args[0]) || carriesOwner(args[1]))) return OWNER_POS;
        if (name === 'op_Addition' || name === 'op_Subtraction') {
          const other = isVel(args[0]) ? args[1] : isVel(args[1]) ? args[0] : null;
          if (other?.k === 'obj' && isNum(other.args?.[1]) && (other.args[0] === 0 || !isNum(other.args[0]))) noteGravity(other.args[1]);
          if (other !== null) return VEL_SUM; // something was added to it: a blend, not a decay
        }
        if (name === 'op_Multiply' && (isVel(args[0]) || isVel(args[1]))) {
          const v = isVel(args[0]) ? args[0] : args[1];
          const k = isVel(args[0]) ? args[1] : args[0];
          return isNum(k) ? VEL_MUL((v.mul ?? 1) * k) : VEL;
        }
        // `velocity = (velocity * (N-1) + toTarget * s) / N` and `Vector2.Lerp(velocity, …, 1/N)`
        // …and a division with nothing added stays a plain velocity: `velocity / MaxUpdates` on the
        // first frame is a launch fixup, not a decay, so it is not read as drag either
        if (name === 'op_Division' && isVel(args[0]) && isNum(args[1]) && args[1] >= 2) return args[0]?.sum ? VEL_BLEND(args[1]) : VEL;
        if (name === 'Lerp' && isVel(args[0]) && isNum(args[2]) && args[2] > 0 && args[2] < 1) return VEL_BLEND(Math.round(1 / args[2]));
      }
      return undefined;
    },
    onStaticLoad(f) {
      const decl = f.declaringType?.fullName ?? '';
      if (decl.endsWith('Vector2') && f.name === 'Zero') return { k: 'vecZero' };
      // `Main.player[Projectile.owner].heldProj = …` is how a held projectile announces itself
      if (decl === 'Terraria.Main' && f.name === 'player') return { k: 'arr', tag: 'players', items: [] };
      if (decl === 'Terraria.Main' && f.name === 'npc') return { k: 'arr', tag: 'npcs', items: [] };
      return tmlStaticLoadHook(f);
    },
    onStoreLocal: track.onStoreLocal,
    onBackJump(x, a, b, op, ctx) { loops.push({ lo: x.operand, hi: x.offset, n: track.count(x, a, b, op), method: ctx.method }); },
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
      // a projectile that refuses to let more than N of itself exist says so in its own AI, the
      // same way a weapon says it in CanUseItem — and for a cloud or a tether that cap *is* the
      // sustained damage, because what it does per second is one instance's rate times how many live
      if (ph === 'ai') { rec.maxActive ??= ownedCapOf(asm, m); rec.ownAi = true; }
      loops = [];
      AI.items.length = 0;
      LOCAL_AI.items.length = 0;
      try { machine.run(m, THIS, symbolicArgs(asm, m)); } catch { /* keep what we have */ }
      for (const c of rec.children) {
        if (c.method !== m || c.count) continue;
        c.count = loops.filter((l) => l.method === m && c.offset >= l.lo && c.offset <= l.hi).reduce((p, l) => p * l.n, 1);
      }
    }
  }
  // Decided once the whole walk is in, because the two facts are the same write seen twice.
  // A `velocity.Y +=` that was *not* also pushed along X is the arc; one that *was* is the third
  // homing shape in the game and the one the call-name reader cannot see: a per-axis bang-bang
  // accelerator, `if (velocity.X < to.X) velocity.X += k; else velocity.X -= k;` and the same on Y.
  // Scourge of the Desert steers that way at 0.2 a update, and carried nothing but the default
  // range because neither `HomeInOnNPC` nor the `(v*(N-1) + dir*s)/N` blend is anywhere in it.
  const pulls = rec.velYAdds.filter((k) => !rec.velXAdds.has(k) && k <= GRAVITY_MAX);
  if (pulls.length) { rec.gravity = true; rec.gravityK = Math.max(...pulls); }
  // …and the same per-axis accelerator serves two different jobs, told apart by what it steers
  // *toward*. Calamity's boomerangs never write `velocity` from the owner vector — the shape
  // `carriesOwner` was written for — they nudge each component toward it a step at a time, which is
  // why Kylie read as a fire-and-forget dagger thrown on its use timer. An AI that asks where the
  // owner is and then accelerates per axis is coming back; one that does it without asking is
  // seeking whatever its homing call found.
  const steers = rec.velYAdds.filter((k) => rec.velXAdds.has(k));
  if (steers.length && rec.ownerAxis) rec.returns = true;
  else if (steers.length && rec.homing) rec.homingArgs = { ...(rec.homingArgs ?? {}), turn: Math.max(...steers) };
  if (td.methods.some((m) => STICKY_RE.test(m.name))) rec.sticks = true;
  return rec;
}

/**
 * A charge weapon that states its own numbers.
 *
 * The generic wind-up read (`windup`) only knows *that* a projectile arms partway through its life;
 * `WINDUP_TICKS` then stands in for how long, and nothing at all stands in for what the charge is
 * worth. But a mod that builds a charge weapon has to keep those numbers somewhere, and it keeps
 * them in `SetDefaults` as fields of its own type — SOTS's fourteen Void crushers put the whole
 * mechanism in `CrusherProjectile`: `chargeTime = 180`, `releaseTime = 150`, `minDamage = 0.3`,
 * `maxDamage = 7`, `minExplosions = 3`, `maxExplosions = 5`. Held for three seconds, Eclipse slams
 * for five explosions at seven times its printed damage; tapped, three at a third of it.
 *
 * Read by field *name*, which is the same thin evidence `branch.charge` runs on and is treated the
 * same way: it is only ever a charge record, never a score. The model still has to decide what
 * holding the button is worth against tapping it, and it grades both.
 *
 * `chargeTime` alone is the trigger — a type that names one is a charge weapon whatever else it
 * says — and every other field is optional, so a mod that scales damage but not count, or count but
 * not damage, still reads.
 */
function chargeRecord(self) {
  const ticks = num(self.chargeTime);
  if (!(ticks > 0)) return undefined;
  const out = { ticks };
  const pick = (k, ...names) => { for (const n of names) if (num(self[n]) > 0) { out[k] = self[n]; return; } };
  pick('release', 'releaseTime');
  pick('minMul', 'minDamage');
  pick('maxMul', 'maxDamage');
  pick('minCount', 'minExplosions');
  pick('maxCount', 'maxExplosions');
  // a "ramp" that does not rise is not one, and a count that does not grow is just the count
  if (out.maxMul <= (out.minMul ?? 0)) delete out.maxMul;
  if (out.maxCount <= (out.minCount ?? 0)) delete out.maxCount;
  return out;
}

function symbolicArgs(asm, m) {
  const sig = asm.methodSig(m);
  return sig.params.map(() => makeObj('arg'));
}

const num = (v) => (isNum(v) ? v : undefined);
const bool = (v) => (v === 1 || v === true ? true : v === 0 || v === false ? false : undefined);

/**
 * Homing as an object the model can reason with. A projectile that clearly seeks a target but
 * whose search radius, turn speed and inertia could not be read gets the pessimistic defaults:
 * it only sees `HOMING_RANGE` px and turns as slowly as an average seeker.
 */
function homingRecord(rec, vanillaId) {
  const seeks = rec.homing || (vanillaId !== null && VANILLA_HOMING.has(vanillaId));
  if (!seeks) return undefined;
  const a = rec.homingArgs ?? {};
  // `speed` and `inertia` are simply absent when unread, so the model can already tell. `range`
  // could not: the fallback was baked in and came back out looking like a number somebody read.
  const out = { range: num(a.range) ?? HOMING_RANGE };
  if (num(a.range) == null) out.rangeGuess = true;
  // px per update per update, straight off the steering write — no `inertia` guess in front of it
  if (num(a.turn)) out.turn = a.turn;
  if (num(a.speed)) out.speed = a.speed;
  if (num(a.inertia)) out.inertia = a.inertia;
  if (num(a.delay)) out.delay = a.delay;
  return out;
}

/** Dataset record from an evaluated projectile. */
export function projectileRecord(asm, id, rec, { vanillaId = null } = {}) {
  const f = rec.fields;
  const children = new Map();
  // a spawn behind a `NextBool` roll happens that often, not every time — read per method, since a
  // projectile's children come from its AI, its OnHitNPC and its OnKill, each with its own offsets
  const rolls = new Map();
  const rollAt = (c) => {
    if (!c.method) return undefined;
    if (!rolls.has(c.method)) rolls.set(c.method, chanceRanges(asm, c.method));
    return chanceAt(rolls.get(c.method), c.offset);
  };
  // …and the counters and requirements, in the domain the method gives them: a counter in `AI`
  // counts ticks, one in `OnHitNPC` counts hits.
  //
  // The list is exact names on purpose. Widening it to every `*AI` was tried — Calamity runs each
  // holdout's logic in `HoldoutAI`, and its 60-tick shot cooldowns were reading as "once per 60
  // *uses*" — and it costs more than it buys: a helper called *from* `AI` is not per tick just
  // because of its name. Thorium's `PoisonPricklerPro2.SpecialAI` runs once per projectile, behind
  // the fade-in that gates it, and its `ai[1] % 3` generation counter read as a 3-tick cadence: two
  // clouds every three ticks for 300 ticks, 148 → 1869 DPS. The domain has to come from whether the
  // counter really moves each tick, which is a read the walk does not have.
  const domainOf = (m) => (/^(AI|PostAI|PreAI|PostDraw)$/.test(m.name) ? 'tick' : /OnHit/.test(m.name) ? 'hit' : /Kill/.test(m.name) ? 'death' : 'use');
  const guardSets = new Map();
  const gatesOf = (c) => {
    if (!c.method) return {};
    if (!guardSets.has(c.method)) {
      const counters = counterRanges(asm, c.method, domainOf(c.method));
      const reqs = requiresRanges(asm, c.method);
      const crits = critRanges(asm, c.method);
      if (!rolls.has(c.method)) rolls.set(c.method, chanceRanges(asm, c.method));
      const always = alwaysRanges(asm, c.method);
      guardSets.set(c.method, { counters: counters.filter((r) => r.gate), requires: reqs, crits, always, explained: [...rolls.get(c.method), ...counters, ...reqs, ...crits, ...always], all: branchRanges(asm, c.method) });
    }
    return gatesAt(guardSets.get(c.method), c.offset);
  };
  for (const c of rec.children) {
    const t = projRef(asm, c.type);
    if (!t) continue;
    const gates = gatesOf(c);
    // one record per spawn site behind a different gate: a burst every eighth hit and the ordinary
    // shot on every other one are not one child with a count of two
    const key = `${t}|${c.where}|${c.stealth}|${JSON.stringify(gates)}`;
    const chance = rollAt(c);
    const prev = children.get(key);
    // two spawns merged into one record only keep odds they agree on; disagreeing ones are unread
    if (prev) { prev.count += c.count || 1; if (prev.chance !== chance) prev.chance = undefined; continue; }
    // Keep a share of exactly 1: "it is spawned with the parent's damage" and "the damage argument
    // could not be followed" are opposite facts, and normalising the first to `undefined` made them
    // the same field. The model has to be able to tell them apart — one deserves full damage, the
    // other is a gap, and a gap gets the pessimistic answer.
    children.set(key, { type: t, count: c.count || 1, where: c.where, stealth: c.stealth, dmgMul: c.dmgMul, dmgAbs: c.dmgAbs, chance, ...gates });
  }
  const aiType = isNum(rec.aiType) ? rec.aiType : rec.aiType?.k === 'type' ? null : undefined;
  const ai = num(f.aiStyle);
  const out = {
    id,
    pen: num(f.penetrate),
    stealthPen: rec.stealthPen,
    tile: bool(f.tileCollide),
    updates: (num(f.extraUpdates) ?? 0) + (num(f.MaxUpdates) ? num(f.MaxUpdates) - 1 : 0) || undefined,
    ai,
    aiType: aiType ?? undefined,
    life: num(f.timeLeft),
    maxActive: rec.maxActive,
    local: bool(f.usesLocalNPCImmunity) ? num(f.localNPCHitCooldown) ?? 10 : bool(f.usesIDStaticNPCImmunity) ? num(f.idStaticNPCHitCooldown) ?? 10 : undefined,
    // …and whose window it is. `usesLocalNPCImmunity` gives *each projectile* its own; the ID-static
    // flag gives one window to **every projectile of the type at once**, so a volley of them cannot
    // stack the way a volley with local immunity can — it is the player's shared window again, only
    // on the projectile's cooldown rather than the item's.
    shared: !bool(f.usesLocalNPCImmunity) && bool(f.usesIDStaticNPCImmunity) ? true : undefined,
    minion: bool(f.minion) || undefined,
    sentry: bool(f.sentry) || undefined,
    whip: rec.whip || undefined,
    slots: num(f.minionSlots),
    width: num(f.width),
    height: num(f.height),
    dc: rec.damageClass,
    gravity: rec.gravity || (ai !== undefined && GRAVITY_AI.has(ai)) || (ai === 1 && bool(f.arrow)) || undefined,
    gravityK: rec.gravityK ?? ((rec.gravity || (ai !== undefined && GRAVITY_AI.has(ai)) || (ai === 1 && bool(f.arrow))) ? GRAVITY_K : undefined),
    drag: rec.drag,
    homing: homingRecord(rec, vanillaId),
    // …but not if it also changes course when it hits something. `held` means the player holds it
    // out and it never travels on its own; `bounces` means it flies into things and comes off them.
    // The two cannot both be true, and where they are it is the `heldProj` read that is wrong: a
    // charge weapon sets it inside its wind-up branch, and the walk folds a `ChargeProgress < 1f`
    // guard to true on the first tick, so the store reads as unconditional. Fishbone Boomerang and
    // Equanimity were coming out `spear` — held, and so exempt from travel lead, arc and range
    // altogether — for a weapon that is thrown and ricochets between three enemies.
    held: (rec.held && !rec.bounces) || undefined,
    // Whether the type overrides an AI of its own at all — `false` where the walk looked and found
    // none, absent where nothing looked (a vanilla projectile, a synthetic record). A projectile
    // the walk cleared cannot be the "carrier whose shots the miner did not read" the zero-damage
    // rule assumes: there is no unread AI. Bellerose's held umbrella is that, `SetDefaults` and
    // nothing else. The distinction has to survive into the dataset, because "we looked and there
    // is nothing" and "we did not look" call for opposite answers.
    ownAi: vanillaId === null ? !!rec.ownAi : undefined,
    // it switches its own damage on partway through its life: a charge held on the player, a mine
    // that arms after a delay — either way the shot is not free the moment the button goes down
    windup: rec.windup || undefined,
    // Nothing anywhere says `friendly = true`: this thing cannot damage an NPC, ever. It is a charge
    // marker, a holdout, a prop — SOTS's Perfect Star hides one on the player (`hide`, `alpha = 255`)
    // purely to count the charge, and the model was paying it six contact hits a second.
    //
    // *Never mentioning* the field says exactly the same thing, and reading it as "nobody looked"
    // was letting every invisible controller in the pack bill contact damage. `Projectile.SetDefaults`
    // writes `friendly = 0` in its own reset, before `SetDefaults_Inner` dispatches to the mod's
    // override, so a `ModProjectile` that never turns it on is harmless by the game's own arithmetic:
    // Thorium's Obsidian Staff holds an `alpha = 255` charge controller whose boulders do the damage,
    // and it was scored as a beam held on the boss at six hits a second.
    //   `cloneOf`  copies a *vanilla* projectile's defaults, friendly among them — unknown, not false.
    //   `vanillaId`  is a vanilla record, where the field was read from the game's own SetDefaults.
    friendly: (bool(f.friendly) === false || (vanillaId === null && f.friendly === undefined && rec.cloneOf === undefined))
      && !rec.friendlyLater && !rec.friendlyArmed ? false : undefined,
    // the item's use animation is held open for as long as this is out, so `useTime` is not its clock
    pinsUse: rec.pinsUse || undefined,
    // it disarms itself on its first hit: one hit, whatever the pierce says
    spent: rec.spent || undefined,
    // what holding the button buys, in the weapon's own numbers
    charge: chargeRecord(rec.self ?? {}),
    sticks: rec.sticks || undefined,
    returns: rec.returns || undefined,
    // …and vanilla bounces every `aiStyle 3` boomerang off whatever it hits, in `Projectile.Damage`
    // rather than in any AI a mod writes:
    //   if (aiStyle == 3) { if (ai[0] == 0f) { velocity = -velocity; } ai[0] = 1f; }
    // It reverses and heads home on the *first* NPC it touches, so whatever `penetrate` says, it is
    // not carving a path through a crowd. 41 of the 47 projectiles on that aiStyle carried a pierce
    // they cannot use — every vanilla boomerang from the Wooden Boomerang to the Light Disc, and
    // Calamity's Sand Dollar, which `penetrate = -1` had sweeping six bodies a throw.
    bounces: rec.bounces || ai === 3 || undefined,
    // a projectile that parks itself where it was put: a rain cloud, a mine, a placed trap
    still: rec.still || undefined,
    // …and one that is pinned to the player instead, wherever the player goes
    ridesOwner: rec.ridesOwner || undefined,
    explode: rec.explode !== undefined && rec.explode > (num(f.width) ?? 0) ? rec.explode : undefined,
    falloff: rec.falloff,
    // …and the opposite, read in the AI: what the projectile scales its own damage *up* to while it
    // is out, as a multiplier on the printed number. A charge ramp: only a weapon that is held long
    // enough gets to the top of it, which is the model's business, not the record's.
    ramp: rec.ramp > 1 ? Math.round(rec.ramp * 100) / 100 : undefined,
    armorPen: num(f.ArmorPenetration),
    walls: rec.wallPierceInAi || bool(f.tileCollide) === false || undefined,
    digs: rec.digs || undefined,
    mentions: rec.mentions?.length ? [...new Set(rec.mentions.map((m) => projRef(asm, m)).filter(Boolean))] : undefined,
    children: children.size ? [...children.values()] : undefined,
    debuffs: rec.debuffs.length ? [...new Set(rec.debuffs)] : undefined,
    stealth: rec.stealth || undefined,
    cloneOf: rec.cloneOf === undefined ? undefined : projRef(asm, rec.cloneOf) ?? undefined,
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

/**
 * The `*ID.Sets` tables tModLoader's `SetFactory` builds in a static constructor
 * (`ProjectileID.Sets.YoyosMaximumRange`, `IsAWhip`, …). The factory takes a default and a flat
 * `id, value, id, value` array, both of which the interpreter can read.
 * @returns {Map<string, { dflt: number|boolean, ids?: number[], pairs?: Map<number, number> }>}
 */
export function idSets(tml, typeFullName) {
  const td = tml.typeByName.get(typeFullName);
  const out = new Map();
  if (!td) return out;
  const machine = new Machine(tml, {
    tml,
    budget: 400000,
    onCall(callee, args) {
      const arr = args.find((a) => a?.k === 'arr');
      if (!arr) return undefined;
      if (callee.name === 'CreateBoolSet') return { k: 'set', dflt: args[0] === 1, ids: arr.items.filter(isNum) };
      if (callee.name === 'CreateFloatSet' || callee.name === 'CreateIntSet') {
        const pairs = new Map();
        for (let i = 0; i + 1 < arr.items.length; i += 2) if (isNum(arr.items[i]) && isNum(arr.items[i + 1])) pairs.set(arr.items[i], arr.items[i + 1]);
        return { k: 'set', dflt: isNum(args[0]) ? args[0] : 0, pairs };
      }
      return undefined;
    },
    onStaticStore(f, v) { if (v?.k === 'set') out.set(f.name, v); },
  });
  const cctor = td.methods.find((m) => m.name === '.cctor');
  if (cctor) { try { machine.run(cctor, undefined, []); } catch { /* keep what was captured */ } }
  return out;
}

/**
 * Vanilla yoyos and whips: their behaviour lives in the shared aiStyle, not in `SetDefaults`, so
 * the case tracker never sees them. `ProjectileID.Sets` is the game's own table for it.
 */
export function vanillaSetProjectiles(tml) {
  const sets = idSets(tml, 'Terraria.ID.ProjectileID/Sets');
  const range = sets.get('YoyosMaximumRange');
  const speed = sets.get('YoyosTopSpeed');
  const life = sets.get('YoyosLifeTimeMultiplier');
  const whip = sets.get('IsAWhip');
  const out = new Map();
  const yoyoIds = new Set([...(range?.pairs?.keys() ?? []), ...(speed?.pairs?.keys() ?? [])]);
  for (const id of yoyoIds) {
    out.set(`v:${id}`, {
      ai: 99,
      pen: -1,
      local: YOYO_HIT_COOLDOWN,
      yoyo: { range: range?.pairs?.get(id) ?? range?.dflt ?? 200, speed: speed?.pairs?.get(id) ?? speed?.dflt ?? 10, life: life?.pairs?.get(id) ?? life?.dflt ?? -1 },
    });
  }
  for (const id of whip?.ids ?? []) out.set(`v:${id}`, { ...(out.get(`v:${id}`) ?? {}), whip: true });
  return out;
}
/** Vanilla yoyos hit the same NPC about six times a second (Projectile.aiStyle 99). */
export const YOYO_HIT_COOLDOWN = 10;

/** Every ModProjectile of a mod. `loc` names them: `ApolloFireball` is the Volatile Plasma Blast. */
export function extractProjectiles(asm, { tml, modId, loc = null }) {
  const out = [];
  for (const td of asm.types) {
    if (td.flags & TYPE_ABSTRACT) continue;
    if (td.name.includes('`') || td.name.startsWith('<')) continue;
    if (!isModProjectileType(asm, td)) continue;
    let rec;
    try { rec = evalProjectile(asm, td, { tml }); } catch { continue; }
    // …wherever `SetDefaults` did not turn it *on*: a `false` there and no mention at all are the
    // same statement, so both have to ask whether some other method arms it later.
    if (!rec.fields?.friendly && !rec.friendlyLater) rec.friendlyArmed = armsFriendly(asm, td);
    const name = loc?.proj(td.name);
    out.push({ ...projectileRecord(asm, `${modId}:${td.name}`, rec), ...(name ? { name } : {}) });
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
  const extra = vanillaSetProjectiles(tml);
  for (const [type, r] of byType) {
    if (type <= 0) continue;
    const rec = projectileRecord(tml, `v:${type}`, r, { vanillaId: type });
    const set = extra.get(rec.id);
    if (set) { Object.assign(rec, { ...set, ...rec }); extra.delete(rec.id); }
    out.push(rec);
  }
  // yoyos and whips whose SetDefaults the case tracker never reached exist only as set entries
  for (const [id, set] of extra) out.push({ id, ...set });
  // …and what the shared `Projectile.AI` does that no SetDefaults says: the game's own table
  applyVanillaBehaviour(tml, out);
  return out;
}
