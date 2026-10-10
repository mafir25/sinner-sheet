// Стены этажа: рёбра комнат + отдельные стены, разрезанные проёмами (двери, окна).
import type { FaceDir, Floor, Portal, Pt, Room, WallStyle } from '../model/types';
import { pointInPoly, segDist } from './poly';

export type WallSeg = { a: Pt; b: Pt; style: WallStyle };
/** Контур стены: кольцо комнаты или отдельная стена. */
export type WallPath = { pts: Pt[]; closed: boolean; style: WallStyle; room?: Room };
/**
 * Непрерывная ломаная стены между проёмами. capStart/capEnd — конец является торцом отдельной стены
 * (продлевается на полтолщины), а не краем проёма. Углы внутри цепочки рисуются стыком (miter).
 */
export type WallChain = { pts: Pt[]; closed: boolean; style: WallStyle; capStart: boolean; capEnd: boolean; room?: Room };

const ON_LINE = 0.03;
const touch = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

const near = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4;

/** Стиль ребра комнаты a→b: свой (настроен у отдельной стены комнаты) или общий стиль комнаты. */
export function edgeStyle(room: Room, a: Pt, b: Pt): WallStyle {
  const o = room.edgeStyles?.find((e) => (near(e.a, a) && near(e.b, b)) || (near(e.a, b) && near(e.b, a)));
  return o ? { ...room.wall, ...o.style } : room.wall;
}

/** Кольцо комнаты → контуры: целиком (одинаковые стены) или кусками с одинаковым стилем. */
function ringPaths(room: Room, ring: Pt[]): WallPath[] {
  const n = ring.length;
  const styles = ring.map((p, i) => edgeStyle(room, p, ring[(i + 1) % n]));
  if (styles.every((st) => st === room.wall)) return [{ pts: ring, closed: true, style: room.wall, room }];
  const key = styles.map((st) => JSON.stringify(st));
  // начинаем с ребра, где стиль меняется, — тогда куски не разрываются на стыке начала кольца
  let k = key.findIndex((x, i) => x !== key[(i - 1 + n) % n]);
  if (k < 0) return [{ pts: ring, closed: true, style: styles[0], room }];
  const out: WallPath[] = [];
  let cur: Pt[] = [ring[k]], st = styles[k];
  for (let j = 0; j < n; j++) {
    const i = (k + j) % n;
    if (key[i] !== JSON.stringify(st)) { out.push({ pts: cur, closed: false, style: st, room }); cur = [ring[i]]; st = styles[i]; }
    cur.push(ring[(i + 1) % n]);
  }
  out.push({ pts: cur, closed: false, style: st, room });
  return out;
}

export function floorPaths(f: Floor): WallPath[] {
  const out: WallPath[] = [];
  for (const room of f.rooms) for (const ring of room.poly) out.push(...ringPaths(room, ring));
  for (const w of f.walls) out.push({ pts: w.points, closed: w.closed && w.points.length > 2, style: w.wall });
  return out;
}

const pathSegs = (p: WallPath): WallSeg[] => {
  const n = p.pts.length, out: WallSeg[] = [];
  for (let i = 0; i < (p.closed ? n : n - 1); i++) out.push({ a: p.pts[i], b: p.pts[(i + 1) % n], style: p.style });
  return out;
};

export const floorSegments = (f: Floor): WallSeg[] => floorPaths(f).flatMap(pathSegs);

/** Участок отрезка [t0, t1] (в длинах), который занимает проём, или null, если проём не на этом отрезке. */
function portalSpan(seg: WallSeg, p: Portal): [number, number] | null {
  const L = Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y);
  if (L < 1e-6) return null;
  const da = segDist(p.a, seg.a, seg.b), db = segDist(p.b, seg.a, seg.b);
  if (da.d > ON_LINE || db.d > ON_LINE) return null;
  const t0 = Math.min(da.t, db.t) * L, t1 = Math.max(da.t, db.t) * L;
  return t1 - t0 > 0.02 ? [t0, t1] : null;
}

/**
 * Стены этажа, разрезанные проёмами указанных видов, — непрерывными ломаными. Проёмы без стены (gap) режут всегда,
 * пустые проёмы (без картинки — арка, вырез) — если openEmpty (для света и взгляда; верхнюю линию стены — нет).
 */
