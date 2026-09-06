<script module>
  /** The tag a phase wears when its numbers were not read straight out of the code, and what it means. */
  export const CONF = {
    text: ['tooltip', 'This number was read from the tooltip, not the code.'],
    structural: ['inferred', 'Inferred from the shape of the projectile, not read.'],
    assumed: ['assumed', 'Nothing could be read, this is the pessimistic default.'],
  };
</script>

<script>
  /**
   * A weapon's attack as the graph of phases that produce its score: the use clock at the root,
   * what it puts in the air or swings, what each of those spawns in turn, and the debuffs on the
   * side. Each phase carries its own rate, gates and share of the DPS, so the number can be read
   * as an account rather than a total. `compact` is the strip above the arithmetic; the full form
   * adds the gates, the evidence and the share bars.
   */
  import { ARCH_LABELS } from '../lib/dataset.js';
  import { projName } from '../lib/dps.js';
  import { fmtNum } from '../lib/fmt.js';
  import FeatureIcon from './FeatureIcon.svelte';

  let { ds, phases = [], total = null, mode = null, compact = false } = $props();

  const r1 = (v) => Math.round(v * 10) / 10;
  // a rogue's stealth grade carries its own copy of every phase, under its own ids; the name a
  // phase answers to ('swing', 'return') is the one under that prefix
  const bare = (id) => String(id ?? '').replace(/^stealth:/, '');
  const sum = $derived(total ?? phases.reduce((s, p) => s + (p.contribution ?? 0), 0));
  const root = $derived(phases.find((p) => p.kind === 'primary') ?? null);
  // The tree: a phase hangs off the id it names as parent; anything that names none but the root
  // (a held projectile, a summon, a debuff) hangs off the root too — it runs on the use clock.
  // Siblings that are the same in every respect (the same projectile spawned twice by two code
  // paths, a shot listed twice) are one node with a count: the graph says what happens, not how
  // many times the code says it. Their children are gathered under the survivor.
  const SIG = ['grade', 'kind', 'trigger', 'projId', 'count', 'spread', 'fan', 'dmgMul', 'dmgAbs', 'chance', 'threshold', 'cooldown', 'maxActive', 'interval', 'duration', 'buffId', 'confidence', 'region'];
  const sig = (p) => JSON.stringify([bare(p.id) === 'swing' || bare(p.id) === 'return' ? bare(p.id) : '', ...SIG.map((k) => p[k] ?? null), r1(p.hitsSec ?? -1), r1(p.contribution ?? -1)]);
  const kidsOf = (ids) => {
    const merged = new Map();
    for (const p of phases) {
      if (p === root || !ids.includes(p.parent ?? root?.id ?? '')) continue;
      const k = sig(p);
      const g = merged.get(k);
      if (!g) merged.set(k, { ...p, ids: [p.id], times: 1 });
      else { g.ids.push(p.id); g.times++; if (p.hitsSec !== undefined) g.hitsSec = (g.hitsSec ?? 0) + p.hitsSec; if (p.contribution !== undefined) g.contribution = (g.contribution ?? 0) + p.contribution; }
    }
    return [...merged.values()];
  };
  const roots = $derived(root ? [{ ...root, ids: [root.id], times: 1 }] : kidsOf(['']));

  const name = (p) => {
    if (p.kind === 'primary') return 'use';
    if (bare(p.id) === 'swing') return 'blade';
    if (bare(p.id) === 'return') return 'round trip';
    if (p.kind === 'debuff') return ds?.debuffs?.[p.buffId]?.name ?? projName(p.buffId ?? 'debuff');
    if (p.kind === 'contact') return ARCH_LABELS[p.evidence?.arch] ?? 'held';
    if (p.kind === 'minion') return ARCH_LABELS[p.id] ?? p.id;
    return p.projId ? projName(p.projId) : 'shot';
  };
  /**
   * The phase's kind, out of `phases.js`'s own vocabulary, refined where the graph already tells two
   * of one kind apart by name: a `contact` phase is either the blade itself or something held on the
   * target, and a `minion` is either a minion or a sentry. `impact` / `split` / `linger` are in the
   * vocabulary but nothing produces them yet, so they fall through to `travel` — which is what a
   * spawned child is anyway.
   */
  const kindOf = (p) => {
    if (p.kind === 'primary') return 'use';
    if (p.kind === 'debuff') return 'debuff';
    if (p.kind === 'minion') return p.id === 'sentry' ? 'sentry' : 'minion';
    if (p.kind === 'contact') return bare(p.id) === 'swing' ? 'swing' : 'held';
    return 'travel';
  };
  const KIND_HINT = {
    use: 'The use animation of this weapon.',
    swing: 'The weapon itself, swung through the target.',
    held: 'Held or placed on the target rather than thrown at it, hitting on its own cooldown.',
    travel: 'Something that leaves the start point and crosses to the target.',
    minion: 'An autonomous summon on its own clock, paid for in minion slots.',
    sentry: 'A sentry that stands where you put it and only connects while the fight comes back to it.',
    debuff: 'Damage/Debuff over time on the target.',
  };
  /** what makes this phase happen, as the gate it runs through */
  const when = (p) => {
    const out = [];
    if (p.trigger === 'hit') out.push('on hit');
    else if (p.trigger === 'death') out.push('on death');
    else if (p.trigger === 'timer') out.push(bare(p.id) === 'return' ? 'out and back' : 'on a timer');
    if (p.threshold > 1) out.push(`every ${p.threshold} hits`);
    if (p.chance > 0 && p.chance < 1) out.push(`1-in-${r1(1 / p.chance)}`);
    return out.join(', ');
  };
  /**
   * What is special about the projectile this phase throws, named the way the Items page names it.
   * Only what the tree does not already say: children and debuffs are nodes of their own, and the
   * gates below carry every number, so this is the shape of the thing in the air and nothing else.
   */
  const FEATS = [
    [(q) => q.pen === -1 || q.pen > 1, 'pierce'],
    [(q) => q.homing, 'homing'],
    [(q) => q.walls, 'through walls'],
    [(q) => q.explode, 'explodes'],
    [(q) => q.bounces, 'bounces'],
    [(q) => q.returns, 'returns'],
    [(q) => q.sticks, 'sticks'],
    [(q) => q.digs, 'destroys tiles'],
  ];
  const feats = (p) => {
    // the root is the use clock, not a projectile: it names the same id as the phase under it, and
    // repeating that phase's icons on it says nothing the branch does not already say
    const q = p.projId && p.kind !== 'primary' ? ds?.projectiles?.[p.projId] : null;
    return q ? FEATS.filter(([has]) => has(q)).map(([, name]) => name) : [];
  };
  const gates = (p) => {
    const out = [];
    if (p.times > 1) out.push(`${p.times} alike`);
    if (p.count > 1) out.push(`×${p.count}`);
    if (p.spread > 0) out.push(`±${Math.round((p.spread * 180) / Math.PI)}°`);
    if (p.kind === 'primary' && p.cooldown) out.push(`every ${r1(p.cooldown)}t`);
    else if (p.cooldown > 0 && p.kind !== 'primary') out.push(bare(p.id) === 'return' ? `${Math.round(p.cooldown)}t trip` : `${r1(p.cooldown)}t cooldown`);
    if (p.interval > 0) out.push(`ticks every ${p.interval}t`);
    if (p.duration > 0) out.push(`${p.duration}t on target`);
    if (p.maxActive > 0) out.push(`≤${p.maxActive} out`);
    if (p.dmgMul !== 1 && p.dmgMul !== null && p.dmgMul !== undefined) out.push(`${Math.round(p.dmgMul * 100)}% dmg`);
    if (p.dmgAbs !== null && p.dmgAbs !== undefined) out.push(`${p.dmgAbs} flat`);
    if (p.resource?.kind === 'minionSlots') out.push(`${p.resource.cost} slot${p.resource.cost === 1 ? '' : 's'}`);
    return out;
  };
  // exported so a legend can name the tags a graph actually carries instead of listing all of them
  // capped at 1: a phase priced in a loop the total does not describe would otherwise draw a bar
  // wider than its box
  const share = (p) => (sum > 0 && p.contribution > 0 ? Math.min(1, p.contribution / sum) : 0);
  /** the grade (spam / stealth) a branch belongs to, shown where it starts and not repeated below */
  const gradeTip = (g) => (g === mode ? `the ${g} loop: the one this weapon is scored in` : `the ${g} loop: the weapon is worth more in the ${mode} loop, so this branch counts for nothing`);
  const rate = (p) => (p.kind === 'primary' ? (p.cooldown ? `${r1(60 / p.cooldown)}/s` : '') : p.hitsSec !== undefined ? `${r1(p.hitsSec)} hits/s` : '');
