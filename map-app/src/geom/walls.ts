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

export function floorPaths(f: Floor): WallPath[] {
  const out: WallPath[] = [];
  for (const room of f.rooms) for (const ring of room.poly) out.push({ pts: ring, closed: true, style: room.wall, room });
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

/** Стены этажа, разрезанные проёмами указанных видов, — непрерывными ломаными. Проёмы без стены (gap) режут всегда. */
export function wallChains(f: Floor, gapKinds: Set<Portal['kind']> = new Set(['door', 'window'])): WallChain[] {
  // проём без стены и пустой проём (без картинки — арка, вырез) открыты всегда
  const portals = f.portals.filter((p) => p.kind === 'gap' || !p.asset || gapKinds.has(p.kind));
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
/** Грань стены: четырёхугольник p0, p1, p1+v, p0+v; v — куда и насколько она «поднимается». */
export type WallFace = { pts: Pt[]; v: Pt; style: WallStyle };

/** Смещение грани для стороны с нормалью n (единичной) по правилу dir; null — грани нет. */
function faceVector(dir: FaceDir | undefined, n: Pt, h: number): Pt | null {
  if (dir === 'down') return n.y > 0.05 ? { x: 0, y: h } : null;
  if (dir === 'up') return n.y < -0.05 ? { x: 0, y: -h } : null;
  if (dir === 'normal') return { x: n.x * h, y: n.y * h };
  return null;
}

/** Грани одного отрезка стены a→b по правилам стиля (сторона в комнату — inner, наружу — outer). */
function segFaces(f: Floor, a: Pt, b: Pt, st: WallStyle, room: Room | undefined, out: WallFace[]) {
  const h = st.height ?? 0, L = Math.hypot(b.x - a.x, b.y - a.y);
  if (h <= 0 || L < 1e-6) return;
  const step = 0.25;
  const u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
  let nIn = { x: -u.y, y: u.x };
  if (room) {
    const m = { x: (a.x + b.x) / 2 + nIn.x * 0.05, y: (a.y + b.y) / 2 + nIn.y * 0.05 };
    if (!pointInPoly(m, room.poly)) nIn = { x: -nIn.x, y: -nIn.y };
  }
  const nOut = { x: -nIn.x, y: -nIn.y };
  const sides: [Pt, FaceDir | undefined][] = room ? [[nIn, st.inner], [nOut, st.outer]] : [[nIn, st.outer], [nOut, st.outer]];
  for (const [n, dir] of sides) {
    const v = faceVector(dir, n, h);
    if (!v) continue;
    // снаружи комнаты: пропускаем куски, за которыми другая комната
    const outside = room && n === nOut;
    const at = (t: number): Pt => ({ x: a.x + u.x * t, y: a.y + u.y * t });
    const free = (t: number) => !outside || !f.rooms.some((r) => r !== room && pointInPoly({ x: a.x + u.x * t + n.x * 0.05, y: a.y + u.y * t + n.y * 0.05 }, r.poly));
    let start: number | null = null;
    const n0 = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k <= n0; k++) {
      const t0 = (k / n0) * L, t1 = Math.min(L, ((k + 1) / n0) * L);
      const ok = k < n0 && free((t0 + t1) / 2);
      if (ok && start === null) start = t0;
      if ((!ok || k === n0) && start !== null) {
        const p0 = at(start), p1 = at(ok ? t1 : t0);
        out.push({ pts: [p0, p1, { x: p1.x + v.x, y: p1.y + v.y }, { x: p0.x + v.x, y: p0.y + v.y }], v, style: st });
        start = null;
      }
    }
  }
}

/**
 * Грани объёмных стен этажа (стиль с height > 0). Двери, окна и проёмы без стены вырезают стену вместе с гранью:
 * грань проёма рисуется отдельно (portalFaces). У стены комнаты сторона внутрь — правило inner, наружу — outer;
 * если снаружи за стеной другая комната, эта часть стены — её внутренняя, и гранью займётся она.
 * У отдельной стены обе стороны — outer.
 */
export function wallFaces(f: Floor): WallFace[] {
  const out: WallFace[] = [];
  for (const c of wallChains(f)) {
    if ((c.style.height ?? 0) <= 0) continue;
    const pts = c.closed ? [...c.pts, c.pts[0]] : c.pts;
    for (let i = 0; i < pts.length - 1; i++) segFaces(f, pts[i], pts[i + 1], c.style, c.room, out);
  }
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
  segFaces(f, at(span[0]), at(span[1]), w.style, w.room, out);
  return out;
}

/** Форма проёма в грани: доли высоты грани — перемычка сверху и подоконник снизу, арка. */
export function portalShape(p: Portal): { top: number; bottom: number; arch: boolean } {
  const def = p.kind === 'window' ? { top: 0.3, bottom: 0.3 } : { top: 0.15, bottom: 0 };
  const top = Math.max(0, Math.min(0.9, p.top ?? def.top));
  const bottom = Math.max(0, Math.min(0.9 - top, p.bottom ?? def.bottom));
  return { top, bottom, arch: !!p.arch };
}
