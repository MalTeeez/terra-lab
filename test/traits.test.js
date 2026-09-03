import { describe, expect, test } from 'bun:test';
import { matches, traitCounts, traitOfLabel, traitsOf } from '../src/lib/traits.js';

describe('traits', () => {
  test('labels lose their numbers and markers', () => {
    expect(traitOfLabel('+27% rogue damage ½')).toBe('rogue damage');
    expect(traitOfLabel('-200 aggro')).toBe('aggro');
    expect(traitOfLabel('flight: 180 ticks, speed 9')).toBe('flight');
    expect(traitOfLabel('Jewel Spike per stealth strike')).toBe('on-hit spawn');
    expect(traitOfLabel('+8% stealth strike damage')).toBe('stealth strike bonus');
    expect(traitOfLabel('knockback immunity')).toBe('knockback immunity');
  });
  test('entries carry traits from their parts, groups and flags; weapons from their DPS factors', () => {
    const acc = { item: { name: 'Charm', slot: 'accessory', effects: { flags: ['dash'] }, condStats: ['defense'] }, parts: [{ label: '+4% crit chance', value: 3 }, { label: '+3 defense ½', value: 1 }], group: 'dash', stealth: true };
    expect(traitsOf(acc)).toEqual(['conditional', 'crit chance', 'dash', 'defense', 'stealth']);
    const w = { item: { name: 'Bow', slot: 'weapon', cls: 'ranged', useAmmo: 1 }, parts: [{ label: '10 damage', value: 10 }, { label: '3 projectiles per use', mul: 3 }, { label: 'infinite pierce (worm)', mul: 1.5 }], mode: null };
    expect(traitsOf(w)).toEqual(['multi-shot', 'pierce', 'ranged', 'uses ammo']);
    const set = { isSet: true, head: { item: { name: 'Hat' }, parts: [{ label: '+5% melee damage', value: 5 }] }, body: { item: { name: 'Plate' }, parts: [] }, legs: { item: { name: 'Greaves' }, parts: [] }, bonus: { parts: [{ label: '+10% melee damage', value: 10 }] } };
    expect(traitsOf(set)).toEqual(['full set', 'melee damage', 'set bonus']);
    expect(traitCounts([acc, acc, w])[0]).toEqual(['conditional', 2]);
  });
  test('matching: every word, exclusions, and every selected trait', () => {
    const acc = { item: { name: 'Sand Cloak', tooltip: 'Dashing creates a veil', slot: 'accessory' }, parts: [{ label: 'dash', value: 2 }, { label: '+3 defense ½', value: 1 }] };
    expect(matches(acc, 'veil', [])).toBe(true);
    expect(matches(acc, 'veil cloak', [])).toBe(true);
    expect(matches(acc, 'veil -cloak', [])).toBe(false);
    expect(matches(acc, '', ['dash', 'defense'])).toBe(true);
    expect(matches(acc, '', ['dash', 'crit chance'])).toBe(false);
  });
});
