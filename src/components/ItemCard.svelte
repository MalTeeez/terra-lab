<script>
  import { CLASS_LABELS } from '../lib/dataset.js';
  import { accessoryGroup, pieceScore, setBonusScore, weaponDps } from '../lib/score.js';
  import { effectiveStats, prefixesFor } from '../lib/stats.js';
  import { setOwned, toggleIn, ui } from '../lib/state.svelte.js';
  import ScoreParts from './ScoreParts.svelte';

  let { ds, item, statCtx, onclose, onselect } = $props();
  const isGear = $derived(item.slot !== 'weapon');
  const own = $derived(ui.owned[item.id]);
  const prefixOptions = $derived(prefixesFor(item, ds.prefixes, ds.aliases));
  const prefix = $derived(own?.prefix ? ds.prefixById.get(own.prefix) ?? null : null);
  const ctx = $derived({ ...statCtx, prefix });
  const score = $derived(isGear ? pieceScore(item, ui.cls, ds.aliases, { prefix }) : null);
  const setScore = $derived(item.slot === 'head' && (item.setEffects || item.setBonus) ? setBonusScore(item, ui.cls, ds.aliases) : null);
  const dps = $derived(item.slot === 'weapon' ? weaponDps(item, ctx) : null);
  const eff = $derived(item.slot === 'weapon' ? effectiveStats(item, ctx) : null);
  const heads = $derived(item.setHeads ?? []);
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
  const src = $derived(item.stageSource);
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

<svelte:window onkeydown={onkey} />

