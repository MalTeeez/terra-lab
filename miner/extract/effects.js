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
import { decodeIL, ldcValue } from '../clr/il.js';
import { ET } from '../clr/sig.js';

/**
 * `Main.debuff` means "cannot be right-clicked away", which is also how the station, transformation
 * and pet-like buffs are flagged: Campfire, Heart Lamp, Sunflower, Peace/Water/Shadow Candle, Star
 * in a Bottle, Cat Bast, Monster Banner, Werewolf, Merfolk, Gel Balloon, Brain of Confusion.
 * Sitting in one of those costs the player nothing, so they are not drawbacks.
 */
const NOT_HARMFUL = new Set([28, 34, 86, 87, 89, 146, 147, 157, 158, 215, 320, 321, 350, 353]);

/**
 * The vanilla debuffs, as `v:<BuffID>` — the ids `Main.Initialize_TileAndNPCData1` writes into
 * `Main.debuff`, less the harmless ones. Only vanilla: a mod sets the same flag on buffs that are
 * plainly good (Calamity marks Tarragon Immunity, so a right-click cannot cancel it), so there the
 * flag says nothing at all — a mod's debuffs are the ones named in `miner/stage/debuffs.json`.
 */
export function extractDebuffs(tml) {
  const out = new Set();
  const main = tml.typeByName.get('Terraria.Main');
  for (const md of main?.methods ?? []) {
    const body = tml.methodBody(md);
    if (!body) continue;
    let ins;
    try { ins = decodeIL(body.il); } catch { continue; }
    for (let i = 0; i < ins.length; i++) {
      if (ins[i].op !== 'ldsfld') continue;
      let f;
      try { f = tml.resolve(ins[i].operand); } catch { continue; }
      if (f?.name !== 'debuff' || !/Terraria\.Main$/.test(f.declaringType?.fullName ?? '')) continue;
      // `Main.debuff[24] = true` — a read of the array (`if (Main.debuff[b])`) has no such shape
      const id = ldcValue(ins[i + 1]);
      if (id !== undefined && !NOT_HARMFUL.has(id) && ldcValue(ins[i + 2]) === 1 && ins[i + 3]?.op?.startsWith('stelem')) out.add(`v:${id}`);
    }
  }
  return [...out];
}

const PLAYER_FIELDS = {
  moveSpeed: 'moveSpeed', maxMinions: 'minionSlots', maxTurrets: 'sentrySlots', statLifeMax2: 'maxLife',
  statManaMax2: 'maxMana', lifeRegen: 'lifeRegen', endurance: 'endurance', manaCost: 'manaCost',
  wingTimeMax: 'wingTime', jumpSpeedBoost: 'jumpBoost', pickSpeed: 'pickSpeed', aggro: 'aggro',
  runAcceleration: 'runAccel', maxRunSpeed: 'runSpeed', accRunSpeed: 'runSpeed', thorns: 'thorns',
  manaRegen: 'manaRegen', manaRegenBonus: 'manaRegen', lifeRegenTime: null, whipRangeMultiplier: 'whipRange',
  jumpBoost: 'jumpBoost', maxFallSpeed: null, extraFall: null, statDefense: 'defense',
};
const STAT_GETTERS = {
  GetDamage: 'damage', GetCritChance: 'crit', GetCritDamage: 'critDamage', GetAttackSpeed: 'attackSpeed', GetKnockback: 'knockback', GetArmorPenetration: 'armorPen',
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
        if (name === 'velocity') return { k: 'stat', kind: 'velocity', cls: 'all' }; // velocity.X *= k → drag
        if (name === 'head') return { k: 'key', slot: 0 };
        if (name === 'body') return { k: 'key', slot: 1 };
        if (name === 'legs') return { k: 'key', slot: 2 };
        // `ref float meleeSpeed`: vanilla's gloves add 0.12 through it (`ldind.r4; add; stind.r4`).
        // Without it only a mod's *subtraction* was read — Calamity takes the glove line's 12% back
        // out — and Feral Claws came out at −12% attack speed instead of the 0 the two add up to.
        if (name === 'meleeSpeed') return { k: 'stat', kind: 'attackSpeed', cls: 'melee' };
        // allDamage / meleeDamage / magicCrit … property refs to StatModifiers
        const m = /^(all|melee|ranged|magic|minion|summon|thrown|generic)(Damage|Crit)$/.exec(name);
        if (m) return { k: 'stat', kind: m[2] === 'Damage' ? 'damage' : 'crit', cls: m[1] === 'all' || m[1] === 'generic' ? 'all' : classOf(m[1]) };
        return 0;
      }
      if (recv?.k === 'modplayer') return 0;
      if (recv?.k === 'obj' && recv.name === 'armorSlot' && name === 'type') return { k: 'key', slot: recv.slot };
      if (recv?.k === 'obj' && recv.name === 'itemArg' && name === 'type') return { k: 'key', slot: 0 };
      if (recv?.k === 'obj' && (recv.name === 'itemArg' || recv.name === 'armorSlot')) return recv.props[name] ?? UNKNOWN;
      if (recv?.k === 'stat' && recv.kind === 'velocity' && name === 'X') return { k: 'stat', kind: 'velocityX', cls: 'all' };
      if (recv?.k === 'stat' && recv.kind === 'velocityX' && name === '@ind') return 1; // current value: a multiplier survives as itself
      if (recv?.k === 'stat') return 0;
      return undefined;
    },
    onStore(recv, name, value, ctx) {
      if (recv?.k === 'stat') {
        if (recv.kind === 'velocityX') { if (name === '@ind' && isNum(value) && value > 0 && value < 1) emit({ stat: 'velocityDrag', value }, ctx); return; }
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
      // players reached from Main in projectile / buff code: Main.LocalPlayer, foreach over Main.ActivePlayers
      if (/Terraria\.Main$/.test(decl) && (name === 'get_LocalPlayer')) return PLAYER;
      if (/Terraria\.Main$/.test(decl) && name === 'get_ActivePlayers') return PLAYERS;
      if (ctx.recv === PLAYERS && name === 'GetEnumerator') return PLAYERS;
      if (ctx.recv === PLAYERS && name === 'get_Current') return PLAYER;
      if (ctx.recv === PLAYERS) return UNKNOWN;
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
      // `player.AddBuff(BuffID.Bleeding, 1020)` in an equip hook: a drawback the item puts on you
      // (which of these are debuffs rather than blessings is decided later, by `extractDebuffs`)
      if (ctx.recv === PLAYER && name === 'AddBuff') {
        const b = args[0];
        const ref = isNum(b) ? `v:${b}` : b?.k === 'type' ? simpleName(b.name) : null;
        if (ref) emit({ stat: `selfBuff:${ref}`, value: 1 }, ctx);
        return UNKNOWN;
      }
      // Modded stat accessors: player.GetModPlayer<X>().something(...) → unknown
      return undefined;
    },
    onStaticLoad: (f) => (f.name === 'player' && /Terraria\.Main$/.test(f.declaringType?.fullName ?? '') ? PLAYERS : tmlStaticLoadHook(f)),
  };
}

