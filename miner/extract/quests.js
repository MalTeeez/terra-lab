/**
 * Quest / contract rewards. A quest is a class with two lists: what it hands out and what it asks
 * you to kill. Thorium's Tracker contracts are the whole of the Tracker's stock — the items they
 * pay in are named nowhere else in the mod, and the monster the contract wants is what gates them.
 * Killing any one of the listed NPCs finishes the contract, so they are alternatives: the earliest
 * of them decides, which is what the drop evidence does with several sources anyway.
 *
 * …but the contract still has to be *taken* from somebody, and that somebody has to have moved in:
 * Thorium's Tracker only arrives once the Eye of Cthulhu is down (`CanTownNPCSpawn` is a bare
 * `return NPC.downedBoss1`), so every contract reward is gated behind the Eye however early its
 * target is killable. Without it the Whip — for Doctor Bones, an enemy that spawns from the start —
 * read as a pre-boss weapon. The giver is found the same way the shop is: the town NPC whose own
 * code reads the contract type (the Tracker's `AddShops` walks `ContractVault.GetContracts()`).
 */
import { decodeIL, ldcValue } from '../clr/il.js';
import { TYPE_ABSTRACT, contentRefs, derivesFromTml, findInherited, gateRefs, refId } from './util.js';

const REWARD_RE = /reward/i;
const TARGET_RE = /(monster|enemy|npc|target|kill)/i;

/**
 * @returns {Array<{ source: string, item: string, quest: true }>}
 */
export function extractQuestRewards(asm, { modId }) {
  const out = [];
  for (const td of asm.types) {
    if (td.flags & TYPE_ABSTRACT || td.name.includes('<')) continue;
    const rewardMs = td.methods.filter((m) => REWARD_RE.test(m.name) && asm.methodBody(m));
    const targetMs = td.methods.filter((m) => TARGET_RE.test(m.name) && !REWARD_RE.test(m.name) && asm.methodBody(m));
    if (!rewardMs.length || !targetMs.length) continue;

    const items = new Set();
    for (const m of rewardMs) for (const t of contentRefs(asm, m, 'ItemType')) { const id = refId(asm, t); if (id) items.add(id); }
    if (!items.size) continue;

    const npcs = new Set();
    for (const m of targetMs) {
      for (const t of contentRefs(asm, m, 'NPCType')) { const id = refId(asm, t); if (id) npcs.add(id); }
      // vanilla ids are plain constants in the list the quest builds
      const body = asm.methodBody(m);
      let ins;
      try { ins = decodeIL(body.il); } catch { continue; }
      for (const x of ins) { const v = ldcValue(x); if (Number.isInteger(v) && v > 0 && v < 700) npcs.add(`v:${v}`); }
    }
    if (!npcs.size) continue;
    const cond = giverGates(asm, td);
    for (const item of items) for (const npc of npcs) out.push({ source: `npc:${npc}`, item, quest: true, cond: cond?.length ? cond : undefined });
  }
  return out;
}

/**
 * What must be down before the town NPC handing out `contract` has moved in, or null.
 * Cached per assembly: the scan walks every town NPC's IL, and a mod has one quest giver, not one
 * per contract.
 */
const giverCache = new WeakMap();
function giverGates(asm, contract) {
  if (!giverCache.has(asm)) giverCache.set(asm, new Map());
  const cache = giverCache.get(asm);
  // the contract's own type and the base every contract shares: the giver reads one of the two
  const base = asm.baseOf(contract);
  // (…but never `System.Object`: every NPC mentions members of it, so a contract that derives from
  // nothing would match the first town NPC in the assembly)
  const keys = [contract.fullName, base?.kind === 'typeDef' ? base.def.fullName : base?.fullName]
    .filter((n) => n && !/^System\./.test(n));
  for (const k of keys) if (cache.has(k)) return cache.get(k);
  let gates = null;
  for (const td of asm.types) {
    if (td.flags & TYPE_ABSTRACT || !derivesFromTml(asm, td, 'ModNPC')) continue;
    const canTown = findInherited(asm, td, 'CanTownNPCSpawn');
    if (!canTown || !mentions(asm, td, keys)) continue;
    const g = [...gateRefs(asm, canTown)];
    if (g.length) { gates = g; break; }
  }
  for (const k of keys) cache.set(k, gates);
  return gates;
}

/** Does any method of `td` touch a member declared on one of these types? */
function mentions(asm, td, typeNames) {
  for (const m of td.methods) {
    const body = asm.methodBody(m);
    if (!body) continue;
    let ins;
    try { ins = decodeIL(body.il); } catch { continue; }
    for (const x of ins) {
      if (x.op !== 'call' && x.op !== 'callvirt' && x.op !== 'newobj' && x.op !== 'ldsfld' && x.op !== 'ldfld') continue;
      let d;
      try { d = asm.resolve(x.operand); } catch { continue; }
      const dn = d?.declaringType?.fullName ?? d?.fullName ?? '';
      if (typeNames.includes(dn)) return true;
    }
  }
  return false;
}
