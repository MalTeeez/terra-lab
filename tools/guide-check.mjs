#!/usr/bin/env node
/**
 * Cross-check the lab against the community class-setup guides.
 *
 *   node tools/guide-check.mjs                    # every guide, tier and class, full report
 *   node tools/guide-check.mjs --guide vanilla    # one guide (calamity | ieor | sots | vanilla)
 *   node tools/guide-check.mjs --cls rogue        # one class
 *   node tools/guide-check.mjs --tier pre-boss    # one tier (guide key, substring match)
 *   node tools/guide-check.mjs --pre              # pre-hardmode tiers only (the tuning set)
 *   node tools/guide-check.mjs --summary          # metrics only
 *   node tools/guide-check.mjs --why "Ashen Stalactite"   # the pick's DPS parts next to the lab's #1
 *   node tools/guide-check.mjs --why "Scourge of the Desert" --stage 4   # …for any weapon, at any stage
 *   node tools/guide-check.mjs --refresh          # re-parse the guides (tools/guides.mjs --refresh)
 *   node tools/guide-check.mjs --json a.json      # snapshot the metrics; later --json b.json --vs a.json
 *                                                 # prints the deltas per guide, class and mechanic family
 *
 * Every guide is judged inside its own scope (`GUIDE_CONFIG`): a Calamity pick competes with
 * vanilla + Calamity items carrying Calamity's rebalancing, a Terraria pick with vanilla items and
 * no external balancing at all. Comparing a curated list against the whole installed pack is the
 * commonest way to make the model look wrong when it is the comparison that is.
 *
 * The unit is a *section* — guide + tier + class + target — and inside it a *recommendation group*:
 * one row of the guide, with its `/` alternatives resolved and credited once. Most guide rows are
 * unordered sets of viable options, so the section metrics are the ones that survive that:
 *   best      the best rank any group in the section reached
 *   recall@K  groups landing in the model's top K, where K is the number of groups the section has
 *   top-3/8   kept for continuity with the earlier audit
 *   pairwise  only where a guide states a priority (`Best` versus its peers in the same box)
 * Groups that are unresolved, staged late, class-mismatched, support-only or out of the guide's own
 * scope are counted apart from the rankable denominator instead of being scored as misses.
 *
 * SOTS is an exhaustive catalogue, not a recommendation list: it is read for staging and Void
 * coverage evidence only and never enters a top-k metric.
 *
 * A pick the lab stages after the guide's tier ("LATE") is a lead, not a verdict, and lands in
 * `data/guide-late-weapons.md` with its evidence. An item the lab ranks in a stage's top 5 that no
 * guide lists until two tiers later ("EARLY") is the other kind of lead. Fix the miner or the model
 * when the evidence is wrong; there is no override file.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { candidates, solveLoadout } from '../src/lib/solver.js';
import { indexDataset } from '../src/lib/dataset.js';
import { foreignClass, pieceScore, weaponDps } from '../src/lib/score.js';
import { GUIDE_CONFIG, armorMatches, buildGuides, findItem } from './guides.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const onlyCls = opt('--cls', null);
const onlyTier = opt('--tier', null);
const onlyGuide = opt('--guide', null);
const whyName = opt('--why', null);
const preOnly = flag('--pre');

const ds = indexDataset(JSON.parse(readFileSync(new URL('../data/dataset.json', import.meta.url), 'utf8')));
const guidesFile = new URL('../data/guides.json', import.meta.url);
const picksAll = flag('--refresh') || !existsSync(guidesFile)
  ? await buildGuides(ds, { refresh: flag('--refresh') })
  : JSON.parse(readFileSync(guidesFile, 'utf8')).picks;

const HEAD_WORDS = /\b(helmet|hat|mask|hood|headgear|helm|visage|cowl|crown|cap|facemask|head|circlet|garland|goggles|headpiece|tiara|veil|skull|plume)\b/i;
const PRE_HARDMODE = ds.stages.findIndex((s) => /Wall of Flesh/i.test(s.label));
const ALL_MODS = ds.mods.map((m) => m.id);

// ---- guide scope ----------------------------------------------------------------------------
/**
 * The competitor pool and balance context a guide is judged in. `mods` is the content the guide
 * covers — everything else is excluded from the pool, so the pick is ranked against the items its
 * author was actually choosing between. `balanceMods` is which mods may rebalance those items; when
 * a guide does not narrow it (IEoR describes the whole installed pack) the normal context stands.
 */
const scopeCache = new Map();
function scopeOf(guide) {
  if (scopeCache.has(guide)) return scopeCache.get(guide);
  const cfg = GUIDE_CONFIG[guide] ?? { label: guide, intent: 'recommendations', mods: null };
  const s = {
    ...cfg,
    excludedMods: cfg.mods ? new Set(ALL_MODS.filter((m) => !cfg.mods.includes(m))) : new Set(),
    balanceMods: cfg.balanceMods ? new Set(cfg.balanceMods) : null,
    inScope: (it) => !cfg.mods || cfg.mods.includes(it.mod),
  };
  scopeCache.set(guide, s);
  return s;
}

