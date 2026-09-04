/**
 * Dataset loading and indexing.
 *
 * `dataset.json` is produced by `bun run mine` (see miner/mine.js) and served as a
 * static asset. Nothing here touches the game.
 */

export const CLASS_LABELS = {
  melee: 'Melee', ranged: 'Ranged', magic: 'Magic', summon: 'Summoner', rogue: 'Rogue',
  thrower: 'Thrower', bard: 'Bard', healer: 'Healer', void: 'Void', classless: 'Classless', other: 'Other',
};

export const SLOT_LABELS = { weapon: 'Weapon', head: 'Head', body: 'Body', legs: 'Legs', accessory: 'Accessory' };

/**
 * Weapon types (`item.arch`, mined in `miner/extract/items.js`), as the wiki names them. The tag is
 * what the DPS model is built on — `ARCHETYPE` in `src/lib/dps.js` says how each one delivers its
 * damage — so it is worth showing next to the number it explains.
 */
export const ARCH_LABELS = {
  swing: 'Broadsword', shortsword: 'Shortsword', specialsword: 'Special sword', spear: 'Spear',
  yoyo: 'Yoyo', flail: 'Flail', boomerang: 'Boomerang',
  bow: 'Bow', repeater: 'Repeater', gun: 'Gun', launcher: 'Launcher', flamethrower: 'Flamethrower',
  shot: 'Shot', held: 'Held beam', placed: 'Placed',
  minion: 'Minion', sentry: 'Sentry', whip: 'Whip',
  bomb: 'Bomb', dagger: 'Dagger', javelin: 'Javelin', spikyball: 'Spiky ball',
};
/** What each type is, in one sentence, for the tag's tooltip. */
export const ARCH_HINT = {
  swing: 'A blade swung in a wide arc that hits everything it passes through.',
  shortsword: 'A short blade stabbed straight ahead from right beside the target.',
  specialsword: 'A melee weapon that sends its blade out on its own instead of swinging it.',
  spear: 'A long shaft thrust out and pulled straight back, hitting on the way out and the way back.',
  yoyo: 'A spinning yoyo held out on its string that keeps hitting whatever it rests against.',
  flail: 'A weight swung on a chain that keeps hitting whatever it stays against.',
  boomerang: 'A thrown weapon that flies out and returns to your hand before it can be thrown again.',
  bow: 'A bow that spends arrows to fire one shot with every draw.',
  repeater: 'A bow that keeps firing arrows for as long as the button is held.',
  gun: 'A gun that spends bullets to fire a fast, straight shot.',
  launcher: 'A launcher that spends rockets and does its damage as an explosion.',
  flamethrower: 'A weapon that pours a short cone of fire over anything standing close.',
  shot: 'A weapon that fires a projectile each time it is used.',
  held: 'A beam or drill held on the target that keeps hitting for as long as it is pointed there.',
  placed: 'A weapon set down in one spot that hits whatever comes into it.',
  minion: 'A summoned minion that follows you and attacks on its own while it holds a minion slot.',
  sentry: 'A summoned turret that stays where it was placed and attacks from there while it holds a sentry slot.',
  whip: 'A whip that marks the enemy it strikes so your minions hit it harder.',
  bomb: 'A thrown explosive that arcs to the ground and does its damage as a blast.',
  dagger: 'A small blade thrown straight ahead for a single quick hit.',
  javelin: 'A thrown spear that lodges in the enemy and keeps wounding it.',
  spikyball: 'A spiked ball thrown to the ground that hurts whatever walks into it.',
};

/** Accent colour per class — drives chips, panel spines, bars (`style="--accent: …"`). */
export const CLASS_COLORS = {
  melee: '#b3402c', ranged: '#1f7a52', magic: '#3d55c4', summon: '#7743bd', rogue: '#10767c',
  thrower: '#a06021', bard: '#bb3f79', healer: '#b8860b', void: '#3d2a63', classless: '#6b736d', other: '#6b736d',
};
export const accentOf = (cls) => CLASS_COLORS[cls] ?? 'var(--color-green)';

/** How sure we are about an item's gamestage — the tag colour says it. */
export const SOURCE_TONE = {
  drop: 'green', bag: 'green', enemy: 'green', ore: 'green', chest: 'info', shop: 'info', craft: 'info',
  spawn: 'info', anchor: 'plum', manual: 'plum', override: 'plum', structure: 'plum', start: '', rarity: 'warn', unknown: 'warn', unobtainable: 'warn',
};
export const SOURCE_HINT = {
  rarity: 'This stage is only guessed from the item’s rarity, so check it yourself.',
  unknown: 'No evidence for this stage was found in any mod’s code.',
  unobtainable: 'The mod removed this or leaves it unreachable — it is in no stage.',
  craft: 'This is the stage all of its ingredients become available.',
  drop: 'This is the stage the enemy or boss that drops it can be fought.',
  bag: 'This is the stage the treasure bag it comes in starts to drop.',
  chest: 'This is the stage the chest it is found in can be reached.',
  shop: 'This is the stage the NPC starts selling it.',
  enemy: 'This is the stage the enemy that drops it starts to spawn.',
  ore: 'This is the stage the ore can be mined.',
  spawn: 'This is the stage the NPC appears.',
  anchor: 'This stage is pinned by a known progression anchor.',
  structure: 'This is the stage the structure holding this loot can be reached, because no route to it opens earlier.',
  manual: 'This stage is pinned by hand in the miner.',
  override: 'This stage is pinned from the class-setup guides.',
  start: 'You have this from the start.',
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
  const classList = ['melee', 'ranged', 'magic', 'summon', 'rogue', 'thrower', 'bard', 'healer', 'void'].filter((c) => classes.has(c));

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
    npcs: raw.npcs ?? {}, debuffs: raw.debuffs ?? {},
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
