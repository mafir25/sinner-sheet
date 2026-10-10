// Файл карты .pmmap — ZIP: map.json + assets/<id набора>/<путь> (только локальные ассеты) + assets/packs.json.
import JSZip from 'jszip';
import type { AssetStore } from '../assets/store';
import type { MapDoc } from '../model/types';
import { parseDoc } from '../model/doc';

export const EXT = '.pmmap';

/** Все ассеты карты: и для .pmmap (локальные кладутся внутрь), и для предзагрузки перед экспортом. */
export function usedAssetKeys(doc: MapDoc): Set<string> {
  const keys = new Set<string>();
  const add = (k: string | null | undefined) => { if (k) keys.add(k); };
  for (const f of doc.floors) {
    add(f.ground);
    add(f.image?.asset);
    for (const r of f.rooms) {
      add(r.floor); add(r.wall.asset);
      for (const e of r.edgeStyles ?? []) add(e.style.asset);
    }
    for (const w of f.walls) add(w.wall.asset);
    for (const p of f.portals) add(p.asset);
    for (const o of f.objects) add(o.asset);
    for (const t of f.terrain) add(t.asset);
    for (const pa of f.paths) { add(pa.style.asset); add(pa.style.decor); }
    for (const r of f.roofs) add(r.asset);
  }
  return keys;
}

export async function buildPmmap(doc: MapDoc, assets: AssetStore): Promise<Blob> {
  const zip = new JSZip();
  zip.file('map.json', JSON.stringify(doc));
  const labels: Record<string, string> = {};
  for (const key of usedAssetKeys(doc)) {
    const k = assets.parse(key);
    if (!k || k.packId === 'canon') continue;
    const blob = await assets.blob(key);
    if (!blob) continue;
    zip.file(`assets/${k.packId}/${k.path}`, blob);
    labels[k.packId] = assets.pack(k.packId)?.label ?? k.packId;
  }
  // настройки папок (_meta.json) локальных наборов — чтобы названия и правила пережили перенос
  for (const id of Object.keys(labels)) {
    for (const [dir, meta] of Object.entries(assets.pack(id)?.metas ?? {})) {
      zip.file(`assets/${id}/${dir ? `${dir}/` : ''}_meta.json`, JSON.stringify(meta));
    }
  }
  if (Object.keys(labels).length) zip.file('assets/packs.json', JSON.stringify(labels));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

export type Embedded = { id: string; label: string; files: { path: string; blob: Blob }[] };

export async function readPmmap(file: Blob): Promise<{ doc: MapDoc; embedded: Embedded[] }> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (head[0] !== 0x50 || head[1] !== 0x4b) {
    // голый map.json
    return { doc: parseDoc(JSON.parse(await file.text())), embedded: [] };
  }
  const zip = await JSZip.loadAsync(file);
  const mapFile = zip.file('map.json');
  if (!mapFile) throw new Error('map.json');
  const doc = parseDoc(JSON.parse(await mapFile.async('string')));
  let labels: Record<string, string> = {};
  const lf = zip.file('assets/packs.json');
  if (lf) { try { labels = JSON.parse(await lf.async('string')); } catch { /* без подписей */ } }
  const byPack = new Map<string, Embedded>();
  const entries = zip.file(/^assets\/[^/]+\/.+/);
  for (const e of entries) {
    const rest = e.name.slice('assets/'.length);
    const i = rest.indexOf('/');
    const id = rest.slice(0, i), path = rest.slice(i + 1);
    if (!id || !path || e.dir) continue;
    let pack = byPack.get(id);
    if (!pack) { pack = { id, label: labels[id] ?? id, files: [] }; byPack.set(id, pack); }
    pack.files.push({ path, blob: await e.async('blob') });
  }
  return { doc, embedded: [...byPack.values()] };
}

export const safeName = (s: string) => (s.trim() || 'map').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);

export function download(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

type SaveHandle = { createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }>; name: string };
type PickerWin = { showSaveFilePicker?: (o: unknown) => Promise<SaveHandle> };

/**
 * Сохраняет файл. В Chrome/Edge — через окно сохранения, и дальше Ctrl+S пишет в тот же файл (handle).
 * В остальных браузерах — обычное скачивание.
 */
export async function saveBlob(blob: Blob, filename: string, handle: SaveHandle | null, askWhere: boolean): Promise<{ handle: SaveHandle | null; name: string } | null> {
  const w = window as unknown as PickerWin;
  if (handle && !askWhere) {
    const s = await handle.createWritable();
    await s.write(blob); await s.close();
    return { handle, name: handle.name };
  }
  if (w.showSaveFilePicker) {
    let h: SaveHandle;
    try {
      h = await w.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'Project Moon map', accept: { 'application/zip': [EXT] } }],
      });
    } catch { return null; } // окно закрыли
    const s = await h.createWritable();
    await s.write(blob); await s.close();
    return { handle: h, name: h.name };
  }
  download(blob, filename);
  return { handle: null, name: filename };
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
