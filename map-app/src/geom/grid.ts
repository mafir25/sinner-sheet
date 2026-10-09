// Сетки и привязка. Клетка = 1 единица; у гексов расстояние между центрами соседей = 1.
import type { GridType, Pt } from '../model/types';

const SQ3 = Math.sqrt(3);
export const HEX_R = 1 / SQ3; // радиус описанной окружности гекса

type Axial = { q: number; r: number };

function hexRound(q: number, r: number): Axial {
  const s = -q - r;
  let rq = Math.round(q), rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}

export function hexCenter(type: GridType, h: Axial): Pt {
  return type === 'hex-flat'
    ? { x: 1.5 * HEX_R * h.q, y: SQ3 * HEX_R * (h.r + h.q / 2) }
    : { x: SQ3 * HEX_R * (h.q + h.r / 2), y: 1.5 * HEX_R * h.r };
}

export function hexAt(type: GridType, p: Pt): Axial {
  if (type === 'hex-flat') return hexRound((2 / 3) * p.x / HEX_R, (-p.x / 3 + (SQ3 / 3) * p.y) / HEX_R);
  return hexRound(((SQ3 / 3) * p.x - p.y / 3) / HEX_R, ((2 / 3) * p.y) / HEX_R);
}

export function hexCorners(type: GridType, c: Pt): Pt[] {
  const off = type === 'hex-flat' ? 0 : 30;
  return Array.from({ length: 6 }, (_, i) => {
    const a = ((60 * i + off) * Math.PI) / 180;
    return { x: c.x + HEX_R * Math.cos(a), y: c.y + HEX_R * Math.sin(a) };
  });
}

const d2 = (a: Pt, b: Pt) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const nearest = (p: Pt, list: Pt[]) => list.reduce((best, q) => (d2(p, q) < d2(p, best) ? q : best));
const roundTo = (v: number, step: number) => Math.round(v / step) * step;

/** Привязка точки контура (комнаты, стены): к узлам сетки. */
export function snapVertex(type: GridType, p: Pt): Pt {
  if (type === 'square') return { x: Math.round(p.x), y: Math.round(p.y) };
  if (type === 'none') return { x: roundTo(p.x, 0.5), y: roundTo(p.y, 0.5) };
  const c = hexCenter(type, hexAt(type, p));
  return nearest(p, [c, ...hexCorners(type, c)]);
}

/** Привязка к половине клетки (проёмы вдоль стены, мелкие сдвиги). */
export function snapHalf(type: GridType, p: Pt): Pt {
  if (type === 'square' || type === 'none') return { x: roundTo(p.x, 0.5), y: roundTo(p.y, 0.5) };
  return snapVertex(type, p);
}

/** Привязка центра объекта: на квадратной сетке — по чётности размера (1×1 — в центр клетки, 2×2 — в узел). */
export function snapCenter(type: GridType, p: Pt, w = 1, h = 1, rot = 0): Pt {
  if (type === 'square') {
    const turned = Math.abs(Math.round(rot / 90)) % 2 === 1;
    const [sw, sh] = turned ? [h, w] : [w, h];
    const ax = (v: number, size: number) => {
      const n = Math.round(size);
      if (Math.abs(size - n) > 0.01 || n === 0) return roundTo(v, 0.5);
      return n % 2 ? Math.floor(v) + 0.5 : Math.round(v);
    };
    return { x: ax(p.x, sw), y: ax(p.y, sh) };
  }
  if (type === 'none') return { x: roundTo(p.x, 0.5), y: roundTo(p.y, 0.5) };
  return hexCenter(type, hexAt(type, p));
}

/**
 * Рисует сетку в прямоугольнике карты (в координатах клеток; ctx уже масштабирован).
 * view — видимая часть в клетках, чтобы не рисовать лишнее.
 */
export function drawGrid(
  ctx: CanvasRenderingContext2D, type: GridType, w: number, h: number,
  view: { x0: number; y0: number; x1: number; y1: number }, lineWidth: number,
) {
  if (type === 'none') return;
  const x0 = Math.max(0, Math.floor(view.x0)), y0 = Math.max(0, Math.floor(view.y0));
  const x1 = Math.min(w, Math.ceil(view.x1)), y1 = Math.min(h, Math.ceil(view.y1));
  if (x1 <= x0 || y1 <= y0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  if (type === 'square') {
    for (let x = x0; x <= x1; x++) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    for (let y = y0; y <= y1; y++) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
  } else {
    // все гексы, чьи центры попадают в видимую область с запасом
    const pad = 1;
    const a = hexAt(type, { x: x0 - pad, y: y0 - pad }), b = hexAt(type, { x: x1 + pad, y: y1 + pad });
    const c = hexAt(type, { x: x0 - pad, y: y1 + pad }), d = hexAt(type, { x: x1 + pad, y: y0 - pad });
    const qs = [a.q, b.q, c.q, d.q], rs = [a.r, b.r, c.r, d.r];
    const qMin = Math.min(...qs) - 1, qMax = Math.max(...qs) + 1;
    const rMin = Math.min(...rs) - 1, rMax = Math.max(...rs) + 1;
    for (let q = qMin; q <= qMax; q++) {
      for (let r = rMin; r <= rMax; r++) {
        const cc = hexCenter(type, { q, r });
        if (cc.x < x0 - 1 || cc.x > x1 + 1 || cc.y < y0 - 1 || cc.y > y1 + 1) continue;
        const cs = hexCorners(type, cc);
        // три ребра на гекс — соседние дорисуют остальные
        ctx.moveTo(cs[0].x, cs[0].y);
        ctx.lineTo(cs[1].x, cs[1].y);
        ctx.lineTo(cs[2].x, cs[2].y);
        ctx.lineTo(cs[3].x, cs[3].y);
      }
    }
  }
  ctx.stroke();
  ctx.restore();
}
