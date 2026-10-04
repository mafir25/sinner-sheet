// Состояние одной панели-доски: объекты, выделение, история (отмена/повтор), автосохранение.
import { useSyncExternalStore } from 'react';
import { type Item, type ItemMap, type NodeItem, type ScreenMeta, isFrame, isNode } from '../model/schema';
import { migrateV1, type V1Graph } from '../model/migrate';
import { canAdmin, finishMigration, saveChanges, subscribeItems } from '../data/screens';
import { toast } from '../ui/toast';

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
type Change = { id: string; before: Item | null; after: Item | null };

export type BoardState = {
  meta: ScreenMeta | null;
  items: ItemMap;
  admin: boolean;
  loading: boolean;
  selection: string[];
  openNodeId: string | null;
  saveState: SaveState;
  canUndo: boolean;
  canRedo: boolean;
  linkFrom: string | null;
};

const initial: BoardState = {
  meta: null, items: {}, admin: false, loading: false, selection: [], openNodeId: null,
  saveState: 'idle', canUndo: false, canRedo: false, linkFrom: null,
};

const SAVE_DELAY = 1200;

export class BoardStore {
  constructor(public panelKey: string) {}
  state: BoardState = initial;
  /** последняя область выделения рамкой (для «создать рамку вокруг выделенного») */
  lastMarquee: { x: number; y: number; w: number; h: number } | null = null;
  private listeners = new Set<() => void>();
  private undoStack: Change[][] = [];
  private redoStack: Change[][] = [];
  private dirty = new Map<string, number>(); // id -> версия изменения
  private ver = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private unsub: (() => void) | null = null;
  private email: string | null = null;

