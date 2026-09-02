/**
 * Reader + extractor checks against the real game files. They skip when tModLoader or
 * the mods are not installed, so `bun test` stays green on a machine without the game.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { loadAssembly } from '../miner/clr/metadata.js';
import { extractItems } from '../miner/extract/items.js';
import { loadLocalization } from '../miner/extract/localization.js';
import { extractVanilla } from '../miner/extract/vanilla.js';
import { defaultPaths, resolveMods } from '../miner/resolve.js';
import { readTmodFile } from '../miner/tmod.js';

const paths = defaultPaths();
const hasGame = existsSync(paths.tmlDll);
const calamity = resolveMods(['CalamityMod'], paths).resolved[0];
const it = (cond) => (cond ? test : test.skip);

describe('tModLoader.dll', () => {
  const tml = hasGame ? loadAssembly(readFileSync(paths.tmlDll)) : null;

  it(hasGame)('parses metadata and finds core types', () => {
    expect(tml.types.length).toBeGreaterThan(3000);
    expect(tml.typeByName.get('Terraria.Item')).toBeDefined();
    expect(tml.typeByName.get('Terraria.ModLoader.ModItem')).toBeDefined();
    const item = tml.typeByName.get('Terraria.Item');
    expect(item.methods.some((m) => m.name === 'SetDefaults1' && tml.methodBody(m))).toBe(true);
    expect(tml.constants(tml.typeByName.get('Terraria.ID.ItemID')).get('Zenith')).toBe(4956);
  });

  it(hasGame)('extracts vanilla items, sets, effects and drops with known values', () => {
    const v = extractVanilla(tml);
    const byName = new Map(v.items.map((i) => [i.name, i]));
    expect(byName.get('Zenith')).toMatchObject({ damage: 190, damageClass: 'Melee', rarity: 10 });
    expect(byName.get('Katana')).toMatchObject({ damage: 18 });
    expect(byName.get('Solar Flare Helmet')).toMatchObject({ defense: 24, set: ['v:2764', 'v:2765'] });
    expect(byName.get('Solar Flare Helmet').setEffects.endurance).toBeCloseTo(0.12);
    expect(byName.get('Avenger Emblem').effects.damage.all).toBeCloseTo(0.12);
    expect(byName.get('Pumpkin Helmet').setEffects.damage.all).toBeCloseTo(0.1);
    expect(byName.get('Papyrus Scarab').effects).toMatchObject({ minionSlots: 1 });
    const plantera = v.drops.filter((d) => d.source === 'npc:v:262').map((d) => d.item);
    expect(plantera).toContain('v:758'); // Grenade Launcher
    expect(v.recipes.some((r) => r.result === 'v:4956' && r.ingredients.length === 10)).toBe(true); // Zenith
  });
});

describe('CalamityMod.tmod', () => {
  it(hasGame && !!calamity)('extracts items with stats, classes, sets and effects', () => {
    const tml = loadAssembly(readFileSync(paths.tmlDll));
    const tmod = readTmodFile(calamity.path);
    const asm = loadAssembly(tmod.entries.get('CalamityMod.dll').read());
    const loc = loadLocalization(tmod);
    const items = extractItems(asm, { tml, loc, modId: 'CalamityMod' });
    const byClass = new Map(items.map((i) => [i.className, i]));
    expect(items.length).toBeGreaterThan(2000);
    expect(byClass.get('Murasama')).toMatchObject({ slot: 'weapon', damage: 2200, damageClass: 'TrueMeleeNoSpeedDamageClass' });
    const auric = byClass.get('AuricTeslaHeadMelee');
    expect(auric).toMatchObject({ slot: 'head', defense: 54, set: ['CalamityMod:AuricTeslaBodyArmor', 'CalamityMod:AuricTeslaCuisses'] });
    expect(auric.effects.damage.melee).toBeCloseTo(0.12);
    expect(byClass.get('AsgardsValor')).toMatchObject({ slot: 'accessory', defense: 4 });
    expect(byClass.get('AsgardsValor').effects.flags).toContain('noKnockback');
  });
});
