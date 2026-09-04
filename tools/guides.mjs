#!/usr/bin/env node
/**
 * The community class-setup guides as data.
 *
 *   node tools/guides.mjs              # parse the cached wikitext → data/guides.json + data/guides.md
 *   node tools/guides.mjs --refresh    # re-download first (cached in data/guides/)
 *
 * Sources
 *   Calamity:  https://calamitymod.wiki.gg/wiki/Guide:Class_setups   (Cargo table `ClassSetups`)
 *   Modpack:   https://terrariamods.wiki.gg/wiki/Infernal_Eclipse_of_Ragnarok/Guide:Class_setups
 *              (one template per tier: Template:Infernal_Eclipse_of_Ragnarok/Guide_<Tier>)
 *
 * One record per recommendation:
 *   { guide, tier, tierBoss, stage, cls, kind, role, name, mod, marks, with, note, alt, id }
 *
 * `stage` is the lab stage the tier maps to: for a `pre-X` tier the stage just before X was
 * beaten, for a `post-X` tier the stage X itself. `id` is the dataset item the name resolves to
 * (null when the dataset does not have it). Nothing here pins a stage — the guides are the
 * scoreboard, never an override (see docs/rework-weapon-scoring.md).
 *
 * Legend (both guides use the same symbols):
 *   †  risky / needs preparation      C  crowd control, best on worms      +  support or secondary
 *   ≤  upgrades of it are viable      *  tedious to get at this tier       ν  SOTS void subclass
 *   Ω  use together with `with`       Δ  its set bonus changed (Calamity)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const cacheDir = new URL('../data/guides/', import.meta.url);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

/** Cached download; a failed refresh falls back to the cache rather than losing the tier. */
async function cached(name, refresh, fetchIt) {
  mkdirSync(cacheDir, { recursive: true });
  const file = new URL(name, cacheDir);
  const have = existsSync(file);
  if (!refresh && have) return readFileSync(file, 'utf8');
  try {
    const text = await fetchIt();
    writeFileSync(file, text);
    return text;
  } catch (e) {
    if (have) { console.warn(`! ${name}: ${e.message}, using the cached copy`); return readFileSync(file, 'utf8'); }
    throw e;
  }
}
const get = (url) => fetch(url, { headers: { 'User-Agent': UA } }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))));

// ---- tiers → lab stages ----------------------------------------------------------------------
/**
 * Each tier is named by the boss it precedes (`pre`) or follows (`post`). The lab's stages are
 * labelled by the boss just beaten, so `pre-X` is the stage before X's and `post-X` is X's own.
 * A tier the dataset has no boss for is dropped with a warning rather than guessed at.
 */
