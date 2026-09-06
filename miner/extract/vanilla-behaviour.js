/**
 * What vanilla projectiles do that the case tracker cannot see.
 *
 * A mod's projectile carries its own `AI`, `OnHitNPC` and `OnKill`, and the interpreter walks them.
 * A vanilla projectile's behaviour lives in `Projectile.AI` switched on `aiStyle` — thousands of
 * lines the tracker does not walk — so of 386 vanilla projectiles the miner read children and
 * debuffs for none. Molotov Cocktail was a bare 23-damage lob with no fire. This table is the game's
 * own facts about those projectiles, keyed by the *name* of the `ProjectileID` constant and resolved
 * against the installed assembly at mine time, so a Terraria update that renumbers or removes one
 * fails the mine instead of scoring the wrong projectile. Game data, not an item override: it says
 * what a projectile does, and applies to every weapon that fires it.
 *
 * The rule for merging is the same as for `ProjectileID.Sets`: a fact the machine read wins, the
 * table fills what it did not. Counts and shares are the pessimistic reading where the code rolls.
 *
 *   children   [{ type, count, where: 'hit' | 'kill' | 'ai', dmgMul }]  — as a mined child
 *   debuffs    BuffID names
 *   local      ticks between hits on one NPC (the projectile's own immunity)
 *   explode    blast width in px; `still` parks it where it lands; `returns` is a boomerang
 *
 * `ammoSwap` is the other vanilla fact of the same kind: `Player.ItemCheck_Shoot` turns the plain
 * ammo into a bow's own projectile (The Bee's Knees fires Bee Arrows from Wooden Arrows), which is
 * neither on the item nor on the ammo, and the model grades a bow with its plain ammo.
 */
import { constMap } from './vanilla.js';

export const VANILLA_BEHAVIOUR = {
  game: '1.4.4.9',
  source: 'Terraria.Projectile.AI / Player.ItemCheck_Shoot (1.4.4.9), cross-checked against terraria.wiki.gg',
  projectiles: {
    // ---- arrows and bullets: the debuff or the split each carries
    FlamingArrow: { debuffs: ['OnFire'] },
    FrostburnArrow: { debuffs: ['Frostburn'] },
    HellfireArrow: { explode: 96, local: -1 },
    JestersArrow: { pen: -1, walls: true },
    CursedArrow: { debuffs: ['CursedInferno'] },
    IchorArrow: { debuffs: ['Ichor'] },
    VenomArrow: { debuffs: ['Venom'] },
    BeeArrow: { children: [{ type: 'Bee', count: 2, where: 'kill', dmgMul: 1 }] },
    Hellwing: { debuffs: ['OnFire'], pen: 3 },
    MeteorShot: { pen: 2 },
    CrystalBullet: { children: [{ type: 'CrystalShard', count: 2, where: 'kill', dmgMul: 0.5 }] },
    CursedBullet: { debuffs: ['CursedInferno'] },
    IchorBullet: { debuffs: ['Ichor'] },
    VenomBullet: { debuffs: ['Venom'] },
    ExplosiveBullet: { explode: 80, local: -1 },
    NanoBullet: { debuffs: ['Confused'] },
    // ---- thrown
    Beenade: { children: [{ type: 'Bee', count: 5, where: 'kill', dmgMul: 1 }] },
    Bee: { pen: 3, homing: { range: 300 } },
    MolotovCocktail: { children: [{ type: 'MolotovFire', count: 3, where: 'kill', dmgMul: 0.5 }], debuffs: ['OnFire'] },
    MolotovFire: { still: true, pen: -1, local: 30, life: 240, debuffs: ['OnFire'] },
    MolotovFire2: { still: true, pen: -1, local: 30, life: 240, debuffs: ['OnFire'] },
    MolotovFire3: { still: true, pen: -1, local: 30, life: 240, debuffs: ['OnFire'] },
    Grenade: { explode: 128, local: -1 },
    StickyGrenade: { explode: 128, local: -1 },
    BouncyGrenade: { explode: 128, local: -1 },
    PoisonedKnife: { debuffs: ['Poisoned'] },
    FrostDaggerfish: { debuffs: ['Frostburn'] },
    // ---- boomerangs, flails, yoyos
    EnchantedBoomerang: { returns: true },
    Flamarang: { returns: true, debuffs: ['OnFire'] },
    ThornChakram: { returns: true, debuffs: ['Poisoned'] },
    IceBoomerang: { returns: true, debuffs: ['Frostburn'] },
    Bananarang: { returns: true },
    LightDisc: { returns: true },
    Sunfury: { debuffs: ['OnFire'] },
    FlamingMace: { debuffs: ['OnFire'] },
    TheDaoofPow: { debuffs: ['Confused'] },
    Cascade: { debuffs: ['OnFire'] },
    Amarok: { debuffs: ['Frostburn'] },
    HiveFive: { children: [{ type: 'Bee', count: 1, where: 'hit', dmgMul: 1, chance: 0.33 }] },
    // ---- magic
    Flamelash: { debuffs: ['OnFire'] },
    BallofFire: { debuffs: ['OnFire'] },
    FrostBlastFriendly: { debuffs: ['Frostburn'] },
    FrostBoltSword: { debuffs: ['Frostburn'] },
    Flames: { debuffs: ['OnFire'] },
    GoldenShowerFriendly: { debuffs: ['Ichor'] },
    CursedFlameFriendly: { debuffs: ['CursedInferno'] },
    BloodCloudMoving: { children: [{ type: 'BloodCloudRaining', count: 1, where: 'ai', dmgMul: 1 }] },
    BloodCloudRaining: { still: true, life: 600, children: [{ type: 'BloodRain', count: 1, where: 'ai', dmgMul: 1 }] },
    RainCloudMoving: { children: [{ type: 'RainCloudRaining', count: 1, where: 'ai', dmgMul: 1 }] },
    RainCloudRaining: { still: true, life: 600, children: [{ type: 'RainFriendly', count: 1, where: 'ai', dmgMul: 1 }] },
    // ---- summons: what a minion or sentry fires, and what its shot carries
    Hornet: { children: [{ type: 'HornetStinger', count: 1, where: 'ai', dmgMul: 1 }] },
    HornetStinger: { debuffs: ['Poisoned'] },
    FlyingImp: { children: [{ type: 'ImpFireball', count: 1, where: 'ai', dmgMul: 1 }] },
    ImpFireball: { debuffs: ['OnFire'] },
    HoundiusShootius: { children: [{ type: 'HoundiusShootiusFireball', count: 1, where: 'ai', dmgMul: 1 }] },
    DD2BallistraTowerT1: { children: [{ type: 'DD2BallistraProj', count: 1, where: 'ai', dmgMul: 1 }] },
    DD2ExplosiveTrapT1: { children: [{ type: 'DD2ExplosiveTrapT1Explosion', count: 1, where: 'ai', dmgMul: 1 }] },
    ThornWhip: { debuffs: ['Poisoned'] },
    CoolWhip: { debuffs: ['Frostburn'] },
    FireWhip: { debuffs: ['OnFire'] },
  },
  ammoSwap: {
    BeesKnees: { from: 'WoodenArrowFriendly', to: 'BeeArrow' },
    MoltenFury: { from: 'WoodenArrowFriendly', to: 'FlamingArrow' },
    BloodRainBow: { from: 'WoodenArrowFriendly', to: 'BloodArrow' },
    HellwingBow: { from: 'WoodenArrowFriendly', to: 'Hellwing' },
    PulseBow: { from: 'WoodenArrowFriendly', to: 'PulseBolt' },
    VenusMagnum: { from: 'Bullet', to: 'BulletHighVelocity' },
  },
};

