/**
 * Reforge prefixes: the vanilla table (1.4.4 values) plus every `ModPrefix` a mod defines,
 * read from `SetStats(ref damage, ref knockback, ref useTime, ref scale, ref shootSpeed,
 * ref mana, ref crit)`, `Category`, `CanRoll` and `ApplyAccessoryEffects`.
 *
 * Multipliers are stored as fractions: dmg 0.15 = +15%. `useTime` is a use-time factor
 * delta (-0.10 = 10% faster).
 */
import { normalizeEffects, playerHooks } from './effects.js';
import { Machine, PLAYER, THIS, isNum, simpleName, tmlStaticHook, tmlStaticLoadHook } from './interp.js';
import { TYPE_ABSTRACT, derivesFromTml, findInherited } from './util.js';
import { classOf } from '../classify.js';
import { decodeIL } from '../clr/il.js';

const CATEGORY = ['melee', 'ranged', 'magic', 'weapon', 'accessory', 'custom'];

const W = (name, cat, dmg = 0, useTime = 0, crit = 0, kb = 0, size = 0, velocity = 0, mana = 0) => ({ id: `v:${name}`, mod: 'v', name, category: cat, dmg, useTime, crit, kb, size, velocity, mana });
const A = (name, effects) => ({ id: `v:${name}`, mod: 'v', name, category: 'accessory', effects });

/** Vanilla 1.4.4 prefixes. Multipliers as fractions; useTime negative = faster. */
export const VANILLA_PREFIXES = [
  // universal weapon
  W('Keen', 'weapon', 0, 0, 3), W('Superior', 'weapon', 0.10, 0, 3, 0.10), W('Forceful', 'weapon', 0, 0, 0, 0.15),
  W('Broken', 'weapon', -0.30, 0, 0, -0.20), W('Damaged', 'weapon', -0.15), W('Shoddy', 'weapon', -0.10, 0, 0, -0.15),
  W('Hurtful', 'weapon', 0.10), W('Strong', 'weapon', 0, 0, 0, 0.15), W('Unpleasant', 'weapon', 0.05, 0, 0, 0.05),
  W('Weak', 'weapon', 0, 0, 0, -0.20), W('Ruthless', 'weapon', 0.18, 0, 0, -0.10), W('Godly', 'weapon', 0.15, 0, 5, 0.15),
  W('Demonic', 'weapon', 0.15, 0, 5), W('Zealous', 'weapon', 0, 0, 5),
  // melee
  W('Large', 'melee', 0, 0, 0, 0, 0.12), W('Massive', 'melee', 0, 0, 0, 0, 0.18), W('Dangerous', 'melee', 0.05, 0, 2, 0, 0.05),
  W('Savage', 'melee', 0.10, 0, 0, 0.10, 0.10), W('Sharp', 'melee', 0.15), W('Pointy', 'melee', 0.10),
  W('Tiny', 'melee', 0, 0, 0, 0, -0.18), W('Terrible', 'melee', -0.15, 0, 0, -0.15, -0.13), W('Small', 'melee', 0, 0, 0, 0, -0.10),
  W('Dull', 'melee', -0.15), W('Unhappy', 'melee', 0, 0.10, 0, -0.10, -0.10), W('Bulky', 'melee', 0.05, 0.15, 0, 0.10, 0.10),
  W('Shameful', 'melee', -0.10, 0, 0, -0.15, 0.10), W('Heavy', 'melee', 0, 0.10, 0, 0.15), W('Light', 'melee', 0, -0.15, 0, -0.10),
  W('Legendary', 'melee', 0.15, -0.10, 5, 0.15, 0.10),
  // ranged
  W('Sighted', 'ranged', 0.10, 0, 3), W('Rapid', 'ranged', 0, -0.15), W('Hasty', 'ranged', 0, -0.10),
  W('Intimidating', 'ranged', 0, 0, 0, 0.15, 0, 0.05), W('Deadly', 'ranged', 0.10, -0.05, 2, 0.05, 0, 0.05),
  W('Staunch', 'ranged', 0.10, 0, 0, 0.15), W('Awful', 'ranged', -0.15, 0, 0, -0.10, 0, -0.10), W('Lethargic', 'ranged', 0, 0.15),
  W('Awkward', 'ranged', 0, 0.10, 0, -0.20), W('Powerful', 'ranged', 0.15, 0.10, 1), W('Frenzying', 'ranged', -0.15, -0.15),
  W('Unreal', 'ranged', 0.15, -0.10, 5, 0.15, 0, 0.10),
  // magic
  W('Mystic', 'magic', 0.10, 0, 0, 0, 0, 0, -0.15), W('Adept', 'magic', 0, 0, 0, 0, 0, 0, -0.15), W('Masterful', 'magic', 0.15, 0, 0, 0.05, 0, 0, -0.15),
  W('Inept', 'magic', 0, 0, 0, 0, 0, 0, 0.10), W('Ignorant', 'magic', -0.10, 0, 0, 0, 0, 0, 0.20), W('Deranged', 'magic', -0.10, 0, 0, -0.10, 0, 0, 0.10),
  W('Intense', 'magic', 0.10, 0.10, 0, 0, 0, 0, 0.15), W('Taboo', 'magic', 0, -0.10, 0, 0.10, 0, 0, 0.10), W('Celestial', 'magic', 0.10, 0.10, 0, 0.10, 0, 0, -0.10),
  W('Furious', 'magic', 0.15, 0, 0, 0.15, 0, 0, 0.20), W('Manic', 'magic', 0.10, -0.10, 0, 0, 0, 0, -0.10), W('Mythical', 'magic', 0.15, -0.10, 5, 0.15, 0, 0, -0.10),
  // accessories
  A('Hard', { defense: 1 }), A('Guarding', { defense: 2 }), A('Armored', { defense: 3 }), A('Warding', { defense: 4 }),
  A('Precise', { crit: { all: 2 } }), A('Lucky', { crit: { all: 4 } }),
  A('Jagged', { attackSpeed: { melee: 0.01 } }), A('Spiked', { attackSpeed: { melee: 0.02 } }), A('Angry', { attackSpeed: { melee: 0.03 } }), A('Violent', { attackSpeed: { melee: 0.04 } }),
  A('Brisk', { moveSpeed: 0.01 }), A('Fleeting', { moveSpeed: 0.02 }), A('Hasty', { moveSpeed: 0.03 }), A('Quick', { moveSpeed: 0.04 }),
  A('Wild', { damage: { all: 0.01 } }), A('Rash', { damage: { all: 0.02 } }), A('Intrepid', { damage: { all: 0.03 } }), A('Menacing', { damage: { all: 0.04 } }),
  A('Arcane', { maxMana: 20 }),
];

