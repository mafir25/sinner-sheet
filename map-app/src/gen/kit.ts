// Что генератор знает о наборах: объекты с правилами (§5), комплекты, мусор, укрытия, ловушки,
// и стили — какими полами, стенами, дверями и окнами оформлять комнаты разных типов.
// Не зависит от браузера: в тестах набор собирается из Assets/Maps/manifest.json.
import type { AssetEntry, AssetKey, Rules, SetEntry } from '../model/types';
import { groupMembers, normRules } from '../assets/tree.js';

export type KitPack = { id: string; assets: AssetEntry[]; sets: SetEntry[] };

/** Что можно поставить: один ассет (с вариантами из группы) или комплект. */
export type Cand =
  | { kind: 'asset'; key: AssetKey; entry: AssetEntry; rules: Rules; variants: AssetKey[] }
  | { kind: 'set'; key: string; set: SetEntry; rules: Rules; items: { path: string; key: AssetKey; entry: AssetEntry; x: number; y: number; rot: number; flip: boolean; scale: number }[] };

export type GenKit = {
  /** Мебель и прочее с правилами (без мусора и ловушек). */
  objects: Cand[];
  debris: Cand[];
  traps: Cand[];
  cover: Cand[];
  entryOf(key: AssetKey): AssetEntry | undefined;
  /** Первый существующий ключ из списка, иначе — любой ассет этого вида, иначе null. */
  pick(kind: AssetEntry['kind'], prefer: AssetKey[]): AssetKey | null;
};

export const keyFor = (packId: string, path: string): AssetKey => (packId === 'canon' ? `canon:${path}` : `local:${packId}/${path}`);

/**
 * Каталог генератора. packs — наборы, из которых берутся объекты («по правилам выбранного набора»);
 * materials — откуда брать полы, стены, двери (обычно все наборы).
 */
export function makeKit(packs: KitPack[], materials: KitPack[] = packs): GenKit {
  const all = new Map<AssetKey, AssetEntry>();
  for (const p of [...materials, ...packs]) for (const a of p.assets) all.set(keyFor(p.id, a.path), a);
  const objects: Cand[] = [], debris: Cand[] = [], traps: Cand[] = [], cover: Cand[] = [];
  for (const p of packs) {
    for (const a of p.assets) {
      if (a.kind !== 'object') continue;
      const tags = a.tags;
      const isDebris = tags.includes('debris'), isTrap = tags.includes('trap');
      if (!a.rules && !isDebris && !isTrap) continue; // без правил объект в генерацию не попадает
      // группа вариантов — одна запись (первый файл), варианты выбираются при установке
      const members = groupMembers(p.assets, a);
      if (a.group && members[0] !== a.path) continue;
      const c: Cand = { kind: 'asset', key: keyFor(p.id, a.path), entry: a, rules: a.rules ?? normRules({}), variants: members.map((m) => keyFor(p.id, m)) };
      if (isTrap) traps.push(c);
      else if (isDebris) debris.push(c);
      else objects.push(c);
      if (tags.includes('cover')) cover.push(c);
    }
    const byPath = new Map(p.assets.map((a) => [a.path, a]));
    for (const s of p.sets) {
      if (!s.rules) continue;
      const items = s.items.filter((it) => byPath.has(it.path)).map((it) => ({ ...it, key: keyFor(p.id, it.path), entry: byPath.get(it.path)! }));
      if (items.length) objects.push({ kind: 'set', key: `${p.id}|${s.id}`, set: s, rules: s.rules, items });
    }
  }
  const byKind = (kind: AssetEntry['kind']) => [...all].filter(([, e]) => e.kind === kind).map(([k]) => k);
  return {
    objects, debris, traps, cover,
    entryOf: (k) => all.get(k),
    pick: (kind, prefer) => prefer.find((k) => all.get(k)?.kind === kind) ?? byKind(kind)[0] ?? null,
  };
}

