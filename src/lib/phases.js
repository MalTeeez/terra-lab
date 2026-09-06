/**
 * A weapon as a small graph of *phases*: the separate events that produce its damage.
 *
 * `item.arch` answers "what kind of weapon is this?" — bow, flail, minion — and stays the display
 * and filter category. A phase answers a different question: "what actually happens, how often, and
 * what has to be true first?" A flail spins, launches, hits, returns and releases; a gun fires an
 * ordinary shot and a burst after every eighth landed hit. Collapsing those into one archetype is
 * where the model's over- and under-scores come from, because the archetype has to stand in for the
 * one fact nobody recorded: *how often does this happen*.
 *
 * This module is deliberately only the description. It knows what the miner read and how confident
 * that reading is; it does not know what a hit is worth, how far the boss is, or what the loadout
 * carries. `dps.js` owns all of that and evaluates these records against a target. Keeping the two
 * apart is what lets a phase be tested, printed and argued with on its own — and it keeps the
 * dependency one-way, so the description can never quietly start depending on the score.
 *
 * Every phase carries its own evidence and confidence, so a conservative fallback can never be
 * mistaken for something the miner actually read.
 */

/**
 * The mechanical vocabulary. Kinds are about *what happens*, never about a named weapon: if a
 * mechanic seems to need a new kind, it usually needs an existing kind with a gate on it.
 */
export const PHASE_KINDS = Object.freeze([
  'primary',   // the use animation itself: the clock everything else hangs off
  'travel',    // something leaves the player and crosses to the target
  'contact',   // something held or swung at the target, hitting on its own cooldown
  'impact',    // what a landed hit triggers
  'split',     // what a projectile spawns
  'linger',    // something that stays where it was put and ticks
  'minion',    // an autonomous summon on its own clock, paid for in slots
  'debuff',    // damage over time applied to the target
]);

/**
 * How a phase combines with its siblings.
 *
 *   concurrent   both happen; their damage adds
 *   alternative  one of them happens; today the model cannot read which, so it averages them —
 *                which is exactly the fact this field exists to make visible and, later, fixable
 *   modifier     it changes another phase rather than dealing damage of its own
 */
export const RELATIONS = Object.freeze(['concurrent', 'alternative', 'modifier']);

/** How good the evidence for a phase's numbers is. Anything but `exact` is a worklist entry. */
export const CONFIDENCE = Object.freeze(['exact', 'text', 'structural', 'assumed']);

/**
 * What event creates a phase. This is the gate the model most often lacks: a child of an on-hit
 * trigger cannot run more often than its parent lands, and one on a timer nobody read cannot be
 * assumed to run once per use.
 */
export const TRIGGERS = Object.freeze(['use', 'hit', 'death', 'timer']);
/** The miner's `children[].where`, as a trigger. Anything it did not name runs on an unread clock. */
const WHERE_TRIGGER = { hit: 'hit', kill: 'death', ai: 'timer' };

/**
 * One phase, with every field the compiler may read given a defined default.
 *
 * The gates (`chance`, `threshold`, `cooldown`, `maxActive`) are all `null` here and are what the
 * rest of this rework fills in. `null` means "not read", which is not the same as "does not apply":
 * a child with an unread spawn rate is why the model needs a blanket cap at all.
 */
