/* Локализация сайта (RU / EN).
   Подключается обычным <script src="site/i18n.js"></script> в <head> КАЖДОЙ страницы — до остальных скриптов.

   Что делает:
   1. Хранит выбранный язык (localStorage 'site.lang', по умолчанию русский). Выбор — в окне настроек (site/ui.js).
   2. Отдаёт данные на нужном языке: I18N.fetchData('feats.json') ищет файл по цепочке
        Firestore canon/Eng__characters__feats.json → Assets/Eng/characters/feats.json →
        Firestore canon/Rus__characters__feats.json → Assets/Rus/characters/feats.json
      Каноничные данные хранятся в Firestore (коллекция canon, правит админ-панель admin.html);
      файлы в Assets/ — запасной вариант, если файл ещё не перенесён или Firestore недоступен.
      Папку (группу) файла знает таблица DATA_GROUPS ниже. Поэтому английский world.json достаточно
      положить в Assets/Eng/world/world.json — он подхватится сам.
   3. В английском режиме переводит интерфейс: подгружает словарь site/i18n-en.js и заменяет
      русские строки в тексте, placeholder/title/aria-label, а также в alert/confirm/prompt.
      Пользовательский ввод (input/textarea) и элементы с классом .notranslate / translate="no" не трогаются. */
