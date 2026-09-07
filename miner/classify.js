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
    .replace(/\[\w*buff\w*:[^\]\/]*\/([^\]]*)\]/gi, (_, n) => deCamelWords(n))
    .replace(/\[[is](?:\/[^:\]]*)?:[^\]]*\]\s*/gi, '')
    .replace(/\[[a-z]+:([^\]]*)\]/gi, '$1')
    .replace(/\[DAMAGELINE\]|\[GFB\]|\[STEALTHLINE\]|\[PARRYLINE\]|\[BONUSLINE\]/g, '')
    // a plural marker whose argument never resolved (`{^0:second;seconds}`) — keep the plural arm
    .replace(/\{\^\d+:[^};]*;([^}]*)\}/g, '$1')
    .replace(/\r/g, '')
    // a line the mod never wrote ("Temp1", "TODO"): placeholder localization, not a description
    .replace(/^(?:Temp\d*|TODO|PLACEHOLDER)$/gim, '')
    // an argument the miner could not read leaves a hole ("Press  to Dimensional Drive": the
    // keybind is a runtime string) — close it rather than print the gap
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +$/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

const deCamelWords = (n) => n.replace(/([a-z\d])([A-Z])/g, '$1 $2');

const CLASS_WORDS = {
  melee: /\bmelee\b|\b(?:sword|spear)s?\s+(?:strikes?|weapons?)\b/i,
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
// "up to": a ceiling on something that scales, not a stat you carry ("Up to 30% increased damage
// the lower your life is" — you only see the 30% at a sliver of health)
// damage aimed at a named target set ("20% increased damage dealt to Old One's Army enemies") is
// worth nothing against everything else you fight. The enemy noun is what makes it a target set —
// "8% increased damage to all other classes" is a plain stat and must not be caught.
// a stance you are only sometimes in ("Gain 5% increased damage in the air") reads as flat prose —
// no "while", no "when" — but is a condition all the same
const CONDITIONAL_STRONG = /\bstealth strikes?|\bfor each|\bfor every|\bper |\bwhile\b|\bwhen\b|\bif |\bunless\b|\bduring\b|\bto non-|\bof the (?:increases|bonuses)|\btakes?\b|\bdoes\b|\bthat\b[^.]*\bgains?\b|\b[Uu]p to \d|[Dd]amage (?:dealt |done )?(?:to|against) [\w'’ -]*\b(?:enem(?:y|ies)|foes?|targets?|bosses|mobs?)\b|[A-Za-z]+Mod\/[A-Za-z0-9_]+|\b[Ii]n (?:the air|midair|mid-air)\b|\b[Aa]irborne\b|\b[Ii]mmunity frames?\b|\b[Ii]nvincib/;
const UNCONDITIONAL_START = /^(\+?\d+(\.\d+)?% |increases? (your )?(max(imum)? )?(melee|ranged|magic|summon|minion|rogue|throwing|symphonic|radiant|movement|move|attack|melee speed|critical|damage|life|mana|defense|inspiration))/i;
/**
 * Which *kind* of condition a line hangs off. Two lines on the same item can gate the same stat
 * differently — the Galeflame Feather gives 5% damage in the air and another 18% for the immunity
 * frames in the air — and they are not worth the same. A stance you steer yourself (in the air, on
 * a stealth strike, after your own attack) is part-time; the ones below need something you do not
 * control to supply them — a hit taken, a world event, a liquid to stand in — and are much rarer
 * than the line reads. `Cond` and `State` are two different discounts in `score.js`.
 * ponytail: a word list, not a model of the condition; extend it when a gate is priced wrong.
 */
const STATE_GATE =/\bimmunity frames?\b|\bi-frames?\b|\binvincib|\bsubmerged\b|\bunderwater\b|\bwet\b|\bin (?:water|lava|honey)\b|\b(?:after|upon|when) (?:being |you are |you're )?(?:hit|struck|damaged)\b|\bblood moon\b|\bsolar eclipse\b|\bat night\b|\bduring the (?:day|night)\b|\bfull moon\b/i;
/** A line that hands the *player* a stat, rather than quoting a number some projectile of its own has. */
const GRANTS_STAT = /\d(?:\.\d+)?% (?:increased|more|bonus|additional|extra) |your (?:\w+ )?(?:damage|crit)|damage you deal|(?:critical strike chance|crit chance) by |\bup to \d/i;

/** Damage the *enemy* deals or takes — never the player's damage stat. */
const ENEMY_DAMAGE = /damage reduction|damage taken|less damage|damage over time|damage they|they take|enemies take|its damage|damage done to/i;

/** A line that takes something away ("jump height slightly decreased") — never a buff flag. */
const WORSE = /\b(?:decreas|reduc|lower|weaker|slower|penalt|less\b)/i;

/** Where a line turns from what it gives to what it takes. */
const DRAWBACK = /,?\s+(?:but|however|at the cost of|in exchange for)\s+/i;
/**
 * The wording of a loss, rewritten to the matching gain so the ordinary rules read the magnitude
 * out of it ("decreases damage by 10%" → "increases damage by 10%", "10% reduced speed" → "10%
 * increased speed"). The sign is put back by the caller; this only gets the number out.
 */
const asGain = (s) => s
  .replace(/\b(?:reduces|decreases|lowers|loses)\b/gi, 'increases')
  .replace(/\b(?:reducing|decreasing|lowering|losing)\b/gi, 'increasing')
  .replace(/\b(?:reduced|decreased|lowered|lost|less|weaker|slower)\b/gi, 'increased')
  .replace(/\b(?:reduce|decrease|lower|lose)\b/gi, 'increase');
/** Damage the player *takes* — a real drawback, but not one any stat here can carry. */
const TAKES_DAMAGE = /\btak(?:e|es|ing|en)\b|damage taken|damage from/i;
/** Stats a drawback clause states as-is: a bigger number is already the worse one. */
const MORE_IS_WORSE = new Set(['cooldown', 'altCooldown', 'manaCost', 'voidCost', 'stealthCost']);

/**
 * The abilities a line names. Every flag rule lives here: an ability reads the same in a
 * conditional sentence as in a flat one ("Gives a chance to dodge attacks" is still a dodge), so
 * both paths through the parser ask the same question.
 */
function flagsOnly(line, flags) {
  if (/immun(?:e|ity) to knockback/i.test(line) || /\bknockback immunity\b/i.test(line)) flags.add('knockbackImmune');
  if (/allows (?:the (?:wearer|holder|player) )?(?:to )?fl(?:y|ight)|\bflight\b/i.test(line)) flags.add('flight');
  if (/allows (?:you to )?dash|\bdash\b/i.test(line)) flags.add('dash');
  if (/(?:extra|additional|double) jump/i.test(line)) flags.add('jump'); // jump height / speed is a boost, not a jump
  if (/immun(?:e|ity) to (?:most |all )?debuffs/i.test(line)) flags.add('debuffImmune');
  // named debuffs ("Immunity to Poison and Bleeding") are worth less than a blanket immunity
  else if (/immun(?:e|ity) to \w/i.test(line) && !/knockback|fire block|lava/i.test(line)) flags.add('debuffResist');
  if ((/lava/i.test(line) && /immun|walk|protect|reduces damage/i.test(line)) || /immun(?:e|ity) to fire blocks?/i.test(line)) flags.add('lava');
  if (/\bdodg(?:e|es|ing)\b/i.test(line)) flags.add('dodge');
  // a death undone: Calamity's Silva revive, Thorium's phylactery. Worth more than a dodge and
  // still only once — the cooldowns are minutes long and do not tick down during a boss fight
  if (/taking (?:fatal|lethal|otherwise fatal) damage|(?:revive|resurrect)\w* you\b|will revive you|cheat death|survive (?:an )?otherwise (?:fatal|lethal)/i.test(line)) flags.add('revive');
  // …and a window where nothing can hurt you at all: the seconds after that revive, the bubble an
  // armour ability puts you in, the dash you spend immune. Not the same as `iframes`, which is a
  // *longer* version of the window every hit already gives you.
  if (/(?:invulnerab\w*|invincib\w*|immune) to (?:all )?damage|impervious|damage taken is converted into healing|become immune to damage|cannot be damaged/i.test(line)) flags.add('invuln');
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
  const debuffs = new Set();
  let placeholders = false;
  const addStat = (k, v) => { stats[k] = (stats[k] ?? 0) + v; };
  const add = addStat;
  const pct = (s) => { if (s.startsWith('{')) placeholders = true; return numVal(s, 8) / 100; };
  const flat = (s, fb = 1) => { if (s.startsWith('{')) placeholders = true; return numVal(s, fb); };
  // A class mechanic in prose ("Stealth strikes deal 8% more damage", "15% of your throwing damage
  // is duplicated", "Stealth strikes grant 15% critical strike chance …") is a conditional class
  // damage / crit / armor-pen stat: recorded as `<cls>Cond…` so the solver can credit it at a discount.
  // `partTime` when the line is conditional; a plain line that no flat pattern knew ("15% of your
  // throwing damage is duplicated") is the full stat. `fallback` is the class a conditional line
  // that names none belongs to — every class, since a bonus you wear is not one class's.
  const classMechanic = (line, partTime = true, sign = 1, fallback = null) => {
    if (WORSE.test(line) && !/increas|more|duplicat/i.test(line)) return;
    const cls = Object.entries(CLASS_WORDS).find(([, re]) => re.test(line))?.[0] ?? fallback;
    if (!cls) return;
    const add = (k, v) => addStat(k, sign * v); // `sign` is -1 for a drawback clause worded as a gain
    let m;
    // a stealth strike bonus is a rogue's full stat (stealth strikes are how the class fights), tagged
    // `Stealth` so the solver can mark the item; other conditions are `Cond`
    // a timed buff a stealth strike grants ("15% crit to non-stealth strikes for 10 seconds") is still conditional
    const kind = /stealth strikes?/i.test(line) && !/for \d+(?:\.\d+)? seconds/i.test(line) ? 'Stealth'
      : !partTime ? ''
      : STATE_GATE.test(line) ? 'State' : 'Cond';
    if ((m = line.match(new RegExp(`\\+${NUM} armor penetration`, 'i')))) add(kind ? `${cls}${kind}ArmorPen` : 'armorPen', flat(m[1], 5));
    // the percentage right before the word, with no other percentage in between — or, when the
    // sentence puts it last, the one after it ("summon damage and crit chance are boosted by 10%")
    const after = (what) => line.match(new RegExp(`${what}[^%\\d]*?(?:by|up to|of) ${NUM}%`, 'i'));
    if ((m = line.match(new RegExp(`${NUM}%[^%]*?\\bcrit`, 'i'))) || (m = after('\\bcrit(?:ical)?\\w* (?:strike )?chance'))) add(`${cls}${kind}Crit`, Math.min(15, flat(m[1], 5)));
    // "Magic weapons unleash a star that deals 100% damage" is the *star's* damage, not a bonus you
    // wear — and read as one it made a pre-boss accessory the best magic pick in the game. A bare
    // percentage in front of the word only counts where the line words it as an increase, or as a
    // ceiling on one ("up to 15% damage"); the `after` form is already stat phrasing ("damage … by 10%").
    let dm = line.match(new RegExp(`${NUM}%[^%]*?\\bdamage\\b`, 'i'));
    if (dm && !GRANTS_STAT.test(line)) dm = null;
    if ((dm || (dm = after('\\bdamage\\b'))) && !ENEMY_DAMAGE.test(dm[0])) add(`${cls}${kind}Damage`, Math.min(0.3, pct(dm[1])));
  };
  // values in a conditional line the code cannot give ("any player inside it gains 3 defense and 75% acceleration")
  const condValues = (line) => {
    let m;
    if ((m = line.match(new RegExp(`${NUM}% (?:increased |more )?acceleration`, 'i')))) add('condAccel', pct(m[1]));
    if ((m = line.match(new RegExp(`(?:gains?|grant\\w*|\\+)\\s?${NUM} defense`, 'i')))) add('condDefense', flat(m[1], 4));
    // "granting +1 HP/s life regen", "the aura grants +{1} HP/s life regen": the buff's regen
    if ((m = line.match(new RegExp(`\\+?${NUM} HP/s life regen`, 'i')))) add('condLifeRegen', flat(m[1], 1) * 2); // HP/s → Terraria's half-HP regen units
    // a shell below half life, a barrier while it holds: damage reduction that only sometimes applies
    const dr = line.match(new RegExp(`reduces? (?:the )?damage(?: taken)?(?: done to \\w+)? by ${NUM}%|${NUM}% (?:increased )?damage reduction`, 'i'));
    if (dr) add('condEndurance', pct(dr[1] ?? dr[2]));
    // damage that grows with a condition and no class named it ("Gain an increase to your damage …
    // up to 20% at 50% life or below", "Up to 30% increased damage the lower your life is"). It has
    // to say whose damage: half the lines in the pool are about the damage *enemies* take, and none
    // of those are the player's stat — "up to N% … damage" names it as plainly as "your damage" does.
    const capped = `up to ${NUM}% (?:increased |more )?damage\\b`;
    // …and a bonus gated on the target rather than on your own state ("20% increased damage dealt to
    // Old One's Army enemies"). Only where the line does not *deal* the damage itself: "deals 150%
    // damage to nearby foes" is a weapon describing its own attack, not a stat you wear.
    const targeted = /\bdeals?\b|\bdealing\b/i.test(line) ? null
      : `${NUM}% (?:increased |more |bonus )?damage (?:dealt |done )?(?:to|against) [\\w'’ -]*\\b(?:enem(?:y|ies)|foes?|targets?|bosses|mobs?)\\b`;
    const forms = [capped, targeted].filter(Boolean).join('|');
    if (!dr && new RegExp(`your damage|damage you deal|${forms}`, 'i').test(line) && !ENEMY_DAMAGE.test(line)
      && !Object.keys(CLASS_WORDS).some((c) => CLASS_WORDS[c].test(line))
      && (m = line.match(new RegExp(`\\bdamage\\b[^%]*?(?:by|up to|of) ${NUM}%|${forms}`, 'i')))) {
      add(STATE_GATE.test(line) ? 'allStateDamage' : 'allCondDamage', Math.min(0.3, pct(m[1] ?? m[2] ?? m[3])));
      return true; // the line's damage is recorded; nothing else may read it a second time
    }
    return false;
  };
  // "Critical strikes deal 40 more damage", "Critical strikes have a 50% chance to deal 30 more
  // damage": a flat bonus only the hits that crit get, kept with the chance it comes with. Read
  // before the conditional gate, since the chance makes the line read as conditional.
  const critFlat = (line) => {
    const m = line.match(new RegExp(`crit\\w*.*?deals?(?: an additional| an extra| up to)? ${NUM} more damage`, 'i'));
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
    let line = raw.trim();
    if (!line) continue;
    // Preserve a named ailment even when it is only described in conditional tooltip prose.
    const inflicted = line.match(/\binflicts?\s+(.+?)(?=\s+(?:for\b|on\b|when\b|while\b|after\b|and\s+(?:deals?|grants?|causes?|reduces?|increases?|inflicts?)\b)|[,.]|$)/i)?.[1]
      ?.replace(/^(?:enemies?|targets?)\s+with\s+/i, '').replace(/^(?:the|a|an)\s+/i, '').trim();
    if (inflicted && !/^(?:damage|knockback)$/i.test(inflicted)) debuffs.add(inflicted);
    let cd;
    if ((cd = line.match(new RegExp(`${NUM}[- ]second cooldown|cooldown of ${NUM} seconds?`, 'i')))) {
      add('cooldown', flat(cd[1] ?? cd[2], 5)); // seconds; an on-hit effect's rate
      // …and when the same line is the one describing the right click, the cooldown is that click's
      // own: "Right click to unleash Surging Vampirism … (30 second cooldown)" is one cast every
      // 30 s, not an attack the weapon can be graded on at its use time.
      if (/right[- ]?click|alternate (?:fire|attack)|secondary (?:fire|attack)/i.test(line)) add('altCooldown', flat(cd[1] ?? cd[2], 5));
    }
    // "12.5% of your rogue damage is duplicated" with "Duplication damage caps at 50": the share
    // is recorded next to the ordinary damage stat, and the cap beside it, because a copy of your
    // hit stops growing once the copy reaches the cap — what that is worth is a question of how
    // hard you hit, so `pieceScore` settles it per stage.
    let dm;
    if ((dm = line.match(new RegExp(`${NUM}% of your [\\w ]*damage is duplicated`, 'i')))) add(`${Object.entries(CLASS_WORDS).find(([, re]) => re.test(line))?.[0] ?? 'all'}Duplicated`, pct(dm[1]));
    if ((dm = line.match(new RegExp(`damage caps? (?:out )?at ${NUM}\\b`, 'i')))) stats.damageCap = Math.min(stats.damageCap ?? Infinity, flat(dm[1], 0));
    if (critFlat(line) || stealthRate(line)) continue;
    // Conditional or descriptive lines ("Critical strikes may … dealing 100% damage",
    // "Deals 75% increased damage to enemies above 90% health") are not flat stats.
    // "critical strike chance" is the name of a stat, not a condition: without masking it the
    // CONDITIONAL word `strikes?` makes every line that mentions crit read as conditional, and
    // "Reduces damage taken by 7% and increases critical strike chance by 4%" loses its crit.
    // The whole sentence decides this, drawback clause included — the word that makes it
    // conditional is often in the half after the turn ("…, but only 100% to bosses").
    // …and "…, does not stack with downgrades" says how the bonus combines with the weaker
    // version of the same accessory, not when it applies. Left in, its `does` made every
    // reworded line conditional and Focus Reticle's 15% crit vanished from the item.
    const cl = line.replace(/critical strikes? (?:chance|damage)/gi, 'crit').replace(/,?\s*(?:and )?does not stack[^,.]*/gi, '');
    if ((CONDITIONAL.test(cl) && !UNCONDITIONAL_START.test(line)) || CONDITIONAL_STRONG.test(cl)) {
      flagsOnly(line, flags);
      const took = condValues(line);
      for (const k of statWords(line)) cond.add(k);
      // a conditional line that names no class is still a bonus you wear ("Gain 5% increased damage
      // in the air"): credit it to every class at the discount its condition earns, rather than
      // dropping it. Only where the line reads as a bonus to a stat you carry, though — a bare
      // percentage belongs to something the item fires ("arrows behind you for 50% damage" is the
      // arrow's damage, not yours) — and never where the sentence is about damage something *else*
      // deals or takes, or where `condValues` already took the number out of it.
      const anyClass = !took && GRANTS_STAT.test(line) && !ENEMY_DAMAGE.test(line)
        && !/\bdeals?\b|\bdealing\b|\btakes?\b/i.test(line) ? 'all' : null;
      // a conditional line turns too ("For 5 seconds after a stealth strike, all damage increased
      // by 25%, but stealth strike damage reduced by 25%"): each half is its own class mechanic,
      // and the half that reads as a loss is worded as a gain and counted against you
      for (const [i, clause] of line.split(DRAWBACK).entries()) {
        if (i && (TAKES_DAMAGE.test(clause) || /\bnon-\w/i.test(clause))) continue;
        const loss = i > 0 && WORSE.test(clause);
        classMechanic(loss ? asGain(clause) : clause, true, loss ? -1 : 1, anyClass);
      }
      continue;
    }
    // What the line takes back ("Increases rogue attack speed by 15%, but decreases damage by 10%
    // and crit by 5%"). Every rule below reads a magnitude and trusts the line's wording for its
    // sign, so a drawback tacked onto a bonus was read as a second bonus — Glove of Recklessness's
    // −5 crit came out as +10. A clause that reads as a loss is parsed on its own, worded as a gain
    // so the same rules find its number, and counted against you. `but` also joins two *bonuses*
    // ("Has a 16 second cooldown, but increases melee damage by 50%"), so only the wording of a
    // loss makes a clause a drawback; anything else is parsed as the ordinary clause it is.
    const clauses = line.split(DRAWBACK);
    if (clauses.length > 1) {
      line = clauses[0];
      for (const clause of clauses.slice(1)) {
        // damage *taken*, and a comparison against the classes this is not ("80% decreased
        // non-radiant damage"): real drawbacks, but not ones any stat here can carry
        if (TAKES_DAMAGE.test(clause) || /\bnon-\w/i.test(clause)) continue;
        const loss = WORSE.test(clause);
        const parsed = parseTooltipStats(loss ? asGain(clause) : clause);
        for (const [k, v] of Object.entries(parsed.stats)) add(k, loss && !MORE_IS_WORSE.has(k) ? -Math.abs(v) : v);
        for (const f of parsed.flags) if (!loss) flags.add(f);
        for (const d of parsed.debuffs ?? []) if (!loss) debuffs.add(d);
        for (const k of parsed.conditional) cond.add(k);
        if (parsed.placeholders) placeholders = true;
      }
    }
    // "Provides between -15% and 15% damage" (Calamity's Whiskey, which decays and recharges as you
    // swap weapons): what it is worth over a fight is the middle of its range, not its best end.
    line = line.replace(new RegExp(`between -${NUM}% and ${NUM}%`, 'i'), (s, lo, hi) => (s.includes('{') ? s : `${(Number(hi) - Number(lo)) / 2}%`));
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
    if ((m = line.match(new RegExp(`\\+?${NUM}% (?:increased |more |bonus )?(melee|ranged|magic|summon|minion|rogue|throwing|symphonic|radiant|void|true melee|stealth strike|whip|sentry)?\\s?(?:and (melee|ranged|magic|summon|rogue|throwing|symphonic|radiant) )?(?:damage|dmg)\\b(?! taken)`, 'i')))) {
      // "Removes the 50% damage penalty from the Broken Oath debuff": the number belongs to the
      // penalty being taken away, not to a bonus you wear
      if (/penalt/i.test(line)) { flagsOnly(line, flags); continue; }
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
    // ---- potions: how much they give back, and how often you may drink one. Read before life and
    // regen and without `continue`, because a potion clause almost always shares its line with a
    // stat that has to be read too ("+2 HP/s life regen and reduces the cooldown of healing
    // potions by 25%", which used to lose the potion half to the regen rule below).
    if ((m = line.match(new RegExp(`healing potions? are ${NUM}% more effective|(healing and mana|healing|mana) received from potions by ${NUM}|potion healing by ${NUM}%`, 'i')))) {
      const v = (m[1] ?? m[4]) ? pct(m[1] ?? m[4]) : flat(m[3], 20) / 100; // SOTS words its percentage as a bare "by 40"
      const gain = WORSE.test(line) ? -v : v;
      if (!m[2] || /heal/i.test(m[2])) add('potionHeal', gain);
      if (m[2] && /mana/i.test(m[2])) add('potionMana', gain);
    }
    // a shorter potion sickness is more potions drunk in one fight: the same thing as more per potion
    if ((m = line.match(new RegExp(`cooldown of healing potions by ${NUM}%|potion (?:sickness|cooldown)[a-z ]*by ${NUM}%`, 'i')))) add('potionHeal', pct(m[1] ?? m[2]));
    // Thorium's Potion Chaser, in the same currency: a Greater Healing Potion heals 150
    if ((m = line.match(new RegExp(`(?:drinking|using) a potion heals an additional ${NUM} (?:life|health)`, 'i')))) add('potionHeal', flat(m[1], 25) / 150);
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
  const flatKeys = new Set(Object.keys(stats).filter((k) => !/cond|state|stealth/i.test(k)).map((k) => (/Damage$/.test(k) ? 'damage' : /Crit$/.test(k) ? 'crit' : k === 'damageReduction' ? 'endurance' : k === 'meleeSpeed' ? 'attackSpeed' : k)));
  const conditional = [...cond].filter((k) => !flatKeys.has(k));
  return { stats, classes, placeholders, flags: [...flags], debuffs: [...debuffs], conditional };
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
