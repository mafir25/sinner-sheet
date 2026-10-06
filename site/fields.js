// Поля конструктора записей — общие для Базы знаний (navigation.html) и админ-панели (admin.html).
// Здесь словари (DICT), схемы полей по категориям (SCHEMAS), разметка формы (fieldHtml) и сбор формы (collectFields).
// Поле Markdown рисует страница: передайте ctx.md(f, value) → HTML (по умолчанию — простое textarea).
//
// Типы полей: text, num, md, bool, select (opts), checks (dict), stats6, row (of — поля в строку),
//             repeat (sub — повторяющиеся блоки: таланты, действия…).
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const arr = (v) => (Array.isArray(v) ? v : (v ? [v] : []));
const STATS6 = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];

/* ============================================================
   Словари — единственный источник правды
   ============================================================ */
export const DICT = {
  types: {
    Burn:{name:"Огонь",color:"#C7243A",icon:"Assets/Icons/Burn.png"},
    Bleed:{name:"Кровотечение",color:"#E67E22",icon:"Assets/Icons/Bleed.png"},
    Tremor:{name:"Тремор",color:"#F1C40F",icon:"Assets/Icons/Tremor.png"},
    Rupture:{name:"Разрыв",color:"#40E0D0",icon:"Assets/Icons/Rupture.png"},
    Sinking:{name:"Утопание",color:"#45B3CB",icon:"Assets/Icons/Sinking.png"},
    Poise:{name:"Уверенность",color:"#1E3A8A",icon:"Assets/Icons/Poise.png"},
    Charge:{name:"Заряд",color:"#9B59B6",icon:"Assets/Icons/Charge.png"},
    Other:{name:"Иное",color:"#27AE60",icon:"Assets/Icons/Other.png"},
    None:{name:"Физические",color:"#696969",icon:"Assets/Icons/phis.png"}
  },
  stats: {
    Str:{name:"Сила",color:"#C7243A",fa:"fa-hand-fist"}, Dex:{name:"Ловкость",color:"#45B3CB",fa:"fa-feather-pointed"},
    Con:{name:"Телосложение",color:"#F1C40F",fa:"fa-heart-pulse"}, Int:{name:"Интеллект",color:"#1E3A8A",fa:"fa-brain"},
    Wis:{name:"Мудрость",color:"#9B59B6",fa:"fa-eye"}, Cha:{name:"Харизма",color:"#E67E22",fa:"fa-comments"},
    None:{name:"Нет скейлинга",color:"#696969",fa:"fa-ban"}
  },
  featBases: {
    Background:{name:"Предыстория",color:"#696969",fa:"fa-scroll"}, Body:{name:"Тело",color:"#E67E22",fa:"fa-dumbbell"},
    Mind:{name:"Разум",color:"#1E3A8A",fa:"fa-brain"}, "Martial Arts":{name:"Боевые искусства",color:"#45B3CB",fa:"fa-hand-back-fist"},
    Affiliation:{name:"Принадлежность",color:"#F1C40F",fa:"fa-building"}, Weapon:{name:"Оружие",color:"#C7243A",fa:"fa-gun"},
    Status:{name:"Статус",color:"#8FCC2A",fa:"fa-biohazard"}, Sin:{name:"Грех",color:"#45B3CB",fa:"fa-fire"},
    "Shin and Mang":{name:"Шин и Манг",color:"#D94285",fa:"fa-yin-yang"}, "E.G.O Feats":{name:"Черты Э.Г.О.",color:"#27AE60",fa:"fa-gem"}
  },
  itemTypes: {
    Weapon:{name:"Оружие",color:"#C7243A",fa:"fa-gun"}, Armor:{name:"Броня",color:"#3498DB",fa:"fa-shield-halved"},
    Mod:{name:"Модификатор",color:"#F1C40F",fa:"fa-microchip"}
  },
  rarity: {
    Common:{name:"Common",color:"#B0B0B0",fa:"fa-circle"}, Uncommon:{name:"Uncommon",color:"#2ECC71",fa:"fa-certificate"},
    Rare:{name:"Rare",color:"#3498DB",fa:"fa-star"}, "Very Rare":{name:"Very Rare",color:"#9B59B6",fa:"fa-crown"},
    Legendary:{name:"Legendary",color:"#F1C40F",fa:"fa-fire-flame-curved"}
  },
  bestiaryCats: {
    ZAYIN:{name:"ZAYIN",color:"#27AE60",fa:"fa-seedling"}, TETH:{name:"TETH",color:"#45B3CB",fa:"fa-paw"},
    HE:{name:"HE",color:"#F1C40F",fa:"fa-spider"}, WAW:{name:"WAW",color:"#9B59B6",fa:"fa-dragon"},
    ALEPH:{name:"ALEPH",color:"#C7243A",fa:"fa-skull-crossbones"}, City:{name:"Город",color:"#696969",fa:"fa-city"},
    Distortions:{name:"Искажения",color:"#E0D8C8",fa:"fa-masks-theater"}
  },
  giftLevels: { 1:{name:"Уровень I",color:"#B0B0B0",fa:"fa-1"}, 2:{name:"Уровень II",color:"#2ECC71",fa:"fa-2"},
    3:{name:"Уровень III",color:"#3498DB",fa:"fa-3"}, 4:{name:"Уровень IV",color:"#9B59B6",fa:"fa-4"}, 5:{name:"Уровень V",color:"#F1C40F",fa:"fa-5"} },
  ruleTags: {
    sanity:{name:"Рассудок",color:"#45B3CB",fa:"fa-brain"},
    combat:{name:"Бой",color:"#C7243A",fa:"fa-khanda"},
    ego:{name:"Э.Г.О.",color:"#D94285",fa:"fa-gem"},
    anomaly:{name:"Аномалии",color:"#8FCC2A",fa:"fa-bug"},
    character:{name:"Персонаж",color:"#F1C40F",fa:"fa-user-gear"},
    homebrew:{name:"Хоумбрю",color:"#27AE60",fa:"fa-flask"}
  },
  loreTags: {
    setting:{name:"Сеттинг",color:"#27AE60",fa:"fa-city"},
    conflict:{name:"Конфликты",color:"#C7243A",fa:"fa-fire-flame-curved"},
    faction:{name:"Организации",color:"#45B3CB",fa:"fa-building"},
    timeline:{name:"Хронология",color:"#F1C40F",fa:"fa-hourglass-half"},
    people:{name:"Личности",color:"#9B59B6",fa:"fa-user-secret"}
  }
};

