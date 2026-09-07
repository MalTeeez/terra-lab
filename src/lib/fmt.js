// Scores and real DPS span 0.1 to trillions (Tesseract), and a raw number that long blows out
// every column it sits in. Intl's compact notation does the K/M/B/T shortening; 'en-US' is pinned
// because other locales spell it out ("1,2 Mio.").
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

/** A score / DPS for display: 12.3, 1.2K, 5.6T — '–' when there is none. */
export const fmtNum = (v) => (v === null || v === undefined || Number.isNaN(v) ? '–' : compact.format(v));

/** The same number in full, for the `title` of a compacted one. */
export const fmtFull = (v) => (v === null || v === undefined || Number.isNaN(v) ? '' : (Math.round(v * 10) / 10).toLocaleString('en-US'));

/**
 * The number a breakdown row shows. A part carries either a value or a multiplier, and both come
 * straight out of floating-point arithmetic, so `8.879999971389768` is what a raw one prints.
 * Multipliers keep two decimals — the difference between x1.05 and x1.1 is a real one.
 */
/**
 * A stat as the game states it. The miner reads C# `float`s, so a `6.6f` velocity arrives as
 * 6.599999904632568 and a stat cell printed the whole thing. Strings ("18 / 20", "12%") pass through.
 */
export const fmtStat = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);

/**
 * A drop chance. Percentages read straight down to 1%; below that "1 in 10,000" is the number a
 * player can actually hold on to. Empty for a drop that is certain (or one the miner never read).
 */
export const fmtChance = (c) => (!c || c >= 1 ? '' : c >= 0.01 ? `${+(c * 100).toFixed(c >= 0.1 ? 0 : 1)}%` : `1 in ${Math.round(1 / c).toLocaleString('en-US')}`);

/**
 * The word Terraria prints instead of a use time — it grades the *animation*, not the use time, so
 * a weapon whose two differ reads as the speed it actually swings at. Vanilla's own thresholds.
 */
const SPEED = [[8, 'Insanely fast'], [20, 'Very fast'], [25, 'Fast'], [30, 'Average'], [35, 'Slow'], [45, 'Very slow'], [55, 'Extremely slow']];
export const fmtSpeed = (useAnimation) =>
  useAnimation === undefined || useAnimation === null ? '' : (SPEED.find(([max]) => useAnimation <= max)?.[1] ?? 'Snail');

export const fmtPart = (p) => (p.value !== undefined ? fmtNum(p.value) : p.mul === undefined ? '' : `×${Math.round(p.mul * 100) / 100}${p.unit ?? ''}`);
