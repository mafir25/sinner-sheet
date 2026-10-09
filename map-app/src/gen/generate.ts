// Генерация карт (этап 4, docs/map-editor.md §2, §5): оформление наброска, здания, подземелья, улицы Задворок.
// Каждая функция меняет документ на месте (редактор зовёт её внутри ed.commit — одно действие в истории).
// Одно и то же зерно + те же параметры + те же наборы = та же карта.
import type { District, Floor, Layer, MapDoc, Pt, Room } from '../model/types';
import { districtPalette } from '../data/world';
import { DEFAULT_PATH, DEFAULT_WALL, uid } from '../model/doc';
import { difference, pointInPoly, rectPoly, union } from '../geom/poly';
import { placeAtRoad, placeAtWall, roomCenter, rotFacing } from '../geom/place';
import { normRules } from '../assets/tree.js';
import { tr } from '../i18n';
import { type BuildingType, BUILDINGS, type Condition, DUNGEON_ROOMS, type GenKit, type Style, type StyleId, styleById } from './kit';
import { type Ctx, furnishRoom, lightRoom, outsideRooms, placeCover, placeTraps, roomArea, weather } from './furnish';
import { type Seg, addEntrances, addWindows, connectRooms } from './layout';
import { type Rnd, between, chance, intBetween, makeRnd, pick, shuffle, weighted } from './rng';

/** Что добавить в комнаты. cover и traps — сколько (0 — нет, 1 — немного, 2 — много). */
export type Fill = {
  furnish: boolean; density: number; cover: number; traps: number;
  weather: boolean; lights: boolean; numbers: boolean;
  /** Состояние: от стиля или своё. */
  condition: Condition | 'style';
  /** Район: контекст правил (`districts`), оттенок стен и света, вывеска Крыла у входа. */
  district?: District;
};
export type Common = { seed: string; clear: boolean; fill: Fill };

export type DecorateOpts = Common & {
  /** id комнат; пусто — все комнаты этажа. */
  rooms: string[];
  style: StyleId;
  /** Перекрасить полы и стены по стилю («раскраска стиля»). */
  restyle: boolean;
  doors: boolean; windows: boolean;
};
export type BuildingOpts = Common & { type: BuildingType; width: number; height: number; rooms: number; style: StyleId | 'auto'; roof: boolean };
export type DungeonOpts = Common & { rooms: number; style: StyleId };
export type StreetsOpts = Common & { block: number; plazas: number; buildings: boolean; roofs: boolean; style: StyleId };

type Rect = { x0: number; y0: number; x1: number; y1: number };
const rw = (r: Rect) => r.x1 - r.x0, rh = (r: Rect) => r.y1 - r.y0;
const rectToPoly = (r: Rect) => rectPoly({ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y1 });

// ---------- общее
function clearFloor(f: Floor) {
  Object.assign(f, { rooms: [], walls: [], portals: [], objects: [], terrain: [], paths: [], lights: [], labels: [], roofs: [] });
}

/** Слои для генератора: декор пола, объекты, над стенами и «Ловушки» (только для мастера). */
function layersOf(f: Floor, needTraps: boolean) {
  const below = f.layers.filter((l) => !l.aboveWalls);
  const decor = (below[0] ?? f.layers[0]).id;
  const objects = (below[1] ?? below[0] ?? f.layers[0]).id;
  const above = (f.layers.find((l) => l.aboveWalls) ?? f.layers[0]).id;
  let traps = f.layers.find((l) => l.gmOnly && !l.aboveWalls)?.id;
  if (!traps && needTraps) {
    const layer: Layer = { id: uid('l'), name: tr('Ловушки'), visible: true, locked: false, aboveWalls: false, gmOnly: true };
    const i = f.layers.findIndex((l) => l.id === objects);
    f.layers.splice(i + 1, 0, layer);
    traps = layer.id;
  }
  return { decor, objects, above, traps: traps ?? objects };
}

function makeCtx(doc: MapDoc, f: Floor, kit: GenKit, rnd: Rnd, fill: Fill): Ctx {
  return { f, kit, rnd, grid: doc.grid.type, layers: layersOf(f, fill.traps > 0), district: fill.district, width: doc.width, height: doc.height };
}

const floorOf = (doc: MapDoc, floorId: string) => doc.floors.find((x) => x.id === floorId) ?? doc.floors[0];
const conditionOf = (fill: Fill, style: Style): Condition => (fill.condition === 'style' ? style.condition : fill.condition);

