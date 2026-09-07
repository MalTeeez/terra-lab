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
  const byProjClass = new Map();
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
    // …and the same for projectiles, which is the only place a mod says what it *calls* the thing a
    // weapon shoots: Calamity's `ApolloFireball` is the "Volatile Plasma Blast" on the card.
    const pScore = /\.Projectiles?\./.test(parent) ? 2 : /Projectile/.test(parent) ? 1 : 0;
    const pPrev = byProjClass.get(cls);
    if (!pPrev || pScore > pPrev.score) byProjClass.set(cls, { parent, score: pScore });
  }

  // A `{$Key}` reference is written relative to where it sits — Calamity's set bonuses say
  // `{$GodSlayerHeadMelee.SetBonusEffect}` from inside `Mods.CalamityMod.Items.Armor.PostMoonLord.*`
  // — so every key is also indexed by its dotted suffixes and a partial reference still lands.
  // Two segments at least, and a suffix two different keys share is dropped rather than guessed
  // (across the installed pack that is none of them).
  const suffixes = new Map();
  for (const k of keys.keys()) {
    const seg = k.split('.');
    for (let n = 2; n < seg.length; n++) {
      const s = seg.slice(-n).join('.');
      suffixes.set(s, suffixes.has(s) ? null : k);
    }
  }

  // The arms a description the game hides behind a key press splits itself into: Calamity's Auric
  // Tesla armour prints "Hold Shift to view these set bonus details", and what shift shows is
  // `SetBonus1`, `SetBonus2`, `SetBonus3` beside the `SetBonus` the item wears; SOTS's Dream Lamp
  // keeps each of its forms in a `Tooltip1` / `Tooltip2` the same way. Every arm is text about the
  // item the player cannot see without holding a key, so all of it is the item's.
  //
  // They stay apart from the line the item prints, because the format arguments its code passes are
  // *that* line's — filling Silva's "{1}% increased max run speed" with the Auric helmet's 55%
  // summon damage invents a number. The arms keep their `{0}`s and read as the placeholders they are.
  const arms = (parent, field) => {
    const out = [];
    for (let n = 1; n < 10 && keys.has(`${parent}.${field}${n}`); n++) out.push(keys.get(`${parent}.${field}${n}`));
    return out.length ? out.join('\n') : undefined;
  };
  // …and the instruction to hold that key is spent once what it points at is in the text
  const shed = (text, more) => (more && text ? text.replace(/^.*\b(?:[Hh]old|[Pp]ress)\b[^\n]*\bShift\b[^\n]*$\n?/m, '').trim() || undefined : text);

  return {
    keys,
    warnings,
    get: (k) => keys.get(k),
    /** …and the same lookup, accepting a key written relative to wherever it was referenced from. */
    find: (k) => keys.get(k) ?? (suffixes.get(k) ? keys.get(suffixes.get(k)) : undefined),
    item(className) {
      const hit = byClass.get(className);
      if (!hit) return {};
      const p = hit.parent;
      const tooltip = keys.get(`${p}.Tooltip`);
      const setBonus = keys.get(`${p}.SetBonus`);
      return {
        name: keys.get(`${p}.DisplayName`),
        tooltip: shed(tooltip, arms(p, 'Tooltip')),
        // what a key press reveals about the weapon in hand, the same way (SOTS's Dream Lamp keeps
        // each of its two forms in a `Tooltip1` / `Tooltip2`)
        tooltipMore: arms(p, 'Tooltip'),
        setBonus: shed(setBonus, arms(p, 'SetBonus')),
        setBonusMore: arms(p, 'SetBonus'),
      };
    },
    /** A ModProjectile's display name — what the weapon's card calls what it shoots. */
    proj(className) {
      const hit = byProjClass.get(className);
      return hit?.score ? keys.get(`${hit.parent}.DisplayName`) : undefined;
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
