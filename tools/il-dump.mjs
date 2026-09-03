#!/usr/bin/env node
/**
 * Print the IL of a method, operands resolved — for checking what the miner sees.
 *
 *   node tools/il-dump.mjs tml Terraria.NPC SpawnNPC
 *   node tools/il-dump.mjs CalamityMod MolluskShellmet UpdateArmorSet     (type by simple or full name, or re:<regex>; methods too)
 *   node tools/il-dump.mjs ThoriumMod ButterflyStaff                      (list the type's methods)
 *   node tools/il-dump.mjs CalamityMod --grep molluskHelmet               (methods whose IL mentions a member)
 */
import { readFileSync } from 'node:fs';
import { loadAssembly } from '../miner/clr/metadata.js';
import { decodeIL, ldcValue } from '../miner/clr/il.js';
import { defaultPaths, resolveMods } from '../miner/resolve.js';
import { readTmodFile } from '../miner/tmod.js';

const [modName, typeName, methodName] = process.argv.slice(2);
const paths = defaultPaths();
let asm;
if (modName === 'tml') asm = loadAssembly(readFileSync(process.env.TML_DLL ?? paths.tmlDll));
else {
  const { resolved } = resolveMods([modName], paths);
  if (!resolved.length) { console.error(`no .tmod for ${modName}`); process.exit(1); }
  const tmod = readTmodFile(resolved[0].path);
  asm = loadAssembly(tmod.entries.get(`${tmod.name}.dll`).read());
}
const opName = (x) => {
  if (x.operand === undefined) return '';
  if (x.op === 'ldstr') return JSON.stringify(asm.userString(x.operand));
  const v = ldcValue(x);
  if (v !== undefined) return String(v);
  if (/^(br|b[a-z]{2}|leave)/.test(x.op)) return `→${x.operand}`;
  if (x.op === 'switch') return `→${JSON.stringify(x.operand)}`;
  if (/^(ldarg|starg|ldloc|stloc|ldarga|ldloca)/.test(x.op)) return String(x.operand);
  let d;
  try { d = asm.resolve(x.operand); } catch { return `tok ${x.operand.toString(16)}`; }
  if (!d) return `tok ${x.operand.toString(16)}`;
  const decl = d.declaringType?.fullName ?? d.declaringType?.name ?? '';
  const ta = d.typeArgs?.length ? `<${d.typeArgs.map((t) => t.fullName ?? t.name ?? t).join(',')}>` : '';
  return `${decl}${decl ? '::' : ''}${d.name ?? d.fullName ?? ''}${ta}`;
};
const dump = (td, md) => {
  const body = asm.methodBody(md);
  console.log(`\n${td.fullName}::${md.name} (${asm.methodSig(md).params.length} params${body ? `, ${body.il.length} bytes` : ', no body'})`);
  if (!body) return;
  for (const x of decodeIL(body.il)) console.log(`  ${String(x.offset).padStart(5)}  ${x.op.padEnd(12)} ${opName(x)}`);
};
if (typeName === '--grep') {
  const needle = methodName;
  for (const td of asm.types) for (const md of td.methods) {
    const body = asm.methodBody(md);
    if (!body) continue;
    let ins; try { ins = decodeIL(body.il); } catch { continue; }
    if (ins.some((x) => typeof x.operand === 'number' && x.op !== 'ldstr' && !/^(br|b[a-z]{2}|leave|ldc|ldarg|starg|ldloc|stloc|ldarga|ldloca|switch)/.test(x.op) && opName(x).includes(needle))) console.log(`${td.fullName}::${md.name}`);
  }
  process.exit(0);
}
const types = asm.types.filter((t) => t.fullName === typeName || t.name === typeName || (typeName.startsWith("re:") && new RegExp(typeName.slice(3)).test(t.fullName)));
if (!types.length) { console.error('no such type'); process.exit(1); }
for (const td of types) {
  if (!methodName) { console.log(td.fullName); for (const m of td.methods) console.log(`  ${m.name}(${asm.methodSig(m).params.length})${asm.methodBody(m) ? '' : ' [no body]'}`); continue; }
  for (const md of td.methods) if (md.name === methodName || (methodName.startsWith("re:") && new RegExp(methodName.slice(3)).test(md.name))) dump(td, md);
}
