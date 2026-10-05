import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

// Новая Ширма собирается из папки shirm-app в dist/shirm.html.
// Все остальные страницы сайта копируются в dist как есть (scripts/copy-static.mjs).
export default defineConfig({
  root: here('./shirm-app'),
  base: '/',
  publicDir: false,
  esbuild: { jsx: 'automatic' },
  build: {
    outDir: here('./dist'),
    emptyOutDir: true,
    assetsDir: 'shirm-assets',
    rollupOptions: { input: { shirm: here('./shirm-app/shirm.html') } },
  },
});
