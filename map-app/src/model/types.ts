// Формат карты. Единица координат — клетка (1 = одна клетка = 5 футов).
// Файл .pmmap = ZIP: map.json (MapDoc) + assets/… (локальные ассеты). См. docs/map-editor.md §6.

export type Pt = { x: number; y: number };
/** Кольцо многоугольника (без повтора первой точки). */
export type Ring = Pt[];
/** Многоугольник: внешний контур + дыры. */
export type Poly = Ring[];

export type GridType = 'square' | 'hex-flat' | 'hex-pointy' | 'none';

export type Grid = {
  type: GridType;
  show: boolean;
  color: string;
  opacity: number;
};

/** Ссылка на ассет: canon:<путь в Assets/Maps> или local:<id набора>/<путь>. */
export type AssetKey = string;

/** Стиль стены: текстура (ассет kind=wall) или null — сплошной цвет; ширина в клетках. */
export type WallStyle = { asset: AssetKey | null; color: string; width: number };

export type Room = {
  id: string;
  poly: Poly;
  floor: AssetKey | null;
  wall: WallStyle;
};

export type Wall = {
  id: string;
  points: Pt[];
  closed: boolean;
  wall: WallStyle;
};

export type PortalKind = 'door' | 'window';

export type Portal = {
  id: string;
  kind: PortalKind;
  a: Pt;
  b: Pt;
  asset: AssetKey | null;
};

export type MapObject = {
  id: string;
  asset: AssetKey;
  layer: string;
  x: number; // центр
  y: number;
  w: number; // размер в клетках (с учётом масштаба)
  h: number;
  rot: number; // градусы
  flipX: boolean;
  flipY: boolean;
  opacity: number;
};

export type Layer = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  aboveWalls: boolean;
};

export type Floor = {
  id: string;
  name: string;
  visible: boolean;
  rooms: Room[];
  walls: Wall[];
  portals: Portal[];
  objects: MapObject[];
  layers: Layer[];
};

export type MapDoc = {
  format: 'pm-map';
  version: 1;
  id: string;
  name: string;
  width: number;  // клеток
  height: number;
  background: string;
  grid: Grid;
  floors: Floor[];
  createdAt: number;
  updatedAt: number;
};

/** Запись ассета в наборе (см. map-app/src/assets/tree.js). */
export type AssetKind = 'object' | 'floor' | 'wall' | 'door' | 'window' | 'terrain';
export type AssetEntry = {
  path: string;
  dir: string;
  file: string;
  name: { ru: string; en: string };
  kind: AssetKind;
  footprint: [number, number];
  ppc: number;
  scalable: boolean;
  layer: 'below' | 'above';
  pixelated: boolean;
  tags: string[];
  rules?: Record<string, unknown>;
};
export type DirNode = { path: string; name: { ru: string; en: string }; dirs: DirNode[]; files: string[] };