// ---- rankings -------------------------------------------------------------------------------
/**
 * A summoner equips a minion *and* a sentry *and* a whip at once, so the three are not alternatives
 * and ranking one against the others is the same mistake as counting `+` support picks. The guides
 * put whips in the minion column, but that is a column of 209 minions and 19 whips — judged
 * together, the whips simply crowd the minions out. Each is ranked against its own kind, chosen by
 * what the item *is* rather than which column it was printed in.
 */
const SUMMON_KINDS = new Set(['minion', 'sentry', 'whip']);
/**
 * The mechanic families: the separate weapons a player of a class carries *at the same time*, each
 * filling a job the others cannot. A summoner wears a minion, a whip and a sentry together; a rogue
 * carries one weapon to throw and another to strike from stealth with. Ranking across a family
 * boundary compares things nobody chooses between — which is the same mistake as ranking a `+`
 * support pick against the main weapon.
 *
 * Summon families come from what the item *is* (`v.arch`), because the guides file whips in the
 * minion column. Rogue families come from what the guide *asked for*: every rogue weapon has both a
 * spam and a stealth value in the model, so a stealth pick is ranked on stealth value against every
 * rogue weapon's stealth value, and a spam pick on spam value.
 */
const FAMILY_VALUE = { stealth: (v) => v.stealth ?? v.value, spam: (v) => v.spam ?? v.value };
const isFamily = (f) => !!f && (SUMMON_KINDS.has(f) || f in FAMILY_VALUE);
/**
 * The guides label a pick with the slot it fills; the lab tags a weapon with what it is. They agree
 * where the names line up — except that the guides have no whip column, so a whip is filed under
 * `minion` (see SUMMON_KINDS).
 */
const MODE_ROLE = { spam: ['spam'], stealth: ['stealth'], minion: ['minion', 'whip'], sentry: ['sentry'] };
const ammoById = new Map((ds.ammo ?? []).map((a) => [a.id, { ...a, slot: 'ammo', cls: 'ranged', stageLabel: ds.stages[a.stage]?.label ?? '?', stageSource: a.stageSource ?? { kind: 'unknown' } }]));
/** Stage evidence that is a placement rather than a source the miner read off the game. */
const WEAK_STAGE = new Set(['anchor', 'manual', 'override', 'unobtainable', 'unknown']);

const ctxCache = new Map();
/** The solved loadout, pool and rankings for one (guide scope, class, stage). */
function rankings(guide, cls, stage) {
  const key = `${guide}|${cls}@${stage}`;
  if (ctxCache.has(key)) return ctxCache.get(key);
  const scope = scopeOf(guide);
  const solveOpts = { cls, stage, slots: 6, reforge: 'none', conds: new Set(), uncertain: false, excludedMods: scope.excludedMods, balanceMods: scope.balanceMods };
  const lo = solveLoadout(ds, solveOpts);
  const pool = candidates(ds, solveOpts);
  const statCtx = { conds: new Set(), uncertain: false, prefix: null, calibration: null, balanceMods: scope.balanceMods, ds, stage, stealthMax: lo.stealthMax, loadout: lo.bonus };
  const weaponPool = pool.filter((it) => it.slot === 'weapon' && it.cls === cls && (it.damage ?? 0) > 0);
  // the target modes are the two user-facing scores; a section is judged against the one it asks for
  const scoredCache = new Map();
  const scored = (targets) => {
    if (!scoredCache.has(targets)) scoredCache.set(targets, weaponPool.map((it) => ({ it, v: weaponDps(it, { ...statCtx, targets }) })));
    return scoredCache.get(targets);
  };
  const listCache = new Map();
  /** The ranking a pick actually competes in: its target mode, inside its mechanic family. */
  const listFor = (targets, family = null) => {
    const key = `${targets}|${family ?? ''}`;
    if (!listCache.has(key)) {
      const value = FAMILY_VALUE[family] ?? ((v) => v.value);
      const pool = SUMMON_KINDS.has(family) ? scored(targets).filter((w) => w.v.arch === family) : scored(targets);
      listCache.set(key, pool.map((w) => ({ ...w, key: value(w.v) })).filter((w) => w.key > 0).sort((a, b) => b.key - a.key));
    }
    return listCache.get(key);
  };
  const sets = [lo.armor, ...lo.armorAlternatives].filter(Boolean);
  const progression = ds.stages[stage]?.progression;
  const armorBySlot = new Map(['head', 'body', 'legs'].map((slot) => [slot, pool
    .filter((it) => it.slot === slot && !foreignClass(it, cls, ds.aliases))
    .map((it) => ({ it, s: pieceScore(it, cls, ds.aliases, { progression }).score }))
    .sort((a, b) => b.s - a.s)]));
  const accs = pool.filter((it) => it.slot === 'accessory').map((it) => ({ it, s: pieceScore(it, cls, ds.aliases, { progression }).score })).sort((a, b) => b.s - a.s);
  const r = {
    lo, statCtx, sets, accs, weapons: listFor('auto'), listFor,
    weaponRank: (id, targets = 'auto', family = null) => {
      const own = scored(targets).find((w) => w.it.id === id);
      if (!own) return null;
      // the guide's own family wins where it states one; otherwise a summon weapon still falls into
      // the family it belongs to, because the guides file whips in the minion column
      const fam = isFamily(family) ? family : SUMMON_KINDS.has(own.v.arch) ? own.v.arch : null;
      const list = listFor(targets, fam);
      const i = list.findIndex((w) => w.it.id === id);
      return i < 0 ? null : { rank: i + 1, of: list.length, mode: list[i].v.mode, value: list[i].key, family: fam, within: SUMMON_KINDS.has(fam) ? fam : null };
    },
    ammoRank: (id) => {
      const kind = lo.ammo.find((a) => a.item.id === id)?.kind;
      if (kind === undefined) return null;
      const list = lo.ammo.filter((a) => a.kind === kind);
      const i = list.findIndex((a) => a.item.id === id);
      return { rank: i + 1, of: list.length, value: list[i].value, within: list[i].kindName, gun: list[i].gun.name };
    },
    // Guide rows usually name an armor family once, while the dataset has one head variant per
    // class. `Aerospec`, for example, resolves to its magic head even in the melee guide column.
    // Match those variants by their shared body/legs; an explicitly named body or leg instead
    // matches the actual piece in the recommended configuration (including the best mixed set).
    setRank: (item, asPiece = false) => {
      if (asPiece || item.slot !== 'head' || !item.setItems?.length) {
        const list = armorBySlot.get(item.slot) ?? [];
        const i = list.findIndex((entry) => entry.it.id === item.id);
        return i < 0 ? null : i + 1;
      }
      const i = sets.findIndex((s) => armorMatches(s, item));
      return i < 0 ? null : i + 1;
    },
    accRank: (id) => { const i = accs.findIndex((a) => a.it.id === id); return i < 0 ? null : { rank: i + 1, of: accs.length }; },
  };
  ctxCache.set(key, r);
  return r;
}

