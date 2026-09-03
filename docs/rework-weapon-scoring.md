# Weapon scoring rework — plan

Date: 2026-09-03. Extends `docs/superpowers/specs/2026-09-02-real-dps-design.md`.

## Goal

Real DPS (`src/lib/dps.js`) should rank weapons the way the class-setup guides do, because the
model understands how a weapon actually works — not because any item was pinned. Two rules:

1. **No per-item overrides.** Every change lands in the miner or the model and applies to every
   weapon that shares the trait. If a guide pick ranks badly, the job is to find *which factor*
   is wrong for that kind of weapon and fix it there. A guide pick that stays low after that is
   either a staging lead or an honest disagreement; both are written down, not patched.
2. **Every factor stays explainable.** The `parts` contract (`{ label, mul | value }`) that
   `ItemCard` / `ScoreParts` render is kept; new factors are new parts, with the numbers behind
   them in the label.

Scoring stays pessimistic (see `memory: scoring-realism`): when the miner cannot read a
detail, the model assumes the worse case, and a number that looks too good is a miner lead
first.

## Baseline (2026-09-03, `node tools/guide-check.mjs`)

| metric | today |
| --- | --- |
| guide weapon picks (5 pre-hardmode tiers, both guides) | 572 |
| lab ranks the pick in its top 3 / top 8 | 18 / 64 |
| stealth-vs-spam grade agrees with the guide | 20 / 26 |
| picks staged later than the guide's tier | 72 |

Target after the rework: top-3 ≥ 150, top-8 ≥ 300 on the same picks, and no class whose top 5
at any pre-hardmode tier is empty of guide picks.

## What the probe showed (why the numbers are what they are)

Systemic problems found by printing `realDps(...).parts` for ~40 guide picks and the lab's top
8 per class at stages 0 and 4:

| symptom | cause | fix lives in |
| --- | --- | --- |
| Every gun fires Holy Fire Bullets pre-boss; every bow Elysian Arrows | ammo items are not staged (`ammo[].stage` is always 0); `bestAmmo` takes the highest damage | miner (stage ammo like items) |
| Bombs (Ashen Stalactite, Metal Monstrosity, Throwing Brick) top rogue pre-boss | child projectiles add up to +2 hits at ×3 with no damage read for the child; `kill` children weighted 0.6 regardless of what reached the boss | miner (child damage) + model |
| Spears pay "velocity 6 ×0.6"; Amazon/Wooden Yoyo have no projectile; drills count "8 shots per animation" | no weapon archetype: spear / yoyo / flail / boomerang / held beam / drill all go through the "shot" path; vanilla yoyos' `shoot` is not read | miner (archetype tags, vanilla yoyo) + model |
| Minishark (6 dmg) vs Musket (31 dmg) compared before defense | boss defense not modelled | miner (boss NPC stats) + model |
| 16-way novas keep 48 %; 12-shot fans "8 land" | spread factor floors at 0.15; hit cap of 12 per use; shots counted before geometry | model |
| Homing is a binary "×1" that only cancels penalties | no homing range / inertia / delay read; homing and velocity treated separately | miner + model |
| Debuffs are +3 % each, whatever they are, whatever the boss | no debuff table; boss immunities not read | miner + model |
| Infinite pierce on a single target is ×1.05 for Vilethorn, Arkhalis, spears and beams alike | hits per projectile ignore immunity frames × overlap time | model |
| Crimson Rod at 16 DPS, "75 mana/s" | mana sustain is `25 / mps` floored at 0.5, no regen model; placed/support weapons are not recognised | model |
| Ice Bow, Bellerose pre-boss | staging leads (`worldgen: AddBuriedChest`, `rarity`), out of scope here but they poison the comparison | stage inference |

## Phases

Order matters: the guide parser comes first because it is the scoreboard for everything after
it, and the staging fixes come before the model because a wrong stage makes any DPS number
meaningless for the comparison.

### Phase 0 — guides as data

`tools/guide-check.mjs` already downloads and caches the wikitext but parses it inline and only
for five pre-hardmode tiers. Split the parsing out and make it complete.

**New: `tools/guides.mjs`** (parser only) writing `data/guides.json` and a human-readable
`data/guides.md` (one table per tier × class). One record per recommendation:

