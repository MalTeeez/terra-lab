/**
 * Recipe edits: a balancing mod does not re-register a recipe, it walks `Main.recipe` in
 * `PostAddRecipes` and adjusts the ones already there —
 * `if (r.HasResult(ShoeIce)) { r.RemoveTile(Anvils); r.AddTile(TinkerersWorkbench); }`.
 *
 * Only edits guarded by exactly one resolvable `HasResult` are kept: an edit we cannot pin to a
 * result would otherwise hit every recipe in the game.
 */
import { Machine, THIS, UNKNOWN, isNum, tmlStaticHook, tmlStaticLoadHook } from './interp.js';
import { keysToMatchers } from './globals.js';
import { refId } from './util.js';

const EDIT_HOOKS = new Set(['PostAddRecipes', 'PostSetupRecipes']);

/**
 * @returns {Array<{ mod, result, kind: 'addTile'|'removeTile'|'addIngredient'|'removeIngredient'|'addGroup'|'disable',
 *                   tile?: string, item?: string, n?: number, group?: string, method: string }>}
 */
export function extractRecipeEdits(asm, { tml, modId, enabledMods, cfg, groupFields = null }) {
  const out = [];
  for (const td of asm.types) {
    for (const md of td.methods) {
      if (!EDIT_HOOKS.has(md.name) || !asm.methodBody(md)) continue;
      const method = `${td.fullName}::${md.name}`;
      const emit = (kind, extra, ctx) => {
        const groups = ctx.caseGroups?.length ? ctx.caseGroups : [ctx.cases ?? []];
        for (const g of groups) {
          const ids = keysToMatchers(asm, g).filter((m) => m.id).map((m) => m.id);
          if (process.env.TL_TRACE_EDITS) console.log('edit', kind, JSON.stringify(extra), 'at', ctx.offset, 'ids', JSON.stringify(ids), 'conditional', ctx.conditional, 'tags', JSON.stringify(ctx.condTags), 'in', method);
          if (ctx.conditional || ids.length !== 1) continue;
          out.push({ mod: modId, result: ids[0], kind, ...extra, method });
        }
      };
      const machine = new Machine(asm, {
        tml,
        concreteType: td,
        enabledMods,
        linear: true,
        maxDepth: 3,
        budget: 400000,
        onStaticLoad(f) {
          // `AddRecipeGroup(EvilSkinRecipeGroup, 6)` passes the group itself, parked in a static
          // field by whoever registered it — the same lookup `extractRecipes` does
          const g = groupFields?.get(`${f.declaringType?.fullName ?? ''}::${f.name}`);
          if (g) return { k: 'groupname', name: g };
          return cfg?.onStaticLoad(f) ?? tmlStaticLoadHook(f);
        },
        onLoad: (recv, name) => cfg?.onLoad(recv, name),
        onCall(callee, args, ctx) {
          const hooked = cfg?.onCall(callee, args, ctx) ?? tmlStaticHook(callee, args, ctx);
          if (hooked !== undefined) return hooked;
          // Every `Terraria.Recipe` instance call in one of these passes is about the recipe the
          // loop is on; the machine does not need to model `Main.recipe[i]` itself.
          if ((callee.declaringType?.fullName ?? '') !== 'Terraria.Recipe' || !callee.sig.hasThis) return undefined;
          const item = (v) => (isNum(v) && v > 0) || v?.k === 'type' ? refId(asm, v) : null;
          const tile = (v) => (isNum(v) && v >= 0 ? `v:tile:${v}` : v?.k === 'type' ? refId(asm, v) : null);
          const typeArg = callee.kind === 'methodSpec' ? refId(asm, callee.typeArgs[0]) : null;
          switch (callee.name) {
            // the guard: `HasResult(x)` reads as "this recipe's result is x" — a key the branch keys on
            case 'HasResult': {
              const id = typeArg ?? item(args[0]);
              return id ? { k: 'keycmp', slot: 0, value: id } : UNKNOWN;
            }
            case 'AddTile': { const t = typeArg ?? tile(args[0]); if (t) emit('addTile', { tile: t }, ctx); return UNKNOWN; }
            case 'RemoveTile': { const t = typeArg ?? tile(args[0]); if (t) emit('removeTile', { tile: t }, ctx); return UNKNOWN; }
            case 'AddIngredient': {
              const id = typeArg ?? item(args[0]);
              if (id) emit('addIngredient', { item: id, n: isNum(args[typeArg ? 0 : 1]) ? args[typeArg ? 0 : 1] : 1 }, ctx);
              return UNKNOWN;
            }
            case 'RemoveIngredient': { const id = typeArg ?? item(args[0]); if (id) emit('removeIngredient', { item: id }, ctx); return UNKNOWN; }
            case 'AddRecipeGroup': {
              const g = typeof args[0] === 'string' ? args[0] : args[0]?.k === 'groupname' ? args[0].name : null;
              if (g) emit('addGroup', { group: g, n: isNum(args[1]) ? args[1] : 1 }, ctx);
              return UNKNOWN;
            }
            case 'DisableRecipe': emit('disable', {}, ctx); return UNKNOWN;
            default: return UNKNOWN;
          }
        },
      });
      try { machine.run(md, THIS, []); } catch { /* keep going */ }
    }
  }
  return out;
}

/** Apply one edit to a recipe in place. */
export function applyRecipeEdit(r, e) {
  if (e.kind === 'addTile') { if (!r.tiles.includes(e.tile)) r.tiles.push(e.tile); }
  else if (e.kind === 'removeTile') r.tiles = r.tiles.filter((t) => t !== e.tile);
  else if (e.kind === 'addIngredient') { if (!r.ingredients.some((i) => i.item === e.item)) r.ingredients.push({ item: e.item, n: e.n ?? 1 }); }
  else if (e.kind === 'removeIngredient') r.ingredients = r.ingredients.filter((i) => i.item !== e.item);
  else if (e.kind === 'addGroup') { if (!r.groups.includes(e.group)) r.groups.push(e.group); }
  else if (e.kind === 'disable') { r.disabled = true; r.disabledBy = e.mod; }
}
