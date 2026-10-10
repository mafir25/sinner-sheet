// IndexedDB браузера: карты (автосохранение) и локальные наборы ассетов. На сервер ничего не уходит.
import type { MapDoc } from '../model/types';

const DB = 'pm-maps';
// 2: база могла появиться пустой (её открывала Ширма, site/site-links.js) — хранилища досоздаются
// 3: версии карт (снимки перед генерацией и по времени)
const VERSION = 3;

/** fileSavedAt — когда карту последний раз сохраняли в файл или открывали из файла (0 — ни разу). */
export type StoredMap = { id: string; name: string; updatedAt: number; thumb: string; doc: MapDoc; fileSavedAt?: number };
/** Карта есть только в браузере: в файл её не сохраняли или после сохранения меняли. */
export const unsavedToFile = (m: { updatedAt: number; fileSavedAt?: number }) => !m.fileSavedAt || m.updatedAt > m.fileSavedAt;
export type StoredPackFile = { path: string; blob: Blob; size: { w: number; h: number } | null };
export type StoredPack = {
  id: string; label: string; createdAt: number; files: StoredPackFile[]; metas: Record<string, unknown>;
  /** Папка на диске (Chrome/Edge): туда редактор разметки записывает _meta.json. */
  handle?: FileSystemDirectoryHandle;
};

let dbp: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('maps')) db.createObjectStore('maps', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('packs')) db.createObjectStore('packs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('versions')) db.createObjectStore('versions', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbp = null; reject(req.error); };
    });
  }
  return dbp;
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error ?? req.error);
    tx.onabort = () => reject(tx.error ?? new Error('aborted'));
  }));
}

export const maps = {
  put: (m: StoredMap) => run('maps', 'readwrite', (s) => s.put(m)),
  get: (id: string) => run<StoredMap | undefined>('maps', 'readonly', (s) => s.get(id)),
  del: (id: string) => run('maps', 'readwrite', (s) => s.delete(id)),
  /** Список без самих документов — для стартового экрана. */
  async list(): Promise<Omit<StoredMap, 'doc'>[]> {
    const all = await run<StoredMap[]>('maps', 'readonly', (s) => s.getAll());
    return all.map(({ doc: _doc, ...rest }) => rest).sort((a, b) => b.updatedAt - a.updatedAt);
  },
};

export const packs = {
  put: (p: StoredPack) => run('packs', 'readwrite', (s) => s.put(p)),
  del: (id: string) => run('packs', 'readwrite', (s) => s.delete(id)),
  all: () => run<StoredPack[]>('packs', 'readonly', (s) => s.getAll()),
};

/** Снимок карты: key = «<id карты>|<время>», reason — почему снят. */
export type MapVersion = { key: string; mapId: string; at: number; reason: 'gen' | 'auto' | 'restore'; name: string; thumb: string; doc: MapDoc };
const VERSIONS_PER_MAP = 10;
const range = (mapId: string) => IDBKeyRange.bound(`${mapId}|`, `${mapId}|\uffff`);

export const versions = {
  /** Снимки карты, новые первыми. */
  async list(mapId: string): Promise<MapVersion[]> {
    const all = await run<MapVersion[]>('versions', 'readonly', (s) => s.getAll(range(mapId)));
    return all.sort((a, b) => b.at - a.at);
  },
  /** Новый снимок; у карты остаются последние VERSIONS_PER_MAP. */
  async add(v: Omit<MapVersion, 'key'>) {
    await run('versions', 'readwrite', (s) => s.put({ ...v, key: `${v.mapId}|${String(v.at).padStart(15, '0')}` }));
    const old = (await versions.list(v.mapId)).slice(VERSIONS_PER_MAP);
    for (const o of old) await run('versions', 'readwrite', (s) => s.delete(o.key));
  },
  clear: (mapId: string) => run('versions', 'readwrite', (s) => s.delete(range(mapId))),
};
