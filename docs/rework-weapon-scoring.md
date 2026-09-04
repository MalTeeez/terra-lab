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

## Baseline and where it landed

`node tools/guide-check.mjs --pre --summary` — the five pre-hardmode tiers of both guides. The
scoreboard itself changed in Phase 0 (the parser now reads every tier, roles and marks, and support
picks are excluded from the top-k metric), so the "before" row is the old model re-measured on the
new scoreboard rather than the 572/18/64 of the first run.

| metric | before | after |
| --- | --- | --- |
| guide weapon picks, pre-hardmode (support excluded) | 508 | 508 |
| lab ranks the pick in its top 3 / top 8 | 17 / 63 | **70 / 135** |
| mean reciprocal rank | 0.064 | **0.134** |
| stealth-vs-spam grade agrees with the guide | 41 / 53 | **59 / 74** |
| picks staged later than the guide's tier | 93 | 137 |
| armor: the lab's #1 / in its top 5 | 17 / 110 | **22 / 115** |

"after" is where *pass 4* landed (the log at the bottom has pass 1's 31 / 60, pass 2's 39 / 80 and
pass 3's 43 / 83). Pass 4 also changed the scoreboard once — summoner picks are ranked within their
role — so its jump is part model and part yardstick; the log says which row is which.

Whole run (43 tiers, pre-boss to endgame — the parser did not reach past Wall of Flesh before):
2013 weapon picks, top-3 126, top-8 282, MRR 0.073, stealth/spam 231/302.

Per class, pre-hardmode (top-8 of the class's picks): summon 46/129, rogue 23/79, magic 22/89,
bard 17/39, ranged 16/89, melee 10/83.

The target set out below (top-3 ≥ 150, top-8 ≥ 300) was not reached and, on the evidence
collected in Phase 3, is not reachable against this scoreboard: see *Disagreements*. What the
rework did deliver is a model whose every factor is a mined number rather than a constant, and a
scoreboard that now names the leads instead of hiding them.

**Original target:** top-3 ≥ 150, top-8 ≥ 300 on the same picks, and no class whose top 5 at any
pre-hardmode tier is empty of guide picks.

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

### Phase 0 — guides as data ✅

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

### Phase 1 — miner: read how a weapon works ✅ (with the gaps noted below)

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

### Phase 2 — the model (`src/lib/dps.js`) ✅

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

### Phase 3 — compare, diagnose, fix (the loop) ✅ — one pass, results below

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

### Phase 4 — tests and docs ✅

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

## What was built, and what was left

Done as specified: the guide parser and `data/guides.json` / `data/guides.md`, the `--why`,
EARLY-leads, per-class and per-tier metrics in the checker; the archetype tag; projectile motion
(gravity constant, drag, homing as an object, blast radius, pierce falloff, armour penetration,
hitbox); child damage share; fan-vs-random spread; the `npcs` table and `debuffs.json`; the whole
model rewrite (landing, hits per archetype, defense, debuff DPS, sustain, risk, engagement
distance with its playstyle toggle); the UI toggle and the item card's summary line; tests and docs.

Not built, with the reason:

| left out | why |
| --- | --- |
| `RotateTowards` turn rates, homing `delay` counters, per-projectile homing `range` from a distance compare | the arguments are not on the call; it would take following the AI's local state. The pessimistic 300 px default stands in. |
| a vanilla homing table by projectile id | `VANILLA_HOMING` still only says *whether* a vanilla projectile seeks; the defaults cover the rest. |
| `idStatic` vs `local` immunity as separate fields | the model treats both as "ticks between hits on the same NPC", which is what they are for one player. |
| `useLimitPerAnimation`, Calamity `ModifyShootStats` charge timers | `useLimitPerAnimation` is read and plumbed through, but no weapon in this pack sets it; charge timers are still unread, which is why children are capped. |
| Calamity's `NPCDebuffImmunityData` | out of the interpreter's reach, as the plan said. Mod bosses are assumed immune, which is both pessimistic and usually right. |
| `bossShape` → `boss(ds, stage)` keeping the old worm/parts weights | replaced outright; the new `boss()` returns size, defense, parts, worm and immunities. |

## Pass 2 — what the guides' picks have in common (2026-09-03)

The complaint that started it: at post-Desert-Scourge the rogue list was all *spam* weapons, most
of them pre-boss, and Scourge of the Desert — the tier's headline stealth weapon — sat at #32.

Instead of arguing weapon by weapon, the pick set was measured against the pool. For every
pre-hardmode tier and class, each weapon's `parts` were bucketed by factor and the geometric mean
taken over the guides' picks and over the lab's top 8 that the guides do *not* list:

| factor | guide picks | lab's top-8 non-picks |
| --- | --- | --- |
| model total ÷ raw `damage × rate` | **0.52** | **1.59** |
| child projectiles | 2.21 (27 % have one) | **3.79 (48 %)** |
| range | 0.44 (15 % pay it) | 0.64 (9 %) |
| travel | 0.50 | 0.57 |
| pierce / hits | 0.84 | 0.78 |

The pattern is not "the guides like a kind of weapon". It is that **the model's own multipliers
were paying the pool three times what they paid the picks**, and every one of the big terms turned
out to be a bug rather than a preference:

1. **A stealth strike was worth nothing.** `value = max(spam, strike/recharge)`, and since
   `strike/recharge ≈ spam × mult / (5 × rate)`, at any normal use time the strike is a fifth of
   the spam. No weapon could ever be graded stealth, so the guides' entire stealth axis was
   invisible. Stealth regenerates while you throw, so the two *add*.
2. **An unread `shootSpeed` was a free pass.** `velocity = null` skipped the landing model whole —
   no travel lead, no gravity, no range check — and `land = 1` then handed the projectile its full
   pierce count. 86 `shot` weapons had it, and they were winning: Gel Throwing Axe (11 damage) was
   the lab's #4 rogue weapon at stage 10.
3. **On-hit children were never conditioned on the parent hitting.** `childHits` gave a `where:
   'hit'` child `reachShare = 1` regardless of `parentLand`, against its own docstring. This is the
   `children` row above, and fixing it was the single biggest metric move of the pass.
4. **`localNPCHitCooldown = -1` was read as a rate.** It means "hits a given NPC once, ever"; the
   model fell back to the player's 10-tick window and let explosions multi-hit.
5. **Vanilla worms were not worms.** `WORM_RE` matches `Head`/`Body`/`Tail`; every vanilla worm
   segment carries the same name, so the Eater of Worlds was a 38 px single target. A worm is now
   three or more stage NPCs sharing one name, and its `aimW` is the chain, not one segment.
6. **A misread projectile reach scored the weapon at zero.** `drag` was mined from *conditional*
   velocity multiplies (stick-on-hit, stop-on-tile) and applied as permanent per-tick decay, so
   `v/(1−d)` said Demon Scythe reaches 120 px and Bladecrest Oathsword 6 px. Fixed at the root in
   `projectiles.js` (260 of 637 mined drags were spurious). The model now also walks the player in
   to the edge of the weapon's reach instead of writing it off — the class distance is a *ceiling*.
7. **The ranged / magic playstyle toggle was dead.** `variant('spam')` overwrote `ctx.playstyle`
   for every class, and `PLAYSTYLE.ranged.spam` does not exist, so sniper/rapid and nuke/spray both
   fell back to the class default.

One thing that looked like a rule and measured as a wrong one: discounting children spawned behind
a condition the interpreter could not decide. It was tried (`CHILD_CONDITIONAL` 0 … 1) and every
value below 1 lost top-8 and MRR — the guides' picks lean on conditional mechanics more than the
pool does. Reverted, per rule 1.

Known gap left: Thorium's bard accessory procs (Mixtape, Jester's Bell, Clap) are read as children
of every bard weapon's projectile — 164 projectiles carry them — because they live in an inherited
`BardProjectile.OnHitNPC` behind `ThoriumPlayer.accXxx` flags the interpreter resolves as taken.
`CHILD_CAP` bounds the damage and the inflation is uniform within the class, so it does not move
the ranking, but the absolute bard numbers are too high.

## Pass 3 — where the top-8 slots actually go (2026-09-03)

Pass 2 lifted Scourge of the Desert from #32 to #8 and the metric from 36/67 to 39/80, but the
rogue list at post-Desert-Scourge was still pre-boss weapons. This pass went after *why*, with two
new measurements instead of more per-weapon argument.

**Ablation: turn one factor off and re-rank.** Dividing each weapon's score by one bucket's
multipliers and re-measuring says which factors earn their keep. Dropping `pierce`, `range` or
`children` each costs 7–8 top-8; `gravity` costs 4. Nothing was strongly anti-correlated, so the
model's shape is not the problem. (`contact` looked like +8 when scaled away, but every honest
re-formulation of it — additive instead of multiplicative, contact-only — measured flat or worse,
so it stayed as it was. Two yoyos on the boss really is two clocks.)

**Ablation: score the same picks with a naive function.** `damage × rate` gets 15/57 (MRR 0.066),
base damage alone 25/67 (0.091), the model 39/74 (0.111) on the same dedup. The model beats every
naive baseline overall — but not for every class: rogue and summon both scored *better* under plain
`damage × rate` than under the model, which is where the remaining work is.

Three more defects came out of it, all general:

1. **Defense was subtracted from the printed damage.** A boss's defense comes off every hit as a
   flat number, so a weapon that hits often for a little pays it many times. Taking it off the item
   tooltip's number — one no player ever hits for, since by then you wear a set, six reforged
   accessories and a potion — is a tax aimed squarely at the fast, low-damage weapons that make up
   most of a rogue's list. `playerDamage(progression)` now buffs the hit before the subtraction.
2. **`Giant Clam` has `defense: 9999`** — its shell shut, not a stat — and it is the target for
   stage 3, the exact stage the complaint came from. The old clamp turned it into 32, still armour
   no fight presents. `fightableDefense` drops any value above `DEFENSE_CAP` and falls back.
