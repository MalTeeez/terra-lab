/**
 * Scoring: how good is a piece of equipment for a class?
 *
 * Every number is explainable — scores are sums of labelled parts so the UI can show
 * exactly why something was picked. Weights are deliberately simple:
 *   +1% class damage        = 1 point        (10% damage = 10)
 *   +1% crit chance         = 0.7 point      (crit doubles a hit: +1% crit ≈ +0.9% DPS at 10% base)
 *   +1% attack speed        = 0.6 point      (all-class attack speed only swings melee weapons)
 *   +1 defense              = 0.5 point      × defenseScale(progression): worth twice that pre-boss
 *   +1 minion / sentry slot = 100 / 30 points × minionSlotScale(progression): a slot is 1/N of DPS
 *   aggro                   = 0.8 point per √unit (80 → 7, 400 → 16), sign by class: melee tolerates it, everyone else pays
 *   class mechanics in text = the stat at half ("Stealth strikes deal 8% more damage" = 4 for a rogue)
 *   utility flags           = flat points (flight, knockback immunity, dash, …)
 * CLASS_PREF multiplies these per class: a rogue's +1% crit is 1 point (as much as 1% damage), melee rates defense at 1.25×.
 */
import { STEALTH_RECHARGE, realDps } from './dps.js';

export const W = {
  damage: 100, crit: 0.7, attackSpeed: 60, defense: 0.5, minionSlot: 100, sentrySlot: 30, moveSpeed: 25,
  maxLife: 0.05, lifeRegen: 1.2, endurance: 60, manaCost: 20, maxMana: 0.03, armorPen: 0.5, aggro: 0.8,
  flight: 10, wingTime: 0.04, wingSpeed: 2, flightBoost: 5, noKnockback: 1.5, dash: 2, jump: 3, jumpBoost: 1, accel: 4, debuffImmune: 5, lava: 2, mobility: 3, utility: 1,
  runSpeed: 2, // boots (Hermes and up): a little, wings and dashes do the real moving in a boss fight
  velocity: 20, // rogue: +10% throwing velocity = 2 (a faster projectile lands more often, see dps.js)
  onHitCap: 15, // a proc never outranks a damage emblem
  // a full set's bonus is worth something even when its text is unreadable (a proc, an aura, a dodge)
  setBonus: 5, setBonusClass: 8,
};

/**
 * What each class cares about beyond the shared weights, as multipliers on W. Aggro is a
 * preference rather than a DPS term (it only decides whom enemies target in multiplayer), but a
 * rogue never wants the boss on them and a melee player can hold it: positive means "wants aggro".
 */
export const CLASS_PREF = {
  melee: { defense: 1.25, aggro: 0.3 },
  ranged: { crit: 1.2, aggro: -1 },
  magic: { crit: 1.1, aggro: -1 },
  summon: { aggro: -1.3 },
  rogue: { crit: 1.43, aggro: -1.5 }, // 0.7 × 1.43 = 1 point per 1% crit: the same as 1% damage
  thrower: { crit: 1.43, aggro: -1.5 },
  bard: { aggro: -1 },
  healer: { aggro: -1 },
};
const pref = (cls, k) => CLASS_PREF[cls]?.[k] ?? (k === 'aggro' ? -1 : 1);

/**
 * Worth of a point of defense at a progression value. A boss hit grows from ~30 pre-boss to ~500
 * at the end of Calamity, so the same 10 defense shrinks from a third of a hit to a fiftieth.
 * Inverse-log of progression: ×2.1 pre-boss, ×1 at Wall of Flesh (7), ×0.67 at the end (28).
 */
export const defenseScale = (progression) => 2.3 / Math.log(3 + Math.max(0, progression ?? 7));

/**
 * A minion slot is worth 1/N of a summoner's DPS at N slots, and N grows about one per three
 * progression points (1 pre-boss, 3 at Wall of Flesh, 7 at Moon Lord, 10 at the end).
 */
export const minionSlotScale = (progression) => 1 / (1 + Math.max(0, progression ?? 7) / 3);

/**
 * A typical weapon's DPS at a progression value, the yardstick for damage an accessory deals on
 * its own (a spike per stealth strike, a flash on hit): ~40 pre-boss, ~160 at Wall of Flesh,
 * ~1200 at Moon Lord, ~12000 at the end of Calamity.
 */
