// Одна панель-доска: выбор ширмы, поиск, доска, боковая панель, меню и редакторы.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Board, type BoardHandle, type CtxTarget, newLink } from '../board/Board';
import { type BoardStore, useBoard } from '../state/boardStore';
import { type FrameItem, type Item, type NodeItem, emptyNode, isFrame, isLink, isNode, uid } from '../model/schema';
import { searchNodes } from '../model/search';
import { type ListedScreen, canAdmin } from '../data/screens';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { FrameEditor, NodeEditor } from './NodeEditor';
import { Sidebar } from './Sidebar';
import { ImportModal } from './ScreenDialogs';
import { confirmDialog, promptDialog } from './dialogs';
import { toast } from './toast';

// ---------------------------------------------------------------- общий буфер обмена (между панелями)
let clipboard: Item[] = [];

function copyItems(items: Record<string, Item>, ids: string[]) {
  const set = new Set(ids);
  // рамки забирают свои узлы
  for (const it of Object.values(items)) if (isNode(it) && it.frameId && set.has(it.frameId)) set.add(it.id);
  const out: Item[] = [];
  for (const id of set) { const it = items[id]; if (it && !isLink(it)) out.push(structuredClone(it)); }
  for (const it of Object.values(items)) if (isLink(it) && set.has(it.from) && set.has(it.to)) out.push(structuredClone(it));
  clipboard = out;
  toast(`Скопировано: ${out.filter((i) => !isLink(i)).length}`);
}

function pasteItems(at: { x: number; y: number }): Item[] {
  if (!clipboard.length) return [];
  const map = new Map<string, string>();
  for (const it of clipboard) map.set(it.id, uid(it.kind[0]));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const it of clipboard) {
    if (isNode(it)) { x0 = Math.min(x0, it.x); x1 = Math.max(x1, it.x); y0 = Math.min(y0, it.y); y1 = Math.max(y1, it.y); }
    if (isFrame(it)) { x0 = Math.min(x0, it.x); x1 = Math.max(x1, it.x + it.w); y0 = Math.min(y0, it.y); y1 = Math.max(y1, it.y + it.h); }
  }
  const dx = at.x - (x0 + x1) / 2, dy = at.y - (y0 + y1) / 2;
  return clipboard.map((src) => {
    const it = structuredClone(src);
    it.id = map.get(src.id)!;
    if (isLink(it)) { it.from = map.get(it.from)!; it.to = map.get(it.to)!; }
    else { it.x += dx; it.y += dy; }
    if (isNode(it)) it.frameId = it.frameId && map.has(it.frameId) ? map.get(it.frameId)! : null;
    return it;
  });
}

const GROUP_LABEL: Record<string, string> = { base: 'Базовый мир', mine: 'Мои ширмы', admin: 'Я админ', friends: 'Друзья', public: 'Общие' };

