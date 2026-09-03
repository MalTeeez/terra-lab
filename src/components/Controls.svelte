<script>
  import { CLASS_LABELS, accentOf, eraOf, stageEras } from '../lib/dataset.js';
  import { fly } from 'svelte/transition';
  import { toggleIn, ui } from '../lib/state.svelte.js';
  import Info from './Info.svelte';

  let { ds, calibration } = $props();
  const eras = $derived(stageEras(ds.stages));
  const contentMods = $derived(ds.mods.filter((m) => m.equipment > 0));
  const stage = $derived(ds.stages[ui.stage]);
  const era = $derived(eraOf(stage));

  function toggleMod(id) {
    const set = new Set(ui.excludedMods);
    if (set.has(id)) set.delete(id); else set.add(id);
    ui.excludedMods = [...set];
  }
  function stepStage(d) {
    ui.stage = Math.max(0, Math.min(ds.stages.length - 1, ui.stage + d));
  }
  const MODES = [['loadout', 'Loadout'], ['timeline', 'All stages'], ['items', 'Items only']];
  const COND_LABELS = { expert: 'Expert', master: 'Master', revenge: 'Revengeance', death: 'Death', malice: 'Malice', eternity: 'Eternity', infernum: 'Infernum', bossrush: 'Boss Rush' };
  const ownedCount = $derived(Object.keys(ui.owned).length);

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
    if (ui.excludedMods.length) a.push({ label: `${ui.excludedMods.length} mods off`, clear: () => (ui.excludedMods = []) });
    if (ui.pinned.length) a.push({ label: `${ui.pinned.length} pinned`, clear: () => (ui.pinned = []) });
    if (ui.excluded.length) a.push({ label: `${ui.excluded.length} excluded`, clear: () => (ui.excluded = []) });
    if (ui.calibrate && calibration?.sampleCount) a.push({ label: `calibrated ×${Math.round((calibration.factors.all ?? 1) * 100) / 100}`, clear: () => (ui.calibrate = false) });
    return a;
  });
</script>

<div class="sticky top-0 z-30 bg-paper/60 px-5 pb-3 pt-2 backdrop-blur-sm">
  <section class="lab-panel px-4 py-3 backdrop-blur" style="--accent:{accentOf(ui.cls)}; background-color:rgb(255 255 255 / 0.92); box-shadow:var(--shadow-panel), 0 6px 12px -8px rgb(22 40 26 / 0.45)">
    <div class="flex flex-wrap items-start gap-x-6 gap-y-3">
      <!-- class -->
      <div>
        <span class="lab-label mb-1.5">Class</span>
        <div class="flex flex-wrap gap-1">
          {#each ds.classList as c}
            <button class="lab-chip" style="--accent:{accentOf(c)}" aria-pressed={ui.cls === c} onclick={() => (ui.cls = c)}>{CLASS_LABELS[c] ?? c}</button>
          {/each}
        </div>
      </div>

      <!-- stage -->
      <div class="min-w-[300px] flex-1" style="--accent:{era.color}">
        <span class="lab-label mb-1.5 flex items-center gap-1.5">
          Gamestage
          <span class="normal-case tracking-normal" style="color:{era.color}">· {era.label}</span>
          <span class="num normal-case tracking-normal text-dim/70">{ui.stage}/{ds.stages.length - 1}</span>
          <Info label="Gamestage" w={340}>
            <p>Everything that is <em>obtainable once you have beaten this boss</em> — the loadout is solved from exactly that pool.</p>
            <p>Drag the slider to walk a run forward; “All stages” shows where the loadout actually changes.</p>
          </Info>
        </span>
        <div class="flex items-stretch gap-1">
          <button class="lab-btn px-2" onclick={() => stepStage(-1)} title="Previous stage" aria-label="Previous stage">‹</button>
          <select class="lab-input min-w-0 flex-1" bind:value={ui.stage}>
            {#each eras as e}
              <optgroup label={e.label}>
                {#each e.stages as s}
                  <option value={s.index}>{s.index === 0 ? s.label : `Post ${s.label}`}{s.mod !== 'v' ? ` · ${ds.modById.get(s.mod)?.name ?? s.mod}` : ''}</option>
                {/each}
              </optgroup>
            {/each}
          </select>
          <button class="lab-btn px-2" onclick={() => stepStage(1)} title="Next stage" aria-label="Next stage">›</button>
        </div>
        <input type="range" min="0" max={ds.stages.length - 1} bind:value={ui.stage} class="mt-1.5 w-full" aria-label="Gamestage" />
      </div>

      <!-- view -->
      <div>
        <span class="lab-label mb-1.5">View</span>
        <div class="flex gap-1">
          {#each MODES as [m, label]}
            <button class="lab-chip" aria-pressed={ui.mode === m} onclick={() => (ui.mode = m)}>{label}</button>
          {/each}
        </div>
      </div>

      <!-- panels + options -->
      <div class="flex gap-1 pt-[18px]">
        <button class="lab-btn" aria-pressed={ui.panel === 'gear'} onclick={() => (ui.panel = ui.panel === 'gear' ? null : 'gear')} title="Items you own, pins and exclusions">
          My gear {#if ownedCount}<span class="num text-green-deep">{ownedCount}</span>{/if}
        </button>
        <button class="lab-btn" aria-pressed={ui.panel === 'calibrate'} onclick={() => (ui.panel = ui.panel === 'calibrate' ? null : 'calibrate')} title="Fit predictions against damage numbers from the game">
          Calibrate {#if ui.samples.length}<span class="num text-green-deep">{ui.samples.length}</span>{/if}
        </button>
        <button class="lab-btn" popovertarget="opts" title="Solver assumptions, difficulty and mods">⚙ Options</button>
      </div>
    </div>

    <!-- always rendered: letting this row appear and vanish shoved the whole page up and down -->
    <div class="mt-3 flex min-h-[23px] flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line pt-2.5">
      <span class="lab-rule start w-[86px] shrink-0">Active</span>
      {#each active as a (a.label)}
        <button class="lab-active" onclick={a.clear} title="Turn this off" transition:fly={{ y: -4, duration: 130 }}>{a.label}</button>
      {:else}
        <span class="text-[11.5px] text-dim/70">nothing changed from the defaults</span>
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
          <span class="text-dim" title="rows of ranked accessories shown before the list scrolls">Accessory rows</span>
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
