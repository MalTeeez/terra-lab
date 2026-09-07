<script>
  /**
   * The item as the game shows it: the sprite big, the name in its rarity colour, and the stat
   * lines Terraria itself would print, in the same order and wording (speed and knockback come
   * out as words there, not numbers). Drawn dark, because that is the only background those
   * rarity colours are readable on.
   */
  import WikiIcon from './WikiIcon.svelte';
  import { fmtSpeed } from '../lib/fmt.js';

  let { item, stats = null } = $props();

  // vanilla rarities plus the modded ones common enough to name themselves; anything else falls
  // back to the vanilla colour for its rarity number, then to plain white
  const RARITY = {
    Gray: '#828282', White: '#ffffff', Blue: '#9696ff', Green: '#96ff96', Orange: '#ffc896',
    'Light Red': '#ff9696', Pink: '#ff96ff', 'Light Purple': '#d2a0ff', Lime: '#96ff0a',
    Yellow: '#ffff0a', Cyan: '#5acdff', Red: '#ff2864', Purple: '#b428ff', Expert: '#ff9eda',
    Turquoise: '#00e0c0', 'Pure Green: ': '#00ff00', 'Pure Green': '#00ff00', 'Blood Orange': '#ff5722',
    'Cosmic Purple': '#8b40ff', 'Burnished Auric': '#e6b325', 'Hot Pink': '#ff2e97',
    'Calamity Red': '#ff0000', 'Exotic Rainbow': '#f47dff', Terrarium: '#5aff97', Anomaly: '#8ee7ff',
    Aqua: '#4fd1ff', Violet: '#a066ff', 'Dark Orange': '#ff8c00', Sunbulb: '#ffd45c',
    'Nameless Deity': '#ffe6a8', Avatar: '#c9a6ff',
  };
  const VANILLA = ['#828282', '#ffffff', '#9696ff', '#96ff96', '#ffc896', '#ff9696', '#ff96ff', '#d2a0ff', '#96ff0a', '#ffff0a', '#5acdff', '#ff2864', '#b428ff'];
  const color = $derived(RARITY[item.rarityName] ?? VANILLA[(item.rarity ?? 0) + 1] ?? '#ffffff');

  const KNOCK = [[0, 'No'], [1.5, 'Extremely weak'], [3, 'Very weak'], [4, 'Weak'], [6, 'Average'], [7, 'Strong'], [9, 'Very strong'], [11, 'Extremely strong']];
  const word = (table, v, last) => table.find(([max]) => v <= max)?.[1] ?? last;
  const cls = (it) => (it.dc ?? '').replace(/(Damage)?(Class)?$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

  // sell price is a fifth of the value, in the game's coin denominations
  const coins = (v) => {
    const parts = [['platinum', 1000000, '#d4e4f0'], ['gold', 10000, '#e6cc80'], ['silver', 100, '#d0d0d8'], ['copper', 1, '#e0a070']];
    const out = [];
    let left = Math.floor(v);
    for (const [name, unit, tone] of parts) {
      const n = Math.floor(left / unit);
      if (n) { out.push({ text: `${n} ${name}`, tone }); left -= n * unit; }
    }
    return out;
  };

  // `stats` are the effective ones (reforge and cross-mod rebalances folded in); the item's own
  // numbers are the fallback, and a changed one is worth pointing out
  const s = $derived({
    damage: stats?.damage ?? item.damage,
    crit: stats?.crit ?? item.crit,
    useAnimation: stats?.useAnimation ?? item.useAnimation ?? item.useTime,
    knockback: stats?.knockback ?? item.knockback,
  });
  const lines = $derived.by(() => {
    const out = [];
    if (s.damage !== undefined) out.push(`${s.damage}${cls(item) ? ` ${cls(item)}` : ''} damage`);
    if (s.crit !== undefined) out.push(`${s.crit}% critical strike chance`);
    if (s.useAnimation !== undefined) out.push(`${fmtSpeed(s.useAnimation)} speed`);
    if (s.knockback !== undefined) out.push(`${word(KNOCK, s.knockback, 'Insane')} knockback`);
    if (item.pick) out.push(`${item.pick}% pickaxe power`);
    if (item.mana) out.push(`Uses ${item.mana} mana`);
    if (item.defense !== undefined) out.push(`${item.defense} defense`);
    return out;
  });
  const body = $derived((item.tooltip ?? '').replace(/<left>/gi, 'Left click').replace(/<right>/gi, 'Right click'));
</script>

<div class="border-2 border-[#39405a] bg-[#0e1018] p-3 text-[12.5px] leading-[1.5] text-[#e7eaf6]" style="box-shadow: inset 0 0 0 1px #191d2b, var(--shadow-pop)">
  <div class="flex items-start gap-3">
    <div class="grid h-[84px] w-[84px] shrink-0 place-items-center border border-[#2b3145] bg-[#151a28]" style="background-image: linear-gradient(135deg, #171d2c, #0f1320)">
      <WikiIcon {item} size={72} />
    </div>
    <div class="min-w-0 flex-1">
      <div class="text-[16px] font-semibold leading-tight" style="color:{color}; text-shadow: 0 2px 0 rgb(0 0 0 / 0.6)">{item.name}</div>
      <div class="mt-0.5 text-[10.5px] uppercase tracking-[0.12em] text-[#7d87a4]">{item.modName}{item.rarityName ? ` · ${item.rarityName}` : ''}</div>
      <div class="mt-1.5 flex flex-col">
        {#each lines as l}<span>{l}</span>{/each}
        {#if item.slot === 'accessory' || item.slot === 'head' || item.slot === 'body' || item.slot === 'legs'}<span>Equipable</span>{/if}
      </div>
    </div>
  </div>

  {#if body}
    <p class="m-0 mt-2.5 whitespace-pre-line border-t border-[#2b3145] pt-2 text-[#b9c2dd]">{body}</p>
  {/if}
  {#if item.setBonus}
    <p class="m-0 mt-1.5 whitespace-pre-line text-[#8ee7a8]">Set bonus: {item.setBonus}</p>
  {/if}
  {#if item.value}
    <div class="mt-2.5 flex flex-wrap gap-x-1.5 border-t border-[#2b3145] pt-2 text-[#8d96b2]">
      Sells for {#each coins(item.value / 5) as c}<span style="color:{c.tone}">{c.text}</span>{/each}
    </div>
  {/if}
</div>
