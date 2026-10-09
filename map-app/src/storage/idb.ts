// IndexedDB браузера: карты (автосохранение) и локальные наборы ассетов. На сервер ничего не уходит.
import type { MapDoc } from '../model/types';

const DB = 'pm-maps';
const VERSION = 1;

export type StoredMap = { id: string; name: string; updatedAt: number; thumb: string; doc: MapDoc };
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
