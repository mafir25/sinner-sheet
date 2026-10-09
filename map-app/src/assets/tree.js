// Дерево набора ассетов: папки = категории и подтипы, файлы = разновидности.
// Общий код для генератора канона (scripts/gen-map-assets.mjs, Node) и локальных наборов (браузер).
// Правила — docs/map-editor.md §4.

export const IMAGE_EXT = ['.png', '.webp', '.jpg', '.jpeg', '.gif', '.svg'];
export const KINDS = ['object', 'floor', 'wall', 'door', 'window', 'terrain', 'roof'];
export const BASE_PPC = 256;

export const isImage = (path) => IMAGE_EXT.some((e) => path.toLowerCase().endsWith(e));
export const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
export const baseOf = (path) => path.slice(path.lastIndexOf('/') + 1);

/** «big-table_02.png» → «Big table 02» */
export function prettyName(file) {
  const s = baseOf(file).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : file;
}

/** Имя из _meta.json: строка или { ru, en } → { ru, en } */
export function normName(n, fallback) {
  if (typeof n === 'string' && n.trim()) return { ru: n, en: n };
  if (n && typeof n === 'object') {
    const ru = typeof n.ru === 'string' && n.ru ? n.ru : (typeof n.en === 'string' && n.en ? n.en : fallback);
    const en = typeof n.en === 'string' && n.en ? n.en : ru;
    return { ru, en };
  }
  return { ru: fallback, en: fallback };
}

/** Размер SVG из width/height или viewBox. */
export function svgSize(text) {
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0];
  if (!tag) return null;
  const num = (a) => {
    const m = new RegExp(`\\s${a}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`, 'i').exec(tag);
    return m ? Number(m[1]) : NaN;
  };
  let w = num('width'), h = num('height');
  if (!(w > 0 && h > 0)) {
    const vb = /viewBox\s*=\s*["']\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i.exec(tag);
    if (vb) { w = Number(vb[3]); h = Number(vb[4]); }
  }
  return w > 0 && h > 0 ? { w, h } : null;
}

