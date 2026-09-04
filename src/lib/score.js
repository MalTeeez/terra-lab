/**
 * Scoring: how good is a piece of equipment for a class?
 *
 * Every number is explainable — scores are sums of labelled parts so the UI can show
 * exactly why something was picked. Weights are deliberately simple:
 *   +1% class damage        = 1 point        (10% damage = 10)
 *   +1% crit chance         = 0.7 point      (crit doubles a hit: +1% crit ≈ +0.9% DPS at 10% base)
 *   +1% attack speed        = 0.6 point      (all-class attack speed only swings melee weapons)
 *   +1 defense              = 0.5 point      × defenseScale(progression): worth twice that pre-boss
 *   +1 minion / sentry slot = 100 / 30 points × minionSlotScale(progression): 1/N of the minions' damage at the N slots the player already has (33 pre-boss, 8 at the end)
 *   aggro                   = 0.8 point per √unit (80 → 7, 400 → 16), sign by class: melee tolerates it, everyone else pays
 *   class mechanics in text = the stat at half ("Stealth strikes deal 8% more damage" = 4 for a rogue)
 *   utility flags           = flat points (flight, knockback immunity, dash, …)
 * CLASS_PREF multiplies these per class: a rogue's +1% crit is 1 point (as much as 1% damage), and
 * melee counts everything that keeps it alive — defense, damage reduction, life, regen, a dodge —
 * at `tank`×, because it is the only class that has to stand in the boss's hitbox to do its damage.
 */
import { STEALTH_RECHARGE, realDps } from './dps.js';

/**
 * Crit chance a player actually carries into a boss fight — the yardstick crit *damage* is worth
 * anything against: a bigger crit only pays on the hits that crit. `+1% crit damage` is worth
 * `TYPICAL_CRIT / (1 + TYPICAL_CRIT)` of `+1% damage`, so 20% crit damage ≈ 2.6% damage.
 */
export const TYPICAL_CRIT = 0.15;

/**
 * What a bonus only stealth strikes get is worth, against the same bonus on the whole class.
 *
 * The lab's own DPS model says the strike is a small part of a rogue's damage per second (median
 * 0.13 across every rogue weapon in the dataset, quartiles 0.09–0.19), which would make "+8%
 * stealth strike damage" worth about one point rather than eight. The guides say otherwise, and
 * loudly: `guide-check --cls rogue` finds 56 of their accessory picks in the lab's top 6 at 1,
 * 49 at 0.5 and 27 at 0.15 — Rotten Dogtooth, a listed pre-boss pick whose whole text is a stealth
 * bonus, falls out of the top 20 as soon as the share bites. So either the guides overrate the
 * mechanic or dps.js underrates the strike, and the guides are the arbiter: it counts in full.
 */
export const STEALTH_SHARE = 1;

/**
 * Seconds between triggers of a retaliation proc (`OnHitByNPC`, `PostHurt`): you take a hit a
 * handful of times in a boss fight, not three times a second, and every trigger cost you health.
 * ponytail: one flat number for every hurt proc; make it stage-aware if it ever matters.
 */
const HURT_EVERY = 20;

export const W = {
  damage: 100, crit: 0.7, critDamage: (100 * TYPICAL_CRIT) / (1 + TYPICAL_CRIT), attackSpeed: 60, defense: 0.5, minionSlot: 100, sentrySlot: 30, moveSpeed: 25,
  maxLife: 0.05, lifeRegen: 1.2, endurance: 60, manaCost: 20, maxMana: 0.03, armorPen: 0.5, aggro: 0.8,
  flight: 10, wingTime: 0.04, wingSpeed: 2, flightBoost: 5, noKnockback: 1.5, dash: 2, jump: 3, jumpBoost: 1, accel: 4, debuffImmune: 5, lava: 2, mobility: 3, utility: 1,
  dodge: 5, // a negated hit now and then: about what immunity to every debuff is worth
  debuffResist: 2, // immunity to a few named debuffs, not to all of them
  selfDebuff: 4, // a drawback that puts a debuff on you: near enough the mirror of debuff immunity
  whipRange: 5, // summon: +100% whip range = 5 (the lash reaches further, the minions do the damage)
  onHitUnknown: 2, // it spawns something on hit whose damage the miner could not read: not nothing
  iframes: 3, // a longer window of invincibility after a hit
  meleeSize: 2, // melee: a bigger weapon hitbox
  potionHeal: 6, // +100% out of a healing potion, or half the wait between two of them
  healerHealing: 1.5, // healer: +1 life on every heal they cast
  // void (SOTS) is a resource class: its weapons spend void the way a mage spends mana, so what a
  // piece gives the bar is what it gives the class. Gain is the strongest of the three — it is how
  // fast the bar comes back — and the pool is worth about what the same mana is.
  voidGain: 2.5, voidMaxPool: 0.03, voidRegen: 12,
  runSpeed: 2, // boots (Hermes and up): a little, wings and dashes do the real moving in a boss fight
  velocity: 20, // rogue: +10% throwing velocity = 2 (a faster projectile lands more often, see dps.js)
  onHitCap: 15, // a proc never outranks a damage emblem
  // a retaliation proc is contingent on the thing you spend the fight avoiding, so it is worth less
  // than a dodge (W.dodge, which negates the hit outright) however hard the blast itself lands
  onHurtCap: 4,
  // a full set's bonus is worth something even when its text is unreadable (a proc, an aura, a dodge)
  setBonus: 5, setBonusClass: 8,
};

/**
 * What each class cares about beyond the shared weights, as multipliers on W. Aggro is a
 * preference rather than a DPS term (it only decides whom enemies target in multiplayer), but a
 * rogue never wants the boss on them and a melee player can hold it: positive means "wants aggro".
 *
 * `tank` is the multiplier on everything that keeps the player alive — defense, damage reduction,
 * max life, life regen, a dodge. Melee is the one class that has to stand in the boss's hitbox to
 * deal its damage, so for melee survivability *is* uptime: a hit absorbed is a swing not spent
 * retreating, and the class-setup guides fill melee accessory slots with Worm Scarf, Amalgamated
 * Brain and The Absorber rather than a fourth damage emblem. Every other class kites, so what
 * keeps them alive is movement, and their survivability stays at face value.
 */
