<script>
  import { tick } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { ARCH_HINT, ARCH_LABELS, CLASS_LABELS, SOURCE_HINT, SOURCE_TONE, accentOf } from '../lib/dataset.js';
  import { accessoryGroup, pieceScore, setBonusScore, weaponDps } from '../lib/score.js';
  import { effectiveStats, prefixesFor } from '../lib/stats.js';
  import { setOwned, toggleIn, ui } from '../lib/state.svelte.js';
  import { craftTree, gateText, gatingChain } from '../lib/sources.js';
  import { MODE_TAG } from '../lib/traits.js';
  import { wikiHost, wikiUrl } from '../lib/wiki.js';
  import { fmtFull, fmtNum, fmtPart, fmtStat } from '../lib/fmt.js';
  import { FACTORS, SIGN_COLOR, factorOf, factorTip, signOf } from '../lib/factors.js';
  import WikiIcon from './WikiIcon.svelte';
  import BossIcon from './BossIcon.svelte';
  import CraftGraph from './CraftGraph.svelte';
  import { layout, toDisplay } from '../lib/treelayout.js';
  import ScoreParts from './ScoreParts.svelte';
  import PhaseGraph, { CONF } from './PhaseGraph.svelte';
  import PhaseWindow from './PhaseWindow.svelte';
  import { loopPhases } from '../lib/dps.js';
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
      if (typeof v === 'object') for (const [c, n] of Object.entries(v)) out.push(`${k} ${c}: ${fmtEffect(k, n)}`);
      else out.push(`${k}: ${fmtEffect(k, v)}`);
    }
    if (fx.mod) for (const [k, v] of Object.entries(fx.mod)) out.push(`${k}: ${v}`);
    if (fx.flags?.length) out.push(`flags: ${fx.flags.join(', ')}`);
    return out;
  };
  const fmtEffect = (k, n) => (/damage|attackSpeed|moveSpeed|endurance|manaCost|Mult/.test(k) && Math.abs(n) < 5 ? `${n > 0 ? '+' : ''}${Math.round(n * 1000) / 10}%` : `${n > 0 ? '+' : ''}${n}`);
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

  // the dialog opens on the whole tree: a big one shrinks down to where the labels stop being
  // readable, a small one grows to fill the window instead of sitting at 100% in the middle of it
  // (the cap is the same 1.6 the + button stops at)
  const MIN_FIT = 0.3;
  const MAX_FIT = 1.6;
  async function openFullTree() {
    if (!full?.clientWidth || !graph) return; // closed: it has no size to fit to yet
    const pad = 32; // the p-4 around the graph
    // floor, not round: the box is ceil(width × zoom), so rounding the fit up to the next whole
    // percent leaves a sliver of the tree — and a scrollbar — outside the window
    zoom = Math.min(MAX_FIT, Math.max(MIN_FIT, Math.floor(Math.min(
      (full.clientWidth - pad) / graph.width,
      (full.clientHeight - pad) / graph.height,
    ) * 100) / 100));
    await tick(); // the boxes have to be re-scaled before the scroll offset means anything
    centerRoot(full, zoom);
  }
  // clicking a node opens that item in this same card, swapping the tree under an open window
  $effect(() => { void graph; openFullTree(); });
  // the attack graph folds out to the left of the card, where there is room for the full form
  const phases = $derived(dps?.phases ?? []);
  // The loop the weapon is *not* scored in, as a graph of its own: the same tree with the pricing
  // inverted. Its phases are zeroed in the main graph — they must be, or the shares would not add
  // up to the card's number — so here they are priced by `own`, what each is worth inside that
  // loop, and the loop that *is* taken is the one showing nothing.
  const other = $derived(dps?.mode === 'stealth' ? 'spam' : dps?.mode === 'spam' ? 'stealth' : null);
  const otherPhases = $derived(other ? loopPhases(phases, other) : []);
  const otherTotal = $derived(other === 'spam' ? dps?.spam : dps?.stealth);
  /** one of the two graphs the card shows, by the strip it belongs to */
  const viewOf = (k) => (k === 'other'
    ? { phases: otherPhases, total: otherTotal, mode: other, label: `the ${other} loop, the one it is not scored in` }
    : { phases, total: dps?.value, mode: dps?.mode, label: other ? `both loops, scored in the ${dps.mode} one` : '' });
  let popKey = $state('main'); // which of them the full window draws
  const view = $derived(viewOf(popKey === 'other' && other ? 'other' : 'main'));
  // Each strip folds its own graph out beside itself — the bottom one down where it sits, not up
  // at the top one — and both may be out at once, so every measurement here is per strip.
  let out = $state({ main: false, other: false });
  let strips = $state({ main: null, other: null });
  let tops = $state({ main: 0, other: 0 });
  let foldH = $state({ main: 0, other: 0 });
  let vh = $state(800);
  const placeFold = () => { for (const k of ['main', 'other']) if (out[k]) tops[k] = strips[k]?.getBoundingClientRect().top ?? 0; };
  const toggleFold = (k) => { tops[k] = strips[k]?.getBoundingClientRect().top ?? 0; out[k] = !out[k]; };
  $effect(() => { void item; out = { main: false, other: false }; popKey = 'main'; }); // another weapon starts folded in
  // lined up with the strip it came from: a little above it, growing downwards, pushed up only when
  // the window has no room below — and the lower panel gets out of the upper one's way
  const foldTop = (k) => {
    const own = Math.max(8, Math.min(tops[k] - 24, vh - foldH[k] - 8));
    return k === 'other' && out.main ? Math.max(own, foldTop('main') + foldH.main + 8) : own;
  };
  // A gamestage is named after a boss and so is most gate text, so the pair reads as a stutter:
  // "Purified Gel (The Slime God: dropped by The Slime God)". Keep the detail when it already says it.
  const where = (label, detail) => (detail && label && detail.includes(label) ? detail : [label, detail].filter(Boolean).join(': '));
  const hasNotes = $derived(!!(item.changes?.length || item.variants?.length || item.maybe));
  const hasStats = $derived(['damage', 'useTime', 'useAnimation', 'crit', 'defense', 'knockback', 'mana'].some((k) => item[k] !== undefined));
  function onkey(e) { if (e.key === 'Escape') onclose(); }
