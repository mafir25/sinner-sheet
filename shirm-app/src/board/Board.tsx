// Доска: зум/панорама (d3-zoom), рамки, связи (SVG), узлы (DOM), выделение рамкой, перетаскивание, миникарта.
import { memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from 'react';
import { select } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { type BoardStore, useBoard } from '../state/boardStore';
import { type FrameItem, type Item, type LinkItem, type NodeItem, NODE_BASE, isFrame, isLink, isNode, nodeRadius, uid } from '../model/schema';
export { NODE_BASE, nodeRadius };
import { Minimap } from './Minimap';
import { Physics, type SimNode } from './physics';

export type BoardHandle = {
  fitView: (ids?: string[]) => void;
  focusNode: (id: string) => void;
  screenToWorld: (cx: number, cy: number) => { x: number; y: number };
  viewCenter: () => { x: number; y: number };
};

export type CtxTarget =
  | { type: 'background'; x: number; y: number }
  | { type: 'node'; id: string; x: number; y: number }
  | { type: 'frame'; id: string; x: number; y: number };

type Props = {
  store: BoardStore;
  onContextMenu: (target: CtxTarget, clientX: number, clientY: number) => void;
  onEditNode: (id: string) => void;
  onEditFrame: (id: string) => void;
  onLinkTarget: (from: string, to: string) => void;
  onActivate: () => void;
  /** нарисована рамка (режим рисования) */
  onFrameDrawn: (rect: { x: number; y: number; w: number; h: number }) => void;
};

const LS_PHYS = 'shirm.physics';
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* */ } };

/** Концы связи с учётом радиусов узлов */
export function linkGeometry(ax: number, ay: number, ar: number, bx: number, by: number, br: number) {
  const dx = bx - ax, dy = by - ay; const len = Math.hypot(dx, dy) || 1;
  const ra = ar + 2, rb = br + 4;
  return { x1: ax + (dx / len) * ra, y1: ay + (dy / len) * ra, x2: bx - (dx / len) * rb, y2: by - (dy / len) * rb, mx: (ax + bx) / 2, my: (ay + by) / 2 };
}


