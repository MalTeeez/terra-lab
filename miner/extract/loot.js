/**
 * Drops from IL.
 *
 * Mod side: `ModNPC.ModifyNPCLoot`, `GlobalNPC.ModifyNPCLoot` (keyed by `npc.type`
 * comparisons), `ModItem.ModifyItemLoot` (treasure bags, crates). Vanilla side:
 * `ItemDropDatabase.Register*` with `RegisterToNPC(id, rule)` / `RegisterToItem(id, rule)`.
 *
 * Rules are modelled as objects carrying the item ids they can yield; nesting
 * (`OneFromRulesRule`, `DropBasedOnExpertMode`, `OnSuccess`) unions the children.
 * Plain integer arguments are only taken as item ids at positions known for the
 * vanilla rule API; `int[]` arrays passed to rules are always item lists.
 */
import { Machine, THIS, UNKNOWN, isNum, tmlStaticHook, tmlStaticLoadHook } from './interp.js';
import { TYPE_ABSTRACT, contentRefs, derivesFromTml, refId } from './util.js';

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
const SEED_RE = /Remix|Zenith|Drunk|ForTheWorthy|GetGoodWorld|NotTheBees|NoTraps|DontDigUp|Everything|Anniversary|Celebration/i;
const isSeedArg = (a) => a?.k === 'obj' && SEED_RE.test(a.name ?? '');

/** Items and child rules named by a rule call's arguments. */
function ruleItems(asm, name, args, { intsAreItems }) {
  const items = new Set();
  const children = [];
  const pos = ITEM_ARG[name];
  args.forEach((a, i) => {
    if (a?.k === 'type' && a.fn === 'ItemType') items.add(refId(asm, a));
    else if (a?.k === 'arr') for (const e of a.items) {
      if (e?.k === 'type' && e.fn === 'ItemType') items.add(refId(asm, e));
      else if (isNum(e) && e > 0) items.add(`v:${e}`);
      else if (e?.k === 'rule') children.push(e);
    }
    else if (a?.k === 'rule') children.push(a);
    else if (isNum(a) && a > 0 && (i === pos || (intsAreItems && pos === undefined))) items.add(`v:${a}`);
  });
  return { items, children };
}

function makeRule(asm, name, args, opts) {
  const seed = args.some(isSeedArg);
  const r = { k: 'rule', name, ...ruleItems(asm, name, args, opts), seed };
  if (seed) { r.items = new Set(); r.children = []; }
  return r;
}

/** Every item a rule can yield, through its chained/nested rules. */
function allItems(rule, out = new Set(), seen = new Set()) {
  if (!rule || seen.has(rule)) return out;
  seen.add(rule);
  for (const x of rule.items) out.add(x);
  for (const c of rule.children) allItems(c, out, seen);
  return out;
}

/** Items from a list of call arguments (rules, arrays, refs, known int positions). */
function argItems(asm, name, args, opts) {
  const r = ruleItems(asm, name, args, opts);
  const out = new Set(r.items);
  for (const c of r.children) allItems(c, out);
  return out;
}

/**
 * Run a loot method and emit `{ source, item }` pairs.
 * `sourceOf(cases)` maps the case-tracker state to a source id (or null to skip).
 */
