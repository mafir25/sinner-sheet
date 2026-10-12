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

/**
 * Куда стена отбрасывает «грань» (псевдо-3D, как в Enter the Gungeon):
 * down — вниз по экрану (вид чуть сверху-спереди), up — вверх, normal — по всему периметру от стены, none — нет.
 */
export type FaceDir = 'none' | 'down' | 'up' | 'normal';

/**
 * Стиль стены. asset — текстура (ассет kind=wall) или null — сплошной цвет; width — толщина в клетках.
 * height > 0 — объёмная стена: сама стена тонкая тёмная линия, текстура ложится гранью высотой height клеток
 * по правилам inner (сторона внутри помещения) и outer (снаружи; у отдельных стен — обе стороны).
 * height 0 или нет — плоская стена прежнего вида (толстая линия с текстурой).
 */
export type WallStyle = {
  asset: AssetKey | null; color: string; width: number; height?: number; inner?: FaceDir; outer?: FaceDir;
  /** Низкая стена (по пояс: ограждение, перила, парапет): не закрывает обзор и свет, в `.dd2vtt` не попадает. */
  low?: boolean;
  /** Варианты текстуры грани (файлы её группы): шанс плитки 0…1 (нет — DEFAULT_VARY) и зерно раскладки. */
  vary?: number;
  varySeed?: number;
};

export type Room = {
  id: string;
  poly: Poly;
  floor: AssetKey | null;
  wall: WallStyle;
  /** Тип комнаты (склад, офис…) — для правил размещения и генерации; см. model/rules.ts. */
  type?: string;
  /** Отдельные стены комнаты со своими настройками: ребро a–b (в любом порядке) и что в нём отличается. */
  edgeStyles?: EdgeStyle[];
  /** Варианты текстуры пола: шанс клетки 0…1 (нет — DEFAULT_VARY) и зерно раскладки. */
  floorVary?: number;
  floorSeed?: number;
};
export type EdgeStyle = { a: Pt; b: Pt; style: Partial<WallStyle> };

export type Wall = {
  id: string;
  points: Pt[];
  closed: boolean;
  wall: WallStyle;
};

/**
 * gap — проём без стены (гараж, навес): стены нет, двери тоже.
 * insert — вставка варианта текстуры стены (щиток, решётка, светодиод): ставится как дверь, но остаётся стеной —
 * свет, взгляд и `.dd2vtt` её не замечают; картинка ложится на грань целиком.
 */
export type PortalKind = 'door' | 'window' | 'gap' | 'insert';

export type Portal = {
  id: string;
  kind: PortalKind;
  a: Pt;
  b: Pt;
  /** Картинка двери/окна; null — пустой проём (арка, вырез): взгляд и свет проходят. */
  asset: AssetKey | null;
  /** На объёмной стене: доли высоты грани — перемычка сверху и подоконник снизу; arch — арка. */
  top?: number;
  bottom?: number;
  arch?: boolean;
  /** Как рисовать дверь/окно на объёмной стене: auto — по углу стены (MapDoc.portalAngle), face — в грани, line — участком линии. */
  view?: 'auto' | 'face' | 'line';
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
  /** На крыше: рисуется поверх крыш и только когда крыши видны (вентиляция, люк, антенны). */
  roof?: boolean;
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
  /** Ссылка на запись Базы знаний (или другую страницу сайта), открывается из свойств подписи. */
  link?: string;
};

/** Форма крыши: плоская (с парапетом), вальмовая (скаты на все стороны), двускатная, односкатная. */
export type RoofShape = 'flat' | 'hip' | 'gable' | 'shed';
export type Side = 'n' | 'e' | 's' | 'w';

export type Roof = {
  id: string;
  poly: Poly;
  asset: AssetKey | null;
  color: string;
  /** Нет — вальмовая (так открываются старые карты). */
  shape?: RoofShape;
  /** Конёк двускатной: вдоль x (h) или вдоль y (v); нет — вдоль длинной стороны. */
  ridge?: 'h' | 'v';
  /** Куда стекает односкатная крыша (нижний край); нет — на юг. */
  fall?: Side;
  /** Высота крыши над землёй, фт: подпись для мастера (с какой высоты падать, куда допрыгнуть). */
  height?: number;
};

/**
 * Уровень местности: участок выше или ниже земли этажа (помост, насыпь, платформа — яма, канал, котлован).
 * Высота h — в футах относительно земли. Участки не перекрываются: новый вырезает себе место у старых.
 */
export type Level = {
  id: string;
  poly: Poly;
  h: number;
  /** Покрытие верха; null — видно то, что под ним (пол, земля). */
  floor: AssetKey | null;
  /** Текстура обрыва (ассет вида «стена»); null — цвет color. */
  face: AssetKey | null;
  color: string;
  /** Подпись высоты («+10 фт») на карте — видна и игрокам. */
  label: boolean;
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
  /** Видимость: нижний этаж под текущим (полупрозрачно) и надстройка над текущим. */
  visible: boolean;
  /** Надстройка или чердак: id этажа, над которым стоит; на нём рисуется поверх, на высоте стен (см. geom/storeys.ts). */
  base?: string;
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
  /** Уровни местности (возвышения и ямы). Нет в старых картах — считается пустым. */
  levels: Level[];
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
  /** Район Города (из world.json): палитра карты и контекст генерации. */
  district?: District;
  /** Ссылки карты: записи Базы знаний и др. страницы сайта. */
  links?: SiteLink[];
  /**
   * Угол стены от горизонтали (°), круче которого двери и окна на объёмной стене рисуются участком линии стены,
   * а не в грани (грань почти ребром — проём не видно). Нет — DEFAULT_PORTAL_ANGLE; 90 — никогда.
   */
  portalAngle?: number;
};

/** Район Города: id узла-группы в world.json, цвет, буква Крыла, все имена для правил `districts`. */
export type District = { id: string; name: string; color: string; wing?: string; faction?: string; aliases: string[] };
export type SiteLink = { title: string; url: string };

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
