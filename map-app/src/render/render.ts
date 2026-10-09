// Отрисовка карты на Canvas 2D. Один и тот же код рисует экран и экспорт.
// Перед вызовом ctx должен быть переведён в координаты клеток (1 единица = 1 клетка).
import type { AssetStore } from '../assets/store';
import type { Floor, MapDoc, MapObject, Portal, Poly, Pt } from '../model/types';
import { drawGrid } from '../geom/grid';
import { portalThickness, wallChains, type WallChain } from '../geom/walls';
import type { BBox } from '../geom/poly';

export type RenderOpts = {
  /** Пикселей на клетку — для выбора разрешения SVG и толщины линий сетки. */
  scale: number;
  /** Видимая область в клетках. */
  view: BBox;
  grid: boolean;
  /** Показывать нижний этаж полупрозрачно. */
  ghost: boolean;
  /** Подмена этажа (предпросмотр перетаскивания). */
  floorOverride?: Floor;
  /** Толщина линии сетки в пикселях. */
  gridPx?: number;
};

const NO_FLOOR_FILL = '#2f2f33';

export function polyPath(ctx: CanvasRenderingContext2D, poly: Poly) {
  for (const ring of poly) {
    ctx.moveTo(ring[0].x, ring[0].y);
    for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i].x, ring[i].y);
    ctx.closePath();
  }
}

export function renderMap(ctx: CanvasRenderingContext2D, doc: MapDoc, floorId: string, assets: AssetStore, o: RenderOpts) {
  ctx.fillStyle = doc.background;
  ctx.fillRect(0, 0, doc.width, doc.height);
  const idx = Math.max(0, doc.floors.findIndex((f) => f.id === floorId));
  if (o.ghost && idx > 0 && doc.floors[idx - 1].visible) {
    ctx.save();
    ctx.globalAlpha = 0.28;
    drawFloor(ctx, doc.floors[idx - 1], assets, o);
    ctx.restore();
  }
  const floor = o.floorOverride ?? doc.floors[idx];
  if (floor) drawFloor(ctx, floor, assets, o);
  if (o.grid && doc.grid.show && doc.grid.type !== 'none') {
    ctx.save();
    ctx.globalAlpha = doc.grid.opacity;
    ctx.strokeStyle = doc.grid.color;
    drawGrid(ctx, doc.grid.type, doc.width, doc.height, o.view, (o.gridPx ?? 1) / o.scale);
    ctx.restore();
  }
}

export function drawFloor(ctx: CanvasRenderingContext2D, f: Floor, assets: AssetStore, o: RenderOpts) {
  // полы комнат
  for (const room of f.rooms) {
    if (!room.floor) continue;
    ctx.beginPath();
    polyPath(ctx, room.poly);
    ctx.fillStyle = assets.pattern(ctx, room.floor, o.scale) ?? NO_FLOOR_FILL;
    ctx.fill('evenodd');
  }
  const visible = f.layers.filter((l) => l.visible);
  const below = visible.filter((l) => !l.aboveWalls).map((l) => l.id);
  const above = visible.filter((l) => l.aboveWalls).map((l) => l.id);
  drawObjects(ctx, f.objects, below, assets, o);
  drawWalls(ctx, wallChains(f), assets, o);
  for (const p of f.portals) drawPortal(ctx, f, p, assets, o);
  drawObjects(ctx, f.objects, above, assets, o);
}

function drawObjects(ctx: CanvasRenderingContext2D, objs: MapObject[], layerOrder: string[], assets: AssetStore, o: RenderOpts) {
  for (const lid of layerOrder) {
    for (const ob of objs) {
      if (ob.layer !== lid) continue;
      const r = Math.hypot(ob.w, ob.h) / 2;
      if (ob.x + r < o.view.x0 || ob.x - r > o.view.x1 || ob.y + r < o.view.y0 || ob.y - r > o.view.y1) continue;
      drawObject(ctx, ob, assets, o.scale);
    }
  }
}

