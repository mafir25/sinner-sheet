/* Оформления сайта (пока тестируются): classic — обычное, limbus — Limbus Company (спрайты Assets/Assets_Limbus/),
   lobotomy — Lobotomy Corporation (спрайты Assets/Assets_Lobotomy/), library — Library of Ruina (Assets/Assets_Library/).
   1. Хранит выбор в браузере (localStorage 'site.theme'; нет записи — classic).
   2. Ставит <html data-theme="…"> до отрисовки — по нему слои site/themes/<оформление>/ стилизуют страницы.
      Версия страницы под оформление (index-limbus.html, index-lobotomy.html, index-library.html) объявляет его сама:
      <html data-page-theme="…">.
   3. Уводит на версию страницы под оформление, если она есть (PAGES), — до отрисовки, без мигания.
   4. Подключает шрифты оформления (FONTS) — только когда оно выбрано, чтобы остальные их не грузили.
   5. Измеряет выбранный вариант у переключателей для бегунка (SLIDERS, SWITCHES — см. внизу).
   Переключатель — в ⚙ Настройках (site/ui.js), виден только Кодеру и Тестерам; у остальных выбор сбрасывается.
   Подключение: <script src="site/theme.js"></script> в <head> сразу после site/i18n.js.
   Отдельную версию страницы (как index-limbus.html) можно открыть и напрямую: уводит с неё только выбранное
   другое оформление (не «Классика») — на свою версию страницы. */
