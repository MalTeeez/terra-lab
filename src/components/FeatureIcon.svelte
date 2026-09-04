<script module>
  /**
   * The feature icons, in the order the filter lists them. One place decides both what counts as an
   * icon feature (the browser separates these from the free-text effects it reads off the score
   * parts) and which glyph stands for it.
   */
  import {
    ArrowBigRight, ArrowUpFromLine, BrickWall, Bug, ChevronsRight, CopyPlus, Crosshair, EyeOff,
    Feather, Flame, Footprints, GitFork, Hammer, Package, Scale, Shield, ShieldPlus, Shirt, Sigma,
    Skull, Sparkles, Split, Swords, TowerControl, Droplet, VenetianMask,
  } from '@lucide/svelte';

  export const FEATURE_ICONS = {
    wings: Feather,
    boots: Footprints,
    dash: ChevronsRight,
    'flight boost': ArrowUpFromLine,
    stealth: EyeOff,
    'stealth strike bonus': VenetianMask,
    'on-hit spawn': Sparkles,
    'knockback immunity': Shield,
    'debuff immunity': ShieldPlus,
    'lava protection': Flame,
    conditional: Split,
    'runtime formula': Sigma,
    rebalanced: Scale,
    reforged: Hammer,
    'set bonus': Shirt,
    pierce: ArrowBigRight,
    homing: Crosshair,
    'multi-shot': CopyPlus,
    'child projectiles': GitFork,
    'through walls': BrickWall,
    'inflicts debuffs': Skull,
    'true melee': Swords,
    'uses ammo': Package,
    minion: Bug,
    sentry: TowerControl,
    'mana hungry': Droplet,
  };
  /** The features that have an icon, in display order. */
  export const FEATURES = Object.keys(FEATURE_ICONS);
</script>

<script>
  let { name, size = 15 } = $props();
  const Icon = $derived(FEATURE_ICONS[name]);
</script>

{#if Icon}<Icon {size} strokeWidth={1.75} absoluteStrokeWidth aria-hidden="true" />{/if}
