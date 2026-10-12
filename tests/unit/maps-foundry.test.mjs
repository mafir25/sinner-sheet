// Возможности Foundry: тайные двери, состояния дверей, окна и типы стен в VTT, конусы света, сцена Foundry.
import { describe, it, expect } from 'vitest';
import { rectPoly } from '../../map-app/src/geom/poly.ts';
import { faceItems, wallChains } from '../../map-app/src/geom/walls.ts';
import { blockingSegments } from '../../map-app/src/geom/light.ts';
import { buildDd2vtt, buildFoundryScene } from '../../map-app/src/export/export.ts';
import { createDoc, parseDoc } from '../../map-app/src/model/doc.ts';

const WALL = { asset: null, color: '#000', width: 0.1, height: 1, inner: 'down', outer: 'down' };
const floor = (portals = [], wall = WALL, lights = []) => ({
  id: 'f', name: '', visible: true, layers: [], objects: [], ground: null, terrain: [], paths: [], lights, labels: [], roofs: [], levels: [], image: null,
  rooms: [{ id: 'r', poly: rectPoly({ x: 0, y: 0 }, { x: 4, y: 3 }), floor: null, wall }], portals, walls: [],
});
const door = (extra = {}) => ({ id: 'd', kind: 'door', a: { x: 1, y: 0 }, b: { x: 2, y: 0 }, asset: 'canon:portals/doors/wood.svg', ...extra });
const doc = () => createDoc({ name: 'Тест', width: 6, height: 5, grid: 'square', floorName: '1' });
// длина отрезков, задерживающих свет, на верхней стене (y = 0)
const topBlocked = (f) => blockingSegments(f).filter(([a, b]) => a.y === 0 && b.y === 0).reduce((s, [a, b]) => s + Math.abs(b.x - a.x), 0);

describe('тайные двери', () => {
  it('на карте — сплошная стена: не режет стену и грань, свет не проходит', () => {
    const f = floor([door({ secret: true })]);
    expect(wallChains(f)).toHaveLength(1);
    expect(wallChains(f)[0].closed).toBe(true);
    expect(faceItems(f).some((it) => it.portal)).toBe(false);
    expect(topBlocked(f)).toBe(4);
  });
  it('в .dd2vtt — стена без портала', () => {
    const v = buildDd2vtt(doc(), floor([door({ secret: true })]), 70, '', 'gap');
    expect(v.portals).toEqual([]);
    expect(v.line_of_sight).toHaveLength(1);
  });
  it('в Foundry — секретная дверь (door: 2) на месте проёма, стена вокруг разрезана', () => {
    const s = buildFoundryScene(doc(), floor([door({ secret: true })]), 100, 'map.webp', 'gap');
    const doors = s.walls.filter((w) => w.door);
    expect(doors).toHaveLength(1);
    expect(doors[0]).toMatchObject({ c: [100, 0, 200, 0], door: 2, ds: 0, move: 20, sight: 20 });
    // верхняя стена: 0–1 и 2–4 обычными стенами
    expect(s.walls.filter((w) => !w.door && w.c[1] === 0 && w.c[3] === 0).map((w) => Math.abs(w.c[2] - w.c[0])).sort()).toEqual([100, 200]);
  });
  it('сохраняется в файле', () => {
    const d = doc();
    d.floors[0] = floor([door({ secret: true, state: 'locked' })]);
    const back = parseDoc(JSON.parse(JSON.stringify(d)));
    expect(back.floors[0].portals[0]).toMatchObject({ secret: true, state: 'locked' });
  });
});

describe('состояние двери', () => {
  it('открытая дверь пропускает свет, закрытая и запертая — нет', () => {
    expect(topBlocked(floor([door()]))).toBe(4);
    expect(topBlocked(floor([door({ state: 'locked' })]))).toBe(4);
    expect(topBlocked(floor([door({ state: 'open' })]))).toBe(3);
  });
  it('в .dd2vtt открытая — closed: false; в Foundry ds: 0 / 1 / 2', () => {
    expect(buildDd2vtt(doc(), floor([door({ state: 'open' })]), 70, '', 'gap').portals[0].closed).toBe(false);
    for (const [state, ds] of [[undefined, 0], ['open', 1], ['locked', 2]]) {
      const s = buildFoundryScene(doc(), floor([door({ state })]), 70, 'm.webp', 'gap');
      expect(s.walls.find((w) => w.door).ds).toBe(ds);
    }
  });
});

