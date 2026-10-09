import { describe, it, expect } from 'vitest';
import { buildPack, footprintFor, pngSize, svgSize, switchDir, variantChain } from '../../map-app/src/assets/tree.js';
import { difference, rectPoly, union } from '../../map-app/src/geom/poly.ts';
import { nearestWall, orphanPortals, portalOnWall, wallChains } from '../../map-app/src/geom/walls.ts';
import { snapCenter, snapVertex, hexAt, hexCenter } from '../../map-app/src/geom/grid.ts';
import { createDoc, parseDoc } from '../../map-app/src/model/doc.ts';
import { buildDd2vtt } from '../../map-app/src/export/export.ts';

const WALL = { asset: null, color: '#000', width: 0.25 };
const floorWith = (rooms, portals = [], walls = []) => ({
  id: 'f', name: '', visible: true, layers: [], objects: [],
  rooms: rooms.map((poly, i) => ({ id: `r${i}`, poly, floor: null, wall: WALL })), portals, walls,
});

describe('наборы ассетов (tree.js)', () => {
  const files = [
    { path: 'objects/furniture/table.png', size: { w: 512, h: 256 } },
    { path: 'objects/furniture/tiny.png', size: { w: 16, h: 16 } },
    { path: 'scalable/signs/zwei/sign.svg', size: { w: 512, h: 256 } },
    { path: 'scalable/signs/zwei/emblem.svg', size: { w: 256, h: 256 } },
    { path: 'scalable/signs/hana/sign.svg', size: { w: 512, h: 256 } },
    { path: 'readme.txt', size: null },
  ];
  const metas = {
    scalable: { scalable: true, layer: 'above', name: { ru: 'Масштабируемое', en: 'Scalable' } },
    'scalable/signs/zwei': { name: 'Цвай', files: { 'emblem.svg': { footprint: [1, 1], name: { ru: 'Эмблема', en: 'Emblem' } } } },
  };
  const { tree, assets } = buildPack(files, metas);
  const by = (p) => assets.find((a) => a.path === p);

  it('размер в клетках: 256 px = клетка, маленькие картинки — 1 клетка', () => {
    expect(by('objects/furniture/table.png').footprint).toEqual([2, 1]);
    expect(by('objects/furniture/tiny.png').footprint).toEqual([1, 1]);
    expect(footprintFor({ w: 1024, h: 1024 })).toEqual([4, 4]);
    expect(footprintFor({ w: 140, h: 70 }, 70)).toEqual([2, 1]);
  });
  it('настройки папок наследуются, у файла — свои', () => {
    const e = by('scalable/signs/zwei/emblem.svg');
    expect(e.scalable).toBe(true);
    expect(e.layer).toBe('above');
    expect(e.name).toEqual({ ru: 'Эмблема', en: 'Emblem' });
    expect(by('objects/furniture/table.png').scalable).toBe(false);
    expect(assets.some((a) => a.path === 'readme.txt')).toBe(false);
  });
  it('дерево папок и цепочка разновидностей', () => {
    expect(tree.dirs.map((d) => d.path)).toEqual(['objects', 'scalable']);
    const chain = variantChain(tree, 'scalable/signs/zwei/sign.svg');
    expect(chain.map((l) => l.kind)).toEqual(['dir', 'dir', 'file']);
    expect(chain[1].options).toEqual(['scalable/signs/hana', 'scalable/signs/zwei']);
    expect(chain[2].options).toEqual(['scalable/signs/zwei/emblem.svg', 'scalable/signs/zwei/sign.svg']);
  });
  it('смена подтипа сохраняет разновидность, если она есть', () => {
    expect(switchDir(tree, assets, 'scalable/signs/zwei/sign.svg', 'scalable/signs/zwei', 'scalable/signs/hana')).toBe('scalable/signs/hana/sign.svg');
    expect(switchDir(tree, assets, 'scalable/signs/zwei/emblem.svg', 'scalable/signs/zwei', 'scalable/signs/hana')).toBe('scalable/signs/hana/sign.svg');
  });
  it('размеры SVG и PNG', () => {
    expect(svgSize('<svg xmlns="x" viewBox="0 0 512 256">')).toEqual({ w: 512, h: 256 });
    expect(svgSize('<svg width="300px" height="100" viewBox="0 0 1 1">')).toEqual({ w: 300, h: 100 });
    const png = new Uint8Array(24); png.set([0x89, 0x50, 0x4e, 0x47]); png.set([0, 0, 2, 0, 0, 0, 1, 0], 16);
    expect(pngSize(png)).toEqual({ w: 512, h: 256 });
  });
});

