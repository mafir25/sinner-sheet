// Расстановка содержимого по правилам наборов (§5): мебель и комплекты, укрытия, ловушки,
// следы состояния (грязь, трещины, мусор) и свет. Всё случайное — только через rnd (зерно).
import type { AssetKey, Floor, GridType, MapObject, Pt, Room, TerrainStroke } from '../model/types';
import { uid } from '../model/doc';
import { snapCenter } from '../geom/grid';
import { pointInPoly, ringArea, segDist } from '../geom/poly';
import { blocksDoor, boxesOverlap, checkObject, corners, placeByRules, roomCenter, rollVariation, rotFacing } from '../geom/place';
import { matchTarget, setBounds } from '../assets/tree.js';
import { type Cand, type Condition, type GenKit, ROOM_PROFILE } from './kit';
import { type Rnd, between, chance, intBetween, pick, weighted } from './rng';

export type GenLayers = { objects: string; above: string; decor: string; traps: string };
export type Ctx = { f: Floor; kit: GenKit; rnd: Rnd; grid: GridType; layers: GenLayers; district?: string; width: number; height: number };

export function roomArea(r: Room): number {
  return Math.abs(ringArea(r.poly[0])) - r.poly.slice(1).reduce((s, h) => s + Math.abs(ringArea(h)), 0);
}

/** Точка внутри комнаты (или прямоугольника карты, если room = null). */
function randomInside(ctx: Ctx, room: Room | null, area?: { x0: number; y0: number; x1: number; y1: number }): Pt | null {
  const ring = room?.poly[0];
  const b = area ?? (ring ? {
    x0: Math.min(...ring.map((p) => p.x)), x1: Math.max(...ring.map((p) => p.x)),
    y0: Math.min(...ring.map((p) => p.y)), y1: Math.max(...ring.map((p) => p.y)),
  } : { x0: 0, y0: 0, x1: ctx.width, y1: ctx.height });
  for (let i = 0; i < 30; i++) {
    const p = { x: between(ctx.rnd, b.x0, b.x1), y: between(ctx.rnd, b.y0, b.y1) };
    if (!room || pointInPoly(p, room.poly)) return p;
  }
  return null;
}

const contains = (o: MapObject, p: Pt, pad = -0.02) => {
  const a = (-o.rot * Math.PI) / 180, dx = p.x - o.x, dy = p.y - o.y;
  const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(lx) < o.w / 2 + pad && Math.abs(ly) < o.h / 2 + pad;
};

/** Объект целиком в комнате и не залезает в стены. */
export function insideRoom(o: MapObject, room: Room): boolean {
  const half = room.wall.width / 2 - 0.03;
  for (const c of corners(o)) {
    if (!pointInPoly(c, room.poly)) return false;
    for (const ring of room.poly) for (let i = 0; i < ring.length; i++) if (segDist(c, ring[i], ring[(i + 1) % ring.length]).d < half) return false;
  }
  for (const ring of room.poly) for (const v of ring) if (contains(o, v)) return false;
  return true;
}

/** Снаружи всех комнат и в пределах карты. */
export function outsideRooms(ctx: Ctx, o: MapObject): boolean {
  for (const c of corners(o)) {
    if (c.x < 0 || c.y < 0 || c.x > ctx.width || c.y > ctx.height) return false;
    if (ctx.f.rooms.some((r) => pointInPoly(c, r.poly))) return false;
  }
  return !ctx.f.rooms.some((r) => r.poly[0].some((v) => contains(o, v)) || pointInPoly(o, r.poly));
}

const isSolid = (ctx: Ctx, o: MapObject) => {
  const t = ctx.kit.entryOf(o.asset)?.tags ?? [];
  return !t.includes('debris') && !t.includes('trap') && o.layer !== ctx.layers.decor;
};
const shrink = (o: MapObject, d = 0.05) => ({ ...o, w: Math.max(0.01, o.w - d), h: Math.max(0.01, o.h - d) });
function collides(ctx: Ctx, objs: MapObject[]): boolean {
  const solid = ctx.f.objects.filter((o) => isSolid(ctx, o));
  for (let i = 0; i < objs.length; i++) {
    const a = shrink(objs[i]);
    if (solid.some((b) => boxesOverlap(a, shrink(b)))) return true;
    for (let j = 0; j < i; j++) if (boxesOverlap(a, shrink(objs[j]))) return true;
  }
  return false;
}

