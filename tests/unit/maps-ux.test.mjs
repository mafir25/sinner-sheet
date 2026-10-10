import { describe, it, expect } from 'vitest';
import { createDoc } from '../../map-app/src/model/doc.ts';
import { gridShift, resizeDoc } from '../../map-app/src/geom/ops.ts';
import { hexAt, hexCenter } from '../../map-app/src/geom/grid.ts';

const withContent = (grid = 'square') => {
  const doc = createDoc({ name: 't', width: 10, height: 8, grid, floorName: 'f' });
  const f = doc.floors[0];
  f.rooms.push({ id: 'r', poly: [[{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 3 }, { x: 1, y: 3 }]], floor: null, wall: { asset: null, color: '#000', width: 0.1 },
    edgeStyles: [{ a: { x: 1, y: 1 }, b: { x: 3, y: 1 }, style: { width: 0.3 } }] });
  f.objects.push({ id: 'o', asset: 'canon:x.svg', layer: f.layers[0].id, x: 2, y: 2, w: 1, h: 1, rot: 0, flipX: false, flipY: false, opacity: 1 });
  f.terrain.push({ id: 't', asset: null, size: 1, softness: 0, opacity: 1, points: [{ x: 5, y: 5 }] });
  f.image = { asset: 'canon:a.png', x: 0, y: 0, ppc: 70, opacity: 1 };
  return doc;
};

describe('размер карты с якорем (geom/ops.ts)', () => {
  it('якорь слева сверху — содержимое на месте', () => {
    const d = resizeDoc(withContent(), 14, 8, { col: 0, row: 0 });
    expect(d.width).toBe(14);
    expect(d.floors[0].objects[0].x).toBe(2);
  });
  it('якорь справа снизу — всё сдвигается на добавленное поле, включая кисти, картинку и стили стен', () => {
    const d = resizeDoc(withContent(), 14, 10, { col: 2, row: 2 });
    const f = d.floors[0];
    expect(f.objects[0]).toMatchObject({ x: 6, y: 4 });
    expect(f.rooms[0].poly[0][0]).toEqual({ x: 5, y: 3 });
    expect(f.rooms[0].edgeStyles[0].b).toEqual({ x: 7, y: 3 });
    expect(f.terrain[0].points[0]).toEqual({ x: 9, y: 7 });
    expect(f.image).toMatchObject({ x: 4, y: 2 });
  });
  it('центр — половина поля с каждой стороны; уменьшение срезает с двух сторон', () => {
    expect(resizeDoc(withContent(), 15, 8, { col: 1, row: 1 }).floors[0].objects[0].x).toBe(4);
    expect(resizeDoc(withContent(), 6, 8, { col: 1, row: 1 }).floors[0].objects[0].x).toBe(0);
  });
  it('на гексах сдвиг попадает в центр гекса — сетка не ломается', () => {
    for (const type of ['hex-flat', 'hex-pointy']) {
      const s = gridShift(type, { x: 3, y: 2 });
      const back = hexCenter(type, hexAt(type, s));
      expect(back.x).toBeCloseTo(s.x);
      expect(back.y).toBeCloseTo(s.y);
    }
  });
});

