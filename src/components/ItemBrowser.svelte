<script>
  /**
   * The full item view: a filter column (context, sort, collapsible filter groups) and result
   * cards, each scored for the class and gamestage in view and expandable in place.
   */
  import { CLASS_LABELS, SLOT_LABELS, SOURCE_HINT, SOURCE_TONE, accentOf } from '../lib/dataset.js';
  import { pieceScore, weaponDps } from '../lib/score.js';
  import { effectiveStats } from '../lib/stats.js';
  import { setOwned, toggleIn, ui } from '../lib/state.svelte.js';
  import { craftTree, gateText, gatingChain } from '../lib/sources.js';
  import { traitsOf } from '../lib/traits.js';
  import WikiIcon from './WikiIcon.svelte';
  import ScoreParts from './ScoreParts.svelte';
  import CraftGraph from './CraftGraph.svelte';

  let { ds, statCtx, onselect } = $props();

  // ---- the filter model lives in ui.browse (persisted); null ranges mean "unset"
  const B = () => ui.browse;
  const DEFAULTS = { slots: [], classes: [], mods: [], stage: null, score: null, features: [], sources: [], sort: 'value' };
  const reset = () => { ui.browse = { ...DEFAULTS }; ui.query = ''; };
  const toggle = (key, v) => { const cur = B()[key]; ui.browse = { ...B(), [key]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] }; };
  let collapsed = $state(new Set());
  const flip = (g) => { const n = new Set(collapsed); if (n.has(g)) n.delete(g); else n.add(g); collapsed = n; };

  const FEATURES = [
    ['wings', '🪽'], ['boots', '👢'], ['dash', '⇢'], ['flight boost', '⤴'], ['stealth', '🗡'], ['stealth strike bonus', '🗡'], ['on-hit spawn', '✦'],
    ['knockback immunity', '🛡'], ['debuff immunity', '⚕'], ['lava protection', '♨'], ['conditional', '½'], ['runtime formula', 'ƒ'], ['rebalanced', '⚖'],
    ['reforged', '⚒'], ['set bonus', '⛨'], ['pierce', '➶'], ['homing', '◎'], ['multi-shot', '⁂'], ['child projectiles', '✧'], ['through walls', '▤'], ['inflicts debuffs', '☠'],
    ['true melee', '⚔'], ['uses ammo', '⁍'], ['minion', '🐝'], ['sentry', '⌂'], ['mana hungry', '✶'],
  ];
  const ICON = Object.fromEntries(FEATURES);

  // ---- every item, scored for the class and stage in view (the row shape the loadout uses)
  const progression = $derived(ds.stages[ui.stage]?.progression);
  const excludedMods = $derived(new Set(ui.excludedMods));
  const scored = $derived.by(() => {
    const out = [];
    for (const it of ds.items) {
      if (excludedMods.has(it.mod)) continue;
      if (it.slot === 'weapon') {
        const d = weaponDps(it, statCtx);
        out.push({ item: it, value: d.value, kind: d.kind, dps: d, parts: d.mode === 'stealth' ? d.stealthParts : d.parts, mode: d.mode, eff: d.eff });
      } else {
        const s = pieceScore(it, ui.cls, ds.aliases, { progression });
        out.push({ item: it, value: s.score, kind: 'score', parts: s.parts, stealth: s.stealth });
      }
    }
    for (const e of out) e.traits = traitsOf(e);
    return out;
  });

  // ---- filters
  const stageMax = $derived(ds.stages.length - 1);
  const stageRange = $derived(B().stage ?? [0, ui.stage]);
  const scoreTop = $derived(Math.max(1, ...scored.map((e) => (e.kind === 'score' ? e.value : 0))));
  const scoreRange = $derived(B().score ?? [0, scoreTop]);
  const passStage = (it) => (it.stage === null || it.stage === undefined ? ui.unknownStage : it.stage >= stageRange[0] && it.stage <= stageRange[1]);
  const passText = (e) => {
    const terms = ui.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return true;
    const it = e.item;
    const hay = [it.name, it.tooltip ?? '', it.setBonus ?? '', it.modName ?? '', ...e.traits].join(' | ').toLowerCase();
    return terms.every((t) => (t.startsWith('-') ? t.length === 1 || !hay.includes(t.slice(1)) : hay.includes(t)));
  };
  // each group's pass, so a group's counts can ignore its own selection
  const pass = {
    slots: (e) => !B().slots.length || B().slots.includes(e.item.slot),
    classes: (e) => !B().classes.length || B().classes.includes(e.item.cls ?? 'none'),
    mods: (e) => !B().mods.length || B().mods.includes(e.item.mod),
    stage: (e) => passStage(e.item),
    score: (e) => e.kind !== 'score' || (e.value >= scoreRange[0] && e.value <= scoreRange[1]),
    features: (e) => B().features.every((f) => e.traits.includes(f)),
    sources: (e) => !B().sources.length || B().sources.includes(e.item.stageSource?.kind ?? 'unknown'),
    text: passText,
  };
  const passAllBut = (e, skip) => Object.entries(pass).every(([k, f]) => k === skip || f(e));
  const results = $derived.by(() => {
    const list = scored.filter((e) => passAllBut(e, null));
    const dir = B().sort === 'name' || B().sort === 'mod' ? 1 : -1;
    const val = (e) => ({ value: e.value, name: e.item.name, stage: -(e.item.stage ?? 999), damage: e.item.damage ?? -1, defense: e.item.defense ?? -1, mod: e.item.modName })[B().sort];
    return list.sort((a, b) => { const va = val(a); const vb = val(b); const c = typeof va === 'string' ? va.localeCompare(vb) : va - vb; return c !== 0 ? c * dir : a.item.name.localeCompare(b.item.name); });
  });
  const countsFor = (key, of) => { const m = new Map(); for (const e of scored) if (passAllBut(e, key)) { const k = of(e); m.set(k, (m.get(k) ?? 0) + 1); } return m; };
  const slotCounts = $derived(countsFor('slots', (e) => e.item.slot));
  const classCounts = $derived(countsFor('classes', (e) => e.item.cls ?? 'none'));
  const modCounts = $derived(countsFor('mods', (e) => e.item.mod));
  const sourceCounts = $derived(countsFor('sources', (e) => e.item.stageSource?.kind ?? 'unknown'));
  const featureCounts = $derived.by(() => { const m = new Map(); for (const e of scored) if (passAllBut(e, 'features')) for (const t of e.traits) if (ICON[t]) m.set(t, (m.get(t) ?? 0) + 1); return m; });
  const bestIn = (key, of, k) => { let best = -Infinity; for (const e of scored) if (passAllBut(e, key) && of(e) === k) best = Math.max(best, e.value); return best; };
  const active = $derived(B().slots.length || B().classes.length || B().mods.length || B().stage || B().score || B().features.length || B().sources.length || ui.query);

  let shown = $state(30);
  $effect(() => { void [results]; shown = 30; });
  const maxValue = $derived(Math.max(1, ...results.slice(0, shown).map((e) => e.value)));

  // ---- quick-compare strip: the stages around the one in view, with what each adds
  let strip = $state(0); // offset from the current stage
  const newAt = $derived.by(() => { const m = new Map(); for (const e of scored) if (e.item.stage !== null && e.item.stage !== undefined) m.set(e.item.stage, (m.get(e.item.stage) ?? 0) + 1); return m; });
  const stripStages = $derived.by(() => { const c = Math.min(stageMax - 3, Math.max(3, ui.stage + strip)); return ds.stages.slice(Math.max(0, c - 3), c + 4); });
  const setStage = (i) => { ui.stage = i; strip = 0; };

  // ---- cards: which tab each open card shows
  let open = $state({}); // id → tab
  const tabOf = (id) => open[id] ?? null;
  const setTab = (id, t) => { open = { ...open, [id]: open[id] === t ? null : t }; };
  const fmt = (v) => (v === null || v === undefined ? '–' : v >= 1000 ? Math.round(v).toLocaleString() : Math.round(v * 10) / 10);
  const r1 = (v) => Math.round(v * 10) / 10;
  const short = (label) => label.replace(/^(?:The |Post )/, '').replace(/ \/ .*/, '');
  const obtain = (it) => { const tree = craftTree(ds, it.id); return { tree, chain: tree ? gatingChain(tree) : [], gate: tree ? gateText(tree, ds) : '' }; };
  const chainOf = (it) => (it.slot === 'weapon' ? effectiveStats(it, statCtx).chain : []);
  const accent = $derived(accentOf(ui.cls));
