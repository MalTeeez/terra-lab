#!/usr/bin/env bun
/**
 * Terra Lab miner.
 *
 *   bun run mine                       every mod in enabled.json + vanilla
 *   bun run mine -- --only CalamityMod,ThoriumMod
 *   bun run mine -- --skip CalamityModMusic
 *   bun run mine -- --tmod path/to/X.tmod --tmod …
 *   bun run mine -- --tml "C:/…/tModLoader.dll" --out data/dataset.json
 *   bun run mine -- --list             show what would be mined and exit
 *
 * Reads each .tmod (its DLL and en-US localization) and tModLoader.dll, extracts
 * items / effects / recipes / drops / bosses / balancing overlays / prefixes, infers
 * gamestages and writes the dataset the site uses.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadAssembly } from './clr/metadata.js';
import { classOf, cleanText, parseTooltipStats, VANILLA_RARITY_NAMES } from './classify.js';
import { configHooks, loadModConfigs } from './config.js';
import { extractGlobalOverrides, extractModItemModifiers } from './extract/globals.js';
import { archetypeOf, extractItems } from './extract/items.js';
import { extractProjectiles } from './extract/projectiles.js';
import { evalLoadStatics, evalStatics } from './extract/interp.js';
import { loadLocalization } from './extract/localization.js';
import { extractModDrops } from './extract/loot.js';
import { extractBossLog, extractNpcs, vanillaNpcStats } from './extract/npcs.js';
import { extractModPrefixes, VANILLA_PREFIXES } from './extract/prefixes.js';
import { extractRecipes } from './extract/recipes.js';
import { applyRecipeEdit, extractRecipeEdits } from './extract/recipeedits.js';
import { extractRecipeGroups, vanillaRecipeGroups } from './extract/groups.js';
import { extractPackBuilder } from './extract/packbuilder.js';
import { extractTiles } from './extract/tiles.js';
import { extractShops, extractTravelShop, extractVanillaShops } from './extract/shops.js';
import { extractFlagEffects } from './extract/flageffects.js';
import { extractOnHitSpawns } from './extract/onhit.js';
import { extractSpawnPools, extractVanillaSpawns } from './extract/spawns.js';
import { extractModFishing, extractVanillaFishing, extractVanillaFishingEnemies } from './extract/fishing.js';
import { extractModWorldgen, extractVanillaChests } from './extract/worldgen.js';
import { extractVanilla, constMap } from './extract/vanilla.js';
import { extractDebuffs } from './extract/effects.js';
import { deCamel } from './extract/localization.js';
import { loadOrder } from './loadorder.js';
import { defaultPaths, readEnabled, resolveMods } from './resolve.js';
import { inferStages } from './stage/infer.js';
import { SEED_GROUPS } from './extract/flags.js';
import { readTmodFile } from './tmod.js';
import { wikiFile } from '../src/lib/wiki.js'; // the wiki table is shared so the icon hash cannot drift from the link

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const multi = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
const list = (name) => (opt(name, '') ? opt(name, '').split(',').map((s) => s.trim()).filter(Boolean) : []);

const paths = defaultPaths();
const tmlPath = opt('--tml', paths.tmlDll);
const outPath = resolve(opt('--out', 'data/dataset.json'));
const only = list('--only');
const skip = new Set(list('--skip'));

// ---- resolve mods -------------------------------------------------------------------
let modsIn = [];
const explicit = multi('--tmod');
const enabledList = readEnabled(paths.enabledJson);
if (explicit.length) {
  modsIn = explicit.map((p) => ({ name: p.replace(/\\/g, '/').split('/').pop().replace(/\.tmod$/, ''), path: p, source: 'explicit' }));
} else {
  const wanted = (only.length ? only : enabledList).filter((n) => !skip.has(n));
  const { resolved, missing } = resolveMods(wanted, paths);
  modsIn = resolved;
  if (missing.length) console.warn(`! could not find .tmod for: ${missing.join(', ')}`);
}
if (flag('--list')) {
  for (const m of modsIn) console.log(`${m.name.padEnd(36)} ${m.source.padEnd(9)} ${m.path}`);
  console.log(`tModLoader: ${tmlPath}`);
  process.exit(0);
}
if (!existsSync(tmlPath)) {
  console.error(`tModLoader.dll not found at ${tmlPath} (pass --tml)`);
  process.exit(1);
}

// ---- load ------------------------------------------------------------------------------
const t0 = Date.now();
const tml = loadAssembly(readFileSync(tmlPath));
console.log(`tModLoader.dll: ${tml.types.length} types`);
const config = JSON.parse(readFileSync(new URL('./stage/progression.json', import.meta.url), 'utf8'));
const configs = loadModConfigs(paths.saves);
const ammoIds = evalStatics(tml, tml.typeByName.get('Terraria.ID.AmmoID'), tml);
const enabledMods = new Set(enabledList.length ? enabledList : modsIn.map((m) => m.name));

const loaded = [];
const rows = [];
for (const m of modsIn) {
  try {
    const tmod = readTmodFile(m.path);
    const dllEntry = tmod.entries.get(`${tmod.name}.dll`);
    if (!dllEntry) { rows.push([tmod.name, tmod.version, '-', '-', '-', '-', '-', '-', '-', '-', 'no DLL']); continue; }
    const asm = loadAssembly(dllEntry.read());
    loaded.push({ name: tmod.name, tmod, asm, loc: loadLocalization(tmod) });
  } catch (e) {
    rows.push([m.name, '?', '-', '-', '-', '-', '-', '-', '-', '-', `ERROR ${e.message}`]);
    if (flag('--verbose')) console.error(e);
  }
}
const ordered = loadOrder(loaded);

// ---- extract ------------------------------------------------------------------------------
const allItems = [];
const allRecipes = [];
const allRecipeEdits = []; // PostAddRecipes passes that edit recipes other mods registered
const allPackItems = []; // tPackBuilder `.itemmod.json` stat changes — data, not code
// A mod's `BalancingConstants` static class: the numbers its own mechanics are built on, which the
// model would otherwise have to invent. Calamity's stealth strike lives here — the 0.42 damage
// factor, the 4-second stealth fill and the half-rate while moving.
const balance = {};
const packSkipped = new Map();
const vanillaItemIds = constMap(tml, 'Terraria.ID.ItemID');
const vanillaTileIds = constMap(tml, 'Terraria.ID.TileID');
const allDrops = [];
const allNpcs = [];
const allBossLogs = [];
const allOverrides = []; // in load order
const allPrefixes = [...VANILLA_PREFIXES];
const allProjectiles = [];
const allGroups = [];
const allTiles = [];
const allShops = [];
const allPools = [];      // GlobalNPC.EditSpawnPool entries
const allFish = [];       // fishing catches
const allWorldgen = [];   // chest contents placed at world generation
const worldgenTiles = new Set();
const groupFields = new Map(); // static field → recipe group name (RecipeGroupID.Wood, a mod's AnyGoldBar)
const vanillaGroups = flag('--no-vanilla') ? [] : vanillaRecipeGroups(tml, groupFields);
const debuffRefs = new Set(); // buffs the game marks as debuffs (`Main.debuff[x] = true`)
const flagEffects = new Map(); // modId → Map(flag → effects)
const modInfo = [];
const localizations = new Map();

for (const m of ordered) {
  const tm = Date.now();
  const { tmod, asm, loc } = m;
  const modId = tmod.name;
  localizations.set(modId, loc);
  try {
    const cfg = configHooks(asm, modId, configs);
    for (const td of asm.types) {
      if (td.name !== 'BalancingConstants' || process.env.TL_NO_BALANCE) continue;
      const vals = Object.fromEntries([...evalStatics(asm, td, tml)].filter(([, v]) => isNumber(v)));
      if (Object.keys(vals).length) balance[modId] = { ...(balance[modId] ?? {}), ...vals };
    }
    const items = extractItems(asm, { tml, loc, modId, ammoIds });
    const projectiles = extractProjectiles(asm, { tml, modId });
    allProjectiles.push(...projectiles);
    const npcs = extractNpcs(asm, { tml, loc, modId });
    const bossLogs = extractBossLog(asm, { tml, modId }).map((b) => ({ ...b, mod: modId }));
    const groups = extractRecipeGroups(asm, { tml, fields: groupFields });
    // ids another mod's content fills in at load time, so what is keyed on them can be read
    const statics = evalLoadStatics(asm, { tml, enabledMods });
    const recipes = extractRecipes(asm, { tml, modId, groupFields, enabledMods, statics });
    const tiles = extractTiles(asm, { tml, modId });
    // `from`: which mod registered the entry — it is the one whose code holds the condition
    const shops = extractShops(asm, { tml, modId, enabledMods, statics }).map((s) => ({ ...s, from: modId }));
    flagEffects.set(modId, extractFlagEffects(asm, { tml }));
    // projectiles a flag spawns on hit (Scuttler's Jewel's spike): stored on the flag's effects
    for (const [flag, spawns] of extractOnHitSpawns(asm, { tml })) {
      const fx = flagEffects.get(modId).get(flag) ?? {};
      fx.onHit = spawns;
      flagEffects.get(modId).set(flag, fx);
    }
    const drops = extractModDrops(asm, { tml, modId, enabledMods, statics });
    allPools.push(...extractSpawnPools(asm, { tml, modId }));
    allFish.push(...extractModFishing(asm, { tml, modId }));
    const wg = extractModWorldgen(asm, { modId });
    allWorldgen.push(...wg.items.map((w) => ({ ...w, estimated: w.locked || undefined })));
    for (const t of wg.tiles) worldgenTiles.add(t);
    const overrides = extractGlobalOverrides(asm, { tml, modId, enabledMods, cfg });
    const itemMods = extractModItemModifiers(asm, { tml, modId, enabledMods, cfg });
    const prefixes = extractModPrefixes(asm, { tml, loc, modId });
    allRecipeEdits.push(...extractRecipeEdits(asm, { tml, modId, enabledMods, cfg, groupFields }));
    // …and the changes this mod ships as tPackBuilder data rather than code
    const pack = extractPackBuilder(tmod, { modId, itemIds: vanillaItemIds, tileIds: vanillaTileIds });
    if (!process.env.TL_NO_PACK_RECIPES) allRecipeEdits.push(...pack.recipes);
    if (!process.env.TL_NO_PACK_ITEMS) allPackItems.push(...pack.items);
    for (const [k, v] of pack.skipped) packSkipped.set(k, (packSkipped.get(k) ?? 0) + v);
    allItems.push(...items);
    allNpcs.push(...npcs);
    allBossLogs.push(...bossLogs);
    allRecipes.push(...recipes);
    allDrops.push(...drops);
    allGroups.push(...groups);
    allTiles.push(...tiles);
    allShops.push(...shops);
    allOverrides.push(...overrides, ...itemMods);
    allPrefixes.push(...prefixes);
    const eq = items.filter((i) => ['weapon', 'head', 'body', 'legs', 'accessory'].includes(i.slot)).length;
    modInfo.push({ id: modId, name: loc.get(`Mods.${modId}.ModName`) ?? modId, version: tmod.version, items: items.length, equipment: eq, tml: tmod.tmlVersion });
    rows.push([modId, tmod.version, items.length, eq, npcs.length, bossLogs.filter((b) => b.kind === 'boss').length, recipes.length, drops.length, overrides.length + itemMods.length, prefixes.length, `${Date.now() - tm} ms`]);
  } catch (e) {
    rows.push([modId, tmod.version, '-', '-', '-', '-', '-', '-', '-', '-', `ERROR ${e.message}`]);
    if (flag('--verbose')) console.error(e);
  }
}

// vanilla
let vanilla = null;
if (!flag('--no-vanilla')) {
  const tv = Date.now();
  vanilla = extractVanilla(tml);
  allItems.push(...vanilla.items);
  allRecipes.push(...vanilla.recipes);
  allDrops.push(...vanilla.drops);
  allProjectiles.push(...vanilla.projectiles);
  allGroups.push(...vanillaGroups);
  allShops.push(...[...extractVanillaShops(tml), ...extractTravelShop(tml)].map((s) => ({ ...s, from: 'v' })));
  allFish.push(...extractVanillaFishing(tml));
  allPools.push(...extractVanillaFishingEnemies(tml));
  // chests placed by vanilla world generation; locked ones (dungeon, temple, biome chests) gate on the config
  for (const c of extractVanillaChests(tml)) {
    const after = config.worldgenGates?.[`${c.via}@${c.style}`] ?? config.worldgenGates?.[c.via];
    allWorldgen.push(compact({ item: c.item, via: `${c.via}${c.style !== undefined ? ` (style ${c.style})` : ''}`, cond: c.cond, after }));
  }
  const npcNames = new Map();
  for (const [name, id] of vanilla.ids.npc) if (typeof id === 'number' && id > 0 && !npcNames.has(id)) npcNames.set(id, name);
  for (const [id, internal] of npcNames) allNpcs.push({ id: `v:${id}`, mod: 'v', className: internal, name: vanilla.loc.get(`NPCName.${internal}`) ?? internal, boss: false });
  modInfo.unshift({ id: 'v', name: 'Terraria', version: tml.runtimeVersion, items: vanilla.items.length, equipment: vanilla.items.filter((i) => ['weapon', 'head', 'body', 'legs', 'accessory'].includes(i.slot)).length });
  rows.push(['(vanilla)', '', vanilla.items.length, modInfo[0].equipment, npcNames.size, '', vanilla.recipes.length, vanilla.drops.length, '', VANILLA_PREFIXES.length, `${Date.now() - tv} ms`]);
}

printTable(['mod', 'version', 'items', 'equip', 'npcs', 'bosses', 'recipes', 'drops', 'overlays', 'prefixes', 'time'], rows);

// ---- recipe edits ------------------------------------------------------------------------
// A balancing mod edits recipes another mod (or vanilla) registered, in load order.
{
  const byResult = new Map();
  for (const r of allRecipes) { if (!r.result) continue; let l = byResult.get(r.result); if (!l) byResult.set(r.result, (l = [])); l.push(r); }
  let applied = 0;
  let phantom = 0;
  const known = new Set(allItems.map((it) => it.id));
  for (const e of allRecipeEdits) {
    const list = byResult.get(e.result);
    if (!list) continue;
    // `thorium.Find<ModItem>("DragonTalonNecklace")` names an item this Thorium does not have — the
    // balancing mod is written against another version. An ingredient nothing in the pack defines
    // is a read that cannot be trusted, and adding it makes the whole recipe unstageable.
    if (e.item && !known.has(e.item)) { phantom++; continue; }
    for (const r of list) { applyRecipeEdit(r, e); applied++; }
  }
  const disabled = allRecipes.filter((r) => r.disabled).length;
  for (let i = allRecipes.length - 1; i >= 0; i--) if (allRecipes[i].disabled) allRecipes.splice(i, 1);
  console.log(`recipe edits: ${allRecipeEdits.length} records, ${applied} applications, ${disabled} recipes disabled, ${phantom} naming an item the pack does not have`);
}

// CloneDefaults: inherit what the item did not set itself (stats, class, rarity)
{
  const byIdAll = new Map(allItems.map((i) => [i.id, i]));
  for (const it of allItems) {
    if (!it.cloneOf) continue;
    const base = byIdAll.get(it.cloneOf);
    if (!base) continue;
    for (const k of ['damage', 'useTime', 'useAnimation', 'crit', 'knockback', 'mana', 'defense', 'rarity', 'rarityClass', 'value']) {
      if (it[k] === undefined && base[k] !== undefined) it[k] = base[k];
    }
    if (!it.damageClass && base.damageClass) it.damageClass = base.damageClass;
    if (it.slot === 'misc' && base.slot === 'weapon' && it.damage > 0) it.slot = 'weapon';
  }
}

// Projectiles: CloneDefaults / AIType inherit behaviour from the copied projectile
const projById = new Map(allProjectiles.map((p) => [p.id, p]));
// A weapon can put its real attack into play through a spawner — Catalyst's Congealed Duo-Whip
// shoots a `DuoWhipSpawner` that lashes with two whips of its own — so what a projectile hatches
// travels with it, for the archetype rules that ask.
const withKids = (p) => (p?.children?.length ? { ...p, kids: p.children.map((c) => projById.get(c.type)).filter(Boolean) } : p);
for (const p of allProjectiles) {
  const src = p.cloneOf ? projById.get(p.cloneOf) : p.aiType !== undefined ? projById.get(`v:${p.aiType}`) : null;
  if (!src) continue;
  for (const k of ['pen', 'tile', 'updates', 'ai', 'life', 'local', 'gravity', 'gravityK', 'drag', 'homing', 'held', 'still', 'explode', 'falloff', 'armorPen', 'walls', 'width', 'height', 'minion', 'sentry', 'slots']) if (p[k] === undefined && src[k] !== undefined) p[k] = src[k];
  if (p.cloneOf && !p.children && src.children) p.children = src.children;
}

// Tile damage travels up the projectile graph: one that spawns — or merely names — a projectile
// that takes the world apart is a weapon that takes the world apart, however rarely the branch it
// sits behind is taken. `mentions` is what the linear walk could not follow; it is dropped again
// once the flag has been carried, so nothing downstream can mistake it for a real child.
for (let pass = 0; pass < 4; pass++) {
  let changed = false;
  for (const p of allProjectiles) {
    if (p.digs) continue;
    const kids = [...(p.mentions ?? []), ...(p.children ?? []).map((c) => c.type)];
    if (kids.some((id) => projById.get(id)?.digs)) { p.digs = true; changed = true; }
  }
  if (!changed) break;
}

// Some mods implement IsArmorSet / UpdateArmorSet on the body or legs piece: move the set to the head
{
  const byIdAll = new Map(allItems.map((i) => [i.id, i]));
  for (const it of allItems) {
    if (it.slot === 'head' || !it.set?.length) continue;
    const members = [it, ...it.set.map((id) => byIdAll.get(id)).filter(Boolean)];
    const head = members.find((m) => m.slot === 'head');
    if (!head || head.set?.length) continue;
    head.set = members.filter((m) => m !== head).map((m) => m.id);
    if (!head.setEffects && it.setEffects) head.setEffects = it.setEffects;
    if (!head.setBonus && it.setBonus) head.setBonus = it.setBonus;
    it.set = [];
  }
}

// ModPlayer flag effects: what the mod's player code does when an item's flag is set
// (Calamity's Mollusk set slows the player in CalamityPlayer, not in the item) → fold into the item
{
  let applied = 0;
  const fold = (fx, it) => {
    const table = flagEffects.get(it.mod);
    if (!table) return fx;
    let out = fx;
    for (const flag of fx?.flags ?? []) {
      const extra = table.get(flag);
      if (!extra) continue;
      out = mergeEffects(out, extra);
      (out.via ??= []).push(flag);
      applied++;
    }
    // an aura projectile named after the item (SandCloak → SandCloakVeil): what it does to players
    // inside it is the item's effect, conditional on being inside
    for (const [key, extra] of table) {
      if (!key.startsWith(`aura:${it.className}`) || key.length === 5 + it.className.length) continue;
      out = mergeEffects(out, extra);
      (out.via ??= []).push(key.slice(5));
      applied++;
    }
    return out;
  };
  for (const it of allItems) {
    if (it.mod === 'v' || !it.className) continue;
    it.effects = fold(it.effects, it) ?? undefined;
    if (it.setEffects) it.setEffects = fold(it.setEffects, it);
    if (it.effects?.cond) { it.effectsCond = it.effects.cond; delete it.effects.cond; }
    if (it.setEffects?.cond) delete it.setEffects.cond;
    // what the spawned projectile does: hits per spawn come from its pierce, life and immunity frames
    for (const s of it.effects?.onHit ?? []) {
      const p = projById.get(s.type);
      s.name = s.type.split(':').pop().replace(/([a-z])([A-Z])/g, '$1 $2');
      if (!p) continue;
      if (p.pen !== undefined) s.pen = p.pen;
      if (p.local !== undefined) s.local = p.local;
      if (p.life !== undefined) s.life = p.life;
      const kids = (p.children ?? []).reduce((n, c) => n + (c.count ?? 1), 0);
      if (kids) s.kids = kids;
    }
  }
  console.log(`flag effects: ${[...flagEffects.values()].reduce((n, m) => n + m.size, 0)} player flags with effects, ${applied} folded into items`);
}

// ---- balancing overlays (load order) ------------------------------------------------------
const FIELD_MAP = { damage: 'damage', defense: 'defense', useTime: 'useTime', useAnimation: 'useAnimation', reuseDelay: 'reuseDelay', crit: 'crit', knockBack: 'knockback', mana: 'mana', rare: 'rarity', value: 'value', accessory: 'accessory', DamageType: 'damageClass' };
const conds = new Set();
{
  const byId = new Map(allItems.map((i) => [i.id, i]));
  const byClass = new Map();
  const byMod = new Map();
  for (const it of allItems) {
    (byClass.get(it.className) ?? byClass.set(it.className, []).get(it.className)).push(it);
    (byMod.get(it.mod) ?? byMod.set(it.mod, []).get(it.mod)).push(it);
  }
  const matchOne = (it, m) => {
    if (m.not) return !matchOne(it, m.not);
    if (m.id) return it.id === m.id;
    if (m.className) return it.className === m.className;
    if (m.classEndsWith) return (it.className ?? '').endsWith(m.classEndsWith);
    if (m.modName) return it.mod === m.modName;
    if (m.nsPrefix) return (it.fullName ?? '').startsWith(m.nsPrefix);
    if (m.typeName) return it.fullName === m.typeName;
    if (m.is) return it.fullName === m.is || m.is.split('.').pop() === it.className;
    if (m.cls) return classOf(it.damageClass) === classOf(m.cls);
    if (m.prop) return !!it[m.prop] === !!m.value;
    if (m.range) return it.mod === 'v' && it.typeId >= m.range[0] && it.typeId <= m.range[1];
    if (m.displayName) return it.name === m.displayName;
    return false;
  };
  const candidates = (group) => {
    const idM = group.find((m) => m.id);
    if (idM) { const it = byId.get(idM.id); return it ? [it] : []; }
    const clsM = group.find((m) => m.className);
    if (clsM) return byClass.get(clsM.className) ?? [];
    const modM = group.find((m) => m.modName);
    if (modM) return byMod.get(modM.modName) ?? [];
    if (group.some((m) => m.unknown)) return [];
    return allItems;
  };
  let applied = 0;
  for (const rec of allOverrides) {
    if (rec.matchers.some((m) => m.unknown)) continue;
    if (!rec.matchers.length) continue; // an unkeyed store would hit every item; that is never what a mod means
    const targets = candidates(rec.matchers).filter((it) => rec.matchers.every((m) => matchOne(it, m)));
    if (!targets.length) continue;
    for (const c of rec.cond) conds.add(c);
    for (const it of targets) {
      // alternative matcher groups of one store hit the same item at most once
      const originKey = `${rec.mod}|${rec.origin}`;
      if ((it.seenOrigins ??= new Set()).has(originKey)) continue;
      it.seenOrigins.add(originKey);
      const note = { mod: rec.mod, hook: rec.hook, cond: rec.cond.length ? rec.cond : undefined };
      if (rec.kind === 'set' || rec.kind === 'adjust') {
        const field = FIELD_MAP[rec.field];
        if (!field) continue;
        const from = it[field];
        let to;
        if (rec.kind === 'set') to = rec.value;
        else { if (!isNumber(from)) continue; to = from * (rec.mul ?? 1) + (rec.add ?? 0); if (field !== 'knockback') to = Math.round(to); }
        if (rec.conditional) { (it.maybe ??= []).push({ ...note, field, to }); continue; }
        if (rec.cond.length) { (it.variants ??= []).push({ ...note, field, to }); continue; }
        if (from === to) continue;
        (it.base ??= {})[field] ??= from;
        (it.changes ??= []).push({ ...note, field, from, to });
        it[field] = to;
        applied++;
      } else if (rec.kind === 'effect') {
        if (rec.conditional) { (it.maybe ??= []).push({ ...note, effects: rec.effects }); continue; }
        if (rec.cond.length) { (it.variants ??= []).push({ ...note, effects: rec.effects }); continue; }
        it.effects = mergeEffects(it.effects, rec.effects);
        (it.changes ??= []).push({ ...note, effects: rec.effects });
        applied++;
      } else if (rec.kind === 'damage' || rec.kind === 'crit' || rec.kind === 'useTime' || rec.kind === 'useSpeed') {
        const m = { ...note, kind: rec.kind === 'useSpeed' ? 'useTime' : rec.kind, add: rec.add, mul: rec.kind === 'useSpeed' && rec.mul ? 1 / rec.mul : rec.mul, flat: rec.flat, conditional: rec.conditional || undefined };
        (it.mods ??= []).push(m);
        applied++;
      }
    }
  }
  console.log(`balancing overlays: ${allOverrides.length} records, ${applied} applications, conditions seen: ${[...conds].join(', ') || 'none'}`);
}

// tPackBuilder item changes name their target outright, so they need none of the matcher machinery
// above — only the same `base` / `changes` bookkeeping, so the site can still say what was rebalanced.
{
  const byId = new Map(allItems.map((it) => [it.id, it]));
  let applied = 0;
  let missing = 0;
  for (const c of allPackItems) {
    const it = byId.get(c.id);
    if (!it) { missing++; continue; }
    const from = it[c.field];
    if (from === c.to) continue;
    (it.base ??= {})[c.field] ??= from;
    (it.changes ??= []).push({ mod: c.mod, hook: 'tPackBuilder', field: c.field, from, to: c.to });
    it[c.field] = c.to;
    applied++;
  }
  const skips = [...packSkipped].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ×${v}`);
  console.log(`tPackBuilder data: ${allPackItems.length} item changes (${applied} applied, ${missing} for items the pack does not have)${skips.length ? `, not read: ${skips.join(', ')}` : ''}`);
}

for (const ref of (process.env.TL_DEBUG_ITEM ?? '').split(',').filter(Boolean)) {
  const it = ref.startsWith('name:') ? allItems.find((i) => i.name === ref.slice(5)) : allItems.find((i) => i.id === ref);
  const id = it?.id ?? ref;
  console.log('item', id, it ? `${it.slot} rarity ${it.rarity} ${it.rarityClass ?? ''}` : 'NOT FOUND');
  console.log('item', JSON.stringify({ base: it?.base, changes: it?.changes, variants: it?.variants, maybe: it?.maybe, mods: it?.mods }, null, 1));
  console.log('drops for', id, allDrops.filter((d) => d.item === id).map((d) => `${d.source} (${allNpcs.find((n) => n.id === d.source.slice(4))?.name ?? '?'})${d.cond ? ' if ' + d.cond.join('&') : ''}`));
  console.log('recipes for', id, JSON.stringify(allRecipes.filter((r) => r.result === id)));
  if (it?.createTile) console.log('tile', it.createTile, JSON.stringify(allTiles.find((t) => t.id === it.createTile)));
  console.log('shops for', id, allShops.filter((s) => s.item === id).map((s) => `${s.npc} (${allNpcs.find((n) => n.id === s.npc)?.name ?? '?'} town gates ${allNpcs.find((n) => n.id === s.npc)?.townGates ?? '-'})${s.cond ? ' if ' + s.cond.join('&') : ''}`));
  if (it) console.log('effects', JSON.stringify(it.effects), 'set', JSON.stringify(it.setEffects));
  for (const n of allNpcs) if (allDrops.some((d) => d.item === id && d.source === `npc:${n.id}`)) console.log('npc', n.id, 'gates', n.gates, 'natural', n.natural, 'pools', JSON.stringify(allPools.filter((p) => p.npc === n.id).map((p) => p.gates)), 'town', n.townGates);
  console.log('fishing for', id, JSON.stringify(allFish.filter((f) => f.item === id)));
  console.log('worldgen for', id, JSON.stringify(allWorldgen.filter((w) => w.item === id)));
}

// ---- stages ------------------------------------------------------------------------------
{
  const manualPath = new URL('./stage/sources.json', import.meta.url);
  if (existsSync(manualPath)) { config.manual = JSON.parse(readFileSync(manualPath, 'utf8')); delete config.manual.$comment; }
}
// vanilla Zone* players fields / properties: a biome the config does not gate is reachable from the start
const vanillaZones = new Set();
{
  const pt = tml.typeByName.get('Terraria.Player');
  for (const f of pt?.fields ?? []) if (/^Zone[A-Z]/.test(f.name)) vanillaZones.add(f.name);
  for (const m of pt?.methods ?? []) if (/^get_Zone[A-Z]/.test(m.name)) vanillaZones.add(m.name.slice(4));
}
// `npc.ModNPC.Name == "TheGrandThunderBird"`: a mod's GlobalNPC keys another mod's boss by class
// name, which only resolves to an id once every mod has been read. A name nothing owns is dropped.
{
  const npcByClass = new Map(allNpcs.map((n) => [n.id.split(':').pop(), n.id]));
  const itemByClass = new Map(allItems.map((i) => [i.id.split(':').pop(), i.id]));
  let w = 0;
  for (const d of allDrops) {
    const m = /^(npc|bag):class:(.+)$/.exec(d.source);
    if (!m) { allDrops[w++] = d; continue; }
    const id = (m[1] === 'npc' ? npcByClass : itemByClass).get(m[2]);
    if (id) allDrops[w++] = { ...d, source: `${m[1]}:${id}` };
  }
  allDrops.length = w;
}
const stageArgs = {
  items: allItems,
  recipes: allRecipes,
  drops: allDrops,
  bossLogs: allBossLogs,
  npcs: allNpcs,
  groups: allGroups,
  tiles: allTiles,
  shops: allShops,
  spawns: vanilla ? extractVanillaSpawns(tml) : new Map(),
  pools: allPools,
  fish: allFish,
  worldgen: allWorldgen,
  worldgenTiles,
  vanillaZones,
  npcIds: vanilla?.ids.npc ?? new Map(),
  config,
  itemIds: vanilla?.ids.item ?? new Map(),
  tileIds: vanilla?.ids.tile ?? new Map(),
  mods: ordered.map((m) => m.name),
};
const stageResult = inferStages(stageArgs);

// Special world seeds: one more inference run per seed the gates mentioned, kept as the deltas the
// site applies when that seed is switched on (off by default — a normal world is the normal answer).
const seedStages = [];
for (const key of stageResult.seedsSeen) {
  const g = SEED_GROUPS.find((s) => s.key === key);
  const alt = inferStages({ ...stageArgs, seeds: new Set([key]) });
  const changed = {};
  for (const [id, s] of alt.byItem) {
    const base = stageResult.byItem.get(id);
    if (base && base.progression <= s.progression) continue;
    changed[id] = { stage: s.stage, prog: s.progression, src: s.source };
  }
  if (Object.keys(changed).length) seedStages.push({ key, label: g?.label ?? key, items: changed });
}
console.log(`world seeds: ${seedStages.map((s) => `${s.label} ${Object.keys(s.items).length} items`).join(', ') || 'none'}`);

for (const ref of (process.env.TL_DEBUG_ITEM ?? '').split(',').filter(Boolean)) {
  const it = ref.startsWith('name:') ? allItems.find((i) => i.name === ref.slice(5)) : allItems.find((i) => i.id === ref);
  if (it) console.log('stage', it.id, JSON.stringify(stageResult.byItem.get(it.id)));
}
if (stageResult.unresolvedFlags.length) console.log(`unresolved gates (evidence left unused; progression.json downedFlags / zones): ${stageResult.unresolvedFlags.slice(0, 25).map((u) => `${u.flag}×${u.count}`).join(', ')}`);

// ---- assemble dataset ----------------------------------------------------------------------
const EQUIP_SLOTS = new Set(['weapon', 'head', 'body', 'legs', 'accessory']);
const nameOf = new Map(allItems.map((i) => [i.id, i.name]));
const npcNameOf = new Map(allNpcs.map((n) => [n.id, n.name]));
const recipesByResult = new Map();
for (const r of allRecipes) { if (!r.result) continue; let l = recipesByResult.get(r.result); if (!l) recipesByResult.set(r.result, (l = [])); l.push(r); }
const dropSources = new Map();
for (const d of allDrops) { let l = dropSources.get(d.item); if (!l) dropSources.set(d.item, (l = [])); l.push(d); }
const shopSources = new Map();
for (const s of allShops) { let l = shopSources.get(s.item); if (!l) shopSources.set(s.item, (l = [])); l.push(compact({ kind: 'shop', from: npcNameOf.get(s.npc) ?? s.npc, cond: s.cond?.length ? s.cond.map((c) => c.replace(/^(any:)?(downed|Downed)/, '')).join(', ') : undefined })); }
/** A drop record as a labelled source for the dataset. */
function labelSource(d) {
  const [kind, ...rest] = d.source.split(':');
  const ref = rest.join(':');
  if (kind === 'npc') return compact({ kind: 'drop', from: npcNameOf.get(ref) ?? ref, cond: d.cond?.length ? d.cond.map((c) => c.replace(/^downed/i, '')).join(', ') : undefined });
  if (kind === 'bag') return compact({ kind: 'bag', from: nameOf.get(ref) ?? ref, cond: d.cond?.length ? d.cond.map((c) => c.replace(/^downed/i, '')).join(', ') : undefined });
  return null;
}
const condText = (cond) => (cond?.length ? cond.map((c) => c.replace(/^(any:)?(downed|Downed)/, '')).join(', ') : undefined);
const fishSources = new Map();
for (const f of allFish) { let l = fishSources.get(f.item); if (!l) fishSources.set(f.item, (l = [])); l.push(compact({ kind: 'fish', from: 'fishing', cond: condText(f.cond) })); }
const worldgenSources = new Map();
for (const w of allWorldgen) { let l = worldgenSources.get(w.item); if (!l) worldgenSources.set(w.item, (l = [])); l.push(compact({ kind: 'worldgen', from: w.via, cond: condText(w.cond) ?? (w.after ? `after ${w.after}` : undefined) })); }

