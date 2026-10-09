// Объёмные стены (грани в выбранных направлениях) и проёмы без стены.
import { describe, it, expect } from 'vitest';
import { rectPoly } from '../../map-app/src/geom/poly.ts';
import { wallChains, wallFaces, orphanPortals } from '../../map-app/src/geom/walls.ts';
import { blockingSegments } from '../../map-app/src/geom/light.ts';
import { buildDd2vtt } from '../../map-app/src/export/export.ts';
import { createDoc, parseDoc } from '../../map-app/src/model/doc.ts';

const wall3d = (inner, outer, height = 1) => ({ asset: null, color: '#000', width: 0.1, height, inner, outer });
const floor = (rooms, portals = [], walls = []) => ({
  id: 'f', name: '', visible: true, layers: [], objects: [], ground: null, terrain: [], paths: [], lights: [], labels: [], roofs: [], image: null,
  rooms, portals, walls,
});
const room = (id, a, b, wall) => ({ id, poly: rectPoly(a, b), floor: null, wall });
const box = (face) => {
  const xs = face.pts.map((p) => p.x), ys = face.pts.map((p) => p.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => Math.round(v * 1000) / 1000);
};

describe('грани объёмных стен', () => {
  it('«вниз» внутри — только северная стена, грань в комнату; «вниз» снаружи — южная, наружу', () => {
    const f = floor([room('r', { x: 0, y: 0 }, { x: 4, y: 3 }, wall3d('down', 'down'))]);
    const faces = wallFaces(f).map(box).sort();
    expect(faces).toEqual([[0, 0, 4, 1], [0, 3, 4, 4]].sort());
  });
  it('«по периметру» внутри — у всех стен, к центру', () => {
    const faces = wallFaces(floor([room('r', { x: 0, y: 0 }, { x: 4, y: 3 }, wall3d('normal', 'none', 0.5))])).map(box).sort();
    expect(faces).toEqual([[0, 0, 4, 0.5], [0, 2.5, 4, 3], [0, 0, 0.5, 3], [3.5, 0, 4, 3]].sort());
  });
  it('«вверх» и «нет»; высота 0 — плоская стена без граней', () => {
    expect(wallFaces(floor([room('r', { x: 0, y: 0 }, { x: 4, y: 3 }, wall3d('up', 'none'))])).map(box)).toEqual([[0, 2, 4, 3]]);
    expect(wallFaces(floor([room('r', { x: 0, y: 0 }, { x: 4, y: 3 }, wall3d('none', 'none'))]))).toEqual([]);
    expect(wallFaces(floor([room('r', { x: 0, y: 0 }, { x: 4, y: 3 }, { asset: null, color: '#000', width: 0.25 })]))).toEqual([]);
  });
  it('за стеной соседняя комната — грань рисует только она (как внутреннюю), без двойной', () => {
    const w = wall3d('down', 'down');
    const f = floor([room('a', { x: 0, y: 0 }, { x: 4, y: 3 }, w), room('b', { x: 0, y: 3 }, { x: 4, y: 6 }, w)]);
    const faces = wallFaces(f).map(box).sort();
    // северная стена A внутрь, общая стена — внутрь B, южная стена B — наружу
    expect(faces).toEqual([[0, 0, 4, 1], [0, 3, 4, 4], [0, 6, 4, 7]].sort());
  });
  it('в дверном проёме грани нет, окно грань не прерывает', () => {
    const w = wall3d('down', 'none');
    const door = { id: 'd', kind: 'door', a: { x: 1, y: 0 }, b: { x: 2, y: 0 }, asset: null };
    expect(wallFaces(floor([room('r', { x: 0, y: 0 }, { x: 4, y: 3 }, w)], [door])).map(box).sort()).toEqual([[0, 0, 1, 1], [2, 0, 4, 1]]);
    const win = { ...door, kind: 'window' };
    expect(wallFaces(floor([room('r', { x: 0, y: 0 }, { x: 4, y: 3 }, w)], [win])).map(box)).toEqual([[0, 0, 4, 1]]);
  });
});

describe('проём без стены', () => {
  const w = wall3d('down', 'down');
  const gap = { id: 'g', kind: 'gap', a: { x: 0, y: 3 }, b: { x: 4, y: 3 }, asset: null };
  const f = floor([room('r', { x: 0, y: 0 }, { x: 4, y: 3 }, w)], [gap]);
  it('убирает стену: ни линии, ни грани, ни тени для света', () => {
    const lens = wallChains(f).map((c) => c.pts.length);
    expect(lens).toEqual([4]); // остались три стены одной ломаной
    expect(wallFaces(f).map(box)).toEqual([[0, 0, 4, 1]]);
    expect(blockingSegments(f).some(([a, b]) => a.y === 3 && b.y === 3)).toBe(false);
    expect(orphanPortals(f).size).toBe(0);
  });
  it('в .dd2vtt нет ни стены, ни портала', () => {
    const d = createDoc({ name: 'X', width: 6, height: 6, grid: 'square', floorName: 'F' });
    for (const mode of ['gap', 'wall', 'door']) {
      const v = buildDd2vtt(d, f, 70, '', mode);
      expect(v.portals).toEqual([]);
      expect(v.line_of_sight.flat().some((p) => p.y === 3 && p.x > 0 && p.x < 4)).toBe(false);
    }
  });
  it('файл: проём без стены и параметры граней сохраняются, старые стены остаются плоскими', () => {
    const d = createDoc({ name: 'X', width: 6, height: 6, grid: 'square', floorName: 'F' });
    const raw = JSON.parse(JSON.stringify(d));
    raw.floors[0].rooms = [room('r', { x: 0, y: 0 }, { x: 4, y: 3 }, w), room('o', { x: 0, y: 3 }, { x: 2, y: 5 }, { asset: null, color: '#000', width: 0.25 })];
    raw.floors[0].portals = [gap];
    const p = parseDoc(raw);
    expect(p.floors[0].rooms[0].wall).toMatchObject({ height: 1, inner: 'down', outer: 'down' });
    expect(p.floors[0].rooms[1].wall.height).toBeUndefined();
    expect(p.floors[0].portals[0].kind).toBe('gap');
  });
});