  subscribe = (l: () => void) => { this.listeners.add(l); return () => this.listeners.delete(l); };
  getSnapshot = () => this.state;
  private set(patch: Partial<BoardState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  get hasUnsaved() { return this.dirty.size > 0 || this.state.saveState === 'saving'; }

  // ------------------------------------------------------------ загрузка
  async load(meta: ScreenMeta | null, email: string | null) {
    await this.flush();
    this.unsub?.(); this.unsub = null;
    this.undoStack = []; this.redoStack = []; this.dirty.clear();
    this.email = email;
    if (!meta) { this.set({ ...initial }); return; }
    const admin = canAdmin(meta, email);
    this.set({ ...initial, meta, admin, loading: true });

    if (meta.isLocal) {
      this.set({ items: structuredClone(meta.localItems ?? {}), loading: false });
      return;
    }
    if (meta.schemaVersion < 2) {
      const items = migrateV1(meta.legacyGraph as V1Graph);
      this.set({ items, loading: false });
      if (admin) {
        try {
          await finishMigration(meta, items);
          meta.schemaVersion = 2; meta.legacyGraph = undefined;
          toast('Ширма переведена в новый формат. Старые данные сохранены в резервной копии.');
        } catch (e) {
          console.error(e);
          toast('Не удалось перевести ширму в новый формат — изменения пока не сохраняются.', 'error');
          return;
        }
      } else {
        return; // зритель видит переведённую в памяти версию
      }
    }
    // в какой подколлекции лежит каждый объект (при скрытии он «переезжает» из items в secret)
    const where = new Map<string, Set<string>>();
    const seenFirst = new Set<string>();
    this.unsub = subscribeItems(meta, admin, (ups, rems, part) => {
      if (this.state.meta?.id !== meta.id) return;
      let items: ItemMap;
      if (!seenFirst.has(part) && seenFirst.size === 0) {
        // самая первая порция: начинаем с чистого листа, но не теряем локальные несохранённые
        items = {};
        for (const id of this.dirty.keys()) if (this.state.items[id]) items[id] = this.state.items[id];
      } else items = { ...this.state.items };
      seenFirst.add(part);
      for (const it of ups) {
        (where.get(it.id) ?? where.set(it.id, new Set()).get(it.id)!).add(part);
        if (!this.dirty.has(it.id)) items[it.id] = it;
      }
      for (const id of rems) {
        const w = where.get(id); w?.delete(part);
        if (w && w.size) continue; // объект просто переехал в другую подколлекцию
        where.delete(id);
        if (!this.dirty.has(id)) delete items[id];
      }
      this.set({ items, loading: false });
    }, (e) => {
      console.error(e);
      this.set({ loading: false });
      toast('Нет доступа к ширме или ошибка сети.', 'error');
    });
  }

  /** Обновить метаданные (название, доступы). Если поменялись права — переподключиться. */
  updateMeta(meta: ScreenMeta, email: string | null) {
    const admin = canAdmin(meta, email);
    if (admin !== this.state.admin) void this.load(meta, email);
    else this.set({ meta });
  }

  dispose() { this.unsub?.(); }

  // ------------------------------------------------------------ изменения с историей
  /** Применяет изменения, пишет историю и ставит автосохранение. */
  apply(changes: Change[], record = true) {
    if (!changes.length) return;
    if (!this.state.admin) { toast('Эту ширму нельзя редактировать. Скопируй узлы в свою.', 'error'); return; }
    const items = { ...this.state.items };
    for (const c of changes) {
      if (c.after) items[c.id] = c.after; else delete items[c.id];
      this.dirty.set(c.id, ++this.ver);
    }
    if (record) { this.undoStack.push(changes); if (this.undoStack.length > 200) this.undoStack.shift(); this.redoStack = []; }
    const sel = this.state.selection.filter((id) => items[id]);
    this.set({
      items, selection: sel, saveState: 'dirty', canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0,
      openNodeId: this.state.openNodeId && items[this.state.openNodeId] ? this.state.openNodeId : null,
    });
    this.scheduleSave();
  }

  /** Изменить набор объектов функцией. */
  update(ids: string[], fn: (it: Item) => Item | null) {
    const ch: Change[] = [];
    for (const id of ids) {
      const before = this.state.items[id];
      if (!before) continue;
      const after = fn(structuredClone(before));
      ch.push({ id, before, after });
    }
    this.apply(ch);
  }

  put(items: Item[]) {
    this.apply(items.map((it) => ({ id: it.id, before: this.state.items[it.id] ?? null, after: it })));
  }

  /** Удалить объекты; вместе с узлами уходят их связи, у рамок — отвязываются узлы. */
  remove(ids: string[]) {
    const all = this.state.items;
    const del = new Set(ids.filter((id) => all[id]));
    for (const it of Object.values(all)) {
      if (it.kind === 'link' && (del.has(it.from) || del.has(it.to))) del.add(it.id);
    }
    const ch: Change[] = [...del].map((id) => ({ id, before: all[id], after: null }));
    for (const it of Object.values(all)) {
      if (isNode(it) && it.frameId && del.has(it.frameId) && !del.has(it.id)) {
        ch.push({ id: it.id, before: it, after: { ...it, frameId: null } });
      }
    }
    this.apply(ch);
  }

  undo() {
    const ch = this.undoStack.pop(); if (!ch) return;
    this.redoStack.push(ch);
    this.apply(ch.map((c) => ({ id: c.id, before: c.after, after: c.before })).reverse(), false);
    this.set({ canUndo: this.undoStack.length > 0, canRedo: true });
  }
  redo() {
    const ch = this.redoStack.pop(); if (!ch) return;
    this.undoStack.push(ch);
    this.apply(ch, false);
    this.set({ canUndo: true, canRedo: this.redoStack.length > 0 });
  }

  // ------------------------------------------------------------ живое перетаскивание (без истории до отпускания)
  private dragBefore: Map<string, Item> | null = null;
  beginDrag(ids: string[]) {
    this.dragBefore = new Map();
    for (const id of this.expandWithChildren(ids)) {
      const it = this.state.items[id]; if (it) this.dragBefore.set(id, it);
    }
  }
  dragTo(dx: number, dy: number) {
    if (!this.dragBefore) return;
    const items = { ...this.state.items };
    for (const [id, b] of this.dragBefore) {
      if (b.kind === 'link') continue;
      items[id] = { ...b, x: b.x + dx, y: b.y + dy } as Item;
    }
    this.set({ items });
  }
  endDrag() {
    if (!this.dragBefore) return;
    const before = this.dragBefore; this.dragBefore = null;
    const items = this.state.items;
    const ch: Change[] = [];
    for (const [id, b] of before) {
      let after = items[id];
      if (!after) continue;
      if (isNode(after) && !before.has(after.frameId ?? '')) after = { ...after, frameId: this.frameAt(after.x, after.y, after.frameId) };
      if (JSON.stringify(after) !== JSON.stringify(b)) ch.push({ id, before: b, after });
    }
    if (ch.length) this.apply(ch); else this.set({ items });
  }
  cancelDrag() {
    if (!this.dragBefore) return;
    const items = { ...this.state.items };
    for (const [id, b] of this.dragBefore) items[id] = b;
    this.dragBefore = null;
    this.set({ items });
  }

  /** Временное изменение одного объекта (без истории и сохранения) — например, при растягивании рамки. */
  preview(item: Item) { this.set({ items: { ...this.state.items, [item.id]: item } }); }
  commitPreview(before: Item) {
    const after = this.state.items[before.id];
    if (!after || JSON.stringify(after) === JSON.stringify(before)) return;
    this.apply([{ id: before.id, before, after }]);
  }

  /** Рамка под точкой (самая маленькая подходящая). */
  frameAt(x: number, y: number, prefer?: string | null): string | null {
    let best: string | null = null, area = Infinity;
    for (const it of Object.values(this.state.items)) {
      if (!isFrame(it) || it.variant !== 'frame') continue;
      if (x >= it.x && x <= it.x + it.w && y >= it.y && y <= it.y + it.h) {
        const a = it.w * it.h;
        if (it.id === prefer) return it.id;
        if (a < area) { area = a; best = it.id; }
      }
    }
    return best;
  }

  /** Рамки тянут за собой свои узлы. */
  expandWithChildren(ids: string[]): string[] {
    const set = new Set(ids);
    for (const id of ids) {
      if (isFrame(this.state.items[id])) {
        for (const it of Object.values(this.state.items)) if (isNode(it) && it.frameId === id) set.add(it.id);
      }
    }
    return [...set];
  }

  // ------------------------------------------------------------ выделение и панель
  select(ids: string[], additive = false) {
    const sel = additive ? [...new Set([...this.state.selection, ...ids])] : ids;
    this.set({ selection: sel });
  }
  toggleSelect(id: string) {
    const s = new Set(this.state.selection);
    s.has(id) ? s.delete(id) : s.add(id);
    this.set({ selection: [...s] });
  }
  openNode(id: string | null) { this.set({ openNodeId: id }); }
  setLinkFrom(id: string | null) { this.set({ linkFrom: id }); }

  toggleHidden(ids: string[]) {
    const all = this.state.items;
    const target = !ids.every((id) => all[id]?.hidden);
    const ch: Change[] = [];
    for (const id of ids) {
      const it = all[id]; if (!it) continue;
      ch.push({ id, before: it, after: { ...it, hidden: target } as Item });
    }
    // связи узлов надо перезаписать в нужную подколлекцию
    const set = new Set(ids);
    for (const it of Object.values(all)) {
      if (it.kind === 'link' && (set.has(it.from) || set.has(it.to)) && !set.has(it.id)) ch.push({ id: it.id, before: it, after: { ...it } });
    }
    this.apply(ch);
  }

  // ------------------------------------------------------------ сохранение
  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), SAVE_DELAY);
  }

  async flush(): Promise<void> {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    const meta = this.state.meta;
    if (!meta || meta.isLocal || !this.dirty.size) return;
    const snapshot = new Map(this.dirty);
    const items = this.state.items;
    const ups: Item[] = []; const dels: string[] = [];
    for (const id of snapshot.keys()) { if (items[id]) ups.push(items[id]); else dels.push(id); }
    this.set({ saveState: 'saving' });
    try {
      await saveChanges(meta.id, ups, dels, items);
      for (const [id, v] of snapshot) if (this.dirty.get(id) === v) this.dirty.delete(id);
      this.set({ saveState: this.dirty.size ? 'dirty' : 'saved' });
      if (this.dirty.size) this.scheduleSave();
    } catch (e) {
      console.error(e);
      this.set({ saveState: 'error' });
      toast('Ошибка сохранения. Повторю через несколько секунд.', 'error');
      this.saveTimer = setTimeout(() => void this.flush(), 5000);
    }
  }

  // ------------------------------------------------------------ удобные выборки
  nodes(): NodeItem[] { return Object.values(this.state.items).filter(isNode); }
}

export function useBoard(store: BoardStore): BoardState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
