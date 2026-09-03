/**
 * Wing flight stats: `ArmorIDs.Wing.Sets.Stats[slot] = new WingStats(flyTime, speed, acceleration)`.
 * Mods set theirs in `SetStaticDefaults`; vanilla fills the whole table in
 * `Terraria.Initializers.WingStatsInitializer.Load`. WingStats is a struct, so the element is
 * usually constructed in place (ldelema + call .ctor): the ctor hook below records the arguments
 * on the element the interpreter created for it.
 */
import { Machine, THIS, UNKNOWN, isNum } from './interp.js';
import { findInherited } from './util.js';

const isWingStats = (v) => v?.k === 'obj' && /WingStats$/.test(v.name) && isNum(v.args?.[0]);
const pick = (v) => ({ time: v.args[0], speed: isNum(v.args[1]) ? Math.round(v.args[1] * 100) / 100 : null, accel: isNum(v.args[2]) ? Math.round(v.args[2] * 100) / 100 : null });
const isStatsField = (f) => f.name === 'Stats' && /Wing/.test(f.declaringType?.fullName ?? f.declaringType?.name ?? '');
const declName = (callee) => callee.declaringType?.fullName ?? callee.declaringType?.name ?? '';

/** `WingStats(...)` constructed in place on an array element: keep the arguments on that element. */
function ctorHook(callee, args, ctx) {
  if (callee.name === '.ctor' && /WingStats$/.test(declName(callee)) && ctx.recv?.k === 'obj') {
    ctx.recv.name = 'WingStats';
    ctx.recv.args = args;
    return UNKNOWN;
  }
  return undefined;
}

/** A mod item's wing stats from its SetStaticDefaults, or null when it sets none. */
export function extractWingStats(asm, td, { tml }) {
  const m = findInherited(asm, td, 'SetStaticDefaults');
  if (!m) return null;
  let found = null;
  const stats = { k: 'arr', items: [], tag: 'wingStats' };
  const machine = new Machine(asm, {
    tml, budget: 20000, maxDepth: 2,
    onStaticLoad: (f) => (isStatsField(f) ? stats : undefined),
    onArrayStore: (arr, idx, val) => { if (arr === stats && val?.k === 'obj') found = val; },
    onCall: ctorHook,
  });
  try { machine.run(m, THIS, []); } catch { /* partial is fine */ }
  return isWingStats(found) ? pick(found) : null;
}

/** Vanilla wing slot → stats, from the initializer that builds the table. */
export function vanillaWingStats(tml) {
  const out = new Map();
  const td = tml.typeByName.get('Terraria.Initializers.WingStatsInitializer');
  const load = td?.methods.find((m) => m.name === 'Load');
  if (!load) return out;
  let table = null;
  const machine = new Machine(tml, {
    tml, budget: 60000, maxDepth: 1,
    onStaticStore: (f, val) => { if (isStatsField(f) && val?.k === 'arr') table = val; },
    onStaticLoad: (f) => (isStatsField(f) && table ? table : undefined),
    onCall: ctorHook,
  });
  try { machine.run(load, undefined, []); } catch { /* partial is fine */ }
  for (const [i, v] of (table?.items ?? []).entries()) if (isWingStats(v)) out.set(i, pick(v));
  return out;
}
