/**
 * Thorium's healer, by playstyle: what a weapon and a piece of gear are worth when the player's job
 * is keeping a team alive (Support), draining life on corrupted radiant spells (Dark), or swinging
 * scythes at the boss for soul essence (Reaper).
 *
 * The rest of the lab grades a loadout by what it does for the player wearing it — their DPS and
 * their survival. That is the healer's default, and it stays the default. A playstyle
 * (`ctx.playstyle.healer`) adds what that style plays for:
 *   support  the healing it puts on allies is the class's main output; bonus healing, healing speed
 *            and mana are priced in that currency
 *   dark     the weapons the dark gear empowers hit harder while it is worn, life steal keeps the
 *            player standing, and halving radiant life costs is worth what the health it saves buys
 *   reaper   scythes earn soul essence, and every five of it heal the player for 1 + bonus healing
 *            (and refill four times that in mana): bonus healing is a scythe's sustain
 *
 * Everything here reads what Thorium itself reads. A heal is `ThoriumItem.healAmount` plus the
 * player's `healBonus`, capped at `healBonusMax` (−1 by default: no cap), and `healType` says who it
 * lands on (1 allies, 2 the player, 3 both, 4 life steal) — the same fields its tooltip line
 * "Heals ally life by 4 (+2 Max)" is built from (`ThoriumItem.ModifyTooltips`). A scythe's soul
 * essence is `ScytheItem.scytheSoulCharge`, granted on the first hit of a swing (`ScythePro.OnHitNPC`)
 * and paid out at `SoulEssence.MaxStack` (5) in `ThoriumPlayer.PostUpdateEquips`.
 */
import { FIGHT_SECONDS, LIFE_FLOOR, RANGE_EDGE, VOID_BAR, lifeRegen, manaCap, manaRegen, reachOf, voidRegen } from './dps.js';
import { soft, typicalDps } from './curve.js';

/** The healer playstyles this module grades, and the weapon category each one plays. */
export const SUPPORT = 'support';
export const DARK = 'dark';
export const REAPER = 'reaper';
/** …and the light radiant healer: bolts, maces and wands, graded on their damage plus the heals that land on it too */
export const RADIANT = 'radiant';
export const STYLE_CATEGORY = { support: 'heal', dark: 'dark', reaper: 'scythe', radiant: 'radiant' };
/** The playstyles in the order the weapon list offers them. */
export const HEALER_STYLES = [RADIANT, REAPER, DARK, SUPPORT];
/** The healer's playstyle, or null outside the class or on its default. */
export const healerStyle = (cls, playstyle) => {
  if (cls !== 'healer') return null;
  const s = typeof playstyle === 'string' ? playstyle : playstyle?.healer;
  return s in STYLE_CATEGORY ? s : null;
};
export const isSupport = (cls, playstyle) => healerStyle(cls, playstyle) === SUPPORT;

/**
 * What a healer weapon is, for grouping the list the way a summoner's is grouped by slot:
 *   heal    a healing staff — it heals allies and is one of the HealerTool classes
 *   scythe  a Thorium scythe (or a mace that "counts as a scythe")
 *   dark    a dark healer's weapon: it casts at the cost of life, steals life, or fires something the
 *           dark gear empowers (`ThoriumPlayer.darkAura`)
 *   radiant everything else: light radiant bolts, maces, wands
 */
export function healerCategory(item) {
  if (item?.cls !== 'healer' && item?.class !== 'healer') return null;
  // a staff that only heals; a hybrid that also hits (Coral Purifier) is graded on its damage
  // outside Support, so it is filed with the radiant weapons it competes with (Support plays it
  // too: `playsStyle`) — unless it deals no damage at all (Cell Reconstructor is `HealerDamage` and
  // only heals): that is a healing staff whatever its class, and filed anywhere else it would be in no list
  if (healsAllies(item.heal) && (item.dc === 'HealerTool' || !((item.damage ?? 0) > 0))) return 'heal';
  if (item.scythe !== undefined) return 'scythe';
  if (item.darkAura || item.radiantLifeCost || item.heal?.type === 4) return 'dark';
  return 'radiant';
}

