/* Атаки как броски dnd5e (docs/foundry.md, этап 3): разбор стат-блока существа и базовое оружие SRD → «действия»
   (activities) dnd5e 4–5. Без DOM; тесты — tests/unit/pm-attacks.test.mjs. Используется site/foundry-export.js.
   Только то, что написано в тексте: бонус к попаданию, досягаемость/дистанция, урон и его тип, спасбросок и СЛ,
   статусы «накладывает N `Статуса`» — как эффект, который игрок или мастер применяет к цели из карточки броска. */
import { statusByName, statusById, statusChanges, statusName } from './pm-statuses.js';

/* ---------- урон ---------- */
const DAMAGE_TYPES = [
  [/дробящ|bludgeon/i, 'bludgeoning'], [/колющ|pierc/i, 'piercing'], [/рубящ|slash/i, 'slashing'],
  [/огн|огон|fire/i, 'fire'], [/холод|cold/i, 'cold'], [/электр|молни|lightning/i, 'lightning'], [/звук|thunder/i, 'thunder'],
  [/кислот|acid/i, 'acid'], [/яд(?!ер)|poison/i, 'poison'], [/некрот|necrotic/i, 'necrotic'], [/излуч|radiant/i, 'radiant'],
  [/психи|psychic/i, 'psychic'], [/силов|force/i, 'force'],
];
const typeOf = (word) => (DAMAGE_TYPES.find(([re]) => re.test(word || '')) || [])[1] || '';

/** «23 (1d12+3) дробящего урона», «26 (4d12) урона огнём», «17 (2d12+4) piercing damage» → [{ number, denomination, bonus, types }]. */
export function parseDamage(text) {
  const out = [];
  const re = /\d+\s*\((\d+)d(\d+)\s*([+−-]\s*\d+)?\)\s*((?:[а-яёa-z]+\s+){0,2}?)(?:урона|damage)(?:\s+([а-яё]+))?/gi;
  for (const m of String(text ?? '').matchAll(re)) {
    const bonus = (m[3] || '').replace(/[\s]/g, '').replace('−', '-').replace(/^\+/, '');
    const type = typeOf(m[4]) || typeOf(m[5]);
    out.push({ number: Number(m[1]), denomination: Number(m[2]), bonus, types: type ? [type] : [] });
  }
  return out;
}

