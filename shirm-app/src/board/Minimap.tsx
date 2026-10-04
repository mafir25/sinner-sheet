import { useEffect, useRef, useState, type RefObject } from 'react';
import type { ZoomTransform } from 'd3-zoom';
import { type ItemMap, isFrame, isNode } from '../model/schema';

const W = 200, H = 130;

export function Minimap({ items, getTransform, zoomSubs, rootRef, onJump }: {
  items: ItemMap; getTransform: () => ZoomTransform; zoomSubs: Set<(t: ZoomTransform) => void>;
  rootRef: RefObject<HTMLDivElement | null>; onJump: (x: number, y: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hidden, setHidden] = useState(false);
  const [transform, setT] = useState<ZoomTransform>(getTransform());
  useEffect(() => {
    let raf = 0;
    const f = (t: ZoomTransform) => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setT(t)); };
    zoomSubs.add(f);
    return () => { zoomSubs.delete(f); cancelAnimationFrame(raf); };
  }, [zoomSubs]);
  const geo = useRef({ x0: 0, y0: 0, s: 1 });

  useEffect(() => {
    const c = ref.current; const root = rootRef.current;
    if (!c || !root || hidden) return;
    const ctx = c.getContext('2d')!;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const vals = Object.values(items);
    for (const it of vals) {
      if (isNode(it)) { x0 = Math.min(x0, it.x); x1 = Math.max(x1, it.x); y0 = Math.min(y0, it.y); y1 = Math.max(y1, it.y); }
      else if (isFrame(it)) { x0 = Math.min(x0, it.x); x1 = Math.max(x1, it.x + it.w); y0 = Math.min(y0, it.y); y1 = Math.max(y1, it.y + it.h); }
    }
    const t = transform;
    const vx0 = -t.x / t.k, vy0 = -t.y / t.k, vw = root.clientWidth / t.k, vh = root.clientHeight / t.k;
    if (!isFinite(x0)) { x0 = vx0; y0 = vy0; x1 = vx0 + vw; y1 = vy0 + vh; }
    x0 = Math.min(x0, vx0); y0 = Math.min(y0, vy0); x1 = Math.max(x1, vx0 + vw); y1 = Math.max(y1, vy0 + vh);
    const pad = 20;
    const s = Math.min((W - pad) / (x1 - x0 || 1), (H - pad) / (y1 - y0 || 1));
    const ox = (W - (x1 - x0) * s) / 2, oy = (H - (y1 - y0) * s) / 2;
    geo.current = { x0: x0 - ox / s, y0: y0 - oy / s, s };
    const X = (x: number) => (x - x0) * s + ox, Y = (y: number) => (y - y0) * s + oy;
    ctx.clearRect(0, 0, W, H);
    for (const it of vals) {
      if (isFrame(it)) { ctx.strokeStyle = it.color; ctx.globalAlpha = 0.7; ctx.strokeRect(X(it.x), Y(it.y), it.w * s, it.h * s); }
    }
    ctx.globalAlpha = 1;
    for (const it of vals) {
      if (isNode(it)) { ctx.fillStyle = it.color; ctx.fillRect(X(it.x) - 1, Y(it.y) - 1, 2.5, 2.5); }
    }
    ctx.strokeStyle = '#F1C40F'; ctx.lineWidth = 1.5;
    ctx.strokeRect(X(vx0), Y(vy0), vw * s, vh * s);
  }, [items, transform, rootRef, hidden]);

  if (hidden) return <button className="minimap-toggle no-pan" onClick={() => setHidden(false)} title="Показать миникарту">▣</button>;
  return (
    <div className="minimap no-pan">
      <canvas ref={ref} width={W} height={H}
        onPointerDown={(e) => {
          const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
          const g = geo.current;
          onJump((e.clientX - r.left) / g.s + g.x0, (e.clientY - r.top) / g.s + g.y0);
        }} />
      <button className="minimap-close" onClick={() => setHidden(true)} title="Скрыть миникарту">×</button>
    </div>
  );
}