/**
 * Whether a healer weapon is in a playstyle's list. Each playstyle plays its own category, and
 * Support plays every weapon that heals allies: the healing staffs, and the hybrids filed with the
 * radiant, dark or scythe weapons they compete with elsewhere (Coral Purifier, Life Disperser) — a
 * heal riding on a hit is still a heal on the team, and `healOutput` prices how much of it lands.
 */
export const playsStyle = (item, style) => (style === SUPPORT ? healsAllies(item?.heal) : healerCategory(item) === STYLE_CATEGORY[style]);

/**
 * Bonus healing a healer's gear typically carries at a progression value — what the solver itself
 * puts on a support healer: 5 to 7 pre-boss (Novice Cleric's, a Life Gem), ~10 at Wall of Flesh,
 * ~14 at Plantera, ~20 at the end.
 */
export const typicalBonus = (progression) => 5 + 0.75 * Math.max(0, progression ?? 7);
/**
 * Life a typical heal puts back at a progression value: the yardstick healing is measured on. The
 * staff's own heal — fitted to the mined staffs: Heart Wand and Syringe 4 pre-boss, the Wall of Flesh
 * staffs 6 to 8, Staff of Sol and Molecular Stabilizer 18 to 20, Beyond Saving Grace 24 — plus the
 * bonus healing the gear carries. Leaving the bonus out measured a late heal against a 16-life
 * yardstick when it really lands 35: every staff hit the overheal ceiling below, and a pre-boss
 * bandage tied with a Moon Lord staff.
 */
export const typicalHeal = (progression) => 4 * 1.07 ** Math.max(0, progression ?? 7) + typicalBonus(progression);

/**
 * Heals a support healer lands a second, sustained across a fight: a staff's 20-tick cast is 3 a
 * second, but the mana bar (below) and the time spent moving to an ally keep the real rate near
 * half of that. Only used to turn `typicalHeal` into a rate.
 */
export const HEAL_CASTS = 1.5;
export const typicalHps = (progression) => typicalHeal(progression) * HEAL_CASTS;

/**
 * What healing is worth against damage, for a support healer: +10% healing output scores like +15%
 * damage would for anyone else. More than one, because healing is the class's job in this mode and
 * damage is what it does in between; not the 1 ÷ `SUPPORT_DPS_SHARE` a strict reading would give,
 * because the survival stats priced next to it (defense, life, a dodge) keep their full weight.
 */
export const HEAL_VALUE = 1.5;

/**
 * …and what life back to *yourself* is worth, for the dark healer and the reaper: a third of a heal
 * on the team. It keeps one player standing rather than four, and it is survival, which the gear
 * already pays for at face value.
 */
export const SELF_HEAL_VALUE = 0.33;

/**
 * Share of a weapon's own DPS a support healer is credited with. It still fights — a mace's healing
 * orbs only come out of hits, and the boss still has to die — but it spends the fight aiming at
 * allies, not at the boss.
 */
export const SUPPORT_DPS_SHARE = 0.4;

/**
 * Share of a heal that reaches an ally when it rides on a hit rather than on a cast aimed at them:
 * a mace's lingering orbs and a bolt's "damage dealt heals nearby allies" land where the boss is,
 * and whoever happens to be there picks them up. A staff's heal flies to the ally it was cast at.
 */
export const HIT_DELIVERY = 0.5;

/**
 * What the dark gear does to the projectiles that ask for it (`darkAura`): each one does something
 * of its own — a second bolt, shadowflame, a bigger burst — and none of it is read here. A quarter
 * more damage stands in for all of them.
 * ponytail: one number for every empowered projectile; read each one's dark branch if it matters.
 */