3. **A fan read through the vector's components lost its angle.** `NewProjectile(v.X * k, v.Y * k,
   …)` is the common shape, and `onLoad` on a vec's `.X` kept only `mul`, dropping `spread`/`fan`.
   Harpy's Barrage — the rogue list's #1 at five of six pre-hardmode tiers — was scored as three
   shots on one line instead of a ±5° fan. Fixed in `shoot.js`; 113 calls now carry a fan.

And one staging bug of the kind that always pays: **`Spike` is a Dungeon material** with no mined
source, so it fell to a rarity guess at pre-boss, and `Metal Monstrosity` (80× Spike) and `Spiky
Caltrop` (3× Spike) sat in the pre-hardmode rogue top 8. `v:Spike → Skeletron` joins `v:Bone` in
`anchors`; both weapons moved to stage 21, which is where the guides list Metal Monstrosity. A
sweep of every other vanilla material staged by rarity alone found no second case — Fallen Star,
Cobweb, Cactus, the herbs and the blocks are all genuinely pre-boss.

### The ceiling, measured

`guide-check` now prints an **UNLISTED** section: the weapons holding top-8 slots that *no* guide
names for that class at any tier. EARLY cannot see these — it needs a tier to compare against — yet
they are 144 of the 288 pre-hardmode top-8 slots. That is the worklist, and it is now visible.

Dropping a group from the pool entirely puts an upper bound on what fixing it could be worth
(guide picks are never dropped):

| pool | top-3 | top-8 | MRR |
| --- | --- | --- | --- |
| as it is | 39 | 74 | 0.112 |
| minus every rarity-staged weapon | 42 | 84 | 0.125 |
| minus StarsAbove entirely | 40 | 76 | 0.116 |
| **minus ThoriumMod entirely** | **44** | **93** | **0.127** |

Thorium holds ~19 of the contested top-8 slots — more than every other source combined. The obvious
reading is that Calamity's guide simply does not cover Thorium, but that is **not** what the numbers
say: splitting the picks by guide, IEoR's own picks gain exactly as much as Calamity's when Thorium
is removed (65 → 83, +28 %; Calamity 18 → 23, +28 %). IEoR *is* the modpack's guide, it *does* rank
Thorium weapons, and the ones it names are not the ones the lab names.

Every mining explanation for that was checked and came back clean:

- `InfernalItemBalanceChange::SetDefaults` really does set Harpy's Barrage to 36 damage (read from
  the IL, `if (item.type == thorium.Find<ModItem>("HarpiesBarrage").Type) item.damage = 36`).
- `CalamityBardHealer.ItemBalancing` really does double every Thorium melee weapon's damage — its
  `AppliesToEntity` returns false for any mod but ThoriumMod, and the miner scopes it the same way.
  190 items, all melee, all exactly ×2, correctly read.
- No item's final damage disagrees with the last change applied to it; the overlays do not stack.

So the Thorium pool is mined correctly and is genuinely strong in this pack. Either the guide is
conservative about a mod it covers only partly, or the model over-values something the whole
Thorium catalogue shares that the ablation buckets do not separate. That is the open question for a
next pass, and it is worth more than any remaining factor: it is 19 slots against the 7 that all of
this pass's model fixes bought.

## Pass 4 — the weapon type as the basis (2026-09-03)

Pass 3 left the model with one shot path, one contact path and one summon path, and an `arch` tag
that mostly only picked between them. This pass made the type the thing the model is *built* on,
because two weapons with the same damage and use time are not the same weapon: a boomerang has to
come home before you can throw it again.

### The diagnostic that drove it

A per-archetype table, comparing the share of top-8 slots a type takes against the share of guide
picks it accounts for. Over 1 means the model likes that type more than the guides do; the last
column is where that type's own picks land in the ranking (lower is better, 50 % is random):

| type | over | picks in top-8 | mean percentile |
| --- | --- | --- | --- |
| sentry | 0.11 | **0 / 24** | **62 %** |
| whip | 0.00 | 0 / 6 | 57 % |
| minion | 1.47 | 7 / 30 | 31 % |
| placed | 1.30 | 0 / 4 | 61 % |
| boomerang | 0.74 | 0 / 7 | 45 % |
| flail | 0.00 | 0 / 3 | 33 % |
| shot | 1.08 | 56 / 228 | 37 % |

Sentries were worse than random and there are 24 of them. That is not a scoring bug at all, which
is what the table made obvious.

### The taxonomy

`archetypeOf` now emits the wiki's weapon-type list, every one of them decided by a mined field and
never by an item's name:

| class | types |
| --- | --- |
| melee | `swing` (broadswords) · `shortsword` · `specialsword` · `spear` · `yoyo` · `flail` · `boomerang` |
| ranged | `bow` · `repeater` (a bow with `autoReuse`) · `gun` · `launcher` · `flamethrower` |
| magic | `shot` · `held` (beams) · `placed` |
| summon | `minion` · `sentry` · `whip` |
| rogue | `bomb` · `boomerang` · `dagger` · `javelin` · `spikyball` |

Wands, magic guns and spell tomes stay one tag: nothing downstream would branch on the difference,
and a name is not a mechanism. The rogue split *is* mechanical — `bomb` has a blast radius or dies
into a child that does, `spikyball` comes to rest on the ground and waits to be walked into,
`javelin` sticks in what it hits, `dagger` is none of those.

`ARCHETYPE` in `dps.js` is now the one place a weapon type is described, and the model reads its
`cycle` (`use` · `flight` · `contact` · `slot`), `uptime`, `passes` and `tag` instead of testing the
tag in four scattered places. A test asserts every type the miner can emit has an entry, so a new
type cannot silently fall back to "fires once per use".

### What changed, and what it was worth

1. **`cycle: 'flight'` — one out at a time.** A boomerang is gone until it returns, so the round
   trip is the clock and the use time is only a floor. Sand Dollar's spam grade went 125 → 61/s at
   post-Wulfrum: 4 throws a second became 1.9. The return pass is conditioned on the landing chance
   a second time, like an extra pierce, and a boomerang's two passes always count (they are a whole
   flight apart, so no immunity window can merge them, unlike a spear's thrust).
2. **The scoreboard was wrong about summoners.** A summoner equips a minion *and* a sentry *and* a
   whip at once, and both guides give each its own column — so ranking a sentry against the minions
   it is meant to be used alongside is the same mistake as counting `+` support picks in the top-k
   metric. `guide-check` now ranks a pick with `role: sentry` against sentries and `role: minion`
   against minions and whips. Sentry picks in the top 8 went 0/24 → 17/24. This is a change of
   yardstick, not of model: it is why the headline number jumps, and it is called out in the log.
3. **`sentry` and `minion` uptimes.** A sentry was quartered by `UPTIME.placed` (0.3) — but a boss
   fight happens where you put the sentry. 0.55 for a sentry, 0.9 for a minion that has to chase.
4. **A whip's mark.** Its own lash is small change; what it is for is the tag every minion hit then
   carries. `tag: 2` — Leather Whip's +4 across ~12 minion hits/s against its own 14 × 2/s is ≈1.7,
   Kaleidoscope's +26 ≈1.4, so 2 is the honest middle. Whip picks in the top 8: 0/6 → 3/6. Larger
   values score better (6 is worth another 3 top-3 and 3 top-8) but nothing in the game says 6.
5. **`held` read from a conditional wind-up.** A spear sets `player.heldProj` every tick; a
   charge-up weapon sets it only while winding up and then throws the thing. Guarding on
   `!ctx.conditional` — the same shape as the `drag` and `tileCollide` guards — reclassified 90
   projectiles out of `held`.

### Pass 4b — what a projectile does when it arrives

Two more type facts, both from mined behaviour.

**It sticks.** Bolas was the lab's #4 rogue weapon at post-Wulfrum on 35 damage and `pen: -1`, and
the model gave it two hits for crossing the silhouette. It does not cross anything: it embeds in
the first thing it touches. The signal is precise and general — the AI sets the projectile's *own*
centre **from** an NPC's, which is riding that NPC. A homing projectile also reads an NPC's centre
but steers with it and never writes its position from it, so the value has to be followed through
the offset arithmetic rather than the two facts merely counted (counting them tagged Thorium's
homing spirit minions as sticky). Terraria's own example names the flag `isStickingToTarget` and
mods copy it, so the name is a second route to the same fact. 46 non-summon projectiles stick.

A stuck projectile's pierce buys nothing. What it does next is its own hit cooldown: a javelin
keeps wounding what it is stuck in (`1 + STUCK_TICKS / local`, capped by its pierce), a bola with no
cooldown of its own just hangs there for one hit. This also replaced the `javelin` archetype's
heuristic with the real thing.

**A thrown weapon is not a shortsword.** `useStyle === 3` was enough to tag one, so Obsidian
Striker — `noMelee`, all of its damage in a 5 px/tick projectile — was scored as a stab at 60 px,
which handed it a gentle travel penalty and its full 10 pierce. It is a thrown weapon and is now
scored at the distance a rogue actually throws from.

| weapon | before | after |
| --- | --- | --- |
| Bolas | #4, 109/s | #17, 57/s |
| Obsidian Striker | #3, 113/s | #21, 53/s |
| Lasting Pliers | 96/s, outside the top 8 | #8, 96/s |

Which is the ordering the pack's own play says it should be: Lasting Pliers throws the same weapon
faster and further than Obsidian Striker, and both beat a bola that stops on the first thing it
touches. Pre-hardmode went 54 / 110 to 54 / 111, and no class regressed.

### Pass 4c — lifetime, reach, and what homing does to them

**`timeLeft` is counted in updates, not ticks.** `extraUpdates` runs a projectile's whole update —
move, AI, `timeLeft--` — several times a game tick, so extra updates make a shot *arrive sooner*
without making it *travel further*, and they burn its life proportionally faster in real time. The
model was multiplying the per-tick speed by the lifetime, which inflated the reach of every
projectile with extra updates by `(1 + updates)` — 691 of the 2508 projectiles a weapon fires, a
few of them by 100× — and it was subtracting a tick-count from a life measured in updates, so the
life left on arrival came out too high as well. `stepOf` (px per update) and `speedOf` (px per tick)
are now separate, `reachOf` takes the step, and `alive` converts before it subtracts.

**Homing's multiplier was a decoration.** The `parts` line read `homing (300 px, turn 0.6/tick)
×1.23`, but nothing was ever multiplied by it — the benefit was folded into the travel and gravity
terms as `(1 − homed)`, so the arithmetic the item card prints did not multiply out to the number
above it. Travel and gravity are now priced twice, at what the shot loses flying dumb and at what
homing buys back, and the homing line is the ratio. A test asserts the landing factors multiply to
the factor they explain, which is the `parts` contract this document opens with.

Both are corrections rather than tuning: pre-hardmode went 54 / 111 to **53 / 111** with the same
MRR (0.109), one top-3 traded for units that are right.

**What was tried and rejected.** Letting a seeker correct over only the last `range` px of a longer
flight, instead of the all-or-nothing `range ≥ 0.6·D` gate, is better physics — but it cost 4 top-8
and gained nothing, because 361 of the 408 seekers here carry the pessimistic 300 px default rather
than a radius the miner read. Paying out on that is paying out on a guess. Emitting a `rangeGuess`
flag so partial credit applied only to *read* radii recovered none of it, so the gate stayed and the
flag was removed rather than left unread.

Also re-measured, now that reach is correct: the "only just makes it" band (`reach < 2·D` falling to
×0.1) double-counts with the life-left bound in `hitsPerProjectile`, so softening or dropping it
looked justified. It is not — floor 0.3, floor 0.5 and no band at all each cost a top-8. A weapon
used at the edge of its range really is bad for a class that stands back, and the band is where the
model says so.

## Pass 5 — reading the wiki, and what it exposed (2026-09-03)

Prompted by "read the wiki pages for some of the weapons on why they might be promoted". Sorting the
guide picks by where the lab buries them turned up a signature no disagreement can explain: **seven
picks scored exactly 0/s** — Fizzle Star, Icy Piccolo, Eel-rod, Pistol Shrimp, Code Corrupter,
Pumpler, Demon Scythe. A guide does not recommend a weapon that does nothing.

**`velocity * k` is usually a steering blend, not drag.** Every one of the seven carried an
unconditional `drag` between 0.1 and 0.6, which would stop a projectile dead in about three ticks.
Reading the IL for one of them showed why: `Projectile.velocity = Projectile.velocity * 0.9f +
toTarget * 0.1f` is how half the mod projectiles in the pack steer, and the miner was recording the
weight as a per-tick decay. The rule that separates them is structural — a scale is only drag once
it is **stored back to velocity with nothing added to it** — so the scale is now carried as a marked
value and anything added to it on the way turns it back into a plain velocity. Weapon projectiles
carrying a drag fell 186 → 116, the implausible `< 0.70` bucket 84 → 10, and the count whose
drag-limited reach was under 120 px (which included bows, guns and blowguns) fell 98 → 24. Fizzle
Star's real drag is 0.985. Six of the seven zeros went away; Demon Scythe is the seventh and is a
different problem (aiStyle 18 accelerates, so its mined 0.2 px/tick launch speed is not its speed).

**A recipe that never resolved is not "no evidence".** `Orbital Expressway Plush` — 440 damage, and
melee's #1 for nine straight tiers — is crafted from a StarsAbove material nothing in the code
describes. With the recipe unresolvable the item fell through to the rarity fallback, and StarsAbove
paints a 440-damage weapon green, so it landed at pre-boss. But rarity is documented as the fallback
for an item with *no* drop, craft or anchor evidence, and this item has evidence; it just could not
be followed. Equipment in that position is now left at **unknown** rather than guessed, which is both
truer and the pessimistic answer — the pool leaves it out until the *unknown stage* toggle asks for
it. 142 weapons moved, 110 of them StarsAbove, only 7 of them guide picks. Melee's #1 is now
`Old Lord Claymore`, which the guide actually lists.

**`DefaultToWhip()` is how a mod declares a whip.** SOTS's whips have whip tooltips — *"Minions
cause tagged enemies to explode into spiky balls"* — and were scored as plain shots, because the
miner only knew vanilla's `ProjectileID.Sets.IsAWhip`. Reading the call took whips from 9 to 76. Two
things had to follow: a whip lashes once through its arc rather than piercing along it (it was going
through the pass-through pierce path and collecting multi-hits), and its `uptime` was config nothing
read, since uptime is only consulted on the contact and summon paths.

**`ownedProjectileCounts[shoot] < N` says how many can be out at once.** The flight cycle assumed
one. Reading `CanUseItem` — 186 weapons state it — confirms one for 172 of them, and finds the
exceptions: Sand Dollar 2 (the double boomerang), Titan Boomerang 3, Defective Sphere 5. A boomerang
also does not turn round at the target, it sails out to its own throw distance first, so the trip is
`2 × max(D, THROW_OUT) / v` rather than `2 × D / v`.

**And the scoreboard again, for the same reason as the sentries.** The guides print whips in the
minion column, but that column is 209 minions and 19 whips: once the miner found all 76 whips they
simply crowded the minions out of a shared ranking. A summoner equips a minion *and* a sentry *and*
a whip, so each is now ranked against its own kind, chosen by what the item is rather than which
column it was printed in.

| | top-3 | top-8 | MRR |
| --- | --- | --- | --- |
| start of the pass | 53 | 111 | 0.109 |
| model and miner fixes | 54 | 114 | 0.118 |
| **with the summon-kind scoreboard fix** | **60** | **121** | **0.124** |

Mean percentile of a guide pick is now 35.6 % (random is 50 %), and the share of top-8 slots held by
weapons no guide ever names is 48 %, down from 50 %.

## Pass 6 — the stealth strike is not the throw (2026-09-03)

The case: **Throwing Brick**, a joke-tier weapon craftable from red brick on minute one, sat seven
ranks above **Scourge of the Desert**, which the guide names for the tier. The wiki settles it in one
line — *"During a stealth strike, the brick shatters into 5 fragments"*. The fragments are the
stealth strike, and the model was counting them on every normal throw, which was most of the brick's
score.

Getting that fact out of the code took three interpreter fixes, each general:

1. **A flag widened to a number is still the flag.** Calamity does not branch on `stealthStrike`
   where it uses it; it writes `Projectile.ai[0] = stealthStrike > 0` at the top of `OnKill` and
   branches on `ai[0]` two hundred bytes later. `conv.r4` was turning the flag into UNKNOWN.
2. **`Projectile.ai[]` carries values between the two.** Handing back one array per run lets a value
   survive the round trip instead of being read back as UNKNOWN. Calamity uses `ai[]` as a
   scratchpad constantly, so this is worth more than the one case.
3. **A block only reachable by a backward jump keeps the condition around it.** The fragment loop
   sits after a `br` that jumps over it, so the linear walk arrives before it has read the jump that
   leads back in — and cleared the enclosing regions, calling the loop body unconditional. What
   still encloses the offset is the honest answer until a jump says otherwise.

With those, a child records **which strike spawns it** (`stealth: true` only a stealth strike,
`false` only a normal hit, absent either), and `childHits` skips the ones that do not belong to the
variant being scored. 60 children across the pack are stealth-only, 13 normal-hit-only.

| | before | after |
| --- | --- | --- |
| Throwing Brick | 90/s, #14 | **41/s, #20** |
| Scourge of the Desert | 60/s, #20 | **60/s, #11** at stage 5, and **#3/52** at its own tier |

Pre-hardmode went 60 / 121 to **64 / 123**, MRR 0.124 → 0.127.

**Tried and rejected, again from the wiki.** Scourge's tooltip says its javelin *"will burrow
through the ground and launch itself at enemies"*, and the original design note wanted a seeker's
pierce to count for more because it turns round and comes back. Implemented as "a seeker's time on
target is a share of its remaining life rather than one crossing", it is worth nothing: every
re-acquire window from 0 to 200 ticks either ties or loses a top-8. The time on target stays the one
crossing the geometry gives it, and the note is now marked as measured rather than pending.

One thing the wiki says that the miner still reads wrong: the stealth strike throws **three**
javelins, and `shoot.js` reads seven. Left as a lead.

## Pass 7 — gravity, splash, and the stealth projectile swap (2026-09-03)

Three reports, each of which turned out to be a distinct bug.

**"Do you account for gravity dropoff of other weapons?"** Pod Bomb — a thrown bomb — had no
gravity and no drag in the data at all, while Scourge of the Desert's javelin had both, so one paid
for its arc and the other did not. Thorium routes 40-odd of its thrown projectiles through
`ProjectileExtras.ThrowingKnifeAI`, which applies gravity and decay to `velocity.Y` **by reference**
(`ldflda velocity; ldflda Y; dup; ldind; ldarg.2; add; stind`). The interpreter turned the address
read into UNKNOWN, so the store was invisible. Reading a tracked slot's address back as that slot,
and routing `stind` on it to the store hook, made both fields visible: Pod Bomb picked up
`gravityK 0.4, drag 0.97` and went 104/s → 69/s. Weapon projectiles with gravity: **+8 top-8**, the
biggest single move of the pass.

**"The Pod Bomb feels worse than the Contaminated Bile, which feels at least twice as strong."** The
Bile's explosion is a 150 px cloud that ticks every 25 frames for 180 and applies Irradiated — and
the model was charging it the *crossing time of a travelling projectile*, as if the boss flew
through it. A blast does not fly through anything: it goes off where the parent died and stays
there. So a `kill` child is one hit, or — if it sets a hit cooldown of its own, which is exactly how
a lingering cloud says it keeps ticking — one hit per cooldown for as long as it lasts. Bile 43/s →
65/s, and it passes Pod Bomb, which is the ordering the pack plays like. **+3 top-8.**

**Ashen Stalactite at 381/s, three times the next weapon.** Its wiki line: *"Stealth strikes cause a
larger, more damaging stalagmite to be thrown"* — and the debris belongs to that stalagmite, which
the miner had right. What it had wrong was `typeOverride`: Calamity's `RogueWeapon.ModifyShootStats`
calls `ModifyStatsExtra` from *outside* its stealth branch, and that is where a weapon swaps in its
stealth projectile. Inlined, the callee's offsets mean nothing against the caller's stealth ranges,
so the swap read as unconditional and every normal throw fired the stealth projectile with its
debris. Running the item's own `ModifyStatsExtra` as its own pass, against its own stealth ranges,
sees it: 4 weapons move their swap into `stealthMods.type`, and Ashen Stalactite goes 381/s → 119/s.

| | before | after |
| --- | --- | --- |
| Ashen Stalactite | 381/s, #1 | 119/s, #2 |
| Contaminated Bile | 43/s, #23 | 65/s, #10 |
| Pod Bomb | 104/s, #3 | 48/s, #20 |
| Scourge of the Desert | 60/s, #12 | 66/s, #9 |

Pre-hardmode 64 / 123 → **66 / 134**, MRR 0.127 → 0.125 — eleven more picks in the top 8 for two
thousandths of MRR, which is the trade a flatter, more honest top of the list makes.

**Tried and reverted.** Nested runs deliberately drop linear mode (*"the callee is a helper, not a
case-keyed method"*), which also drops the branch tracking. Turning it on for nested runs did
surface the stealth swap — and cost 127 recipe results, 31 materials and four tests. The comment is
right; the targeted second pass is the way. Separately, a fix to region pruning at a join (`A || B`
records its first jump before the second condition opens the region both lead to) was needed while
the tag route looked promising, then turned out to be both unnecessary and harmful — it moved Terra
Blade's gate — so it went too.

**Still wrong, and now measured:** the guides say Scourge's stealth strike throws **three** javelins;
`shoot.js` reads seven. That is making its stealth grade too generous, so fixing it will cost a
little of what these passes gained.

## Pass 8 — three weapons that felt wrong at post-Wulfrum (2026-09-04)

**"The Baseball Bat's projectiles don't pierce, they reflect off enemies."** Exactly right, and the
miner had it backwards. `BaseballPro` sets `penetrate = -1`, which the model read as infinite pierce
— but its `OnHitNPC` steers the ball back to the player so you can catch it. The general signal is
cheap and precise: **a projectile that sets its own velocity in the hit phase is not passing
through**. It bounces off, or turns round and comes home; either way its pierce is not a pass, so it
hits once. 101 of the 2035 weapon projectiles do it. Crude Bat 73/s → 49/s, #7 → #16.

**"The Sandstone Throwing Knife has heavy dropoff."** The arc factor compares the drop against the
boss's silhouette — `b.h / (b.h + drop)` — but the drop was being softened by an arbitrary ×0.35
first. Removing the softener is both the physical form and the better one: 66 / 130 → **68 / 133**
against the guides. Sandstone 89/s → 73/s.

**"The Gel Glove is fine, but you have to charge it and its gel is ground-based."** Diagnosed and
*not* modelled, deliberately. The tooltip confirms every word of it — *"Throws out a ball of gel
that bounces against surfaces / Can be charged to increase in damage, bounce amount, and size /
Overuse of this weapon exhausts you, massively reducing its damage"* — but none of the three is
readable as a number. `channel` is set on 451 weapons and on most of them it only means "hold to
keep firing", so it cannot stand for a charge-up; a projectile-side `Charge`/`DoneCharging` property
exists on just 36 types across the pack, mostly melee swing blades, and it says nothing about how
long the charge takes. Modelling "the gel rolls along the ground" would need a notion of whether the
boss is airborne, which is not mined. Its bounce *is* now counted (it changes course on hit), which
took it 101/s → 97/s, but the charge and the exhaustion are not.

Also from this pass, and worth stating plainly: two attempts at reading "this projectile returns to
its owner" were built and thrown away. The precise one — velocity assigned from something derived
from `player.Center` — catches 53 projectiles but not the baseball, which assembles that vector one
component at a time through a local struct the machine does not model. The loose one — reads the
owner's position *and* steers itself — catches 500, because reading where the player is turns out to
be something almost every projectile does. The hit-phase velocity store above is what actually
separates them.

Pre-hardmode 66 / 134 → **68 / 133**, and MRR 0.127 → **0.133**, the best of the project: four fewer
picks scraping into the top 8, but every class's picks sitting higher on average.

## Pass 9 — how far a thrown weapon actually reaches (2026-09-04)

**"The Sandstone Throwing Knife's range is just way too small — we need an expected reachable range
calculation."** The model had one and it was measuring the wrong thing: reach was `speed × lifetime`,
which for a knife living 300 ticks at 12 px/tick is 3600 px — the width of the world. A thrown knife
does not run out of *time*, it runs out of *height*. Falling `drop` px takes `sqrt(2·drop/g)` ticks
and it covers `speed` px in each of them, so its useful reach is `speed · sqrt(2·drop/g)`, with
`drop` the half-silhouette of what it is aimed at. Sandstone's 3600 px becomes 325 px against a
220 px throw, which puts it in the "only just makes it" band. **89/s → 27/s, #4 → #22** — the rank
the report asked for.

A seeker is exempt: it climbs back onto the target instead of sailing under it, so the arc stops
being what limits it. That is not a special case bolted on — it is the same reason its pierce keeps
its value, and without it Scourge of the Desert (gravity 0.2) fell to #22 as collateral. With it,
Scourge is **#5**.

**"Piercing should be scaled down with a heavy dropoff, since projectiles aren't likely to follow a
thrown direction — unless homing."** Extra hits were conditioned on the landing chance *once*, so
the tenth pierce was as likely as the second. They now fall off geometrically: each extra keeps
`PIERCE_KEEP` of the last one's chance, and a seeker keeps all of it. Sweeping the constant against
the guides: 1.0 (no dropoff) scores 69 / 131, 0.6 scores 68 / 134, 0.45 and 0.3 both score 135 with
MRR 0.133. Settled at **0.45** — the less extreme of the two that tie, and "each extra body is a bit
under half as likely as the last" is a statement about geometry rather than a fitted number.

Together: 68 / 133 → **70 / 135**, MRR 0.133 → **0.134**, no class down. Every rogue weapon named in
this and the previous pass now sits where the report put it — Sandstone #22, Crude Bat #23, Pod Bomb
#16, Scourge #5.

### Known gap

`Fishbone Boomerang` is still tagged `spear`. Its AI sets `heldProj` inside `if (ChargeProgress < 1)`,
and an isolated run of the interpreter over that method reports the store as conditional — but the
value still survives the full extractor, so something in the real machine's inlining is clearing the
region context. It is one item, the guard demonstrably works for 90 others, and the fix belongs in
`interp.js` rather than in a rule about boomerangs.

## Pass 10 — pierce is what a crowd is for (2026-09-04)

The report was about multi-target: **Throwing Brick at #11 is useless, Bolas at #7 is a single-target
weapon, and Lasting Pliers is a good multi-target weapon ranked #12.** Three answers, only one of
which needed a model change.

**"Are we counting the stealth projectiles in spam?"** No. The Brick's five fragments are spawned
inside `if (stealthStrike)`, the child carries `stealth: true` from Pass 7, and `childHits` skips a
child whose flag disagrees with the variant. What was actually wrong was the Brick's *gravity*:
`velocity.Y += MathHelper.Clamp(ai[1] / 40f, 0f, 1f)` ramps, and `Clamp` on an unknown value read as
UNKNOWN, so the miner recorded no gravity at all. A `Clamp` with an unknown value between two known
bounds now returns the midpoint — pessimistic in the sense that matters, since assuming a projectile
*doesn't* fall is the optimistic error. 349 → 351 projectiles with gravity, and **Brick #11 → #28**.

That fix is the whole of this pass's cost against the guides. **The figures first recorded here —
70 / 135 → 66 / 139 — were read off `dataset.json` while a mine was rewriting it**, and are void.
Re-measured on the settled dataset the whole of Pass 10 is **61 / 135, MRR 0.126**, and every change
in it is guide-neutral by construction (below). Any single guide-check run whose dataset mtime is
inside the last minute is worth nothing; check it before quoting a number.

**Bolas.** Already right for the stated reason: `ThoriumMod:BolasPro` carries both `sticks` and
`bounces`, so `hitsPerProjectile` returns 1 before it ever reaches the pierce branch. Its pierce is
already irrelevant. It sits at #11 in multi on damage alone, and gains nothing from the crowd while
everything around it does — which is the ranking the report asked for, reached without a rule about
bolas.

**Lasting Pliers**, and the general fix. Infinite pierce, a 38 px projectile, 250 px of reach — and
2.5 hits into a crowd of six. Two things were taking it apart:

- `PIERCE_KEEP` says each extra body is under half as likely as the last, which is right when there
  is one boss and the projectile has to *find* something to carry on into. In a crowd the next body
  is already in the path. This became `CROWD_SWEEP` in Pass 11, below.
- **The range term was being charged twice.** `landing().f` includes the "only just reaches" band,
  and that same `f` was the continuation probability for every pierce. A projectile that has arrived
  at the first body is standing *in* the crowd — what it cost to carry that far is paid once, on the
  first hit. `landing` now also returns `aim` (the same answer without the range term) and
  `hitsPerProjectile` uses that for the falloff. Guide-neutral, and the Pliers go **#12 → #8** at
  39/s → 68/s.

Both changes are about the same confusion: *reaching* the fight and *working* the fight are separate
questions, and the model was answering the second with the first's number.

Multi-target at post-Wulfrum then read Sand Dollar, **Gel Glove #2** (the report's "actually pretty
ok, but ground-based, so mostly multi-target" — and it leaves the single-target top 6, which is where
it was wrongly ranked #3), Scourge of the Desert, Ashen Stalactite, Antlion Skewer, Enchanted Knife,
Fishbone Boomerang, **Lasting Pliers**, with **Bolas #11** and **Throwing Brick #28**.

## Pass 11 — a crowd is not a bigger boss (2026-09-04)

**"Bolas should be after Lasting Pliers, and non-piercing weapons should be wayyy lower than
piercing weapons for multi targets — the Ashen Stalactite is at #3, along with the Sand Dollar which
reflects after the first enemy."** Pass 10 had made piercing weapons a little better in a crowd.
That was the wrong half of the problem: a single-hit weapon was not being *rewarded* for the crowd,
but it was not being *charged* for it either, so it rode its single-target throughput to the top of
a list about clearing six bodies. Two rules, both live only when `targets === 'multi'`.

**The geometric falloff is the wrong shape for a crowd.** It answers "having hit this body, will the
projectile find another" — and a crowd has already answered that: the bodies are in the flight path,
so the fourth is no harder to reach than the second, and the odds must not compound down. Worse, the
old form counted *hit opportunities* (`(1 + window/imm) × segments`, which mixes repeat hits on one
body with distinct bodies), and with the compounding on top a pierce-2 shot came out of six bodies
with **less** than it got out of one. Backwards, for the exact case its pierce was bought for. It
now sweeps distinct bodies at a flat rate: `(min(cap, segments) - 1) × aim × CROWD_SWEEP`, with
`CROWD_SWEEP = 0.6` — a projectile flying through a crowd reaches most of what is in its line, and a
crowd is not a neat line. A pierce-2 weapon now reliably gets its 2.

**A projectile that reaches one body is ignoring five.** `CROWD_WASTE = 0.6` is charged when
`hitsPerProjectile` returns without `spread` — which is every early exit and, deliberately, the
`passes` branch too: a boomerang's out-and-back is two hits on the *same* body, so it covers a crowd
no better than a dagger does. This is what actually reorders the list, and it is a ceiling (≤ 1)
rather than a bonus, so nothing inflates.

| | before | after |
|---|---|---|
| Lasting Pliers | #12, 39/s | **#4, 85/s** |
| Sand Dollar | #1, 131/s | #5, 82/s |
| Ashen Stalactite | #4, 87/s | #7, 64/s |
| Bolas | #10, 57/s | **#15, 34/s** |

Both asks land: Bolas is eleven places below the Pliers, and the two single-hit weapons named in the
report sit below every piercing weapon around them. `guide-check` scores in `auto` and never takes
either branch, so both were confirmed inert against it (**61 / 135, MRR 0.126**, unchanged) — which
also means neither is *measured*, only reasoned. Single-target is untouched.

### Two things left standing

**Gel Glove is #1 at 246/s**, 2.7× the next weapon. There is no compounding bug — it is one
infinite-pierce projectile, 24 damage every 18 ticks, 556 px of reach, so it pays no range band. The
brake is its charge-up, which the miner does not read and the model therefore does not charge. Same
class of gap as Lasting Pliers' own `"Overuse of this weapon exhausts you, massively reducing its
damage"`, which is in the mined tooltip and nowhere in the score. Fitting `CROWD_SWEEP` downward to
hide it would be pinning an item through a constant.

