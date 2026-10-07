/* Service worker сайта: офлайн-доступ и установка как приложения (manifest.webmanifest).
   Свои файлы (страницы, site/, Assets/, сборка Ширмы) — «сначала сеть»: онлайн всегда свежая версия,
   без сети — последняя сохранённая. Firebase SDK с gstatic — из кэша с обновлением в фоне.
   Firestore, вход и прочие API не трогаем: у них свой кэш (канон — Cache Storage в site/i18n.js).
   ВАЖНО: запросы service worker подчиняются connect-src из CSP (vercel.json). Перехватывать можно только
   хосты, разрешённые там; иначе запрос падает и ресурс не загружается вовсе (так ломались иконки Font Awesome
   с cdnjs). Стили, шрифты и иконки с CDN оставлены браузеру — их кэширует обычный HTTP-кэш. */
const VERSION = 'v2';
const LOCAL = `mt-local-${VERSION}`;
const CDN = `mt-cdn-${VERSION}`;
const PRECACHE = ['/', '/index.html', '/navigation.html', '/builder.html', '/egobuilder.html', '/office.html', '/shirm.html',
  '/site/i18n.js', '/site/ui.js', '/manifest.webmanifest', '/Assets/App/icon-192.png'];
// CDN, которые можно хранить: версия зашита в адрес, поэтому файл не меняется; хост обязан быть в connect-src
const CDN_OK = /^https:\/\/www\.gstatic\.com\/firebasejs\//;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(LOCAL).then((c) => Promise.all(PRECACHE.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('mt-') && k !== LOCAL && k !== CDN).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function networkFirst(req) {
  const cache = await caches.open(LOCAL);
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const home = await cache.match('/index.html');
      if (home) return home;
    }
    throw e;
  }
}
async function staleWhileRevalidate(req) {
  const cache = await caches.open(CDN);
  const hit = await cache.match(req);
  const fresh = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await fresh) || Response.error();
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname === '/sw.js') return;
    e.respondWith(networkFirst(req));
  } else if (CDN_OK.test(req.url)) {
    e.respondWith(staleWhileRevalidate(req));
  }
  // остальное (Firestore, вход, курсы валют) — без service worker
});
