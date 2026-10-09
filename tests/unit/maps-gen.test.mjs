// Этап 4 редактора карт: генерация на реальном каноне (Assets/Maps/manifest.json).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createDoc } from '../../map-app/src/model/doc.ts';
import { rectPoly, pointInPoly } from '../../map-app/src/geom/poly.ts';
import { boxesOverlap, checkObject } from '../../map-app/src/geom/place.ts';
import { makeKit } from '../../map-app/src/gen/kit.ts';
import { makeRnd, hashSeed } from '../../map-app/src/gen/rng.ts';
import { building, decorate, dungeon, streets, buildingRects } from '../../map-app/src/gen/generate.ts';
import { sharedEdges, outerSegments } from '../../map-app/src/gen/layout.ts';

const manifest = JSON.parse(readFileSync('Assets/Maps/manifest.json', 'utf8'));
const kit = makeKit([{ id: 'canon', assets: manifest.assets, sets: manifest.sets }]);
const fill = { furnish: true, density: 1, cover: 1, traps: 1, weather: true, lights: true, numbers: true, condition: 'style' };
const newDoc = (w = 40, h = 30) => createDoc({ name: 'T', width: w, height: h, grid: 'square', floorName: 'F' });
const strip = (d) => JSON.stringify(d.floors[0], (k, v) => (k === 'id' || k === 'layer' ? undefined : v));

/** Комнаты связаны дверями: из любой можно дойти до любой. */
function connected(f) {
  const n = f.rooms.length, adj = Array.from({ length: n }, () => new Set());
  for (const d of f.portals) {
    if (d.kind !== 'door') continue;
    const m = { x: (d.a.x + d.b.x) / 2, y: (d.a.y + d.b.y) / 2 }, L = Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y);
    const nx = -(d.b.y - d.a.y) / L, ny = (d.b.x - d.a.x) / L;
    const i = f.rooms.findIndex((r) => pointInPoly({ x: m.x + nx * 0.3, y: m.y + ny * 0.3 }, r.poly));
    const j = f.rooms.findIndex((r) => pointInPoly({ x: m.x - nx * 0.3, y: m.y - ny * 0.3 }, r.poly));
    if (i >= 0 && j >= 0) { adj[i].add(j); adj[j].add(i); }
  }
  const seen = new Set([0]), q = [0];
  while (q.length) for (const j of adj[q.pop()]) if (!seen.has(j)) { seen.add(j); q.push(j); }
  return seen.size === n;
}
const entryOf = (k) => kit.entryOf(k);
const solid = (f, o) => { const t = entryOf(o.asset)?.tags ?? []; return !t.includes('debris') && !t.includes('trap') && o.layer !== f.layers[0].id; };
function noOverlaps(f) {
  const s = f.objects.filter((o) => solid(f, o)).map((o) => ({ ...o, w: o.w - 0.06, h: o.h - 0.06 }));
  for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) if (boxesOverlap(s[i], s[j])) return `${s[i].asset} × ${s[j].asset}`;
  return null;
}

describe('зерно', () => {
  it('одно зерно — одна последовательность', () => {
    const a = makeRnd('abc'), b = makeRnd('abc'), c = makeRnd('abd');
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    expect(c()).not.toBe(xs[0]);
    expect(hashSeed('x')).toBe(hashSeed('x'));
  });
});

describe('каталог генератора', () => {
  it('объекты с правилами, мусор, укрытия, ловушки, комплекты', () => {
    expect(kit.traps.length).toBe(3);
    expect(kit.debris.length).toBe(3);
    expect(kit.cover.some((c) => c.entry?.group === 'crate')).toBe(true);
    expect(kit.objects.some((c) => c.kind === 'set' && c.set.key === 'workplace' && c.rules.rooms.includes('office'))).toBe(true);
    // группа вариантов — одна запись
    expect(kit.objects.filter((c) => c.kind === 'asset' && c.entry.group === 'crate')).toHaveLength(1);
    expect(kit.pick('floor', ['canon:floors/nope.svg', 'canon:floors/wood.svg'])).toBe('canon:floors/wood.svg');
  });
});

describe('планировка', () => {
  it('здание с коридором: комнаты по обе стороны, коридор во всю длину', () => {
    const rs = buildingRects(makeRnd('k'), { x0: 0, y0: 0, x1: 20, y1: 12 }, 6, true, false);
    expect(rs.filter((r) => r.kind === 'corridor')).toHaveLength(1);
    expect(rs.filter((r) => r.kind === 'room')).toHaveLength(6);
    const area = rs.reduce((s, { rect: r }) => s + (r.x1 - r.x0) * (r.y1 - r.y0), 0);
    expect(area).toBe(240); // без дыр и наложений
  });
  it('общие и наружные стены', () => {
    const room = (a, b) => ({ id: '', poly: rectPoly(a, b), floor: null, wall: { asset: null, color: '#000', width: 0.25 } });
    const r1 = room({ x: 0, y: 0 }, { x: 4, y: 4 }), r2 = room({ x: 4, y: 1 }, { x: 8, y: 3 });
    const sh = sharedEdges([r1, r2]);
    expect(sh).toHaveLength(1);
    expect(Math.hypot(sh[0].seg.b.x - sh[0].seg.a.x, sh[0].seg.b.y - sh[0].seg.a.y)).toBeCloseTo(2);
    const outer = outerSegments(r1, [r1, r2]).reduce((s, g) => s + Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y), 0);
    expect(outer).toBeCloseTo(14);
  });
});

