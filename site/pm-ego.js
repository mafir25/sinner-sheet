/* Свет и Э.Г.О. персонажа в Foundry (docs/foundry.md, этап 3): что окно «Свет и Э.Г.О.» модуля pm5e находит у актёра
   и как сливает дары. Без DOM и без Foundry — на вход данные актёра (system, flags, items). Тесты — tests/unit/pm-ego.test.mjs.
   Правило слияния — общее с Базой знаний сайта: site/compendium-tools.js (fusionTier). */
import { fusionTier } from './compendium-tools.js';

const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5 };
const LIGHT_LABEL = /^(свет|light)$/i;

/** Свет актёра: flags.pm5e.light, иначе ресурс dnd5e с подписью «Свет»/«Light». → { value, max, resource } */
export function lightOf(actor) {
  const res = actor?.system?.resources || {};
  const resource = ['primary', 'secondary', 'tertiary'].find((k) => LIGHT_LABEL.test(String(res[k]?.label ?? '').trim())) || null;
  const flag = actor?.flags?.pm5e?.light;
  const src = flag || (resource ? res[resource] : null) || {};
  const max = Math.max(0, Number(src.max) || 0);
  return { value: Math.max(0, Math.min(max || Infinity, Number(src.value) || 0)), max, resource: resource || 'primary' };
}

/** Обновление актёра для нового значения Света (флаг + ресурс dnd5e, чтобы было видно и на листе). */
export function lightUpdate(actor, value, max, lang = 'ru') {
  const cur = lightOf(actor);
  const m = Math.max(0, Math.floor(Number(max ?? cur.max) || 0));
  const v = Math.max(0, Math.min(m, Math.floor(Number(value) || 0)));
  return {
    'flags.pm5e.light': { value: v, max: m },
    [`system.resources.${cur.resource}`]: { label: lang === 'en' ? 'Light' : 'Свет', value: v, max: m },
  };
}

const giftLevel = (it) => {
  const f = Number(it.flags?.pm5e?.level);
  if (f) return f;
  const m = /(?:уровень|tier)\s+([IV]+|\d)/i.exec(String(it.system?.requirements ?? ''));
  return m ? (ROMAN[m[1].toUpperCase()] || Number(m[1]) || null) : null;
};
const isGift = (it) => it.flags?.pm5e?.cat === 'gifts' || it.flags?.pm5e?.gift === true
  || /Э\.Г\.О\. гифт|E\.G\.O\. gift/i.test(String(it.system?.requirements ?? ''));
const EGO_META = /^(Атака Э\.Г\.О\.|Нестабильное Э\.Г\.О\.|Расцветающее Э\.Г\.О\.|E\.G\.O\. Attack|Volatile E\.G\.O\.|Blooming E\.G\.O\.)/i;
const isEgo = (it) => it.flags?.pm5e?.cat === 'ego' || EGO_META.test(String(it.system?.requirements ?? ''));

/** Дары Э.Г.О. актёра: [{ id, name, level, types }] по уровню. */
export function giftsOf(items) {
  return [...(items || [])].filter((it) => it.type === 'feat' && isGift(it))
    .map((it) => ({ id: it.id ?? it._id, name: it.name, level: giftLevel(it), types: it.flags?.pm5e?.types || [] }))
    .sort((a, b) => (a.level ?? 9) - (b.level ?? 9) || a.name.localeCompare(b.name));
}

/** Э.Г.О. актёра (атаки, нестабильное, расцветающее): [{ id, name, meta }]. */
export function egosOf(items) {
  return [...(items || [])].filter((it) => it.type === 'feat' && isEgo(it))
    .map((it) => ({ id: it.id ?? it._id, name: it.name, meta: String(it.system?.requirements ?? '') }));
}

/**
 * Слияние выбранных даров: тир результата (2 дара — средний вниз, 3 — средний вверх +1, не выше V) и подходящие дары
 * Базы знаний этого тира; sameTypes — только с типами ингредиентов (как «только с типами» на сайте).
 * kbGifts: записи Базы знаний раздела «Э.Г.О. гифты» ({ it: { Name, Level, Type } }). → { tier, options } или null.
 */
export function fusion(selected, kbGifts, { sameTypes = false, owned = [] } = {}) {
  const tier = fusionTier(selected.map((g) => g.level));
  if (!tier) return null;
  const types = new Set(selected.flatMap((g) => g.types || []));
  const have = new Set([...owned, ...selected.map((g) => g.name)].map((n) => String(n).toLowerCase()));
  const options = (kbGifts || []).filter((e) => Number(e.it?.Level) === tier)
    .filter((e) => !have.has(String(e.it.Name).toLowerCase()))
    .filter((e) => !sameTypes || !types.size || (e.it.Type || []).some((t) => types.has(t)));
  return { tier, options };
}
