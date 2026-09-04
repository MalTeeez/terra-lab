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
  const r = { k: 'rule', name, ...ruleItems(asm, name, args, opts), seed };
  if (seed) { r.items = new Set(); r.children = []; }
  return r;
}

/**
 * Every item a rule can yield, through its chained/nested rules, with the condition flags
 * on the way down (`Map<item, Set<flag>>`; an item reachable unconditionally has no flags).
 */
function allItems(rule, out = new Map(), seen = new Set(), inherited = []) {
  if (!rule || seen.has(rule)) return out;
  seen.add(rule);
  const cond = [...inherited, ...(rule.cond ?? [])];
  for (const x of rule.items) {
    const cur = out.get(x);
    if (!cur) out.set(x, new Set(cond));
    else if (cond.length === 0) cur.clear();
    else if (cur.size) for (const c of [...cur]) if (!cond.includes(c)) cur.delete(c);
  }
  for (const c of rule.children) allItems(c, out, seen, cond);
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
      else if (c.match) { const n = c.match.className ?? c.match.classNameContains ?? c.match.classNameStartsWith; if (n) out.push(`${prefix}class:${n}`); }
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
 * Run a loot method and emit `{ source, item, cond? }` records.
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
    const r = ruleItems(asm, name, cargs, { ...ruleOpts, intsAreItems: false });
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
    concreteType: md.declaringType,
    linear: true,
    noDead: true,
    phi: true,
    maxDepth: 3,
    budget: 400000,
    onStoreLocal(i, val, ctx) {
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
    onStaticLoad: (f) => conditionField(f) ?? prog.onStaticLoad(f) ?? statics?.get(`${f.declaringType?.fullName ?? ''}::${f.name}`) ?? tmlStaticLoadHook(f),
    onNew(callee, cargs) {
      const decl = callee.declaringType?.fullName ?? callee.declaringType?.name ?? '';
      const short = decl.split(/[./]/).pop();
      if (/ItemDropRules/.test(decl) && isRuleName(short)) return makeRule(asm, short, cargs, ruleOpts);
      if (/Conditions?[./+]|Condition$/.test(decl) || COND_CLASS_RE.test(short)) {
        // a condition whose name does not give it away (`Conditions.YoyosYelets`): what its own
        // `CanDrop` reads is the gate — hardMode, ZoneJungle and downedMechBossAny for that one
        const canDrop = condValue(short) ? null : callee.declaringType?.def?.methods?.find((x) => x.name === 'CanDrop');
        return condValue(short) ?? { k: 'cond', flags: canDrop ? [...gateRefs(asm, canDrop)] : [] };
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
    const items = new Map();
    for (const x of r.items) items.set(x, new Set(r.cond));
    for (const c of r.children) allItems(c, items, new Set(), r.cond);
    for (const [it, cond] of items) {
      const all = [...new Set([...cond, ...gates])];
      if (process.env.TL_TRACE_ITEM && it.includes(process.env.TL_TRACE_ITEM)) console.log('emit', it, 'from', `${md.declaringType.name}::${md.name}`, 'source', source, 'cond', JSON.stringify(all), 'rule', r.name);
      emit(all.length ? { source, item: it, cond: all } : { source, item: it });
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
    if (prev) { if (prev.cond && !d.cond && !fallback) delete prev.cond; return; }
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
      for (const cand of [...td.methods, ...(nested.get(td.fullName) ?? []).flatMap((n) => n.methods)]) {
        if (cand === m || cand === kill || !asm.methodBody(cand) || !buildsRules(cand)) continue;
        runLootMethod(asm, cand, { tml, thisVal: THIS, args: new Array(asm.methodSig(cand).params.length).fill(UNKNOWN), emit, sourceOf: () => src });
      }
    } else if (derivesFromTml(asm, td, 'GlobalNPC')) {
      const kill = td.methods.find((x) => x.name === 'OnKill' && asm.methodBody(x));
      // `if (npc.type == NPCID.X) SpawnOre(TileType<Y>())` / `Item.NewItem(...)` — case-tracked on npc.type
      if (kill) runLootMethod(asm, kill, { tml, thisVal: THIS, args: [npcArg], emit, sourceOf: npcSources, anySource: 'npc:*', tileSpawns: true, newItemDrops: true });
      const m = td.methods.find((x) => x.name === 'ModifyNPCLoot' && asm.methodBody(x));
      if (m) runLootMethod(asm, m, { tml, enabledMods, statics, thisVal: THIS, args: [npcArg, lootArg], emit, sourceOf: npcSources, anySource: 'npc:*' });
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
