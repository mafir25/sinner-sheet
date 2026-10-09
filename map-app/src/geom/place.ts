// Правила размещения (этап 3, docs/map-editor.md §5): куда «прилипает» объект и что с ним не так.
// Соглашение: верх картинки — задняя сторона объекта (спинка стула, задняя стенка шкафа).
// «Лицом к комнате» = верх картинки смотрит на стену. Генерация (этап 4) пользуется теми же функциями.
import type { AssetEntry, Floor, MapObject, Pt, Room, Rules } from '../model/types';
import { matchTarget } from '../assets/tree.js';
import { pointInPoly, ringArea, segDist } from './poly';
import { nearestWall } from './walls';
import { curvePoints } from './curve';

export const ROOM_TYPES: { id: string; ru: string; en: string }[] = [
  { id: 'office', ru: 'Офис', en: 'Office' },
  { id: 'warehouse', ru: 'Склад', en: 'Warehouse' },
  { id: 'lab', ru: 'Лаборатория', en: 'Laboratory' },
  { id: 'workshop', ru: 'Мастерская', en: 'Workshop' },
  { id: 'living', ru: 'Жилая', en: 'Living quarters' },
  { id: 'kitchen', ru: 'Кухня, столовая', en: 'Kitchen, canteen' },
  { id: 'bar', ru: 'Бар', en: 'Bar' },
  { id: 'shop', ru: 'Магазин', en: 'Shop' },
  { id: 'clinic', ru: 'Клиника', en: 'Clinic' },
  { id: 'corridor', ru: 'Коридор', en: 'Corridor' },
  { id: 'bathroom', ru: 'Санузел', en: 'Bathroom' },
  { id: 'hideout', ru: 'Логово', en: 'Hideout' },
];

export type Placement = { x: number; y: number; rot: number; guide?: Pt[] };
/** Что нарушено. key — строка для tr(), target — цель правила (#тег, путь), её имя подставит интерфейс. */
export type Issue = { key: string; args?: (string | number)[]; target?: string; dir?: string };

const norm = (v: Pt): Pt => { const L = Math.hypot(v.x, v.y) || 1; return { x: v.x / L, y: v.y / L }; };
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const deg = (r: number) => (r * 180) / Math.PI;
const wrap = (a: number) => Math.round((((a % 360) + 360) % 360) * 1e6) / 1e6 % 360;

/** Поворот (градусы), при котором верх картинки смотрит в направлении dir. */
export function rotFacing(dir: Pt): number {
  return wrap(deg(Math.atan2(dir.x, -dir.y)));
}

/** Полуразмер повёрнутого прямоугольника w×h вдоль единичной оси. */
export function halfExtent(w: number, h: number, rot: number, axis: Pt): number {
  const a = (rot * Math.PI) / 180;
  return Math.abs((w / 2) * (Math.cos(a) * axis.x + Math.sin(a) * axis.y)) + Math.abs((h / 2) * (-Math.sin(a) * axis.x + Math.cos(a) * axis.y));
}

export function roomAt(f: Floor, p: Pt): Room | undefined {
  for (let i = f.rooms.length - 1; i >= 0; i--) if (pointInPoly(p, f.rooms[i].poly)) return f.rooms[i];
  return undefined;
}

/** Центр масс внешнего контура комнаты. */
export function roomCenter(r: Room): Pt {
  const ring = r.poly[0];
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length], k = p.x * q.y - q.x * p.y;
    a += k; cx += (p.x + q.x) * k; cy += (p.y + q.y) * k;
  }
  if (Math.abs(a) < 1e-9) return ring[0];
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/** Спиной к ближайшей стене, вдоль стены — с шагом в полклетки (snap). */
export function placeAtWall(f: Floor, p: Pt, w: number, h: number, rot: number, r: Rules, snap: boolean): Placement | null {
  const hit = nearestWall(f, p, 1 + Math.max(w, h));
  if (!hit || hit.len < 1e-6) return null;
  const { a, b } = hit.seg, L = hit.len;
  const u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L }, n = { x: -u.y, y: u.x };
  let s = Math.sign(dot({ x: p.x - hit.q.x, y: p.y - hit.q.y }, n));
  if (!s) s = roomAt(f, { x: hit.q.x + n.x * 0.1, y: hit.q.y + n.y * 0.1 }) ? 1 : -1;
  const inward = { x: n.x * s, y: n.y * s };
  const rr = r.face ? rotFacing({ x: -inward.x, y: -inward.y }) : rot;
  const hu = halfExtent(w, h, rr, u), hn = halfExtent(w, h, rr, inward);
  let c = hit.t * L;
  if (snap) c = Math.round((c - hu) * 2) / 2 + hu;
  c = L >= 2 * hu ? Math.max(hu, Math.min(L - hu, c)) : L / 2;
  const off = hit.seg.style.width / 2 + r.gap + hn;
  return { x: a.x + u.x * c + inward.x * off, y: a.y + u.y * c + inward.y * off, rot: rr, guide: [a, b] };
}

