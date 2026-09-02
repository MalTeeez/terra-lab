/**
 * ModItem discovery and `SetDefaults` evaluation.
 */
import { deCamel } from './localization.js';
import { ITEM, Machine, THIS, UNKNOWN, isNum, simpleName, tmlStaticHook, tmlStaticLoadHook } from './interp.js';
import { TYPE_ABSTRACT, contentRefs, derivesFromTml, findInherited, refId } from './util.js';
import { extractItemEffects } from './effects.js';
import { analyzeShoot } from './shoot.js';
import { projRef } from './projectiles.js';

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
    onStore(recv, name, value) {
      if (recv !== ITEM) return;
      if (name === 'DamageType') {
        if (value?.k === 'dc') { rec.damageClass = value.name; rec.damageClassFull = value.full; }
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
      name: text.name ?? deCamel(td.name),
      tooltip: text.tooltip ?? '',
      setBonus: text.setBonus ?? '',
      slot,
      equip,
      damageClass: rec.damageClass ?? null,
      damageClassFull: rec.damageClassFull ?? null,
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
    if (f.wingSlot > 0 || equip.includes('Wings')) item.wings = true;
    if (slot === 'weapon') {
      try { item.fire = analyzeShoot(asm, td, { tml, projRef: (v) => projRef(asm, v) }) ?? undefined; } catch { /* keep the item */ }
    }
    if (effects && (isArmor || slot === 'accessory')) {
      const fx = extractItemEffects(asm, td, { tml });
      if (fx.equip) item.effects = fx.equip;
      if (fx.set) item.setEffects = fx.set;
    }
    out.push(item);
  }
  return out;
}