describe('комнаты и стены', () => {
  it('соседние прямоугольники сливаются в один контур', () => {
    const r = union(rectPoly({ x: 0, y: 0 }, { x: 4, y: 4 }), rectPoly({ x: 4, y: 1 }, { x: 8, y: 3 }));
    expect(r).toHaveLength(1);
    expect(r[0][0]).toHaveLength(8);
  });
  it('вырезание в середине даёт дыру', () => {
    const r = difference(rectPoly({ x: 0, y: 0 }, { x: 6, y: 6 }), rectPoly({ x: 2, y: 2 }, { x: 4, y: 4 }));
    expect(r).toHaveLength(1);
    expect(r[0]).toHaveLength(2);
  });
  it('стены комнаты — одна замкнутая цепочка; дверь разрезает её', () => {
    const room = rectPoly({ x: 0, y: 0 }, { x: 4, y: 4 });
    expect(wallChains(floorWith([room]))).toMatchObject([{ closed: true, capStart: false, capEnd: false }]);
    const hit = nearestWall(floorWith([room]), { x: 2, y: 0.1 }, 0.5);
    const place = portalOnWall(hit, 1, true);
    expect(place).toEqual({ a: { x: 1.5, y: 0 }, b: { x: 2.5, y: 0 } });
    const f = floorWith([room], [{ id: 'd', kind: 'door', asset: null, ...place }]);
    const chains = wallChains(f);
    expect(chains).toHaveLength(1);
    expect(chains[0].closed).toBe(false);
    expect(chains[0].pts[0]).toEqual({ x: 2.5, y: 0 });
    expect(chains[0].pts.at(-1)).toEqual({ x: 1.5, y: 0 });
    expect(chains[0].pts).toHaveLength(6);
  });
  it('торцы отдельной стены продлеваются, края проёма — нет', () => {
    const f = floorWith([], [], [{ id: 'w', points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }], closed: false, wall: WALL }]);
    expect(wallChains(f)).toMatchObject([{ closed: false, capStart: true, capEnd: true }]);
  });
  it('проём без стены считается «висящим»', () => {
    const f = floorWith([rectPoly({ x: 0, y: 0 }, { x: 4, y: 4 })], [
      { id: 'ok', kind: 'door', asset: null, a: { x: 1, y: 0 }, b: { x: 2, y: 0 } },
      { id: 'bad', kind: 'door', asset: null, a: { x: 1, y: 2 }, b: { x: 2, y: 2 } },
    ]);
    expect([...orphanPortals(f)]).toEqual(['bad']);
  });
});

describe('сетка', () => {
  it('квадратная привязка: узлы и центр объекта по чётности размера', () => {
    expect(snapVertex('square', { x: 1.4, y: 2.6 })).toEqual({ x: 1, y: 3 });
    expect(snapCenter('square', { x: 1.2, y: 1.2 }, 1, 1)).toEqual({ x: 1.5, y: 1.5 });
    expect(snapCenter('square', { x: 1.2, y: 1.2 }, 2, 1)).toEqual({ x: 1, y: 1.5 });
    expect(snapCenter('square', { x: 1.2, y: 1.2 }, 2, 1, 90)).toEqual({ x: 1.5, y: 1 });
  });
  it('гексы: центр гекса — сам себе гекс, соседи на расстоянии 1', () => {
    for (const t of ['hex-flat', 'hex-pointy']) {
      const c = hexCenter(t, { q: 2, r: -1 });
      expect(hexAt(t, c)).toEqual({ q: 2, r: -1 });
      const n = hexCenter(t, { q: 3, r: -1 });
      expect(Math.hypot(n.x - c.x, n.y - c.y)).toBeCloseTo(1);
    }
  });
});

describe('документ и экспорт', () => {
  it('parseDoc принимает свой документ и отвергает чужой', () => {
    const d = createDoc({ name: 'X', width: 10, height: 8, grid: 'square', floorName: 'F1' });
    expect(parseDoc(JSON.parse(JSON.stringify(d))).floors[0].layers).toHaveLength(3);
    expect(() => parseDoc({ format: 'other' })).toThrow();
  });
  it('.dd2vtt: размер в клетках, стены ломаными, двери порталами, окна по настройке', () => {
    const d = createDoc({ name: 'X', width: 10, height: 8, grid: 'square', floorName: 'F1' });
    const f = floorWith([rectPoly({ x: 1, y: 1 }, { x: 5, y: 5 })], [
      { id: 'd', kind: 'door', asset: null, a: { x: 2, y: 1 }, b: { x: 3, y: 1 } },
      { id: 'w', kind: 'window', asset: null, a: { x: 1, y: 2 }, b: { x: 1, y: 3 } },
    ]);
    const gap = buildDd2vtt(d, f, 70, 'IMG', 'gap');
    expect(gap.resolution).toEqual({ map_origin: { x: 0, y: 0 }, map_size: { x: 10, y: 8 }, pixels_per_grid: 70 });
    expect(gap.portals).toHaveLength(1);
    expect(gap.portals[0]).toMatchObject({ position: { x: 2.5, y: 1 }, closed: true });
    expect(gap.line_of_sight).toHaveLength(2);
    expect(buildDd2vtt(d, f, 70, 'IMG', 'wall').line_of_sight).toHaveLength(1);
    expect(buildDd2vtt(d, f, 70, 'IMG', 'door').portals).toHaveLength(2);
  });
});
