/**
 * tPackBuilder changes.
 *
 * A modpack built on tPackBuilder does not write C#: it ships `.itemmod.json` and `.recipemod.json`
 * files inside its own .tmod, and PackBuilder applies them at load. None of it appears in the IL,
 * so a miner that only reads code sees none of it — in this pack that is 668 item stat changes
 * (554 of them damage) and 125 recipe changes, most of Thorium's numbers among them.
 *
 * The files are declarative, so this is a reader rather than an interpreter. Anything whose `$type`
 * is not handled is counted and reported instead of being silently dropped.
 */

const CHANGE_FIELD = {
  Damage: 'damage', UseTime: 'useTime', UseAnimation: 'useAnimation', CritRate: 'crit',
  Defense: 'defense', ManaCost: 'mana', Knockback: 'knockback', ShootSpeed: 'shootSpeed',
  PickaxePower: 'pick', Scale: 'scale', Value: 'value', Rarity: 'rarity',
};
const shortType = (t) => String(t ?? '').split(',')[0].split('.').pop();

/**
 * `"ThoriumMod/PearlPike"` → `ThoriumMod:PearlPike`; `"Terraria/TissueSample"` → the vanilla id.
 * @param {Map<string, number>} vanillaIds  name → id, from `Terraria.ID.ItemID` / `TileID`
 */
const refOf = (name, vanillaIds, prefix = 'v:') => {
  if (typeof name !== 'string' || !name.includes('/')) return null;
  const [mod, cls] = name.split('/');
  if (mod !== 'Terraria') return `${mod}:${cls}`;
  const id = vanillaIds.get(cls);
  return id === undefined ? null : `${prefix}${id}`;
};

/**
 * @param {object} tmod                     the read .tmod (its `entries` map)
 * @param {string} modId
 * @param {Map<string, number>} itemIds     Terraria.ID.ItemID constants
 * @param {Map<string, number>} tileIds     Terraria.ID.TileID constants
 * @returns {{ items: Array, recipes: Array, skipped: Map<string, number> }}
 */
export function extractPackBuilder(tmod, { modId, itemIds, tileIds }) {
  const items = [];   // { mod, id, field, to, file }
  const recipes = []; // the same shape extractRecipeEdits emits
  const skipped = new Map();
  const skip = (t) => skipped.set(t, (skipped.get(t) ?? 0) + 1);
  const item = (n) => refOf(n, itemIds);
  const tile = (n) => refOf(n, tileIds, 'v:tile:');

  for (const [path, entry] of tmod.entries) {
    const kind = /\.itemmod\.json$/i.test(path) ? 'item' : /\.recipemod\.json$/i.test(path) ? 'recipe' : null;
    if (!kind) continue;
    let json;
    try { json = JSON.parse(entry.read().toString('utf8')); } catch { skip('unparsable file'); continue; }

    if (kind === 'item') {
      const ids = (json.Items ?? []).map(item).filter(Boolean);
      for (const c of json.Changes ?? []) {
        const t = shortType(c.$type);
        // `Criteria` gates a change on world state; without knowing which, applying it would be a guess
        if (t !== 'VanillaItemChange' || json.Criteria) { skip(json.Criteria ? 'Criteria-gated' : t); continue; }
        for (const [key, field] of Object.entries(CHANGE_FIELD)) {
          if (typeof c[key] === 'number') for (const id of ids) items.push({ mod: modId, id, field, to: c[key], file: path });
        }
        for (const key of Object.keys(c)) if (key !== '$type' && !(key in CHANGE_FIELD)) skip(`VanillaItemChange.${key}`);
      }
      continue;
    }

    // A recipe change applies to whatever its conditions select. Only `CreatesResult` pins it to one
    // recipe; the ingredient/tile conditions narrow a set the miner cannot enumerate, so a change
    // carrying one of those on its own would hit every recipe in the game — the same rule the IL
    // reader follows with `HasResult`.
    const results = [];
    let narrowed = false;
    for (const c of json.Conditions ?? []) {
      const t = shortType(c.$type);
      if (t === 'CreatesResult') { const id = item(c.Item); if (id) results.push(id); else skip('CreatesResult (unknown item)'); }
      else { narrowed = true; skip(t); }
    }
    if (results.length !== 1) { skip(results.length ? 'several results' : 'no CreatesResult'); continue; }
    if (narrowed) continue; // a condition we could not read would make this edit wider than it is
    const result = results[0];
    for (const c of json.Changes ?? []) {
      const t = shortType(c.$type);
      const add = (e) => recipes.push({ mod: modId, result, method: path, ...e });
      if (t === 'AddIngredient') { const id = item(c.Item); if (id) add({ kind: 'addIngredient', item: id, n: c.Count ?? 1 }); else skip('AddIngredient (unknown item)'); }
      else if (t === 'RemoveIngredient') { const id = item(c.Item); if (id) add({ kind: 'removeIngredient', item: id }); else skip('RemoveIngredient (unknown item)'); }
      else if (t === 'ChangeIngredient') {
        const from = item(c.Item); const to = item(c.NewItem);
        if (from && to) { add({ kind: 'removeIngredient', item: from }); add({ kind: 'addIngredient', item: to, n: c.NewCount ?? 1 }); } else skip('ChangeIngredient (unknown item)');
      } else if (t === 'ChangeTile') {
        const from = tile(c.Tile); const to = tile(c.NewTile);
        if (from && to) { add({ kind: 'removeTile', tile: from }); add({ kind: 'addTile', tile: to }); } else skip('ChangeTile (unknown tile)');
      } else if (t === 'RemoveTile') { const tl = tile(c.Tile); if (tl) add({ kind: 'removeTile', tile: tl }); else skip('RemoveTile (unknown tile)'); }
      else if (t === 'AddTile') { const tl = tile(c.Tile); if (tl) add({ kind: 'addTile', tile: tl }); else skip('AddTile (unknown tile)'); }
      else if (t === 'DisableRecipe') { if (c.Disabled !== false) add({ kind: 'disable' }); }
      else skip(t);
    }
  }
  return { items, recipes, skipped };
}