/** Точка-подсказка для правила позиции: у случайной стены, в углу, в центре или где угодно. */
function sample(ctx: Ctx, room: Room, c: Cand): Pt | null {
  const ring = room.poly[0], rnd = ctx.rnd;
  switch (c.rules.place) {
    case 'wall': {
      const edges = ring.map((a, i) => ({ a, b: ring[(i + 1) % ring.length] }));
      const e = weighted(rnd, edges, (x) => Math.hypot(x.b.x - x.a.x, x.b.y - x.a.y));
      if (!e) return null;
      const L = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y), u = { x: (e.b.x - e.a.x) / L, y: (e.b.y - e.a.y) / L };
      const t = rnd() * L, q = { x: e.a.x + u.x * t, y: e.a.y + u.y * t };
      let n = { x: -u.y, y: u.x };
      if (!pointInPoly({ x: q.x + n.x * 0.3, y: q.y + n.y * 0.3 }, room.poly)) n = { x: -n.x, y: -n.y };
      return { x: q.x + n.x * 0.4, y: q.y + n.y * 0.4 };
    }
    case 'corner': {
      const v = pick(rnd, ring), m = roomCenter(room);
      const d = Math.hypot(m.x - v.x, m.y - v.y) || 1;
      return { x: v.x + ((m.x - v.x) / d) * 0.6, y: v.y + ((m.y - v.y) / d) * 0.6 };
    }
    case 'center': return roomCenter(room);
    default: return randomInside(ctx, room);
  }
}

/** Цели правила «рядом с» в этой комнате (стол для стула). */
function nearTargets(ctx: Ctx, room: Room, c: Cand): MapObject[] {
  if (!c.rules.near.length) return [];
  const dir = c.kind === 'asset' ? c.entry.dir : c.set.dir;
  return ctx.f.objects.filter((o) => {
    const e = ctx.kit.entryOf(o.asset);
    return !!e && pointInPoly(o, room.poly) && c.rules.near.some((n) => matchTarget(n.to, e, dir));
  });
}

