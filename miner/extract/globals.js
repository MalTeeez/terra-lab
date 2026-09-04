/**
 * Balancing overlays: what `GlobalItem` hooks (and an item's own modifier hooks) change
 * about items that other code defined.
 *
 *   SetDefaults(Item)                       field overrides / adjustments (`item.damage = 50`, `item.defense += 15`)
 *   UpdateEquip / UpdateAccessory           extra player effects for armor / accessories
 *   ModifyWeaponDamage(…, ref StatModifier) damage multipliers / additive percentages
 *   ModifyWeaponCrit(…, ref float)          crit additions
 *   UseTimeMultiplier / UseSpeedMultiplier  use-time factors
 *
 * Every record carries the *matchers* it applies to (item id, class name, mod, namespace
 * prefix, `is` type, damage class, item property, id range) and the difficulty flags it was
 * conditioned on (`cond`), or `conditional: true` when the guard could not be resolved.
 */
import { PLAYER, THIS, UNKNOWN, isNum, tmlStaticHook, tmlStaticLoadHook, simpleName, Machine } from './interp.js';
import { normalizeEffects, playerHooks } from './effects.js';
import { TYPE_ABSTRACT, derivesFromTml, findInherited, refId } from './util.js';

const ITEMARG = Object.freeze({ k: 'itemarg', slot: 0 });
const FIELDS = new Set(['damage', 'defense', 'useTime', 'useAnimation', 'reuseDelay', 'crit', 'knockBack', 'mana', 'rare', 'value', 'shootSpeed', 'accessory', 'DamageType', 'ArmorPenetration']);

/** Case keys → matcher objects the overlay can apply to items. */
export function keysToMatchers(asm, keys) {
  const out = [];
  for (const k of keys) {
    if (k.slot !== 0) continue;
    if (isNum(k.value)) out.push({ id: `v:${k.value}` });
    else if (typeof k.value === 'string') out.push({ id: k.value.includes('.') ? refId(asm, k.value) : k.value });
    else if (k.match) {
      const m = k.match;
      if (m.className) out.push({ className: m.className });
      else if (m.modName) out.push({ modName: m.modName });
      else if (m.namespaceStartsWith) out.push({ nsPrefix: m.namespaceStartsWith });
      else if (m.namespace) out.push({ nsPrefix: m.namespace });
      else if (m.typeName) out.push({ typeName: m.typeName });
      else if (m.typeNameStartsWith) out.push({ nsPrefix: m.typeNameStartsWith });
      else if (m.fullName) { const [mod, cls] = m.fullName.split('/'); out.push(cls ? { id: `${mod}:${cls}` } : { className: m.fullName }); }
      else if (m.is) out.push({ is: m.is });
      else if (m.cls) out.push({ cls: m.cls });
      else if (m.prop) out.push({ prop: m.prop, value: m.value });
      else if (m.classNameEndsWith) out.push({ classEndsWith: m.classNameEndsWith });
      else if (m.displayName) out.push({ displayName: m.displayName });
      else out.push({ unknown: true });
    } else if (isNum(k.lo) || isNum(k.hi)) out.push({ range: [k.lo ?? -Infinity, k.hi ?? Infinity] });
  }
  return out;
}

/** JIT / ExtendsFromMod gates: skip classes that only exist when an absent mod is loaded. */
function gatedOff(asm, td, enabledMods) {
  if (!enabledMods) return false;
  for (const a of asm.attributes(td.token)) {
    if (a.name !== 'JITWhenModsEnabledAttribute' && a.name !== 'ExtendsFromModAttribute') continue;
    try {
      const { fixed } = asm.attributeArgs(a);
      const names = Array.isArray(fixed[0]) ? fixed[0] : fixed;
      if (names.some((n) => typeof n === 'string' && !enabledMods.has(n))) return true;
    } catch { /* ignore */ }
  }
  return false;
}

