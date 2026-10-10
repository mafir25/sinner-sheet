// Окно «Генерация» (этап 4): оформить набросок, здание, подземелье, улицы Задворок.
// Результат — одно действие в истории; панель внизу карты перегенерирует его с другим зерном или оставляет.
import { useEffect, useState } from 'react';
import type { District } from '../model/types';
import { loadDistricts } from '../data/world';
import type { AssetStore } from '../assets/store';
import type { Editor } from '../state/editor';
import type { MapDoc } from '../model/types';
import { type BuildingType, BUILDINGS, type StyleId, STYLES, makeKit } from '../gen/kit';
import { type Fill, building, decorate, dungeon, streets } from '../gen/generate';
import { newSeed } from '../gen/rng';
import { lang, nm, tr } from '../i18n';
import { Field, Modal, NumInput, Slider, toast, useStore } from './common';
import { COND_LABEL } from './issues';
import { snapshot } from './Versions';

export type GenTab = 'decorate' | 'building' | 'dungeon' | 'streets';
export type GenState = {
  tab: GenTab; seed: string; pack: string; clear: boolean; fill: Fill;
  style: StyleId; restyle: boolean; doors: boolean; windows: boolean;
  btype: BuildingType; bstyle: StyleId | 'auto'; width: number; height: number; rooms: number; roof: boolean;
  drooms: number; block: number; plazas: number; buildings: boolean; roofs: boolean;
  /** Какие комнаты оформлять (запоминается, чтобы «Другой вариант» оформил те же). */
  targets?: string[];
};

const LS_KEY = 'maps.gen';
const DEF: GenState = {
  tab: 'decorate', seed: '', pack: '*', clear: true,
  fill: { furnish: true, density: 1, cover: 1, traps: 0, weather: true, lights: false, numbers: false, condition: 'style' },
  style: 'backstreets', restyle: true, doors: true, windows: true,
  btype: 'office', bstyle: 'auto', width: 20, height: 14, rooms: 6, roof: false,
  drooms: 7, block: 16, plazas: 0.15, buildings: true, roofs: true,
};
function load(): GenState {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) ?? '{}');
    return { ...DEF, ...s, fill: { ...DEF.fill, ...s.fill }, seed: newSeed() };
  } catch { return { ...DEF, seed: newSeed() }; }
}

/** Запускает генерацию одним действием истории. Возвращает документ-результат (для «перегенерировать»). */
export function runGen(ed: Editor, assets: AssetStore, g: GenState): MapDoc | null {
  const chosen = g.pack === '*' ? assets.packs : assets.packs.filter((p) => p.id === g.pack);
  const kit = makeKit(chosen.map((p) => ({ id: p.id, assets: p.assets, sets: p.sets })), assets.packs.map((p) => ({ id: p.id, assets: p.assets, sets: p.sets })));
  const fid = ed.state.floorId;
  const fill = g.fill;
  const common = { seed: g.seed, clear: g.clear, fill };
  const roomsSel = g.targets ?? [];
  snapshot(ed.doc, assets, 'gen');
  try {
    ed.commit((d) => {
      if (g.tab === 'decorate') decorate(d, fid, kit, { ...common, clear: false, rooms: roomsSel, style: g.style, restyle: g.restyle, doors: g.doors, windows: g.windows });
      else if (g.tab === 'building') building(d, fid, kit, { ...common, type: g.btype, width: g.width, height: g.height, rooms: g.rooms, style: g.bstyle, roof: g.roof });
      else if (g.tab === 'dungeon') dungeon(d, fid, kit, { ...common, rooms: g.drooms, style: g.style });
      else streets(d, fid, kit, { ...common, block: g.block, plazas: g.plazas, buildings: g.buildings, roofs: g.roofs, style: g.style });
    }, { keepSel: false });
    if (g.fill.lights) ed.setSettings({ showLight: true });
    return ed.doc;
  } catch (e) {
    console.error(e);
    toast(tr('Генерация не удалась: {0}', String(e)), 'error');
    return null;
  }
}

