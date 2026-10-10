// Инструменты холста. Координаты — в клетках. Пока идёт перетаскивание, документ не меняется:
// инструмент отдаёт предпросмотр (preview), а в историю попадает одно изменение при отпускании.
import type { AssetStore } from '../assets/store';
import type { AssetEntry, Floor, Label, Light, MapObject, MapPath, Poly, Portal, Pt, Roof, Rules, TerrainStroke } from '../model/types';
import { type Editor, type SelItem, type ToolId, edgeOf } from '../state/editor';
import { uid } from '../model/doc';
import { snapCenter, snapHalf, snapVertex } from '../geom/grid';
import { difference, intersects, pointInPoly, rectPoly, ringArea, samePt, segDist, touches, union } from '../geom/poly';
import { type WallSeg, nearestWall, orphanPortals, portalOnWall } from '../geom/walls';
import { LIGHT_HIT, boxSelect, fromLocal, hitTest, labelCorners, objectCorners, toLocal } from './hit';
import { curvePoints } from '../geom/curve';
import { drawObject, polyPath } from '../render/render';
import { drawPath, drawStrokePreview } from '../render/extras';
import { tr } from '../i18n';
import { setBounds } from '../assets/tree.js';
import { type Issue, checkObject, placeByRules, rollVariation } from '../geom/place';
import { issueText } from '../ui/issues';
import { fmtLen, pathSteps, polyLen, segLen } from '../geom/measure';
import type { GridType } from '../model/types';

export type ToolEnv = {
  ed: Editor;
  assets: AssetStore;
  /** Привязка включена (кнопка «Привязка») и не зажат Ctrl. */
  snap(e?: { ctrlKey?: boolean; metaKey?: boolean }): boolean;
  /** Режим вырезания: кнопка «Вырезать» или зажатый Alt. */
  subtract(e?: { altKey?: boolean }): boolean;
  redraw(): void;
};

export interface Tool {
  down?(p: Pt, e: PointerEvent): void;
  move?(p: Pt, e: PointerEvent): void;
  up?(p: Pt, e: PointerEvent): void;
  dbl?(p: Pt): void;
  key?(e: KeyboardEvent): boolean;
  cancel?(): void;
  overlay?(c: CanvasRenderingContext2D, scale: number): void;
  preview?(): Floor | undefined;
  cursor?(p: Pt | null): string;
}

const ACCENT = '#40E0D0', RED = '#ff5068', YELLOW = '#F1C40F';
const sub = (a: Pt, b: Pt) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Pt, b: Pt) => ({ x: a.x + b.x, y: a.y + b.y });
const shiftPoly = (p: Poly, d: Pt): Poly => p.map((r) => r.map((q) => add(q, d)));

// ---------- комнаты: слияние и вырезание
/**
 * Новая форма комнаты. Комнаты того же стиля (пол + стена), которые она задевает, сливаются с ней;
 * у комнат другого стиля форма вырезается — между ними остаётся стена. subtract — вырезать из всех.
 */
export function applyRoom(ed: Editor, shape: Poly, subtract: boolean) {
  if (Math.abs(ringArea(shape[0])) < 1e-6) return;
  const { floor, wall } = ed.state.settings;
  const sameStyle = (r: Floor['rooms'][number]) => r.floor === floor && r.wall.asset === wall.asset && r.wall.color === wall.color && r.wall.width === wall.width
    && (r.wall.height ?? 0) === (wall.height ?? 0) && r.wall.inner === wall.inner && r.wall.outer === wall.outer;
  ed.commitFloor((f) => {
    const out: Floor['rooms'] = [];
    const merge: Floor['rooms'] = [];
    for (const r of f.rooms) {
      if (!subtract && sameStyle(r) && touches(r.poly, shape)) { merge.push(r); continue; }
      if (intersects(r.poly, shape)) {
        difference(r.poly, shape).forEach((poly, i) => out.push({ ...r, id: i === 0 ? r.id : uid('r'), poly }));
      } else out.push(r);
    }
    if (!subtract) {
      const merged = union(shape, ...merge.map((r) => r.poly));
      merged.forEach((poly, i) => {
        // настройки отдельных стен переходят к слитой комнате (те, чьё ребро сохранилось)
        const edgeStyles = merge.flatMap((m) => m.edgeStyles ?? []);
        out.push({ id: merge[i]?.id ?? uid('r'), poly, floor, wall: { ...wall }, ...(merge[i]?.type ? { type: merge[i].type } : {}), ...(edgeStyles.length ? { edgeStyles } : {}) });
      });
    }
    f.rooms = out;
    const orphans = orphanPortals(f);
    f.portals = f.portals.filter((p) => !orphans.has(p.id));
  }, { keepSel: false });
}

// ---------- общие куски отрисовки
function outlinePts(c: CanvasRenderingContext2D, pts: Pt[], closed: boolean) {
  c.beginPath();
  c.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
  if (closed) c.closePath();
}
function dot(c: CanvasRenderingContext2D, p: Pt, r: number, fill: string) {
  c.beginPath();
  c.arc(p.x, p.y, r, 0, Math.PI * 2);
  c.fillStyle = fill;
  c.fill();
}