// ---- --why: one pick's arithmetic next to the lab's #1 --------------------------------------
if (whyName) {
  // a weapon no guide lists can still be asked about — `--why "X" --stage 4` — which is how an
  // in-game reading gets compared with the model's arithmetic
  const stageArg = opt('--stage', null);
  let hits = picksAll.filter((p) => p.name.toLowerCase() === whyName.toLowerCase() && p.kind === 'weapon' && (!onlyGuide || p.guide === onlyGuide));
  if (stageArg !== null) {
    const it = ds.items.find((x) => x.name.toLowerCase() === whyName.toLowerCase() && x.slot === 'weapon');
    if (!it) { console.error(`no weapon named "${whyName}"`); process.exit(1); }
    hits = [{ guide: onlyGuide ?? 'ad hoc', tier: `stage ${stageArg}`, tierBoss: ds.stages[+stageArg].label, stage: +stageArg, cls: it.cls, id: it.id, name: it.name }];
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
    const scope = scopeOf(p.guide);
    const R = rankings(p.guide, p.cls, p.stage);
    const targets = targetOf(p);
    const r = R.weaponRank(p.id, targets);
    console.log(`\n=== ${p.guide} · ${p.tier} → ${p.tierBoss} (stage ${p.stage} ${ds.stages[p.stage].label}) · ${p.cls}${p.marks ? ` · ${p.marks.join(' ')}` : ''}${p.note ? ` · ${p.note}` : ''}`);
    console.log(`    scope: ${scope.label} content, balance ${scope.balanceMods ? [...scope.balanceMods].join('+') || 'none' : 'as installed'}, target ${targets}`);
    console.log(`    lab rank: ${r ? `#${r.rank}/${r.of}` : it.stage > p.stage ? `LATE (${it.stageLabel}, ${it.stageSource.kind})` : 'unranked'}`);
    console.log(`    loadout carries +${Math.round(R.lo.bonus.damage * 100)}% ${p.cls} damage, +${Math.round(R.lo.bonus.crit)} crit (${R.lo.armor?.head.item.name})`);
    show('pick', it, weaponDps(it, { ...R.statCtx, targets }));
    const top = R.listFor(targets)[0];
    if (top && top.it.id !== p.id) show('lab #1', top.it, top.v);
  }
  process.exit(0);
}

// ---- sections and recommendation groups ------------------------------------------------------
/** Which sustained score the guide is asking about: its own annotation, else `C` (best on worms). */
function targetOf(p) {
  if (p.target === 'single' || p.target === 'multi') return p.target;
  return (p.marks ?? []).includes('C') ? 'multi' : 'auto';
}

/**
 * A guide row and its alternatives are one recommendation: `Rot Ball / Tooth Ball` is a single
 * choice with two ways to make it, and counting both would inflate the denominator and let one
 * lucky alternative pay for the other.
 */
function groupIds(p) {
  const ids = p.id ? [p.id] : [];
  for (const name of p.alt ?? []) { const it = findItem(ds, p, name); if (it) ids.push(it.id); }
  return [...new Set(ids)];
}

/**
 * Spam and stealth are rogue playstyles, and most weapons are listed under both. Only a weapon the
 * guide files *exclusively* under one of them is a claim about that mode; judging the rest would
 * grade the model on the guide's layout rather than on what it says.
 */
const rolesByName = new Map();
for (const p of picksAll) {
  if (p.kind !== 'weapon' || !p.role) continue;
  const k = `${p.guide}|${p.cls}|${p.name.toLowerCase()}`;
  if (!rolesByName.has(k)) rolesByName.set(k, new Set());
  rolesByName.get(k).add(p.role);
}
const exclusiveRole = (p) => {
  const roles = rolesByName.get(`${p.guide}|${p.cls}|${p.name.toLowerCase()}`);
  if (!roles || roles.size !== 1) return null;
  const only = [...roles][0];
  return only === 'spam' || only === 'stealth' ? only : p.role;
};

/**
 * The mechanic family the guide is asking for. Only a weapon the guide files *exclusively* under
 * Spam or Stealth is a claim about that job; one listed under both is just a rogue weapon, and is
 * ranked on its combined value. Summon families are decided by the item, inside `weaponRank`.
 */
const familyOf = (p) => {
  const role = exclusiveRole(p);
  return role === 'spam' || role === 'stealth' ? role : null;
};

// ---- report ----------------------------------------------------------------------------------
const inScope = (p) => (!onlyGuide || p.guide === onlyGuide) && (!onlyCls || p.cls === onlyCls)
  && (!onlyTier || p.tier.toLowerCase().includes(onlyTier.toLowerCase()))
  && (!preOnly || p.stage < PRE_HARDMODE) && ds.classList.includes(p.cls);
const picks = picksAll.filter(inScope);

const zero = () => ({
  groups: 0, rankable: 0, unresolved: 0, late: 0, classMiss: 0, outOfScope: 0, support: 0, supportTop3: 0,
  top3: 0, top8: 0, recallK: 0, rrSum: 0, poolSum: 0, sections: 0, sectionBest: 0, sectionHit: 0,
  pairs: 0, pairsRight: 0, modeAgree: 0, modeTotal: 0,
  sets: 0, setTop1: 0, setTop5: 0, accs: 0, accTop6: 0, ammo: 0, ammoTop3: 0, early: 0, unlisted: 0,
});
const add = (into, from) => { for (const k of Object.keys(into)) into[k] += from[k]; return into; };

const sections = new Map(); // guide|tier|cls|target → picks
for (const p of picks) {
  if (p.kind === 'buff') continue; // buffs and potions are not modelled
  const k = `${p.guide} ${p.tier} ${p.cls} ${p.kind === 'weapon' ? targetOf(p) : '-'}`;
  if (!sections.has(k)) sections.set(k, []);
  sections.get(k).push(p);
}

const lines = [];
const byGuide = new Map();
const byGuideCls = new Map();
const byFamily = new Map(); // `guide|family` — the jobs a class fills with separate weapons
const famStat = () => ({ n: 0, top3: 0, top8: 0, rrSum: 0, poolSum: 0 });
const lateRows = [];
const earlyLeads = [];
const unlisted = new Map(); // `${guide}|${cls}|${id}` → a weapon holding top-8 slots that no guide names
const sectionRows = [];

// what each guide lists per class and stage, for the EARLY check
const listedAt = new Map(); // `${guide}|${cls}|${id}` → earliest guide stage
const listedAnywhere = new Map(); // `${cls}|${id}` → the guides that name it at all
for (const p of picksAll) for (const id of groupIds(p)) {
  const k = `${p.guide}|${p.cls}|${id}`;
  const s = listedAt.get(k);
  if (s === undefined || p.stage < s) listedAt.set(k, p.stage);
  const a = `${p.cls}|${id}`;
  if (!listedAnywhere.has(a)) listedAnywhere.set(a, new Set());
  listedAnywhere.get(a).add(p.guide);
}

const ordered = [...sections.keys()].sort((a, b) => {
  const [ga, , , ta] = a.split(' ');
  const [gb, , , tb] = b.split(' ');
  return ga.localeCompare(gb) || sections.get(a)[0].stage - sections.get(b)[0].stage || a.localeCompare(b);
});

for (const key of ordered) {
  const [guide, tier, cls, target] = key.split(' ');
  const list = sections.get(key);
  const stage = list[0].stage;
  const scope = scopeOf(guide);
  const catalogue = scope.intent === 'catalog';
  const s = zero();
  const R = rankings(guide, cls, stage);
  const targets = target === '-' ? 'auto' : target;

  lines.push(`\n## ${guide} · ${tier} → ${list[0].tierBoss} (stage ${stage} ${ds.stages[stage].label}) · ${cls}${target !== '-' && target !== 'auto' ? ` · ${target}-target` : ''}`);
  lines.push(`   scope ${scope.mods ? scope.mods.join('+') : 'all'} · balance ${scope.balanceMods ? [...scope.balanceMods].join('+') || 'none' : 'as installed'}${catalogue ? ' · catalogue: staging evidence only' : ''}`);

  const seen = new Set();
  const ranked = []; // { p, rank } for the rankable weapon groups of this section
  for (const p of list) {
    const ids = groupIds(p);
    const dedup = ids.length ? ids.join('+') : `${p.kind}|${p.name.toLowerCase()}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);
    s.groups++;
    const names = [p.name, ...(p.alt ?? [])].join(' / ');
    const marks = (p.marks ?? []).join('');
    const support = p.role === 'support' || marks.includes('+');
    const items = ids.map((id) => ds.byId.get(id) ?? ammoById.get(id)).filter(Boolean);
    if (!items.length) { s.unresolved++; lines.push(`  ✗ ${p.kind.padEnd(9)} ${names.padEnd(32)} not in dataset`); continue; }

    // the pick is credited with its best-placed alternative; the others are the same recommendation
    let best = null;
    for (const it of items) {
      const late = it.stage === null || it.stage === undefined ? null : it.stage > stage;
      // a `ν` pick is a SOTS Void weapon printed in a base class's column: it is ranked against the
      // Void pool it actually belongs to, not counted as a miss in a column it was never in
      const rankCls = it.cls === cls ? cls : it.cls === 'void' && ds.classList.includes('void') ? 'void' : null;
      const inPool = scope.inScope(it);
      const cand = { it, late, rankCls, inPool, r: null };
      if (!late && inPool && rankCls && p.kind === 'weapon') cand.r = (rankCls === cls ? R : rankings(guide, rankCls, stage)).weaponRank(it.id, targets, familyOf(p));
      else if (!late && inPool && p.kind === 'ammo') cand.r = R.ammoRank(it.id);
      else if (!late && inPool && (p.kind === 'armor' || p.armor)) {
        // "Hallowed" means the full family; "Hallowed Mask" means that exact head in a mixed set.
        const asPiece = [p.name, ...(p.alt ?? [])].some((name) => name.toLowerCase() === it.name.toLowerCase());
        const n = R.setRank(it, asPiece);
        cand.r = n ? { rank: n, of: asPiece ? null : R.sets.length, piece: asPiece } : null;
      }
      else if (!late && inPool && p.kind === 'accessory') cand.r = R.accRank(it.id);
      if (!best || (cand.r && (!best.r || cand.r.rank < best.r.rank)) || (!best.r && !best.inPool && cand.inPool)) best = cand;
    }
    const { it, late, rankCls, inPool, r } = best;
    const stageNote = late ? `LATE: lab says ${it.stageLabel} (${it.stageSource.kind}${it.stageSource.from ? ': ' + it.stageSource.from.join(', ') : it.stageSource.boss ? ': ' + it.stageSource.boss : ''})` : late === null ? 'stage unknown' : '';

    if (late) {
      s.late++;
      if (p.kind === 'weapon') lateRows.push({ guide, tier, cls, target, stage, name: names, id: it.id, mod: it.mod, labStage: it.stage, labLabel: it.stageLabel, src: it.stageSource, wouldRank: !!rankCls && inPool });
    } else if (!inPool) s.outOfScope++;
    else if (p.kind === 'weapon' && !rankCls) s.classMiss++; // only a weapon has a class to mismatch

    let rankText = '';
    if (p.kind === 'weapon') {
      if (support) { s.support++; if (r && r.rank <= 3) s.supportTop3++; }
      if (r) {
        rankText = `#${r.rank}/${r.of}${r.within ? ` ${r.within}s` : ''}${rankCls !== cls ? ` in ${rankCls}` : ''} ${r.mode ?? ''} ${Math.round(r.value)}/s`;
        if (!support && !catalogue) {
          s.rankable++; s.rrSum += 1 / r.rank; s.poolSum += r.of;
          if (r.rank <= 3) s.top3++;
          if (r.rank <= 8) s.top8++;
          ranked.push({ p, rank: r.rank });
          const famKey = `${guide}|${r.family ?? 'primary'}`;
          if (!byFamily.has(famKey)) byFamily.set(famKey, famStat());
          const f = byFamily.get(famKey);
          f.n++; f.rrSum += 1 / r.rank; f.poolSum += r.of;
          if (r.rank <= 3) f.top3++;
          if (r.rank <= 8) f.top8++;
          const role = exclusiveRole(p);
          if (MODE_ROLE[role] && r.mode) { s.modeTotal++; if (MODE_ROLE[role].includes(r.mode)) s.modeAgree++; }
        }
      } else if (!late && inPool && !rankCls) rankText = `class ${it.cls}`;
      else if (!late && !inPool) rankText = `outside ${guide} scope (${it.mod})`;
      else if (!late) rankText = 'unranked';
    } else if (p.kind === 'ammo') {
      s.ammo++;
      if (r) { rankText = `#${r.rank}/${r.of} ${r.within}s ${Math.round(r.value)}/s in a ${r.gun}`; if (r.rank <= 3) s.ammoTop3++; } else if (!late) rankText = inPool ? 'no gun uses it' : `outside ${guide} scope (${it.mod})`;
    } else if (p.kind === 'armor' || p.armor) {
      s.sets++;
      if (r) { rankText = `${r.piece ? 'piece' : 'set'} #${r.rank}`; if (r.rank === 1) s.setTop1++; if (r.rank <= 5) s.setTop5++; } else if (!late) rankText = inPool ? 'not in top 5 armor' : `outside ${guide} scope (${it.mod})`;
    } else if (p.kind === 'accessory') {
      s.accs++;
      if (r) { rankText = `#${r.rank}/${r.of}`; if (r.rank <= 6) s.accTop6++; } else if (!late) rankText = inPool ? 'no class value' : `outside ${guide} scope (${it.mod})`;
    }
    const tag = `${marks ? ` ${marks}` : ''}${p.priority ? ` [${p.priority}]` : ''}${p.with ? ` (with ${p.with})` : ''}`;
    lines.push(`  ${late ? '⚠' : support ? '+' : '·'} ${p.kind.padEnd(9)} ${(names + tag).padEnd(34)} ${rankText.padEnd(30)} ${it.id.padEnd(24)} ${stageNote}${p.note && !late ? `  — ${p.note}` : ''}`);
  }

  // ---- section metrics: what an unordered set of recommendations can actually claim ----------
  if (ranked.length) {
    const K = ranked.length;
    const bestRank = Math.min(...ranked.map((x) => x.rank));
    s.recallK = ranked.filter((x) => x.rank <= K).length;
    s.sections = 1;
    s.sectionBest = bestRank;
    s.sectionHit = bestRank <= 3 ? 1 : 0;
    // pairwise ordering is only claimed where the guide states one
    const flagged = ranked.filter((x) => x.p.priority === 'best');
    for (const a of flagged) for (const b of ranked) {
      if (b.p.priority === 'best') continue;
      s.pairs++;
      if (a.rank < b.rank) s.pairsRight++;
    }
    lines.push(`  → best #${bestRank}, recall@${K} ${s.recallK}/${K}, top-3 ${s.top3}/${K}, top-8 ${s.top8}/${K}${s.pairs ? `, priority pairs ${s.pairsRight}/${s.pairs}` : ''}`);
    sectionRows.push({ guide, tier, cls, target, stage, K, bestRank, recallK: s.recallK, top3: s.top3, top8: s.top8 });
  }

  // ---- leads: what the model ranks above the guide's picks -----------------------------------
  if (!catalogue && list.some((p) => p.kind === 'weapon')) {
    const top = R.listFor(targets);
    for (const w of top.slice(0, 5)) {
      const first = listedAt.get(`${guide}|${cls}|${w.it.id}`);
      if (first === undefined || first <= stage + 1) continue;
      const tiersLater = new Set(picksAll.filter((p) => p.guide === guide && p.cls === cls && groupIds(p).includes(w.it.id)).map((p) => p.tier));
      s.early++;
      earlyLeads.push({ guide, cls, stage, name: w.it.name, id: w.it.id, value: w.v.value, first, tiers: [...tiersLater] });
      lines.push(`  ! EARLY    ${w.it.name.padEnd(32)} lab #${top.indexOf(w) + 1} at stage ${stage}, ${guide} lists it at stage ${first} (${[...tiersLater].join(', ')})`);
    }
    // UNLISTED: the top-8 slots held by weapons the guide never names for this class at any tier.
    // EARLY cannot see these — it needs a tier to compare against — yet they are what actually
    // keeps the guide's picks out of the top 8, so they are the worklist.
    top.slice(0, 8).forEach((w, i) => {
      if (listedAt.has(`${guide}|${cls}|${w.it.id}`)) return;
      s.unlisted++;
      const k = `${guide}|${cls}|${w.it.id}`;
      const u = unlisted.get(k) ?? { guide, cls, name: w.it.name, mod: w.it.mod, arch: w.v.arch, stage: w.it.stage, src: w.it.stageSource, elsewhere: listedAnywhere.get(`${cls}|${w.it.id}`) ?? null, n: 0, best: 99, value: 0 };
      u.n++; u.best = Math.min(u.best, i + 1); u.value = Math.max(u.value, w.v.value);
      unlisted.set(k, u);
    });
    lines.push(`  lab top: ${top.slice(0, 5).map((w) => `${w.it.name}${w.v.mode ? ` [${w.v.mode}]` : ''} ${Math.round(w.v.value)}`).join(', ')}`);
    lines.push(`  lab armor: ${R.sets.slice(0, 3).map((x) => x.head.item.name.replace(HEAD_WORDS, '').trim()).join(' > ')}`);
  }

  if (!byGuide.has(guide)) byGuide.set(guide, zero());
  if (!byGuideCls.has(`${guide}|${cls}`)) byGuideCls.set(`${guide}|${cls}`, zero());
  add(byGuide.get(guide), s);
  add(byGuideCls.get(`${guide}|${cls}`), s);
}