function makeMachine(asm, td, { tml, enabledMods, cfg, linear, onStore, onLoad, onCall, onReturn, budget = 300000 }) {
  return new Machine(asm, {
    tml,
    concreteType: td,
    linear,
    enabledMods,
    maxDepth: 3,
    budget,
    onStaticLoad: (f) => cfg?.onStaticLoad(f) ?? tmlStaticLoadHook(f),
    onLoad: (recv, name, ctx) => cfg?.onLoad(recv, name) ?? onLoad?.(recv, name, ctx),
    onCall: (callee, args, ctx) => cfg?.onCall(callee, args, ctx) ?? tmlStaticHook(callee, args, ctx) ?? onCall?.(callee, args, ctx),
    onStore: onStore ?? (() => {}),
    onReturn: onReturn ?? (() => {}),
  });
}

/**
 * @param {import('../clr/metadata.js').Assembly} asm
 * @param {{ tml, modId, enabledMods: Set<string>, cfg?: ReturnType<typeof import('../config.js').configHooks> }} opts
 * @returns {Array<{ mod, hook, kind, matchers, field?, value?, add?, mul?, effects?, cond: string[], conditional: boolean }>}
 */
export function extractGlobalOverrides(asm, { tml, modId, enabledMods, cfg }) {
  const out = [];
  const seen = new Set();
  const emit = (rec) => {
    const key = JSON.stringify([rec.hook, rec.kind, rec.matchers, rec.field, rec.value, rec.add, rec.mul, rec.effects, rec.cond]);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ mod: modId, ...rec });
  };
  const withCases = (ctx) => {
    const groups = ctx.caseGroups?.length ? ctx.caseGroups : [ctx.cases ?? []];
    return groups.map((g) => keysToMatchers(asm, g));
  };

  for (const td of asm.types) {
    if (td.flags & TYPE_ABSTRACT || !derivesFromTml(asm, td, 'GlobalItem')) continue;
    if (gatedOff(asm, td, enabledMods)) continue;

    // AppliesToEntity narrows which items this GlobalItem instance exists on.
    let applies = null; // null = every item
    const ate = td.methods.find((m) => m.name === 'AppliesToEntity' && asm.methodBody(m));
    if (ate) {
      const yes = [];
      const no = []; // paths that bail out: what the hook does *not* apply to
      let unresolved = false;
      const m = makeMachine(asm, td, {
        tml, enabledMods, cfg, linear: true,
        onReturn(v, ctx) {
          // a `return true` we cannot pin to an item (a shared `return true` several branches jump to)
          // means "some items, unknown which" — narrowing to nothing would drop the whole GlobalItem
          if (v === 1) { const gs = withCases(ctx).filter((g) => g.length); if (gs.length) yes.push(...gs); else unresolved = true; }
          else if (v?.k === 'keycmp') {
            // `return entity.CountsAsClass(...)` / `return name != "X"` — ANDed with whatever guarded the return
            let own = keysToMatchers(asm, [v.value !== undefined ? { slot: 0, value: v.value } : { slot: 0, match: v.match }]);
            if (v.neg) {
              // `return name != "X"` is the last link of a bail-out chain, so it names an excluded
              // item as surely as a `return false` does — and the earlier links of that same chain
              // are already read as bail-outs. Only a *named* item is taken this way: a negated
              // class or property is a shape, and a shape may well be included by another path.
              for (const m of own) if (m.className || m.id || m.displayName) no.push([m]);
              own = own.map((m) => ({ not: m }));
            }
            for (const g of withCases(ctx)) yes.push([...g, ...own]);
          } else if (v === 0) {
            // A `return false` is evidence too. `AppliesToEntity` is usually written as a list of
            // bail-outs, and reading only the `return true` paths collapses a chain of
            // `name != A && name != B && …` to its last comparison — CalamityBardHealer's doubling
            // of Thorium melee resolved to "any Thorium item that is not Pearl Pike", which is
            // nearly the whole mod, and doubled 9 spears and 13 swords the hook explicitly skips.
            no.push(...withCases(ctx));
          } else if (v !== null) unresolved = true;
        },
      });
      m.run(ate, THIS, [ITEMARG, 1]);
      applies = yes.filter((g) => g.length);
      // Each bail-out narrows the scope by whatever it holds *beyond* what every including path
      // already required. One extra condition negates exactly; a conjunction of several does not
      // (¬(A∧B) is a disjunction), and one the matchers cannot express is left alone rather than
      // guessed at — both keep the hook applying where the miner cannot prove it should not.
      if (applies.length && no.length) {
        const key = (m) => JSON.stringify(m);
        const common = new Set(applies[0].map(key).filter((k) => applies.every((g) => g.some((m) => key(m) === k))));
        for (const g of no) {
          const extra = g.filter((m) => !common.has(key(m)));
          if (extra.length !== 1 || extra[0].unknown) continue;
          for (const a of applies) if (!a.some((m) => key(m) === key({ not: extra[0] }))) a.push({ not: extra[0] });
        }
      }
      if (!applies.length) applies = unresolved ? null : [];
    }
    if (process.env.TL_DEBUG_ATE && ate) console.log('AppliesToEntity', td.name, JSON.stringify(applies));
    if (applies && !applies.length) continue;
    const scope = (groups) => {
      // every matcher group ANDed with the AppliesToEntity groups
      if (!applies) return groups;
      const out = [];
      for (const g of groups) for (const a of applies) out.push([...a, ...g]);
      return out;
    };
    const base = (ctx, kind, extra) => {
      for (const matchers of scope(withCases(ctx))) {
        emit({ hook: extra.hook, kind, matchers, cond: ctx.condTags ?? [], conditional: !!ctx.conditional && !(ctx.condTags?.length), origin: `${td.name}:${extra.hook}:${ctx.offset}`, ...extra });
      }
    };

    // ---- SetDefaults --------------------------------------------------------------------
    const sd = td.methods.find((m) => m.name === 'SetDefaults' && asm.methodBody(m));
    if (sd) {
      const m = makeMachine(asm, td, {
        tml, enabledMods, cfg, linear: true,
        onStore(recv, name, value, ctx) {
          if (recv?.k !== 'itemarg' || !FIELDS.has(name)) return;
          if (value?.k === 'adj' && value.field === name) base(ctx, 'adjust', { hook: 'SetDefaults', field: name, add: value.add, mul: value.mul });
          else if (isNum(value)) base(ctx, 'set', { hook: 'SetDefaults', field: name, value });
          else if (value?.k === 'dc') base(ctx, 'set', { hook: 'SetDefaults', field: 'DamageType', value: value.name });
          else if (value?.k === 'type') base(ctx, 'set', { hook: 'SetDefaults', field: name, value: refId(asm, value) });
        },
      });
      m.run(sd, THIS, [ITEMARG]);
    }

    // ---- equip effects --------------------------------------------------------------------
    for (const [hook, extra] of [['UpdateEquip', []], ['UpdateAccessory', [0]]]) {
      const md = td.methods.find((x) => x.name === hook && asm.methodBody(x));
      if (!md) continue;
      const deltas = new Map(); // json(matchers+cond) → deltas[]
      const hooks = playerHooks((d, ctx) => {
        for (const matchers of scope(withCases(ctx))) {
          const key = JSON.stringify([matchers, ctx.condTags ?? [], !!ctx.conditional]);
          let e = deltas.get(key);
          if (!e) deltas.set(key, (e = { matchers, cond: ctx.condTags ?? [], conditional: !!ctx.conditional && !(ctx.condTags?.length), list: [], origins: new Set() }));
          e.list.push(d);
          e.origins.add(ctx.offset);
        }
      });
      const m = makeMachine(asm, td, { tml, enabledMods, cfg, linear: true, onStore: hooks.onStore, onLoad: hooks.onLoad, onCall: hooks.onCall });
      m.run(md, THIS, [ITEMARG, PLAYER, ...extra]);
      for (const e of deltas.values()) {
        const fx = normalizeEffects(e.list);
        if (fx) emit({ hook, kind: 'effect', matchers: e.matchers, effects: fx, cond: e.cond, conditional: e.conditional, origin: `${td.name}:${hook}:${[...e.origins].join('+')}` });
      }
    }

    // ---- weapon modifiers -------------------------------------------------------------------
    runWeaponModifiers(asm, td, { tml, enabledMods, cfg, linear: true, thisVal: THIS, itemVal: ITEMARG, scope, withCases, emit });
  }
  return out;
}

