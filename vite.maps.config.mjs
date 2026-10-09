import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

// Редактор карт: map-app/maps.html → dist/maps.html. Собирается после Ширмы, поэтому dist/ не очищаем.
// Разработка: npm run dev:maps (вход в аккаунт в режиме разработки не требуется).
export default defineConfig(({ command }) => ({
  root: here('./map-app'),
  base: '/',
  // в разработке корень репозитория раздаётся как есть (site/, Assets/); при сборке их копирует copy-static
  publicDir: command === 'serve' ? here('.') : false,
  esbuild: { jsx: 'automatic' },
  build: {
    outDir: here('./dist'),
    emptyOutDir: false,
    assetsDir: 'maps-assets',
    rollupOptions: { input: { maps: here('./map-app/maps.html') } },
  },
}));
