// Стены этажа: рёбра комнат + отдельные стены, разрезанные проёмами (двери, окна).
import type { Floor, Portal, Pt, WallStyle } from '../model/types';
import { segDist } from './poly';

export type WallSeg = { a: Pt; b: Pt; style: WallStyle };
/** Контур стены: кольцо комнаты или отдельная стена. */
export type WallPath = { pts: Pt[]; closed: boolean; style: WallStyle };
/**
 * Непрерывная ломаная стены между проёмами. capStart/capEnd — конец является торцом отдельной стены
 * (продлевается на полтолщины), а не краем проёма. Углы внутри цепочки рисуются стыком (miter).
 */
export type WallChain = { pts: Pt[]; closed: boolean; style: WallStyle; capStart: boolean; capEnd: boolean };

const ON_LINE = 0.03;

export function floorPaths(f: Floor): WallPath[] {
  const out: WallPath[] = [];
  for (const room of f.rooms) for (const ring of room.poly) out.push({ pts: ring, closed: true, style: room.wall });
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

/** Стены этажа, разрезанные проёмами указанных видов, — непрерывными ломаными. */
export function wallChains(f: Floor, gapKinds: Set<Portal['kind']> = new Set(['door', 'window'])): WallChain[] {
  const portals = f.portals.filter((p) => gapKinds.has(p.kind));
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
      if (last && joins[joins.length - 1].end && pc.joinA) { last.push(pc.b); joins[joins.length - 1].end = pc.joinB; continue; }
      chains.push([pc.a, pc.b]);
      joins.push({ start: pc.joinA, end: pc.joinB });
    }
    if (path.closed) {
      const allJoined = chains.length === 1 && joins[0].start && joins[0].end;
      if (allJoined) { chains[0].pop(); out.push({ pts: chains[0], closed: true, style: path.style, capStart: false, capEnd: false }); continue; }
      // последняя цепочка продолжается в первую через начальную вершину кольца
      if (chains.length > 1 && joins[joins.length - 1].end && joins[0].start) {
        const tail = chains.pop()!;
        const tj = joins.pop()!;
        chains[0] = [...tail, ...chains[0].slice(1)];
        joins[0] = { start: tj.start, end: joins[0].end };
      }
    }
    // у замкнутого контура концы цепочек — всегда края проёмов; у отдельной стены начало и конец — торцы
    chains.forEach((pts, i) => out.push({
      pts, closed: false, style: path.style,
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