export const DARK_EMPOWER = 0.25;

/** Soul essence a scythe pays out at (`SoulEssence.MaxStack`), and the mana a payout refills per life. */
export const SOUL_STACK = 5;
export const SOUL_MANA = 4;

/** Mana a second one point of `Player.manaRegenBonus` buys: +1 regen per 120 ticks, at about half a bar. */
export const MANA_PER_REGEN_BONUS = 0.25;

/** Casts a second no heal outruns, whatever its use time says (Exorectionist reads 1 tick). */
const MAX_CASTS = 6;
/**
 * …and a held one: a channelled staff's use time is the tick it drains mana on while you hold it,
 * not how often a heal goes out — Duke Fish blows one bubble per hold, Heart Wand keeps ten hearts out.
 */
const MAX_CHANNEL_CASTS = 1.5;

/**
 * Healing nobody needs is not healing: past what a team loses, a faster heal tops up full bars.
 * `soft`'s curve with this many typical heal rates as its cap: healing well under it counts nearly in
 * full, ~70% of it at the cap, and none past three times that. Healing yourself caps at one: you are one player.
 */
export const HEAL_DEMAND = 4;
const r2 = (v) => Math.round(v * 100) / 100;

/**
 * How far off an ally typically is when they need the heal, in px: a team fights near each other,
 * not on top of each other. A calibration knob, like dps.js's `ENGAGE`.
 */
export const ALLY_DISTANCE = 240;
/** How far a heal on a spear's or a held tool's tip lands from the player: a spear's length. */
export const TOUCH_REACH = 100;
/** The radius `ProjectileHelper.ThoriumHeal` heals in around its projectile (30 px on the plain heal). */
const HEAL_RADIUS = 30;
/**
 * What a consumable weapon is worth against one you keep: every use is spent from a stack you have
 * to craft or buy again, and a consumable cannot be reforged. A knob, healer only — the thrower's
 * consumables are its class design, and the exhaustion bar already prices the ones it keeps.
 */
export const CONSUMABLE_VALUE = 0.75;

/**
 * How far a heal carries, and what share of it reaches an ally `ALLY_DISTANCE` away: the same
 * reading dps.js gives a damaging shot (`reachOf`, and `RANGE_EDGE` for one that only just gets
 * there). A shot that seeks — it homes, or what it spawns does (a mace's healing orbs) — goes where
 * the ally is. Thorium's `Heal` child is not that: `ThoriumHeal` spawns it where its parent already
 * is, to heal around that spot, so a parent that spawns one is charged its own flight.
 * A spear or a held tool that heals on its own tip (The Giga Needle) heals beside the player: an ally
 * gets it by standing there, so it is charged as touch range (`TOUCH_REACH`).
 * Any other heal that does not fly (a zone, an aura, a channelled or zero-speed one) is not charged:
 * it is often placed at the cursor (Holy Staff, Staff of Sol) or heals around the player in a radius
 * of its own code, neither of which the miner reads — and neither is an unread projectile.
 * @param {object} [projectiles] the dataset's projectiles by id, to ask whether a child homes
 */
export function healReach(item, proj, projectiles = null) {
  if (!proj) return null;
  const seeks = proj.homing || (proj.children ?? []).some((c) => projectiles?.[c.type]?.homing);
  if (seeks) return { reach: Infinity, factor: 1, seeks: true };
  const step = item.shootSpeed ?? 0;
  // (no damage and no children: the tip is the heal — not a hit heal, not a launcher of something that flies)
  if ((item.arch === 'spear' || item.arch === 'held') && !((item.damage ?? 0) > 0) && !proj.children?.length) {
    return { reach: TOUCH_REACH, factor: Math.max(RANGE_EDGE, Math.min(1, TOUCH_REACH / ALLY_DISTANCE)), seeks: false, touch: true };
  }
  if (proj.held || proj.still || proj.pinsUse || proj.ridesOwner || step < 1) return null;
  // …nor is one that "flies" less than a spear's length: that is a beam or a burst whose shape the
  // miner does not read (Exorectionist's "long line of electrical charge" reads as 2 ticks at 1 px)
  const flight = reachOf(proj, step);
  if (flight < TOUCH_REACH) return null;
  const reach = flight + HEAL_RADIUS;
  const factor = reach >= ALLY_DISTANCE ? 1 : Math.max(RANGE_EDGE, reach / ALLY_DISTANCE);
  return { reach, factor, seeks: false };
}

