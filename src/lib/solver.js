/**
 * Loadout solver: best armor (full set or mixed pieces), top weapons and a greedy
 * accessory fill for a class at a gamestage — from everything obtainable or only from
 * the gear the user owns, honouring pins, exclusions and reforges.
 */
import { W, accessoryGroup, foreignClass, pieceScore, setBonusScore, sprintFactor, weaponDps } from './score.js';
import { bestPrefix, prefixesFor } from './stats.js';

/** Items obtainable at `stage` from mods that are not excluded (or the owned set). */
export function candidates(ds, { stage, excludedMods = new Set(), unknownStage = false, source = 'all', owned = {}, excluded = new Set() }) {
  return ds.items.filter((it) => {
    if (excluded.has(it.id)) return false;
    if (source === 'owned') return it.id in owned;
    if (excludedMods.has(it.mod)) return false;
    if (it.stage === null || it.stage === undefined) return unknownStage;
    return it.stage <= stage;
  });
}

const ARMOR = ['head', 'body', 'legs'];

/**
 * @param {object} ds       indexed dataset
 * @param {object} opts     { cls, stage, excludedMods, slots, requireSet, unknownStage,
 *                            conds, uncertain, reforge: 'best'|'none'|<prefixId>, owned: {id: {prefix}},
 *                            source: 'all'|'owned', pinned: Set, excluded: Set, calibration }
 */
