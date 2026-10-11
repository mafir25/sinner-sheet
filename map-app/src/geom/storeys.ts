// Этажи над зданиями: надстройка на плоской крыше и чердак под скатной. Такой этаж знает, над каким этажом стоит
// (Floor.base); на нижнем он рисуется поверх, поднятый на высоту стен, и его можно скрыть, чтобы заглянуть внутрь.
import type { Floor, MapDoc, Pt, Roof, Room } from '../model/types';
import { DEFAULT_WALL, uid } from '../model/doc';
import { wallLift } from './walls';
import { intersects, pointInPoly, segDist } from './poly';
import { buildingRooms } from './roof';
import { labelSpot } from './levels';

export const ATTIC_FLOOR = 'canon:floors/wood.svg';

/** Этаж, над которым стоит f (null — f не надстройка или основание удалено). */
export function baseOf(doc: MapDoc, f: Floor): Floor | null {
  return (f.base && f.base !== f.id && doc.floors.find((x) => x.id === f.base)) || null;
}

/** Номер этажа в здании: 1 — этаж без основания, 2 — надстройка над ним и т. д. */
export function storeyNo(doc: MapDoc, f: Floor): number {
  let n = 1;
  for (let b = baseOf(doc, f), guard = 0; b && guard < 64; b = baseOf(doc, b), guard++) n++;
  return n;
}

/** Видимые этажи над этим (надстройки, надстройки над ними...) — снизу вверх. Скрытый этаж скрывает и всё над ним. */
export function storeysAbove(doc: MapDoc, floorId: string): Floor[] {
  const out: Floor[] = [], seen = new Set([floorId]);
  let level = [floorId];
  while (level.length) {
    const next: string[] = [];
    for (const f of doc.floors) {
      if (!f.base || !level.includes(f.base) || seen.has(f.id)) continue;
      seen.add(f.id);
      if (!f.visible) continue;
      out.push(f);
      next.push(f.id);
    }
    level = next;
  }
  return out;
}

/** Комната этажа в точке. */
const roomAt = (f: Floor, p: Pt): Room | undefined => f.rooms.find((r) => pointInPoly(p, r.poly));

/**
 * Насколько поднят этаж up над этажом from в точке p: сумма высот стен этажей под ним (в проекции, клеток).
 * Надстройка встаёт на верх стен — туда же, где была крыша.
 */
export function storeyLift(doc: MapDoc, from: Floor, up: Floor, p: Pt): Pt {
  let x = 0, y = 0;
  for (let b = baseOf(doc, up), guard = 0; b && guard < 64; b = baseOf(doc, b), guard++) {
    const room = roomAt(b, p);
    if (room) { const l = wallLift(room.wall); x += l.x; y += l.y; }
    if (b.id === from.id) break;
  }
  return { x, y };
}

/** Часть надстройки: одно здание (поднимается на высоту своих стен) или всё прочее (at — null, без подъёма). */
export type StoreyPart = { floor: Floor; at: Pt | null };

const near = (p: Pt, rooms: Room[]) =>
  rooms.some((r) => pointInPoly(p, r.poly) || r.poly.some((ring) => ring.some((a, i) => segDist(p, a, ring[(i + 1) % ring.length]).d < 0.6)));

const partsCache = new WeakMap<Floor, StoreyPart[]>();

