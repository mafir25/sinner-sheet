// Пути: сглаживание (Catmull-Rom), шаг вдоль пути, расстояние до ломаной.
import type { Pt } from '../model/types';
import { segDist } from './poly';

/** Точки для отрисовки: сглаженная кривая через опорные точки или сама ломаная. */
export function curvePoints(pts: Pt[], smooth: boolean, closed: boolean, step = 0.15): Pt[] {
  if (pts.length < 2) return pts.slice();
  if (!smooth || pts.length < 3) return closed ? [...pts, pts[0]] : pts.slice();
  const n = pts.length;
  const at = (i: number) => (closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const out: Pt[] = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const k = Math.max(2, Math.ceil(len / step));
    for (let j = 0; j < k; j++) {
      const t = j / k, t2 = t * t, t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push(closed ? out[0] : pts[n - 1]);
  return out;
}

/** Точки через каждые spacing по длине ломаной (центры отрезков шага) и направление в них (радианы). */
export function walkAlong(pts: Pt[], spacing: number): { p: Pt; angle: number }[] {
  const out: { p: Pt; angle: number }[] = [];
  if (pts.length < 2 || spacing <= 0) return out;
  let next = spacing / 2, acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 1e-9) continue;
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    while (next <= acc + L && out.length < 20000) {
      const t = (next - acc) / L;
      out.push({ p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, angle });
      next += spacing;
    }
    acc += L;
  }
  return out;
}

export function polylineDist(p: Pt, pts: Pt[]): number {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, segDist(p, pts[i], pts[i + 1]).d);
  return d;
}
