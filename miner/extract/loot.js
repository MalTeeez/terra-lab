/**
 * Drops from IL.
 *
 * Mod side: `ModNPC.ModifyNPCLoot`, `GlobalNPC.ModifyNPCLoot` (keyed by `npc.type`
 * comparisons), `ModItem.ModifyItemLoot` / `GlobalItem.ModifyItemLoot` (treasure bags, crates),
 * and `Item.NewItem(...)` straight from `OnKill`. Vanilla side: `ItemDropDatabase.Register*`
 * with `RegisterToNPC(id, rule)` / `RegisterToItem(id, rule)`.
 *
 * Rules are modelled as objects carrying the item ids they can yield; nesting
 * (`OneFromRulesRule`, `DropBasedOnExpertMode`, `OnSuccess`) unions the children. Conditions
 * come from rule arguments (`new Conditions.DownedPlantera()`, `DropHelper.Hardmode()`, `If(() =>
 * downedX)`) and from the flags guarding the call site (`if (Main.hardMode) loot.Add(...)`).
 * Plain integer arguments are only taken as item ids at positions known for the
 * vanilla rule API; `int[]` arrays passed to rules are always item lists.
 */
import { ET } from '../clr/sig.js';
import { decodeIL, ldcValue } from '../clr/il.js';
import { Machine, THIS, UNKNOWN, isNum, tmlStaticHook, tmlStaticLoadHook } from './interp.js';
import { conditionField, expandValue, progressionHooks, siteGates } from './flags.js';
import { TYPE_ABSTRACT, contentRefs, derivesFromTml, gateRefs, refId } from './util.js';

/** Item-id argument index for vanilla rule constructors / factories. */
const ITEM_ARG = {
  Common: 0, CommonDrop: 0, CommonDropNotScalingWithLuck: 0, CommonDropWithRerolls: 0, NotScalingWithLuck: 0,
  MasterModeCommonDrop: 0, MasterModeDropOnAllPlayers: 0, BossBag: 0, ExpertGetsRerolls: 0, NormalvsExpert: 0,
  NormalvsExpertNotScalingWithLuck: 0, DropOneByOne: 0, Food: 0, ItemDropWithConditionRule: 0, Coins: null,
  DropLocalPerClientAndResetsNPCMoneyTo0: 0, DropPerPlayerOnThePlayer: 0, ByCondition: 1, BossBagByCondition: 1,
  DropBasedOnExpertMode: null, DropBasedOnMasterMode: null, DropBasedOnMasterAndExpertMode: null,
  OneFromOptions: null, OneFromOptionsNotScalingWithLuck: null, OneFromOptionsWithNumerator: null, FewFromOptions: null,
  FewFromOptionsNotScalingWithLuck: null, OneFromOptionsDropRule: null, FewFromOptionsDropRule: null,
  OneFromRulesRule: null, SequentialRulesRule: null, SequentialRulesNotScalingWithLuckRule: null,
  AlwaysAtleastOneSuccessDropRule: null, LeadingConditionRule: null, DropNothing: null, CoinsBasedOnNPCValue: null,
  MechBossSpawnersDropRule: null, DropPerPlayerOnThePlayerNotScalingWithLuck: 0,
};

/**
 * Where a rule's drop chance sits in its arguments: `den`/`num` are argument indices holding the
 * chance denominator and numerator, and `one` means the rule rolls *one* of its options, so the
 * chance splits between them. A rule missing from the table drops whatever it names outright.
 */
const CHANCE_ARG = {
  Common: { den: 1 }, NotScalingWithLuck: { den: 1 }, Food: { den: 1 }, ExpertGetsRerolls: { den: 1 },
  CommonDropWithRerolls: { den: 1 }, WithRerolls: { den: 1 },
  // the normal-mode denominator: the dataset has no difficulty, and normal is the pessimistic read
  NormalvsExpert: { den: 1 }, NormalvsExpertNotScalingWithLuck: { den: 1 },
  MasterModeCommonDrop: { den: 1 }, MasterModeDropOnAllPlayers: { den: 1 },
  CommonDrop: { den: 1, num: 4 }, CommonDropNotScalingWithLuck: { den: 1, num: 4 },
  PerPlayer: { den: 1, num: 4 }, DropPerPlayerOnThePlayer: { den: 1, num: 4 },
  DropPerPlayerOnThePlayerNotScalingWithLuck: { den: 1, num: 4 },
  ItemDropWithConditionRule: { den: 1, num: 5 },
  ByCondition: { den: 2, num: 5 }, BossBagByCondition: { den: 2, num: 5 },
  OneFromOptions: { den: 0, one: true }, OneFromOptionsNotScalingWithLuck: { den: 0, one: true },
  OneFromOptionsWithNumerator: { den: 0, num: 1, one: true }, OneFromOptionsDropRule: { den: 0, num: 1, one: true },
  OneFromOptionsNotScaledWithLuckDropRule: { den: 0, num: 1, one: true },
  FromOptionsWithoutRepeatsDropRule: { den: 0, one: true }, OneFromRulesRule: { den: 0, one: true },
  SequentialRules: { den: 0 }, SequentialRulesRule: { den: 0 },
  SequentialRulesNotScalingWithLuck: { den: 0 }, SequentialRulesNotScalingWithLuckRule: { den: 0 },
  FewFromOptions: { den: 1, one: true }, FewFromOptionsNotScalingWithLuck: { den: 1, one: true },
  FewFromOptionsDropRule: { den: 1, num: 2, one: true }, MultipleFromRulesRule: { den: 1, one: true },
  // Calamity: every boss weapon rolls its own `NormalWeaponDropRateFraction` (1/4), all at once
  CalamityStyle: { den: 0 },
};
/** `DropHelper.Add(loot, item, chance, min, max)` / `AddIf(loot, cond, item, chance, …)`: the chance follows the item. */
function addChanceArg(name, args) {
  if (!/^Add/.test(name)) return null;
  const i = args.findIndex((a) => a?.k === 'type' && a.fn === 'ItemType');
  const next = args[i + 1];
  return i >= 0 && (isNum(next) || next?.k === 'frac') ? { den: i + 1 } : null;
}
/** `{ p, split }` for a rule call: `p` is its chance to fire, `split` that it picks one option. */
function chanceOf(name, args) {
  const c = CHANCE_ARG[name] ?? addChanceArg(name, args);
  if (!c) return {};
  const d = args[c.den];
  const n = c.num === undefined ? 1 : args[c.num];
  const p = d?.k === 'frac' ? (d.d > 0 ? d.n / d.d : null) : isNum(d) && d > 0 && isNum(n) && n > 0 ? n / d : null;
  return { p: p === null ? undefined : Math.min(1, p), split: c.one };
}

