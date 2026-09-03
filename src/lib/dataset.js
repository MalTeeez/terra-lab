/**
 * Dataset loading and indexing.
 *
 * `dataset.json` is produced by `bun run mine` (see miner/mine.js) and served as a
 * static asset. Nothing here touches the game.
 */

export const CLASS_LABELS = {
  melee: 'Melee', ranged: 'Ranged', magic: 'Magic', summon: 'Summoner', rogue: 'Rogue',
  thrower: 'Thrower', bard: 'Bard', healer: 'Healer', classless: 'Classless', other: 'Other',
};

export const SLOT_LABELS = { weapon: 'Weapon', head: 'Head', body: 'Body', legs: 'Legs', accessory: 'Accessory' };

/** Accent colour per class — drives chips, panel spines, bars (`style="--accent: …"`). */
export const CLASS_COLORS = {
  melee: '#b3402c', ranged: '#1f7a52', magic: '#3d55c4', summon: '#7743bd', rogue: '#10767c',
  thrower: '#a06021', bard: '#bb3f79', healer: '#b8860b', classless: '#6b736d', other: '#6b736d',
};
export const accentOf = (cls) => CLASS_COLORS[cls] ?? 'var(--color-green)';

/** How sure we are about an item's gamestage — the tag colour says it. */
export const SOURCE_TONE = {
  drop: 'green', bag: 'green', enemy: 'green', ore: 'green', chest: 'info', shop: 'info', craft: 'info',
  spawn: 'info', anchor: 'plum', manual: 'plum', override: 'plum', structure: 'plum', start: '', rarity: 'warn', unknown: 'warn',
};
export const SOURCE_HINT = {
  rarity: 'guessed from the item’s rarity — worth double-checking',
  unknown: 'no evidence found in any mod’s code',
  craft: 'from when its ingredients become available',
  drop: 'from the enemy or boss that drops it',
  bag: 'from the treasure bag it comes in',
  chest: 'from the chest it is found in',
  shop: 'from when the NPC sells it',
  enemy: 'from when the enemy that drops it spawns',
  ore: 'from when the ore can be mined',
  spawn: 'from when the NPC appears',
  anchor: 'pinned by a known progression anchor',
  structure: 'from the structure this loot belongs to — no route to it opens earlier',
  manual: 'pinned by hand in the miner',
  override: 'pinned from the class-setup guides',
  start: 'available from the start',
};

export async function loadDataset(url = `${import.meta.env.BASE_URL}dataset.json`) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`dataset.json: HTTP ${res.status}`);
  const raw = await res.json();
  return indexDataset(raw);
}