export const CLASS_PREF = {
  melee: { tank: 2.5, aggro: 0.3 },
  ranged: { crit: 1.2, aggro: -1 },
  magic: { crit: 1.1, aggro: -1 },
  summon: { aggro: -1.3 },
  rogue: { crit: 1.43, aggro: -1.5 }, // 0.7 × 1.43 = 1 point per 1% crit: the same as 1% damage
  thrower: { crit: 1.43, aggro: -1.5 },
  bard: { aggro: -1 },
  healer: { aggro: -1 },
};
const pref = (cls, k) => CLASS_PREF[cls]?.[k] ?? (k === 'aggro' ? -1 : 1);
/** Survivability multiplier: `tank`, times the stat's own preference where it has one. */
const tank = (cls, k) => pref(cls, 'tank') * (k ? pref(cls, k) : 1);

/**
 * Worth of a point of defense at a progression value. A boss hit grows from ~30 pre-boss to ~500
 * at the end of Calamity, so the same 10 defense shrinks from a third of a hit to a fiftieth.
 * Inverse-log of progression: ×2.1 pre-boss, ×1 at Wall of Flesh (7), ×0.67 at the end (28).
 */
export const defenseScale = (progression) => 2.3 / Math.log(3 + Math.max(0, progression ?? 7));

/**
 * A minion slot is worth 1/N of the summoner's *minion* damage at N slots — and N counts the slots
 * the player already has, not the ones this accessory gives. A summoner is never on 1 minion: the
 * base slot plus an armour set is about 3 pre-boss, and the count grows one per three progression
 * points (5 at Wall of Flesh, 9 at Moon Lord, 12 at the end), so a slot is worth 33 points pre-boss
 * and 8 at the end of Calamity.
 *
 * Counting from one slot instead put a lone "+1 minion" accessory at 62 points — three times a
 * damage emblem and more than any armour set — because the first slot really is +100% of a class
 * that has nothing else. Nobody fights a boss in that state.
 */
export const minionSlotScale = (progression) => 1 / (3 + Math.max(0, progression ?? 7) / 3);

/**
 * A typical weapon's DPS at a progression value, the yardstick for damage an accessory deals on
 * its own (a spike per stealth strike, a flash on hit): ~60 pre-boss, ~240 at Wall of Flesh,
 * ~1800 at Moon Lord, ~18000 at the end of Calamity.
 *
 * Calibrated against the lab's own weapon model, not guessed: the median of the 10th-best weapon
 * per class per stage (`weaponDps`) is ~55 at progression 0, ~850 at 12.8 and ~3600 at 20.5, all
 * within 10% of this curve. The old base of 40 sat a flat 1.5× under it at every stage, which
 * made every flat proc and every "+N damage on a crit" worth half again what it should be.
 */
export const typicalDps = (progression) => 60 * 1.22 ** Math.max(0, progression ?? 7);

/**
 * Diminishing returns for stats that stop helping past a point: slope 1 near zero, an ease-out
 * cubic that flattens to `cap` by three times it. Damage stays linear (it adds to the total);
 * crit flattens (nothing above 100% helps), movement, damage reduction, regen, defense and
 * aggro all pay less the more a single item piles on.
 */
export const soft = (x, cap) => { const t = Math.min(1, Math.abs(x) / (3 * cap)); return Math.sign(x) * cap * (1 - (1 - t) ** 3); };
export const SOFT = { crit: 25, attackSpeed: 0.25, moveSpeed: 0.3, endurance: 0.2, lifeRegen: 8, maxLife: 100, maxMana: 100, armorPen: 25, defense: 12, velocity: 0.3, aggro: 10, wingTime: 200, voidGain: 6, voidMaxPool: 150 };

/** Hits one spawned projectile lands: its pierce (or life ÷ immunity frames when infinite), plus half its children. */
export function onHitHits(s) {
  const kids = (s.kids ?? 0) * 0.5;
  if (s.pen === -1) return Math.min(4, Math.max(1, (s.life ?? 60) / Math.max(1, s.local ?? 10))) + kids;
  return Math.min(4, Math.max(1, s.pen ?? 1)) + kids;
}

const CLASS_DAMAGE_KEYS = { melee: 'melee', ranged: 'ranged', magic: 'magic', summon: 'summon', rogue: 'rogue', thrower: 'thrower', bard: 'bard', healer: 'healer', void: 'void' };

/**
 * Did the code answer for this class at all? A mined zero is usually a value the miner could not
 * work out (a formula, a stack count) and the tooltip fills it in — but for attack speed it is an
 * answer: the gloves add vanilla's 12% melee speed and Calamity subtracts the same 12% back out,
 * while the tooltip still says +12% because it is vanilla's own text. Only 4 items in the pool sum
 * to a real zero this way and all of them are that glove line, so only attack speed asks.
 */
function fxHas(table, cls, aliases, { generic = true } = {}) {
  if (table === undefined || table === null) return false;
  if (typeof table === 'number') return generic;
  if (generic && (table.all !== undefined || table.classless !== undefined)) return true;
  if (cls && table[cls] !== undefined) return true;
  return Object.entries(aliases ?? {}).some(([f, t]) => t === cls && table[f] !== undefined);
}

/** Value of a per-class stat table (`{ melee: 0.1, all: 0.05 }`) for a class. */
function forClass(table, cls, aliases, { generic = true } = {}) {
  if (!table) return 0;
  // some effects are a plain number rather than a per-class table (`statDefense += 4`, Warding's
  // +4 defense): that is an all-class value
  if (typeof table === 'number') return generic ? table : 0;
  let v = generic ? (table.all ?? 0) + (table.classless ?? 0) : 0;
  if (cls && table[cls]) v += table[cls];
  for (const [from, to] of Object.entries(aliases ?? {})) if (to === cls && table[from]) v += table[from];
  return v;
}

/**
 * One stat of a piece for a class. The IL-mined effects are the truth when they have the key; the
 * tooltip-parsed stats only fill in what the miner could not read (an effect applied elsewhere,
 * a dynamic value).
 */
