import { z } from 'zod';
import type { Floor, Layer, Lighting, MapDoc, PathStyle, WallStyle } from './types';
import { tr } from '../i18n';

export const uid = (p = '') => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const DEFAULT_WALL: WallStyle = { asset: 'canon:walls/concrete.svg', color: '#0c0c0e', width: 0.1, height: 1, inner: 'down', outer: 'down' };
export const DEFAULT_FLOOR = 'canon:floors/concrete.svg';
export const DEFAULT_LIGHTING: Lighting = { enabled: false, darkness: 0.7, color: '#05060a', wallShadows: true };
export const DEFAULT_PATH: PathStyle = { width: 3, color: '#2a2b2e', asset: 'canon:floors/asphalt.svg', dash: 0, outline: '#141416', decor: null, decorMode: 'strip', decorScale: 1, spacing: 1, parallel: null };

export function defaultLayers(): Layer[] {
  return [
    { id: uid('l'), name: tr('Декор пола'), visible: true, locked: false, aboveWalls: false, gmOnly: false },
    { id: uid('l'), name: tr('Объекты'), visible: true, locked: false, aboveWalls: false, gmOnly: false },
    { id: uid('l'), name: tr('Над стенами'), visible: true, locked: false, aboveWalls: true, gmOnly: false },
  ];
}

export function newFloor(name: string): Floor {
  return {
    id: uid('f'), name, visible: true, rooms: [], walls: [], portals: [], objects: [], layers: defaultLayers(),
    ground: null, terrain: [], paths: [], lights: [], labels: [], roofs: [], image: null,
  };
}

export function createDoc(opts: { name: string; width: number; height: number; grid: MapDoc['grid']['type']; floorName: string }): MapDoc {
  const now = Date.now();
  return {
    format: 'pm-map', version: 1, id: uid('m'), name: opts.name,
    width: opts.width, height: opts.height, background: '#101012',
    grid: { type: opts.grid, show: true, color: '#000000', opacity: 0.35 },
    lighting: { ...DEFAULT_LIGHTING },
    floors: [newFloor(opts.floorName)],
    createdAt: now, updatedAt: now,
  };
}

