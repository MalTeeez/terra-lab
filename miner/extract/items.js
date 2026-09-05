/**
 * ModItem discovery and `SetDefaults` evaluation.
 */
import { decodeIL, ldcValue } from '../clr/il.js';
import { deCamel } from './localization.js';
import { ITEM, Machine, PLAYER, THIS, UNKNOWN, isNum, simpleName, tmlStaticHook, tmlStaticLoadHook } from './interp.js';
import { TYPE_ABSTRACT, contentRefs, derivesFromTml, findInherited, refId } from './util.js';
import { extractItemEffects } from './effects.js';
import { ownedCapOf } from './guards.js';
import { analyzeShoot } from './shoot.js';
import { projRef } from './projectiles.js';
import { extractWingStats } from './wings.js';

export const EQUIP = ['Head', 'Body', 'Legs', 'HandsOn', 'HandsOff', 'Back', 'Front', 'Shoes', 'Waist', 'Wings', 'Shield', 'Neck', 'Face', 'Balloon', 'Beard'];

export const isModItemType = (asm, td) => derivesFromTml(asm, td, 'ModItem');

/**
 * Evaluate SetDefaults for one ModItem TypeDef.
 * @returns {{ fields: Record<string, any>, calls: Set<string>, damageClass?: string, cloneOf?: number|string }}
 */
export function evalSetDefaults(asm, td, { tml, ammoIds = null }) {
  const rec = { fields: {}, calls: new Set() };
  const machine = new Machine(asm, {
    tml,
    concreteType: td,
    budget: 30000,
    // an addon's weapon is set up by the mod it extends (`ThoriumMod.ScytheItem.SetDefaultsToScythe`
    // is where Ragnarok's scythes get their healer damage class and half their stats)
    crossAsm: true,
    onStore(recv, name, value) {
      if (recv !== ITEM) return;
      if (name === 'DamageType') {
        if (value?.k === 'dc') {
          // the first class written is the weapon's own: SOTS's `VoidItem.SetDefaults` runs the
          // item's `SafeSetDefaults` (where it says Ranged) and then swaps in `VoidRanged`, and the
          // swap's four branches all compare a class the machine cannot read, so the last write
          // seen was whichever branch came first — `VoidMelee` for 84 of 86 void weapons
          rec.baseDamageClass ??= value.name;
          rec.damageClass = value.name; rec.damageClassFull = value.full;
        }
        return;
      }
      if ((name === 'melee' || name === 'ranged' || name === 'magic' || name === 'summon') && value === 1) {
        rec.damageClass = name[0].toUpperCase() + name.slice(1);
        return;
      }
      rec.fields[name] = value;
    },
    onLoad(recv, name) {
      if (recv === ITEM) return rec.fields[name] ?? UNKNOWN;
      return undefined;
    },
    onCall(callee, args, ctx) {
      const hooked = tmlStaticHook(callee, args, ctx);
      if (hooked !== undefined) return hooked;
      const decl = callee.declaringType?.fullName ?? '';
      if (decl === 'Terraria.Item' && ctx.recv === ITEM) {
        rec.calls.add(callee.name);
        if (callee.name === 'DefaultToPlaceableTile' || callee.name === 'DefaultToPlaceableWall') {
          // inlining the helper loses the tile argument; the rest of what it sets is furniture stuff
          if (callee.name === 'DefaultToPlaceableTile' && args[0] !== undefined) rec.fields.createTile = args[0];
          return UNKNOWN;
        }
        if (callee.name === 'CloneDefaults' || callee.name === 'SetDefaults') {
          const a = args[0];
          if (isNum(a)) rec.cloneOf = a;
          else if (a?.k === 'type') rec.cloneOf = a.name;
          return UNKNOWN;
        }
      }
      return undefined;
    },
    onStaticLoad(f) {
      if (ammoIds && (f.declaringType?.fullName ?? '') === 'Terraria.ID.AmmoID') return ammoIds.get(f.name) ?? UNKNOWN;
      return tmlStaticLoadHook(f);
    },
  });
  const sd = findInherited(asm, td, 'SetDefaults');
  if (sd) machine.run(sd, THIS, []);
  return rec;
}

const num = (v) => (isNum(v) ? v : undefined);

/**
 * How many of its own projectiles a weapon lets you have out at once, from the near-universal
 * `CanUseItem` shape `player.ownedProjectileCounts[Item.shoot] < N`. It is the difference between a
 * boomerang's use time meaning anything and meaning nothing: a 12-tick use time on a weapon that
 * allows one out at a time is throttled by the round trip, not by the animation.
 * @returns {number|undefined}
 */
