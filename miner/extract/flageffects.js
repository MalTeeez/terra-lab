/**
 * Effects a ModPlayer applies when one of its boolean fields is set — the half of an armor
 * or accessory effect that lives outside the item: `if (molluskSet) Player.moveSpeed -= 0.51f;`
 * in Calamity's player update. Every method of every ModPlayer is walked linearly; a load of
 * a bool field on `this` opens a tagged region, and stat deltas inside it are attributed to
 * the innermost flag.
 */
import { ET } from '../clr/sig.js';
import { Machine, PLAYER, THIS, UNKNOWN } from './interp.js';
import { TYPE_ABSTRACT, derivesFromTml } from './util.js';
import { normalizeEffects, playerHooks } from './effects.js';

const HOOK_RE = /^(PostUpdate|UpdateEquips|PostUpdateEquips|PostUpdateMiscEffects|PostUpdateRunSpeeds|UpdateLifeRegen|ModifyWeaponDamage|ModifyWeaponCrit|UpdateBadLifeRegen|PreUpdateMovement|UpdateDead|OtherBuffEffects|.*Effects?|Update\w*)$/;

/**
 * @returns {Map<string, object>} bool field name → effects object (normalizeEffects form)
 */
export function extractFlagEffects(asm, { tml }) {
  const byFlag = new Map(); // lowercased key → { name, deltas: [] }
  for (const td of asm.types) {
    if (td.flags & TYPE_ABSTRACT) continue;
    if (td.name.includes('`') || td.name.startsWith('<')) continue;
    if (!derivesFromTml(asm, td, 'ModPlayer')) continue;
    const boolFields = new Map();
    for (const f of td.fields ?? []) {
      let et;
      try { et = asm.fieldType(f).et; } catch { continue; }
      if (et === ET.BOOLEAN) boolFields.set(`mf:${f.name}`, f.name);
    }
    // bool properties on the player (`bool molluskSet => molluskHelmet && …`) gate the same way
    for (const m of td.methods) {
      if (!/^get_/.test(m.name) || asm.methodSig(m).params.length) continue;
      if (asm.methodSig(m).ret?.et === ET.BOOLEAN) boolFields.set(`mf:${m.name.slice(4)}`, m.name.slice(4));
    }
    if (!boolFields.size) continue;
    if (process.env.TL_TRACE_FLAGS) console.log('bool fields', td.name, boolFields.size, [...boolFields.values()].filter((n) => /mollusk/i.test(n)));
    for (const md of td.methods) {
      if (!HOOK_RE.test(md.name) || !asm.methodBody(md)) continue;
      const deltas = [];
      const hooks = playerHooks((d, ctx) => {
        if (process.env.TL_TRACE_FLAGS && md.name === process.env.TL_TRACE_FLAGS) console.log('  delta', md.name, JSON.stringify(d), 'tags', JSON.stringify(ctx?.condTags));
        const tags = (ctx?.condTags ?? []).filter((t) => t.startsWith('mf:'));
        if (!tags.length) return;
        const key = tags[tags.length - 1];
        const name = boolFields.get(key);
        if (!name) return;
        deltas.push({ flag: name, d });
      });
      const machine = new Machine(asm, {
        tml,
        concreteType: td,
        linear: true,
        maxDepth: 0,
        budget: 200000,
        onLoad(recv, name, ctx) {
          if (recv === THIS) {
            const f = ctx?.field;
            const isBool = f?.type?.et === ET.BOOLEAN || (f?.def && ctx.owner?.fieldType(f.def).et === ET.BOOLEAN);
            if (isBool) return { k: 'flag', name: `mf:${name}` };
            if (name === 'Player') return PLAYER;
            return UNKNOWN;
          }
          return hooks.onLoad(recv, name, ctx);
        },
        onStore: hooks.onStore,
        onCall(callee, args, ctx) {
          if (ctx.recv === THIS && callee.name === 'get_Player') return PLAYER;
          if (ctx.recv === THIS && /^get_/.test(callee.name) && !args.length && callee.sig?.ret?.et === ET.BOOLEAN) return { k: 'flag', name: `mf:${callee.name.slice(4)}` };
          return hooks.onCall(callee, args, ctx);
        },
        onStaticLoad: hooks.onStaticLoad,
      });
      try { machine.run(md, THIS, [UNKNOWN, UNKNOWN, UNKNOWN, UNKNOWN]); } catch { /* keep what we have */ }
      for (const { flag, d } of deltas) {
        let rec = byFlag.get(flag);
        if (!rec) byFlag.set(flag, (rec = []));
        rec.push(d);
      }
    }
  }
  // Aura projectiles: what a projectile's AI does to players near it (Calamity's Sand Cloak veil
  // gives 3 defense to anyone inside). Keyed `aura:<TypeName>`; the miner folds one into the item
  // it is named after, as a conditional effect.
  for (const td of asm.types) {
    if (td.flags & TYPE_ABSTRACT || td.name.includes('`') || td.name.startsWith('<')) continue;
    if (!derivesFromTml(asm, td, 'ModProjectile')) continue;
    const deltas = [];
    const hooks = playerHooks((d) => { if (!/^(flag|modflag|mod|player):/.test(d.stat)) deltas.push({ ...d, cond: true }); });
    for (const md of td.methods) {
      if (!/^(AI|PostAI|PreAI)$/.test(md.name) || !asm.methodBody(md)) continue;
      const machine = new Machine(asm, {
        tml, concreteType: td, linear: true, maxDepth: 0, budget: 40000,
        onLoad: (recv, name, ctx) => (recv === THIS ? UNKNOWN : hooks.onLoad(recv, name, ctx)),
        onStore: hooks.onStore, onCall: hooks.onCall, onStaticLoad: hooks.onStaticLoad,
      });
      try { machine.run(md, THIS, []); } catch { /* keep what we have */ }
    }
    if (deltas.length) byFlag.set(`aura:${td.name}`, deltas);
  }
  const out = new Map();
  for (const [flag, deltas] of byFlag) {
    const fx = normalizeEffects(dedupe(deltas));
    if (!fx) continue;
    delete fx.flags; // flags set under a flag are not stats
    const cond = [...new Set(deltas.filter((d) => d.cond).map((d) => d.stat))];
    if (cond.length) fx.cond = cond;
    if (Object.keys(fx).length) out.set(flag, fx);
  }
  return out;
}

function dedupe(deltas) {
  const seen = new Set();
  return deltas.filter((d) => {
    const k = `${d.stat}|${d.cls ?? ''}|${d.value}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
