/* Быстрый экспорт записей Базы знаний в Foundry VTT (система dnd5e) — docs/foundry.md, этап 1.
   Без DOM (покрыто тестами tests/unit/foundry-export.test.mjs). Markdown → HTML делает вызывающий код
   (opts.toHtml: marked + DOMPurify), здесь — только подготовка текста и сборка документов Foundry.

   Пакет: { format: "pm5e-foundry", version: 1, items, actors, journals } — его же будет принимать модуль Foundry
   (этап 3). Сейчас пакет переносится макросом-скриптом (foundryMacro) или файлом для «Import Data» (один документ).
   Каждый документ помечен flags.pm5e.key — повторный экспорт обновляет созданное раньше, а не плодит копии. */

import { importPackage } from './foundry-import.js';

export const FORMAT = 'pm5e-foundry';
export const FLAG = 'pm5e';
export const ROOT_FOLDER = 'Mephistopheles Terminal';

const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const str = (v) => String(v ?? '').trim();
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/* ---------- Текст ---------- */

/** Markdown записи → Markdown для Foundry: автоссылки `текст::Цель` и `Имя` — жирным текстом, калькуляторы
 *  [calc:…] убираются, картинки [URL W:24] — абсолютным адресом сайта (в Foundry относительный путь ведёт на его сервер). */
export function prepMarkdown(text, origin = '') {
  return String(text ?? '')
    .replace(/\[calc:[^\]\n]*\]/gi, '')
    .replace(/`([^`\n]*?)::[^`\n]*`/g, (_, t) => `**${t}**`)
    .replace(/`([^`\n]+)`/g, '**$1**')
    .replace(/\[\s*([^\s\]<>"'`]+?\.(?:png|jpe?g|gif|webp|svg|avif))((?:\s+[WH]\s*:\s*\d+)*)\s*\]/gi, (_, url, opts) => {
      const w = (/W\s*:\s*(\d+)/i.exec(opts) || [])[1];
      const h = (/H\s*:\s*(\d+)/i.exec(opts) || [])[1];
      const abs = /^https?:\/\//i.test(url) ? url : `${origin}/${url.replace(/^\/+/, '')}`;
      return `<img src="${abs.replace(/"/g, '%22')}" alt=""${w ? ` width="${w}"` : ''}${h ? ` height="${h}"` : ''}>`;
    });
}

