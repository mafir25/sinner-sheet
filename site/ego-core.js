/* Ядро конструктора Э.Г.О. — общее для egobuilder.html и builder.html.
   Подключение: <script src="site/ego-core.js"></script> (после site/i18n.js).

   window.EgoCore:
     blank(kind)                 — новый объект Э.Г.О. ('attack' | 'eff')
     normalize(raw)              — привести импортированный JSON к текущему формату (или null)
     maxPoints(ego), spent(ego)  — бюджет очков и потраченные очки
     rankName(rank)              — 4..8 → ZAYIN..ALEPH
     metaLine(ego)               — «Атака Э.Г.О. | TETH»
     summaryHtml(ego)            — готовый блок досье (всё экранировано)
     summaryText(ego)            — то же текстом для копирования
     mount(container, ego, { onChange, maxRank }) — форма редактирования; вернёт { get(), set(ego) }
     library.list() / save(ego) / remove(id) — библиотека Э.Г.О. в localStorage (общая для обеих страниц)

   Формат объекта:
   { format:'sinner-sheet.ego', v:1, id, kind:'attack'|'eff', name, quote,
     rank:4..8, range:'ranged'|'melee', dmg:'slashing'|'piercing'|'bludgeoning',
     effType:'7'|'pb', pb:2..6, form:'Transformation'|'Equipment', up:{ <id>: n }, custom:'' } */