export function solveLoadout(ds, opts) {
  const { cls, stage, slots = 6, requireSet = false, reforge = 'none', owned = {}, pinned = new Set() } = opts;
  const aliases = ds.aliases ?? {};
  const prefixes = ds.prefixes ?? [];
  const statCtx = { conds: opts.conds ?? new Set(), uncertain: !!opts.uncertain, calibration: opts.calibration ?? null, aliases };
  const pool = candidates(ds, opts);
  const poolIds = new Set(pool.map((i) => i.id));
  const isOwned = (it) => it.id in owned;

  /**
   * The reforge an item is evaluated with: its owned prefix, else what the reforge setting asks
   * for — 'none', a named prefix (items that cannot roll it fall back to their best), or 'best'.
   */
  const prefixFor = (it) => {
    const own = owned[it.id];
    if (own?.prefix) return ds.prefixById.get(own.prefix) ?? null;
    if (own && own.prefix === null) return null;
    if (reforge === 'none' || !reforge) return null;
    if (reforge !== 'best') {
      const want = ds.prefixById.get(reforge);
      if (want && prefixesFor(it, prefixes, aliases).some((p) => p.id === want.id)) return want;
    }
    return bestPrefix(it, prefixes, statCtx, {
      dpsOf: (item, p) => weaponDps(item, { ...statCtx, ds, stage, prefix: p }).value,
      scoreOf: (item, p) => pieceScore(item, cls, aliases, { prefix: p }).score,
    });
  };
  const decorate = (it) => ({ owned: isOwned(it), pinned: pinned.has(it.id) });
  // what defense and minion slots are worth follows the stage's progression value; the reforge
  // choice does not, so the timeline shares it across stages (solveTimeline owns the cache)
  const progression = ds.stages[stage]?.progression;
  const cache = opts.cache ?? { piece: new Map(), acc: new Map(), prefix: new Map() };
  const key = (it) => `${it.id}|${progression}`;
  const reforgeOf = (it) => {
    if (!cache.prefix.has(it.id)) cache.prefix.set(it.id, prefixFor(it));
    return cache.prefix.get(it.id);
  };

  // ---- armor ------------------------------------------------------------------------------
  const scoreOf = (it) => {
    let s = cache.piece.get(key(it));
    if (!s) cache.piece.set(key(it), (s = pieceScore(it, cls, aliases, { progression })));
    return { ...s, ...decorate(it) };
  };
  const armorPool = pool.filter((it) => ARMOR.includes(it.slot) && !foreignClass(it, cls, aliases));
  const pinnedArmor = {};
  for (const it of armorPool) if (pinned.has(it.id)) pinnedArmor[it.slot] ??= it;
  const bestBySlot = {};
  for (const it of armorPool) {
    if (pinnedArmor[it.slot] && pinnedArmor[it.slot] !== it) continue;
    const s = scoreOf(it);
    if (!bestBySlot[it.slot] || s.score > bestBySlot[it.slot].score) bestBySlot[it.slot] = { item: it, ...s };
  }
  const sets = [];
  for (const head of armorPool) {
    if (head.slot !== 'head' || !head.setItems?.length) continue;
    const body = head.setItems.find((p) => p.slot === 'body');
    const legs = head.setItems.find((p) => p.slot === 'legs');
    if (!body || !legs || !poolIds.has(body.id) || !poolIds.has(legs.id)) continue;
    if (ARMOR.some((s) => pinnedArmor[s] && pinnedArmor[s] !== { head, body, legs }[s])) continue;
    const bonus = setBonusScore(head, cls, aliases, { progression });
    const pieces = [head, body, legs].map((p) => ({ item: p, ...scoreOf(p) }));
    // a per-tick velocity drag compounds across the pieces (Mollusk: 0.996 each, 0.988 together
    // kills the sprint): score the set's combined drag instead of the sum of the pieces' own
    const drags = [head, body, legs].map((p) => p.effects?.velocityDrag ?? 1);
    const combined = drags.reduce((a, b) => a * b, 1) * (head.setEffects?.velocityDrag ?? 1);
    if (combined < 1) {
      const extra = (sprintFactor(combined) - 1) * W.moveSpeed - drags.reduce((s, d) => s + (sprintFactor(d) - 1) * W.moveSpeed, 0);
      if (Math.abs(extra) > 0.05) { bonus.parts = [...bonus.parts, { label: `${Math.round((sprintFactor(combined) - 1) * 100)}% sprint speed with all pieces (drag ${combined.toFixed(3)} per tick)`, value: Math.round(extra * 10) / 10 }]; bonus.score = Math.round((bonus.score + extra) * 10) / 10; }
    }
    const score = pieces.reduce((s, p) => s + p.score, 0) + bonus.score;
    sets.push({ isSet: true, head: pieces[0], body: pieces[1], legs: pieces[2], bonus, score: Math.round(score * 10) / 10, defense: pieces.reduce((s, p) => s + (p.item.defense ?? 0), 0) });
  }
  sets.sort((a, b) => b.score - a.score);
  let mixed = null;
  if (bestBySlot.head && bestBySlot.body && bestBySlot.legs) {
    const score = bestBySlot.head.score + bestBySlot.body.score + bestBySlot.legs.score;
    mixed = { isSet: false, head: bestBySlot.head, body: bestBySlot.body, legs: bestBySlot.legs, bonus: { score: 0, parts: [] }, score: Math.round(score * 10) / 10, defense: ARMOR.reduce((s, k) => s + (bestBySlot[k].item.defense ?? 0), 0) };
  }
  let armor = null;
  if (requireSet && sets.length) armor = sets[0];
  else if (sets.length && (!mixed || sets[0].score >= mixed.score)) armor = sets[0];
  else armor = mixed;
  const armorAlternatives = sets.filter((s) => s !== armor).slice(0, 12);

  // ---- weapons (after armor: Calamity stealth strikes scale with the set's max stealth) ----
  const stealthMax = armor ? ARMOR.reduce((s, k) => s + stealthOf(armor[k].item), 0) || undefined : undefined;
  const weaponCtx = { ...statCtx, ds, stage, stealthMax };
  const weapons = pool
    .filter((it) => it.slot === 'weapon' && it.cls === cls && (it.damage ?? 0) > 0)
    .map((it) => { const prefix = prefixFor(it); return { item: it, prefix, ...decorate(it), ...weaponDps(it, { ...weaponCtx, prefix }) }; })
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.value - a.value);
  const seenNames = new Set();
  const topWeapons = [];
  for (const w of weapons) {
    if (seenNames.has(w.item.name)) continue;
    seenNames.add(w.item.name);
    topWeapons.push(w);
    if (topWeapons.length >= 40) break;
  }

  // ---- accessories ------------------------------------------------------------------------
  const accOf = (it) => {
    let a = cache.acc.get(key(it));
    if (!a) { const prefix = reforgeOf(it); cache.acc.set(key(it), (a = { prefix, ...pieceScore(it, cls, aliases, { prefix, progression }), group: accessoryGroup(it) })); }
    return a;
  };
  const ranked = pool
    .filter((it) => it.slot === 'accessory' && !foreignClass(it, cls, aliases))
    .map((it) => ({ item: it, ...accOf(it), ...decorate(it) }))
    .filter((a) => a.score > 0 || a.pinned)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.score - a.score);
  // wings are their own ranked list: everyone wears exactly one pair, so they never compete for a slot
  const wings = ranked.filter((a) => a.group === 'wings').slice(0, 40);
  const boots = ranked.filter((a) => a.group === 'boots').slice(0, 40);
  const accs = ranked.filter((a) => a.group !== 'wings' && a.group !== 'boots');
  const picks = [];
  const usedGroups = new Set();
  const usedNames = new Set();
  const alternatives = [];
  for (const a of accs) {
    if (picks.length >= slots) { if (alternatives.length < 40) alternatives.push(a); continue; }
    if (usedNames.has(a.item.name)) continue;
    if (a.group && usedGroups.has(a.group) && !a.pinned) { if (alternatives.length < 40) alternatives.push(a); continue; }
    picks.push(a);
    usedNames.add(a.item.name);
    if (a.group) usedGroups.add(a.group);
  }

  return {
    cls,
    stage,
    stageLabel: ds.stages[stage]?.label ?? '?',
    poolSize: pool.length,
    source: opts.source ?? 'all',
    weapons: topWeapons,
    weaponCount: weapons.length,
    stealthMax,
    armor,
    armorAlternatives,
    accessories: picks,
    accessoryAlternatives: alternatives,
    accessoryCount: accs.length,
    wings,
    boots,
  };
}

