// Работа с ширмами в Firestore.
// custom_screens/{id}            — метаданные и доступы
// custom_screens/{id}/items/{i}  — видимые всем зрителям объекты
// custom_screens/{id}/secret/{i} — скрытые («туман войны»), читают только админы
import {
  collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, setDoc, where, writeBatch,
  type DocumentData, type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from './firebase';
import { migrateV1, type V1Graph } from '../model/migrate';
import { type AccessLevel, type Item, type ItemMap, type ScreenMeta, SCHEMA_VERSION, parseItem } from '../model/schema';

const SCREENS = 'custom_screens';

/** Данные сайта на выбранном языке (site/i18n.js): Assets/<Eng|Rus>/<name> с запасными путями. */
function fetchData(name: string, init?: RequestInit): Promise<Response> {
  const i18n = (window as unknown as { I18N?: { fetchData(n: string, i?: RequestInit): Promise<Response> } }).I18N;
  return i18n ? i18n.fetchData(name, init) : fetch(`/${name}`, init);
}

function toMeta(id: string, d: DocumentData): ScreenMeta {
  return {
    id,
    name: String(d.name ?? 'Без названия'),
    creatorEmail: String(d.creatorEmail ?? ''),
    accessLevel: (['private', 'friends', 'public'].includes(d.accessLevel) ? d.accessLevel : 'private') as AccessLevel,
    allowedUsers: Array.isArray(d.allowedUsers) ? d.allowedUsers : [],
    adminUsers: Array.isArray(d.adminUsers) ? d.adminUsers : [],
    schemaVersion: typeof d.schemaVersion === 'number' ? d.schemaVersion : 1,
    legacyGraph: d.schemaVersion === SCHEMA_VERSION ? undefined : d.graphData,
    hasLegacyData: d.schemaVersion === SCHEMA_VERSION && !!d.graphData,
  };
}

export function canAdmin(meta: ScreenMeta | undefined, email: string | null | undefined): boolean {
  if (!meta || meta.isLocal || !email) return false;
  return meta.creatorEmail === email || meta.adminUsers.includes(email);
}

/** Базовый мир сайта (world.json): массив ширм старого формата, только чтение. */
export async function loadBaseWorld(): Promise<ScreenMeta[]> {
  try {
    const res = await fetchData('world.json', { cache: 'no-cache' });
    if (!res.ok) return [];
    const arr = await res.json();
    if (!Array.isArray(arr)) return [];
    return arr.map((s: { id?: string; name?: string; graphData?: V1Graph }, i: number) => ({
      id: `base:${s.id ?? i}`,
      name: s.name ?? `Мир ${i + 1}`,
      creatorEmail: '',
      accessLevel: 'public' as AccessLevel,
      allowedUsers: [], adminUsers: [],
      schemaVersion: SCHEMA_VERSION,
      isLocal: true,
      localItems: migrateV1(s.graphData),
    }));
  } catch (e) {
    console.warn('world.json не загрузился', e);
    return [];
  }
}

export type ScreenGroup = 'base' | 'mine' | 'admin' | 'friends' | 'public';
export type ListedScreen = ScreenMeta & { group: ScreenGroup };

/** Все ширмы, доступные пользователю. Каждый запрос независим: ошибка одного не ломает остальные. */
export async function listScreens(email: string): Promise<ListedScreen[]> {
  const col = collection(db, SCREENS);
  const queries: [ScreenGroup, ReturnType<typeof query>][] = [
    ['mine', query(col, where('creatorEmail', '==', email))],
    ['admin', query(col, where('adminUsers', 'array-contains', email))],
    ['friends', query(col, where('allowedUsers', 'array-contains', email))],
    ['public', query(col, where('accessLevel', '==', 'public'))],
  ];
  const seen = new Map<string, ListedScreen>();
  const results = await Promise.allSettled(queries.map(([, q]) => getDocs(q)));
  results.forEach((r, i) => {
    if (r.status !== 'fulfilled') { console.warn('Запрос ширм не удался', queries[i][0], r.reason); return; }
    r.value.forEach((d: QueryDocumentSnapshot) => {
      if (!seen.has(d.id)) seen.set(d.id, { ...toMeta(d.id, d.data()), group: queries[i][0] });
    });
  });
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

export async function getScreenMeta(id: string): Promise<ScreenMeta | null> {
  const s = await getDoc(doc(db, SCREENS, id));
  return s.exists() ? toMeta(s.id, s.data()) : null;
}

/** Подписка на объекты ширмы. Для админа — ещё и на скрытые. */
export function subscribeItems(
  meta: ScreenMeta,
  admin: boolean,
  onChange: (upserts: Item[], removedIds: string[], part: 'items' | 'secret') => void,
  onError: (e: unknown) => void,
): () => void {
  const subs: (() => void)[] = [];
  const parts: ('items' | 'secret')[] = admin ? ['items', 'secret'] : ['items'];
  for (const part of parts) {
    subs.push(onSnapshot(collection(db, SCREENS, meta.id, part), { includeMetadataChanges: false }, (snap) => {
      const ups: Item[] = []; const rem: string[] = [];
      snap.docChanges().forEach((ch) => {
        if (ch.doc.id.startsWith('__')) return; // служебные документы (резервная копия)
        if (ch.type === 'removed') { rem.push(ch.doc.id); return; }
        const it = parseItem({ ...ch.doc.data(), id: ch.doc.id });
        if (it) ups.push(it);
      });
      onChange(ups, rem, part);
    }, onError));
  }
  return () => subs.forEach((u) => u());
}

/** В какую подколлекцию кладётся item: скрытое и связи со скрытыми — в secret. */
export function partOf(item: Item, all: ItemMap): 'items' | 'secret' {
  if (item.hidden) return 'secret';
  if (item.kind === 'link') {
    const a = all[item.from], b = all[item.to];
    if ((a && a.hidden) || (b && b.hidden)) return 'secret';
  }
  return 'items';
}

/** Записывает изменения пачками. upserts — новые/изменённые, deletes — id удалённых. */
export async function saveChanges(screenId: string, upserts: Item[], deletes: string[], all: ItemMap): Promise<void> {
  const ops: ((b: ReturnType<typeof writeBatch>) => void)[] = [];
  for (const it of upserts) {
    const part = partOf(it, all);
    const other = part === 'items' ? 'secret' : 'items';
    const data = JSON.parse(JSON.stringify(it)); // убираем undefined
    ops.push((b) => b.set(doc(db, SCREENS, screenId, part, it.id), data));
    ops.push((b) => b.delete(doc(db, SCREENS, screenId, other, it.id)));
  }
  for (const id of deletes) {
    ops.push((b) => b.delete(doc(db, SCREENS, screenId, 'items', id)));
    ops.push((b) => b.delete(doc(db, SCREENS, screenId, 'secret', id)));
  }
  for (let i = 0; i < ops.length; i += 450) {
    const b = writeBatch(db);
    ops.slice(i, i + 450).forEach((op) => op(b));
    await b.commit();
  }
}

/** Перевод старой ширмы: все items + резервная копия старых данных (только для админов) + новая версия. */
export async function finishMigration(meta: ScreenMeta, items: ItemMap): Promise<void> {
  await saveChanges(meta.id, Object.values(items), [], items);
  if (meta.legacyGraph) {
    await setDoc(doc(db, SCREENS, meta.id, 'secret', '__legacy_backup'), { graphData: meta.legacyGraph, savedAt: Date.now() });
  }
  // старый graphData НЕ удаляем: пока на сайте работает старая страница, она продолжит его видеть.
  // Создатель может удалить его кнопкой в настройках (это закрывает доступ игроков к скрытым узлам старой копии).
  await setDoc(doc(db, SCREENS, meta.id), { schemaVersion: SCHEMA_VERSION }, { merge: true });
}

export async function clearLegacyData(id: string): Promise<void> {
  await setDoc(doc(db, SCREENS, id), { graphData: null }, { merge: true });
}

export async function createScreen(name: string, accessLevel: AccessLevel, email: string): Promise<string> {
  const id = 'scr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await setDoc(doc(db, SCREENS, id), {
    name, creatorEmail: email, accessLevel, allowedUsers: [], adminUsers: [], schemaVersion: SCHEMA_VERSION, createdAt: Date.now(),
  });
  return id;
}

