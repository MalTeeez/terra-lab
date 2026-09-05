/**
 * Class detection (DamageClass name → class) and tooltip stat parsing.
 */

export const CLASSES = ['melee', 'ranged', 'magic', 'summon', 'rogue', 'thrower', 'bard', 'healer', 'void', 'classless'];

/** DamageClass type/property name → class key. */
export function classOf(dcName) {
  if (!dcName) return null;
  const n = dcName;
  // SOTS's void class is a family — VoidGeneric, VoidMelee, VoidRanged, VoidMagic, VoidSummon —
  // that its `VoidItem.SetDefaults` swaps in for whatever vanilla class the weapon set. They spend
  // void rather than mana and are built for with their own armour and accessories, so they are one
  // class of their own; first, or `VoidMelee` would read as melee.
  if (/void/i.test(n)) return 'void';
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
    // the colour is a hex, but also a `{1}` format argument the item never filled in; `ceffect/name`
    // is Calamity's own coloured tag — both keep their text
    .replace(/\[c(?:effect)?\/[^:\]]*:([^\]]*)\]/gi, '$1')
    .replace(/\[cbuff:[^\]\/]*\/([^\]]*)\]/gi, (_, n) => deCamelWords(n))
    .replace(/\[i(?:\/[^:\]]*)?:[^\]]*\]\s*/gi, '')
    .replace(/\[[a-z]+:([^\]]*)\]/gi, '$1')
    .replace(/\[DAMAGELINE\]|\[STEALTHLINE\]|\[PARRYLINE\]|\[BONUSLINE\]/g, '')
    // a plural marker whose argument never resolved (`{^0:second;seconds}`) — keep the plural arm
    .replace(/\{\^\d+:[^};]*;([^}]*)\}/g, '$1')
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
  void: /\bvoid\b/i,
};

const CONDITIONAL = /\b(?:when|while|if|after|during|until|instead|only|upon|every|against|nearby|above|below|dealing|deals?|summons?|releases?|fires?|shoots?|creates?|spawns?|strikes?)\b|\bfor \d|\bper |\bmay |\bchance to|\bto enemies|\bof the|\bon hit|\binside\b|\bwithin\b/i;
// "takes" / "does": damage enemies take or an attack deals ("Enemies you hit take 200% more damage
// from poison", "The final slash does 150% damage") is not the player's damage stat
// "…that … gain(s)": something other than the player gets the bonus, under a condition of its own
// ("Arrows that pass through these fields gain a 75% damage boost")
// a named buff (`CalamityMod/Mushy`): stats on that line are the buff's, and you only have them
// while the buff is up ("Consuming mushrooms provides CalamityMod/Mushy, granting 3 defense")
const CONDITIONAL_STRONG = /\bstealth strikes?|\bfor each|\bfor every|\bper |\bwhile\b|\bwhen\b|\bif |\bunless\b|\bduring\b|\bto non-|\bof the (?:increases|bonuses)|\btakes?\b|\bdoes\b|\bthat\b[^.]*\bgains?\b|[A-Za-z]+Mod\/[A-Za-z0-9_]+/;
const UNCONDITIONAL_START = /^(\+?\d+(\.\d+)?% |increases? (your )?(max(imum)? )?(melee|ranged|magic|summon|minion|rogue|throwing|symphonic|radiant|movement|move|attack|melee speed|critical|damage|life|mana|defense|inspiration))/i;

/** Damage the *enemy* deals or takes — never the player's damage stat. */
const ENEMY_DAMAGE = /damage reduction|damage taken|less damage|damage over time|damage they|they take|enemies take|its damage|damage done to/i;

/** A line that takes something away ("jump height slightly decreased") — never a buff flag. */
const WORSE = /\b(?:decreas|reduc|lower|weaker|slower|penalt|less\b)/i;

/**
 * The abilities a line names. Every flag rule lives here: an ability reads the same in a
 * conditional sentence as in a flat one ("Gives a chance to dodge attacks" is still a dodge), so
 * both paths through the parser ask the same question.
 */
