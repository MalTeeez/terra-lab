/** Small helpers shared by the extractors. */
import { decodeIL } from '../clr/il.js';
import { simpleName } from './interp.js';

export const TYPE_ABSTRACT = 0x80;

/** Does `td` derive (within its assembly) from a tModLoader type of this name? */
export const derivesFromTml = (asm, td, name) =>
  asm.derivesFrom(td, (b) => b.name === name && b.namespace === 'Terraria.ModLoader');

/** Find a method with a body by name, walking up the base chain inside the assembly. */
export function findInherited(asm, td, name, paramCount = null) {
  let cur = td;
  for (let i = 0; i < 32 && cur; i++) {
    const m = cur.methods.find((x) => x.name === name && asm.methodBody(x) && (paramCount === null || asm.methodSig(x).params.length === paramCount));
    if (m) return m;
    const base = asm.baseOf(cur);
    cur = base?.kind === 'typeDef' ? base.def : null;
  }
  return null;
}

/** All `ModContent.<fn><T>()` type arguments referenced by a method body (default: ItemType). */
export function contentRefs(asm, method, fn = 'ItemType') {
  const body = asm.methodBody(method);
  if (!body) return [];
  const out = [];
  let ins;
  try { ins = decodeIL(body.il); } catch { return out; }
  for (const x of ins) {
    if (x.op === 'isinst' && fn === 'ItemType') {
      // `body.ModItem is FrigidRobe`
      const t = asm.resolve(x.operand);
      if (t?.fullName && !/^(System|Terraria)\./.test(t.fullName)) out.push(t.fullName);
      continue;
    }
    if (x.op !== 'call' && x.op !== 'callvirt') continue;
    const d = asm.resolve(x.operand);
    if (d?.kind === 'methodSpec' && d.name === fn && d.declaringType?.fullName === 'Terraria.ModLoader.ModContent') out.push(d.typeArgs[0]);
  }
  return out;
}

/** Does the method body call a method with this name (cheap prefilter)? */
export function callsMethodNamed(asm, method, names) {
  const body = asm.methodBody(method);
  if (!body) return false;
  let ins;
  try { ins = decodeIL(body.il); } catch { return false; }
  for (const x of ins) {
    if (x.op !== 'call' && x.op !== 'callvirt') continue;
    const d = asm.resolve(x.operand);
    if (d && names.has(d.name)) return true;
  }
  return false;
}

/**
 * Canonical id for a content reference: `<AssemblyName>:<ClassName>`.
 * Vanilla ids are numbers → `v:<id>`.
 */
export function refId(asm, ref) {
  if (typeof ref === 'number') return `v:${ref}`;
  if (ref?.k === 'type') { if (ref.id) return ref.id; ref = ref.name; } // `otherMod.Find<ModItem>("X")` knows its mod; the bare name would resolve here
  if (typeof ref !== 'string') return null;
  const owner = asm.assemblyOfType(ref) ?? asm.name;
  return `${owner}:${simpleName(ref)}`;
}

/**
 * tModLoader's `SpawnCondition` statics multiply a spawn chance to zero outside their zone or
 * event, so a `SpawnChance` built out of one is gated by it as surely as an `if`. Only the fields
 * that answer to a progression flag are listed; the rest spawn from the start as far as this can
 * tell, and a body that touches one of those gets no gate at all (they are alternatives).
 */
const SPAWN_CONDITIONS = {
  Dungeon: 'ZoneDungeon', DungeonNormal: 'ZoneDungeon', DungeonGuardian: 'ZoneDungeon',
  JungleTemple: 'ZoneLihzahrdTemple',
  OverworldHallow: 'ZoneHallow',
  HardmodeJungle: 'hardMode', HardmodeJungleWater: 'hardMode', HardmodeCrimsonWater: 'hardMode',
  HardmodeMushroomWater: 'hardMode', SolarEclipse: 'hardMode', FrostMoon: 'hardMode',
  PumpkinMoon: 'hardMode', MartianMadness: 'hardMode', MartianProbe: 'hardMode', Pirates: 'hardMode',
  FrostLegion: 'hardMode', IceGolem: 'hardMode', RainbowSlime: 'hardMode', AngryNimbus: 'hardMode',
  Wraith: 'hardMode', OverworldMimic: 'hardMode', UndergroundMimic: 'hardMode',
  NebulaTower: 'downedGolemBoss', VortexTower: 'downedGolemBoss', StardustTower: 'downedGolemBoss', SolarTower: 'downedGolemBoss',
};

/**
 * Progression flags a method body *requires*: `downed*` / `hardMode` statics (NPC, Main, a
 * mod's DownedBossSystem) and `Zone*` player fields / getters, counted only where the flag
 * being false leads straight to `return 0` / `return false` (`if (!downedX) return 0f;`,
 * `downedX && zone ? c : 0f`). A flag whose truth leads straight to `return true`, or that is
 * returned itself, is one alternative of an OR chain and comes back as `any:<flag>` — the
 * earliest alternative gates. A flag that merely scales a chance (`Main.hardMode ? 0.05f :
 * 0.1f`) is not a gate. Lambdas reached through `ldftn` and helpers on the same type are
 * followed one level.
 */
