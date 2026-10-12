// Сборка модуля Foundry «pm5e» (docs/foundry.md, этап 3): foundry-module/ + site/foundry-import.js → dist-foundry/
//   pm5e.zip    — содержимое модуля (module.json в корне архива), ставится в Data/modules/pm5e/
//   module.json — манифест для «Install Module» по ссылке
// Версия: node scripts/build-foundry-module.mjs 0.1.0 (или из тега pm5e-v0.1.0 в GITHUB_REF_NAME). Релиз — .github/workflows/foundry-module.yml.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import JSZip from 'jszip';

const root = new URL('..', import.meta.url).pathname;
const src = join(root, 'foundry-module');
const out = join(root, 'dist-foundry');
const REPO = 'mafir25/sinner-sheet';

const arg = process.argv[2] || String(process.env.GITHUB_REF_NAME || '').replace(/^pm5e-v/, '');
const version = /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(arg) ? arg : '0.0.0-dev';

async function files(dir) {
  const list = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) list.push(...await files(p)); else list.push(p);
  }
  return list;
}

const manifest = JSON.parse(await readFile(join(src, 'module.json'), 'utf8'));
manifest.version = version;
manifest.manifest = `https://github.com/${REPO}/releases/latest/download/module.json`;
manifest.download = `https://github.com/${REPO}/releases/download/pm5e-v${version}/pm5e.zip`;
const manifestText = JSON.stringify(manifest, null, 2) + '\n';

const zip = new JSZip();
for (const f of await files(src)) {
  const rel = relative(src, f).split('\\').join('/');
  if (rel === 'module.json') continue;
  zip.file(rel, await readFile(f));
}
zip.file('module.json', manifestText);
zip.file('scripts/foundry-import.js', await readFile(join(root, 'site', 'foundry-import.js')));

await mkdir(out, { recursive: true });
await writeFile(join(out, 'pm5e.zip'), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
await writeFile(join(out, 'module.json'), manifestText);
console.log(`pm5e ${version} → dist-foundry/pm5e.zip, dist-foundry/module.json`);
