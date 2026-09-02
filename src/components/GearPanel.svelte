<script>
  import { prefixesFor } from '../lib/stats.js';
  import { setOwned, toggleIn, ui } from '../lib/state.svelte.js';

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

<section class="lab-panel mx-4 mb-4 p-4">
  <header class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
    <h2 class="text-[13px] uppercase tracking-[0.1em] text-ink2">My gear</h2>
    <p class="m-0 text-[12px] text-dim">Mark what you own and how it is reforged. "Gear from: only what I own" solves from this list; pins force an item into the loadout, exclusions keep it out.</p>
  </header>
  <div class="grid gap-4 md:grid-cols-[1fr_1.4fr]">
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
      <span class="lab-label mb-1">Owned ({owned.length})</span>
      {#if !owned.length}
        <p class="m-0 text-[12.5px] text-dim">Nothing yet. Add items here or tick "I own this" on any item card.</p>
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
                    <select class="lab-input w-auto py-0.5" value={ui.owned[it.id]?.prefix ?? ''} onchange={(e) => setOwned(it.id, true, e.currentTarget.value || null)}>
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
