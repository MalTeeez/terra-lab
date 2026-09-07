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
import { T, loadAssembly } from './clr/metadata.js';
import { classOf, cleanText, parseTooltipStats, VANILLA_RARITY_NAMES } from './classify.js';
import { configHooks, loadModConfigs } from './config.js';
import { extractGlobalOverrides, extractModItemModifiers } from './extract/globals.js';
import { archetypeOf, extractItems } from './extract/items.js';
import { extractProjectiles } from './extract/projectiles.js';
import { evalLoadStatics, evalStatics } from './extract/interp.js';
import { loadLocalization } from './extract/localization.js';
import { extractDevArmor, extractModDrops } from './extract/loot.js';
import { extractQuestRewards } from './extract/quests.js';
import { extractIdRewards } from './extract/rewards.js';
import { extractCompanions } from './extract/companions.js';
import { extractBossLog, extractNpcs, vanillaNpcStats } from './extract/npcs.js';
import { extractModPrefixes, VANILLA_PREFIXES } from './extract/prefixes.js';
import { extractPairRecipes, extractRecipes, extractShimmerRecipes } from './extract/recipes.js';
import { applyRecipeEdit, extractRecipeEdits } from './extract/recipeedits.js';
import { extractRecipeGroups, vanillaRecipeGroups } from './extract/groups.js';
import { extractPackBuilder } from './extract/packbuilder.js';
import { extractTiles } from './extract/tiles.js';
import { extractShops, extractTravelShop, extractVanillaShops } from './extract/shops.js';
import { extractFlagEffects } from './extract/flageffects.js';
import { extractOnHitSpawns } from './extract/onhit.js';
import { extractSpawnPools, extractVanillaSpawns } from './extract/spawns.js';
import { extractAnglerRewards, extractModFishing, extractVanillaFishing, extractVanillaFishingEnemies } from './extract/fishing.js';
import { extractChestLocks, extractModWorldgen, extractVanillaChests } from './extract/worldgen.js';
import { extractVanilla, constMap } from './extract/vanilla.js';
import { VANILLA_BEHAVIOUR, applyAmmoSwaps } from './extract/vanilla-behaviour.js';
import { extractDebuffs, extractModBuffs } from './extract/effects.js';
import { deCamel } from './extract/localization.js';
import { loadOrder } from './loadorder.js';
import { defaultPaths, readEnabled, resolveMods } from './resolve.js';
import { inferStages } from './stage/infer.js';
import { SEED_GROUPS } from './extract/flags.js';
import { readTmodFile } from './tmod.js';
import { wikiFile } from '../src/lib/wiki.js'; // the wiki table is shared so the icon hash cannot drift from the link
import { summarize } from '../src/lib/dataset.js'; // the start page's card for this dataset, written beside it

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
const { tmlVersion, terrariaVersion } = versionsOf(tml);
console.log(`tModLoader.dll: ${tml.types.length} types, tModLoader ${tmlVersion} on Terraria ${terrariaVersion}`);
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
// tModLoader merges every mod's localization into one dictionary, so a mod shipping keys under
// *another* mod's namespace renames that mod's content — Ragnarok reads Thorium's throwing gear as
// rogue gear and ships `Mods.ThoriumMod.Items.ThrowingGuide.DisplayName` to say so. Later in the
// load order wins; fold the winners back into every mod's own table before anything reads a name.
const wikiNames = new Map(); // `<mod>:<the new name>` → the name that mod's own wiki still uses
{
  const winner = new Map();
  for (const m of ordered) for (const [k, v] of m.loc.keys) winner.set(k, v);
  let n = 0;
  for (const m of ordered) for (const k of m.loc.keys.keys()) {
    const own = m.loc.keys.get(k);
    const v = winner.get(k);
    if (v === own) continue;
    m.loc.keys.set(k, v);
    n++;
    if (k.endsWith('.DisplayName')) wikiNames.set(`${k.split('.')[1]}:${v}`, own);
  }
  console.log(`localization: ${n} keys another mod overrides (${wikiNames.size} renames, the rest reworded text)`);
}
// an addon's content class derives from the mod it extends, whose base class lives in that mod's
// assembly: let the base walk cross over into it
{
  const byName = new Map(loaded.map((m) => [m.asm.name, m.asm]));
  for (const m of loaded) m.asm.siblings = byName;
}

