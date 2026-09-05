<script module>
  /** The tag a phase wears when its numbers were not read straight out of the code, and what it means. */
  export const CONF = {
    text: ['tooltip', 'This number was read from the tooltip, not the code.'],
    structural: ['inferred', 'Inferred from the shape of the projectile, not read.'],
    assumed: ['assumed', 'Nothing was read; this is the pessimistic default.'],
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

  let { ds, phases = [], total = null, compact = false } = $props();

  const r1 = (v) => Math.round(v * 10) / 10;
  const sum = $derived(total ?? phases.reduce((s, p) => s + (p.contribution ?? 0), 0));
  const root = $derived(phases.find((p) => p.kind === 'primary') ?? null);
  // The tree: a phase hangs off the id it names as parent; anything that names none but the root
  // (a held projectile, a summon, a debuff) hangs off the root too — it runs on the use clock.
  // Siblings that are the same in every respect (the same projectile spawned twice by two code
  // paths, a shot listed twice) are one node with a count: the graph says what happens, not how
  // many times the code says it. Their children are gathered under the survivor.
  const SIG = ['kind', 'trigger', 'projId', 'count', 'spread', 'fan', 'dmgMul', 'dmgAbs', 'chance', 'threshold', 'cooldown', 'maxActive', 'interval', 'duration', 'buffId', 'confidence', 'region'];
  const sig = (p) => JSON.stringify([p.id === 'swing' || p.id === 'return' ? p.id : '', ...SIG.map((k) => p[k] ?? null), r1(p.hitsSec ?? -1), r1(p.contribution ?? -1)]);
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
    if (p.id === 'swing') return 'blade';
    if (p.id === 'return') return 'round trip';
    if (p.kind === 'debuff') return ds?.debuffs?.[p.buffId]?.name ?? projName(p.buffId ?? 'debuff');
    if (p.kind === 'contact') return ARCH_LABELS[p.evidence?.arch] ?? 'held';
    if (p.kind === 'minion') return ARCH_LABELS[p.id] ?? p.id;
    return p.projId ? projName(p.projId) : 'shot';
  };
  /** what makes this phase happen, as the gate it runs through */
  const when = (p) => {
    const out = [];
    if (p.trigger === 'hit') out.push('on hit');
    else if (p.trigger === 'death') out.push('on death');
    else if (p.trigger === 'timer') out.push(p.id === 'return' ? 'out and back' : 'on a timer');
    if (p.threshold > 1) out.push(`every ${p.threshold} hits`);
    if (p.chance > 0 && p.chance < 1) out.push(`1-in-${r1(1 / p.chance)}`);
    return out.join(', ');
  };
  const gates = (p) => {
    const out = [];
    if (p.times > 1) out.push(`${p.times} alike`);
    if (p.count > 1) out.push(`×${p.count}`);
    if (p.spread > 0) out.push(`±${Math.round((p.spread * 180) / Math.PI)}°`);
    if (p.kind === 'primary' && p.cooldown) out.push(`every ${r1(p.cooldown)}t`);
    else if (p.cooldown > 0 && p.kind !== 'primary') out.push(p.id === 'return' ? `${Math.round(p.cooldown)}t trip` : `${r1(p.cooldown)}t cooldown`);
    if (p.interval > 0) out.push(`ticks every ${p.interval}t`);
    if (p.duration > 0) out.push(`${p.duration}t on target`);
    if (p.maxActive > 0) out.push(`≤${p.maxActive} out`);
    if (p.dmgMul !== 1 && p.dmgMul !== null && p.dmgMul !== undefined) out.push(`${Math.round(p.dmgMul * 100)}% dmg`);
    if (p.dmgAbs !== null && p.dmgAbs !== undefined) out.push(`${p.dmgAbs} flat`);
    if (p.resource?.kind === 'minionSlots') out.push(`${p.resource.cost} slot${p.resource.cost === 1 ? '' : 's'}`);
    return out;
  };
  // exported so a legend can name the tags a graph actually carries instead of listing all of them
  const share = (p) => (sum > 0 && p.contribution > 0 ? p.contribution / sum : 0);
  const rate = (p) => (p.kind === 'primary' ? (p.cooldown ? `${r1(60 / p.cooldown)}/s` : '') : p.hitsSec !== undefined ? `${r1(p.hitsSec)} hits/s` : '');
</script>

