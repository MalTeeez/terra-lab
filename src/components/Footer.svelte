<script>
  let { ds } = $props();
  const mods = $derived(ds.mods.filter((m) => m.equipment > 0 && m.id !== 'v'));
</script>

<footer class="mt-auto border-t border-line px-4 py-4 text-[11.5px] text-dim">
  <p class="m-0">
    Every stat here was read out of the mods' compiled code and tModLoader itself: item defaults, equip effects, recipes, boss drops and BossChecklist progression values.
    Gamestages are inferred (drop → bag → recipe → rarity); the tag next to each stage says which. Rarity-guessed stages are the ones to double-check.
  </p>
  <p class="m-0 mt-1">
    Content mods: {mods.map((m) => `${m.name} ${m.version}`).join(' · ')} · Terraria via tModLoader {ds.tml}.
    Regenerate with <code class="num">bun run mine</code>.
  </p>
</footer>
