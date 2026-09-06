<script>
  import { CLASS_LABELS, accentOf, eraOf, stageEras } from '../lib/dataset.js';
  import { fly } from 'svelte/transition';
  import { setPlaystyle, toggleIn, ui } from '../lib/state.svelte.js';
  import { ENGAGE, PLAYSTYLE, bossOf, targetStages } from '../lib/dps.js';
  import Info from './Info.svelte';
  import BossIcon from './BossIcon.svelte';

  let { ds, calibration } = $props();
  const eras = $derived(stageEras(ds.stages));
  const contentMods = $derived(ds.mods.filter((m) => m.equipment > 0));
  // Dragging fires an input event per stage and each one is a whole solve, so a drag across the run
  // spent seconds solving stages the cursor had long passed. Same deal as RangeFilter: the drag
  // moves a draft, everything that names the stage follows it live, and the solve happens on release.
  let draft = $state(null);
  function slide(e) {
    const v = +e.currentTarget.value;
    if (e.type === 'change') { draft = null; ui.stage = v; } else draft = v;
  }
  const shown = $derived(draft ?? ui.stage); // what the slider row names while a drag is in flight
  const stage = $derived(ds.stages[shown]);
  const era = $derived(eraOf(stage));

  function toggleMod(id) {
    const set = new Set(ui.excludedMods);
    if (set.has(id)) set.delete(id); else set.add(id);
    ui.excludedMods = [...set];
  }
  function stepStage(d) {
    ui.stage = Math.max(0, Math.min(ds.stages.length - 1, ui.stage + d));
  }
  const COND_LABELS = { expert: 'Expert', master: 'Master', revenge: 'Revengeance', death: 'Death', malice: 'Malice', eternity: 'Eternity', infernum: 'Infernum', bossrush: 'Boss Rush' };
  const ownedCount = $derived(Object.keys(ui.owned).length);
  const STYLE_LABELS = { sniper: 'Sniper', rapid: 'Rapid', nuke: 'Nuke', spray: 'Spray', spam: 'Spam', stealth: 'Stealth' };
  // classes whose engagement distance the player can choose, in the order the class picker shows them
  const styleClasses = $derived(ds.classList.filter((c) => PLAYSTYLE[c]));
  // the boss weapons are scored against; `null` follows the gamestage (the boss you fight next)
  // …with how many bodies each one puts in front of you, since that is what pierce is scored on
  const targets = $derived(targetStages(ds).map((s) => {
    const b = bossOf(ds, s.index);
    return { ...s, bodies: b.worm ? `${Math.min(b.parts, 8)} segments` : b.parts > 1 ? `${b.parts} parts` : '' };
  }));
  // how many bodies the fight puts in front of you: what pierce is worth hangs off this
  const TARGET_MODES = [
    ['auto', 'Auto', 'Score against the fight as it is: a worm gives its segments, a single boss does not.'],
    ['single', 'Single', 'Single-target: one body, whatever the boss really is. What a pure boss-killer is worth.'],
    ['multi', 'Multi', 'Multi-target: a worm, an event wave, a boss with adds. Pierce and lingering shots pay off here.'],
  ];
  const accent = $derived(accentOf(ui.cls));
  // at the last stage there is no next boss: the default target stays the last one (see dps.boss)
  const nextTarget = $derived(ds.stages[Math.min(ui.stage + 1, ds.stages.length - 1)] ?? null);

  /** Everything currently bending the result, as chips you can click off. */
  const active = $derived.by(() => {
    const a = [];
    for (const c of ui.conds) a.push({ label: COND_LABELS[c] ?? c, clear: () => toggleIn('conds', c) });
    for (const k of ui.seeds) a.push({ label: ds.seeds.find((s) => s.key === k)?.label ?? k, clear: () => toggleIn('seeds', k) });
    if (ui.source === 'owned') a.push({ label: `only my gear (${ownedCount})`, clear: () => (ui.source = 'all') });
    if (ui.reforge === 'none') a.push({ label: 'no reforges', clear: () => (ui.reforge = 'best') });
    else if (ui.reforge !== 'best') a.push({ label: `all ${ds.prefixById.get(ui.reforge)?.name ?? ui.reforge}`, clear: () => (ui.reforge = 'best') });
    if (ui.requireSet) a.push({ label: 'full armor set', clear: () => (ui.requireSet = false) });
    if (ui.slots !== 6) a.push({ label: `${ui.slots} accessory slots`, clear: () => (ui.slots = 6) });
    if (ui.unknownStage) a.push({ label: 'unknown-stage items', clear: () => (ui.unknownStage = false) });
    if (ui.uncertain) a.push({ label: 'uncertain modifiers', clear: () => (ui.uncertain = false) });
    for (const [c, k] of Object.entries(ui.playstyle ?? {})) if (PLAYSTYLE[c]?.[k]) a.push({ label: `${CLASS_LABELS[c] ?? c}: ${STYLE_LABELS[k] ?? k}`, clear: () => setPlaystyle(c, null) });
    if (ui.target !== null && ds.stages[ui.target]) a.push({ label: `vs ${ds.stages[ui.target].label}`, clear: () => (ui.target = null) });
    if ((ui.targets ?? 'auto') !== 'auto') a.push({ label: ui.targets === 'single' ? 'single target' : 'multi-target', clear: () => (ui.targets = 'auto') });
    if (ui.excludedMods.length) a.push({ label: `${ui.excludedMods.length} mods off`, clear: () => (ui.excludedMods = []) });
    if (ui.pinned.length) a.push({ label: `${ui.pinned.length} pinned`, clear: () => (ui.pinned = []) });
    if (ui.excluded.length) a.push({ label: `${ui.excluded.length} excluded`, clear: () => (ui.excluded = []) });
    if (ui.calibrate && calibration?.sampleCount) a.push({ label: `calibrated ×${Math.round((calibration.factors.all ?? 1) * 100) / 100}`, clear: () => (ui.calibrate = false) });
    return a;
  });
