<script>
  let { ds } = $props();
  const contentMods = $derived(ds ? ds.mods.filter((m) => m.equipment > 0 && m.id !== 'v') : []);
</script>

<header class="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b-2 border-green px-4 pb-3 pt-5">
  <div>
    <h1 class="text-[22px] font-bold tracking-tight">
      <span class="text-green">Terra</span> Lab
    </h1>
    <p class="m-0 text-[12.5px] text-dim">
      Optimal class loadouts per gamestage — mined from your own <span class="num">.tmod</span> files.
    </p>
  </div>
  {#if ds}
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-dim">
      <span><span class="num font-semibold text-ink">{ds.items.length.toLocaleString()}</span> equipment items</span>
      <span><span class="num font-semibold text-ink">{contentMods.length}</span> content mods + vanilla</span>
      <span><span class="num font-semibold text-ink">{ds.stages.length - 1}</span> boss stages</span>
      <span>tModLoader <span class="num">{ds.tml}</span></span>
      <span>mined <span class="num">{ds.generatedAt.slice(0, 10)}</span></span>
    </div>
  {/if}
</header>