</script>

{#snippet projLine(it)}
  {@const pid = it.useAmmo ? null : it.shoot}
  {@const p = pid ? ds.projectiles[pid] : null}
  {#if it.useAmmo}<span>Ammo: {ds.ammoKinds[it.useAmmo] ?? it.useAmmo}</span>{/if}
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
    <div class="num text-[14px] font-semibold leading-tight text-ink">{fmtStat(value)}</div>
  </div>
{/snippet}

<svelte:window onkeydown={onkey} bind:innerHeight={vh} />

<!-- `data-dismiss` so the sound layer can hear this the way it hears a popover closing (lib/sound.js) -->
<div class="fixed inset-0 z-40 bg-ink/25 backdrop-blur-[1px]" data-dismiss onclick={onclose} transition:fade={{ duration: 150 }}></div>
<aside class="fixed inset-y-0 right-0 z-50 flex w-full max-w-[520px] flex-col overflow-y-auto bg-panel shadow-[var(--shadow-pop)]"
       style="--accent:{accent}; border-left:3px solid {accent}" onscroll={placeFold}
       transition:fly={{ x: 32, duration: 220, easing: cubicOut, opacity: 0 }}>
  <header class="sticky top-0 z-10 border-b border-line bg-panel/95 px-5 py-3 backdrop-blur" style="box-shadow:var(--shadow-lift)">
    <div class="flex items-start gap-3">
      <WikiIcon {item} size={44} />
      <div class="min-w-0 flex-1">
        <!-- the name, the tooltip, the set bonus and the id are the four things people copy out of
             this card (a wiki search, a note); everything else here is a click target, and the body
             turns selection off so a double click lands on the row and not on a word -->
        <h2 class="selectable text-[17px] leading-tight">{item.name}</h2>
        <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-dim">
          <span>{item.modName}</span>
          <span class="lab-tag">{item.slot}</span>
          {#if item.cls}<span class="lab-tag solid">{CLASS_LABELS[item.cls] ?? item.cls}</span>{/if}
          {#if item.arch}<span class="lab-tag" title={ARCH_HINT[item.arch] ?? ''}>{ARCH_LABELS[item.arch] ?? item.arch}</span>{/if}
          {#if item.rarityName}<span>{item.rarityName}</span>{/if}
          {#if item.expert}<span class="lab-tag plum">expert</span>{/if}
          {#if item.changes?.length}<span class="lab-tag warn" title="Another mod changes this item">rebalanced</span>{/if}
        </div>
      </div>
      <div class="flex shrink-0 gap-1">
        {#if wiki}<a class="lab-btn px-2 py-1" href={wiki} target="_blank" rel="noreferrer" title="Read about this item on {wikiHost(wiki)}">Wiki ↗</a>{/if}
        <button class="lab-btn px-2 py-1" onclick={onclose} aria-label="Close" title="Close this panel (you can also press Esc)">✕</button>
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
    <button class="lab-chip py-0.5" aria-pressed={ui.pinned.includes(item.id)} onclick={() => toggleIn('pinned', item.id)} title="Always keep this in the loadout">pin</button>
    <button class="lab-chip py-0.5" aria-pressed={ui.excluded.includes(item.id)} onclick={() => toggleIn('excluded', item.id)} title="Never suggest this item">exclude</button>
  </div>

  <!-- the number that matters, big -->
  {#if dps}
    <div class="flex items-end justify-between gap-3 border-b border-line px-5 py-3" style="background:linear-gradient(90deg, color-mix(in srgb, {accent} 10%, transparent), transparent)">
      <div>
        <div class="lab-label">Real {dps.kind}</div>
        <div class="num text-[28px] font-bold leading-none" style="color:{accent}" title={fmtFull(dps.value)}>{fmtNum(dps.value)}</div>
      </div>
      <div class="pb-0.5 text-right text-[11.5px] text-dim">
        {#if dps.mode === 'stealth' || dps.mode === 'spam'}
          <span class="lab-tag {MODE_TAG[dps.mode].color}" title={MODE_TAG[dps.mode].tip}>{dps.mode}</span>
          <div class="num mt-1">spam {fmtNum(dps.spam)} + stealth {fmtNum(dps.stealth)}</div>
        {:else if dps.mode}
          <span class="lab-tag {MODE_TAG[dps.mode]?.color ?? ''}" title={MODE_TAG[dps.mode]?.tip ?? ''}>{dps.mode}</span>
          {#if dps.rate}<div class="num mt-1">{dps.rate}/s × {Math.round(dps.critMult * 100) / 100} crit</div>{/if}
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
      <div class="bg-panel">{@render stat('Damage', eff ? eff.damage : item.damage, eff && eff.damage !== item.damage ? `The mod itself sets ${item.damage}${item.dc ? ` ${item.dc.replace(/DamageClass$/, '').toLowerCase()}` : ''} damage.` : item.dc ?? '')}</div>
    {/if}
    {#if item.useTime !== undefined || item.useAnimation !== undefined}
      <div class="bg-panel">{@render stat('Use / anim', `${eff ? eff.useTime : item.useTime ?? '–'} / ${eff ? eff.useAnimation : item.useAnimation ?? '–'}`, 'Ticks between two uses, then ticks the animation takes.')}</div>
    {/if}
    {#if item.crit !== undefined || eff}
      <div class="bg-panel">{@render stat('Crit chance', `${eff ? eff.crit : item.crit}%`)}</div>
    {/if}
    {#if item.defense !== undefined}
      <div class="bg-panel">{@render stat('Defense', item.defense, item.base?.defense !== undefined ? `The mod itself sets ${item.base.defense} defense.` : '')}</div>
    {/if}
    {#if item.knockback !== undefined}<div class="bg-panel">{@render stat('Knockback', item.knockback)}</div>{/if}
    {#if item.mana !== undefined}<div class="bg-panel">{@render stat('Mana', item.mana)}</div>{/if}
  </div>
  {/if}

  <div class="flex flex-col gap-4 px-5 py-4 text-[13px]">
    <!-- where it comes from -->
    <!-- centred, not baseline-aligned: an inline-flex box takes its baseline from its first item, so
         the boss sprite's bottom edge became this span's baseline and pushed the name above the row -->
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
      <span class="lab-label">Obtainable</span>
      <span class="inline-flex items-center gap-1 font-medium"><BossIcon {ds} stage={item.stage} size={16} />{item.stageLabel}</span>
      <span class="lab-tag {SOURCE_TONE[src.kind] ?? ''}" title={SOURCE_HINT[src.kind] ?? src.kind}>{src.kind}</span>
      <!-- the tag already says how it is obtained, so the gate text does not repeat the word -->
      {#if gate}<span class="text-dim">— {gate.replace(new RegExp(`^${src.kind}(ed)? — `), '')}</span>{/if}
    </div>

    <!-- a weapon's "fires" line belongs with the DPS it explains; only one with no DPS section of
         its own (a per-hit summon) still needs it here -->
    {#if (item.shoot || item.useAmmo) && !(dps && dps.kind === 'dps')}
      <div class="text-[12.5px]"><span class="lab-label mb-0.5">Fires</span>{@render projLine(item)}</div>
    {/if}

    {#if item.tooltip}
      <section>
        <div class="lab-rule start mb-1.5">In-game tooltip</div>
        <p class="selectable m-0 whitespace-pre-line border-l-2 border-line pl-3 text-ink2">{item.tooltip}</p>
        {#if item.placeholders}<p class="m-0 mt-1 text-[11.5px] text-warn">Numbers shown as {'{0}'} are filled in at runtime; the score uses the values read from the mod's code where available.</p>{/if}
      </section>
    {/if}

    {#if dps && dps.kind === 'dps'}
      <section class="pb-5">
        <!-- not "Real DPS" again: that is the big number at the top of the card, and this is the
             arithmetic behind it -->
        <div class="lab-rule start mb-1.5">Damage Calculation{dps.mode === 'stealth' ? ' — stealth strikes' : dps.mode === 'spam' ? ' — spam' : ''}</div>
        <!-- what it throws out, then what the arithmetic below was measured against -->
        {#if item.shoot || item.useAmmo}
          <div class="mb-0.5 text-[12px]">{@render projLine(item)}</div>
        {/if}
        <div class="mb-1.5 text-[12px] text-dim">
          {dps.arch ?? 'shot'}{dps.distance ? ` at ${Math.round(dps.distance)} px` : ''}
          {#if dps.boss?.name} · vs {dps.boss.name} ({dps.boss.w}×{dps.boss.h} px, {dps.boss.defense} defense{dps.boss.worm ? ', worm' : dps.boss.parts > 1 ? `, ${dps.boss.parts} parts` : ''}){/if}
        </div>
        <!-- the attack as phases: what happens, how often, and its share of the number below -->
        {#if phases.length}
          <div class="relative mb-2 border border-line bg-panel2/40 p-2" bind:this={strips.main}>
            <div class="overflow-x-auto"><PhaseGraph {ds} {phases} total={dps.value} mode={dps.mode} compact /></div>
            {@render graphButtons('main')}
          </div>
        {/if}
        <div class="lab-calc pb-2">
          {#each (dps.mode === 'stealth' ? dps.stealthParts : dps.parts) as p}
            <div class="row"><span class="lbl has-tip" data-tip={factorTip(p, true)} style="color:{FACTORS[factorOf(p, true)].color}">{p.label}</span><i class="lead"></i><span class="val num" style="color:{SIGN_COLOR[signOf(p, true)]}">{fmtPart(p)}</span></div>
          {/each}
          <div class="row total"><span class="lbl">per second</span><i class="lead"></i><span class="val num" style="color:{accent}" title={fmtFull(dps.value)}>{fmtNum(dps.value)}</span></div>
        </div>
        {#if dps.mode === 'stealth' || dps.mode === 'spam'}
          <details class="mt-1.5 text-[12px] text-dim">
            <summary class="cursor-pointer hover:text-green">the other half: {other} {fmtNum(other === 'spam' ? dps.spam : dps.stealth)}/s</summary>
            {#if otherPhases.length}
              <div class="relative mt-1 border border-line bg-panel2/40 p-2" bind:this={strips.other}>
                <div class="overflow-x-auto"><PhaseGraph {ds} phases={otherPhases} total={otherTotal} mode={other} compact /></div>
                {@render graphButtons('other')}
              </div>
            {/if}
            <div class="lab-calc mt-1">{#each (dps.mode === 'stealth' ? dps.parts : dps.stealthParts) as p}<div class="row"><span class="lbl has-tip" data-tip={factorTip(p, true)} style="color:{FACTORS[factorOf(p, true)].color}">{p.label}</span><i class="lead"></i><span class="val num" style="color:{SIGN_COLOR[signOf(p, true)]}">{fmtPart(p)}</span></div>{/each}</div>
          </details>
        {/if}
      </section>
    {/if}

    {#if score}
      <section>
        <div class="lab-rule start mb-1.5">Score for {CLASS_LABELS[ui.cls]}{prefix ? ` with ${prefix.name}` : ''}</div>
        {#if score.parts.length}<ScoreParts parts={score.parts} score={score.score} max={12} />{:else}<span class="text-[12.5px] text-dim">Nothing this class benefits from.</span>{/if}
        {#if item.slot === 'accessory' && accessoryGroup(item)}
          <p class="m-0 mt-1.5 text-[12px] text-dim">Exclusive group <span class="lab-tag">{accessoryGroup(item).replace(/^nostack:/, '')}</span> — the solver equips only the best of these.</p>
        {/if}
      </section>
    {/if}

    {#if item.slot === 'head' && (item.setBonus || item.setEffects)}
      <section>
        <div class="lab-rule start mb-1.5">Set bonus</div>
        {#if item.setBonus}<p class="selectable m-0 whitespace-pre-line border-l-2 border-green-mid pl-3 text-ink2">{item.setBonus}</p>{/if}
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
        <!-- the button is a sibling of the rule, not inside it: the rule's own trailing line is
             `flex:1` and eats the free space an `ml-auto` would have needed to reach the edge -->
        <div class="mb-1.5 flex items-center gap-2">
          <div class="lab-rule start min-w-0 flex-1">
            Sources
            <Info label="Reading the crafting tree" w={340}>
              <p>The item is the box on the left; everything it is crafted from branches off to the right, each with the stage it becomes available.</p>
              <p>Boxes and connectors in <em>orange</em> are the parts that push the stage forward — those decide when you can make the item.</p>
            </Info>
          </div>
          {#if tree.recipes.length}
            <button class="lab-btn shrink-0 px-2 py-0.5 text-[11.5px]" popovertarget="crafttree" title="Open the whole tree in a bigger view">⤢ Full tree</button>
          {/if}
        </div>
        {#if chain.length}
          <p class="m-0 mb-1.5 text-[12px] text-ink2">Gated by
            {#each chain as c, i}{#if i}, {/if}{#if c.station}<span class="font-medium">{c.station.name}</span> <span class="text-dim">({where(c.station.stageLabel, c.station.boss ? `after ${c.station.boss}` : '')})</span>{:else}<span class="font-medium">{c.node.name}</span>{#if c.viaGroup}<span class="text-dim">&nbsp;for {c.viaGroup}</span>{/if} <span class="text-dim">({where(c.node.stageLabel, c.node.gate)})</span>{/if}{/each}.
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
              <span class="lab-label mb-1">Damage Calculation</span>
              <div class="lab-calc">
                {#each eff.chain as step}
                  <div class="row"><span class="lbl">{step.label}</span><i class="lead"></i><span class="val num">{step.damage ?? ''}</span><span class="val num w-12 text-dim">{step.crit !== undefined ? `${step.crit}%` : ''}</span><span class="val num w-10 text-dim">{step.useTime !== undefined ? `${step.useTime}t` : ''}</span></div>
                {/each}
              </div>
            </div>
          {/if}
          {#if hasNotes}
            <div>
              <span class="lab-label mb-1">Changed by other mods</span>
              <ul class="m-0 list-none p-0 text-[12.5px] text-ink2">
                {#each item.changes ?? [] as c}<li>{c.mod} {c.hook}: {c.text ? `${c.mode === 'all' ? 'rewrote' : c.mode === 'sub' ? 'reworded' : '+'} “${c.text.replace(/\n/g, ' · ')}”` : c.field ? `${c.field} ${c.from} → ${c.to}` : `${c.source ? c.source + ': ' : ''}${fmtEffects(c.effects).join(', ')}`}</li>{/each}
                {#each item.variants ?? [] as v}<li class="text-dim">{v.mod} on {v.cond.join('+')}: {v.text ? `+ “${v.text.replace(/\n/g, ' · ')}”` : v.field ? `${v.field} → ${v.to}` : fmtEffects(v.effects).join(', ')}</li>{/each}
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
    <p class="selectable m-0 text-[11px] text-dim">id <span class="num">{item.id}</span></p>
  </div>
</aside>

<!-- the two ways out of an inline graph, for whichever loop the strip they sit in draws. They sit
     over the graph's top right rather than beside it: taking a column of their own cut the tree
     short, and the buttons bring their own background, so nothing else needs one. -->
{#snippet graphButtons(k)}
  <span class="absolute right-1.5 top-1.5 z-10 flex gap-1">
    <button class="lab-btn hidden px-2 py-0.5 text-[11.5px] md:inline-block" aria-pressed={out[k]} onclick={() => toggleFold(k)} title="Fold out the full attack graph beside this panel">{out[k] ? '⇥' : '⇤'} attack phases</button>
    <button class="lab-btn px-2 py-0.5 text-[11.5px]" popovertarget="phasegraph" onclick={() => (popKey = k)} title="Open the attack graph in a bigger view">⤢</button>
  </span>
{/snippet}

<!-- the attack graph, folded out to the left of the card: a sibling rather than a child, because
     the card scrolls and would clip anything hanging outside it -->
{#snippet phaseLegend()}
  <!-- only the tags this graph actually wears: listing every one of them explained badges that were
       nowhere on screen, and left out `inferred` when it was -->
  {@const tags = [...new Set(phases.map((p) => CONF[p.confidence]).filter(Boolean))]}
  <p class="m-0 text-[11.5px] leading-snug text-dim">
    The use clock is the root. Each phase shows its trigger, its gates, its hit rate on this target and its share of the Real DPS; the shares add up to the card's number.
    {#if other}A branch that starts one of the weapon's two loops is tagged with it, and the shares are of the loop being drawn — the branch outside it counts for nothing. The weapon is scored in the <span class="lab-tag">{dps.mode}</span> loop.{/if}
    {#each tags as [label, hint]}<span class="lab-tag plum">{label}</span> — {hint} {/each}
  </p>
{/snippet}

<!-- as tall as the graph and as wide as it needs, up to 5% short of the left edge -->
{#snippet foldPanel(k)}
  {@const v = viewOf(k)}
  {@const t = foldTop(k)}
  <div class="fixed z-50 hidden w-max max-w-[calc(95vw-520px)] flex-col overflow-auto border border-line bg-panel md:flex"
       style="top:{t}px; right:520px; max-height:calc(100vh - {t + 8}px); --accent:{accent}; box-shadow:var(--shadow-pop)"
       bind:clientHeight={foldH[k]}
       transition:fly={{ x: 24, duration: 200, easing: cubicOut, opacity: 0 }}>
    <div class="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-panel/95 px-4 py-2.5 backdrop-blur">
      <div class="min-w-0 flex-1">
        <div class="lab-label">Attack phases</div>
        <div class="truncate text-[12px] text-dim">{item.name}{v.label ? ` — ${v.label}` : ''}</div>
      </div>
      <button class="lab-btn px-2 py-1" popovertarget="phasegraph" onclick={() => (popKey = k)} title="Open the attack graph in a bigger view">⤢</button>
      <button class="lab-btn px-2 py-1" onclick={() => (out[k] = false)} aria-label="Fold the phases back in">⇥</button>
    </div>
    <div class="p-4">
      <PhaseGraph {ds} phases={v.phases} total={v.total} mode={v.mode} />
      <div class="mt-3 max-w-[420px]">{@render phaseLegend()}</div>
    </div>
  </div>
{/snippet}

{#if phases.length}
  {#if out.main}{@render foldPanel('main')}{/if}
  {#if out.other && other}{@render foldPanel('other')}{/if}
{/if}

<!-- the roomy viewer for the attack graph, like the crafting tree's: fitted on open, zoomable -->
{#if phases.length}
  <PhaseWindow {ds} id="phasegraph" {accent} phases={view.phases} total={view.total} mode={view.mode}
               title={`How ${item.name} attacks${popKey === 'other' && view.label ? ` — ${view.label}` : ''}`} legend={phaseLegend} />
{/if}

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
          <button class="lab-btn px-2 py-0.5 tabular-nums" onclick={openFullTree} title="Fit the whole tree into the window">{Math.round(zoom * 100)}%</button>
          <button class="lab-btn px-2 py-0.5" onclick={() => (zoom = Math.min(MAX_FIT, r2(zoom + 0.15)))} aria-label="Zoom in">+</button>
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
