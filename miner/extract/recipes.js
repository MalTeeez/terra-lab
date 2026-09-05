/**
 * Recipes from IL: `CreateRecipe`/`Recipe.Create` … `AddIngredient`/`AddRecipeGroup`/`AddTile` … `Register`.
 * Works for ModItem.AddRecipes, ModSystem.AddRecipes, centralised recipe classes and vanilla
 * `Recipe.SetupRecipes` alike, because it follows the fluent calls rather than method names.
 */
import { decodeIL } from '../clr/il.js';
import { Machine, THIS, UNKNOWN, isNum, tmlStaticHook, tmlStaticLoadHook } from './interp.js';
import { TYPE_ABSTRACT, callsMethodNamed, derivesFromTml, findInherited, refId } from './util.js';

const RECIPE_NAMES = new Set(['Register']);
const PAIR_RE = /Recipe|Transform|Conver|Exchange|Trade/i;

/**
 * @param {import('../clr/metadata.js').Assembly} asm
 * @param {{ tml?: import('../clr/metadata.js').Assembly, methods?: Iterable<object>, modId: string }} opts
 * @returns {Array<{ result: string, count: number, ingredients: Array<{ item: string, n: number }>, groups: string[], tiles: string[], method: string }>}
 */
export function extractRecipes(asm, { tml, methods, modId, groupFields = null, enabledMods = null, statics = null }) {
  const out = [];
  const candidates = methods ?? allRecipeMethods(asm);
  for (const entry of candidates) {
    const md = entry.md ?? entry;
    const td = entry.td ?? md.declaringType; // the item the recipe is for, which may inherit the method
    const selfId = derivesFromTml(asm, td, 'ModItem') && !(td.flags & TYPE_ABSTRACT) ? `${modId}:${td.name}` : null;
    const machine = new Machine(asm, {
      tml,
      enabledMods, // `ModLoader.TryGetMod("CalamityMod", out var cal)` → cal.Find<ModItem>("AerialiteBar")
      loadFields: statics,
      concreteType: td,
      linear: true,
      maxDepth: 3,
      budget: 400000,
      // `Recipe.Create(Item.type, 1)`: the same "a recipe for me" as `CreateRecipe()`, written
      // through the item rather than the ModItem (Ragnarok's armour is built this way)
      onLoad: (recv, name) => (recv?.k === 'selfitem' && name === 'type' && selfId ? { k: 'type', name: td.name, id: selfId } : undefined),
      onStaticLoad(f) {
        // `RecipeGroupID.Wood` / a mod's `RecipeSystem.AnyGoldBar`: the group id registered into that field
        const key = `${f.declaringType?.fullName ?? ''}::${f.name}`;
        const g = groupFields?.get(key);
        if (g) return { k: 'groupname', name: g };
        return statics?.get(key) ?? tmlStaticLoadHook(f);
      },
      onCall(callee, args, ctx) {
        const hooked = tmlStaticHook(callee, args, ctx);
        if (hooked !== undefined) return hooked;
        const decl = callee.declaringType?.fullName ?? callee.declaringType?.name ?? '';
        const name = callee.name;
        const recv = ctx.recv;
        // a static property getter for a stored group id (Thorium's ThoriumRecipes.AnyGoldBarGroup)
        if (/^get_/.test(name) && !callee.sig.hasThis && groupFields?.has(`${decl}::${name.slice(4)}`)) return { k: 'groupname', name: groupFields.get(`${decl}::${name.slice(4)}`) };
        // `ThoriumItem.GetDonatorRecipe(Type, 1)`: a mod helper the machine walks into creates the
        // recipe from the item's own `Type`, which is otherwise unknowable inside the helper
        if (name === 'get_Type' && recv === THIS && selfId) return { k: 'type', name: td.name, id: selfId };
        if (name === 'get_Item' && recv === THIS && selfId) return { k: 'selfitem' };
        if (name === 'CreateRecipe' && (recv === THIS || decl.endsWith('ModItem'))) {
          return { k: 'recipe', result: selfId, count: isNum(args[0]) ? args[0] : 1, ingredients: [], groups: [], tiles: [] };
        }
        if (decl === 'Terraria.Recipe' && name === 'Create' && !callee.sig.hasThis) {
          return { k: 'recipe', result: refId(asm, args[0]), count: isNum(args[1]) ? args[1] : 1, ingredients: [], groups: [], tiles: [] };
        }
        // RecipeGroup.recipeGroupIDs["Wood"] → the group's name (the machine has no dictionary contents)
        if (name === 'get_Item' && args.length === 1 && typeof args[0] === 'string' && /Dictionary/.test(decl)) return { k: 'groupname', name: args[0] };
        if (recv?.k === 'recipe') {
          const r = recv;
          if (name === 'AddIngredient') {
            if (callee.kind === 'methodSpec') r.ingredients.push({ item: refId(asm, callee.typeArgs[0]), n: isNum(args[0]) ? args[0] : 1 });
            else if ((isNum(args[0]) && args[0] > 0) || args[0]?.k === 'type') r.ingredients.push({ item: refId(asm, args[0]), n: isNum(args[1]) ? args[1] : 1 });
            else r.ingredients.push({ item: null, n: isNum(args[1]) ? args[1] : 1 });
          } else if (name === 'AddRecipeGroup') {
            r.groups.push(typeof args[0] === 'string' ? args[0] : args[0]?.k === 'groupname' ? args[0].name : isNum(args[0]) ? `group#${args[0]}` : '?');
          } else if (name === 'AddTile') {
            if (callee.kind === 'methodSpec') r.tiles.push(refId(asm, callee.typeArgs[0]));
            else if (isNum(args[0]) && args[0] >= 0) r.tiles.push(`v:tile:${args[0]}`); // numeric = vanilla TileID, not an item
            else if (args[0]?.k === 'type') r.tiles.push(refId(asm, args[0]));
          } else if (name === 'Register') {
            if (r.result) out.push({ ...r, k: undefined, method: `${td.fullName}::${md.name}` });
          } else if (name === 'ReplaceResult') {
            if (isNum(args[0]) || args[0]?.k === 'type') r.result = refId(asm, args[0]);
          }
          return r;
        }
        return undefined;
      },
    });
    try {
      machine.run(md, THIS, [], asm);
    } catch { /* keep going */ }
  }
  return out.map((r) => ({ result: r.result, count: r.count, ingredients: r.ingredients, groups: r.groups, tiles: r.tiles, method: r.method }));
}

