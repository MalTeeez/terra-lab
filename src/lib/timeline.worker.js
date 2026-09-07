/**
 * "All stages" solves every gamestage — seconds of CPU that used to freeze the tab at startup
 * (and tripped Firefox's slow-script watchdog with nothing on screen to explain it).
 *
 * The worker loads the dataset itself rather than being handed one: the browser cache serves
 * dataset.json, which is far cheaper than cloning the indexed 4 MB across the thread boundary.
 * Only the answer comes back, with items as ids (see packTimeline).
 */
import { applySeeds, loadDataset } from './dataset.js';
import { packTimeline, solveTimeline } from './solver.js';

let ready = null;

self.onmessage = async ({ data }) => {
  const { token, opts, seeds, dsUrl } = data;
  try {
    // the page terminates this worker when the dataset changes, so `ready` never holds a stale one
    ready ??= loadDataset(dsUrl);
    const ds = await ready;
    applySeeds(ds, seeds);
    // the calibration's `factor` is a function and the Sets travel as arrays (see App.svelte)
    const f = opts.calibration?.factors;
    const solveOpts = {
      ...opts,
      excludedMods: new Set(opts.excludedMods), conds: new Set(opts.conds),
      pinned: new Set(opts.pinned), excluded: new Set(opts.excluded),
      calibration: f ? { factors: f, factor: (cls) => f[cls] ?? f.all ?? 1 } : null,
    };
    const rows = solveTimeline(ds, solveOpts, (done, total) => self.postMessage({ token, done, total }));
    self.postMessage({ token, rows: packTimeline(rows) });
  } catch (e) {
    self.postMessage({ token, error: e?.message ?? String(e) });
  }
};
