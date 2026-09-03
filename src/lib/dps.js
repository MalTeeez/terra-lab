/**
 * Real DPS: damage per second against a boss-sized target, from everything the miner knows
 * about how a weapon fires — not just damage and use time.
 *
 *   value = hit × rate × crit × hits per use × accuracy × pierce × walls × debuffs × sustain
 *
 *   hit        effective damage (+ the best ammo at the stage for ammo weapons)
 *   rate       uses per second (shots per animation for guns that fire several)
 *   crit       1 + crit% (summons cannot crit)
 *   hits       projectiles per use plus child projectiles (explosions, splits) weighted by where they spawn
 *   accuracy   spread × velocity × gravity × range — the share of projectiles that land on a moving boss
 *   pierce     against the next boss: worms reward pierce, multi-part bosses a little, single targets not at all
 *   walls      projectiles that ignore tiles hit bosses through terrain
 *   debuffs    on-hit debuffs read from the projectile's OnHitNPC
 *   sustain    magic: mana per second the player can keep up
 *
 * Calamity rogue weapons get two numbers: *spam* (normal attacks) and *stealth* (one stealth
 * strike per recharge). The higher one is the weapon's grade, as the class-setup guides do it.
 *
 * Every factor is reported in `parts` so the item card can show the arithmetic.
 */
import { effectiveStats } from './stats.js';

export const TARGET_ANGLE = 0.14; // rad: a 100px-wide boss at ~350px
export const GOOD_VELOCITY = 10; // px/tick where a shot reliably lands on a moving boss
export const STEALTH_RECHARGE = 5; // seconds between stealth strikes (4 s standing still, 8 s moving)
export const STEALTH_MAX_DEFAULT = 0.5; // 50 stealth: an early rogue set

const CHILD_WEIGHT = { kill: 0.6, hit: 0.5, ai: 0.2 }; // how many of the spawned projectiles reach the boss
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const deg = (rad) => `${Math.round((rad * 180) / Math.PI)}°`;

/** Resolve a projectile id against the dataset (or a bare object for tests). */
function proj(ds, id) {
  if (!id || !ds?.projectiles) return null;
  return ds.projectiles[id] ?? null;
}

/** Best ammo of a kind obtainable at the stage. */
export function bestAmmo(ds, kind, stage) {
  const list = ds?.ammoByKind?.get(kind);
  if (!list) return null;
  let best = null;
  for (const a of list) {
    if (stage !== undefined && stage !== null && a.stage !== null && a.stage !== undefined && a.stage > stage) continue;
    if (!best || (a.damage ?? 0) > (best.damage ?? 0)) best = a;
  }
  return best;
}

/** Accuracy of one projectile record against a moving boss. */
export function accuracy(p, { spread = 0, velocity = null }) {
  const parts = [];
  let f = 1;
  const homing = !!p?.homing;
  if (spread > TARGET_ANGLE && !homing) { const s = Math.max(0.15, TARGET_ANGLE / spread); f *= s; parts.push({ label: `spread ${deg(spread)}`, mul: r2(s) }); }
  if (velocity !== null && velocity > 0) {
    const v = velocity * (1 + (p?.updates ?? 0));
    let s = Math.min(1, Math.max(0.55, v / GOOD_VELOCITY));
    if (homing) s = Math.max(s, 0.9);
    if (s < 1) { f *= s; parts.push({ label: `velocity ${r1(v)}`, mul: r2(s) }); }
  }
  if (p?.gravity && !homing) { f *= 0.85; parts.push({ label: 'gravity arc', mul: 0.85 }); }
  if (homing) parts.push({ label: 'homing', mul: 1 });
  return { f, parts };
}

/**
 * The boss fought next at a stage (the one after the stage just cleared): how many NPC parts it
 * has and whether it is a worm. Pierce is worth a lot against a worm, a little against a
 * multi-part boss and nothing against a single target (a projectile hits an NPC once per pass).
 */