/** Простой Markdown → HTML для тестов и запасного случая (абзацы, жирный, курсив). На сайте — marked + DOMPurify. */
export function plainHtml(md) {
  return String(md ?? '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p>${escHtml(p).replace(/&lt;img ([^]*?)&gt;/g, (_, a) => `<img ${a.replace(/&quot;/g, '"')}>`)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>').replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function ctx(opts = {}) {
  const origin = opts.origin || '';
  const toHtml = opts.toHtml || plainHtml;
  return {
    origin,
    lang: opts.lang || 'ru',
    html: (md) => (str(md) ? toHtml(prepMarkdown(md, origin)) : ''),
    link: (url) => (url ? `<p><a href="${escHtml(url)}">${opts.lang === 'en' ? 'Open in the Knowledge Base' : 'Открыть в Базе знаний'}</a></p>` : ''),
    now: opts.now || new Date().toISOString(),
  };
}

function flags(c, ref, extra = {}) {
  return { [FLAG]: { key: `${ref.cat}/${ref.key}`, cat: ref.cat, url: ref.url || '', exported: c.now, ...extra } };
}
const source = { book: 'Mephistopheles Terminal' };

/* ---------- Предметы ---------- */

export const RARITY = { Common: 'common', Uncommon: 'uncommon', Rare: 'rare', 'Very Rare': 'veryRare', Legendary: 'legendary', Artifact: 'artifact' };

function feat(c, name, descHtml, { requirements = '', type = 'feat', subtype = '', activation = '' } = {}) {
  const system = { description: { value: descHtml }, source, requirements, type: { value: type, subtype } };
  if (activation) system.activation = { type: activation, cost: 1 };
  return { name: str(name) || '—', type: 'feat', system };
}

/** Черта → предмет «feat». */
export function featItem(it, ref, opts) {
  const c = ctx(opts);
  const d = feat(c, it.Name, c.html(it.desc) + c.link(ref.url), { requirements: str(it.Need) });
  d.flags = flags(c, ref, { base: arr(it.Base) });
  return d;
}

/** Э.Г.О. гифт → «feat» (подтип не задаём: у dnd5e нет подходящего), уровень — в требованиях. */
export function giftItem(it, ref, opts) {
  const c = ctx(opts);
  const lvl = ['I', 'II', 'III', 'IV', 'V'][Number(it.Level) - 1] || str(it.Level);
  const req = (c.lang === 'en' ? 'E.G.O. gift' : 'Э.Г.О. гифт') + (lvl ? `, ${c.lang === 'en' ? 'tier' : 'уровень'} ${lvl}` : '');
  const d = feat(c, it.Name, c.html(it.Description) + c.link(ref.url), { requirements: req });
  d.flags = flags(c, ref, { gift: true, level: Number(it.Level) || null, types: arr(it.Type) });
  return d;
}

/** Снаряжение: оружие → «weapon», броня → «equipment», модификатор → «equipment» (безделушка). */
export function equipmentItem(it, ref, opts) {
  const c = ctx(opts);
  const head = [
    it.Level != null && it.Level !== '' ? `${c.lang === 'en' ? 'Level' : 'Уровень'} ${it.Level}` : '',
    str(it.Need) ? `${c.lang === 'en' ? 'Requirements' : 'Требования'}: ${str(it.Need)}` : '',
  ].filter(Boolean).join(' · ');
  const desc = (head ? c.html(`*${head}*`) : '') + c.html(it.Desc) + c.link(ref.url);
  const type = it.ItemType === 'Weapon' ? 'weapon' : 'equipment';
  const system = { description: { value: desc }, source, quantity: 1 };
  if (RARITY[it.Rarity]) system.rarity = RARITY[it.Rarity];
  if (it.ItemType === 'Mod') system.type = { value: 'trinket' };
  return { name: str(it.Name) || '—', type, system, flags: flags(c, ref, { ego: !!it.IsEGO, level: it.Level ?? null }) };
}

/** Архетип или основа класса → способности отдельными «feat» (тип «class») в своей папке. */
export function talentItems(it, ref, opts) {
  const c = ctx(opts);
  const folder = str(it.Name);
  const out = [];
  if (str(it.Desc)) {
    const d = feat(c, it.Name, c.html(it.Desc) + c.link(ref.url), { type: 'class' });
    d.flags = flags(c, ref, { part: 'desc' });
    d._folder = folder;
    out.push(d);
  }
  arr(it.Talents).forEach((t, i) => {
    if (!t || !(t.name || t.desc)) return;
    const lvl = str(t.level);
    const req = `${it.Name}${lvl ? `, ${c.lang === 'en' ? 'level' : 'ур.'} ${lvl}` : ''}`;
    const d = feat(c, t.name, c.html(t.desc) + c.link(ref.url), { type: 'class', requirements: req });
    d.flags = { [FLAG]: { ...flags(c, ref)[FLAG], key: `${ref.cat}/${ref.key}#${i}`, level: Number(lvl) || null } };
    d._folder = folder;
    out.push(d);
  });
  return out;
}

/* ---------- Журналы (правила, лор) ---------- */

/** Запись с Intro и Blocks → запись журнала: вступление и каждый блок — отдельной страницей. */
export function journalEntry(it, ref, opts) {
  const c = ctx(opts);
  const page = (name, html, sort) => ({ name: str(name) || '—', type: 'text', sort, text: { content: html, format: 1 } });
  const pages = [];
  const intro = [str(it.Sub) ? c.html(`*${it.Sub}*`) : '', c.html(it.Intro), c.link(ref.url)].join('');
  pages.push(page(it.Name, intro, 0));
  arr(it.Blocks).forEach((b, i) => {
    if (!b || !(b.Title || b.Body)) return;
    pages.push(page(str(b.Title) + (b.Date ? ` · ${b.Date}` : ''), c.html(b.Body), (i + 1) * 100));
  });
  return { name: str(it.Name) || '—', pages, flags: flags(c, ref) };
}

/* ---------- Бестиарий → актёр NPC ---------- */

const SIZES = [
  [/^(крошечн|tiny)/i, 'tiny', 0.5], [/^(маленьк|small)/i, 'sm', 1], [/^(средн|medium)/i, 'med', 1],
  [/^(больш|large)/i, 'lg', 2], [/^(огромн|huge)/i, 'huge', 3], [/^(громадн|исполинск|gargantuan)/i, 'grg', 4],
];
const CREATURE_TYPES = [
  [/аберрац|aberration/i, 'aberration'], [/зверь|beast/i, 'beast'], [/небожител|celestial/i, 'celestial'],
  [/конструкт|construct/i, 'construct'], [/дракон|dragon/i, 'dragon'], [/элементал|elemental/i, 'elemental'],
  [/фея|fey/i, 'fey'], [/исчади|fiend/i, 'fiend'], [/великан|giant/i, 'giant'], [/гуманоид|humanoid/i, 'humanoid'],
  [/чудовищ|monstrosity/i, 'monstrosity'], [/слиз|ooze/i, 'ooze'], [/растени|plant/i, 'plant'], [/нежить|undead/i, 'undead'],
];
export const ABILITY = { 'сил': 'str', 'лов': 'dex', 'тел': 'con', 'инт': 'int', 'мдр': 'wis', 'хар': 'cha',
  str: 'str', dex: 'dex', con: 'con', int: 'int', wis: 'wis', cha: 'cha' };
export const SKILLS = {
  'акробатика': 'acr', 'уход за животными': 'ani', 'магия': 'arc', 'атлетика': 'ath', 'обман': 'dec', 'история': 'his',
  'проницательность': 'ins', 'запугивание': 'itm', 'анализ': 'inv', 'расследование': 'inv', 'медицина': 'med', 'природа': 'nat',
  'внимательность': 'prc', 'восприятие': 'prc', 'выступление': 'prf', 'убеждение': 'per', 'религия': 'rel',
  'ловкость рук': 'slt', 'скрытность': 'ste', 'выживание': 'sur',
  acrobatics: 'acr', 'animal handling': 'ani', arcana: 'arc', athletics: 'ath', deception: 'dec', history: 'his',
  insight: 'ins', intimidation: 'itm', investigation: 'inv', medicine: 'med', nature: 'nat', perception: 'prc',
  performance: 'prf', persuasion: 'per', religion: 'rel', 'sleight of hand': 'slt', stealth: 'ste', survival: 'sur',
};
const SKILL_ABILITY = { acr: 'dex', ani: 'wis', arc: 'int', ath: 'str', dec: 'cha', his: 'int', ins: 'wis', itm: 'cha',
  inv: 'int', med: 'wis', nat: 'int', prc: 'wis', prf: 'cha', per: 'cha', rel: 'int', slt: 'dex', ste: 'dex', sur: 'wis' };
const MOVES = [[/лаза|climb/i, 'climb'], [/лета|fly/i, 'fly'], [/плава|swim/i, 'swim'], [/копа|burrow/i, 'burrow']];
const SENSES = [[/т[её]мное зрение|darkvision/i, 'darkvision'], [/слеп\S*\s*зрение|слепозрение|blindsight/i, 'blindsight'],
  [/чувство вибрац\S*|tremorsense/i, 'tremorsense'], [/истинное зрение|truesight/i, 'truesight']];

const firstInt = (v, def = null) => { const m = /-?\d+/.exec(String(v ?? '')); return m ? Number(m[0]) : def; };
const mod = (score) => Math.floor((score - 10) / 2);
const noDash = (v) => (/^[\s—–-]*$/.test(String(v ?? '')) ? '' : str(v));
const stripLinks = (v) => String(v ?? '').replace(/`([^`\n]*?)::[^`\n]*`/g, '$1').replace(/`([^`\n]+)`/g, '$1');

/** «Огромное чудовище, без мировоззрения» → { size, type, alignment }. */
export function parseMeta(meta) {
  const s = str(meta);
  const [head, ...rest] = s.split(',');
  const words = str(head);
  const size = SIZES.find(([re]) => re.test(words));
  const type = CREATURE_TYPES.find(([re]) => re.test(words));
  const custom = type ? '' : words.replace(size ? words.split(/\s+/)[0] : '', '').trim();
  return { size: size ? size[1] : 'med', tokenSize: size ? size[2] : 1, type: type ? type[1] : '', custom, alignment: rest.join(',').trim() };
}

/** «30 фт., лазая 30 фт., летая 60 фт.» → { walk, climb, fly, … } (первое число без слова — ходьба). */
export function parseSpeed(speed) {
  const out = { units: 'ft' };
  String(speed ?? '').split(/[,;]/).forEach((part, i) => {
    const n = firstInt(part);
    if (n == null) return;
    const mv = MOVES.find(([re]) => re.test(part));
    if (mv) out[mv[1]] = out[mv[1]] ?? n;
    else if (i === 0 && out.walk == null) out.walk = n;
  });
  if (out.walk == null) out.walk = 0;
  return out;
}

/** «тёмное зрение 60 фт., чувство вибрации 120 фт., пассивная Внимательность 16» → дистанции + остальное текстом. */
export function parseSenses(senses) {
  const ranges = {}, special = [];
  stripLinks(senses).split(/[,;]/).map(str).filter(Boolean).forEach((part) => {
    if (/пассивн|passive/i.test(part)) return;               // Foundry считает пассивную внимательность сам
    const s = SENSES.find(([re]) => re.test(part));
    const n = firstInt(part);
    if (s && n != null) ranges[s[1]] = n;
    else special.push(part);
  });
  return { ranges, special: special.join(', ') };
}

/** «Сил +6, Тел +7» → ['str', 'con']. */
export function parseSaves(text) {
  return String(text ?? '').split(/[,;]/).map((p) => ABILITY[str(p).split(/\s+/)[0].toLowerCase()]).filter(Boolean);
}

/** «Внимательность +6, Обман +12» → { prc: 1, dec: 2 } — владение (1) или компетентность (2) по бонусу. */
export function parseSkills(text, scores, pb) {
  const out = {};
  String(text ?? '').split(/[,;]/).forEach((part) => {
    const m = /^(.*?)\s*([+-]\s*\d+)\s*$/.exec(str(part));
    if (!m) return;
    const key = SKILLS[m[1].trim().toLowerCase()];
    if (!key) return;
    const bonus = Number(m[2].replace(/\s/g, ''));
    const base = mod(scores[SKILL_ABILITY[key]] ?? 10);
    out[key] = pb && bonus - base >= pb * 2 ? 2 : 1;
  });
  return out;
}

/** Опасность «5 (1 800 опыта)», «1/4» → число или null. */
export function parseCR(v) {
  const m = /^\s*(\d+)(?:\s*\/\s*(\d+))?/.exec(String(v ?? ''));
  if (!m) return null;
  return m[2] ? Number(m[1]) / Number(m[2]) : Number(m[1]);
}
const pbFromCR = (cr) => (cr == null ? 2 : cr < 1 ? 2 : 2 + Math.floor((cr - 1) / 4));

const ACTION_SECTIONS = [
  { k: 'Traits', act: '' }, { k: 'Actions', act: 'action' }, { k: 'BonusActions', act: 'bonus' },
  { k: 'Reactions', act: 'reaction' }, { k: 'LegendaryActions', act: 'legendary', intro: 'LegendaryIntro' },
  { k: 'LairActions', act: 'lair', intro: 'LairIntro' },
];

/** Существо бестиария → актёр «npc» dnd5e: характеристики, КД, хиты, скорость, чувства, спасброски, навыки,
 *  опасность; особенности и действия — вложенными «feat» с типом активации (атаки пока только текстом). */
export function bestiaryActor(it, ref, opts) {
  const c = ctx(opts);
  const scores = {};
  const abilities = {};
  for (const k of ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']) {
    const key = k.toLowerCase();
    scores[key] = firstInt(it.Stats?.[k], 10);
    abilities[key] = { value: scores[key] };
  }
  for (const k of parseSaves(it.SavingThrows)) abilities[k].proficient = 1;
  const cr = parseCR(it.Challenge);
  const pb = firstInt(it.Proficiency) ?? pbFromCR(cr);
  const skills = Object.fromEntries(Object.entries(parseSkills(it.Skills, scores, pb))
    .map(([k, v]) => [k, { value: v }]));
  const meta = parseMeta(it.Meta);
  const hpMax = firstInt(it.HitPoints);
  const formula = (/\(([^)]*\d+d\d+[^)]*)\)/i.exec(String(it.HitPoints ?? '')) || [])[1] || '';
  const ac = firstInt(it.ArmorClass);
  const senses = parseSenses(it.Senses);
  const trait = (v) => ({ value: [], custom: stripLinks(noDash(v)) });

  const system = {
    abilities,
    attributes: {
      ac: ac == null ? { calc: 'default' } : { calc: 'flat', flat: ac },
      hp: hpMax == null ? { formula } : { value: hpMax, max: hpMax, formula },
      movement: parseSpeed(it.Speed),
      senses: { ...senses.ranges, units: 'ft', special: senses.special, ranges: senses.ranges },
    },
    details: {
      cr: cr ?? 0,
      type: { value: meta.type, subtype: '', custom: meta.custom },
      alignment: meta.alignment,
      biography: { value: c.html(it.Lore) + c.link(ref.url) },
      source,
    },
    traits: {
      size: meta.size,
      languages: trait(it.Languages),
      dr: trait(it.DamageResistances), di: trait(it.DamageImmunities),
      dv: trait(it.DamageVulnerabilities), ci: trait(it.ConditionImmunities),
    },
    skills,
  };
  if (arr(it.LegendaryActions).length) system.resources = { legact: { value: 3, max: 3 } };

  const items = [];
  for (const s of ACTION_SECTIONS) {
    const intro = s.intro ? str(it[s.intro]) : '';
    arr(it[s.k]).forEach((a) => {
      if (!a || !(a.name || a.desc)) return;
      const d = feat(c, a.name, c.html(a.desc), { type: 'monster', activation: s.act });
      d.sort = items.length * 100;
      items.push(d);
    });
    if (intro && arr(it[s.k]).length) {
      const d = feat(c, s.act === 'lair' ? (c.lang === 'en' ? 'Lair Actions' : 'Действия логова') : (c.lang === 'en' ? 'Legendary Actions' : 'Легендарные действия'),
        c.html(intro), { type: 'monster' });
      d.sort = items.length * 100;
      items.push(d);
    }
  }

  const name = str(it.Name) || '—';
  return {
    name,
    type: 'npc',
    system,
    items,
    prototypeToken: { name, width: meta.tokenSize, height: meta.tokenSize, disposition: -1, actorLink: false },
    flags: flags(c, ref, { category: arr(it.Category) }),
  };
}

/* ---------- Персонаж из конструктора → актёр character (этап 2) ---------- */

const STAT_KEYS = { Str: 'str', Dex: 'dex', Con: 'con', Int: 'int', Wis: 'wis', Cha: 'cha' };
const slug = (v, def) => (/^[a-z0-9_-]+$/i.test(String(v ?? '')) ? String(v).toLowerCase() : def);

/**
 * Снимок персонажа конструктора (site/builder.js → foundryCharacter()) → актёр «character» dnd5e.
 * ch: { id, name, desc, level, base: { id, name, die }, stats: { Str… }, hp, sp, light, speed, dc, dcStat, atk, pb,
 *   race: { name, traits: [{ name, desc }] }, baseTalents: [{ name, desc, level, picked }], archs: [{ Name, Talents }],
 *   feats: [{ data, via }], gear: [{ data, slot }], gifts: [{ data }], egos: [{ name, meta, text }], texts: [{ name, desc }],
 *   choices: [{ label, value }], warnings: [], preset } — preset кладётся во флаги: по нему актёр возвращается в конструктор.
 */
export function characterActor(ch, opts) {
  const c = ctx(opts);
  const en = c.lang === 'en';
  const L = Math.max(1, Math.min(20, Number(ch.level) || 1));
  const abilities = Object.fromEntries(Object.entries(STAT_KEYS).map(([k, v]) => [v, { value: Number(ch.stats?.[k]) || 10 }]));
  arr(ch.prof?.saves).forEach((k) => { if (abilities[k]) abilities[k].proficient = 1; });
  const skills = Object.fromEntries(Object.entries(ch.prof?.skills || {})
    .filter(([k, v]) => SKILL_ABILITY[k] && [1, 2].includes(Number(v))).map(([k, v]) => [k, { value: Number(v) }]));
  const items = [];
  const push = (d) => { d.sort = items.length * 100; items.push(d); return d; };
  const lvl = (n) => (n ? `, ${en ? 'level' : 'ур.'} ${n}` : '');

  // класс: уровень (от него dnd5e считает бонус мастерства) и кость хитов; хиты — готовые из конструктора
  const die = `d${Number(ch.base?.die) || 10}`;
  push({ name: str(ch.base?.name) || 'Класс', type: 'class',
    system: { identifier: slug(ch.base?.id, 'pm-class'), levels: L, hitDice: die, hd: { denomination: die, spent: 0 },
      description: { value: '' }, source } });
  if (ch.race) arr(ch.race.traits).forEach((t) => push(feat(c, t.name, c.html(t.desc), { type: 'race', requirements: str(ch.race.name) })));
  arr(ch.baseTalents).forEach((t) => {
    const picked = arr(t.picked).length ? c.html(`*${en ? 'Chosen' : 'Выбрано'}: ${arr(t.picked).join(', ')}*`) : '';
    push(feat(c, t.name, picked + c.html(t.desc), { type: 'class', requirements: `${str(ch.base?.name)}${lvl(t.level)}` }));
  });
  arr(ch.archs).forEach((a) => arr(a.Talents).forEach((t) =>
    push(feat(c, t.name, c.html(t.desc), { type: 'class', requirements: `${str(a.Name)}${lvl(t.level)}` }))));
  arr(ch.feats).forEach((f) => {
    const d = featItem(f.data, { cat: 'feats', key: f.data?.Name }, opts);
    delete d.flags;
    push(d);
  });
  arr(ch.gear).forEach((g) => {
    const d = equipmentItem(g.data, { cat: 'equipment', key: g.data?.Name }, opts);
    delete d.flags;
    d.system.equipped = true;
    push(d);
  });
  // дары и Э.Г.О. помечены: их находит окно «Свет и Э.Г.О.» модуля (слияние даров, список Э.Г.О.)
  arr(ch.gifts).forEach((g) => {
    const d = giftItem(g.data, { cat: 'gifts', key: g.data?.Name }, opts);
    d.flags = { [FLAG]: { cat: 'gifts', level: Number(g.data?.Level) || null, types: arr(g.data?.Type) } };
    push(d);
  });
  arr(ch.egos).forEach((e) => { const d = feat(c, e.name, c.html(e.text), { requirements: str(e.meta) }); d.flags = { [FLAG]: { cat: 'ego', kind: str(e.kind) } }; push(d); });
  arr(ch.texts).forEach((t) => push(feat(c, t.name, c.html(t.desc))));

  // сводка в биографию: то, чему у dnd5e нет своего поля
  const sum = [
    [ch.race?.name, `${str(ch.base?.name)}${arr(ch.archs).length ? ` / ${arr(ch.archs).map((a) => a.Name).join(', ')}` : ''}`, `${en ? 'Level' : 'Уровень'} ${L}`].filter(Boolean).join(' · '),
    [`${en ? 'DC' : 'СЛ'} ${ch.dc}${ch.dcStat ? ` (${ch.dcStat})` : ''}`, `${en ? 'Attack' : 'Атака'} ${ch.atk >= 0 ? '+' : ''}${ch.atk}`,
      ch.light ? `${en ? 'Light' : 'Свет'} ${ch.light}` : '', ch.sp ? `${en ? 'Sanity' : 'Рассудок'} ${ch.sp}` : '',
      `${en ? 'Hit die' : 'Кость хитов'} ${ch.durability ? 2 : 1}${die}`].filter(Boolean).join(' · '),
  ];
  const choices = arr(ch.choices).filter((x) => str(x.value)).map((x) => `- ${x.label}: **${x.value}**`).join('\n');
  const warns = arr(ch.warnings).map((w) => `- ${w}`).join('\n');
  const bio = [
    c.html(ch.desc),
    c.html(sum.map((x) => `**${x}**`).join('\n\n')),
    choices ? c.html(`**${en ? 'Choices' : 'Выборы'}**\n\n${choices}`) : '',
    warns ? c.html(`**${en ? 'For the GM to review' : 'На усмотрение ДМ-а'}**\n\n${warns}`) : '',
  ].join('');

  const resources = {};
  if (ch.light) resources.primary = { label: en ? 'Light' : 'Свет', value: ch.light, max: ch.light, sr: false, lr: false };
  if (ch.sp) resources.secondary = { label: en ? 'Sanity' : 'Рассудок', value: ch.sp, max: ch.sp, sr: false, lr: false };

  const name = str(ch.name) || (en ? 'Unnamed' : 'Без имени');
  return {
    name, type: 'character',
    system: {
      abilities,
      attributes: { hp: { value: ch.hp, max: ch.hp }, movement: { walk: Number(ch.speed) || 30, units: 'ft' } },
      details: { biography: { value: bio }, race: str(ch.race?.name) },
      skills,
      resources,
    },
    items,
    prototypeToken: { name, actorLink: true, disposition: 1 },
    flags: { [FLAG]: { key: `character/${ch.id || name}`, cat: 'character', exported: c.now, preset: ch.preset ?? null,
      ...(ch.light ? { light: { value: ch.light, max: ch.light } } : {}) } },
  };
}

/** Пакет с одним персонажем — в папку «Персонажи». */
export function characterPackage(ch, opts = {}) {
  const actor = characterActor(ch, opts);
  actor._folder = opts.folder || (opts.lang === 'en' ? 'Characters' : 'Персонажи');
  return { format: FORMAT, version: 1, source: opts.origin || '', exported: opts.now || new Date().toISOString(), items: [], actors: [actor], journals: [] };
}

const htmlText = (h) => String(h ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*/gi, '\n\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/\n{3,}/g, '\n\n').trim();

/**
 * Актёр Foundry («Export Data», .json) → пресет конструктора. Актёр, выгруженный отсюда, несёт полный пресет во флагах;
 * чужой актёр даёт имя, уровень, характеристики (вручную), описание, архетип и черты — по названиям.
 * null — это не актёр-персонаж.
 */
export function presetFromActor(a) {
  if (!a || typeof a !== 'object' || (a.type && a.type !== 'character')) return null;
  const saved = a.flags?.[FLAG]?.preset;
  if (saved && saved.builder) {
    // имя и описание могли поправить в Foundry — берём оттуда
    return { ...saved, characterName: a.name ?? saved.characterName, builder: { ...saved.builder, name: a.name ?? saved.builder.name } };
  }
  const items = arr(a.items);
  const cls = items.filter((i) => i.type === 'class');
  const level = cls.reduce((s, i) => s + (Number(i.system?.levels) || 0), 0) || Number(a.system?.details?.level) || 1;
  const stats = Object.fromEntries(Object.entries(STAT_KEYS).map(([k, v]) => [k, Number(a.system?.abilities?.[v]?.value) || 10]));
  const sub = items.find((i) => i.type === 'subclass');
  const prof = {
    saves: Object.values(STAT_KEYS).filter((k) => Number(a.system?.abilities?.[k]?.proficient) >= 1),
    skills: Object.fromEntries(Object.entries(a.system?.skills || {})
      .filter(([k, v]) => SKILL_ABILITY[k] && Number(v?.value) >= 1).map(([k, v]) => [k, Number(v.value) >= 2 ? 2 : 1])),
  };
  return {
    format: 'sinner-sheet.character', version: 2, fromFoundry: true,
    characterName: str(a.name), desc: htmlText(a.system?.details?.biography?.value),
    className: str(sub?.name || cls[0]?.name), race: str(typeof a.system?.details?.race === 'string' ? a.system.details.race : ''),
    level: Math.max(1, Math.min(20, level)), stats, prof,
    feats: items.filter((i) => i.type === 'feat' && i.system?.type?.value !== 'class' && i.system?.type?.value !== 'race').map((i) => i.name),
  };
}

/* ---------- Пакет ---------- */

/** Что из раздела Базы знаний уходит в Foundry. Статусы — через сеттинг (docs/foundry.md §1), их здесь нет. */
export const EXPORTERS = {
  feats: { kind: 'items', build: featItem },
  gifts: { kind: 'items', build: giftItem },
  equipment: { kind: 'items', build: equipmentItem },
  classes: { kind: 'items', build: talentItems },
  bases: { kind: 'items', build: talentItems },
  bestiary: { kind: 'actors', build: bestiaryActor },
  rules: { kind: 'journals', build: journalEntry },
  lore: { kind: 'journals', build: journalEntry },
};
export const canExport = (cat) => !!EXPORTERS[cat];

/**
 * Пакет для Foundry из записей [{ cat, it, ref: { key, url } }]. folders — подписи папок по разделам
 * ({ feats: 'Черты', … }): документы ложатся в «Mephistopheles Terminal / <раздел>[ / <архетип>]».
 */
export function buildPackage(entries, opts = {}) {
  const pkg = { format: FORMAT, version: 1, source: opts.origin || '', exported: opts.now || new Date().toISOString(),
    items: [], actors: [], journals: [] };
  for (const { cat, it, ref } of entries) {
    const ex = EXPORTERS[cat];
    if (!ex || !it) continue;
    const label = opts.folders?.[cat] || cat;
    for (const d of arr(ex.build(it, { cat, ...ref }, opts))) {
      d._folder = d._folder ? `${label}/${d._folder}` : label;
      pkg[ex.kind].push(d);
    }
  }
  return pkg;
}
export const packageSize = (pkg) => pkg.items.length + pkg.actors.length + pkg.journals.length;

/** Документ без служебных полей — для «Import Data» (правый щелчок по документу того же типа в Foundry). */
export function importDataJson(doc) {
  const { _folder, ...rest } = doc;
  return rest;
}

/**
 * Макрос-скрипт Foundry (v11+), который создаёт документы пакета в папках «Mephistopheles Terminal / …»,
 * а уже созданные раньше (тот же flags.pm5e.key) — обновляет. Запускает мастер.
 */
export function foundryMacro(pkg, lang = 'ru') {
  const en = lang === 'en';
  const T = {
    gm: en ? 'Only the GM can import.' : 'Импортировать может только мастер.',
    done: en ? 'Mephistopheles Terminal: created {n}, updated {u}.' : 'Mephistopheles Terminal: создано {n}, обновлено {u}.',
    fail: en ? 'Mephistopheles Terminal: import failed, see console (F12).' : 'Mephistopheles Terminal: ошибка импорта, подробности в консоли (F12).',
  };
  const names = [...pkg.items, ...pkg.actors, ...pkg.journals].map((d) => d.name);
  const title = names.slice(0, 5).join(', ') + (names.length > 5 ? ` … (+${names.length - 5})` : '');
  const json = JSON.stringify(pkg).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `// Mephistopheles Terminal → Foundry VTT (dnd5e): ${title.replace(/[\r\n]+/g, ' ')}
// ${en ? 'Paste into a new Script macro and run it as GM.' : 'Вставьте в новый макрос типа «Скрипт» и запустите мастером.'}
// ${en ? 'Re-running updates documents imported earlier.' : 'Повторный запуск обновит документы, импортированные раньше.'}
const P = ${json};
if (!game.user.isGM) return ui.notifications.warn(${JSON.stringify(T.gm)});
${importPackage.toString()}
try {
  const { created, updated } = await importPackage(P, { game, Folder, Item, Actor, JournalEntry }, ${JSON.stringify(ROOT_FOLDER)});
  ui.notifications.info(${JSON.stringify(T.done)}.replace("{n}", created).replace("{u}", updated));
} catch (e) {
  console.error(e);
  ui.notifications.error(${JSON.stringify(T.fail)});
}
`;
}
