/* Оформления сайта (пока тестируются): classic — обычное, limbus — Limbus Company (спрайты Assets/Assets_Limbus/).
   1. Хранит выбор в браузере (localStorage 'site.theme'; нет записи — classic).
   2. Ставит <html data-theme="…"> до отрисовки — по нему слои site/themes/<оформление>/ стилизуют страницы.
      Версия страницы под оформление (index-limbus.html) объявляет его сама: <html data-page-theme="limbus">.
   3. Уводит на версию страницы под оформление, если она есть (PAGES), — до отрисовки, без мигания.
   Переключатель — в ⚙ Настройках (site/ui.js), виден только Кодеру и Тестерам; у остальных выбор сбрасывается.
   Подключение: <script src="site/theme.js"></script> в <head> сразу после site/i18n.js.
   Отдельную версию страницы (как index-limbus.html) можно открыть и напрямую — переадресация только с обычной. */
(function () {
  var KEY = 'site.theme';
  var THEMES = { classic: 'Классика', limbus: 'Limbus Company' };
  // обычная страница → её версия в оформлении; страницы без версии показываются как есть
  var PAGES = {
    limbus: { 'index.html': 'index-limbus.html' },
  };

  function read() {
    try { var t = localStorage.getItem(KEY); return THEMES[t] ? t : 'classic'; } catch (e) { return 'classic'; }
  }
  var theme = read();
  var root = document.documentElement, fixed = root.getAttribute('data-page-theme');
  root.dataset.theme = fixed || theme;

  function pageName() { return location.pathname.split('/').pop() || 'index.html'; }
  // обычная страница, версией которой является name (или сама name)
  function baseOf(name) {
    for (var t in PAGES) for (var p in PAGES[t]) if (PAGES[t][p] === name) return p;
    return name;
  }
  function pageFor(t, name) {
    var base = baseOf(name);
    return (PAGES[t] && PAGES[t][base]) || base;
  }
  function urlOf(file) {
    var u = new URL(file, location.href);
    u.search = location.search; u.hash = location.hash;
    return u.href;
  }

  // Переадресация при загрузке. Петли нет: уводим только с обычной страницы, а если без сети service worker
  // отдаст обычную вместо недоступной версии, адрес останется адресом версии — и дальше никуда не уводим.
  var target = pageFor(theme, pageName());
  if (theme !== 'classic' && target !== pageName()) location.replace(urlOf(target));

  /** Сменить оформление. { stay: true } — только запомнить, не уходя со страницы. */
  function set(t, opts) {
    if (!THEMES[t]) t = 'classic';
    try { if (t === 'classic') localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch (e) { /* приватный режим */ }
    theme = t;
    if (!fixed) root.dataset.theme = t;
    if (opts && opts.stay) return;
    var page = pageFor(t, pageName());
    if (page !== pageName()) location.assign(urlOf(page));
  }

  window.SiteTheme = { THEMES: THEMES, PAGES: PAGES, get: function () { return theme; }, set: set };
})();