const CAL_TIERS = {
  'pre-boss': ['pre', /^Pre-boss$/i],
  'pre-evil1': ['pre', /Eater of Worlds|Brain of Cthulhu/i],
  'pre-evil2': ['pre', /Hive Mind|Perforator/i],
  'pre-skeletron': ['pre', /^Skeletron$/i],
  'pre-wof': ['pre', /Wall of Flesh/i],
  'pre-mech': ['pre', /^The Twins$/i],
  'post-mech1': ['post', /^The Twins$/i],
  'post-mech2': ['post', /^The Destroyer$/i],
  'pre-plantera': ['pre', /^Plantera$/i],
  'pre-golem': ['pre', /^Golem$/i],
  'post-golem': ['post', /^Golem$/i],
  'pre-lunar': ['pre', /Lunatic Cultist/i],
  'pre-moonlord': ['pre', /^Moon Lord$/i],
  'pre-provi': ['pre', /Providence/i],
  'pre-polter': ['pre', /Polterghast/i],
  'pre-dog': ['pre', /Devourer of Gods/i],
  'pre-yharon': ['pre', /^Yharon/i],
  'pre-scal': ['pre', /Supreme Witch/i],
  'pre-exo': ['pre', /XS-03 Apollo/i],
  'pre-scal-exo': ['post', /XG-07 Mars/i],
  endgame: ['post', /$^/], // last stage
};
const IEOR_TIERS = {
  'Pre-Boss': ['pre', /^Pre-boss$/i],
  'Pre-Evil': ['pre', /Eater of Worlds|Brain of Cthulhu/i],
  'Pre-Evil_2': ['pre', /Hive Mind|Perforator/i],
  'Pre-Skeletron': ['pre', /^Skeletron$/i],
  'Pre-Slime_God': ['pre', /Slime God/i],
  'Pre-Wall_of_Flesh': ['pre', /Wall of Flesh/i],
  'Pre-Polaris': ['pre', /^Polaris$/i],
  'Pre-Mechanical_Bosses': ['pre', /^The Twins$/i],
  'Pre-mechanical_Boss_2': ['post', /^The Twins$/i],
  'Post_Mechanical_Boss_2': ['post', /^The Destroyer$/i],
  'Pre-Plantera': ['pre', /^Plantera$/i],
  'Pre-Golem': ['pre', /^Golem$/i],
  'Post-Golem': ['post', /^Golem$/i],
  'Pre-Lunar_Events': ['pre', /Lunar Events/i],
  'Pre-Moon_Lord': ['pre', /^Moon Lord$/i],
  'Pre-Providence': ['pre', /Providence/i],
  'Pre-Polterghast': ['pre', /Polterghast/i],
  'Pre-Devourer_of_Gods': ['pre', /Devourer of Gods/i],
  'Pre-Yharon': ['pre', /^Yharon/i],
  'Pre-Primordials': ['pre', /Primordial Wyrm/i],
  'Pre-Shadowspec': ['pre', /Supreme Witch/i],
  Endgame: ['post', /$^/],
};

/** @returns {{ stage: number, boss: string } | null} */
function tierStage(stages, [when, re]) {
  if (re.source === '$^') return { stage: stages.length - 1, boss: 'Endgame' };
  if (/Pre-boss/i.test(re.source)) return { stage: 0, boss: 'Pre-boss' };
  const idx = stages.findIndex((s) => re.test(s.label));
  if (idx <= 0) return null;
  return { stage: when === 'pre' ? idx - 1 : idx, boss: stages[idx].label };
}