describe('генераторы', () => {
  for (const type of ['office', 'warehouse', 'lab', 'house']) {
    it(`здание «${type}»: связно, без наложений, правила соблюдены, зерно повторяет результат`, () => {
      const d = newDoc();
      const o = { seed: `s-${type}`, clear: true, fill, type, width: 22, height: 14, rooms: 6, style: 'auto', roof: true };
      building(d, d.floors[0].id, kit, o);
      const f = d.floors[0];
      expect(f.rooms.length).toBeGreaterThanOrEqual(2);
      expect(connected(f)).toBe(true);
      expect(f.portals.some((p) => p.kind === 'window')).toBe(true);
      expect(f.objects.length).toBeGreaterThan(3);
      expect(noOverlaps(f)).toBeNull();
      for (const ob of f.objects) expect(checkObject(f, ob, entryOf)).toEqual([]);
      expect(f.roofs).toHaveLength(1);
      expect(d.lighting.enabled).toBe(true);
      const d2 = newDoc();
      building(d2, d2.floors[0].id, kit, o);
      expect(strip(d2)).toBe(strip(d));
    });
  }
  it('подземелье: комнаты и коридоры связаны, есть лестница и ловушки на слое мастера', () => {
    const d = newDoc(40, 30);
    dungeon(d, d.floors[0].id, kit, { seed: 'dng', clear: true, fill: { ...fill, traps: 2 }, rooms: 7, style: 'ruins' });
    const f = d.floors[0];
    expect(f.rooms.filter((r) => r.type === 'corridor').length).toBeGreaterThan(0);
    expect(connected(f)).toBe(true);
    expect(f.portals.every((p) => p.kind === 'door')).toBe(true);
    expect(f.objects.some((o) => o.asset.includes('stairs'))).toBe(true);
    const gm = f.layers.find((l) => l.gmOnly);
    expect(gm).toBeTruthy();
    expect(f.objects.filter((o) => o.layer === gm.id).every((o) => o.asset.includes('/traps/'))).toBe(true);
    expect(noOverlaps(f)).toBeNull();
  });
  it('улицы Задворок: дороги, кварталы с домами, фонари со светом', () => {
    const d = newDoc(60, 40);
    streets(d, d.floors[0].id, kit, { seed: 'bs', clear: true, fill, block: 16, plazas: 0.15, buildings: true, roofs: true, style: 'backstreets' });
    const f = d.floors[0];
    expect(f.paths.length).toBeGreaterThan(2);
    expect(f.rooms.length).toBeGreaterThan(4);
    expect(f.roofs.length).toBeGreaterThan(1);
    expect(f.objects.some((o) => o.asset.includes('streetlamp'))).toBe(true);
    expect(f.lights.length).toBeGreaterThan(0);
    // фонари и прочее с улицы не стоят в домах
    for (const o of f.objects.filter((x) => entryOf(x.asset)?.rules?.place === 'road')) {
      expect(f.rooms.some((r) => pointInPoly(o, r.poly))).toBe(false);
    }
    expect(noOverlaps(f)).toBeNull();
  });
  it('оформление наброска: типы, материалы, двери, вход, мебель', () => {
    const d = newDoc(30, 20);
    const f = d.floors[0];
    const sketch = (a, b) => ({ id: `r${a.x}`, poly: rectPoly(a, b), floor: null, wall: { asset: null, color: '#000', width: 0.25 } });
    f.rooms = [sketch({ x: 2, y: 2 }, { x: 12, y: 10 }), sketch({ x: 12, y: 2 }, { x: 18, y: 6 }), sketch({ x: 12, y: 6 }, { x: 14, y: 9 })];
    decorate(d, f.id, kit, { seed: 'dec', clear: false, fill, rooms: [], style: 'wing', restyle: true, doors: true, windows: true });
    expect(f.rooms.every((r) => r.type && r.floor && r.wall.asset)).toBe(true);
    expect(f.rooms[0].type).toBe('office'); // самая большая — «зал» стиля
    expect(f.rooms[2].type).toBe('bathroom');
    expect(connected(f)).toBe(true);
    expect(f.objects.length).toBeGreaterThan(2);
    expect(noOverlaps(f)).toBeNull();
  });
});

describe('устойчивость на разных зёрнах', () => {
  it('здания и подземелья всегда связны и без наложений', () => {
    const bad = [];
    for (let i = 0; i < 25; i++) {
      const type = ['office', 'warehouse', 'lab', 'house', 'bar', 'clinic', 'workshop', 'hideout', 'shop'][i % 9];
      const d = newDoc();
      building(d, d.floors[0].id, kit, { seed: `b${i}`, clear: true, fill, type, width: 10 + (i % 4) * 5, height: 8 + (i % 3) * 4, rooms: 1 + (i % 7), style: 'auto', roof: false });
      if (!connected(d.floors[0]) || noOverlaps(d.floors[0])) bad.push(`building ${type} b${i}`);
      const g = newDoc();
      dungeon(g, g.floors[0].id, kit, { seed: `d${i}`, clear: true, fill, rooms: 3 + (i % 8), style: 'ruins' });
      if (!connected(g.floors[0]) || noOverlaps(g.floors[0])) bad.push(`dungeon d${i}`);
    }
    expect(bad).toEqual([]);
  });
});
