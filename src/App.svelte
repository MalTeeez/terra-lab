<script>
  import Header from './components/Header.svelte';
  import Controls from './components/Controls.svelte';
  import LoadoutPanel from './components/LoadoutPanel.svelte';
  import Timeline from './components/Timeline.svelte';
  import ItemTable from './components/ItemTable.svelte';
  import ItemCard from './components/ItemCard.svelte';
  import GearPanel from './components/GearPanel.svelte';
  import CalibrationPanel from './components/CalibrationPanel.svelte';
  import Footer from './components/Footer.svelte';
  import { fitCalibration } from './lib/calibration.js';
  import { loadDataset } from './lib/dataset.js';
  import { solveLoadout, solveTimeline } from './lib/solver.js';
  import { persist, ui } from './lib/state.svelte.js';

  let ds = $state(null);
  let error = $state(null);

  // Deep links: ?cls=summon&stage=35&mode=timeline&item=CalamityMod:Murasama
  function applyUrl(d) {
    const q = new URLSearchParams(location.search);
    if (q.has('cls')) ui.cls = q.get('cls');
    if (q.has('stage')) {
      const s = q.get('stage');
      const idx = /^\d+$/.test(s) ? Number(s) : d.stages.findIndex((x) => x.key.toLowerCase() === s.toLowerCase() || x.label.toLowerCase() === s.toLowerCase());
      if (idx >= 0) ui.stage = idx;
    }
    if (q.has('mode')) ui.mode = q.get('mode');
    if (q.has('item') && d.byId.has(q.get('item'))) ui.selected = q.get('item');
    if (q.has('panel')) ui.panel = q.get('panel');
  }

  loadDataset().then((d) => {
    ds = d;
    applyUrl(d);
    if (ui.stage >= d.stages.length) ui.stage = d.stages.length - 1;
    if (!d.classList.includes(ui.cls)) ui.cls = d.classList[0] ?? 'melee';
    if (!['loadout', 'timeline', 'items'].includes(ui.mode)) ui.mode = 'loadout';
    ui.conds = ui.conds.filter((c) => d.conditions.includes(c));
  }).catch((e) => { error = e.message; });

  $effect(() => {
    void [ui.cls, ui.stage, ui.mode, ui.excludedMods, ui.slots, ui.requireSet, ui.unknownStage, ui.conds, ui.uncertain, ui.reforge, ui.source, ui.owned, ui.pinned, ui.excluded, ui.samples, ui.calibrate, ui.query, ui.slotFilter, ui.classFilter, ui.modFilter, ui.stageFilter, ui.sortK, ui.sortDir];
    persist();
  });

  const excluded = $derived(new Set(ui.excludedMods));
  const conds = $derived(new Set(ui.conds));
  const calibration = $derived(ds && ui.samples.length ? fitCalibration(ui.samples, ds, { conds, uncertain: ui.uncertain }) : null);
  const statCtx = $derived({ conds, uncertain: ui.uncertain, calibration: ui.calibrate && calibration?.sampleCount ? calibration : null, aliases: ds?.aliases ?? {}, ds, stage: ui.stage });
  const opts = $derived({
    cls: ui.cls, stage: ui.stage, excludedMods: excluded, slots: ui.slots, requireSet: ui.requireSet, unknownStage: ui.unknownStage,
    conds, uncertain: ui.uncertain, reforge: ui.reforge, owned: ui.owned, source: ui.source,
    pinned: new Set(ui.pinned), excluded: new Set(ui.excluded), calibration: statCtx.calibration,
  });
  const loadout = $derived(ds && ui.mode !== 'timeline' ? solveLoadout(ds, opts) : null);
  const timeline = $derived(ds && ui.mode === 'timeline' ? solveTimeline(ds, opts) : null);
  const selectedItem = $derived(ds && ui.selected ? ds.byId.get(ui.selected) : null);
  // what the item table / card evaluate weapons with: the loadout's armor decides max stealth
  const viewCtx = $derived({ ...statCtx, stealthMax: loadout?.stealthMax });

  function select(id) {
    ui.selected = id;
  }
</script>

<div class="mx-auto flex min-h-screen max-w-[1400px] flex-col">
  <Header {ds} />

  {#if error}
    <div class="m-4 border border-bad/40 bg-bad-soft p-4 text-bad">
      <strong>Could not load the dataset.</strong> {error}. Run <code class="num">bun run mine</code> to generate <code class="num">data/dataset.json</code>.
    </div>
  {:else if !ds}
    <div class="m-4 p-8 text-center text-dim">Loading dataset…</div>
  {:else}
    <Controls {ds} {calibration} />
    {#if ui.panel === 'gear'}<GearPanel {ds} onselect={select} />{/if}
    {#if ui.panel === 'calibrate'}<CalibrationPanel {ds} {calibration} onselect={select} />{/if}

    <main class="flex flex-col gap-4 px-4 pb-8">
      {#if ui.mode === 'loadout'}
        <LoadoutPanel {ds} {loadout} onselect={select} />
      {:else if ui.mode === 'timeline'}
        <Timeline {ds} {timeline} onselect={select} />
      {/if}
      <ItemTable {ds} statCtx={viewCtx} onselect={select} />
    </main>

    {#if selectedItem}
      <ItemCard {ds} item={selectedItem} statCtx={viewCtx} onclose={() => (ui.selected = null)} onselect={select} />
    {/if}

    <Footer {ds} />
  {/if}
</div>
