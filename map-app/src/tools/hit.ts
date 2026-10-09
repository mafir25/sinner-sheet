// Что под курсором: объекты, проёмы, стены, комнаты. Порядок — как видно на экране (сверху вниз).
import type { Floor, MapObject, Pt } from '../model/types';
import type { SelItem } from '../state/editor';
import { type BBox, pointInPoly, ptsBBox, segDist } from '../geom/poly';

/** Точка в системе координат объекта (центр — 0,0; без поворота). */
export function toLocal(o: MapObject, p: Pt): Pt {
  const a = (-o.rot * Math.PI) / 180, dx = p.x - o.x, dy = p.y - o.y;
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
}
export function fromLocal(o: MapObject, p: Pt): Pt {
  const a = (o.rot * Math.PI) / 180;
  return { x: o.x + p.x * Math.cos(a) - p.y * Math.sin(a), y: o.y + p.x * Math.sin(a) + p.y * Math.cos(a) };
}
export const objectContains = (o: MapObject, p: Pt, pad = 0) => {
  const l = toLocal(o, p);
  return Math.abs(l.x) <= o.w / 2 + pad && Math.abs(l.y) <= o.h / 2 + pad;
};
export function objectCorners(o: MapObject): Pt[] {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => fromLocal(o, { x: (sx * o.w) / 2, y: (sy * o.h) / 2 }));
}

export function hitTest(f: Floor, p: Pt, scale: number): SelItem | null {
  const tol = 6 / scale;
  const layers = f.layers.filter((l) => l.visible && !l.locked);
  const above = layers.filter((l) => l.aboveWalls).map((l) => l.id).reverse();
  const below = layers.filter((l) => !l.aboveWalls).map((l) => l.id).reverse();
  const objIn = (ids: string[]) => {
    for (const lid of ids) {
      for (let i = f.objects.length - 1; i >= 0; i--) {
        const o = f.objects[i];
        if (o.layer === lid && objectContains(o, p, tol * 0.5)) return { kind: 'object' as const, id: o.id };
      }
    }
    return null;
  };
  const a = objIn(above);
  if (a) return a;
  for (let i = f.portals.length - 1; i >= 0; i--) {
    const pt = f.portals[i];
    if (segDist(p, pt.a, pt.b).d <= Math.max(tol, 0.2)) return { kind: 'portal', id: pt.id };
  }
  for (let i = f.walls.length - 1; i >= 0; i--) {
    const w = f.walls[i];
    const n = w.points.length;
    for (let j = 0; j < n - (w.closed ? 0 : 1); j++) {
      if (segDist(p, w.points[j], w.points[(j + 1) % n]).d <= w.wall.width / 2 + tol) return { kind: 'wall', id: w.id };
    }
  }
  const b = objIn(below);
  if (b) return b;
  for (let i = f.rooms.length - 1; i >= 0; i--) if (pointInPoly(p, f.rooms[i].poly)) return { kind: 'room', id: f.rooms[i].id };
  return null;
}

/** Всё, что целиком внутри рамки. */
export function boxSelect(f: Floor, box: BBox): SelItem[] {
  const inside = (q: Pt) => q.x >= box.x0 && q.x <= box.x1 && q.y >= box.y0 && q.y <= box.y1;
  const locked = new Set(f.layers.filter((l) => l.locked || !l.visible).map((l) => l.id));
  const out: SelItem[] = [];
  for (const o of f.objects) if (!locked.has(o.layer) && objectCorners(o).every(inside)) out.push({ kind: 'object', id: o.id });
  for (const p of f.portals) if (inside(p.a) && inside(p.b)) out.push({ kind: 'portal', id: p.id });
  for (const w of f.walls) if (w.points.every(inside)) out.push({ kind: 'wall', id: w.id });
  for (const r of f.rooms) if (r.poly[0].every(inside)) out.push({ kind: 'room', id: r.id });
  return out;
}

export function selectionBBox(f: Floor, sel: SelItem[]): BBox | null {
  const pts: Pt[] = [];
  const ids = new Set(sel.map((s) => s.id));
  for (const o of f.objects) if (ids.has(o.id)) pts.push(...objectCorners(o));
  for (const p of f.portals) if (ids.has(p.id)) pts.push(p.a, p.b);
  for (const w of f.walls) if (ids.has(w.id)) pts.push(...w.points);
  for (const r of f.rooms) if (ids.has(r.id)) pts.push(...r.poly[0]);
  return pts.length ? ptsBBox(pts) : null;
}