export function maxOutOf(asm, td) {
  return ownedCapOf(asm, findInherited(asm, td, 'CanUseItem'));
}

/** A format argument as text: 0.05 → "0.05", `ToPercent(0.05, "N1")` → "5.0"; unknown values keep their placeholder. */
const fmtArg = (v) => (typeof v === 'string' ? v : isNum(v) ? String(Number.isInteger(v) ? v : Math.round(v * 100) / 100) : null);

/**
 * Format arguments of a mod item's texts: a `Tooltip` getter override doing
 * `base.Tooltip.WithFormatArgs(DamageBoost * 100, ...)`, and `player.setBonus =
 * this.GetLocalization("SetBonus").Format(SetBonusDR.ToPercent("N1"))` in UpdateArmorSet.
 * @returns {{ tooltipArgs?: any[], setBonusArgs?: any[] }}
 */
function formatArgsOf(asm, td, { tml }) {
  const out = {};
  const hooks = (onSetBonus) => ({
    onCall(callee, args, ctx) {
      const hooked = tmlStaticHook(callee, args, ctx);
      if (hooked !== undefined) return hooked;
      const name = callee.name;
      const decl = callee.declaringType?.fullName ?? '';
      if ((name === 'get_Tooltip' || name === 'get_DisplayName') && /ModItem$|ModType$/.test(decl)) return { k: 'loc', key: name.slice(4), args: null };
      if (name === 'GetLocalization' && typeof args[1] === 'string') return { k: 'loc', key: args[1], args: null };
      if (name === 'GetLocalization' && typeof args[0] === 'string') return { k: 'loc', key: args[0], args: null };
      if ((name === 'WithFormatArgs' || name === 'Format') && (ctx.recv?.k === 'loc' || args[0]?.k === 'loc')) {
        const loc = ctx.recv?.k === 'loc' ? ctx.recv : args[0];
        const rest = ctx.recv?.k === 'loc' ? args : args.slice(1);
        const list = rest.length === 1 && rest[0]?.k === 'arr' ? rest[0].items : rest;
        return { ...loc, args: list.map(fmtArg) };
      }
      // `ToPercent`, `ToStealth`, `FramesToSeconds` and the rest are thin wrappers over
      // `float.ToString(fmt)`, which the interpreter answers — so they inline and round the way the
      // game does rather than needing a hook each.
      if (ctx.recv?.k === 'loc') return ctx.recv;
      return undefined;
    },
    onStore(recv, name, value) { if (recv === PLAYER && name === 'setBonus' && value?.k === 'loc' && value.args) onSetBonus(value.args); },
    onStaticLoad: tmlStaticLoadHook,
  });
  const tt = findInherited(asm, td, 'get_Tooltip');
  if (tt) {
    try {
      const v = new Machine(asm, { tml, concreteType: td, budget: 5000, maxDepth: 3, ...hooks(() => {}) }).run(tt, THIS, []);
      if (v?.k === 'loc' && v.args?.length) out.tooltipArgs = v.args;
    } catch { /* keep going */ }
  }
  const uas = findInherited(asm, td, 'UpdateArmorSet');
  if (uas) {
    try { new Machine(asm, { tml, concreteType: td, budget: 8000, maxDepth: 3, ...hooks((args) => { out.setBonusArgs = args; }) }).run(uas, THIS, [PLAYER]); } catch { /* keep going */ }
  }
  return out;
}

/** Decide what kind of equipment a record describes. */
export function slotOf(rec, equip) {
  const f = rec.fields;
  if (equip.includes('Head')) return 'head';
  if (equip.includes('Body')) return 'body';
  if (equip.includes('Legs')) return 'legs';
  if (f.headSlot > 0) return 'head';
  if (f.bodySlot > 0) return 'body';
  if (f.legSlot > 0) return 'legs';
  if (f.accessory === 1 || f.accessory === true) return 'accessory';
  if (equip.includes('Wings') || f.wingSlot > 0) return 'accessory';
  if (rec.calls.has('DefaultToPlaceableTile') || rec.calls.has('DefaultToPlaceableWall') || f.createTile > 0 || f.createWall > 0) return 'placeable';
  if (rec.calls.has('DefaultToVanitypet') || rec.calls.has('DefaultToMount') || (f.buffType > 0 && !(f.damage > 0))) return 'misc';
  if (f.ammo > 0 || rec.calls.has('DefaultToFood')) return 'misc';
  if (f.damage > 0) return 'weapon';
  return 'misc';
}

