/** Global UI state. Persisted to localStorage (see App.svelte). */

const KEY = 'terra-lab:ui:v2';

const defaults = {
  cls: 'melee',
  stage: 5,
  mode: 'loadout', // 'loadout' | 'timeline' | 'items'
  excludedMods: [],
  slots: 6,
  requireSet: false,
  unknownStage: false,
  // modifiers
  conds: [],          // active difficulty / mode flags (from dataset.conditions)
  uncertain: false,   // apply runtime modifiers whose guard could not be resolved
  reforge: 'best',    // 'best' | 'none' — assumption for gear without an explicit prefix
  // gear
  source: 'all',      // 'all' | 'owned'
  owned: {},          // id → { prefix: prefixId | null }
  pinned: [],
  excluded: [],
  // calibration
  samples: [],        // { id, damage, crit, prefix, bonusDamage, bonusCrit }
  calibrate: true,
  panel: null,        // null | 'gear' | 'calibrate'
  // item table
  query: '',
  slotFilter: 'all',
  classFilter: 'all',
  modFilter: 'all',
  stageFilter: 'current',
  sortK: 'stage',
  sortDir: 1,
  selected: null,
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaults };
    const saved = JSON.parse(raw);
    return { ...defaults, ...saved, selected: null, panel: null };
  } catch {
    return { ...defaults };
  }
}

export const ui = $state(load());

export function persist() {
  try {
    const { selected, panel, ...rest } = ui;
    localStorage.setItem(KEY, JSON.stringify(rest));
  } catch { /* storage unavailable */ }
}

export function resetUi() {
  Object.assign(ui, { ...defaults });
}

/** Owned gear helpers (reassign so Svelte notices). */
export function setOwned(id, on, prefix = undefined) {
  const next = { ...ui.owned };
  if (!on) delete next[id];
  else next[id] = { prefix: prefix === undefined ? next[id]?.prefix ?? null : prefix };
  ui.owned = next;
}
export function toggleIn(listKey, id) {
  const set = new Set(ui[listKey]);
  if (set.has(id)) set.delete(id); else set.add(id);
  ui[listKey] = [...set];
}