/** ModifyWeaponDamage / ModifyWeaponCrit / UseTimeMultiplier / UseSpeedMultiplier of a type. */
function runWeaponModifiers(asm, td, { tml, enabledMods, cfg, linear, thisVal, itemVal, scope, withCases, emit, fixedMatchers }) {
  const groupsOf = (ctx) => (fixedMatchers ? [fixedMatchers] : scope(withCases(ctx)));
  const rec = (ctx, kind, extra, hook) => {
    for (const matchers of groupsOf(ctx)) emit({ hook, kind, matchers, cond: ctx.condTags ?? [], conditional: !!ctx.conditional && !(ctx.condTags?.length), origin: `${td.name}:${hook}:${ctx.offset ?? '?'}`, ...extra });
  };
  const args = (extraArgs) => (itemVal === ITEMARG ? [ITEMARG, PLAYER, ...extraArgs] : [PLAYER, ...extraArgs]);

  const mwd = findInherited(asm, td, 'ModifyWeaponDamage');
  if (mwd) {
    const hooks = playerHooks((d, ctx) => {
      if (d.stat === 'damage') rec(ctx, 'damage', { add: d.value }, 'ModifyWeaponDamage');
      else if (d.stat === 'damageMult') rec(ctx, 'damage', { mul: 1 + d.value }, 'ModifyWeaponDamage');
      else if (d.stat === 'damageFlat') rec(ctx, 'damage', { flat: d.value }, 'ModifyWeaponDamage');
    });
    let cur = { k: 'stat', kind: 'damage', cls: 'all' };
    const ref = { k: 'ref', get: () => cur, set: (v) => { if (v?.k === 'stat') cur = v; } };
    const m = makeMachine(asm, td, { tml, enabledMods, cfg, linear, onStore: hooks.onStore, onLoad: hooks.onLoad, onCall: hooks.onCall });
    m.run(mwd, thisVal, args([ref]));
  }
  const mwc = findInherited(asm, td, 'ModifyWeaponCrit');
  if (mwc) {
    let cur = 0;
    let machine;
    const ref = { k: 'ref', get: () => cur, set: (v) => { if (isNum(v)) { cur = 0; rec({ cases: machine.cases, caseGroups: machine.caseGroups, condTags: machine.condTags, conditional: machine.conditional }, 'crit', { add: v }, 'ModifyWeaponCrit'); } } };
    machine = makeMachine(asm, td, { tml, enabledMods, cfg, linear });
    machine.run(mwc, thisVal, args([ref]));
  }
  for (const hook of ['UseTimeMultiplier', 'UseSpeedMultiplier']) {
    const md = findInherited(asm, td, hook);
    if (!md) continue;
    const m = makeMachine(asm, td, {
      tml, enabledMods, cfg, linear: true,
      onReturn(v, ctx) { if (isNum(v) && v > 0 && v !== 1) rec(ctx, hook === 'UseTimeMultiplier' ? 'useTime' : 'useSpeed', { mul: v }, hook); },
    });
    m.run(md, thisVal, args([]));
  }
}

/** The same modifier hooks declared on ModItems themselves (`Murasama.ModifyWeaponDamage`). */
export function extractModItemModifiers(asm, { tml, modId, enabledMods, cfg }) {
  const out = [];
  const emit = (rec) => out.push({ mod: modId, ...rec });
  for (const td of asm.types) {
    if (td.flags & TYPE_ABSTRACT || td.name.includes('`') || !derivesFromTml(asm, td, 'ModItem')) continue;
    if (!['ModifyWeaponDamage', 'ModifyWeaponCrit', 'UseTimeMultiplier', 'UseSpeedMultiplier'].some((h) => findInherited(asm, td, h))) continue;
    runWeaponModifiers(asm, td, {
      tml, enabledMods, cfg, linear: true, thisVal: THIS, itemVal: null,
      scope: (g) => g, withCases: () => [[]], emit, fixedMatchers: [{ id: `${modId}:${td.name}` }],
    });
  }
  return out;
}

export { simpleName };