/**
 * A mod's own one-in-one-out conversion table: `new WormholeRecipe(ItemType<Riptide>(),
 * ItemType<Atlantis>())` registered at load. It is a recipe in everything but name — SOTS's conduit
 * items are made this way and no `Recipe.Create` ever names them — so it is read as one: the first
 * item is what goes in, the second what comes out.
 * @returns {Array<{ result, count, ingredients, groups, tiles, method }>}
 */
export function extractPairRecipes(asm, { modId, enabledMods = null }) {
  const out = [];
  const isItem = (a) => a?.k === 'type' && a.fn === 'ItemType';
  /** …or Calamity's cross-mod hook for that same list: `cal.Call("MakeItemExhumable", from, to)`. */
  const callsExhume = (md) => {
    let ins;
    try { ins = decodeIL(asm.methodBody(md).il); } catch { return false; }
    return ins.some((x) => x.op === 'ldstr' && asm.userString(x.operand) === 'MakeItemExhumable');
  };
  /** cheap prefilter: does this body construct a two-argument type whose name says "recipe"? */
  const buildsPairs = (md) => {
    let ins;
    try { ins = decodeIL(asm.methodBody(md).il); } catch { return false; }
    for (const x of ins) {
      if (x.op !== 'newobj') continue;
      let d;
      try { d = asm.resolve(x.operand); } catch { continue; }
      if (d?.sig?.params.length === 2 && PAIR_RE.test(d.declaringType?.name ?? '')) return true;
    }
    return false;
  };
  /** …or a plain `Dictionary<int,int>` of item → item, which is what an upgrade table looks like. */
  const fillsMap = (md) => {
    let ins;
    try { ins = decodeIL(asm.methodBody(md).il); } catch { return false; }
    let types = 0;
    let sets = 0;
    for (const x of ins) {
      if (x.op !== 'call' && x.op !== 'callvirt') continue;
      let d;
      try { d = asm.resolve(x.operand); } catch { continue; }
      if (d?.name === 'ItemType' && d.declaringType?.fullName === 'Terraria.ModLoader.ModContent') types++;
      else if (/^(set_Item|Add|TryAdd)$/.test(d?.name ?? '')) sets++;
    }
    return types >= 4 && sets >= 2;
  };
  for (const td of asm.types) {
    for (const md of td.methods) {
      if (!asm.methodBody(md) || (!buildsPairs(md) && !fillsMap(md) && !callsExhume(md))) continue;
      const pairs = []; // map entries, kept only if this method fills a whole table
      const machine = new Machine(asm, {
        linear: true,
        maxDepth: 1,
        budget: 200_000,
        enabledMods,
        onStaticLoad: tmlStaticLoadHook,
        onCall(callee, args, ctx) {
          // an addon registers its own conversion with Calamity by name instead of by table
          if (callee.name === 'Call' && args[0]?.items?.[0] === 'MakeItemExhumable' && isItem(args[0].items[1]) && isItem(args[0].items[2])) {
            const from = refId(asm, args[0].items[1]);
            const result = refId(asm, args[0].items[2]);
            if (from && result && from !== result) out.push({ result, count: 1, ingredients: [{ item: from, n: 1 }], groups: [], tiles: [], soft: true, method: `${td.fullName}::${md.name}` });
            return undefined;
          }
          // `exhumeTable[ItemType<TheCommunity>()] = ItemType<ShatteredCommunity>()`: Calamity's
          // exhume list is a dictionary, and the key is what you put in
          if (/^(set_Item|Add|TryAdd)$/.test(callee.name) && args.length === 2 && isItem(args[0]) && isItem(args[1])) {
            const from = refId(asm, args[0]);
            const result = refId(asm, args[1]);
            // `soft`: the table says what turns into what, not what lets you do it — Calamity's
            // exhume list is only usable at Calamitas's enchantment UI, and nothing here says so
            if (from && result && from !== result) pairs.push({ result, count: 1, ingredients: [{ item: from, n: 1 }], groups: [], tiles: [], soft: true, method: `${td.fullName}::${md.name}` });
            return undefined;
          }
          return tmlStaticHook(callee, args, ctx);
        },
        onNew(callee, cargs) {
          if (!PAIR_RE.test(callee.declaringType?.name ?? '') || cargs.length !== 2 || !isItem(cargs[1])) return undefined;
          const result = refId(asm, cargs[1]);
          const method = `${td.fullName}::${md.name}`;
          if (!result) return undefined;
          if (isItem(cargs[0])) out.push({ result, count: 1, ingredients: [{ item: refId(asm, cargs[0]), n: 1 }], groups: [], tiles: [], method });
          else if (typeof cargs[0] === 'string') out.push({ result, count: 1, ingredients: [], groups: [cargs[0]], tiles: [], method });
          return undefined;
        },
      });
      try { machine.run(md, THIS, asm.methodSig(md).params.map(() => UNKNOWN), asm); } catch { /* keep going */ }
      if (pairs.length >= 2) out.push(...pairs); // one entry is a special case; a table is a mechanic
    }
  }
  return out;
}

