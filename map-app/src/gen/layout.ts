// Планировка: общие стены комнат, наружные стены, двери (все комнаты связаны), входы и окна.
import type { AssetKey, Floor, Portal, Pt, Room } from '../model/types';
import { uid } from '../model/doc';
import { type Rnd, between, chance, shuffle } from './rng';

export type Seg = { a: Pt; b: Pt };
const EPS = 0.02;
const len = (s: Seg) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
const dirOf = (s: Seg): Pt => { const L = len(s) || 1; return { x: (s.b.x - s.a.x) / L, y: (s.b.y - s.a.y) / L }; };
const along = (s: Seg, t: number): Pt => { const u = dirOf(s); return { x: s.a.x + u.x * t, y: s.a.y + u.y * t }; };

export function ringEdges(ring: Pt[]): Seg[] {
  return ring.map((p, i) => ({ a: p, b: ring[(i + 1) % ring.length] }));
}
const roomEdges = (r: Room) => r.poly.flatMap(ringEdges);

/** Участок [lo, hi] (в длинах вдоль e), где отрезок g лежит на той же прямой, что и e. */
function overlap(e: Seg, g: Seg): [number, number] | null {
  const L = len(e);
  if (L < 1e-6) return null;
  const u = dirOf(e);
  for (const q of [g.a, g.b]) if (Math.abs(u.x * (q.y - e.a.y) - u.y * (q.x - e.a.x)) > EPS) return null;
  const t1 = (g.a.x - e.a.x) * u.x + (g.a.y - e.a.y) * u.y, t2 = (g.b.x - e.a.x) * u.x + (g.b.y - e.a.y) * u.y;
  const lo = Math.max(0, Math.min(t1, t2)), hi = Math.min(L, Math.max(t1, t2));
  return hi - lo > 0.3 ? [lo, hi] : null;
}

export type Shared = { i: number; j: number; seg: Seg };
/** Общие стены между комнатами (индексы в списке rooms). */
export function sharedEdges(rooms: Room[]): Shared[] {
  const out: Shared[] = [];
  for (let i = 0; i < rooms.length; i++) {
    const ei = roomEdges(rooms[i]);
    for (let j = i + 1; j < rooms.length; j++) {
      for (const e of ei) for (const g of roomEdges(rooms[j])) {
        const o = overlap(e, g);
        if (o) out.push({ i, j, seg: { a: along(e, o[0]), b: along(e, o[1]) } });
      }
    }
  }
  return out;
}

/** Наружные куски стен комнаты: рёбра внешнего контура без участков, общих с другими комнатами. */
export function outerSegments(room: Room, others: Room[]): Seg[] {
  const out: Seg[] = [];
  const otherEdges = others.filter((o) => o !== room).flatMap(roomEdges);
  for (const e of ringEdges(room.poly[0])) {
    const L = len(e);
    const cuts = otherEdges.map((g) => overlap(e, g)).filter((x): x is [number, number] => !!x).sort((a, b) => a[0] - b[0]);
    let cur = 0;
    for (const [lo, hi] of cuts) {
      if (lo - cur > 0.8) out.push({ a: along(e, cur), b: along(e, lo) });
      cur = Math.max(cur, hi);
    }
    if (L - cur > 0.8) out.push({ a: along(e, cur), b: e.b });
  }
  return out;
}

/** Есть ли на участке [lo, hi] отрезка s уже проём. */
function portalOn(f: Floor, s: Seg, lo: number, hi: number): boolean {
  for (const p of f.portals) {
    const o = overlap(s, p);
    if (o && o[1] > lo && o[0] < hi) return true;
  }
  return false;
}
const portalOnSeg = (f: Floor, s: Seg) => portalOn(f, s, 0, len(s));

/** Проём длиной size на отрезке: случайное место с шагом полклетки, с отступом от углов. */
export function placeOnSeg(f: Floor, s: Seg, size: number, rnd: Rnd, margin = 0.5): { a: Pt; b: Pt } | null {
  const L = len(s);
  if (L < size + 0.01) return null;
  const m = Math.min(margin, (L - size) / 2);
  const tries = 8;
  for (let k = 0; k < tries; k++) {
    let start = between(rnd, m, L - size - m);
    start = Math.max(0, Math.min(L - size, Math.round(start * 2) / 2));
    if (portalOn(f, s, start - 0.4, start + size + 0.4)) continue;
    return { a: along(s, start), b: along(s, start + size) };
  }
  return null;
}