export function makePhase(kind, fields = {}) {
  if (!PHASE_KINDS.includes(kind)) throw new Error(`unknown phase kind: ${kind}`);
  if (fields.relation && !RELATIONS.includes(fields.relation)) throw new Error(`unknown relation: ${fields.relation}`);
  if (fields.confidence && !CONFIDENCE.includes(fields.confidence)) throw new Error(`unknown confidence: ${fields.confidence}`);
  if (fields.trigger && !TRIGGERS.includes(fields.trigger)) throw new Error(`unknown trigger: ${fields.trigger}`);
  return {
    id: fields.id ?? kind,
    kind,
    parent: fields.parent ?? null,
    trigger: fields.trigger ?? 'use',
    relation: fields.relation ?? 'concurrent',
    /** which alternative it belongs to: phases sharing a `region` are branches of one if/else */
    region: fields.region ?? null,
    /** the projectile it delivers, as a dataset id */
    projId: fields.projId ?? null,
    count: fields.count ?? 1,
    spread: fields.spread ?? 0,
    fan: !!fields.fan,
    /** an absolute launch speed the miner read, overriding the weapon's own `shootSpeed` */
    absVelocity: fields.absVelocity ?? null,
    velMul: fields.velMul ?? 1,
    /**
     * The raw mined share of the weapon's damage — the model decides what an unreadable one means.
     * An explicit `null` is "the miner could not read it" and must survive: `?? 1` would quietly
     * turn every unread share into a full-damage child, which is the exact mistake this record
     * exists to prevent.
     */
    dmgMul: fields.dmgMul === undefined ? 1 : fields.dmgMul,
    /**
     * A flat damage number the spawn was given instead of a share of the weapon's. It is a fact
     * about the projectile, not about this weapon's DPS, and it must be told apart from a share
     * the miner simply could not read — both used to arrive as "no multiplier".
     */
    dmgAbs: fields.dmgAbs ?? null,
    // ---- gates: how often this phase actually runs. `null` is "not read", not "no gate".
    chance: fields.chance ?? null,
    threshold: fields.threshold ?? null,
    cooldown: fields.cooldown ?? null,
    maxActive: fields.maxActive ?? null,
    /** ticks between two hits of one instance while it stays on the target (a tether's tick) */
    interval: fields.interval ?? null,
    /** ticks one instance stays for, once it has landed */
    duration: fields.duration ?? null,
    requires: fields.requires ?? null,
    /** an if/else the miner found but could not classify: `{ id, side, cond }` — the residual */
    branch: fields.branch ?? null,
    /** spawned only on a crit (true) or only on a non-crit (false) */
    crit: fields.crit ?? null,
    /**
     * What running this phase costs and out of what pool, as `{ kind, cost }`. Minion slots are the
     * one the model already understands; mana, Void, inspiration and exhaustion come through the
     * same door, which is the point of naming it here rather than per mechanic.
     */
    resource: fields.resource ?? null,
    /** the debuff this phase applies, as a dataset id */
    buffId: fields.buffId ?? null,
    evidence: fields.evidence ?? null,
    confidence: fields.confidence ?? 'assumed',
  };
}

const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, other: 2, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
const numOf = (s) => NUM_WORDS[String(s).toLowerCase()] ?? Number(s);

/**
 * The gates a tooltip states in numbers, for when the code did not give them up: the interpreter
 * follows what a projectile spawns and how hard it hits, but not the `timer % 60` that makes a
 * tether tick once a second, the link counter that stops it at three, or the hit counter that
 * releases a burst on the eighth. Text is the fallback, never the override — the model only reads
 * these where it has no mined number — and everything found here is `confidence: 'text'`.
 *
 *   interval    "deals damage once every second", "damage every 4 seconds" — ticks between hits of
 *               one instance. "12 damage per second" is a DoT statement, not a cadence, and is
 *               not read.
 *   maxActive   "up to 3 enemies can be chained" — how many instances may be out at once
 *   threshold   "after hitting an enemy 8 times", "every 5 hits", "four times in a row" — hits
 *               needed per activation. "Every fourth shot" is a use counter, not a hit counter,
 *               and `Shoot` already carries that as a branch.
 *
 * @returns {{ interval: number|null, maxActive: number|null, threshold: number|null, evidence: object }}
 */
export function textGates(text) {
  const t = String(text ?? '');
  const out = { interval: null, maxActive: null, threshold: null, cooldown: null, evidence: {} };
  let m = /\b(?:once|damage|hits?|strikes?|ticks?)\b[^.\n]{0,30}?\bevery\s+(?:(\d+(?:\.\d+)?|\w+)\s+)?seconds?\b(?!\s+(?:hit|shot|swing|attack|use|strike))/i.exec(t);
  if (m) { const s = m[1] ? numOf(m[1]) : 1; if (s > 0) { out.interval = Math.round(60 * s); out.evidence.interval = m[0]; } }
  m = /\bup to (\d+|\w+) (?:enemies|targets|links?|chains?)\b/i.exec(t);
  if (m) { const n = numOf(m[1]); if (n > 0) { out.maxActive = n; out.evidence.maxActive = m[0]; } }
  // "30 second cooldown", "a cooldown of 5 seconds": what a proc can fire at most
  m = /\b(\d+(?:\.\d+)?)\s*(?:seconds?|secs?)\s+cooldown\b/i.exec(t) ?? /\bcooldown of (\d+(?:\.\d+)?)\s*(?:seconds?|secs?)\b/i.exec(t);
  if (m) { const s = Number(m[1]); if (s > 0) { out.cooldown = Math.round(60 * s); out.evidence.cooldown = m[0]; } }
  // "times" only counts when it is hits being counted ("after returning three times" is not), and
  // "up to N times" is how often something *may* happen, not how many it takes
  m = /\b(?:after|every)\b[^.\n]{0,20}?\b(?<!up to )(\d+|\w+)\s+hits?\b/i.exec(t)
    ?? /\b(?:after|every)\b[^.\n]{0,12}?\bhit\w*\b[^.\n]{0,20}?\b(?<!up to )(\d+|\w+)\s+times\b/i.exec(t)
    ?? /\b(\d+|\w+)\s+(?:hits?|times)\s+in a row\b/i.exec(t);
  if (m) { const n = numOf(m[1]); if (n > 1) { out.threshold = n; out.evidence.threshold = m[0]; } }
  return out;
}