</script>

<!-- no wash on the sticky wrapper: over the backdrop its 60% paper drew a hard-edged frame around
     the panel. The panel below frosts itself, which is all the separation a floating bar needs. -->
<div class="sticky top-0 z-30 px-5 pb-2.5 pt-2">
  <section class="lab-panel lab-controls px-4 py-2.5 backdrop-blur" style="--accent:{accentOf(ui.cls)}; background-color:rgb(255 255 255 / 0.92); box-shadow:var(--shadow-panel), 0 6px 12px -8px rgb(22 40 26 / 0.45)">
    <!-- who the loadout is for (left) · extra panels (right); the view tabs live in the header -->
    <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div class="flex flex-wrap items-center gap-2">
        <span class="lab-label shrink-0">Class</span>
        <div class="flex flex-wrap gap-1">
          {#each ds.classList as c}
            <button class="lab-chip" style="--accent:{accentOf(c)}" aria-pressed={ui.cls === c} onclick={() => (ui.cls = c)}>{CLASS_LABELS[c] ?? c}</button>
          {/each}
        </div>
      </div>

      <div class="flex gap-1">
        <button class="lab-btn" aria-pressed={ui.panel === 'gear'} onclick={() => (ui.panel = ui.panel === 'gear' ? null : 'gear')} title="Items you own, pins and exclusions">
          My gear {#if ownedCount}<span class="num text-green-deep">{ownedCount}</span>{/if}
        </button>
        <button class="lab-btn" aria-pressed={ui.panel === 'calibrate'} onclick={() => (ui.panel = ui.panel === 'calibrate' ? null : 'calibrate')} title="Fit predictions against damage numbers from the game">
          Calibrate {#if ui.samples.length}<span class="num text-green-deep">{ui.samples.length}</span>{/if}
        </button>
        <button class="lab-btn" popovertarget="opts" title="Change the solver assumptions, the difficulty and which mods count">⚙ Options</button>
      </div>
    </div>

    <!-- when in the run you are, and which boss the weapons are scored against -->
    <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
      <!-- min-w has to cover this row's own fixed parts (buttons, slider, era label) plus a readable
           select, or the select — the thing you actually read — is what gets squeezed to nothing -->
      <div class="flex min-w-[620px] flex-[3] items-center gap-2" style="--accent:{era.color}">
        <span class="lab-label inline-flex shrink-0 items-center gap-1">
          Stage
          <Info label="Gamestage" w={340}>
            <p>Everything that is <em>obtainable once you have beaten this boss</em> — the loadout is solved from exactly that pool.</p>
            <p>Drag the slider to walk a run forward; “All stages” shows where the loadout actually changes.</p>
          </Info>
        </span>
        <button class="lab-btn shrink-0 px-2" onclick={() => stepStage(-1)} title="Go back one gamestage" aria-label="Previous stage">‹</button>
        <BossIcon {ds} stage={shown} size={20} />
        <select class="lab-input min-w-[190px] flex-1" value={shown} onchange={(e) => { draft = null; ui.stage = +e.currentTarget.value; }} title="{shown === 0 ? stage.label : `Post ${stage.label}`} — everything obtainable by this point">
          {#each eras as e}
            <optgroup label={e.label}>
              {#each e.stages as s}
                <option value={s.index}>{s.index === 0 ? s.label : `Post ${s.label}`}{s.mod !== 'v' ? ` · ${ds.modById.get(s.mod)?.name ?? s.mod}` : ''}</option>
              {/each}
            </optgroup>
          {/each}
        </select>
        <button class="lab-btn shrink-0 px-2" onclick={() => stepStage(1)} title="Go on to the next gamestage" aria-label="Next stage">›</button>
        <input type="range" min="0" max={ds.stages.length - 1} value={shown} oninput={slide} onchange={slide} onblur={slide} class="w-[130px] shrink-0" aria-label="Gamestage" />
        <!-- fixed width: the era name and the stage number change length, and the select next to it
             is flex-1, so letting this box resize slid the slider out from under a held cursor -->
        <span class="w-[140px] shrink-0 truncate text-[11.5px]" style="color:{era.color}" title="{era.label}">
          {era.label} <span class="num text-dim/70">{shown}/{ds.stages.length - 1}</span>
        </span>
      </div>

      <div class="flex min-w-[420px] flex-[2] items-center gap-2">
        <span class="lab-label inline-flex shrink-0 items-center gap-1">
          Scored vs
          <Info label="Target boss" w={360}>
            <p>Real DPS is computed against one boss: its size decides how much of a spread lands, its defense eats half a point of every hit, and what it is immune to decides whether a debuff counts.</p>
            <p>By default that is the boss you fight next at this gamestage. Pick another one to see how a weapon holds up against it — a wide, slow, many-segment worm rewards very different weapons from a small, fast, armoured one.</p>
          </Info>
        </span>
        <select class="lab-input min-w-[160px] flex-1" bind:value={ui.target}>
          <option value={null}>Assume next boss{nextTarget ? ` · ${nextTarget.label}` : ''}</option>
          {#each targets as s}
            <option value={s.index}>{s.label}{s.mod !== 'v' ? ` · ${ds.modById.get(s.mod)?.name ?? s.mod}` : ''}{s.bodies ? ` · ${s.bodies}` : ''}</option>
          {/each}
        </select>
        <span class="flex shrink-0 items-center">
          {#each TARGET_MODES as [k, label, hint]}
            <button class="lab-chip" style="--accent:{accent}" aria-pressed={(ui.targets ?? 'auto') === k} title={hint} onclick={() => (ui.targets = k)}>{label}</button>
          {/each}
        </span>
      </div>
    </div>

    <!-- always rendered: letting this row appear and vanish shoved the whole page up and down -->
    <div class="mt-2 flex min-h-[23px] flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line pt-2">
      <span class="lab-rule start w-[70px] shrink-0">Active</span>
      {#each active as a (a.label)}
        <button class="lab-active" onclick={a.clear} title="Turn this setting off" transition:fly={{ y: -4, duration: 130 }}>{a.label}</button>
      {:else}
        <!-- same box as a chip (border + padding), or the row grows by 8px the moment the first one
             appears and shoves the page down -->
        <span class="border border-transparent px-2 py-[3px] text-[11.5px] text-dim/70">nothing changed from the defaults</span>
      {/each}
    </div>
  </section>
</div>

<!-- everything you set once and forget -->
<div id="opts" popover="auto" class="lab-pop" style="--w:720px">
  <div class="mb-3 flex items-center justify-between">
    <h2 class="text-[14px] font-semibold">Options</h2>
    <button class="lab-btn py-0.5" popovertarget="opts" popovertargetaction="hide">Done</button>
  </div>

  <div class="grid gap-5 sm:grid-cols-2">
    <div>
      <div class="lab-rule start mb-2">Solver</div>
      <div class="flex flex-col gap-2 text-[12.5px]">
        <label class="flex items-center justify-between gap-2">
          <span class="text-dim">Gear pool</span>
          <select class="lab-input w-auto py-0.5" bind:value={ui.source}>
            <option value="all">everything obtainable</option>
            <option value="owned">only what I own ({ownedCount})</option>
          </select>
        </label>
        <label class="flex items-center justify-between gap-2">
          <span class="text-dim">Accessory slots</span>
          <input type="number" min="4" max="10" class="lab-input w-16 py-0.5 text-center" bind:value={ui.slots} />
          <span class="text-dim" title="How many rows of ranked accessories to show before the list scrolls">Accessory rows</span>
          <input type="number" min="1" max="8" class="lab-input w-16 py-0.5 text-center" bind:value={ui.accRows} />
        </label>
        <label class="flex items-center gap-2"><input type="checkbox" bind:checked={ui.requireSet} /> Prefer a full armor set</label>
        <label class="flex items-center gap-2"><input type="checkbox" bind:checked={ui.unknownStage} />
          <span class="flex items-center gap-1">Include unknown-stage items
            <Info label="Unknown-stage items" w={320}><p>Items whose gamestage could not be inferred from drops, recipes or rarity. Off by default because they would otherwise show up at stage zero.</p></Info>
          </span>
        </label>
        <label class="flex items-center gap-2"><input type="checkbox" bind:checked={ui.uncertain} />
          <span class="flex items-center gap-1">Apply uncertain modifiers
            <Info label="Uncertain modifiers" w={320}><p>Damage / use-time changes whose in-code condition the miner could not resolve. Turning this on assumes they all apply — useful as an upper bound.</p></Info>
          </span>
        </label>
      </div>
    </div>

    <div>
      {#if styleClasses.length}
        <div class="lab-rule start mb-2 flex items-center gap-1">Playstyle
          <Info label="Playstyle" w={380}><p>How far from the boss you fight. The distance decides how much of a shot's spread lands on the target, how far ahead it has to lead a moving boss, and whether it reaches at all — so a close-range weapon scores low for a class that stands back without anyone saying so. Each class has a default; these pick a different one.</p></Info>
        </div>
        <div class="mb-4 flex flex-col gap-1">
          {#each styleClasses as c}
            <div class="flex items-center gap-1">
              <span class="text-dim w-20 text-xs">{CLASS_LABELS[c] ?? c}</span>
              <button class="lab-chip py-0.5" aria-pressed={!ui.playstyle?.[c]} onclick={() => setPlaystyle(c, null)} title={`${ENGAGE[c]} px`}>Default</button>
              {#each Object.entries(PLAYSTYLE[c]) as [k, px]}
                <button class="lab-chip py-0.5" aria-pressed={ui.playstyle?.[c] === k} onclick={() => setPlaystyle(c, k)} title={`${px} px`}>{STYLE_LABELS[k] ?? k}</button>
              {/each}
            </div>
          {/each}
        </div>
      {/if}
      {#if ds.conditions.length}
        <div class="lab-rule start mb-2">Difficulty</div>
        <div class="mb-4 flex flex-wrap gap-1">
          {#each ds.conditions as c}
            <button class="lab-chip py-0.5" aria-pressed={ui.conds.includes(c)} onclick={() => toggleIn('conds', c)}>{COND_LABELS[c] ?? c}</button>
          {/each}
        </div>
      {/if}
      {#if ds.seeds.length}
        <div class="lab-rule start mb-2 flex items-center gap-1">World seed
          <Info label="World seed" w={340}><p>Special world seeds change where things come from — in Don’t Dig Up, Mimics spawn before hardmode, so their loot is available far earlier. Off by default: a normal world is assumed. Only seeds that actually move something in your mod list are listed.</p></Info>
        </div>
        <div class="mb-4 flex flex-wrap gap-1">
          {#each ds.seeds as s}
            <button class="lab-chip py-0.5" aria-pressed={ui.seeds.includes(s.key)} onclick={() => toggleIn('seeds', s.key)} title={`${Object.keys(s.items).length} items become available earlier`}>{s.label}</button>
          {/each}
        </div>
      {/if}
      <div class="lab-rule start mb-2">Mods drawn from</div>
      <div class="flex max-h-[260px] flex-wrap gap-1 overflow-y-auto pr-1">
        {#each contentMods as m}
          {@const off = ui.excludedMods.includes(m.id)}
          <button class="lab-chip py-0.5 text-[11.5px]" class:is-off={off} aria-pressed={off} onclick={() => toggleMod(m.id)} title={`${m.equipment} equipment items · v${m.version}${off ? ' — currently excluded' : ''}`}>
            {m.name} <span class="num opacity-60">{m.equipment}</span>
          </button>
        {/each}
      </div>
      <p class="m-0 mt-2 text-[11.5px] text-dim">
        Click a mod to leave it out of the solve — struck-through mods are off.
        {#if ui.excludedMods.length}<button class="ml-1 cursor-pointer underline hover:text-green" onclick={() => (ui.excludedMods = [])}>bring all back</button>{/if}
      </p>
    </div>
  </div>
</div>