/** Vanilla aiStyles of a projectile that parks itself where it was cast (the Crimson Rod's cloud). */
const PLACED_AI = new Set([45]);
/** Vanilla aiStyles the player holds out: Vilethorn's beam, drills and chainsaws, the Arkhalis. */
const HELD_AI = new Set([4, 20, 75]);
/** The damage class Terraria uses for a hit the weapon itself lands, at contact range. */
const TRUE_MELEE_RE = /^TrueMelee/;
const isWhip = (x) => x.whip || x.ai === 165 || /^SummonMeleeSpeed/.test(x.dc ?? '');

/** Ammo item ids that name the weapon holding them (Terraria's own `useAmmo` values). */
const AMMO_ARCH = { 40: 'bow', 97: 'gun', 283: 'gun', 771: 'launcher', 23: 'flamethrower', 931: 'flamethrower', 1261: 'launcher' };

/**
 * How a weapon delivers its damage, from its own fields and the projectile it fires. This is the
 * only thing the DPS model branches on: nothing downstream looks at a use style again. The names
 * follow the wiki's weapon-type lists, but every one of them is decided by a mined field, never by
 * what an item is called:
 *
 *   melee   swing (broadsword) · shortsword · specialsword · spear · yoyo · flail · boomerang
 *   ranged  bow · repeater · gun · launcher · flamethrower
 *   magic   shot (wands, magic guns, spell tomes all just fire) · held (beams) · placed
 *   summon  minion · sentry · whip
 *   rogue   bomb · boomerang · dagger · javelin · spikyball
 *
 * The subtypes exist because they *behave* differently, and `ARCHETYPE` in `src/lib/dps.js` is
 * where each one's delivery model lives. Types that would only differ by name — a wand against a
 * spell tome, a magic gun against either — stay one tag, because nothing downstream would branch
 * on the difference.
 *
 * A held projectile from a weapon that does not `channel` is a stab (a spear); one that channels
 * is a beam, a drill or a flamethrower the player keeps pointed at the boss.
 * @param {object} item     the assembled item record
 * @param {object|null} p   the projectile it shoots, if the dataset has it
 * @param {string|null} cls the item's class after aliases
 */
export function archetypeOf(item, ps, cls) {
  // What a weapon *is* comes from everything it puts out when you use it, not only from the one
  // projectile `Item.shoot` names — that is the default shot, and a weapon whose real attack is
  // spawned in `Shoot` reads as whatever its secondary happens to be. Calamity's Sahara Slicers
  // names its right-click bolt in `shoot` and stabs with a pair of held blades from `Shoot`, so
  // reading `shoot` alone called a pair of short-range daggers a thrown weapon.
  const list = (Array.isArray(ps) ? ps : [ps]).filter(Boolean);
  const p = list[0] ?? null; // the default shot: what a thrown weapon throws
  const any = (fn) => list.some(fn);
  if (any((x) => x.minion)) return 'minion';
  if (any((x) => x.sentry)) return 'sentry';
  // `SummonMeleeSpeedDamageClass` is Terraria's own word for whip damage, and it survives the
  // spawner pattern (a held projectile whose only job is to lash with two whips of its own) that
  // `whip`/aiStyle 165 on the weapon's own shot does not.
  if (any((x) => isWhip(x) || (x.kids ?? []).some(isWhip))) return 'whip';
  if (any((x) => x.yoyo || x.ai === 99)) return 'yoyo';
  if (any((x) => x.ai === 15)) return 'flail';
  if (any((x) => x.ai === 19)) return 'spear';
  if (p?.ai === 3 || p?.returns) return 'boomerang';
  // Ammo names the ranged weapon, and it says so louder than anything the weapon holds: a bow that
  // is drawn before it looses puts a bow sprite in the player's hands (a `heldProj` on a held
  // aiStyle), but the damage leaves in the arrow it consumes. Read before the held and placed
  // styles, or a charge bow is scored as a beam the player keeps on the boss.
  // A repeater is a bow that keeps firing while the button is held.
  const byAmmo = AMMO_ARCH[item.useAmmo];
  if (byAmmo) return byAmmo === 'bow' && item.autoReuse ? 'repeater' : byAmmo;
  if (p?.still || PLACED_AI.has(p?.ai)) return 'placed';
  // A held projectile the game itself calls *true melee* is a blade in the player's hands, not a
  // beam across the room: `TrueMeleeDamageClass` is Terraria's own word for damage the weapon deals
  // at contact range, and every weapon in the pool carrying it on a held projectile is one — the
  // drills, Old Lord Claymore, Sahara Slicers' pair of short daggers. `held`'s reach is a beam's.
  const heldBy = (fn) => list.find((x) => (x.held || HELD_AI.has(x.ai)) && fn(x));
  if (heldBy((x) => TRUE_MELEE_RE.test(x.dc ?? ''))) return 'truemelee';
  if (any((x) => HELD_AI.has(x.ai))) return 'held';
  // a projectile the weapon keeps in the player's hands: a beam or a drill if it channels, a thrust
  // if it does not. Either way the damage happens at arm's length, whatever else the weapon throws.
  if (any((x) => x.held)) return item.channel ? 'held' : 'spear';
  // a shortsword is a stab you make yourself; a thrown weapon that borrows the stabbing animation
  // (`noMelee`, and the damage is all in what it throws) is not one
  if (item.useStyle === 3 && !item.noMelee) return 'shortsword';
  const shoots = !!item.shoot || item.useAmmo > 0 || !!item.fire?.calls?.length;
  if (!item.noMelee && (item.useStyle === 1 || item.useStyle === undefined) && (cls === 'melee' || !shoots)) return 'swing';
  if (!shoots) return 'swing';
  // a melee weapon that throws a blade instead of swinging one: Arkhalis, Terragrim, the flying swords
  if (cls === 'melee' && !item.noMelee) return 'specialsword';
  // thrown rogue weapons split by what the throw does, not by what it is called
  if (cls === 'rogue' || cls === 'thrower') return thrownArch(item, p);
  return 'shot';
}

