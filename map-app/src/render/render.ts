// Отрисовка карты на Canvas 2D. Один и тот же код рисует экран и экспорт.
// Перед вызовом ctx должен быть переведён в координаты клеток (1 единица = 1 клетка).
import type { AssetStore } from '../assets/store';
import type { Floor, Layer, MapDoc, MapObject, Portal, Poly, Pt, Roof } from '../model/types';
import { drawGrid } from '../geom/grid';
import { faceItems, portalAsLine, portalShape, portalThickness, portalWall, wallChains, wallLift, wallLineLift, type WallChain, type WallFace } from '../geom/walls';
import { effectiveChance, pickTile, wallLine } from '../geom/variants';
import { type BBox, pointInPoly, ptsBBox } from '../geom/poly';
import { auxRes, drawLabel, drawLighting, drawPath, drawRoof, drawRoofHeight, drawTag, terrainCanvas } from './extras';
import { fmtHeight, labelSpot, levelFaces } from '../geom/levels';
import { baseOf, storeyLift, storeyParts, storeysAbove } from '../geom/storeys';
import { tr } from '../i18n';

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
  /** Угол стены, круче которого проёмы рисуются линией (MapDoc.portalAngle; ставит drawFloor). */
  portalAngle?: number;
  /** Крыши: не рисовать / полупрозрачно (редактор) / целиком. */
  roofs: 'hide' | 'ghost' | 'show';
  /** Запекать освещение (если оно включено в карте). */
  lighting: boolean;
  /** Мастерская версия: подписи и слои «только для мастера». */
  gm: boolean;
  /** Экспорт: служебные холсты в полном разрешении и без кэша. */
  exporting?: boolean;
  /** Только крыши и слои «на крыше» на прозрачном фоне — «верхний» тайл для VTT. */
  onlyRoofs?: boolean;
  /** Рисовать поверх видимые надстройки и чердаки над этажом (geom/storeys.ts). */
  storeys?: boolean;
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
  const idx = Math.max(0, doc.floors.findIndex((f) => f.id === floorId));
  if (o.onlyRoofs) {
    const f = o.floorOverride ?? doc.floors[idx];
    if (f) {
      drawRoofs(ctx, f, assets, { ...o, roofs: 'show' });
      if (o.storeys) drawStoreys(ctx, doc, f, assets, { ...o, roofs: 'show' });
    }
    return;
  }
  ctx.fillStyle = doc.background;
  ctx.fillRect(0, 0, doc.width, doc.height);
  // под надстройкой полупрозрачно — этаж, над которым она стоит; под обычным этажом — предыдущий в списке
  const cur = doc.floors[idx];
  const under = cur && (baseOf(doc, cur) ?? (idx > 0 ? doc.floors[idx - 1] : null));
  if (o.ghost && under?.visible) {
    ctx.save();
    ctx.globalAlpha = 0.28;
    drawFloor(ctx, doc, under, assets, { ...o, roofs: 'hide', lighting: false, floorOverride: undefined });
    ctx.restore();
  }
  const floor = o.floorOverride ?? cur;
  if (floor) drawFloor(ctx, doc, floor, assets, o);
  if (floor && o.storeys) drawStoreys(ctx, doc, floor, assets, o);
  if (o.grid && doc.grid.show && doc.grid.type !== 'none') {
    ctx.save();
    ctx.globalAlpha = doc.grid.opacity;
    ctx.strokeStyle = doc.grid.color;
    drawGrid(ctx, doc.grid.type, doc.width, doc.height, o.view, (o.gridPx ?? 1) / o.scale);
    ctx.restore();
  }
  if (floor) {
    for (const lv of floor.levels) if (lv.label && lv.h) drawTag(ctx, labelSpot(lv.poly), fmtHeight(lv.h, tr('фт')), lv.h > 0 ? '#9fe8c8' : '#9cc4ff');
    for (const l of floor.labels) if (o.gm || !l.gmOnly) drawLabel(ctx, l);
  }
}

