// Операции над документом целиком: сдвиг содержимого при изменении размера карты с якорем.
import type { AssetKey, Floor, GridType, MapDoc, MapObject, Poly, Pt } from '../model/types';
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

/** Объекты этажа с тем же ассетом, что у выбранных, или из той же группы вариантов; скрытые и заблокированные слои — мимо. */
export function sameObjects(f: Floor, picked: MapObject[],
  entry: (k: AssetKey) => { dir: string; group?: string } | undefined): string[] {
  const keys = new Set(picked.map((o) => o.asset));
  const groups = new Set(picked.map((o) => { const e = entry(o.asset); return e?.group ? `${o.asset.slice(0, o.asset.lastIndexOf('/') + 1)}|${e.group}` : ''; }).filter(Boolean));
  const off = new Set(f.layers.filter((l) => l.locked || !l.visible).map((l) => l.id));
  return f.objects.filter((o) => {
    if (off.has(o.layer)) return false;
    if (keys.has(o.asset)) return true;
    const e = entry(o.asset);
    return !!e?.group && groups.has(`${o.asset.slice(0, o.asset.lastIndexOf('/') + 1)}|${e.group}`);
  }).map((o) => o.id);
}

// ---------- выравнивание, распределение и повтор объектов
/** Описанный прямоугольник объекта с учётом поворота. */
function objBox(o: MapObject) {
  const a = (o.rot * Math.PI) / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const hw = (o.w * c + o.h * s) / 2, hh = (o.w * s + o.h * c) / 2;
  return { x0: o.x - hw, x1: o.x + hw, y0: o.y - hh, y1: o.y + hh };
}

export type AlignMode = 'left' | 'cx' | 'right' | 'top' | 'cy' | 'bottom';
/** Новые центры объектов, выровненных по краю или центру общей рамки. */
export function alignObjects(objs: MapObject[], mode: AlignMode): Map<string, Pt> {
  const boxes = objs.map(objBox);
  const x0 = Math.min(...boxes.map((b) => b.x0)), x1 = Math.max(...boxes.map((b) => b.x1));
  const y0 = Math.min(...boxes.map((b) => b.y0)), y1 = Math.max(...boxes.map((b) => b.y1));
  const out = new Map<string, Pt>();
  objs.forEach((o, i) => {
    const b = boxes[i], hw = (b.x1 - b.x0) / 2, hh = (b.y1 - b.y0) / 2;
    const x = mode === 'left' ? x0 + hw : mode === 'right' ? x1 - hw : mode === 'cx' ? (x0 + x1) / 2 : o.x;
    const y = mode === 'top' ? y0 + hh : mode === 'bottom' ? y1 - hh : mode === 'cy' ? (y0 + y1) / 2 : o.y;
    out.set(o.id, { x, y });
  });
  return out;
}

/** Равные промежутки между объектами по оси (крайние остаются на месте). */
export function distributeObjects(objs: MapObject[], axis: 'x' | 'y'): Map<string, Pt> {
  const out = new Map<string, Pt>();
  if (objs.length < 3) return out;
  const lo = axis === 'x' ? 'x0' : 'y0', hi = axis === 'x' ? 'x1' : 'y1';
  const list = objs.map((o) => ({ o, b: objBox(o) })).sort((a, b) => a.b[lo] - b.b[lo]);
  const span = list[list.length - 1].b[hi] - list[0].b[lo];
  const sizes = list.reduce((s, { b }) => s + (b[hi] - b[lo]), 0);
  const gap = (span - sizes) / (list.length - 1);
  let at = list[0].b[lo];
  for (const { o, b } of list) {
    const size = b[hi] - b[lo];
    out.set(o.id, axis === 'x' ? { x: at + size / 2, y: o.y } : { x: o.x, y: at + size / 2 });
    at += size + gap;
  }
  return out;
}

/** Копии выделенных объектов: count штук с шагом step (клетки), каждая следующая — дальше на step. */
export function repeatObjects(objs: MapObject[], count: number, step: Pt, newId: () => string): MapObject[] {
  const out: MapObject[] = [];
  for (let k = 1; k <= count; k++) for (const o of objs) out.push({ ...o, id: newId(), x: o.x + step.x * k, y: o.y + step.y * k });
  return out;
}

// ---------- буфер обмена: всё выделенное, а не только объекты
export type Clip = Pick<Floor, 'objects' | 'rooms' | 'walls' | 'portals' | 'paths' | 'lights' | 'labels' | 'roofs'>;
const CLIP_KEYS = ['objects', 'rooms', 'walls', 'portals', 'paths', 'lights', 'labels', 'roofs'] as const;
export const clipSize = (c: Clip) => CLIP_KEYS.reduce((s, k) => s + c[k].length, 0);

/** Выделенное на этаже; проёмы на выделенных комнатах и стенах берутся вместе с ними. */
export function copySelection(f: Floor, ids: Set<string>, onWalls: (part: Floor) => Set<string>): Clip {
  const pick = <T extends { id: string }>(list: T[]) => structuredClone(list.filter((x) => ids.has(x.id)));
  const rooms = pick(f.rooms), walls = pick(f.walls);
  const attached = rooms.length || walls.length ? onWalls({ ...f, rooms, walls }) : new Set<string>();
  return {
    objects: pick(f.objects), rooms, walls, paths: pick(f.paths), lights: pick(f.lights), labels: pick(f.labels), roofs: pick(f.roofs),
    portals: structuredClone(f.portals.filter((p) => ids.has(p.id) || attached.has(p.id))),
  };
}

/** Копия буфера для вставки: новые id, сдвиг d; объекты и пути с чужим слоем — на слой layer. */
export function pasteClip(c: Clip, d: Pt, layers: Set<string>, layer: string, newId: (prefix: string) => string): Clip {
  const moved = shiftFloorAll({ ...emptyFloor(), ...structuredClone(c) }, d);
  const fresh = <T extends { id: string }>(list: T[], prefix: string) => list.map((x) => ({ ...x, id: newId(prefix) }));
  return {
    objects: fresh(moved.objects, 'o').map((o) => (layers.has(o.layer) ? o : { ...o, layer })),
    paths: fresh(moved.paths, 'pa').map((p) => (layers.has(p.layer) ? p : { ...p, layer })),
    rooms: fresh(moved.rooms, 'r'), walls: fresh(moved.walls, 'w'), portals: fresh(moved.portals, 'd'),
    lights: fresh(moved.lights, 'li'), labels: fresh(moved.labels, 'lb'), roofs: fresh(moved.roofs, 'rf'),
  };
}

function emptyFloor(): Floor {
  return { id: '', name: '', visible: true, rooms: [], walls: [], portals: [], objects: [], layers: [], ground: null, terrain: [], paths: [], lights: [], labels: [], roofs: [], image: null };
}

/** Копия этажа целиком (новый id и название) — основа для следующего этажа здания. */
export function cloneFloor(f: Floor, id: string, name: string): Floor {
  return { ...structuredClone(f), id, name };
}