export function bossShape(ds, stage) {
  const npcs = ds?.stages?.[(stage ?? -1) + 1]?.npcs ?? [];
  const worm = npcs.some((n) => VANILLA_WORMS.has(n) || /Tail|Segment/i.test(n)) || (npcs.length === 1 && /Head$/.test(npcs[0]));
  const parts = Math.max(npcs.length, ...npcs.map((n) => VANILLA_PARTS[n] ?? 0)) || 1;
  return { parts, worm };
}
// a vanilla stage lists one numeric id per boss: name the worms and the multi-part ones
const VANILLA_WORMS = new Set(['v:13', 'v:134']); // Eater of Worlds, The Destroyer
const VANILLA_PARTS = { 'v:35': 3, 'v:127': 5, 'v:245': 3, 'v:398': 3, 'v:266': 2 }; // Skeletron, Skeletron Prime, Golem, Moon Lord, Brain of Cthulhu
const SINGLE = { parts: 1, worm: false };

/** Per-projectile multipliers that do not depend on aim. */
function projectileFactors(p, parts, label, boss = SINGLE) {
  let f = 1;
  if (!p) return f;
  const shape = boss.worm ? 'worm' : boss.parts > 1 ? `${boss.parts}-part boss` : 'single target';
  if (p.pen === -1) { const s = boss.worm ? 1.5 : boss.parts > 1 ? 1.2 : 1.05; f *= s; parts.push({ label: `${label}infinite pierce (${shape})`, mul: r2(s) }); }
  else if (p.pen > 1 && boss.parts > 1) { const s = 1 + (boss.worm ? 0.08 : 0.04) * Math.min(p.pen - 1, 4); f *= s; parts.push({ label: `${label}pierces ${p.pen} (${shape})`, mul: r2(s) }); }
  if (p.walls) { f *= 1.05; parts.push({ label: `${label}goes through walls`, mul: 1.05 }); }
  if (p.debuffs?.length) { const s = 1 + 0.03 * Math.min(p.debuffs.length, 3); f *= s; parts.push({ label: `${label}inflicts ${p.debuffs.length} debuff${p.debuffs.length > 1 ? 's' : ''}`, mul: r2(s) }); }
  return f;
}

/** Child projectiles (explosions, splits, periodic shots) as extra weighted hits. */
function childHits(ds, p, depth = 0) {
  if (!p?.children || depth > 1) return 0;
  let n = 0;
  for (const c of p.children) {
    const w = CHILD_WEIGHT[c.where] ?? 0.3;
    n += Math.min(c.count, 6) * w * 0.75;
    n += childHits(ds, proj(ds, c.type), depth + 1) * 0.5;
  }
  return Math.min(n, 2);
}

/**
 * One firing variant (spam or stealth): hits per use and their accuracy.
 * @returns {{ hits: number, f: number, parts: Array, spawnsDefault: boolean }}
 */
function variantHits(item, ds, fire, variant, base, boss) {
  const parts = [];
  const primaryId = variant === 'stealth' && fire?.stealthMods?.type ? fire.stealthMods.type : fire?.typeOverride ?? base.primaryId;
  const primary = proj(ds, primaryId);
  const calls = (fire?.calls ?? []).filter((c) => !c.variant || c.variant === variant);
  const dflt = fire?.defaultShot ? fire.defaultShot[variant] : !fire?.calls?.length || fire?.returnsTrue === true;
  const velMul = (variant === 'stealth' && fire?.stealthMods?.velMul) || fire?.velMul || 1;
  const shotVelocity = base.shootSpeed ? base.shootSpeed * velMul : null;

  // group if/else alternatives by region: alternatives do not add up
  const groups = new Map();
  for (const c of calls) {
    const key = c.region ?? 'top';
    const g = groups.get(key) ?? { hits: 0, f: 0, n: 0, parts: [] };
    const p = c.type === 'shoot' ? primary : proj(ds, c.type);
    const n = c.count ?? 1;
    const acc = accuracy(p, { spread: c.spread ?? 0, velocity: c.abs ?? (shotVelocity ? shotVelocity * (c.velMul ?? 1) : null) });
    const pf = projectileFactors(p, acc.parts, '', boss);
    const dm = c.dmgMul ?? 1;
    const ch = childHits(ds, p);
    g.hits += n * dm;
    g.f += n * dm * acc.f * pf * (1 + ch / Math.max(1, n));
    g.n += n;
    g.parts.push(...acc.parts.map((x) => ({ ...x, label: `${n > 1 ? `${n}× ` : ''}${x.label}` })));
    if (ch) g.parts.push({ label: `child projectiles (+${r1(ch)} hits)`, mul: r2(1 + ch / Math.max(1, n)) });
    groups.set(key, g);
  }
  let hits = 0;
  let weighted = 0;
  const top = groups.get('top');
  if (top) { hits += top.hits; weighted += top.f; parts.push(...top.parts); }
  const alts = [...groups.entries()].filter(([k]) => k !== 'top').map(([, g]) => g).sort((a, b) => b.f - a.f);
  if (alts.length) { hits += alts[0].hits; weighted += alts[0].f; parts.push(...alts[0].parts); }
  if (dflt || !calls.length) {
    const acc = accuracy(primary, { spread: 0, velocity: shotVelocity });
    const pf = projectileFactors(primary, acc.parts, '', boss);
    const ch = childHits(ds, primary);
    hits += 1;
    weighted += acc.f * pf * (1 + ch);
    parts.push(...acc.parts);
    if (ch) parts.push({ label: `child projectiles (+${r1(ch)} hits)`, mul: r2(1 + ch) });
  }
  const f = hits > 0 ? weighted / hits : 1;
  // a single boss cannot absorb a whole barrage: diminishing returns past 4 hits per use
  const eff = hits <= 4 ? hits : Math.min(12, 4 + (hits - 4) * 0.5);
  if (hits > 1.001) parts.unshift({ label: `${r1(hits)} projectiles per use${eff < hits ? ` (${r1(eff)} land)` : ''}`, mul: r1(eff) });
  return { hits: eff, f, parts, primary };
}

