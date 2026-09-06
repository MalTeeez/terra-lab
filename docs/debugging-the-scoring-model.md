# Debugging the scoring model

A field guide for the next person who looks at a number and thinks "that can't be right".

Everything here is drawn from a long run of exactly that: a player pointing at a weapon, and the
work of finding out whether the model or the game was wrong. It is written as method, not as a tour
of the code — `rework-weapon-scoring.md` is the design record and its progress log is the changelog.

---

## 1. The loop

Every fix in that log came out of the same six steps. Skipping one is how you ship a confident
wrong answer.

1. **Reproduce the number**, in isolation, with the parts list.
2. **Find the term.** The parts multiply out to the score by construction — one of them is the
   culprit and you can read it off.
3. **Find the fact.** Go to the IL. Decide what the game actually does, in the game's own units.
4. **Fix it where the fact enters**, not where it surfaced.
5. **Measure the blast radius** before believing the fix.
6. **Decide**, on evidence, and write down what it cost.

The rest of this document is those six steps in detail.

---

## 2. Reproduce it

The parts list is the whole debugger. `weaponDps` returns `parts` (and `stealthParts` for a rogue
grade), and they are built so that the chain multiplies out to `value`. If a weapon is wrong, one of
those lines is wrong, and you can usually name it before reading any code.

A throwaway probe beats adding logging:

```js
import { readFileSync } from 'node:fs';
const { indexDataset } = await import('file:///.../src/lib/dataset.js');
const { weaponDps }    = await import('file:///.../src/lib/score.js');
const ds = indexDataset(JSON.parse(readFileSync('data/dataset.json')));
const it = ds.items.find((x) => x.name === 'Harpy\'s Barrage');
const v  = weaponDps(it, { ds, stage: it.stage, prefix: null,
                           loadout: { damage: 0.2, crit: 15 }, stealthMax: 1, conds: new Set() });
console.log(v.value, v.mode);
for (const p of (v.mode === 'stealth' ? v.stealthParts : v.parts) ?? []) console.log(p.mul ?? p.value, p.label);
```

Three things that will waste your time if you do not know them:

- **Print the whole parts list.** Truncating it with `head` hid a working fix for twenty minutes:
  the correction was pushed *after* the landing terms, and the `×6 every 10 ticks` line at the top
  always shows the raw `rate`, never the corrected `useRate`.
- **Check the grade.** A rogue weapon is scored as the better of `spam` and `stealth`; read
  `v.mode` first, then the matching parts array. Reading the wrong one makes a working term look
  missing.
- **The loadout matters.** Rankings shift with it. `tools/guide-check.mjs --why "<weapon>"` uses the
  solver's own loadout for that stage, which is what the app shows.

For ranking questions, build the ladder rather than eyeballing one weapon — "is this weapon too
strong" is nearly always really "is this *class* out of line", and the answer looks like this:

```
stage   melee  ranged   magic   rogue    bard
    0     121     202      58      90     334   ← bard is the outlier, and it is one weapon
```

---

## 3. Find the term, then find the fact

Once you know which multiplier is wrong, go to the IL. `tools/il-dump.mjs` is the whole toolkit:

```sh
node tools/il-dump.mjs ThoriumMod GelGlove              # list a type's methods
node tools/il-dump.mjs ThoriumMod GelGlovePro AI        # dump one method, operands resolved
node tools/il-dump.mjs CalamityMod --grep HomeInOnNPC   # every method mentioning a member
node tools/find-str.mjs InfernalEclipseAPI HarpiesBarrage   # which method contains a string
node tools/il-dump.mjs tml Terraria.Projectile Damage   # vanilla is readable too, and often the answer
```

**Read vanilla when the mod's own code does not explain it.** Two of the clearest bugs in the log
were vanilla behaviour no mod file mentions:

- `Projectile.Damage()` reverses an `aiStyle 3` boomerang on its first hit, so its `penetrate` is
  not a path through a crowd. 41 of 47 boomerangs carried a pierce they cannot use.
- The same method's `else if (npc.immune[projectile.owner] != 0) continue;` is why a volley of
  projectiles without `usesLocalNPCImmunity` lands **one** hit between them.

### The bug classes that actually turned up

Ranked by how often they bit. If you have a wrong number and no hypothesis, walk this list.

