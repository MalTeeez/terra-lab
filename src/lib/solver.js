/**
 * Loadout solver: best armor (full set or mixed pieces), top weapons and a greedy
 * accessory fill for a class at a gamestage — from everything obtainable or only from
 * the gear the user owns, honouring pins, exclusions and reforges.
 */
import { ammoAt, SLOT_MODES } from './dps.js';
import { W, accessoryGroup, foreignClass, loadoutBonus, pieceScore, setBonusScore, sprintFactor, weaponDps } from './score.js';
import { bestPrefix, prefixesFor, scopedItem } from './stats.js';

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
  const statCtx = { conds: opts.conds ?? new Set(), uncertain: !!opts.uncertain, calibration: opts.calibration ?? null, aliases, playstyle: opts.playstyle ?? null, target: opts.target ?? null, targets: opts.targets ?? 'auto', balanceMods: opts.balanceMods ?? null };
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
      scoreOf: (item, p) => pieceScore(scopedItem(item, statCtx), cls, aliases, { prefix: p }).score,
    });
  };
  const decorate = (it) => ({ owned: isOwned(it), pinned: pinned.has(it.id) });
  // what defense and minion slots are worth follows the stage's progression value; the reforge
  // choice does not, so the timeline shares it across stages (solveTimeline owns the cache)
  const progression = ds.stages[stage]?.progression;
  const cache = opts.cache ?? { piece: new Map(), acc: new Map(), prefix: new Map() };
  const key = (it) => `${it.id}|${cls}|${progression}`;
  // A piece is scored as *this* balance scope sees it: a guide judged at its own content's balance
  // must not be handed the overlays of mods it does not include. `effectiveStats` does this for a
  // weapon's numbers by replaying `changes` from `base`; `scopedItem` is the same answer for the
  // equip effects, which have no `base` to replay from.
  const scoped = new Map();
  const inScope = (it) => {
    if (!scoped.has(it.id)) scoped.set(it.id, scopedItem(it, statCtx));
    return scoped.get(it.id);
  };
  // a weapon's best reforge is picked on DPS alone, so it is the same whatever class is in view;
  // an accessory's is picked on its class score, so that one is keyed per class
  const reforgeOf = (it) => {
    const k = it.slot === 'weapon' ? it.id : `${it.id}|${cls}`;
    if (!cache.prefix.has(k)) cache.prefix.set(k, prefixFor(it));
    return cache.prefix.get(k);
  };

  // ---- armor ------------------------------------------------------------------------------
  const scoreOf = (it) => {
    let s = cache.piece.get(key(it));
    if (!s) cache.piece.set(key(it), (s = pieceScore(inScope(it), cls, aliases, { progression })));
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
  // A Calamity rogue without maximum stealth cannot use the class's defining stealth strikes.
  // Treat that as a loadout requirement, rather than letting three individually strong pieces (or
  // a generic full set) beat functional rogue armor on their raw stat total. Keep the ordinary
  // fallback when no complete stealth-granting set is obtainable, which matters for partial owned
  // inventories and pinned pieces.
  const stealthSets = (cls === 'rogue' || cls === 'thrower') ? sets.filter((s) => armorStealth(s) > 0) : sets;
  const viableSets = stealthSets.length ? stealthSets : sets;
  let mixed = null;
  if (bestBySlot.head && bestBySlot.body && bestBySlot.legs) {
    const score = bestBySlot.head.score + bestBySlot.body.score + bestBySlot.legs.score;
    mixed = { isSet: false, head: bestBySlot.head, body: bestBySlot.body, legs: bestBySlot.legs, bonus: { score: 0, parts: [] }, score: Math.round(score * 10) / 10, defense: ARMOR.reduce((s, k) => s + (bestBySlot[k].item.defense ?? 0), 0) };
  }
  let best = null;
  if (requireSet && viableSets.length) best = viableSets[0];
  else if (stealthSets.length && (cls === 'rogue' || cls === 'thrower')) best = stealthSets[0];
  else if (viableSets.length && (!mixed || viableSets[0].score >= mixed.score)) best = viableSets[0];
  else best = mixed;
  // `armorPick` (a head item id) wears a runner-up set instead: everything downstream — the set
  // bonus, max stealth, the weapon ranking — is solved as if that set were the pick
  const armor = (opts.armorPick && viableSets.find((s) => s.head.item.id === opts.armorPick)) || best;
  const armorAlternatives = viableSets.filter((s) => s !== armor).slice(0, 12);

  // ---- accessories ------------------------------------------------------------------------
  const accOf = (it) => {
    let a = cache.acc.get(key(it));
    if (!a) { const prefix = reforgeOf(it); cache.acc.set(key(it), (a = { prefix, ...pieceScore(inScope(it), cls, aliases, { prefix, progression }), group: accessoryGroup(it) })); }
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

  // ---- weapons (after the gear: stealth strikes scale with the set's max stealth, and what the
  // loadout carries in class damage and crit is what the weapon is actually swung with) ----------
  const worn = [armor?.head, armor?.body, armor?.legs, ...picks, wings[0], boots[0]];
  if (armor?.isSet) worn.push({ item: { effects: armor.head.item.setEffects, stats: armor.head.item.setStats } });
  // Calamity zeroes `rogueStealthMax` every frame, so what is worn is all of it: a full rogue set
  // (the piece pushed above carries its bonus) and the few accessories that add to it. Three pieces
  // that do not make a set never fire the head's bonus, and gear that grants none means no stealth
  // bar at all — not the default a weapon is graded with when there is no loadout to ask.
  const stealthMax = armor ? worn.reduce((s, w) => s + stealthOf(w?.item), 0) : undefined;
  // …and what it carries for another class, for a void weapon that is a melee or ranged weapon
  // underneath (SOTS's VoidMelee inherits every melee modifier along with the void ones)
  const weaponCtx = { ...statCtx, ds, stage, stealthMax, loadout: loadoutBonus(worn, cls, aliases, progression), loadoutFor: (c) => loadoutBonus(worn, c, aliases, progression) };
  const weapons = pool
    .filter((it) => it.slot === 'weapon' && it.cls === cls && (it.damage ?? 0) > 0)
    .map((it) => { const prefix = reforgeOf(it); return { item: it, prefix, ...decorate(it), ...weaponDps(it, { ...weaponCtx, prefix }) }; })
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.value - a.value);
  // A summoner's whip, minions and sentry are worn together, and the pool holds far more whips than
  // the list has rows: sorted by value alone, 30 of the 40 came back whips and the minions fell off
  // the end. Each slot gets a share of the list first, then the best of what is left fills it up.
  // The order is still by value — only which 40 survive changes.
  const wornAtOnce = [...new Set(weapons.map((w) => w.mode).filter((m) => SLOT_MODES.has(m)))];
  const share = wornAtOnce.length > 1 ? Math.ceil(40 / (wornAtOnce.length + 1)) : Infinity;
  const seenNames = new Set();
  const took = new Map();
  const topWeapons = [];
  for (const pass of [0, 1]) {
    for (const w of weapons) {
      if (topWeapons.length >= 40) break;
      if (seenNames.has(w.item.name)) continue;
      if (pass === 0 && (took.get(w.mode) ?? 0) >= share) continue;
      seenNames.add(w.item.name);
      took.set(w.mode, (took.get(w.mode) ?? 0) + 1);
      topWeapons.push(w);
    }
  }
  topWeapons.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.value - a.value);

  // ---- ammo ---------------------------------------------------------------------------------
  // A gun and its ammo are two picks a ranged player makes separately, so they are ranked apart:
  // the weapon is graded on the plainest ammo of its kind, and each ammo is graded by what the
  // best gun of that kind does with it. Ranking is only meaningful inside a kind — a rocket and a
  // musket ball are not alternatives — so the kind rides along.
  const ammo = [];
  for (const kind of new Set(weapons.map((w) => w.item.useAmmo).filter((k) => k > 0))) {
    const gun = weapons.find((w) => w.item.useAmmo === kind);
    for (const a of ammoAt(ds, kind, stage)) {
      const v = weaponDps(gun.item, { ...weaponCtx, prefix: gun.prefix, ammo: a });
      ammo.push({ item: a, kind, kindName: ds.ammoKinds?.[kind] ?? String(kind), gun: gun.item, mode: 'ammo', value: v.value, parts: v.parts });
    }
  }
  // grouped by kind, strongest kind first: ordering a rocket against a musket ball would only bury
  // whichever kind the stage happens to be weak in, and both are picks a player actually makes
  const bestOf = new Map();
  for (const a of ammo) bestOf.set(a.kind, Math.max(bestOf.get(a.kind) ?? 0, a.value));
  ammo.sort((a, b) => bestOf.get(b.kind) - bestOf.get(a.kind) || a.kind - b.kind || b.value - a.value);

  // Best pick if the fight were pure single-body / pure crowd, from the top of the current ranking.
  // ponytail: rescoring the top 25 catches the real winner in almost every case; a niche weapon that
  // never makes the top-25 under the user's `targets` will be missed. Widen the window if reports say.
  const bestByTarget = (t) => {
    let best = null;
    for (const w of topWeapons.slice(0, 25)) {
      const v = weaponDps(w.item, { ...weaponCtx, prefix: w.prefix, targets: t });
      if (!best || v.value > best.value) best = { ...w, value: v.value, parts: v.parts, targets: t };
    }
    return best;
  };
  const weaponSingle = bestByTarget('single');
  const weaponMulti = bestByTarget('multi');

  // ---- potions ------------------------------------------------------------------------------
  // What to drink before the fight, graded exactly like a piece of gear: a buff is a stat bonus
  // that happens to run out. The ones whose buff does nothing the score model reads (a spelunker,
  // a fishing potion) score 0 and fall to the end of the list, where the panel calls them utility.
  const rankedPotions = pool
    .filter((it) => it.slot === 'potion' && !foreignClass(it, cls, aliases))
    .map((it) => ({ item: it, ...scoreOf(it) }))
    // …the earliest of equals first: eight fruits granting the same Well Fed are one pick, and the
    // one worth naming is the one you can already get
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.score - a.score || a.item.stage - b.item.stage || a.item.name.localeCompare(b.item.name));
  const seenBuff = new Set();
  const potions = rankedPotions.filter((p) => {
    if (!p.item.buff) return true;
    if (seenBuff.has(p.item.buff)) return false;
    seenBuff.add(p.item.buff);
    return true;
  }).slice(0, 30);

  return {
    cls,
    stage,
    stageLabel: ds.stages[stage]?.label ?? '?',
    poolSize: pool.length,
    source: opts.source ?? 'all',
    weapons: topWeapons,
    weaponSingle,
    weaponMulti,
    weaponCount: weapons.length,
    bonus: weaponCtx.loadout,
    ammo,
    stealthMax,
    armor,
    armorAlternatives,
    armorPicked: !!armor && armor !== best, // a runner-up is worn, not the solver's own pick
    armorBestScore: best?.score ?? null,
    accessories: picks,
    accessoryAlternatives: alternatives,
    accessoryCount: accs.length,
    wings,
    boots,
    potions,
  };
}

