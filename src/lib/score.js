/**
 * Scoring: how good is a piece of equipment for a class?
 *
 * Every number is explainable — scores are sums of labelled parts so the UI can show
 * exactly why something was picked. Weights are deliberately simple:
 *   +1% class damage        = 1 point        (10% damage = 10)
 *   +1% crit chance         = 0.5 point      (crit ≈ half its value in damage)
 *   +1% attack speed        = 0.6 point      (melee/ranged only)
 *   +1 defense              = 0.4 point
 *   +1 minion / sentry slot = 18 / 8 points  (summoner only)
 *   utility flags           = flat points (flight, knockback immunity, dash, …)
 */
import { realDps } from './dps.js';

export const W = {
  damage: 100, crit: 0.5, attackSpeed: 60, defense: 0.4, minionSlot: 18, sentrySlot: 8, moveSpeed: 25,
  maxLife: 0.05, lifeRegen: 1.5, endurance: 60, manaCost: 20, maxMana: 0.03, armorPen: 0.3, aggro: 0,
  flight: 14, wingTime: 0.04, noKnockback: 6, dash: 6, jump: 3, debuffImmune: 5, lava: 2, mobility: 3, utility: 1,
  runSpeed: 8, // boots (Hermes and up): sustained run speed matters in every boss fight
};

const CLASS_DAMAGE_KEYS = { melee: 'melee', ranged: 'ranged', magic: 'magic', summon: 'summon', rogue: 'rogue', thrower: 'thrower', bard: 'bard', healer: 'healer' };

/** Value of a per-class stat table (`{ melee: 0.1, all: 0.05 }`) for a class. */
function forClass(table, cls, aliases) {
  if (!table) return 0;
  let v = (table.all ?? 0) + (table.classless ?? 0);
  if (cls && table[cls]) v += table[cls];
  for (const [from, to] of Object.entries(aliases ?? {})) if (to === cls && table[from]) v += table[from];
  return v;
}

/** Tooltip-parsed stats mirror effects; take the max per key so nothing is counted twice. */
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
      a = forClass(fx?.attackSpeed, cls, aliases);
      b = (cls === 'melee' ? st.meleeSpeed ?? 0 : 0) + (st.attackSpeed ?? 0);
      c = forClass(extraFx?.attackSpeed, cls, aliases);
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
    case 'defense': a = fx?.defense ?? 0; b = st.defense ?? 0; c = extraFx?.defense ?? 0; break;
    default: return 0;
  }
  return (Math.abs(a) >= Math.abs(b) ? a : b) + c;
}

const has = (item, flag) => item.effects?.flags?.includes(flag) || item.flags?.includes(flag);

/** Exclusive accessory groups: one wings, one pair of boots, one shield, one dash. */
export function accessoryGroup(item) {
  if (item.wings || item.effects?.wingTime || has(item, 'flight')) return 'wings';
  if (item.effects?.mod?.rocketBoots || item.effects?.runSpeed || has(item, 'iceSkate') || has(item, 'waterWalk')) return 'boots';
  if (has(item, 'dash') || has(item, 'dashType')) return 'dash';
  if (has(item, 'noKnockback') || has(item, 'knockbackImmune')) return 'shield';
  return null;
}

/**
 * Score an armor piece or accessory for a class. `prefix` (accessory reforge) adds its effects.
 * @returns {{ score: number, parts: Array<{ label: string, value: number }> }}
 */
