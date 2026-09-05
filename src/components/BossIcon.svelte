<script>
  // Wiki sprite for the first NPC on a stage, if that stage names one. Silent when the stage is
  // an event (Blood Moon, Pumpkin Moon) or a start row with no NPC — nothing renders.
  // The npcsOut record only carries stats + name, so `mod` is recovered from the id prefix
  // (`v:EyeofCthulhu`, `CalamityMod:CalamitasClone`).
  import WikiIcon from './WikiIcon.svelte';
  let { ds, stage, size = 20 } = $props();
  const bossId = $derived(ds?.stages?.[stage]?.npcs?.[0]);
  const boss = $derived(bossId ? ds.npcs?.[bossId] : null);
  const mod = $derived(bossId ? bossId.split(':')[0] : null);
</script>

{#if boss && boss.name}<WikiIcon item={{ mod: boss.mod ?? mod, name: boss.name, icon: boss.icon, img: boss.img }} {size} />{/if}
