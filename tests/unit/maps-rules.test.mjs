// Этап 3 редактора карт: формат правил, комплекты, группы вариантов, размещение по правилам.
import { describe, it, expect } from 'vitest';
import { buildPack, matchTarget, normRules, resolvePath, setBounds } from '../../map-app/src/assets/tree.js';
import { rectPoly } from '../../map-app/src/geom/poly.ts';
import {
  boxesOverlap, checkObject, placeAtCenter, placeAtRoad, placeAtWall, placeInCorner, rollVariation, rotFacing,
} from '../../map-app/src/geom/place.ts';

const WALL = { asset: null, color: '#000', width: 0.25 };
const floor = (extra = {}) => ({
  id: 'f', name: '', visible: true, layers: [], objects: [], ground: null, terrain: [], paths: [], lights: [], labels: [], roofs: [], image: null,
  rooms: [{ id: 'r', poly: rectPoly({ x: 0, y: 0 }, { x: 6, y: 4 }), floor: null, wall: WALL }], portals: [], walls: [], ...extra,
});
const obj = (id, asset, x, y, w = 1, h = 1, rot = 0) => ({ id, asset, layer: 'l', x, y, w, h, rot, flipX: false, flipY: false, opacity: 1 });
const close = (p, q) => { expect(p.x).toBeCloseTo(q.x, 6); expect(p.y).toBeCloseTo(q.y, 6); };

const files = [
  { path: 'furniture/table.png', size: { w: 512, h: 256 } },
  { path: 'furniture/chair.png', size: { w: 256, h: 256 } },
  { path: 'furniture/shelf.png', size: { w: 512, h: 128 } },
  { path: 'boxes/crate-a.png', size: { w: 256, h: 256 } },
  { path: 'boxes/crate-b.png', size: { w: 256, h: 256 } },
  { path: 'boxes/barrel.png', size: { w: 256, h: 256 } },
];
const metas = {
  furniture: {
    rules: { where: 'inside', clearDoors: true },
    files: {
      'table.png': { tags: ['table'] },
      'chair.png': { rules: { near: [{ to: '#table', dist: 0.5 }], max: 2 } },
      'shelf.png': { rules: { place: 'wall' } },
    },
    sets: { dining: { name: 'Обед', items: [{ file: 'table.png' }, { file: 'chair.png', y: -1 }, { file: '../boxes/barrel.png', x: 2 }, { file: 'nope.png' }] } },
  },
  boxes: {
    rules: { rotate: '90', flip: true, scale: [1.1, 0.9], tint: ['#aabbcc', 'red'] },
    files: { 'crate-a.png': { group: 'crate' }, 'crate-b.png': { group: 'crate' }, 'barrel.png': { tags: ['flammable'], rules: { rotate: 'any' } } },
  },
};
const pack = buildPack(files, metas);
const by = new Map(pack.assets.map((a) => [a.path, a]));
const entryOf = (k) => by.get(k);