export function drawSelection(c: CanvasRenderingContext2D, f: Floor, sel: SelItem[], scale: number) {
  const px = 1 / scale;
  const ids = new Set(sel.map((s) => s.id));
  c.save();
  c.lineWidth = 2 * px;
  c.strokeStyle = ACCENT;
  c.setLineDash([6 * px, 4 * px]);
  for (const r of f.rooms) if (ids.has(r.id)) { c.beginPath(); polyPath(c, r.poly); c.stroke(); }
  for (const s of sel) {
    if (s.kind !== 'edge') continue;
    const e = edgeOf(f, s.id);
    if (!e) continue;
    c.save(); c.setLineDash([]); c.lineWidth = 4 * px; c.strokeStyle = YELLOW; outlinePts(c, [e.a, e.b], false); c.stroke(); c.restore();
  }
  for (const w of f.walls) if (ids.has(w.id)) { outlinePts(c, w.points, w.closed); c.stroke(); }
  for (const r of f.roofs) if (ids.has(r.id)) { c.beginPath(); polyPath(c, r.poly); c.stroke(); }
  for (const pa of f.paths) {
    if (!ids.has(pa.id)) continue;
    outlinePts(c, curvePoints(pa.points, pa.smooth, pa.closed), false);
    c.stroke();
    for (const q of pa.points) dot(c, q, 3.5 * px, ACCENT);
  }
  for (const l of f.lights) {
    if (!ids.has(l.id)) continue;
    c.beginPath();
    c.arc(l.x, l.y, l.radius, 0, Math.PI * 2);
    c.stroke();
  }
  c.setLineDash([]);
  for (const l of f.labels) if (ids.has(l.id)) { outlinePts(c, labelCorners(l), true); c.stroke(); }
  for (const o of f.objects) if (ids.has(o.id)) { outlinePts(c, objectCorners(o), true); c.stroke(); }
  c.lineWidth = 4 * px;
  c.strokeStyle = YELLOW;
  for (const p of f.portals) if (ids.has(p.id)) { outlinePts(c, [p.a, p.b], false); c.stroke(); }
  // ручки поворота и масштаба у одиночного объекта
  const objs = f.objects.filter((o) => ids.has(o.id));
  if (sel.length === 1 && objs.length === 1) {
    const h = handles(objs[0], scale);
    c.lineWidth = 1.5 * px;
    c.strokeStyle = ACCENT;
    outlinePts(c, [fromLocal(objs[0], { x: 0, y: -objs[0].h / 2 }), h.rotate], false);
    c.stroke();
    dot(c, h.rotate, 6 * px, ACCENT);
    c.fillStyle = ACCENT;
    c.fillRect(h.scale.x - 5 * px, h.scale.y - 5 * px, 10 * px, 10 * px);
  }
  c.restore();
}

function handles(o: MapObject, scale: number) {
  return {
    rotate: fromLocal(o, { x: 0, y: -o.h / 2 - 22 / scale }),
    scale: fromLocal(o, { x: o.w / 2, y: o.h / 2 }),
  };
}

/** Этаж, где выделенное (ids) и прикреплённые к стенам проёмы (att) сдвинуты на d. */
export function moveFloor(f: Floor, ids: Set<string>, att: Set<string>, d: Pt): Floor {
  const mv = (q: Pt) => add(q, d);
  return {
    ...f,
    objects: f.objects.map((o) => (ids.has(o.id) ? { ...o, x: o.x + d.x, y: o.y + d.y } : o)),
    rooms: f.rooms.map((r) => (ids.has(r.id) ? {
      ...r, poly: shiftPoly(r.poly, d),
      ...(r.edgeStyles ? { edgeStyles: r.edgeStyles.map((e) => ({ ...e, a: add(e.a, d), b: add(e.b, d) })) } : {}),
    } : r)),
    roofs: f.roofs.map((r) => (ids.has(r.id) ? { ...r, poly: shiftPoly(r.poly, d) } : r)),
    walls: f.walls.map((w) => (ids.has(w.id) ? { ...w, points: w.points.map(mv) } : w)),
    paths: f.paths.map((w) => (ids.has(w.id) ? { ...w, points: w.points.map(mv) } : w)),
    portals: f.portals.map((pt) => (att.has(pt.id) || ids.has(pt.id) ? { ...pt, a: mv(pt.a), b: mv(pt.b) } : pt)),
    lights: f.lights.map((l) => (ids.has(l.id) ? { ...l, x: l.x + d.x, y: l.y + d.y } : l)),
    labels: f.labels.map((l) => (ids.has(l.id) ? { ...l, x: l.x + d.x, y: l.y + d.y } : l)),
  };
}

// ---------- выделение
class SelectTool implements Tool {
  private mode: 'idle' | 'move' | 'box' | 'rotate' | 'scale' = 'idle';
  private start: Pt = { x: 0, y: 0 };
  private cur: Pt = { x: 0, y: 0 };
  private delta: Pt = { x: 0, y: 0 };
  private moved = false;
  private clickedSelected: SelItem | null = null;
  private attached = new Set<string>(); // проёмы на перемещаемых стенах
  private target: MapObject | null = null;
  private edited: MapObject | null = null;
  private shift = false;
  constructor(private env: ToolEnv) {}

  private get ed() { return this.env.ed; }

  cursor(p: Pt | null) {
    if (this.mode === 'move') return 'move';
    if (!p) return 'default';
    const o = this.single();
    if (o) {
      const h = handles(o, this.ed.state.view.scale), r = 9 / this.ed.state.view.scale;
      if (Math.hypot(p.x - h.rotate.x, p.y - h.rotate.y) < r) return 'grab';
      if (Math.hypot(p.x - h.scale.x, p.y - h.scale.y) < r) return 'nwse-resize';
    }
    return hitTest(this.ed.floor, p, this.ed.state.view.scale, this.roofsOn(), this.band) ? 'pointer' : 'default';
  }

  private roofsOn() { return this.ed.state.settings.showRoofs !== 'hide'; }
  private band = (key: string) => this.env.assets.entry(key)?.footprint[1] ?? 1;

  private single(): MapObject | null {
    const s = this.ed.state.sel;
    if (s.length !== 1 || s[0].kind !== 'object') return null;
    return this.ed.floor.objects.find((o) => o.id === s[0].id) ?? null;
  }

  down(p: Pt, e: PointerEvent) {
    this.start = p; this.cur = p; this.delta = { x: 0, y: 0 }; this.moved = false; this.shift = e.shiftKey;
    const scale = this.ed.state.view.scale;
    const o = this.single();
    if (o) {
      const h = handles(o, scale), r = 9 / scale;
      if (Math.hypot(p.x - h.rotate.x, p.y - h.rotate.y) < r) { this.mode = 'rotate'; this.target = o; this.edited = o; return; }
      if (Math.hypot(p.x - h.scale.x, p.y - h.scale.y) < r) { this.mode = 'scale'; this.target = o; this.edited = o; return; }
    }
    const hit = hitTest(this.ed.floor, p, scale, this.roofsOn(), this.band);
    if (!hit) {
      this.mode = 'box';
      if (!e.shiftKey) this.ed.setSel([]);
      return;
    }
    const sel = this.ed.state.sel;
    const isSel = sel.some((s) => s.id === hit.id);
    if (e.shiftKey) {
      this.ed.setSel(isSel ? sel.filter((s) => s.id !== hit.id) : [...sel, hit]);
      this.mode = 'idle';
      return;
    }
    this.clickedSelected = isSel ? hit : null;
    if (!isSel) this.ed.setSel([hit]);
    this.mode = 'move';
    this.computeAttached();
  }

