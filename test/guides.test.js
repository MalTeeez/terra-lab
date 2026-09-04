import { describe, expect, test } from 'bun:test';
import { parseCalamityRow, parseIeorTab, findItem } from '../tools/guides.mjs';
import { indexDataset } from '../src/lib/dataset.js';

// ---- Calamity: one Cargo row of the ClassSetups table -----------------------------------------
const cal = (item, extra = {}) => parseCalamityRow({ item, class: 'ranged', progression: 'pre-skeletron', type: 'weapon', ...extra });

const CAL_PLAIN = '<div style="float:none"><span class="i">[[File:Demon Bow.png|link=Demon Bow|Demon Bow]]<span><span>[[Demon Bow]]</span></span></span></div>';
// the tooltip nests item markup of its own — the paired ammo must not leak out as an alternative
const CAL_OMEGA = '<div style="float:none"><span class="i">[[File:Aquashard Shotgun.png|link=Aquashard Shotgun|Aquashard Shotgun]]<span><span>[[Aquashard Shotgun]]</span></span></span><span> </span>'
  + '<span class="tooltip">\'\'\'Ω<sup>1</sup>\'\'\'<span class="tooltiptext">This should be used with <span class="i">[[File:Musket Ball.png|link=Musket Ball|Musket Ball]]<span><span>[[Musket Ball|Musket Balls]]</span></span></span>.</span></span></div>';
const CAL_ALT = '<div><span class="i">[[File:A.png|link=A|A]]<span><span>[[Brittle Star Staff]]</span></span></span> / <span class="i">[[File:B.png|link=B|B]]<span><span>[[Wulfrum Controller]]</span></span></span>'
  + '<span class="tooltip"><small>(note)</small><span class="tooltiptext">Use in its defensive form.</span></span></div>';
const CAL_MARKS = '<div>[[Ashen Stalactite]]<span class="tooltip">\'\'\'† C\'\'\'<span class="tooltiptext">This is difficult to use and is best on worms.</span></span></div>';

describe('Calamity cargo rows', () => {
  test('a plain row is one pick per class', () => {
    const [p] = cal(CAL_PLAIN);
    expect(p.name).toBe('Demon Bow');
    expect(p.cls).toBe('ranged');
    expect(p.kind).toBe('weapon');
    expect(p.marks).toEqual([]);
    expect(p.alt).toEqual([]);
  });
  test('an Ω row keeps its own name and reports what to pair it with', () => {
    const [p] = cal(CAL_OMEGA);
    expect(p.name).toBe('Aquashard Shotgun');
    expect(p.marks).toEqual(['Ω']);
    expect(p.with).toBe('Musket Ball');
    expect(p.alt).toEqual([]); // the ammo in the note is not an alternative
  });
  test('`/` alternatives share one record, and a plain note comes through', () => {
    const [p] = cal(CAL_ALT, { type: 'support' });
    expect(p.name).toBe('Brittle Star Staff');
    expect(p.alt).toEqual(['Wulfrum Controller']);
    expect(p.role).toBe('support');
    expect(p.note).toBe('Use in its defensive form.');
  });
  test('several marks in one tooltip', () => {
    const [p] = cal(CAL_MARKS);
    expect(p.marks.sort()).toEqual(['C', '†']);
  });
  test('a class key expands to a class list, and `-stealth` grades the rogue on spam', () => {
    const all = cal(CAL_PLAIN, { class: 'all' });
    expect(all.map((p) => p.cls).sort()).toEqual(['magic', 'melee', 'ranged', 'rogue', 'summon']);
    const noStealth = cal(CAL_PLAIN, { class: 'all-but-summoner-stealth' });
    expect(noStealth.map((p) => p.cls).sort()).toEqual(['magic', 'melee', 'ranged', 'rogue']);
    expect(noStealth.find((p) => p.cls === 'rogue').role).toBe('spam');
  });
  test('the weapon type carries the spam / stealth grade', () => {
    expect(cal(CAL_PLAIN, { class: 'rogue', type: 'weaponStealth' })[0].role).toBe('stealth');
    expect(cal(CAL_PLAIN, { class: 'rogue', type: 'weaponSpam' })[0].role).toBe('spam');
    expect(cal(CAL_PLAIN, { class: 'summon', type: 'minions' })[0].role).toBe('minion');
  });
  test('a tier or a type the lab does not model is dropped', () => {
    expect(cal(CAL_PLAIN, { progression: 'not-a-tier' })).toEqual([]);
    expect(cal(CAL_PLAIN, { type: 'weirdType' })).toEqual([]);
  });
});