function mergedStat(item, key, cls, aliases, extraFx) {
  const fx = item.effects;
  const st = item.stats ?? {};
  let a = 0;
  let b = 0;
  let c = 0;
  let aKnown = false; // the code's zero is the answer, not a gap for the tooltip to fill
  switch (key) {
    case 'damage':
      a = forClass(fx?.damage, cls, aliases) + forClass(fx?.damageMult, cls, aliases);
      b = (st.allDamage ?? 0) + (st.classlessDamage ?? 0) + (st[`${cls}Damage`] ?? 0) + Object.entries(aliases ?? {}).reduce((s, [f, t]) => s + (t === cls ? st[`${f}Damage`] ?? 0 : 0), 0);
      c = forClass(extraFx?.damage, cls, aliases);
      break;
    case 'crit':
      a = forClass(fx?.crit, cls, aliases);
      b = (st.allCrit ?? 0) + (st[`${cls}Crit`] ?? 0);
      c = forClass(extraFx?.crit, cls, aliases);
      break;
    case 'critDamage':
      // tML's GetCritDamage, or the ModPlayer field a mod applies its own crit bonus through
      a = forClass(fx?.critDamage, cls, aliases) + CRIT_DAMAGE_FIELDS.reduce((s, k) => s + (fx?.mod?.[k] ?? 0), 0);
      b = st.critDamage ?? 0;
      c = forClass(extraFx?.critDamage, cls, aliases);
      break;
    case 'critFlat':
      // a flat bonus on a critical hit ("Critical strikes deal 30 more damage"), times the chance
      // the line puts on it
      a = (fx?.critFlat ?? 0) + (fx?.mod?.CritBonusDamage ?? 0);
      b = st.critFlat ?? 0;
      return ((a || b) * (st.critFlatChance ?? 1));
    case 'attackSpeed':
      // vanilla only applies generic attack speed to melee swings; a mod that keys it to its own
      // class (Calamity rogue, Thorium bard) applies it itself — in the code, or in text that names
      // the class's own word for it ("5% increased symphonic playing speed")
      a = forClass(fx?.attackSpeed, cls, aliases, { generic: cls === 'melee' });
      aKnown = fxHas(fx?.attackSpeed, cls, aliases, { generic: cls === 'melee' });
      b = (cls === 'melee' ? (st.meleeSpeed ?? 0) + (st.attackSpeed ?? 0) : (st[`${cls}Speed`] ?? 0));
      c = forClass(extraFx?.attackSpeed, cls, aliases, { generic: cls === 'melee' });
      break;
    case 'whipRange': a = fx?.whipRange ?? 0; b = st.whipRange ?? 0; break;
    case 'minionSlots': a = fx?.minionSlots ?? 0; b = st.minionSlots ?? 0; c = extraFx?.minionSlots ?? 0; break;
    case 'sentrySlots': a = fx?.sentrySlots ?? 0; b = st.sentrySlots ?? 0; c = extraFx?.sentrySlots ?? 0; break;
    case 'moveSpeed': a = fx?.moveSpeed ?? 0; b = st.moveSpeed ?? 0; c = extraFx?.moveSpeed ?? 0; break;
    // a percentage of max life is that share of the life a player has when they meet the boss
    case 'maxLife': a = fx?.maxLife ?? 0; b = (st.maxLife ?? 0) + (st.maxLifePct ?? 0) * TYPICAL_MAX_LIFE; c = extraFx?.maxLife ?? 0; break;
    case 'maxMana': a = fx?.maxMana ?? 0; b = st.maxMana ?? 0; c = extraFx?.maxMana ?? 0; break;
    case 'lifeRegen': a = fx?.lifeRegen ?? 0; b = st.lifeRegen ?? 0; c = extraFx?.lifeRegen ?? 0; break;
    case 'endurance': a = fx?.endurance ?? 0; b = st.damageReduction ?? 0; c = extraFx?.endurance ?? 0; break;
    case 'manaCost': a = -(fx?.manaCost ?? 0); b = -(st.manaCost ?? 0); c = -(extraFx?.manaCost ?? 0); break;
    // the void bar: SOTS keeps it on its own ModPlayer fields, and the tooltip says the same thing
    case 'voidGain': a = fx?.mod?.bonusVoidGain ?? 0; b = st.voidGain ?? 0; break;
    case 'voidMaxPool': a = fx?.mod?.voidMeterMax2 ?? 0; b = st.maxVoid ?? 0; break;
    case 'voidCost': a = -(fx?.mod?.voidCost ?? 0); b = -(st.voidCost ?? 0); break;
    case 'voidRegen': a = fx?.mod?.voidRegenSpeed ?? 0; b = st.voidRegen ?? 0; break;
    case 'armorPen': a = forClass(fx?.armorPen, cls, aliases); b = st.armorPen ?? 0; c = forClass(extraFx?.armorPen, cls, aliases); break;
    case 'defense': a = forClass(fx?.defense, cls, aliases); b = st.defense ?? 0; c = forClass(extraFx?.defense, cls, aliases); break;
    case 'aggro': a = fx?.aggro ?? 0; c = extraFx?.aggro ?? 0; break;
    // run acceleration: the code's delta on Player.runAcceleration (base 0.08), or "+25% acceleration" in text
    case 'accel': a = Math.min(1, (fx?.runAccel ?? 0) / 0.08); b = Math.min(1, st.accel ?? 0); break; // capped: past double the base it is a dash
    case 'condAccel': b = st.condAccel ?? 0; break;
    case 'condDefense': b = st.condDefense ?? 0; break;
    case 'condLifeRegen': b = Math.max(0, (st.condLifeRegen ?? 0) - (fx?.lifeRegen ?? 0)); break;
    case 'condEndurance': b = Math.max(0, (st.condEndurance ?? 0) - (fx?.endurance ?? 0)); break;
    case 'potionHeal': b = st.potionHeal ?? 0; break;
    case 'healerHealing': b = st.healerHealing ?? 0; break;
    // class mechanics in prose ("Stealth strikes deal 8% more damage"), keyed by the class the text
    // names; only what the mined effects do not already cover, since the same line often is that effect
    case 'condDamage': b = Math.max(0, condStat(st, 'CondDamage', cls, aliases) - Math.abs(forClass(fx?.damage, cls, aliases) + forClass(fx?.damageMult, cls, aliases))); break;
    case 'condCrit': b = Math.max(0, condStat(st, 'CondCrit', cls, aliases) - Math.abs(forClass(fx?.crit, cls, aliases))); break;
    case 'condArmorPen': b = Math.max(0, condStat(st, 'CondArmorPen', cls, aliases) - Math.abs(forClass(fx?.armorPen, cls, aliases))); break;
    default: return 0;
  }
  // the code's answer when it gave one, the tooltip only where it was silent
  return ((aKnown || a) ? a : b) + c;
}