/** A name from the table resolved against an ID class, or an error naming the row. */
function resolver(tml, typeName, what) {
  const ids = constMap(tml, typeName);
  return (name, row) => {
    const id = ids.get(name);
    if (id === undefined) throw new Error(`vanilla behaviour table: ${what} "${name}" (row ${row}) is not in ${typeName} of the installed game — the table is for ${VANILLA_BEHAVIOUR.game}`);
    return id;
  };
}

/**
 * Merge the table into the mined vanilla projectile records (in place; new records for projectiles
 * the tracker never reached). A mined fact wins; the table fills what is missing.
 * @returns {number} rows applied
 */
export function applyVanillaBehaviour(tml, records) {
  const projId = resolver(tml, 'Terraria.ID.ProjectileID', 'projectile');
  const buffId = resolver(tml, 'Terraria.ID.BuffID', 'buff');
  const byId = new Map(records.map((r) => [r.id, r]));
  let n = 0;
  for (const [name, row] of Object.entries(VANILLA_BEHAVIOUR.projectiles)) {
    const id = `v:${projId(name, name)}`;
    let rec = byId.get(id);
    if (!rec) { rec = { id }; byId.set(id, rec); records.push(rec); }
    for (const [k, v] of Object.entries(row)) {
      if (k === 'children') { if (!rec.children?.length) rec.children = v.map((c) => ({ ...c, type: `v:${projId(c.type, name)}` })); continue; }
      if (k === 'debuffs') { if (!rec.debuffs?.length) rec.debuffs = v.map((b) => `v:${buffId(b, name)}`); continue; }
      if (rec[k] === undefined) rec[k] = v;
    }
    rec.tabled = true;
    n++;
  }
  return n;
}

/** Attach `ammoSwap: { from, to }` (projectile ids) to the vanilla items the table names. */
export function applyAmmoSwaps(tml, items) {
  const itemId = resolver(tml, 'Terraria.ID.ItemID', 'item');
  const projId = resolver(tml, 'Terraria.ID.ProjectileID', 'projectile');
  const byId = new Map(items.map((i) => [i.id, i]));
  let n = 0;
  for (const [name, swap] of Object.entries(VANILLA_BEHAVIOUR.ammoSwap)) {
    const it = byId.get(`v:${itemId(name, name)}`);
    if (!it) continue;
    it.ammoSwap = { from: `v:${projId(swap.from, name)}`, to: `v:${projId(swap.to, name)}` };
    n++;
  }
  return n;
}