function flagsOnly(line, flags) {
  if (/immun(?:e|ity) to knockback/i.test(line) || /\bknockback immunity\b/i.test(line)) flags.add('knockbackImmune');
  if (/allows (?:the (?:wearer|holder|player) )?(?:to )?fl(?:y|ight)|\bflight\b/i.test(line)) flags.add('flight');
  if (/allows (?:you to )?dash|\bdash\b/i.test(line)) flags.add('dash');
  if (/extra jump|double jump/i.test(line)) flags.add('jump'); // jump height / speed is a boost, not a jump
  if (/immun(?:e|ity) to (?:most |all )?debuffs/i.test(line)) flags.add('debuffImmune');
  // named debuffs ("Immunity to Poison and Bleeding") are worth less than a blanket immunity
  else if (/immun(?:e|ity) to \w/i.test(line) && !/knockback|fire block|lava/i.test(line)) flags.add('debuffResist');
  if ((/lava/i.test(line) && /immun|walk|protect|reduces damage/i.test(line)) || /immun(?:e|ity) to fire blocks?/i.test(line)) flags.add('lava');
  if (/\bdodg(?:e|es|ing)\b/i.test(line)) flags.add('dodge');
  if (/increases? (?:your )?pickup range|auto[- ]?swing/i.test(line)) flags.add('utility');
  // a longer invincibility window after a hit, and a bigger melee hitbox: small, real, and common
  if (/length of invincibility|invincibility (?:frames|time|length)|longer invincibility/i.test(line)) flags.add('iframes');
  if (/(?:increases?|extends?) the (?:size|range) of melee weapons|melee weapons? (?:size|range)|extend the effective range of melee/i.test(line)) flags.add('meleeSize');
  if (/(?:allows|grants|lets you)(?: the wearer)? (?:to )?(?:walk|run) on water|hover/i.test(line)) flags.add('mobility');
}

