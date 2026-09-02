/**
 * Locate tModLoader, its save folder, and the `.tmod` file for each enabled mod.
 *
 * Search order per mod name: `<saves>/Mods/<Name>.tmod`, then the Steam workshop
 * (`steamapps/workshop/content/1281930/<id>/<version>/<Name>.tmod`, newest version folder).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const TML_APP_ID = '1281930';

export function defaultPaths() {
  const home = process.env.USERPROFILE ?? homedir();
  const saves = process.env.TML_SAVES ?? join(home, 'Documents', 'My Games', 'Terraria', 'tModLoader');
  const steam = process.env.STEAM_DIR ?? 'C:/Program Files (x86)/Steam';
  return {
    saves,
    modsDir: join(saves, 'Mods'),
    enabledJson: join(saves, 'Mods', 'enabled.json'),
    workshop: join(steam, 'steamapps', 'workshop', 'content', TML_APP_ID),
    tmlDll: join(steam, 'steamapps', 'common', 'tModLoader', 'tModLoader.dll'),
  };
}

/** "2026.6" > "2025.12" > "2022.9" */
const versionKey = (name) => name.split('.').map((x) => Number(x) || 0);
const cmpVersion = (a, b) => {
  const ka = versionKey(a);
  const kb = versionKey(b);
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    const d = (ka[i] ?? 0) - (kb[i] ?? 0);
    if (d) return d;
  }
  return 0;
};

/** Every `.tmod` under the workshop folder, newest version folder per workshop item: name → path. */
export function scanWorkshop(workshop) {
  const out = new Map();
  if (!existsSync(workshop)) return out;
  for (const id of readdirSync(workshop)) {
    const dir = join(workshop, id);
    let st;
    try { st = statSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;
    const entries = readdirSync(dir);
    const versions = entries.filter((e) => /^\d{4}\.\d+$/.test(e) && statSync(join(dir, e)).isDirectory()).sort(cmpVersion);
    const candidates = versions.length ? versions.map((v) => join(dir, v)) : [dir];
    for (const c of candidates) {
      for (const f of readdirSync(c)) {
        if (!f.endsWith('.tmod')) continue;
        out.set(f.slice(0, -5), join(c, f)); // later (newer) versions overwrite
      }
    }
  }
  return out;
}

/** Local Mods folder: plain `<Name>.tmod` files (version-prefixed copies are ignored). */
export function scanLocalMods(modsDir) {
  const out = new Map();
  if (!existsSync(modsDir)) return out;
  for (const f of readdirSync(modsDir)) {
    if (!f.endsWith('.tmod') || /^\d{4}\.\d+/.test(f)) continue;
    out.set(f.slice(0, -5), join(modsDir, f));
  }
  return out;
}

export function readEnabled(enabledJson) {
  if (!existsSync(enabledJson)) return [];
  return JSON.parse(readFileSync(enabledJson, 'utf8'));
}

/**
 * @returns {{ resolved: Array<{ name: string, path: string, source: 'local'|'workshop' }>, missing: string[] }}
 */
export function resolveMods(names, paths = defaultPaths()) {
  const local = scanLocalMods(paths.modsDir);
  const workshop = scanWorkshop(paths.workshop);
  const resolved = [];
  const missing = [];
  for (const name of names) {
    if (local.has(name)) resolved.push({ name, path: local.get(name), source: 'local' });
    else if (workshop.has(name)) resolved.push({ name, path: workshop.get(name), source: 'workshop' });
    else missing.push(name);
  }
  return { resolved, missing };
}