/** «накладывает 5 `Потопления::Потопление` и 4 `Разрыва::Разрыв`» → [{ id, n }] (только статусы модуля, с числом). */
export function parseStatuses(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(/(\d+)\s+`[^`\n]*?(?:::([^`\n]+))?`/g)) {
    const inner = /`([^`\n]*)`/.exec(m[0])[1];
    const target = m[2] || inner;
    const st = statusByName(target.trim()) || statusByName(inner.trim());
    if (st && !out.some((x) => x.id === st.id)) out.push({ id: st.id, n: Number(m[1]) });
  }
  return out;
}

const ABIL = { 'силы': 'str', 'ловкости': 'dex', 'телосложения': 'con', 'интеллекта': 'int', 'мудрости': 'wis', 'харизмы': 'cha',
  strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha' };

/**
 * Текст действия существа → атака или спасбросок; null — ни то, ни другое (остаётся просто описанием).
 * { kind: 'attack', melee, bonus, reach, range: { value, long }, damage: [...], statuses }
 * { kind: 'save', ability, dc, damage, half, statuses }
 */
export function parseAction(text) {
  const s = String(text ?? '');
  const atk = /(рукопашная|дальнобойная|melee|ranged)[^:]*?(?:атака|attack)[^:]*:\s*([+−-]\s*\d+)\s*(?:к попаданию|to hit)/i.exec(s);
  if (atk) {
    const melee = /рукопаш|melee/i.test(atk[1]);
    const reach = Number((/(?:досягаемость|reach)\s*(\d+)/i.exec(s) || [])[1]) || null;
    const rm = /(?:дистанция|range)\s*(\d+)(?:\s*\/\s*(\d+))?/i.exec(s);
    const hit = s.slice(atk.index + atk[0].length);
    return {
      kind: 'attack', melee, bonus: Number(atk[2].replace(/[\s−]/g, (c) => (c === '−' ? '-' : ''))),
      reach, range: rm ? { value: Number(rm[1]), long: rm[2] ? Number(rm[2]) : null } : null,
      damage: parseDamage(hit), statuses: parseStatuses(hit),
    };
  }
  const sv = /(?:спасбросок|saving throw)\s+([а-яё]+)\s+(?:со\s+)?СЛ\s*(\d+)|DC\s*(\d+)\s+([A-Za-z]+)\s+saving throw/i.exec(s);
  if (sv) {
    const ability = ABIL[String(sv[1] || sv[4]).toLowerCase()];
    if (!ability) return null;
    return { kind: 'save', ability, dc: Number(sv[2] || sv[3]), damage: parseDamage(s),
      half: /половин|half as much/i.test(s), statuses: parseStatuses(s) };
  }
  return null;
}

/* ---------- базовое оружие (SRD 5e) ---------- */
/** Стандартное оружие 5e: только то, что совпадает с SRD по названию. Огнестрел и экзотика канона — без урона. */
export const SRD_WEAPONS = {
  'кинжал': { base: 'dagger', type: 'simpleM', dmg: [1, 4, 'piercing'], props: ['fin', 'lgt', 'thr'], range: [20, 60] },
  'дубинка': { base: 'club', type: 'simpleM', dmg: [1, 4, 'bludgeoning'], props: ['lgt'] },
  'боевой посох': { base: 'quarterstaff', type: 'simpleM', dmg: [1, 6, 'bludgeoning'], ver: [1, 8], props: ['ver'] },
  'булава': { base: 'mace', type: 'simpleM', dmg: [1, 6, 'bludgeoning'], props: [] },
  'серп': { base: 'sickle', type: 'simpleM', dmg: [1, 4, 'slashing'], props: ['lgt'] },
  'копьё': { base: 'spear', type: 'simpleM', dmg: [1, 6, 'piercing'], ver: [1, 8], props: ['thr', 'ver'], range: [20, 60] },
  'метательное копьё': { base: 'javelin', type: 'simpleM', dmg: [1, 6, 'piercing'], props: ['thr'], range: [30, 120] },
  'ручной топор': { base: 'handaxe', type: 'simpleM', dmg: [1, 6, 'slashing'], props: ['lgt', 'thr'], range: [20, 60] },
  'лёгкий арбалет': { base: 'lightcrossbow', type: 'simpleR', dmg: [1, 8, 'piercing'], props: ['amm', 'lod', 'two'], range: [80, 320] },
  'длинный меч': { base: 'longsword', type: 'martialM', dmg: [1, 8, 'slashing'], ver: [1, 10], props: ['ver'] },
  'рапира': { base: 'rapier', type: 'martialM', dmg: [1, 8, 'piercing'], props: ['fin'] },
  'глефа': { base: 'glaive', type: 'martialM', dmg: [1, 10, 'slashing'], props: ['hvy', 'rch', 'two'] },
  'боевой молот': { base: 'warhammer', type: 'martialM', dmg: [1, 8, 'bludgeoning'], ver: [1, 10], props: ['ver'] },
  'двуручный меч': { base: 'greatsword', type: 'martialM', dmg: [2, 6, 'slashing'], props: ['hvy', 'two'] },
  'алебарда': { base: 'halberd', type: 'martialM', dmg: [1, 10, 'slashing'], props: ['hvy', 'rch', 'two'] },
  'секира': { base: 'greataxe', type: 'martialM', dmg: [1, 12, 'slashing'], props: ['hvy', 'two'] },
  'кувалда': { base: 'maul', type: 'martialM', dmg: [2, 6, 'bludgeoning'], props: ['hvy', 'two'] },
  'длинное копьё': { base: 'pike', type: 'martialM', dmg: [1, 10, 'piercing'], props: ['hvy', 'rch', 'two'] },
};
const EN_WEAPONS = { dagger: 'кинжал', club: 'дубинка', quarterstaff: 'боевой посох', mace: 'булава', sickle: 'серп', spear: 'копьё',
  javelin: 'метательное копьё', handaxe: 'ручной топор', 'light crossbow': 'лёгкий арбалет', longsword: 'длинный меч', rapier: 'рапира',
  glaive: 'глефа', warhammer: 'боевой молот', greatsword: 'двуручный меч', halberd: 'алебарда', greataxe: 'секира', maul: 'кувалда', pike: 'длинное копьё' };

/** «*Оружие (длинный меч)*» / «*Weapon (longsword)*» в описании → характеристики SRD или null. */
export function weaponBase(desc) {
  const m = /^\s*\*?\s*(?:оружие|weapon)\s*\(([^)]+)\)/i.exec(String(desc ?? ''));
  if (!m) return null;
  const name = m[1].trim().toLowerCase();
  return SRD_WEAPONS[name] || SRD_WEAPONS[name.replace(/копье/g, 'копьё').replace(/легкий/g, 'лёгкий')] || SRD_WEAPONS[EN_WEAPONS[name]] || null;
}

/* ---------- данные dnd5e ---------- */
/** Детерминированный id документа Foundry (16 символов [A-Za-z0-9]) — повторный экспорт даёт те же id. */
export function docId(seed) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  const str = String(seed);
  for (let i = 0; i < str.length; i++) { h1 = Math.imul(h1 ^ str.charCodeAt(i), 16777619); h2 = Math.imul(h2 + str.charCodeAt(i), 2246822519); }
  let out = '';
  for (let i = 0; i < 16; i++) { const x = i % 2 ? (h1 = Math.imul(h1 ^ (h1 >>> 13), 1597334677)) : (h2 = Math.imul(h2 ^ (h2 >>> 15), 2654435761)); out += abc[(x >>> 0) % abc.length]; }
  return out;
}
const part = (d) => ({ number: d.number, denomination: d.denomination, bonus: d.bonus || '', types: d.types || [] });

/** Active Effects предмета для статусов «при попадании» (не переносятся на владельца; применяются к цели из карточки броска). */
export function statusEffectsData(statuses, seed, lang = 'ru') {
  return statuses.map(({ id, n }) => {
    const st = statusById(id);
    return {
      _id: docId(`${seed}#${id}`),
      name: `${statusName(st, lang)} ${n}`,
      img: st.icon.startsWith('icons/svg/') ? st.icon : `modules/pm5e/${encodeURI(st.icon)}`,
      transfer: false,
      statuses: [`pm5e-${st.id}`],
      changes: statusChanges(st, n),
      flags: { pm5e: { status: { id: st.id, stacks: n } } },
    };
  });
}

