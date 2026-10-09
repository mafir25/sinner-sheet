// Окна: экспорт, настройки карты, управление.
import { useState } from 'react';
import type { AssetStore } from '../assets/store';
import type { Editor } from '../state/editor';
import type { GridType } from '../model/types';
import { type ExportFormat, type ExportOpts, MAX_SIDE, exportMap, fits } from '../export/export';
import { download } from '../storage/file';
import { tr } from '../i18n';
import { Field, Modal, NumInput, toast } from './common';

const PPC = [50, 70, 100, 140, 200, 256];
const LS_KEY = 'maps.export';

function loadOpts(): ExportOpts {
  const def: ExportOpts = { format: 'png', ppc: 70, grid: false, floors: 'current', windows: 'gap', quality: 0.9 };
  try { return { ...def, ...JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') }; } catch { return def; }
}

export function ExportDialog({ ed, assets, onClose }: { ed: Editor; assets: AssetStore; onClose(): void }) {
  const [o, setO] = useState<ExportOpts>(loadOpts);
  const [busy, setBusy] = useState(false);
  const doc = ed.doc;
  const set = (patch: Partial<ExportOpts>) => setO((x) => ({ ...x, ...patch }));
  const ok = fits(doc, o.ppc);

  const run = async () => {
    setBusy(true);
    try { localStorage.setItem(LS_KEY, JSON.stringify(o)); } catch { /* приватный режим */ }
    try {
      const { blob, filename } = await exportMap(doc, ed.state.floorId, assets, o);
      download(blob, filename);
      toast(tr('Готово: {0}', filename));
      onClose();
    } catch (e) {
      console.error(e);
      toast(tr('Не удалось сохранить: {0}', String(e)), 'error');
    } finally { setBusy(false); }
  };

  return (
    <Modal title={tr('Экспорт карты')} onClose={onClose}>
      <div className="stack">
        <Field label={tr('Формат')}>
          <select className="input" value={o.format} onChange={(e) => set({ format: e.target.value as ExportFormat })}>
            <option value="png">{tr('Картинка PNG')}</option>
            <option value="jpg">{tr('Картинка JPG')}</option>
            <option value="webp">{tr('Картинка WebP')}</option>
            <option value="dd2vtt">{tr('Universal VTT (.dd2vtt) — стены и двери для Foundry и др.')}</option>
          </select>
        </Field>
        <Field label={tr('Пикселей на клетку')}>
          <div className="seg">
            {PPC.map((p) => <button key={p} className={o.ppc === p ? 'on' : ''} onClick={() => set({ ppc: p })}>{p}</button>)}
          </div>
          <span className="hint">{tr('70 — стандарт Roll20')}</span>
        </Field>
        {doc.floors.length > 1 && (
          <Field label={tr('Этаж')}>
            <div className="seg">
              <button className={o.floors === 'current' ? 'on' : ''} onClick={() => set({ floors: 'current' })}>{tr('Текущий этаж')}</button>
              <button className={o.floors === 'all' ? 'on' : ''} onClick={() => set({ floors: 'all' })}>{tr('Все этажи (ZIP)')}</button>
            </div>
          </Field>
        )}
        <label className="check"><input type="checkbox" checked={o.grid} onChange={(e) => set({ grid: e.target.checked })} /> {tr('Рисовать сетку на картинке')}</label>
        {(o.format === 'jpg' || o.format === 'webp') && (
          <Field label={tr('Качество')} row><NumInput value={o.quality} step={0.05} min={0.3} max={1} onCommit={(quality) => set({ quality })} /></Field>
        )}
        {o.format === 'dd2vtt' && (
          <>
            <Field label={tr('Окна в .dd2vtt')}>
              <select className="input" value={o.windows} onChange={(e) => set({ windows: e.target.value as ExportOpts['windows'] })}>
                <option value="gap">{tr('Пропускают взгляд (разрыв в стене)')}</option>
                <option value="wall">{tr('Как стена')}</option>
                <option value="door">{tr('Как дверь')}</option>
              </select>
            </Field>
            {doc.grid.type.startsWith('hex') && <p className="hint">{tr('Шестиугольная сетка в .dd2vtt не описывается — в VTT включи гексы вручную.')}</p>}
          </>
        )}
        <p className={ok ? 'hint' : 'err'}>
          {ok ? tr('Размер картинки: {0} × {1} px', doc.width * o.ppc, doc.height * o.ppc)
            : tr('Слишком большая картинка для браузера (больше {0} px по стороне). Уменьши размер клетки.', MAX_SIDE)}
        </p>
        <div className="row end">
          <button className="btn" onClick={onClose}>{tr('Отмена')}</button>
          <button className="btn btn-primary" disabled={!ok || busy} onClick={run}>{busy ? tr('Экспорт…') : tr('Экспортировать')}</button>
        </div>
      </div>
    </Modal>
  );
}

export function GridSelect({ value, onChange }: { value: GridType; onChange(v: GridType): void }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value as GridType)}>
      <option value="square">{tr('Квадратная')}</option>
      <option value="hex-flat">{tr('Гексы (плоские)')}</option>
      <option value="hex-pointy">{tr('Гексы (острые)')}</option>
      <option value="none">{tr('Без сетки')}</option>
    </select>
  );
}