// ---- extract ------------------------------------------------------------------------------
const allItems = [];
const allRecipes = [];
const allRecipeEdits = []; // PostAddRecipes passes that edit recipes other mods registered
const disabledRecipes = new Map(); // result → the mod whose balancing pass switched its recipe off
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
const allGrants = [];     // items an id-keyed reward table hands over under a gate
const allCompanions = []; // vanity pieces that appear only while another item is equipped
const allWorldgen = [];   // chest contents placed at world generation
const allBuffs = [];      // every buff, with what it does to the player — a potion is worth its buff
const worldgenTiles = new Set();
const modWorldgen = [];   // mod chest placements, gated once every mod's chest locks are known
const chestLocks = new Map(); // locked chest tile → the flags that open it
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
    const items = extractItems(asm, { tml, loc, modId, ammoIds, cfg });
    const projectiles = extractProjectiles(asm, { tml, modId, loc });
    allProjectiles.push(...projectiles);
    const npcs = extractNpcs(asm, { tml, loc, modId });
    const bossLogs = extractBossLog(asm, { tml, modId }).map((b) => ({ ...b, mod: modId }));
    const groups = extractRecipeGroups(asm, { tml, fields: groupFields });
    // ids another mod's content fills in at load time, so what is keyed on them can be read
    const statics = evalLoadStatics(asm, { tml, enabledMods });
    const recipes = [...extractRecipes(asm, { tml, modId, groupFields, enabledMods, statics }), ...extractPairRecipes(asm, { modId, enabledMods }), ...extractShimmerRecipes(asm, { tml })];
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
    const drops = [...extractModDrops(asm, { tml, modId, enabledMods, statics }), ...extractQuestRewards(asm, { modId })];
    allGrants.push(...extractIdRewards(asm, { tml, modId }));
    allCompanions.push(...extractCompanions(asm, { modId }));
    allPools.push(...extractSpawnPools(asm, { tml, modId }));
    allFish.push(...extractModFishing(asm, { tml, modId }));
    const wg = extractModWorldgen(asm, { modId });
    modWorldgen.push(...wg.items);
    for (const [t, g] of extractChestLocks(asm, { modId })) chestLocks.set(t, g);
    for (const t of wg.tiles) worldgenTiles.add(t);
    const overrides = extractGlobalOverrides(asm, { tml, modId, loc, statics, enabledMods, cfg });
    const itemMods = extractModItemModifiers(asm, { tml, modId, statics, enabledMods, cfg });
    const prefixes = extractModPrefixes(asm, { tml, loc, modId });
    allRecipeEdits.push(...extractRecipeEdits(asm, { tml, modId, enabledMods, cfg, groupFields }));
    // …and the changes this mod ships as tPackBuilder data rather than code
    const pack = extractPackBuilder(tmod, { modId, itemIds: vanillaItemIds, tileIds: vanillaTileIds });
    if (!process.env.TL_NO_PACK_RECIPES) allRecipeEdits.push(...pack.recipes);
    if (!process.env.TL_NO_PACK_ITEMS) allPackItems.push(...pack.items);
    for (const [k, v] of pack.skipped) packSkipped.set(k, (packSkipped.get(k) ?? 0) + v);
    allItems.push(...items);
    allBuffs.push(...extractModBuffs(asm, { tml, loc, modId }));
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

// A chest placement is only as early as the chest opens, and the tile is often another mod's: the
// Serpentine Fork sits in Calamity's Abyss chest, which unlocks at Skeletron. Gate an item only when
// every chest the placing method touches is locked — otherwise it may be in the open one — and take
// several chests as alternatives. A lock whose key the code does not name keeps the rarity floor.
for (const w of modWorldgen) {
  const locks = (w.chests ?? []).map((t) => chestLocks.get(t));
  const flags = locks.length && locks.every(Boolean) ? locks.flat() : [];
  const gate = locks.length > 1 ? [...new Set(flags)].map((f) => (f.startsWith('any:') ? f : `any:${f}`)) : flags;
  const cond = [...(w.cond ?? []), ...gate];
  // no usable gate but a lock in sight: as before, the rarity guess stands as a floor (`estimated`)
  allWorldgen.push(compact({ ...w, chests: undefined, cond: cond.length ? cond : undefined, estimated: w.locked || (!gate.length && locks.some(Boolean)) || undefined }));
}

