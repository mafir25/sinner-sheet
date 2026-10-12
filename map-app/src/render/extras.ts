// Этап 2: местность (кисти), пути, свет и тени, крыши, подписи, фон-картинка.
// Местность и карта освещения рисуются в отдельный холст размером с карту и кэшируются.
import type { AssetStore } from '../assets/store';
import type { Floor, Label, Lighting, MapPath, Pt, Roof, TerrainStroke } from '../model/types';
import { type RoofRaster, roofRaster, roofShape } from '../geom/roof';
import { pointInPoly, ptsBBox } from '../geom/poly';
import { curvePoints, offsetPolyline, roundCorners, walkAlong } from '../geom/curve';
import { blockingSegments, visibility } from '../geom/light';
import { clipFace, polyPath } from './render';
import { faceItems } from '../geom/walls';

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
  const st = p.style;
  let pts = curvePoints(p.points, p.smooth, p.closed);
  if (pts.length < 2) return;
  // у двух параллельных линий острый угол ломаной скругляем, иначе внутренняя линия завернётся петлёй
  if (st.parallel && !p.smooth) pts = roundCorners(pts, Math.max(st.parallel.gap * 1.6, st.width / 2), p.closed);
  const line = () => { ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (const q of pts.slice(1)) ctx.lineTo(q.x, q.y); };
  ctx.save();
  // у составных путей (рельсы) торцы прямые, как у самих линий
  ctx.lineCap = st.dash || st.parallel ? 'butt' : 'round';
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
  if (st.parallel) {
    const { gap, width, color, outline } = st.parallel;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';
    for (const side of [-1, 1]) {
      const q = offsetPolyline(pts, (side * gap) / 2);
      const stroke = (w: number, c: string) => {
        ctx.beginPath();
        ctx.moveTo(q[0].x, q[0].y);
        for (const r of q.slice(1)) ctx.lineTo(r.x, r.y);
        ctx.lineWidth = w;
        ctx.strokeStyle = c;
        ctx.stroke();
      };
      if (outline) stroke(width + Math.max(0.04, width * 0.5), outline);
      stroke(width, color);
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
type LightCache = { key: string; canvas: HTMLCanvasElement; glow: HTMLCanvasElement | null };
const lightCache = new WeakMap<Floor, LightCache>();

const hexRgb = (hex: string): [number, number, number] => {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex.trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255];
};

/** Многоугольники видимости источников (для теней). */
function lightShapes(f: Floor): Shape[] {
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

type Shape = { light: Floor['lights'][number]; poly: Pt[] | null };

/**
 * Рисует свет источников: «dark» — вырезает темноту (destination-out поверх уже залитой темноты), «glow» — цветное
 * свечение (lighter). ctx — в координатах клеток.
 */
function paintLights(ctx: CanvasRenderingContext2D, shapes: Shape[], mode: 'dark' | 'glow') {
  ctx.save();
  ctx.globalCompositeOperation = mode === 'dark' ? 'destination-out' : 'lighter';
  for (const { light, poly } of shapes) {
    ctx.save();
    shapePath(ctx, light, poly);
    ctx.clip();
    const gr = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, light.radius);
    if (mode === 'dark') {
      gr.addColorStop(0, `rgba(0,0,0,${light.intensity})`);
      gr.addColorStop(0.55, `rgba(0,0,0,${light.intensity * 0.75})`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
    } else {
      const [lr, lg, lb] = hexRgb(light.color);
      gr.addColorStop(0, `rgba(${lr},${lg},${lb},${0.32 * light.intensity})`);
      gr.addColorStop(1, `rgba(${lr},${lg},${lb},0)`);
    }
    ctx.fillStyle = gr;
    ctx.fillRect(light.x - light.radius, light.y - light.radius, light.radius * 2, light.radius * 2);
    ctx.restore();
  }
  ctx.restore();
}

/**
 * Свет на гранях объёмных стен. Свет считается по плану, а грань «вниз/вверх» нарисована со сдвигом: внутренняя
 * грань северной стены лежит на экране за пределами комнаты, наружная грань южной — на её полу. Поэтому грань
 * перекрашивается светом у основания стены с той стороны, куда она смотрит (полоска вдоль основания растягивается
 * на всю высоту грани). Полоска считается заново и только от источников перед гранью: лампа за стеной не светит
 * на её обратную сторону — ни сквозь окно, ни без теней. Порядок и обрезка — как при отрисовке граней.
 * dark — цвет темноты (rgba) для «dark»; для «glow» — null.
 */
function lightFaces(c: HTMLCanvasElement, f: Floor, res: number, shapes: Shape[], dark: string | null) {
  const items = faceItems(f).filter((it) => it.face.lift.x || it.face.lift.y);
  if (!items.length) return;
  const l = c.getContext('2d')!;
  const EPS = 0.06;
  for (const { face } of items) {
    const base0 = face.pts[3], base1 = face.pts[2], v = face.v;
    const L = Math.hypot(base1.x - base0.x, base1.y - base0.y);
    if (L < 1e-6) continue;
    const u = { x: (base1.x - base0.x) / L, y: (base1.y - base0.y) / L };
    let n = { x: -u.y, y: u.x };
    if (n.x * v.x + n.y * v.y < 0) n = { x: -n.x, y: -n.y }; // сторона, куда смотрит грань
    // источники перед гранью, чей круг достаёт до её основания
    const front = shapes.filter(({ light }) => {
      const dx = light.x - base0.x, dy = light.y - base0.y;
      if (dx * n.x + dy * n.y <= 1e-6) return false;
      const t = Math.max(0, Math.min(L, dx * u.x + dy * u.y));
      return Math.hypot(light.x - base0.x - u.x * t, light.y - base0.y - u.y * t) < light.radius;
    });
    const s0 = { x: base0.x + n.x * EPS, y: base0.y + n.y * EPS };
    const sw = Math.max(1, Math.ceil(L * res));
    const strip = canvas(sw, 1), sc = strip.getContext('2d')!;
    // план → полоска: x — вдоль основания, y — от основания в сторону грани
    sc.setTransform(u.x * res, n.x * res, u.y * res, n.y * res, -res * (u.x * s0.x + u.y * s0.y), -res * (n.x * s0.x + n.y * s0.y));
    if (dark) { sc.fillStyle = dark; sc.fillRect(-1e4, -1e4, 2e4, 2e4); }
    paintLights(sc, front, dark ? 'dark' : 'glow');
    l.save();
    l.setTransform(res, 0, 0, res, 0, 0);
    clipFace(l, face);
    l.beginPath();
    face.pts.forEach((q, i) => (i ? l.lineTo(q.x, q.y) : l.moveTo(q.x, q.y)));
    l.closePath();
    l.clip();
    // на месте грани — свет её основания (свечение плана здесь — это пол перед стеной, а не сама стена)
    l.clearRect(0, 0, c.width / res, c.height / res);
    l.setTransform(u.x * (L * res / sw), u.y * (L * res / sw), -v.x * res, -v.y * res, base0.x * res, base0.y * res);
    l.drawImage(strip, 0, 0);
    l.restore();
  }
}

/** Запекает освещение поверх нарисованного этажа: темнота вне света + цветное свечение. */
export function drawLighting(ctx: CanvasRenderingContext2D, f: Floor, lighting: Lighting, res: number, w: number, h: number, useCache: boolean) {
  const key = `${res}|${w}x${h}|${lighting.darkness}|${lighting.color}`;
  let lc = useCache ? lightCache.get(f) : undefined;
  if (!lc || lc.key !== key) {
    const shapes = lightShapes(f);
    const c = canvas(w * res, h * res);
    const l = c.getContext('2d')!;
    l.setTransform(res, 0, 0, res, 0, 0);
    const [r, g, b] = hexRgb(lighting.color);
    const dark = `rgba(${r},${g},${b},${lighting.darkness})`;
    l.fillStyle = dark;
    l.fillRect(0, 0, w, h);
    paintLights(l, shapes, 'dark');
    lightFaces(c, f, res, shapes, dark);
    // цветное свечение — отдельным холстом, чтобы и его перенести на грани
    let glow: HTMLCanvasElement | null = null;
    if (shapes.length) {
      glow = canvas(w * res, h * res);
      const gl = glow.getContext('2d')!;
      gl.setTransform(res, 0, 0, res, 0, 0);
      paintLights(gl, shapes, 'glow');
      lightFaces(glow, f, res, shapes, null);
    }
    lc = { key, canvas: c, glow };
    if (useCache) lightCache.set(f, lc);
  }
  ctx.drawImage(lc.canvas, 0, 0, w, h);
  if (lc.glow) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(lc.glow, 0, 0, w, h);
    ctx.restore();
  }
}

// ---------- крыши
/** Свет на крыше — с северо-запада (сверху слева): скаты к нему светлее, от него темнее. */
const SUN = { x: -0.55, y: -0.83 };

/**
 * Тени скатов и линии коньков/ендов крыши — картинка поверх кровли (кэш по крыше и разрешению).
 * Скат, обращённый к свету, светлее; граница скатов — тёмная линия.
 */
type Shade = { c: HTMLCanvasElement; r: RoofRaster } | null;
const roofShades = new WeakMap<Roof, Map<number, Shade>>();
function roofShade(roof: Roof, res: number): Shade {
  let byRes = roofShades.get(roof);
  if (!byRes) { byRes = new Map(); roofShades.set(roof, byRes); }
  if (byRes.has(res)) return byRes.get(res)!;
  const raster = roofRaster(roof, res);
  let out: Shade = null;
  if (raster) {
    const { w, h, face, dx, dy } = raster;
    const c = canvas(w, h);
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(w, h), d = img.data;
    for (let k = 0; k < w * h; k++) {
      if (face[k] < 0) continue;
      const i = k % w, j = (k - i) / w;
      const edge = (i + 1 < w && face[k + 1] >= 0 && face[k + 1] !== face[k]) || (j + 1 < h && face[k + w] >= 0 && face[k + w] !== face[k]);
      const lit = dx[k] * SUN.x + dy[k] * SUN.y;
      if (edge) { d[k * 4 + 3] = 150; continue; }
      if (lit > 0) { d[k * 4] = d[k * 4 + 1] = d[k * 4 + 2] = 255; d[k * 4 + 3] = Math.round(26 * lit); }
      else d[k * 4 + 3] = Math.round(-90 * lit);
    }
    ctx.putImageData(img, 0, 0);
    out = { c, r: raster };
  }
  byRes.set(res, out);
  return out;
}

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
  if (roofShape(roof) === 'flat') {
    // плоская крыша: парапет по краю
    ctx.beginPath();
    polyPath(ctx, roof.poly);
    ctx.lineJoin = 'miter';
    ctx.lineWidth = 0.42; ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.stroke();
    ctx.lineWidth = 0.3; ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.stroke();
  } else if (roofShape(roof) === 'shed') {
    // односкатная: светлее у высокого края, темнее у низкого, по низкому краю — водосток
    const b = ptsBBox(roof.poly[0]), f = roof.fall ?? 's';
    const [x0, y0, x1, y1] = f === 's' ? [b.x0, b.y0, b.x0, b.y1] : f === 'n' ? [b.x0, b.y1, b.x0, b.y0] : f === 'e' ? [b.x0, b.y0, b.x1, b.y0] : [b.x1, b.y0, b.x0, b.y0];
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    const gut = Math.max(0.5, 1 - 0.15 / Math.max(0.3, Math.hypot(x1 - x0, y1 - y0)));
    g.addColorStop(0, 'rgba(255,255,255,.1)');
    g.addColorStop(gut, 'rgba(0,0,0,.28)');
    g.addColorStop(gut, 'rgba(0,0,0,.5)');
    g.addColorStop(1, 'rgba(0,0,0,.5)');
    ctx.fillStyle = g;
    ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
  } else {
    // скаты: растр не мельче 8 и не крупнее 48 пикселей на клетку
    const res = Math.max(8, Math.min(48, 2 ** Math.round(Math.log2(Math.max(1, scale)))));
    const sh = roofShade(roof, res);
    if (sh) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(sh.c, sh.r.x0, sh.r.y0, sh.r.w / sh.r.res, sh.r.h / sh.r.res);
    }
  }
  ctx.restore();
}

/** Подпись высоты крыши для мастера: «⌂ 20 фт». */
export function drawRoofHeight(ctx: CanvasRenderingContext2D, roof: Roof, text: string) {
  const b = ptsBBox(roof.poly[0]);
  let p = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
  if (!pointInPoly(p, roof.poly)) p = roof.poly[0][0];
  drawTag(ctx, p, text, '#ffe08a');
}

/** Небольшая надпись на тёмной подложке (высоты уровней и крыш). */
export function drawTag(ctx: CanvasRenderingContext2D, p: Pt, text: string, color: string) {
  const size = 0.42;
  ctx.save();
  ctx.font = `600 ${size}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + size * 0.7, h = size * 1.35;
  ctx.fillStyle = 'rgba(0,0,0,.7)';
  ctx.beginPath();
  ctx.roundRect(p.x - w / 2, p.y - h / 2, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(text, p.x, p.y + size * 0.04);
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