export const typicalDps = (progression) => 40 * 1.22 ** Math.max(0, progression ?? 7);

/**
 * Diminishing returns for stats that stop helping past a point: slope 1 near zero, an ease-out
 * cubic that flattens to `cap` by three times it. Damage stays linear (it adds to the total);
 * crit flattens (nothing above 100% helps), movement, damage reduction, regen, defense and
 * aggro all pay less the more a single item piles on.
 */
export const soft = (x, cap) => { const t = Math.min(1, Math.abs(x) / (3 * cap)); return Math.sign(x) * cap * (1 - (1 - t) ** 3); };
export const SOFT = { crit: 25, attackSpeed: 0.25, moveSpeed: 0.3, endurance: 0.2, lifeRegen: 8, maxLife: 100, maxMana: 100, armorPen: 25, defense: 12, velocity: 0.3, aggro: 10, wingTime: 200 };

/** Hits one spawned projectile lands: its pierce (or life ÷ immunity frames when infinite), plus half its children. */
export function onHitHits(s) {
  const kids = (s.kids ?? 0) * 0.5;
  if (s.pen === -1) return Math.min(4, Math.max(1, (s.life ?? 60) / Math.max(1, s.local ?? 10))) + kids;
  return Math.min(4, Math.max(1, s.pen ?? 1)) + kids;
}

const CLASS_DAMAGE_KEYS = { melee: 'melee', ranged: 'ranged', magic: 'magic', summon: 'summon', rogue: 'rogue', thrower: 'thrower', bard: 'bard', healer: 'healer' };

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
    case 'attackSpeed':
      // vanilla only applies generic attack speed to melee swings; a mod that keys it to its own
      // class (Calamity rogue, Thorium bard) applies it itself
      a = forClass(fx?.attackSpeed, cls, aliases, { generic: cls === 'melee' });
      b = (cls === 'melee' ? (st.meleeSpeed ?? 0) + (st.attackSpeed ?? 0) : 0);
      c = forClass(extraFx?.attackSpeed, cls, aliases, { generic: cls === 'melee' });
      break;
    case 'minionSlots': a = fx?.minionSlots ?? 0; b = st.minionSlots ?? 0; c = extraFx?.minionSlots ?? 0; break;
    case 'sentrySlots': a = fx?.sentrySlots ?? 0; b = st.sentrySlots ?? 0; c = extraFx?.sentrySlots ?? 0; break;
    case 'moveSpeed': a = fx?.moveSpeed ?? 0; b = st.moveSpeed ?? 0; c = extraFx?.moveSpeed ?? 0; break;
    case 'maxLife': a = fx?.maxLife ?? 0; b = st.maxLife ?? 0; c = extraFx?.maxLife ?? 0; break;
    case 'maxMana': a = fx?.maxMana ?? 0; b = st.maxMana ?? 0; c = extraFx?.maxMana ?? 0; break;
    case 'lifeRegen': a = fx?.lifeRegen ?? 0; b = st.lifeRegen ?? 0; c = extraFx?.lifeRegen ?? 0; break;
    case 'endurance': a = fx?.endurance ?? 0; b = st.damageReduction ?? 0; c = extraFx?.endurance ?? 0; break;
    case 'manaCost': a = -(fx?.manaCost ?? 0); b = -(st.manaCost ?? 0); c = -(extraFx?.manaCost ?? 0); break;
    case 'armorPen': a = forClass(fx?.armorPen, cls, aliases); b = st.armorPen ?? 0; c = forClass(extraFx?.armorPen, cls, aliases); break;
    case 'defense': a = forClass(fx?.defense, cls, aliases); b = st.defense ?? 0; c = forClass(extraFx?.defense, cls, aliases); break;
    case 'aggro': a = fx?.aggro ?? 0; c = extraFx?.aggro ?? 0; break;
    // run acceleration: the code's delta on Player.runAcceleration (base 0.08), or "+25% acceleration" in text
    case 'accel': a = Math.min(1, (fx?.runAccel ?? 0) / 0.08); b = Math.min(1, st.accel ?? 0); break; // capped: past double the base it is a dash
    case 'condAccel': b = st.condAccel ?? 0; break;
    case 'condDefense': b = st.condDefense ?? 0; break;
    // class mechanics in prose ("Stealth strikes deal 8% more damage"), keyed by the class the text
    // names; only what the mined effects do not already cover, since the same line often is that effect
    case 'condDamage': b = Math.max(0, condStat(st, 'CondDamage', cls, aliases) - Math.abs(forClass(fx?.damage, cls, aliases) + forClass(fx?.damageMult, cls, aliases))); break;
    case 'condCrit': b = Math.max(0, condStat(st, 'CondCrit', cls, aliases) - Math.abs(forClass(fx?.crit, cls, aliases))); break;
    case 'condArmorPen': b = Math.max(0, condStat(st, 'CondArmorPen', cls, aliases) - Math.abs(forClass(fx?.armorPen, cls, aliases))); break;
    default: return 0;
  }
  return (a || b) + c;
}