/** Crit damage a mod keeps on its own ModPlayer field instead of tML's `GetCritDamage`. */
const CRIT_DAMAGE_FIELDS = ['critDamage', 'CritBonusMultiplier'];

/** Life a player has when they meet the boss: the yardstick a "+25% max HP" line is measured on. */
export const TYPICAL_MAX_LIFE = 500;

// `allCondDamage` is a conditional bonus whose line named no class ("up to 20% at 50% life"), so
// every class gets it
const condStat = (st, suffix, cls, aliases) => (st[`${cls}${suffix}`] ?? 0) + (st[`all${suffix}`] ?? 0) + Object.entries(aliases ?? {}).reduce((s, [f, t]) => s + (t === cls ? st[`${f}${suffix}`] ?? 0 : 0), 0);
const COND = 0.5; // a class mechanic only applies part of the time (stealth strikes, after a hit, …)

/**
 * What a stat gated on a *state* is worth, against the same stat always on: "+15 defense while you
 * have Armor Crunch", "10% damage while you have Mushy", "+5 defense when submerged".
 *
 * Much steeper than COND, and deliberately so. A class mechanic (COND) fires on the class's own
 * attack — a rogue throws, the stealth bonus lands, and half the time is honest. A state gate needs
 * a *source*: something has to inflict the debuff, you have to keep eating the mushroom, you have to
 * be in the water. Nothing in the loadout provides it, it does not hold through a boss fight, and it
 * is off entirely in the fights that do not happen to supply it. The mined number is also the value
 * without its guard — the strongest arm of an if/else chain — so counting it at anything like half
 * put Laudanum (14 mutually exclusive "if you have this debuff" arms) at the top of the pre-boss
 * accessory list, ahead of every item that just gives you the stat.
 * ponytail: one factor for every state gate; split it if "while submerged" ever needs to outrank
 * "while you have a debuff nothing here inflicts".
 */
const COND_STATE = 0.15;
const COND_BUNDLE = 0.25; // …and every state-gated stat after the biggest, since they share the condition
const COND_MARK = ' ⅙'; // how a state-gated stat is marked in a part's label (≈ COND_STATE)
const CONDMSG = `Conditional, from the tooltip text (the code applies it elsewhere): something has to supply the condition and it does not hold through a fight, so points count for ${Math.round(COND_STATE * 100)}%.`;

const has = (item, flag) => item.effects?.flags?.includes(flag) || item.flags?.includes(flag);

/** Exclusive accessory groups: one wings, one pair of boots, one shield, one dash. */
export function accessoryGroup(item) {
  if (item.wings) return 'wings'; // a wing slot (Calamity's tracers too)
  if (item.boots) return 'boots'; // a shoe slot
  // boots before the flight flag: rocket boots "allow flight" in their text but are not wings
  if (item.effects?.mod?.rocketBoots || item.effects?.runSpeed || has(item, 'iceSkate') || has(item, 'waterWalk')) return 'boots';
  if (item.effects?.wingTime) return 'wings';
  // a "flight" flag alone is a booster (Soaring Insignia, Aero Stone): it stacks with wings, no group
  if (has(item, 'dash') || has(item, 'dashType')) return 'dash';
  if (has(item, 'noKnockback') || has(item, 'knockbackImmune')) return 'shield';
  return null;
}

/**
 * Score an armor piece or accessory for a class. `prefix` (accessory reforge) adds its effects;
 * `progression` (the stage's progression value) sets what defense and minion slots are worth.
 * @returns {{ score: number, parts: Array<{ label: string, value: number }> }}
 */
/**
 * The class damage and crit the loadout itself carries, read the way `pieceScore` reads a piece —
 * armour, its set bonus, the accessories, wings and boots, each with whatever prefix it is wearing.
 *
 * The DPS model used to guess this: a progression curve (`playerDamage`) stood in for damage, and
 * nothing at all stood in for crit, so every weapon was graded at its printed crit — 4% on a rogue
 * whose loadout actually carries 21. The solver has already picked the gear by the time it grades
 * weapons, so the real number is right there.
 */
export function loadoutBonus(pieces, cls, aliases = {}) {
  let damage = 0;
  let crit = 0;
  for (const p of pieces) {
    const item = p?.item ?? p;
    if (!item) continue;
    const fx = p?.prefix?.effects ?? null;
    damage += mergedStat(item, 'damage', cls, aliases, fx);
    crit += mergedStat(item, 'crit', cls, aliases, fx);
  }
  return { damage, crit };
}

