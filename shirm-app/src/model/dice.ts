// Броски кубиков для панели мастера: «2d6+3», «d20», «4d6kh3» (оставить 3 лучших), «2d20kl1» (помеха), «d%».
// Чистые функции — проверяются модульными тестами (tests/unit/dice.test.mjs).

export type DieTerm = { kind: 'dice'; sign: 1 | -1; count: number; sides: number; keep?: { mode: 'h' | 'l'; n: number } };
export type NumTerm = { kind: 'num'; sign: 1 | -1; value: number };
export type Term = DieTerm | NumTerm;

export type TermResult = { term: Term; rolls: number[]; kept: boolean[]; total: number };
export type RollResult = { expr: string; terms: TermResult[]; total: number; text: string };

const MAX_DICE = 200;
const MAX_SIDES = 1000;

/** Разобрать выражение. Бросает Error с понятным текстом, если выражение неверное. */
export function parseDice(input: string): Term[] {
  // пробелы допустимы только вокруг знаков: «2d6 3» — ошибка, а не 2d63
  const src = input.trim().toLowerCase().replace(/−/g, '-').replace(/\s*([+-])\s*/g, '$1').replace(/д/g, 'd').replace(/d%/g, 'd100');
  if (!src) throw new Error('Пустое выражение');
  if (/\s/.test(src)) throw new Error('Между частями выражения нужен знак + или −');
  const re = /([+-])?(?:(\d*)d(\d+)(?:(kh|kl)(\d+))?|(\d+))/y;
  const terms: Term[] = [];
  let pos = 0;
  while (pos < src.length) {
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m || m[0] === '' || (terms.length > 0 && !m[1])) throw new Error(`Не понимаю «${src.slice(pos)}»`);
    const sign: 1 | -1 = m[1] === '-' ? -1 : 1;
    if (m[6] !== undefined) {
      terms.push({ kind: 'num', sign, value: Number(m[6]) });
    } else {
      const count = m[2] ? Number(m[2]) : 1;
      const sides = Number(m[3]);
      if (count < 1 || count > MAX_DICE) throw new Error(`Кубиков должно быть от 1 до ${MAX_DICE}`);
      if (sides < 2 || sides > MAX_SIDES) throw new Error(`Граней должно быть от 2 до ${MAX_SIDES}`);
      const t: DieTerm = { kind: 'dice', sign, count, sides };
      if (m[4]) {
        const n = Number(m[5]);
        if (n < 1 || n > count) throw new Error('Оставить можно от 1 до числа кубиков');
        t.keep = { mode: m[4] === 'kh' ? 'h' : 'l', n };
      }
      terms.push(t);
    }
    pos = re.lastIndex;
  }
  return terms;
}

/** Бросить. rand() → [0, 1) — можно подменить в тестах. */
export function rollDice(input: string, rand: () => number = Math.random): RollResult {
  const terms = parseDice(input);
  const res: TermResult[] = terms.map((term) => {
    if (term.kind === 'num') return { term, rolls: [term.value], kept: [true], total: term.sign * term.value };
    const rolls = Array.from({ length: term.count }, () => 1 + Math.floor(rand() * term.sides));
    const kept = rolls.map(() => true);
    if (term.keep) {
      const order = rolls.map((v, i) => [v, i] as const).sort((a, b) => (term.keep!.mode === 'h' ? b[0] - a[0] : a[0] - b[0]));
      kept.fill(false);
      order.slice(0, term.keep.n).forEach(([, i]) => { kept[i] = true; });
    }
    const sum = rolls.reduce((s, v, i) => s + (kept[i] ? v : 0), 0);
    return { term, rolls, kept, total: term.sign * sum };
  });
  const total = res.reduce((s, r) => s + r.total, 0);
  const text = res.map((r, i) => {
    const sign = r.term.sign < 0 ? '− ' : i ? '+ ' : '';
    if (r.term.kind === 'num') return `${sign}${r.term.value}`;
    return `${sign}[${r.rolls.map((v, k) => (r.kept[k] ? String(v) : `~${v}~`)).join(', ')}]`;
  }).join(' ');
  return { expr: input.trim(), terms: res, total, text };
}