import { gridSteps, pathSteps, polyLen, fmtLen } from '../../map-app/src/geom/measure.ts';
import { hexCenter as hc } from '../../map-app/src/geom/grid.ts';
describe('измерения (geom/measure.ts)', () => {
  it('длина ломаной и подпись в клетках и футах', () => {
    expect(polyLen([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 6 }])).toBe(7);
    expect(fmtLen(4.5, 'кл', 'фт')).toBe('4.5 кл · 22.5 фт');
  });
  it('шаги по квадратной сетке: диагональ = одна клетка', () => {
    expect(gridSteps('square', { x: 0.5, y: 0.5 }, { x: 4.5, y: 2.5 })).toBe(4);
    expect(pathSteps('square', [{ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 2, y: 5 }])).toBe(5);
    expect(gridSteps('none', { x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull();
  });
  it('шаги по гексам — число гексов', () => {
    const a = hc('hex-flat', { q: 0, r: 0 }), b = hc('hex-flat', { q: 3, r: -1 });
    expect(gridSteps('hex-flat', a, b)).toBe(3);
  });
});
import { polyArea, polySize } from '../../map-app/src/geom/measure.ts';
describe('площадь комнаты', () => {
  it('контур минус дыры, размер по внешнему контуру', () => {
    const outer = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 0, y: 4 }];
    const hole = [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 }];
    expect(polyArea([outer, hole])).toBe(23);
    expect(polySize([outer, hole])).toEqual({ w: 6, h: 4 });
  });
});
import { sameObjects } from '../../map-app/src/geom/ops.ts';
describe('«Такие же»', () => {
  it('тот же ассет и варианты той же группы в той же папке; заблокированный слой — мимо', () => {
    const o = (id, asset, layer = 'a') => ({ id, asset, layer, x: 0, y: 0, w: 1, h: 1, rot: 0, flipX: false, flipY: false, opacity: 1 });
    const f = { layers: [{ id: 'a', locked: false, visible: true }, { id: 'b', locked: true, visible: true }],
      objects: [o('1', 'canon:c/crate.svg'), o('2', 'canon:c/crate-steel.svg'), o('3', 'canon:c/crate.svg', 'b'), o('4', 'canon:c/table.svg'), o('5', 'canon:d/crate.svg')] };
    const entries = { 'canon:c/crate.svg': { dir: 'c', group: 'crate' }, 'canon:c/crate-steel.svg': { dir: 'c', group: 'crate' }, 'canon:c/table.svg': { dir: 'c' }, 'canon:d/crate.svg': { dir: 'd', group: 'crate' } };
    expect(sameObjects(f, [f.objects[0]], (k) => entries[k])).toEqual(['1', '2']);
  });
});
import { alignObjects, distributeObjects, repeatObjects } from '../../map-app/src/geom/ops.ts';
describe('выравнивание и повтор', () => {
  const o = (id, x, y, w = 1, h = 1, rot = 0) => ({ id, asset: 'a', layer: 'l', x, y, w, h, rot, flipX: false, flipY: false, opacity: 1 });
  it('по левому краю учитывает ширину и поворот', () => {
    const m = alignObjects([o('a', 2, 0, 2, 1), o('b', 5, 3, 2, 1, 90)], 'left');
    expect(m.get('a')).toEqual({ x: 2, y: 0 });
    expect(m.get('b').x).toBeCloseTo(1.5);
  });
  it('распределение — равные промежутки, крайние на месте', () => {
    const m = distributeObjects([o('a', 0, 0), o('b', 1, 0), o('c', 10, 0, 2)], 'x');
    expect(m.get('a').x).toBe(0);
    expect(m.get('c').x).toBe(10);
    expect(m.get('b').x).toBeCloseTo(4.75);
  });
  it('повтор N раз с шагом', () => {
    let n = 0;
    const r = repeatObjects([o('a', 1, 1)], 3, { x: 2, y: 0 }, () => `n${++n}`);
    expect(r.map((x) => x.x)).toEqual([3, 5, 7]);
    expect(r[2].id).toBe('n3');
  });
});
import { usedAssetKeys } from '../../map-app/src/storage/file.ts';
describe('ассеты карты для .pmmap и экспорта', () => {
  it('берёт и кисти, пути, крыши, землю, фон-картинку и стили отдельных стен', () => {
    const doc = withContent();
    const f = doc.floors[0];
    f.ground = 'local:p/ground.png';
    f.image.asset = 'local:p/scan.png';
    f.terrain[0].asset = 'local:p/mud.png';
    f.paths.push({ id: 'pa', layer: 'l', points: [], smooth: false, closed: false, style: { asset: 'local:p/road.png', decor: 'local:p/fence.png' } });
    f.roofs.push({ id: 'rf', poly: [[]], asset: 'local:p/roof.png', color: '#000' });
    f.rooms[0].edgeStyles[0].style.asset = 'local:p/brick.png';
    const keys = usedAssetKeys(doc);
    for (const k of ['ground', 'scan', 'mud', 'road', 'fence', 'roof', 'brick']) expect(keys.has(`local:p/${k}.png`)).toBe(true);
  });
});
import { share } from '../../map-app/src/state/share.ts';
import { Editor } from '../../map-app/src/state/editor.ts';
describe('история отмены делит неизменённые части', () => {
  it('share: равное — из прошлой версии, изменённое — новое; вставка в середину по id', () => {
    const prev = { a: { x: 1 }, list: [{ id: 'p', v: 1 }, { id: 'q', v: 2 }], n: 1 };
    const next = structuredClone(prev);
    next.list.splice(1, 0, { id: 'new', v: 0 });
    next.n = 2;
    const r = share(prev, next);
    expect(r).toEqual(next);
    expect(r.a).toBe(prev.a);
    expect(r.list[0]).toBe(prev.list[0]);
    expect(r.list[2]).toBe(prev.list[1]);
    expect(share(prev, structuredClone(prev))).toBe(prev);
  });
  it('правка одного этажа не копирует другие; отмена возвращает прежнее', () => {
    const doc = withContent();
    doc.floors.push({ ...structuredClone(doc.floors[0]), id: 'f2' });
    const ed = new Editor(doc);
    const f2 = ed.doc.floors[1];
    ed.commitFloor((f) => { f.objects[0].x = 9; });
    expect(ed.doc.floors[1]).toBe(f2);
    expect(ed.doc.floors[0].objects[0].x).toBe(9);
    expect(ed.doc.floors[0].rooms[0]).toBe(doc.floors[0].rooms[0]);
    ed.undo();
    expect(ed.doc.floors[0].objects[0].x).toBe(2);
  });
});
import { slidePortal } from '../../map-app/src/geom/walls.ts';
describe('проём тащится вдоль стены', () => {
  const room = { id: 'r', poly: [[{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 0, y: 4 }]], floor: null, wall: { asset: null, color: '#000', width: 0.2 } };
  const f = { id: 'f', name: '', visible: true, layers: [], objects: [], ground: null, terrain: [], paths: [], lights: [], labels: [], roofs: [], image: null, rooms: [room], walls: [], portals: [] };
  const door = { id: 'd', kind: 'door', a: { x: 2, y: 0 }, b: { x: 1, y: 0 }, asset: null };
  it('по той же стене, с привязкой края к полклетки и прежним направлением', () => {
    const r = slidePortal(f, door, { x: 4.2, y: 0.3 }, true);
    expect(r).toEqual({ a: { x: 4.5, y: 0 }, b: { x: 3.5, y: 0 } });
  });
  it('на соседнюю стену и не дальше её конца; вдали от стен — null', () => {
    const r = slidePortal(f, door, { x: 6.2, y: 3.9 }, true);
    expect(r.a.x).toBeCloseTo(6); expect(Math.max(r.a.y, r.b.y)).toBeCloseTo(4);
    expect(slidePortal(f, door, { x: 3, y: 2 }, true)).toBeNull();
  });
});