export function runLootMethod(asm, md, { tml, thisVal, args, emit, sourceOf, intsAreItems = false, tileSpawns = false }) {
  // Rules are registered before their chains are attached, so resolve items after the run.
  const pending = [];
  const later = (source, name, cargs) => {
    if (!source) return;
    pending.push({ source, r: ruleItems(asm, name, cargs, { intsAreItems: false }) });
  };
  const machine = new Machine(asm, {
    tml,
    concreteType: md.declaringType,
    linear: true,
    maxDepth: 3,
    budget: 400000,
    onLoad(recv, name) {
      if (recv?.k === 'obj' && recv.name === 'keyArg' && name === 'type') return { k: 'key', slot: 0 };
      if (recv?.k === 'obj' && recv.name === 'keyArg') return recv.props[name] ?? UNKNOWN;
      return undefined;
    },
    onStaticLoad: tmlStaticLoadHook,
    onNew(callee, cargs) {
      const decl = callee.declaringType?.fullName ?? callee.declaringType?.name ?? '';
      const short = decl.split(/[./]/).pop();
      if (/ItemDropRules/.test(decl) && isRuleName(short)) return makeRule(asm, short, cargs, { intsAreItems });
      return undefined;
    },
    onCall(callee, cargs, ctx) {
      const hooked = tmlStaticHook(callee, cargs, ctx);
      if (hooked !== undefined) return hooked;
      const decl = callee.declaringType?.fullName ?? callee.declaringType?.name ?? '';
      const name = callee.name;
      const recv = ctx.recv;
      if (tileSpawns) {
        // any call receiving a TileType<T>() value inside a keyed block spawns that tile
        for (const a of cargs) if (a?.k === 'type' && a.fn === 'TileType') {
          const src = sourceOf(ctx.cases);
          if (src) emit({ source: src, item: `tile:${refId(asm, a)}` });
        }
        return undefined;
      }
      // seed-conditional loot sets (Calamity DropHelper.Remix etc.) — ignore what goes into them
      if (/^get_(Remix|Zenith|Drunk|ForTheWorthy|GetGoodWorld|NotTheBees|NoTraps|DontDigUp|Everything)/.test(name)) {
        return { k: 'obj', name: `${name.slice(4)}SeedLoot`, props: {} };
      }
      if (cargs.some(isSeedArg) && recv === undefined) return { k: 'obj', name: 'SeedLoot', props: {} };
      if (recv?.k === 'obj' && SEED_RE.test(recv.name ?? '')) return recv;
      // rule factories: ItemDropRule.X(...) and mod helpers returning rules
      if (!callee.sig.hasThis && (decl.endsWith('ItemDropRule') || isRuleName(name))) {
        return makeRule(asm, name, cargs, { intsAreItems });
      }
      // Chains.OnSuccess(parent, child) (static extension) or parent.OnSuccess(child)
      if (name === 'OnSuccess' || name === 'OnFailedRoll' || name === 'OnFailedConditions') {
        const parent = recv?.k === 'rule' ? recv : cargs[0]?.k === 'rule' ? cargs[0] : null;
        const child = (recv?.k === 'rule' ? cargs[0] : cargs[1]);
        if (parent && child?.k === 'rule') parent.children.push(child);
        return child?.k === 'rule' ? child : parent ?? UNKNOWN;
      }
      if (recv?.k === 'rule') return recv;
      // loot.Add(rule) / loot.AddIf(cond, rule) / set.Add(...) / RegisterToNPC(id, rule)
      if (name === 'RegisterToNPC' || name === 'RegisterToNPCNetId') {
        const npc = cargs[0];
        if (isNum(npc)) later(`npc:v:${npc}`, '', cargs.slice(1));
        return cargs[1]?.k === 'rule' ? cargs[1] : makeRule(asm, '', cargs.slice(1), { intsAreItems: false });
      }
      if (name === 'RegisterToMultipleNPCs' || name === 'RegisterToMultipleNPCsNotRemixSeed' || name === 'RegisterToMultipleNPCsRemixSeed') {
        const npcs = cargs[1]?.k === 'arr' ? cargs[1].items.filter(isNum) : [];
        for (const n of npcs) later(`npc:v:${n}`, '', [cargs[0]]);
        return cargs[0];
      }
      if (name === 'RegisterToItem' || name === 'RegisterToItemId') {
        const it = cargs[0];
        if (isNum(it)) later(`bag:v:${it}`, '', cargs.slice(1));
        return cargs[1];
      }
      if (name === 'RegisterToMultipleItems') {
        const bags = cargs[1]?.k === 'arr' ? cargs[1].items.filter(isNum) : [];
        for (const b of bags) later(`bag:v:${b}`, '', [cargs[0]]);
        return cargs[0];
      }
      if (/^(Add|AddIf|AddNormalOnly|AddExpertOnly|AddMasterOnly|AddConditional|Define\w+|AddBossBag)/.test(name) || (recv === undefined && /Drop|Loot|Add/.test(name))) {
        later(sourceOf(ctx.cases), name, cargs);
        // helpers commonly return the rule or the loot set; pass the first rule through
        const rule = cargs.find((a) => a?.k === 'rule');
        return rule ?? (recv?.k === 'obj' ? recv : { k: 'obj', name: 'loot', props: {} });
      }
      return undefined;
    },
  });
  try {
    machine.run(md, thisVal, args, asm);
  } catch { /* keep going */ }
  for (const { source, r } of pending) {
    const items = new Set(r.items);
    for (const c of r.children) allItems(c, items);
    for (const it of items) emit({ source, item: it });
  }
}