/**
 * A thrown rogue weapon by what it does when it lands.
 *   bomb       it blows up: a blast radius of its own, or one on the child it dies into
 *   spikyball  it stops where it falls and waits to be walked into
 *   javelin    it sticks in what it hits and keeps hurting it
 *   dagger     none of the above: it flies, it hits, it is gone
 */
function thrownArch(item, p) {
  if (!p) return 'dagger';
  const blast = (c) => (c?.explode ?? 0) >= BLAST_PX;
  if (blast(p) || (p.children ?? []).some((c) => c.where === 'kill')) return 'bomb';
  // it embeds in what it hits and goes no further
  if (p.sticks) return 'javelin';
  // it comes to rest on the ground: only what walks into it gets hit
  if (p.tile && p.gravity && (p.life ?? 0) >= LINGER_TICKS) return 'spikyball';
  return 'dagger';
}
/** A `Kill` that resizes the projectile to at least this is an explosion, not a sprite change. */
const BLAST_PX = 40;
/** A thrown weapon that lives this long is not passing through, it is waiting on the ground. */
const LINGER_TICKS = 600;

/**
 * @param {import('../clr/metadata.js').Assembly} asm
 * @param {{ tml: import('../clr/metadata.js').Assembly, loc: ReturnType<typeof import('./localization.js').loadLocalization>, modId: string, effects?: boolean }} ctx
 */
