/**
 * Class detection (DamageClass name → class) and tooltip stat parsing.
 */

export const CLASSES = ['melee', 'ranged', 'magic', 'summon', 'rogue', 'thrower', 'bard', 'healer', 'classless'];

/** DamageClass type/property name → class key. */
export function classOf(dcName) {
  if (!dcName) return null;
  const n = dcName;
  if (/rogue|stealth/i.test(n)) return 'rogue';
  if (/bard|symphon/i.test(n)) return 'bard';
  if (/healer|radiant/i.test(n)) return 'healer';
  if (/throw/i.test(n)) return 'thrower';
  if (/magicsummon/i.test(n)) return 'magic';
  if (/summon|minion|whip/i.test(n)) return 'summon';
  if (/magic/i.test(n)) return 'magic';
  if (/ranged|range/i.test(n)) return 'ranged';
  if (/melee/i.test(n)) return 'melee';
  // anchored: a mod's own class can carry one of these words (SOTS's void class is `VoidGeneric`,
  // and its crit only applies to void strikes) — that is its own class, not everyone's
  if (/^(generic|default|average|allclass|classless|true)(damage)?(class)?$/i.test(n)) return 'classless';
  return 'other';
}

/** Strip chat tags and colour codes from tooltip text. */
export function cleanText(s) {
  if (!s) return '';
  return s
    .replace(/\[c\/[0-9a-f]{6}:([^\]]*)\]/gi, '$1')
    .replace(/\[cbuff:[^\]\/]*\/([^\]]*)\]/gi, (_, n) => deCamelWords(n))
    .replace(/\[i(?:\/s\d+)?:[^\]]*\]/gi, '')
    .replace(/\[[a-z]+:([^\]]*)\]/gi, '$1')
    .replace(/\[DAMAGELINE\]|\[STEALTHLINE\]|\[PARRYLINE\]|\[BONUSLINE\]/g, '')
    .replace(/\r/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

const deCamelWords = (n) => n.replace(/([a-z\d])([A-Z])/g, '$1 $2');

const CLASS_WORDS = {
  melee: /\bmelee\b/i,
  ranged: /\branged\b/i,
  magic: /\bmagic(?:al)?\b/i,
  summon: /\bsummon(?:er|ing)?\b|\bminion\b|\bwhip\b|\bsentr(?:y|ies)\b/i,
  rogue: /\brogue\b|\bstealth\b/i,
  thrower: /\bthrow(?:ing|n|er)\b/i,
  bard: /\bsymphonic\b|\bbard\b|\binspiration\b|\bempowerment/i,
  healer: /\bradiant\b|\bhealer\b|\bhealing\b|\bheal(?:s|ed)?\b/i,
};

const CONDITIONAL = /\b(?:when|while|if|after|during|until|instead|only|upon|every|against|nearby|above|below|dealing|deals?|summons?|releases?|fires?|shoots?|creates?|spawns?|strikes?)\b|\bfor \d|\bper |\bmay |\bchance to|\bto enemies|\bof the|\bon hit|\binside\b|\bwithin\b/i;
// "takes" / "does": damage enemies take or an attack deals ("Enemies you hit take 200% more damage
// from poison", "The final slash does 150% damage") is not the player's damage stat
const CONDITIONAL_STRONG = /\bstealth strikes?|\bfor each|\bfor every|\bper |\bwhile\b|\bwhen\b|\bif |\bunless\b|\bduring\b|\bto non-|\bof the (?:increases|bonuses)|\btakes?\b|\bdoes\b/i;
const UNCONDITIONAL_START = /^(\+?\d+(\.\d+)?% |increases? (your )?(max(imum)? )?(melee|ranged|magic|summon|minion|rogue|throwing|symphonic|radiant|movement|move|attack|melee speed|critical|damage|life|mana|defense|inspiration))/i;

/** A line that takes something away ("jump height slightly decreased") — never a buff flag. */
const WORSE = /\b(?:decreas|reduc|lower|weaker|slower|penalt|less\b)/i;

function flagsOnly(line, flags) {
  if (/immun(?:e|ity) to (?:knockback)|\bknockback immunity\b/i.test(line)) flags.add('knockbackImmune');
  if (/allows (?:the (?:wearer|holder|player) )?(?:to )?fl(?:y|ight)|\bflight\b/i.test(line)) flags.add('flight');
  if (/allows (?:you to )?dash|\bdash\b/i.test(line)) flags.add('dash');
  if (/extra jump|double jump/i.test(line)) flags.add('jump');
  if (/immun(?:e|ity) to (?:most |all )?debuffs/i.test(line)) flags.add('debuffImmune');
}

/** A number in a tooltip: `12`, `12.5`, or a `{0}` placeholder (unknown magnitude). */
const NUM = '(\\d+(?:\\.\\d+)?|\\{\\d+\\})';
const numVal = (s, fallback) => (s.startsWith('{') ? fallback : Number(s));

/**
 * Parse the stat lines a loadout solver cares about. Percentages are stored as
 * fractions (0.12), flat values as numbers. `classes` lists the classes the text
 * names; `placeholders` is true when any magnitude came from a `{0}` template.
 *
 * @returns {{ stats: Record<string, number>, classes: string[], placeholders: boolean, flags: string[] }}
 */
export function parseTooltipStats(text) {
  const t = cleanText(text);
  const stats = {};
  const flags = new Set();
  let placeholders = false;
  const add = (k, v) => { stats[k] = (stats[k] ?? 0) + v; };
  const pct = (s) => { if (s.startsWith('{')) placeholders = true; return numVal(s, 8) / 100; };
  const flat = (s, fb = 1) => { if (s.startsWith('{')) placeholders = true; return numVal(s, fb); };
  // A class mechanic in prose ("Stealth strikes deal 8% more damage", "15% of your throwing damage
  // is duplicated", "Stealth strikes grant 15% critical strike chance …") is a conditional class
  // damage / crit / armor-pen stat: recorded as `<cls>Cond…` so the solver can credit it at a discount.
  // `partTime` when the line is conditional; a plain line that no flat pattern knew ("15% of your
  // throwing damage is duplicated") is the full stat.
  const classMechanic = (line, partTime = true) => {
    if (WORSE.test(line) && !/increas|more|duplicat/i.test(line)) return;
    const cls = Object.entries(CLASS_WORDS).find(([, re]) => re.test(line))?.[0];
    if (!cls) return;
    let m;
    // a stealth strike bonus is a rogue's full stat (stealth strikes are how the class fights), tagged
    // `Stealth` so the solver can mark the item; other conditions are `Cond`
    // a timed buff a stealth strike grants ("15% crit to non-stealth strikes for 10 seconds") is still conditional
    const kind = /stealth strikes?/i.test(line) && !/for \d+(?:\.\d+)? seconds/i.test(line) ? 'Stealth' : partTime ? 'Cond' : '';
    if ((m = line.match(new RegExp(`\\+${NUM} armor penetration`, 'i')))) add(kind ? `${cls}${kind}ArmorPen` : 'armorPen', flat(m[1], 5));
    // the percentage right before the word, with no other percentage in between
    if ((m = line.match(new RegExp(`${NUM}%[^%]*?\\bcrit`, 'i')))) add(`${cls}${kind}Crit`, Math.min(15, flat(m[1], 5)));
    if ((m = line.match(new RegExp(`${NUM}%[^%]*?\\bdamage\\b`, 'i'))) && !/damage reduction|damage taken|less damage/i.test(m[0])) add(`${cls}${kind}Damage`, Math.min(0.3, pct(m[1])));
  };
  // values in a conditional line the code cannot give ("any player inside it gains 3 defense and 75% acceleration")
  const condValues = (line) => {
    let m;
    if ((m = line.match(new RegExp(`${NUM}% (?:increased |more )?acceleration`, 'i')))) add('condAccel', pct(m[1]));
    if ((m = line.match(new RegExp(`(?:gains?|grants?|\\+)\\s?${NUM} defense`, 'i')))) add('condDefense', flat(m[1], 4));
  };
  // stats that only conditional lines talk about ("Increased defense by 5 when submerged"): the
  // miner reads the code's value without its guard, so the solver takes those at a discount
  const cond = new Set();

  for (const raw of t.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let cd;
    if ((cd = line.match(new RegExp(`${NUM}[- ]second cooldown|cooldown of ${NUM} seconds?`, 'i')))) add('cooldown', flat(cd[1] ?? cd[2], 5)); // seconds; an on-hit effect's rate
    // Conditional or descriptive lines ("Critical strikes may … dealing 100% damage",
    // "Deals 75% increased damage to enemies above 90% health") are not flat stats.
    if ((CONDITIONAL.test(line) && !UNCONDITIONAL_START.test(line)) || CONDITIONAL_STRONG.test(line)) {
      flagsOnly(line, flags);
      classMechanic(line);
      condValues(line);
      for (const k of statWords(line)) cond.add(k);
      continue;
    }
    let m;
    // Damage reduction first: "10% increased damage reduction" also matches the damage patterns below.
    if ((m = line.match(new RegExp(`\\+?${NUM}% (?:increased |more |bonus )?(?:damage reduction|dr)\\b`, 'i')))) { add('damageReduction', pct(m[1])); continue; }
    // "12% increased melee damage", "+12% melee damage", "Increases melee damage by 12%"
    if ((m = line.match(new RegExp(`\\+?${NUM}% (?:increased |more |bonus )?(melee|ranged|magic|summon|minion|rogue|throwing|symphonic|radiant|true melee|stealth strike|whip|sentry)?\\s?(?:and (melee|ranged|magic|summon|rogue|throwing|symphonic|radiant) )?(?:damage|dmg)\\b`, 'i')))) {
      const v = pct(m[1]);
      const cls = m[2] ? classOf(m[2]) : 'all';
      const cls2 = m[3] ? classOf(m[3]) : null;
      // "by 100% and ranged damage briefly stuns": the "and" clause is a new sentence, not a second class
      if (cls2 && !m[2]) { flagsOnly(line, flags); continue; }
      if (/decreas|reduc|less/i.test(line) && !/increas/i.test(line)) { add(`${cls}Damage`, -v); continue; }
      add(`${cls}Damage`, v);
      if (cls2) add(`${cls2}Damage`, v);
      continue;
    }
    // "Increases melee damage and critical strike chance by 10%"
    if ((m = line.match(new RegExp(`increases? (?:your )?(melee|ranged|magic|summon|minion|rogue|throwing|symphonic|radiant)?\\s?damage and (?:critical strike chance|crit(?:ical)? chance) by ${NUM}%`, 'i')))) {
      const cls = m[1] ? classOf(m[1]) : 'all';
      add(`${cls}Damage`, pct(m[2]));
      add(`${cls}Crit`, flat(m[2], 5));
      continue;
    }
    if ((m = line.match(new RegExp(`increases? (?:your )?(melee|ranged|magic|summon|minion|rogue|throwing|symphonic|radiant)?\\s?damage by ${NUM}%`, 'i')))) {
      add(`${m[1] ? classOf(m[1]) : 'all'}Damage`, pct(m[2]));
      continue;
    }
    if ((m = line.match(new RegExp(`\\+?${NUM}% (?:increased )?(?:damage|dmg)\\b`, 'i'))) && !/reduc|taken/i.test(line)) {
      add('allDamage', pct(m[1]));
      continue;
    }
    // crit
    if ((m = line.match(new RegExp(`\\+?${NUM}% (?:increased )?(melee|ranged|magic|rogue|throwing|symphonic|radiant)?\\s?(?:critical strike chance|crit(?:ical)? chance|crit\\b)`, 'i')))) {
      add(`${m[2] ? classOf(m[2]) : 'all'}Crit`, flat(m[1], 5));
      continue;
    }
    if ((m = line.match(new RegExp(`increases? (?:your )?(melee|ranged|magic|rogue|throwing)?\\s?critical strike chance by ${NUM}%`, 'i')))) {
      add(`${m[1] ? classOf(m[1]) : 'all'}Crit`, flat(m[2], 5));
      continue;
    }
    // minions / sentries
    if ((m = line.match(new RegExp(`(?:increases? (?:your )?max(?:imum)? (?:number of )?minions? (?:by|slots? by) ${NUM}|\\+${NUM} max(?:imum)? minions?|\\+?${NUM} (?:additional |extra |more )?minion slots?)`, 'i')))) {
      add('minionSlots', flat(m[1] ?? m[2] ?? m[3], 1));
      continue;
    }
    if ((m = line.match(new RegExp(`(?:increases? (?:your )?max(?:imum)? (?:number of )?sentr(?:y|ies) (?:by|slots? by) ${NUM}|\\+${NUM} max(?:imum)? sentr(?:y|ies)|\\+?${NUM} (?:additional |extra |more )?sentry slots?)`, 'i')))) {
      add('sentrySlots', flat(m[1] ?? m[2] ?? m[3], 1));
      continue;
    }
    // speed
    if ((m = line.match(new RegExp(`\\+?${NUM}% (?:increased )?(?:throwing|thrown|rogue) velocity`, 'i')))) { add('rogueVelocity', pct(m[1])); continue; }
    if ((m = line.match(new RegExp(`\\+?${NUM}% (?:increased )?acceleration`, 'i')))) { add('accel', pct(m[1])); continue; }
    if ((m = line.match(new RegExp(`\\+?${NUM}% (?:increased )?(melee|ranged|magic|rogue|attack|weapon|movement|flight|mining|use)?\\s?(?:speed)`, 'i')))) {
      const kind = (m[2] ?? '').toLowerCase();
      if (kind === 'movement') add('moveSpeed', pct(m[1]));
      else if (kind === 'mining' || kind === 'flight') flags.add(kind);
      else add(kind === 'melee' ? 'meleeSpeed' : 'attackSpeed', pct(m[1]));
      continue;
    }
    if ((m = line.match(new RegExp(`increases? (?:your )?(?:movement|move) speed by ${NUM}%`, 'i')))) { add('moveSpeed', pct(m[1])); continue; }
    if ((m = line.match(new RegExp(`increases? (?:your )?(?:melee|attack) speed by ${NUM}%`, 'i')))) { add('meleeSpeed', pct(m[1])); continue; }
    // defense / life / mana
    if ((m = line.match(new RegExp(`\\+${NUM} defense`, 'i')))) { add('defense', flat(m[1], 4)); continue; }
    if ((m = line.match(new RegExp(`increases? (?:your )?defense by ${NUM}`, 'i')))) { add('defense', flat(m[1], 4)); continue; }
    if ((m = line.match(new RegExp(`(?:increases? (?:your )?(?:max(?:imum)? )?life by ${NUM}|\\+${NUM} (?:max(?:imum)? )?life\\b)`, 'i')))) { add('maxLife', flat(m[1] ?? m[2], 20)); continue; }
    if ((m = line.match(new RegExp(`(?:increases? (?:your )?(?:max(?:imum)? )?mana by ${NUM}|\\+${NUM} (?:max(?:imum)? )?mana\\b)`, 'i')))) { add('maxMana', flat(m[1] ?? m[2], 20)); continue; }
    if ((m = line.match(new RegExp(`(?:reduces? mana (?:cost|usage) by ${NUM}%|${NUM}% (?:reduced|decreased) mana (?:cost|usage))`, 'i')))) { add('manaCost', -pct(m[1] ?? m[2])); continue; }
    if ((m = line.match(new RegExp(`(?:increases? (?:your )?(?:max(?:imum)? )?inspiration by ${NUM}|\\+${NUM} (?:max(?:imum)? )?inspiration)`, 'i')))) { add('inspiration', flat(m[1] ?? m[2], 1)); continue; }
    if ((m = line.match(new RegExp(`(?:increases? (?:your )?life regen(?:eration)? by ${NUM}|\\+${NUM} life regen)`, 'i')))) { add('lifeRegen', flat(m[1] ?? m[2], 2)); continue; }
    if (/life regen/i.test(line) && /increas|boost|improv/i.test(line)) { add('lifeRegen', 2); continue; }
    if ((m = line.match(new RegExp(`increases? (?:your )?(?:armor|armour) penetration by ${NUM}|\\+${NUM} armor penetration`, 'i')))) { add('armorPen', flat(m[1] ?? m[2], 5)); continue; }
    if ((m = line.match(new RegExp(`${NUM}% (?:increased )?stealth`, 'i')))) { add('stealth', pct(m[1])); continue; }
    if ((m = line.match(new RegExp(`\\+${NUM} (?:max(?:imum)? )?stealth`, 'i')))) { add('stealthFlat', flat(m[1], 10)); continue; }
    // utility flags — "jump height slightly decreased" names the ability but is no buff
    if (WORSE.test(line) && !/increas/i.test(line)) continue;
    if (/immun(?:e|ity) to (?:knockback|most debuffs|fire blocks|lava)/i.test(line) || /\bknockback immunity\b/i.test(line)) flags.add('knockbackImmune');
    if (/allows (?:the (?:wearer|holder|player) )?(?:to )?fl(?:y|ight)|\bflight\b/i.test(line)) flags.add('flight');
    if (/allows (?:you to )?dash|\bdash\b/i.test(line)) flags.add('dash');
    if (/extra jump|double jump/i.test(line)) flags.add('jump'); // jump height / speed is a boost, not a jump
    if (/immun(?:e|ity) to (?:most |all )?debuffs/i.test(line)) flags.add('debuffImmune');
    if (/lava/i.test(line) && /immun|walk|protect/i.test(line)) flags.add('lava');
    if (/increases? (?:your )?pickup range|auto-?swing|autoswing/i.test(line)) flags.add('utility');
    if (/(?:allows|grants|lets you)(?: the wearer)? (?:to )?(?:walk|run) on water|hover/i.test(line)) flags.add('mobility');
    classMechanic(line, false); // no flat stat matched: maybe a class mechanic in prose
  }

  const classes = Object.entries(CLASS_WORDS).filter(([, re]) => re.test(t)).map(([k]) => k);
  const flatKeys = new Set(Object.keys(stats).filter((k) => !/cond|stealth/i.test(k)).map((k) => (/Damage$/.test(k) ? 'damage' : /Crit$/.test(k) ? 'crit' : k === 'damageReduction' ? 'endurance' : k === 'meleeSpeed' ? 'attackSpeed' : k)));
  const conditional = [...cond].filter((k) => !flatKeys.has(k));
  return { stats, classes, placeholders, flags: [...flags], conditional };
}

/** The solver's stat keys a line talks about. */
const STAT_WORDS = [['accel', /acceleration/i], ['endurance', /damage reduction/i], ['defense', /\bdefense\b/i], ['moveSpeed', /movement speed/i], ['lifeRegen', /life regen|hp\/s/i], ['maxLife', /max(?:imum)? life/i], ['maxMana', /max(?:imum)? mana/i], ['attackSpeed', /(?:melee|attack) speed/i], ['crit', /crit/i], ['damage', /\bdamage\b/i]];
const statWords = (line) => {
  const keys = STAT_WORDS.filter(([, re]) => re.test(line)).map(([k]) => k);
  return keys.filter((k) => !(k === 'damage' && keys.includes('endurance')));
};

export const VANILLA_RARITY_NAMES = {
  '-13': 'Master', '-12': 'Expert', '-11': 'Quest', '-1': 'Gray', 0: 'White', 1: 'Blue', 2: 'Green', 3: 'Orange',
  4: 'Light Red', 5: 'Pink', 6: 'Light Purple', 7: 'Lime', 8: 'Yellow', 9: 'Cyan', 10: 'Red', 11: 'Purple',
};