/** Max stealth one worn piece grants (Calamity `rogueStealthMax`, in units of 100). */
function stealthOf(it) {
  const s = it?.effects?.mod?.rogueStealthMax ?? 0;
  // the text where the code was silent, same rule as `mergedStat`: "+60 maximum stealth" is 0.6 here
  return s || (it?.stats?.stealthFlat ?? 0) / 100;
}

/** Maximum stealth supplied by an armor choice, including a full set's bonus. */
function armorStealth(armor) {
  if (!armor) return 0;
  const pieces = [armor.head?.item, armor.body?.item, armor.legs?.item];
  if (armor.isSet) pieces.push({ effects: armor.head?.item.setEffects, stats: armor.head?.item.setStats });
  return pieces.reduce((sum, item) => sum + stealthOf(item), 0);
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
      weaponSingle: packPiece(r.loadout.weaponSingle),
      weaponMulti: packPiece(r.loadout.weaponMulti),
      accessories: r.loadout.accessories.map(packPiece),
      accessoryAlternatives: r.loadout.accessoryAlternatives.map(packPiece),
      wings: r.loadout.wings.map(packPiece),
      boots: r.loadout.boots.map(packPiece),
      potions: r.loadout.potions.map(packPiece),
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
      weaponSingle: piece(r.loadout.weaponSingle),
      weaponMulti: piece(r.loadout.weaponMulti),
      accessories: r.loadout.accessories.map(piece),
      accessoryAlternatives: r.loadout.accessoryAlternatives.map(piece),
      wings: r.loadout.wings.map(piece),
      boots: r.loadout.boots.map(piece),
      potions: r.loadout.potions.map(piece),
    },
  }));
}
