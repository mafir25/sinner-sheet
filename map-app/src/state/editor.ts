// Состояние редактора: документ карты, история (отмена/повтор), выделение, инструмент, вид.
import { useSyncExternalStore } from 'react';
import type { AssetKey, Floor, Label, Light, MapDoc, MapObject, MapPath, PathStyle, Portal, Pt, Roof, Room, Wall, WallStyle } from '../model/types';
import { DEFAULT_FLOOR, DEFAULT_PATH, DEFAULT_WALL, uid } from '../model/doc';
import { orphanPortals } from '../geom/walls';
import { share } from './share';

export type ToolId = 'select' | 'room' | 'poly' | 'wall' | 'door' | 'window' | 'cut' | 'stamp' | 'brush' | 'path' | 'light' | 'label' | 'roof' | 'ruler' | 'pan';
/** edge — отдельная стена комнаты: id «<id комнаты>|<кольцо>|<ребро>». */
export type SelKind = 'object' | 'portal' | 'wall' | 'room' | 'path' | 'light' | 'label' | 'roof' | 'edge';
export type SelItem = { kind: SelKind; id: string };
export type View = { scale: number; ox: number; oy: number }; // px на клетку, сдвиг начала координат в px

export type ToolSettings = {
  floor: AssetKey | null;
  wall: WallStyle;
  door: AssetKey | null;
  window: AssetKey | null;
  stamp: AssetKey | null;
  /** Комплект для инструмента «Объект» (ключ «<набор>|<id>», см. AssetStore.set); важнее stamp. */
  stampSet: string | null;
  stampRot: number;
  stampFlip: boolean;
  /** Правила размещения: прилипать к стенам, углам и т. п. (Alt — временно без них). */
  rules: boolean;
  /** Случайные вариации по правилам: поворот, отражение, масштаб, оттенок, вариант из группы. */
  vary: boolean;
  /** Подсвечивать объекты с нарушенными правилами. */
  showIssues: boolean;
  subtract: boolean;
  snap: boolean;
  brush: { asset: AssetKey | null; size: number; softness: number; opacity: number; erase: boolean };
  path: { style: PathStyle; smooth: boolean };
  light: { radius: number; color: string; intensity: number; shadows: boolean };
  label: { size: number; color: string; font: 'head' | 'body'; box: boolean; gmOnly: boolean; numbering: boolean; next: number };
  roof: { asset: AssetKey | null; color: string };
  /** Вид в редакторе: крыши и предпросмотр освещения. */
  showRoofs: 'hide' | 'ghost' | 'show';
  showLight: boolean;
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
  /** Когда карту сохраняли в файл (или открыли из файла); 0 — она есть только в браузере. */
  fileSavedAt = 0;

  constructor(doc: MapDoc) {
    const floor = doc.floors[0];
    this.state = {
      doc, floorId: floor.id, layerId: defaultLayer(floor),
      tool: 'select', sel: [], view: { scale: 48, ox: 40, oy: 40 },
      settings: {
        floor: DEFAULT_FLOOR, wall: { ...DEFAULT_WALL }, door: 'canon:portals/doors/wood.svg', window: 'canon:portals/windows/glass.svg',
        stamp: null, stampSet: null, stampRot: 0, stampFlip: false, rules: true, vary: true, showIssues: true, subtract: false, snap: true,
        brush: { asset: 'canon:terrain/dirt.svg', size: 2, softness: 0.6, opacity: 0.9, erase: false },
        path: { style: { ...DEFAULT_PATH }, smooth: true },
        light: { radius: 6, color: '#ffd9a0', intensity: 0.9, shadows: true },
        label: { size: 0.8, color: '#ffffff', font: 'head', box: false, gmOnly: false, numbering: false, next: 1 },
        roof: { asset: 'canon:roofs/tiles.svg', color: '#3a3a40' },
        showRoofs: 'ghost', showLight: true,
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
    const draft = structuredClone(this.doc);
    fn(draft);
    draft.updatedAt = Date.now();
    // неизменённые части берутся из прошлой версии — история не держит десятки копий одинаковых этажей
    const next = share(this.doc, draft);
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
  selected<K extends SelKind>(kind: K): SelType[K][] {
    if (kind === 'edge') return this.state.sel.filter((s) => s.kind === 'edge').map((s) => edgeOf(this.floor, s.id)).filter(Boolean) as never;
    const ids = new Set(this.state.sel.filter((s) => s.kind === kind).map((s) => s.id));
    return (listOf(this.floor, kind) as { id: string }[]).filter((x) => ids.has(x.id)) as never;
  }

  deleteSelection() {
    if (!this.state.sel.length) return;
    const ids = new Set(this.state.sel.map((s) => s.id));
    this.commitFloor((f) => {
      f.objects = f.objects.filter((o) => !ids.has(o.id));
      f.portals = f.portals.filter((p) => !ids.has(p.id));
      f.walls = f.walls.filter((w) => !ids.has(w.id));
      f.rooms = f.rooms.filter((r) => !ids.has(r.id));
      f.paths = f.paths.filter((x) => !ids.has(x.id));
      f.lights = f.lights.filter((x) => !ids.has(x.id));
      f.labels = f.labels.filter((x) => !ids.has(x.id));
      f.roofs = f.roofs.filter((x) => !ids.has(x.id));
      // отдельная стена комнаты: «удалить» = убрать стену (проём без стены по всему ребру)
      for (const s of this.state.sel) {
        if (s.kind !== 'edge') continue;
        const e = edgeOf(f, s.id);
        if (e && !f.portals.some((p) => p.kind === 'gap' && samePts(p, e))) f.portals.push({ id: uid('d'), kind: 'gap', a: e.a, b: e.b, asset: null });
      }
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

/** Отдельная стена комнаты по id выделения. */
export type Edge = { id: string; room: Room; ring: number; index: number; a: Pt; b: Pt };
export const edgeId = (roomId: string, ring: number, index: number) => `${roomId}|${ring}|${index}`;
export function edgeOf(f: Floor, id: string): Edge | null {
  const [rid, ri, ii] = id.split('|');
  const room = f.rooms.find((r) => r.id === rid), ring = room?.poly[Number(ri)];
  if (!room || !ring || !ring[Number(ii)]) return null;
  const i = Number(ii);
  return { id, room, ring: Number(ri), index: i, a: ring[i], b: ring[(i + 1) % ring.length] };
}
const samePts = (p: { a: Pt; b: Pt }, e: { a: Pt; b: Pt }) => {
  const n = (u: Pt, v: Pt) => Math.abs(u.x - v.x) < 1e-4 && Math.abs(u.y - v.y) < 1e-4;
  return (n(p.a, e.a) && n(p.b, e.b)) || (n(p.a, e.b) && n(p.b, e.a));
};

type SelType = { object: MapObject; portal: Portal; wall: Wall; room: Room; path: MapPath; light: Light; label: Label; roof: Roof; edge: Edge };
export function listOf<K extends SelKind>(f: Floor, kind: K): SelType[K][] {
  const map: { [k in SelKind]: SelType[k][] } = {
    object: f.objects, portal: f.portals, wall: f.walls, room: f.rooms, path: f.paths, light: f.lights, label: f.labels, roof: f.roofs, edge: [],
  };
  return map[kind] as SelType[K][];
}

function exists(f: Floor, s: SelItem) {
  if (s.kind === 'edge') return !!edgeOf(f, s.id);
  return (listOf(f, s.kind) as { id: string }[]).some((x) => x.id === s.id);
}

export function useEditor<T>(ed: Editor, pick: (s: EditorState) => T): T {
  return useSyncExternalStore(ed.subscribe, () => pick(ed.state));
}