export function drawFloor(ctx: CanvasRenderingContext2D, doc: MapDoc, f: Floor, assets: AssetStore, o: RenderOpts) {
  const W = doc.width, H = doc.height;
  // картинка-подложка и текстура земли
  if (f.image) {
    const im = assets.rawImage(f.image.asset);
    if (im) {
      ctx.save();
      ctx.globalAlpha *= f.image.opacity;
      ctx.drawImage(im, f.image.x, f.image.y, im.naturalWidth / f.image.ppc, im.naturalHeight / f.image.ppc);
      ctx.restore();
    }
  }
  if (f.ground) {
    const pat = assets.pattern(ctx, f.ground, o.scale);
    if (pat) { ctx.fillStyle = pat; ctx.fillRect(0, 0, W, H); }
  }
  // полы комнат
  for (const room of f.rooms) {
    if (!room.floor) continue;
    ctx.beginPath();
    polyPath(ctx, room.poly);
    ctx.fillStyle = assets.pattern(ctx, room.floor, o.scale) ?? NO_FLOOR_FILL;
    ctx.fill('evenodd');
    drawFloorVariants(ctx, room, assets, o.scale);
  }
  // местность поверх полов: грязь, кровь, вода
  const res = auxRes(o.scale, W, H, !!o.exporting);
  const terrain = terrainCanvas(f, assets, res, W, H, !o.exporting);
  if (terrain) ctx.drawImage(terrain, 0, 0, W, H);
  drawLevels(ctx, f, assets, o);
  const visible = f.layers.filter((l) => l.visible && (o.gm || !l.gmOnly) && !l.roof);
  const below = visible.filter((l) => !l.aboveWalls).map((l) => l.id);
  const above = visible.filter((l) => l.aboveWalls).map((l) => l.id);
  // грани объёмных стен — под объектами: шкаф у стены стоит «перед» её гранью
  o = { ...o, portalAngle: doc.portalAngle };
  drawFaces(ctx, f, assets, o);
  drawLayers(ctx, f, below, assets, o);
  // верхняя линия стены не прерывается над дверями, окнами и арками — режут её только проёмы без стены
  drawWalls(ctx, wallChains(f, new Set(), false), assets, o, doc.lighting.wallShadows);
  for (const p of f.portals) drawPortal(ctx, f, p, assets, o);
  drawLayers(ctx, f, above, assets, o);
  drawRoofs(ctx, f, assets, o);
  if (o.lighting && doc.lighting.enabled) drawLighting(ctx, f, doc.lighting, res, W, H, !o.exporting);
}

/** Видимые надстройки и чердаки над этажом: каждое здание поднято на высоту стен под ним, туда, где была крыша. */
function drawStoreys(ctx: CanvasRenderingContext2D, doc: MapDoc, from: Floor, assets: AssetStore, o: RenderOpts) {
  for (const up of storeysAbove(doc, from.id)) {
    for (const part of storeyParts(up)) {
      const l = part.at ? storeyLift(doc, from, up, part.at) : { x: 0, y: 0 };
      ctx.save();
      ctx.translate(l.x, l.y);
      drawFloor(ctx, doc, part.floor, assets, { ...o, lighting: false, floorOverride: undefined });
      ctx.restore();
    }
  }
}

/** Слои «на крыше» видны вместе с крышами. */
export const roofLayers = (f: Floor, o: { gm: boolean }): Layer[] => f.layers.filter((l) => l.roof && l.visible && (o.gm || !l.gmOnly));

/** Крыши (подняты на верх стен), высоты крыш для мастера и слои «на крыше». */
function drawRoofs(ctx: CanvasRenderingContext2D, f: Floor, assets: AssetStore, o: RenderOpts) {
  const layers = roofLayers(f, o).map((l) => l.id);
  if (o.roofs === 'hide' || (!f.roofs.length && !layers.length)) return;
  ctx.save();
  if (o.roofs === 'ghost') ctx.globalAlpha *= 0.55;
  for (const r of f.roofs) {
    const l = roofLift(f, r);
    ctx.save();
    ctx.translate(l.x, l.y);
    drawRoof(ctx, r, assets, o.scale);
    ctx.restore();
  }
  drawLayers(ctx, f, layers, assets, o);
  if (o.gm) {
    for (const r of f.roofs) {
      if (!r.height) continue;
      const l = roofLift(f, r);
      ctx.save();
      ctx.translate(l.x, l.y);
      drawRoofHeight(ctx, r, `⌂ ${Math.round(r.height * 10) / 10} ${tr('фт')}`);
      ctx.restore();
    }
  }
  ctx.restore();
}

