#!/usr/bin/env node
/**
 * The sprite files the name rule does not find, looked up on the wikis.
 *
 *   node tools/wiki-icons.mjs        # → data/wiki-icons.json, and patches data/dataset.json
 *
 * `src/lib/wiki.js` builds a sprite URL from the record's own name (`Murasama` → `Murasama.png`).
 * Two things that misses:
 *
 *   1. Animated sprites are filed as `.gif` — sometimes as well as the `.png` (`Murasama.gif` is
 *      the moving blade), sometimes instead of it (`Storm Maiden's Retribution` has no `.png` at
 *      all, so the icon just disappears). Each wiki is asked for its whole `.gif` list, and every
 *      record whose sprite is in it takes the animated file.
 *   2. A boss is often filed under a phase or animation name (`Nameless Deity` →
 *      `Nameless Deity of Light 4 (Wrath of the Gods).gif`). Nothing derives that, so for the ones
 *      whose sprite still 404s the article's lead section is read and its first image taken.
 *
 * Keyed by `<mod>:<name>`, since that is what the sprite follows — one entry covers the item, the
 * material and the NPC that share a name. `bun run mine` merges it back on as `img`, so it survives
 * a re-mine; the dataset is patched here too, so it does not take one.
 *
 * Hand-added entries are kept: a name the lookup cannot resolve on its own (a boss whose article is
 * not named after it, say `Argus, the Bereft Vassal` → `Bereft Vassal.gif`) survives a re-run.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { wikiFile, wikiImg, wikiUrl } from '../src/lib/wiki.js';

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36' };
const dsFile = new URL('../data/dataset.json', import.meta.url);
const outFile = new URL('../data/wiki-icons.json', import.meta.url);

const api = (base, query) => fetch(`${base}api.php?action=query&format=json&formatversion=2&${query}`, { headers: UA }).then((r) => r.json());
const key = (r) => `${r.mod}:${r.name}`;
/** The wiki a record's sprite lives on — several mods share terrariamods.wiki.gg. */
const wikiOf = (r) => wikiUrl(r).slice(0, wikiUrl(r).indexOf('/wiki/') + 1);

/** Sprites every article carries that are never the subject: bestiary rows, coins, rarity chrome. */
const CHROME = /Bestiary|Indicator|Stub\.|_Coin\.|Stack_digit|Rarity_color|Healing_Potion/i;

/**
 * The images of an article's lead section, in document order. The infobox comes first, so its
 * sprite is the first non-chrome file — `prop=images` cannot be used instead, it returns every
 * file on the page sorted by name.
 */
async function leadImages(base, title) {
  const url = `${base}api.php?action=parse&format=json&formatversion=2&redirects=1&prop=text&section=0&page=${encodeURIComponent(title)}`;
  const json = await (await fetch(url, { headers: UA })).json();
  if (json.error) return [];
  return [...json.parse.text.matchAll(/\/images\/(?:thumb\/)?([^"'?\s]+?\.(?:png|gif|jpe?g))(?=[/"'?\s])/gi)]
    .map((m) => decodeURIComponent(m[1]))
    .filter((f) => !CHROME.test(f));
}

const ds = JSON.parse(readFileSync(dsFile, 'utf8'));
const prev = existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : {};
const icons = {};
/** The keyed maps lose their id, which is the only place a record's internal name survives. */
const ids = new Map();
const withIds = (byId) => Object.entries(byId).map(([id, r]) => (ids.set(r, id), r));
const records = [...ds.items, ...ds.ammo, ...withIds(ds.materials), ...withIds(ds.npcs)].filter((r) => wikiFile(r));
const internalName = (r) => (r.id ?? ids.get(r) ?? '').split(':')[1];
const norm = (file) => file.replace(/_/g, ' ').toLowerCase();

// ---- 1. sprites filed under another name or extension -------------------------------------------
// gif first: an animated sprite is the better icon where the wiki has both. Then the still, whose
// URL the site builds itself — that one needs no entry here. The internal name is Ragnarok's
// convention (`Victide Sponge Hood` → `VictideHeadHealer.png`), tried last so it cannot outrank a
// file actually named after the item.
const EXTS = ['gif', 'png', 'webp', 'jpg', 'jpeg'];
const noSprite = [];
for (const base of new Set(records.map(wikiOf))) {
  const files = new Map(); // "victideheadhealer.png" → "VictideHeadHealer.png"
  for (let cont = ''; ; ) {
    const json = await api(base, `list=allimages&ailimit=max${cont}`);
    for (const f of json.query.allimages) files.set(norm(f.name), f.name);
    if (!json.continue) break;
    cont = `&aicontinue=${encodeURIComponent(json.continue.aicontinue)}`;
  }
  let n = 0;
  for (const r of records) {
    if (wikiOf(r) !== base) continue;
    const bases = [wikiFile(r), internalName(r)].filter(Boolean);
    const hit = bases.flatMap((b) => EXTS.map((e) => `${b}.${e}`)).find((c) => files.has(norm(c)));
    if (!hit) { noSprite.push(r); continue; }
    if (norm(hit) === norm(`${wikiFile(r)}.png`)) continue; // the name rule already builds this one
    if (!icons[key(r)]) n++;
    icons[key(r)] = files.get(norm(hit));
  }
  console.log(`${base} ${files.size} files, ${n} of ours need the looked-up name`);
}

// ---- 2. bosses the name does not reach ---------------------------------------------------------
let ok = 0;
const unresolved = [];
for (const [id, npc] of Object.entries(ds.npcs ?? {})) {
  const article = wikiUrl(npc);
  if (!article) { unresolved.push(`${id} (${npc.name}) — no wiki for ${npc.mod}`); continue; }
  if ((await fetch(wikiImg({ ...npc, img: icons[key(npc)] }), { headers: UA, method: 'HEAD' })).status === 200) { ok++; continue; }
  if (prev[key(npc)]) { icons[key(npc)] = prev[key(npc)]; ok++; continue; } // hand-added, or an earlier lookup

  const [file] = await leadImages(wikiOf(npc), decodeURIComponent(article.split('/wiki/')[1]));
  if (file) { icons[key(npc)] = file; console.log(`  ${npc.name} → ${file}`); }
  else unresolved.push(`${id} (${npc.name}) — ${article} has no lead sprite`);
}

// a hand-added entry — a file the lookup cannot reach from either name — survives a re-run
for (const [k, file] of Object.entries(prev)) icons[k] ??= file;
writeFileSync(outFile, `${JSON.stringify(Object.fromEntries(Object.keys(icons).sort().map((k) => [k, icons[k]])), null, 2)}\n`);
let patched = 0;
for (const r of records) if (icons[key(r)]) { r.img = icons[key(r)]; patched++; }
writeFileSync(dsFile, JSON.stringify(ds));

console.log(`\n${Object.keys(icons).length} sprite files looked up, on ${patched} of ${records.length} records`);
console.log(`${ok} boss sprites resolve, ${unresolved.length} do not:`);
for (const u of unresolved) console.log(`  ${u}`);

// Records the wiki has no file for under either name — the icon is simply blank on the site. Listed
// per mod so a mod whose sprites are filed some third way stands out from one the wiki never covered.
const blank = noSprite.filter((r) => !icons[key(r)]);
const byMod = {};
for (const r of blank) (byMod[r.mod] ??= []).push(internalName(r) ?? r.name);
console.log(`\n${blank.length} of ${records.length} records have no sprite on their wiki:`);
for (const [mod, names] of Object.entries(byMod).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${mod} ${names.length}: ${names.sort().join(', ')}`);
}