/**
 * The use clock: the phase every other one hangs off, and the only one every weapon has.
 *
 * It is built from the *effective* numbers rather than the item's own, because a reforge and a
 * balancing overlay both change how often the weapon may be used, and the phase describes the
 * weapon as it will actually be swung.
 *
 * @param {object} o  { useTicks, maxActive, projId }
 */
export function primaryPhase({ useTicks, maxActive = null, projId = null }) {
  return makePhase('primary', {
    id: 'primary',
    trigger: 'use',
    projId,
    cooldown: useTicks > 0 ? useTicks : null,
    maxActive,
    evidence: { from: 'use time' },
    confidence: useTicks > 0 ? 'exact' : 'assumed',
  });
}

/**
 * The blade itself. A broadsword's damage is not something it fires — it is the weapon touching the
 * target on the animation's clock — and without a phase for it the largest archetype in the pool
 * had nothing describing what it does at all: 294 of 395 `swing` weapons resolved to a delivery
 * phase with no projectile behind it, which says only that the miner found nothing.
 *
 * It is `contact` rather than a kind of its own because that is what it is: a hitbox held on the
 * target for as long as the swing lasts, on its own clock, exactly like a yoyo's.
 */
export function swingPhase({ swingTicks, scale = 1 }) {
  return makePhase('contact', {
    id: 'swing',
    parent: 'primary',
    trigger: 'use',
    cooldown: swingTicks > 0 ? swingTicks : null,
    evidence: { from: 'melee swing', scale },
    confidence: swingTicks > 0 ? 'exact' : 'assumed',
  });
}

/**
 * The trip out and back that a one-at-a-time weapon has to finish before it can be thrown again.
 * The round trip, not the use time, is what sets a boomerang's rate — the whole difference between
 * it and a knife with the same numbers.
 */
export function returnPhase({ tripTicks, maxActive = null, projId = null }) {
  return makePhase('travel', {
    id: 'return',
    parent: 'primary',
    trigger: 'timer',
    projId,
    cooldown: tripTicks > 0 ? tripTicks : null,
    maxActive,
    evidence: { from: 'flight cycle' },
    // the distance it sails before turning round is an archetype default, not a mined number
    confidence: 'structural',
  });
}

/**
 * The delivery phases of one firing variant: what this click, in this stealth state, puts in the
 * air. Ordered exactly as the model must evaluate them — the `top` region first in call order, then
 * the alternative branches, then the weapon's default shot — because that order is the arithmetic.
 *
 * `stocked` is what the *other* click fires directly. A projectile this attack spawns on hit that
 * the other one throws is ammunition it is stocking, not damage it is dealing, and counting it in
 * both places pays for the same projectile twice.
 *
 * @param {object|null} fire       `item.fire`
 * @param {object} o               { variant, alt, primaryId }
 * @returns {{ phases: Array, stocked: Set<string>, hasDefault: boolean }}
 */
