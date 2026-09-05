import { describe, expect, test } from 'bun:test';
import { armorMatches, parseCalamityRow, parseIeorTab, parseSotsGuide, parseVanillaGuide, dropCopiedSections, findItem } from '../tools/guides.mjs';
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
  test("the Healer tab's `[[Items]]` box is a weapon box", () => {
    const healer = parseIeorTab('\nHealer=\n  {{infocard/box | style = width: 350px | title = [[Items]] | color = #d1ad63 |\n  {{infocard/box | style = width: 325px | title = Weapons | color = #d1ad63 |{{item|Radiant Cane}}}}\n  }}\n', 'Pre-Skeletron');
    expect(healer.map((p) => [p.cls, p.kind, p.name])).toEqual([['healer', 'weapon', 'Radiant Cane']]);
  });
  test('armor boxes come through as armor, without the " armor" suffix', () => {
    const a = picks.filter((p) => p.kind === 'armor');
    expect(a.map((p) => p.name)).toEqual(['Flight', 'Sulphurous']);
    expect(a[0].armor).toBe(true);
  });
});

// ---- SOTS: the class-progression catalogue ----------------------------------------------------
const SOTS_PAGE = `
=== Pre-Boss [[File:Glowmoth Map Icon ({{modname|get}}).png|link={{modname|get}}/Glowmoth]] ===
{| class="terraria"
! Class !! width=400|{{+|Weapons}} !!width=400|{{+|Armor}} !!width=400|{{+|Accessories}}!!width=400|{{+|Buffs}}/{{+|Potions}}/{{+|Ammo}}
|- class="bottomline"
| Melee
|
{{item|#Miner's Sword}} '''*'''<br/>{{item|#Riptide}}<br/>'''Void weapons:'''<br/>{{item|#Crab Claw}} '''!'''<br/>{{item|#Gold Glaive}} / {{item|#Platinum Scythe}}
|
{{na}}
|
{{item|#Crushing Amplifier}}
|
''{{item|#Vibrant Arrow}}''
|-class="bottomline"
| All Classes
|
{{na}}
|
{{item|#Vespera armor}}
|
{{item|#Clover Charm}}
|
{{item|#Vibrant Potion}}
|}

=== Not A Tier ===
{| class="terraria"
|- class="bottomline"
| Melee
|
{{item|#Never Listed}}
|}
`;

describe('SOTS class progression', () => {
  const picks = parseSotsGuide(SOTS_PAGE);
  const at = (name) => picks.find((p) => p.name === name);
  test('a tier the lab has no boss key for is dropped', () => {
    expect(picks.some((p) => p.name === 'Never Listed')).toBe(false);
  });
  test('the whole catalogue comes through, not only the Void weapons', () => {
    expect(at("Miner's Sword")).toMatchObject({ cls: 'melee', kind: 'weapon', mod: 'SOTS' });
    expect(at('Crushing Amplifier').kind).toBe('accessory');
    expect(at('Vibrant Arrow').kind).toBe('ammo');
    expect(at('Vibrant Potion').kind).toBe('buff'); // the last column mixes buffs, potions and ammo
  });
  test('a Void weapon keeps the row class as its subtype', () => {
    expect(at('Crab Claw')).toMatchObject({ cls: 'void', subclass: 'melee' });
    expect(at('Riptide').cls).toBe('melee');
    expect(at('Riptide').subclass).toBeUndefined();
  });
  test('marks are read from bold runs only', () => {
    expect(at("Miner's Sword").marks).toEqual(['*']);
    expect(at('Crab Claw').marks).toEqual(['!']);
    expect(at('Riptide').marks).toEqual([]); // no `C` picked out of a neighbouring name
  });
  test('`/` alternatives share one record', () => {
    expect(at('Gold Glaive').alt).toEqual(['Platinum Scythe']);
    expect(at('Platinum Scythe')).toBeUndefined();
  });
  test('an All Classes row is one pick per class, and italics mean Expert Mode', () => {
    expect(picks.filter((p) => p.name === 'Clover Charm').map((p) => p.cls).sort()).toEqual(['magic', 'melee', 'ranged', 'summon']);
    expect(at('Vespera').armor).toBe(true);
    expect(at('Vibrant Arrow').note).toBe('Expert Mode or higher');
  });
});

// ---- Terraria: the official class-setups guide ------------------------------------------------
const VANILLA_PAGE = `
{{footnote|Only worth it if it drops immediately.|name=starnote}}
{{infocard/start|type=Pre-Skeletron|name=Ranged|theme=ranged}}
{{infocard/box/start|title=Single-Target Weapons}}
{{infocard/box/start|title=Best}}
{{item|Star Cannon|bignote={{footnote|name=starnote}}}}
{{infocard/box/end}}
{{item|Molten Fury}}
{{infocard/box/end}}
{{infocard/box/start|title=Crowd-Control Weapons}}
{{item|Beenade|s}}
{{infocard/box/end}}
{{infocard/box/start|title=[[Guide:Armor progression#Late pre-Hardmode|Armor]]}}
{{item|Fossil armor}}
{{infocard/box/end}}
{{infocard/box/start|title=Accessories}}
{{item|Snapping Stone|note=(or [[Pyroclastic Stone]])}}
{{infocard/box/end}}
{{infocard/box/start|title=Mounts}}
{{item|Slime Mount}}
{{infocard/box/end}}
{{infocard/start|type=Pre-Skeletron|name=Summoning|theme=summon}}
{{infocard/box/start|title=Whips}}
{{item|Snapthorn}}
{{infocard/box/end}}
{{infocard/start|type=Not A Tier|name=Ranged}}
{{infocard/box/start|title=Single-Target Weapons}}
{{item|Never Listed}}
{{infocard/box/end}}
`;

