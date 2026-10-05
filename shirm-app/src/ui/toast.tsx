import { useEffect, useState } from 'react';

type T = { id: number; text: string; kind: 'info' | 'error' };
let listeners: ((t: T[]) => void)[] = [];
let list: T[] = [];
let n = 0;

export function toast(text: string, kind: 'info' | 'error' = 'info') {
  const t = { id: ++n, text, kind };
  list = [...list, t];
  listeners.forEach((l) => l(list));
  setTimeout(() => { list = list.filter((x) => x.id !== t.id); listeners.forEach((l) => l(list)); }, kind === 'error' ? 6000 : 3500);
}

export function Toasts() {
  const [items, setItems] = useState<T[]>(list);
  useEffect(() => { listeners.push(setItems); return () => { listeners = listeners.filter((l) => l !== setItems); }; }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => <div key={t.id} className={`toast toast-${t.kind}`}>{t.text}</div>)}
    </div>
  );
}
