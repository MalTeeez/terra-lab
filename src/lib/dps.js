/**
 * Real DPS: damage per second against the boss fought next, from everything the miner knows about
 * how a weapon works — its archetype, the motion of what it fires, and the target it is aimed at.
 *
 *   value = hits/s × damage per hit × crit × sustain × risk  +  debuff DPS
 *
 *   hits/s     projectiles per use × how many land × how often each one connects, at the class's
 *              engagement distance; contact weapons (yoyo, held beam, placed cloud) count contact
 *              time instead of use time
 *   damage     the hit minus half the boss's defense, plus half the armor penetration, with the
 *              pierce falloff averaged over the hits it lands
 *   crit       1 + crit% (summons cannot crit)
 *   sustain    magic: mana per second the player can keep up against regen and potions
 *   risk       weapons that only work next to the boss, for a class that does not stand there
 *   debuffs    the DoT of every debuff the boss is not immune to, plus what defense debuffs
 *              give back to every hit
 *
 * Landing is one story: the boss subtends an angle at the engagement distance, the shot takes time
 * to cross that distance while the boss moves, gravity pulls it below the silhouette, and homing
 * undoes as much of that as its turn rate can pay for. Nothing here branches on a use style — the
 * miner's `arch` tag is the only shape the model knows.
 *
 * Calamity rogue weapons get two numbers that *add up*: *spam* (normal attacks, close) and
 * *stealth* (one stealth strike per recharge, from further away). Stealth builds back on its own,
 * so the strike lands on top of the throwing rather than instead of it; the bigger of the two
 * names the weapon's grade.
 *
 * Every factor is reported in `parts` ({ label, mul | value }) so the item card shows the
 * arithmetic. Scoring stays pessimistic: what the miner could not read gets the worse assumption.
 */
import { contactPhase, debuffPhases, deliveryPhases, primaryPhase, returnPhase, spawnPhases, summonPhase, swingPhase, textGates } from './phases.js';
import { effectiveStats } from './stats.js';

// ---- calibration knobs ------------------------------------------------------------------------

/**
 * How far from the boss a class would *rather* fight, in pixels — a safety preference, and nothing
 * about any weapon. What actually sets the distance is the smaller of this and what the weapon can
 * carry (`REACH`, then the projectile's own reach), and the gap between the two is what `risk`
 * prices.
 *
 * Melee's number used to be 80. That is not how far a melee player wants to stand, it is how far a
 * broadsword reaches — and baking a weapon's reach into the class meant *every* melee weapon engaged
 * at the same 80 px (136 of the 178 melee guide picks, exactly), so neither reach nor risk could
 * tell a yoyo on a 300 px string from a pair of short daggers you have to stand inside the boss to
 * use. Melee sits lower than the rest because it is the class built to be hit, not because it enjoys
 * it.
 */
export const ENGAGE = { melee: 260, rogue: 300, thrower: 300, ranged: 380, magic: 340, summon: 420, bard: 340, healer: 340, classless: 340, other: 340 };
/** Optional playstyle per class (Options in the UI, `ctx.playstyle`): only the distance changes. */
export const PLAYSTYLE = {
  rogue: { spam: 220, stealth: 420 },
  thrower: { spam: 220, stealth: 420 },
  ranged: { sniper: 520, rapid: 280 },
  magic: { nuke: 450, spray: 250 },
};
/** Closer than this nobody stands, whatever the weapon: you are inside the boss. */
export const MIN_ENGAGE = 60;
/** How far an archetype can engage at all: a swing cannot reach across the screen. */
export const REACH = { swing: 100, shortsword: 60, specialsword: 110, spear: 140, held: 180, truemelee: 80, flamethrower: 200, flail: 260, yoyo: 300, placed: 80, spikyball: 80, whip: 220 };
/**
 * The class damage bonus a player actually has at a progression value — armour set, six reforged
 * accessories, a potion — as a multiplier on the weapon's printed damage. It matters because boss
 * defense is subtracted flat: taking it off the printed number instead of the real one is a tax
 * that falls hardest on weapons that hit often for a little.
 */
export const playerDamage = (progression) => 1.15 + 0.05 * Math.max(0, progression ?? 7);
/** Boss movement in px/tick at a progression value: a King Slime hops, a Devourer flies. */
export const bossSpeed = (progression) => 5 + 9 * Math.min(1, Math.max(0, (progression ?? 7) / 28));
/** A boss with no mined stats: a 100 px target with a little armour. */
export const BOSS_DEFAULT = { w: 100, h: 100, defense: 8, parts: 1, worm: false, immuneAll: true };
/** Defense over this is a phase gimmick (an invulnerable clam), not something a weapon plays around. */
export const DEFENSE_CAP = 60;
/**
 * Ticks between two hits on the same NPC when the projectile sets no immunity of its own — the
 * player's own invincibility window, which is what governs a beam held on a boss.
 */
export const IMMUNITY = 10;
/**
 * What each weapon type *is*, as the model sees it — the one place a kind of weapon is described,
 * and the basis every other factor hangs off. Two weapons with the same damage and use time are
 * not the same weapon if one of them has to come back before you can throw it again.
 *
 *   cycle    the clock its hits come off:
 *              'use'      the use animation — you attack again the moment the item lets you
 *              'flight'   only one is out at a time: the next throw waits for this one to return,
 *                         so the round trip is the rate and the use time is only a floor
 *              'contact'  the projectile's own hit cooldown, while the player keeps it on the boss
 *              'slot'     a summon: its own clock, paid for in minion slots
 *   uptime   the share of the fight it is actually on the boss
 *   passes   how many times one cycle crosses the target (out and back)
 */
export const ARCHETYPE = {
  // melee
  swing: { cycle: 'use' },                                  // broadswords
  shortsword: { cycle: 'use' },
  specialsword: { cycle: 'use' },                           // Arkhalis, Terragrim, the flying blades
  spear: { cycle: 'use', passes: 2 },
  yoyo: { cycle: 'contact', uptime: 0.7 },
  flail: { cycle: 'contact', uptime: 0.7 },
  boomerang: { cycle: 'flight', passes: 2 },
  // ranged — the ammo names it; what changes is only what the ammo does
  bow: { cycle: 'use' },
  repeater: { cycle: 'use' },
  gun: { cycle: 'use' },
  launcher: { cycle: 'use' },
  flamethrower: { cycle: 'use' },                           // a short cone: `REACH` is what limits it
  // magic and everything else that simply fires
  shot: { cycle: 'use' },
  held: { cycle: 'contact', uptime: 0.85 },
  truemelee: { cycle: 'contact', uptime: 0.85 },     // the same delivery, at arm's length: see `REACH`
  placed: { cycle: 'contact', uptime: 0.3 },
  // summon
  minion: { cycle: 'slot', uptime: 0.9 },
  sentry: { cycle: 'slot', uptime: 0.55 },
  // A whip's own lash is small change; what it is for is the mark it leaves, which every minion hit
  // then carries. `tag` is that mark in *hits per second of the whip's own damage*, and it is the
  // same however hard the lash itself hits, because it is the minions doing the hitting: a summoner
  // lands roughly 4–6 minion hits a second pre-hardmode, and a whip's tag is worth about 30 % of its
  // own damage on each of them (Leather Whip +4 on 14, Kaleidoscope +26 on 60), so ≈ 1.5.
  whip: { cycle: 'use', tag: 1.5 },
  // rogue
  dagger: { cycle: 'use' },
  bomb: { cycle: 'use' },
  javelin: { cycle: 'use' },                                // it stays in the target and keeps ticking
  spikyball: { cycle: 'contact', uptime: 0.25 },            // it waits on the ground to be walked into
};
/**
 * How many times one projectile re-connects with the same body before the fight has moved on. A
 * seeker steers back onto it; anything else has to drift back into it. Repeat hits saturate on
 * these rather than counting one per immunity window for the whole of a projectile's life.
 */
export const RECONNECT_SEEK = 12;
export const RECONNECT_PLAIN = 2;
/** How long a weapon that must come back before the next throw is unavailable, at worst. */
export const FLIGHT_CAP = 180;
/** How far a thrown-and-returning weapon sails before it turns round, when it is not stopped sooner. */
export const THROW_OUT = 300;
/**
 * The distance past which a weapon simply cannot hit, from the way it flies rather than from how
 * long its projectile lives. A boomerang turns round at `THROW_OUT` — the model already charges it
 * a round trip to there for its firing rate, and then let it land hits four times further out,
 * because reach was read off lifetime and gravity alone. Those two answers have to be the same
 * number: "too slow for the short range it has" is one weapon, not two.
 */
const turnsRoundAt = (arch) => (ARCHETYPE[arch]?.cycle === 'flight' ? THROW_OUT : Infinity);
/**
 * What a weapon is worth when it forces the player all the way in, against what it is worth at the
 * distance the class would rather keep: the guides' `†` mark, which is exactly "you must stand next
 * to the boss". It is a share of the fight spent dodging instead of attacking, so *every* class pays
 * it — melee included. Melee at 1 meant the one factor that separates a contact weapon from a reach
 * weapon was switched off for the whole class, and the guides put `†` on melee weapons more than on
 * anyone else's (19 of the 30 risky picks). Melee pays less than the rest because it is the class
 * wearing the armour.
 */
export const RISK = { melee: 0.8, ranged: 0.7, magic: 0.7, summon: 0.7, rogue: 0.75, thrower: 0.75, bard: 0.7, healer: 0.7 };
/**
 * What a weapon is worth once it starts eating the terrain. Rockets and satchel charges blow the
 * arena, the platforms and the loot chests apart, so the DPS on paper is not DPS you get to use —
 * you get one fight and a repair job. Tune here.
 */
export const TERRAIN_PENALTY = 0.4;
/**
 * Calamity's own stealth numbers, from its `BalancingConstants` (`dataset.balance.CalamityMod`).
 * These are the fallbacks for a dataset that does not carry them.
 */
export const STEALTH = { factor: 0.42, genTime: 4, movingRatio: 0.5 };
const stealthConsts = (ds) => {
  const b = ds?.balance?.CalamityMod ?? {};
  return {
    factor: b.UniversalStealthStrikeDamageFactor ?? STEALTH.factor,
    genTime: b.BaseStealthGenTime ?? STEALTH.genTime,
    movingRatio: b.MovingStealthGenRatio ?? STEALTH.movingRatio,
  };
};
/**
 * Seconds between stealth strikes: the bar fills in `BaseStealthGenTime` standing still and
 * `genTime / movingRatio` moving, and a fight is spent moving — Calamity's own 80/20 split. With the
 * mined 4 s and ½ rate that is 7.2 s, not the 5 that used to be written here.
 */
export const stealthRecharge = (ds) => { const c = stealthConsts(ds); return 0.8 * (c.genTime / c.movingRatio) + 0.2 * c.genTime; };
export const STEALTH_RECHARGE = 7.2;
/** 50 stealth: an early rogue set. */
export const STEALTH_MAX_DEFAULT = 0.5;
/** Mana the player gets back per second: the natural curve plus potions on cooldown. */
export const manaRegen = (progression) => 1.5 + 0.35 * Math.max(0, progression ?? 7) + 8;
/** However short of mana a weapon runs, the player still fires it sometimes. */
export const SUSTAIN_FLOOR = 0.35;
/**
 * What a debuff the miner could not price is worth, in DPS, at a progression value. 577 of the
 * debuffs weapons apply have no record at all (a mod's own slow, mark or curse) — they are still
 * something done to the target, so a flat allowance stands in, growing with the stage and kept
 * under the median DoT the miner *could* read at that stage (10 pre-Hardmode, 15–20 through the
 * mechs, 100 past Moon Lord). A phase carrying it says it is a guess.
 */
export const unknownDebuffDps = (progression) => 4 + 1.2 * Math.max(0, progression ?? 7);
/**
 * SOTS's void bar, as a mana-like pool: what comes back per second at a progression value. The
 * bare meter refills `5 + gain` every 900 regen-ticks (`VoidPlayer.UpdateVoidRegen`), a third of a
 * point a second, and the class lives off void gain from gear, souls and hits on top of that —
 * none of which the miner reads. A calibration knob, set so that a mid-cost weapon (costs run
 * 3–60, mostly 4–20) at an ordinary use rate sits between the floor and full sustain: the
 * *differences* in cost are what the extraction is for, and a regen that floors the whole class
 * would throw them away.
 */