const rarityName = (it) => it.rarityClass ? it.rarityClass.replace(/Rarity$/, '').replace(/([a-z])([A-Z])/g, '$1 $2') : VANILLA_RARITY_NAMES[String(it.rarity)] ?? (it.rarity !== undefined ? `Rarity ${it.rarity}` : '');

const knownDebuffs = JSON.parse(readFileSync(new URL('./stage/debuffs.json', import.meta.url), 'utf8'));
for (const b of extractDebuffs(tml)) debuffRefs.add(b);
for (const b of Object.keys(knownDebuffs)) if (b !== '$comment') debuffRefs.add(b);
const buffInternal = new Map([...constMap(tml, 'Terraria.ID.BuffID')].map(([n, v]) => [`v:${v}`, n]));
const buffName = (ref) => {
  const internal = buffInternal.get(ref);
  return (internal ? vanilla?.loc.get(`BuffName.${internal}`) ?? deCamel(internal) : null) ?? deCamel(ref);
};
/** Buffs an equip hook puts on the player: keep only the ones that are debuffs, by name. */
function foldSelfDebuffs(fx) {
  if (!fx?.selfBuffs) return fx ?? undefined;
  const bad = [...new Set(fx.selfBuffs.filter((b) => debuffRefs.has(b)).map(buffName))];
  delete fx.selfBuffs;
  if (bad.length) fx.selfDebuffs = bad;
  return Object.keys(fx).length ? fx : undefined;
}