const isRuleName = (n) => n in ITEM_ARG || /Rule$|Drop$/.test(n);
/** Special-seed conditions (remix / zenith / drunk worlds): those drops are not normal progression. */
const SEED_RE = /Remix|Zenith|Drunk|ForTheWorthy|GetGoodWorld|NotTheBees|NoTraps|DontDigUp|Everything|Anniversary|Celebration|GFB/;
const isSeedArg = (a) => a?.k === 'obj' && SEED_RE.test(a.name ?? '');

/** Progression flags a condition argument stands for (delegate body, condition object). */
function condFlags(asm, a) {
  if (a?.k === 'delegate') return [...gateRefs(a.asm ?? asm, a.method)];
  if (a?.k === 'cond') return a.flags;
  if (a?.k === 'obj' && a.cond) return a.cond; // a conditional drop set (Calamity DefineConditionalDropSet)
  return [];
}
const COND_CLASS_RE = /^(Downed|Post|IsHardmode|Hardmode|NotDowned|NotHardmode|Not)/;
/** `new Conditions.DownedPlantera()` / `DropHelper.PostGolem()` → a condition value. */
function condValue(short) {
  // `NotRemixSeed` holds in a normal world (no requirement) — but whatever hangs off its
  // OnFailedConditions is remix-only loot (the Bubble Gun replacing the Aqua Scepter in a lockbox)
  if (SEED_RE.test(short)) { const not = /^Not/.test(short); return { k: 'cond', flags: not ? [] : [`seed:${short}`], neg: not ? [`seed:${short.slice(3)}`] : [] }; }
  if (!COND_CLASS_RE.test(short)) return undefined;
  return { k: 'cond', flags: /^Not/.test(short) ? [] : [short] };
}

/** Items, child rules and condition flags named by a rule call's arguments. */
function ruleItems(asm, name, args, { intsAreItems, locals = null }) {
  const items = new Set();
  const children = [];
  const cond = [];
  const neg = []; // what holds on the OnFailedConditions path instead
  let pos = ITEM_ARG[name];
  // AddIf(cond, item, …) / DropHelper.AddIf(loot, cond, item, …): the item follows the condition
  if (pos === undefined && /^AddIf|^AddConditional/.test(name)) { const c = args.findIndex((a) => a?.k === 'delegate' || a?.k === 'cond'); if (c >= 0) pos = c + 1; }
  args.forEach((a, i) => {
    for (const f of condFlags(asm, a)) cond.push(f);
    if (a?.k === 'cond' && a.neg) neg.push(...a.neg);
    // A local the method filled in a per-key `if` chain holds only its last value by the time the
    // rule is built (ThoriumRework picks the cosmetic of whichever boss this is, then adds it once
    // at the end): every store into it is an arm, each under the key it was made in.
    const arms = locals?.(a);
    if (arms) {
      for (const s of arms) children.push({ k: 'rule', name: 'local', items: new Set([s.item]), children: [], cond: s.gates, cases: s.cases });
      return;
    }
    // `Main.hardMode ? 5003 : 2336` (a phi) or a constant stored under a flag: each arm is a child
    // rule carrying that arm's flags
    if (a?.k === 'phi' || a?.k === 'maybe') {
      for (const e of expandValue(a, { condTags: [] })) {
        const v = e.v;
        const ids = v?.k === 'type' && v.fn === 'ItemType' ? [refId(asm, v)] : isNum(v) && v > 0 && (i === pos || (intsAreItems && pos === undefined)) ? [`v:${v}`] : [];
        if (ids.length) children.push({ k: 'rule', name: 'phi', items: new Set(ids), children: [], cond: siteGates(e.ctx) });
      }
      return;
    }
    if (a?.k === 'type' && a.fn === 'ItemType') items.add(refId(asm, a));
    else if (a?.k === 'arr') for (const e of a.items) {
      if (e?.k === 'type' && e.fn === 'ItemType') items.add(refId(asm, e));
      else if (isNum(e) && e > 0) items.add(`v:${e}`);
      else if (e?.k === 'rule') children.push(e);
    }
    else if (a?.k === 'rule') children.push(a);
    else if (isNum(a) && a > 0 && (i === pos || (intsAreItems && pos === undefined))) items.add(`v:${a}`);
  });
  return { items, children, cond, neg };
}

