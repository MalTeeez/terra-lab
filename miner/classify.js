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
  if (/generic|default|average|allclass|classless|true/i.test(n)) return 'classless';
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

const CONDITIONAL = /\b(?:when|while|if|after|during|until|instead|only|upon|every|against|nearby|above|below|dealing|deals?|summons?|releases?|fires?|shoots?|creates?|spawns?|strikes?)\b|\bfor \d|\bper |\bmay |\bchance to|\bto enemies|\bof the|\bon hit/i;
const CONDITIONAL_STRONG = /\bstealth strikes?|\bfor each|\bfor every|\bper |\bwhile\b|\bwhen\b|\bif |\bunless\b|\bduring\b|\bto non-|\bof the (?:increases|bonuses)/i;
const UNCONDITIONAL_START = /^(\+?\d+(\.\d+)?% |increases? (your )?(max(imum)? )?(melee|ranged|magic|summon|minion|rogue|throwing|symphonic|radiant|movement|move|attack|melee speed|critical|damage|life|mana|defense|inspiration))/i;

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

  for (const raw of t.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    // Conditional or descriptive lines ("Critical strikes may … dealing 100% damage",
    // "Deals 75% increased damage to enemies above 90% health") are not flat stats.
    if ((CONDITIONAL.test(line) && !UNCONDITIONAL_START.test(line)) || CONDITIONAL_STRONG.test(line)) {
      flagsOnly(line, flags);
      continue;
    }
    let m;
    // "12% increased melee damage", "+12% melee damage", "Increases melee damage by 12%"
    if ((m = line.match(new RegExp(`\\+?${NUM}% (?:increased |more |bonus )?(melee|ranged|magic|summon|minion|rogue|throwing|symphonic|radiant|true melee|stealth strike|whip|sentry)?\\s?(?:and (melee|ranged|magic|summon|rogue|throwing|symphonic|radiant) )?(?:damage|dmg)\\b`, 'i')))) {
      const v = pct(m[1]);
      const cls = m[2] ? classOf(m[2]) : 'all';
      const cls2 = m[3] ? classOf(m[3]) : null;
      if (/decreas|reduc|less/i.test(line) && !/increas/i.test(line)) { add(`${cls}Damage`, -v); continue; }
      add(`${cls}Damage`, v);
      if (cls2) add(`${cls2}Damage`, v);
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
    if ((m = line.match(new RegExp(`\\+?${NUM}% (?:increased )?(?:damage reduction|dr)\\b`, 'i')))) { add('damageReduction', pct(m[1])); continue; }
    if ((m = line.match(new RegExp(`(?:increases? (?:your )?(?:max(?:imum)? )?life by ${NUM}|\\+${NUM} (?:max(?:imum)? )?life\\b)`, 'i')))) { add('maxLife', flat(m[1] ?? m[2], 20)); continue; }
    if ((m = line.match(new RegExp(`(?:increases? (?:your )?(?:max(?:imum)? )?mana by ${NUM}|\\+${NUM} (?:max(?:imum)? )?mana\\b)`, 'i')))) { add('maxMana', flat(m[1] ?? m[2], 20)); continue; }
    if ((m = line.match(new RegExp(`(?:reduces? mana (?:cost|usage) by ${NUM}%|${NUM}% (?:reduced|decreased) mana (?:cost|usage))`, 'i')))) { add('manaCost', -pct(m[1] ?? m[2])); continue; }
    if ((m = line.match(new RegExp(`(?:increases? (?:your )?(?:max(?:imum)? )?inspiration by ${NUM}|\\+${NUM} (?:max(?:imum)? )?inspiration)`, 'i')))) { add('inspiration', flat(m[1] ?? m[2], 1)); continue; }
    if ((m = line.match(new RegExp(`(?:increases? (?:your )?life regen(?:eration)? by ${NUM}|\\+${NUM} life regen)`, 'i')))) { add('lifeRegen', flat(m[1] ?? m[2], 2)); continue; }
    if (/life regen/i.test(line) && /increas|boost|improv/i.test(line)) { add('lifeRegen', 2); continue; }
    if ((m = line.match(new RegExp(`increases? (?:your )?(?:armor|armour) penetration by ${NUM}|\\+${NUM} armor penetration`, 'i')))) { add('armorPen', flat(m[1] ?? m[2], 5)); continue; }
    if ((m = line.match(new RegExp(`${NUM}% (?:increased )?stealth`, 'i')))) { add('stealth', pct(m[1])); continue; }
    if ((m = line.match(new RegExp(`\\+${NUM} (?:max(?:imum)? )?stealth`, 'i')))) { add('stealthFlat', flat(m[1], 10)); continue; }
    // utility flags
    if (/immun(?:e|ity) to (?:knockback|most debuffs|fire blocks|lava)/i.test(line) || /\bknockback immunity\b/i.test(line)) flags.add('knockbackImmune');
    if (/allows (?:the (?:wearer|holder|player) )?(?:to )?fl(?:y|ight)|\bflight\b/i.test(line)) flags.add('flight');
    if (/allows (?:you to )?dash|\bdash\b/i.test(line)) flags.add('dash');
    if (/extra jump|double jump|jump(?:ing)? (?:height|speed)/i.test(line)) flags.add('jump');
    if (/immun(?:e|ity) to (?:most |all )?debuffs/i.test(line)) flags.add('debuffImmune');
    if (/lava/i.test(line) && /immun|walk|protect/i.test(line)) flags.add('lava');
    if (/increases? (?:your )?pickup range|auto-?swing|autoswing/i.test(line)) flags.add('utility');
    if (/(?:allows|grants|lets you)(?: the wearer)? (?:to )?(?:walk|run) on water|hover/i.test(line)) flags.add('mobility');
  }

  const classes = Object.entries(CLASS_WORDS).filter(([, re]) => re.test(t)).map(([k]) => k);
  return { stats, classes, placeholders, flags: [...flags] };
}

export const VANILLA_RARITY_NAMES = {
  '-13': 'Master', '-12': 'Expert', '-11': 'Quest', '-1': 'Gray', 0: 'White', 1: 'Blue', 2: 'Green', 3: 'Orange',
  4: 'Light Red', 5: 'Pink', 6: 'Light Purple', 7: 'Lime', 8: 'Yellow', 9: 'Cyan', 10: 'Red', 11: 'Purple',
};