// vanilla
let vanilla = null;
if (!flag('--no-vanilla')) {
  const tv = Date.now();
  vanilla = extractVanilla(tml);
  applyAmmoSwaps(tml, vanilla.items);
  allItems.push(...vanilla.items);
  allBuffs.push(...vanilla.buffs);
  allRecipes.push(...vanilla.recipes);
  allRecipes.push(...extractShimmerRecipes(tml, { tml })); // vanilla's own Shimmer transmutations
  allDrops.push(...vanilla.drops);
  allProjectiles.push(...vanilla.projectiles);
  allGroups.push(...vanillaGroups);
  allShops.push(...[...extractVanillaShops(tml), ...extractTravelShop(tml)].map((s) => ({ ...s, from: 'v' })));
  allFish.push(...extractVanillaFishing(tml), ...extractAnglerRewards(tml));
  // developer sets: rolled when a hardmode treasure bag is opened, named by no drop rule
  allDrops.push(...extractDevArmor(tml, new Set(vanilla.items.filter((i) => /^Treasure Bag/.test(i.name ?? '')).map((i) => i.id))));
  allPools.push(...extractVanillaFishingEnemies(tml));
  // chests placed by vanilla world generation; locked ones (dungeon, temple, biome chests) gate on the config
  for (const c of extractVanillaChests(tml)) {
    const after = config.worldgenGates?.[`${c.via}@${c.style}`] ?? config.worldgenGates?.[c.via];
    allWorldgen.push(compact({ item: c.item, via: `${c.via}${c.style !== undefined ? ` (style ${c.style})` : ''}`, cond: c.cond, after, estimated: c.estimated }));
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
  for (const r of allRecipes) if (r.disabled) disabledRecipes.set(r.result, r.disabledBy ?? 'a balancing mod');
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
// What to call one. A mod projectile carries its class name in its id, but a vanilla one is only
// ever a number — the Crystal Serpent shoots `v:521` — so the name has to come from the game's own
// tables: the `ProjectileID` constant for the internal name, `ProjectileName.*` in the en-US
// strings for what the player calls it ("Crystal Charge"). Without it every card, part and phase
// graph naming a vanilla projectile printed the bare id.
const vanillaProjNames = new Map(); // vanilla id → ProjectileID constant
for (const [name, id] of vanilla?.ids.projectile ?? []) if (typeof id === 'number' && id > 0 && !vanillaProjNames.has(id)) vanillaProjNames.set(id, name);
const projNameOf = (ref) => {
  const raw = String(ref).split(':').pop();
  const internal = String(ref).startsWith('v:') ? vanillaProjNames.get(Number(raw)) : null;
  return (internal && vanilla?.loc.get(`ProjectileName.${internal}`)) || deCamel((internal ?? raw).replace(/Proj(ectile)?$/, ''));
};
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

// A potion is worth exactly what its buff does, so the buff's mined effects become the item's own —
// before the flag fold below, since most of a mod's buffs only set a flag its ModPlayer reads.
const buffById = new Map(allBuffs.map((b) => [b.id, b]));
for (const it of allItems) {
  if (it.slot !== 'potion' || it.effects) continue;
  const fx = buffById.get(it.buff)?.effects;
  if (fx) it.effects = structuredClone(fx);
}

// ModPlayer flag effects: what the mod's player code does when an item's flag is set
// (Calamity's Mollusk set slows the player in CalamityPlayer, not in the item) → fold into the item
{
  let applied = 0;
  const buffByName = new Map(allBuffs.map((b) => [b.id.split(':').pop(), b]));
  /**
   * One item's effects, expanded until nothing new comes out. Three things chain here and the
   * chain is the whole point: a flag's effects, a buff the item grants (worth what the buff does —
   * the same rule a potion gets), and the flag *that* buff sets. Calamity's Bloodflare melee set is
   * all three links — `bloodflareMelee` grants `BloodflareBloodFrenzy`, the buff sets
   * `bloodflareFrenzy`, and only that last flag carries the 25% melee damage and crit — so reading
   * one link deep left the set bonus with nothing but a flag name.
   *
   * Anything reached *through* a buff is conditional by construction: you only have it while the
   * buff is up, and the buff is granted on a hit, a kill or a cooldown.
   */
  const expand = (fx, it, cond) => {
    const table = flagEffects.get(it.mod);
    if (!table) return fx;
    let out = fx;
    const done = new Set();
    const gated = new Set(); // flags a buff introduced: their effects are the buff's, not the item's
    const mark = (extra) => { for (const k of Object.keys(extra)) if (k !== 'flags' && k !== 'via' && k !== 'cond') cond.push(k); };
    for (let round = 0; round < 3; round++) {
      let grew = false;
      for (const flag of [...(out?.flags ?? [])]) {
        if (done.has(flag)) continue;
        done.add(flag);
        const extra = table.get(flag);
        if (!extra) continue;
        out = mergeEffects(out, extra);
        (out.via ??= []).push(flag);
        if (gated.has(flag)) mark(extra);
        applied++;
        grew = true;
      }
      for (const name of [...(out?.selfBuffs ?? [])]) {
        if (done.has(name) || debuffRefs.has(name)) continue;
        done.add(name);
        const bfx = buffByName.get(name)?.effects;
        if (!bfx) continue;
        out = mergeEffects(out, bfx);
        (out.via ??= []).push(name);
        mark(bfx);
        for (const f of bfx.flags ?? []) gated.add(f);
        applied++;
        grew = true;
      }
      if (!grew) break;
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
    const cond = [];
    const setCond = [];
    it.effects = expand(it.effects, it, cond) ?? undefined;
    // the same for the set bonus, which is where a mod keeps the effects worth having
    if (it.setEffects) it.setEffects = expand(it.setEffects, it, setCond);
    if (it.effects?.cond) { cond.push(...it.effects.cond); delete it.effects.cond; }
    if (it.setEffects?.cond) { setCond.push(...it.setEffects.cond); delete it.setEffects.cond; }
    if (cond.length) it.effectsCond = [...new Set([...(it.effectsCond ?? []), ...cond])];
    if (setCond.length) it.setEffectsCond = [...new Set([...(it.setEffectsCond ?? []), ...setCond])];
  }

  // what the spawned projectile does: hits per spawn come from its pierce, life and immunity frames
  // (`spawns` is the permanent kind — a minion an accessory or set bonus keeps out — and reads the
  // same). Every item, vanilla included: Stardust's guardian comes out of `Player.UpdateArmorSets`.
  for (const it of allItems) {
    // …a *set bonus's* on-hit spawn too, which this pass used to walk past: the card said "spawns
    // undefined on every attack" and the proc was graded without its pierce, life or hit cooldown
    for (const s of [...(it.effects?.onHit ?? []), ...(it.effects?.spawns ?? []), ...(it.setEffects?.onHit ?? []), ...(it.setEffects?.spawns ?? [])]) {
      const p = projById.get(s.type);
      s.name = p?.name ?? projNameOf(s.type);
      if (!p) continue;
      if (p.pen !== undefined) s.pen = p.pen;
      if (p.local !== undefined) s.local = p.local;
      if (p.life !== undefined) s.life = p.life;
      const kids = (p.children ?? []).reduce((n, c) => n + (c.count ?? 1), 0);
      if (kids) s.kids = kids;
      // does it go to the enemy, or does it sit on the player? A permanent spawn is only a minion if
      // it seeks — the Marnite Repulsion Shield's hitbox is a body the boss has to walk into
      if (p.minion || p.homing) s.seeks = true;
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
    if (m.is) { const n = m.is.split('.').pop(); return it.fullName === m.is || n === it.className || !!it.ifaces?.includes(n); }
    if (m.cls) return classOf(it.damageClass) === classOf(m.cls);
    // `item.DamageType == DamageClass.Melee`: the same class object, not the same class of damage
    if (m.dcIs) return (it.damageClass ?? (it.slot === 'weapon' ? 'Default' : null)) === m.dcIs;
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
      } else if (rec.kind === 'copy') {
        // the item is handed another item's whole effect (a merged crafting tree): take what that
        // item has rather than re-reading the code that grants it
        const src = byId.get(rec.from);
        // two balancing mods shipping the same merge would otherwise grant the effect twice
        if (!src?.effects || (it.copied ??= new Set()).has(rec.from)) continue;
        it.copied.add(rec.from);
        const cp = { ...note, source: src.name, effects: src.effects };
        if (rec.conditional) { (it.maybe ??= []).push(cp); continue; }
        if (rec.cond.length) { (it.variants ??= []).push(cp); continue; }
        it.effects = mergeEffects(it.effects, src.effects);
        (it.changes ??= []).push(cp);
        applied++;
      } else if (rec.kind === 'tooltip') {
        const text = rec.text.trim();
        if (!text || (it.tooltipEdits ?? []).some((e) => e.text === text && e.mode === rec.mode)) continue;
        // both arms of an `if (mod loaded) … else …` get walked, so one item can collect two full
        // overrides; the fuller text is the one that says more, not whichever came last
        const prevAll = rec.mode === 'all' ? (it.tooltipEdits ?? []).find((e) => e.mode === 'all' && e.mod === rec.mod) : null;
        if (prevAll) { if (text.includes(prevAll.text)) prevAll.text = text; continue; }
        const edit = { mod: rec.mod, mode: rec.mode, find: rec.find, text };
        if (rec.conditional) { (it.maybe ??= []).push({ ...note, text }); continue; }
        if (rec.cond.length) { (it.variants ??= []).push({ ...note, text }); continue; }
        (it.tooltipEdits ??= []).push(edit);
        (it.changes ??= []).push({ ...note, mode: rec.mode, text });
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
  // TL_NO_MANUAL builds without the researched pins, to see what the extractors find on their own
  if (existsSync(manualPath) && !process.env.TL_NO_MANUAL) { config.manual = JSON.parse(readFileSync(manualPath, 'utf8')); delete config.manual.$comment; }
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
  const known = new Set([...allNpcs.map((n) => n.id), ...allItems.map((i) => i.id)]);
  for (const d of allDrops) {
    const m = /^(npc|bag):class:(.+)$/.exec(d.source);
    if (!m) {
      // …and a cross-mod class the extractor stamped with its own mod as well
      // (`npc:InfernalEclipseWeaponsDLC:ThoriumMod:TheGrandThunderBird`): the class name is the key
      const p = /^(npc|bag):(.+)$/.exec(d.source);
      if (p && !known.has(p[2]) && p[2].split(':').length > 2) {
        const id = (p[1] === 'npc' ? npcByClass : itemByClass).get(p[2].split(':').pop());
        if (id) { allDrops[w++] = { ...d, source: `${p[1]}:${id}` }; continue; }
      }
      allDrops[w++] = d;
      continue;
    }
    const id = (m[1] === 'npc' ? npcByClass : itemByClass).get(m[2]);
    if (id) allDrops[w++] = { ...d, source: `${m[1]}:${id}` };
  }
  allDrops.length = w;
}
const stageArgs = {
  items: allItems,
  recipes: allRecipes,
  disabledRecipes,
  drops: allDrops,
  bossLogs: allBossLogs,
  npcs: allNpcs,
  groups: allGroups,
  tiles: allTiles,
  shops: allShops,
  spawns: vanilla ? extractVanillaSpawns(tml) : new Map(),
  pools: allPools,
  fish: allFish,
  grants: allGrants,
  companions: allCompanions,
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
/** …and the consumables the dataset carries next to the gear: what you drink before the fight. */
const KEEP_SLOTS = new Set([...EQUIP_SLOTS, 'potion']);
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
  if (kind === 'npc') return compact({ kind: 'drop', from: npcNameOf.get(ref) ?? ref, cond: d.cond?.length ? d.cond.map((c) => c.replace(/^downed/i, '')).join(', ') : undefined, chance: d.chance });
  if (kind === 'bag') return compact({ kind: 'bag', from: nameOf.get(ref) ?? ref, cond: d.cond?.length ? d.cond.map((c) => c.replace(/^downed/i, '')).join(', ') : undefined, chance: d.chance });
  return null;
}
/** One row per distinct source: six NPC ids all called "Skeleton" are one line to the reader. */
const dedupeSources = (list) => [...new Map(list.map((s) => [JSON.stringify(s), s])).values()];
const condText = (cond) => (cond?.length ? cond.map((c) => c.replace(/^(any:)?(downed|Downed)/, '')).join(', ') : undefined);
const fishSources = new Map();
for (const f of allFish) { let l = fishSources.get(f.item); if (!l) fishSources.set(f.item, (l = [])); l.push(compact({ kind: 'fish', from: 'Fishing', cond: condText(f.cond) })); }
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

// Every item's own set bonus, formatted with its own arguments. An inherited arm quotes another
// item's bonus by key (`{$SilvaHeadMagic.SetBonusEffect}`) and the `{0}`s in it are *that* item's
// arguments, which nothing here can pass along — so the arm takes the text that item already
// resolved for itself, numbers and all, instead of leaving placeholders on the card.
const setTextByClass = new Map();
for (const it of allItems) {
  if (it.setBonus) setTextByClass.set(`${it.mod}:${it.className}`, cleanText(formatText(resolveRefs(it.setBonus, it.mod), it.setBonusArgs)));
}

const items = [];
for (const it of allItems) {
  if (!KEEP_SLOTS.has(it.slot)) continue;
  if (it.slot !== 'weapon' && it.slot !== 'accessory' && it.slot !== 'potion' && !(it.defense > 0) && !it.setEffects && !it.effects) continue; // vanity armor
  if (it.slot === 'accessory' && it.createTile) continue; // music boxes
  const st = stageResult.byItem.get(it.id);
  // A potion is worth what its buff does, and the item itself usually says nothing: the buff's own
  // description is part of its text (so the same tooltip parse reads it), and the effects mined off
  // the buff stand in for the equip effects a piece of gear would have.
  const buff = it.slot === 'potion' ? buffById.get(it.buff) : null;
  let own = cleanText(formatText(resolveRefs(it.tooltip, it.mod), it.tooltipArgs));
  const desc = buff?.desc ? cleanText(resolveRefs(buff.desc, it.mod)) : '';
  // …but not a description whose magnitudes never got filled in, where the item's own text already
  // says the same thing with numbers in it ("{0}% increased wing flight time")
  const keepDesc = desc && !own.includes(desc) && !(own && /\{\d+\}/.test(desc));
  // what another mod's ModifyTooltips did to the text, resolved against *that* mod's localization
  const added = [];
  for (const e of it.tooltipEdits ?? []) {
    const t = cleanText(resolveRefs(e.text, e.mod));
    if (!t) continue;
    if (e.mode === 'all') { own = t; added.length = 0; }
    // a substitution names the line by a fragment of it, and replaces that line whole
    else if (e.mode === 'sub') {
      const f = cleanText(resolveRefs(e.find, e.mod));
      if (f && own.split('\n').some((l) => l.includes(f))) {
        if (own.includes(f) && f.includes('\n')) own = own.split(f).join(t);
        else own = own.split('\n').map((l) => (l.includes(f) ? t : l)).join('\n');
      }
      // …and where the needle matches nothing, the new text used to be dropped with it — taking the
      // whole description of anything a balance mod rewrites. A mod usually needles the text *it*
      // wrote in an earlier version (the Wishing Star's own line reads "Temp1" in SOTS and the real
      // one comes from InfernalEclipseAPI), so the text is kept and the line it restates is taken
      // out instead: a replacement says the same thing with a different number, so that line is the
      // one with the same shape.
      else if (!own.includes(t)) {
        const shape = (l) => l.replace(/[\d.]+/g, '#').trim();
        const said = new Set(t.split('\n').map(shape));
        own = own.split('\n').filter((l) => !said.has(shape(l))).join('\n');
        added.push(t);
      }
    }
    else if (!own.includes(t)) added.push(t);
  }
  const printed = [keepDesc ? [own, desc].filter(Boolean).join('\n') : own, ...added].filter(Boolean).join('\n');
  // …and what a key press reveals, appended: it is text about the item the player cannot see
  // without holding a key, and the card has no key to hold (`armsOf`)
  // (a form's arm repeats the item's flavour line: say it once)
  const more = cleanText(resolveRefs(it.tooltipMore, it.mod)).split('\n').filter((l) => !printed.includes(l)).join('\n');
  const tooltip = [printed, more].filter(Boolean).join('\n');
  // "Effect does not stack with other Guides": the family the game lets you wear only one of, so
  // the solver cannot equip all three volumes at once. Only a *named* family counts — "does not
  // stack with downgrades" is every upgrade line in the pack and groups nothing.
  const noStack = /does not stack with (?:any )?other ([A-Z][\w']*)/.exec(tooltip)?.[1];
  const parsed = armsOf(parseTooltipStats(printed), more); // the formatted text: `{0}` filled in is a real magnitude, not a guess
  // a set bonus is a tooltip too: the same parse fills in what the set's code did not say
  // …and the arms of one the game hides behind a key press are appended to it, unformatted: the
  // item's format arguments belong to the line it prints, not to the bonuses it inherits.
  const setOwn = cleanText(formatText(resolveRefs(it.setBonus, it.mod), it.setBonusArgs));
  const setArms = resolveArms(it.setBonusMore, it.mod, setOwn);
  const setBonus = [setOwn, setArms].filter(Boolean).join('\n');
  const setParsed = armsOf(setOwn ? parseTooltipStats(setOwn) : {}, setArms);
  const cls = it.slot === 'weapon' ? (classOf(it.damageClass) ?? 'other') : null;
  const sources = dedupeSources([...(dropSources.get(it.id) ?? []).map(labelSource).filter(Boolean), ...(shopSources.get(it.id) ?? []), ...(fishSources.get(it.id) ?? []), ...(worldgenSources.get(it.id) ?? [])]);
  for (const r of (recipesByResult.get(it.id) ?? []).slice(0, 3)) {
    sources.push({ kind: 'craft', from: r.ingredients.map((g) => `${g.n > 1 ? g.n + '× ' : ''}${nameOf.get(g.item) ?? g.item ?? '?'}`).concat(r.groups.map((g) => `any ${g.replace(/^any/, '')}`)).join(', ') });
  }
  const name = resolveRefs(it.name, it.mod);
  const wikiName = wikiNames.get(`${it.mod}:${name}`);
  items.push(compact({
    id: it.id,
    mod: it.mod,
    name,
    icon: iconHash(it.mod, name, wikiName),
    // the wiki was written before the rename, so link and sprite still follow the old name
    wikiName,
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
    // SOTS void: the vanilla class the weapon is underneath (its gear bonuses stack with void's)
    // and what one use costs off the void bar
    subclass: it.subclass ? classOf(it.subclass) : undefined,
    voidCost: it.voidCost,
    // …and what the right click costs, where the weapon charges more for it
    altVoidCost: it.altVoidCost,
    // which vanilla reforge tables the weapon's own `*Prefix` hooks put it on
    prefixRolls: it.prefixRolls,
    // …and what one use costs off the health bar, for the weapons that are paid for in it
    lifeCost: it.lifeCost,
    // …and whether it is on Thorium's thrower exhaustion bar (`ThoriumItem.isThrowerNon`), which
    // is a third pool of the same shape: spend it faster than it comes back and the class stops
    exhaust: it.exhaust,
    // …and what one use costs off a bard's inspiration bar (`BardItem.InspirationCost`)
    inspiration: it.inspiration,
    shoot: it.shoot,
    ammoSwap: it.ammoSwap,
    shootSpeed: it.shootSpeed,
    useAmmo: it.useAmmo,
    channel: it.channel,
    autoReuse: it.autoReuse,
    noMelee: it.noMelee,
    useStyle: it.useStyle,
    useLimit: it.useLimit,
    maxOut: it.maxOut,
    cooldown: it.cooldown,
    altCooldown: it.altCooldown,
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
    setBonus,
    setStats: Object.keys(setParsed.stats ?? {}).length ? setParsed.stats : undefined,
    setCondStats: condKeys(setParsed, { effectsCond: it.setEffectsCond }),
    setFlags: setParsed.flags?.length ? setParsed.flags : undefined,
    setDebuffs: setParsed.debuffs?.length ? setParsed.debuffs : undefined,
    setPlaceholders: setParsed.placeholders || undefined,
    set: it.set?.length ? it.set : undefined,
    effects: foldSelfDebuffs(it.effects),
    setEffects: foldSelfDebuffs(it.setEffects),
    // the buff it grants and how long one of them lasts, in seconds. Two potions granting the same
    // buff are the same pick made twice, which is what the recommendation folds them together by.
    buff: it.slot === 'potion' ? it.buff : undefined,
    buffTime: it.buffTime ? Math.round(it.buffTime / 60) : undefined,
    stats: Object.keys(parsed.stats).length ? parsed.stats : undefined,
    noStack,
    placeholders: parsed.placeholders || undefined,
    condStats: condKeys(parsed, it),
    textClasses: parsed.classes.length ? parsed.classes : undefined,
    flags: parsed.flags.length ? parsed.flags : undefined,
    debuffs: parsed.debuffs?.length ? parsed.debuffs : undefined,
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
    if (it.ammoSwap?.to) want.push(it.ammoSwap.to);
    if (it.fire?.stealthMods?.type) want.push(it.fire.stealthMods.type);
    if (it.fire?.altMods?.type) want.push(it.fire.altMods.type); // the right click's own projectile
    for (const s of [...(it.effects?.onHit ?? []), ...(it.effects?.spawns ?? []), ...(it.setEffects?.spawns ?? [])]) if (s.type) want.push(s.type);
  }
  for (const a of ammo) if (a.shoot) want.push(a.shoot);
  const seen = new Set();
  while (want.length) {
    const id = want.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    const p = projById.get(id);
    // …and one nothing was mined for is still worth naming: a weapon that shoots it has to be able
    // to say what it shoots. 13 vanilla ids are in this position — the shortsword stabs, the
    // jousting lances — because the case walker never reached their `SetDefaults`. `unmined` says
    // the record is a name and nothing else, so nothing reads its absent fields as facts.
    if (!p) { projectiles[id] = { name: projNameOf(id), unmined: true }; continue; }
    const { id: _id, cloneOf: _c, mentions: _m, ...rest } = p;
    projectiles[id] = { name: projNameOf(id), ...rest };
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
      const name = npcNameOf.get(id);
      const mod = id.split(':')[0];
      npcsOut[id] = compact({ ...st, name, mod, icon: name ? iconHash(mod, name) : undefined, immuneUnknown: !id.startsWith('v:') && !st.immune ? true : undefined });
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
    return compact({ name: it.name, icon: iconHash(it.mod, it.name), mod: it.mod, slot: EQUIP_SLOTS.has(it.slot) ? it.slot : undefined, rarity: it.rarity, pick: it.pick, stage: st ? st.stage : null, prog: st ? st.progression : null, src: st?.source ?? { kind: 'unknown' }, drops: [...dedupeSources((dropSources.get(it.id) ?? []).map(labelSource).filter(Boolean)).slice(0, 4), ...dedupeSources(shopSources.get(it.id) ?? []).slice(0, 3), ...dedupeSources(fishSources.get(it.id) ?? []).slice(0, 2), ...dedupeSources(worldgenSources.get(it.id) ?? []).slice(0, 2)] });
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

// Sprites the `<name>.png` rule does not find: animated ones the wiki files as `.gif`, and bosses
// filed under a phase name. Looked up by tools/wiki-icons.mjs, keyed by `<mod>:<name>` because the
// sprite follows the name, not the id.
{
  const file = new URL('../data/wiki-icons.json', import.meta.url);
  const img = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  let n = 0;
  for (const r of [...items, ...ammo, ...Object.values(materials), ...Object.values(npcsOut)]) {
    const f = img[`${r.mod}:${r.name}`];
    if (f) { r.img = f; n++; }
  }
  console.log(`wiki sprites: ${n} of ${Object.keys(img).length} looked-up files matched (run tools/wiki-icons.mjs to refresh)`);
}

const dataset = {
  generatedAt: new Date().toISOString(),
  vanillaBehaviour: { game: VANILLA_BEHAVIOUR.game, source: VANILLA_BEHAVIOUR.source, projectiles: Object.keys(VANILLA_BEHAVIOUR.projectiles).length, ammoSwaps: Object.keys(VANILLA_BEHAVIOUR.ammoSwap).length },
  tml: tmlVersion,
  terraria: terrariaVersion,
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
// a few KB beside it, so the start page can describe this dataset without downloading all of it
writeFileSync(outPath.replace(/(\.json)?$/, '.summary.json'), JSON.stringify(summarize(dataset)));
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
 * What tModLoader.dll says it is. `BuildInfo.tMLVersion` is no help — it parses the assembly's own
 * informational version at runtime, which no static evaluation reaches — so read that string here
 * the same way it does:
 *
 *   1.4.4.9+2026.07.3.0|2026.07|stable|Stable|<sha>|<ticks>
 *   └ Terraria  └ tModLoader
 *
 * The Assembly table's version is the Terraria one again, so it stands in when the attribute is
 * missing (an unofficial build, a future rename); the tModLoader half has no fallback.
 */
function versionsOf(asm) {
  const row = asm.tables.count(T.Assembly) ? asm.tables.row(T.Assembly, 1) : null;
  const attr = asm.attributes((T.Assembly << 24) | 1).find((a) => a.name === 'AssemblyInformationalVersionAttribute');
  const [terraria, tail] = (attr ? String(asm.attributeArgs(attr).fixed[0] ?? '') : '').split('+');
  return {
    tmlVersion: tail?.split('|')[0] || null,
    terrariaVersion: terraria || (row ? `${row.major}.${row.minor}.${row.build}.${row.rev}` : null),
  };
}
/**
 * MediaWiki's static file layout: /images/<h0>/<h0h1>/<File_name>.png, h = md5 of the file name.
 * Precomputed here so the site links the image directly — `Special:Redirect/file/` is a special
 * page and wiki.gg answers a page full of those with 429s.
 */
function iconHash(mod, name, wikiName) {
  const file = wikiFile({ mod, name, wikiName });
  if (!file) return undefined;
  const h = createHash('md5').update(`${file.replace(/ /g, '_')}.png`, 'utf8').digest('hex');
  return `${h[0]}/${h.slice(0, 2)}`;
}
function isNumber(v) { return typeof v === 'number' && Number.isFinite(v); }
/** Compact form of a weapon's Shoot analysis for the dataset. */
function fireRecord(f) {
  if (!f) return undefined;
  const r3 = (v) => (isNumber(v) ? Math.round(v * 1000) / 1000 : v ?? undefined);
  // a call's damage: `dmgMul` omitted is ×1 of the argument, `dmgAbs` is a flat number, and
  // `dmg: 'unread'` says the machine could not follow it — the absence used to mean both
  const calls = (f.calls ?? []).map((c) => compact({ type: c.type ?? 'shoot', count: c.count !== 1 ? c.count : undefined, dmgMul: c.dmgMul !== undefined && c.dmgMul !== 1 ? r3(c.dmgMul) : undefined, dmgAbs: r3(c.dmgAbs), dmg: c.dmgMul === undefined && c.dmgAbs === undefined ? 'unread' : undefined, velMul: c.velMul !== 1 ? r3(c.velMul) : undefined, abs: r3(c.abs), spread: c.spread ? r3(c.spread) : undefined, fan: c.fan, variant: c.variant !== 'both' ? c.variant : undefined, alt: c.alt, chance: r3(c.chance), region: c.branch ? c.region : undefined, threshold: c.threshold, requires: c.requires, branch: c.branch }));
  const out = compact({
    calls: calls.length ? calls : undefined,
    defaultShot: f.defaultShot && (!f.defaultShot.spam || !f.defaultShot.stealth) ? f.defaultShot : undefined,
    velMul: f.velMul !== undefined && f.velMul !== 1 ? r3(f.velMul) : undefined,
    dmgMul: f.dmgMul !== undefined && f.dmgMul !== 1 ? r3(f.dmgMul) : undefined,
    // A `Shoot` whose only extra shot sits behind a *world seed* — Yharim's Crystal fires a Get
    // Fixed Boi prism and returns false, and returns true everywhere else — still fires the
    // weapon's own shot in an ordinary world. Without saying so the seed branch was the whole
    // weapon and a Yharon-tier magic weapon scored zero.
    returnsTrue: f.defaultShot?.spam && calls.length && calls.every((c) => c.requires?.what === 'world' && !c.requires.negated) ? true : undefined,
    typeOverride: f.typeOverride,
    // …and the swap that belongs to the right click alone, which `typeOverride` must not carry
    altMods: f.altMods && Object.keys(f.altMods).length ? f.altMods : undefined,
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
  // `selfBuff:SpiritPower` marks *which* buff was conditional; the stat keys it folded in are what
  // the solver discounts, and the marker itself is not one of them
  const k = [...new Set([...(parsed.conditional ?? []), ...(it.effectsCond ?? [])])].filter((x) => !x.includes(':'));
  return k.length ? k : undefined;
}
function mergeEffects(a, b) {
  if (!a) return structuredClone(b);
  const out = structuredClone(a);
  for (const [k, v] of Object.entries(b)) {
    if (k === 'flags') out.flags = [...new Set([...(out.flags ?? []), ...v])];
    else if (k === 'cond') out.cond = [...new Set([...(out.cond ?? []), ...v])];
    else if (k === 'onHit' || k === 'spawns') out[k] = [...(out[k] ?? []), ...v];
    else if (k === 'via') out.via = [...new Set([...(out.via ?? []), ...v])];
    else if (k === 'selfBuffs') out.selfBuffs = [...new Set([...(out.selfBuffs ?? []), ...v])];
    else if (k === 'velocityDrag') out.velocityDrag = Math.round((out.velocityDrag ?? 1) * v * 10000) / 10000;
    else if (typeof v === 'object') { out[k] ??= {}; for (const [c, n] of Object.entries(v)) out[k][c] = Math.round(((out[k][c] ?? 0) + n) * 10000) / 10000; }
    else out[k] = Math.round(((out[k] ?? 0) + v) * 10000) / 10000;
  }
  // (a merged zero stays: an overlay that cancels what the item had is a fact about the item, and
  // dropping it took Feral Claws' deliberate ±12% attack speed with it)
  return out;
}
/**
 * The arms a key press reveals, in words with numbers in them.
 *
 * An arm is a quotation: "Inherited Silva Set Bonus:" and then `{$SilvaHeadMagic.SetBonusEffect}`.
 * Its `{0}`s are the *quoted* item's format arguments, and the quoting item passes its own — which
 * is how "+{0} HP/s life regen" came out as the Auric helmet's 4 minion slots. So a reference to an
 * item this pack has is replaced by the set bonus **that item already resolved for itself**, which
 * is the same text the game shows when you wear it. Anything else falls back to the ordinary
 * reference resolution, placeholders and all.
 *
 * A line the quoting item already states is dropped, and *its* number is the one that counts: the
 * Auric summoner helmet grants 4 minion slots and quotes three sets that grant 2, 2 and 3, none of
 * which the wearer gets — so lines are compared with their magnitudes blanked out.
 */
function resolveArms(text, modId, printed = '') {
  if (!text) return '';
  const quoted = text.replace(/\{\$([^}@]+)(?:@\d+)?\}/g, (m, key) => {
    const cls = key.split('.').slice(-2)[0];
    return setTextByClass.get(`${modId}:${cls}`) ?? m;
  });
  const shape = (l) => l.replace(/[\d.]+/g, '#').trim();
  const said = new Set(printed.split('\n').map(shape));
  return cleanText(resolveRefs(quoted, modId)).split('\n').filter((l) => !said.has(shape(l))).join('\n');
}

/**
 * A parse of the text the item prints, plus what the arms a key press reveals *do*.
 *
 * What an arm does is readable ("taking fatal damage will revive you", a dash, a debuff); what it
 * is worth is not, because its `{0}`s are the arguments of the item it was inherited from and
 * nothing here fills them — Auric Tesla's arms are Tarragon's, Bloodflare's and Silva's own lines.
 * So only the abilities are taken. Reading magnitudes off placeholder fallbacks invents numbers,
 * and letting one unfilled `{0}` set the item's `placeholders` flag would halve every stat its own
 * line states exactly (which is what cost the Auric Tesla set its #1 rank until it was found).
 * An arm may also be one *form* of the item (SOTS's Dream Lamp), which is another reason its
 * numbers are not the ones in hand.
 */
function armsOf(parsed, arms) {
  if (!arms) return parsed;
  const extra = parseTooltipStats(arms);
  parsed.flags = [...new Set([...(parsed.flags ?? []), ...extra.flags])];
  parsed.debuffs = [...new Set([...(parsed.debuffs ?? []), ...(extra.debuffs ?? [])])];
  return parsed;
}
/** `{$Mods.X.Key}` / `{$Common.Key}` references in tooltips → the referenced text. */
function resolveRefs(text, modId, depth = 4) {
  if (!text || !text.includes('{$')) return text ?? '';
  const loc = localizations.get(modId);
  const out = text.replace(/\{\$([^}@]+)(?:@(\d+))?\}/g, (m, key, at) => {
    const candidates = [key, `Mods.${modId}.${key}`];
    for (const c of candidates) {
      // `find`, not `get`: a mod writes the reference relative to where it sits, so
      // `{$GodSlayerHeadMelee.SetBonusEffect}` is the key ending in that and nothing else was
      // resolving it — every Calamity post-Moon-Lord set bonus was the words "Set Bonus Effect"
      const v = loc?.find(c) ?? vanilla?.loc.get(c) ?? vanilla?.loc.get(c.replace(/^Mods\.[^.]+\./, ''));
      // `{$CommonItemTooltip.PercentIncreasedCritChance@1}`: the referenced text's arguments start
      // at 1 here, so *every* index shifts — shifting only `{0}` collided the God Slayer dash's
      // keybind and its cooldown onto the same argument ("Press  to … has a  second cooldown")
      if (v) return at ? v.replace(/\{(\d+)(:[^}]*)?\}/g, (_m, i, fmt) => `{${+i + +at}${fmt ?? ''}}`) : v;
    }
    // an add-on mod's set bonus quotes the mod it extends (`{$TarragonBreastplate.CommonSetBonus}`
    // from CalamityBardHealer), so the last resort is every other loaded mod's localization
    for (const other of localizations.values()) {
      if (other === loc) continue;
      const v = other.find(key);
      if (v) return at ? v.replace(/\{0(:[^}]*)?\}/g, `{${at}$1}`) : v;
    }
    const tail = key.split('.').pop();
    return tail.replace(/([a-z])([A-Z])/g, '$1 $2');
  });
  // a referenced text references others of its own — Calamity's set bonuses end on the chestplate's
  // `{$…CommonSetBonus}`, which is where Silva's revive and God Slayer's dash actually live. Bounded,
  // and stops as soon as a pass changes nothing, so a key that references itself cannot spin.
  return depth > 0 && out !== text && out.includes('{$') ? resolveRefs(out, modId, depth - 1) : out;
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
