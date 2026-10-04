import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type MenuItem = { label: string; icon?: string; onClick: () => void; danger?: boolean; disabled?: boolean } | 'divider';

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 8) });
  }, [x, y]);
  useEffect(() => {
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', onClose);
    return () => { window.removeEventListener('pointerdown', close, true); window.removeEventListener('keydown', key); window.removeEventListener('blur', onClose); };
  }, [onClose]);
  if (!items.length) return null;
  return (
    <div ref={ref} className="ctx-menu" style={{ left: pos.x, top: pos.y }} role="menu">
      {items.map((it, i) => it === 'divider'
        ? <div key={i} className="ctx-divider" />
        : (
          <button key={i} role="menuitem" className={`ctx-item${it.danger ? ' danger' : ''}`} disabled={it.disabled}
            onClick={() => { onClose(); it.onClick(); }}>
            <span className="ctx-icon">{it.icon ?? ''}</span>{it.label}
          </button>
        ))}
    </div>
  );
}
