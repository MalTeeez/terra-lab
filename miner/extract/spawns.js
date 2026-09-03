/**
 * Where enemies spawn naturally, as progression gates.
 *
 * Vanilla: `NPC.SpawnNPC` walked linearly - every `NPC.NewNPC(..., type, ...)` site (and every
 * constant stored into a local that feeds one) is tagged with the flags guarding it
 * (`Main.hardMode`, `NPC.downedPlantBoss`, `Main.player[k].ZoneDungeon`, `Main.pumpkinMoon`,
 * `Main.invasionType == 1` ...). Several sites for one NPC are alternatives.
 *
 * Mods: `GlobalNPC.EditSpawnPool` - `pool[id] = chance` under the same kind of conditions,
 * for vanilla and mod NPCs alike. (`ModNPC.SpawnChance` is read in npcs.js.)
 */
import { decodeIL } from '../clr/il.js';
import { Machine, THIS, UNKNOWN, isNum, tmlStaticHook, tmlStaticLoadHook } from './interp.js';
import { expandValue, progressionHooks, siteGates } from './flags.js';
import { TYPE_ABSTRACT, derivesFromTml, refId } from './util.js';

/**
 * @returns {Map<string, string[][]>} 'v:<id>' -> list of alternative gate lists
 */
export function extractVanillaSpawns(tml) {
  const out = new Map();
  const npcTd = tml.typeByName.get('Terraria.NPC');
  const m = npcTd?.methods.find((x) => x.name === 'SpawnNPC' && tml.methodBody(x));
  if (!m) return out;
  const add = (type, ctx) => {
    if (!isNum(type) || type <= 0) return;
    const id = `v:${type}`;
    let l = out.get(id);
    if (!l) out.set(id, (l = []));
    const g = siteGates(ctx);
    if (!l.some((x) => x.length === g.length && x.every((t) => g.includes(t)))) l.push(g);
  };
  // locals that feed NewNPC's `Type` argument: the 7th instruction before the call when the six
  // arguments after it (Start, ai0..ai3, Target) are single constants - the generic spawn sites
  const typeLocals = new Set();
  const ins = decodeIL(tml.methodBody(m).il);
  for (let i = 7; i < ins.length; i++) {
    if (ins[i].op !== 'call' || tml.resolve(ins[i].operand)?.name !== 'NewNPC') continue;
    const t = ins[i - 7];
    if (/^ldloc/.test(t.op)) typeLocals.add(t.op.length === 7 ? +t.op.slice(6) : t.operand);
  }
  const prog = progressionHooks();
  const walk = (md, extraTags = []) => {
    const cands = new Map(); // local → constants stored since the last unconditional store (`num = rand ? 494 : 495`)
    const addAll = (v, ctx) => {
      const c = { ...ctx, condTags: [...(ctx.condTags ?? []), ...extraTags] };
      if (v?.k === 'maybe') { for (const x of cands.get(v.local) ?? [v.value]) add(x, c); return; }
      for (const e of expandValue(v, c)) if (isNum(e.v)) add(e.v, e.ctx);
    };
    const machine = new Machine(tml, {
      tml,
      linear: true,
      noDead: true,
      phi: true,
      maxDepth: 0,
      budget: 2_000_000,
      onStaticLoad: (f) => prog.onStaticLoad(f) ?? tmlStaticLoadHook(f),
      onLoad: (recv, name) => prog.onLoad(recv, name),
      onCall(callee, args, ctx) {
        const hooked = tmlStaticHook(callee, args, ctx);
        if (hooked !== undefined) return hooked;
        if (callee.name === 'NewNPC' && (callee.declaringType?.fullName ?? '') === 'Terraria.NPC') { addAll(args[3], ctx); return UNKNOWN; }
        if (/^(NextFromList|SelectRandom)$/.test(callee.name)) { const arr = args.find((a) => a?.k === 'arr'); return arr ? { k: 'oneof', items: arr.items.filter(isNum) } : UNKNOWN; }
        if (callee.name === 'Next' && /UnifiedRandom$/.test(callee.declaringType?.fullName ?? '') && args.length === 1 && isNum(args[0]) && args[0] >= 2 && args[0] <= 8) return { k: 'randn', n: args[0] };
        return prog.onCall(callee);
      },
      onStoreLocal(i, val, ctx) {
        if (isNum(val)) { if (ctx.conditional) { let l = cands.get(i); if (!l) cands.set(i, (l = [])); l.push(val); } else cands.set(i, [val]); }
        else if (!ctx.conditional) cands.delete(i);
        if (typeLocals.has(i)) addAll(val, ctx);
      },
    });
    try { machine.run(md, undefined, new Array(tml.methodSig(md).params.length).fill(UNKNOWN), tml); } catch (e) { if (process.env.TL_STRICT) throw e; }
  };
  walk(m);
  // the Old One's Army spawns its waves from DD2Event, one method per difficulty tier
  const dd2 = tml.typeByName.get('Terraria.GameContent.Events.DD2Event');
  for (const md of dd2?.methods ?? []) {
    const tier = /^Difficulty_(\d)_SpawnMonster/.exec(md.name);
    if (tier && tml.methodBody(md)) walk(md, [`dd2:${tier[1]}`]);
  }
  return out;
}