const items = [];
for (const it of allItems) {
  if (!EQUIP_SLOTS.has(it.slot)) continue;
  if (it.slot !== 'weapon' && it.slot !== 'accessory' && !(it.defense > 0) && !it.setEffects && !it.effects) continue; // vanity armor
  if (it.slot === 'accessory' && it.createTile) continue; // music boxes
  const st = stageResult.byItem.get(it.id);
  const tooltip = cleanText(formatText(resolveRefs(it.tooltip, it.mod), it.tooltipArgs));
  const parsed = parseTooltipStats(tooltip); // the formatted text: `{0}` filled in is a real magnitude, not a guess
  const cls = it.slot === 'weapon' ? (classOf(it.damageClass) ?? 'other') : null;
  const sources = [...(dropSources.get(it.id) ?? []).map(labelSource).filter(Boolean), ...(shopSources.get(it.id) ?? []), ...(fishSources.get(it.id) ?? []), ...(worldgenSources.get(it.id) ?? [])];
  for (const r of (recipesByResult.get(it.id) ?? []).slice(0, 3)) {
    sources.push({ kind: 'craft', from: r.ingredients.map((g) => `${g.n > 1 ? g.n + '× ' : ''}${nameOf.get(g.item) ?? g.item ?? '?'}`).concat(r.groups.map((g) => `any ${g.replace(/^any/, '')}`)).join(', ') });
  }
  const name = resolveRefs(it.name, it.mod);
  items.push(compact({
    id: it.id,
    mod: it.mod,
    name,
    icon: iconHash(it.mod, name),
    className: it.mod === 'v' ? undefined : it.className,
    slot: it.slot,
    class: cls,
    dc: it.damageClass ?? undefined,
    damage: it.damage,
    useTime: it.useTime,
    useAnimation: it.useAnimation,
    reuseDelay: it.reuseDelay,
    crit: it.crit,
    knockback: it.knockback,
    mana: it.mana,
    shoot: it.shoot,
    shootSpeed: it.shootSpeed,
    useAmmo: it.useAmmo,
    channel: it.channel,
    autoReuse: it.autoReuse,
    noMelee: it.noMelee,
    useStyle: it.useStyle,
    useLimit: it.useLimit,
    maxOut: it.maxOut,
    armorPen: it.armorPen,
    scale: it.scale !== 1 ? it.scale : undefined,
    // every projectile the weapon spawns when it is used, the default shot first: what a weapon *is*
    // is decided by all of them, not just by the one `Item.shoot` names
    arch: it.slot === 'weapon'
      ? archetypeOf(it, [projById.get(it.shoot), ...(it.fire?.calls ?? []).map((c) => projById.get(c.type === 'shoot' ? it.shoot : c.type))].map(withKids), cls)
      : undefined,
    fire: it.slot === 'weapon' ? fireRecord(it.fire) : undefined,
    defense: it.defense,
    pick: it.pick,
    rarity: it.rarity,
    rarityName: rarityName(it),
    value: it.value,
    tooltip,
    setBonus: cleanText(formatText(resolveRefs(it.setBonus, it.mod), it.setBonusArgs)),
    set: it.set?.length ? it.set : undefined,
    effects: foldSelfDebuffs(it.effects),
    setEffects: foldSelfDebuffs(it.setEffects),
    stats: Object.keys(parsed.stats).length ? parsed.stats : undefined,
    placeholders: parsed.placeholders || undefined,
    condStats: condKeys(parsed, it),
    textClasses: parsed.classes.length ? parsed.classes : undefined,
    flags: parsed.flags.length ? parsed.flags : undefined,
    wings: it.wings || undefined,
    boots: it.boots || undefined,
    wingStats: it.wingStats,
    expert: it.expert || undefined,
    consumable: it.consumable || undefined,
    stage: st ? st.stage : null,
    prog: st ? st.progression : null,
    stageSource: st?.source ?? { kind: 'unknown' },
    sources: sources.length ? sources.slice(0, 6) : undefined,
    base: it.base,
    changes: it.changes,
    variants: it.variants,
    maybe: it.maybe?.length ? it.maybe.length : undefined,
    mods: it.mods,
  }));
}

