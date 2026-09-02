#!/usr/bin/env node
/**
 * Cross-check the lab against the community class-setup guides.
 *
 *   node tools/guide-check.mjs                 # both guides, all tiers, all classes
 *   node tools/guide-check.mjs --cls rogue     # one class
 *   node tools/guide-check.mjs --refresh       # re-download the wikitext (cached in data/guides/)
 *   node tools/guide-check.mjs --json          # also write data/guides.json (normalised guide picks)
 *   node tools/guide-check.mjs --write-overrides
 *        write miner/stage/guide-overrides.json: every guide pick the lab stages later than the
 *        guide's tier, pinned to that tier (the guides are play-tested; enemy drops, chests and
 *        shops leave no evidence in code). Re-run `bun run mine` afterwards.
 *
 * Sources
 *   Calamity:  https://calamitymod.wiki.gg/wiki/Guide:Class_setups  (Cargo table `ClassSetups`)
 *   Modpack:   https://terrariamods.wiki.gg/wiki/Infernal_Eclipse_of_Ragnarok/Guide:Class_setups/Pre-Hardmode
 *              (one template per tier: Template:Infernal_Eclipse_of_Ragnarok/Guide_Pre-Boss, …)
 *
 * For every recommended weapon / armor set / accessory the report says whether the dataset has
 * it, whether the lab stages it no later than the guide's tier, and where the lab ranks it
 * among that class's options at that stage. Tiers map to the stage just before the named boss.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { candidates, solveLoadout } from '../src/lib/solver.js';
import { indexDataset } from '../src/lib/dataset.js';
import { pieceScore, weaponDps } from '../src/lib/score.js';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const onlyCls = opt('--cls', null);
const cacheDir = new URL('../data/guides/', import.meta.url);
mkdirSync(cacheDir, { recursive: true });
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

async function cached(name, url) {
  const file = new URL(name, cacheDir);
  if (!flag('--refresh') && existsSync(file)) return readFileSync(file, 'utf8');
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const text = await res.text();
  writeFileSync(file, text);
  return text;
}

// ---- Calamity: Cargo table ------------------------------------------------------------------
const CAL_TIERS = { 'pre-boss': /^Pre-boss$/i, 'pre-evil1': /Eater of Worlds|Brain of Cthulhu/i, 'pre-evil2': /Hive Mind|Perforator/i, 'pre-skeletron': /^Skeletron$/i, 'pre-wof': /Wall of Flesh/i };
const CAL_TYPES = { weapon: 'weapon', weaponSpam: 'weapon', weaponStealth: 'weapon', weaponSummon: 'weapon', minions: 'weapon', sentries: 'weapon', armor: 'armor', accessoryOffense: 'accessory', accessoryDefense: 'accessory', accessoryGeneral: 'accessory', accessoryMobility: 'accessory', accessoryMobilityPrimary: 'accessory', accessoryStealth: 'accessory', accessorySpam: 'accessory' };
const linkName = (html) => { const m = [...html.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].filter((x) => !/^File:/i.test(x[1])); return m.length ? m[m.length - 1][1].trim() : null; };

async function calamityGuide() {
  const rows = [];
  for (let offset = 0; offset < 5000; offset += 500) {
    const text = await cached(`calamity-classsetups-${offset}.json`, `https://calamitymod.wiki.gg/api.php?action=cargoquery&tables=ClassSetups&fields=item,class,progression,type&limit=500&offset=${offset}&format=json`);
    const j = JSON.parse(text);
    const page = (j.cargoquery ?? []).map((x) => x.title);
    rows.push(...page);
    if (page.length < 500) break;
  }
  const picks = [];
  for (const r of rows) {
    if (!CAL_TIERS[r.progression] || !CAL_TYPES[r.type]) continue;
    const name = linkName(r.item ?? '');
    if (!name) continue;
    const mode = r.type === 'weaponSpam' ? 'spam' : r.type === 'weaponStealth' ? 'stealth' : undefined;
    const classes = r.class === 'all' ? ['melee', 'ranged', 'magic', 'summon', 'rogue'] : r.class === 'all-but-summoner' ? ['melee', 'ranged', 'magic', 'rogue'] : [r.class];
    for (const cls of classes) picks.push({ guide: 'calamity', tier: r.progression, cls, kind: CAL_TYPES[r.type], name: name.replace(/ armor$/i, ''), armor: CAL_TYPES[r.type] === 'armor' || /armor$/i.test(name), mode });
  }
  return { picks, tiers: CAL_TIERS };
}

// ---- Infernal Eclipse of Ragnarok: guide templates ------------------------------------------
const IEOR_TIERS = { 'Pre-Boss': /^Pre-boss$/i, 'Pre-Evil': /Eater of Worlds|Brain of Cthulhu/i, 'Pre-Evil_2': /Hive Mind|Perforator/i, 'Pre-Skeletron': /^Skeletron$/i, 'Pre-Slime_God': /Slime God/i, 'Pre-Wall_of_Flesh': /Wall of Flesh/i };

async function ieorGuide() {
  const picks = [];
  for (const tier of Object.keys(IEOR_TIERS)) {
    const text = await cached(`ieor-${tier}.txt`, `https://terrariamods.wiki.gg/index.php?title=Template:Infernal_Eclipse_of_Ragnarok/Guide_${tier}&action=raw`);
    const tabs = text.split(/\|-\|/).slice(1);
    for (const tab of tabs) {
      const cls = tab.match(/^\s*([A-Za-z]+)=/)?.[1]?.toLowerCase();
      if (!cls) continue;
      const clsKey = { melee: 'melee', ranged: 'ranged', magic: 'magic', summoner: 'summon', summon: 'summon', rogue: 'rogue', bard: 'bard', healer: 'healer', thrower: 'thrower' }[cls] ?? cls;
      // outer boxes: title = [[Weapons]] / [[Armor]] / [[Accessories]] / [[Buffs]]…
      const boxes = tab.split(/\{\{infocard\/box \| style = width: 350px \| title = /).slice(1);
      for (const box of boxes) {
        const kind = /^\[\[Weapons\]\]/.test(box) ? 'weapon' : /^\[\[Armor\]\]/.test(box) ? 'armor' : /^\[\[Accessories\]\]/.test(box) ? 'accessory' : null;
        if (!kind) continue;
        let mode;
        for (const m of box.matchAll(/'''(Spam|Stealth)[^']*'''|\{\{[Ii]tem\|([^}|]+)(?:\|[^}]*)?\}\}/g)) {
          if (m[1]) { mode = m[1].toLowerCase(); continue; }
          let name = m[2].trim();
          name = name.replace(/^#/, '').replace(/@.*$/, '').replace(/\s*\((Thorium|Calamity|SOTS)\)$/i, '');
          const armor = /armor$/i.test(name) || kind === 'armor';
          picks.push({ guide: 'ieor', tier, cls: clsKey, kind, name: name.replace(/ armor$/i, ''), armor, mode: kind === 'weapon' ? mode : undefined });
        }
      }
    }
  }
  return { picks, tiers: IEOR_TIERS };
}

// ---- matching against the dataset ------------------------------------------------------------
const ds = indexDataset(JSON.parse(readFileSync(new URL('../data/dataset.json', import.meta.url), 'utf8')));
const byName = new Map();
for (const it of ds.items) { const k = it.name.toLowerCase().replace(/[‘’]/g, "'"); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(it); }
const HEAD_WORDS = /\b(helmet|hat|mask|hood|headgear|helm|visage|cowl|crown|cap|facemask|head|circlet|garland|goggles|headpiece|tiara|veil|skull|plume)\b/i;

const norm = (s) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
function findItem(pick) {
  const n = norm(pick.name);
  if (pick.armor) {
    const heads = ds.items.filter((it) => it.slot === 'head' && it.setItems?.length && norm(it.name).startsWith(n + ' ') && HEAD_WORDS.test(it.name.slice(n.length)));
    if (heads.length) return heads.sort((a, b) => (a.stage ?? 99) - (b.stage ?? 99))[0];
    const any = ds.items.filter((it) => it.slot === 'head' && it.setItems?.length && norm(it.name).startsWith(n));
    if (any[0]) return any[0];
    // single pieces (Gi, Wizard Hat, Diamond Robe): any armor slot by exact name
    const piece = (byName.get(n) ?? []).find((it) => it.slot === 'head' || it.slot === 'body' || it.slot === 'legs');
    return piece ?? null;
  }
  const exact = byName.get(n);
  if (exact) return exact.find((it) => pick.kind === 'weapon' ? it.slot === 'weapon' : pick.kind === 'accessory' ? it.slot === 'accessory' : true) ?? exact[0];
  return null;
}

function tierStage(re) {
  if (/Pre-boss/i.test(re.source)) return 0;
  const idx = ds.stages.findIndex((s) => re.test(s.label));
  return idx > 0 ? idx - 1 : null;
}

const statCtx = { conds: new Set(), uncertain: false, prefix: null, calibration: null, ds };
const rankCache = new Map();
function rankings(cls, stage) {
  const key = `${cls}@${stage}`;
  if (rankCache.has(key)) return rankCache.get(key);
  const lo = solveLoadout(ds, { cls, stage, slots: 6, reforge: 'none', conds: new Set(), uncertain: false });
  const pool = candidates(ds, { stage });
  const weapons = pool.filter((it) => it.slot === 'weapon' && it.cls === cls && (it.damage ?? 0) > 0)
    .map((it) => ({ it, v: weaponDps(it, { ...statCtx, stage, stealthMax: lo.stealthMax }) })).sort((a, b) => b.v.value - a.v.value);
  const sets = [lo.armor, ...lo.armorAlternatives].filter(Boolean);
  const accs = pool.filter((it) => it.slot === 'accessory').map((it) => ({ it, s: pieceScore(it, cls, ds.aliases).score })).sort((a, b) => b.s - a.s);
  const r = { lo, weapons, sets, accs, weaponRank: (id) => { const i = weapons.findIndex((w) => w.it.id === id); return i < 0 ? null : { rank: i + 1, of: weapons.length, mode: weapons[i].v.mode, value: weapons[i].v.value }; }, setRank: (head) => { const i = sets.findIndex((s) => s.head.item.id === head.id); return i < 0 ? null : i + 1; }, accRank: (id) => { const i = accs.findIndex((a) => a.it.id === id); return i < 0 ? null : { rank: i + 1, of: accs.length }; } };
  rankCache.set(key, r);
  return r;
}

// ---- report -----------------------------------------------------------------------------------
const guides = [await calamityGuide(), await ieorGuide()];
const allPicks = [];
const summary = { total: 0, missing: 0, late: 0, weaponTop3: 0, weaponTop8: 0, weapons: 0, setTop1: 0, setTop5: 0, sets: 0, accTop6: 0, accs: 0, modeAgree: 0, modeTotal: 0 };
const lines = [];
const lateOverrides = new Map(); // item id → earliest guide tier stage
const minStage = (a, b) => (a === undefined ? b : Math.min(a, b));
for (const g of guides) {
  for (const [tier, re] of Object.entries(g.tiers)) {
    const stage = tierStage(re);
    if (stage === null) { lines.push(`! no stage for tier ${tier}`); continue; }
    const picks = g.picks.filter((p) => p.tier === tier && (!onlyCls || p.cls === onlyCls));
    const byCls = new Map();
    for (const p of picks) (byCls.get(p.cls) ?? byCls.set(p.cls, []).get(p.cls)).push(p);
    for (const [cls, list] of byCls) {
      if (!ds.classList.includes(cls)) continue;
      lines.push(`\n## ${g.picks[0].guide} · ${tier} → ${ds.stages[stage].label} (stage ${stage}) · ${cls}`);
      const R = rankings(cls, stage);
      const seen = new Set();
      for (const p of list) {
        const key = `${p.kind}|${p.name.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        summary.total++;
        const it = findItem(p);
        const row = { ...p, stage, id: it?.id ?? null, itemStage: it?.stage ?? null };
        allPicks.push(row);
        if (!it) { summary.missing++; lines.push(`  ✗ ${p.kind.padEnd(9)} ${p.name.padEnd(30)} not in dataset`); continue; }
        const late = it.stage === null || it.stage === undefined ? null : it.stage > stage;
        if (late) { summary.late++; lateOverrides.set(it.id, minStage(lateOverrides.get(it.id), stage)); }
        const stageNote = late ? `LATE: lab says ${it.stageLabel} (${it.stageSource.kind}${it.stageSource.from ? ': ' + it.stageSource.from.join(', ') : it.stageSource.boss ? ': ' + it.stageSource.boss : ''})` : late === null ? 'stage unknown' : '';
        let rank = '';
        if (p.kind === 'weapon') {
          summary.weapons++;
          const r = late ? null : R.weaponRank(it.id);
          if (r) { rank = `#${r.rank}/${r.of} ${r.mode ?? ''} ${Math.round(r.value)}/s`; if (r.rank <= 3) summary.weaponTop3++; if (r.rank <= 8) summary.weaponTop8++; if (p.mode && r.mode) { summary.modeTotal++; if (p.mode === r.mode) summary.modeAgree++; } }
          else if (!late) rank = it.cls !== cls ? `class ${it.cls}` : 'unranked';
        } else if (p.armor) {
          summary.sets++;
          const r = late ? null : R.setRank(it);
          if (r) { rank = `set #${r}`; if (r === 1) summary.setTop1++; if (r <= 5) summary.setTop5++; } else if (!late) rank = 'not in top 5 sets';
        } else {
          summary.accs++;
          const r = late ? null : R.accRank(it.id);
          if (r) { rank = `#${r.rank}/${r.of}`; if (r.rank <= 6) summary.accTop6++; } else if (!late) rank = 'no class value';
        }
        lines.push(`  ${late ? '⚠' : '·'} ${p.kind.padEnd(9)} ${(p.name + (p.mode ? ` [${p.mode}]` : '')).padEnd(30)} ${rank.padEnd(28)} ${stageNote}`);
      }
      lines.push(`  lab top weapons: ${R.weapons.slice(0, 5).map((w) => `${w.it.name}${w.v.mode ? ` [${w.v.mode}]` : ''}`).join(', ')}`);
      lines.push(`  lab armor: ${R.sets.slice(0, 3).map((s) => s.head.item.name.replace(HEAD_WORDS, '').trim()).join(' > ')}`);
    }
  }
}
console.log(lines.join('\n'));
console.log(`\n== summary: ${summary.total} picks, ${summary.missing} missing from dataset, ${summary.late} staged later than the guide` +
  `\n   weapons ${summary.weapons}: top-3 ${summary.weaponTop3}, top-8 ${summary.weaponTop8}; stealth/spam grade agrees ${summary.modeAgree}/${summary.modeTotal}` +
  `\n   armor sets ${summary.sets}: lab's #1 ${summary.setTop1}, in top 5 ${summary.setTop5}` +
  `\n   accessories ${summary.accs}: in top 6 ${summary.accTop6}`);
if (flag('--write-overrides')) {
  const out = {};
  for (const [id, stage] of [...lateOverrides].sort()) out[id] = stage === 0 ? 'start' : ds.stages[stage].key;
  const note = 'Generated by tools/guide-check.mjs --write-overrides: guide picks the miner staged later than the guide tier, pinned to that tier. Manual overrides in progression.json win.';
  writeFileSync(new URL('../miner/stage/guide-overrides.json', import.meta.url), `${JSON.stringify({ $comment: note, ...out }, null, 2)}\n`);
  console.log(`wrote miner/stage/guide-overrides.json (${Object.keys(out).length} items)`);
}
if (flag('--json')) {
  writeFileSync(new URL('../data/guides.json', import.meta.url), JSON.stringify({ generatedAt: new Date().toISOString(), picks: allPicks }));
  console.log('wrote data/guides.json');
}