/* ============================================================
   Схемы полей по категориям
   ============================================================ */
const textBuilder = dictName => ([
  { t:"row", of:[
    { t:"text", k:"Name", label:"Название раздела", flex:3 },
    { t:"text", k:"Icon", label:"Иконка Font Awesome", ph:"fa-brain" }
  ]},
  { t:"text", k:"Sub", label:"Короткое описание (видно на свёрнутой карточке)" },
  { t:"text", k:"Date", label:"Дата / период (необязательно)", ph:"Завершена ~ 974 г.", nullable:true },
  { t:"checks", k:"Tags", dict:dictName, label:"Метки" },
  { t:"md", k:"Intro", label:"Вступление" },
  { t:"repeat", k:"Blocks", label:"Блоки текста", sub:[
    { t:"text", k:"Title", label:"Заголовок блока", flex:3 },
    { t:"text", k:"Date", label:"Дата" },
    { t:"md", k:"Body", label:"Текст блока" }
  ]}
]);

export const SCHEMAS = {
  classes: [
    { t:"text", k:"Name", label:"Название архетипа", ph:"Например: Агент R-Corp" },
    { t:"checks", k:"Type", dict:"types", label:"Типы урона / статуса" },
    { t:"checks", k:"Stats", dict:"stats", label:"Характеристики" },
    { t:"md", k:"Desc", label:"Описание архетипа (показывается над способностями)" },
    { t:"repeat", k:"Talents", label:"Таланты", sub:[
      { t:"text", k:"name", label:"Название", flex:2 },
      { t:"num", k:"level", label:"Уровень", def:1 },
      { t:"text", k:"Color", label:"HEX цвет" },
      { t:"md", k:"desc", label:"Описание" }
    ]}
  ],
  /* Основной класс (основа): канон — файл основы из реестра классов, у пользователей — запись типа baseclass */
  baseclass: [
    { t:"text", k:"Name", label:"Название класса", ph:"Например: Фиксер" },
    { t:"text", k:"BaseTitle", label:"Заголовок основы (необязательно)", ph:"Например: Фиксер (основной класс)", nullable:true },
    { t:"md", k:"Desc", label:"Описание класса" },
    { t:"repeat", k:"Talents", label:"Классовые способности", sub:[
      { t:"text", k:"name", label:"Название", flex:2 },
      { t:"num", k:"level", label:"Уровень", def:1 },
      { t:"text", k:"Color", label:"HEX цвет" },
      { t:"md", k:"desc", label:"Описание" }
    ]}
  ],
  feats: [
    { t:"text", k:"Name", label:"Название черты", ph:"Например: Железная хватка" },
    { t:"text", k:"Need", label:"Требования", ph:"Например: Сила 16 (пусто — если нет)", nullable:true, link:true },
    { t:"checks", k:"Base", dict:"featBases", label:"Категории" },
    { t:"md", k:"desc", label:"Описание черты" }
  ],
  equipment: [
    { t:"text", k:"Name", label:"Название", ph:"Например: Solemn Lament" },
    { t:"row", of:[
      { t:"num", k:"Level", label:"Уровень", def:1 },
      { t:"select", k:"ItemType", label:"Тип предмета", opts:{ Weapon:"Оружие", Armor:"Броня", Mod:"Мод / Аугмент" } },
      { t:"select", k:"Rarity", label:"Редкость", opts:{ Common:"Common", Uncommon:"Uncommon", Rare:"Rare", "Very Rare":"Very Rare", Legendary:"Legendary" } }
    ]},
    { t:"bool", k:"IsEGO", label:"Является Э.Г.О. экипировкой" },
    { t:"text", k:"Need", label:"Требования", ph:"Например: Сила 15", nullable:true, link:true },
    { t:"checks", k:"Type", dict:"types", label:"Типы урона (для оружия)" },
    { t:"checks", k:"Stats", dict:"stats", label:"Скейлинг" },
    { t:"md", k:"Desc", label:"Описание" }
  ],
  bestiary: [
    { t:"row", of:[ { t:"text", k:"Name", label:"Имя монстра" }, { t:"text", k:"Meta", label:"Мета", ph:"Средняя нежить, хаотично-злая" } ]},
    { t:"checks", k:"Category", dict:"bestiaryCats", label:"Уровень угрозы" },
    { t:"row", of:[ { t:"text", k:"ArmorClass", label:"КД" }, { t:"text", k:"HitPoints", label:"Хиты" },
                    { t:"text", k:"Speed", label:"Скорость" }, { t:"text", k:"Initiative", label:"Инициатива", ph:"+2 (12)" } ]},
    { t:"stats6", k:"Stats", label:'Характеристики — "16 (+3)" или просто "16" (модификатор посчитается сам)' },
    { t:"row", of:[ { t:"text", k:"SavingThrows", label:"Спасброски", ph:"Сил +6, Тел +7" }, { t:"text", k:"Skills", label:"Навыки", ph:"Восприятие +6" } ]},
    { t:"row", of:[ { t:"text", k:"DamageVulnerabilities", label:"Уязвимость к урону", link:true },
                    { t:"text", k:"DamageResistances", label:"Сопротивление урону", link:true },
                    { t:"text", k:"DamageImmunities", label:"Иммунитет к урону", link:true } ]},
    { t:"text", k:"ConditionImmunities", label:"Иммунитет к состояниям", ph:"Очарование, испуг", link:true },
    { t:"row", of:[ { t:"text", k:"Senses", label:"Чувства", link:true }, { t:"text", k:"Languages", label:"Языки" } ]},
    { t:"row", of:[ { t:"text", k:"Challenge", label:"Опасность / XP", ph:"5 (1800 XP)" },
                    { t:"text", k:"Proficiency", label:"Бонус мастерства", ph:"пусто — по CR" } ]},
    { t:"repeat", k:"Traits", label:"Особенности", sub:[ { t:"text", k:"name", label:"Название" }, { t:"md", k:"desc", label:"Описание" } ]},
    { t:"repeat", k:"Actions", label:"Действия", sub:[ { t:"text", k:"name", label:"Название" }, { t:"md", k:"desc", label:"Описание" } ]},
    { t:"repeat", k:"BonusActions", label:"Бонусные действия", sub:[ { t:"text", k:"name", label:"Название" }, { t:"md", k:"desc", label:"Описание" } ]},
    { t:"repeat", k:"Reactions", label:"Реакции", sub:[ { t:"text", k:"name", label:"Название" }, { t:"md", k:"desc", label:"Описание" } ]},
    { t:"md", k:"LegendaryIntro", label:"Легендарные действия — вступление (пусто = стандартный текст)" },
    { t:"repeat", k:"LegendaryActions", label:"Легендарные действия", sub:[ { t:"text", k:"name", label:"Название (можно указать стоимость)" }, { t:"md", k:"desc", label:"Описание" } ]},
    { t:"md", k:"LairIntro", label:"Действия логова — вступление (пусто = стандартный текст)" },
    { t:"repeat", k:"LairActions", label:"Действия логова", sub:[ { t:"text", k:"name", label:"Название" }, { t:"md", k:"desc", label:"Описание" } ]},
    { t:"md", k:"Lore", label:"Лор и описание" }
  ],
  gifts: [
    { t:"row", of:[
      { t:"text", k:"Name", label:"Название", ph:"Например: Blood-stained Gossypium", flex:3 },
      { t:"select", k:"Level", label:"Уровень", opts:{1:"I",2:"II",3:"III",4:"IV",5:"V"}, num:true }
    ]},
    { t:"checks", k:"Type", dict:"types", label:"Тип урона / статуса" },
    { t:"md", k:"Description", label:"Описание" }
  ],
  statuses: [
    { t:"text", k:"Name", label:"Название статуса", ph:"Например: Tremor (Тремор)" },
    { t:"md", k:"Effect", label:"Базовый эффект" },
    { t:"repeat", k:"SideEffects", label:"Сайд-эффекты", sub:[
      { t:"text", k:"sideeffectname", label:"Название" }, { t:"md", k:"sideeffect", label:"Описание" }
    ]}
  ],
  rules: textBuilder("ruleTags"),
  lore: textBuilder("loreTags"),
};
/* Синонимы для автоссылок — общее поле для всех конструкторов */
Object.values(SCHEMAS).forEach((list) => list.push({ t: 'text', k: 'Aliases', nullable: true,
  label: 'Синонимы для автоссылок — через запятую (необязательно)', ph: 'Например: кровоток, кровопускание' }));

