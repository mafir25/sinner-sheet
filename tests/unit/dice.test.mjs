import { describe, it, expect } from 'vitest';
import { parseDice, rollDice } from '../../shirm-app/src/model/dice.ts';

// rand по очереди отдаёт значения из списка: v → 1 + floor(v * sides)
const seq = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };

describe('кубики', () => {
  it('разбирает выражения', () => {
    expect(parseDice('2d6+3')).toEqual([
      { kind: 'dice', sign: 1, count: 2, sides: 6 }, { kind: 'num', sign: 1, value: 3 },
    ]);
    expect(parseDice('d20')[0]).toMatchObject({ count: 1, sides: 20 });
    expect(parseDice('1д8 - 1')[1]).toEqual({ kind: 'num', sign: -1, value: 1 });
    expect(parseDice('d%')[0]).toMatchObject({ sides: 100 });
    expect(parseDice('4d6kh3')[0].keep).toEqual({ mode: 'h', n: 3 });
  });
  it('отклоняет мусор и крайности', () => {
    expect(() => parseDice('')).toThrow();
    expect(() => parseDice('2d')).toThrow();
    expect(() => parseDice('abc')).toThrow();
    expect(() => parseDice('2d6 3')).toThrow();
    expect(() => parseDice('1000d6')).toThrow();
    expect(() => parseDice('d1')).toThrow();
    expect(() => parseDice('2d6kh3')).toThrow();
  });
  it('считает сумму и модификатор', () => {
    const r = rollDice('2d6+3', seq(0, 0.99));   // 1 и 6
    expect(r.total).toBe(10);
    expect(r.text).toBe('[1, 6] + 3');
  });
  it('оставляет лучшие и худшие', () => {
    expect(rollDice('2d20kh1', seq(0.1, 0.9)).total).toBe(19);   // 3 и 19 → 19
    expect(rollDice('2d20kl1', seq(0.1, 0.9)).total).toBe(3);
    const r = rollDice('4d6kh3', seq(0, 0.5, 0.99, 0.2));         // 1,4,6,2 → 4+6+2
    expect(r.total).toBe(12);
    expect(r.text).toBe('[~1~, 4, 6, 2]');
  });
  it('вычитает кубики', () => {
    expect(rollDice('10-1d4', seq(0.99)).total).toBe(6);
  });
});
