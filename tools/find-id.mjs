#!/usr/bin/env node
/**
 * Which methods mention an item / npc / tile id — for finding the code path behind a drop the
 * miner did not see.
 *
 *   node tools/find-id.mjs 3286 3289          # in tModLoader.dll
 *   node tools/find-id.mjs --mod SOTS 3781
 */
import { readFileSync } from 'node:fs';
import { loadAssembly } from '../miner/clr/metadata.js';
import { decodeIL, ldcValue } from '../miner/clr/il.js';
import { defaultPaths, resolveMods } from '../miner/resolve.js';
import { readTmodFile } from '../miner/tmod.js';

const args = process.argv.slice(2);
const modAt = args.indexOf('--mod');
const modName = modAt >= 0 ? args[modAt + 1] : null;
const want = new Set(args.filter((a) => /^\d+$/.test(a)).map(Number));
const paths = defaultPaths();
let asm;
if (modName) {
  const { resolved } = resolveMods([modName], paths);
  const tmod = readTmodFile(resolved[0].path);
  asm = loadAssembly(tmod.entries.get(`${tmod.name}.dll`).read());
} else asm = loadAssembly(readFileSync(process.env.TML_DLL ?? paths.tmlDll));

const hits = new Map();
for (const td of asm.types) for (const m of td.methods) {
  let body;
  try { body = asm.methodBody(m); } catch { continue; }
  if (!body) continue;
  let il;
  try { il = decodeIL(body.il); } catch { continue; }
  for (const x of il) {
    const v = ldcValue(x);
    if (v !== undefined && want.has(v)) { const k = `${td.fullName}::${m.name}`; hits.set(k, (hits.get(k) ?? 0) + 1); }
  }
}
for (const [k, n] of [...hits].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(String(n).padStart(3), k);
