/* Владения спасбросками и навыками для Конструктора персонажа (docs/foundry.md, этап 2).
   Без DOM, покрыто тестами tests/unit/proficiencies.test.mjs. Что положено классу — из текста его умения «Владения»:
   «**Спасброски:** Мудрость, Ловкость или Телосложение, а также Интеллект, Сила или Харизма» → по одному из каждой группы;
   «**Навыки:** выберите три из следующих: …» → количество и список. Ключи — как в dnd5e (str…, acr…). */

export const ABILITIES = [
  { key: 'str', stat: 'Str', ru: 'Сила', en: 'Strength' },
  { key: 'dex', stat: 'Dex', ru: 'Ловкость', en: 'Dexterity' },
  { key: 'con', stat: 'Con', ru: 'Телосложение', en: 'Constitution' },
  { key: 'int', stat: 'Int', ru: 'Интеллект', en: 'Intelligence' },
  { key: 'wis', stat: 'Wis', ru: 'Мудрость', en: 'Wisdom' },
  { key: 'cha', stat: 'Cha', ru: 'Харизма', en: 'Charisma' },
];
export const SKILL_LIST = [
  { key: 'acr', stat: 'Dex', ru: 'Акробатика', en: 'Acrobatics' },
  { key: 'ani', stat: 'Wis', ru: 'Уход за животными', en: 'Animal Handling' },
  { key: 'arc', stat: 'Int', ru: 'Магия', en: 'Arcana' },
  { key: 'ath', stat: 'Str', ru: 'Атлетика', en: 'Athletics' },
  { key: 'dec', stat: 'Cha', ru: 'Обман', en: 'Deception' },
  { key: 'his', stat: 'Int', ru: 'История', en: 'History' },
  { key: 'ins', stat: 'Wis', ru: 'Проницательность', en: 'Insight' },
  { key: 'itm', stat: 'Cha', ru: 'Запугивание', en: 'Intimidation' },
  { key: 'inv', stat: 'Int', ru: 'Анализ', en: 'Investigation', alt: ['Расследование'] },
  { key: 'med', stat: 'Wis', ru: 'Медицина', en: 'Medicine' },
  { key: 'nat', stat: 'Int', ru: 'Природа', en: 'Nature' },
  { key: 'prc', stat: 'Wis', ru: 'Внимательность', en: 'Perception', alt: ['Восприятие'] },
  { key: 'prf', stat: 'Cha', ru: 'Выступление', en: 'Performance' },
  { key: 'per', stat: 'Cha', ru: 'Убеждение', en: 'Persuasion' },
  { key: 'rel', stat: 'Int', ru: 'Религия', en: 'Religion' },
  { key: 'slt', stat: 'Dex', ru: 'Ловкость рук', en: 'Sleight of Hand' },
  { key: 'ste', stat: 'Dex', ru: 'Скрытность', en: 'Stealth' },
  { key: 'sur', stat: 'Wis', ru: 'Выживание', en: 'Survival' },
];
const COUNT = { 'один': 1, 'одну': 1, 'два': 2, 'две': 2, 'три': 3, 'четыре': 4, 'пять': 5,
  one: 1, two: 2, three: 3, four: 4, five: 5 };

const norm = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').trim();
/** Названия (рус/англ) из куска текста → ключи по порядку упоминания. */
function findAll(list, text) {
  const t = norm(text);
  const hits = [];
  for (const x of list) {
    for (const name of [x.ru, x.en, ...(x.alt || [])]) {
      const i = t.indexOf(norm(name));
      if (i >= 0) { hits.push([i, x.key]); break; }
    }
  }
  return hits.sort((a, b) => a[0] - b[0]).map((h) => h[1]);
}
/** Строка «**Метка:** значение» из текста умения. */
function line(text, re) {
  const m = new RegExp(`\\*{0,2}(?:${re})\\*{0,2}\\s*:?\\s*\\*{0,2}\\s*([^\\n]*)`, 'i').exec(String(text ?? ''));
  return m ? m[1] : '';
}

/** «Мудрость, Ловкость или Телосложение, а также Интеллект…» → группы: «и / а также / and» начинает новую группу,
 *  запятая и «или / or» продолжают её; группа без «или» — это несколько обязательных спасбросков. */
function saveGroupsOf(text) {
  const t = norm(text);
  const marks = [];
  for (const a of ABILITIES) {
    for (const name of [a.ru, a.en]) {
      const i = t.indexOf(norm(name));
      if (i >= 0) { marks.push({ i, end: i + name.length, key: a.key }); break; }
    }
  }
  marks.sort((a, b) => a.i - b.i);
  const groups = [];
  let cur = null;
  marks.forEach((m, n) => {
    const sep = n ? t.slice(marks[n - 1].end, m.i) : '';
    if (!cur || /(^|[\s,])(и|а также|and)(\s|$)/.test(sep) && !/(^|[\s,])(или|or)(\s|$)/.test(sep)) groups.push(cur = { keys: [], or: false });
    if (/(^|[\s,])(или|or)(\s|$)/.test(sep)) cur.or = true;
    cur.keys.push(m.key);
  });
  return groups.flatMap((g) => (g.or ? [g.keys] : g.keys.map((k) => [k])));
}

/**
 * Текст умения «Владения» → { saveGroups: [['wis','dex','con'], ['int','str','cha']], skillCount: 3, skillOptions: [...] }.
 * Спасброски без «или» — каждый своя группа из одного (обязательный). Не нашли — пустые списки, количество 0.
 */
export function parseClassProfs(text) {
  const saves = line(text, 'Спасброски|Saving Throws');
  const saveGroups = saves ? saveGroupsOf(saves) : [];
  const skills = line(text, 'Навыки|Skills');
  const cm = /(?:выберите|choose)\s+(\S+)/i.exec(skills);
  const skillCount = cm ? (COUNT[norm(cm[1])] || parseInt(cm[1], 10) || 0) : 0;
  return { saveGroups, skillCount, skillOptions: findAll(SKILL_LIST, skills) };
}

/** Умение «Владения» среди умений основы класса. */
export function profTalent(talents) {
  return (talents || []).find((t) => /^(владения|proficiencies)$/i.test(String(t?.name ?? '').trim())) || null;
}

/**
 * Проверка выбора: { saves: ['wis','str'], skills: { prc: 1, ste: 2 } } против положенного классу.
 * Возвращает список замечаний (пусто — всё по правилам). Навыки сверх класса не ошибка — их дают черты и предыстория.
 */
export function checkProfs(prof, rules) {
  const out = [];
  const saves = prof?.saves || [];
  if (rules.saveGroups.length) {
    rules.saveGroups.forEach((g, i) => {
      const n = saves.filter((k) => g.includes(k)).length;
      if (n !== 1) out.push({ kind: 'saves', group: i, n });
    });
    const extra = saves.filter((k) => !rules.saveGroups.some((g) => g.includes(k)));
    if (extra.length) out.push({ kind: 'saves-extra', keys: extra });
  }
  if (rules.skillCount) {
    const fromClass = Object.keys(prof?.skills || {}).filter((k) => rules.skillOptions.includes(k)).length;
    if (fromClass < rules.skillCount) out.push({ kind: 'skills', n: fromClass, need: rules.skillCount });
  }
  return out;
}

/** Бонус навыка: модификатор + бонус мастерства × (1 — владение, 2 — компетентность). */
export const skillBonus = (mod, pb, level) => mod + pb * (Number(level) || 0);