function makeRule(asm, name, args, opts) {
  const seed = args.some(isSeedArg);
  const r = { k: 'rule', name, ...ruleItems(asm, name, args, opts), ...chanceOf(name, args), seed };
  if (seed) { r.items = new Set(); r.children = []; }
  return r;
}

/**
 * Every item a rule can yield, through its chained/nested rules, with the condition flags and the
 * drop chance on the way down (`Map<item, { cond: Set<flag>, p }>`; an item reachable
 * unconditionally has no flags). Chances multiply down the chain; an item two rules can both yield
 * keeps the better one.
 */
function allItems(rule, out = new Map(), seen = new Set(), inherited = [], p = 1) {
  if (!rule || seen.has(rule)) return out;
  seen.add(rule);
  const cond = [...inherited, ...(rule.cond ?? [])];
  // a rule that rolls one of its options splits its chance between them
  const q = (p * (rule.p ?? 1)) / (rule.split ? Math.max(1, rule.items.size + rule.children.length) : 1);
  for (const x of rule.items) {
    const cur = out.get(x);
    if (!cur) out.set(x, { cond: new Set(cond), p: q });
    else {
      if (q > cur.p) cur.p = q;
      if (cond.length === 0) cur.cond.clear();
      else if (cur.cond.size) for (const c of [...cur.cond]) if (!cond.includes(c)) cur.cond.delete(c);
    }
  }
  for (const c of rule.children) allItems(c, out, seen, cond, c.fail ? p : q);
  return out;
}

/** Nested rules that carry case keys of their own (a value stored under one key, added under none). */
function keyedArms(rule, out = [], seen = new Set()) {
  if (!rule || seen.has(rule)) return out;
  seen.add(rule);
  if (rule.cases?.length) out.push(rule);
  for (const c of rule.children ?? []) keyedArms(c, out, seen);
  return out;
}

/** Source ids of a call site: a fixed source, or what the case keys say (`npc.type == X`, a range). */
function sourcesOf(sourceOf, cases, fixed) {
  if (fixed) return Array.isArray(fixed) ? fixed : [fixed];
  const s = sourceOf ? sourceOf(cases ?? []) : null;
  if (!s) return [];
  return Array.isArray(s) ? s.filter(Boolean) : [s];
}

/** `npc.type == X` / `item.type == X` cases (and small ranges: `type - 586 <= 1`) → source ids. */
function keyedSources(asm, prefix) {
  return (cases) => {
    const out = [];
    for (const c of cases) {
      if (c.slot !== 0) continue;
      if (isNum(c.value)) out.push(`${prefix}v:${c.value}`);
      else if (c.value !== undefined) { const r = refId(asm, c.value); if (r) out.push(`${prefix}${r}`); }
      // a class-name key: which mod owns the class is only known once every mod is read, so the
      // name travels and `mine.js` resolves it
      // `npc.ModNPC is HellBringerMimic` keys as surely as a name comparison does
      else if (c.match) { const n = c.match.className ?? c.match.classNameContains ?? c.match.classNameStartsWith ?? c.match.is?.split('.').pop(); if (n) out.push(`${prefix}class:${n}`); }
      else if (c.lo !== undefined && c.hi !== undefined && Number.isFinite(c.lo) && Number.isFinite(c.hi) && c.hi - c.lo < 64) for (let i = c.lo; i <= c.hi; i++) out.push(`${prefix}v:${i}`);
    }
    return out;
  };
}

/** Index of the item-type argument of `Item.NewItem` / `QuickSpawnItem` overloads. */
function newItemTypeIndex(callee) {
  const ints = callee.sig.params.map((p, i) => (p.et === ET.I4 ? i : -1)).filter((i) => i >= 0);
  if (callee.name === 'NewItem' && callee.sig.params[1]?.et === ET.I4) return ints[4]; // (source, X, Y, W, H, Type, ...)
  return ints[0];
}

/**
 * Drop-rate constants a mod parks in a static: every Calamity boss weapon rolls
 * `DropHelper.NormalWeaponDropRateFraction`, a `new Fraction(1, 4)` written in a `.cctor` — which
 * `evalLoadStatics` never sees, since it only reads `Load`. Only fractions are answered: letting
 * this resolve anything else would decide branches the loot extractors read both ways on purpose.
 */
const fracStatics = new WeakMap();
function fracStatic(asm, tml, f) {
  let byType = fracStatics.get(asm);
  if (!byType) fracStatics.set(asm, (byType = new Map()));
  const td = f.declaringType?.def ?? f.declaringType;
  const key = td?.fullName ?? td?.name;
  if (!td || !key) return undefined;
  let found = byType.get(key);
  if (!found) {
    byType.set(key, (found = new Map()));
    const cctor = td.methods?.find((m) => m.name === '.cctor');
    let body;
    try { body = cctor && asm.methodBody(cctor); } catch { body = null; }
    if (body && body.il.length <= 2048) {
      const machine = new Machine(asm, {
        tml, budget: 50000, maxDepth: 1,
        onNew: (callee, args) => (callee.declaringType?.name === 'Fraction' && isNum(args[0]) && isNum(args[1]) ? { k: 'frac', n: args[0], d: args[1] } : undefined),
        onStaticStore: (fld, val) => { if (val?.k === 'frac') found.set(fld.name, val); },
      });
      try { machine.run(cctor, undefined, []); } catch { /* partial is fine */ }
    }
  }
  return found.get(f.name);
}

