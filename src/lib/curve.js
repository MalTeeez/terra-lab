/**
 * The soft cap every stat is eased through: full value near zero, flattening to `cap` by `3 × cap`.
 * Its own module, with `typicalDps`, so healer.js and score.js (which imports healer.js) can share them.
 */
export const soft = (x, cap) => { const t = Math.min(1, Math.abs(x) / (3 * cap)); return Math.sign(x) * cap * (1 - (1 - t) ** 3); };

/**
 * A typical weapon's DPS at a progression value, the yardstick for damage an accessory deals on
 * its own (a spike per stealth strike, a flash on hit): ~60 pre-boss, ~240 at Wall of Flesh,
 * ~1800 at Moon Lord, ~18000 at the end of Calamity.
 *
 * Calibrated against the lab's own weapon model, not guessed: the median of the 10th-best weapon
 * per class per stage (`weaponDps`) is ~55 at progression 0, ~850 at 12.8 and ~3600 at 20.5, all
 * within 10% of this curve. The old base of 40 sat a flat 1.5× under it at every stage, which
 * made every flat proc and every "+N damage on a crit" worth half again what it should be.
 */
export const typicalDps = (progression) => 60 * 1.22 ** Math.max(0, progression ?? 7);