  private computeAttached() {
    const f = this.ed.floor;
    const ids = new Set(this.ed.state.sel.map((s) => s.id));
    const part: Floor = { ...f, rooms: f.rooms.filter((r) => ids.has(r.id)), walls: f.walls.filter((w) => ids.has(w.id)) };
    const orphans = orphanPortals(part);
    this.attached = new Set(f.portals.filter((p) => !orphans.has(p.id) && (part.rooms.length || part.walls.length)).map((p) => p.id));
  }

  move(p: Pt, e: PointerEvent) {
    this.cur = p;
    if (this.mode === 'move') {
      const raw = sub(p, this.start);
      if (!this.moved && Math.hypot(raw.x, raw.y) * this.ed.state.view.scale < 4) return;
      this.moved = true;
      this.delta = this.snapDelta(raw, e);
    } else if (this.mode === 'rotate' && this.target) {
      let a = (Math.atan2(p.y - this.target.y, p.x - this.target.x) * 180) / Math.PI + 90;
      if (this.env.snap(e)) a = Math.round(a / 15) * 15;
      this.edited = { ...this.target, rot: ((a % 360) + 360) % 360 };
    } else if (this.mode === 'scale' && this.target) {
      const t = this.target, l = toLocal(t, p);
      let w = Math.max(0.1, Math.abs(l.x) * 2), h = Math.max(0.1, Math.abs(l.y) * 2);
      if (!e.shiftKey) { const k = Math.max(w / t.w, h / t.h); w = t.w * k; h = t.h * k; }
      if (this.env.snap(e) && !this.env.assets.entry(t.asset)?.scalable) {
        const k = Math.max(0.25, Math.round((w / t.w) * 4) / 4);
        if (!e.shiftKey) { w = t.w * k; h = t.h * k; }
      }
      this.edited = { ...t, w, h };
    }
    this.env.redraw();
  }

  private snapDelta(raw: Pt, e: PointerEvent): Pt {
    if (!this.env.snap(e)) return raw;
    const f = this.ed.floor, type = this.ed.doc.grid.type;
    const ids = new Set(this.ed.state.sel.map((s) => s.id));
    const o = f.objects.find((x) => ids.has(x.id));
    if (o) return sub(snapCenter(type, add(o, raw), o.w, o.h, o.rot), o);
    const r = f.rooms.find((x) => ids.has(x.id)) ?? f.roofs.find((x) => ids.has(x.id));
    const anchor = r ? r.poly[0][0] : (f.walls.find((x) => ids.has(x.id)) ?? f.paths.find((x) => ids.has(x.id)))?.points[0];
    if (anchor) return sub(snapVertex(type, add(anchor, raw)), anchor);
    const point = f.lights.find((x) => ids.has(x.id)) ?? f.labels.find((x) => ids.has(x.id));
    if (point) return sub(snapHalf(type, add(point, raw)), point);
    return raw;
  }

  up(p: Pt) {
    const ed = this.ed;
    if (this.mode === 'move') {
      if (this.moved && (this.delta.x || this.delta.y)) {
        const d = this.delta, ids = new Set(ed.state.sel.map((s) => s.id)), att = this.attached;
        ed.commitFloor((f) => { Object.assign(f, moveFloor(f, ids, att, d)); });
      } else if (!this.moved && this.clickedSelected) {
        ed.setSel([this.clickedSelected]);
      }
    } else if (this.mode === 'box') {
      const box = { x0: Math.min(this.start.x, p.x), y0: Math.min(this.start.y, p.y), x1: Math.max(this.start.x, p.x), y1: Math.max(this.start.y, p.y) };
      if ((box.x1 - box.x0) * ed.state.view.scale > 3 || (box.y1 - box.y0) * ed.state.view.scale > 3) {
        const found = boxSelect(ed.floor, box);
        const prev = this.shift ? ed.state.sel : [];
        const seen = new Set(prev.map((s) => s.id));
        ed.setSel([...prev, ...found.filter((s) => !seen.has(s.id))]);
      }
    } else if ((this.mode === 'rotate' || this.mode === 'scale') && this.edited && this.target && this.edited !== this.target) {
      const e2 = this.edited;
      ed.commitFloor((f) => { const o = f.objects.find((x) => x.id === e2.id); if (o) Object.assign(o, e2); });
    }
    this.reset();
    this.env.redraw();
  }

  private reset() {
    this.mode = 'idle'; this.moved = false; this.delta = { x: 0, y: 0 }; this.target = null; this.edited = null;
    this.clickedSelected = null; this.attached = new Set();
  }
  cancel() { this.reset(); this.env.redraw(); }

  preview(): Floor | undefined {
    const f = this.ed.floor;
    if (this.mode === 'move' && this.moved) {
      return moveFloor(f, new Set(this.ed.state.sel.map((s) => s.id)), this.attached, this.delta);
    }
    if ((this.mode === 'rotate' || this.mode === 'scale') && this.edited) {
      const e2 = this.edited;
      return { ...f, objects: f.objects.map((o) => (o.id === e2.id ? e2 : o)) };
    }
    return undefined;
  }

  overlay(c: CanvasRenderingContext2D, scale: number) {
    const f = this.preview() ?? this.ed.floor;
    drawSelection(c, f, this.ed.state.sel, scale);
    if (this.mode === 'box') {
      const px = 1 / scale;
      c.save();
      c.fillStyle = 'rgba(64,224,208,.08)';
      c.strokeStyle = ACCENT;
      c.lineWidth = px;
      c.setLineDash([4 * px, 3 * px]);
      const x = Math.min(this.start.x, this.cur.x), y = Math.min(this.start.y, this.cur.y);
      c.fillRect(x, y, Math.abs(this.cur.x - this.start.x), Math.abs(this.cur.y - this.start.y));
      c.strokeRect(x, y, Math.abs(this.cur.x - this.start.x), Math.abs(this.cur.y - this.start.y));
      c.restore();
    }
  }
}

