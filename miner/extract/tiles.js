/**
 * Tiles that gate mining: `ModTile.SetStaticDefaults` (MinPick, TileID.Sets.Ore) plus the
 * progression flags `CanKillTile` / `CanExplode` read (Calamity's Astral Ore is unminable
 * until Astrum Deus is down). Vanilla tile requirements are a config table
 * (`Player.GetPickaxeDamage` is a hard-coded chain).
 */
import { Machine, THIS, isNum, tmlStaticHook, tmlStaticLoadHook } from './interp.js';
import { TYPE_ABSTRACT, derivesFromTml, findInherited, gateRefs } from './util.js';

/**
 * @returns {Array<{ id: string, minPick?: number, ore?: boolean, gates?: string[] }>}
 */
export function extractTiles(asm, { tml, modId }) {
  const out = [];
  for (const td of asm.types) {
    if (td.flags & TYPE_ABSTRACT) continue;
    if (td.name.includes('`') || td.name.startsWith('<')) continue;
    if (!derivesFromTml(asm, td, 'ModTile')) continue;
    const rec = { id: `${modId}:${td.name}` };
    const machine = new Machine(asm, {
      tml,
      concreteType: td,
      budget: 20000,
      maxDepth: 2,
      onStore(recv, name, value) {
        if (recv !== THIS) return;
        if (name === 'MinPick' && isNum(value)) rec.minPick = value;
      },
      onCall: (callee, args, ctx) => tmlStaticHook(callee, args, ctx),
      onStaticLoad(f) {
        // TileID.Sets.Ore[Type] = true  →  a store into this tagged array
        if (f.name === 'Ore' && /TileID.Sets$/.test(f.declaringType?.fullName ?? '')) return { k: 'arr', items: [], tag: 'Ore' };
        return tmlStaticLoadHook(f);
      },
      onArrayStore(arr, index, value) {
        if (arr.tag === 'Ore' && value === 1) rec.ore = true;
      },
    });
    const ssd = findInherited(asm, td, 'SetStaticDefaults');
    if (ssd) { try { machine.run(ssd, THIS, []); } catch { /* keep what we have */ } }
    const gates = new Set();
    for (const name of ['CanKillTile', 'CanExplode']) {
      const m = findInherited(asm, td, name);
      if (m) for (const g of gateRefs(asm, m)) gates.add(g);
    }
    if (gates.size) rec.gates = [...gates];
    if (rec.minPick !== undefined || rec.ore || rec.gates) out.push(rec);
  }
  return out;
}