export const voidRegen = (progression) => 5 + 1.5 * Math.max(0, progression ?? 7);
/** Turn inertia of a homing projectile that does not say (`velocity = (velocity·(N−1) + …)/N`). */
export const HOMING_INERTIA = 20;
/**
 * Ceiling on what the children of one projectile are worth, in hits of the parent's damage. The
 * miner reads what a child does and how hard it hits, but not how often it may spawn — an on-hit
 * splitter usually has a cooldown, a charged shot only pays its multiplier when charged. Without
 * that, an unbounded sum lets a weapon with a big `dmgMul` child outrank everything.
 * ponytail: a flat ceiling; read the spawn cooldown (`ai[]` counters, `localAI`) to lift it.
 */
export const CHILD_CAP = 1.5;
/**
 * Shot speed for a weapon that fires something but whose `shootSpeed` the miner could not read
 * (the projectile sets its own velocity in AI). Without a number the landing model used to be
 * skipped whole — no travel lead, no gravity, no range check, and `land = 1`, which also handed
 * the projectile its full pierce count. That is the most optimistic answer available, so a slow
 * throw is assumed instead.
 */
export const SHOOT_SPEED_UNKNOWN = 6;
/**
 * Below this, a mined `shootSpeed` is not a speed. It is the *launch* speed, and a projectile
 * launched at 0.1 or 1 px/tick is one whose AI takes over the moment it exists: a Demon Scythe that
 * accelerates (0.2), a summoned knife that homes to the target (1), a scythe that swings on its own
 * ai (0.1). 96 weapons in the pool launch under 4 px/tick and nearly all of them read exactly 0.1 or
 * 1, against a real cluster that starts at 4 — so under the floor the number is treated as unread
 * and flown at the pessimistic default. Read as a cruising speed it gave those weapons 90 to 600
 * ticks of lead and a reach that ends inside the player, which is what put seven guide picks at 0/s.
 */
export const SHOOT_SPEED_MIN = 4;
/**
 * Past this, a mined damage multiplier on something a weapon spawns is not a multiplier every shot
 * gets. Wyvern's Call really does carry a ×15 — on the one branch in ten that fires a wyvern instead
 * of a feather — and the linear machine, which cannot tell which branch runs, hands that ×15 to the
 * feather. Calamity pays a projectile fifteen times the weapon's damage precisely *because* it is
 * rare, so a multiplier this size is evidence of a branch rather than of damage. 60 calls in the
 * pool are above it and they break away from a run of ×2 to ×4 that are real; above the ceiling the
 * number is treated as unread and the projectile does the weapon's damage.
 */
export const DMG_MUL_MAX = 4;
/** A spawned projectile's share of the weapon's damage, with an unreadable multiplier dropped. */
const dmgShare = (m) => (m > DMG_MUL_MAX ? 1 : m);
/**
 * What a child is worth when the miner could not follow its damage argument at all. It used to be
 * paid the parent's full damage, which is the most optimistic answer available — and the miner made
 * that unavoidable by writing a share of exactly 1 as "no share", so "spawned at the parent's
 * damage" and "could not read it" were the same field. Told apart, 472 children really are ×1 and
 * only 94 are unread; those get the median of every share the miner *could* read (0.5), which is a
 * number from the pool rather than a guess.
 */
export const CHILD_DMG_UNREAD = 0.5;
/**
 * What a shot used at the very edge of its range is worth. A weapon that only just carries to where
 * its class stands arrives with no life left and cannot be aimed with, which is what the band above
 * this floor prices. Dropping the band entirely costs 8 top-8 against the guides, so it earns its
 * keep — but *where* the floor sits does not: 0.1, 0.3 and 0.5 all measure identically, and 0.5 is
 * the one that does not also claim a weapon at its own maximum range lands one shot in ten
 * (`hitsPerProjectile` is already bounding its extra hits by the life left on arrival).
 */
export const RANGE_EDGE = 0.5;
/** The speed the model flies a shot at, with an unreadably slow launch treated as unread. */
const flightSpeed = (v) => (v >= SHOOT_SPEED_MIN ? v : SHOOT_SPEED_UNKNOWN);
/** How long a projectile stuck in the boss keeps counting before the fight has moved on. */
export const STUCK_TICKS = 180;

/**
 * Printed damage past anything the game balances around is a placeholder, not a weapon's damage:
 * SOTS's Tesseract prints 1,000,000 for a clone that attacks with *your* items, and a debug
 * pickaxe prints 400,000. The real endgame tops out at 23,000 (kevin, Sword of the Zenith), so
 * three items in the pool are above this and none of them is a number worth ranking on.
 */
export const PLACEHOLDER_DAMAGE = 50000;

const CHILD_WHERE = { hit: 'on hit', kill: 'on death', ai: 'while flying' };
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const deg = (rad) => `${Math.round((rad * 180) / Math.PI)}°`;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Resolve a projectile id against the dataset (or a bare object for tests). */
function proj(ds, id) {
  if (!id || !ds?.projectiles) return null;
  return ds.projectiles[id] ?? null;
}

/**
 * The same projectile as a stealth strike throws it. Calamity's rogue projectiles re-set their own
 * pierce on the first AI tick — `penetrate = stealthStrike ? 4 : 2` — so the strike's copy is a
 * different projectile in all but id, and grading it off the SetDefaults number undercounts it.
 */
const asStrike = (p, variant) => (variant === 'stealth' && p?.stealthPen !== undefined ? { ...p, pen: p.stealthPen } : p);

/** Ammo of a kind obtainable at the stage. */
export const ammoAt = (ds, kind, stage) => (ds?.ammoByKind?.get(kind) ?? [])
  .filter((a) => stage === undefined || stage === null || a.stage === null || a.stage === undefined || a.stage <= stage);

/**
 * The ammo a gun is graded with. Taking the *best* obtainable made every gun score as if the
 * ammo box were already full of Crystal Bullets, and buried the ammo's own contribution inside
 * the weapon — a ranged loadout is two picks, not one. Grade the weapon on the plain ammo of its
 * kind and grade the ammo separately against the same gun.
 *
 * An `AmmoID` constant is the item id of the ammo it is named for — Bullet is 97, the Musket Ball;
 * Arrow is 40, the Wooden Arrow — so the standard ammo of a kind needs no table. Where that item is
 * not obtainable yet (or a mod defines a kind of its own), fall back to the earliest, weakest one.
 */
export function standardAmmo(ds, kind, stage) {
  const list = ammoAt(ds, kind, stage);
  const named = list.find((a) => a.id === `v:${kind}`);
  if (named) return named;
  let plain = null;
  for (const a of list) {
    if (!plain || (a.stage ?? 0) < (plain.stage ?? 0) || ((a.stage ?? 0) === (plain.stage ?? 0) && (a.damage ?? 0) < (plain.damage ?? 0))) plain = a;
  }
  return plain;
}

// ---- the target -------------------------------------------------------------------------------

const WORM_RE = /Head$|Body$|Tail$|Segment/i;

/** Every stage whose NPCs can be scored against, for the target picker. */
export const targetStages = (ds) => (ds?.stages ?? []).filter((s) => s.npcs?.length);

/** The armour a fight actually presents: the softest part, ignoring invulnerable phases. */
export function fightableDefense(stats) {
  const real = stats.map((s) => s.defense).filter((d) => d >= 0 && d <= DEFENSE_CAP);
  return real.length ? Math.min(...real) : BOSS_DEFAULT.defense;
}

/**
 * The boss of one stage as a target: its size, defense, how many parts it has and what it shrugs
 * off. A mod boss whose immunity table the miner could not walk counts as immune to everything,
 * which is both the pessimistic answer and — for Calamity — the usual one.
 */
export function bossOf(ds, stageIndex) {
  const stage = ds?.stages?.[stageIndex];
  const ids = stage?.npcs ?? [];
  if (!ids.length) return { ...BOSS_DEFAULT, name: null, stage: stage ? stageIndex : null, progression: stage?.progression };
  const stats = ids.map((id) => ds?.npcs?.[id]).filter(Boolean);
  const head = stats[0] ?? {};
  const names = ids.map((id) => ds?.npcs?.[id]?.name ?? id);
  // a worm is either named like one (mod bosses name their Head / Body / Tail) or is the vanilla
  // shape: three or more NPCs of the stage sharing one name, which is every vanilla worm
  const worm = ids.length >= 3 && (names.some((n) => WORM_RE.test(n)) || new Set(names).size < names.length);
  const immune = new Set();
  for (const s of stats) for (const b of s.immune ?? []) immune.add(b);
  const w = head.w ?? BOSS_DEFAULT.w;
  return {
    name: head.name ?? names[0],
    stage: stageIndex,
    progression: stage.progression,
    w,
    // what the player aims at: a worm is a body draped across the screen, not one 38 px segment,
    // which is what makes a spread of shots land on it — the guides' `C` mark says the same thing
    aimW: worm ? w * Math.min(ids.length, 8) : w,
    h: head.h ?? BOSS_DEFAULT.h,
    // A defense above anything real is a phase, not a stat — the Giant Clam sits at 9999 with its
    // shell shut and you simply do not attack it then. Clamping such a number to the cap would
    // still score every weapon against armour no fight ever presents, so it is dropped and the
    // boss falls back to the default; only the parts you can actually hurt set the number.
    defense: fightableDefense(stats),
    parts: Math.max(1, ids.length),
    worm,
    immune,
    // an immunity table the miner could not walk is not an immunity: 102 of the 135 stage targets
    // were "unknown", and reading that as "immune to everything" switched every debuff off against
    // nearly every mod boss. Unread means unread; only a table that was read and says so counts.
    immuneAll: stats.length ? stats.every((s) => s.immuneAll) : true,
  };
}

/**
 * The target a stage is scored against: the boss `target` names, or the one fought next when the
 * user has not picked one (the default, "assume next boss").
 */
export function boss(ds, stage, target = null) {
  return bossOf(ds, target ?? (stage ?? -1) + 1);
}

/** Is this boss immune to the debuff? */
const immuneTo = (b, buff) => b.immuneAll || b.immune?.has(buff);

// ---- landing ----------------------------------------------------------------------------------

/**
 * A projectile moves once per *update*, and `extraUpdates` buys it several updates a game tick.
 * `life` (`timeLeft`) and a local hit cooldown are both counted in updates, so the two clocks have
 * to be kept apart: `stepOf` is how far it gets per update, `speedOf` how far per tick.
 */
const stepOf = (velocity) => Math.max(0.01, velocity ?? 0);
/** Effective speed of a projectile in px/tick (extra updates move it several times a tick). */
const speedOf = (p, velocity) => stepOf(velocity) * (1 + (p?.updates ?? 0));
/** Life of a projectile whose `timeLeft` the miner could not read, in updates. */
export const LIFE_UNKNOWN = 600;
/** How far an arcing shot may fall below the line it was aimed along and still be on the target. */
export const DROP_TOLERANCE = 55;
/** What each extra pierce keeps of the last one's chance, for a shot that cannot steer. */
export const PIERCE_KEEP = 0.45;
/** …and what it keeps when the bodies are queued up in front of it. */
/** In a crowd, the share of the bodies in the flight path one piercing projectile actually sweeps. */
export const CROWD_SWEEP = 0.6;
/** …and what a projectile that reaches only one of them is worth against the crowd it ignores. */
export const CROWD_WASTE = 0.6;
/** Per-tick pull on a projectile the miner saw arcing without reading the constant. */
export const GRAVITY_K = 0.1;

/**
 * How far a projectile gets before it expires, with its per-update drag integrated
 * (`v·(1−d^L)/(1−d)`; without drag it is just `v·L`). Extra updates do not extend this: each one
 * moves the projectile a step *and* spends a tick of its life, so the distance is the same and it
 * simply arrives sooner.
 * @param {object|null} p
 * @param {number} step  px per update, not per tick
 */
export function reachOf(p, step, drop = DROP_TOLERANCE) {
  const life = p?.life ?? LIFE_UNKNOWN;
  const d = p?.drag;
  const byLife = d > 0 && d < 1 ? (step * (1 - d ** life)) / (1 - d) : step * life;
  // A shot that arcs is not out of range when it expires — it is out of range when it has fallen
  // too far below where it was aimed to still be on the target. Falling `drop` px takes
  // `sqrt(2·drop/g)` ticks, and it covers `step` px in each of them. A thrown knife lives long
  // enough to cross the world; what it cannot do is stay level for more than a couple of screens.
  // …unless it steers. A seeker climbs back onto the target instead of sailing under it, so the arc
  // stops being what limits how far it is useful — the same reason its pierce keeps its value.
  const g = p?.gravity && !p?.homing ? p.gravityK ?? GRAVITY_K : 0;
  if (!(g > 0)) return byLife;
  return Math.min(byLife, step * Math.sqrt((2 * Math.max(1, drop)) / g));
}