export function pieceScore(item, cls, aliases = {}, { utility = true, prefix = null, progression } = {}) {
  const parts = [];
  const add = (label, value, detail) => { if (Math.abs(value) >= 0.05) parts.push(detail ? { label, value: round1(value), detail } : { label, value: round1(value) }); };
  const extraFx = prefix?.effects ?? null;
  // a tooltip with `{0}` placeholders and effects applied through a ModPlayer flag means the
  // numbers are computed at runtime ("damage based on defense"): what the miner read are the
  // constants in that formula, usually its cap — take them at half
  const dyn = item.placeholders && item.effects?.via?.length ? COND : 1;
  // a stat only conditional tooltip lines mention ("+5 defense when submerged") was read from the code
  // without its guard: half. Labels show the stat as mined; the halving is on the points.
  const isCond = (key) => item.condStats?.includes(key);
  const stat = (key) => mergedStat(item, key, cls, aliases, extraFx);
  const half = (key) => dyn * (isCond(key) ? COND_STATE : 1);
  // the item's own value at its discount, a reforge's contribution in full
  const scaled = (key) => { const own = mergedStat(item, key, cls, aliases, null); return own * half(key) + (stat(key) - own); };
  // the ½ marks the item's own value; a reforge's share is never halved
  const condLabel = (key) => (!mergedStat(item, key, cls, aliases, null) ? '' : isCond(key) ? COND_MARK : dyn < 1 ? ' ½' : '');
  // the eased value of a stat, and a note when the curve took something off
  const ease = (key, x) => soft(x, SOFT[key]);
  const easeNote = (key, x, fmt = (v) => round1(v)) => (Math.abs(soft(x, SOFT[key])) < Math.abs(x) * 0.9 ? `Diminishing returns: ${fmt(x)} counts as ${fmt(soft(x, SOFT[key]))} (the curve flattens past ${fmt(SOFT[key])}).` : undefined);
  const notes = (...xs) => { const t = xs.filter(Boolean).join(' '); return t || undefined; };
  const condDetail = (key) => (!mergedStat(item, key, cls, aliases, null) ? undefined : isCond(key) ? `State-gated: the tooltip only grants this while something holds (a debuff on you, a buff you keep up, water you stand in) and the code's value was read without its guard — usually the biggest arm of an if/else chain. Something outside the loadout has to supply the condition and it does not hold through a fight, so points count for ${Math.round(COND_STATE * 100)}%.` : dyn < 1 ? 'Runtime formula: the tooltip uses placeholders and the effect is applied through a player flag, so the mined numbers are the formula\'s constants (usually its cap). Points are halved.' : undefined);
  const dynLabel = condLabel('');
  const PART_TIME = 'Class mechanic read from the tooltip text; it applies part of the time (stealth strikes, after a hit, for a few seconds), so points are halved.';

  const dmg = stat('damage');
  if (dmg) add(`${pct(dmg)} ${cls} damage${condLabel('damage')}`, scaled('damage') * W.damage, condDetail('damage'));
  const crit = stat('crit');
  if (crit && cls !== 'summon') add(`${sgn(crit)}% crit chance${condLabel('crit')}`, ease('crit', scaled('crit')) * W.crit * pref(cls, 'crit'), notes(condDetail('crit'), easeNote('crit', scaled('crit'), (v) => `${round1(v)}%`)));
  const cdm = stat('critDamage');
  if (cdm && cls !== 'summon') add(`${pct(cdm)} critical strike damage${condLabel('critDamage')}`, scaled('critDamage') * W.critDamage * pref(cls, 'crit'), notes(condDetail('critDamage'), `Only the hits that crit get it: at the ${pct(TYPICAL_CRIT)} crit chance a loadout carries, ${pct(cdm)} crit damage is worth ${pct((cdm * TYPICAL_CRIT) / (1 + TYPICAL_CRIT))} damage.`));
  // a flat bonus on a critical hit is worth its share of one hit, on the hits that crit: a weapon
  // lands about 3 hits a second, so a typical hit at this stage is a third of a typical weapon's DPS
  const cfl = stat('critFlat');
  if (cfl && cls !== 'summon') {
    const typicalHit = typicalDps(progression) / 3;
    add(`${sgn(cfl)} damage on a critical hit`, ((cfl * TYPICAL_CRIT) / typicalHit) * W.damage * dyn,
      `${round1(cfl)} extra damage on the ${pct(TYPICAL_CRIT)} of hits that crit, against a typical ${Math.round(typicalHit)}-damage hit at this stage ≈ ${pct((cfl * TYPICAL_CRIT) / typicalHit)} damage. A flat bonus is worth less every stage.`);
  }
  const spd = stat('attackSpeed');
  if (spd && cls !== 'summon') add(`${pct(spd)} attack speed${condLabel('attackSpeed')}`, ease('attackSpeed', scaled('attackSpeed')) * W.attackSpeed, notes(condDetail('attackSpeed'), easeNote('attackSpeed', scaled('attackSpeed'), pct)));
  if (cls === 'rogue' || cls === 'thrower') {
    const vel = ((item.effects?.mod?.rogueVelocity ?? 0) + (item.effects?.mod?.ThrownVelocity ?? 0)) || (item.stats?.rogueVelocity ?? 0);
    if (vel) add(`${pct(vel)} throwing velocity`, ease('velocity', vel) * W.velocity, easeNote('velocity', vel, pct));
  }
  if (cls === 'summon') {
    const slotW = minionSlotScale(progression);
    const ms = stat('minionSlots');
    if (ms) add(`${sgn(ms)} minion slot${ms > 1 ? 's' : ''}${dynLabel}`, ms * W.minionSlot * slotW * dyn);
    const ss = stat('sentrySlots');
    if (ss) add(`${sgn(ss)} sentry slot${ss > 1 ? 's' : ''}${dynLabel}`, ss * W.sentrySlot * slotW * dyn);
    const wr = stat('whipRange');
    if (wr) add(`${pct(wr)} whip range`, wr * W.whipRange * dyn, 'A longer lash tags the boss from further out; the minions still do the damage.');
  }
  // the void bar is the class's ammunition: how fast it fills, how deep it is, what a shot costs
  if (cls === 'void') {
    const vg = stat('voidGain');
    if (vg) add(`${sgn(vg)} void gain`, ease('voidGain', vg) * W.voidGain * dyn, 'Void comes back faster, so the class shoots more often.');
    const vm = stat('voidMaxPool');
    if (vm) add(`${sgn(vm)} max void`, ease('voidMaxPool', vm) * W.voidMaxPool * dyn, easeNote('voidMaxPool', vm));
    const vc = stat('voidCost');
    if (vc) add(`${pct(-vc)} void cost`, vc * W.manaCost * dyn);
    const vr = stat('voidRegen');
    if (vr) add(`${pct(vr)} void regeneration`, vr * W.voidRegen * dyn);
  }
  if (cls === 'magic' || cls === 'healer' || cls === 'bard') {
    const mc = stat('manaCost');
    if (mc) add(`${pct(mc)} mana cost${dynLabel}`, mc * W.manaCost * dyn);
    const mm = stat('maxMana');
    if (mm) add(`${sgn(mm)} max mana${condLabel('maxMana')}`, ease('maxMana', scaled('maxMana')) * W.maxMana, notes(condDetail('maxMana'), easeNote('maxMana', scaled('maxMana'))));
  }
  const ap = stat('armorPen');
  if (ap) add(`${sgn(ap)} armor pen${dynLabel}`, ease('armorPen', ap * dyn) * W.armorPen, notes(dyn < 1 ? condDetail('') : undefined, easeNote('armorPen', ap * dyn)));
  const cd = stat('condDamage');
  if (cd) add(`${pct(cd)} ${cls} damage ½`, cd * W.damage * COND, PART_TIME);
  const cc = stat('condCrit');
  if (cc && cls !== 'summon') add(`${sgn(cc)}% crit chance ½`, cc * W.crit * pref(cls, 'crit') * COND, PART_TIME);
  const cap = stat('condArmorPen');
  if (cap) add(`${sgn(cap)} armor pen ½`, cap * W.armorPen * COND, PART_TIME);
  // projectiles the item spawns on hit, graded like a small weapon: damage × hits per spawn ÷ seconds
  // per trigger (a stealth strike every 8 s, a plain hit every 3 s — procs have immunity frames and
  // hidden cooldowns — or the cooldown the code or the tooltip states), as a share of a typical
  // weapon's DPS at the stage. Damage is the code's flat base, or a share of the hit that spawned it.
  let stealth = false;
  for (const s of item.effects?.onHit ?? []) {
    if (s.cls && s.cls !== cls && aliases[s.cls] !== cls) continue;
    // the spawn is real even when its damage is not readable (the projectile sets it in AI): worth
    // a token, never the full grade a numbered proc gets
    const trig = s.hurt ? 'when you take damage' : 'on hit';
    // a hurt spawn scaled off the hit is a share of the damage *taken*, which says nothing about
    // what it deals: token it like an unreadable proc
    if (!s.damage && (!s.share || s.hurt)) { add(`spawns ${s.name} ${trig}`, W.onHitUnknown, `The item spawns ${s.name} ${trig}, but the miner could not read what it hits for, so it counts for a flat ${W.onHitUnknown}.`); continue; }
    const hits = onHitHits(s);
    const every = s.hurt ? HURT_EVERY : Math.max(s.stealth ? STEALTH_RECHARGE * 1.6 : 3, (s.cooldown ?? 0) / 60, item.stats?.cooldown ?? 0);
    // a weapon lands about 3 hits a second: a share of one hit is that share ÷ 3 of its DPS; a proc
    // that needs a critical hit fires on ~15% of hits, a random one on its chance
    const trigger = (s.crit ? 0.15 : 1) * (s.chance ?? 1);
    const share = (s.damage ? (s.damage * hits) / every / typicalDps(progression) : (s.share * hits) / 3 / every) * trigger;
    if (s.stealth) stealth = true;
    const what = s.damage ? `${s.damage} base damage` : `${Math.round(s.share * 100)}% of the hit's damage`;
    const capPts = s.hurt ? W.onHurtCap : W.onHitCap;
    const points = Math.min(capPts, share * 100 * dyn);
    const when = s.hurt ? 'when you take damage' : s.stealth ? 'on each stealth strike' : s.crit ? 'on a critical hit (~15% of hits)' : 'on hit';
    const gate = s.chance ? ` with a ${Math.round(s.chance * 100)}% chance` : '';
    const detail = `Spawns ${s.name} ${when}${gate}: ${what} × ${round1(hits)} hit${hits > 1 ? 's' : ''} per spawn (pierce ${s.pen === -1 ? '∞' : s.pen ?? 1}${s.kids ? `, ${s.kids} child projectiles` : ''}), ${s.hurt ? `about once every ${round1(every)} s — you only get hit a handful of times a fight, and taking the hit is the price` : s.stealth ? `one stealth strike every ${round1(every)} s` : `at most every ${round1(every)} s${s.cooldown || item.stats?.cooldown ? ' (its cooldown)' : ' (immunity frames, hidden cooldowns)'}`}`
      + (s.damage ? ` = ${round1((s.damage * hits) / every)} DPS against a typical ${Math.round(typicalDps(progression))} DPS weapon at this stage` : ` against a weapon landing ~3 hits/s`)
      + ` ≈ ${pct(share)} of the weapon's DPS${points < share * 100 * dyn ? `, capped at ${capPts}` : ''}.`;
    add(`${s.name} ${s.hurt ? 'when hit' : s.stealth ? 'per stealth strike' : s.crit ? 'on crit' : 'on hit'}`, points, detail);
  }
  // stealth strike bonuses, and the item is marked. They only touch the strike, so they are worth
  // the share of a rogue's damage the strike is (STEALTH_SHARE) — a rate bonus (a strike that
  // expends less of the bar, a bar that fills faster) buys exactly what the same much more stealth
  // strike damage buys, so it is weighted the same way.
  if (cls === 'rogue' || cls === 'thrower') {
    const st = item.stats ?? {};
    const SS = STEALTH_SHARE;
    const note = SS === 1 ? 'Stealth strikes are how the class fights, so a bonus only they get counts as a full class bonus.' : `A bonus only stealth strikes get counts for ${pct(SS)} of the same bonus on the class.`;
    const sd = condStat(st, 'StealthDamage', cls, aliases);
    if (sd) { add(`${pct(sd)} stealth strike damage`, sd * W.damage * SS, note); stealth = true; }
    const sc = condStat(st, 'StealthCrit', cls, aliases);
    if (sc) { add(`${sgn(sc)}% stealth strike crit`, sc * W.crit * pref(cls, 'crit') * SS, note); stealth = true; }
    const sa = condStat(st, 'StealthArmorPen', cls, aliases);
    if (sa) { add(`${sgn(sa)} stealth strike armor pen`, sa * W.armorPen * SS, note); stealth = true; }
    // a strike that expends 90% of the bar comes round 1/0.9 as often
    const rate = (1 / Math.max(0.1, st.stealthCost ?? 1)) * (1 + (st.stealthRegen ?? 0)) - 1;
    if (rate > 0.005) {
      add(`${pct(rate)} more stealth strikes`, rate * W.damage * SS,
        `${st.stealthCost ? `A strike expends ${pct(st.stealthCost - 1)} of the stealth bar` : ''}${st.stealthCost && st.stealthRegen ? ' and s' : st.stealthRegen ? 'S' : ''}${st.stealthRegen ? `tealth builds ${pct(st.stealthRegen)} faster` : ''}, so strikes come ${pct(rate)} more often. ${note}`);
      stealth = true;
    }
  }

  // the item's own defense field is unconditional; only the code's delta can be
  const effDef = stat('defense');
  const def = (item.defense ?? 0) + effDef;
  // the curve is for accessories: an armor piece's defense is its job, and defenseScale already
  // says what a point is worth at the stage
  const defPts = (item.defense ?? 0) + scaled('defense');
  const isAcc = item.slot === 'accessory';
  // survivability is the class's own: melee stands in the hitbox, everyone else kites (CLASS_PREF.tank)
  const tankNote = pref(cls, 'tank') !== 1 ? `${cls} counts what keeps it alive at ${pref(cls, 'tank')}×: it fights inside the boss's hitbox, so a hit absorbed is a swing it does not spend retreating.` : undefined;
  if (def) add(`${def > 0 ? '+' : ''}${round1(def)} defense${condLabel('defense')}`, (isAcc ? ease('defense', defPts) : defPts) * W.defense * defenseScale(progression) * tank(cls, 'defense'), notes(condDetail('defense'), isAcc ? easeNote('defense', defPts) : undefined, tankNote));
  const cdef = stat('condDefense');
  if (cdef && !stat('defense')) add(`${sgn(cdef)} defense${COND_MARK}`, cdef * COND_STATE * W.defense * defenseScale(progression) * tank(cls, 'defense'), CONDMSG);
  const life = stat('maxLife');
  if (life) add(`${sgn(life)} max life${condLabel('maxLife')}`, ease('maxLife', scaled('maxLife')) * W.maxLife * tank(cls), notes(condDetail('maxLife'), easeNote('maxLife', scaled('maxLife')), tankNote));
  const regen = stat('lifeRegen');
  if (regen) add(`${sgn(regen)} life regen${condLabel('lifeRegen')}`, ease('lifeRegen', scaled('lifeRegen')) * W.lifeRegen * tank(cls), notes(condDetail('lifeRegen'), easeNote('lifeRegen', scaled('lifeRegen')), tankNote));
  const cregen = stat('condLifeRegen');
  if (cregen && !regen) add(`${sgn(cregen)} life regen${COND_MARK}`, ease('lifeRegen', cregen) * W.lifeRegen * tank(cls) * COND_STATE, CONDMSG);
  const dr = stat('endurance');
  if (dr) add(`${pct(dr)} damage reduction${condLabel('endurance')}`, ease('endurance', scaled('endurance')) * W.endurance * tank(cls), notes(condDetail('endurance'), easeNote('endurance', scaled('endurance'), pct), tankNote));
  const cdr = stat('condEndurance');
  if (cdr) add(`${pct(cdr)} damage reduction${COND_MARK}`, ease('endurance', cdr) * W.endurance * tank(cls) * COND_STATE, CONDMSG);
  const ph = stat('potionHeal');
  if (ph) add(`${pct(ph)} healing from potions`, ph * W.potionHeal * dyn, 'More life back per potion, or less time between two of them.');
  if (cls === 'healer') { const hh = stat('healerHealing'); if (hh) add(`${sgn(hh)} life per heal cast`, hh * W.healerHealing); }
  // square root: the first aggro points matter most (a rogue's stealth only buys about −10)
  // square root, then the curve: the first aggro points matter most (a rogue's stealth only buys about −10),
  // and −800 is not four times −200
  const aggro = stat('aggro');
  if (aggro) add(`${aggro > 0 ? '+' : ''}${Math.round(aggro)} aggro`, Math.sign(aggro) * soft(Math.sqrt(Math.abs(aggro)), SOFT.aggro) * W.aggro * pref(cls, 'aggro'), `Aggro counts by its square root (√${Math.abs(Math.round(aggro))} = ${round1(Math.sqrt(Math.abs(aggro)))}) with diminishing returns past 10, times the class's stance on being targeted (${pref(cls, 'aggro')}).`);

  // a drawback the item puts on the player ("Receiving damage has a 50% chance to bleed you"): the
  // chance is never in the code, so every one of them counts as if it lands
  for (const d of item.effects?.selfDebuffs ?? []) add(`self-inflicted debuff (${d})`, -W.selfDebuff, `The item puts ${d} on you. The odds are not in its code, so the drawback counts at full weight.`);

  if (utility) {
    const mv = stat('moveSpeed');
    if (mv) add(`${pct(mv)} movement speed${condLabel('moveSpeed')}`, ease('moveSpeed', scaled('moveSpeed')) * W.moveSpeed, notes(condDetail('moveSpeed'), easeNote('moveSpeed', scaled('moveSpeed'), pct)));
    const acc = stat('accel');
    if (acc) add(`${pct(acc)} acceleration${condLabel('accel')}`, scaled('accel') * W.accel, condDetail('accel'));
    const cacc = stat('condAccel');
    if (cacc && !acc) add(`${pct(cacc)} acceleration${COND_MARK}`, cacc * COND_STATE * W.accel, CONDMSG);
    // per-tick horizontal drag (Calamity's Mollusk pieces: velocity.X *= 0.996 each): the run clamp refills
    // speed every tick, so the sustained loss is about 1 − k of top speed
    const drag = (item.effects?.velocityDrag ?? 1) * (extraFx?.velocityDrag ?? 1);
    if (drag < 1) { const f = sprintFactor(drag); add(`${pct(f - 1)} sprint speed (${pct(drag - 1)} velocity per tick)`, (f - 1) * W.moveSpeed); }
    if (accessoryGroup(item) === 'wings') {
      // flight time in ticks and top speed from the mined WingStats; an unread pair rates as Fledgling Wings
      const ws = item.wingStats ?? { time: item.effects?.wingTime ?? 100, speed: null };
      const speedPts = ws.speed ? Math.max(0, ws.speed - 6) * W.wingSpeed : 0;
      add(`flight: ${ws.time} ticks${ws.speed ? `, speed ${ws.speed}` : ''}`, W.flight + ease('wingTime', ws.time) * W.wingTime + speedPts, easeNote('wingTime', ws.time, (v) => `${Math.round(v)} ticks`));
    } else if (has(item, 'flight')) add('flight boost', W.flightBoost);
    if (item.effects?.runSpeed >= 5 || has(item, 'hasMagiluminescence')) add('run speed', W.runSpeed + Math.max(0, (item.effects?.runSpeed ?? 6) - 6));
    if (has(item, 'noKnockback') || has(item, 'knockbackImmune')) add('knockback immunity', W.noKnockback);
    if (has(item, 'dash') || has(item, 'dashType')) add('dash', W.dash);
    if (has(item, 'jump')) add('extra jump', W.jump);
    if ((item.effects?.jumpBoost ?? 0) > 0) add('jump speed', W.jumpBoost);
    if (has(item, 'iframes')) add('longer invincibility after a hit', W.iframes * tank(cls), tankNote);
    if (has(item, 'meleeSize') && cls === 'melee') add('bigger melee weapons', W.meleeSize);
    if (has(item, 'utility')) add('quality of life', W.utility);
    if (has(item, 'debuffImmune')) add('debuff immunity', W.debuffImmune);
    else if (has(item, 'debuffResist')) add('immunity to some debuffs', W.debuffResist);
    // vanilla keeps its dodge on the Black Belt / Brain of Confusion player flags; a mod's own is
    // read off the tooltip
    if (has(item, 'dodge') || has(item, 'blackBelt') || has(item, 'brainOfConfusion')) add('dodges attacks', W.dodge * tank(cls), notes('A dodged hit now and then: about what immunity to every debuff is worth.', tankNote));
    if (has(item, 'lava') || has(item, 'lavaRose') || has(item, 'fireWalk')) add('lava/fire protection', W.lava);
    if (has(item, 'mobility') || has(item, 'iceSkate') || has(item, 'waterWalk')) add('mobility', W.mobility);
  }

  // One "if", one payment. Every state-gated part of an item hangs off the same condition, and
  // where that condition is an if/else chain — Laudanum's 14 "if you have *this* debuff" arms —
  // you are only ever in one arm of it. The largest gated part counts at COND_STATE; the rest are
  // discounted again, so a bundle of six conditional stats is not six accessories' worth of stats.
  const gated = parts.filter((p) => p.label.endsWith(COND_MARK)).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  for (const p of gated.slice(1)) { p.value = round1(p.value * COND_BUNDLE); p.detail = `${p.detail ?? ''} Another state-gated stat on this item already counts in full; this one hangs off the same condition, so it counts for ${Math.round(COND_BUNDLE * 100)}% of that.`.trim(); }
  const score = parts.reduce((s, p) => s + p.value, 0);
  return { score: round1(score), parts, stealth };
}

