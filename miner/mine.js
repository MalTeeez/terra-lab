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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadAssembly } from './clr/metadata.js';
import { classOf, cleanText, parseTooltipStats, VANILLA_RARITY_NAMES } from './classify.js';
import { configHooks, loadModConfigs } from './config.js';
import { extractGlobalOverrides, extractModItemModifiers } from './extract/globals.js';
import { extractItems } from './extract/items.js';
import { extractProjectiles } from './extract/projectiles.js';
import { evalStatics } from './extract/interp.js';
import { loadLocalization } from './extract/localization.js';
import { extractModDrops } from './extract/loot.js';
import { extractBossLog, extractNpcs } from './extract/npcs.js';
import { extractModPrefixes, VANILLA_PREFIXES } from './extract/prefixes.js';
import { extractRecipes } from './extract/recipes.js';
import { extractVanilla } from './extract/vanilla.js';
import { loadOrder } from './loadorder.js';
import { defaultPaths, readEnabled, resolveMods } from './resolve.js';
import { inferStages } from './stage/infer.js';
import { readTmodFile } from './tmod.js';

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
const allDrops = [];
const allNpcs = [];
const allBossLogs = [];
const allOverrides = []; // in load order
const allPrefixes = [...VANILLA_PREFIXES];
const allProjectiles = [];
const modInfo = [];
const localizations = new Map();