// ammo: every item with an ammo kind and damage, with its own projectile and stage
const ammo = [];
for (const it of allItems) {
  if (!(it.ammo > 0) || !(it.damage >= 0)) continue;
  const st = stageResult.byItem.get(it.id);
  ammo.push(compact({ id: it.id, mod: it.mod, name: it.name, icon: iconHash(it.mod, it.name), kind: it.ammo, damage: it.damage, knockback: it.knockback, shoot: it.shoot, stage: st ? st.stage : null, stageSource: st?.source, consumable: it.consumable || undefined }));
}
// projectiles referenced by weapons and ammo (and their children), as a map
const projectiles = {};
{
  const want = [];
  for (const it of items) {
    if (it.shoot) want.push(it.shoot);
    for (const c of it.fire?.calls ?? []) if (c.type && c.type !== 'shoot') want.push(c.type);
    if (it.fire?.typeOverride) want.push(it.fire.typeOverride);
    if (it.fire?.stealthMods?.type) want.push(it.fire.stealthMods.type);
    for (const s of it.effects?.onHit ?? []) if (s.type) want.push(s.type);
  }
  for (const a of ammo) if (a.shoot) want.push(a.shoot);
  const seen = new Set();
  while (want.length) {
    const id = want.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    const p = projById.get(id);
    if (!p) continue;
    const { id: _id, cloneOf: _c, mentions: _m, ...rest } = p;
    projectiles[id] = rest;
    for (const ch of p.children ?? []) if (seen.size < 6000) want.push(ch.type);
  }
}

