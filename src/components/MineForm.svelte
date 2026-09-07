<script>
  import { FolderOpen, FileCog, Pickaxe } from '@lucide/svelte';
  import { CUSTOM_URL, saveDataset } from '../lib/datasets.js';
  import { canMine, findEnabled, mine, pickTmods } from '../lib/mine.js';

  let { onmined } = $props();

  // `$state.raw`: these go to the worker as they are, and postMessage cannot clone a Svelte proxy
  let modFiles = $state.raw([]);
  let enabledFile = $state.raw(null);
  let tmlFile = $state.raw(null);
  let busy = $state(false);
  let lines = $state([]);
  let progress = $state(null);
  let error = $state(null);

  function takeMods(list) {
    const files = [...list];
    modFiles = pickTmods(files);
    enabledFile = findEnabled(files);
    error = null; // no .tmod in there is not a mistake: it mines vanilla on its own
  }

  async function run() {
    busy = true;
    error = null;
    lines = [];
    progress = null;
    try {
      const bytes = await mine({
        tmlFile,
        modFiles,
        enabledFile,
        onlog: (m) => {
          if (m.log) lines = [...lines.slice(-40), m.log];
          if (m.total) progress = { step: m.step, total: m.total };
        },
      });
      progress = null;
      lines = [...lines, 'saving…'];
      await saveDataset(new TextDecoder().decode(bytes), modFiles.length ? `${modFiles.length} mods, mined here` : 'vanilla, mined here');
      onmined(CUSTOM_URL);
    } catch (e) {
      error = e?.message ?? String(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="lab-rule start mt-1">Or mine your own</div>

{#if !canMine}
  <p class="m-0 text-[12px] text-dim">
    This browser cannot unpack a <code class="num">.tmod</code>. Mine on the desktop with
    <code class="num text-ink2">bun run mine</code> and drop the dataset above, or use a current Chrome, Firefox or Safari.
  </p>
{:else}
  <div class="flex flex-col gap-2">
    <label class="lab-pick">
      <input type="file" class="sr-only" webkitdirectory multiple disabled={busy}
             onchange={(e) => takeMods(e.currentTarget.files)} />
      <FolderOpen size={15} />
      <span class="flex-1">
        {#if modFiles.length}
          <span class="num text-ink">{modFiles.length}</span> mods{enabledFile ? ', with enabled.json' : ''}
        {:else}
          Your mods folder <span class="text-dim">— optional</span>
        {/if}
      </span>
      <span class="lab-tag">browse</span>
    </label>

    <label class="lab-pick">
      <input type="file" class="sr-only" accept=".dll" disabled={busy}
             onchange={(e) => (tmlFile = e.currentTarget.files?.[0] ?? null)} />
      <FileCog size={15} />
      <span class="flex-1">
        {#if tmlFile}<span class="text-ink">{tmlFile.name}</span> · <span class="num">{(tmlFile.size / 1024 / 1024).toFixed(0)}</span> MB
        {:else}tModLoader.dll{/if}
      </span>
      <span class="lab-tag">browse</span>
    </label>

    <p class="m-0 text-[11.5px] text-dim">
      Mods live in tModLoader's save folder, under <code class="num">…/Terraria/tModLoader/Mods</code>, and anything from
      the workshop under <code class="num">…/steamapps/workshop/content/1281930</code> — pick either, or both one after
      the other. tModLoader.dll is in <code class="num">…/steamapps/common/tModLoader</code>, and it is the only one
      needed — without a mods folder this mines vanilla Terraria on its own.
    </p>

    <div class="flex items-center gap-2">
      <button type="button" class="lab-btn primary" disabled={busy || !tmlFile} onclick={run}>
        <Pickaxe size={14} /> {busy ? 'Mining…' : modFiles.length ? 'Mine this pack' : 'Mine vanilla'}
      </button>
      {#if progress}
        <span class="text-[12px] text-dim">unpacking <span class="num text-ink">{progress.step}</span>/{progress.total}</span>
      {/if}
    </div>

    {#if lines.length}
      <pre class="lab-minelog">{lines.slice(-8).join('\n')}</pre>
    {/if}
  </div>
{/if}

{#if error}
  <p class="m-0 border border-bad/40 bg-bad-soft px-3 py-2 text-[12.5px] text-bad">{error}</p>
{/if}
