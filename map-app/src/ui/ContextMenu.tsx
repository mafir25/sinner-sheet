// Контекстное меню холста: правая кнопка мыши или долгое нажатие на планшете (инструмент «Выделение»).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AssetStore } from '../assets/store';
import type { Editor } from '../state/editor';
import { useEditor } from '../state/editor';
import { sameObjects } from '../geom/ops';
import { boxSelect } from '../tools/hit';
import { tr } from '../i18n';

export type MenuItem = { label: string; hint?: string; run(): void; danger?: boolean } | 'sep';

const ALL = { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity };

/** Пункты меню для текущего выделения. */
export function menuItems(ed: Editor, assets: AssetStore, extra: { fit(): void }): MenuItem[] {
  const sel = ed.state.sel, f = ed.floor;
  const objs = ed.selected('object'), paths = ed.selected('path');
  const ids = new Set(sel.map((s) => s.id));
  const items: MenuItem[] = [];
  if (sel.length) {
    items.push({ label: tr('Копировать'), hint: 'Ctrl+C', run: () => ed.copy() });
    items.push({ label: tr('Дублировать'), hint: 'Ctrl+D', run: () => ed.duplicate() });
  }
  if (ed.canPaste()) items.push({ label: tr('Вставить'), hint: 'Ctrl+V', run: () => ed.paste() });
  if (objs.length) {
    items.push('sep');
    items.push({ label: tr('Выделить такие же'), run: () => ed.setSel(sameObjects(f, objs, (k) => assets.entry(k)).map((id) => ({ kind: 'object' as const, id }))) });
    items.push({ label: tr('Наверх'), run: () => ed.commitFloor((fl) => { fl.objects = [...fl.objects.filter((o) => !ids.has(o.id)), ...fl.objects.filter((o) => ids.has(o.id))]; }) });
    items.push({ label: tr('Вниз'), run: () => ed.commitFloor((fl) => { fl.objects = [...fl.objects.filter((o) => ids.has(o.id)), ...fl.objects.filter((o) => !ids.has(o.id))]; }) });
    items.push({ label: tr('Отразить ↔'), hint: 'F', run: () => ed.commitFloor((fl) => { for (const o of fl.objects) if (ids.has(o.id)) o.flipX = !o.flipX; }) });
  }
  if (objs.length || paths.length) {
    const layers = f.layers.filter((l) => !l.locked);
    if (layers.length > 1) {
      items.push('sep');
      for (const l of [...layers].reverse()) {
        items.push({
          label: tr('На слой «{0}»', l.name),
          run: () => ed.commitFloor((fl) => {
            for (const o of fl.objects) if (ids.has(o.id)) o.layer = l.id;
            for (const p of fl.paths) if (ids.has(p.id)) p.layer = l.id;
          }),
        });
      }
    }
  }
  items.push('sep');
  items.push({ label: tr('Выделить всё'), hint: 'Ctrl+A', run: () => ed.setSel(boxSelect(f, ALL)) });
  items.push({ label: tr('Показать всю карту'), run: extra.fit });
  if (sel.length) {
    items.push('sep');
    items.push({ label: tr('Удалить'), hint: 'Del', danger: true, run: () => ed.deleteSelection() });
  }
  return items;
}

export function ContextMenu({ ed, at, items, onClose }: { ed: Editor; at: { x: number; y: number }; items: MenuItem[]; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  const doc = useEditor(ed, (s) => s.doc);
  const first = useRef(doc);
  // меню не переживает изменений карты (отмена, другой этаж) — пункты могли устареть
  useEffect(() => { if (doc !== first.current) onClose(); }, [doc, onClose]);
  // не вылезать за край окна
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ x: Math.max(4, Math.min(at.x, window.innerWidth - r.width - 4)), y: Math.max(4, Math.min(at.y, window.innerHeight - r.height - 4)) });
  }, [at]);
  useEffect(() => {
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', onClose);
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key, true); window.removeEventListener('blur', onClose); };
  }, [onClose]);
  return (
    <div className="ctx-menu" ref={ref} role="menu" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) => (it === 'sep' ? <hr key={i} /> : (
        <button key={i} role="menuitem" className={it.danger ? 'danger' : ''} onClick={() => { onClose(); it.run(); }}>
          <span>{it.label}</span>{it.hint && <kbd>{it.hint}</kbd>}
        </button>
      )))}
    </div>
  );
}