{#snippet node(p)}
  {@const s = share(p)}
  {@const g = gates(p)}
  {@const conf = CONF[p.confidence]}
  {@const below = kidsOf(p.ids)}
  <div class="ph-row">
    <div class="ph-node" class:root={p.kind === 'primary'} class:quiet={p.kind !== 'primary' && !(p.contribution > 0)} title={compact ? [name(p), when(p), ...g, rate(p), p.contribution > 0 ? `${fmtNum(p.contribution)}/s` : ''].filter(Boolean).join(' · ') : ''}>
      {#if compact}
        <span class="ph-name">{name(p)}</span>
        {#if p.times > 1}<span class="ph-gate">{p.times} alike</span>{/if}
        {#if p.count > 1}<span class="ph-gate">×{p.count}</span>{/if}
        {#if when(p)}<span class="ph-when">{when(p)}</span>{/if}
        {#if p.kind !== 'primary'}<span class="ph-share num">{s > 0 ? `${Math.round(s * 100)}%` : '–'}</span>{/if}
        {#if conf}<span class="ph-conf" title={conf[1]}>{conf[0]}</span>{/if}
      {:else}
        <div class="flex flex-wrap items-baseline gap-x-1.5">
          <span class="ph-name">{name(p)}</span>
          {#if when(p)}<span class="ph-when">{when(p)}</span>{/if}
          {#if conf}<span class="ph-conf has-tip" data-tip={conf[1]}>{conf[0]}</span>{/if}
          <span class="num ml-auto text-[11px] text-dim">{rate(p)}</span>
        </div>
        {#if g.length}<div class="ph-gates">{#each g as x}<span>{x}</span>{/each}</div>{/if}
        {#if p.kind !== 'primary'}
          <div class="ph-bar"><i style="width:{Math.round(s * 100)}%"></i><span class="num">{p.contribution > 0 ? `${fmtNum(p.contribution)}/s · ${Math.round(s * 100)}%` : 'nothing'}</span></div>
        {/if}
      {/if}
    </div>
    {#if below.length}
      <div class="ph-kids">
        {#each below as k (k.id)}{@render node(k)}{/each}
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
  .ph-node { flex: 0 0 auto; border: 1px solid var(--color-line-strong); background: var(--color-panel); padding: 4px 7px; min-width: 150px; max-width: 200px; box-shadow: var(--shadow-panel); }
  .ph-graph.compact .ph-node { min-width: 0; }
  .ph-node.root { border-color: var(--accent, var(--color-green)); }
  .ph-node.quiet { opacity: 0.55; }
  .ph-name { font-weight: 600; font-size: 12px; color: var(--color-ink); }
  .ph-when { font-size: 10.5px; color: var(--color-warn); }
  .ph-graph.compact .ph-when { white-space: nowrap; }
  .ph-conf { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-plum); border: 1px solid var(--color-plum-mid); background: var(--color-plum-soft); padding: 0 3px; }
  .ph-gates { display: flex; flex-wrap: wrap; gap: 2px 6px; margin-top: 2px; font-family: var(--font-mono); font-size: 10.5px; color: var(--color-ink2); }
  .ph-bar { position: relative; margin-top: 4px; height: 14px; background: var(--color-panel2); border: 1px solid var(--color-line); }
  .ph-bar > i { position: absolute; inset: 0 auto 0 0; background: color-mix(in srgb, var(--accent, var(--color-green)) 35%, transparent); }
  .ph-bar > span { position: absolute; inset: 0; padding: 0 4px; font-size: 10.5px; line-height: 12px; color: var(--color-ink2); white-space: nowrap; overflow: hidden; }
  /* the tree: children hang off a spine to the right of their parent, each with a stub back to it */
  .ph-kids { display: flex; flex-direction: column; gap: 4px; margin-left: 10px; padding-left: 10px; border-left: 1px solid var(--color-line-strong); }
  .ph-kids > .ph-row::before { content: ''; width: 10px; height: 1px; background: var(--color-line-strong); margin-left: -10px; flex: 0 0 auto; }
  /* compact: pills in a row, share as a number */
  .ph-graph.compact .ph-node { display: inline-flex; align-items: baseline; gap: 5px; padding: 2px 6px; box-shadow: none; }
  .ph-graph.compact .ph-name { font-size: 11.5px; }
  .ph-gate { font-family: var(--font-mono); font-size: 10.5px; color: var(--color-ink2); }
  .ph-share { font-size: 10.5px; font-weight: 600; color: var(--accent, var(--color-green)); }
  .ph-graph.compact .ph-kids { gap: 2px; }
</style>