**Sand Dollar mines as `penetrate = -1`** — infinite pierce, not reflecting. It is ranked down here
by `CROWD_WASTE` because its `passes` branch covers one body, not because the model believes it
bounces. If it really does reflect off the first enemy, that is a miner lead (a `bounces` signal on
`SandDollarProj`, which reads `aiType: 272` and has no velocity store on hit), not a model one.

## Pass 12 — the Scourge, and three things the miner was not reading (2026-09-04)

**"Fix the projectile count of the Scourge of the Desert, and get it back to at least spot 3."** It
was #11. It is now **#1 single-target** at post-Wulfrum, and #2 in multi. Nothing about the Scourge
was pinned: four general fixes moved it, three of them in the miner.

**A loop's count needs its step.** `Shoot` fans the stealth strike with
`for (i = -5; i <= 5; i += 5)` — three javelins. The extractor read the backward compare, saw the
counter at 0 against a bound of 5, and assumed it moved by one: **seven**. Every fan that steps in
degrees was inflated the same way. `loopTracker` (in `projectiles.js`, shared by the three
extractors that count bursts) remembers where each local was written, so the counter's starting
value is recoverable and the step is what one pass moved it by. Guides **61 / 135 → 59 / 132** —
correcting an inflated count can only lower scores, which is the direction it should go.

