<script>
  import { CLASS_LABELS, stageEras } from '../lib/dataset.js';
  import { toggleIn, ui } from '../lib/state.svelte.js';

  let { ds, calibration } = $props();
  const eras = $derived(stageEras(ds.stages));
  const contentMods = $derived(ds.mods.filter((m) => m.equipment > 0));
  let modsOpen = $state(false);

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
</script>

<section class="lab-panel mx-4 my-4 grid gap-4 p-4 md:grid-cols-[auto_1fr_auto]">
  <!-- class -->
  <div>
    <span class="lab-label mb-1.5">Class</span>
    <div class="flex flex-wrap gap-1">
      {#each ds.classList as c}
        <button class="lab-chip" aria-pressed={ui.cls === c} onclick={() => (ui.cls = c)}>{CLASS_LABELS[c] ?? c}</button>
      {/each}
    </div>
  </div>

  <!-- stage -->
  <div class="min-w-0">
    <span class="lab-label mb-1.5">Gamestage <span class="normal-case tracking-normal text-dim/80">(everything obtainable after this boss)</span></span>
    <div class="flex items-stretch gap-1">
      <button class="lab-btn px-2" onclick={() => stepStage(-1)} title="Previous stage" aria-label="Previous stage">‹</button>
      <select class="lab-input min-w-0 flex-1" bind:value={ui.stage}>
        {#each eras as era}
          <optgroup label={era.label}>
            {#each era.stages as s}
              <option value={s.index}>{s.index === 0 ? s.label : `Post ${s.label}`}{s.mod !== 'v' ? ` · ${ds.modById.get(s.mod)?.name ?? s.mod}` : ''}</option>
            {/each}
          </optgroup>
        {/each}
      </select>
      <button class="lab-btn px-2" onclick={() => stepStage(1)} title="Next stage" aria-label="Next stage">›</button>
    </div>
    <input type="range" min="0" max={ds.stages.length - 1} bind:value={ui.stage} class="mt-1 w-full" aria-label="Gamestage" />
  </div>

  <!-- mode + settings -->
  <div class="flex flex-col gap-2">
    <div>
      <span class="lab-label mb-1.5">View</span>
      <div class="flex gap-1">
        {#each MODES as [m, label]}
          <button class="lab-chip" aria-pressed={ui.mode === m} onclick={() => (ui.mode = m)}>{label}</button>
        {/each}
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
      <label class="flex items-center gap-1.5">
        <span class="text-dim">Accessory slots</span>
        <input type="number" min="4" max="10" class="lab-input w-14 py-0.5 text-center" bind:value={ui.slots} />
      </label>
      <label class="flex items-center gap-1.5">
        <input type="checkbox" bind:checked={ui.requireSet} />
        <span>Prefer full armor set</span>
      </label>
      <label class="flex items-center gap-1.5" title="Include items whose gamestage could not be inferred">
        <input type="checkbox" bind:checked={ui.unknownStage} />
        <span>Include unknown-stage items</span>
      </label>
      <button class="lab-btn py-0.5" onclick={() => (modsOpen = !modsOpen)} aria-expanded={modsOpen}>
        Mods {ui.excludedMods.length ? `(${ui.excludedMods.length} excluded)` : ''}
      </button>
    </div>
  </div>

  <!-- modifiers / gear / calibration -->
  <div class="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-3 text-[12.5px] md:col-span-3">
    <label class="flex items-center gap-1.5">
      <span class="text-dim">Gear from</span>
      <select class="lab-input w-auto py-0.5" bind:value={ui.source}>
        <option value="all">everything obtainable</option>
        <option value="owned">only what I own ({ownedCount})</option>
      </select>
    </label>
    <label class="flex items-center gap-1.5">
      <span class="text-dim">Reforges</span>
      <select class="lab-input w-auto py-0.5" bind:value={ui.reforge}>
        <option value="best">assume the best prefix</option>
        <option value="none">no reforge</option>
      </select>
      <span class="text-dim" title="Items you marked as owned keep the prefix you gave them">(owned items keep theirs)</span>
    </label>
    {#if ds.conditions.length}
      <span class="flex items-center gap-1">
        <span class="text-dim">Difficulty</span>
        {#each ds.conditions as c}
          <button class="lab-chip py-0.5" aria-pressed={ui.conds.includes(c)} onclick={() => toggleIn('conds', c)}>{COND_LABELS[c] ?? c}</button>
        {/each}
      </span>
    {/if}
    <label class="flex items-center gap-1.5" title="Apply damage / use-time modifiers whose in-code condition the miner could not resolve">
      <input type="checkbox" bind:checked={ui.uncertain} />
      <span>Apply uncertain modifiers</span>
    </label>
    <span class="ml-auto flex gap-1">
      <button class="lab-btn py-0.5" aria-pressed={ui.panel === 'gear'} onclick={() => (ui.panel = ui.panel === 'gear' ? null : 'gear')}>My gear <span class="num">{ownedCount}</span>{ui.pinned.length ? ` · ${ui.pinned.length} pinned` : ''}{ui.excluded.length ? ` · ${ui.excluded.length} excluded` : ''}</button>
      <button class="lab-btn py-0.5" aria-pressed={ui.panel === 'calibrate'} onclick={() => (ui.panel = ui.panel === 'calibrate' ? null : 'calibrate')}>
        Calibrate <span class="num">{ui.samples.length}</span>{calibration?.sampleCount && ui.calibrate ? ` · ×${Math.round((calibration.factors.all ?? 1) * 100) / 100}` : ''}
      </button>
    </span>
  </div>

  {#if modsOpen}
    <div class="border-t border-line pt-3 md:col-span-3">
      <span class="lab-label mb-1.5">Mods drawn from <span class="normal-case tracking-normal text-dim/80">— click to exclude</span></span>
      <div class="flex flex-wrap gap-1">
        {#each contentMods as m}
          <button class="lab-chip" aria-pressed={!ui.excludedMods.includes(m.id)} onclick={() => toggleMod(m.id)} title={`${m.equipment} equipment items · v${m.version}`}>
            {m.name} <span class="num opacity-70">{m.equipment}</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}
</section>