export function deliveryPhases(fire, { variant, alt = false, primaryId = null } = {}) {
  const calls = (fire?.calls ?? []).filter((c) => (!c.variant || c.variant === variant) && (c.alt === undefined || c.alt === alt));
  const stocked = new Set((fire?.calls ?? [])
    .filter((c) => c.alt !== undefined && c.alt !== alt)
    .map((c) => (c.type === 'shoot' ? primaryId : c.type)));

  const phases = calls.map((c, i) => {
    // A call the miner priced — a roll, a counter, a requirement — is not an alternative to
    // anything: it happens, with known odds. Only a branch whose condition could not be read has
    // to be averaged against its siblings, and that branch now names itself (`branch.id`, one id
    // for both arms of one if/else) instead of borrowing the interpreter's region end.
    const priced = (c.chance > 0 && c.chance < 1) || !!c.threshold || !!c.requires;
    const region = c.branch ? `branch:${c.branch.id}` : priced ? 'top' : c.region ?? 'top';
    return makePhase('travel', {
    id: `call:${i}`,
    parent: 'primary',
    region,
    relation: region === 'top' ? 'concurrent' : 'alternative',
    chance: c.chance ?? null,
    threshold: c.threshold ?? null,
    requires: c.requires ?? null,
    branch: c.branch ?? null,
    projId: c.type === 'shoot' ? primaryId : c.type,
    count: c.count ?? 1,
    spread: c.spread ?? 0,
    fan: !!c.fan,
    absVelocity: c.abs ?? null,
    velMul: c.velMul ?? 1,
    // a share the miner read (omitted: ×1 of the argument), a flat number it read, and nothing
    // read (`dmg: 'unread'`): three facts, kept apart
    dmgMul: c.dmg === 'unread' || c.dmgAbs != null ? null : c.dmgMul ?? 1,
    dmgAbs: c.dmgAbs ?? null,
    evidence: {
      from: 'Shoot', call: i, ...(c.variant ? { variant: c.variant } : {}), ...(c.alt !== undefined ? { alt: c.alt } : {}),
      // `confidence` describes what was read — the projectile, its count and spread. The gates are
      // rated apart, because a branch nobody read the condition of is still an exact projectile.
      gates: {
        ...(c.dmg === 'unread' ? { damage: 'assumed' } : {}),
        ...(region !== 'top' ? { branch: c.branch?.known ? 'exact' : 'assumed' } : {}),
        ...(c.threshold ? { threshold: 'exact' } : {}),
        ...(c.requires ? { requires: 'exact' } : {}),
      },
    },
    confidence: 'exact',
  }); });

  // The shot the item fires by itself, when `Shoot` did not replace it — and *only* then. The
  // `!calls.length` fallback is for a weapon whose `Shoot` the miner could not read at all; where
  // it was read and says the default is suppressed, a variant with no calls of its own fires
  // nothing, which is a fact and not a gap to fill in with `item.shoot`.
  //
  // Bellerose opens `Shoot` with `if (player.altFunctionUse != 2) return false;` — its left click
  // throws nothing, and the tornado `item.shoot` names is a right-click payload gated on three
  // successful attacks. The fallback was handing that tornado out on every left click, 232 of the
  // 350 DPS it was scoring at Pre-boss.
  const hasDefault = fire?.defaultShot ? !!fire.defaultShot[variant] : !fire?.calls?.length || fire?.returnsTrue === true;
  // …and the suppression only counts where the weapon's attack demonstrably lives somewhere else:
  // `Shoot` was read, it says this variant fires nothing, and the calls it *did* read belong to the
  // other click. Refusing the fallback on the strength of `defaultShot` alone stranded 60 weapons
  // with no phase at all, which is a worse answer than a shot they might not fire.
  const elsewhere = !!fire?.defaultShot && !!fire?.calls?.length && !calls.length;
  if (hasDefault || (!calls.length && !elsewhere)) {
    phases.push(makePhase('travel', {
      id: 'default',
      parent: 'primary',
      region: 'default',
      projId: primaryId,
      evidence: { from: fire?.defaultShot ? 'Shoot returns true' : 'item.shoot' },
      confidence: primaryId ? 'exact' : 'assumed',
    }));
  }
  return { phases, stocked, hasDefault };
}

/**
 * The debuffs a weapon puts on the target: one record per distinct debuff across everything it
 * fires, in the order they were found. Whether the target is immune, and what the debuff is worth,
 * is the model's business — this only says what gets applied and by what.
 *
 * They are listed separately rather than summed because they do not all combine the same way: two
 * sources of the same debuff refresh it, two different debuffs stack, and the model currently adds
 * every one of them without asking which. Naming them is the first step to asking.
 */
export function debuffPhases(sources) {
  const out = [];
  const seen = new Set();
  for (const src of sources) {
    for (const d of src?.debuffs ?? []) {
      if (seen.has(d)) continue;
      seen.add(d);
      out.push(makePhase('debuff', { id: `debuff:${d}`, trigger: 'hit', buffId: d, evidence: { from: 'projectile debuffs' }, confidence: 'exact' }));
    }
  }
  return out;
}