// ---------- проверка файла при открытии
const num = z.number().finite();
const pt = z.object({ x: num, y: num });
const ring = z.array(pt).min(3);
const wallStyle = z.object({
  asset: z.string().nullable().default(null),
  color: z.string().default('#1c1c1e'),
  width: num.min(0.02).max(4).default(0.25),
  height: num.min(0).max(6).optional(),
  inner: z.enum(['none', 'down', 'up', 'normal']).optional(),
  outer: z.enum(['none', 'down', 'up', 'normal']).optional(),
});
const layer = z.object({
  id: z.string(), name: z.string().default(''), visible: z.boolean().default(true),
  locked: z.boolean().default(false), aboveWalls: z.boolean().default(false), gmOnly: z.boolean().default(false),
});
const asset = z.string().nullable().default(null);
const pathStyle = z.object({
  width: num.min(0).max(50).default(1), color: z.string().default('#2a2b2e'), asset, dash: num.min(0).default(0),
  outline: z.string().nullable().default(null), decor: asset, spacing: num.min(0.1).default(1),
  decorMode: z.enum(['strip', 'repeat']).default('strip'), decorScale: num.min(0.05).max(20).default(1),
  parallel: z.object({
    gap: num.min(0.02).max(50), width: num.min(0.01).max(10), color: z.string(), outline: z.string().nullable().default(null),
  }).nullable().default(null),
});
const floor = z.object({
  id: z.string(),
  name: z.string().default(''),
  visible: z.boolean().default(true),
  rooms: z.array(z.object({ id: z.string(), poly: z.array(ring).min(1), floor: z.string().nullable().default(null), wall: wallStyle, type: z.string().optional() })).default([]),
  walls: z.array(z.object({ id: z.string(), points: z.array(pt).min(2), closed: z.boolean().default(false), wall: wallStyle })).default([]),
  portals: z.array(z.object({ id: z.string(), kind: z.enum(['door', 'window', 'gap']), a: pt, b: pt, asset: z.string().nullable().default(null) })).default([]),
  objects: z.array(z.object({
    id: z.string(), asset: z.string(), layer: z.string(), x: num, y: num, w: num.positive(), h: num.positive(),
    rot: num.default(0), flipX: z.boolean().default(false), flipY: z.boolean().default(false), opacity: num.min(0).max(1).default(1),
    tint: z.string().nullable().optional(),
  })).default([]),
  layers: z.array(layer).default([]),
  ground: asset,
  terrain: z.array(z.object({
    id: z.string(), asset, size: num.positive(), softness: num.min(0).max(1).default(0.5),
    opacity: num.min(0).max(1).default(1), points: z.array(pt).min(1),
  })).default([]),
  paths: z.array(z.object({
    id: z.string(), layer: z.string(), points: z.array(pt).min(2), smooth: z.boolean().default(true),
    closed: z.boolean().default(false), style: pathStyle,
  })).default([]),
  lights: z.array(z.object({
    id: z.string(), x: num, y: num, radius: num.positive(), color: z.string().default('#ffe8b0'),
    intensity: num.min(0).max(1).default(0.9), shadows: z.boolean().default(true),
  })).default([]),
  labels: z.array(z.object({
    id: z.string(), x: num, y: num, text: z.string(), size: num.positive().default(0.6), color: z.string().default('#ffffff'),
    rot: num.default(0), font: z.enum(['head', 'body']).default('head'), box: z.boolean().default(false), gmOnly: z.boolean().default(false),
    link: z.string().max(2000).optional(),
  })).default([]),
  roofs: z.array(z.object({ id: z.string(), poly: z.array(ring).min(1), asset, color: z.string().default('#3a3a40') })).default([]),
  image: z.object({ asset: z.string(), x: num, y: num, ppc: num.positive(), opacity: num.min(0).max(1).default(1) }).nullable().default(null),
});
const docSchema = z.object({
  format: z.literal('pm-map'),
  version: z.literal(1),
  id: z.string(),
  name: z.string().default(''),
  width: num.int().min(1).max(500),
  height: num.int().min(1).max(500),
  background: z.string().default('#101012'),
  grid: z.object({
    type: z.enum(['square', 'hex-flat', 'hex-pointy', 'none']).default('square'),
    show: z.boolean().default(true), color: z.string().default('#000000'), opacity: num.min(0).max(1).default(0.35),
  }),
  lighting: z.object({
    enabled: z.boolean().default(false), darkness: num.min(0).max(1).default(0.7),
    color: z.string().default('#05060a'), wallShadows: z.boolean().default(true),
  }).default({}),
  floors: z.array(floor).min(1),
  createdAt: num.default(0),
  updatedAt: num.default(0),
  district: z.object({
    id: z.string(), name: z.string(), color: z.string(), wing: z.string().optional(), faction: z.string().optional(),
    aliases: z.array(z.string()).default([]),
  }).optional(),
  links: z.array(z.object({ title: z.string().max(200), url: z.string().max(2000) })).optional(),
});

/** Проверяет и дополняет документ из файла. Бросает ошибку с понятным текстом. */
export function parseDoc(raw: unknown): MapDoc {
  const r = docSchema.safeParse(raw);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new Error(`${i.path.join('.') || 'map.json'}: ${i.message}`);
  }
  const doc = r.data as MapDoc;
  // у этажа без слоёв — слои по умолчанию; объекты с неизвестным слоем — в первый слой
  for (const f of doc.floors) {
    if (!f.layers.length) f.layers = defaultLayers();
    const ids = new Set(f.layers.map((l) => l.id));
    const fallback = f.layers.find((l) => !l.aboveWalls)?.id ?? f.layers[0].id;
    for (const o of f.objects) if (!ids.has(o.layer)) o.layer = fallback;
  }
  return doc;
}
