import { z } from 'zod';
import type { Floor, Layer, MapDoc, WallStyle } from './types';
import { tr } from '../i18n';

export const uid = (p = '') => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const DEFAULT_WALL: WallStyle = { asset: 'canon:walls/concrete.svg', color: '#1c1c1e', width: 0.25 };
export const DEFAULT_FLOOR = 'canon:floors/concrete.svg';

export function defaultLayers(): Layer[] {
  return [
    { id: uid('l'), name: tr('Декор пола'), visible: true, locked: false, aboveWalls: false },
    { id: uid('l'), name: tr('Объекты'), visible: true, locked: false, aboveWalls: false },
    { id: uid('l'), name: tr('Над стенами'), visible: true, locked: false, aboveWalls: true },
  ];
}

export function newFloor(name: string): Floor {
  return { id: uid('f'), name, visible: true, rooms: [], walls: [], portals: [], objects: [], layers: defaultLayers() };
}

export function createDoc(opts: { name: string; width: number; height: number; grid: MapDoc['grid']['type']; floorName: string }): MapDoc {
  const now = Date.now();
  return {
    format: 'pm-map', version: 1, id: uid('m'), name: opts.name,
    width: opts.width, height: opts.height, background: '#101012',
    grid: { type: opts.grid, show: true, color: '#000000', opacity: 0.35 },
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
});
const layer = z.object({
  id: z.string(), name: z.string().default(''), visible: z.boolean().default(true),
  locked: z.boolean().default(false), aboveWalls: z.boolean().default(false),
});
const floor = z.object({
  id: z.string(),
  name: z.string().default(''),
  visible: z.boolean().default(true),
  rooms: z.array(z.object({ id: z.string(), poly: z.array(ring).min(1), floor: z.string().nullable().default(null), wall: wallStyle })).default([]),
  walls: z.array(z.object({ id: z.string(), points: z.array(pt).min(2), closed: z.boolean().default(false), wall: wallStyle })).default([]),
  portals: z.array(z.object({ id: z.string(), kind: z.enum(['door', 'window']), a: pt, b: pt, asset: z.string().nullable().default(null) })).default([]),
  objects: z.array(z.object({
    id: z.string(), asset: z.string(), layer: z.string(), x: num, y: num, w: num.positive(), h: num.positive(),
    rot: num.default(0), flipX: z.boolean().default(false), flipY: z.boolean().default(false), opacity: num.min(0).max(1).default(1),
  })).default([]),
  layers: z.array(layer).default([]),
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
  floors: z.array(floor).min(1),
  createdAt: num.default(0),
  updatedAt: num.default(0),
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
