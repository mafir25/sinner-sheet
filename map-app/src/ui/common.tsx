import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react';
import type { AssetStore } from '../assets/store';
import type { AssetKey, AssetEntry } from '../model/types';
import { nm, tr } from '../i18n';

// ---------- уведомления
type Toast = { id: number; text: string; kind: 'info' | 'error' };
let toasts: Toast[] = [];
const toastListeners = new Set<() => void>();
export function toast(text: string, kind: Toast['kind'] = 'info') {
  const id = Date.now() + Math.random();
  toasts = [...toasts, { id, text, kind }];
  toastListeners.forEach((f) => f());
  setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); toastListeners.forEach((f) => f()); }, kind === 'error' ? 6000 : 3500);
}
export function Toasts() {
  const list = useSyncExternalStore((f) => { toastListeners.add(f); return () => { toastListeners.delete(f); }; }, () => toasts);
  return <div className="toasts">{list.map((t) => <div key={t.id} className={`toast toast-${t.kind}`}>{t.text}</div>)}</div>;
}

// ---------- окно
export function Modal({ title, onClose, children, wide }: { title: string; onClose(): void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);
  return (
    <div className="modal-ov" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal${wide ? ' modal-wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} title={tr('Закрыть')}>✕</button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function useStore(assets: AssetStore) {
  return useSyncExternalStore(assets.subscribe, () => assets.version);
}

// ---------- миниатюра ассета
export function Thumb({ assets, k, size = 52 }: { assets: AssetStore; k: AssetKey | null; size?: number }) {
  const [bad, setBad] = useState(false);
  const url = k ? assets.url(k) : null;
  const e = assets.entry(k);
  if (!k || !url || bad) return <span className="thumb thumb-none" style={{ width: size, height: size }}>{k ? '?' : '∅'}</span>;
  const tile = e?.kind === 'floor' || e?.kind === 'wall';
  return (
    <span className={`thumb${tile ? ' thumb-tile' : ''}`} style={{ width: size, height: size }}>
      <img src={url} alt="" loading="lazy" draggable={false} onError={() => setBad(true)}
        style={e?.pixelated ? { imageRendering: 'pixelated' } : undefined} />
    </span>
  );
}

export const assetName = (e: AssetEntry | undefined, key?: string | null) => (e ? nm(e.name) : key ? tr('Нет ассета') : '');

/** Сетка ассетов одного вида (пол, стена, дверь, окно) из всех наборов. */
export function AssetPicker({ assets, kind, value, onChange, allowNone, noneLabel }: {
  assets: AssetStore; kind: AssetEntry['kind']; value: AssetKey | null; onChange(k: AssetKey | null): void; allowNone?: boolean; noneLabel?: string;
}) {
  useStore(assets);
  const list = assets.all(kind);
  return (
    <div className="picker">
      {allowNone && (
        <button className={`pick${value === null ? ' on' : ''}`} onClick={() => onChange(null)} title={noneLabel}>
          <span className="thumb thumb-none" style={{ width: 40, height: 40 }}>∅</span>
        </button>
      )}
      {list.map(({ key, entry, pack }) => (
        <button key={key} className={`pick${value === key ? ' on' : ''}`} onClick={() => onChange(key)}
          title={`${nm(entry.name)}${pack.local ? ` · ${pack.label}` : ''}`}>
          <Thumb assets={assets} k={key} size={40} />
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children, row }: { label: string; children: ReactNode; row?: boolean }) {
  return <label className={`field${row ? ' field-row' : ''}`}><span className="field-label">{label}</span>{children}</label>;
}

/** Числовое поле, которое применяет значение по Enter/потере фокуса (чтобы не плодить шаги истории). */
export function NumInput({ value, onCommit, step = 0.25, min, max, digits = 2 }: {
  value: number; onCommit(v: number): void; step?: number; min?: number; max?: number; digits?: number;
}) {
  const fmt = (v: number) => String(Math.round(v * 10 ** digits) / 10 ** digits);
  const [text, setText] = useState(fmt(value));
  useEffect(() => setText(fmt(value)), [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    let v = Number(text.replace(',', '.'));
    if (!Number.isFinite(v)) { setText(fmt(value)); return; }
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    if (v !== value) onCommit(v); else setText(fmt(value));
  };
  return (
    <input className="input num" type="number" step={step} min={min} max={max} value={text}
      onChange={(e) => setText(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); } }} />
  );
}
