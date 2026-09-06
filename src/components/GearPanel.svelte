<script>
  import { slide } from 'svelte/transition';
  import { prefixesFor } from '../lib/stats.js';
  import { setOwned, toggleIn, ui } from '../lib/state.svelte.js';
  import Info from './Info.svelte';

  let { ds, onselect } = $props();
  let query = $state('');
  const owned = $derived(Object.keys(ui.owned).map((id) => ds.byId.get(id)).filter(Boolean).sort((a, b) => a.slot.localeCompare(b.slot) || a.name.localeCompare(b.name)));
  const hits = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return ds.items.filter((it) => it.name.toLowerCase().includes(q) && !(it.id in ui.owned)).slice(0, 12);
  });
  const prefixName = (id) => (id ? ds.prefixById.get(id)?.name ?? id : 'no prefix');
</script>

<section class="lab-panel mx-5 mb-4 overflow-hidden" transition:slide={{ duration: 180 }}>
  <header class="lab-head">
    <h2>My gear</h2>
    <Info label="What this list does" w={360}>
      <p>Mark what you actually own and how it is reforged.</p>
      <p>Set <em>Options → Gear pool → only what I own</em> to solve the loadout from just this list.</p>
      <p><em>Pin</em> forces an item into every loadout; <em>exclude</em> keeps it out for good.</p>
    </Info>
    <span class="lab-meta"><span class="num font-semibold text-ink">{owned.length}</span> owned{#if ui.pinned.length} · <span class="num">{ui.pinned.length}</span> pinned{/if}{#if ui.excluded.length} · <span class="num">{ui.excluded.length}</span> excluded{/if}</span>
  </header>
  <div class="grid gap-4 p-4 md:grid-cols-[1fr_1.4fr]">
    <div>
      <span class="lab-label mb-1">Add an item</span>
      <input class="lab-input" placeholder="Type a name…" bind:value={query} />
      {#if hits.length}
        <ul class="m-0 mt-1 list-none border border-line p-0">
          {#each hits as it}
            <li class="flex items-center justify-between gap-2 border-b border-line px-2 py-1 text-[12.5px] last:border-0">
              <span><span class="lab-tag mr-1">{it.slot}</span>{it.name} <span class="text-dim">· {it.modName}</span></span>
              <button class="lab-btn py-0.5" onclick={() => { setOwned(it.id, true); query = ''; }}>own</button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
    <div>
      <span class="lab-label mb-1">Owned</span>
      {#if !owned.length}
        <p class="m-0 text-[12.5px] text-dim">Nothing yet. Add items here, or tick "I own this" on any item card.</p>
      {:else}
        <table class="lab-table">
          <thead><tr><th>Item</th><th>Reforge</th><th>Solver</th><th></th></tr></thead>
          <tbody>
            {#each owned as it (it.id)}
              {@const options = prefixesFor(it, ds.prefixes, ds.aliases)}
              <tr>
                <td><button class="cursor-pointer text-left font-medium hover:text-green" onclick={() => onselect(it.id)}>{it.name}</button><div class="text-[11px] text-dim">{it.modName} · {it.slot}</div></td>
                <td>
                  {#if options.length}
                    <select class="lab-input w-auto max-w-[160px] py-0.5" value={ui.owned[it.id]?.prefix ?? ''} onchange={(e) => setOwned(it.id, true, e.currentTarget.value || null)}>
                      <option value="">no prefix</option>
                      {#each options as p}<option value={p.id}>{p.name}{p.mod !== 'v' ? ` (${p.mod})` : ''}</option>{/each}
                    </select>
                  {:else}<span class="text-dim">–</span>{/if}
                </td>
                <td class="whitespace-nowrap">
                  <button class="lab-chip py-0.5" aria-pressed={ui.pinned.includes(it.id)} onclick={() => toggleIn('pinned', it.id)}>pin</button>
                  <button class="lab-chip py-0.5" aria-pressed={ui.excluded.includes(it.id)} onclick={() => toggleIn('excluded', it.id)}>exclude</button>
                </td>
                <td><button class="lab-btn py-0.5" onclick={() => setOwned(it.id, false)} aria-label="Remove">✕</button></td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
      {#if ui.excluded.length}
        <p class="m-0 mt-2 text-[12px] text-dim">Excluded: {ui.excluded.map((id) => ds.byId.get(id)?.name ?? id).join(', ')}
          <button class="ml-2 cursor-pointer underline" onclick={() => (ui.excluded = [])}>clear</button></p>
      {/if}
    </div>
  </div>
</section>