/**
 * Run a loot method and emit `{ source, item, cond?, chance? }` records.
 * `sourceOf(cases)` maps the case-tracker state to source ids (or nothing to skip);
 * `anySource` is used for a drop without a key that is gated by flags (any enemy while X).
 */
export function runLootMethod(asm, md, { tml, thisVal, args, emit, sourceOf, anySource = null, intsAreItems = false, tileSpawns = false, newItemDrops = false, enabledMods = null, statics = null }) {
  // Rules are registered before their chains are attached, so resolve items after the run.
  const pending = [];
  const keyedStores = new Map(); // local index → every keyed store into it, with its key and flags
  const localOfValue = new Map(); // the stored value object → that local (the value keeps its identity)
  /** The keyed stores a rule argument stands for, when it was read out of such a local. */
  const ruleOpts = { intsAreItems, locals: (a) => armsOf(a) };
  const armsOf = (a) => {
    const i = a?.k === 'maybe' && a.local !== undefined ? a.local : localOfValue.get(a);
    const l = i === undefined ? null : keyedStores.get(i);
    return l?.length ? l : null;
  };
  const later = (sources, name, cargs, ctx) => {
    const gates = siteGates(ctx); // `if (Main.hardMode) loot.Add(...)`: the block's flags gate the rule
    let list = sourcesOf(sourceOf, ctx?.cases, sources);
    const r = { ...ruleItems(asm, name, cargs, { ...ruleOpts, intsAreItems: false }), ...chanceOf(name, cargs) };
    // Nothing keys the call site, but an arm of the value does: a mod picks the item in a per-boss
    // `if (npc.ModNPC.Name == "TheGrandThunderBird")` chain and adds it once at the end, so each
    // arm belongs to the boss it was chosen under.
    if (!list.length) {
      const armed = keyedArms(r);
      if (armed.length) {
        for (const arm of armed) for (const source of sourcesOf(sourceOf, arm.cases)) pending.push({ source, r: arm, gates });
        return;
      }
    }
    if (!list.length && gates.length && anySource) list = [anySource];
    for (const source of list) pending.push({ source, r, gates });
  };
  const direct = (item, ctx) => {
    if (!item) return;
    const gates = siteGates(ctx);
    let list = sourcesOf(sourceOf, ctx.cases);
    if (!list.length && gates.length && anySource) list = [anySource];
    for (const source of list) emit(gates.length ? { source, item, cond: gates } : { source, item });
  };
  /** Simple name of a call's return type (`IItemDropRule`), or ''. */
  const retTypeName = (callee) => {
    const t = callee.sig?.ret;
    if (!t || t.token === undefined) return '';
    try { return asm.resolve(t.token)?.name ?? ''; } catch { return ''; }
  };
  const prog = progressionHooks();
  const machine = new Machine(asm, {
    tml,
    enabledMods,
    loadFields: statics,
    concreteType: md.declaringType,
    linear: true,
    noDead: true,
    phi: true,
    maxDepth: 3,
    budget: 400000,
    onStoreLocal(i, val, ctx) {
      if (process.env.TL_TRACE_LOOT && md.declaringType.name === process.env.TL_TRACE_LOOT) console.log('  stloc', i, val?.k, val?.fn, 'cases', JSON.stringify(ctx.cases));
      if (val?.k !== 'type' || val.fn !== 'ItemType' || !ctx.cases?.length) return;
      let l = keyedStores.get(i);
      if (!l) keyedStores.set(i, (l = []));
      l.push({ item: refId(asm, val), cases: ctx.cases, gates: siteGates(ctx) });
      localOfValue.set(val, i);
    },
    onLoad(recv, name) {
      if (recv?.k === 'obj' && recv.name === 'keyArg' && name === 'type') return { k: 'key', slot: 0 };
      // `npc.ModNPC.Name == "TheGrandThunderBird"`: another mod's GlobalNPC keys on the class name
      // rather than the type it cannot reference. The same chain a GlobalItem hook uses on its item.
      if (recv?.k === 'obj' && recv.name === 'keyArg' && (name === 'ModNPC' || name === 'ModItem')) return { k: 'moditem', slot: 0 };
      if (recv?.k === 'obj' && recv.name === 'keyArg') return recv.props[name] ?? UNKNOWN;
      return prog.onLoad(recv, name);
    },
    onStaticLoad: (f) => conditionField(f) ?? prog.onStaticLoad(f) ?? statics?.get(`${f.declaringType?.fullName ?? ''}::${f.name}`) ?? fracStatic(asm, tml, f) ?? tmlStaticLoadHook(f),
    onNew(callee, cargs) {
      const decl = callee.declaringType?.fullName ?? callee.declaringType?.name ?? '';
      const short = decl.split(/[./]/).pop();
      if (short === 'Fraction' && isNum(cargs[0]) && isNum(cargs[1])) return { k: 'frac', n: cargs[0], d: cargs[1] };
      if (/ItemDropRules/.test(decl) && isRuleName(short)) return makeRule(asm, short, cargs, ruleOpts);
      if (/Conditions?[./+]|Condition$/.test(decl) || COND_CLASS_RE.test(short)) {
        // a condition whose name does not give it away (`Conditions.YoyosYelets`): what its own
        // `CanDrop` reads is the gate — hardMode, ZoneJungle and downedMechBossAny for that one
        const canDrop = condValue(short) ? null : callee.declaringType?.def?.methods?.find((x) => x.name === 'CanDrop');
        return condValue(short) ?? { k: 'cond', flags: canDrop ? [...gateRefs(asm, canDrop, { tml })] : [] };
      }
      return undefined;
    },
    onCall(callee, cargs, ctx) {
      const hooked = tmlStaticHook(callee, cargs, ctx);
      if (hooked !== undefined) return hooked;
      const decl = callee.declaringType?.fullName ?? callee.declaringType?.name ?? '';
      const name = callee.name;
      const recv = ctx.recv;
      if (process.env.TL_TRACE_LOOT && md.declaringType.name === process.env.TL_TRACE_LOOT) console.log('  call', decl, name, 'recv', recv?.k ?? recv, 'args', cargs.map((a) => a?.k ?? (typeof a === 'string' ? JSON.stringify(a) : a)).join(','), 'tags', (ctx.condTags ?? []).join(','));
      if (tileSpawns) {
        // any call receiving a TileType<T>() value inside a keyed block spawns that tile; so does a
        // helper called there that names the tile itself (`GenerateHallowedOre()`)
        for (const a of cargs) if (a?.k === 'type' && a.fn === 'TileType') for (const src of sourcesOf(sourceOf, ctx.cases)) emit({ source: src, item: `tile:${refId(asm, a)}` });
        if (callee.def && asm.methodBody(callee.def) && !/^(NewItem|QuickSpawnItem)/.test(name)) for (const t of contentRefs(asm, callee.def, 'TileType')) for (const src of sourcesOf(sourceOf, ctx.cases)) emit({ source: src, item: `tile:${refId(asm, t)}` });
      }
      // `Item.NewItem(source, pos, ItemType<X>())` / `player.QuickSpawnItem(...)` straight from OnKill
      if (newItemDrops && /^(NewItem|QuickSpawnItem|QuickSpawnItemDirect)$/.test(name)) {
        if (callee.kind === 'methodSpec' && callee.typeArgs?.[0]) direct(refId(asm, callee.typeArgs[0]), ctx);
        else {
          const t = cargs.find((a) => a?.k === 'type' && a.fn === 'ItemType');
          const n = cargs[newItemTypeIndex(callee)];
          if (t) direct(refId(asm, t), ctx);
          else if (isNum(n) && n > 0) direct(`v:${n}`, ctx);
        }
        return UNKNOWN;
      }
      // A builder of the mod's own instead of the loot object: `Drops.Add<AstralLash>(ref drops, …)`,
      // `AddBossBag<AstrageldonBag>`, `AddRelic<…>`. Catalyst writes every boss table this way and
      // the item is the generic argument, so none of it reads as a rule. The bag lands as a drop
      // like any other, which is what chains its contents to the boss.
      if (callee.kind === 'methodSpec' && callee.typeArgs?.length === 1 && /^Add[A-Z]?/.test(name) && !isRuleName(name)) {
        const it = refId(asm, callee.typeArgs[0]);
        if (it) { for (const src of sourcesOf(sourceOf, ctx.cases)) emit({ source: src, item: it }); return recv ?? UNKNOWN; }
      }
      // Splicing into a table another mod already built: `npcLoot.RemoveWhere(rule => { …
      // stacks[n] = ItemType<Trinity>(); … })` grows Calamity's boss weapon pool by two and puts
      // its own weapons in the new slots. Nothing in there reads as a rule. A predicate like this
      // is also how rules get removed, so only the mod's own items count — those it can only be
      // adding, since they were never in someone else's table to begin with.
      if (/^(RemoveWhere|Find|FindWhere)$/.test(name)) {
        const d = cargs.find((a) => a?.k === 'delegate' && a.method);
        const srcs = d ? sourcesOf(sourceOf, ctx.cases) : [];
        if (srcs.length) for (const t of contentRefs(d.asm ?? asm, d.method)) {
          const it = refId(d.asm ?? asm, t);
          if (it?.startsWith(`${asm.name}:`)) for (const src of srcs) emit({ source: src, item: it }, true);
        }
      }
      if (tileSpawns && !newItemDrops) return undefined;
      const flag = prog.onCall(callee);
      if (flag !== undefined) return flag;
      // seed-conditional loot sets (Calamity DropHelper.Remix etc.) - ignore what goes into them
      if (/^get_(Remix|Zenith|Drunk|ForTheWorthy|GetGoodWorld|NotTheBees|NoTraps|DontDigUp|Everything|GFB)/.test(name)) {
        // the seed is the condition, so a `DefineConditionalDropSet` over one carries it to its Adds
        // (Calamity's Hive Mind hands out the vanilla emblems, but only on Get Fixed Boi)
        return { k: 'obj', name: `${name.slice(4)}SeedLoot`, props: {}, cond: [`seed:${name.slice(4)}`] };
      }
      if (cargs.some(isSeedArg) && recv === undefined) return { k: 'obj', name: 'SeedLoot', props: {} };
      if (recv?.k === 'obj' && SEED_RE.test(recv.name ?? '')) return recv;
      // `Condition.DownedEowOrBoc.ToDropCondition(…)`: a shop condition dressed as a drop condition
      if (/^ToDropCondition/.test(name)) return cargs.find((a) => a?.k === 'cond') ?? UNKNOWN;
      // condition factories: DropHelper.PostGolem(), Conditions.IsHardmode(), DropHelper.Hardmode(ui: true) ...
      if (!callee.sig.hasThis && COND_CLASS_RE.test(name) && !isRuleName(name) && cargs.every((a) => isNum(a) || a === null || a === undefined)) return condValue(name);
      // rule factories: ItemDropRule.X(...) and mod helpers returning rules
      if (!callee.sig.hasThis && (decl.endsWith('ItemDropRule') || isRuleName(name))) {
        return makeRule(asm, name, cargs, ruleOpts);
      }
      // Chains.OnSuccess(parent, child) (static extension) or parent.OnSuccess(child)
      if (name === 'OnSuccess' || name === 'OnFailedRoll' || name === 'OnFailedConditions') {
        const parent = recv?.k === 'rule' ? recv : cargs[0]?.k === 'rule' ? cargs[0] : null;
        const child = (recv?.k === 'rule' ? cargs[0] : cargs[1]);
        if (parent && child?.k === 'rule') {
          if (name === 'OnFailedConditions' && parent.neg?.length) child.cond = [...(child.cond ?? []), ...parent.neg];
          // a fail chain is how vanilla writes a *list* of independent drops (Bone Sword hangs three
          // rules deep off a 1/100 one): the child rolls its own chance, not the parent's as well
          if (name !== 'OnSuccess') child.fail = true;
          parent.children.push(child);
        }
        return child?.k === 'rule' ? child : parent ?? UNKNOWN;
      }
      if (recv?.k === 'rule') return recv;
      // loot.Add(rule) / loot.AddIf(cond, rule) / set.Add(...) / RegisterToNPC(id, rule)
      if (name === 'RegisterToNPC' || name === 'RegisterToNPCNetId') {
        const npc = cargs[0];
        if (isNum(npc)) later(`npc:v:${npc}`, '', cargs.slice(1), ctx);
        return cargs[1]?.k === 'rule' ? cargs[1] : makeRule(asm, '', cargs.slice(1), { ...ruleOpts, intsAreItems: false });
      }
      // a rule every NPC rolls, gated by its own condition — how vanilla drops the biome yoyos
      if (name === 'RegisterToGlobal') { later('npc:*', '', cargs, ctx); return cargs[0]; }
      if (name === 'RegisterToMultipleNPCs' || name === 'RegisterToMultipleNPCsNotRemixSeed' || name === 'RegisterToMultipleNPCsRemixSeed') {
        const npcs = cargs[1]?.k === 'arr' ? cargs[1].items.filter(isNum) : [];
        for (const n of npcs) later(`npc:v:${n}`, '', [cargs[0]], ctx);
        return cargs[0];
      }
      if (name === 'RegisterToItem' || name === 'RegisterToItemId') {
        const it = cargs[0];
        if (isNum(it)) later(`bag:v:${it}`, '', cargs.slice(1), ctx);
        return cargs[1];
      }
      if (name === 'RegisterToMultipleItems') {
        const bags = cargs[1]?.k === 'arr' ? cargs[1].items.filter(isNum) : [];
        for (const b of bags) later(`bag:v:${b}`, '', [cargs[0]], ctx);
        return cargs[0];
      }
      if (/^(Add|AddIf|AddNormalOnly|AddExpertOnly|AddMasterOnly|AddConditional|Define\w+|AddBossBag)/.test(name) || (recv === undefined && /Drop|Loot|Add/.test(name))) {
        // a mod helper that builds its rules inside (`loot.AddRevBagAccessories()`): walk it
        if (recv === undefined && callee.def && asm.methodBody(callee.def) && !cargs.some((a) => a?.k === 'rule' || a?.k === 'type' || a?.k === 'arr' || a?.k === 'delegate' || a?.k === 'cond' || (a?.k === 'obj' && a.cond) || isNum(a))) return undefined;
        later(null, name, cargs, ctx);
        // helpers commonly return the rule or the loot set; pass the first rule through.
        // A conditional set (DefineConditionalDropSet(loot, () => downedX)) carries its flags to later Adds.
        const rule = cargs.find((a) => a?.k === 'rule');
        if (rule) return rule;
        // a set defined over a world seed stays a seed set, so its later Adds are ignored too
        // (Calamity's Hive Mind hands out the vanilla emblems, but only on Get Fixed Boi)
        const seedSet = cargs.find(isSeedArg);
        if (seedSet) return seedSet;
        const flags = cargs.flatMap((a) => condFlags(asm, a));
        if (/^Define/.test(name) && flags.length) return { k: 'obj', name: 'loot', props: {}, cond: flags };
        return recv?.k === 'obj' ? recv : { k: 'obj', name: 'loot', props: {} };
      }
      // any other static helper that hands back a drop rule (Calamity's DropHelper.PerPlayer,
      // CalamityStyle, ...): build the rule from its arguments rather than walking into it, so the
      // set it is handed to still decides the conditions
      if (!callee.sig.hasThis && /ItemDropRule$/.test(retTypeName(callee))) return makeRule(asm, name, cargs, ruleOpts);
      return undefined;
    },
  });
  try {
    machine.run(md, thisVal, args, asm);
  } catch (e) { if (process.env.TL_STRICT) throw e; }
  for (const { source, r, gates } of pending) {
    for (const [it, { cond, p }] of allItems(r)) {
      const all = [...new Set([...cond, ...gates])];
      const chance = p < 1 ? Math.round(p * 1e6) / 1e6 : undefined;
      if (process.env.TL_TRACE_ITEM && it.includes(process.env.TL_TRACE_ITEM)) console.log('emit', it, 'from', `${md.declaringType.name}::${md.name}`, 'source', source, 'cond', JSON.stringify(all), 'chance', p, 'rule', r.name);
      emit({ source, item: it, ...(all.length ? { cond: all } : {}), ...(chance ? { chance } : {}) });
    }
  }
}

