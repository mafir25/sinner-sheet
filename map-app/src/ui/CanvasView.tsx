// Холст редактора: отрисовка, панорама и масштаб (колесо, щипок), передача событий инструменту.
import { useEffect, useMemo, useRef } from 'react';
import type { AssetStore } from '../assets/store';
import type { Floor, Pt } from '../model/types';
import { type Editor, useEditor } from '../state/editor';
import { drawGizmos, drawIssues, makeTool, type Tool, type ToolEnv } from '../tools/tools';
import { type Issue, floorIssues } from '../geom/place';
import { renderMap } from '../render/render';
import { tr } from '../i18n';

const MIN_SCALE = 4, MAX_SCALE = 400;

export function fitView(ed: Editor, w: number, h: number) {
  const d = ed.doc, pad = 40;
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min((w - pad * 2) / d.width, (h - pad * 2) / d.height)));
  ed.setView({ scale, ox: (w - d.width * scale) / 2, oy: (h - d.height * scale) / 2 });
}

export function CanvasView({ ed, assets, onFitRef, onMenu }: {
  ed: Editor; assets: AssetStore; onFitRef?: (fn: () => void) => void;
  /** Контекстное меню в точке экрана (правая кнопка, на планшете — долгое нажатие); только у «Выделения». */
  onMenu?: (x: number, y: number) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const status = useRef<HTMLDivElement>(null);
  const toolId = useEditor(ed, (s) => s.tool);
  const spaceDown = useRef(false);
  const cursorPt = useRef<Pt | null>(null);
  const frame = useRef(0);
  const issueCache = useRef<{ f: Floor | null; v: number; map: Map<string, Issue[]> }>({ f: null, v: -1, map: new Map() });

  const env = useMemo<ToolEnv>(() => ({
    ed, assets,
    snap: (e) => ed.state.settings.snap && !(e?.ctrlKey || e?.metaKey),
    subtract: (e) => ed.state.settings.subtract !== !!e?.altKey,
    redraw: () => schedule(),
  }), [ed, assets]); // eslint-disable-line react-hooks/exhaustive-deps
  const tool = useMemo<Tool>(() => makeTool(toolId, env), [toolId, env]);
  const toolRef = useRef(tool);
  useEffect(() => { toolRef.current.cancel?.(); toolRef.current = tool; schedule(); }, [tool]); // eslint-disable-line react-hooks/exhaustive-deps

  function draw() {
    frame.current = 0;
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const { view, doc, floorId } = ed.state;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0b0c';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.ox, dpr * view.oy);
    const vis = { x0: -view.ox / view.scale, y0: -view.oy / view.scale, x1: (c.width / dpr - view.ox) / view.scale, y1: (c.height / dpr - view.oy) / view.scale };
    // тень под картой
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.7)';
    ctx.shadowBlur = 18 * dpr;
    ctx.fillStyle = doc.background;
    ctx.fillRect(0, 0, doc.width, doc.height);
    ctx.restore();
    const { showRoofs, showLight } = ed.state.settings;
    const shown = toolRef.current.preview?.();
    renderMap(ctx, doc, floorId, assets, {
      scale: view.scale * dpr, view: vis, grid: true, ghost: true, floorOverride: shown, gridPx: dpr,
      roofs: showRoofs, lighting: showLight, gm: true,
    });
    ctx.strokeStyle = 'rgba(64,224,208,.35)';
    ctx.lineWidth = 1 / view.scale;
    ctx.strokeRect(0, 0, doc.width, doc.height);
    drawGizmos(ctx, shown ?? ed.floor, view.scale);
    if (ed.state.settings.showIssues) {
      const f = shown ?? ed.floor;
      if (issueCache.current.f !== f || issueCache.current.v !== assets.version) {
        issueCache.current = { f, v: assets.version, map: floorIssues(f, (k) => assets.entry(k)) };
      }
      drawIssues(ctx, f, issueCache.current.map, view.scale);
    }
    toolRef.current.overlay?.(ctx, view.scale);
  }
  function schedule() { if (!frame.current) frame.current = requestAnimationFrame(draw); }

  useEffect(() => ed.subscribe(schedule), [ed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => assets.subscribe(schedule), [assets]); // eslint-disable-line react-hooks/exhaustive-deps

  // размер холста = размер контейнера × devicePixelRatio
  useEffect(() => {
    const el = wrap.current!, c = canvas.current!;
    let first = true;
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.max(1, Math.round(el.clientWidth * dpr));
      c.height = Math.max(1, Math.round(el.clientHeight * dpr));
      c.style.width = `${el.clientWidth}px`;
      c.style.height = `${el.clientHeight}px`;
      if (first) { first = false; fitView(ed, el.clientWidth, el.clientHeight); }
      schedule();
    });
    ro.observe(el);
    onFitRef?.(() => fitView(ed, el.clientWidth, el.clientHeight));
    return () => ro.disconnect();
  }, [ed]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- координаты
  const toWorld = (clientX: number, clientY: number): Pt => {
    const r = canvas.current!.getBoundingClientRect(), v = ed.state.view;
    return { x: (clientX - r.left - v.ox) / v.scale, y: (clientY - r.top - v.oy) / v.scale };
  };
  const zoomAt = (clientX: number, clientY: number, k: number) => {
    const r = canvas.current!.getBoundingClientRect(), v = ed.state.view;
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * k));
    const sx = clientX - r.left, sy = clientY - r.top;
    ed.setView({ scale, ox: sx - ((sx - v.ox) * scale) / v.scale, oy: sy - ((sy - v.oy) * scale) / v.scale });
  };
  const updateStatus = (p: Pt | null) => {
    if (!status.current) return;
    const z = `${Math.round((ed.state.view.scale / 48) * 100)}%`;
    status.current.textContent = p ? `${p.x.toFixed(2)}, ${p.y.toFixed(2)} · ${z}` : z;
  };

  // ---------- указатель (мышь, перо, пальцы)
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: 'pan'; lastX: number; lastY: number } | { kind: 'pinch'; dist: number; cx: number; cy: number } | { kind: 'tool' } | null>(null);

  const longPress = useRef<{ timer: number; x: number; y: number } | null>(null);
  const stopLongPress = () => { if (longPress.current) { clearTimeout(longPress.current.timer); longPress.current = null; } };
  const openMenu = (clientX: number, clientY: number) => {
    if (!onMenu || ed.state.tool !== 'select') return false;
    toolRef.current.pick?.(toWorld(clientX, clientY));
    onMenu(clientX, clientY);
    return true;
  };

  const pinchInfo = () => {
    const [a, b] = [...pointers.current.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    canvas.current!.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      stopLongPress();
      // второй палец — отменяем действие инструмента, начинаем щипок
      if (gesture.current?.kind === 'tool') toolRef.current.cancel?.();
      gesture.current = { kind: 'pinch', ...pinchInfo() };
      return;
    }
    if (pointers.current.size > 2) return;
    const panning = e.button === 1 || spaceDown.current || ed.state.tool === 'pan';
    if (panning) {
      gesture.current = { kind: 'pan', lastX: e.clientX, lastY: e.clientY };
      canvas.current!.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;
    if (e.pointerType === 'touch' && ed.state.tool === 'select') {
      stopLongPress();
      const { clientX: x, clientY: y } = e;
      longPress.current = {
        x, y, timer: window.setTimeout(() => {
          longPress.current = null;
          toolRef.current.cancel?.();
          gesture.current = null;
          openMenu(x, y);
          schedule();
        }, 550),
      };
    }
    gesture.current = { kind: 'tool' };
    toolRef.current.down?.(toWorld(e.clientX, e.clientY), e.nativeEvent);
    schedule();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (longPress.current && Math.hypot(e.clientX - longPress.current.x, e.clientY - longPress.current.y) > 10) stopLongPress();
    const g = gesture.current;
    const p = toWorld(e.clientX, e.clientY);
    cursorPt.current = p;
    updateStatus(p);
    if (g?.kind === 'pinch' && pointers.current.size >= 2) {
      const n = pinchInfo(), v = ed.state.view;
      ed.setView({ ...v, ox: v.ox + n.cx - g.cx, oy: v.oy + n.cy - g.cy });
      if (g.dist > 0) zoomAt(n.cx, n.cy, n.dist / g.dist);
      gesture.current = { kind: 'pinch', ...n };
      return;
    }
    if (g?.kind === 'pan') {
      const v = ed.state.view;
      ed.setView({ ...v, ox: v.ox + e.clientX - g.lastX, oy: v.oy + e.clientY - g.lastY });
      gesture.current = { kind: 'pan', lastX: e.clientX, lastY: e.clientY };
      return;
    }
    toolRef.current.move?.(p, e.nativeEvent);
    canvas.current!.style.cursor = spaceDown.current || ed.state.tool === 'pan' ? 'grab' : (toolRef.current.cursor?.(p) ?? 'default');
  };

  const onPointerUp = (e: React.PointerEvent) => {
    stopLongPress();
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g?.kind === 'tool') toolRef.current.up?.(toWorld(e.clientX, e.clientY), e.nativeEvent);
    if (g?.kind === 'pinch' && pointers.current.size === 1) {
      const [rest] = [...pointers.current.values()];
      gesture.current = { kind: 'pan', lastX: rest.x, lastY: rest.y };
      return;
    }
    if (!pointers.current.size) {
      gesture.current = null;
      canvas.current!.style.cursor = toolRef.current.cursor?.(cursorPt.current) ?? 'default';
    }
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    stopLongPress();
    pointers.current.delete(e.pointerId);
    if (gesture.current?.kind === 'tool') toolRef.current.cancel?.();
    if (!pointers.current.size) gesture.current = null;
  };

  useEffect(() => {
    const c = canvas.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      zoomAt(e.clientX, e.clientY, k);
      updateStatus(cursorPt.current);
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e)) { spaceDown.current = true; c.style.cursor = 'grab'; e.preventDefault(); }
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') spaceDown.current = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { c.removeEventListener('wheel', onWheel); window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // клавиши инструмента (Enter, Backspace, Esc)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if (toolRef.current.key?.(e)) { e.preventDefault(); return; }
      if (e.key === 'Escape') { toolRef.current.cancel?.(); if (ed.state.tool !== 'select') ed.setTool('select'); else ed.setSel([]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ed]);

  return (
    <div className="canvas-wrap" ref={wrap}>
      <canvas
        ref={canvas}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={() => { cursorPt.current = null; updateStatus(null); toolRef.current.move && schedule(); }}
        onDoubleClick={(e) => toolRef.current.dbl?.(toWorld(e.clientX, e.clientY))}
        onContextMenu={(e) => { e.preventDefault(); if (e.nativeEvent instanceof PointerEvent && e.nativeEvent.pointerType === 'touch') return; if (openMenu(e.clientX, e.clientY)) schedule(); }}
        aria-label={tr('Редактор карт')}
      />
      <div className="coords" ref={status} />
    </div>
  );
}

export const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};
