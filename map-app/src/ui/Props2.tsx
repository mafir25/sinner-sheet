// Настройки инструментов этапа 2 (кисть, путь, свет, подпись, крыша) и свойства выделенных путей, света, подписей, крыш.
import { useEffect, useState } from 'react';
import type { AssetStore } from '../assets/store';
import type { Floor, Label, Light, MapPath, PathStyle, Roof } from '../model/types';
import type { Editor } from '../state/editor';
import { tr } from '../i18n';
import { AssetPicker, ColorInput, Field, NumInput, Slider } from './common';

type LightStyle = Omit<Light, 'id' | 'x' | 'y'>;
type LabelStyle = Omit<Label, 'id' | 'x' | 'y' | 'text' | 'rot'>;

// ---------- кисть
export function BrushPanel({ ed, assets }: { ed: Editor; assets: AssetStore }) {
  const b = ed.state.settings.brush;
  const set = (patch: Partial<typeof b>) => ed.setSettings({ brush: { ...b, ...patch } });
  return (
    <div className="stack">
      <div className="seg">
        <button className={!b.erase ? 'on' : ''} onClick={() => set({ erase: false })}>🖌 {tr('Кисть')}</button>
        <button className={b.erase ? 'on' : ''} onClick={() => set({ erase: true })}>⌫ {tr('Ластик')}</button>
      </div>
      <Field label={tr('Текстура')}>
        <AssetPicker assets={assets} kind="terrain" value={b.asset} onChange={(asset) => set({ asset, erase: false })} />
      </Field>
      <Field label={tr('Текстуры полов тоже подходят')}>
        <AssetPicker assets={assets} kind="floor" value={b.asset} onChange={(asset) => set({ asset, erase: false })} />
      </Field>
      <Field label={tr('Размер кисти')}><Slider value={b.size} min={0.25} max={12} step={0.25} onCommit={(size) => set({ size })} /></Field>
      <Field label={tr('Мягкость края')}><Slider value={b.softness} onCommit={(softness) => set({ softness })} /></Field>
      <Field label={tr('Непрозрачность')}><Slider value={b.opacity} min={0.05} onCommit={(opacity) => set({ opacity })} /></Field>
      <p className="hint">{tr('Alt — временно ластик. Кисть рисует поверх полов, под стенами и объектами.')}</p>
      <GroundPicker ed={ed} assets={assets} />
    </div>
  );
}

/** Текстура под всем этажом (улица, пустырь). */
function GroundPicker({ ed, assets }: { ed: Editor; assets: AssetStore }) {
  const ground = ed.floor.ground;
  const set = (k: string | null) => ed.commitFloor((f) => { f.ground = k; });
  return (
    <Field label={tr('Земля под всем этажом')}>
      <AssetPicker assets={assets} kind="floor" value={ground} allowNone noneLabel={tr('Без земли')} onChange={set} />
      <AssetPicker assets={assets} kind="terrain" value={ground} onChange={set} />
    </Field>
  );
}

// ---------- пути
const PRESETS: { name: string; style: Partial<PathStyle>; smooth?: boolean }[] = [
  { name: 'Дорога', style: { width: 3, asset: 'canon:floors/asphalt.svg', color: '#2a2b2e', outline: '#141416', dash: 0, decor: null } },
  { name: 'Разметка', style: { width: 0.12, asset: null, color: '#e8e1d2', outline: null, dash: 0.8, decor: null } },
  { name: 'Тропа', style: { width: 1.2, asset: 'canon:terrain/dirt.svg', color: '#4a3b2c', outline: null, dash: 0, decor: null } },
  { name: 'Труба', style: { width: 0.4, asset: null, color: '#6e767f', outline: '#2a2e33', dash: 0, decor: null } },
  { name: 'Провод', style: { width: 0.06, asset: null, color: '#111111', outline: null, dash: 0, decor: null } },
  { name: 'Забор', style: { width: 0, asset: null, outline: null, dash: 0, decor: 'canon:objects/linear/fence.svg', spacing: 1 }, smooth: false },
  { name: 'Рельсы', style: { width: 0, asset: null, outline: null, dash: 0, decor: 'canon:objects/linear/rail.svg', spacing: 1 } },
  { name: 'Отбойник', style: { width: 0, asset: null, outline: null, dash: 0, decor: 'canon:objects/linear/barrier.svg', spacing: 1 }, smooth: false },
];

