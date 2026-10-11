// Крыши (формы скатов, крыша на здание) и уровни местности (возвышения и ямы), низкие стены.
import { describe, it, expect } from 'vitest';
import { rectPoly } from '../../map-app/src/geom/poly.ts';
import { roofRaster, roofRidge, buildingRooms, roofPolyOver, roofsOver, refitRoof } from '../../map-app/src/geom/roof.ts';
import { levelFaces, heightAt, fmtHeight, labelSpot } from '../../map-app/src/geom/levels.ts';
import { blockingSegments } from '../../map-app/src/geom/light.ts';
import { buildDd2vtt } from '../../map-app/src/export/export.ts';
import { createDoc, parseDoc, normalizeDoc } from '../../map-app/src/model/doc.ts';
import { copySelection, pasteClip, clipSize } from '../../map-app/src/geom/ops.ts';

const floor = (o = {}) => ({
  id: 'f', name: '', visible: true, layers: [], objects: [], ground: null, terrain: [], paths: [], lights: [], labels: [], roofs: [], levels: [],
  image: null, rooms: [], portals: [], walls: [], ...o,
});
const wall = { asset: null, color: '#000', width: 0.1 };
const room = (id, a, b, w = wall) => ({ id, poly: rectPoly(a, b), floor: null, wall: w });
const roof = (poly, o = {}) => ({ id: 'rf', poly, asset: null, color: '#333', ...o });
const P = (x, y) => ({ x, y });

/** Направление ската в точке (x, y) клеток. */
function dirAt(r, x, y) {
  const i = Math.floor((x - r.x0) * r.res), j = Math.floor((y - r.y0) * r.res), k = j * r.w + i;
  return r.face[k] < 0 ? null : [Math.round(r.dx[k] * 100) / 100, Math.round(r.dy[k] * 100) / 100];
}

describe('скаты крыш', () => {
  it('вальмовая на прямоугольнике: каждый скат стекает к своему краю', () => {
    const r = roofRaster(roof(rectPoly(P(0, 0), P(6, 4))), 8);
    expect(dirAt(r, 3, 0.3)).toEqual([0, -1]);
    expect(dirAt(r, 3, 3.7)).toEqual([0, 1]);
    expect(dirAt(r, 0.3, 2)).toEqual([-1, 0]);
    expect(dirAt(r, 5.7, 2)).toEqual([1, 0]);
    expect(new Set(r.face.filter((x) => x >= 0)).size).toBe(4);
  });
  it('вальмовая на Г-образном здании: скаты-плоскости, ендова от внутреннего угла под 45°', () => {
    const L = [[P(0, 0), P(6, 0), P(6, 3), P(3, 3), P(3, 6), P(0, 6)]];
    const r = roofRaster(roof(L), 8);
    // у внутреннего угла (3,3): над диагональю — скат к правому краю ножки, под ней — к нижнему краю перекладины
    expect(dirAt(r, 2.6, 3.3)).toEqual([1, 0]);
    expect(dirAt(r, 3.3, 2.6)).toEqual([0, 1]);
    expect(dirAt(r, 4, 4)).toBeNull(); // вне крыши
  });
  it('двускатная: конёк вдоль длинной стороны или заданный', () => {
    const rect = rectPoly(P(0, 0), P(6, 4));
    expect(roofRidge(roof(rect))).toBe('h');
    const g = roofRaster(roof(rect, { shape: 'gable' }), 8);
    expect(dirAt(g, 0.3, 1)).toEqual([0, -1]);
    expect(dirAt(g, 0.3, 3)).toEqual([0, 1]);
    const v = roofRaster(roof(rect, { shape: 'gable', ridge: 'v' }), 8);
    expect(dirAt(v, 1, 0.3)).toEqual([-1, 0]);
    expect(dirAt(v, 5, 0.3)).toEqual([1, 0]);
  });
  it('односкатная стекает в одну сторону, у плоской скатов нет', () => {
    const rect = rectPoly(P(0, 0), P(3, 3));
    const s = roofRaster(roof(rect, { shape: 'shed', fall: 'e' }), 4);
    expect(dirAt(s, 0.5, 0.5)).toEqual([1, 0]);
    expect(dirAt(s, 2.5, 2.5)).toEqual([1, 0]);
    expect(roofRaster(roof(rect, { shape: 'flat' }), 4)).toBeNull();
  });
});

describe('крыша и комнаты', () => {
  const a = room('a', P(0, 0), P(4, 3)), b = room('b', P(4, 0), P(7, 3)), far = room('c', P(10, 0), P(12, 2));
  const f = floor({ rooms: [a, b, far] });
  it('щелчок по комнате — крыша на всё здание (касающиеся комнаты), отдельный дом — мимо', () => {
    expect(buildingRooms(f, a).map((r) => r.id).sort()).toEqual(['a', 'b']);
    const poly = roofPolyOver(buildingRooms(f, a));
    expect(poly[0]).toHaveLength(4);
    const xs = poly[0].map((p) => p.x);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([0, 7]);
  });
  it('крыша над комнатами едет и копируется вместе с ними', () => {
    const g = floor({ rooms: [a, b, far], roofs: [roof(rectPoly(P(0, 0), P(7, 3)), { id: 'big' }), roof(far.poly, { id: 'small' })] });
    expect([...roofsOver(g, [a, b])]).toEqual(['big']);
    expect(roofsOver(g, [a]).size).toBe(0); // крыша шире одной комнаты — остаётся
    const clip = copySelection(g, new Set(['a', 'b']), () => new Set());
    expect(clip.roofs.map((r) => r.id)).toEqual(['big']);
  });
  it('«По комнатам»: форма крыши заново по комнатам под ней', () => {
    const g = floor({ rooms: [a, b], roofs: [roof(rectPoly(P(1, 1), P(2, 2)))] });
    const p = refitRoof(g, g.roofs[0]);
    expect(Math.max(...p[0].map((q) => q.x))).toBe(4);
    expect(refitRoof(floor(), roof(rectPoly(P(1, 1), P(2, 2))))).toBeNull();
  });
});

