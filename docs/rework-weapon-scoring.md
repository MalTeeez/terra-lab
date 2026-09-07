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

## Next pass — making the phases score (planned 2026-09-05, revised after review)

Two reviews of the attack-phase pass reached the same verdict, and a third reviewed the first
draft of this plan. All three agree on the diagnosis: the phase graph *describes* the score but
does not *produce* it. `variantHits`, `group()` and `childHits` still do the arithmetic; the phase
records mirror what they computed; and the gates that were meant to change the answer almost never
carry a value (travel 3.5 % gated, impact 0.9 %, split 4.6 %) while 98 % of those phases are tagged
`exact`, because `exact` describes count and spread, not how often.

Where the primary-weapon misses actually lose, as pick ÷ lab #1 per factor bucket: damage 0.93,
rate 0.83, **hits 0.33**, **landing 0.57**. The picks are not weaker on paper; they lose on the
model's own multipliers. The #1 slots are held by high-multiplier types (held 32 wins / 4 losses,
spear 25 / 7, flamethrower 17 / 6); the misses are swings, boomerangs, bows and bombs (boomerang
0 / 14, bow 0 / 13, bomb 0 / 17).

### Verified before planning

- `fire.dmgMul` (the `ModifyShootStats` adjustment, `shoot.js:255`) is mined for 13 weapons and read
  nowhere in `dps.js`. It **multiplies** with a call's own `dmgMul`, because `Shoot` is run afresh
  with the bare `DMG` argument (`shoot.js:263-289`): Astral's End carries 1.5 on the whole shot and
  0.667 on each of its five calls, which is ×1.0 at runtime. Whether a call was adjusted
  (`c.dmg.k === 'adj'`) is not serialised, and an absolute call damage becomes `dmgMul: null`, which
  `deliveryPhases` turns back into ×1 (`phases.js:256`). None of that is fixable model-side.
- 0 of 386 vanilla projectiles carry `children` or `debuffs`; 1144 / 1279 of 3339 mod projectiles
  do. Molotov Cocktail is a bare lob with no fire. 137 of 454 pre-hardmode primary picks are vanilla.
- 437 items have if/else regions in `Shoot`; every region group is averaged as `sum / N`
  (`dps.js:897`). But `ctx.region` is only the innermost region *end* (`interp.js:207-225`): 249 of
  the 437 have a single region and 631 of 727 groups hold one call. A guarded call with no `else`
  has no represented no-op sibling, so both the average and any `min` pay it at full value. The
  representation has to be completed before the weighting rule matters.
- The tooltip's `threshold` / `cooldown` are handed to every delivery (`dps.js:857-858`) and from
  there to every first-generation child (`dps.js:976-983`); `test/dps.test.js:561-573` pins that.
- `guide-check --vs` prints deltas and never fails; `data/guide-baseline.json` was written with
  `pre: false`; every run rewrites `data/guide-late-weapons.md`, filtered or not.
- `loadoutBonus` returns `{ damage, crit }` only (`score.js:319-338`): no worn ids, buffs or flags
  reach weapon scoring, so a `requires` gate has nothing to join against yet.
- `tools/observed.mjs` compares a stealth sample against `v.value`, which is already spam + strike,
  so the four samples do not test additivity; and every vanilla yoyo has an explicit 10-tick local
  (`projectiles.js:564-577`), so a yoyo cannot test the no-local fallback.

### Rules this pass runs under

From `data/guide-scoring-implementation-progress.md`: guide agreement is the **check, not the
goal**. A change is kept on its mechanical story; a change without one is not kept because the
aggregate moved, and a class regression is a diagnostic that must be explained, not a veto. When
the miner cannot read a detail the model assumes the worse case, and the choice between two
fallbacks is made on that rule, not on top-k.

### Step 0 — evaluator first (tools only, no scoring change)

1. `guide-check`: a `--no-write` mode so a filtered run does not rewrite `guide-late-weapons.md`;
   `--vs` refuses a snapshot whose `filters` differ; `--vs` compares per guide × class × family on
   top-3, top-8, recall@K, section hit, MRR and the rankable denominator, and exits non-zero on a
   regression unless `--waive "<reason>"` records why. Freeze matching pre-hardmode guide and
   `dps-snapshot` baselines.
2. The per-archetype **over/under table** in `--summary`: per archetype, sections where it holds
   #1 over a guide pick of another type, and guide picks of that type outside the top 8. The slot
   table at `guide-check.mjs:588` is the pool side; this adds the guide side.
3. `unresolved-phases.mjs` gains a reason for unread alternative regions and for one-sided
   conditionals, so the worklist below is visible before any of it is fixed.

### Step 1 — damage provenance in the miner (re-mine)

The one correctness defect that is purely extraction, and the schema everything later reads:

- Serialise a call's damage as `{ kind: 'relative' | 'absolute' | 'unread', mul, abs }` instead of
  a bare `dmgMul`; keep `fire.dmgMul` as the `ModifyShootStats` term and let the model compose
  `raw × fire.dmgMul × call.mul`. Pin with a test on the Astral's End shape: 1.5 × 0.667 ≈ 1.0.
- The blade never takes `fire.dmgMul`; the default shot does.
- `stealthMods.dmgMul` is applied once, on the strike (`dps.js:1440`); a miner test states whether
  it *replaces* or *stacks on* the ordinary adjustment, and the model reads it that way.
- `dmgAbs` for direct calls, so an absolute call damage stops being ×1.

Model-side this is one line in `deliveryPhases` once the field exists. Its *score* is still wrong
against defense until step 3, so the acceptance here is the phase record, not the ranking.

### Step 2 — guards with a domain (miner, re-mine)

`guards.js` finds the branch (`guardRanges`), prices `NextBool` (`chanceRanges`) and reads the
ownership cap (`ownedCapOf`). Syntax alone does not give the gate: `ai[n] % N` in `AI` is ticks, in
`OnHitNPC` hits, in `Shoot` uses, and `localAI[n] > N` is as often a homing delay as a counter. So:

In this order, because the weaker-arm rule applied to an incomplete representation is the
generic rule paying for facts the reader could have supplied:

- **Counters ⇒ `{ kind: 'threshold', n, event: 'use' | 'hit' | 'tick', reset }`**, with `event`
  from the method the compare sits in, and the compare shape (`%`, `>=`, `>`, reset value) read
  rather than assumed. Off-by-one is decided by the reader, not the model.
- **Player state ⇒ `{ kind: 'requires', what, id, negated }`** for `HasBuff`, `ModPlayer` bools
  and player fields. Difficulty, target, owner and initialisation guards are *not* requirements
  and are left as unread conditions. Until the loadout carries worn ids and buffs (`loadoutBonus`
  only returns damage and crit), a `requires` phase scores 0 and is **reported as unresolved**, not
  as solved.
- **Count the residual.** After counters, rolls and requirements are classified, the groups left
  are *unread control flow*. That count — out of the 727 groups today — goes in this document,
  because it is the number that says what the generic rule below costs and what a further reader
  would buy back.
- **Branch groups and complements**, on the residual only. Emit the full if/else group id and an
  implicit no-op arm for a guarded call with no `else`, so a region is a complete set of
  alternatives. This is what makes "one of them runs" mean anything.
- **Relations.** `alternative` splits into `conditional` (unread control flow, pessimistic: the
  weaker complete arm) and `choice` (player-selectable, the better arm — what left/right click
  already does at `dps.js:1397-1408`). A `threshold` arm scores `1/N` and its complement
  `(N−1)/N`, which is the "finisher" shape; a proc with no complement is additive at `1/N`.
- **Tooltip fallback becomes phase-local.** A text `threshold` / `cooldown` attaches during phase
  construction to the one child it can name; ambiguous text attaches to nothing and shows up in
  `unresolved-phases`. The counter-gun test changes to expect only the burst gated, not the
  explosion. A mined gate on a phase overrides text on that phase only.

### Step 3 — the minimal compiler (model)

Moved ahead of the vanilla table, because child debuffs and per-phase defense cannot score
correctly without it, and the reviews are right that per-phase armour is not a contained change:
`CHILD_CAP`, the shared-immunity cap, pierce falloff, link maintenance, summons, the stealth grade
and the contribution reconciliation all live in parent-hit units today.

What it keeps separate, per phase: **event rate** (hits/s, what immunity caps operate on) and
**damage per event** (raw → armour pen → defense → crit eligibility). The score is the sum of
`rate × postDefense × crit` over phases, and every existing cap keeps working on rates:

- the shared player-immunity cap scales rates, then each phase's own damage applies;
- `CHILD_CAP` becomes a cap on cascade *rate* where no cadence was read, lifted per child when
  step 2 supplied one; depth limit stays as cycle protection only;
- direct-call and child `armorPen` apply to their own hits; loadout armour pen is added to
  `loadoutBonus` and reaches the phases;
- absolute-damage children are scored as flat damage or classified non-damaging, never dropped;
- a debuff belongs to the phase that applies it and is kept up by *that* phase's landing rate and
  gate, not by the weapon's total hits (`debuffPhases` today scans only the primary and direct
  calls, and promotes a rare branch's debuff to a permanent one);
- summons go through the same path with their timer children as real phases;
- the rogue grade is expressed as a schedule — spam-active fraction × spam, plus strike rate over
  recharge × strike payload — with the additive total kept as the **fitted interim** until the
  observations in step 5 fix the fractions. It is debt, recorded here, not a settled invariant.

Acceptance: `hitDamage(raw × 0.3) ≠ hitDamage(raw) × 0.3` under positive defense with the 1-damage
floor per phase; two phases sharing immunity but differing in damage keep the right proportions; a
local-immunity child stays outside the shared group; normal, summon, stealth and cascade
contributions reconcile with the score after every modifier.

### Step 4 — vanilla projectile table (miner, versioned)

Feasible and the largest data gap, authored any time but **scored only after step 3**. The tmod
carries no vanilla AI, so a table is game data of the same kind as `VANILLA_HOMING`, with the
maintenance made explicit:

- keyed by `ProjectileID` *symbolic name*, resolved against the installed assembly at mine time;
  a row that does not resolve fails the mine, so a Terraria/tML upgrade cannot leave stale ids;
- every row carries source and supported game version; runtime-mined facts merge over table facts
  the way `projectiles.js:632-638` merges sets;
- rows carry the same phase facts as mined projectiles (children with `where`, `dmgMul` /
  `dmgAbs`, chance, debuffs, `local`, `explode`, `sticks`), not a reduced shape;
- coverage is measured on the **effective** projectile path — ammo weapons fire the standard
  ammo's projectile (`dps.js:1074`), not `item.shoot` — so the list is built from what the scorer
  actually resolves for the vanilla picks plus their children. A raw `item.shoot` count gives 71
  distinct ids over 219 pre-WoF vanilla rows; the effective list will differ and is what gets filled.
- golden cases pin complete mechanics for a few rows (Molotov, Beenade / Bee's Knees, one debuff
  projectile) and check a child-applied debuff inherits the child's gate.