/**
 * Shimmer transmutation: `ItemID.Sets.ShimmerTransformToItem[from] = to`, filled by vanilla's own
 * static constructor and by any mod that adds to it (Calamity turns the Rogue Emblem into a
 * Sorcerer Emblem, the Enchanted Sword into the Terragrim). Throwing a thing into Shimmer is a way
 * of making the other thing, so it is read as a recipe — no station, because the Aether is simply
 * in the world.
 * @returns {Array<{ result, count, ingredients, groups, tiles, method }>}
 */
export function extractShimmerRecipes(asm, { tml = null } = {}) {
  const SET = 'ShimmerTransformToItem';
  const out = [];
  const ref = (v) => (isNum(v) && v > 0 ? `v:${v}` : v?.k === 'type' && v.fn === 'ItemType' ? refId(asm, v) : null);
  for (const td of asm.types) {
    for (const md of td.methods) {
      const body = asm.methodBody(md);
      if (!body) continue;
      let ins;
      try { ins = decodeIL(body.il); } catch { continue; }
      if (!ins.some((x) => x.op === 'ldsfld' && safeName(asm, x) === SET)) continue;
      const set = { k: 'arr', tag: 'shimmer', items: [] };
      const machine = new Machine(asm, {
        tml,
        linear: true,
        maxDepth: 2,
        budget: 2_000_000,
        onStaticLoad: (f) => (f.name === SET ? set : tmlStaticLoadHook(f)),
        onCall: (callee, args, ctx) => tmlStaticHook(callee, args, ctx),
        onArrayStore(arr, idx, val) {
          if (arr.tag !== 'shimmer') return;
          const from = ref(idx);
          const result = ref(val);
          if (from && result && from !== result) out.push({ result, count: 1, ingredients: [{ item: from, n: 1 }], groups: [], tiles: [], method: `${td.fullName}::${md.name}` });
        },
      });
      try { machine.run(md, THIS, asm.methodSig(md).params.map(() => UNKNOWN), asm); } catch { /* keep going */ }
    }
  }
  return out;
}

const safeName = (asm, x) => { try { return asm.resolve(x.operand)?.name ?? null; } catch { return null; } };

/** Every method whose body calls something named `Register` (cheap prefilter). */
export function allRecipeMethods(asm) {
  const out = [];
  for (const td of asm.types) {
    let own = false;
    for (const md of td.methods) {
      if (md.name === 'AddRecipes') own = true;
      if (md.name === 'AddRecipes' || callsMethodNamed(asm, md, RECIPE_NAMES)) out.push({ md, td });
    }
    // an item whose recipe is written once on a base class and filled in by an override — Thorium's
    // gem rings are `PrimaryIngredientType` + the base's AddRecipes — is that base run as this item
    if (own || (td.flags & TYPE_ABSTRACT) || td.name.includes('`') || !derivesFromTml(asm, td, 'ModItem')) continue;
    const inherited = findInherited(asm, td, 'AddRecipes');
    if (inherited) out.push({ md: inherited, td });
  }
  return out;
}
