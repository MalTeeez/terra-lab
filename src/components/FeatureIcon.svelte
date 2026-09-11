<script module>
  /**
   * The feature icons, in the order the filter lists them. One place decides both what counts as an
   * icon feature (the browser separates these from the free-text effects it reads off the score
   * parts) and which glyph stands for it.
   */
  import {
    ArrowBigRight, ArrowUpFromLine, Bomb, BrickWall, Bug, ChevronsRight, CopyPlus, Crosshair, EyeOff,
    Feather, Flame, Footprints, GitFork, Hammer, Hand, MousePointerClick, Package, Pickaxe, Pin,
    Repeat, Scale, Send, Shield, ShieldPlus, Shirt, Sigma, Skull, Sparkles, Split, Swords,
    TowerControl, Droplet, Undo2, VenetianMask,
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

  /**
   * …and the ones only a single projectile has. These describe one phase of an attack rather than a
   * whole item, so they name nodes in the attack graph and never appear in the item filter — kept
   * out of `FEATURES` for that reason, but drawn by the same component.
   */
  export const PHASE_ICONS = {
    explodes: Bomb,
    bounces: Repeat,
    returns: Undo2,
    sticks: Pin,
    'destroys tiles': Pickaxe,
  };

  /**
   * What *kind* of thing a phase is, from `phases.js`'s own vocabulary — the use clock, the weapon
   * swung, something held on the target, something thrown at it, a summon, a debuff. The graph tells
   * these apart in prose already ('use', 'blade', 'Held beam'); this is the same fact as a glyph.
   */
  export const PHASE_KIND_ICONS = {
    use: MousePointerClick,
    swing: Swords,
    held: Hand,
    travel: Send,
    // a sub-attack: not something the weapon throws, but something one of its projectiles sets off
    impact: Sparkles,
    split: GitFork,
    minion: Bug,
    sentry: TowerControl,
    debuff: Skull,
  };
</script>

<script>
  let { name, size = 15 } = $props();
  const Icon = $derived(FEATURE_ICONS[name] ?? PHASE_ICONS[name] ?? PHASE_KIND_ICONS[name]);
</script>

{#if Icon}<Icon {size} strokeWidth={1.75} absoluteStrokeWidth aria-hidden="true" />{/if}
