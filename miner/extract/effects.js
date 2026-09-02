/**
 * Equip effects: what an armor piece, set bonus or accessory does to the player,
 * read from `UpdateEquip` / `UpdateArmorSet` / `UpdateAccessory` IL (mods) or from
 * `Player.GrantArmorBenefits` / `ApplyEquipFunctional` / `UpdateArmorSets` (vanilla).
 *
 * Every recorded delta is `{ stat, cls?, value }`:
 *   damage / crit / attackSpeed / knockback / armorPen   (cls = class key or 'all')
 *   defense, moveSpeed, minionSlots, sentrySlots, maxLife, maxMana, lifeRegen,
 *   endurance (damage reduction), manaCost, wingTime, jumpBoost, pickSpeed, aggro
 *   flag:<name>          boolean player fields set to true (noKnockback, …)
 *   mod:<field>          numeric field on a ModPlayer (rogueStealthMax, …)
 *   modflag:<field>      boolean field on a ModPlayer
 */
import { classOf } from '../classify.js';
import { ITEM, Machine, PLAYER, THIS, UNKNOWN, isNum, simpleName, tmlStaticHook, tmlStaticLoadHook } from './interp.js';
import { findInherited } from './util.js';
import { ET } from '../clr/sig.js';

const PLAYER_FIELDS = {
  moveSpeed: 'moveSpeed', maxMinions: 'minionSlots', maxTurrets: 'sentrySlots', statLifeMax2: 'maxLife',
  statManaMax2: 'maxMana', lifeRegen: 'lifeRegen', endurance: 'endurance', manaCost: 'manaCost',
  wingTimeMax: 'wingTime', jumpSpeedBoost: 'jumpBoost', pickSpeed: 'pickSpeed', aggro: 'aggro',
  runAcceleration: 'runAccel', maxRunSpeed: 'runSpeed', accRunSpeed: 'runSpeed', thorns: 'thorns',
  manaRegen: 'manaRegen', manaRegenBonus: 'manaRegen', lifeRegenTime: null, whipRangeMultiplier: 'whipRange',
  jumpBoost: 'jumpBoost', maxFallSpeed: null, extraFall: null, statDefense: 'defense',
};
const STAT_GETTERS = {
  GetDamage: 'damage', GetCritChance: 'crit', GetAttackSpeed: 'attackSpeed', GetKnockback: 'knockback', GetArmorPenetration: 'armorPen',
  GetTotalDamage: 'damage', GetWeaponDamage: null,
};

const classKeyOf = (v) => (v?.k === 'dc' ? classOf(v.name) : typeof v === 'string' ? classOf(simpleName(v)) : 'all') ?? 'all';

/**
 * Hooks shared by mod and vanilla effect walkers. `emit(delta, ctx)` receives every delta.
 */
export function playerHooks(emit) {
  return {
    onLoad(recv, name, ctx) {
      if (recv === PLAYER) {
        if (name === 'armor') return { k: 'slots' };
        if (name === 'statDefense') return { k: 'stat', kind: 'defense', cls: 'all' };
        if (name === 'head') return { k: 'key', slot: 0 };
        if (name === 'body') return { k: 'key', slot: 1 };
        if (name === 'legs') return { k: 'key', slot: 2 };
        // allDamage / meleeDamage / magicCrit … property refs to StatModifiers
        const m = /^(all|melee|ranged|magic|minion|summon|thrown|generic)(Damage|Crit)$/.exec(name);
        if (m) return { k: 'stat', kind: m[2] === 'Damage' ? 'damage' : 'crit', cls: m[1] === 'all' || m[1] === 'generic' ? 'all' : classOf(m[1]) };
        return 0;
      }
      if (recv?.k === 'modplayer') return 0;
      if (recv?.k === 'obj' && recv.name === 'armorSlot' && name === 'type') return { k: 'key', slot: recv.slot };
      if (recv?.k === 'obj' && recv.name === 'itemArg' && name === 'type') return { k: 'key', slot: 0 };
      if (recv?.k === 'obj' && (recv.name === 'itemArg' || recv.name === 'armorSlot')) return recv.props[name] ?? UNKNOWN;
      if (recv?.k === 'stat') return 0;
      return undefined;
    },
    onStore(recv, name, value, ctx) {
      if (recv?.k === 'stat') {
        if (name === '@ind' && isNum(value) && value !== 0) emit({ stat: recv.kind, cls: recv.cls, value }, ctx);
        else if ((name === 'Base' || name === 'Flat') && isNum(value) && value !== 0) emit({ stat: `${recv.kind}Flat`, cls: recv.cls, value }, ctx);
        else if (name === 'Additive' && isNum(value) && value !== 0) emit({ stat: recv.kind, cls: recv.cls, value: value - 1 }, ctx);
        else if (name === 'Multiplicative' && isNum(value) && value !== 0) emit({ stat: `${recv.kind}Mult`, cls: recv.cls, value: value - 1 }, ctx);
        return;
      }
      if (recv === PLAYER) {
        const isBool = ctx.field?.type?.et === ET.BOOLEAN || ctx.field?.def && ctx.owner.fieldType(ctx.field.def).et === ET.BOOLEAN;
        if (isBool) {
          if (value === 1) emit({ stat: `flag:${name}`, value: 1 }, ctx);
          return;
        }
        const mapped = PLAYER_FIELDS[name];
        if (mapped === null) return;
        if (isNum(value) && value !== 0) emit({ stat: mapped ?? `player:${name}`, value }, ctx);
        return;
      }
      if (recv?.k === 'modplayer') {
        const isBool = ctx.field?.type?.et === ET.BOOLEAN || ctx.field?.def && ctx.owner.fieldType(ctx.field.def).et === ET.BOOLEAN;
        if (isBool) { if (value === 1) emit({ stat: `modflag:${name}`, value: 1 }, ctx); return; }
        if (isNum(value) && value !== 0) emit({ stat: `mod:${name}`, value }, ctx);
      }
    },
    onCall(callee, args, ctx) {
      const hooked = tmlStaticHook(callee, args, ctx);
      if (hooked !== undefined) return hooked;
      const decl = callee.declaringType?.fullName ?? callee.declaringType?.name ?? '';
      const name = callee.name;
      if (ctx.recv === PLAYER && name in STAT_GETTERS) {
        const kind = STAT_GETTERS[name];
        if (!kind) return UNKNOWN;
        const cls = callee.kind === 'methodSpec' ? classKeyOf(callee.typeArgs[0]) : classKeyOf(args[0]);
        return { k: 'stat', kind, cls };
      }
      if (/StatModifier|DefenseStat/.test(decl) && /^op_/.test(name) && args[0]?.k === 'stat') {
        const s = args[0];
        const v = args[1];
        if (isNum(v)) {
          if (name === 'op_Addition') emit({ stat: s.kind, cls: s.cls, value: v }, ctx);
          else if (name === 'op_Subtraction') emit({ stat: s.kind, cls: s.cls, value: -v }, ctx);
          else if (name === 'op_Multiply' && v !== 1) emit({ stat: `${s.kind}Mult`, cls: s.cls, value: v - 1 }, ctx);
          else if (name === 'op_Division' && v !== 0 && v !== 1) emit({ stat: `${s.kind}Mult`, cls: s.cls, value: 1 / v - 1 }, ctx);
        }
        return s;
      }
      if (/StatModifier/.test(decl) && name === 'CombineWith') return args[0];
      // Modded stat accessors: player.GetModPlayer<X>().something(...) → unknown
      return undefined;
    },
    onStaticLoad: tmlStaticLoadHook,
  };
}