/* Реестр классов (characters/systems.json): какой файл — основа класса, какой — список его архетипов.
   Синонимы к записям реестра не нужны, поэтому схема добавлена после цикла выше. */
export const CLASS_REGISTRY = 'characters/systems.json';
export const FILE_NAME_RE = /^[A-Za-z0-9_.-]{1,80}$/;
SCHEMAS.systems = [
  { t:"row", of:[
    { t:"text", k:"id", label:"ID (латиница; не меняйте — на него ссылаются архетипы пользователей)", ph:"fixer" },
    { t:"text", k:"Name", label:"Название класса", ph:"Фиксер", flex:2 }
  ]},
  { t:"text", k:"BaseTitle", label:"Заголовок панели «Основа»", ph:"Фиксер (основной класс)" },
  { t:"row", of:[
    { t:"text", k:"Base", label:"Файл основы (в папке characters/)", ph:"fixer.json" },
    { t:"text", k:"Archetypes", label:"Файл архетипов (в папке characters/)", ph:"classes.json" }
  ]}
];
/** Путь файла из реестра классов: «fixer.json» → «characters/fixer.json». */
export const classFileRel = (name) => {
  const n = String(name ?? '').trim();
  return !n ? '' : n.includes('/') ? n : `characters/${n}`;
};

