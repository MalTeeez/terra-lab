/**
 * Projectiles an accessory spawns when the player hits something:
 *   `if (scuttlersJewel && stealthStrike) NewProjectile(…, JewelSpike, rogueDamage.ApplyTo(10), …)`
 * in a ModPlayer / GlobalProjectile / GlobalItem hit hook. Recorded per ModPlayer flag as
 * `{ type, damage, cls, stealth, cooldown }` — the base damage before class bonuses, the class
 * whose bonus scales it, whether only stealth strikes trigger it, and a cooldown in ticks when
 * the same region sets one — so the solver can grade the spawn like a small weapon.
 */
import { ET } from '../clr/sig.js';
import { decodeIL } from '../clr/il.js';
import { Machine, PLAYER, THIS, UNKNOWN, isNum, simpleName } from './interp.js';
import { classOf } from '../classify.js';
import { TYPE_ABSTRACT, derivesFromTml, refId } from './util.js';
import { playerHooks } from './effects.js';
import { projRef } from './projectiles.js';

const HIT_SENTINEL = 1000; // the hit's damage, so `damageDone / 2` comes out as a share of it
// …and a mod's own per-class dispatch helper, which is where half of them actually live: Calamity
// splits its hit handling into `MeleeOnHit` / `MagicOnHit` / `RogueOnHit` / `SummonOnHit` and calls
// them from the real hook, so anchoring on tML's names alone lost Tarragon's leaf storm and Silva's
// nature blast — every set bonus whose proc is written in the class's own arm.
const HIT_HOOKS = /^(\w*OnHit\w*|ModifyHitNPC(?:WithProj|WithItem)?|OnKill)$/;
// the mirror hooks: the player took the hit. The same NewProjectile call, a completely different
// trigger rate — you get hit a handful of times a fight, not three times a second — so spawns from
// them are tagged and graded as a rare retaliation, not as a proc.
const HURT_HOOKS = /^(OnHitByNPC|OnHitByProjectile|PostHurt|OnHurt|ModifyHurt)$/;
// …and the weapon's own shot: `if (spearNormal) NewProjectile(…, SpearExtra, damage * 35 / 100, …)`
// in a GlobalItem's `Shoot` is an accessory adding a projectile to every attack you make, which is
// the whole of what Thorium's spear tips and half its sheaths do.
// `CanUseItem` / `UseItem` count as the same thing: a mod that wants a projectile on every attack
// fires it wherever the use passes through its GlobalItem, and SOTS puts the Wishing Star's free
// magic star in `CanUseItem` — the accessory's whole effect, and it was read nowhere.
const SHOOT_HOOKS = /^(Shoot|CanUseItem|UseItem)$/;
const GLOBALS = ['GlobalProjectile', 'GlobalItem', 'GlobalNPC'];