</script>

{#snippet node(p, pgrade = null)}
  {@const s = share(p)}
  {@const g = gates(p)}
  {@const f = feats(p)}
  {@const conf = CONF[p.confidence]}
  {@const below = kidsOf(p.ids)}
  {@const grade = p.grade && p.grade !== pgrade ? p.grade : null}
  {@const kind = kindOf(p)}
  <div class="ph-row">
    <div class="ph-node" class:root={p.kind === 'primary'} class:quiet={p.kind !== 'primary' && !(p.contribution > 0)} title={compact ? [name(p), KIND_HINT[kind], grade ? gradeTip(grade) : '', when(p), ...g, ...f, rate(p), p.contribution > 0 ? `${fmtNum(p.contribution)}/s` : ''].filter(Boolean).join(' · ') : ''}>
      {#if compact}
        <span class="ph-kind" title={KIND_HINT[kind]}><FeatureIcon name={kind} size={12} /></span>
        <span class="ph-name">{name(p)}</span>
        {#if grade}<span class="ph-grade" class:on={grade === mode}>{grade}</span>{/if}
        {#if p.times > 1}<span class="ph-gate">{p.times} alike</span>{/if}
        {#if p.count > 1}<span class="ph-gate">×{p.count}</span>{/if}
        {#if when(p)}<span class="ph-when">{when(p)}</span>{/if}
        <!-- the strip caps its boxes at 200px, so it takes as many as the table's rows do; the node's
             own title lists every one of them -->
        {#each f.slice(0, 4) as x}<span class="ph-feat" title={x}><FeatureIcon name={x} size={12} /></span>{/each}
        {#if p.kind !== 'primary'}<span class="ph-share num">{s > 0 ? (s < 0.005 ? '<1%' : `${Math.round(s * 100)}%`) : '–'}</span>{/if}
        {#if conf}<span class="ph-conf" title={conf[1]}>{conf[0]}</span>{/if}
      {:else}
        <div class="flex flex-wrap items-baseline gap-x-1.5">
          <span class="ph-kind has-tip" data-tip={KIND_HINT[kind]}><FeatureIcon name={kind} size={13} /></span>
          <span class="ph-name">{name(p)}</span>
          {#if grade}<span class="ph-grade has-tip" class:on={grade === mode} data-tip={gradeTip(grade)}>{grade}</span>{/if}
          {#if when(p)}<span class="ph-when">{when(p)}</span>{/if}
          {#if conf}<span class="ph-conf has-tip" data-tip={conf[1]}>{conf[0]}</span>{/if}
          <span class="num ml-auto text-[11px] text-dim">{rate(p)}</span>
        </div>
        {#if g.length || f.length}
          <div class="ph-gates">
            {#each f as x}<span class="ph-feat has-tip" data-tip={x}><FeatureIcon name={x} size={13} /></span>{/each}
            {#each g as x}<span>{x}</span>{/each}
          </div>
        {/if}
        {#if p.kind !== 'primary'}
          <div class="ph-bar"><i style="width:{Math.round(s * 100)}%"></i><span class="num">{p.contribution > 0 ? `${fmtNum(p.contribution)}/s · ${s < 0.005 ? '<1' : Math.round(s * 100)}%` : 'nothing'}</span></div>
        {/if}
      {/if}
    </div>
    {#if below.length}
      <div class="ph-kids">
        {#each below as k (k.id)}{@render node(k, p.grade ?? pgrade)}{/each}
      </div>
    {/if}
  </div>
{/snippet}

<div class="ph-graph" class:compact>
  {#each roots as p (p.id)}{@render node(p)}{/each}
  {#if !phases.length}<span class="text-[12px] text-dim">No phase describes this weapon yet.</span>{/if}
</div>

<style>
  .ph-graph { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .ph-row { display: flex; align-items: center; min-width: 0; }
  .ph-node { position: relative; flex: 0 0 auto; border: 1px solid var(--color-line-strong); background: var(--color-panel); padding: 4px 7px; min-width: 150px; max-width: 200px; box-shadow: var(--shadow-panel); }
  .ph-graph.compact .ph-node { min-width: 0; }
  .ph-node.root { border-color: var(--accent, var(--color-green)); }
  .ph-node.quiet { opacity: 0.55; }
  .ph-name { font-weight: 600; font-size: 12px; color: var(--color-ink); }
  .ph-when { font-size: 10.5px; color: var(--color-warn); }
  .ph-graph.compact .ph-when { white-space: nowrap; }
  /* which of the weapon's two loops this branch is: dim for the one not taken, accented for the one the score is made of */
  .ph-grade { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-ink2); border: 1px solid var(--color-line-strong); padding: 0 3px; }
  .ph-grade.on { color: var(--accent, var(--color-green)); border-color: currentColor; font-weight: 600; }
  .ph-conf { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-plum); border: 1px solid var(--color-plum-mid); background: var(--color-plum-soft); padding: 0 3px; }
  .ph-gates { display: flex; flex-wrap: wrap; gap: 2px 6px; margin-top: 2px; font-family: var(--font-mono); font-size: 10.5px; color: var(--color-ink2); }
  .ph-bar { position: relative; margin-top: 4px; height: 14px; background: var(--color-panel2); border: 1px solid var(--color-line); }
  .ph-bar > i { position: absolute; inset: 0 auto 0 0; background: color-mix(in srgb, var(--accent, var(--color-green)) 35%, transparent); }
  .ph-bar > span { position: absolute; inset: 0; padding: 0 4px; font-size: 10.5px; line-height: 12px; color: var(--color-ink2); white-space: nowrap; overflow: hidden; }
  /* the tree: children hang off a spine to the right of their parent, each with a stub back to it.
     Both stubs are absolute and hang off a *node*, at that node's own middle: as a flex item in the
     row the stub sat at the middle of the whole subtree instead, which is nowhere near the box it
     belongs to once a child has children of its own. The parent's stub hangs off `.ph-kids`, which
     exists only where there are children and is centred on the parent box by the row's `center`. */
  .ph-kids { position: relative; display: flex; flex-direction: column; gap: 4px; margin-left: 10px; padding-left: 10px; border-left: 1px solid var(--color-line-strong); }
  .ph-kids::before { content: ''; position: absolute; top: 50%; right: 100%; width: 11px; height: 1px; background: var(--color-line-strong); }
  .ph-kids > .ph-row > .ph-node::before { content: ''; position: absolute; top: 50%; right: 100%; width: 10px; height: 1px; background: var(--color-line-strong); }
  /* compact: pills in a row, share as a number */
  /* `wrap`, because the box is capped at 200px and a row that cannot wrap spills its last pills out
     through the border instead — which is what a phase with several feature icons does */
  .ph-graph.compact .ph-node { display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: 1px 5px; padding: 2px 6px; box-shadow: none; }
  .ph-graph.compact .ph-name { font-size: 11.5px; }
  .ph-gate { font-family: var(--font-mono); font-size: 10.5px; color: var(--color-ink2); }
  /* what the projectile itself does, as the icons the Items page filters by */
  .ph-feat { display: inline-flex; align-self: center; color: var(--color-dim); }
  /* what kind of thing the phase is, in front of its name */
  .ph-kind { display: inline-flex; align-self: center; color: var(--color-ink2); }
  .ph-share { font-size: 10.5px; font-weight: 600; color: var(--accent, var(--color-green)); }
  .ph-graph.compact .ph-kids { gap: 2px; }
</style>