/**
 * Drops declared by a mod's NPCs (and its GlobalNPC hooks) and its treasure bags.
 * @returns {Array<{ source: string, item: string }>}
 */
export function extractModDrops(asm, { tml, modId }) {
  const out = [];
  const seen = new Set();
  const emit = (d) => {
    if (!d.item) return;
    const k = `${d.source}|${d.item}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(d);
  };
  const npcArg = { k: 'obj', name: 'keyArg', props: {} };
  const lootArg = { k: 'obj', name: 'loot', props: {} };

  for (const td of asm.types) {
    if (td.flags & TYPE_ABSTRACT) continue;
    if (derivesFromTml(asm, td, 'ModNPC')) {
      const m = td.methods.find((x) => x.name === 'ModifyNPCLoot' && asm.methodBody(x));
      if (!m) continue;
      const src = `npc:${modId}:${td.name}`;
      runLootMethod(asm, m, { tml, thisVal: THIS, args: [lootArg], emit, sourceOf: () => src });
      for (const t of contentRefs(asm, m)) emit({ source: src, item: refId(asm, t) });
      const kill = td.methods.find((x) => x.name === 'OnKill' && asm.methodBody(x));
      if (kill) for (const t of contentRefs(asm, kill, 'TileType')) emit({ source: src, item: `tile:${refId(asm, t)}` });
    } else if (derivesFromTml(asm, td, 'GlobalNPC')) {
      const kill = td.methods.find((x) => x.name === 'OnKill' && asm.methodBody(x));
      if (kill) {
        // `if (npc.type == NPCID.X) SpawnOre(TileType<Y>())` — case-tracked on npc.type
        runLootMethod(asm, kill, {
          tml, thisVal: THIS, args: [npcArg], emit,
          sourceOf: (cases) => {
            const c = cases.find((x) => x.slot === 0);
            if (!c) return null;
            return isNum(c.value) ? `npc:v:${c.value}` : `npc:${refId(asm, c.value)}`;
          },
          tileSpawns: true,
        });
      }
      const m = td.methods.find((x) => x.name === 'ModifyNPCLoot' && asm.methodBody(x));
      if (!m) continue;
      runLootMethod(asm, m, {
        tml, thisVal: THIS, args: [npcArg, lootArg], emit,
        sourceOf: (cases) => {
          const c = cases.find((x) => x.slot === 0);
          if (!c) return null;
          return isNum(c.value) ? `npc:v:${c.value}` : `npc:${refId(asm, c.value)}`;
        },
      });
    } else if (derivesFromTml(asm, td, 'ModItem')) {
      const m = td.methods.find((x) => x.name === 'ModifyItemLoot' && asm.methodBody(x));
      if (!m) continue;
      const src = `bag:${modId}:${td.name}`;
      runLootMethod(asm, m, { tml, thisVal: THIS, args: [lootArg], emit, sourceOf: () => src });
      for (const t of contentRefs(asm, m)) emit({ source: src, item: refId(asm, t) });
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
