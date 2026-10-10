// Окна: экспорт, настройки карты, управление.
import { useState } from 'react';
import type { AssetStore } from '../assets/store';
import type { Editor } from '../state/editor';
import type { GridType } from '../model/types';
import { type ExportFormat, type ExportOpts, MAX_SIDE, exportMap, fits } from '../export/export';
import { download, pickFile } from '../storage/file';
import { tr } from '../i18n';
import { Field, Modal, NumInput, toast, useStore } from './common';
import { useEditor } from '../state/editor';
import { type Anchor, resizeDoc } from '../geom/ops';

const PPC = [50, 70, 100, 140, 200, 256];
const LS_KEY = 'maps.export';

function loadOpts(): ExportOpts {
  const def: ExportOpts = { format: 'png', ppc: 70, grid: false, floors: 'current', windows: 'gap', quality: 0.9, roofs: false, bakeLight: true, gm: false };
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
        <Field label={tr('Версия')}>
          <div className="seg">
            <button className={!o.gm ? 'on' : ''} onClick={() => set({ gm: false })}>{tr('Для игроков')}</button>
            <button className={o.gm ? 'on' : ''} onClick={() => set({ gm: true })}>{tr('Мастерская')}</button>
          </div>
          <span className="hint">{tr('Мастерская версия добавляет подписи и слои «только для мастера».')}</span>
        </Field>
        <label className="check"><input type="checkbox" checked={o.grid} onChange={(e) => set({ grid: e.target.checked })} /> {tr('Рисовать сетку на картинке')}</label>
        {doc.floors.some((f) => f.roofs.length) && (
          <label className="check"><input type="checkbox" checked={o.roofs} onChange={(e) => set({ roofs: e.target.checked })} /> {tr('С крышами (вид снаружи)')}</label>
        )}
        {doc.lighting.enabled && (
          <label className="check"><input type="checkbox" checked={o.bakeLight} onChange={(e) => set({ bakeLight: e.target.checked })} /> {tr('Запечь освещение в картинку')}</label>
        )}
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
            <p className="hint">{tr('Источники света уходят в .dd2vtt всегда. Если VTT сам считает свет — выключи запекание, чтобы не было двойной темноты.')}</p>
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

export function MapSettings({ ed, assets, onClose }: { ed: Editor; assets: AssetStore; onClose(): void }) {
  const d = ed.doc;
  const [name, setName] = useState(d.name);
  const [w, setW] = useState(d.width);
  const [h, setH] = useState(d.height);
  const [bg, setBg] = useState(d.background);
  const [grid, setGrid] = useState(d.grid);
  const [anchor, setAnchor] = useState<Anchor>({ col: 0, row: 0 });
  const resized = w !== d.width || h !== d.height;
  const apply = () => {
    ed.commit((x) => {
      x.name = name.trim() || x.name;
      x.background = bg; x.grid = { ...grid };
      if (resized) Object.assign(x, resizeDoc(x, w, h, anchor));
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
        {resized && <AnchorPicker value={anchor} onChange={setAnchor} />}
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
        <FloorImageSettings ed={ed} assets={assets} onFit={(fw, fh) => { setW(fw); setH(fh); toast(tr('Размер {0} × {1} — нажми «Применить»', fw, fh)); }} />
      </div>
    </Modal>
  );
}

/** Якорь изменения размера: какая часть карты остаётся на месте, поле добавляется с других сторон. */
function AnchorPicker({ value, onChange }: { value: Anchor; onChange(a: Anchor): void }) {
  const ARROWS = [['↖', '↑', '↗'], ['←', '•', '→'], ['↙', '↓', '↘']];
  return (
    <Field label={tr('Что остаётся на месте')}>
      <div className="row">
        <div className="anchor">
          {([0, 1, 2] as const).map((row) => ([0, 1, 2] as const).map((col) => {
            const on = value.col === col && value.row === row;
            return <button key={`${row}${col}`} type="button" className={on ? 'on' : ''} aria-pressed={on}
              title={tr('Якорь')} onClick={() => onChange({ col, row })}>{on ? '■' : ARROWS[row][col]}</button>;
          }))}
        </div>
        <span className="hint">{tr('Новое поле добавится с противоположной стороны, всё нарисованное сдвинется вместе с картой.')}</span>
      </div>
    </Field>
  );
}

/** Картинка-подложка текущего этажа: готовая карта или скан, подгоняется под сетку. Хранится в браузере и в .pmmap. */
function FloorImageSettings({ ed, assets, onFit }: { ed: Editor; assets: AssetStore; onFit(w: number, h: number): void }) {
  useStore(assets);
  useEditor(ed, (s) => s.doc);
  const f = ed.floor;
  const img = f.image;
  const im = img ? assets.rawImage(img.asset) : null;
  const set = (patch: Partial<NonNullable<typeof img>>) => ed.commitFloor((fl) => { if (fl.image) fl.image = { ...fl.image, ...patch }; });
  const pick = async () => {
    const file = await pickFile('image/png,image/jpeg,image/webp');
    if (!file) return;
    try {
      const pack = await assets.addLocalPack(tr('Фон: {0}', file.name), [{ path: file.name, blob: file }]);
      if (!pack) return;
      const size = pack.assets[0];
      const key = assets.key(pack.id, size.path);
      // по умолчанию картинка растягивается на ширину карты
      const ppc = (size.footprint[0] * 256) / ed.doc.width;
      ed.commitFloor((fl) => { fl.image = { asset: key, x: 0, y: 0, ppc: Math.max(1, Math.round(ppc * 100) / 100), opacity: 1 }; });
    } catch (e) { toast(tr('В браузере нет места: {0}', String(e)), 'error'); }
  };
  return (
    <section className="subsec stack">
      <h3>{tr('Фон-картинка этажа «{0}»', f.name)}</h3>
      <p className="hint">{tr('Готовая карта или скан под сеткой. Картинка остаётся в браузере и в файле .pmmap.')}</p>
      <div className="row wrap">
        <button className="btn btn-sm" onClick={pick}>{img ? tr('Заменить картинку') : tr('Выбрать картинку')}</button>
        {img && <button className="btn btn-sm btn-danger" onClick={() => ed.commitFloor((fl) => { fl.image = null; })}>{tr('Убрать')}</button>}
      </div>
      {img && (
        <>
          <div className="row">
            <Field label={tr('Пикселей на клетку')} row><NumInput value={img.ppc} step={1} min={1} max={2000} onCommit={(ppc) => set({ ppc })} /></Field>
            <Field label={tr('Прозрачность')} row><NumInput value={img.opacity} step={0.1} min={0} max={1} onCommit={(opacity) => set({ opacity })} /></Field>
          </div>
          <div className="row">
            <Field label={tr('Сдвиг X')} row><NumInput value={img.x} step={0.05} min={-500} max={500} onCommit={(x) => set({ x })} /></Field>
            <Field label={tr('Сдвиг Y')} row><NumInput value={img.y} step={0.05} min={-500} max={500} onCommit={(y) => set({ y })} /></Field>
          </div>
          {im && (
            <>
              <p className="hint">{tr('Картинка {0} × {1} px = {2} × {3} клеток', im.naturalWidth, im.naturalHeight,
                Math.round((im.naturalWidth / img.ppc) * 100) / 100, Math.round((im.naturalHeight / img.ppc) * 100) / 100)}</p>
              <button className="btn btn-sm" onClick={() => onFit(
                Math.max(1, Math.min(500, Math.ceil(img.x + im.naturalWidth / img.ppc))),
                Math.max(1, Math.min(500, Math.ceil(img.y + im.naturalHeight / img.ppc))),
              )}>{tr('Подогнать размер карты под картинку')}</button>
            </>
          )}
        </>
      )}
    </section>
  );
}

const KEYS: [string, string][] = [
  ['V', 'Выделение'],
  ['B / P', 'Комната прямоугольником / многоугольником (Alt — вырезать)'],
  ['W', 'Стена'],
  ['D / O', 'Дверь / окно'],
  ['X', 'Убрать стену (щелчок — целиком, протяжка — участок)'],
  ['H, Space, 🖱 ⊙', 'Панорама'],
  ['Колесо / щипок', 'Масштаб'],
  ['Ctrl', 'Без привязки к сетке'],
  ['Q / E', 'Поворот на 15° (Shift — 90°)'],
  ['F', 'Отразить'],
  ['← ↑ → ↓', 'Сдвиг на клетку (Shift — на 1/4)'],
  ['Ctrl+Z / Ctrl+Y', 'Отмена / повтор'],
  ['Ctrl+C / V / D', 'Копировать / вставить / дублировать'],
  ['G / C', 'Кисть местности / путь'],
  ['L / T / R', 'Свет / подпись / крыша'],
  ['M', 'Линейка: расстояние в клетках и футах'],
  ['Alt', 'Ластик (кисть), вырезать (комнаты), объект без правил размещения'],
  ['Delete', 'Удалить выделенное'],
  ['Ctrl+S', 'Сохранить файл'],
  ['Tab', 'Спрятать или показать боковые панели'],
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
