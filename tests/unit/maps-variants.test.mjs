// Варианты бесшовных текстур (случайные плитки пола и стен), вставки в стену, верхняя линия над гранью.
import { describe, it, expect } from 'vitest';
import { rectPoly } from '../../map-app/src/geom/poly.ts';
import { DEFAULT_VARY, effectiveChance, pickTile, tileHash, wallLine } from '../../map-app/src/geom/variants.ts';
import { PORTAL_MIN_VISIBLE, faceItems, insertOnWall, nearestWall, portalFaceVisibility, slidePortal, wallAt, wallChains, wallFaces, wallLineLift } from '../../map-app/src/geom/walls.ts';
import { blockingSegments } from '../../map-app/src/geom/light.ts';
import { buildDd2vtt } from '../../map-app/src/export/export.ts';
import { createDoc, parseDoc } from '../../map-app/src/model/doc.ts';

const wall3d = (inner, outer, height = 1, extra = {}) => ({ asset: 'canon:walls/concrete.svg', color: '#000', width: 0.2, height, inner, outer, ...extra });
const floor = (rooms, portals = []) => ({
  id: 'f', name: '', visible: true, layers: [], objects: [], ground: null, terrain: [], paths: [], lights: [], labels: [], roofs: [], levels: [], image: null,
  rooms, portals, walls: [],
});
const room = (id, a, b, wall) => ({ id, poly: rectPoly(a, b), floor: null, wall });

describe('случайные варианты', () => {
  it('выбор детерминирован, шанс 0 — всегда основа, без вариантов — основа', () => {
    expect(pickTile(['a', 'b'], 0.3, 7, 3, 4)).toBe(pickTile(['a', 'b'], 0.3, 7, 3, 4));
    for (let i = 0; i < 50; i++) expect(pickTile(['a'], 0, 1, i, i)).toBeNull();
    expect(pickTile([], 1, 1, 0, 0)).toBeNull();
    expect(pickTile(['a'], 1, 1, 0, 0)).toBe('a');
  });
  it('доля вариантов близка к шансу, все варианты встречаются, зерно меняет раскладку', () => {
    let n = 0; const seen = new Set();
    for (let j = 0; j < 100; j++) for (let i = 0; i < 100; i++) { const v = pickTile(['a', 'b', 'c'], DEFAULT_VARY, 0, i, j); if (v) { n++; seen.add(v); } }
    expect(n / 10000).toBeGreaterThan(0.1); expect(n / 10000).toBeLessThan(0.14);
    expect(seen.size).toBe(3);
    let diff = 0;
    for (let i = 0; i < 200; i++) if ((tileHash(1, i, 0) < 0.5) !== (tileHash(2, i, 0) < 0.5)) diff++;
    expect(diff).toBeGreaterThan(50);
  });
  it('шанс по умолчанию — 12 %, ограничен 0…1', () => {
    expect(effectiveChance(undefined)).toBe(0.12);
    expect(effectiveChance(2)).toBe(1); expect(effectiveChance(-1)).toBe(0); expect(effectiveChance(0)).toBe(0);
  });
  it('раскладка стены не зависит от направления рисования', () => {
    const a = wallLine({ x: 0, y: 2 }, { x: 5, y: 2 }), b = wallLine({ x: 5, y: 2 }, { x: 0, y: 2 });
    expect(b.u).toEqual(a.u); expect(b.salt).toBe(a.salt);
    expect(wallLine({ x: 0, y: 3 }, { x: 5, y: 3 }).salt).not.toBe(a.salt);
  });
  it('шанс и зерно сохраняются в файле карты', () => {
    const d = createDoc({ name: 'X', width: 6, height: 6, grid: 'square', floorName: 'F' });
    d.floors[0].rooms.push({ ...room('r', { x: 0, y: 0 }, { x: 2, y: 2 }, wall3d('down', 'down', 1, { vary: 0.3, varySeed: 5 })), floorVary: 0.2, floorSeed: 9 });
    d.floors[0].portals.push({ id: 'i', kind: 'insert', a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, asset: 'canon:walls/concrete.svg' });
    const r = parseDoc(JSON.parse(JSON.stringify(d)));
    const f = r.floors[0];
    expect(f.rooms[0]).toMatchObject({ floorVary: 0.2, floorSeed: 9, wall: { vary: 0.3, varySeed: 5 } });
    expect(f.portals[0].kind).toBe('insert');
  });
});