export type DoorPick = (i: number, j: number, seg: Seg) => { key: AssetKey | null; size: number };

/**
 * Двери между комнатами: все комнаты связаны (остовное дерево, коридоры — первыми),
 * плюс лишние двери с вероятностью loops. Уже стоящие двери учитываются.
 */
export function connectRooms(f: Floor, rooms: Room[], rnd: Rnd, door: DoorPick, loops = 0.2) {
  const shared = sharedEdges(rooms).filter((s) => len(s.seg) >= 1);
  const parent = rooms.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (i: number, j: number) => { parent[find(i)] = find(j); };
  for (const s of shared) if (portalOnSeg(f, s.seg)) join(s.i, s.j);
  const corridor = (s: Shared) => rooms[s.i].type === 'corridor' || rooms[s.j].type === 'corridor';
  const order = [...shuffle(rnd, shared.filter(corridor)), ...shuffle(rnd, shared.filter((s) => !corridor(s)))];
  const longest = new Map<string, Shared>();
  for (const s of order) { const k = `${s.i}-${s.j}`; const b = longest.get(k); if (!b || len(s.seg) > len(b.seg)) longest.set(k, s); }
  for (const s of order) {
    const best = longest.get(`${s.i}-${s.j}`)!;
    if (best !== s) continue;
    const linked = find(s.i) === find(s.j);
    if (linked && (portalOnSeg(f, s.seg) || !chance(rnd, loops))) continue;
    const d = door(s.i, s.j, s.seg);
    const at = placeOnSeg(f, s.seg, d.size, rnd);
    if (!at) continue;
    f.portals.push({ id: uid('d'), kind: 'door', ...at, asset: d.key });
    join(s.i, s.j);
  }
}

/** Входы снаружи: на наружной стене; toward — точка, к которой вход ближе (улица). */
export function addEntrances(f: Floor, rooms: Room[], rnd: Rnd, count: number, door: (seg: Seg) => { key: AssetKey | null; size: number }, toward?: Pt) {
  const cands = rooms.flatMap((r) => outerSegments(r, f.rooms).map((seg) => ({ r, seg })));
  const score = ({ r, seg }: { r: Room; seg: Seg }) => {
    const m = along(seg, len(seg) / 2);
    const near = toward ? -Math.hypot(m.x - toward.x, m.y - toward.y) : 0;
    const pref = r.type === 'corridor' ? 6 : 0;
    return near + pref + len(seg) * 0.3 + rnd() * 3;
  };
  const sorted = cands.filter((c) => len(c.seg) >= 1.5).sort((a, b) => score(b) - score(a));
  let made = 0;
  for (const c of sorted) {
    if (made >= count) break;
    if (portalOnSeg(f, c.seg)) continue;
    const d = door(c.seg);
    const at = placeOnSeg(f, c.seg, d.size, rnd, 1);
    if (!at) continue;
    f.portals.push({ id: uid('d'), kind: 'door', ...at, asset: d.key });
    made++;
  }
}

/** Окна по наружным стенам: шаг 2–4 клетки, не рядом с углами и дверями. */
export function addWindows(f: Floor, rooms: Room[], rnd: Rnd, chanceOf: (r: Room) => number, win: () => { key: AssetKey | null; size: number }) {
  for (const r of rooms) {
    const p = chanceOf(r);
    if (p <= 0) continue;
    for (const seg of outerSegments(r, f.rooms)) {
      const L = len(seg);
      let pos = between(rnd, 0.8, 2);
      while (true) {
        const w = win();
        if (pos + w.size > L - 0.8) break;
        if (chance(rnd, p) && !portalOn(f, seg, pos - 0.6, pos + w.size + 0.6)) {
          const start = Math.round(pos * 2) / 2;
          if (start + w.size <= L) f.portals.push({ id: uid('d'), kind: 'window', a: along(seg, start), b: along(seg, start + w.size), asset: w.key } as Portal);
        }
        pos += w.size + between(rnd, 2, 4);
      }
    }
  }
}
