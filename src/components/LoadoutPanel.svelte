<script>
  import { CLASS_LABELS, accentOf } from '../lib/dataset.js';
  import ScoreParts from './ScoreParts.svelte';
  import WikiIcon from './WikiIcon.svelte';
  import Info from './Info.svelte';
  import { ui } from '../lib/state.svelte.js';
  import { matches } from '../lib/traits.js';
  import TraitFilter from './TraitFilter.svelte';

  let { ds, loadout, onselect } = $props();
  let tab = $state('accessories'); // 'accessories' | 'wings' | 'boots'
  // per-section filters: free text and the traits picked from the dropdown
  let armorQ = $state(''); let armorT = $state([]);
  let weaponQ = $state(''); let weaponT = $state([]);
  let accQ = $state(''); let accT = $state([]);
  const armorShown = $derived(loadout.armorAlternatives.filter((s) => matches(s, armorQ, armorT)));
  const weaponsShown = $derived(loadout.weapons.filter((w) => matches(w, weaponQ, weaponT)));
  const maxDps = $derived(Math.max(1, ...loadout.weapons.map((w) => w.value)));
  // every scoring accessory, ranked: the solver's picks first (one per exclusive group), then the rest
  const rankedAcc = $derived([...loadout.accessories, ...loadout.accessoryAlternatives]);
  const tabList = $derived(tab === 'wings' ? loadout.wings : tab === 'boots' ? loadout.boots : rankedAcc);
  const shown = $derived(tabList.filter((a) => matches(a, accQ, accT)));
  const maxAcc = $derived(Math.max(1, ...shown.map((a) => a.score)));
  const accent = $derived(accentOf(loadout.cls));
  const fmt = (v) => (v >= 1000 ? Math.round(v).toLocaleString() : Math.round(v * 10) / 10);
  const modName = (it) => (it.mod === 'v' ? 'Terraria' : ds.modById.get(it.mod)?.name ?? it.mod);

  // reforges: off, the best prefix per item, or one named prefix (items that cannot roll it keep
  // their best). Grouped in the picker the way the game rolls them.
  const PREFIX_GROUPS = [
    ['accessory', 'Accessories'], ['weapon', 'Any weapon'], ['melee', 'Melee'], ['ranged', 'Ranged'], ['magic', 'Magic'],
  ];
  const prefixGroups = $derived(PREFIX_GROUPS
    .map(([cat, label]) => [label, (ds.prefixes ?? []).filter((p) => p.category === cat).sort((a, b) => a.name.localeCompare(b.name))])
    .filter(([, list]) => list.length));
  let pick = $state(ui.reforge === 'none' ? 'best' : ui.reforge); // what the toggle turns back on
</script>