/** Does this heal reach allies at all? */
export const healsAllies = (heal) => heal?.type === 1 || heal?.type === 3;

/**
 * How much of the player's bonus healing a heal takes on: all of it unless the item caps it
 * (`healBonusMax`, −1 by default), and none at a cap of 0.
 */
export const bonusTaken = (heal, bonus) => (heal?.bonusMax === undefined || heal.bonusMax < 0 ? bonus : Math.min(bonus, heal.bonusMax));

/** Void a second the bar sustains across a fight, the same way: dps.js's regeneration (times the gear's), and the bar spent once. */
export const voidBudget = (progression, regenBonus = 0, maxBonus = 0) => voidRegen(progression) * (1 + regenBonus) + (VOID_BAR + maxBonus) / FIGHT_SECONDS;

/** Mana a second the bar sustains across a fight: dps.js's regeneration, the gear's, and the bar spent once. */
export const manaBudget = (progression, regenBonus = 0) => manaRegen(progression) + MANA_PER_REGEN_BONUS * regenBonus + manaCap(progression) / FIGHT_SECONDS;

/**
 * Healing a weapon puts on allies per second, with the loadout's bonus healing, healing speed and
 * mana cost. Healing speed is `GetAttackSpeed<HealerTool>`: it reaches the healing staffs and the
 * `HealerToolDamageHybrid` weapons, which inherit every HealerTool modifier, and nothing that is
 * plain `HealerDamage` — those inherit nothing from it.
 *
 * Sustained, not burst: a cast that costs mana is capped at what the bar can pay for across a
 * fight — the regeneration dps.js credits (potions included), what the gear adds, and the bar spent once.
 *
 * Use time and mana are the weapon's effective ones (`eff`, from `effectiveStats`): a reforge that
 * casts faster or cheaper heals more, and so do the balancing overlays the DPS model already replays.
 * @returns {null | { hps: number, perCast: number, casts: number, raw: number, limited: boolean, delivery: number, parts: Array<{label: string, value: number, detail?: string}> }}
 */