/**
 * How a projectile arrives at a target `D` px away: the ticks it spends flying, the ticks of life
 * it has left once it gets there, and how fast it is still going. Distance covered in `t` ticks is
 * `v(1−d^t)/(1−d)` under per-tick drag, so the flight time is that inverted.
 *
 * `alive` is the limiter the whole hit model hangs off: a projectile that expires on arrival gets
 * one hit at most, however far it pierces.
 * @returns {{ flight: number, alive: number, speed: number }}
 */
export function flightOf(p, v, D) {
  const life = p?.life ?? LIFE_UNKNOWN;
  const d = p?.drag;
  let flight;
  if (!(D > 0)) flight = 0;
  else if (!(d > 0 && d < 1)) flight = D / v;
  else {
    const limit = v / (1 - d); // it never gets further than this, however long it lives
    flight = D >= limit ? Infinity : Math.log(1 - (D * (1 - d)) / v) / Math.log(d);
  }
  // `life` is in updates and `flight` in ticks, so the life has to be brought to ticks before the
  // two can be subtracted: extra updates burn the projectile's life faster than the clock runs.
  const alive = Math.max(0, life / (1 + (p?.updates ?? 0)) - flight);
  return { flight, alive, speed: d > 0 && d < 1 && Number.isFinite(flight) ? Math.max(0.01, v * d ** flight) : v };
}

/**
 * The share of one projectile of a shot that connects with the boss.
 * @param {object|null} p   the projectile record
 * @param {object} o        { D, boss, spread, fan, count, velocity, vb }
 * @returns {{ f: number, parts: Array }}
 */
export function landing(p, { D, boss: b, spread: spreadIn = 0, fan = false, count = 1, velocity = null, vb = 5, arch = null, reach: reachIn = null }) {
  const parts = [];
  // a scatter wider than a full circle is a full circle: rolls stacked on an angle add up past it
  const spread = Math.min(spreadIn, Math.PI);
  let f = 1;
  const aimW = b.aimW ?? b.w;
  const theta = Math.atan(aimW / 2 / Math.max(1, D));

  // aim: a random spread only lands the share of its cone inside the silhouette; a fan puts its
  // shots at fixed angles, so a wide boss catches several of them and a narrow one catches one
  // a fixed angle off the cursor on a single shot is aimed with, not scattered: the player turns
  // the cursor by that much. Only a roll (`fan` false) or a fan wider than the target loses shots.
  if (spread > 0 && spread > theta && !(fan && count === 1)) {
    let s;
    if (fan && count > 1) {
      const step = (2 * spread) / (count - 1);
      const inside = Math.max(1, Math.floor(theta / step) * 2 + 1);
      s = Math.min(1, inside / count);
      parts.push({ label: `${count}-shot fan ±${deg(spread)} vs ${deg(theta)} target (${Math.min(count, inside)} land)`, mul: r2(s) });
    } else {
      s = theta / spread;
      parts.push({ label: `spread ±${deg(spread)} vs ${deg(theta)} target`, mul: r2(s) });
    }
    f *= s;
  }

  const step = stepOf(velocity);
  const v = speedOf(p, velocity);
  const flight = velocity !== null && velocity > 0 ? D / v : 0;
  const homing = p?.homing;
  let homed = 0; // how much of the boss's movement the projectile can chase down, 0..1
  let seekLabel = null;
  if (homing && flight > 0) {
    const hs = homing.speed ?? velocity ?? v;
    const inertia = homing.inertia ?? HOMING_INERTIA;
    // A seeker only seeks what it can see, so the correcting happens over the last `range` px of
    // the flight rather than all of it — a 300 px search radius on a 420 px throw still gets most
    // of the way there, which the old all-or-nothing gate scored as no homing at all. A shot
    // slower than the boss never catches it, however hard it turns.
    // It has to see the target to steer at it, and a shot slower than the boss never catches it.
    // Letting a seeker correct only over the last `range` px of a longer flight was tried and cost
    // 4 top-8 against the guides for nothing: 361 of the 408 seekers here carry the pessimistic
    // 300 px default rather than a radius the miner read, so partial credit is credit for a guess.
    if (hs > vb && homing.range >= D * 0.6) {
      const seek = flight;
      const correctable = 0.5 * (hs / inertia) * seek * seek;
      const drift = vb * flight;
      homed = clamp(correctable / Math.max(1, drift), 0, 1) * (1 - (homing.delay ?? 0) / Math.max(1, p.life ?? LIFE_UNKNOWN));
      seekLabel = `homing (${Math.round(homing.range)} px, turn ${r1(hs / inertia)}/tick)`;
    }
  }

  // travel and gravity, each priced twice: what the shot would lose flying dumb, and what homing
  // buys back. Reporting them apart is what makes the homing line a real multiplier rather than a
  // number beside a factor that was quietly folded into the two above it.
  // the drift is measured against one segment, not the whole chain a worm drapes across the screen:
  // `aimW` is what you aim at, `b.w` is what the shot has to still be in front of when it arrives
  const travelAt = (h) => (flight > 0 ? b.w / (b.w + vb * flight * 0.5 * (1 - h)) : 1);
  const dropPx = p?.gravity && flight > 0 ? 0.5 * (p.gravityK ?? 0.1) * flight * flight : 0;
  const gravityAt = (h) => (dropPx > 0 ? clamp(b.h / (b.h + dropPx * (1 - h)), 0.2, 1) : 1);

  const dumbTravel = travelAt(0);
  if (dumbTravel < 0.995) { f *= dumbTravel; parts.push({ label: `${r1(v)} px/tick over ${Math.round(D)} px (${Math.round(flight)} ticks of lead)`, mul: r2(dumbTravel) }); }
  const dumbGravity = gravityAt(0);
  if (dumbGravity < 0.995) { f *= dumbGravity; parts.push({ label: `arc drops ${Math.round(dropPx)} px over ${Math.round(D)} px`, mul: r2(dumbGravity) }); }

  if (homed > 0.02) {
    const back = (travelAt(homed) * gravityAt(homed)) / Math.max(1e-6, dumbTravel * dumbGravity);
    if (back > 1.005) { f *= back; parts.push({ label: seekLabel, mul: r2(back) }); }
  }

  // range: a projectile that dies before it arrives never lands, and one that only just makes it
  // spends its last ticks too slow to be aimed. `realDps` already walks the player in to the edge
  // of the weapon's reach, so this is what standing at that edge costs — not a zero.
  let carry = 1;
  if (velocity !== null && velocity > 0) {
    // The band prices a projectile spending its last ticks too slow to be aimed, and a boomerang
    // reaches that state the same way a dying one does: vanilla's boomerang AI decelerates to a
    // stop at the turn-around before it reverses, so a throw whose limit is 300 px is already
    // crawling at 220. Feeding the turn-around through the same band is what stops the model
    // charging a weapon a round trip to 300 px and then letting it land hits at 1470.
    // a blade states its reach outright; anything thrown has it read off its flight
    const reach = reachIn ?? Math.min(turnsRoundAt(arch), reachOf(p, step, b.h / 2));
    if (reach < D) carry = 0;
    else if (reach < 2 * D) carry = clamp((reach - D) / D, RANGE_EDGE, 1);
    if (carry < 1) { f *= carry; parts.push({ label: `reaches ${Math.round(reach)} px of ${Math.round(D)}`, mul: r2(carry) }); }
  }

  if (p?.walls) { f *= 1.05; parts.push({ label: 'goes through walls', mul: 1.05 }); }
  // `aim` is the same answer without the range term: a projectile that has already arrived at the
  // first body is standing in the crowd, so what it costs to carry that far is paid once, on the
  // first hit, and must not be charged again against every body it pierces into.
  // everything this function prices is "does the shot get there", so the whole list is one factor
  return { f, parts: parts.map((x) => ({ fac: 'landing', ...x })), aim: carry > 0 ? f / carry : 0 };
}

/**
 * The blade has to land like anything else does. It was the one phase credited with a full hit
 * every animation — no lead on a moving boss, no reach — so on a sword that also fires, the blade
 * took a third to a half of the score. It goes through the same landing model as every projectile:
 * a hitbox that comes out to the blade's reach in half a swing, so it pays the boss's drift while
 * the arc comes round and the same band a shot pays for only just reaching. What the split between
 * blade and shot then is, is whatever those two terms say.
 */
export const bladeLanding = ({ D, boss: b, vb, reach, ticks }) => landing(null, { D, boss: b, velocity: (2 * reach) / Math.max(1, ticks), vb, reach });

/** Parts of the boss one projectile can reach on a single pass. */
/**
 * Hitboxes a projectile can reach on one pass, which is what pierce is worth.
 *
 *   'single'  one body, however many parts it really has: what a boss fight mostly is
 *   'multi'   a worm's segments, an event's wave, the adds a boss keeps around
 *   'auto'    what the fight itself presents — the default, and the honest answer per boss
 *
 * The mode rides on the target object so nothing between here and `realDps` has to carry it.
 */
export const segmentsOf = (b) => {
  if (b.targets === 'single') return 1;
  const natural = b.worm ? Math.min(b.parts, 8) : b.parts > 1 ? 2 : 1;
  return b.targets === 'multi' ? Math.max(CROWD, natural) : natural;
};
/** Bodies in front of you when you ask for the multi-target answer: a Destroyer, a Pillar's wave. */
export const CROWD = 6;

/**
 * The same fight as one of the two questions asks it. Single target strips the extra bodies (a
 * worm becomes the one segment you are aiming at); multi-target puts a crowd in the projectile's
 * path and widens what there is to aim at, which is the whole difference between a shot that
 * pierces once and one that pierces forever.
 */
export function asTarget(b, mode = 'auto') {
  if (mode === 'single') return { ...b, targets: 'single', aimW: b.w, worm: false, parts: 1 };
  if (mode === 'multi') {
    const n = Math.max(CROWD, b.worm ? Math.min(b.parts, 8) : 1);
    return { ...b, targets: 'multi', parts: Math.max(b.parts, n), aimW: b.w * Math.min(n, 8) };
  }
  return { ...b, targets: 'auto' };
}

/**
 * How many times one landed projectile hits the boss.
 *
 * Pierce on its own buys nothing: a projectile only hits again once its immunity frames have run
 * out *and* it is still both alive and inside the target. So the count is
 * `1 + time on target / immunity`, where the time on target is the smaller of how long it takes to
 * cross the silhouette at the speed it still has and how much life it has left when it arrives.
 * That is what separates a lingering, slow, high-pierce projectile from a fast one that clips the
 * boss once and expires — and it is why range matters twice: a long flight eats the life the
 * projectile needed for its extra hits.
 *
 * The extra hits are also conditioned on `land` a second time: the first hit is what the aim
 * already paid for, every one after it needs the boss to still be in the projectile's path, which
 * a homing projectile manages and a dumb one fired across a room mostly does not.
 * @returns {{ hits: number, label: string|null }}
 */