(function () {
  'use strict';
  var KEY = 'site.lang';
  var LANGS = { ru: { dir: 'Rus', label: 'Русский' }, en: { dir: 'Eng', label: 'English' } };

  var lang = 'ru';
  try {
    var q = new URLSearchParams(location.search).get('lang');
    if (q && LANGS[q]) localStorage.setItem(KEY, q);
    var saved = localStorage.getItem(KEY);
    if (saved && LANGS[saved]) lang = saved;
  } catch (e) { /* приватный режим — остаёмся на русском */ }

  document.documentElement.lang = lang;

  /* ---------------- Данные ---------------- */
  // Файл данных → папка-группа внутри Assets/<Rus|Eng>/. Новый файл: положите его в подходящую
  // папку и добавьте строку сюда (или запрашивайте сразу с папкой: fetchData('articles/x.html')).
  var DATA_GROUPS = {
    'classes.json': 'characters', 'fixer.json': 'characters', 'bloodarch.json': 'characters',
    'bloodfiend.json': 'characters', 'feats.json': 'characters', 'systems.json': 'characters',
    'equipment.json': 'items', 'egogifts.json': 'items',
    'statuses.json': 'mechanics', 'rules.json': 'mechanics',
    'lore.json': 'world', 'bestiary.json': 'world', 'world.json': 'world',
    'Builder_classes.json': 'builder', 'Builder_feats.json': 'builder', 'Builder_races.json': 'builder',
  };
  // Статьи и прочие файлы вне таблицы запрашиваются сразу с папкой: fetchData('articles/equipment-lore.html').
  // Так же читаются файлы, созданные в админ-панели (их нет в Assets/, только в Firestore):
  // fetchData('characters/my-class.json'). Реестр классов — characters/systems.json.
  var CANON_EXTRA = ['articles/equipment-lore.html'];
  function relOf(name) {
    name = String(name).replace(/^\/+/, '');
    return DATA_GROUPS[name] ? DATA_GROUPS[name] + '/' + name : name;
  }
  function langDirs() { return lang !== 'ru' ? [LANGS[lang].dir, 'Rus'] : ['Rus']; }
  function candidates(name) {
    var rel = relOf(name);
    return langDirs().map(function (d) { return 'Assets/' + d + '/' + rel; });
  }

  /* ---------------- Канон из Firestore ----------------
     canon/<Rus|Eng>__<группа>__<файл>        — { version, chunks, … } (манифест)
     canon/<…>/chunks/000, 001…               — { data: кусок текста файла, v: версия }
     Файл режется на куски, потому что документ Firestore не больше 1 МБ (world.json — 1.5 МБ).
     Читается через REST без SDK и без входа (правила: canon читают все). Текст кэшируется в Cache Storage
     по версии, поэтому повторный заход стоит одно чтение манифеста. Любая ошибка — берём файл из Assets/.
     Отключить для отладки: ?canon=off (запоминается) / ?canon=on. */
  var CANON_GROUPS = ['characters', 'items', 'mechanics', 'world', 'articles', 'builder'];
  var CANON_KEY = 'canon.off';
  var canonOff = false;
  try {
    var cq = new URLSearchParams(location.search).get('canon');
    if (cq === 'off') localStorage.setItem(CANON_KEY, '1');
    if (cq === 'on') localStorage.removeItem(CANON_KEY);
    canonOff = localStorage.getItem(CANON_KEY) === '1';
  } catch (e) { /* ignore */ }

  function canonId(dir, rel) {
    var m = /^([a-z]+)\/([A-Za-z0-9_.-]+)$/.exec(rel);
    if (!m || CANON_GROUPS.indexOf(m[1]) < 0) return null;
    return dir + '__' + m[1] + '__' + m[2];
  }

  var SCRIPT_BASE = (document.currentScript && document.currentScript.src || '').replace(/i18n\.js(\?.*)?$/, '')
    || new URL('site/', location.href).href;
  var restBase = null;
  function rest() {
    if (!restBase) {
      restBase = import(SCRIPT_BASE + 'firebase-config.js').then(function (m) {
        var host = m.EMULATOR ? 'http://' + m.EMULATOR.host + ':' + m.EMULATOR.firestore : 'https://firestore.googleapis.com';
        return {
          url: host + '/v1/projects/' + m.firebaseConfig.projectId + '/databases/' +
            encodeURIComponent(m.FIRESTORE_DB) + '/documents/canon/',
          key: m.firebaseConfig.apiKey,
        };
      });
    }
    return restBase;
  }
  function restVal(v) {
    if (!v) return undefined;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    return undefined;
  }
  async function restGet(path, query) {
    var r = await rest();
    var res = await fetch(r.url + path + '?key=' + encodeURIComponent(r.key) + (query || ''), { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('canon ' + res.status);
    return res.json();
  }

  var MANIFEST_TTL = 30000;
  var manifests = {};
  async function canonManifest(id, fresh) {
    var now = Date.now(), memo = manifests[id];
    if (!fresh && memo && now - memo.t < MANIFEST_TTL) return memo.m;
    if (!fresh) {
      try {
        var ss = JSON.parse(sessionStorage.getItem('canon.m.' + id) || 'null');
        if (ss && now - ss.t < MANIFEST_TTL && ss.t <= now) { manifests[id] = ss; return ss.m; }
      } catch (e) { /* ignore */ }
    }
    var d = await restGet(encodeURIComponent(id));
    var m = d ? { version: restVal(d.fields.version), chunks: restVal(d.fields.chunks) } : null;
    manifests[id] = { m: m, t: now };
    try { sessionStorage.setItem('canon.m.' + id, JSON.stringify(manifests[id])); } catch (e) { /* ignore */ }
    return m;
  }
  async function canonChunks(id, m) {
    var d = await restGet(encodeURIComponent(id) + '/chunks', '&pageSize=100');
    var docs = ((d && d.documents) || []).map(function (x) {
      return { n: x.name.split('/').pop(), data: restVal(x.fields.data), v: restVal(x.fields.v) };
    }).sort(function (a, b) { return a.n < b.n ? -1 : 1; });
    if (docs.length < m.chunks) return null;
    var parts = [];
    for (var i = 0; i < m.chunks; i++) {
      if (docs[i].v !== m.version || typeof docs[i].data !== 'string') return null; // файл сейчас сохраняют
      parts.push(docs[i].data);
    }
    return parts.join('');
  }
  var CACHE = 'canon-v1';
  var cacheUrl = function (id, v) { return new URL('__canon/' + id + '?v=' + v, location.href).toString(); };
  async function cacheGet(id, v) {
    try { var c = await caches.open(CACHE); var r = await c.match(cacheUrl(id, v)); return r ? r.text() : null; }
    catch (e) { return null; }
  }
  async function cachePut(id, v, text) {
    try {
      var c = await caches.open(CACHE);
      var keys = await c.keys();
      await Promise.all(keys.filter(function (k) { return k.url.indexOf('/__canon/' + id + '?') >= 0; })
        .map(function (k) { return c.delete(k); }));
      await c.put(cacheUrl(id, v), new Response(text));
    } catch (e) { /* нет Cache Storage (http, приватный режим) — просто без кэша */ }
  }
  var MIME = { json: 'application/json', html: 'text/html', txt: 'text/plain' };
  /** Текст каноничного файла из Firestore или null, если файл туда не перенесён. */
  async function canonText(id, fresh) {
    for (var attempt = 0; attempt < 2; attempt++) {
      var m = await canonManifest(id, fresh || attempt > 0);
      if (!m) return null;
      var hit = await cacheGet(id, m.version);
      if (hit != null) return hit;
      var text = await canonChunks(id, m);
      if (text != null) { cachePut(id, m.version, text); return text; }
    }
    throw new Error('canon: файл ' + id + ' сохраняется, попробуйте позже');
  }
  async function canonResponse(dir, rel, init) {
    var id = canonEnabled() ? canonId(dir, rel) : null;
    if (!id) return null;
    try {
      var text = await canonText(id, init && (init.cache === 'no-cache' || init.cache === 'reload' || init.cache === 'no-store'));
      if (text == null) return null;
      var ext = rel.split('.').pop().toLowerCase();
      return new Response(text, { status: 200, headers: { 'Content-Type': (MIME[ext] || 'text/plain') + '; charset=utf-8', 'X-Canon': id } });
    } catch (e) {
      console.warn('Канон из Firestore недоступен, беру файл из Assets/', e);
      return null;
    }
  }
  function canonEnabled() { return !canonOff && typeof fetch === 'function' && location.protocol !== 'file:'; }

  async function fetchData(name, init) {
    var rel = relOf(name), dirs = langDirs(), last = null;
    for (var i = 0; i < dirs.length; i++) {
      var c = await canonResponse(dirs[i], rel, init);
      if (c) return c;
      try {
        var res = await fetch('Assets/' + dirs[i] + '/' + rel, init);
        if (res.ok) return res;
        last = res;
      } catch (e) { last = e; }
    }
    if (last instanceof Response) return last;
    throw last || new Error('Not found: ' + name);
  }
  /** Все каноничные файлы (пути внутри Assets/<язык>/) — список для админ-панели. */
  function canonFiles() {
    var list = Object.keys(DATA_GROUPS).map(function (n) { return DATA_GROUPS[n] + '/' + n; });
    return list.concat(CANON_EXTRA.filter(function (r) { return list.indexOf(r) < 0; }));
  }

  /* ---------------- Словарь ---------------- */
  var CYR = /[А-Яа-яЁё]/;
  var exact = new Map();   // нормализованная строка → перевод
  var lower = new Map();   // строка в нижнем регистре → перевод
  var patterns = [];       // [RegExp, string|function]

  function norm(s) { return s.replace(/\s+/g, ' ').trim(); }

  function register(dict, pats) {
    Object.keys(dict || {}).forEach(function (k) {
      var n = norm(k);
      exact.set(n, dict[k]);
      if (!lower.has(n.toLowerCase())) lower.set(n.toLowerCase(), dict[k]);
    });
    (pats || []).forEach(function (p) { patterns.push(p); });
  }

  function isUpper(s) { return s === s.toUpperCase() && s !== s.toLowerCase(); }
  function lookup(s) {
    if (exact.has(s)) return exact.get(s);
    var v = lower.get(s.toLowerCase());
    if (v === undefined) return undefined;
    if (isUpper(s)) return v.toUpperCase();
    if (s[0] === s[0].toUpperCase()) return v.charAt(0).toUpperCase() + v.slice(1);
    return v;
  }

  // Края строки, которые переносим как есть: пробелы, знаки, цифры, эмодзи-иконки
  var EDGE = /^([\s\d.,:;!?…()[\]{}«»"'“”„\-–—+*\/\\|#№%•·⟶→←↑↓✓✕✖×＋⌂◫⚙▸▾▴▼▲►◄]*)([\s\S]*?)([\s\d.,:;!?…()[\]{}«»"'“”„\-–—+*\/\\|#№%•·⟶→←↑↓✓✕✖×＋⌂◫⚙▸▾▴▼▲►◄]*)$/;

  // Составные строки «Заголовок: значение», «A | B», «A · B» — переводим по частям,
  // если удалось перевести все русские части.
  var SPLIT = /(\s*[:|·•—\/]\s+|\s+[|·•—\/]\s*)/;
  function trParts(n, depth) {
    if (depth > 3 || !SPLIT.test(n)) return undefined;
    var parts = n.split(SPLIT), ok = true;
    for (var i = 0; i < parts.length; i += 2) {
      if (!CYR.test(parts[i])) continue;
      var p = trCore(parts[i].trim(), depth + 1);
      if (p === undefined) { ok = false; break; }
      parts[i] = parts[i].replace(parts[i].trim(), p);
    }
    return ok ? parts.join('') : undefined;
  }

  function trCore(n, depth) {
    var v = lookup(n);
    // «Требование» найдёт ключ «Требование:»
    if (v === undefined) { v = lookup(n + ':'); if (v !== undefined) v = v.replace(/:$/, ''); }
    if (v === undefined) {
      var m = EDGE.exec(n);
      if (m && m[2] && (m[1] || m[3])) {
        var core = lookup(m[2]);
        if (core !== undefined) v = m[1] + core + m[3];
      }
    }
    if (v === undefined) {
      for (var i = 0; i < patterns.length; i++) {
        var p = patterns[i];
        p[0].lastIndex = 0;
        if (p[0].test(n)) { p[0].lastIndex = 0; v = n.replace(p[0], p[1]); break; }
      }
    }
    if (v === undefined) v = trParts(n, depth || 0);
    return v;
  }

  function tr(text) {
    if (lang === 'ru' || text == null) return text;
    var s = String(text);
    if (!CYR.test(s)) return s;
    var n = norm(s);
    var v = trCore(n, 0);
    if (v === undefined) return s;
    // сохраняем пробелы по краям (важно для текста рядом с иконками)
    var lead = /^\s*/.exec(s)[0], trail = /\s*$/.exec(s)[0];
    return lead + v + trail;
  }

  /* ---------------- Перевод DOM ---------------- */
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'data-tip'];
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, PRE: 1, NOSCRIPT: 1 };

  function skipped(el) {
    for (var e = el; e && e.nodeType === 1; e = e.parentNode) {
      if (SKIP_TAGS[e.tagName] || e.isContentEditable) return true;
      if (e.getAttribute('translate') === 'no' || (e.classList && e.classList.contains('notranslate'))) return true;
    }
    return false;
  }

  function doText(node) {
    var v = node.nodeValue;
    if (!v || !CYR.test(v) || skipped(node.parentNode)) return;
    var t = tr(v);
    if (t !== v) node.nodeValue = t;
  }
  function attrSkipped(el) {
    for (var e = el; e && e.nodeType === 1; e = e.parentNode) {
      if (e.isContentEditable || e.getAttribute('translate') === 'no' || (e.classList && e.classList.contains('notranslate'))) return true;
    }
    return false;
  }
  function doAttrs(el) {
    // подсказки (title, placeholder…) переводим и у полей ввода, и внутри <code>; само содержимое полей — нет
    if (attrSkipped(el)) return;
    for (var i = 0; i < ATTRS.length; i++) {
      var a = el.getAttribute(ATTRS[i]);
      if (a && CYR.test(a)) { var t = tr(a); if (t !== a) el.setAttribute(ATTRS[i], t); }
    }
    if (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type) && CYR.test(el.value)) el.value = tr(el.value);
    if (el.tagName === 'OPTION' && el.label && CYR.test(el.getAttribute('label') || '')) el.setAttribute('label', tr(el.getAttribute('label')));
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) { if (SKIP_TAGS[root.tagName]) return; doAttrs(root); }
    var w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    var n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 3) doText(n);
      else doAttrs(n);
    }
  }

  var started = false;
  function start() {
    if (started || lang === 'ru') return;
    started = true;
    walk(document.documentElement);
    new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        if (m.type === 'characterData') doText(m.target);
        else if (m.type === 'attributes') { if (m.target.nodeType === 1) doAttrs(m.target); }
        else for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
      }
    }).observe(document.documentElement, {
      childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS,
    });
    document.addEventListener('DOMContentLoaded', function () { walk(document.documentElement); });

    // Системные диалоги
    var a = window.alert, c = window.confirm, p = window.prompt;
    window.alert = function (msg) { return a.call(window, tr(msg)); };
    window.confirm = function (msg) { return c.call(window, tr(msg)); };
    window.prompt = function (msg, def) { return p.call(window, tr(msg), def); };
  }

  function setLang(l) {
    if (!LANGS[l] || l === lang) return;
    try { localStorage.setItem(KEY, l); } catch (e) { /* ignore */ }
    var u = new URL(location.href);
    u.searchParams.delete('lang');
    location.replace(u.toString());
  }

  window.I18N = {
    get lang() { return lang; },
    langs: LANGS,
    setLang: setLang,
    t: tr,
    dataUrl: function (name) { return candidates(name)[0]; },
    dataGroups: DATA_GROUPS,
    fetchData: fetchData,
    canon: { files: canonFiles, groups: CANON_GROUPS, id: canonId, get enabled() { return canonEnabled(); } },
    register: register,
    start: start,
  };

  // Словарь грузим синхронно, пока страница ещё парсится, — так нет «мигания» русского текста.
  if (lang !== 'ru') {
    document.write('<script src="' + SCRIPT_BASE + 'i18n-' + lang + '.js"><\/script>');
  }
})();
