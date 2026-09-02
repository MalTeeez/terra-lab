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
  if (ref?.k === 'type') ref = ref.name;
  if (typeof ref !== 'string') return null;
  const owner = asm.assemblyOfType(ref) ?? asm.name;
  return `${owner}:${simpleName(ref)}`;
}
