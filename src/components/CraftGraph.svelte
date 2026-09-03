<script>
  /** The chosen recipe drawn as a tree: root on the left, ingredients branching right. */
  import { elbow, layout, toDisplay } from '../lib/treelayout.js';
  import WikiIcon from './WikiIcon.svelte';

  let { ds, tree, onselect = null, scale = 1 } = $props();
  const g = $derived(layout(toDisplay(tree)));
  const others = $derived(tree.recipes?.filter((r) => !r.chosen) ?? []);
  let showOthers = $state(false);

  // ingredients are mostly materials, which live in their own table rather than in byId; a station
  // is a tile with no item id at all, but nearly every one is also a placeable material by name
  const byName = $derived(new Map(Object.values(ds.materials).map((m) => [m.name, m])));
  const icon = (n) => (n.id ? ds.byId.get(n.id) ?? ds.materials[n.id] : byName.get(n.name)) ?? null;
  const recipeLine = (r) => r.ingredients
    .map((c) => `${c.n > 1 ? c.n + '× ' : ''}${c.node.name}`)
    .concat(r.groups.map((x) => x.label), r.stations.map((s) => `@ ${s.name}`))
    .join(', ');
  const recipeStage = (r) => ds.stages[Math.max(0, ds.stages.findLastIndex((s) => s.progression <= r.prog + 1e-6))]?.label ?? '?';
</script>

<div style="width:{Math.ceil(g.width * scale)}px; height:{Math.ceil(g.height * scale)}px">
  <div class="relative" style="width:{g.width}px; height:{g.height}px; transform:scale({scale}); transform-origin:0 0">
    <svg class="pointer-events-none absolute inset-0" width={g.width} height={g.height} aria-hidden="true">
      {#each g.edges as e, i (i)}
        <path d={elbow(e)} fill="none" shape-rendering="crispEdges"
              stroke={e.gating ? 'var(--color-warn)' : 'var(--color-line-strong)'} stroke-width={e.gating ? 1.5 : 1} />
      {/each}
    </svg>

    {#each g.nodes as n (n.i)}
      {@const clickable = n.equip && n.id && onselect}
      <svelte:element this={clickable ? 'button' : 'div'} role={clickable ? 'button' : undefined}
        class="craft-box" class:gating={n.gating} class:root={n.depth === 0} class:station={n.kind === 'station'}
        style="left:{n.x}px; top:{n.y}px; width:{n.w}px; height:{n.h}px"
        onclick={clickable ? () => onselect(n.id) : undefined}
        title="{n.name}{n.via ? ` — ${n.via}` : ''}{n.gate ? ` — ${n.gate}` : ''}{n.alt?.length ? `\nor ${n.alt.join(', ')}` : ''}">
        {#if icon(n)}
          <WikiIcon item={icon(n)} size={22} />
        {:else if n.kind === 'station'}
          <span class="w-4 shrink-0 text-center text-dim">⌂</span>
        {:else}
          <span class="w-4 shrink-0 text-center text-dim">·</span>
        {/if}
        <span class="min-w-0 flex-1">
          <span class="block truncate font-medium">{#if n.n > 1}<span class="num text-dim">{n.n}×</span> {/if}{n.name}</span>
          <span class="block truncate text-[10.5px] text-dim">
            <span class="craft-stage" class:warn={n.gating && n.prog > 0}>{n.stageLabel}</span>
            {n.via ?? n.gate ?? ''}
          </span>
        </span>
      </svelte:element>
    {/each}
  </div>
</div>

{#if others.length}
  <div class="mt-2">
    <button class="cursor-pointer text-[11.5px] text-dim underline decoration-line underline-offset-2 hover:text-green" onclick={() => (showOthers = !showOthers)}>
      {showOthers ? 'hide' : 'show'} {others.length} other recipe{others.length > 1 ? 's' : ''}
    </button>
    {#if showOthers}
      {#each others as r (r.index)}
        <div class="mt-1 text-[12px]">
          <span class="lab-tag mr-1">{recipeStage(r)}</span><span class="text-dim">{recipeLine(r)}</span>
        </div>
      {/each}
    {/if}
  </div>
{/if}
