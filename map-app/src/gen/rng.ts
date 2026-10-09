// Генератор случайных чисел с зерном (seed): одно и то же зерно — та же карта.
// В генерации нельзя звать Math.random — только rnd из этого файла (id объектов не в счёт).

export type Rnd = () => number;

/** Строка-зерно → 32-битное число (FNV-1a). */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** mulberry32: быстрый и достаточно хороший для карт. */
export function makeRnd(seed: string | number): Rnd {
  let a = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Новое зерно для кнопки 🎲 — короткое, чтобы его было удобно записать. */
export function newSeed(): string {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

export const between = (rnd: Rnd, a: number, b: number) => a + (b - a) * rnd();
export const intBetween = (rnd: Rnd, a: number, b: number) => Math.floor(between(rnd, a, b + 1));
export const chance = (rnd: Rnd, p: number) => rnd() < p;
export function pick<T>(rnd: Rnd, list: readonly T[]): T { return list[Math.floor(rnd() * list.length)]; }
export function shuffle<T>(rnd: Rnd, list: T[]): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
/** Случайный элемент с весами; null — все веса нулевые. */
export function weighted<T>(rnd: Rnd, list: readonly T[], weight: (x: T) => number): T | null {
  const total = list.reduce((s, x) => s + Math.max(0, weight(x)), 0);
  if (total <= 0) return null;
  let r = rnd() * total;
  for (const x of list) { r -= Math.max(0, weight(x)); if (r < 0) return x; }
  return list[list.length - 1];
}
