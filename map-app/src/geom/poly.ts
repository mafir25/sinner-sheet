// Многоугольники: слияние и вырезание комнат (polygon-clipping), попадание точки, площадь.
import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping';
import type { Poly, Pt, Ring } from '../model/types';

const EPS = 1e-6;

const toPC = (p: Poly): Polygon => p.map((ring) => {
  const pts = ring.map((q) => [q.x, q.y] as [number, number]);
  return [...pts, pts[0]];
});

function fromRing(r: [number, number][]): Ring {
  const pts = r.map(([x, y]) => ({ x: Math.round(x * 1e6) / 1e6, y: Math.round(y * 1e6) / 1e6 }));
  if (pts.length > 1 && samePt(pts[0], pts[pts.length - 1])) pts.pop();
  return simplifyRing(pts);
}
const fromPC = (mp: MultiPolygon): Poly[] =>
  mp.map((poly) => poly.map(fromRing).filter((r) => r.length >= 3)).filter((p) => p.length > 0);

export const samePt = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;

/** Убирает повторы и точки на прямой (лишние вершины после слияний). */
export function simplifyRing(r: Ring): Ring {
  let pts = r.filter((p, i) => !samePt(p, r[(i + 1) % r.length]));
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cross) < EPS) { pts = pts.filter((_, j) => j !== i); changed = true; break; }
    }
  }
  return pts;
}

export function union(...polys: Poly[]): Poly[] {
  if (!polys.length) return [];
  const [first, ...rest] = polys.map(toPC);
  return fromPC(polygonClipping.union(first, ...rest));
}

export function difference(p: Poly, ...cut: Poly[]): Poly[] {
  return fromPC(polygonClipping.difference(toPC(p), ...cut.map(toPC)));
}

export function intersects(a: Poly, b: Poly): boolean {
  if (!bboxOverlap(polyBBox(a), polyBBox(b), 1e-4)) return false;
  return polygonClipping.intersection(toPC(a), toPC(b)).length > 0;
}

/** Касаются ли (общее ребро или пересечение) — для слияния соседних комнат одного стиля. */
export function touches(a: Poly, b: Poly): boolean {
  if (!bboxOverlap(polyBBox(a), polyBBox(b), 1e-4)) return false;
  if (intersects(a, b)) return true;
  // общее ребро: объединение даёт один многоугольник
  return union(a, b).length === 1;
}

export type BBox = { x0: number; y0: number; x1: number; y1: number };
export function ptsBBox(pts: Pt[]): BBox {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x0, y0, x1, y1 };
}
export const polyBBox = (p: Poly) => ptsBBox(p[0]);
export const bboxOverlap = (a: BBox, b: BBox, pad = 0) =>
  a.x0 <= b.x1 + pad && b.x0 <= a.x1 + pad && a.y0 <= b.y1 + pad && b.y0 <= a.y1 + pad;

export function ringArea(r: Ring): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a.x * b.y - b.x * a.y; }
  return s / 2;
}

function inRing(p: Pt, r: Ring): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
export const pointInPoly = (p: Pt, poly: Poly) => inRing(p, poly[0]) && !poly.slice(1).some((h) => inRing(p, h));

export const rectPoly = (a: Pt, b: Pt): Poly => {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  return [[{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]];
};

/** Расстояние от точки до отрезка и параметр проекции t ∈ [0, 1]. */
export function segDist(p: Pt, a: Pt, b: Pt): { d: number; t: number; q: Pt } {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L2 = dx * dx + dy * dy;
  let t = L2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  const q = { x: a.x + t * dx, y: a.y + t * dy };
  return { d: Math.hypot(p.x - q.x, p.y - q.y), t, q };
}
