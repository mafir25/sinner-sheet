// Каноничные данные в Firestore — запись и чтение для админ-панели (admin.html).
// Сайт читает канон сам, через site/i18n.js (REST, кэш по версии, запасной файл из Assets/).
// Формат хранения и нарезка на куски — site/canon-core.js (общий с Ширмой).
// Сохранение — одна пачка (writeBatch): куски + манифест + запись в журнал, поэтому читатель видит
// либо старую версию, либо новую целиком.
import {
  collection, doc, getDoc, getDocs, writeBatch, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';
import { db, auth } from './firebase.js';
import { canonWrite, joinChunks, auditEntry } from './canon-core.js';

export const LANG_DIRS = { Rus: 'Русский', Eng: 'English' };
export const GROUP_NAMES = {
  characters: 'Персонажи', items: 'Предметы', mechanics: 'Механики',
  world: 'Мир', articles: 'Статьи', builder: 'Конструктор',
};

/** Все каноничные файлы: [{ rel: 'characters/feats.json', group, name }]. */
export function canonFiles() {
  return window.I18N.canon.files().map((rel) => {
    const [group, name] = rel.split('/');
    return { rel, group, name };
  });
}
export const fileId = (lang, rel) => window.I18N.canon.id(lang, rel);
export const isJson = (rel) => /\.json$/i.test(rel);

/** Манифест файла в Firestore или null. */
export async function getManifest(lang, rel) {
  const snap = await getDoc(doc(db, 'canon', fileId(lang, rel)));
  return snap.exists() ? snap.data() : null;
}

/** Манифесты всех перенесённых файлов: Map id → manifest. */
export async function listManifests() {
  const snap = await getDocs(collection(db, 'canon'));
  const out = new Map();
  snap.forEach((d) => out.set(d.id, d.data()));
  return out;
}

/** Текст файла из Firestore: { manifest, text } или null, если файл не перенесён. */
export async function loadCanon(lang, rel) {
  const id = fileId(lang, rel);
  for (let attempt = 0; attempt < 3; attempt++) {
    const m = await getManifest(lang, rel);
    if (!m) return null;
    const snap = await getDocs(collection(db, 'canon', id, 'chunks'));
    const text = joinChunks(m, snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    if (text != null) return { manifest: m, text };
    await new Promise((r) => setTimeout(r, 400)); // файл как раз сохраняют — подождём
  }
  throw new Error('Файл сейчас сохраняется кем-то ещё — попробуйте ещё раз');
}

/** Исходный файл из репозитория (Assets/<lang>/<rel>) или null. */
export async function loadStatic(lang, rel) {
  const res = await fetch(`Assets/${lang}/${rel}`, { cache: 'no-cache' });
  return res.ok ? res.text() : null;
}

/** Проверить текст перед сохранением: JSON должен разбираться. Возвращает нормализованный текст. */
export function normalizeText(rel, text) {
  if (!isJson(rel)) return String(text);
  return JSON.stringify(JSON.parse(text)); // компактно — меньше кусков и чтений
}

function auditDoc(batch, entry) {
  batch.set(doc(collection(db, 'audit')), { ...auditEntry({ uid: auth.currentUser.uid, ...entry }), at: serverTimestamp() });
}

/**
 * Сохранить файл в Firestore.
 * baseVersion — версия, которую редактировали (0 — файла ещё нет). Если кто-то успел сохранить раньше,
 * бросает ошибку с code 'canon/conflict'.
 */
export async function saveCanon(lang, rel, text, { baseVersion = 0, note = '', nick = '', audit = {} } = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('Вы не вошли в аккаунт');
  const id = fileId(lang, rel);
  if (!id) throw new Error(`Файл ${rel} не может быть каноном`);
  const body = normalizeText(rel, text);

  const current = await getManifest(lang, rel);
  const curVersion = current ? current.version : 0;
  if (curVersion !== baseVersion) {
    const e = new Error(`Файл уже изменил ${current?.updatedByNick || 'другой админ'} (версия ${curVersion}). Перезагрузите его, чтобы не затереть правки.`);
    e.code = 'canon/conflict';
    throw e;
  }
  const w = canonWrite({ lang, rel, text: body, current, uid: user.uid, nick, note });
  const batch = writeBatch(db);
  w.chunks.forEach(([cid, data]) => batch.set(doc(db, 'canon', id, 'chunks', cid), data));
  w.stale.forEach((cid) => batch.delete(doc(db, 'canon', id, 'chunks', cid)));
  batch.set(doc(db, 'canon', id), { ...w.manifest, updatedAt: serverTimestamp() });
  auditDoc(batch, {
    nick, action: audit.action || (current ? 'canon.save' : 'canon.import'), target: `${lang}/${rel} v${w.version}`,
    details: audit.details || note,
  });
  await batch.commit();
  try { sessionStorage.removeItem('canon.m.' + id); } catch { /* ignore */ }
  return { version: w.version, chunks: w.manifest.chunks, size: w.manifest.size };
}

/** Убрать файл из Firestore — сайт снова будет брать его из Assets/. */
export async function resetCanon(lang, rel, { nick = '' } = {}) {
  const id = fileId(lang, rel);
  const current = await getManifest(lang, rel);
  if (!current) return;
  const chunks = await getDocs(collection(db, 'canon', id, 'chunks'));
  const batch = writeBatch(db);
  chunks.forEach((d) => batch.delete(d.ref));
  batch.delete(doc(db, 'canon', id));
  auditDoc(batch, { nick, action: 'canon.reset', target: `${lang}/${rel}`, details: `Удалена версия ${current.version}; сайт берёт файл из Assets/` });
  await batch.commit();
  try { sessionStorage.removeItem('canon.m.' + id); } catch { /* ignore */ }
}

/** Скачать текст как файл. */
export function download(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
