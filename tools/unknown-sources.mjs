#!/usr/bin/env node
/**
 * What the miner could not source, so the gaps can be closed at the root:
 *   1. gates that did not resolve — a downed flag, zone or event the config does not know
 *      (progression.json `downedFlags` / `zones`): the evidence behind them is unused
 *   2. items whose stage is only a rarity guess (or unknown), grouped by mod, with every
 *      code path the miner did see for them (drops, shops, fishing, world generation)
 *   3. materials among those that gate the most equipment
 * Writes data/unknown-sources.md.
 *
 *   node tools/unknown-sources.mjs            # every mod
 *   node tools/unknown-sources.mjs --mod ThoriumMod,SOTS
 *   node tools/unknown-sources.mjs --equipment-only
 *   node tools/unknown-sources.mjs --all         # include pre-boss commons (rarity ≤ 1 guessed at Pre-boss)
 */
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const mods = opt('--mod')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null;
const equipmentOnly = args.includes('--equipment-only');
const all = args.includes('--all');
// a rarity-0/1 item guessed at Pre-boss (Cobweb, Sand Block, Feather) is almost always right; skip unless --all
const common = (rec) => !all && (rec.stage === 0) && (rec.rarity ?? 0) <= 1;

const ds = JSON.parse(readFileSync(new URL('../data/dataset.json', import.meta.url), 'utf8'));
const stageLabel = (i) => (i === null || i === undefined ? 'unknown' : ds.stages[i]?.label ?? '?');
const guessed = (src) => !src || src.kind === 'rarity' || src.kind === 'unknown' || (src.kind === 'worldgen' && src.estimated);
const modName = new Map(ds.mods.map((m) => [m.id, m.name]));
const wantMod = (m) => !mods || mods.includes(m);

const equip = ds.items.filter((it) => guessed(it.stageSource) && wantMod(it.mod) && !common(it));
const skippedEquip = ds.items.filter((it) => guessed(it.stageSource) && wantMod(it.mod) && common(it)).length;
// materials whose stage is guessed, with the equipment that needs them (through the chosen recipes)
const dependents = new Map(); // material id → Set(equipment names)
const walk = (rootName, id, seen) => {
  const recs = ds.recipes[id];
  if (!recs || seen.has(id)) return;
  seen.add(id);
  const src = ds.items.find((i) => i.id === id)?.stageSource ?? ds.materials[id]?.src;
  const rec = recs[src?.kind === 'craft' && recs[src.recipe] ? src.recipe : 0];
  const ings = [...rec[0].map(([iid]) => iid), ...rec[1].flatMap((g) => ds.groups[g] ?? [])];
  for (const iid of ings) {
    const m = ds.materials[iid];
    if (m && guessed(m.src)) { let l = dependents.get(iid); if (!l) dependents.set(iid, (l = new Set())); l.add(rootName); }
    walk(rootName, iid, seen);
  }
};
for (const it of ds.items) walk(it.name, it.id, new Set());
const mats = Object.entries(ds.materials).filter(([, m]) => guessed(m.src) && wantMod(m.mod) && !common(m)).map(([id, m]) => ({ id, ...m, uses: dependents.get(id)?.size ?? 0 }));
const skippedMats = Object.entries(ds.materials).filter(([, m]) => guessed(m.src) && wantMod(m.mod) && common(m)).length;

const fmtDrops = (d) => (d?.length ? d.map((x) => `${x.kind} ${x.from}${x.cond ? ` (${x.cond})` : ''}`).join('; ') : '');
const why = (src) => (src?.kind === 'worldgen' ? `chest at world generation (${src.via}), rarity floor` : src?.kind === 'unknown' || !src ? 'no rarity, no evidence' : 'rarity guess');
const lines = [];
lines.push('# Items without a known source', '', `Generated ${new Date().toISOString().slice(0, 10)} from data/dataset.json.`, '',
  'The miner reads drops, boss bags, shops, fishing, natural spawns, world-generation chests and recipes from the mod code. What is listed here is what that left open:', '',
  '- **Unresolved gates** are flags the code checks that the miner cannot place on the boss order. Each one blocks every piece of evidence behind it. Answering "which boss / event makes this true" in `miner/stage/progression.json` (`downedFlags`, `zones`) fixes all of them at once.',
  '- **Equipment with a guessed stage** has no usable evidence: the stage is the rarity guess. The code paths the miner did see are listed so the missing one can be spotted (an event, a locked chest, a mechanic the miner does not read yet).', '',
  all ? '' : `Not listed: ${skippedEquip} equipment items and ${skippedMats} materials of rarity 0–1 guessed at Pre-boss (world blocks, common drops) — \`--all\` includes them.`, '');

if (ds.unresolved?.length) {
  lines.push('## Unresolved gates', '', '| flag | evidence behind it | examples |', '| --- | --- | --- |');
  for (const u of ds.unresolved) lines.push(`| \`${u.flag}\` | ${u.count} | ${u.examples.slice(0, 4).join('; ')} |`);
  lines.push('');
}

if (!equipmentOnly) {
  lines.push('## Materials that gate equipment', '', 'Sorted by how many equipment items need them through their crafting tree.', '', '| material | mod | guessed stage | why | rarity | used by | code paths seen |', '| --- | --- | --- | --- | --- | --- | --- |');
  for (const m of mats.sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name)).filter((m) => m.uses > 0)) {
    lines.push(`| ${m.name} \`${m.id}\` | ${modName.get(m.mod) ?? m.mod} | ${stageLabel(m.stage)} | ${why(m.src)} | ${m.rarity ?? ''} | ${m.uses} | ${fmtDrops(m.drops)} |`);
  }
  lines.push('');
}

lines.push('## Equipment with a guessed stage', '');
const byMod = new Map();
for (const it of equip) { let l = byMod.get(it.mod); if (!l) byMod.set(it.mod, (l = [])); l.push(it); }
for (const [mod, list] of [...byMod].sort((a, b) => b[1].length - a[1].length)) {
  lines.push(`### ${modName.get(mod) ?? mod} (${list.length})`, '', '| item | slot | guessed stage | why | rarity | code paths seen |', '| --- | --- | --- | --- | --- | --- |');
  for (const it of list.sort((a, b) => (a.stage ?? 99) - (b.stage ?? 99) || a.name.localeCompare(b.name))) {
    lines.push(`| ${it.name} \`${it.id}\` | ${it.slot}${it.class ? ` (${it.class})` : ''} | ${stageLabel(it.stage)} | ${why(it.stageSource)} | ${it.rarityName ?? it.rarity ?? ''} | ${fmtDrops(it.sources?.filter((s) => s.kind !== 'craft'))} |`);
  }
  lines.push('');
}

const out = new URL('../data/unknown-sources.md', import.meta.url);
writeFileSync(out, lines.join('\n'));
console.log(`${ds.unresolved?.length ?? 0} unresolved gates, ${equip.length} equipment items and ${mats.filter((m) => m.uses > 0).length} gating materials without a source → data/unknown-sources.md${all ? '' : ` (${skippedEquip + skippedMats} pre-boss commons skipped)`}`);
const top = [...byMod].sort((a, b) => b[1].length - a[1].length).slice(0, 8).map(([m, l]) => `${modName.get(m) ?? m} ${l.length}`).join(', ');
console.log(`by mod: ${top}`);
