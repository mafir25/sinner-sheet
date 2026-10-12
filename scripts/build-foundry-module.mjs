// Сборка модуля Foundry «pm5e» (docs/foundry.md, этапы 3–4): foundry-module/ + общий код сайта → dist-foundry/
//   в архив кладутся: site/foundry-{import,export,kb}.js и canon-reader.js → scripts/, marked и DOMPurify → scripts/vendor/,
//   scripts/config.js (проект Firestore из site/firebase-config.js), встроенная копия канона Assets/<язык>/… → data/
//   pm5e.zip    — содержимое модуля (module.json в корне архива), ставится в Data/modules/pm5e/
//   module.json — манифест для «Install Module» по ссылке
// Версия: node scripts/build-foundry-module.mjs 0.1.0 (или из тега pm5e-v0.1.0 в GITHUB_REF_NAME). Релиз — .github/workflows/foundry-module.yml.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import JSZip from 'jszip';
import { firebaseConfig, FIRESTORE_DB } from '../site/firebase-config.js';
import { KB_FILES } from '../site/foundry-kb.js';

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
for (const f of ['foundry-import.js', 'foundry-export.js', 'foundry-kb.js', 'canon-reader.js', 'pm-statuses.js', 'pm-ego.js', 'pm-attacks.js', 'compendium-tools.js']) {
  zip.file(`scripts/${f}`, await readFile(join(root, 'site', f)));
}
zip.file('scripts/vendor/marked.esm.js', await readFile(join(root, 'node_modules/marked/lib/marked.esm.js')));
zip.file('scripts/vendor/purify.es.mjs', await readFile(join(root, 'node_modules/dompurify/dist/purify.es.mjs')));
zip.file('scripts/config.js', `// Создано scripts/build-foundry-module.mjs из site/firebase-config.js (публичные данные: доступ ограничивают правила Firestore)
export const CANON = ${JSON.stringify({ projectId: firebaseConfig.projectId, apiKey: firebaseConfig.apiKey, db: FIRESTORE_DB })};
`);
for (const f of await readdir(join(root, 'Assets/Icons'))) zip.file(`icons/${f}`, await readFile(join(root, 'Assets/Icons', f)));   // значки статусов
// встроенная копия канона: файлы Базы знаний + основы и архетипы классов из реестра
let snapshot = 0;
const regRels = [];
for (const lang of ['Rus', 'Eng']) {   // английского реестра может не быть — тогда файлы классов берём по русскому
  try {
    const reg = JSON.parse(await readFile(join(root, 'Assets', lang, 'characters/systems.json'), 'utf8'));
    for (const r of reg) for (const f of [r.Base, r.Archetypes]) if (f) regRels.push(`characters/${f}`);
  } catch { /* нет реестра в этом языке */ }
}
for (const lang of ['Rus', 'Eng']) {
  const rels = [...KB_FILES, ...regRels];
  for (const rel of new Set(rels)) {
    try { zip.file(`data/${lang}/${rel}`, await readFile(join(root, 'Assets', lang, rel))); snapshot++; } catch { /* файла нет в этом языке */ }
  }
}

await mkdir(out, { recursive: true });
await writeFile(join(out, 'pm5e.zip'), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
await writeFile(join(out, 'module.json'), manifestText);
console.log(`pm5e ${version} → dist-foundry/pm5e.zip (${snapshot} файлов канона), dist-foundry/module.json`);
