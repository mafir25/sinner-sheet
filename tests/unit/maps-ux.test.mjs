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