/** Надстройка по зданиям: у разных зданий разная высота стен, каждое поднимается на свою. */
export function storeyParts(f: Floor): StoreyPart[] {
  const hit = partsCache.get(f);
  if (hit) return hit;
  const groups: Room[][] = [], seen = new Set<string>();
  for (const r of f.rooms) {
    if (seen.has(r.id)) continue;
    const g = buildingRooms(f, r);
    g.forEach((x) => seen.add(x.id));
    groups.push(g);
  }
  const empty = (id: string): Floor => ({
    ...f, id, ground: null, image: null, rooms: [], walls: [], portals: [], objects: [], terrain: [], paths: [], lights: [], labels: [], roofs: [], levels: [],
  });
  const parts: StoreyPart[] = groups.map((g, k) => ({ floor: { ...empty(`${f.id}#${k}`), rooms: g }, at: labelSpot(g[0].poly) }));
  const rest = empty(`${f.id}#rest`);
  const put = <K extends 'walls' | 'portals' | 'objects' | 'terrain' | 'paths' | 'lights' | 'roofs' | 'levels'>(key: K, item: Floor[K][number], p: Pt) => {
    const k = groups.findIndex((g) => near(p, g));
    ((k < 0 ? rest : parts[k].floor)[key] as Floor[K][number][]).push(item);
  };
  const mid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  for (const w of f.walls) put('walls', w, mid(w.points[0], w.points[1]));
  for (const p of f.portals) put('portals', p, mid(p.a, p.b));
  for (const o of f.objects) put('objects', o, o);
  for (const t of f.terrain) put('terrain', t, t.points[0]);
  for (const p of f.paths) put('paths', p, p.points[0]);
  for (const l of f.lights) put('lights', l, l);
  for (const r of f.roofs) put('roofs', r, labelSpot(r.poly));
  for (const l of f.levels) put('levels', l, labelSpot(l.poly));
  const out = [...parts];
  if (rest.walls.length + rest.portals.length + rest.objects.length + rest.terrain.length + rest.paths.length + rest.roofs.length + rest.levels.length) out.push({ floor: rest, at: null });
  partsCache.set(f, out);
  return out;
}

/** Этаж над этим, построенный инструментом (первый, если их несколько). */
export const upperOf = (doc: MapDoc, floorId: string): Floor | null => doc.floors.find((f) => f.base === floorId && f.id !== floorId) ?? null;

/** Над этой крышей уже стоит этаж? */
export const builtOver = (doc: MapDoc, floorId: string, roof: Roof) =>
  doc.floors.some((f) => f.base === floorId && f.rooms.some((r) => intersects(r.poly, roof.poly)));

/**
 * Надстроить этаж над крышей (в черновике документа). Плоская крыша остаётся перекрытием нижнего этажа, а на
 * новом этаже — комната по её форме со стенами нижней комнаты и такая же плоская крыша. Скатная крыша становится
 * чердаком: на новом этаже — комната под ней (дощатый пол), а сама крыша переезжает наверх, над чердаком.
 * Этаж над нижним берётся готовый или создаётся сразу над ним. Возвращает id этажа надстройки.
 */
export function buildStorey(d: MapDoc, floorId: string, roofId: string, name: string): string | null {
  const f = d.floors.find((x) => x.id === floorId);
  const roof = f?.roofs.find((r) => r.id === roofId);
  if (!f || !roof) return null;
  const attic = (roof.shape ?? 'hip') !== 'flat';
  let up = upperOf(d, floorId);
  if (!up) {
    up = {
      id: uid('f'), name, visible: true, base: floorId, rooms: [], walls: [], portals: [], objects: [], layers: structuredClone(f.layers),
      ground: null, terrain: [], paths: [], lights: [], labels: [], roofs: [], levels: [], image: null,
    };
    for (const l of up.layers) l.id = uid('l');
    d.floors.splice(d.floors.indexOf(f) + 1, 0, up);
  }
  const p = labelSpot(roof.poly);
  const below = roomAt(f, p) ?? f.rooms.find((r) => intersects(r.poly, roof.poly));
  const wall = structuredClone(below?.wall ?? DEFAULT_WALL);
  delete wall.low;
  const room: Room = { id: uid('r'), poly: structuredClone(roof.poly), floor: attic ? ATTIC_FLOOR : below?.floor ?? null, wall };
  if (!attic && below?.type) room.type = below.type;
  up.rooms.push(room);
  if (attic) {
    f.roofs = f.roofs.filter((r) => r.id !== roofId);
    up.roofs.push(roof);
  } else {
    const top = { ...structuredClone(roof), id: uid('rf') };
    if (top.height) top.height += 10;
    up.roofs.push(top);
  }
  return up.id;
}
