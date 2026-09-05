#!/usr/bin/env node
/**
 * Every weapon's Real DPS, frozen, so a refactor can prove it changed nothing.
 *
 *   node tools/dps-snapshot.mjs data/dps-parity.json          # write the snapshot
 *   node tools/dps-snapshot.mjs data/dps-parity.json --check  # compare the model against it
 *   node tools/dps-snapshot.mjs data/dps-parity.json --check --top 40
 *
 * The phase-model rework replaces how a weapon's hits are counted, and its first step is meant to
 * reproduce the current answers exactly. "Exactly" needs something to be exact against: the guide
 * metrics are far too coarse — a rewrite could move a thousand weapons and leave top-3 unchanged.
 *
 * Every weapon is graded at its own stage in a fixed, loadout-free context, in all three target
 * modes. No solver, no gear, no reforge: the point is the weapon's own arithmetic, so nothing
 * outside `dps.js` can move a number here. `mode` and the number of `parts` ride along, because a
 * refactor that keeps the total and loses the explanation has still broken something.
 *
 * A difference is not a failure — the bug fixes further down the plan are *supposed* to move
 * numbers. It is a list of what moved, to be read and explained, then re-frozen.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { indexDataset } from '../src/lib/dataset.js';
import { weaponDps } from '../src/lib/score.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const check = args.includes('--check');
const top = Number(args[args.indexOf('--top') + 1]) || 25;
if (!file) { console.error('usage: node tools/dps-snapshot.mjs <file> [--check] [--top N]'); process.exit(2); }

const raw = readFileSync(new URL('../data/dataset.json', import.meta.url));
// The snapshot is only meaningful against the dataset it was taken from. A re-mine moves weapons
// for reasons that have nothing to do with the model, and without this the diff looks like a
// scoring regression — which is exactly what it looked like the first time it happened.
const fingerprint = createHash('sha1').update(raw).digest('hex').slice(0, 12);
const ds = indexDataset(JSON.parse(raw.toString('utf8')));
const MODES = ['auto', 'single', 'multi'];

/** The one context every weapon is graded in: its own stage, no gear, nothing else varying. */
const ctxFor = (it, targets) => ({
  conds: new Set(), uncertain: false, prefix: null, calibration: null,
  ds, stage: it.stage ?? 0, targets,
});

const r = (v) => Math.round((v ?? 0) * 100) / 100;
const weapons = ds.items.filter((it) => it.slot === 'weapon' && (it.damage ?? 0) > 0).sort((a, b) => a.id.localeCompare(b.id));

const now = {};
for (const it of weapons) {
  const graded = MODES.map((m) => weaponDps(it, ctxFor(it, m)));
  now[it.id] = [...graded.map((g) => r(g.value)), graded[0].mode ?? '', graded[0].parts.length];
}

if (!check) {
  writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), dataset: fingerprint, modes: MODES, weapons: now }, null, 0));
  const nz = weapons.filter((it) => now[it.id][0] > 0).length;
  console.log(`${weapons.length} weapons (${nz} scoring above zero) × ${MODES.length} target modes → ${file}  [dataset ${fingerprint}]`);
  process.exit(0);
}

// ---- compare ---------------------------------------------------------------------------------
const snap = JSON.parse(readFileSync(file, 'utf8'));
const was = snap.weapons;
if (snap.dataset && snap.dataset !== fingerprint) {
  console.log(`! the dataset has been re-mined since this snapshot (${snap.dataset} → ${fingerprint}).`);
  console.log('  Weapons will differ for reasons that are nothing to do with the model. Re-freeze first.\n');
}
const moved = [];
let same = 0;
for (const id of new Set([...Object.keys(was), ...Object.keys(now)])) {
  const a = was[id];
  const b = now[id];
  if (!a) { moved.push({ id, why: 'new weapon', a: null, b }); continue; }
  if (!b) { moved.push({ id, why: 'gone from the dataset', a, b: null }); continue; }
  const values = MODES.some((_, i) => a[i] !== b[i]);
  if (!values && a[3] === b[3] && a[4] === b[4]) { same++; continue; }
  const rel = Math.max(...MODES.map((_, i) => Math.abs((b[i] - a[i]) / Math.max(1, Math.abs(a[i])))));
  moved.push({ id, why: values ? 'value' : a[3] !== b[3] ? `mode ${a[3]} → ${b[3]}` : `parts ${a[4]} → ${b[4]}`, rel, a, b });
}

const name = (id) => ds.byId.get(id)?.name ?? id;
console.log(`${same} weapons unchanged, ${moved.length} moved`);
if (!moved.length) process.exit(0);
const byKind = moved.reduce((m, x) => m.set(x.why.split(' ')[0], (m.get(x.why.split(' ')[0]) ?? 0) + 1), new Map());
console.log(`  ${[...byKind].map(([k, n]) => `${k} ${n}`).join(', ')}`);
for (const m of moved.sort((x, y) => (y.rel ?? 0) - (x.rel ?? 0)).slice(0, top)) {
  const fmt = (v) => (v ? MODES.map((k, i) => `${k[0]}${v[i]}`).join(' ') : '—');
  console.log(`  ${name(m.id).padEnd(34)} ${m.why.padEnd(18)} ${fmt(m.a)}  →  ${fmt(m.b)}`);
}
process.exitCode = 1;