/** Крыша лежит на верху стен: поднята так же, как стены комнаты под ней. */
export function roofLift(f: Floor, r: Pick<Roof, 'poly'>): Pt {
  const b = ptsBBox(r.poly[0]);
  let c = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
  if (!pointInPoly(c, r.poly)) c = { x: (r.poly[0][0].x + r.poly[0][1].x) / 2 + 0.01, y: (r.poly[0][0].y + r.poly[0][1].y) / 2 + 0.01 };
  const room = f.rooms.find((rm) => pointInPoly(c, rm.poly));
  return room ? wallLift(room.wall) : { x: 0, y: 0 };
}

/** Слои по порядку: в каждом сначала пути, потом объекты. */
function drawLayers(ctx: CanvasRenderingContext2D, f: Floor, layerOrder: string[], assets: AssetStore, o: RenderOpts) {
  for (const lid of layerOrder) {
    for (const p of f.paths) if (p.layer === lid) drawPath(ctx, p, assets, o.scale);
    for (const ob of f.objects) {
      if (ob.layer !== lid) continue;
      const r = Math.hypot(ob.w, ob.h) / 2;
      if (ob.x + r < o.view.x0 || ob.x - r > o.view.x1 || ob.y + r < o.view.y0 || ob.y - r > o.view.y1) continue;
      drawObject(ctx, ob, assets, o.scale);
    }
  }
}

export function drawObject(ctx: CanvasRenderingContext2D, ob: MapObject, assets: AssetStore, scale: number) {
  const pxPerCell = scale * Math.max(ob.w / (assets.entry(ob.asset)?.footprint[0] ?? ob.w), 0.01);
  const src = assets.source(ob.asset, pxPerCell, ob.tint);
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

/** Другие файлы группы текстуры (её варианты); без группы — пусто. */
function variantsOf(assets: AssetStore, key: string): string[] {
  return assets.variants(key).filter((k) => k !== key);
}

/**
 * Варианты пола: клетки текстуры (footprint) по сетке узора, в части из них (шанс комнаты) вместо основы — вариант.
 * Края вариантов совпадают с основой, поэтому рисуем их поверх уже залитого пола, обрезая по контуру комнаты.
 */
function drawFloorVariants(ctx: CanvasRenderingContext2D, room: Floor['rooms'][number], assets: AssetStore, scale: number) {
  const key = room.floor!, others = variantsOf(assets, key), chance = effectiveChance(room.floorVary);
  if (!others.length || chance <= 0) return;
  const [fw] = assets.entry(key)?.footprint ?? [1, 1];
  const b = ptsBBox(room.poly[0]), seed = room.floorSeed ?? 0;
  ctx.save();
  ctx.clip('evenodd');
  for (let j = Math.floor(b.y0 / fw); j * fw < b.y1; j++) {
    for (let i = Math.floor(b.x0 / fw); i * fw < b.x1; i++) {
      const v = pickTile(others, chance, seed, i, j);
      const src = v ? assets.source(v, scale) : null;
      if (src) ctx.drawImage(src, i * fw, j * fw, fw, fw);
    }
  }
  ctx.restore();
}

/**
 * Путь верхней линии стены (у объёмной — поднята над гранью, см. wallLineLift); торцы отдельных стен продлеваются
 * на полтолщины, чтобы углы смыкались.
 */
function chainPath(ctx: CanvasRenderingContext2D, c: WallChain) {
  const l = wallLineLift(c.style);
  const pts = c.pts.map((q) => ({ x: q.x + l.x, y: q.y + l.y })), e = c.style.width / 2;
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

export function drawWalls(ctx: CanvasRenderingContext2D, all: WallChain[], assets: AssetStore, o: RenderOpts, shadows = false) {
  // толщина 0 — невидимая стена: линии нет, но для света и VTT стена остаётся
  const chains = all.filter((c) => c.style.width > 0);
  ctx.save();
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 3;
  // мягкая тень под стенами
  if (shadows) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.75)';
    ctx.shadowBlur = 0.35 * o.scale;
    for (const c of chains) {
      ctx.beginPath();
      chainPath(ctx, c);
      ctx.lineWidth = c.style.width + 0.1;
      ctx.strokeStyle = '#000';
      ctx.stroke();
    }
    ctx.restore();
  }
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
    // объёмная стена — тонкая линия своего цвета, текстура уходит на грань
    ctx.strokeStyle = (c.style.height ?? 0) > 0 ? c.style.color : (c.style.asset && assets.pattern(ctx, c.style.asset, o.scale)) || c.style.color;
    ctx.stroke();
  }
  ctx.restore();
}

