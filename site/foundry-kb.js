/* База знаний для окна модуля Foundry pm5e (docs/foundry.md, этапы 3–4): разделы, загрузка канона, карточки, ссылки, поиск.
   Без DOM: Markdown → HTML делает вызывающий код (md), загрузку файлов — read(lang, rel) (Firestore или встроенная копия).
   Тесты — tests/unit/foundry-kb.test.mjs. Ключи записей совпадают с сайтом (navigation.js, uidOf), поэтому запись,
   перенесённая с сайта, и та же запись из окна обновляют один и тот же документ Foundry. */

import { canExport } from './foundry-export.js';

/** Разделы в порядке Базы знаний сайта. file — файл канона; у архетипов и классов — реестр characters/systems.json. */
export const KB_CATS = [
  { id: 'classes', ru: 'Архетипы', en: 'Archetypes', icon: 'fa-book-journal-whills' },
  { id: 'bases', ru: 'Классы', en: 'Classes', icon: 'fa-sitemap' },
  { id: 'feats', ru: 'Черты', en: 'Feats', icon: 'fa-dumbbell', file: 'characters/feats.json' },
  { id: 'equipment', ru: 'Снаряжение', en: 'Equipment', icon: 'fa-shield-halved', file: 'items/equipment.json' },
  { id: 'rules', ru: 'Правила', en: 'Rules', icon: 'fa-scale-balanced', file: 'mechanics/rules.json' },
  { id: 'bestiary', ru: 'Бестиарий', en: 'Bestiary', icon: 'fa-skull', file: 'world/bestiary.json' },
  { id: 'gifts', ru: 'Э.Г.О. гифты', en: 'E.G.O. Gifts', icon: 'fa-gem', file: 'items/egogifts.json' },
  { id: 'statuses', ru: 'Статус-эффекты', en: 'Status Effects', icon: 'fa-biohazard', file: 'mechanics/statuses.json' },
  { id: 'lore', ru: 'Время и история', en: 'Time and History', icon: 'fa-hourglass-half', file: 'world/lore.json' },
];
const LINK_PRIO = ['statuses', 'rules', 'feats', 'bases', 'classes', 'equipment', 'bestiary', 'lore', 'gifts'];

/** Все файлы, которые читает окно (для встроенной копии в модуле). */
export const KB_FILES = ['characters/systems.json', ...KB_CATS.filter((c) => c.file).map((c) => c.file)];

const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const str = (v) => String(v ?? '').trim();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const norm = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

/** Названия, по которым на запись ссылаются: «Рус (Eng)» целиком и по частям, плюс поле «Синонимы» (как на сайте). */
export function aliasesOf(it) {
  const name = str(it?.Name);
  if (!name) return [];
  const out = new Set([name]);
  const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(name);
  if (m) { if (m[1].trim()) out.add(m[1].trim()); out.add(m[2].trim()); }
  String(it.Aliases ?? '').split(',').map((s) => s.trim()).filter(Boolean).forEach((a) => out.add(a));
  return [...out];
}

/**
 * Загрузка канона. read(rel) → разобранный JSON файла (с учётом языка и запасной копии) или null.
 * → { entries: [{ cat, key, uid, it, name, sys }], byCat: { cat: [...] } }
 */