if (!flag('--summary')) console.log(lines.join('\n'));

// ---- summary ---------------------------------------------------------------------------------
const pct = (a, b) => (b ? ` ${String(Math.round((a / b) * 100)).padStart(3)}%` : '     ');
const row = (label, s) => `  ${label.padEnd(20)} groups ${String(s.groups).padStart(5)} (${String(s.rankable).padStart(4)} rankable)  best@3 ${String(s.sectionHit).padStart(3)}/${String(s.sections).padEnd(3)}  recall@K ${String(s.recallK).padStart(4)}${pct(s.recallK, s.rankable)}  top-3 ${String(s.top3).padStart(4)}${pct(s.top3, s.rankable)}  top-8 ${String(s.top8).padStart(4)}${pct(s.top8, s.rankable)}  MRR ${(s.rankable ? s.rrSum / s.rankable : 0).toFixed(3)}  vs ${String(s.rankable ? Math.round(s.poolSum / s.rankable) : 0).padStart(4)}  |  late ${String(s.late).padStart(3)} cls ${String(s.classMiss).padStart(3)} scope ${String(s.outOfScope).padStart(3)} miss ${String(s.unresolved).padStart(4)} sup ${String(s.support).padStart(3)}`;

console.log('\n== per guide  (each guide judged inside its own content and balance scope)');
for (const [guide, s] of byGuide) {
  const scope = scopeOf(guide);
  console.log(`\n  ${guide}${scope.intent === 'catalog' ? ' — catalogue: staging evidence only, no top-k' : ''}`);
  for (const [k, v] of [...byGuideCls].filter(([k]) => k.startsWith(`${guide}|`)).sort((a, b) => b[1].rankable - a[1].rankable)) console.log(row(k.split('|')[1], v));
  console.log(row('- all classes -', s));
  if (s.pairs) console.log(`  ${' '.repeat(20)} explicit priority honoured ${s.pairsRight}/${s.pairs}, spam/stealth grade agrees ${s.modeAgree}/${s.modeTotal}`);
  console.log(`  ${' '.repeat(20)} armor sets ${s.sets} (#1 ${s.setTop1}, top-5 ${s.setTop5}) · accessories ${s.accs} (top-6 ${s.accTop6}) · ammo ${s.ammo} (top-3 ${s.ammoTop3}) · support ${s.support} (${s.supportTop3} in top 3, a warning) · early ${s.early} · unlisted ${s.unlisted}`);
  const fams = [...byFamily].filter(([k]) => k.startsWith(`${guide}|`));
  if (fams.length > 1) {
    console.log(`  ${' '.repeat(20)} by mechanic family — the jobs a player fills with separate weapons at once:`);
    for (const [k, f] of fams.sort((a, b) => b[1].n - a[1].n)) {
      console.log(`  ${' '.repeat(22)}${k.split('|')[1].padEnd(9)} ${String(f.n).padStart(4)} picks  top-3 ${String(f.top3).padStart(3)}${pct(f.top3, f.n)}  top-8 ${String(f.top8).padStart(3)}${pct(f.top8, f.n)}  MRR ${(f.n ? f.rrSum / f.n : 0).toFixed(3)}  vs ${Math.round(f.poolSum / (f.n || 1))} of its own kind`);
    }
  }
}