describe('уровни местности', () => {
  const lv = (id, poly, h) => ({ id, poly, h, floor: null, face: null, color: '#444', label: true });
  it('возвышение: обрыв под южным краем, снаружи; глубина по перепаду', () => {
    const f = floor({ levels: [lv('p', rectPoly(P(0, 0), P(4, 3)), 10)] });
    const faces = levelFaces(f);
    expect(faces).toHaveLength(1);
    expect(faces[0].inside).toBe(false);
    expect(faces[0].pts.map((p) => p.y).sort()).toEqual([3, 3, 3.4, 3.4]);
  });
  it('яма: видна дальняя (северная) стенка, внутри', () => {
    const faces = levelFaces(floor({ levels: [lv('pit', rectPoly(P(0, 0), P(4, 3)), -5)] }));
    expect(faces).toHaveLength(1);
    expect(faces[0].inside).toBe(true);
    expect(faces[0].pts.map((p) => p.y).sort()).toEqual([0, 0, 0.2, 0.2]);
  });
  it('перепад между участками рисует более высокий — один раз', () => {
    // помост +20 к северу от ямы −10: один обрыв глубиной 30 фт на их общем крае
    const f = floor({ levels: [lv('hi', rectPoly(P(0, 0), P(4, 2)), 20), lv('pit', rectPoly(P(0, 2), P(4, 5)), -10)] });
    const faces = levelFaces(f);
    expect(faces).toHaveLength(1);
    expect(faces[0].level.id).toBe('hi');
    expect(Math.max(...faces[0].pts.map((p) => p.y))).toBeCloseTo(2 + 30 * 0.04);
  });
  it('высота в точке, подписи', () => {
    const f = floor({ levels: [lv('p', rectPoly(P(0, 0), P(4, 3)), 10)] });
    expect(heightAt(f, P(1, 1))).toBe(10);
    expect(heightAt(f, P(5, 5))).toBe(0);
    expect(fmtHeight(10, 'фт')).toBe('+10 фт');
    expect(fmtHeight(-5, 'фт')).toBe('−5 фт');
    const s = labelSpot([[P(0, 0), P(6, 0), P(6, 2), P(2, 2), P(2, 6), P(0, 6)]]);
    expect(s.x < 2 || s.y < 2).toBe(true); // внутри Г-образного участка
  });
  it('файл: уровни и формы крыш сохраняются; старые карты — без уровней', () => {
    const d = createDoc({ name: 'X', width: 8, height: 8, grid: 'square', floorName: 'F' });
    const raw = JSON.parse(JSON.stringify(d));
    raw.floors[0].levels = [lv('p', rectPoly(P(0, 0), P(2, 2)), -15)];
    raw.floors[0].roofs = [roof(rectPoly(P(0, 0), P(2, 2)), { shape: 'gable', ridge: 'v', height: 25 })];
    const p = parseDoc(raw);
    expect(p.floors[0].levels[0]).toMatchObject({ h: -15, label: true });
    expect(p.floors[0].roofs[0]).toMatchObject({ shape: 'gable', ridge: 'v', height: 25 });
    delete raw.floors[0].levels;
    expect(parseDoc(raw).floors[0].levels).toEqual([]);
    const old = JSON.parse(JSON.stringify(d));
    delete old.floors[0].levels;
    expect(normalizeDoc(old).floors[0].levels).toEqual([]);
  });
  it('копирование уровней; буфер старой версии (без уровней) вставляется', () => {
    const f = floor({ levels: [lv('p', rectPoly(P(0, 0), P(2, 2)), 5)] });
    const clip = copySelection(f, new Set(['p']), () => new Set());
    expect(clipSize(clip)).toBe(1);
    const out = pasteClip(clip, P(1, 0), new Set(), 'l', (x) => `${x}1`);
    expect(out.levels[0].poly[0][0]).toEqual(P(1, 0));
    const { levels: _, ...old } = clip;
    expect(pasteClip(old, P(1, 0), new Set(), 'l', (x) => x).levels).toEqual([]);
  });
});

describe('низкие стены', () => {
  it('не задерживают свет и не попадают в .dd2vtt (вместе с калиткой)', () => {
    const low = { ...wall, low: true };
    const fence = { id: 'w', points: [P(0, 5), P(6, 5)], closed: false, wall: low };
    const gate = { id: 'g', kind: 'door', a: P(2, 5), b: P(3, 5), asset: 'canon:portals/doors/wood.svg' };
    const f = floor({ rooms: [room('r', P(0, 0), P(4, 3))], walls: [fence], portals: [gate] });
    expect(blockingSegments(f).some(([a, b]) => a.y === 5 && b.y === 5)).toBe(false);
    expect(blockingSegments(f).some(([a, b]) => a.y === 0 && b.y === 0)).toBe(true);
    const d = createDoc({ name: 'X', width: 8, height: 8, grid: 'square', floorName: 'F' });
    const v = buildDd2vtt(d, f, 70, '', 'gap');
    expect(v.line_of_sight.flat().some((p) => p.y === 5)).toBe(false);
    expect(v.portals).toEqual([]);
  });
});
