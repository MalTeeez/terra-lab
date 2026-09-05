#!/usr/bin/env node
/**
 * What the model is guessing, and which weapons the guess is load-bearing for.
 *
 *   node tools/unresolved-phases.mjs             # the worklist, ranked by how much score rides on it
 *   node tools/unresolved-phases.mjs --top 20    # more examples per reason
 *   node tools/unresolved-phases.mjs --md data/unresolved-phases.md
 *
 * The phase records say what a weapon does and how good the evidence for each number is. This turns
 * that into the miner's list: every place a blanket constant is standing in for a fact nobody read,
 * ranked by the DPS of the weapons that depend on it — because an unread spawn rate on a weapon
 * scoring 12/s is not worth an afternoon and one on a weapon holding a stage's top slot is.
 *
 * A reason listed here is not a bug. It is a number the model had to invent, and the honest place
 * to look when a weapon's score cannot be explained.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { indexDataset } from '../src/lib/dataset.js';
import { ARCHETYPE, CHILD_CAP, DMG_MUL_MAX } from '../src/lib/dps.js';
import { deliveryPhases, spawnPhases } from '../src/lib/phases.js';
import { weaponDps } from '../src/lib/score.js';

const args = process.argv.slice(2);
const top = Number(args[args.indexOf('--top') + 1]) || 12;
const mdOut = args.includes('--md') ? args[args.indexOf('--md') + 1] : null;

const ds = indexDataset(JSON.parse(readFileSync(new URL('../data/dataset.json', import.meta.url), 'utf8')));

/**
 * Every reason the model is working from something other than a mined fact. Each says what is
 * missing and what reading it would replace, because a worklist without the second is a wish list.
 */
const REASONS = {
  spawnClock: { label: 'child spawns on a clock nobody read', fixes: 'a real rate instead of "at most one extra hit"' },
  spawnShare: { label: "child's damage share unread", fixes: `the median guess of ${0.5} of the parent's damage` },
  childCap: { label: 'spawned projectiles hit the blanket cap', fixes: `the cap of +${CHILD_CAP} hits, which is doing the scoring here` },
  branchMul: { label: `damage multiplier over ×${DMG_MUL_MAX} read as a branch`, fixes: 'a probability, instead of dropping the multiplier' },
  blanketUptime: { label: 'archetype uptime constant', fixes: 'lifetime, cooldown and max-concurrent evidence' },
  noContactClock: { label: 'contact weapon with no hit cooldown of its own', fixes: "the player's 10-tick window standing in for the projectile's" },
  negativeLocal: { label: 'summon whose hit cooldown is negative', fixes: '"hits once, ever" read as a rate — this one is a bug, not a gap' },
  textGate: { label: 'gate read from the tooltip, not the code', fixes: 'the AI timer, link counter or hit counter the interpreter did not follow' },
};

const found = new Map(Object.keys(REASONS).map((k) => [k, []]));
const ctx = (it) => ({ conds: new Set(), uncertain: false, prefix: null, calibration: null, ds, stage: it.stage ?? 0, targets: 'auto' });

for (const it of ds.items) {
  if (it.slot !== 'weapon' || !(it.damage > 0)) continue;
  const graded = weaponDps(it, ctx(it));
  const value = graded.value ?? 0;
  const arch = graded.arch;
  const hit = (reason, detail) => found.get(reason).push({ id: it.id, name: it.name, mod: it.mod, arch, value, detail });

  const primaryId = it.shoot ?? null;
  const { phases } = deliveryPhases(it.fire ?? null, { variant: 'spam', primaryId });
  for (const ph of phases) {
    if (ph.dmgMul > DMG_MUL_MAX) hit('branchMul', `${ph.id} ×${ph.dmgMul}`);
    // what that delivery spawns in turn
    for (const kid of spawnPhases(ds.projectiles?.[ph.projId], { variant: 'spam', parentId: ph.projId })) {
      if (kid.trigger === 'timer') hit('spawnClock', `${kid.projId ?? '?'} from ${ph.projId ?? 'the default shot'}`);
      if (kid.dmgMul === null && kid.dmgAbs === null) hit('spawnShare', `${kid.projId ?? '?'}`);
      if (kid.dmgMul > DMG_MUL_MAX) hit('branchMul', `${kid.projId} ×${kid.dmgMul}`);
    }
  }
  // the cap is visible in the arithmetic the card prints, which is the honest test of whether it
  // is load-bearing for this weapon rather than merely present
  if (graded.parts?.some((p) => /capped at \+/.test(p.label ?? ''))) hit('childCap', '');
  const text = (graded.phases ?? []).filter((p) => p.confidence === 'text');
  if (text.length) hit('textGate', text.map((p) => [p.interval && `tick ${p.interval}`, p.maxActive && `max ${p.maxActive}`, p.threshold && `every ${p.threshold} hits`].filter(Boolean).join(', ')).join('; '));

  const up = ARCHETYPE[arch]?.uptime;
  if (up !== undefined && up < 1) hit('blanketUptime', `${arch} ${Math.round(up * 100)}%`);

  const p = ds.projectiles?.[primaryId];
  if (ARCHETYPE[arch]?.cycle === 'contact' && p && !(p.local > 0) && !(p.local < 0)) hit('noContactClock', arch);
  if ((arch === 'minion' || arch === 'sentry') && p?.local < 0) hit('negativeLocal', `local ${p.local}`);
}

// ---- report ----------------------------------------------------------------------------------
const lines = [];
const say = (s = '') => { lines.push(s); console.log(s); };
const dedup = (rows) => { const m = new Map(); for (const r of rows) if (!m.has(r.id)) m.set(r.id, r); return [...m.values()]; };

const ranked = [...found].map(([k, rows]) => [k, dedup(rows)]).sort((a, b) => b[1].length - a[1].length);
say(`# What the model is guessing\n`);
say(`Generated by \`node tools/unresolved-phases.mjs\`. Each row is a number the model invented because`);
say(`the miner has not read the real one. Ranked inside each reason by the weapon's own DPS: the same`);
say(`gap matters far more on a weapon holding a stage's top slot than on one scoring 12/s.\n`);
for (const [k, rows] of ranked) {
  if (!rows.length) continue;
  const carrying = rows.reduce((n, r) => n + (r.value > 0 ? 1 : 0), 0);
  say(`## ${REASONS[k].label} — ${rows.length} weapons`);
  say(`Stands in for: ${REASONS[k].fixes}. ${carrying} of them score above zero.\n`);
  say('| weapon | mod | archetype | DPS | detail |');
  say('| --- | --- | --- | --- | --- |');
  for (const r of rows.sort((a, b) => b.value - a.value).slice(0, top)) {
    say(`| ${r.name} | ${r.mod} | ${r.arch ?? '?'} | ${Math.round(r.value)} | ${r.detail} |`);
  }
  say('');
}
if (mdOut) { writeFileSync(mdOut, lines.join('\n')); console.log(`→ ${mdOut}`); }
