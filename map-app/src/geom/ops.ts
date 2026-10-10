// Операции над документом целиком: сдвиг содержимого при изменении размера карты с якорем.
import type { Floor, GridType, MapDoc, Poly, Pt } from '../model/types';
import { hexAt, hexCenter } from './grid';

const add = (p: Pt, d: Pt): Pt => ({ x: p.x + d.x, y: p.y + d.y });
const shiftPoly = (poly: Poly, d: Pt): Poly => poly.map((ring) => ring.map((p) => add(p, d)));

/** Всё содержимое этажа, сдвинутое на d (в т. ч. кисти и фон-картинка). */
export function shiftFloorAll(f: Floor, d: Pt): Floor {
  const mv = (p: Pt) => add(p, d);
  return {
    ...f,
    rooms: f.rooms.map((r) => ({
      ...r, poly: shiftPoly(r.poly, d),
      ...(r.edgeStyles ? { edgeStyles: r.edgeStyles.map((e) => ({ ...e, a: mv(e.a), b: mv(e.b) })) } : {}),
    })),
    walls: f.walls.map((w) => ({ ...w, points: w.points.map(mv) })),
    portals: f.portals.map((p) => ({ ...p, a: mv(p.a), b: mv(p.b) })),
    objects: f.objects.map((o) => ({ ...o, x: o.x + d.x, y: o.y + d.y })),
    terrain: f.terrain.map((s) => ({ ...s, points: s.points.map(mv) })),
    paths: f.paths.map((p) => ({ ...p, points: p.points.map(mv) })),
    lights: f.lights.map((l) => ({ ...l, x: l.x + d.x, y: l.y + d.y })),
    labels: f.labels.map((l) => ({ ...l, x: l.x + d.x, y: l.y + d.y })),
    roofs: f.roofs.map((r) => ({ ...r, poly: shiftPoly(r.poly, d) })),
    image: f.image ? { ...f.image, x: f.image.x + d.x, y: f.image.y + d.y } : null,
  };
}

/** Сдвиг, не ломающий сетку: на гексах — ближайший вектор между центрами гексов. */
export function gridShift(type: GridType, d: Pt): Pt {
  if (type === 'hex-flat' || type === 'hex-pointy') return hexCenter(type, hexAt(type, d));
  return d;
}

/** Якорь при изменении размера: 0 — край слева/сверху остаётся на месте, 1 — центр, 2 — справа/снизу. */
export type Anchor = { col: 0 | 1 | 2; row: 0 | 1 | 2 };

/** Новый размер карты с якорем: поле добавляется (или срезается) с противоположной якорю стороны, содержимое сдвигается. */
export function resizeDoc(doc: MapDoc, width: number, height: number, anchor: Anchor): MapDoc {
  const part = (extra: number, k: 0 | 1 | 2) => (k === 0 ? 0 : k === 1 ? Math.floor(extra / 2) : extra);
  const d = gridShift(doc.grid.type, { x: part(width - doc.width, anchor.col), y: part(height - doc.height, anchor.row) });
  const moved = d.x !== 0 || d.y !== 0;
  return { ...doc, width, height, floors: moved ? doc.floors.map((f) => shiftFloorAll(f, d)) : doc.floors };
}