export function hitsPerProjectile(p, { boss: b, velocity, arch, D = 0, land = 1, aim = land, interval = null }) {
  // a negative hit cooldown means "once per NPC, ever" — it is not a rate. Without any local
  // immunity the projectile falls back to the player's own 10-tick window on that NPC.
  const local = localOf(p);
  const pen = p?.pen ?? 1;
  // `localNPCHitCooldown = -1` is not a rate: the projectile may hit a given NPC once and never
  // again, whatever its pierce says. An explosion, a splinter, a bomb's blast — one hit each.
  if (p?.local < 0) return { hits: 1, label: null };
  // A local cooldown is counted in updates like `life` is; the player's own window and the time it
  // takes to cross the boss are in ticks. Extra updates run that cooldown down faster in real time.
  const imm = local !== null ? local / (1 + (p?.updates ?? 0)) : IMMUNITY;
  // It embeds in the first thing it touches, so its pierce buys nothing: it is not going through
  // to anything else, and it is not crossing the silhouette either. What it does after that is
  // whatever its own hit cooldown says — a javelin keeps wounding what it is stuck in, a bola
  // just hangs there.
  // It changes course the moment it connects, so whatever its pierce says it is not carving a path
  // through the target: it hits once and goes somewhere else. Thorium's baseball reads as infinite
  // pierce and actually bounces back to your hand, which is the opposite of piercing.
  if (p?.bounces && !CONTACT.has(arch)) return { hits: 1, label: 'bounces off what it hits' };
  if (p?.sticks) {
    if (!local) return { hits: 1, label: 'sticks in the first thing it hits' };
    const stuck = Math.min(p.life ?? 300, STUCK_TICKS);
    // A tick the tooltip states is a clock the miner could not follow — a `timer % 60` in the AI
    // behind a one-tick immunity — and it can only be slower than the immunity, never faster.
    const tick = Math.max(imm, interval ?? 0);
    const hits = Math.min(pen === -1 ? Infinity : Math.max(1, pen), 1 + stuck / tick);
    return { hits, ticks: hits - 1, stuck, tick, label: `sticks in the target: ${r1(hits)} hits over ${Math.round(stuck)} ticks${tick > imm ? ` (one every ${Math.round(tick)})` : ''}` };
  }
  // a contact weapon's hits come from its contact rate, not from a pass through the target, and a
  // whip lashes once through the arc rather than piercing along it
  if (CONTACT.has(arch) || arch === 'whip') return { hits: 1, label: null };
  const passes = ARCHETYPE[arch]?.passes;
  // out and back. A boomerang's two passes are a whole flight apart, so no immunity window can
  // merge them; a spear's thrust returns at once and needs its own cooldown to count twice.
  if (passes) {
    const n = arch === 'boomerang' || local ? passes : 1;
    // the return pass has to find the boss again, exactly like an extra pierce does
    const hits = 1 + (n - 1) * clamp(land, 0, 1);
    return { hits, label: hits > 1.001 ? `out and back (${r1(hits)} hits)` : null };
  }
  const v0 = speedOf(p, velocity ?? 10);
  const { alive, speed } = flightOf(p, v0, D);
  const cross = speed > 0.05 ? (b.w + (p?.width ?? 8)) / speed : alive;
  // A seeker does not get one pass and leave: it turns round and comes back for as long as it
  // lives, so its time on target is the life it has left rather than the width of one crossing.
  // Scourge of the Desert's javelins live 300 ticks — long enough to still be hunting when the next
  // stealth strike goes out — and the model was giving them the 6 ticks of a single fly-past.
  // This was tried once before and measured worth nothing, on data where the javelin's pierce read
  // as 2 (it is 4 on a strike) and the strike threw 7 of them (it throws 3). With both of those
  // read correctly it is worth 2 top-3 against the guides. The pierce cap is what bounds it: a
  // seeker with two hits in it still only gets two, however long it hunts.
  const window = p?.homing ? alive : Math.min(alive, cross);
  const segments = segmentsOf(b);
  const cap = pen === -1 ? Infinity : Math.max(1, pen);
  // Time on target buys repeat hits, but not one for every immunity window it covers. A seeker that
  // is supposed to sit on the boss for ten seconds does not: the fight moves, it overshoots and has
  // to come back, and its lifetime is very often `LIFE_UNKNOWN` rather than a number the miner read.
  // So the repeats saturate — `R` is how many times one projectile realistically re-connects with
  // the same body, and a seeker that steers back gets far more of them than a shot that has to
  // drift back by luck. Without this a 600-tick guess at a 10-tick cooldown was worth 55 hits from
  // one projectile against a single target.
  const repeats = window / imm;
  const R = p?.homing ? RECONNECT_SEEK : RECONNECT_PLAIN;
  const total = Math.min(cap, (1 + (R * repeats) / (R + repeats)) * segments);
  // Each hit after the first needs the projectile to still be lined up on something once it is
  // through the last one, and a thrown weapon does not steer: the second body is less likely than
  // the first and the third less likely than the second, so the extras fall off geometrically
  // rather than all costing the same. A seeker does steer, and keeps its pierce.
  const keep = p?.homing ? 1 : PIERCE_KEEP;
  const k = clamp(aim, 0, 1) * keep;
  // A crowd is the case pierce is for, and there the geometric shape is simply wrong: the bodies
  // are already lined up in the flight path, so the fourth is no harder to reach than the second
  // and the odds must not compound down. They are swept at a flat rate instead, linear in how many
  // bodies the pierce cap lets the projectile reach. That is what makes a piercing weapon pull
  // away from a single-hit one in a crowd rather than merely failing to fall behind it — and it
  // counts *distinct bodies*, so a weapon with pierce 2 reliably gets its 2 here, which the
  // geometric form did not give it. Repeat hits on a body a lingering projectile sits in are the
  // single-target term and are not added again.
  const extra = b.targets === 'multi' && !p?.homing
    ? Math.max(0, Math.min(total, Math.min(cap, segments)) - 1) * clamp(aim, 0, 1) * CROWD_SWEEP
    : k >= 1 ? total - 1 : (k * (1 - k ** Math.max(0, total - 1))) / (1 - k);
  const hits = 1 + extra;
  if (hits <= 1.001) return { hits: 1, label: null };
  const what = pen === -1 ? 'infinite pierce' : `pierces ${pen}`;
  const stay = clamp(aim, 0, 1) < 0.98 ? `, ${Math.round(clamp(aim, 0, 1) * 100)}% stay on target` : '';
  const bodies = segments <= 1 ? '' : b.targets === 'multi' ? `, ${segments} targets` : b.worm ? `, ${segments} segments` : `, ${segments} parts`;
  return { hits, spread: true, label: `${what}: ${r1(hits)} hits (${Math.round(window)} ticks on target, ${r1(imm)}-tick immunity${bodies}${stay})` };
}

/** Contact archetypes hit on the projectile's own clock, not the weapon's use time. */
const CONTACT = new Set(Object.keys(ARCHETYPE).filter((a) => ARCHETYPE[a].cycle === 'contact'));
/**
 * Contact weapons whose projectile is *left behind* rather than held: they accumulate, so what is
 * on the boss is a lifetime's worth of casting bounded by whatever cap the code states. A yoyo, a
 * flail and a held beam are the opposite — the player has the one they are holding.
 */
const PERSIST = new Set(['placed', 'spikyball']);
/**
 * Does what this weapon fires cross the gap to the boss, or is it an extension of the player?
 *
 * A whip's lash, a spear's thrust, a beam, a yoyo on its string, a cloud you place: all of them are
 * swung or held at the boss rather than thrown at it. They reach as far as they reach (`REACH`), the
 * player puts them where the boss *is*, and their `shootSpeed` is how fast they extend rather than
 * how fast they fly. Travel lead, the gravity arc and the range check all describe a free flight, so
 * none of them applies — Leather Whip was paying "4 px/tick over 220 px, 55 ticks of lead" for a
 * lash that is over in half a second.
 */
const ATTACHED = new Set(['whip', 'spear', 'minion', 'sentry']);

/** Weapon slots a class fills at the same time, so they are ranked apart rather than against each other. */
export const SLOT_MODES = new Set(['whip', 'minion', 'sentry']);
const flies = (arch) => !ATTACHED.has(arch);
/** The share of the fight a weapon of this type is on the boss at all. */
const uptimeOf = (arch) => ARCHETYPE[arch]?.uptime ?? 1;
/** Local hit cooldown in ticks, or null when the projectile hits a given NPC once and never again. */
const localOf = (p) => (p?.local > 0 ? p.local : null);

// ---- damage -----------------------------------------------------------------------------------

/** One hit against the boss's armour. Defense eats half a point per point, armour penetration buys it back. */
export function hitDamage(raw, b, armorPen = 0, defenseDebuff = 0) {
  const def = Math.max(0, (b.defense ?? 0) + defenseDebuff);
  return Math.max(1, raw - def * 0.5 + Math.min(def, armorPen) * 0.5);
}

/** Average of `1, k, k², …` over n hits: what the pierce falloff costs across a pass. */
const falloffAvg = (k, n) => (!(k > 0 && k < 1) || n <= 1 ? 1 : (1 - k ** n) / (n * (1 - k)));

// ---- the model --------------------------------------------------------------------------------

/** How far the class would rather stand, before any weapon has a say. */
export const preferredRange = (cls, playstyle) => {
  const style = playstyle?.[cls];
  return (style && PLAYSTYLE[cls]?.[style]) ?? ENGAGE[cls] ?? 340;
};
/** Engagement distance for a class and archetype, and what the archetype clamps it to. */
export function engagement(cls, arch, playstyle) {
  const base = preferredRange(cls, playstyle);
  const reach = REACH[arch];
  return reach !== undefined ? Math.min(base, reach) : base;
}

/**
 * One firing variant (spam or stealth): every projectile group with how much of it lands.
 * @returns {{ perUse: number, parts: Array, primary: object|null, contact: object|null }}
 */
