<script>
  import { Trash2, Upload } from '@lucide/svelte';
  import MineForm from './MineForm.svelte';
  import { CUSTOM_URL, PRESETS, clearCustom, customInfo, fetchSummary, saveCustom } from '../lib/datasets.js';

  let { current = null, oncancel = null, onpick } = $props();

  let custom = $state(customInfo());
  let error = $state(null);
  let busy = $state(false);
  let dragging = $state(false);

  // the summary is a couple of KB next to each shipped dataset, so the cards can say what is in one
  // without pulling the 6 MB itself
  const summaries = $state({});
  for (const p of PRESETS) fetchSummary(p.summaryUrl).then((s) => { summaries[p.url] = s; });

  const cards = $derived([
    ...PRESETS.map((p) => ({ ...p, summary: summaries[p.url] ?? null })),
    ...(custom ? [{ url: CUSTOM_URL, name: custom.name, note: 'Your own mine, kept in this browser.', summary: custom.summary, mine: true }] : []),
  ]);

  async function take(file) {
    if (!file || busy) return;
    error = null;
    busy = true;
    try {
      custom = await saveCustom(file);
      onpick(CUSTOM_URL);
    } catch (e) {
      error = e?.message ?? String(e);
    } finally {
      busy = false;
    }
  }
  async function forget() {
    await clearCustom();
    custom = null;
  }
</script>

<main class="mx-auto flex w-full max-w-[900px] flex-1 flex-col justify-center gap-4 px-5 py-10">
  <section class="lab-panel overflow-hidden">
    <header class="lab-head">
      <h2>Pick a dataset</h2>
      <span class="lab-meta">everything on the site is computed from the one you choose</span>
    </header>

    <div class="flex flex-col gap-2 p-4">
      {#each cards as c (c.url)}
        <div class="flex items-start gap-2">
          <button
            type="button"
            class="lab-card flex-1"
            aria-current={current === c.url}
            onclick={() => onpick(c.url)}
          >
            <div class="flex items-baseline gap-2">
              <span class="text-[14px] font-semibold text-ink">{c.name}</span>
              {#if c.mine}<span class="lab-tag teal">yours</span>{/if}
              {#if current === c.url}<span class="lab-tag green">in use</span>{/if}
            </div>
            <p class="m-0 mt-0.5 text-[12.5px] text-dim">{c.note}</p>
            {#if c.summary}
              <p class="m-0 mt-1.5 text-[12px] text-dim">
                <span class="num text-ink">{c.summary.items.toLocaleString()}</span> items ·
                <span class="num text-ink">{c.summary.mods.length}</span> content mods ·
                <span class="num text-ink">{c.summary.stages - 1}</span> boss stages ·
                mined <span class="num">{c.summary.generatedAt?.slice(0, 10) ?? '?'}</span>
                {#if c.summary.tml}· tModLoader <span class="num">{c.summary.tml}</span>{/if}
              </p>
              <p class="m-0 mt-1 line-clamp-2 text-[11.5px] text-dim opacity-80" title={c.summary.mods.map((m) => `${m.name} ${m.version ?? ''}`.trim()).join('\n')}>
                {c.summary.mods.map((m) => m.name).join(' · ')}
              </p>
            {/if}
          </button>
          {#if c.mine}
            <button type="button" class="lab-btn px-2" onclick={forget} title="Forget this dataset" aria-label="Forget this dataset">
              <Trash2 size={14} />
            </button>
          {/if}
        </div>
      {/each}

      <label
        class="lab-drop"
        class:is-over={dragging}
        ondragover={(e) => { e.preventDefault(); dragging = true; }}
        ondragleave={() => (dragging = false)}
        ondrop={(e) => { e.preventDefault(); dragging = false; take(e.dataTransfer?.files?.[0]); }}
      >
        <input type="file" accept="application/json,.json" class="sr-only" disabled={busy}
               onchange={(e) => { take(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
        <Upload size={16} />
        <span>{busy ? 'Reading…' : custom ? 'Replace it with another dataset.json' : 'Drop your own dataset.json here, or click to pick one'}</span>
      </label>

      {#if error}
        <p class="m-0 border border-bad/40 bg-bad-soft px-3 py-2 text-[12.5px] text-bad">{error}</p>
      {/if}

      <MineForm onmined={onpick} />

      {#if oncancel}
        <div class="mt-1 flex justify-end">
          <button type="button" class="lab-btn" onclick={oncancel}>Back</button>
        </div>
      {/if}
    </div>
  </section>

  <p class="m-0 px-1 text-[12px] text-dim">
    A dataset is your modpack read out of its compiled code — items, effects, recipes, drops and the gamestage each one
    opens at. Mining it here reads the same files the game does, in this tab, and takes about half a minute for a big
    pack; <code class="num text-ink2">bun run mine</code> in the repo produces exactly the same file if you would rather
    have it on disk. Either way it stays in this browser — nothing is uploaded anywhere.
  </p>
</main>