// ---------- стили оформления
export type Condition = 'new' | 'worn' | 'ruined';
export type StyleId = 'wing' | 'backstreets' | 'lab' | 'ruins';
export type Style = {
  id: StyleId;
  name: { ru: string; en: string };
  condition: Condition;
  /** Пол по типу комнаты ('*' — остальные). */
  floors: Record<string, AssetKey[]>;
  walls: AssetKey[];
  wallColor: string;
  doors: AssetKey[];
  bigDoors: AssetKey[];
  windows: AssetKey[];
  roofs: AssetKey[];
  ground: AssetKey | null;
  /** Типы комнат для «раскраски» наброска (тип — вес) и тип самой большой комнаты. */
  rooms: [string, number][];
  hall: string;
  windowChance: number;
  light: string;
};

const C = (p: string) => `canon:${p}`;
export const STYLES: Style[] = [
  {
    id: 'wing', name: { ru: 'Крыло (чистый офис)', en: 'Wing (clean office)' }, condition: 'new',
    floors: { office: [C('floors/carpet.svg')], lab: [C('floors/lab.svg')], clinic: [C('floors/lab.svg')], bathroom: [C('floors/tiles.svg')], kitchen: [C('floors/tiles.svg')], corridor: [C('floors/tiles.svg')], warehouse: [C('floors/concrete.svg')], '*': [C('floors/wood.svg')] },
    walls: [C('walls/concrete.svg')], wallColor: '#1c1c1e', doors: [C('portals/doors/wood.svg')], bigDoors: [C('portals/doors/double.svg')],
    windows: [C('portals/windows/glass.svg'), C('portals/windows/wide.svg')], roofs: [C('roofs/concrete.svg')], ground: C('floors/asphalt.svg'),
    rooms: [['office', 5], ['kitchen', 1], ['bathroom', 1], ['clinic', 1]], hall: 'office', windowChance: 0.8, light: '#e8f4ff',
  },
  {
    id: 'backstreets', name: { ru: 'Задворки', en: 'Backstreets' }, condition: 'worn',
    floors: { living: [C('floors/wood.svg')], bar: [C('floors/wood.svg')], kitchen: [C('floors/tiles.svg')], bathroom: [C('floors/tiles.svg')], workshop: [C('floors/metal.svg')], shop: [C('floors/tiles.svg')], '*': [C('floors/concrete.svg')] },
    walls: [C('walls/brick.svg')], wallColor: '#2a1d18', doors: [C('portals/doors/wood.svg'), C('portals/doors/metal.svg')], bigDoors: [C('portals/doors/shutter.svg')],
    windows: [C('portals/windows/barred.svg'), C('portals/windows/glass.svg')], roofs: [C('roofs/tar.svg'), C('roofs/metal.svg'), C('roofs/tiles.svg')], ground: C('floors/concrete.svg'),
    rooms: [['living', 3], ['kitchen', 1], ['bathroom', 1], ['warehouse', 1], ['bar', 1], ['workshop', 1]], hall: 'warehouse', windowChance: 0.5, light: '#ffd9a0',
  },
  {
    id: 'lab', name: { ru: 'Лаборатория', en: 'Laboratory' }, condition: 'new',
    floors: { lab: [C('floors/lab.svg')], clinic: [C('floors/lab.svg')], corridor: [C('floors/metal.svg')], office: [C('floors/carpet.svg')], '*': [C('floors/tiles.svg')] },
    walls: [C('walls/metal.svg')], wallColor: '#30343a', doors: [C('portals/doors/metal.svg')], bigDoors: [C('portals/doors/double.svg')],
    windows: [C('portals/windows/glass.svg')], roofs: [C('roofs/metal.svg')], ground: C('floors/concrete.svg'),
    rooms: [['lab', 4], ['office', 1], ['clinic', 1], ['warehouse', 1], ['bathroom', 1]], hall: 'lab', windowChance: 0.3, light: '#d8ffff',
  },
  {
    id: 'ruins', name: { ru: 'Руины', en: 'Ruins' }, condition: 'ruined',
    floors: { living: [C('floors/wood.svg')], '*': [C('floors/concrete.svg')] },
    walls: [C('walls/concrete.svg'), C('walls/brick.svg')], wallColor: '#222', doors: [C('portals/doors/metal.svg')], bigDoors: [C('portals/doors/shutter.svg')],
    windows: [C('portals/windows/barred.svg')], roofs: [C('roofs/concrete.svg')], ground: C('terrain/gravel.svg'),
    rooms: [['hideout', 3], ['warehouse', 2], ['workshop', 1], ['living', 1]], hall: 'warehouse', windowChance: 0.35, light: '#ffb070',
  },
];
export const styleById = (id: string) => STYLES.find((s) => s.id === id) ?? STYLES[0];

