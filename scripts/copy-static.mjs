// Копирует страницы сайта (*.html в корне), site/ и Assets/ в dist/ после сборки Ширмы и редактора карт.
// Новые html/json/картинки можно класть туда же — они попадут на сайт как есть.
import { cpSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
const OUT = join(ROOT, 'dist');
const SKIP = new Set(['node_modules', 'dist', 'shirm-app', 'map-app', 'docs', 'scripts', 'CLAUDE.md', 'vite.maps.config.mjs', '.git', '.github', '.vite',
  'package.json', 'package-lock.json', 'vite.config.mjs', 'vercel.json', 'firestore.rules', '.gitignore', 'README.md',
  'tests', 'firebase.json', 'firestore-debug.log']);
const EXT = new Set(['.html', '.json', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.css', '.js',
  '.txt', '.webmanifest', '.mp3', '.ogg', '.wav', '.ttf', '.otf', '.woff', '.woff2', '.pdf']);

let n = 0;
for (const name of readdirSync(ROOT)) {
  if (SKIP.has(name) || name.startsWith('.')) continue;
  const src = join(ROOT, name);
  const isDir = statSync(src).isDirectory();
  if (!isDir && !EXT.has(extname(name).toLowerCase())) continue;
  if (name === 'shirm.html' || name === 'maps.html') continue; // Ширма и редактор карт уже собраны Vite
  cpSync(src, join(OUT, name), { recursive: true });
  n++;
}
console.log(`copy-static: скопировано ${n} файлов/папок в dist/`);