/**
 * Drops declared by a mod's NPCs (and its GlobalNPC hooks), its treasure bags / crates, and what
 * it adds to vanilla bags. Sources: `npc:<id>`, `bag:<id>`, `npc:*` (any enemy under a flag).
 * @returns {Array<{ source: string, item: string, cond?: string[] }>}
 */
export function extractModDrops(asm, { tml, modId, enabledMods = null, statics = null }) {
  const out = [];
  const seen = new Map();
  // `fallback` records (every ItemType<T>() the method mentions) never override a rule's conditions
  const emit = (d, fallback = false) => {
    if (!d.item) return;
    const k = `${d.source}|${d.item}`;
    const prev = seen.get(k);
    if (prev) {
      if (prev.cond && !d.cond && !fallback) delete prev.cond;
      // the same item off two rules (normal vs expert, a pity roll): the better chance is the one
      if (!fallback && (d.chance ?? 1) > (prev.chance ?? 0)) { if (d.chance) prev.chance = d.chance; else delete prev.chance; }
      return;
    }
    seen.set(k, d);
    out.push(d);
  };
  const npcArg = { k: 'obj', name: 'keyArg', props: {} };
  const lootArg = { k: 'obj', name: 'loot', props: {} };
  const npcSources = keyedSources(asm, 'npc:');
  const bagSources = keyedSources(asm, 'bag:');
  const nested = new Map(); // owning type's full name → its nested types (compiler closures included)
  for (const t of asm.types) {
    const i = t.fullName.lastIndexOf('/');
    if (i <= 0) continue;
    const k = t.fullName.slice(0, i);
    let l = nested.get(k);
    if (!l) nested.set(k, (l = []));
    l.push(t);
  }
  /** Does this method build drop rules? (Its IL touches the `ItemDropRules` namespace.) */
  const buildsRules = (md) => {
    const body = asm.methodBody(md);
    if (!body) return false;
    let ins;
    try { ins = decodeIL(body.il); } catch { return false; }
    for (const x of ins) {
      if (x.op !== 'call' && x.op !== 'callvirt' && x.op !== 'newobj') continue;
      let d;
      try { d = asm.resolve(x.operand); } catch { continue; }
      if (/ItemDropRules/.test(d?.declaringType?.fullName ?? '')) return true;
    }
    return false;
  };

  for (const td of asm.types) {
    if (td.flags & TYPE_ABSTRACT) continue;
    if (derivesFromTml(asm, td, 'ModNPC')) {
      const src = `npc:${modId}:${td.name}`;
      const m = td.methods.find((x) => x.name === 'ModifyNPCLoot' && asm.methodBody(x));
      if (m) {
        runLootMethod(asm, m, { tml, enabledMods, statics, thisVal: THIS, args: [lootArg], emit, sourceOf: () => src });
        for (const t of contentRefs(asm, m)) emit({ source: src, item: refId(asm, t) }, true);
      }
      const kill = td.methods.find((x) => x.name === 'OnKill' && asm.methodBody(x));
      if (kill) runLootMethod(asm, kill, { tml, thisVal: THIS, args: [], emit, sourceOf: () => src, tileSpawns: true, newItemDrops: true });
      // A mod may hand its boss tables to a registry of its own instead of the loot hook — Thorium
      // registers a lambda with its SharedBossLootSystem from SetStaticDefaults, so `ModifyNPCLoot`
      // shows only the trophy and the bag. The rules are still written on the NPC's own type, so
      // any other method of it (its compiler closures included) that builds drop rules is its loot.
      // …and on a base class it shares with its variants, keyed to whichever type registers it:
      // Thorium's Borean Strider hands `SharedBossLootSystem.ByType[NPC.type]` a lambda that lives
      // in a closure nested under `BoreanStriderBase`, and none of its six drops are anywhere else.
      const own = [td];
      for (let base = asm.baseOf(td); base?.kind === 'typeDef' && own.length < 8; base = asm.baseOf(base.def)) own.push(base.def);
      for (const cand of own.flatMap((t) => [...t.methods, ...(nested.get(t.fullName) ?? []).flatMap((n) => n.methods)])) {
        if (cand === m || cand === kill || !asm.methodBody(cand) || !buildsRules(cand)) continue;
        runLootMethod(asm, cand, { tml, thisVal: THIS, args: new Array(asm.methodSig(cand).params.length).fill(UNKNOWN), emit, sourceOf: () => src });
      }
    } else if (derivesFromTml(asm, td, 'GlobalNPC')) {
      const kill = td.methods.find((x) => x.name === 'OnKill' && asm.methodBody(x));
      // `if (npc.type == NPCID.X) SpawnOre(TileType<Y>())` / `Item.NewItem(...)` — case-tracked on npc.type
      if (kill) runLootMethod(asm, kill, { tml, thisVal: THIS, args: [npcArg], emit, sourceOf: npcSources, anySource: 'npc:*', tileSpawns: true, newItemDrops: true });
      const m = td.methods.find((x) => x.name === 'ModifyNPCLoot' && asm.methodBody(x));
      if (m) runLootMethod(asm, m, { tml, enabledMods, statics, thisVal: THIS, args: [npcArg, lootArg], emit, sourceOf: npcSources, anySource: 'npc:*' });
      // `ModifyGlobalLoot`: a rule every NPC rolls, gated by its own condition class. Thorium's
      // Soul of Plight and Pharaoh's Breath are registered here and nowhere else.
      const gl = td.methods.find((x) => x.name === 'ModifyGlobalLoot' && asm.methodBody(x));
      if (gl) runLootMethod(asm, gl, { tml, enabledMods, statics, thisVal: THIS, args: [lootArg], emit, sourceOf: () => 'npc:*', anySource: 'npc:*' });
      // Vanilla-boss tables handed to a registry of the mod's own instead of the loot hook —
      // Thorium's `SharedBossLootSystem.ByType[NPCID.BrainofCthulhu] = new Provider(() => rules)`.
      // The rules live in the lambda; the constant pushed before the delegate names the NPC.
      for (const reg of td.methods) {
        const body = asm.methodBody(reg);
        if (!body) continue;
        let ins;
        try { ins = decodeIL(body.il); } catch { continue; }
        let key;
        for (const x of ins) {
          const v = ldcValue(x);
          if (v !== undefined) { if (v > 0) key = v; continue; }
          if (x.op !== 'ldftn' || key === undefined) continue;
          let fn;
          try { fn = asm.resolve(x.operand)?.def; } catch { continue; }
          if (!fn || !asm.methodBody(fn) || !buildsRules(fn)) continue;
          runLootMethod(asm, fn, { tml, thisVal: THIS, args: new Array(asm.methodSig(fn).params.length).fill(UNKNOWN), emit, sourceOf: () => `npc:v:${key}` });
        }
      }
    } else if (derivesFromTml(asm, td, 'ModItem')) {
      const m = td.methods.find((x) => x.name === 'ModifyItemLoot' && asm.methodBody(x));
      if (!m) continue;
      const src = `bag:${modId}:${td.name}`;
      runLootMethod(asm, m, { tml, enabledMods, statics, thisVal: THIS, args: [lootArg], emit, sourceOf: () => src });
      for (const t of contentRefs(asm, m)) emit({ source: src, item: refId(asm, t) }, true);
    } else if (derivesFromTml(asm, td, 'GlobalItem')) {
      // what the mod adds to vanilla (and other mods') bags and crates, keyed on item.type
      const m = td.methods.find((x) => x.name === 'ModifyItemLoot' && asm.methodBody(x));
      if (m) runLootMethod(asm, m, { tml, enabledMods, statics, thisVal: THIS, args: [npcArg, lootArg], emit, sourceOf: bagSources });
    }
  }
  return out;
}

