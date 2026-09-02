/**
 * Vanilla Terraria content, read from tModLoader.dll (the patched game assembly):
 *   items      Item.SetDefaults1..5 walked with the case tracker, names/tooltips from the
 *              embedded en-US localization resources, ids from ItemID constants
 *   effects    Player.GrantArmorBenefits / ApplyEquipFunctional (per item id) and
 *              Player.UpdateArmorSets (per head/body/legs triple)
 *   recipes    Recipe.SetupRecipes and its furniture helpers
 *   drops      ItemDropDatabase.Register*  (see loot.js)
 *   ids        ItemID / NPCID / TileID constant maps
 */
import Hjson from 'hjson';
import { classOf } from '../classify.js';
import { playerHooks, normalizeEffects } from './effects.js';
import { ITEM, Machine, PLAYER, UNKNOWN, isNum, tmlStaticHook, tmlStaticLoadHook } from './interp.js';
import { extractVanillaDrops } from './loot.js';
import { extractRecipes } from './recipes.js';
import { loopCount, projTypeArg, vanillaProjectiles } from './projectiles.js';
import { vectorHook } from './shoot.js';

const KEY0 = Object.freeze({ k: 'key', slot: 0 });

function jsonResource(tml, name) {
  const buf = tml.resource(name);
  if (!buf) return null;
  const text = buf.toString('utf8').replace(/^﻿/, '');
  try { return JSON.parse(text); } catch { return Hjson.parse(text); }
}

/** Merge every en-US localization resource into one flat key → text map. */
export function vanillaLocalization(tml) {
  const keys = new Map();
  for (const r of tml.resources) {
    if (!/^Terraria\.Localization\.Content\.en_US\..*\.json$/.test(r.name)) continue;
    const obj = jsonResource(tml, r.name);
    if (!obj) continue;
    for (const [cat, entries] of Object.entries(obj)) {
      if (!entries || typeof entries !== 'object') continue;
      for (const [k, v] of Object.entries(entries)) keys.set(`${cat}.${k}`, typeof v === 'string' ? v : String(v));
    }
  }
  return keys;
}

export function constMap(tml, typeName) {
  const td = tml.typeByName.get(typeName);
  return td ? tml.constants(td) : new Map();
}

/** Walk Item.SetDefaults1..5 and collect per-type field stores. */
export function vanillaItemDefaults(tml) {
  const itemTd = tml.typeByName.get('Terraria.Item');
  const byType = new Map();
  const rec = (type, name, value, conditional) => {
    let m = byType.get(type);
    if (!m) byType.set(type, (m = { fields: {} }));
    if (name === 'DamageType') { if (value?.k === 'dc') m.damageClass = value.name; return; }
    if ((name === 'melee' || name === 'ranged' || name === 'magic' || name === 'summon') && value === 1) { m.damageClass = name[0].toUpperCase() + name.slice(1); return; }
    // stores under a nested condition (seed variants, difficulty) never override the base value
    if (conditional && name in m.fields) return;
    m.fields[name] = value;
  };
  const machine = new Machine(tml, {
    tml,
    linear: true,
    maxDepth: 2,
    budget: 5_000_000,
    onLoad(recv, name) {
      if (recv === ITEM) return name === 'type' ? KEY0 : UNKNOWN;
      return undefined;
    },
    onStore(recv, name, value, ctx) {
      if (recv !== ITEM) return;
      for (const c of ctx.cases ?? []) if (c.slot === 0 && isNum(c.value)) rec(c.value, name, value, ctx.conditional);
    },
    onCall(callee, args, ctx) {
      const hooked = tmlStaticHook(callee, args, ctx);
      if (hooked !== undefined) return hooked;
      // Helpers on this item inside SetDefaults (DefaultToX): let them inline.
      return undefined;
    },
    onStaticLoad: tmlStaticLoadHook,
  });
  for (const m of itemTd.methods) {
    if (!/^SetDefaults\d$/.test(m.name)) continue;
    machine.run(m, ITEM, [KEY0]);
  }
  // `case 51: type = 52; goto case 52;` — 51 takes 52's defaults, then its own overrides.
  for (const { from, to } of machine.keyAliases) {
    const src = byType.get(to);
    if (!src) continue;
    for (const f of from) {
      const own = byType.get(f);
      byType.set(f, { fields: { ...src.fields, ...(own?.fields ?? {}) }, damageClass: own?.damageClass ?? src.damageClass });
    }
  }
  return byType;
}