function doorPicker(kit: GenKit, style: Style, rnd: Rnd) {
  const one = kit.pick('door', [pick(rnd, style.doors)]);
  const big = kit.pick('door', style.bigDoors);
  const size = (k: string | null) => kit.entryOf(k ?? '')?.footprint[0] ?? 1;
  return {
    inner: () => ({ key: one, size: size(one) }),
    outer: (wide: boolean, seg: Seg) => {
      const L = Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y);
      return wide && big && L >= size(big) + 2 ? { key: big, size: size(big) } : { key: one, size: size(one) };
    },
  };
}

const WIDE_DOOR = new Set(['warehouse', 'workshop', 'shop', 'bar']);
const WINDOW_K: Record<string, number> = { bathroom: 0.3, corridor: 0.35, warehouse: 0.5, hideout: 0.5 };

/** Двери, входы, окна и содержимое для готовых комнат. */
function finish(ctx: Ctx, rooms: Room[], style: Style, fill: Fill, o: { doors: boolean; windows: boolean; entrances: number; toward?: Pt; loops?: number; signChance?: number }) {
  const { rnd, kit, f } = ctx;
  const doors = doorPicker(kit, style, rnd);
  if (o.doors) {
    connectRooms(f, rooms, rnd, () => doors.inner(), o.loops ?? 0.2);
    if (o.entrances > 0) {
      const wide = rooms.some((r) => WIDE_DOOR.has(r.type ?? ''));
      const before = f.portals.length;
      addEntrances(f, rooms, rnd, o.entrances, (seg) => doors.outer(wide, seg), o.toward);
      if (fill.district?.wing && chance(rnd, o.signChance ?? 1)) for (const p of f.portals.slice(before)) wingSign(ctx, p, fill.district.wing);
    }
  }
  if (o.windows) {
    const win = () => { const k = kit.pick('window', [pick(rnd, style.windows)]); return { key: k, size: kit.entryOf(k ?? '')?.footprint[0] ?? 1 }; };
    addWindows(f, rooms, rnd, (r) => style.windowChance * (WINDOW_K[r.type ?? ''] ?? 1), win);
  }
  fillRooms(ctx, rooms, style, fill);
}

function fillRooms(ctx: Ctx, rooms: Room[], style: Style, fill: Fill) {
  const condition = conditionOf(fill, style);
  for (const r of rooms) {
    if (fill.furnish) furnishRoom(ctx, r, condition, fill.density);
    const area = roomArea(r);
    if (fill.cover > 0 && area >= 20 && r.type !== 'corridor' && r.type !== 'bathroom') placeCover(ctx, r, Math.round(area * 0.025 * fill.cover * between(ctx.rnd, 0.5, 1.3)), condition);
    if (fill.traps > 0 && chance(ctx.rnd, r.type === 'corridor' ? 0.6 : 0.3 * fill.traps)) placeTraps(ctx, r, intBetween(ctx.rnd, 1, fill.traps));
    if (fill.weather) weather(ctx, r, condition);
    if (fill.lights) lightRoom(ctx, r, style.light);
  }
  if (fill.numbers) numberRooms(ctx.f, rooms);
}

/** Номера комнат «только для мастера», по порядку сверху вниз и слева направо. */
function numberRooms(f: Floor, rooms: Room[]) {
  const sorted = rooms.filter((r) => r.type !== 'corridor').map((r) => ({ r, c: roomCenter(r) }))
    .sort((a, b) => Math.round(a.c.y / 3) - Math.round(b.c.y / 3) || a.c.x - b.c.x);
  let n = f.labels.filter((l) => /^\d+$/.test(l.text)).reduce((m, l) => Math.max(m, Number(l.text)), 0);
  for (const { r, c } of sorted) {
    const at = pointInPoly(c, r.poly) ? c : r.poly[0][0];
    f.labels.push({ id: uid('lb'), x: at.x, y: at.y - 0.6, text: String(++n), size: 0.8, color: '#ffffff', rot: 0, font: 'head', box: true, gmOnly: true });
  }
}

function newRoom(kit: GenKit, style: Style, rnd: Rnd, poly: Room['poly'], type: string, wall: string | null): Room {
  const floor = kit.pick('floor', [pick(rnd, style.floors[type] ?? style.floors['*'])]);
  return { id: uid('r'), poly, floor, wall: { ...DEFAULT_WALL, asset: wall, color: style.wallColor }, type };
}

/** Стиль с оттенком Района: стены и свет чуть окрашены в его цвет. */
function paint(style: Style, fill: Fill): Style {
  if (!fill.district) return style;
  const pal = districtPalette(fill.district.color);
  return { ...style, wallColor: pal.wall(style.wallColor), light: pal.light };
}