/* Какие каноничные файлы редактируются какой схемой (остальные — только кодом).
   Файлы классов, созданные в админ-панели, схему получают из реестра — см. canonSchemaFor. */
export const CANON_SCHEMAS = {
  'characters/classes.json': 'classes', 'characters/bloodarch.json': 'classes',
  'characters/fixer.json': 'baseclass', 'characters/bloodfiend.json': 'baseclass',
  [CLASS_REGISTRY]: 'systems',
  'characters/feats.json': 'feats', 'items/equipment.json': 'equipment', 'items/egogifts.json': 'gifts',
  'mechanics/statuses.json': 'statuses', 'mechanics/rules.json': 'rules',
  'world/lore.json': 'lore', 'world/bestiary.json': 'bestiary',
};

/** Схема каноничного файла; registry — разобранный реестр классов (массив) или null. */
export function canonSchemaFor(rel, registry) {
  if (CANON_SCHEMAS[rel]) return CANON_SCHEMAS[rel];
  for (const c of arr(registry)) {
    if (classFileRel(c?.Base) === rel) return 'baseclass';
    if (classFileRel(c?.Archetypes) === rel) return 'classes';
  }
  return null;
}

/* ============================================================
   Разметка формы
   ============================================================ */
const plainMd = (f, val) => `<textarea class="cloud-input" data-f="${esc(f.k)}">${esc(val ?? '')}</textarea>`;

