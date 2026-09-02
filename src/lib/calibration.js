/**
 * Calibration from in-game observations.
 *
 * The user enters a few items with the damage (and optionally crit) the game shows for
 * them, plus the bonuses their character had at the time (so a naked character enters 0).
 * Each sample yields observed / predicted; the median ratio per class (falling back to
 * the median over all samples) becomes a factor applied to every predicted damage of that
 * class. Residuals per sample show which items the model still gets wrong.
 */
import { effectiveStats } from './stats.js';

/**
 * @param {Array<{ id: string, damage: number, crit?: number, prefix?: string|null, bonusDamage?: number, bonusCrit?: number }>} samples
 * @param {object} ds       indexed dataset
 * @param {{ conds: Set<string>, uncertain: boolean }} ctx
 */
export function fitCalibration(samples, ds, ctx) {
  const rows = [];
  const byClass = new Map();
  const all = [];
  for (const s of samples) {
    const item = ds.byId.get(s.id);
    if (!item || !(s.damage > 0)) continue;
    const prefix = s.prefix ? ds.prefixById.get(s.prefix) ?? null : null;
    const eff = effectiveStats(item, { conds: ctx.conds, uncertain: ctx.uncertain, prefix, calibration: null });
    const predicted = eff.damage * (1 + (s.bonusDamage ?? 0));
    if (!(predicted > 0)) continue;
    const ratio = s.damage / predicted;
    const cls = item.cls ?? item.class ?? 'gear';
    (byClass.get(cls) ?? byClass.set(cls, []).get(cls)).push(ratio);
    all.push(ratio);
    const critPred = s.crit !== undefined && s.crit !== null && s.crit !== '' ? eff.crit + (s.bonusCrit ?? 0) : null;
    rows.push({ sample: s, item, predicted: Math.round(predicted), ratio, err: (ratio - 1) * 100, critPredicted: critPred, critErr: critPred === null ? null : Number(s.crit) - critPred });
  }
  const factors = {};
  for (const [cls, list] of byClass) factors[cls] = median(list);
  if (all.length) factors.all = median(all);
  const factor = (cls) => factors[cls] ?? factors.all ?? 1;
  return { factors, rows, factor, sampleCount: rows.length };
}

function median(list) {
  const s = [...list].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
