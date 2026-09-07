import { describe, expect, test } from 'bun:test';
import {
  ARCHETYPE, BOSS_DEFAULT, CALIBRATION, CHILD_CAP, CROWD, MANA_FLOOR, RECONNECT_SEEK, DMG_MUL_MAX, ENGAGE, LINGER_ON_TARGET, PIERCE_KEEP, REACH, LIFE_FLOOR, RISK, SHOOT_SPEED_MIN, SHOOT_SPEED_UNKNOWN, STUCK_TICKS, SUSTAIN_FLOOR, TERRAIN_PENALTY,
  asTarget, bladeCoverage, bladeLanding,
  boss, bossOf, bossSpeed, engagement, fightableDefense, flightOf, hitDamage, hitsPerProjectile, landing, lifeRegen, manaRegen, playerDamage, reachOf, realDps, standardAmmo, stealthMultiplier, targetStages, unknownDebuffDps,
} from '../src/lib/dps.js';
import { indexDataset } from '../src/lib/dataset.js';

const raw = {
  mods: [{ id: 'v', name: 'Terraria', equipment: 1 }, { id: 'M', name: 'Mod', equipment: 1 }],
  stages: [
    { index: 0, key: 'start', label: 'Pre-boss', progression: 0, mod: 'v', kind: 'start' },
    { index: 1, key: 'b', label: 'Boss', progression: 1, mod: 'v', kind: 'boss', npcs: ['v:4'] },
    { index: 2, key: 'w', label: 'Worm', progression: 2, mod: 'v', kind: 'boss', npcs: ['v:13', 'v:14', 'v:15'] },
    { index: 3, key: 'm', label: 'Twins', progression: 3, mod: 'v', kind: 'boss', npcs: ['v:125', 'v:126'] },
    { index: 4, key: 'e', label: 'Eater', progression: 4, mod: 'v', kind: 'boss', npcs: ['v:20', 'v:21', 'v:22'] },
  ],
  classAliases: { thrower: 'rogue' },
  prefixes: [],
  ammoKinds: { 97: 'Bullet' },
  npcs: {
    'v:4': { name: 'Eye', w: 100, h: 100, defense: 10, life: 2800, immune: ['Bleeding'] },
    'v:13': { name: 'Worm Head', w: 40, h: 40, defense: 4, life: 150 },
    'v:14': { name: 'Worm Body', w: 40, h: 40, defense: 6 },
    'v:15': { name: 'Worm Tail', w: 40, h: 40, defense: 8 },
    'v:125': { name: 'Twin A', w: 60, h: 60, defense: 20, immuneAll: true },
    'v:126': { name: 'Twin B', w: 60, h: 60, defense: 20, immuneAll: true },
    // a vanilla worm: every segment carries the same name
    'v:20': { name: 'Eater of Worlds', w: 38, h: 38, defense: 2 },
    'v:21': { name: 'Eater of Worlds', w: 38, h: 38, defense: 4 },
    'v:22': { name: 'Eater of Worlds', w: 38, h: 38, defense: 8 },
  },
  debuffs: { 'v:24': { dot: 4, name: 'On Fire!' }, 'v:69': { defense: -15, name: 'Ichor' }, Bleeding: { dot: 10 } },
  ammo: [
    { id: 'v:97', name: 'Musket Ball', kind: 97, damage: 7, shoot: 'v:14p', stage: 0 },
    { id: 'M:bigshot', name: 'Big Shot', kind: 97, damage: 20, shoot: 'v:14p', stage: 1 },
  ],
  projectiles: {
    'v:14p': { pen: 1, updates: 1, life: 600 },
    'v:arrow': { ai: 1, gravity: true, gravityK: 0.1, life: 600 },
    'M:fan': { pen: 1, life: 600 },
    // one immunity window for every projectile of the type at once (`usesIDStaticNPCImmunity`)
    'M:sharedFan': { pen: 1, life: 600, local: 10, shared: true },
    'M:knife': { pen: 1, stealth: true, life: 600 },
    // no arc: it is thrown flat. `local` because a Calamity strike that throws several and means
    // them gives its projectile `usesLocalNPCImmunity` — Scourge of the Desert's javelins carry
    // `local: 50` — and without it the six share one window and land a single hit between them
    'M:stealthSpear': { pen: -1, life: 600, local: 20, debuffs: ['Bleeding'] },
    'M:spear': { pen: -1, gravity: true, gravityK: 0.1, life: 600, debuffs: ['Bleeding'] },
    'M:bomb': { pen: 1, gravity: true, gravityK: 0.1, life: 120, children: [{ type: 'M:boom', count: 1, where: 'kill', dmgMul: 1 }] },
    'M:dud': { pen: 1, gravity: true, gravityK: 0.1, life: 120, children: [{ type: 'M:pebble', count: 1, where: 'kill', dmgMul: 1 }] },
    'M:acidFlask': { pen: 1, gravity: true, gravityK: 0.1, life: 120, children: [{ type: 'M:acid', count: 1, where: 'kill', dmgMul: 1 }] },
    'M:boom': { pen: -1, explode: 200, life: 5 },
    'M:acid': { pen: -1, explode: 200, life: 180, local: 30 }, // a cloud that stays and keeps ticking
    'M:fanDig': { pen: 1, life: 600, digs: true },
    'M:digBomb': { pen: 1, gravity: true, gravityK: 0.1, life: 120, children: [{ type: 'M:digBoom', count: 1, where: 'kill', dmgMul: 1 }] },
    'M:digBoom': { pen: -1, explode: 200, life: 5, digs: true },
    'M:pebble': { pen: 1, width: 8, life: 5 },
    'M:minion': { minion: true, slots: 1, local: 20 },
    'M:missile': { homing: { range: 800, speed: 12, inertia: 8 }, life: 600 },
    'M:blind': { homing: { range: 40, speed: 12, inertia: 8 }, life: 600 },
    'M:beam': { pen: -1, local: 6, life: 5, held: true, walls: true },
    'M:yoyo': { pen: -1, local: 10, ai: 99, yoyo: { range: 300, speed: 12, life: -1 } },
    'M:cloud': { pen: -1, local: 20, still: true, life: 600 },
    'M:short': { pen: 1, life: 4 },
    'M:fire': { pen: 1, life: 600, debuffs: ['v:24'] },
    'M:ichor': { pen: 1, life: 600, debuffs: ['v:69'] },
    'M:splitter': { pen: 1, life: 600, children: [{ type: 'M:pebble', count: 1, where: 'hit', dmgMul: 1 }] },
    'M:rebound': { pen: -1, life: 600, bounces: true }, // it changes course the moment it connects
    'M:shatter': { pen: 1, life: 600, children: [{ type: 'M:pebble', count: 5, where: 'kill', dmgMul: 0.5, stealth: true }] },
    'M:midrange': { pen: 1, life: 20 },
    // tuned to land between the two reaches the model used to compute: 9.6 px/tick at gravity 0.2
    // carries 215 px against the boss's half-height and 225 px against the old flat tolerance, so a
    // 220 px throw was walked to a distance the shot was then told it could not cover
    'M:dropKnife': { pen: 1, life: 600, gravity: true, gravityK: 0.2 },
    'M:plainPierce': { pen: 2, local: 20, life: 600, homing: { range: 300 } },
    'M:strikePierce': { pen: 2, stealthPen: 4, local: 20, life: 600, homing: { range: 300 } },
    'M:rangProj': { pen: 1, life: 600 }, // 12 px/tick × 20 = 240 px of the 380 a ranged player wants
    'M:whipProj': { whip: true },
    'M:lash': { pen: -1, life: 600 },
    'M:bigMul': { pen: 1, life: 600, children: [{ type: 'M:pebble', count: 1, where: 'hit', dmgMul: 15 }] },
    // a tether: sticks in the target with a one-tick immunity, and the AI's once-a-second timer
    // and three-link counter are things the miner did not read
    'M:chain': { pen: -1, life: 900, local: 1, sticks: true, walls: true },
    // a shell whose burst the tooltip gates on a hit counter; the miner sees only "on death"
    'M:counterShell': { pen: 1, life: 300, local: 10, gravity: true, gravityK: 1, children: [{ type: 'M:boom', count: 1, where: 'kill', dmgMul: 1 }, { type: 'M:pebble', count: 8, where: 'kill', dmgMul: 0.3 }] },
    // a cascade: the bomb explodes, and the explosion leaves a field that keeps ticking
    'M:fieldBomb': { pen: 1, gravity: true, gravityK: 0.1, life: 120, children: [{ type: 'M:fieldBoom', count: 1, where: 'kill', dmgMul: 1 }] },
    'M:fieldBoom': { pen: -1, explode: 200, life: 5, children: [{ type: 'M:acid', count: 1, where: 'kill', dmgMul: 0.5 }] },
    // a debuff the miner has no record for, and one it priced
    'M:curse': { pen: 1, life: 600, debuffs: ['M:Curse'] },
    'M:shortFire': { pen: 1, life: 4, debuffs: ['v:24'] }, // dies before it arrives, fire and all
    // a bolt with its own hit cooldown that spawns splinters without one: two immunity groups
    'M:ownClock': { pen: 3, local: 6, life: 600, children: [{ type: 'M:pebble', count: 4, where: 'hit', dmgMul: 1 }] },
    // an on-hit proc the tooltip puts on a cooldown
    'M:procShot': { pen: 1, life: 600, children: [{ type: 'M:boom', count: 1, where: 'hit', dmgMul: 2 }] },
  },
  items: [
    { id: 'v:sword', mod: 'v', name: 'Sword', slot: 'weapon', class: 'melee', arch: 'swing', damage: 20, useTime: 20, useAnimation: 20, crit: 4, useStyle: 1, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'v:gun', mod: 'v', name: 'Gun', slot: 'weapon', class: 'ranged', arch: 'shot', damage: 10, useTime: 10, useAnimation: 10, crit: 4, useAmmo: 97, shoot: 'v:10', shootSpeed: 8, noMelee: true, useStyle: 5, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'v:bow', mod: 'v', name: 'Bow', slot: 'weapon', class: 'ranged', arch: 'shot', damage: 10, useTime: 10, useAnimation: 10, crit: 4, shoot: 'v:arrow', shootSpeed: 4, noMelee: true, useStyle: 5, stage: 0, stageSource: { kind: 'rarity' },
      fire: { calls: [{ type: 'shoot', count: 3, spread: 0.5 }], defaultShot: { spam: false, stealth: false } } },
    { id: 'M:fanGun', mod: 'M', name: 'Fan Gun', slot: 'weapon', class: 'ranged', arch: 'shot', damage: 10, useTime: 10, useAnimation: 10, crit: 0, shoot: 'M:fan', shootSpeed: 12, noMelee: true, useStyle: 5, stage: 0, stageSource: { kind: 'rarity' },
      fire: { calls: [{ type: 'shoot', count: 3, spread: 0.5, fan: true }], defaultShot: { spam: false, stealth: false } } },
    { id: 'M:randGun', mod: 'M', name: 'Rand Gun', slot: 'weapon', class: 'ranged', arch: 'shot', damage: 10, useTime: 10, useAnimation: 10, crit: 0, shoot: 'M:fan', shootSpeed: 12, noMelee: true, useStyle: 5, stage: 0, stageSource: { kind: 'rarity' },
      fire: { calls: [{ type: 'shoot', count: 3, spread: 0.5 }], defaultShot: { spam: false, stealth: false } } },
    { id: 'M:dropper', mod: 'M', name: 'Dropper', slot: 'weapon', class: 'thrower', arch: 'dagger', damage: 20, useTime: 25, useAnimation: 25, crit: 4, shoot: 'M:dropKnife', shootSpeed: 9.6, noMelee: true, useStyle: 1, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:rogue', mod: 'M', name: 'Knife', slot: 'weapon', class: 'thrower', arch: 'shot', damage: 30, useTime: 20, useAnimation: 20, crit: 4, shoot: 'M:knife', shootSpeed: 12, noMelee: true, useStyle: 1, stage: 0, stageSource: { kind: 'rarity' },
      fire: { calls: [{ type: 'M:stealthSpear', count: 3, variant: 'stealth', region: 50 }], defaultShot: { spam: true, stealth: false }, stealthMods: { dmgMul: 1.5 }, stealth: true } },
    { id: 'M:staff', mod: 'M', name: 'Staff', slot: 'weapon', class: 'summon', arch: 'minion', damage: 12, useTime: 30, useAnimation: 30, shoot: 'M:minion', stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:tome', mod: 'M', name: 'Tome', slot: 'weapon', class: 'magic', arch: 'shot', damage: 40, useTime: 6, useAnimation: 6, crit: 4, mana: 10, shoot: 'M:missile', shootSpeed: 12, noMelee: true, useStyle: 5, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:blindTome', mod: 'M', name: 'Blind Tome', slot: 'weapon', class: 'magic', arch: 'shot', damage: 40, useTime: 6, useAnimation: 6, crit: 4, mana: 10, shoot: 'M:blind', shootSpeed: 12, noMelee: true, useStyle: 5, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:bomb', mod: 'M', name: 'Bomb', slot: 'weapon', class: 'thrower', arch: 'shot', damage: 30, useTime: 30, useAnimation: 30, crit: 4, shoot: 'M:bomb', shootSpeed: 8, noMelee: true, useStyle: 1, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:flask', mod: 'M', name: 'Flask', slot: 'weapon', class: 'thrower', arch: 'bomb', damage: 30, useTime: 30, useAnimation: 30, crit: 4, shoot: 'M:acidFlask', shootSpeed: 8, noMelee: true, useStyle: 1, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:dud', mod: 'M', name: 'Dud', slot: 'weapon', class: 'thrower', arch: 'shot', damage: 30, useTime: 30, useAnimation: 30, crit: 4, shoot: 'M:dud', shootSpeed: 8, noMelee: true, useStyle: 1, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:drill', mod: 'M', name: 'Drill', slot: 'weapon', class: 'melee', arch: 'held', damage: 15, useTime: 20, useAnimation: 20, crit: 4, shoot: 'M:beam', shootSpeed: 10, channel: true, noMelee: true, useStyle: 5, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:yoyoItem', mod: 'M', name: 'Yoyo', slot: 'weapon', class: 'melee', arch: 'yoyo', damage: 15, useTime: 25, useAnimation: 25, crit: 4, shoot: 'M:yoyo', shootSpeed: 16, channel: true, noMelee: true, useStyle: 5, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:rod', mod: 'M', name: 'Rod', slot: 'weapon', class: 'magic', arch: 'placed', damage: 15, useTime: 25, useAnimation: 25, crit: 0, mana: 1, shoot: 'M:cloud', shootSpeed: 10, noMelee: true, useStyle: 1, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:pike', mod: 'M', name: 'Pike', slot: 'weapon', class: 'melee', arch: 'spear', damage: 20, useTime: 25, useAnimation: 25, crit: 4, shoot: 'M:spear', shootSpeed: 12, noMelee: true, useStyle: 5, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:rang', mod: 'M', name: 'Rang', slot: 'weapon', class: 'melee', arch: 'boomerang', damage: 20, useTime: 25, useAnimation: 25, crit: 4, shoot: 'M:fan', shootSpeed: 12, noMelee: true, useStyle: 1, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:knifeSame', mod: 'M', name: 'Same Knife', slot: 'weapon', class: 'ranged', arch: 'shot', damage: 20, useTime: 25, useAnimation: 25, crit: 4, shoot: 'M:rangProj', shootSpeed: 4, noMelee: true, useStyle: 5, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:rangSame', mod: 'M', name: 'Same Rang', slot: 'weapon', class: 'ranged', arch: 'boomerang', damage: 20, useTime: 25, useAnimation: 25, crit: 4, shoot: 'M:rangProj', shootSpeed: 4, noMelee: true, useStyle: 5, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:popgun', mod: 'M', name: 'Popgun', slot: 'weapon', class: 'ranged', arch: 'shot', damage: 10, useTime: 10, useAnimation: 10, crit: 0, shoot: 'M:short', shootSpeed: 4, noMelee: true, useStyle: 5, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:torch', mod: 'M', name: 'Torch', slot: 'weapon', class: 'ranged', arch: 'shot', damage: 10, useTime: 10, useAnimation: 10, crit: 0, shoot: 'M:fire', shootSpeed: 12, noMelee: true, useStyle: 5, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:ichorGun', mod: 'M', name: 'Ichor Gun', slot: 'weapon', class: 'ranged', arch: 'shot', damage: 10, useTime: 10, useAnimation: 10, crit: 0, shoot: 'M:ichor', shootSpeed: 12, noMelee: true, useStyle: 5, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:mystery', mod: 'M', name: 'Mystery Gun', slot: 'weapon', class: 'ranged', arch: 'shot', damage: 10, useTime: 10, useAnimation: 10, crit: 0, shoot: 'M:fan', noMelee: true, useStyle: 5, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:midGun', mod: 'M', name: 'Mid Gun', slot: 'weapon', class: 'ranged', arch: 'shot', damage: 10, useTime: 10, useAnimation: 10, crit: 0, shoot: 'M:midrange', shootSpeed: 12, noMelee: true, useStyle: 5, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:shatterBrick', mod: 'M', name: 'Shatter Brick', slot: 'weapon', class: 'thrower', arch: 'bomb', damage: 20, useTime: 25, useAnimation: 25, crit: 4, shoot: 'M:shatter', shootSpeed: 12, noMelee: true, useStyle: 1, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:splitGun', mod: 'M', name: 'Split Gun', slot: 'weapon', class: 'ranged', arch: 'shot', damage: 10, useTime: 10, useAnimation: 10, crit: 0, shoot: 'M:splitter', shootSpeed: 12, noMelee: true, useStyle: 5, stage: 0, stageSource: { kind: 'rarity' } },
    // two clicks: the left throws a splitter that spawns pebbles on hit, the right throws the pebbles
    { id: 'M:twoClick', mod: 'M', name: 'Two Click', slot: 'weapon', class: 'ranged', arch: 'shot', damage: 10, useTime: 10, useAnimation: 10, crit: 0, shoot: 'M:splitter', shootSpeed: 12, noMelee: true, useStyle: 5, stage: 0, stageSource: { kind: 'rarity' },
      fire: { calls: [{ type: 'shoot', alt: false }, { type: 'M:pebble', alt: true }], defaultShot: { spam: false, stealth: false } } },
    // a dud left click and a real right click: the weapon is worth the right one
    { id: 'M:altBetter', mod: 'M', name: 'Alt Better', slot: 'weapon', class: 'ranged', arch: 'shot', damage: 10, useTime: 10, useAnimation: 10, crit: 0, shoot: 'M:short', shootSpeed: 4, noMelee: true, useStyle: 5, stage: 0, stageSource: { kind: 'rarity' },
      fire: { calls: [{ type: 'shoot', alt: false }, { type: 'M:fan', alt: true }], defaultShot: { spam: false, stealth: false } } },
    { id: 'M:pen', mod: 'M', name: 'Pen Gun', slot: 'weapon', class: 'ranged', arch: 'shot', damage: 10, useTime: 10, useAnimation: 10, crit: 0, armorPen: 20, shoot: 'M:fan', shootSpeed: 12, noMelee: true, useStyle: 5, stage: 0, stageSource: { kind: 'rarity' } },
    // a sword whose `useTime` outlasts its animation: it still swings every animation
    { id: 'M:starSword', mod: 'M', name: 'Star Sword', slot: 'weapon', class: 'melee', arch: 'swing', damage: 20, useTime: 40, useAnimation: 20, crit: 4, useStyle: 1, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:whipItem', mod: 'M', name: 'Whip', slot: 'weapon', class: 'summon', arch: 'whip', damage: 10, useTime: 30, useAnimation: 30, shoot: 'M:whipProj', shootSpeed: 4, noMelee: true, useStyle: 1, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:sprayWhip', mod: 'M', name: 'Spray Whip', slot: 'weapon', class: 'summon', arch: 'whip', damage: 10, useTime: 30, useAnimation: 30, shoot: 'M:whipProj', shootSpeed: 4, noMelee: true, useStyle: 1, stage: 0, stageSource: { kind: 'rarity' },
      fire: { calls: [{ type: 'M:lash', count: 8 }], defaultShot: { spam: false, stealth: false } } },
    { id: 'M:crawler', mod: 'M', name: 'Crawler', slot: 'weapon', class: 'ranged', arch: 'shot', damage: 10, useTime: 10, useAnimation: 10, crit: 0, shoot: 'M:fan', shootSpeed: 1, noMelee: true, useStyle: 5, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:mulGun', mod: 'M', name: 'Mul Gun', slot: 'weapon', class: 'ranged', arch: 'shot', damage: 10, useTime: 10, useAnimation: 10, crit: 0, shoot: 'M:bigMul', shootSpeed: 12, noMelee: true, useStyle: 5, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:tether', mod: 'M', name: 'Tether', slot: 'weapon', class: 'magic', arch: 'shot', damage: 100, useTime: 30, useAnimation: 30, crit: 0, shoot: 'M:chain', shootSpeed: 1, noMelee: true, useStyle: 5, stage: 0, stageSource: { kind: 'rarity' },
      tooltip: 'Clicking an enemy links it to a player\nThe chains deal damage once every second\nUp to 3 enemies can be chained to you' },
    { id: 'M:counterGun', mod: 'M', name: 'Counter Gun', slot: 'weapon', class: 'ranged', arch: 'shot', damage: 65, useTime: 40, useAnimation: 40, crit: 0, shoot: 'M:counterShell', shootSpeed: 20, noMelee: true, useStyle: 5, stage: 0, stageSource: { kind: 'rarity' },
      tooltip: 'Fire a series of bullets after hit enemy 8 times in a row' },
    { id: 'M:fieldThrower', mod: 'M', name: 'Field Thrower', slot: 'weapon', class: 'thrower', arch: 'shot', damage: 30, useTime: 30, useAnimation: 30, crit: 0, shoot: 'M:fieldBomb', shootSpeed: 8, noMelee: true, useStyle: 1, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:curseGun', mod: 'M', name: 'Curse Gun', slot: 'weapon', class: 'ranged', arch: 'shot', damage: 10, useTime: 10, useAnimation: 10, crit: 0, shoot: 'M:curse', shootSpeed: 12, noMelee: true, useStyle: 5, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:twoClocks', mod: 'M', name: 'Two Clocks', slot: 'weapon', class: 'ranged', arch: 'shot', damage: 10, useTime: 5, useAnimation: 5, crit: 0, shoot: 'M:ownClock', shootSpeed: 12, noMelee: true, useStyle: 5, stage: 0, stageSource: { kind: 'rarity' } },
    { id: 'M:procGun', mod: 'M', name: 'Proc Gun', slot: 'weapon', class: 'ranged', arch: 'shot', damage: 10, useTime: 10, useAnimation: 10, crit: 0, shoot: 'M:procShot', shootSpeed: 12, noMelee: true, useStyle: 5, stage: 0, stageSource: { kind: 'rarity' },
      tooltip: 'Hits set off an explosion, 5 second cooldown' },
    // a void weapon: a ranged bow underneath, spending void per shot
    { id: 'M:voidBow', mod: 'M', name: 'Void Bow', slot: 'weapon', class: 'void', subclass: 'ranged', voidCost: 10, arch: 'shot', damage: 40, useTime: 10, useAnimation: 10, crit: 4, shoot: 'M:fan', shootSpeed: 12, noMelee: true, useStyle: 5, stage: 0, stageSource: { kind: 'rarity' } },
    // a sword whose star flies further than the blade reaches
    { id: 'M:starBlade', mod: 'M', name: 'Star Blade', slot: 'weapon', class: 'melee', arch: 'swing', damage: 20, useTime: 20, useAnimation: 20, crit: 4, shoot: 'M:fan', shootSpeed: 12, useStyle: 1, stage: 0, stageSource: { kind: 'rarity' } },
  ],
};
const ds = indexDataset(structuredClone(raw));
const ctx = (extra = {}) => ({ conds: new Set(), uncertain: false, prefix: null, calibration: null, ds, stage: 0, ...extra });
const dps = (id, extra) => realDps(ds.byId.get(id), ctx(extra));
const part = (r, re) => r.parts.find((p) => re.test(p.label));

describe('boss', () => {
  test("reads the next stage's NPCs: size, defense, parts, worm", () => {
    const b = boss(ds, 0);
    expect(b.name).toBe('Eye');
    expect(b.w).toBe(100);
    expect(b.defense).toBe(10);
    expect(b.parts).toBe(1);
    expect(b.worm).toBe(false);
    const w = boss(ds, 1);
    expect(w.worm).toBe(true);
    expect(w.parts).toBe(3);
    expect(boss(ds, 2).parts).toBe(2);
    expect(boss(null, undefined).name).toBe(null);
  });
  test('a vanilla worm is one boss named three times, and aims wider than a segment', () => {
    const w = bossOf(ds, 4);
    expect(w.worm).toBe(true);       // no Head/Body/Tail in the names, just three the same
    expect(w.w).toBe(38);            // one segment, for how long a shot spends crossing it
    expect(w.aimW).toBe(38 * 3);     // …but the body you aim at is the whole chain
    expect(bossOf(ds, 1).aimW).toBe(bossOf(ds, 1).w); // a single boss aims at itself
  });
  test('an invulnerable phase is not armour: 9999 defense falls back to the default', () => {
    expect(fightableDefense([{ defense: 9999 }])).toBe(BOSS_DEFAULT.defense);
    expect(fightableDefense([{ defense: 9999 }, { defense: 12 }])).toBe(12);
    expect(fightableDefense([{ defense: 4 }, { defense: 9 }])).toBe(4); // the softest part you can hit
  });
  test('a boss whose immunities could not be read is assumed immune to everything', () => {
    expect(boss(ds, 2).immuneAll).toBe(true);
    expect(boss(ds, 0).immuneAll).toBe(false);
  });
  test('a target can be picked instead of the boss fought next', () => {
    expect(boss(ds, 0).name).toBe('Eye');            // the default: whatever comes next
    expect(boss(ds, 0, 2).name).toBe('Worm Head');   // …or the one asked for
    expect(bossOf(ds, 3).name).toBe('Twin A');
    expect(targetStages(ds).map((s) => s.index)).toEqual([1, 2, 3, 4]); // stage 0 has no NPCs
    // and the pick reaches the score: the worm's 4 defense eats less of a hit than the Eye's 10,
    // and it is a chain of small segments rather than one wide silhouette
    const worm = dps('M:fanGun', { target: 2 });
    expect(worm.boss.name).toBe('Worm Head');
    expect(worm.boss.worm).toBe(true);
    expect(worm.hit).toBeGreaterThan(dps('M:fanGun', { target: 1 }).hit);
    // the Twins shrug off every debuff, so a weapon that only wins on DoT loses its edge there
    expect(dps('M:torch', { target: 1 }).value).toBeGreaterThan(dps('M:torch', { target: 3 }).value);
  });
  test('boss speed grows with progression', () => {
    expect(bossSpeed(0)).toBeCloseTo(5);
    expect(bossSpeed(28)).toBeCloseTo(14);
    expect(bossSpeed(100)).toBeCloseTo(14);
  });
});

describe('engagement distance', () => {
  test('a class default, clamped by what the archetype can reach', () => {
    expect(engagement('ranged', 'shot', null)).toBe(ENGAGE.ranged);
    expect(engagement('ranged', 'swing', null)).toBe(REACH.swing);
    expect(engagement('melee', 'shot', null)).toBe(ENGAGE.melee);
  });
  test('the playstyle toggle moves only the distance', () => {
    expect(engagement('ranged', 'shot', { ranged: 'sniper' })).toBe(520);
    expect(engagement('ranged', 'shot', { ranged: 'rapid' })).toBe(280);
    expect(engagement('ranged', 'shot', { magic: 'nuke' })).toBe(ENGAGE.ranged);
  });
});

describe('landing', () => {
  const b = boss(ds, 0);
  test('a random spread only lands the share of its cone inside the silhouette', () => {
    const wide = landing(null, { D: 400, boss: b, spread: 0.5, velocity: null });
    const theta = Math.atan(50 / 400);
    expect(wide.f).toBeCloseTo(theta / 0.5, 3);
    expect(landing(null, { D: 400, boss: b, spread: 0.05, velocity: null }).f).toBe(1);
  });
  test('a fan puts its shots at fixed angles: a wide target catches more of them than a random spread', () => {
    const fan = landing(null, { D: 400, boss: b, spread: 0.5, fan: true, count: 3, velocity: null });
    const rand = landing(null, { D: 400, boss: b, spread: 0.5, fan: false, count: 3, velocity: null });
    expect(fan.f).toBe(1 / 3); // only the middle shot is inside ±7°
    expect(fan.f).toBeGreaterThan(rand.f);
  });
  test('a slow projectile over a long distance gives a moving boss time to leave', () => {
    const slow = landing({ life: 600 }, { D: 400, boss: b, velocity: 4, vb: 5 });
    const fast = landing({ life: 600 }, { D: 400, boss: b, velocity: 40, vb: 5 });
    expect(slow.f).toBeLessThan(fast.f);
    expect(fast.f).toBeGreaterThan(0.75);
    expect(landing({ life: 600 }, { D: 400, boss: b, velocity: 4, vb: 0 }).f).toBe(1);
  });
  test('gravity drops the arc below the silhouette', () => {
    const flat = landing({ life: 600 }, { D: 400, boss: b, velocity: 8, vb: 5 });
    const arc = landing({ life: 600, gravity: true, gravityK: 0.1 }, { D: 400, boss: b, velocity: 8, vb: 5 });
    expect(arc.f).toBeLessThan(flat.f);
    expect(part(arc, /arc drops/)).toBeTruthy();
  });
  test('homing needs to see the target and to be quicker than it', () => {
    const at = (homing) => landing({ life: 600, ...(homing ? { homing } : {}) }, { D: 400, boss: b, velocity: 12, vb: 5 });
    const dumb = at(null);
    expect(at({ range: 800, speed: 12, inertia: 4 }).f).toBeGreaterThan(dumb.f);
    expect(at({ range: 40, speed: 12, inertia: 4 }).f).toBeCloseTo(dumb.f, 5); // it never sees it
    expect(at({ range: 800, speed: 1, inertia: 4 }).f).toBeCloseTo(dumb.f, 5); // it never catches it
  });
  test('the landing factors multiply out to the number they explain', () => {
    const r = landing({ life: 600, gravity: true, gravityK: 0.1, walls: true, homing: { range: 800, speed: 12, inertia: 4 } },
      { D: 400, boss: b, velocity: 12, vb: 5 });
    expect(part(r, /homing/)).toBeTruthy();
    expect(r.parts.reduce((n, x) => n * x.mul, 1)).toBeCloseTo(r.f, 1);
  });
  test('extra updates make a projectile arrive sooner, not travel further', () => {
    // `life` is counted in updates, so three updates a tick spend it three times as fast
    expect(reachOf({ life: 600, updates: 2 }, 10)).toBe(6000);
    expect(reachOf({ life: 600 }, 10)).toBe(6000);
    expect(flightOf({ life: 600, updates: 2 }, 30, 300).flight).toBeCloseTo(10, 5); // 30 px a tick
    expect(flightOf({ life: 600, updates: 2 }, 30, 300).alive).toBeCloseTo(190, 5); // 200 ticks of life, 10 spent
    expect(flightOf({ life: 600 }, 10, 300).alive).toBeCloseTo(570, 5);
  });
  test('an arcing shot is out of range when it has fallen too far, not when it expires', () => {
    // a knife that lives 300 ticks at 12 px/tick would cross the world; what it cannot do is stay
    // level, so the reach is how far it gets before it has dropped out of the silhouette
    const flat = reachOf({ life: 300 }, 12, 50);
    const arc = reachOf({ life: 300, gravity: true, gravityK: 0.15 }, 12, 50);
    expect(flat).toBe(3600);
    expect(arc).toBeCloseTo(12 * Math.sqrt(100 / 0.15), 5);
    expect(arc).toBeLessThan(flat / 5);
    // …and a seeker climbs back onto the target, so the arc stops limiting it
    expect(reachOf({ life: 300, gravity: true, gravityK: 0.15, homing: { range: 300 } }, 12, 50)).toBe(3600);
  });
  test('a projectile that expires before it arrives never lands', () => {
    expect(landing({ life: 4 }, { D: 400, boss: b, velocity: 8 }).f).toBe(0);
    expect(landing({ life: 60 }, { D: 400, boss: b, velocity: 8 }).f).toBeLessThan(1); // 480 px: only just
    expect(landing({ life: 600 }, { D: 400, boss: b, velocity: 8 }).f).toBeGreaterThan(0.4);
  });
  test('drag shortens the reach', () => {
    expect(reachOf({ life: 600 }, 10)).toBe(6000);
    expect(reachOf({ life: 600, drag: 0.9 }, 10)).toBeCloseTo(100, 5);
  });
});

describe('hits per projectile', () => {
  const single = boss(ds, 0);
  const worm = boss(ds, 1);
  test('infinite pierce on a single target is worth a hit or two, not a multiplier', () => {
    const r = hitsPerProjectile({ pen: -1, local: 10 }, { boss: single, velocity: 10, arch: 'shot' });
    expect(r.hits).toBeGreaterThan(1);
    expect(r.hits).toBeLessThan(3);
  });
  test('single / multi target: pierce is worth what there is to pierce', () => {
    const p = { pen: -1, local: 10, life: 600 };
    const one = hitsPerProjectile(p, { boss: asTarget(single, 'single'), velocity: 10, arch: 'shot' });
    const many = hitsPerProjectile(p, { boss: asTarget(single, 'multi'), velocity: 10, arch: 'shot' });
    // the extras fall off geometrically now, so a crowd is worth more but not `CROWD` times more
    expect(many.hits).toBeGreaterThan(one.hits);
    expect(many.hits).toBeLessThan(one.hits * CROWD);
    expect(many.label).toContain(`${CROWD} targets`);
    // a worm is already several bodies, so asking for one strips them
    expect(hitsPerProjectile(p, { boss: asTarget(worm, 'single'), velocity: 10, arch: 'shot' }).hits)
      .toBeLessThan(hitsPerProjectile(p, { boss: worm, velocity: 10, arch: 'shot' }).hits);
    // a shot that cannot pierce gains nothing from a crowd
    const once = { pen: 1, local: 10, life: 600 };
    expect(hitsPerProjectile(once, { boss: asTarget(single, 'multi'), velocity: 10, arch: 'shot' }).hits)
      .toBe(hitsPerProjectile(once, { boss: asTarget(single, 'single'), velocity: 10, arch: 'shot' }).hits);
    // …and only the pierce path reaches a second body, so only it is exempt from the crowd waste
    expect(many.spread).toBe(true);
    expect(hitsPerProjectile({ pen: -1, local: 10, life: 600, bounces: true }, { boss: asTarget(single, 'multi'), velocity: 10, arch: 'shot' }).spread)
      .toBeUndefined();
  });
  test('time on target saturates: a seeker is not worth one hit per immunity window for ten seconds', () => {
    // `LIFE_UNKNOWN` is 600 ticks and a 10-tick cooldown divides into it 55 times, which is what a
    // homing infinite-pierce shot was being paid against a *single* target. The fight moves, the
    // seeker overshoots and comes back, and the lifetime is usually a guess rather than a read.
    const seeker = { pen: -1, local: 10, life: 600, homing: { range: 300 } };
    const opts = { boss: asTarget(single, 'single'), velocity: 10, arch: 'shot', land: 1 };
    const hits = hitsPerProjectile(seeker, opts).hits;
    expect(hits).toBeGreaterThan(5);                 // it does keep coming back
    expect(hits).toBeLessThan(1 + RECONNECT_SEEK);   // …but not once per window for its whole life
    // a shot that cannot steer has to drift back into the target by luck, and is worth much less
    const plain = hitsPerProjectile({ pen: -1, local: 10, life: 600 }, opts).hits;
    expect(plain).toBeLessThan(hits / 2);
    // longer life still helps, with diminishing returns rather than in proportion
    const longer = hitsPerProjectile({ ...seeker, life: 6000 }, opts).hits;
    expect(longer).toBeGreaterThan(hits);
    expect(longer).toBeLessThan(hits * 1.5);
  });
  test('a crowd sweeps distinct bodies, so a capped pierce reliably gets its own cap', () => {
    // the geometric falloff answers "will it find another body", which a crowd has already
    // answered. Under it a pierce-2 shot got *less* out of six bodies than out of one, which is
    // backwards — the crowd is the case its pierce was bought for.
    const p = { pen: 2, local: 10, life: 600 };
    const one = hitsPerProjectile(p, { boss: asTarget(single, 'single'), velocity: 10, arch: 'shot', land: 0.7 });
    const many = hitsPerProjectile(p, { boss: asTarget(single, 'multi'), velocity: 10, arch: 'shot', land: 0.7 });
    expect(many.hits).toBeGreaterThan(one.hits);
    expect(many.hits).toBeLessThanOrEqual(2);
  });
  test('without local immunity it falls back to the player’s own 10-tick window', () => {
    const own = hitsPerProjectile({ pen: -1, life: 600 }, { boss: single, velocity: 10, arch: 'shot' });
    const local = hitsPerProjectile({ pen: -1, local: 10, life: 600 }, { boss: single, velocity: 10, arch: 'shot' });
    expect(own.hits).toBeCloseTo(local.hits, 5); // the same 10 ticks, whoever owns the cooldown
    expect(own.hits).toBeGreaterThan(1);
  });
  test('extra hits need life left when the projectile arrives', () => {
    const near = hitsPerProjectile({ pen: -1, local: 10, life: 600 }, { boss: single, velocity: 10, arch: 'shot', D: 50 });
    const far = hitsPerProjectile({ pen: -1, local: 10, life: 51 }, { boss: single, velocity: 10, arch: 'shot', D: 500 });
    expect(far.hits).toBeLessThan(1.2); // it expires as it arrives, however far it pierces
    expect(near.hits).toBeGreaterThan(far.hits); // it arrives with life to spend
  });
  test('a slow, lingering projectile racks up hits a fast one cannot', () => {
    const slow = hitsPerProjectile({ pen: -1, local: 10, life: 600 }, { boss: single, velocity: 2, arch: 'shot' });
    const fast = hitsPerProjectile({ pen: -1, local: 10, life: 600 }, { boss: single, velocity: 30, arch: 'shot' });
    // …by less than it used to: repeat hits saturate now, so time on target is worth real hits but
    // not one per immunity window for the whole of a lifetime
    expect(slow.hits).toBeGreaterThan(fast.hits * 1.2);
  });
  test('pierce caps the count, and the extra hits are conditioned on staying on target', () => {
    const opts = { boss: single, velocity: 2, arch: 'shot' };
    // pierce 2 is a ceiling, not a promise: a thrown weapon has to line up on the second body, and
    // at `PIERCE_KEEP` per extra it mostly does not
    expect(hitsPerProjectile({ pen: 2, local: 10, life: 600 }, { ...opts, land: 1 }).hits).toBeCloseTo(1 + PIERCE_KEEP, 5);
    // what it cost to carry as far as the first body is paid on that hit, not again on every body
    // it pierces into: `aim` is the landing chance without the range term, and it is what the
    // falloff runs on.
    expect(hitsPerProjectile({ pen: 2, local: 10, life: 600 }, { ...opts, land: 0.2, aim: 1 }).hits)
      .toBeCloseTo(hitsPerProjectile({ pen: 2, local: 10, life: 600 }, { ...opts, land: 1 }).hits, 5);
    expect(hitsPerProjectile({ pen: 2, local: 10, life: 600 }, { ...opts, land: 1 }).hits).toBeLessThan(2);
    // …a seeker steers onto it, so it keeps the whole pierce
    expect(hitsPerProjectile({ pen: 2, local: 10, life: 600, homing: { range: 800 } }, { ...opts, land: 1 }).hits).toBe(2);
    const sure = hitsPerProjectile({ pen: -1, local: 10, life: 600 }, { ...opts, land: 1 });
    const iffy = hitsPerProjectile({ pen: -1, local: 10, life: 600 }, { ...opts, land: 0.25 });
    expect(iffy.hits).toBeLessThan(sure.hits);
  });
  test('a worm multiplies pierce by the segments in the path', () => {
    const w = hitsPerProjectile({ pen: -1, local: 10 }, { boss: worm, velocity: 10, arch: 'shot' });
    const s = hitsPerProjectile({ pen: -1, local: 10 }, { boss: single, velocity: 10, arch: 'shot' });
    expect(w.hits).toBeGreaterThan(s.hits);
    expect(hitsPerProjectile({ pen: 2, local: 10 }, { boss: worm, velocity: 10, arch: 'shot' }).hits).toBeLessThanOrEqual(2);
  });
  test('a spear hits out and back when it has local immunity', () => {
    expect(hitsPerProjectile({ pen: -1, local: 10 }, { boss: single, arch: 'spear' }).hits).toBe(2);
    expect(hitsPerProjectile({ pen: -1 }, { boss: single, arch: 'spear' }).hits).toBe(1);
  });
  test('a contact weapon counts contact time, not a pass', () => {
    expect(hitsPerProjectile({ pen: -1, local: 6 }, { boss: single, arch: 'held' }).hits).toBe(1);
  });
  test('a projectile that changes course on hit is not piercing through it', () => {
    const opts = { boss: single, velocity: 8, arch: 'shot', D: 200 };
    // Thorium's baseball reads as infinite pierce and actually bounces back to your hand
    expect(hitsPerProjectile({ pen: -1, life: 600, bounces: true }, opts).hits).toBe(1);
    expect(hitsPerProjectile({ pen: -1, life: 600 }, opts).hits).toBeGreaterThan(1);
  });
  test('a projectile that sticks in what it hits does not go through it', () => {
    const opts = { boss: single, velocity: 8, arch: 'shot', D: 200 };
    // infinite pierce and a wide hitbox buy nothing once it is embedded in the first thing it hits
    expect(hitsPerProjectile({ pen: -1, life: 120, width: 36, sticks: true }, opts).hits).toBe(1);
    expect(hitsPerProjectile({ pen: -1, life: 120, width: 36 }, opts).hits).toBeGreaterThan(1);
  });
  test('a javelin keeps wounding what it is stuck in, on its own cooldown', () => {
    const opts = { boss: single, velocity: 8, arch: 'shot', D: 200 };
    const bola = hitsPerProjectile({ pen: -1, life: 600, sticks: true }, opts);           // no cooldown of its own
    const javelin = hitsPerProjectile({ pen: -1, life: 600, local: 20, sticks: true }, opts);
    expect(bola.hits).toBe(1);
    expect(javelin.hits).toBeCloseTo(1 + STUCK_TICKS / 20, 5);
    // …but never past its own pierce
    expect(hitsPerProjectile({ pen: 3, life: 600, local: 20, sticks: true }, opts).hits).toBe(3);
  });
  test('a negative hit cooldown is once per NPC ever, whatever the pierce says', () => {
    const opts = { boss: single, velocity: 2, arch: 'shot', life: 600 };
    expect(hitsPerProjectile({ pen: -1, local: -1, life: 600 }, opts).hits).toBe(1);
    expect(hitsPerProjectile({ pen: -1, life: 600 }, opts).hits).toBeGreaterThan(1);
  });
});

describe('damage per hit', () => {
  test('defense comes off the damage a loadout does, not off the printed number', () => {
    // a flat defense taken from the item's own damage is a tax on every weapon that hits often for
    // a little; the player fighting that boss is wearing a set and six reforged accessories
    expect(playerDamage(0)).toBeGreaterThan(1);
    expect(playerDamage(7)).toBeGreaterThan(playerDamage(0));
    const r = dps('v:sword');
    expect(part(r, /damage a .* loadout carries/).mul).toBeCloseTo(playerDamage(0), 2);
    expect(r.hit).toBeCloseTo(20 * playerDamage(0) - 5, 5); // 20 damage buffed, then the Eye's 10 defense
  });
  test('defense eats half a point per point; armour penetration buys it back, never more', () => {
    const b = boss(ds, 0);
    expect(hitDamage(30, b)).toBe(25);
    expect(hitDamage(30, b, 10)).toBe(30);
    expect(hitDamage(30, b, 999)).toBe(30);
    expect(hitDamage(2, b)).toBe(1);
  });
  test('a defense debuff gives every hit some of it back', () => {
    expect(hitDamage(30, boss(ds, 0), 0, -6)).toBe(28);
  });
  test('armor penetration on the item reaches the DPS', () => {
    expect(dps('M:pen').hit).toBeGreaterThan(dps('M:fanGun').hit);
  });
});

describe('realDps', () => {
  test('a swing hits once per use at contact range', () => {
    const r = dps('v:sword');
    expect(r.kind).toBe('dps');
    expect(r.arch).toBe('swing');
    expect(r.distance).toBe(engagement('melee', 'swing')); // the swing's reach clamps the class distance
    expect(part(r, /contact swing/)).toBeTruthy();
    // (20 damage as the loadout swings it, − 10/2 defense), 3 uses/s, crit, reach, and what
    // fighting closer than the class would like costs
    const risk = part(r, /fights at .* px of the/)?.mul ?? 1;
    // …and the blade has to land: the boss drifts while the arc comes round, and a blade only just
    // reaching is a tip touching — the same two terms every projectile pays
    const blade = bladeLanding({ D: r.distance, boss: r.boss, vb: bossSpeed(r.boss.progression), reach: REACH.swing, ticks: 20 });
    expect(blade.f).toBeLessThan(1);
    expect(blade.f).toBeGreaterThan(0);
    expect(part(r, /contact swing/).label).toMatch(/blade .*reaches 100 px of 100/);
    expect(r.value).toBeCloseTo((20 * playerDamage(0) - 5) * 3 * 1.04 * blade.f * risk * CALIBRATION, 0); // `risk` is the rounded part
  });
  test('a four-tile blade has a much smaller contact window than a normal sword', () => {
    const normal = dps('v:sword');
    const short = realDps({ ...ds.byId.get('v:sword'), scale: 0.64 }, ctx());
    expect(bladeCoverage(64)).toBeCloseTo(0.64 ** 3, 5);
    expect(bladeCoverage(REACH.swing)).toBe(1);
    expect(short.value).toBeLessThan(normal.value * 0.35);
    expect(part(short, /melee reach 64 px vs 100 px standard/)).toBeTruthy();
  });
  test('a sword that also fires splits its score between blade and shot by what each lands', () => {
    // a sword with a projectile: the blade is a phase like the shot, and the split is not a share
    const r = realDps({ ...ds.byId.get('v:sword'), shoot: 'M:fan', shootSpeed: 12 }, ctx());
    const swing = r.phases.find((p) => p.id === 'swing');
    const shot = r.phases.find((p) => p.id === 'default');
    expect(swing.contribution).toBeGreaterThan(0);
    expect(shot.contribution).toBeGreaterThan(0);
    expect(swing.contribution + shot.contribution).toBeCloseTo(r.value, 0);
    // the blade lands less than a full hit per swing: it is not the guaranteed phase any more
    expect(swing.hitsSec).toBeLessThan(3);
  });
  test('a gun is graded on the standard ammo of its kind, not the best one it could hold', () => {
    // AmmoID.Bullet is 97, the Musket Ball's item id — so the plain bullet needs no table, and the
    // Big Shot's 20 damage belongs to the ammo pick rather than to every gun that could fire it
    expect(standardAmmo(ds, 97, 4).name).toBe('Musket Ball'); // not the Big Shot, obtainable since stage 1
    expect(dps('v:gun', { stage: 0 }).hit).toBeCloseTo((10 + 7) * playerDamage(0) - 5, 5);
    // and the ammo is graded by handing the same gun the round in question
    expect(realDps(ds.byId.get('v:gun'), ctx({ stage: 0, ammo: ds.ammo[1] })).value).toBeGreaterThan(dps('v:gun', { stage: 0 }).value);
  });
  test('a deterministic fan beats the same spread thrown at random', () => {
    expect(dps('M:fanGun').value).toBeGreaterThan(dps('M:randGun').value);
  });
  test('homing that reaches the boss beats homing that cannot see it', () => {
    expect(dps('M:tome').value).toBeGreaterThan(dps('M:blindTome').value);
  });
  test('magic pays for mana against the bar, its regen and the potions that top it up', () => {
    // 100 mana/s against 9.5 regen: the bar and a potion every couple of seconds carry most of it,
    // and the potion's own price — Mana Sickness — comes off the rest. Two things must not happen:
    // the old flat floor, which said a weapon at 100 mana/s and one at 1000 were equally
    // sustainable, and a *rate* cap on a mage who is simply drinking (`potionMana`), which is what
    // an income of one Lesser every seven seconds amounted to.
    const r = dps('M:tome');
    const m = part(r, /mana\/s/).mul;
    expect(m).toBeGreaterThan(MANA_FLOOR);
    expect(m).toBeLessThan(0.75);
    expect(manaRegen(0)).toBeCloseTo(9.5);
    const tome = ds.byId.get('M:tome');
    const guzzler = realDps({ ...tome, mana: 100 }, ctx());   // ten times the cost
    expect(part(guzzler, /mana\/s/).mul).toBeLessThan(m * 0.8); // …and nothing like as sustainable
    const cheap = realDps({ ...tome, mana: 1 }, ctx());       // inside the regen: no potion, no sickness
    expect(part(cheap, /mana\/s/)?.mul ?? 1).toBeCloseTo(1, 2);
  });
  test('a weapon paid for in health is charged for it, and the tightest of its pools governs', () => {
    const tome = ds.byId.get('M:tome');
    // a health cost the bar cannot keep up with is a real limit and is priced as one; which of the
    // two pools ends up binding is whichever is worse, and the part says which
    const bleeds = realDps({ ...tome, lifeCost: 5 }, ctx());
    const bleedPool = part(bleeds, /(health|mana)\/s against .* regen/);
    expect(bleedPool.mul).toBeLessThanOrEqual(part(dps('M:tome'), /mana\/s/).mul);
    expect(realDps({ ...tome, lifeCost: 5 }, ctx()).value).toBeLessThanOrEqual(dps('M:tome').value);
    expect(part(realDps({ ...tome, mana: 0, lifeCost: 5 }, ctx()), /health\/s against .* regen/).mul).toBeCloseTo(LIFE_FLOOR, 5);
    // …and one the regen covers costs nothing: mana is still the pool that binds
    const nick = realDps({ ...tome, lifeCost: 0.1 }, ctx());
    expect(part(nick, /mana\/s/).mul).toBeCloseTo(part(dps('M:tome'), /mana\/s/).mul, 5);
    expect(nick.value).toBeCloseTo(dps('M:tome').value, 5);
    expect(lifeRegen(0)).toBeCloseTo(2);
  });
  test('a shot that dies before it arrives scores nothing', () => {
    expect(dps('M:popgun').value).toBe(0); // 4 px/tick for 4 ticks: not even MIN_ENGAGE away
  });
  test('a weapon that cannot cover the class distance is used from closer, not written off', () => {
    const r = dps('M:midGun'); // reaches 240 px; ranged would rather stand at 380
    expect(r.distance).toBe(240);
    expect(r.value).toBeGreaterThan(0); // it still fires — standing at the edge costs, it is not a zero
    expect(part(r, /reaches /).mul).toBeGreaterThan(0);
  });
  test('a shot with no readable velocity is flown slowly, not exempted from landing', () => {
    const r = dps('M:mystery'); // same projectile as M:randGun, no shootSpeed
    expect(part(r, /px\/tick over/)).toBeDefined();
    expect(r.value).toBeLessThan(dps('M:randGun').value * 1.5); // no free pass
    expect(r.value).toBeLessThan(realDps({ ...ds.byId.get('M:mystery'), shootSpeed: 20 }, ctx()).value);
  });
  test('a child the code only spawns on a stealth strike is not counted on a normal throw', () => {
    const r = dps('M:shatterBrick', { stealthMax: 1 });
    expect(r.parts.some((p) => /pebble/.test(p.label))).toBe(false);          // the spam grade
    expect(r.stealthParts.some((p) => /pebble/.test(p.label))).toBe(true);    // …and the strike
  });
  test('an on-hit child only exists as often as its parent lands', () => {
    const near = dps('M:splitGun', { playstyle: { ranged: 'rapid' } });   // 280 px
    const far = dps('M:splitGun', { playstyle: { ranged: 'sniper' } });   // 520 px
    const child = (r) => Number(/\+([\d.]+) hits/.exec(part(r, /pebble on hit/).label)[1]);
    expect(child(near)).toBeGreaterThan(child(far)); // the parent lands less often out there
  });
  test('children add up: each one is printed as what it adds on top of the last', () => {
    const many = structuredClone(raw);
    many.projectiles['M:splitter'].children = [
      { type: 'M:pebble', count: 1, where: 'hit', dmgMul: 1 },
      { type: 'M:pebble', count: 1, where: 'hit', dmgMul: 1 },
      { type: 'M:pebble', count: 1, where: 'hit', dmgMul: 1 },
    ];
    const ds2 = indexDataset(many);
    const r = realDps(ds2.byId.get('M:splitGun'), ctx({ ds: ds2 }));
    const kids = r.parts.filter((p) => /pebble on hit/.test(p.label));
    expect(kids).toHaveLength(3);
    // three children worth the same each: the third adds proportionally less than the first
    expect(kids[0].mul).toBeGreaterThan(kids[2].mul);
    expect(kids.reduce((n, p) => n * p.mul, 1)).toBeLessThan(4);
  });
  // ---- the phase compiler: a phase with its own clock, cap, counter, and a cascade that shows ----
  test('a tether ticks on the interval the tooltip states and keeps at most its stated links', () => {
    const single = dps('M:tether', { targets: 'single' });
    const multi = dps('M:tether', { targets: 'multi' });
    const mute = realDps({ ...ds.byId.get('M:tether'), tooltip: undefined }, ctx({ targets: 'single' }));
    const link = (r) => r.phases.find((p) => p.kind === 'travel');
    // the record states the gates and where they came from
    expect(link(single)).toMatchObject({ interval: 60, maxActive: 3, duration: STUCK_TICKS, confidence: 'text' });
    expect(link(single).evidence).toMatchObject({ interval: 'damage once every second', maxActive: 'Up to 3 enemies' });
    expect(link(mute)).toMatchObject({ interval: null, maxActive: null });
    // one link on one body ticks once a second; what is left is the cast that put it there
    expect(part(single, /1 of up to 3 links maintained on 1 body: 1 ticks\/s/)).toBeTruthy();
    expect(link(single).hitsSec).toBeLessThan(2.5);
    expect(link(single).hitsSec).toBeGreaterThan(1);
    // a crowd carries more links, and never more than the tooltip allows
    expect(part(multi, /of up to 3 links maintained on 6 bodies/)).toBeTruthy();
    expect(multi.value).toBeGreaterThan(single.value);
    expect(link(multi).hitsSec).toBeLessThan(3 + 2.5);
    // …against a lifetime of one-tick hits per cast, which is what the unread clock was worth
    expect(mute.value).toBeGreaterThan(single.value * 20);
    expect(single.phases.reduce((s, p) => s + (p.contribution ?? 0), 0)).toBeCloseTo(single.value, 0);
  });
  test('a burst behind a hit counter is paid once per that many landed hits, not once per shot', () => {
    const r = dps('M:counterGun');
    const every = realDps({ ...ds.byId.get('M:counterGun'), tooltip: undefined }, ctx());
    // the text is about the burst — the one child with a count above one — and not about the
    // ordinary explosion, which fires on every death whatever the tooltip counts
    expect(part(r, /pebble on death, once per 8 landed hits/)).toBeTruthy();
    expect(part(r, /boom on death, once per 8/)).toBeUndefined();
    const kids = r.phases.filter((p) => p.kind === 'split');
    expect(kids).toHaveLength(2);
    expect(kids.find((k) => /pebble/.test(k.projId))).toMatchObject({ threshold: { n: 8, event: 'hit', from: 'text' }, confidence: 'text', parent: 'default' });
    expect(kids.find((k) => /boom/.test(k.projId)).threshold).toBeNull();
    // a mined counter on the child outranks the text, and the text with nothing to attach to attaches to nothing
    const mined = { ...raw, projectiles: { ...raw.projectiles, 'M:counterShell': { ...raw.projectiles['M:counterShell'], children: raw.projectiles['M:counterShell'].children.map((c) => (/pebble/.test(c.type) ? { ...c, threshold: { n: 4, event: 'hit', reset: true, reached: true } } : c)) } } };
    expect(part(realDps(ds.byId.get('M:counterGun'), { ...ctx(), ds: indexDataset(mined) }), /pebble on death, once per 4 hits/)).toBeTruthy();
    const twoBursts = { ...raw, projectiles: { ...raw.projectiles, 'M:counterShell': { ...raw.projectiles['M:counterShell'], children: [...raw.projectiles['M:counterShell'].children, { type: 'M:fan', count: 3, where: 'kill', dmgMul: 0.3 }] } } };
    expect(part(realDps(ds.byId.get('M:counterGun'), { ...ctx(), ds: indexDataset(twoBursts) }), /once per 8/)).toBeUndefined();
    // the counter does the scoring, so the blanket cap no longer has to: it was hiding the 8× error
    expect(part(every, /capped at/)).toBeTruthy();
    expect(part(r, /capped at/)).toBeUndefined();
    expect(r.value).toBeLessThan(every.value);
    expect(r.phases.reduce((s, p) => s + (p.contribution ?? 0), 0)).toBeCloseTo(r.value, 0);
  });
  test('a cascade surfaces as its own phases: the bomb, its blast, and the field the blast leaves', () => {
    const r = dps('M:fieldThrower');
    const ids = r.phases.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['default', 'default:child:0', 'default:child:0:child:0']));
    const blast = r.phases.find((p) => p.id === 'default:child:0');
    const field = r.phases.find((p) => p.id === 'default:child:0:child:0');
    expect(blast).toMatchObject({ kind: 'split', trigger: 'death', parent: 'default', projId: 'M:fieldBoom' });
    expect(field).toMatchObject({ kind: 'split', trigger: 'death', parent: 'default:child:0', projId: 'M:acid' });
    // each with its own rate and share of the score, the three adding up to it — the spam grade,
    // which is the graph a rogue weapon carries: both grades, each phase priced in its own, summing to the value
    for (const id of ['default', 'default:child:0', 'default:child:0:child:0']) expect(r.phases.find((p) => p.id === id).contribution).toBeGreaterThan(0);
    expect(r.phases.filter((p) => p.grade === 'spam').reduce((s, p) => s + (p.contribution ?? 0), 0)).toBeCloseTo(r.spam, 0);
    expect(r.phases.reduce((s, p) => s + (p.contribution ?? 0), 0)).toBeCloseTo(r.value, 0);
    // a phase's id is what its children name as parent, so the two grades cannot share one: the
    // graph drew `default` twice under the root and hung each grade's children off the other's
    expect(new Set(ids).size).toBe(ids.length);
    expect(r.phases.filter((p) => p.grade === 'stealth' && p.parent && p.parent !== 'primary').every((p) => p.parent.startsWith('stealth:'))).toBe(true);
  });
  // ---- debuffs: unread is not immune, unread is not nothing, and nothing lands nothing --------
  test('an immunity table the miner could not walk is not an immunity', () => {
    const unread = structuredClone(raw);
    unread.npcs['v:4'].immuneUnknown = true;
    const b = bossOf(indexDataset(unread), 1);
    expect(b.immuneAll).toBe(false);
    // …but one it read and that says so still is
    unread.npcs['v:4'].immuneAll = true;
    expect(bossOf(indexDataset(unread), 1).immuneAll).toBe(true);
  });
  test('a debuff with no readable effect is worth a flat allowance for the stage, marked as a guess', () => {
    const r = dps('M:curseGun');
    expect(part(r, /effect unread/)).toBeTruthy();
    const ph = r.phases.find((p) => p.kind === 'debuff');
    expect(ph).toMatchObject({ confidence: 'assumed', buffId: 'M:Curse' });
    expect(ph.contribution).toBeCloseTo(unknownDebuffDps(r.boss.progression) * CALIBRATION, 0); // the boss fought next sets the stage
    expect(unknownDebuffDps(20)).toBeGreaterThan(unknownDebuffDps(0));
    // the allowance stays under a real early DoT
    expect(unknownDebuffDps(0)).toBeLessThan(ds.debuffs['v:24'].dot * 2);
  });
  test('a DoT is only on the boss while the weapon keeps landing', () => {
    // the popgun lands nothing at all: its poison must not be paid either
    const nothing = realDps({ ...ds.byId.get('M:popgun'), shoot: 'M:shortFire' }, ctx());
    expect(nothing.value).toBe(0);
    const some = dps('M:torch'); // ~6 hits/s: the fire is simply on
    expect(part(some, /On Fire!/).label).not.toMatch(/of the time/);
  });
  // ---- the compiler: cooldowns, immunity groups, stances, resources -----------------------------
  test('a proc on a stated cooldown fires at most that often, however fast the shots land', () => {
    const r = dps('M:procGun');
    const every = realDps({ ...ds.byId.get('M:procGun'), tooltip: undefined }, ctx());
    expect(part(r, /boom on hit, at most once per 5 s/)).toBeTruthy();
    expect(r.phases.find((p) => p.kind === 'impact')).toMatchObject({ cooldown: 300, confidence: 'text' });
    expect(r.value).toBeLessThan(every.value);
    // 6 shots a second, all landing, cannot set it off more than once in 5 s
    expect(r.phases.find((p) => p.kind === 'impact').hitsSec).toBeLessThanOrEqual(0.2 * 2 + 1e-6);
  });
  test('the immunity window caps the phases that share it, and leaves a phase with its own clock alone', () => {
    const r = dps('M:twoClocks'); // 12 bolts/s on a 6-tick clock of their own, splinters on the player's window
    const bolt = r.phases.find((p) => p.id === 'default');
    const splinters = r.phases.find((p) => p.kind === 'impact');
    expect(bolt.shared).toBe(false);
    expect(splinters.shared).toBe(true);
    expect(part(r, /share the player's/)).toBeTruthy();
    // the splinters are held to six a second; the bolts are not touched by it
    expect(splinters.hitsSec).toBeLessThanOrEqual(6 + 1e-6);
    expect(bolt.hitsSec).toBeGreaterThan(6);
  });
  test('a sword that fires can also be used from where its shot reaches, and takes the better stance', () => {
    const r = dps('M:starBlade');
    // both stances were graded: in close the blade lands, back at range it does not
    expect(r.parts.some((p) => /stands back/.test(p.label)) || r.phases.find((p) => p.id === 'swing').contribution > 0).toBe(true);
    const inClose = r.distance <= engagement('melee', 'swing');
    if (!inClose) expect(r.phases.find((p) => p.id === 'swing').contribution).toBe(0);
  });
  test('a void weapon spends void the way a mage spends mana, and is its vanilla class underneath', () => {
    const r = dps('M:voidBow');
    expect(part(r, /void\/s against .* regen/)).toBeTruthy();
    expect(part(r, /void\/s/).mul).toBeLessThan(1);
    // a loadout carrying ranged damage counts for it as well as void damage
    const gear = realDps(ds.byId.get('M:voidBow'), ctx({ loadout: { damage: 0.1, crit: 0 }, loadoutFor: (c) => (c === 'ranged' ? { damage: 0.2, crit: 5 } : { damage: 0, crit: 0 }) }));
    expect(part(gear, /void and ranged damage/)).toBeTruthy();
    expect(part(gear, /damage from the standard loadout at this stage/).mul).toBeCloseTo(1.3, 2);
  });
  test('a zero-damage child is a sparkle, not a hit', () => {
    const fx = structuredClone(raw);
    fx.projectiles['M:splitter'].children = [{ type: 'M:pebble', count: 1, where: 'hit', dmgAbs: 0 }];
    const ds2 = indexDataset(fx);
    const r = realDps(ds2.byId.get('M:splitGun'), ctx({ ds: ds2 }));
    expect(part(r, /pebble on hit/)).toBeUndefined();
    expect(r.value).toBeCloseTo(realDps({ ...ds2.byId.get('M:splitGun'), shoot: 'M:fan' }, ctx({ ds: ds2 })).value, 5);
  });
  test('a blast goes off once, but one with a cooldown of its own keeps ticking where it landed', () => {
    // a bomb's splash does not fly through the boss, so it is not charged a crossing time: it is
    // one hit, unless it says it lingers
    const once = dps('M:bomb');
    const cloud = dps('M:flask');
    const extraHits = (r, re) => Number(/\+([\d.]+) hits/.exec(part(r, re).label)[1]);
    expect(extraHits(once, /boom on death/)).toBeCloseTo(1, 5);       // it goes off, once
    // …this one keeps ticking — but it stays where it went off and the boss does not, so only
    // `LINGER_ON_TARGET` of its 6 ticks (180 life ÷ 30 immunity) lands on top of the first hit
    expect(extraHits(cloud, /acid on death/)).toBeCloseTo(1 + LINGER_ON_TARGET * 6, 5);
    expect(extraHits(cloud, /acid on death/)).toBeLessThan(7);        // not the whole window
  });
  test('a child that explodes wide still helps when the parent misses; a pebble does not', () => {
    expect(dps('M:bomb').value).toBeGreaterThan(dps('M:dud').value);
  });
  test('spawned projectiles are capped: the miner cannot read how often they spawn', () => {
    const big = structuredClone(raw);
    big.projectiles['M:bomb'].children = [{ type: 'M:boom', count: 40, where: 'hit', dmgMul: 5 }];
    const huge = indexDataset(big);
    const r = realDps(huge.byId.get('M:bomb'), ctx({ ds: huge }));
    expect(part(r, /capped at/)).toBeTruthy();
    expect(r.value).toBeLessThan(dps('M:bomb').value * (1 + CHILD_CAP) * 2);
  });
  test('a held beam hits on its own immunity clock, not the use time', () => {
    const r = dps('M:drill');
    expect(part(r, /hits\/s in contact/).mul).toBeCloseTo(10, 5); // 60 / 6-tick immunity
    expect(part(r, /of the time on the boss/).mul).toBeCloseTo(ARCHETYPE.held.uptime, 5);
  });
  test('a volley of beams held on the boss is charged the player immunity window once, not twice', () => {
    // Last Prism: six beams with no immunity of their own, held on the target. The window is the
    // *rate* the contact clock charges (6 hits/s), so collapsing the volley to one arrival as well
    // charged it twice and paid the weapon a quarter of the beam it is. What the volley buys instead
    // is bodies to be on and losses it can absorb, both of them in `on the boss at once`.
    const beams = structuredClone(raw);
    beams.projectiles['M:prismBeam'] = { pen: -1, life: 60, walls: true }; // no local: the player's window
    beams.items.push({ id: 'M:prism', mod: 'M', name: 'Prism', slot: 'weapon', class: 'magic', arch: 'held', damage: 20, useTime: 10, useAnimation: 10, crit: 4, mana: 2, shoot: 'M:prismBeam', shootSpeed: 30, channel: true, noMelee: true, useStyle: 5, stage: 0, stageSource: { kind: 'rarity' },
      fire: { calls: [{ type: 'shoot', count: 6, spread: 0.2 }], defaultShot: { spam: false, stealth: false } } });
    const six = indexDataset(beams);
    const one = structuredClone(beams);
    one.items.at(-1).fire.calls[0].count = 1;
    const r = realDps(six.byId.get('M:prism'), ctx({ ds: six }));
    const solo = realDps(indexDataset(one).byId.get('M:prism'), ctx({ ds: indexDataset(one) }));
    expect(part(r, /hits\/s in contact/).mul).toBeCloseTo(6, 5);   // 60 / the 10-tick player window
    expect(part(r, /get through/)).toBeFalsy();                    // the window is charged there, not here
    expect(r.value).toBeGreaterThanOrEqual(solo.value);            // six of them are never worth less than one
    expect(r.value).toBeLessThan(solo.value * 2);                  // …and never six times more: one window
  });
  test('beams a held weapon keeps up hit on their own clocks, not one hit between them', () => {
    // Yharim's Crystal: the prism maintains six beams with a 10-tick cooldown each — 36 hits a
    // second between them, where the unread-cadence rule ("worth at most one extra hit, never
    // `count`") allowed one. A child that expires on its own is a spray and keeps that reading.
    const d = structuredClone(raw);
    d.projectiles['M:crystalBeam'] = { pen: -1, local: 10, width: 18, height: 18, walls: true }; // no life: it lasts as long as the prism
    d.projectiles['M:crystalPrism'] = { pen: -1, held: true, ownAi: true, walls: true, children: [{ type: 'M:crystalBeam', count: 6, where: 'ai', dmgMul: 1 }] };
    d.items.push({ id: 'M:crystal', mod: 'M', name: 'Crystal', slot: 'weapon', class: 'magic', arch: 'held', damage: 65, useTime: 10, useAnimation: 10, crit: 4, mana: 2, shoot: 'M:crystalPrism', shootSpeed: 30, channel: true, noMelee: true, useStyle: 5, stage: 0, stageSource: { kind: 'rarity' } });
    const sprayed = structuredClone(d);
    sprayed.projectiles['M:crystalBeam'].life = 90;
    const beams = indexDataset(d);
    const spray = indexDataset(sprayed);
    const r = realDps(beams.byId.get('M:crystal'), ctx({ ds: beams }));
    const s = realDps(spray.byId.get('M:crystal'), ctx({ ds: spray }));
    expect(part(r, /kept up while the weapon is out, hitting every 10 ticks/)).toBeTruthy();
    expect(r.value).toBeGreaterThan(s.value * 2); // six clocks against one hit between the six
    // …and a beam that charges itself is worth its ramp to the weapon holding it there, and only
    // there: the spray, which is gone before it charges, is not paid for one.
    const charged = structuredClone(d);
    charged.projectiles['M:crystalBeam'].ramp = 2;
    const chargedSpray = structuredClone(sprayed);
    chargedSpray.projectiles['M:crystalBeam'].ramp = 2;
    const c = realDps(indexDataset(charged).byId.get('M:crystal'), ctx({ ds: indexDataset(charged) }));
    const cs = realDps(indexDataset(chargedSpray).byId.get('M:crystal'), ctx({ ds: indexDataset(chargedSpray) }));
    expect(c.value / r.value).toBeCloseTo(2, 0);
    expect(cs.value).toBeCloseTo(s.value, 5);
  });
  test('a piercing beam is not spent on one body of a crowd; a blade in your hands is', () => {
    const crowd = (id) => realDps(ds.byId.get(id), ctx({ targets: 'multi' })).parts.some((p) => /reaches one body/.test(p.label));
    expect(crowd('M:rod')).toBe(false);   // a magic field that pierces lies across the crowd
    expect(crowd('M:drill')).toBe(true);  // the same record, melee: a drill is a point at one of them
    expect(crowd('M:yoyoItem')).toBe(true);
  });
  test('a yoyo out of its range spends less of the fight on the boss', () => {
    const near = realDps(ds.byId.get('M:yoyoItem'), ctx());
    expect(near.arch).toBe('yoyo');
    expect(part(near, /hits\/s in contact/)).toBeTruthy();
  });
  test('a placed projectile is honestly low: the boss is rarely in it', () => {
    const r = dps('M:rod');
    expect(r.arch).toBe('placed');
    expect(part(r, /of the time on the boss/).mul).toBeCloseTo(ARCHETYPE.placed.uptime, 5);
  });
  test('fighting closer than the class wants costs, and costs more the closer it drags you', () => {
    // a graded exposure, not a cliff: a rain cloud you stand on top of pays nearly the whole
    // penalty, a drill held at arm's length pays part of it, and neither pays none
    const rod = part(dps('M:rod'), /fights at .* px of the/).mul;          // magic, 80 px
    const drill = part(dps('M:drill'), /fights at .* px of the/)?.mul ?? 1; // melee, 180 px
    expect(rod).toBeLessThan(1);
    expect(rod).toBeGreaterThanOrEqual(RISK.magic);
    expect(drill).toBeGreaterThan(rod);
  });
  test('a debuff the boss is not immune to adds its DoT; an immune boss adds nothing', () => {
    const fire = dps('M:torch');
    const plain = dps('M:fanGun');
    expect(fire.value).toBeGreaterThan(plain.value);
    expect(part(fire, /On Fire/)).toBeTruthy();
    const immune = dps('M:torch', { stage: 2 }); // the Twins: immunities unread → assumed immune
    expect(part(immune, /is immune/)).toBeTruthy();
    // a debuff the boss's own SetDefaults lists is ignored too
    expect(part(dps('M:pike'), /is immune/)).toBeTruthy();
  });
  test('a defense debuff raises every hit instead', () => {
    expect(dps('M:ichorGun').hit).toBeGreaterThan(dps('M:fanGun').hit);
  });
  test('summons rank by damage per slot × attack rate', () => {
    const r = dps('M:staff');
    expect(r.mode).toBe('minion');
    // 60/20 = 3 hits/s, defense 10, and a minion is not on the boss every second of the fight
    expect(r.value).toBeCloseTo((12 * playerDamage(0) - 5) * 3 * ARCHETYPE.minion.uptime * CALIBRATION, 5);
  });
  test('a rogue weapon is worth the better of its two loops, never their sum, and that loop names the grade', () => {
    const r = dps('M:rogue', { stealthMax: 1 });
    expect(stealthMultiplier(20, 1, 1.5)).toBeGreaterThan(3);
    // stealth does not build while throwing: throw-pause-strike and continuous throwing are two
    // loops the player is in one of, so the value is the better one
    expect(r.value).toBeCloseTo(Math.max(r.spam, r.stealth), 5);
    expect(r.mode).toBe('stealth');
    expect(r.value).toBe(r.stealth);
    // the fill time is the update's own constant (max × gen / 120 a tick): 2 s still, 4 s moving
    expect(part({ parts: r.stealthParts }, /one strike per [\d.]+ s: the bar refills in 2 s standing still, 4 s moving/)).toBeTruthy();
    const low = dps('M:rogue', { stealthMax: 0.05 });
    expect(low.mode).toBe('spam');
    expect(low.value).toBe(low.spam);
    // the loop not taken contributes nothing, so the graph still adds up to the value
    expect(r.phases.filter((p) => p.grade === 'spam').every((p) => p.contribution === 0)).toBe(true);
    expect(r.phases.reduce((s, p) => s + (p.contribution ?? 0), 0)).toBeCloseTo(r.value, 0);
  });
  test('a rogue weapon with no coded stealth branch is still graded', () => {
    const r = dps('M:bomb', { stealthMax: 1 }); // no `fire` at all
    expect(r.mode).toBe('spam'); // the generic strike does not beat spamming it
    expect(r.stealth).toBeGreaterThan(0);
    expect(r.value).toBeCloseTo(r.spam, 5);
  });
  test('the two rogue grades are scored at their own engagement distances', () => {
    const r = dps('M:rogue', { stealthMax: 1 });
    expect(r.distance).toBe(420); // stealth: far
    expect(dps('M:rogue', { stealthMax: 0.05 }).distance).toBe(220); // spam: close
  });
  test('a boomerang comes back', () => {
    expect(dps('M:rang').arch).toBe('boomerang');
    expect(dps('M:pike').arch).toBe('spear');
  });
  test('a weapon that allows several out at once throws that many times as often', () => {
    const one = dps('M:rangSame');
    const three = realDps({ ...ds.byId.get('M:rangSame'), maxOut: 3 }, ctx());
    expect(part(one, /one out at a time/)).toBeTruthy();
    expect(part(three, /3 out at a time/)).toBeTruthy();
    expect(three.value).toBeGreaterThan(one.value);
  });
  test('a boomerang is gone until it returns: the round trip is the rate, not the use time', () => {
    // same damage, same use time, same projectile — only the type differs
    const knife = dps('M:knifeSame');
    const rang = dps('M:rangSame');
    expect(part(rang, /one out at a time/)).toBeTruthy();
    expect(part(knife, /one out at a time/)).toBeUndefined();
    expect(rang.value).toBeLessThan(knife.value);
  });
  test('a boomerang cannot hit past where it turns round, however long its projectile lives', () => {
    // `M:rangProj` lives 600 ticks: read off lifetime alone its reach is thousands of px, and the
    // model was charging the throw a round trip to `THROW_OUT` and then letting it land hits four
    // times further out than that. The same weapon as a knife keeps the long reach.
    const rang = dps('M:rangSame');
    const knife = dps('M:knifeSame');
    expect(part(rang, /reaches \d+ px/)?.mul).toBeLessThan(1);
    expect(part(knife, /reaches \d+ px/)).toBeUndefined();
  });
  test('a stealth strike is graded on the pierce its own AI gives it', () => {
    // Calamity's rogue projectiles re-set `penetrate` on their first tick, as
    // `penetrate = stealthStrike ? 4 : 2`, so the strike's copy is a stronger projectile.
    const item = { ...ds.byId.get('M:rogue'), shoot: 'M:strikePierce', fire: undefined };
    const plain = realDps({ ...item, shoot: 'M:plainPierce' }, ctx({ stealthMax: 1 }));
    const strike = realDps(item, ctx({ stealthMax: 1 }));
    expect(plain.stealth).toBeLessThan(strike.stealth);
    expect(plain.spam).toBeCloseTo(strike.spam, 5); // …and the ordinary throw is untouched
  });
  test('a seeker keeps coming back, so its time on target is its life and not one fly-past', () => {
    const seeking = { pen: 4, local: 10, life: 600, homing: { range: 300 } };
    const straight = { pen: 4, local: 10, life: 600 };
    const opts = { boss: BOSS_DEFAULT, velocity: 10, arch: 'shot', land: 1 };
    expect(hitsPerProjectile(seeking, opts).hits).toBeGreaterThan(hitsPerProjectile(straight, opts).hits);
    expect(hitsPerProjectile(seeking, opts).hits).toBeLessThanOrEqual(4); // its pierce still caps it
  });
  test('every factor is a factor: the parts multiply out to the score they explain', () => {
    // The one rule the model is built on. Three ways it was being broken: a swing part that divided
    // by a 0.01 floor when the weapon fired nothing (a broadsword read `×364`), a debuff that
    // *replaced* the running number with its own DoT instead of adding to it, and a grandchild
    // whose hits went into the total with no part at all.
    const product = (parts) => parts.reduce((a, p) => (p.mul !== undefined ? a * p.mul : p.value), 1);
    for (const id of ['v:sword', 'M:starSword', 'M:rogue', 'M:torch', 'M:rangSame', 'M:shatterBrick', 'M:yoyoItem', 'M:whipItem', 'M:staff']) {
      const r = dps(id, { stealthMax: 1 });
      for (const [grade, parts] of [[r.spam ?? r.value, r.parts], [r.stealth, r.stealthParts]]) {
        if (!(grade > 0) || !parts) continue;
        expect([id, product(parts) / grade]).toEqual([id, expect.closeTo(1, 1)]);
      }
    }
  });
  test('the distance the player is walked to is one the shot can actually cover', () => {
    // `closeIn` and `landing` both answer "how far does this carry", and they were answering it
    // differently — a flat drop tolerance against the boss's half-height, and the stealth strike's
    // throwing speed ignored. The player was placed at the first answer and scored against the
    // second, for a flat ×0 on a weapon that reaches perfectly well.
    const r = dps('M:dropper', { stealthMax: 1 });
    expect(part(r, /reaches \d+ px/)?.mul ?? 1).toBeGreaterThan(0);
    expect(r.spam).toBeGreaterThan(0);
    expect(r.stealth).toBeGreaterThan(0);
  });
  test('a weapon that destroys tiles keeps only a fraction of its DPS', () => {
    // same weapon, same projectile, one of them digs
    const clean = dps('M:randGun');
    const digger = realDps({ ...ds.byId.get('M:randGun'), shoot: 'M:fanDig' }, ctx());
    expect(digger.value).toBeCloseTo(clean.value * TERRAIN_PENALTY, 5);
    expect(part(digger, /destroys tiles/)).toBeTruthy();
    // it counts however deep the digging sits: here it is the blast the bomb spawns on death
    const bomb = realDps({ ...ds.byId.get('M:bomb'), shoot: 'M:digBomb' }, ctx());
    expect(bomb.value).toBeCloseTo(realDps(ds.byId.get('M:bomb'), ctx()).value * TERRAIN_PENALTY, 5);
    // both rogue grades take the same cut, so it never decides between spam and stealth
    const rogue = realDps({ ...ds.byId.get('M:rogue'), shoot: 'M:fanDig' }, ctx());
    const rogueClean = dps('M:rogue');
    expect(rogue.stealth).toBeCloseTo(rogueClean.stealth * TERRAIN_PENALTY, 5);
    expect(rogue.mode).toBe(rogueClean.mode);
  });
  test('the blade swings on the animation, not on the use time', () => {
    // `useTime` only decides how often the item acts inside an animation; a new animation starts as
    // soon as the last ends, so a 40-tick use time on a 20-tick animation halves the star, not the
    // swing (Starfury, Ice Blade, Enchanted Sword and Seashine Sword are all that shape)
    const slow = dps('M:starSword');
    const plain = dps('v:sword'); // same damage and animation, useTime 20
    expect(slow.value).toBeCloseTo(plain.value, 5);
    expect(part(slow, /contact swing every 20 ticks/)).toBeTruthy();
  });
  test('a whip is swung at the boss, not thrown at it', () => {
    const r = dps('M:whipItem');
    expect(r.arch).toBe('whip');
    expect(part(r, /px\/tick over/)).toBeUndefined(); // 4 px/tick is how fast it extends, not a flight
    expect(part(r, /reaches /)).toBeUndefined();
  });
  test('a summoner weapon is tagged by the slot it fills, not ranked against the other slots', () => {
    // a summoner wears a whip *and* minions *and* a sentry, so the tag says which of the three it is
    expect(dps('M:whipItem').mode).toBe('whip');
    expect(dps('M:staff').mode).toBe('minion');
    expect(dps('v:sword').mode).toBe(null); // melee has no slots to tell apart
  });
  test("a whip's tag is what the minions carry, so it adds instead of multiplying", () => {
    const plain = part(dps('M:whipItem'), /summon tag/).mul;
    const spray = part(dps('M:sprayWhip'), /summon tag/).mul;
    expect(plain).toBeCloseTo(1 + ARCHETYPE.whip.tag / 2, 1); // 2 lashes/s, one hit each
    // eight extra projectiles do not make the mark eight times as good — and since the lash sets no
    // immunity of its own, the eight arrive inside one window on the body and add nothing at all
    expect(spray).toBeLessThanOrEqual(plain);
  });
  test('a launch speed too slow to be one is treated as unread', () => {
    // 0.1 or 1 px/tick is a projectile whose AI takes over, not a cruising speed
    expect(dps('M:crawler').value).toBeCloseTo(realDps({ ...ds.byId.get('M:crawler'), shootSpeed: SHOOT_SPEED_UNKNOWN }, ctx()).value, 5);
    expect(SHOOT_SPEED_MIN).toBeLessThan(SHOOT_SPEED_UNKNOWN);
  });
  test('a damage multiplier too large to be one is dropped, not paid', () => {
    // Wyvern's Call's ×15 is the one branch in ten that fires a wyvern; the linear machine hands it
    // to the feather, so above the ceiling the child does the weapon's damage
    const r = dps('M:mulGun');
    expect(part(r, /pebble on hit/).label).toContain('at 100%');
    expect(DMG_MUL_MAX).toBeGreaterThan(1);
  });
  test('a contact projectile that hits once per NPC ever is on the weapon’s clock, not its own', () => {
    // `localNPCHitCooldown = -1` is "once, ever" — a new one has to be made before the next hit, so
    // a slow blade held in the boss is a slow blade, not six hits a second
    const once = structuredClone(raw);
    once.projectiles['M:cloud'] = { ...once.projectiles['M:cloud'], local: -1 };
    const ds2 = indexDataset(once);
    const r = realDps(ds2.byId.get('M:rod'), ctx({ ds: ds2 }));
    expect(part(r, /hits\/s in contact/)).toBeUndefined();
    expect(part(r, /every .* ticks/)).toBeTruthy();
    expect(r.value).toBeLessThan(dps('M:rod').value);
  });
  test('being dragged in closer than the class wants costs, melee included', () => {
    const near = part(dps('M:rod'), /fights at .* px of the/);        // placed: 80 px of magic's 340
    expect(near.mul).toBeLessThan(1);
    expect(near.mul).toBeGreaterThan(RISK.magic);                     // not the whole penalty: it is a share
    // melee is not exempt: a sword at contact range pays where a yoyo on its string does not
    const sword = part(dps('v:sword'), /fights at .* px of the/);
    const yoyo = part(dps('M:yoyoItem'), /fights at .* px of the/);
    expect(sword.mul).toBeLessThan(1);
    expect(yoyo).toBeUndefined();                                     // 300 px of reach, 260 px wanted
    expect(RISK.melee).toBeLessThan(1);
  });
  test('the two clicks are two attacks: the weapon is worth its better one, not their sum', () => {
    const r = dps('M:altBetter');
    // the left click's projectile dies after 4 ticks and reaches nothing; the right one is the weapon
    const rightOnly = realDps({ ...ds.byId.get('M:altBetter'), fire: { calls: [{ type: 'M:fan' }], defaultShot: { spam: false, stealth: false } } }, ctx());
    expect(part(r, /right click: the better/)).toBeTruthy();
    expect(r.value).toBeCloseTo(rightOnly.value, 5);
  });
  test('what one click stocks is the other click’s ammunition, not damage now', () => {
    const r = dps('M:twoClick');
    expect(part(r, /pebble is stocked for the other click/i)).toBeTruthy();
    expect(part(r, /pebble on hit/)).toBeUndefined();
    // …and without the right click there is nothing to stock it for, so it counts as a hit again
    const oneClick = realDps({ ...ds.byId.get('M:twoClick'), fire: { calls: [{ type: 'shoot' }], defaultShot: { spam: false, stealth: false } } }, ctx());
    expect(part(oneClick, /pebble on hit/)).toBeTruthy();
    expect(oneClick.value).toBeGreaterThan(r.value);
  });
  test('every weapon type says how it delivers its damage', () => {
    // the model branches on nothing else, so a type the miner can emit and the table cannot
    // describe would silently fall back to "fires once per use"
    for (const a of ['swing', 'shortsword', 'specialsword', 'spear', 'yoyo', 'flail', 'boomerang',
      'bow', 'repeater', 'gun', 'launcher', 'flamethrower', 'shot', 'held', 'truemelee', 'placed',
      'minion', 'sentry', 'whip', 'dagger', 'bomb', 'javelin', 'spikyball']) {
      expect(ARCHETYPE[a]).toBeDefined();
      expect(['use', 'flight', 'contact', 'slot']).toContain(ARCHETYPE[a].cycle);
    }
  });
});

describe('damage provenance', () => {
  // the whole-shot term ModifyShootStats writes and the share a Shoot call takes of the argument it
  // is handed multiply: Astral's End is 1.5 on the shot and 0.667 on each call, ×1.0 in play.
  // Against a target with no defense, so the shares stay the whole story (defense comes off each
  // phase's own damage, see 'phase damage')
  const DUMMY = { ...BOSS_DEFAULT, defense: 0, name: 'Dummy', progression: 0, still: true };
  const fanGun = ds.byId.get('M:fanGun');
  const withFire = (fire) => realDps({ ...fanGun, fire: { ...fanGun.fire, ...fire } }, ctx({ boss: DUMMY }));
  const call = (extra) => [{ type: 'shoot', count: 3, spread: 0.5, fan: true, ...extra }];
  test('ModifyShootStats ×1.5 and a Shoot call at ×0.667 compose to ×1.0, not to the call alone', () => {
    const plain = withFire({});
    expect(withFire({ dmgMul: 1.5, calls: call({ dmgMul: 0.667 }) }).value / plain.value).toBeCloseTo(1, 1);
    expect(withFire({ calls: call({ dmgMul: 0.667 }) }).value / plain.value).toBeCloseTo(0.667, 1);
    expect(withFire({ dmgMul: 1.5 }).value / plain.value).toBeCloseTo(1.5, 1);
  });
  test('an absolute call damage stays that number, as a share of the printed damage', () => {
    expect(withFire({ calls: call({ dmgAbs: 5 }) }).value).toBeCloseTo(withFire({ calls: call({ dmgMul: 0.5 }) }).value, 1);
    // …past the multiplier ceiling it is evidence of something else, and the printed damage stands
    expect(withFire({ calls: call({ dmgAbs: 500 }) }).value).toBeCloseTo(withFire({}).value, 1);
  });
  test('a holdout spawned at 0 damage is a carrier: an unread delivery, not a zero', () => {
    const r = withFire({ calls: call({ dmgAbs: 0 }) });
    expect(r.value).toBeCloseTo(withFire({}).value, 1);
    expect(part(r, /carrier whose shots the miner did not read/)).toBeTruthy();
    expect(r.phases.find((p) => p.id === 'call:0').evidence).toMatchObject({ carrier: true, gates: { damage: 'assumed' } });
  });
  test('the whole-shot term reaches the default shot and not the blade', () => {
    // a slow sword whose shot only just outreaches its (enlarged) blade, so there is one stance and
    // the two clocks stay under the shared immunity window together
    const sword = { ...ds.byId.get('v:sword'), useTime: 40, useAnimation: 40, shoot: 'M:midrange', shootSpeed: 12, scale: 2.5 };
    const a = realDps(sword, ctx({ boss: DUMMY }));
    const b = realDps({ ...sword, fire: { dmgMul: 2 } }, ctx({ boss: DUMMY }));
    const of = (r, id) => r.phases.find((p) => p.id === id).contribution;
    expect(of(a, 'default')).toBeGreaterThan(0);
    expect(of(b, 'default') / of(a, 'default')).toBeCloseTo(2, 1);
    expect(of(b, 'swing')).toBeCloseTo(of(a, 'swing'), 0);
  });
  test('the stealth cut is applied once, on the strike\'s deliveries', () => {
    const rogue = ds.byId.get('M:rogue');
    const cut = realDps(rogue, ctx({ boss: DUMMY }));
    const flat = realDps({ ...rogue, fire: { ...rogue.fire, stealthMods: {} } }, ctx({ boss: DUMMY }));
    expect(cut.stealth / flat.stealth).toBeCloseTo(1.5, 1);
    expect(cut.stealthParts.filter((p) => /150% damage/.test(p.label))).toHaveLength(1);
    // …and a strike with no cut of its own takes the ordinary whole-shot term instead
    const shot = realDps({ ...rogue, fire: { ...rogue.fire, stealthMods: {}, dmgMul: 2 } }, ctx({ boss: DUMMY }));
    expect(shot.stealth / flat.stealth).toBeCloseTo(2, 1);
    // Calamity's StealthDamageMultiplier property and the branch it is applied in are one number
    // read two ways: a weapon carrying both (Spadefish: 2 and 2) is ×2, not ×4
    const both = realDps({ ...rogue, fire: { ...rogue.fire, stealthMods: { dmgMul: 2 }, stealthMult: 2 } }, ctx({ boss: DUMMY }));
    expect(both.stealth / flat.stealth).toBeCloseTo(2, 1);
    // …and the property alone stands in for the branch the machine did not read
    const prop = realDps({ ...rogue, fire: { ...rogue.fire, stealthMods: {}, stealthMult: 2 } }, ctx({ boss: DUMMY }));
    expect(prop.stealth / flat.stealth).toBeCloseTo(2, 1);
  });
  test('a child is worth its share of the projectile that spawned it, not of the weapon', () => {
    const gun = ds.byId.get('M:splitGun');
    const full = realDps(gun, ctx({ boss: DUMMY }));
    const half = realDps({ ...gun, fire: { calls: [{ type: 'shoot', dmgMul: 0.5 }], defaultShot: { spam: false, stealth: false } } }, ctx({ boss: DUMMY }));
    const kid = (r) => r.phases.filter((p) => p.kind === 'impact').reduce((s, p) => s + p.contribution, 0);
    expect(kid(full)).toBeGreaterThan(0);
    expect(kid(half) / kid(full)).toBeCloseTo(0.5, 1);
  });
});

describe('mined gates', () => {
  const fanGun = ds.byId.get('M:fanGun');
  const withCalls = (calls, extra = {}) => realDps({ ...fanGun, fire: { calls, defaultShot: { spam: false, stealth: false } }, ...extra }, ctx());
  const shot = (extra) => ({ type: 'shoot', count: 3, spread: 0.5, fan: true, ...extra });
  test('a counter in Shoot: the arm that fires every Nth use and the arm that fires the rest add up to one shot', () => {
    const plain = withCalls([shot()]).value;
    const nth = withCalls([shot({ threshold: { n: 4, event: 'use', reset: true, reached: true } })]);
    const rest = withCalls([shot({ threshold: { n: 4, event: 'use', reset: true, reached: false } })]);
    expect(nth.value / plain).toBeCloseTo(0.25, 1);
    expect(rest.value / plain).toBeCloseTo(0.75, 1);
    expect(part(nth, /every 4th use/)).toBeTruthy();
    // priced, so it is a concurrent shot in the top region, not an alternative to be averaged
    expect(nth.phases.find((p) => p.id === 'call:0')).toMatchObject({ region: 'top', relation: 'concurrent', evidence: { gates: { threshold: 'exact' } } });
  });
  test('a hit-charged alternate attack pays for its release use as well as the hits that armed it', () => {
    const plain = withCalls([shot({ alt: true })]).value;
    const charged = withCalls([shot({ alt: true, threshold: { n: 3, event: 'hit', reset: true, reached: true } })]);
    // Three normal hits fill the charge and a fourth action spends it. This is distinct from a
    // modulo branch that fires automatically on every third use.
    expect(charged.value / plain).toBeCloseTo(1 / 4, 1);
    expect(part(charged, /successful hits, release costs one more use/)).toBeTruthy();
  });
  test('a zero-velocity custom delivery cannot earn free-flight infinite-pierce hits', () => {
    const p = { pen: -1, local: 20, life: 600 };
    const free = hitsPerProjectile(p, { boss: boss(ds, 1), velocity: 12, arch: 'shot' });
    const anchored = hitsPerProjectile(p, { boss: boss(ds, 1), velocity: 0, arch: 'shot' });
    expect(free.hits).toBeGreaterThan(1);
    expect(anchored.hits).toBe(1);
    expect(anchored.label).toMatch(/zero velocity/);
  });
  test('a requirement the loadout cannot meet is a shot that does not happen; the arm without it is the ordinary one', () => {
    const plain = withCalls([shot()]).value;
    const needs = withCalls([shot({ requires: { what: 'ammo', id: 'special', negated: false } })]);
    const without = withCalls([shot({ requires: { what: 'ammo', id: 'special', negated: true } })]);
    expect(needs.value).toBe(0);
    expect(part(needs, /needs special ammo the loadout does not carry/)).toBeTruthy();
    expect(needs.phases.find((p) => p.id === 'call:0').evidence.gates.requires).toBe('unmet');
    expect(without.value).toBeCloseTo(plain, 1);
  });
  test('an unread if/else names itself and is worth its weaker arm; a one-sided guard keeps its shot', () => {
    const a = shot({ spread: 0, branch: { id: 40, side: true, cond: 'X.mystery' } });
    const b = shot({ count: 1, branch: { id: 40, side: false, cond: 'X.mystery' } });
    const r = withCalls([a, b]);
    const ph = r.phases.filter((p) => p.kind === 'travel');
    expect(ph.map((p) => p.region)).toEqual(['branch:40', 'branch:40']);
    expect(ph.every((p) => p.relation === 'alternative' && p.evidence.gates.branch === 'assumed')).toBe(true);
    expect(part(r, /if\/else nobody read \(branch 40\): the weaker arm/)).toBeTruthy();
    expect(r.value).toBeCloseTo(withCalls([shot({ count: 1 })]).value, 1);
    // the arm not taken contributes nothing, so the graph still adds up to the score. Which of the
    // two is the weaker one is a tie here now that a volley collapses into one arrival — three
    // shots and one land the same on a single body — so the invariant is that exactly one is unused
    expect(ph.filter((p) => p.contribution === 0)).toHaveLength(1);
    expect(r.phases.reduce((s, p) => s + (p.contribution ?? 0), 0)).toBeCloseTo(r.value, 0);
    expect(withCalls([a]).value).toBeCloseTo(withCalls([shot({ spread: 0 })]).value, 1);
    // a guard that always holds with two arms is a mirror (facing left / facing right): one shot
    const l = shot({ count: 1, branch: { id: 7, side: true, cond: 'Entity.direction', known: true } });
    const rr = shot({ count: 1, branch: { id: 7, side: false, cond: 'Entity.direction', known: true } });
    const m = withCalls([l, rr]);
    expect(m.value).toBeCloseTo(withCalls([shot({ count: 1 })]).value, 1);
    expect(part(m, /mirrored if\/else/)).toBeTruthy();
    expect(m.phases.find((p) => p.id === 'call:0').evidence.gates.branch).toBe('exact');
  });
  test('a child on a clock the miner read is spawned once per tick of it while the parent is there', () => {
    // a held carrier whose AI fires a fan every 10 ticks; the weapon is used every 10 ticks
    // the shots carry a hit cooldown of their own, so the player's immunity window does not cap them
    const hold = (child) => ({ ...raw, projectiles: { ...raw.projectiles, 'M:tick': { ...raw.projectiles['M:fan'], local: 10 }, 'M:hold': { held: true, life: 600, children: [{ type: 'M:tick', count: 1, where: 'ai', dmgMul: 1, ...child }] } } });
    const with10 = hold({ threshold: { n: 10, event: 'tick', reset: true, reached: true } });
    const with5 = hold({ threshold: { n: 5, event: 'tick', reset: true, reached: true } });
    const unread = hold({});
    const item = { ...fanGun, shoot: 'M:hold', fire: { calls: [{ type: 'M:hold', dmgAbs: 0 }], defaultShot: { spam: false, stealth: false } } };
    const grade = (d) => realDps(item, { ...ctx(), ds: indexDataset(d) });
    const kid = (r) => r.phases.filter((p) => p.kind === 'split').reduce((s, p) => s + p.contribution, 0);
    expect(kid(grade(with5)) / kid(grade(with10))).toBeCloseTo(2, 0);
    // one spawn per use is exactly what the unread rule already assumed; two is what the clock buys
    expect(kid(grade(with10))).toBeCloseTo(kid(grade(unread)), 1);
    expect(kid(grade(with5))).toBeGreaterThan(kid(grade(unread)));
    expect(part(grade(with10), /every 10 ticks \(1 per use\)/)).toBeTruthy();
    expect(grade(with10).phases.find((p) => p.kind === 'split').evidence.gates.cadence).toBe('exact');
    // …a transition without a reset is the old "at most one" rule, and a counter in OnHitNPC is a hit counter
    const once = hold({ threshold: { n: 10, event: 'tick', reset: false, reached: true } });
    expect(kid(grade(once))).toBeCloseTo(kid(grade(unread)), 1);
  });
  test('a child only on a crit is worth the crit chance of itself', () => {
    const gun = ds.byId.get('M:splitGun');
    const crit = { ...raw, projectiles: { ...raw.projectiles, 'M:splitter': { pen: 1, life: 600, children: [{ type: 'M:pebble', count: 1, where: 'hit', dmgMul: 1, crit: true }] } } };
    const kid = (r) => r.phases.filter((p) => p.kind === 'impact').reduce((s, p) => s + p.contribution, 0);
    const full = realDps(gun, { ...ctx(), loadout: { damage: 0, crit: 20 } });
    const onCrit = realDps(gun, { ...ctx(), ds: indexDataset(crit), loadout: { damage: 0, crit: 20 } });
    expect(kid(onCrit) / kid(full)).toBeCloseTo(0.2, 1);
  });
});

describe('phase damage', () => {
  const DUMMY = { ...BOSS_DEFAULT, defense: 0, name: 'Dummy', progression: 0, still: true };
  const ARMOURED = { ...BOSS_DEFAULT, defense: 10, name: 'Armoured', progression: 0 };
  const kidOf = (r, kind = 'impact') => r.phases.filter((p) => p.kind === kind);
  test('defense comes off each phase\'s own damage: a 30% child against armour is not 30% of the hit', () => {
    // 10 damage, a child at 30%: 3 raw against defense 10 is the 1-damage floor, not 0.3 × (10 − 5)
    expect(hitDamage(3, ARMOURED)).toBe(1);
    expect(hitDamage(3, ARMOURED)).toBeLessThan(0.3 * hitDamage(10, ARMOURED));
    const weak = { ...raw, projectiles: { ...raw.projectiles, 'M:splitter': { pen: 1, life: 600, children: [{ type: 'M:pebble', count: 1, where: 'hit', dmgMul: 0.3 }] } } };
    const gun = ds.byId.get('M:splitGun');
    const r = realDps(gun, { ...ctx(), ds: indexDataset(weak), boss: ARMOURED });
    const [kid] = kidOf(r);
    expect(kid.share).toBeCloseTo(0.3, 2);
    expect(kid.hitDmg).toBe(1);
    expect(kid.contribution).toBeCloseTo(kid.eventsSec * 1 * r.critMult * CALIBRATION, 0);
    expect(part(r, /defense taken off each phase's own damage/)?.mul).toBeLessThan(1);
    // …and against nothing, the share is the whole story and the correction part does not appear
    const flat = realDps(gun, { ...ctx(), ds: indexDataset(weak), boss: DUMMY });
    expect(part(flat, /defense taken off each phase/)).toBeUndefined();
    expect(flat.phases.reduce((s, p) => s + (p.contribution ?? 0), 0)).toBeCloseTo(flat.value, 0);
    expect(r.phases.reduce((s, p) => s + (p.contribution ?? 0), 0)).toBeCloseTo(r.value, 0);
  });
  test('the immunity window caps hit events, not damage-weighted hits', () => {
    // three shots at ×3 damage are three hits on the clock, the same three as at ×1
    const fanGun = ds.byId.get('M:fanGun');
    // fast enough to reach the cap: it is a *rate* limit, and a three-shot volley on its own now
    // collapses into one arrival before it ever gets there (they share the player's window)
    const withMul = (dmgMul) => realDps({ ...fanGun, useTime: 6, useAnimation: 6, fire: { calls: [{ type: 'shoot', count: 3, spread: 0, dmgMul }], defaultShot: { spam: false, stealth: false } } }, ctx({ boss: DUMMY }));
    const one = withMul(1);
    const three = withMul(3);
    expect(part(one, /share the player's 10-tick immunity window/)).toBeTruthy();
    expect(three.value / one.value).toBeCloseTo(3, 1);
    expect(three.phases.find((p) => p.id === 'call:0').eventsSec).toBeCloseTo(one.phases.find((p) => p.id === 'call:0').eventsSec, 3);
  });
  test('a volley sharing one immunity window lands once, unless it is spread out in time', () => {
    const gun = ds.byId.get('M:fanGun');
    const volley = (extra) => realDps({ ...gun, shoot: 'M:sharedFan', fire: { calls: [{ type: 'shoot', count: 5, ...extra }], defaultShot: { spam: false, stealth: false } } }, ctx({ boss: DUMMY }));
    // fired in one instant (a spread says so): the first to arrive shuts the window on the other four
    const fan = volley({ spread: 0.05, fan: true });
    expect(part(fan, /one immunity window shared by every one of them/)).toBeTruthy();
    // …while the same five with a window of their own each keep their five arrivals
    const own = realDps({ ...gun, shoot: 'M:fan2', fire: { calls: [{ type: 'shoot', count: 5, spread: 0.05, fan: true }] } }, { ...ctx({ boss: DUMMY }), ds: indexDataset({ ...raw, projectiles: { ...raw.projectiles, 'M:fan2': { pen: 1, life: 600, local: 10 } } }) });
    expect(part(own, /immunity window shared/)).toBeUndefined();
    expect(own.value).toBeGreaterThan(fan.value);
    // …and a group with no spread is not one volley: Blood Bath's beams rain down one after another
    expect(part(volley({}), /immunity window shared/)).toBeUndefined();
  });
  test('a projectile\'s own armour penetration reaches only its own hits, and the loadout\'s reaches all of them', () => {
    const gun = ds.byId.get('M:splitGun');
    const pierce = { ...raw, projectiles: { ...raw.projectiles, 'M:pebble': { ...raw.projectiles['M:pebble'], armorPen: 10 } } };
    const plain = realDps(gun, { ...ctx(), boss: ARMOURED });
    const kidPen = realDps(gun, { ...ctx(), ds: indexDataset(pierce), boss: ARMOURED });
    expect(kidOf(kidPen)[0].hitDmg).toBeGreaterThan(kidOf(plain)[0].hitDmg);
    expect(kidPen.phases.find((p) => p.id === 'default').hitDmg).toBeCloseTo(plain.phases.find((p) => p.id === 'default').hitDmg, 3);
    const worn = realDps(gun, { ...ctx(), boss: ARMOURED, loadout: { damage: 0, crit: 0, armorPen: 10 } });
    expect(worn.phases.find((p) => p.id === 'default').hitDmg).toBeGreaterThan(plain.phases.find((p) => p.id === 'default').hitDmg);
    expect(worn.value).toBeGreaterThan(plain.value);
  });
  test('a debuff is kept up by the phase that applies it, and a debuff only a child carries is seen', () => {
    const gun = ds.byId.get('M:splitGun');
    const DUMMY = { ...BOSS_DEFAULT, defense: 0, name: 'Dummy', progression: 0, immuneAll: false, immune: new Set() };
    const burning = (chance) => ({ ...raw, projectiles: { ...raw.projectiles, 'M:ember': { pen: 1, width: 8, life: 5, debuffs: ['v:24'] }, 'M:splitter': { pen: 1, life: 600, children: [{ type: 'M:ember', count: 1, where: 'hit', dmgMul: 1, ...(chance ? { chance } : {}) }] } } });
    const always = realDps(gun, { ...ctx(), ds: indexDataset(burning(null)), boss: DUMMY });
    const rare = realDps(gun, { ...ctx(), ds: indexDataset(burning(0.05)), boss: DUMMY });
    const fire = (r) => r.phases.find((p) => p.kind === 'debuff' && p.buffId === 'v:24');
    expect(fire(always).contribution).toBeCloseTo(4 * CALIBRATION, 0);
    expect(fire(rare).contribution).toBeLessThan(4);
    expect(fire(rare).contribution).toBeGreaterThan(0);
    expect(part(rare, /kept up \d+% of the time by the phases that apply it/)).toBeTruthy();
    expect(rare.phases.reduce((s, p) => s + (p.contribution ?? 0), 0)).toBeCloseTo(rare.value, 0);
    // …and it hangs off that phase, not off the use clock: use → ember → burning
    const ember = always.phases.find((p) => p.projId === 'M:ember');
    expect(fire(always).parent).toBe(ember.id);
    expect(always.phases.find((p) => p.id === ember.parent).projId).toBe('M:splitter');
  });
  test('a minion whose AI clock was read fires on that clock', () => {
    const staff = ds.byId.get('M:staff');
    const shooter = (threshold) => ({ ...raw, projectiles: { ...raw.projectiles, 'M:minion': { minion: true, slots: 1, local: 20, children: [{ type: 'M:fan', count: 1, where: 'ai', dmgMul: 1, ...(threshold ? { threshold } : {}) }] } } });
    const unread = realDps(staff, { ...ctx(), ds: indexDataset(shooter(null)), boss: DUMMY });
    const read = realDps(staff, { ...ctx(), ds: indexDataset(shooter({ n: 10, event: 'tick', reset: true, reached: true })), boss: DUMMY });
    expect(part(read, /every 10 ticks \(6 per use\)/)).toBeTruthy();
    expect(read.value).toBeGreaterThan(unread.value);
  });
  test('the terrain penalty reaches every phase, so the graph still adds up', () => {
    const r = realDps({ ...ds.byId.get('M:bomb'), shoot: 'M:digBomb' }, ctx());
    expect(part(r, /destroys tiles/)).toBeTruthy();
    expect(r.phases.reduce((s, p) => s + (p.contribution ?? 0), 0)).toBeCloseTo(r.value, 0);
  });
});

describe('vanilla ammo swap', () => {
  test('a bow that turns the plain ammo into its own projectile is graded with that projectile', () => {
    // a gun whose musket balls become fire shots: the fire is the shot the model sees
    const gun = ds.byId.get('v:gun');
    const swapped = realDps({ ...gun, ammoSwap: { from: 'v:14p', to: 'M:fire' } }, ctx());
    const plain = realDps(gun, ctx());
    expect(swapped.phases.find((p) => p.id === 'default').projId).toBe('M:fire');
    expect(swapped.phases.some((p) => p.kind === 'debuff' && p.buffId === 'v:24')).toBe(true);
    expect(plain.phases.some((p) => p.kind === 'debuff')).toBe(false);
    // …and only the ammo it names: other ammo fires as itself
    const other = realDps({ ...gun, ammoSwap: { from: 'v:arrow', to: 'M:fire' } }, ctx());
    expect(other.phases.find((p) => p.id === 'default').projId).toBe('v:14p');
  });
});