describe('формат правил (_meta.json → manifest)', () => {
  it('умолчания и проверка значений', () => {
    const r = normRules({ place: 'wall', gap: -2, rotate: 'sideways', scale: [2, 0.5], tint: ['#ff0000', 'bad'], near: [{ to: '' }, { to: '#x' }], junk: 1 });
    expect(r).toMatchObject({ place: 'wall', face: true, gap: 0, rotate: 'none', scale: [0.5, 2], tint: ['#ff0000'], near: [{ to: '#x', dist: 1 }], max: 0 });
    expect(r).not.toHaveProperty('junk');
    expect(normRules({ place: 'center' }).face).toBe(false);
    expect(normRules(null).place).toBe('free');
  });
  it('правила папки и файла сливаются по полям', () => {
    expect(by.get('furniture/chair.png').rules).toMatchObject({ where: 'inside', clearDoors: true, max: 2 });
    expect(by.get('boxes/barrel.png').rules).toMatchObject({ rotate: 'any', flip: true, scale: [0.9, 1.1], tint: ['#aabbcc'] });
    expect(by.get('furniture/table.png').tags).toEqual(['table']);
  });
  it('группы вариантов', () => {
    expect(pack.assets.filter((a) => a.group === 'crate').map((a) => a.file)).toEqual(['crate-a.png', 'crate-b.png']);
    expect(by.get('boxes/barrel.png').group).toBeUndefined();
  });
  it('комплекты: пути от папки, «..», битые предметы отброшены', () => {
    expect(resolvePath('a/b', '../c/x.png')).toBe('a/c/x.png');
    expect(resolvePath('a/b', '/x.png')).toBe('x.png');
    expect(pack.sets).toHaveLength(1);
    const s = pack.sets[0];
    expect(s).toMatchObject({ id: 'furniture#dining', name: { ru: 'Обед', en: 'Обед' } });
    expect(s.items.map((i) => i.path)).toEqual(['furniture/table.png', 'furniture/chair.png', 'boxes/barrel.png']);
    expect(pack.tree.dirs.find((d) => d.path === 'furniture').sets).toEqual(['furniture#dining']);
    const b = setBounds(s, (p) => by.get(p)?.footprint);
    expect(b).toEqual({ w: 3.5, h: 2, cx: 0.75, cy: -0.5 });
  });
  it('цели правил: #тег, @группа, файл в той же папке, папка', () => {
    const t = by.get('furniture/table.png'), c = by.get('boxes/crate-a.png');
    expect(matchTarget('#table', t)).toBe(true);
    expect(matchTarget('@crate', c)).toBe(true);
    expect(matchTarget('table.png', t, 'furniture')).toBe(true);
    expect(matchTarget('table.png', t, 'boxes')).toBe(false);
    expect(matchTarget('/boxes', c, 'furniture')).toBe(true);
  });
});

describe('размещение по правилам', () => {
  const wallRule = normRules({ place: 'wall' });
  it('поворот «верх картинки — в сторону»', () => {
    expect(rotFacing({ x: 0, y: -1 })).toBe(0);
    expect(rotFacing({ x: 1, y: 0 })).toBe(90);
    expect(rotFacing({ x: 0, y: 1 })).toBe(180);
    expect(rotFacing({ x: -1, y: 0 })).toBe(270);
  });
  it('у стены: спиной к стене, вплотную к её краю, шаг вдоль стены — полклетки', () => {
    const f = floor();
    const top = placeAtWall(f, { x: 3.1, y: 0.6 }, 2, 0.5, 0, wallRule, true);
    expect(top.rot).toBe(0);
    close(top, { x: 3, y: 0.125 + 0.25 });
    const left = placeAtWall(f, { x: 0.4, y: 2.2 }, 2, 0.5, 0, wallRule, true);
    expect(left.rot).toBe(270);
    close(left, { x: 0.375, y: 2 });
    const bottom = placeAtWall(f, { x: 5.5, y: 3.6 }, 2, 0.5, 0, wallRule, false);
    expect(bottom.rot).toBe(180);
    close(bottom, { x: 5, y: 3.625 }); // не вылезает за конец стены
    expect(placeAtWall(f, { x: 3, y: -5 }, 1, 1, 0, wallRule, true)).toBeNull(); // далеко от стен
  });
  it('без автоповорота — свой поворот, отступ по повёрнутому размеру', () => {
    const p = placeAtWall(floor(), { x: 3, y: 0.6 }, 2, 0.5, 90, normRules({ place: 'wall', face: false, gap: 0.5 }), false);
    expect(p.rot).toBe(90);
    close(p, { x: 3, y: 0.125 + 0.5 + 1 });
  });
  it('в угол: вплотную к обеим стенам', () => {
    const p = placeInCorner(floor(), { x: 0.7, y: 0.6 }, 1, 1, 0, normRules({ place: 'corner' }));
    expect(p.rot).toBe(0);
    close(p, { x: 0.625, y: 0.625 });
    const q = placeInCorner(floor(), { x: 5.6, y: 3.2 }, 2, 1, 0, normRules({ place: 'corner' }));
    close(q, { x: 6 - 0.125 - (q.rot % 180 ? 0.5 : 1), y: 4 - 0.125 - (q.rot % 180 ? 1 : 0.5) });
  });
  it('в центр комнаты и вдоль дороги', () => {
    close(placeAtCenter(floor(), { x: 1, y: 1 }, 0), { x: 3, y: 2 });
    expect(placeAtCenter(floor(), { x: 9, y: 9 }, 0)).toBeNull();
    const road = { id: 'p', layer: 'l', points: [{ x: 0, y: 8 }, { x: 10, y: 8 }], smooth: false, closed: false, style: { width: 3, parallel: null } };
    const p = placeAtRoad(floor({ paths: [road] }), { x: 4, y: 10.2 }, 2, 0.5, 0, normRules({ place: 'road' }));
    expect(p.rot).toBe(180); // спиной от дороги
    close(p, { x: 4, y: 8 + 1.5 + 0.25 });
  });
});