// ---- data/guide-late-weapons.md --------------------------------------------------------------
{
  const l = ['# Guide weapons the lab stages late', '',
    `Generated by \`node tools/guide-check.mjs\`${preOnly || onlyCls || onlyTier || onlyGuide ? ' (filtered run — not the full set)' : ''}.`,
    '',
    'Weapon picks only. Each row is a guide recommendation whose resolved item the lab stages after',
    'the tier the guide lists it in, so it never entered that section\'s ranking. The guides order',
    'bosses by difficulty while the lab follows BossChecklist\'s progression, and the miner\'s answer',
    'comes with its evidence — `stage source` is what to check first. `rankable` says whether the row',
    'would otherwise have been scored (in class, inside the guide\'s scope): those are the ones the',
    'metric actually lost.', ''];
  const byKey = new Map();
  for (const r of lateRows) {
    const k = `${r.guide} ${r.tier} ${r.cls}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }
  for (const [k, rows] of [...byKey].sort((a, b) => a[1][0].stage - b[1][0].stage || a[0].localeCompare(b[0]))) {
    const [guide, tier, cls] = k.split(' ');
    l.push(`## ${guide} · ${tier} · ${cls} (guide stage ${rows[0].stage})`, '',
      '| item | id | mod | guide stage | lab stage | stage source | rankable |', '| --- | --- | --- | --- | --- | --- | --- |');
    for (const r of rows.sort((a, b) => a.labStage - b.labStage)) {
      const src = `${r.src.kind}${r.src.from ? ': ' + r.src.from.join(', ') : r.src.boss ? ': ' + r.src.boss : r.src.via ? ': ' + r.src.via : ''}`;
      l.push(`| ${r.name} | ${r.id} | ${r.mod} | ${r.stage} | ${r.labStage} ${r.labLabel} | ${src.replace(/\|/g, '\\|')} | ${r.wouldRank ? 'yes' : 'no'} |`);
    }
    l.push('');
  }
  writeFileSync(new URL('../data/guide-late-weapons.md', import.meta.url), l.join('\n'));
  console.log(`\n== ${lateRows.length} late weapon rows (${new Set(lateRows.map((r) => r.id)).size} distinct items) → data/guide-late-weapons.md`);
  const worst = new Map();
  for (const r of lateRows) {
    const u = worst.get(r.id) ?? { ...r, want: 99 };
    u.want = Math.min(u.want, r.stage);
    worst.set(r.id, u);
  }
  for (const r of [...worst.values()].sort((a, b) => (b.labStage - b.want) - (a.labStage - a.want)).slice(0, 25)) {
    console.log(`  ${r.name.padEnd(34)} ${r.guide.padEnd(8)} guide ${String(r.want).padStart(3)} → lab ${String(r.labStage).padStart(3)}  ${r.src.kind}${r.src.from ? ': ' + r.src.from.join(', ') : r.src.boss ? ': ' + r.src.boss : ''}`);
  }
}