export function wallChains(f: Floor, gapKinds: Set<Portal['kind']> = new Set(['door', 'window']), openEmpty = true): WallChain[] {
  const portals = f.portals.filter((p) => p.kind === 'gap' || (openEmpty && !p.asset) || gapKinds.has(p.kind));
  const out: WallChain[] = [];
  for (const path of floorPaths(f)) {
    // куски отрезков; joinA/joinB — конец лежит в вершине контура (а не на краю проёма)
    const pieces: { a: Pt; b: Pt; joinA: boolean; joinB: boolean }[] = [];
    for (const seg of pathSegs(path)) {
      const L = Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y);
      if (L < 1e-6) continue;
      const gaps = portals.map((p) => portalSpan(seg, p)).filter((g): g is [number, number] => !!g).sort((x, y) => x[0] - y[0]);
      const at = (t: number): Pt => ({ x: seg.a.x + ((seg.b.x - seg.a.x) * t) / L, y: seg.a.y + ((seg.b.y - seg.a.y) * t) / L });
      let cur = 0, join = true;
      for (const [g0, g1] of gaps) {
        if (g0 > cur + 1e-4) pieces.push({ a: at(cur), b: at(g0), joinA: join, joinB: false });
        cur = Math.max(cur, g1);
        join = false;
      }
      if (L > cur + 1e-4) pieces.push({ a: at(cur), b: seg.b, joinA: join, joinB: true });
    }
    if (!pieces.length) continue;
    const chains: Pt[][] = [];
    const joins: { start: boolean; end: boolean }[] = [];
    for (const pc of pieces) {
      const last = chains.length ? chains[chains.length - 1] : null;
      // склеиваем, только если кусок продолжает ломаную (ребро целиком в проёме рвёт цепочку)
      if (last && joins[joins.length - 1].end && pc.joinA && touch(last[last.length - 1], pc.a)) { last.push(pc.b); joins[joins.length - 1].end = pc.joinB; continue; }
      chains.push([pc.a, pc.b]);
      joins.push({ start: pc.joinA, end: pc.joinB });
    }
    if (path.closed) {
      const allJoined = chains.length === 1 && joins[0].start && joins[0].end && touch(chains[0][chains[0].length - 1], chains[0][0]);
      if (allJoined) { chains[0].pop(); out.push({ pts: chains[0], closed: true, style: path.style, capStart: false, capEnd: false, room: path.room }); continue; }
      // последняя цепочка продолжается в первую через начальную вершину кольца
      if (chains.length > 1 && joins[joins.length - 1].end && joins[0].start && touch(chains[chains.length - 1][chains[chains.length - 1].length - 1], chains[0][0])) {
        const tail = chains.pop()!;
        const tj = joins.pop()!;
        chains[0] = [...tail, ...chains[0].slice(1)];
        joins[0] = { start: tj.start, end: joins[0].end };
      }
    }
    // у замкнутого контура концы цепочек — всегда края проёмов; у отдельной стены начало и конец — торцы
    chains.forEach((pts, i) => out.push({
      pts, closed: false, style: path.style, room: path.room,
      capStart: !path.closed && joins[i].start, capEnd: !path.closed && joins[i].end,
    }));
  }
  return out;
}

export type WallHit = { seg: WallSeg; t: number; q: Pt; d: number; len: number };

/** Ближайшая стена к точке (для установки проёма). */
export function nearestWall(f: Floor, p: Pt, maxDist: number): WallHit | null {
  let best: WallHit | null = null;
  for (const seg of floorSegments(f)) {
    const r = segDist(p, seg.a, seg.b);
    if (r.d <= maxDist && (!best || r.d < best.d)) best = { seg, t: r.t, q: r.q, d: r.d, len: Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y) };
  }
  return best;
}

/** Проём длиной len по центру около точки t на стене; помещается целиком в отрезок. */
export function portalOnWall(hit: WallHit, len: number, snap: boolean): { a: Pt; b: Pt } | null {
  const L = hit.len;
  if (len > L + 1e-6) return null;
  let c = hit.t * L;
  if (snap) c = Math.round((c - len / 2) * 2) / 2 + len / 2; // край проёма — на полклетки
  c = Math.max(len / 2, Math.min(L - len / 2, c));
  const ux = (hit.seg.b.x - hit.seg.a.x) / L, uy = (hit.seg.b.y - hit.seg.a.y) / L;
  const a = { x: hit.seg.a.x + ux * (c - len / 2), y: hit.seg.a.y + uy * (c - len / 2) };
  const b = { x: hit.seg.a.x + ux * (c + len / 2), y: hit.seg.a.y + uy * (c + len / 2) };
  return { a, b };
}

/** Проёмы, которые больше не стоят ни на одной стене (после правки комнат). */
export function orphanPortals(f: Floor): Set<string> {
  const segs = floorSegments(f);
  return new Set(f.portals.filter((p) => !segs.some((s) => portalSpan(s, p))).map((p) => p.id));
}

/** Толщина стены, на которой стоит проём (для отрисовки двери). */
export function portalThickness(f: Floor, p: Portal): number {
  for (const s of floorSegments(f)) if (portalSpan(s, p)) return s.style.width;
  return 0.25;
}