// ---------- комната прямоугольником
class RoomRectTool implements Tool {
  private a: Pt | null = null;
  private b: Pt | null = null;
  private hover: Pt | null = null;
  private cut = false;
  constructor(private env: ToolEnv) {}
  private snap(p: Pt, e: PointerEvent) { return this.env.snap(e) ? snapVertex(this.env.ed.doc.grid.type, p) : p; }
  cursor() { return 'crosshair'; }
  down(p: Pt, e: PointerEvent) { this.a = this.snap(p, e); this.b = this.a; this.cut = this.env.subtract(e); }
  move(p: Pt, e: PointerEvent) {
    this.hover = this.snap(p, e);
    if (this.a) { this.b = this.hover; this.cut = this.env.subtract(e); }
    this.env.redraw();
  }
  up() {
    if (this.a && this.b && this.a.x !== this.b.x && this.a.y !== this.b.y) applyRoom(this.env.ed, rectPoly(this.a, this.b), this.cut);
    this.a = this.b = null;
    this.env.redraw();
  }
  cancel() { this.a = this.b = null; this.env.redraw(); }
  overlay(c: CanvasRenderingContext2D, scale: number) {
    const px = 1 / scale;
    if (this.hover && !this.a) dot(c, this.hover, 4 * px, ACCENT);
    if (!this.a || !this.b) return;
    const col = this.cut ? RED : ACCENT;
    c.save();
    c.fillStyle = this.cut ? 'rgba(255,80,104,.15)' : 'rgba(64,224,208,.15)';
    c.strokeStyle = col;
    c.lineWidth = 2 * px;
    const x = Math.min(this.a.x, this.b.x), y = Math.min(this.a.y, this.b.y), w = Math.abs(this.b.x - this.a.x), h = Math.abs(this.b.y - this.a.y);
    c.fillRect(x, y, w, h);
    c.strokeRect(x, y, w, h);
    label(c, `${round2(w)} × ${round2(h)}`, { x: x + w / 2, y: y + h / 2 }, scale, col);
    c.restore();
  }
}

