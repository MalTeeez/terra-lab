<script>
  /**
   * The full item view: a filter column (context, sort, collapsible filter groups) and result
   * cards, each scored for the class and gamestage in view and expandable in place.
   */
  import {
    ARCH_HINT,
    ARCH_LABELS,
    CLASS_LABELS,
    SLOT_LABELS,
    SOURCE_HINT,
    SOURCE_TONE,
    accentOf,
    eraOf,
  } from "../lib/dataset.js";
  import { pieceScore, weaponDps } from "../lib/score.js";
  import { loopLabel, loopPhases, loopsOf, projName } from "../lib/dps.js";
  import { effectiveStats } from "../lib/stats.js";
  import { setOwned, toggleIn, ui } from "../lib/state.svelte.js";
  import { craftTree, gateText, gatingChain } from "../lib/sources.js";
  import { MODE_TAG, traitsOf } from "../lib/traits.js";
  import { wikiHost, wikiUrl } from "../lib/wiki.js";
  import { fmtChance, fmtFull, fmtNum, fmtPart, fmtSpeed, fmtStat } from "../lib/fmt.js";
  import { FACTORS, SIGN_COLOR, factorOf, factorTip, signOf } from "../lib/factors.js";
  import { slide } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import WikiIcon from "./WikiIcon.svelte";
  import BossIcon from "./BossIcon.svelte";
  import FeatureIcon, { FEATURES, FEATURE_ICONS } from "./FeatureIcon.svelte";
  import {
    HardHat,
    Shirt,
    Footprints,
    Gem,
    Swords,
    Sword,
    Target,
    Wand2,
    Bug,
    VenetianMask,
    Hammer,
    Coins,
    Package,
    Skull,
    ShoppingBag,
    TreePine,
    HelpCircle,
    Music,
    HeartPulse,
    Ghost,
    Send,
    Heart,
    ShieldCheck,
    Gauge,
    Wind,
    Zap,
    Fish,
    ArrowUp,
    Droplet,
    Shield,
    Boxes,
    FlaskConical,
  } from "@lucide/svelte";

  // icon per filter key. Skipped when nothing clean maps (weapon types, mods, and any effect
  // label not in the map below).
  const SLOT_ICONS = {
    head: HardHat,
    body: Shirt,
    legs: Footprints,
    accessory: Gem,
    weapon: Swords,
    potion: FlaskConical,
  };
  const CLASS_ICONS = {
    melee: Sword,
    ranged: Target,
    magic: Wand2,
    summon: Bug,
    rogue: VenetianMask,
    thrower: Send,
    bard: Music,
    healer: HeartPulse,
    void: Ghost,
    classless: HelpCircle,
    other: Boxes,
    none: Shield,
  };
  const SOURCE_ICONS = {
    craft: Hammer,
    shop: Coins,
    drop: Skull,
    bag: Package,
    chest: Package,
    purchase: ShoppingBag,
    world: TreePine,
    unknown: HelpCircle,
  };
  // effect labels from traitOfLabel — only the ones with an obvious glyph. The odd ones ("spawns
  // …", "aggro", vendor-specific text) get no icon and just render as plain text.
  const EFFECT_ICONS = {
    damage: Sword,
    "melee damage": Sword,
    "ranged damage": Target,
    "magic damage": Wand2,
    "summon damage": Bug,
    "minion damage": Bug,
    "minion capacity": Bug,
    "rogue damage": VenetianMask,
    "throwing damage": Send,
    "bard damage": Music,
    healing: HeartPulse,
    "crit chance": Target,
    "melee crit chance": Target,
    "ranged crit chance": Target,
    "magic crit chance": Target,
    defense: ShieldCheck,
    "life regen": Heart,
    "max life": Heart,
    life: Heart,
    "max mana": Droplet,
    mana: Droplet,
    "mana regen": Droplet,
    "movement speed": Gauge,
    "melee speed": Zap,
    "attack speed": Zap,
    knockback: Wind,
    mobility: Wind,
    dash: Wind,
    "extra jump": ArrowUp,
    flight: ArrowUp,
    "flight boost": ArrowUp,
    fishing: Fish,
  };
  import ItemTooltip from "./ItemTooltip.svelte";
  import CraftGraph from "./CraftGraph.svelte";
  import PhaseGraph from "./PhaseGraph.svelte";
  import PhaseWindow from "./PhaseWindow.svelte";
  import RangeFilter from "./RangeFilter.svelte";

  let { ds, statCtx, onselect } = $props();

  // ---- the filter model lives in ui.browse (persisted); null ranges mean "unset"
  const B = () => ui.browse;
  const DEFAULTS = {
    slots: [],
    classes: [],
    mods: [],
    stage: null,
    score: null,
    features: [],
    sources: [],
    types: [],
    sort: "value",
  };
  const reset = () => {
    ui.browse = { ...DEFAULTS, hidden: B().hidden ?? [] };
    ui.query = "";
  };
  const toggle = (key, v) => {
    const cur = B()[key];
    ui.browse = { ...B(), [key]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] };
  };
  // mod and source are long lists nobody starts with: they open on demand
  let collapsed = $state(new Set(["sources", "mods"]));
  // how many picks a group holds, so a collapsed group still says it is narrowing the results
  const ticked = (id) =>
    id === "stage" || id === "score"
      ? B()[id]
        ? 1
        : 0
      : id === "features"
        ? B().features.filter((t) => ICON[t]).length
        : id === "effects"
          ? B().features.filter((t) => !ICON[t] && !notEffects.has(t)).length
          : (B()[id]?.length ?? 0);
  const flip = (g) => {
    const n = new Set(collapsed);
    if (n.has(g)) n.delete(g);
    else n.add(g);
    collapsed = n;
  };

  const ICON = FEATURE_ICONS;

  // ---- every item, scored for the class and stage in view (the row shape the loadout uses)
  const progression = $derived(ds.stages[ui.stage]?.progression);
  const excludedMods = $derived(new Set(ui.excludedMods));
  const scored = $derived.by(() => {
    const out = [];
    for (const it of ds.items) {
      if (excludedMods.has(it.mod)) continue;
      if (it.slot === "weapon") {
        const d = weaponDps(it, statCtx);
        out.push({
          item: it,
          value: d.value,
          kind: d.kind,
          dps: d,
          parts: d.mode === "stealth" ? d.stealthParts : d.parts,
          mode: d.mode,
          eff: d.eff,
        });
      } else {
        const s = pieceScore(it, ui.cls, ds.aliases, { progression });
        out.push({ item: it, value: s.score, kind: "score", parts: s.parts, stealth: s.stealth });
      }
    }
    // the haystack the text filter reads, built once: every filter group re-runs `pass` over the
    // whole list, so joining and lowercasing per item per pass was most of a keystroke's cost
    for (const e of out) {
      e.traits = traitsOf(e);
      e.hay = [e.item.name, e.item.tooltip ?? "", e.item.setBonus ?? "", e.item.modName ?? "", ...e.traits]
        .join(" | ")
        .toLowerCase();
    }
    return out;
  });

  // ---- filters
  const stageMax = $derived(ds.stages.length - 1);
  const stageRange = $derived(B().stage ?? [0, ui.stage]);
  // the score slider is scaled to the gear actually in view, not to the endgame: a bound kept from
  // a later stage would otherwise hide every piece of gear here while weapons, which skip the score
  // filter, all stay — so clamp a stored range to what is on screen and drop one that matches nothing
  const scoreTop = $derived(
    Math.ceil(Math.max(1, ...scored.map((e) => (e.kind === "score" && passAllBut(e, "score") ? e.value : 0)))),
  );
  const scoreRange = $derived.by(() => {
    const r = B().score;
    if (!r) return [0, scoreTop];
    const lo = Math.min(r[0], scoreTop);
    const hi = Math.min(r[1], scoreTop);
    const fits =
      lo <= hi && scored.some((e) => e.kind === "score" && e.value >= lo && e.value <= hi && passAllBut(e, "score"));
    return fits ? [lo, hi] : [0, scoreTop];
  });
  const passStage = (it) =>
    it.stage === null || it.stage === undefined
      ? ui.unknownStage
      : it.stage >= stageRange[0] && it.stage <= stageRange[1];
  const terms = $derived(ui.query.trim().toLowerCase().split(/\s+/).filter(Boolean));
  const passText = (e) =>
    !terms.length ||
    terms.every((t) => (t.startsWith("-") ? t.length === 1 || !e.hay.includes(t.slice(1)) : e.hay.includes(t)));
  // each group's pass, so a group's counts can ignore its own selection
  const pass = {
    slots: (e) => !B().slots.length || B().slots.includes(e.item.slot),
    // armor and accessories carry no damage class, so they belong to every class: picking "melee"
    // narrows the weapons and leaves the gear alone. "no class (gear)" on its own is gear only.
    classes: (e) => !B().classes.length || (e.item.cls ? B().classes.includes(e.item.cls) : true),
    mods: (e) => !B().mods.length || B().mods.includes(e.item.mod),
    stage: (e) => passStage(e.item),
    score: (e) => e.kind !== "score" || (e.value >= scoreRange[0] && e.value <= scoreRange[1]),
    features: (e) => B().features.every((f) => e.traits.includes(f)),
    sources: (e) => !B().sources.length || B().sources.includes(e.item.stageSource?.kind ?? "unknown"),
    // weapon-only: how the weapon is graded (whip/minion/sentry/stealth/spam/arch). Non-weapons
    // pass through — a type filter is meaningless for armor, accessories and potions, and dropping
    // them instead put a `0` next to every other slot for as long as one type stayed ticked.
    types: (e) => !B().types.length || e.item.slot !== "weapon" || B().types.includes(e.mode ?? e.dps?.arch ?? "other"),
    text: passText,
  };
  const passAllBut = (e, skip) => Object.entries(pass).every(([k, f]) => k === skip || f(e));
  // a pin is a "keep this in front of me" mark, so it outranks the filter as well as the sort:
  // pinned items show whatever the filters say and sit above everything else
  const pinned = $derived(new Set(ui.pinned));
  const results = $derived.by(() => {
    const list = scored.filter((e) => pinned.has(e.item.id) || passAllBut(e, null));
    // weapons rank by DPS in the hundreds, gear by a score in the tens: rank each against the best
    // weapon or the best piece of gear among the matches, or one takes every row before the other
    // gets one. Weapons stay on one scale, so a per-hit summon still ranks against real DPS.
    let topW = 1;
    let topG = 1;
    for (const e of list)
      if (e.item.slot === "weapon") topW = Math.max(topW, e.value);
      else topG = Math.max(topG, e.value);
    const dir = B().sort === "name" || B().sort === "mod" ? 1 : -1;
    const val = (e) =>
      ({
        value: e.rel,
        name: e.item.name,
        stage: -(e.item.stage ?? 999),
        damage: e.item.damage ?? -1,
        defense: e.item.defense ?? -1,
        mod: e.item.modName,
      })[B().sort];
    return list
      .map((e) => ({ ...e, rel: Math.max(0, e.value) / (e.item.slot === "weapon" ? topW : topG) }))
      .sort((a, b) => {
        const pa = pinned.has(a.item.id);
        if (pa !== pinned.has(b.item.id)) return pa ? -1 : 1;
        const va = val(a);
        const vb = val(b);
        const c = typeof va === "string" ? va.localeCompare(vb) : va - vb;
        return c !== 0 ? c * dir : a.item.name.localeCompare(b.item.name);
      });
  });
  const countsFor = (key, of) => {
    const m = new Map();
    for (const e of scored)
      if (passAllBut(e, key)) {
        const k = of(e);
        m.set(k, (m.get(k) ?? 0) + 1);
      }
    return m;
  };
  const slotCounts = $derived(countsFor("slots", (e) => e.item.slot));
  const classCounts = $derived(countsFor("classes", (e) => e.item.cls ?? "none"));
  const modCounts = $derived(countsFor("mods", (e) => e.item.mod));
  const sourceCounts = $derived(countsFor("sources", (e) => e.item.stageSource?.kind ?? "unknown"));
  // weapons only: bucket by grading mode (or the arch when there is no mode). Non-weapons don't
  // land in the map so the group is naturally empty when the slot filter picks armor.
  const typeCounts = $derived.by(() => {
    const m = new Map();
    for (const e of scored)
      if (e.item.slot === "weapon" && passAllBut(e, "types")) {
        const k = e.mode ?? e.dps?.arch ?? "other";
        m.set(k, (m.get(k) ?? 0) + 1);
      }
    return m;
  });
  const traitCounts = $derived.by(() => {
    const m = new Map();
    for (const e of scored) if (passAllBut(e, "features")) for (const t of e.traits) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  });
  const featureCounts = $derived(traitCounts);
  // a ticked box has to stay on screen even when nothing left matches it — a search that drops a
  // filter's count to 0 used to remove the row, leaving no way to untick what was hiding the results
  const withTicked = (entries, ticked) => [
    ...entries,
    ...ticked.filter((k) => !entries.some(([e]) => e === k)).map((k) => [k, 0]),
  ];
  // what a piece actually gives the player ("crit chance", "life regen", "minion slot"), read off
  // the scored parts: the same `features` filter, minus the icon list and what the class filter covers
  const notEffects = $derived(
    new Set([...ds.classList, "classless", "other", "none", "spam", "full set", "mixed pieces"]),
  );
  const effectCounts = $derived(
    withTicked(
      [...traitCounts]
        .filter(([t]) => !ICON[t] && !notEffects.has(t))
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
      B().features.filter((t) => !ICON[t] && !notEffects.has(t)),
    ),
  );
  // best value per class, in one pass: called from the template, it was a full scan per class row
  const classBest = $derived.by(() => {
    const m = new Map();
    for (const e of scored)
      if (passAllBut(e, "classes")) {
        const k = e.item.cls ?? "none";
        m.set(k, Math.max(m.get(k) ?? -Infinity, e.value));
      }
    return m;
  });
  const active = $derived(
    B().slots.length ||
      B().classes.length ||
      B().mods.length ||
      B().stage ||
      B().score ||
      B().features.length ||
      B().sources.length ||
      B().types.length ||
      ui.query,
  );

  let shown = $state(30);
  $effect(() => {
    void [results];
    shown = 30;
  });

  // ---- quick-compare strip: the stages around the one in view, with what each adds
  let strip = $state(0); // offset from the current stage
  const newAt = $derived.by(() => {
    const m = new Map();
    for (const e of scored)
      if (e.item.stage !== null && e.item.stage !== undefined) m.set(e.item.stage, (m.get(e.item.stage) ?? 0) + 1);
    return m;
  });
  const stripStages = $derived.by(() => {
    const c = Math.min(stageMax - 3, Math.max(3, ui.stage + strip));
    return ds.stages.slice(Math.max(0, c - 3), c + 4);
  });
  const setStage = (i) => {
    ui.stage = i;
    strip = 0;
  };

  // ---- cards: which tab each open card shows
  let open = $state({}); // id → tab
  const tabOf = (id) => open[id] ?? null;
  const tabsOf = (it) =>
    it.slot === "weapon"
      ? [
          ["about", "Details"],
          ["stats", "Real DPS"],
          ["obtain", "Sources"],
        ]
      : [
          ["about", "Details"],
          ["score", "Score"],
          ["obtain", "Sources"],
          ["effects", "Effects"],
        ];
  const defaultTab = () => "about";
  // the item as the game states it: whatever of these the item actually has
  const cell = (label, value, hint = "", sub = "") =>
    value === undefined || value === null || value === "" ? null : { label, value: fmtStat(value), hint, sub };
  const statCells = (it, eff) => {
    return [
      cell(
        "Damage",
        eff?.damage ?? it.damage,
        it.dc
          ? `Counts as ${it.dc
              .replace(/(Damage)?(Class)?$/, "")
              .replace(/([a-z])([A-Z])/g, "$1 $2")
              .toLowerCase()} damage.`
          : "",
      ),
      it.useTime === undefined && it.useAnimation === undefined
        ? null
        : cell(
            "Use / anim",
            `${eff?.useTime ?? it.useTime ?? "–"}/${eff?.useAnimation ?? it.useAnimation ?? "–"}`,
            "Ticks between two uses, then ticks the animation takes, then the speed the game calls that.",
            fmtSpeed(eff?.useAnimation ?? it.useAnimation ?? it.useTime),
          ),
      cell("Crit", it.crit === undefined && !eff ? null : `${eff?.crit ?? it.crit ?? 0}%`),
      cell("Knockback", it.knockback),
      cell("Mana", it.mana),
      cell("Velocity", it.shootSpeed, "How fast the projectile leaves the weapon."),
      cell("Defense", it.defense),
      cell("Armor pen", it.armorPen, "Ignores this much of the target’s defense."),
      // cell("Rarity", it.rarityName),
    ].filter(Boolean);
  };
  const setTab = (id, t) => {
    open = { ...open, [id]: open[id] === t ? null : t };
  };

  // ---- attack graphs: which of a weapon's loops each open row draws, and what the roomy window is
  // showing. A loop the weapon is not scored in is priced by `loopPhases`.
  let loops = $state({}); // id → the loop name, out of `loopsOf`
  let win = $state({ phases: [], total: null, mode: null, title: "" });
  /**
   * What an open row's Real DPS panel shows: the loop the weapon is scored in unless the row was
   * switched over. `parts` travels with the graph — a stealth picture over spam arithmetic is two
   * different weapons on one screen, so the switch has to move the whole panel or none of it.
   *
   * The button cycles every loop `loopsOf` finds rather than flipping a pair: a weapon can hold
   * three at once (Malachite's two mouse buttons and its stealth strike), and a toggle between the
   * first two left the third with no way to reach it from here.
   */
  const loopView = (it, dps) => {
    const all = loopsOf(dps);
    const cur = all.find((l) => l.loop === loops[it.id]) ?? all[0] ?? null;
    const next = all.length > 1 ? all[(all.indexOf(cur) + 1) % all.length] : null;
    const loop = cur?.loop ?? null;
    const mode = loop ?? dps?.mode;
    return {
      all,
      cur,
      next,
      loop,
      mode,
      phases: loop && !cur.scored ? loopPhases(dps.phases, loop) : (dps?.phases ?? []),
      total: cur ? cur.total : dps?.value,
      // the loop's own factors where the model kept them; a loop without any (charge) falls back to
      // the weapon's, which the graph beside them then qualifies
      parts: cur?.parts ?? (mode === "stealth" ? dps?.stealthParts : dps?.parts) ?? [],
      title: `How ${it.name} attacks${loop ? ` — the ${loopLabel(cur)}${cur.scored ? ", the one it is scored in" : ", the one it is not scored in"}` : ""}`,
    };
  };

  const r1 = (v) => Math.round(v * 10) / 10;
  const short = (label) => label.replace(/^(?:The |Post )/, "").replace(/ \/ .*/, "");
  const obtain = (it) => {
    const tree = craftTree(ds, it.id);
    return { tree, chain: tree ? gatingChain(tree) : [], gate: tree ? gateText(tree, ds) : "" };
  };
  const chainOf = (it) => (it.slot === "weapon" ? effectiveStats(it, statCtx).chain : []);
  // the table's optional columns, in the order they appear. `hidden` in `ui.browse` folds any of
  // them away; Item and DPS are not listed because they are what the row is for.
  const COLUMNS = [
    { key: "mod", label: "Mod" },
    { key: "slot", label: "Slot" },
    { key: "class", label: "Class" },
    { key: "type", label: "Type" },
    { key: "stage", label: "Obtainable" },
    { key: "damage", label: "Dmg" },
    { key: "use", label: "Use" },
    { key: "crit", label: "Crit" },
    { key: "defense", label: "Def" },
    { key: "features", label: "Features" },
  ];
  const show = (k) => !(B().hidden ?? []).includes(k);
  const toggleCol = (k) => toggle("hidden", k);
  const COLS = $derived(2 + COLUMNS.filter((c) => show(c.key)).length);
  const sortBy = (k) => (ui.browse = { ...B(), sort: k });
  const arrow = (k) => (B().sort === k ? (k === "name" || k === "mod" ? " ↑" : " ↓") : "");
  const accent = $derived(accentOf(ui.cls));
  // the slider handles are the comparison they stand for, stroked in the accent — an SVG in a
  // data URI is its own document, so the colour has to be baked in rather than inherited
  const chevron = (d) => {
    const stroke = encodeURIComponent(accent.startsWith("#") ? accent : "#2f7d4f");
    return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='${stroke}' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='${d}'/%3E%3C/svg%3E")`;
  };
  const chevrons = $derived(`--chev-lo:${chevron("M9 4l8 8-8 8")}; --chev-hi:${chevron("M15 4l-8 8 8 8")}`);