/** Per-item and per-set effects from the Player equip code. */
export function vanillaEffects(tml) {
  const playerTd = tml.typeByName.get('Terraria.Player');
  const perItem = new Map(); // type → deltas[]
  const perSet = new Map(); // "h:b:l" → { deltas, bonusKey }
  const setKeys = new Map();
  const itemArg = { k: 'obj', name: 'itemArg', props: {} };

  const runKeyed = (methodName, args, target) => {
    const m = playerTd.methods.find((x) => x.name === methodName && tml.methodBody(x));
    if (!m) return;
    const hooks = playerHooks((d, ctx) => {
      const cases = ctx.cases ?? [];
      if (target === 'item') {
        for (const c of cases) if (c.slot === 0 && isNum(c.value)) push(perItem, c.value, d);
      } else {
        for (const key of setKeys3(ctx)) push(perSet, key, d);
      }
    });
    const machine = new Machine(tml, {
      tml,
      linear: true,
      maxDepth: 2,
      budget: 2_000_000,
      onLoad: hooks.onLoad,
      onStore(recv, name, value, ctx) {
        if (recv === PLAYER && name === 'setBonus' && target === 'set') {
          const text = value?.k === 'text' ? value.key : typeof value === 'string' ? value : null;
          if (text) for (const key of setKeys3(ctx)) setKeys.set(key, text);
          return;
        }
        hooks.onStore(recv, name, value, ctx);
      },
      onCall(callee, cargs, ctx) {
        if (callee.name === 'GetTextValue' && typeof cargs[0] === 'string') return { k: 'text', key: cargs[0] };
        if (callee.name === 'GetText' && typeof cargs[0] === 'string') return { k: 'text', key: cargs[0] };
        if (ctx.recv?.k === 'text' && (callee.name === 'Format' || callee.name === 'get_Value' || callee.name === 'FormatWith')) return ctx.recv;
        return hooks.onCall(callee, cargs, ctx);
      },
      onStaticLoad: hooks.onStaticLoad,
    });
    machine.run(m, PLAYER, args);
  };

  runKeyed('GrantArmorBenefits', [itemArg], 'item');
  runKeyed('ApplyEquipFunctional', [itemArg, 0], 'item');
  runKeyed('UpdateArmorSets', [0], 'set');

  const items = new Map();
  for (const [type, deltas] of perItem) items.set(type, normalizeEffects(deltas));
  const sets = new Map();
  for (const [key, deltas] of perSet) sets.set(key, { effects: normalizeEffects(deltas), bonusKey: setKeys.get(key) ?? null });
  for (const [key, text] of setKeys) if (!sets.has(key)) sets.set(key, { effects: null, bonusKey: text });
  return { items, sets };
}

function push(map, key, d) {
  let list = map.get(key);
  if (!list) map.set(key, (list = []));
  list.push(d);
}

/** "head:body:legs" (armor *slot* ids) for every complete key group in the context. */
function setKeys3(ctx) {
  const groups = ctx.caseGroups?.length ? ctx.caseGroups : [ctx.cases ?? []];
  const out = [];
  for (const g of groups) {
    const vals = [0, 1, 2].map((i) => {
      const c = g.find((k) => k.slot === i);
      if (!c) return null;
      if (isNum(c.value)) return [c.value];
      if (isNum(c.lo) && isNum(c.hi) && c.hi - c.lo <= 8 && c.hi >= c.lo) return Array.from({ length: c.hi - c.lo + 1 }, (_, j) => c.lo + j);
      return null;
    });
    if (vals.some((v) => !v)) continue;
    for (const h of vals[0]) for (const b of vals[1]) for (const l of vals[2]) out.push(`${h}:${b}:${l}`);
  }
  return [...new Set(out)];
}

/**
 * Vanilla recipes. `Recipe.SetupRecipes` still uses the legacy builder:
 *   Recipe.currentRecipe.createItem.SetDefaults(id); .stack = n;
 *   Recipe.currentRecipe.requiredItem[i].SetDefaults(id); .stack = n;
 *   Recipe.currentRecipe.requiredTile[i] = tile;  Recipe.currentRecipe.anyWood = true;
 *   Recipe.AddRecipe();
 * The furniture helpers use the fluent API, which `extractRecipes` handles.
 */