const round2 = (v: number) => Math.round(v * 100) / 100;
function label(c: CanvasRenderingContext2D, text: string, at: Pt, scale: number, color: string) {
  c.save();
  c.font = `${13 / scale}px Inter, sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.lineWidth = 3 / scale;
  c.strokeStyle = '#000';
  c.strokeText(text, at.x, at.y);
  c.fillStyle = color;
  c.fillText(text, at.x, at.y);
  c.restore();
}

// ---------- ломаная: комната-многоугольник и стена
class PathTool implements Tool {
  private pts: Pt[] = [];
  private hover: Pt | null = null;
  private cut = false;
  constructor(private env: ToolEnv, private kind: 'poly' | 'wall' | 'path') {}
  private snap(p: Pt, e: { ctrlKey?: boolean; metaKey?: boolean }) { return this.env.snap(e) ? snapVertex(this.env.ed.doc.grid.type, p) : p; }
  cursor() { return 'crosshair'; }
  down(p: Pt, e: PointerEvent) {
    const q = this.snap(p, e);
    this.cut = this.env.subtract(e);
    const scale = this.env.ed.state.view.scale;
    // щелчок по первой точке — замкнуть
    if (this.pts.length >= 3 && Math.hypot(q.x - this.pts[0].x, q.y - this.pts[0].y) * scale < 10) { this.finish(true); return; }
    if (this.pts.length && samePt(q, this.pts[this.pts.length - 1])) return;
    this.pts.push(q);
    this.env.redraw();
  }
  move(p: Pt, e: PointerEvent) { this.hover = this.snap(p, e); this.cut = this.env.subtract(e); this.env.redraw(); }
  dbl() { this.finish(this.kind === 'poly'); }
  key(e: KeyboardEvent) {
    if (e.key === 'Enter') { this.finish(this.kind === 'poly'); return true; }
    if (e.key === 'Backspace' && this.pts.length) { this.pts.pop(); this.env.redraw(); return true; }
    return false;
  }
  private finish(closed: boolean) {
    const pts = this.pts.filter((q, i) => i === 0 || !samePt(q, this.pts[i - 1]));
    this.pts = [];
    const ed = this.env.ed;
    if (this.kind === 'poly') {
      if (pts.length >= 3) applyRoom(ed, [pts], this.cut);
    } else if (this.kind === 'path') {
      if (pts.length >= 2) {
        const { style, smooth } = ed.state.settings.path;
        const path: MapPath = { id: uid('pa'), layer: ed.state.layerId, points: pts, smooth, closed: closed && pts.length >= 3, style: { ...style } };
        ed.commitFloor((f) => { f.paths.push(path); });
      }
    } else if (pts.length >= 2) {
      const closedWall = closed && pts.length >= 3;
      const id = uid('w');
      ed.commitFloor((f) => { f.walls.push({ id, points: pts, closed: closedWall, wall: { ...ed.state.settings.wall } }); });
    }
    this.env.redraw();
  }
  cancel() { this.pts = []; this.env.redraw(); }
  overlay(c: CanvasRenderingContext2D, scale: number) {
    const px = 1 / scale;
    const col = this.kind === 'poly' && this.cut ? RED : ACCENT;
    if (this.hover) dot(c, this.hover, 4 * px, col);
    if (!this.pts.length) return;
    const pts = this.hover ? [...this.pts, this.hover] : this.pts;
    if (this.kind === 'path') {
      const { style, smooth } = this.env.ed.state.settings.path;
      c.save();
      c.globalAlpha = 0.75;
      drawPath(c, { id: '', layer: '', points: pts, smooth, closed: false, style }, this.env.assets, scale);
      c.restore();
      for (const q of this.pts) dot(c, q, 3.5 * px, col);
      dot(c, this.pts[0], 6 * px, YELLOW);
      lengthLabels(c, pts, scale, col);
      return;
    }
    c.save();
    c.strokeStyle = col;
    c.lineWidth = this.kind === 'wall' ? this.env.ed.state.settings.wall.width : 2 * px;
    if (this.kind === 'wall') c.globalAlpha = 0.6;
    outlinePts(c, pts, false);
    c.stroke();
    c.globalAlpha = 1;
    if (this.kind === 'poly' && pts.length >= 3) {
      c.fillStyle = this.cut ? 'rgba(255,80,104,.12)' : 'rgba(64,224,208,.12)';
      outlinePts(c, pts, true);
      c.fill();
    }
    for (const q of this.pts) dot(c, q, 3.5 * px, col);
    dot(c, this.pts[0], 6 * px, YELLOW);
    c.restore();
    lengthLabels(c, pts, scale, col);
  }
}

/** Длина последнего отрезка (посередине) и, если отрезков больше одного, всего пути (у конца). */
function lengthLabels(c: CanvasRenderingContext2D, pts: Pt[], scale: number, color: string) {
  if (pts.length < 2) return;
  const a = pts[pts.length - 2], b = pts[pts.length - 1];
  const seg = segLen(a, b);
  if (seg > 1e-6) label(c, fmtLen(seg, tr('кл'), tr('фт')), { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 12 / scale }, scale, color);
  if (pts.length > 2) label(c, `Σ ${fmtLen(polyLen(pts), tr('кл'), tr('фт'))}`, { x: b.x, y: b.y + 18 / scale }, scale, YELLOW);
}

// ---------- линейка: щелчки ставят точки, протяжка — один отрезок; Enter / двойной щелчок — закончить, Esc — убрать
class RulerTool implements Tool {
  private pts: Pt[] = [];
  private hover: Pt | null = null;
  private done = false;
  private downAt: Pt | null = null;
  constructor(private env: ToolEnv) {}
  private get grid(): GridType { return this.env.ed.doc.grid.type; }
  private snap(p: Pt, e: { ctrlKey?: boolean; metaKey?: boolean }) { return this.env.snap(e) ? snapCenter(this.grid, p) : p; }
  cursor() { return 'crosshair'; }
  down(p: Pt, e: PointerEvent) {
    if (this.done) { this.pts = []; this.done = false; }
    const q = this.snap(p, e);
    if (!this.pts.length || !samePt(q, this.pts[this.pts.length - 1])) this.pts.push(q);
    this.downAt = q;
    this.env.redraw();
  }
  move(p: Pt, e: PointerEvent) { if (!this.done) { this.hover = this.snap(p, e); this.env.redraw(); } }
  up(p: Pt, e: PointerEvent) {
    const q = this.snap(p, e);
    // протяжка — отрезок от точки нажатия до отпускания, измерение закончено
    if (this.downAt && segLen(this.downAt, q) > 0.3) { this.pts.push(q); this.done = true; this.hover = null; }
    this.downAt = null;
    this.env.redraw();
  }
  dbl() { this.done = true; this.hover = null; this.env.redraw(); }
  key(e: KeyboardEvent) {
    if (e.key === 'Enter') { this.dbl(); return true; }
    if (e.key === 'Backspace' && this.pts.length && !this.done) { this.pts.pop(); this.env.redraw(); return true; }
    return false;
  }
  cancel() { this.pts = []; this.hover = null; this.done = false; this.env.redraw(); }
  overlay(c: CanvasRenderingContext2D, scale: number) {
    const px = 1 / scale;
    if (this.hover && !this.done) dot(c, this.hover, 4 * px, YELLOW);
    const pts = this.hover && !this.done && this.pts.length ? [...this.pts, this.hover] : this.pts;
    if (!pts.length) return;
    c.save();
    c.strokeStyle = YELLOW;
    c.lineWidth = 2 * px;
    c.setLineDash([6 * px, 4 * px]);
    outlinePts(c, pts, false);
    c.stroke();
    c.restore();
    for (const q of pts) dot(c, q, 3.5 * px, YELLOW);
    if (pts.length < 2) return;
    const end = pts[pts.length - 1];
    const steps = pathSteps(this.grid, pts);
    const lines = [fmtLen(polyLen(pts), tr('кл'), tr('фт'))];
    if (steps !== null) lines.push(tr('по сетке: {0} кл · {1} фт', steps, steps * 5));
    lines.forEach((t, i) => label(c, t, { x: end.x, y: end.y + (18 + i * 16) / scale }, scale, i ? ACCENT : YELLOW));
  }
}

// ---------- двери и окна
class PortalTool implements Tool {
  private place: { a: Pt; b: Pt } | null = null;
  constructor(private env: ToolEnv, private kind: Portal['kind']) {}
  private asset() { return this.kind === 'door' ? this.env.ed.state.settings.door : this.env.ed.state.settings.window; }
  private len() { return this.env.assets.entry(this.asset())?.footprint[0] ?? 1; }
  cursor() { return this.place ? 'copy' : 'not-allowed'; }
  move(p: Pt, e: PointerEvent) {
    const hit = nearestWall(this.env.ed.floor, p, 0.75);
    this.place = hit ? portalOnWall(hit, this.len(), this.env.snap(e)) : null;
    this.env.redraw();
  }
  down(p: Pt, e: PointerEvent) {
    this.move(p, e);
    const pl = this.place;
    if (!pl) return;
    const id = uid('d'), kind = this.kind, asset = this.asset();
    this.env.ed.commitFloor((f) => {
      // проём на месте другого проёма заменяет его
      f.portals = f.portals.filter((q) => !(near(q.a, pl.a) && near(q.b, pl.b)) && !(near(q.a, pl.b) && near(q.b, pl.a)));
      f.portals.push({ id, kind, a: pl.a, b: pl.b, asset });
    });
  }
  cancel() { this.place = null; }
  overlay(c: CanvasRenderingContext2D, scale: number) {
    if (!this.place) return;
    c.save();
    c.strokeStyle = this.kind === 'door' ? YELLOW : ACCENT;
    c.lineWidth = Math.max(5 / scale, 0.18);
    c.globalAlpha = 0.85;
    outlinePts(c, [this.place.a, this.place.b], false);
    c.stroke();
    c.restore();
  }
}
const near = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y) < 0.05;

// ---------- объект из библиотеки (или комплект)
type Made = { objs: MapObject[]; guide?: Pt[]; issues: Issue[] };
type Roll = ReturnType<typeof rollVariation> & { variant: string };
const wrapDeg = (a: number) => ((a % 360) + 360) % 360;

class StampTool implements Tool {
  private at: Pt | null = null;
  private mods: { ctrlKey?: boolean; altKey?: boolean } = {};
  private roll: Roll | null = null;
  private rollFor = '';
  constructor(private env: ToolEnv) {}
  cursor() { const s = this.env.ed.state.settings; return s.stamp || s.stampSet ? 'copy' : 'not-allowed'; }

  /** Слой: объекты «над стенами» — в слой над стенами, остальные — в текущий. */
  private layerFor(e: AssetEntry | undefined): string {
    const ed = this.env.ed, f = ed.floor;
    const cur = f.layers.find((l) => l.id === ed.state.layerId) ?? f.layers[0];
    const wantAbove = e?.layer === 'above';
    return (cur.aboveWalls === wantAbove ? cur : (f.layers.find((l) => l.aboveWalls === wantAbove && !l.locked) ?? cur)).id;
  }

  /** Случайные вариации держатся, пока не поставили объект, — предпросмотр показывает то, что встанет. */
  private currentRoll(key: string, rules: Rules | undefined): Roll {
    const vary = this.env.ed.state.settings.vary;
    const id = `${key}|${vary}`;
    if (!this.roll || this.rollFor !== id) {
      const variants = vary ? this.env.assets.variants(key) : [key];
      this.roll = { ...rollVariation(vary ? rules : undefined), variant: variants[Math.floor(Math.random() * variants.length)] };
      this.rollFor = id;
    }
    return this.roll;
  }

  /** Что встанет в точке p: объекты, направляющая правила (стена, угол) и нарушения правил. */
  private make(p: Pt, e: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): Made | null {
    const ed = this.env.ed, s = ed.state.settings, assets = this.env.assets, f = ed.floor, type = ed.doc.grid.type;
    const useRules = s.rules && !e.altKey, snap = this.env.snap(e);
    const found = assets.set(s.stampSet);
    if (found) {
      const { pack, set } = found;
      const b = setBounds(set, (path) => pack.byPath.get(path)?.footprint);
      let rot = s.stampRot, c = snap ? snapCenter(type, p, b.w, b.h, rot) : p, guide: Pt[] | undefined;
      const pl = useRules && set.rules ? placeByRules(f, p, b.w, b.h, rot, set.rules, snap) : null;
      if (pl) { c = pl; rot = pl.rot; guide = pl.guide; }
      const a = (rot * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
      const objs = set.items.map((it): MapObject => {
        const ie = pack.byPath.get(it.path);
        let lx = it.x - b.cx, irot = it.rot, iflip = it.flip;
        const ly = it.y - b.cy;
        if (s.stampFlip) { lx = -lx; irot = -irot; iflip = !iflip; }
        const [fw, fh] = ie?.footprint ?? [1, 1];
        return {
          id: uid('o'), asset: assets.key(pack.id, it.path), layer: this.layerFor(ie),
          x: c.x + lx * cos - ly * sin, y: c.y + lx * sin + ly * cos, w: fw * it.scale, h: fh * it.scale,
          rot: wrapDeg(irot + rot), flipX: iflip, flipY: false, opacity: 1,
        };
      });
      return { objs, guide, issues: [] };
    }
    if (!s.stamp) return null;
    const entry = assets.entry(s.stamp);
    const roll = this.currentRoll(s.stamp, entry?.rules);
    const ve = assets.entry(roll.variant) ?? entry;
    const [fw, fh] = ve?.footprint ?? [1, 1];
    const w = fw * roll.scale, h = fh * roll.scale;
    let rot = wrapDeg(s.stampRot + roll.rot), c = snap ? snapCenter(type, p, w, h, rot) : p, guide: Pt[] | undefined;
    const pl = useRules && entry?.rules ? placeByRules(f, p, w, h, rot, entry.rules, snap) : null;
    if (pl) { c = { x: pl.x, y: pl.y }; rot = pl.rot; guide = pl.guide; }
    const o: MapObject = {
      id: uid('o'), asset: roll.variant, layer: this.layerFor(ve), x: c.x, y: c.y, w, h, rot,
      flipX: s.stampFlip !== roll.flip, flipY: false, opacity: 1, ...(roll.tint ? { tint: roll.tint } : {}),
    };
    const issues = useRules ? checkObject({ ...f, objects: [...f.objects, o] }, o, (k) => assets.entry(k)) : [];
    return { objs: [o], guide, issues };
  }

  move(p: Pt, e: PointerEvent) { this.at = p; this.mods = { ctrlKey: e.ctrlKey || e.metaKey, altKey: e.altKey }; this.env.redraw(); }
  down(p: Pt, e: PointerEvent) {
    const m = this.make(p, e);
    if (!m) return;
    this.env.ed.commitFloor((f) => { f.objects.push(...m.objs); });
    this.roll = null; // следующий объект — с новыми вариациями
  }
  cancel() { this.at = null; }
  overlay(c: CanvasRenderingContext2D, scale: number) {
    if (!this.at) return;
    const m = this.make(this.at, this.mods);
    if (!m) return;
    c.save();
    if (m.guide) {
      c.strokeStyle = YELLOW;
      c.lineWidth = 3 / scale;
      c.setLineDash([6 / scale, 4 / scale]);
      outlinePts(c, m.guide, m.guide.length > 3);
      c.stroke();
      c.setLineDash([]);
    }
    c.globalAlpha = 0.6;
    for (const o of m.objs) drawObject(c, o, this.env.assets, scale);
    c.globalAlpha = 1;
    c.strokeStyle = m.issues.length ? RED : ACCENT;
    c.lineWidth = (m.issues.length ? 2 : 1) / scale;
    for (const o of m.objs) { outlinePts(c, objectCorners(o), true); c.stroke(); }
    if (m.issues.length) {
      const o = m.objs[0];
      label(c, issueText(this.env.assets, m.issues[0]), { x: o.x, y: o.y - Math.max(o.w, o.h) / 2 - 14 / scale }, scale, '#ff9aa6');
    }
    c.restore();
  }
}

/** Объекты с нарушенными правилами: красная рамка и «!». */
export function drawIssues(c: CanvasRenderingContext2D, f: Floor, issues: Map<string, Issue[]>, scale: number) {
  if (!issues.size) return;
  const hidden = new Set(f.layers.filter((l) => !l.visible).map((l) => l.id));
  c.save();
  c.strokeStyle = RED;
  c.lineWidth = 1.5 / scale;
  c.setLineDash([4 / scale, 3 / scale]);
  for (const o of f.objects) {
    if (!issues.has(o.id) || hidden.has(o.layer)) continue;
    const cs = objectCorners(o);
    outlinePts(c, cs, true);
    c.stroke();
    const top = cs.reduce((a, b) => (b.y < a.y || (b.y === a.y && b.x > a.x) ? b : a));
    dot(c, top, 7 / scale, RED);
    c.fillStyle = '#fff';
    c.font = `bold ${10 / scale}px Inter, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('!', top.x, top.y + 0.5 / scale);
  }
  c.restore();
}

