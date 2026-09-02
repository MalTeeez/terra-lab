/**
 * Parity pins against the generated dataset (this pack's mods). Skips when the dataset
 * has not been mined. Values here were cross-checked against the mods' own code; when
 * a mod update changes them, the pin should be updated deliberately, not silently.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';

const path = new URL('../data/dataset.json', import.meta.url);
const has = existsSync(path);
const it = (cond) => (cond ? test : test.skip);
const ds = has ? JSON.parse(readFileSync(path, 'utf8')) : null;
const byName = (n) => ds.items.find((i) => i.name === n);

describe('dataset.json', () => {
  it(has)('has the expected shape', () => {
    expect(ds.items.length).toBeGreaterThan(4000);
    expect(ds.stages[0].label).toBe('Pre-boss');
    expect(ds.stages.length).toBeGreaterThan(20);
    expect(ds.prefixes.length).toBeGreaterThan(70);
    expect(ds.loadOrder.at(-1)).toMatch(/InfernalEclipseAPI|WHummusMultiModBalancing/);
  });

  it(has && !!ds?.items.some((i) => i.id === 'CalamityMod:Murasama'))('Calamity values survive the balancing overlays untouched', () => {
    const m = byName('Murasama');
    expect(m.damage).toBe(2200);
    expect(m.changes).toBeUndefined();
    expect(m.class).toBe('melee');
    const auric = byName('Auric Tesla Royal Helm');
    expect(auric.defense).toBe(54);
    expect(auric.effects.damage.melee).toBeCloseTo(0.12);
    expect(ds.stages[auric.stage].label).toMatch(/Yharon/);
  });

  it(has && !!ds?.items.some((i) => i.id === 'ThoriumMod:TitanSword'))('pack balancing is applied in load order', () => {
    const ts = byName('Titan Sword');
    expect(ts.base.damage).toBe(52);
    expect(ts.changes.map((c) => c.mod)).toEqual(['CalamityBardHealer', 'ThoriumRework', 'ThoriumRework', 'ThoriumRework', 'ThoriumRework']);
    expect(ts.damage).toBe(107);
    expect(ts.crit).toBe(16);
  });

  it(has)('vanilla items and Calamity\'s vanilla rebalance', () => {
    expect(byName('Zenith').damage).toBe(190);
    expect(byName('Katana').damage).toBe(18);
    expect(byName('Terra Blade').damage).toBe(85);
    const sfh = byName('Solar Flare Helmet');
    expect(sfh.defense).toBe(24);
    expect(sfh.effects.crit.melee).toBe(20); // 26 in vanilla, -6 from CalamityGlobalItem.UpdateEquip
    expect(sfh.setEffects.endurance).toBeCloseTo(0.12);
    expect(byName('Avenger Emblem').effects.damage.all).toBeCloseTo(0.12);
    expect(ds.stages[byName('Terra Blade').stage].label).toBe('Plantera');
    expect(ds.stages[byName('Keybrand').stage].label).toBe('Plantera');
  });

  it(has && !!ds?.items.some((i) => i.id === 'CalamityMod:DesertProwlerHat'))('vanilla crafting-station tiles do not collide with item ids', () => {
    // Loom is tile 86; item 86 is Shadow Scale - the set used to land at Eater of Worlds
    expect(ds.stages[byName('Desert Prowler Hat').stage].label).toBe('Pre-boss');
  });

  it(has)('weapons carry projectile behaviour and ammo', () => {
    const mini = byName('Minishark');
    expect(mini.useAmmo).toBe(97);
    expect(ds.ammoKinds['97']).toBe('Bullet');
    expect(ds.ammo.some((a) => a.name === 'Musket Ball' && a.kind === 97 && a.damage === 7)).toBe(true);
    expect(ds.projectiles['v:14']).toMatchObject({ pen: 1, updates: 1 }); // Bullet
    expect(ds.projectiles['v:1']).toMatchObject({ gravity: true }); // Wooden Arrow
    if (ds.items.some((i) => i.id === 'CalamityMod:WulfrumKnife')) {
      const wk = byName('Wulfrum Knife');
      expect(wk.fire.stealth).toBe(true);
      expect(wk.fire.stealthMods.dmgMul).toBeCloseTo(1.5);
      expect(ds.projectiles['CalamityMod:ContaminatedBileFlask']).toMatchObject({ gravity: true, stealth: true });
      expect(ds.projectiles['CalamityMod:ContaminatedBileFlask'].children[0]).toMatchObject({ type: 'CalamityMod:BileExplosion', where: 'kill' });
    }
  });

  it(has)('prefixes include mined mod prefixes', () => {
    const names = new Set(ds.prefixes.map((p) => p.name));
    expect(names.has('Legendary')).toBe(true);
    expect(names.has('Menacing')).toBe(true);
    if (ds.mods.some((m) => m.id === 'CalamityMod')) {
      const sharp = ds.prefixes.find((p) => p.mod === 'CalamityMod' && p.name === 'Sharp');
      expect(sharp.dmg).toBeCloseTo(0.15);
      expect(sharp.rollsFor).toContain('thrower');
    }
  });
});