/** Add lookup structures and derived fields the UI and solver rely on. */
export function indexDataset(raw) {
  const byId = new Map();
  for (const it of raw.items) byId.set(it.id, it);
  const modIds = raw.mods.map((m) => m.id);
  const modById = new Map(raw.mods.map((m) => [m.id, m]));
  const aliases = raw.classAliases ?? {};

  for (const it of raw.items) {
    it.modName = modById.get(it.mod)?.name ?? it.mod;
    // effective class after aliases (Calamity treats throwing as rogue)
    it.cls = it.class ? aliases[it.class] ?? it.class : null;
    if (it.set) {
      it.setItems = it.set.map((id) => byId.get(id)).filter(Boolean);
    }
    it.stageLabel = it.stage === null || it.stage === undefined ? 'Unknown' : raw.stages[it.stage]?.label ?? '?';
  }
  // body/legs learn which head references them (for set lookups from any piece)
  for (const it of raw.items) {
    if (it.slot !== 'head' || !it.setItems) continue;
    for (const p of it.setItems) {
      (p.setHeads ??= []).push(it);
    }
  }

  const classes = new Set();
  for (const it of raw.items) if (it.cls) classes.add(it.cls);
  const classList = ['melee', 'ranged', 'magic', 'summon', 'rogue', 'thrower', 'bard', 'healer'].filter((c) => classes.has(c));

  const prefixes = raw.prefixes ?? [];
  const prefixById = new Map(prefixes.map((p) => [p.id, p]));
  // ammo by kind (AmmoID), for the "best ammo at this stage" part of the DPS model
  const ammoByKind = new Map();
  for (const a of raw.ammo ?? []) {
    let l = ammoByKind.get(a.kind);
    if (!l) ammoByKind.set(a.kind, (l = []));
    l.push(a);
  }
  // crafting trees: materials (non-equipment items reachable from equipment), recipes, groups, stations
  const materials = raw.materials ?? {};
  for (const [id, m] of Object.entries(materials)) {
    m.id = id;
    m.modName = modById.get(m.mod)?.name ?? m.mod;
    m.stageLabel = m.stage === null || m.stage === undefined ? 'Unknown' : raw.stages[m.stage]?.label ?? '?';
  }
  // special world seeds: the records that move, with their normal-world answer kept alongside
  const seeds = raw.seeds ?? [];
  const seedItems = [];
  {
    const seen = new Map();
    for (const s of seeds) for (const [id, v] of Object.entries(s.items)) {
      let rec = seen.get(id);
      if (!rec) {
        const it = byId.get(id);
        const node = it ?? materials[id];
        if (!node) continue;
        rec = { node, equip: !!it, base: { stage: node.stage, prog: node.prog, src: it ? node.stageSource : node.src }, alts: [] };
        seen.set(id, rec);
        seedItems.push(rec);
      }
      rec.alts.push({ key: s.key, ...v });
    }
  }
  return {
    ...raw, byId, modIds, modById, classList, aliases, prefixes, prefixById, conditions: raw.conditions ?? [], projectiles: raw.projectiles ?? {}, ammo: raw.ammo ?? [], ammoByKind, ammoKinds: raw.ammoKinds ?? {},
    materials, recipes: raw.recipes ?? {}, groups: raw.groups ?? {}, stations: raw.stations ?? {}, seeds, seedItems,
  };
}

/**
 * Put the enabled special world seeds' stages over the normal-world ones (a seed only ever makes
 * something available earlier). Mutates the records the solver and table already hold, so the
 * caller has to re-render on a `true` result.
 */
export function applySeeds(ds, keys) {
  const on = new Set(keys);
  let moved = false;
  for (const rec of ds.seedItems) {
    let best = rec.base;
    for (const alt of rec.alts) if (on.has(alt.key) && alt.prog < best.prog) best = alt;
    if (rec.node.prog === best.prog) continue;
    rec.node.stage = best.stage;
    rec.node.prog = best.prog;
    rec.node.stageLabel = ds.stages[best.stage]?.label ?? '?';
    if (rec.equip) rec.node.stageSource = best.src; else rec.node.src = best.src;
    moved = true;
  }
  return moved;
}

/** An item or material as a crafting-tree node record (equipment items carry `stageSource`, materials `src`). */
export function nodeOf(ds, id) {
  const it = ds.byId.get(id);
  if (it) return { id, name: it.name, mod: it.mod, modName: it.modName, stage: it.stage, stageLabel: it.stageLabel, prog: it.prog, src: it.stageSource, equip: true, drops: it.sources?.filter((s) => s.kind !== 'craft') };
  const m = ds.materials[id];
  if (m) return { id, name: m.name, mod: m.mod, modName: m.modName, stage: m.stage, stageLabel: m.stageLabel, prog: m.prog, src: m.src, equip: false, pick: m.pick, drops: m.drops };
  return null;
}

/** The five broad eras of a run, with the colour each is tinted in. */
export const ERAS = [
  { label: 'Pre-Hardmode', color: '#1e7a3c', max: 7 },
  { label: 'Hardmode', color: '#b8860b', max: 12 },
  { label: 'Post-Plantera', color: '#7743bd', max: 17 },
  { label: 'Post-Moon Lord', color: '#b23b3b', max: 21 },
  { label: 'Endgame', color: '#2f5bb7', max: Infinity },
];

export const eraOf = (stage) => ERAS.find((e) => (stage?.progression ?? 0) < e.max) ?? ERAS[0];

/** Group stage list into eras for the picker. */
export function stageEras(stages) {
  return ERAS.map((e) => ({ ...e, stages: stages.filter((s) => eraOf(s) === e) })).filter((e) => e.stages.length);
}
