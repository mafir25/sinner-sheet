// Панель мастера: кубики и трекер инициативы. Сохраняется в gm_notes/<uid>.tools (видна с любого устройства).
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { rollDice, type RollResult } from '../model/dice';
import { loadGmTools, saveGmTools } from '../data/screens';
import { uid as newId } from '../model/schema';

type Combatant = { id: string; name: string; init: number; hp: string; note: string; ally: boolean };
type LogEntry = { id: string; at: number; expr: string; text: string; total: number; label?: string };
type Tools = { combatants: Combatant[]; turn: number; round: number; log: LogEntry[] };

const EMPTY: Tools = { combatants: [], turn: 0, round: 1, log: [] };
const QUICK = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'];
const LOG_MAX = 30;

/** Данные из базы могут быть старыми или битыми — приводим к ожидаемому виду. */
function normalize(raw: unknown): Tools {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Tools>;
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : []);
  return {
    combatants: arr<Combatant>(r.combatants).filter((c) => c && typeof c.name === 'string').map((c) => ({
      id: String(c.id || newId('c')), name: String(c.name).slice(0, 80), init: Number(c.init) || 0,
      hp: String(c.hp ?? '').slice(0, 20), note: String(c.note ?? '').slice(0, 200), ally: !!c.ally,
    })).slice(0, 60),
    turn: Number(r.turn) || 0,
    round: Math.max(1, Number(r.round) || 1),
    log: arr<LogEntry>(r.log).slice(0, LOG_MAX),
  };
}
const sorted = (list: Combatant[]) => [...list].sort((a, b) => b.init - a.init || a.name.localeCompare(b.name));