function variantHits(item, ds, fire, variant, base, ctxIn) {
  const { boss: b, D, vb, arch, alt = false, rate: useRate = 0, text = null } = ctxIn;
  const parts = [];
  const primaryId = variant === 'stealth' && fire?.stealthMods?.type ? fire.stealthMods.type : fire?.typeOverride ?? base.primaryId;
  const primary = asStrike(proj(ds, primaryId), variant);
  // What this click, in this stealth state, puts in the air — as phase records rather than as a
  // walk over `fire.calls`, so what the weapon *does* is inspectable apart from what it is worth.
  // They come back in the order the arithmetic pays for them.
  const { phases, stocked } = deliveryPhases(fire, { variant, alt, primaryId });
  const velMul = (variant === 'stealth' && fire?.stealthMods?.velMul) || fire?.velMul || 1;
  // a weapon that is held at the boss rather than thrown at it has no flight to model, whatever its
  // `shootSpeed` says; anything that does cross the gap is flown at the pessimistic default when the
  // miner read no speed
  const shotVelocity = flies(arch) ? flightSpeed((base.shootSpeed || SHOOT_SPEED_UNKNOWN) * velMul) : null;

  /** One `NewProjectile` group (or the default shot): landed hits, and the children it brings. */
  const group = (p, { n, spread, fan, velocity, dmgMul, label, id = null, interval = null, maxActive = null, threshold = null, cooldown = null }) => {
    const land = landing(p, { D, boss: b, spread, fan, count: n, velocity, vb, arch });
    const hp = hitsPerProjectile(p, { boss: b, velocity, arch, D, land: land.f, aim: land.aim, interval });
    if (p?.local !== undefined) sharesIframes = false; // this group hits on its own clock
    // In a crowd, a projectile that cannot carry into a second body spends the whole throw on one
    // of the bodies in front of you — and on whichever one it happened to meet, often one already
    // dying. That unspent coverage is the real cost of a single-hit weapon here, and charging it
    // is what puts a reflecting boomerang or a one-hit dagger below a weapon that sweeps.
    let hits = hp.hits;
    let links = null;
    // A link is maintained, not stacked. What ticks on the boss is what is *alive* — arrivals per
    // second times how long each stays — capped by the weapon's own limit and by the bodies there
    // are to link, so recasting keeps the links up rather than adding a lifetime of ticks per cast.
    // Uncapped this is exactly `1 + stuck / tick` per projectile; the cap is the only new fact.
    const landed = useRate * n * land.f;
    if (p?.sticks && maxActive > 0 && hp.ticks > 0 && landed > 0) {
      const bodies = segmentsOf(b);
      const alive = Math.min(maxActive, bodies, (landed * hp.stuck) / 60);
      const ticksPerSec = (alive * 60) / hp.tick;
      hits = 1 + Math.min(hp.ticks, ticksPerSec / landed);
      // the casts per second that keep this many links up, which is what the pool actually pays for
      const needed = alive / (hp.stuck / 60) / Math.max(1e-6, n * land.f);
      links = { alive, needed, label: `${r1(alive)} of up to ${maxActive} links maintained on ${bodies} ${bodies === 1 ? 'body' : 'bodies'}: ${r1(ticksPerSec)} ticks/s`, mul: r2(hits / hp.hits) };
    }
    // each cast links one body, but successive casts link different ones: links across more than
    // one body are not a throw spent on one of them
    const waste = b.targets === 'multi' && !hp.spread && !(links?.alive > 1) ? CROWD_WASTE : 1;
    if (waste !== 1) parts.push({ fac: 'target', label: `${label ? `${label} ` : ''}reaches one body of the ${segmentsOf(b)} in front of you`, mul: waste });
    const own = n * land.f * hits * waste * (dmgMul ?? 1);
    // Each projectile in the group spawns its own children, so the children are counted for *one*
    // of them and multiplied back up — which is also the unit `CHILD_CAP` is written in. Adding one
    // group's worth for the whole fan is why a four-knife stealth strike got the same allowance of
    // spawned projectiles as a single throw, and it is the strikes with several projectiles that
    // the guides pick a rogue weapon for. The step ratios are unchanged by this: base and total are
    // both per projectile, so the parts still multiply out.
    const kids = childHits(ds, p, { boss: b, D, vb, arch, parentLand: land.f, variant, base: own / Math.max(1, n), stocked, parentId: id, threshold, cooldown, parentRate: useRate * n });
    const pre = label ? `${label} ` : n > 1 ? `${n}× ` : '';
    if (n > 1) parts.push({ fac: 'hits', label: `${pre}${n} projectiles per use`, mul: n });
    for (const x of land.parts) parts.push({ ...x, label: `${pre}${x.label}` });
    if (hp.label) parts.push({ fac: 'hits', label: `${pre}${hp.label}`, mul: r2(hp.hits) });
    if (links) parts.push({ fac: 'hits', label: `${pre}${links.label}`, mul: links.mul });
    if (dmgMul !== undefined && dmgMul !== 1) parts.push({ fac: 'damage', label: `${pre}${Math.round(dmgMul * 100)}% damage`, mul: r2(dmgMul) });
    for (const x of kids.parts) parts.push({ ...x, label: `${pre}${x.label}` });
    // the cascade's hits were counted for one projectile of the group; every projectile spawns its own
    return {
      own, kids: n * kids.hits, spawned: kids.phases.map((k) => ({ ...k, hitsPerUse: n * k.hitsPerUse })),
      // no immunity of its own: it goes through the player's window on the target, with everything else that does
      shared: p?.local === undefined,
      needed: links?.needed ?? null,
    };
  };

  // does every projectile this weapon fires share the player's immunity window on the target?
  let sharesIframes = true;
  // What each delivery phase spawns, as phases of their own: the blast, the splinters, the field
  // the blast leaves. They were evaluated inside the cascade all along but never surfaced, so a
  // cascade collapsed into its parent's share and a graph could not show it.
  const spawned = new Map();
  // the cast rate each delivery needs: null where it is simply fired every use
  const needs = [];
  /** One delivery phase, evaluated against this target. */
  const evaluate = (ph) => {
    const p = ph.id === 'default' || ph.projId === primaryId ? primary : asStrike(proj(ds, ph.projId), variant);
    // What the tooltip says where the code gave nothing: the tick and the link cap belong to a
    // projectile that stays in the target, the hit counter to what its landing sets off. Read onto
    // the record so the graph states the fact and where it came from.
    if (text && p?.sticks) {
      ph.duration = Math.min(p.life ?? 300, STUCK_TICKS);
      if (text.interval && !(ph.interval > 0)) { ph.interval = text.interval; ph.evidence = { ...ph.evidence, interval: text.evidence.interval }; ph.confidence = 'text'; }
      if (text.maxActive && !(ph.maxActive > 0)) { ph.maxActive = text.maxActive; ph.evidence = { ...ph.evidence, maxActive: text.evidence.maxActive }; ph.confidence = 'text'; }
    }
    const g = group(p, {
      interval: ph.interval,
      maxActive: ph.maxActive,
      threshold: text?.threshold ?? null,
      cooldown: text?.cooldown ?? null,
      n: ph.count,
      spread: ph.spread,
      fan: ph.fan,
      velocity: ph.absVelocity ?? (shotVelocity ? shotVelocity * ph.velMul : null),
      // an unreadably large multiplier is evidence of a branch, not of damage: the record keeps what
      // the miner read and the reading rule is applied here, where the model can be argued with
      dmgMul: dmgShare(ph.dmgMul),
      id: ph.id,
    });
    const hits = g.own + g.kids;
    // a roll the miner read the odds of: the shot happens that often, rather than every time
    const roll = ph.chance > 0 && ph.chance < 1 ? ph.chance : 1;
    const rolled = hits * roll;
    if (rolled !== hits) parts.push({ fac: 'hits', label: `fires on a 1-in-${r1(1 / ph.chance)} roll`, mul: r2(ph.chance) });
    // what this phase alone puts on the target per use of the weapon. Kept on the record so the
    // graph can say what each phase is worth instead of only what the weapon is worth: a phase with
    // no share of the damage is a phase nobody can check. The cascade's share is on its own records.
    ph.hitsPerUse = g.own * roll;
    ph.shared = g.shared;
    needs.push(g.needed);
    spawned.set(ph.id, g.spawned.map((k) => ({ ...k, region: ph.region, hitsPerUse: k.hitsPerUse * roll })));
    return rolled;
  };
  // alternatives of one if/else do not add up
  const groups = new Map();
  for (const ph of phases) {
    if (ph.region === 'default') continue;
    const g = groups.get(ph.region) ?? { hits: 0, parts: [] };
    const before = parts.length;
    g.hits += evaluate(ph);
    g.parts.push(...parts.splice(before));
    groups.set(ph.region, g);
  }
  let perUse = 0;
  const top = groups.get('top');
  if (top) { perUse += top.hits; parts.push(...top.parts); }
  // …and the miner cannot read which branch of an if/else runs, so the weapon fires the average of
  // them rather than whichever happens to score best
  const alts = [...groups.entries()].filter(([k]) => k !== 'top').map(([, g]) => g).sort((a, c) => c.hits - a.hits);
  if (alts.length) {
    perUse += alts.reduce((sum, g) => sum + g.hits, 0) / alts.length;
    // the model cannot read which branch runs, so it fires their average — and each branch is
    // therefore worth its share of one firing, not a whole one. Without this the graph claims more
    // hits than the weapon was credited with, by exactly the number of branches.
    for (const ph of [...phases, ...[...spawned.values()].flat()]) if (ph.region !== 'top' && ph.region !== 'default' && ph.hitsPerUse != null) ph.hitsPerUse /= alts.length;
    parts.push(...alts[0].parts);
    if (alts.length > 1) parts.push({ fac: 'hits', label: `${alts.length} alternative shots, one of them fires`, mul: r2(alts.reduce((sum, g) => sum + g.hits, 0) / alts.length / Math.max(0.01, alts[0].hits)) });
  }
  for (const ph of phases) if (ph.region === 'default') perUse += evaluate(ph);
  // each delivery followed by what it spawns, so the graph reads as the cascade it is
  const graph = phases.flatMap((ph) => [ph, ...(spawned.get(ph.id) ?? [])]);
  // only when every delivery is a maintained one is the weapon cast less often than it could be
  const neededRate = needs.length && needs.every((x) => x != null) ? Math.max(...needs) : null;
  return { perUse, parts, phases: graph, primary, contact: CONTACT.has(arch) ? primary : null, sharesIframes, neededRate };
}

/**
 * Child projectiles (explosions, splits, periodic shots) as extra landed hits, each conditioned on
 * what the parent did: an on-hit child only exists if the parent hit, an on-death child that was
 * meant to explode on the boss only helps when the parent missed if the blast is big enough.
 */
function childHits(ds, p, { boss: b, D, vb, arch, parentLand, variant, base = 0, stocked = null, depth = 0, scale = 1, parentId = null, threshold = null, cooldown = null, parentRate = 0 }) {
  const parts = [];
  // the spawn records, each carrying `hitsPerUse` — its hits per *parent projectile*, in hits of
  // the weapon's damage, the same unit `total` and `CHILD_CAP` are in
  const phases = [];
  if (!p?.children || depth > 1) return { hits: 0, parts, phases };
  let total = 0;
  // children *add* hits, so each one's share of the weapon is what it adds on top of everything
  // before it — printing every child as `×(1 + its own hits)` made a projectile with five of them
  // read as ×593 on the item card when the five together are worth `CHILD_CAP`
  const step = (before, after) => r2((base + after) / Math.max(0.01, base + before));
  for (const ph of spawnPhases(p, { variant, parentId })) {
    const c = { type: ph.projId, where: ph.evidence.where };
    // it is what the weapon's other click throws: this attack is stocking it, not landing it
    if (stocked?.has(c.type)) { parts.push({ label: `${nameOf(c.type)} is stocked for the other click, not damage now`, mul: 1 }); continue; }
    const cp = asStrike(proj(ds, c.type), variant);
    const n = Math.min(ph.count, 8);
    // a child spawned with a *number* for its damage is not this weapon's DPS — and a child spawned
    // with 0 is not damage at all. A third of the children in the pool are that: blood splatters,
    // sparkles, the bell a Thorium accessory rings on hit. They were counting as a full extra hit of
    // the parent's damage, which more than doubled 205 weapons.
    const dmg = ph.dmgMul === null ? (ph.dmgAbs === null ? CHILD_DMG_UNREAD : null) : dmgShare(ph.dmgMul);
    if (dmg === null) continue;
    // does it get to the boss?
    let reachShare;
    // an on-hit child only exists when the parent hit, and one spawned on death only lands where
    // the parent died — on the boss if it connected, and otherwise only if the blast reaches back
    if (ph.trigger === 'hit') reachShare = clamp(parentLand, 0, 1);
    else if (ph.trigger === 'death') {
      const blast = cp?.explode ?? cp?.width ?? 0;
      const stray = clamp(blast / Math.max(1, 2 * b.w), 0, 1);
      reachShare = clamp(parentLand, 0, 1) + (1 - clamp(parentLand, 0, 1)) * stray;
    } else {
      // spawned on a timer the miner cannot read: it is worth at most one extra hit, never `count`
      const land = landing(cp, { D: Math.min(D, 200), boss: b, velocity: 8, vb });
      reachShare = land.f / Math.max(1, n);
    }
    if (reachShare <= 0) continue;
    // A blast goes off where the parent died and stays there. It does not fly through anything, so
    // the crossing time a travelling projectile is charged for is the wrong clock: what it gets is
    // one hit, or — if it sets a cooldown of its own, which is how a lingering cloud or an acid
    // pool says it keeps ticking — one hit per cooldown for as long as it lasts.
    const lingers = cp?.local > 0;
    let hits;
    if (ph.trigger === 'death') {
      const cap = cp?.pen === -1 ? Infinity : Math.max(1, cp?.pen ?? 1);
      hits = lingers ? Math.min(cap, 1 + Math.min(cp.life ?? 0, STUCK_TICKS) / cp.local) : 1;
    } else {
      hits = Math.min(hitsPerProjectile(cp, { boss: b, velocity: 8, arch: 'shot' }).hits, 2);
    }
    // a spawn behind a roll the miner priced happens that often, not on every parent event
    const roll = ph.chance > 0 && ph.chance < 1 ? ph.chance : 1;
    // …and one behind a hit counter happens once per that many landed hits. The tooltip's counter
    // describes what the weapon's own shot sets off, so it is read on the first generation only.
    // ponytail: a share is not a miss probability, so "in a row" is read as "N hits"; the
    // run-completion form would need a per-shot landing chance the model does not have.
    const every = depth === 0 && threshold > 1 && (ph.trigger === 'hit' || ph.trigger === 'death') ? threshold : 1;
    if (every > 1) { ph.threshold = every; ph.confidence = 'text'; }
    // …and one on a stated cooldown fires at most that often, however fast the parent lands:
    // activations per parent projectile can be no more than `60 / cooldown` per second of them
    let gate = roll / every;
    if (depth === 0 && cooldown > 0 && parentRate > 0 && (ph.trigger === 'hit' || ph.trigger === 'death')) {
      const most = 60 / (cooldown * parentRate);
      if (most < gate) { gate = most; ph.cooldown = cooldown; ph.confidence = 'text'; }
    }
    const own = scale * n * reachShare * hits * dmg * gate;
    if (own <= 0.01) continue;
    parts.push({ label: `${n > 1 ? `${n}× ` : ''}${nameOf(c.type)} ${CHILD_WHERE[c.where] ?? ''}${roll < 1 ? ` on a 1-in-${r1(1 / roll)} roll` : ''}${every > 1 ? `, once per ${every} landed hits` : ''}${ph.cooldown ? `, at most once per ${r1(ph.cooldown / 60)} s` : ''} (+${r1(own)} hits at ${Math.round(scale * dmg * 100)}%)`, mul: step(total, total + own) });
    total += own;
    phases.push({ ...ph, hitsPerUse: own, shared: cp?.local === undefined });
    // What this child in turn spawns. `scale` carries down everything already paid to get here —
    // how many of the parent there are, how often it arrives, and what share of the weapon's damage
    // it does — because a grandchild is worth its own share *of that*, not of the whole weapon.
    // Without it the acid a Contaminated Bile's blast leaves behind was priced at half the weapon's
    // damage rather than a fifth, and its hits were added to the total with no part accounting for
    // them at all, so the stealth strike's factors stopped multiplying out to its own score.
    const deeper = childHits(ds, cp, { boss: b, D, vb, arch, parentLand: reachShare, variant, base: base + total, stocked, depth: depth + 1, scale: scale * n * reachShare * dmg, parentId: ph.id });
    parts.push(...deeper.parts);
    phases.push(...deeper.phases);
    total += deeper.hits;
  }
  if (total > CHILD_CAP) {
    parts.push({ label: `spawned projectiles capped at +${CHILD_CAP} hits (spawn rate unread)`, mul: step(total, CHILD_CAP) });
    // the cap is a ceiling on the cascade as a whole, so every phase in it keeps its share of it
    for (const ph of phases) ph.hitsPerUse *= CHILD_CAP / total;
    total = CHILD_CAP;
  }
  // a child projectile is extra hits, whatever it is called
  return { hits: total, parts: parts.map((x) => ({ fac: 'hits', ...x })), phases };
}

