# Real DPS, projectile mining and guide verification — design

Date: 2026-09-02. Extends the 2026-09-01 design.

## Problem

Weapons rank by `damage × rate × (1 + crit)`. That ignores everything that decides whether a
shot lands and how often it hits: projectile count and spread, velocity and gravity, homing,
pierce, wall pierce, mana sustain, minion attack rates and Calamity's stealth strikes. The
guides grade rogue weapons as *Spam* or *Stealth*; the lab must too. Separately, a stage bug
(vanilla crafting-station tile ids colliding with item ids) hid whole armor sets.

## Mined data (miner)

### Projectiles — `miner/extract/projectiles.js`

For every `ModProjectile` (and vanilla `Projectile.SetDefaults1/2` via the case tracker):

| field | source |
| --- | --- |
| `pen` | `penetrate` (−1 = infinite) |
| `tile` | `tileCollide` (false → wall pierce), also `tileCollide = false` stores in AI |
| `updates` | `extraUpdates` (+ `MaxUpdates`) |
| `ai`, `aiType` | `aiStyle`, `AIType` (vanilla AI copied) |
| `life` | `timeLeft` |
| `local` | `usesLocalNPCImmunity` → `localNPCHitCooldown`; `usesIDStaticNPCImmunity` → `idStaticNPCHitCooldown` |
| `minion`, `sentry`, `slots` | `minion`, `sentry`, `minionSlots` |
| `gravity` | `velocity.Y += k` (k > 0) in AI, or vanilla aiStyle in {2, 5, 8, 10, 14, 16, 25} or aiStyle 1 with `arrow` |
| `homing` | a call in AI whose name matches `/Hom|Closest|Nearest|FindTarget|Seek|Track|CanBeChasedBy/` or a curated vanilla list |
| `children` | `NewProjectile*` calls in AI / OnKill / Kill / OnHitNPC → `{ type, count, where }` |
| `debuffs` | `NPC.AddBuff(type)` in OnHitNPC |
| `stealth` | reads of Calamity's `stealthStrike` flag anywhere in the type |

### Weapons — `miner/extract/shoot.js`

Extra `SetDefaults` fields: `shoot`, `shootSpeed`, `useAmmo`, `channel`, `autoReuse`,
`noMelee`, `useStyle`, `ammo` (for ammo items). `Shoot` / `ModifyShootStats` are run with the
linear machine and symbolic arguments (`velocity` = vector with multiplier/spread,
`damage` = adjustable, `type` = the item's `shoot`):

- every `NewProjectile` records type, damage multiplier, velocity multiplier, spread (from
  `RotatedBy`, `RotatedByRandom`, `ToRadians`, `NextFloat`, `Lerp`), and the loop it sits in;
- loops: backward conditional branches (new `onBackJump` machine hook) give the iteration
  count from the compared bound (number, random range → mean, unknown → 2);
- Calamity stealth: `StealthStrikeAvailable()` guards (direct or via a local) split calls into
  the *spam* and *stealth* variants; `RogueWeapon.StealthDamageMultiplier` is read;
- `ret true` means the default shot fires too.

Vanilla: `Player.ItemCheck_Shoot` walked with the case tracker keyed on `sItem.type`.

Ammo items become a dataset list `ammo: [{ id, name, kind (AmmoID), damage, shoot, stage }]`.

## Real DPS (site) — `src/lib/dps.js`

```
hit      = effective damage (+ best ammo damage at the stage for useAmmo weapons)
rate     = shots per second: n / (useAnimation + reuseDelay) × 60, n = round(useAnimation / useTime)
           true melee swings: 60 / useAnimation
crit     = 1 + crit/100                     (summon: 1)
count    = projectiles per use (+ children × weight: kill 1, hit 0.7, ai 0.5)
accuracy = spread × velocity × gravity × range
           spread:   1 if ≤ 0.14 rad, else 0.14 / spread   (homing → 1)
           velocity: clamp(v / 10, 0.55, 1), v = shootSpeed × mul × (1 + updates)  (homing ≥ 0.9)
           gravity:  0.85 unless homing
           range:    0.8 for true melee (contact only)
pierce   = ∞ → 1.35; n > 1 → 1 + 0.08 × min(n − 1, 4)
walls    = 1.05 when the projectile ignores tiles
debuffs  = 1 + 0.03 × n (max 1.1)
sustain  = magic: clamp(25 / (mana × rate), 0.5, 1)
summon   = damage × hits/s ÷ minion slots, hits/s = 60 / local cooldown (cap 6) else 2 (contact), 1.5 × children (ranged)
```

`value = hit × rate × crit × count × accuracy × pierce × walls × debuffs × sustain`, reported as a
list of labelled factors.

Rogue (Calamity): the stealth variant is scored separately —
`stealthMult = 1 + S × 0.42 × (0.75 + 0.75 × log4(max(useTime, useAnimation) + 2)) × 3.54 × weaponMult`,
`S` = max stealth from the chosen armor (default 0.5). Stealth DPS = stealth hit × count ×
accuracy ÷ 6 s recharge. The weapon's mode is whichever is higher; both are shown.

## Guide verification — `tools/guide-check.mjs`

Fetches the raw wikitext of the Calamity class setups (Cargo table `ClassSetups`) and the
Infernal Eclipse of Ragnarok guide templates, caches them under `data/guides/`, maps every
recommended weapon / armor / accessory to a dataset item by name, and reports per tier and
class: items missing from the dataset, items staged later than the tier, and the rank the lab
gives them. Tiers map to the stage just before the named boss.

## Out of scope

Damage-over-time numbers per debuff, minion AI attack timers, Thorium inspiration costs, bard
empowerments, exact hit geometry per boss.
