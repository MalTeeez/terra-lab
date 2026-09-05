<script>
  import { CLASS_LABELS, ERAS, accentOf, eraOf } from '../lib/dataset.js';
  import { factorOf } from '../lib/factors.js';
  import { ui } from '../lib/state.svelte.js';
  import WikiIcon from './WikiIcon.svelte';
  import BossIcon from './BossIcon.svelte';
  import { fmtNum } from '../lib/fmt.js';

  let { ds, timeline, onselect } = $props();
  let onlyChanges = $state(true);
  const rows = $derived(onlyChanges ? timeline.filter((r) => r.changes.size) : timeline);
  // Group visible rows by era so the table breaks into Pre-Hardmode / Hardmode / … bands
  const groups = $derived(ERAS.map((era) => ({ era, rows: rows.filter((r) => eraOf(r.stage) === era) })).filter((g) => g.rows.length));
  const accent = $derived(accentOf(timeline[0]?.loadout.cls));
  const short = (name) => name.replace(/ (Helmet|Headgear|Mask|Hood|Hat|Helm|Visage|Headpiece|Crown|Cowl|Head|Breastplate|Chestplate|Plate Mail|Leggings|Greaves|Pants|Cuisses)$/i, '');
  // A glyph per era, indexed by ERAS order — inline SVG so it renders the same everywhere and
  // ships with the component (no wiki fetch, no font). ponytail: hand-tuned paths, swap for
  // real sprites if the miner ever surfaces era emblems.
  const ERA_ICONS = [
    'M8 1 L14 13 L2 13 Z', // Pre-HM: leaf/tree
    'M8 1 C 4 5, 4 9, 8 14 C 12 9, 12 5, 8 1 Z', // Hardmode: flame
    'M8 8 m-3 -4 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0 M8 8 m-3 4 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0 M8 8 m-7 0 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0 M8 8 m1 0 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0', // Plantera: four petals
    'M8 8 m-6 0 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0 M10 8 m-4 0 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0', // Moon Lord: crescent (fill-rule evenodd)
    'M8 1 L10 6 L15 6.5 L11 10 L12 15 L8 12 L4 15 L5 10 L1 6.5 L6 6 Z', // Endgame: star
  ];
  // Bucket an accessory into Movement / Defensive / Offensive using its known slot group first,
  // then the biggest factor in its scored parts. ponytail: coarse — a Warrior Emblem lands in
  // Offensive, a Charm of Myths in Defensive; nothing lands in "utility" for the timeline row.
  const FACTOR_BUCKET = { mobility: 'movement', survival: 'defensive', damage: 'offensive' };
  function bucketOf(a) {
    if (a.group === 'wings' || a.group === 'boots' || a.group === 'dash' || a.group === 'shield') return 'movement';
    const sums = { movement: 0, defensive: 0, offensive: 0 };
    for (const p of a.parts ?? []) {
      const b = FACTOR_BUCKET[factorOf(p, false)];
      if (b) sums[b] += Math.abs(p.value ?? 0);
    }
    let best = 'defensive', top = -1;
    for (const k of ['movement', 'defensive', 'offensive']) if (sums[k] > top) { top = sums[k]; best = k; }
    return best;
  }
  const BUCKETS = [
    { key: 'movement', label: 'Movement', color: 'var(--color-teal)' },
    { key: 'defensive', label: 'Defensive', color: 'var(--color-info)' },
    { key: 'offensive', label: 'Offensive', color: 'var(--color-green-deep)' },
  ];
  function bucketed(lo) {
    const all = [...(lo.wings ?? []).slice(0, 1), ...(lo.boots ?? []).slice(0, 1), ...lo.accessories];
    return BUCKETS.map((b) => ({ ...b, list: all.filter((a) => bucketOf(a) === b.key) })).filter((b) => b.list.length);
  }
</script>