const nameOf = (id) => String(id).split(':').pop().replace(/([a-z])([A-Z])/g, '$1 $2').replace(/Proj(ectile)?$/, '').trim();
/** A projectile id as the item card names it. */
export const projName = nameOf;

/** Calamity's stealth strike damage multiplier for a weapon at full stealth. */
export function stealthMultiplier(useTime, stealthMax = STEALTH_MAX_DEFAULT, ds = null) {
  const c = stealthConsts(ds);
  const timeFactor = 0.75 + 0.75 * (Math.log(Math.max(1, useTime) + 2) / Math.log(4));
  // `4 / the average of the player's stealth-gen multipliers`, and those default to 1 — the moving
  // *ratio* is not one of them. Reading it as one gave 3.54 where four in-game readings, solved
  // backwards, all land within 2% of 4^(2/3).
  const genFactor = Math.pow(4, 2 / 3);
  return 1 + stealthMax * c.factor * timeFactor * genFactor;
}

/**
 * @param {object} item
 * @param {object} ctx  stat context (conds, uncertain, prefix, calibration) + optional ds, stage,
 *                      stealthMax, boss, playstyle
 * @returns {{ value: number, kind: 'dps'|'per hit', mode: string|null, dps: number|null, rate: number|null,
 *            critMult: number, eff: object, parts: Array, hit: number, spam?: number, stealth?: number }}
 */
