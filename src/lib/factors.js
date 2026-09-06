/**
 * What kind of thing a scored part is, so a breakdown reads as more than a list of numbers: the
 * label is coloured by where the factor comes from and says so on hover, and the number is coloured
 * by which way it moved the score.
 *
 * Weapons and gear are scored by different machinery (dps.js vs score.js) and never appear in the
 * same list, so they get their own rules and are free to reuse the same colours.
 */

export const FACTORS = {
  // ---- weapon (real DPS)
  damage: { label: 'Damage', color: 'var(--color-green-deep)', hint: 'How hard a single hit lands, counting the damage the weapon does, the class bonus your loadout carries and its crit chance.' },
  hits: { label: 'Hits', color: 'var(--color-teal)', hint: 'How often the weapon connects, counting its use time, the shots it fires and the projectiles those spawn.' },
  landing: { label: 'Landing', color: 'var(--color-info)', hint: 'How much of what the weapon fires actually reaches the boss.' },
  target: { label: 'The target', color: 'var(--color-plum)', hint: 'What the boss itself takes away through its defense, its immunity frames and the size of its body.' },
  debuff: { label: 'Debuffs', color: 'var(--color-warn)', hint: 'The damage the weapon keeps doing after the hit through the debuffs it inflicts.' },
  resource: { label: 'Upkeep', color: 'var(--color-plum)', hint: 'What keeping the weapon in use costs you out of a bar that refills on its own — mana, void, health, or a thrower’s exhaustion.' },
  cost: { label: 'What it costs you', color: 'var(--color-bad)', hint: 'What using the weapon costs you outside the fight, like standing too close or wrecking your own arena.' },
  // ---- gear (score)
  survival: { label: 'Survival', color: 'var(--color-info)', hint: 'How much punishment you can take, counting defense, life and the immunities that come with the piece.' },
  mobility: { label: 'Mobility', color: 'var(--color-teal)', hint: 'How fast you move and how well you can fly, jump or dash out of the way.' },
  utility: { label: 'Utility', color: 'var(--color-dim)', hint: 'Everything else the piece gives you that is not damage, survival or speed.' },
};

const WEAPON_RULES = [
  [/destroys tiles|does not stand there/, 'cost'],
  [/\([\d.]+ DPS\)|debuffs?, .*(is immune|immune)/, 'debuff'],
  [/mana\/s|mana per/, 'resource'],
  [/defense |armor pen|immunity window|pierces? |infinite pierce|stay on target|segments|targets/, 'target'],
  [/px|spread|homing|walls|arc drops|reaches|% of the time|chasing the boss|stationary|land\)/, 'landing'],
  [/\(\+[\d.]+ hits|tick|hits\/s|projectiles per use|shots|out and back|one out at a time|per minion|per sentry|capped|alternative shots|fan |summon tag|slots?\b/, 'hits'],
  [/damage|crit|^[\d.]+ \+ [\d.]+ \(/, 'damage'],
];

const GEAR_RULES = [
  [/damage reduction|defense|max life|life regen|dodge|invincibility|immunity|lava|fire protection|knockback|shield|thorns/, 'survival'],
  [/movement speed|run speed|sprint|flight|jump|dash|mobility|acceleration|wings|boots/, 'mobility'],
  [/mana|healing|potion/, 'resource'],
  [/damage|crit|attack speed|armor pen|minion slot|sentry slot|whip|stealth|ammo|on hit|throwing velocity/, 'damage'],
  [/aggro|quality of life|fishing|luck|light/, 'utility'],
];

/**
 * The factor a part belongs to. `weapon` picks the rule set — the two never share a list.
 *
 * A part that says what it is (`fac`) is taken at its word: dps.js knows whether a line is a hit
 * count or a property of the boss, and its labels are prose that reads a dozen ways — "infinite
 * pierce: 2.6 hits (…, 6 targets, 52% stay on target)" is a hits multiplier that mentions the
 * target three times. The regexes stay for gear (score.js), whose labels are stat names.
 */
export function factorOf(part, weapon = false) {
  if (typeof part !== 'string' && FACTORS[part?.fac]) return part.fac;
  const label = typeof part === 'string' ? part : part?.label ?? '';
  const rules = weapon ? WEAPON_RULES : GEAR_RULES;
  for (const [re, key] of rules) if (re.test(label)) return key;
  return 'utility';
}

/** Which way the part moved the number: +1 up, -1 down, 0 neither. A `mul` is a factor on the total. */
export function signOf(p, weapon = false) {
  if (p?.mul !== undefined) return p.mul > 1.001 ? 1 : p.mul < 0.999 ? -1 : 0;
  if (p?.value === undefined) return 0;
  // a plain value in a weapon chain is a running total — the damage left after the boss's defense,
  // not a gain of 177. Only the multipliers there say which way a factor pushed.
  return weapon ? 0 : Math.sign(p.value);
}

export const SIGN_COLOR = { '-1': 'var(--color-bad)', 1: 'var(--color-green-deep)', 0: '' };

/** Category name and description for a part's `data-tip`, with its own arithmetic kept underneath. */
export function factorTip(p, weapon = false) {
  const f = FACTORS[factorOf(p, weapon)];
  return p.detail ? `${f.label}\n${f.hint}\n\n${p.detail}` : `${f.label}\n${f.hint}`;
}
