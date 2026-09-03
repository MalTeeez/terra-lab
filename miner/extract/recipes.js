/**
 * Recipes from IL: `CreateRecipe`/`Recipe.Create` … `AddIngredient`/`AddRecipeGroup`/`AddTile` … `Register`.
 * Works for ModItem.AddRecipes, ModSystem.AddRecipes, centralised recipe classes and vanilla
 * `Recipe.SetupRecipes` alike, because it follows the fluent calls rather than method names.
 */
import { Machine, THIS, UNKNOWN, isNum, tmlStaticHook, tmlStaticLoadHook } from './interp.js';
import { TYPE_ABSTRACT, callsMethodNamed, derivesFromTml, refId } from './util.js';

const RECIPE_NAMES = new Set(['Register']);

/**
 * @param {import('../clr/metadata.js').Assembly} asm
 * @param {{ tml?: import('../clr/metadata.js').Assembly, methods?: Iterable<object>, modId: string }} opts
 * @returns {Array<{ result: string, count: number, ingredients: Array<{ item: string, n: number }>, groups: string[], tiles: string[], method: string }>}
 */
export function extractRecipes(asm, { tml, methods, modId, groupFields = null }) {
  const out = [];
  const candidates = methods ?? allRecipeMethods(asm);
  for (const md of candidates) {
    const td = md.declaringType;
    const selfId = derivesFromTml(asm, td, 'ModItem') && !(td.flags & TYPE_ABSTRACT) ? `${modId}:${td.name}` : null;
    const machine = new Machine(asm, {
      tml,
      concreteType: td,
      linear: true,
      maxDepth: 3,
      budget: 400000,
      onLoad: () => undefined,
      onStaticLoad(f) {
        // `RecipeGroupID.Wood` / a mod's `RecipeSystem.AnyGoldBar`: the group id registered into that field
        const g = groupFields?.get(`${f.declaringType?.fullName ?? ''}::${f.name}`);
        if (g) return { k: 'groupname', name: g };
        return tmlStaticLoadHook(f);
      },
      onCall(callee, args, ctx) {
        const hooked = tmlStaticHook(callee, args, ctx);
        if (hooked !== undefined) return hooked;
        const decl = callee.declaringType?.fullName ?? callee.declaringType?.name ?? '';
        const name = callee.name;
        const recv = ctx.recv;
        // a static property getter for a stored group id (Thorium's ThoriumRecipes.AnyGoldBarGroup)
        if (/^get_/.test(name) && !callee.sig.hasThis && groupFields?.has(`${decl}::${name.slice(4)}`)) return { k: 'groupname', name: groupFields.get(`${decl}::${name.slice(4)}`) };
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

/** Every method whose body calls something named `Register` (cheap prefilter). */
export function allRecipeMethods(asm) {
  const out = [];
  for (const td of asm.types) {
    for (const md of td.methods) {
      if (md.name === 'AddRecipes' || callsMethodNamed(asm, md, RECIPE_NAMES)) out.push(md);
    }
  }
  return out;
}