/** Насколько плотно ставить мебель (объектов на клетку площади) и какие теги любит тип комнаты. */
export const ROOM_PROFILE: Record<string, { density: number; boost?: Record<string, number> }> = {
  office: { density: 0.09, boost: { table: 2 } },
  warehouse: { density: 0.1, boost: { crate: 5, cover: 2, flammable: 2 } },
  lab: { density: 0.08 },
  workshop: { density: 0.09, boost: { flammable: 1 } },
  living: { density: 0.08 },
  kitchen: { density: 0.08, boost: { table: 2 } },
  bar: { density: 0.1, boost: { table: 3, seat: 2 } },
  shop: { density: 0.08, boost: { crate: 1 } },
  clinic: { density: 0.07 },
  corridor: { density: 0.015 },
  bathroom: { density: 0.04 },
  hideout: { density: 0.09, boost: { crate: 2, cover: 2 } },
};

/** Типы зданий: какие комнаты в них бывают и есть ли коридор или большой зал. */
export type BuildingType = 'office' | 'warehouse' | 'lab' | 'house' | 'bar' | 'clinic' | 'workshop' | 'hideout' | 'shop';
export const BUILDINGS: Record<BuildingType, { name: { ru: string; en: string }; rooms: [string, number][]; hall?: string; corridor: boolean; style: StyleId }> = {
  office: { name: { ru: 'Офис', en: 'Office' }, rooms: [['office', 5], ['kitchen', 1], ['bathroom', 1]], corridor: true, style: 'wing' },
  warehouse: { name: { ru: 'Склад', en: 'Warehouse' }, rooms: [['office', 1], ['bathroom', 1], ['warehouse', 2]], hall: 'warehouse', corridor: false, style: 'backstreets' },
  lab: { name: { ru: 'Лаборатория', en: 'Laboratory' }, rooms: [['lab', 4], ['office', 1], ['clinic', 1], ['bathroom', 1]], corridor: true, style: 'lab' },
  house: { name: { ru: 'Жилой дом', en: 'House' }, rooms: [['living', 3], ['kitchen', 1], ['bathroom', 1]], corridor: false, style: 'backstreets' },
  bar: { name: { ru: 'Бар', en: 'Bar' }, rooms: [['kitchen', 1], ['bathroom', 1], ['warehouse', 1]], hall: 'bar', corridor: false, style: 'backstreets' },
  clinic: { name: { ru: 'Клиника', en: 'Clinic' }, rooms: [['clinic', 3], ['office', 1], ['bathroom', 1]], corridor: true, style: 'wing' },
  workshop: { name: { ru: 'Мастерская', en: 'Workshop' }, rooms: [['warehouse', 1], ['office', 1], ['bathroom', 1]], hall: 'workshop', corridor: false, style: 'backstreets' },
  hideout: { name: { ru: 'Логово', en: 'Hideout' }, rooms: [['hideout', 2], ['living', 1], ['warehouse', 1]], corridor: false, style: 'ruins' },
  shop: { name: { ru: 'Магазин', en: 'Shop' }, rooms: [['warehouse', 1], ['bathroom', 1]], hall: 'shop', corridor: false, style: 'backstreets' },
};
export const DUNGEON_ROOMS: [string, number][] = [['hideout', 3], ['warehouse', 2], ['lab', 1], ['workshop', 1], ['living', 1]];
