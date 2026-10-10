// Общие части соседних версий документа: история отмены хранит каждую версию целиком,
// но неизменённые этажи, комнаты, мазки и т. п. — это те же объекты, что в прошлой версии.

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;
const idOf = (v: unknown) => (isObj(v) && typeof v.id === 'string' ? v.id : null);

/**
 * Возвращает next, в котором поддеревья, равные таким же в prev, заменены объектами из prev.
 * Элементы массивов с id сопоставляются по id (вставка в середину не ломает совпадения), без id — по индексу.
 * Если next целиком равен prev, возвращается сам prev.
 */
export function share<T>(prev: T, next: T): T {
  return shareAny(prev, next) as T;
}

function shareAny(a: unknown, b: unknown): unknown {
  if (a === b) return a;
  if (!isObj(a) || !isObj(b)) return b;
  if (Array.isArray(a) !== Array.isArray(b)) return b;
  if (Array.isArray(b)) {
    const pa = a as unknown as unknown[];
    const byId = new Map<string, unknown>();
    for (const x of pa) { const id = idOf(x); if (id !== null) byId.set(id, x); }
    let same = pa.length === b.length;
    const out = b.map((x, i) => {
      const id = idOf(x);
      const r = shareAny(id !== null ? byId.get(id) : pa[i], x);
      if (r !== pa[i]) same = false;
      return r;
    });
    return same ? a : out;
  }
  const keys = Object.keys(b);
  let same = keys.length === Object.keys(a).length;
  const out: Obj = {};
  for (const k of keys) {
    const r = shareAny(a[k], b[k]);
    if (r !== a[k] || !(k in a)) same = false;
    out[k] = r;
  }
  return same ? a : out;
}