describe('вставка в стену', () => {
  it('край — на границе плитки текстуры, внутри отрезка', () => {
    const f = floor([room('r', { x: 0.5, y: 0 }, { x: 6.5, y: 3 }, wall3d('down', 'down'))]);
    const hit = nearestWall(f, { x: 3.3, y: 0.1 }, 1);
    const r = insertOnWall(hit, 1, 1);
    const xs = [r.a.x, r.b.x].sort((p, q) => p - q);
    expect(xs[0]).toBeCloseTo(Math.round(xs[0])); expect(xs[1] - xs[0]).toBeCloseTo(1);
    expect(r.a.y).toBeCloseTo(0);
    // у края стены — внутрь отрезка целыми плитками
    const edge = insertOnWall(nearestWall(f, { x: 0.6, y: 0 }, 1), 1, 1);
    expect(Math.min(edge.a.x, edge.b.x)).toBeGreaterThanOrEqual(0.5 - 1e-6);
  });
  it('щелчок по грани находит её стену (а не ближайшую по основанию)', () => {
    const f = floor([room('r', { x: 0, y: 0 }, { x: 6, y: 3 }, wall3d('down', 'down'))]);
    // северная грань — над комнатой (y −1…0), южная — на полу комнаты (y 2…3)
    expect(wallAt(f, { x: 2, y: -0.8 }, 0.5).q.y).toBeCloseTo(0);
    expect(wallAt(f, { x: 2, y: 2.1 }, 0.5).q.y).toBeCloseTo(3);
    expect(wallAt(f, { x: 2, y: 1.5 }, 0.5)).toBeNull();
  });
  it('на косой стене вставка рисуется после своей грани (грань не закрывает её)', () => {
    const poly = [[{ x: 4, y: 2 }, { x: 10, y: 2 }, { x: 13, y: 6 }, { x: 10, y: 10 }, { x: 4, y: 10 }, { x: 1, y: 6 }]];
    const f0 = floor([{ id: 'r', poly, floor: null, wall: wall3d('down', 'down') }]);
    const pl = insertOnWall(wallAt(f0, { x: 1.71, y: 6.45 }, 0.75), 1, 1);
    const f = { ...f0, portals: [{ id: 'i', kind: 'insert', ...pl, asset: 'x' }] };
    const items = faceItems(f), i = items.findIndex((it) => it.portal);
    const host = items.findIndex((it) => !it.portal && it.face.pts.some((q) => q.x === 4 && q.y === 10) && it.face.pts.some((q) => q.x === 1 && q.y === 6));
    expect(i).toBeGreaterThan(host);
  });
  it('перетаскивание вставки держит сетку плиток', () => {
    const f = floor([room('r', { x: 0, y: 0 }, { x: 6, y: 3 }, wall3d('down', 'down'))]);
    const p = { id: 'i', kind: 'insert', a: { x: 1, y: 0 }, b: { x: 2, y: 0 }, asset: 'x' };
    const r = slidePortal(f, p, { x: 3.4, y: 0 }, true, 1, () => 1);
    expect(Math.min(r.a.x, r.b.x)).toBeCloseTo(3);
  });
  it('остаётся стеной: не режет стену, свет не проходит, в .dd2vtt нет портала', () => {
    const ins = { id: 'i', kind: 'insert', a: { x: 1, y: 0 }, b: { x: 2, y: 0 }, asset: 'canon:walls/concrete.svg' };
    const f = floor([room('r', { x: 0, y: 0 }, { x: 4, y: 3 }, wall3d('down', 'down'))], [ins]);
    expect(wallFaces(f).length).toBe(2); // северная и южная целиком
    expect(faceItems(f).filter((it) => it.portal?.kind === 'insert')).toHaveLength(1);
    expect(wallChains(f)).toEqual(wallChains({ ...f, portals: [] }));
    expect(blockingSegments(f).some(([a, b]) => a.y === 0 && b.y === 0 && Math.min(a.x, b.x) <= 1.5 && Math.max(a.x, b.x) >= 1.5)).toBe(true);
    const d = createDoc({ name: 'X', width: 6, height: 6, grid: 'square', floorName: 'F' });
    expect(buildDd2vtt(d, f, 70, '', 'gap').portals).toEqual([]);
  });
});

describe('верхняя линия объёмной стены', () => {
  it('лежит над гранью (сдвинута на полтолщины), а не на её верхнем крае', () => {
    expect(wallLineLift(wall3d('down', 'down', 1))).toEqual({ x: 0, y: -1.1 });
    expect(wallLineLift(wall3d('up', 'none', 0.5))).toEqual({ x: 0, y: 0.6 });
    expect(wallLineLift(wall3d('normal', 'none', 0.5))).toEqual({ x: 0, y: 0 });
    expect(wallLineLift({ asset: null, color: '#000', width: 0.25 })).toEqual({ x: 0, y: 0 });
  });
});

describe('видимость проёма на грани', () => {
  const door = (a, b) => ({ id: 'd', kind: 'door', a, b, asset: 'x' });
  it('стена поперёк взгляда — видно целиком, почти ребром — меньше порога', () => {
    const r = floor([room('r', { x: 0, y: 0 }, { x: 6, y: 4 }, wall3d('down', 'down'))]);
    expect(portalFaceVisibility({ ...r, portals: [door({ x: 1, y: 0 }, { x: 2, y: 0 })] }, door({ x: 1, y: 0 }, { x: 2, y: 0 }))).toBeCloseTo(1);
    // крутая стена: почти вертикальная, грань узкая
    const poly = [[{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4.5, y: 6 }, { x: 0, y: 6 }]];
    const f = floor([{ id: 'r', poly, floor: null, wall: wall3d('down', 'down') }]);
    const t = (k) => ({ x: 4 + 0.5 * k, y: 6 * k });
    const p = door(t(0.4), t(0.55));
    const vis = portalFaceVisibility({ ...f, portals: [p] }, p);
    expect(vis).toBeGreaterThan(0); expect(vis).toBeLessThan(PORTAL_MIN_VISIBLE);
  });
});
