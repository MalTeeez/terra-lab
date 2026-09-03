/**
 * Progression flags as the interpreter sees them: `Main.hardMode`, `NPC.downedX`, a mod's
 * `DownedBossSystem.downedX`, event flags (`Main.pumpkinMoon`, `Main.eclipse`, ...), `Zone*`
 * player fields / getters, and `Main.invasionType` as a case key (`invasion:N` gates).
 * Region tags built from these are the gates of whatever happens inside the block.
 */
import { UNKNOWN, isNum, simpleName } from './interp.js';

export const STATIC_FLAG_RE = /^(hardMode|downed(?!Any)[A-Z]\w*|pumpkinMoon|snowMoon|eclipse|bloodMoon|slimeRain|IsHardmode)$/;

/**
 * Special world seeds. The code names one seed several ways (`remixWorld`, `RemixSeed`,
 * `RemixSeedEasymode`, `DontDigUp`), so a `seed:<name>` gate is grouped to the seed the player
 * would actually pick. Evidence behind a seed is unusable unless that seed is switched on.
 */
export const SEED_GROUPS = [
  { key: 'remix', label: "Don't Dig Up", re: /remix|dontdigup/i },
  { key: 'forTheWorthy', label: 'For the Worthy', re: /fortheworthy|getgood/i },
  { key: 'anniversary', label: '10th Anniversary', re: /anniversary|celebration/i },
  { key: 'zenith', label: 'Get Fixed Boi', re: /zenith|everything|gfb/i },
  { key: 'drunk', label: 'Drunk World', re: /drunk/i },
  { key: 'notTheBees', label: 'Not the Bees', re: /notthebees/i },
  { key: 'noTraps', label: 'No Traps', re: /notraps/i },
  { key: 'dontStarve', label: "Don't Starve", re: /dontstarve/i },
];
/** `seed:RemixSeedEasymode` → the SEED_GROUPS entry, or null. */
export const seedGroup = (flag) => (flag.startsWith('seed:') ? SEED_GROUPS.find((g) => g.re.test(flag.slice(5))) ?? null : null);

/** Hooks to spread into a Machine (`onStaticLoad`, `onLoad`, `onCall` fall through when they return undefined). */
export function progressionHooks() {
  return {
    onStaticLoad(f) {
      const decl = f.declaringType?.fullName ?? f.declaringType?.name ?? '';
      if (/^Terraria\.ID\./.test(decl)) return undefined;
      if (STATIC_FLAG_RE.test(f.name)) return { k: 'flag', name: f.name };
      // special world seeds: what only happens there is not normal progression (never resolves)
      if (decl === 'Terraria.Main' && /^(remixWorld|zenithWorld|drunkWorld|getGoodWorld|notTheBeesWorld|noTrapsWorld|dontStarveWorld|tenthAnniversaryWorld|everythingWorld)$/.test(f.name)) return { k: 'flag', name: `seed:${f.name}` };
      if (f.name === 'invasionType' && decl === 'Terraria.Main') return { k: 'key', slot: 'invasion' };
      // a mod event's state (`CherryMoonEvent.Active`): a flag named after the event, resolved by config
      const typeName = decl.split(/[./]/).pop();
      const isEventType = /Event|Invasion|Moon|Storm|Rain/i.test(typeName);
      if (isEventType && (/^(Active|IsActive|Ongoing|isActive|active|Happening|IsHappening)$/.test(f.name) || f.name.toLowerCase() === typeName.toLowerCase().replace(/event$/, ''))) return { k: 'flag', name: `event:${typeName}` };
      // game state (moonPhase, dayTime, rand ...) is not known: never evaluate these static ctors
      if (/^Terraria\.(Main|NPC|WorldGen|Player)$/.test(decl)) return UNKNOWN;
      return undefined;
    },
    onLoad(recv, name) {
      if (/^Zone[A-Z]/.test(name) || /^[A-Z]\w+Biome$/.test(name)) return { k: 'flag', name }; // SOTS's PlanetariumBiome, PyramidBiome ...
      return undefined;
    },
    onCall(callee) {
      if (callee.sig?.params.length === 0 && /^get_(Zone[A-Z]\w*|[A-Z]\w+Biome|downed(?!Any)[A-Z]\w*|hardMode)$/.test(callee.name)) return { k: 'flag', name: callee.name.slice(4) };
      // `Player.InModBiome<XBiome>()` — the same gate SOTS spells as a `get_XBiome` property.
      // A biome the config does not name resolves to the start, so this can only ever add a gate.
      if (callee.name === 'InModBiome' && callee.typeArgs?.length === 1) {
        const name = simpleName(callee.typeArgs[0]);
        if (name) return { k: 'flag', name };
      }
      return undefined;
    },
  };
}

/**
 * Gate list of one site from the interpreter context: plain region tags, `any:` alternatives,
 * an invasion case as `invasion:N`. `!x` tags (the flag is false there) are no requirement.
 */
export function siteGates(ctx) {
  const out = new Set();
  for (const t of ctx?.condTags ?? []) if (!t.startsWith('!')) out.add(t);
  for (const c of ctx?.cases ?? []) if (c.slot === 'invasion' && isNum(c.value)) out.add(`invasion:${c.value}`);
  return [...out];
}

/**
 * A value as the alternatives it stands for, each with the context (flags) it holds under:
 * `phi` (a ternary's arms), `oneof` (a random pick), `maybe` (a conditionally stored constant).
 * @returns {Array<{ v: any, ctx: object }>}
 */
export function expandValue(val, ctx) {
  if (val?.k === 'phi') return val.alts.flatMap((a) => expandValue(a.v, { ...ctx, condTags: [...(ctx?.condTags ?? []), ...a.tags] }));
  if (val?.k === 'oneof') return val.items.flatMap((v) => expandValue(v, ctx));
  if (val?.k === 'maybe') return expandValue(val.value, { ...ctx, condTags: [...(ctx?.condTags ?? []), ...(val.tags ?? [])] });
  return [{ v: val, ctx }];
}
