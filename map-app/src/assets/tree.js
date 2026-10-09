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

const INHERIT = ['kind', 'scalable', 'ppc', 'layer', 'pixelated'];

// ---------- правила размещения (docs/map-editor.md §5)
export const PLACES = ['free', 'wall', 'corner', 'center', 'road'];
export const WHERE = ['any', 'inside', 'outside'];
export const ROTATE = ['none', '90', 'any'];
export const CONDITIONS = ['new', 'worn', 'ruined'];

const strList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : []);
const relList = (v) => (Array.isArray(v) ? v : [])
  .filter((r) => r && typeof r.to === 'string' && r.to.trim())
  .map((r) => ({ to: r.to.trim(), dist: Number(r.dist) >= 0 ? Number(r.dist) : 1 }));
const numOr = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/**
 * Правила из _meta.json → полный объект со значениями по умолчанию.
 * Неизвестные поля отбрасываются, неверные значения заменяются умолчаниями.
 */
export function normRules(r) {
  const x = r && typeof r === 'object' ? r : {};
  const scale = Array.isArray(x.scale) && x.scale.length === 2 && x.scale.every((v) => Number(v) > 0)
    ? [Math.min(Number(x.scale[0]), Number(x.scale[1])), Math.max(Number(x.scale[0]), Number(x.scale[1]))] : [1, 1];
  const place = PLACES.includes(x.place) ? x.place : 'free';
  return {
    place,
    where: WHERE.includes(x.where) ? x.where : 'any',
    gap: Math.max(0, numOr(x.gap, 0)),
    face: typeof x.face === 'boolean' ? x.face : place !== 'free' && place !== 'center',
    clearDoors: !!x.clearDoors,
    near: relList(x.near),
    avoid: relList(x.avoid),
    rooms: strList(x.rooms),
    districts: strList(x.districts),
    state: strList(x.state).filter((s) => CONDITIONS.includes(s)),
    weight: Math.max(0, numOr(x.weight, 1)),
    min: Math.max(0, Math.round(numOr(x.min, 0))),
    max: Math.max(0, Math.round(numOr(x.max, 0))), // 0 — без ограничения
    rotate: ROTATE.includes(x.rotate) ? x.rotate : 'none',
    flip: !!x.flip,
    scale,
    tint: strList(x.tint).filter((c) => /^#[0-9a-f]{6}$/i.test(c)),
  };
}

/** Правила заданы хоть как-то (иначе в манифест их не кладём). */
const hasRules = (r) => r && typeof r === 'object' && Object.keys(r).length > 0;

/** Настройки папки с учётом всех _meta.json выше по дереву. Правила сливаются по полям. */
export function resolveDirMeta(dir, metas) {
  const chain = [''];
  if (dir) dir.split('/').reduce((acc, part) => { const p = acc ? `${acc}/${part}` : part; chain.push(p); return p; }, '');
  const out = { tags: [], rules: {} };
  for (const d of chain) {
    const m = metas[d];
    if (!m || typeof m !== 'object') continue;
    for (const k of INHERIT) if (m[k] !== undefined) out[k] = m[k];
    if (Array.isArray(m.tags)) out.tags = [...out.tags, ...m.tags.filter((t) => typeof t === 'string')];
    if (m.rules && typeof m.rules === 'object') out.rules = { ...out.rules, ...m.rules };
  }
  return out;
}

/** Путь внутри набора: «/a/b.svg» — от корня, иначе — от папки dir; «..» поднимается на уровень. */
export function resolvePath(dir, rel) {
  const parts = rel.startsWith('/') ? [] : (dir ? dir.split('/') : []);
  for (const p of rel.replace(/^\/+/, '').split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') parts.pop(); else parts.push(p);
  }
  return parts.join('/');
}

/**
 * Собирает набор.
 * @param {{ path: string, size: {w:number,h:number}|null }[]} files — картинки, пути относительно корня набора
 * @param {Record<string, any>} metas — содержимое _meta.json по пути папки ('' — корень)
 * @returns {{ tree: object, assets: object[], sets: object[] }}
 */
export function buildPack(files, metas = {}) {
  const assets = [];
  for (const f of files) {
    if (!isImage(f.path)) continue;
    const dir = dirOf(f.path), file = baseOf(f.path);
    const dm = resolveDirMeta(dir, metas);
    const fm = (metas[dir] && metas[dir].files && metas[dir].files[file]) || {};
    const rules = { ...dm.rules, ...(fm.rules && typeof fm.rules === 'object' ? fm.rules : {}) };
    const m = { ...dm, ...fm, tags: [...dm.tags, ...(Array.isArray(fm.tags) ? fm.tags : [])] };
    const kind = KINDS.includes(m.kind) ? m.kind : 'object';
    const ppc = Number(m.ppc) > 0 ? Number(m.ppc) : BASE_PPC;
    const fp = Array.isArray(m.footprint) && m.footprint.length === 2 && m.footprint.every((v) => Number(v) > 0)
      ? [Number(m.footprint[0]), Number(m.footprint[1])] : footprintFor(f.size, ppc);
    const group = typeof fm.group === 'string' && fm.group.trim() ? fm.group.trim() : '';
    assets.push({
      path: f.path, dir, file,
      name: normName(m.name, prettyName(file)),
      kind, footprint: fp, ppc,
      scalable: !!m.scalable,
      layer: m.layer === 'above' ? 'above' : 'below',
      pixelated: !!m.pixelated,
      tags: [...new Set(m.tags.filter((t) => typeof t === 'string'))],
      size: f.size ?? null,
      ...(group ? { group } : {}),
      ...(hasRules(rules) ? { rules: normRules(rules) } : {}),
    });
  }
  assets.sort((a, b) => a.path.localeCompare(b.path));
  const byPath = new Map(assets.map((a) => [a.path, a]));

  // комплекты: «sets» в _meta.json папки, пути предметов — от этой папки
  const sets = [];
  for (const [dir, m] of Object.entries(metas)) {
    if (!m || typeof m !== 'object' || !m.sets || typeof m.sets !== 'object') continue;
    for (const [key, s] of Object.entries(m.sets)) {
      if (!s || !Array.isArray(s.items)) continue;
      const items = s.items
        .filter((it) => it && typeof it.file === 'string')
        .map((it) => ({
          path: resolvePath(dir, it.file),
          x: numOr(it.x, 0), y: numOr(it.y, 0), rot: numOr(it.rot, 0),
          flip: !!it.flip, scale: Number(it.scale) > 0 ? Number(it.scale) : 1,
        }))
        .filter((it) => byPath.has(it.path));
      if (!items.length) continue;
      sets.push({
        id: dir ? `${dir}#${key}` : `#${key}`, dir, key,
        name: normName(s.name, prettyName(key)),
        items,
        ...(hasRules(s.rules) ? { rules: normRules(s.rules) } : {}),
      });
    }
  }
  sets.sort((a, b) => a.id.localeCompare(b.id));

  // дерево папок — только те, где ниже есть картинки или комплекты
  const root = { path: '', name: normName(metas['']?.name, ''), dirs: [], files: [], sets: [] };
  const nodes = new Map([['', root]]);
  const ensure = (dir) => {
    if (nodes.has(dir)) return nodes.get(dir);
    const parent = ensure(dirOf(dir));
    const node = { path: dir, name: normName(metas[dir]?.name, prettyName(baseOf(dir))), dirs: [], files: [], sets: [] };
    parent.dirs.push(node);
    nodes.set(dir, node);
    return node;
  };
  for (const a of assets) ensure(a.dir).files.push(a.path);
  for (const s of sets) ensure(s.dir).sets.push(s.id);
  const sortTree = (n) => { n.dirs.sort((a, b) => a.path.localeCompare(b.path)); n.dirs.forEach(sortTree); };
  sortTree(root);
  return { tree: root, assets, sets };
}

/** Размер комплекта в клетках и его предметы относительно центра рамки. */
export function setBounds(set, footprintOf) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const it of set.items) {
    const [fw, fh] = footprintOf(it.path) ?? [1, 1];
    const w = fw * it.scale, h = fh * it.scale;
    const a = (it.rot * Math.PI) / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
    const hw = (w * c + h * s) / 2, hh = (w * s + h * c) / 2;
    x0 = Math.min(x0, it.x - hw); x1 = Math.max(x1, it.x + hw);
    y0 = Math.min(y0, it.y - hh); y1 = Math.max(y1, it.y + hh);
  }
  if (!Number.isFinite(x0)) return { w: 1, h: 1, cx: 0, cy: 0 };
  return { w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

/** Файлы той же группы вариантов в той же папке (включая сам файл). */
export function groupMembers(assets, entry) {
  if (!entry.group) return [entry.path];
  return assets.filter((a) => a.dir === entry.dir && a.group === entry.group).map((a) => a.path);
}

/** Подходит ли ассет под цель правила: «#тег», путь файла, папка или имя файла в той же папке. */
export function matchTarget(target, entry, fromDir = '') {
  if (target.startsWith('#')) return entry.tags.includes(target.slice(1));
  if (target.startsWith('@')) return !!entry.group && entry.group === target.slice(1);
  const p = resolvePath(fromDir, target);
  return entry.path === p || entry.path.startsWith(`${p}/`);
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