/** Вывеска Крыла Района (scalable/signs/wings/<x>-corp/sign.svg) снаружи у входной двери. */
function wingSign(ctx: Ctx, door: { a: Pt; b: Pt }, wing: string) {
  const key = `canon:scalable/signs/wings/${wing.toLowerCase()}-corp/sign.svg`;
  const e = ctx.kit.entryOf(key);
  if (!e) return;
  const L = Math.hypot(door.b.x - door.a.x, door.b.y - door.a.y) || 1;
  const u = { x: (door.b.x - door.a.x) / L, y: (door.b.y - door.a.y) / L };
  const m = { x: (door.a.x + door.b.x) / 2, y: (door.a.y + door.b.y) / 2 };
  let n = { x: -u.y, y: u.x };
  if (ctx.f.rooms.some((r) => pointInPoly({ x: m.x + n.x * 0.4, y: m.y + n.y * 0.4 }, r.poly))) n = { x: -n.x, y: -n.y };
  const k = Math.min(1, 1.6 / e.footprint[0]), w = e.footprint[0] * k, h = e.footprint[1] * k;
  for (const side of [1, -1]) {
    const along = side * (L / 2 + w / 2 + 0.3);
    const o = {
      id: uid('o'), asset: key, layer: ctx.layers.above, w, h, rot: rotFacing({ x: -n.x, y: -n.y }),
      x: m.x + u.x * along + n.x * (h / 2 + 0.15), y: m.y + u.y * along + n.y * (h / 2 + 0.15), flipX: false, flipY: false, opacity: 1,
    };
    if (outsideRooms(ctx, o)) { ctx.f.objects.push(o); return; }
  }
}

// ---------- «наметить форму → оформить» и «раскраска стиля»
/** Угадывает тип комнаты наброска по размеру и форме. */
export function guessType(r: Room, rooms: Room[], style: Style, rnd: Rnd): string {
  const area = roomArea(r), ring = r.poly[0];
  const w = Math.max(...ring.map((p) => p.x)) - Math.min(...ring.map((p) => p.x));
  const h = Math.max(...ring.map((p) => p.y)) - Math.min(...ring.map((p) => p.y));
  if (Math.min(w, h) <= 2.5 && Math.max(w, h) / Math.max(0.1, Math.min(w, h)) >= 2.5) return 'corridor';
  if (area <= 6) return 'bathroom';
  const biggest = rooms.reduce((m, x) => Math.max(m, roomArea(x)), 0);
  if (area >= 40 && area === biggest && rooms.length > 1) return style.hall;
  return weighted(rnd, style.rooms, (x) => x[1])?.[0] ?? style.hall;
}

export function decorate(doc: MapDoc, floorId: string, kit: GenKit, o: DecorateOpts) {
  const f = floorOf(doc, floorId), rnd = makeRnd(o.seed), style = paint(styleById(o.style), o.fill);
  const ids = new Set(o.rooms);
  const rooms = f.rooms.filter((r) => !ids.size || ids.has(r.id));
  if (!rooms.length) return;
  const ctx = makeCtx(doc, f, kit, rnd, o.fill);
  const wall = kit.pick('wall', [pick(rnd, style.walls)]);
  for (const r of rooms) {
    if (!r.type) r.type = guessType(r, rooms, style, rnd);
    if (o.restyle) {
      r.floor = kit.pick('floor', [pick(rnd, style.floors[r.type] ?? style.floors['*'])]);
      r.wall = { ...r.wall, asset: wall, color: style.wallColor };
    }
  }
  if (o.restyle && style.ground && !f.ground) f.ground = kit.pick('floor', [style.ground]);
  const hasEntrance = f.portals.some((p) => p.kind === 'door' && rooms.some((r) => r.poly[0].some((a, i, ring) => onSeg(p.a, a, ring[(i + 1) % ring.length]) && onSeg(p.b, a, ring[(i + 1) % ring.length]))) && isOuterDoor(f, p));
  finish(ctx, rooms, style, o.fill, { doors: o.doors, windows: o.windows, entrances: hasEntrance ? 0 : 1 });
  if (o.fill.lights) doc.lighting.enabled = true;
}

const onSeg = (p: Pt, a: Pt, b: Pt) => {
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const cross = Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / L;
  const t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (L * L);
  return cross < 0.03 && t > -0.01 && t < 1.01;
};
/** Дверь наружу: с одной из сторон нет комнаты. */
function isOuterDoor(f: Floor, p: { a: Pt; b: Pt }) {
  const m = { x: (p.a.x + p.b.x) / 2, y: (p.a.y + p.b.y) / 2 };
  const L = Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y) || 1, n = { x: -(p.b.y - p.a.y) / L, y: (p.b.x - p.a.x) / L };
  const side = (s: number) => f.rooms.some((r) => pointInPoly({ x: m.x + n.x * 0.4 * s, y: m.y + n.y * 0.4 * s }, r.poly));
  return !side(1) || !side(-1);
}