export async function loadKB(read) {
  const entries = [];
  const add = (cat, it, sys) => {
    if (!it || !str(it.Name)) return;
    const key = `k:${sys ? `${sys}:` : ''}${it.Name}`;
    entries.push({ cat, key, uid: `${cat}:${key}`, it, name: str(it.Name), sys: sys || '' });
  };
  const reg = arr(await read('characters/systems.json').catch(() => null));
  for (const r of reg) {
    const base = r.Base ? await read(`characters/${r.Base}`).catch(() => null) : null;
    const b = Array.isArray(base) ? base[0] : base;
    if (b) add('bases', { ...b, Name: b.Name || r.Name, BaseTitle: r.BaseTitle || b.BaseTitle }, r.id);   // ключ как на сайте: k:<id класса>:<имя>
    const archs = r.Archetypes ? await read(`characters/${r.Archetypes}`).catch(() => null) : null;
    arr(archs).forEach((a) => add('classes', { ...a, __class: r.Name }, r.id));
  }
  for (const c of KB_CATS.filter((x) => x.file)) {
    arr(await read(c.file).catch(() => null)).forEach((it) => add(c.id, it, ''));
  }
  const byCat = Object.fromEntries(KB_CATS.map((c) => [c.id, []]));
  entries.forEach((e) => byCat[e.cat].push(e));
  const sorters = {
    classes: (a, b) => (a.it.No ?? 9999) - (b.it.No ?? 9999),
    equipment: (a, b) => (a.it.Level ?? 0) - (b.it.Level ?? 0),
    gifts: (a, b) => (a.it.Level ?? 0) - (b.it.Level ?? 0),
  };
  for (const [cat, list] of Object.entries(byCat)) list.sort((a, b) => (sorters[cat]?.(a, b) || 0) || a.name.localeCompare(b.name));
  // Ссылка ведёт сначала на точное название, потом на синонимы и части «Рус (Eng)»; при равенстве — по приоритету
  // разделов (статусы и механика раньше гифтов: `Потопление` — статус, а не гифт «Бурлящая сфера (Потопление)»)
  const index = new Map();
  const byPrio = [...entries].sort((a, b) => LINK_PRIO.indexOf(a.cat) - LINK_PRIO.indexOf(b.cat));
  byPrio.forEach((e) => { const k = norm(e.name); if (!index.has(k)) index.set(k, e); });
  byPrio.forEach((e) => aliasesOf(e.it).forEach((a) => { const k = norm(a); if (!index.has(k)) index.set(k, e); }));
  return { entries, byCat, index };
}

/** Запись по цели ссылки `текст::Цель` (или по названию) — или null. */
export const resolveLink = (kb, target) => kb.index.get(norm(target)) || null;

