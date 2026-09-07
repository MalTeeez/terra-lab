/**
 * Effective stats: what a weapon / piece is worth after everything that can modify it.
 *
 *   mined base ─▶ balancing overlays (already applied by the miner; `base` keeps the original)
 *              ─▶ difficulty variants (`variants`, applied when their condition is active)
 *              ─▶ runtime modifiers (`mods`: ModifyWeaponDamage / Crit / UseTimeMultiplier)
 *              ─▶ reforge prefix
 *              ─▶ calibration factor (from the in-game values the user entered)
 *
 * Every step is reported in `chain` so the item card can show the arithmetic.
 */

/** @typedef {{ conds: Set<string>, uncertain: boolean, prefix?: object|null, calibration?: { factor: (cls) => number }, balanceMods?: Set<string>|null }} StatCtx */

/**
 * Which mods are allowed to rebalance this item. `ctx.balanceMods` unset (the app's default) means
 * the full installed context; a set narrows it to those mods, and an item's own mod always counts —
 * that is what lets a guide be judged against the balance its own content set actually ships with.
 */
const balanceAllowed = (item, ctx, mod) => !ctx?.balanceMods || mod === undefined || mod === item.mod || ctx.balanceMods.has(mod);

export function activeVariants(item, ctx) {
  if (!item.variants) return [];
  const conds = ctx instanceof Set ? ctx : ctx.conds;
  return item.variants.filter((v) => (!v.cond || v.cond.every((c) => conds.has(c))) && balanceAllowed(item, ctx instanceof Set ? null : ctx, v.mod));
}

/** Modifiers that apply under the current conditions. */
export function activeMods(item, ctx) {
  if (!item.mods) return [];
  return item.mods.filter((m) => {
    if (m.conditional && !ctx.uncertain) return false;
    if (m.cond && !m.cond.every((c) => ctx.conds.has(c))) return false;
    return balanceAllowed(item, ctx, m.mod);
  });
}

/**
 * @param {object} item
 * @param {StatCtx} ctx
 * @returns {{ damage: number, crit: number, useTime: number, useAnimation: number, mana: number, knockback: number, chain: Array<{ label: string, damage?: number, crit?: number, useTime?: number }> }}
 */
export function effectiveStats(item, ctx) {
  const chain = [];
  const b = item.base ?? {};
  let damage = b.damage ?? item.damage ?? 0;
  let crit = b.crit ?? item.crit ?? 4;
  let useTime = b.useTime ?? item.useTime ?? item.useAnimation ?? 0;
  let useAnimation = b.useAnimation ?? item.useAnimation ?? item.useTime ?? 0;
  let mana = item.mana ?? 0;
  let knockback = item.knockback ?? 0;
  const push = (label) => chain.push({ label, damage: r(damage), crit: r(crit), useTime: r(useTime) });

  push(item.base ? 'mined from the item\'s own mod' : 'mined');
  // replay the balancing overlays the miner applied, so each row shows the value at that step
  for (const c of item.changes ?? []) {
    if (!balanceAllowed(item, ctx, c.mod)) continue;
    if (c.field === 'damage') damage = c.to;
    else if (c.field === 'crit') crit = c.to;
    else if (c.field === 'useTime') useTime = c.to;
    else if (c.field === 'useAnimation') useAnimation = c.to;
    push(`${c.mod} ${c.hook}${c.field ? `: ${c.field} ${c.from} → ${c.to}` : ' (effects)'}`);
  }
  // whatever the replay did not cover (fields not tracked above), end on the miner's final values —
  // but only when every overlay was replayed: the point of a narrowed balance context is that the
  // mined final value, which has all of them baked in, is exactly what must not be restored
  if (!ctx.balanceMods) {
    damage = item.damage ?? damage;
    crit = item.crit ?? crit;
    useTime = item.useTime ?? useTime;
    useAnimation = item.useAnimation ?? useAnimation;
  }

  for (const v of activeVariants(item, ctx)) {
    if (v.field === 'damage') damage = v.to;
    else if (v.field === 'crit') crit = v.to;
    else if (v.field === 'useTime') useTime = v.to;
    else if (v.field === 'useAnimation') useAnimation = v.to;
    else continue;
    push(`${v.mod} (${v.cond.join('+')}): ${v.field} → ${v.to}`);
  }

  let mul = 1;
  let add = 0;
  let flat = 0;
  let critAdd = 0;
  let useMul = 1;
  for (const m of activeMods(item, ctx)) {
    if (m.kind === 'damage') { if (m.mul) mul *= m.mul; if (m.add) add += m.add; if (m.flat) flat += m.flat; }
    else if (m.kind === 'crit') critAdd += m.add ?? 0;
    else if (m.kind === 'useTime') useMul *= m.mul ?? 1;
    const parts = [m.mul && m.mul !== 1 ? `×${r(m.mul)}` : '', m.add ? `${m.add > 0 ? '+' : ''}${Math.round(m.add * 100)}%` : '', m.flat ? `${m.flat > 0 ? '+' : ''}${m.flat} flat` : ''].filter(Boolean).join(' ');
    chain.push({ label: `${m.mod} ${m.hook} ${parts}${m.conditional ? ' (uncertain)' : ''}`, mod: m });
  }
  if (mul !== 1 || add !== 0 || flat !== 0 || critAdd || useMul !== 1) {
    damage = damage * mul * (1 + add) + flat;
    crit += critAdd;
    useTime *= useMul;
    useAnimation *= useMul;
    push('after runtime modifiers');
  }

  if (ctx.prefix) {
    const p = ctx.prefix;
    damage *= 1 + (p.dmg ?? 0);
    crit += p.crit ?? 0;
    useTime *= 1 + (p.useTime ?? 0);
    useAnimation *= 1 + (p.useTime ?? 0);
    mana *= 1 + (p.mana ?? 0);
    knockback *= 1 + (p.kb ?? 0);
    push(`${p.name} reforge`);
  }

  const factor = ctx.calibration?.factor?.(item.cls ?? item.class) ?? 1;
  if (factor !== 1) {
    damage *= factor;
    push(`calibrated ×${r(factor)}`);
  }

  return { damage: Math.round(damage), crit: r(crit), useTime: r(useTime), useAnimation: r(useAnimation), mana: r(mana), knockback: r(knockback), chain };
}