// ---------- здания
/** Делит длину total на k частей не меньше min (целые клетки). */
function splitLine(rnd: Rnd, total: number, k: number, min = 3): number[] {
  k = Math.max(1, Math.min(k, Math.floor(total / min)));
  const out = Array(k).fill(min);
  for (let left = total - min * k; left > 0; left--) out[Math.floor(rnd() * k)]++;
  return out;
}

/** Прямоугольники комнат здания: с коридором посередине или делением пополам (BSP). */
export function buildingRects(rnd: Rnd, r: Rect, n: number, corridor: boolean, hall: boolean): { rect: Rect; kind: 'room' | 'corridor' | 'hall' }[] {
  const W = rw(r), H = rh(r);
  if (corridor && n >= 3 && Math.min(W, H) >= 8) {
    const horiz = W >= H, len = horiz ? W : H, depth = horiz ? H : W;
    const top = Math.max(3, Math.min(depth - 5, Math.floor((depth - 2) / 2) + intBetween(rnd, -1, 1)));
    const nTop = Math.ceil(n / 2), nBot = n - nTop;
    const out: { rect: Rect; kind: 'room' | 'corridor' | 'hall' }[] = [];
    const map = (u0: number, v0: number, u1: number, v1: number): Rect => (horiz
      ? { x0: r.x0 + u0, y0: r.y0 + v0, x1: r.x0 + u1, y1: r.y0 + v1 }
      : { x0: r.x0 + v0, y0: r.y0 + u0, x1: r.x0 + v1, y1: r.y0 + u1 });
    let u = 0;
    for (const w of splitLine(rnd, len, nTop)) { out.push({ rect: map(u, 0, u + w, top), kind: 'room' }); u += w; }
    out.push({ rect: map(0, top, len, top + 2), kind: 'corridor' });
    u = 0;
    for (const w of splitLine(rnd, len, Math.max(1, nBot))) { out.push({ rect: map(u, top + 2, u + w, depth), kind: 'room' }); u += w; }
    return out;
  }
  const leaves: { rect: Rect; kind: 'room' | 'corridor' | 'hall'; lock?: boolean }[] = [{ rect: r, kind: 'room' }];
  let first = true;
  while (leaves.length < n) {
    const cand = leaves.filter((l) => !l.lock && Math.max(rw(l.rect), rh(l.rect)) >= 6).sort((a, b) => rw(b.rect) * rh(b.rect) - rw(a.rect) * rh(a.rect))[0];
    if (!cand) break;
    const R = cand.rect, vert = rw(R) >= rh(R), len = vert ? rw(R) : rh(R);
    const ratio = first && hall ? between(rnd, 0.6, 0.72) : between(rnd, 0.38, 0.62);
    const cut = Math.max(3, Math.min(len - 3, Math.round(len * ratio)));
    const a: Rect = vert ? { ...R, x1: R.x0 + cut } : { ...R, y1: R.y0 + cut };
    const b: Rect = vert ? { ...R, x0: R.x0 + cut } : { ...R, y0: R.y0 + cut };
    leaves.splice(leaves.indexOf(cand), 1, { rect: a, kind: 'room' }, { rect: b, kind: 'room' });
    if (first && hall) { const big = rw(a) * rh(a) >= rw(b) * rh(b) ? leaves[leaves.length - 2] : leaves[leaves.length - 1]; big.kind = 'hall'; big.lock = true; }
    first = false;
  }
  if (hall && leaves.length === 1) leaves[0].kind = 'hall';
  return leaves;
}

/** Комнаты одного здания в прямоугольнике r (без дверей). */
function buildRooms(ctx: Ctx, r: Rect, type: BuildingType, n: number, style: Style): Room[] {
  const b = BUILDINGS[type], rnd = ctx.rnd;
  const wall = ctx.kit.pick('wall', [pick(rnd, style.walls)]);
  const rects = buildingRects(rnd, r, n, b.corridor, !!b.hall);
  const rooms = rects.map(({ rect, kind }) => {
    const t = kind === 'corridor' ? 'corridor' : kind === 'hall' ? b.hall! : weighted(rnd, b.rooms, (x) => x[1])![0];
    return newRoom(ctx.kit, style, rnd, rectToPoly(rect), t, wall);
  });
  ctx.f.rooms.push(...rooms);
  return rooms;
}

