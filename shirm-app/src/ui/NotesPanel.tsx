// Личные заметки мастера: сохраняются в Firestore (видны с любого устройства).
import { useEffect, useRef, useState } from 'react';
import { loadNotes, saveNotes } from '../data/screens';

export function NotesPanel({ uid }: { uid: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [state, setState] = useState<'loading' | 'saved' | 'dirty' | 'saving' | 'error'>('loading');
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    let alive = true;
    loadNotes(uid).then((t) => {
      if (!alive) return;
      const legacy = localStorage.getItem('gm_notes');
      if (t === null && legacy) { setText(legacy); setState('dirty'); schedule(legacy); }
      else { setText(t ?? ''); setState('saved'); }
    }).catch(() => { if (alive) { setText(localStorage.getItem('gm_notes') ?? ''); setState('error'); } });
    return () => { alive = false; };
  }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps

  function schedule(v: string) {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setState('saving');
      try { await saveNotes(uid, v); setState('saved'); } catch { setState('error'); }
    }, 1000);
  }

  const label = { loading: 'загрузка…', saved: 'сохранено', dirty: '…', saving: 'сохранение…', error: 'ошибка' }[state];
  return (
    <>
      <button className={`btn${open ? ' btn-on' : ''}`} onClick={() => setOpen(!open)}>📓 Заметки</button>
      {open && (
        <div className="notes">
          <div className="notes-head"><span>Заметки мастера</span><span className="notes-state">{label}</span>
            <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Закрыть">✕</button></div>
          <textarea className="notes-area" autoFocus value={text} placeholder="Быстрые заметки — видны только тебе и сохраняются автоматически"
            onChange={(e) => { setText(e.target.value); setState('dirty'); schedule(e.target.value); }} />
        </div>
      )}
    </>
  );
}