export function MapSettings({ ed, onClose }: { ed: Editor; onClose(): void }) {
  const d = ed.doc;
  const [name, setName] = useState(d.name);
  const [w, setW] = useState(d.width);
  const [h, setH] = useState(d.height);
  const [bg, setBg] = useState(d.background);
  const [grid, setGrid] = useState(d.grid);
  const apply = () => {
    ed.commit((x) => {
      x.name = name.trim() || x.name;
      x.width = w; x.height = h; x.background = bg; x.grid = { ...grid };
    });
    onClose();
  };
  return (
    <Modal title={tr('Настройки карты')} onClose={onClose}>
      <div className="stack">
        <Field label={tr('Название')}><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="row">
          <Field label={tr('Ширина (клеток)')} row><NumInput value={w} step={1} min={1} max={500} digits={0} onCommit={(v) => setW(Math.round(v))} /></Field>
          <Field label={tr('Высота (клеток)')} row><NumInput value={h} step={1} min={1} max={500} digits={0} onCommit={(v) => setH(Math.round(v))} /></Field>
        </div>
        <p className="hint">{tr('Содержимое за пределами карты не удаляется, но не попадёт в экспорт.')}</p>
        <Field label={tr('Фон')} row><input type="color" value={bg} onChange={(e) => setBg(e.target.value)} /></Field>
        <Field label={tr('Сетка')}><GridSelect value={grid.type} onChange={(type) => setGrid({ ...grid, type })} /></Field>
        <label className="check"><input type="checkbox" checked={grid.show} onChange={(e) => setGrid({ ...grid, show: e.target.checked })} /> {tr('Показывать сетку')}</label>
        <div className="row">
          <Field label={tr('Цвет сетки')} row><input type="color" value={grid.color} onChange={(e) => setGrid({ ...grid, color: e.target.value })} /></Field>
          <Field label={tr('Непрозрачность сетки')} row><NumInput value={grid.opacity} step={0.05} min={0} max={1} onCommit={(opacity) => setGrid({ ...grid, opacity })} /></Field>
        </div>
        <div className="row end">
          <button className="btn" onClick={onClose}>{tr('Отмена')}</button>
          <button className="btn btn-primary" onClick={apply}>{tr('Применить')}</button>
        </div>
      </div>
    </Modal>
  );
}

const KEYS: [string, string][] = [
  ['V', 'Выделение'],
  ['B / P', 'Комната прямоугольником / многоугольником (Alt — вырезать)'],
  ['W', 'Стена'],
  ['D / O', 'Дверь / окно'],
  ['H, Space, 🖱 ⊙', 'Панорама'],
  ['Колесо / щипок', 'Масштаб'],
  ['Ctrl', 'Без привязки к сетке'],
  ['Q / E', 'Поворот на 15° (Shift — 90°)'],
  ['F', 'Отразить'],
  ['← ↑ → ↓', 'Сдвиг на клетку (Shift — на 1/4)'],
  ['Ctrl+Z / Ctrl+Y', 'Отмена / повтор'],
  ['Ctrl+C / V / D', 'Копировать / вставить / дублировать'],
  ['Delete', 'Удалить выделенное'],
  ['Ctrl+S', 'Сохранить файл'],
];

export function Help({ onClose }: { onClose(): void }) {
  return (
    <Modal title={tr('Управление')} onClose={onClose}>
      <table className="keys"><tbody>
        {KEYS.map(([k, v]) => <tr key={k}><td><kbd>{k === 'Колесо / щипок' ? tr(k) : k}</kbd></td><td>{tr(v)}</td></tr>)}
      </tbody></table>
      <p className="hint" style={{ marginTop: 12 }}>{tr('На планшете: два пальца — панорама и масштаб; кнопки «Привязка» и «Вырезать» внизу заменяют Ctrl и Alt.')}</p>
    </Modal>
  );
}
