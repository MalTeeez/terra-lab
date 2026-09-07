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
 * Seconds the bar takes to fill standing still. `CalamityPlayer.UpdateRogueStealth` is
 * `rogueStealth += rogueStealthMax × gen / 120` every tick, with `gen` = 1 standing and
 * `MovingStealthGenRatio` (0.5) moving — so 2 s still, 4 s moving, whatever the bar's width.
 *
 * `BaseStealthGenTime` (4) is *not* that clock, and the Stat Meter is what makes it look like one:
 * its "Standing Regen" line is `CalamityUtils.GetStandingStealthRegen × 60`, i.e.
 * `rogueStealthMax / BaseStealthGenTime × stealthGenStandstill × 60` — a display figure with the
 * wrong constant in it. A meter reading of 10.53 at Max Stealth 65 is `0.65 / 4 × 1.08 × 60`, which
 * says the player had a Silent accessory (+8 % `accStealthGenBoost`), not that the bar takes 6 s.
 * The tick rate above is the clock; this was read as `genTime` once, on that evidence, and halving
 * every rogue's strike rate is what it cost.
 */
export const stealthFill = () => 2;
/**
 * Seconds between stealth strikes: the bar's fill time standing still and moving, blended by how
 * much of the pause is spent still — 20 % for a fight spent dodging, the loop's own share
 * (`STEALTH_LOOP_STILL`) for a player who pauses to refill.
 */
export const stealthRecharge = (ds, still = 0.2) => { const c = stealthConsts(ds); const fill = stealthFill(ds); return (1 - still) * (fill / c.movingRatio) + still * fill; };
/** …with nothing mined: 2 s standing, 4 s moving, a fight spent dodging. */
export const STEALTH_RECHARGE = 3.6;
/**
 * How much of the pause a rogue takes to refill the bar is spent standing still. The bar fills in
 * `BaseStealthGenTime` seconds standing and twice that moving, and a player who plays for strikes
 * chooses the pause — but a boss fight is dodged, so half of it is spent moving.
 * ponytail: a knob; the rogue trial (an alternating throw/pause schedule, timed) calibrates it.
 */
export const STEALTH_LOOP_STILL = 0.75;
/** 50 stealth: an early rogue set. */
export const STEALTH_MAX_DEFAULT = 0.5;
/** Mana the player gets back per second: the natural curve, standing still with a Mana Flower. */
export const manaRegen = (progression) => 1.5 + 0.35 * Math.max(0, progression ?? 7) + 8;
/**
 * The mana bar the player is fighting out of at a progression value: twenty Mana Crystals early,
 * and what a late set and its accessories carry on top. A calibration knob — the loadout's own
 * maximum mana is not mined.
 */
export const manaCap = (progression) => 200 + 10 * Math.max(0, progression ?? 7);
/**
 * …and the second income the bar has, in mana a second: what potions put back.
 *
 * This is the number that decides whether mana is a **rate** limit or a **damage** cost, and the
 * game is clear that it is the second. A Mana Potion restores 100 mana in a 17-tick use, it is not
 * on the healing potions' cooldown, and a Mana Flower drinks one automatically the instant a cast
 * would fail — at no cost in attack time at all. So a mage does not fire more slowly because the
 * bar is empty; they drink, and they pay for it in Mana Sickness. What bounds them is the bag.
 *
 * At `2.5 + 1.6 × prog` this was 6.8 mana/s at Crabulon — one Lesser every seven seconds — and the
 * sustain it produced *was* a rate cap: Perfect Star spending 90 mana/s came out at ×0.21, which is
 * the model saying the player stops attacking four casts out of five. Nobody plays that way.
 *
 * So the income is the *best potion the run has got to*, drunk every `POTION_EVERY` seconds — often
 * but not frantically, since Mana Sickness decays in five. `poolSustain` is self-balancing around
 * it: `drinks` comes out as the share of that income a weapon actually needs, the rate is untouched
 * while the income covers the spend, and the cost lands as `MANA_SICKNESS` scaled by how often the
 * player is reaching for the flask. Only a weapon past what potions can physically deliver is
 * slowed, which is the honest reading of "you cannot keep this up".
 */
export const POTION_EVERY = 2;
/**
 * The best mana potion a run has at a progression value, in mana restored: Lesser 50 → Mana 100 →
 * Greater 150 → Super 200.
 *
 * Consumables are not mined — the dataset is equipment — so this is game data of the same kind as
 * `VANILLA_HOMING`, and the gates are the ingredient that opens each one: Fallen Stars and a bottle
 * for the first two, Pixie Dust (hardmode, `WallOfFlesh` is progression 7) for Greater, Crystal
 * Shards out of the Underground Hallow for Super. A mod that adds a better flask is not read, which
 * can only make this pessimistic.
 */
export const MANA_POTION = [[10, 200], [7, 150], [1, 100], [0, 50]];
export const potionMana = (progression) => {
  const prog = Math.max(0, progression ?? 7);
  return (MANA_POTION.find(([from]) => prog >= from)?.[1] ?? 50) / POTION_EVERY;
};
/**
 * The price of drinking it: Mana Sickness, −25 % magic damage the moment the potion goes down,
 * decaying to nothing over five seconds. A weapon that needs potions is under it the whole fight,
 * and half of 25 % is what it averages — a prism can be held as long as you like, for a little less
 * damage. Vanilla puts the debuff on magic damage alone, so a mod's mana-spending bard or healer
 * pays the income and not the sickness.
 */
export const MANA_SICKNESS = 0.125;
/** However short of a pool a weapon runs, the player still fires it sometimes. */
export const SUSTAIN_FLOOR = 0.35;
/**
 * …except mana, where "sometimes" is now spelled out: the bar, its regeneration and the potions
 * that top it up are all priced, so what is left below them is a weapon nobody can keep firing —
 * 423 mana a second against an income of 42 — and flattening that to the same 0.35 as a weapon at
 * 90 threw away the whole comparison. The floor is only there so a number nobody can defend does
 * not become a zero.
 */
export const MANA_FLOOR = 0.1;
/**
 * …and the void bar, for the same reason and one more: nothing tops it up. A mage out of mana
 * drinks a potion and keeps firing for a damage penalty; a void weapon that outruns the bar simply
 * stops, and the class is built around not doing that. At 0.35 the whole overdrawn half of the
 * class was one number — a staff spending 405 a second against 6 scored exactly what one at 20
 * against 6 did, 30 of the 72 costed void weapons pinned to the floor together.
 */
export const VOID_FLOOR = 0.1;
/**
 * How long a charge weapon is held before its shot arms, in ticks — the wind-up the miner can see
 * (`windup`) but cannot measure. One second: Gel Glove's counter caps at 120 and runs at
 * `extraUpdates` speed, Mage Hand and Yharim's Crystal are the same order. A calibration knob.
 */
export const WINDUP_TICKS = 60;
/**
 * How fast a player clicks, when the weapon's own animation is not what is stopping them.
 *
 * Almost every weapon is bounded by its use time and this never comes up. It matters for the one
 * shape that has no use clock at all: a holdout that writes `player.itemTime` every tick (`pinsUse`)
 * holds the animation open for as long as the button is down, and the moment it ends the animation
 * has two ticks left. Nothing in the item's numbers says how often such a weapon may be fired —
 * `useTime` for Perfect Star is the *charge step*, not the cadence — and the honest answer is the
 * hand on the mouse. 7.5/s, which is an ordinary sustained click rate and deliberately not a
 * macro's.
 */
export const CLICK_CPS = 7.5;
/**
 * Thorium's thrower exhaustion, as a mana-like pool. `ThoriumGlobalItem.Shoot` adds `useTime * 2`
 * per shot to a bar of `throwerExhaustionMax` (1200) that drains at 1/tick — so *any* Thorium
 * non-consumable thrower fired flat out spends 120/s against 60/s of regen, whatever its use time,
 * and can only be on for half the fight. Overdraw it and `throwerExhaustionPenalty` trips: each
 * further shot takes 0.2 off a damage multiplier that starts at 1, so five shots later the weapon
 * does literally nothing, and it stays that way until the bar has drained (up to 20 s). The pool
 * only prices the duty cycle; the lockout on top of it is why the class's ceiling is not higher.
 */
export const EXHAUSTION_REGEN = 60;
/** …and how much of it the bar holds before the penalty trips (`throwerExhaustionMax`). */
export const EXHAUSTION_CAP = 1200;
/**
 * How long the fight a weapon is scored for lasts, in seconds — only used to price a pool with a
 * reservoir, where "can it keep this up forever" and "can it keep this up for this fight" are
 * different questions. A calibration knob: a pre-Hardmode boss dies in well under a minute and a
 * late one takes several, and a single number in the middle is the honest stand-in until a fight
 * length is mined from boss health against the loadout's own DPS.
 */
export const FIGHT_SECONDS = 60;
/**
 * Health the player gets back per second in a fight, for the weapons that are paid for in it
 * (`item.lifeCost`): natural regen, which movement halves and every hit taken stops for a moment,
 * plus a healing potion on its cooldown. Pessimistic on purpose — a bar that refills as fast as a
 * mana bar would make a life cost free, which is the reading this replaces.
 * ponytail: a knob; the two Calamity life-cost weapons the guides name are what it is set against.
 */
export const lifeRegen = (progression) => 2 + 0.8 * Math.max(0, progression ?? 7);
/**
 * The floor under a health cost, below mana's: a mana bar running dry costs damage and the player
 * keeps firing through it, a health bar running dry ends the fight. A weapon that spends the bar
 * faster than it refills is one the player has to stop using, not one they push through.
 */
export const LIFE_FLOOR = 0.2;
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
/**
 * …and how deep it is: `VoidPlayer.ResetAllVoidBonuses` sets `voidMeterMax` to 100 before anything
 * the gear adds, and the player walks into the fight with it full. Priced as the reservoir it is,
 * the same way the mana bar and Thorium's exhaustion bar are: a hundred points is a second or two
 * of a heavy weapon and nothing at all to a light one, which is the honest size of it — but it is
 * also the only channel through which the accessories that raise the bar can be worth anything.
 */
export const VOID_BAR = 100;
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
/**
 * What a delivery that spawns *still* lands, where nothing else says. A melee image is swung at
 * arm's length and half of it is the reach it never had; a beam, a wall or a field is already where
 * the cursor is the frame it exists, and all it really costs is the moment it takes to come out.
 */
export const ZERO_LAUNCH_MELEE = 0.5;
export const ZERO_LAUNCH_PLACED = 0.85;
/** The speed the model flies a shot at, with an unreadably slow launch treated as unread. */
const flightSpeed = (v) => (v >= SHOOT_SPEED_MIN ? v : SHOOT_SPEED_UNKNOWN);
/** How long a projectile stuck in the boss keeps counting before the fight has moved on. */
export const STUCK_TICKS = 180;
/**
 * What share of its life a blast that *lingers where it went off* — a poison cloud, an acid pool, a
 * flame pillar, a geyser — actually has something in it. Unlike a projectile that sticks in the
 * boss, it cannot follow: the boss walks out of it and keeps fighting somewhere else, while the
 * cloud goes on ticking over empty ground. The hit it lands when it appears is paid for (the parent
 * connected there, which is what put it there); every tick after that is charged the same share
 * `ARCHETYPE.placed` already puts on a cloud you drop yourself, because it is the same situation.
 *
 * Without it a lingering blast was worth its whole 3-second window on the boss: Keelhaul's geyser,
 * a Flame Pillar and an Irradiated Cloud each read as 10–19 free hits per parent death.
 * ponytail: one share for every lingering blast; read the child's own velocity if a cloud that
 * chases the boss ever has to be told from one that sits.
 */
export const LINGER_ON_TARGET = ARCHETYPE.placed.uptime;
/**
 * How long a projectile that flies *past* the boss is near enough for what it spawns on its own
 * clock to matter: a second. A thrown wrench splitting every 35 ticks for its 180-tick life spawns
 * most of those splits a screen away from the target. A held or placed projectile is not bounded
 * by this — it stays where the fight is for as long as it is used.
 * ponytail: a knob; the parent's own time-on-target from `hitsPerProjectile` is what supersedes it.
 */
export const SPAWN_WINDOW = 60;

/**
 * Printed damage past anything the game balances around is a placeholder, not a weapon's damage:
 * SOTS's Tesseract prints 1,000,000 for a clone that attacks with *your* items, and a debug
 * pickaxe prints 400,000. The real endgame tops out at 23,000 (kevin, Sword of the Zenith), so
 * three items in the pool are above this and none of them is a number worth ranking on.
 */
export const PLACEHOLDER_DAMAGE = 50000;

/**
 * The whole model against the game, as one number: the residual left over after every mechanism it
 * *can* price, fitted to the in-game trials in `data/observed.json` (`node tools/observed.mjs`).
 *
 * It is a calibration, not a balance: one factor on every weapon alike, so it moves no ranking and
 * no guide metric — it only moves the printed DPS onto the meter's.
 *
 * It sits at 1, and after the Mycoroot trial was taken apart there is little left for it to hold.
 * The Stat Meter's damage line comes out to a third of a percentage point (233.72 % measured on
 * Sulphurous armour and a Flawless Mycoroot at full stealth, 234.01 % predicted), and the trial's
 * 202 DPS against the model's 195 is 4 %. What looked like a factor of two in the tooltip was two
 * mechanisms and a fight: the reforge's second multiplier (`prefixStealth`), the strike bonus
 * landing in the additive pool (`strikeMul`), and a reading taken with Rage and Adrenaline up —
 * `14 × (1 + 0.22 + 1.24 + 0.35 + 1.50 + 0.10) × 1.15 = 71` against the 70 on screen.
 *
 * Re-fit it, never hand-tune it: `tools/observed.mjs` computes its median *after* this factor, so
 * a new fit is this number times that median's reciprocal, and repeating it converges.
 *
 * Every gap that turns out to have a mechanism behind it comes out of here and goes into that
 * mechanism — the strike bonus landing in the additive pool did (see `strikeMul`). What is left
 * over is what nothing in the model prices at all, and the first candidate is Calamity's Rage and
 * Adrenaline: a Revengeance fight spends part of itself at +35 % and +150 %, and the model never
 * sees them.
 */
