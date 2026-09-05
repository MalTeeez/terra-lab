#!/usr/bin/env node
/**
 * What the miner cannot see.
 *
 * Two questions the dataset cannot answer about itself:
 *
 *  1. Is anything classified in ignorance? A class is only a ModItem because its base chain says
 *     so, and that chain crosses into other assemblies — an addon's weapon derives from the mod it
 *     extends. Where the walk hits a base it cannot resolve, the answer is a guess that always
 *     comes out "not content", and the class disappears without a word. Every dead end is listed.
 *  2. Of the items it does see, which fall out of the dataset, and does something say why? An item
 *     leaves because its slot is not equipment, because it is vanity armour, or because it is a
 *     music box — those are decisions. Anything else is a leak.
 *
 *   node tools/coverage.mjs           summary + the leads
 *   node tools/coverage.mjs --all     every lead, not the first 20 of each
 */
import { readFileSync } from 'node:fs';
import { loadAssembly } from '../miner/clr/metadata.js';
import { extractItems } from '../miner/extract/items.js';
import { evalStatics } from '../miner/extract/interp.js';
import { loadLocalization } from '../miner/extract/localization.js';
import { defaultPaths, readEnabled, resolveMods } from '../miner/resolve.js';
import { readTmodFile } from '../miner/tmod.js';

const all = process.argv.includes('--all');
const cap = (l) => (all ? l : l.slice(0, 20));
const pad = (s, n) => String(s).padEnd(n);
const TYPE_ABSTRACT = 0x80;
/** Bases that end the walk with an answer: tModLoader's own types and the runtime's. */
const KNOWN_NS = /^(Terraria|System|Microsoft|Mono|ReLogic|MonoMod|Newtonsoft)\b/;
/** The tModLoader base classes the miner reads content out of. */
const CONTENT = new Set(['ModItem', 'ModNPC', 'ModProjectile', 'ModTile', 'GlobalItem', 'GlobalNPC', 'ModSystem']);
const EQUIP = new Set(['weapon', 'head', 'body', 'legs', 'accessory']);

const paths = defaultPaths();
const tml = loadAssembly(readFileSync(paths.tmlDll));
const ammoIds = evalStatics(tml, tml.typeByName.get('Terraria.ID.AmmoID'), tml);
const { resolved, missing } = resolveMods(readEnabled(paths.enabledJson), paths);
if (missing.length) console.log(`! no .tmod for: ${missing.join(', ')}`);

const mods = [];
for (const m of resolved) {
  try {
    const tmod = readTmodFile(m.path);
    const dll = tmod.entries.get(`${tmod.name}.dll`);
    if (!dll) continue; // a resource-only mod (music, textures) has no code to miss
    mods.push({ name: tmod.name, asm: loadAssembly(dll.read()), loc: loadLocalization(tmod) });
  } catch (e) {
    console.log(`! ${m.name} did not load: ${e.message}`);
  }
}
const siblings = new Map(mods.map((m) => [m.asm.name, m.asm]));
for (const m of mods) m.asm.siblings = siblings;

// ---- 1. base chains that end in the dark -------------------------------------------------------
const blind = new Map(); // "Assembly::Base" → [count, example]
const generic = new Map(); // a generic base (`Quest<T>`) the miner's own walk stops at → what it leads to
for (const { asm } of mods) {
  for (const td of asm.types) {
    if (td.flags & TYPE_ABSTRACT || td.name.includes('`') || td.name.startsWith('<')) continue;
    let cur = td;
    let owner = asm;
    for (let i = 0; i < 32 && cur; i++) {
      const base = owner.baseOf(cur);
      if (!base) break;
      if (KNOWN_NS.test(base.namespace ?? '')) break;
      if (base.kind === 'typeDef') { cur = base.def; continue; }
      // `class AmidiasQuest : Quest<AmidiasQuestProgression>` — the base is a generic instance and
      // `derivesFrom` stops there. Follow it here to find out whether that ever hides content.
      if (base.kind === 'typeSpec') {
        let inner = null;
        try { inner = owner.resolve(base.type?.token); } catch { /* unreadable spec */ }
        const key = `${owner.name}::${base.name}`;
        if (inner?.kind === 'typeDef') { generic.set(key, td.fullName); cur = inner.def; continue; }
        if (inner?.kind === 'typeRef' && KNOWN_NS.test(inner.namespace ?? '')) break;
        const other = inner?.kind === 'typeRef' ? siblings.get(inner.assembly) : null;
        const def = other?.typeByName.get(inner.fullName);
        if (def) { generic.set(key, td.fullName); owner = other; cur = def; continue; }
      }
      if (base.kind === 'typeRef') {
        const other = siblings.get(base.assembly);
        const def = other?.typeByName.get(base.fullName);
        if (def) { owner = other; cur = def; continue; }
      }
      const key = base.kind === 'typeSpec' ? `${owner.name}::${base.name}` : `${base.assembly ?? '?'}::${base.fullName}`;
      const e = blind.get(key) ?? [0, td.fullName];
      blind.set(key, [e[0] + 1, e[1]]);
      break;
    }
  }
}
/** Does this type reach one of the content bases (following generic bases too)? */
const contentBase = (asm0, td0) => {
  let cur = td0;
  let owner = asm0;
  for (let i = 0; i < 32 && cur; i++) {
    const base = owner.baseOf(cur);
    if (!base) return null;
    if (base.namespace === 'Terraria.ModLoader' && CONTENT.has(base.name)) return base.name;
    if (base.kind === 'typeDef') { cur = base.def; continue; }
    let ref = base;
    if (base.kind === 'typeSpec') { try { ref = owner.resolve(base.type?.token); } catch { return null; } }
    if (ref?.kind === 'typeDef') { cur = ref.def; continue; }
    const other = ref?.kind === 'typeRef' ? siblings.get(ref.assembly) : null;
    const def = other?.typeByName.get(ref.fullName);
    if (!def) return null;
    owner = other;
    cur = def;
  }
  return null;
};
// the point of following generic bases: does one ever lead to content the miner would then miss?
const hiddenByGeneric = [];
for (const { name, asm } of mods) {
  for (const td of asm.types) {
    if (td.flags & TYPE_ABSTRACT || td.name.includes('`') || td.name.startsWith('<')) continue;
    const b = asm.baseOf(td);
    if (b?.kind !== 'typeSpec') continue;
    const k = contentBase(asm, td);
    if (k) hiddenByGeneric.push(`${name}:${td.name}  (${k} behind ${b.name})`);
  }
}

