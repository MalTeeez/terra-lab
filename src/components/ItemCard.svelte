<script>
  import { tick } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { CLASS_LABELS, SOURCE_HINT, SOURCE_TONE, accentOf } from '../lib/dataset.js';
  import { accessoryGroup, pieceScore, setBonusScore, weaponDps } from '../lib/score.js';
  import { effectiveStats, prefixesFor } from '../lib/stats.js';
  import { setOwned, toggleIn, ui } from '../lib/state.svelte.js';
  import { craftTree, gateText, gatingChain } from '../lib/sources.js';
  import { wikiHost, wikiUrl } from '../lib/wiki.js';
  import WikiIcon from './WikiIcon.svelte';
  import CraftGraph from './CraftGraph.svelte';
  import { layout, toDisplay } from '../lib/treelayout.js';
  import ScoreParts from './ScoreParts.svelte';
  import Info from './Info.svelte';

  let { ds, item, statCtx, onclose, onselect } = $props();
  const isGear = $derived(item.slot !== 'weapon');
  const own = $derived(ui.owned[item.id]);
  const prefixOptions = $derived(prefixesFor(item, ds.prefixes, ds.aliases));
  // what the loadout's reforge setting gives this item when it has no prefix of its own
  const assumed = $derived(ui.reforge === 'none' ? 'none'
    : ui.reforge === 'best' || !prefixOptions.some((p) => p.id === ui.reforge) ? 'assumed best'
    : `assumed ${ds.prefixById.get(ui.reforge)?.name ?? ui.reforge}`);
  const prefix = $derived(own?.prefix ? ds.prefixById.get(own.prefix) ?? null : null);
  const ctx = $derived({ ...statCtx, prefix });
  const progression = $derived(ds.stages[ui.stage]?.progression);
  const score = $derived(isGear ? pieceScore(item, ui.cls, ds.aliases, { prefix, progression }) : null);
  const setScore = $derived(item.slot === 'head' && (item.setEffects || item.setBonus) ? setBonusScore(item, ui.cls, ds.aliases, { progression }) : null);
  const dps = $derived(item.slot === 'weapon' ? weaponDps(item, ctx) : null);
  const eff = $derived(item.slot === 'weapon' ? effectiveStats(item, ctx) : null);
  const heads = $derived(item.setHeads ?? []);
  const accent = $derived(accentOf(item.cls ?? ui.cls));
  const fmtEffects = (fx) => {
    if (!fx) return [];
    const out = [];
    for (const [k, v] of Object.entries(fx)) {
      if (k === 'flags' || k === 'mod') continue;
      if (typeof v === 'object') for (const [c, n] of Object.entries(v)) out.push(`${k} ${c}: ${fmtNum(k, n)}`);
      else out.push(`${k}: ${fmtNum(k, v)}`);
    }
    if (fx.mod) for (const [k, v] of Object.entries(fx.mod)) out.push(`${k}: ${v}`);
    if (fx.flags?.length) out.push(`flags: ${fx.flags.join(', ')}`);
    return out;
  };
  const fmtNum = (k, n) => (/damage|attackSpeed|moveSpeed|endurance|manaCost|Mult/.test(k) && Math.abs(n) < 5 ? `${n > 0 ? '+' : ''}${Math.round(n * 1000) / 10}%` : `${n > 0 ? '+' : ''}${n}`);
  const r1 = (v) => Math.round(v * 10) / 10;
  const r2 = (v) => Math.round(v * 100) / 100;
  const PREVIEW_SCALE = 0.82; // the sidebar column is narrow
  let zoom = $state(1);
  const src = $derived(item.stageSource);
  const wiki = $derived(wikiUrl(item));
  const tree = $derived(craftTree(ds, item.id));
  const chain = $derived(tree ? gatingChain(tree) : []);
  const gate = $derived(tree ? gateText(tree, ds) : '');
  // the graph puts the item itself between its outermost ingredients, so both views open on it
  const graph = $derived(tree?.recipes.length ? layout(toDisplay(tree)) : null);
  const centerRoot = (el, scale) => {
    if (el && graph) el.scrollTop = Math.max(0, (graph.root.y + graph.root.h / 2) * scale - el.clientHeight / 2);
  };
  let preview = $state(null);
  let full = $state(null);
  $effect(() => { void item; centerRoot(preview, PREVIEW_SCALE); });

  // the dialog opens showing the whole tree, down to the point where the labels stop being readable
  const MIN_FIT = 0.3;
  async function openFullTree() {
    if (!full || !graph) return;
    const pad = 32; // the p-4 around the graph
    zoom = Math.min(1, Math.max(MIN_FIT, r2(Math.min(
      (full.clientWidth - pad) / graph.width,
      (full.clientHeight - pad) / graph.height,
    ))));
    await tick(); // the boxes have to be re-scaled before the scroll offset means anything
    centerRoot(full, zoom);
  }
  const hasNotes = $derived(!!(item.changes?.length || item.variants?.length || item.maybe));
  const hasStats = $derived(['damage', 'useTime', 'useAnimation', 'crit', 'defense', 'knockback', 'mana'].some((k) => item[k] !== undefined));
  function onkey(e) { if (e.key === 'Escape') onclose(); }
