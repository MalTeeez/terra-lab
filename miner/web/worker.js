/**
 * The miner, in the browser.
 *
 * Nothing in `miner/` is modified or copied for this: the same `mine.js` runs, with the four things
 * it reads from the platform swapped underneath it by vite.config.js —
 *
 *   node:fs      → node-fs.js      files the user picked, in memory (vfs.js)
 *   node:zlib    → node-zlib.js    never called; the .tmod is unpacked first (tmodpack.js)
 *   node:crypto  → node-crypto.js  md5 for the wiki image path (md5.js)
 *   node:path / node:os            string helpers over those in-memory paths
 *
 * plus `Buffer` and `process`, which the miner uses as globals, installed below. Then it is handed
 * the same `--tml`/`--tmod`/`--out` arguments the CLI would build, and the dataset it writes comes
 * back out of the in-memory filesystem.
 *
 * The pipeline runs on import and a module is only ever imported once, so this worker mines once
 * and the page terminates it. Files arrive as `File` handles rather than bytes and are read one at
 * a time: a modpack is bigger than a tab should hold all at once.
 */
import { WebBuffer } from './buffer.js';
import { unpackTmod } from './tmodpack.js';
import { vfs } from './vfs.js';
import progression from '../stage/progression.json';
import debuffs from '../stage/debuffs.json';
import sources from '../stage/sources.json';
import wikiIcons from '../../data/wiki-icons.json';

const post = (msg) => self.postMessage(msg);

globalThis.Buffer = WebBuffer;
globalThis.process = { argv: ['node', 'mine.js'], env: {}, platform: 'browser', versions: {}, exit: (code) => { throw new Error(`the miner gave up (exit ${code})`); } };
for (const name of ['log', 'warn', 'error']) {
  const original = console[name].bind(console);
  console[name] = (...parts) => {
    original(...parts);
    post({ log: parts.map(String).join(' ') });
  };
}

const bytesOf = (text) => WebBuffer.from(JSON.stringify(text));

self.onmessage = async ({ data }) => {
  try {
    const { tmlFile, modFiles, enabledFile } = data;
    // the miner's own data files, under the paths it builds with `new URL(…, import.meta.url)`
    vfs.set('stage/progression.json', bytesOf(progression));
    vfs.set('stage/debuffs.json', bytesOf(debuffs));
    vfs.set('stage/sources.json', bytesOf(sources));
    vfs.set('data/wiki-icons.json', bytesOf(wikiIcons));

    // No mods is a mine too: the pipeline reads vanilla out of tModLoader.dll either way.
    post({ log: `tModLoader.dll: ${(tmlFile.size / 1024 / 1024).toFixed(0)} MB` });
    vfs.set('/game/tModLoader.dll', WebBuffer.from(await tmlFile.arrayBuffer()));

    // Mods go in in enabled.json order when we have it, because that is what breaks ties in
    // loadorder.js — and load order decides which balancing mod's overlay lands last. Without it
    // the order is whatever the file picker gave, which mines fine but need not match the desktop.
    let order = null;
    if (enabledFile) {
      const text = await enabledFile.text();
      const { defaultPaths } = await import('../resolve.js');
      vfs.set(defaultPaths().enabledJson, WebBuffer.from(text));
      try { order = JSON.parse(text); } catch { /* unreadable enabled.json: keep the picked order */ }
    }
    const rank = (file) => {
      const i = order.indexOf(file.name.replace(/\.tmod$/i, ''));
      return i < 0 ? order.length : i;
    };
    const files = order ? [...modFiles].sort((a, b) => rank(a) - rank(b)) : modFiles;

    const argv = ['node', 'mine.js', '--tml', '/game/tModLoader.dll', '--out', '/out/dataset.json'];
    for (const [i, file] of files.entries()) {
      const name = file.name.replace(/\.tmod$/i, '');
      post({ log: `unpacking ${name}`, step: i + 1, total: modFiles.length });
      try {
        vfs.set(`/mods/${name}.tmod`, await unpackTmod(WebBuffer.from(await file.arrayBuffer())));
        argv.push('--tmod', `/mods/${name}.tmod`);
      } catch (e) {
        post({ log: `! ${name}: ${e.message}` }); // a mod with no code is not a reason to stop
      }
    }
    if (modFiles.length && argv.indexOf('--tmod') < 0) throw new Error('none of those files held anything to mine');

    process.argv = argv;
    post({ log: 'mining…', step: modFiles.length, total: modFiles.length });
    await import('../mine.js'); // runs the whole pipeline; writes /out/dataset.json through node-fs.js

    const dataset = vfs.get('/out/dataset.json');
    if (!dataset) throw new Error('the miner wrote no dataset');
    post({ dataset: dataset.buffer }, [dataset.buffer]);
  } catch (e) {
    post({ error: e?.message ?? String(e) });
  }
};