describe('проверка правил', () => {
  it('рядом с, не загораживать двери, максимум на комнату', () => {
    const table = obj('t', 'furniture/table.png', 3, 2, 2, 1);
    const near = obj('c1', 'furniture/chair.png', 2.5, 1);
    const far = obj('c2', 'furniture/chair.png', 3, 3.8);
    const f = floor({ objects: [table, near, far], portals: [{ id: 'd', kind: 'door', a: { x: 2.5, y: 4 }, b: { x: 3.5, y: 4 }, asset: null }] });
    expect(checkObject(f, near, entryOf)).toEqual([]);
    const issues = checkObject(f, far, entryOf).map((i) => i.key);
    expect(issues).toContain('Рядом должен быть: {0}');
    expect(issues).toContain('Загораживает дверь');
    const third = obj('c3', 'furniture/chair.png', 4, 1);
    const f2 = { ...f, objects: [...f.objects, third] };
    expect(checkObject(f2, third, entryOf).map((i) => i.key)).toContain('Больше {0} на комнату');
  });
  it('в комнате / тип комнаты / не ближе к', () => {
    const outside = obj('o', 'furniture/table.png', 9, 9, 2, 1);
    expect(checkObject(floor(), outside, entryOf).map((i) => i.key)).toEqual(['Должен стоять в комнате']);
    const r = { ...normRules({ rooms: ['office'], avoid: [{ to: '#flammable', dist: 2 }] }) };
    const custom = new Map([...by, ['x.png', { ...by.get('furniture/table.png'), path: 'x.png', dir: '', rules: r }]]);
    const f = floor({ objects: [obj('b', 'boxes/barrel.png', 1, 1)] });
    f.rooms[0].type = 'living';
    const keys = checkObject(f, obj('x', 'x.png', 2.5, 1), (k) => custom.get(k)).map((i) => i.key);
    expect(keys).toEqual(['Не для комнаты «{0}»', 'Слишком близко к: {0}']);
  });
  it('пересечение повёрнутых прямоугольников', () => {
    expect(boxesOverlap({ x: 0, y: 0, w: 2, h: 2, rot: 45 }, { x: 1.6, y: 0, w: 1, h: 1, rot: 0 })).toBe(true);
    expect(boxesOverlap({ x: 0, y: 0, w: 2, h: 2, rot: 45 }, { x: 2.0, y: 0, w: 1, h: 1, rot: 0 })).toBe(false);
  });
  it('вариации: поворот, отражение, масштаб и оттенок в пределах правил', () => {
    const seq = [0.99, 0.2, 0.5, 0.7];
    let i = 0;
    const v = rollVariation(by.get('boxes/crate-a.png').rules, () => seq[i++ % seq.length]);
    expect(v).toEqual({ rot: 270, flip: true, scale: 1, tint: '#aabbcc' });
    expect(rollVariation(undefined)).toEqual({ rot: 0, flip: false, scale: 1, tint: null });
  });
});
