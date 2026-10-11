// Крыши: какие скаты где (растр для отрисовки), крыша на всё здание, крыши над комнатами.
import type { Floor, Poly, Pt, Roof, RoofShape, Room } from '../model/types';
import { intersects, pointInPoly, ptsBBox, ringArea, segDist, touches, union } from './poly';

export const roofShape = (r: Roof): RoofShape => r.shape ?? 'hip';

/** Конёк двускатной крыши: заданный или вдоль длинной стороны. */
export function roofRidge(r: Roof): 'h' | 'v' {
  if (r.ridge) return r.ridge;
  const b = ptsBBox(r.poly[0]);
  return b.x1 - b.x0 >= b.y1 - b.y0 ? 'h' : 'v';
}

const FALL: Record<NonNullable<Roof['fall']>, Pt> = { n: { x: 0, y: -1 }, e: { x: 1, y: 0 }, s: { x: 0, y: 1 }, w: { x: -1, y: 0 } };

/**
 * Скаты крыши растром: res пикселей на клетку, начало — (x0, y0). face — номер ската (-1 — вне крыши; граница
 * номеров — конёк или ендова), (dx, dy) — куда по скату стекает вода. У плоской крыши скатов нет — null.
 * Вальмовая — скат к ближайшему краю (у любой формы, в т. ч. Г-образной и с внутренним двором);
 * двускатная — к ближайшему краю по вертикали (конёк h) или горизонтали (v); односкатная — один скат.
 */
export type RoofRaster = { x0: number; y0: number; w: number; h: number; res: number; face: Int32Array; dx: Float32Array; dy: Float32Array };

const MAX_PX = 2_500_000;

export function roofRaster(r: Roof, res0: number): RoofRaster | null {
  const shape = roofShape(r);
  if (shape === 'flat') return null;
  const b = ptsBBox(r.poly[0]);
  let res = res0;
  const area = (b.x1 - b.x0) * (b.y1 - b.y0);
  if (area * res * res > MAX_PX) res = Math.max(2, Math.floor(Math.sqrt(MAX_PX / Math.max(area, 1e-6))));
  const w = Math.max(1, Math.ceil((b.x1 - b.x0) * res)), h = Math.max(1, Math.ceil((b.y1 - b.y0) * res));
  const face = new Int32Array(w * h).fill(-1), dx = new Float32Array(w * h), dy = new Float32Array(w * h);
  const edges: [Pt, Pt][] = [];
  for (const ring of r.poly) for (let i = 0; i < ring.length; i++) edges.push([ring[i], ring[(i + 1) % ring.length]]);
  const cx = (i: number) => b.x0 + (i + 0.5) / res, cy = (j: number) => b.y0 + (j + 0.5) / res;

  // пересечения горизонтали y с краями: x и номер края, по возрастанию x
  const rowHits = (y: number) => {
    const out: { t: number; e: number }[] = [];
    edges.forEach(([a, c], e) => {
      if ((a.y <= y && c.y > y) || (c.y <= y && a.y > y)) out.push({ t: a.x + ((y - a.y) * (c.x - a.x)) / (c.y - a.y), e });
    });
    return out.sort((p, q) => p.t - q.t);
  };
  const colHits = (x: number) => {
    const out: { t: number; e: number }[] = [];
    edges.forEach(([a, c], e) => {
      if ((a.x <= x && c.x > x) || (c.x <= x && a.x > x)) out.push({ t: a.y + ((x - a.x) * (c.y - a.y)) / (c.x - a.x), e });
    });
    return out.sort((p, q) => p.t - q.t);
  };
  // пиксель внутри, если левее него нечётное число пересечений; заодно — ближайшие края слева и справа
  const scan = (hits: { t: number; e: number }[], v: number) => {
    let k = 0;
    while (k < hits.length && hits[k].t <= v) k++;
    return k % 2 === 1 ? { lo: hits[k - 1], hi: hits[k] } : null;
  };

  if (shape === 'gable' && roofRidge(r) === 'v') {
    for (let j = 0; j < h; j++) {
      const hits = rowHits(cy(j));
      for (let i = 0; i < w; i++) {
        const s = scan(hits, cx(i));
        if (!s || !s.hi) continue;
        const left = cx(i) - s.lo.t <= s.hi.t - cx(i), k = j * w + i;
        face[k] = left ? s.lo.e * 2 : s.hi.e * 2 + 1;
        dx[k] = left ? -1 : 1;
      }
    }
    return { x0: b.x0, y0: b.y0, w, h, res, face, dx, dy };
  }
  if (shape === 'gable') {
    for (let i = 0; i < w; i++) {
      const hits = colHits(cx(i));
      for (let j = 0; j < h; j++) {
        const s = scan(hits, cy(j));
        if (!s || !s.hi) continue;
        const up = cy(j) - s.lo.t <= s.hi.t - cy(j), k = j * w + i;
        face[k] = up ? s.lo.e * 2 : s.hi.e * 2 + 1;
        dy[k] = up ? -1 : 1;
      }
    }
    return { x0: b.x0, y0: b.y0, w, h, res, face, dx, dy };
  }
  const fall = FALL[r.fall ?? 's'];
  const ortho = edges.every(([a, c]) => Math.abs(a.x - c.x) < 1e-9 || Math.abs(a.y - c.y) < 1e-9);
  for (let j = 0; j < h; j++) {
    const y = cy(j), hits = rowHits(y);
    for (let i = 0; i < w; i++) {
      const x = cx(i);
      if (!scan(hits, x)) continue;
      const k = j * w + i;
      if (shape === 'shed') { face[k] = 0; dx[k] = fall.x; dy[k] = fall.y; continue; }
      // вальмовая: скат к ближайшему краю. У прямоугольных форм (Г, Т, П, двор) расстояние «по клеткам» (L∞):
      // тогда скаты — плоскости, а ендовы от внутренних углов идут под 45°, как у настоящей вальмовой крыши
      let best = Infinity, be = 0, q: Pt = { x, y };
      for (let e = 0; e < edges.length; e++) {
        const [a, c] = edges[e];
        if (ortho) {
          const horiz = Math.abs(a.y - c.y) < 1e-9;
          const lo = horiz ? Math.min(a.x, c.x) : Math.min(a.y, c.y), hi = horiz ? Math.max(a.x, c.x) : Math.max(a.y, c.y);
          const along = horiz ? x : y, across = horiz ? Math.abs(y - a.y) : Math.abs(x - a.x);
          // за концом края L∞ даёт ничью с соседним краем — побеждает край, напротив которого точка лежит
          const over = Math.max(0, lo - along, along - hi), d = Math.max(across, over) + over * 1e-3;
          if (d < best - 1e-9) { best = d; be = e; q = horiz ? { x, y: a.y } : { x: a.x, y }; }
          continue;
        }
        const sd = segDist({ x, y }, a, c);
        if (sd.d < best - 1e-9) { best = sd.d; be = e; q = sd.q; }
      }
      face[k] = be;
      const L = Math.hypot(q.x - x, q.y - y);
      if (L > 1e-9) { dx[k] = (q.x - x) / L; dy[k] = (q.y - y) / L; }
    }
  }
  return { x0: b.x0, y0: b.y0, w, h, res, face, dx, dy };
}

