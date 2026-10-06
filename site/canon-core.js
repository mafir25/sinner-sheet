// Формат хранения канона в Firestore — без зависимостей, общий для админ-панели (site/canon.js) и Ширмы.
//   canon/<Rus|Eng>__<группа>__<файл>   — манифест { lang, group, name, version, chunks, size, updatedAt, updatedBy, … }
//   canon/<…>/chunks/000, 001, …        — { data: кусок текста файла, v: версия }
// Документ Firestore не больше 1 МБ, поэтому текст режется на куски по CHUNK_CHARS символов
// (≤ 3 байта UTF-8 на символ → кусок ≤ 840 КБ). Правила требуют version = старая + 1.
export const CHUNK_CHARS = 280_000;

export const canonFileId = (lang, rel) => `${lang}__${rel.replace('/', '__')}`;
export const chunkId = (i) => String(i).padStart(3, '0');
export const byteSize = (s) => new TextEncoder().encode(s).length;

export function splitText(text) {
  const parts = [];
  for (let i = 0; i < text.length;) {
    let end = Math.min(text.length, i + CHUNK_CHARS);
    // не разрываем суррогатную пару (эмодзи и т. п.)
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    parts.push(text.slice(i, end));
    i = end;
  }
  return parts.length ? parts : [''];
}

/** Склеить куски; null — если файл как раз сохраняют (кусков не хватает или они от другой версии). */
export function joinChunks(manifest, chunks) {
  const list = [...chunks].sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, manifest.chunks);
  if (list.length < manifest.chunks || list.some((c) => c.v !== manifest.version)) return null;
  return list.map((c) => c.data).join('');
}

/**
 * Описание записи файла: какие документы положить в одну пачку.
 * Возвращает { manifest, chunks: [[id, data]], stale: [id…] } — stale нужно удалить (их было больше).
 */
export function canonWrite({ lang, rel, text, current, uid, nick = '', note = '' }) {
  const [group, name] = rel.split('/');
  const parts = splitText(text);
  const version = (current?.version || 0) + 1;
  const stale = [];
  for (let i = parts.length; i < (current?.chunks || 0); i++) stale.push(chunkId(i));
  return {
    id: canonFileId(lang, rel),
    version,
    chunks: parts.map((data, i) => [chunkId(i), { data, v: version }]),
    stale,
    manifest: {
      lang, group, name, version, chunks: parts.length, size: byteSize(text),
      updatedBy: uid, updatedByNick: String(nick).slice(0, 40), note: String(note).slice(0, 300),
    },
  };
}

/** Запись журнала (без at — время ставит сервер). */
export const auditEntry = ({ uid, nick = '', action, target = '', details = '' }) => ({
  uid, nick: String(nick).slice(0, 40), action, target: String(target).slice(0, 300),
  details: (typeof details === 'string' ? details : JSON.stringify(details)).slice(0, 60000),
});