/**
 * `GlobalNPC.EditSpawnPool` entries of a mod.
 * @returns {Array<{ npc: string, gates: string[], mod: string }>}
 */
export function extractSpawnPools(asm, { tml, modId }) {
  const out = [];
  const prog = progressionHooks();
  const poolArg = { k: 'obj', name: 'pool', props: {} };
  const infoArg = { k: 'obj', name: 'spawnInfo', props: {} };
  for (const td of asm.types) {
    if (td.flags & TYPE_ABSTRACT) continue;
    if (td.name.includes('`') || td.name.startsWith('<')) continue;
    if (!derivesFromTml(asm, td, 'GlobalNPC')) continue;
    const m = td.methods.find((x) => x.name === 'EditSpawnPool' && asm.methodBody(x));
    if (!m) continue;
    const machine = new Machine(asm, {
      tml,
      concreteType: td,
      linear: true,
      noDead: true,
      maxDepth: 1,
      budget: 400_000,
      onStaticLoad: (f) => prog.onStaticLoad(f) ?? tmlStaticLoadHook(f),
      onLoad(recv, name) {
        const p = prog.onLoad(recv, name);
        if (p !== undefined) return p;
        if (recv === infoArg) return name === 'Player' ? { k: 'obj', name: 'spawnPlayer', props: {} } : UNKNOWN;
        return undefined;
      },
      onCall(callee, args, ctx) {
        const hooked = tmlStaticHook(callee, args, ctx);
        if (hooked !== undefined) return hooked;
        const p = prog.onCall(callee);
        if (p !== undefined) return p;
        if (ctx.recv === poolArg && (callee.name === 'set_Item' || callee.name === 'Add' || callee.name === 'TryAdd')) {
          const a = args[0];
          const npc = isNum(a) && a > 0 ? `v:${a}` : a?.k === 'type' && a.fn === 'NPCType' ? refId(asm, a) : null;
          if (process.env.TL_TRACE_POOL === td.name) console.log('  pool', callee.name, npc ?? JSON.stringify(a), 'at', ctx.offset, 'dead', machine.dead, 'tags', (ctx.condTags ?? []).join(','));
          if (npc) out.push({ npc, gates: siteGates(ctx), mod: modId });
          return UNKNOWN;
        }
        if (ctx.recv === poolArg) return UNKNOWN;
        return undefined;
      },
    });
    try { machine.run(m, THIS, [poolArg, infoArg], asm); } catch (e) { if (process.env.TL_STRICT) throw e; }
  }
  return out;
}