/** Max stealth a piece grants (Calamity `rogueStealthMax`, in units of 100). */
function stealthOf(it) {
  const s = (it.setEffects?.mod?.rogueStealthMax ?? 0) + (it.effects?.mod?.rogueStealthMax ?? 0);
  return s;
}

/** One loadout per stage, with what changed since the previous stage. */
export function solveTimeline(ds, opts, onProgress) {
  const rows = [];
  let prev = null;
  const cache = { piece: new Map(), acc: new Map(), prefix: new Map() };
  for (const s of ds.stages) {
    const lo = solveLoadout(ds, { ...opts, stage: s.index, cache });
    onProgress?.(rows.length + 1, ds.stages.length);
    const changes = new Set();
    if (prev) {
      if (lo.weapons[0]?.item.id !== prev.weapons[0]?.item.id) changes.add('weapon');
      if (lo.armor?.head.item.id !== prev.armor?.head.item.id || lo.armor?.body.item.id !== prev.armor?.body.item.id || lo.armor?.legs.item.id !== prev.armor?.legs.item.id) changes.add('armor');
      const a = lo.accessories.map((x) => x.item.id).join();
      const b = prev.accessories.map((x) => x.item.id).join();
      if (a !== b) changes.add('accessories');
    } else {
      changes.add('weapon'); changes.add('armor'); changes.add('accessories');
    }
    rows.push({ stage: s, loadout: lo, changes });
    prev = lo;
  }
  return rows;
}

/**
 * Timeline rows as plain data a worker can post back: item / prefix objects become ids (the
 * dataset is far too big to clone) and the change Sets become arrays. `unpackTimeline` reverses it
 * against the main thread's own dataset, so the rows come out identical to a local solve.
 */
const packPiece = (p) => p && { ...p, item: p.item.id, prefix: p.prefix?.id ?? null };
const packArmor = (a) => a && { ...a, head: packPiece(a.head), body: packPiece(a.body), legs: packPiece(a.legs) };
export function packTimeline(rows) {
  return rows.map((r) => ({
    stage: r.stage.index,
    changes: [...r.changes],
    loadout: {
      ...r.loadout,
      armor: packArmor(r.loadout.armor),
      armorAlternatives: r.loadout.armorAlternatives.map(packArmor),
      weapons: r.loadout.weapons.map(packPiece),
      accessories: r.loadout.accessories.map(packPiece),
      accessoryAlternatives: r.loadout.accessoryAlternatives.map(packPiece),
      wings: r.loadout.wings.map(packPiece),
      boots: r.loadout.boots.map(packPiece),
    },
  }));
}

export function unpackTimeline(ds, packed) {
  const piece = (p) => p && { ...p, item: ds.byId.get(p.item), prefix: p.prefix ? ds.prefixById.get(p.prefix) ?? null : null };
  const armor = (a) => a && { ...a, head: piece(a.head), body: piece(a.body), legs: piece(a.legs) };
  return packed.map((r) => ({
    stage: ds.stages[r.stage],
    changes: new Set(r.changes),
    loadout: {
      ...r.loadout,
      armor: armor(r.loadout.armor),
      armorAlternatives: r.loadout.armorAlternatives.map(armor),
      weapons: r.loadout.weapons.map(piece),
      accessories: r.loadout.accessories.map(piece),
      accessoryAlternatives: r.loadout.accessoryAlternatives.map(piece),
      wings: r.loadout.wings.map(piece),
      boots: r.loadout.boots.map(piece),
    },
  }));
}
