<script>
  import { CLASS_LABELS, accentOf, eraOf } from '../lib/dataset.js';
  import { ui } from '../lib/state.svelte.js';
  import WikiIcon from './WikiIcon.svelte';

  let { ds, timeline, onselect } = $props();
  let onlyChanges = $state(true);
  const rows = $derived(onlyChanges ? timeline.filter((r) => r.changes.size) : timeline);
  const accent = $derived(accentOf(timeline[0]?.loadout.cls));
  const short = (name) => name.replace(/ (Helmet|Headgear|Mask|Hood|Hat|Helm|Visage|Headpiece|Crown|Cowl|Head|Breastplate|Chestplate|Plate Mail|Leggings|Greaves|Pants|Cuisses)$/i, '');
</script>

<section class="lab-panel overflow-hidden" style="--accent:{accent}">
  <header class="lab-head">
    <h2>{CLASS_LABELS[timeline[0]?.loadout.cls]} through the game</h2>
    <span class="lab-meta">
      <label class="flex cursor-pointer items-center gap-1.5"><input type="checkbox" bind:checked={onlyChanges} /> only stages where something changes</label>
      <span><span class="num font-semibold text-ink">{rows.length}</span> of {timeline.length} stages</span>
    </span>
  </header>
  <div class="overflow-x-auto">
    <table class="lab-table min-w-[940px]">
      <thead>
        <tr><th class="w-56">After</th><th class="w-56">Armor</th><th class="w-60">Best weapon</th><th>Accessories</th></tr>
      </thead>
      <tbody>
        {#each rows as r}
          {@const lo = r.loadout}
          {@const era = eraOf(r.stage)}
          <tr class="cursor-default align-top transition-colors hover:bg-panel2">
            <td class="relative pl-3.5">
              <span class="absolute inset-y-0 left-0 w-[3px]" style="background:{era.color}"></span>
              <button class="cursor-pointer text-left font-medium hover:text-green" onclick={() => { ui.stage = r.stage.index; ui.mode = 'loadout'; }} title="Open this stage in the loadout view">{r.stage.label}</button>
              <div class="text-[11px] text-dim">
                <span class="num">#{r.stage.index}</span>{r.stage.mod !== 'v' ? ` · ${ds.modById.get(r.stage.mod)?.name ?? r.stage.mod}` : ''}
              </div>
            </td>
            <td class:bg-green-soft={r.changes.has('armor')}>
              {#if lo.armor}
                <button class="flex cursor-pointer items-center gap-1.5 text-left hover:text-green" onclick={() => onselect(lo.armor.head.item.id)}>
                  <WikiIcon item={lo.armor.head.item} size={22} />
                  <span>
                    <div class="font-medium">{lo.armor.isSet ? short(lo.armor.head.item.name) : `${short(lo.armor.head.item.name)} / ${short(lo.armor.body.item.name)} / ${short(lo.armor.legs.item.name)}`}</div>
                    <div class="text-[11px] text-dim">{lo.armor.isSet ? 'set' : 'mixed'} · <span class="num">{lo.armor.defense}</span> def · score <span class="num">{lo.armor.score}</span></div>
                  </span>
                </button>
              {:else}<span class="text-dim">–</span>{/if}
            </td>
            <td class:bg-green-soft={r.changes.has('weapon')}>
              {#if lo.weapons[0]}
                <button class="flex cursor-pointer items-center gap-1.5 text-left hover:text-green" onclick={() => onselect(lo.weapons[0].item.id)}>
                  <WikiIcon item={lo.weapons[0].item} size={22} />
                  <span>
                    <div class="font-medium">{lo.weapons[0].item.name}</div>
                    <div class="text-[11px] text-dim"><span class="num">{Math.round(lo.weapons[0].value)}</span> {lo.weapons[0].kind}{lo.weapons[1] ? ` · then ${lo.weapons[1].item.name}` : ''}</div>
                  </span>
                </button>
              {:else}<span class="text-dim">–</span>{/if}
            </td>
            <td class:bg-green-soft={r.changes.has('accessories')}>
              <div class="flex flex-wrap gap-x-1 gap-y-1">
                {#if lo.wings?.[0]}
                  <button class="lab-chip py-0 text-[11.5px] font-normal" title="best wings" onclick={() => onselect(lo.wings[0].item.id)}><span class="text-dim">wings</span> {lo.wings[0].item.name} <span class="num text-[10.5px] text-dim">{lo.wings[0].score}</span></button>
                {/if}
                {#if lo.boots?.[0]}
                  <button class="lab-chip py-0 text-[11.5px] font-normal" title="best boots" onclick={() => onselect(lo.boots[0].item.id)}><span class="text-dim">boots</span> {lo.boots[0].item.name} <span class="num text-[10.5px] text-dim">{lo.boots[0].score}</span></button>
                {/if}
                {#each lo.accessories as a}
                  <button class="lab-chip py-0 text-[11.5px] font-normal" onclick={() => onselect(a.item.id)}>{a.item.name} <span class="num text-[10.5px] text-dim">{a.score}</span></button>
                {/each}
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <p class="border-t border-line px-4 py-2 text-[11.5px] text-dim">Green cells are the stages where that part of the loadout changes. Click a stage name to jump the loadout view there.</p>
</section>
