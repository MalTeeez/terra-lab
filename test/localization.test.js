import { describe, expect, test } from 'bun:test';
import { loadLocalization } from '../miner/extract/localization.js';

/** A .tmod as `loadLocalization` reads it: one en-US hjson file per entry. */
const fakeTmod = (files) => ({
  entries: new Map(Object.entries(files).map(([path, text]) => [path, { read: () => Buffer.from(text, 'utf8') }])),
});

describe('loadLocalization', () => {
  // Calamity writes its set bonus references relative to where they sit — `{$GodSlayerHeadMelee
  // .SetBonusEffect}` from inside `Mods.CalamityMod.Items.Armor.PostMoonLord.*` — and an exact-key
  // lookup answered nothing, so every post-Moon-Lord set bonus read "Set Bonus Effect".
  test('resolves a key written relative to where it was referenced from', () => {
    const loc = loadLocalization(fakeTmod({
      'Localization/en-US_Mods.M.hjson': `{
        Items: { Armor: { Post: {
          GodSlayerHeadMelee: { DisplayName: "Greathelm", SetBonus: "{$GodSlayerHeadMelee.SetBonusEffect}", SetBonusEffect: "Releases god killer darts" }
        } } }
      }`,
    }));
    expect(loc.get('GodSlayerHeadMelee.SetBonusEffect')).toBeUndefined(); // the exact key is longer than that
    expect(loc.find('GodSlayerHeadMelee.SetBonusEffect')).toBe('Releases god killer darts');
    expect(loc.find('Post.GodSlayerHeadMelee.SetBonusEffect')).toBe('Releases god killer darts');
    expect(loc.find('SetBonusEffect')).toBeUndefined(); // one segment is not a reference
  });

  // Auric Tesla's set bonus is three inherited ones the game only shows a key press at a time.
  test('returns the arms of a set bonus the game hides behind a key press', () => {
    const loc = loadLocalization(fakeTmod({
      'Localization/en-US_Mods.M.hjson': `{
        Items: { AuricTeslaHeadMelee: {
          DisplayName: "Royal Helm",
          SetBonus: "Melee Tarragon, Bloodflare and God Slayer effects\\nHold Shift to view these set bonus details",
          SetBonus1: "Inherited Tarragon Set Bonus:",
          SetBonus2: "Inherited Bloodflare Set Bonus:"
        } }
      }`,
    }));
    const it = loc.item('AuricTeslaHeadMelee');
    expect(it.setBonus).toBe('Melee Tarragon, Bloodflare and God Slayer effects'); // the instruction is spent
    expect(it.setBonusMore).toBe('Inherited Tarragon Set Bonus:\nInherited Bloodflare Set Bonus:');
    expect(it.tooltipMore).toBeUndefined();
    // an item without them is untouched
    expect(loc.item('Nothing')).toEqual({});
  });

  // …and the same for a plain item's own description, which is where every other mod hides text
  // behind a key press (SOTS's Dream Lamp keeps a form per `Tooltip<N>`).
  test('returns the arms of an item description hidden behind a key press', () => {
    const loc = loadLocalization(fakeTmod({
      'Localization/en-US_Mods.M.hjson': `{
        Items: { DreamLamp: {
          DisplayName: "Dreaming Lamp",
          Tooltip: "'What do you wish for?'\\nPress Shift to read on",
          Tooltip1: "Chain together up to 10 enemies",
          Tooltip2: "Right click to launch a mist orb"
        } }
      }`,
    }));
    const it = loc.item('DreamLamp');
    expect(it.tooltip).toBe("'What do you wish for?'");
    expect(it.tooltipMore).toBe('Chain together up to 10 enemies\nRight click to launch a mist orb');
  });
});