{#snippet tags(p)}
  {#if p.owned}<span class="lab-tag green ml-1">yours</span>{/if}
  {#if p.pinned}<span class="lab-tag info ml-1">pinned</span>{/if}
  {#if p.stealth}<span class="lab-tag plum ml-1" title="boosts stealth strikes">stealth</span>{/if}
  {#if p.item.changes?.length}<span class="lab-tag warn ml-1" title="another mod rebalances this item">rebalanced</span>{/if}
{/snippet}

{#snippet empty(what)}
  <p class="px-4 py-8 text-center text-[12.5px] text-dim">No {what}{loadout.source === 'owned' ? ' among your gear' : ' at this stage'}.</p>
{/snippet}

<section class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]" style="--accent:{accent}">
  <!-- armor -->
  <div class="lab-panel overflow-hidden">
    <header class="lab-head">
      <h2>Armor</h2>
      <TraitFilter entries={loadout.armorAlternatives} bind:query={armorQ} bind:selected={armorT} placeholder="Filter runner-up sets…" />
      {#if loadout.armor}
        <span class="lab-meta">
          <span class="lab-tag" class:green={loadout.armor.isSet}>{loadout.armor.isSet ? 'full set' : 'mixed'}</span>
          <span><span class="num font-semibold text-ink">{loadout.armor.defense}</span> defense</span>
          <span title="sum of the labelled parts below">score <span class="num font-semibold" style="color:{accent}">{loadout.armor.score}</span></span>
        </span>
      {/if}
    </header>
    {#if !loadout.armor}
      {@render empty('armor')}
    {:else}
      <table class="lab-table">
        <tbody>
          {#each ['head', 'body', 'legs'] as slot}
            {@const p = loadout.armor[slot]}
            <tr class="row" onclick={() => onselect(p.item.id)}>
              <td class="w-12 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-dim">{slot}</td>
              <td>
                <div class="flex items-center gap-2">
                  <WikiIcon item={p.item} />
                  <div class="min-w-0">
                    <div class="font-medium text-ink">{p.item.name}{@render tags(p)}</div>
                    <div class="text-[11.5px] text-dim">{modName(p.item)} · {p.item.stageLabel}</div>
                  </div>
                </div>
              </td>
              <td class="num w-14 whitespace-nowrap text-right" title="defense">{p.item.defense ?? 0}<span class="ml-0.5 text-[10px] text-dim">def</span></td>
              <td class="w-[44%]"><ScoreParts parts={p.parts} score={p.score} max={3} /></td>
            </tr>
          {/each}
          {#if loadout.armor.isSet}
            <tr class="bg-green-soft/40">
              <td colspan="2" class="align-middle">
                <span class="lab-tag green mr-1.5">set bonus</span>
                <span class="whitespace-pre-line text-[12.5px] text-ink2">{loadout.armor.head.item.setBonus || 'See effects'}</span>
              </td>
              <td colspan="2"><ScoreParts parts={loadout.armor.bonus.parts} score={loadout.armor.bonus.score} max={3} /></td>
            </tr>
          {/if}
        </tbody>
      </table>
      {#if loadout.armorAlternatives.length}
        <div class="px-4 py-2.5">
          <div class="lab-rule start mb-1.5">Runner-up sets{#if armorShown.length !== loadout.armorAlternatives.length} <span class="num text-dim">{armorShown.length} of {loadout.armorAlternatives.length}</span>{/if}</div>
          {#if !armorShown.length}<p class="m-0 text-[12px] text-dim">No runner-up set matches the filter.</p>{/if}
          <div class="flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
            {#each armorShown as s}
              <button class="cursor-pointer text-ink2 transition-colors hover:text-green" onclick={() => onselect(s.head.item.id)}>
                {s.head.item.name.replace(/ (Helmet|Headgear|Mask|Hood|Hat|Helm|Visage|Headpiece|Crown|Cowl|Head)$/i, '')}
                <span class="num text-dim">{s.score}</span>
              </button>
            {/each}
          </div>
        </div>
      {/if}
    {/if}
  </div>

  <!-- weapons -->
  <div class="lab-panel overflow-hidden">
    <header class="lab-head">
      <h2>{CLASS_LABELS[loadout.cls]} weapons</h2>
      <TraitFilter entries={loadout.weapons} bind:query={weaponQ} bind:selected={weaponT} placeholder="Filter weapons…" />
      <span class="lab-meta">
        <span>{#if weaponsShown.length !== loadout.weapons.length}<span class="num font-semibold text-ink">{weaponsShown.length}</span> of {/if}top <span class="num font-semibold text-ink">{loadout.weapons.length}</span> of <span class="num font-semibold text-ink">{loadout.weaponCount}</span> {loadout.source === 'owned' ? 'owned' : 'obtainable'}</span>
      </span>
    </header>
    {#if !loadout.weapons.length}
      {@render empty(`${loadout.cls} weapons`)}
    {:else if !weaponsShown.length}
      <p class="px-4 py-8 text-center text-[12.5px] text-dim">No weapon matches the filter.</p>
    {:else}
      <div class="max-h-[27rem] overflow-y-auto">
      <table class="lab-table">
        <thead class="sticky top-0 z-10 bg-panel">
          <tr>
            <th>Weapon</th>
            <th class="text-right" title="damage after every modifier">Dmg</th>
            <th class="text-right" title="ticks per use">Use</th>
            <th class="text-right">Crit chance</th>
            <th class="w-[34%]">
              <span class="inline-flex items-center gap-1">
                {loadout.weapons[0].kind === 'dps' ? 'Real DPS' : 'Damage per hit'}
                <Info label="How Real DPS is computed" w={420}>
                  <p>
                    damage (+ best ammo) × rate × crit × projectiles per use × accuracy (spread, velocity, gravity, homing)
                    × pierce × wall pierce × debuffs × mana sustain.
                  </p>
                  <p>Applied on top of balancing overlays, runtime modifiers{loadout.weapons.some((w) => w.prefix) ? ', reforges' : ''} and calibration.</p>
                  <p>
                    Rogue weapons are graded as <em>stealth</em> (one strike per 5&nbsp;s{loadout.stealthMax ? `, max stealth ${Math.round(loadout.stealthMax * 100)} from the armor` : ''})
                    or <em>spam</em>, whichever comes out higher.
                  </p>
                  <p class="text-dim">Open any weapon to see the arithmetic line by line.</p>
                </Info>
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {#each weaponsShown as w}
            {@const i = loadout.weapons.indexOf(w)}
            <tr class="row" onclick={() => onselect(w.item.id)}>
              <td>
                <div class="flex items-center gap-2">
                  <span class="num w-4 shrink-0 text-right text-[11px] text-dim">{i + 1}</span>
                  <WikiIcon item={w.item} />
                  <div class="min-w-0">
                    <div class="font-medium">{w.item.name}{@render tags(w)}{#if w.mode === 'stealth'}<span class="lab-tag plum ml-1" title="graded by stealth strikes: {Math.round(w.stealth)}/s vs spam {Math.round(w.spam)}/s">stealth</span>{:else if w.mode === 'spam'}<span class="lab-tag ml-1" title="graded by normal attacks: {Math.round(w.spam)}/s vs stealth {Math.round(w.stealth)}/s">spam</span>{/if}</div>
                    <div class="text-[11.5px] text-dim">{modName(w.item)} · {w.item.stageLabel}{w.prefix ? ` · ${w.prefix.name}` : ''}</div>
                  </div>
                </div>
              </td>
              <td class="num text-right">{w.eff.damage}</td>
              <td class="num text-right text-dim">{Math.round(w.item.cls === 'melee' ? w.eff.useAnimation : w.eff.useTime) || '–'}</td>
              <td class="num text-right text-dim">{w.eff.crit}%</td>
              <td>
                <div class="flex items-center gap-2">
                  <div class="bar flex-1"><i style="width:{Math.round((w.value / maxDps) * 100)}%"></i></div>
                  <span class="num w-16 shrink-0 text-right font-semibold">{fmt(w.value)}</span>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      </div>
    {/if}
  </div>

  <!-- accessories -->
  <div class="lab-panel overflow-hidden xl:col-span-2">
    <header class="lab-head">
      <h2>
        <button class="lab-chip" aria-pressed={tab === 'accessories'} onclick={() => (tab = 'accessories')}>Accessories <span class="num opacity-70">{loadout.accessoryCount}</span></button>
        <button class="lab-chip ml-1" aria-pressed={tab === 'wings'} onclick={() => (tab = 'wings')}>Wings <span class="num opacity-70">{loadout.wings.length}</span></button>
        <button class="lab-chip ml-1" aria-pressed={tab === 'boots'} onclick={() => (tab = 'boots')}>Boots <span class="num opacity-70">{loadout.boots.length}</span></button>
      </h2>
      <TraitFilter entries={tabList} bind:query={accQ} bind:selected={accT} placeholder="Filter by name, text or trait…" />
      <span class="lab-meta">
        <label class="flex items-center gap-1.5" title="score every item as if it already carries this reforge">
          <input type="checkbox" checked={ui.reforge !== 'none'} onchange={(e) => (ui.reforge = e.currentTarget.checked ? pick : 'none')} />
          reforged
        </label>
        <select class="lab-input w-auto max-w-[150px] py-0.5" disabled={ui.reforge === 'none'} value={ui.reforge === 'none' ? pick : ui.reforge}
                onchange={(e) => { pick = e.currentTarget.value; ui.reforge = pick; }}>
          <option value="best">assume best</option>
          {#each prefixGroups as [label, list]}
            <optgroup {label}>
              {#each list as p}<option value={p.id}>{p.name}</option>{/each}
            </optgroup>
          {/each}
        </select>
        <Info label="Reforges" w={340}>
          <p><em>Assume best</em> gives every item the prefix that scores highest for it. Pick a named one and every item that can roll it gets it — items that cannot (the wrong class, or an accessory prefix on a weapon) keep their best.</p>
          <p>Gear you marked as owned always keeps the prefix you gave it, whatever this says.</p>
        </Info>
        {#if tab === 'wings'}
          <span>every pair obtainable here, ranked — wings never compete for an accessory slot</span>
        {:else if tab === 'boots'}
          <span>every pair obtainable here, ranked — boots never compete for an accessory slot</span>
        {:else}
          <span>first <span class="num font-semibold text-ink">{loadout.accessories.length}</span> equip, the rest ranked</span>
          <span class="flex items-center gap-1">
            one per group
            <Info label="Exclusive groups" w={340}>
              <p>Boots, shields and dashes don't stack, so the solver equips only the best item from each of those groups; the others follow in the ranking.</p>
              <p>Wings and boots have their own tabs. The group is named under each accessory that belongs to one.</p>
              <p>Options → <em>Accessory rows</em> sets how many rows show before the list scrolls.</p>
            </Info>
          </span>
        {/if}
      </span>
    </header>
    {#if !tabList.length}
      {@render empty(tab === 'wings' ? 'wings' : tab === 'boots' ? 'boots' : 'useful accessories')}
    {:else if !shown.length}
      <p class="px-4 py-8 text-center text-[12.5px] text-dim">Nothing here matches the filter.</p>
    {:else}
      <div class="overflow-y-auto" style="max-height:{ui.accRows * 7.75}rem">
      <div class="grid gap-px bg-line sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {#each shown as a}
          {@const i = tabList.indexOf(a)}
          <button class="lab-cell pb-4" onclick={() => onselect(a.item.id)}>
            <div class="flex items-start gap-2">
              <WikiIcon item={a.item} />
              <div class="min-w-0 flex-1">
                <div class="flex items-baseline justify-between gap-2">
                  <span class="font-medium"><span class="num mr-1.5 text-[11px] text-dim">{i + 1}</span>{a.item.name}{@render tags(a)}{#if tab === 'accessories' && i < loadout.accessories.length}<span class="lab-tag solid ml-1" title="one of the {loadout.accessories.length} the solver equips">equip</span>{/if}</span>
                  <span class="num text-[12px] font-semibold" style="color:{accent}">{a.score}</span>
                </div>
                <div class="mb-1.5 text-[11px] text-dim">{modName(a.item)} · {a.item.stageLabel}{a.group && tab === 'accessories' ? ` · ${a.group}` : ''}{a.prefix ? ` · ${a.prefix.name}` : ''}</div>
                <ScoreParts parts={a.parts} max={4} />
              </div>
            </div>
            <!-- how it ranks against the best of the list -->
            <div class="bar absolute inset-x-0 bottom-0 h-[2px] bg-transparent shadow-none"><i style="width:{Math.round((a.score / maxAcc) * 100)}%" class="opacity-35 shadow-none"></i></div>
          </button>
        {/each}
      </div>
      </div>
    {/if}
  </div>
</section>