describe('окна и стены в VTT', () => {
  const win = (vtt) => ({ id: 'w', kind: 'window', a: { x: 1, y: 3 }, b: { x: 3, y: 3 }, asset: 'canon:portals/windows/glass.svg', ...(vtt ? { vtt } : {}) });
  it('своё окно важнее настройки экспорта', () => {
    expect(buildDd2vtt(doc(), floor([win('door')]), 70, '', 'gap').portals).toHaveLength(1);
    expect(buildDd2vtt(doc(), floor([win()]), 70, '', 'door').portals).toHaveLength(1);
    expect(buildDd2vtt(doc(), floor([win('wall')]), 70, '', 'gap').line_of_sight).toHaveLength(1);
    const s = (w, mode) => buildFoundryScene(doc(), floor([w]), 70, 'm.webp', mode).walls.find((x) => x.c[1] === 210 && x.c[3] === 210 && Math.abs(x.c[2] - x.c[0]) === 140);
    expect(s(win(), 'gap')).toMatchObject({ move: 20, sight: 0, light: 0, door: 0 });
    expect(s(win('wall'), 'gap')).toMatchObject({ move: 20, sight: 20, door: 0 });
    expect(s(win('door'), 'gap')).toMatchObject({ door: 1 });
  });
  it('прозрачная стена: свет проходит, в .dd2vtt её нет, в Foundry — не пройти, но видно', () => {
    const f = floor([], { ...WALL, vtt: 'clear' });
    expect(blockingSegments(f)).toEqual([]);
    expect(buildDd2vtt(doc(), f, 70, '', 'gap').line_of_sight).toEqual([]);
    const s = buildFoundryScene(doc(), f, 70, 'm.webp', 'gap');
    expect(s.walls).toHaveLength(4);
    expect(s.walls[0]).toMatchObject({ move: 20, sight: 0, light: 0 });
  });
  it('эфирная и ограничивающая обзор стены', () => {
    expect(buildFoundryScene(doc(), floor([], { ...WALL, vtt: 'ethereal' }), 70, 'm', 'gap').walls[0]).toMatchObject({ move: 0, sight: 20 });
    expect(buildFoundryScene(doc(), floor([], { ...WALL, vtt: 'terrain' }), 70, 'm', 'gap').walls[0]).toMatchObject({ move: 20, sight: 10, light: 10 });
  });
  it('низкая стена и пустой проём в Foundry не попадают', () => {
    expect(buildFoundryScene(doc(), floor([], { ...WALL, low: true }), 70, 'm', 'gap').walls).toEqual([]);
    const s = buildFoundryScene(doc(), floor([door({ asset: null })]), 100, 'm', 'gap');
    expect(s.walls.some((w) => w.door)).toBe(false);
    expect(s.walls.filter((w) => w.c[1] === 0 && w.c[3] === 0).map((w) => Math.abs(w.c[2] - w.c[0])).sort()).toEqual([100, 200]);
  });
});

describe('сцена Foundry', () => {
  it('размер, сетка, фон, темнота', () => {
    const d = doc();
    d.lighting = { ...d.lighting, enabled: true, darkness: 0.6 };
    const s = buildFoundryScene(d, floor(), 140, 'map.webp', 'gap', false);
    expect(s).toMatchObject({ width: 840, height: 700, padding: 0, background: { src: 'map.webp' }, grid: { type: 1, size: 140, distance: 5, units: 'ft' } });
    expect(s.environment.darknessLevel).toBe(0.6);
    expect(s.environment.globalLight.enabled).toBe(false);
    // свет запечён — своей темноты у Foundry нет
    const baked = buildFoundryScene(d, floor(), 140, 'map.webp', 'gap', true);
    expect(baked.environment.darknessLevel).toBe(0);
    expect(baked.environment.globalLight.enabled).toBe(true);
  });
  it('свет: тусклый и яркий радиус в футах, конус, направление, анимация, тени', () => {
    const l = { id: 'l', x: 2, y: 1.5, radius: 6, color: '#ffcc88', intensity: 1, shadows: false, angle: 90, rot: 270, bright: 0.25, anim: 'torch' };
    const s = buildFoundryScene(doc(), floor([], WALL, [l]), 100, 'm', 'gap');
    expect(s.lights[0]).toMatchObject({ x: 200, y: 150, rotation: 270, walls: false });
    expect(s.lights[0].config).toMatchObject({ dim: 30, bright: 7.5, angle: 90, color: '#ffcc88', animation: { type: 'torch' } });
    const plain = buildFoundryScene(doc(), floor([], WALL, [{ ...l, angle: undefined, rot: undefined, bright: undefined, anim: undefined }]), 100, 'm', 'gap');
    expect(plain.lights[0].config).toMatchObject({ angle: 360, bright: 15, animation: { type: null } });
  });
  it('конус света сохраняется в файле', () => {
    const d = doc();
    d.floors[0] = floor([], WALL, [{ id: 'l', x: 1, y: 1, radius: 4, color: '#fff', intensity: 1, shadows: true, angle: 60, rot: 90, anim: 'pulse' }]);
    expect(parseDoc(JSON.parse(JSON.stringify(d))).floors[0].lights[0]).toMatchObject({ angle: 60, rot: 90, anim: 'pulse' });
  });
});