// the NPCs the stages name, as the target the DPS model scores against: size, defense, life and
// the debuffs that bounce off. A mod boss whose immunities live in a data table the interpreter
// cannot walk (Calamity's NPCDebuffImmunityData) is marked `immuneUnknown` — the model then assumes
// it shrugs everything off, which is both the pessimistic answer and the usual one.
const npcsOut = {};
{
  const vanillaStats = vanilla ? vanillaNpcStats(tml) : new Map();
  const modStats = new Map(allNpcs.map((n) => [n.id, n.stats]));
  for (const s of stageResult.stages) {
    for (const id of s.npcs ?? []) {
      if (npcsOut[id]) continue;
      const st = id.startsWith('v:') ? vanillaStats.get(id) : modStats.get(id);
      if (!st) continue;
      npcsOut[id] = compact({ ...st, name: npcNameOf.get(id), immuneUnknown: !id.startsWith('v:') && !st.immune ? true : undefined });
    }
  }
  console.log(`boss NPCs: ${Object.keys(npcsOut).length} of ${stageResult.stages.reduce((n, s) => n + (s.npcs?.length ?? 0), 0)} stage NPCs have stats (${vanillaStats.size} vanilla read)`);
}

// crafting trees: every item reachable from equipment through recipes, groups, stations and ore gates
const materials = {};
const recipesOut = {};
const stationsOut = {};
const groupsOut = {};
{
  const equipIds = new Set(items.map((i) => i.id));
  const want = [...equipIds];
  const seen = new Set();
  const pickaxeByName = new Map(allItems.filter((i) => i.pick > 0).map((i) => [i.name, i.id]));
  const materialRecord = (it) => {
    const st = stageResult.byItem.get(it.id);
    return compact({ name: it.name, icon: iconHash(it.mod, it.name), mod: it.mod, slot: EQUIP_SLOTS.has(it.slot) ? it.slot : undefined, rarity: it.rarity, pick: it.pick, stage: st ? st.stage : null, prog: st ? st.progression : null, src: st?.source ?? { kind: 'unknown' }, drops: [...(dropSources.get(it.id) ?? []).slice(0, 4).map(labelSource).filter(Boolean), ...(shopSources.get(it.id) ?? []).slice(0, 3), ...(fishSources.get(it.id) ?? []).slice(0, 2), ...(worldgenSources.get(it.id) ?? []).slice(0, 2)] });
  };
  const byIdAll = new Map(allItems.map((i) => [i.id, i]));
  while (want.length) {
    const id = want.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    const it = byIdAll.get(id);
    if (!it) continue;
    if (!equipIds.has(id)) materials[id] = materialRecord(it);
    const st = stageResult.byItem.get(id);
    if (st?.source?.pickaxe && pickaxeByName.has(st.source.pickaxe)) want.push(pickaxeByName.get(st.source.pickaxe));
    const list = recipesByResult.get(id) ?? [];
    if (list.length) {
      recipesOut[id] = list.map((r) => [r.ingredients.map((g) => [g.item, g.n]), r.groups, r.tiles]);
      for (const r of list) {
        for (const g of r.ingredients) if (g.item) want.push(g.item);
        for (const g of r.groups) { const members = stageResult.groups[g]; if (members) { groupsOut[g] = members; want.push(...members); } }
        for (const t of r.tiles) {
          const s = stageResult.stations.get(t);
          if (s && !stationsOut[t]) stationsOut[t] = compact({ name: s.name, stage: s.stage, boss: s.boss });
          for (const pid of allItems.filter((i) => i.createTile === t).slice(0, 2)) want.push(pid.id);
        }
      }
    }
  }
}

