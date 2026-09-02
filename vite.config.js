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
  // The mined dataset lives in data/; serving it as the public dir puts it at /dataset.json.
  publicDir: 'data',
  server: { port: 5174, open: false },
  build: { target: 'es2022' },
});