export function GmTools({ uid }: { uid: string }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'dice' | 'init'>('dice');
  const [tools, setTools] = useState<Tools>(EMPTY);
  const [state, setState] = useState<'loading' | 'saved' | 'dirty' | 'error'>('loading');
  const [expr, setExpr] = useState('d20');
  const [err, setErr] = useState('');
  const [last, setLast] = useState<RollResult | null>(null);
  const [form, setForm] = useState({ name: '', init: '', hp: '', ally: false });
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const loaded = useRef(false);
  const cur = useRef<Tools>(EMPTY);
  const touched = useRef(false); // мастер что-то изменил, пока данные ещё грузились

  useEffect(() => {
    let alive = true;
    loadGmTools(uid).then((t) => {
      if (!alive) return;
      loaded.current = true;
      // правки, сделанные до загрузки (медленная сеть), важнее сохранённого — записываем их
      if (touched.current) { scheduleSave(); return; }
      cur.current = normalize(t); setTools(cur.current); setState('saved');
    })
      .catch(() => { if (alive) { setState('error'); loaded.current = true; if (touched.current) scheduleSave(); } });
    return () => { alive = false; };
  }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps

  function update(fn: (t: Tools) => Tools) {
    const next = fn(cur.current);
    cur.current = next;
    touched.current = true;
    setTools(next);
    if (loaded.current) scheduleSave(); // до загрузки не пишем — запишем, когда она закончится
  }
  function scheduleSave() {
    setState('dirty');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      saveGmTools(uid, cur.current).then(() => setState('saved')).catch((e) => { console.error(e); setState('error'); });
    }, 800);
  }

  function roll(e: string, label?: string) {
    try {
      const r = rollDice(e);
      setErr(''); setLast(r);
      // Firestore не принимает undefined — label только если он есть
      const entry: LogEntry = { id: newId('r'), at: Date.now(), expr: r.expr, text: r.text, total: r.total, ...(label ? { label } : {}) };
      update((t) => ({ ...t, log: [entry, ...t.log].slice(0, LOG_MAX) }));
      return r;
    } catch (x) { setErr((x as Error).message); return null; }
  }

  const list = sorted(tools.combatants);
  const turn = list.length ? Math.min(tools.turn, list.length - 1) : 0;

  function addCombatant(ev: FormEvent) {
    ev.preventDefault();
    const name = form.name.trim();
    if (!name) return;
    // пусто — бросить d20; «+3» или «-1» — d20 с модификатором; число — как есть
    let init = Number(form.init);
    const mod = /^[+-]\d+$/.test(form.init.trim()) ? form.init.trim() : '';
    if (!form.init.trim() || mod) {
      const r = roll(`d20${mod}`, `Инициатива: ${name}`);
      if (!r) return;
      init = r.total;
    }
    if (!Number.isFinite(init)) { setErr('Инициатива — число, «+3» или пусто (бросок d20)'); return; }
    update((t) => ({ ...t, combatants: [...t.combatants, { id: newId('c'), name: name.slice(0, 80), init, hp: form.hp.trim().slice(0, 20), note: '', ally: form.ally }] }));
    setForm({ name: '', init: '', hp: '', ally: form.ally });
  }
  const patch = (id: string, p: Partial<Combatant>) =>
    update((t) => ({ ...t, combatants: t.combatants.map((c) => (c.id === id ? { ...c, ...p } : c)) }));
  const remove = (id: string) => update((t) => {
    const s = sorted(t.combatants);
    const idx = s.findIndex((c) => c.id === id);
    const rest = t.combatants.filter((c) => c.id !== id);
    let tr = t.turn;
    if (idx >= 0 && idx < tr) tr -= 1;
    return { ...t, combatants: rest, turn: rest.length ? Math.min(tr, rest.length - 1) : 0 };
  });
  const next = (d: 1 | -1) => update((t) => {
    const n = t.combatants.length;
    if (!n) return t;
    let tr = Math.min(t.turn, n - 1) + d, round = t.round;
    if (tr >= n) { tr = 0; round += 1; }
    if (tr < 0) { tr = n - 1; round = Math.max(1, round - 1); }
    return { ...t, turn: tr, round };
  });

  const label = { loading: 'загрузка…', saved: 'сохранено', dirty: '…', error: 'ошибка сохранения' }[state];
  return (
    <>
      <button className={`btn${open ? ' btn-on' : ''}`} onClick={() => setOpen(!open)} title="Кубики и трекер инициативы">🎲 Мастер</button>
      {open && (
        <div className="notes gm-tools">
          <div className="notes-head">
            <button className={`gm-tab${tab === 'dice' ? ' on' : ''}`} onClick={() => setTab('dice')}>Кубики</button>
            <button className={`gm-tab${tab === 'init' ? ' on' : ''}`} onClick={() => setTab('init')}>Инициатива{list.length ? ` · ${list.length}` : ''}</button>
            <span className="notes-state">{label}</span>
            <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Закрыть">✕</button>
          </div>

          {tab === 'dice' && (
            <div className="gm-body">
              <form className="gm-row" onSubmit={(e) => { e.preventDefault(); roll(expr); }}>
                <input className="input" value={expr} onChange={(e) => setExpr(e.target.value)} aria-label="Выражение"
                  placeholder="2d6+3, 4d6kh3, 2d20kh1…" />
                <button className="btn btn-primary" type="submit">Бросить</button>
              </form>
              <div className="gm-quick">
                {QUICK.map((q) => <button key={q} className="btn btn-sm" onClick={() => roll(q)}>{q}</button>)}
                <button className="btn btn-sm" title="Преимущество" onClick={() => roll('2d20kh1', 'Преимущество')}>d20 ⇈</button>
                <button className="btn btn-sm" title="Помеха" onClick={() => roll('2d20kl1', 'Помеха')}>d20 ⇊</button>
              </div>
              {err && <div className="gm-err">{err}</div>}
              {last && !err && (
                <div className="gm-result"><span className="gm-total">{last.total}</span><span className="gm-detail">{last.expr}: {last.text}</span></div>
              )}
              <div className="gm-log">
                {tools.log.map((l) => (
                  <div key={l.id} className="gm-log-row">
                    <b>{l.total}</b> <span>{l.label ? `${l.label} — ` : ''}{l.expr}: {l.text}</span>
                  </div>
                ))}
                {tools.log.length > 0 && <button className="btn btn-sm" onClick={() => update((t) => ({ ...t, log: [] }))}>Очистить журнал</button>}
              </div>
              <p className="hint">kh3 — оставить 3 лучших, kl1 — худший. Зачёркнутые значения отброшены.</p>
            </div>
          )}

          {tab === 'init' && (
            <div className="gm-body">
              <div className="gm-row gm-round">
                <span>Раунд <b>{tools.round}</b></span>
                <span className="grow" />
                <button className="btn btn-sm" onClick={() => next(-1)} disabled={!list.length}>◀</button>
                <button className="btn btn-sm btn-primary" onClick={() => next(1)} disabled={!list.length}>Следующий ход ▶</button>
              </div>
              <div className="gm-init-list">
                {list.length === 0 && <div className="hint">Добавь участников боя ниже. Пустая инициатива — бросок d20, «+2» — d20+2.</div>}
                {list.map((c, i) => (
                  <div key={c.id} className={`gm-init${i === turn ? ' now' : ''}${c.ally ? ' ally' : ''}`}>
                    <input className="input gm-init-n" type="number" value={c.init} aria-label="Инициатива"
                      onChange={(e) => patch(c.id, { init: Number(e.target.value) || 0 })} />
                    <span className="gm-init-name" title={c.ally ? 'Союзник' : 'Противник'}>{c.ally ? '◆' : '◇'} {c.name}</span>
                    <input className="input gm-init-hp" value={c.hp} placeholder="ХП" aria-label="Хиты"
                      onChange={(e) => patch(c.id, { hp: e.target.value.slice(0, 20) })} />
                    <input className="input gm-init-note" value={c.note} placeholder="статусы…" aria-label="Заметка"
                      onChange={(e) => patch(c.id, { note: e.target.value.slice(0, 200) })} />
                    <button className="icon-btn danger" onClick={() => remove(c.id)} aria-label="Убрать">✕</button>
                  </div>
                ))}
              </div>
              <form className="gm-row" onSubmit={addCombatant}>
                <input className="input" style={{ flex: 2 }} value={form.name} placeholder="Имя" aria-label="Имя"
                  onChange={(e) => setForm({ ...form, name: e.target.value })} />
                <input className="input" style={{ flex: 1 }} value={form.init} placeholder="Иниц." aria-label="Инициатива"
                  onChange={(e) => setForm({ ...form, init: e.target.value })} />
                <input className="input" style={{ flex: 1 }} value={form.hp} placeholder="ХП" aria-label="Хиты"
                  onChange={(e) => setForm({ ...form, hp: e.target.value })} />
                <label className="gm-ally" title="Союзник"><input type="checkbox" checked={form.ally} onChange={(e) => setForm({ ...form, ally: e.target.checked })} />◆</label>
                <button className="btn" type="submit">＋</button>
              </form>
              {err && <div className="gm-err">{err}</div>}
              {list.length > 0 && (
                <div className="gm-row">
                  <button className="btn btn-sm" onClick={() => update((t) => ({ ...t, turn: 0, round: 1 }))}>Новый бой (раунд 1)</button>
                  <button className="btn btn-sm danger" onClick={() => update((t) => ({ ...t, combatants: t.combatants.filter((c) => c.ally), turn: 0, round: 1 }))}>Убрать противников</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
