<script>
  import { wikiImg, wikiImgByName, wikiImgGif } from '../lib/wiki.js';

  let { item, size = 32 } = $props();
  // keyed by URL, so switching to another item starts clean without an effect
  let bad = $state({});
  // each candidate is tried in turn as the one before it 404s; ~3% of sprites need the second
  const src = $derived([wikiImg(item), wikiImgGif(item), wikiImgByName(item)].find((u) => u && !bad[u]) ?? null);
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
