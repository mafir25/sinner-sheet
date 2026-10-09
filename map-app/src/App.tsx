import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from './data/auth';
import { AssetStore } from './assets/store';
import { createDoc } from './model/doc';
import type { GridType, MapDoc } from './model/types';
import { Editor, type ToolId, useEditor } from './state/editor';
import { maps as mapDb } from './storage/idb';
import { EXT, buildPmmap, pickFile, readPmmap, safeName, saveBlob } from './storage/file';
import { thumbnail } from './export/export';
import { lang, tr } from './i18n';
import { CanvasView, isTyping } from './ui/CanvasView';
import { moveFloor } from './tools/tools';
import { Library } from './ui/Library';
import { Props } from './ui/Props';
import { FloorsLayers } from './ui/FloorsLayers';
import { ExportDialog, GridSelect, Help, MapSettings } from './ui/Dialogs';
import { GenBar, GenDialog, type GenState } from './ui/GenDialog';
import { LinksDialog } from './ui/LinksDialog';
import { parseMapHash } from '../../site/site-links.js';
import { Field, Modal, NumInput, Toasts, toast, useStore } from './ui/common';
import { floorIssues } from './geom/place';

const openSiteUi = (section: string) => (window as unknown as { SiteUI?: { open(s: string): void } }).SiteUI?.open(section);

export function App() {
  // в режиме разработки (npm run dev:maps) вход не нужен — редактор всё равно ничего не пишет на сервер
  const [user, setUser] = useState<User | null | undefined>(import.meta.env.DEV ? ({ email: 'dev', uid: 'dev' } as User) : undefined);
  useEffect(() => (import.meta.env.DEV ? undefined : onAuthStateChanged(auth, (u) => setUser(u))), []);
  const assets = useMemo(() => new AssetStore(), []);
  useEffect(() => { void assets.init(); }, [assets]);
  const [ed, setEd] = useState<Editor | null>(null);

  if (user === undefined) return <div className="splash">{tr('Загрузка…')}</div>;
  if (user === null) {
    return (
      <div className="splash">
        <h1>{tr('Редактор карт')}</h1>
        <p>{tr('Чтобы рисовать карты, войди в аккаунт.')}</p>
        <p className="hint">{tr('Карты хранятся у тебя: в браузере и в файлах. На сервер ничего не загружается.')}</p>
        <button className="btn btn-primary" onClick={() => openSiteUi('login')}>{tr('Войти')}</button>
      </div>
    );
  }
  return (
    <>
      {ed ? <Workspace key={ed.key} ed={ed} assets={assets} user={user} onExit={() => setEd(null)} onOpen={setEd} />
        : <StartScreen assets={assets} onOpen={setEd} />}
      <Toasts />
    </>
  );
}

/** Открыть .pmmap: ассеты из файла, которых нет в браузере, подключаются как локальный набор. */
async function openFromFile(assets: AssetStore): Promise<Editor | null> {
  const file = await pickFile(`${EXT},.json,application/zip`);
  if (!file) return null;
  try {
    const { doc, embedded } = await readPmmap(file);
    for (const p of embedded) {
      if (assets.pack(p.id)) continue;
      const label = p.label && p.label !== p.id ? p.label : tr('Из карты «{0}»', doc.name);
      await assets.addLocalPack(label, p.files, p.id);
      toast(tr('Ассеты из файла добавлены как набор «{0}»', label));
    }
    return new Editor(doc);
  } catch (e) {
    console.error(e);
    toast(tr('Не удалось открыть файл: {0}', e instanceof Error ? e.message : String(e)), 'error');
    return null;
  }
}

