<script>
  import { wikiImg, wikiImgByName } from '../lib/wiki.js';

  let { item, size = 32 } = $props();
  // keyed by URL, so switching to another item starts clean without an effect
  let bad = $state({});
  const src = $derived.by(() => {
    const direct = wikiImg(item);
    if (direct && !bad[direct]) return direct;
    const byName = wikiImgByName(item);
    return byName && !bad[byName] ? byName : null;
  });
</script>

<!--
  Sprites come in every resolution. `object-contain` in a fixed square fills the box on the sprite's
  long axis with one scale factor for both axes, so the pixel grid never stretches, and `pixelated`
  samples nearest-neighbour instead of smoothing it.
-->
{#if src}
  <img {src} alt="" loading="lazy" decoding="async" onerror={() => (bad = { ...bad, [src]: true })}
       class="shrink-0 self-center object-contain [image-rendering:pixelated]"
       style="width:{size}px;height:{size}px" />
{/if}