export function drawPortal(ctx: CanvasRenderingContext2D, f: Floor, p: Portal, assets: AssetStore, o: RenderOpts) {
  // проём без стены и пустой проём — рисовать нечего; на объёмной стене проём вписан в грань (drawFaces)
  // вставка — вариант текстуры грани: на плоской стене её не видно
  // дверь или окно на грани, которая почти ребром к зрителю (круче угла карты), или с видом «линией» тоже рисуется
  // здесь — участком линии стены, чтобы проём было видно при любом наклоне стены
  if (!portalAsLine(f, p, o.portalAngle)) return;
  const dx = p.b.x - p.a.x, dy = p.b.y - p.a.y, L = Math.hypot(dx, dy);
  if (L < 1e-6) return;
  const th = portalThickness(f, p);
  const e = p.asset ? assets.entry(p.asset) : undefined;
  // на объёмной стене без грани здесь (боковая при «вниз») проём — на поднятой верхней линии
  const w = portalWall(f, p), l = w ? wallLineLift(w.style) : { x: 0, y: 0 };
  ctx.save();
  ctx.translate((p.a.x + p.b.x) / 2 + l.x, (p.a.y + p.b.y) / 2 + l.y);
  ctx.rotate(Math.atan2(dy, dx));
  const src = p.asset ? assets.source(p.asset, o.scale * (L / (e?.footprint[0] ?? L))) as HTMLCanvasElement | HTMLImageElement | null : null;
  // Картинка «вид спереди» (двери и окна Крыльев, высота ≥ половины ширины) на стене без грани не помещается:
  // целиком она легла бы на пол наклейкой. Рисуем её участком стены — полосой чуть толще линии стены из средней
  // части картинки (створки, шов, боковые рамки), с тёмной кромкой, как у самой стены.
  const front = !!e && e.footprint[1] / e.footprint[0] >= 0.5;
  if (src && front) {
    const sw = src instanceof HTMLImageElement ? src.naturalWidth : src.width, sh = src instanceof HTMLImageElement ? src.naturalHeight : src.height;
    const h = Math.max(th * 1.5, 0.12);
    ctx.drawImage(src, 0, sh * 0.35, sw, sh * 0.3, -L / 2, -h / 2, L, h);
    ctx.lineWidth = Math.max(0.02, 1.2 / o.scale);
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeRect(-L / 2, -h / 2, L, h);
  } else if (src) {
    const h = Math.max(th, e ? (e.footprint[1] / e.footprint[0]) * L : th);
    ctx.drawImage(src, -L / 2, -h / 2, L, h);
  } else {
    ctx.fillStyle = p.kind === 'door' ? '#6b4a2f' : '#9fdde9';
    ctx.fillRect(-L / 2, -th / 2, L, th);
  }
  ctx.restore();
}