/** Calamity's stealth strike damage multiplier for a weapon at full stealth. */
export function stealthMultiplier(useTime, stealthMax = STEALTH_MAX_DEFAULT, weaponMult = 1) {
  const timeFactor = 0.75 + 0.75 * (Math.log(Math.max(1, useTime) + 2) / Math.log(4));
  const genFactor = Math.max(1.5, Math.pow(4 / (0.8 * 0.5 + 0.2 * 1), 2 / 3)); // moving 80% of the time
  return 1 + stealthMax * 0.42 * timeFactor * genFactor * weaponMult;
}

/**
 * @param {object} item
 * @param {object} ctx     stat context (conds, uncertain, prefix, calibration) + optional ds, stage, stealthMax, boss
 * @returns {{ value: number, kind: 'dps'|'per hit', mode: 'spam'|'stealth'|null, dps: number|null, rate: number|null, critMult: number, eff: object, parts: Array, hit: number, spam?: number, stealth?: number }}
 */
export function realDps(item, ctx = {}) {
  const ds = ctx.ds ?? null;
  const cls = item.cls ?? item.class;
  const eff = effectiveStats(item, ctx);
  const parts = [];
  const isAmmo = item.useAmmo > 0;
  const ammo = isAmmo ? bestAmmo(ds, item.useAmmo, ctx.stage) : null;
  let hit = eff.damage + (ammo?.damage ?? 0);
  parts.push({ label: ammo ? `${eff.damage} + ${ammo.damage} (${ammo.name})` : `${eff.damage} damage`, value: hit });
  const primaryId = isAmmo ? ammo?.shoot ?? null : item.shoot ?? null;
  const primary = proj(ds, primaryId);

  // ---- summons: damage per slot × attack rate
  if (cls === 'summon' && primary?.minion) {
    const local = primary.local;
    let hps = local ? Math.min(60 / local, 3) : 2;
    const ranged = (primary.children ?? []).filter((c) => c.where === 'ai');
    if (ranged.length) hps = 1.5 * Math.min(4, ranged.reduce((s, c) => s + c.count, 0));
    const slots = primary.slots || 1;
    parts.push({ label: `${r1(hps)} hits/s per minion`, mul: r1(hps) });
    if (slots !== 1) parts.push({ label: `${slots} minion slot${slots > 1 ? 's' : ''}`, mul: r2(1 / slots) });
    const value = (hit * hps) / slots;
    return { value, kind: 'dps', mode: 'minion', dps: value, rate: null, critMult: 1, eff, parts, hit };
  }
  if (cls === 'summon' && primary?.sentry) {
    const hps = primary.local ? Math.min(60 / primary.local, 3) : 1.5;
    parts.push({ label: `${r1(hps)} hits/s per sentry`, mul: r1(hps) });
    const value = hit * hps * 0.8;
    parts.push({ label: 'stationary', mul: 0.8 });
    return { value, kind: 'dps', mode: 'sentry', dps: value, rate: null, critMult: 1, eff, parts, hit };
  }
  if (cls === 'summon' && !primary && !item.shoot) return { value: hit, kind: 'per hit', mode: null, dps: null, rate: null, critMult: 1, eff, parts, hit };

  // ---- rate
  const shootsSomething = !!item.shoot || !!item.fire?.calls?.length || item.useAmmo > 0;
  const trueMelee = !item.noMelee && (item.useStyle === 1 || item.useStyle === undefined) && cls !== 'summon' && (cls === 'melee' || !shootsSomething);
  const ut = eff.useTime || eff.useAnimation || 0;
  const ua = eff.useAnimation || eff.useTime || 0;
  const time = Math.max(ut, ua) + (item.reuseDelay ?? 0);
  if (!time) return { value: hit, kind: 'per hit', mode: null, dps: null, rate: null, critMult: 1, eff, parts, hit };
  const perAnim = !trueMelee && ut > 0 && ua > ut * 1.5 ? Math.max(1, Math.round(ua / ut)) : 1;
  const rate = (60 * perAnim) / time;
  parts.push({ label: perAnim > 1 ? `${perAnim} shots every ${r1(time)} ticks` : `every ${r1(time)} ticks`, mul: r2(rate), unit: '/s' });
  const critMult = cls === 'summon' ? 1 : 1 + Math.min(100, eff.crit) / 100;
  if (critMult !== 1) parts.push({ label: `${eff.crit}% crit`, mul: r2(critMult) });

  // ---- hits per use and their accuracy
  const fire = item.fire ?? null;
  const base = { primaryId, shootSpeed: item.shootSpeed ?? null };
  const boss = ctx.boss ?? bossShape(ds, ctx.stage);
  const shoots = !!primaryId || !!fire?.calls?.length || isAmmo;
  const variant = (name) => {
    const vparts = [];
    let hitsF = 1;
    if (trueMelee) { hitsF = 0.7; vparts.push({ label: 'contact range', mul: 0.7 }); }
    if (shoots) {
      const v = variantHits(item, ds, fire, name, base, boss);
      const projF = v.hits * v.f;
      if (trueMelee && item.shoot) { hitsF = 0.7 + projF; vparts.push(...v.parts); }
      else if (!trueMelee) { hitsF = projF; vparts.push(...v.parts); }
    }
    return { hitsF, parts: vparts };
  };
  let sustain = 1;
  if (item.mana > 0 && (cls === 'magic' || cls === 'healer' || cls === 'bard')) {
    const mps = eff.mana * rate;
    sustain = Math.min(1, Math.max(0.5, 25 / mps));
    if (sustain < 1) parts.push({ label: `${r1(mps)} mana/s`, mul: r2(sustain) });
  }

  const spam = variant('spam');
  const spamValue = hit * rate * critMult * spam.hitsF * sustain;
  const out = { kind: 'dps', mode: null, rate: r2(rate), critMult, eff, hit, parts: [...parts, ...spam.parts], spam: spamValue, value: spamValue, dps: spamValue };

  // ---- Calamity rogue: stealth strike as the alternative grade
  if (fire?.stealth && (cls === 'rogue' || cls === 'thrower')) {
    const st = variant('stealth');
    const smax = ctx.stealthMax ?? STEALTH_MAX_DEFAULT;
    const dmgMul = fire.stealthMods?.dmgMul ?? fire.stealthMult ?? 1;
    const mult = stealthMultiplier(time, smax, dmgMul);
    const bonus = fire.stealthMods?.type || fire.calls?.some((c) => c.variant === 'stealth') ? 1.15 : 1;
    const stealthValue = (hit * mult * critMult * st.hitsF * bonus) / STEALTH_RECHARGE;
    out.stealth = stealthValue;
    out.stealthParts = [
      { label: `${eff.damage} damage`, value: hit },
      { label: `stealth strike ×${r2(mult)} (max stealth ${Math.round(smax * 100)}${dmgMul !== 1 ? `, weapon ×${r2(dmgMul)}` : ''})`, mul: r2(mult) },
      ...(bonus > 1 ? [{ label: 'stealth projectile does more', mul: bonus }] : []),
      ...st.parts,
      { label: `one strike per ${STEALTH_RECHARGE} s`, mul: r2(1 / STEALTH_RECHARGE) },
    ];
    if (stealthValue > spamValue) { out.mode = 'stealth'; out.value = stealthValue; out.dps = stealthValue; }
    else out.mode = 'spam';
  }
  return out;
}
