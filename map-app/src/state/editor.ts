// Состояние редактора: документ карты, история (отмена/повтор), выделение, инструмент, вид.
import { useSyncExternalStore } from 'react';
import type { AssetKey, Floor, MapDoc, MapObject, Portal, Room, Wall, WallStyle } from '../model/types';
import { DEFAULT_FLOOR, DEFAULT_WALL, uid } from '../model/doc';
import { orphanPortals } from '../geom/walls';

export type ToolId = 'select' | 'room' | 'poly' | 'wall' | 'door' | 'window' | 'stamp' | 'pan';
export type SelKind = 'object' | 'portal' | 'wall' | 'room';
export type SelItem = { kind: SelKind; id: string };
export type View = { scale: number; ox: number; oy: number }; // px на клетку, сдвиг начала координат в px

export type ToolSettings = {
  floor: AssetKey | null;
  wall: WallStyle;
  door: AssetKey | null;
  window: AssetKey | null;
  stamp: AssetKey | null;
  stampRot: number;
  stampFlip: boolean;
  subtract: boolean;
  snap: boolean;
};

export type EditorState = {
  doc: MapDoc;
  floorId: string;
  layerId: string;
  tool: ToolId;
  sel: SelItem[];
  view: View;
  settings: ToolSettings;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean; // есть изменения, не сохранённые в файл
};

const HISTORY = 150;

export class Editor {
  /** Ключ экземпляра: повторное открытие той же карты пересоздаёт рабочее место. */
  readonly key = uid('e');
  state: EditorState;
  private past: MapDoc[] = [];
  private future: MapDoc[] = [];
  private listeners = new Set<() => void>();
  private docListeners = new Set<(d: MapDoc) => void>();
  clipboard: MapObject[] = [];

  constructor(doc: MapDoc) {
    const floor = doc.floors[0];
    this.state = {
      doc, floorId: floor.id, layerId: defaultLayer(floor),
      tool: 'select', sel: [], view: { scale: 48, ox: 40, oy: 40 },
      settings: {
        floor: DEFAULT_FLOOR, wall: { ...DEFAULT_WALL }, door: 'canon:portals/doors/wood.svg', window: 'canon:portals/windows/glass.svg',
        stamp: null, stampRot: 0, stampFlip: false, subtract: false, snap: true,
      },
      canUndo: false, canRedo: false, dirty: false,
    };
  }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  onDoc(fn: (d: MapDoc) => void) { this.docListeners.add(fn); return () => { this.docListeners.delete(fn); }; }
  private set(patch: Partial<EditorState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((f) => f());
  }

  get doc() { return this.state.doc; }
  get floor(): Floor { return this.doc.floors.find((f) => f.id === this.state.floorId) ?? this.doc.floors[0]; }

  // ---------- изменения документа
  /** Применяет изменение к копии документа и кладёт прежнюю версию в историю. */
  commit(fn: (d: MapDoc) => void, opts: { keepSel?: boolean } = {}) {
    const next = structuredClone(this.doc);
    fn(next);
    next.updatedAt = Date.now();
    this.past.push(this.doc);
    if (this.past.length > HISTORY) this.past.shift();
    this.future = [];
    this.applyDoc(next, opts.keepSel !== false);
  }

  /** Изменение текущего этажа. */
  commitFloor(fn: (f: Floor, d: MapDoc) => void, opts: { keepSel?: boolean } = {}) {
    const fid = this.floor.id;
    this.commit((d) => { const f = d.floors.find((x) => x.id === fid); if (f) fn(f, d); }, opts);
  }

  private applyDoc(doc: MapDoc, keepSel: boolean) {
    const floor = doc.floors.find((f) => f.id === this.state.floorId) ?? doc.floors[0];
    const layerId = floor.layers.some((l) => l.id === this.state.layerId) ? this.state.layerId : defaultLayer(floor);
    const sel = keepSel ? this.state.sel.filter((s) => exists(floor, s)) : [];
    this.set({ doc, floorId: floor.id, layerId, sel, canUndo: this.past.length > 0, canRedo: this.future.length > 0, dirty: true });
    this.docListeners.forEach((f) => f(doc));
  }