/** В ближайший выпуклый угол комнаты: спиной к ближней стене, боком к другой. */
export function placeInCorner(f: Floor, p: Pt, w: number, h: number, rot: number, r: Rules): Placement | null {
  const reach = 1.5 + Math.max(w, h);
  let best: { v: Pt; pv: Pt; nv: Pt; d: number; width: number } | null = null;
  for (const room of f.rooms) {
    const ring = room.poly[0], sign = Math.sign(ringArea(ring));
    for (let i = 0; i < ring.length; i++) {
      const v = ring[i], pv = ring[(i - 1 + ring.length) % ring.length], nv = ring[(i + 1) % ring.length];
      const cross = (v.x - pv.x) * (nv.y - v.y) - (v.y - pv.y) * (nv.x - v.x);
      if (Math.sign(cross) !== sign) continue; // вогнутый угол — не угол комнаты
      const d = Math.hypot(p.x - v.x, p.y - v.y);
      if (d < reach && (!best || d < best.d)) best = { v, pv, nv, d, width: room.wall.width };
    }
  }
  if (!best) return null;
  const { v, pv, nv } = best;
  const [backEnd, sideEnd] = segDist(p, v, pv).d <= segDist(p, v, nv).d ? [pv, nv] : [nv, pv];
  const u = norm({ x: backEnd.x - v.x, y: backEnd.y - v.y });
  const side = norm({ x: sideEnd.x - v.x, y: sideEnd.y - v.y });
  const cosφ = dot(side, u), inward = norm({ x: side.x - u.x * cosφ, y: side.y - u.y * cosφ });
  const sinφ = dot(side, inward);
  if (sinφ < 0.2) return null; // слишком острый угол
  const rr = r.face ? rotFacing({ x: -inward.x, y: -inward.y }) : rot;
  const hu = halfExtent(w, h, rr, u), hn = halfExtent(w, h, rr, inward);
  const wall = best.width / 2 + r.gap;
  const off = wall + hn;
  // самый близкий к боковой стене угол рамки объекта должен отстоять от неё на толщину стены
  const yWorst = cosφ > 0 ? off + hn : off - hn;
  const c = hu + (wall + yWorst * cosφ) / sinφ;
  return { x: v.x + u.x * c + inward.x * off, y: v.y + u.y * c + inward.y * off, rot: rr, guide: [backEnd, v, sideEnd] };
}

/** В центр комнаты под курсором (если центр масс вне формы — оставляем точку курсора). */
export function placeAtCenter(f: Floor, p: Pt, rot: number): Placement | null {
  const room = roomAt(f, p);
  if (!room) return null;
  const c = roomCenter(room);
  return pointInPoly(c, room.poly) ? { x: c.x, y: c.y, rot, guide: room.poly[0] } : null;
}

/** Вдоль ближайшего пути (дороги): с краю, передом к дороге. */
export function placeAtRoad(f: Floor, p: Pt, w: number, h: number, rot: number, r: Rules): Placement | null {
  let best: { q: Pt; a: Pt; b: Pt; d: number; half: number } | null = null;
  for (const pa of f.paths) {
    const half = Math.max(pa.style.width, pa.style.parallel ? pa.style.parallel.gap + pa.style.parallel.width : 0) / 2;
    const pts = curvePoints(pa.points, pa.smooth, pa.closed);
    for (let i = 0; i < pts.length - 1; i++) {
      const sd = segDist(p, pts[i], pts[i + 1]);
      if (sd.d - half < 1 + Math.max(w, h) && (!best || sd.d - half < best.d - best.half)) best = { q: sd.q, a: pts[i], b: pts[i + 1], d: sd.d, half };
    }
  }
  if (!best) return null;
  const u = norm({ x: best.b.x - best.a.x, y: best.b.y - best.a.y }), n = { x: -u.y, y: u.x };
  const s = Math.sign(dot({ x: p.x - best.q.x, y: p.y - best.q.y }, n)) || 1;
  const out = { x: n.x * s, y: n.y * s };
  const rr = r.face ? rotFacing(out) : rot;
  const off = best.half + r.gap + halfExtent(w, h, rr, out);
  return { x: best.q.x + out.x * off, y: best.q.y + out.y * off, rot: rr, guide: [best.a, best.b] };
}

/** Позиция по правилу «place»; null — правило не сработало (объект ставится как обычно). */
export function placeByRules(f: Floor, p: Pt, w: number, h: number, rot: number, r: Rules, snap: boolean): Placement | null {
  switch (r.place) {
    case 'wall': return placeAtWall(f, p, w, h, rot, r, snap);
    case 'corner': return placeInCorner(f, p, w, h, rot, r);
    case 'center': return placeAtCenter(f, p, rot);
    case 'road': return placeAtRoad(f, p, w, h, rot, r);
    default: return null;
  }
}

// ---------- проверка правил
type Box = { x: number; y: number; w: number; h: number; rot: number };
function corners(o: Box): Pt[] {
  const a = (o.rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const x = (sx * o.w) / 2, y = (sy * o.h) / 2;
    return { x: o.x + x * c - y * s, y: o.y + x * s + y * c };
  });
}