export function PathStyleEditor({ assets, value, onChange }: { assets: AssetStore; value: PathStyle; onChange(v: PathStyle): void }) {
  const set = (patch: Partial<PathStyle>) => onChange({ ...value, ...patch });
  return (
    <div className="stack">
      <div className="row">
        <Field label={tr('Ширина')} row><NumInput value={value.width} step={0.1} min={0} max={50} onCommit={(width) => set({ width })} /></Field>
        <Field label={tr('Цвет')} row><ColorInput value={value.color} onCommit={(color) => set({ color })} /></Field>
      </div>
      <Field label={tr('Текстура')}>
        <AssetPicker assets={assets} kind="floor" value={value.asset} allowNone noneLabel={tr('Без текстуры')} onChange={(asset) => set({ asset })} />
        <AssetPicker assets={assets} kind="terrain" value={value.asset} onChange={(asset) => set({ asset })} />
      </Field>
      <div className="row">
        <Field label={tr('Пунктир')} row><NumInput value={value.dash} step={0.1} min={0} max={20} onCommit={(dash) => set({ dash })} /></Field>
        <Field label={tr('Обводка')} row>
          <span className="row">
            <input type="checkbox" checked={!!value.outline} onChange={(e) => set({ outline: e.target.checked ? '#111111' : null })} />
            {value.outline && <ColorInput value={value.outline} onCommit={(outline) => set({ outline })} />}
          </span>
        </Field>
      </div>
      <Field label={tr('Объекты вдоль пути')}>
        <div className="picker-scroll">
          <AssetPicker assets={assets} kind="object" value={value.decor} allowNone noneLabel={tr('Без объектов')} onChange={(decor) => set({ decor })} />
        </div>
      </Field>
      {value.decor && <Field label={tr('Шаг объектов')} row><NumInput value={value.spacing} step={0.25} min={0.1} max={50} onCommit={(spacing) => set({ spacing })} /></Field>}
    </div>
  );
}

export function PathPanel({ ed, assets }: { ed: Editor; assets: AssetStore }) {
  const p = ed.state.settings.path;
  return (
    <div className="stack">
      <Field label={tr('Заготовки')}>
        <div className="row wrap">
          {PRESETS.map((pr) => (
            <button key={pr.name} className="btn btn-sm"
              onClick={() => ed.setSettings({ path: { style: { ...p.style, ...pr.style }, smooth: pr.smooth ?? true } })}>{tr(pr.name)}</button>
          ))}
        </div>
      </Field>
      <label className="check"><input type="checkbox" checked={p.smooth} onChange={(e) => ed.setSettings({ path: { ...p, smooth: e.target.checked } })} /> {tr('Сглаживать')}</label>
      <PathStyleEditor assets={assets} value={p.style} onChange={(style) => ed.setSettings({ path: { ...p, style } })} />
      <p className="hint">{tr('Путь рисуется в текущем слое: дорогу — в «Декор пола», провода — в «Над стенами».')}</p>
    </div>
  );
}

// ---------- свет
export function LightEditor({ value, onChange }: { value: LightStyle; onChange(v: LightStyle): void }) {
  const set = (patch: Partial<LightStyle>) => onChange({ ...value, ...patch });
  return (
    <div className="stack">
      <div className="row">
        <Field label={tr('Радиус')} row><NumInput value={value.radius} step={0.5} min={0.5} max={100} onCommit={(radius) => set({ radius })} /></Field>
        <Field label={tr('Цвет')} row><ColorInput value={value.color} onCommit={(color) => set({ color })} /></Field>
      </div>
      <Field label={tr('Яркость')}><Slider value={value.intensity} min={0.05} onCommit={(intensity) => set({ intensity })} /></Field>
      <label className="check"><input type="checkbox" checked={value.shadows} onChange={(e) => set({ shadows: e.target.checked })} /> {tr('Тени от стен')}</label>
    </div>
  );
}

