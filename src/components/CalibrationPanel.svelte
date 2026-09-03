<script>
  import { slide } from 'svelte/transition';
  import { CLASS_LABELS } from '../lib/dataset.js';
  import { prefixesFor } from '../lib/stats.js';
  import { ui } from '../lib/state.svelte.js';
  import Info from './Info.svelte';

  let { ds, calibration, onselect } = $props();
  let query = $state('');
  const hits = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return ds.items.filter((it) => it.slot === 'weapon' && it.name.toLowerCase().includes(q)).slice(0, 10);
  });
  function add(it) {
    ui.samples = [...ui.samples, { id: it.id, damage: '', crit: '', prefix: null, bonusDamage: 0, bonusCrit: 0 }];
    query = '';
  }
  function update(i, patch) {
    ui.samples = ui.samples.map((s, j) => (j === i ? { ...s, ...patch } : s));
  }
  function remove(i) {
    ui.samples = ui.samples.filter((_, j) => j !== i);
  }
  const fmt = (v) => (v === null || v === undefined ? '–' : Math.round(v * 10) / 10);
</script>

<section class="lab-panel mx-5 mb-4 overflow-hidden" transition:slide={{ duration: 180 }}>
  <header class="lab-head">
    <h2>Calibrate against the game</h2>
    <Info label="How calibration works" w={420}>
      <p>Enter a few weapons with the damage the game shows in their tooltip. Best done on a character with no armor, accessories or buffs — otherwise put your character's bonus damage and crit into the two bonus fields so they can be divided out.</p>
      <p>Each sample gives <em>observed ÷ predicted</em>; the median per class becomes a factor applied to every prediction of that class, and other classes fall back to the overall median.</p>
      <p>Large errors point at items whose modifiers the miner missed — those are worth reporting.</p>
    </Info>
    <span class="lab-meta">
      <label class="flex cursor-pointer items-center gap-1.5"><input type="checkbox" bind:checked={ui.calibrate} /> apply the fitted factors</label>
    </span>
  </header>

  <div class="grid gap-4 p-4 md:grid-cols-[1fr_2fr]">
    <div>
      <span class="lab-label mb-1">Add a weapon</span>
      <input class="lab-input" placeholder="Type a name…" bind:value={query} />
      {#if hits.length}
        <ul class="m-0 mt-1 list-none border border-line p-0">
          {#each hits as it}
            <li class="flex items-center justify-between gap-2 border-b border-line px-2 py-1 text-[12.5px] last:border-0">
              <span>{it.name} <span class="text-dim">· {it.modName} · {CLASS_LABELS[it.cls] ?? it.cls}</span></span>
              <button class="lab-btn py-0.5" onclick={() => add(it)}>add</button>
            </li>
          {/each}
        </ul>
      {/if}
      {#if calibration?.sampleCount}
        <div class="mt-3">
          <span class="lab-label mb-1">Fitted factors</span>
          <table class="lab-table">
            <tbody>
              {#each Object.entries(calibration.factors) as [cls, f]}
                <tr><td>{cls === 'all' ? 'all classes (fallback)' : CLASS_LABELS[cls] ?? cls}</td><td class="num text-right">×{Math.round(f * 1000) / 1000}</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
    <div>
      <span class="lab-label mb-1">Samples</span>
      {#if !ui.samples.length}
        <p class="m-0 text-[12.5px] text-dim">No samples yet.</p>
      {:else}
        <div class="overflow-x-auto">
          <table class="lab-table min-w-[700px]">
            <thead><tr><th>Weapon</th><th>Reforge</th><th class="text-right">Observed dmg</th><th class="text-right">Observed crit %</th><th class="text-right">Your +dmg %</th><th class="text-right">Your +crit</th><th class="text-right">Predicted</th><th class="text-right">Error</th><th></th></tr></thead>
            <tbody>
              {#each ui.samples as s, i (s.id + i)}
                {@const it = ds.byId.get(s.id)}
                {@const row = calibration?.rows.find((r) => r.sample === s)}
                {#if it}
                  <tr>
                    <td><button class="cursor-pointer text-left font-medium hover:text-green" onclick={() => onselect(it.id)}>{it.name}</button><div class="text-[11px] text-dim">{CLASS_LABELS[it.cls] ?? it.cls}</div></td>
                    <td>
                      <select class="lab-input w-auto max-w-[140px] py-0.5" value={s.prefix ?? ''} onchange={(e) => update(i, { prefix: e.currentTarget.value || null })}>
                        <option value="">none</option>
                        {#each prefixesFor(it, ds.prefixes, ds.aliases) as p}<option value={p.id}>{p.name}</option>{/each}
                      </select>
                    </td>
                    <td><input type="number" class="lab-input w-20 py-0.5 text-right" value={s.damage} oninput={(e) => update(i, { damage: Number(e.currentTarget.value) })} /></td>
                    <td><input type="number" class="lab-input w-20 py-0.5 text-right" value={s.crit} oninput={(e) => update(i, { crit: e.currentTarget.value === '' ? '' : Number(e.currentTarget.value) })} /></td>
                    <td><input type="number" class="lab-input w-16 py-0.5 text-right" value={Math.round((s.bonusDamage ?? 0) * 100)} oninput={(e) => update(i, { bonusDamage: Number(e.currentTarget.value) / 100 })} /></td>
                    <td><input type="number" class="lab-input w-16 py-0.5 text-right" value={s.bonusCrit ?? 0} oninput={(e) => update(i, { bonusCrit: Number(e.currentTarget.value) })} /></td>
                    <td class="num text-right">{row ? row.predicted : '–'}{#if row?.critPredicted !== null && row?.critPredicted !== undefined}<div class="text-[11px] text-dim">crit {fmt(row.critPredicted)}</div>{/if}</td>
                    <td class="num text-right" class:text-bad={row && Math.abs(row.err) > 5} class:text-green-deep={row && Math.abs(row.err) <= 5}>
                      {row ? `${row.err > 0 ? '+' : ''}${fmt(row.err)}%` : '–'}
                      {#if row?.critErr !== null && row?.critErr !== undefined}<div class="text-[11px] text-dim">crit {row.critErr > 0 ? '+' : ''}{fmt(row.critErr)}</div>{/if}
                    </td>
                    <td><button class="lab-btn py-0.5" onclick={() => remove(i)} aria-label="Remove">✕</button></td>
                  </tr>
                {/if}
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  </div>
</section>