/** Размер PNG из заголовка IHDR. */
export function pngSize(bytes) {
  if (!bytes || bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
  const u32 = (o) => ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  const w = u32(16), h = u32(20);
  return w > 0 && h > 0 ? { w, h } : null;
}

/** Размер в клетках по размеру картинки: ppc пикселей = 1 клетка; меньше ppc по большей стороне — 1 клетка. */
export function footprintFor(size, ppc = BASE_PPC) {
  if (!size) return [1, 1];
  const big = Math.max(size.w, size.h);
  const k = big < ppc ? 1 / big : 1 / ppc;
  const r = (v) => Math.max(0.05, Math.round(v * k * 1000) / 1000);
  return [r(size.w), r(size.h)];
}

const INHERIT = ['kind', 'scalable', 'ppc', 'layer', 'pixelated', 'rules'];

/** Настройки папки с учётом всех _meta.json выше по дереву. */
function resolveDirMeta(dir, metas) {
  const chain = [''];
  if (dir) dir.split('/').reduce((acc, part) => { const p = acc ? `${acc}/${part}` : part; chain.push(p); return p; }, '');
  const out = { tags: [] };
  for (const d of chain) {
    const m = metas[d];
    if (!m || typeof m !== 'object') continue;
    for (const k of INHERIT) if (m[k] !== undefined) out[k] = m[k];
    if (Array.isArray(m.tags)) out.tags = [...out.tags, ...m.tags.filter((t) => typeof t === 'string')];
  }
  return out;
}

/**
 * Собирает набор.
 * @param {{ path: string, size: {w:number,h:number}|null }[]} files — картинки, пути относительно корня набора
 * @param {Record<string, any>} metas — содержимое _meta.json по пути папки ('' — корень)
 * @returns {{ tree: object, assets: object[] }}
 */
export function buildPack(files, metas = {}) {
  const assets = [];
  for (const f of files) {
    if (!isImage(f.path)) continue;
    const dir = dirOf(f.path), file = baseOf(f.path);
    const dm = resolveDirMeta(dir, metas);
    const fm = (metas[dir] && metas[dir].files && metas[dir].files[file]) || {};
    const m = { ...dm, ...fm, tags: [...dm.tags, ...(Array.isArray(fm.tags) ? fm.tags : [])] };
    const kind = KINDS.includes(m.kind) ? m.kind : 'object';
    const ppc = Number(m.ppc) > 0 ? Number(m.ppc) : BASE_PPC;
    const fp = Array.isArray(m.footprint) && m.footprint.length === 2 && m.footprint.every((v) => Number(v) > 0)
      ? [Number(m.footprint[0]), Number(m.footprint[1])] : footprintFor(f.size, ppc);
    assets.push({
      path: f.path, dir, file,
      name: normName(m.name, prettyName(file)),
      kind, footprint: fp, ppc,
      scalable: !!m.scalable,
      layer: m.layer === 'above' ? 'above' : 'below',
      pixelated: !!m.pixelated,
      tags: [...new Set(m.tags)],
      ...(m.rules && typeof m.rules === 'object' ? { rules: m.rules } : {}),
    });
  }
  assets.sort((a, b) => a.path.localeCompare(b.path));

  // дерево папок — только те, где ниже есть картинки
  const root = { path: '', name: normName(metas['']?.name, ''), dirs: [], files: [] };
  const byPath = new Map([['', root]]);
  const ensure = (dir) => {
    if (byPath.has(dir)) return byPath.get(dir);
    const parent = ensure(dirOf(dir));
    const node = { path: dir, name: normName(metas[dir]?.name, prettyName(baseOf(dir))), dirs: [], files: [] };
    parent.dirs.push(node);
    byPath.set(dir, node);
    return node;
  };
  for (const a of assets) ensure(a.dir).files.push(a.path);
  const sortTree = (n) => { n.dirs.sort((a, b) => a.path.localeCompare(b.path)); n.dirs.forEach(sortTree); };
  sortTree(root);
  return { tree: root, assets };
}

/** Узел папки по пути. */
export function findDir(tree, path) {
  if (!path) return tree;
  let n = tree;
  for (const part of path.split('/')) {
    const next = n.dirs.find((d) => baseOf(d.path) === part);
    if (!next) return null;
    n = next;
  }
  return n;
}

/**
 * Цепочка выбора разновидности для ассета: для каждого уровня от корня категории до файла —
 * список соседей (папок или файлов) и выбранный. Корень цепочки — папка верхнего уровня (objects, scalable…).
 */
export function variantChain(tree, assetPath) {
  const parts = dirOf(assetPath) ? dirOf(assetPath).split('/') : [];
  const levels = [];
  let node = tree;
  for (let i = 0; i < parts.length; i++) {
    const next = node.dirs.find((d) => baseOf(d.path) === parts[i]);
    if (!next) break;
    if (i > 0) levels.push({ kind: 'dir', options: node.dirs.map((d) => d.path), value: next.path });
    node = next;
  }
  levels.push({ kind: 'file', options: node.files.slice(), value: assetPath, dir: node.path });
  return levels;
}

/** Первый ассет внутри папки (для смены подтипа: берём первую разновидность в новой папке). */
export function firstAsset(node) {
  if (!node) return null;
  if (node.files.length) return node.files[0];
  for (const d of node.dirs) { const f = firstAsset(d); if (f) return f; }
  return null;
}

/**
 * Смена подтипа: переходим в папку newDir, стараясь сохранить «хвост» пути
 * (zwei/emblem.svg → hana/emblem.svg), иначе — первая разновидность в новой папке.
 */
export function switchDir(tree, assets, oldPath, oldDir, newDir) {
  const tail = oldPath.startsWith(`${oldDir}/`) ? oldPath.slice(oldDir.length + 1) : baseOf(oldPath);
  const want = `${newDir}/${tail}`;
  if (assets.some((a) => a.path === want)) return want;
  const sameFile = `${newDir}/${baseOf(oldPath)}`;
  if (assets.some((a) => a.path === sameFile)) return sameFile;
  return firstAsset(findDir(tree, newDir));
}