(function () {
  var KEY = 'site.theme';
  var THEMES = { classic: 'Классика', limbus: 'Limbus Company', lobotomy: 'Lobotomy Corporation', library: 'Library of Ruina' };
  // обычная страница → её версия в оформлении; страницы без версии показываются как есть
  var PAGES = {
    limbus: { 'index.html': 'index-limbus.html' },
    lobotomy: { 'index.html': 'index-lobotomy.html' },
    library: { 'index.html': 'index-library.html' },
  };
  // шрифты оформления (Google Fonts, разрешены CSP): Forum — заголовки и кнопки, Cormorant Garamond — курсив; оба с кириллицей
  var FONTS = {
    library: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,700;1,500&family=Forum&display=swap',
  };

  function read() {
    try { var t = localStorage.getItem(KEY); return THEMES[t] ? t : 'classic'; } catch (e) { return 'classic'; }
  }
  var theme = read();
  var root = document.documentElement, fixed = root.getAttribute('data-page-theme');
  root.dataset.theme = fixed || theme;

  function loadFonts(t) {
    var href = FONTS[t], id = 'site-theme-fonts-' + t;
    if (!href || document.getElementById(id)) return;
    var link = document.createElement('link');
    link.id = id; link.rel = 'stylesheet'; link.href = href;
    document.head.appendChild(link);
  }
  loadFonts(fixed || theme);

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
    if (!fixed) { root.dataset.theme = t; loadFonts(t); }
    if (opts && opts.stay) return;
    var page = pageFor(t, pageName());
    if (page !== pageName()) location.assign(urlOf(page));
  }

  window.SiteTheme = { THEMES: THEMES, PAGES: PAGES, get: function () { return theme; }, set: set };

  /* 5. Бегунок переключателей. В оформлениях из SLIDERS цельный переключатель (общая рамка, внутри — кнопки-варианты)
     подсвечивает выбранный вариант бегунком — псевдоэлементом рамки, который переезжает от кнопки к кнопке.
     Здесь — место и движение, а как бегунок выглядит, решает слой оформления (site/themes/library/base.css).
     На рамку ставятся --sw-l, --sw-t, --sw-r, --sw-b — отступы выбранной кнопки от краёв рамки (px) — и data-sw:
     "on" (бегунок стоит под выбранной кнопкой), "move" (едет к ней), "off" (ничего не выбрано); кнопка, под которой
     бегунок стоит, — data-sw-under (её текст слой делает тёмным; класс выбора меняется раньше, чем бегунок доедет). Переезд — Web Animations по этим переменным (слой регистрирует их
     через @property): такая анимация начинается, когда браузер освободился, — если выбор варианта заново строит
     страницу (Канон / Кастом / Всё перерисовывает сетку), бегунок всё равно проедет целиком, а не перескочит.
     Передний край уходит первым (lead), задний догоняет (trail) — бегунок вытягивается и стягивается; по приезде
     по нему пробегает блик (glint: --sw-g — путь 0…100, --sw-go — яркость 0…1).
     SWITCHES — [рамка, выбранная кнопка среди её детей]. */
  var SLIDERS = {
    library: {
      lead: { duration: 300, easing: 'cubic-bezier(.3, 1.45, .55, 1)' },
      trail: { duration: 500, delay: 70, easing: 'cubic-bezier(.5, 1.25, .45, 1)' },
      glint: { duration: 750, delay: 280, easing: 'ease-out' },
    },
  };
  var SWITCHES = [['.src-switch', '.active'], ['.view-toggle', '[aria-pressed="true"]'], ['div.seg', '.on'], ['.segs', '.on']];
  var SW_VARS = ['--sw-l', '--sw-t', '--sw-r', '--sw-b'];
  var swRaf = 0, swSize = typeof ResizeObserver === 'function' ? new ResizeObserver(swLater) : null;
  var swSeen = typeof WeakSet === 'function' ? new WeakSet() : null;
  var swCalm = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  function swLater() { if (!swRaf && SLIDERS[root.dataset.theme]) swRaf = requestAnimationFrame(swUpdate); }
  function swUpdate(frame) {
    // кадр начался давно (страница была занята) — анимации отсчитали бы время от его начала и «проехали» паузу
    // невидимо; ждём следующий, свежий кадр
    if (frame && performance.now() - frame > 40) { swRaf = requestAnimationFrame(swUpdate); return; }
    swRaf = 0;
    var motion = SLIDERS[root.dataset.theme];
    if (!motion) return;
    for (var i = 0; i < SWITCHES.length; i++) {
      var boxes = document.querySelectorAll(SWITCHES[i][0]);
      for (var j = 0; j < boxes.length; j++) swPlace(boxes[j], SWITCHES[i][1], motion);
    }
  }
  function swPlace(box, activeSel, motion) {
    if (swSize && swSeen && !swSeen.has(box)) { swSeen.add(box); swSize.observe(box); }
    var btn = null;
    for (var k = 0; k < box.children.length; k++) if (box.children[k].matches(activeSel)) { btn = box.children[k]; break; }
    if (!btn) { box.dataset.sw = 'off'; return; }
    var b = box.getBoundingClientRect(), r = btn.getBoundingClientRect();
    if (!b.width || !r.width) return;   // скрыт (закрытое окно, свёрнутая панель) — измерим, когда покажется
    var l = r.left - b.left - box.clientLeft, t = r.top - b.top - box.clientTop;
    var to = [l, t, box.clientWidth - l - r.width, box.clientHeight - t - r.height], s = box.style;
    var was = SW_VARS.map(function (v) { return parseFloat(s.getPropertyValue(v)); });
    if (to.every(function (v, n) { return Math.abs(v - was[n]) < 0.5; })) return;
    // откуда ехать: с того места, где бегунок сейчас (мог не доехать до прошлой кнопки)
    var cs = getComputedStyle(box), from = SW_VARS.map(function (v) { return parseFloat(cs.getPropertyValue(v)); });
    for (var n = 0; n < 4; n++) s.setProperty(SW_VARS[n], to[n] + 'px');
    var moving = box.dataset.sw !== 'off' && box.dataset.sw && !isNaN(was[0]) && Math.abs(to[0] - was[0]) > 0.5;
    if (!moving || swCalm.matches || !box.animate) { box.dataset.sw = 'on'; swUnder(box, btn); return; }
    box.dataset.sw = 'move';
    swUnder(box, null);
    if (box.swAnims) box.swAnims.forEach(function (a) { a.cancel(); });
    var right = to[0] > from[0], lead = right ? 2 : 0, trail = right ? 0 : 2;
    function edge(n, o) {
      var k0 = {}, k1 = {};
      k0[SW_VARS[n]] = from[n] + 'px'; k1[SW_VARS[n]] = to[n] + 'px';
      return box.animate([k0, k1], { duration: o.duration, delay: o.delay || 0, easing: o.easing, fill: 'backwards' });
    }
    var anims = box.swAnims = [edge(lead, motion.lead), edge(trail, motion.trail), edge(1, motion.lead), edge(3, motion.lead),
      box.animate([{ '--sw-g': 0, '--sw-go': 0 }, { '--sw-go': 1, offset: 0.15 }, { '--sw-go': 1, offset: 0.8 }, { '--sw-g': 100, '--sw-go': 0 }],
        motion.glint)];
    // текст выбранной кнопки темнеет, когда передний край бегунка доехал
    anims[0].finished.then(function () { if (box.swAnims === anims) { box.dataset.sw = 'on'; swUnder(box, btn); } }, function () {});
    // Выбор варианта часто тут же перестраивает страницу (сетка карточек), и браузер полсекунды не рисует кадры —
    // бегунок «проехал бы» это время невидимо. Пока страница занята, время бегунка стоит: после долгой паузы
    // между кадрами анимации отматываются на потерянное время.
    var last = performance.now();
    requestAnimationFrame(function watch(now) {
      var gap = now - last; last = now;
      if (box.swAnims !== anims) return;   // уже едет к другой кнопке
      if (gap > 50) anims.forEach(function (a) { if (a.playState === 'running' && a.currentTime) a.currentTime = Math.max(0, a.currentTime - (gap - 17)); });
      if (anims.some(function (a) { return a.playState === 'running' || a.pending; })) requestAnimationFrame(watch);
    });
  }
  function swUnder(box, btn) {
    for (var k = 0; k < box.children.length; k++) box.children[k].toggleAttribute('data-sw-under', box.children[k] === btn);
  }
  function swStart() {
    // выбор варианта меняет класс или aria-pressed; новые переключатели (Ширма, Редактор карт, окна) — новые узлы;
    // смена языка — новый текст. Своё (style, data-sw…) не слушаем — иначе зациклится.
    new MutationObserver(swLater).observe(root, {
      subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'aria-pressed', 'data-theme'],
    });
    addEventListener('resize', swLater);
    if (document.fonts) document.fonts.addEventListener('loadingdone', swLater);
    swLater();
  }
  if (typeof MutationObserver === 'function' && typeof requestAnimationFrame === 'function') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', swStart); else swStart();
  }
})();