export async function updateScreen(id: string, patch: Partial<Pick<ScreenMeta, 'name' | 'accessLevel' | 'allowedUsers' | 'adminUsers'>>) {
  await setDoc(doc(db, SCREENS, id), patch, { merge: true });
}

export async function deleteScreen(meta: ScreenMeta): Promise<void> {
  for (const part of ['items', 'secret']) {
    const snap = await getDocs(collection(db, SCREENS, meta.id, part));
    const ids = snap.docs.map((d) => d.id);
    for (let i = 0; i < ids.length; i += 450) {
      const b = writeBatch(db);
      ids.slice(i, i + 450).forEach((iid) => b.delete(doc(db, SCREENS, meta.id, part, iid)));
      await b.commit();
    }
  }
  await deleteDoc(doc(db, SCREENS, meta.id));
}

// ---------- Заметки мастера (личные, у каждого пользователя свои)
export async function loadNotes(uid: string): Promise<string | null> {
  const s = await getDoc(doc(db, 'gm_notes', uid));
  return s.exists() ? String(s.data().text ?? '') : null;
}
export async function saveNotes(uid: string, text: string): Promise<void> {
  await setDoc(doc(db, 'gm_notes', uid), { text, updatedAt: Date.now() });
}

// ---------- Быстрый импорт из базы сайта
export type ImportCategory = 'status' | 'class' | 'feat' | 'gift' | 'equip' | 'bestiary';
const OFFICIAL_FILES: Record<ImportCategory, string> = {
  status: 'statuses.json', class: 'classes.json', feat: 'feats.json', gift: 'egogifts.json', equip: 'equipment.json', bestiary: 'bestiary.json',
};
const importCache = new Map<string, any[]>();
export async function loadImportList(cat: ImportCategory, source: 'official' | 'custom', email = ''): Promise<any[]> {
  const key = `${source}:${cat}`;
  if (importCache.has(key)) return importCache.get(key)!;
  let arr: any[] = [];
  if (source === 'official') {
    const res = await fetchData(OFFICIAL_FILES[cat]);
    if (res.ok) { const j = await res.json(); arr = Array.isArray(j) ? j : []; }
  } else {
    // Правила Firestore отдают только публичные записи и свои — запрашиваем ровно это.
    const coll = collection(db, 'custom_content');
    const queries = [getDocs(query(coll, where('type', '==', cat), where('isPrivate', '==', false)))];
    if (email) queries.push(getDocs(query(coll, where('type', '==', cat), where('creatorEmail', '==', email))));
    const seen = new Map<string, any>();
    for (const snap of await Promise.all(queries)) {
      snap.forEach((d) => { const v = d.data(); if (v && v.data) seen.set(d.id, v.data); });
    }
    arr = [...seen.values()];
  }
  importCache.set(key, arr);
  return arr;
}