export function healOutput(item, { progression, bonus = 0, healSpeed = 0, manaCost = 0, manaRegen: regenBonus = 0, voidRegen: voidRegenBonus = 0, voidMax = 0, lifeCostDiv = 1, proj = null, projectiles = null, eff = null } = {}) {
  const heal = item?.heal;
  if (!healsAllies(heal)) return null;
  const use = eff?.useAnimation || eff?.useTime || item.useAnimation || item.useTime;
  if (!use) return null;
  const fromBonus = bonusTaken(heal, bonus);
  const perCast = (heal.amount ?? 0) + fromBonus;
  const tool = item.dc === 'HealerTool' || item.dc === 'HealerToolDamageHybrid';
  const speed = tool ? healSpeed : 0;
  const raw = Math.min(item.channel ? MAX_CHANNEL_CASTS : MAX_CASTS, (60 / use) * (1 + speed));
  let casts = raw;
  const cost = (eff?.mana ?? item.mana ?? 0) * Math.max(0.1, 1 - manaCost);
  const budget = manaBudget(progression, regenBonus);
  if (cost > 0) casts = Math.min(casts, budget / cost);
  // …and a void hybrid's cast is paid from the void bar (SOTSBardHealer's Vibrant Resonator: 15 a cast)
  const vBudget = item.voidCost > 0 ? voidBudget(progression, voidRegenBonus, voidMax) : 0;
  const byMana = casts;
  if (item.voidCost > 0) casts = Math.min(casts, vBudget / item.voidCost);
  // …and one cast "at the cost of life" (Pledge of Selflessness, Chiron's Cure) out of the health
  // bar, the way dps.js prices it: what life regeneration keeps up with, never under `LIFE_FLOOR`
  // (the dark gear that halves radiant life costs divides it)
  const lifeCost = item.lifeCost > 0 ? item.lifeCost / (item.radiantLifeCost ? Math.max(1, lifeCostDiv) : 1) : 0;
  const byVoid = casts;
  if (lifeCost > 0) casts *= Math.min(1, Math.max(LIFE_FLOOR, lifeRegen(progression) / (lifeCost * casts)));
  // a heal riding on a hit: the weapon deals damage and is not one of the HealerTool classes
  const delivery = (item.damage ?? 0) > 0 && !tool ? HIT_DELIVERY : 1;
  // range is the reach of a heal aimed at an ally; one riding on a hit lands where the boss is, which
  // `HIT_DELIVERY` already prices
  const range = delivery < 1 ? null : healReach(item, proj, projectiles);
  const hps = perCast * casts * delivery * (range?.factor ?? 1);
  const parts = [
    { label: `${perCast} life a heal`, value: perCast, detail: `${heal.amount ?? 0} base${fromBonus ? ` + ${fromBonus} bonus healing` : ''}${heal.bonusMax >= 0 ? ` (it takes at most ${heal.bonusMax} of your bonus healing)` : ''}.` },
    { label: `${r2(casts)} heals/s`, value: casts, detail: `${r2(raw)}/s from its ${r2(use)}-tick use${speed ? ` and ${Math.round(speed * 100)}% healing speed` : ''}${casts < byVoid ? `, held to ${r2(casts)}/s by your health: ${r2(lifeCost)} life a cast against the ${r2(lifeRegen(progression))} life/s you get back` : casts < byMana ? `, held to ${r2(casts)}/s by void: ${item.voidCost} a cast against the ${Math.round(vBudget * 10) / 10} void/s the bar sustains across a ${FIGHT_SECONDS} s fight` : casts < raw ? `, held to ${r2(casts)}/s by mana: ${Math.round(cost * 10) / 10} a cast against the ${Math.round(budget * 10) / 10} mana/s the bar sustains across a ${FIGHT_SECONDS} s fight` : ''}.` },
  ];
  if (range && range.factor < 1) parts.push({ label: `×${r2(range.factor)} reaches ${Math.round(range.reach)} px of ${ALLY_DISTANCE}`, value: range.factor, detail: range.touch ? `It heals on its own tip, beside you; an ally is typically ${ALLY_DISTANCE} px off, so it only lands when they come to you.` : `Its heal flies ${Math.round(range.reach)} px; an ally is typically ${ALLY_DISTANCE} px off, so a short heal only lands when they come to you.` });
  else if (range) parts.push({ label: range.seeks ? 'seeks the ally out' : `reaches ${Number.isFinite(range.reach) ? Math.round(range.reach) : '∞'} px`, value: 1, detail: range.seeks ? 'It homes in on whoever needs it, so range costs it nothing.' : undefined });
  if (delivery < 1) parts.push({ label: `×${delivery} reaches an ally`, value: delivery, detail: 'The heal rides on a hit — lingering orbs or a burst where the boss is — so it lands on whoever is nearby rather than on the ally you aimed at.' });
  return { hps, perCast, casts, raw, limited: casts < raw, delivery, range, parts };
}

/**
 * A weapon's worth to a support healer, in the DPS currency the weapon list ranks by: its healing
 * converted at what a typical heal is worth against a typical weapon's DPS at the stage, plus the
 * share of its own DPS the class is credited with.
 */