/**
 * Top speed under a per-tick velocity multiplier (`Player.velocity.X *= k` every tick, Calamity's
 * Mollusk armor). Running below the base run speed (3 units) re-accelerates at 0.08 per tick, so
 * the drag never bites there; the sprint from boots (up to 6.75) only gets a third of that, so
 * the equilibrium `accel / (1 - k)` caps the sprint. Returns the sprint top speed as a fraction
 * of the boots' 6.75: one Mollusk piece (0.996) costs 1%, the full set (0.988) drops to base speed.
 */
export function sprintFactor(drag) {
  if (!(drag < 1)) return 1;
  const base = 3, sprint = 6.75, accel = 0.08 / 3;
  const v = Math.min(sprint, Math.max(base, accel / (1 - drag)));
  return v / sprint;
}

/** Score of a head piece's set bonus (setEffects + set bonus text). */
export function setBonusScore(head, cls, aliases = {}, { progression } = {}) {
  if (!head.setEffects && !head.setBonus) return { score: 0, parts: [] };
  const pseudo = { effects: head.setEffects, stats: head.setStats, defense: 0, flags: [] };
  const r = pieceScore(pseudo, cls, aliases, { utility: false, progression });
  // Every set bonus does something beyond what the miner can read — a proc, an aura, a dodge — so
  // wearing a full set is worth a flat base on top of whatever came out numbered.
  const t = head.setBonus?.toLowerCase() ?? '';
  const names = { melee: /melee/, ranged: /ranged/, magic: /magic/, summon: /summon|minion|sentry/, rogue: /rogue|stealth/, thrower: /throw/, bard: /symphonic|bard|inspiration|empower/, healer: /radiant|heal/ };
  const classSpecific = !!head.setBonus && !!names[cls]?.test(t);
  r.parts.unshift({ label: classSpecific ? 'set bonus (class-specific)' : 'set bonus', value: classSpecific ? W.setBonusClass : W.setBonus });
  r.score = r.parts.reduce((s, p) => s + p.value, 0);
  return r;
}