const condStat = (st, suffix, cls, aliases) => (st[`${cls}${suffix}`] ?? 0) + Object.entries(aliases ?? {}).reduce((s, [f, t]) => s + (t === cls ? st[`${f}${suffix}`] ?? 0 : 0), 0);
const COND = 0.5; // a class mechanic only applies part of the time (stealth strikes, after a hit, …)

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
  const half = (key) => dyn * (isCond(key) ? COND : 1);
  // the item's own value at its discount, a reforge's contribution in full
  const scaled = (key) => { const own = mergedStat(item, key, cls, aliases, null); return own * half(key) + (stat(key) - own); };
  // the ½ marks the item's own value; a reforge's share is never halved
  const condLabel = (key) => ((dyn < 1 || isCond(key)) && mergedStat(item, key, cls, aliases, null) ? ' ½' : '');
  // the eased value of a stat, and a note when the curve took something off
  const ease = (key, x) => soft(x, SOFT[key]);
  const easeNote = (key, x, fmt = (v) => round1(v)) => (Math.abs(soft(x, SOFT[key])) < Math.abs(x) * 0.9 ? `Diminishing returns: ${fmt(x)} counts as ${fmt(soft(x, SOFT[key]))} (the curve flattens past ${fmt(SOFT[key])}).` : undefined);
  const notes = (...xs) => { const t = xs.filter(Boolean).join(' '); return t || undefined; };
  const condDetail = (key) => (!mergedStat(item, key, cls, aliases, null) ? undefined : dyn < 1 ? 'Runtime formula: the tooltip uses placeholders and the effect is applied through a player flag, so the mined numbers are the formula\'s constants (usually its cap). Points are halved.' : isCond(key) ? 'Conditional: the tooltip only grants this under a condition, but the code\'s value was read without its guard. Points are halved.' : undefined);
  const dynLabel = condLabel('');
  const PART_TIME = 'Class mechanic read from the tooltip text; it applies part of the time (stealth strikes, after a hit, for a few seconds), so points are halved.';

  const dmg = stat('damage');
  if (dmg) add(`${pct(dmg)} ${cls} damage${condLabel('damage')}`, scaled('damage') * W.damage, condDetail('damage'));
  const crit = stat('crit');
  if (crit && cls !== 'summon') add(`+${round1(crit)}% crit chance${condLabel('crit')}`, ease('crit', scaled('crit')) * W.crit * pref(cls, 'crit'), notes(condDetail('crit'), easeNote('crit', scaled('crit'), (v) => `${round1(v)}%`)));
  const spd = stat('attackSpeed');
  if (spd && cls !== 'summon') add(`${pct(spd)} attack speed${condLabel('attackSpeed')}`, ease('attackSpeed', scaled('attackSpeed')) * W.attackSpeed, notes(condDetail('attackSpeed'), easeNote('attackSpeed', scaled('attackSpeed'), pct)));
  if (cls === 'rogue' || cls === 'thrower') {
    const vel = ((item.effects?.mod?.rogueVelocity ?? 0) + (item.effects?.mod?.ThrownVelocity ?? 0)) || (item.stats?.rogueVelocity ?? 0);
    if (vel) add(`${pct(vel)} throwing velocity`, ease('velocity', vel) * W.velocity, easeNote('velocity', vel, pct));
  }
  if (cls === 'summon') {
    const slotW = minionSlotScale(progression);
    const ms = stat('minionSlots');
    if (ms) add(`+${ms} minion slot${ms > 1 ? 's' : ''}${dynLabel}`, ms * W.minionSlot * slotW * dyn);
    const ss = stat('sentrySlots');
    if (ss) add(`+${ss} sentry slot${ss > 1 ? 's' : ''}${dynLabel}`, ss * W.sentrySlot * slotW * dyn);
  }
  if (cls === 'magic' || cls === 'healer' || cls === 'bard') {
    const mc = stat('manaCost');
    if (mc) add(`${pct(mc)} mana cost${dynLabel}`, mc * W.manaCost * dyn);
    const mm = stat('maxMana');
    if (mm) add(`+${mm} max mana${condLabel('maxMana')}`, ease('maxMana', scaled('maxMana')) * W.maxMana, notes(condDetail('maxMana'), easeNote('maxMana', scaled('maxMana'))));
  }
  const ap = stat('armorPen');
  if (ap) add(`+${round1(ap)} armor pen${dynLabel}`, ease('armorPen', ap * dyn) * W.armorPen, notes(dyn < 1 ? condDetail('') : undefined, easeNote('armorPen', ap * dyn)));
  const cd = stat('condDamage');
  if (cd) add(`${pct(cd)} ${cls} damage ½`, cd * W.damage * COND, PART_TIME);
  const cc = stat('condCrit');
  if (cc && cls !== 'summon') add(`+${round1(cc)}% crit chance ½`, cc * W.crit * pref(cls, 'crit') * COND, PART_TIME);
  const cap = stat('condArmorPen');
  if (cap) add(`+${round1(cap)} armor pen ½`, cap * W.armorPen * COND, PART_TIME);
  // projectiles the item spawns on hit, graded like a small weapon: damage × hits per spawn ÷ seconds
  // per trigger (a stealth strike every 8 s, a plain hit every 3 s — procs have immunity frames and
  // hidden cooldowns — or the cooldown the code or the tooltip states), as a share of a typical
  // weapon's DPS at the stage. Damage is the code's flat base, or a share of the hit that spawned it.
  let stealth = false;
  for (const s of item.effects?.onHit ?? []) {
    if (s.cls && s.cls !== cls && aliases[s.cls] !== cls) continue;
    if (!s.damage && !s.share) continue;
    const hits = onHitHits(s);
    const every = Math.max(s.stealth ? STEALTH_RECHARGE * 1.6 : 3, (s.cooldown ?? 0) / 60, item.stats?.cooldown ?? 0);
    // a weapon lands about 3 hits a second: a share of one hit is that share ÷ 3 of its DPS; a proc
    // that needs a critical hit fires on ~15% of hits, a random one on its chance
    const trigger = (s.crit ? 0.15 : 1) * (s.chance ?? 1);
    const share = (s.damage ? (s.damage * hits) / every / typicalDps(progression) : (s.share * hits) / 3 / every) * trigger;
    if (s.stealth) stealth = true;
    const what = s.damage ? `${s.damage} base damage` : `${Math.round(s.share * 100)}% of the hit's damage`;
    const points = Math.min(W.onHitCap, share * 100 * dyn);
    const when = s.stealth ? 'on each stealth strike' : s.crit ? 'on a critical hit (~15% of hits)' : 'on hit';
    const gate = s.chance ? ` with a ${Math.round(s.chance * 100)}% chance` : '';
    const detail = `Spawns ${s.name} ${when}${gate}: ${what} × ${round1(hits)} hit${hits > 1 ? 's' : ''} per spawn (pierce ${s.pen === -1 ? '∞' : s.pen ?? 1}${s.kids ? `, ${s.kids} child projectiles` : ''}), ${s.stealth ? `one stealth strike every ${round1(every)} s` : `at most every ${round1(every)} s${s.cooldown || item.stats?.cooldown ? ' (its cooldown)' : ' (immunity frames, hidden cooldowns)'}`}`
      + (s.damage ? ` = ${round1((s.damage * hits) / every)} DPS against a typical ${Math.round(typicalDps(progression))} DPS weapon at this stage` : ` against a weapon landing ~3 hits/s`)
      + ` ≈ ${pct(share)} of the weapon's DPS${points < share * 100 * dyn ? `, capped at ${W.onHitCap}` : ''}.`;
    add(`${s.name} ${s.stealth ? 'per stealth strike' : s.crit ? 'on crit' : 'on hit'}`, points, detail);
  }
  // stealth strike bonuses: a rogue's full stat (stealth strikes are the class's grade), and the item is marked
  if (cls === 'rogue' || cls === 'thrower') {
    const st = item.stats ?? {};
    const sd = condStat(st, 'StealthDamage', cls, aliases);
    if (sd) { add(`${pct(sd)} stealth strike damage`, sd * W.damage); stealth = true; }
    const sc = condStat(st, 'StealthCrit', cls, aliases);
    if (sc) { add(`+${round1(sc)}% stealth strike crit`, sc * W.crit * pref(cls, 'crit')); stealth = true; }
    const sa = condStat(st, 'StealthArmorPen', cls, aliases);
    if (sa) { add(`+${round1(sa)} stealth strike armor pen`, sa * W.armorPen); stealth = true; }
  }

  // the item's own defense field is unconditional; only the code's delta can be
  const effDef = stat('defense');
  const def = (item.defense ?? 0) + effDef;
  // the curve is for accessories: an armor piece's defense is its job, and defenseScale already
  // says what a point is worth at the stage
  const defPts = (item.defense ?? 0) + scaled('defense');
  const isAcc = item.slot === 'accessory';
  if (def) add(`${def > 0 ? '+' : ''}${round1(def)} defense${condLabel('defense')}`, (isAcc ? ease('defense', defPts) : defPts) * W.defense * defenseScale(progression) * pref(cls, 'defense'), notes(condDetail('defense'), isAcc ? easeNote('defense', defPts) : undefined));
  const cdef = stat('condDefense');
  if (cdef && !stat('defense')) add(`+${round1(cdef)} defense ½`, cdef * COND * W.defense * defenseScale(progression) * pref(cls, 'defense'), 'Conditional, from the tooltip text (the code applies it elsewhere): points are halved.');
  const life = stat('maxLife');
  if (life) add(`+${life} max life${condLabel('maxLife')}`, ease('maxLife', scaled('maxLife')) * W.maxLife, notes(condDetail('maxLife'), easeNote('maxLife', scaled('maxLife'))));
  const regen = stat('lifeRegen');
  if (regen) add(`+${round1(regen)} life regen${condLabel('lifeRegen')}`, ease('lifeRegen', scaled('lifeRegen')) * W.lifeRegen, notes(condDetail('lifeRegen'), easeNote('lifeRegen', scaled('lifeRegen'))));
  const dr = stat('endurance');
  if (dr) add(`${pct(dr)} damage reduction${condLabel('endurance')}`, ease('endurance', scaled('endurance')) * W.endurance, notes(condDetail('endurance'), easeNote('endurance', scaled('endurance'), pct)));
  // square root: the first aggro points matter most (a rogue's stealth only buys about −10)
  // square root, then the curve: the first aggro points matter most (a rogue's stealth only buys about −10),
  // and −800 is not four times −200
  const aggro = stat('aggro');
  if (aggro) add(`${aggro > 0 ? '+' : ''}${Math.round(aggro)} aggro`, Math.sign(aggro) * soft(Math.sqrt(Math.abs(aggro)), SOFT.aggro) * W.aggro * pref(cls, 'aggro'), `Aggro counts by its square root (√${Math.abs(Math.round(aggro))} = ${round1(Math.sqrt(Math.abs(aggro)))}) with diminishing returns past 10, times the class's stance on being targeted (${pref(cls, 'aggro')}).`);

  if (utility) {
    const mv = stat('moveSpeed');
    if (mv) add(`${pct(mv)} movement speed${condLabel('moveSpeed')}`, ease('moveSpeed', scaled('moveSpeed')) * W.moveSpeed, notes(condDetail('moveSpeed'), easeNote('moveSpeed', scaled('moveSpeed'), pct)));
    const acc = stat('accel');
    if (acc) add(`${pct(acc)} acceleration${condLabel('accel')}`, scaled('accel') * W.accel, condDetail('accel'));
    const cacc = stat('condAccel');
    if (cacc && !acc) add(`${pct(cacc)} acceleration ½`, cacc * COND * W.accel, 'Conditional, from the tooltip text (the code multiplies it in a way the miner cannot read): points are halved.');
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
    if (has(item, 'debuffImmune')) add('debuff immunity', W.debuffImmune);
    if (has(item, 'lava') || has(item, 'lavaRose') || has(item, 'fireWalk')) add('lava/fire protection', W.lava);
    if (has(item, 'mobility') || has(item, 'iceSkate') || has(item, 'waterWalk')) add('mobility', W.mobility);
  }

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
export const pct = (v) => `${v > 0 ? '+' : ''}${Math.round(v * 1000) / 10}%`;