type FaceTex = { pat: CanvasPattern; w: number; h: number; fw: number };
/** Своя копия узора текстуры: ей меняем привязку под каждую грань (общий узор полов не трогаем). */
function faceTexture(ctx: CanvasRenderingContext2D, assets: AssetStore, key: string | null, scale: number, cache: Map<string, FaceTex | null>): FaceTex | null {
  if (!key) return null;
  if (cache.has(key)) return cache.get(key)!;
  const src = assets.source(key, scale) as HTMLCanvasElement | HTMLImageElement | null;
  let t: FaceTex | null = null;
  if (src) {
    const w = src instanceof HTMLImageElement ? src.naturalWidth : src.width, h = src instanceof HTMLImageElement ? src.naturalHeight : src.height;
    const pat = w && h ? ctx.createPattern(src, 'repeat') : null;
    if (pat) t = { pat, w, h, fw: assets.entry(key)?.footprint[0] ?? 1 };
  }
  cache.set(key, t);
  return t;
}

/**
 * Привязка текстуры к грани: по длине стены — плитка шириной в footprint клеток, поперёк — вся высота картинки
 * на «дальность» грани (меньше дальность — картинка сжимается). Начало — на прямой стены, общее для соседних граней.
 */
function fitTexture(t: FaceTex, p0: Pt, p1: Pt, v: Pt) {
  const L = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1, u = { x: (p1.x - p0.x) / L, y: (p1.y - p0.y) / L };
  const along = p0.x * u.x + p0.y * u.y, o = { x: p0.x - u.x * along, y: p0.y - u.y * along };
  const k = t.fw / t.w;
  t.pat.setTransform(new DOMMatrix([u.x * k, u.y * k, v.x / t.h, v.y / t.h, o.x, o.y]));
}

function shadeFace(ctx: CanvasRenderingContext2D, p0: Pt, v: Pt) {
  const g = ctx.createLinearGradient(p0.x, p0.y, p0.x + v.x, p0.y + v.y);
  g.addColorStop(0, 'rgba(255,255,255,0.06)');
  g.addColorStop(1, 'rgba(0,0,0,0.45)');
  return g;
}

/** Контур проёма в грани (единичный квадрат: x — вдоль стены, y — от линии стены к основанию грани). */
function openingShape(top: number, bottom: number, arch: boolean): Pt[] {
  const y0 = top, y1 = 1 - bottom;
  if (!arch) return [{ x: 0, y: y0 }, { x: 1, y: y0 }, { x: 1, y: y1 }, { x: 0, y: y1 }];
  const ah = Math.min((y1 - y0) * 0.6, 0.5);
  const pts: Pt[] = [{ x: 0, y: y1 }];
  for (let i = 0; i <= 16; i++) {
    const th = Math.PI - (i / 16) * Math.PI;
    pts.push({ x: 0.5 + 0.5 * Math.cos(th), y: y0 + ah - ah * Math.sin(th) });
  }
  pts.push({ x: 1, y: y1 });
  return pts;
}

/**
 * Обрезка грани: «внутрь» видна только в своей комнате, «наружу» — только вне её (на углах они не залезают
 * друг на друга). У поднятой стены (проекция) и контур комнаты поднят — как будто смотрим на высоте верха стен.
 */
export function clipFace(ctx: CanvasRenderingContext2D, face: WallFace) {
  if (!face.room) return;
  const BIG = 1e5;
  ctx.beginPath();
  if (face.side === 'out') ctx.rect(-BIG, -BIG, BIG * 2, BIG * 2);
  ctx.translate(face.lift.x, face.lift.y);
  polyPath(ctx, face.room.poly);
  ctx.translate(-face.lift.x, -face.lift.y);
  ctx.clip('evenodd');
}

/**
 * Варианты на грани: плитки текстуры вдоль стены (отсчёт как у узора — fitTexture), часть из них (шанс стиля)
 * заменяется вариантом. Раскладка не зависит от направления рисования стены (wallLine).
 */
