/**
 * Which dataset the site is looking at.
 *
 * A *preset* is a `dataset.json` we ship out of data/; a *custom* one is a file the user mined
 * themselves with `bun run mine` and dropped on the start page. The custom file is stored in the
 * Cache API under a URL that does not exist on the server, so `loadDataset` reaches both kinds the
 * same way — one fetch by URL, which is also what the timeline worker does.
 *
 * The choice is remembered until the user goes back to the start page.
 */
import { summarize } from './dataset.js';

const base = import.meta.env.BASE_URL;
const CHOICE_KEY = 'terra-lab:dataset';
const CUSTOM_KEY = 'terra-lab:dataset:custom'; // the card for it; the dataset itself is in the cache
const CACHE = 'terra-lab-dataset';

export const CUSTOM_URL = `${base}custom-dataset.json`;

/** The datasets we ship. Add an entry (and its file in data/) to publish another. */
export const PRESETS = [
  {
    url: `${base}dataset.json`,
    summaryUrl: `${base}dataset.summary.json`,
    name: 'The kitchen sink',
    note: 'Calamity, Thorium, Secrets of the Shadows and the rest of the pack Terra Lab is developed against.',
  },
];

/**
 * The stored choice, or null when there is none (or it points at an upload that is gone).
 *
 * With nothing stored, `bun run dev` opens straight onto the dataset in `data/` instead of the
 * picker: local work is a loop of re-mining that file and reloading, and the dev server serves it
 * `no-cache` so a reload is all it takes. A stored choice still wins — pick an uploaded or
 * browser-mined dataset in dev and it stays picked — and the picker is one click away in the header.
 */
export function getChoice() {
  try {
    const url = localStorage.getItem(CHOICE_KEY);
    if (url === CUSTOM_URL) return customInfo() ? url : null;
    if (PRESETS.some((p) => p.url === url)) return url;
  } catch { /* no storage: fall through */ }
  return import.meta.env.DEV ? PRESETS[0].url : null;
}

export function setChoice(url) {
  try {
    localStorage.setItem(CHOICE_KEY, url);
  } catch { /* storage unavailable: the choice lasts for this page load */ }
}

/** The uploaded dataset's card — `{ name, summary }` — or null if there is none. */
export function customInfo() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_KEY)) ?? null;
  } catch {
    return null;
  }
}

const MAX_BYTES = 300 * 1024 * 1024;

/**
 * Take a `dataset.json` the user picked, check it is one, and keep it. Returns its card.
 * Throws with something worth reading if the file is not a dataset.
 */
export async function saveCustom(file) {
  if (file.size > MAX_BYTES) throw new Error(`${file.name} is ${(file.size / 1024 / 1024).toFixed(0)} MB — that is not a dataset.`);
  return saveDataset(await file.text(), file.name);
}

/**
 * The same, for a dataset that never was a file: the one the browser miner just produced.
 * It goes through the same check — it is still JSON of unknown shape until it is looked at.
 */
export async function saveDataset(text, name) {
  if (!globalThis.caches) throw new Error('This browser cannot store a dataset (the page needs to be served over https or localhost).');
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`${name} is not valid JSON.`);
  }
  if (!Array.isArray(raw?.items) || !Array.isArray(raw?.mods) || !Array.isArray(raw?.stages)) {
    throw new Error(`${name} is not a Terra Lab dataset — it has no items, mods and stages. Generate one with \`bun run mine\`.`);
  }
  const cache = await caches.open(CACHE);
  await cache.put(CUSTOM_URL, new Response(text, { headers: { 'content-type': 'application/json' } }));
  const info = { name, summary: summarize(raw) };
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(info));
  } catch { /* the card is a nicety; the dataset itself is stored */ }
  return info;
}

export async function clearCustom() {
  try {
    localStorage.removeItem(CUSTOM_KEY);
    if (getChoice() === CUSTOM_URL) localStorage.removeItem(CHOICE_KEY);
    await globalThis.caches?.delete(CACHE);
  } catch { /* nothing to clear */ }
}

/** A preset's card. Missing or unreadable is not an error: the preset still works, it just says less. */
export async function fetchSummary(url) {
  try {
    const res = await fetch(url);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