</script>

{#snippet projLine(it)}
  {@const pid = it.useAmmo ? null : it.shoot}
  {@const p = pid ? ds.projectiles[pid] : null}
  {#if it.useAmmo}<span>ammo: {ds.ammoKinds[it.useAmmo] ?? it.useAmmo}</span>{/if}
  {#if pid}<span class="num">{pid.split(':').pop()}</span>{/if}
  {#if p}
    <span class="text-dim"> —
      {#if p.pen === -1}infinite pierce{:else if p.pen > 1}pierces {p.pen}{:else}no pierce{/if}{#if p.homing}, homing{/if}{#if p.gravity}, gravity{/if}{#if p.walls}, through walls{/if}{#if p.updates}, {p.updates + 1}× speed{/if}{#if p.children?.length}, spawns {p.children.map((c) => `${c.count > 1 ? c.count + '× ' : ''}${c.type.split(':').pop()} (${c.where})`).join(', ')}{/if}{#if p.debuffs?.length}, inflicts {p.debuffs.length} debuff{p.debuffs.length > 1 ? 's' : ''}{/if}
    </span>
  {/if}
  {#if it.fire?.calls?.length}<span class="text-dim"> · {it.fire.calls.map((c) => `${c.count ?? 1}× ${c.type === 'shoot' ? 'shot' : c.type.split(':').pop()}${c.variant ? ` [${c.variant}]` : ''}${c.spread ? ` ±${Math.round((c.spread * 180) / Math.PI)}°` : ''}`).join(', ')}</span>{/if}
{/snippet}

{#snippet stat(label, value, hint)}
  <div class="min-w-0 px-3 py-1.5" title={hint ?? ''}>
    <div class="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-dim">{label}</div>
    <div class="num text-[14px] font-semibold leading-tight text-ink">{value}</div>
  </div>
{/snippet}

<svelte:window onkeydown={onkey} />

<div class="fixed inset-0 z-40 bg-ink/25 backdrop-blur-[1px]" onclick={onclose} transition:fade={{ duration: 150 }}></div>
<aside class="fixed inset-y-0 right-0 z-50 flex w-full max-w-[520px] flex-col overflow-y-auto bg-panel shadow-[var(--shadow-pop)]"
       style="--accent:{accent}; border-left:3px solid {accent}"
       transition:fly={{ x: 32, duration: 220, easing: cubicOut, opacity: 0 }}>
  <header class="sticky top-0 z-10 border-b border-line bg-panel/95 px-5 py-3 backdrop-blur" style="box-shadow:var(--shadow-lift)">
    <div class="flex items-start gap-3">
      <WikiIcon {item} size={44} />
      <div class="min-w-0 flex-1">
        <h2 class="text-[17px] leading-tight">{item.name}</h2>
        <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-dim">
          <span>{item.modName}</span>
          <span class="lab-tag">{item.slot}</span>
          {#if item.cls}<span class="lab-tag solid">{CLASS_LABELS[item.cls] ?? item.cls}</span>{/if}
          {#if item.rarityName}<span>{item.rarityName}</span>{/if}
          {#if item.expert}<span class="lab-tag plum">expert</span>{/if}
          {#if item.changes?.length}<span class="lab-tag warn" title="another mod changes this item">rebalanced</span>{/if}
        </div>
      </div>
      <div class="flex shrink-0 gap-1">
        {#if wiki}<a class="lab-btn px-2 py-1" href={wiki} target="_blank" rel="noreferrer" title="Open on {wikiHost(wiki)}">Wiki ↗</a>{/if}
        <button class="lab-btn px-2 py-1" onclick={onclose} aria-label="Close" title="Close (Esc)">✕</button>
      </div>
    </div>
  </header>

  <!-- ownership / reforge / solver constraints -->
  <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-panel2 px-5 py-2 text-[12.5px]">
    <label class="flex cursor-pointer items-center gap-1.5"><input type="checkbox" checked={!!own} onchange={(e) => setOwned(item.id, e.currentTarget.checked)} /> I own this</label>
    {#if prefixOptions.length}
      <label class="flex items-center gap-1.5">
        <span class="text-dim">reforge</span>
        <select class="lab-input w-auto max-w-[180px] py-0.5" value={own?.prefix ?? ''} onchange={(e) => setOwned(item.id, true, e.currentTarget.value || null)}>
          <option value="">{own ? 'no prefix' : assumed}</option>
          {#each prefixOptions as p}<option value={p.id}>{p.name}{p.mod !== 'v' ? ` (${p.mod})` : ''}</option>{/each}
        </select>
      </label>
    {/if}
    <button class="lab-chip py-0.5" aria-pressed={ui.pinned.includes(item.id)} onclick={() => toggleIn('pinned', item.id)} title="Always put this in the loadout">pin</button>
    <button class="lab-chip py-0.5" aria-pressed={ui.excluded.includes(item.id)} onclick={() => toggleIn('excluded', item.id)} title="Never pick this">exclude</button>
  </div>

  <!-- the number that matters, big -->
  {#if dps}
    <div class="flex items-end justify-between gap-3 border-b border-line px-5 py-3" style="background:linear-gradient(90deg, color-mix(in srgb, {accent} 10%, transparent), transparent)">
      <div>
        <div class="lab-label">Real {dps.kind}</div>
        <div class="num text-[28px] font-bold leading-none" style="color:{accent}">{r1(dps.value)}</div>
      </div>
      <div class="pb-0.5 text-right text-[11.5px] text-dim">
        {#if dps.mode === 'stealth' || dps.mode === 'spam'}
          <span class="lab-tag" class:plum={dps.mode === 'stealth'}>{dps.mode}</span>
          <div class="num mt-1">spam {r1(dps.spam)} · stealth {r1(dps.stealth)}</div>
        {:else if dps.rate}
          <span class="num">{dps.rate}/s × {Math.round(dps.critMult * 100) / 100} crit</span>
        {/if}
      </div>
    </div>
  {/if}

  <!-- key stats, as a strip -->
  {#if hasStats}
  <div class="grid grid-cols-[repeat(auto-fit,minmax(88px,1fr))] gap-px border-b border-line bg-line">
    {#if item.damage !== undefined}
      <div class="bg-panel">{@render stat('Damage', eff ? eff.damage : item.damage, eff && eff.damage !== item.damage ? `mined ${item.damage}${item.dc ? ` · ${item.dc.replace(/DamageClass$/, '')}` : ''}` : item.dc ?? '')}</div>
    {/if}
    {#if item.useTime !== undefined || item.useAnimation !== undefined}
      <div class="bg-panel">{@render stat('Use / anim', `${eff ? eff.useTime : item.useTime ?? '–'} / ${eff ? eff.useAnimation : item.useAnimation ?? '–'}`, 'ticks between uses / of the animation')}</div>
    {/if}
    {#if item.crit !== undefined || eff}
      <div class="bg-panel">{@render stat('Crit chance', `${eff ? eff.crit : item.crit}%`)}</div>
    {/if}
    {#if item.defense !== undefined}
      <div class="bg-panel">{@render stat('Defense', item.defense, item.base?.defense !== undefined ? `mined ${item.base.defense}` : '')}</div>
    {/if}
    {#if item.knockback !== undefined}<div class="bg-panel">{@render stat('Knockback', item.knockback)}</div>{/if}
    {#if item.mana !== undefined}<div class="bg-panel">{@render stat('Mana', item.mana)}</div>{/if}
  </div>
  {/if}

  <div class="flex flex-col gap-4 px-5 py-4 text-[13px]">
    <!-- where it comes from -->
    <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[12.5px]">
      <span class="lab-label">Obtainable</span>
      <span class="font-medium">{item.stageLabel}</span>
      <span class="lab-tag {SOURCE_TONE[src.kind] ?? ''}" title={SOURCE_HINT[src.kind] ?? src.kind}>{src.kind}</span>
      {#if gate}<span class="text-dim">— {gate}</span>{/if}
    </div>

    {#if item.shoot || item.useAmmo}
      <div class="text-[12.5px]"><span class="lab-label mb-0.5">Fires</span>{@render projLine(item)}</div>
    {/if}

    {#if item.tooltip}
      <section>
        <div class="lab-rule start mb-1.5">In-game tooltip</div>
        <p class="m-0 whitespace-pre-line border-l-2 border-line pl-3 text-ink2">{item.tooltip}</p>
        {#if item.placeholders}<p class="m-0 mt-1 text-[11.5px] text-warn">Numbers shown as {'{0}'} are filled in at runtime; the score uses the values read from the mod's code where available.</p>{/if}
      </section>
    {/if}

    {#if dps && dps.kind === 'dps'}
      <section>
        <div class="lab-rule start mb-1.5">Real DPS{dps.mode === 'stealth' ? ' — stealth strikes' : dps.mode === 'spam' ? ' — spam' : ''}</div>
        <table class="lab-table">
          <tbody>
            {#each (dps.mode === 'stealth' ? dps.stealthParts : dps.parts) as p}
              <tr><td class="text-[12px] text-ink2">{p.label}</td><td class="num text-right">{p.value !== undefined ? p.value : `×${p.mul}${p.unit ?? ''}`}</td></tr>
            {/each}
            <tr class="font-semibold"><td>per second</td><td class="num text-right" style="color:{accent}">{r1(dps.value)}</td></tr>
          </tbody>
        </table>
        {#if dps.mode === 'stealth' || dps.mode === 'spam'}
          <details class="mt-1.5 text-[12px] text-dim">
            <summary class="cursor-pointer hover:text-green">the other way: {dps.mode === 'stealth' ? 'spam' : 'stealth'} {r1(dps.mode === 'stealth' ? dps.spam : dps.stealth)}/s</summary>
            <table class="lab-table mt-1"><tbody>{#each (dps.mode === 'stealth' ? dps.parts : dps.stealthParts) as p}<tr><td class="text-[12px]">{p.label}</td><td class="num text-right">{p.value !== undefined ? p.value : `×${p.mul}${p.unit ?? ''}`}</td></tr>{/each}</tbody></table>
          </details>
        {/if}
      </section>
    {/if}

    {#if score}
      <section>
        <div class="lab-rule start mb-1.5">Score for {CLASS_LABELS[ui.cls]}{prefix ? ` with ${prefix.name}` : ''}</div>
        {#if score.parts.length}<ScoreParts parts={score.parts} score={score.score} max={12} />{:else}<span class="text-[12.5px] text-dim">Nothing this class benefits from.</span>{/if}
        {#if item.slot === 'accessory' && accessoryGroup(item)}
          <p class="m-0 mt-1.5 text-[12px] text-dim">Exclusive group <span class="lab-tag">{accessoryGroup(item)}</span> — the solver equips only the best of these.</p>
        {/if}
      </section>
    {/if}

    {#if item.slot === 'head' && (item.setBonus || item.setEffects)}
      <section>
        <div class="lab-rule start mb-1.5">Set bonus</div>
        {#if item.setBonus}<p class="m-0 whitespace-pre-line border-l-2 border-green-mid pl-3 text-ink2">{item.setBonus}</p>{/if}
        {#if setScore?.parts.length}<div class="mt-1.5"><ScoreParts parts={setScore.parts} score={setScore.score} /></div>{/if}
        {#if item.setEffects}
          <details class="mt-1.5 text-[12px] text-dim"><summary class="cursor-pointer hover:text-green">effects read from code</summary>
            <ul class="m-0 mt-1 list-none p-0 text-[12px] text-ink2">{#each fmtEffects(item.setEffects) as line}<li class="num">{line}</li>{/each}</ul>
          </details>
        {/if}
        {#if item.setItems?.length}
          <p class="m-0 mt-1.5 text-[12px] text-dim">With
            {#each item.setItems as p, i}{#if i}, {/if}<button class="cursor-pointer underline decoration-line underline-offset-2 hover:text-green" onclick={() => onselect(p.id)}>{p.name}</button>{/each}
          </p>
        {/if}
      </section>
    {/if}
    {#if heads.length}
      <p class="m-0 text-[12px] text-dim">Part of:
        {#each heads as h, i}{#if i}, {/if}<button class="cursor-pointer underline decoration-line underline-offset-2 hover:text-green" onclick={() => onselect(h.id)}>{h.name}</button>{/each}
      </p>
    {/if}

    {#if tree}
      <section>
        <div class="lab-rule start mb-1.5">
          How to get it
          <Info label="Reading the crafting tree" w={340}>
            <p>The item is the box on the left; everything it is crafted from branches off to the right, each with the stage it becomes available.</p>
            <p>Boxes and connectors in <em>orange</em> are the parts that push the stage forward — those decide when you can make the item.</p>
          </Info>
          {#if tree.recipes.length}
            <button class="lab-btn ml-auto px-2 py-0.5 text-[11.5px]" popovertarget="crafttree" title="Open the whole tree in a bigger view">⤢ Full tree</button>
          {/if}
        </div>
        {#if chain.length}
          <p class="m-0 mb-1.5 text-[12px] text-ink2">Gated by
            {#each chain as c, i}{#if i}, {/if}{#if c.station}<span class="font-medium">{c.station.name}</span> <span class="text-dim">({c.station.stageLabel}{c.station.boss ? `, after ${c.station.boss}` : ''})</span>{:else}<span class="font-medium">{c.node.name}</span>{#if c.viaGroup}<span class="text-dim">&nbsp;for {c.viaGroup}</span>{/if} <span class="text-dim">({c.node.stageLabel}: {c.node.gate})</span>{/if}{/each}.
          </p>
        {/if}
        {#if tree.drops?.length}
          <ul class="m-0 mb-1.5 list-none p-0 text-[12.5px] text-ink2">
            {#each tree.drops as s}<li><span class="lab-tag mr-1 {SOURCE_TONE[s.kind] ?? ''}">{s.kind}</span>{s.from}{#if s.cond}<span class="text-dim"> after {s.cond}</span>{/if}</li>{/each}
          </ul>
        {/if}
        {#if tree.recipes.length}
          <!-- the sidebar is narrow: a scrollable preview, and the button above opens it full size -->
          <div bind:this={preview} class="max-h-[340px] overflow-auto border border-line bg-panel2/40 p-1" style="display:grid; place-content:safe center">
            <CraftGraph {ds} {tree} {onselect} scale={PREVIEW_SCALE} />
          </div>
        {:else if !tree.drops?.length}
          <p class="m-0 text-[12px] text-dim">No recipe or drop found in the mods' code.</p>
        {/if}
      </section>
    {/if}

    <!-- the deep detail, folded away -->
    {#if eff?.chain.length > 1 || hasNotes || item.effects}
      <details class="border-t border-line pt-2.5">
        <summary class="lab-rule start cursor-pointer hover:text-green"><span class="mr-0.5">▸</span>Mined detail</summary>
        <div class="mt-2 flex flex-col gap-3">
          {#if eff && eff.chain.length > 1}
            <div>
              <span class="lab-label mb-1">How the damage is derived</span>
              <table class="lab-table">
                <tbody>
                  {#each eff.chain as step}
                    <tr><td class="text-[12px] text-ink2">{step.label}</td><td class="num text-right">{step.damage ?? ''}</td><td class="num text-right text-dim">{step.crit !== undefined ? `${step.crit}%` : ''}</td><td class="num text-right text-dim">{step.useTime !== undefined ? `${step.useTime}t` : ''}</td></tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
          {#if hasNotes}
            <div>
              <span class="lab-label mb-1">Changed by other mods</span>
              <ul class="m-0 list-none p-0 text-[12.5px] text-ink2">
                {#each item.changes ?? [] as c}<li>{c.mod} {c.hook}: {c.field ? `${c.field} ${c.from} → ${c.to}` : fmtEffects(c.effects).join(', ')}</li>{/each}
                {#each item.variants ?? [] as v}<li class="text-dim">{v.mod} on {v.cond.join('+')}: {v.field ? `${v.field} → ${v.to}` : fmtEffects(v.effects).join(', ')}</li>{/each}
                {#if item.maybe}<li class="text-warn">{item.maybe} conditional change{item.maybe > 1 ? 's' : ''} whose guard could not be resolved</li>{/if}
              </ul>
            </div>
          {/if}
          {#if item.effects}
            <div>
              <span class="lab-label mb-1">Effects read from code</span>
              <ul class="m-0 list-none p-0 text-[12.5px] text-ink2">
                {#each fmtEffects(item.effects) as line}<li class="num">{line}</li>{/each}
              </ul>
            </div>
          {/if}
        </div>
      </details>
    {/if}
    <p class="m-0 text-[11px] text-dim">id <span class="num">{item.id}</span></p>
  </div>
</aside>

<!-- the roomy viewer for deep trees: outside the aside, whose fly transform would otherwise
     become the containing block for the top layer mid-animation -->
{#if tree?.recipes.length}
  <!-- the body has no size until the popover is in the top layer, so centre it on open -->
  <div id="crafttree" popover="auto" class="lab-pop col p-0" style="--w:85vw; --accent:{accent}; height:85vh; overflow:hidden"
       ontoggle={(e) => e.newState === 'open' && openFullTree()}>
    <div class="lab-head shrink-0">
      <h2>How to get {item.name}</h2>
      <span class="lab-meta">
        <span class="flex items-center gap-1">
          <button class="lab-btn px-2 py-0.5" onclick={() => (zoom = Math.max(MIN_FIT, r2(zoom - 0.15)))} aria-label="Zoom out">−</button>
          <button class="lab-btn px-2 py-0.5 tabular-nums" onclick={openFullTree} title="Fit the whole tree to the window">{Math.round(zoom * 100)}%</button>
          <button class="lab-btn px-2 py-0.5" onclick={() => (zoom = Math.min(1.6, r2(zoom + 0.15)))} aria-label="Zoom in">+</button>
        </span>
        <button class="lab-btn py-0.5" popovertarget="crafttree" popovertargetaction="hide">Done</button>
      </span>
    </div>
    <!-- `safe` keeps a tree bigger than the window scrollable from its top-left instead of
         centring it into its own clipped edges -->
    <div bind:this={full} class="min-h-0 flex-1 overflow-auto p-4" style="display:grid; place-content:safe center">
      <CraftGraph {ds} {tree} {onselect} scale={zoom} />
    </div>
  </div>
{/if}
