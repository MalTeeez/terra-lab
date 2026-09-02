<script>
  /** A compact, explainable score breakdown: "+12% melee damage 12 · 54 defense 21.6". */
  let { parts = [], score = null, max = 6 } = $props();
  const shown = $derived(parts.slice(0, max));
</script>

<span class="inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11.5px] text-dim">
  {#if score !== null}
    <span class="num font-semibold text-green-deep">{score}</span>
  {/if}
  {#each shown as p}
    <span class="whitespace-nowrap">{p.label} <span class="num text-ink2">{p.value > 0 ? '+' : ''}{p.value}</span></span>
  {/each}
  {#if parts.length > max}
    <span>+{parts.length - max} more</span>
  {/if}
</span>