/** Natural life regeneration in HP/s, the base a "% more potent" line multiplies. */
const NATURAL_REGEN = 4;

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
    // the percentage right before the word, with no other percentage in between — or, when the
    // sentence puts it last, the one after it ("summon damage and crit chance are boosted by 10%")
    const after = (what) => line.match(new RegExp(`${what}[^%\\d]*?(?:by|up to|of) ${NUM}%`, 'i'));
    if ((m = line.match(new RegExp(`${NUM}%[^%]*?\\bcrit`, 'i'))) || (m = after('\\bcrit(?:ical)?\\w* (?:strike )?chance'))) add(`${cls}${kind}Crit`, Math.min(15, flat(m[1], 5)));
    if (((m = line.match(new RegExp(`${NUM}%[^%]*?\\bdamage\\b`, 'i'))) || (m = after('\\bdamage\\b'))) && !ENEMY_DAMAGE.test(m[0])) add(`${cls}${kind}Damage`, Math.min(0.3, pct(m[1])));
  };
  // values in a conditional line the code cannot give ("any player inside it gains 3 defense and 75% acceleration")
  const condValues = (line) => {
    let m;
    if ((m = line.match(new RegExp(`${NUM}% (?:increased |more )?acceleration`, 'i')))) add('condAccel', pct(m[1]));
    if ((m = line.match(new RegExp(`(?:gains?|grant\\w*|\\+)\\s?${NUM} defense`, 'i')))) add('condDefense', flat(m[1], 4));
    // "granting +1 HP/s life regen", "the aura grants +{1} HP/s life regen": the buff's regen
    if ((m = line.match(new RegExp(`\\+?${NUM} HP/s life regen`, 'i')))) add('condLifeRegen', flat(m[1], 1) * 2); // HP/s → Terraria's half-HP regen units
    // a shell below half life, a barrier while it holds: damage reduction that only sometimes applies
    const dr = line.match(new RegExp(`reduces? (?:the )?damage(?: taken)?(?: done to \\w+)? by ${NUM}%|${NUM}% damage reduction`, 'i'));
    if (dr) add('condEndurance', pct(dr[1] ?? dr[2]));
    // damage that grows with a condition and no class named it ("Gain an increase to your damage …
    // up to 20% at 50% life or below"). It has to say whose damage: half the lines in the pool are
    // about the damage *enemies* take, and none of those are the player's stat.
    if (!dr && /your damage|damage you deal/i.test(line) && !ENEMY_DAMAGE.test(line)
      && !Object.keys(CLASS_WORDS).some((c) => CLASS_WORDS[c].test(line))
      && (m = line.match(new RegExp(`\\bdamage\\b[^%]*?(?:by|up to|of) ${NUM}%`, 'i')))) add('allCondDamage', Math.min(0.3, pct(m[1])));
  };
  // "Critical strikes deal 40 more damage", "Critical strikes have a 50% chance to deal 30 more
  // damage": a flat bonus only the hits that crit get, kept with the chance it comes with. Read
  // before the conditional gate, since the chance makes the line read as conditional.
  const critFlat = (line) => {
    const m = line.match(new RegExp(`crit\\w*.*?deals?(?: an additional| an extra)? ${NUM} more damage`, 'i'));
    if (!m) return false;
    add('critFlat', flat(m[1], 10));
    const c = line.match(new RegExp(`${NUM}% chance`, 'i'));
    if (c) stats.critFlatChance = pct(c[1]);
    return true;
  };
  // How often a rogue gets to strike from stealth: a strike that expends less than the whole bar,
  // or a bar that fills faster, is a strike that comes round more often. Read before the
  // conditional gate for the same reason as the crit bonus — "stealth strikes" makes the line read
  // as conditional, and the rate is the line's whole point. Two of them multiply, they do not add.
  const stealthRate = (line) => {
    let m;
    if ((m = line.match(new RegExp(`stealth strikes? only (?:expend|use|consume|cost) ${NUM}%`, 'i')))) { stats.stealthCost = (stats.stealthCost ?? 1) * pct(m[1]); return true; }
    if ((m = line.match(new RegExp(`stealth (?:generat|regenerat|build|recharg)\\w*(?: back)? ${NUM}% faster|${NUM}% faster stealth (?:generation|regen\\w*)`, 'i')))) { add('stealthRegen', pct(m[1] ?? m[2])); return true; }
    return false;
  };
  // stats that only conditional lines talk about ("Increased defense by 5 when submerged"): the
  // miner reads the code's value without its guard, so the solver takes those at a discount
  const cond = new Set();

  for (const raw of t.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let cd;
    if ((cd = line.match(new RegExp(`${NUM}[- ]second cooldown|cooldown of ${NUM} seconds?`, 'i')))) add('cooldown', flat(cd[1] ?? cd[2], 5)); // seconds; an on-hit effect's rate
    if (critFlat(line) || stealthRate(line)) continue;
    // Conditional or descriptive lines ("Critical strikes may … dealing 100% damage",
    // "Deals 75% increased damage to enemies above 90% health") are not flat stats.
    // "critical strike chance" is the name of a stat, not a condition: without masking it the
    // CONDITIONAL word `strikes?` makes every line that mentions crit read as conditional, and
    // "Reduces damage taken by 7% and increases critical strike chance by 4%" loses its crit.
    const cl = line.replace(/critical strikes? (?:chance|damage)/gi, 'crit');
    if ((CONDITIONAL.test(cl) && !UNCONDITIONAL_START.test(line)) || CONDITIONAL_STRONG.test(cl)) {
      flagsOnly(line, flags);
      classMechanic(line);
      condValues(line);
      for (const k of statWords(line)) cond.add(k);
      continue;
    }
    let m;
    // Damage reduction first: "10% increased damage reduction" also matches the damage patterns below.
    if ((m = line.match(new RegExp(`\\+?${NUM}% (?:increased |more |bonus )?(?:damage reduction|dr)\\b`, 'i')))) { add('damageReduction', pct(m[1])); continue; }
    // no `continue`: this phrasing usually shares its line ("Reduces damage taken by 7% and
    // increases critical strike chance by 4%"), and nothing below can match "damage taken" again
    if ((m = line.match(new RegExp(`(?:reduces? damage taken by ${NUM}%|${NUM}% (?:reduced|decreased|less) damage taken)`, 'i')))) add('damageReduction', pct(m[1] ?? m[2]));
    // ---- void, SOTS's own resource: its class spends void the way a mage spends mana. Read before
    // the damage and crit rules and without `continue`, because a void line almost always carries
    // another stat with it ("Increases void gain by 2 and void critical strike chance by 8%").
    if ((m = line.match(new RegExp(`void gain by ${NUM}`, 'i')))) add('voidGain', flat(m[1], 1) * (WORSE.test(line) ? -1 : 1));
    if ((m = line.match(new RegExp(`max(?:imum)? (?:mana and )?void by ${NUM}`, 'i')))) add('maxVoid', flat(m[1], 20) * (WORSE.test(line) ? -1 : 1));
    if ((m = line.match(new RegExp(`(?:mana and )?void (?:cost|usage) by ${NUM}%`, 'i')))) add('voidCost', -pct(m[1]));
    if ((m = line.match(new RegExp(`void regeneration speed by ${NUM}%`, 'i')))) add('voidRegen', pct(m[1]) * (WORSE.test(line) ? -1 : 1));
    // "12% increased melee damage", "+12% melee damage", "Increases melee damage by 12%"
    if ((m = line.match(new RegExp(`\\+?${NUM}% (?:increased |more |bonus )?(melee|ranged|magic|summon|minion|rogue|throwing|symphonic|radiant|void|true melee|stealth strike|whip|sentry)?\\s?(?:and (melee|ranged|magic|summon|rogue|throwing|symphonic|radiant) )?(?:damage|dmg)\\b`, 'i')))) {
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
    if ((m = line.match(new RegExp(`increases? (?:your )?(melee|ranged|magic|summon|minion|rogue|throwing|symphonic|radiant|void)?\\s?damage and (?:critical strike chance|crit(?:ical)? chance) by ${NUM}%`, 'i')))) {
      const cls = m[1] ? classOf(m[1]) : 'all';
      add(`${cls}Damage`, pct(m[2]));
      add(`${cls}Crit`, flat(m[2], 5));
      continue;
    }
    // two classes sharing one percentage ("Increases void damage and magic damage by 10%")
    if ((m = line.match(new RegExp(`increases? (?:your )?(melee|ranged|magic|summon|minion|rogue|throwing|symphonic|radiant|void) damage and (melee|ranged|magic|summon|minion|rogue|throwing|symphonic|radiant|void) damage by ${NUM}%`, 'i')))) {
      add(`${classOf(m[1])}Damage`, pct(m[3]));
      add(`${classOf(m[2])}Damage`, pct(m[3]));
      continue;
    }
    if ((m = line.match(new RegExp(`increases? (?:your )?(melee|ranged|magic|summon|minion|rogue|throwing|symphonic|radiant|void)?\\s?damage by ${NUM}%`, 'i')))) {
      add(`${m[1] ? classOf(m[1]) : 'all'}Damage`, pct(m[2]));
      continue;
    }
    if ((m = line.match(new RegExp(`\\+?${NUM}% (?:increased )?(?:damage|dmg)\\b`, 'i'))) && !/reduc|taken/i.test(line)) {
      add('allDamage', pct(m[1]));
      continue;
    }
    // crit damage before crit chance: "critical strike damage" is a different stat, not more crits
    if ((m = line.match(new RegExp(`(?:increases? (?:your )?crit(?:ical strike)? damage by ${NUM}%|\\+?${NUM}% (?:increased |more )?crit(?:ical strike)? damage)`, 'i')))) { add('critDamage', pct(m[1] ?? m[2])); continue; }
    // crit
    if ((m = line.match(new RegExp(`\\+?${NUM}% (?:increased )?(melee|ranged|magic|rogue|throwing|symphonic|radiant|void)?\\s?(?:critical strike chance|crit(?:ical)? chance|crit\\b)`, 'i')))) {
      add(`${m[2] ? classOf(m[2]) : 'all'}Crit`, flat(m[1], 5));
      continue;
    }
    // the same stat with the percentage last and no "increases" in front of it, which is how a
    // line that lists several stats reads ("Increases void gain by 2 and void crit chance by 8%")
    if ((m = line.match(new RegExp(`(melee|ranged|magic|rogue|throwing|symphonic|radiant|void)?\\s?critical strike chance by ${NUM}%`, 'i')))) {
      add(`${m[1] ? classOf(m[1]) : 'all'}Crit`, flat(m[2], 5));
      continue;
    }
    if ((m = line.match(new RegExp(`increases? (?:your )?(melee|ranged|magic|rogue|throwing|void)?\\s?critical strike chance by ${NUM}%`, 'i')))) {
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
    // a class's own attack speed under its own name: a bard plays, a healer casts
    if ((m = line.match(new RegExp(`\\+?${NUM}% (?:increased |faster )?(symphonic|bard|radiant|healing)[a-z ]*speed`, 'i')))) { add(`${/symphonic|bard/i.test(m[2]) ? 'bard' : 'healer'}Speed`, pct(m[1])); continue; }
    if ((m = line.match(new RegExp(`increases? whip range by ${NUM}%|\\+?${NUM}% (?:increased )?whip range`, 'i')))) { add('whipRange', pct(m[1] ?? m[2])); continue; }
    if ((m = line.match(new RegExp(`\\+?${NUM}% (?:increased )?(melee|ranged|magic|rogue|attack|weapon|movement|flight|mining|use)?\\s?(?:speed)`, 'i')))) {
      const kind = (m[2] ?? '').toLowerCase();
      if (kind === 'movement') add('moveSpeed', pct(m[1]));
      else if (kind === 'mining' || kind === 'flight') flags.add(kind);
      else add(kind === 'melee' ? 'meleeSpeed' : 'attackSpeed', pct(m[1]));
      continue;
    }
    // "Increases your max movement speed and acceleration by 5%": the percentage comes after both
    if ((m = line.match(new RegExp(`(?:movement|move) speed[a-z ]*by ${NUM}%`, 'i')))) { add('moveSpeed', pct(m[1])); if (/acceleration/i.test(line)) add('accel', pct(m[1])); continue; }
    if ((m = line.match(new RegExp(`increases? (?:your )?(?:melee|attack) speed by ${NUM}%`, 'i')))) { add('meleeSpeed', pct(m[1])); continue; }
    // defense / life / mana
    if ((m = line.match(new RegExp(`\\+${NUM} defense`, 'i')))) { add('defense', flat(m[1], 4)); continue; }
    if ((m = line.match(new RegExp(`increases? (?:your )?defense by ${NUM}`, 'i')))) { add('defense', flat(m[1], 4)); continue; }
    if ((m = line.match(new RegExp(`(?:increases? (?:your )?(?:max(?:imum)? )?life by ${NUM}|\\+${NUM} (?:max(?:imum)? )?life\\b|max(?:imum)? life increased by ${NUM})`, 'i')))) { add('maxLife', flat(m[1] ?? m[2] ?? m[3], 20)); continue; }
    // a shield or barrier that regrows on its own is worth at least the life it absorbs
    if ((m = line.match(new RegExp(`${NUM} (?:life|health|hp) shield|barrier with ${NUM} (?:health|life|hp)`, 'i')))) { add('maxLife', flat(m[1] ?? m[2], 20)); continue; }
    if ((m = line.match(new RegExp(`increases? (?:your )?max(?:imum)? (?:hp|life|health) by ${NUM}%`, 'i')))) { add('maxLifePct', pct(m[1])); continue; }
    if ((m = line.match(new RegExp(`(?:increases? (?:your )?(?:max(?:imum)? )?mana by ${NUM}|\\+${NUM} (?:max(?:imum)? )?mana\\b|max(?:imum)? mana increased by ${NUM})`, 'i')))) { add('maxMana', flat(m[1] ?? m[2] ?? m[3], 20)); continue; }
    if ((m = line.match(new RegExp(`(?:reduces? mana (?:cost|usage) by ${NUM}%|${NUM}% (?:reduced|decreased) mana (?:cost|usage))`, 'i')))) { add('manaCost', -pct(m[1] ?? m[2])); continue; }
    if ((m = line.match(new RegExp(`(?:increases? (?:your )?(?:max(?:imum)? )?inspiration by ${NUM}|\\+${NUM} (?:max(?:imum)? )?inspiration)`, 'i')))) { add('inspiration', flat(m[1] ?? m[2], 1)); continue; }
    if ((m = line.match(new RegExp(`(?:increases? (?:your )?life regen(?:eration)? by ${NUM}|\\+${NUM} life regen)`, 'i')))) { add('lifeRegen', flat(m[1] ?? m[2], 2)); continue; }
    // "Natural life regen is 75% more potent": natural regen runs about 4 HP/s, so that is +3
    if ((m = line.match(new RegExp(`natural life regen(?:eration)? is ${NUM}% more potent`, 'i')))) { add('lifeRegen', pct(m[1]) * NATURAL_REGEN); continue; }
    // "+{0} to +{1} HP/s life regen based on missing health": the numbers only exist at runtime
    if (/HP\/s life regen/i.test(line)) { add('lifeRegen', 3); placeholders = placeholders || /\{\d\}/.test(line); continue; }
    if (/life regen/i.test(line) && /increas|boost|improv|provid|potent/i.test(line)) { add('lifeRegen', 2); continue; }
    // potions: how much they give back, and how often you may drink one
    if ((m = line.match(new RegExp(`healing potions? are ${NUM}% more effective|increases? healing (?:and mana )?received from potions by ${NUM}|potion healing by ${NUM}%`, 'i')))) { add('potionHeal', m[1] ? pct(m[1]) : flat(m[2] ?? m[3], 20) / 100); continue; }
    if ((m = line.match(new RegExp(`reduces? the cooldown of healing potions by ${NUM}%|potion (?:sickness|cooldown)[a-z ]*by ${NUM}%`, 'i')))) { add('potionHeal', pct(m[1] ?? m[2])); continue; }
    // Thorium's healer: a flat bonus on every heal they cast
    if ((m = line.match(new RegExp(`healing spells will heal an additional ${NUM} (?:life|health)`, 'i')))) { add('healerHealing', flat(m[1], 1)); continue; }
    if ((m = line.match(new RegExp(`increases? (?:your )?(?:armor|armour) penetration by ${NUM}|\\+${NUM} armor penetration`, 'i')))) { add('armorPen', flat(m[1] ?? m[2], 5)); continue; }
    if ((m = line.match(new RegExp(`${NUM}% (?:increased )?stealth`, 'i')))) { add('stealth', pct(m[1])); continue; }
    if ((m = line.match(new RegExp(`\\+${NUM} (?:max(?:imum)? )?stealth`, 'i')))) { add('stealthFlat', flat(m[1], 10)); continue; }
    // utility flags — "jump height slightly decreased" names the ability but is no buff. Lava is the
    // exception: "Reduces damage from touching lava" reads as worse and is the protection itself.
    if (WORSE.test(line) && !/increas/i.test(line)) { if (/lava/i.test(line)) flags.add('lava'); continue; }
    flagsOnly(line, flags);
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