function drawFaceVariants(ctx: CanvasRenderingContext2D, face: WallFace, t: FaceTex, assets: AssetStore, scale: number) {
  const key = face.style.asset!, others = variantsOf(assets, key), chance = effectiveChance(face.style.vary);
  if (!others.length || chance <= 0) return;
  const [p0, p1] = face.pts, L = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  if (L < 1e-6) return;
  const u = { x: (p1.x - p0.x) / L, y: (p1.y - p0.y) / L }, line = wallLine(p0, p1);
  const flip = u.x * line.u.x + u.y * line.u.y < 0;
  const a0 = p0.x * u.x + p0.y * u.y, a1 = p1.x * u.x + p1.y * u.y, o = { x: p0.x - u.x * a0, y: p0.y - u.y * a0 };
  const fw = t.fw, seed = face.style.varySeed ?? 0;
  for (let m = Math.floor(Math.min(a0, a1) / fw); m * fw < Math.max(a0, a1) - 1e-6; m++) {
    const v = pickTile(others, chance, seed, flip ? -(m + 1) : m, 0, line.salt);
    const src = v ? assets.source(v, scale * 4) : null;
    if (!src) continue;
    ctx.save();
    ctx.transform(u.x * fw, u.y * fw, face.v.x, face.v.y, o.x + u.x * m * fw, o.y + u.y * m * fw);
    ctx.drawImage(src, 0, 0, 1, 1);
    ctx.restore();
  }
}

/** Грани объёмных стен и вписанные в них двери, окна, арки, вставки. Рисуются под объектами. */
export function drawFaces(ctx: CanvasRenderingContext2D, f: Floor, assets: AssetStore, o: RenderOpts) {
  const items = faceItems(f);
  if (!items.length) return;
  const cache = new Map<string, FaceTex | null>();
  const edge = Math.max(0.025, 1.2 / o.scale);
  const quad = (pts: Pt[]) => { ctx.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y); ctx.closePath(); };
  const texture = (face: WallFace) => {
    const t = faceTexture(ctx, assets, face.style.asset, o.scale, cache);
    if (t) fitTexture(t, face.pts[0], face.pts[1], face.v);
    return t;
  };
  const hidden = new Map<string, boolean>();
  const edgeOn = (p: Portal) => {
    if (!hidden.has(p.id)) hidden.set(p.id, portalAsLine(f, p, o.portalAngle));
    return hidden.get(p.id)!;
  };
  for (const { face, portal: pt } of items) {
    // проём почти не виден на грани — грань рисуется сплошной стеной, сам проём — участком линии (drawPortal)
    const portal = pt && edgeOn(pt) ? undefined : pt;
    ctx.save();
    clipFace(ctx, face);
    const [p0, p1, p2, p3] = face.pts;
    const ex = { x: p1.x - p0.x, y: p1.y - p0.y };
    if (!portal || portal.kind === 'insert') {
      const t = texture(face);
      ctx.beginPath(); quad(face.pts);
      ctx.fillStyle = t?.pat ?? face.style.color; ctx.fill();
      ctx.save();
      ctx.clip();
      if (!pt && t) drawFaceVariants(ctx, face, t, assets, o.scale);
      // вставка: картинка варианта на всю высоту грани в пределах проёма (стена остаётся стеной)
      const src = portal?.asset ? assets.source(portal.asset, o.scale * 4) : null;
      if (src) {
        ctx.transform(ex.x, ex.y, face.v.x, face.v.y, p0.x, p0.y);
        ctx.imageSmoothingEnabled = !assets.entry(portal!.asset)?.pixelated;
        ctx.drawImage(src, 0, 0, 1, 1);
      }
      ctx.restore();
      ctx.beginPath(); quad(face.pts);
      ctx.fillStyle = shadeFace(ctx, p0, face.v); ctx.fill();
      if (!portal) {
        ctx.beginPath(); ctx.moveTo(p3.x, p3.y); ctx.lineTo(p2.x, p2.y);
        ctx.lineWidth = edge; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.stroke();
      }
    } else {
      // проём: стена вокруг выреза (перемычка, подоконник), картинка двери/окна в вырезе, кромка выреза
      const shape = portalShape(portal);
      const src = portal.asset ? assets.source(portal.asset, o.scale * 4) : null;
      const M = (q: Pt): Pt => ({ x: p0.x + ex.x * q.x + face.v.x * q.y, y: p0.y + ex.y * q.x + face.v.y * q.y });
      const hole = openingShape(shape.top, shape.bottom, shape.arch).map(M);
      ctx.beginPath(); quad(face.pts); quad(hole);
      ctx.fillStyle = texture(face)?.pat ?? face.style.color; ctx.fill('evenodd');
      ctx.fillStyle = shadeFace(ctx, p0, face.v); ctx.fill('evenodd');
      if (src) {
        ctx.save();
        ctx.beginPath(); quad(hole); ctx.clip();
        ctx.transform(ex.x, ex.y, face.v.x, face.v.y, p0.x, p0.y);
        ctx.imageSmoothingEnabled = !assets.entry(portal.asset)?.pixelated;
        ctx.drawImage(src, 0, shape.top, 1, 1 - shape.top - shape.bottom);
        ctx.restore();
      }
      ctx.beginPath(); quad(hole);
      ctx.lineWidth = edge; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.stroke();
      if (shape.bottom > 0.001 || !src) { ctx.beginPath(); ctx.moveTo(p3.x, p3.y); ctx.lineTo(p2.x, p2.y); ctx.stroke(); }
    }
    ctx.restore();
  }
}

