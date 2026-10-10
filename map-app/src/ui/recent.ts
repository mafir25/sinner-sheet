// Недавние ассеты и комплекты библиотеки (последние 10), запоминаются в этом браузере.
const KEY = 'maps.recent';
const MAX = 10;
const listeners = new Set<() => void>();

function read(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}
let list = read();

/** Ключ ассета (`canon:…`, `local:…`) или комплекта (`set:<ключ комплекта>`). */
export function pushRecent(key: string) {
  list = [key, ...list.filter((k) => k !== key)].slice(0, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* приватный режим */ }
  listeners.forEach((f) => f());
}
export const recent = () => list;
export const subscribeRecent = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
