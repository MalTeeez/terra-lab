#!/usr/bin/env node
/**
 * Which methods load a string matching a regex — for finding code that names content by string
 * rather than by type (`Mod.Find<ModItem>("EssenceOfGold")`, dialogue keys, shop tags).
 *
 *   node tools/find-str.mjs StarsAbove Essence
 *   node tools/find-str.mjs tml "Angler"
 */
import { readFileSync } from 'node:fs';
import { loadAssembly } from '../miner/clr/metadata.js';
import { decodeIL } from '../miner/clr/il.js';
import { defaultPaths, resolveMods } from '../miner/resolve.js';
import { readTmodFile } from '../miner/tmod.js';

const [modName, pattern] = process.argv.slice(2);
const paths = defaultPaths();
let asm;
if (modName === 'tml') asm = loadAssembly(readFileSync(process.env.TML_DLL ?? paths.tmlDll));
else {
  const { resolved } = resolveMods([modName], paths);
  if (!resolved.length) { console.error(`no .tmod for ${modName}`); process.exit(1); }
  const tmod = readTmodFile(resolved[0].path);
  asm = loadAssembly(tmod.entries.get(`${tmod.name}.dll`).read());
}
const re = new RegExp(pattern, 'i');
for (const td of asm.types) for (const md of td.methods) {
  const body = asm.methodBody(md);
  if (!body) continue;
  const hits = new Set();
  for (const x of decodeIL(body.il)) if (x.op === 'ldstr') { const s = asm.userString(x.operand); if (s && re.test(s)) hits.add(s); }
  if (hits.size) console.log(`${td.fullName}::${md.name} -> ${[...hits].slice(0, 8).join(' | ')}`);
}