describe('Terraria class setups', () => {
  const picks = parseVanillaGuide(VANILLA_PAGE);
  const at = (name) => picks.find((p) => p.name === name);
  test('a tier the lab has no boss key for is dropped', () => {
    expect(at('Never Listed')).toBeUndefined();
  });
  test('`Best` applies inside its own box, not to everything after it', () => {
    expect(at('Star Cannon').priority).toBe('best');
    expect(at('Molten Fury').priority).toBe(null);
  });
  test('the target section is the enclosing box, not the last one opened', () => {
    expect(at('Star Cannon').target).toBe('single');
    expect(at('Molten Fury').target).toBe('single');
    expect(at('Beenade').target).toBe('multi');
    expect(at('Fossil').target).toBe(null); // armor is listed after the crowd-control box closed
  });
  test('kinds, roles and the class of the card', () => {
    expect(at('Fossil')).toMatchObject({ kind: 'armor', armor: true, cls: 'ranged' });
    expect(at('Snapping Stone').kind).toBe('accessory');
    expect(at('Snapthorn')).toMatchObject({ cls: 'summon', role: 'whip' });
    expect(at('Slime Mount')).toBeUndefined(); // mounts are not a modelled kind
  });
  test('notes come through, a named footnote is resolved, and `(or X)` is an alternative', () => {
    expect(at('Star Cannon').note).toBe('Only worth it if it drops immediately.');
    expect(at('Snapping Stone').alt).toEqual(['Pyroclastic Stone']);
  });
});

// ---- sections a guide copied forward and never revised ----------------------------------------
describe('dropCopiedSections', () => {
  const section = (tier, stage, names, kind = 'weapon', cls = 'magic') => names.map((name) => ({ guide: 'g', tier, stage, cls, kind, name }));
  const tiers = (...s) => dropCopiedSections(s.flat());

  test('a tier whose weapon list repeats the one before it is dropped', () => {
    const { picks, dropped } = tiers(
      section('t1', 0, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']),
      section('t2', 1, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']),
    );
    expect(dropped.map((d) => d.tier)).toEqual(['t2']);
    expect(new Set(picks.map((p) => p.tier))).toEqual(new Set(['t1']));
  });
  test('a tier that really changed is kept', () => {
    const { dropped } = tiers(
      section('t1', 0, ['A', 'B', 'C', 'D']),
      section('t2', 1, ['E', 'F', 'G', 'H']),
    );
    expect(dropped).toEqual([]);
  });
  test('drift is measured against the last kept tier, so it stops dropping once enough is new', () => {
    const old = Array.from({ length: 20 }, (_, i) => `A${i}`);
    const { dropped } = tiers(
      section('t1', 0, old),
      section('t2', 1, old), // an exact copy
      section('t3', 2, [...old, 'B0']), // one new item is not a revision either
      section('t4', 3, [...old.slice(0, 10), ...Array.from({ length: 10 }, (_, i) => `B${i}`)]), // half new
    );
    expect(dropped.map((d) => d.tier)).toEqual(['t2', 't3']);
  });
  test('only the weapon list decides — the same potions every tier is not a copied section', () => {
    const { dropped } = tiers(
      [...section('t1', 0, ['A', 'B', 'C', 'D']), ...section('t1', 0, ['Ironskin', 'Regeneration', 'Swiftness'], 'buff')],
      [...section('t2', 1, ['E', 'F', 'G', 'H']), ...section('t2', 1, ['Ironskin', 'Regeneration', 'Swiftness'], 'buff')],
    );
    expect(dropped).toEqual([]);
  });
  test('classes are judged apart: one stale tab does not take a maintained one with it', () => {
    const { dropped } = tiers(
      [...section('t1', 0, ['A', 'B', 'C', 'D'], 'weapon', 'magic'), ...section('t1', 0, ['P', 'Q', 'R', 'S'], 'weapon', 'melee')],
      [...section('t2', 1, ['A', 'B', 'C', 'D'], 'weapon', 'magic'), ...section('t2', 1, ['W', 'X', 'Y', 'Z'], 'weapon', 'melee')],
    );
    expect(dropped.map((d) => `${d.tier} ${d.cls}`)).toEqual(['t2 magic']);
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

describe('armorMatches', () => {
  const body = { id: 'M:body', slot: 'body' };
  const legs = { id: 'M:legs', slot: 'legs' };
  const meleeHead = { id: 'M:melee-head', slot: 'head', setItems: [body, legs] };
  const magicHead = { id: 'M:magic-head', slot: 'head', setItems: [body, legs] };
  const armor = { head: { item: meleeHead }, body: { item: body }, legs: { item: legs } };

  test('matches class head variants by their shared body and legs', () => {
    expect(armorMatches(armor, magicHead)).toBe(true);
  });

  test('matches an explicitly recommended piece only when it is worn', () => {
    expect(armorMatches(armor, body)).toBe(true);
    expect(armorMatches(armor, { id: 'M:other-body', slot: 'body' })).toBe(false);
  });
});