export function building(doc: MapDoc, floorId: string, kit: GenKit, o: BuildingOpts) {
  const f = floorOf(doc, floorId), rnd = makeRnd(o.seed);
  if (o.clear) clearFloor(f);
  const style = paint(styleById(o.style === 'auto' ? BUILDINGS[o.type].style : o.style), o.fill);
  const W = Math.max(4, Math.min(doc.width - 2, Math.round(o.width))), H = Math.max(4, Math.min(doc.height - 2, Math.round(o.height)));
  const x0 = Math.floor((doc.width - W) / 2), y0 = Math.floor((doc.height - H) / 2);
  const r = { x0, y0, x1: x0 + W, y1: y0 + H };
  const ctx = makeCtx(doc, f, kit, rnd, o.fill);
  const rooms = buildRooms(ctx, r, o.type, Math.max(1, o.rooms), style);
  if (style.ground && !f.ground) f.ground = kit.pick('floor', [style.ground]);
  finish(ctx, rooms, style, o.fill, { doors: true, windows: true, entrances: rooms.length >= 6 ? 2 : 1 });
  if (o.roof) f.roofs.push({ id: uid('rf'), poly: rectToPoly(r), asset: kit.pick('roof', [pick(rnd, style.roofs)]), color: '#3a3a40' });
  if (o.fill.lights) doc.lighting.enabled = true;
}

// ---------- подземелья
export function dungeon(doc: MapDoc, floorId: string, kit: GenKit, o: DungeonOpts) {
  const f = floorOf(doc, floorId), rnd = makeRnd(o.seed), style = paint(styleById(o.style), o.fill);
  if (o.clear) clearFloor(f);
  const ctx = makeCtx(doc, f, kit, rnd, o.fill);
  const W = doc.width, H = doc.height;
  // комнаты: случайные прямоугольники с зазором не меньше 2 клеток
  const rects: Rect[] = [];
  for (let tries = 0; tries < 400 && rects.length < o.rooms; tries++) {
    const w = intBetween(rnd, 4, Math.min(10, W - 4)), h = intBetween(rnd, 4, Math.min(9, H - 4));
    const x = intBetween(rnd, 1, W - w - 1), y = intBetween(rnd, 1, H - h - 1);
    const r = { x0: x, y0: y, x1: x + w, y1: y + h };
    if (rects.some((q) => r.x0 < q.x1 + 3 && q.x0 < r.x1 + 3 && r.y0 < q.y1 + 3 && q.y0 < r.y1 + 3)) continue;
    rects.push(r);
  }
  if (!rects.length) return;
  const centers = rects.map((r) => ({ x: Math.floor((r.x0 + r.x1) / 2), y: Math.floor((r.y0 + r.y1) / 2) }));
  // коридоры: минимальное остовное дерево по центрам (+ немного петель), Г-образные, ширина 2
  const edges: [number, number][] = [];
  const inTree = new Set([0]);
  while (inTree.size < rects.length) {
    let best: [number, number] | null = null, bd = Infinity;
    for (const i of inTree) for (let j = 0; j < rects.length; j++) {
      if (inTree.has(j)) continue;
      const d = Math.abs(centers[i].x - centers[j].x) + Math.abs(centers[i].y - centers[j].y);
      if (d < bd) { bd = d; best = [i, j]; }
    }
    edges.push(best!);
    inTree.add(best![1]);
  }
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    if (chance(rnd, 0.08) && !edges.some(([a, b]) => (a === i && b === j) || (a === j && b === i))) edges.push([i, j]);
  }
  const corr: Room['poly'][] = [];
  for (const [i, j] of edges) {
    const a = centers[i], b = centers[j], hFirst = chance(rnd, 0.5);
    const knee = hFirst ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
    for (const [p, q] of [[a, knee], [knee, b]] as [Pt, Pt][]) {
      if (p.x === q.x && p.y === q.y) continue;
      corr.push(rectToPoly({ x0: Math.min(p.x, q.x) - 1, y0: Math.min(p.y, q.y) - 1, x1: Math.max(p.x, q.x) + 1, y1: Math.max(p.y, q.y) + 1 }));
    }
  }
  const roomPolys = rects.map(rectToPoly);
  const pieces = corr.length ? union(...corr).flatMap((p) => difference(p, ...roomPolys)) : [];
  const wall = kit.pick('wall', [pick(rnd, style.walls)]);
  const rooms = rects.map((r) => newRoom(kit, style, rnd, rectToPoly(r), weighted(rnd, DUNGEON_ROOMS, (x) => x[1])![0], wall));
  const corridors = pieces.filter((p) => Math.abs(polyArea(p)) >= 1.5).map((p) => newRoom(kit, style, rnd, p, 'corridor', wall));
  f.rooms.push(...rooms, ...corridors);
  const all = [...rooms, ...corridors];
  // вход — лестница наверх у стены одной из комнат
  const stairs = kit.entryOf('canon:objects/stairs/stairs.svg') ? 'canon:objects/stairs/stairs.svg' : null;
  if (stairs) {
    const r = pick(rnd, rooms), e = kit.entryOf(stairs)!;
    const ring = r.poly[0], p = { x: ring[0].x + 1, y: ring[0].y + 0.6 };
    const pl = placeAtWall({ ...f, rooms: [r] }, p, e.footprint[0], e.footprint[1], 0, normRules({ place: 'wall' }), true);
    if (pl) f.objects.push({ id: uid('o'), asset: stairs, layer: ctx.layers.objects, x: pl.x, y: pl.y, w: e.footprint[0], h: e.footprint[1], rot: pl.rot, flipX: false, flipY: false, opacity: 1 });
  }
  finish(ctx, all, style, o.fill, { doors: true, windows: false, entrances: 0, loops: 1 });
  if (o.fill.lights) doc.lighting.enabled = true;
}