(function () {
  'use strict';

  var RANKS = [
    { v: 4, name: 'ZAYIN', label: 'ZAYIN (4 Очка)', level: 4 },
    { v: 5, name: 'TETH', label: 'TETH (5 Очков)', level: 8 },
    { v: 6, name: 'HE', label: 'HE (6 Очков)', level: 12 },
    { v: 7, name: 'WAW', label: 'WAW (7 Очков)', level: 16 },
    { v: 8, name: 'ALEPH', label: 'ALEPH (8 Очков)', level: 19 },
  ];
  var DMG = {
    slashing: 'Рубящий (Slashing)',
    piercing: 'Колющий (Piercing)',
    bludgeoning: 'Дробящий (Bludgeoning)',
  };
  var ATK = [
    { id: 'add_dice', name: 'Доп. куб урона (+1 кость)', max: 5 },
    { id: 'up_dice', name: 'Повышение куба (Напр. d8 -> d10)', max: 3 },
    { id: 'add_range', name: 'Увеличение дальности (+10 футов)', max: 10 },
    { id: 'spread', name: 'Область/Доп. Цели (Конус или Радиус)', max: 5 },
    { id: 'custom_pts', name: 'Вложения в Кастомные Статусы/Дебаффы', max: 8 },
  ];
  var EFF = [
    { id: 'eff_dmg', name: 'Увеличение урона (+1 тир кости)', max: 3 },
    { id: 'eff_spd', name: 'Скорость (+15 футов)', max: 3 },
    { id: 'eff_ac', name: 'Защита (+1 КД)', max: 3 },
    { id: 'eff_stat', name: 'Характеристики (+2 к 1 или +1 к 2)', max: 3 },
    { id: 'eff_save', name: 'Стойкость (+1 к спасброскам)', max: 3 },
    { id: 'eff_status', name: '+1 Статус при нанесении урона', max: 3 },
    { id: 'eff_custom', name: 'Спец-атака / Пассивка', max: 7 },
  ];
  var LIB_KEY = 'ego.library.v1';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function clampInt(v, lo, hi, def) {
    var n = parseInt(v, 10);
    if (isNaN(n)) n = def;
    return Math.max(lo, Math.min(hi, n));
  }
  function uid() { return 'ego_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function upList(kind) { return kind === 'eff' ? EFF : ATK; }

  function blank(kind) {
    var up = {};
    upList(kind).forEach(function (u) { up[u.id] = 0; });
    return {
      format: 'sinner-sheet.ego', v: 1, id: uid(), kind: kind === 'eff' ? 'eff' : 'attack',
      name: '', quote: '', rank: 4, range: 'ranged', dmg: 'slashing',
      effType: '7', pb: 3, form: 'Transformation', up: up, custom: '',
    };
  }

  function normalize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var kind = raw.kind === 'eff' ? 'eff' : (raw.kind === 'attack' ? 'attack' : null);
    if (!kind) return null;
    var e = blank(kind);
    e.id = typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 60) : e.id;
    e.name = String(raw.name || '').slice(0, 120);
    e.quote = String(raw.quote || '').slice(0, 300);
    e.rank = clampInt(raw.rank, 4, 8, 4);
    e.range = raw.range === 'melee' ? 'melee' : 'ranged';
    e.dmg = DMG[raw.dmg] ? raw.dmg : 'slashing';
    e.effType = raw.effType === 'pb' ? 'pb' : '7';
    e.pb = clampInt(raw.pb, 2, 6, 3);
    e.form = raw.form === 'Equipment' ? 'Equipment' : 'Transformation';
    e.custom = String(raw.custom || '').slice(0, 4000);
    upList(kind).forEach(function (u) { e.up[u.id] = clampInt(raw.up && raw.up[u.id], 0, u.max, 0); });
    return e;
  }

  function maxPoints(e) {
    if (e.kind === 'attack') return e.rank;
    return e.effType === 'pb' ? e.pb : 7;
  }
  function spent(e) {
    var s = 0;
    upList(e.kind).forEach(function (u) { s += e.up[u.id] || 0; });
    return s;
  }
  function rankName(r) {
    for (var i = 0; i < RANKS.length; i++) if (RANKS[i].v === r) return RANKS[i].name;
    return 'ZAYIN';
  }
  function maxRankForLevel(level) {
    var r = 0;
    RANKS.forEach(function (x) { if (level >= x.level) r = x.v; });
    return r;
  }

  // Повышение тира кубов: d4 → d6 → d8 → d10 → d12 → 2d6
  function dice(count, type, add, upTier) {
    var tiers = [4, 6, 8, 10, 12, '2d6'];
    var n = count + add;
    var i = tiers.indexOf(type);
    if (i === -1) i = 2;
    i = Math.min(5, i + upTier);
    return i === 5 ? (n * 2) + 'd6' : n + 'd' + tiers[i];
  }

  function metaLine(e) {
    if (e.kind === 'attack') return 'Атака Э.Г.О. | ' + rankName(e.rank);
    return (e.effType === 'pb' ? 'Нестабильное Э.Г.О.' : 'Расцветающее Э.Г.О.') + ' | ' +
      (e.form === 'Transformation' ? 'Трансформация' : 'Экипировка');
  }

  function summaryParts(e) {
    var lines = [], effects = [], corrosion = null;
    if (e.kind === 'attack') {
      var melee = e.range === 'melee';
      var range = (melee ? 5 : 30) + e.up.add_range * 10;
      lines.push(['Тип Атаки:', 'Бросок атаки от МУД или ХАР + БМ.']);
      lines.push(['Урон:', dice(2, melee ? 12 : 8, e.up.add_dice, e.up.up_dice) + ' + МУД/ХАР [' + DMG[e.dmg] + ']']);
      lines.push(['Дистанция:', range + ' футов']);
      if (e.up.spread > 0) {
        effects.push({ text: 'Атака становится конусом (' + range + ' футов) или сферой (' + Math.floor(range / 2) +
          ' футов). Вы совершаете атаку против +' + (e.up.spread * 2) + ' доп. целей в области.' });
      }
      if (e.up.custom_pts > 0 || e.custom.trim()) {
        effects.push({ title: 'Кастомные эффекты' + (e.up.custom_pts > 0 ? ' (' + e.up.custom_pts + ' очк.)' : '') + ':', text: e.custom.trim() || '(Эффекты не описаны)' });
      }
      if (e.rank !== 4) corrosion = true;
    } else {
      lines.push(['Активация:', e.form === 'Transformation' ? 'Бонусное действие (1 раз за Длительный Отдых)' : 'Свойства магического артефакта 5e']);
      var u = e.up;
      if (u.eff_dmg) effects.push({ title: 'Усиление урона:', text: '+' + u.eff_dmg + ' тир(а) кости урона.' });
      if (u.eff_spd) effects.push({ title: 'Скорость:', text: '+' + (u.eff_spd * 15) + ' футов ко всем видам перемещения.' });
      if (u.eff_ac) effects.push({ title: 'Защита:', text: '+' + u.eff_ac + ' КД.' });
      if (u.eff_stat) effects.push({ title: 'Характеристики:', text: '+' + (u.eff_stat * 2) + ' к одной или +' + u.eff_stat + ' к двум характеристикам.' });
      if (u.eff_save) effects.push({ title: 'Стойкость:', text: '+' + u.eff_save + ' ко всем спасброскам.' });
      if (u.eff_status) effects.push({ title: 'Статус:', text: 'Накладывает +' + u.eff_status + ' статус-эффекта при нанесении урона.' });
      if (u.eff_custom > 0 || e.custom.trim()) {
        effects.push({ title: 'Особые черты / Спец-атака' + (u.eff_custom > 0 ? ' (' + u.eff_custom + ' очк.)' : '') + ':', text: e.custom.trim() || '(Эффекты не описаны)' });
      }
    }
    return { lines: lines, effects: effects, corrosion: corrosion };
  }

  var CORROSION = {
    title: 'КОРРОЗИЯ Э.Г.О. (CORROSION)',
    trigger: 'При падении Рассудка до 0 (-45) ИЛИ при провале спасброска МУД/ХАР (СЛ 10) при попытке использовать Э.Г.О.',
    targets: ['1. Ближайшая цель', '2. Существо с наибольшим количеством ХП в радиусе', '3. Существо с наименьшим количеством ХП в радиусе', '4. Ближайший союзник'],
    effect: 'Атака получает +1 Очко Улучшений. (Применяются те же базовые эффекты + 1 доп. эффект или условие).',
  };

  function summaryHtml(e) {
    var p = summaryParts(e);
    var h = '<div class="egc-sum">';
    if (e.quote) h += '<div class="egc-quote">"' + esc(e.quote) + '"</div>';
    h += '<div class="egc-stat-block">';
    p.lines.forEach(function (l) { h += '<div class="egc-line"><strong>' + esc(l[0]) + '</strong> ' + esc(l[1]) + '</div>'; });
    h += '</div><div class="egc-line"><strong>' + (e.kind === 'attack' ? 'Эффекты Атаки:' : 'Дарованные эффекты:') + '</strong></div><ul class="egc-list">';
    if (!p.effects.length) h += '<li class="egc-dim">Нет дополнительных эффектов</li>';
    p.effects.forEach(function (x) {
      h += '<li>' + (x.title ? '<strong>' + esc(x.title) + '</strong> ' : '') + '<span class="egc-pre">' + esc(x.text) + '</span></li>';
    });
    h += '</ul>';
    var over = spent(e) - maxPoints(e);
    if (over > 0) h += '<div class="egc-warn">Превышен бюджет очков на ' + over + '</div>';
    if (p.corrosion) {
      h += '<div class="egc-corr"><div class="egc-corr-t">' + CORROSION.title + '</div>' +
        '<div class="egc-line"><strong>Активация:</strong> ' + CORROSION.trigger + '</div>' +
        '<div class="egc-line"><strong>Целеуказание (Бросьте 1d4):</strong></div><ul class="egc-list">' +
        CORROSION.targets.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>' +
        '<div class="egc-line"><strong>Эффект Коррозии:</strong> ' + CORROSION.effect + '</div></div>';
    }
    return h + '</div>';
  }

  function summaryText(e) {
    var T = window.I18N ? window.I18N.t : function (s) { return s; };
    var p = summaryParts(e);
    var s = (e.name || T('БЕЗ НАЗВАНИЯ')) + '\n' + T(metaLine(e)) + '\n';
    if (e.quote) s += '"' + e.quote + '"\n';
    p.lines.forEach(function (l) { s += T(l[0]) + ' ' + T(l[1]) + '\n'; });
    p.effects.forEach(function (x) { s += '• ' + (x.title ? T(x.title) + ' ' : '') + x.text + '\n'; });
    if (p.corrosion) s += T(CORROSION.title) + ': ' + T(CORROSION.trigger) + '\n';
    return s.trim();
  }

  /* ---------------- Форма ---------------- */
  var CSS = '' +
    '.egc{--egc:#D94285;--egc-dim:#696969;color:#E0D8C8;font-family:Inter,sans-serif}' +
    '.egc-tabs{display:flex;gap:10px;margin-bottom:16px}' +
    '.egc-tab{flex:1;padding:9px;background:rgba(0,0,0,.5);border:1px solid var(--egc-dim);color:var(--egc-dim);font:500 1rem Oswald,sans-serif;cursor:pointer;text-transform:uppercase}' +
    '.egc-tab[aria-pressed=true]{border-color:var(--egc);color:var(--egc);background:rgba(217,66,133,.1)}' +
    '.egc-pts{font:1.6rem Oswald,sans-serif;text-align:center;margin-bottom:16px;padding:8px;border:2px dashed var(--egc);background:rgba(217,66,133,.1)}' +
    '.egc-pts.egc-bad{border-color:#C7243A;color:#C7243A;background:rgba(199,36,58,.1)}' +
    '.egc label{display:block;font:1rem Oswald,sans-serif;color:#45B3CB;margin:10px 0 6px;text-transform:uppercase}' +
    '.egc input,.egc select,.egc textarea{width:100%;background:#111;border:1px solid #333;color:#E0D8C8;padding:9px;font:0.95rem Inter,sans-serif;outline:none;box-sizing:border-box}' +
    '.egc input:focus,.egc select:focus,.egc textarea:focus{border-color:var(--egc)}' +
    '.egc textarea{min-height:80px;resize:vertical}' +
    '.egc-sec{font-size:.8rem;color:var(--egc);margin-top:18px;border-bottom:1px solid #333;padding-bottom:4px;letter-spacing:1px}' +
    '.egc-up{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #222;padding:7px 0;gap:10px}' +
    '.egc-up-n{font:1rem Oswald,sans-serif}.egc-up-d{color:var(--egc-dim);font-size:.78rem}' +
    '.egc-qty{display:flex;align-items:center;gap:8px}' +
    '.egc-qty button{background:#222;border:1px solid #444;color:#fff;width:28px;height:28px;cursor:pointer;font-family:Oswald,sans-serif}' +
    '.egc-qty button:hover{background:var(--egc);border-color:var(--egc)}' +
    '.egc-qty span{min-width:20px;text-align:center;font-family:Oswald,sans-serif}' +
    '.egc-hint{font-size:.75rem;color:var(--egc);margin:4px 0 6px}' +
    '.egc-quote{font-style:italic;color:var(--egc-dim);font-family:Merriweather,serif;margin-bottom:8px}' +
    '.egc-stat-block{margin-bottom:10px}.egc-line{margin-bottom:4px;font-size:.95rem}' +
    '.egc-line strong{color:var(--egc,#D94285);font-family:Oswald,sans-serif;letter-spacing:1px}' +
    '.egc-list{margin:6px 0 6px 20px;font-size:.93rem;line-height:1.55}.egc-list li{margin-bottom:4px}' +
    '.egc-pre{white-space:pre-wrap}.egc-dim{color:var(--egc-dim)}' +
    '.egc-warn{color:#C7243A;font:0.95rem Oswald,sans-serif;margin:6px 0}' +
    '.egc-corr{margin-top:12px;padding:12px;border:1px solid #C7243A;background:rgba(199,36,58,.05)}' +
    '.egc-corr-t{color:#C7243A;font:1.2rem Oswald,sans-serif;margin-bottom:6px;border-bottom:1px solid #C7243A;padding-bottom:4px}' +
    '.egc-sum{--egc:#D94285}';

  function injectCss() {
    if (document.getElementById('egc-css')) return;
    var st = document.createElement('style');
    st.id = 'egc-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function mount(container, initial, opts) {
    opts = opts || {};
    injectCss();
    var ego = normalize(initial) || blank('attack');
    var maxRank = opts.maxRank || 8;

    function rankOptions() {
      return RANKS.map(function (r) {
        var dis = r.v > maxRank ? ' disabled' : '';
        return '<option value="' + r.v + '"' + dis + (ego.rank === r.v ? ' selected' : '') + '>' + r.label + '</option>';
      }).join('');
    }
    function upRows(kind) {
      return upList(kind).map(function (u) {
        return '<div class="egc-up"><div><div class="egc-up-n">' + u.name + '</div><div class="egc-up-d">Стоимость: 1 очко · макс. ' + u.max + '</div></div>' +
          '<div class="egc-qty"><button type="button" data-q="' + u.id + '" data-d="-1">-</button><span data-v="' + u.id + '">' + (ego.up[u.id] || 0) + '</span>' +
          '<button type="button" data-q="' + u.id + '" data-d="1">+</button></div></div>';
      }).join('');
    }

    function render() {
      var a = ego.kind === 'attack';
      container.innerHTML = '<div class="egc">' +
        (opts.lockKind ? '' :
          '<div class="egc-tabs"><button type="button" class="egc-tab" data-kind="attack" aria-pressed="' + a + '">АТАКА Э.Г.О.</button>' +
          '<button type="button" class="egc-tab" data-kind="eff" aria-pressed="' + !a + '">РАСЦВЕТАЮЩЕЕ Э.Г.О.</button></div>') +
        '<div class="egc-pts" data-pts></div>' +
        '<label>Название Э.Г.О.</label><input data-f="name" maxlength="120" placeholder="Например: Bodysack">' +
        '<label>Фраза при использовании (Quote)</label><input data-f="quote" maxlength="300" placeholder="Например: Я ничего не смог изменить...">' +
        (a
          ? '<label>Уровень Угрозы (Ранг)</label><select data-f="rank">' + rankOptions() + '</select>' +
            '<label>Дистанция атаки (База)</label><select data-f="range"><option value="ranged">Дальний бой - 30 футов (Урон 2d8)</option><option value="melee">Ближний бой - 5 футов (Урон 2d12)</option></select>' +
            '<label>Тип Урона</label><select data-f="dmg">' + Object.keys(DMG).map(function (k) { return '<option value="' + k + '">' + DMG[k] + '</option>'; }).join('') + '</select>'
          : '<label>Тип формы</label><select data-f="effType"><option value="7">Расцветающее Э.Г.О. / Трансформация (7 Очков)</option><option value="pb">Нестабильное Э.Г.О. (Кол-во очков = Ваш ПБ)</option></select>' +
            '<div data-pbwrap><label>Ваш Бонус Мастерства (PB)</label><input data-f="pb" type="number" min="2" max="6"></div>' +
            '<label>Форма (Form)</label><select data-f="form"><option value="Transformation">Трансформация (Активация бонусным действием)</option><option value="Equipment">Экипировка (Артефакт/Предмет)</option></select>') +
        '<div class="egc-sec">УЛУЧШЕНИЯ (ПОКУПКА ЗА ОЧКИ)</div>' + upRows(ego.kind) +
        '<label>' + (a ? 'Кастомные эффекты / Статусы' : 'Особые действия / Атаки') + '</label>' +
        '<div class="egc-hint">' + (a ? 'Вложите очки в "Кастомные Статусы/Дебаффы" выше, чтобы ваши записи отсюда отображались в итоговом листе.' : 'Вложите очки в "Спец-атака / Пассивка" выше, чтобы эти записи отобразились в досье.') + '</div>' +
        '<textarea data-f="custom" maxlength="4000" placeholder="' + (a ? 'Опишите накладываемые статусы (например: Накладывает 4 Кровотечения)...' : 'Опишите мощную спец-атаку (1-3 очка) или уникальную пассивку (1-7 очков)...') + '"></textarea>' +
        '</div>';
      ['name', 'quote', 'rank', 'range', 'dmg', 'effType', 'pb', 'form', 'custom'].forEach(function (f) {
        var el = container.querySelector('[data-f="' + f + '"]');
        if (el) el.value = ego[f];
      });
      refresh(false);
    }

    function refresh(notify) {
      var box = container.querySelector('[data-pts]');
      var s = spent(ego), m = maxPoints(ego);
      box.innerHTML = 'ДОСТУПНЫЕ ОЧКИ: <span style="color:#fff">' + s + '</span> / ' + m;
      box.classList.toggle('egc-bad', s > m);
      var pbw = container.querySelector('[data-pbwrap]');
      if (pbw) pbw.style.display = ego.effType === 'pb' ? '' : 'none';
      if (notify !== false && opts.onChange) opts.onChange(ego);
    }

    container.addEventListener('click', function (ev) {
      var t = ev.target.closest('button');
      if (!t || !container.contains(t)) return;
      if (t.dataset.kind && t.dataset.kind !== ego.kind) {
        var keep = { id: ego.id, name: ego.name, quote: ego.quote, custom: ego.custom };
        ego = blank(t.dataset.kind);
        Object.assign(ego, keep);
        render();
        if (opts.onChange) opts.onChange(ego);
      } else if (t.dataset.q) {
        var u = upList(ego.kind).filter(function (x) { return x.id === t.dataset.q; })[0];
        ego.up[u.id] = Math.max(0, Math.min(u.max, (ego.up[u.id] || 0) + Number(t.dataset.d)));
        container.querySelector('[data-v="' + u.id + '"]').textContent = ego.up[u.id];
        refresh();
      }
    });
    function onField(ev) {
      var f = ev.target.dataset && ev.target.dataset.f;
      if (!f) return;
      var v = ev.target.value;
      if (f === 'rank') v = clampInt(v, 4, 8, 4);
      if (f === 'pb') v = clampInt(v, 2, 6, 3);
      ego[f] = v;
      refresh();
    }
    container.addEventListener('input', onField);
    container.addEventListener('change', onField);

    render();
    return {
      get: function () { return JSON.parse(JSON.stringify(ego)); },
      set: function (e) { ego = normalize(e) || blank('attack'); render(); },
      setMaxRank: function (r) { maxRank = r || 8; render(); },
    };
  }

  /* ---------------- Библиотека ---------------- */
  var library = {
    list: function () {
      try {
        var raw = JSON.parse(localStorage.getItem(LIB_KEY) || '[]');
        return Array.isArray(raw) ? raw.map(normalize).filter(Boolean) : [];
      } catch (e) { return []; }
    },
    save: function (ego) {
      var e = normalize(ego);
      if (!e) return false;
      var list = library.list().filter(function (x) { return x.id !== e.id; });
      list.unshift(e);
      try { localStorage.setItem(LIB_KEY, JSON.stringify(list.slice(0, 100))); return true; } catch (er) { return false; }
    },
    remove: function (id) {
      var list = library.list().filter(function (x) { return x.id !== id; });
      try { localStorage.setItem(LIB_KEY, JSON.stringify(list)); } catch (er) { /* приватный режим */ }
    },
  };

  window.EgoCore = {
    RANKS: RANKS, ATK: ATK, EFF: EFF, DMG: DMG,
    blank: blank, normalize: normalize, maxPoints: maxPoints, spent: spent,
    rankName: rankName, maxRankForLevel: maxRankForLevel, metaLine: metaLine,
    summaryHtml: summaryHtml, summaryText: summaryText, mount: mount, library: library, esc: esc,
  };
})();