export function pieceScore(item, cls, aliases = {}, { utility = true, prefix = null } = {}) {
  const parts = [];
  const add = (label, value) => { if (Math.abs(value) >= 0.05) parts.push({ label, value: round1(value) }); };
  const extraFx = prefix?.effects ?? null;

  const dmg = mergedStat(item, 'damage', cls, aliases, extraFx);
  if (dmg) add(`${pct(dmg)} ${cls} damage`, dmg * W.damage);
  const crit = mergedStat(item, 'crit', cls, aliases, extraFx);
  if (crit && cls !== 'summon') add(`+${round1(crit)}% crit`, crit * W.crit);
  const spd = mergedStat(item, 'attackSpeed', cls, aliases, extraFx);
  if (spd && (cls === 'melee' || cls === 'ranged' || cls === 'rogue' || cls === 'thrower')) add(`${pct(spd)} attack speed`, spd * W.attackSpeed);
  if (cls === 'summon') {
    const ms = mergedStat(item, 'minionSlots', cls, aliases, extraFx);
    if (ms) add(`+${ms} minion slot${ms > 1 ? 's' : ''}`, ms * W.minionSlot);
    const ss = mergedStat(item, 'sentrySlots', cls, aliases, extraFx);
    if (ss) add(`+${ss} sentry slot${ss > 1 ? 's' : ''}`, ss * W.sentrySlot);
  }
  if (cls === 'magic' || cls === 'healer' || cls === 'bard') {
    const mc = mergedStat(item, 'manaCost', cls, aliases, extraFx);
    if (mc) add(`${pct(mc)} mana cost`, mc * W.manaCost);
    const mm = mergedStat(item, 'maxMana', cls, aliases, extraFx);
    if (mm) add(`+${mm} max mana`, mm * W.maxMana);
  }
  const ap = mergedStat(item, 'armorPen', cls, aliases, extraFx);
  if (ap) add(`+${round1(ap)} armor pen`, ap * W.armorPen);

  const def = (item.defense ?? 0) + mergedStat(item, 'defense', cls, aliases, extraFx);
  if (def) add(`${def} defense`, def * W.defense);
  const life = mergedStat(item, 'maxLife', cls, aliases, extraFx);
  if (life) add(`+${life} max life`, life * W.maxLife);
  const regen = mergedStat(item, 'lifeRegen', cls, aliases, extraFx);
  if (regen) add(`+${round1(regen)} life regen`, regen * W.lifeRegen);
  const dr = mergedStat(item, 'endurance', cls, aliases, extraFx);
  if (dr) add(`${pct(dr)} damage reduction`, dr * W.endurance);

  if (utility) {
    const mv = mergedStat(item, 'moveSpeed', cls, aliases, extraFx);
    if (mv) add(`${pct(mv)} movement speed`, mv * W.moveSpeed);
    if (item.wings || item.effects?.wingTime || has(item, 'flight')) add('flight', W.flight + (item.effects?.wingTime ?? 0) * W.wingTime);
    if (item.effects?.runSpeed >= 5 || has(item, 'hasMagiluminescence')) add('run speed', W.runSpeed + Math.max(0, (item.effects?.runSpeed ?? 6) - 6) * 4);
    if (has(item, 'noKnockback') || has(item, 'knockbackImmune')) add('knockback immunity', W.noKnockback);
    if (has(item, 'dash') || has(item, 'dashType')) add('dash', W.dash);
    if (has(item, 'jump')) add('extra jump', W.jump);
    if (has(item, 'debuffImmune')) add('debuff immunity', W.debuffImmune);
    if (has(item, 'lava') || has(item, 'lavaRose') || has(item, 'fireWalk')) add('lava/fire protection', W.lava);
    if (has(item, 'mobility') || has(item, 'iceSkate') || has(item, 'waterWalk')) add('mobility', W.mobility);
  }

  const score = parts.reduce((s, p) => s + p.value, 0);
  return { score: round1(score), parts };
}

/** Score of a head piece's set bonus (setEffects + set bonus text). */
export function setBonusScore(head, cls, aliases = {}) {
  if (!head.setEffects && !head.setBonus) return { score: 0, parts: [] };
  const pseudo = { effects: head.setEffects, stats: head.setStats, defense: 0, flags: [] };
  const r = pieceScore(pseudo, cls, aliases, { utility: false });
  if (!r.parts.length && head.setBonus) {
    const t = head.setBonus.toLowerCase();
    const names = { melee: /melee/, ranged: /ranged/, magic: /magic/, summon: /summon|minion|sentry/, rogue: /rogue|stealth/, thrower: /throw/, bard: /symphonic|bard|inspiration|empower/, healer: /radiant|heal/ };
    if (names[cls]?.test(t)) r.parts.push({ label: 'set bonus (class-specific)', value: 8 });
    else r.parts.push({ label: 'set bonus', value: 3 });
    r.score = r.parts.reduce((s, p) => s + p.value, 0);
  }
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
 * `ctx.ds` and `ctx.stage` enable ammo and projectile lookups; without them the estimate
 * falls back to damage × rate × crit.
 */
export function weaponDps(item, ctx = DEFAULT_CTX) {
  return realDps(item, ctx);
}

export const round1 = (v) => Math.round(v * 10) / 10;
export const pct = (v) => `${v > 0 ? '+' : ''}${Math.round(v * 1000) / 10}%`;
