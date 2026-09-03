/**
 * Recipe groups: `RecipeGroup.RegisterGroup(name, new RecipeGroup(() => text, items…))`,
 * `group.ValidItems.Add(x)` and additions to existing groups through
 * `RecipeGroup.recipeGroups[RecipeGroup.recipeGroupIDs["Wood"]]`. Vanilla's groups live in
 * `Recipe.SetupRecipeGroups` (tModLoader.dll) and use the same API.
 */
import { Machine, THIS, UNKNOWN, isNum, tmlStaticHook, tmlStaticLoadHook } from './interp.js';
import { callsMethodNamed, refId } from './util.js';

const REGISTER = new Set(['RegisterGroup']);

/**
 * @param {import('../clr/metadata.js').Assembly} asm
 * @param {{ tml?: import('../clr/metadata.js').Assembly, methods?: Iterable<object> }} opts
 * @returns {Array<{ name: string, items: string[] }>}  additions to a name are separate records
 */
export function extractRecipeGroups(asm, { tml, methods, fields = null } = {}) {
  const out = [];
  const candidates = methods ?? allGroupMethods(asm);
  const itemRef = (v) => (isNum(v) && v > 0 ? `v:${v}` : v?.k === 'type' && v.fn === 'ItemType' ? refId(asm, v) : null);
  const itemsOf = (v) => {
    if (v?.k === 'arr') return v.items.map(itemRef).filter(Boolean);
    const one = itemRef(v);
    return one ? [one] : [];
  };
  for (const md of candidates) {
    const machine = new Machine(asm, {
      tml,
      concreteType: md.declaringType,
      linear: true,
      maxDepth: 2,
      budget: 400000,
      onLoad: () => undefined,
      onStaticLoad: tmlStaticLoadHook,
      // `RecipeGroupID.Wood = RegisterGroup("Wood", ...)` / a mod's `static int AnyGoldBar`: the field stands for the group
      onStaticStore(f, val) { if (val?.k === 'groupid' && fields) fields.set(`${f.declaringType?.fullName ?? ''}::${f.name}`, val.name); },
      onNew(callee, args) {
        const decl = callee.declaringType?.fullName ?? callee.declaringType?.name ?? '';
        if (/\bRecipeGroup$/.test(decl)) return { k: 'group', name: null, items: args.slice(1).flatMap(itemsOf) };
        return undefined;
      },
      onCall(callee, args, ctx) {
        const hooked = tmlStaticHook(callee, args, ctx);
        if (hooked !== undefined) return hooked;
        const name = callee.name;
        const recv = ctx.recv;
        if (name === 'RegisterGroup' && typeof args[0] === 'string' && args[1]?.k === 'group') {
          args[1].name = args[0];
          out.push({ name: args[0], items: [...new Set(args[1].items)] });
          args[1].items = [];
          return { k: 'groupid', name: args[0] };
        }
        // `AnyGoldBarGroup = RegisterGroup(...)` through a property setter: the field stands for the group
        if (/^set_/.test(name) && args[0]?.k === 'groupid' && fields) {
          const decl = callee.declaringType?.fullName ?? '';
          fields.set(`${decl}::${name.slice(4)}`, args[0].name);
          fields.set(`${decl}::<${name.slice(4)}>k__BackingField`, args[0].name);
          return UNKNOWN;
        }
        // recipeGroupIDs["Wood"] → the name; recipeGroups[name] → a live reference to that group
        if (name === 'get_Item' && args.length === 1) {
          if (typeof args[0] === 'string') return { k: 'groupname', name: args[0] };
          if (args[0]?.k === 'groupname') return { k: 'group', name: args[0].name, items: [], live: true };
        }
        if (recv?.k === 'group') {
          if (name === 'get_ValidItems') return recv;
          if (name === 'Add' || name === 'AddRange') {
            const add = args.flatMap(itemsOf);
            if (recv.live && add.length) out.push({ name: recv.name, items: add });
            else recv.items.push(...add);
            return UNKNOWN;
          }
          return recv;
        }
        return undefined;
      },
    });
    try { machine.run(md, THIS, [], asm); } catch { /* keep going */ }
  }
  return out;
}

/** Every method whose body calls `RegisterGroup` (cheap prefilter). */
export function allGroupMethods(asm) {
  const out = [];
  for (const td of asm.types) for (const md of td.methods) if (callsMethodNamed(asm, md, REGISTER)) out.push(md);
  return out;
}

/** Vanilla groups from `Recipe.SetupRecipeGroups`. */
export function vanillaRecipeGroups(tml, fields = null) {
  const td = tml.typeByName.get('Terraria.Recipe');
  const m = td?.methods.find((x) => x.name === 'SetupRecipeGroups' && tml.methodBody(x));
  if (!m) return [];
  return extractRecipeGroups(tml, { tml, methods: [m], fields });
}