Not table rows: Minishark-class cadence (item facts), penetration defaults already mined, ammo
behaviour (belongs to the ammo's projectile).

### Step 5 — observations that isolate one term each (in-game, parallel to 3–4)

The current four samples share one player block, store DPS only, and compare stealth against a
total that already contains spam. `observed.mjs` grows to store per trial: item and prefix,
target and its defense, distance, shown damage and crit, duration, raw event count or non-crit
total, time channelled, time overlapping the target, projectile count, single vs crowd. Three to
five runs each. Then:

- **contact clock**: a held projectile with *no* local or static immunity on a stationary dummy
  (not a yoyo; those carry a 10-tick local), against a known-`local` control that must reproduce
  `60 / local`;
- **uptime**: the same weapons on a moving boss, separately;
- **rogue**: continuous spam, one isolated strike, recharge while idle / moving, and an alternating
  schedule, which is what turns the step-3 schedule from fitted into measured;
- **broadsword**: vary reach / scale with shown damage and use time held, to separate arc coverage
  from the generic `RANGE_EDGE` band.

Until these exist nothing in `IMMUNITY`, `held.uptime` or the swing band is retuned.

### Knob registry — how each constant retires

A knob without a retirement rule is an archetype rule under another name. Each one below names
the phase fields that supersede it (the model reads the field when present and the knob only when
not) and the step-5 observation that calibrates it until then. `RISK`, `ENGAGE` and
`PLAYSTYLE` are not on the list: they are the class's preferences, user-tunable by design, not
facts the miner could read.

| knob | stands in for | retires on (phase fields) | calibrated by |
| --- | --- | --- | --- |
| `ARCHETYPE[*].uptime` (held .85, flail .7, placed .3, spikyball .25, minion .9, sentry .55) | share of the fight the thing is on the boss | `duration` + `maxActive` + a boss-dwell term from `vb` and the phase's reach | moving-boss trials, uptime measured apart from the contact clock |
| `REACH[arch]` | how far a held or swung thing extends | a mined hitbox extension (`width`/`height` × `scale`, the projectile's own travel before it stops) | broadsword reach/scale series |
| `IMMUNITY` as the contact fallback (6 hits/s) | a held projectile with no `local` | a read `local` or static-immunity flag; the player-window rule stays only for phases the reader says set none | no-local held projectile on a dummy, with a known-`local` control |
| `capN = 4` | how many of a held thing are out at once | `maxActive` (`ownedCapOf`, already mined where the code states it) | none needed: it is a read or it is not |
| `RANGE_EDGE = 0.5` and the blade's ×0.85 swing factor | a shot dying at its own range; a blade's arc not all on the boss | expiry read off `life` × speed (already), plus the swing's arc coverage as a phase reach term | broadsword series; returning-weapon series |
| `THROW_OUT`, `FLIGHT_CAP` | where a returning weapon turns round, and the longest wait | the mined `returns` distance / deceleration per projectile | returning-weapon trials at fixed distances |
| `CHILD_CAP`, `CHILD_DMG_UNREAD` | an unread spawn cadence; an unread damage share | a mined `threshold` / `cooldown` / timer cadence (step 2); `damage.kind` (step 1) | none: replaced by reads, and the residual is listed by `unresolved-phases` |
| summon hits/s defaults (1.5 sentry, 2 minion, 3 cap) | a minion with no readable clock | the summon's own `local` and its timer children as phases (step 3) | minion on a dummy, event count over duration |
| `whip.tag = 1.5` | what the mark is worth in minion hits | the mined tag damage × the loadout's minion hit rate (step 3 has the rate) | whip + fixed minion set on a dummy |
| `unknownDebuffDps` | a debuff with no record | the debuff record; failing that, listed as unresolved | none: it is a read or it is not |
| `WINDUP_TICKS = 60` | how long a charge weapon is held before its shot arms | the charge counter's own cap, read out of the AI (`Charge >= 120` at `extraUpdates` speed) — **partly retired**: a projectile carrying a `charge` record states `ticks` and `release` itself and the knob is not consulted for it (13 projectiles) | a charge weapon on a dummy: time from button-down to first hit |
| `MANA_POTION` ladder + `POTION_EVERY = 2` | the second income the mana bar has: the best potion the run has got to, drunk every two seconds | the potion table is game data (`VANILLA_HOMING`'s kind) and retires when consumables are mined — `healMana` plus a crafting stage would make it a read. `POTION_EVERY` is a play-style fact and stays a knob | a timed boss fight with a potion count: mana spent, potions drunk, damage shown |
| `CLICK_CPS = 7.5` | how fast a player clicks, where the weapon's animation is not what stops them — the `spam` arm of a charge fork on a holdout that pins `player.itemTime` | the projectile's own minimum life before it may end (Perfect Star's star cannot die inside 7 ticks, so ~6.7/s is its real ceiling), read out of the AI | a charge weapon tapped on a dummy: releases counted over a fixed time |
| `EXHAUSTION_REGEN = 60` | what Thorium's thrower bar gives back per second | nothing: it is `throwerExhaustionMax / 1200` per tick, read straight out of `ThoriumPlayer.PostUpdateEquips`, and the knob only exists so the pool can be turned off | a Thorium thrower held down until the bar caps, timed |
| `FIGHT_SECONDS = 60` | how long the fight a reservoir has to last through is | a fight length derived from the boss's health against the loadout's own DPS, which the model already computes | a timed boss kill at a known stage |
| `CALIBRATION = 1` (unfitted) | everything the model does *not* price, as one factor on every weapon alike — so it moves no ranking and no guide metric, only the printed number. Rage and Adrenaline are the first named thing inside it | nothing: it is the residual by definition, and each mechanism found inside it comes out of it and into that mechanism | the in-game trials in `data/observed.json` (`node tools/observed.mjs`) — held at 1 until the Mycoroot trial's unexplained ×2 has a name; fitting through it would be fitting to it |
| `GRAVITY_MAX = 1.5` (miner) | the largest per-update `velocity.Y +=` that is still an arc | the axis rule below already takes the steering blends that push both X and Y; what is left for the bound is a Y-only write whose addend the interpreter bounded, which retires on following the local instead of bounding it | none: it separates two kinds of read, and the pack's own distribution sets it |

The model's rule for every row is the same: read the field, fall back to the knob, and report the
fallback through `unresolved-phases`. A knob whose row cannot name a superseding field is a
preference, and moves to the preference list.

### Small mechanical corrections, each with a test

- **Returning weapons and the edge band.** The round trip is a cadence cost and the band is a
  landing probability, so charging both is not double counting in itself; but the generic band
  floors a 300 px boomerang at 0.5 from 150 px out, on a deceleration the miner never read. Skip the
  *expiry* band for a returning projectile inside its turnaround, keep the round trip, keep the
  second pass conditioned on landing (`dps.js:657-659`), keep zero past turnaround, and key it on
  the mined `returns` fact (`projectiles.js:501-504`) rather than the archetype. Already measured
  as a gain; kept on the story, not the gain.
- **Confidence.** One field is too coarse once cadence comes from text and identity from code:
  `evidence` gains per-gate confidence (`cadence`, `maxActive`, `threshold`), `confidence` keeps
  describing identity and damage, and `unresolved-phases` reads the gates.
- **The case-tracker leaked an OR-ed key past its chain (fixed, 2026-09-05).** An `if (type == A
  || type == B)` compiles to `beq →body` / `bne →after`. `applyKeyBranch` installed B on the
  fall-through *with* `releaseKey(after, B)`, but installed A through `addGroup` at the jump
  target with no release offset at all, so A stayed on every block after the chain.
  `InfernalEclipseWeaponsDLC.TreasureBagDropChanges::ModifyItemLoot` was the case in hand: the
  crate chain ends at IL 613 and the next block, guarded by `TryGetMod("Consolaria")` and Ocram's
  own bag, still carried `bag:ThoriumMod:AquaticDepthsCrate` — Ocram's Roar staged at 11 off a
  pre-hardmode crate instead of post-mech and topped pre-hardmode bard. (`noDead: true` is why
  the absent mod does not prune the block; the key leak is why it was misattributed rather than
  merely ungated.) A jump target's key now belongs to the block that target opens: `keyAt` records
  what the `beq` arm carried and `endOfBlock` releases it at the nearest already-recorded forward
  jump target. Only jumps read *before* the target count, so a nested `if` cannot end the block
  early. **A ternary arm is not a statement block** and the first cut got this wrong: `NPCLoot.Add
  (npc.type == EvilConstruct ? DeathSpiral : StreetCleaner)` picks under the key and adds after the
  join, so releasing with the block dropped both SOTS weapons to a rarity guess. The discriminator
  is the stack recorded at the block end — non-empty means a value flows out and the key travels
  with it. Both shapes are pinned in `test/dataset.test.js`. Cost: Ocram's Roar 11 → 53 and
  Cape of the Survivor 54 → 45 (it had picked up a spurious `3× Beetle Husk` from a neighbouring
  block; its `AddRecipes` is Cursed Cloth + Darksteel Alloy and nothing else). Guide gate: IEoR
  bard +1 top-3, no regressions — the one real loss in the coverage waiver above, given back.

### Order and gates

| step | changes | re-mine | done when |
| --- | --- | --- | --- |
| 0 | guide-check, unresolved-phases | no | frozen pre-hardmode baselines; `--vs` fails on regression |
| 1 | shoot.js, phases.js, tests | yes | Astral's End composes to ×1.0; absolute damage survives |
| 2 | guards.js, shoot.js, projectiles.js, interp.js, dps.js | yes | one-sided conditionals have a complement; gates carry an event domain; tooltip no longer broadcast |
| 3 | dps.js compiler, score.js loadout | no | rates and damage separate; contributions reconcile; debuffs phase-local |
| 4 | projectiles.js table | yes | every row resolves; golden cases pass; scored only after 3 |
| 5 | observed.mjs, in-game trials | no | contact clock and uptime measured apart; rogue schedule measured |

Each step ends with `guide-check --pre --summary --json <after> --vs <before>`. A class that
regresses is explained in this document before the step is called done; a mechanically justified
regression is waived with the reason recorded.

### Done so far (2026-09-05): steps 0, 1 and 2

**Step 0.** `guide-check` no longer rewrites `guide-late-weapons.md` on a filtered run (`--no-write`
for the rest), `--vs` refuses a snapshot taken under other filters, compares every guide × class
and guide × family tuple on top-3, top-8, recall@K, section hits, MRR and the rankable denominator,
exits 1 on a regression, and `--waive "reason"` records the reason into the snapshot. The
over/under table prints on every run. `unresolved-phases` gained the residual: unread branches by
what they test on, one-sided guards, carriers, unmet requirements, unattached tooltip counters.

**Step 1.** The miner's compaction had been dropping `dmgMul: 1` to save bytes, so "×1" and
"unread" were the same absence. A call now carries `dmgMul` (omitted: ×1 of the argument),
`dmgAbs` (a flat number) or `dmg: 'unread'`. The whole-shot term and the call's share multiply
(Astral's End: 1.5 × 0.667 ≈ 1). `stealthMods.dmgMul` and `stealthMult` are one number read two
ways (identical on all 60 weapons carrying both) and are applied once, on the strike's deliveries,
children included. Children are spawned at the parent's share, not the weapon's (Death's Ascension
23,990 → 12,912; Naganadel 431 → 93). Of 111 absolute call damages 107 are holdouts spawned at 0:
they are *carriers*, and scoring them at zero was a data hole, so a carrier is an unread delivery
(one hit of the weapon's damage per use, flagged on the record and listed) until its AI's cadence
is read. Guide gate: Calamity +1 top-3 / +1 top-8, IEoR recall +2, one waived MRR shift (Blink
Blade's right-click children inherit its ×3).

**Step 2.** In `guards.js`: a backward conditional jump is a loop, never an if — reading it as one
had marked every `for` body as a guarded region (149 calls, 517 children); an inner `else` is
clamped to the block enclosing it; comparison branches (`blt`, `bge`, …) are conditions.
Readers, each emitting a gate with its domain from the method it was read in:

| reader | reads | gate |
| --- | --- | --- |
| counter | `x % N == 0`, `x >= K`, `x == K` on `ai[]`, `localAI[]` or a field of the mod's own type, through locals; a reset of the counter on the reached side | `threshold { n, event: use / hit / death / tick, reset, reached }` |
| alternation | a bool field of the item, branched on and flipped anywhere in the type (Thorium's `altSwing`, Hypothermia's `throwTwo`) — `use` domain only | `threshold { n: 2 }` |
| state machine | `field == K` on a field the type advances: one arm per constant it is compared against | `threshold { n: states }` |
| roll | `NextBool` through a local; `rand.Next(N)` compared to a constant, at the roll or through a local | `chance` |
| alt click | every spelling of `altFunctionUse` (`== 2`, `!= 2`, `== 1`, bare, through a local) | `alt` |
| ammo | `type == ProjectileID.X` in `Shoot` (the plain ammo fires one arm, anything else the other); `CheckWoodenAmmo` | `requires { what: 'ammoType' \| 'ammo' }` — the model decides with the ammo it grades with |
| world | `Main.zenithWorld` and the other seeds | `requires { what: 'world' }` — never met |
| crit | `hit.Crit` in `OnHitNPC` | `crit: true \| false` — the crit chance's worth |
| mirror | owner, netcode, facing and target-validity checks (`myPlayer`, `whoAmI`, `direction`, `CanHit`, `active`, `type`, …) | `branch { known: true }` — a two-armed one is a mirror: one of two symmetric shots |
| residual | everything else | `branch { id, side, cond }` — one id for both arms of an if/else, named by what it tested |

Buffs and flags on a mod's player class (`ThoriumPlayer.itemMoonlight`, a Red Mage enchantment)
were tried as requirements and reverted: they are nearly always the weapon's own state, set by the
weapon itself, and scoring them as unmet zeroed Moonlight and Fungicide-class weapons outright.
They stay in the residual under their names.

**Residual, counted.** After the readers: 213 unread calls on 136 items (from 773 on 435), 145
one-sided branch ids and 18 two-sided; 765 unread child spawns (from 1,785), mostly `ai[]` state
and Thorium's bard instrument dispatch. What the residual tests on is printed by
`unresolved-phases` every run.

**The model.** A priced call (roll, counter, requirement) is concurrent in `top`; an unread branch
is an alternative named by its id. A two-sided unread if/else is worth its **weaker arm** (the
rule for anything unread; the coin flip handed the rare arm half the weight); the losing arm's
phases contribute nothing, so the graph still reconciles. A **one-sided** guard keeps its shot at
full value and is listed, on purpose: measured, adding a no-op complement to the residual's
one-sided guards — mostly state and aim checks that hold far more often than not — assumes the
opposite of what they do, and the plan's "implicit no-op arm" is therefore not applied. A mirror
takes one arm. A counter in the `use` domain weights the arm `1/n` or `(n−1)/n`; in `OnHitNPC`
it gates a child once per n hits; in the AI with a reset it is the child's **cadence**: spawns per
tick of that clock for as long as the parent is there — the use for a held, placed or contact
parent, `SPAWN_WINDOW` (one second) for one that flies past. Children with a read cadence are
outside `CHILD_CAP`. A contact weapon's timer children are on their own clock rather than a second
instance on the boss (Riptide 165 → 51). The tooltip's counter attaches to the one child it can be
about — the only on-hit/on-death child, else the only burst — and to nothing when ambiguous; a
mined counter on a child outranks the text.

**Guide gate after step 2** (pre-hardmode, against the step-1 baseline): Calamity −1 top-3 (Sahara
Slicers' combo), MRR .261 → .263; IEoR +2 top-3, MRR .174 → .175; vanilla unchanged. Waived and
recorded: the Sahara combo, Spirit Blast Wand's timer child, the Thorium spear carriers, Blink
Blade. Tests: 297 pass.

**Knob added to the registry.** `SPAWN_WINDOW = 60`: how long a projectile flying past the boss is
near enough for its timer children to count. Retires on the parent's own time-on-target from
`hitsPerProjectile`; calibrated by a flying-spawner trial at fixed distance. And the carrier rule
(a 0-damage holdout as one hit per use) retires on the holdout AI's read cadence — the same counter
reader, once it walks the holdout's `AI` for spawns the case tracker does not see.

### Done (2026-09-05): steps 3, 4 and 5

**Step 3 — the minimal compiler.** Every damaging phase now carries its hit *events* and its
*share* of the weapon's raw damage apart (`events`, `share`, then `eventsSec` and `hitDmg` on the
graded record), and the model prices the two separately:

- the player's immunity window caps **events** — three shots at ×3 damage are three hits on the
  clock, a spray of 30 % children is a full hit each;
- **defense comes off each phase's own damage** through the armour pen it carries (the weapon's,
  the loadout's — `loadoutBonus` now returns `armorPen` — and the projectile's own): a 30 % child
  against a real boss is worth less than 30 % of the hit and can be worth the 1-damage floor. The
  correction is one part on the card, "defense taken off each phase's own damage", so the factors
  still multiply out; the stealth grade gets its own at strike damage;
- a **debuff is kept up by the phases that apply it** (uptime = their landing rate, capped at one a
  second), and the sources now include children two generations down — Contaminated Bile's
  Irradiated, carried by its explosion, was never seen before; bard "empowerment" allowances that
  only a rare crit-gated note applies are no longer paid at 100 %;
- a **summon** whose timer child has a read cadence goes through the same child path at one "use"
  a second instead of the `1.5 × n × landing` heuristic;
- the **terrain penalty** and the **rogue strike** reach the graph: every phase carries `grade`
  and a contribution priced in its own grade, and the contributions sum to the value for every
  weapon, rogue included (checked by test).
- `ROGUE_SPAM_SHARE = 1` names the fitted additive schedule (registry row below).

Pre-hardmode gate against the step-2 baseline: Calamity −3 top-3 / +1 top-8 (Turbulance's three
wind slashes are three events on the clock; Goobow's 25 % streams and Fungicide's spores meet the
armour), IEoR +1 top-3 / +1 top-8, vanilla −1 top-3 (Demon Scythe and Thunder Zapper swap a tie
once the loadout's armour pen reaches both). Waived with those reasons. 303 tests.

**Step 4 — the vanilla table.** `miner/extract/vanilla-behaviour.js`: 62 projectile rows and 6
ammo swaps, keyed by `ProjectileID` / `BuffID` / `ItemID` *name* and resolved against the
installed assembly at mine time — an unknown name fails the mine (it caught three of mine:
`ExplosiveBullet`, `TheDaoofPow`, `BulletHighVelocity`). A mined fact wins; the table fills what
the case tracker could not read. The dataset records the table's game version and row counts in
`vanillaBehaviour`, and every filled projectile carries `tabled: true`. The `ammoSwap` rows are the
other vanilla fact of the same kind — `Player.ItemCheck_Shoot` turning Wooden Arrows into Bee
Arrows for The Bee's Knees — attached to the item and honoured where the model picks the shot.
Coverage was built from the projectiles the scorer actually walks for the 80 vanilla pre-hardmode
picks (63 distinct, ammo and children included), not from `item.shoot`. Golden tests: Beenade's
bees, Molotov's flames and their On Fire!, the Hornet's stinger and its Poisoned, the Bee's Knees
swap. One row was wrong in kind and reverted: Water Bolt, Flower of Fire and the Zapinator bounce
off *tiles*; the model's `bounces` means off enemies.

Gate against the step-3 baseline: vanilla +7 top-8, recall +4, MRR .300 → .315 (Beenade 6 → 57,
Molotov 8 → 35, Bee's Knees 10 → 43); Calamity +1 top-3 ranged. Vanilla and Calamity summons −1/−2
top-3: Hornet, Imp and the DD2 sentries now carry their timer children and take the ranged-minion
rate (`1.5 × landing` per minion) instead of the flat 2 hits/s. Both numbers are knobs; the one that
retires them is the vanilla `aiStyle 62` attack timer, which belongs in the table once read.

**Step 5 — the observation protocol.** `tools/observed.mjs` now reads `data/observed.json`, whose
`protocol` field states what a trial records (item and prefix, target, distance, seconds, raw hit
count or non-crit total, overlap time, projectiles out, single vs crowd; three to five runs per
mechanic) and whose trials unlock one comparison per raw field: hit events per second, uptime,
the contact clock against `60 / local` or the 10-tick fallback, projectiles out against the cap
of 4. The four existing aggregate samples are migrated; none carries raw fields yet, and the tool
says so. The knobs stay where they are until the trials exist.

**Against the step-0 baseline, pre-hardmode:**

| guide | top-3 | top-8 | MRR |
| --- | --- | --- | --- |
| Calamity | 33 → 30 | 61 → 63 | .259 → .257 |
| IEoR | 66 → 69 | 141 → 143 | .175 → .175 |
| vanilla | 44 → 43 | 63 → 70 | .303 → .315 |

Eleven more picks in the top 8 and one fewer in the top 3, every move carrying a mechanical reason
recorded in the baseline's waivers. The point of the pass was never the aggregate: the model now
reads 281 use counters, 265 child counters, 133 requirements, 250 mirrors and 62 vanilla rows it
used to guess at, prices events and damage apart, and lists what it still guesses.

**Registry additions.**

| knob | stands in for | retires on | calibrated by |
| --- | --- | --- | --- |
| `STEALTH_LOOP_STILL = 0.5` | how much of a rogue's refill pause is spent standing still (4 s still, 8 s moving) | the rogue schedule trial (an alternating throw/pause loop, timed) | that trial |
| summon `1.5 × landing` per ranged minion; flat 2 / 1.5 hits/s | a minion's attack timer | the vanilla `aiStyle 62` / `DD2` attack timers as table rows with `threshold { event: 'tick', reset }` | a minion on a dummy, event count over duration |
| the vanilla table's counts and shares (Beenade 5 bees, Molotov 3 flames at 50 %) | what `Projectile.AI` rolls | reading `Projectile.AI` per aiStyle in the tracker | the wiki's numbers where it states them |
| `LINGER_ON_TARGET = ARCHETYPE.placed.uptime` | the share of its life a blast that stays where it went off — a poison cloud, an acid pool, a flame pillar — has the boss standing in it. Its first hit is paid for (the parent connected there); the ticks after it were being credited in full, so a lingering child read as 10–19 free hits per parent death | a child record carrying its own movement — velocity, `ridesOwner`, a mined homing turn rate — so a cloud that chases the boss is told from one that sits | a cloud weapon on a moving boss: hits landed per blast against the blast's own tick count |
| `SPAWN_DUTY = 0.5` (`score.js`) | how much of an *accessory's* free minion's uptime is spent swinging: it takes no target order, does not scale with class damage, and nothing here reads its AI, so the 3 hits/s its immunity window allows is a ceiling it never holds | the spawn's own attack timer, the same field the summon row above retires on | a Fungal Clump on a dummy, hits over duration |
| `DYN = 0.25` (`score.js`) | a stat whose tooltip is a `{0}` template applied through a player flag: what the miner read are the formula's constants, which are its *cap* far more often than what it pays at the stage (Light-Bringer's Ring prints a 30 % ceiling on a bonus that scales off defense a pre-boss player does not have) | evaluating the formula against the loadout's own stats | the item's own tooltip in game, at two stages |

**Leads found, not chased.**

- ~~**`maxOut` is not applied as a sustained rate limit except to returning weapons.**~~ **Done** — see the row above. The blanket form really was as unsafe as measured (it zeroed ten weapons on the first attempt and cut a boomerang the player had measured at ~100/s to 16); what made it safe was reading three facts already in the record instead of naming the weapons to skip.
- ~~**Bard is ranked on the wrong axis.**~~ **Corrected by the pack's own player: this pack rebalances bard to roughly standard damage**, so the empowerment story does not excuse the gap and the mismatch is a scoring one. What the numbers say, best-available weapon per class at a +20% loadout:

  ```
  stage   melee  ranged   magic  summon   rogue    bard
      0     121     202      58      90      90     334
      6     110     204      64      93      92     321
     12     163     207     137     120     128     374
  ```

  Bard is 2–3× every other class through pre-Hardmode, and it is **one weapon**: Riveting Tadpole.
  It is the only bard weapon in the pack with a pierce multiplier above 3 (×5.15; the class mean is
  1.13). Drop it and bard's best at Pre-boss is Panflute at 191, level with ranged's 202.
  The mechanism is not a bug in any one term — it is a slow homing bubble, `pen -1`, `life 120`,
  no local immunity, that reaches the boss with 63 ticks left and is credited a hit per 10-tick
  window for all of them. The shared-immunity cap *does* fire (×0.62, 9.6 hits/s down to 6), so the
  weapon sits at the theoretical ceiling for a shared-window weapon and everything above follows.
  The knob under it is `RECONNECT_SEEK`, which lets a seeker hold the target for its whole
  remaining life; nothing else in the pool reaches the ceiling, which is why bard alone stands out.
  Wants an in-game reading of one Riveting Tadpole bubble — hits landed per throw — before the knob
  is touched, because every other seeker in the pack rides on the same number.

- **`BardItem.InspirationCost` is mined but deliberately not priced.** 192 weapons carry one,
  spread 1–10 and mostly 1–2. It is not priced because it does not bind: `ThoriumPlayer` regenerates
  one point per 8 ticks, ramping to one per 2 as `inspirationRegenBase` climbs to 5 — 7.5 to 30 a
  second against costs of 1–2 at two or three uses a second. The field is in the dataset as
  evidence for whoever measures the bar; pricing it on a guessed steady state would be a new
  error, not a fix.

- **Fishbone Boomerang is tagged `spear`, and is right by accident.** Its AI sets
  `Owner.heldProj` inside `if (ChargeProgress < 1f)`, the wind-up branch — but the machine
  resolves that progress to 0 at the first tick, so the store reads as *unconditional* and
  `held` is set on a ricocheting boomerang. `ATTACHED` then exempts it from travel lead, arc
  and range altogether. Only 7 projectiles carry `held` together with `bounces` or `returns`,
  and two of those (Fishbone, Equanimity) are the mis-tag; the rest include a laser drill
  where clearing `held` would be its own error. Left alone deliberately: the one number that
  can be checked says the current answer is right — ~100/s reported from play against 94–103
  from the model — and re-tagging it would pay a round trip and a landing it currently skips,
  moving it away from the measurement. Wants a `held`-in-a-wind-up-branch reader, not a patch.

- **`stealthMultiplier` against a fifth in-game reading.** Harpy's Barrage post-Crabulon shows
  60 at an empty stealth bar and 200 at a full one — a ratio of 3.33×, which is loadout-free.
  The model gives 3.70 at Max Stealth 100 and 3.16 at 80, so the reading pins the formula only
  as far as the player's Max Stealth is known, and it was not recorded. Both rows are in
  `data/observed.json`; re-taking them with the Stat Meter's Max Stealth written down would
  settle it. The model's *spam* damage for the same weapon is 60 on the nose, so the damage
  side of that chain is confirmed.

- ~~**`CHILD_CAP` bounds the children's hits but not their multiplier.**~~ **Chased, and the lead was wrong.** The "net child multiplier" it was raised on is the weapon's total over its *parent's own* contribution, and that ratio is naturally enormous for anything whose damage lives in its children — a bomb, a detonator, a burst horn — which is a description, not a defect. The ranks are sane where it mattered: Arclight Orbs #4/159, Cadaver's Cornet #9/125, 24-Carat Tuba #40/103. The one case that looked unambiguous, Vorpal Knife reaching 44 px of the 60 it needs and still being paid for what it drops on death, turns out to be correct: `drag 0.725` stops the blade at 44 px because it *"lingers in the air"*, and the 200% detonation children are the attack. Making the blast a widening of the parent's landing rather than a floor was tried and is wrong — a bomb's blast *is* meant to reach back, and two tests say so.

- Seven vanilla items resolve their `shoot` to the wrong projectile in `vanillaItemDefaults`
  (Abigail's Flower, Crimson Rod, Flinx Staff and Houndius Shootius read `FairyQueenRangedItemShot`;
  Light's Bane, Night's Edge and the Paintball Gun read `DD2BetsyArrow`) — a case-tracker slip in
  `Item.SetDefaults`, visible in `vanilla-cover`'s list.
- Thorium's bard instruments dispatch on `BardProjectile.get_InstrumentType` (87 child spawns):
  the instrument is a fact about the item, readable as a requirement met by construction.
- The residual's remaining named conditions — `WeaponPlayer.manaStack`, `StarsAbovePlayer.*Aspect`,
  `Player.maxMinions` — are resource and loadout state the model does not carry yet.
- A holdout's own `AI` spawns (the 64 carriers) are the next counter-reader target: the same
  `counterRanges` on the holdout's `AI` for `NewProjectile` calls the case tracker does not see.

### Modes are loops, not a sum (2026-09-05)

Raised on Scourge of the Desert, labelled `[spam]` at a rank that only makes sense for its strike.
The general defect: a rogue weapon's two grades were priced as *continuous throwing* and *one
strike per recharge with nothing thrown between*, then summed, and the label went to the larger.
A strike-only grade is a payload over a recharge and is small against any sustained rate by
construction, so every one of the 38 pre-hardmode weapons the miner sees a stealth branch or
stealth-only child on was labelled spam, 33 of them with a stealth grade under a fifth of the spam.
Calamity's code says the two cannot add: `UpdateStealthGenStats` returns 0 while the item animates,
`ProvideStealthStatBonuses` turns the current bar into the next attack's damage bonus, and
`ConsumeStealthByAttacking` empties it on the strike. The player is in one loop or the other.

**Now.** Spam is throwing with no strikes. Stealth is the throw-pause-strike loop: one strike per
pause plus throw, the pause being the bar's refill at `STEALTH_LOOP_STILL` standing still (4 s
still, 8 s moving; 0.5 → 6 s), its debuffs kept up at the loop's landing rate. The weapon is worth
the better loop, that loop names the grade, and the loop not taken contributes nothing to the graph.
The additive schedule and `ROGUE_SPAM_SHARE` are gone. Measured (pre-hardmode): Calamity rogue
+2 top-3, MRR .257 → .267; IEoR stealth family −1 (a pick the sum used to carry). At a full
standing pause (`STEALTH_LOOP_STILL = 1`) Scourge flips to stealth (53 against 51) but Calamity's
gain vanishes: every strike loop grows by half and unlisted rogue weapons overtake guide picks.
Kept at 0.5, on the measurement.

**Where Scourge lands, and why it does not double.** Spam 46, stealth loop 35. Both grades sit at
their pierce caps: the spam javelin gets both of its 2 hits and each strike javelin its 4, because
the same unread homing record (the 300 px default, no speed read) earns both the seeker's twelve
reconnects. What makes it a stealth weapon in play — the strike javelins landing all twelve on a
moving worm while the spam javelin stalls and whiffs — is a *landing* fact the model has no read
for, and it cuts both ways: taking the seeker credit away pessimistically hurts the strike more.
The strike multiplier is Calamity's own arithmetic (transcribed from `ProvideStealthStatBonuses`:
`stealth × 0.42 × (0.75 + 0.75·log₄(useTime+2)) × max((genTime/gen)^⅔, 1.5)`), and the 15 % it sits
under the shown damage is the player's stealth-gen gear, not the formula. The trial that settles
it is in `data/observed.json`'s protocol: hits landed per throw for the spam javelin and per strike
for the three, over a fixed window against the same target. Until then the label follows the
arithmetic and says so.

**The factor of two, found.** With exclusive loops Scourge still read spam (46 against 35) and no
rogue weapon at post-Eye of Cthulhu read stealth. The recharge was wrong by exactly two:
`CalamityPlayer.UpdateRogueStealth` adds `rogueStealthMax × gen / 120` every tick, with `gen` = 1
standing still and `MovingStealthGenRatio` (0.5) moving — the bar fills in **2 s still, 4 s
moving**. `BaseStealthGenTime = 4`, which the model had built its recharge on, feeds only the bar's
on-screen regen figure and the strike damage formula. `STEALTH_FILL_TICKS = 120` is that read;
`stealthRecharge` blends it by the share of the pause spent still (3.6 s at the 20 % fight blend,
3 s at the loop's 50 %). Confirmed at the same time: `UpdateStealthGenStats` returns 0 while the
item animates, and a normal throw on a partial bar sets it to 0 (`UpdateRogueStealth`, the
`!StealthStrikeAvailable` arm) — the loops are exclusive in the code, not only in the model.

Result: Scourge of the Desert reads **stealth** at its own stage (64: 12 hits per strike every
3.4 s against 46 of throwing), 6 of the 38 strike-designed pre-hardmode rogue weapons flip and
none of the 46 plain ones do — a plain weapon's generic strike (one throw at ×2.33 per 3.4 s) is
about a fifth of throwing it, which is right. Two things the post-Eye of Cthulhu list still shows:
the stealth stance stands at 420 px (the class preference), and against a small fast boss like the
Glowmoth Scourge's javelins keep only 32 % on target from there, so it reads spam at that stage —
a distance preference, not a fact. And Mycoroot's 12-spore strike now leads three Calamity rogue
tiers (107–150): mechanically read (12 homing spores at weapon damage per strike), named a top
pick by IEoR, not listed by Calamity's guide — a disagreement, recorded, not tuned. Gate: Calamity
rogue gives back the two top-3 the exclusive loops had gained, MRR .258; waived with the fact.
`observed.mjs` now compares a stealth trial against the stealth loop: Scourge 128 against 300
measured, Contaminated Bile 66 against 230 — the loop is still short by half against the meter,
and the meter is a burst reading until a trial records the window.

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
| 2026-09-05 | miner: `item.lifeCost` — `player.statLife -= N` in a weapon's own use hooks; priced as a pool beside mana and void, and the tightest pool governs | 61 / 135 | 0.126 | 126 / 151 | 5 weapons pay in health and none of them was being charged for it: Sanguine Despair 70 → 40/s, Der Freischütz 39 → 29/s. Pre-hardmode metrics flat (only Sanguine Despair is pre-hardmode, and no guide names it). Knobs: `lifeRegen` (2 + 0.8·prog) and `LIFE_FLOOR` 0.2, under mana's 0.35 because a health bar running dry ends the fight. Gaps: a cost that is a share of max life, and one behind `altFunctionUse == 2` (Butcher's Bloodmaker), stay unread |
| 2026-09-05 | miner: `projectile.windup` — a projectile that assigns its own `friendly` in `AI` is harmless for part of its life, so the use time is not the clock; it pays `WINDUP_TICKS` in front of every shot | 142 → 141 / 284 → 285 | 0.247 → 0.248 | 16/16 | the complaint that opened this: Gel Glove was throwing 3.3 fully-armed balls a second at a weapon whose ball is parked on the player, doing nothing, until you let go. 97 → 21/s. Two other projectiles carry the flag (Yharim's Crystal, Mage Hand) and neither is a ranked guide pick, so the metric does not move on this alone. Gap: the counter's cap is not read, so every wind-up is priced at the same second |
| 2026-09-05 | miner: `item.exhaust` — Thorium's thrower exhaustion as a pool beside mana, void and health | 142 → 141 / 284 → 285 | 0.247 → 0.248 | 16/16 | `ThoriumGlobalItem.Shoot` charges `useTime * 2` against a bar of 1200 regenerating at 1/tick, so **every** non-consumable Thorium thrower spends 120/s against 60/s whatever its use time — a flat ×0.5 duty cycle on all 41 of them, and the model had been charging them nothing. This is the whole cost of the pass: ieor rogue top-3 8 → 4, ieor spam top-3 5 → 1. The guides rank these picks *within* a class that all pays the tax; the lab ranks them against Calamity rogue weapons that do not, which is the comparison the tax makes real. The lockout on top of the duty cycle (`throwerExhaustionPenalty`: −0.2 damage per shot to zero, cleared only when the bar drains) is not priced, so the reading is still generous |
| 2026-09-05 | `gravityK` is a pull per *update*, and the flight it was squared against was in ticks | 142 → 141 / 284 → 285 | 0.247 → 0.248 | 16/16 | a projectile with `extraUpdates` was being handed a flat arc: the drop is `(1+updates)²` times what `landing` charged, which is 4× for the commonest case. `reachOf` had the units right all along. Net positive against the guides (calamity top-3 +1, calamity rogue recall@K +1, vanilla top-8 +1) against ieor stealth −1 and calamity melee recall@K −1. Costs one observed trial: Scourge of the Desert 0.50× → 0.41× of its meter reading, inside a model already sitting at a 0.61× median |
| 2026-09-05 | miner: a `velocity.Y +=` above `GRAVITY_MAX` is a steering blend, not an arc | 142 → 141 / 284 → 285 | 0.247 → 0.248 | 16/16 | found by the row above amplifying it: Valediction's `gravityK` of 5 is the Y half of a boomerang's turn-around, and squaring it against 4 updates dropped the thing 300 px inside three ticks. 18 projectiles lose an arc they never had (Calamity's boomerangs, a whip, a trombone laser) and 4 fall back to a real read (Titanium Shuriken 3.2 → 0.1, ×2.6 on the weapon). Gating on `ctx.conditional` the way `noteDrag` does was tried first and cost 213 genuine arcs — mods apply gravity inside `if (!sticking)` — so the bound is on the value, not the branch |
| 2026-09-05 | miner: gravity only ever touches Y — the same constant pushed along **both** axes is a seeker's turn rate | 142 → 141 / 284 → 285 | 0.247 → 0.248 | 16/16 | the `GRAVITY_MAX` bound cannot reach a turn rate that is itself a plausible pull. Scourge of the Desert arcs at `+= 0.15` before it burrows and turns at `+= 0.2` in its chase block; `Math.max` took the 0.2, and the correct-unit drop then charged a javelin that launches itself at enemies a 123 px parabola — it fell #2 → #4 and 89 → 54/s, which is what raised the complaint. 32 projectiles turn out to have had no Y-only write at all (bees, homing pets, `AstrealArrow`, `GhoulishGougerBoomerang`) and 5 fall back to their real arc (Calamity's hammers 1.1 → 0.43–0.6). Scourge back to #3 / 72 /s and 0.41× → 0.44× of its meter reading; the gravity pass is now net-positive against the guides on its own (calamity top-3 +1, calamity rogue recall@K +1, vanilla top-8 +1, against calamity melee recall@K −1). Failure mode: a real arc whose constant coincides with an unrelated X add is lost |
| 2026-09-05 | one steering budget, against the *largest* of the three misses rather than the drift alone | **142 → 141 / 284 → 285** | **0.247 → 0.248** | 16/16 | `landing` priced a seeker's correction against the boss's movement only, and the spread was settled before homing was even computed — so a fan of homing javelins was billed "1 of 3 land" for an angle they steer out in a couple of ticks, and the arc was charged in full beside it. Summing the three misses was tried first and made every seeker *worse*: they do not add, because one heading correction removes all three at once, so the budget has to cover the largest and not the total. 93 weapons move, 92 of them up, median ×1.12. Scourge of the Desert #4 → **#2** at 111/s and its observed trial 0.44× → **0.54×**, past the 0.50× it started at — the one weapon here with an in-game reading moves toward it. The calamity rogue top-3 losses are Scourge climbing *over other guide picks in its own sections* (Contaminated Bile #2→#3, Feather Knife #2→#3, Ashen Stalactite #4→#5), which the gate counts as a regression and a player would not. Standing gap: 361 of the 408 seekers carry the pessimistic default range and no read turn rate, so "heavy homing" is still a guess |
| 2026-09-05 | miner: the third homing shape — a per-axis accelerator — read as `homing.turn`, in px per update² | 141 / 288 | 0.248 | 16/16 | the reader knew `HomeInOnNPC(range, speed, inertia)` and the `(v·(N−1) + dir·s)/N` blend, and nothing else: 408 of 646 seekers carried the pessimistic default range and a turn rate that was the *item's* shot speed over `HOMING_INERTIA`, a number with no projectile in it. `if (velocity.X < to.X) velocity.X += k` is the shape neither reader sees, and it is the same both-axes write the gravity rule already collects — so the fact was on the floor. 12 projectiles now state their turn, Scourge of the Desert at 0.2 a update, which is 0.8 a tick² once its extra update is counted against the 0.6 that was being invented for it |
| 2026-09-05 | the homing line says which half of it was read (`rangeGuess`) | 141 / 288 | 0.248 | 16/16 | score-neutral, verified. `turn 0.6/tick` printed next to a mined one as if the two were the same fact; the fallback range was baked into the dataset where `speed` and `inertia` were honestly absent. Now: `homing (300 px, turn 0.8/tick — range assumed)` |
| 2026-09-05 | a pool that states a `cap` is a reservoir, not a rate; and the stealth loop pays at *its* rate | **142 → 141 / 284 → 288** | **0.247 → 0.247** | 16/16 | two bugs in the exhaustion pass, both found by the complaint that a thrower should not be halved. (a) The bar holds 1200 and a spammed thrower overdraws it by 60 a second, so the first twenty seconds are free and the penalty has not happened yet — priced as a bare rate it was a flat ×0.5, and over `FIGHT_SECONDS` it is ×0.67. (b) The stealth grade was copying the *spam* rate's sustain into its parts list and showing a ×0.5 the value never applied: the card said the strike was taxed and the number said it was free. The stealth loop casts once per ~3 s through a pause the strike requires, and the bar regains 60 a second across it, so exhaustion never builds there at all — which is exactly what the report said. Both now agree. Vibrant Tomahawk 32 → 43/s spam, and the false ×0.5 is gone from its strike |
| 2026-09-05 | interpreter: a marker declared `taint` survives being computed with; miner: per-axis steering *toward the owner* is a return | 141 / 288 | 0.247 | 16/16 | `carriesOwner` was written for `velocity = <owner vector>` and Calamity's boomerangs never do that — they nudge each component toward the player a step at a time, and the marker died at the first `sub` anyway. So Kylie, Valediction, Valari, Butcher Knife, Ghoulish Gouger, Celestus and Calamity's returning hammers all read as fire-and-forget daggers thrown on the use timer: 24 projectiles gain `returns`. The discriminator against the seek shape above is what the steering is aimed at — the owner direction taken apart into components, versus an NPC. Kylie 81 → 32/s, the loss being the round trip it has to wait out (×0.58, one out at a time) rather than anything about its damage |
| 2026-09-05 | a boomerang's two passes *multiply* what one pass lands rather than replacing it | **141 / 289** | **0.247** | 16/16 | the `passes` branch short-circuited before the crowd model ran, so a returning projectile threw its pierce away with everything else: Kylie carries `pen −1` through six bodies and came out at 1.4 hits, worse than a dagger that pierces nothing. Restricted to boomerangs — a spear's two passes are one thrust returning along the same line, on the same body, and a test says so. Kylie lands at 32/s instead of the 6/s the short-circuit gave it |
| 2026-09-06 | miner: `ModifyShootStats` respects the right-click guard (`fire.altMods.type`) | 141 / 288 | 0.247 | 16/16 | `if (player.altFunctionUse == 2) type = WulfrumManaDrain;` was read without the guard, so **18 weapons** had their right click's projectile scored on their left: Wulfrum Prosthesis fired a 36 px mana drain instead of its bolt and scored a flat **0.00/s**, Crackshot Colt shot Ricoshot coins. The stealth branch already had this treatment in the same walk (`stealthCells`); the alt branch is the same shape one `altRanges` away. Prosthesis 0.00 → 21.7/s. Also fixed the assembler dropping the new field, the same whitelist that ate `item.exhaust` |
| 2026-09-06 | a `Shoot` that was read and says this click fires nothing is believed | 141 / 288 | 0.247 | 16/16 | Bellerose opens with `if (player.altFunctionUse != 2) return false;` — its left click throws nothing, and the tornado `item.shoot` names is a right-click payload gated on three successful attacks. The `!calls.length` fallback filled that in with `item.shoot` anyway and handed the tornado out every 17 ticks. Gated on the weapon's attack demonstrably living on the other click: refusing the fallback on `defaultShot` alone stranded 60 weapons with no phase at all, past the coverage pin of 30 |
| 2026-09-06 | miner: `projectile.ownAi`; a zero-damage spawn with no AI is a prop, not a carrier | **142 → 141 / 284 → 288** | **0.247 → 0.247** | 16/16 | the carrier rule assumes "its AI fires the real shots and the miner could not read them", true of 107 of the 111 in the pool. Bellerose's held umbrella is not one of them: `aiStyle 19`, `hide`, zero damage, `SetDefaults` and nothing else — and it was being paid a full 57-damage hit 3.7 times a second. `ownAi` is `false` where the walk looked and found none and *absent* where nothing looked (vanilla, synthetic), because "we looked and there is nothing" and "we did not look" want opposite answers — a test pins the second. Bellerose 350 → 118/s at Pre-boss, into the 121 / 118 / 115 / 114 cluster it belongs in |
| 2026-09-06 | interpreter: `player.position` reached as a *field* is the owner, the same as `player.Center` reached as a property | **142 → 141 / 284 → 288** | **0.247 → 0.247** | 16/16 | only the property call was recognised, so a projectile that returns by `player.position.X + player.width * 0.5f - Center.X` read as one that simply flies away. Thorium's Whip is `useStyle 5`, `maxOut 1` and out-and-back in its own AI, and was being scored as a fire-and-forget shot on a 12-tick use timer: **265.7 → 94.3/s**, top of Pre-boss melee to sixth, and tagged `boomerang` instead of `shot`. 10 more projectiles come with it — Volt Hatchet, Shade Kusarigama, Omen, Heartstriker, Bat Scythe, both tambourines, Calamity's Enchanted Axe — the same family whose return acceleration was being read as gravity two passes ago |
| 2026-09-06 | a volley shares the player's immunity window: `n` thrown at once land **one** hit between them, `min(n, bodies)` in a crowd | **142 → 144 / 284 → 288** | **0.247 → 0.253** | 16/16 | vanilla checks `else if (npc.immune[projectile.owner] != 0) continue;` — the first pellet of a blast sets the window and the rest of it finds the target immune, and `usesLocalNPCImmunity` is the only thing that buys a projectile out. The rate cap below already stated this fact *per second* and its own comment says so; what it cannot see is simultaneity, so Harpy's Barrage slipped under a 6 hits/s ceiling throwing three feathers in the same instant and was paid for all three. `1 − (1−L)^(n/bodies)` per body: one body collapses the volley to a single arrival, bodies to spare return `n·L` and nothing moves. **152 weapons** fire a volley with no local immunity — 61 ranged, 39 magic, 15 healer. Harpy's Barrage 362 → 181/s and #1 → #2 through pre-hardmode; Aquashard Shotgun 103/s single against 184 multi, which is what a shotgun is. First pass this run to beat the original baseline on all three pre-hardmode metrics, and it fixed the two rogue-grade tests that had been red since before any of it — **313 pass, 0 fail**. Cost: calamity recall@K −3, concentrated in ranged, where the guides pick shotguns for crowds and the lab scores a single target |
| 2026-09-06 | miner: `effects.spawns` — an equip hook that spawns a projectile keeps a minion out, and it is graded like the summon weapon it is | 141 / 290 | 0.210 | 122/142 | the complaint that opened this: the Fungal Clump's whole tooltip is "summons a fungal clump to fight for you" and it scored **0**. `UpdateAccessory` / `UpdateArmorSet` run every tick, so a `NewProjectile` in one is a companion the item keeps out (`ownedProjectileCounts` guards all 18 of them); `GetBestClassDamage(player).ApplyTo(10)` is its damage. Scored as damage through `typicalDefense(progression)` (new, fitted to every stage's biggest NPC: 10 at the Eye of Cthulhu, 50 at Providence) × the rate its immunity frames allow × 0.9 uptime ÷ `typicalDps`, capped at what a minion slot is worth at the stage — a free minion is at most a slot the summoner did not have to buy, and it is a *fixed* minion where the slot holds the best staff of the moment. Fungal Clump 0 → 15.3 at Crabulon, 0.3 by Duke Fishron. Two conditions that cost 12 of the 13 accessory picks the first cut lost: a **negative** hit cooldown is one hit per life, not 2/s (the Frozen Cube's Elumphant), and a spawn that neither `minion`s nor homes is a body the boss walks into, not a minion (the Marnite Repulsion Shield's hitbox) — those are skipped. A set bonus whose spawn *was* read pays half the flat "does something unreadable" base, since the sea snail is no longer unread. Vanilla plays the same trick one level down: Stardust's guardian is a `NewProjectile` inside `Player.UpdateArmorSets`, keyed to the head/body/legs triple the case tracker was already walking, with `Type` and `Damage` the first two consecutive ints of the call (true of both overloads). Stardust Helmet's set bonus, which is *only* the guardian, now reads it: 30 damage at Moon Lord is 0.9 points, and the flat halves to 2.5 — 5 → 3.4, which is what a set bonus worth one point of DPS should score. Net over the full run: calamity accessories in top-6 232 → **234**, calamity set top-5 170 → 168 and ieor set #1 31 → 30 (Aerospec over Bee, Mollusk over Spider and Crystal Assassin — all ±1 rank), MRR up, weapons and vanilla untouched |
| 2026-09-06 | a volley's landing is *correlated*, so the collapse is `min(n·spread, bodies) × the rest of the landing` | **142 → 144 / 284 → 288** | **0.247 → 0.253** | 16/16 | the first form of the rule above, `1 − (1−L)^n`, treated the volley as `n` independent chances to connect and flattered every one of them: `land.f` is dominated by the travel lead and the arc, and both are common-mode — if the boss has moved, or the shot drops short, the whole volley misses together. Collapsing *all* of `land.f` was the second try and charged a random spread twice, once in `spreadAt` and again in the collapse, putting a single-shot gun above a three-shot one. The split is the answer: the spread is the independent half and `spreadAt` already prices it; everything else is paid once. Harpy's Barrage 362 → **121/s** and out of the rogue top three at every pre-hardmode stage. Best pre-hardmode agreement of the run |
| 2026-09-06 | a target flagged `still` is not led | 144 / 288 | 0.253 | 16/16 | `vb` read the stage's boss speed and never looked at `b.still`, so the stationary dummy `observed.mjs` uses to isolate the hit clock was being charged a moving boss's travel lead — every dummy trial was compared against a model paying for something the trial never paid. No stage boss carries the flag, so only the trials and the test fixtures move |
| 2026-09-06 | …but a *seeker* does not waste itself on a closed window: it comes back | **144 / 287** | **0.247** | 16/16 | arriving inside the player's window only wastes a shot that cannot come back, and a homing projectile can — it turns round and keeps hunting until one opens, which is the same fact `hitsPerProjectile` already reads its time-on-target from. Mycoroot's stealth strike throws twelve spores that live sixty seconds apiece at `pen 1`; collapsing them read a batch as worth one spore when it is worth twelve. Reported from the game as ~1100 damage a batch on a single target, against 1008 from the model at a +100% loadout — the strike goes 41 → 214/s and Mycoroot takes #1 in four of its five Calamity sections. 28 weapons throw seeker volleys with no local immunity (Lunar Kunai ×10, Stellar Knife ×10, Empyrean and Illustrious Knives ×8, Polaris Parrotfish ×30). What bounds the queue is the rate cap: a strike is allowed the windows in its own recharge, and twelve fit inside 2.6 s. Costs 0.006 MRR against the guides, all of it Calamity picks reshuffling above other Calamity picks — an in-game reading outranks a proxy |
| 2026-09-06 | miner: vanilla bounces every `aiStyle 3` boomerang off the first thing it hits, so its `penetrate` is not a path through a crowd | **142 → 146 / 284 → 288** | **0.247 → 0.249** | 16/16 | the reversal is in `Projectile.Damage`, not in any AI a mod writes — `if (aiStyle == 3) { if (ai[0] == 0f) velocity = -velocity; ai[0] = 1f; }` — so the `bounces` flag, which only fired when a mod's own `OnHitNPC` wrote velocity, missed all of them. 41 of the 47 projectiles on that aiStyle carried a pierce they cannot use: every vanilla boomerang from the Wooden Boomerang to the Light Disc, Bananarang, Possessed Hatchet, and Calamity's Sand Dollar, whose `penetrate = -1` had it sweeping six bodies a throw and topping the multi-target rogue list at post-Crabulon. Reported from play: it turns round on the first enemy. Sand Dollar 152 → 41/s on a crowd; vanilla's top-3 loss for the run closes (−2 → 0) and its recall@K goes positive. Best pre-hardmode top-3 of the run |
| 2026-09-06 | "faster than the boss" asked in the boss's units | **142 → 145 / 284 → 287** | **0.247 → 0.248** | 16/16 | the gate that switches homing on compared `hs` against `vb`, and where `homing.speed` was not read `hs` falls back to the item's shot speed — a step per *update* — while `vb` is px per *tick*. A seeker with extra updates therefore read as slower than what it was chasing and lost the term outright. **36 seekers** were losing it, every one of them comfortably faster than the boss: Mothwing Dagger steps 4 and moves 16 px/tick on `updates: 3`, Nebula Blaze 6 → 18, Cadaver's Cornet 5 → 40. A *read* `homing.speed` is already a chase speed and still answers directly, which a test pins. Reported from play as "we don't even see that homing, but it's there, it's only slight" — and slight is what it prices, ×1.1 on the dagger. Mothwing 112 → 123/s, and against Fishbone Boomerang at the reporter's own loadout the pair now reads 103 vs 187 where the game gave ~100 vs ~230. Costs 1 top-3 |
| 2026-09-06 | miner: `projectile.ridesOwner`, and a *ring* is placed on you rather than thrown | **142 → 143 / 284 → 286** | **0.247 → 0.248** | 16/16 | the mirror of the `sticks` rule: a projectile that writes its own centre from the owner's, unconditionally, every tick is anchored to the player. On its own that says almost nothing — 129 projectiles do it and nearly all are held beams, swung blades and minions, which `archetypeOf` has already claimed by the time it asks. It earns its keep in one conjunction: anchored, launched at a `shootSpeed` of nothing, and *several at once*. Thorium's Energy Projector is the only weapon in the pack that is all three — `Center = player.Center + rotVec.RotatedBy(rot + Index * 0.5236f)`, twelve Granite Barriers orbiting 30° apart — and with `shootSpeed 0` read as an unread launch speed the model was flying all twelve 340 px to the boss for 178 DPS and the top of pre-Hardmode magic. Reported from play: they orbit and do not home. As `placed` it is 65/s and off the top five: 4 hits/s in contact on its own 15-tick immunity, 30% of the time on the boss, fighting at 80 px instead of 340. Deliberately narrow — a conjunction that happens to have one member, not a rule looking for customers |
| 2026-09-06 | miner: a projectile that bounces off what it hits is not one the player holds out | **142 → 147 / 284 → 289** | **0.247 → 0.253** | 16/16 | `held` means the player holds it out and it never travels on its own; `bounces` means it flies into things and comes off them. Both cannot be true, and where they are it is the `heldProj` read that is wrong — a charge weapon sets it inside its wind-up branch, and the walk folds a `ChargeProgress < 1f` guard to true on the first tick, so the store reads as unconditional. Three projectiles carried the contradiction; Fishbone Boomerang and Equanimity were coming out **`spear`** — held, and so exempt from travel lead, arc and range altogether — for weapons that are thrown and ricochet between three enemies. Both are `dagger` now. Fishbone reads 62/s against ~100 reported from play, which is 0.62 of it: the model's own median is 0.61, so it has stopped being accidentally exact and started being wrong by exactly as much as everything else. Best result of the run — the first pass to put **Calamity above baseline** (top-3 +3, top-8 +3, MRR 0.219 against 0.217) as well as ieor +4 / +3 |
| 2026-09-06 | miner: a child gated on a `ModPlayer` gear flag is a requirement on the *loadout* | 147 / 289 | 0.253 | 16/16 | `if (player.accMixtape) spawn six extra notes` — Thorium routes every bard projectile through one `BardProjectile.OnHitNPC`, so five accessory-gated spawns hang off **123 of the 137** bard weapons that spawn anything, 784 children the model paid for whether or not the player owns one of the accessories. No other class has a single one. `requiresRanges` already had the shape for ammo and world seeds; a gear flag is one more case, and `childHits` already zeroes an unmet requirement. The card now says "needs the Mixtape accessory the loadout does not carry". Score-neutral in practice — `CHILD_CAP` was quietly absorbing them — but the weapon page stops claiming hits nobody has the gear for |
| 2026-09-06 | miner: `analyzeShoot` reads `BardShoot`, the method bards actually override | **147 → 142 / 289 → 284** | **0.253 → 0.247** | 16/16 | `BardItem.Shoot` is an eighteen-byte forwarder to a virtual `BardShoot` with the identical seven-parameter signature, and the machine was not following it through: of 208 bard weapons only 64 had a `Shoot` read and **34** their projectile calls, against 52–62% for every other class that shoots. Reading the real method takes that to 126 and **116**. **And bard agreement got *worse*** — ieor bard top-3 −2, top-8 −3, MRR 0.123 → 0.117 — which is the finding, not a side effect: a sharper damage read can only move away from a guide that is ranking on a different axis. Kept, at the cost of the run's whole pre-hardmode gain, because the alternative is preferring a wrapper method's silence for scoring better against a proxy. See the bard lead below |
| 2026-09-06 | passing through bodies and lingering on one *add*; they do not multiply | **142 → 144 / 284** | **0.247 → 0.251** | 16/16 | `(1 + R·rep/(R+rep)) × segments` said a projectile lingers its whole remaining life on *every* segment at once — the same 63 ticks spent four times over. One slow bubble inside the Eater of Worlds came out at 20.6 hits where its pass through four segments plus its own repeats is 8.2, and Riveting Tadpole rode that to 1306 DPS at Pre-Evil on a stage-0 bard weapon. `segments + R·rep/(R+rep)` is identical at one body, so nothing about single-target scoring moves. ieor bard top-3 +1 |
| 2026-09-06 | a seeker holds its target only as far as it out-paces it | 144 / 283 | 0.250 | 16/16 | `window = alive` gave every homing projectile its whole remaining life on target regardless of whether it could keep up. Riveting Tadpole's bubble does 6 px/tick against a boss doing 5 and was credited a hit every ten ticks for a solid second; what it has left for holding station is the share of its own speed not already spent matching the target's, and a seeker four times the boss's speed still keeps three quarters of its life. **334 → 192/s**, which puts bard level with ranged at Pre-boss (192 against 202) where it had been 2–3× every other class. Neutral against the guides |
| 2026-09-06 | miner: a bard's projectile cap lives in `CanPlayInstrument`, and `ownedCapOf` takes the *governing* one | 144 / 283 | 0.250 | 16/16 | the same renamed-hook problem as `BardShoot`: `maxOutOf` only looked at `CanUseItem`. And the reader returned the *first* comparison it found, which for Marine Wine Glass is the right click's "is there at least one glass to shatter" (`>= 1`) rather than the left click's cap of six — both spell `bge`, so the opcode cannot tell a minimum from a maximum and the larger number is the cap. 196 weapons now carry a read cap. **Not yet worth anything**: see the lead below |
| 2026-09-06 | a stockpile of its own projectiles bounds the use rate, by the lifetime instead of a round trip | **142 → 145 / 284 → 283** | **0.247 → 0.252** | 16/16 | `CanUseItem` refuses to fire while `N` are alive, so `N` per lifetime is the ceiling whatever the animation allows. It sits in the same arm as the boomerang round trip it generalises, and is narrowed by three facts the record already carries rather than by a list of names: **`maxOut > 1`** (a cap of one is the “only one at a time” idiom a held beam and a boomerang use, and both are scored elsewhere), **not `useAmmo`** (the cap counts `Item.shoot`, but an ammo weapon's `v.primary` is the round's projectile — Firestorm Cannon went to zero on that mismatch), and **neither `returns` nor `bounces`** (a projectile that comes home or ricochets away frees its slot before its timer does, which is why Fishbone Boomerang went to 16/s against ~100 reported from play). What is left is two weapons and both are genuine stockpiles: Marine Wine Glass throws six glasses that last ten seconds and shatters them on the right click, **402 → 76/s**, and System Bane plants five mines lasting eight seconds each, 443 → 249. Positive on every guide — calamity +1/+1 with recall +2, ieor +1/+2 with recall +2, ieor bard top-3 +1 |
| 2026-09-06 | interpreter: a field the projectile *moves over its life* is not the constant `SetDefaults` gave it (`MUTATES`) | **142 → 145 / 284 → 287** | **0.247 → 0.257** | 16/16 | handing the spawn number back to an AI that branches on one makes the branch statically decidable, and the linear walk then takes a single arm for ever — whatever the other arm does is invisible. `timeLeft` is how it surfaced: Fungicide's split orb homes inside `if (timeLeft < 150)` and spawns at 180, so the guard folded and the `HomeInOnNPC(450f, 6.5f, 20f)` under it was never seen; **26 of the 107** Calamity projectiles that call the helper carried no homing at all, nearly every one a split or secondary shot that starts seeking partway through (AquashardSplit, ClamorRifleProjSplit, Blood2, Brimlash2, Prismalline3). The set was then picked by *measuring* which fields the AIs read back rather than by guessing: `alpha` and `Opacity` fade, `penetrate` drops on each pierce, `soundDelay` and the frame counters tick, `friendly` and `tileCollide` are switched mid-flight. **`width`, `height` and `scale` are deliberately excluded** — they are read six thousand times over for geometry (dust offsets, hitbox maths, blast radii) and an unknown there loses real arithmetic instead of freeing a branch. Stores are unaffected; this is only what a *load* hands back. Homing 641 → 701, with a **read** speed and inertia rather than the pessimistic knobs 105 → 136; projectiles with children 1,223 → 1,244, with debuffs 1,367 → 1,375, referenced 3,970 → 4,008. Best pre-hardmode agreement of the run; Calamity MRR 0.217 → 0.228 |
| 2026-09-06 | miner: a `velocity / N` is only a steering blend when it goes **back into the velocity** | 141 → 146 / 290 → 292 (calamity 101 → 106 / 205 → 207) | 0.210 → 0.216 | 122/142 | the complaint that opened this: the Acid Gun reads as homing and does not home in game. Its stream's whole AI is a dust trail — `for (i = 0; i < 3; i++) { var off = velocity / 3f * i; NewDust(position - off, …) }` — and the blend reader took the `/ 3f` for the `(velocity * (N-1) + toTarget * speed) / N` shape, inertia and all. The tell is where the result goes: the real blend is assigned to `Projectile.velocity`, the dust one is not, so the division is now *carried* (`VEL_BLEND`, the same deferral `VEL_MUL` already used for drag) and only becomes homing at the store. A second condition on the same shape: the numerator must be a velocity **something was added to** (`VEL_SUM`), which is what separates a blend from `velocity / MaxUpdates` on the first frame. **26 projectiles** stop homing and none start; 9 of the 11 spot-checked never reference an NPC anywhere in their AI, so they could not have homed under any reading, and the other two divide their velocity to place a child projectile or a dust. 20 weapons are affected — Night's Ray, Auralis, Brimstone Fury, Ichor Spear, Kingsbane, Vesuvius, Thorium's bard instruments — and every one of them is a straight-line shot. The gate move is the largest of the session: calamity top-3 **101 → 106**, top-8 205 → 207, recall@K 147 → 150, MRR up on both guides. Left alone: a bare `velocity / N` stored back into velocity *is* a decay, but reading it as drag charged Spadefish a permanent ×0.5 for a one-frame launch fixup the branch tracker did not mark conditional, so it stays unread |
| 2026-09-06 | miner: `projectile.shared` — an immunity window that belongs to the *type*, not to the projectile; a spread volley of them lands once | 141 / 289 (calamity 104 → 106 / 208 → 207) | 0.210 → 0.211 | 122/142 | the complaint that opened this: SOTS's Fizzle Star was the **#1 pre-boss magic weapon at 54/s** for a star that fizzles out at shotgun range. Its malfunction fires seven at 200% damage and the model paid all seven, because `usesLocalNPCImmunity` and `usesIDStaticNPCImmunity` were both being flattened into `local` — and the second one gives **one window to every projectile of the type at once**, so a volley of them is in the same position as a volley with no window at all: the first to arrive shuts it on the rest. 278 of 3,938 projectiles carry the flag. Gated on the group having a *spread*, which is what says the volley left the weapon in one instant: Blood Bath's three beams share a window too, but they are spawned 100 px apart above the player and rain down one after another, and collapsing those took a guide pick from 171 to 65/s for a window they never meet inside. Fizzle Star 54 → **23/s**, #1 → #9 of the pre-boss magic pool. Roughly a wash on the gate (calamity top-3 +2, recall@K +1, top-8 −1; ieor top-3 −1, top-8 −1, recall@K +1) — the mechanic is the argument, not the metric. Standing gap: the star also kills itself on a random check against its own age and wobbles its heading every five updates, so the model still flies it 667 px in a straight line on a `timeLeft` of 1200 it never reaches |
| 2026-09-06 | miner: `item.cooldown` / `item.altCooldown` — the buff a weapon refuses to be used through, read out of `CanUseItem`; and health spent is survival spent, not just a resource | 141 / 289 | 0.210 | 122/142 | the complaint that opened this: Sanguine Despair is not punished enough for what it does to the player. Two things were paying for it. **(a)** It was being graded on its *right click* — Surging Vampirism, 250% damage — at two casts a second, when the code says `CanUseItem` returns false while `HasBuff<SurgingVampirismCooldown>` inside the `altFunctionUse == 2` arm and `Shoot` puts that buff on for `1800` ticks. Both halves are plain IL, so the cooldown is mined rather than read out of the tooltip's prose: **40 right-click cooldowns and 11 plain use cooldowns** across the pack, agreeing exactly with the tooltip wherever the tooltip states one (12/12 s, 8/8, 4/4, 20/20) and finding many it never did. Only the code says *which click* waits, which is why the tooltip regex added first (`stats.altCooldown`, kept as the fallback) could not be trusted on its own. **(b)** The health pool priced how often the weapon can be fired and stopped there — but at that rate it is eating *all* of the player's regeneration, and that regeneration was what kept them alive. The share of the bar it drinks now counts as `exposure`, the same term that prices standing in the boss's hitbox, so the two do not add and whichever is worse governs. Sanguine Despair 40 → **22/s**, #4 → #12 of the 70 magic weapons at its stage; Corpus Avertor 289 → 222, Der Freischütz 29 → 25. Gate-neutral to three decimals — no guide ranks any of the five life-cost weapons or the Stars Above ultimates where it shows, so the mechanic is the whole argument. Known ceiling (`ponytail:`): the drain only counts where health is the pool that *governs*, so Blood Boiler takes 77% of the bar under a tighter mana cost and goes uncharged |
| 2026-09-06 | a beam held on the boss is charged the player immunity window **once**, and a piercing beam is not spent on one body of a crowd | 145 / 287 | 0.217 | 128/141 | the complaint that opened this: Last Prism is not scored like an infinite-pierce beam. Two things were charging the same fact twice. **(a)** A volley with no immunity of its own is collapsed to one arrival in `group` (`bunched`) — right for a shotgun, wrong for anything the player *holds*, because the contact path then prices that same window again as `60 / IMMUNITY` hits a second with `stacks` capping how many bodies it can be on. The Prism's six beams came out at **1 of 4.6 arriving** and were then rated at 6 hits a second on that one: **203 → 303/s** single-target, and only 3 weapons in the pack move (Vibrant Pistol ×1.56, Rifle Spear ×1.01), because it takes a *held* weapon throwing several windowless projectiles to hit the double charge. **(b)** `CROWD_WASTE` (×0.6, "spent on one body of the six") was charged to every contact weapon in `multi`, beams included. A piercing beam, field or lash lies **along** the crowd, and the mined record cannot tell it from a blade — Terragrim and the Prism's holdout are both `aiStyle 75`, infinite pierce, no immunity of their own — so the class decides: a held *melee* weapon is a drill or a blade in your hands, a held magic or ranged one is the beam it puts across the room (`sweepsCrowd`). 145 weapons move in `multi` only: Vilethorn, Nettle Burst, Crystal Vile Shard, Laser Machinegun, Charged Blaster Cannon, the rain clouds. Freeing the *melee* held weapons too was measured and cost vanilla melee 1 top-3 (Terragrim and Sawtooth Shark over Blade of Grass), which is the rule earning its class test. **(c)** The contact clock is applied to `stacks`, not to what the parts above multiply out to, and that step was never stated: **98 weapons' cards did not multiply out to their own score** (contact archetypes 128 → 30 of the 5,520 graded), Last Prism showing ×6 beams and ×6 hits/s for a number three times smaller. Gate: identical to three decimals, pre-hardmode. Not taken: giving a sweeping beam a clock **per body** (`stacks × segments`, the pierce the shot path already pays) — Vilethorn 16 → 96 in a crowd, and 17 regressions across ieor and vanilla magic for a claim the guides do not make |
| 2026-09-06 | a beam a held weapon **keeps up** hits on its own clock, not one hit between all of them | 145 / 287 | 0.217 | 128/141 | the complaint that opened this: Yharim's Crystal is post-Yharon and scored 667/s. Its prism maintains six beams, and Calamity gives each of them `usesLocalNPCImmunity` with `localNPCHitCooldown = 10` — six independent clocks, 36 hits a second. `childHits` was reading them under the unread-cadence rule ("worth at most one extra hit, never `count`": `reachShare / n`, hits capped at 2), which paid the six of them **0.9 hits a use between them**. A timer child with a cooldown of its own, spawned by a parent the player *holds*, is not a spray: it is a beam standing in the boss, and `useTicks / local` hits per use is the same arithmetic the contact path already does for the parent. The rule is narrowed by the child having **no `life`** — that is what separates a maintained beam from a flamethrower's fire (life 150), a spray (90) or a star (240), and without it 50 weapons moved, several by 5× on already-inflated endgame numbers. With it, **9**: Yharim's Crystal 667 → **1312/s**, Dark Spark 289 → 617 (seven beams at 15 ticks), Unrelenting Torment 666 → 1096, Amphibian's Guitar 360 → 477, and five that go *down* a few per cent where the read clock is slower than the two-hit ceiling it replaces (Devil's Sunrise, Ark of the Cosmos, Crescent Moon). Gate: unmoved to three decimals, pre-hardmode **and** over every tier — the weapons it touches are all endgame and none of them crossed a top-K boundary. Standing gap on the same weapon: the beam's AI sets `damage = parent.damage × GetDamageMultiplier(charge)` and that helper is `Lerp(1, 3, x³)` over 180 ticks, so a channelled Prism sits at **×3** for most of a fight and the model pays ×1. Reading a ramp needs the interpreter to fold `MathHelper.Lerp` with an unknown `t` into a bound, and only where a damage store consumes it |
| 2026-09-06 | miner: `projectile.ramp` — a projectile that scales its **own** damage while it is out, and a beam aimed with the weapon that keeps it up | 145 / 287 | 0.217 | 128/141 | the same complaint, finished: Yharim's Crystal is the post-Yharon magic weapon and the lab had it #26 of 211. Three facts were missing and all three are in the code. **(a)** `YharimsCrystalBeam.AI` sets `damage = <the prism's damage> × GetDamageMultiplier(charge)`, and that helper is `MathHelper.Lerp(1f, 3f, x³)` over 180 ticks — the interpreter lost the whole term twice over, once because `damage` read off *another* projectile (`Main.projectile[ai[1]]`, the parent) had no marker, and once because `Lerp` with a blend nobody can fold returned unknown. Both now read: a foreign `damage` field is the same weapon's damage in the model's unit, and a `Lerp` between two numbers is the middle of them, exactly as the `Clamp` hook beside it already assumed. **13 projectiles** in the pack carry a ramp (Yharim ×2, Murasama ×2, Dark Spark ×1.23, Pristine ×7.2); the record states it and the *model* decides who gets it — only a beam a weapon keeps up, where holding the button is what reaches the top of the ramp. **(b)** That beam is pointed where the weapon is pointed, so what it lands is what the parent lands, not a stray shot flown to the boss at the spray default of 8 px/tick. Collateral of the two miner reads, measured against the old dataset with the old model: **5 weapons** (Buzzkill's saw is spawned at ×3 the parent's damage, three homing helpers now have their lerped inertia read). Yharim's Crystal **667 → 2916/s**, #26 → **#10** of 211 endgame magic and #10 → #4 among the tier's own guide picks; Dark Spark 289 → 823. Gate: no regression pre-hardmode or over every tier, calamity MRR 0.228 → 0.229. **Why it is still not #1**, both measured and both bigger than this pass: the mana floor (`SUSTAIN_FLOOR` 0.35) flattens every weapon over ~50 mana/s to the same number, so Helium Flash at **423 mana/s** is priced as sustainable as this at 90; and eight homing stars a cast with infinite pierce accumulate ~70 hits/s under `RECONNECT_SEEK`, which is what puts Event Horizon (a stage-78 weapon the guide does not list here) above every pick in the tier |
| 2026-09-06 | one stat, two conditions, two prices: the *line's* own gate decides what its share of a stat is worth | 145 / 287 | 0.217 | 128/141 | the complaint that opened this: the Galeflame Feather gives 5% increased damage in the air and another 18% for the immunity frames in the air, and the item carried one `allDamage: 0.23` at full weight — 23 points, an unconditional damage accessory. Three things were wrong and all three are the same thing. **(a)** Neither line read as conditional at all: a stance (`in the air`, `airborne`, `immunity frames`, `invincible`) is a condition carrying none of the words `CONDITIONAL_STRONG` looks for. **(b)** A conditional line that names no class was dropped whole — `classMechanic` needs a class word and `condValues` needs "your damage" or an "up to" ceiling — so "Gain 5% increased damage in the air" was worth zero where an *undetected* one was worth full. It now credits every class (`fallback = 'all'`), but only where the line reads as a bonus to a stat you carry (`GRANTS_STAT`): "arrows behind you for 50% damage" is the arrow's damage, not yours. **(c)** The discount was per *key*, and `flatKeys` dropped a key from `conditional` the moment any line gave it flatly, so an item mixing an always-on arm with a gated one paid the gated one in full. The tier is now decided per line and carried in the key: `Cond` for a stance you steer (`COND`, ½), `State` for one that needs a hit taken, a liquid or a world event (`STATE_GATE` → `COND_STATE`, ⅙), scored as parts of their own with their own label and explanation, so one item can hold both. Galeflame 23 → **5.2** (2.5 + 2.7). **5 items** land in the new tier — Hide of Astrum Deus, Blighted Badge, Manifestation ("when damaged", "while invincible"), Sea Breeze Pendant ("when you're wet"), Galeflame — and **21** now carry a classless part-time damage bonus that was worth nothing before (Frost Flare, Gladiator's Locket, The Sandwich, Necklace of Vexation). Gate: unmoved to three decimals, pre-hardmode and over every tier — the guides rank weapons, so the mechanic is the whole argument. Known ceiling (`ponytail:`): `STATE_GATE` is a word list, not a model of the condition, and each tier is one number for every gate in it |
| 2026-09-06 | a beam is *instant*, mana is a bar with potions in it, and infinite pierce is worth a crowd | 140 / 289 | 0.211 | 128/141 | four complaints about one weapon, all of them about the model rather than the miner. **(a) A held non-melee delivery does not fly.** `ATTACHED` already said a beam is an extension of the player and the set did not contain one, so every prism and holdout paid a travel lead — Yharim's Crystal ×0.8 for "30 px/tick over 180 px" — on top of the archetype `uptime` that already prices keeping a moving boss inside something you aim. Melee's held weapons are deliberately left flying and it is a compensating error, not a belief: `REACH.held` walks a drill to 180 px, the lead is what pays for that, and freeing both together costs vanilla melee 3 top-3. **(b) A still spawn is not half a delivery.** `Vector2.Zero` was read as an attached melee image at ×0.5 for everything; a beam or a wall put where the cursor is loses the moment it takes to come out, not half its landing, and how much better than that floor is now read off the record — `held`, `ridesOwner` or a mined `homing` turn rate all mean the thing follows the target rather than sitting where it was put. **(c) Mana is a bar, a regeneration and a potion.** The old floor said any weapon over ~50 mana/s was equally sustainable, which is where the comparison lives: Helium Flash at **423 mana/s** was priced exactly as keepable as Yharim's at 90. Now the bar (`manaCap`), the regeneration and what potions add (`potionMana`, a knob of the same shape as `manaRegen`) are three incomes, and the price of the third is the real one — Mana Sickness, −25 % magic damage decaying over five seconds, charged in proportion to how much of the income comes out of a bottle. Yharim's 0.35 → **0.61**, Helium Flash 0.35 → **0.13**. **(d) Infinite pierce is worth a crowd.** A maintained beam is in every body it is laid through and each carries its own copy of the beam's immunity clock, so `hits` counts bodies now — Yharim's Crystal multi **1312 → 29,605/s**, #2 of 200 endgame magic where it read the same against a Destroyer as against one target. The weapon overall is **667 → 5473/s** single (#26 → #8) across the two sessions, 8.2× where the complaint was that it is the strongest magic weapon in the game. Card wording, also asked for: a bare "385% damage" now says *Dynamite is spawned at 250 damage where the weapon prints 65*, and the lines this pass touched drop their chained clauses. **Gate, and it is not free**: pre-hardmode ieor magic −5 top-3 and vanilla magic +1 / +2 top-8, everything else inside a point; over every tier calamity recall −4 with top-3 and top-8 unmoved, ieor −3 / −4 with recall +2, vanilla +3 top-8. All of it is (c): the mana floor was holding up weapons whose *only* limiter was mana, and the guides' pre-hardmode magic picks are the mana-efficient ones. Waived deliberately — the basis is the thing that was wrong. Standing blocker on the original question: Event Horizon (8 homing stars a cast, infinite pierce, 25-tick clocks, ~70 hits/s under `RECONNECT_SEEK`) is #1 magic in both target modes and is a stage-78 weapon no guide lists there |
| 2026-09-06 | miner: the description a mod hides behind a key press, and a `{$ref}` written relative to where it sits | 145 / 287 | 0.217 | 128/141 | the complaint that opened this: the Auric Tesla armour's set bonus is not parsed, because reading it in game takes holding Shift. Two failures, and the second was far larger than the item that surfaced it. **(a)** What Shift shows is `SetBonus1`, `SetBonus2`, `SetBonus3` sitting beside the item's `SetBonus` key — all three in effect at once, it is only the *reading* that cycles — and the same shape holds a plain item's own description (SOTS's Dream Lamp keeps a form per `Tooltip1` / `Tooltip2`), so `loc.item()` returns both as `setBonusMore` / `tooltipMore` and the "Hold Shift to view these" line they point at is dropped. The arms are formatted **apart** from the line the item prints: the format arguments its code passes belong to *that* line, and letting them fill Silva's `{1}% increased max run speed` with the Auric helmet's 55% summon damage invents a number. Their magnitudes stay `{0}`, and only what an arm *does* is read from it (`armsOf`) — a revive, a dash, a debuff immunity — because reading stats off placeholder fallbacks invents numbers a second way, and one unfilled `{0}` setting the item's `placeholders` flag would halve every stat its own line states exactly. That last one is worth stating plainly: adding *text the miner cannot fill in* was costing the Auric Tesla set its #1 magic rank until the arms were split off. **(b)** `{$GodSlayerHeadMelee.SetBonusEffect}` is written relative to where it sits and `resolveRefs` only tried the key as given and `Mods.<mod>.<key>` — so **every Calamity post-Moon-Lord set bonus read "Set Bonus Effect"**. Keys are now also indexed by their dotted suffixes (two segments minimum, a suffix two keys share dropped rather than guessed — across the installed pack there are none), references resolve recursively to depth 4 (the chestplate's `CommonSetBonus`, which is where Silva's revive and God Slayer's Dimensional Drive actually live), and an add-on mod's reference into the mod it extends resolves against every loaded localization. **39 armour heads** gained their real set bonus text, **3 weapons** their real display name (all three were called "Display Name"), and **11 items a revive** — Silva, Auric Tesla magic/summon, Nebulous Core, Phylactery — priced at `W.revive = 7`: above a dodge (5), and 8 is where the guides start disagreeing (`accTop6` 135 → 131). Fixed beside it: the spawn-naming pass walked `setEffects.spawns` but not `setEffects.onHit`, so a set bonus's proc read "spawns **undefined** on every attack" and was graded without its pierce, life or hit cooldown. Gate: no metric moves in any guide. **Read the gate with `node --predictable`** — this pass is also where it came out that two runs on a byte-identical dataset disagree on ~12 sections and 3–4 metrics, always in near-tied ranks; `--predictable` pins V8's optimizing tiers and the runs become identical, so the ordinary noise floor of an unflagged run is about ±3 metrics and every "regression" under that is unreadable. **The arms' `{0}`s are filled too**, which is what makes the card readable: an arm quotes another item by key, its placeholders are *that* item's arguments, and the quoting item was passing its own — '+{0} HP/s life regen' came out as the Auric helmet's 4 minion slots. A reference to an item this pack has is now replaced by the set bonus that item already resolved for itself (`setTextByClass`, built before the item loop), so Silva's line reads '+3 HP/s life regen … revive … 5 minute cooldown' exactly as the game shows it; a line the quoter already states is dropped with its magnitude blanked out, since the Auric summoner's 4 minion slots are the ones the wearer gets, not the 2, 2 and 3 of the sets it quotes. Two more found by doing it: a `{$Key@N}` reference shifts **every** index by N and not only `{0}` — shifting one collided the God Slayer dash's keybind with its cooldown ('Press  to … has a  second cooldown', now 45 s) and gave Tarragon's rogue set a 2.5 s cooldown where the code says 25 — and `cleanText` now closes the hole an unread argument leaves rather than printing the gap. Their stats are still *not* read (`armsOf` stays abilities-only): tried, and it marks the Auric summoner's flat 55% summon damage as state-gated, because an arm's own `conditional` list was computed where no flat damage line existed. Standing gap: Wulfrum Hat's "Hold Shift to see the stats of the fusion cannon" is built in code from another item's tooltip, which nothing here follows |
| 2026-09-06 | a prism reaches as far as its beams, a crowd has to be crossed to be worth anything, and a search for a target is not evidence there is none | 140 / 289 | 0.211 | 128/141 | **(a) Reach.** A weapon whose damage is in the beams it *keeps up* was being walked to `REACH.held` — 180 px, which is how far a wall of thorns extends — and then charged the risk band for standing there. The holdout in your hands is not what has to reach the boss, so a prism (`keepsBeams`) stands where its class wants to stand and pays nothing for it. Yharim's Crystal 5473 → **6331/s**, Dark Spark 823 → 2753. **(b) The "Held Beam" node that contributed `nothing`.** `contactPhase` is the *clock* of the delivery above it, and pushing it as a phase of its own drew a second node for the same beam whose hits are counted on the delivery that spawned them. It lands on that delivery now, which is also the truer kind for it — a beam is held on the boss, it does not travel to it. **(c) A crowd has to be crossed.** `hitsPerProjectile` added `segments` to every projectile with pierce, whatever it was doing. Two facts say a projectile is not in six bodies: it **steers** — a seeker turns onto a target and stays with it, so what it can be in at once is its own hitbox against a body's (a 108 px Apotheosis worm spans two of a crowd, a 40 px Event Horizon star does not) — or it is **gone**, its life on arrival over what one body costs it to cross, which is what a holdout expiring at the cursor has none of. Event Horizon multi **33,138 → 23,518**, Devil's Claw multi 18,080 → 13,586, both named as ranked too high in a crowd, both for exactly these reasons. **(d) miner: a target search that finds nothing is not a fact.** `ClosestNPCAt` and its kin inline, walk a loop over `Main.npc` the machine cannot run, and hand back the `null` they were initialised with — so `if (target != null)` folds to *false* and everything under it is marked dead code. **25 Calamity projectiles** gain the children they fire at what they found, Apotheosis's worm and Eternity's book among them; Eternity 92 → **441/s** for a weapon that was reading as a book that does nothing. 78 of 2246 records move, 47 of them a homing inertia now read. Gate over every tier: calamity top-3 +1 / top-8 −2 with **MRR 0.229 → 0.236**, ieor −1 top-8, vanilla unmoved. Yharim's Crystal ends the pass **#2 of 200 endgame magic in a crowd** (41,020/s, behind only Infernum's `kevin` at 406k, which is its own bug) and #12 single. Standing: Apotheosis wants *more* repeat hits on one body and Event Horizon *fewer*, and both are the same `RECONNECT_SEEK` saturation — the knob cannot separate them, only a fact about whether a seeker passes through its target or sits on it can |
| 2026-09-06 | a set bonus is worth what its *code* does: the buff it grants, the flag that buff sets, and the window where nothing can hurt you | 145 / 287 | 0.217 | 128/141 | the complaint that opened this: at post-Nameless-Deity the melee answer was three loose pieces — Intergelactic Hardhat, Demonshade Breastplate, Tide Turner's legs, **no set bonus at all** — beating every real set, because raw stats were the only thing on the table. Three things were missing and all of them are in the code. **(a)** The effect chain was read one link deep. Calamity's Bloodflare melee set is three: `bloodflareMelee` grants `BloodflareBloodFrenzy`, the buff sets `bloodflareFrenzy`, and only that last flag carries the 25% melee damage and crit — so the set bonus was a flag name and nothing else. The fold now runs to a fixed point (`expand`, ≤3 rounds, a `done` set per item) over flags → granted buffs → the flags those buffs set, **and over `setEffects`, not just `effects`** — a set bonus being exactly where a mod keeps the effects worth having. Anything reached *through* a buff is marked conditional by construction (you have it while the buff is up, and the buff comes off a hit, a kill or a cooldown), so it lands at `COND_STATE`: the frenzy's real uptime is 5 s in 30, and ⅙ is that. **41 items** gained mined effects, **36** a new link — Reaver Rage, Empyrean Wrath, Victide's sea snail, Tarragon, Bloodflare. **(b)** Two hook families were never walked: `\w*Hurt\w*`, which is where a defensive set puts its buff on you (`tarraMelee` grants TarraLifeRegen in `OnHurt` and nothing else in the player code mentions the flag), and `\w*LifeRegen\w*`, where the flag it sets is finally read (`CalamityPlayer.GeneralLifeRegen`). Calamity's flags with effects 133 → 148. **(c)** A **window of invulnerability** was worth nothing: "invulnerable to all damage for 5 seconds" after a Silva revive, Tide Turner's impervious bubble, the God Slayer dash you spend immune. `W.invuln = 8` — above a dodge (5, one hit whenever it happens), under a revive (a whole bar) — on **15 items**; and `W.revive` 7 → **15**, a second health bar (`W.maxLife × 500 ≈ 25`) discounted for coming once, because that once is the moment the fight would otherwise have ended. Post-Nameless-Deity melee is now **Auric Tesla 224.0** over the loose three at 223.6, with the set bonus reading 41.1: the frenzy's 25%/25 at ⅙, Tarra's life regen at ⅙, the god killer darts, the dash, the debuff immunity and the immune window. Gate: **one regression**, `calamity pre-scal melee top-8 2 → 1` — a second-order slide, one weapon from #8 to #9, because the melee loadout at that stage now carries the frenzy's damage and crit and every weapon is graded against the loadout it is worn with. Standing gap the same complaint still names: the leaf storm on every fifth magic crit and Silva's nature blasts are fired from `CalamityGlobalItem::Shoot` under a player flag, and `extractFlagEffects` only walks `ModPlayer` — a `GlobalItem` pass gated on the same flags is what reads them |
| 2026-09-06 | `tools/outliers.mjs` — the weapons that do not age, per class, with the guides' opinion beside them | 140 / 289 | 0.211 | 128/141 | a scoreboard says which weapon is best at a stage; it does not say which weapon has been best for *twenty* stages while the player kept finding worse ones. Every weapon graded at every stage it is available for (no loadout, no prefix, `auto` target — the same weapon-only arithmetic `dps-snapshot` freezes), a **reign** is a run of consecutive stages it holds its class's #1, and only the part of a reign where a *newer* weapon exists counts. **55 reigns of five stages or more**, and the column that makes the list actionable is the last one: whether any guide names the weapon at all. Perfect Star holds magic for **23 stages** from Pre-boss, Dragalia Found holds summon for 29, Baby Cannonball Jellyfish holds the classless pool for 31, Revolution holds void for 44 — and **36 of the 55 are named by no guide anywhere**, which is where to look first. Written to `docs/class-outliers.md`; re-run after any scoring or mining change. Three weapons checked by hand off the back of it: `kevin` is not a bug (23,000 listed damage on a 6-tick clock — Infernum's joke weapon, scored faithfully at 406k/s); **Devil's Claw is not a mis-read** (ThoriumRework triples it inside `if (HasMod("CalamityMod") && CompatConfig.postDoGRag)`, and that config carries `[DefaultValue(true)]`, so 675 is its damage in this pack — what it then gets is the player-immunity ceiling every windowless weapon gets, 6 full hits a second); and **Staff of Blushie** is a third shape of AI-written damage, `damage = (int)(ai[0] - 120)` — the damage *is* how long you have held it, so its printed 1 is a placeholder and its `ModifyHitNPC` zeroes the boss's defense on top. Neither the ramp read nor anything else in the model reads an *absolute* damage written from a counter, so it scores 11/s |
| 2026-09-06 | on-hit procs: a mod's own per-class hit helper is a hit hook | 145 / 287 | 0.217 | 128/141 | the rest of the same complaint — the Auric Tesla sets visibly throw more than the model reads. `extractOnHitSpawns` was anchored on tML's names (`OnHitNPC`, `ModifyHitNPC`, `OnKill`, `Shoot`), and Calamity does not put its set-bonus procs there: it splits hit handling into `MeleeOnHit` / `MagicOnHit` / `RogueOnHit` / `SummonOnHit` and calls those from the real hook, so every proc written in a class's own arm was invisible. `HIT_HOOKS` now takes `\w*OnHit\w*` — the same family `flageffects.js` already had to accept for the identical reason — and the flag-gated `NewProjectile` walker sees them. **26 items gained a proc**: Silva's nature burst (`SilvaBurst`, its 300-tick cooldown read with it), Tarragon's homing life energy (`TarraEnergy`, 60), Empyrean Mask ×2, the Hydrothermic sets, and accessories that never had one (Ursa Sergeant, Alchemical Decanter, Corrosive Spine). Auric Tesla's ranged head now reads all three of the sets it inherits — Tarra Energy, Blood Bomb, God Slayer Shrapnel — and the magic head both of its own. Calamity's flags with effects 148 → 164 across the two passes. Gate: **one regression**, `calamity pre-moonlord summon top-8 3 → 2`, against `post-mech1 magic` gaining one — second-order, both of them: the loadout the weapons are graded against changed. Not mined, and it is not a projectile: Tarragon's "leaf storm on every 5th critical strike" re-fires *the weapon's own shot* (the `type` parameter of `Shoot`, not a `ProjectileType<T>`), so it is 20% more shots rather than a proc, and belongs with the duplication share the rogue sets already model |
| 2026-09-06 | miner: a `counter % N` gate **is** the cadence, and a counter can live behind a `ref` property | 140 / 289 | 0.211 | 128/141 | the complaint that opened this: SHPC should be the mage's crowd weapon at post-Destroyer and read 666/s in a crowd, *below* its own single-target number. Its right click drops a vortex that fires a laser every five ticks, and two things hid that. `counterGuard` reads the `Timer % 5f == 0f` shape already, but `reset` — the flag `childHits` requires before it will believe a cadence — was only ever set by finding a *store of zero* to the counter, and a modulo has none: the periodicity is the operator. And the counter itself is `public ref float Timer => ref Projectile.ai[0]`, so the load is `call get_Timer; ldind.r4` rather than a field, which `counterAt` did not recognise at all. **77 child spawns across the pack gain a read cadence** and come out from under `CHILD_CAP` — the flat ceiling whose own comment has been asking for this since it was written. SHPC **666 → 5366/s in a crowd** and #1 magic of 212 at its stage in both target modes, which is what the complaint said it should be; Neptune's Bounty ×6.8, Dragon Pow ×6.3, Syzygy ×5.0, 25 weapons move more than a quarter. Also: a projectile that **parks itself** is a field over ground, not a throw spent on whichever body it met, so `still` now earns `sweepsCrowd` on its own — a vortex sitting on a crowd was paying `CROWD_WASTE`. Gate: pre-hardmode unmoved but for ieor ranged −1 top-8; over every tier calamity top-8 −4 with top-3 unmoved and MRR 0.236 → 0.234, the cost of fields that now fire twelve times a use outranking picks the guides make for other reasons. Deliberate — an unread spawn rate is a placeholder, not a balance decision. Two diagnoses that need no code: **kevin** is a 23,000-damage joke weapon scored faithfully, and **Staff of Blushie** cannot be scored at all until an AI-written *absolute* damage can be read — `damage = (int)(ai[0] - 120)` means its damage **is** how long you have held it, so its printed 1 is a placeholder, its `ModifyHitNPC` zeroes the boss's defense, and 400 mana/s against a 25/s income is the one number on its card that is right |
| 2026-09-07 | the Wishing Star: a proc written in a helper, a description another mod owns, and a projectile's damage read as the player's | 145 / 287 | 0.217 | 128/141 | the complaint that opened this: SOTS's Wishing Star is a pre-boss magic accessory that fires a free star for a whole attack's damage, and the lab did not rank it anywhere. Four things, and three of them are general. **(a)** Its own localization reads `Temp1` / `Temp2` — the mod never wrote the text — and the real description comes from InfernalEclipseAPI's `ModifyTooltips`. That edit was a **substitution**, and the needle it looks for is a line *it* wrote in an earlier version, so it matched nothing and the whole text was dropped. A substitution whose needle matches nothing now keeps its text and takes out the line it restates instead (same statement, different number: compared with the magnitudes blanked out). 10 items' descriptions come back, including everything a balance mod rewrites — Reaper Tooth Necklace's crit, Sand Shark Tooth Necklace's, Alchemist's Charm's potion line. Placeholder lines (`Temp1`, `TODO`) are dropped from any tooltip. **(b)** The star is fired from `SOTSItem.CanUseItem`, and `extractOnHitSpawns` walked only `Shoot` for a `GlobalItem` — `CanUseItem` / `UseItem` are the same thing, a projectile on every attack, and are now walked. **(c)** It is not fired inline: the hook calls `SOTSPlayer.CastWishingStar`, and the walk is linear (`maxDepth: 0`), so the projectile was inside a call nobody opened. A callee that spawns is now read **lexically** — the `ProjectileType<T>`s it names, only if it calls `NewProjectile` at all — and credited to the flag region the call sits in, with the damage taken from the *call site*: `CastWishingStar(…, item.damage, …)` hands it the sentinel, which is what says the star hits for a whole attack rather than a flat proc. The `Item` parameter of a shoot hook carries that sentinel now, and `CountsAsClass(DamageClass.Magic)` — the by-value form beside the generic one — tags the class, so a magic-only proc is not credited to melee. **(d)** And the text, once it arrived, was read wrong in the other direction: "a star that deals 100% damage" became `magicCondDamage: 0.3` and made the accessory the best magic pick in the game at 17 points. A bare percentage in front of "damage" now only counts as a stat where the line words it as an increase, a ceiling (`up to`) or *your* damage — **77 items** move, every loss checked and every one of them a projectile's share read as the player's (Brass Whip's spiky balls, Cursed Blade's sword strikes, Plasma Shrimp's 25% plasma, which keeps its value through the proc the miner reads instead). Wishing Star: unranked → **#10 of 313** pre-boss magic accessories at 7.5, half of the 15 a proc may reach because the conditions the miner cannot read (its void cost, its alternate form) are real. Gate: 5 regressions, 25 sections moving ±1 in both directions — all second-order, the accessory pool the loadouts are built from having changed under them |
| 2026-09-07 | a charge counter is a **choice**, not an unread if/else: `charge` and `spam` graded as two loops, and a projectile the game never lets damage anything scores nothing | 145 → 145 / 287 → 288 | 0.217 → 0.218 | 128/141 | the complaint that opened it: Perfect Star is the best magic weapon at post-Crabulon *at its spam attack*, and the tree only showed the charged one. Three findings, in the order they were found. (a) `childHits` never resolved branch arms at all — 15 groups in the pool have a spawn on both sides of one if/else and **both were paid**; Perfect Star released its uncharged laser *and* its charged one, 100 of the 171 DPS it scored. `spentArms` resolves them, taking the weaker arm by `count × share` where nobody read the condition. (b) Two of those 15 are charge counters (`PerfectStar.chargeLevel`, `CoralSpoutHoldout.FullChargeProgress`), and how full a charge counter is, is how long the button was held — so the arms are two attacks on two clocks and the weapon is worth its better one, exactly as the two mouse buttons already are. `branch.charge` (miner, a name match on the condition) and a `charge` grade beside `spam` in the graph. (c) Perfect Star's star is `friendly = false` in `SetDefaults` and nothing ever arms it — it is a hidden charge marker (`hide`, `alpha = 255`) — and the model was paying it six contact hits a second, 70 of its 171. 126 projectiles are never friendly and 40 weapons fire one directly. **The cost is `ieor|melee` −3 top-3, −5 top-8**: SOTS's Void crushers are a `CrusherProjectile` arm that genuinely cannot hit and a `*Crush` child that can, and the child's spawn cadence is unread, so Eclipse reads 0.4 crushes per use and falls 793 → 91/s. That is the phantom arm's 8× coming off and the real gap (the slam cadence) showing through — it is now 66 more rows under *child spawns on a clock nobody read*, where it can be fixed, rather than hidden under a hit the game does not allow. |
| 2026-09-07 | miner: `spent` — a projectile that switches its own `friendly` off in `OnHitNPC` lands exactly one hit | 145 / 288 | 0.218 | 128/141 | raised against Perfect Star reading too low, and it was the pierce model believing a projectile that no longer exists. SOTS's Star Laser is `penetrate = -1` with a 10-tick immunity window of its own and `timeLeft = 1200`, so `hitsPerProjectile` gave it `1 + 180/10 = 19` hits and the death-child path gave it 6.4 — but `OnHitNPC` calls `TriggerStop()`: velocity to zero, `tileCollide` off, **`friendly` off**. It hits once and is a dead sprite after that. 55 projectiles in the pool do this. The `velocity *= 0` in the same helper was already being read, as `bounces` — the opposite fact. |
| 2026-09-07 | charge weapons read their own numbers: `projectile.charge`, and mana stops being a rate cap | **145 → 153 / 288 → 293** | **0.218 → 0.221** | 128/141 | two complaints, one cause. (a) *"the crushers work in game, they just take a while to charge and then do more damage the longer they charge"* — and they say so themselves: SOTS's fourteen Void crushers put the whole mechanism in `CrusherProjectile`'s `SetDefaults` as fields of their own type, which the walk was discarding because the receiver was not `Terraria.Projectile`. Eclipse is `chargeTime = 180`, `releaseTime = 150`, `minDamage = 0.3` → `maxDamage = 7`, `minExplosions = 3` → `maxExplosions = 5`: three seconds for five crushes at seven times its printed damage. The model had one unread-cadence spray at 1× and 0.4 crushes a use, and scored it 91/s; it now grades hold against tap on the weapon's own clock and reads 1025. 13 projectiles carry a `charge` record, and `WINDUP_TICKS` is not consulted for any of them. (b) *"why does mana sustain cap any attack speed? with potions that does not matter AT ALL"* — right, and the structure already agreed: `poolSustain` is self-balancing, `drinks` comes out as the share of potion income a weapon needs, and the cost lands as Mana Sickness. The number was wrong. `potionMana` was `2.5 + 1.6·prog` — 6.8 mana/s at Crabulon, one Lesser every seven seconds — so a mage spending 90/s came out at ×0.21, the model saying they stop attacking four casts in five. The income is now the best potion the run has got to (Lesser 50 → Mana 100 → Greater 150 → Super 200, gated on the ingredient that opens each), drunk every two seconds — so at Crabulon it is an ordinary 100-mana Mana Potion and not a curve's guess. **ieor|melee top-3 +5 / top-8 +4** — the crusher regression from the previous pass is repaid with interest — ieor top-3 +6, calamity top-3 +2, vanilla top-3 +1. Costs `ieor|magic` recall@K 24 → 20 and `vanilla|magic` MRR 0.268 → 0.256, both the mana retune lifting cheap-cost spells the guides do not name. |
