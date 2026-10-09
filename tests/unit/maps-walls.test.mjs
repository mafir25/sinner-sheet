// Объёмные стены (грани в выбранных направлениях) и проёмы без стены.
import { describe, it, expect } from 'vitest';
import { rectPoly } from '../../map-app/src/geom/poly.ts';
import { wallChains, wallFaces, orphanPortals, portalFaces, portalShape } from '../../map-app/src/geom/walls.ts';
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
  it('двери и окна вырезают стену вместе с гранью; их грань — отдельно, по форме стены', () => {
    const w = wall3d('down', 'none');
    for (const kind of ['door', 'window']) {
      const p = { id: 'd', kind, a: { x: 1, y: 0 }, b: { x: 2, y: 0 }, asset: 'canon:portals/doors/wood.svg' };
      const f = floor([room('r', { x: 0, y: 0 }, { x: 4, y: 3 }, w)], [p]);
      expect(wallFaces(f).map(box).sort()).toEqual([[0, 0, 1, 1], [2, 0, 4, 1]]);
      expect(portalFaces(f, p).map(box)).toEqual([[1, 0, 2, 1]]);
    }
    // на плоской стене граней проёма нет — рисуется как раньше
    const flat = floor([room('r', { x: 0, y: 0 }, { x: 4, y: 3 }, { asset: null, color: '#000', width: 0.25 })]);
    expect(portalFaces(flat, { id: 'd', kind: 'door', a: { x: 1, y: 0 }, b: { x: 2, y: 0 }, asset: null })).toEqual([]);
  });
  it('форма проёма: умолчания двери и окна, границы', () => {
    expect(portalShape({ kind: 'door' })).toEqual({ top: 0.15, bottom: 0, arch: false });
    expect(portalShape({ kind: 'window' })).toEqual({ top: 0.3, bottom: 0.3, arch: false });
    const s = portalShape({ kind: 'door', top: 0.8, bottom: 0.5, arch: true });
    expect(s.top).toBe(0.8); expect(s.bottom).toBeCloseTo(0.1); expect(s.arch).toBe(true);
  });
  it('пустой проём (без картинки) — арка: свет проходит, в .dd2vtt нет портала', () => {
    const w = wall3d('down', 'down');
    const arch = { id: 'a', kind: 'door', a: { x: 1, y: 0 }, b: { x: 3, y: 0 }, asset: null, arch: true };
    const closed = { id: 'c', kind: 'door', a: { x: 0, y: 1 }, b: { x: 0, y: 2 }, asset: 'canon:portals/doors/wood.svg' };
    const f = floor([room('r', { x: 0, y: 0 }, { x: 4, y: 3 }, w)], [arch, closed]);
    const segs = blockingSegments(f);
    expect(segs.some(([a, b]) => a.y === 0 && b.y === 0 && Math.min(a.x, b.x) < 2 && Math.max(a.x, b.x) > 2)).toBe(false);
    expect(segs.some(([a, b]) => a.x === 0 && b.x === 0 && Math.min(a.y, b.y) <= 1.5 && Math.max(a.y, b.y) >= 1.5)).toBe(true);
    const d = createDoc({ name: 'X', width: 6, height: 6, grid: 'square', floorName: 'F' });
    expect(buildDd2vtt(d, f, 70, '', 'gap').portals).toHaveLength(1);
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

describe('доработки стен', () => {
  const w = (inner, outer, height = 1) => ({ asset: null, color: '#000', width: 0.1, height, inner, outer });
  it('«по периметру»: на углах стык по биссектрисе — грани смыкаются без зазоров и наложений', () => {
    const f = floor([room('r', { x: 0, y: 0 }, { x: 4, y: 3 }, w('normal', 'normal', 0.5))]);
    const faces = wallFaces(f);
    const inner = faces.filter((x) => x.side === 'in'), outer = faces.filter((x) => x.side === 'out');
    expect(inner).toHaveLength(4);
    expect(outer).toHaveLength(4);
    // северная стена внутри: трапеция (0,0)-(4,0)-(3.5,0.5)-(0.5,0.5)
    const north = inner.find((x) => x.pts[0].y === 0 && x.pts[1].y === 0);
    const r = (p) => [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000];
    expect(north.pts.map(r).sort()).toEqual([[0, 0], [4, 0], [3.5, 0.5], [0.5, 0.5]].sort());
    // соседние грани делят ребро стыка: дальняя точка у угла — общая
    for (const face of inner) {
      const corner = face.pts[3];
      expect(inner.some((g) => g !== face && Math.hypot(g.pts[2].x - corner.x, g.pts[2].y - corner.y) < 1e-9)).toBe(true);
    }
    // снаружи — наружу
    expect(outer.find((x) => x.pts[0].y === 0 && x.pts[1].y === 0).pts.map(r).sort()).toEqual([[0, 0], [4, 0], [4.5, -0.5], [-0.5, -0.5]].sort());
  });
  it('у грани есть сторона и комната (для обрезки по контуру)', () => {
    const rm = room('r', { x: 0, y: 0 }, { x: 4, y: 3 }, w('down', 'down'));
    const faces = wallFaces(floor([rm]));
    expect(faces.map((x) => x.side).sort()).toEqual(['in', 'out']);
    expect(faces.every((x) => x.room === rm)).toBe(true);
  });
  it('разные направления внутри и снаружи работают вместе', () => {
    const faces = wallFaces(floor([room('r', { x: 0, y: 0 }, { x: 4, y: 3 }, w('up', 'normal', 0.5))]));
    expect(faces.filter((x) => x.side === 'in').map(box)).toEqual([[0, 2.5, 4, 3]]);
    expect(faces.filter((x) => x.side === 'out')).toHaveLength(4);
  });
  it('отдельная стена: внутри — слева по ходу рисования, снаружи — справа', () => {
    const wall = { id: 'w', points: [{ x: 0, y: 2 }, { x: 4, y: 2 }], closed: false, wall: w('normal', 'none', 0.5) };
    const faces = wallFaces(floor([], [], [wall]));
    expect(faces.map(box)).toEqual([[0, 2, 4, 2.5]]);
  });
  it('своя настройка у отдельной стены комнаты', () => {
    const rm = room('r', { x: 0, y: 0 }, { x: 4, y: 3 }, w('down', 'none'));
    rm.edgeStyles = [{ a: { x: 4, y: 0 }, b: { x: 0, y: 0 }, style: { height: 0, asset: 'canon:walls/brick.svg' } }];
    const f = floor([rm]);
    expect(wallFaces(f)).toEqual([]); // у северной стены грани больше нет
    const chains = wallChains(f);
    expect(chains).toHaveLength(2);
    expect(chains.find((c) => c.style.asset === 'canon:walls/brick.svg').pts).toHaveLength(2);
  });
  it('верхняя линия стены не прерывается над дверью и аркой, проём без стены — режет', () => {
    const door = { id: 'd', kind: 'door', a: { x: 1, y: 0 }, b: { x: 2, y: 0 }, asset: 'x' };
    const arch = { id: 'a', kind: 'door', a: { x: 1, y: 3 }, b: { x: 2, y: 3 }, asset: null };
    const gap = { id: 'g', kind: 'gap', a: { x: 4, y: 1 }, b: { x: 4, y: 2 }, asset: null };
    const f = floor([room('r', { x: 0, y: 0 }, { x: 4, y: 3 }, w('down', 'down'))], [door, arch, gap]);
    expect(wallChains(f, new Set(), false)).toHaveLength(1);
    expect(wallChains(f)).toHaveLength(3);
  });
});
