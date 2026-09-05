<script>
  /** The chosen recipe drawn as a tree: root on the left, ingredients branching right. */
  import { elbow, layout, toDisplay } from '../lib/treelayout.js';
  import { craftTree } from '../lib/sources.js';
  import WikiIcon from './WikiIcon.svelte';

  let { ds, tree, onselect = null, scale = 1, zoomable = false } = $props();
  // `scale` is the size the caller wants; when the graph carries its own controls that is only the
  // starting point, and the buttons take it from there
  const clamp = (z) => Math.round(Math.min(1.6, Math.max(0.3, z)) * 100) / 100;
  // A fit is rounded to whole percents, and rounding it *up* is what put a sliver of scrollbar under
  // half of them (the box is ceil(width × zoom), so half a percent of a 1000px tree is 5px over).
  // Always take the percent below the exact fit: then ceil(width × zoom) ≤ the room measured.
  const fitTo = (w, h) => Math.floor(Math.min(w / g.width, h / g.height) * 100) / 100;
  let step = $state(0);
  // Walking into an ingredient from inside the big window: the window is in the top layer, so the
  // item card that `onselect` opens lands *behind* it and the click reads as doing nothing. Follow
  // the node here instead — the window shows that item's tree, and `trail` is the way back. Dropped
  // when the window closes, so the small graph in the row behind it is always the row's own item.
  let trail = $state([]); // [{ id, name }], deepest last
  const walked = $derived(trail.length ? craftTree(ds, trail.at(-1).id) : null);
  const g = $derived(layout(toDisplay(walked ?? tree)));
  const backTo = $derived(trail.length > 1 ? trail.at(-2).name : tree?.name ?? 'the tree');
  let popOpen = $state(false);
  function follow(id, name) {
    if (popOpen) {
      if (craftTree(ds, id)?.recipes?.length) { trail = [...trail, { id, name }]; return; }
      document.getElementById(popId)?.hidePopover(); // nothing to walk into: get out of the card's way
    }
    onselect(id);
  }
  // The viewport is a fixed box, so a two-ingredient tree sat in the middle of it at the caller's
  // scale while there was room for twice that. The start zoom grows a small tree into the box (up to
  // clamp's 1.6) and leaves a big one at the caller's scale to be scrolled — shrinking one into
  // 340px would only make its labels unreadable. `scrollbar-gutter` keeps the measured width free of
  // the scrollbar the zoom itself can bring in, so the fit cannot chase its own tail.
  const VIEW_H = 340; // the max-h below
  const PAD = 8; // the p-1 around the graph
  let viewW = $state(0);
  const fitted = $derived(viewW ? clamp(Math.max(scale, fitTo(viewW - PAD, VIEW_H - PAD))) : scale);
  const zoom = $derived(zoomable ? clamp(fitted + step * 0.15) : scale);
  // the roomy view, in the popover every other big view in the app uses
  const popId = $props.id();
  let fullEl = $state(null);
  let fullZoom = $state(1);
  const fit = () => {
    if (!fullEl?.clientWidth) return; // closed: it has no size to fit to yet
    const pad = 32; // the p-4 around the graph
    // fits both ways: a small tree grows into the window (up to clamp's 1.6) instead of sitting at
    // 100% in the middle of it, a big one shrinks until it is all on screen
    fullZoom = clamp(fitTo(fullEl.clientWidth - pad, fullEl.clientHeight - pad));
  };
  // following a node into another item swaps the tree out from under an open window: fit the new one
  $effect(() => { void g; fit(); });
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

{#snippet graph(z)}
<div style="width:{Math.ceil(g.width * z)}px; height:{Math.ceil(g.height * z)}px">
  <div class="relative" style="width:{g.width}px; height:{g.height}px; transform:scale({z}); transform-origin:0 0">
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
        onclick={clickable ? () => follow(n.id, n.name) : undefined}
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
{/snippet}

{#if zoomable}
  <!-- with controls the graph owns its viewport, so the buttons can float over a scrolled tree -->
  <div class="relative border border-line bg-panel2/40">
    <!-- top left: the root sits centred on the left edge, so the corner above it is the one reliably
         empty spot — the top right is where the deepest ingredients stack up -->
    <div class="absolute left-1.5 top-1.5 z-10 flex items-center gap-1">
      <button type="button" class="lab-btn px-2 py-0.5" onclick={() => (step -= 1)} disabled={zoom <= 0.3} aria-label="Zoom out" title="Draw the tree smaller">−</button>
      <button type="button" class="lab-btn num px-2 py-0.5" onclick={() => (step = 0)} title="Go back to the starting zoom">{Math.round(zoom * 100)}%</button>
      <button type="button" class="lab-btn px-2 py-0.5" onclick={() => (step += 1)} disabled={zoom >= 1.6} aria-label="Zoom in" title="Draw the tree bigger">+</button>
      <button type="button" class="lab-btn px-2 py-0.5" popovertarget={popId} title="Open the whole tree in a bigger view">⤢</button>
    </div>
    <div class="max-h-[340px] overflow-auto p-1" style="display:grid; place-content:safe center; scrollbar-gutter:stable" bind:clientWidth={viewW}>{@render graph(zoom)}</div>
  </div>

  <div id={popId} popover="auto" class="lab-pop col p-0" style="--w:85vw; height:85vh; overflow:hidden"
       ontoggle={(ev) => { popOpen = ev.newState === 'open'; if (popOpen) fit(); else trail = []; }}>
    <div class="lab-head shrink-0">
      <h2>How to get {g.root?.name ?? 'it'}</h2>
      <span class="lab-meta">
        {#if trail.length}
          <button type="button" class="lab-btn px-2 py-0.5" onclick={() => (trail = trail.slice(0, -1))} title="Back to how you get {backTo}">← {backTo}</button>
        {/if}
        <span class="flex items-center gap-1">
          <button type="button" class="lab-btn px-2 py-0.5" onclick={() => (fullZoom = clamp(fullZoom - 0.15))} aria-label="Zoom out" title="Draw the tree smaller">−</button>
          <button type="button" class="lab-btn num px-2 py-0.5" onclick={fit} title="Fit the whole tree into the window">{Math.round(fullZoom * 100)}%</button>
          <button type="button" class="lab-btn px-2 py-0.5" onclick={() => (fullZoom = clamp(fullZoom + 0.15))} aria-label="Zoom in" title="Draw the tree bigger">+</button>
        </span>
        <button type="button" class="lab-btn py-0.5" popovertarget={popId} popovertargetaction="hide">Done</button>
      </span>
    </div>
    <!-- `safe` keeps a tree bigger than the window scrollable from its top-left instead of
         centring it into its own clipped edges -->
    <div bind:this={fullEl} class="min-h-0 flex-1 overflow-auto p-4" style="display:grid; place-content:safe center">
      {@render graph(fullZoom)}
    </div>
  </div>
{:else}
  {@render graph(scale)}
{/if}

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