/**
 * Developer sets. `Player.OpenBossBag` rolls `TryGettingDevArmor` for every treasure bag the game
 * does not flag `PreHardmodeLikeBossBag`, so they are hardmode boss bag loot and nothing else —
 * no drop rule names them, which left every dev wing on its rarity guess.
 * @param {Set<string>} bagIds  every vanilla treasure bag item id
 * @returns {Array<{ source: string, item: string }>}
 */
export function extractDevArmor(tml, bagIds) {
  const td = tml.typeByName.get('Terraria.Player');
  const m = td?.methods.find((x) => x.name === 'TryGettingDevArmor' && tml.methodBody(x));
  if (!m) return [];
  const items = new Set();
  runLootMethod(tml, m, {
    tml, thisVal: THIS, args: [UNKNOWN], newItemDrops: true,
    emit: (d) => items.add(d.item), sourceOf: () => 'dev', anySource: 'dev',
  });
  const preHardmode = boolSetIds(tml, 'PreHardmodeLikeBossBag');
  const bags = [...bagIds].filter((id) => !preHardmode.has(id));
  return bags.flatMap((bag) => [...items].map((item) => ({ source: `bag:${bag}`, item })));
}

/** The item ids in one `ItemID.Sets.<name>` bool set (`Factory.CreateBoolSet(ids…)`). */
function boolSetIds(tml, name) {
  const out = new Set();
  const sets = tml.typeByName.get('Terraria.ID.ItemID/Sets');
  const cctor = sets?.methods.find((m) => m.name === '.cctor' && tml.methodBody(m));
  if (!cctor) return out;
  const machine = new Machine(tml, {
    tml, budget: 2_000_000, maxDepth: 1,
    onCall: (callee, args) => (/^Create(Bool|Int)Set$/.test(callee.name) ? args.find((a) => a?.k === 'arr') ?? UNKNOWN : undefined),
    onStaticStore(f, val) { if (f.name === name && val?.k === 'arr') for (const v of val.items) if (isNum(v) && v > 0) out.add(`v:${v}`); },
  });
  try { machine.run(cctor, undefined, []); } catch { /* partial */ }
  return out;
}

/** Vanilla drops from `ItemDropDatabase.Register*`. */
export function extractVanillaDrops(tml) {
  const out = [];
  const seen = new Set();
  const emit = (d) => {
    const k = `${d.source}|${d.item}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(d);
  };
  const db = tml.typeByName.get('Terraria.GameContent.ItemDropRules.ItemDropDatabase');
  if (!db) return out;
  for (const m of db.methods) {
    if (!/^Register/.test(m.name) || !tml.methodBody(m)) continue;
    if (/^RegisterTo/.test(m.name)) continue;
    runLootMethod(tml, m, { tml, thisVal: THIS, args: [], emit, sourceOf: () => null });
  }
  return out;
}