function gradeWeapon(item, ctx = {}) {
  const ds = ctx.ds ?? null;
  const cls = item.cls ?? item.class;
  const eff = effectiveStats(item, ctx);
  const parts = [];
  const b = asTarget(ctx.boss ?? boss(ds, ctx.stage, ctx.target ?? null), ctx.targets ?? 'auto');
  const vb = bossSpeed(b.progression ?? ds?.stages?.[ctx.stage ?? 0]?.progression);
  const isAmmo = item.useAmmo > 0;
  // the miner tags every weapon; an untagged one (an older dataset, a hand-built record) is a shot
  // if it fires anything and a swing otherwise — a weapon with no projectile still hits something
  const arch = item.arch ?? (item.shoot || isAmmo || item.fire?.calls?.length ? 'shot' : 'swing');
  const ammo = isAmmo ? ctx.ammo ?? standardAmmo(ds, item.useAmmo, ctx.stage) : null;
  const listed = eff.damage + (ammo?.damage ?? 0);
  // a printed number the game does not balance around says nothing about what the weapon does
  if (listed > PLACEHOLDER_DAMAGE) {
    return {
      value: 0, kind: 'per hit', mode: null, dps: null, rate: null, critMult: 1, eff, hit: 0, boss: b, arch,
      parts: [{ fac: 'damage', label: `${listed} damage is a placeholder, not a number the game balances around`, value: 0 }],
    };
  }
  // A boss's defense comes off every hit as a flat number, so *where* in the calculation it lands
  // decides which weapons survive it. Subtracting it from the item's printed damage is subtracting
  // it from a number no player ever hits for: by the time you fight the thing you are wearing a
  // set, six reforged accessories and a potion. Taking the defense off the unbuffed number is a
  // flat tax on every weapon that hits often for a little, which is most of a rogue's list.
  // `ctx.loadout` is the gear the solver actually picked; the progression curve is the fallback for
  // a weapon graded on its own (the browser, a bare `weaponDps`).
  const stageLabel = ds?.stages?.[ctx.stage ?? 0]?.label ?? 'stage';
  // A void weapon is its vanilla class underneath: SOTS's VoidMelee takes every melee modifier the
  // gear carries on top of the void ones, so what the loadout gives that class counts too.
  const sub = item.subclass && ctx.loadoutFor ? ctx.loadoutFor(item.subclass) : null;
  const buff = 1 + (ctx.loadout ? ctx.loadout.damage + (sub?.damage ?? 0) : playerDamage(ds?.stages?.[ctx.stage ?? 0]?.progression) - 1);
  const raw = listed * buff;
  parts.push({ fac: 'damage', label: ammo ? `${eff.damage} + ${ammo.damage} (${ammo.name})` : `${eff.damage} damage`, value: listed });
  if (buff !== 1) parts.push({ fac: 'damage', label: `+${Math.round((buff - 1) * 100)}% ${cls}${sub?.damage ? ` and ${item.subclass}` : ''} damage ${ctx.loadout ? 'from the loadout' : `a ${stageLabel} loadout carries`}`, mul: r2(buff) });

  // The ammo names the projectile for a gun or a bow — the arrow is what flies. A flamethrower is
  // the other shape: `useAmmo` is Gel, which is consumed and fires nothing, and the flame is the
  // weapon's own `shoot`. Reading the ammo's projectile as the only answer threw that away whenever
  // the ammo did not resolve, and 35 weapons — most of the flamethrowers, a third of the launchers —
  // were graded with no projectile at all: no pierce, no lifetime, no homing, nothing.
  const primaryId = (isAmmo ? ammo?.shoot : null) ?? item.shoot ?? null;
  const primary = proj(ds, primaryId);

  // ---- debuffs the boss is not immune to: DoT on top, defense debuffs off its armour
  const debuffs = debuffPhases([primary, ...(item.fire?.calls ?? []).map((c) => proj(ds, c.type === 'shoot' ? primaryId : c.type))]);
  let dot = 0;
  let defenseDebuff = 0;
  const applied = [];
  const prog = b.progression ?? ds?.stages?.[ctx.stage ?? 0]?.progression;
  for (const ph of debuffs) {
    if (immuneTo(b, ph.buffId)) continue;
    const rec = ds?.debuffs?.[ph.buffId];
    if (rec?.dot || rec?.defense) {
      ph.dot = rec.dot ?? 0;
      dot += ph.dot;
      defenseDebuff += rec.defense ?? 0;
      applied.push(rec.name ?? nameOf(ph.buffId));
      continue;
    }
    // a debuff with no readable effect is still something done to the target: a flat allowance
    // for the stage stands in, and the phase says so
    ph.dot = unknownDebuffDps(prog);
    ph.confidence = 'assumed';
    ph.evidence = { ...ph.evidence, effect: 'unread' };
    dot += ph.dot;
    applied.push(`${rec?.name ?? nameOf(ph.buffId)} (effect unread: ${r1(ph.dot)}/s assumed)`);
  }
  if (debuffs.length && !applied.length) parts.push({ fac: 'debuff', label: `${debuffs.length} debuff${debuffs.length > 1 ? 's' : ''}, ${b.name ?? 'the boss'} is immune`, mul: 1 });

  // ---- armour
  const armorPen = (item.armorPen ?? 0) + (primary?.armorPen ?? 0);
  const hit = hitDamage(raw, b, armorPen, defenseDebuff);
  if (hit !== raw) parts.push({ fac: 'target', label: `${b.name ?? 'boss'} defense ${b.defense}${defenseDebuff ? ` ${defenseDebuff}` : ''}${armorPen ? `, ${Math.round(armorPen)} armor pen` : ''}`, value: r1(hit) });

  // ---- summons keep their slot model; their ranged children go through the landing model
  if (cls === 'summon' && (arch === 'minion' || arch === 'sentry') && primary) {
    const summon = summonPhase(primary, arch, { projId: primaryId });
    // A negative hit cooldown is not a rate: it means the projectile hits a given NPC once and
    // never again, and `60 / -1` is a *negative* hit rate — Terraprisma scored −8,829/s and the
    // Sanguine Staff −2,619/s, both of them weapons the guides pick. Everywhere else in the model
    // reads this through `localOf`, which maps anything at or below zero to "unread"; this branch
    // was the one place taking it raw. The record keeps the mined value; the reading happens here.
    const local = summon.cooldown > 0 ? summon.cooldown : null;
    const sentry = arch === 'sentry';
    let hps = local ? Math.min(60 / local, 3) : sentry ? 1.5 : 2;
    // what it shoots while it fights: the spawn phases that run on their own clock
    const ranged = spawnPhases(primary, { variant: 'spam' }).filter((ph) => ph.trigger === 'timer');
    if (ranged.length) {
      const land = landing(proj(ds, ranged[0].projId), { D: 200, boss: b, velocity: 8, vb });
      hps = 1.5 * Math.min(4, ranged.reduce((s, ph) => s + ph.count, 0)) * Math.max(0.3, land.f);
    }
    const slots = summon.resource.cost;
    parts.push({ fac: 'hits', label: `${r1(hps)} hits/s per ${sentry ? 'sentry' : 'minion'}`, mul: r1(hps) });
    if (slots !== 1) parts.push({ fac: 'hits', label: `${r2(slots)} minion slot${slots > 1 ? 's' : ''}`, mul: r2(1 / slots) });
    let value = (hit * hps) / slots;
    // a minion has to keep up with the boss; a sentry stands where it was put and only connects
    // while the fight comes back to it
    const up = uptimeOf(arch);
    if (up < 1) { value *= up; parts.push({ fac: 'landing', label: `${sentry ? 'stationary' : 'chasing the boss'}: ${Math.round(up * 100)}% of the time on it`, mul: r2(up) }); }
    const dotOn = Math.min(1, hps);
    if (dot) { parts.push({ fac: 'debuff', label: `${applied.join(', ')} (${r1(dot)} DPS)`, mul: r2((value + dot * dotOn) / Math.max(0.01, value)) }); value += dot * dotOn; }
    return { value, kind: 'dps', mode: arch, dps: value, rate: null, critMult: 1, eff, parts, hit, boss: b, arch,
      phases: [{ ...summon, hitsSec: r2(hps), contribution: r1(value - dot * dotOn) }, ...debuffs.map((ph) => ({ ...ph, contribution: r1((ph.dot ?? 0) * dotOn) }))] };
  }
  if (cls === 'summon' && !primary && !item.shoot) return { value: hit, kind: 'per hit', mode: null, dps: null, rate: null, critMult: 1, eff, parts, hit, boss: b, arch };

  // ---- rate
  const ut = eff.useTime || eff.useAnimation || 0;
  const ua = eff.useAnimation || eff.useTime || 0;
  const time = Math.max(ut, ua) + (item.reuseDelay ?? 0);
  if (!time) return { value: hit, kind: 'per hit', mode: null, dps: null, rate: null, critMult: 1, eff, parts, hit, boss: b, arch };
  const trueMelee = !item.noMelee && (arch === 'swing' || arch === 'shortsword');
  // the root of the graph: the clock every other phase hangs off
  const graph = [primaryPhase({ useTicks: time, maxActive: item.maxOut ?? null, projId: primaryId })];
  const perAnim = Math.min(item.useLimit ?? Infinity, !trueMelee && ut > 0 && ua > ut * 1.5 ? Math.max(1, Math.round(ua / ut)) : 1);
  const rate = (60 * perAnim) / time;
  /**
   * The blade's own clock. `Player.ApplyItemAnimation` starts a new animation as soon as the last
   * one ends, and `ApplyItemTime` only decides how often the item *acts* inside it — so a sword
   * whose `useTime` is longer than its animation still swings every animation and merely drops its
   * star less often. Starfury (20-tick animation, 40-tick use time), Ice Blade, Enchanted Sword and
   * Seashine Sword are all that shape, and taking `max(useTime, useAnimation)` for the swing too
   * halved every one of them.
   */
  const swingRate = 60 / (ua + (item.reuseDelay ?? 0));
  // …and the crit the loadout carries, which nothing used to add: a weapon was graded at its printed
  // crit, 4% where the player swinging it has 21.
  const critChance = eff.crit + (cls === 'summon' ? 0 : (ctx.loadout?.crit ?? 0) + (sub?.crit ?? 0));
  const critMult = cls === 'summon' ? 1 : 1 + Math.min(100, critChance) / 100;

  // ---- sustain: the pool the weapon spends against what comes back, at the rate it is actually
  // cast. A maintained phase (a tether kept up) needs far fewer casts than the use time allows.
  const pool = item.mana > 0 && (cls === 'magic' || cls === 'healer' || cls === 'bard') ? { name: 'mana', cost: eff.mana, regen: manaRegen(prog) }
    : cls === 'void' && item.voidCost > 0 ? { name: 'void', cost: item.voidCost, regen: voidRegen(prog) }
    : null;
  const sustainAt = (castRate) => (pool ? clamp(pool.regen / Math.max(0.01, pool.cost * castRate), SUSTAIN_FLOOR, 1) : 1);

  const fire = item.fire ?? null;
  const base = { primaryId, shootSpeed: item.shootSpeed ?? null };
  // the gates the tooltip states, for the clocks and counters the interpreter could not follow
  const text = item.tooltip ? textGates(item.tooltip) : null;
  // How far in the weapon makes the player come: as far as its shot actually carries, no further.
  // The player then stands at that edge and pays the range band for it — walking in to half the
  // reach instead (which is what a player really does, and would cancel the band) was measured and
  // costs 3 top-8 against the guides, because it promotes short-ranged weapons neither guide names.
  // …measured exactly the way `landing` measures it, against the same target: a different drop
  // tolerance here (and ignoring the velocity a stealth strike throws at) walked the player to a
  // distance the shot was then told it could not cover, for a flat ×0. `landing` allows the boss's
  // half-height; anything else is the model disagreeing with itself.
  const closeIn = (velMul = 1) => (primary && flies(arch)
    ? Math.min(turnsRoundAt(arch), reachOf(primary, flightSpeed((item.shootSpeed || SHOOT_SPEED_UNKNOWN) * velMul), b.h / 2))
    : Infinity);

  const shoots = !!primaryId || !!fire?.calls?.length || isAmmo;
  // a blade walks the player in to where it reaches, like a short throw does: `REACH` is the
  // archetype's reach, the item's `scale` is this blade's
  const bladeReach = (REACH[arch] ?? REACH.swing) * (item.scale ?? 1);
  /**
   * One grade of the weapon (spam / stealth) on one click, at its own engagement distance. A sword
   * that also fires has two stances — in close, where the blade connects, or back at the shot's
   * range, where it does not and the risk is not paid either — and `best` takes the better.
   */
  const variant = (name, alt = false, stance = 'close') => {
    const vparts = [];
    const vphases = [];
    // the two rogue grades are their own playstyle; every other class keeps the one it was given
    const rogue = cls === 'rogue' || cls === 'thrower';
    const style = rogue ? { ...ctx.playstyle, [cls]: name } : ctx.playstyle;
    const prefer = preferredRange(cls, style);
    const want = engagement(cls, arch, style);
    // A player does not stand where their weapon cannot reach — they walk in, and pay for standing
    // there. So the class's preferred distance is the *most* they keep, never a reason to score a
    // short-ranged weapon at zero. Half the reach, so the shot still arrives with life left for the
    // hits the pierce model counts on.
    const reach = closeIn((name === 'stealth' && fire?.stealthMods?.velMul) || fire?.velMul || 1);
    const D = clamp(Math.min(want, reach, trueMelee && stance === 'close' ? bladeReach : Infinity), MIN_ENGAGE, want);
    const v = shoots ? variantHits(item, ds, fire, name, base, { boss: b, D, vb, arch, alt, rate, text }) : null;
    // the casts the cycle actually needs: a maintained phase is recast only as its links lapse
    const castRate = v?.neededRate != null ? Math.min(rate, v.neededRate) : rate;
    const sustain = sustainAt(castRate);
    if (v?.phases) vphases.push(...v.phases);
    let perUse = v ? v.perUse : 0;
    // the swing itself: one hit per animation, at the reach the item's size buys — on the
    // animation's clock, which is not always the clock what it fires comes off
    const swing = trueMelee ? swingPhase({ swingTicks: ua + (item.reuseDelay ?? 0), scale: item.scale ?? 1 }) : null;
    if (swing) vphases.push(swing);
    const blade = swing ? bladeLanding({ D, boss: b, vb, reach: bladeReach, ticks: ua }) : null;
    if (blade) swing.evidence = { ...swing.evidence, reach: bladeReach };
    let swingHps = swing ? swingRate * clamp((item.scale ?? 1) * 0.85, 0.6, 1.2) * blade.f : 0;
    if (v) vparts.push(...v.parts);

    // contact weapons hit on the projectile's clock: a yoyo out at the boss, a beam held on it
    let hps;
    let useRate = rate;
    // …whether or not the projectile owns a hit cooldown: one that sets none goes through the
    // player's own window, which is exactly what governs a beam or a wall of thorns held on a boss.
    // Requiring a mined `local` here sent every such weapon down the use-time path instead, so the
    // Vilethorn — a wall of thorns standing in the boss — scored one hit per cast.
    // …but a projectile that may hit a given NPC *once and never again* is not a contact weapon
    // however long the player holds it there: a new one has to be made before the next hit, so the
    // weapon's own use time is the clock. A missing cooldown and a negative one are opposite facts —
    // one means "the player's window governs", the other "once, ever" — and `localOf` maps both to
    // null, so the contact path has to ask for the second before it reads the first.
    if (CONTACT.has(arch) && v?.contact && !(v.contact.local < 0)) {
      // the projectile's own hit cooldown is the rate: how often it may hit the same target while
      // the player keeps it there. The pass-through pierce count does not apply to something
      // already in contact.
      const held = contactPhase(v.contact, arch, { projId: primaryId, maxActive: item.maxOut ?? null, channel: !!item.channel });
      vphases.push(held);
      const own = held.cooldown;
      const local = own ?? IMMUNITY;
      const yoyoRange = v.contact.yoyo?.range;
      const inRange = yoyoRange ? clamp(yoyoRange / Math.max(1, D), 0.3, 1) : 1;
      // …times what the weapon has in contact: a second yoyo out at the boss is a second clock —
      // but only if it *owns* one. A projectile that sets no immunity of its own goes through the
      // player's single window on that NPC, so a second one of those, and every child it spawns,
      // is queueing for the same clock rather than starting another.
      // How many of it are on the boss at once. Four was a flat ceiling standing in for the game's
      // own answer; where the code states a cap — the projectile refusing to let more of itself
      // exist, or the weapon refusing to fire another — that is the number, and it can be lower or
      // higher than four. Without one the flat ceiling stays, and says so in the arithmetic.
      const capN = held.maxActive ?? 4;
      // How many are on the boss at once. A weapon you *hold* has what it threw this use, and no
      // more: the beam, the yoyo on its string, the blade in your hand. A weapon you *place* is the
      // other shape — the cloud stays where it was dropped and the next one goes out before the
      // last has expired, so what accumulates is a lifetime's worth of casting, not one use's.
      // `perUse` answered that for both, which is why a cloud living ten seconds and one living one
      // second were worth the same.
      const stacks = own ? clamp(perUse, 0, capN) : Math.min(clamp(perUse, 0, capN), segmentsOf(b));
      hps = (60 / local) * inRange * stacks;
      vparts.push({ fac: 'hits', label: `${r1(60 / local)} hits/s in contact (${local}-tick ${own ? 'immunity' : "player immunity: one clock, whatever it throws"})`, mul: r1(60 / local) });
      if (held.maxActive && perUse > held.maxActive) vparts.push({ fac: 'hits', label: `at most ${held.maxActive} out at once`, mul: 1 });
      if (inRange < 1) vparts.push({ fac: 'landing', label: `${Math.round(yoyoRange)} px of string against ${Math.round(D)} px`, mul: r2(inRange) });
    } else {
      // a 'flight' weapon is gone until it comes home: the round trip is the clock it hits on, and
      // the use time is only a floor under it. This is the whole difference between a boomerang and
      // a knife with the same damage and use time.
      if (ARCHETYPE[arch]?.cycle === 'flight' && v?.primary) {
        const v0 = speedOf(v.primary, flightSpeed(item.shootSpeed || SHOOT_SPEED_UNKNOWN));
        // it does not turn round at the target: it sails out to its own throw distance first, and
        // the next one waits for all of that
        const out = Math.max(D, THROW_OUT);
        const trip = Math.min(FLIGHT_CAP, (2 * out) / v0);
        // how many the weapon lets you have out at once, read off its `CanUseItem`
        const n = item.maxOut ?? 1;
        const back = returnPhase({ tripTicks: trip, maxActive: n, projId: primaryId });
        vphases.push(back);
        if (trip / n > time) {
          useRate = (60 * n) / back.cooldown;
          vparts.push({ fac: 'hits', label: `${n > 1 ? `${n} out at a time` : 'one out at a time'}: ${Math.round(trip)} ticks out to ${Math.round(out)} px and back`, mul: r2(useRate / rate) });
        }
      }
      hps = useRate * perUse;
      vparts.unshift({ fac: 'hits', label: perAnim > 1 ? `${perAnim} shots every ${r1(time)} ticks` : `every ${r1(time)} ticks`, mul: r2(rate), unit: '/s' });
      if (swingHps > 0) {
        // The chain up to here is the hit times whatever clock the *shot* runs on, and for a weapon
        // that fires nothing that clock never entered it — only the use rate did. Dividing by a
        // 0.01 floor instead of the right number is what printed a broadsword's swing as `×364`:
        // 110 of the 217 grades whose factors did not multiply out were this one line. Where the
        // chain really is at zero (it shoots, and none of it lands) no multiplier can lift it, so
        // the swing restates the number rather than scaling it.
        // the blade's landing is folded into this one factor: the swing is a share of the total,
        // and a multiplier on the whole chain cannot scale only that share
        const landed = blade.parts.map((x) => `${x.label} ×${x.mul}`).join(', ');
        const label = `contact swing every ${r1(ua)} ticks${item.scale && item.scale !== 1 ? ` (size ×${r2(item.scale)})` : ''}${landed ? `; blade ${landed}` : ''}`;
        const before = v ? hps : rate;
        if (before > 0) vparts.push({ fac: 'hits', label, mul: r2((hps + swingHps) / before) });
        else vparts.push({ fac: 'hits', label, value: r1(r1(hit) * (hps + swingHps)) });
        hps += swingHps;
      }
      // A projectile that sets no immunity of its own goes through the player's window on that NPC,
      // and so does the swing itself — so everything the weapon throws shares one 10-tick clock and
      // the whole thing cannot land more than six hits a second on one part, however many shots or
      // pierces it has. Local immunity is what buys a weapon out of that, which is why the weapons
      // that really do hit a lot have it.
      // …per immunity group: the phases that share the player's window are capped on their sum,
      // and a phase with a clock of its own keeps it. One flag for the whole weapon let a single
      // projectile with local immunity free everything else the weapon throws from the window.
      {
        const shared = v ? v.phases.filter((ph) => ph.shared && ph.hitsPerUse > 0) : [];
        const sharedHps = useRate * shared.reduce((s, ph) => s + ph.hitsPerUse, 0) + swingHps;
        // …but that is a *sustained* limit, and a stealth strike is not sustained: it lands its
        // whole burst at once and then waits out the recharge, so what the immunity window allows
        // it is the recharge's worth of ticks, not one use's. Reading it off the use rate capped a
        // strike at `6 / rate` hits — four, for a weapon swung every 40 ticks — which is a hard
        // ceiling on exactly the multi-projectile strikes the guides pick a weapon *for*.
        const window = name === 'stealth' ? stealthRecharge(ds) * rate : 1;
        const capHps = (60 / IMMUNITY) * segmentsOf(b) * window;
        if (sharedHps > capHps) {
          const k = capHps / sharedHps;
          for (const ph of shared) ph.hitsPerUse *= k;
          swingHps *= k;
          const after = hps - sharedHps + capHps;
          vparts.push({ fac: 'target', label: `${r1(sharedHps)} hits/s share the player's ${IMMUNITY}-tick immunity window`, mul: r2(after / hps) });
          hps = after;
        }
      }
    }

    // How much of the fight this kind of weapon is on the boss at all — a cloud you placed, a blade
    // you have to keep in it. It belongs to the weapon type, so it applies however the hits were
    // counted: reading it only on the contact path meant a type that fell through to the use clock —
    // a blade that hits a given NPC once, a cloud with no cooldown of its own — quietly got its
    // uptime back and scored *higher* than the same weapon with a hit cooldown.
    const up = uptimeOf(arch);
    if (up < 1) { vparts.push({ fac: 'landing', label: `${Math.round(up * 100)}% of the time on the boss`, mul: r2(up) }); hps *= up; }

    // A whip tags the boss and the minions do the rest — and what the minions then add does not
    // depend on how many projectiles this particular lash throws. Scaling the tag by the whip's own
    // hits made a whip that also sprays twelve shots worth three times that spray; the mark is a
    // fixed number of minion hits carrying a fixed share of the whip's damage, so it *adds*.
    const tag = ARCHETYPE[arch]?.tag;
    if (tag && perUse > 0) {
      const marked = tag * clamp(perUse, 0, 1);
      vparts.push({ fac: 'hits', label: `summon tag: minions carry the mark (+${r1(marked)} hits/s)`, mul: r2((hps + marked) / Math.max(0.01, hps)) });
      hps += marked;
    }

    // pierce falloff, averaged over the hits one projectile lands
    const fo = falloffAvg(v?.primary?.falloff ?? 1, Math.max(1, perUse));
    if (fo < 1) { hps *= fo; vparts.push({ fac: 'damage', label: `${Math.round((v.primary.falloff ?? 1) * 100)}% damage per extra pierce`, mul: r2(fo) }); }

    if (critMult !== 1) vparts.push({ fac: 'damage', label: `${r1(critChance)}% crit${ctx.loadout?.crit ? ` (${eff.crit} on the weapon, +${Math.round(ctx.loadout.crit)} from the loadout)` : ''}`, mul: r2(critMult) });
    if (sustain < 1) vparts.push({ fac: 'resource', label: `${r1(pool.cost * castRate)} ${pool.name}/s vs ${r1(pool.regen)} regen${castRate < rate ? ` (casting ${r1(castRate)}/s keeps the links up)` : ''}`, mul: r2(sustain) });

    // The guides' `†`, priced: how far short of where the class would rather be this weapon drags
    // the player, whatever did the dragging — the weapon type's reach or its own shot's. A cliff at
    // 150 px could only ever answer yes or no, and answered no for every melee weapon; the whole
    // difference between a yoyo and a pair of short daggers is *where along the way in* you end up.
    const exposure = clamp(1 - D / Math.max(1, prefer), 0, 1);
    const risk = 1 - (1 - (RISK[cls] ?? 0.85)) * exposure;
    if (risk < 0.995) vparts.push({ fac: 'cost', label: `${arch} fights at ${Math.round(D)} px of the ${Math.round(prefer)} px ${cls} wants`, mul: r2(risk) });

    // ---- what each phase is worth, as its share of the hits the weapon lands -------------------
    // The weapon-level factors (uptime, the tag, pierce falloff, the shared immunity cap) act on
    // everything at once, so the shares are taken raw and then scaled to the total. That makes the
    // contributions add up to the score by construction rather than by hope — which is the one
    // property that lets a phase graph be checked at all.
    const rawOf = (ph) => (ph.id === 'swing' ? swingHps : ph.hitsPerUse != null ? useRate * ph.hitsPerUse : 0);
    const rawSum = vphases.reduce((s, ph) => s + rawOf(ph), 0);
    for (const ph of vphases) {
      ph.hitsSec = rawSum > 0 ? (rawOf(ph) / rawSum) * hps : 0;
      ph.rate = ph.id === 'swing' ? swingRate : useRate;
    }
    return { hps, parts: vparts, risk, D, rate: useRate, phases: vphases, sustain };
  };

  // A debuff is only on the boss while the weapon keeps landing: one hit a second keeps any of
  // them up, a weapon that lands nothing applies nothing. Aphelion landed 0 hits and was paid its
  // whole DoT.
  const dotUp = (hps) => clamp(hps, 0, 1);
  const withDebuff = (v) => {
    const value = v.hps * hit * critMult * v.sustain * v.risk;
    if (!dot) return value;
    return value + dot * dotUp(v.hps);
  };

  /**
   * The two clicks are two attacks the player chooses between, not two that happen at once, so the
   * weapon is worth its better one. Reading them together left the model either summing a
   * right-click onto every left-click or — where they sit in different branches of `Shoot` —
   * averaging them as if a coin decided which fired.
   */
  const clicks = (fire?.calls ?? []).some((c) => c.alt !== undefined) ? [false, true] : [false];
  // a sword that fires further than it reaches can be used from back there instead
  const stances = trueMelee && shoots && closeIn(1) > bladeReach ? ['close', 'back'] : ['close'];
  const best = (name) => {
    let pick = null;
    for (const alt of clicks) for (const stance of stances) {
      const r = { ...variant(name, alt, stance), alt, stance };
      if (!pick || r.hps * r.sustain * r.risk > pick.hps * pick.sustain * pick.risk) pick = r;
    }
    if (clicks.length > 1) pick.parts = [...pick.parts, { fac: 'hits', label: `${pick.alt ? 'right' : 'left'} click: the better of the weapon's two attacks`, mul: 1 }];
    if (pick.stance === 'back') pick.parts = [...pick.parts, { fac: 'landing', label: `stands back at ${Math.round(pick.D)} px, out of the blade's reach: the shot alone beats swinging in close`, mul: 1 }];
    return pick;
  };

  const spam = best('spam');
  const spamValue = withDebuff(spam);
  // The debuff *adds* its damage over time to what the weapon does, so the part that explains it is
  // the factor it adds. As a bare `value` it replaced the running number instead, which is why a
  // Spore Knife's factors multiplied out to the poison alone and none of the knife.
  const dotPart = (v, up = 1) => (dot ? [{ fac: 'debuff', label: `${applied.join(', ')} (${r1(dot)} DPS${up < 0.995 ? `, up ${Math.round(up * 100)}% of the time at ${r1(up)} hits/s` : ''})`, mul: r2((v + dot * up) / Math.max(0.01, v)) }] : []);
  const dbg = dotPart(spamValue - dot * dotUp(spam.hps), dotUp(spam.hps));
  const out = {
    kind: 'dps', mode: null, rate: r2(rate), critMult, eff, hit, boss: b, arch, ammo, distance: spam.D,
    parts: [...parts, ...spam.parts, ...dbg],
    spam: spamValue, value: spamValue, dps: spamValue,
    // every damaging phase priced in the same units as the score, so the graph can be read as an
    // account of where the number came from: the shares sum to the weapon's own DPS
    phases: [
      ...graph,
      ...spam.phases.map((ph) => ({ ...ph, contribution: r1(ph.hitsSec * hit * critMult * spam.sustain * spam.risk) })),
      ...debuffs.map((ph) => ({ ...ph, contribution: r1((ph.dot ?? 0) * dotUp(spam.hps)) })),
    ],
  };

  // ---- Calamity rogue: stealth strike as the alternative grade. Every rogue weapon strikes from
  // stealth, with or without a coded stealth branch (`fire.stealth`), so grade all of them.
  if (cls === 'rogue' || cls === 'thrower') {
    const st = best('stealth');
    const smax = ctx.stealthMax ?? STEALTH_MAX_DEFAULT;
    // The weapon's own stealth share is a cut of each projectile the strike throws, not part of the
    // strike bonus: Calamity's multiplier is `1 + …` and folding a ×0.65 inside that `1 +` made a
    // weapon that trades damage for extra javelins look *stronger* than one that does not. Solving
    // four in-game readings backwards, the printed stealth damage has no `dmgMul` in it at all.
    const dmgMul = fire?.stealthMods?.dmgMul ?? fire?.stealthMult ?? 1;
    const mult = stealthMultiplier(time, smax, ds);
    const recharge = stealthRecharge(ds);
    // one strike per recharge: the hits of a single use, not the sustained rate
    const perStrike = st.hps / st.rate;
    const strike = (hit * mult * dmgMul * critMult * perStrike * st.risk) / recharge;
    const stealthValue = strike + dot;
    out.stealth = stealthValue;
    out.stealthParts = [
      { fac: 'damage', label: `${eff.damage} damage`, value: hit },
      { fac: 'damage', label: `stealth strike ×${r2(mult)} (max stealth ${Math.round(smax * 100)})`, mul: r2(mult) },
      ...(dmgMul !== 1 ? [{ fac: 'damage', label: `${Math.round(dmgMul * 100)}% damage each on the strike's projectiles`, mul: r2(dmgMul) }] : []),
      ...st.parts.filter((p) => !/ticks$|\/s$/.test(p.label) || p.unit !== '/s'),
      { fac: 'hits', label: `one strike per ${r1(recharge)} s (the bar fills in ${r1(recharge)} s of a fight)`, mul: r2(1 / recharge) },
      ...dotPart(strike), // the strike is its own running total, so the DoT is its own factor here
    ];
    // Stealth is not an alternative to throwing, it is what happens *while* you throw: stealth
    // builds back on its own, so the strike lands on top of the normal attacks rather than
    // instead of them. Grading them `max(spam, strike)` made the strike worth nothing — at any
    // normal use time `strike/recharge` is a fraction of the sustained rate — so a weapon whose
    // whole point is its stealth strike scored as if it did not have one.
    // Calamity disagrees with this on the mechanics: `UpdateStealthGenStats` returns 0 outright
    // while `Player.itemAnimation > 0`, so stealth does not build while you attack and the two are
    // strictly exclusive. `max` is the honest reading of that and was measured again with the rest
    // of this pass in place — 64 top-3 against 65, and no better anywhere else. A real player is
    // not the worst case of either: they throw, then break off to dodge, and the stealth fills in
    // the gaps. Additive stays, on the measurement rather than on the mechanic.
    out.value = out.dps = spamValue + strike;
    out.mode = strike > spamValue - dot ? 'stealth' : 'spam';
    if (out.mode === 'stealth') out.distance = st.D;
  }
  // A summoner's three weapons are worn at once, not chosen between (`SLOT_MODES`): the whip is the tag, the
  // minions are the damage. Minions and sentries name themselves above; a whip lands here on the
  // ordinary use clock, and without the tag it reads as a weapon competing with the minions.
  if (cls === 'summon') out.mode = arch;
  return out;
}