/** Объекты кандидата у точки p: правило позиции, вариации, комплект — целиком. */
function make(ctx: Ctx, c: Cand, room: Room | null, p: Pt, faceFrom?: Pt): MapObject[] | null {
  const r = c.rules, rnd = ctx.rnd;
  const roll = rollVariation(r, rnd);
  const one = room ? { ...ctx.f, rooms: [room], walls: [], paths: [] } : ctx.f;
  const layerOf = (above: boolean) => (above ? ctx.layers.above : ctx.layers.objects);
  const place = (w: number, h: number): { x: number; y: number; rot: number } | null => {
    let rot = roll.rot;
    if (r.place !== 'free') {
      const pl = placeByRules(one, p, w, h, rot, r, true);
      return pl ? { x: pl.x, y: pl.y, rot: pl.rot } : null;
    }
    if (faceFrom) rot = rotFacing({ x: p.x - faceFrom.x, y: p.y - faceFrom.y });
    if (faceFrom) rot = Math.round(rot / 90) * 90 % 360;
    const q = snapCenter(ctx.grid, p, w, h, rot);
    return { x: q.x, y: q.y, rot };
  };
  if (c.kind === 'asset') {
    const key = pick(rnd, c.variants);
    const e = ctx.kit.entryOf(key) ?? c.entry;
    const w = e.footprint[0] * roll.scale, h = e.footprint[1] * roll.scale;
    const at = place(w, h);
    if (!at) return null;
    return [{
      id: uid('o'), asset: key, layer: layerOf(e.layer === 'above'), x: at.x, y: at.y, w, h, rot: at.rot,
      flipX: roll.flip, flipY: false, opacity: 1, ...(roll.tint ? { tint: roll.tint } : {}),
    }];
  }
  const fp = new Map(c.items.map((it) => [it.path, it.entry.footprint]));
  const b = setBounds(c.set, (path) => fp.get(path));
  const at = place(b.w, b.h);
  if (!at) return null;
  const a = (at.rot * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  return c.items.map((it) => {
    let lx = it.x - b.cx, irot = it.rot, iflip = it.flip;
    const ly = it.y - b.cy;
    if (roll.flip) { lx = -lx; irot = -irot; iflip = !iflip; }
    return {
      id: uid('o'), asset: it.key, layer: layerOf(it.entry.layer === 'above'),
      x: at.x + lx * cos - ly * sin, y: at.y + lx * sin + ly * cos, w: it.entry.footprint[0] * it.scale, h: it.entry.footprint[1] * it.scale,
      rot: (((irot + at.rot) % 360) + 360) % 360, flipX: iflip, flipY: false, opacity: 1,
    };
  });
}

function valid(ctx: Ctx, objs: MapObject[], room: Room | null, opts: { doors?: boolean; solid?: boolean } = {}): boolean {
  for (const o of objs) {
    if (room ? !insideRoom(o, room) : !outsideRooms(ctx, o)) return false;
    if (opts.doors !== false && blocksDoor(ctx.f, o)) return false;
  }
  if (opts.solid !== false && collides(ctx, objs)) return false;
  const f = { ...ctx.f, objects: [...ctx.f.objects, ...objs] };
  return objs.every((o) => checkObject(f, o, ctx.kit.entryOf).length === 0);
}

function tryPlace(ctx: Ctx, c: Cand, room: Room | null, tries = 12): MapObject[] | null {
  for (let k = 0; k < tries; k++) {
    let p: Pt | null, faceFrom: Pt | undefined;
    const targets = room ? nearTargets(ctx, room, c) : [];
    if (c.rules.near.length && c.rules.place === 'free') {
      if (!targets.length) return null;
      const t = pick(ctx.rnd, targets);
      const d = pick(ctx.rnd, [[1, 0], [-1, 0], [0, 1], [0, -1]]);
      const size = c.kind === 'asset' ? Math.max(...c.entry.footprint) : 1;
      const reach = (Math.abs(d[0]) * t.w + Math.abs(d[1]) * t.h) / 2 + size / 2 + ctx.rnd() * Math.min(0.5, c.rules.near[0].dist);
      p = { x: t.x + d[0] * reach + (d[1] ? between(ctx.rnd, -t.w / 3, t.w / 3) : 0), y: t.y + d[1] * reach + (d[0] ? between(ctx.rnd, -t.h / 3, t.h / 3) : 0) };
      faceFrom = t;
    } else p = room ? sample(ctx, room, c) : randomInside(ctx, null);
    if (!p) continue;
    const objs = make(ctx, c, room, p, faceFrom);
    if (objs && valid(ctx, objs, room)) { ctx.f.objects.push(...objs); return objs; }
  }
  return null;
}

/** Подходит ли кандидат к комнате данного типа, состоянию и району. */
function fits(c: Cand, type: string | undefined, condition: Condition, district?: string, outside = false): boolean {
  const r = c.rules;
  if (outside ? r.where === 'inside' : r.where === 'outside' || r.place === 'road') return false;
  if (!outside && r.rooms.length && !(type && r.rooms.includes(type))) return false;
  if (r.state.length && !r.state.includes(condition)) return false;
  if (r.districts.length && district && !r.districts.includes(district)) return false;
  return true;
}

const tagsOf = (c: Cand) => (c.kind === 'asset' ? c.entry.tags : c.items.flatMap((i) => i.entry.tags));

/** Мебель и прочее содержимое комнаты по её типу. density — множитель плотности. */
export function furnishRoom(ctx: Ctx, room: Room, condition: Condition, density = 1) {
  const type = room.type;
  const prof = ROOM_PROFILE[type ?? ''] ?? { density: 0.07 };
  const cands = ctx.kit.objects.filter((c) => fits(c, type, condition, ctx.district));
  if (!cands.length) return;
  const count = new Map<string, number>();
  const weight = (c: Cand) => {
    const boost = tagsOf(c).reduce((s, t) => s + (prof.boost?.[t] ?? 0), 0);
    return c.rules.weight * (1 + boost) * (c.kind === 'set' ? 1.5 : 1);
  };
  const add = (c: Cand) => {
    const objs = tryPlace(ctx, c, room);
    if (objs) count.set(c.key, (count.get(c.key) ?? 0) + 1);
    return objs;
  };
  for (const c of cands) for (let i = 0; i < c.rules.min; i++) add(c);
  const budget = Math.round(roomArea(room) * prof.density * density * between(ctx.rnd, 0.8, 1.2) * (condition === 'ruined' ? 0.7 : 1));
  let placed = 0, fails = 0;
  while (placed < budget && fails < 25) {
    const avail = cands.filter((c) => (!c.rules.max || (count.get(c.key) ?? 0) < c.rules.max) && (!c.rules.near.length || c.rules.place !== 'free' || nearTargets(ctx, room, c).length));
    const c = weighted(ctx.rnd, avail, weight);
    if (!c) break;
    const objs = add(c);
    if (objs) placed += objs.length; else fails++;
  }
}

/** Укрытия: ящики, бочки, баррикады — в комнате или на улице (room = null). */
export function placeCover(ctx: Ctx, room: Room | null, n: number, condition: Condition) {
  const cands = ctx.kit.cover.filter((c) => fits(c, room?.type, condition, ctx.district, !room));
  for (let i = 0, fails = 0; i < n && fails < 15;) {
    const c = pick(ctx.rnd, cands.length ? cands : [null]);
    if (!c) return;
    const free: Cand = { ...c, rules: { ...c.rules, place: 'free', near: [] } } as Cand;
    if (tryPlace(ctx, free, room, 6)) i++; else fails++;
  }
}

/** Ловушки на отдельном слое «только для мастера»; любят проходы у дверей и коридоры. */
export function placeTraps(ctx: Ctx, room: Room, n: number) {
  if (!ctx.kit.traps.length) return;
  for (let i = 0, fails = 0; i < n && fails < 12;) {
    const c = pick(ctx.rnd, ctx.kit.traps);
    const roll = rollVariation(c.rules, ctx.rnd);
    const key = c.kind === 'asset' ? pick(ctx.rnd, c.variants) : c.key;
    const e = ctx.kit.entryOf(key);
    const doors = ctx.f.portals.filter((d) => d.kind === 'door' && room.poly[0].some((_, k, ring) => segDist({ x: (d.a.x + d.b.x) / 2, y: (d.a.y + d.b.y) / 2 }, ring[k], ring[(k + 1) % ring.length]).d < 0.05));
    let p = randomInside(ctx, room);
    if (doors.length && chance(ctx.rnd, 0.5)) {
      const d = pick(ctx.rnd, doors), m = { x: (d.a.x + d.b.x) / 2, y: (d.a.y + d.b.y) / 2 };
      const c2 = roomCenter(room), L = Math.hypot(c2.x - m.x, c2.y - m.y) || 1;
      p = { x: m.x + ((c2.x - m.x) / L) * 1.1, y: m.y + ((c2.y - m.y) / L) * 1.1 };
    }
    if (!p || !e) { fails++; continue; }
    const q = snapCenter(ctx.grid, p, e.footprint[0], e.footprint[1], 0);
    const o: MapObject = { id: uid('o'), asset: key, layer: ctx.layers.traps, x: q.x, y: q.y, w: e.footprint[0] * roll.scale, h: e.footprint[1] * roll.scale, rot: roll.rot, flipX: roll.flip, flipY: false, opacity: 1 };
    if (insideRoom(o, room) && !collides(ctx, [o])) { ctx.f.objects.push(o); i++; } else fails++;
  }
}

/** Мазок местности внутри комнаты (или на улице): случайная короткая линия. */
function stroke(ctx: Ctx, asset: AssetKey, room: Room | null, size: number, opacity: number, area?: { x0: number; y0: number; x1: number; y1: number }): TerrainStroke | null {
  const start = randomInside(ctx, room, area);
  if (!start) return null;
  const pts = [start];
  for (let i = intBetween(ctx.rnd, 1, 3); i > 0; i--) {
    const last = pts[pts.length - 1], a = ctx.rnd() * Math.PI * 2;
    const next = { x: last.x + Math.cos(a) * size * 0.7, y: last.y + Math.sin(a) * size * 0.7 };
    if (room && !pointInPoly(next, room.poly)) break;
    pts.push(next);
  }
  return { id: uid('t'), asset, size, softness: 0.7, opacity, points: pts };
}

/** Следы состояния: потёртое — грязь и бумаги, разрушенное — трещины, обломки, кровь. */
export function weather(ctx: Ctx, room: Room | null, condition: Condition, area?: { x0: number; y0: number; x1: number; y1: number }) {
  if (condition === 'new') return;
  const sq = room ? roomArea(room) : area ? (area.x1 - area.x0) * (area.y1 - area.y0) : ctx.width * ctx.height;
  const dims = room ? Math.sqrt(sq) : 6;
  const terr = condition === 'ruined' ? ['canon:terrain/cracks.svg', 'canon:terrain/debris.svg', 'canon:terrain/dirt.svg', 'canon:terrain/blood.svg'] : ['canon:terrain/dirt.svg', 'canon:terrain/oil.svg'];
  const strokes = Math.max(1, Math.round(sq / (condition === 'ruined' ? 25 : 45)));
  for (let i = 0; i < strokes; i++) {
    const key = ctx.kit.pick('terrain', [pick(ctx.rnd, terr)]);
    if (!key) break;
    const s = stroke(ctx, key, room, between(ctx.rnd, 1, Math.max(1.2, Math.min(3, dims * 0.5))), condition === 'ruined' ? between(ctx.rnd, 0.5, 0.85) : between(ctx.rnd, 0.3, 0.55), area);
    if (s) ctx.f.terrain.push(s);
  }
  const debris = ctx.kit.debris.filter((c) => !c.rules.state.length || c.rules.state.includes(condition));
  if (!debris.length) return;
  const n = Math.round(sq * (condition === 'ruined' ? 0.04 : 0.012) * between(ctx.rnd, 0.6, 1.4));
  for (let i = 0; i < n; i++) {
    const c = pick(ctx.rnd, debris);
    const p = randomInside(ctx, room, area);
    if (!p) continue;
    const objs = make(ctx, { ...c, rules: { ...c.rules, place: 'free' } } as Cand, room, p);
    if (!objs) continue;
    for (const o of objs) o.layer = ctx.layers.decor;
    if (objs.every((o) => (room ? insideRoom(o, room) : outsideRooms(ctx, o)))) ctx.f.objects.push(...objs);
  }
}

/** Свет: лампа в центре комнаты (в больших — ещё одна). */
export function lightRoom(ctx: Ctx, room: Room, color: string) {
  const area = roomArea(room);
  let c = roomCenter(room);
  if (!pointInPoly(c, room.poly)) c = randomInside(ctx, room) ?? c;
  const radius = Math.max(4, Math.min(10, Math.sqrt(area) * 0.9 + 2));
  ctx.f.lights.push({ id: uid('li'), x: Math.round(c.x * 2) / 2, y: Math.round(c.y * 2) / 2, radius, color, intensity: 0.85, shadows: true });
  if (area > 90) {
    const p = randomInside(ctx, room);
    if (p) ctx.f.lights.push({ id: uid('li'), x: Math.round(p.x * 2) / 2, y: Math.round(p.y * 2) / 2, radius: radius * 0.8, color, intensity: 0.75, shadows: true });
  }
}
