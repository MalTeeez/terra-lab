#!/usr/bin/env node
/**
 * Cross-check the lab against the community class-setup guides.
 *
 *   node tools/guide-check.mjs                    # every tier and class, full report
 *   node tools/guide-check.mjs --cls rogue        # one class
 *   node tools/guide-check.mjs --tier pre-boss    # one tier (guide key, substring match)
 *   node tools/guide-check.mjs --pre              # pre-hardmode tiers only (the tuning set)
 *   node tools/guide-check.mjs --summary          # metrics only
 *   node tools/guide-check.mjs --why "Ashen Stalactite"   # the pick's DPS parts next to the lab's #1
 *   node tools/guide-check.mjs --why "Scourge of the Desert" --stage 4   # …for any weapon, at any stage
 *   node tools/guide-check.mjs --refresh          # re-parse the guides (tools/guides.mjs --refresh)
 *
 * The picks come from `data/guides.json` (written by `node tools/guides.mjs`). A pick the lab
 * stages later than the guide's tier ("LATE") is a lead, not a verdict: the guides order bosses by
 * difficulty while the lab follows BossChecklist's progression, and the miner's answer comes with
 * its evidence (`stageSource`). An item the lab ranks in a stage's top 5 that no guide lists until
 * two tiers later ("EARLY") is the other kind of lead — that is the item wrongly winning a stage.
 * Fix the miner or the model when the evidence is wrong; there is no override file.
 *
 * Support picks (`+`) are reported but left out of the weapon top-k metric: the guides list them
 * for what they add to the main weapon, so the model *should* rank them below it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { candidates, solveLoadout } from '../src/lib/solver.js';
import { indexDataset } from '../src/lib/dataset.js';
import { pieceScore, weaponDps } from '../src/lib/score.js';
import { buildGuides } from './guides.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const onlyCls = opt('--cls', null);
const onlyTier = opt('--tier', null);
const whyName = opt('--why', null);
const preOnly = flag('--pre');

const ds = indexDataset(JSON.parse(readFileSync(new URL('../data/dataset.json', import.meta.url), 'utf8')));
const guidesFile = new URL('../data/guides.json', import.meta.url);
const picksAll = flag('--refresh') || !existsSync(guidesFile)
  ? await buildGuides(ds, { refresh: flag('--refresh') })
  : JSON.parse(readFileSync(guidesFile, 'utf8')).picks;

const HEAD_WORDS = /\b(helmet|hat|mask|hood|headgear|helm|visage|cowl|crown|cap|facemask|head|circlet|garland|goggles|headpiece|tiara|veil|skull|plume)\b/i;
const PRE_HARDMODE = ds.stages.findIndex((s) => /Wall of Flesh/i.test(s.label));

// ---- rankings -----------------------------------------------------------------------------
/**
 * A summoner equips a minion *and* a sentry *and* a whip at once, so the three are not alternatives
 * and ranking one against the others is the same mistake as counting `+` support picks. The guides
 * put whips in the minion column, but that is a column of 209 minions and 19 whips — judged
 * together, the whips simply crowd the minions out. Each is ranked against its own kind, chosen by
 * what the item *is* rather than which column it was printed in.
 */
const SUMMON_KINDS = new Set(['minion', 'sentry', 'whip']);
/**
 * The guides label a pick with the slot it fills; the lab tags a weapon with what it is. They agree
 * where the names line up — except that the guides have no whip column, so a whip is filed under
 * `minion` (see SUMMON_KINDS).
 */