export function fieldHtml(f, data, ctx = {}) {
  const val = data?.[f.k];
  const lbl = f.label ? `<div class="tech-text" style="margin-bottom:4px">${esc(f.label)}</div>` : '';
  switch (f.t) {
    case 'row':
      return `<div class="b-row">${f.of.map((x) => `<div style="flex:${x.flex || 1}">${fieldHtml(x, data, ctx)}</div>`).join('')}</div>`;
    case 'text':
      return `${lbl}<input type="text" class="cloud-input" data-f="${esc(f.k)}" ${f.link ? 'data-link="1"' : ''} placeholder="${esc(f.ph || '')}" value="${esc(val ?? '')}">`;
    case 'num':
      return `${lbl}<input type="number" class="cloud-input" data-f="${esc(f.k)}" value="${esc(val ?? f.def ?? 1)}" min="1">`;
    case 'md':
      return `${lbl}${(ctx.md || plainMd)(f, val)}`;
    case 'bool':
      return `<div class="check-group"><label class="check-label">
        <input type="checkbox" data-f="${esc(f.k)}" ${val ? 'checked' : ''}> ${esc(f.label)}</label></div>`;
    case 'select': {
      // значение не из списка (старые данные) не теряем — показываем его отдельным вариантом
      const opts = val != null && val !== '' && !(String(val) in f.opts) ? { ...f.opts, [val]: val } : f.opts;
      return `${lbl}<select class="cloud-select" data-f="${esc(f.k)}" ${f.num ? 'data-num="1"' : ''}>${
        Object.entries(opts).map(([k, v]) => `<option value="${esc(k)}" ${String(val) === String(k) ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
    }
    case 'checks': {
      const dict = { ...DICT[f.dict] };
      arr(val).forEach((k) => { if (!dict[k]) dict[k] = { name: k }; });
      return `${lbl}<div class="check-group" data-checks="${esc(f.k)}">${
        Object.entries(dict).map(([k, d]) => `<label class="check-label">
          <input type="checkbox" value="${esc(k)}" ${arr(val).includes(k) ? 'checked' : ''}> ${esc(d.name)}</label>`).join('')}</div>`;
    }
    case 'stats6':
      return `${lbl}<div class="b-row" data-stats6="${esc(f.k)}">${STATS6
        .map((s) => `<div><div class="tech-text">${s}</div>
          <input type="text" class="cloud-input" data-f="${s}" value="${esc(val?.[s] ?? '10 (+0)')}"></div>`).join('')}</div>`;
    case 'repeat':
      return `<div class="sec-head"><div class="tech-text" style="color:var(--color-yellow)">${esc(f.label)}</div>
          <button type="button" class="mini-btn" data-act="repeat-add" data-key="${esc(f.k)}">+ Добавить</button></div>
        <div data-repeat="${esc(f.k)}">${arr(val).map((row) => repeatRow(f, row, ctx)).join('')}</div>`;
    default: return '';
  }
}

/** Один блок repeat-поля. Исходная строка хранится в data-orig — её поля вне схемы не теряются при сборке. */
export function repeatRow(f, row, ctx = {}) {
  const inline = f.sub.filter((s) => s.t !== 'md');
  const blocks = f.sub.filter((s) => s.t === 'md');
  return `<div class="b-entry" data-orig="${esc(JSON.stringify(row || {}))}">
    <button type="button" class="mini-btn danger" style="position:absolute;right:10px;top:10px" data-act="repeat-del"><i class="fa-solid fa-trash"></i></button>
    <div class="b-row" style="width:calc(100% - 46px)">${inline.map((s) => fieldHtml(s, row, ctx)).join('')}</div>
    ${blocks.map((s) => fieldHtml(s, row, ctx)).join('')}
  </div>`;
}

export const formHtml = (schema, data, ctx) => schema.map((f) => fieldHtml(f, data || {}, ctx)).join('');

/* ============================================================
   Сбор формы
   ============================================================ */
const empty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);