const polyArea = (p: Room['poly']) => p.reduce((s, ring, i) => {
  let a = 0;
  for (let k = 0; k < ring.length; k++) { const q = ring[k], w = ring[(k + 1) % ring.length]; a += q.x * w.y - w.x * q.y; }
  return s + (i === 0 ? Math.abs(a / 2) : -Math.abs(a / 2));
}, 0);

// ---------- улицы Задворок
const STREET_BUILDINGS: [BuildingType, number][] = [['house', 4], ['bar', 1], ['workshop', 1], ['warehouse', 1], ['shop', 1.5], ['clinic', 0.5], ['hideout', 1]];

export function streets(doc: MapDoc, floorId: string, kit: GenKit, o: StreetsOpts) {
  const f = floorOf(doc, floorId), rnd = makeRnd(o.seed), style = paint(styleById(o.style), o.fill);
  if (o.clear) clearFloor(f);
  const ctx = makeCtx(doc, f, kit, rnd, o.fill);
  const condition = conditionOf(o.fill, style);
  const W = doc.width, H = doc.height;
  const maxB = Math.max(8, o.block), minB = Math.max(5, Math.round(o.block * 0.45));
  const blocks: Rect[] = [];
  const roads: { a: Pt; b: Pt; width: number; main: boolean; depth: number }[] = [];
  const split = (r: Rect, depth: number) => {
    const w = rw(r), h = rh(r);
    const main = depth < 2, road = main ? 3 : 2;
    const canV = w >= 2 * minB + road, canH = h >= 2 * minB + road;
    if ((w <= maxB && h <= maxB) || (!canV && !canH)) { blocks.push(r); return; }
    const vert = canV && (w >= h || !canH);
    const lo = (vert ? r.x0 : r.y0) + minB, hi = (vert ? r.x1 : r.y1) - minB - road;
    const pos = Math.round(between(rnd, lo, hi));
    if (vert) {
      roads.push({ a: { x: pos + road / 2, y: r.y0 }, b: { x: pos + road / 2, y: r.y1 }, width: road, main, depth });
      split({ ...r, x1: pos }, depth + 1); split({ ...r, x0: pos + road }, depth + 1);
    } else {
      roads.push({ a: { x: r.x0, y: pos + road / 2 }, b: { x: r.x1, y: pos + road / 2 }, width: road, main, depth });
      split({ ...r, y1: pos }, depth + 1); split({ ...r, y0: pos + road }, depth + 1);
    }
  };
  split({ x0: 0, y0: 0, x1: W, y1: H }, 0);
  // дороги, переулки и разметка
  const asphalt = kit.pick('floor', ['canon:floors/asphalt.svg']), concrete = kit.pick('floor', ['canon:floors/concrete.svg']);
  // сначала глубокие (короткие) улицы, потом те, к которым они примыкают, — скруглённые концы прячутся под перекрёстком
  const order = [...roads].sort((a, b) => b.depth - a.depth);
  for (const r of order) {
    const style2 = r.main ? { ...DEFAULT_PATH, width: r.width, asset: asphalt } : { ...DEFAULT_PATH, width: r.width, asset: concrete, color: '#3a3a3c', outline: '#1a1a1c' };
    f.paths.push({ id: uid('pa'), layer: ctx.layers.decor, points: [r.a, r.b], smooth: false, closed: false, style: style2 });
  }
  for (const r of order) {
    if (r.main) f.paths.push({ id: uid('pa'), layer: ctx.layers.decor, points: [r.a, r.b], smooth: false, closed: false, style: { ...DEFAULT_PATH, width: 0.12, asset: null, color: '#e8e1d2', outline: null, dash: 0.8 } });
  }
  if (!f.ground && style.ground) f.ground = kit.pick('floor', [style.ground]);
  const allRooms: Room[] = [];
  for (const b of shuffle(rnd, blocks)) {
    const inner = { x0: b.x0 + 1, y0: b.y0 + 1, x1: b.x1 - 1, y1: b.y1 - 1 };
    if (rw(inner) < 3 || rh(inner) < 3) continue;
    if (!o.buildings || chance(rnd, o.plazas)) { plaza(ctx, b, condition); continue; }
    // участки вдоль длинной стороны квартала, между ними — переулки шириной в клетку
    const vert = rw(inner) >= rh(inner), len = vert ? rw(inner) : rh(inner);
    const k = Math.max(1, Math.min(3, Math.round(len / between(rnd, 7, 11))));
    const widths = splitLine(rnd, len - (k - 1), k, 4);
    let u = 0;
    widths.forEach((w, i) => {
      const lot: Rect = vert ? { ...inner, x0: inner.x0 + u, x1: inner.x0 + u + w } : { ...inner, y0: inner.y0 + u, y1: inner.y0 + u + w };
      u += w + 1;
      if (i < widths.length - 1) {
        const g = vert ? lot.x1 + 0.5 : lot.y1 + 0.5;
        const pts = vert ? [{ x: g, y: b.y0 }, { x: g, y: b.y1 }] : [{ x: b.x0, y: g }, { x: b.x1, y: g }];
        f.paths.push({ id: uid('pa'), layer: ctx.layers.decor, points: pts, smooth: false, closed: false, style: { ...DEFAULT_PATH, width: 1, asset: kit.pick('terrain', ['canon:terrain/dirt.svg']), color: '#3b3128', outline: null } });
      }
      const type = weighted(rnd, STREET_BUILDINGS, (x) => x[1])![0];
      const bStyle = paint(styleById(BUILDINGS[type].style === 'wing' ? o.style : BUILDINGS[type].style), o.fill);
      const n = Math.max(1, Math.min(5, Math.round((rw(lot) * rh(lot)) / 18)));
      const rooms = buildRooms(ctx, lot, type, n, bStyle);
      allRooms.push(...rooms);
      const c = { x: (lot.x0 + lot.x1) / 2, y: (lot.y0 + lot.y1) / 2 };
      finish(ctx, rooms, bStyle, { ...o.fill, condition: o.fill.condition === 'style' ? condition : o.fill.condition }, { doors: true, windows: true, entrances: 1, toward: towardStreet(b, c, W, H), signChance: 0.4 });
      if (o.roofs) f.roofs.push({ id: uid('rf'), poly: rectToPoly(lot), asset: kit.pick('roof', [pick(rnd, bStyle.roofs)]), color: '#3a3a40' });
    });
  }
  streetProps(ctx, roads, o.fill);
  if (o.fill.cover > 0) placeCover(ctx, null, Math.round((W * H) / 120 * o.fill.cover), condition);
  if (o.fill.weather) weather(ctx, null, condition, { x0: 0, y0: 0, x1: W, y1: H });
  if (o.fill.lights) { doc.lighting.enabled = true; doc.lighting.darkness = Math.max(doc.lighting.darkness, 0.6); }
}