**`SetDefaults` is not the last word on pierce.** The javelin's AI opens with
`penetrate = stealthStrike ? 4 : 2`, so the strike's copy is twice the projectile the ordinary throw
is. A ternary leaves the store at the join with no branch tag, so the value cannot be attributed by
tag — but an AI raising pierce above the `SetDefaults` number, in a type that reads the stealth flag
at all, is the stealth copy being made stronger. It is recorded as `stealthPen` and applied only to
the strike, so the reading can only ever under-credit. Five projectiles across all mods carry one.
**59 / 132 → 61 / 132.**

**A seeker keeps coming back.** *"The projectiles live REALLY long — long enough until the next
stealth strike — and since they home constantly and fast, we get constant attacks even at stealth."*
Exactly right, and measurable: the javelin lives 600 update-frames at `extraUpdates = 1`, which is
300 ticks, and the strike is one per 5 s. Its time on target is its remaining life, not one 6-tick
fly-past. This was tried in Pass 9 and measured worth nothing — on data where the pierce read as 2
and the strike threw 7. With both read correctly it is worth **61 / 132 → 63 / 132**. The pierce cap
is what keeps it bounded: a seeker with four hits in it still only gets four, however long it hunts.

**A boomerang cannot hit past where it turns round.** The report's supporting half was that the Sand
Dollar is *"too slow for the short range it has"*. The model already charged it a round trip to
`THROW_OUT` (300 px) for its firing rate — and then let it land hits at 1470 px, because reach was
read off lifetime and gravity alone. Two answers to one question. Feeding the turn-around through
the same range band as any other reach limit is right for the same reason the band exists: vanilla's
boomerang AI decelerates to a stop before it reverses, so a throw whose limit is 300 px is already
crawling at 220. **63 / 132 → 64 / 131**, and the Sand Dollar goes #1 → #10 (135/s → 54/s).

Post-Wulfrum rogue, single target: **Scourge of the Desert #1** (93/s, stealth), Ashen Stalactite,
Gel Glove, Thorium Dagger, Fishbone Boomerang. Multi: Gel Glove, **Scourge #2**, Enchanted Knife,
Lasting Pliers.

### Not chased

The Ashen Stalactite's report — *"disappears too fast at spam, the drop makes it hard to aim, and at
stealth it's too slow and drops too hard"* — is already what the model says: its projectile lives 25
ticks, and its stealth throw lands `reaches 345 px of 375 ×0`, a flat miss. It scores what it does
off its spam grade and a death-burst of six debris. It sits at #2 rather than lower because the
weapons around it fell, not because it was defended.

`childHits` prints that death-burst as `×108` when the parent itself landed nothing. The *value* is
right — an on-death child of a throw that missed is priced at `blast / 2·bossWidth`, which is 6% here
— but `step()` divides by a floor of 0.01 when the parent contributed zero, so the printed multiplier
is nonsense. The parts still multiply out; they no longer explain. Display bug, not a scoring one.

## Pass 13 — the factors stopped multiplying out (2026-09-04)

**"The stealth calculation of the Contaminated Bile looks a bit scuffed."** It was, and so were 221
of the 464 pre-hardmode grades: their factors did not multiply out to the score they explain. Rule 2
of this document — *every factor stays explainable, and the `parts` contract must multiply out* —
was quietly false for nearly half the pool. Three separate bugs, all found from the one report.

**A grandchild's hits were added to the total with no part at all.** `childHits` recursed, added
`deeper.hits * n * reachShare` to the running total, and threw `deeper.parts` away. It also priced
the grandchild at its own `dmgMul` rather than that share *of its parent's* share, so the acid a
Contaminated Bile's blast leaves behind was worth half the weapon's damage instead of a fifth. Both
are fixed by carrying a `scale` down the recursion: everything already paid to get there — how many
of the parent there are, how often it arrives, what share of the damage it does — so the grandchild
is worth its own share of *that*. The bubbles are stealth-only, which is why only the stealth chain
was visibly wrong.

**A contact swing divided by a floor of 0.01.** `(hps + swingHps) / Math.max(0.01, hps)` — and for a
weapon that fires nothing, `hps` is exactly zero, because it is `useRate × perUse`. The Sandstone
Scimitar's swing printed as **×364**. The chain at that point carries the use rate, not `hps`, so
that is what the factor divides by; where the chain really is at zero (it shoots, and none of it
lands) the part restates the number instead of scaling it. **110 of the 217 remaining failures.**

**A debuff replaced the score instead of adding to it.** A DoT part was emitted as `{ value: dot }`,
and a `value` part *resets* the running number — so a Spore Knife's factors multiplied out to its
poison and none of the knife. It is a `mul` of what it adds now, which also reads better: `Poisoned
(12 DPS) ×1.15`. The stealth grade gets its own, computed against the strike rather than the spam.

Measured over every pre-hardmode grade, factors that fail to multiply out within 3%: **221 → 18**
(exact), or 33 as displayed, where the rest is `r1`/`r2` rounding in the labels themselves. Guides
64 / 131 → **64 / 130**; the only real value change is the grandchild damage share.

### The 18 that are left, and why they need a different fix

They are all one shape: **the shot missed and its children did not.** A bomb thrown further than its
flask can carry lands a literal `×0` for range, and the blast still goes off where it fell and
reaches back — priced honestly at `blast / 2·bossWidth`. The score is right. The factors multiply to
zero, because nothing recovers from a zero. A multiplicative chain cannot express "this term applies
to the parent only"; saying it needs an additive part kind, not another constant, and that is a
change to the contract rather than a fix under it.

The Contaminated Bile still prints its blast as `×16.11` for the same reason — the flask lands 17%
of the time and the explosion is the weapon. That number is now arithmetically correct and still
unreadable. Same root, same fix, same reason it is not in this pass.

## Pass 14 — the stealth grade, and what the guides' two lists actually mean (2026-09-04)

**"We still have a `reaches 364 px of 398 ×0`, and stealth still comes out far worse than spam when
the guide says it should be better."** Two things, and the first is a plain bug.

**The model was walking the player somewhere its own shot could not reach.** `closeIn` and `landing`
both answer *how far does this carry*, and they answered it differently: `closeIn` allowed a flat
`DROP_TOLERANCE` of 55 px, `landing` allows the boss's half-height (50), and `closeIn` used the
item's base throwing speed while `landing` uses the speed of the variant actually being graded — so
a stealth strike thrown faster was measured at the wrong one. The player was placed at the first
answer and scored against the second, and where the two straddled the engagement distance the result
was a flat **×0**. `closeIn` now measures it exactly as `landing` does, per variant. One of forty
pre-hardmode rogue weapons had a stealth grade zeroed this way, and the Gel Glove's stealth grade
was literally `0`. Guides **64 / 130 → 65 / 131**.

**Children of a multi-projectile group were counted once for the whole group.** Each projectile in a
fan spawns its own, and `CHILD_CAP` is written per projectile — but `group()` added one group's
worth and capped the fan at a single throw's allowance. This falls entirely on multi-projectile
stealth strikes, which is what a rogue weapon is usually picked *for*: the Feather Knife's four-knife
strike went **43/s → 84/s**. Children are now counted for one projectile and multiplied back up,
which leaves the step ratios untouched, so the parts still multiply out.

**A stealth strike is a burst, and was being held to a sustained limit.** Everything a weapon throws
shares the player's 10-tick immunity window, capping it at 6 hits/s on one body — but a strike lands
its whole burst and then waits out the recharge, so what the window allows it is the recharge's
worth of ticks, not one use's. Read off the use rate it capped a strike at `6 / rate` hits: four, for
a weapon thrown every 40 ticks. **+2 top-8.**

Together: **65 / 131, MRR 0.125**, mode agreement 124/151.

### What the guides' two lists mean, which is not what it looks like