/** Fold a delta list into a compact effects object. */
export function normalizeEffects(deltas) {
  if (!deltas.length) return null;
  const out = { flags: [] };
  const mod = {};
  const seenFlags = new Set();
  for (const d of deltas) {
    if (d.stat.startsWith('flag:')) { if (!seenFlags.has(d.stat)) { seenFlags.add(d.stat); out.flags.push(d.stat.slice(5)); } continue; }
    if (d.stat.startsWith('modflag:')) { if (!seenFlags.has(d.stat)) { seenFlags.add(d.stat); out.flags.push(d.stat.slice(8)); } continue; }
    if (d.stat.startsWith('mod:')) { mod[d.stat.slice(4)] = (mod[d.stat.slice(4)] ?? 0) + d.value; continue; }
    if (d.stat.startsWith('player:')) { mod[d.stat.slice(7)] = (mod[d.stat.slice(7)] ?? 0) + d.value; continue; }
    if (d.cls !== undefined) {
      out[d.stat] ??= {};
      out[d.stat][d.cls] = round((out[d.stat][d.cls] ?? 0) + d.value);
    } else {
      out[d.stat] = round((out[d.stat] ?? 0) + d.value);
    }
  }
  if (Object.keys(mod).length) out.mod = Object.fromEntries(Object.entries(mod).map(([k, v]) => [k, round(v)]));
  if (!out.flags.length) delete out.flags;
  return Object.keys(out).length ? out : null;
}

const round = (v) => Math.round(v * 10000) / 10000;

/**
 * Effects of a ModItem: `equip` (UpdateEquip for armor, UpdateAccessory for accessories)
 * and `set` (UpdateArmorSet on the head piece).
 */
export function extractItemEffects(asm, td, { tml }) {
  const run = (methodName, extraArgs) => {
    const m = findInherited(asm, td, methodName);
    if (!m) return null;
    const deltas = [];
    const hooks = playerHooks((d) => deltas.push(d));
    const machine = new Machine(asm, {
      tml,
      concreteType: td,
      maxDepth: 4,
      budget: 20000,
      onLoad: (recv, name, ctx) => (recv === ITEM || recv === THIS ? UNKNOWN : hooks.onLoad(recv, name, ctx)),
      onStore: hooks.onStore,
      onCall: hooks.onCall,
      onStaticLoad: hooks.onStaticLoad,
    });
    machine.run(m, THIS, [PLAYER, ...extraArgs]);
    return normalizeEffects(dedupe(deltas));
  };
  return {
    equip: run('UpdateEquip', []) ?? run('UpdateAccessory', [0]),
    set: run('UpdateArmorSet', []),
  };
}

/** The same store can be visited twice through dup/stobj patterns; keep one per (stat, cls, value, site). */
function dedupe(deltas) {
  const seen = new Set();
  return deltas.filter((d) => {
    const k = `${d.stat}|${d.cls ?? ''}|${d.value}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
