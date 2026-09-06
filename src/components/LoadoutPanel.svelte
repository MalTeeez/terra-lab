<script>
  import { CLASS_LABELS, accentOf } from '../lib/dataset.js';
  import ScoreParts from './ScoreParts.svelte';
  import WikiIcon from './WikiIcon.svelte';
  import BossIcon from './BossIcon.svelte';
  import Info from './Info.svelte';
  import { ui } from '../lib/state.svelte.js';
  import { SLOT_MODES } from '../lib/dps.js';
  import { MODE_TAG, matches } from '../lib/traits.js';
  const MODE_ORDER = Object.keys(MODE_TAG); // the order they are declared in reads best: the pair, then the three slots
  import { fmtFull, fmtNum } from '../lib/fmt.js';
  import TraitFilter from './TraitFilter.svelte';

  let { ds, loadout, onselect, onarmor } = $props();
  let tab = $state('accessories'); // 'accessories' | 'wings' | 'boots'
  // per-section filters: free text and the traits picked from the dropdown
  let armorQ = $state(''); let armorT = $state([]);
  let weaponQ = $state(''); let weaponT = $state([]); let weaponM = $state([]);
  let accQ = $state(''); let accT = $state([]);
  const armorShown = $derived(loadout.armorAlternatives.filter((s) => matches(s, armorQ, armorT)));
  // how much score trying on a runner-up set costs against the solver's own pick
  const armorDelta = $derived(loadout.armorPicked ? Math.round((loadout.armor.score - loadout.armorBestScore) * 10) / 10 : 0);
  const setName = (s) => s.head.item.name.replace(/ (Helmet|Headgear|Mask|Hood|Hat|Helm|Visage|Headpiece|Crown|Cowl|Head)$/i, '');
  // The grade chips. Rogue's spam and stealth are two ways to use one weapon and summon's whip,
  // minion and sentry are three slots worn at once, but either way the grade is the one cut worth
  // making without opening a menu — so it sits in the header rather than inside the trait list.
  // Counted over what the *other* filters leave, so picking one never empties the row it sits in.
  const modeCounts = $derived.by(() => {
    const m = new Map();
    // only the five grades `MODE_TAG` names: a weapon's `mode` also carries plain archetypes for
    // the classes that have no grade to choose, and those are not a cut anyone wants as a chip
    for (const w of loadout.weapons) if (MODE_TAG[w.mode] && matches(w, weaponQ, weaponT)) m.set(w.mode, (m.get(w.mode) ?? 0) + 1);
    return [...m].sort((a, b) => MODE_ORDER.indexOf(a[0]) - MODE_ORDER.indexOf(b[0]));
  });
  const toggleMode = (k) => (weaponM = weaponM.includes(k) ? weaponM.filter((x) => x !== k) : [...weaponM, k]);
  $effect(() => { void loadout.cls; weaponM = []; }); // another class grades on different modes
  const weaponsShown = $derived(loadout.weapons.filter((w) => matches(w, weaponQ, weaponT) && (!weaponM.length || weaponM.includes(w.mode))));
  const maxDps = $derived(Math.max(1, ...loadout.weapons.map((w) => w.value)));
  // every scoring accessory, ranked: the solver's picks first (one per exclusive group), then the rest
  const rankedAcc = $derived([...loadout.accessories, ...loadout.accessoryAlternatives]);
  const tabList = $derived(tab === 'wings' ? loadout.wings : tab === 'boots' ? loadout.boots : rankedAcc);
  const shown = $derived(tabList.filter((a) => matches(a, accQ, accT)));
  const maxAcc = $derived(Math.max(1, ...shown.map((a) => a.score)));
  const accent = $derived(accentOf(loadout.cls));
  const modName = (it) => (it.mod === 'v' ? 'Terraria' : ds.modById.get(it.mod)?.name ?? it.mod);
  // A summoner wears a whip *and* minions *and* a sentry, so they are listed by slot rather than in
  // one column, where the whips would simply out-DPS the
  // minions they are meant to be swung next to. Rogue's stealth/spam are two ways to use one weapon,
  // not two slots, so they stay in a single ranking.
  const weaponGroups = $derived.by(() => {
    const groups = [];
    for (const w of weaponsShown) {
      const g = SLOT_MODES.has(w.mode) ? w.mode : '';
      (groups.find((x) => x.mode === g) ?? groups[groups.push({ mode: g, list: [] }) - 1]).list.push(w);
    }
    return groups.length > 1 ? groups : [{ mode: '', list: weaponsShown }];
  });
  // ammo is its own pick: the weapons above are graded on the plain ammo of their kind, and these
  // are graded by handing the best gun of that kind each round in turn
  const ammoShown = $derived(loadout.ammo.filter((a) => matches({ item: a.item, parts: a.parts }, weaponQ, weaponT)));
  const maxAmmo = $derived(Math.max(1, ...loadout.ammo.map((a) => a.value)));

  // reforges: off, the best prefix per item, or one named prefix (items that cannot roll it keep
  // their best). Grouped in the picker the way the game rolls them.
  const PREFIX_GROUPS = [
    ['accessory', 'Accessories'], ['weapon', 'Any weapon'], ['melee', 'Melee'], ['ranged', 'Ranged'], ['magic', 'Magic'],
  ];
  const prefixGroups = $derived(PREFIX_GROUPS
    .map(([cat, label]) => [label, (ds.prefixes ?? []).filter((p) => p.category === cat).sort((a, b) => a.name.localeCompare(b.name))])
    .filter(([, list]) => list.length));
  let pick = $state(ui.reforge === 'none' ? 'best' : ui.reforge); // what the toggle turns back on

  // potions: the ones that do something in a fight, then a few utility ones to round the list out.
  // A potion with parts and no score left is a trade that does not pay (Purple Haze costs a rogue
  // more stealth strike damage than it gives back) — that is not a recommendation, so it is out.
  const potionsShown = $derived([
    ...loadout.potions.filter((p) => p.score > 0),
    ...loadout.potions.filter((p) => !p.parts.length).slice(0, 4),
  ].slice(0, 12));
  const fmtDuration = (s) => (s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`);
</script>

{#snippet tags(p)}
  {#if p.owned}<span class="lab-tag green ml-1">yours</span>{/if}
  {#if p.pinned}<span class="lab-tag info ml-1">pinned</span>{/if}
  <!-- gear only: on a weapon row `stealth` is its stealth-strike DPS, tagged by mode further down -->
  {#if p.stealth === true}<span class="lab-tag plum ml-1" title="This boosts stealth strikes">stealth</span>{/if}
  {#if p.item.changes?.length}<span class="lab-tag warn ml-1" title="Another mod rebalances this item">rebalanced</span>{/if}
{/snippet}

{#snippet empty(what)}
  <p class="px-4 py-8 text-center text-[12.5px] text-dim">No {what}{loadout.source === 'owned' ? ' among your gear' : ' at this stage'}.</p>
{/snippet}

<section class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]" style="--accent:{accent}">
  <!-- armor. Shared height with weapons so runner-ups fill exactly the room the weapons column
       takes, no dead space either way. Kept compact so the accessories row below stays visible. -->
  <div class="lab-panel flex flex-col overflow-hidden xl:h-[40rem]">
    <header class="lab-head">
      <h2>Armor</h2>
      <TraitFilter entries={loadout.armorAlternatives} bind:query={armorQ} bind:selected={armorT} placeholder="Filter runner-up sets…" />
      {#if loadout.armor}
        <span class="lab-meta">
          <span class="lab-tag" class:green={loadout.armor.isSet}>{loadout.armor.isSet ? 'full set' : 'mixed'}</span>
          <span><span class="num font-semibold text-ink">{loadout.armor.defense}</span> defense</span>
          <span title="The sum of the labelled parts below">score <span class="num font-semibold" style="color:{accent}">{loadout.armor.score}</span></span>
          {#if loadout.armorPicked}
            <span class="lab-tag warn" title="You are trying this set on. Everything else — the set bonus, max stealth, the weapon ranking — is solved as if you wear it.">trying on <span class="num">{armorDelta}</span></span>
            <button class="lab-chip" onclick={() => onarmor(null)}>back to the best set <span class="num opacity-70">{loadout.armorBestScore}</span></button>
          {/if}
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
              <td class="w-12 py-2.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-dim">{slot}</td>
              <td class="py-2.5">
                <div class="flex items-center gap-3">
                  <WikiIcon item={p.item} size={44} />
                  <div class="min-w-0">
                    <div class="font-medium text-ink">{p.item.name}{@render tags(p)}</div>
                    <div class="text-[11.5px] text-dim">{modName(p.item)} · <span class="inline-flex items-center gap-0.5 align-middle"><BossIcon {ds} stage={p.item.stage} size={14} />{p.item.stageLabel}</span></div>
                  </div>
                </div>
              </td>
              <td class="num w-14 whitespace-nowrap py-2.5 text-right" title="How much defense this piece gives">{p.item.defense ?? 0}<span class="ml-0.5 text-[10px] text-dim">def</span></td>
              <td class="w-[44%] py-2.5"><ScoreParts parts={p.parts} score={p.score} max={3} /></td>
            </tr>
          {/each}
          {#if loadout.armor.isSet}
            <tr class="bg-green-soft/40">
              <td colspan="4" class="align-middle">
                <div class="flex items-baseline gap-1.5">
                  <span class="lab-tag green shrink-0">set bonus</span>
                  <span class="min-w-0 flex-1 whitespace-pre-line text-[12.5px] text-ink2">{loadout.armor.head.item.setBonus || 'See effects'}</span>
                </div>
                <div class="mt-1.5"><ScoreParts parts={loadout.armor.bonus.parts} score={loadout.armor.bonus.score} max={4} /></div>
              </td>
            </tr>
          {/if}
        </tbody>
      </table>
      {#if loadout.armorAlternatives.length}
        <div class="flex min-h-0 flex-1 flex-col border-t border-line px-4 pb-3 pt-2.5">
          <div class="lab-rule start mb-2">{loadout.armorPicked ? 'Other sets' : 'Runner-up sets'}{#if armorShown.length !== loadout.armorAlternatives.length} <span class="num text-dim">{armorShown.length} of {loadout.armorAlternatives.length}</span>{/if}</div>
          {#if !armorShown.length}<p class="m-0 text-[12px] text-dim">No runner-up set matches the filter.</p>{/if}
          <div class="grid min-h-0 flex-1 auto-rows-min grid-cols-1 gap-px overflow-y-auto bg-line md:grid-cols-2">
            {#each armorShown as s}
              {@const on = loadout.armorPicked === s.head.item.id}
              {@const def = (s.head.item.defense ?? 0) + (s.body.item.defense ?? 0) + (s.legs.item.defense ?? 0)}
              <button
                class="lab-cell flex items-center gap-2.5 p-2"
                class:open={on}
                title={on ? 'Currently trying this set on' : 'Try this set on: the loadout is re-solved as if you wear it'}
                onclick={() => onarmor(on ? null : s.head.item.id)}
              >
                <div class="flex shrink-0 items-center gap-0.5 border border-line bg-panel2 p-0.5">
                  <WikiIcon item={s.head.item} size={26} />
                  <WikiIcon item={s.body.item} size={26} />
                  <WikiIcon item={s.legs.item} size={26} />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-baseline gap-1.5">
                    <span class="truncate text-[12.5px] font-medium text-ink">{setName(s)}</span>
                    {#if on}<span class="lab-tag warn shrink-0">trying on</span>{/if}
                  </div>
                  {#if s.head.item.setBonus}
                    <div class="truncate text-[11px] text-dim" title={s.head.item.setBonus}>{s.head.item.setBonus}</div>
                  {/if}
                </div>
                <div class="shrink-0 text-right leading-tight">
                  <div class="num text-[10.5px] text-dim">{def}<span class="ml-0.5">def</span></div>
                  <div class="num text-[13px] font-semibold" style="color:{accent}">{s.score}</div>
                </div>
              </button>
            {/each}
          </div>
        </div>
      {/if}
    {/if}
  </div>

  <!-- weapons. Same shared height as armor so nothing dangles at the bottom. -->
  <div class="lab-panel flex flex-col overflow-hidden xl:h-[40rem]">
    <header class="lab-head">
      <h2>{CLASS_LABELS[loadout.cls]} weapons</h2>
      {#if modeCounts.length > 1}
        <span class="inline-flex items-center gap-1 font-normal normal-case tracking-normal">
          {#each modeCounts as [k, n] (k)}
            <button type="button" class="lab-chip py-0.5 {weaponM.includes(k) ? MODE_TAG[k].color : ''}" aria-pressed={weaponM.includes(k)}
                    onclick={() => toggleMode(k)} title={MODE_TAG[k].tip}>{k} <span class="num {weaponM.includes(k) ? 'opacity-70' : 'text-dim'}">{n}</span></button>
          {/each}
        </span>
      {/if}
      <TraitFilter entries={loadout.weapons} bind:query={weaponQ} bind:selected={weaponT} placeholder="Filter weapons…" />
      <span class="lab-meta">
        <span>{#if weaponsShown.length !== loadout.weapons.length}<span class="num font-semibold text-ink">{weaponsShown.length}</span> of{/if} top <span class="num font-semibold text-ink">{loadout.weapons.length}</span> of <span class="num font-semibold text-ink">{loadout.weaponCount}</span> {loadout.source === 'owned' ? 'owned' : 'obtainable'}</span>
      </span>
    </header>
    {#if !loadout.weapons.length}
      {@render empty(`${loadout.cls} weapons`)}
    {:else if !weaponsShown.length}
      <p class="px-4 py-8 text-center text-[12.5px] text-dim">No weapon matches the filter.</p>
    {:else}
      <div class="min-h-0 flex-1 overflow-y-auto">
      <table class="lab-table">
        <thead class="sticky top-0 z-10 bg-panel">
          <tr>
            <th>Weapon</th>
            <th class="text-right" title="Damage after every modifier">Dmg</th>
            <th class="text-right" title="Ticks the weapon takes per use">Use</th>
            <th class="text-right">Crit chance</th>
            <th class="w-[34%]">
              <span class="inline-flex items-center gap-1">
                {loadout.weapons[0].kind === 'dps' ? 'Real DPS' : 'Damage per hit'}
                <Info label="How Real DPS is computed" w={420}>
                  <p>
                    hits per second × damage per hit × crit × mana sustain, plus the DPS of every debuff the
                    target boss is not immune to.
                  </p>
                  <p>
                    Hits per second come from how the weapon works — a swing, a spear, a yoyo, a held beam, a shot.
                    Then how much of what it fires lands on that boss at the distance the class usually fights from, determined by:
                    its spread against the target's width, the lead a moving boss forces on a slow projectile,
                    the drop of an arc, the range it reaches, and how much of that homing undoes.
                    Damage per hit is the weapon's damage (plus the plain ammo of its kind — a Musket Ball &
                    Wooden Arrow) minus half the boss's defense.
                  </p>
                  <p>
                    A gun and its ammo are two picks, so they are ranked apart: the ammo below is graded by
                    handing the best gun of its kind each round in turn.
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
          {#each weaponGroups as g}
          {#if g.mode}<tr><td colspan="5" class="!py-1 text-[11px] font-semibold uppercase tracking-wide text-dim" title={MODE_TAG[g.mode].tip}>{g.mode}s</td></tr>{/if}
          {#each g.list as w, i}
            <tr class="row" onclick={() => onselect(w.item.id)}>
              <td>
                <div class="flex items-center gap-2">
                  <span class="num w-4 shrink-0 text-right text-[11px] text-dim">{i + 1}</span>
                  <WikiIcon item={w.item} />
                  <div class="min-w-0">
                    <div class="font-medium">{w.item.name}{@render tags(w)}{#if w.mode === 'stealth'}<span class="lab-tag plum ml-1" title="Graded by stealth strikes: {Math.round(w.stealth)}/s vs spam {Math.round(w.spam)}/s">stealth</span>{:else if w.mode === 'spam'}<span class="lab-tag ml-1" title="graded by normal attacks: {Math.round(w.spam)}/s vs stealth {Math.round(w.stealth)}/s">spam</span>{:else if w.mode}<span class="lab-tag ml-1 {MODE_TAG[w.mode]?.color ?? ''}" title={MODE_TAG[w.mode]?.tip ?? ''}>{w.mode}</span>{/if}{#if w.ammo}<span class="lab-tag ml-1" title="Graded firing the plain ammo of its kind — what better rounds add is the ammo list below">{w.ammo.name}</span>{/if}</div>
                    <div class="text-[11.5px] text-dim">{modName(w.item)} · <span class="inline-flex items-center gap-0.5 align-middle"><BossIcon {ds} stage={w.item.stage} size={14} />{w.item.stageLabel}</span>{w.prefix ? ` · ${w.prefix.name}` : ''}</div>
                  </div>
                </div>
              </td>
              <td class="num text-right">{w.eff.damage}</td>
              <td class="num text-right text-dim">{Math.round(w.item.cls === 'melee' ? w.eff.useAnimation : w.eff.useTime) || '–'}</td>
              <!-- the crit the weapon is actually swung at: its own plus what the loadout carries -->
              <td class="num text-right text-dim" title="{w.eff.crit}% on the weapon{loadout.bonus.crit ? ` + ${Math.round(loadout.bonus.crit)}% from the loadout` : ''}">{Math.round(w.eff.crit + (w.item.cls === 'summon' ? 0 : loadout.bonus.crit))}%</td>
              <td>
                <div class="flex items-center gap-2">
                  <div class="bar flex-1"><i style="width:{Math.round((w.value / maxDps) * 100)}%"></i></div>
                  <span class="num w-16 shrink-0 text-right font-semibold" title={fmtFull(w.value)}>{fmtNum(w.value)}</span>
                </div>
              </td>
            </tr>
          {/each}
          {/each}
        </tbody>
      </table>
      </div>
    {/if}
    {#if ammoShown.length}
      <div class="max-h-[16rem] shrink-0 overflow-y-auto border-t border-line">
      <table class="lab-table">
        <thead class="sticky top-0 z-10 bg-panel">
          <tr><th>Ammo</th><th class="text-right">Dmg</th><th class="w-[34%]">In its best gun</th></tr>
        </thead>
        <tbody>
          {#each ammoShown as a}
            <tr class="row">
              <td>
                <div class="flex items-center gap-2">
                  <WikiIcon item={a.item} />
                  <div class="min-w-0">
                    <div class="font-medium">{a.item.name}<span class="lab-tag plum ml-1" title="{a.kindName} ammo, ranked against the other {a.kindName.toLowerCase()}s — a rocket and a musket ball are not alternatives">{a.kindName.toLowerCase()}</span></div>
                    <div class="text-[11.5px] text-dim">{modName(a.item)} · {ds.stages[a.item.stage]?.label ?? '?'} · in a {a.gun.name}</div>
                  </div>
                </div>
              </td>
              <td class="num text-right">{a.item.damage}</td>
              <td>
                <div class="flex items-center gap-2">
                  <div class="bar flex-1"><i style="width:{Math.round((a.value / maxAmmo) * 100)}%"></i></div>
                  <span class="num w-16 shrink-0 text-right font-semibold" title={fmtFull(a.value)}>{fmtNum(a.value)}</span>
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
        <label class="flex items-center gap-1.5" title="Score every item as if it already carries this reforge">
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
              <p>Boots, shields and dashes don't stack, so the solver equips only the best item from each of those groups. The rest follows in the ranking.</p>
              <p>Wings and boots have their own tabs, the group is named under each accessory that belongs to one.</p>
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
                <div class="mb-1.5 text-[11px] text-dim">{modName(a.item)} · <span class="inline-flex items-center gap-0.5 align-middle"><BossIcon {ds} stage={a.item.stage} size={14} />{a.item.stageLabel}</span>{a.group && tab === 'accessories' ? ` · ${a.group}` : ''}{a.prefix ? ` · ${a.prefix.name}` : ''}</div>
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

  <!-- potions: what to drink before the fight, graded the same way gear is -->
  <div class="lab-panel overflow-hidden xl:col-span-2">
    <header class="lab-head">
      <h2>Potions</h2>
      <span class="lab-meta">
        <span>what to drink at <span class="inline-flex items-center gap-0.5 align-middle"><BossIcon {ds} stage={ui.stage} size={14} />{ds.stages[ui.stage]?.label}</span>, best first</span>
        <Info label="Potions" w={340}>
          <p>Every potion, flask and dish obtainable at this stage, scored for {CLASS_LABELS[loadout.cls] ?? loadout.cls} like a piece of gear.</p>
          <p>A buff whose effect the score model reads nothing into (a spelunker, a fishing potion) scores nothing and is tagged with <em>utility</em>.</p>
        </Info>
      </span>
    </header>
    {#if !potionsShown.length}
      {@render empty('potions')}
    {:else}
      <div class="grid gap-px bg-line sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {#each potionsShown as p}
          <button class="lab-cell" onclick={() => onselect(p.item.id)}>
            <div class="flex items-start gap-2">
              <WikiIcon item={p.item} />
              <div class="min-w-0 flex-1">
                <div class="flex items-baseline justify-between gap-2">
                  <span class="font-medium">{p.item.name}{@render tags(p)}{#if !p.parts.length}<span class="lab-tag ml-1" title="Nothing the score model reads — useful outside a fight">utility</span>{/if}</span>
                  {#if p.parts.length}<span class="num text-[12px] font-semibold" style="color:{accent}">{p.score}</span>{/if}
                </div>
                <div class="mb-1.5 text-[11px] text-dim">
                  {modName(p.item)} · <span class="inline-flex items-center gap-0.5 align-middle"><BossIcon {ds} stage={p.item.stage} size={14} />{p.item.stageLabel}</span>{p.item.buffTime ? ` · ${fmtDuration(p.item.buffTime)}` : ''}
                </div>
                {#if p.parts.length}
                  <ScoreParts parts={p.parts} max={3} />
                {:else}
                  <span class="line-clamp-2 text-[11.5px] text-dim">{p.item.tooltip}</span>
                {/if}
              </div>
            </div>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</section>
