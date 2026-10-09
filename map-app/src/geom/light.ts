// Видимость от источника света: многоугольник, который не загораживают стены и закрытые двери.
import type { Floor, Pt } from '../model/types';
import { wallChains } from './walls';

type Seg = [Pt, Pt];

/** Отрезки, задерживающие свет: стены и двери (окна пропускают свет). */
export function blockingSegments(f: Floor): Seg[] {
  const segs: Seg[] = [];
  for (const c of wallChains(f, new Set(['window']))) {
    const pts = c.closed ? [...c.pts, c.pts[0]] : c.pts;
    for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i], pts[i + 1]]);
  }
  return segs;
}

/** Пересечение луча o + t·d (t ≥ 0) с отрезком; возвращает t или Infinity. */
function rayHit(o: Pt, dx: number, dy: number, s: Seg): number {
  const ex = s[1].x - s[0].x, ey = s[1].y - s[0].y;
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-12) return Infinity;
  const fx = s[0].x - o.x, fy = s[0].y - o.y;
  const t = (fx * ey - fy * ex) / den;
  const u = (fx * dy - fy * dx) / den;
  return t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 ? t : Infinity;
}

/** Многоугольник видимости в круге радиуса r (стены за пределами круга не учитываются). */
export function visibility(o: Pt, r: number, all: Seg[]): Pt[] {
  const R = r * 1.05;
  const near = all.filter(([a, b]) =>
    Math.min(a.x, b.x) <= o.x + R && Math.max(a.x, b.x) >= o.x - R && Math.min(a.y, b.y) <= o.y + R && Math.max(a.y, b.y) >= o.y - R);
  // рамка вокруг круга — лучи всегда во что-то упираются
  const box: Pt[] = [{ x: o.x - R, y: o.y - R }, { x: o.x + R, y: o.y - R }, { x: o.x + R, y: o.y + R }, { x: o.x - R, y: o.y + R }];
  const segs: Seg[] = [...near, [box[0], box[1]], [box[1], box[2]], [box[2], box[3]], [box[3], box[0]]];
  const angles: number[] = [];
  for (const [a, b] of segs) {
    for (const p of [a, b]) {
      const ang = Math.atan2(p.y - o.y, p.x - o.x);
      angles.push(ang - 1e-4, ang, ang + 1e-4);
    }
  }
  // равномерные лучи, чтобы дуга круга не превращалась в квадрат
  for (let i = 0; i < 48; i++) angles.push(-Math.PI + (i * Math.PI * 2) / 48);
  angles.sort((x, y) => x - y);
  const out: Pt[] = [];
  for (const ang of angles) {
    const dx = Math.cos(ang), dy = Math.sin(ang);
    let t = Infinity;
    for (const s of segs) { const h = rayHit(o, dx, dy, s); if (h < t) t = h; }
    if (!Number.isFinite(t)) continue;
    out.push({ x: o.x + dx * t, y: o.y + dy * t });
  }
  return out;
}
