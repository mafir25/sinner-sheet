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
  /** Тип комнаты (склад, офис…) — для правил размещения и генерации; см. model/rules.ts. */
  type?: string;
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
  /** Оттенок (умножение цвета), null/нет — исходные цвета. */
  tint?: string | null;
};

export type Layer = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  aboveWalls: boolean;
  /** Только для мастера: не попадает в версию для игроков. */
  gmOnly: boolean;
};

/** Мазок кисти местности: текстура по линии с мягким краем. asset = null — ластик. */
export type TerrainStroke = {
  id: string;
  asset: AssetKey | null;
  size: number;     // диаметр в клетках
  softness: number; // 0 — резкий край, 1 — очень мягкий
  opacity: number;
  points: Pt[];
};

/** Стиль пути: текстура или цвет, пунктир, обводка, объекты вдоль пути. */
export type PathStyle = {
  width: number;
  color: string;
  asset: AssetKey | null;
  dash: number;            // 0 — сплошная, иначе длина штриха (в клетках)
  outline: string | null;  // цвет обводки
  decor: AssetKey | null;  // картинка вдоль пути
  /** strip — лентой, изгибается по пути (забор, рельсы); repeat — отдельными объектами с шагом (столбы, фонари). */
  decorMode: 'strip' | 'repeat';
  decorScale: number;      // масштаб картинки вдоль пути
  spacing: number;         // шаг объектов в режиме repeat (клетки)
  /** Две параллельные линии по бокам пути (рельсы, двойная труба, бордюры); рисуются поверх картинки вдоль пути. */
  parallel: { gap: number; width: number; color: string; outline: string | null } | null;
};

export type MapPath = {
  id: string;
  layer: string;
  points: Pt[];
  smooth: boolean;
  closed: boolean;
  style: PathStyle;
};

export type Light = {
  id: string;
  x: number;
  y: number;
  radius: number;    // клеток
  color: string;
  intensity: number; // 0..1
  shadows: boolean;  // стены отбрасывают тень
};

export type Label = {
  id: string;
  x: number;
  y: number;
  text: string;
  size: number; // высота букв в клетках
  color: string;
  rot: number;
  font: 'head' | 'body';
  box: boolean;    // подложка
  gmOnly: boolean;
};

export type Roof = {
  id: string;
  poly: Poly;
  asset: AssetKey | null;
  color: string;
};

/** Картинка-подложка этажа (готовая карта, скан), подогнанная под сетку. */
export type FloorImage = {
  asset: AssetKey;
  x: number;
  y: number;
  ppc: number; // пикселей картинки на клетку
  opacity: number;
};

/** Освещение карты: общая темнота и её цвет. */
export type Lighting = {
  enabled: boolean;
  darkness: number; // 0 — день, 1 — полная тьма вне света
  color: string;
  wallShadows: boolean; // мягкие тени под стенами
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
  ground: AssetKey | null; // текстура под всем этажом
  terrain: TerrainStroke[];
  paths: MapPath[];
  lights: Light[];
  labels: Label[];
  roofs: Roof[];
  image: FloorImage | null;
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
  lighting: Lighting;
  floors: Floor[];
  createdAt: number;
  updatedAt: number;
};

/** Запись ассета в наборе (см. map-app/src/assets/tree.js). */
export type AssetKind = 'object' | 'floor' | 'wall' | 'door' | 'window' | 'terrain' | 'roof';
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
  /** Исходный размер картинки в пикселях (null — неизвестен). */
  size: { w: number; h: number } | null;
  /** Группа вариантов одного объекта внутри папки (ящик-1, ящик-2…). */
  group?: string;
  rules?: Rules;
};
export type DirNode = { path: string; name: { ru: string; en: string }; dirs: DirNode[]; files: string[]; sets: string[] };

/** Правила размещения (docs/map-editor.md §5), уже с умолчаниями — см. normRules в assets/tree.js. */
export type Place = 'free' | 'wall' | 'corner' | 'center' | 'road';
export type Relation = { to: string; dist: number };
export type Rules = {
  place: Place;
  where: 'any' | 'inside' | 'outside';
  gap: number;
  face: boolean;
  clearDoors: boolean;
  near: Relation[];
  avoid: Relation[];
  rooms: string[];
  districts: string[];
  state: string[];
  weight: number;
  min: number;
  max: number;
  rotate: 'none' | '90' | 'any';
  flip: boolean;
  scale: [number, number];
  tint: string[];
};

/** Комплект: несколько ассетов, расставленных относительно друг друга (стол + 4 стула). */
export type SetItem = { path: string; x: number; y: number; rot: number; flip: boolean; scale: number };
export type SetEntry = { id: string; dir: string; key: string; name: { ru: string; en: string }; items: SetItem[]; rules?: Rules };