// ---------- кисть местности
class BrushTool implements Tool {
  private stroke: TerrainStroke | null = null;
  private hover: Pt | null = null;
  private erase = false;
  constructor(private env: ToolEnv) {}
  private get set() { return this.env.ed.state.settings.brush; }
  cursor() { return 'none'; }
  down(p: Pt, e: PointerEvent) {
    const b = this.set;
    this.erase = b.erase !== e.altKey;
    if (!this.erase && !b.asset) return;
    this.stroke = { id: uid('t'), asset: this.erase ? null : b.asset, size: b.size, softness: b.softness, opacity: b.opacity, points: [p] };
    this.env.redraw();
  }
  move(p: Pt, e: PointerEvent) {
    this.hover = p;
    this.erase = this.set.erase !== e.altKey;
    const s = this.stroke;
    if (s) {
      const last = s.points[s.points.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) >= Math.max(0.05, s.size * 0.12)) s.points.push(p);
    }
    this.env.redraw();
  }
  up() {
    const s = this.stroke;
    this.stroke = null;
    if (s) this.env.ed.commitFloor((f) => { f.terrain.push(s); });
  }
  cancel() { this.stroke = null; this.env.redraw(); }
  overlay(c: CanvasRenderingContext2D, scale: number) {
    if (this.stroke) drawStrokePreview(c, this.stroke, this.env.assets, scale);
    if (!this.hover) return;
    c.save();
    c.strokeStyle = this.erase ? RED : ACCENT;
    c.lineWidth = 1.5 / scale;
    c.beginPath();
    c.arc(this.hover.x, this.hover.y, this.set.size / 2, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([3 / scale, 3 / scale]);
    c.beginPath();
    c.arc(this.hover.x, this.hover.y, (this.set.size / 2) * (1 - this.set.softness * 0.45), 0, Math.PI * 2);
    c.stroke();
    c.restore();
  }
}