/** Поиск: по названию (сначала) и по тексту записи. */
export function searchKB(list, query) {
  const q = norm(query);
  if (!q) return list;
  const inName = [], inText = [];
  for (const e of list) {
    if (norm(e.name).includes(q)) inName.push(e);
    else if (norm(plainText(e.it)).includes(q)) inText.push(e);
  }
  return [...inName, ...inText];
}
function plainText(it) {
  const parts = [];
  const walk = (v) => {
    if (typeof v === 'string') parts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(it);
  return parts.join(' ');
}

/** Markdown записи → Markdown для окна: `текст::Цель` и `Имя` — ссылки внутри окна, калькуляторы убираются. */
export function kbMarkdown(text) {
  const link = (shown, target) => `<a class="pm5e-link" data-action="link" data-target="${esc(target.trim())}">${esc(shown)}</a>`;
  return String(text ?? '')
    .replace(/\[calc:[^\]\n]*\]/gi, '')
    .replace(/`([^`\n]*?)::([^`\n]*)`/g, (_, shown, target) => link(shown, target))
    .replace(/`([^`\n]+)`/g, (_, name) => link(name, name));
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
const STATS = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const BESTIARY_SECTIONS = [
  ['Traits', 'Особенности', 'Traits'], ['Actions', 'Действия', 'Actions'], ['BonusActions', 'Бонусные действия', 'Bonus Actions'],
  ['Reactions', 'Реакции', 'Reactions'], ['LegendaryActions', 'Легендарные действия', 'Legendary Actions'],
  ['LairActions', 'Действия логова', 'Lair Actions'],
];

/**
 * Карточка записи: { title, meta, tags: [], html }. md(text) — Markdown → безопасный HTML (у модуля: marked + DOMPurify).
 */
export function entryView(e, md, lang = 'ru') {
  const en = lang === 'en';
  const it = e.it;
  const M = (v) => (str(v) ? md(kbMarkdown(v)) : '');
  const sub = (name, body, extra = '') => `<section class="pm5e-sub"><h4>${esc(name)}${extra ? ` <small>${esc(extra)}</small>` : ''}</h4>${M(body)}</section>`;
  const line = (label, v) => (str(v) ? `<p class="pm5e-line"><b>${esc(label)}:</b> ${md(kbMarkdown(v)).replace(/^<p>|<\/p>\s*$/g, '')}</p>` : '');
  const L = (ru, enText) => (en ? enText : ru);
  const view = { title: e.name, meta: '', tags: [], html: '' };
  switch (e.cat) {
    case 'classes':
    case 'bases':
      view.meta = e.cat === 'classes' ? str(it.__class) : str(it.BaseTitle);
      view.tags = [...arr(it.Type), ...arr(it.Stats)];
      view.html = M(it.Desc) + arr(it.Talents).map((t) => sub(t.name, t.desc, str(t.level) ? `${L('Ур.', 'Lv.')} ${t.level}` : '')).join('');
      break;
    case 'feats':
      view.tags = arr(it.Base);
      view.html = line(L('Требования', 'Requirements'), it.Need) + M(it.desc);
      break;
    case 'equipment':
      view.meta = [str(it.Rarity), it.Level != null ? `${L('Уровень', 'Level')} ${it.Level}` : '', it.IsEGO ? 'Э.Г.О.' : ''].filter(Boolean).join(' · ');
      view.tags = [...arr(it.ItemType), ...arr(it.Type), ...arr(it.Stats)];
      view.html = line(L('Требования', 'Requirements'), it.Need) + M(it.Desc);
      break;
    case 'gifts':
      view.meta = `${L('Уровень', 'Tier')} ${ROMAN[Number(it.Level) - 1] || str(it.Level)}`;
      view.tags = arr(it.Type);
      view.html = M(it.Description);
      break;
    case 'statuses':
      view.html = M(it.Effect) + arr(it.SideEffects).map((s) => sub(s.sideeffectname, s.sideeffect)).join('');
      break;
    case 'bestiary': {
      view.meta = str(it.Meta);
      view.tags = arr(it.Category);
      const stats = `<div class="pm5e-stats">${STATS.map((k) => `<div><b>${k}</b>${esc(it.Stats?.[k] ?? '—')}</div>`).join('')}</div>`;
      view.html = line(L('КД', 'AC'), it.ArmorClass) + line(L('Хиты', 'HP'), it.HitPoints) + line(L('Скорость', 'Speed'), it.Speed)
        + stats + line(L('Спасброски', 'Saving Throws'), it.SavingThrows) + line(L('Навыки', 'Skills'), it.Skills)
        + line(L('Уязвимость к урону', 'Damage Vulnerabilities'), it.DamageVulnerabilities)
        + line(L('Сопротивление урону', 'Damage Resistances'), it.DamageResistances)
        + line(L('Иммунитет к урону', 'Damage Immunities'), it.DamageImmunities)
        + line(L('Иммунитет к состояниям', 'Condition Immunities'), it.ConditionImmunities)
        + line(L('Чувства', 'Senses'), it.Senses) + line(L('Языки', 'Languages'), it.Languages)
        + line(L('Опасность', 'Challenge'), it.Challenge)
        + BESTIARY_SECTIONS.map(([k, ru, enT]) => {
          const list = arr(it[k]).filter((a) => a && (a.name || a.desc));
          return list.length ? `<h3>${esc(L(ru, enT))}</h3>${list.map((a) => sub(a.name, a.desc)).join('')}` : '';
        }).join('')
        + (str(it.Lore) ? `<hr>${M(it.Lore)}` : '');
      break;
    }
    default: // rules, lore
      view.meta = str(it.Sub);
      view.tags = arr(it.Tags);
      view.html = M(it.Intro) + arr(it.Blocks).map((b) => sub(b.Title, b.Body, str(b.Date))).join('');
  }
  view.tags = view.tags.map(str).filter(Boolean);
  return view;
}

/** Что можно сделать с записью в Foundry: создать в мире (документ) и выдать персонажу (только предметы). */
export function entryActions(cat) {
  const can = canExport(cat);
  return { toWorld: can, toActor: can && !['bestiary', 'rules', 'lore'].includes(cat) };
}

/** Ссылка на запись на сайте (как кнопка «Ссылка» у карточки). */
export const siteUrlOf = (site, e) => (site ? `${String(site).replace(/\/+$/, '')}/navigation.html#${e.cat}/${encodeURIComponent(e.name)}` : '');

/** «…/navigation.html#feats/Имя» → { cat, name } или null — для ссылок «Открыть в Базе знаний» в описаниях документов. */
export function parseSiteLink(href) {
  const m = /navigation\.html#([a-z]+)\/(.+)$/i.exec(String(href ?? ''));
  if (!m) return null;
  let name = m[2];
  try { name = decodeURIComponent(name); } catch { /* как есть */ }
  return { cat: m[1], name };
}
