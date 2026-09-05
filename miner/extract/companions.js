/**
 * Companion items: a vanity piece that only ever appears while another item is equipped.
 *
 * Stars Above's capes and gloves are never dropped, sold or crafted — a draw hook puts them on when
 * the weapon that owns them is held: `if (CloakOfAnArbiterHeld) player.armor[…] = ItemType<Cloak…
 * Cape>()`, and the flag it reads is set by `CloakOfAnArbiter.HoldItem`. Both halves are plain IL:
 * which item writes the flag, and which item appears behind a read of it. The companion is then
 * obtainable exactly when its owner is.
 *
 * @returns {Array<{ item: string, follows: string }>}
 */
import { decodeIL } from '../clr/il.js';
import { TYPE_ABSTRACT, derivesFromTml, refId } from './util.js';

export function extractCompanions(asm, { modId }) {
  const fieldRef = (x) => { try { const d = asm.resolve(x.operand); return d?.declaringType ? `${d.declaringType.fullName}::${d.name}` : null; } catch { return null; } };

  // 1. which item sets which flag (a ModItem's own hooks are the only ones that speak for it)
  const setBy = new Map(); // field → item id, or null once two items write it
  for (const td of asm.types) {
    if (td.flags & TYPE_ABSTRACT || !derivesFromTml(asm, td, 'ModItem')) continue;
    const id = `${modId}:${td.name}`;
    for (const md of td.methods) {
      const body = asm.methodBody(md);
      if (!body) continue;
      let ins;
      try { ins = decodeIL(body.il); } catch { continue; }
      for (const x of ins) {
        if (x.op !== 'stfld') continue;
        const f = fieldRef(x);
        if (!f) continue;
        setBy.set(f, setBy.has(f) && setBy.get(f) !== id ? null : id);
      }
    }
  }
  if (!setBy.size) return [];

  // 2. how often each item is named outside its own class. A companion is named exactly once — in
  // the hook that puts it on. Anything the mod mentions elsewhere has a life of its own, and a flag
  // it happens to sit behind says nothing about where it comes from.
  const mentions = new Map();
  for (const td of asm.types) {
    for (const md of td.methods) {
      const body = asm.methodBody(md);
      if (!body) continue;
      let ins;
      try { ins = decodeIL(body.il); } catch { continue; }
      const here = new Set();
      for (const x of ins) {
        if (x.op !== 'call' && x.op !== 'callvirt') continue;
        let d;
        try { d = asm.resolve(x.operand); } catch { continue; }
        if (d?.kind !== 'methodSpec' || d.name !== 'ItemType' || d.declaringType?.fullName !== 'Terraria.ModLoader.ModContent') continue;
        const id = refId(asm, d.typeArgs[0]);
        if (id && id !== `${modId}:${td.name}` && !td.fullName.startsWith(`${d.typeArgs[0]}`)) here.add(id);
      }
      for (const id of here) mentions.set(id, (mentions.get(id) ?? 0) + 1);
    }
  }

  // 3. which item is named behind a read of one of those flags
  const out = [];
  const seen = new Set();
  for (const td of asm.types) {
    for (const md of td.methods) {
      const body = asm.methodBody(md);
      if (!body) continue;
      let ins;
      try { ins = decodeIL(body.il); } catch { continue; }
      const open = []; // { field, end }
      for (let i = 0; i < ins.length; i++) {
        const x = ins[i];
        while (open.length && open[open.length - 1].end <= x.offset) open.pop();
        // `if (flag) { … }`, straight or through the local a debug build stores it in first
        if (x.op === 'ldfld') {
          const f = fieldRef(x);
          if (f && setBy.get(f)) {
            const br = ins.slice(i + 1, i + 5).find((y) => /^br(true|false)/.test(y.op) || !/^(stloc|ldloc|nop)/.test(y.op));
            if (br && /^brfalse/.test(br.op) && br.operand > x.offset) open.push({ field: f, end: br.operand });
          }
          continue;
        }
        if (open.length === 0 || (x.op !== 'call' && x.op !== 'callvirt')) continue;
        let d;
        try { d = asm.resolve(x.operand); } catch { continue; }
        if (d?.kind !== 'methodSpec' || d.name !== 'ItemType' || d.declaringType?.fullName !== 'Terraria.ModLoader.ModContent') continue;
        const item = refId(asm, d.typeArgs[0]);
        const owner = setBy.get(open[open.length - 1].field);
        if (!item || !owner || item === owner || seen.has(item) || (mentions.get(item) ?? 0) !== 1) continue;
        seen.add(item);
        out.push({ item, follows: owner });
      }
    }
  }
  return out;
}
