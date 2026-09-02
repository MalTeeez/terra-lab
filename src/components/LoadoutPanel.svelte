<script>
  import { CLASS_LABELS } from '../lib/dataset.js';
  import ScoreParts from './ScoreParts.svelte';

  let { ds, loadout, onselect } = $props();
  const maxDps = $derived(Math.max(1, ...loadout.weapons.map((w) => w.value)));
  const fmt = (v) => (v >= 1000 ? Math.round(v).toLocaleString() : Math.round(v * 10) / 10);
  const modName = (it) => (it.mod === 'v' ? 'Terraria' : ds.modById.get(it.mod)?.name ?? it.mod);
</script>

{#snippet tags(p)}
  {#if p.owned}<span class="lab-tag green ml-1">yours</span>{/if}
  {#if p.pinned}<span class="lab-tag ml-1">pinned</span>{/if}
  {#if p.item.changes?.length}<span class="lab-tag warn ml-1" title="rebalanced by another mod">rebalanced</span>{/if}
{/snippet}

<section class="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
  <!-- armor -->
  <div class="lab-panel">
    <header class="flex items-baseline justify-between border-b border-line px-4 py-2.5">
      <h2 class="text-[13px] uppercase tracking-[0.1em] text-ink2">Armor</h2>
      {#if loadout.armor}
        <span class="text-[12px] text-dim">
          {loadout.armor.isSet ? 'full set' : 'mixed pieces'} · <span class="num">{loadout.armor.defense}</span> defense · score <span class="num font-semibold text-green-deep">{loadout.armor.score}</span>
        </span>
      {/if}
    </header>
    {#if !loadout.armor}
      <p class="px-4 py-6 text-center text-dim">No armor available{loadout.source === 'owned' ? ' among your gear' : ' at this stage'}.</p>
    {:else}
      <table class="lab-table">
        <tbody>
          {#each ['head', 'body', 'legs'] as slot}
            {@const p = loadout.armor[slot]}
            <tr class="cursor-pointer" onclick={() => onselect(p.item.id)}>
              <td class="w-14 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-dim">{slot}</td>
              <td>
                <div class="font-medium text-ink">{p.item.name}{@render tags(p)}</div>
                <div class="text-[11.5px] text-dim">{modName(p.item)} · {p.item.stageLabel}</div>
              </td>
              <td class="num w-16 text-right">{p.item.defense ?? 0} <span class="text-[10.5px] text-dim">def</span></td>
              <td class="w-[46%]"><ScoreParts parts={p.parts} score={p.score} max={4} /></td>
            </tr>
          {/each}
          {#if loadout.armor.isSet}
            <tr>
              <td class="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-green">set</td>
              <td colspan="2" class="whitespace-pre-line text-[12.5px] text-ink2">{loadout.armor.head.item.setBonus || 'Set bonus (see effects)'}</td>
              <td><ScoreParts parts={loadout.armor.bonus.parts} score={loadout.armor.bonus.score} max={4} /></td>
            </tr>
          {/if}
        </tbody>
      </table>
      {#if loadout.armorAlternatives.length}
        <div class="border-t border-line px-4 py-2 text-[12px] text-dim">
          <span class="mr-2 font-semibold uppercase tracking-[0.08em]">Runner-up sets</span>
          {#each loadout.armorAlternatives as s}
            <button class="mr-3 cursor-pointer text-ink2 underline decoration-line underline-offset-2 hover:text-green" onclick={() => onselect(s.head.item.id)}>
              {s.head.item.name.replace(/ (Helmet|Headgear|Mask|Hood|Hat|Helm|Visage|Headpiece|Crown|Cowl|Head)$/i, '')} <span class="num">{s.score}</span>
            </button>
          {/each}
        </div>
      {/if}
    {/if}
  </div>

  <!-- weapons -->
  <div class="lab-panel">
    <header class="flex items-baseline justify-between border-b border-line px-4 py-2.5">
      <h2 class="text-[13px] uppercase tracking-[0.1em] text-ink2">{CLASS_LABELS[loadout.cls]} weapons</h2>
      <span class="text-[12px] text-dim"><span class="num">{loadout.weaponCount}</span> {loadout.source === 'owned' ? 'owned' : 'obtainable'} · top {loadout.weapons.length}</span>
    </header>
    {#if !loadout.weapons.length}
      <p class="px-4 py-6 text-center text-dim">No {loadout.cls} weapons{loadout.source === 'owned' ? ' among your gear' : ' at this stage'}.</p>
    {:else}
      <table class="lab-table">
        <thead>
          <tr><th>Weapon</th><th class="text-right">Dmg</th><th class="text-right">Use</th><th class="text-right">Crit</th><th class="w-[36%]">{loadout.weapons[0].kind === 'dps' ? 'Real DPS' : 'Damage per hit'}</th></tr>
        </thead>
        <tbody>
          {#each loadout.weapons as w}
            <tr class="cursor-pointer" onclick={() => onselect(w.item.id)}>
              <td>
                <div class="font-medium">{w.item.name}{@render tags(w)}{#if w.mode === 'stealth'}<span class="lab-tag green ml-1" title="graded by stealth strikes: {Math.round(w.stealth)}/s vs spam {Math.round(w.spam)}/s">stealth</span>{:else if w.mode === 'spam'}<span class="lab-tag ml-1" title="graded by normal attacks: {Math.round(w.spam)}/s vs stealth {Math.round(w.stealth)}/s">spam</span>{/if}</div>
                <div class="text-[11.5px] text-dim">{modName(w.item)} · {w.item.stageLabel}{w.prefix ? ` · ${w.prefix.name}` : ''}</div>
              </td>
              <td class="num text-right">{w.eff.damage}</td>
              <td class="num text-right">{Math.round(w.item.cls === 'melee' ? w.eff.useAnimation : w.eff.useTime) || '–'}</td>
              <td class="num text-right">{w.eff.crit}%</td>
              <td>
                <div class="flex items-center gap-2">
                  <div class="bar flex-1"><i style="width:{Math.round((w.value / maxDps) * 100)}%"></i></div>
                  <span class="num w-16 text-right font-semibold">{fmt(w.value)}</span>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      <p class="border-t border-line px-4 py-2 text-[11.5px] text-dim">
        Real DPS = damage (+ best ammo) × rate × crit × projectiles per use × accuracy (spread, velocity, gravity, homing) × pierce × wall pierce × debuffs × mana sustain, after balancing overlays, runtime modifiers{loadout.weapons.some((w) => w.prefix) ? ', reforges' : ''} and calibration. Rogue weapons are graded as <em>stealth</em> (one strike per 5 s{loadout.stealthMax ? `, max stealth ${Math.round(loadout.stealthMax * 100)} from the armor` : ''}) or <em>spam</em>, whichever is higher. Open a weapon for the arithmetic.
      </p>
    {/if}
  </div>

  <!-- accessories -->
  <div class="lab-panel lg:col-span-2">
    <header class="flex items-baseline justify-between border-b border-line px-4 py-2.5">
      <h2 class="text-[13px] uppercase tracking-[0.1em] text-ink2">Accessories</h2>
      <span class="text-[12px] text-dim"><span class="num">{loadout.accessories.length}</span> of {loadout.accessoryCount} scoring · one per wings / boots / shield / dash</span>
    </header>
    {#if !loadout.accessories.length}
      <p class="px-4 py-6 text-center text-dim">No useful accessories{loadout.source === 'owned' ? ' among your gear' : ' at this stage'}.</p>
    {:else}
      <div class="grid gap-px bg-line sm:grid-cols-2 xl:grid-cols-3">
        {#each loadout.accessories as a, i}
          <button class="cursor-pointer bg-panel p-3 text-left hover:bg-green-soft/50" onclick={() => onselect(a.item.id)}>
            <div class="flex items-baseline justify-between gap-2">
              <span class="font-medium"><span class="num mr-1.5 text-dim">{i + 1}</span>{a.item.name}{@render tags(a)}</span>
              <span class="num text-[12px] font-semibold text-green-deep">{a.score}</span>
            </div>
            <div class="text-[11.5px] text-dim">{modName(a.item)} · {a.item.stageLabel}{a.group ? ` · ${a.group}` : ''}{a.prefix ? ` · ${a.prefix.name}` : ''}</div>
            <div class="mt-1"><ScoreParts parts={a.parts} max={5} /></div>
          </button>
        {/each}
      </div>
      {#if loadout.accessoryAlternatives.length}
        <div class="border-t border-line px-4 py-2 text-[12px] text-dim">
          <span class="mr-2 font-semibold uppercase tracking-[0.08em]">Next best</span>
          {#each loadout.accessoryAlternatives as a}
            <button class="mr-3 cursor-pointer text-ink2 underline decoration-line underline-offset-2 hover:text-green" onclick={() => onselect(a.item.id)}>{a.item.name} <span class="num">{a.score}</span></button>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
</section>