// ---- shared cell parsing ---------------------------------------------------------------------
const MARK_CHARS = '†C+≤*νΩΔv'; // IEoR types the void mark as a plain `v`
const stripTags = (s) => s.replace(/<[^>]+>/g, '');
const unlink = (s) => s.replace(/\[\[(?:File:[^\]]*)\]\]/g, '').replace(/\[\[([^\]|]+)\|([^\]]*)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1');
/** Marks out of a `'''† C'''` / `'''Ω<sup>1</sup>'''` blob, sup indices dropped. */
const marksOf = (blob) => [...new Set([...stripTags(blob).replace(/'''/g, '')].filter((c) => MARK_CHARS.includes(c)).map((c) => (c === 'v' ? 'ν' : c)))];
/**
 * Split a Calamity cell into the item markup and its `<span class="tooltip">` blocks. The blocks
 * nest item markup of their own ("use this with Musket Balls"), so they are matched by depth, not
 * by a lazy regex — otherwise the paired item leaks out as an alternative.
 * @returns {{ body: string, tips: Array<{ mark: string, text: string }> }}
 */
function splitTooltips(html) {
  const OPEN = '<span class="tooltip">';
  const tips = [];
  let body = '';
  let i = 0;
  for (;;) {
    const at = html.indexOf(OPEN, i);
    if (at < 0) { body += html.slice(i); break; }
    body += html.slice(i, at);
    let depth = 1;
    let j = at + OPEN.length;
    while (depth > 0 && j < html.length) {
      const open = html.indexOf('<span', j);
      const close = html.indexOf('</span>', j);
      if (close < 0) { j = html.length; break; }
      if (open >= 0 && open < close) { depth++; j = open + 5; } else { depth--; j = close + 7; }
    }
    const inner = html.slice(at + OPEN.length, j - 7);
    const cut = inner.indexOf('<span class="tooltiptext">');
    tips.push({ mark: cut < 0 ? inner : inner.slice(0, cut), text: cut < 0 ? '' : inner.slice(cut + 26) });
    i = j;
  }
  return { body, tips };
}

/** The item a `Ω` note says to pair with: the last link in the note text. */
function pairedWith(note) {
  const m = [...(note ?? '').matchAll(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g)].filter((x) => !/^File:/i.test(x[1]));
  return m.length ? m[m.length - 1][1].trim() : null;
}

// ---- Calamity: Cargo table -------------------------------------------------------------------
const CAL_KIND = {
  weapon: 'weapon', weaponSpam: 'weapon', weaponStealth: 'weapon', weaponSummon: 'weapon', minions: 'weapon', sentries: 'weapon', support: 'weapon',
  armor: 'armor',
  accessoryOffense: 'accessory', accessoryDefense: 'accessory', accessoryGeneral: 'accessory', accessoryMobility: 'accessory', accessoryMobilityPrimary: 'accessory', accessoryStealth: 'accessory', accessorySpam: 'accessory',
  buff: 'buff', buffOffense: 'buff', buffDefense: 'buff', buffGeneral: 'buff', buffMobility: 'buff',
  ammo: 'ammo',
};
const CAL_ROLE = {
  weaponSpam: 'spam', weaponStealth: 'stealth', weaponSummon: 'minion', minions: 'minion', sentries: 'sentry', support: 'support',
  accessoryOffense: 'offense', buffOffense: 'offense', accessoryDefense: 'defense', accessoryMobility: 'mobility', accessoryMobilityPrimary: 'mobility',
  buffMobility: 'mobility', accessoryStealth: 'stealthAcc', accessorySpam: 'spam',
};
const CAL_CLASSES = {
  all: ['melee', 'ranged', 'magic', 'summon', 'rogue'],
  'all-but-summoner': ['melee', 'ranged', 'magic', 'rogue'],
  'all-but-stealth': ['melee', 'ranged', 'magic', 'summon', 'rogue'],
  'all-but-summoner-stealth': ['melee', 'ranged', 'magic', 'rogue'],
};

async function calamityGuide(refresh) {
  const rows = [];
  for (let offset = 0; offset < 6000; offset += 500) {
    const text = await cached(`calamity-classsetups-${offset}.json`, refresh, () => get(`https://calamitymod.wiki.gg/api.php?action=cargoquery&tables=ClassSetups&fields=item,class,progression,type&limit=500&offset=${offset}&format=json`));
    const page = (JSON.parse(text).cargoquery ?? []).map((x) => x.title);
    rows.push(...page);
    if (page.length < 500) break;
  }
  return rows.flatMap(parseCalamityRow);
}

/**
 * One row of the `ClassSetups` cargo table: `{ item, class, progression, type }` where `item` is a
 * rendered HTML cell. A row that names several items with a `/` is one record with alternatives,
 * and a class key like `all-but-summoner` becomes one record per class.
 * @returns {Array} the picks the row stands for (empty for a tier or type the lab does not model)
 */
export function parseCalamityRow(r) {
  if (!CAL_TIERS[r.progression] || !CAL_KIND[r.type]) return [];
  // the tooltip carries the marks and the note; pull it out before reading the item links
  const { body, tips } = splitTooltips(r.item ?? '');
  const marks = tips.flatMap((t) => marksOf(t.mark));
  const withItem = tips.map((t) => (/should be used with|in the inventory if using/i.test(t.text) ? pairedWith(t.text) : null)).find(Boolean) ?? null;
  const note = tips.map((t) => unlink(stripTags(t.text.replace(/\[\[File:[^\]]*\]\]/g, ''))).replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ') || null;
  const names = [...new Set([...body.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1].trim()).filter((n) => !/^File:/i.test(n)))];
  if (!names.length) return [];
  const kind = CAL_KIND[r.type];
  const role = CAL_ROLE[r.type] ?? (marks.includes('+') ? 'support' : null);
  const classes = CAL_CLASSES[r.class] ?? [r.class];
  const spamOnly = /-stealth$/.test(r.class);
  return classes.map((cls) => ({
    guide: 'calamity', tier: r.progression, cls, kind,
    role: spamOnly && cls === 'rogue' && kind === 'weapon' ? 'spam' : role,
    name: names[0].replace(/ armor$/i, ''), mod: null,
    armor: kind === 'armor' || / armor$/i.test(names[0]),
    marks, with: withItem || undefined, note: note || undefined,
    alt: names.slice(1).map((n) => n.replace(/ armor$/i, '')),
  }));
}

// ---- Infernal Eclipse of Ragnarok: guide templates -------------------------------------------
const IEOR_CLS = { melee: 'melee', ranged: 'ranged', magic: 'magic', summoner: 'summon', summon: 'summon', rogue: 'rogue', bard: 'bard', healer: 'healer', thrower: 'thrower' };
const IEOR_ROLE = {
  'class-specific': null, 'all-class': null, 'all-around': null, permanent: null, weapons: null, 'held weapons': null, ammo: null,
  mobility: 'mobility', offensive: 'offense', defensive: 'defense', recovery: 'defense',
  spam: 'spam', stealth: 'stealth', minions: 'minion', 'sentries & banners': 'sentry',
  'support items': 'support', 'support tools': 'support', 'technique -s': 'support', techniques: 'support',
};

/** Every guide template's wikitext in one API call (index.php?action=raw is behind a challenge). */
async function ieorSource(tier, refresh) {
  const title = `Template:Infernal Eclipse of Ragnarok/Guide ${tier.replace(/_/g, ' ')}`;
  return cached(`ieor-${tier}.txt`, refresh, async () => {
    const j = JSON.parse(await get(`https://terrariamods.wiki.gg/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&titles=${encodeURIComponent(title)}&format=json&formatversion=2`));
    const page = j.query?.pages?.[0];
    const text = page?.revisions?.[0]?.slots?.main?.content;
    if (!text) throw new Error(page?.missing ? 'no such template' : 'no content');
    return text;
  });
}

async function ieorGuide(refresh) {
  const picks = [];
  for (const tier of Object.keys(IEOR_TIERS)) {
    let text;
    try { text = await ieorSource(tier, refresh); } catch (e) { console.warn(`! IEoR ${tier}: ${e.message}`); continue; }
    if (/^\s*$/.test(text)) { console.warn(`! IEoR ${tier}: empty`); continue; }
    for (const tab of text.split(/\|-\|/).slice(1)) picks.push(...parseIeorTab(tab, tier));
  }
  return picks;
}

/**
 * One class tab of a guide template. The outer `infocard/box` titles carry the kind (Weapons,
 * Armor, Accessories, Buffs) and the inner ones the role (Spam, Stealth, Mobility, Support Items…);
 * `{{item|…}}` entries joined by `/` are alternatives of one pick and share its marks.
 * @returns {Array} the picks the tab stands for (empty when the tab names no class)
 */
export function parseIeorTab(tab, tier) {
  const picks = [];
  const cls = IEOR_CLS[tab.match(/^\s*([A-Za-z]+)=/)?.[1]?.toLowerCase()];
  if (!cls) return picks;
  for (const box of tab.split(/\{\{infocard\/box \| style = width: 350px \| title = /).slice(1)) {
    const kind = /^\[\[Weapons\]\]/.test(box) ? 'weapon' : /^\[\[Armor\]\]/.test(box) ? 'armor' : /^\[\[Accessories\]\]/.test(box) ? 'accessory' : /^\[\[Buffs\]\]/.test(box) ? 'buff' : null;
    if (!kind) continue;
    let role = null;
    // walk the box left to right: inner titles and '''Spam''' / '''Stealth''' headers set the role,
    // an {{item|…}} (optionally `/`-joined alternatives with their marks) is one pick
    const tokens = box.matchAll(/\{\{infocard\/box[^|]*\|[^|]*\|\s*title\s*=\s*([^|]+)\||'''(Spam|Stealth)[^']*'''|\{\{[Ii]tem\|([^}|]+)(?:\|[^}]*)?\}\}((?:\s*'''[^']*''')?)(\s*\/\s*)?/g);
    let pending = null;
    const flush = () => { if (pending) picks.push(pending); pending = null; };
    for (const m of tokens) {
      if (m[1] !== undefined) { flush(); role = IEOR_ROLE[m[1].trim().toLowerCase()] ?? null; continue; }
      if (m[2]) { flush(); role = m[2].toLowerCase(); continue; }
      const raw = m[3].trim();
      const mod = raw.match(/@(.+)$/)?.[1] ?? raw.match(/\(([^)]+)\)\s*$/)?.[1] ?? null;
      const name = raw.replace(/^#/, '').replace(/@.*$/, '').replace(/\s*\((Thorium|Calamity|SOTS|Secrets Of The Shadows)\)\s*$/i, '').trim();
      const marks = marksOf(m[4] ?? '');
      const rec = { guide: 'ieor', tier, cls, kind, role, name: name.replace(/ armor$/i, ''), mod, armor: kind === 'armor' || / armor$/i.test(name), marks, alt: [] };
      if (pending) { pending.alt.push(rec.name); pending.marks = [...new Set([...pending.marks, ...marks])]; }
      else pending = rec;
      // a trailing `/` means the next item is an alternative of this one
      if (!m[5]) flush();
    }
    flush();
  }
  return picks;
}

// ---- dataset resolution ----------------------------------------------------------------------
const HEAD_WORDS = /\b(helmet|hat|mask|hood|headgear|helm|visage|cowl|crown|cap|facemask|head|circlet|garland|goggles|headpiece|tiara|veil|skull|plume)\b/i;
const norm = (s) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();

/** Resolve a pick's name against the dataset. Exported so guide-check can re-resolve alternatives. */
export function findItem(ds, pick, name = pick.name) {
  const n = norm(name);
  if (pick.armor) {
    const heads = ds.items.filter((it) => it.slot === 'head' && it.setItems?.length && norm(it.name).startsWith(n + ' ') && HEAD_WORDS.test(it.name.slice(name.length)));
    if (heads.length) return heads.sort((a, b) => (a.stage ?? 99) - (b.stage ?? 99))[0];
    const any = ds.items.filter((it) => it.slot === 'head' && it.setItems?.length && norm(it.name).startsWith(n));
    if (any[0]) return any[0];
    return ds.items.find((it) => norm(it.name) === n && (it.slot === 'head' || it.slot === 'body' || it.slot === 'legs')) ?? null;
  }
  // several mods can ship the same name (Thorium's Amethyst Ring and Blue Moon's): the guide means
  // the one you can actually have at the tier it lists, so the earliest wins
  const exact = ds.items.filter((it) => norm(it.name) === n).sort((a, b) => (a.stage ?? 99) - (b.stage ?? 99));
  if (exact.length) return exact.find((it) => (pick.kind === 'weapon' ? it.slot === 'weapon' : pick.kind === 'accessory' ? it.slot === 'accessory' : true)) ?? exact[0];
  if (pick.kind === 'ammo') return (ds.ammo ?? []).find((a) => norm(a.name) === n) ?? null;
  return null;
}

// ---- build -----------------------------------------------------------------------------------
/**
 * Every guide recommendation, staged and resolved against the dataset.
 * @param {object} ds  indexed dataset
 */
export async function buildGuides(ds, { refresh = false } = {}) {
  const raw = [...(await calamityGuide(refresh)), ...(await ieorGuide(refresh))];
  const tiers = { calamity: CAL_TIERS, ieor: IEOR_TIERS };
  const out = [];
  const missingTiers = new Set();
  for (const p of raw) {
    const t = tierStage(ds.stages, tiers[p.guide][p.tier]);
    if (!t) { missingTiers.add(`${p.guide}:${p.tier}`); continue; }
    const it = findItem(ds, p);
    out.push({
      guide: p.guide, tier: p.tier, tierBoss: t.boss, stage: t.stage,
      cls: p.cls, kind: p.kind, role: p.role ?? null,
      name: p.name, mod: p.mod ?? null, armor: p.armor || undefined,
      marks: p.marks.length ? p.marks : undefined,
      with: p.with || undefined,
      note: p.note || undefined,
      alt: p.alt.length ? p.alt : undefined,
      id: it?.id ?? null,
      itemStage: it?.stage ?? null,
    });
  }
  if (missingTiers.size) console.warn(`! no lab stage for: ${[...missingTiers].join(', ')}`);
  return out;
}

/** `data/guides.md`: one table per guide × tier × class, for reading by eye. */
function toMarkdown(picks) {
  const l = ['# Class-setup guides', '', 'Generated by `node tools/guides.mjs` from the Calamity and Infernal Eclipse of Ragnarok wikis.', '',
    'Marks: `†` risky/close range · `C` best on worms · `+` support · `≤` upgrades viable · `*` tedious to get · `ν` SOTS void · `Ω` pair with · `Δ` changed set bonus', ''];
  const key = (p) => `${p.guide}|${p.tier}`;
  const seen = [];
  for (const p of picks) if (!seen.includes(key(p))) seen.push(key(p));
  for (const k of seen) {
    const group = picks.filter((p) => key(p) === k);
    l.push(`## ${group[0].guide} · ${group[0].tier} → ${group[0].tierBoss} (stage ${group[0].stage})`, '');
    for (const cls of [...new Set(group.map((p) => p.cls))]) {
      l.push(`### ${cls}`, '', '| kind | role | item | marks | note | in dataset |', '| --- | --- | --- | --- | --- | --- |');
      for (const p of group.filter((x) => x.cls === cls)) {
        l.push(`| ${p.kind} | ${p.role ?? ''} | ${[p.name, ...(p.alt ?? [])].join(' / ')} | ${(p.marks ?? []).join(' ')}${p.with ? ` (${p.with})` : ''} | ${(p.note ?? '').replace(/\|/g, '\\|')} | ${p.id ?? '—'} |`);
      }
      l.push('');
    }
  }
  return l.join('\n');
}

// run as a script (not when guide-check or a test imports the parsers)
if (process.argv[1]?.replace(/\\/g, '/').endsWith('tools/guides.mjs')) {
  const { indexDataset } = await import('../src/lib/dataset.js');
  const ds = indexDataset(JSON.parse(readFileSync(new URL('../data/dataset.json', import.meta.url), 'utf8')));
  const picks = await buildGuides(ds, { refresh: process.argv.includes('--refresh') });
  writeFileSync(new URL('../data/guides.json', import.meta.url), JSON.stringify({ generatedAt: new Date().toISOString(), picks }, null, 0));
  writeFileSync(new URL('../data/guides.md', import.meta.url), toMarkdown(picks));
  const n = (f) => picks.filter(f).length;
  console.log(`${picks.length} guide picks (${n((p) => p.guide === 'calamity')} Calamity, ${n((p) => p.guide === 'ieor')} IEoR) over ${new Set(picks.map((p) => `${p.guide}|${p.tier}`)).size} tiers`);
  console.log(`  weapons ${n((p) => p.kind === 'weapon')}, armor ${n((p) => p.kind === 'armor')}, accessories ${n((p) => p.kind === 'accessory')}, buffs ${n((p) => p.kind === 'buff')}, ammo ${n((p) => p.kind === 'ammo')}`);
  console.log(`  ${n((p) => !p.id)} not in the dataset → data/guides.json, data/guides.md`);
}