// seed overrides only make sense for records the site actually has
{
  const known = new Set([...items.map((i) => i.id), ...Object.keys(materials)]);
  for (const s of seedStages) for (const id of Object.keys(s.items)) if (!known.has(id)) delete s.items[id];
}

const dataset = {
  generatedAt: new Date().toISOString(),
  tml: tml.runtimeVersion,
  mods: modInfo,
  loadOrder: ordered.map((m) => m.name),
  stages: stageResult.stages.map((s) => ({ index: s.index, key: s.key, label: s.label, progression: s.progression, mod: s.mod, kind: s.kind, npcs: s.npcs })),
  classAliases: stageResult.classAliases,
  conditions: [...conds],
  prefixes: allPrefixes,
  balance,
  ammoKinds: Object.fromEntries([...ammoIds].filter(([, v]) => isNumber(v) && v > 0).map(([k, v]) => [v, k])),
  items,
  ammo,
  projectiles,
  npcs: npcsOut,
  debuffs: knownDebuffs,
  materials,
  recipes: recipesOut,
  groups: groupsOut,
  stations: stationsOut,
  /** flags that gate evidence but did not resolve (progression.json downedFlags / zones) */
  unresolved: stageResult.unresolvedFlags,
  /** special world seeds, as the stage overrides to apply when one is switched on (off by default) */
  seeds: seedStages,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(dataset));
