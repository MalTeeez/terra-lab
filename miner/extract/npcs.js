/**
 * NPCs (for drop-source labels and boss flags) and BossChecklist registrations
 * (`LogBoss` / `LogMiniBoss` / legacy `AddBoss` calls), which carry each boss's
 * progression value on BossChecklist's shared scale (King Slime 1 … Moon Lord 17).
 */
import { decodeIL } from '../clr/il.js';
import { deCamel } from './localization.js';
import { ITEM, Machine, THIS, UNKNOWN, isNum, tmlStaticHook, tmlStaticLoadHook } from './interp.js';
import { TYPE_ABSTRACT, contentRefs, derivesFromTml, findInherited, refId } from './util.js';

/** ModNPC list with boss flag and display name. */
export function extractNpcs(asm, { tml, loc, modId }) {
  const out = [];
  for (const td of asm.types) {
    if (td.flags & TYPE_ABSTRACT) continue;
    if (td.name.includes('`') || td.name.startsWith('<')) continue;
    if (!derivesFromTml(asm, td, 'ModNPC')) continue;
    const fields = {};
    const machine = new Machine(asm, {
      tml,
      concreteType: td,
      budget: 8000,
      maxDepth: 3,
      onStore(recv, name, value) { if (recv === ITEM) fields[name] = value; },
      onLoad(recv, name) { return recv === ITEM ? fields[name] ?? UNKNOWN : undefined; },
      onCall: (c, a, ctx) => tmlStaticHook(c, a, ctx),
      onStaticLoad: tmlStaticLoadHook,
    });
    const sd = findInherited(asm, td, 'SetDefaults');
    if (sd) machine.run(sd, THIS, []);
    const text = npcName(loc, td.name);
    const boss = fields.boss === 1;
    const spawns = new Set();
    if (boss) {
      for (const m of td.methods) for (const t of contentRefs(asm, m, 'NPCType')) spawns.add(refId(asm, t));
      spawns.delete(`${modId}:${td.name}`);
    }
    out.push({
      id: `${modId}:${td.name}`,
      mod: modId,
      className: td.name,
      name: text ?? deCamel(td.name),
      boss,
      lifeMax: isNum(fields.lifeMax) ? fields.lifeMax : undefined,
      spawns: spawns.size ? [...spawns] : undefined,
    });
  }
  return out;
}

function npcName(loc, className) {
  for (const key of loc.keys.keys()) {
    if (key.endsWith(`.${className}.DisplayName`) && /NPCs?\./.test(key)) return loc.keys.get(key);
  }
  return undefined;
}

const hasLdstr = (asm, md, needles) => {
  const body = asm.methodBody(md);
  if (!body) return false;
  let ins;
  try { ins = decodeIL(body.il); } catch { return false; }
  return ins.some((x) => x.op === 'ldstr' && needles.has(asm.userString(x.operand)));
};

const LOG_NAMES = new Set(['LogBoss', 'LogMiniBoss', 'AddBoss', 'AddMiniBoss', 'AddBossWithInfo']);
const SEED_STRINGS = new Set([...LOG_NAMES, 'BossChecklist']);

/**
 * BossChecklist registrations.
 * @returns {Array<{ kind: 'boss'|'miniboss', key: string, progression: number, npcs: string[], method: string }>}
 */
export function extractBossLog(asm, { tml, modId }) {
  const out = [];
  // Methods holding the "LogBoss" string, plus their callers: mods often wrap the call in a
  // helper and pass the progression value from the caller (or a static dictionary).
  const direct = new Set();
  for (const td of asm.types) for (const md of td.methods) if (hasLdstr(asm, md, SEED_STRINGS)) direct.add(md);
  const candidates = new Set(direct);
  if (direct.size) {
    for (const td of asm.types) for (const md of td.methods) {
      const body = asm.methodBody(md);
      if (!body || candidates.has(md)) continue;
      let ins;
      try { ins = decodeIL(body.il); } catch { continue; }
      for (const x of ins) {
        if (x.op !== 'call' && x.op !== 'callvirt') continue;
        const d = asm.resolve(x.operand);
        if (d?.def && direct.has(d.def)) { candidates.add(md); break; }
      }
    }
  }
  for (const md of candidates) {
    const td = md.declaringType;
    {
      const machine = new Machine(asm, {
        tml,
        concreteType: td,
        linear: true,
        maxDepth: 3,
        budget: 400000,
        onStaticLoad: tmlStaticLoadHook,
        onCall(callee, args, ctx) {
          const hooked = tmlStaticHook(callee, args, ctx);
          if (hooked !== undefined) return hooked;
          if (callee.name === 'Call' && args[0]?.k === 'arr') {
            const a = args[0].items;
            const verb = a[0];
            if (typeof verb !== 'string' || !LOG_NAMES.has(verb)) return UNKNOWN;
            const entry = parseLog(asm, verb, a);
            if (entry) out.push({ ...entry, method: `${td.fullName}::${md.name}` });
            return UNKNOWN;
          }
          return undefined;
        },
      });
      try { machine.run(md, THIS, [UNKNOWN, UNKNOWN, UNKNOWN]); } catch { /* continue */ }
    }
  }
  // Interface style (Wrath of the Gods): each boss NPC exposes a ProgressionValue getter.
  for (const td of asm.types) {
    if (td.flags & TYPE_ABSTRACT || !derivesFromTml(asm, td, 'ModNPC')) continue;
    const getter = findInherited(asm, td, 'get_ProgressionValue') ?? findInherited(asm, td, 'get_BossChecklistProgression');
    if (!getter) continue;
    const m = new Machine(asm, { tml, concreteType: td, budget: 2000, onStaticLoad: tmlStaticLoadHook, onCall: (c, a, ctx) => tmlStaticHook(c, a, ctx) });
    const v = m.run(getter, THIS, []);
    if (!isNum(v)) continue;
    const mini = findInherited(asm, td, 'get_IsMiniboss');
    const isMini = mini ? m.run(mini, THIS, []) === 1 : false;
    out.push({ kind: isMini ? 'miniboss' : 'boss', key: td.name, progression: v, npcs: [`${modId}:${td.name}`], method: `${td.fullName}::get_ProgressionValue` });
  }
  // de-duplicate (a caller and its helper can both report the same entry)
  const seen = new Set();
  return out.filter((e) => { const k = `${e.kind}|${e.key}|${e.progression}|${e.npcs.join(',')}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

function parseLog(asm, verb, a) {
  // New API (1.4): (verb, Mod, "InternalName", progression, downed, npcTypes, extra)
  // Legacy:        (verb, progression, npcTypes, Mod, "Name", downed, ...)
  let key, prog, npcArg;
  if (isNum(a[1])) { prog = a[1]; npcArg = a[2]; key = typeof a[4] === 'string' ? a[4] : undefined; }
  else { key = typeof a[2] === 'string' ? a[2] : undefined; prog = a[3]; npcArg = a[5]; }
  if (!isNum(prog)) return null;
  const npcs = [];
  const collect = (v) => {
    if (v == null) return;
    if (isNum(v) && v > 0) npcs.push(`v:${v}`);
    else if (v?.k === 'type' && v.fn === 'NPCType') npcs.push(refId(asm, v));
    else if (v?.k === 'arr') v.items.forEach(collect);
    else if (v?.k === 'obj') (v.list ?? []).forEach(collect);
  };
  collect(npcArg);
  const uniq = [...new Set(npcs)];
  return { kind: /Mini/.test(verb) ? 'miniboss' : 'boss', key: key ?? uniq[0] ?? 'unknown', progression: prog, npcs: uniq };
}