<div class="fixed inset-0 z-40 bg-ink/20" onclick={onclose}></div>
<aside class="fixed inset-y-0 right-0 z-50 flex w-full max-w-[480px] flex-col overflow-y-auto border-l-2 border-green bg-panel shadow-xl">
  <header class="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
    <div>
      <h2 class="text-[17px] leading-tight">{item.name}</h2>
      <div class="mt-0.5 text-[12px] text-dim">
        {item.modName} · <span class="lab-tag">{item.slot}</span>
        {#if item.cls}<span class="lab-tag green ml-1">{CLASS_LABELS[item.cls] ?? item.cls}</span>{/if}
        {#if item.rarityName}<span class="ml-1">{item.rarityName}</span>{/if}
        {#if item.changes?.length}<span class="lab-tag warn ml-1" title="another mod changes this item">rebalanced</span>{/if}
      </div>
    </div>
    <button class="lab-btn" onclick={onclose} aria-label="Close">✕</button>
  </header>

  <!-- ownership / reforge / solver constraints -->
  <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-panel2 px-5 py-2.5 text-[12.5px]">
    <label class="flex items-center gap-1.5"><input type="checkbox" checked={!!own} onchange={(e) => setOwned(item.id, e.currentTarget.checked)} /> I own this</label>
    {#if prefixOptions.length}
      <label class="flex items-center gap-1.5">
        <span class="text-dim">reforge</span>
        <select class="lab-input w-auto py-0.5" value={own?.prefix ?? ''} onchange={(e) => setOwned(item.id, true, e.currentTarget.value || null)}>
          <option value="">{own ? 'no prefix' : ui.reforge === 'best' ? 'assumed best' : 'none'}</option>
          {#each prefixOptions as p}<option value={p.id}>{p.name}{p.mod !== 'v' ? ` (${p.mod})` : ''}</option>{/each}
        </select>
      </label>
    {/if}
    <button class="lab-chip py-0.5" aria-pressed={ui.pinned.includes(item.id)} onclick={() => toggleIn('pinned', item.id)} title="Always put this in the loadout">pin</button>
    <button class="lab-chip py-0.5" aria-pressed={ui.excluded.includes(item.id)} onclick={() => toggleIn('excluded', item.id)} title="Never pick this">exclude</button>
  </div>

  <div class="flex flex-col gap-4 px-5 py-4 text-[13px]">
    <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
      {#if item.damage !== undefined}
        <dt class="text-dim">Damage</dt>
        <dd class="num">{eff ? eff.damage : item.damage}{#if eff && eff.damage !== item.damage}<span class="ml-1 text-dim">(mined {item.damage})</span>{/if}{#if item.dc}<span class="ml-2 text-dim">{item.dc.replace(/DamageClass$/, '')}</span>{/if}</dd>
      {/if}
      {#if item.useTime !== undefined || item.useAnimation !== undefined}<dt class="text-dim">Use time</dt><dd class="num">{eff ? eff.useTime : item.useTime ?? '–'} / {eff ? eff.useAnimation : item.useAnimation ?? '–'} <span class="text-dim">(use / animation)</span></dd>{/if}
      {#if item.crit !== undefined || eff}<dt class="text-dim">Crit</dt><dd class="num">{eff ? eff.crit : item.crit}%</dd>{/if}
      {#if item.knockback !== undefined}<dt class="text-dim">Knockback</dt><dd class="num">{item.knockback}</dd>{/if}
      {#if item.mana !== undefined}<dt class="text-dim">Mana</dt><dd class="num">{item.mana}</dd>{/if}
      {#if item.defense !== undefined}<dt class="text-dim">Defense</dt><dd class="num">{item.defense}{#if item.base?.defense !== undefined}<span class="ml-1 text-dim">(mined {item.base.defense})</span>{/if}</dd>{/if}
      {#if dps}<dt class="text-dim">Real {dps.kind}</dt><dd class="num font-semibold text-green-deep">{Math.round(dps.value * 10) / 10}{#if dps.mode === 'stealth' || dps.mode === 'spam'}<span class="lab-tag ml-2 font-normal" class:green={dps.mode === 'stealth'}>{dps.mode}</span><span class="ml-2 font-normal text-dim">spam {Math.round(dps.spam * 10) / 10} · stealth {Math.round(dps.stealth * 10) / 10}</span>{:else if dps.rate}<span class="ml-2 font-normal text-dim">{dps.rate}/s × {Math.round(dps.critMult * 100) / 100} crit</span>{/if}</dd>{/if}
      {#if item.shoot || item.useAmmo}<dt class="text-dim">Fires</dt><dd class="text-[12.5px]">{@render projLine(item)}</dd>{/if}
      <dt class="text-dim">Obtainable</dt>
      <dd>
        {item.stageLabel}
        <span class="lab-tag ml-1" class:warn={src.kind === 'rarity' || src.kind === 'unknown'}>{src.kind}</span>
        {#if src.kind === 'drop' || src.kind === 'bag' || src.kind === 'spawn' || src.kind === 'anchor' || src.kind === 'override'}<span class="text-dim"> — {src.boss}{src.via ? ` (${src.via})` : ''}</span>{/if}
        {#if src.kind === 'craft' && src.from?.length}<span class="text-dim"> — gated by {src.from.join(', ')}</span>{/if}
        {#if src.kind === 'rarity'}<span class="text-dim"> — guessed from rarity; no drop or recipe found</span>{/if}
      </dd>
    </dl>

    {#if dps && dps.kind === 'dps'}
      <section>
        <span class="lab-label mb-1">Real DPS{dps.mode === 'stealth' ? ' — stealth strikes' : dps.mode === 'spam' ? ' — spam' : ''}</span>
        <table class="lab-table">
          <tbody>
            {#each (dps.mode === 'stealth' ? dps.stealthParts : dps.parts) as p}
              <tr><td class="text-[12px] text-ink2">{p.label}</td><td class="num text-right">{p.value !== undefined ? p.value : `×${p.mul}${p.unit ?? ''}`}</td></tr>
            {/each}
            <tr class="font-semibold"><td>per second</td><td class="num text-right text-green-deep">{Math.round(dps.value * 10) / 10}</td></tr>
          </tbody>
        </table>
        {#if dps.mode === 'stealth' || dps.mode === 'spam'}
          <details class="mt-1 text-[12px] text-dim"><summary class="cursor-pointer">the other way: {dps.mode === 'stealth' ? 'spam' : 'stealth'} {Math.round((dps.mode === 'stealth' ? dps.spam : dps.stealth) * 10) / 10}/s</summary>
            <table class="lab-table mt-1"><tbody>{#each (dps.mode === 'stealth' ? dps.parts : dps.stealthParts) as p}<tr><td class="text-[12px]">{p.label}</td><td class="num text-right">{p.value !== undefined ? p.value : `×${p.mul}${p.unit ?? ''}`}</td></tr>{/each}</tbody></table>
          </details>
        {/if}
      </section>
    {/if}

    {#if eff && eff.chain.length > 1}
      <section>
        <span class="lab-label mb-1">How the damage is derived</span>
        <table class="lab-table">
          <tbody>
            {#each eff.chain as step}
              <tr><td class="text-[12px] text-ink2">{step.label}</td><td class="num text-right">{step.damage ?? ''}</td><td class="num text-right text-dim">{step.crit !== undefined ? `${step.crit}%` : ''}</td><td class="num text-right text-dim">{step.useTime !== undefined ? `${step.useTime}t` : ''}</td></tr>
            {/each}
          </tbody>
        </table>
      </section>
    {:else if item.changes?.length || item.variants?.length || item.mods?.length || item.maybe}
      <section>
        <span class="lab-label mb-1">Changed by other mods</span>
        <ul class="m-0 list-none p-0 text-[12.5px] text-ink2">
          {#each item.changes ?? [] as c}<li>{c.mod} {c.hook}: {c.field ? `${c.field} ${c.from} → ${c.to}` : fmtEffects(c.effects).join(', ')}</li>{/each}
          {#each item.variants ?? [] as v}<li class="text-dim">{v.mod} on {v.cond.join('+')}: {v.field ? `${v.field} → ${v.to}` : fmtEffects(v.effects).join(', ')}</li>{/each}
          {#if item.maybe}<li class="text-dim">{item.maybe} conditional change{item.maybe > 1 ? 's' : ''} whose guard could not be resolved</li>{/if}
        </ul>
      </section>
    {/if}
    {#if item.maybe && eff}
      <p class="m-0 text-[11.5px] text-warn">{item.maybe} more change{item.maybe > 1 ? 's' : ''} exist under conditions the miner could not resolve.</p>
    {/if}

    {#if item.tooltip}
      <section>
        <span class="lab-label mb-1">Tooltip</span>
        <p class="m-0 whitespace-pre-line text-ink2">{item.tooltip}</p>
        {#if item.placeholders}<p class="m-0 mt-1 text-[11.5px] text-warn">Numbers shown as {'{0}'} are filled in by the mod at runtime; the score uses the values read from the mod's code where available.</p>{/if}
      </section>
    {/if}

    {#if score}
      <section>
        <span class="lab-label mb-1">Score for {CLASS_LABELS[ui.cls]}{prefix ? ` with ${prefix.name}` : ''}</span>
        {#if score.parts.length}<ScoreParts parts={score.parts} score={score.score} max={12} />{:else}<span class="text-dim">nothing this class benefits from</span>{/if}
      </section>
    {/if}
    {#if item.slot === 'accessory' && accessoryGroup(item)}
      <p class="m-0 text-[12px] text-dim">Exclusive group: <span class="lab-tag">{accessoryGroup(item)}</span> — the solver equips one of these.</p>
    {/if}

    {#if item.effects}
      <section>
        <span class="lab-label mb-1">Effects read from code</span>
        <ul class="m-0 list-none p-0 text-[12.5px] text-ink2">
          {#each fmtEffects(item.effects) as line}<li class="num">{line}</li>{/each}
        </ul>
      </section>
    {/if}

    {#if item.slot === 'head' && (item.setBonus || item.setEffects)}
      <section>
        <span class="lab-label mb-1">Set bonus</span>
        {#if item.setBonus}<p class="m-0 whitespace-pre-line text-ink2">{item.setBonus}</p>{/if}
        {#if item.setEffects}<ul class="m-0 mt-1 list-none p-0 text-[12.5px] text-ink2">{#each fmtEffects(item.setEffects) as line}<li class="num">{line}</li>{/each}</ul>{/if}
        {#if setScore?.parts.length}<div class="mt-1"><ScoreParts parts={setScore.parts} score={setScore.score} /></div>{/if}
        {#if item.setItems?.length}
          <p class="m-0 mt-1 text-[12px] text-dim">With
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

    {#if item.sources?.length}
      <section>
        <span class="lab-label mb-1">Sources</span>
        <ul class="m-0 list-none p-0 text-[12.5px] text-ink2">
          {#each item.sources as s}
            <li><span class="lab-tag mr-1">{s.kind}</span>{s.from}</li>
          {/each}
        </ul>
      </section>
    {/if}

    <p class="m-0 text-[11px] text-dim">id <span class="num">{item.id}</span></p>
  </div>
</aside>