export function supportValue(item, dps, { progression, ...loadout }) {
  const h = healOutput(item, { progression, ...loadout });
  const rate = typicalDps(progression) / typicalHps(progression);
  const demand = HEAL_DEMAND * typicalHps(progression);
  const useful = soft(h?.hps ?? 0, demand);
  const healPart = useful * rate * HEAL_VALUE;
  const dpsPart = (dps ?? 0) * SUPPORT_DPS_SHARE;
  return { value: healPart + dpsPart, hps: h?.hps ?? 0, useful, demand, heal: h, healPart, dpsPart, rate };
}

/**
 * Life a weapon gives back to its wielder each second: a scythe's soul essence (reaper), a life
 * steal or a heal that lands on you too (dark and default). `uses` is how often it is used a second
 * and `hits` how many hits it lands, both from the DPS model.
 */
export function selfHeal(item, { style, bonus = 0, uses = 0, hits = 0 }) {
  const rows = [];
  let hps = 0;
  if (style === REAPER && item.scythe > 0 && uses > 0) {
    const essence = item.scythe * uses;
    const life = 1 + bonus;
    hps += (essence / SOUL_STACK) * life;
    rows.push({ label: `${item.scythe} soul essence a swing`, value: r2(essence), detail: `The first hit of every swing grants ${item.scythe}: ${r2(essence)} a second at ${r2(uses)} swings/s.` });
    rows.push({ label: `${life} life (and ${SOUL_MANA * life} mana) per ${SOUL_STACK} essence`, value: r2(hps), detail: `Every ${SOUL_STACK} soul essence heal you for 1 + your ${bonus} bonus healing: ${r2(hps)} life a second.` });
  }
  if (item.heal?.type === 4 && hits > 0) {
    // life steal on every hit, at the weapon's own rate: vanilla's steal pool caps it long before
    // the arithmetic does, which the self-heal ceiling below stands in for
    const steal = (item.heal.amount + bonusTaken(item.heal, 0)) * hits;
    hps += steal;
    rows.push({ label: `steals ${item.heal.amount} life a hit`, value: r2(steal), detail: `${r2(hits)} hits a second.` });
  }
  if (item.heal?.type === 3 && style !== null && uses > 0) {
    // a heal that lands on you and your allies: the half of it that reaches you, the way it reaches an ally
    const per = (item.heal.amount ?? 0) + bonusTaken(item.heal, bonus);
    const back = per * uses * HIT_DELIVERY;
    if (back > 0) { hps += back; rows.push({ label: `${per} life a heal, on you too`, value: r2(back), detail: `Half of ${r2(uses)} heals a second reach you: it lands where the fight is.` }); }
  }
  return { hps, rows };
}

/**
 * A weapon's worth to a dark healer or a reaper, in the DPS currency the list ranks by: its DPS —
 * a quarter more for a weapon the dark gear empowers, while the loadout wears that gear — plus the
 * life it gives back, converted like a heal and worth a third of one, flattening at one player's
 * worth of healing.
 */
