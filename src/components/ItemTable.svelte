<script>
  import { CLASS_LABELS, SLOT_LABELS } from '../lib/dataset.js';
  import { pieceScore, weaponDps } from '../lib/score.js';
  import { ui } from '../lib/state.svelte.js';

  let { ds, statCtx, onselect } = $props();
  let page = $state(0);
  const PAGE = 60;

  const contentMods = $derived(ds.mods.filter((m) => m.equipment > 0));
  const excluded = $derived(new Set(ui.excludedMods));

  /** value used by the "score" column: DPS for weapons, class score for gear */
  function valueOf(it) {
    if (it.slot === 'weapon') return weaponDps(it, statCtx).value;
    return pieceScore(it, ui.cls, ds.aliases).score;
  }

  const filtered = $derived.by(() => {
    const q = ui.query.trim().toLowerCase();
    const out = [];
    for (const it of ds.items) {
      if (excluded.has(it.mod)) continue;
      if (ui.stageFilter === 'current') {
        if (it.stage === null || it.stage === undefined) { if (!ui.unknownStage) continue; } else if (it.stage > ui.stage) continue;
      }
      if (ui.slotFilter !== 'all' && it.slot !== ui.slotFilter) continue;
      if (ui.classFilter !== 'all' && it.cls !== ui.classFilter) continue;
      if (ui.modFilter !== 'all' && it.mod !== ui.modFilter) continue;
      if (q && !it.name.toLowerCase().includes(q) && !(it.tooltip ?? '').toLowerCase().includes(q)) continue;
      out.push(it);
    }
    return out;
  });

  const sorted = $derived.by(() => {
    const k = ui.sortK;
    const dir = ui.sortDir;
    const val = (it) => {
      switch (k) {
        case 'name': return it.name;
        case 'mod': return it.modName;
        case 'slot': return it.slot;
        case 'class': return it.cls ?? '';
        case 'damage': return it.damage ?? -1;
        case 'defense': return it.defense ?? -1;
        case 'stage': return it.stage ?? 999;
        case 'value': return valueOf(it);
        default: return it.name;
      }
    };
    return [...filtered].sort((a, b) => {
      const va = val(a); const vb = val(b);
      const c = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      return c !== 0 ? c * dir : a.name.localeCompare(b.name);
    });
  });
  const pageItems = $derived(sorted.slice(page * PAGE, page * PAGE + PAGE));
  const pages = $derived(Math.max(1, Math.ceil(sorted.length / PAGE)));
  $effect(() => { void [ui.query, ui.slotFilter, ui.classFilter, ui.modFilter, ui.stageFilter, ui.stage, ui.sortK, ui.sortDir]; page = 0; });

  function sortBy(k) {
    if (ui.sortK === k) ui.sortDir = -ui.sortDir;
    else { ui.sortK = k; ui.sortDir = k === 'name' || k === 'mod' || k === 'slot' || k === 'class' ? 1 : -1; }
  }
  const arrow = (k) => (ui.sortK === k ? (ui.sortDir > 0 ? ' ↑' : ' ↓') : '');
  const fmt = (v) => (v === null || v === undefined ? '–' : v >= 1000 ? Math.round(v).toLocaleString() : Math.round(v * 10) / 10);
</script>

<section class="lab-panel">
  <header class="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
    <h2 class="mr-2 text-[13px] uppercase tracking-[0.1em] text-ink2">Items</h2>
    <input class="lab-input w-56" placeholder="Search name or tooltip…" bind:value={ui.query} />
    <select class="lab-input w-auto" bind:value={ui.slotFilter}>
      <option value="all">All slots</option>
      {#each Object.entries(SLOT_LABELS) as [k, v]}<option value={k}>{v}</option>{/each}
    </select>
    <select class="lab-input w-auto" bind:value={ui.classFilter}>
      <option value="all">All classes</option>
      {#each ds.classList as c}<option value={c}>{CLASS_LABELS[c]}</option>{/each}
      <option value="classless">Classless</option>
      <option value="other">Other</option>
    </select>
    <select class="lab-input w-auto" bind:value={ui.modFilter}>
      <option value="all">All mods</option>
      {#each contentMods as m}<option value={m.id}>{m.name}</option>{/each}
    </select>
    <select class="lab-input w-auto" bind:value={ui.stageFilter}>
      <option value="current">Up to current stage</option>
      <option value="all">Every stage</option>
    </select>
    <span class="ml-auto text-[12px] text-dim"><span class="num">{sorted.length.toLocaleString()}</span> items</span>
  </header>
  <div class="overflow-x-auto">
    <table class="lab-table min-w-[820px]">
      <thead>
        <tr>
          <th class="sortable" onclick={() => sortBy('name')}>Name{arrow('name')}</th>
          <th class="sortable" onclick={() => sortBy('mod')}>Mod{arrow('mod')}</th>
          <th class="sortable" onclick={() => sortBy('slot')}>Slot{arrow('slot')}</th>
          <th class="sortable" onclick={() => sortBy('class')}>Class{arrow('class')}</th>
          <th class="sortable text-right" onclick={() => sortBy('damage')}>Dmg{arrow('damage')}</th>
          <th class="sortable text-right" onclick={() => sortBy('defense')}>Def{arrow('defense')}</th>
          <th class="sortable text-right" onclick={() => sortBy('value')} title="DPS for weapons, class score for armor and accessories">DPS / score{arrow('value')}</th>
          <th class="sortable" onclick={() => sortBy('stage')}>Obtainable after{arrow('stage')}</th>
        </tr>
      </thead>
      <tbody>
        {#each pageItems as it (it.id)}
          <tr class="cursor-pointer" onclick={() => onselect(it.id)}>
            <td class="font-medium">{it.name}{#if it.expert}<span class="lab-tag ml-1.5">expert</span>{/if}{#if ui.owned[it.id]}<span class="lab-tag green ml-1.5">yours</span>{/if}{#if it.changes?.length}<span class="lab-tag warn ml-1.5" title="rebalanced by another mod">rebalanced</span>{/if}</td>
            <td class="text-dim">{it.modName}</td>
            <td><span class="lab-tag">{it.slot}</span></td>
            <td>{it.cls ? CLASS_LABELS[it.cls] ?? it.cls : '–'}</td>
            <td class="num text-right">{it.damage ?? '–'}</td>
            <td class="num text-right">{it.defense ?? '–'}</td>
            <td class="num text-right">{fmt(valueOf(it))}</td>
            <td class="text-[12px]">
              {it.stageLabel}
              <span class="lab-tag ml-1" class:warn={it.stageSource.kind === 'rarity' || it.stageSource.kind === 'unknown'} title={it.stageSource.kind === 'rarity' ? 'guessed from rarity' : it.stageSource.kind}>{it.stageSource.kind}</span>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  {#if pages > 1}
    <div class="flex items-center justify-end gap-2 border-t border-line px-4 py-2 text-[12px]">
      <button class="lab-btn py-0.5" disabled={page === 0} onclick={() => (page = Math.max(0, page - 1))}>‹ prev</button>
      <span class="num text-dim">{page + 1} / {pages}</span>
      <button class="lab-btn py-0.5" disabled={page >= pages - 1} onclick={() => (page = Math.min(pages - 1, page + 1))}>next ›</button>
    </div>
  {/if}
</section>