function StartScreen({ assets, onOpen }: { assets: AssetStore; onOpen(e: Editor): void }) {
  const [list, setList] = useState<Awaited<ReturnType<typeof mapDb.list>> | null>(null);
  const [creating, setCreating] = useState(false);
  const refresh = useCallback(() => { mapDb.list().then(setList).catch((e) => { console.error(e); setList([]); }); }, []);
  useEffect(refresh, [refresh]);
  // ссылка из Ширмы: maps.html#map=<id>
  useEffect(() => {
    const want = parseMapHash(location.hash);
    if (!want) return;
    mapDb.get(want.id).then((s) => {
      if (s) onOpen(new Editor(s.doc));
      else {
        history.replaceState(null, '', location.pathname + location.search);
        toast(tr('Карты «{0}» нет в этом браузере — открой её файл .pmmap.', want.name || want.id), 'error');
      }
    }).catch(console.error);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const fmt = (t: number) => new Date(t).toLocaleString(lang === 'en' ? 'en-GB' : 'ru-RU', { dateStyle: 'short', timeStyle: 'short' });

  return (
    <div className="start">
      <header className="topbar">
        <nav><a className="btn" href="index.html">{tr('⌂ ХАБ')}</a><h1 className="title">{tr('Редактор карт')}</h1></nav>
        <div className="row">
          <button className="btn" onClick={async () => { const e = await openFromFile(assets); if (e) onOpen(e); }}>{tr('Открыть файл')}</button>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>＋ {tr('Новая карта')}</button>
        </div>
      </header>
      <main className="start-body">
        <p className="hint">{tr('Карты хранятся у тебя: в браузере и в файлах. На сервер ничего не загружается.')}</p>
        <h2>{tr('Недавние карты')}</h2>
        {list && !list.length && <p className="hint">{tr('Пока пусто — создай первую карту.')}</p>}
        <div className="cards">
          {list?.map((m) => (
            <div key={m.id} className="card">
              <button className="card-open" onClick={async () => {
                const s = await mapDb.get(m.id);
                if (s) onOpen(new Editor(s.doc));
              }}>
                <span className="card-thumb">{m.thumb ? <img src={m.thumb} alt="" /> : null}</span>
                <span className="card-name">{m.name || tr('Без названия')}</span>
                <span className="hint">{tr('Изменено {0}', fmt(m.updatedAt))}</span>
              </button>
              <button className="icon-btn danger card-del" title={tr('Удалить')} onClick={async () => {
                if (!window.confirm(tr('Удалить карту «{0}» из браузера? Файлы на диске не пострадают.', m.name))) return;
                await mapDb.del(m.id);
                refresh();
              }}>✕</button>
            </div>
          ))}
        </div>
      </main>
      {creating && <NewMapDialog onClose={() => setCreating(false)} onCreate={(doc) => onOpen(new Editor(doc))} />}
    </div>
  );
}

function NewMapDialog({ onClose, onCreate }: { onClose(): void; onCreate(d: MapDoc): void }) {
  const [name, setName] = useState('');
  const [w, setW] = useState(30);
  const [h, setH] = useState(20);
  const [grid, setGrid] = useState<GridType>('square');
  return (
    <Modal title={tr('Новая карта')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => {
        e.preventDefault();
        onCreate(createDoc({ name: name.trim() || tr('Без названия'), width: w, height: h, grid, floorName: tr('Этаж 1') }));
      }}>
        <Field label={tr('Название')}><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('Без названия')} /></Field>
        <div className="row">
          <Field label={tr('Ширина (клеток)')} row><NumInput value={w} step={1} min={1} max={500} digits={0} onCommit={(v) => setW(Math.round(v))} /></Field>
          <Field label={tr('Высота (клеток)')} row><NumInput value={h} step={1} min={1} max={500} digits={0} onCommit={(v) => setH(Math.round(v))} /></Field>
        </div>
        <Field label={tr('Сетка')}><GridSelect value={grid} onChange={setGrid} /></Field>
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>{tr('Отмена')}</button>
          <button type="submit" className="btn btn-primary">{tr('Создать')}</button>
        </div>
      </form>
    </Modal>
  );
}

const TOOLS: { id: ToolId; icon: string; title: string; key?: string }[] = [
  { id: 'select', icon: '⬚', title: 'Выделение (V)', key: 'v' },
  { id: 'room', icon: '▭', title: 'Комната (B)', key: 'b' },
  { id: 'poly', icon: '⬠', title: 'Комната-многоугольник (P)', key: 'p' },
  { id: 'wall', icon: '╱', title: 'Стена (W)', key: 'w' },
  { id: 'door', icon: '🚪', title: 'Дверь (D)', key: 'd' },
  { id: 'window', icon: '▤', title: 'Окно (O)', key: 'o' },
  { id: 'cut', icon: '✂', title: 'Убрать стену (X)', key: 'x' },
  { id: 'stamp', icon: '✦', title: 'Объект (из библиотеки)' },
  { id: 'brush', icon: '🖌', title: 'Кисть местности (G)', key: 'g' },
  { id: 'path', icon: '〰', title: 'Путь (C)', key: 'c' },
  { id: 'light', icon: '💡', title: 'Свет (L)', key: 'l' },
  { id: 'label', icon: 'T', title: 'Подпись (T)', key: 't' },
  { id: 'roof', icon: '⌂', title: 'Крыша (R)', key: 'r' },
  { id: 'pan', icon: '✋', title: 'Панорама (H)', key: 'h' },
];
const HINTS: Record<ToolId, string> = {
  select: 'Щелчок — выбрать, Shift — добавить к выбору, рамкой — выбрать несколько. Тащи — переместить. Щелчок по линии стены комнаты — выбрать только эту стену.',
  room: 'Тяни прямоугольник. Комнаты одного стиля сливаются, Alt — вырезать.',
  poly: 'Щелчками ставь вершины, двойной щелчок или Enter — замкнуть, Esc — отмена.',
  wall: 'Щелчками ставь точки стены, двойной щелчок или Enter — закончить, Esc — отмена.',
  door: 'Наведи на стену и щёлкни — проём встанет на стену.',
  window: 'Наведи на стену и щёлкни — проём встанет на стену.',
  cut: 'Щелчок по стене — убрать её от угла до угла, протяжка — только участок (гараж, навес). Щелчок по убранной — вернуть.',
  stamp: 'Щелчок — поставить объект или комплект. Правила сами прижмут его к стене, в угол или к дороге (Alt — без правил). Q/E — поворот, F — отразить.',
  pan: 'Тяни, чтобы двигать карту.',
  brush: 'Рисуй местность: грязь, кровь, воду. Alt — ластик.',
  path: 'Щелчками ставь точки пути, двойной щелчок или Enter — закончить, Esc — отмена.',
  light: 'Щелчок — поставить источник света. Тени от стен считаются сами.',
  label: 'Щелчок — подпись. Включи нумерацию, чтобы ставить номера комнат подряд.',
  roof: 'Щелчок по комнате — крыша по её форме. Протянуть — прямоугольная крыша.',
};
const ROOF_NEXT = { hide: 'ghost', ghost: 'show', show: 'hide' } as const;
const ROOF_LABEL = { hide: 'Крыши скрыты', ghost: 'Крыши полупрозрачны', show: 'Крыши видны' } as const;

type SaveHandle = Parameters<typeof saveBlob>[2];

function Workspace({ ed, assets, user, onExit, onOpen }: { ed: Editor; assets: AssetStore; user: User; onExit(): void; onOpen(e: Editor): void }) {
  const tool = useEditor(ed, (s) => s.tool);
  const doc = useEditor(ed, (s) => s.doc);
  const canUndo = useEditor(ed, (s) => s.canUndo);
  const canRedo = useEditor(ed, (s) => s.canRedo);
  const settings = useEditor(ed, (s) => s.settings);
  const [dialog, setDialog] = useState<'export' | 'settings' | 'help' | 'gen' | 'links' | null>(null);
  // адрес вкладки ведёт на открытую карту — его можно сохранить в закладки или вставить в Ширму
  useEffect(() => {
    history.replaceState(null, '', `${location.pathname}${location.search}#map=${encodeURIComponent(ed.doc.id)}`);
    return () => history.replaceState(null, '', location.pathname + location.search);
  }, [ed]);
  const [genLast, setGenLast] = useState<{ g: GenState; doc: MapDoc } | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const handle = useRef<SaveHandle>(null);
  const fit = useRef<() => void>(() => {});

  // ---------- автосохранение в браузере
  useEffect(() => {
    let timer = 0;
    const save = async () => {
      timer = 0;
      setSaveState('saving');
      const d = ed.doc;
      try {
        await mapDb.put({ id: d.id, name: d.name, updatedAt: d.updatedAt || Date.now(), thumb: thumbnail(d, assets), doc: d });
        setSaveState('saved');
      } catch (e) {
        console.error(e);
        setSaveState('dirty');
        toast(tr('В браузере нет места: {0}', String(e)), 'error');
      }
    };
    const off = ed.onDoc(() => { setSaveState('dirty'); clearTimeout(timer); timer = window.setTimeout(save, 800); });
    void save(); // новая или только что открытая карта сразу попадает в список
    const flush = () => { if (timer) { clearTimeout(timer); void save(); } };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    return () => { off(); flush(); window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', flush); };
  }, [ed, assets]);

  const saveFile = useCallback(async (askWhere: boolean) => {
    try {
      const blob = await buildPmmap(ed.doc, assets);
      const r = await saveBlob(blob, `${safeName(ed.doc.name)}${EXT}`, handle.current, askWhere);
      if (!r) return;
      handle.current = r.handle;
      ed.markSaved();
      toast(tr('Файл сохранён: {0}', r.name));
    } catch (e) {
      console.error(e);
      toast(tr('Не удалось сохранить: {0}', String(e)), 'error');
    }
  }, [ed, assets]);

  // ---------- горячие клавиши
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || dialog) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod) {
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); ed.undo(); }
        else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); ed.redo(); }
        else if (k === 's') { e.preventDefault(); void saveFile(e.shiftKey); }
        else if (k === 'c') ed.copy();
        else if (k === 'v') { ed.setTool('select'); ed.paste(); }
        else if (k === 'd') { e.preventDefault(); ed.duplicate(); }
        return;
      }
      if (e.altKey) return;
      const t = TOOLS.find((x) => x.key === k);
      if (t) { ed.setTool(t.id); return; }
      const objs = ed.selected('object');
      const ids = new Set(objs.map((o) => o.id));
      if (k === 'delete' || (k === 'backspace' && ed.state.tool === 'select')) { e.preventDefault(); ed.deleteSelection(); return; }
      if (k === 'q' || k === 'e') {
        const d = (k === 'q' ? -1 : 1) * (e.shiftKey ? 90 : 15);
        const labels = new Set(ed.selected('label').map((l) => l.id));
        if (objs.length || labels.size) {
          ed.commitFloor((f) => {
            for (const o of [...f.objects, ...f.labels]) if (ids.has(o.id) || labels.has(o.id)) o.rot = (((o.rot + d) % 360) + 360) % 360;
          });
        }
        else if (ed.state.tool === 'stamp') ed.setSettings({ stampRot: (((ed.state.settings.stampRot + d) % 360) + 360) % 360 });
        return;
      }
      if (k === 'f') {
        if (objs.length) ed.commitFloor((f) => { for (const o of f.objects) if (ids.has(o.id)) o.flipX = !o.flipX; });
        else if (ed.state.tool === 'stamp') ed.setSettings({ stampFlip: !ed.state.settings.stampFlip });
        return;
      }
      const arrows: Record<string, [number, number]> = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
      if (arrows[k] && ed.state.sel.length) {
        e.preventDefault();
        const step = e.shiftKey ? 0.25 : 1;
        const dx = arrows[k][0] * step, dy = arrows[k][1] * step;
        const all = new Set(ed.state.sel.map((s) => s.id));
        ed.commitFloor((f) => { Object.assign(f, moveFloor(f, all, new Set(), { x: dx, y: dy })); });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ed, dialog, saveFile]);

  const nick = user.displayName || user.email || '';
  const saveLabel = saveState === 'saved' ? tr('Сохранено в браузере') : saveState === 'saving' ? tr('Сохраняется…') : tr('Не сохранено');

  return (
    <div className="app">
      <header className="topbar">
        <nav>
          <a className="btn" href="index.html">{tr('⌂ ХАБ')}</a>
          <button className="btn" onClick={onExit}>☰ {tr('Карты')}</button>
          <NameInput value={doc.name} onCommit={(name) => ed.commit((d) => { d.name = name; })} />
          <span className={`save-state s-${saveState}`}>{saveLabel}</span>
        </nav>
        <div className="row">
          <button className="icon-btn" disabled={!canUndo} title={tr('Отменить (Ctrl+Z)')} onClick={() => ed.undo()}>↶</button>
          <button className="icon-btn" disabled={!canRedo} title={tr('Повторить (Ctrl+Y)')} onClick={() => ed.redo()}>↷</button>
          <button className="btn" onClick={async () => { const e = await openFromFile(assets); if (e) onOpen(e); }}>{tr('Открыть файл')}</button>
          <button className="btn" title={tr('Сохранить файл (Ctrl+S)')} onClick={() => saveFile(false)}>💾 {tr('Сохранить')}</button>
          <button className="btn" title={tr('Генерация: оформить набросок, здание, подземелье, улицы')} onClick={() => setDialog('gen')}>✦ {tr('Генерация')}</button>
          <button className="btn btn-primary" onClick={() => setDialog('export')}>⇩ {tr('Экспорт')}</button>
          <button className="icon-btn" title={tr('Район и ссылки: палитра Района, ссылка для Ширмы, ссылки на Базу знаний')} onClick={() => setDialog('links')}>🔗</button>
          <button className="icon-btn" title={tr('Настройки карты')} onClick={() => setDialog('settings')}>⚙</button>
          <button className="icon-btn" title={tr('Управление')} onClick={() => setDialog('help')}>?</button>
          <button className="btn user" title={tr('Аккаунт и настройки')} onClick={() => openSiteUi('account')}>{nick}</button>
        </div>
      </header>
      <main className="work">
        <aside className="left">
          <div className="tools">
            {TOOLS.map((t) => (
              <button key={t.id} className={`tool${tool === t.id ? ' on' : ''}`} title={tr(t.title)} aria-label={tr(t.title)}
                disabled={t.id === 'stamp' && !settings.stamp && !settings.stampSet} onClick={() => ed.setTool(t.id)}>{t.icon}</button>
            ))}
          </div>
          <div className="props">
            <h3>{tr(TOOLS.find((t) => t.id === tool)?.title ?? '')}</h3>
            <p className="hint">{tr(HINTS[tool])}</p>
            <Props ed={ed} assets={assets} />
          </div>
        </aside>
        <section className="center">
          <CanvasView ed={ed} assets={assets} onFitRef={(f) => { fit.current = f; }} />
          {genLast && doc === genLast.doc && <GenBar ed={ed} assets={assets} last={genLast} onChange={setGenLast} onSettings={() => setDialog('gen')} />}
          <div className="bottombar">
            <button className={`btn btn-sm${settings.snap ? ' btn-on' : ''}`} title={tr('Привязка к сетке (зажать Ctrl — без привязки)')}
              onClick={() => ed.setSettings({ snap: !settings.snap })}>⌗ {tr('Привязка')}</button>
            {(tool === 'room' || tool === 'poly') && (
              <button className={`btn btn-sm${settings.subtract ? ' btn-danger' : ''}`} title={tr('Режим: добавить или вырезать (Alt — вырезать)')}
                onClick={() => ed.setSettings({ subtract: !settings.subtract })}>{settings.subtract ? `− ${tr('Вырезать')}` : `＋ ${tr('Добавить')}`}</button>
            )}
            <button className={`btn btn-sm${settings.showRoofs !== 'hide' ? ' btn-on' : ''}`} title={tr('Показ крыш в редакторе')}
              onClick={() => ed.setSettings({ showRoofs: ROOF_NEXT[settings.showRoofs] })}>⌂ {tr(ROOF_LABEL[settings.showRoofs])}</button>
            {doc.lighting.enabled && (
              <button className={`btn btn-sm${settings.showLight ? ' btn-on' : ''}`} title={tr('Показывать освещение в редакторе')}
                onClick={() => ed.setSettings({ showLight: !settings.showLight })}>💡 {tr('Свет')}</button>
            )}
            <IssuesButton ed={ed} assets={assets} />
            <button className="btn btn-sm" title={tr('Показать всю карту')} onClick={() => fit.current()}>⤢</button>
          </div>
        </section>
        <aside className="right">
          <Library ed={ed} assets={assets} />
          <FloorsLayers ed={ed} />
        </aside>
      </main>
      {dialog === 'export' && <ExportDialog ed={ed} assets={assets} onClose={() => setDialog(null)} />}
      {dialog === 'settings' && <MapSettings ed={ed} assets={assets} onClose={() => setDialog(null)} />}
      {dialog === 'help' && <Help onClose={() => setDialog(null)} />}
      {dialog === 'links' && <LinksDialog ed={ed} onClose={() => setDialog(null)} />}
      {dialog === 'gen' && <GenDialog ed={ed} assets={assets} onClose={() => setDialog(null)} initial={genLast?.g} replace={genLast?.doc}
        onDone={(g, res) => { setGenLast({ g, doc: res }); setDialog(null); }} />}
    </div>
  );
}