/** Prefixes a mod defines. */
export function extractModPrefixes(asm, { tml, loc, modId }) {
  const out = [];
  for (const td of asm.types) {
    if (td.flags & TYPE_ABSTRACT || td.name.includes('`') || !derivesFromTml(asm, td, 'ModPrefix')) continue;
    const p = { id: `${modId}:${td.name}`, mod: modId, name: loc?.keys.get(`Mods.${modId}.Prefixes.${td.name}.DisplayName`) ?? td.name.replace(/Prefix$/, ''), category: 'custom', dmg: 0, useTime: 0, crit: 0, kb: 0, size: 0, velocity: 0, mana: 0 };
    const simple = new Machine(asm, { tml, concreteType: td, budget: 5000, onCall: (c, a, ctx) => tmlStaticHook(c, a, ctx), onStaticLoad: tmlStaticLoadHook });
    const cat = findInherited(asm, td, 'get_Category');
    if (cat) { const v = simple.run(cat, THIS, []); if (isNum(v) && CATEGORY[v]) p.category = CATEGORY[v]; }

    const ss = findInherited(asm, td, 'SetStats');
    if (ss) {
      const vals = { dmg: 1, kb: 1, useTime: 1, size: 1, velocity: 1, mana: 1, crit: 0 };
      const ref = (key) => ({ k: 'ref', get: () => vals[key], set: (v) => { if (isNum(v)) vals[key] = v; } });
      const m = new Machine(asm, { tml, concreteType: td, budget: 5000, onCall: (c, a, ctx) => tmlStaticHook(c, a, ctx), onStaticLoad: tmlStaticLoadHook });
      m.run(ss, THIS, [ref('dmg'), ref('kb'), ref('useTime'), ref('size'), ref('velocity'), ref('mana'), ref('crit')]);
      p.dmg = round(vals.dmg - 1); p.kb = round(vals.kb - 1); p.useTime = round(vals.useTime - 1); p.size = round(vals.size - 1);
      p.velocity = round(vals.velocity - 1); p.mana = round(vals.mana - 1); p.crit = vals.crit;
    }
    const cr = findInherited(asm, td, 'CanRoll');
    if (cr) {
      const classes = new Set();
      const body = asm.methodBody(cr);
      if (body) {
        for (const ins of decodeIL(body.il)) {
          if (ins.op !== 'call' && ins.op !== 'callvirt') continue;
          const d = asm.resolve(ins.operand);
          if (d?.kind === 'methodSpec' && d.name === 'CountsAsClass') classes.add(classOf(simpleName(d.typeArgs[0])));
          if (d?.kind === 'method' && d.name.startsWith('get_') && d.declaringType?.fullName === 'Terraria.ModLoader.DamageClass') classes.add(classOf(d.name.slice(4)));
        }
      }
      if (classes.size) p.rollsFor = [...classes].filter(Boolean);
    }
    const aae = findInherited(asm, td, 'ApplyAccessoryEffects');
    if (aae) {
      const deltas = [];
      const hooks = playerHooks((d) => deltas.push(d));
      const m = new Machine(asm, { tml, concreteType: td, budget: 8000, onLoad: hooks.onLoad, onStore: hooks.onStore, onCall: hooks.onCall, onStaticLoad: hooks.onStaticLoad });
      m.run(aae, THIS, [PLAYER]);
      const fx = normalizeEffects(deltas);
      if (fx) p.effects = fx;
      if (p.category === 'custom') p.category = 'accessory';
    }
    if (p.category === 'custom' && (p.dmg || p.useTime || p.crit || p.kb)) p.category = 'weapon';
    if (p.dmg === 0 && p.useTime === 0 && p.crit === 0 && p.kb === 0 && p.size === 0 && p.velocity === 0 && p.mana === 0 && !p.effects) continue;
    out.push(p);
  }
  return out;
}

const round = (v) => Math.round(v * 1000) / 1000;
