// Наборы ассетов: канонический (Assets/Maps/manifest.json) и локальные (папки с диска → IndexedDB).
// Ключ ассета: canon:<путь> или local:<id набора>/<путь>.
import JSZip from 'jszip';
import type { AssetEntry, AssetKey, DirNode, SetEntry } from '../model/types';
import { buildPack, groupMembers, isImage, pngSize, svgSize } from './tree.js';
import { packs as packDb, type StoredPack, type StoredPackFile } from '../storage/idb';
import { uid } from '../model/doc';

export type Pack = {
  id: string;
  label: string;
  local: boolean;
  tree: DirNode;
  assets: AssetEntry[];
  byPath: Map<string, AssetEntry>;
  sets: SetEntry[];
  setById: Map<string, SetEntry>;
  files?: Map<string, Blob>;
  /** Содержимое _meta.json по пути папки ('' — корень): для .pmmap и редактора разметки. */
  metas: Record<string, unknown>;
  /** Папка на диске, куда можно записать _meta.json (только локальные наборы в Chrome/Edge). */
  handle?: FileSystemDirectoryHandle;
};

type Img = { el: HTMLImageElement; ok: boolean; failed: boolean; svg: boolean };

const CANON_URL = 'Assets/Maps/';
const MAX_RASTER = 4096;

function bucket(pxPerCell: number) {
  let b = 32;
  while (b < pxPerCell && b < 1024) b *= 2;
  return b;
}

export class AssetStore {
  packs: Pack[] = [];
  version = 0;
  ready = false;
  error = '';
  private listeners = new Set<() => void>();
  private imgs = new Map<string, Img>();
  private rasters = new Map<string, HTMLCanvasElement>();
  private patterns = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern>>();
  private urls = new Map<string, string>();
  private waiters = new Map<string, (() => void)[]>();

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private emit() { this.version++; this.listeners.forEach((f) => f()); }

  private initP: Promise<void> | null = null;
  /** Загружает канон и локальные наборы (один раз, даже если вызвать дважды). */
  init(): Promise<void> {
    this.initP ??= this.load();
    return this.initP;
  }

