// Базовый мир (world.json) как канон: право на правку и публикация из Ширмы.
// Формат хранения — site/canon-core.js (общий с админ-панелью), права — firestore.rules (canCanon('world')).
import { collection, doc, getDoc, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from './firebase';
// @ts-ignore — обычный JS-модуль сайта
import { CODER_EMAILS } from '../../../site/access-config.js';
// @ts-ignore
import { auditEntry, canonFileId, canonWrite, joinChunks } from '../../../site/canon-core.js';

export const WORLD_REL = 'world/world.json';

/** Папка языка сайта: Rus | Eng (site/i18n.js). */
export function langDir(): 'Rus' | 'Eng' {
  const i18n = (window as unknown as { I18N?: { lang?: string } }).I18N;
  return i18n?.lang === 'en' ? 'Eng' : 'Rus';
}

/** Может ли аккаунт править канон раздела: Кодер, Гл-Админ или Админ с этим разделом (roles/<uid>). */
export async function canEditCanon(user: User | null, group: string): Promise<boolean> {
  if (!user?.email) return false;
  if ((CODER_EMAILS as string[]).includes(user.email.toLowerCase())) return true;
  try {
    const snap = await getDoc(doc(db, 'roles', user.uid));
    const r = snap.exists() ? snap.data() : null;
    if (r?.role === 'headadmin') return true;
    return r?.role === 'admin' && Array.isArray(r.perms?.canon) && r.perms.canon.includes(group);
  } catch { return false; }
}

type Manifest = { version: number; chunks: number; updatedByNick?: string };

/** Текущий файл: из Firestore (с версией) или из Assets/ (версия 0 — ещё не перенесён). */
export async function loadCanonFile(lang: string, rel: string): Promise<{ version: number; current: Manifest | null; text: string | null }> {
  const id = canonFileId(lang, rel);
  for (let attempt = 0; attempt < 3; attempt++) {
    const m = await getDoc(doc(db, 'canon', id));
    if (!m.exists()) break;
    const manifest = m.data() as Manifest;
    const chunks = await getDocs(collection(db, 'canon', id, 'chunks'));
    const text = joinChunks(manifest, chunks.docs.map((d) => ({ id: d.id, ...d.data() })));
    if (text != null) return { version: manifest.version, current: manifest, text };
    await new Promise((r) => setTimeout(r, 400)); // файл как раз сохраняют
  }
  const res = await fetch(`Assets/${lang}/${rel}`, { cache: 'no-cache' });
  return { version: 0, current: null, text: res.ok ? await res.text() : null };
}

/** Записать файл одной пачкой: куски + манифест + запись в журнал. */
export async function saveCanonFile(user: User, lang: string, rel: string, text: string, current: Manifest | null,
  { note = '', nick = '', details = '' } = {}): Promise<number> {
  const w = canonWrite({ lang, rel, text, current, uid: user.uid, nick, note });
  const batch = writeBatch(db);
  for (const [cid, data] of w.chunks as [string, object][]) batch.set(doc(db, 'canon', w.id, 'chunks', cid), data);
  for (const cid of w.stale as string[]) batch.delete(doc(db, 'canon', w.id, 'chunks', cid));
  batch.set(doc(db, 'canon', w.id), { ...w.manifest, updatedAt: serverTimestamp() });
  batch.set(doc(collection(db, 'audit')), {
    ...auditEntry({ uid: user.uid, nick, action: current ? 'canon.save' : 'canon.import', target: `${lang}/${rel} v${w.version}`, details }),
    at: serverTimestamp(),
  });
  await batch.commit();
  try { sessionStorage.removeItem('canon.m.' + w.id); } catch { /* ignore */ }
  return w.version;
}
