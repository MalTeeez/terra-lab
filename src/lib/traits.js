/**
 * Traits: the short, number-free names of what a loadout entry brings ("rogue damage",
 * "crit chance", "aggro", "on-hit spawn", "pierce", "wings"), read off the parts the solver
 * scored, so a section can be filtered by what is actually in it.
 */

const GEAR_RULES = [
  [/per stealth strike|\son hit$|\son crit$/, 'on-hit spawn'],
  [/^flight boost/, 'flight boost'],
  [/^flight/, 'flight'],
  [/sprint speed/, 'movement speed'],
  [/lava/, 'lava protection'], // the flag and the scored part name it differently
  [/set bonus/, 'set bonus'],
  [/stealth strike/, 'stealth strike bonus'],
];
const WEAPON_RULES = [
  [/pierce/, 'pierce'], [/homing/, 'homing'], [/gravity/, 'gravity arc'], [/spread/, 'spread'], [/velocity/, 'slow projectile'],
  [/destroys tiles/, 'destroys tiles'], [/walls/, 'through walls'], [/debuff/, 'inflicts debuffs'], [/child/, 'child projectiles'], [/projectiles per use/, 'multi-shot'],
  [/contact range/, 'true melee'], [/mana\/s/, 'mana hungry'], [/minion/, 'minion'], [/sentry/, 'sentry'], [/stealth/, 'stealth'],
];
const FLAG_TRAITS = { noKnockback: 'knockback immunity', knockbackImmune: 'knockback immunity', dash: 'dash', dashType: 'dash', jump: 'extra jump', debuffImmune: 'debuff immunity', lava: 'lava protection', lavaRose: 'lava protection', fireWalk: 'lava protection', iceSkate: 'mobility', waterWalk: 'mobility', mobility: 'mobility' };

/** A gear part's label without its numbers: "+27% rogue damage ½" → "rogue damage". */
/**
 * How a weapon's grade tag reads: the colour tells a whip from a minion from a sentry at a glance,
 * because a summoner wears one of each rather than choosing between them. Rogue's stealth and spam
 * are the other kind of tag — two ways to use the same weapon — and keep their own colour.
 */
export const MODE_TAG = {
  stealth: { color: 'plum', tip: 'Graded by its stealth strike rather than by spamming it.' },
  spam: { color: '', tip: 'Graded by its normal attacks rather than by its stealth strike.' },
  whip: { color: 'teal', tip: 'A whip is worn alongside the minions, not instead of them: it tags the boss and buys them damage.' },
  minion: { color: 'green', tip: 'Minion damage, per minion slot it costs.' },
  sentry: { color: 'info', tip: 'A sentry stands where you put it, so it only connects while the fight comes back to it.' },
};

export function traitOfLabel(label) {
  for (const [re, t] of GEAR_RULES) if (re.test(label)) return t;
  const s = label.replace(/[½⅙]/g, '').replace(/\(.*?\)/g, '').replace(/[+\-−]?\d+(?:\.\d+)?%?/g, '').replace(/[×:]/g, ' ').replace(/\s+/g, ' ').trim();
  return s || null;
}

/** Every trait of a loadout entry (accessory, weapon row or armor set). */
export function traitsOf(e) {
  const out = new Set();
  const it = e.item ?? e.head?.item;
  const weapon = it?.slot === 'weapon';
  const partsOf = (parts) => {
    for (const p of parts ?? []) {
      if (weapon) { for (const [re, t] of WEAPON_RULES) if (re.test(p.label)) out.add(t); continue; }
      const t = traitOfLabel(p.label);
      if (t) out.add(t);
    }
  };
  partsOf(e.parts);
  if (e.head) { for (const k of ['head', 'body', 'legs']) partsOf(e[k]?.parts); if (e.bonus?.parts?.length) out.add('set bonus'); out.add(e.isSet ? 'full set' : 'mixed pieces'); }
  if (e.stealth || e.mode === 'stealth') out.add('stealth');
  if (e.mode === 'spam') out.add('spam');
  if (e.group) out.add(e.group);
  if (it?.wings) out.add('wings');
  if (it?.boots) out.add('boots');
  if (it?.changes?.length) out.add('rebalanced');
  if (e.prefix) out.add('reforged');
  if (it?.useAmmo) out.add('uses ammo');
  for (const s of it?.effects?.onHit ?? []) out.add(s.hurt ? 'retaliation' : 'on-hit spawn');
  if (it?.condStats?.length) out.add('conditional');
  if (it?.placeholders && it?.effects?.via?.length) out.add('runtime formula');
  for (const f of it?.effects?.flags ?? []) if (FLAG_TRAITS[f]) out.add(FLAG_TRAITS[f]);
  for (const f of it?.flags ?? []) if (FLAG_TRAITS[f]) out.add(FLAG_TRAITS[f]);
  if (it?.cls) out.add(it.cls);
  return [...out].sort();
}

/** Trait → how many entries have it, most common first. */
export function traitCounts(entries) {
  const m = new Map();
  for (const e of entries) for (const t of traitsOf(e)) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Does an entry match a free-text query (every word; a leading "-" excludes) and every selected trait? */
export function matches(e, query, selected = []) {
  const traits = traitsOf(e);
  if (selected.some((t) => !traits.includes(t))) return false;
  const terms = (query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const items = e.head ? [e.head.item, e.body.item, e.legs.item] : [e.item];
  const hay = [...items.flatMap((it) => [it.name, it.tooltip ?? '', it.setBonus ?? '', it.modName ?? '']), ...traits].join(' | ').toLowerCase();
  return terms.every((t) => (t.startsWith('-') ? t.length === 1 || !hay.includes(t.slice(1)) : hay.includes(t)));
}