const MODE_ROLE = { spam: ['spam'], stealth: ['stealth'], minion: ['minion', 'whip'], sentry: ['sentry'] };
const statCtx = { conds: new Set(), uncertain: false, prefix: null, calibration: null, ds };
// ammo lives in its own table, not in `items` — give it the fields the report reads off a pick
const ammoById = new Map((ds.ammo ?? []).map((a) => [a.id, { ...a, slot: 'ammo', cls: 'ranged', stageLabel: ds.stages[a.stage]?.label ?? '?', stageSource: a.stageSource ?? { kind: 'unknown' } }]));
const rankCache = new Map();
function rankings(cls, stage) {
  const key = `${cls}@${stage}`;
  if (rankCache.has(key)) return rankCache.get(key);
  const lo = solveLoadout(ds, { cls, stage, slots: 6, reforge: 'none', conds: new Set(), uncertain: false });
  const pool = candidates(ds, { stage });
  const weapons = pool.filter((it) => it.slot === 'weapon' && it.cls === cls && (it.damage ?? 0) > 0)
    // the same context the app grades with: the solved loadout decides max stealth *and* the class
    // damage and crit the weapon is actually swung with
    .map((it) => ({ it, v: weaponDps(it, { ...statCtx, stage, stealthMax: lo.stealthMax, loadout: lo.bonus }) })).sort((a, b) => b.v.value - a.v.value);
  const sets = [lo.armor, ...lo.armorAlternatives].filter(Boolean);
  const accs = pool.filter((it) => it.slot === 'accessory').map((it) => ({ it, s: pieceScore(it, cls, ds.aliases).score })).sort((a, b) => b.s - a.s);
  const r = {
    lo, weapons, sets, accs,
    // A summoner equips a minion *and* a sentry *and* a whip at once, and the guides give each its
    // own column — so a sentry pick is ranked against sentries, not against the minions it is meant
    // to be used alongside. Same reasoning as leaving `+` support picks out of the metric.
    weaponRank: (id) => {
      const own = weapons.find((w) => w.it.id === id)?.v.arch;
      const kinds = SUMMON_KINDS.has(own) ? own : null;
      const list = kinds ? weapons.filter((w) => w.v.arch === kinds) : weapons;
      const i = list.findIndex((w) => w.it.id === id);
      return i < 0 ? null : { rank: i + 1, of: list.length, mode: list[i].v.mode, value: list[i].v.value, within: kinds };
    },
    // ammo is ranked inside its own kind: a rocket and a musket ball are not alternatives
    ammoRank: (id) => {
      const kind = lo.ammo.find((a) => a.item.id === id)?.kind;
      if (kind === undefined) return null;
      const list = lo.ammo.filter((a) => a.kind === kind);
      const i = list.findIndex((a) => a.item.id === id);
      return { rank: i + 1, of: list.length, value: list[i].value, within: list[i].kindName, gun: list[i].gun.name };
    },
    setRank: (head) => { const i = sets.findIndex((s) => s.head.item.id === head.id); return i < 0 ? null : i + 1; },
    accRank: (id) => { const i = accs.findIndex((a) => a.it.id === id); return i < 0 ? null : { rank: i + 1, of: accs.length }; },
  };
  rankCache.set(key, r);
  return r;
}

