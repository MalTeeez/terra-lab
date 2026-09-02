/**
 * Mod load order. tModLoader loads a mod after everything it references, so balancing
 * mods (which reference the mods they change) apply last. We recover the same order from
 * each assembly's AssemblyRef table, keeping enabled.json order for ties.
 */
import { T } from './clr/metadata.js';

export function assemblyRefs(asm) {
  const out = [];
  for (let rid = 1; rid <= asm.tables.count(T.AssemblyRef); rid++) out.push(asm.string(asm.tables.row(T.AssemblyRef, rid).name));
  return out;
}

/** @param {Array<{ name: string, asm: object }>} mods  in enabled order → sorted copy */
export function loadOrder(mods) {
  const names = new Set(mods.map((m) => m.name));
  const deps = new Map(mods.map((m) => [m.name, new Set(assemblyRefs(m.asm).filter((r) => names.has(r) && r !== m.name))]));
  const done = new Set();
  const out = [];
  let progress = true;
  while (out.length < mods.length && progress) {
    progress = false;
    for (const m of mods) {
      if (done.has(m.name)) continue;
      if ([...deps.get(m.name)].every((d) => done.has(d))) {
        done.add(m.name);
        out.push(m);
        progress = true;
      }
    }
  }
  for (const m of mods) if (!done.has(m.name)) out.push(m); // cycles: keep enabled order
  return out;
}