export const CALIBRATION = 1;

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
  // Past the last boss there is no next one, and falling off the end handed the endgame the
  // placeholder BOSS_DEFAULT — the softest target in the app scoring the hardest gear. The stage
  // after everything is still fought against everything: the last boss stays the target.
  return bossOf(ds, target ?? Math.min((stage ?? -1) + 1, (ds?.stages?.length ?? 0) - 1));
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

  const step = stepOf(velocity);
  const v = speedOf(p, velocity);
  const flight = velocity !== null && velocity > 0 ? D / v : 0;

  // ---- the three ways a shot misses, each as pixels off the target when it arrives ------------
  // the drift is measured against one segment, not the whole chain a worm drapes across the screen:
  // `aimW` is what you aim at, `b.w` is what the shot has to still be in front of when it arrives
  const driftPx = flight > 0 ? vb * flight * 0.5 : 0;
  // `gravityK` is pulled on the velocity once per *update*, and `flight` counts ticks — so a
  // projectile with extra updates falls `(1+updates)²` times as far over the same flight as this
  // used to charge it. `reachOf` already works in updates; this did not, and quietly handed every
  // fast arcing shot a flat arc. Gel Glove's ball was dropping "2 px over 220" for a ×0.98.
  const dropPx = p?.gravity && flight > 0 ? 0.5 * (p.gravityK ?? GRAVITY_K) * (flight * (1 + (p.updates ?? 0))) ** 2 : 0;
  const spreadPx = spread > 0 ? Math.tan(Math.min(spread, 1.4)) * D : 0;

  /**
   * …and the one budget that answers all three. `0.5·a·t²` is how far off the straight line a
   * seeker can end up, having spent the whole flight turning. Pricing that against the drift alone
   * left the other two misses charged in full — a fan of homing javelins was billed "1 of 3 land"
   * for an angle the javelins steer out inside a couple of ticks, and Scourge of the Desert paid
   * that *and* a 92 px arc while its own tooltip says the thing burrows through the ground and
   * launches itself at enemies.
   *
   * The three do not *add*, and summing them was tried: it made every seeker worse, which is the
   * opposite of the fact being modelled. A seeker steers at where the target is, so one heading
   * correction removes all three errors at once — it is not spending separate thrusters on the
   * boss's movement, its own arc and the angle it was thrown at. What the budget has to cover is
   * therefore the *largest* of them, not their total.
   */
  const homing = p?.homing;
  let homed = 0; // the share of its total aiming error this seeker can steer out, 0..1
  let seekLabel = null;
  if (homing && flight > 0) {
    const hs = homing.speed ?? velocity ?? v;
    const inertia = homing.inertia ?? HOMING_INERTIA;
    // Lateral authority, in px/tick². `turn` is read straight off a per-axis accelerator and is a
    // pull per *update*, exactly like `gravityK` — so it converts the same way, and a seeker with
    // extra updates really does steer `(1+updates)²` harder, which is what makes Scourge of the
    // Desert's 0.2 a stronger correction than the 0.6 the fallback was inventing for it.
    // The fallback deliberately does *not* get that conversion: `hs` there is usually the item's
    // shot speed in px/tick and `inertia` a blend divisor, so the ratio is already mixed units and
    // scaling a guess by four only makes the guess bigger.
    const turn = homing.turn != null ? homing.turn * (1 + (p.updates ?? 0)) ** 2 : hs / inertia;
    // A seeker only seeks what it can see, and a shot slower than the boss never catches it.
    // Letting a seeker correct only over the last `range` px of a longer flight was tried and cost
    // 4 top-8 against the guides for nothing: 361 of the 408 seekers here carry the pessimistic
    // 300 px default rather than a radius the miner read, so partial credit is credit for a guess.
    //
    // "Faster than the boss" has to be asked in the boss's units. `hs` falls back to the shot speed,
    // which is a step per *update*, while `vb` is px per *tick* — so a seeker with extra updates
    // read as slower than it is and had its homing switched off outright. Mothwing Dagger steps 4
    // and moves 16 px/tick on `updates: 3`; 36 seekers were losing the term the same way, all of
    // them comfortably faster than what they are chasing.
    // …and a *read* `homing.speed` is already the chase speed, so it answers the question directly.
    const chase = homing.speed ?? v;
    if (chase > vb && homing.range >= D * 0.6) {
      const correctable = 0.5 * turn * flight * flight;
      const miss = Math.max(driftPx, dropPx, spreadPx);
      homed = clamp(correctable / Math.max(1, miss), 0, 1) * (1 - (homing.delay ?? 0) / Math.max(1, p.life ?? LIFE_UNKNOWN));
      // Say which half of this was read. 408 of the 646 seekers here carry nothing but the
      // fallback range, and their turn rate is then the *item's* shot speed over the `HOMING_INERTIA`
      // knob — a number with no projectile in it at all. Printing that beside a mined one as if the
      // two were the same fact is how a knob passes itself off as evidence.
      const guessed = [homing.rangeGuess ? 'range' : null, homing.turn == null && (homing.speed == null || homing.inertia == null) ? 'turn rate' : null].filter(Boolean);
      seekLabel = `homing (${Math.round(homing.range)} px, turn ${r1(turn)}/tick${guessed.length ? ` — ${guessed.join(' and ')} assumed` : ''})`;
    }
  }

  // ---- each miss priced twice: flying dumb, and with the steering spent on it ------------------
  // Reporting them apart is what makes the homing line a real multiplier rather than a number
  // beside factors it was quietly folded into.
  //
  // aim: a random spread only lands the share of its cone inside the silhouette; a fan puts its
  // shots at fixed angles, so a wide boss catches several of them and a narrow one catches one.
  // A fixed angle off the cursor on a single shot is aimed with, not scattered: the player turns
  // the cursor by that much. Only a roll (`fan` false) or a fan wider than the target loses shots.
  const spreadAt = (h) => {
    const sp = spread * (1 - h);
    if (!(sp > 0 && sp > theta) || (fan && count === 1)) return { s: 1, label: null };
    if (fan && count > 1) {
      const gap = (2 * sp) / (count - 1);
      const inside = Math.max(1, Math.floor(theta / gap) * 2 + 1);
      return { s: Math.min(1, inside / count), label: `${count}-shot fan ±${deg(sp)} vs ${deg(theta)} target (${Math.min(count, inside)} land)` };
    }
    return { s: theta / sp, label: `spread ±${deg(sp)} vs ${deg(theta)} target` };
  };
  const travelAt = (h) => (flight > 0 ? b.w / (b.w + driftPx * (1 - h)) : 1);
  const gravityAt = (h) => (dropPx > 0 ? clamp(b.h / (b.h + dropPx * (1 - h)), 0.2, 1) : 1);

  const dumbSpread = spreadAt(0);
  if (dumbSpread.s < 0.995) { f *= dumbSpread.s; parts.push({ label: dumbSpread.label, mul: r2(dumbSpread.s) }); }
  const dumbTravel = travelAt(0);
  if (dumbTravel < 0.995) { f *= dumbTravel; parts.push({ label: `${r1(v)} px/tick over ${Math.round(D)} px (${Math.round(flight)} ticks of lead)`, mul: r2(dumbTravel) }); }
  const dumbGravity = gravityAt(0);
  if (dumbGravity < 0.995) { f *= dumbGravity; parts.push({ label: `arc drops ${Math.round(dropPx)} px over ${Math.round(D)} px`, mul: r2(dumbGravity) }); }

  if (homed > 0.02) {
    const dumb = dumbSpread.s * dumbTravel * dumbGravity;
    const back = (spreadAt(homed).s * travelAt(homed) * gravityAt(homed)) / Math.max(1e-6, dumb);
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
  // `spread` is reported apart because it is the one term in here that is *independent* per
  // projectile — it is already the share of a volley pointed at the target — while the lead, the
  // arc and the range are common-mode across everything thrown in the same instant.
  return { f, spread: dumbSpread.s, parts: parts.map((x) => ({ fac: 'landing', ...x })), aim: carry > 0 ? f / carry : 0 };
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

/**
 * How often a physical blade can actually be brought into a boss over a fight.
 *
 * `bladeLanding` answers whether a swing that is already aimed at the boss connects.  That alone
 * makes a 4-tile knife and a normal 6-tile sword equally likely to be *in* its reach: both are
 * evaluated at their exact endpoint.  In play the short knife has a much smaller contact window
 * whenever the boss moves away, so it must not inherit the normal sword's uptime.  Cubing relative
 * reach makes the lower end deliberately steep (64 px is 26% of ordinary contact coverage), while
 * a normal broadsword remains the baseline and unusually long blades get modest extra coverage.
 */
export const bladeCoverage = (reach) => clamp((reach / REACH.swing) ** 3, 0.08, 1.2);

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
 * A held projectile that lies *along* the crowd rather than sitting in one body of it: a beam, a
 * lash, a field, and only where it pierces. Every body on that line is on its own immunity clock,
 * so a crowd is not the cost to it that `CROWD_WASTE` prices — the pierce a *shot* is already paid
 * for in `hitsPerProjectile`, and a piercing *held* weapon never was.
 *
 * The two shapes are indistinguishable in the mined record — Terragrim's blade and the Last Prism's
 * holdout are both `aiStyle 75`, infinite pierce, no immunity of their own — and what separates them
 * is the class: a held *melee* weapon is a drill or a blade in your hands, a held magic or ranged
 * one is the beam it puts across the room.
 */
const sweepsCrowd = (p, arch, cls) => cls !== 'melee' && (
  // a field parks itself over ground rather than being thrown at a body, so which body it "met" is
  // not a question that applies to it — SHPC's vortex sits on the crowd and fires into all of it
  !!p?.still
  || ((p?.pen === -1 || p?.pen > 1) && (arch === 'held' || arch === 'placed' || arch === 'whip')));

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
export function hitsPerProjectile(p, { boss: b, velocity, arch, cls = null, D = 0, land = 1, aim = land, interval = null, vb = 0 }) {
  // a negative hit cooldown means "once per NPC, ever" — it is not a rate. Without any local
  // immunity the projectile falls back to the player's own 10-tick window on that NPC.
  const local = localOf(p);
  const pen = p?.pen ?? 1;
  // `localNPCHitCooldown = -1` is not a rate: the projectile may hit a given NPC once and never
  // again, whatever its pierce says. An explosion, a splinter, a bomb's blast — one hit each.
  if (p?.local < 0) return { hits: 1, label: null };
  // …and so does a projectile that switches its own `friendly` off the moment it connects: it has
  // spent itself, and its pierce and its immunity window describe a thing that can no longer damage
  // anything. Read off `OnHitNPC`, so it is a fact and not an archetype guess.
  if (p?.spent) return { hits: 1, label: 'stops dead on its first hit' };
  // `Vector2.Zero` at spawn is evidence that this is an animated/custom delivery, not a projectile
  // flying through the boss at the item's `shootSpeed`. Its own AI may still make it connect once,
  // but its infinite penetration cannot be read as a path through every segment or a sequence of
  // reconnects. Ebon Hammer is this shape; the rule is intentionally about the launch fact, not
  // its name or archetype.
  if (velocity === 0) return { hits: 1, label: 'starts at zero velocity: custom delivery, one hit' };
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
  // whip lashes once through the arc rather than piercing along it — except where it is laid along
  // the crowd (`sweepsCrowd`), which is not a throw spent on one body of it and pays no `CROWD_WASTE`
  if (CONTACT.has(arch) || arch === 'whip') return { hits: 1, spread: sweepsCrowd(p, arch, cls), label: null };
  const passes = ARCHETYPE[arch]?.passes;
  // out and back. A boomerang's two passes are a whole flight apart, so no immunity window can
  // merge them; a spear's thrust returns at once and needs its own cooldown to count twice.
  //
  // The passes *multiply* what one pass lands rather than replacing it. Short-circuiting here threw
  // away the projectile's pierce along with everything else the crowd model knows: Kylie carries
  // `pen -1` through six bodies and came out at 1.4 hits, worse than a dagger that pierces nothing.
  // A weapon with nothing to pierce into has no more to learn and still answers here.
  let passMul = 1;
  if (passes) {
    const n = arch === 'boomerang' || local ? passes : 1;
    // the return pass has to find the boss again, exactly like an extra pierce does
    passMul = 1 + (n - 1) * clamp(land, 0, 1);
    // …and only a boomerang flies *through* a crowd on each pass. A spear's two passes are one
    // thrust returning along the same line, on the same body, and what repeats there is the
    // immunity window's business, not the crowd's.
    if (arch !== 'boomerang' || !(pen === -1 || pen > 1)) return { hits: passMul, label: passMul > 1.001 ? `out and back (${r1(passMul)} hits)` : null };
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
  // …but only for as long as it can hold station. A seeker that barely out-paces what it is chasing
  // spends its life re-approaching rather than sitting on it, and what it has left for holding is
  // the share of its own speed not already spent matching the target's. Riveting Tadpole's bubble
  // does 6 px/tick against a boss doing 5 and was credited a hit every ten ticks for a solid
  // second; a seeker four times the boss's speed keeps three quarters of its life, as it should.
  const hold = p?.homing ? clamp((v0 - vb) / Math.max(0.01, v0), 0, 1) : 1;
  const window = p?.homing ? alive * hold : Math.min(alive, cross);
  const segments = segmentsOf(b);
  const cap = pen === -1 ? Infinity : Math.max(1, pen);
  /**
   * …and how many of those bodies this projectile can actually be in, which is not the same number.
   * A crowd is only worth something to something that goes *through* it, and two facts say it does
   * not. It **steers**: a seeker turns onto a target and stays with it, re-acquiring rather than
   * carving a line, so Event Horizon's homing stars were being paid for six bodies they never line
   * up on. Or it is **gone**: what is left of its life on arrival, over what one body costs it to
   * cross, is how many it can reach, and a holdout that expires at the cursor (Devil's Claw, ten
   * ticks of life at the end of a 120 px reach) crosses none of them however infinite its pierce.
   */
  // …and a seeker is not left at one body flat, because a big enough one is inside several of them
  // at the same time whatever it is steering at. Its own hitbox against a body's is the measure:
  // Apotheosis throws a 108 px worm through a crowd whose segments are 40, Event Horizon throws
  // 40 px stars at a 100 px boss.
  const bodies = p?.homing
    ? Math.min(segments, 1 + (p.width ?? 8) / Math.max(1, b.w))
    : Math.min(segments, 1 + Math.max(0, alive) / Math.max(1e-6, cross));
  // Time on target buys repeat hits, but not one for every immunity window it covers. A seeker that
  // is supposed to sit on the boss for ten seconds does not: the fight moves, it overshoots and has
  // to come back, and its lifetime is very often `LIFE_UNKNOWN` rather than a number the miner read.
  // So the repeats saturate — `R` is how many times one projectile realistically re-connects with
  // the same body, and a seeker that steers back gets far more of them than a shot that has to
  // drift back by luck. Without this a 600-tick guess at a 10-tick cooldown was worth 55 hits from
  // one projectile against a single target.
  const repeats = window / imm;
  const R = p?.homing ? RECONNECT_SEEK : RECONNECT_PLAIN;
  // Passing through bodies and lingering on one are *different* hits and they add. Multiplying them
  // said a projectile lingers its whole remaining life on every segment at once — the same 63 ticks
  // spent four times over — and a single slow bubble inside the Eater of Worms came out at 20.6 hits
  // where its one pass through four segments plus its own repeats is 8.2. Riveting Tadpole rode that
  // to 1306 DPS at Pre-Evil, on a stage-0 bard weapon. With one body the two forms are identical, so
  // nothing about single-target scoring moves.
  const total = Math.min(cap, bodies + (R * repeats) / (R + repeats));
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
    ? Math.max(0, Math.min(total, Math.min(cap, bodies)) - 1) * clamp(aim, 0, 1) * CROWD_SWEEP
    : k >= 1 ? total - 1 : (k * (1 - k ** Math.max(0, total - 1))) / (1 - k);
  const hits = (1 + extra) * passMul;
  // one hit — but *where* it lands is still a question, and a field that parks itself over the crowd
  // is not a throw spent on whichever body it happened to meet
  if (hits <= 1.001) return { hits: 1, spread: sweepsCrowd(p, arch, cls), label: null };
  const what = `${passMul > 1.001 ? `out and back, ` : ''}${pen === -1 ? 'infinite pierce' : `pierces ${pen}`}`;
  const stay = clamp(aim, 0, 1) < 0.98 ? `, ${Math.round(clamp(aim, 0, 1) * 100)}% stay on target` : '';
  const reached = bodies <= 1.05 ? '' : b.targets === 'multi' ? `, ${r1(bodies)} targets` : b.worm ? `, ${r1(bodies)} segments` : `, ${r1(bodies)} parts`;
  return { hits, spread: bodies > 1.05, label: `${what}, ${r1(hits)} hits over ${Math.round(window)} ticks on target with a ${r1(imm)}-tick immunity${reached}${stay}` };
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
 *
 * Every *contact* archetype belongs here for the same reason and was missing: a beam arrives the
 * frame it is fired and is then steered by the cursor, so 6 ticks of lead is not a thing that can
 * happen to it. What it does cost to keep a moving boss inside something you have to aim is priced
 * once already, as the archetype's `uptime` — 0.85 for a beam, 0.7 for a yoyo — and charging a
 * travel lead on top of that was the same fact billed twice, the second time as if the beam were a
 * thrown rock. Yharim's Crystal was paying ×0.8 for "30 px/tick over 180 px".
 */
const ATTACHED = new Set(['whip', 'spear', 'minion', 'sentry']);
/**
 * …and the same fact where the archetype alone cannot say it. A *beam* — a held or placed delivery
 * of anything but a melee weapon — arrives the frame it is fired and is then steered by the cursor,
 * so 6 ticks of lead is not a thing that can happen to it, and neither is an arc or a range check.
 * What it costs to keep a moving boss inside something you have to aim is priced once already, as
 * the archetype's  (0.85 for a beam, 0.3 for a field you place); charging a travel lead on
 * top of that was the same fact billed twice, the second time as if the beam were a thrown rock.
 *
 * Melee's held weapons are deliberately left flying, and it is a compensating error rather than a
 * belief: a drill is in your hands and leads nothing either, but  walks it to 180 px —
 * a beam's reach, not a drill's — and the lead is what has been paying for that. Freeing them
 * together costs vanilla melee 3 top-3 and ieor melee 2. The reach is the thing to fix.
 */
const instant = (arch, cls) => (arch === 'held' || arch === 'placed') && cls !== 'melee';

/** Weapon slots a class fills at the same time, so they are ranked apart rather than against each other. */
export const SLOT_MODES = new Set(['whip', 'minion', 'sentry']);
const flies = (arch, cls) => !ATTACHED.has(arch) && !instant(arch, cls);
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
  const { boss: b, D, vb, arch, cls = null, alt = false, charged = false, rate: useRate = 0, text = null, listed = 0, crit = 0, attachedLanding = null } = ctxIn;
  // What `ModifyShootStats` does to the damage every shot is fired with. The stealth path's number
  // is read off the same cells after the stealth branch stored into them, so it already carries the
  // unconditional adjustment: on a strike it *replaces* the ordinary term rather than stacking on it.
  // Calamity's `StealthDamageMultiplier` is what that branch multiplies by, so where the machine did
  // not read the branch the property stands in for it, on top of the unconditional term.
  const shotMul = variant === 'stealth'
    ? fire?.stealthMods?.dmgMul ?? (fire?.stealthMult ?? 1) * (fire?.dmgMul ?? 1)
    : fire?.dmgMul ?? 1;
  const parts = [];
  const primaryId = variant === 'stealth' && fire?.stealthMods?.type ? fire.stealthMods.type : alt && fire?.altMods?.type ? fire.altMods.type : fire?.typeOverride ?? base.primaryId;
  const primary = asStrike(proj(ds, primaryId), variant);
  // What this click, in this stealth state, puts in the air — as phase records rather than as a
  // walk over `fire.calls`, so what the weapon *does* is inspectable apart from what it is worth.
  // They come back in the order the arithmetic pays for them.
  const { phases, stocked } = deliveryPhases(fire, { variant, alt, primaryId });
  const velMul = (variant === 'stealth' && fire?.stealthMods?.velMul) || fire?.velMul || 1;
  // a weapon that is held at the boss rather than thrown at it has no flight to model, whatever its
  // `shootSpeed` says; anything that does cross the gap is flown at the pessimistic default when the
  // miner read no speed
  const shotVelocity = flies(arch, cls) ? flightSpeed((base.shootSpeed || SHOOT_SPEED_UNKNOWN) * velMul) : null;

  /** One `NewProjectile` group (or the default shot): landed hits, and the children it brings. */
  const group = (p, { n, spread, fan, velocity, dmgMul, dmgWhy = null, label, id = null, interval = null, maxActive = null, threshold = null, cooldown = null, carrier = false }) => {
    const zeroLaunch = velocity === 0;
    // A `Vector2.Zero` launch moves under custom AI from the player rather than flying at the item's
    // `shootSpeed`, and it never lets `penetrate = -1` invent a flight through a worm. What it costs
    // depends on what the delivery is. A *melee* one is an attached image swung at arm's length and
    // takes the blade's own reach where there is one. Anything else that spawns still is a beam, a
    // wall or a field put where the cursor already is, and it is there the frame it exists — what it
    // loses is the moment it takes to come out, not half of its landing.
    // How much better than that floor is read off the delivery itself: what matters once it is out
    // is whether it can follow a boss that moves. A beam the player holds is re-aimed every frame
    // (`held`, `ridesOwner`), and a seeker turns at a rate the miner read — either way the thing
    // arrives where the target is, not where the cursor was when it spawned. What cannot follow is
    // what was *placed*, and that is what the floor is for.
    const steers = !!p?.held || !!p?.ridesOwner || !!p?.homing;
    const stillLand = attachedLanding ?? (cls === 'melee' ? ZERO_LAUNCH_MELEE : steers ? 1 : ZERO_LAUNCH_PLACED);
    const land = zeroLaunch
      ? { f: stillLand, aim: stillLand, spread: 1, parts: stillLand > 0.995 ? [] : [{ fac: 'landing', label: cls === 'melee' || attachedLanding ? 'starts at zero velocity, so it is delivered at melee reach' : 'starts at zero velocity where it was put, so a boss that moves can leave it', mul: r2(stillLand) }] }
      : landing(p, { D, boss: b, spread, fan, count: n, velocity, vb, arch });
    // …a still delivery hits once, and whether it is spent on one body of a crowd is the same
    // question it would be if it had flown there: a wall of thorns put in a worm is in all of it.
    const hp = zeroLaunch ? { hits: 1, label: null, spread: sweepsCrowd(p, arch, cls) } : hitsPerProjectile(p, { boss: b, velocity, arch, cls, D, land: land.f, aim: land.aim, interval, vb });
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
    const landRate = useRate * n * land.f; // landings per second
    if (p?.sticks && maxActive > 0 && hp.ticks > 0 && landRate > 0) {
      const bodies = segmentsOf(b);
      const alive = Math.min(maxActive, bodies, (landRate * hp.stuck) / 60);
      const ticksPerSec = (alive * 60) / hp.tick;
      hits = 1 + Math.min(hp.ticks, ticksPerSec / landRate);
      // the casts per second that keep this many links up, which is what the pool actually pays for
      const needed = alive / (hp.stuck / 60) / Math.max(1e-6, n * land.f);
      links = { alive, needed, label: `${r1(alive)} of up to ${maxActive} links maintained on ${bodies} ${bodies === 1 ? 'body' : 'bodies'}: ${r1(ticksPerSec)} ticks/s`, mul: r2(hits / hp.hits) };
    }
    // each cast links one body, but successive casts link different ones: links across more than
    // one body are not a throw spent on one of them
    const waste = b.targets === 'multi' && !hp.spread && !(links?.alive > 1) ? CROWD_WASTE : 1;
    if (waste !== 1) parts.push({ fac: 'target', label: `${label ? `${label} ` : ''}reaches one body of the ${segmentsOf(b)} in front of you`, mul: waste });
    /**
     * …and everything one use throws arrives at the same instant. A projectile that sets no
     * immunity of its own goes through the *player's* window on the body it hits, so a volley of
     * `n` of them lands **one** hit between them on a single target, not `n`: the first pellet sets
     * `npc.immune[owner]` and the rest of the blast finds the target immune. It is why a shotgun is
     * a crowd weapon in this game and not a boss weapon, and why a mod that wants its spray to
     * count gives the projectile `usesLocalNPCImmunity` — which is exactly the flag read here.
     *
     * In a crowd they meet different bodies and each body has its own window, so the collapse is to
     * however many bodies there are rather than to one — `min(n, bodies)` get through, and a volley
     * narrower than the crowd is unchanged.
     *
     * The two halves of landing behave differently here, and they have to be split. The *spread* is
     * independent — `spreadAt` already prices it as the share of a volley pointed at the target, so
     * `n × spread` is how many of them are actually aimed at a body. Everything else in `land.f` —
     * the travel lead, the arc, the range — is common-mode: if the boss has moved out of the way,
     * or the shot drops short, the whole volley misses together. So the aimed ones collapse against
     * the bodies, and what survives pays the correlated share once.
     *
     * Treating all of `land.f` as `n` independent chances (`1 − (1−L)^n`) was tried first and
     * flattered every volley; collapsing all of it to one arrival was tried second and charged a
     * *random* spread twice, once in `spreadAt` and again here. Harpy's Barrage lands 0.63 of a
     * feather a throw under this, against an in-game reading that pins its per-feather damage at 60
     * exactly.
     *
     * None of which applies to a *seeker*. Arriving inside the window only wastes a shot that cannot
     * come back, and a homing projectile can: it turns round and keeps hunting until one opens,
     * which is the same fact `hitsPerProjectile` already reads its time-on-target from. Twelve of
     * Mycoroot's spores live sixty seconds apiece with `pen 1`, so they queue across the windows and
     * every one of them lands its hit — collapsing them to a single arrival read a batch as worth
     * one spore when it is worth twelve. The rate cap below is what bounds *that* case: it allows a
     * strike the windows in its own recharge, and twelve fit inside 2.6 seconds.
     *
     * The rate cap is also the backstop for the ballistic case; it just cannot see simultaneity,
     * which is why the barrage slipped under it throwing three feathers at once and was scored for
     * all three.
     */
    const bodies = segmentsOf(b);
    const spreadShare = clamp(land.spread ?? 1, 1e-6, 1);
    const aimed = n * spreadShare;
    // …and a projectile whose immunity window belongs to its *type* rather than to itself (`shared`,
    // `usesIDStaticNPCImmunity`) is in the same position as one with no window of its own: the first
    // of the volley to arrive shuts the window on all the others. SOTS's Fizzle Star fires seven at
    // once on its malfunction and they queue on one window between them.
    //
    // Only for a volley that leaves the weapon in one instant, which is what a spread says: the
    // shared window is short (a few ticks once `extraUpdates` are counted) and anything spaced out
    // in *time* clears it between arrivals. Blood Bath's three beams share a window too, but they
    // are spawned 100 px apart above the player and rain down one after another — collapsing those
    // took a guide pick from 171 to 65 DPS for a window they never meet inside.
    // …and never for a weapon the player *holds* on the boss. The contact clock below already is
    // the player's window — it prices this exact fact as `60 / IMMUNITY` hits a second, with
    // `stacks` capping how many of the volley can be on separate bodies — so collapsing the volley
    // here too charges the same window twice: Last Prism's six beams came out at 1 of 4.6 arriving
    // and were then rated at 6 hits a second on that one, for a quarter of the beam it is.
    const bunched = (p?.local === undefined || (p?.shared && (spread > 0 || fan))) && !p?.homing && !CONTACT.has(arch);
    const arrivals = Math.min(aimed, bunched ? bodies : Infinity) * (land.f / spreadShare);
    /**
     * …and a thing that cannot damage an NPC lands nothing, however well it arrives. `friendly:
     * false` in `SetDefaults` with no write anywhere else is the game's own statement of that: a
     * charge marker, a bow holdout, a minion counter. It still *carries* — Perfect Star's hidden
     * star is what releases the laser — so only its own hits go, not the cascade underneath it,
     * which is why this is a factor on `own` and not on the share the children inherit.
     *
     * Only where the model can see where the damage went instead. 126 projectiles in the pool are
     * never friendly and 63 weapons fire one directly, but most of those are the shape the
     * zero-damage carrier rule already covers: SOTS's Glaze Bow is `aiStyle 20` in the player's
     * hands and its arrows come from the item, Jar of Pineapple's "Fresh Greeny Counter" is an
     * anchor that spawns the minions. Nothing was read off either, so zeroing them would trade a
     * number that is too generous for one that is certainly wrong. Children, a debuff, or a walk
     * that found no AI at all (`ownAi === false`) is what makes the zero a reading rather than a
     * gap — the same test the flat-damage carrier above turns on.
     */
    const carries = p?.friendly === false && (p.children?.length > 0 || p.debuffs?.length > 0 || p.ownAi === false);
    const landed = arrivals * hits * waste * (dmgMul ?? 1);
    // Each projectile in the group spawns its own children, so the children are counted for *one*
    // of them and multiplied back up — which is also the unit `CHILD_CAP` is written in. Adding one
    // group's worth for the whole fan is why a four-knife stealth strike got the same allowance of
    // spawned projectiles as a single throw, and it is the strikes with several projectiles that
    // the guides pick a rogue weapon for. The step ratios are unchanged by this: base and total are
    // both per projectile, so the parts still multiply out.
    // …and what this projectile spawns is spawned at *its* damage, not the weapon's: a child of a
    // half-damage bolt is worth half of the same child under a full-damage one
    const kids = childHits(ds, p, { boss: b, D, vb, arch, parentLand: land.f, variant, charged, soleCarrier: carries, base: carries ? 0 : landed / Math.max(1, n), stocked, parentId: id, threshold, cooldown, textTarget: text?.target ?? null, parentRate: useRate * n, scale: dmgMul ?? 1, useTicks: useRate > 0 ? 60 / useRate : null, parentHeld: !!p?.held || !!p?.still || carrier || CONTACT.has(arch), crit });
    // …and the zero only stands where the model can say what happened instead. `Acid Belcher`'s
    // beams, `Star Scepter`'s bolts and four more all expire before they reach the boss under the
    // landing model, so their cascade is worth nothing — zeroing the carrier on top of that took
    // six weapons to a flat 0, which is never a reading, only a gap. Where nothing was found the
    // carrier keeps the assumption it already had: one hit of the weapon's damage per use, and a
    // place in `unresolved-phases` rather than a confident nought.
    const inert = carries && kids.hits > 0.01;
    const own = inert ? 0 : landed;
    // …stated as a fact rather than as a `×0`: the chain has to go on to what it releases, and a
    // zero in front of the cascade would take the card's arithmetic to nothing while the score is
    // whatever the cascade lands. The cascade's own step carries the number instead (`soleCarrier`).
    if (inert) parts.push({ fac: 'damage', label: `${label ? `${label} ` : ''}${p?.name ?? 'what it puts out'} is never friendly: it carries what it spawns and damages nothing itself`, mul: 1 });
    const pre = label ? `${label} ` : n > 1 ? `${n}× ` : '';
    if (n > 1) parts.push({ fac: 'hits', label: `${pre}${n} projectiles per use`, mul: n });
    if (n > 1 && bunched) {
      const share = arrivals / Math.max(1e-6, n * land.f);
      if (share < 0.995) parts.push({ fac: 'target', label: `${pre}thrown together on ${p?.shared ? 'one immunity window shared by every one of them' : 'no immunity of their own'}: ${r1(Math.min(aimed, bodies))} of ${r1(aimed)} aimed get through${bodies > 1 ? ` across ${bodies} bodies` : ''}`, mul: r2(share) });
    }
    for (const x of land.parts) parts.push({ ...x, label: `${pre}${x.label}` });
    if (hp.label) parts.push({ fac: 'hits', label: `${pre}${hp.label}`, mul: r2(hp.hits) });
    if (links) parts.push({ fac: 'hits', label: `${pre}${links.label}`, mul: links.mul });
    if (dmgMul !== undefined && Math.abs(dmgMul - 1) > 0.005) parts.push({ fac: 'damage', label: `${pre}${dmgWhy ?? `${Math.round(dmgMul * 100)}% damage`}${shotMul !== 1 ? ` (×${r2(shotMul)} on every shot from ModifyShootStats)` : ''}`, mul: r2(dmgMul) });
    for (const x of kids.parts) parts.push({ ...x, label: `${pre}${x.label}` });
    // the cascade's hits were counted for one projectile of the group; every projectile spawns its own
    return {
      own, kids: n * kids.hits, spawned: kids.phases.map((k) => ({ ...k, hitsPerUse: n * k.hitsPerUse, events: n * (k.events ?? 0) })),
      // landed hit *events*, before the damage share: what an immunity window counts
      events: arrivals * hits * waste,
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
    // A flat number on a delivery is nearly always a carrier: 107 of the 111 in the pool are a
    // holdout spawned at 0 damage whose AI fires the real shots — a fact about the projectile, and
    // not one the model can price until it reads that AI's cadence. Until then it is an unread
    // delivery: one hit of the weapon's damage, said so on the record and on the card, and listed
    // by `unresolved-phases`. A flat number that is a damage is its share of the printed damage,
    // under the same ceiling a multiplier has: past it the number is evidence of something else.
    let dm;
    let dmgWhy = null;
    if (ph.dmgAbs != null && ph.dmgAbs > 1) {
      const share = ph.dmgAbs / Math.max(1, listed);
      dm = share > DMG_MUL_MAX ? 1 : share;
      // A bare number in the code is not a percentage of anything until it is said what of. `385%
      // damage` on a card is a number nobody can check; `spawned at 250 damage where the weapon
      // prints 65` is the same fact with its evidence attached.
      if (dm !== 1) dmgWhy = `${nameOf(ph.projId, ds)} is spawned at ${ph.dmgAbs} damage where the weapon prints ${listed}`;
    }
    else if (ph.dmgAbs != null) {
      // …unless there is demonstrably nothing to carry. The assumption is "its AI fires the real
      // shots and the miner could not read them", and a type that overrides no AI at all, spawns
      // no children and applies no debuffs has no unread AI: it is a held prop. Bellerose spawns
      // its umbrella that way — `aiStyle 19`, `hide`, zero damage, `SetDefaults` and nothing else —
      // and was being paid a full 57-damage hit for it 3.7 times a second, 232 of its 350 DPS.
      const inert = p?.ownAi === false && !p?.children?.length && !p?.debuffs?.length && !p?.minion && !p?.sentry;
      dm = inert ? 0 : 1;
      ph.evidence = { ...ph.evidence, carrier: !inert, gates: { ...ph.evidence?.gates, damage: inert ? 'exact' : 'assumed' } };
      parts.push(inert
        ? { fac: 'damage', label: `${nameOf(ph.projId, ds)} is spawned at ${ph.dmgAbs} damage and has no AI of its own: a prop, not a delivery`, mul: 0 }
        : { fac: 'damage', label: `${nameOf(ph.projId, ds)} is spawned at ${ph.dmgAbs} damage: a carrier whose shots the miner did not read, assumed one hit of the weapon's damage per use`, mul: 1 });
    } else dm = dmgShare(ph.dmgMul ?? 1) * shotMul;
    const g = group(p, {
      carrier: !!ph.evidence?.carrier,
      interval: ph.interval,
      maxActive: ph.maxActive,
      threshold: text?.threshold ?? null,
      cooldown: text?.cooldown ?? null,
      n: ph.count,
      spread: ph.spread,
      fan: ph.fan,
      velocity: ph.absVelocity ?? (shotVelocity ? shotVelocity * ph.velMul : null),
      // an unreadably large multiplier is evidence of a branch, not of damage: the record keeps what
      // the miner read and the reading rule is applied here, where the model can be argued with.
      // A flat number is a fact about the projectile, taken as its share of the printed damage
      // until the phases carry damage of their own; a share nobody read is the weapon's damage,
      // the same assumption as before, now stated on the record's `gates.damage`.
      dmgMul: dm,
      dmgWhy,
      id: ph.id,
    });
    const hits = g.own + g.kids;
    // a roll the miner read the odds of: the shot happens that often, rather than every time
    let roll = ph.chance > 0 && ph.chance < 1 ? ph.chance : 1;
    if (roll !== 1) parts.push({ fac: 'hits', label: `fires on a 1-in-${r1(1 / ph.chance)} roll`, mul: r2(ph.chance) });
    // …a counter the miner read: the arm that fires every Nth use, and the arm that fires the rest
    const th = ph.threshold;
    if (th?.n > 1) {
      // A charged right click costs the release use *as well as* the N successful ordinary hits
      // that filled it. A modulo branch in one click remains every N uses; only a hit-earned
      // counter on the alternate click has this N+1 action cycle. The normal attacks themselves
      // are represented by their own click rather than smuggled into the release payload.
      const chargedAlt = alt && th.event === 'hit' && th.reached;
      const share = th.reached ? 1 / (chargedAlt ? th.n + 1 : th.n) : (th.n - 1) / th.n;
      roll *= share;
      parts.push({ fac: 'hits', label: th.reached
        ? chargedAlt ? `after ${th.n} successful hits, release costs one more use` : `every ${th.n}${ordinal(th.n)} ${th.event}`
        : `${th.n - 1} of every ${th.n} ${th.event}s`, mul: r2(share) });
    }
    // …and a requirement: a buff, a flag on the mod's player, special ammo, a world seed. The
    // loadout carries none of these to the model yet, so the shot needs what the player does not
    // have — unless the branch is the one *without* it, which is the ordinary case.
    const unmet = ph.requires && (ph.requires.what === 'ammoType'
      ? (primaryId === ph.requires.id) === ph.requires.negated
      : !ph.requires.negated);
    if (unmet) {
      roll = 0;
      ph.evidence = { ...ph.evidence, gates: { ...ph.evidence?.gates, requires: 'unmet' } };
      parts.push({ fac: 'hits', label: `needs ${describeRequires(ph.requires)} the loadout does not carry`, mul: 0 });
    }
    const rolled = hits * roll;
    // what this phase alone puts on the target per use of the weapon. Kept on the record so the
    // graph can say what each phase is worth instead of only what the weapon is worth: a phase with
    // no share of the damage is a phase nobody can check. The cascade's share is on its own records.
    ph.hitsPerUse = g.own * roll;
    ph.events = g.events * roll;
    ph.share = dm ?? 1;
    ph.shared = g.shared;
    needs.push(g.needed);
    spawned.set(ph.id, g.spawned.map((k) => ({ ...k, region: ph.region, hitsPerUse: k.hitsPerUse * roll, events: (k.events ?? 0) * roll })));
    return rolled;
  };
  // alternatives of one if/else do not add up: the two arms of a named branch are two groups,
  // and an arm with no calls in it is the no-op arm nobody has represented yet
  const groups = new Map();
  for (const ph of phases) {
    if (ph.region === 'default') continue;
    const arm = ph.branch ? `${ph.region}|${ph.branch.side}` : ph.region;
    const g = groups.get(arm) ?? { hits: 0, parts: [], side: ph.branch?.side ?? null, id: ph.region, known: !!ph.branch?.known };
    const before = parts.length;
    g.hits += evaluate(ph);
    g.parts.push(...parts.splice(before));
    groups.set(arm, g);
  }
  let perUse = 0;
  const top = groups.get('top');
  if (top) { perUse += top.hits; parts.push(...top.parts); }
  // A named if/else with calls in *both* arms is one alternative, and the miner cannot read which
  // arm runs: the pessimistic reading is the weaker arm (the rule for anything unread), not a coin
  // flip that hands the rare, big arm half the weight. An arm with no calls is not represented as
  // a no-op here on purpose: the residual's one-sided guards are mostly aim, state and owner
  // checks that hold far more often than not, and zeroing them assumes the opposite.
  // ponytail: TL_ALT=avg keeps the coin flip, for measuring the two against the guides.
  const weaker = globalThis.process?.env?.TL_ALT !== 'avg'; // this file also runs in the browser, where there is no `process`
  const armed = new Map();
  for (const [k, g] of groups) {
    if (k === 'top') continue;
    const [id] = String(k).split('|');
    if (!armed.has(id)) armed.set(id, []);
    armed.get(id).push(g);
  }
  const alts = [...armed.entries()].map(([id, arms]) => {
    if (arms.length < 2) return arms[0];
    // a guard the model knows always holds for this player — the owner, the facing direction — with
    // two arms is a mirror: one of two symmetric shots fires, and either arm is the answer
    if (arms.every((g) => g.known)) {
      const [strong, weak] = [...arms].sort((a, c) => c.hits - a.hits);
      const g = { hits: strong.hits, parts: [...strong.parts], weakSide: weak.side, id: strong.id };
      g.parts.push({ fac: 'hits', label: `mirrored if/else (${String(id).replace('branch:', 'branch ')}): one of two symmetric shots`, mul: 1 });
      return g;
    }
    if (!weaker) return { hits: arms.reduce((s, g) => s + g.hits, 0) / arms.length, parts: arms.sort((a, c) => c.hits - a.hits)[0].parts, id: arms[0].id };
    const [weak, strong] = [...arms].sort((a, c) => a.hits - c.hits);
    const g = { hits: weak.hits, parts: [...weak.parts] };
    // the weaker arm's own parts already multiply out to its hits; this line only says why it is that arm
    g.parts.push({ fac: 'hits', label: `if/else nobody read (${String(id).replace('branch:', 'branch ')}): the weaker arm, ${r1(weak.hits)} of ${r1(strong.hits)} hits`, mul: 1 });
    g.weakSide = weak.side;
    g.id = weak.id;
    return g;
  }).sort((a, c) => c.hits - a.hits);
  if (alts.length) {
    perUse += alts.reduce((sum, g) => sum + g.hits, 0) / alts.length;
    // the model cannot read which branch runs, so it fires their average — and each branch is
    // therefore worth its share of one firing, not a whole one. Without this the graph claims more
    // hits than the weapon was credited with, by exactly the number of branches.
    for (const ph of [...phases, ...[...spawned.values()].flat()]) {
      if (ph.region === 'top' || ph.region === 'default' || ph.hitsPerUse == null) continue;
      // the arm not taken is worth nothing; the rest share one firing between the alternatives
      const g = alts.find((a) => a.id === ph.region);
      const f = g?.weakSide !== undefined && ph.branch && ph.branch.side !== g.weakSide ? 0 : 1 / alts.length;
      ph.hitsPerUse *= f;
      if (ph.events != null) ph.events *= f;
    }
    parts.push(...alts[0].parts);
    if (alts.length > 1) parts.push({ fac: 'hits', label: `${alts.length} alternative shots, one of them fires`, mul: r2(alts.reduce((sum, g) => sum + g.hits, 0) / alts.length / Math.max(0.01, alts[0].hits)) });
  }
  for (const ph of phases) if (ph.region === 'default') perUse += evaluate(ph);
  // each delivery followed by what it spawns, so the graph reads as the cascade it is
  const graph = phases.flatMap((ph) => [ph, ...(spawned.get(ph.id) ?? [])]);
  // what the deliveries themselves land, and what their children on a timer add: a contact weapon
  // counts the first as instances on the boss and the second as shots on their own clock
  const ownPerUse = phases.reduce((s, ph) => s + (ph.hitsPerUse ?? 0), 0);
  const timerKids = [...spawned.values()].flat().reduce((s, k) => s + (k.trigger === 'timer' ? k.hitsPerUse ?? 0 : 0), 0);
  // only when every delivery is a maintained one is the weapon cast less often than it could be
  const neededRate = needs.length && needs.every((x) => x != null) ? Math.max(...needs) : null;
  return { perUse, ownPerUse, timerKids, parts, phases: graph, primary, contact: CONTACT.has(arch) ? primary : null, sharesIframes, neededRate };
}

/**
 * Child projectiles (explosions, splits, periodic shots) as extra landed hits, each conditioned on
 * what the parent did: an on-hit child only exists if the parent hit, an on-death child that was
 * meant to explode on the boss only helps when the parent missed if the blast is big enough.
 */
/**
 * Which of a projectile's spawns do **not** happen, because a sibling on the other side of the same
 * if/else does instead.
 *
 * Two children carrying the same `branch.id` on opposite `side`s are one alternative, and the model
 * was paying for both arms: Perfect Star released its uncharged laser *and* its charged one, 100 of
 * the 171 DPS it was scoring. `variantHits` has resolved this for a weapon's own `Shoot` calls since
 * the two-clicks pass; the spawn cascade never learned it.
 *
 * Which arm runs is one of two different facts, and they take opposite rules:
 *
 *   *nobody read it* — the pessimistic answer, as everywhere else, is the weaker arm. Weighed by
 *   what the record itself states, `count × share`, which is enough to tell two arms apart without
 *   pricing either against a target.
 *
 *   *the player decides it* — a condition on the weapon's own charge counter (`branch.charge`) is
 *   not unread in the way that matters: how full that counter is, is how long the button was held.
 *   The arms are two attacks on two clocks, `charged` says which one is being priced, and the
 *   weapon is worth its better one (`weaponDps` grades both).
 *
 * 15 groups in the pool have both arms; 2 of them are charge counters.
 */
function spentArms(spawns, { charged = false, ds = null, parts = null } = {}) {
  const out = new Set();
  const byBranch = new Map();
  for (const ph of spawns) if (ph.branch) { const k = ph.branch.id; if (!byBranch.has(k)) byBranch.set(k, []); byBranch.get(k).push(ph); }
  for (const arms of byBranch.values()) {
    if (new Set(arms.map((ph) => ph.branch.side)).size < 2) continue;
    // a share nobody read weighs what the pricing below would give it, so an unread arm cannot win
    // by being unreadable
    const weight = (side) => arms.filter((ph) => ph.branch.side === side)
      .reduce((s, ph) => s + ph.count * (ph.dmgMul ?? ph.dmgAbs ?? CHILD_DMG_UNREAD), 0);
    const charge = arms.some((ph) => ph.branch.charge);
    const keep = charge ? charged : weight(true) < weight(false);
    for (const ph of arms) if (ph.branch.side !== keep) out.add(ph.id);
    const kept = arms.filter((ph) => ph.branch.side === keep);
    parts?.push({ label: charge
      ? `${charged ? 'held to charge' : 'tapped uncharged'}: ${kept.map((ph) => nameOf(ph.projId, ds)).join(', ')} on release, not the other arm of ${String(arms[0].branch.cond).split('.').pop()}`
      : `if/else nobody read (branch ${arms[0].branch.id}): the weaker arm, ${kept.map((ph) => nameOf(ph.projId, ds)).join(', ')}`, mul: 1 });
  }
  return out;
}

function childHits(ds, p, { boss: b, D, vb, arch, parentLand, variant, charged = false, soleCarrier = false, base = 0, stocked = null, depth = 0, scale = 1, parentId = null, threshold = null, cooldown = null, textTarget = null, parentRate = 0, useTicks = null, parentHeld = false, crit = 0 }) {
  const parts = [];
  // the spawn records, each carrying `hitsPerUse` — its hits per *parent projectile*, in hits of
  // the weapon's damage, the same unit `total` and `CHILD_CAP` are in
  const phases = [];
  if (!p?.children || depth > 1) return { hits: 0, parts, phases };
  let total = 0;
  // …and the hits of children whose clock the miner *did* read, which the blanket cap is not for
  let read = 0;
  const readPhases = new Set();
  // children *add* hits, so each one's share of the weapon is what it adds on top of everything
  // before it — printing every child as `×(1 + its own hits)` made a projectile with five of them
  // read as ×593 on the item card when the five together are worth `CHILD_CAP`
  // …and where the delivery itself lands nothing (`soleCarrier`: a holdout the game will not let
  // damage anything), the card is sitting at the implicit one hit per use that the cascade replaces,
  // not at zero — so the first child's step is its hits outright rather than a ratio against a 0.01
  // floor. Perfect Star's laser printed `×640` under the floor, the same shape that once printed a
  // broadsword's swing as `×364`.
  const step = (before, after) => r2((base + after) / Math.max(base + before, soleCarrier ? 1 : 0.01));
  const born = spawnPhases(p, { variant, parentId });
  const dropped = spentArms(born, { charged, ds, parts });
  for (const ph of born) {
    if (dropped.has(ph.id)) continue;
    const c = { type: ph.projId, where: ph.evidence.where };
    // it is what the weapon's other click throws: this attack is stocking it, not landing it
    if (stocked?.has(c.type)) { parts.push({ label: `${nameOf(c.type, ds)} is stocked for the other click, not damage now`, mul: 1 }); continue; }
    const cp = asStrike(proj(ds, c.type), variant);
    // …and the same fact one level down, on the same terms as the delivery above: a spawn the game
    // will not let damage anything is a marker, not a hit. Ten in the pool — blood splatters, mana
    // and heal locks, Ignis's sigil — every one of them counting as a full extra hit of the
    // weapon's damage until now.
    if (cp?.friendly === false && (cp.children?.length > 0 || cp.debuffs?.length > 0 || cp.ownAi === false)) {
      parts.push({ label: `${nameOf(c.type, ds)} is never friendly: a marker, not a hit`, mul: 1 });
      continue;
    }
    /**
     * …and what holding the button buys, where the parent states it (`charge`, read off the
     * projectile's own `SetDefaults`): more of them, each hitting harder. SOTS's Eclipse slams for
     * three crushes at 0.3× tapped and five at 7× held for its full three seconds, and none of that
     * was in the model — the crush was one unread-cadence spray at the weapon's printed damage.
     */
    const ch = p?.charge;
    const chMul = ch ? (charged ? ch.maxMul ?? ch.minMul ?? 1 : ch.minMul ?? 1) : 1;
    const n = Math.min(ch ? (charged ? ch.maxCount ?? ch.minCount ?? ph.count : ch.minCount ?? ph.count) : ph.count, 8);
    // a counter in the parent's AI, with its reset: the clock this child is spawned on
    const cadence = ph.trigger === 'timer' && ph.threshold?.event === 'tick' && ph.threshold.reset && ph.threshold.reached && ph.threshold.n > 1 ? ph.threshold.n : null;
    // a child spawned with a *number* for its damage is not this weapon's DPS — and a child spawned
    // with 0 is not damage at all. A third of the children in the pool are that: blood splatters,
    // sparkles, the bell a Thorium accessory rings on hit. They were counting as a full extra hit of
    // the parent's damage, which more than doubled 205 weapons.
    const dmg = ph.dmgMul === null ? (ph.dmgAbs === null ? CHILD_DMG_UNREAD : null) : dmgShare(ph.dmgMul);
    if (dmg === null) continue;
    // A timer child with a hit cooldown of *its own*, kept up by a weapon the player **holds**, is
    // not a spray whose cadence nobody read: it is a beam standing in the boss for as long as the
    // weapon is out, and it hits on its own clock exactly as the held parent does. All `n` of them
    // are up at once, so neither the `/ n` below (which says one of them lands between them) nor
    // the two-hit ceiling on a fly-past applies. Yharim's Crystal maintains six beams at 10 ticks
    // apiece — 36 hits a second — and was paid 5.7 for the six of them together.
    const maintained = ph.trigger === 'timer' && !cadence && parentHeld && cp?.local > 0 && cp.life == null && useTicks > 0;
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
      // — unless the AI's counter was read with its reset, which is that timer
      // …and a beam the weapon *keeps up* is not a stray shot the parent sprayed at 8 px/tick: it is
      // pointed where the weapon is pointed, for as long as it is held there, so what it lands is
      // what the parent lands. Flying it to the boss on the spray assumption charged Yharim's beams
      // a second travel penalty on top of the prism's own.
      const land = landing(cp, { D: Math.min(D, 200), boss: b, velocity: 8, vb });
      // …and the payload a *charge* weapon releases is not a spray on a clock nobody read either:
      // the parent states its own cycle (`charge.ticks + charge.release`), the model fires it on
      // that cycle, and what comes out lands where the weapon was pointed, like a death spawn.
      reachShare = maintained || ch ? clamp(parentLand, 0, 1) : cadence ? land.f : land.f / Math.max(1, n);
    }
    if (reachShare <= 0) continue;
    // A blast goes off where the parent died and stays there. It does not fly through anything, so
    // the crossing time a travelling projectile is charged for is the wrong clock: what it gets is
    // one hit, or — if it sets a cooldown of its own, which is how a lingering cloud or an acid
    // pool says it keeps ticking — one hit per cooldown for as long as it lasts, for the share of
    // that the boss is still standing in a thing that cannot follow it (`LINGER_ON_TARGET`).
    // …and one that disarms itself on contact does not linger at all, however long it lives
    const lingers = cp?.local > 0 && !cp.spent;
    let hits;
    let lingered = 0;
    if (ph.trigger === 'death') {
      const cap = cp?.pen === -1 ? Infinity : Math.max(1, cp?.pen ?? 1);
      lingered = lingers ? (LINGER_ON_TARGET * Math.min(cp.life ?? 0, STUCK_TICKS)) / cp.local : 0;
      hits = Math.min(cap, 1 + lingered);
    } else if (maintained) {
      // its own clock, counted in the unit this function works in: hits per use of the weapon — and
      // in a crowd, once per body the beam is laid through, because each body carries its own copy
      // of that clock and a beam that pierces is in all of them at once. This is what infinite
      // pierce *is*, and a weapon whose damage is all in its beams was getting none of it: Yharim's
      // Crystal read the same against a Destroyer as against a single target.
      const bodies = cp.pen === -1 || cp.pen > 1 ? Math.min(segmentsOf(b), cp.pen === -1 ? Infinity : cp.pen) : 1;
      hits = (useTicks / cp.local) * bodies;
    } else {
      hits = Math.min(hitsPerProjectile(cp, { boss: b, velocity: 8, arch: 'shot' }).hits, 2);
    }
    // a spawn behind a roll the miner priced happens that often, not on every parent event
    const roll = ph.chance > 0 && ph.chance < 1 ? ph.chance : 1;
    // …and one behind a counter happens once per that many of the counter's events — hits, deaths
    // or uses, as the method it was read in says. A counter in the AI is the timer above instead.
    // The tooltip's counter is the fallback, and only for the one child the text can be about
    // (`textTarget`): sprayed over every child it gated the ordinary explosion along with the burst.
    // ponytail: a share is not a miss probability, so "in a row" is read as "N hits"; the
    // run-completion form would need a per-shot landing chance the model does not have.
    let every = 1;
    const mined = ph.threshold;
    if (mined?.n > 1 && mined.event !== 'tick') every = mined.reached ? mined.n : mined.n / (mined.n - 1);
    else if (!mined && depth === 0 && threshold > 1 && c.type === textTarget && (ph.trigger === 'hit' || ph.trigger === 'death')) { every = threshold; ph.threshold = { n: threshold, event: 'hit', reset: true, reached: true, from: 'text' }; ph.confidence = 'text'; ph.evidence = { ...ph.evidence, gates: { ...ph.evidence?.gates, threshold: 'text' } }; }
    // …one on a stated cooldown fires at most that often, however fast the parent lands:
    // activations per parent projectile can be no more than `60 / cooldown` per second of them
    let gate = roll / every;
    if (!mined && depth === 0 && cooldown > 0 && parentRate > 0 && c.type === textTarget && (ph.trigger === 'hit' || ph.trigger === 'death')) {
      const most = 60 / (cooldown * parentRate);
      if (most < gate) { gate = most; ph.cooldown = cooldown; ph.confidence = 'text'; }
    }
    // …one only on a crit is the crit chance's worth of them
    if (ph.crit !== null) gate *= ph.crit ? crit : 1 - crit;
    // …and one behind a requirement the loadout does not carry does not happen
    if (ph.requires && !ph.requires.negated) { parts.push({ label: `${nameOf(c.type, ds)} needs ${describeRequires(ph.requires, ds)} the loadout does not carry`, mul: 1 }); ph.evidence = { ...ph.evidence, gates: { ...ph.evidence?.gates, requires: 'unmet' } }; phases.push({ ...ph, hitsPerUse: 0, events: 0, share: scale * dmg, shared: cp?.local === undefined }); continue; }
    // how many of it one parent spawns: once, or — with the AI's clock read — once per tick of that
    // clock for as long as the parent is there: a held or placed parent for the use, a flying one
    // for its life
    const spawns = cadence ? Math.max(1, (parentHeld ? useTicks ?? 60 : Math.min(p.life ?? LIFE_UNKNOWN, SPAWN_WINDOW)) / cadence) : 1;
    // A beam that scales its own damage the longer it is out (, read off the AI) reaches the
    // top of its ramp for a weapon that *keeps* it there and nowhere else — which is the projectile
    // this branch is about. Yharim's Crystal charges its beams to three times the printed number over
    // 180 ticks, and the record carries the middle of that.
    const rampMul = maintained && cp?.ramp > 1 ? cp.ramp : 1;
    const own = scale * n * spawns * reachShare * hits * dmg * gate * rampMul * chMul;
    if (own <= 0.01) continue;
    parts.push({ label: `${n > 1 ? `${n}× ` : ''}${nameOf(c.type, ds)} ${ch ? `released ${charged ? `after the full ${r1(ch.ticks / 60)} s charge` : 'the moment it may be'}${chMul !== 1 ? ` at ${Math.round(chMul * 100)}% damage` : ''}` : maintained ? `kept up while the weapon is out, hitting every ${cp.local} ticks` : CHILD_WHERE[c.where] ?? ''}${cadence ? ` every ${cadence} ticks (${r1(spawns)} per ${parentHeld ? 'use' : 'flight'})` : ''}${roll < 1 ? ` on a 1-in-${r1(1 / roll)} roll` : ''}${every > 1 ? `, once per ${r1(every)} ${mined?.event ?? 'landed hit'}s` : every < 1 ? `, ${mined.n - 1} of every ${mined.n} ${mined.event}s` : ''}${ph.crit !== null ? (ph.crit ? ' on a crit' : ' on a non-crit') : ''}${ph.cooldown ? `, at most once per ${r1(ph.cooldown / 60)} s` : ''}${lingered > 0.05 ? `, lingering for ${r1(lingered)} more hits (${Math.round(LINGER_ON_TARGET * 100)}% of its ${Math.round(Math.min(cp.life ?? 0, STUCK_TICKS) / cp.local)} ticks: it stays where it went off and the boss does not)` : ''} (+${r1(own)} hits at ${Math.round(scale * dmg * rampMul * 100)}%${rampMul > 1 ? `, charged` : ``})`, mul: step(total + read, total + read + own) });
    /**
     * …and so does the release of a weapon that does nothing else.
     *
     * `CHILD_CAP` is a ceiling on what "the children of one projectile are worth", and it names what
     * it stands in for: the miner reads what a child does and how hard it hits, *not how often it
     * may spawn*. Both halves of that have to fail before it stops applying.
     *
     * A child spawned on the parent's **death** has no unread spawn rate — the parent dies once and
     * the child comes out once. And where the delivery itself lands nothing (`soleCarrier`), the
     * cascade is not an unread bonus hanging off a shot that already hits: it *is* the shot, so the
     * ceiling stops bounding a cascade and starts bounding the weapon. Perfect Star's whole attack
     * is the laser released when the star dies, and 1.5 hits a use was a ×0.23 on everything it
     * does, standing in for a spawn rate that was never in doubt.
     *
     * Both conditions, deliberately. Letting *every* death child out of the cap was measured and is
     * far too much — 84 weapons up, Refraction Rotor ×5.2, Seraphim ×4.1 — because for a weapon
     * whose delivery hits on its own, the cap is also the only thing bounding the
     * `1 + STUCK_TICKS / local` lingering estimate on each child. Vorpal Knife is the clearest:
     * its two death spawns are 10.4 and 7.6 hits at ×200 % damage, and uncapped that is 671 of the
     * 702/s it reads. An on-hit splitter stays under the cap in every case — that one really can
     * carry a spawn cooldown nobody read.
     */
    if (cadence || maintained || ch || (soleCarrier && ph.trigger === 'death')) { read += own; readPhases.add(ph.id); } else total += own;
    // the record carries its hit events and its share of the weapon's damage apart, so the model
    // can price the two separately: the window caps events, the defense comes off the share
    phases.push({ ...ph, hitsPerUse: own, events: n * spawns * reachShare * hits * gate, share: scale * dmg * rampMul, shared: cp?.local === undefined });
    // What this child in turn spawns. `scale` carries down everything already paid to get here —
    // how many of the parent there are, how often it arrives, and what share of the weapon's damage
    // it does — because a grandchild is worth its own share *of that*, not of the whole weapon.
    // Without it the acid a Contaminated Bile's blast leaves behind was priced at half the weapon's
    // damage rather than a fifth, and its hits were added to the total with no part accounting for
    // them at all, so the stealth strike's factors stopped multiplying out to its own score.
    const deeper = childHits(ds, cp, { boss: b, D, vb, arch, parentLand: reachShare, variant, charged, base: base + total + read, stocked, depth: depth + 1, scale: scale * n * spawns * reachShare * dmg, parentId: ph.id, crit });
    parts.push(...deeper.parts);
    phases.push(...deeper.phases);
    total += deeper.hits;
  }
  if (total > CHILD_CAP) {
    parts.push({ label: `spawned projectiles capped at +${CHILD_CAP} hits (spawn rate unread)`, mul: step(total + read, CHILD_CAP + read) });
    // the cap is a ceiling on the cascade as a whole, so every phase in it keeps its share of it —
    // every phase whose clock was not read, that is: a read clock is a number, not a guess
    for (const ph of phases) if (!readPhases.has(ph.id)) { ph.hitsPerUse *= CHILD_CAP / total; ph.events = (ph.events ?? 0) * (CHILD_CAP / total); }
    total = CHILD_CAP;
  }
  // a child projectile is extra hits, whatever it is called
  return { hits: total + read, parts: parts.map((x) => ({ fac: 'hits', ...x })), phases };
}

/**
 * What to call a projectile or a buff. A vanilla one is only ever a number in the code — `v:521` is
 * the Crystal Serpent's shot — so the name has to come off the dataset record the miner named from
 * the game's own `ProjectileName` strings. The camel-case fallback is for a mod id, whose class
 * name is already in it, and for a record the dataset does not carry.
 */
const nameOf = (id, ds = null) => ds?.projectiles?.[id]?.name ?? ds?.debuffs?.[id]?.name
  ?? String(id).split(':').pop().replace(/([a-z])([A-Z])/g, '$1 $2').replace(/Proj(ectile)?$/, '').trim();
const ordinal = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');
/** A requirement as the card names it. */
const describeRequires = (q, ds = null) => (q.what === 'buff' ? `the ${nameOf(q.id ?? 'buff', ds)} buff` : q.what === 'ammo' ? 'special ammo' : q.what === 'ammoType' ? `${q.negated ? 'ammo other than' : ''} ${nameOf(q.id, ds)} ammo`.trim() : q.what === 'world' ? `a ${String(q.id).replace(/World$/, '')} world` : q.what === 'gear' ? `the ${String(q.id).replace(/^(acc|set)/, '').replace(/([a-z])([A-Z])/g, '$1 $2')} ${String(q.id).startsWith('set') ? 'set bonus' : 'accessory'}` : `${String(q.id ?? 'a flag').split('.').pop()}`);
/** A projectile id as the item card names it. */
export const projName = nameOf;

/**
 * Calamity's stealth strike damage bonus for a weapon at full stealth, as `1 + the bonus`.
 *
 * `CalamityPlayer.ProvideStealthStatBonuses`, line for line:
 *
 *   gen        = 0.8 × stealthGenMoving + 0.2 × stealthGenStandstill   (both 1 by default;
 *                `accStealthGenBoost` — a Silent reforge, a stealth accessory — adds to each)
 *   timeFactor = 0.75 + 0.75 × log₄(max(useTime, useAnimation) + 2)
 *   genFactor  = max((BaseStealthGenTime / gen) ^ ⅔, 1.5)
 *   bonus      = rogueStealth × UniversalStealthStrikeDamageFactor × timeFactor × genFactor
 *
 * `gen` is the *field*, not the rate: `MovingStealthGenRatio` is applied in
 * `UpdateStealthGenStats`, not here, so at defaults `genFactor` is 4^⅔ and not (4/0.6)^⅔. That was
 * back-solved from four in-game readings before the IL was read, and the IL agrees with it — what
 * the IL adds is the `max(…, 1.5)` floor, the constant instead of the literal 4, and the fact that
 * a stealth-gen boost makes strikes *weaker*, which is the trade the accessory is making.
 *
 * The miner does not read `accStealthGenBoost` off a loadout, so `gen` stands at its default.
 */
export function stealthMultiplier(useTime, stealthMax = STEALTH_MAX_DEFAULT, ds = null, gen = 1) {
  const c = stealthConsts(ds);
  const timeFactor = 0.75 + 0.75 * (Math.log(Math.max(1, useTime) + 2) / Math.log(4));
  const genFactor = Math.max(Math.pow(c.genTime / Math.max(0.01, gen), 2 / 3), 1.5);
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
  // A target that does not move does not have to be led. `still` is what a target dummy is for —
  // it isolates the hit clock from the landing — and it was being charged a boss's full speed, so
  // every `observed.mjs` trial taken on a dummy was compared against a model paying travel lead
  // the trial never paid. No stage boss carries the flag, so nothing else moves.
  const vb = b.still ? 0 : bossSpeed(b.progression ?? ds?.stages?.[ctx.stage ?? 0]?.progression);
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
  if (buff !== 1) parts.push({ fac: 'damage', label: `+${Math.round((buff - 1) * 100)}% ${cls}${sub?.damage ? ` and ${item.subclass}` : ''} damage ${ctx.loadout ? 'from the standard loadout at this stage' : `a ${stageLabel} loadout carries`}`, mul: r2(buff) });

  // The ammo names the projectile for a gun or a bow — the arrow is what flies. A flamethrower is
  // the other shape: `useAmmo` is Gel, which is consumed and fires nothing, and the flame is the
  // weapon's own `shoot`. Reading the ammo's projectile as the only answer threw that away whenever
  // the ammo did not resolve, and 35 weapons — most of the flamethrowers, a third of the launchers —
  // were graded with no projectile at all: no pierce, no lifetime, no homing, nothing.
  // …and a bow that turns the plain ammo into its own projectile fires that: The Bee's Knees
  // fires Bee Arrows from Wooden Arrows, which is on neither the item nor the ammo
  const shotId = (isAmmo ? ammo?.shoot : null) ?? item.shoot ?? null;
  const primaryId = item.ammoSwap && shotId === item.ammoSwap.from ? item.ammoSwap.to : shotId;
  const primary = proj(ds, primaryId);

  // ---- debuffs the boss is not immune to: DoT on top, defense debuffs off its armour
  // …from everything the weapon puts on the target: its shot, what its calls fire, and what those
  // spawn two generations down — a debuff only the child carries was not being seen at all
  const debuffSources = [];
  const seenSrc = new Set();
  const addSrc = (p, depth) => {
    if (!p || seenSrc.has(p)) return;
    seenSrc.add(p);
    debuffSources.push(p);
    if (depth < 2) for (const c of p.children ?? []) addSrc(proj(ds, c.type), depth + 1);
  };
  for (const p of [primary, ...(item.fire?.calls ?? []).map((c) => proj(ds, c.type === 'shoot' ? primaryId : c.type))]) addSrc(p, 0);
  const debuffs = debuffPhases(debuffSources);
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

  // ---- armour: the weapon's own and the loadout's reach every phase; a projectile's own is its
  const basePen = (item.armorPen ?? 0) + (ctx.loadout?.armorPen ?? 0);
  const armorPen = basePen + (primary?.armorPen ?? 0);
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
      // …unless the AI's clock was read: then the minion fires once per tick of it, for as long as
      // it is out — the same child path every weapon's spawns go through, at one "use" a second
      if (ranged.every((ph) => ph.threshold?.event === 'tick' && ph.threshold.reset && ph.threshold.reached)) {
        const kids = childHits(ds, primary, { boss: b, D: 200, vb, arch, parentLand: 1, variant: 'spam', useTicks: 60, parentHeld: true, parentRate: 1 });
        if (kids.hits > 0) { hps = kids.hits; parts.push(...kids.parts); }
      }
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
      // the minion is what puts the debuff on the target, so the debuff hangs off it, not off the root
      phases: [{ ...summon, hitsSec: r2(hps), contribution: r1(value - dot * dotOn) }, ...debuffs.map((ph) => ({ ...ph, parent: summon.id, contribution: r1((ph.dot ?? 0) * dotOn) }))] };
  }
  if (cls === 'summon' && !primary && !item.shoot) return { value: hit, kind: 'per hit', mode: null, dps: null, rate: null, critMult: 1, eff, parts, hit, boss: b, arch };

  // ---- rate
  const ut = eff.useTime || eff.useAnimation || 0;
  const ua = eff.useAnimation || eff.useTime || 0;
  // A charge weapon's clock is not its use time. `windup` says the projectile switches its own
  // `friendly` on partway through its life: it is out on the player, harmless, while the button is
  // held, and the AI pins `itemTime` there so the use time never comes round. Reading the use time
  // as the clock had Gel Glove throwing 3.3 fully-armed balls a second when a charge takes a second
  // on its own.
  // ponytail: a flat wind-up. The counter's cap is in the AI (`Charge >= 120`, at `extraUpdates`
  // speed) but the interpreter walks linearly and never folds it; read it to make this per-weapon.
  const windup = primary?.windup ? WINDUP_TICKS : 0;
  const time = Math.max(ut, ua) + (item.reuseDelay ?? 0) + windup;
  if (!time) return { value: hit, kind: 'per hit', mode: null, dps: null, rate: null, critMult: 1, eff, parts, hit, boss: b, arch };
  const trueMelee = !item.noMelee && (arch === 'swing' || arch === 'shortsword');
  // the root of the graph: the clock every other phase hangs off
  const graph = [primaryPhase({ useTicks: time, maxActive: item.maxOut ?? null, projId: primaryId })];
  const perAnim = Math.min(item.useLimit ?? Infinity, !trueMelee && ut > 0 && ua > ut * 1.5 ? Math.max(1, Math.round(ua / ut)) : 1);
  const baseRate = (60 * perAnim) / time;
  /**
   * Does this weapon's payload sit behind a charge counter, with a spawn on *both* sides of it? One
   * side only is an ordinary gate — a bonus for charging, or a penalty for not — and the model
   * already prices those. Both sides is a fork the player chooses by how long they hold the button,
   * and it is what `best('spam', true)` further down grades as a loop of its own.
   */
  const chargeArms = [primary, ...(item.fire?.calls ?? []).map((c) => proj(ds, c.type === 'shoot' ? primaryId : c.type))]
    .some((p) => {
      // …or the projectile simply says so, in its own numbers: a `charge` record is a weapon that
      // states how long it winds up for and what the wind-up buys, which is the same fork without
      // an if/else to find it in.
      if (p?.charge) return true;
      const sides = new Map();
      for (const c of p?.children ?? []) if (c.branch?.charge) { const k = c.branch.id; if (!sides.has(k)) sides.set(k, new Set()); sides.get(k).add(c.branch.side); }
      return [...sides.values()].some((s) => s.size > 1);
    });
  /**
   * Tapping the weapon, and holding it to charge — two rates, for the weapons that have two attacks.
   *
   * The tap rate is `CLICK_CPS` for one shape only: a **charge** weapon whose holdout writes
   * `player.itemTime` every tick (`pinsUse`). There the use animation never comes round while the
   * button is down, so `useTime` is a charge *step* and states nothing about cadence — Perfect
   * Star's 30 ticks are one of its three charge levels — and what bounds the next release is the
   * hand on the mouse.
   *
   * Scoping that to the charge fork is the whole of it, and both halves of the scope are load
   * bearing. `pinsUse` alone is just how any holdout works — 298 projectiles, every drill, spear
   * and beam — and reading it as "may be re-clicked at 7.5/s" put 211 weapons up by as much as
   * ×8.7 (Supernova 6821 → 59439/s) for a weapon that is simply held down.
   *
   * And a bare `min(CLICK_CPS, baseRate)` on everything else is worse than useless. It binds on
   * three weapons in the pool, and on a *contact* weapon it is a free lunch: the damage is priced
   * on the projectile's own hit clock while only the resource bill is priced on the cast rate, so
   * assuming the player clicks more slowly cuts the mana and keeps the hits. Chronomancer's Scythe
   * went **up**, 502 → 716/s, for being clicked less. So the use time stands everywhere the charge
   * fork does not, and how fast a hand can go is not modelled where it does not decide anything.
   */
  // …and a charge weapon that names its own recovery cannot be tapped faster than that: SOTS's
  // Eclipse takes 150 ticks to finish its slam whether or not you charged it.
  const tapRate = chargeArms && primary?.pinsUse
    ? Math.min(CLICK_CPS, primary.charge?.release > 0 ? 60 / primary.charge.release : Infinity)
    : baseRate;
  // …and holding it to full costs the wind-up, which the same `pinsUse` says is the *whole* wait:
  // the animation is not also being served. `WINDUP_TICKS` stands in for the counter's own cap
  // until the interpreter folds it (see the knob registry), and standing in generously here is the
  // conservative direction — it can only make the charge arm look better than it is.
  // …and where the projectile states the wind-up itself, that is the number and `WINDUP_TICKS` is
  // not consulted at all — the knob's own registry entry says it retires on exactly this read.
  const chargeRate = primary?.charge
    ? 60 / (primary.charge.ticks + (primary.charge.release ?? 0))
    : 60 / ((primary?.pinsUse ? 0 : time) + WINDUP_TICKS);
  /**
   * …and the cooldown the weapon keeps on itself, in seconds. A weapon whose alternate attack is an
   * ultimate on a cooldown — Stars Above builds most of its arsenal this way — fires it once per
   * that cooldown, not once per use time: Sanguine Despair's Surging Vampirism is 250% damage every
   * 30 seconds, and grading it at two a second made the ultimate the weapon's *sustained* attack and
   * then let `best` pick it over the left click it is supposed to punctuate.
   *
   * `item.altCooldown` / `item.cooldown` are mined — the buff `CanUseItem` refuses on, and how long
   * the use puts it on for — and the tooltip's own prose stands in where the code gave nothing.
   */
  const clickRate = (alt, charged = false) => {
    // a cooldown on the weapon itself gates both clicks; the alt one only the right. The tooltip's
    // `stats.cooldown` is deliberately not read here — it is any "N second cooldown" the text
    // mentions, usually a proc's rate, and only the right-click line names a click.
    const cd = Math.max(item.cooldown ?? 0, alt ? item.altCooldown ?? item.stats?.altCooldown ?? 0 : 0);
    const r = charged ? chargeRate : tapRate;
    return cd > 0 ? Math.min(r, 1 / cd) : r;
  };
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
  // …and a weapon can spend out of two of them at once — Sanguine Despair costs 25 mana *and* ten
  // health a cast — so they are all priced and the tightest one governs. The player casts as often
  // as the pool that runs out first allows; the others then cost proportionally less, which is why
  // this is the smallest sustain and not their product.
  const pools = [
    item.mana > 0 && (cls === 'magic' || cls === 'healer' || cls === 'bard')
      ? { name: 'mana', cost: eff.mana, regen: manaRegen(prog), cap: manaCap(prog), floor: MANA_FLOOR, potion: { income: potionMana(prog), sickness: cls === 'magic' ? MANA_SICKNESS : 0 } }
      : null,
    // …and the right click is charged what *it* costs: Blink Blade's blink is a 300 % slash at
    // triple the void, and pricing the alt attack at the left click's cost sold the damage without
    // the bar it comes out of.
    cls === 'void' && item.voidCost > 0
      ? {
        name: 'void',
        cost: item.voidCost,
        altCost: item.altVoidCost ?? null,
        // …plus what the loadout carries, which is the whole point of a void accessory
        regen: voidRegen(prog) * (1 + (ctx.loadout?.voidRegen ?? 0)),
        cap: VOID_BAR + (ctx.loadout?.voidMax ?? 0),
        floor: VOID_FLOOR,
      }
      : null,
    item.lifeCost > 0 ? { name: 'health', cost: item.lifeCost, regen: lifeRegen(prog), floor: LIFE_FLOOR } : null,
    // ponytail: the shot's cost only. Gel Glove burns another 14 per 5 ticks while it charges,
    // which nothing else does — read the drain out of the AI if a second weapon ever needs it.
    item.exhaust ? { name: 'exhaustion', cost: Math.max(1, ut) * 2, regen: EXHAUSTION_REGEN, cap: EXHAUSTION_CAP, floor: SUSTAIN_FLOOR } : null,
  ].filter(Boolean);
  /**
   * What share of its full rate a pool lets the weapon keep up. `regen / spend` is the steady
   * state, and for mana it is the whole story — a bar that holds two casts is not a reservoir.
   *
   * A pool that states a `cap` is one, and pricing it as a rate alone is what made Thorium's
   * exhaustion a flat halving of the whole class. The bar holds 1200 and a spammed thrower
   * overdraws it by 60 a second, so the first twenty seconds are *free* and the penalty has not
   * happened yet. Over a fight of `FIGHT_SECONDS` the average is the reservoir plus what came back,
   * against what was spent — 0.5 in the limit, 1 for anything short enough.
   */
  /** what one use of this click costs out of the pool */
  const poolCost = (p, alt) => (alt && p.altCost ? p.altCost : p.cost);
  /** How much of the time this pool is being topped up with potions, 0 to 1. */
  const poolDrinks = (p, castRate, alt) => (p.potion ? clamp((Math.max(0.01, poolCost(p, alt) * castRate) - p.regen) / p.potion.income, 0, 1) : 0);
  const poolSustain = (p, castRate, alt) => {
    const spend = Math.max(0.01, poolCost(p, alt) * castRate);
    // …and a pool with a *potion* has a second income, which the player reaches for exactly when the
    // regeneration alone stops covering the weapon. It is not free: the sickness that follows is a
    // damage penalty for the rest of the fight, and it is the honest shape of "you can hold this,
    // just for a little less".
    // …and how often, which is what the sickness is proportional to: a weapon a hair over the
    // regeneration reaches for a potion once in a while and is barely ever under the debuff, one at
    // five times it is under the debuff for the whole fight. A cliff at `spend > regen` charged the
    // first the same as the second.
    const drinks = poolDrinks(p, castRate, alt);
    const regen = p.regen + drinks * (p.potion?.income ?? 0);
    const share = p.cap ? (p.cap + regen * FIGHT_SECONDS) / (spend * FIGHT_SECONDS) : regen / spend;
    return clamp(share, p.floor, 1) * (1 - drinks * (p.potion?.sickness ?? 0));
  };
  /** the pool that binds at this cast rate, and nothing where the weapon is free to swing */
  const poolAt = (castRate, alt) => pools.reduce((worst, p) => (!worst || poolSustain(p, castRate, alt) < poolSustain(worst, castRate, alt) ? p : worst), null);
  const sustainAt = (castRate, alt) => { const p = poolAt(castRate, alt); return p ? poolSustain(p, castRate, alt) : 1; };

  const fire = item.fire ?? null;
  const base = { primaryId, shootSpeed: item.shootSpeed ?? null };
  // the gates the tooltip states, for the clocks and counters the interpreter could not follow
  const text = item.tooltip ? textGates(item.tooltip) : null;
  // The text's counter or cooldown belongs to one child, and the model has to be able to say
  // which: the only on-hit or on-death child there is, else the only burst (a count above one)
  // among them. Anything else is ambiguous, attaches to nothing, and is listed as unresolved.
  if (text && (text.threshold || text.cooldown)) {
    const kids = [primary, ...(item.fire?.calls ?? []).map((c) => proj(ds, c.type === 'shoot' ? primaryId : c.type))].filter(Boolean)
      .flatMap((p) => (p.children ?? []).filter((c) => (c.where === 'hit' || c.where === 'kill') && !c.threshold));
    const types = [...new Set(kids.map((c) => c.type))];
    const bursts = types.filter((t) => kids.some((c) => c.type === t && (c.count ?? 1) > 1));
    text.target = types.length === 1 ? types[0] : bursts.length === 1 ? bursts[0] : null;
    if (!text.target) { text.ambiguous = { threshold: text.threshold, cooldown: text.cooldown }; text.threshold = null; text.cooldown = null; }
  }
  // How far in the weapon makes the player come: as far as its shot actually carries, no further.
  // The player then stands at that edge and pays the range band for it — walking in to half the
  // reach instead (which is what a player really does, and would cancel the band) was measured and
  // costs 3 top-8 against the guides, because it promotes short-ranged weapons neither guide names.
  // …measured exactly the way `landing` measures it, against the same target: a different drop
  // tolerance here (and ignoring the velocity a stealth strike throws at) walked the player to a
  // distance the shot was then told it could not cover, for a flat ×0. `landing` allows the boss's
  // half-height; anything else is the model disagreeing with itself.
  const closeIn = (velMul = 1) => (primary && flies(arch, cls)
    ? Math.min(turnsRoundAt(arch), reachOf(primary, flightSpeed((item.shootSpeed || SHOOT_SPEED_UNKNOWN) * velMul), b.h / 2))
    : Infinity);

  const shoots = !!primaryId || !!fire?.calls?.length || isAmmo;
  /**
   * Does this weapon's damage live in beams it keeps up rather than in the thing it holds? The same
   * shape `childHits` prices on its own clock: a child spawned by the AI of a held projectile, with
   * an immunity window of its own and no lifetime, is a beam maintained for as long as the button
   * is down. A prism is that, and its reach is the beam's rather than the holdout's.
   */
  const keepsBeams = CONTACT.has(arch) && !!primary?.held && (primary.children ?? []).some((c) => {
    const cp = proj(ds, c.type);
    return c.where === 'ai' && cp?.local > 0 && cp.life == null;
  });
  // a blade walks the player in to where it reaches, like a short throw does: `REACH` is the
  // archetype's reach, the item's `scale` is this blade's
  const bladeReach = (REACH[arch] ?? REACH.swing) * (item.scale ?? 1);
  /**
   * One grade of the weapon (spam / stealth) on one click, at its own engagement distance. A sword
   * that also fires has two stances — in close, where the blade connects, or back at the shot's
   * range, where it does not and the risk is not paid either — and `best` takes the better.
   */
  const variant = (name, alt = false, stance = 'close', charged = false) => {
    const rate = clickRate(alt, charged);
    const vparts = [];
    const vphases = [];
    // the two rogue grades are their own playstyle; every other class keeps the one it was given
    const rogue = cls === 'rogue' || cls === 'thrower';
    const style = rogue ? { ...ctx.playstyle, [cls]: name } : ctx.playstyle;
    const prefer = preferredRange(cls, style);
    // …and a weapon whose damage is in the beams it *keeps up* is not limited by the archetype's
    // reach: `REACH.held` is how far a wall of thorns extends, and what a prism throws is a beam
    // across the room. The player stands where the class wants to stand and pays no risk for it,
    // which is the honest reading of "there is no range problem with this weapon" — the holdout in
    // your hands is not what has to reach the boss.
    const want = keepsBeams ? prefer : engagement(cls, arch, style);
    // A player does not stand where their weapon cannot reach — they walk in, and pay for standing
    // there. So the class's preferred distance is the *most* they keep, never a reason to score a
    // short-ranged weapon at zero. Half the reach, so the shot still arrives with life left for the
    // hits the pierce model counts on.
    const reach = closeIn((name === 'stealth' && fire?.stealthMods?.velMul) || fire?.velMul || 1);
    const D = clamp(Math.min(want, reach, trueMelee && stance === 'close' ? bladeReach : Infinity), MIN_ENGAGE, want);
    // Work out the physical blade first so a zero-launch custom image can share its reach rather
    // than borrowing a projectile's flight/pierce assumptions.
    const swing = trueMelee ? swingPhase({ swingTicks: ua + (item.reuseDelay ?? 0), scale: item.scale ?? 1 }) : null;
    const blade = swing ? bladeLanding({ D, boss: b, vb, reach: bladeReach, ticks: ua }) : null;
    if (blade) swing.evidence = { ...swing.evidence, reach: bladeReach };
    const v = shoots ? variantHits(item, ds, fire, name, base, { boss: b, D, vb, arch, cls, alt, charged, rate, text, listed, crit: Math.min(100, critChance) / 100, attachedLanding: blade?.f ?? null }) : null;
    // the casts the cycle actually needs: a maintained phase is recast only as its links lapse
    const castRate = v?.neededRate != null ? Math.min(rate, v.neededRate) : rate;
    const sustain = sustainAt(castRate, alt);
    if (v?.phases) vphases.push(...v.phases);
    let perUse = v ? v.perUse : 0;
    // the swing itself: one hit per animation, at the reach the item's size buys — on the
    // animation's clock, which is not always the clock what it fires comes off
    if (swing) vphases.push(swing);
    const bladeContact = swing ? bladeCoverage(bladeReach) : 0;
    let swingHps = swing ? swingRate * bladeContact * blade.f : 0;
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
    // …and a holdout that is never friendly is not a contact weapon at all, however long it is held
    // there: nothing it touches takes damage. What such a weapon does, it does on release, so its
    // clock is the use clock below and not the immunity window. Perfect Star's hidden star was being
    // rated at 6 hits a second in the boss for a projectile the game will not let hit anything.
    if (CONTACT.has(arch) && v?.contact && !(v.contact.local < 0) && v.contact.friendly !== false) {
      // the projectile's own hit cooldown is the rate: how often it may hit the same target while
      // the player keeps it there. The pass-through pierce count does not apply to something
      // already in contact.
      const held = contactPhase(v.contact, arch, { projId: primaryId, maxActive: item.maxOut ?? null, channel: !!item.channel });
      // …and it is the *clock* of the delivery above it, not an attack of its own. Pushed as a phase
      // of its own it drew a second node for the same beam — "Held Beam", contributing `nothing`,
      // because the hits it prices are counted on the delivery that spawned them. Where that
      // delivery is in the graph the clock lands on it instead, which is also the more honest kind
      // for it: a beam is held on the boss, it does not travel to it.
      const carrier = vphases.find((ph) => ph.projId === primaryId && ph.hitsPerUse > 0);
      if (carrier) Object.assign(carrier, { kind: 'contact', cooldown: held.cooldown, maxActive: held.maxActive ?? carrier.maxActive, evidence: { ...held.evidence, ...carrier.evidence } });
      else vphases.push(held);
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
      // …counted on the deliveries alone. What a hit or a death sets off scales with the contact
      // rate like it always did; what the projectile fires *while it is out* is on its own clock,
      // read off the AI (`timerKids`), and a yoyo spraying water every 15 ticks is not four yoyos.
      const ownUse = v.ownPerUse ?? perUse;
      const timer = v.timerKids ?? 0;
      const event = Math.max(0, perUse - ownUse - timer);
      // A piercing beam is physically on every body of a crowd at once, and giving it a clock per
      // body (`stacks × segmentsOf(b)`, the same pierce the shot path pays for) was tried here and
      // measured worse against the guides: Vilethorn 16 → 96 in a crowd, ieor and vanilla magic both
      // down, for a claim the guides do not make. What it keeps is only the crowd not being a *cost*.
      const stacks = own ? clamp(ownUse, 0, capN) : Math.min(clamp(ownUse, 0, capN), segmentsOf(b));
      hps = (60 / local) * inRange * stacks * (1 + event / Math.max(0.01, ownUse));
      // What the contact clock is actually applied to. The parts above multiply out to what one use
      // *lands*; this path does not multiply that by a rate, it counts how many of it are on the
      // boss at once and charges the clock for those — so the step from the one to the other is a
      // factor like any other and has to be stated, or the card's arithmetic stops being the score's
      // (Last Prism showed ×6 beams and ×6 hits/s for a number three times smaller than that).
      // Two things bound it: the cap on instances, and — for a projectile with no window of its own —
      // the player's single clock per body, which the rest of the volley queues on. That collapse is
      // deliberately left to this line rather than charged in the volley (see `bunched`): here is
      // where the window's rate is what it is being counted against.
      const counted = stacks / Math.max(0.01, ownUse);
      if (Math.abs(counted - 1) > 0.005) vparts.push({ fac: 'hits', label: `${r1(stacks)} of ${r1(ownUse)} on the boss at once${own ? '' : ", the rest queueing on the player's one immunity clock per body"}${held.maxActive && ownUse > held.maxActive ? ` (at most ${held.maxActive} out at a time)` : ''}`, mul: r2(counted) });
      vparts.push({ fac: 'hits', label: `${r1(60 / local)} hits/s in contact (${local}-tick ${own ? 'immunity of its own' : 'player immunity, one clock for whatever it throws'})`, mul: r1(60 / local) });
      // …and what it fires *while it is out* is not on this clock at all: it comes off the parts
      // above at its own rate, so the factor here takes it back out of the contact count and adds
      // it as the hits a second it really is.
      if (timer > 0) { const add = useRate * timer; const onClock = (ownUse + event) / Math.max(0.01, perUse); vparts.push({ fac: 'hits', label: `what it fires while out adds ${r1(add)} hits/s on its own clock`, mul: r2(onClock * (hps + add) / Math.max(0.01, hps)) }); hps += add; }
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
      } else if (item.maxOut > 1 && !item.useAmmo && v?.primary?.life != null && !v.primary.returns && !v.primary.bounces) {
        // …and a weapon that never gets its projectile back is bounded the same way, by however long
        // the thing lasts instead of by a round trip. `CanUseItem` refuses to fire while `N` of them
        // are alive, so `N` per lifetime is the ceiling whatever the animation allows: Marine Wine
        // Glass throws six glasses that last ten seconds and then shatters them, which is 0.6 uses a
        // second and not the six its ten-tick use time reads as.
        //
        // This sits in the use-clock arm deliberately, which is what keeps it off the weapons it
        // would otherwise wreck. A projectile the player *holds* is scored on the contact arm above
        // and never arrives here — its `life` is a sentinel for "until you let go" (Rancor 90,000
        // ticks, Sword of the Zenith 144,000) and dividing by that would zero them. A life the miner
        // never read is left alone for the same reason: the bound is only as good as its number.
        const life = v.primary.life / (1 + (v.primary.updates ?? 0));
        if (life / item.maxOut > time) {
          useRate = (60 * item.maxOut) / life;
          vparts.push({ fac: 'hits', label: `${item.maxOut > 1 ? `${item.maxOut} out at a time` : 'one out at a time'}: each lasts ${Math.round(life)} ticks`, mul: r2(useRate / rate) });
        }
      }
      hps = useRate * perUse;
      // …and the clock has to be the one the rate came off, or the card states a cadence the number
      // does not use: a weapon whose holdout pins the animation open has no `useTime` cadence to
      // print, and a charged release waits out the wind-up rather than the animation.
      const clock = charged ? `held ${r1(60 / rate)} ticks to charge` : rate === CLICK_CPS && primary?.pinsUse
        ? `tapped as fast as a player clicks (the holdout pins the use animation open, so ${r1(time)} ticks is a charge step and not a cadence)`
        : `${perAnim > 1 ? `${perAnim} shots ` : ''}every ${r1(time)} ticks${windup ? ` (${windup} of them charging, dealing nothing)` : ''}`;
      vparts.unshift({ fac: 'hits', label: clock, mul: r2(rate), unit: '/s' });
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
        const coverage = bladeContact < 0.995 || bladeContact > 1.005
          ? `; melee reach ${Math.round(bladeReach)} px vs ${REACH.swing} px standard ×${r2(bladeContact)}`
          : '';
        const label = `contact swing every ${r1(ua)} ticks${item.scale && item.scale !== 1 ? ` (size ×${r2(item.scale)})` : ''}${coverage}${landed ? `; blade ${landed}` : ''}`;
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
        // the window counts *events*: a shot at three times the damage is not three hits on the
        // clock, and a spray of 30 % children is a full hit each — the damage share is priced apart
        const sharedHps = useRate * shared.reduce((s, ph) => s + (ph.events ?? ph.hitsPerUse), 0) + swingHps;
        const sharedDmg = useRate * shared.reduce((s, ph) => s + ph.hitsPerUse, 0) + swingHps;
        // …but that is a *sustained* limit, and a stealth strike is not sustained: it lands its
        // whole burst at once and then waits out the recharge, so what the immunity window allows
        // it is the recharge's worth of ticks, not one use's. Reading it off the use rate capped a
        // strike at `6 / rate` hits — four, for a weapon swung every 40 ticks — which is a hard
        // ceiling on exactly the multi-projectile strikes the guides pick a weapon *for*.
        const window = name === 'stealth' ? stealthRecharge(ds) * rate : 1;
        const capHps = (60 / IMMUNITY) * segmentsOf(b) * window;
        if (sharedHps > capHps) {
          const k = capHps / sharedHps;
          for (const ph of shared) { ph.hitsPerUse *= k; if (ph.events != null) ph.events *= k; }
          swingHps *= k;
          const after = hps - sharedDmg * (1 - k);
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

    if (critMult !== 1) vparts.push({ fac: 'damage', label: `${r1(critChance)}% crit${ctx.loadout?.crit ? ` (${eff.crit} on the weapon, +${Math.round(ctx.loadout.crit)} from the standard loadout at this stage)` : ''}`, mul: r2(critMult) });
    const pool = poolAt(castRate, alt);
    if (sustain < 1) {
      const drinks = poolDrinks(pool, castRate, alt);
      const topped = drinks > 0.005 ? ` and a potion ${drinks > 0.98 ? 'whenever it empties' : `now and then`}${pool.potion.sickness ? ` (Mana Sickness takes ${Math.round(drinks * pool.potion.sickness * 100)}%)` : ''}` : '';
      vparts.push({ fac: 'resource', label: `${r1(poolCost(pool, alt) * castRate)} ${pool.name}/s against ${r1(pool.regen)} regen${pool.cap ? `, a bar of ${Math.round(pool.cap)}` : ''}${topped}${castRate < rate ? ` (casting ${r1(castRate)}/s keeps the links up)` : ''}`, mul: r2(sustain) });
    }

    // The guides' `†`, priced: how far short of where the class would rather be this weapon drags
    // the player, whatever did the dragging — the weapon type's reach or its own shot's. A cliff at
    // 150 px could only ever answer yes or no, and answered no for every melee weapon; the whole
    // difference between a yoyo and a pair of short daggers is *where along the way in* you end up.
    // …and a weapon paid for in *health* takes the same margin without moving the player an inch.
    // The pool above only says how often it can be fired; it does not say that the regeneration it
    // eats is the regeneration the player needed to survive the fight. A weapon spending all of it
    // is played at zero net regen — the position `RISK` prices — so the share of the bar it drinks
    // is exposure of the same kind, and the two do not add: whichever is worse governs.
    // ponytail: only where health is the pool that *governs*. A weapon whose life cost sits under a
    // tighter mana bar still drinks the bar (Blood Boiler takes 77% of it) and goes uncharged here;
    // widen it if a second weapon ever turns on that.
    const life = pool?.name === 'health' ? pool : null;
    const drain = life ? clamp((life.cost * castRate * sustain) / Math.max(0.01, life.regen), 0, 1) : 0;
    const exposure = Math.max(clamp(1 - D / Math.max(1, prefer), 0, 1), drain);
    const risk = 1 - (1 - (RISK[cls] ?? 0.85)) * exposure;
    if (risk < 0.995) vparts.push({ fac: 'cost', label: drain > clamp(1 - D / Math.max(1, prefer), 0, 1)
      ? `paid for in health: ${Math.round(drain * 100)}% of what the player regenerates goes into the weapon, not into surviving`
      : `${arch} fights at ${Math.round(D)} px of the ${Math.round(prefer)} px ${cls} wants`, mul: r2(risk) });

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
    // ---- each phase's own damage. Its share of the weapon's raw damage goes through the armour
    // it pierces against the boss's defense, instead of one post-defense hit scaled by the share.
    // Defense comes off flat, so a 30 % child against a real boss is worth less than 30 % of the
    // hit and can be worth the 1-damage floor — the fact that separates a spray of weak children
    // from a few real ones, and the one place the phases stop being fractions of one number.
    const penOf = (ph) => basePen + (ph.id === 'swing' ? 0 : proj(ds, ph.projId)?.armorPen ?? 0);
    const shareOf = (ph) => (ph.id === 'swing' ? 1 : ph.share ?? 1);
    for (const ph of vphases) {
      ph.eventsSec = ph.id === 'swing' ? ph.hitsSec : shareOf(ph) > 0 ? ph.hitsSec / shareOf(ph) : 0;
      ph.hitDmg = hitDamage(raw * shareOf(ph), b, penOf(ph), defenseDebuff);
    }
    /** post-defense damage per second, with the raw damage scaled (a stealth strike's multiplier) */
    const dmgSecOf = (mult = 1) => vphases.reduce((s, ph) => s + (ph.eventsSec ?? 0) * (mult === 1 ? ph.hitDmg : hitDamage(raw * mult * shareOf(ph), b, penOf(ph), defenseDebuff)), 0);
    const dmgSec = dmgSecOf(1);
    const flat = hps * hit;
    if (flat > 0 && Math.abs(dmgSec / flat - 1) > 0.005) vparts.push({ fac: 'damage', label: `defense taken off each phase's own damage${vphases.some((ph) => ph.eventsSec > 0 && penOf(ph) !== armorPen) ? ' and armour pen' : ''}`, mul: r2(dmgSec / flat) });
    // ---- the debuffs, each kept up by the phases that apply it: one landing a second keeps any
    // of them up, and a debuff only a rare child carries is up only as often as that child lands
    const dotUps = new Map();
    const dotRates = new Map();
    let dotSec = 0;
    for (const d of debuffs) {
      if (!(d.dot > 0)) continue;
      const rate = vphases.reduce((r, ph) => r + ((ph.eventsSec ?? 0) > 0 && proj(ds, ph.projId)?.debuffs?.includes(d.buffId) ? ph.eventsSec : 0), 0);
      const up = clamp(rate, 0, 1);
      dotUps.set(d.buffId, up);
      dotRates.set(d.buffId, rate);
      dotSec += d.dot * up;
    }
    return { hps, dmgSec, dmgSecOf, dotSec, dotUps, dotRates, parts: vparts, risk, D, rate: useRate, phases: vphases, sustain };
  };

  // A debuff is only on the boss while the phase applying it keeps landing (`dotSec` is priced
  // per variant): a weapon that lands nothing applies nothing. Aphelion landed 0 hits and was
  // paid its whole DoT.
  const withDebuff = (v) => v.dmgSec * critMult * v.sustain * v.risk + v.dotSec;

  /**
   * The two clicks are two attacks the player chooses between, not two that happen at once, so the
   * weapon is worth its better one. Reading them together left the model either summing a
   * right-click onto every left-click or — where they sit in different branches of `Shoot` —
   * averaging them as if a coin decided which fired.
   */
  // …and a weapon whose two clicks differ only in the projectile they swap in (`altMods.type`,
  // Malachite's kunai against its piercing bolt) has two attacks just as much as one that branches
  // inside `Shoot` — reading only the calls left the right click unevaluated.
  const clicks = (fire?.calls ?? []).some((c) => c.alt !== undefined) || fire?.altMods?.type ? [false, true] : [false];
  // a sword that fires further than it reaches can be used from back there instead
  const stances = trueMelee && shoots && closeIn(1) > bladeReach ? ['close', 'back'] : ['close'];
  const best = (name, charged = false) => {
    let pick = null;
    const all = [];
    for (const alt of clicks) for (const stance of stances) {
      const r = { ...variant(name, alt, stance, charged), alt, stance };
      all.push(r);
      if (!pick || r.dmgSec * r.sustain * r.risk > pick.dmgSec * pick.sustain * pick.risk) pick = r;
    }
    // …and the click that lost is still an attack the weapon has. It scores nothing (the player
    // uses one at a time) but the graph has to show it, the same way the loop not taken is shown.
    if (pick) pick.otherClick = all.filter((r) => r.alt !== pick.alt)
      .sort((x, y) => y.dmgSec * y.sustain * y.risk - x.dmgSec * x.sustain * x.risk)[0] ?? null;
    if (clicks.length > 1) pick.parts = [...pick.parts, { fac: 'hits', label: `${pick.alt ? 'right' : 'left'} click: the better of the weapon's two attacks`, mul: 1 }];
    if (pick.stance === 'back') pick.parts = [...pick.parts, { fac: 'landing', label: `stands back at ${Math.round(pick.D)} px, out of the blade's reach: the shot alone beats swinging in close`, mul: 1 }];
    return pick;
  };

  const spam = best('spam');
  const spamValue = withDebuff(spam);
  // A debuff is not a second thing the weapon does at the same time as its attack — it is applied
  // by whatever lands on the target, so it hangs off that phase: use → spear → gouge, the order it
  // actually happens in. Where several phases carry the same debuff the one landing most often owns
  // it; one no phase in this loop applies keeps the use clock as its parent.
  for (const ph of debuffs) {
    const src = spam.phases.filter((x) => (x.eventsSec ?? 0) > 0 && proj(ds, x.projId)?.debuffs?.includes(ph.buffId))
      .sort((x, y) => (y.eventsSec ?? 0) - (x.eventsSec ?? 0))[0];
    if (src) ph.parent = src.id;
  }
  // The debuff *adds* its damage over time to what the weapon does, so the part that explains it is
  // the factor it adds. As a bare `value` it replaced the running number instead, which is why a
  // Spore Knife's factors multiplied out to the poison alone and none of the knife.
  const dotPart = (base, dotSec) => (dotSec > 0 ? [{ fac: 'debuff', label: `${applied.join(', ')} (${r1(dotSec)} DPS${dotSec < dot - 0.05 ? `, kept up ${Math.round((dotSec / dot) * 100)}% of the time by the phases that apply it` : ''})`, mul: r2((base + dotSec) / Math.max(0.01, base)) }] : []);
  const dbg = dotPart(spamValue - spam.dotSec, spam.dotSec);
  const out = {
    kind: 'dps', mode: null, rate: r2(baseRate), critMult, eff, hit, boss: b, arch, ammo, distance: spam.D,
    parts: [...parts, ...spam.parts, ...dbg],
    spam: spamValue, value: spamValue, dps: spamValue,
    // every damaging phase priced in the same units as the score, so the graph can be read as an
    // account of where the number came from: the shares sum to the weapon's own DPS
    phases: [
      ...graph,
      ...spam.phases.map((ph) => ({ ...ph, contribution: r1((ph.eventsSec ?? 0) * (ph.hitDmg ?? 0) * critMult * spam.sustain * spam.risk) })),
      ...debuffs.map((ph) => ({ ...ph, contribution: r1((ph.dot ?? 0) * (spam.dotUps.get(ph.buffId) ?? 0)) })),
    ],
  };

  // ---- the other mouse button, as a branch of its own.
  //
  // `best` picks between the two clicks and used to drop the loser on the floor: Malachite's left
  // click throws sticking kunai and its right a piercing bolt, and whichever scored higher was the
  // only one the card had ever heard of. The player has both. It is the same shape as the loop not
  // taken below — one attack at a time, so it counts for nothing and is *shown* for everything —
  // and it gets the same treatment: its own copy of every phase under its own ids, `own` for what
  // it is worth when you press that button, `contribution` zero because the score is the other one.
  // …unless it is the same attack twice. Where the click changes something the model cannot read —
  // Aegis Blade swaps its damage class and its `noMelee`, not its projectile — both sides compute
  // the same numbers, and a second branch identical to the first is noise rather than information.
  const clickShape = (v) => JSON.stringify(v.phases.map((ph) => [ph.id, ph.projId, r1(ph.eventsSec ?? 0), r1(ph.hitDmg ?? 0)]));
  if (spam.otherClick && clickShape(spam.otherClick) !== clickShape(spam)) {
    const o = spam.otherClick;
    const clickId = (id) => (id == null || id === 'primary' ? id : `click:${id}`);
    const grade = `${o.alt ? 'right' : 'left'} click`;
    const reclick = (ph, own) => ({ ...ph, id: clickId(ph.id), parent: clickId(ph.parent), grade, offClick: true, own, contribution: 0 });
    // …and the branch that *was* taken is a click too, so it needs a name for the graph's switch to
    // offer, or one branch is labelled and the other anonymous. It is named here rather than left to
    // the blocks below because a weapon with two clicks and nothing else never reaches them.
    //
    // **`spam` is not a word for "the ordinary attack".** It is one half of a named pair: the rogue's
    // spam-versus-stealth axis, and the tap-versus-hold of a charge weapon, which is the only other
    // place a non-rogue earns it. SHPC has neither — it is a magic weapon with two mouse buttons —
    // and calling its right click "spam · right click" invented a loop the weapon does not have.
    // Where one of those axes *is* coming, the scored branch really is its spam half and only needs
    // the click naming; where neither is, the click is the whole name.
    // exactly the union of the two blocks below, so the grade a phase gets here is the grade they expect
    const paired = cls === 'rogue' || cls === 'thrower' || !!chargeArms;
    const side = spam.alt ? 'right' : 'left';
    for (const ph of out.phases) if (ph.contribution !== undefined && !ph.grade) {
      ph.own = ph.contribution;
      if (paired) { ph.grade = 'spam'; ph.click = side; } else ph.grade = `${side} click`;
    }
    // …and its arithmetic, in the same shape as the scored loop's. Switching a panel to the other
    // button and leaving the factors of *this* one underneath it is the "two weapons on one screen"
    // this file already refuses for the two rogue grades — and it is what made the switch look inert
    // on a weapon whose two clicks happen to land within a rounding of each other.
    const oValue = withDebuff(o);
    out.click = oValue;
    out.clickParts = [...parts, ...o.parts, ...dotPart(oValue - o.dotSec, o.dotSec)];
    out.phases.push(
      ...o.phases.map((ph) => reclick(ph, r1((ph.eventsSec ?? 0) * (ph.hitDmg ?? 0) * critMult * o.sustain * o.risk))),
      ...debuffs.map((ph) => reclick(ph, r1((ph.dot ?? 0) * (o.dotUps.get(ph.buffId) ?? 0)))),
    );
  }

  /**
   * ---- charge weapons: holding and tapping are two attacks, and the player picks.
   *
   * A payload behind the weapon's own charge counter (`branch.charge`, both arms present) is not an
   * if/else nobody read — how full that counter is, is how long the button was held. So the two
   * arms are graded as two loops, the same way the two mouse buttons and the two rogue grades
   * already are, and the weapon is worth its better one rather than the sum of both.
   *
   * The rates are what separate them, and it is usually not close. Perfect Star releases the same
   * damage either way: level 0 fires `PerfectStarLaser`, levels 1-3 all fire `PerfectStarLaser2`,
   * both spawned with `Projectile.damage` — so charging buys speed and range and nothing else,
   * against a full charge costing 108 ticks. Coral Spout does trade up (5 shards at ×1 against one
   * chunk at ×7), and its tooltip says so, which is what makes it the second case worth having.
   */
  if (chargeArms && cls !== 'rogue' && cls !== 'thrower') {
    const ch = best('spam', true);
    const chargeValue = withDebuff(ch);
    out.charge = chargeValue;
    out.mode = chargeValue > spamValue ? 'charge' : 'spam';
    out.value = out.dps = Math.max(spamValue, chargeValue);
    // the card has to explain the number it printed, so the winning loop's factors are the ones on it
    if (chargeValue > spamValue) {
      out.parts = [...parts, ...ch.parts, ...dotPart(chargeValue - ch.dotSec, ch.dotSec)];
      out.rate = r2(ch.rate);
      out.distance = ch.D;
    } else out.rate = r2(spam.rate);
    // both loops in one graph, each priced in its own, so the tree shows the attack that was *not*
    // taken instead of hiding it — which is the whole complaint this started from. `own` is what a
    // phase is worth in its own loop; `contribution` is what it is worth in the score.
    const taken = (g) => (g === out.mode ? 1 : 0);
    for (const ph of out.phases) if (ph.contribution !== undefined && !ph.offClick) { ph.grade ??= 'spam'; ph.own ??= ph.contribution; ph.contribution = r1(ph.own * taken('spam')); } // the click not taken keeps its own grade and its zero
    const chargeId = (id) => (id == null || id === 'primary' ? id : `charge:${id}`);
    const regrade = (ph, own) => ({ ...ph, id: chargeId(ph.id), parent: chargeId(ph.parent), grade: 'charge', click: clicks.length > 1 ? (ch.alt ? 'right' : 'left') : undefined, own, contribution: r1(own * taken('charge')) });
    out.phases.push(
      ...ch.phases.map((ph) => regrade(ph, r1((ph.eventsSec ?? 0) * (ph.hitDmg ?? 0) * critMult * ch.sustain * ch.risk))),
      ...debuffs.map((ph) => regrade(ph, r1((ph.dot ?? 0) * (ch.dotUps.get(ph.buffId) ?? 0)))),
    );
  }

  // ---- Calamity rogue: stealth strike as the alternative grade. Every rogue weapon strikes from
  // stealth, with or without a coded stealth branch (`fire.stealth`), so grade all of them.
  if (cls === 'rogue' || cls === 'thrower') {
    const st = best('stealth');
    const smax = ctx.stealthMax ?? STEALTH_MAX_DEFAULT;
    // The weapon's own stealth share is a cut of each projectile the strike throws, not part of the
    // strike bonus: Calamity's multiplier is `1 + …` and folding a ×0.65 inside that `1 +` made a
    // weapon that trades damage for extra javelins look *stronger* than one that does not. Solving
    // four in-game readings backwards, the printed stealth damage has no `dmgMul` in it at all.
    // `stealthMods.dmgMul` is that cut, and it is applied where it belongs — on each delivery phase
    // of the stealth grade (`shotMul` in `variantHits`) — so it is applied exactly once, children
    // included. `stealthMult` is the same number read off the property instead of the branch (they
    // agree on every one of the 60 weapons carrying both), and it goes the same way.
    const mult = stealthMultiplier(time, smax, ds);
    /**
     * …and where it lands. `CalamityPlayer.PostUpdateMiscEffects` does
     * `Player.GetDamage<RogueDamageClass>() += stealthDamage`, so the strike's bonus goes into the
     * *same additive pool* as the armour's percentage and every Menacing — it does not multiply the
     * buffed hit. Multiplying priced a strike at `listed × buff × mult` where the game's own tooltip
     * shows `listed × (buff + mult − 1)`: 15 × 1.22 × 2.24 against 15 × (1 + 0.22 + 1.24). The error
     * is the gear bonus times the strike bonus, so it is small on a bare character and grows with
     * every point of damage the loadout adds — 11 % at post-Crabulon and worse later.
     */
    const strikeMul = (buff + mult - 1) / buff;
    // …and the reforge's *second* multiplier, which does multiply: `CalamityPlayer.ModifyWeaponDamage`
    // scales the whole StatModifier by the prefix's `stealthDmgMult` while a strike is available, so
    // a Flawless weapon is ×1.15 all the time and ×1.15 again the moment the bar is full. Guarded:
    // the field only exists in a dataset mined since `stealthDmg` was added to the prefix extractor.
    const prefixStealth = 1 + (ctx.prefix?.stealthDmg ?? 0);
    // The two grades are two *loops*, and the player is in one or the other. `UpdateStealthGenStats`
    // returns 0 while the item animates and `ConsumeStealthByAttacking` empties the bar on the
    // strike, so a player who throws continuously never strikes, and a player who strikes has to
    // stop throwing for the bar to refill: throw, pause, throw. The stealth loop is one strike per
    // pause-plus-throw; the spam loop is throwing with no strikes at all. Summing them credited a
    // schedule nobody can run, and no weapon could ever be called a stealth weapon under it: a
    // strike alone is a payload over a recharge, small against any sustained rate, so all 38
    // pre-hardmode weapons the miner sees a stealth branch on were labelled spam.
    const recharge = stealthRecharge(ds, STEALTH_LOOP_STILL);
    const cycle = recharge + time / 60;
    // one strike per cycle: the damage of a single use, not the sustained rate — the strike
    // multiplier scales the raw damage of every phase, before each phase's own defense
    // The loop casts once per `cycle`, and the pool has that whole cycle to come back — which for
    // Thorium's exhaustion means it never builds at all: the bar regains 60 a second through a
    // pause the strike *requires*, against the ~64 one throw costs. The spam rate's sustain was
    // being copied into the stealth parts list and shown as a ×0.5 the value never applied, so the
    // card said the strike was being taxed and the number said it was free. Both now agree, at the
    // rate the loop actually runs.
    const stealthSustain = sustainAt(1 / cycle);
    const strike = ((st.dmgSecOf(strikeMul * prefixStealth) / st.rate) * critMult * st.risk * stealthSustain) / cycle;
    // …and its debuffs are up as often as the strike's phases land in the loop, not at the sustained rate
    const loopK = 1 / (st.rate * cycle);
    let stealthDot = 0;
    const stealthUps = new Map();
    for (const d of debuffs) { if (!(d.dot > 0)) continue; const up = clamp((st.dotRates.get(d.buffId) ?? 0) * loopK, 0, 1); stealthUps.set(d.buffId, up); stealthDot += d.dot * up; }
    const stealthValue = strike + stealthDot;
    out.stealth = stealthValue;
    out.stealthParts = [
      { fac: 'damage', label: `${eff.damage} damage`, value: hit },
      { fac: 'damage', label: `stealth strike +${Math.round((mult - 1) * 100)}% ${cls} damage (max stealth ${Math.round(smax * 100)}), added to the loadout's own +${Math.round((buff - 1) * 100)}% rather than multiplying it`, mul: r2(strikeMul) },
      ...(prefixStealth !== 1 ? [{ fac: 'damage', label: `${ctx.prefix?.name} again on the strike: a rogue reforge carries a second multiplier that only applies while the bar is full`, mul: r2(prefixStealth) }] : []),
      // the strike's phases meet the defense at strike damage, so the correction is its own
      ...st.parts.filter((p) => (!/ticks$|\/s$/.test(p.label) || p.unit !== '/s') && !/^defense taken off each phase/.test(p.label) && p.fac !== 'resource'),
      ...(stealthSustain < 0.995 ? [{ fac: 'resource', label: `${r1(poolAt(1 / cycle).cost / cycle)} ${poolAt(1 / cycle).name}/s at one strike per ${r1(cycle)} s vs ${r1(poolAt(1 / cycle).regen)} regen`, mul: r2(stealthSustain) }] : []),
      ...(st.hps * hit * strikeMul * prefixStealth > 0 && Math.abs(st.dmgSecOf(strikeMul * prefixStealth) / (st.hps * hit * strikeMul * prefixStealth) - 1) > 0.005 ? [{ fac: 'damage', label: "defense taken off each phase's own damage, at strike damage", mul: r2(st.dmgSecOf(strikeMul * prefixStealth) / (st.hps * hit * strikeMul * prefixStealth)) }] : []),
      { fac: 'hits', label: `one strike per ${r1(cycle)} s: the bar refills in ${r1(stealthFill(ds))} s standing still, ${r1(stealthFill(ds) / stealthConsts(ds).movingRatio)} s moving (${Math.round(STEALTH_LOOP_STILL * 100)}% of the pause still), plus the throw`, mul: r2(1 / cycle) },
      ...dotPart(strike, stealthDot), // the strike is its own running total, so the DoT is its own factor here
    ];
    // the weapon is worth the loop it is better in, and that loop names its grade
    out.mode = stealthValue > spamValue ? 'stealth' : 'spam';
    out.value = out.dps = Math.max(spamValue, stealthValue);
    // the graph carries both grades, each phase priced in its own loop; the loop not taken
    // contributes nothing, so the shares still sum to the weapon's value
    // `own` is what the phase is worth *in its own loop*, kept beside the zeroed `contribution` so
    // the graph can show the loop not taken on its own terms instead of as a row of nothings
    const taken = (g) => (g === out.mode ? 1 : 0);
    for (const ph of out.phases) if (ph.contribution !== undefined && !ph.offClick) { ph.grade ??= 'spam'; ph.own ??= ph.contribution; ph.contribution = r1(ph.own * taken('spam')); } // the click not taken keeps its own grade and its zero
    // Both grades' phases live in one list, and a phase's id is what its children name as parent —
    // so the strike's copy of a phase has to be its own node. Sharing the id made the graph list
    // `default` twice under the root and hang each grade's children off the other's parent too.
    // The root is genuinely shared: one use clock, both grades.
    const stealthId = (id) => (id == null || id === 'primary' ? id : `stealth:${id}`);
    const regrade = (ph, own) => ({ ...ph, id: stealthId(ph.id), parent: stealthId(ph.parent), grade: 'stealth', click: clicks.length > 1 ? (st.alt ? 'right' : 'left') : undefined, own, contribution: r1(own * taken('stealth')) });
    out.phases.push(
      ...st.phases.map((ph) => regrade(ph, r1((((ph.eventsSec ?? 0) / st.rate) * hitDamage(raw * strikeMul * prefixStealth * (ph.id === 'swing' ? 1 : ph.share ?? 1), b, basePen + (ph.id === 'swing' ? 0 : proj(ds, ph.projId)?.armorPen ?? 0), defenseDebuff) * critMult * st.risk) / cycle))),
      ...debuffs.map((ph) => regrade(ph, r1((ph.dot ?? 0) * (stealthUps.get(ph.buffId) ?? 0)))),
    );
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
  const shot = item.useAmmo > 0 ? (ctx.ammo ?? standardAmmo(ds, item.useAmmo, ctx.stage))?.shoot ?? null : item.shoot ?? null;
  const shoot = item.ammoSwap && shot === item.ammoSwap.from ? item.ammoSwap.to : shot;
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
/**
 * Every loop a weapon carries and what each is worth, the scored one first.
 *
 * A weapon can hold more than the two the model started with: the two mouse buttons, a rogue's
 * stealth strike, a charge held rather than tapped — Malachite has three at once. Anything offering
 * the reader a choice between them has to enumerate them rather than assume a pair, which is what
 * both the graph's switch and the Items page's cycle button do with this.
 *
 * `total` is the loop's own worth: the scored loop's phases already carry it as `contribution`, and
 * every other loop's is `own`, what its phases are worth when you play that way instead. `click`
 * names which mouse button the loop is, where it is one, and `parts` is that loop's own arithmetic
 * where the model kept it — a panel that swaps the graph has to swap the factors under it too.
 * @returns {Array<{ loop: string, scored: boolean, click: 'left'|'right'|null, total: number, parts: Array|null }>}
 */
export function loopsOf(dps) {
  const phases = dps?.phases ?? [];
  const seen = [];
  for (const p of phases) if (p.grade && !seen.includes(p.grade)) seen.push(p.grade);
  if (seen.length < 2) return [];
  const scored = seen.includes(dps?.mode) ? dps.mode : seen[0];
  // `charge` is the one loop with no factors of its own: they are only built when it wins, and then
  // they are `parts`. It falls back to the weapon's, which the graph beside them then qualifies.
  const partsOf = (g) => (g === scored ? dps?.parts : g === 'stealth' ? dps?.stealthParts : /click$/.test(g) ? dps?.clickParts : null) ?? null;
  return [scored, ...seen.filter((g) => g !== scored)].map((g) => ({
    loop: g,
    scored: g === scored,
    click: phases.find((p) => p.grade === g && p.click)?.click ?? null,
    total: phases.reduce((s, p) => s + (p.grade === g ? ((g === scored ? p.contribution : p.own) ?? 0) : 0), 0),
    parts: partsOf(g),
  }));
}

/** How a loop is named where it is offered as a choice: "spam · right click", "stealth", "charge". */
export const loopLabel = (l) => (l?.click ? `${l.loop} · ${l.click} click` : (l?.loop ?? ''));

/**
 * The graph priced in one of a weapon's two loops: each phase is worth what it is worth *inside*
 * that loop (`own`), and a phase belonging to the other loop is worth nothing in it. The scored
 * loop's phases carry that already as `contribution`; this is how the loop not taken gets drawn.
 */
export const loopPhases = (phases, loop) =>
  (phases ?? []).map((p) => (p.grade ? { ...p, contribution: p.grade === loop ? p.own ?? 0 : 0 } : p));

export function realDps(item, ctx = {}) {
  const out = gradeWeapon(item, ctx);
  const digs = digsTiles(item, ctx);
  const notes = [];
  if (CALIBRATION !== 1) notes.push({ fac: 'damage', label: `measured against the game: the model reads ${Math.round(Math.abs(1 - 1 / CALIBRATION) * 100)}% ${CALIBRATION > 1 ? 'under' : 'over'} the in-game trials`, mul: r2(CALIBRATION) });
  if (digs) notes.push({ fac: 'cost', label: 'destroys tiles: the blast takes the arena with it', mul: TERRAIN_PENALTY });
  if (!notes.length) return out;
  const k = CALIBRATION * (digs ? TERRAIN_PENALTY : 1);
  for (const key of ['value', 'dps', 'spam', 'stealth']) if (typeof out[key] === 'number') out[key] *= k;
  // both land on the whole weapon, so every phase's share of them too: the graph still adds up
  for (const ph of out.phases ?? []) for (const key of ['contribution', 'own']) if (typeof ph[key] === 'number') ph[key] = Math.round(ph[key] * k * 10) / 10;
  out.parts = [...out.parts, ...notes];
  if (out.stealthParts) out.stealthParts = [...out.stealthParts, ...notes];
  if (out.clickParts) out.clickParts = [...out.clickParts, ...notes]; // a penalty on the weapon lands on every loop of it
  return out;
}