  private async load() {
    try {
      const res = await fetch(`${CANON_URL}manifest.json`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const m = await res.json() as { tree: DirNode; assets: AssetEntry[]; sets?: SetEntry[]; metas?: Record<string, unknown> };
      this.packs.push(this.makePack('canon', 'Канон', false, m.tree, m.assets, m.sets ?? [], undefined, m.metas ?? {}));
    } catch (e) {
      console.error('Канон карт не загрузился', e);
      this.error = String(e);
    }
    try {
      for (const p of await packDb.all()) this.packs.push(this.packFromStored(p));
    } catch (e) { console.error('Локальные наборы не прочитались', e); }
    this.ready = true;
    this.emit();
  }

  private makePack(id: string, label: string, local: boolean, tree: DirNode, assets: AssetEntry[], sets: SetEntry[],
    files?: Map<string, Blob>, metas: Record<string, unknown> = {}, handle?: FileSystemDirectoryHandle): Pack {
    // старый манифест (без комплектов) — у папок нет списка sets
    const fix = (n: DirNode) => { n.sets ??= []; n.dirs.forEach(fix); };
    fix(tree);
    return {
      id, label, local, tree, assets, byPath: new Map(assets.map((a) => [a.path, a])),
      sets, setById: new Map(sets.map((x) => [x.id, x])), files, metas, handle,
    };
  }

  private packFromStored(p: StoredPack): Pack {
    const { tree, assets, sets } = buildPack(p.files.map((f) => ({ path: f.path, size: f.size })), p.metas);
    return this.makePack(p.id, p.label, true, tree, assets, sets, new Map(p.files.map((f) => [f.path, f.blob])), p.metas, p.handle);
  }

  // ---------- ключи
  key(packId: string, path: string): AssetKey { return packId === 'canon' ? `canon:${path}` : `local:${packId}/${path}`; }
  parse(key: AssetKey): { packId: string; path: string } | null {
    if (key.startsWith('canon:')) return { packId: 'canon', path: key.slice(6) };
    if (key.startsWith('local:')) {
      const rest = key.slice(6), i = rest.indexOf('/');
      return i > 0 ? { packId: rest.slice(0, i), path: rest.slice(i + 1) } : null;
    }
    return null;
  }
  pack(id: string) { return this.packs.find((p) => p.id === id); }
  entry(key: AssetKey | null | undefined): AssetEntry | undefined {
    if (!key) return undefined;
    const k = this.parse(key);
    return k ? this.pack(k.packId)?.byPath.get(k.path) : undefined;
  }
  /** Комплект по ключу «<набор>|<id комплекта>». */
  setKey(packId: string, setId: string) { return `${packId}|${setId}`; }
  set(key: string | null | undefined): { pack: Pack; set: SetEntry } | undefined {
    if (!key) return undefined;
    const i = key.indexOf('|');
    const pack = this.pack(key.slice(0, i));
    const set = pack?.setById.get(key.slice(i + 1));
    return pack && set ? { pack, set } : undefined;
  }
  /** Варианты того же объекта (группа в папке) — ключи; без группы — только он сам. */
  variants(key: AssetKey): AssetKey[] {
    const k = this.parse(key), pack = k ? this.pack(k.packId) : undefined, e = k ? pack?.byPath.get(k.path) : undefined;
    if (!k || !pack || !e) return [key];
    return groupMembers(pack.assets, e).map((p) => this.key(pack.id, p));
  }
  all(kind?: AssetEntry['kind']): { key: AssetKey; entry: AssetEntry; pack: Pack }[] {
    const out: { key: AssetKey; entry: AssetEntry; pack: Pack }[] = [];
    for (const p of this.packs) for (const a of p.assets) if (!kind || a.kind === kind) out.push({ key: this.key(p.id, a.path), entry: a, pack: p });
    return out;
  }

  url(key: AssetKey): string | null {
    const k = this.parse(key);
    if (!k) return null;
    if (k.packId === 'canon') return CANON_URL + k.path.split('/').map(encodeURIComponent).join('/');
    const cached = this.urls.get(key);
    if (cached) return cached;
    const blob = this.pack(k.packId)?.files?.get(k.path);
    if (!blob) return null;
    const u = URL.createObjectURL(blob);
    this.urls.set(key, u);
    return u;
  }

  async blob(key: AssetKey): Promise<Blob | null> {
    const k = this.parse(key);
    if (!k) return null;
    const local = this.pack(k.packId)?.files?.get(k.path);
    if (local) return local;
    const u = this.url(key);
    if (!u) return null;
    const res = await fetch(u);
    return res.ok ? res.blob() : null;
  }

  // ---------- картинки
  private img(key: AssetKey): Img | null {
    let im = this.imgs.get(key);
    if (im) return im;
    const u = this.url(key);
    if (!u) return null;
    const el = new Image();
    el.decoding = 'async';
    im = { el, ok: false, failed: false, svg: key.toLowerCase().endsWith('.svg') };
    const done = () => { (this.waiters.get(key) ?? []).forEach((f) => f()); this.waiters.delete(key); this.emit(); };
    el.onload = () => { im!.ok = true; done(); };
    el.onerror = () => { im!.failed = true; done(); };
    el.src = u;
    this.imgs.set(key, im);
    return im;
  }

  /** Готовая к рисованию картинка; null — ещё грузится или ассета нет. pxPerCell — экранный масштаб. tint — оттенок. */
  source(key: AssetKey, pxPerCell: number, tint?: string | null): CanvasImageSource | null {
    const base = this.baseSource(key, pxPerCell);
    if (!base || !tint) return base;
    const src = base as HTMLCanvasElement | HTMLImageElement;
    const w = src instanceof HTMLImageElement ? src.naturalWidth : src.width, h = src instanceof HTMLImageElement ? src.naturalHeight : src.height;
    const tk = `${key}|${w}x${h}|${tint}`;
    let c = this.rasters.get(tk);
    if (!c) {
      // умножаем цвета на оттенок и возвращаем исходную прозрачность
      c = document.createElement('canvas');
      c.width = Math.max(1, w); c.height = Math.max(1, h);
      const g = c.getContext('2d')!;
      g.drawImage(src, 0, 0, c.width, c.height);
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = tint;
      g.fillRect(0, 0, c.width, c.height);
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(src, 0, 0, c.width, c.height);
      this.rasters.set(tk, c);
    }
    return c;
  }

  private baseSource(key: AssetKey, pxPerCell: number): CanvasImageSource | null {
    const im = this.img(key);
    if (!im || !im.ok) return null;
    if (!im.svg) return im.el;
    const e = this.entry(key);
    const [fw, fh] = e?.footprint ?? [1, 1];
    const b = bucket(pxPerCell);
    const rk = `${key}|${b}`;
    let c = this.rasters.get(rk);
    if (!c) {
      c = document.createElement('canvas');
      const k = Math.min(1, MAX_RASTER / Math.max(fw * b, fh * b));
      c.width = Math.max(1, Math.round(fw * b * k));
      c.height = Math.max(1, Math.round(fh * b * k));
      c.getContext('2d')!.drawImage(im.el, 0, 0, c.width, c.height);
      this.rasters.set(rk, c);
    }
    return c;
  }

  /** Исходная картинка без пересчёта под клетки (фон-подложка этажа). */
  rawImage(key: AssetKey): HTMLImageElement | null {
    const im = this.img(key);
    return im?.ok ? im.el : null;
  }

  isMissing(key: AssetKey): boolean {
    const im = this.img(key);
    return !im || im.failed;
  }

  /** Бесшовная текстура (пол, стена): одна плитка = footprint клеток. ctx должен быть в координатах клеток. */
  pattern(ctx: CanvasRenderingContext2D, key: AssetKey, pxPerCell: number): CanvasPattern | null {
    const src = this.source(key, pxPerCell) as HTMLCanvasElement | HTMLImageElement | null;
    if (!src) return null;
    let byCtx = this.patterns.get(ctx);
    if (!byCtx) { byCtx = new Map(); this.patterns.set(ctx, byCtx); }
    const pk = `${key}|${src.width}`;
    let p = byCtx.get(pk);
    if (!p) {
      p = ctx.createPattern(src, 'repeat')!;
      const [fw] = this.entry(key)?.footprint ?? [1, 1];
      p.setTransform(new DOMMatrix().scale(fw / src.width));
      byCtx.set(pk, p);
    }
    return p;
  }

  /** Ждёт загрузки картинок (для экспорта). */
  whenLoaded(keys: AssetKey[]): Promise<void> {
    return Promise.all(keys.map((k) => new Promise<void>((resolve) => {
      const im = this.img(k);
      if (!im || im.ok || im.failed) { resolve(); return; }
      const list = this.waiters.get(k) ?? [];
      list.push(resolve);
      this.waiters.set(k, list);
    }))).then(() => undefined);
  }

  // ---------- локальные наборы
  /** Подключает набор из файлов (пути относительно папки набора). id — чтобы сохранить ключи карты из файла. */
  async addLocalPack(label: string, files: { path: string; blob: Blob }[], id = uid('p'), handle?: FileSystemDirectoryHandle): Promise<Pack | null> {
    const stored: StoredPackFile[] = [];
    const metas: Record<string, unknown> = {};
    for (const f of files) {
      const name = f.path.slice(f.path.lastIndexOf('/') + 1);
      if (name === '_meta.json') {
        try { metas[f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''] = JSON.parse(await f.blob.text()); }
        catch { /* битый _meta.json пропускаем */ }
        continue;
      }
      if (!isImage(f.path)) continue;
      stored.push({ path: f.path, blob: f.blob, size: await imageSize(f.path, f.blob) });
    }
    if (!stored.length) return null;
    const sp: StoredPack = { id, label, createdAt: Date.now(), files: stored, metas, ...(handle ? { handle } : {}) };
    await putPack(sp);
    const pack = this.packFromStored(sp);
    this.packs = [...this.packs.filter((p) => p.id !== id), pack];
    this.emit();
    return pack;
  }

  /**
   * Новая разметка (_meta.json по папкам) набора: набор пересобирается сразу.
   * Локальный — сохраняется в браузере; канон — только до перезагрузки (канон правится в репозитории).
   */
  async updateMetas(id: string, metas: Record<string, unknown>) {
    const p = this.pack(id);
    if (!p) return;
    const clean = Object.fromEntries(Object.entries(metas).filter(([, m]) => m && typeof m === 'object' && Object.keys(m).length));
    const { tree, assets, sets } = buildPack(p.assets.map((a) => ({ path: a.path, size: a.size ?? null })), clean);
    const next = this.makePack(p.id, p.label, p.local, tree, assets, sets, p.files, clean, p.handle);
    if (p.local) {
      const old = (await packDb.all()).find((x) => x.id === id);
      if (old) await putPack({ ...old, metas: clean });
    }
    // размеры в клетках могли поменяться — растры SVG пересоздаются
    const prefix = id === 'canon' ? 'canon:' : `local:${id}/`;
    for (const k of [...this.rasters.keys()]) if (k.startsWith(prefix)) this.rasters.delete(k);
    this.packs = this.packs.map((x) => (x.id === id ? next : x));
    this.emit();
  }

  /** Записывает _meta.json в папку набора на диске. false — записать некуда или не дали доступ. */
  async writeMetasToDisk(id: string, dirs: string[]): Promise<boolean> {
    const p = this.pack(id);
    const root = p?.handle as (FileSystemDirectoryHandle & { requestPermission?(o: unknown): Promise<string> }) | undefined;
    if (!p || !root) return false;
    try {
      if (root.requestPermission && (await root.requestPermission({ mode: 'readwrite' })) !== 'granted') return false;
      for (const dir of dirs) {
        let h: FileSystemDirectoryHandle = root;
        for (const part of dir ? dir.split('/') : []) h = await h.getDirectoryHandle(part, { create: true });
        const meta = p.metas[dir];
        if (!meta || !Object.keys(meta).length) {
          try { await h.removeEntry('_meta.json'); } catch { /* файла и не было */ }
          continue;
        }
        const fh = await h.getFileHandle('_meta.json', { create: true });
        const w = await (fh as unknown as { createWritable(): Promise<{ write(t: string): Promise<void>; close(): Promise<void> }> }).createWritable();
        await w.write(`${JSON.stringify(meta, null, 2)}\n`);
        await w.close();
      }
      return true;
    } catch (e) {
      console.error('Не удалось записать _meta.json', e);
      return false;
    }
  }

  async removePack(id: string) {
    await packDb.del(id);
    for (const [k, u] of this.urls) if (k.startsWith(`local:${id}/`)) { URL.revokeObjectURL(u); this.urls.delete(k); }
    for (const k of [...this.imgs.keys()]) if (k.startsWith(`local:${id}/`)) this.imgs.delete(k);
    for (const k of [...this.rasters.keys()]) if (k.startsWith(`local:${id}/`)) this.rasters.delete(k);
    this.packs = this.packs.filter((p) => p.id !== id);
    this.emit();
  }
}

/** Все _meta.json набора одним ZIP (пути как в папке набора). */
export function metasZip(metas: Record<string, unknown>): Promise<Blob> {
  const zip = new JSZip();
  for (const [dir, meta] of Object.entries(metas)) zip.file(`${dir ? `${dir}/` : ''}_meta.json`, `${JSON.stringify(meta, null, 2)}\n`);
  return zip.generateAsync({ type: 'blob' });
}

/** Сохраняет набор; если браузер не умеет хранить ссылку на папку — без неё. */
async function putPack(sp: StoredPack) {
  try { await packDb.put(sp); } catch (e) {
    if (!sp.handle) throw e;
    const { handle: _h, ...rest } = sp;
    await packDb.put(rest);
  }
}

async function imageSize(path: string, blob: Blob): Promise<{ w: number; h: number } | null> {
  const low = path.toLowerCase();
  try {
    if (low.endsWith('.svg')) return svgSize(await blob.text());
    if (low.endsWith('.png')) { const s = pngSize(new Uint8Array(await blob.slice(0, 32).arrayBuffer())); if (s) return s; }
    const bmp = await createImageBitmap(blob);
    const s = { w: bmp.width, h: bmp.height };
    bmp.close();
    return s;
  } catch { return null; }
}

/** Выбор папки с диска: Chrome/Edge — showDirectoryPicker, остальные — input webkitdirectory. */
export async function pickFolder(): Promise<{ label: string; files: { path: string; blob: Blob }[]; handle?: FileSystemDirectoryHandle } | null> {
  const w = window as unknown as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> };
  if (w.showDirectoryPicker) {
    let dir: FileSystemDirectoryHandle;
    try { dir = await w.showDirectoryPicker(); } catch { return null; }
    const files: { path: string; blob: Blob }[] = [];
    const walk = async (h: FileSystemDirectoryHandle, prefix: string) => {
      for await (const [name, entry] of (h as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
        if (name.startsWith('.')) continue;
        if (entry.kind === 'directory') await walk(entry as FileSystemDirectoryHandle, `${prefix}${name}/`);
        else files.push({ path: `${prefix}${name}`, blob: await (entry as FileSystemFileHandle).getFile() });
      }
    };
    await walk(dir, '');
    return { label: dir.name, files, handle: dir };
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    (input as unknown as { webkitdirectory: boolean }).webkitdirectory = true;
    input.onchange = () => {
      const list = [...(input.files ?? [])];
      if (!list.length) { resolve(null); return; }
      const rel = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      const top = rel(list[0]).split('/')[0];
      resolve({
        label: top,
        files: list.map((f) => ({ path: rel(f).split('/').slice(1).join('/') || f.name, blob: f })),
      });
    };
    input.click();
  });
}
