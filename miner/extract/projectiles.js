/**
 * Projectile behaviour: `ModProjectile.SetDefaults` fields plus what the AI does with them
 * (gravity, homing, child projectiles, debuffs on hit, wall pierce), and the same for vanilla
 * projectiles out of `Projectile.SetDefaults1/2` with the case tracker.
 *
 * Output per projectile (see README "Real DPS"):
 *   { id, pen, tile, updates, ai, aiType, life, local, minion, sentry, slots, width, height,
 *     gravity, gravityK, drag, homing: { range, speed, inertia, delay }, held, still, sticks, returns, explode, digs,
 *     falloff, armorPen, children: [{ type, count, where, stealth, dmgMul, dmgAbs }], debuffs: [...],
 *     stealth, cloneOf }
 *
 * `gravityK` is the per-tick pull on `velocity.Y`, `drag` the per-tick multiplier on the velocity
 * (flamethrower cones, shotgun pellets), `held` a projectile the player holds (`player.heldProj`),
 * `still` one that parks itself (a rain cloud, a sentry), `explode` the radius its Kill resizes it
 * to. They are what the DPS model needs to say how far a shot reaches and whether it lands.
 */
import { decodeIL } from '../clr/il.js';
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
/** Per-tick `velocity.Y +=` of the vanilla arc aiStyles, when the AI itself could not be read. */
export const GRAVITY_K = 0.1;
/** How far a projectile with no readable search radius is assumed to see (pessimistic). */
export const HOMING_RANGE = 300;

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
 * Evaluate one ModProjectile: SetDefaults fields and AI traits.
 * @returns {{ fields: Record<string, any>, aiType?: any, cloneOf?: any, gravity: boolean, homing: boolean, wallPierceInAi: boolean, children: Array, debuffs: string[], stealth: boolean }}
 */