export function gateRefs(asm, method, { depth = 1, seen = new Set(), tml = null } = {}) {
  const out = new Set();
  if (!method || seen.has(method)) return out;
  seen.add(method);
  const body = asm.methodBody(method);
  if (!body) return out;
  let ins;
  try { ins = decodeIL(body.il); } catch { return out; }
  const at = new Map(ins.map((x, i) => [x.offset, i]));
  const flagName = (x) => {
    if (x.op === 'ldsfld' || x.op === 'ldfld') {
      const name = asm.resolve(x.operand)?.name;
      if (!name) return null;
      if (/^downed/i.test(name) && !/^downedAny|^Not/i.test(name)) return name;
      if (name === 'hardMode') return name;
      if (/^Zone[A-Z]/.test(name)) return name;
      return null;
    }
    if (x.op === 'call' || x.op === 'callvirt') {
      const name = asm.resolve(x.operand)?.name;
      if (name && /^get_(downed|Zone[A-Z]|hardMode)/i.test(name)) return name.slice(4);
    }
    return null;
  };
  /** What execution from instruction i returns within a few steps (following plain br): 0, 1 (any non-zero constant) or null. */
  const returnsConst = (i) => {
    let val = null;
    for (let k = 0; k < 6 && i < ins.length; k++, i++) {
      const y = ins[i];
      if (/^ldc\.i4\.(\d|m1|s)$|^ldc\.(i4|r4|r8)$/.test(y.op)) { const n = y.op === 'ldc.i4.0' ? 0 : /^ldc\.i4\.\d$/.test(y.op) ? +y.op.slice(7) : y.operand ?? 1; val = n === 0 ? 0 : 1; continue; }
      if (/^conv\./.test(y.op)) continue;
      if (y.op === 'br' || y.op === 'br.s') { const j = at.get(y.operand); if (j === undefined) return null; i = j - 1; continue; }
      return y.op === 'ret' ? val : null;
    }
    return null;
  };
  const returnsZero = (i) => returnsConst(i) === 0;
  const returnsOne = (i) => returnsConst(i) === 1;
  /** Does the block [from, toOffset) return something other than a plain 0 (an if/else-if arm that spawns)? */
  const blockReturnsNonZero = (from, toOffset) => {
    for (let k = from; k < ins.length && ins[k].offset < toOffset; k++) if (ins[k].op === 'ret' && returnsConst(k - 1 >= 0 && /^ldc/.test(ins[k - 1].op) ? k - 1 : k) !== 0) return true;
    return false;
  };
  // once one flag's block returns on its own (`if (A && water) return c1; if (B) return c2; return 0`)
  // the later flags are alternatives too, not requirements
  let sawAlternative = false;
  const required = (flag) => out.add(sawAlternative ? `any:${flag}` : flag);
  const conditions = new Set(); // SpawnCondition statics this body builds its chance out of
  for (let i = 0; i < ins.length; i++) {
    const x = ins[i];
    if (x.op === 'ldsfld') {
      const d = asm.resolve(x.operand);
      if (d?.declaringType?.name === 'SpawnCondition') conditions.add(d.name);
    }
    const flag = flagName(x);
    if (flag) {
      const next = ins[i + 1];
      if (!next) continue;
      // `any:` marks an alternative in an OR chain (`downedX || downedY`): the earliest of them gates
      if (next.op === 'ret') { if (sawAlternative) out.add(`any:${flag}`); else required(flag); continue; } // return downedX; (last alternative, or alone: required)
      if (/^brfalse/.test(next.op)) {
        const j = at.get(next.operand);
        if (j !== undefined) {
          if (returnsZero(j)) required(flag);
          else if (returnsOne(j)) { out.add(`any:!${flag}`); sawAlternative = true; } // `flag ? a : b` with b non-zero: the flag is no requirement
          else if (blockReturnsNonZero(i + 2, next.operand)) { out.add(`any:${flag}`); sawAlternative = true; }
        }
        continue;
      }
      if (/^brtrue/.test(next.op)) {
        const j = at.get(next.operand);
        if (returnsZero(i + 2)) required(flag);
        else if (j !== undefined && returnsOne(j)) { out.add(`any:${flag}`); sawAlternative = true; }
        else if (blockReturnsNonZero(i + 2, next.operand)) { out.add(`any:!${flag}`); sawAlternative = true; } // `if (!flag) return x;`: no requirement on this path
        continue;
      }
      continue;
    }
    if ((x.op === 'call' || x.op === 'callvirt') && depth > 0) {
      const d = asm.resolve(x.operand);
      if (d?.def && d.def.declaringType && d.def.declaringType === method.declaringType) { for (const g of gateRefs(asm, d.def, { depth: depth - 1, seen, tml })) out.add(g); continue; }
      // a mod's drop condition that defers to a vanilla one — Thorium's SoulofPlightCondition ends
      // in `Conditions.SoulOfWhateverConditionCanDrop(info)`, and the hardmode requirement is in
      // there, not in the mod. Only the vanilla drop-condition helpers are followed.
      if (tml && !d?.def && /ItemDropRules/.test(d?.declaringType?.fullName ?? '')) {
        const vm = tml.typeByName.get(d.declaringType.fullName)?.methods.find((x) => x.name === d.name && tml.methodBody(x));
        if (vm) for (const g of gateRefs(tml, vm, { depth: depth - 1, seen, tml })) out.add(g);
      }
      continue;
    }
    if (x.op === 'ldftn' && depth > 0) {
      const d = asm.resolve(x.operand);
      if (d?.def) for (const g of gateRefs(asm, d.def, { depth: depth - 1, seen })) out.add(g);
    }
  }
  // every condition must gate for the chance to be gated: one ungated way in is a way in
  const mapped = [...new Set([...conditions].map((n) => SPAWN_CONDITIONS[n]))];
  if (mapped.length && mapped.every(Boolean)) for (const f of mapped) out.add(mapped.length > 1 ? `any:${f}` : f);
  return out;
}
