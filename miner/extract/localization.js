/**
 * Mod localization: every `en-US` hjson inside the .tmod, flattened to dotted keys and
 * indexed by item class name.
 *
 * tModLoader prefixes a file's keys with the dotted part of its file name
 * (`Mods.CalamityMod.Items.Accessories.hjson` → `Mods.CalamityMod.Items.Accessories.*`),
 * while a plain `en-US.hjson` nests everything under `Mods: { ModName: … }`. Items are
 * looked up by the last path segment before `DisplayName`, which is the ModItem class
 * name regardless of the category a mod chose.
 */
import Hjson from 'hjson';

const EN_US = /(^|\/)en-US([._]|\/|$)/i;

function flatten(obj, prefix, out) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out.set(key, Array.isArray(v) ? v.join('\n') : String(v));
  }
}

/** Key prefix implied by a localization file path. */
export function prefixOf(path) {
  const base = path.split('/').pop().replace(/\.hjson$/i, '');
  // en-US.hjson → '', en-US_Mods.X.hjson → 'Mods.X', Mods.X.Items.hjson (inside en-US/) → 'Mods.X.Items'
  const stripped = base.replace(/^en-US[._]?/i, '');
  return stripped;
}

/**
 * @param {{ entries: Map<string, { read: () => Buffer }> }} tmod
 * @returns {{ keys: Map<string,string>, item: (className: string) => { name?: string, tooltip?: string, setBonus?: string }, get: (key: string) => string|undefined, warnings: string[] }}
 */
export function loadLocalization(tmod) {
  const keys = new Map();
  const warnings = [];
  for (const [path, entry] of tmod.entries) {
    if (!/\.hjson$/i.test(path) || !/^Localization\//i.test(path) || !EN_US.test(path)) continue;
    let text;
    try {
      text = entry.read().toString('utf8').replace(/^﻿/, '');
      const obj = Hjson.parse(text);
      flatten(obj, prefixOf(path), keys);
    } catch (e) {
      warnings.push(`${path}: ${e.message}`);
    }
  }

  // className → best parent path, per kind. Paths under an `Items` segment win for items, ones
  // under `Buffs` for buffs — a mod that names a buff after the potion that grants it has both.
  const byClass = new Map();
  const byBuffClass = new Map();
  for (const key of keys.keys()) {
    if (!key.endsWith('.DisplayName')) continue;
    const parent = key.slice(0, -'.DisplayName'.length);
    const cls = parent.split('.').pop();
    const score = /\.Items\./.test(parent) ? 2 : /Items/.test(parent) ? 1 : 0;
    const prev = byClass.get(cls);
    if (!prev || score > prev.score) byClass.set(cls, { parent, score });
    const bScore = /\.Buffs\./.test(parent) ? 2 : /Buffs/.test(parent) ? 1 : 0;
    const bPrev = byBuffClass.get(cls);
    if (!bPrev || bScore > bPrev.score) byBuffClass.set(cls, { parent, score: bScore });
  }

  return {
    keys,
    warnings,
    get: (k) => keys.get(k),
    item(className) {
      const hit = byClass.get(className);
      if (!hit) return {};
      const p = hit.parent;
      return {
        name: keys.get(`${p}.DisplayName`),
        tooltip: keys.get(`${p}.Tooltip`),
        setBonus: keys.get(`${p}.SetBonus`),
      };
    },
    /** A ModBuff's name and description — what a potion granting it is actually worth. */
    buff(className) {
      const hit = byBuffClass.get(className);
      if (!hit) return {};
      return { name: keys.get(`${hit.parent}.DisplayName`), desc: keys.get(`${hit.parent}.Description`) };
    },
  };
}

/** `AuricTeslaHeadMelee` → `Auric Tesla Head Melee` for items with no localization. */
export function deCamel(name) {
  return name.replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}
