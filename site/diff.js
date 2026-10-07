// Построчное сравнение текстов (алгоритм Майерса, O((N+M)·D)) — для просмотра правок канона в админ-панели.
// Без зависимостей; проверяется tests/unit/diff.test.mjs.

/**
 * Разница между массивами строк a и b.
 * Возвращает список операций { op: '=' | '-' | '+', line, a?, b? } (a/b — номера строк с 1).
 */
export function diffLines(a, b) {
  // общие начало и конец отрезаем сразу — правки обычно точечные, а файлы большие
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const A = a.slice(start, endA), B = b.slice(start, endB);
  const mid = myers(A, B);
  const out = [];
  for (let i = 0; i < start; i++) out.push({ op: '=', line: a[i], a: i + 1, b: i + 1 });
  let ia = start, ib = start;
  for (const op of mid) {
    if (op === '=') { out.push({ op, line: a[ia], a: ia + 1, b: ib + 1 }); ia++; ib++; }
    else if (op === '-') { out.push({ op, line: a[ia], a: ia + 1 }); ia++; }
    else { out.push({ op, line: b[ib], b: ib + 1 }); ib++; }
  }
  for (let i = endA; i < a.length; i++) { out.push({ op: '=', line: a[i], a: i + 1, b: ib + 1 }); ib++; }
  return out;
}

// Больше правок — не ищем кратчайший путь (память растёт как D·(N+M)), а показываем «всё заменено».
const MAX_EDITS = 3000;

/** Последовательность операций '=', '-', '+' кратчайшего редактирования A → B. */
function myers(A, B) {
  const N = A.length, M = B.length, MAX = N + M;
  if (!N) return Array(M).fill('+');
  if (!M) return Array(N).fill('-');
  const replaceAll = () => [...Array(N).fill('-'), ...Array(M).fill('+')];
  const off = MAX + 1;
  let v = new Int32Array(2 * MAX + 3);
  const trace = [];
  let found = false;
  for (let d = 0; d <= MAX && !found; d++) {
    if (d > MAX_EDITS) return replaceAll();
    // для обратного прохода нужны только диагонали -d..d — храним срез, а не весь массив (память ~D², а не D·(N+M))
    trace.push(v.slice(off - d, off + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x = (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && A[x] === B[y]) { x++; y++; }
      v[off + k] = x;
      if (x >= N && y >= M) { found = true; break; }
    }
  }
  // обратный проход по сохранённым состояниям
  const ops = [];
  let x = N, y = M;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d];             // vd[k + d] — значение диагонали k перед шагом d
    const at = (kk) => vd[kk + d];
    const k = x - y;
    const prevK = (k === -d || (k !== d && at(k - 1) < at(k + 1))) ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : at(prevK), prevY = d === 0 ? 0 : prevX - prevK;
    while (x > prevX && y > prevY) { ops.push('='); x--; y--; }
    if (d > 0) ops.push(x === prevX ? '+' : '-');
    x = prevX; y = prevY;
  }
  return ops.reverse();
}

/**
 * Сгруппировать операции в фрагменты с контекстом (как в git diff).
 * Возвращает [{ ops: [...] }] — только участки с изменениями и context строк вокруг.
 */
export function hunks(ops, context = 3) {
  const changed = ops.map((o, i) => (o.op !== '=' ? i : -1)).filter((i) => i >= 0);
  if (!changed.length) return [];
  const out = [];
  let from = Math.max(0, changed[0] - context), to = Math.min(ops.length - 1, changed[0] + context);
  for (const i of changed.slice(1)) {
    if (i - context <= to + 1) to = Math.min(ops.length - 1, i + context);
    else { out.push({ ops: ops.slice(from, to + 1) }); from = Math.max(0, i - context); to = Math.min(ops.length - 1, i + context); }
  }
  out.push({ ops: ops.slice(from, to + 1) });
  return out;
}

/** Счётчики: сколько строк добавлено и удалено. */
export const diffStats = (ops) => ({ added: ops.filter((o) => o.op === '+').length, removed: ops.filter((o) => o.op === '-').length });
