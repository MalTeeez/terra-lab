<script>
  /** A score broken into its labelled parts: "+12% melee damage" pills, each carrying the points it added. */
  let { parts = [], score = null, max = 6 } = $props();
  const shown = $derived(parts.slice(0, max));
  const rest = $derived(parts.slice(max));
</script>

<span class="inline-flex flex-wrap items-center gap-1 text-[11px] text-dim">
  {#if score !== null}
    <span class="num mr-0.5 text-[12.5px] font-semibold" style="color:var(--accent, var(--color-green))">{score}</span>
  {/if}
  {#each shown as p}
    <span class="lab-part" class:neg={p.value < 0} class:has-tip={!!p.detail} data-tip={p.detail}>{p.label}<b>{p.value > 0 ? '+' : ''}{p.value}</b></span>
  {/each}
  {#if rest.length}
    <span class="lab-part has-tip text-[10.5px] text-dim/80" data-tip={rest.map((p) => `${p.label} ${p.value > 0 ? '+' : ''}${p.value}`).join('\n')}>+{rest.length} more</span>
  {/if}
</span>
