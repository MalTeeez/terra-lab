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
export const fmtPart = (p) => (p.value !== undefined ? fmtNum(p.value) : p.mul === undefined ? '' : `×${Math.round(p.mul * 100) / 100}${p.unit ?? ''}`);