export function Panel({ store, screens, screenId, onPickScreen, email, active, onActivate, onOpenSettings, onDeleteScreen }: {
  store: BoardStore; screens: ListedScreen[]; screenId: string; onPickScreen: (id: string) => void; email: string;
  active: boolean; onActivate: () => void; onOpenSettings: () => void; onDeleteScreen: () => void;
}) {
  const st = useBoard(store);
  const board = useRef<BoardHandle>(null);
  const [menu, setMenu] = useState<null | { x: number; y: number; items: MenuItem[] }>(null);
  const [editNode, setEditNode] = useState<NodeItem | null>(null);
  const [editFrame, setEditFrame] = useState<FrameItem | null>(null);
  const [importAt, setImportAt] = useState<null | { x: number; y: number }>(null);
  const [q, setQ] = useState('');
  const [showRes, setShowRes] = useState(false);
  const [sbW, setSbW] = useState(() => { try { return Number(localStorage.getItem('shirm.sidebarW')) || 420; } catch { return 420; } });
  // ширина панели — чтобы понять, хватает ли места шапке рядом с открытым описанием
  const panelRef = useRef<HTMLElement>(null);
  const [panelW, setPanelW] = useState(1200);
  useEffect(() => {
    const el = panelRef.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setPanelW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const meta = st.meta;
  const isCreator = !!meta && !meta.isLocal && meta.creatorEmail === email;
  const admin = st.admin;
  const hits = useMemo(() => searchNodes(st.items, q, 20), [st.items, q]);

  const focus = useCallback((id: string) => { board.current?.focusNode(id); store.select([id]); store.openNode(id); }, [store]);

  // ------------------------------------------------------------ действия
  const createNode = (x: number, y: number) => {
    const n = emptyNode(x, y);
    n.frameId = store.frameAt(x, y);
    setEditNode(n);
  };
  /** Рамка точно по прямоугольнику; узлы, чьи центры внутри, становятся её детьми. */
  const createFrameRect = async (r: { x: number; y: number; w: number; h: number }, onlyIds?: string[]) => {
    const title = await promptDialog('Название рамки', 'Новая рамка');
    if (title === null) return;
    const f: FrameItem = { kind: 'frame', id: uid('f'), title: title.trim(), color: '#40E0D0', variant: 'frame', image: '', x: r.x, y: r.y, w: r.w, h: r.h, hidden: false };
    const ch: Item[] = [f];
    for (const it of Object.values(store.state.items)) {
      if (!isNode(it)) continue;
      if (onlyIds && !onlyIds.includes(it.id)) continue;
      if (it.x >= r.x && it.x <= r.x + r.w && it.y >= r.y && it.y <= r.y + r.h) ch.push({ ...it, frameId: f.id });
    }
    store.put(ch);
    store.select([f.id]);
  };
  /** Действующая область Shift-выделения (если выделение с тех пор не менялось) */
  const marqueeRect = () => {
    const m = store.lastMarquee;
    return m && m.sel === store.state.selection.join('|') ? m : null;
  };
  const frameAroundNodes = () => {
    const nodes = store.state.selection.map((id) => store.state.items[id]).filter(isNode);
    if (!nodes.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
    void createFrameRect({ x: x0 - 80, y: y0 - 70, w: x1 - x0 + 160, h: y1 - y0 + 140 }, nodes.map((n) => n.id));
  };
  const deleteIds = async (ids: string[]) => {
    if (!ids.length) return;
    const n = ids.length;
    if (await confirmDialog(n === 1 ? 'Удалить объект?' : `Удалить объекты (${n})?`, 'Можно вернуть через Ctrl+Z.', true)) store.remove(ids);
  };
  const startLink = (id: string) => store.setLinkFrom(id);
  const finishLink = useCallback(async (from: string, to: string) => {
    const label = await promptDialog('Подпись связи (можно оставить пустой)', '');
    if (label === null) return;
    const color = (store.state.items[from] as NodeItem | undefined)?.color ?? '#40E0D0';
    store.put([{ ...newLink(from, to, label.trim()), color }]);
  }, [store]);
  const paste = (at: { x: number; y: number }) => {
    if (!admin) { toast('Вставлять можно только в ширму, где ты админ.', 'error'); return; }
    const items = pasteItems(at);
    if (!items.length) { toast('Буфер пуст'); return; }
    store.put(items);
    store.select(items.filter((i) => !isLink(i)).map((i) => i.id));
  };

  // ------------------------------------------------------------ контекстное меню
  const onContextMenu = useCallback((t: CtxTarget, cx: number, cy: number) => {
    const s = store.state;
    const items: MenuItem[] = [];
    const sel = s.selection;
    if (t.type === 'background') {
      if (s.admin) {
        items.push({ label: 'Создать узел здесь', icon: '＋', onClick: () => createNode(t.x, t.y) });
        items.push({ label: 'Нарисовать рамку', icon: '▭', onClick: () => store.setDrawFrame(true) });
        items.push({ label: 'Быстрый импорт из базы', icon: '⇩', onClick: () => setImportAt({ x: t.x, y: t.y }) });
        if (clipboard.length) items.push({ label: `Вставить (${clipboard.filter((i) => !isLink(i)).length})`, icon: '⎘', onClick: () => paste(t) });
        const mr = marqueeRect();
        const selNodes = sel.filter((id) => isNode(s.items[id]));
        if (mr || selNodes.length) items.push('divider');
        if (mr) items.push({ label: 'Рамка по выделенной области', icon: '▣', onClick: () => void createFrameRect(mr) });
        if (selNodes.length) items.push({ label: 'Рамка вокруг выделенных узлов', icon: '▢', onClick: frameAroundNodes });
      }
      if (sel.length) {
        items.push({ label: `Копировать выделенное (${sel.length})`, icon: '⧉', onClick: () => copyItems(s.items, sel) });
        if (s.admin) {
          items.push({ label: 'Скрыть/показать выделенное', icon: '🌫', onClick: () => store.toggleHidden(sel) });
          items.push({ label: 'Удалить выделенное', icon: '🗑', danger: true, onClick: () => deleteIds(sel) });
        }
      }
      items.push('divider');
      items.push({ label: 'Показать всё', icon: '⤢', onClick: () => board.current?.fitView() });
    } else if (t.type === 'node') {
      const n = s.items[t.id] as NodeItem;
      const many = sel.includes(t.id) && sel.length > 1 ? sel : [t.id];
      items.push({ label: 'Открыть', icon: '📖', onClick: () => { store.select([t.id]); store.openNode(t.id); } });
      if (s.admin) {
        items.push({ label: 'Редактировать', icon: '✎', onClick: () => setEditNode(structuredClone(n)) });
        items.push({ label: 'Связать с…', icon: '↗', onClick: () => startLink(t.id) });
        items.push({ label: n.hidden ? 'Показать игрокам' : 'Скрыть (туман войны)', icon: '🌫', onClick: () => store.toggleHidden(many) });
        items.push({ label: 'Дублировать', icon: '⧉', onClick: () => { copyItems(s.items, many); paste({ x: n.x + 60, y: n.y + 60 }); } });
      }
      items.push({ label: many.length > 1 ? `Копировать (${many.length})` : 'Копировать', icon: '⎘', onClick: () => copyItems(s.items, many) });
      const links = Object.values(s.items).filter((l) => isLink(l) && (l.from === t.id || l.to === t.id));
      if (s.admin && links.length) {
        items.push('divider');
        for (const l of links.slice(0, 8)) {
          if (!isLink(l)) continue;
          const other = s.items[l.from === t.id ? l.to : l.from] as NodeItem | undefined;
          items.push({ label: `Убрать связь: ${other?.title ?? '?'}${l.label ? ` (${l.label})` : ''}`, icon: '✂', onClick: () => store.remove([l.id]) });
        }
      }
      if (s.admin) { items.push('divider'); items.push({ label: many.length > 1 ? `Удалить (${many.length})` : 'Удалить', icon: '🗑', danger: true, onClick: () => deleteIds(many) }); }
    } else if (t.type === 'frame') {
      const f = s.items[t.id] as FrameItem;
      if (s.admin) {
        items.push({ label: 'Настроить рамку', icon: '✎', onClick: () => setEditFrame(structuredClone(f)) });
        items.push({ label: f.hidden ? 'Показать игрокам' : 'Скрыть рамку', icon: '🌫', onClick: () => store.toggleHidden([t.id]) });
      }
      items.push({ label: 'Копировать с содержимым', icon: '⎘', onClick: () => copyItems(s.items, [t.id]) });
      items.push({ label: 'Приблизить к рамке', icon: '⤢', onClick: () => board.current?.fitView([t.id]) });
      if (s.admin) {
        items.push('divider');
        items.push({ label: 'Удалить рамку (узлы останутся)', icon: '🗑', danger: true, onClick: () => deleteIds([t.id]) });
        items.push({ label: 'Удалить рамку вместе с узлами', icon: '🗑', danger: true, onClick: () => deleteIds(store.expandWithChildren([t.id])) });
      }
    }
    setMenu({ x: cx, y: cy, items });
  }, [store]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------ горячие клавиши (только у активной панели)
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const tg = e.target as HTMLElement;
      if (tg.closest('input, textarea, select, [contenteditable], .modal')) return;
      const mod = e.ctrlKey || e.metaKey;
      const s = store.state;
      const key = e.key.toLowerCase();
      if (mod && (key === 'z' || key === 'я') && !e.shiftKey) { e.preventDefault(); store.undo(); }
      else if (mod && ((key === 'y' || key === 'н') || ((key === 'z' || key === 'я') && e.shiftKey))) { e.preventDefault(); store.redo(); }
      else if (mod && (key === 'c' || key === 'с') && s.selection.length) { e.preventDefault(); copyItems(s.items, s.selection); }
      else if (mod && (key === 'v' || key === 'м')) { e.preventDefault(); const c = board.current?.viewCenter(); if (c) paste(c); }
      else if (mod && (key === 'a' || key === 'ф')) { e.preventDefault(); store.select(Object.values(s.items).filter((i) => !isLink(i)).map((i) => i.id)); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && s.admin && s.selection.length) { e.preventDefault(); deleteIds(s.selection); }
      else if (e.key === 'Escape') { if (s.drawFrame) { store.setDrawFrame(false); return; } store.setLinkFrom(null); store.select([]); store.openNode(null); }
      else if (e.key === '/') { e.preventDefault(); document.getElementById(`search-${store.panelKey}`)?.focus(); }
      else if (key === 'f' || key === 'а') { board.current?.fitView(s.selection.length ? s.selection : undefined); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, store]); // eslint-disable-line react-hooks/exhaustive-deps

  const openNode = st.openNodeId ? st.items[st.openNodeId] : undefined;
  const grouped = useMemo(() => {
    const g: Record<string, ListedScreen[]> = {};
    for (const s of screens) (g[s.group] ??= []).push(s);
    return g;
  }, [screens]);

  // открытое описание сдвигает шапку влево; если панель узкая — описание уходит под шапку
  const sbOpen = isNode(openNode);
  const sbShown = Math.min(sbW, panelW * 0.88);
  const sbCompact = panelW - sbShown < 360;

  const saveLabel: Record<string, string> = meta?.isLocal
    ? { idle: '', dirty: '● не опубликовано', saving: '⟳ публикация…', saved: '✓ опубликовано', error: '⚠ ошибка' }
    : { idle: '', dirty: '● не сохранено', saving: '⟳ сохранение…', saved: '✓ сохранено', error: '⚠ ошибка сохранения' };

  // базовый мир (канон world.json): правки уходят на сайт только по кнопке
  const publish = async () => {
    const note = await promptDialog('Опубликовать правки базового мира? Комментарий для журнала:', '', 'Что изменено');
    if (note === null) return;
    try {
      const v = await store.publish(note);
      if (v) toast(`Опубликовано в канон (world.json v${v}). Игроки увидят при следующем открытии Ширмы.`);
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === 'canon/conflict') {
        if (!(await confirmDialog(err.message, 'Записать ваши правки поверх? Чужие изменения этой ширмы пропадут. Иначе — «Отменить правки» и повторить.', true))) return;
        try { const v = await store.publish(note, true); if (v) toast(`Опубликовано в канон (world.json v${v}).`); }
        catch (e2) { console.error(e2); toast('Не удалось опубликовать', 'error'); }
        return;
      }
      console.error(e);
      toast(err.code === 'permission-denied' ? 'Нет прав на канон раздела «Мир»' : 'Не удалось опубликовать', 'error');
    }
  };
  const discard = async () => {
    if (await confirmDialog('Отменить все неопубликованные правки этой ширмы?', undefined, true)) store.discardLocal();
  };

  return (
    <section ref={panelRef} className={`panel${active ? ' active' : ''}`} onPointerDownCapture={onActivate}>
      <div className={`panel-head no-pan${sbOpen ? ' sb-open' : ''}`} style={sbOpen && !sbCompact ? { right: sbShown + 8 } : undefined}>
        <select className="input screen-select" value={screenId} onChange={(e) => onPickScreen(e.target.value)} aria-label="Ширма">
          <option value="">— Выбери ширму —</option>
          {Object.entries(GROUP_LABEL).map(([g, label]) => grouped[g]?.length ? (
            <optgroup key={g} label={label}>
              {grouped[g].map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </optgroup>
          ) : null)}
        </select>
        {meta && !meta.isLocal && (canAdmin(meta, email) || isCreator) && (
          <button className="icon-btn" title="Настройки и доступы" onClick={onOpenSettings}>⚙</button>
        )}
        {isCreator && <button className="icon-btn danger" title="Удалить ширму" onClick={onDeleteScreen}>🗑</button>}
        {admin && (
          <>
            <button className="icon-btn" title="Отменить (Ctrl+Z)" disabled={!st.canUndo} onClick={() => store.undo()}>↶</button>
            <button className="icon-btn" title="Повторить (Ctrl+Y)" disabled={!st.canRedo} onClick={() => store.redo()}>↷</button>
            <span className={`save-state s-${st.saveState}`}>{saveLabel[st.saveState]}</span>
          </>
        )}
        {meta?.isLocal && admin && (
          <>
            <button className="btn btn-sm btn-primary" disabled={st.saveState !== 'dirty'} onClick={publish}
              title="Записать правки в канон (world.json) — их увидят все">⇪ Опубликовать в канон</button>
            {st.saveState === 'dirty' && <button className="btn btn-sm" onClick={discard}>Отменить правки</button>}
          </>
        )}
        {!sbOpen && meta?.isLocal && !admin && <span className="badge">только чтение — копируй узлы в свою ширму</span>}
        {!sbOpen && meta?.isLocal && admin && <span className="badge">канон: правки видны всем после публикации</span>}
        {!sbOpen && meta && !meta.isLocal && !admin && <span className="badge">просмотр</span>}
        <span className="grow" />
        <div className="search">
          <input id={`search-${store.panelKey}`} className="input" placeholder="Поиск: имя, тег, текст…  ( / )" value={q}
            onChange={(e) => { setQ(e.target.value); setShowRes(true); }}
            onFocus={() => setShowRes(true)} onBlur={() => setTimeout(() => setShowRes(false), 150)}
            onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) { focus(hits[0].node.id); setShowRes(false); } }} />
          {showRes && q && (
            <div className="search-res">
              {hits.length === 0 ? <div className="hint">Ничего не найдено</div> : hits.map((h) => (
                <button key={h.node.id} className="search-item" onMouseDown={(e) => e.preventDefault()} onClick={() => { focus(h.node.id); setShowRes(false); }}>
                  <span className="search-title" style={{ color: h.node.titleColor || h.node.color }}>{h.node.title || 'Без названия'}</span>
                  {h.where && <span className="search-where">{h.where}</span>}
                  <span className="search-tags">{h.node.tags.slice(0, 4).map((t, i) => <span key={i} className="tag tag-xs" style={{ color: t.color, borderColor: t.color }}>{t.text}</span>)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {meta ? (
        <Board ref={board} store={store} onContextMenu={onContextMenu}
          onEditNode={(id) => { const n = store.state.items[id]; if (isNode(n)) setEditNode(structuredClone(n)); }}
          onEditFrame={(id) => { const f = store.state.items[id]; if (isFrame(f)) setEditFrame(structuredClone(f)); }}
          onLinkTarget={finishLink} onActivate={onActivate} onFrameDrawn={(r) => void createFrameRect(r)} />
      ) : (
        <div className="panel-empty">
          <p>Выбери ширму в списке сверху.</p>
          <p className="hint">Базовый мир — справочник по лору (только чтение). Узлы из него можно копировать в свои ширмы.</p>
        </div>
      )}

      {isNode(openNode) && (
        <Sidebar node={openNode} items={st.items} admin={admin}
          width={sbShown} compact={sbCompact} maxWidth={panelW * 0.88}
          onWidth={(w, done) => { setSbW(w); if (done) { try { localStorage.setItem('shirm.sidebarW', String(Math.round(w))); } catch { /* приватный режим */ } } }}
          onClose={() => store.openNode(null)}
          onEdit={() => setEditNode(structuredClone(openNode))}
          onFocus={focus}
          onToggleHidden={() => store.toggleHidden([openNode.id])}
          onCopy={() => copyItems(st.items, [openNode.id])} />
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {editNode && (
        <NodeEditor node={editNode} onClose={() => setEditNode(null)}
          onSave={(n) => { store.put([n]); setEditNode(null); store.select([n.id]); store.openNode(n.id); }} />
      )}
      {editFrame && (
        <FrameEditor frame={editFrame} onClose={() => setEditFrame(null)} onSave={(f) => { store.put([f]); setEditFrame(null); }} />
      )}
      {importAt && (
        <ImportModal email={email} onClose={() => setImportAt(null)}
          onImport={(make) => {
            const n = make(importAt.x, importAt.y);
            n.frameId = store.frameAt(n.x, n.y);
            store.put([n]); setImportAt(null); store.select([n.id]); store.openNode(n.id);
          }} />
      )}
    </section>
  );
}