export function drawObject(ctx: CanvasRenderingContext2D, ob: MapObject, assets: AssetStore, scale: number) {
  const pxPerCell = scale * Math.max(ob.w / (assets.entry(ob.asset)?.footprint[0] ?? ob.w), 0.01);
  const src = assets.source(ob.asset, pxPerCell);
  ctx.save();
  ctx.translate(ob.x, ob.y);
  ctx.rotate((ob.rot * Math.PI) / 180);
  ctx.scale(ob.flipX ? -1 : 1, ob.flipY ? -1 : 1);
  ctx.globalAlpha *= ob.opacity;
  if (src) {
    ctx.imageSmoothingEnabled = !assets.entry(ob.asset)?.pixelated;
    ctx.drawImage(src, -ob.w / 2, -ob.h / 2, ob.w, ob.h);
  } else if (assets.isMissing(ob.asset)) {
    missing(ctx, -ob.w / 2, -ob.h / 2, ob.w, ob.h);
  }
  ctx.restore();
}

function missing(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = 'rgba(199,36,58,.25)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#C7243A';
  ctx.lineWidth = 0.04;
  ctx.setLineDash([0.12, 0.08]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
  ctx.fillStyle = '#ff7b8b';
  ctx.font = `${Math.min(w, h) * 0.6}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', x + w / 2, y + h / 2);
}

/** Путь стены; торцы отдельных стен продлеваются на полтолщины, чтобы углы смыкались. */
function chainPath(ctx: CanvasRenderingContext2D, c: WallChain) {
  const pts = c.pts.slice(), e = c.style.width / 2;
  const ext = (from: Pt, to: Pt): Pt => {
    const dx = to.x - from.x, dy = to.y - from.y, L = Math.hypot(dx, dy) || 1;
    return { x: to.x + (dx / L) * e, y: to.y + (dy / L) * e };
  };
  if (!c.closed && c.capStart) pts[0] = ext(pts[1], pts[0]);
  if (!c.closed && c.capEnd) pts[pts.length - 1] = ext(pts[pts.length - 2], pts[pts.length - 1]);
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  if (c.closed) ctx.closePath();
}

export function drawWalls(ctx: CanvasRenderingContext2D, chains: WallChain[], assets: AssetStore, o: RenderOpts) {
  ctx.save();
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 3;
  // тёмный контур под стенами
  for (const c of chains) {
    ctx.beginPath();
    chainPath(ctx, c);
    ctx.lineWidth = c.style.width + Math.max(0.03, 1.5 / o.scale);
    ctx.strokeStyle = '#050505';
    ctx.stroke();
  }
  for (const c of chains) {
    ctx.beginPath();
    chainPath(ctx, c);
    ctx.lineWidth = c.style.width;
    ctx.strokeStyle = (c.style.asset && assets.pattern(ctx, c.style.asset, o.scale)) || c.style.color;
    ctx.stroke();
  }
  ctx.restore();
}

export function drawPortal(ctx: CanvasRenderingContext2D, f: Floor, p: Portal, assets: AssetStore, o: RenderOpts) {
  const dx = p.b.x - p.a.x, dy = p.b.y - p.a.y, L = Math.hypot(dx, dy);
  if (L < 1e-6) return;
  const th = portalThickness(f, p);
  const e = p.asset ? assets.entry(p.asset) : undefined;
  const h = Math.max(th, e ? (e.footprint[1] / e.footprint[0]) * L : th);
  ctx.save();
  ctx.translate((p.a.x + p.b.x) / 2, (p.a.y + p.b.y) / 2);
  ctx.rotate(Math.atan2(dy, dx));
  const src = p.asset ? assets.source(p.asset, o.scale * (L / (e?.footprint[0] ?? L))) : null;
  if (src) ctx.drawImage(src, -L / 2, -h / 2, L, h);
  else {
    ctx.fillStyle = p.kind === 'door' ? '#6b4a2f' : '#9fdde9';
    ctx.fillRect(-L / 2, -th / 2, L, th);
  }
  ctx.restore();
}
