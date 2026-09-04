/**
 * NPCs (for drop-source labels and boss flags) and BossChecklist registrations
 * (`LogBoss` / `LogMiniBoss` / legacy `AddBoss` calls), which carry each boss's
 * progression value on BossChecklist's shared scale (King Slime 1 … Moon Lord 17).
 */
import { decodeIL } from '../clr/il.js';
import { deCamel } from './localization.js';
import { ITEM, Machine, THIS, UNKNOWN, isNum, simpleName, tmlStaticHook, tmlStaticLoadHook } from './interp.js';
import { TYPE_ABSTRACT, contentRefs, derivesFromTml, findInherited, gateRefs, refId } from './util.js';
import { idSets } from './projectiles.js';

/**
 * What the DPS model needs to know about the NPC it is scoring against: how big a target it is,
 * how much of every hit its defense eats, and which debuffs bounce off it.
 * @returns {{ w?: number, h?: number, defense?: number, life?: number, immune?: string[] }}
 */
export function npcStats(fields, immune) {
  const n = (v) => (isNum(v) ? v : undefined);
  const out = { w: n(fields.width), h: n(fields.height), defense: n(fields.defense), life: n(fields.lifeMax) };
  if (immune?.size) out.immune = [...immune];
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

/** ModNPC list with boss flag and display name. */
export function extractNpcs(asm, { tml, loc, modId }) {
  const out = [];
  for (const td of asm.types) {
    if (td.flags & TYPE_ABSTRACT) continue;
    if (td.name.includes('`') || td.name.startsWith('<')) continue;
    if (!derivesFromTml(asm, td, 'ModNPC')) continue;
    const fields = {};
    const immune = new Set();
    const BUFF_IMMUNE = { k: 'arr', tag: 'buffImmune', items: [] };
    const machine = new Machine(asm, {
      tml,
      concreteType: td,
      budget: 8000,
      maxDepth: 3,
      onStore(recv, name, value) { if (recv === ITEM) fields[name] = value; },
      onLoad(recv, name) { return recv === ITEM ? (name === 'buffImmune' ? BUFF_IMMUNE : fields[name] ?? UNKNOWN) : undefined; },
      onArrayStore(arr, idx, val) { if (arr.tag === 'buffImmune' && val !== 0) immune.add(buffRef(idx)); },
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
    // progression flags the spawn condition reads (downed bosses, hardmode, zones) — enemy drops are gated on them
    const spawnChance = boss ? null : findInherited(asm, td, 'SpawnChance');
    const gates = spawnChance ? [...gateRefs(asm, spawnChance)] : [];
    const natural = !!spawnChance && !returnsZeroOnly(asm, spawnChance);
    // town NPCs: what must be down before they move in (their shop items inherit it)
    const canTown = findInherited(asm, td, 'CanTownNPCSpawn');
    const townGates = canTown ? [...gateRefs(asm, canTown)] : null;
    out.push({
      id: `${modId}:${td.name}`,
      mod: modId,
      className: td.name,
      name: text ?? deCamel(td.name),
      boss,
      lifeMax: isNum(fields.lifeMax) ? fields.lifeMax : undefined,
      spawns: spawns.size ? [...spawns] : undefined,
      gates: gates.length ? gates : undefined,
      natural: natural || undefined,
      town: canTown ? true : undefined,
      townGates: townGates?.length ? townGates : undefined,
      stats: npcStats(fields, immune),
    });
  }
  return out;
}

/**
 * `SpawnChance` that only ever returns 0 (an enemy placed by something else — a subworld's spawn
 * pool, a boss). A debug build returns through a local (`result = 0f; return result;`), so a
 * `ldloc` counts as zero when every store to that local is zero.
 */
function returnsZeroOnly(asm, md) {
  const body = asm.methodBody(md);
  if (!body) return true;
  let ins;
  try { ins = decodeIL(body.il); } catch { return false; }
  const slot = (x) => (/^(ld|st)loc\.\d$/.test(x.op) ? +x.op.slice(6) : x.operand);
  const zeroConst = (x) => !!x && (x.op === 'ldc.i4.0' || ((x.op === 'ldc.r4' || x.op === 'ldc.r8') && x.operand === 0));
  const zeroLocal = new Map();
  for (let i = 0; i < ins.length; i++) {
    if (!/^stloc/.test(ins[i].op)) continue;
    const k = slot(ins[i]);
    zeroLocal.set(k, (zeroLocal.get(k) ?? true) && zeroConst(ins[i - 1]));
  }
  const zero = (x) => zeroConst(x) || (!!x && /^ldloc/.test(x.op) && zeroLocal.get(slot(x)) === true);
  for (let i = 0; i < ins.length; i++) if (ins[i].op === 'ret' && !zero(ins[i - 1])) return false;
  return true;
}

/** A `buffImmune[…]` index as a dataset debuff key (`v:24` or the mod's buff class name). */
const buffRef = (idx) => (isNum(idx) ? `v:${idx}` : idx?.k === 'type' ? simpleName(idx.name) : '?');

/**
 * Vanilla NPC defaults out of `NPC.SetDefaults` with the case tracker, plus `NPCID.Sets`:
 * size, defense, life and the buffs the NPC shrugs off.
 * @returns {Map<string, object>} `v:<id>` → stats
 */
export function vanillaNpcStats(tml) {
  const npcTd = tml.typeByName.get('Terraria.NPC');
  const out = new Map();
  if (!npcTd) return out;
  const KEY0 = Object.freeze({ k: 'key', slot: 0 });
  const NPC = { k: 'obj', name: 'npc', props: {} };
  const BUFF_IMMUNE = { k: 'arr', tag: 'buffImmune', items: [] };
  const byType = new Map();
  const at = (type) => { let m = byType.get(type); if (!m) byType.set(type, (m = { fields: {}, immune: new Set() })); return m; };
  const machine = new Machine(tml, {
    tml,
    linear: true,
    maxDepth: 1,
    budget: 3_000_000,
    onLoad(recv, name) {
      if (recv !== NPC) return undefined;
      if (name === 'buffImmune') return BUFF_IMMUNE;
      return name === 'type' ? KEY0 : UNKNOWN;
    },
    onStore(recv, name, value, ctx) {
      if (recv !== NPC) return;
      for (const c of ctx.cases ?? []) if (c.slot === 0 && isNum(c.value)) { const m = at(c.value); if (!(ctx.conditional && name in m.fields)) m.fields[name] = value; }
    },
    onArrayStore(arr, idx, val, ctx) {
      if (arr.tag !== 'buffImmune' || val === 0) return;
      for (const c of ctx.cases ?? []) if (c.slot === 0 && isNum(c.value)) at(c.value).immune.add(buffRef(idx));
    },
    onCall(callee, args, ctx) {
      const hooked = tmlStaticHook(callee, args, ctx);
      if (hooked !== undefined) return hooked;
      if (ctx.recv === NPC) return UNKNOWN;
      return undefined;
    },
    onStaticLoad: tmlStaticLoadHook,
  });
  const sd = npcTd.methods.find((m) => m.name === 'SetDefaults' && tml.methodSig(m).params.length === 2);
  if (sd) { try { machine.run(sd, NPC, [KEY0, UNKNOWN]); } catch { /* keep what was collected */ } }
  const sets = idSets(tml, 'Terraria.ID.NPCID/Sets');
  const all = new Set([...(sets.get('ImmuneToAllBuffs')?.ids ?? []), ...(sets.get('ImmuneToRegularBuffs')?.ids ?? [])]);
  for (const [type, m] of byType) {
    if (type <= 0) continue;
    const s = npcStats(m.fields, m.immune);
    if (all.has(type)) s.immuneAll = true;
    if (Object.keys(s).length) out.set(`v:${type}`, s);
  }
  for (const type of all) if (!out.has(`v:${type}`)) out.set(`v:${type}`, { immuneAll: true });
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