```
{ guide: 'calamity' | 'ieor',
  tier: 'pre-skeletron',            // guide's own key
  tierBoss: 'Skeletron',            // the boss the tier precedes (or 'Pre-boss', 'Endgame')
  stage: 21,                        // lab stage the tier maps to (last stage before tierBoss)
  cls: 'rogue',
  kind: 'weapon' | 'armor' | 'accessory' | 'buff' | 'ammo',
  role: 'spam' | 'stealth' | 'minion' | 'sentry' | 'support' | 'offense' | 'defense' | 'mobility' | 'stealthAcc' | null,
  name: 'Ashen Stalactite', mod: 'Calamity' | null,
  marks: ['C'],                     // †  C  +  ≤  *  ν  Ω  (see legend below), Calamity's "Ω 1" → { with: 'Musket Ball' }
  note: 'This is best on worms and other multi-hit scenarios.',
  alt: ['Demon Bow', 'Tendon Bow'], // "A / B" alternatives share a record
  id: 'CalamityMod:AshenStalactite' | null }  // resolved against the dataset
```

Legend (both guides use the same symbols; the Calamity cargo rows carry the note text):
`†` risky / needs preparation · `C` crowd control, worms · `+` support or secondary ·
`≤` or its variants/upgrades · `*` tedious to get at this tier · `ν` SOTS void subclass ·
`Ω` use together (Calamity: with the named ammo).

Coverage: all 20 Calamity progression keys (`pre-boss` … `endgame`) mapped to lab stages by boss
name, and every IEoR template that exists (`Pre-Boss` … whatever the Hardmode / Post-Moon Lord
pages have). Calamity class keys `all`, `all-but-summoner`, `all-but-stealth`,
`all-but-summoner-stealth` expand to class lists.

**`tools/guide-check.mjs`** then only reads `data/guides.json` and reports. Additions:

- `--why <name>`: print the guide pick's `parts` next to the lab's #1 for that class and stage,
  so a bad rank is diagnosed in one command.
- **EARLY leads**: an item in the lab's top 5 at a stage where neither guide lists it yet while
  a guide lists it ≥ 2 tiers later. Today only LATE is reported, but an item that appears too
  early is the one that wrongly wins a stage.
- `note` and `marks` in the report line (a `C` weapon ranking low against a single-target boss
  is expected; a `+` support weapon is excluded from the top-k metric).
- Metrics per class and per tier, not just the total, plus mean reciprocal rank.

### Phase 1 — miner: read how a weapon works

All in `miner/extract/`, all mechanical (fields and call patterns, never names of items).

**1a. Staging prerequisites** (these are bugs, not model changes)

- Ammo: run ammo items through the same stage inference as everything else; `ammo[].stage`
  comes from the item. `bestAmmo` keeps "best obtainable at the stage" — with a real stage it is
  Tungsten Bullet pre-boss, not Holy Fire.
- Vanilla yoyos: `shoot` for `ItemID.Sets.Yoyo` items is set in `SetDefaults` after the case
  tracker's fields; read it (Amazon, Wooden Yoyo, Code 1 partly). Also read
  `ProjectileID.Sets.YoyosLifeTimeMultiplier / YoyosMaximumRange / YoyosTopSpeed`.

**1b. Weapon archetype** — a tag derived from mined fields, on every weapon:

| archetype | from |
| --- | --- |
| `swing` | `useStyle 1`, `!noMelee`, melee class |
| `shortsword` | `useStyle 3` |
| `spear` | projectile `aiStyle 19`, or `ai` that sets `player.heldProj` and reads `ai[0]` as extension |
| `yoyo` | projectile `aiStyle 99` |
| `flail` | projectile `aiStyle 15` |
| `boomerang` | projectile `aiStyle 3` or an `ai` that returns to the owner (velocity toward `Owner.Center`) |
| `held` (beam, drill, flamethrower, Arkhalis) | item `channel` and projectile `timeLeft = 2`-style refresh each tick or `player.heldProj` |
| `placed` (Crimson Rod, sentries, clouds) | projectile velocity zeroed in AI and no owner tracking |
| `shot` | everything else that shoots |
| `minion`, `sentry`, `whip` (`ProjectileID.Sets.IsAWhip`, whip settings) | already partly known |

The archetype decides which hit model applies; nothing else in the model branches on style.

**1c. Projectile motion** (extend `projectiles.js` records)

- `gravity`: keep the flag, add the constant (`velocity.Y += k` → `k`; vanilla arrow 0.1,
  aiStyle table for the rest).