| Class | Tell | Example |
| --- | --- | --- |
| **Units** | a term is off by a clean factor — `(1+updates)`, `(1+updates)²`, px/update vs px/tick | `gravityK` is per *update* and `flight` was in ticks; the homing gate compared a per-update step against a per-tick boss speed |
| **A time-varying field folded to its spawn value** | a branch "later in its life" is never walked | `timeLeft` is 180 and the AI homes inside `if (timeLeft < 150)`: the guard folded and 26 projectiles lost their homing. See `MUTATES` in `projectiles.js` |
| **A renamed hook** | one class is far worse-read than the others | Thorium bards override `BardShoot` and `CanPlayInstrument`, not `Shoot`/`CanUseItem`; bard shot-call coverage was 16% against 52–62% everywhere else |
| **A wrapper method read instead of the real one** | the reader finds a method but it is 18 bytes | `BardItem.Shoot` forwards to a virtual `BardShoot` with an identical signature |
| **A guard dropped from a conditional read** | one branch's value applied to both | `ModifyShootStats` swapping the projectile only when `altFunctionUse == 2`; 18 weapons were scored with their right click's projectile on the left |
| **The first match instead of the governing one** | an off-by-a-lot cap or constant | `ownedCapOf` returned the right click's "≥ 1" rather than the left click's cap of 6 — both spell `bge` |
| **A misread constant amplified downstream** | a fix makes one weapon absurd | a boomerang's return acceleration read as `gravityK: 5`; harmless until the gravity units were fixed, then it dropped the thing 300 px in three ticks |
| **Two facts multiplied that should add** | scales with an unrelated count | pierce through `segments` × lingering repeats said one projectile lingers its whole life on *every* worm segment |

### Sanity checks that pay for themselves

- **`grep` the flag you are about to trust.** `held`, `bounces`, `returns`, `still`, `local`,
  `windup` are all facts the record either states or does not.
- **Count how often a new signal fires** before believing it. A detector that matches 3 projectiles
  is precise; one that matches 129 is measuring something else. Both happened in this run.
- **Look at what the number *should* be** from the item's own stats. `damage × 60 / useTime` is the
  paper DPS; if the model is 4× that, the multipliers are the story, and if it is 0.6× that is just
  the model's systemic pessimism (see §5).

---

## 4. Fix it where the fact enters

In order of preference:

1. **The miner**, if the fact is in the game's code. This is where most of these belong.
2. **The model**, if the fact is read correctly but priced wrongly.
3. **A knob**, only with a comment naming what retires it, and a row in the registry in
   `rework-weapon-scoring.md`.

There is no override file, deliberately. If a weapon is wrong, something upstream is wrong.

### Do not write a skip-list

The single most useful discipline in this run. When a rule needs narrowing, narrow it on **facts
the record already carries**, not on the names of the things it breaks.

The worked example is the projectile-cap rate limit. `maxOut / life` is the right idea and the first
attempt **zeroed ten weapons**. The temptation is a list of exclusions. What actually worked was
three conditions, each a fact and each with a reason:

```js
item.maxOut > 1          // a cap of ONE is the "only one at a time" idiom a held beam and a
                         // boomerang use, and both are scored on other arms entirely
&& !item.useAmmo         // the cap counts Item.shoot, but an ammo weapon's primary is the round's
                         // projectile — that mismatch is what zeroed Firestorm Cannon
&& !p.returns && !p.bounces   // a projectile that comes home or ricochets away frees its slot
                              // before its timer does
```

That took it from 10 wrongly-zeroed weapons to 2 correctly-bounded ones. Every clause is checkable
and says why it is there.

The same shape appears throughout: gravity versus a steering blend is settled by **which axis** the
write touches (gravity only ever moves Y); held versus thrown is settled by **`bounces`** (a held
projectile does not ricochet); an orbiting ring is settled by a **conjunction of three** existing
facts rather than by naming the weapon.

### Placement is a form of narrowing

Sometimes the right guard is *where you put the code*. The projectile-cap rule lives in the
use-clock arm of the rate calculation, so contact weapons never reach it — no condition needed. Look
for an existing branch that already means what you want before adding a test.

---

## 5. Measure before you believe it

Four instruments, in increasing order of authority.

### The test suite

`bun test`. Fast, and it pins behaviour deliberately. If a change breaks a test, **read the test** —
several times in this run the test was right and the change was wrong (summing a volley's misses;
making a blast a widening rather than a floor; a spear's two passes are not two sweeps through a
crowd). Twice the fixture was genuinely stale and updating it was correct — say so in the diff.

### The guide gate

```sh
node tools/guide-check.mjs --no-write --json after.json --vs before.json
node tools/guide-check.mjs --pre --no-write --summary        # the pre-hardmode tuning set
node tools/guide-check.mjs --guide ieor --cls bard --no-write
node tools/guide-check.mjs --why "Scourge of the Desert" --stage 12
```

It exits 1 on a regression unless you pass `--waive "reason"`, which records the reason into the
snapshot. Waive with an explanation; do not silence.

**Isolate the change.** Comparing against a snapshot taken before an unrelated edit measures the
edit. When several changes are in flight, toggle one at a time against a frozen copy of the tree and
the dataset — a scratch copy of `src`, `tools`, `data` and `miner` is enough to run `guide-check`
in, and it keeps the real tree stable while you compare.

### The in-game trials

`data/observed.json` + `node tools/observed.mjs`. The most valuable thing in the repo and the most
under-filled. **A reading from the game outranks the guide metric**, and three times in this run a
one-line report settled something the metric could not:

- "one batch does about ~1100 to a single target" → the seeker collapse was inverted for homing
  projectiles.
