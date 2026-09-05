/**
 * Quest / contract rewards. A quest is a class with two lists: what it hands out and what it asks
 * you to kill. Thorium's Tracker contracts are the whole of the Tracker's stock — the items they
 * pay in are named nowhere else in the mod, and the monster the contract wants is what gates them.
 * Killing any one of the listed NPCs finishes the contract, so they are alternatives: the earliest
 * of them decides, which is what the drop evidence does with several sources anyway.
 */
import { decodeIL, ldcValue } from '../clr/il.js';
import { TYPE_ABSTRACT, contentRefs, refId } from './util.js';

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
    for (const item of items) for (const npc of npcs) out.push({ source: `npc:${npc}`, item, quest: true });
  }
  return out;
}