/**
 * Уровни местности: покрытие верха, затемнение ям, грани обрывов (ближние поверх дальних), кромка.
 * Рисуются поверх пола и местности, под гранями стен и объектами.
 */
export function drawLevels(ctx: CanvasRenderingContext2D, f: Floor, assets: AssetStore, o: RenderOpts) {
  if (!f.levels.length) return;
  const sorted = [...f.levels].sort((a, b) => a.h - b.h);
  for (const lv of sorted) {
    ctx.beginPath();
    polyPath(ctx, lv.poly);
    if (lv.floor) {
      const pat = assets.pattern(ctx, lv.floor, o.scale);
      if (pat) { ctx.fillStyle = pat; ctx.fill('evenodd'); }
    }
    // яма темнее с глубиной, возвышение чуть светлее
    ctx.fillStyle = lv.h < 0 ? `rgba(0,0,0,${Math.min(0.5, 0.14 - lv.h * 0.012)})` : `rgba(255,255,255,${Math.min(0.1, 0.03 + lv.h * 0.002)})`;
    if (lv.h) ctx.fill('evenodd');
  }
  const faces = levelFaces(f).sort((a, b) => Math.max(...a.pts.map((q) => q.y)) - Math.max(...b.pts.map((q) => q.y)));
  const cache = new Map<string, FaceTex | null>();
  const edge = Math.max(0.025, 1.2 / o.scale);
  const BIG = 1e5;
  for (const face of faces) {
    ctx.save();
    // грань ямы — только внутри неё, обрыв возвышения — только снаружи
    ctx.beginPath();
    if (!face.inside) ctx.rect(-BIG, -BIG, BIG * 2, BIG * 2);
    polyPath(ctx, face.level.poly);
    ctx.clip('evenodd');
    const [p0, p1, p2, p3] = face.pts;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.closePath();
    const t = faceTexture(ctx, assets, face.level.face, o.scale, cache);
    if (t) fitTexture(t, p0, p1, face.v);
    if (!face.inside) { ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 0.3 * o.scale; ctx.shadowOffsetY = 0.12 * o.scale; }
    ctx.fillStyle = t?.pat ?? face.level.color;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = shadeFace(ctx, p0, face.v);
    ctx.fill();
    ctx.beginPath(); ctx.moveTo(p3.x, p3.y); ctx.lineTo(p2.x, p2.y);
    ctx.lineWidth = edge; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.stroke();
    ctx.restore();
  }
  // кромка участка
  ctx.save();
  ctx.lineJoin = 'round';
  for (const lv of sorted) {
    if (!lv.h) continue;
    ctx.beginPath();
    polyPath(ctx, lv.poly);
    ctx.lineWidth = edge * 1.6;
    ctx.strokeStyle = 'rgba(0,0,0,.65)';
    ctx.stroke();
    if (lv.h > 0) { ctx.lineWidth = edge * 0.8; ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.stroke(); }
  }
  ctx.restore();
}