export function vanillaRecipes(tml) {
  const recipeTd = tml.typeByName.get('Terraria.Recipe');
  const fluent = recipeTd.methods.filter((m) => /^Add\w+Furniture|^AddAshWood|^CreateReverse/.test(m.name) && tml.methodBody(m));
  const out = extractRecipes(tml, { tml, methods: fluent, modId: 'v' });

  const setup = recipeTd.methods.find((m) => m.name === 'SetupRecipes' && tml.methodBody(m));
  if (!setup) return out;
  let cur = fresh();
  function fresh() {
    return { result: null, count: 1, ingredients: [], groups: [], tiles: [], method: 'Terraria.Recipe::SetupRecipes' };
  }
  const CUR = { k: 'obj', name: 'currentRecipe', props: {} };
  const CREATE = { k: 'obj', name: 'createItem', props: {} };
  const REQ = { k: 'obj', name: 'requiredItem', props: {} };
  const TILES = { k: 'obj', name: 'requiredTile', props: {} };
  const machine = new Machine(tml, {
    tml,
    linear: true,
    maxDepth: 1,
    budget: 3_000_000,
    onStaticLoad(f) {
      if (f.name === 'currentRecipe') return CUR;
      return tmlStaticLoadHook(f);
    },
    onLoad(recv, name) {
      if (recv === CUR) {
        if (name === 'createItem') return CREATE;
        if (name === 'requiredItem') return REQ;
        if (name === 'requiredTile') return TILES;
        return UNKNOWN;
      }
      if (recv?.k === 'obj' && recv.name === 'req') return UNKNOWN;
      return undefined;
    },
    onStore(recv, name, value) {
      if (recv === CREATE && name === 'stack' && isNum(value)) cur.count = value;
      else if (recv?.k === 'obj' && recv.name === 'req' && name === 'stack' && isNum(value)) {
        const ing = cur.ingredients[recv.idx];
        if (ing) ing.n = value;
      } else if (recv === CUR && value === 1 && /^any/.test(name)) cur.groups.push(name);
    },
    onCall(callee, args, ctx) {
      const hooked = tmlStaticHook(callee, args, ctx);
      if (hooked !== undefined) return hooked;
      const recv = ctx.recv;
      const name = callee.name;
      if (recv === REQ && name === 'get_Item' && isNum(args[0])) return { k: 'obj', name: 'req', idx: args[0], props: {} };
      if (recv === CREATE && name === 'SetDefaults' && isNum(args[0])) { cur.result = `v:${args[0]}`; return undefined; }
      if (recv?.k === 'obj' && recv.name === 'req' && name === 'SetDefaults' && isNum(args[0])) {
        cur.ingredients[recv.idx] = { item: `v:${args[0]}`, n: 1 };
        return undefined;
      }
      if (recv === TILES && name === 'set_Item' && isNum(args[1]) && args[1] >= 0) { cur.tiles.push(`v:tile:${args[1]}`); return undefined; }
      if (recv === TILES && name === 'Add' && isNum(args[0])) { cur.tiles.push(`v:tile:${args[0]}`); return undefined; }
      if (name === 'AddRecipe' && !callee.sig.hasThis) {
        if (cur.result) out.push({ ...cur, ingredients: cur.ingredients.filter(Boolean) });
        cur = fresh();
        return undefined;
      }
      if (recv === CUR || recv === CREATE || recv === REQ || recv === TILES) return UNKNOWN;
      return undefined;
    },
  });
  machine.run(setup, undefined, []);
  return out;
}

const num = (v) => (isNum(v) ? v : undefined);

/**
 * Everything vanilla the dataset needs.
 * @returns {{ items: object[], recipes: object[], drops: object[], ids: { item: Map, npc: Map, tile: Map }, loc: Map }}
 */