The `stealth` role comes from the guides' own `'''Stealth'''` headers. It is not a claim that the
stealth strike out-damages spam on that weapon — **92 of 338 weapon+tier entries are listed under
*both* headings**, so for those the model is wrong by construction whichever mode it names. Feather
Knife, Contaminated Bile, Gel Dart and Ashen Stalactite are all dual-listed. Counting only picks the
guides put under one heading, the model disagrees on **14 of 18** stealth picks, not 38 of 44.

That is still a real disagreement, and the obvious lever does not fix it. A stealth-playing rogue is
modelled as fighting at 420 px against spam's 220, which costs every stealth grade about a quarter of
its landing. Bringing that in was swept — 220, 260, 300, 360, 420 — and **420 is the best value on
every measure**: top-3 65 against 63, MRR 0.125 against 0.122, mode agreement 124 against 118.
Closing the distance does make stealth grades bigger, and makes the guides agree less. It stays.

### Read out of Calamity while checking this

- `BalancingConstants.BaseStealthGenTime = 4`, `MovingStealthGenRatio = 0.5` — four seconds to fill
  standing still, eight moving. `STEALTH_RECHARGE = 5` sits between and already leans generous.
- `ConsumeStealthByAttacking` spends the whole bar (half with `stealthStrikeHalfCost`), so one strike
  per fill is right.
- `ProvideStealthStatBonuses` is `rogueStealth × UniversalStealthStrikeDamageFactor × timeFactor ×
  genFactor`, which is what `stealthMultiplier` already computes.
- **`UpdateStealthGenStats` returns 0 while `Player.itemAnimation > 0`.** Stealth does not build
  while you attack, so spam and stealth are strictly exclusive and adding them is wrong on the
  mechanics. `max` was re-measured with this pass in place and is worse (64 top-3 against 65). A
  player is not the worst case of either — they throw, break off to dodge, and stealth fills the
  gaps. Additive stays, on the measurement rather than on the mechanic.

## Pass 15 — time on target had no diminishing returns (2026-09-04)

**"`infinite pierce: 55.3 hits (543 ticks on target, 10-tick immunity)` — ×55.33 seems excessive,
especially against a single target."** It was, and Pass 12 built it: giving a seeker its whole
remaining life as time on target was right, but the hits it buys were counted linearly, one per
immunity window, for as long as the projectile lives. `SOTS:NatureSpirit` homes, so `keep = 1` and
the geometric decay is skipped entirely — and its 600-tick life is `LIFE_UNKNOWN`, a default, not a
number the miner read. A guess divided by a cooldown, paid in full.

Repeat hits now saturate: `soft = R·repeats / (R + repeats)`, where `R` is how many times one
projectile realistically re-connects with the same body before the fight has moved on. The fight
moves, a seeker overshoots and has to come back, and other projectiles are competing for the same
window. Two values, which is the report's *"care less if the projectile doesn't home and multi-target
isn't on"*: **`RECONNECT_SEEK = 12`** for something that steers back onto the target, **
`RECONNECT_PLAIN = 2`** for something that has to drift back into it by luck. Multi-target is
untouched — `segments` still multiplies, because a crowd is more bodies rather than more time.

Nature Spirit Staff, single target: **55.3 hits → 10.8**. Both constants were swept (seek 6/9/12/18/30,
plain 2/3/5/8) and the metric is flat across the middle of both ranges; the more pessimistic of the
tied values was taken each time. Guides 65 / 131 → **65 / 132**, MRR 0.125 → 0.124.

**The 100-hit cap the report asked for is not there**, because after the curve nothing reaches it.
The largest surviving count anywhere in the pool is 43.3 hits, and that is a homing infinite-pierce
shot against a four-segment worm — `segments` multiplying, which is the case pierce is genuinely
for. A constant that never binds is not a guard, it is dead code; if a projectile that truly ignores
immunity frames ever turns up, the curve is where it belongs.

## Pass 7 — the numbers the model was reading were not the numbers it thought (2026-09-03)

Two diagnostics, both new, and both aimed at the same question: *which factor is burying the guides'
picks?*

1. **Every pick sorted by where the lab buries it, printed with the three parts doing the burying.**
   Not "why is this weapon low" one at a time — the whole pick set, with the multiplier named.
2. **The geometric mean of each factor over the picks against the top-8 weapons no guide names**, per
   class (pass 2's measurement, re-run per factor rather than per bucket).

Both pointed at the same two columns. `range` had a geometric mean of **0.04 on magic's picks and
0.09 on bard's** against ~1.0 on the pool, and `travel` was charging picks 90 to 600 ticks of lead.
Seven picks scored 0/s. Neither was a preference the guides hold; both were the model reading a
mined field as something it is not.

### What the fields actually were

**`shootSpeed` is a launch speed, not a cruising speed.** 96 weapons in the pool launch under 4
px/tick and almost all of them read exactly `0.1` or `1`, against a real distribution that starts at
4 — those are projectiles whose AI takes over the instant they exist: Demon Scythe accelerates from
0.2, a summoned knife homes from 1, a scythe swings on its own ai from 0.1. Read as a cruising speed
it gave them 90–600 ticks of travel lead *and* a reach (`life × speed`) that ends inside the player,
so the range band fired too. `SHOOT_SPEED_MIN` treats anything under 4 as unread, exactly like an
absent `shootSpeed`. **+4 top-3, +6 top-8** — the largest single move of the pass, and it is one
comparison.

**A child spawned with `0` damage is not a hit.** `c.dmgAbs ? null : 1` is falsy at zero, so a child
whose `NewProjectile` passes a literal `0` — a blood splatter, a sparkle, the bell a Thorium
accessory rings — counted as a *full extra hit of the parent's damage*. 332 of the 1932 children in
the pool are that, across 205 weapons; Betrayer's Knife was more than doubled by a visual effect.

**A ×15 damage multiplier is a branch, not a multiplier.** Wyvern's Call reads `dmgMul: 15` and
scored 6,490 DPS at Wall of Flesh, thirteen times the next magic weapon. The IL says the ×15 is real
— and applies to the one branch in ten that fires a wyvern instead of a feather, which the linear
machine cannot see, so it hands the ×15 to the feather. Calamity pays a projectile fifteen times the
weapon's damage *because* it is rare. The pool's multipliers run ×2, ×3, ×4 and then jump to 9, 10,
15, 35, 50: above `DMG_MUL_MAX` the number is evidence of a branch and the projectile does the
weapon's damage.

**A sword swings on its animation, not on its use time.** `Player.ApplyItemAnimation` starts the next
animation as soon as the last ends; `ApplyItemTime` only decides how often the item *acts* inside
one (read from the tML IL, `ItemCheck_Inner` → `ApplyItemTime` → `SetItemTime`). So a sword whose
`useTime` outruns its animation still swings every animation and merely drops its star less often —
`max(useTime, useAnimation)` halved Starfury, Ice Blade, Enchanted Sword, Scythe, Seashine Sword and
Life Quartz Claymore, two of them guide picks. The swing now has its own clock and adds to whatever
the weapon fires. **+2 top-3, +1 top-8**, all melee.

### What the *types* actually were

**A whip is swung, not thrown.** Leather Whip was paying `4 px/tick over 220 px (55 ticks of lead)`
×0.38 for a lash that is over in half a second: its `shootSpeed` is how fast the lash extends. Travel
lead, the gravity arc and the range check all describe a free flight, so an `ATTACHED` type — whip,
spear, minion, sentry — skips them and keeps only its `REACH`. (Extending that to the contact types
as well — a yoyo, a beam — is better physics and measured 4 top-8 *worse*, so they still fly.)

**A whip's tag adds; it does not multiply.** `hps × (1 + tag)` made Split Firebrand, whose lash also
sprays twelve projectiles, worth three times that spray — but what the minions add does not depend on
how many projectiles the lash throws. It is a fixed number of minion hits carrying a fixed share of
the whip's damage, so `tag` is now hits per second and the pre-hardmode summon list stopped being
seven whips.

**A bow is a bow before it is anything it holds.** `archetypeOf` tested the held/placed aiStyles
before the ammo, so a charge bow that puts a drawn-bow sprite in the player's hands (`heldProj`, held
aiStyle) was scored as a beam held on the boss. `useAmmo` is the louder fact and is read first.

**A beam held on a boss hits on the player's window.** The contact path required the projectile to
own a hit cooldown, so anything without one fell through to the use-time path: the Vilethorn, a wall
of thorns standing inside the boss, scored one hit per cast. Without a local cooldown the game uses
`npc.immune[owner]`, which is the same 10 ticks the model already calls `IMMUNITY` — *and* which is
one clock for everything the player throws, so a second such projectile is queueing rather than
starting another. Both halves had to land together: the fallback alone cost 7 top-8, the shared
clock gave 4 of them back.

### Also corrected

`childHits` printed every child as `×(1 + its own hits)` when children *add* — a Thorium instrument
with five of them read as `×593` on the item card while the five together are worth `CHILD_CAP`.
They are now cumulative, so the parts multiply out to the number above them, which is this
document's rule 2. And `RANGE_EDGE`: the band's flat `0.1` floor said a weapon used at its own
maximum range lands one shot in ten, on top of `hitsPerProjectile` already bounding its extra hits by
the life left on arrival. 0.1, 0.3 and 0.5 measure identically and dropping the band costs 8 top-8,
so the band stays at the value that is defensible rather than the one that reads as a delete.

### What was tried and rejected

- **Walking the player in to half the weapon's reach** instead of to its edge. It is what a player
  does, the comment in `realDps` already claimed it, and it cancels the range band — and it costs
  3 top-8, because it promotes short-ranged weapons neither guide names. The comment was corrected
  to match the code rather than the other way round.
- **A softer mana sustain** (floor 0.5, 0.65). Costs magic 3 top-8 each. The pessimistic 0.35 is
  what the guides agree with.
- **Discounting tools.** 94 weapons carry mining power and no guide pick is one of them, which
  looked like a free rule — but they hold **0 of 288** pre-hardmode top-8 slots, so there is nothing
  to fix. Mining `axe` and `hammer` alongside `pick` was tried for the same reason and read nothing.

### Where it landed

Measured against the same dataset, so the archetype change above is in both columns (on its own it
cost ranged 2 top-8, which is the pool re-sorting around a correct tag).

| pre-hardmode | before | after |
| --- | --- | --- |
| top-3 / top-8 of 508 | 64 / 121 | **68 / 129** |
| MRR | 0.127 | 0.128 |
| melee | 5 / 10 | **7 / 11** |
| magic | 10 / 15 | 10 / **21** |
| summon | 26 / 45 | 26 / **46** |
| ranged | 8 / 14 | **9** / 14 |
| rogue | 8 / 20 | 8 / 20 |
| bard | 7 / 17 | **8** / 17 |

No class regressed. Whole run (43 tiers): 125 / 268 → **123 / 276**, MRR 0.072 either way, and the
EARLY leads fall 52 → 44. The two top-3 traded away are past Golem, where the pool is thickest and
the tuning set does not reach.

## Pass 8 — where the player is standing (2026-09-04)

The complaint: *Sahara Slicers' engagement range is far too low and risky for it to rank that high.*
It is a pair of Calamity daggers whose own tooltip says **short range**, marked `†` — *risky to use* —
by the guide that lists it, and the lab had it in melee's top 4. Chasing the item found four defects,
none of them about that item.

**The engagement distance measured nothing inside melee.** Sorting every guide pick by the distance
the model makes the player stand at, against whether the guide marks it `†`, says the mark tracks
distance well overall (median 80 px for the risky picks, 340 px for the rest) — and not at all inside
melee, where **136 of the 178 melee picks sat at exactly 80 px**. `ENGAGE.melee = 80` is not how far
a melee player wants to stand; it is how far a broadsword reaches, baked into the class. With the
class preference and the weapon's reach collapsed into one number, neither could separate a yoyo on a
300 px string from daggers you have to stand inside the boss to use. `ENGAGE` is now the distance a
class would *rather* keep and nothing else; `REACH` and the projectile's own reach do the pulling in.

**And nothing charged for being pulled in.** `RISK.melee` was 1 — the one factor that tells a contact
weapon from a reach weapon was switched off for the whole class, which is the class the guides mark
`†` most (19 of the 30 risky picks). Worse, `risk` was a cliff (`D < 150`), so it could only answer
yes or no when the whole question is *where along the way in* you end up. It is now the share of the
way in, priced for every class:

```
risk = 1 − (1 − RISK[cls]) × (1 − D / what the class wanted)
```

Measured against the mark it is meant to be: a `†` pick now averages 0.914 where a plain melee pick
averages 0.945, and the same gap holds in every class. That is the validation, not the ranking.

**A weapon is what everything it fires says it is, not what `Item.shoot` says.** `archetypeOf` only
ever saw the default shot. Sahara Slicers names its *right-click bolt* there and stabs with a pair of
held blades spawned in `Shoot`, so a contact weapon was tagged `shot` and scored as something thrown.
Reading every projectile the weapon spawns is worth **+7 top-8 on its own**, across every class.

**`TrueMeleeDamageClass` is Terraria's own word for "this hits at contact range".** A held projectile
carrying it is a blade in your hands, not a beam across the room, and `REACH.held = 180` was written
for beams. All 36 weapons the tag finds are contact weapons — the drills, Old Lord Claymore, Sahara
Slicers — so they get their own `truemelee` type at 80 px.

**Two clocks that were being confused.** `localNPCHitCooldown = -1` means *once per NPC, ever*;
a projectile with no cooldown at all means *the player's 10-tick window governs*. `localOf` mapped
both to null, so a blade that hits once per swing was being paid six hits a second: Old Lord
Claymore, whose tooltip says **"a slow but powerful blade"**, scored 719 DPS on a 90-tick swing. It
is 57 now, which is what 100 damage once every 1.5 s is. And `uptime` — the share of the fight a
weapon type is on the boss at all — was read only on the contact path, so a type that fell through to
the use clock quietly got its uptime back and scored *higher* than the same weapon with a cooldown.
It belongs to the type, so it now applies whichever clock the hits came off.

| pre-hardmode | pass 7 | pass 8 |
| --- | --- | --- |
| top-3 / top-8 of 508 | 68 / 129 | 66 / **135** |
| MRR | 0.128 | **0.129** |
| melee | 7 / 11 | 4 / **12** |
| ranged | 9 / 14 | 8 / **16** |
| magic | 10 / 21 | 10 / **22** |
| rogue | 8 / 20 | **9 / 22** |
| summon | 26 / 46 | **27** / 46 |
| bard | 8 / 17 | 8 / 17 |

Melee's three lost top-3 slots are Old Lord Claymore, and they are the correction working: the guides
list it because 100 damage is a large number at that tier, not because it out-damages everything.
Starfury moved the other way, #13 → **#3** at pre-boss.

### What was tried and rejected

- **`rides`, a projectile that keeps setting its own centre from the *player's***, mined as the
  mirror of the existing `sticks` rule. It reads 208 projectiles — stored ammunition, orbiting
  familiars — and changed the metric by exactly zero, so it was removed rather than left as a field
  nothing consults. It also did not catch the case that motivated it (see below).
- **One `CHILD_CAP` budget per use** instead of per projectile group. It is the more honest reading
  of what the cap is for, and it only touches 18 weapons — but it costs bard 3 top-8, because
  Thorium's accessory procs ride *every* bard projectile (the known gap from pass 2) and a shared
  budget squeezes them hardest. Reverted.
- **Sweeping the two new knobs.** `ENGAGE.melee` ∈ {180, 260, 340} and `RISK.melee` ∈ {0.6, 0.8, 1}
  all land within one top-3 of each other, so the metric does not choose. 260 sits just above a
  flail's reach and just under a yoyo's — the two weapons a melee player uses to *not* stand in the
  boss — and 0.8 is a fifth of the fight spent dodging rather than attacking, for the class wearing
  the armour. Both are the defensible value rather than the best-scoring one.

### Pass 8b — a weapon is a set of attacks, not one attack

The residual on Sahara Slicers was not about range at all, and chasing it found the general shape
behind half of the defects in passes 7 and 8: **the model flattens everything a weapon does into one
simultaneous attack.** `dmgAbs: 0` paid as full damage, a ×15 that belongs to one branch in ten, two
`Shoot` regions averaged as if a coin decided which fired — all the same error.

The clearest instance is the one the game marks itself. `Player.altFunctionUse` is the right click,
and Sahara Slicers' `Shoot` branches on it at *instruction 1*:

```
CalamityMod.Items.Weapons.Melee.SaharaSlicers
  AltFunctionUse(1)
  Shoot(7)
      1  ldfld  Terraria.Player::altFunctionUse
```

That is the same shape as the `StealthStrikeAvailable()` guard the miner already turns into a tagged
region, so `stealthRanges` became `guardRanges` — the region arithmetic shared, the detector the only
difference — and `altRanges` reads the second guard with it. 110 weapons in the pool branch on the
right click. Each call now carries which click fires it, the model grades the two separately, and
**a weapon is worth its better click rather than their sum or their average**: two attacks the player
chooses between are not two that happen at once. Stealth stays additive, because stealth builds back
*while* you throw; the clicks do not.

That leaves the resource loop, and the same tagging answers it. Sahara Slicers' daggers hand you
*two bolts per hit, up to ten*, and its right click throws `SaharaSlicersBolt` — the very projectile
the blades spawn on hit. So the rule is mechanical and general: **an on-hit child that the weapon's
other click throws is ammunition this attack is stocking, not damage it is dealing.** Counting it
here and again as the other attack pays for the same projectile twice.

| Sahara Slicers, pre-Hive-Mind | rank | value |
| --- | --- | --- |
| start of pass 8 | #4 | 330/s |
| archetype, `local: -1`, engagement, risk, true melee | #4 | 242/s |
| **attack modes and stocked ammunition** | **#20** | **90/s** |

### Also, one conflation that had been hiding in plain sight

`dmgMul: c.dmgMul !== 1 ? c.dmgMul : undefined` — a child spawned with *exactly* the parent's damage
was written as "no share", which is the same field the miner uses for "the damage argument could not
be followed". Told apart: 472 children really are ×1 and only 94 are unread. That is a smaller gap
than it first looked (the naive count said 566), and the unread ones now take the median of every
share the miner *could* read, 0.5, which is a number out of the pool rather than a guess.

### What it cost, and the gap that is left

Taking the better click rather than the sum is a small *loss* against the guides: pre-hardmode
66 / 135 → 66 / 134 (the one slot is Sahara Slicers itself leaving the top 8), whole run 125 / 283 →
124 / 279 with the same MRR (0.074) and four fewer EARLY leads. The guides recommend some weapons for
what their two clicks do *together*, and the model now scores only the better half. That is the trade,
and it is taken because averaging two deliberate modes as though a coin decided which fired is not a
defensible thing for the model to do, whatever it scores.

The gap that is left is the loop. Where one click stocks what the other spends, the two are not
alternatives at all — the player alternates, so the real answer is `f·left + (1−f)·right` for some
split of the fight, which sits *between* the two modes. `max` is therefore the optimistic end of that
range rather than a floor; pinning `f` needs the stock limit ("up to 10"), which is a counter in the
projectile's AI that the interpreter does not follow.

## Pass 9 — a rebalancing hook's scope is a mined condition too (2026-09-04)

The complaint: *Pearl Pike is horrible, roughly a Trident, and the lab has it at #2 melee.* Chasing
it did not find what it was pointed at, and found something larger on the way.

**`AppliesToEntity` was read only on its `return true` paths.** A `GlobalItem`'s scope is usually
written as a list of bail-outs, and `CalamityBardHealer.ItemBalancing` — the hook that doubles every
Thorium melee weapon's damage — is exactly that: after the mod check it names nine spears and
thirteen swords it skips when `ThoriumRework` is loaded, then every `Phasesaber` and `Phaseblade`,
then Blood Orange rarity, then pickaxes, axes and hammers. Reading only the including paths collapsed
that chain to its last comparison and resolved the scope to **"any Thorium item that is not Pearl
Pike"** — nearly the whole mod.

The information was never missing; it was on the *other* return. A `return false` guarded by
`name == X` says X is excluded as plainly as anything can, and the miner was discarding those paths
(`else if (v !== 0 …)`). It now collects them and narrows each including group by whatever a bail-out
holds beyond what every including path already required — one extra condition negates exactly, a
conjunction of several does not (¬(A∧B) is a disjunction) and is left alone, and so is one the
matchers cannot express. `classNameEndsWith` was added because two of the bail-outs are `EndsWith`.

Pass 3 checked this hook and concluded the ×2 was "correctly read": `AppliesToEntity` does return
false for any mod but Thorium, and it does double what it applies to. What it did not check was
everything the hook says *after* that first clause.

24 items lost a doubling they never had, among them Lodestone Claymore (144 rather than 288 — it was
melee's runaway top weapon in early hardmode), Prime's Fury, Titan Sword, Dragon's Tooth and every
Phaseblade. Pre-hardmode MRR 0.129 → **0.132**, top-3 and top-8 unmoved.

### And the weapon that started it

Pearl Pike is *not* one of them, in the end. Its 48 damage does not come from the doubling — the
hook skips it by name — but from `ThoriumRework.ItemChanges.SetDefaults`, read straight out of the
IL:

```
383  ldstr  "PearlPike"
398  bne.un.s → 426
401  ldc.i4.s 48      stfld Item::damage
410  ldc.i4.s 24      stfld Item::useAnimation / useTime
```

`InfernalEclipseAPI` then trims the use time to 22. So 48 damage every 22 ticks is what this modpack
gives the weapon, the lab's number is faithful to it, and no scoring change will move it while that
holds. One thing is unresolved and is the place to look next: `ThoriumRework.ItemChanges`'
`AppliesToEntity` delegates to a 2,871-byte `AppliesToItem` that gates each rework behind its own
config field, and the miner cannot follow it — every comparison is against
`thorium.Find<ModItem>("X").Type`, which the interpreter does not resolve, so the whole method comes
back unresolved and the scope defaults to *open*. Every one of ThoriumRework's 53 item reworks is
therefore applied without its gate being read. (The config values themselves are not the gap: all 38
config reads in the pack resolve, from the player's own JSON or a `[DefaultValue]`. Reading the
config class's constructor for field initialisers was tried and found nothing to read.)

If Pearl Pike shows about 22 damage in game rather than 48, the rework is off and that gate is the
bug; if it shows 48, the pack really does hand a pre-boss spear those numbers and the lab is right
to rank it.

### Pass 9b — a pickaxe cannot be made of the ore it unlocks

The better reading of the same complaint: *the ore needs a pickaxe that needs a dead evil boss, so
this is a progression bug.* Following it found a circle. Thorium's **Aquaite** needs pick 65, and the
miner's answer for what mines it was the **Hydro Pickaxe** — which is crafted from Aquaite Bar, which
is smelted from Aquaite. The staging fixpoint starts everything at zero, so a cycle simply keeps its
seed and the whole chain settled at pre-boss on its own authority.

`infer.js` already refuses circular evidence one step in (`isDecraftLoop`, and "a pickaxe staged by
rarity alone is a guess and cannot vouch for an ore"). This is the same rule one step further out:
**a pickaxe whose recipe eventually consumes the ore it would mine cannot be the reason that ore is
reachable.** `craftNeeds` walks the ingredient closure, and the ore round skips any pickaxe that
fails it.

Pre-hardmode 66 / 134 → **68 / 133**, MRR 0.132 → **0.133**.

It does *not* move Pearl Pike, and the reason is worth writing down rather than arguing with. Once
the circular answer is refused, the next pickaxe with 65 power is SOTS's **Frigid Pickaxe**, crafted
from Frigid Bar, which `GemStructureWorldgenHelper.FillChestsWithLoot` puts in gem-structure chests
at world generation. In vanilla and Thorium alone the complaint is exactly right — pick 65 is the
Nightmare/Deathbringer threshold and that means a dead evil boss — but SOTS adds a pre-boss route to
the same power, and the lab is reporting that faithfully. (The two other Aquaite weapons sit at Eye
of Cthulhu for an unrelated reason: they also need Depth Scales. Pearl Pike's other ingredient,
White Pearl, drops from Oysters pre-boss.)

What the lab genuinely cannot see is that a chest in a deep gem structure is *reachable* pre-boss
without being *practical* pre-boss. That is the same shape as the Ice Bow sitting at pre-boss on
`worldgen: AddBuriedChest`, and it is a pool question — how hard a thing is to go and get — rather
than anything the DPS model or the stage graph can answer from the code.

### Pass 9c — the recipe really does have the evil material in it, and here is why the lab could not see it

Two passes were spent arguing about a recipe the lab was reading wrong. The in-game Frigid Pickaxe
costs **12 Frigid Bar and 6 Shadow Scale / Tissue Sample**; `FrigidPickaxe::AddRecipes` is 33 bytes
of IL and says only `AddIngredient<FrigidBar>(12).AddTile(16)`. Both are true — the evil material is
added by a different mod, in a form the miner could not follow:

```
InfernalEclipseAPI.Common.Balance.Recipes.InfernalRecipeSystem::AddRecipeGroups
    EvilSkinRecipeGroup = new RecipeGroup(() => "…", 86, 1329)     // Shadow Scale, Tissue Sample
    RegisterGroup("LimitedResourcesRecipes:EvilSkin", EvilSkinRecipeGroup)

InfernalEclipseAPI…InfernalRecipeSystem::PostAddRecipes
    sots.TryFind<ModItem>("FrigidPickaxe", out item)
    if (recipe.HasResult(item)) recipe.AddRecipeGroup(EvilSkinRecipeGroup, 6)
```

Three separate misses, all now fixed:

1. **A group parked in a static field was never registered.** `extractRecipeGroups` read
   `RegisterGroup(name, group)`, but this mod stores the group in a static field *first* and reads it
   back on the next line. Static field stores were not tracked, so `RegisterGroup` was handed an
   unknown and the group did not exist at all. Groups 49 → **55**.
2. **`AddRecipeGroup` only understood a string.** Here the argument is that static field. It now
   resolves through `groupFields` — the same field → group-name table `extractRecipes` already used.
3. **My own search was looking for the wrong id.** `ItemID.TissueSample` is **1329**; 3212 is the
   Shark Tooth Necklace. Scanning every method in all 76 mods for "86 and 3212" found nothing and I
   reported the recipe as unchanged twice. The lesson is cheap and worth writing down: check the
   constant before trusting a negative result from a scan built on it.

The Frigid Pickaxe is now **stage 11**, `craft: any EvilSkin (Shadow Scale)` — behind the evil boss,
exactly as reported.

### …and the heuristic it lets us delete

Pass 9c originally shipped a rule that a pickaxe whose materials only turn up in worldgen chests
cannot vouch for an ore. It was written to get Aquaite behind the evil boss without knowing *why*,
and it cost three guide picks (Black Glass Band, Spirit Glyph, Bellerose, all `craft: Obsidian`).
With the real recipe read, the Frigid Pickaxe is gated on its own evidence and the heuristic is
redundant: removing it is exactly neutral on the weapon metric (123 / 271 either way) and takes 7
picks off "staged later". Deleted. A heuristic standing in for a bug is worth keeping only until the
bug is found.

Aquaite stays at Eater of Worlds / Brain of Cthulhu and Pearl Pike at stage 6, now for a reason that
survives inspection.

## Pass 10 — a class's loadout is more than one pick (2026-09-04)

Rogue has had two grades since pass 6 — a weapon is worth its stealth strike *or* its spam, and the
tag says which. The other classes wear more than one thing at a time and were being ranked as if
they did not.

**A summoner equips a whip *and* minions *and* a sentry.** The scoreboard has known this since pass
5 (`SUMMON_KINDS`); the model did not, so `mode` was null for whips and the app ranked all three in
one column where the whips simply out-DPS'd the minions they exist to buff. `mode` is now the
archetype for every summon weapon, the loadout lists them by slot, and the scoreboard grades the
guides' `minion` / `sentry` roles against it — the guides have no whip column, so a whip filed under
`minion` counts as agreement. **332 / 356**, against 0 / 0 before.

**A whip behind a spawner is still a whip.** Catalyst's Congealed Duo-Whip shoots a `DuoWhipSpawner`
whose only job is to lash with two whips of its own, so the weapon's own projectile carries neither
`whip` nor aiStyle 165 and it read as a *beam* — 513/s, the top summoner weapon of early hardmode.
`SummonMeleeSpeedDamageClass` is Terraria's own word for whip damage and it survives the indirection,
so the whip test now reads it, and reads one level of children for it. 76 whips → **90**; summon
top-3 47 → 49, top-8 99 → **107**.

**A gun and its ammo are two picks.** `bestAmmo` handed every gun the strongest round obtainable at
the stage, which graded a Musket as if the ammo box were already full of Crystal Bullets and buried
the ammo's whole contribution inside the weapon. An `AmmoID` constant *is* the item id of the ammo it
is named for — `Bullet` is 97, the Musket Ball; `Arrow` is 40, the Wooden Arrow — so the plain round
of a kind needs no table. Weapons are graded on that and tagged with it; the ammo is ranked
separately, inside its own kind, by what the best gun of that kind does with it. 70 guide ammo picks
stop being *"missing from dataset"* (412 → 342) and get their own line: **17 in the top 3 of their
kind**.

It costs ranged 5 top-3 (18 → 13, top-8 31 → 35). That is the guides' frame, not an error: they pick
the Megashark *because* of Crystal Bullets, and list the bullets on the next line. Splitting the two
is the more honest decomposition and it is what the ammo metric now measures; the cost is that half
of a guide's reasoning about a gun has moved to a different row.

## Pass 11 — the changes the pack makes that are not in any code (2026-09-04)

The complaint: *the recipe for the pickaxe shows the evil items for me in game — do we need to
account for recipe changes from other mods as well?* Yes, and three separate things were wrong.

### A `Mod` instance is a mod that is loaded

`extractRecipeEdits` was keeping **137 of 730** edits it saw. The rest were dropped as *conditional*,
and the guard they sat under was almost always this shape:

```
get_sots     → brfalse skip        // ModLoader.TryGetMod("SOTS", out mod); return mod;
get_thorium  → brfalse skip
HasResult(X) → brfalse skip
   …the edits…
```

The interpreter resolves `TryGetMod` and hands back `{k:'mod'}`, but `brtrue`/`brfalse` only decided a
branch for a number or `null` — so a *resolved mod instance* left the branch open and everything under
it read as conditional. A mod the pack has is a question already answered; `{k:'mod'}` is now truthy,
and `TryGetMod` for a mod the pack does not have writes `null` into the `out` slot instead of leaving
it unread. **137 → 266.**

### A dead branch has no else

The second guard is `if (!config.X) return;`. With `X` known on, the early return is dead — and `ret`
called `openElse`, which opened an untagged live region over *the rest of the method*. Every edit in
the method then read as conditional. An else-branch of a condition that cannot be taken is not a
branch, it is the only path. **266 → 434.**

### tPackBuilder: the changes that are data, not code

The pack is built on **tPackBuilder**, a library that applies item, NPC, projectile, recipe and drop
changes from `.json` files shipped inside a mod. Nothing about them appears in the IL, so a miner that
reads only code sees none of it. `WHummusMultiModBalancing` alone ships **668 `.itemmod.json` and 123
`.recipemod.json` files**; `InfernalEclipseAPI` two more.

`miner/extract/packbuilder.js` reads them — a reader, not an interpreter, because the files are
declarative. It handles `VanillaItemChange` (damage, use time, crit, defense, mana, knockback, shoot
speed, pickaxe power), and for recipes `AddIngredient` / `RemoveIngredient` / `ChangeIngredient` /
`ChangeTile` / `RemoveTile` / `DisableRecipe` guarded by exactly one `CreatesResult` — the same rule
the IL reader follows with `HasResult`. Anything else is counted and printed rather than dropped
quietly (`RequiresTile ×21`, `RequiresIngredient ×15`, `ChangeResult ×3`).

**608 item stat changes and 234 more recipe edits** now land. Items the lab knows are rebalanced go
from 571 to **862**. Titan Sword is the shape of it: Thorium ships 52, ThoriumRework's `SetDefaults`
takes it to 107, and WHummus takes it back to **88** through a JSON file.

One guard came with it: an edit naming an item the pack does not define is dropped.
`thorium.Find<ModItem>("DragonTalonNecklace")` names an item this Thorium version does not have — the
balancing mod is written against another one — and adding a phantom ingredient made the whole recipe
unstageable.

### What it costs, and why that is the right trade

| | top-3 | top-8 |
| --- | --- | --- |
| neither | 130 | 289 |
| item changes only | 128 | 274 |
| recipe changes only | 125 | 285 |
| both | **123** | **271** |

Split by guide, the loss is where it should be: the **Calamity wiki** guide goes 60 / 132 → 55 / 119,
the pack's own **Infernal Eclipse of Ragnarok** guide only 70 / 157 → 68 / 152. The Calamity guide
knows nothing about a mod that rebalances Thorium against Calamity; the pack's own guide mostly does.
The lab's job is the user's pack, so the numbers stay and the metric is the one that is out of scope
here.

### The Frigid Pickaxe, for the record

None of it moved the item that prompted the question — that took one more read, and it is written up
in pass 9c above. The short version: no mod *references* `FrigidPickaxe` as a type, which is what I
searched for; InfernalEclipseAPI finds it by **string** (`sots.TryFind<ModItem>("FrigidPickaxe")`) and
adds a recipe group to it. A metadata-level search for type and member names cannot see that, and
reporting "nothing touches it" on the strength of one was the wrong call twice over.

## Pass 10b — a tag has a colour (2026-09-04)

`MODE_TAG` in `src/lib/traits.js` is the one place a grade tag's colour and tooltip live, so the
loadout, the item card and the browser cannot drift: whip teal, minion green, sentry blue, stealth
plum, spam plain. Ammo kinds are plum in the ammo list; the plain round named on a gun's row stays
grey, because grey is the point — it is the ammo you have before you go looking for better.

## Pass 12 — the number was not a DPS (2026-09-04)

The complaint, with a measurement attached: *Scourge of the Desert, Flawless, full stealth — 67
thrower damage at 21% crit, and about 300 DPS single-target at post-Giant-Clam.* The lab said **108**.

Feeding the model the player's own damage and crit and changing nothing else produced ~690, not 300.
So the number was not uniformly low — **two large errors were pulling opposite ways and cancelling**,
which is exactly why it read as a number rather than a rate.

### The inputs were guesses standing next to the real thing

`playerDamage(progression) = 1.15 + 0.05 × prog` stood in for "what a loadout carries in class
damage", and **nothing at all stood in for crit** — every weapon was graded at its printed crit, 4%
for this one. The solver has already chosen the armour, the set bonus, six accessories, wings and
boots by the time it grades weapons; the real bonus was sitting one scope away.

`loadoutBonus()` in `score.js` sums it with the same `mergedStat` reading `pieceScore` uses, so the
two can never disagree. `solveLoadout` computes it once (the accessory block now runs before the
weapon block for it) and passes it in the weapon context; `gradeWeapon` uses it for both damage and
crit, falling back to the progression curve only for a weapon graded on its own, outside a loadout.

The scoreboard had the same hole from the other side: `guide-check` built its own weapon list without
the loadout, so it had been measuring a model the app does not use. It now passes `lo.bonus`.

At Giant Clam a rogue loadout really carries **+77% damage and +11 crit**, not the curve's +23% and
nothing.

### What that does to the reported number

| | before | after | in game |
| --- | --- | --- | --- |
| damage as swung | 15 | **26.6** | 67 (the full-stealth display) |
| crit | 4% | **15%** | 21% |
| Real DPS | 108 | **208** | ~300 |

And the check that says the stealth model was right all along: 26.6 × the stealth multiplier 2.47 =
**65.7**, against the 67 the game shows with the bar full. The tooltip is the stealth-strike damage,
the multiplier is not far off, and the `stealthMultiplier` formula survives its first real test.

### The metric went up, which was the condition

| | top-3 | top-8 | MRR |
| --- | --- | --- | --- |
| before | 125 | 266 | 0.069 |
| after | **127** | **267** | 0.069 |

Ranking is what `guide-check` measures and magnitude is what this pass changed, so most of the effect
had to be neutral by construction — a bonus shared by every weapon of a class cannot reorder that
class. The +2 comes from crit, which is *not* shared: a weapon with a high printed crit gains less
from +11 than one with none, and that is a real ordering signal the model did not have before.

### What is left, and what it needs

208 against ~300 is a **1.44×** shortfall, no longer a 3× one, and the model is meant to be
conservative. The candidates are measurable but not from one sample:

- **Potions and buffs are not modelled at all.** Wrath, Rage, a class-specific flask — a stocked
  player carries perhaps +20% before any gear.
- **21% crit against the lab's 15%**, because the solver's six accessories are not the six the player
  is wearing.
- **`STEALTH_RECHARGE = 5 s` is a constant, not a mined number**, and stealth-regen accessories move
  it.

Separating those needs several observations across classes; one sample cannot tell a pierce error
from a landing error. `--why "<weapon>" --stage N` now works for any weapon, not just guide picks,
and prints the loadout's bonus next to the arithmetic, which is the tool for comparing the two.

## Pass 13 — the stealth strike, against four readings (2026-09-04)

Four in-game readings arrived with a Stat Meter screenshot, which is the first time the model could
be checked against anything but a guide's ordering.

### The loadout bonus was right

The meter said **181.09% thrower damage, 16% crit, Max Stealth 50**. Pass 12's `loadoutBonus`, solving
the gear itself, had given **+77% and +11** where the player had +81% and +16 (the meter's 16 includes
the 4% everyone starts with). Close enough that the reading is a confirmation rather than a lead.

### Calamity's stealth numbers are constants in its own code

`CalamityMod.Balancing.BalancingConstants` holds them, and the miner now reads any mod's
`BalancingConstants` into `dataset.balance` (63 numbers for Calamity):

```
UniversalStealthStrikeDamageFactor = 0.42     ← the model already had this one right
BaseStealthGenTime                 = 4        ← seconds to fill the bar standing still
MovingStealthGenRatio              = 0.5      ← half that rate while moving
```

Three fixes came out of them and out of the wiki's statement of the formula:

**`stealthGenFactor` was 3.54 and should be 2.52.** The formula is `(4 / the average of the player's
stealth-generation *multipliers*)^(2/3)`, and those multipliers default to **1** — the ½ moving *ratio*
is not one of them. The model had read it as one (`0.8 × 0.5 + 0.2 × 1 = 0.6`). Solving all four
readings backwards for the factor gives **2.471, 2.481, 2.570, 2.577** against `4^(2/3) = 2.5198`.
Four independent samples inside 2%.

**A weapon's stealth `dmgMul` was inside the `1 +`.** Calamity's multiplier is `1 + bonus`, and the
weapon's own share is a cut of each projectile the strike throws, not part of the bonus. Folded
inside, a weapon that trades damage for extra javelins came out *stronger* than one that does not.
The Scourge of the Desert's printed stealth damage fits with no `dmgMul` in it at all.

**`STEALTH_RECHARGE` was a guessed 5 s.** From the mined constants the bar fills in 4 s standing and
8 s moving, and Calamity's own 80/20 split makes that **7.2 s** of a fight.

### What the readings say now

| weapon | printed, in game | printed, model | observed DPS | model | |
| --- | --- | --- | --- | --- | --- |
| Contaminated Bile | 70 | **71** | 230 | 86 | 0.37× |
| Thorium Dagger | 141 | **145** | 130 | 125 | **0.96×** |
| Ashen Stalactite | 202 | 175 | 190 | 115 | 0.61× |
| Scourge of the Desert | 67 | 58 | 300 | 148 | 0.49× |

The printed damage is now right to a few percent on the two weapons rolled with prefixes that carry
no stealth bonus, and **13% low on both weapons rolled Flawless** — which is exactly the "+15% stealth
strike damage" a Calamity rogue prefix grants and the miner does not read. That is the next thing to
mine, and it is the only systematic residue left in the damage.

The DPS is another matter. A plain dagger spammed at a stationary target comes out **0.96×**, so the
ordinary path is close. What is low is the stealth totals and close-range spam, which is where the
delivery model's pierce, landing and uptime assumptions live — and separating those needs readings
that vary one thing at a time, including whether the target was a dummy.

`tools/observed.mjs` holds the readings and prints them against the model, so this is now a fixture
rather than an argument.

### Cost to the scoreboard

| | top-3 | top-8 | MRR |
| --- | --- | --- | --- |
| the invented constants | 128 | 265 | 0.070 |
| Calamity's own | **125** | **268** | 0.069 |

Measured back to back on one dataset, and the whole difference is rogue — no other class touches
stealth. Three picks leave the top 3 and three enter the top 8. The model is now the one Calamity
documents and four readings confirm, so the ordering it produces is the honest one; the trade is
noted rather than tuned away.

## Disagreements

Guide picks the model still ranks low after the rules are right, and why. Written down rather
than patched, per rule 1.

**The guides curate; the lab enumerates.** Over the six pre-hardmode stages and six classes, the
lab's top 8 holds 288 slots. 49 are the tier's own guide picks, 90 are picks the same guide makes
for the same class at *another* tier, and 153 are weapons no guide lists for that class at all —
74 of those from Thorium alone. The guides name what is worth using; they do not rank the ~170
melee weapons a stage offers in this modpack. A weapon that is genuinely strong and simply not
mentioned costs a top-8 slot that the metric wants a guide pick in, so the ceiling on top-8 is far
below the 300 the plan hoped for. This is the single biggest term and it is not a model defect.

**A guide pick does not stop being good.** The guides upgrade you every tier; the model does not
know a weapon is *supposed* to be superseded. Bellerose (Thorium, listed pre-boss for melee) is
still the lab's #4 melee weapon at stage 30 because 50 damage every 17 ticks still is 50 damage
every 17 ticks. Those 90 "listed at another tier" slots are mostly this. The guides' `≤` mark says
the same thing about upgrades, so the model and the guide agree about the weapon and disagree
about the etiquette.

**Support picks are supposed to lose.** 72 pre-hardmode picks carry `+` or Calamity's `support`
type; none of them is in the lab's top 3, which is the intended outcome and is now reported
separately instead of counting as 72 misses.

**Staging still moves more than scoring does.** Every rule that fixed a staging bug moved the
metric more than any scoring factor did (see the log below). The remaining leads are listed by
`guide-check` under LATE and EARLY; the worst of them are items whose only evidence is a mod's own
rarity class (StarsAbove stages 128 of its 164 items that way, and rates a 440-damage weapon
rarity 2, so it wins melee from stage 6 to stage 30). Those belong in `data/unknown-sources.md`
and in `miner/stage/progression.json`, not in the DPS model.

**Melee and summoner are the weakest classes** (8 of 83 and 10 of 129). Melee has the largest pool
(167 weapons at pre-boss, 308 by stage 30) and the most contamination from the above, and its 80 px
engagement distance means the landing model barely separates its weapons — a swing at contact range
is `damage × rate` again. Something that told a good sword from a bad one at the same damage and
speed (reach, the arc of the swing, how many segments of a worm it can be between) is the next real
gain there. Summoner is scored almost entirely outside the landing model: a minion's damage per slot
times a hit rate read from its immunity frames, with no notion of whether the minion can keep up
with the boss, how long it takes to retarget, or what a whip tag is worth. That model, not the
staging, is why the guides' summoner picks scatter.

## Progress log

| date | step | weapons top-3 / top-8 | MRR | mode agree | notes |
| --- | --- | --- | --- | --- | --- |
| 2026-09-03 | baseline, old scoreboard | 18 / 64 of 572 | — | 20 / 26 | ammo unstaged, no archetypes, no defense |
| 2026-09-03 | Phase 0: guides as data | 17 / 63 of 508 | 0.064 | 41 / 53 | 43 tiers instead of 11, roles and marks read, support excluded, the `Ω` naming bug fixed (the paired ammo was being taken as the item's name) |
| 2026-09-03 | cross-mod shops are not evidence | 16 / 57 | 0.063 | 41 / 53 | Holy Fire Bullet / Elysian Arrow stop being pre-boss ammo; ranged loses the crutch |
| 2026-09-03 | Phases 1–2: archetypes, landing, boss stats, debuffs | 14 / 53 | 0.057 | 40 / 53 | the model is right and the pool is wrong: everything below is the loop finding out which |
| 2026-09-03 | child projectiles capped, contact rate no longer double-counted, `local ≤ 0` guarded | 13 / 53 | 0.057 | 41 / 53 | a negative hit cooldown was producing negative DPS |
| 2026-09-03 | an ungated enemy drop keeps the item's rarity as a floor | 23 / 59 | 0.067 | 39 / 50 | the largest single move of the whole rework, and it is a staging rule |
| 2026-09-03 | recipes: two fixpoints, rarity only fills what never resolved | 24 / 62 | 0.067 | 39 / 50 | an ingredient that had not been reached yet was pinning the result at its rarity guess |
| 2026-09-03 | same-named items resolve to the earliest | 24 / 62 | 0.067 | 39 / 50 | the guides' Amethyst Ring is Thorium's, not Blue Moon's |
| 2026-09-03 | `bossSpeed` swept (3 / 5 / 8) | 24 / 62 | 0.067 | 39 / 50 | 8 buys +1 top-8 by helping magic and hurting rogue, bard and melee — a wrong trade, kept at 5 |
| 2026-09-03 | a contact weapon with no immunity of its own falls back to the player's 10-tick window | 27 / 65 | 0.069 | 39 / 50 | held beams and drills were dropping to the use rate; melee 5 → 8 |
| 2026-09-03 | hits come from time on target, bounded by the life left on arrival; extra hits pay the landing chance again; everything a weapon throws shares the player's immunity window unless it sets its own; if/else alternatives average instead of taking the best | **31 / 60** | **0.073** | 39 / 50 | Bellerose's reign as the best melee weapon: stages 0–10 → 0–5. Held weapons (Old Lord Claymore, Basher, Walking Cane) surface. top-8 gives up 5 for +4 top-3 and a better MRR |
| 2026-09-03 | *pass 2 baseline, re-measured* | 36 / 67 | 0.084 | 57 / 74 | the tree had moved on from the 31/60 row above |
| 2026-09-03 | the stealth strike adds to the spam instead of replacing it | 35 / 66 | 0.084 | 57 / 74 | flat on the metric, but it is what makes a stealth grade reachable at all |
| 2026-09-03 | an unread `shootSpeed` is flown at `SHOOT_SPEED_UNKNOWN`, not exempted from landing | 35 / 69 | 0.085 | 57 / 74 | Crude Bat and Gel Throwing Axe leave the rogue top 5 |
| 2026-09-03 | `local < 0` is one hit per NPC, ever | 33 / 72 | 0.085 | 57 / 74 | explosions stop multi-hitting |
| 2026-09-03 | an on-hit child only exists as often as its parent lands | **38 / 75** | 0.087 | 57 / 74 | the biggest single move of the pass |
| 2026-09-03 | vanilla worms detected by repeated segment name; a worm's `aimW` is the chain | 38 / 75 | 0.087 | **59 / 74** | drift still measured against one segment — aiming the *travel* term at the whole chain lost 2/2 |
| 2026-09-03 | the player walks in to the weapon's reach instead of scoring zero | 38 / 75 | 0.087 | 59 / 74 | magic and melee stop having guide picks at 0/s |
| 2026-09-03 | miner: `drag` only from an *unconditional* velocity multiply | **39 / 80** | **0.088** | 59 / 74 | 260 of 637 mined drags were a stick-on-hit or stop-on-tile branch read as permanent decay |
| 2026-09-03 | `CHILD_CAP` 2 → 1.5, no class regressed | **42 / 81** | **0.090** | 59 / 74 | knob, tuned last as planned |
| 2026-09-03 | the ranged / magic playstyle toggle actually reaches `engagement()` | 42 / 81 | 0.090 | 59 / 74 | `variant('spam')` was overwriting it for every class |
| 2026-09-03 | *pass 3:* defense comes off the damage a loadout does, not the printed number | 42 / 82 | 0.091 | 59 / 74 | a flat defense taken from the tooltip number is a tax on every weapon that hits often for a little |
| 2026-09-03 | an invulnerable phase is not armour (`Giant Clam` 9999 → the default) | 42 / 82 | 0.091 | 59 / 74 | the stage-3 target, which is where the complaint came from |
| 2026-09-03 | miner: a fan read through `NewProjectile(v.X * k, v.Y * k, …)` keeps its angle | 43 / 82 | 0.091 | 59 / 74 | 113 calls now carry a fan; Harpy's Barrage was three shots on one line |
| 2026-09-03 | `v:Spike` anchored to Skeletron (a Dungeon material with no mined source) | **43 / 83** | **0.091** | 59 / 74 | Metal Monstrosity and Spiky Caltrop leave the pre-hardmode rogue top 8, landing where the guides put them |
| 2026-09-03 | *pass 4:* `ARCHETYPE` table; boomerangs pay for the round trip; sentry/minion uptimes | 43 / 83 | 0.091 | 59 / 74 | Sand Dollar's spam grade 125 → 61/s. Flat on the metric, honest on the number |
| 2026-09-03 | miner: the wiki's weapon-type list, all of it from mined fields | 43 / 83 | 0.091 | 59 / 74 | bow / repeater / gun / launcher / flamethrower / bomb / dagger / javelin / spikyball / specialsword |
| 2026-09-03 | miner: `held` only from an *unconditional* `heldProj` | 43 / 83 | 0.091 | 59 / 74 | 90 projectiles leave `held`; a charge-up throw is not a spear |
| 2026-09-03 | **scoreboard:** a summoner's minion / sentry / whip are ranked against their own kind | 53 / 105 | 0.107 | 59 / 74 | not a model change — the guides give each its own column, and a summoner equips all three. Sentry picks in top-8 0/24 → 17/24 |
| 2026-09-03 | a whip is scored for the mark it leaves, not its own lash (`tag: 2`) | **54 / 110** | **0.109** | 59 / 74 | whip picks in top-8 0/6 → 3/6 |
| 2026-09-03 | miner: a projectile that sets its own centre from an NPC's `sticks`; a stuck one does not pierce | 54 / 111 | 0.109 | 59 / 74 | Bolas #4 → #17. 46 non-summon projectiles stick; `javelin` now comes from the fact rather than a heuristic |
| 2026-09-03 | miner: `useStyle 3` only makes a shortsword when the damage is not all in the projectile | **54 / 111** | **0.109** | 59 / 74 | Obsidian Striker stops being scored as a 60 px stab, and Lasting Pliers passes it |
| 2026-09-03 | `timeLeft` is counted in updates: extra updates arrive sooner, they do not reach further | 53 / 111 | 0.109 | 59 / 74 | 691 of 2508 weapon projectiles had their reach inflated by `(1 + updates)` |
| 2026-09-03 | homing's `parts` multiplier is applied instead of decorative | **53 / 111** | **0.109** | 59 / 74 | travel and gravity priced with and without it, so the landing factors multiply out |
| 2026-09-03 | *pass 5:* miner: a velocity scale is drag only when stored back with nothing added | 55 / 109 | 0.112 | 59 / 74 | steering blends were being read as decay; 6 of 7 guide picks scoring 0/s recover |
| 2026-09-03 | equipment whose recipe never resolved is unknown, not a rarity guess | 54 / 114 | 0.118 | 59 / 74 | 142 weapons, 110 of them StarsAbove; melee's #1 becomes a guide pick |
| 2026-09-03 | miner: `DefaultToWhip()`; a whip lashes once rather than piercing | 51 / 111 | 0.113 | 57 / 72 | whips 9 → 76, and they crowd minions in a shared ranking |
| 2026-09-03 | **scoreboard:** minion / sentry / whip each ranked against their own kind | 59 / 122 | 0.124 | 57 / 72 | the guides' minion column is 209 minions to 19 whips |
| 2026-09-03 | miner: `ownedProjectileCounts` cap; a boomerang sails out to its throw distance | **60 / 121** | **0.124** | 57 / 72 | Sand Dollar reads as the double boomerang it is |
| 2026-09-03 | *pass 6:* interpreter: a flag survives `> 0`, rides `Projectile.ai[]`, and a loop body jumped over keeps its condition | 60 / 121 | 0.124 | 57 / 72 | the three fixes that make a stealth-gated child visible at all |
| 2026-09-03 | a child records which strike spawns it; the variant only counts its own | **64 / 123** | **0.127** | 56 / 72 | Throwing Brick 90 → 41/s; Scourge of the Desert reaches #3 at its tier |
| 2026-09-03 | *pass 7:* interpreter: a tracked slot's address reads back as that slot, so `velocity.Y +=` through a by-ref helper lands | 64 / 131 | 0.126 | 57 / 73 | Thorium's thrown weapons finally pay for their arc; Pod Bomb 104 → 69/s |
| 2026-09-03 | a blast goes off where it landed instead of flying through the boss | 64 / 135 | 0.128 | 57 / 73 | Contaminated Bile 43 → 65/s, past Pod Bomb |
| 2026-09-03 | miner: a weapon's own `ModifyStatsExtra` runs against its own stealth ranges | **66 / 134** | **0.125** | 57 / 73 | Ashen Stalactite 381 → 119/s; its stealth stalagmite stops being thrown on every attack |
| 2026-09-04 | *pass 8:* a projectile that sets its velocity on hit bounces off rather than piercing | 66 / 130 | 0.132 | 57 / 73 | Crude Bat 73 → 49/s, #7 → #16; 101 weapon projectiles |
| 2026-09-04 | the arc is priced against the silhouette without the arbitrary ×0.35 softener | **68 / 133** | **0.133** | 57 / 73 | Sandstone Throwing Knife 89 → 73/s |
| 2026-09-04 | *pass 9:* an arcing shot's reach is where it has fallen out of the silhouette, not where it expires | 68 / 134 | 0.132 | 56 / 73 | Sandstone 73 → 27/s. A seeker is exempt: it climbs back on |
| 2026-09-04 | pierce falls off geometrically per extra body, `PIERCE_KEEP` 0.45, seekers exempt | **70 / 135** | **0.134** | 56 / 73 | swept 1.0 → 0.3; 0.45 and 0.3 tie, 1.0 costs 4 top-8 |
| 2026-09-03 | *pass 7:* a child spawned with `0` damage is a sparkle, not a hit; children print what they add | 64 / 127 | 0.129 | 56 / 72 | 332 of 1932 children pass a literal 0; 205 weapons were counting one as a full extra hit |
| 2026-09-03 | miner: `useAmmo` names the weapon before anything it holds does | 64 / 121 | 0.127 | 56 / 72 | a charge bow stops being a beam; the −2 is ranged's pool re-sorting around a correct tag, and it is the control row for everything below |
| 2026-09-03 | a whip is swung, not thrown (`ATTACHED`); its tag adds instead of multiplying | 64 / 122 | 0.129 | 56 / 72 | Leather Whip was paying 55 ticks of lead for a lash; the summon top 8 stops being seven whips |
| 2026-09-03 | a contact projectile with no cooldown of its own hits on the player's window — and everything sharing that window queues for it | 65 / 124 | 0.129 | 56 / 72 | the Vilethorn scored one hit per cast; the fallback alone cost 7 top-8, the shared clock gave 4 back |
| 2026-09-03 | the blade swings on the animation, not on the use time | 66 / 125 | 0.129 | 56 / 72 | read from tML's `ApplyItemAnimation` / `ApplyItemTime`: Starfury, Ice Blade, Enchanted Sword and Seashine Sword were halved |
| 2026-09-03 | a launch speed under 4 px/tick is not a speed (`SHOOT_SPEED_MIN`) | **68 / 129** | **0.128** | 56 / 72 | 96 weapons launch at 0.1 or 1 and were charged 90–600 ticks of lead and a reach ending inside the player |
| 2026-09-03 | a damage multiplier over ×4 is a branch, not a multiplier (`DMG_MUL_MAX`) | 68 / 129 | 0.128 | 56 / 72 | flat pre-hardmode, and Wyvern's Call stops being 6,490 DPS at Wall of Flesh |
| 2026-09-04 | *pass 8:* miner: a weapon is what everything it fires says it is, not what `Item.shoot` says | 67 / 136 | 0.129 | 57 / 73 | Sahara Slicers names its right-click bolt in `shoot` and stabs with held blades from `Shoot`; every class gains |
| 2026-09-04 | a hit cooldown of `-1` is once per NPC ever, which is not the same as having none | 66 / 134 | 0.127 | 57 / 73 | Old Lord Claymore — "a slow but powerful blade" — was being paid 6 hits/s on a 90-tick swing: 719 → 57/s |
| 2026-09-04 | `ENGAGE` is how far a class would *rather* stand; the weapon's reach does the pulling in | 66 / 134 | 0.127 | 57 / 73 | melee's 80 px was a broadsword's reach baked into the class, and 136 of its 178 picks sat on it |
| 2026-09-04 | risk is the share of the way in, priced for every class including melee | 66 / 134 | 0.127 | 57 / 73 | validated against the guides' own `†`: a risky pick averages 0.914 against a plain one's 0.945 |
| 2026-09-04 | miner: a held projectile the game calls `TrueMeleeDamageClass` reaches contact, not beam length | 66 / 135 | 0.128 | 57 / 73 | 36 weapons, every one of them a contact weapon; `REACH.held` was written for beams |
| 2026-09-04 | `uptime` belongs to the weapon type, not to the contact path | **66 / 135** | **0.129** | 57 / 73 | a type that fell through to the use clock got its uptime back and outscored the same weapon with a cooldown |
| 2026-09-04 | miner: a share of exactly ×1 is not the same as a share that could not be read | 66 / 135 | 0.129 | 57 / 73 | 472 children really are ×1, 94 are unread; the unread take the median readable share (0.5) |
| 2026-09-04 | *pass 8b:* miner: `stealthRanges` generalised to `guardRanges`; `altRanges` reads `player.altFunctionUse` | 66 / 135 | 0.129 | 57 / 73 | 110 weapons branch on the right click, at instruction 1 of `Shoot` for Sahara Slicers |
| 2026-09-04 | the two clicks are two attacks: the weapon is worth its better one, not their sum or their average | **66 / 134** | **0.129** | 57 / 73 | costs 1 top-8 (Sahara Slicers, a `†` pick, leaving it) and 4 on the whole run; the coin-flip average was indefensible |
| 2026-09-04 | an on-hit child the other click throws is ammunition being stocked, not damage now | 66 / 134 | 0.129 | 57 / 73 | Sahara Slicers #4 at 330/s → #20 at 90/s, which is what the complaint that opened pass 8 was about |
| 2026-09-04 | *pass 9:* miner: a `GlobalItem`'s bail-out paths narrow its scope, not just its `return true` paths | **66 / 134** | **0.132** | 57 / 73 | CalamityBardHealer's Thorium melee ×2 resolved to "any Thorium item that is not Pearl Pike"; 24 items lose a doubling the hook explicitly skips |
| 2026-09-04 | miner: a pickaxe whose recipe consumes the ore it would mine cannot vouch for that ore | **68 / 133** | **0.133** | 57 / 73 | Aquaite (pick 65) was answered by the Hydro Pickaxe, which is made of Aquaite Bar; the fixpoint kept the cycle's seed |
| 2026-09-04 | *pass 9c:* ~~a pickaxe whose materials only turn up in worldgen chests cannot vouch for an ore~~ | 66 / 134 | 0.132 | 57 / 73 | a heuristic for a bug not yet found; **reverted below** once the real recipe was readable |
| 2026-09-04 | *pass 10:* a summon weapon is tagged by the slot it fills (`mode` = whip / minion / sentry) | 66 / 134 | 0.132 | 128 / 153 | the scoreboard has ranked them apart since pass 5; the model and the app now agree with it. Summon mode agreement 0/0 → 332/356 on the full run |
| 2026-09-04 | miner: `SummonMeleeSpeedDamageClass`, and one level of children, name a whip | **66 / 139** | **0.132** | 128 / 153 | Congealed Duo-Whip shoots a spawner that lashes with two whips; it read as a beam at 513/s. Whips 76 → 90 |
| 2026-09-04 | a gun takes the plain round of its kind (`AmmoID` *is* the item id); ammo is ranked apart | 66 / 139 | 0.132 | 128 / 153 | 70 guide ammo picks stop being "missing"; ranged −5 top-3, +4 top-8 — the guides bundle the bullets into the gun |
| 2026-09-04 | *pass 11:* interpreter: a resolved `Mod` instance decides a branch, and a mod the pack lacks writes `null` | 66 / 139 | 0.132 | 128 / 153 | recipe edits kept 137 → 266 of 730: `if (sots && thorium)` was leaving every edit under it conditional |
| 2026-09-04 | interpreter: a `return` on a dead branch does not open an else over the rest of the method | **66 / 139** | **0.132** | 128 / 153 | `if (!config.X) return;` with X known on. 266 → 434 |
| 2026-09-04 | miner: tPackBuilder `.itemmod.json` / `.recipemod.json` — the pack's balancing is data, not code | 61 / 135 | 0.126 | 126 / 151 | 608 item stat changes (554 of them damage) and 234 recipe edits the lab had never seen; rebalanced items 571 → 862. The cost is the Calamity guide (60/132 → 55/119), not the pack's own (70/157 → 68/152) |
| 2026-09-04 | miner: a recipe edit naming an item the pack does not have is dropped | 61 / 135 | 0.126 | 126 / 151 | `thorium.Find<ModItem>("DragonTalonNecklace")`; a phantom ingredient made the whole recipe unstageable |
| 2026-09-04 | miner: a recipe group parked in a static field is still a group; `AddRecipeGroup` resolves the field | 61 / 135 | 0.126 | 126 / 151 | IEAPI adds `EvilSkin` ×6 to SOTS's Frigid Pickaxe — the recipe the game shows and the lab did not. Groups 49 → 55; the pickaxe moves to Eater of Worlds |
| 2026-09-04 | *revert:* the pass-9c chest heuristic, now that the real recipe explains the gate | **61 / 135** | **0.126** | 126 / 151 | exactly neutral on weapons, −7 staged later, and the three `craft: Obsidian` guide picks come back |
| 2026-09-04 | *pass 12:* a weapon is graded with the damage **and crit** its own loadout carries, not a progression curve and its printed crit | **64 / 130** | **0.123** | 126 / 151 | full run 125/266 → **127/267**. Scourge of the Desert 108 → 208 DPS against ~300 observed; 26.6 × stealth 2.47 = 65.7 against the 67 in the tooltip |
| 2026-09-04 | *pass 13:* miner: a mod's `BalancingConstants` into `dataset.balance`; the stealth formula uses Calamity's own 0.42 / 4 s / ½ | 125 / 268 | 0.069 | 126 / 151 | `stealthGenFactor` 3.54 → 4^(2/3); `dmgMul` out of the `1 +`; recharge 5 → 7.2 s. Four in-game readings solve the factor to 2.47–2.58. Printed damage now within a few % except the Flawless stealth bonus the miner cannot see |