const r = (v) => Math.round(v * 100) / 100;

/** Which prefixes can a weapon of this class roll? */
export function prefixesFor(item, prefixes, aliases = {}) {
  if (item.slot === 'accessory') return prefixes.filter((p) => p.category === 'accessory');
  if (item.slot !== 'weapon') return [];
  const cls = item.cls ?? item.class;
  const classAliases = new Set([cls, ...Object.entries(aliases).filter(([, to]) => to === cls).map(([from]) => from)]);
  // …and what the weapon's own `MeleePrefix` / `RangedPrefix` / `MagicPrefix` / `WeaponPrefix`
  // hooks say, where the mod wrote them (`prefixRolls`). That is the only thing that can put a
  // class the mod invented onto a vanilla reforge table — Thorium's healer weapons take the magic
  // table, a whip takes the melee one, a SOTS void sword rolls Legendary while the void bow beside
  // it rolls Unreal — and a pool the hooks did not answer for keeps the vanilla rule below.
  const rolls = item.prefixRolls ?? null;
  const pick = (own) => prefixes.filter((p) => {
    if (p.category === 'accessory' || p.category === 'custom') return false;
    if (own) return !!p.rollsFor?.some((c) => classAliases.has(c));
    if (p.rollsFor?.length) return p.rollsFor.some((c) => classAliases.has(c));
    if (p.category === 'weapon') return rolls?.weapon !== false;
    if (rolls && rolls[p.category] !== undefined) return rolls[p.category];
    // vanilla categories: summon/rogue/thrower/bard/healer weapons only roll universal prefixes
    return p.category === cls;
  });
  // a weapon whose own `ChoosePrefix` rolls out of its mod's set never reaches the vanilla table:
  // a Thorium instrument gets Fabled, never Godly. Unless that leaves it nothing — an addon's
  // hybrid inherits the hook without being of the class the set rolls for, and a weapon that can
  // be reforged at all is better read by the ordinary rule than given an empty list.
  if (rolls?.only) { const mine = pick(true); if (mine.length) return mine; }
  return pick(false);
}

/** The prefix that maximises DPS for a weapon (or class score for an accessory). */
export function bestPrefix(item, prefixes, ctx, { dpsOf, scoreOf }) {
  const options = prefixesFor(item, prefixes, ctx.aliases);
  let best = null;
  let bestVal = -Infinity;
  for (const p of options) {
    const v = item.slot === 'weapon' ? dpsOf(item, p) : scoreOf(item, p);
    if (v > bestVal) { bestVal = v; best = p; }
  }
  return best;
}