/** Новая длина проёма вокруг его центра (смена вида двери на двустворчатую и т. п.). */
export function resizePortal(p: Portal, len: number): { a: Pt; b: Pt } {
  const L = Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y) || 1;
  const c = { x: (p.a.x + p.b.x) / 2, y: (p.a.y + p.b.y) / 2 }, ux = (p.b.x - p.a.x) / L, uy = (p.b.y - p.a.y) / L;
  return { a: { x: c.x - (ux * len) / 2, y: c.y - (uy * len) / 2 }, b: { x: c.x + (ux * len) / 2, y: c.y + (uy * len) / 2 } };
}

// ---------- объёмные стены (псевдо-3D)
/**
 * Грань стены: четырёхугольник (линия стены p0→p1, затем дальний край); v — куда «поднимается» грань.
 * side — сторона стены: in (внутрь комнаты / первая сторона отдельной стены) или out; room — чья стена
 * (грань «внутрь» видна только внутри этой комнаты, «наружу» — только снаружи).
 */
export type WallFace = { pts: Pt[]; v: Pt; style: WallStyle; side: 'in' | 'out'; room?: Room };

/** Смещение грани проекцией (вниз/вверх) для стороны с нормалью n; null — у этой стены граней нет. */
function projVector(dir: FaceDir | undefined, n: Pt, h: number): Pt | null {
  if (dir === 'down') return n.y > 0.05 ? { x: 0, y: h } : null;
  if (dir === 'up') return n.y < -0.05 ? { x: 0, y: -h } : null;
  return null;
}

/** Нормаль «внутрь»: у стены комнаты — в комнату, у отдельной — влево по ходу рисования. */
function innerNormal(a: Pt, b: Pt, room?: Room): Pt {
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const n = { x: -(b.y - a.y) / L, y: (b.x - a.x) / L };
  if (room) {
    const m = { x: (a.x + b.x) / 2 + n.x * 0.05, y: (a.y + b.y) / 2 + n.y * 0.05 };
    if (!pointInPoly(m, room.poly)) return { x: -n.x, y: -n.y };
  }
  return n;
}

/** Куски [t0, t1] отрезка, где грань нужна: снаружи комнаты пропускаем места, за которыми другая комната. */
function freePieces(f: Floor, a: Pt, b: Pt, n: Pt, room: Room | undefined, outside: boolean): [number, number][] {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (!outside || !room) return [[0, L]];
  const u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L }, step = 0.25;
  const free = (t: number) => !f.rooms.some((r) => r !== room && pointInPoly({ x: a.x + u.x * t + n.x * 0.05, y: a.y + u.y * t + n.y * 0.05 }, r.poly));
  const out: [number, number][] = [];
  const n0 = Math.max(1, Math.ceil(L / step));
  let start: number | null = null;
  for (let k = 0; k <= n0; k++) {
    const t0 = (k / n0) * L, t1 = Math.min(L, ((k + 1) / n0) * L);
    const ok = k < n0 && free((t0 + t1) / 2);
    if (ok && start === null) start = t0;
    if ((!ok || k === n0) && start !== null) { out.push([start, ok ? t1 : t0]); start = null; }
  }
  return out;
}

/**
 * Грани ломаной стены pts (closed — кольцо) по правилам стиля. «Вниз»/«вверх» — проекция: грань сдвинута по экрану,
 * соседние грани сходятся сами. «По периметру» — полоса вдоль стены со стыками по биссектрисе угла
 * (два треугольника на углу, без перекосов и пропусков).
 */
