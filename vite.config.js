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

export default defineConfig({
  base,
  plugins: [svelte(), tailwindcss()],
  resolve: {
    // The browser miner runs `miner/` unmodified (see miner/web/worker.js); these are the only
    // things in it that need a platform underneath. Nothing else in the site imports them, and
    // `bun run mine` — plain Node — never goes through Vite.
    alias: Object.fromEntries(['fs', 'path', 'os', 'zlib', 'crypto'].map((m) => [
      `node:${m}`, fileURLToPath(new URL(`./miner/web/node-${m}.js`, import.meta.url)),
    ])),
  },
  // The mined dataset lives in data/; serving it as the public dir puts it at /dataset.json.
  publicDir: 'data',
  // hjson is only reached from the mining worker, which vite would otherwise discover mid-mine —
  // and "optimized dependencies changed" reloads the page out from under it
  optimizeDeps: { include: ['hjson'] },
  server: { port: 5174, open: false },
  build: { target: 'es2022' },
});