/**
 * Пишет собранные значения поверх orig. Без orig (новая запись) — все поля схемы, как в конструкторе.
 * С orig (правка готовой записи) — поля вне схемы остаются, а пустые поля схемы, которых не было, не добавляются.
 */
function merge(collected, orig) {
  if (!orig) return collected;
  const out = { ...orig };
  for (const [k, v] of Object.entries(collected)) if (k in orig || !empty(v)) out[k] = v;
  return out;
}

function collectField(f, scope) {
  const q = (k) => scope.querySelector(`[data-f="${CSS.escape(k)}"]`);
  switch (f.t) {
    case 'row': { const o = {}; f.of.forEach((x) => Object.assign(o, collectField(x, scope))); return o; }
    case 'bool': return { [f.k]: !!q(f.k)?.checked };
    case 'checks': return { [f.k]: [...scope.querySelectorAll(`[data-checks="${CSS.escape(f.k)}"] input:checked`)].map((i) => i.value) };
    case 'stats6': {
      const box = scope.querySelector(`[data-stats6="${CSS.escape(f.k)}"]`), o = {};
      STATS6.forEach((s) => { o[s] = box?.querySelector(`[data-f="${s}"]`)?.value || ''; });
      return { [f.k]: o };
    }
    case 'repeat': {
      const rows = [...scope.querySelectorAll(`[data-repeat="${CSS.escape(f.k)}"] > .b-entry`)].map((el) => {
        const o = {};
        f.sub.forEach((s) => {
          const inp = el.querySelector(`[data-f="${CSS.escape(s.k)}"]`);
          o[s.k] = s.t === 'num' ? (parseInt(inp?.value) || 1) : (inp?.value || '');
        });
        let orig;
        try { orig = el.dataset.orig ? JSON.parse(el.dataset.orig) : undefined; } catch { orig = undefined; }
        return orig && Object.keys(orig).length ? merge(o, orig) : o;
      });
      return { [f.k]: rows };
    }
    case 'num': return { [f.k]: parseInt(q(f.k)?.value) || (f.def ?? 1) };
    case 'select': {
      const el = q(f.k);
      return { [f.k]: el?.dataset.num ? (parseInt(el.value) || 1) : (el?.value || '') };
    }
    default: {
      const v = q(f.k)?.value ?? '';
      return { [f.k]: (f.nullable && v.trim() === '') ? null : v };
    }
  }
}

/** Собрать запись из формы. orig — исходная запись (её поля вне схемы сохраняются). */
export function collectFields(schema, scope, orig) {
  const out = {};
  schema.forEach((f) => Object.assign(out, collectField(f, scope)));
  return merge(out, orig);
}

/** Обработчик кнопок «+ Добавить» / удалить для repeat-полей внутри scope. */
export function repeatAction(el, schema, ctx = {}) {
  const act = el.dataset.act;
  if (act === 'repeat-del') { el.closest('.b-entry')?.remove(); return true; }
  if (act !== 'repeat-add') return false;
  const find = (list) => list.reduce((hit, f) => hit || (f.t === 'row' ? find(f.of) : f.k === el.dataset.key && f.t === 'repeat' ? f : null), null);
  const f = find(schema);
  if (f) el.closest('.sec-head').nextElementSibling.insertAdjacentHTML('beforeend', repeatRow(f, {}, ctx));
  return !!f;
}