function chainFaces(f: Floor, pts0: Pt[], closed: boolean, st: WallStyle, room: Room | undefined, out: WallFace[]) {
  const h = st.height ?? 0;
  if (h <= 0 || pts0.length < 2) return;
  const pts = closed ? [...pts0, pts0[0]] : pts0;
  const m = pts.length - 1;
  const nIn = Array.from({ length: m }, (_, i) => innerNormal(pts[i], pts[i + 1], room));
  for (const side of ['in', 'out'] as const) {
    const dir = side === 'in' ? st.inner : st.outer;
    if (!dir || dir === 'none') continue;
    const ns = nIn.map((n) => (side === 'in' ? n : { x: -n.x, y: -n.y }));
    // для периметра — точки дальнего края с изломом по биссектрисе
    let far: Pt[] | null = null;
    if (dir === 'normal') {
      far = pts.map((p, j) => {
        const prev = j > 0 ? ns[j - 1] : closed ? ns[m - 1] : null, next = j < m ? ns[j] : closed ? ns[0] : null;
        const a = prev ?? next!, b = next ?? prev!;
        const s = { x: a.x + b.x, y: a.y + b.y }, sl = Math.hypot(s.x, s.y);
        if (sl < 1e-6) return { x: p.x + b.x * h, y: p.y + b.y * h };
        const mm = { x: s.x / sl, y: s.y / sl }, c = mm.x * b.x + mm.y * b.y;
        const len = Math.min(h / Math.max(c, 0.2), h * 3);
        return { x: p.x + mm.x * len, y: p.y + mm.y * len };
      });
    }
    for (let i = 0; i < m; i++) {
      const a = pts[i], b = pts[i + 1], L = Math.hypot(b.x - a.x, b.y - a.y);
      if (L < 1e-6) continue;
      const n = ns[i];
      const v = far ? { x: n.x * h, y: n.y * h } : projVector(dir, n, h);
      if (!v) continue;
      const at = (t: number): Pt => ({ x: a.x + ((b.x - a.x) * t) / L, y: a.y + ((b.y - a.y) * t) / L });
      const farAt = (t: number): Pt => (far
        ? { x: far[i].x + ((far[i + 1].x - far[i].x) * t) / L, y: far[i].y + ((far[i + 1].y - far[i].y) * t) / L }
        : { x: at(t).x + v.x, y: at(t).y + v.y });
      for (const [t0, t1] of freePieces(f, a, b, n, room, side === 'out')) {
        out.push({ pts: [at(t0), at(t1), farAt(t1), farAt(t0)], v, style: st, side, room });
      }
    }
  }
}

/**
 * Грани объёмных стен этажа (стиль с height > 0). Двери, окна и проёмы без стены вырезают стену вместе с гранью:
 * грань проёма рисуется отдельно (portalFaces). У стены комнаты сторона «внутри» — правило inner, «снаружи» — outer;
 * если снаружи за стеной другая комната, эта часть стены — её внутренняя, и гранью займётся она.
 * У отдельной стены inner — сторона слева по ходу рисования, outer — справа.
 */
export function wallFaces(f: Floor): WallFace[] {
  const out: WallFace[] = [];
  for (const c of wallChains(f)) chainFaces(f, c.pts, c.closed, c.style, c.room, out);
  return out;
}

/** Стена, на которой стоит проём: её стиль и комната (если это стена комнаты). */
export function portalWall(f: Floor, p: Portal): { style: WallStyle; room?: Room; seg: WallSeg } | null {
  for (const path of floorPaths(f)) {
    for (const seg of pathSegs(path)) if (portalSpan(seg, p)) return { style: path.style, room: path.room, seg };
  }
  return null;
}

/** Грани стены в пределах проёма (двери, окна) — туда вписывается картинка проёма. Пусто — стена плоская. */
export function portalFaces(f: Floor, p: Portal): WallFace[] {
  const w = portalWall(f, p);
  if (!w || (w.style.height ?? 0) <= 0) return [];
  const span = portalSpan(w.seg, p)!;
  const L = Math.hypot(w.seg.b.x - w.seg.a.x, w.seg.b.y - w.seg.a.y);
  const at = (t: number): Pt => ({ x: w.seg.a.x + ((w.seg.b.x - w.seg.a.x) * t) / L, y: w.seg.a.y + ((w.seg.b.y - w.seg.a.y) * t) / L });
  const out: WallFace[] = [];
  chainFaces(f, [at(span[0]), at(span[1])], false, w.style, w.room, out);
  return out;
}

/** Форма проёма в грани: доли высоты грани — перемычка сверху и подоконник снизу, арка. */
export function portalShape(p: Portal): { top: number; bottom: number; arch: boolean } {
  const def = p.kind === 'window' ? { top: 0.3, bottom: 0.3 } : { top: 0.15, bottom: 0 };
  const top = Math.max(0, Math.min(0.9, p.top ?? def.top));
  const bottom = Math.max(0, Math.min(0.9 - top, p.bottom ?? def.bottom));
  return { top, bottom, arch: !!p.arch };
}

/**
 * Проём, перетащенный к точке target: встаёт на ближайшую стену в пределах maxDist клеток (своей длины,
 * с привязкой края к полклетки). null — рядом нет стены, куда он помещается.
 */
export function slidePortal(f: Floor, p: Portal, target: Pt, snap: boolean, maxDist = 1): { a: Pt; b: Pt } | null {
  const hit = nearestWall(f, target, maxDist);
  if (!hit) return null;
  const r = portalOnWall(hit, Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y), snap);
  if (!r) return null;
  // направление проёма (куда открывается дверь) сохраняется, насколько позволяет стена
  const same = (r.b.x - r.a.x) * (p.b.x - p.a.x) + (r.b.y - r.a.y) * (p.b.y - p.a.y) >= 0;
  return same ? r : { a: r.b, b: r.a };
}