/** Название карты: в историю попадает одно изменение — при выходе из поля или Enter. */
function NameInput({ value, onCommit }: { value: string; onCommit(v: string): void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => { const v = text.trim(); if (v && v !== value) onCommit(v); else setText(value); };
  return (
    <input className="input map-name" value={text} aria-label={tr('Название')} onChange={(e) => setText(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setText(value); (e.target as HTMLInputElement).blur(); } }} />
  );
}

/** Сколько объектов этажа нарушают правила размещения; щелчок — выделить их, второй — скрыть подсветку. */
function IssuesButton({ ed, assets }: { ed: Editor; assets: AssetStore }) {
  const v = useStore(assets);
  const doc = useEditor(ed, (s) => s.doc);
  const floorId = useEditor(ed, (s) => s.floorId);
  const on = useEditor(ed, (s) => s.settings.showIssues);
  const issues = useMemo(() => floorIssues(ed.floor, (k) => assets.entry(k)), [doc, floorId, v]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!issues.size && on) return null;
  return (
    <button className={`btn btn-sm${on && issues.size ? ' btn-danger' : ''}`} title={tr('Объекты, нарушающие правила размещения: щелчок — выделить, Shift+щелчок — скрыть/показать подсветку')}
      onClick={(e) => {
        if (e.shiftKey || !on) { ed.setSettings({ showIssues: !on }); return; }
        ed.setTool('select');
        ed.setSel([...issues.keys()].map((id) => ({ kind: 'object' as const, id })));
      }}>⚠ {on ? issues.size : tr('Правила')}</button>
  );
}