// ---- --json / --vs: the A/B pair for a scoring change ----------------------------------------
// Not for reading. `--json before.json`, change the model, `--json after.json --vs before.json`,
// and the deltas print per guide, per class and per mechanic family so a change that helps one
// family at another's expense cannot hide inside an aggregate that did not move.
{
  const snapshot = {
    generatedAt: new Date().toISOString(),
    filters: { guide: onlyGuide, cls: onlyCls, tier: onlyTier, pre: preOnly },
    guides: Object.fromEntries(byGuide),
    classes: Object.fromEntries(byGuideCls),
    families: Object.fromEntries(byFamily),
    sections: sectionRows,
  };
  const out = opt('--json', null);
  if (out) { writeFileSync(out, JSON.stringify(snapshot, null, 1)); console.log(`\n== snapshot → ${out}`); }
  const vs = opt('--vs', null);
  if (vs) {
    const old = JSON.parse(readFileSync(vs, 'utf8'));
    const d = (a, b) => (b === undefined ? ' —' : `${b - a >= 0 ? '+' : ''}${b - a}`);
    console.log(`\n== versus ${vs}`);
    for (const [k, now] of Object.entries(snapshot.guides)) {
      const was = old.guides[k];
      if (!was) continue;
      console.log(`  ${k.padEnd(10)} rankable ${d(was.rankable, now.rankable).padStart(5)}  top-3 ${d(was.top3, now.top3).padStart(5)}  top-8 ${d(was.top8, now.top8).padStart(5)}  recall@K ${d(was.recallK, now.recallK).padStart(5)}  MRR ${(now.rankable ? now.rrSum / now.rankable : 0).toFixed(3)} was ${(was.rankable ? was.rrSum / was.rankable : 0).toFixed(3)}`);
    }
    for (const group of ['classes', 'families']) {
      console.log(`  -- ${group} --`);
      for (const [k, now] of Object.entries(snapshot[group])) {
        const was = old[group][k];
        if (!was) continue;
        const n = group === 'families' ? 'n' : 'rankable';
        if (was.top3 === now.top3 && was.top8 === now.top8) continue;
        console.log(`  ${k.padEnd(22)} ${String(now[n]).padStart(4)} picks  top-3 ${d(was.top3, now.top3).padStart(5)}  top-8 ${d(was.top8, now.top8).padStart(5)}`);
      }
    }
  }
}