export function LightPanel({ ed }: { ed: Editor }) {
  return (
    <div className="stack">
      <LightEditor value={ed.state.settings.light} onChange={(light) => ed.setSettings({ light })} />
      <LightingSettings ed={ed} />
    </div>
  );
}

/** Освещение всей карты. */
export function LightingSettings({ ed }: { ed: Editor }) {
  const l = ed.doc.lighting;
  const set = (patch: Partial<typeof l>) => ed.commit((d) => { d.lighting = { ...d.lighting, ...patch }; });
  return (
    <section className="subsec stack">
      <h3>{tr('Освещение карты')}</h3>
      <label className="check"><input type="checkbox" checked={l.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> {tr('Темнота и свет')}</label>
      {l.enabled && (
        <>
          <Field label={tr('Темнота')}><Slider value={l.darkness} onCommit={(darkness) => set({ darkness })} /></Field>
          <Field label={tr('Цвет темноты')} row><ColorInput value={l.color} onCommit={(color) => set({ color })} /></Field>
        </>
      )}
      <label className="check"><input type="checkbox" checked={l.wallShadows} onChange={(e) => set({ wallShadows: e.target.checked })} /> {tr('Мягкие тени под стенами')}</label>
    </section>
  );
}

// ---------- подписи
export function LabelStyleEditor({ value, onChange }: { value: LabelStyle; onChange(v: LabelStyle): void }) {
  const set = (patch: Partial<LabelStyle>) => onChange({ ...value, ...patch });
  return (
    <div className="stack">
      <div className="row">
        <Field label={tr('Размер')} row><NumInput value={value.size} step={0.1} min={0.1} max={20} onCommit={(size) => set({ size })} /></Field>
        <Field label={tr('Цвет')} row><ColorInput value={value.color} onCommit={(color) => set({ color })} /></Field>
      </div>
      <div className="seg">
        <button className={value.font === 'head' ? 'on' : ''} onClick={() => set({ font: 'head' })}>Oswald</button>
        <button className={value.font === 'body' ? 'on' : ''} onClick={() => set({ font: 'body' })}>Inter</button>
      </div>
      <label className="check"><input type="checkbox" checked={value.box} onChange={(e) => set({ box: e.target.checked })} /> {tr('Подложка')}</label>
      <label className="check"><input type="checkbox" checked={value.gmOnly} onChange={(e) => set({ gmOnly: e.target.checked })} /> {tr('Только для мастера')}</label>
    </div>
  );
}

export function LabelPanel({ ed }: { ed: Editor }) {
  const s = ed.state.settings.label;
  const { numbering, next, ...style } = s;
  return (
    <div className="stack">
      <label className="check"><input type="checkbox" checked={numbering}
        onChange={(e) => ed.setSettings({ label: { ...s, numbering: e.target.checked, gmOnly: e.target.checked ? true : s.gmOnly, box: e.target.checked ? true : s.box } })} /> {tr('Номера комнат: 1, 2, 3…')}</label>
      {numbering && <Field label={tr('Следующий номер')} row><NumInput value={next} step={1} min={0} digits={0} onCommit={(v) => ed.setSettings({ label: { ...s, next: Math.round(v) } })} /></Field>}
      <LabelStyleEditor value={style} onChange={(v) => ed.setSettings({ label: { ...s, ...v } })} />
    </div>
  );
}

function TextArea({ value, onCommit }: { value: string; onCommit(v: string): void }) {
  const [t, setT] = useState(value);
  useEffect(() => setT(value), [value]);
  return <textarea className="input" rows={2} value={t} onChange={(e) => setT(e.target.value)} onBlur={() => { if (t.trim() && t !== value) onCommit(t); else setT(value); }} />;
}

// ---------- крыши
export function RoofPanel({ ed, assets }: { ed: Editor; assets: AssetStore }) {
  const r = ed.state.settings.roof;
  return (
    <div className="stack">
      <RoofEditor assets={assets} value={r} onChange={(roof) => ed.setSettings({ roof })} />
      <p className="hint">{tr('Щелчок по комнате — крыша по её форме. Протянуть — прямоугольная крыша.')}</p>
    </div>
  );
}

function RoofEditor({ assets, value, onChange }: { assets: AssetStore; value: Pick<Roof, 'asset' | 'color'>; onChange(v: Pick<Roof, 'asset' | 'color'>): void }) {
  return (
    <div className="stack">
      <Field label={tr('Кровля')}>
        <AssetPicker assets={assets} kind="roof" value={value.asset} allowNone noneLabel={tr('Без текстуры')} onChange={(asset) => onChange({ ...value, asset })} />
      </Field>
      <Field label={tr('Цвет')} row><ColorInput value={value.color} onCommit={(color) => onChange({ ...value, color })} /></Field>
    </div>
  );
}

// ---------- свойства выделенного
export function SelectionExtras({ ed, assets }: { ed: Editor; assets: AssetStore }) {
  const ids = new Set(ed.state.sel.map((s) => s.id));
  const paths = ed.selected('path'), lights = ed.selected('light'), labels = ed.selected('label'), roofs = ed.selected('roof');
  const upd = <T extends { id: string }>(list: (f: Floor) => T[], patch: (x: T) => void) =>
    ed.commitFloor((f) => { for (const x of list(f)) if (ids.has(x.id)) patch(x); });
  return (
    <>
      {paths.length > 0 && (
        <>
          <PathStyleEditor assets={assets} value={paths[0].style}
            onChange={(style) => upd((f) => f.paths, (p: MapPath) => { p.style = { ...style }; })} />
          <div className="row wrap">
            <label className="check"><input type="checkbox" checked={paths[0].smooth}
              onChange={(e) => upd((f) => f.paths, (p: MapPath) => { p.smooth = e.target.checked; })} /> {tr('Сглаживать')}</label>
            <label className="check"><input type="checkbox" checked={paths[0].closed}
              onChange={(e) => upd((f) => f.paths, (p: MapPath) => { p.closed = e.target.checked; })} /> {tr('Замкнуть')}</label>
          </div>
          <Field label={tr('Слой')}>
            <select className="input" value={paths[0].layer} onChange={(e) => { const layer = e.target.value; upd((f) => f.paths, (p: MapPath) => { p.layer = layer; }); }}>
              {ed.floor.layers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
        </>
      )}
      {lights.length > 0 && (() => {
        const { id: _i, x: _x, y: _y, ...style } = lights[0];
        return <LightEditor value={style} onChange={(v) => upd((f) => f.lights, (l: Light) => { Object.assign(l, v); })} />;
      })()}
      {labels.length > 0 && (() => {
        const { id: _i, x: _x, y: _y, text, rot, ...style } = labels[0];
        return (
          <>
            {labels.length === 1 && <Field label={tr('Текст')}><TextArea value={text} onCommit={(t) => upd((f) => f.labels, (l: Label) => { l.text = t; })} /></Field>}
            <LabelStyleEditor value={style} onChange={(v) => upd((f) => f.labels, (l: Label) => { Object.assign(l, v); })} />
            <Field label={tr('Поворот')} row><NumInput value={rot} step={15} digits={1} onCommit={(v) => upd((f) => f.labels, (l: Label) => { l.rot = ((v % 360) + 360) % 360; })} /></Field>
          </>
        );
      })()}
      {roofs.length > 0 && (
        <RoofEditor assets={assets} value={roofs[0]} onChange={(v) => upd((f) => f.roofs, (r: Roof) => { r.asset = v.asset; r.color = v.color; })} />
      )}
    </>
  );
}
