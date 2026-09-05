<script>
  import { Volume2, VolumeX } from '@lucide/svelte';
  import Info from './Info.svelte';
  import { ui } from '../lib/state.svelte.js';

  let { ds } = $props();
  const contentMods = $derived(ds ? ds.mods.filter((m) => m.equipment > 0 && m.id !== 'v') : []);
</script>

<header class="lab-header relative flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 pb-3 pt-5">
  <div class="flex items-center gap-3">
    <!-- flask, with three bubbles gently rising -->
    <svg viewBox="0 0 24 24" class="lab-flask h-9 w-9 shrink-0" aria-hidden="true">
      <path d="M9.5 3v6.2L4.6 17.4A2.4 2.4 0 0 0 6.7 21h10.6a2.4 2.4 0 0 0 2.1-3.6L14.5 9.2V3" fill="var(--color-green-soft)" stroke="var(--color-green)" stroke-width="1.6" stroke-linejoin="round" />
      <path d="M6.9 14.5h10.2l2.3 3.9A2.4 2.4 0 0 1 17.3 21H6.7a2.4 2.4 0 0 1-2.1-3.6z" fill="var(--color-green)" opacity="0.85" />
      <path d="M8 3h8" stroke="var(--color-green-deep)" stroke-width="1.8" stroke-linecap="round" />
      <circle class="b b1" cx="10.5" cy="17.5" r="1.1" fill="#fff" opacity="0.75" />
      <circle class="b b2" cx="14"   cy="19"   r="0.8" fill="#fff" opacity="0.55" />
      <circle class="b b3" cx="12"   cy="18.2" r="0.6" fill="#fff" opacity="0.45" />
    </svg>
    <div>
      <h1 class="text-[22px] font-bold leading-tight tracking-tight">
        <span class="text-green">Terra</span> Lab
      </h1>
      <p class="m-0 text-[12px] text-dim">Best gear for every gamestage, computed from your own modpack.</p>
    </div>
  </div>

  {#if ds}
    <div class="flex flex-wrap items-center gap-2 text-[12px]">
      {#each [[ds.items.length.toLocaleString(), 'items'], [contentMods.length, 'mods'], [ds.stages.length - 1, 'boss stages']] as [n, label]}
        <span class="lab-stat">
          <span class="num font-semibold text-ink">{n}</span>{label}
        </span>
      {/each}
      <!-- the delegated click sound fires before this handler, so muting signs off with one last click -->
      <button type="button" class="lab-btn px-2 py-1" aria-pressed={ui.sound} onclick={() => (ui.sound = !ui.sound)}
              title={ui.sound ? 'Turn interaction sounds off' : 'Turn interaction sounds on'}
              aria-label={ui.sound ? 'Turn interaction sounds off' : 'Turn interaction sounds on'}>
        {#if ui.sound}<Volume2 size={14} />{:else}<VolumeX size={14} />{/if}
      </button>
      <Info label="About this dataset" w={420}>
        <p>
          Every stat here was read out of your mods' compiled code and tModLoader itself — item defaults, equip effects,
          recipes, boss drops and BossChecklist progression. Nothing is scraped from a wiki.
        </p>
        <p>
          Gamestages are <em>inferred</em> (drop → treasure bag → recipe → rarity); the tag beside each stage says which.
          Rarity guesses are the ones worth double-checking.
        </p>
        <p class="num text-[11.5px] text-dim">
          tModLoader {ds.tml} · mined {ds.generatedAt.slice(0, 10)} · regenerate with `bun run mine`
        </p>
        <div class="lab-rule start my-2">Content mods</div>
        <p class="text-[11.5px] text-dim">{contentMods.map((m) => `${m.name} ${m.version}`).join(' · ')}</p>
      </Info>
    </div>
  {/if}
</header>