// ---- IEoR: one class tab of a guide template --------------------------------------------------
const IEOR_TAB = `
Rogue=
{{ infocard
| name = Rogue
| text =
  {{infocard/box | style = width: 350px | title = [[Weapons]] | color = #50994b |
  {{infocard/box | style = width: 325px | title = Spam | color = #50994b |{{item|Dracula Fang}}<br>{{item|#Forbidden Maelstrom@Thorium Crossmod}} '''v'''<br>{{item|Rot Ball}} / {{item|Tooth Ball}}<br>{{item|Turbulance}} '''*'''}}
  {{infocard/box | style = width: 325px | title = Stealth | color = #50994b|{{item|Dracula Fang}}<br>{{item|Sludge Splotch}}}}
  {{infocard/box | style = width: 325px | title = Support Items | color = Gray |{{item|Aestheticus}} '''+'''}}
  }}
  {{infocard/box | style = width: 350px | title = [[Armor]] | color = #50994b |
  {{infocard/box | style = width: 325px | title = Class-specific | color = #50994b |{{item|Flight armor}}<br>{{item|Sulphurous armor}}}}
  }}
`;

describe('IEoR guide templates', () => {
  const picks = parseIeorTab(IEOR_TAB, 'Pre-Skeletron');
  const w = picks.filter((p) => p.kind === 'weapon');
  test('the tab names the class', () => {
    expect(new Set(picks.map((p) => p.cls))).toEqual(new Set(['rogue']));
  });
  test('the inner box titles set the role', () => {
    expect(w.find((p) => p.name === 'Turbulance').role).toBe('spam');
    expect(w.find((p) => p.name === 'Sludge Splotch').role).toBe('stealth');
    expect(w.find((p) => p.name === 'Aestheticus').role).toBe('support');
  });
  test('`/` alternatives share one record', () => {
    const rot = w.find((p) => p.name === 'Rot Ball');
    expect(rot.alt).toEqual(['Tooth Ball']);
    expect(w.some((p) => p.name === 'Tooth Ball')).toBe(false);
  });
  test('marks and the `#Name@Mod` form', () => {
    const fm = w.find((p) => p.name === 'Forbidden Maelstrom');
    expect(fm.mod).toBe('Thorium Crossmod');
    expect(fm.marks).toEqual(['ν']); // IEoR types the void mark as a plain `v`
    expect(w.find((p) => p.name === 'Turbulance').marks).toEqual(['*']);
    expect(w.find((p) => p.name === 'Aestheticus').marks).toEqual(['+']);
  });
  test('armor boxes come through as armor, without the " armor" suffix', () => {
    const a = picks.filter((p) => p.kind === 'armor');
    expect(a.map((p) => p.name)).toEqual(['Flight', 'Sulphurous']);
    expect(a[0].armor).toBe(true);
  });
});

// ---- resolving a pick against the dataset ------------------------------------------------------
describe('findItem', () => {
  const ds = indexDataset({
    mods: [{ id: 'v', name: 'Terraria', equipment: 1 }],
    stages: [{ index: 0, key: 'start', label: 'Pre-boss', progression: 0 }],
    items: [
      { id: 'v:1', mod: 'v', name: 'Demon Bow', slot: 'weapon', class: 'ranged', stage: 0, stageSource: { kind: 'rarity' } },
      { id: 'v:2', mod: 'v', name: 'Demon Bow', slot: 'accessory', stage: 0, stageSource: { kind: 'rarity' } },
      { id: 'v:3', mod: 'v', name: 'Gold Helmet', slot: 'head', set: ['v:4'], stage: 0, stageSource: { kind: 'rarity' } },
      { id: 'v:4', mod: 'v', name: 'Gold Chainmail', slot: 'body', stage: 0, stageSource: { kind: 'rarity' } },
      { id: 'v:5', mod: 'v', name: 'Wizard Hat', slot: 'head', stage: 0, stageSource: { kind: 'rarity' } },
    ],
    ammo: [{ id: 'v:97', name: 'Musket Ball', kind: 97, damage: 7, stage: 0 }],
  });
  test('a weapon pick prefers the weapon of that name', () => {
    expect(findItem(ds, { name: 'Demon Bow', kind: 'weapon' }).id).toBe('v:1');
    expect(findItem(ds, { name: 'Demon Bow', kind: 'accessory' }).id).toBe('v:2');
  });
  test('an armor pick resolves to the set head', () => {
    expect(findItem(ds, { name: 'Gold', kind: 'armor', armor: true }).id).toBe('v:3');
    expect(findItem(ds, { name: 'Wizard Hat', kind: 'armor', armor: true }).id).toBe('v:5');
  });
  test('an ammo pick falls back to the ammo table', () => {
    expect(findItem(ds, { name: 'Musket Ball', kind: 'ammo' }).id).toBe('v:97');
  });
  test('a name the dataset does not have is null, not a wrong guess', () => {
    expect(findItem(ds, { name: 'Nonexistent Blade', kind: 'weapon' })).toBe(null);
  });
});