/** @returns {Map<string, Array<{ type: string, damage: number|null, cls?: string, stealth?: true, cooldown?: number }>>} flag → spawns */
export function extractOnHitSpawns(asm, { tml }) {
  const modPlayers = new Set();
  for (const td of asm.types) if (derivesFromTml(asm, td, 'ModPlayer')) modPlayers.add(td.fullName);
  const byFlag = new Map();
  const isBoolField = (ctx) => { const f = ctx?.field; try { return f?.type?.et === ET.BOOLEAN || (!!f?.def && ctx.owner?.fieldType(f.def).et === ET.BOOLEAN); } catch { return false; } };
  // A hook that hands the spawn to a helper rather than writing it inline: the walk is linear and
  // does not descend, so the projectile was lost with it — SOTS's Wishing Star is one call
  // (`SOTSPlayer.CastWishingStar`) and the accessory's entire effect was invisible. The helper is
  // read lexically instead: the `ProjectileType<T>`s it names, but only if it spawns at all, and
  // only credited to the flag region the *call* sits in. Damage stays unknown — it is inside.
  const helperCache = new Map();
  const helperSpawns = (def) => {
    if (!def) return [];
    let out = helperCache.get(def);
    if (out) return out;
    out = [];
    const body = (() => { try { return asm.methodBody(def); } catch { return null; } })();
    if (body) {
      const types = [];
      let spawns = false;
      for (const x of decodeIL(body.il)) {
        if (!/^call/.test(x.op)) continue;
        let c; try { c = asm.resolve(x.operand); } catch { continue; }
        if (/^NewProjectile(?:Direct)?$/.test(c?.name ?? '')) spawns = true;
        else if (c?.name === 'ProjectileType' && c.typeArgs?.length) {
          const t = c.typeArgs[0];
          const id = refId(asm, typeof t === 'string' ? t : t?.fullName ?? t?.name);
          if (id) types.push(id);
        }
      }
      if (spawns) out = [...new Set(types)];
    }
    helperCache.set(def, out);
    return out;
  };
  const mfTags = (ctx) => (ctx?.condTags ?? []).filter((t) => t.startsWith('mf:')).map((t) => t.slice(3));

  for (const td of asm.types) {
    if (td.flags & TYPE_ABSTRACT || td.name.includes('`') || td.name.startsWith('<')) continue;
    const kind = derivesFromTml(asm, td, 'ModPlayer') ? 'player' : GLOBALS.some((b) => derivesFromTml(asm, td, b)) ? 'global' : null;
    if (!kind) continue;
    for (const md of td.methods) {
      const hurt = HURT_HOOKS.test(md.name);
      const shoot = SHOOT_HOOKS.test(md.name) && kind === 'global';
      if ((!hurt && !shoot && !HIT_HOOKS.test(md.name)) || !asm.methodBody(md)) continue;
      let statCls = null;
      const spawns = []; // this method's, to receive a cooldown set in the same flag region
      const cooldowns = new Map(); // flag → ticks
      const hooks = playerHooks(() => {});
      const machine = new Machine(asm, {
        tml, concreteType: td, linear: true, maxDepth: 0, budget: 200000,
        onLoad(recv, name, ctx) {
          // a ModPlayer bool field — on `this`, or on any player's ModPlayer — gates the spawn
          if (isBoolField(ctx) && (recv === THIS ? kind === 'player' : modPlayers.has(ctx.field?.declaringType?.fullName ?? ''))) return { k: 'flag', name: `mf:${name}` };
          if (recv === THIS && isBoolField(ctx)) return { k: 'flag', name: `gp:${name}` }; // e.g. stealthStrike on a global projectile
          if (recv === THIS) return name === 'Player' ? PLAYER : UNKNOWN;
          return hooks.onLoad(recv, name, ctx);
        },
        onStore(recv, name, value, ctx) {
          if (/cooldown|cd$/i.test(name) && isNum(value) && value > 0) for (const f of mfTags(ctx)) cooldowns.set(f, value);
        },
        onCall(callee, args, ctx) {
          const name = callee.name;
          if (ctx.recv === THIS && name === 'get_Player') return PLAYER;
          if (ctx.recv === THIS && /^get_/.test(name) && !args.length && callee.sig?.ret?.et === ET.BOOLEAN) return { k: 'flag', name: `${kind === 'player' ? 'mf' : 'gp'}:${name.slice(4)}` };
          // a class check on the hit (`proj.CountsAsClass<RogueDamageClass>()`, `proj.DamageType == BardDamage.Instance`)
          // tags the region, so a spawn inside it belongs to that class
          // …by type argument (`CountsAsClass<RogueDamageClass>()`) or by value
          // (`item.CountsAsClass(DamageClass.Magic)`, which is how SOTS asks whether the Wishing
          // Star's free star should fire — without it a magic-only proc counts for every class)
          if (name === 'CountsAsClass') {
            const c = callee.kind === 'methodSpec' ? classOf(simpleName(callee.typeArgs[0])) : classOf(args.find((a) => a?.k === 'dc')?.name ?? '');
            if (c && c !== 'classless') return { k: 'flag', name: `cls:${c}` };
          }
          if (name === 'op_Equality' && /DamageClass/.test(callee.declaringType?.fullName ?? callee.declaringType?.name ?? '')) {
            const dc = args.find((a) => a?.k === 'dc');
            const c = dc && classOf(dc.name);
            if (c && c !== 'classless') return { k: 'flag', name: `cls:${c}` };
          }
          // `Main.rand.NextBool(4)`: a one-in-four chance gates the region
          if (name === 'NextBool' && isNum(args[0]) && args[0] > 0) return { k: 'flag', name: `rand:${args.length >= 2 && isNum(args[1]) && args[1] > 0 ? args[0] / args[1] : 1 / args[0]}` };
          // `damageStat.ApplyTo(10)`: the base damage; the stat says which class bonus scales it
          if (name === 'ApplyTo' && isNum(args[0])) { statCls = ctx.recv?.k === 'stat' ? ctx.recv.cls : null; return args[0]; }
          if (/^NewProjectile(?:Direct)?$/.test(name) || (mfTags(ctx).length && helperSpawns(callee.def ?? callee.method?.def).length)) {
            const inline = /^NewProjectile(?:Direct)?$/.test(name);
            const i = inline ? args.findIndex((a) => a?.k === 'type' && a.fn === 'ProjectileType') : 0;
            const flags = mfTags(ctx);
            for (const helperType of inline ? [null] : helperSpawns(callee.def ?? callee.method?.def)) {
            if (i >= 0 && flags.length) {
              const type = inline ? projRef(asm, args[i]) : helperType;
              // the helper's own damage argument is the caller's: `CastWishingStar(…, item.damage, …)`
              // hands it the sentinel, which is what says the star hits for a whole attack
              const d = inline ? (isNum(args[i + 1]) ? args[i + 1] : null) : args.find((a) => isNum(a) && a >= HIT_SENTINEL * 0.25) ?? null;
              const fromHit = d !== null && d >= HIT_SENTINEL * 0.25; // a fraction of the sentinel, not a flat base
              const tagCls = (ctx.condTags ?? []).find((t) => /^cls:/.test(t))?.slice(4);
              // `other` is a mod's own class (SOTS's void): the spawn belongs to no class the solver knows
              const cls = statCls && statCls !== 'all' ? statCls : tagCls && tagCls !== 'classless' ? tagCls : undefined;
              const tags = ctx.condTags ?? [];
              const chance = tags.filter((t) => /^rand:/.test(t)).reduce((p, t) => p * Number(t.slice(5)), 1);
              const spawn = {
                type, damage: d !== null && !fromHit ? Math.round(d) : null,
                share: fromHit ? Math.min(1, Math.round((d / HIT_SENTINEL) * 100) / 100) : undefined, // never more than the hit itself
                cls, stealth: tags.some((t) => /stealth/i.test(t)) || undefined,
                crit: !hurt && tags.includes('hit:crit') || undefined, chance: chance < 1 ? Math.round(chance * 1000) / 1000 : undefined,
                hurt: hurt || undefined,
                shoot: shoot || undefined,
                // `if (ItemID.Sets.Spears[item.type])` around the block: the accessory only fires on
                // the weapons it is for, and which weapon you hold is not a question this can answer
                gated: (shoot && ctx.conditional) || undefined,
              };
              statCls = null;
              for (const flag of flags) {
                let l = byFlag.get(flag);
                if (!l) byFlag.set(flag, (l = []));
                const had = l.find((s) => s.type === type);
                // the same projectile off both hooks (hit and hurt) is an on-hit proc: keep that reading
                if (had) { if (had.hurt && !hurt) Object.assign(had, spawn); continue; }
                const s = { ...spawn }; l.push(s); spawns.push([flag, s]);
              }
            }
            }
            return UNKNOWN;
          }
          return hooks.onCall(callee, args, ctx);
        },
        onStaticLoad: hooks.onStaticLoad,
        // `proj.ModProjectile as BardProjectile`: a cast to a class's projectile type gates on that class too
        onCast(t) {
          const c = classOf(simpleName(t?.fullName ?? t?.name ?? ''));
          return c && c !== 'classless' ? { k: 'flag', name: `cls:${c}` } : undefined;
        },
      });
      // the hook's `int damageDone` and `NPC.HitInfo hit` carry the sentinel, so a spawn whose damage is
      // computed from the hit comes out as a share of it
      let params = [];
      try { params = asm.methodSig(md).params; } catch { /* no signature */ }
      const args = params.map((p) => {
        if (p.et === ET.I4) return HIT_SENTINEL;
        if (p.et === ET.VALUETYPE) { let t; try { t = asm.resolve(p.token); } catch { /* unresolved */ } if (/HitInfo/.test(t?.name ?? t?.fullName ?? '')) return { k: 'obj', name: 'HitInfo', props: { Damage: HIT_SENTINEL, SourceDamage: HIT_SENTINEL, FinalDamage: HIT_SENTINEL, Crit: { k: 'flag', name: 'hit:crit' } }, args: [] }; }
        // …and in a `Shoot` / `CanUseItem` hook the *weapon* is the argument, so its damage is the
        // sentinel too: a projectile fired for `item.damage` is one that hits as hard as the weapon
        // does (SOTS's Wishing Star), which is a share of your attack and not a flat 10-damage proc.
        if (p.et === ET.CLASS) { let t; try { t = asm.resolve(p.token); } catch { /* unresolved */ } if ((t?.name ?? '') === 'Item') return { k: 'obj', name: 'itemArg', props: { damage: HIT_SENTINEL }, args: [] }; }
        return UNKNOWN;
      });
      try { machine.run(md, THIS, args.length ? args : [UNKNOWN, UNKNOWN, UNKNOWN, UNKNOWN, UNKNOWN]); } catch { /* partial */ }
      for (const [flag, s] of spawns) if (cooldowns.has(flag)) s.cooldown = cooldowns.get(flag);
    }
  }
  return byFlag;
}
