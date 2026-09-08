import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

/**
 * GitHub Pages serves a project site from /<repo>/; a deploy workflow can pass
 * BASE_PATH in. Empty or "/" means a root deployment.
 */
const basePath = process.env.BASE_PATH ?? '';
const base = basePath === '' || basePath === '/' ? '/' : `/${basePath.replace(/^\/|\/$/g, '')}/`;

/**
 * What a deploy publishes out of data/ — the two files the site fetches (src/lib/datasets.js).
 * Everything else in there is the miner's workbench: frozen baselines, scraped guides, notes.
 */
const published = ['dataset.json', 'dataset.summary.json'];

export default defineConfig({
  base,
  plugins: [svelte(), tailwindcss(), {
    name: 'terra-lab:published-data',
    generateBundle() {
      for (const name of published) {
        this.emitFile({ type: 'asset', fileName: name, source: readFileSync(new URL(`./data/${name}`, import.meta.url)) });
      }
    },
  }],
  resolve: {
    // The browser miner runs `miner/` unmodified (see miner/web/worker.js); these are the only
    // things in it that need a platform underneath. Nothing else in the site imports them, and
    // `bun run mine` — plain Node — never goes through Vite.
    alias: Object.fromEntries(['fs', 'path', 'os', 'zlib', 'crypto'].map((m) => [
      `node:${m}`, fileURLToPath(new URL(`./miner/web/node-${m}.js`, import.meta.url)),
    ])),
  },
  // The mined dataset lives in data/; serving it as the public dir puts it at /dataset.json. Dev
  // gets the whole folder that way, a build only `published` above — see build.copyPublicDir.
  publicDir: 'data',
  // hjson is only reached from the mining worker, which vite would otherwise discover mid-mine —
  // and "optimized dependencies changed" reloads the page out from under it
  optimizeDeps: { include: ['hjson'] },
  server: { port: 5174, open: false },
  build: { target: 'es2022', copyPublicDir: false },
});
