# Guide and Real DPS implementation progress

Updated 2026-09-05 (session 4). Resumable handoff.

**Read [The point, stated plainly](#the-point-stated-plainly) and [State of the rework](#state-of-the-rework-what-is-built-what-is-missing-what-not-to-retry) first.** The rest of this document is context and history; those two sections are what the work is.

Session 1 planned the work and imported the guides. Session 2 finished the guide/evaluator track — parsers, scopes, section metrics, the late-weapons report, the balance context — and froze a baseline. Session 3 built the phase *description* layer at exact parity, extracted `chance`, fixed four scoring bugs found along the way, and established by measurement what the remaining work is and what is not worth attempting.

Tooling a new agent inherits: `tools/dps-snapshot.mjs` (per-weapon parity net, dataset-fingerprinted), `tools/unresolved-phases.mjs` (what the model is guessing, ranked by the DPS depending on it), `tools/guide-check.mjs --json/--vs` (guide metrics with before/after deltas).

## The point, stated plainly

**Stop requiring one archetype tag to explain a weapon's entire lifecycle.**

That is the whole of it. Today `item.arch` is a single label that has to account for everything a weapon does from the moment the button goes down, and every weapon of that label gets the same flat formula. A weapon is really a progression:

```
charge → throw → hit counter → release burst → lingering field → cooldown
```

Each stage has its **own duration, probability, damage and targeting**, and the score is what falls out of composing them. Two weapons carrying the same tag can have nothing in common: the Luminant Tether and the Suspended Shotgun Shell Launcher are both `shot`.

Concurrent attacks compose the same way. A sword that swings *and* fires a projectile is two phases running together, and the split between them must **emerge from their own rates, damage and reach** — never from a hardcoded share. A projectile that spawns something further gets scored again by the same rules, including how well it matches the target's actual position and range.

This is not a guide-agreement exercise. Guide agreement is the check, not the goal; a change that improves the aggregate without a mechanical story is not wanted, and a change with a mechanical story that leaves the aggregate flat is.

## State of the rework: what is built, what is missing, what not to retry

**Built — the description layer.** `src/lib/phases.js` holds the vocabulary (`PHASE_KINDS`, `RELATIONS`, `TRIGGERS`, `CONFIDENCE`) and the builders: `primaryPhase`, `swingPhase`, `returnPhase`, `deliveryPhases`, `spawnPhases`, `contactPhase`, `summonPhase`, `debuffPhases`. `gradeWeapon` returns the graph as `phases`, and each damaging phase carries a `contribution` in the same units as the score. Coverage is pinned by a test: no archetype may be left with nothing describing it (24 of 2,679 weapons undescribed, down from ~296). Contributions reconcile with the score for **88%** of weapons.

**Built in session 4 — the first of the compiler.** The four rows below were the acceptance list; each is now a mechanic in `dps.js`, evidence-gated, with a regression test in `test/dps.test.js`:

| what was missing | what it fixes | result |
| --- | --- | --- |
| per-phase `duration` / `interval` / `maxActive` | a phase that ticks on its own clock, capped by what may be out | **Luminant Tether** 10,681 → **155** single / **236** crowd (1 link × 1 tick/s; 1.8 links in a crowd — below 3 only because the 6 px/tick pessimistic launch lands 29%). Uncapped, the form reduces exactly to the old `1 + stuck/imm`, so it is parity-neutral where nothing was read. |
| `threshold` on a trigger | a proc paid once per N landed hits | **Suspended Shotgun Shell Launcher** 163 → **83**; the burst is `/8` and `CHILD_CAP` no longer bites, which is what was hiding it. Also Galaxy Smasher, Pwnagehammer, Salivation, Head Spinner. |
| per-phase landing for the blade | the swing pays lead and reach like every projectile | **Star Wrath** blade 33% → 13% of single; **Meowmere** 61% → 33%. Through `bladeLanding` — the same `landing()` every shot uses, with the blade's reach stated. 379 swings and 2 shortswords moved, median ×0.38, none to zero; melee was the only class that moved against the guides, and it moved up (top-3 +2/+3/+2). |
| cascade phases in the graph | a projectile → blast → field shows as three phases | `childHits` returns its records; each carries `hitsPerUse` in the same unit as the cap, and the cap scales them together. 1,268 grades carry cascade phases; contributions still sum to the score (98.5% of grades within 2%). |

**Where the gates come from.** Nothing in the miner reads an AI timer or a hit counter, so the tooltip is the fallback: `textGates` in `phases.js` reads *interval*, *maxActive* and *threshold* from numeric clauses, `confidence: 'text'`, and `dps.js` applies each only where the projectile's shape says it belongs — interval and link cap to a projectile that **sticks**, threshold to the primary's on-hit/on-death children. Surveyed before wiring: it fires on 6 weapons out of 2,679, all of them the right ones ("up to N enemies" on a chain and "every fourth shot" on a gun are deliberately *not* read). `tools/unresolved-phases.mjs` lists them under "gate read from the tooltip, not the code" so they stay a worklist for the miner.

**Session 5 closed most of that list** (see its entry below): `cooldown` is a text gate, a maintained phase is cast at the rate that keeps its links up, the immunity window caps per group, and a sword that fires is graded in both stances. **Still missing:** `requires` (Violin's accessory procs — the solver's `onHit` accessory spawns are the same shape and belong in the same graph), "in a row" as run-completion, the loadout row's phase chips, and a Void regen number the miner read rather than a knob.

**Measured dead ends — do not retry without new information.**

- *Deriving the blanket archetype uptimes.* Three attempts, each reverted: accumulate-to-cap (Goozmaga 129,868 → 343,209), gate on a mined cap (fires on 0 of 2,679 weapons), derive from geometry (pinned at 1.0, raised all 38 placed weapons by a uniform ×3.33). The constants are a *fitted product* of "how many are out" and "how often the boss is in one"; code answers neither. Treat as calibration, not extraction.
- *Assuming exotic mechanics are widespread.* Measured populations are small: `NextBool` gates on a projectile **8 weapons**, contact weapons with a release payload **3**, placed weapons with a mined concurrency cap **0**. Build the general machinery because it is correct, not because the counts are large.
- *Chasing the guide aggregate.* The four bug fixes this stage moved ~85 weapons and about **+11 top-3 out of ~1,400 rankable picks, under 1%**. That is the expected order of magnitude. Judge changes on mechanics.

**Open question worth one check:** `noMelee` is `true` for Terra Blade, Excalibur and Night's Edge, so 100 melee weapons tagged `shot` get no blade phase at all. Both swing a sword that hits in game. Verify against the IL before changing anything.

## Clean-agent briefing

### Mission

The goal is not to maximize agreement with the guides or train the scorer on their picks. The guides are evaluation evidence written by experienced players. Use disagreements to find one of five general faults:

1. the guide was parsed or resolved incorrectly;
2. the wrong content, progression, class, target, or balancing context was compared;
3. the guide expresses an annotation or ordering that the evaluator discarded;
4. the miner failed to preserve a real mechanic;
5. the sustained single- or multi-target model handles a general mechanic incorrectly.

Only change scoring when the disagreement can be explained by a reusable in-game mechanic. Do not add guide-derived rank bonuses, per-weapon multipliers, hidden exceptions, or a lookup table that makes named items agree. A guide match is supporting validation, not by itself proof that a formula is right. Conversely, a persistent mismatch can be legitimate because a guide considers utility, ease of use, encounter geometry, acquisition timing, or the author's judgment differently from Real DPS.

The desired end product remains a general mechanics model that is useful for weapons with no guide coverage, especially Void weapons. Preserve the distinction between measured facts, code-extracted facts, tooltip-derived facts, conservative fallbacks, and unresolved behavior.

### Decisions that are already settled

- Compare every guide only with its own fixed content scope; this installed mod set is not expected to change, so do not build a general mod-pack reconciliation framework.
- Exclude explicitly incomplete sections. Flag suspicious copied or stale sections, but do not silently discard them without evidence.
- Calamity evaluation includes Calamity's rebalancing of vanilla items but excludes unrelated mods' balancing. Vanilla evaluation uses vanilla items with all external balancing disabled. The normal application still defaults to the full installed balance context.
- Plain/base ammo is the scoring default unless the weapon transforms that ammo. A user may select one ammo item per ammo kind and rescore compatible weapons. Ammo rarity, consumption, and conservation are out of scope.
- Non-ammo resource sustain is in scope: mana-like pools where not already handled, Void, inspiration, exhaustion, charge, cooldowns, and other mechanics that change long-fight uptime or activation rate.
- Keep the existing general weapon type/archetype for display and filtering. Attack phases are an additional mechanical decomposition and must also be visible in score explanations.
- Keep exactly two user-facing outcomes: sustained single-target DPS and sustained multi-target DPS. Do not introduce separate burst, safety, reliability, ease-of-use, economy, or utility scores to force guide agreement.
- SOTS's page is an exhaustive, non-repeating catalogue. Use it for Void coverage, stage, and subtype evidence; never treat it as an ordered recommendation list or optimize top-k against it.

### Non-goals and guardrails

- Do not assume a guide row is a strict ranking. Most rows are sets of viable alternatives; only explicit annotations such as `Best` create an ordering claim.
- Do not score armor, accessories, or support entries as weapon recommendations. They are useful later as loadout/effect evidence.
- Do not count every alternative in one cell as an independent recommendation. Resolve alternatives, then credit the recommendation group once.
- Do not infer a Calamity-style class-mixing penalty for SOTS Void subclasses. None was found in the inspected inheritance rules; add one only if code evidence is later found.
- Do not let tooltip prose override extracted code when both exist. Tooltips are fallback evidence for cadence, requirements, and caps the extractor missed.
- Do not solve a mismatch with a one-off item-name check. If a mechanic is truly unique, represent it as explicit phase/evidence data that is inspectable and testable.
- Do not interpret better aggregate top-k agreement as sufficient acceptance. Check for regressions by guide, stage, class/subtype, archetype, target mode, and mechanic family.

### Guide semantics and comparison unit

| Guide | What a row means | Competitor/effect context | Ordering evidence |
| --- | --- | --- | --- |
| Calamity class setups | Curated recommendations for vanilla + Calamity progression | Vanilla and Calamity items; allow Calamity balance effects only | Usually unordered; retain explicit target/role/note annotations |
| IEoR class setups | Curated recommendations across this repository's fixed installed content set | The explicit mod list in `GUIDE_CONFIG`; normal installed balance context unless narrowed by evidence | Usually unordered; `C`, stealth/spam headings, `nu`/Void route, and WIP notes matter |
| SOTS class progression | Exhaustive SOTS catalogue, items shown when first obtainable and not repeated later | SOTS items and SOTS balance only | No quality ordering; stage and Void subtype evidence only |
| Terraria class setups | Curated vanilla recommendations | Vanilla items, no external balance effects | Single-target/crowd grouping and explicit `Best` labels are meaningful |

The primary evaluation unit is a guide section such as guide + progression tier + class/subtype + target/role, not an individual raw pick. For recommendation guides, report at least:

- best model rank reached by any recommendation in the section;
- recall at K, where K is the number of distinct recommendation groups in that section;
- top-3 and top-8 coverage for continuity with the existing audit;
- pairwise accuracy only for explicit priorities such as `Best` versus peer alternatives;
- unresolved, late-stage, class-mismatched, support-only, and out-of-scope counts separately from the rankable denominator.

Evaluate single-target and crowd-control guide groups against the corresponding Real DPS mode. Do not average them into one rank. A pick staged after the guide tier is an audit finding, not a normal miss; put it in the requested late-weapons report with its stage evidence.

### Required diagnostic loop

Follow this order so guide cleanup and scoring changes cannot be confused:

1. Freeze a reproducible baseline from the current model and record the exact guide profile, balance context, stage, class/subtype, and target mode.
2. Repair parsing, name/mod resolution, alternatives, section completeness, and competitor scope without changing DPS. Recompute the baseline after those evaluator-only fixes.
3. Classify every important remaining mismatch as stage data, class/subtype routing, missing extracted mechanic, scoring formula, guide-only utility/judgment, or unresolved. Keep representative weapon names for each bucket.
4. For a suspected model shortfall, inspect both under-scored and over-scored weapons that share the mechanic. A proposed fix should predict movement in both directions where applicable.
5. Add or preserve code/tooltip evidence, implement the smallest general mechanic, and write a focused invariant/regression test before judging guide movement.
6. Compare before/after by guide section and mechanic family, then inspect non-guide weapons sharing the same mechanic for implausible collateral movement.
7. Keep a change only when its mechanical rationale stands independently of the guide metric. Document legitimate residual disagreements instead of tuning them away.

The discrepancy report should therefore retain enough columns to reproduce a row: guide/profile, source section and annotation, recommendation-group ID, resolved item ID/mod, guide stage, inferred lab stage and stage source, class/subtype, target, balance context, model score/rank, and exclusion or mismatch reason. This report is the bridge between the handmade judgment and the general model; a single aggregate percentage is not.

### Current generated-data state

Resolved. `data/guides.json` and `data/guides.md` were regenerated from the cached pages after the parser fixes below: 15,969 picks — 4,087 Calamity, 10,470 IEoR, 464 SOTS, 948 Terraria — over 62 tiers. The SOTS zero-pick bug is fixed and covered by tests. The generated files are usable as the evaluation baseline again; `data/guide-late-weapons.md` is generated alongside them by `tools/guide-check.mjs`.

### Code map for a fresh agent

- `tools/guides.mjs`: guide profiles, downloading/caching, parsing, item resolution, and generated guide records.
- `tools/guide-check.mjs`: comparison pools, rankability, metrics, and discrepancy reporting. This is the next central refactor.
- `src/lib/dps.js`: current Real DPS mechanics. Start around ammo selection, target construction, projectile hit estimation, variant/child contribution, and final weapon grading.
- `src/lib/stats.js`: `effectiveStats` and balance/effect overlays. External-balance filtering belongs here or in an explicit context passed through it.
- `src/lib/solver.js` and `src/lib/score.js`: loadout solving, equipment bonuses, resource-related stats, and call sites that need the selected ammo/balance context.
- `miner/extract/items.js`, `projectiles.js`, `shoot.js`, `globals.js`, plus `miner/classify.js` and `miner/mine.js`: extraction points for phase triggers, probabilities, caps, subtype/resource fields, conditional equipment effects, and provenance.
- `src/lib/state.svelte.js`, `src/App.svelte`, `src/components/Controls.svelte`, `LoadoutPanel.svelte`, `ItemCard.svelte`, and the timeline worker path: state/UI propagation for target mode, balance context, ammo selection, and phase explanation.
- `test/guides.test.js`, `test/dps.test.js`, `test/solver.test.js`, `test/interp.test.js`, and `test/classify.test.js`: likely homes for regression coverage.
- `docs/rework-weapon-scoring.md`: related design context, but inspect its diff before relying on or editing it because it may contain user-owned work.

### Definition of done

This line of work is complete when guide ingestion preserves the meaningful structure, every comparison uses an explicit scope and balance context, invalid rows are separated from real misses, the requested late-stage report exists, selectable typed ammo and external-balance controls work, resource/conditional/phase mechanics have evidence-backed tests, phases are explainable in the UI, and both full tests and production build pass. The final comparison should show before/after results by guide and mechanic family and explain remaining disagreements rather than claiming that guide agreement itself proves correctness.

## User intent captured

- Compare each guide only against the content set that guide covers.
- Exclude guide sections that explicitly say they are incomplete.
- Preserve guide sections, roles, target annotations, priorities, notes, alternatives, and mod hints with higher fidelity.
- Add the SOTS class-progression page as a third source for Void weapons.
- Add the official Terraria class-setup guide so vanilla-only, un-rebalanced scores can be evaluated against the most curated source.
- Allow external balancing changes to be disabled. Guide evaluation should be able to select the balancing mods appropriate to each guide, rather than only offering a global all-or-nothing interpretation.
- Keep plain/base ammo as the default. Let the user select a specific obtainable ammo per ammo kind from the bottom ammo list; selecting one must re-score weapons of that ammo kind. Ignore ammo rarity, conservation, and consumption.
- Model non-ammo resource limits, conditional proc frequency, charge/release behavior, exhaustion, and equipment-gated effects.
- Keep the current general weapon archetype for display/filtering, while adding separate attack phases and showing them beside the score.
- Keep only sustained single-target and multi-target Real DPS views.

## Audit findings

The original pre-Hardmode report contained 508 resolved non-support guide weapon rows, but that denominator was misleading:

- 29 were staged later than their guide tier.
- 51 were class mismatches; 48 resolve to SOTS Void weapons and 45 of those are explicitly marked `ν` by IEoR.
- Only 428 were directly rankable as written.

Restricting competitors to each guide's covered mods, without changing the DPS model, improved those 428 rows from 61 to 84 top-3 matches and from 135 to 175 top-8 matches. Across tier/class sections, a guide pick appeared in the top 3 in 44/61 contexts and in the top 8 in 58/61 contexts. This shows that guide scope and comparison semantics must be corrected before using guide deltas to tune DPS.

The two existing guides have low overlap even in identical pre-Hardmode stage/class contexts: 64 shared weapon rows, roughly 50% of the Calamity set and 23% of the IEoR set (about 18% Jaccard). Their lists are unordered and differ in breadth, so individual-item raw rank is not a sufficient objective. Recommended section metrics are best-hit rank, recall at the number of guide picks, and pairwise ordering accuracy where a guide supplies an explicit priority.

`data/guides/ieor-Pre-Mechanical_Bosses.txt` explicitly says it is a work in progress and may be copied from the preceding section, and is skipped.

The copied-section repetition is now measured and excluded at parse time (`dropCopiedSections`), on the same principle: the wikis are read once, cleaned once, and a section that never reaches `data/guides.json` never reaches a comparison. A tier/class section whose **weapon** list is ≥85% the last kept section's is dropped with a warning naming the tier it copies and the overlap. Only weapons decide — buff, potion and armor lists repeat between tiers because the answer really has not changed.

What it finds: IEoR copied its magic, bard and healer tabs forward through the whole of hardmode. The magic tab lists the same 13 weapons at Pre-Wall of Flesh and at Pre-Moon Lord (verified against the raw wikitext, not just the parse: the box genuinely holds 14 item tokens); the bard tab is 100% identical from Pre-Providence to Endgame. Its melee tab, by contrast, shares **zero** weapons with the previous tier — that one is maintained. 5,638 IEoR picks were being scored as if they described the tier they were printed in. Calamity trips the detector nowhere (its worst tier-to-tier overlap is 52%), vanilla and SOTS nowhere.

Removing them roughly doubles IEoR's agreement — top-3 7% → 15%, recall@K 20% → 33%, MRR 0.086 → 0.150 — without a single change to the model. That is the size of the error that guide-quality artifacts were introducing, and why sections have to be cleaned before scoring is judged.

`tools/guides.mjs::findItem` previously ignored a guide's mod hint and picked the earliest same-name item. That caused real mis-resolution, including Calamity's `Dragon's Breath` resolving to Thorium's item. Mod-aware resolution has now been added.

SOTS's guide states that it is an exhaustive catalogue of obtainable SOTS items, not a list of best recommendations, and that it intentionally does not repeat items in later tiers. It should provide staging, subtype, and coverage evidence, but should not be optimized as a top-k quality ranking.

SOTS Void subclasses were inspected in the installed assembly. `VoidMelee`, `VoidRanged`, `VoidMagic`, and `VoidSummon` each inherit 100% of Generic, VoidGeneric, and their named base class's modifiers/effects. No Calamity-style mixing damage penalty was found in those inheritance rules. The scorer currently collapses all of these to `void`, losing the underlying subtype scaling; this remains to be fixed.

Parsing faults found and fixed in the second session, each of which had been silently deleting evidence:

- IEoR's Healer tab titles its weapon box `[[Items]]`; every other class uses `[[Weapons]]`. The kind test only accepted `[[Weapons]]`, so **every healer weapon in all 22 tiers was dropped** — 356 picks, and the class showed zero rankable weapons. Healer is the only tab that does this.
- The official Terraria guide's mech tier is `Pre-Mech Bosses`; the tier table spelled it `Pre-mechanical bosses`, so that whole tier was dropped (120 picks).
- The vanilla parser collected every box title that *started* before an item rather than the boxes actually containing it, so `Best` and `Single-Target`/`Crowd-Control` leaked onto everything printed after those boxes closed. Boxes are now read as a stack. This was inventing priority and target claims the guide never made.
- The SOTS section scan sliced a section to the next *recognised* heading, so a tier the lab has no boss key for handed its table to the tier above it.
- SOTS marks were read from raw cell text, which finds a `C` (crowd control) in any capitalised name; they are now read from bold runs only.
- SOTS was parsed for Void weapons alone. It is now read as the whole catalogue — 464 picks including armor, accessories and ammo — because "first tier at which this item is obtainable" is stage evidence for all of SOTS, not only its Void subclass.

Dataset gaps the guides expose (miner leads, not model faults):

- 209 IEoR healer weapon picks resolve to nothing. Thorium's pure-healing weapons (`Renew`, `Heart Wand`, `Syringe`, `The Good Book`…) are absent from the dataset; a weapon with no damage is also excluded from the ranking pool, so healer coverage is thin at both ends.
- 118 vanilla picks resolve to nothing, and 47 of those are weapons. Some are guide shorthand for a family (`Gem staves`, `Phaseblades`), but real items are missing too — `Coin Gun`, `Cattiva`, `Foxparks`, `Barnacle Staff`, `Vulgar Display of Flower`. The dataset holds 1,111 vanilla items and 521 vanilla weapons, so this is a coverage gap in vanilla extraction, not a naming mismatch.
- SOTS resolves almost perfectly — 1 unresolved weapon of 159 — which is why it is the most trustworthy staging evidence of the four.

Important concrete scoring failures:

- Suspended Shotgun Shell Launcher says its bullet series happens after 8 consecutive hits, but all eight children are currently paid on every projectile death.
- Luminant Tether says chains damage once per second and can link at most three targets, but its one-tick local immunity plus a stuck-projectile lifetime currently yields about 181 hits per projectile.
- Thorium Bard projectile base-class accessory effects (Mixtape, Diss Track, Full Score, etc.) are currently attached to every instrument projectile, so Violin receives unequipped accessory procs.
- Gel Glove and Lasting Pliers use Thorium's exhaustion system. The installed code adds `2 * useTime` exhaustion per use, uses a base maximum of 1200, regenerates it over time, and applies a rapidly collapsing damage multiplier while exhausted. The item miner does not yet expose the `isThrowerNon` flag needed to model this.
- Urchin Mace is classified as `placed` because its inherited mace projectile parks during part of its AI. It is a channelled mace/flail with a release attack and should not receive the global placed-cloud treatment.
- Boomerangs are the worst-performing guide archetype: none of 10 pre-Hardmode guide rows reached top 8 in the earlier audit. The single global 300-pixel outbound distance and one-at-a-time flight cycle need better per-projectile return/turnaround evidence.
- The current multi-target model did not align well with `C` annotations. It should remain a sustained multi-target score, but its target geometry and lingering/chain/AoE handling need improvement.

## Changes completed so far

### Session 5 (2026-09-05, debuff defaults, compiler integration, polar velocity, Void)

Files touched: `src/lib/dps.js`, `src/lib/phases.js`, `src/lib/solver.js` (one line: `loadoutFor`), `miner/extract/shoot.js`, `miner/extract/interp.js` (arithmetic on rolls, angles and trig), `miner/extract/items.js`, `miner/mine.js` (two emitted fields), `tools/il-dump.mjs` (floats printed in decimal — they were printed in hex, and `tok 0.4` read as 0.4 was 0.25), the phase-graph UI (`PhaseGraph.svelte`, `ItemCard.svelte`, `ItemBrowser.svelte`), tests, `data/dataset.json` (re-mined), `data/dps-parity.json` (re-frozen), `data/unresolved-phases.md`.

**Debuffs.** Two defaults flipped, both measured: an NPC whose immunity table the miner could not walk (`immuneUnknown`, **102 of 135 stage targets**) was treated as immune to everything — it is now immune to nothing it was not read to be (405 weapons up); a debuff with no readable effect (577 of the applications weapons make — a mod's slow, mark or curse) was worth nothing — it is now a flat allowance for the stage, `unknownDebuffDps = 4 + 1.2 × progression`, kept under the median DoT the miner *could* read, marked `assumed` (413 weapons up). Exposed by the flip and fixed in the same pass: a DoT was paid whether or not the weapon landed anything (Aphelion: 0 hits, its whole DoT) — it is now on the boss `min(1, hits/s)` of the time (96 weapons, 87 up 9 down — the ones that land under a hit a second).

**Compiler, integrated.** `cooldown` read from text ("30 second cooldown") caps a hit/death child at `60/cooldown` activations a second (6 weapons: Genocide 1,460 → 855); a maintained phase is cast at the rate that keeps its links up and the pool is charged that (Tether 155 → 182); the immunity window caps **per group** — the phases through the player's window on their sum, a phase with its own `local` untouched (41 weapons, both directions: Alluvion 12,809 → 8,869 where shared siblings were riding a local-immunity flag, Leonid Progenitor 760 → 1,422 where own-clock children were being capped); a true-melee weapon that fires further than it reaches is graded in both stances and takes the better (`stands back at …` — it fired on 0 of 2,679, because the range band at the edge of the shot's reach costs more than the blade's ×0.35 brings; the alternative is there and honest). Contributions still sum to the score (99.0% of grades within 2%).

**Polar velocity, read.** `len = velocity.Length(); θ = Atan2(v.Y, v.X); new Vector2(len·k·Sin(θ±d), len·k·Cos(θ±d))` — 22 Thorium and ~20 Calamity `Shoot`s — came out as "unknown velocity": the weapon's own speed and no spread. `vectorHook` now returns the length as an adjustable, the aim as an angle, `Sin`/`Cos` as a component carrying the offset, and the interpreter multiplies an adjustable by a roll (its middle) or a trig term, adds a roll to an angle as jitter, and passes rolls and trig through conversions; `new Vector2` and the float `NewProjectile` overload read the fan off it. Midas' Gavel: ×1.52 speed and ±0.16 rad, as its IL says. Also fixed on the way: `target − spawnPosition` was read as the vector on the right nudged, so Supernova Storm's stars, spawned 160 px out at a random angle and then flown at the cursor, had a velocity of 160 px/tick scattered over 2π. After the re-mine: **142 weapons carry a velocity multiplier** (221 calls), 426 calls a spread; the re-mine moved 150 weapons.

**Void, miner side.** `VoidItem.SetDefaults` runs the item's `SafeSetDefaults` (where it says Ranged) and then swaps in `VoidRanged` through four branches the machine cannot read, so 84 of 86 void weapons came out `VoidMelee`. The first class written is now kept as `baseDamageClass`; the item emits `subclass` (33 melee, 21 ranged, 17 magic, 12 summon) and its `dc` is the void class it actually ends up with. `GetVoid(player)` — overridden by 78 SOTS weapons, every one a constant, 3–60 — is evaluated into `voidCost` (82 weapons). Scoring: a void weapon pays void the way a mage pays mana (`voidRegen`, a knob: the bare bar refills a third of a point a second and the class lives off gain the miner does not read, so it is set where cost *differences* still show), and the loadout's bonus for its subclass counts on top of the void bonus (`ctx.loadoutFor`).

Guide deltas versus the session-start baseline, whole batch: calamity top-3 −2 / top-8 −2 / recall@K +3, ieor +3 / +2 / +4, vanilla +2 / +5 / +3, MRR flat. The calamity loss is in rogue (−3 top-3); melee is up in all three guides.

`bun test` 285 pass. Snapshot re-frozen at dataset `a108d335859c`.

### Session 4 (2026-09-05, phase compiler)

Files touched: `src/lib/dps.js`, `src/lib/phases.js`, `test/dps.test.js`, `test/phases.test.js`, `test/solver.test.js` (two expectations now include the blade's landing), `tools/unresolved-phases.mjs`, `data/dps-parity.json` (re-frozen), `data/unresolved-phases.md` (regenerated), this file. Nothing else.

How a phase cycle compiles, as implemented: `activation/s = parent/s × count × chance ÷ threshold`; `landed/s = activation/s × landing(D, reach, lead, arc)` for every phase, the blade included; for a phase that stays, `alive = min(maxActive, bodies, landed/s × duration/60)` and `hits/s = landed/s + alive × 60/interval`; concurrent phases add, the round trip is the one sequential cycle, and `contribution = hits/s × hit × crit × sustain × risk` so the graph sums to the score by construction.

Sequence, each step measured with `tools/dps-snapshot.mjs --check`:

1. Cascade surfacing — **0 of 2,679 moved**. (A first cut printed the "1-in-N roll" part on a shot that landed nothing and moved three `parts` counts; the net caught it.)
2. Text gates — **6 moved, all down**, exactly the surveyed set.
3. Blade landing — 381 moved. A first cut flew a fake projectile out to the reach and `step × life` came out at 59.999… for some animation lengths, sending 16 swords and both shortswords to 0; `landing()` now takes the reach outright. The engagement distance for a true-melee weapon is now the *blade's* reach (`REACH × scale`), so a 0.9-scale pickaxe stands at 90 px rather than being told it cannot reach 100.

Guide deltas for the whole batch (`guide-check --vs`): calamity top-3 +2 / top-8 −2, ieor +3 / +1, vanilla +2 / +6, recall@K +2 / +1 / +3, MRR flat. Melee is the only class that moved, in every guide.

Snapshot re-frozen at dataset `1302b44471f3`. `bun test` 269 pass, `bun run build` clean.

### Session 2 (2026-09-04, guide track)

Files touched: `tools/guides.mjs`, `tools/guide-check.mjs`, `src/lib/stats.js`, `src/lib/solver.js` (one line), `test/guides.test.js`, `test/stats.test.js`, generated guide data, this file. Nothing else was edited; the rest of the dirty worktree is untouched user work.

1. Parsers corrected — see the parsing faults in the audit findings above. `bun test test/guides.test.js` covers all of them with page fixtures: 28 tests including SOTS box/void/marks/alternatives/Expert-italics and vanilla box nesting, footnotes and `(or X)` alternatives.

2. SOTS is parsed as the full catalogue. Void weapons carry `cls: 'void'` plus `subclass` — the base-class column they were printed in — which is the field a subtype-aware Void score will read once the miner emits it.

3. `tools/guide-check.mjs` rewritten around sections and recommendation groups:
   - competitor pool and balance context come from `GUIDE_CONFIG`: everything outside a guide's `mods` is excluded from `candidates`, and `balanceMods` narrows which mods may rebalance what is left;
   - a guide row and its `/` alternatives are one group, credited once, at its best-placed member's rank;
   - `p.target` (and the `C` mark) select single- or multi-target scoring for the section;
   - a `ν`/Void pick printed in a base class's column is ranked in the Void pool instead of counted as a class miss;
   - unresolved, late, class-mismatched, out-of-scope and support groups are counted apart from the rankable denominator;
   - per-section metrics: best rank, recall@K where K is the section's group count, top-3/top-8, and pairwise accuracy only where the guide states a priority;
   - spam/stealth mode agreement is judged only for weapons a guide files exclusively under one of those headings;
   - SOTS is marked `intent: 'catalog'` and never enters a top-k metric;
   - every detail line now carries the resolved id, the scope, the stage evidence and the exclusion reason, so a row can be reproduced.

4. `data/guide-late-weapons.md` is generated on every run: weapon rows only, grouped by guide/tier/class, with guide stage, lab stage, stage source and whether the row would otherwise have been rankable. 120 rows, 84 distinct items.

5. Mechanic families. A pick is ranked inside the job it fills, not against every weapon of its class: summon families (minion/whip/sentry) come from what the item is, rogue families (spam/stealth) from what the guide asked for, using the separate `v.spam` and `v.stealth` values the model already computes for every rogue weapon. Reported per guide as its own table — this is the axis a scoring change must be checked on, so a fix that helps one family at another's expense cannot hide in an aggregate.

6. `UNLISTED` — weapons the model puts in a stage's top 8 that the guide never names — is split three ways, because it held three different problems: another guide names it (this guide is not enumerating its pool), no guide names it and the stage came from a hand placement or an anchor (a staging lead), or no guide names it and the stage came from a real source (the model's own worklist: 305 of 416).

7. `--json <file>` snapshots the metrics and `--vs <file>` prints the deltas per guide, class and family. For A/B'ing a scoring change, not for reading.

8. External-balance control exists in the model (`ctx.balanceMods`, `src/lib/stats.js`): unset keeps today's full installed context, a set narrows the replayed `changes`/`variants`/`mods` to those mods plus the item's own, and the unconditional reset to the mined final values is skipped when the context is narrowed — that reset was what previously made filtering impossible. `solveLoadout` passes it through. Covered by `test/stats.test.js`. **No UI for it yet**; the app is unchanged and still defaults to everything enabled.

### Session 1

This session intentionally changed only `tools/guides.mjs`, generated guide data, and this handoff file. Many other modified or untracked files already existed and must be treated as user-owned unless a diff proves otherwise.

1. Added fixed guide comparison profiles (`GUIDE_CONFIG`):
   - Calamity: vanilla + Calamity content, with Calamity balancing.
   - IEoR: the fixed set of content mods actually covered by that guide.
   - SOTS: SOTS content; marked as a catalogue rather than quality recommendations.
   - Terraria: vanilla content only, with no external balancing mods.

2. IEoR's explicitly incomplete `Pre-Mechanical_Bosses` tier is skipped during parsing.

3. Added cached wiki-page fetch support plus initial parsers for:
   - `Secrets Of_The_Shadows/Class progression`
   - official `Guide:Class setups`

4. The vanilla parser preserves:
   - class and progression section;
   - weapon/minion/sentry/whip/ammo/armor/accessory kind;
   - single-target versus crowd-control target;
   - support role;
   - explicit nested `Best` priority.

5. `findItem` now prefers the mod named by a guide entry for weapons, armor, accessories, and ammo before using stage as a tiebreaker.

6. Guide records now carry `target` and `priority`, and the generated Markdown table has columns for them.

7. The guide cache was refreshed successfully over the wiki APIs. `data/guides.json`, `data/guides.md`, and `data/guides/vanilla-class-setups.txt` were generated. The first run exposed a SOTS row-cell indexing bug; that one-line parser bug has been fixed, but the guide generator has not yet been rerun after the fix.

8. Existing guide unit tests passed before the final one-line SOTS parser correction: 16 passed, 0 failed.

## Frozen baseline (2026-09-04, after the evaluator repairs, before any DPS change)

`node tools/guide-check.mjs --summary`. This is step 2 of the diagnostic loop — evaluator-only fixes, DPS untouched — so it is the number every later scoring change must be compared against. It is a diagnostic baseline, not an acceptance target. Snapshot it with `--json <file>` and diff a later run with `--vs <file>`.

| guide | groups | rankable | sections with a top-3 hit | recall@K | top-3 | top-8 | MRR | vs rivals | late | class miss | unresolved | support |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| calamity | 2663 | 466 | 65/119 | 151 (32%) | 107 (23%) | 203 (44%) | 0.225 | 127 | 173 | 134 | 88 | 161 |
| ieor | 3492 | 593 | 45/76 | 198 (33%) | 86 (15%) | 181 (31%) | 0.150 | 157 | 118 | 100 | 200 | 105 |
| sots | 464 | — catalogue — | | | | | | | 55 | 0 | 5 | 0 |
| vanilla | 808 | 347 | 56/69 | 155 (45%) | 108 (31%) | 169 (49%) | 0.264 | 82 | 25 | 3 | 118 | 23 |

Vanilla also gives the two ordering signals no other guide can: explicit priority honoured 243/398 pairs, and spam/stealth grade agreement 44/46.

### By mechanic family — where the fault actually is

The families are the jobs a player fills with *separate weapons worn at once*: a summoner's minion, whip and sentry; a rogue's spam weapon and stealth weapon. They are ranked apart, each against its own kind, because nobody chooses between them.

| family | calamity | ieor | vanilla |
| --- | --- | --- | --- |
| whip | 19 picks, top-3 **100%**, MRR 0.974 | 32, 44% | 22, 73% |
| sentry | 31, 55% | 28, 32% | 18, 78% |
| minion | 55, 18% | 44, 16% | 26, 50% |
| stealth | 13, 38% | 17, 12% | — |
| spam | 22, 32% | 34, 12% | — |
| **primary** | **326, 15%** | **438, 11%** | **281, 23%** |

This is the single clearest result in the whole audit and it is consistent across three independent guides: **the model is good at the slot-based summon roles and bad at picking the one primary damage weapon.** Part of that is pool size — a whip competes with 6 rivals, a primary weapon with 100–364 — but not all of it: vanilla's minions (10 rivals) sit at 50% while its primaries (100 rivals) sit at 23%. `primary` holds 1,045 of the ~1,400 rankable picks, so it is also where nearly all the evidence is. Fix primary-weapon scoring and everything else follows; tuning whips would be optimising the part that already works.

## Immediate next steps

1. ~~Parser tests, regenerate, inspect counts~~ — done, session 2. 28 parser tests; SOTS 464 picks, Terraria 948, IEoR 10,470.

2. ~~Refactor `tools/guide-check.mjs`~~ — done, session 2. Everything listed there is implemented; see the changes section.

3. ~~`data/guide-late-weapons.md`~~ — done, session 2, regenerated on every `guide-check` run.

4. External-balance control — **model done, UI not**. `ctx.balanceMods` works end to end and guide-check uses it. What remains:
   - a UI option that disables changes/variants/runtime modifiers whose `mod` differs from the item's own mod, defaulting to everything enabled;
   - carrying it through `state.svelte.js`, `App.svelte`, `Controls.svelte` and the timeline worker;
   - showing which overlays were skipped in the item card's arithmetic chain (`effectiveStats` already omits them from `chain`, so the card silently shows a shorter chain).

5. Implement per-ammo-kind selection:
   - persisted state `ammo: { [kind]: itemId }`;
   - selected ammo is validated against kind and stage, otherwise plain ammo is used;
   - pass the selected map through `App.svelte`, timeline worker, and `solveLoadout`;
   - make grouped ammo rows selectable and show a clear “plain/default” state per kind;
   - re-score only weapons using that kind; transformed-ammo weapons must continue using their transformed projectile behavior.

6. Preserve Void subtype and resource cost in mined data (the guide side is ready: SOTS picks already carry `subclass`, and guide-check ranks a `ν` pick in the Void pool — it just cannot yet tell a Void melee weapon from a Void mage's):
   - emit `subclass` from `VoidMelee`/`VoidRanged`/`VoidMagic`/`VoidSummon`;
   - evaluate each SOTS `GetVoid(Player)` override where it returns a stable cost;
   - add a sustained Void pool/regeneration model;
   - combine Void and underlying subtype bonuses rather than treating every Void weapon alike;
   - do not add an unsupported mixing penalty.

7. Extract Bard inspiration cost by recording `BardItem.set_InspirationCost`/its backing field during item evaluation, then add inspiration pool/regeneration sustain. Ammo consumption remains deliberately unscored.

8. Extract Thorium's `isThrowerNon` item flag and add an exhaustion cycle to sustained DPS. This should be a resource phase in the explanation, not a permanent arbitrary damage penalty.

9. Improve conditional effects generally:
   - preserve `NextBool(N)` as a 1/N branch probability in Shoot/projectile extraction;
   - attach conditional probability/counter/cooldown metadata to spawned projectiles;
   - preserve unknown equipment/player flags on inherited projectile effects and activate them only when the solved loadout supplies the matching effect;
   - use tooltip cadence/counter text only as a fallback when code did not provide the number;
   - add regression tests for the three concrete failures above.

10. Implement the attack-phase model described in detail below. Keep `item.arch` as the weapon's display/filter category; phases describe the separate actions and states that produce its sustained score.

11. Correct hybrid archetype cases and sustained single/multi behavior:
   - channelled inherited mace projectiles should classify as flails rather than placed clouds;
   - replace the blanket placed uptime with evidence from lifetime/cooldown/maximum concurrent projectiles;
   - derive boomerang turnaround/return timing or use contact-triggered return distance when present;
   - represent capped tethers/chains and release attacks explicitly;
   - keep exactly single-target and multi-target sustained outputs (remove or migrate the current `auto` UI choice if desired after validating existing saved state).

12. Run focused tests, full `bun test`, `bun run build`, regenerate the dataset if miner fields changed, then compare old/new guide metrics per guide and per archetype. Model changes should be accepted for explaining mechanics and improving section metrics, not merely for increasing one aggregate top-k number.

## Expanded attack-phase design

### Purpose and boundary

`item.arch` should continue to answer “what general kind of weapon is this?”: bow, gun, boomerang, flail, minion, sentry, and so on. It remains useful for display, filtering, engagement range, and broad movement defaults.

Attack phases answer a different question: “what sequence or set of events deals this weapon's damage during a fight?” A flail may spin, launch, hit, return, and release a whirlpool. A gun may fire an ordinary shot and produce a burst after every eighth landed hit. A tether may have a cheap cast phase but deal damage from a capped periodic link. Collapsing all of those into one archetype is the source of several current over- and under-scores.

Phases are internal components of the same two user-facing results:

- sustained single-target Real DPS;
- sustained multi-target Real DPS.

They do not create burst, safety, reliability, or utility scores. Their purpose is to make those two sustained answers mechanically faithful and explainable.

### Phase graph rather than a flat list

A weapon should be represented as a small directed graph. Nodes are phases; edges say how a phase activates another phase. Most weapons will compile to one node. Complex weapons will usually have three to six.

```text
player use -> primary delivery -> landed hit -> hit-counter proc -> child burst
                              \-> on-impact explosion -> lingering field

resource pool -> permits player use
exhaustion    -> changes the active fraction/damage of player use over time
```

Every phase needs these common properties:

| Property | Meaning | Why scoring needs it |
| --- | --- | --- |
| `id`, `label`, `kind` | Stable identity and user-facing name | Joins evidence, calculations, tests, and UI rows. |
| `parent` / `trigger` | Use, hit, crit, kill, timer, release, return, threshold, or another phase | Prevents a child from being paid more often than the event that creates it. |
| `relation` | Sequential, concurrent, alternative, replacement, or modifier | Decides whether phase damage is divided by shared time, added, selected, substituted, or applied as a multiplier. |
| `count` | Projectiles/events per activation | Converts activation rate into event rate. |
| `chance` | Probability per eligible trigger | Correctly values `NextBool(N)` and percentage procs. |
| `threshold` | Eligible triggers required per activation | Models “after 8 hits,” combo finishers, and meters. |
| `cooldown` | Minimum time between activations | Caps proc frequency even when hit rate is high. |
| `windup`, `duration`, `interval`, `recovery` | Time spent entering, sustaining, ticking, and leaving a phase | Produces a complete attack cycle instead of assuming every component occurs every use. |
| `maxActive` | Maximum simultaneous projectile, link, summon, trap, or field instances | Stops repeated casts from creating impossible stacks. |
| `payload` | Projectile, direct hit, damage multiplier/flat damage, debuff, tag, or stat modifier | Reuses the existing landing, defense, critical-hit, pierce, and debuff calculations. |
| `targeting` | Single body, line, chain, area, worm segments, nearest N, or unrestricted | Makes the same phase produce different single and multi values without a separate weapon formula. |
| `immunityGroup` | Player, local projectile, static projectile type, or once-per-target | Applies hit-rate caps after related phases are combined, rather than independently overpaying each projectile. |
| `resource` | Cost, gain, meter maximum, recovery, or lockout | Makes sustained availability part of the cycle. |
| `requires` | Equipment flag, buff/state, stealth, alternate click, ammo kind, or target condition | Keeps effects inactive when their prerequisite is absent. |
| `evidence` | Code location/field, tooltip clause, vanilla table, or conservative inference | Lets the UI and diagnostics say why the phase exists. |
| `confidence` | Exact, numeric text, structural inference, or unknown | Controls conservative fallback behavior and gives the audit a worklist. |

The stored form should contain factual mechanics, not a precomputed score. Single/multi target geometry, loadout stats, selected ammo, difficulty, and balancing settings remain runtime context.

### Composition relations

The `relation` is as important as the phase kind:

- `sequential`: time belongs to one shared cycle. Charge → release → recovery uses `(total cycle damage) / (total cycle time)`.
- `concurrent`: autonomous damage continues while the player attacks. Minions, a maintained tether, and a lingering field add their steady-state DPS, subject to their own active caps.
- `alternative`: the player chooses one attack, such as left/right click or charged/uncharged release. Score each complete alternative and select the better one separately for single and multi target. Never sum or randomly average player choices.
- `replacement`: one result replaces another, such as transformed ammo or every fifth combo swing being a finisher. Weight by deterministic state frequency or a known probability; do not add both the original and replacement payload.
- `modifier`: the phase changes another phase's damage, speed, pierce, range, targeting, or resource cost. Apply it to that phase instead of inventing a separate damage hit.

An edge may combine gates. For example, “on critical hit, 20% chance, at most once per second” has an eligible trigger rate equal to landed-hit rate × crit chance × 0.2, then capped at 1/s.

### Expected phase kinds

These are the expected phase kinds to support. They are deliberately mechanical rather than tied to individual weapon names.

| Phase kind | Typical evidence | Scoring use |
| --- | --- | --- |
| `primary` | Item use time/animation, direct melee flag, default projectile, `Shoot` call | Base activation clock and payload. Nearly every weapon has this. |
| `windup` | Channel state, charge counter, “hold/charge,” damage/size/speed thresholds | Adds time before payload and selects the achieved charge tier. Prevents full-charge damage on every normal use. |
| `channel` | Held projectile, owner-held state, repeated AI/contact ticks | Scores hits from contact interval × maintained uptime rather than recasting the projectile every use time. |
| `combo` | Use counter, alternating projectile/type, nth-use comparison, “final strike” | Averages deterministic steps over the whole combo; a fifth-hit finisher occupies one fifth of the cycle. |
| `rhythm` / `ramp` | Success/miss counter, repeated-use stacks, damage growth and decay | Computes a steady-state stack distribution or conservative maintained level instead of always using zero or maximum stacks. |
| `release` | Channel-end branch, owner stops using item, “when released” | Pays the release payload once per completed windup/channel cycle, not every tick and not never. |
| `travel` | Projectile speed/lifetime/gravity/homing | Existing landing and reach calculation for the outbound payload. Usually a child of `primary`. |
| `return` | Velocity aims at owner, return state, contact-triggered turnaround, catch condition | Adds a return pass when it can re-hit and sets the real time before a one-out weapon can be used again. |
| `impact` | `OnHitNPC`, collision branch, penetration decrement | Activation source for on-hit children, debuffs, counters, and impact replacements. Its rate cannot exceed landed parent hits. |
| `critical-proc` | HitInfo.Crit branch | Multiplies eligible landed hits by actual loadout crit chance before chance/cooldown handling. |
| `counter-proc` | AI/local/player field increment and comparison/reset, “after N hits/uses” | Activates once per N eligible events. This directly fixes weapons whose burst is currently granted every shot. |
| `kill-proc` | `OnKill`, target death check, “on enemy kill” | Scores zero for a pure single boss unless the boss supplies adds; can contribute in multi-target using an explicit conservative kill rate. Projectile death caused by impact is distinct from enemy kill. |
| `explosion` / `area` | Projectile resize, damage hitbox, explosion helper | One activation with coverage derived from radius and target layout. Damage is not multiplied by flight crossing time. |
| `split` / `cascade` | Child `NewProjectile` calls and loops | Adds children per real parent activation, recursively carrying count, probability, damage share, and landing. Replaces the global flat child cap when evidence is sufficient. |
| `bounce` / `chain` | Bounce counter, nearest-target search, chain limit, per-bounce multiplier | Single target receives only legal repeat contacts; multi-target gains up to the explicit unique-target/bounce cap with falloff. |
| `stick` | Projectile attaches to NPC, local immunity, penetration/lifetime | Separates the initial hit from periodic embedded ticks and respects maximum simultaneous sticks. |
| `tether` / `link` | Linked target state, periodic timer, break range, max-link counter | Scores tick interval × active links. Single uses one link; multi uses `min(available targets, maxActive)`. Recasting maintains links rather than stacking a new full lifetime every use. |
| `mark` / `detonate` | Debuff/marker application followed by marker check or manual detonation | Application does little or no immediate damage; detonation rate is constrained by marked targets and the attack that consumes them. |
| `linger` / `field` | Stationary projectile, finite life, local cooldown, max-owned count | Uses ticks per active field and steady-state concurrent fields. Replaces the blanket `placed` uptime multiplier. |
| `damage-over-time` | Debuff application plus known DoT | Adds DoT once at maintained uptime; repeated applications refresh duration rather than stacking unless code says it stacks. |
| `minion` | Minion flag, slot cost, autonomous AI/projectiles | Concurrent per-slot steady DPS, with chase/target-acquisition uptime and child projectile landing. |
| `sentry` / `trap` | Sentry flag, stationary autonomous AI, slot or owned cap | Concurrent damage with placement/coverage uptime and separate target behavior. |
| `whip-tag` / `support` | Whip tag debuff, summon tag damage, fire-rate modifier | Modifies the minion phase using maintained tag uptime and minion hit rate; is not a free standalone copy of the whip damage. |
| `alternate-fire` | `altFunctionUse`, right-click branches | Root for alternative graphs. Each click has its own time, ammo transformation, range, payload, and resource cost. |
| `ammo-transform` | Consumed ammo type read, projectile replacement, damage/speed conversion | Starts from the selected ammo's damage, then replaces its projectile/attributes exactly once. Prevents scoring both original and transformed ammo behavior. |
| `resource-spend` | Mana, Void, Inspiration, life, charge, or custom meter cost | Limits the activation rate using pool, regeneration, gains, and recovery over the encounter horizon. Ammo is intentionally excluded from resource scarcity. |
| `resource-gain` | Passive regen, hit/kill return, caught projectile, recovery phase | Feeds the same resource schedule. Kill-based gain contributes only where kills are modeled. |
| `cooldown` / `lockout` | Explicit timer, owned projectile cap, recharge buff | Places a ceiling on the parent/child activation rate and creates visible downtime. |
| `exhaustion` / `overheat` | Meter increase per use, threshold, penalty state, cooling rate | Solves normal and penalized portions of the repeating long-fight cycle, rather than applying a permanent arbitrary multiplier. |
| `state-gated` | Required accessory/set flag, buff, stance, target state, stealth | Includes the child graph only when runtime context supplies the state. Unknown external states stay off by default and are reported as unresolved. |
| `transformation` | Projectile/item swaps after threshold, stance/mode transitions | Replaces the affected graph for the state's active fraction; useful for empowered forms and phase-dependent attacks. |

Some properties such as homing, spread, gravity, pierce, wall penetration, and ordinary ricochet are delivery modifiers rather than standalone phases unless they create a separately timed damage event. The UI should avoid turning every projectile property into a phase chip.

### Sustained scoring algorithm

The scorer should compile the phase graph into two evaluations using the same mechanics and different target layouts.

1. Build one graph per player-selectable root (`left click`, `right click`, charged alternative where it is genuinely optional).
2. Apply selected ammo, loadout requirements, difficulty variants, and allowed balancing overlays before evaluating payloads.
3. Establish root use rate from animation/use time, windup, release time, recovery, owned-projectile lockout, and resources.
4. Propagate activation rates through edges:
   - normal trigger: `child rate = parent eligible-event rate`;
   - chance: multiply by probability;
   - threshold: divide by required event count;
   - cooldown: cap at `1 / cooldown`;
   - finite concurrent phase: cap active instances at `maxActive`.
5. Evaluate each damage payload with existing damage, defense, crit, landing, immunity, pierce, and debuff logic.
6. Combine phases by relation. Sum concurrent damage, divide sequential cycle damage by shared cycle time, choose alternatives, replace transformed payloads, and apply modifiers to their targets.
7. Group hits that share NPC immunity and cap the combined group only after all its phases are known. Local/static immunity groups retain independent clocks.
8. Apply target coverage:
   - single: one enemy body, except legal repeat hits on that body;
   - multi: explicit crowd geometry, capped by unique-target/area/chain limits;
   - worm segments are a multi layout, not an implicit third output mode.
9. Solve resources and repeating penalty states over a meaningful long-fight horizon, then return one sustained total. A sensible first implementation is a clamped encounter horizon derived from target health and stage-typical DPS (for example 20–90 seconds), with steady-state used where a stable cycle exists. This lets initial pools matter without allowing a short opening burst to define the whole grade.
10. Return the total plus each phase's contribution, active fraction, activation rate, target count, and evidence. The visible phase contributions must add back to the displayed Real DPS within rounding error.

The compiler should be deterministic. Monte Carlo simulation would make rankings and tests noisy and is unnecessary for independent known probabilities; use expected activation rates and deterministic state cycles. Simulation is only worth considering later for coupled stack systems that cannot be reduced analytically.

### Resource and state handling

Resource mechanics should be modeled as phases because they change how often damaging phases can run:

- Mana: retain the existing regeneration/potion assumption, but express its result as a resource-spend phase and share it across all phases of the selected attack.
- Void: use the mined per-item Void cost, maximum pool, passive regeneration, and on-hit/on-catch gains. Apply both Void and the weapon's underlying subtype modifiers. Do not invent a class-mixing penalty.
- Inspiration: use each instrument's mined cost, maximum inspiration, regeneration/drop assumptions, and relevant equipped bonuses.
- Exhaustion/overheat: build a repeating cycle from gain per use, cooling rate, threshold, penalty curve, and recovery. Report normal versus penalized active fractions.
- Life/health costs: only limit sustained use when the game actually prevents or materially delays continued attacks; healing utility does not become a parallel “DPS-like” score.
- Ammo: selected ammo changes damage/projectile phases, but inventory scarcity and consumption chance do not reduce sustained DPS.

Resources shared by alternate attacks are solved inside each alternative graph. Resources shared by concurrent phases are solved together so two phases cannot each spend the same regeneration budget.

### Evidence and fallback rules

Extraction should prefer, in order:

1. exact code values and conditions;
2. exact numeric tooltip statements when code traversal misses them;
3. structural evidence such as a held projectile or owner-return vector;
4. archetype defaults;
5. a conservative unresolved phase.

Fallbacks should be local to the missing fact. If child damage is known but its frequency is not, keep the damage evidence and conservatively bound only frequency. Do not replace the entire weapon with zero or grant the child once per use. Every fallback should appear in diagnostics and in the detailed phase explanation.

Useful unresolved reports include:

- child projectile with unknown gate/probability/cooldown;
- channel/charge weapon with unknown release cadence;
- persistent projectile without maximum active count;
- custom resource cost or regeneration not extracted;
- inherited projectile effect gated by an unknown equipment flag;
- combo/ramp counter whose increment or reset could not be traced.

These reports create a finite miner-improvement worklist and avoid silently encoding guesses into rankings.

### Concrete examples

#### Suspended Shotgun Shell Launcher

```text
primary shot -> landed hit -> counter (8 hits) -> 8-round child burst + explosion
```

The counter proc rate is `landed primary hits/s ÷ 8`, capped by any code cooldown. The eight children and explosion are multiplied by that proc rate, not by the weapon's use rate. If a miss resets the “in a row” counter, use the landing probability in the run-completion calculation rather than treating any eight eventual hits as sufficient.

#### Luminant Tether

```text
cast/acquire link -> maintained tether (1 tick/s, max 3 links) -> break/reacquire if out of range
```

Single-target uses one active link. Multi-target can use up to three links, capped by available targets. Repeated casts maintain/acquire links and do not create 181 hits from each projectile lifetime. Range affects maintained uptime, not projectile travel pierce.

#### Violin

```text
primary note -> bounce/impact
equipped Mixtape? -> critical-hit child notes
equipped Full Score? -> clap children
```

Only the primary graph is active in a loadout without those accessories. Accessory phases are supplied by the loadout and visibly named there; they must not be inherited as unconditional properties of every Bard projectile.

#### Gel Glove / Lasting Pliers

```text
normal throws -> exhaustion rises -> exhausted penalty throws -> cooling/recovery -> normal throws
```

Gel Glove additionally has windup/charge tiers before release. The long-fight score is the time-weighted damage of the repeating exhaustion cycle. A charge tier trades lower activation rate for higher damage, size, and bounce count and is evaluated as a complete alternative, not as maximum charge damage at uncharged use speed.

#### Urchin Mace

```text
channelled spin/contact -> launch/return mace -> release whirlpool
```

The phases identify it as a mace/flail cycle even if an inherited projectile temporarily has zero velocity. Contact hits and the release payload share the same channel cycle. It should not receive a generic 30% placed-cloud uptime.

#### Combo finisher

For “four normal slashes, then a 150% final slash,” a five-use repeating combo contributes `(4 × normal payload + 1 × finisher payload) / time for five uses`. The finisher is a replacement on the fifth use, not 50% bonus damage on every use and not a separate simultaneous hit unless code spawns both.

### UI plan

The loadout table should remain compact. Each weapon row can show at most two or three high-value phase labels after the existing archetype, such as `charge`, `8-hit proc`, `returns`, `tether ×3`, or `exhaustion cycle`. Do not expose every delivery modifier there.

The item card should show the full phase graph directly above the Real DPS arithmetic. A compact connected strip/list is sufficient:

```text
Use 1.5/s -> Primary shot -> Hit counter 8 -> Burst 8x (0.17 procs/s)
Resource: normal 20 s <-> exhausted 20 s
```

For branches, indent children or draw a thin connector. For concurrent phases, use aligned lanes rather than implying they happen sequentially. Each visible phase should show only its most useful value: activation rate, duration/uptime, target cap, resource state, and DPS contribution. Selecting/expanding a phase can reveal evidence and the detailed existing factor rows.

The card should also state the composition in plain language, for example “burst occurs once per 8 landed hits,” “3 maintained links at 1 hit/s each,” or “accessory proc inactive.” This makes extraction mistakes much easier to spot than a single final number.

The single/multi control changes the target coverage and phase contributions in place. It should not swap to a different phase taxonomy. For example, the Luminant Tether graph stays `cast -> tether`; only active links and contribution change from one to three.

### The parity net (built 2026-09-04, before any scoring change)

`tools/dps-snapshot.mjs` freezes every weapon's Real DPS so the rework can prove it changed nothing:

```
node tools/dps-snapshot.mjs data/dps-parity.json          # freeze
node tools/dps-snapshot.mjs data/dps-parity.json --check  # compare, exit 1 on any move
```

2,678 weapons (2,624 scoring above zero) × three target modes, each graded at its own stage in a fixed loadout-free context — no solver, no gear, no reforge — so nothing outside `dps.js` can move a number. `mode` and the number of `parts` are stored too: a refactor that keeps the total and loses the explanation has still broken something. It runs in 0.3 s.

It was verified to be *sensitive*, not just green: changing `CHILD_CAP` from 1.5 to 1.4 moved 322 weapons and the check named every one. The guide metrics could never do this — a rewrite could move a thousand weapons and leave top-3 unchanged.

A difference is not a failure. Step 2 of the sequence below must show zero; the bug fixes after it are *supposed* to move numbers, and the snapshot is then re-frozen with the moves read and explained.

### How today's model already maps onto phases

The rework is not inventing a structure, it is naming one that is already there and hard-coded. Read against `src/lib/dps.js`:

| today, in `gradeWeapon` | phase | what is missing that the phase form adds |
| --- | --- | --- |
| `rate` from use time / animation / `reuseDelay` | `primary` | — |
| `variantHits` → one group per `fire.calls` entry (`count`, `spread`, `fan`, `dmgMul`) | `travel` children of `primary` | per-call `chance`, `threshold`, `cooldown` |
| `groups` keyed by `c.region`, averaged | `alternative` | which branch actually runs, instead of averaging |
| `clicks` (`c.alt`), scored and the better taken | `alternative` roots | — (already correct) |
| `childHits`, depth ≤ 1, `where: hit/kill/ai` | `impact` / `explosion` / `split` | real spawn rate; `CHILD_CAP` exists only because that rate is unread |
| `CONTACT` path: `60 / local × stacks × inRange` | `channel` | release payload, `maxActive` |
| `cycle: 'flight'` round trip, `item.maxOut` | `travel` + `return` | evidence-based turnaround instead of the flat `THROW_OUT` 300 px |
| `swingHps` added alongside the shot | `primary` (concurrent) | — |
| `ARCHETYPE[arch].uptime` (`placed` 0.3, `yoyo` 0.7…) | `linger` / `channel` | lifetime, cooldown and max-concurrent evidence instead of a blanket constant |
| `ARCHETYPE.whip.tag` = 1.5 | `whip-tag` modifier | maintained tag uptime × real minion hit rate |
| minion / sentry slot branch | `minion` / `sentry` (concurrent) | — |
| `debuffs` → `dot` added at the end | `damage-over-time` | stacking vs refreshing |
| mana `sustain` | `resource-spend` | Void, inspiration, exhaustion through the same door |
| `risk`, `RISK[cls]`, `exposure` | modifier on the graph | — |
| rogue `spam` + `stealth`, added | `alternative` (measured as additive) | — |
| `sharesIframes` → the 10-tick player window cap | `immunityGroup` | per-group clocks instead of one global test |

Two things fall out of reading it this way. The `CHILD_CAP` of 1.5 and the blanket archetype `uptime` constants are both standing in for exactly one missing fact — *how often does this happen* — which is what `chance`, `threshold`, `cooldown` and `maxActive` supply. And the three named over-scoring failures are all the same missing fact: the 8-hit counter is a `threshold`, the tether is a `maxActive`, the Violin's accessory procs are a `requires`.

### Implementation sequence

1. ~~Define and test the phase record schema~~ — done. `src/lib/phases.js`: `PHASE_KINDS`, `RELATIONS`, `TRIGGERS`, `CONFIDENCE`, and `makePhase`, which validates the vocabulary and gives every gate a defined default. The module is description only — it knows what the miner read and how confident that reading is, never what a hit is worth — so the dependency runs one way and `dps.js` keeps owning the arithmetic. 10 unit tests.

2. Convert existing behaviour into phase records without changing results. **Done for delivery, spawns, debuffs, summons and contact — all at 0 of 2,678 weapons moved.** Ammo stays a payload fact on the primary rather than a phase: it changes what a hit is worth, it is not a separate event.
   - `deliveryPhases(fire, { variant, alt, primaryId })` replaces the walk over `fire.calls`: one `travel` record per call plus the default shot, in the order the arithmetic pays for them, with `region` carrying the if/else branch and `relation` naming it (`top` is `concurrent`, every other region is `alternative` — which is where "the model averages branches because it cannot read which one runs" becomes a visible, fixable fact rather than a comment).
   - `spawnPhases(projectile, { variant })` replaces the walk over `children`: one `impact` or `split` record each, carrying the **trigger** (`hit` / `death` / `timer`). That trigger is the gate the model has been missing — a child of an on-hit trigger cannot run more often than its parent lands — and it is what `CHILD_CAP` has been standing in for.
   - Both verified at **0 of 2,678 weapons moved**, in all three target modes, `mode` and `parts.length` included.

   - `debuffPhases`, `summonPhase` and `contactPhase` cover the remaining shapes. A phase record keeps the **mined value raw** and the model applies its reading rule at evaluation — the same split as `dmgMul`, and it is what made the summon bug below visible instead of hiding it inside a helper.

   One trap worth recording, because it is the schema's own point turned against it: `makePhase` first defaulted `dmgMul` with `?? 1`, which folds an explicit `null` ("the miner could not read the share") into `1` ("it does the parent's full damage"). That moved 243 weapons upward. `??` cannot be used for any field where *unread* and *a real value* must stay distinct — the fields that exist precisely to keep them apart. There is a test pinning it.

### First scoring fix out of the rework: negative minion hit rates

`tools/unresolved-phases.mjs` (new) turns the phase records into the miner's worklist: every place a blanket constant stands in for a fact nobody read, ranked by the DPS of the weapons depending on it. Written to `data/unresolved-phases.md`. It found a bug rather than a gap.

A projectile's `local` below zero means "hits a given NPC once and never again" — it is not a rate. Every path in the model reads it through `localOf`, which maps anything at or below zero to unread; the minion/sentry branch was the one place taking it raw, so `60 / -1` became a **negative hit rate**:

| weapon | was | now |
| --- | --- | --- |
| Warloks' Moon Fist | −12,724 | 424 |
| Terraprisma | −8,829 | 294 |
| Arachnid Needlepoint | −3,699 | 123 |
| Sanguine Staff | −2,619 | 87 |

Terraprisma and the Sanguine Staff are guide picks; both scored below zero and came out `unranked`. Isolated guide effect, measured by running the pre-fix code against the same dataset: vanilla top-3 **+4**, top-8 **+4**, recall@K +3, MRR 0.264 → 0.268; calamity top-8 **−3**, recall@K −1; IEoR and SOTS unchanged. The Calamity loss is correct rather than a regression — Warloks' Moon Fist now competes for top-8 slots it could never reach while scoring −12,724. That two-directional movement is what the diagnostic loop asks a fix to predict.

### The worklist the phase records produced

Counts of weapons whose score depends on a number the miner has not read (`data/unresolved-phases.md`):

| what is guessed | weapons | standing in for |
| --- | --- | --- |
| archetype uptime constant | 518 | lifetime, cooldown, max-concurrent evidence |
| child spawns on a clock nobody read | 339 | a real rate instead of "at most one extra hit" |
| spawned projectiles hit the blanket cap | 279 | `CHILD_CAP` +1.5 hits, which is doing the scoring |
| contact weapon with no hit cooldown of its own | 126 | the player's 10-tick window |
| child's damage share unread | 70 | the median guess of 0.5 |
| multiplier over ×4 read as a branch | 21 | a probability |

This corroborates the guide audit from the other side, on the same weapons. `Event Horizon` (24,145/s, held a stage's #1 for 8 tiers in the UNLISTED report) is one of the 279 hitting the child cap; `Ark of the Cosmos` (40,620/s, an EARLY lead) is one of the 339 with an unread spawn clock. The guide disagreement and the unread fact are the same finding reached two ways, which is the strongest evidence available that the fix belongs in the mechanic and not in a tuning constant.
   **Coverage across weapon types.** The conversion was checked archetype by archetype rather than assumed, and it had a hole: a weapon with no projectile got a delivery phase with nothing behind it, which says only that the miner found nothing. **294 of 395 `swing` weapons — the largest archetype in the pool — had no phase describing them at all**, because a broadsword's damage is the blade touching the target and that lived only as `swingHps` inside `dps.js`.

   Three builders close it: `primaryPhase` (the use clock — the root every other phase hangs off, and the only phase every weapon has), `swingPhase` (the blade, as a `contact` phase on the animation's clock, which is what it is), and `returnPhase` (the round trip a one-at-a-time weapon finishes before it can be thrown again). `gradeWeapon` now returns the whole graph as `phases`. All parity-neutral.

   | | before | after |
   | --- | --- | --- |
   | weapons with no phase describing them | ~296 | **24 of 2,679** |
   | archetypes wholly undescribed | swing, shortsword | none |

   Pinned by a test in `test/dataset.test.js`: no archetype may be left with nothing describing it, and the undescribed total may only be lowered deliberately.

   **A modelling bug this surfaced.** `primaryId` was `ammo?.shoot ?? null` — right for a gun or a bow, where the arrow is what flies, and wrong for a flamethrower, whose `useAmmo` is Gel and whose flame is the weapon's own `shoot`. When the ammo did not resolve, the weapon's projectile was discarded and **35 weapons were graded with no projectile at all** — no pierce, no lifetime, no homing. Most of the flamethrowers and a third of the launchers. Falling back to `item.shoot` moved 53 weapons, all upward, and improved the guides in both directions that matter: calamity top-3 **+4**, top-8 +3, recall@K +5, MRR 0.225 → 0.228; ieor +1/+2; vanilla ranged −1/−2, where vanilla's own flamethrowers now displace two picks.

3. Add relation semantics and invariants: alternatives never sum, replacements do not double-count, sequential time is paid once, and phase contributions equal the total.

4. Extraction of the gates. **`chance` done; threshold, cooldown, maximum-active and loadout-requirement still open.**

   `NextBool` was being read as `UNKNOWN`, so a one-in-ten branch was a certainty — the reason Calamity can pay a rare projectile fifteen times the weapon's damage and the reason the model had to treat any multiplier over ×4 as unreadable. The rarity was the missing part, not the damage.

   `miner/extract/guards.js` (new) holds the shared reading: `guardRanges` moved out of `shoot.js` so the projectile side can use it without a cycle, plus `chanceRanges` and `chanceAt`. Applied on both sides — `Shoot` calls and projectile children, the latter per method since a projectile's children come from its AI, its OnHitNPC and its OnKill with separate offsets. A call the miner priced a roll for is no longer treated as an *alternative* to be averaged against its siblings: it happens, with known odds, which is the right answer twice over.

   Yield: 12 shoot calls across 8 weapons, 26 projectile children. Small, because most `NextBool` guards in `Shoot` protect a sound or a dust rather than a projectile — 53 of the 63 found guard blocks seven bytes long. **13 weapons moved, every one of them down, and only weapons that got a priced roll:**

   | weapon | was (auto/multi) | now |
   | --- | --- | --- |
   | Prime's Fury | 1,820 / 5,895 | 1,186 / 1,920 |
   | Galvanizing Glaive | 2,873 / 2,298 | 1,556 / 981 |
   | Light God's Brilliance | 525 / 3,052 | 525 / 1,681 |
   | Catharsis | 9,540 / 8,324 | 8,659 / 7,442 |
   | Winter's Fury | 354 / 278 | 168 / 109 |

   Eight of the thirteen are **not** guide picks: `Prime's Fury` held a stage's #1 for 9 tiers in the UNLISTED worklist and `Catharsis` was a staging lead at 10,822/s. Lowering those frees top-8 slots the guides' own picks want. The other five are guide picks that got quieter, which is the cost of reading the odds honestly.

   A second trap worth recording: `miner/mine.js` whitelists which call fields are serialized, so the first mine extracted `chance` correctly and then dropped it on the way to `data/dataset.json`. Extraction working and the field arriving are two separate things to check.

5. Add persistent/tether/linger and channel/release graphs, replacing blanket archetype uptime where evidence exists. **Blocked on extraction that does not exist yet** — measured, not assumed:

   | archetype | weapons | with a mined projectile lifetime | with `maxOut` |
   | --- | --- | --- | --- |
   | held | 155 | 55 | 30 |
   | minion | 154 | 99 | 17 |
   | yoyo | 57 | **0** | 1 |
   | sentry | 56 | 56 | 2 |
   | placed | 51 | 27 | 1 |
   | truemelee | 36 | 16 | 15 |
   | flail | 9 | **0** | 0 |

   "Where evidence exists" is the operative clause. `ownedCapOf` (in `guards.js`) now reads `player.ownedProjectileCounts[type] < N` from **both** `CanUseItem` (where `maxOutOf` already read it) and the projectile's own `AI`, and `maxActive` is emitted on the projectile record. It found 57 projectiles — and almost none of the archetypes that need it: `placed` 1 of 51, `yoyo` 1 of 57, `flail` 0 of 9. **That shape is not where those caps live**; a cloud that limits itself usually scans `Main.projectile[]` and kills the oldest, which is a much harder read.

   What it did fix is a flat ceiling that was never a game fact at all. The contact path capped concurrent instances at **4**, chosen for nothing; where the weapon states its own cap, that is the number. 15 weapons moved, all down:

   | weapon | arch | says | was | now |
   | --- | --- | --- | --- | --- |
   | Sword of the Zenith | truemelee | 1 out at a time | **434,820** | 178,659 |
   | First Fractal | held | 1 | 25,303 | 14,653 |
   | Scythe of the Abandoned God | held | 1 | 20,726 | 9,501 |
   | Hellion Flower Spear | truemelee | 1 | 1,546 | 708 |

   Sword of the Zenith was the largest number in the entire dataset and the top row of the blanket-uptime worklist; its own `CanUseItem` says `ownedProjectileCounts < 1` and the model was giving it four.

   **The persistence model is built, and it fires on nothing.** A weapon you *hold* has what it threw this use; a weapon you *place* leaves it behind, so what is on the boss is a lifetime's worth of casting bounded by whatever cap the code states — `alive = min(cap, life × perUse / useTicks)`, replacing `perUse` for `placed` and `spikyball`. It is gated on the cap being **read**, and no `placed` weapon in the pool has both a lifetime and a stated cap, so 0 of 2,679 weapons move. That is the extraction gap measured rather than asserted.

   Ungating it was tried and is wrong: letting a cloud accumulate to the flat ceiling of four merely because it lives a long time took **Goozmaga's crowd score from 129,868 to 343,209**, inflating the archetype that is already the most over-scored. It replaces one guess with a bigger one, aimed the wrong way. Unread stays pessimistic.

   **The premise itself is only half-achievable, and this is the finding that matters.** The blanket `placed` 30% is not one fact but the *product* of two: how many clouds are alive, and how often the boss is standing in one. Code can answer the first. Nothing in the assembly answers the second — it is a claim about how a fight goes. So even a perfect `Main.projectile[]` scan-and-kill extractor would only license replacing half the constant, and replacing half of a product while leaving the other half at a value that was fitted to the *whole* product is how a number gets worse while looking better. Whoever picks this up should decide what the positional half is worth **before** extracting the concurrency half, not after.

   **Verdict: step 5 should be closed as investigated, not left pending.** Three attempts, each measured and each reverted:

   1. *Accumulate to the flat cap when the lifetime allows it.* Took Goozmaga's crowd score from 129,868 to 343,209 — a guess replacing a guess, aimed at the archetype that is already most over-scored.
   2. *Gate accumulation on a mined cap.* Correct, and fires on **0 of 2,679 weapons**: no `placed` weapon has both a lifetime and a stated cap. `ownedProjectileCounts` is not how these weapons limit themselves.
   3. *Derive the uptime from geometry* — boss walks out of the cloud at its own speed, `(cloud + boss width) / boss speed` against the use interval. Principled, and it pinned at 1.0 for nearly every weapon, raising all 38 placed weapons by a uniform ×3.33 (exactly 1/0.3). It assumes each placement lands on the boss and the boss then loiters in it; the blanket 0.3 encodes the opposite, and the blanket is closer to the truth.

   Channel/release is empty too: only **3 weapons** in the pool are contact weapons whose held projectile spawns anything on death (Star of Destruction, Primordial Ancient, Bow of Light). Not a mechanic worth a scoring change.

   So the blanket archetype uptimes stay, and they should be understood for what they are: a *fitted product* of "how many are out" and "how often the boss is in one", where the game's code answers neither. That is not a gap waiting on an extractor. Anyone revisiting it should treat it as a calibration question — measure a few weapons in game and fit the constant — rather than an extraction one. Channelled weapons are still identified in the graph (`item.channel`, 469 weapons, 208 with a held primary) in case that changes.
6. Add custom resources, charge tiers, combos/ramps, and repeating exhaustion states.
7. Render the compact row labels and detailed item-card phase graph.
8. Compare guide section metrics and inspect largest phase deltas. Keep changes that correct mechanics even when aggregate top-k is neutral; investigate metric-only gains that have no mechanical explanation.

### Validation invariants

- A one-phase fixture scores identically before and after the refactor.
- No child activation rate exceeds its eligible parent-event rate unless its explicit count is greater than one.
- A chance is applied once, a threshold is applied once, and a cooldown caps rather than multiplies frequency.
- Alternative clicks never add together.
- Replacement payloads never coexist with the payload they replace.
- Reapplying a non-stacking DoT refreshes it and does not add another full DoT.
- Active tether/stick/field/summon counts never exceed their explicit cap.
- Shared-immunity phases are capped as a group; local-immunity phases keep independent rates.
- Multi-target contribution never exceeds explicit target, bounce, chain, pierce, or area-coverage limits.
- A loadout-gated phase contributes zero when the requirement is absent.
- Resource demand cannot exceed the pool/regeneration/recovery schedule used by the score.
- Displayed phase contributions sum to Real DPS within rounding tolerance in both target modes.
- Every inferred or unknown cadence appears in the unresolved-mechanics report.

## Miner worklist the guide track produced

These are extraction leads, not scoring changes, and they cap what any guide metric can reach:

1. Thorium's healing weapons are missing from the dataset (209 unresolved IEoR healer groups). Decide whether a zero-damage healing weapon belongs in the item set at all — if it does, it still must not enter the weapon DPS ranking.
2. Vanilla item coverage is incomplete (47 unresolved vanilla weapon picks, including `Coin Gun`). Check `miner/extract/vanilla.js` against the wiki's item list before trusting the vanilla guide's denominator.
3. `data/guide-late-weapons.md` is the staging worklist. The clearest cluster: seven Calamity Exo/Draedon weapons staged at 90 (`craft: Dubious Plating`) that the guide lists from tier 20 onward, and a run of items staged at `Eye of Cthulhu` that the guides put pre-boss.

## Worktree caution

The repository is broadly dirty, with staged, unstaged, and untracked work across data generation, miner extraction/staging, scoring, UI, tests, documentation, and package files. User-owned changes include miner extraction/staging files, `src/app.css`, `src/components/ItemBrowser.svelte`, `src/lib/dataset.js`, and new `RangeFilter.svelte`/`tools/find-str.mjs`, among others. Do not infer ownership from `git status` alone. Inspect `git diff`, `git diff --cached`, and the exact surrounding code before every overlapping patch; preserve unrelated hunks and patch narrowly. This session did not reset or delete anything.
