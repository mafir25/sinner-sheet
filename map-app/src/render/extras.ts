// Этап 2: местность (кисти), пути, свет и тени, крыши, подписи, фон-картинка.
// Местность и карта освещения рисуются в отдельный холст размером с карту и кэшируются.
import type { AssetStore } from '../assets/store';
import type { Floor, Label, Lighting, MapPath, Pt, Roof, TerrainStroke } from '../model/types';
import { curvePoints, roundCorners, walkAlong } from '../geom/curve';
import { blockingSegments, visibility } from '../geom/light';
import { polyPath } from './render';

const SCREEN_MAX = 3072;

/** Разрешение служебных холстов (px на клетку): степень двойки, не больше SCREEN_MAX по стороне. */
export function auxRes(scale: number, w: number, h: number, exporting: boolean): number {
  if (exporting) return scale;
  let b = 4;
  while (b < scale && b < 128) b *= 2;
  return Math.max(2, Math.min(b, Math.floor(SCREEN_MAX / Math.max(w, h))));
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

// ---------- местность
/** Мазок с мягким краем. ctx в координатах клеток с масштабом res. Тень с большим сдвигом даёт размытие во всех браузерах. */
export function paintStroke(ctx: CanvasRenderingContext2D, s: TerrainStroke, res: number) {
  const off = ctx.canvas.width + 4096;
  const soft = Math.max(0, Math.min(1, s.softness));
  ctx.save();
  ctx.shadowColor = `rgba(0,0,0,${s.opacity})`;
  ctx.shadowBlur = s.size * res * soft * 0.5;
  ctx.shadowOffsetX = off;
  ctx.translate(-off / res, 0);
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#000';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = s.size * (1 - soft * 0.45);
  ctx.beginPath();
  if (s.points.length === 1) {
    ctx.arc(s.points[0].x, s.points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.moveTo(s.points[0].x, s.points[0].y);
    for (const p of s.points.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  ctx.restore();
}

type TerrainCache = { sig: string; canvas: HTMLCanvasElement };
const terrainCache = new Map<string, TerrainCache>();
let maskCanvas: HTMLCanvasElement | null = null;

/** Холст местности этажа (прозрачный там, где не красили). null — мазков нет. */
export function terrainCanvas(f: Floor, assets: AssetStore, res: number, w: number, h: number, useCache: boolean): HTMLCanvasElement | null {
  if (!f.terrain.length) return null;
  const last = f.terrain[f.terrain.length - 1];
  const sig = `${f.terrain.length}:${last.id}:${res}:${w}x${h}:${assets.version}`;
  const hit = useCache ? terrainCache.get(f.id) : undefined;
  if (hit && hit.sig === sig) return hit.canvas;
  const out = hit?.canvas.width === Math.round(w * res) && hit.canvas.height === Math.round(h * res) ? hit.canvas : canvas(w * res, h * res);
  const tctx = out.getContext('2d')!;
  tctx.setTransform(1, 0, 0, 1, 0, 0);
  tctx.clearRect(0, 0, out.width, out.height);
  tctx.setTransform(res, 0, 0, res, 0, 0);
  if (!maskCanvas || maskCanvas.width !== out.width || maskCanvas.height !== out.height) maskCanvas = canvas(out.width, out.height);
  const m = maskCanvas.getContext('2d')!;
  const strokes = f.terrain;
  for (let i = 0; i < strokes.length;) {
    const s = strokes[i];
    if (!s.asset) {
      tctx.save();
      tctx.globalCompositeOperation = 'destination-out';
      paintStroke(tctx, s, res);
      tctx.restore();
      i++;
      continue;
    }
    // подряд идущие мазки одной текстурой — одной маской
    let j = i;
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.globalCompositeOperation = 'source-over';
    m.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    m.setTransform(res, 0, 0, res, 0, 0);
    while (j < strokes.length && strokes[j].asset === s.asset) { paintStroke(m, strokes[j], res); j++; }
    const pat = assets.pattern(m, s.asset, res);
    if (pat) {
      m.globalCompositeOperation = 'source-in';
      m.fillStyle = pat;
      m.fillRect(0, 0, w, h);
      tctx.drawImage(maskCanvas, 0, 0, w, h);
    }
    i = j;
  }
  if (useCache) terrainCache.set(f.id, { sig, canvas: out });
  return out;
}

/** Предпросмотр рисуемого мазка (без мягкого края — точный вид появится после отпускания). */
export function drawStrokePreview(ctx: CanvasRenderingContext2D, s: TerrainStroke, assets: AssetStore, scale: number) {
  ctx.save();
  ctx.globalAlpha = 0.85 * s.opacity;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = s.size;
  ctx.strokeStyle = s.asset ? (assets.pattern(ctx, s.asset, scale) ?? '#888') : 'rgba(255,80,104,.6)';
  ctx.beginPath();
  ctx.moveTo(s.points[0].x, s.points[0].y);
  for (const p of s.points.slice(1)) ctx.lineTo(p.x, p.y);
  if (s.points.length === 1) ctx.lineTo(s.points[0].x + 0.001, s.points[0].y);
  ctx.stroke();
  ctx.restore();
}

// ---------- пути
export function drawPath(ctx: CanvasRenderingContext2D, p: MapPath, assets: AssetStore, scale: number) {
  const pts = curvePoints(p.points, p.smooth, p.closed);
  if (pts.length < 2) return;
  const st = p.style;
  const line = () => { ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (const q of pts.slice(1)) ctx.lineTo(q.x, q.y); };
  ctx.save();
  ctx.lineCap = st.dash ? 'butt' : 'round';
  ctx.lineJoin = 'round';
  if (st.dash) ctx.setLineDash([st.dash, st.dash * 0.6]);
  if (st.outline) {
    line();
    ctx.lineWidth = st.width + Math.max(0.12, st.width * 0.08);
    ctx.strokeStyle = st.outline;
    ctx.stroke();
  }
  if (st.width > 0) {
    line();
    ctx.lineWidth = st.width;
    ctx.strokeStyle = (st.asset && assets.pattern(ctx, st.asset, scale)) || st.color;
    ctx.stroke();
  }
  ctx.setLineDash([]);
  if (st.decor) {
    const e = assets.entry(st.decor);
    const k = st.decorScale > 0 ? st.decorScale : 1;
    const [dw, dh] = (e?.footprint ?? [1, 1]).map((v) => v * k);
    const src = assets.source(st.decor, scale * k);
    if (src) {
      if (st.decorMode === 'repeat') {
        for (const { p: c, angle } of walkAlong(pts, st.spacing)) {
          ctx.save();
          ctx.translate(c.x, c.y);
          ctx.rotate(angle);
          ctx.drawImage(src, -dw / 2, -dh / 2, dw, dh);
          ctx.restore();
        }
      } else {
        // лента: углы ломаной скругляем на полширины ленты, иначе на изломе будет разрыв
        drawStrip(ctx, p.smooth ? pts : roundCorners(pts, dh / 2, p.closed), src, dw, dh);
      }
    }
  }
  ctx.restore();
}

/**
 * Картинка, изогнутая лентой вдоль ломаной: повторяется каждые tileLen клеток по длине,
 * поперёк — высотой band. Рисуется тонкими срезами, повёрнутыми по касательной.
 */
export function drawStrip(ctx: CanvasRenderingContext2D, pts: Pt[], src: CanvasImageSource, tileLen: number, band: number) {
  const sw = (src as HTMLCanvasElement).width, sh = (src as HTMLCanvasElement).height;
  if (!sw || !sh || tileLen <= 0) return;
  const step = Math.max(0.03, Math.min(0.12, tileLen / 8));
  const seam = 0.012; // перекрытие срезов, чтобы не было щелей
  // направления участков — чтобы закрыть клин на внешней стороне изгиба
  const seg: { a: Pt; L: number; ux: number; uy: number; angle: number }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L >= 1e-9) seg.push({ a, L, ux: (b.x - a.x) / L, uy: (b.y - a.y) / L, angle: Math.atan2(b.y - a.y, b.x - a.x) });
  }
  let s = 0;
  seg.forEach(({ a, L, ux, uy, angle }, i) => {
    let turn = i + 1 < seg.length ? Math.abs(seg[i + 1].angle - angle) : 0;
    if (turn > Math.PI) turn = Math.PI * 2 - turn;
    const wedge = (band / 2) * Math.min(turn, 1.2);
    let t = 0;
    while (t < L - 1e-9) {
      // срез не длиннее шага и не переходит границу плитки
      const inTile = s % tileLen;
      const len = Math.min(step, L - t, tileLen - inTile);
      const last = t + len >= L - 1e-9;
      const sx = (inTile / tileLen) * sw, sLen = Math.max(1e-3, (len / tileLen) * sw);
      ctx.save();
      ctx.translate(a.x + ux * t, a.y + uy * t);
      ctx.rotate(angle);
      ctx.drawImage(src, sx, 0, Math.min(sLen, sw - sx), sh, 0, -band / 2, len + seam + (last ? wedge : 0), band);
      ctx.restore();
      t += len;
      s += len;
    }
  });
}

// ---------- освещение
type LightCache = { key: string; canvas: HTMLCanvasElement };
const lightCache = new WeakMap<Floor, LightCache>();

const hexRgb = (hex: string): [number, number, number] => {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex.trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255];
};

/** Многоугольники видимости источников (для теней). */
function lightShapes(f: Floor): { light: Floor['lights'][number]; poly: Pt[] | null }[] {
  const segs = f.lights.some((l) => l.shadows) ? blockingSegments(f) : [];
  return f.lights.map((light) => ({ light, poly: light.shadows ? visibility(light, light.radius, segs) : null }));
}

function shapePath(ctx: CanvasRenderingContext2D, l: Floor['lights'][number], poly: Pt[] | null) {
  ctx.beginPath();
  if (poly && poly.length > 2) {
    ctx.moveTo(poly[0].x, poly[0].y);
    for (const p of poly.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.closePath();
  } else ctx.arc(l.x, l.y, l.radius, 0, Math.PI * 2);
}

/** Запекает освещение поверх нарисованного этажа: темнота вне света + цветное свечение. */
export function drawLighting(ctx: CanvasRenderingContext2D, f: Floor, lighting: Lighting, res: number, w: number, h: number, useCache: boolean) {
  const key = `${res}|${w}x${h}|${lighting.darkness}|${lighting.color}`;
  const shapes = lightShapes(f);
  let lc = useCache ? lightCache.get(f) : undefined;
  if (!lc || lc.key !== key) {
    const c = canvas(w * res, h * res);
    const l = c.getContext('2d')!;
    l.setTransform(res, 0, 0, res, 0, 0);
    const [r, g, b] = hexRgb(lighting.color);
    l.fillStyle = `rgba(${r},${g},${b},${lighting.darkness})`;
    l.fillRect(0, 0, w, h);
    l.globalCompositeOperation = 'destination-out';
    for (const { light, poly } of shapes) {
      l.save();
      shapePath(l, light, poly);
      l.clip();
      const gr = l.createRadialGradient(light.x, light.y, 0, light.x, light.y, light.radius);
      gr.addColorStop(0, `rgba(0,0,0,${light.intensity})`);
      gr.addColorStop(0.55, `rgba(0,0,0,${light.intensity * 0.75})`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      l.fillStyle = gr;
      l.fillRect(light.x - light.radius, light.y - light.radius, light.radius * 2, light.radius * 2);
      l.restore();
    }
    lc = { key, canvas: c };
    if (useCache) lightCache.set(f, lc);
  }
  ctx.drawImage(lc.canvas, 0, 0, w, h);
  // цветное свечение
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const { light, poly } of shapes) {
    const [r, g, b] = hexRgb(light.color);
    ctx.save();
    shapePath(ctx, light, poly);
    ctx.clip();
    const gr = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, light.radius);
    gr.addColorStop(0, `rgba(${r},${g},${b},${0.32 * light.intensity})`);
    gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = gr;
    ctx.fillRect(light.x - light.radius, light.y - light.radius, light.radius * 2, light.radius * 2);
    ctx.restore();
  }
  ctx.restore();
}

// ---------- крыши
export function drawRoof(ctx: CanvasRenderingContext2D, roof: Roof, assets: AssetStore, scale: number) {
  // карниз: тёмная кромка наружу накрывает стены по контуру
  ctx.save();
  ctx.beginPath();
  polyPath(ctx, roof.poly);
  ctx.strokeStyle = '#0b0b0d';
  ctx.lineWidth = 0.44;
  ctx.lineJoin = 'miter';
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  polyPath(ctx, roof.poly);
  ctx.fillStyle = (roof.asset && assets.pattern(ctx, roof.asset, scale)) || roof.color;
  ctx.fill('evenodd');
  ctx.clip('evenodd');
  // скаты прямоугольной крыши: конёк по длинной стороне и рёбра к углам
  const ring = roof.poly[0];
  if (roof.poly.length === 1 && ring.length === 4) {
    const xs = ring.map((p) => p.x), ys = ring.map((p) => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const axis = ring.every((p) => (p.x === x0 || p.x === x1) && (p.y === y0 || p.y === y1));
    if (axis) {
      const wide = x1 - x0 >= y1 - y0, half = Math.min(x1 - x0, y1 - y0) / 2;
      const a = wide ? { x: x0 + half, y: (y0 + y1) / 2 } : { x: (x0 + x1) / 2, y: y0 + half };
      const b = wide ? { x: x1 - half, y: (y0 + y1) / 2 } : { x: (x0 + x1) / 2, y: y1 - half };
      // затенённые скаты
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.beginPath();
      if (wide) { ctx.moveTo(x0, y1); ctx.lineTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(x1, y1); }
      else { ctx.moveTo(x1, y0); ctx.lineTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(x1, y1); }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.55)';
      ctx.lineWidth = 0.06;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.moveTo(x0, y0); ctx.lineTo(a.x, a.y); ctx.lineTo(x0, y1);
      ctx.moveTo(x1, y0); ctx.lineTo(b.x, b.y); ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ---------- подписи
export function labelFont(l: Label) {
  return `${l.font === 'head' ? '600' : '400'} ${l.size}px ${l.font === 'head' ? "Oswald, 'Arial Narrow', sans-serif" : 'Inter, system-ui, sans-serif'}`;
}

/** Размер подписи (в клетках) для выделения и попадания курсором. */
export function labelBox(ctx: CanvasRenderingContext2D, l: Label): { w: number; h: number } {
  ctx.save();
  ctx.font = labelFont(l);
  const lines = l.text.split('\n');
  const w = Math.max(...lines.map((s) => ctx.measureText(s).width), l.size * 0.5);
  ctx.restore();
  return { w: w + l.size * 0.5, h: lines.length * l.size * 1.2 + l.size * 0.2 };
}

export function drawLabel(ctx: CanvasRenderingContext2D, l: Label) {
  if (!l.text.trim()) return;
  ctx.save();
  ctx.translate(l.x, l.y);
  ctx.rotate((l.rot * Math.PI) / 180);
  ctx.font = labelFont(l);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = l.text.split('\n');
  const box = labelBox(ctx, l);
  if (l.box) {
    ctx.fillStyle = 'rgba(0,0,0,.72)';
    ctx.fillRect(-box.w / 2, -box.h / 2, box.w, box.h);
    ctx.strokeStyle = l.color;
    ctx.lineWidth = l.size * 0.06;
    ctx.strokeRect(-box.w / 2, -box.h / 2, box.w, box.h);
  }
  lines.forEach((s, i) => {
    const y = (i - (lines.length - 1) / 2) * l.size * 1.2;
    if (!l.box) {
      ctx.lineWidth = l.size * 0.18;
      ctx.strokeStyle = 'rgba(0,0,0,.85)';
      ctx.lineJoin = 'round';
      ctx.strokeText(s, 0, y);
    }
    ctx.fillStyle = l.color;
    ctx.fillText(s, 0, y);
  });
  ctx.restore();
}