/**
 * Действие (activity) dnd5e 4–5 для разобранного текста. activation: 'action' | 'bonus' | 'reaction' | 'legendary' | ''.
 * Атака: бонус к попаданию — как в тексте (flat), урон — base у оружия, остальное — части действия.
 */
export function activityFor(parsed, seed, activation, effectIds = []) {
  const _id = docId(`${seed}#activity`);
  const common = { _id, activation: { type: activation || 'action', value: 1 }, effects: effectIds.map((id) => ({ _id: id })) };
  if (parsed.kind === 'attack') {
    return { ...common, type: 'attack',
      attack: { bonus: String(parsed.bonus), flat: true, type: { value: parsed.melee ? 'melee' : 'ranged', classification: 'weapon' } },
      damage: { includeBase: true, parts: parsed.damage.slice(1).map(part) } };
  }
  return { ...common, type: 'save',
    save: { ability: [parsed.ability], dc: { calculation: '', formula: String(parsed.dc) } },
    damage: { onSave: parsed.half ? 'half' : 'none', parts: parsed.damage.map(part) } };
}

/** Система предмета «weapon» для атаки существа (природное оружие). */
export function npcWeaponSystem(parsed) {
  const base = parsed.damage[0];
  return {
    type: { value: 'natural' }, equipped: true, proficient: 1,
    damage: base ? { base: part(base) } : {},
    range: { value: parsed.range?.value ?? null, long: parsed.range?.long ?? null, reach: parsed.reach ?? null, units: 'ft' },
  };
}

/** Система оружия персонажа по SRD (урон, свойства, дистанция) + действие «атака» по характеристике и мастерству. */
export function srdWeaponSystem(w) {
  const [n, d, t] = w.dmg;
  const sys = {
    type: { value: w.type, baseItem: w.base },
    damage: { base: { number: n, denomination: d, bonus: '', types: [t] }, ...(w.ver ? { versatile: { number: w.ver[0], denomination: w.ver[1], bonus: '', types: [t] } } : {}) },
    properties: [...w.props],
    range: { value: w.range?.[0] ?? null, long: w.range?.[1] ?? null, units: 'ft' },
  };
  return sys;
}
export function weaponActivity(seed, ranged = false) {
  const _id = docId(`${seed}#activity`);
  return { _id, type: 'attack', activation: { type: 'action', value: 1 },
    attack: { type: { value: ranged ? 'ranged' : 'melee', classification: 'weapon' } }, damage: { includeBase: true, parts: [] } };
}