const bySrc = {};
for (const it of items) bySrc[it.stageSource.kind] = (bySrc[it.stageSource.kind] ?? 0) + 1;
const changed = items.filter((i) => i.changes).length;
console.log(`\n${items.length} equipment items (${changed} rebalanced by other mods), ${dataset.stages.length} stages, ${allPrefixes.length} prefixes → ${outPath} (${(statSize(outPath) / 1024 / 1024).toFixed(1)} MB) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log(`stage evidence: ${Object.entries(bySrc).map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(`shops: ${allShops.length} entries from ${new Set(allShops.map((s) => s.npc)).size} sellers`);
console.log(`crafting: ${Object.keys(recipesOut).length} recipe results, ${Object.keys(materials).length} materials, ${Object.keys(groupsOut).length} groups, ${Object.keys(stationsOut).length} stations; ${allTiles.length} gating tiles, ${allItems.filter((i) => i.pick > 0).length} pickaxes`);
console.log(`projectiles: ${allProjectiles.length} mined, ${Object.keys(projectiles).length} referenced; ${ammo.length} ammo items; ${items.filter((i) => i.fire).length} weapons with shoot analysis`);

// ---- helpers --------------------------------------------------------------------------------
/**
 * MediaWiki's static file layout: /images/<h0>/<h0h1>/<File_name>.png, h = md5 of the file name.
 * Precomputed here so the site links the image directly — `Special:Redirect/file/` is a special
 * page and wiki.gg answers a page full of those with 429s.
 */
function iconHash(mod, name) {
  const file = wikiFile({ mod, name });
  if (!file) return undefined;
  const h = createHash('md5').update(`${file.replace(/ /g, '_')}.png`, 'utf8').digest('hex');
  return `${h[0]}/${h.slice(0, 2)}`;
}
function isNumber(v) { return typeof v === 'number' && Number.isFinite(v); }
/** Compact form of a weapon's Shoot analysis for the dataset. */
function fireRecord(f) {
  if (!f) return undefined;
  const r3 = (v) => (isNumber(v) ? Math.round(v * 1000) / 1000 : v ?? undefined);
  const calls = (f.calls ?? []).map((c) => compact({ type: c.type ?? 'shoot', count: c.count !== 1 ? c.count : undefined, dmgMul: c.dmgMul !== 1 ? r3(c.dmgMul) : undefined, velMul: c.velMul !== 1 ? r3(c.velMul) : undefined, abs: r3(c.abs), spread: c.spread ? r3(c.spread) : undefined, fan: c.fan, variant: c.variant !== 'both' ? c.variant : undefined, alt: c.alt, region: c.region }));
  const out = compact({
    calls: calls.length ? calls : undefined,
    defaultShot: f.defaultShot && (!f.defaultShot.spam || !f.defaultShot.stealth) ? f.defaultShot : undefined,
    velMul: f.velMul !== undefined && f.velMul !== 1 ? r3(f.velMul) : undefined,
    dmgMul: f.dmgMul !== undefined && f.dmgMul !== 1 ? r3(f.dmgMul) : undefined,
    typeOverride: f.typeOverride,
    stealthMods: f.stealthMods && Object.keys(f.stealthMods).length ? f.stealthMods : undefined,
    stealthMult: f.stealthMult !== undefined && f.stealthMult !== 1 ? r3(f.stealthMult) : undefined,
    stealth: f.stealthMult !== undefined || (f.calls ?? []).some((c) => c.variant !== 'both') || (f.defaultShot && f.defaultShot.spam !== f.defaultShot.stealth) ? true : undefined,
  });
  return Object.keys(out).length ? out : undefined;
}
function compact(obj) {
  for (const k of Object.keys(obj)) if (obj[k] === undefined || obj[k] === null || obj[k] === '') delete obj[k];
  return obj;
}
function statSize(p) {
  return readFileSync(p).length;
}
/** Stats the tooltip only mentions conditionally, plus what an aura projectile applies: the solver halves them. */
function condKeys(parsed, it) {
  const k = [...new Set([...(parsed.conditional ?? []), ...(it.effectsCond ?? [])])];
  return k.length ? k : undefined;
}
function mergeEffects(a, b) {
  if (!a) return structuredClone(b);
  const out = structuredClone(a);
  for (const [k, v] of Object.entries(b)) {
    if (k === 'flags') out.flags = [...new Set([...(out.flags ?? []), ...v])];
    else if (k === 'cond') out.cond = [...new Set([...(out.cond ?? []), ...v])];
    else if (k === 'onHit') out.onHit = [...(out.onHit ?? []), ...v];
    else if (k === 'via') out.via = [...new Set([...(out.via ?? []), ...v])];
    else if (k === 'selfBuffs') out.selfBuffs = [...new Set([...(out.selfBuffs ?? []), ...v])];
    else if (k === 'velocityDrag') out.velocityDrag = Math.round((out.velocityDrag ?? 1) * v * 10000) / 10000;
    else if (typeof v === 'object') { out[k] ??= {}; for (const [c, n] of Object.entries(v)) out[k][c] = Math.round(((out[k][c] ?? 0) + n) * 10000) / 10000; }
    else out[k] = Math.round(((out[k] ?? 0) + v) * 10000) / 10000;
  }
  return out;
}
/** `{$Mods.X.Key}` / `{$Common.Key}` references in tooltips → the referenced text. */
function resolveRefs(text, modId) {
  if (!text || !text.includes('{$')) return text ?? '';
  const loc = localizations.get(modId);
  return text.replace(/\{\$([^}@]+)(?:@(\d+))?\}/g, (m, key, at) => {
    const candidates = [key, `Mods.${modId}.${key}`];
    for (const c of candidates) {
      const v = loc?.get(c) ?? vanilla?.loc.get(c) ?? vanilla?.loc.get(c.replace(/^Mods\.[^.]+\./, ''));
      // `{$CommonItemTooltip.PercentIncreasedCritChance@1}`: the referenced text's {0} is this text's {1}
      if (v) return at ? v.replace(/\{0(:[^}]*)?\}/g, `{${at}$1}`) : v;
    }
    const tail = key.split('.').pop();
    return tail.replace(/([a-z])([A-Z])/g, '$1 $2');
  });
}
/** `{0}% increased damage` with the format arguments the item's code passes (unknown ones stay). */
function formatText(text, args) {
  if (!text || !text.includes('{')) return text ?? '';
  // `for {0} {^0:second;seconds}`: the arm argument 0 selects (singular only at exactly 1)
  text = text.replace(/\{\^(\d+):([^};]*);([^}]*)\}/g, (m, i, one, many) => (args?.[+i] == null ? m : Number(args[+i]) === 1 ? one : many));
  if (!args?.length) return text;
  return text.replace(/\{(\d+)(?::[^}]*)?\}/g, (m, i) => (args[+i] !== null && args[+i] !== undefined ? String(args[+i]) : m));
}
function printTable(head, body) {
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((r) => String(r[i] ?? '').length)));
  const line = (r) => r.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ');
  console.log(line(head));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of body) console.log(line(r));
}
