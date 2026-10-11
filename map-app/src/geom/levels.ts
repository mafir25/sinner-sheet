// Уровни местности: возвышения и ямы. Высота — в футах, обрыв рисуется гранью (как у объёмных стен).
import type { Floor, Level, Poly, Pt } from '../model/types';
import { pointInPoly, ptsBBox, segDist } from './poly';

/** Сколько клеток грани на фут перепада: 10 фт — 0.4 клетки (стена по умолчанию — 0.5). */
export const FACE_PER_FOOT = 0.04;
const MAX_FACE = 1.6;

/** Уровень в точке (верхний, если вдруг перекрываются); null — земля этажа. */
export function levelAt(f: Floor, p: Pt): Level | null {
  for (let i = f.levels.length - 1; i >= 0; i--) if (pointInPoly(p, f.levels[i].poly)) return f.levels[i];
  return null;
}
export const heightAt = (f: Floor, p: Pt) => levelAt(f, p)?.h ?? 0;

/**
 * Грань обрыва: четырёхугольник от края (pts[0], pts[1]) вниз по экрану на v. inside — грань внутри участка
 * (дальняя стенка ямы), иначе снаружи (передний обрыв возвышения, лежит на том, что ниже).
 */
export type LevelFace = { pts: Pt[]; v: Pt; level: Level; inside: boolean };

/**
 * Обрывы этажа. У возвышения видна грань под краями, обращёнными к зрителю (южными), — если за краем ниже.
 * У ямы, вырытой в землю, видна дальняя (северная) стенка. Перепад между двумя участками рисует более высокий.
 */
export function levelFaces(f: Floor): LevelFace[] {
  const out: LevelFace[] = [];
  for (const lv of f.levels) {
    for (const ring of lv.poly) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length], L = Math.hypot(b.x - a.x, b.y - a.y);
        if (L < 1e-6) continue;
        let n = { x: -(b.y - a.y) / L, y: (b.x - a.x) / L };
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (pointInPoly({ x: m.x + n.x * 0.05, y: m.y + n.y * 0.05 }, lv.poly)) n = { x: -n.x, y: -n.y }; // n — наружу
        const outside = levelAt(f, { x: m.x + n.x * 0.05, y: m.y + n.y * 0.05 });
        const hOut = outside?.h ?? 0;
        let drop = 0, inside = false;
        if (n.y > 0.05 && lv.h > hOut) drop = lv.h - hOut;
        else if (n.y < -0.05 && !outside && lv.h < 0) { drop = -lv.h; inside = true; }
        if (drop <= 0) continue;
        const v = { x: 0, y: Math.min(MAX_FACE, drop * FACE_PER_FOOT) };
        out.push({ pts: [a, b, { x: b.x + v.x, y: b.y + v.y }, { x: a.x + v.x, y: a.y + v.y }], v, level: lv, inside });
      }
    }
  }
  return out;
}

/** «+10 фт» / «−5 фт». */
export const fmtHeight = (h: number, ft: string) => `${h > 0 ? '+' : h < 0 ? '−' : ''}${Math.round(Math.abs(h) * 10) / 10} ${ft}`;

/** Точка для подписи: внутри участка, подальше от краёв. */
export function labelSpot(poly: Poly): Pt {
  const b = ptsBBox(poly[0]);
  const edgeDist = (p: Pt) => {
    let d = Infinity;
    for (const ring of poly) for (let i = 0; i < ring.length; i++) d = Math.min(d, segDist(p, ring[i], ring[(i + 1) % ring.length]).d);
    return d;
  };
  let best = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }, bestD = pointInPoly(best, poly) ? edgeDist(best) : -1;
  const N = 12;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const p = { x: b.x0 + ((i + 0.5) / N) * (b.x1 - b.x0), y: b.y0 + ((j + 0.5) / N) * (b.y1 - b.y0) };
      if (!pointInPoly(p, poly)) continue;
      const d = edgeDist(p);
      if (d > bestD + 0.05) { bestD = d; best = p; }
    }
  }
  return best;
}