export function extractItems(asm, { tml, loc, modId, effects = true, ammoIds = null }) {
  const out = [];
  for (const td of asm.types) {
    if (td.flags & TYPE_ABSTRACT) continue;
    if (td.name.includes('`') || td.name.startsWith('<')) continue;
    if (!isModItemType(asm, td)) continue;

    const rec = evalSetDefaults(asm, td, { tml, ammoIds });
    // a void weapon is its vanilla class wearing the void family's coat: keep the class it set
    // itself as the subclass, and name the void class it actually ends up with
    const VOID_OF = { Melee: 'VoidMelee', Ranged: 'VoidRanged', Magic: 'VoidMagic', Summon: 'VoidSummon' };
    const voidSub = /^Void(Melee|Ranged|Magic|Summon|Generic)$/.test(rec.damageClass ?? '') && VOID_OF[rec.baseDamageClass] ? rec.baseDamageClass : null;
    if (voidSub) rec.damageClass = VOID_OF[voidSub];
    const attrs = asm.attributes(td.token);
    const equip = [];
    for (const a of attrs) {
      if (a.name !== 'AutoloadEquipAttribute' && a.name !== 'AutoloadEquip') continue;
      try {
        const { fixed } = asm.attributeArgs(a);
        const list = Array.isArray(fixed[0]) ? fixed[0] : fixed;
        for (const v of list) if (typeof v === 'number' && EQUIP[v]) equip.push(EQUIP[v]);
      } catch { /* unreadable attribute blob */ }
    }

    const f = rec.fields;
    const text = loc.item(td.name);
    const slot = slotOf(rec, equip);
    const item = {
      id: `${modId}:${td.name}`,
      mod: modId,
      className: td.name,
      fullName: td.fullName,
      ifaces: asm.interfacesOf(td), // `item.ModItem is IVoidHybrid` is how a global hook picks its items

      name: text.name ?? deCamel(td.name),
      tooltip: text.tooltip ?? '',
      setBonus: text.setBonus ?? '',
      slot,
      equip,
      damageClass: rec.damageClass ?? null,
      damageClassFull: rec.damageClassFull ?? null,
      subclass: voidSub ?? undefined,
      damage: num(f.damage),
      defense: num(f.defense),
      useTime: num(f.useTime),
      useAnimation: num(f.useAnimation),
      reuseDelay: num(f.reuseDelay),
      crit: num(f.crit),
      knockback: num(f.knockBack),
      mana: num(f.mana),
      shoot: f.shoot?.k === 'type' || (isNum(f.shoot) && f.shoot > 0) ? projRef(asm, f.shoot) : undefined,
      shootSpeed: num(f.shootSpeed),
      useAmmo: num(f.useAmmo) > 0 ? f.useAmmo : undefined,
      ammo: num(f.ammo) > 0 ? f.ammo : undefined,
      channel: f.channel === 1 || undefined,
      autoReuse: f.autoReuse === 1 || undefined,
      noMelee: f.noMelee === 1 || undefined,
      useStyle: num(f.useStyle),
      useLimit: num(f.useLimitPerAnimation),
      maxOut: maxOutOf(asm, td),
      armorPen: num(f.ArmorPenetration),
      scale: num(f.scale),
      pick: num(f.pick) > 0 ? f.pick : undefined,
      makeNPC: f.makeNPC?.k === 'type' ? refId(asm, f.makeNPC) : num(f.makeNPC) > 0 ? `v:${f.makeNPC}` : undefined,
      rarity: num(f.rare),
      rarityClass: f.rare?.k === 'type' ? simpleName(f.rare.name) : undefined,
      value: num(f.value),
      accessory: f.accessory === 1,
      vanity: f.vanity === 1,
      expert: f.expert === 1,
      consumable: f.consumable === 1,
      maxStack: num(f.maxStack),
      cloneOf: rec.cloneOf === undefined ? undefined : isNum(rec.cloneOf) ? `v:${rec.cloneOf}` : refId(asm, rec.cloneOf),
      createTile: f.createTile?.k === 'type' ? refId(asm, f.createTile) : isNum(f.createTile) && f.createTile >= 0 ? `v:tile:${f.createTile}` : undefined,
      set: [],
    };

    const isArmor = slot === 'head' || slot === 'body' || slot === 'legs';
    if (isArmor) {
      const ias = findInherited(asm, td, 'IsArmorSet');
      if (ias) item.set = contentRefs(asm, ias).map((full) => refId(asm, full));
    }
    if (equip.includes('Shoes') || f.shoeSlot > 0) item.boots = true;
    if (f.wingSlot > 0 || equip.includes('Wings')) { item.wings = true; item.wingStats = extractWingStats(asm, td, { tml }) ?? undefined; }
    if (slot === 'weapon') {
      try { item.fire = analyzeShoot(asm, td, { tml, projRef: (v) => projRef(asm, v) }) ?? undefined; } catch { /* keep the item */ }
      // what a void weapon spends per use: `VoidItem.GetVoid(player)`, which 78 SOTS weapons override
      // with a constant and the base returns 1 for (a minion's cost is per summon, left unread)
      if (/^Void/.test(rec.damageClass ?? '')) {
        const gv = findInherited(asm, td, 'GetVoid');
        if (gv) {
          try {
            const v = new Machine(asm, { tml, concreteType: td, budget: 4000, onCall: tmlStaticHook, onStaticLoad: tmlStaticLoadHook }).run(gv, THIS, [PLAYER]);
            if (isNum(v) && v > 0) item.voidCost = v;
          } catch { /* unread */ }
        }
      }
    }
    if (isArmor || slot === 'accessory' || slot === 'weapon') Object.assign(item, formatArgsOf(asm, td, { tml }));
    if (effects && (isArmor || slot === 'accessory')) {
      const fx = extractItemEffects(asm, td, { tml });
      if (fx.equip) item.effects = fx.equip;
      if (fx.set) item.setEffects = fx.set;
    }
    out.push(item);
  }
  return out;
}
