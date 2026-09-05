<script>
  /** A two-handle range that keeps expensive parent filtering out of the drag path. */
  let { lo, hi, min, max, format, accent, chevrons, oncommit, icon } = $props();

  let draftLo = $state(null);
  let draftHi = $state(null);
  let editing = $state(false);

  const width = $derived(Math.max(1, max - min));
  const currentLo = $derived(draftLo ?? lo);
  const currentHi = $derived(draftHi ?? hi);
  // Caps always live on two rows so the container height stays put while dragging — the
  // conditional "stack when close" used to snap the whole layout at the crossover point.
  const crowded = $derived((currentHi - currentLo) / width < 0.1);

  $effect(() => {
    if (!editing) {
      draftLo = null;
      draftHi = null;
    }
  });

  const setLo = (value) => {
    editing = true;
    draftLo = Math.min(Number(value), currentHi);
  };
  const setHi = (value) => {
    editing = true;
    draftHi = Math.max(Number(value), currentLo);
  };
  const commit = () => {
    if (!editing) return;
    oncommit(currentLo, currentHi);
    editing = false;
  };
</script>

<!-- Values update immediately while dragging; the parent applies the costly filter once on release. -->
<div class="lab-range stacked" class:crowded style="--lo:{((currentLo - min) / width) * 100}%; --hi:{((currentHi - min) / width) * 100}%; --accent:{accent}; {chevrons}">
  {#if icon}
    <!-- Fixed corners: the caps track the handles and the sprites would jump with them; a still icon
         at each end says which stage the slider is anchored at without moving out from under the cursor. -->
    <span class="cap-icon left" title={format(currentLo)}>{@render icon(currentLo)}</span>
    <span class="cap-icon right" title={format(currentHi)}>{@render icon(currentHi)}</span>
  {/if}
  <span class="cap up" class:off={currentLo <= min} style="--pos:var(--lo)" title={format(currentLo)}>{#if currentLo > min}&ge; {/if}{format(currentLo)}</span>
  <span class="cap" class:off={currentHi >= max} style="--pos:var(--hi)" title={format(currentHi)}>{#if currentHi < max}&le; {/if}{format(currentHi)}</span>
  <div class="track"></div><div class="span"></div>
  <input type="range" {min} {max} value={currentLo} oninput={(event) => setLo(event.currentTarget.value)} onchange={commit} onblur={commit} aria-label="minimum" />
  <input type="range" {min} {max} value={currentHi} oninput={(event) => setHi(event.currentTarget.value)} onchange={commit} onblur={commit} aria-label="maximum" />
</div>