// ---------- крыши и комнаты
/** Комнаты здания: щёлкнутая и все, что касаются её (через соседей). */
export function buildingRooms(f: Floor, room: Room): Room[] {
  const out = [room], seen = new Set([room.id]);
  for (let i = 0; i < out.length; i++) {
    for (const r of f.rooms) {
      if (seen.has(r.id) || !touches(out[i].poly, r.poly)) continue;
      seen.add(r.id);
      out.push(r);
    }
  }
  return out;
}

/** Самый большой многоугольник объединения комнат — форма крыши над ними. */
export function roofPolyOver(rooms: Room[]): Poly | null {
  if (!rooms.length) return null;
  const parts = union(...rooms.map((r) => r.poly));
  let best: Poly | null = null, area = -1;
  for (const p of parts) {
    const a = Math.abs(ringArea(p[0]));
    if (a > area) { area = a; best = p; }
  }
  return best;
}

/** Форма крыши заново по комнатам под ней (после правки комнат). null — под крышей нет комнат. */
export function refitRoof(f: Floor, roof: Roof): Poly | null {
  return roofPolyOver(f.rooms.filter((r) => intersects(r.poly, roof.poly)));
}

const onEdge = (p: Pt, poly: Poly) => poly.some((ring) => ring.some((a, i) => segDist(p, a, ring[(i + 1) % ring.length]).d < 1e-6));

/** Крыши, которые целиком лежат на этих комнатах: при перемещении и копировании комнат они едут вместе с ними. */
export function roofsOver(f: Floor, rooms: Room[]): Set<string> {
  const out = new Set<string>();
  if (!rooms.length) return out;
  for (const roof of f.roofs) {
    const ok = roof.poly[0].every((v) => rooms.some((r) => pointInPoly(v, r.poly) || onEdge(v, r.poly)));
    // и середина крыши — над этими комнатами (а не над двором между ними)
    const b = ptsBBox(roof.poly[0]), c = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
    if (ok && (!pointInPoly(c, roof.poly) || rooms.some((r) => pointInPoly(c, r.poly) || onEdge(c, r.poly)))) out.add(roof.id);
  }
  return out;
}