- "we don't even see that homing, but it's there, it's only slight" → a units bug switching homing
  off entirely for 36 seekers.
- "it bounces back to the player after the first hit enemy" → vanilla's `aiStyle 3` reversal.

When you get a reading, **record it**, including what you could not determine. A trial whose loadout
was not captured is still worth having if you say so — and prefer *ratios*, which are loadout-free:
a weapon's stealth damage over its non-stealth damage pins `stealthMultiplier` without knowing the
gear, provided you also note Max Stealth (which is the sum of `rogueStealthMax` across worn armour,
and which the solver already computes).

The median `model/observed` is currently **0.61×** — the model under-predicts across the board. Use
that as the yardstick: a weapon sitting at 0.6 of a measured number is *normal*, and one sitting at
1.0 is suspicious, because it is probably being flattered by an error that cancels the systemic
pessimism. That is exactly what Fishbone Boomerang turned out to be.

### The sweep

Score every weapon before and after and diff the distribution: how many moved, cut versus raised,
the median ratio, and the extremes. The extremes are where the collateral hides — the ×6 gains and
the ×0 losses are what tell you a rule is too broad. This is how the ten zeroed weapons surfaced.

---

## 6. Decide, and write down the cost

Three principles, learned the hard way.

**A guide metric that measures a different axis cannot validate you.** Reading `BardShoot` correctly
made bard's damage model strictly sharper and made bard agreement *worse*. That is diagnostic, not a
regression: a sharper reading of one axis moves away from a ranking made on another. Say which it is
and keep going.

**Right for the wrong reason is still wrong.** Fishbone Boomerang matched a measured ~100/s *because*
a held mis-tag exempted it from every landing term, cancelling the model's 0.6× pessimism. Fixing
the tag made the number worse against the one reading available — and was still correct. Note the
trade explicitly and let the owner decide.

**A reshuffle is not a regression.** The gate counts a guide pick climbing above *another guide pick*
in the same section as a loss. Check what actually moved before waiving or reverting; several times
the "regression" was the model getting a weapon right.

Then write the row. Every change in the progress log carries what moved, what it cost, and what is
still unread. The rows that name their own gaps are the ones that were still useful a week later.

---

## 7. Things that will trip you

- **The tree may be shared.** Another session editing concurrently produced phantom failures more
  than once — including four staging tests that passed in isolation. Before blaming your change,
  re-run the suite alone, or revert your diff and check the failure persists. File mtimes tell you.
- **`data/dataset.json` is generated.** Re-mine after any miner change (`node miner/mine.js`, ~20 s;
  Bun segfaults on the full mine). Mine to a scratch path first if you want to compare datasets.
- **The dataset assembler whitelists fields.** A new field on an item or projectile record needs
  adding in `miner/mine.js` (and `fireRecord` for `fire.*`) or it silently never reaches the model.
  This cost time three separate times: `exhaust`, `altMods`, `inspiration`.
- **Line endings.** The repo is CRLF. Python `str.replace` with `\n` anchors silently no-ops; use the
  editor tooling or read the file's own newline first.
- **Absence and zero are different facts.** `ownAi: false` means "the walk looked and found none";
  `undefined` means "nothing looked" (a vanilla projectile, a test fixture). Rules that conflate them
  break on synthetic records — a test catches this one, which is why it exists.
- **`unresolved-phases`** (`node tools/unresolved-phases.mjs`) lists what the model is guessing at.
  It is the standing to-do list, and a good place to start if you have no specific complaint.

---

## 8. A worked example, end to end

> "the gel glove for the rogue class in pre hardmode seems scored way too high"

1. **Reproduce**: 97 DPS at King Slime. Parts show `×3.33 every 18 ticks`, `×0.98 arc drops 2 px`.
2. **Term**: the clock. 3.3 fully-armed throws a second.
3. **Fact**: `GelGlovePro.AI` sets `Projectile.friendly = DoneCharging` — the ball is parked on the
   player dealing nothing until release — and pins `itemTime` so the use time never comes round.
   While reading it: `ThoriumGlobalItem.Shoot` charges `useTime * 2` exhaustion against a bar of
   1200 regenerating at 1/tick, which *no* Thorium thrower was paying.
4. **Fix at the source**: `projectile.windup` in the miner (a projectile that switches its own
   `friendly` on partway through its life); `item.exhaust` from `ThoriumItem.isThrowerNon`, priced
   as a pool beside mana and void.
5. **Measure**: 41 weapons carry exhaustion, not one. The gravity unit bug found on the way exposed
   a *second* bug — `gravityK: 5` on a boomerang was a steering blend, harmless until the units were
   right.
6. **Decide**: Gel Glove 97 → 21. The exhaustion pass cost real guide agreement, which was waived
   with the reason, and two follow-ups (the reservoir, the stealth loop paying its own rate) later
   recovered it.

One complaint, five bugs, three of them nothing to do with the weapon that was reported.