- `drag`: `velocity *= k` per tick in AI (flamethrowers, shotgun pellets, Calamity spears' decay).
- `range`: derived at model time from `life × speed`, but record `timeLeft` resets (held) and
  `tileCollide` (already there).
- `homing` → an object: `{ range, inertia, speed, delay }`:
  - Calamity's `HomeInOnNPC(...)` and Thorium's equivalents carry range / speed / inertia as
    arguments — read them;
  - generic pattern `velocity = (velocity × (N−1) + dir × s) / N` or `Vector2.Lerp(velocity,
    dir × s, 1/N)` → inertia N, speed s;
  - `RotateTowards(angle, maxTurn)` → turn rate;
  - range: the constant compared against a distance in the target search (`Distance(...) < R`,
    `WithinRange`); missing → 300 px (pessimistic);
  - delay: a counter compare (`ai[0] > n`, `timeLeft < n`) guarding the homing branch → n ticks;
  - vanilla: a table by projectile id with the same fields (the case tracker cannot walk the
    per-style AI). This is game data, not an item override.
- `hitbox`: `width`/`height` (already `width`), plus `Resize`/`width =` in `Kill` → explosion
  radius on the child record (`explode: px`).

**1d. Hits and damage per projectile**

- Child projectiles: read the damage argument of `NewProjectile` in AI / Kill / OnHit as a
  multiplier of the parent's damage (`adj` on `Projectile.damage`) or an absolute; record
  `dmgMul` on the child entry. Also record `where: 'kill'` children's trigger:
  `Kill` on timeout vs on hit (`OnHitNPC → Kill()`), and whether they inherit `penetrate`.
- Pierce falloff: `damage = (int)(damage × k)` in `OnHitNPC` → `falloff: k`.
- Immunity: `local` already read; add `idStatic` vs `local` distinction and the vanilla default
  (10-tick global immunity when neither is set).
- `ArmorPenetration` on projectile and item.
- Spread: for loops of `RotatedBy(Lerp(−a, a, i/(n−1)))` or `RotatedBy(a × (i − n/2))` record
  `fan: { n, half: a }` instead of a single `spread`; random `RotatedByRandom(a)` stays
  `spread: a`. Vanilla multishot table gets the same shape.
- Burst / channel timing: `reuseDelay` (there), `Item.useLimitPerAnimation`, Calamity
  `ModifyShootStats` charge timers where readable; `autoReuse` (there).

**1e. Bosses** — new dataset table `npcs` for the NPC ids the stages already list:
`{ width, height, defense, life, buffImmune: [...], segments }` from `NPC.SetDefaults` /
`ModNPC.SetDefaults` (`NPCID.Sets.ImmuneTo*`, `buffImmune[...] = true`, Calamity's
`NPCDebuffImmunityData`). `bossShape` grows into `boss(ds, stage)` with size, defense and
immunities.

**1f. Debuff table** — `miner/stage/debuffs.json`: buff id → `{ dot, defense, dmgTaken }` per
second / flat, vanilla constants plus the Calamity / Thorium values from their wikis (they are
computed in `GlobalNPC.UpdateLifeRegen`, out of the interpreter's reach). Keyed by buff, never
by weapon.

### Phase 2 — the model (`src/lib/dps.js`)

Same skeleton, rewritten factors. Per use:

```
value = Σ over projectile groups g:
          n_g × p_land_g × hits_g × dmg_g   (+ children conditioned on the parent)
        × rate × crit × sustain × archetype risk
dmg      = max(1, (hit × dmgMul − boss.defense × 0.5 + armorPen × 0.5)) after falloff per hit
         + debuff DPS the boss is not immune to, spread over the hit rate
```

**Landing (`p_land`)** — one function of the projectile's motion and the boss:

- *Aim*: uniform spread ±a → share inside the target angle θ = atan(boss.width / 2 / D); a fan
  of n → count of fan angles inside ±θ (discrete, so a 3-shot 20° fan lands 1 of 3 on a small
  boss and all 3 on a big one). No floor: a 360° nova keeps θ/π. Engagement distance D comes
  from the class (see *Engagement distance* below); the archetype only clamps it (a swing or
  spear cannot engage beyond its reach, a placed projectile sits where it was put).
- *Travel*: the boss moves v_b px/tick (stage-scaled constant, 5 pre-boss → 14 endgame, a
  calibration knob) while the shot flies t = D / v_eff ticks; without homing
  `p = size / (size + v_b × t × 0.5)`. This replaces the `v / 10` clamp and makes velocity and
  hitbox one story.
- *Homing*: replaces the boss's motion: a projectile with range ≥ D, speed s and inertia N can
  turn v_b × N / s per tick worth of lead — if that covers the boss's displacement over the
  flight `p → 1 − delay/life`, else it interpolates. Homing on a shot slower than the boss
  never catches it (`s < v_b → no bonus`). Homing bonus is then *rewarded*, not just excused:
  it also lifts `hits` when the projectile pierces (it re-acquires).
- *Gravity*: drop `½ k t²` against boss height → share of the arc inside the silhouette, not a
  flat 0.85. Gravity + homing: homing wins.
- *Range*: `life × v_eff × drag-integral < D → 0`; between D and 2D linear.
- *Walls*: keep ×1.05, only for `shot` (a spear through a wall does nothing for DPS).

**Hits per landed projectile (`hits`)** by archetype:

- `shot`, pierce n: `min(n, 1 + overlap / immunity)`, overlap = boss depth / relative speed;
  infinite pierce on a single target is worth ~1–2 hits, not 1.05; worms multiply by segments
  in the path (replaces the flat 1.5).
- `held`: `life_effective / immunity` while the beam sits on the boss (Arkhalis, drills, Last
  Prism), capped by the animation.
- `spear`: 2 (out and back) with `local` immunity, 1 otherwise.
- `boomerang`: 2 (out and back) × p_land² for the return.
- `yoyo`: continuous contact: `60 / immunity` hits/s × uptime (yoyo range vs D) — rate comes
  from the projectile, not the item's useTime.
- `flail`: spin hits like yoyo when `channel`, thrown hit otherwise.
- `placed`: hits/s from `local`, × uptime the boss stays in it (0.3 default) — this is where
  "support" weapons land honestly low instead of accidentally low.
- `swing`: 1 per swing × reach factor from item size × scale (replaces the flat 0.7).
- Damage falloff applied per successive hit.

**Children**: `where: 'hit'` → × p_land of the parent, damage from `dmgMul`, own p_land from
the explosion radius (explode ≥ boss width → 1); `where: 'kill'` on timeout → × (1 − p_land)
(it exploded elsewhere) unless the explosion is large; `where: 'ai'` → own landing model with
the child's motion. Cap by the child's own pierce/immunity, not a global 2.

**Rate**: unchanged for `shot`; `held`/`yoyo`/`placed` use projectile timing; `autoReuse:
false` × 0.85; melee attack-speed bonuses only reach `swing`/`shortsword` (Calamity's note on
Fractured Ark is a general rule).

**Sustain**: mana per second against `regen(stage) + potion` where natural regen is the
vanilla curve at full mana (~1.5/s pre-boss, more with max mana) plus 20/s from potions on a
cooldown; factor = `min(1, available / needed)`, floor 0.35. Summons keep their slot model with
minion `hits/s` from `local` and the ranged-child model above.

**Debuffs**: `+ dot` DPS for each debuff the next boss is not immune to (uptime = 1 when the
weapon hits more often than the debuff's duration), defense debuffs raise `dmg` for every hit.
Replaces "+3 % per debuff".

**Rogue**: keep spam / stealth; the stealth path goes through the same landing model with its
own projectile; the flat "stealth projectile does more ×1.15" goes away once children and
`dmgMul` are read.

**Engagement distance** — how far from the boss the player of a class stands, which sets the
target angle, the flight time and the range check for every weapon of that class. A class
default, and an optional playstyle toggle per class in the UI (Options) that the solver also
passes through `ctx.playstyle`:

| class | default | toggles |
| --- | --- | --- |
| melee | 80 px (contact) | — |
| rogue | 300 px | `spam` 220 px (close, throwing constantly) · `stealth` 420 px (far, one strike per recharge); the spam and stealth variants of a weapon are scored at their own distance |
| ranged | 380 px | `sniper` 520 px (slow, heavy shots, favours velocity and homing) · `rapid` 280 px (machine guns, favours rate over accuracy) |
| magic | 340 px | `nuke` 450 px · `spray` 250 px |
| summon | 420 px (minions engage on their own; D only matters for whips and summon weapons that shoot) | — |
| bard / healer | 340 px | — |

Only D changes with the toggle; no weapon carries a distance of its own. The archetype clamps
D (`swing` / `shortsword` / `spear` to their reach, `held` to its beam length, `placed` to
where it stands), which is what makes a close-range weapon in a far-standing class score low
without anyone listing it.

**Risk factor** (`†` in the guides): `swing`, `spear`, `held` with range < 150 px and
`placed` get a class-preference multiplier (melee 1, everyone else 0.85) — the guides' "risky"
mark is exactly "you must stand next to the boss". This is a `CLASS_PREF`-style table, not an
item list.

All constants live at the top of `dps.js` with the same `export const` treatment as today so
calibration and tests can reach them.

### Phase 3 — compare, diagnose, fix (the loop)

1. Re-mine (`bun run mine`, Node), run `node tools/guides.mjs` then `guide-check`, record the
   metrics table in this file.
2. For every guide weapon pick outside the lab's top 8 at its tier, `--why` it. Sort the
   reasons into: staging lead (goes to `data/unknown-sources.md` / infer.js), miner gap (a
   field the model needed and did not have), model gap (the field is there, the factor is
   wrong), honest disagreement (write the reason in the "Disagreements" section below).
3. Fix miner gaps and model gaps as *rules*; re-run; the metric must not regress for any class.
   A change that helps one class's picks and hurts another's is a wrong rule.
4. Tune the knobs (`v_b`, the class distances and their toggles, risk multipliers) last, on the full pre-hardmode
   set, and check they still hold on the hardmode tiers the parser now covers.

Guide picks carrying `C` are scored against the tier's worm boss when one exists (the model
already knows the next boss; the check picks the worm within the tier instead).

Picks carrying `+` are what the guides call *support*: "items that debuff the enemy or benefit
the player in some way, or secondary weapons that can be used occasionally" — Crimson Rod
(`C +`, a rain cloud you place for its debuff and passive hits), Ichor-inflicting weapons you
swap to for the defense debuff, whips that tag for minions. They are on the guide for what they
add to the main weapon, not for their own DPS, so they are reported but not counted in the
weapon top-k metric: the model *should* rank them below the main weapons, and a support weapon
in the top 3 is a warning, not a success. Their debuff value is still scored through the debuff
table (Phase 1f / Phase 2), which is where "swap to it for Ichor" becomes a number.

### Phase 4 — tests and docs

- `test/dps.test.js`: one case per archetype and per landing factor (fan vs random spread,
  homing catches / does not catch, gravity drop, held hits, defense subtraction, immune
  debuff ignored, child on hit vs on timeout).
- `test/guides.test.js`: parse a fixture of each wikitext shape (Calamity cargo row with note
  and `Ω 1`, IEoR box with `/` alternatives and marks).
- README "Real DPS" block and `docs/superpowers/specs/2026-09-02-real-dps-design.md` updated to
  the new formula; `data/guides.md` linked from the README.

## Files

| file | change |
| --- | --- |
| `tools/guides.mjs` | new: parser → `data/guides.json`, `data/guides.md` |
| `tools/guide-check.mjs` | reads guides.json; `--why`, EARLY leads, per-class metrics |
| `miner/extract/items.js`, `vanilla.js` | archetype tag, ammo staging, vanilla yoyo `shoot`, armor pen |
| `miner/extract/projectiles.js` | gravity k, drag, homing object, explosion radius, child dmgMul, falloff, immunity kind |
| `miner/extract/shoot.js` | fan vs random spread, use-limit / charge timing |
| `miner/extract/npcs.js` | boss `npcs` table: size, defense, life, immunities |
| `miner/stage/debuffs.json` | new: buff id → DoT / defense / damage-taken |
| `src/lib/dps.js` | landing model, hits per archetype, defense, debuff DPS, sustain, risk |
| `src/lib/dataset.js` | index `npcs`, keep `ammoByKind` |
| `src/components/ItemCard.svelte` | show the model summary line (`p_land`, hits/proj, boss used, distance) — parts contract unchanged |
| `src/components/Controls.svelte`, `src/lib/state.svelte.js` | playstyle toggle per class (rogue spam/stealth, ranged sniper/rapid, magic nuke/spray) |
| `test/dps.test.js`, `test/guides.test.js` | as above |

## Not doing

- Per-item overrides of any kind, including "guide says so" stage pins.
- Boss AI speeds mined from NPC code; `v_b` stays a stage-scaled knob until the model is
  otherwise right.
- Thorium inspiration and bard empowerments, healer radiant: unchanged from today.
- Event / crowd DPS: the guides' `C` picks are judged against worm bosses only.

## Disagreements (filled in during Phase 3)

Guide picks the model still ranks low after the rules are right, with the reason. Empty until
the loop has run.

## Progress log

| date | step | weapons top-3 / top-8 | mode agree | notes |
| --- | --- | --- | --- | --- |
| 2026-09-03 | baseline | 18 / 64 of 572 | 20 / 26 | ammo unstaged, no archetypes, no defense |
