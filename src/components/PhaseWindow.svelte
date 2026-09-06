<script>
  /**
   * The roomy view of an attack graph: fitted to the window when it opens, then zoomable. The item
   * card and the browser's expanded row both open one, so it lives here rather than as a copy in
   * each — a weapon with two loops has two graphs to show and neither view should drift.
   */
  import { tick } from 'svelte';
  import PhaseGraph from './PhaseGraph.svelte';
  import Info from './Info.svelte';

  let { ds, id = 'phasegraph', title = '', accent, phases = [], total = null, mode = null, legend = null } = $props();

  // the same fit the crafting tree uses: shrink a big graph only to where the labels stay readable,
  // grow a small one instead of leaving it at 100% in the middle of the window
  const MIN_FIT = 0.3;
  const MAX_FIT = 1.6;
  const r2 = (v) => Math.round(v * 100) / 100;
  let box = $state(null);
  let inner = $state(null);
  let zoom = $state(1);
  let w = $state(0);
  let h = $state(0);
  async function fit() {
    await tick();
    // measured by hand: a size binding only catches up a frame after the popover gets laid out,
    // and `offset*` is the graph's own size whatever it is scaled to
    w = inner?.offsetWidth ?? 0;
    h = inner?.offsetHeight ?? 0;
    if (!box?.clientWidth || !w || !h) return;
    const pad = 32;
    zoom = Math.min(MAX_FIT, Math.max(MIN_FIT, Math.floor(Math.min((box.clientWidth - pad) / w, (box.clientHeight - pad) / h) * 100) / 100));
  }
</script>

<div {id} popover="auto" class="lab-pop col p-0" style="--w:85vw; --accent:{accent}; height:85vh; overflow:hidden"
     ontoggle={(e) => e.newState === 'open' && fit()}>
  <div class="lab-head shrink-0">
    <h2>{title}</h2>
    {#if legend}<Info label="Reading the attack graph" w={360}>{@render legend()}</Info>{/if}
    <span class="lab-meta">
      <span class="flex items-center gap-1">
        <button class="lab-btn px-2 py-0.5" onclick={() => (zoom = Math.max(MIN_FIT, r2(zoom - 0.15)))} aria-label="Zoom out">−</button>
        <button class="lab-btn px-2 py-0.5 tabular-nums" onclick={fit} title="Fit the whole graph into the window">{Math.round(zoom * 100)}%</button>
        <button class="lab-btn px-2 py-0.5" onclick={() => (zoom = Math.min(MAX_FIT, r2(zoom + 0.15)))} aria-label="Zoom in">+</button>
      </span>
      <button class="lab-btn py-0.5" popovertarget={id} popovertargetaction="hide">Done</button>
    </span>
  </div>
  <div bind:this={box} class="min-h-0 flex-1 overflow-auto p-4" style="display:grid; place-content:safe center">
    <!-- the outer box takes the scaled size so the window scrolls and centres on it; the inner one
         is the graph at 100%, which is what gets measured for the fit -->
    <div style="width:{Math.ceil(w * zoom)}px; height:{Math.ceil(h * zoom)}px">
      <div bind:this={inner} style="width:max-content; transform:scale({zoom}); transform-origin:top left">
        <PhaseGraph {ds} {phases} {total} {mode} />
      </div>
    </div>
  </div>
</div>