// ---------- свет
class LightTool implements Tool {
  private hover: Pt | null = null;
  constructor(private env: ToolEnv) {}
  cursor() { return 'copy'; }
  private at(p: Pt, e: { ctrlKey?: boolean; metaKey?: boolean }) { return this.env.snap(e) ? snapHalf(this.env.ed.doc.grid.type, p) : p; }
  move(p: Pt, e: PointerEvent) { this.hover = this.at(p, e); this.env.redraw(); }
  down(p: Pt, e: PointerEvent) {
    const q = this.at(p, e);
    const l: Light = { id: uid('li'), x: q.x, y: q.y, ...this.env.ed.state.settings.light };
    this.env.ed.commitFloor((f) => { f.lights.push(l); });
  }
  cancel() { this.hover = null; }
  overlay(c: CanvasRenderingContext2D, scale: number) {
    if (!this.hover) return;
    const s = this.env.ed.state.settings.light;
    c.save();
    c.strokeStyle = s.color;
    c.lineWidth = 1.5 / scale;
    c.setLineDash([5 / scale, 4 / scale]);
    c.beginPath();
    c.arc(this.hover.x, this.hover.y, s.radius, 0, Math.PI * 2);
    c.stroke();
    c.restore();
    bulb(c, this.hover, s.color, scale);
  }
}

function bulb(c: CanvasRenderingContext2D, p: Pt, color: string, scale: number) {
  const r = Math.max(LIGHT_HIT * 0.7, 7 / scale);
  c.save();
  c.beginPath();
  c.arc(p.x, p.y, r, 0, Math.PI * 2);
  c.fillStyle = color;
  c.fill();
  c.lineWidth = 2 / scale;
  c.strokeStyle = '#000';
  c.stroke();
  c.restore();
}

/** Значки источников света и проёмов без стены — видны в редакторе, в экспорт не попадают. */
export function drawGizmos(c: CanvasRenderingContext2D, f: Floor, scale: number) {
  for (const l of f.lights) bulb(c, l, l.color, scale);
  const gaps = f.portals.filter((p) => p.kind === 'gap');
  if (!gaps.length) return;
  c.save();
  c.strokeStyle = 'rgba(255,80,104,.7)';
  c.lineWidth = 1.5 / scale;
  c.setLineDash([4 / scale, 4 / scale]);
  for (const g of gaps) { outlinePts(c, [g.a, g.b], false); c.stroke(); }
  c.restore();
}

