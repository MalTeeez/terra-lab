<script>
  import { CLASS_LABELS } from '../lib/dataset.js';

  let { ds, timeline, onselect } = $props();
  let onlyChanges = $state(true);
  const rows = $derived(onlyChanges ? timeline.filter((r) => r.changes.size) : timeline);
  const short = (name) => name.replace(/ (Helmet|Headgear|Mask|Hood|Hat|Helm|Visage|Headpiece|Crown|Cowl|Head|Breastplate|Chestplate|Plate Mail|Leggings|Greaves|Pants|Cuisses)$/i, '');
</script>

<section class="lab-panel">
  <header class="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-2.5">
    <h2 class="text-[13px] uppercase tracking-[0.1em] text-ink2">{CLASS_LABELS[timeline[0]?.loadout.cls]} through the game</h2>
    <label class="flex items-center gap-1.5 text-[12.5px]"><input type="checkbox" bind:checked={onlyChanges} /> only stages where the loadout changes</label>
  </header>
  <div class="overflow-x-auto">
    <table class="lab-table min-w-[900px]">
      <thead>
        <tr><th class="w-52">After</th><th class="w-56">Armor</th><th class="w-56">Best weapon</th><th>Accessories</th></tr>
      </thead>
      <tbody>
        {#each rows as r}
          {@const lo = r.loadout}
          <tr>
            <td>
              <div class="font-medium">{r.stage.label}</div>
              <div class="text-[11px] text-dim">{r.stage.index === 0 ? 'start' : `#${r.stage.index}`}{r.stage.mod !== 'v' ? ` · ${ds.modById.get(r.stage.mod)?.name ?? r.stage.mod}` : ''}</div>
            </td>
            <td class:bg-green-soft={r.changes.has('armor')}>
              {#if lo.armor}
                <button class="cursor-pointer text-left hover:text-green" onclick={() => onselect(lo.armor.head.item.id)}>
                  <div class="font-medium">{lo.armor.isSet ? short(lo.armor.head.item.name) : `${short(lo.armor.head.item.name)} / ${short(lo.armor.body.item.name)} / ${short(lo.armor.legs.item.name)}`}</div>
                  <div class="text-[11px] text-dim">{lo.armor.isSet ? 'set' : 'mixed'} · <span class="num">{lo.armor.defense}</span> def · <span class="num">{lo.armor.score}</span></div>
                </button>
              {:else}<span class="text-dim">–</span>{/if}
            </td>
            <td class:bg-green-soft={r.changes.has('weapon')}>
              {#if lo.weapons[0]}
                <button class="cursor-pointer text-left hover:text-green" onclick={() => onselect(lo.weapons[0].item.id)}>
                  <div class="font-medium">{lo.weapons[0].item.name}</div>
                  <div class="text-[11px] text-dim"><span class="num">{Math.round(lo.weapons[0].value)}</span> {lo.weapons[0].kind}{lo.weapons[1] ? ` · then ${lo.weapons[1].item.name}` : ''}</div>
                </button>
              {:else}<span class="text-dim">–</span>{/if}
            </td>
            <td class:bg-green-soft={r.changes.has('accessories')}>
              <div class="flex flex-wrap gap-x-3 gap-y-0.5">
                {#each lo.accessories as a}
                  <button class="cursor-pointer whitespace-nowrap hover:text-green" onclick={() => onselect(a.item.id)}>{a.item.name} <span class="num text-[11px] text-dim">{a.score}</span></button>
                {/each}
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>