for (const m of ordered) {
  const tm = Date.now();
  const { tmod, asm, loc } = m;
  const modId = tmod.name;
  localizations.set(modId, loc);
  try {
    const cfg = configHooks(asm, modId, configs);
    const items = extractItems(asm, { tml, loc, modId, ammoIds });
    const projectiles = extractProjectiles(asm, { tml, modId });
    allProjectiles.push(...projectiles);
    const npcs = extractNpcs(asm, { tml, loc, modId });
    const bossLogs = extractBossLog(asm, { tml, modId }).map((b) => ({ ...b, mod: modId }));
    const recipes = extractRecipes(asm, { tml, modId });
    const drops = extractModDrops(asm, { tml, modId });
    const overrides = extractGlobalOverrides(asm, { tml, modId, enabledMods, cfg });
    const itemMods = extractModItemModifiers(asm, { tml, modId, enabledMods, cfg });
    const prefixes = extractModPrefixes(asm, { tml, loc, modId });
    allItems.push(...items);
    allNpcs.push(...npcs);
    allBossLogs.push(...bossLogs);
    allRecipes.push(...recipes);
    allDrops.push(...drops);
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
  const npcNames = new Map();
  for (const [name, id] of vanilla.ids.npc) if (typeof id === 'number' && id > 0 && !npcNames.has(id)) npcNames.set(id, name);
  for (const [id, internal] of npcNames) allNpcs.push({ id: `v:${id}`, mod: 'v', className: internal, name: vanilla.loc.get(`NPCName.${internal}`) ?? internal, boss: false });
  modInfo.unshift({ id: 'v', name: 'Terraria', version: tml.runtimeVersion, items: vanilla.items.length, equipment: vanilla.items.filter((i) => ['weapon', 'head', 'body', 'legs', 'accessory'].includes(i.slot)).length });
  rows.push(['(vanilla)', '', vanilla.items.length, modInfo[0].equipment, npcNames.size, '', vanilla.recipes.length, vanilla.drops.length, '', VANILLA_PREFIXES.length, `${Date.now() - tv} ms`]);
}

printTable(['mod', 'version', 'items', 'equip', 'npcs', 'bosses', 'recipes', 'drops', 'overlays', 'prefixes', 'time'], rows);

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
for (const p of allProjectiles) {
  const src = p.cloneOf ? projById.get(p.cloneOf) : p.aiType !== undefined ? projById.get(`v:${p.aiType}`) : null;
  if (!src) continue;
  for (const k of ['pen', 'tile', 'updates', 'ai', 'life', 'local', 'gravity', 'homing', 'walls', 'minion', 'sentry', 'slots']) if (p[k] === undefined && src[k] !== undefined) p[k] = src[k];
  if (p.cloneOf && !p.children && src.children) p.children = src.children;
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

for (const ref of (process.env.TL_DEBUG_ITEM ?? '').split(',').filter(Boolean)) {
  const it = ref.startsWith('name:') ? allItems.find((i) => i.name === ref.slice(5)) : allItems.find((i) => i.id === ref);
  const id = it?.id ?? ref;
  console.log('item', id, it ? `${it.slot} rarity ${it.rarity} ${it.rarityClass ?? ''}` : 'NOT FOUND');
  console.log('item', JSON.stringify({ base: it?.base, changes: it?.changes, variants: it?.variants, maybe: it?.maybe, mods: it?.mods }, null, 1));
  console.log('drops for', id, allDrops.filter((d) => d.item === id).map((d) => `${d.source} (${allNpcs.find((n) => n.id === d.source.slice(4))?.name ?? '?'})`));
  console.log('recipes for', id, JSON.stringify(allRecipes.filter((r) => r.result === id)));
}

// ---- stages ------------------------------------------------------------------------------
const config = JSON.parse(readFileSync(new URL('./stage/progression.json', import.meta.url), 'utf8'));
// guide-derived overrides (tools/guide-check.mjs --write-overrides) sit below the manual ones
{
  const guidePath = new URL('./stage/guide-overrides.json', import.meta.url);
  if (existsSync(guidePath)) {
    const guide = JSON.parse(readFileSync(guidePath, 'utf8'));
    delete guide.$comment;
    config.overrides = { ...guide, ...config.overrides };
  }
}
const stageResult = inferStages({
  items: allItems,
  recipes: allRecipes,
  drops: allDrops,
  bossLogs: allBossLogs,
  npcs: allNpcs,
  config,
  itemIds: vanilla?.ids.item ?? new Map(),
  tileIds: vanilla?.ids.tile ?? new Map(),
  mods: ordered.map((m) => m.name),
});

// ---- assemble dataset ----------------------------------------------------------------------
const EQUIP_SLOTS = new Set(['weapon', 'head', 'body', 'legs', 'accessory']);
const nameOf = new Map(allItems.map((i) => [i.id, i.name]));
const npcNameOf = new Map(allNpcs.map((n) => [n.id, n.name]));
const recipesByResult = new Map();
for (const r of allRecipes) { if (!r.result) continue; let l = recipesByResult.get(r.result); if (!l) recipesByResult.set(r.result, (l = [])); l.push(r); }
const dropSources = new Map();
for (const d of allDrops) { let l = dropSources.get(d.item); if (!l) dropSources.set(d.item, (l = [])); l.push(d.source); }

const rarityName = (it) => it.rarityClass ? it.rarityClass.replace(/Rarity$/, '').replace(/([a-z])([A-Z])/g, '$1 $2') : VANILLA_RARITY_NAMES[String(it.rarity)] ?? (it.rarity !== undefined ? `Rarity ${it.rarity}` : '');

const items = [];
for (const it of allItems) {
  if (!EQUIP_SLOTS.has(it.slot)) continue;
  if (it.slot !== 'weapon' && it.slot !== 'accessory' && !(it.defense > 0) && !it.setEffects && !it.effects) continue; // vanity armor
  if (it.slot === 'accessory' && it.createTile) continue; // music boxes
  const st = stageResult.byItem.get(it.id);
  const parsed = parseTooltipStats(it.tooltip);
  const cls = it.slot === 'weapon' ? (classOf(it.damageClass) ?? 'other') : null;
  const sources = [];
  for (const s of dropSources.get(it.id) ?? []) {
    const [kind, ...rest] = s.split(':');
    const ref = rest.join(':');
    if (kind === 'npc') sources.push({ kind: 'drop', from: npcNameOf.get(ref) ?? ref });
    else if (kind === 'bag') sources.push({ kind: 'bag', from: nameOf.get(ref) ?? ref });
  }
  for (const r of (recipesByResult.get(it.id) ?? []).slice(0, 3)) {
    sources.push({ kind: 'craft', from: r.ingredients.map((g) => `${g.n > 1 ? g.n + '× ' : ''}${nameOf.get(g.item) ?? g.item ?? '?'}`).concat(r.groups.map((g) => `any ${g.replace(/^any/, '')}`)).join(', ') });
  }
  items.push(compact({
    id: it.id,
    mod: it.mod,
    name: it.name,
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
    fire: it.slot === 'weapon' ? fireRecord(it.fire) : undefined,
    defense: it.defense,
    rarity: it.rarity,
    rarityName: rarityName(it),
    value: it.value,
    tooltip: cleanText(resolveRefs(it.tooltip, it.mod)),
    setBonus: cleanText(resolveRefs(it.setBonus, it.mod)),
    set: it.set?.length ? it.set : undefined,
    effects: it.effects ?? undefined,
    setEffects: it.setEffects ?? undefined,
    stats: Object.keys(parsed.stats).length ? parsed.stats : undefined,
    placeholders: parsed.placeholders || undefined,
    textClasses: parsed.classes.length ? parsed.classes : undefined,
    flags: parsed.flags.length ? parsed.flags : undefined,
    wings: it.wings || undefined,
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
  ammo.push(compact({ id: it.id, mod: it.mod, name: it.name, kind: it.ammo, damage: it.damage, knockback: it.knockback, shoot: it.shoot, stage: st ? st.stage : null, consumable: it.consumable || undefined }));
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
  }
  for (const a of ammo) if (a.shoot) want.push(a.shoot);
  const seen = new Set();
  while (want.length) {
    const id = want.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    const p = projById.get(id);
    if (!p) continue;
    const { id: _id, cloneOf: _c, ...rest } = p;
    projectiles[id] = rest;
    for (const ch of p.children ?? []) if (seen.size < 6000) want.push(ch.type);
  }
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
  ammoKinds: Object.fromEntries([...ammoIds].filter(([, v]) => isNumber(v) && v > 0).map(([k, v]) => [v, k])),
  items,
  ammo,
  projectiles,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(dataset));
const bySrc = {};
for (const it of items) bySrc[it.stageSource.kind] = (bySrc[it.stageSource.kind] ?? 0) + 1;
const changed = items.filter((i) => i.changes).length;
console.log(`\n${items.length} equipment items (${changed} rebalanced by other mods), ${dataset.stages.length} stages, ${allPrefixes.length} prefixes → ${outPath} (${(statSize(outPath) / 1024 / 1024).toFixed(1)} MB) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log(`stage evidence: ${Object.entries(bySrc).map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(`projectiles: ${allProjectiles.length} mined, ${Object.keys(projectiles).length} referenced; ${ammo.length} ammo items; ${items.filter((i) => i.fire).length} weapons with shoot analysis`);

// ---- helpers --------------------------------------------------------------------------------
function isNumber(v) { return typeof v === 'number' && Number.isFinite(v); }
/** Compact form of a weapon's Shoot analysis for the dataset. */
function fireRecord(f) {
  if (!f) return undefined;
  const r3 = (v) => (isNumber(v) ? Math.round(v * 1000) / 1000 : v ?? undefined);
  const calls = (f.calls ?? []).map((c) => compact({ type: c.type ?? 'shoot', count: c.count !== 1 ? c.count : undefined, dmgMul: c.dmgMul !== 1 ? r3(c.dmgMul) : undefined, velMul: c.velMul !== 1 ? r3(c.velMul) : undefined, abs: r3(c.abs), spread: c.spread ? r3(c.spread) : undefined, variant: c.variant !== 'both' ? c.variant : undefined, region: c.region }));
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
function mergeEffects(a, b) {
  if (!a) return structuredClone(b);
  const out = structuredClone(a);
  for (const [k, v] of Object.entries(b)) {
    if (k === 'flags') out.flags = [...new Set([...(out.flags ?? []), ...v])];
    else if (typeof v === 'object') { out[k] ??= {}; for (const [c, n] of Object.entries(v)) out[k][c] = Math.round(((out[k][c] ?? 0) + n) * 10000) / 10000; }
    else out[k] = Math.round(((out[k] ?? 0) + v) * 10000) / 10000;
  }
  return out;
}
/** `{$Mods.X.Key}` / `{$Common.Key}` references in tooltips → the referenced text. */
function resolveRefs(text, modId) {
  if (!text || !text.includes('{$')) return text ?? '';
  const loc = localizations.get(modId);
  return text.replace(/\{\$([^}@]+)(?:@\d+)?\}/g, (m, key) => {
    const candidates = [key, `Mods.${modId}.${key}`];
    for (const c of candidates) {
      const v = loc?.get(c) ?? vanilla?.loc.get(c) ?? vanilla?.loc.get(c.replace(/^Mods\.[^.]+\./, ''));
      if (v) return v;
    }
    const tail = key.split('.').pop();
    return tail.replace(/([a-z])([A-Z])/g, '$1 $2');
  });
}
function printTable(head, body) {
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((r) => String(r[i] ?? '').length)));
  const line = (r) => r.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ');
  console.log(line(head));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of body) console.log(line(r));
}