// ---- 2. items that do not reach the dataset ----------------------------------------------------
const ds = JSON.parse(readFileSync(new URL('../data/dataset.json', import.meta.url), 'utf8'));
const inData = new Set([...ds.items.map((i) => i.id), ...Object.keys(ds.materials)]);
const rows = [];
const leaks = [];  // no reason to be missing: this is the list that must stay empty
const unread = []; // SetDefaults told us nothing, so whatever reason it got is a guess
const reasons = new Map();
for (const { name, asm, loc } of mods) {
  let items = [];
  try { items = extractItems(asm, { tml, loc, modId: name, ammoIds }); } catch (e) { console.log(`! ${name} items: ${e.message}`); }
  let equip = 0;
  let carried = 0;
  for (const it of items) {
    const has = inData.has(it.id);
    if (EQUIP.has(it.slot)) equip++;
    if (has) { carried++; continue; }
    // the dataset's own three rules, in mine.js order
    const why = !EQUIP.has(it.slot) ? `not equipment (${it.slot})`
      : it.slot === 'accessory' && it.createTile ? 'music box (accessory that places a tile)'
        : it.slot !== 'weapon' && it.slot !== 'accessory' && !(it.defense > 0) && !it.setEffects && !it.effects ? 'vanity armour (no defense, no effect)'
          : null;
    if (why) reasons.set(why, (reasons.get(why) ?? 0) + 1);
    else leaks.push(`${it.id}  ${it.slot}  ${it.name}`);
    // a record with no stats at all is not a classification, it is a failure to read one
    if (!it.damage && !it.defense && !it.createTile && !it.rarity && !it.value && !it.useTime && !it.slot) unread.push(`${it.id}  (${it.name})  → ${why ?? 'kept'}`);
  }
  rows.push([name, items.length, equip, carried]);
}

console.log(`\n${pad('mod', 30)}${pad('ModItem', 9)}${pad('equipment', 11)}in dataset`);
for (const [n, t, e, c] of rows.sort((a, b) => b[1] - a[1])) if (t) console.log(`${pad(n, 30)}${pad(t, 9)}${pad(e, 11)}${c}`);

console.log(`\nitems held back, by the rule that held them: ${[...reasons.values()].reduce((a, b) => a + b, 0)}`);
for (const [r, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  ${pad(r, 44)} ${n}`);

console.log(`\nitems missing with no rule to explain them: ${leaks.length}`);
for (const l of cap(leaks)) console.log(`  ${l}`);

console.log(`\nitems whose SetDefaults read as nothing: ${unread.length}`);
for (const l of cap(unread)) console.log(`  ${l}`);

console.log(`\ncontent reached only through a generic base class: ${hiddenByGeneric.length} (followed)`);
for (const l of hiddenByGeneric.slice(0, all ? hiddenByGeneric.length : 3)) console.log(`  ${l}`);

const blindTotal = [...blind.values()].reduce((a, b) => a + b[0], 0);
console.log(`\nbase chains that end unresolved: ${blindTotal} types`);
for (const [k, [n, eg]] of cap([...blind].sort((a, b) => b[1][0] - a[1][0]))) console.log(`  ${pad(k, 62)} ${pad(n, 5)} e.g. ${eg}`);
if (!blind.size) console.log('  none — every class was classified with its whole base chain in hand');
console.log(`\n(generic bases followed: ${generic.size})`);

// Only two of the lists above are allowed to have entries: the rules that hold items back, and the
// generic bases the walk now follows. An unexplained item is a leak; an item with no stats was
// never read; a base from a mod the pack does not have is a class the game does not load either.
console.log(`\n${!leaks.length && !unread.length ? 'OK' : 'LEAKS'}: ${leaks.length} unexplained, ${unread.length} unread, ${blindTotal} classified without their base chain`);