/** Does this piece's text or effects clearly target a different class only? */
export function foreignClass(item, cls, aliases = {}) {
  const classes = new Set(item.textClasses ?? []);
  for (const t of ['damage', 'crit', 'attackSpeed']) {
    for (const k of Object.keys(item.effects?.[t] ?? {})) if (k !== 'all' && k !== 'classless') classes.add(aliases[k] ?? k);
  }
  if (!classes.size) return false;
  const mine = new Set([cls, ...Object.entries(aliases).filter(([, to]) => to === cls).map(([f]) => f)]);
  return ![...classes].some((c) => mine.has(c)) && [...classes].some((c) => CLASS_DAMAGE_KEYS[c]);
}

const DEFAULT_CTX = { conds: new Set(), uncertain: false, prefix: null, calibration: null };

/**
 * Weapon damage per second against a boss, from the effective stats (overlays, variants,
 * runtime modifiers, reforge, calibration) and the mined projectile behaviour — see dps.js.
 * `ctx.ds` and `ctx.stage` enable ammo, projectile and next-boss lookups; without them the
 * estimate falls back to damage × rate × crit.
 */
export function weaponDps(item, ctx = DEFAULT_CTX) {
  return realDps(item, ctx);
}

export const round1 = (v) => Math.round(v * 10) / 10;
/** A flat stat in a label, with its sign: a negative one reads "−10 life regen", not "+-10". */
export const sgn = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${round1(Math.abs(v))}`;
export const pct = (v) => `${v > 0 ? '+' : ''}${Math.round(v * 1000) / 10}%`;