</script>

{#snippet group(id, title, body)}
  <div class="border-b border-line">
    <button
      type="button"
      class="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-ink2 hover:text-green"
      onclick={() => flip(id)}
      aria-expanded={!collapsed.has(id)}
    >
      <span class="flex items-center gap-1.5"
        >{title}{#if ticked(id)}<span class="lab-tag" style="border-color:{accent}; color:{accent}">{ticked(id)}</span
          >{/if}</span
      ><span class="text-dim transition-transform duration-200" class:rotate-180={!collapsed.has(id)}>⌄</span>
    </button>
    {#if !collapsed.has(id)}<div class="px-3 pb-3" transition:slide={{ duration: 180, easing: cubicOut }}>
        {@render body()}
      </div>{/if}
  </div>
{/snippet}

{#snippet check(on, label, meta, onclick, Icon)}
  <label class="flex cursor-pointer items-center gap-2 py-[3px] text-[12.5px]">
    <input type="checkbox" checked={on} onchange={onclick} style="accent-color:{accent}" />
    {#if Icon}<span class="flex w-5 shrink-0 justify-center text-dim" title={label}
        ><Icon size={15} strokeWidth={1.75} absoluteStrokeWidth aria-hidden="true" /></span
      >{/if}
    <span class="min-w-0 flex-1 truncate text-ink2">{label}</span>
    <span class="num text-[11px] text-dim">{meta}</span>
  </label>
{/snippet}

<section class="lab-panel overflow-hidden" style="--accent:{accent}">
  <header class="lab-head">
    <h2>Browse items</h2>
    <span class="lab-meta"
      ><span class="num font-semibold text-ink">{results.length.toLocaleString()}</span> of {scored.length.toLocaleString()}
      · scored for <span class="font-semibold" style="color:{accent}">{CLASS_LABELS[ui.cls]}</span> at
      <span class="font-semibold text-ink">{ds.stages[ui.stage]?.label}</span></span
    >
  </header>

  <div class="grid md:grid-cols-[250px_minmax(0,1fr)]">
    <!-- ================= filter column ================= -->
    <aside class="border-r border-line bg-panel2/40 text-[12.5px]">
      <!-- context: what the scores mean -->
      <div class="m-3 border border-line bg-panel">
        {#each [["class", accent, "Scoring for", CLASS_LABELS[ui.cls], true], ["stage", "var(--color-warn)", "Gamestage", ds.stages[ui.stage]?.label ?? "?", false], ["pool", "var(--color-info)", "Gear pool", ui.source === "owned" ? "only what I own" : "everything obtainable", false]] as [k, color, caption, label, isActive] (k)}
          <div
            class="flex items-center gap-2.5 border-b border-line px-2.5 py-1.5 last:border-0"
            class:bg-green-soft={isActive}
            style={isActive ? `background:color-mix(in srgb, ${accent} 10%, transparent)` : ""}
          >
            <span class="h-2.5 w-2.5 shrink-0 rounded-full" style="background:{color}"></span>
            <span class="min-w-0"
              ><span class="block text-[10px] uppercase tracking-[0.1em] text-dim">{caption}</span><span
                class="block truncate font-medium text-ink">{label}</span
              ></span
            >
          </div>
        {/each}
      </div>
      <!-- sort -->
      <div class="mx-3 mb-3">
        <label class="block">
          <span class="block text-[10px] uppercase tracking-[0.1em] text-dim">Sort by</span>
          <select
            class="lab-input mt-0.5 w-full"
            value={B().sort}
            onchange={(e) => (ui.browse = { ...B(), sort: e.currentTarget.value })}
          >
            <option value="value">Score / DPS</option>
            <option value="name">Name</option>
            <option value="stage">Gamestage</option>
            <option value="damage">Damage</option>
            <option value="defense">Defense</option>
            <option value="mod">Mod</option>
          </select>
        </label>
      </div>
      <!-- filter header -->
      <div class="flex items-center justify-between border-b border-t border-line px-3 py-2">
        <span class="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink">Filter</span>
        <button
          type="button"
          class="cursor-pointer text-[12px] underline decoration-line underline-offset-2 hover:text-green"
          class:text-dim={!active}
          onclick={reset}>Reset</button
        >
      </div>
      <div class="px-3 py-2">
        <input class="lab-input w-full" placeholder="Name, tooltip or trait… (-word excludes)" bind:value={ui.query} />
      </div>

      {#snippet slotsBody()}
        {#each Object.entries(SLOT_LABELS) as [k, v]}
          {@render check(B().slots.includes(k), v, slotCounts.get(k) ?? 0, () => toggle("slots", k), SLOT_ICONS[k])}
        {/each}
      {/snippet}
      {@render group("slots", "Slot", slotsBody)}

      {#snippet classBody()}
        {#each [...ds.classList, "classless", "other", "none"] as c}
          {#if classCounts.get(c) || B().classes.includes(c)}
            {@render check(
              B().classes.includes(c),
              c === "none" ? "no class (gear)" : (CLASS_LABELS[c] ?? c),
              `${classCounts.get(c) ?? 0} · best ${fmtNum(classBest.get(c) ?? 0)}`,
              () => toggle("classes", c),
              CLASS_ICONS[c],
            )}
          {/if}
        {/each}
      {/snippet}
      {@render group("classes", "Class", classBody)}

      {#snippet typeBody()}
        {#each withTicked( [...typeCounts.entries()].sort((a, b) => b[1] - a[1]), B().types, ) as [k, n] (k)}
          {@render check(B().types.includes(k), k, n, () => toggle("types", k))}
        {/each}
        {#if !typeCounts.size && !B().types.length}<p class="m-0 text-[11px] text-dim">
            No weapons pass the current filters.
          </p>{/if}
      {/snippet}
      {@render group("types", "Weapon type", typeBody)}

      {#snippet stageBody()}
        {#snippet stageBossIcon(i)}<BossIcon {ds} stage={i} size={12} />{/snippet}
        <RangeFilter
          lo={stageRange[0]}
          hi={stageRange[1]}
          min={0}
          max={stageMax}
          format={(i) => short(ds.stages[i]?.label ?? String(i))}
          icon={stageBossIcon}
          {accent}
          {chevrons}
          oncommit={(lo, hi) => (ui.browse = { ...B(), stage: [lo, hi] })}
        />
        <p class="m-0 mt-1 text-[11px] text-dim">
          {B().stage ? "A window of gamestages." : "Everything up to the stage in view."}{#if B().stage}
            <button
              type="button"
              class="cursor-pointer underline hover:text-green"
              onclick={() => (ui.browse = { ...B(), stage: null })}>follow the view</button
            >{/if}
        </p>
      {/snippet}
      {@render group("stage", "Gamestage", stageBody)}

      {#snippet scoreBody()}
        <RangeFilter
          lo={scoreRange[0]}
          hi={scoreRange[1]}
          min={0}
          max={scoreTop}
          format={fmtNum}
          {accent}
          {chevrons}
          oncommit={(lo, hi) => (ui.browse = { ...B(), score: [lo, hi] })}
        />
        <p class="m-0 mt-1 text-[11px] text-dim">Armor and accessories; weapons rank by DPS.</p>
      {/snippet}
      {@render group("score", "Score", scoreBody)}

      {#snippet featureBody()}
        {#each FEATURES as t}
          {#if featureCounts.get(t) || B().features.includes(t)}
            {@render check(
              B().features.includes(t),
              t,
              featureCounts.get(t) ?? 0,
              () => toggle("features", t),
              ICON[t],
            )}
          {/if}
        {/each}
      {/snippet}
      {@render group("features", "Features", featureBody)}

      {#snippet effectBody()}
        {#each effectCounts as [t, n] (t)}
          {@render check(B().features.includes(t), t, n, () => toggle("features", t), EFFECT_ICONS[t])}
        {/each}
        {#if !effectCounts.length}<p class="m-0 text-[11px] text-dim">Nothing left to narrow by.</p>{/if}
      {/snippet}
      {@render group("effects", "Effects", effectBody)}

      {#snippet sourceBody()}
        {#each withTicked( [...sourceCounts.entries()].sort((a, b) => b[1] - a[1]), B().sources, ) as [k, n]}
          {@render check(
            B().sources.includes(k),
            SOURCE_HINT[k] ? k : k,
            n,
            () => toggle("sources", k),
            SOURCE_ICONS[k],
          )}
        {/each}
      {/snippet}
      {@render group("sources", "Source", sourceBody)}

      {#snippet modBody()}
        {#each ds.mods.filter((m) => m.equipment > 0) as m}
          {#if modCounts.get(m.id) || B().mods.includes(m.id)}
            {@render check(B().mods.includes(m.id), m.name, modCounts.get(m.id) ?? 0, () => toggle("mods", m.id))}
          {/if}
        {/each}
      {/snippet}
      {@render group("mods", "Mod", modBody)}
    </aside>

    <!-- ================= results ================= -->
    <div class="min-w-0">
      <!-- quick compare: neighbouring gamestages -->
      <div class="flex items-center gap-1 border-b border-line px-3 py-2">
        <button
          type="button"
          class="lab-btn px-2 py-0.5"
          onclick={() => (strip -= 3)}
          disabled={ui.stage + strip <= 3}
          aria-label="Earlier stages">‹</button
        >
        <!-- container query so the tiers respond to the strip's own width, not the viewport
             (the filter aside changes how much room this actually has). -->
        <div class="@container flex min-w-0 flex-1 gap-1 overflow-hidden">
          {#each stripStages as s, i (s.index)}
            <!-- 2 by default (current stage + next). 3 once the row can hold it, 5 when it can, 7 when it can. -->
            {@const vis =
              i === 3 || i === 4
                ? "flex"
                : i === 2
                  ? "hidden @lg:flex"
                  : i === 1 || i === 5
                    ? "hidden @3xl:flex"
                    : "hidden @5xl:flex"}
            <button
              type="button"
              class="{vis} min-w-0 flex-1 cursor-pointer items-center gap-1.5 border border-line px-2 py-1 text-left transition-colors hover:border-line-strong"
              class:bg-panel={s.index !== ui.stage}
              style={s.index === ui.stage
                ? `background:color-mix(in srgb, ${accent} 12%, #fff); border-color:${accent}`
                : ""}
              onclick={() => setStage(s.index)}
              title={s.label}
            >
              <BossIcon {ds} stage={s.index} size={20} />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-[11.5px] font-medium text-ink">{short(s.label)}</span>
                <span class="num block text-[10.5px] text-dim">+{newAt.get(s.index) ?? 0} items</span>
              </span>
            </button>
          {/each}
        </div>
        <button
          type="button"
          class="lab-btn px-2 py-0.5"
          onclick={() => (strip += 3)}
          disabled={ui.stage + strip >= stageMax - 3}
          aria-label="Later stages">›</button
        >
        <button
          type="button"
          class="lab-btn ml-1 px-2 py-0.5"
          popovertarget="stagepicker"
          title="Jump to any gamestage in the run">All stages…</button
        >
        <button
          type="button"
          class="lab-btn px-2 py-0.5"
          popovertarget="columns"
          title="Choose which columns the table shows">Columns</button
        >
        <div id="columns" popover="auto" class="lab-pop col" style="--w:210px">
          <div class="lab-rule start mb-2">Columns</div>
          {#each COLUMNS as c (c.key)}
            {@render check(show(c.key), c.label, "", () => toggleCol(c.key))}
          {/each}
        </div>
        <div id="stagepicker" popover="auto" class="lab-pop col" style="--w:560px">
          <div class="lab-rule start mb-2">Gamestage</div>
          <div class="grid gap-px sm:grid-cols-2">
            {#each ds.stages as s (s.index)}
              <button
                type="button"
                class="cursor-pointer px-2 py-1 text-left text-[12px] hover:bg-green-soft"
                class:font-semibold={s.index === ui.stage}
                onclick={() => setStage(s.index)}
                >{s.index} · {s.label} <span class="num text-dim">+{newAt.get(s.index) ?? 0}</span></button
              >
            {/each}
          </div>
        </div>
      </div>

      {#if !results.length}
        <p class="px-4 py-10 text-center text-[12.5px] text-dim">
          Nothing matches. <button type="button" class="cursor-pointer underline hover:text-green" onclick={reset}
            >Reset the filter</button
          >.
        </p>
      {/if}
      <div class="overflow-x-auto">
        <table class="lab-table lab-table-lg min-w-[940px]">
          <thead>
            <tr>
              <th class="sortable max-w-[220px]" class:sorted={B().sort === "name"} onclick={() => sortBy("name")}
                >Item{arrow("name")}</th
              >
              {#if show("mod")}<th class="sortable" class:sorted={B().sort === "mod"} onclick={() => sortBy("mod")}
                  >Mod{arrow("mod")}</th
                >{/if}
              {#if show("slot")}<th>Slot</th>{/if}
              {#if show("class")}<th>Class</th>{/if}
              {#if show("type")}<th>Type</th>{/if}
              {#if show("stage")}<th
                  class="sortable max-w-[160px]"
                  class:sorted={B().sort === "stage"}
                  onclick={() => sortBy("stage")}>Obtainable{arrow("stage")}</th
                >{/if}
              {#if show("damage")}<th
                  class="sortable text-right"
                  class:sorted={B().sort === "damage"}
                  onclick={() => sortBy("damage")}>Dmg{arrow("damage")}</th
                >{/if}
              {#if show("use")}<th class="text-right">Use</th>{/if}
              {#if show("crit")}<th class="text-right">Crit</th>{/if}
              {#if show("defense")}<th
                  class="sortable text-right"
                  class:sorted={B().sort === "defense"}
                  onclick={() => sortBy("defense")}>Def{arrow("defense")}</th
                >{/if}
              {#if show("features")}<th class="w-[74px]">Features</th>{/if}
              <th
                class="sortable text-right"
                class:sorted={B().sort === "value"}
                onclick={() => sortBy("value")}
                title="Weapons rank by their real DPS, everything else by its score for this class"
                >DPS / score{arrow("value")}</th
              >
            </tr>
          </thead>
          {#each results.slice(0, shown) as e (e.item.id)}
            {@const it = e.item}
            {@const tab = tabOf(it.id)}
            {@const era = eraOf(ds.stages[it.stage ?? 0])}
            <tbody>
              <tr
                class="row"
                class:open={!!tab}
                class:pin={pinned.has(it.id)}
                onclick={() => setTab(it.id, tab ? tab : defaultTab(it))}
              >
                <td class="max-w-[220px]">
                  <div class="flex items-center gap-2">
                    <span class="text-[10px] text-dim transition-transform" class:rotate-180={tab}>⌄</span>
                    <WikiIcon item={it} size={30} />
                    <span class="min-w-0 flex-1 truncate text-[14.5px] text-ink">{it.name}</span>
                    <span class="flex shrink-0 items-center gap-1">
                      {#if e.stealth && e.mode !== "stealth"}<span class="lab-tag plum">stealth</span>{/if}
                      {#if MODE_TAG[e.mode]}<span class="lab-tag {MODE_TAG[e.mode].color}" title={MODE_TAG[e.mode].tip}
                          >{e.mode}</span
                        >{/if}
                      {#if it.id in ui.owned}<span class="lab-tag green">yours</span>{/if}
                      {#if ui.pinned.includes(it.id)}<span class="lab-tag info">pinned</span>{/if}
                      {#if ui.excluded.includes(it.id)}<span class="lab-tag bad">excluded</span>{/if}
                      {#if it.changes?.length}<span class="lab-tag warn" title="Another mod rebalances this item"
                          >reb</span
                        >{/if}
                    </span>
                  </div>
                </td>
                {#if show("mod")}<td class="whitespace-nowrap text-[12px] text-dim">{it.modName}</td>{/if}
                {#if show("slot")}<td><span class="lab-tag">{SLOT_LABELS[it.slot] ?? it.slot}</span></td>{/if}
                {#if show("class")}<td
                    class="whitespace-nowrap text-[12px] font-medium"
                    style={it.cls ? `color:${accentOf(it.cls)}` : ""}
                    >{it.cls ? (CLASS_LABELS[it.cls] ?? it.cls) : "–"}</td
                  >{/if}
                {#if show("type")}<td class="whitespace-nowrap text-[12px] text-dim"
                    >{#if it.arch}<span class="has-tip cursor-help" data-tip={ARCH_HINT[it.arch] ?? ""}
                        >{ARCH_LABELS[it.arch] ?? it.arch}</span
                      >{:else}–{/if}</td
                  >{/if}
                {#if show("stage")}<td class="max-w-[160px] whitespace-nowrap text-[12px]">
                    <div class="flex items-center gap-1.5">
                      <BossIcon {ds} stage={it.stage} size={16} />
                      <span
                        class="min-w-0 flex-1 truncate"
                        style="color:{era.color}"
                        title="Obtainable at {it.stageLabel}, which is {era.label}">{short(it.stageLabel)}</span
                      >
                      <span
                        class="lab-tag shrink-0 {SOURCE_TONE[it.stageSource?.kind] ?? ''}"
                        title={SOURCE_HINT[it.stageSource?.kind] ?? it.stageSource?.kind}
                        >{it.stageSource?.kind ?? "?"}</span
                      >
                    </div>
                  </td>{/if}
                {#if show("damage")}<td class="num text-right font-semibold"
                    >{it.slot === "weapon" ? (e.eff?.damage ?? it.damage ?? "–") : "–"}</td
                  >{/if}
                {#if show("use")}<td class="num text-right text-dim"
                    >{it.slot === "weapon"
                      ? Math.round(it.cls === "melee" ? e.eff?.useAnimation : e.eff?.useTime) || "–"
                      : "–"}</td
                  >{/if}
                {#if show("crit")}<td class="num text-right text-dim"
                    >{it.slot === "weapon" ? `${e.eff?.crit ?? it.crit ?? 0}%` : "–"}</td
                  >{/if}
                {#if show("defense")}<td class="num text-right" class:font-semibold={it.slot !== "weapon"}
                    >{it.defense ?? "–"}</td
                  >{/if}
                {#if show("features")}<td class="w-[74px] whitespace-nowrap text-[12.5px] text-dim">
                    {#each e.traits.filter((t) => ICON[t]).slice(0, 4) as t}<span
                        class="has-tip mr-1 inline-block align-middle"
                        data-tip={t}><FeatureIcon name={t} /></span
                      >{/each}
                  </td>{/if}
                <td>
                  <div class="flex items-center justify-end gap-2">
                    <span class="bar w-14 shrink-0" title="How this compares with the best item of its kind"
                      ><i style="width:{Math.round(e.rel * 100)}%"></i></span
                    >
                    <span
                      class="num w-[52px] text-right text-[14px] font-bold"
                      style="color:{accent}"
                      title={fmtFull(e.value)}>{fmtNum(e.value)}</span
                    >
                  </div>
                </td>
              </tr>
              <!-- expanded panel: a timeline on the left, a supporting visual on the right -->
              {#if tab}
                {@const wiki = wikiUrl(it)}
                <tr class="expanded"
                  ><td colspan={COLS} class="p-0">
                    <div
                      class="m-2 border border-line-strong bg-panel"
                      style="box-shadow: var(--shadow-pop)"
                      transition:slide={{ duration: 170, easing: cubicOut }}
                    >
                      <div
                        class="flex flex-wrap items-center gap-x-3 border-b border-line bg-panel2/50 px-3 text-[12px]"
                      >
                        {#each tabsOf(it) as [t, label]}
                          <button
                            type="button"
                            class="cursor-pointer border-b-2 py-1.5 transition-colors hover:text-green"
                            class:border-transparent={tab !== t}
                            class:text-dim={tab !== t}
                            style={tab === t ? `border-color:${accent}; color:${accent}` : ""}
                            onclick={() => setTab(it.id, t)}>{label}</button
                          >
                        {/each}
                        <span class="ml-auto flex items-center gap-1 py-1">
                          <button
                            type="button"
                            class="lab-chip py-0.5"
                            aria-pressed={it.id in ui.owned}
                            title="Mark this as yours so the gear pool can build loadouts from it"
                            onclick={() => setOwned(it.id, !(it.id in ui.owned))}>own</button
                          >
                          <button
                            type="button"
                            class="lab-chip py-0.5"
                            aria-pressed={ui.pinned.includes(it.id)}
                            title="Keep this at the top of the list, whatever the filter says, and always in the loadout"
                            onclick={() => toggleIn("pinned", it.id)}>pin</button
                          >
                          <button
                            type="button"
                            class="lab-chip py-0.5"
                            aria-pressed={ui.excluded.includes(it.id)}
                            title="Never suggest this item"
                            onclick={() => toggleIn("excluded", it.id)}>exclude</button
                          >
                          <span class="mx-1 h-4 w-px bg-line"></span>
                          {#if wiki}<a
                              class="lab-btn px-2 py-0.5"
                              href={wiki}
                              target="_blank"
                              rel="noreferrer"
                              title="Read about this item on {wikiHost(wiki)}">Wiki ↗</a
                            >{/if}
                          <button
                            type="button"
                            class="lab-btn px-2.5 py-0.5 font-semibold"
                            style="border-color:{accent}; color:{accent}"
                            title="Open the full panel for this item"
                            onclick={() => onselect(it.id)}>Full view ↗</button
                          >
                          <button
                            type="button"
                            class="lab-btn px-2 py-0.5"
                            title="Close this row"
                            onclick={() => setTab(it.id, null)}>✕</button
                          >
                        </span>
                      </div>
                      <div class="lab-detail">
                        {#if tab === "about"}
                          <div>
                            <div class="lab-rule start mb-2">Tooltip</div>
                            <ItemTooltip item={it} stats={e.eff} />
                          </div>
                          <div>
                            <div class="lab-rule start mb-2">Stats</div>
                            <!-- grid grid-cols-[repeat(auto-fit,minmax(84px,1fr))] -->
                            <div
                              class="flex justify-between *:flex-1 gap-px border border-line bg-line"
                            >
                              {#each statCells(it, e.eff) as c}
                                <div class="bg-panel px-2 py-1.5" title={c.hint}>
                                  <div class="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-dim">
                                    {c.label}
                                  </div>
                                  <div class="num truncate text-[14px] font-semibold leading-tight text-ink">
                                    {c.value}{#if c.sub}<span class="text-[10px] font-normal text-dim">
                                        &nbsp;({c.sub})</span
                                      >{/if}
                                  </div>
                                </div>
                              {/each}
                            </div>
                            <dl class="m-0 mt-3 grid grid-cols-[86px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px]">
                              <dt class="text-dim">Obtainable</dt>
                              <dd class="m-0">
                                {it.stageLabel}
                                <span
                                  class="lab-tag {SOURCE_TONE[it.stageSource?.kind] ?? ''}"
                                  title={SOURCE_HINT[it.stageSource?.kind] ?? ""}>{it.stageSource?.kind ?? "?"}</span
                                >
                              </dd>
                              <dt class="text-dim">Slot</dt>
                              <dd class="m-0">
                                {SLOT_LABELS[it.slot] ?? it.slot}{it.cls ? " for " : ""}{#if it.cls}<span
                                    class="font-medium"
                                    style="color:{accentOf(it.cls)}">{CLASS_LABELS[it.cls] ?? it.cls}</span
                                  >{/if}
                              </dd>
                              {#if it.arch}
                                <dt class="text-dim">Type</dt>
                                <dd class="m-0">
                                  {ARCH_LABELS[it.arch] ?? it.arch}{#if ARCH_HINT[it.arch]}<span class="block text-dim"
                                      >{ARCH_HINT[it.arch]}</span
                                    >{/if}
                                </dd>
                              {/if}
                              <dt class="text-dim">{e.kind === "score" ? "Score" : "Real DPS"}</dt>
                              <dd class="m-0">
                                <span class="num font-semibold" style="color:{accent}">{fmtNum(e.value)}</span>
                                <span class="text-dim">for {CLASS_LABELS[ui.cls]} at {ds.stages[ui.stage]?.label}</span>
                              </dd>
                              {#if e.traits.length}
                                <dt class="text-dim">Traits</dt>
                                <dd class="m-0 flex flex-wrap gap-1">
                                  {#each e.traits as t}<span class="lab-tag">{t}</span>{/each}
                                </dd>
                              {/if}
                            </dl>
                            {#if it.placeholders}
                              <p class="m-0 mt-2 text-[11.5px] text-warn">
                                Numbers the tooltip writes as {"{0}"} are filled in while the game runs; the score uses the
                                values read from the mod's code instead.
                              </p>
                            {/if}
                          </div>
                        {:else if tab === "score"}
                          <div>
                            <div class="lab-rule start mb-2">Breakdown</div>
                            <ol class="lab-timeline">
                              {#each e.parts as p}
                                <li>
                                  <span class="when num" class:text-bad={p.value < 0}
                                    >{p.value > 0 ? "+" : ""}{fmtNum(p.value)}</span
                                  ><span
                                    class="what has-tip"
                                    data-tip={factorTip(p)}
                                    style="color:{FACTORS[factorOf(p)].color}">{p.label}</span
                                  >{#if p.detail}<span class="how">{p.detail}</span>{/if}
                                </li>
                              {/each}
                              {#if !e.parts.length}<li>
                                  <span class="when">0</span><span class="what text-dim"
                                    >Nothing {CLASS_LABELS[ui.cls]} benefits from.</span
                                  >
                                </li>{/if}
                            </ol>
                          </div>
                          <div>
                            <div class="lab-rule start mb-2">Score</div>
                            <div class="flex flex-col gap-1">
                              {#each e.parts as p}
                                <div class="grid grid-cols-[minmax(0,1fr)_120px_40px] items-center gap-2 text-[11.5px]">
                                  <span
                                    class="truncate has-tip"
                                    data-tip={factorTip(p)}
                                    style="color:{FACTORS[factorOf(p)].color}">{p.label}</span
                                  >
                                  <div class="bar">
                                    <i
                                      style="width:{Math.min(
                                        100,
                                        Math.round(
                                          (Math.abs(p.value) / Math.max(1, ...e.parts.map((q) => Math.abs(q.value)))) *
                                            100,
                                        ),
                                      )}%"
                                      class:opacity-40={p.value < 0}
                                    ></i>
                                  </div>
                                  <span class="num text-right" class:text-bad={p.value < 0}>{fmtNum(p.value)}</span>
                                </div>
                              {/each}
                            </div>
                            <div class="mt-2 text-[12px]">
                              <span class="text-dim">total</span>
                              <span class="num font-semibold" style="color:{accent}" title={fmtFull(e.value)}
                                >{fmtNum(e.value)}</span
                              >
                            </div>
                            {#if it.condStats?.length}<p class="m-0 mt-2 text-[11.5px] text-dim">
                                Conditional in the text: {it.condStats.join(", ")}, so counted at half.
                              </p>{/if}
                          </div>
                        {:else if tab === "stats"}
                          {@const v = loopView(it, e.dps)}
                          <div>
                            <div class="lab-rule start mb-2">Damage chain</div>
                            <ol class="lab-timeline">
                              {#each chainOf(it) as c}
                                <li>
                                  <span class="when num">{c.damage ?? ""}</span><span class="what">{c.label}</span
                                  >{#if c.crit !== undefined}<span class="how num"
                                      >crit {c.crit}% · use {c.useTime}</span
                                    >{/if}
                                </li>
                              {/each}
                            </ol>
                            <p class="m-0 mt-2 text-[11.5px] text-dim">
                              Measured as a {e.dps?.arch ?? "shot"} weapon{e.dps?.distance
                                ? ` from ${Math.round(e.dps.distance)} px away`
                                : ""}{e.dps?.boss?.name
                                ? ` against ${e.dps.boss.name}, a ${e.dps.boss.w}×${e.dps.boss.h} px target with ${e.dps.boss.defense} defense${e.dps.boss.worm ? " made of segments" : e.dps.boss.parts > 1 ? ` in ${e.dps.boss.parts} parts` : ""}`
                                : ""}.
                            </p>
                            <div>
                              <div class="lab-rule start mb-2 mt-3">Attack</div>
                              <ol class="lab-timeline">
                                {#if it.useAmmo}<li>
                                    <span class="when">ammo</span><span class="what"
                                      >{ds.ammoKinds[it.useAmmo] ?? it.useAmmo}</span
                                    >
                                  </li>{/if}
                                {#if it.shoot}
                                  {@const p = ds.projectiles[it.shoot]?.unmined ? null : ds.projectiles[it.shoot]}
                                  <li>
                                    <span class="when" title={it.shoot}>{projName(it.shoot, ds)}</span><span
                                      class="what">projectile</span
                                    >{#if p}<span class="how"
                                        >{p.pen === -1
                                          ? "infinite pierce"
                                          : p.pen > 1
                                            ? `pierces ${p.pen}`
                                            : "no pierce"}{p.homing ? ", homing" : ""}{p.gravity
                                          ? ", gravity"
                                          : ""}{p.walls ? ", through walls" : ""}{p.debuffs?.length
                                          ? `, inflicts ${p.debuffs.length} debuff${p.debuffs.length > 1 ? "s" : ""}`
                                          : ""}</span
                                      >{/if}
                                  </li>
                                {/if}
                                {#if !it.shoot && !it.fire?.calls?.length && !it.useAmmo}<li>
                                    <span class="when">–</span><span class="what text-dim">Contact only.</span>
                                  </li>{/if}
                              </ol>
                            </div>
                          </div>
                          <div>
                            <div class="mb-2 flex items-baseline gap-2">
                              <div class="lab-rule start grow">
                                DPS{v.cur && v.all.length > 1 ? ` — ${loopLabel(v.cur)}` : ""}
                              </div>
                              <!-- the two loops are one switch on the whole panel: the graph, the arithmetic
                           and the total. Drawing a stealth picture over spam numbers is two weapons
                           on one screen, which is what it used to be when this only moved the graph. -->
                              {#if v.next}
                                <button
                                  type="button"
                                  class="lab-btn shrink-0 px-2 py-0.5 text-[11.5px]"
                                  aria-pressed={!v.cur.scored}
                                  onclick={() => (loops = { ...loops, [it.id]: v.next.loop })}
                                  title="Read the whole panel in the weapon's next attack loop{v.all.length > 2
                                    ? ` (${v.all.length} of them: ${v.all.map(loopLabel).join(', ')})`
                                    : ''}">⇄ {loopLabel(v.next)} {fmtNum(v.next.total)}/s</button
                                >
                              {/if}
                            </div>
                            <!-- the phases that produce the number below, each with its own rate, gates and share -->
                            {#if v.phases.length}
                              <div class="mb-2 flex items-start gap-2 border border-line bg-panel2/40 p-2">
                                <div class="min-w-0 flex-1 overflow-x-auto">
                                  <PhaseGraph {ds} phases={v.phases} total={v.total} mode={v.mode} />
                                </div>
                                <span class="flex shrink-0 flex-col gap-1">
                                  <button
                                    type="button"
                                    class="lab-btn px-2 py-0.5 text-[11.5px]"
                                    popovertarget="browserphases"
                                    onclick={() => (win = v)}
                                    title="Open the attack graph in a bigger view">⤢</button
                                  >
                                </span>
                              </div>
                            {/if}
                            <div class="lab-calc">
                              {#each v.parts as p}
                                <div class="row">
                                  <span
                                    class="lbl has-tip"
                                    data-tip={factorTip(p, true)}
                                    style="color:{FACTORS[factorOf(p, true)].color}">{p.label}</span
                                  ><i class="lead"></i><span class="val num" style="color:{SIGN_COLOR[signOf(p, true)]}"
                                    >{fmtPart(p)}</span
                                  >
                                </div>
                              {/each}
                              <div class="row total">
                                <span class="lbl">per second</span><i class="lead"></i><span
                                  class="val num"
                                  style="color:{accent}"
                                  title={fmtFull(v.total)}>{fmtNum(v.total)}</span
                                >
                              </div>
                            </div>
                            {#if v.next}<p class="m-0 mt-1 text-[11.5px] text-dim">
                                {v.all.map((l) => `${loopLabel(l)} ${r1(l.total)}/s`).join(", ")}: you use one at a
                                time, so the weapon is worth its best loop rather than their sum, and that loop names
                                the grade{v.cur.scored ? "" : `, so the row still ranks on ${loopLabel(v.all[0])}`}.
                              </p>{/if}
                          </div>
                        {:else if tab === "obtain"}
                          {@const o = obtain(it)}
                          <div>
                            <div class="lab-rule start mb-2">Route</div>
                            <ol class="lab-timeline">
                              <li>
                                <span class="when">{it.stageLabel}</span><span class="what"
                                  >Obtainable <span class="lab-tag {SOURCE_TONE[it.stageSource?.kind] ?? ''}"
                                    >{it.stageSource?.kind ?? "?"}</span
                                  ></span
                                >{#if o.gate}<span class="how">{o.gate}</span>{/if}
                              </li>
                              {#each o.tree?.drops ?? [] as s}
                                <li>
                                  <span class="when"
                                    ><span class="lab-tag {SOURCE_TONE[s.kind] ?? ''}">{s.kind}</span></span
                                  ><span class="what">{s.from}</span>{#if s.chance}<span class="how"
                                      >{fmtChance(s.chance)}</span
                                    >{/if}{#if s.cond}<span class="how">after {s.cond}</span>{/if}
                                </li>
                              {/each}
                              {#each o.chain as c}
                                {#if c.station}
                                  <li>
                                    <span class="when">{c.station.stageLabel}</span><span class="what"
                                      >at a {c.station.name}</span
                                    >{#if c.station.boss}<span class="how">after {c.station.boss}</span>{/if}
                                  </li>
                                {:else}
                                  <li>
                                    <span class="when">{c.node.stageLabel}</span><span class="what"
                                      >needs {c.node.name}{#if c.viaGroup}
                                        <span class="text-dim">for {c.viaGroup}</span>{/if}</span
                                    ><span class="how">{c.node.gate}</span>
                                  </li>
                                {/if}
                              {/each}
                            </ol>
                          </div>
                          <div>
                            {#if o.tree?.recipes?.length}
                              <div class="lab-rule start mb-2">Crafting tree</div>
                              <CraftGraph {ds} tree={o.tree} {onselect} scale={0.8} zoomable />
                            {:else}
                              <div class="lab-rule start mb-2">Sources</div>
                              <ul class="m-0 list-none p-0">
                                {#each it.sources ?? [] as s}<li class="py-0.5">
                                    <span class="lab-tag mr-1 {SOURCE_TONE[s.kind] ?? ''}">{s.kind}</span
                                    >{s.from}{#if s.chance}<span class="text-dim">&nbsp;· {fmtChance(s.chance)}</span
                                      >{/if}{#if s.cond}<span class="text-dim">&nbsp;after {s.cond}</span>{/if}
                                  </li>{/each}
                              </ul>
                              {#if !(it.sources ?? []).length}<p class="m-0 text-dim">
                                  No recipe or drop found in the mods' code.
                                </p>{/if}
                            {/if}
                          </div>
                        {:else if tab === "effects"}
                          <div>
                            <div class="lab-rule start mb-2">Effects</div>
                            <ol class="lab-timeline">
                              {#each Object.entries(it.effects ?? {}).filter(([k]) => !["flags", "via", "mod", "onHit"].includes(k)) as [k, v]}
                                <li>
                                  <span class="when num"
                                    >{typeof v === "object"
                                      ? Object.entries(v)
                                          .map(([c, n]) => `${c} ${n}`)
                                          .join(", ")
                                      : v}</span
                                  ><span class="what">{k.replace(/([a-z])([A-Z])/g, "$1 $2")}</span>
                                </li>
                              {/each}
                              {#each it.effects?.onHit ?? [] as s}<li>
                                  <span class="when">{s.hurt ? "when hit" : "on hit"}</span><span class="what"
                                    >spawns {s.name}</span
                                  ><span class="how"
                                    >{s.damage
                                      ? `${s.damage} base damage`
                                      : s.share && !s.hurt
                                        ? `${Math.round(s.share * 100)}% of the hit`
                                        : "damage unknown"}{s.stealth ? ", stealth strikes only" : ""}</span
                                  >
                                </li>{/each}
                              {#if it.effects?.flags?.length}<li>
                                  <span class="when">flags</span><span class="what num"
                                    >{it.effects.flags.join(", ")}</span
                                  >
                                </li>{/if}
                              {#if !it.effects}<li>
                                  <span class="when">–</span><span class="what text-dim"
                                    >No effect read from the code.</span
                                  >
                                </li>{/if}
                            </ol>
                          </div>
                          <div class="flex flex-col gap-3">
                            {#if it.setBonus}
                              <div>
                                <div class="lab-rule start mb-2">Set bonus</div>
                                <p class="m-0 whitespace-pre-line border-l-2 border-green-mid pl-2 text-ink2">
                                  {it.setBonus}
                                </p>
                              </div>
                            {/if}
                            {#if it.changes?.length || it.variants?.length || it.maybe}
                              <div>
                                <div class="lab-rule start mb-2">Rebalances</div>
                                <ul class="m-0 list-none p-0 text-[12px] text-ink2">
                                  {#each it.changes ?? [] as c}<li>
                                      {c.mod}
                                      {c.hook}: {c.field ? `${c.field} ${c.from} → ${c.to}` : "changes its effects"}
                                    </li>{/each}
                                  {#each it.variants ?? [] as v}<li class="text-dim">
                                      {v.mod} on {v.cond.join("+")}: {v.field
                                        ? `${v.field} → ${v.to}`
                                        : "changes its effects"}
                                    </li>{/each}
                                  {#if it.maybe}<li class="text-warn">
                                      {it.maybe} conditional change{it.maybe > 1 ? "s" : ""} whose guard could not be resolved
                                    </li>{/if}
                                </ul>
                              </div>
                            {/if}
                            {#if it.condStats?.length}
                              <div>
                                <div class="lab-rule start mb-2">Halved</div>
                                <p class="m-0 text-[12px] text-ink2">
                                  The tooltip makes {it.condStats.join(", ")} conditional, so the score takes half of what
                                  it would otherwise be worth.
                                </p>
                              </div>
                            {/if}
                            {#if !it.setBonus && !it.changes?.length && !it.variants?.length && !it.maybe && !it.condStats?.length}
                              <p class="m-0 text-dim">Nothing else was read for this item.</p>
                            {/if}
                          </div>
                        {/if}
                      </div>
                    </div>
                  </td></tr
                >
              {/if}
            </tbody>
          {/each}
        </table>
      </div>
      <!-- one roomy viewer for whichever row's graph was expanded last -->
      <PhaseWindow
        {ds}
        id="browserphases"
        {accent}
        phases={win.phases}
        total={win.total}
        mode={win.mode}
        title={win.title}
      />
      {#if results.length > shown}
        <div class="border-t border-line p-3 text-center">
          <button type="button" class="lab-btn px-4 py-1" data-sound="tick" onclick={() => (shown += 30)}
            >Show 30 more <span class="num text-dim">({results.length - shown} left)</span></button
          >
        </div>
      {/if}
    </div>
  </div>
</section>
