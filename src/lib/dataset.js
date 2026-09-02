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
  return { ...raw, byId, modIds, modById, classList, aliases, prefixes, prefixById, conditions: raw.conditions ?? [], projectiles: raw.projectiles ?? {}, ammo: raw.ammo ?? [], ammoByKind, ammoKinds: raw.ammoKinds ?? {} };
}

/** Group stage list into eras for the picker. */
export function stageEras(stages) {
  const eras = [
    { label: 'Pre-Hardmode', test: (s) => s.progression < 7 },
    { label: 'Hardmode', test: (s) => s.progression >= 7 && s.progression < 12 },
    { label: 'Post-Plantera', test: (s) => s.progression >= 12 && s.progression < 17 },
    { label: 'Post-Moon Lord', test: (s) => s.progression >= 17 && s.progression < 21 },
    { label: 'Endgame', test: (s) => s.progression >= 21 },
  ];
  return eras.map((e) => ({ label: e.label, stages: stages.filter(e.test) })).filter((e) => e.stages.length);
}
