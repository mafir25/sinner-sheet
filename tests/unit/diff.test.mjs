import { describe, it, expect } from 'vitest';
import { diffLines, hunks, diffStats } from '../../site/diff.js';

/** Применить операции к a — должен получиться b. */
const apply = (ops) => ops.filter((o) => o.op !== '-').map((o) => o.line);
const original = (ops) => ops.filter((o) => o.op !== '+').map((o) => o.line);

describe('diffLines', () => {
  it('одинаковые тексты — без изменений', () => {
    const ops = diffLines(['a', 'b'], ['a', 'b']);
    expect(diffStats(ops)).toEqual({ added: 0, removed: 0 });
    expect(hunks(ops)).toEqual([]);
  });
  it('находит вставку, удаление и замену', () => {
    const a = ['1', '2', '3', '4', '5'];
    const b = ['1', '2x', '3', '5', '6'];
    const ops = diffLines(a, b);
    expect(apply(ops)).toEqual(b);
    expect(original(ops)).toEqual(a);
    expect(diffStats(ops)).toEqual({ added: 2, removed: 2 });
  });
  it('пустые стороны', () => {
    expect(diffLines([], ['a'])).toEqual([{ op: '+', line: 'a', b: 1 }]);
    expect(diffLines(['a'], [])).toEqual([{ op: '-', line: 'a', a: 1 }]);
  });
  it('случайные тексты восстанавливаются в обе стороны', () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let t = 0; t < 200; t++) {
      const a = Array.from({ length: Math.floor(rnd() * 30) }, () => 'abcde'[Math.floor(rnd() * 5)]);
      const b = Array.from({ length: Math.floor(rnd() * 30) }, () => 'abcde'[Math.floor(rnd() * 5)]);
      const ops = diffLines(a, b);
      expect(apply(ops)).toEqual(b);
      expect(original(ops)).toEqual(a);
    }
  });
  it('большой файл с одной правкой — быстро и точно', () => {
    const a = Array.from({ length: 50000 }, (_, i) => `line ${i}`);
    const b = [...a]; b[25000] = 'changed';
    const t = Date.now();
    const ops = diffLines(a, b);
    expect(Date.now() - t).toBeLessThan(1000);
    expect(diffStats(ops)).toEqual({ added: 1, removed: 1 });
    const h = hunks(ops, 2);
    expect(h.length).toBe(1);
    expect(h[0].ops.length).toBe(6);
  });
});

describe('diffLines: полная замена большого файла', () => {
  it('не тратит память на кратчайший путь и всё равно корректен', () => {
    const a = Array.from({ length: 20000 }, (_, i) => `a${i}`);
    const b = Array.from({ length: 20000 }, (_, i) => `b${i}`);
    const ops = diffLines(a, b);
    expect(diffStats(ops)).toEqual({ added: 20000, removed: 20000 });
    expect(ops.filter((o) => o.op !== '-').map((o) => o.line)).toEqual(b);
  });
});