export function extractVanilla(tml) {
  const loc = vanillaLocalization(tml);
  const itemIds = constMap(tml, 'Terraria.ID.ItemID');
  const npcIds = constMap(tml, 'Terraria.ID.NPCID');
  const tileIds = constMap(tml, 'Terraria.ID.TileID');
  const defaults = vanillaItemDefaults(tml);
  const fx = vanillaEffects(tml);
  const shots = vanillaShoot(tml);

  const nameById = new Map();
  for (const [name, id] of itemIds) if (isNum(id) && id > 0 && !nameById.has(id)) nameById.set(id, name);

  const items = [];
  for (const [type, rec] of defaults) {
    if (type <= 0) continue;
    const f = rec.fields;
    const internal = nameById.get(type) ?? `Item${type}`;
    const name = loc.get(`ItemName.${internal}`) ?? internal;
    const tooltip = loc.get(`ItemTooltip.${internal}`) ?? '';
    const effects = fx.items.get(type) ?? null;
    let slot = 'misc';
    if (f.headSlot > 0 || f.headSlot === -1 && f.defense > 0) slot = 'head';
    else if (f.bodySlot > 0) slot = 'body';
    else if (f.legSlot > 0) slot = 'legs';
    else if (f.accessory === 1) slot = 'accessory';
    else if (f.createTile > 0 || f.createWall > 0 || f.createTile === -1 && f.consumable) slot = 'placeable';
    else if (f.ammo > 0) slot = 'misc';
    else if (f.damage > 0 && !(f.buffType > 0 && !f.useStyle)) slot = 'weapon';
    if (slot === 'head' && !(f.defense > 0) && !effects) slot = 'vanity';
    items.push({
      id: `v:${type}`,
      mod: 'v',
      className: internal,
      typeId: type,
      name,
      tooltip,
      setBonus: '',
      slot,
      equip: [],
      damageClass: rec.damageClass ?? null,
      damage: num(f.damage),
      defense: num(f.defense),
      useTime: num(f.useTime),
      useAnimation: num(f.useAnimation),
      reuseDelay: num(f.reuseDelay),
      crit: num(f.crit),
      knockback: num(f.knockBack),
      mana: num(f.mana),
      shoot: num(f.shoot) > 0 ? `v:${f.shoot}` : undefined,
      shootSpeed: num(f.shootSpeed),
      useAmmo: num(f.useAmmo) > 0 ? f.useAmmo : undefined,
      ammo: num(f.ammo) > 0 ? f.ammo : undefined,
      channel: f.channel === 1 || undefined,
      autoReuse: f.autoReuse === 1 || undefined,
      noMelee: f.noMelee === 1 || undefined,
      useStyle: num(f.useStyle),
      fire: VANILLA_MULTISHOT[internal] !== undefined ? { calls: [{ type: 'shoot', count: VANILLA_MULTISHOT[internal], dmgMul: 1, velMul: 1, abs: null, spread: VANILLA_MULTISHOT[internal] > 1 ? 0.2 : 0, variant: 'both' }], returnsTrue: false, defaultShot: { spam: false, stealth: false }, hasShoot: true } : shots.get(type),
      rarity: num(f.rare) ?? 0,
      value: num(f.value),
      accessory: f.accessory === 1,
      vanity: f.vanity === 1,
      expert: f.expert === 1,
      consumable: f.consumable === 1,
      wings: f.wingSlot > 0 || f.wingSlot === -1,
      createTile: isNum(f.createTile) && f.createTile >= 0 ? `v:tile:${f.createTile}` : undefined,
      set: [],
      effects,
    });
  }

  // Sets are keyed by armor slot ids (player.head/body/legs); map them back to items.
  const bySlot = { head: new Map(), body: new Map(), legs: new Map() };
  for (const [type, rec] of defaults) {
    const f = rec.fields;
    if (f.headSlot > 0 && !bySlot.head.has(f.headSlot)) bySlot.head.set(f.headSlot, type);
    if (f.bodySlot > 0 && !bySlot.body.has(f.bodySlot)) bySlot.body.set(f.bodySlot, type);
    if (f.legSlot > 0 && !bySlot.legs.has(f.legSlot)) bySlot.legs.set(f.legSlot, type);
  }
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const [key, s] of fx.sets) {
    const [hs, bs, ls] = key.split(':').map(Number);
    const h = bySlot.head.get(hs); const b = bySlot.body.get(bs); const l = bySlot.legs.get(ls);
    const head = h && byId.get(`v:${h}`);
    if (!head || !b || !l) continue;
    if (head.set.length) continue; // first complete mapping wins
    head.set = [`v:${b}`, `v:${l}`];
    if (s.effects) head.setEffects = s.effects;
    if (s.bonusKey) head.setBonus = loc.get(s.bonusKey) ?? loc.get(`ArmorSetBonus.${s.bonusKey.split('.').pop()}`) ?? s.bonusKey;
    if (head.slot === 'vanity') head.slot = 'head';
  }

  return {
    items,
    recipes: vanillaRecipes(tml),
    drops: extractVanillaDrops(tml),
    projectiles: vanillaProjectiles(tml),
    ids: { item: itemIds, npc: npcIds, tile: tileIds },
    loc,
  };
}

