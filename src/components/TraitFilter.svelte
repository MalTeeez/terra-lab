<script>
  /** A section's filter: free text plus a dropdown of every trait present in the section, with counts. */
  import { traitCounts } from '../lib/traits.js';

  let { entries = [], query = $bindable(''), selected = $bindable([]), placeholder = 'Filter…' } = $props();
  const id = `traits${Math.random().toString(36).slice(2, 9)}`;
  const counts = $derived(traitCounts(entries));
  const toggle = (t) => { selected = selected.includes(t) ? selected.filter((x) => x !== t) : [...selected, t]; };
</script>

<span class="inline-flex items-center gap-1 font-normal normal-case tracking-normal">
  <input class="lab-input w-36 py-0.5 text-[12px]" {placeholder} bind:value={query} title="Every word must match the name, tooltip or a trait; a leading - excludes" />
  <button type="button" class="lab-chip py-0.5" popovertarget={id} aria-pressed={selected.length > 0}>
    traits{#if selected.length} <span class="num">{selected.length}</span>{/if} ▾
  </button>
  {#if selected.length || query}
    <button type="button" class="lab-chip py-0.5" title="Clear this filter" onclick={() => { selected = []; query = ''; }}>✕</button>
  {/if}
</span>
<div {id} popover="auto" class="lab-pop col" style="--w:520px">
  <div class="lab-rule start mb-2">Traits in this list <span class="num text-dim">({counts.length})</span></div>
  <p class="m-0 mb-2 text-[11.5px] text-dim">Pick any number, an entry must have all of them. Counts are how many entries carry the trait.</p>
  {#if !counts.length}
    <p class="m-0 text-dim">Nothing to filter.</p>
  {:else}
    <div class="flex flex-wrap gap-1">
      {#each counts as [t, n]}
        <button type="button" class="lab-chip py-0.5" aria-pressed={selected.includes(t)} onclick={() => toggle(t)}>{t} <span class="num text-dim">{n}</span></button>
      {/each}
    </div>
  {/if}
</div>
