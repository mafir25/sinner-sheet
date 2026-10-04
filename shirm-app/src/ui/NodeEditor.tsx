// Редактор узла и рамки.
import { useRef, useState } from 'react';
import { Modal } from './dialogs';
import { renderMarkdown } from '../model/markdown';
import { type FrameItem, type NodeItem, type Section, emptySection, parseItem } from '../model/schema';

// ---------------------------------------------------------------- поле markdown с панелью
export function MarkdownField({ value, onChange, rows = 6, placeholder }: {
  value: string; onChange: (v: string) => void; rows?: number; placeholder?: string;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);
  const [color, setColor] = useState('#C7243A');
  const wrap = (pre: string, post = '') => {
    const el = ta.current; if (!el) return;
    const a = el.selectionStart, b = el.selectionEnd;
    const next = value.slice(0, a) + pre + value.slice(a, b) + post + value.slice(b);
    onChange(next);
    requestAnimationFrame(() => { el.focus(); el.selectionStart = a + pre.length; el.selectionEnd = b + pre.length; });
  };
  return (
    <div className="mdfield">
      <div className="md-toolbar">
        <button type="button" title="Жирный" onClick={() => wrap('**', '**')}><b>Ж</b></button>
        <button type="button" title="Курсив" onClick={() => wrap('*', '*')}><i>К</i></button>
        <button type="button" title="Заголовок" onClick={() => wrap('\n### ')}>H</button>
        <button type="button" title="Список" onClick={() => wrap('\n- ')}>•</button>
        <button type="button" title="Цитата" onClick={() => wrap('\n> ')}>❝</button>
        <button type="button" title="Таблица" onClick={() => wrap('\n| Столбец | Столбец |\n|---|---|\n| | |\n')}>▦</button>
        <button type="button" title="Картинка по ссылке" onClick={() => wrap('![](', ')')}>🖼</button>
        <span className="sep" />
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} title="Цвет текста" />
        <button type="button" title="Покрасить выделенное" onClick={() => wrap(`{${color}}`, '{}')}>🎨</button>
        <span className="grow" />
        <button type="button" className={preview ? 'on' : ''} onClick={() => setPreview(!preview)}>{preview ? 'Текст' : 'Предпросмотр'}</button>
      </div>
      {preview
        ? <div className="md md-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(value) }} />
        : <textarea ref={ta} className="input" rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}

const csv = (a: string[]) => a.join(', ');
const uncsv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

// ---------------------------------------------------------------- подблоки
function SectionsEditor({ list, onChange, depth = 0 }: { list: Section[]; onChange: (l: Section[]) => void; depth?: number }) {
  const upd = (i: number, s: Section) => onChange(list.map((x, j) => (j === i ? s : x)));
  const move = (i: number, d: number) => {
    const j = i + d; if (j < 0 || j >= list.length) return;
    const l = [...list]; [l[i], l[j]] = [l[j], l[i]]; onChange(l);
  };
  return (
    <div className={`sections-editor depth-${Math.min(depth, 3)}`}>
      {list.map((s, i) => (
        <div key={s.id} className="sec-edit">
          <div className="row">
            <input className="input grow" placeholder="Название подблока" value={s.title} onChange={(e) => upd(i, { ...s, title: e.target.value })} />
            <input className="input" style={{ width: 200 }} placeholder="Прозвища через запятую" defaultValue={csv(s.aliases)}
              onBlur={(e) => upd(i, { ...s, aliases: uncsv(e.target.value) })} />
            <button type="button" className="icon-btn" title="Выше" onClick={() => move(i, -1)}>↑</button>
            <button type="button" className="icon-btn" title="Ниже" onClick={() => move(i, 1)}>↓</button>
            <button type="button" className="icon-btn danger" title="Удалить" onClick={() => onChange(list.filter((_, j) => j !== i))}>✕</button>
          </div>
          <MarkdownField value={s.body} rows={3} onChange={(v) => upd(i, { ...s, body: v })} />
          <SectionsEditor list={s.children} depth={depth + 1} onChange={(c) => upd(i, { ...s, children: c })} />
        </div>
      ))}
      <button type="button" className="btn btn-sm" onClick={() => onChange([...list, emptySection()])}>
        + {depth ? 'Вложенный блок' : 'Подблок'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- узел
export function NodeEditor({ node, onSave, onClose }: { node: NodeItem; onSave: (n: NodeItem) => void; onClose: () => void }) {
  const [n, setN] = useState<NodeItem>(node);
  const [tab, setTab] = useState<'form' | 'json'>('form');
  const [json, setJson] = useState('');
  const [err, setErr] = useState('');
  const [formKey, setFormKey] = useState(0);
  const set = (p: Partial<NodeItem>) => setN((x) => ({ ...x, ...p }));

  const toJson = () => { setJson(JSON.stringify(n, null, 2)); setErr(''); setTab('json'); };
  const fromJson = (): NodeItem | null => {
    try {
      const p = parseItem({ ...JSON.parse(json), id: n.id, kind: 'node' });
      if (!p || p.kind !== 'node') { setErr('JSON не похож на узел'); return null; }
      setErr(''); return p;
    } catch (e: any) { setErr('Ошибка в JSON: ' + e.message); return null; }
  };
  const save = () => {
    const v = tab === 'json' ? fromJson() : n;
    if (!v) return;
    if (!v.title.trim()) { setErr('Нужно название'); return; }
    onSave({ ...v, title: v.title.trim() });
  };

  return (
    <Modal title="Узел лора" onClose={onClose} footer={
      <>
        {err && <span className="err">{err}</span>}
        <span className="grow" />
        <button className="btn" onClick={onClose}>Отмена</button>
        <button className="btn btn-primary" onClick={save}>Сохранить</button>
      </>
    }>
      <div className="tabs">
        <button className={tab === 'form' ? 'on' : ''} onClick={() => { if (tab === 'json') { const v = fromJson(); if (v) { setN(v); setFormKey((k) => k + 1); setTab('form'); } } }}>Форма</button>
        <button className={tab === 'json' ? 'on' : ''} onClick={() => tab === 'form' && toJson()}>JSON</button>
      </div>
      {tab === 'json' ? (
        <textarea className="input mono" rows={24} value={json} onChange={(e) => setJson(e.target.value)} />
      ) : (
        <div className="form" key={formKey}>
          <div className="row">
            <label className="grow">Название
              <input className="input" value={n.title} autoFocus onChange={(e) => set({ title: e.target.value })} />
            </label>
            <label>Цвет названия
              <input type="color" value={n.titleColor || n.color} onChange={(e) => set({ titleColor: e.target.value })} />
            </label>
          </div>
          <div className="row">
            <label>Форма
              <select className="input" value={n.shape} onChange={(e) => set({ shape: e.target.value as NodeItem['shape'] })}>
                <option value="circle">Круг</option><option value="square">Квадрат</option><option value="icon">Иконка (только картинка)</option>
              </select>
            </label>
            <label>Цвет
              <input type="color" value={n.color} onChange={(e) => set({ color: e.target.value })} />
            </label>
            <label>Размер: {n.size.toFixed(1)}
              <input type="range" min={0.5} max={3} step={0.1} value={n.size} onChange={(e) => set({ size: Number(e.target.value) })} />
            </label>
            <label className="check"><input type="checkbox" checked={n.hidden} onChange={(e) => set({ hidden: e.target.checked })} /> Скрыт от игроков</label>
          </div>
          <label>Картинка (ссылка)
            <input className="input" value={n.image} placeholder="https://…" onChange={(e) => set({ image: e.target.value.trim() })} />
          </label>
          <label>Прозвища и другие имена (через запятую)
            <input className="input" defaultValue={csv(n.aliases)} onBlur={(e) => set({ aliases: uncsv(e.target.value) })} />
          </label>
          <div className="field">
            <div className="field-title">Теги</div>
            <div className="tags-edit">
              {n.tags.map((t, i) => (
                <span key={i} className="tag-edit">
                  <input type="color" value={t.color} onChange={(e) => set({ tags: n.tags.map((x, j) => j === i ? { ...x, color: e.target.value } : x) })} />
                  <input className="input" value={t.text} onChange={(e) => set({ tags: n.tags.map((x, j) => j === i ? { ...x, text: e.target.value } : x) })} />
                  <button type="button" className="icon-btn danger" onClick={() => set({ tags: n.tags.filter((_, j) => j !== i) })}>✕</button>
                </span>
              ))}
              <button type="button" className="btn btn-sm" onClick={() => set({ tags: [...n.tags, { text: 'Новый', color: n.color }] })}>+ Тег</button>
            </div>
          </div>
          <div className="field">
            <div className="field-title">Описание <span className="hint">markdown, цвет: {'{#hex}'}текст{'{}'}</span></div>
            <MarkdownField value={n.body} rows={8} onChange={(v) => set({ body: v })} />
          </div>
          <div className="field">
            <div className="field-title">Подблоки</div>
            <SectionsEditor list={n.sections} onChange={(l) => set({ sections: l })} />
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- рамка
export function FrameEditor({ frame, onSave, onClose }: { frame: FrameItem; onSave: (f: FrameItem) => void; onClose: () => void }) {
  const [f, setF] = useState(frame);
  const set = (p: Partial<FrameItem>) => setF((x) => ({ ...x, ...p }));
  return (
    <Modal title={f.variant === 'image' ? 'Фоновая картинка' : 'Рамка'} width={520} onClose={onClose} footer={
      <>
        <span className="grow" />
        <button className="btn" onClick={onClose}>Отмена</button>
        <button className="btn btn-primary" onClick={() => onSave(f)}>Сохранить</button>
      </>
    }>
      <div className="form">
        <label>Тип
          <select className="input" value={f.variant} onChange={(e) => set({ variant: e.target.value as FrameItem['variant'] })}>
            <option value="frame">Рамка с названием</option><option value="image">Фоновая картинка</option>
          </select>
        </label>
        {f.variant === 'frame' && (
          <label>Название<input className="input" autoFocus value={f.title} onChange={(e) => set({ title: e.target.value })} /></label>
        )}
        <div className="row">
          <label>Цвет<input type="color" value={f.color} onChange={(e) => set({ color: e.target.value })} /></label>
          <label>Ширина<input className="input" type="number" value={Math.round(f.w)} onChange={(e) => set({ w: Math.max(40, Number(e.target.value)) })} /></label>
          <label>Высота<input className="input" type="number" value={Math.round(f.h)} onChange={(e) => set({ h: Math.max(40, Number(e.target.value)) })} /></label>
          <label className="check"><input type="checkbox" checked={f.hidden} onChange={(e) => set({ hidden: e.target.checked })} /> Скрыта</label>
        </div>
        <label>Картинка (ссылка)<input className="input" value={f.image} placeholder="https://…" onChange={(e) => set({ image: e.target.value.trim() })} /></label>
      </div>
    </Modal>
  );
}