// ---------- убрать стену: проём без стены (гараж, навес)
class WallCutTool implements Tool {
  private hover: { seg: WallSeg; len: number; t: number } | null = null;
  private gapHover: Portal | null = null;
  private seg: WallSeg | null = null;
  private start = 0;
  private cur = 0;
  constructor(private env: ToolEnv) {}
  cursor() { return this.hover || this.gapHover ? 'pointer' : 'not-allowed'; }
  private gapAt(p: Pt) { return this.env.ed.floor.portals.find((g) => g.kind === 'gap' && segDist(p, g.a, g.b).d < Math.max(0.15, 6 / this.env.ed.state.view.scale)) ?? null; }
  private along(p: Pt, e: { ctrlKey?: boolean; metaKey?: boolean }) {
    const s = this.seg!, L = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
    let t = segDist(p, s.a, s.b).t * L;
    if (this.env.snap(e)) t = Math.round(t * 2) / 2;
    return Math.max(0, Math.min(L, t));
  }
  move(p: Pt, e: PointerEvent) {
    if (this.seg) this.cur = this.along(p, e);
    else {
      this.gapHover = this.gapAt(p);
      const h = this.gapHover ? null : nearestWall(this.env.ed.floor, p, 0.5);
      this.hover = h ? { seg: h.seg, len: h.len, t: h.t * h.len } : null;
    }
    this.env.redraw();
  }
  down(p: Pt, e: PointerEvent) {
    const g = this.gapAt(p);
    if (g) { this.env.ed.commitFloor((f) => { f.portals = f.portals.filter((x) => x.id !== g.id); }); this.gapHover = null; return; }
    const h = nearestWall(this.env.ed.floor, p, 0.5);
    if (!h) return;
    this.seg = h.seg;
    this.start = this.cur = this.along(p, e);
  }
  up() {
    const s = this.seg;
    this.seg = null;
    if (!s) return;
    const L = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
    // щелчок — вся стена от угла до угла, протяжка — участок
    let t0 = Math.min(this.start, this.cur), t1 = Math.max(this.start, this.cur);
    if ((t1 - t0) * this.env.ed.state.view.scale < 6) { t0 = 0; t1 = L; }
    if (t1 - t0 < 0.1) return;
    const at = (t: number): Pt => ({ x: s.a.x + ((s.b.x - s.a.x) * t) / L, y: s.a.y + ((s.b.y - s.a.y) * t) / L });
    const gap: Portal = { id: uid('d'), kind: 'gap', a: at(t0), b: at(t1), asset: null };
    this.env.ed.commitFloor((f) => {
      // двери и окна внутри убранного участка исчезают вместе со стеной
      f.portals = f.portals.filter((q) => {
        const da = segDist(q.a, s.a, s.b), db = segDist(q.b, s.a, s.b);
        if (da.d > 0.03 || db.d > 0.03) return true;
        const q0 = Math.min(da.t, db.t) * L, q1 = Math.max(da.t, db.t) * L;
        return q1 <= t0 + 0.01 || q0 >= t1 - 0.01;
      });
      f.portals.push(gap);
    });
    this.env.redraw();
  }
  cancel() { this.seg = null; this.hover = null; this.gapHover = null; this.env.redraw(); }
  overlay(c: CanvasRenderingContext2D, scale: number) {
    c.save();
    c.lineWidth = Math.max(5 / scale, 0.15);
    if (this.gapHover) {
      c.strokeStyle = 'rgba(46,204,113,.85)';
      outlinePts(c, [this.gapHover.a, this.gapHover.b], false); c.stroke();
      label(c, tr('Вернуть стену'), { x: (this.gapHover.a.x + this.gapHover.b.x) / 2, y: (this.gapHover.a.y + this.gapHover.b.y) / 2 - 16 / scale }, scale, '#2ecc71');
    } else if (this.seg) {
      const s = this.seg, L = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
      const at = (t: number): Pt => ({ x: s.a.x + ((s.b.x - s.a.x) * t) / L, y: s.a.y + ((s.b.y - s.a.y) * t) / L });
      const whole = Math.abs(this.cur - this.start) * scale < 6;
      c.strokeStyle = RED;
      outlinePts(c, whole ? [s.a, s.b] : [at(this.start), at(this.cur)], false); c.stroke();
    } else if (this.hover) {
      c.strokeStyle = 'rgba(255,80,104,.6)';
      outlinePts(c, [this.hover.seg.a, this.hover.seg.b], false); c.stroke();
    }
    c.restore();
  }
}

// ---------- подпись
class LabelTool implements Tool {
  constructor(private env: ToolEnv) {}
  cursor() { return 'text'; }
  down(p: Pt, e: PointerEvent) {
    const ed = this.env.ed, s = ed.state.settings.label;
    const q = this.env.snap(e) ? snapHalf(ed.doc.grid.type, p) : p;
    let text: string | null;
    if (s.numbering) {
      text = String(s.next);
      ed.setSettings({ label: { ...s, next: s.next + 1 } });
    } else {
      text = window.prompt(tr('Текст подписи'), '');
    }
    if (!text || !text.trim()) return;
    const { numbering: _n, next: _x, ...style } = s;
    const l: Label = { id: uid('lb'), x: q.x, y: q.y, text: text.trim(), rot: 0, ...style };
    ed.commitFloor((f) => { f.labels.push(l); });
    if (!s.numbering) ed.setSel([{ kind: 'label', id: l.id }]);
  }
}

// ---------- крыша: щелчок по комнате — крыша по её форме, протянуть — прямоугольник
class RoofTool implements Tool {
  private a: Pt | null = null;
  private b: Pt | null = null;
  private hoverRoom: Poly | null = null;
  constructor(private env: ToolEnv) {}
  cursor() { return 'crosshair'; }
  private snap(p: Pt, e: PointerEvent) { return this.env.snap(e) ? snapVertex(this.env.ed.doc.grid.type, p) : p; }
  down(p: Pt, e: PointerEvent) { this.a = this.snap(p, e); this.b = this.a; }
  move(p: Pt, e: PointerEvent) {
    if (this.a) this.b = this.snap(p, e);
    this.hoverRoom = this.env.ed.floor.rooms.find((r) => pointInPoly(p, r.poly))?.poly ?? null;
    this.env.redraw();
  }
  up(p: Pt) {
    const ed = this.env.ed, { asset, color } = ed.state.settings.roof;
    const a = this.a, b = this.b;
    this.a = this.b = null;
    let poly: Poly | null = null;
    if (a && b && a.x !== b.x && a.y !== b.y) poly = rectPoly(a, b);
    else poly = ed.floor.rooms.find((r) => pointInPoly(p, r.poly))?.poly ?? null;
    if (!poly) return;
    const roof: Roof = { id: uid('rf'), poly: poly.map((r) => r.map((q) => ({ ...q }))), asset, color };
    ed.commitFloor((f) => { f.roofs.push(roof); });
    if (ed.state.settings.showRoofs === 'hide') ed.setSettings({ showRoofs: 'ghost' });
  }
  cancel() { this.a = this.b = null; this.env.redraw(); }
  overlay(c: CanvasRenderingContext2D, scale: number) {
    c.save();
    c.strokeStyle = YELLOW;
    c.lineWidth = 2 / scale;
    c.setLineDash([6 / scale, 4 / scale]);
    if (this.a && this.b && (this.a.x !== this.b.x || this.a.y !== this.b.y)) {
      const r = rectPoly(this.a, this.b);
      c.beginPath(); polyPath(c, r); c.stroke();
    } else if (this.hoverRoom) {
      c.beginPath(); polyPath(c, this.hoverRoom); c.stroke();
    }
    c.restore();
  }
}

class PanTool implements Tool {
  cursor() { return 'grab'; }
}

export function makeTool(id: ToolId, env: ToolEnv): Tool {
  switch (id) {
    case 'select': return new SelectTool(env);
    case 'room': return new RoomRectTool(env);
    case 'poly': return new PathTool(env, 'poly');
    case 'wall': return new PathTool(env, 'wall');
    case 'door': return new PortalTool(env, 'door');
    case 'window': return new PortalTool(env, 'window');
    case 'cut': return new WallCutTool(env);
    case 'stamp': return new StampTool(env);
    case 'brush': return new BrushTool(env);
    case 'path': return new PathTool(env, 'path');
    case 'light': return new LightTool(env);
    case 'label': return new LabelTool(env);
    case 'roof': return new RoofTool(env);
    case 'ruler': return new RulerTool(env);
    default: return new PanTool();
  }
}
