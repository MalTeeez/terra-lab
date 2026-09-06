<script>
  let { ds } = $props();
  const mods = $derived(ds.mods.filter((m) => m.equipment > 0 && m.id !== 'v'));
</script>

<footer class="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-5 text-[11.5px] text-dim">
  <span class="lab-rule start w-24 shrink-0">Sources</span>
  <span title={mods.map((m) => `${m.name} ${m.version}`).join('\n')}>
    <span class="num">{mods.length}</span> content mods + Terraria via tModLoader <span class="num">{ds.tml}</span>,
    read from the compiled code. Regenerate with <code class="num text-ink2">bun run mine</code>.
  </span>
</footer>
