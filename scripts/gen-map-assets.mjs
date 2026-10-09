// Манифест канонического набора редактора карт: Assets/Maps/** → Assets/Maps/manifest.json.
// Сайт статический и не умеет читать папки, поэтому список файлов собирается заранее.
// Запуск: node scripts/gen-map-assets.mjs (входит в npm run build). Правила папок — docs/map-editor.md §4.
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { buildPack, isImage, pngSize, svgSize } from '../map-app/src/assets/tree.js';

const ROOT = join(process.cwd(), 'Assets', 'Maps');
const OUT = join(ROOT, 'manifest.json');

if (!existsSync(ROOT)) {
  console.log('gen-map-assets: нет папки Assets/Maps — пропуск');
  process.exit(0);
}

const files = [];
const metas = {};
const walk = (dir) => {
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue;
    const abs = join(dir, name);
    const rel = relative(ROOT, abs).split(sep).join('/');
    if (statSync(abs).isDirectory()) { walk(abs); continue; }
    if (name === '_meta.json') {
      const d = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      try { metas[d] = JSON.parse(readFileSync(abs, 'utf8')); }
      catch (e) { console.error(`gen-map-assets: ошибка в ${rel}: ${e.message}`); process.exitCode = 1; }
      continue;
    }
    if (!isImage(name)) continue;
    const buf = readFileSync(abs);
    const size = name.toLowerCase().endsWith('.svg') ? svgSize(buf.toString('utf8'))
      : name.toLowerCase().endsWith('.png') ? pngSize(buf) : null;
    files.push({ path: rel, size });
  }
};
walk(ROOT);

const { tree, assets, sets } = buildPack(files, metas);
// metas — исходные _meta.json: по ним редактор разметки (этап 3) показывает и правит настройки канона
const text = `${JSON.stringify({ version: 1, tree, assets, sets, metas })}\n`;
const old = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
if (old !== text) writeFileSync(OUT, text);
console.log(`gen-map-assets: ${assets.length} ассетов, ${sets.length} комплектов${old === text ? ' (без изменений)' : ' → Assets/Maps/manifest.json'}`);