/**
 * Vanilla weapons whose multi-shot lives in code the case tracker cannot attribute (random
 * counts, ammo-driven spreads). Projectiles per use, by ItemID name.
 */
export const VANILLA_MULTISHOT = {
  Boomstick: 3.5, Shotgun: 4, TacticalShotgun: 5.5, QuadBarrelShotgun: 4, Xenopopper: 4.5, OnyxBlaster: 3,
  Phantasm: 4, Tsunami: 5, DD2BetsyBow: 4.5, DaedalusStormbow: 3, ChlorophyteShotbow: 2.5, DD2PhoenixBow: 1,
  SkyFracture: 3, LunarFlareBook: 3, LastPrism: 6, BubbleGun: 3, CrystalSerpent: 1, Razorpine: 1, VenomStaff: 5,
  PoisonStaff: 5, StarWrath: 3, Celeb2: 3, Celebration: 2, VortexBeater: 1, ElfMelter: 1, Flamethrower: 1,
  DemonScythe: 1, MagicDagger: 1, Flairon: 1, ThunderStaff: 1, StarCannon: 1, SuperStarCannon: 1,
};

/**
 * Per-item projectile spawns in `Player.ItemCheck_Shoot`, keyed on `sItem.type` with the case
 * tracker. Only spawns under an item-type condition are kept; the generic single shot is implied.
 * @returns {Map<number, { calls: Array, returnsTrue: boolean, hasShoot: boolean }>}
 */
export function vanillaShoot(tml) {
  const playerTd = tml.typeByName.get('Terraria.Player');
  const m = playerTd.methods.find((x) => x.name === 'ItemCheck_Shoot' && tml.methodBody(x));
  const out = new Map();
  if (!m) return out;
  const ITEM_ARG = { k: 'itemarg', slot: 0 };
  const VEC = { k: 'vec', mul: 1, spread: 0 };
  const calls = [];
  const loops = [];
  const machine = new Machine(tml, {
    tml,
    linear: true,
    maxDepth: 1,
    budget: 400000,
    onLoad(recv, name) {
      if (recv?.k === 'vec') return { k: 'adj', slot: 'vel', field: name, add: 0, mul: recv.mul };
      return undefined;
    },
    onCall(callee, args, ctx) {
      const hooked = tmlStaticHook(callee, args, ctx);
      if (hooked !== undefined) return hooked;
      const decl = callee.declaringType?.fullName ?? '';
      if (decl === 'Terraria.Projectile' && /^NewProjectile(Direct)?$/.test(callee.name)) {
        const keys = (ctx.caseGroups?.length ? ctx.caseGroups : [ctx.cases ?? []]).flatMap((g) => g.filter((c) => c.slot === 0 && isNum(c.value)).map((c) => c.value));
        if (keys.length) calls.push({ offset: ctx.offset, keys: [...new Set(keys)], type: projTypeArg(callee, args) });
        return UNKNOWN;
      }
      return vectorHook(callee, args, ctx);
    },
    onStaticLoad: tmlStaticLoadHook,
    onBackJump(x, a, b, op, ctx) { if (ctx.method === m) loops.push({ lo: x.operand, hi: x.offset, n: loopCount(a, b, op) }); },
  });
  machine.run(m, PLAYER, [UNKNOWN, ITEM_ARG, { k: 'adj', slot: 'dmg', field: 'damage', add: 0, mul: 1 }]);
  for (const c of calls) {
    const n = loops.filter((l) => c.offset >= l.lo && c.offset <= l.hi).reduce((p, l) => p * l.n, 1);
    const type = isNum(c.type) ? `v:${c.type}` : c.type?.k === 'prop' && c.type.path?.[0] === 'shoot' ? 'shoot' : null;
    if (n <= 1 && !type) continue; // the generic single shot, nothing learned
    for (const k of c.keys) {
      let rec = out.get(k);
      if (!rec) out.set(k, (rec = { calls: [], returnsTrue: false, defaultShot: { spam: false, stealth: false }, hasShoot: true }));
      rec.calls.push({ type: type ?? 'shoot', count: n, dmgMul: 1, velMul: 1, abs: null, spread: 0.05, variant: 'both' });
    }
  }
  void VEC;
  return out;
}

export { classOf };