<section class="lab-panel" style="--accent:{accent}">
  <header class="lab-head">
    <h2>{CLASS_LABELS[timeline[0]?.loadout.cls]} through the game</h2>
    <span class="lab-meta">
      <label class="flex cursor-pointer items-center gap-1.5"><input type="checkbox" bind:checked={onlyChanges} /> only stages where something changes</label>
      <span><span class="num font-semibold text-ink">{rows.length}</span> of {timeline.length} stages</span>
    </span>
  </header>
  <table class="lab-table w-full min-w-[940px]">
    <thead>
      <tr><th class="sticky top-0 z-30 w-56">After</th><th class="sticky top-0 z-30 w-52">Armor</th><th class="sticky top-0 z-30 w-80">Best weapon</th><th class="sticky top-0 z-30 w-[420px]">Accessories</th></tr>
    </thead>
    {#each groups as g, gi}
      <tbody>
        <tr>
          <th colspan="4" class="sticky top-8 z-20 border-y border-line bg-panel2 px-3.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide" style="color:{g.era.color}">
            <svg viewBox="0 0 16 16" fill-rule="evenodd" class="mr-2 inline-block h-4 w-4 align-[-3px]" style="fill:{g.era.color}"><path d={ERA_ICONS[gi] ?? ERA_ICONS[0]} /></svg>{g.era.label}
            <span class="ml-2 text-dim">·</span> <span class="num text-dim">{g.rows.length}</span> <span class="text-dim">{g.rows.length === 1 ? 'stage' : 'stages'}</span>
          </th>
        </tr>
            {#each g.rows as r}
              {@const lo = r.loadout}
              {@const isCurrent = r.stage.index === ui.stage}
              {@const ws = lo.weaponSingle ?? lo.weapons[0]}
              {@const wm = lo.weaponMulti ?? lo.weapons[0]}
              {@const sameWeapon = ws?.item?.id === wm?.item?.id}
          <tr class="cursor-default align-top transition-colors hover:bg-panel2" class:bg-green-soft={isCurrent}>
            <td class="relative pl-3.5" class:sticky={isCurrent} class:top-[68px]={isCurrent} class:z-10={isCurrent} class:bg-green-soft={isCurrent}>
              <span class="absolute inset-y-0 left-0 w-[3px]" style="background:{g.era.color}"></span>
              <div class="flex items-start gap-1.5">
                <BossIcon {ds} stage={r.stage.index} size={32} />
                <div>
                  <button class="cursor-pointer text-left font-medium hover:text-green" onclick={() => { ui.stage = r.stage.index; ui.mode = 'loadout'; }} title="Open this stage in the loadout view">{r.stage.label}</button>
                  <div class="text-[11px] text-dim">
                    <span class="num">#{r.stage.index}</span>{r.stage.mod !== 'v' ? ` · ${ds.modById.get(r.stage.mod)?.name ?? r.stage.mod}` : ''}
                  </div>
                </div>
              </div>
            </td>
            <td class:bg-green-soft={r.changes.has('armor') || isCurrent} class:sticky={isCurrent} class:top-[68px]={isCurrent} class:z-10={isCurrent}>
              {#if lo.armor}
                <button class="flex cursor-pointer items-center gap-1.5 text-left hover:text-green" onclick={() => onselect(lo.armor.head.item.id)}>
                      {#if lo.armor.isSet}
                        <WikiIcon item={lo.armor.head.item} size={32} />
                      {:else}
                        <span class="flex shrink-0 items-center -space-x-1.5">
                          <WikiIcon item={lo.armor.head.item} size={26} />
                          <WikiIcon item={lo.armor.body.item} size={26} />
                          <WikiIcon item={lo.armor.legs.item} size={26} />
                        </span>
                      {/if}
                  <span>
                    <div class="font-medium">{lo.armor.isSet ? short(lo.armor.head.item.name) : `${short(lo.armor.head.item.name)} / ${short(lo.armor.body.item.name)} / ${short(lo.armor.legs.item.name)}`}</div>
                    <div class="text-[11px] text-dim">{lo.armor.isSet ? 'set' : 'mixed'} · <span class="num">{lo.armor.defense}</span> def · score <span class="num">{lo.armor.score}</span></div>
                  </span>
                </button>
              {:else}<span class="text-dim">–</span>{/if}
            </td>
            <td class:bg-green-soft={r.changes.has('weapon') || isCurrent} class:sticky={isCurrent} class:top-[68px]={isCurrent} class:z-10={isCurrent}>
              {#if ws || wm}
                <div class="flex flex-col gap-1">
                  {#each (sameWeapon ? [{ p: ws, tag: 'single & multi' }] : [{ p: ws, tag: 'single' }, { p: wm, tag: 'multi' }]) as pick}
                    {#if pick.p}
                      <button class="flex cursor-pointer items-start gap-1.5 text-left hover:text-green" onclick={() => onselect(pick.p.item.id)} title="Best against {pick.tag} targets at this stage">
                        <WikiIcon item={pick.p.item} size={28} />
                        <span>
                          <div class="font-medium leading-tight"><span class="mr-1 text-[9.5px] font-semibold uppercase tracking-wide text-dim">{pick.tag}</span>{pick.p.item.name}</div>
                          <div class="text-[11px] text-dim"><span class="num">{fmtNum(pick.p.value)}</span> {pick.p.kind ?? 'dps'}</div>
                        </span>
                      </button>
                    {/if}
                  {/each}
                </div>
              {:else}<span class="text-dim">–</span>{/if}
            </td>
            <td class:bg-green-soft={r.changes.has('accessories') || isCurrent} class:sticky={isCurrent} class:top-[68px]={isCurrent} class:z-10={isCurrent}>
              <div class="flex flex-col gap-1">
                {#each bucketed(lo) as b}
                  <div class="flex flex-wrap items-center gap-1">
                    <span class="text-[10px] font-semibold uppercase tracking-wide" style="color:{b.color}" title="Accessories that mainly contribute {b.label.toLowerCase()}">{b.label}</span>
                    {#each b.list as a}
                      <button class="lab-chip flex items-center gap-1 py-0 pl-0.5 text-[11.5px] font-normal" title={a.group ?? ''} onclick={() => onselect(a.item.id)}><WikiIcon item={a.item} size={16} />{a.item.name} <span class="num text-[10.5px] text-dim">{a.score}</span></button>
                    {/each}
                  </div>
                {/each}
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
    {/each}
  </table>
  <p class="border-t border-line px-4 py-2 text-[11.5px] text-dim">Green cells are the stages where that part of the loadout changes. Click a stage name to jump the loadout view there. The row for the stage you have selected sticks under the header.</p>
</section>