/** Ближайшая к центру участка точка края квартала, выходящего на улицу (не край карты). */
function towardStreet(b: Rect, c: Pt, W: number, H: number): Pt {
  const opts: Pt[] = [];
  if (b.x0 > 0) opts.push({ x: b.x0, y: c.y });
  if (b.x1 < W) opts.push({ x: b.x1, y: c.y });
  if (b.y0 > 0) opts.push({ x: c.x, y: b.y0 });
  if (b.y1 < H) opts.push({ x: c.x, y: b.y1 });
  if (!opts.length) return c;
  return opts.reduce((m, p) => (Math.hypot(p.x - c.x, p.y - c.y) < Math.hypot(m.x - c.x, m.y - c.y) ? p : m));
}

/** Площадь: мощение мазками плитки, фонари, скамейки, урны. */
function plaza(ctx: Ctx, b: Rect, condition: Condition) {
  const tiles = ctx.kit.pick('floor', ['canon:floors/tiles.svg']);
  const inner = { x0: b.x0 + 0.5, y0: b.y0 + 0.5, x1: b.x1 - 0.5, y1: b.y1 - 0.5 };
  if (tiles) {
    const rows = Math.max(1, Math.ceil(rh(inner) / 4)), size = rh(inner) / rows + 0.4;
    for (let i = 0; i < rows; i++) {
      const y = inner.y0 + (i + 0.5) * (rh(inner) / rows);
      ctx.f.terrain.push({ id: uid('t'), asset: tiles, size, softness: 0.15, opacity: 0.95, points: [{ x: inner.x0 + size / 2, y }, { x: Math.max(inner.x0 + size / 2, inner.x1 - size / 2), y }] });
    }
  }
  const cands = ctx.kit.objects.filter((c) => c.rules.where === 'outside' && c.kind === 'asset' && c.entry.footprint[0] * c.entry.footprint[1] <= 2);
  const n = Math.round(rw(inner) * rh(inner) * 0.03);
  for (let i = 0, fails = 0; i < n && fails < 20;) {
    const c = pick(ctx.rnd, cands.length ? cands : [null]);
    if (!c || c.kind !== 'asset') return;
    const e = c.entry, rot = pick(ctx.rnd, [0, 90, 180, 270]);
    const x = Math.round(between(ctx.rnd, inner.x0 + 1, inner.x1 - 1) * 2) / 2, y = Math.round(between(ctx.rnd, inner.y0 + 1, inner.y1 - 1) * 2) / 2;
    const ob = { id: uid('o'), asset: pick(ctx.rnd, c.variants), layer: ctx.layers.objects, x, y, w: e.footprint[0], h: e.footprint[1], rot, flipX: false, flipY: false, opacity: 1 };
    const solid = ctx.f.objects.some((q) => Math.hypot(q.x - x, q.y - y) < 1.6);
    if (!solid) { ctx.f.objects.push(ob); lampLight(ctx, ob); i++; } else fails++;
  }
  void condition;
}