  undo() {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(this.doc);
    this.applyDoc(prev, true);
  }
  redo() {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.doc);
    this.applyDoc(next, true);
  }

  /** Новый документ целиком (открытие файла): история сбрасывается. */
  replaceDoc(doc: MapDoc) {
    this.past = []; this.future = [];
    const floor = doc.floors[0];
    this.set({ doc, floorId: floor.id, layerId: defaultLayer(floor), sel: [], canUndo: false, canRedo: false, dirty: false });
  }
  markSaved() { this.set({ dirty: false }); }

  // ---------- интерфейс
  setTool(tool: ToolId) { this.set({ tool, sel: tool === 'select' ? this.state.sel : [] }); }
  setSel(sel: SelItem[]) { this.set({ sel }); }
  setView(view: View) { this.set({ view }); }
  setFloor(floorId: string) {
    const f = this.doc.floors.find((x) => x.id === floorId);
    if (f) this.set({ floorId, layerId: defaultLayer(f), sel: [] });
  }
  setLayer(layerId: string) { this.set({ layerId }); }
  setSettings(patch: Partial<ToolSettings>) { this.set({ settings: { ...this.state.settings, ...patch } }); }

  // ---------- частые операции
  selected<K extends SelKind>(kind: K): (K extends 'object' ? MapObject : K extends 'portal' ? Portal : K extends 'wall' ? Wall : Room)[] {
    const ids = new Set(this.state.sel.filter((s) => s.kind === kind).map((s) => s.id));
    const f = this.floor;
    const list = kind === 'object' ? f.objects : kind === 'portal' ? f.portals : kind === 'wall' ? f.walls : f.rooms;
    return (list as { id: string }[]).filter((x) => ids.has(x.id)) as never;
  }

  deleteSelection() {
    if (!this.state.sel.length) return;
    const ids = new Set(this.state.sel.map((s) => s.id));
    this.commitFloor((f) => {
      f.objects = f.objects.filter((o) => !ids.has(o.id));
      f.portals = f.portals.filter((p) => !ids.has(p.id));
      f.walls = f.walls.filter((w) => !ids.has(w.id));
      f.rooms = f.rooms.filter((r) => !ids.has(r.id));
      const orphans = orphanPortals(f);
      f.portals = f.portals.filter((p) => !orphans.has(p.id));
    }, { keepSel: false });
  }

  copy() { this.clipboard = structuredClone(this.selected('object')); }
  paste(offset = 1) {
    if (!this.clipboard.length) return;
    const fresh = this.clipboard.map((o) => ({ ...o, id: uid('o'), x: o.x + offset, y: o.y + offset }));
    const layers = new Set(this.floor.layers.map((l) => l.id));
    for (const o of fresh) if (!layers.has(o.layer)) o.layer = this.state.layerId;
    this.commitFloor((f) => { f.objects.push(...fresh); });
    this.clipboard = fresh;
    this.setSel(fresh.map((o) => ({ kind: 'object' as const, id: o.id })));
  }
  duplicate() { this.copy(); this.paste(1); }
}

/** Слой по умолчанию: второй слой «под стенами» (обычно «Объекты»), иначе первый. */
function defaultLayer(f: Floor): string {
  const below = f.layers.filter((l) => !l.aboveWalls);
  return (below[1] ?? below[0] ?? f.layers[0]).id;
}

function exists(f: Floor, s: SelItem) {
  const list = s.kind === 'object' ? f.objects : s.kind === 'portal' ? f.portals : s.kind === 'wall' ? f.walls : f.rooms;
  return (list as { id: string }[]).some((x) => x.id === s.id);
}

export function useEditor<T>(ed: Editor, pick: (s: EditorState) => T): T {
  return useSyncExternalStore(ed.subscribe, () => pick(ed.state));
}
