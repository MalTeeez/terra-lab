/**
 * A few files in memory, so the miner can go on reading files.
 *
 * The browser build swaps `node:fs` for `node-fs.js`, which reads out of here: the worker puts
 * tModLoader.dll, the picked `.tmod`s and the miner's own data files in before it starts the mine,
 * and takes the written dataset back out afterwards. Nothing in `miner/` changes.
 *
 * Keys are the paths the miner asks for. Its own data files are the awkward ones: it reads them as
 * `new URL('./stage/progression.json', import.meta.url)`, which the bundler rewrites to wherever it
 * put that file — `/assets/progression-BnMvkXl5.json` — so a lookup falls back to the file's name
 * with any content hash taken back off. (The small ones become `data:` URLs and never get here;
 * node-fs.js decodes those itself.)
 */
const files = new Map();

const key = (p) => String(p?.pathname ?? p).replace(/\\/g, '/');
const name = (k) => k.split('/').pop().replace(/-[A-Za-z0-9_-]{8,}(\.[a-z]+)$/i, '$1');

export const vfs = {
  set: (path, bytes) => files.set(key(path), bytes),
  has: (path) => vfs.get(path) !== undefined,
  delete: (path) => files.delete(key(path)),
  get(path) {
    const k = key(path);
    if (files.has(k)) return files.get(k);
    const n = name(k);
    for (const [f, bytes] of files) if (k.endsWith(f) || name(f) === n) return bytes;
    return undefined;
  },
  clear: () => files.clear(),
};