/** `Main.player` / `Main.ActivePlayers`: any element is the player. */
const PLAYERS = { k: 'arr', tag: 'players', items: [] };

/** Fold a delta list into a compact effects object. */
export function normalizeEffects(deltas) {
  if (!deltas.length) return null;
  const out = { flags: [] };
  const mod = {};
  const seenFlags = new Set();
  for (const d of deltas) {
    if (d.stat.startsWith('flag:')) { if (!seenFlags.has(d.stat)) { seenFlags.add(d.stat); out.flags.push(d.stat.slice(5)); } continue; }
    if (d.stat.startsWith('modflag:')) { if (!seenFlags.has(d.stat)) { seenFlags.add(d.stat); out.flags.push(d.stat.slice(8)); } continue; }
    if (d.stat.startsWith('selfBuff:')) { (out.selfBuffs ??= []).push(d.stat.slice(9)); continue; }
    if (d.stat.startsWith('mod:')) { mod[d.stat.slice(4)] = (mod[d.stat.slice(4)] ?? 0) + d.value; continue; }
    if (d.stat.startsWith('player:')) { mod[d.stat.slice(7)] = (mod[d.stat.slice(7)] ?? 0) + d.value; continue; }
    if (d.stat === 'velocityDrag') { out.velocityDrag = round((out.velocityDrag ?? 1) * d.value); continue; }
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
    // A drawback hangs off a condition no interpreter can settle ("Receiving damage has a 50%
    // chance to bleed you"), so the buffs the hook can put on the player are collected in a second
    // pass that walks every instruction. Only what the hook itself calls — a drawback written in a
    // helper the hook calls is out of reach.
    if (callsAddBuff(asm, m)) {
      const linear = new Machine(asm, {
        tml,
        concreteType: td,
        linear: true,
        noDead: true,
        maxDepth: 4,
        budget: 20000,
        onLoad: (recv, name, ctx) => (recv === ITEM || recv === THIS ? UNKNOWN : hooks.onLoad(recv, name, ctx)),
        onCall: (callee, args, ctx) => (callee.name === 'AddBuff' ? hooks.onCall(callee, args, ctx) : UNKNOWN),
        onStaticLoad: hooks.onStaticLoad,
      });
      try { linear.run(m, THIS, [PLAYER, ...extraArgs]); } catch { /* the first pass is the record */ }
    }
    return normalizeEffects(dedupe(deltas));
  };
  return {
    equip: run('UpdateEquip', []) ?? run('UpdateAccessory', [0]),
    set: run('UpdateArmorSet', []),
  };
}

/** Does this method call `Player.AddBuff` anywhere, reachable or not? */
function callsAddBuff(asm, md) {
  const body = asm.methodBody(md);
  if (!body) return false;
  let ins;
  try { ins = decodeIL(body.il); } catch { return false; }
  for (const x of ins) {
    if (x.op !== 'call' && x.op !== 'callvirt') continue;
    let d;
    try { d = asm.resolve(x.operand); } catch { continue; }
    if (d?.name === 'AddBuff' && /Terraria\.Player$/.test(d.declaringType?.fullName ?? '')) return true;
  }
  return false;
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
