<script>
  import Header from './components/Header.svelte';
  import Controls from './components/Controls.svelte';
  import LoadoutPanel from './components/LoadoutPanel.svelte';
  import Timeline from './components/Timeline.svelte';
  import ItemBrowser from './components/ItemBrowser.svelte';
  import ItemCard from './components/ItemCard.svelte';
  import GearPanel from './components/GearPanel.svelte';
  import CalibrationPanel from './components/CalibrationPanel.svelte';
  import Footer from './components/Footer.svelte';
  import StartPage from './components/StartPage.svelte';
  import { fitCalibration } from './lib/calibration.js';
  import { applySeeds, loadDataset } from './lib/dataset.js';
  import { getChoice, setChoice } from './lib/datasets.js';
  import { solveLoadout, solveTimeline, unpackTimeline } from './lib/solver.js';
  import { setEnabled, startSound } from './lib/sound.js';
  import { persist, ui } from './lib/state.svelte.js';

  // the dataset is 4.5k items deep and never mutated field-by-field: `$state.raw` keeps Svelte from
  // wrapping every item in a reactive proxy, which made every read in the solver ~4× dearer
  let ds = $state.raw(null);
  let error = $state(null);
  let dsRaw = null; // the indexed dataset itself; `ds` is a shallow copy so seed changes re-render

  // Deep links: ?cls=summon&stage=35&mode=timeline&item=CalamityMod:Murasama&targets=multi
  function applyUrl(d) {
    const q = new URLSearchParams(location.search);
    if (q.has('cls')) ui.cls = q.get('cls');
    if (q.has('stage')) {
      const s = q.get('stage');
      const idx = /^\d+$/.test(s) ? Number(s) : d.stages.findIndex((x) => x.key.toLowerCase() === s.toLowerCase() || x.label.toLowerCase() === s.toLowerCase());
      if (idx >= 0) ui.stage = idx;
    }
    if (q.has('mode')) ui.mode = q.get('mode');
    if (q.has('targets')) ui.targets = q.get('targets');
    if (q.has('item') && d.byId.has(q.get('item'))) ui.selected = q.get('item');
    if (q.has('panel')) ui.panel = q.get('panel');
  }

  // Which dataset is on screen — a shipped preset or the user's own mine (see lib/datasets.js).
  // The choice sticks until they come back to the start page; a switch drops everything derived
  // from the old one, the timeline worker included, since it holds a dataset of its own.
  const chosen = getChoice(); // read once, as a plain value: `dsUrl` is state, and this runs before any effect
  let dsUrl = $state.raw(chosen);
  let showStart = $state(!chosen);

  function open(url) {
    dsUrl = url;
    error = null;
    ds = null;
    dsRaw = null;
    timeline = null;
    solving = null;
    worker?.terminate();
    worker = null;
    loadDataset(url).then((d) => {
      if (dsUrl !== url) return; // a faster second pick won
      dsRaw = d;
      ui.seeds = ui.seeds.filter((s) => d.seeds.some((x) => x.key === s));
      applySeeds(d, ui.seeds); // a saved seed has to be in before the first render
      ds = d;
      applyUrl(d);
      if (ui.stage >= d.stages.length) ui.stage = d.stages.length - 1;
      if (!d.classList.includes(ui.cls)) ui.cls = d.classList[0] ?? 'melee';
      if (!['loadout', 'timeline', 'items'].includes(ui.mode)) ui.mode = 'loadout';
      ui.conds = ui.conds.filter((c) => d.conditions.includes(c));
    }).catch((e) => { if (dsUrl === url) error = e?.message ?? String(e); });
  }

  function pick(url) {
    setChoice(url);
    showStart = false;
    open(url); // always: picking the custom slot again means its file was just replaced
  }

  // toggling a seed rewrites the stage of a handful of records in place: re-copy so everything re-derives
  $effect(() => {
    const keys = ui.seeds;
    if (dsRaw && applySeeds(dsRaw, keys)) ds = { ...dsRaw };
  });

  $effect(() => {
    void [ui.cls, ui.stage, ui.mode, ui.excludedMods, ui.slots, ui.requireSet, ui.unknownStage, ui.conds, ui.seeds, ui.uncertain, ui.reforge, ui.source, ui.owned, ui.pinned, ui.excluded, ui.samples, ui.calibrate, ui.query, ui.browse, ui.target, ui.targets, ui.playstyle, ui.sound];
    persist();
  });

  startSound();
  $effect(() => setEnabled(ui.sound));

  const excluded = $derived(new Set(ui.excludedMods));
  const conds = $derived(new Set(ui.conds));
  const calibration = $derived(ds && ui.samples.length ? fitCalibration(ui.samples, ds, { conds, uncertain: ui.uncertain }) : null);
  const statCtx = $derived({ conds, uncertain: ui.uncertain, calibration: ui.calibrate && calibration?.sampleCount ? calibration : null, aliases: ds?.aliases ?? {}, ds, stage: ui.stage, playstyle: ui.playstyle, target: ui.target, targets: ui.targets });
  // trying on a runner-up armor set: not persisted, and dropped when the class or stage moves
  let armorPick = $state(null);
  $effect(() => { void [ui.cls, ui.stage, ui.source]; armorPick = null; });
  // Scored pieces and picked reforges survive a stage or class change: the solver keys them on what
  // they actually depend on (item, class, progression), so only a change to the scoring context
  // itself has to drop them. Reforging alone is ~90% of a solve, and it is stage-independent.
  const solveCache = $derived.by(() => {
    // `calibration`, not `statCtx`: statCtx is rebuilt on every stage change, which would empty
    // the cache exactly when it is worth most
    void [ui.reforge, ui.owned, ui.conds, ui.uncertain, ui.playstyle, ui.target, ui.targets, ui.seeds, ui.calibrate, calibration];
    return { piece: new Map(), acc: new Map(), prefix: new Map() };
  });
  const opts = $derived({
    armorPick, cache: solveCache,
    cls: ui.cls, stage: ui.stage, excludedMods: excluded, slots: ui.slots, requireSet: ui.requireSet, unknownStage: ui.unknownStage,
    conds, uncertain: ui.uncertain, reforge: ui.reforge, owned: ui.owned, source: ui.source,
    pinned: new Set(ui.pinned), excluded: new Set(ui.excluded), calibration: statCtx.calibration, playstyle: ui.playstyle, target: ui.target, targets: ui.targets,
  });
  const loadout = $derived(ds && ui.mode !== 'timeline' ? solveLoadout(ds, opts) : null);

  // "All stages" is seconds of CPU: solved in a worker so the page never freezes, with progress
  let timeline = $state.raw(null); // rows of solved loadouts full of dataset items: not proxy material either
  let solving = $state(null); // { done, total } while the worker is working
  let worker = null;
  let solveToken = 0;
  function timelineWorker() {
    if (worker) return worker;
    worker = new Worker(new URL('./lib/timeline.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.token !== solveToken) return; // an answer to a question we no longer ask
      if (data.rows) { timeline = unpackTimeline(dsRaw, data.rows); solving = null; }
      else if (data.error) { solving = null; timeline = solveTimeline(dsRaw, opts); }
      else solving = { done: data.done, total: data.total };
    };
    worker.onerror = () => { solving = null; timeline = solveTimeline(dsRaw, opts); }; // no worker: solve here
    return worker;
  }
  $effect(() => {
    const o = opts;
    const seeds = [...ui.seeds];
    if (!ds || ui.mode !== 'timeline') { timeline = null; solving = null; return; }
    const token = ++solveToken;
    timeline = null;
    solving = { done: 0, total: ds.stages.length };
    // postMessage cannot clone Svelte's state proxies, so the payload is built out of plain values
    timelineWorker().postMessage({
      token,
      seeds,
      dsUrl,
      opts: {
        cls: o.cls, slots: o.slots, requireSet: o.requireSet, unknownStage: o.unknownStage,
        uncertain: o.uncertain, reforge: o.reforge, source: o.source,
        excludedMods: [...o.excludedMods], conds: [...o.conds], pinned: [...o.pinned], excluded: [...o.excluded],
        owned: $state.snapshot(o.owned),
        calibration: o.calibration ? { factors: o.calibration.factors } : null,
        playstyle: $state.snapshot(o.playstyle ?? {}),
        target: o.target ?? null,
      },
    });
  });
  const selectedItem = $derived(ds && ui.selected ? ds.byId.get(ui.selected) : null);
  // what the item table / card evaluate weapons with: the solved loadout decides max stealth, and
  // the class damage and crit it carries are what the weapon is actually swung with
  const viewCtx = $derived({ ...statCtx, stealthMax: loadout?.stealthMax, loadout: loadout?.bonus });

  function select(id) {
    ui.selected = id;
  }

  if (chosen) open(chosen); // last: `open` touches the worker and timeline state declared above
</script>

<div class="lab-bg" class:start={showStart} aria-hidden="true">
  <div class="blob-a"></div>
  <div class="blob-b"></div>
  <div class="blob-c"></div>
  <div class="shafts"></div>
  <div class="grain"></div>
</div>

<div class="mx-auto flex min-h-screen max-w-[1680px] flex-col">
  <Header ds={showStart ? null : ds} onstart={() => (showStart = true)} />

  {#if showStart}
    <StartPage current={dsUrl} onpick={pick} oncancel={ds ? () => (showStart = false) : null} />
  {:else if error}
    <div class="lab-panel m-5 border-bad/40 bg-bad-soft p-4 text-bad">
      <strong>Could not load the dataset.</strong> {error}.
      <button type="button" class="lab-btn ml-2" onclick={() => (showStart = true)}>Pick another dataset</button>
    </div>
  {:else if !ds}
    <div class="m-4 p-8 text-center text-dim">Loading dataset…</div>
  {:else}
    <Controls {ds} {calibration} />
    {#if ui.panel === 'gear'}<GearPanel {ds} onselect={select} />{/if}
    {#if ui.panel === 'calibrate'}<CalibrationPanel {ds} {calibration} onselect={select} />{/if}

    <main class="flex flex-col gap-4 px-5 pb-8">
      {#if ui.mode === 'loadout'}
        <LoadoutPanel {ds} {loadout} onselect={select} onarmor={(id) => (armorPick = id)} />
      {:else if ui.mode === 'timeline'}
        {#if timeline}
          <Timeline {ds} {timeline} onselect={select} />
        {:else if solving}
          <div class="lab-panel p-6 text-center text-dim">
            Solving for every gamestage… <span class="num text-ink">{solving.done}</span>/{solving.total}
            <div class="mx-auto mt-2 h-1 w-64 overflow-hidden rounded bg-panel2">
              <div class="h-full bg-green transition-[width]" style="width:{Math.round((solving.done / solving.total) * 100)}%"></div>
            </div>
          </div>
        {/if}
      {:else if ui.mode === 'items'}
        <ItemBrowser {ds} statCtx={viewCtx} onselect={select} />
      {/if}
    </main>

    {#if selectedItem}
      <ItemCard {ds} item={selectedItem} statCtx={viewCtx} onclose={() => (ui.selected = null)} onselect={select} />
    {/if}

    <Footer {ds} />
  {/if}
</div>