function lampLight(ctx: Ctx, o: { asset: string; x: number; y: number }) {
  if (!ctx.kit.entryOf(o.asset)?.tags.includes('lamp')) return;
  ctx.f.lights.push({ id: uid('li'), x: o.x, y: o.y, radius: 6, color: '#ffd9a0', intensity: 0.9, shadows: true });
}

/** Вдоль дорог: фонари, скамейки, урны, гидранты, машины на главных улицах. */
function streetProps(ctx: Ctx, roads: { a: Pt; b: Pt; width: number; main: boolean; depth: number }[], fill: Fill) {
  const cands = ctx.kit.objects.filter((c) => c.rules.place === 'road');
  if (!cands.length || !fill.furnish) return;
  const rnd = ctx.rnd;
  for (const r of roads) {
    const L = Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y), u = { x: (r.b.x - r.a.x) / L, y: (r.b.y - r.a.y) / L }, n = { x: -u.y, y: u.x };
    let t = between(rnd, 2, 5), side = chance(rnd, 0.5) ? 1 : -1;
    while (t < L - 2) {
      const list = cands.filter((c) => r.main || !(c.kind === 'asset' && Math.max(...c.entry.footprint) >= 3));
      const c = weighted(rnd, list, (x) => (x.kind === 'asset' && x.entry.tags.includes('lamp') ? 3 : 1) * x.rules.weight);
      if (!c) break;
      const p = { x: r.a.x + u.x * t + n.x * side * (r.width / 2 + 0.8), y: r.a.y + u.y * t + n.y * side * (r.width / 2 + 0.8) };
      const objs = placeRoadside(ctx, c, p, Math.atan2(u.y, u.x) * 180 / Math.PI);
      if (objs) for (const o of objs) lampLight(ctx, o);
      t += between(rnd, 5, 9) / Math.max(0.3, fill.density);
      side = -side;
    }
  }
}

function placeRoadside(ctx: Ctx, c: GenKit['objects'][number], p: Pt, roadAngle: number) {
  if (c.kind !== 'asset') return null;
  const e = c.entry, key = pick(ctx.rnd, c.variants);
  const rules = c.rules;
  // без автоповорота (машины) — вдоль дороги
  const rot = rules.face ? 0 : ((Math.round(roadAngle / 90) * 90) % 360 + 360) % 360;
  const pl = placeAtRoad(ctx.f, p, e.footprint[0], e.footprint[1], rot, rules);
  if (!pl) return null;
  const tint = rules.tint.length ? pick(ctx.rnd, rules.tint) : null;
  const o = { id: uid('o'), asset: key, layer: ctx.layers.objects, x: pl.x, y: pl.y, w: e.footprint[0], h: e.footprint[1], rot: pl.rot, flipX: false, flipY: false, opacity: 1, ...(tint ? { tint } : {}) };
  const near = ctx.f.objects.some((q) => Math.hypot(q.x - o.x, q.y - o.y) < Math.max(o.w, o.h, q.w, q.h) / 2 + 0.8);
  if (near || !outsideRooms(ctx, o)) return null;
  ctx.f.objects.push(o);
  return [o];
}
