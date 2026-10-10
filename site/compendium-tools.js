/* Справочные помощники Базы знаний (без DOM, покрыты тестами tests/unit/compendium-tools.test.mjs):
   - Слияние Э.Г.О. — тир результата по правилу «Слияние Э.Г.О.» из mechanics/rules.json;
   - Бестиарий — опасность (CR) и опыт из поля Challenge, бюджет встречи по DMG 2024. */

/** Тир гифта после слияния: 2 гифта — средний тир с округлением вниз, 3 — на тир выше среднего с округлением вверх.
 *  Возвращает null, если гифтов не 2 и не 3 или у кого-то нет тира. */
export function fusionTier(levels, maxTier = 5) {
  const ls = (levels || []).map(Number);
  if (ls.length < 2 || ls.length > 3 || ls.some((l) => !Number.isFinite(l) || l < 1)) return null;
  const avg = ls.reduce((s, l) => s + l, 0) / ls.length;
  const tier = ls.length === 2 ? Math.floor(avg) : Math.ceil(avg) + 1;
  return Math.max(1, Math.min(maxTier, tier));
}

/** Опыт за существо по показателю опасности (DMG). */
export const CR_XP = {
  0: 10, 0.125: 25, 0.25: 50, 0.5: 100, 1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800, 6: 2300, 7: 2900, 8: 3900,
  9: 5000, 10: 5900, 11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000, 16: 15000, 17: 18000, 18: 20000,
  19: 22000, 20: 25000, 21: 33000, 22: 41000, 23: 50000, 24: 62000, 25: 75000, 26: 90000, 27: 105000,
  28: 120000, 29: 135000, 30: 155000,
};

/** «5 (1 800 опыта)», «1/4 (50 XP)», «7» → { cr, label, xp }. Неизвестная опасность («?») → cr: null, xp: 0.
 *  Опыт берётся из скобок, если он там указан, иначе — из таблицы CR_XP. */
export function parseChallenge(v) {
  const s = String(v ?? '').trim();
  const m = s.match(/^(\d+)(?:\s*\/\s*(\d+))?/);
  if (!m) return { cr: null, label: s || '?', xp: 0 };
  const cr = m[2] ? Number(m[1]) / Number(m[2]) : Number(m[1]);
  if (!Number.isFinite(cr)) return { cr: null, label: s, xp: 0 };
  const label = m[2] ? `${m[1]}/${m[2]}` : m[1];
  const paren = s.match(/\(([\d\s  .,]+)/);
  const fromParen = paren ? Number(paren[1].replace(/[\s  .,]/g, '')) : NaN;
  const xp = Number.isFinite(fromParen) && fromParen > 0 ? fromParen : (CR_XP[cr] ?? 0);
  return { cr, label, xp };
}

/** Бюджет опыта на одного персонажа (DMG 2024): [низкая, умеренная, высокая] для уровней 1–20. */
export const XP_BUDGET = [
  [50, 75, 100], [100, 150, 200], [150, 225, 400], [250, 375, 500], [500, 750, 1100],
  [600, 1000, 1400], [750, 1300, 1700], [1000, 1700, 2100], [1300, 2000, 2600], [1600, 2300, 3100],
  [1900, 2900, 4100], [2200, 3700, 4700], [2600, 4200, 5400], [2900, 4900, 6200], [3300, 5400, 7800],
  [3800, 6100, 9800], [4500, 7200, 11700], [5000, 8700, 14200], [5500, 10700, 17200], [6400, 13200, 22000],
];

/** Бюджет встречи для группы: уровни персонажей (число — вся группа одного уровня, тогда size — её размер). */
export function encounterBudget(levels, size = 1) {
  const list = Array.isArray(levels) ? levels : Array.from({ length: Math.max(0, Math.round(size)) }, () => levels);
  const out = { low: 0, moderate: 0, high: 0 };
  list.forEach((l) => {
    const row = XP_BUDGET[Math.max(1, Math.min(20, Math.round(Number(l) || 1))) - 1];
    out.low += row[0]; out.moderate += row[1]; out.high += row[2];
  });
  return out;
}

/** Сложность встречи по сумме опыта: '' (пусто), 'low', 'moderate', 'high', 'over' (выше высокой). */
export function rateEncounter(xp, budget) {
  if (!(xp > 0)) return '';
  if (xp <= budget.low) return 'low';
  if (xp <= budget.moderate) return 'moderate';
  if (xp <= budget.high) return 'high';
  return 'over';
}