/** Пересекаются ли повёрнутые прямоугольники (теорема о разделяющей оси). */
export function boxesOverlap(a: Box, b: Box): boolean {
  const ca = corners(a), cb = corners(b);
  for (const poly of [ca, cb]) {
    for (let i = 0; i < 2; i++) {
      const e = { x: poly[i + 1].x - poly[i].x, y: poly[i + 1].y - poly[i].y }, ax = norm({ x: -e.y, y: e.x });
      const pa = ca.map((q) => dot(q, ax)), pb = cb.map((q) => dot(q, ax));
      if (Math.max(...pa) <= Math.min(...pb) + 1e-9 || Math.max(...pb) <= Math.min(...pa) + 1e-9) return false;
    }
  }
  return true;
}

/** Зазор между объектами (по описанным прямоугольникам, клетки). */
export function boxGap(a: Box, b: Box): number {
  const bb = (o: Box) => {
    const cs = corners(o);
    return { x0: Math.min(...cs.map((q) => q.x)), x1: Math.max(...cs.map((q) => q.x)), y0: Math.min(...cs.map((q) => q.y)), y1: Math.max(...cs.map((q) => q.y)) };
  };
  const p = bb(a), q = bb(b);
  return Math.hypot(Math.max(0, p.x0 - q.x1, q.x0 - p.x1), Math.max(0, p.y0 - q.y1, q.y0 - p.y1));
}

/** Нарушения правил у объекта o на этаже f (o может ещё не лежать на этаже — предпросмотр). */
export function checkObject(f: Floor, o: MapObject, entryOf: (key: string) => AssetEntry | undefined): Issue[] {
  const e = entryOf(o.asset), r = e?.rules;
  if (!e || !r) return [];
  const out: Issue[] = [];
  const room = roomAt(f, o);
  if (r.where === 'inside' && !room) out.push({ key: 'Должен стоять в комнате' });
  if (r.where === 'outside' && room) out.push({ key: 'Должен стоять снаружи' });
  if (room?.type && r.rooms.length && !r.rooms.includes(room.type)) {
    out.push({ key: 'Не для комнаты «{0}»', args: [room.type] });
  }
  const others = f.objects.filter((x) => x.id !== o.id);
  const matching = (to: string) => others.filter((x) => { const xe = entryOf(x.asset); return !!xe && matchTarget(to, xe, e.dir); });
  for (const rel of r.near) {
    if (!matching(rel.to).some((x) => boxGap(o, x) <= rel.dist + 1e-6)) out.push({ key: 'Рядом должен быть: {0}', target: rel.to, dir: e.dir });
  }
  for (const rel of r.avoid) {
    if (matching(rel.to).some((x) => boxGap(o, x) < rel.dist - 1e-6)) out.push({ key: 'Слишком близко к: {0}', target: rel.to, dir: e.dir });
  }
  if (r.clearDoors) {
    const shrunk = { ...o, w: Math.max(0.01, o.w - 0.04), h: Math.max(0.01, o.h - 0.04) };
    for (const d of f.portals) {
      if (d.kind !== 'door') continue;
      const L = Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y);
      // проход: по клетке с каждой стороны двери
      const zone = { x: (d.a.x + d.b.x) / 2, y: (d.a.y + d.b.y) / 2, w: L, h: 2.2, rot: deg(Math.atan2(d.b.y - d.a.y, d.b.x - d.a.x)) };
      if (boxesOverlap(shrunk, zone)) { out.push({ key: 'Загораживает дверь' }); break; }
    }
  }
  if (r.max > 0 && room) {
    const same = (x: MapObject) => {
      if (x.asset === o.asset) return true;
      const xe = entryOf(x.asset);
      return !!xe && !!e.group && xe.dir === e.dir && xe.group === e.group;
    };
    const n = [o, ...others].filter((x) => same(x) && roomAt(f, x) === room).length;
    if (n > r.max) out.push({ key: 'Больше {0} на комнату', args: [r.max] });
  }
  return out;
}

/** Объекты этажа, у которых нарушены правила. */
export function floorIssues(f: Floor, entryOf: (key: string) => AssetEntry | undefined): Map<string, Issue[]> {
  const out = new Map<string, Issue[]>();
  for (const o of f.objects) {
    const list = checkObject(f, o, entryOf);
    if (list.length) out.set(o.id, list);
  }
  return out;
}

// ---------- вариативность
/** Случайные поворот, отражение, масштаб и оттенок по правилам. rnd — генератор [0, 1) (для зерна на этапе 4). */
export function rollVariation(r: Rules | undefined, rnd: () => number = Math.random): { rot: number; flip: boolean; scale: number; tint: string | null } {
  if (!r) return { rot: 0, flip: false, scale: 1, tint: null };
  const rot = r.rotate === 'any' ? Math.floor(rnd() * 24) * 15 : r.rotate === '90' ? Math.floor(rnd() * 4) * 90 : 0;
  const [s0, s1] = r.scale;
  return {
    rot,
    flip: r.flip && rnd() < 0.5,
    scale: Math.round((s0 + (s1 - s0) * rnd()) * 100) / 100,
    tint: r.tint.length ? r.tint[Math.floor(rnd() * r.tint.length)] : null,
  };
}