if (unlisted.size) {
  // Three different things hide in one list, so they are printed as three: a weapon another guide
  // does name is this guide not enumerating the pool; one no guide anywhere names, staged by a hand
  // placement or an anchor rather than a real source, is a staging lead; the rest is the model.
  const slots = [...unlisted.values()].reduce((n, u) => n + u.n, 0);
  const srcOf = (u) => (u.src ? `${u.src.kind}${u.src.from ? ': ' + u.src.from.join(', ') : u.src.via ? ': ' + u.src.via : u.src.boss ? ': ' + u.src.boss : ''}` : '?');
  const show = (u) => console.log(`  ${u.guide.padEnd(8)} ${u.cls.padEnd(8)} ${u.name.padEnd(30)} ${String(u.n).padStart(2)} tiers, best #${u.best}, ${String(Math.round(u.value)).padStart(5)}/s  stage ${String(u.stage).padStart(2)} ${srcOf(u)}`);
  const all = [...unlisted.values()].sort((a, b) => b.n - a.n || a.best - b.best);
  const named = all.filter((u) => u.elsewhere && [...u.elsewhere].some((g) => g !== u.guide));
  const weak = all.filter((u) => !named.includes(u) && WEAK_STAGE.has(u.src?.kind));
  const rest = all.filter((u) => !named.includes(u) && !weak.includes(u));
  console.log(`\n== UNLISTED (${unlisted.size} weapons holding ${slots} top-8 slots): the guide never names these for the class at any tier`);
  console.log('   Each one costs a slot the metric wants a guide pick in — together they are the ceiling on top-8.');
  console.log(`\n  -- another guide does name it (${named.length}): this guide is not enumerating its pool, not a model fault`);
  for (const u of named.slice(0, 12)) show(u);
  console.log(`\n  -- no guide names it, and the stage is a hand placement or an anchor (${weak.length}): staging leads`);
  for (const u of weak.slice(0, 12)) show(u);
  console.log(`\n  -- no guide names it, staged from a real source (${rest.length}): the model's own worklist`);
  for (const u of rest.slice(0, 20)) show(u);
  // which kinds of weapon are over-represented here, against how common they are in the pools the
  // guides' own picks came from: a lopsided archetype is one bug, not three hundred
  const archOf = (rows) => rows.reduce((m, u) => m.set(u.arch ?? '?', (m.get(u.arch ?? '?') ?? 0) + u.n), new Map());
  const held = archOf(rest);
  const total = [...held.values()].reduce((a, b) => a + b, 0);
  console.log(`\n  -- those ${rest.length} weapons by archetype (share of the ${total} top-8 slots they hold)`);
  for (const [arch, n] of [...held].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
    console.log(`     ${String(arch).padEnd(12)} ${String(n).padStart(4)} slots ${pct(n, total)}  ${[...new Set(rest.filter((u) => (u.arch ?? '?') === arch).sort((a, b) => b.n - a.n).map((u) => u.name))].slice(0, 4).join(', ')}`);
  }
}
if (earlyLeads.length) {
  console.log(`\n== EARLY leads (${earlyLeads.length}): the lab's top 5 at a stage the guide does not list them for`);
  const seen = new Set();
  for (const e of earlyLeads.sort((a, b) => b.first - b.stage - (a.first - a.stage))) {
    if (seen.has(`${e.guide}|${e.cls}|${e.id}`)) continue;
    seen.add(`${e.guide}|${e.cls}|${e.id}`);
    if (seen.size > 40) break;
    console.log(`  ${e.guide.padEnd(8)} ${e.cls.padEnd(8)} ${e.name.padEnd(32)} lab stage ${String(e.stage).padStart(3)} @ ${String(Math.round(e.value)).padStart(6)}/s  →  guide at ${e.first} (${e.tiers.join(', ')})`);
  }
}
