/* Локализация сайта (RU / EN).
   Подключается обычным <script src="site/i18n.js"></script> в <head> КАЖДОЙ страницы — до остальных скриптов.

   Что делает:
   1. Хранит выбранный язык (localStorage 'site.lang', по умолчанию русский). Выбор — в окне настроек (site/ui.js).
   2. Отдаёт данные на нужном языке: I18N.fetchData('feats.json') ищет файл по цепочке
        Assets/<Eng|Rus>/characters/feats.json → Assets/Rus/characters/feats.json
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
    'bloodfiend.json': 'characters', 'feats.json': 'characters',
    'equipment.json': 'items', 'egogifts.json': 'items',
    'statuses.json': 'mechanics', 'rules.json': 'mechanics',
    'lore.json': 'world', 'bestiary.json': 'world', 'world.json': 'world',
    'Builder_classes.json': 'builder', 'Builder_feats.json': 'builder', 'Builder_races.json': 'builder',
  };
  function candidates(name) {
    name = String(name).replace(/^\/+/, '');
    var rel = DATA_GROUPS[name] ? DATA_GROUPS[name] + '/' + name : name;
    var list = ['Assets/' + LANGS[lang].dir + '/' + rel];
    if (lang !== 'ru') list.push('Assets/Rus/' + rel);
    return list;
  }
  async function fetchData(name, init) {
    var last = null;
    var urls = candidates(name);
    for (var i = 0; i < urls.length; i++) {
      try {
        var res = await fetch(urls[i], init);
        if (res.ok) return res;
        last = res;
      } catch (e) { last = e; }
    }
    if (last instanceof Response) return last;
    throw last || new Error('Not found: ' + name);
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
    register: register,
    start: start,
  };

  // Словарь грузим синхронно, пока страница ещё парсится, — так нет «мигания» русского текста.
  if (lang !== 'ru') {
    var me = document.currentScript && document.currentScript.src;
    var base = me ? me.replace(/i18n\.js(\?.*)?$/, '') : 'site/';
    document.write('<script src="' + base + 'i18n-' + lang + '.js"><\/script>');
  }
})();