/**
 * A summon as a phase: it fights on its own clock and is paid for in minion slots rather than in
 * the player's attention, which is why it is `concurrent` with whatever else is being swung.
 *
 * `cooldown` is the projectile's raw `local` value. A negative one means "hits a given NPC once and
 * never again" and is not a rate at all — the model currently reads it as one, which turns into a
 * negative hit rate. Kept raw here so the record states the fact rather than hiding the bug.
 */
export function summonPhase(primary, arch, { projId = null } = {}) {
  return makePhase('minion', {
    id: arch,
    projId,
    cooldown: primary?.local ?? null,
    resource: { kind: 'minionSlots', cost: primary?.slots || 1 },
    evidence: { from: 'minion projectile', arch },
    confidence: primary?.local > 0 ? 'exact' : 'assumed',
  });
}

/**
 * Something held or swung at the target rather than thrown at it — a yoyo on its string, a beam, a
 * cloud you place. It hits on its own cooldown for as long as the player keeps it there, so the
 * weapon's use time is not its clock.
 *
 * `cooldown` null means the projectile sets no immunity of its own and goes through the player's
 * single window on that NPC, which is a different fact from a projectile that may hit once and
 * never again — `local` below zero says the latter, and such a weapon is not a contact weapon at
 * all however long it is held there.
 */
export function contactPhase(p, arch, { projId = null, maxActive = null, channel = false } = {}) {
  return makePhase('contact', {
    id: 'contact',
    projId,
    cooldown: p?.local > 0 ? p.local : null,
    // how many of it may exist at once: the projectile's own cap, else what the weapon's CanUseItem
    // allows. What a held or placed weapon does per second is one instance's rate times this.
    maxActive: p?.maxActive ?? maxActive ?? null,
    // how long a weapon of this shape is on the boss at all: an archetype default standing in for
    // the lifetime, cooldown and max-concurrent evidence the miner has not read yet
    // a channelled weapon is held for as long as the button is: its clock is the projectile's
    // contact cooldown, not the item's use time, and its payload may land on release
    evidence: { from: 'archetype uptime', arch, channel: channel || undefined },
    confidence: p?.local > 0 ? 'exact' : 'assumed',
  });
}

/**
 * What a projectile spawns: the blast on impact, the splinters on death, the shots it fires while
 * it flies. One record per `children` entry, each carrying the trigger that creates it.
 *
 * The trigger is the point. A child of an on-hit trigger cannot run more often than its parent
 * lands, and one on a clock nobody read must not be assumed to run once per use — that unread
 * clock is the entire reason the model needs a blanket cap on what spawned projectiles are worth.
 *
 * @param {object|null} p   the parent projectile record
 * @param {object} o        { variant, parentId }
 */
export function spawnPhases(p, { variant, parentId = null } = {}) {
  const out = [];
  (p?.children ?? []).forEach((c, i) => {
    // a rogue projectile does different things on a stealth strike than on a normal throw, and the
    // miner says which: a brick that only shatters on the strike must not shatter on every throw
    if (c.stealth !== undefined && c.stealth !== (variant === 'stealth')) return;
    out.push(makePhase(c.where === 'hit' ? 'impact' : 'split', {
      id: `${parentId ?? 'proj'}:child:${i}`,
      parent: parentId,
      trigger: WHERE_TRIGGER[c.where] ?? 'timer',
      projId: c.type,
      count: c.count ?? 1,
      // told apart deliberately: a share the miner read, a flat number it read, and nothing read
      dmgMul: c.dmgMul ?? null,
      dmgAbs: c.dmgAbs ?? null,
      chance: c.chance ?? null,
      threshold: c.threshold ?? null,
      requires: c.requires ?? null,
      branch: c.branch ?? null,
      crit: c.crit ?? null,
      evidence: {
        from: 'projectile children', index: i, where: c.where ?? null,
        gates: {
          // a clock nobody read, unless a counter in the AI with a reset is that clock
          ...((WHERE_TRIGGER[c.where] ?? 'timer') === 'timer' ? { cadence: c.threshold?.event === 'tick' && c.threshold.reset && c.threshold.reached ? 'exact' : 'assumed' } : {}),
          ...(c.threshold ? { threshold: 'exact' } : {}),
          ...(c.requires ? { requires: 'exact' } : {}),
          ...(c.branch ? { branch: 'assumed' } : {}),
        },
      },
      confidence: c.dmgMul !== undefined || c.dmgAbs !== undefined ? 'exact' : 'assumed',
    }));
  });
  return out;
}