/**
 * Does anything this weapon throws take the world with it? Its own shot, the shots its fire
 * analysis names, and whatever any of those spawn. A charge that only sometimes digs still digs —
 * the miner flags the projectile wherever the `KillTile` sits, branch or no branch.
 */
export function digsTiles(item, ctx = {}) {
  const ds = ctx.ds ?? null;
  const shoot = item.useAmmo > 0 ? (ctx.ammo ?? standardAmmo(ds, item.useAmmo, ctx.stage))?.shoot ?? null : item.shoot ?? null;
  return [proj(ds, shoot), ...(item.fire?.calls ?? []).map((c) => proj(ds, c.type === 'shoot' ? shoot : c.type))]
    .flatMap((p) => [p, ...(p?.children ?? []).map((c) => proj(ds, c.type))])
    .some((p) => p?.digs);
}

/**
 * Real DPS, then the penalties that land on the weapon as a whole rather than on one grade of it.
 * Terrain damage is one: a rocket that eats the arena is not a weapon with fewer hits, it is a
 * weapon you put down after one fight, so both grades take the same cut and the ranking between
 * spam and stealth is left alone.
 */
export function realDps(item, ctx = {}) {
  const out = gradeWeapon(item, ctx);
  if (!digsTiles(item, ctx)) return out;
  const note = { fac: 'cost', label: 'destroys tiles: the blast takes the arena with it', mul: TERRAIN_PENALTY };
  for (const k of ['value', 'dps', 'spam', 'stealth']) if (typeof out[k] === 'number') out[k] *= TERRAIN_PENALTY;
  out.parts = [...out.parts, note];
  if (out.stealthParts) out.stealthParts = [...out.stealthParts, note];
  return out;
}