export function styleValue(item, d, { style, progression, loadout = {} }) {
  const rows = [];
  const dps = (item.damage ?? 0) > 0 ? (d?.value ?? 0) : 0;
  let value = dps;
  rows.push({ label: 'Real DPS', value: r2(dps) });
  if (style === DARK && item.darkAura && loadout.darkAura) {
    value += dps * DARK_EMPOWER;
    rows.push({ label: `+${Math.round(DARK_EMPOWER * 100)}% empowered by your dark gear`, value: r2(dps * DARK_EMPOWER), detail: 'Something this weapon fires reads `darkAura`, the flag the dark healer\'s gear sets. What the empowerment does differs per weapon and is not read here; it counts as a quarter more damage.' });
  }
  // a swing a use: the soul essence comes off the first hit of each one, whatever else it fires
  // (at the weapon's effective use time: a faster reforge swings, and earns, more)
  const use = d?.eff?.useAnimation || d?.eff?.useTime || item.useAnimation || item.useTime;
  const uses = use ? 60 / use : 0;
  const hits = d?.hit > 0 ? dps / d.hit : 0;
  const self = selfHeal(item, { style, bonus: loadout.healBonus ?? 0, uses, hits });
  rows.push(...self.rows);
  if (self.hps > 0) {
    const rate = typicalDps(progression) / typicalHps(progression);
    const useful = soft(self.hps, typicalHps(progression));
    const part = useful * rate * SELF_HEAL_VALUE;
    value += part;
    rows.push({ label: `life back, in DPS (×${r2(rate * SELF_HEAL_VALUE)})`, value: r2(part), detail: `${r2(self.hps)} life a second back to you${useful < self.hps * 0.95 ? `, ${r2(useful)} of it useful — one player only loses so much` : ''}, at a third of what a heal on the team is worth.` });
  }
  return { value, rows, selfHps: self.hps };
}

/**
 * Ally effects that fire when a heal lands (`ProjectileHelper.ThoriumHealTarget`), by the player
 * flag that turns them on: points for a support healer, nothing solo — there is nobody to heal.
 */
export const ALLY_FLAGS = {
  accForgottenCrossNecklace: [6, 'healed allies gain 14 defense'],
  accVerdantOrnament: [4, 'healed allies regenerate faster'],
  accMedicalBag: [3, 'healed allies gain life recovery'],
  accEqualizer: [3, 'healed allies gain life recovery'],
  accAloeLeaf: [3, 'healed allies gain a buff'],
  honeyHeart: [3, 'healed allies get Honey'],
  accPrydwen: [4, 'you recover 4 life for every ally you heal'],
  setLifeBinder: [8, 'healed allies get the Life Binder buff'],
  setBlooming: [6, 'healed allies get the Blooming buff'],
  setCoral: [4, 'healing an ally passes on your life shield'],
  setDreamWeaversHood: [8, 'healed allies get the Dream Weaver buff'],
};

/**
 * A healer weapon graded for a playstyle: the DPS model's result with the playstyle's value on top
 * and the arithmetic as rows for the item card, plus the weapon's category either way. With no
 * playstyle it is the DPS result untouched — the default healer is graded like every other class.
 */
export function gradeHealerWeapon(item, d, { style, progression, loadout = {}, projectiles = null }) {
  const category = healerCategory(item);
  const graded = gradeStyle(item, d, { style, progression, loadout, proj: projectiles?.[item.shoot] ?? null, projectiles, category });
  // the default healer is graded like every other class; a playstyle also prices a consumable's
  // stack: the same cut on the value and on the rows
  if (!style || !item.consumable) return graded;
  const label = `consumable: every use is spent from a stack (×${CONSUMABLE_VALUE})`;
  return {
    ...graded,
    value: (graded.value ?? 0) * CONSUMABLE_VALUE,
    parts: [...(graded.parts ?? []), { fac: 'hits', label, mul: CONSUMABLE_VALUE }],
    style: graded.style && { ...graded.style, value: graded.style.value * CONSUMABLE_VALUE, rows: [...graded.style.rows, { label, value: r2(graded.style.value * CONSUMABLE_VALUE), detail: 'Crafted or bought again in stacks, and it cannot be reforged.' }] },
  };
}

