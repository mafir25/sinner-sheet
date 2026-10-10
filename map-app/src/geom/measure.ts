// Измерения: длина по прямой и число шагов по сетке (клетка = 5 футов).
import type { GridType, Pt } from '../model/types';
import { hexAt } from './grid';

export const FEET_PER_CELL = 5;

export const segLen = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
export const polyLen = (pts: Pt[]) => pts.reduce((s, p, i) => (i ? s + segLen(pts[i - 1], p) : 0), 0);

/**
 * Шагов по сетке между точками: на квадратной — диагональ считается за одну клетку (правило D&D 5e),
 * на гексах — число гексов; без сетки — null.
 */
export function gridSteps(type: GridType, a: Pt, b: Pt): number | null {
  if (type === 'square') return Math.max(Math.abs(Math.round(b.x - a.x)), Math.abs(Math.round(b.y - a.y)));
  if (type === 'none') return null;
  const p = hexAt(type, a), q = hexAt(type, b);
  const dq = p.q - q.q, dr = p.r - q.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}
export function pathSteps(type: GridType, pts: Pt[]): number | null {
  if (type === 'none') return null;
  return pts.reduce((s, p, i) => (i ? s + (gridSteps(type, pts[i - 1], p) ?? 0) : 0), 0);
}

const num = (v: number) => String(Math.round(v * 10) / 10);
/** «4.5 кл · 22.5 фт»; cell/ft — подписи единиц на нужном языке. */
export const fmtLen = (cells: number, cell: string, ft: string) => `${num(cells)} ${cell} · ${num(cells * FEET_PER_CELL)} ${ft}`;

/** Площадь многоугольника с дырами (в клетках²). */
export function polyArea(poly: Pt[][]): number {
  const ring = (r: Pt[]) => {
    let s = 0;
    for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a.x * b.y - b.x * a.y; }
    return Math.abs(s / 2);
  };
  return poly.reduce((s, r, i) => (i ? s - ring(r) : s + ring(r)), 0);
}
/** Описанный прямоугольник внешнего контура: ширина и высота в клетках. */
export function polySize(poly: Pt[][]): { w: number; h: number } {
  const xs = poly[0].map((p) => p.x), ys = poly[0].map((p) => p.y);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
export const fmtNum = num;