export function GenDialog({ ed, assets, onClose, onDone, initial, replace }: {
  ed: Editor; assets: AssetStore; onClose(): void; onDone(g: GenState, result: MapDoc): void;
  /** Параметры прошлой генерации и её результат — новый результат заменит его, если карту с тех пор не меняли. */
  initial?: GenState; replace?: MapDoc;
}) {
  useStore(assets);
  // Район по умолчанию — Район карты (⚙ → «Район и ссылки»)
  const [g, setG] = useState<GenState>(() => {
    if (initial) return initial;
    const s = load();
    return { ...s, fill: { ...s.fill, district: ed.doc.district ?? s.fill.district } };
  });
  const [districts, setDistricts] = useState<District[]>([]);
  useEffect(() => { void loadDistricts(lang).then(setDistricts); }, []);
  const set = (patch: Partial<GenState>) => setG((x) => ({ ...x, ...patch }));
  const setFill = (patch: Partial<Fill>) => setG((x) => ({ ...x, fill: { ...x.fill, ...patch } }));
  const doc = ed.doc;
  const selRooms = ed.state.sel.filter((s) => s.kind === 'room').length;
  const floorRooms = ed.floor.rooms.length;

  const go = () => {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ ...g, seed: undefined, targets: undefined })); } catch { /* приватный режим */ }
    if (g.tab === 'decorate' && !floorRooms) { toast(tr('На этаже нет комнат — сначала наметь их инструментом «Комната» (B).'), 'error'); return; }
    const run = { ...g, targets: ed.state.sel.filter((s) => s.kind === 'room').map((s) => s.id) };
    if (replace && ed.doc === replace) { ed.undo(); run.targets = g.targets ?? run.targets; }
    const res = runGen(ed, assets, run);
    if (res) onDone(run, res);
  };

  const tabs: [GenTab, string][] = [['decorate', 'Оформить набросок'], ['building', 'Здание'], ['dungeon', 'Подземелье'], ['streets', 'Улицы Задворок']];
  const styleSelect = (value: StyleId, onChange: (s: StyleId) => void) => (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value as StyleId)}>
      {STYLES.map((s) => <option key={s.id} value={s.id}>{nm(s.name)}</option>)}
    </select>
  );
  const level = (v: number, onChange: (n: number) => void) => (
    <div className="seg">{[0, 1, 2].map((n) => <button key={n} type="button" className={v === n ? 'on' : ''} onClick={() => onChange(n)}>{tr(['Нет', 'Немного', 'Много'][n])}</button>)}</div>
  );

  return (
    <Modal title={tr('Генерация')} onClose={onClose} wide>
      <div className="stack">
        <div className="seg">{tabs.map(([id, label]) => <button key={id} className={g.tab === id ? 'on' : ''} onClick={() => set({ tab: id })}>{tr(label)}</button>)}</div>

        {g.tab === 'decorate' && (
          <>
            <p className="hint">{tr('Наметь комнаты прямоугольниками или многоугольниками — генератор расставит двери, окна, мебель и декор по правилам набора.')}{' '}
              {selRooms ? tr('Оформляются выбранные комнаты: {0}.', selRooms) : tr('Оформляются все комнаты этажа: {0}.', floorRooms)}</p>
            <Field label={tr('Стиль')}>{styleSelect(g.style, (style) => set({ style }))}</Field>
            <div className="row wrap">
              <label className="check"><input type="checkbox" checked={g.restyle} onChange={(e) => set({ restyle: e.target.checked })} /> {tr('Раскраска стиля: полы и стены по стилю')}</label>
              <label className="check"><input type="checkbox" checked={g.doors} onChange={(e) => set({ doors: e.target.checked })} /> {tr('Двери')}</label>
              <label className="check"><input type="checkbox" checked={g.windows} onChange={(e) => set({ windows: e.target.checked })} /> {tr('Окна')}</label>
            </div>
            <p className="hint">{tr('Тип комнаты (офис, склад…) берётся из её свойств; если не задан — угадывается по размеру и форме.')}</p>
          </>
        )}
        {g.tab === 'building' && (
          <>
            <div className="row">
              <Field label={tr('Тип здания')}>
                <select className="input" value={g.btype} onChange={(e) => set({ btype: e.target.value as BuildingType })}>
                  {(Object.keys(BUILDINGS) as BuildingType[]).map((k) => <option key={k} value={k}>{BUILDINGS[k].name[lang]}</option>)}
                </select>
              </Field>
              <Field label={tr('Стиль')}>
                <select className="input" value={g.bstyle} onChange={(e) => set({ bstyle: e.target.value as StyleId | 'auto' })}>
                  <option value="auto">{tr('По типу здания')}</option>
                  {STYLES.map((s) => <option key={s.id} value={s.id}>{nm(s.name)}</option>)}
                </select>
              </Field>
            </div>
            <div className="row">
              <Field label={tr('Ширина (клеток)')} row><NumInput value={g.width} step={1} min={4} max={doc.width - 2} digits={0} onCommit={(width) => set({ width })} /></Field>
              <Field label={tr('Высота (клеток)')} row><NumInput value={g.height} step={1} min={4} max={doc.height - 2} digits={0} onCommit={(height) => set({ height })} /></Field>
              <Field label={tr('Комнат')} row><NumInput value={g.rooms} step={1} min={1} max={30} digits={0} onCommit={(rooms) => set({ rooms })} /></Field>
            </div>
            <label className="check"><input type="checkbox" checked={g.roof} onChange={(e) => set({ roof: e.target.checked })} /> {tr('Крыша (для версии «с крышами»)')}</label>
          </>
        )}
        {g.tab === 'dungeon' && (
          <>
            <p className="hint">{tr('Комнаты по всей карте, связанные коридорами; вход — лестница. Размер карты — в ⚙ настройках.')}</p>
            <div className="row">
              <Field label={tr('Комнат')} row><NumInput value={g.drooms} step={1} min={2} max={40} digits={0} onCommit={(drooms) => set({ drooms })} /></Field>
              <Field label={tr('Стиль')}>{styleSelect(g.style, (style) => set({ style }))}</Field>
            </div>
          </>
        )}
        {g.tab === 'streets' && (
          <>
            <p className="hint">{tr('Кварталы, улицы и переулки на всю карту ({0}×{1}); дома с комнатами, площади, фонари и скамейки.', doc.width, doc.height)}</p>
            <div className="row">
              <Field label={tr('Размер квартала')} row><NumInput value={g.block} step={1} min={8} max={40} digits={0} onCommit={(block) => set({ block })} /></Field>
              <Field label={tr('Стиль')}>{styleSelect(g.style, (style) => set({ style }))}</Field>
            </div>
            <Field label={tr('Доля площадей')}><Slider value={g.plazas} max={0.6} onCommit={(plazas) => set({ plazas })} /></Field>
            <div className="row wrap">
              <label className="check"><input type="checkbox" checked={g.buildings} onChange={(e) => set({ buildings: e.target.checked })} /> {tr('Дома')}</label>
              <label className="check"><input type="checkbox" checked={g.roofs} onChange={(e) => set({ roofs: e.target.checked })} /> {tr('Крыши')}</label>
            </div>
          </>
        )}

        <div className="subsec stack">
          <h3>{tr('Наполнение')}</h3>
          <div className="row wrap">
            <label className="check"><input type="checkbox" checked={g.fill.furnish} onChange={(e) => setFill({ furnish: e.target.checked })} /> {tr('Мебель и предметы')}</label>
            <label className="check"><input type="checkbox" checked={g.fill.weather} onChange={(e) => setFill({ weather: e.target.checked })} /> {tr('Следы: грязь, трещины, мусор')}</label>
            <label className="check"><input type="checkbox" checked={g.fill.lights} onChange={(e) => setFill({ lights: e.target.checked })} /> {tr('Свет')}</label>
            <label className="check"><input type="checkbox" checked={g.fill.numbers} onChange={(e) => setFill({ numbers: e.target.checked })} /> {tr('Номера комнат (для мастера)')}</label>
          </div>
          {g.fill.furnish && <Field label={tr('Плотность')}><Slider value={g.fill.density} min={0.3} max={2} step={0.1} onCommit={(density) => setFill({ density })} /></Field>}
          <div className="row">
            <Field label={tr('Укрытия')}>{level(g.fill.cover, (cover) => setFill({ cover }))}</Field>
            <Field label={tr('Ловушки (слой мастера)')}>{level(g.fill.traps, (traps) => setFill({ traps }))}</Field>
          </div>
          <div className="row">
            <Field label={tr('Состояние')}>
              <select className="input" value={g.fill.condition} onChange={(e) => setFill({ condition: e.target.value as Fill['condition'] })}>
                <option value="style">{tr('Как у стиля')}</option>
                {['new', 'worn', 'ruined'].map((c) => <option key={c} value={c}>{tr(COND_LABEL[c])}</option>)}
              </select>
            </Field>
            <Field label={tr('Район / фракция')}>
              <select className="input" value={g.fill.district?.id ?? ''} onChange={(e) => setFill({ district: districts.find((d) => d.id === e.target.value) })}>
                <option value="">{tr('любой')}</option>
                {g.fill.district && !districts.some((d) => d.id === g.fill.district!.id) && <option value={g.fill.district.id}>{g.fill.district.name}</option>}
                {districts.map((d) => <option key={d.id} value={d.id}>{d.name}{d.faction ? ` — ${d.faction}` : ''}</option>)}
              </select>
            </Field>
          </div>
          <Field label={tr('Наборы для мебели')}>
            <select className="input" value={g.pack} onChange={(e) => set({ pack: e.target.value })}>
              <option value="*">{tr('Все наборы')}</option>
              {assets.packs.map((p) => <option key={p.id} value={p.id}>{p.local ? p.label : tr('Канон')}</option>)}
            </select>
          </Field>
          <p className="hint">{tr('Генератор ставит только объекты с правилами размещения (их задают в «✎ Разметить»).')}</p>
        </div>

        <div className="row">
          <Field label={tr('Зерно')} row>
            <div className="row">
              <input className="input" value={g.seed} onChange={(e) => set({ seed: e.target.value })} />
              <button className="icon-btn" title={tr('Новое зерно')} onClick={() => set({ seed: newSeed() })}>🎲</button>
            </div>
          </Field>
          {g.tab !== 'decorate' && <label className="check"><input type="checkbox" checked={g.clear} onChange={(e) => set({ clear: e.target.checked })} /> {tr('Очистить этаж')}</label>}
        </div>
        <p className="hint">{tr('То же зерно с теми же настройками даёт ту же карту. Отменить генерацию — Ctrl+Z.')}</p>
        <div className="row end">
          <button className="btn" onClick={onClose}>{tr('Отмена')}</button>
          <button className="btn btn-primary" onClick={go}>✦ {tr('Сгенерировать')}</button>
        </div>
      </div>
    </Modal>
  );
}

/** Панель после генерации: другой вариант (новое зерно), к параметрам, оставить. */
export function GenBar({ ed, assets, last, onChange, onSettings }: {
  ed: Editor; assets: AssetStore; last: { g: GenState; doc: MapDoc }; onChange(v: { g: GenState; doc: MapDoc } | null): void; onSettings(): void;
}) {
  const again = (seed: string) => {
    if (ed.doc === last.doc) ed.undo();
    const g = { ...last.g, seed };
    const res = runGen(ed, assets, g);
    onChange(res ? { g, doc: res } : null);
  };
  return (
    <div className="gen-bar">
      <span className="hint">{tr('Зерно')}: <b className="gen-seed">{last.g.seed}</b></span>
      <button className="btn btn-sm" onClick={() => again(newSeed())} title={tr('Заменить результат вариантом с новым зерном')}>🎲 {tr('Другой вариант')}</button>
      <button className="btn btn-sm" onClick={onSettings}>⚙ {tr('Параметры')}</button>
      <button className="btn btn-sm btn-primary" onClick={() => onChange(null)}>✓ {tr('Оставить')}</button>
    </div>
  );
}