function gradeStyle(item, d, { style, progression, loadout, proj, projectiles, category }) {
  if (!style) return category ? { ...d, category } : d;
  const own = (item.damage ?? 0) > 0 ? (d?.value ?? 0) : 0;
  if (style === SUPPORT) {
    const sv = supportValue(item, own, { progression, bonus: loadout.healBonus ?? 0, healSpeed: loadout.healSpeed ?? 0, manaCost: loadout.manaCost ?? 0, manaRegen: loadout.manaRegen ?? 0, voidRegen: loadout.voidRegen ?? 0, voidMax: loadout.voidMax ?? 0, lifeCostDiv: loadout.radiantLifeCost ?? 1, proj, projectiles, eff: d?.eff ?? null });
    const rows = [
      ...(sv.heal?.parts ?? []).map((p) => ({ ...p, value: r2(p.value) })),
      { label: 'life to allies a second', value: r2(sv.hps), detail: sv.useful < sv.hps * 0.95 ? `${r2(sv.useful)} of it counts: past ${r2(sv.demand)} a second a team is mostly topped up.` : undefined },
      { label: `healing, in DPS (×${r2(sv.rate * HEAL_VALUE)})`, value: r2(sv.healPart), detail: `A typical heal at this stage is worth a typical weapon's DPS, ×${HEAL_VALUE}: healing is the class's job in Support.` },
      { label: `${Math.round(SUPPORT_DPS_SHARE * 100)}% of its own DPS`, value: r2(sv.dpsPart) },
    ];
    return { ...d, kind: 'support', mode: null, value: sv.value, dps: own, category, support: sv, style: { name: style, value: sv.value, rows } };
  }
  const sv = styleValue(item, d, { style, progression, loadout });
  return { ...d, kind: 'style', value: sv.value, dps: own, category, style: { name: style, value: sv.value, rows: sv.rows } };
}

/**
 * Which healer playstyles a piece of gear is built for — the same four the weapon list is cut into,
 * so picking one shows which armour and accessories belong with it. Read off what the piece (and,
 * for a head, its set bonus) does, not off its name:
 *   support  bonus healing, healing speed, or an effect that fires when a heal lands on an ally
 *   dark     the dark gear's `darkAura`, halved radiant life costs, or life steal
 *   reaper   anything that touches soul essence, and bonus healing — every five soul essence heal
 *            for 1 + bonus healing, which is what the Scythes playstyle scores it on
 *   radiant  radiant damage, crit or casting speed with no dark corruption on it
 */
export function healerGearStyles(item) {
  if (!item) return [];
  const fx = [item.effects, item.setEffects].filter(Boolean);
  const st = { ...(item.stats ?? {}), ...(item.setStats ?? {}) };
  const flags = new Set([...fx.flatMap((f) => f.flags ?? []), ...(item.flags ?? []), ...(item.setFlags ?? [])]);
  const text = `${item.tooltip ?? ''}\n${item.setBonus ?? ''}`;
  const out = [];
  if ((st.healerHealing ?? 0) > 0 || st.healSpeed > 0 || fx.some((f) => (f.mod?.healBonus ?? 0) > 0 || f.attackSpeed?.healing > 0) || [...flags].some((f) => f in ALLY_FLAGS)) out.push(SUPPORT);
  const dark = flags.has('darkAura') || fx.some((f) => (f.mod?.radiantLifeCost ?? 0) > 1) || /steals? life|life ?steal/i.test(item.tooltip ?? '');
  const bonus = (st.healerHealing ?? 0) > 0 || fx.some((f) => (f.mod?.healBonus ?? 0) > 0);
  if (/soul essence|radiant scythes?/i.test(text) || bonus) out.push(REAPER);
  if (dark) out.push(DARK);
  const radiant = (st.healerDamage ?? 0) > 0 || (st.healerCrit ?? 0) > 0 || (st.healerSpeed ?? 0) > 0 || fx.some((f) => (f.damage?.healer ?? 0) > 0 || (f.crit?.healer ?? 0) > 0 || (f.attackSpeed?.healer ?? 0) > 0);
  if (radiant && !flags.has('darkAura')) out.push(RADIANT);
  return out;
}

/** The playstyles a set is built for: those of any of its three pieces (a head's set bonus counts for the head). */
export const healerSetStyles = (set) => [...new Set([set.head, set.body, set.legs].flatMap((p) => healerGearStyles(p.item)))];