</script>

{#snippet group(id, title, body)}
  <div class="border-b border-line">
    <button type="button" class="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-ink2 hover:text-green" onclick={() => flip(id)} aria-expanded={!collapsed.has(id)}>
      {title}<span class="text-dim transition-transform" class:rotate-180={!collapsed.has(id)}>⌄</span>
    </button>
    {#if !collapsed.has(id)}<div class="px-3 pb-3">{@render body()}</div>{/if}
  </div>
{/snippet}

{#snippet check(on, label, meta, onclick, icon)}
  <label class="flex cursor-pointer items-center gap-2 py-[3px] text-[12.5px]">
    <input type="checkbox" checked={on} onchange={onclick} style="accent-color:{accent}" />
    <span class="min-w-0 flex-1 truncate text-ink2">{label}</span>
    {#if icon}<span class="w-5 text-center text-[13px] text-dim" title={label}>{icon}</span>{:else}<span class="num text-[11px] text-dim">{meta}</span>{/if}
  </label>
{/snippet}

{#snippet range(lo, hi, min, max, fmtV, onlo, onhi)}
  <div class="num flex justify-between text-[12px] font-semibold text-ink"><span>{fmtV(lo)}</span><span>{fmtV(hi)}</span></div>
  <div class="lab-range" style="--lo:{((lo - min) / Math.max(1, max - min)) * 100}%; --hi:{((hi - min) / Math.max(1, max - min)) * 100}%; --accent:{accent}">
    <div class="track"></div><div class="span"></div>
    <input type="range" {min} {max} value={lo} oninput={(e) => onlo(Math.min(Number(e.currentTarget.value), hi))} aria-label="minimum" />
    <input type="range" {min} {max} value={hi} oninput={(e) => onhi(Math.max(Number(e.currentTarget.value), lo))} aria-label="maximum" />
  </div>
  <div class="num flex justify-between text-[10.5px] text-dim"><span>{fmtV(min)}</span><span>{fmtV(max)}</span></div>
{/snippet}

<section class="lab-panel overflow-hidden" style="--accent:{accent}">
  <header class="lab-head">
    <h2>Browse items</h2>
    <span class="lab-meta"><span class="num font-semibold text-ink">{results.length.toLocaleString()}</span> of {scored.length.toLocaleString()} · scored for <span class="font-semibold" style="color:{accent}">{CLASS_LABELS[ui.cls]}</span> at <span class="font-semibold text-ink">{ds.stages[ui.stage]?.label}</span></span>
  </header>

  <div class="grid md:grid-cols-[250px_minmax(0,1fr)]">
    <!-- ================= filter column ================= -->
    <aside class="border-r border-line bg-panel2/40 text-[12.5px]">
      <!-- context: what the scores mean -->
      <div class="m-3 border border-line bg-panel">
        {#each [
          ['class', accent, 'Scoring for', CLASS_LABELS[ui.cls], true],
          ['stage', 'var(--color-warn)', 'Gamestage', ds.stages[ui.stage]?.label ?? '?', false],
          ['pool', 'var(--color-info)', 'Gear pool', ui.source === 'owned' ? 'only what I own' : 'everything obtainable', false],
        ] as [k, color, caption, label, isActive] (k)}
          <div class="flex items-center gap-2.5 border-b border-line px-2.5 py-1.5 last:border-0" class:bg-green-soft={isActive} style={isActive ? `background:color-mix(in srgb, ${accent} 10%, transparent)` : ''}>
            <span class="h-2.5 w-2.5 shrink-0 rounded-full" style="background:{color}"></span>
            <span class="min-w-0"><span class="block text-[10px] uppercase tracking-[0.1em] text-dim">{caption}</span><span class="block truncate font-medium text-ink">{label}</span></span>
          </div>
        {/each}
      </div>
      <!-- sort -->
      <div class="mx-3 mb-3">
        <label class="block">
          <span class="block text-[10px] uppercase tracking-[0.1em] text-dim">Sort by</span>
          <select class="lab-input mt-0.5 w-full" value={B().sort} onchange={(e) => (ui.browse = { ...B(), sort: e.currentTarget.value })}>
            <option value="value">Score / DPS</option>
            <option value="name">Name</option>
            <option value="stage">Gamestage</option>
            <option value="damage">Damage</option>
            <option value="defense">Defense</option>
            <option value="mod">Mod</option>
          </select>
        </label>
      </div>
      <!-- filter header -->
      <div class="flex items-center justify-between border-b border-t border-line px-3 py-2">
        <span class="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink">Filter</span>
        <button type="button" class="cursor-pointer text-[12px] underline decoration-line underline-offset-2 hover:text-green" class:text-dim={!active} onclick={reset}>Reset</button>
      </div>
      <div class="px-3 py-2"><input class="lab-input w-full" placeholder="Name, tooltip or trait… (-word excludes)" bind:value={ui.query} /></div>

      {#snippet slotsBody()}
        {#each Object.entries(SLOT_LABELS) as [k, v]}
          {@render check(B().slots.includes(k), v, slotCounts.get(k) ?? 0, () => toggle('slots', k))}
        {/each}
      {/snippet}
      {@render group('slots', 'Slot', slotsBody)}

      {#snippet classBody()}
        {#each [...ds.classList, 'classless', 'other', 'none'] as c}
          {#if classCounts.get(c)}
            {@render check(B().classes.includes(c), c === 'none' ? 'no class (gear)' : CLASS_LABELS[c] ?? c, `best ${fmt(bestIn('classes', (e) => e.item.cls ?? 'none', c))}`, () => toggle('classes', c))}
          {/if}
        {/each}
      {/snippet}
      {@render group('classes', 'Class', classBody)}

      {#snippet stageBody()}
        {@render range(stageRange[0], stageRange[1], 0, stageMax, (i) => short(ds.stages[i]?.label ?? String(i)), (v) => (ui.browse = { ...B(), stage: [v, stageRange[1]] }), (v) => (ui.browse = { ...B(), stage: [stageRange[0], v] }))}
        <p class="m-0 mt-1 text-[11px] text-dim">{B().stage ? 'A window of gamestages.' : 'Everything up to the stage in view.'}{#if B().stage} <button type="button" class="cursor-pointer underline hover:text-green" onclick={() => (ui.browse = { ...B(), stage: null })}>follow the view</button>{/if}</p>
      {/snippet}
      {@render group('stage', 'Gamestage', stageBody)}

      {#snippet scoreBody()}
        {@render range(scoreRange[0], scoreRange[1], 0, Math.ceil(scoreTop), (v) => String(Math.round(v)), (v) => (ui.browse = { ...B(), score: [v, scoreRange[1]] }), (v) => (ui.browse = { ...B(), score: [scoreRange[0], v] }))}
        <p class="m-0 mt-1 text-[11px] text-dim">Armor and accessories; weapons rank by DPS.</p>
      {/snippet}
      {@render group('score', 'Score', scoreBody)}

      {#snippet featureBody()}
        {#each FEATURES as [t, icon]}
          {#if featureCounts.get(t)}
            {@render check(B().features.includes(t), `${t} · ${featureCounts.get(t)}`, '', () => toggle('features', t), icon)}
          {/if}
        {/each}
      {/snippet}
      {@render group('features', 'Features', featureBody)}

      {#snippet sourceBody()}
        {#each [...sourceCounts.entries()].sort((a, b) => b[1] - a[1]) as [k, n]}
          {@render check(B().sources.includes(k), SOURCE_HINT[k] ? k : k, n, () => toggle('sources', k))}
        {/each}
      {/snippet}
      {@render group('sources', 'Source', sourceBody)}

      {#snippet modBody()}
        {#each ds.mods.filter((m) => m.equipment > 0) as m}
          {#if modCounts.get(m.id)}
            {@render check(B().mods.includes(m.id), m.name, modCounts.get(m.id), () => toggle('mods', m.id))}
          {/if}
        {/each}
      {/snippet}
      {@render group('mods', 'Mod', modBody)}
    </aside>

    <!-- ================= results ================= -->
    <div class="min-w-0">
      <!-- quick compare: neighbouring gamestages -->
      <div class="flex items-center gap-1 border-b border-line px-3 py-2">
        <button type="button" class="lab-btn px-2 py-0.5" onclick={() => (strip -= 3)} disabled={ui.stage + strip <= 3} aria-label="Earlier stages">‹</button>
        <div class="flex min-w-0 flex-1 gap-1 overflow-hidden">
          {#each stripStages as s (s.index)}
            <button type="button" class="min-w-0 flex-1 cursor-pointer border border-line px-2 py-1 text-left transition-colors hover:border-line-strong" class:bg-panel={s.index !== ui.stage} style={s.index === ui.stage ? `background:color-mix(in srgb, ${accent} 12%, #fff); border-color:${accent}` : ''} onclick={() => setStage(s.index)} title={s.label}>
              <span class="block truncate text-[11.5px] font-medium text-ink">{short(s.label)}</span>
              <span class="num block text-[10.5px] text-dim">+{newAt.get(s.index) ?? 0} items</span>
            </button>
          {/each}
        </div>
        <button type="button" class="lab-btn px-2 py-0.5" onclick={() => (strip += 3)} disabled={ui.stage + strip >= stageMax - 3} aria-label="Later stages">›</button>
        <button type="button" class="lab-btn ml-1 px-2 py-0.5" popovertarget="stagepicker" title="Every gamestage">All stages…</button>
        <div id="stagepicker" popover="auto" class="lab-pop col" style="--w:560px">
          <div class="lab-rule start mb-2">Gamestage</div>
          <div class="grid gap-px sm:grid-cols-2">
            {#each ds.stages as s (s.index)}
              <button type="button" class="cursor-pointer px-2 py-1 text-left text-[12px] hover:bg-green-soft" class:font-semibold={s.index === ui.stage} onclick={() => setStage(s.index)}>{s.index} · {s.label} <span class="num text-dim">+{newAt.get(s.index) ?? 0}</span></button>
            {/each}
          </div>
        </div>
      </div>

      {#if !results.length}
        <p class="px-4 py-10 text-center text-[12.5px] text-dim">Nothing matches. <button type="button" class="cursor-pointer underline hover:text-green" onclick={reset}>Reset the filter</button>.</p>
      {/if}
      <div class="flex flex-col gap-2 p-3">
        {#each results.slice(0, shown) as e (e.item.id)}
          {@const it = e.item}
          {@const tab = tabOf(it.id)}
          <article class="border border-line bg-panel" style={tab ? `border-color:color-mix(in srgb, ${accent} 45%, var(--color-line))` : ''}>
            <!-- summary row -->
            <div class="grid grid-cols-[auto_minmax(0,1.3fr)_auto_minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-2">
              <WikiIcon item={it} size={30} />
              <div class="min-w-0">
                <div class="truncate font-medium text-ink">{it.name}
                  {#if e.mode}<span class="lab-tag ml-1" class:plum={e.mode === 'stealth'}>{e.mode}</span>{/if}
                  {#if e.stealth}<span class="lab-tag plum ml-1" title="boosts stealth strikes">stealth</span>{/if}
                  {#if it.id in ui.owned}<span class="lab-tag green ml-1">yours</span>{/if}
                  {#if ui.pinned.includes(it.id)}<span class="lab-tag info ml-1">pinned</span>{/if}
                  {#if ui.excluded.includes(it.id)}<span class="lab-tag bad ml-1">excluded</span>{/if}
                </div>
                <div class="truncate text-[11.5px] text-dim">{it.modName} · <span class="lab-tag">{it.slot}</span>{#if it.cls} · {CLASS_LABELS[it.cls] ?? it.cls}{/if} · {it.stageLabel}</div>
              </div>
              <div class="flex gap-3 whitespace-nowrap">
                {#if it.slot === 'weapon'}
                  <span><span class="block text-[9.5px] uppercase tracking-[0.1em] text-dim">dmg</span><span class="num text-[13px] font-semibold">{e.eff?.damage ?? it.damage ?? '–'}</span></span>
                  <span><span class="block text-[9.5px] uppercase tracking-[0.1em] text-dim">use</span><span class="num text-[13px]">{Math.round(it.cls === 'melee' ? e.eff?.useAnimation : e.eff?.useTime) || '–'}</span></span>
                  <span><span class="block text-[9.5px] uppercase tracking-[0.1em] text-dim">crit</span><span class="num text-[13px]">{e.eff?.crit ?? it.crit ?? 0}%</span></span>
                {:else}
                  <span><span class="block text-[9.5px] uppercase tracking-[0.1em] text-dim">def</span><span class="num text-[13px] font-semibold">{it.defense ?? '–'}</span></span>
                  <span><span class="block text-[9.5px] uppercase tracking-[0.1em] text-dim">parts</span><span class="num text-[13px]">{e.parts.length}</span></span>
                {/if}
              </div>
              <div class="bar" title="{e.kind === 'score' ? 'score' : 'DPS'} against the best shown"><i style="width:{Math.round((Math.max(0, e.value) / maxValue) * 100)}%"></i></div>
              <div class="flex gap-1 text-[13px] text-dim">
                {#each e.traits.filter((t) => ICON[t]).slice(0, 6) as t}<span class="has-tip cursor-help" data-tip={t}>{ICON[t]}</span>{/each}
              </div>
              <div class="num min-w-[56px] text-right text-[16px] font-bold" style="color:{accent}" title={e.kind === 'score' ? 'class score' : 'real DPS'}>{fmt(e.value)}</div>
            </div>
            <!-- tab row -->
            <div class="flex items-center gap-3 border-t border-line px-3 text-[12px]">
              {#each (it.slot === 'weapon' ? [['stats', 'Real DPS'], ['obtain', 'How to get it'], ['fires', 'What it fires']] : [['score', 'Score'], ['obtain', 'How to get it'], ['effects', 'Effects']]) as [t, label]}
                <button type="button" class="cursor-pointer border-b-2 py-1.5 transition-colors hover:text-green" class:border-transparent={tab !== t} class:text-dim={tab !== t} style={tab === t ? `border-color:${accent}; color:${accent}` : ''} onclick={() => setTab(it.id, t)}>{label}</button>
              {/each}
              <span class="ml-auto flex items-center gap-1 py-1">
                <button type="button" class="lab-chip py-0.5" aria-pressed={it.id in ui.owned} onclick={() => setOwned(it.id, !(it.id in ui.owned))}>own</button>
                <button type="button" class="lab-chip py-0.5" aria-pressed={ui.pinned.includes(it.id)} onclick={() => toggleIn('pinned', it.id)}>pin</button>
                <button type="button" class="lab-chip py-0.5" aria-pressed={ui.excluded.includes(it.id)} onclick={() => toggleIn('excluded', it.id)}>exclude</button>
                <button type="button" class="lab-btn px-2.5 py-0.5 font-semibold" style="border-color:{accent}; color:{accent}" onclick={() => onselect(it.id)}>Details ↗</button>
              </span>
            </div>
            <!-- expanded panel: a timeline on the left, a supporting visual on the right -->
            {#if tab}
              <div class="grid gap-4 border-t border-line bg-panel2/40 px-3 py-3 text-[12.5px] md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                {#if tab === 'score'}
                  <ol class="lab-timeline">
                    {#each e.parts as p}
                      <li><span class="when num" class:text-bad={p.value < 0}>{p.value > 0 ? '+' : ''}{p.value}</span><span class="what">{p.label}</span>{#if p.detail}<span class="how">{p.detail}</span>{/if}</li>
                    {/each}
                    {#if !e.parts.length}<li><span class="when">0</span><span class="what text-dim">Nothing {CLASS_LABELS[ui.cls]} benefits from.</span></li>{/if}
                  </ol>
                  <div>
                    <div class="lab-label mb-1">Score for {CLASS_LABELS[ui.cls]}</div>
                    <div class="flex flex-col gap-1">
                      {#each e.parts as p}
                        <div class="grid grid-cols-[minmax(0,1fr)_120px_40px] items-center gap-2 text-[11.5px]"><span class="truncate text-ink2">{p.label}</span><div class="bar"><i style="width:{Math.min(100, Math.round((Math.abs(p.value) / Math.max(1, ...e.parts.map((q) => Math.abs(q.value)))) * 100))}%" class:opacity-40={p.value < 0}></i></div><span class="num text-right" class:text-bad={p.value < 0}>{p.value}</span></div>
                      {/each}
                    </div>
                    <div class="mt-2 text-[12px]"><span class="text-dim">total</span> <span class="num font-semibold" style="color:{accent}">{e.value}</span></div>
                    {#if it.tooltip}<p class="m-0 mt-2 whitespace-pre-line border-l-2 border-line pl-2 text-[11.5px] text-ink2">{it.tooltip}</p>{/if}
                  </div>
                {:else if tab === 'stats'}
                  <ol class="lab-timeline">
                    {#each chainOf(it) as c}
                      <li><span class="when num">{c.damage ?? ''}</span><span class="what">{c.label}</span>{#if c.crit !== undefined}<span class="how num">crit {c.crit}% · use {c.useTime}</span>{/if}</li>
                    {/each}
                  </ol>
                  <div>
                    <div class="lab-label mb-1">Real DPS{e.mode ? ` — ${e.mode}` : ''}</div>
                    <table class="lab-table"><tbody>
                      {#each e.parts as p}<tr><td class="text-[12px] text-ink2">{p.label}</td><td class="num text-right">{p.value !== undefined ? p.value : `×${p.mul}${p.unit ?? ''}`}</td></tr>{/each}
                      <tr class="font-semibold"><td>per second</td><td class="num text-right" style="color:{accent}">{r1(e.value)}</td></tr>
                    </tbody></table>
                    {#if e.mode}<p class="m-0 mt-1 text-[11.5px] text-dim">spam {r1(e.dps.spam)} · stealth {r1(e.dps.stealth)} — the higher one is the grade.</p>{/if}
                  </div>
                {:else if tab === 'obtain'}
                  {@const o = obtain(it)}
                  <ol class="lab-timeline">
                    <li><span class="when">{it.stageLabel}</span><span class="what">Obtainable <span class="lab-tag {SOURCE_TONE[it.stageSource?.kind] ?? ''}">{it.stageSource?.kind ?? '?'}</span></span>{#if o.gate}<span class="how">{o.gate}</span>{/if}</li>
                    {#each o.tree?.drops ?? [] as s}
                      <li><span class="when"><span class="lab-tag {SOURCE_TONE[s.kind] ?? ''}">{s.kind}</span></span><span class="what">{s.from}</span>{#if s.cond}<span class="how">after {s.cond}</span>{/if}</li>
                    {/each}
                    {#each o.chain as c}
                      {#if c.station}
                        <li><span class="when">{c.station.stageLabel}</span><span class="what">at a {c.station.name}</span>{#if c.station.boss}<span class="how">after {c.station.boss}</span>{/if}</li>
                      {:else}
                        <li><span class="when">{c.node.stageLabel}</span><span class="what">needs {c.node.name}{#if c.viaGroup} <span class="text-dim">for {c.viaGroup}</span>{/if}</span><span class="how">{c.node.gate}</span></li>
                      {/if}
                    {/each}
                  </ol>
                  <div>
                    {#if o.tree?.recipes?.length}
                      <div class="lab-label mb-1">Crafting tree</div>
                      <div class="max-h-[300px] overflow-auto border border-line bg-panel p-1" style="display:grid; place-content:safe center"><CraftGraph {ds} tree={o.tree} {onselect} scale={0.8} /></div>
                    {:else}
                      <div class="lab-label mb-1">Sources</div>
                      <ul class="m-0 list-none p-0">{#each it.sources ?? [] as s}<li class="py-0.5"><span class="lab-tag mr-1 {SOURCE_TONE[s.kind] ?? ''}">{s.kind}</span>{s.from}{#if s.cond}<span class="text-dim"> · {s.cond}</span>{/if}</li>{/each}</ul>
                      {#if !(it.sources ?? []).length}<p class="m-0 text-dim">No recipe or drop found in the mods' code.</p>{/if}
                    {/if}
                  </div>
                {:else if tab === 'effects'}
                  <ol class="lab-timeline">
                    {#each Object.entries(it.effects ?? {}).filter(([k]) => !['flags', 'via', 'mod', 'onHit'].includes(k)) as [k, v]}
                      <li><span class="when num">{typeof v === 'object' ? Object.entries(v).map(([c, n]) => `${c} ${n}`).join(', ') : v}</span><span class="what">{k.replace(/([a-z])([A-Z])/g, '$1 $2')}</span></li>
                    {/each}
                    {#each it.effects?.onHit ?? [] as s}<li><span class="when">on hit</span><span class="what">spawns {s.name}</span><span class="how">{s.damage ? `${s.damage} base damage` : s.share ? `${Math.round(s.share * 100)}% of the hit` : 'damage unknown'}{s.stealth ? ', stealth strikes only' : ''}</span></li>{/each}
                    {#if it.effects?.flags?.length}<li><span class="when">flags</span><span class="what num">{it.effects.flags.join(', ')}</span></li>{/if}
                    {#if !it.effects}<li><span class="when">–</span><span class="what text-dim">No effect read from the code.</span></li>{/if}
                  </ol>
                  <div>
                    <div class="lab-label mb-1">In-game tooltip</div>
                    <p class="m-0 whitespace-pre-line border-l-2 border-line pl-2 text-ink2">{it.tooltip || '—'}</p>
                    {#if it.setBonus}<div class="lab-label mb-1 mt-2">Set bonus</div><p class="m-0 whitespace-pre-line border-l-2 border-green-mid pl-2 text-ink2">{it.setBonus}</p>{/if}
                    {#if it.condStats?.length}<p class="m-0 mt-2 text-[11.5px] text-dim">Conditional in the text: {it.condStats.join(', ')} — counted at half.</p>{/if}
                  </div>
                {:else if tab === 'fires'}
                  <ol class="lab-timeline">
                    {#if it.useAmmo}<li><span class="when">ammo</span><span class="what">{ds.ammoKinds[it.useAmmo] ?? it.useAmmo}</span></li>{/if}
                    {#if it.shoot}
                      {@const p = ds.projectiles[it.shoot]}
                      <li><span class="when num">{it.shoot.split(':').pop()}</span><span class="what">projectile</span>{#if p}<span class="how">{p.pen === -1 ? 'infinite pierce' : p.pen > 1 ? `pierces ${p.pen}` : 'no pierce'}{p.homing ? ', homing' : ''}{p.gravity ? ', gravity' : ''}{p.walls ? ', through walls' : ''}{p.children?.length ? `, spawns ${p.children.map((c) => `${c.count > 1 ? c.count + '× ' : ''}${c.type.split(':').pop()} (${c.where})`).join(', ')}` : ''}{p.debuffs?.length ? `, inflicts ${p.debuffs.length} debuff${p.debuffs.length > 1 ? 's' : ''}` : ''}</span>{/if}</li>
                    {/if}
                    {#each it.fire?.calls ?? [] as c}
                      <li><span class="when num">{c.count ?? 1}×</span><span class="what">{c.type === 'shoot' ? 'the shot' : c.type.split(':').pop()}{c.variant ? ` [${c.variant}]` : ''}</span>{#if c.spread}<span class="how">±{Math.round((c.spread * 180) / Math.PI)}° spread</span>{/if}</li>
                    {/each}
                    {#if !it.shoot && !it.fire?.calls?.length && !it.useAmmo}<li><span class="when">–</span><span class="what text-dim">Contact only.</span></li>{/if}
                  </ol>
                  <div>
                    <div class="lab-label mb-1">Accuracy and hits per use</div>
                    <table class="lab-table"><tbody>
                      {#each e.parts.filter((p) => p.mul !== undefined) as p}<tr><td class="text-[12px] text-ink2">{p.label}</td><td class="num text-right">×{p.mul}{p.unit ?? ''}</td></tr>{/each}
                    </tbody></table>
                  </div>
                {/if}
              </div>
            {/if}
          </article>
        {/each}
        {#if results.length > shown}
          <button type="button" class="lab-btn mx-auto my-1 px-4 py-1" onclick={() => (shown += 30)}>Show 30 more <span class="num text-dim">({results.length - shown} left)</span></button>
        {/if}
      </div>
    </div>
  </div>
</section>