// ---- --why: one pick's arithmetic next to the lab's #1 --------------------------------------
if (whyName) {
  // a weapon no guide lists can still be asked about — `--why "X" --stage 4` — which is how an
  // in-game reading gets compared with the model's arithmetic
  const stageArg = opt('--stage', null);
  let hits = picksAll.filter((p) => p.name.toLowerCase() === whyName.toLowerCase() && p.kind === 'weapon');
  if (stageArg !== null) {
    const it = ds.items.find((x) => x.name.toLowerCase() === whyName.toLowerCase() && x.slot === 'weapon');
    if (!it) { console.error(`no weapon named "${whyName}"`); process.exit(1); }
    hits = [{ guide: 'ad hoc', tier: `stage ${stageArg}`, tierBoss: ds.stages[+stageArg].label, stage: +stageArg, cls: it.cls, id: it.id, name: it.name }];
  }
  if (!hits.length) { console.error(`no guide weapon pick named "${whyName}" (pass --stage N to ask anyway)`); process.exit(1); }
  const show = (label, it, v) => {
    console.log(`\n${label}: ${it.name} (${it.id}, stage ${it.stageLabel}, ${it.cls})  →  ${Math.round(v.value)} ${v.kind}${v.mode ? ` [${v.mode}]` : ''}`);
    for (const p of v.parts) console.log(`   ${p.label.padEnd(48)} ${p.mul !== undefined ? `×${p.mul}${p.unit ?? ''}` : `= ${p.value}`}`);
    if (v.stealthParts) { console.log('   -- stealth --'); for (const p of v.stealthParts) console.log(`   ${p.label.padEnd(48)} ${p.mul !== undefined ? `×${p.mul}` : `= ${p.value}`}`); }
  };
  for (const p of hits) {
    if (onlyCls && p.cls !== onlyCls) continue;
    if (!p.id) { console.log(`\n== ${p.guide} ${p.tier} ${p.cls}: not in the dataset`); continue; }
    const it = ds.byId.get(p.id);
    const R = rankings(p.cls, p.stage);
    const r = R.weaponRank(p.id, p.role);
    console.log(`\n=== ${p.guide} · ${p.tier} → ${p.tierBoss} (stage ${p.stage} ${ds.stages[p.stage].label}) · ${p.cls}${p.marks ? ` · ${p.marks.join(' ')}` : ''}${p.note ? ` · ${p.note}` : ''}`);
    console.log(`    lab rank: ${r ? `#${r.rank}/${r.of}` : it.stage > p.stage ? `LATE (${it.stageLabel}, ${it.stageSource.kind})` : 'unranked'}`);
    console.log(`    loadout carries +${Math.round(R.lo.bonus.damage * 100)}% ${p.cls} damage, +${Math.round(R.lo.bonus.crit)} crit (${R.lo.armor?.head.item.name})`);
    show('pick', it, weaponDps(it, { ...statCtx, stage: p.stage, stealthMax: R.lo.stealthMax, loadout: R.lo.bonus }));
    const top = R.weapons[0];
    if (top && top.it.id !== p.id) show('lab #1', top.it, top.v);
  }
  process.exit(0);
}

// ---- report --------------------------------------------------------------------------------
const inScope = (p) => (!onlyCls || p.cls === onlyCls) && (!onlyTier || p.tier.toLowerCase().includes(onlyTier.toLowerCase())) && (!preOnly || p.stage < PRE_HARDMODE) && ds.classList.includes(p.cls);
const picks = picksAll.filter(inScope);
const tiers = [];
for (const p of picks) { const k = `${p.guide}|${p.tier}`; if (!tiers.includes(k)) tiers.push(k); }
tiers.sort((a, b) => (picks.find((p) => `${p.guide}|${p.tier}` === a).stage - picks.find((p) => `${p.guide}|${p.tier}` === b).stage) || a.localeCompare(b));

const zero = () => ({ total: 0, missing: 0, late: 0, weapons: 0, weaponLate: 0, weaponTop3: 0, weaponTop8: 0, poolSum: 0, rrSum: 0, sets: 0, setTop1: 0, setTop5: 0, accs: 0, accTop6: 0, ammo: 0, ammoTop3: 0, modeAgree: 0, modeTotal: 0, support: 0, supportTop3: 0, early: 0, unlisted: 0 });
const summary = zero();
const byClass = new Map();
const byGuideCls = new Map(); // `guide|cls` — the two guides disagree with each other, so keep them apart
const byTier = new Map();
const bump = (k, n = 1) => { summary[k] += n; for (const m of [byClass.get(curCls), byTier.get(curTier), byGuideCls.get(curTier.split('|')[0] + '|' + curCls)]) if (m) m[k] += n; };
let curCls = null;
let curTier = null;
const lines = [];
const earlyLeads = [];
const unlisted = new Map(); // `${cls}|${id}` → a weapon holding top-8 slots that no guide ever names
const lateLeads = new Map();

// what each guide lists per class and stage, for the EARLY check
const listedAt = new Map(); // `${cls}|${id}` → earliest guide stage
for (const p of picksAll) if (p.id) { const k = `${p.cls}|${p.id}`; const s = listedAt.get(k); if (s === undefined || p.stage < s) listedAt.set(k, p.stage); }

for (const key of tiers) {
  const group = picks.filter((p) => `${p.guide}|${p.tier}` === key);
  curTier = key;
  if (!byTier.has(key)) byTier.set(key, zero());
  for (const cls of [...new Set(group.map((p) => p.cls))]) {
    curCls = cls;
    if (!byClass.has(cls)) byClass.set(cls, zero());
    if (!byGuideCls.has(curTier.split('|')[0] + '|' + cls)) byGuideCls.set(curTier.split('|')[0] + '|' + cls, zero());
    const list = group.filter((p) => p.cls === cls);
    const stage = list[0].stage;
    lines.push(`\n## ${list[0].guide} · ${list[0].tier} → ${list[0].tierBoss} (stage ${stage} ${ds.stages[stage].label}) · ${cls}`);
    const R = rankings(cls, stage);
    const seen = new Set();
    for (const p of list) {
      if (p.kind === 'buff') continue; // buffs and potions are not modelled
      const k = `${p.kind}|${p.name.toLowerCase()}`;
      if (seen.has(k)) continue;
      seen.add(k);
      bump('total');
      const marks = (p.marks ?? []).join('');
      const support = p.role === 'support' || marks.includes('+');
      const it = p.id ? ds.byId.get(p.id) ?? ammoById.get(p.id) : null;
      if (!it) { bump('missing'); lines.push(`  ✗ ${p.kind.padEnd(9)} ${p.name.padEnd(30)} not in dataset`); continue; }
      const late = it.stage === null || it.stage === undefined ? null : it.stage > stage;
      if (late) { bump('late'); const prev = lateLeads.get(it.id); lateLeads.set(it.id, { id: it.id, name: it.name, want: Math.min(prev?.want ?? 99, stage), has: it.stage, src: it.stageSource }); }
      const stageNote = late ? `LATE: lab says ${it.stageLabel} (${it.stageSource.kind}${it.stageSource.from ? ': ' + it.stageSource.from.join(', ') : it.stageSource.boss ? ': ' + it.stageSource.boss : ''})` : late === null ? 'stage unknown' : '';
      let rank = '';
      if (p.kind === 'weapon') {
        const r = late ? null : R.weaponRank(it.id, p.role);
        if (support) { bump('support'); if (r && r.rank <= 3) bump('supportTop3'); }
        else { bump('weapons'); if (late) bump('weaponLate'); }
        if (r) {
          rank = `#${r.rank}/${r.of}${r.within ? ` ${r.within}s` : ''} ${r.mode ?? ''} ${Math.round(r.value)}/s`;
          if (!support) { if (r.rank <= 3) bump('weaponTop3'); if (r.rank <= 8) bump('weaponTop8'); bump('rrSum', 1 / r.rank); }
          if (!support) bump('poolSum', r.of); // how long the list the pick had to beat was
          if (MODE_ROLE[p.role] && r.mode) { bump('modeTotal'); if (MODE_ROLE[p.role].includes(r.mode)) bump('modeAgree'); }
        } else if (!late) rank = it.cls !== cls ? `class ${it.cls}` : 'unranked';
      } else if (p.kind === 'ammo') {
        bump('ammo');
        const r = late ? null : R.ammoRank(it.id);
        if (r) { rank = `#${r.rank}/${r.of} ${r.within}s ${Math.round(r.value)}/s in a ${r.gun}`; if (r.rank <= 3) bump('ammoTop3'); } else if (!late) rank = 'no gun uses it';
      } else if (p.kind === 'armor' || p.armor) {
        bump('sets');
        const r = late ? null : R.setRank(it);
        if (r) { rank = `set #${r}`; if (r === 1) bump('setTop1'); if (r <= 5) bump('setTop5'); } else if (!late) rank = 'not in top 5 sets';
      } else if (p.kind === 'accessory') {
        bump('accs');
        const r = late ? null : R.accRank(it.id);
        if (r) { rank = `#${r.rank}/${r.of}`; if (r.rank <= 6) bump('accTop6'); } else if (!late) rank = 'no class value';
      }
      const tag = `${marks ? ` ${marks}` : ''}${p.with ? ` (with ${p.with})` : ''}`;
      lines.push(`  ${late ? '⚠' : support ? '+' : '·'} ${p.kind.padEnd(9)} ${(p.name + tag).padEnd(32)} ${rank.padEnd(26)} ${stageNote}${p.note && !late ? `  — ${p.note}` : ''}`);
    }
    // EARLY: the lab's top 5 weapons that no guide lists for this class until two tiers later
    for (const w of R.weapons.slice(0, 5)) {
      const first = listedAt.get(`${cls}|${w.it.id}`);
      if (first === undefined || first <= stage + 1) continue;
      const tiersLater = new Set(picksAll.filter((p) => p.cls === cls && p.id === w.it.id).map((p) => p.tier));
      bump('early');
      earlyLeads.push({ cls, stage, name: w.it.name, id: w.it.id, value: w.v.value, first, tiers: [...tiersLater] });
      lines.push(`  ! EARLY    ${w.it.name.padEnd(32)} lab #${R.weapons.indexOf(w) + 1} at stage ${stage}, guides list it at stage ${first} (${[...tiersLater].join(', ')})`);
    }
    // UNLISTED: the top-8 slots held by weapons neither guide names for this class at any tier.
    // EARLY cannot see these — it needs a tier to compare against — yet they are what actually
    // keeps the guides' picks out of the top 8, so they are the worklist.
    R.weapons.slice(0, 8).forEach((w, i) => {
      if (listedAt.has(`${cls}|${w.it.id}`)) return;
      bump('unlisted');
      const u = unlisted.get(`${cls}|${w.it.id}`) ?? { cls, name: w.it.name, mod: w.it.mod, stage: w.it.stage, src: w.it.stageSource, n: 0, best: 99, value: 0 };
      u.n++; u.best = Math.min(u.best, i + 1); u.value = Math.max(u.value, w.v.value);
      unlisted.set(`${cls}|${w.it.id}`, u);
    });
    lines.push(`  lab top weapons: ${R.weapons.slice(0, 5).map((w) => `${w.it.name}${w.v.mode ? ` [${w.v.mode}]` : ''} ${Math.round(w.v.value)}`).join(', ')}`);
    lines.push(`  lab armor: ${R.sets.slice(0, 3).map((s) => s.head.item.name.replace(HEAD_WORDS, '').trim()).join(' > ')}`);
  }
}

if (!flag('--summary')) console.log(lines.join('\n'));

const pctOf = (a, b) => (b ? ` (${Math.round((a / b) * 100)}%)` : '');
const row = (label, s) => { const n = s.weapons - s.weaponLate; return `  ${label.padEnd(22)} weapons ${String(s.weapons).padStart(4)} (${String(n).padStart(4)} rankable): top-3 ${String(s.weaponTop3).padStart(4)}${pctOf(s.weaponTop3, n).padEnd(7)} top-8 ${String(s.weaponTop8).padStart(4)}${pctOf(s.weaponTop8, n).padEnd(7)} MRR ${(n ? s.rrSum / n : 0).toFixed(3)}  vs ${n ? Math.round(s.poolSum / n) : 0} rivals  mode ${s.modeAgree}/${s.modeTotal}  staged late ${s.weaponLate}  early ${s.early}  unlisted ${s.unlisted}`; };

console.log(`\n== ${summary.total} picks, ${summary.missing} missing from dataset, ${summary.late} staged later than the guide, ${summary.early} early leads`);
console.log(`   weapons ${summary.weapons}: top-3 ${summary.weaponTop3}, top-8 ${summary.weaponTop8}, MRR ${(summary.weapons ? summary.rrSum / summary.weapons : 0).toFixed(3)}; stealth/spam grade agrees ${summary.modeAgree}/${summary.modeTotal}`);
console.log(`   support picks ${summary.support}: ${summary.supportTop3} in the top 3 (a warning, not a success)`);
console.log(`   armor sets ${summary.sets}: lab's #1 ${summary.setTop1}, in top 5 ${summary.setTop5}`);
console.log(`   accessories ${summary.accs}: in top 6 ${summary.accTop6}`);
console.log(`   ammo ${summary.ammo}: ${summary.ammoTop3} in the top 3 of their kind`);
console.log('\n== per guide x class  (each guide judged on its own picks)');
for (const guide of [...new Set([...byGuideCls.keys()].map((k) => k.split('|')[0]))]) {
  const rows = [...byGuideCls].filter(([k]) => k.split('|')[0] === guide).sort((a, b) => b[1].weapons - a[1].weapons);
  const tot = rows.reduce((t, [, v]) => { for (const k of Object.keys(t)) t[k] += v[k]; return t; }, zero());
  console.log('');
  console.log('  ' + guide);
  for (const [k, v] of rows) console.log(' ' + row(k.split('|')[1], v));
  console.log(' ' + row('- all classes -', tot));
}
console.log('\n== per class');
for (const [cls, s] of [...byClass].sort((a, b) => b[1].weapons - a[1].weapons)) console.log(row(cls, s));
console.log('\n== per tier');
for (const k of tiers) console.log(row(k, byTier.get(k)));

if (lateLeads.size) {
  console.log(`\n== LATE leads (${lateLeads.size}): the lab stages these after the guide's tier`);
  for (const l of [...lateLeads.values()].sort((a, b) => a.has - b.has).slice(0, 40)) {
    console.log(`  ${l.name.padEnd(32)} guide ${String(l.want).padStart(3)} → lab ${String(l.has).padStart(3)}  ${l.src.kind}${l.src.from ? ': ' + l.src.from.join(', ') : l.src.boss ? ': ' + l.src.boss : ''}`);
  }
}
if (unlisted.size) {
  const slots = [...unlisted.values()].reduce((n, u) => n + u.n, 0);
  console.log(`
== UNLISTED (${unlisted.size} weapons holding ${slots} top-8 slots): no guide names these for the class at any tier`);
  console.log('   Each one costs a slot the metric wants a guide pick in. A staging source that cannot be right is a bug;');
  console.log('   the rest are the guides not enumerating the pool, and are the ceiling on top-8.');
  for (const u of [...unlisted.values()].sort((a, b) => b.n - a.n || a.best - b.best).slice(0, 30)) {
    const src = u.src ? `${u.src.kind}${u.src.from ? ': ' + u.src.from.join(', ') : u.src.via ? ': ' + u.src.via : ''}` : '?';
    console.log(`  ${u.cls.padEnd(8)} ${u.name.padEnd(30)} ${String(u.n).padStart(2)} tiers, best #${u.best}, ${String(Math.round(u.value)).padStart(5)}/s  stage ${String(u.stage).padStart(2)} ${src}`);
  }
}
if (earlyLeads.length) {
  console.log(`\n== EARLY leads (${earlyLeads.length}): the lab's top 5 at a stage the guides do not list them for`);
  const seen = new Set();
  for (const e of earlyLeads.sort((a, b) => b.first - b.stage - (a.first - a.stage))) {
    if (seen.has(`${e.cls}|${e.id}`)) continue;
    seen.add(`${e.cls}|${e.id}`);
    if (seen.size > 40) break;
    console.log(`  ${e.cls.padEnd(8)} ${e.name.padEnd(32)} lab stage ${String(e.stage).padStart(3)} @ ${String(Math.round(e.value)).padStart(6)}/s  →  guides at ${e.first} (${e.tiers.join(', ')})`);
  }
}
