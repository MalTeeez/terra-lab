/**
 * Mining a modpack in the browser, from the page's side: pick the files sensibly, drive the worker
 * (miner/web/worker.js), hand back the dataset it wrote.
 */

/** Whether this browser can run a mine at all — the .tmod unpack needs raw-deflate. */
export const canMine = typeof DecompressionStream === 'function';

/**
 * The `.tmod` files out of whatever the user picked, newest version of each mod only.
 *
 * A Steam workshop folder holds every version it ever downloaded
 * (`…/content/1281930/<id>/<2026.6>/Mod.tmod`), and mining two copies of one mod would load it
 * twice — so where a name repeats, the highest `<year>.<month>` folder on its path wins, which is
 * what `miner/resolve.js` picks on the desktop.
 */
export function pickTmods(files) {
  const versionOf = (path) => (path.match(/(?:^|\/)(\d{4})\.(\d+)(?:\/|$)/) ?? [0, 0, 0]).slice(1).map(Number);
  const best = new Map();
  for (const file of files) {
    if (!/\.tmod$/i.test(file.name)) continue;
    const name = file.name.replace(/\.tmod$/i, '');
    const version = versionOf(file.webkitRelativePath || file.name);
    const prev = best.get(name);
    if (!prev || version[0] > prev.version[0] || (version[0] === prev.version[0] && version[1] > prev.version[1])) {
      best.set(name, { file, version });
    }
  }
  return [...best.values()].map((v) => v.file).sort((a, b) => a.name.localeCompare(b.name));
}

/** `enabled.json` if the picked folder happens to be the Mods folder — it decides which mods count. */
export const findEnabled = (files) => [...files].find((f) => f.name === 'enabled.json') ?? null;

/**
 * Run the mine. `onlog` gets every line the miner prints (and a step counter while unpacking);
 * resolves with the dataset as bytes.
 *
 * @returns {Promise<Uint8Array>}
 */
export function mine({ tmlFile, modFiles, enabledFile, onlog, signal }) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../../miner/web/worker.js', import.meta.url), { type: 'module' });
    const done = (fn, v) => { worker.terminate(); fn(v); };
    signal?.addEventListener('abort', () => done(reject, new Error('stopped')), { once: true });
    worker.onmessage = ({ data }) => {
      if (data.error) done(reject, new Error(data.error));
      else if (data.dataset) done(resolve, new Uint8Array(data.dataset));
      else onlog?.(data);
    };
    worker.onerror = (e) => done(reject, new Error(e.message || 'the mining worker crashed'));
    worker.postMessage({ tmlFile, modFiles, enabledFile });
  });
}