export const Board = forwardRef<BoardHandle, Props>(function Board(props, ref) {
  const { store, onContextMenu, onEditNode, onEditFrame, onLinkTarget, onActivate, onFrameDrawn } = props;
  const st = useBoard(store);
  const rootRef = useRef<HTMLDivElement>(null);
  const vpRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<ZoomBehavior<HTMLDivElement, unknown>>();
  const tRef = useRef<ZoomTransform>(zoomIdentity);
  const zoomSubs = useRef(new Set<(t: ZoomTransform) => void>());
  const [marquee, setMarquee] = useState<null | { x0: number; y0: number; x1: number; y1: number; mode: 'select' | 'frame' }>(null);
  const drawRef = useRef(false);
  drawRef.current = st.drawFrame;

  // ---------------------------------------------------------- физика
  const [physicsOn, setPhysicsOn] = useState(() => lsGet(LS_PHYS) !== '0');
  const physOnRef = useRef(physicsOn); physOnRef.current = physicsOn;
  const vis = useRef(new Map<string, { x: number; y: number }>());
  const physRef = useRef<Physics | null>(null);
  if (!physRef.current) {
    physRef.current = new Physics((simNodes: Map<string, SimNode>) => {
      const root = rootRef.current; if (!root || !physOnRef.current) return;
      for (const n of simNodes.values()) vis.current.set(n.id, { x: n.x!, y: n.y! });
      root.querySelectorAll<HTMLElement>('.node[data-node-id]').forEach((el) => {
        const p = vis.current.get(el.dataset.nodeId!); if (!p) return;
        el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
      });
      root.querySelectorAll<SVGGElement>('g[data-link-id]').forEach((g) => {
        const a = simNodes.get(g.dataset.from!), b = simNodes.get(g.dataset.to!);
        if (!a || !b) return;
        const geo = linkGeometry(a.x!, a.y!, a.r, b.x!, b.y!, b.r);
        const line = g.firstElementChild as SVGLineElement | null;
        if (line) { line.setAttribute('x1', String(geo.x1)); line.setAttribute('y1', String(geo.y1)); line.setAttribute('x2', String(geo.x2)); line.setAttribute('y2', String(geo.y2)); }
        const text = g.querySelector('text');
        if (text) { text.setAttribute('x', String(geo.mx)); text.setAttribute('y', String(geo.my)); }
      });
    });
  }
  useEffect(() => () => physRef.current?.stop(), []);

  // ---------------------------------------------------------- зум
  useEffect(() => {
    const root = rootRef.current!;
    const z = d3zoom<HTMLDivElement, unknown>()
      .scaleExtent([0.04, 4])
      .filter((e: any) => {
        if (e.type === 'wheel') return true;
        if (e.button || e.shiftKey || e.ctrlKey || drawRef.current) return false;
        const t = e.target as HTMLElement;
        return !t.closest('[data-drag], .no-pan');
      })
      .on('zoom', (e) => {
        tRef.current = e.transform;
        const { x, y, k } = e.transform;
        if (vpRef.current) vpRef.current.style.transform = `translate(${x}px,${y}px) scale(${k})`;
        root.style.setProperty('--k', String(k));
        root.style.setProperty('--ls', String(Math.max(1, Math.min(1 / k, 2.6))));
        root.style.backgroundPosition = `${x}px ${y}px`;
        root.style.backgroundSize = `${24 * k}px ${24 * k}px`;
        root.classList.toggle('lod-far', k < 0.2);
        zoomSubs.current.forEach((f) => f(e.transform));
      });
    zoomRef.current = z;
    select(root).call(z).on('dblclick.zoom', null);
    return () => { select(root).on('.zoom', null); };
  }, []);

  const setTransform = useCallback((t: ZoomTransform) => {
    select(rootRef.current!).call(zoomRef.current!.transform, t);
  }, []);

  const fitView = useCallback((ids?: string[]) => {
    const root = rootRef.current; if (!root) return;
    const items = Object.values(store.state.items).filter((it) => !ids || ids.includes(it.id));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const it of items) {
      if (isNode(it)) { const r = nodeRadius(it) + 40; x0 = Math.min(x0, it.x - r); x1 = Math.max(x1, it.x + r); y0 = Math.min(y0, it.y - r); y1 = Math.max(y1, it.y + r + 20); }
      else if (isFrame(it)) { x0 = Math.min(x0, it.x); y0 = Math.min(y0, it.y); x1 = Math.max(x1, it.x + it.w); y1 = Math.max(y1, it.y + it.h); }
    }
    const W = root.clientWidth, H = root.clientHeight;
    if (!isFinite(x0)) { setTransform(zoomIdentity.translate(W / 2, H / 2)); return; }
    const k = Math.min(2, Math.max(0.04, Math.min(W / (x1 - x0 + 80), H / (y1 - y0 + 80))));
    setTransform(zoomIdentity.translate(W / 2 - ((x0 + x1) / 2) * k, H / 2 - ((y0 + y1) / 2) * k).scale(k));
  }, [store, setTransform]);

  const screenToWorld = useCallback((cx: number, cy: number) => {
    const r = rootRef.current!.getBoundingClientRect();
    const t = tRef.current;
    return { x: (cx - r.left - t.x) / t.k, y: (cy - r.top - t.y) / t.k };
  }, []);

  useImperativeHandle(ref, () => ({
    fitView,
    screenToWorld,
    focusNode: (id) => {
      const n = store.state.items[id]; const root = rootRef.current;
      if (!isNode(n) || !root) return;
      const k = Math.max(tRef.current.k, 1.2);
      setTransform(zoomIdentity.translate(root.clientWidth / 2 - n.x * k, root.clientHeight / 2 - n.y * k).scale(k));
    },
    viewCenter: () => {
      const root = rootRef.current!; const t = tRef.current;
      return { x: (root.clientWidth / 2 - t.x) / t.k, y: (root.clientHeight / 2 - t.y) / t.k };
    },
  }), [fitView, screenToWorld, setTransform, store]);

  // при смене ширмы — показать всё
  const metaId = st.meta?.id;
  const loading = st.loading;
  useEffect(() => { if (metaId && !loading) requestAnimationFrame(() => fitView()); }, [metaId, loading, fitView]);

  const introFor = useRef<string | null>(null);
  useEffect(() => {
    const ph = physRef.current!;
    if (!physicsOn || loading || !metaId) { ph.stop(); vis.current.clear(); return; }
    const intro = introFor.current !== metaId;
    introFor.current = metaId;
    ph.sync(st.items, nodeRadius, intro);
  }, [st.items, physicsOn, loading, metaId]);

  const togglePhysics = () => {
    const v = !physicsOn;
    setPhysicsOn(v); lsSet(LS_PHYS, v ? '1' : '0');
    if (v) introFor.current = null; // при включении — красивое «собирание»
  };

  // ---------------------------------------------------------- перетаскивание узлов и рамок
  const dragRef = useRef<null | { id: string; sx: number; sy: number; moved: boolean; started: boolean; shift: boolean; mode: 'move' | 'resize'; orig?: FrameItem }>(null);

  const onItemPointerDown = useCallback((e: React.PointerEvent, id: string, mode: 'move' | 'resize' = 'move') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onActivate();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { id, sx: e.clientX, sy: e.clientY, moved: false, started: false, shift: e.shiftKey, mode };
  }, [onActivate]);

  const onItemPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current; if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    const s = store.state;
    const k = tRef.current.k;
    if (!s.admin) {
      // зрителю можно «поиграть» с узлом — он вернётся на место
      if (d.mode !== 'move' || !physOnRef.current) return;
      const it = s.items[d.id]; if (!isNode(it)) return;
      const from = vis.current.get(d.id) ?? it;
      if (!d.started) { d.started = true; (d as any).ox = from.x; (d as any).oy = from.y; }
      physRef.current!.grab(new Map([[d.id, { x: (d as any).ox + dx / k, y: (d as any).oy + dy / k }]]));
      return;
    }
    if (d.mode === 'resize') {
      if (!d.orig) { const f = s.items[d.id]; if (!isFrame(f)) return; d.orig = f; d.started = true; }
      const o = d.orig;
      store.preview({ ...o, w: Math.max(60, o.w + dx / k), h: Math.max(40, o.h + dy / k) });
      return;
    }
    if (!d.started) {
      const ids = s.selection.includes(d.id) ? s.selection : [d.id];
      if (!s.selection.includes(d.id)) store.select([d.id]);
      store.beginDrag(ids);
      d.started = true;
      if (physOnRef.current) {
        const m = new Map<string, { x: number; y: number }>();
        for (const id of store.expandWithChildren(ids)) { const n = store.state.items[id]; if (isNode(n)) m.set(id, { x: n.x, y: n.y }); }
        physRef.current!.grab(m);
      }
    }
    store.dragTo(dx / k, dy / k);
  }, [store]);

  const onItemPointerUp = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current; dragRef.current = null;
    if (!d) return;
    const s = store.state;
    if (d.mode === 'resize') {
      if (d.orig) store.commitPreview(d.orig);
      return;
    }
    if (d.started) {
      if (s.admin) store.endDrag();
      if (physOnRef.current) physRef.current!.release(s.admin);
      return;
    }
    if (d.moved) return;
    // клик
    const it = s.items[d.id];
    if (s.linkFrom && isNode(it)) {
      if (s.linkFrom !== d.id) onLinkTarget(s.linkFrom, d.id);
      store.setLinkFrom(null);
      return;
    }
    if (d.shift || e.ctrlKey || e.metaKey) { store.toggleSelect(d.id); return; }
    store.select([d.id]);
    if (isNode(it)) store.openNode(d.id);
  }, [store, onLinkTarget]);

  // ---------------------------------------------------------- выделение рамкой (Shift + перетаскивание по фону)
  const onRootPointerDown = useCallback((e: React.PointerEvent) => {
    onActivate();
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    const drawing = store.state.drawFrame;
    if (t.closest('.no-pan')) return;
    if (!drawing && t.closest('[data-drag]')) return;
    if (drawing) e.stopPropagation(); // рисуем рамку поверх чего угодно, не хватая узлы
    if (!e.shiftKey && !drawing) {
      if (store.state.linkFrom) store.setLinkFrom(null);
      bgDown.current = { x: e.clientX, y: e.clientY };
      return;
    }
    const r = rootRef.current!.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    setMarquee({ x0: x, y0: y, x1: x, y1: y, mode: drawing ? 'frame' : 'select' });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [store, onActivate]);

  const onRootPointerMove = useCallback((e: React.PointerEvent) => {
    if (!marquee) return;
    const r = rootRef.current!.getBoundingClientRect();
    setMarquee({ ...marquee, x1: e.clientX - r.left, y1: e.clientY - r.top });
  }, [marquee]);

  const bgDown = useRef<null | { x: number; y: number }>(null);
  const onRootPointerUp = useCallback((e: React.PointerEvent) => {
    const bd = bgDown.current; bgDown.current = null;
    if (bd && !marquee) {
      if (Math.hypot(e.clientX - bd.x, e.clientY - bd.y) < 4) store.select([]);
      return;
    }
    if (!marquee) return;
    const t = tRef.current;
    const wx0 = (Math.min(marquee.x0, marquee.x1) - t.x) / t.k, wx1 = (Math.max(marquee.x0, marquee.x1) - t.x) / t.k;
    const wy0 = (Math.min(marquee.y0, marquee.y1) - t.y) / t.k, wy1 = (Math.max(marquee.y0, marquee.y1) - t.y) / t.k;
    setMarquee(null);
    if (marquee.mode === 'frame') {
      store.setDrawFrame(false);
      if ((wx1 - wx0) * t.k < 20 || (wy1 - wy0) * t.k < 20) return;
      onFrameDrawn({ x: wx0, y: wy0, w: wx1 - wx0, h: wy1 - wy0 });
      return;
    }
    if (Math.abs(wx1 - wx0) * t.k < 5 && Math.abs(wy1 - wy0) * t.k < 5) { store.select([]); return; }
    const ids: string[] = [];
    for (const it of Object.values(store.state.items)) {
      if (isNode(it) && it.x >= wx0 && it.x <= wx1 && it.y >= wy0 && it.y <= wy1) ids.push(it.id);
      if (isFrame(it) && it.x >= wx0 && it.x + it.w <= wx1 && it.y >= wy0 && it.y + it.h <= wy1) ids.push(it.id);
    }
    store.select(ids, true);
    store.lastMarquee = { x: wx0, y: wy0, w: wx1 - wx0, h: wy1 - wy0, sel: store.state.selection.join('|') };
  }, [marquee, store, onFrameDrawn]);

  // ---------------------------------------------------------- контекстное меню
  const handleContext = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    onActivate();
    const w = screenToWorld(e.clientX, e.clientY);
    const t = e.target as HTMLElement;
    const nodeEl = t.closest('[data-node-id]') as HTMLElement | null;
    const frameEl = t.closest('[data-frame-id]') as HTMLElement | null;
    if (nodeEl) onContextMenu({ type: 'node', id: nodeEl.dataset.nodeId!, ...w }, e.clientX, e.clientY);
    else if (frameEl && t.closest('[data-drag]')) onContextMenu({ type: 'frame', id: frameEl.dataset.frameId!, ...w }, e.clientX, e.clientY);
    else onContextMenu({ type: 'background', ...w }, e.clientX, e.clientY);
  }, [onContextMenu, screenToWorld, onActivate]);

  // ---------------------------------------------------------- данные для отрисовки
  const { frames, nodes, links } = useMemo(() => {
    const frames: FrameItem[] = [], nodes: NodeItem[] = [], links: LinkItem[] = [];
    for (const it of Object.values(st.items)) {
      if (isFrame(it)) frames.push(it); else if (isNode(it)) nodes.push(it); else if (isLink(it)) links.push(it);
    }
    frames.sort((a, b) => (a.variant === 'image' ? -1 : 0) - (b.variant === 'image' ? -1 : 0) || b.w * b.h - a.w * a.h);
    return { frames, nodes, links };
  }, [st.items]);

  const selected = useMemo(() => new Set(st.selection), [st.selection]);
  const latest = useRef({ admin: st.admin, onEditNode, onEditFrame });
  latest.current = { admin: st.admin, onEditNode, onEditFrame };
  const onItemDouble = useCallback((id: string, kind: 'node' | 'frame') => {
    const L = latest.current;
    if (kind === 'frame') { if (L.admin) L.onEditFrame(id); return; }
    if (L.admin) L.onEditNode(id); else store.openNode(id);
  }, [store]);
  const handlers = useMemo(() => ({ onItemPointerDown, onItemPointerMove, onItemPointerUp, onItemDouble }),
    [onItemPointerDown, onItemPointerMove, onItemPointerUp, onItemDouble]);

  return (
    <div
      ref={rootRef}
      className={`board${st.linkFrom ? ' linking' : ''}${st.drawFrame ? ' drawing' : ''}`}
      onPointerDown={st.drawFrame ? undefined : onRootPointerDown}
      onPointerDownCapture={st.drawFrame ? onRootPointerDown : undefined}
      onPointerMove={onRootPointerMove}
      onPointerUp={onRootPointerUp}
      onContextMenu={handleContext}
    >
      <div ref={vpRef} className="viewport">
        {frames.map((f) => (
          <FrameView key={f.id} f={f} selected={selected.has(f.id)} admin={st.admin} {...handlers} />
        ))}
        <svg className="links-layer" width="1" height="1">
          <defs>
            {[...new Set(links.map((l) => l.color))].map((c) => (
              <marker key={c} id={`arrow-${c.slice(1)}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0,0 L10,5 L0,10 z" fill={c} />
              </marker>
            ))}
          </defs>
          {links.map((l) => <LinkView key={l.id} l={l} a={st.items[l.from]} b={st.items[l.to]}
            pa={physicsOn ? vis.current.get(l.from) : undefined} pb={physicsOn ? vis.current.get(l.to) : undefined} />)}
        </svg>
        {nodes.map((n) => (
          <NodeView key={n.id} n={n} selected={selected.has(n.id)} open={st.openNodeId === n.id} admin={st.admin} {...handlers}
            px={physicsOn ? vis.current.get(n.id)?.x : undefined} py={physicsOn ? vis.current.get(n.id)?.y : undefined} />
        ))}
      </div>
      {marquee && (
        <div className={`marquee${marquee.mode === 'frame' ? ' marquee-frame' : ''}`} style={{
          left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1),
          width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0),
        }} />
      )}
      {st.loading && <div className="board-loading">Загрузка…</div>}
      {!st.loading && st.meta && nodes.length === 0 && frames.length === 0 && (
        <div className="board-empty">Пустая ширма. {st.admin ? 'Правый клик по полю — создать узел или рамку.' : ''}</div>
      )}
      {st.linkFrom && <div className="link-hint">Выбери узел, с которым связать. Esc — отмена.</div>}
      {st.drawFrame && <div className="link-hint">Зажми и протяни по полю, чтобы нарисовать рамку. Esc — отмена.</div>}
      <div className="board-controls no-pan">
        <button title="Приблизить" onClick={() => select(rootRef.current!).call(zoomRef.current!.scaleBy, 1.3)}>＋</button>
        <button title="Отдалить" onClick={() => select(rootRef.current!).call(zoomRef.current!.scaleBy, 1 / 1.3)}>－</button>
        <button title="Показать всё" onClick={() => fitView()}>⤢</button>
        <button title={physicsOn ? 'Физика включена — выключить' : 'Физика выключена — включить'} className={physicsOn ? 'on' : ''} onClick={togglePhysics}>〰</button>
        {physicsOn && <button title="Встряхнуть" onClick={() => physRef.current?.shake()}>✦</button>}
      </div>
      <Minimap items={st.items} getTransform={() => tRef.current} zoomSubs={zoomSubs.current} rootRef={rootRef}
        onJump={(x, y) => {
          const root = rootRef.current!; const k = tRef.current.k;
          setTransform(zoomIdentity.translate(root.clientWidth / 2 - x * k, root.clientHeight / 2 - y * k).scale(k));
        }} />
    </div>
  );
});

// ============================================================ элементы

type ItemHandlers = {
  onItemDouble: (id: string, kind: 'node' | 'frame') => void;
  onItemPointerDown: (e: React.PointerEvent, id: string, mode?: 'move' | 'resize') => void;
  onItemPointerMove: (e: React.PointerEvent) => void;
  onItemPointerUp: (e: React.PointerEvent) => void;
};

const NodeView = memo(function NodeView({ n, selected, open, px, py, ...h }:
  { n: NodeItem; selected: boolean; open: boolean; admin: boolean; px?: number; py?: number } & ItemHandlers) {
  const size = NODE_BASE * n.size;
  const [imgOk, setImgOk] = useState(true);
  useEffect(() => setImgOk(true), [n.image]);
  const showImg = !!n.image && imgOk;
  return (
    <div
      className={`node shape-${n.shape}${selected ? ' selected' : ''}${open ? ' open' : ''}${n.hidden ? ' is-hidden' : ''}${n.size >= 1.5 ? ' big' : ''}`}
      style={{ left: px ?? n.x, top: py ?? n.y, ['--c' as any]: n.color }}
      data-node-id={n.id}
      data-drag=""
      onPointerDown={(e) => h.onItemPointerDown(e, n.id)}
      onPointerMove={h.onItemPointerMove}
      onPointerUp={h.onItemPointerUp}
      onDoubleClick={() => h.onItemDouble(n.id, 'node')}
    >
      <div className="node-shape" style={{ width: size, height: size }}>
        {showImg && <img src={n.image} alt="" draggable={false} onError={() => setImgOk(false)} />}
      </div>
      {n.title && <div className="node-label" style={{ color: n.titleColor || n.color }}>{n.title}</div>}
    </div>
  );
});

const FrameView = memo(function FrameView({ f, selected, admin, ...h }:
  { f: FrameItem; selected: boolean; admin: boolean } & ItemHandlers) {
  const isImg = f.variant === 'image';
  return (
    <div
      className={`frame${isImg ? ' frame-image' : ''}${selected ? ' selected' : ''}${f.hidden ? ' is-hidden' : ''}`}
      style={{ left: f.x, top: f.y, width: f.w, height: f.h, ['--c' as any]: f.color, backgroundImage: f.image ? `url("${encodeURI(f.image)}")` : undefined }}
      data-frame-id={f.id}
    >
      {(!isImg || admin) && (
        <div className={`frame-title${isImg ? ' frame-handle' : ''}`} data-drag=""
          onPointerDown={(e) => h.onItemPointerDown(e, f.id)} onPointerMove={h.onItemPointerMove} onPointerUp={h.onItemPointerUp}
          onDoubleClick={() => h.onItemDouble(f.id, 'frame')}>
          {isImg ? '⠿ фон' : f.title || ' '}
        </div>
      )}
      {admin && selected && (
        <div className="frame-resize" data-drag=""
          onPointerDown={(e) => h.onItemPointerDown(e, f.id, 'resize')} onPointerMove={h.onItemPointerMove} onPointerUp={h.onItemPointerUp} />
      )}
    </div>
  );
});

const LinkView = memo(function LinkView({ l, a, b, pa, pb }: { l: LinkItem; a?: Item; b?: Item; pa?: { x: number; y: number }; pb?: { x: number; y: number } }) {
  if (!isNode(a) || !isNode(b)) return null;
  const A = pa ?? a, B = pb ?? b;
  const g = linkGeometry(A.x, A.y, nodeRadius(a), B.x, B.y, nodeRadius(b));
  return (
    <g className={`link${l.hidden ? ' is-hidden' : ''}`} data-link-id={l.id} data-from={l.from} data-to={l.to}>
      <line x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} stroke={l.color} markerEnd={`url(#arrow-${l.color.slice(1)})`} />
      {l.label && <text x={g.mx} y={g.my} className="link-label" fill={l.color}>{l.label}</text>}
    </g>
  );
});

export const newLink = (from: string, to: string, label = ''): LinkItem =>
  ({ kind: 'link', id: uid('l'), from, to, label, color: '#40E0D0', hidden: false });
