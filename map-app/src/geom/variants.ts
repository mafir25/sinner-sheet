// Варианты бесшовных текстур (пол, стена): в последовательность основы с шансом встают её варианты —
// файлы той же группы (`<основа>-<вариант>.png`, края совпадают с основой). Выбор по клетке детерминированный:
// тот же шанс и зерно — та же раскладка (в редакторе ничего не «мигает», экспорт совпадает с экраном).
import type { Pt } from '../model/types';

/** Шанс варианта по умолчанию (у пола и стены без своей настройки). */
export const DEFAULT_VARY = 0.12;

/** Хэш четырёх целых в [0, 1). */
export function tileHash(seed: number, i: number, j: number, salt = 0): number {
  let h = (Math.imul(seed | 0, 0x27d4eb2d) ^ Math.imul(i | 0, 0x165667b1) ^ Math.imul(j | 0, 0x9e3779b1) ^ Math.imul(salt | 0, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h / 4294967296;
}

/**
 * Что лежит в клетке (i, j): вариант из others (с шансом chance) или null — основа.
 * Какой именно вариант — отдельным хэшем, чтобы шанс и выбор не зависели друг от друга.
 */
export function pickTile(others: readonly string[], chance: number, seed: number, i: number, j: number, salt = 0): string | null {
  if (!others.length || chance <= 0) return null;
  if (tileHash(seed, i, j, salt) >= chance) return null;
  return others[Math.floor(tileHash(seed ^ 0x5bd1e995, i, j, salt) * others.length) % others.length];
}

export const effectiveChance = (v: number | undefined) => Math.max(0, Math.min(1, v ?? DEFAULT_VARY));

/**
 * Плитки стены: направление вдоль стены приводится к одному виду (слева направо, сверху вниз), чтобы раскладка
 * не зависела от того, в какую сторону рисовали стену. Возвращает единичный вектор и «соль» линии — её смещение
 * от начала координат (у соседних граней одной прямой — одинаковое).
 */
export function wallLine(a: Pt, b: Pt): { u: Pt; salt: number } {
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  let u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
  if (u.x < -1e-9 || (Math.abs(u.x) <= 1e-9 && u.y < 0)) u = { x: -u.x, y: -u.y };
  u = { x: u.x + 0, y: u.y + 0 }; // без «-0»
  const off = a.x * -u.y + a.y * u.x; // расстояние прямой от начала координат (со знаком)
  const ang = Math.round(Math.atan2(u.y, u.x) * 1000);
  return { u, salt: (Math.round(off * 100) * 31 + ang) | 0 };
}