export function evalProjectile(asm, td, { tml }) {
  const rec = { fields: {}, children: [], mentions: [], debuffs: [], gravity: false, homing: false, wallPierceInAi: false, stealth: readsStealth(asm, td) };
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
   * `velocity * k` on its own is not drag yet. The same expression is half of every steering blend
   * in the game — `velocity = velocity * 0.9f + toTarget * 0.1f`, `(velocity * (N-1) + dir) / N` —
   * where the multiplier is a weight and the velocity is put straight back by what is added to it.
   * So the scale is carried until it is seen being stored, and anything added to it on the way
   * turns it back into a plain velocity.
   */
  const VEL_MUL = (mul) => ({ k: 'velMul', mul });
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
  const OWNER_AXIS = Object.freeze({ k: 'ownerAxis' });
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
        return rec.fields[name] ?? UNKNOWN;
      }
      if (recv === OWNER_POS && (name === 'X' || name === 'Y')) return OWNER_AXIS;
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
        // `damage = (int)(damage * 0.8f)` in OnHitNPC: the pierce falloff per successive hit
        if (name === 'damage' && phase === 'hit' && value?.k === 'adj' && value.slot === 'dmg' && value.mul > 0 && value.mul < 1) rec.falloff = Math.min(rec.falloff ?? 1, value.mul);
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
        if (name === 'velocity' && phase === 'ai') {
          // …and here is where a scale that survived intact becomes the per-tick drag
          if (value?.k === 'velMul') { noteDrag(value.mul, ctx); return; }
          if (value === VEL) return;
          if (value?.k === 'vecZero' || (value?.k === 'obj' && value.args?.every((a) => a === 0))) rec.still = true;
        }
        return;
      }
      if (recv === THIS && phase === 'defaults' && (name === 'AIType' || name === 'aiType')) { rec.aiType = value; return; }
      // The player holds this projectile out (a spear, a drill, a beam): it never travels on its
      // own. Only when that happens every tick — a charge-up weapon sets `heldProj` inside the
      // wind-up branch and then throws the thing, which is not a held weapon at all.
      if (recv === PLAYER && name === 'heldProj' && !ctx.conditional) rec.held = true;
      // `velocity.Y += k` written through a helper that takes the component by reference — Thorium
      // routes 40-odd of its thrown projectiles through `ProjectileExtras.ThrowingKnifeAI`, so
      // without this their arc and their decay are both invisible and they never pay for either
      if (name === '@ind' && recv?.k === 'adj' && recv.slot === 'vel' && phase === 'ai' && value?.k === 'adj' && value.slot === 'vel') {
        if (recv.field === 'Y' && value.field === 'Y' && value.add > 0) { rec.gravity = true; rec.gravityK = Math.max(rec.gravityK ?? 0, value.add); }
        if (value.mul !== 1 && value.add === 0) noteDrag(value.mul, ctx);
        return;
      }
      if (recv === VEL && phase === 'ai' && value?.k === 'adj' && value.slot === 'vel') {
        if (name === 'Y' && value.field === 'Y' && value.add > 0) { rec.gravity = true; rec.gravityK = Math.max(rec.gravityK ?? 0, value.add); }
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
      if (phase === 'ai' && HOMING_RE.test(name)) {
        // Calamity's `HomeInOnNPC(proj, ignoreTiles, range, speed, inertia)` and its variants carry
        // the three numbers the model needs; anything else only says that it homes
        const nums = args.filter(isNum);
        if (/^HomeInOn/.test(name) && nums.length >= 3) noteHoming({ range: nums[0], speed: nums[1], inertia: nums[2] });
        else noteHoming({});
      }
      if (phase === 'hit' && name === 'AddBuff' && args.length >= 2) {
        const b = args[0];
        rec.debuffs.push(isNum(b) ? `v:${b}` : b?.k === 'type' ? simpleName(b.name) : '?');
      }
      // `velocity.Y += MathHelper.Clamp(ai[1] / 40f, 0f, 1f)` is a gravity that ramps up; the value
      // inside is a counter the interpreter cannot follow, but the bounds say where it ends up, so
      // the middle of the range stands in rather than the whole term going unread.
      if (name === 'Clamp' && !isNum(args[0]) && isNum(args[1]) && isNum(args[2])) return (args[1] + args[2]) / 2;
      if (decl === 'Microsoft.Xna.Framework.Vector2' && name === 'get_Zero') return { k: 'vecZero' };
      if (decl === 'Microsoft.Xna.Framework.Vector2' && phase === 'ai') {
        // `Projectile.Center = npc.Center - offset` and its variants stay "an NPC's position"
        if (/^op_(Addition|Subtraction)$/.test(name) && (fromNpc(args[0]) || fromNpc(args[1]))) return NPC_POS;
        if (/^op_(Addition|Subtraction|Multiply|Division)$/.test(name) && (carriesOwner(args[0]) || carriesOwner(args[1]))) return OWNER_POS;
        if (name === 'op_Addition' || name === 'op_Subtraction') {
          const other = isVel(args[0]) ? args[1] : isVel(args[1]) ? args[0] : null;
          if (other?.k === 'obj' && isNum(other.args?.[1]) && other.args[1] > 0 && (other.args[0] === 0 || !isNum(other.args[0]))) { rec.gravity = true; rec.gravityK = Math.max(rec.gravityK ?? 0, other.args[1]); }
          if (other !== null) return VEL; // something was added to it: a blend, not a decay
        }
        if (name === 'op_Multiply' && (isVel(args[0]) || isVel(args[1]))) {
          const v = isVel(args[0]) ? args[0] : args[1];
          const k = isVel(args[0]) ? args[1] : args[0];
          return isNum(k) ? VEL_MUL((v.mul ?? 1) * k) : VEL;
        }
        // `velocity = (velocity * (N-1) + toTarget * s) / N` and `Vector2.Lerp(velocity, …, 1/N)`
        if (name === 'op_Division' && isVel(args[0]) && isNum(args[1]) && args[1] >= 2) { noteHoming({ inertia: args[1] }); return VEL; }
        if (name === 'Lerp' && isVel(args[0]) && isNum(args[2]) && args[2] > 0 && args[2] < 1) { noteHoming({ inertia: Math.round(1 / args[2]) }); return VEL; }
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
  if (td.methods.some((m) => STICKY_RE.test(m.name))) rec.sticks = true;
  return rec;
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
  const out = { range: num(a.range) ?? HOMING_RANGE };
  if (num(a.speed)) out.speed = a.speed;
  if (num(a.inertia)) out.inertia = a.inertia;
  if (num(a.delay)) out.delay = a.delay;
  return out;
}

/** Dataset record from an evaluated projectile. */
export function projectileRecord(asm, id, rec, { vanillaId = null } = {}) {
  const f = rec.fields;
  const children = new Map();
  for (const c of rec.children) {
    const t = projRef(asm, c.type);
    if (!t) continue;
    const key = `${t}|${c.where}|${c.stealth}`;
    const prev = children.get(key);
    if (prev) { prev.count += c.count || 1; continue; }
    // Keep a share of exactly 1: "it is spawned with the parent's damage" and "the damage argument
    // could not be followed" are opposite facts, and normalising the first to `undefined` made them
    // the same field. The model has to be able to tell them apart — one deserves full damage, the
    // other is a gap, and a gap gets the pessimistic answer.
    children.set(key, { type: t, count: c.count || 1, where: c.where, stealth: c.stealth, dmgMul: c.dmgMul, dmgAbs: c.dmgAbs });
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
    local: bool(f.usesLocalNPCImmunity) ? num(f.localNPCHitCooldown) ?? 10 : bool(f.usesIDStaticNPCImmunity) ? num(f.idStaticNPCHitCooldown) ?? 10 : undefined,
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
    held: rec.held || undefined,
    sticks: rec.sticks || undefined,
    returns: rec.returns || undefined,
    bounces: rec.bounces || undefined,
    // a projectile that parks itself where it was put: a rain cloud, a mine, a placed trap
    still: rec.still || undefined,
    explode: rec.explode !== undefined && rec.explode > (num(f.width) ?? 0) ? rec.explode : undefined,
    falloff: rec.falloff,
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
  return out;
}
