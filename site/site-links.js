// Ссылки между частями сайта (этап 5 редактора карт): Ширма ↔ Редактор карт ↔ База знаний.
// Общий код для map-app и shirm-app (собираются Vite) и тестов. Карты живут только в браузере
// (IndexedDB «pm-maps»), поэтому ссылка на карту работает там, где карту открывали или загрузили из .pmmap.

const PAGES = /^\/?(?:maps|navigation|shirm|index|builder|egobuilder|office)\.html(?:[?#]|$)/i;

/** Ссылка на карту: /maps.html#map=<id> (имя — чтобы подсказать, какой файл открыть, если карты нет). */
export function mapUrl(id, name = '') {
  return `/maps.html#map=${encodeURIComponent(id)}${name ? `&name=${encodeURIComponent(name)}` : ''}`;
}

/** Markdown-ссылка на карту для описания узла Ширмы. */
export function mapMarkdown(id, name) {
  return `[🗺 ${escapeMd(name || 'Карта')}](${mapUrl(id, name)})`;
}

/** Разбор #map=<id>&name=… из адреса редактора. */
export function parseMapHash(hash) {
  const p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const id = p.get('map');
  return id ? { id, name: p.get('name') || '' } : null;
}

const escapeMd = (s) => String(s).replace(/[[\]]/g, '');

/**
 * Ссылка, вставленная пользователем (кнопка «Ссылка» у карточки Базы знаний, адрес страницы сайта),
 * → { title, url }. Страницы своего сайта становятся путём от корня (/navigation.html#feats/Имя),
 * чужие http(s) остаются как есть. null — это не ссылка.
 */
export function siteLink(raw, origin = (typeof location !== 'undefined' ? location.origin : 'https://x.invalid')) {
  const s = String(raw || '').trim();
  if (!s) return null;
  let u;
  try { u = new URL(s, `${origin}/`); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const own = u.origin === origin || PAGES.test(s);
  const url = own ? `${u.pathname}${u.search}${u.hash}` : u.href;
  const last = decodeURIComponent((u.hash || u.pathname).split('/').filter(Boolean).pop() || '').replace(/^#/, '');
  const title = last.replace(/^c:/, '').replace(/[-_]+/g, ' ').trim() || u.hostname;
  return { title, url };
}

/** Markdown-ссылка на запись Базы знаний. */
export function kbMarkdown(raw) {
  const l = siteLink(raw);
  return l ? `[📖 ${escapeMd(l.title)}](${l.url})` : null;
}

/** Карты, сохранённые в этом браузере редактором карт (без самих документов). Базу не создаёт. */
export async function listLocalMaps() {
  if (typeof indexedDB === 'undefined') return [];
  if (indexedDB.databases) {
    const dbs = await indexedDB.databases();
    if (!dbs.some((d) => d.name === 'pm-maps')) return [];
  }
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('pm-maps');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  try {
    if (!db.objectStoreNames.contains('maps')) return [];
    const all = await new Promise((resolve, reject) => {
      const req = db.transaction('maps', 'readonly').objectStore('maps').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return all.map((m) => ({ id: m.id, name: m.name, updatedAt: m.updatedAt, thumb: m.thumb }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } finally { db.close(); }
}
