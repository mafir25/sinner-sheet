// Разметка набора (этап 3): визуальный редактор _meta.json — названия, размеры, слои, теги,
// группы вариантов, правила размещения (docs/map-editor.md §5) и комплекты. Художнику не нужен ручной JSON.
// Правится черновик; «Сохранить» пересобирает набор, у локального — пишет в браузер и (если можно) в папку на диске.
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { type AssetStore, metasZip } from '../assets/store';
import { CONDITIONS, KINDS, PLACES, ROTATE, WHERE, baseOf, buildPack, dirOf, findDir, normRules, resolveDirMeta } from '../assets/tree.js';
import type { DirNode } from '../model/types';
import { ROOM_TYPES } from '../geom/place';
import { download } from '../storage/file';
import { nm, tr } from '../i18n';
import { Field, Modal, Thumb, toast, useStore } from './common';
import { COND_LABEL, PLACE_LABEL, ROTATE_LABEL, WHERE_LABEL, roomTypeName } from './issues';
import { RuleSummary } from './Props';

// _meta.json — произвольный JSON от художника; правим его как есть
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
type Metas = Record<string, Json>;

const KIND_LABEL: Record<string, string> = {
  object: 'Объект', floor: 'Пол', wall: 'Стена', door: 'Дверь', window: 'Окно', terrain: 'Местность (кисть)', roof: 'Кровля',
};

/** Убирает пустые значения: пустая строка, пустой список или объект = «наследовать». */
function prune(o: Json): Json {
  if (Array.isArray(o) || !o || typeof o !== 'object') return o;
  const out: Json = {};
  for (const [k, v] of Object.entries(o)) {
    const pv = prune(v);
    if (pv === undefined || pv === '' || (Array.isArray(pv) && !pv.length) || (pv && typeof pv === 'object' && !Array.isArray(pv) && !Object.keys(pv).length)) continue;
    out[k] = pv;
  }
  return out;
}

const nameOf = (n: Json): { ru: string; en: string } => (typeof n === 'string' ? { ru: n, en: '' } : { ru: n?.ru ?? '', en: n?.en ?? '' });
const mkName = (ru: string | undefined, en: string | undefined) => (ru || en ? { ru: ru ?? '', en: en ?? '' } : undefined);
const show = (v: unknown) => (v === undefined || v === null ? '' : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v));

export function MetaEditor({ assets, packId, startDir, onClose }: { assets: AssetStore; packId: string; startDir: string; onClose(): void }) {
  useStore(assets);
  const pack = assets.pack(packId)!;
  const [metas, setMetas] = useState<Metas>(() => structuredClone(pack.metas) as Metas);
  const [dir, setDir] = useState(() => (findDir(pack.tree, startDir) ? startDir : ''));
  const [sel, setSel] = useState<string[]>([]); // имена файлов в папке; пусто — сама папка
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [json, setJson] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setSel([]), [dir]);

  const node = findDir(pack.tree, dir) ?? pack.tree;
  const built = useMemo(() => buildPack(pack.assets.map((a) => ({ path: a.path, size: a.size ?? null })), metas), [pack, metas]);
  const builtBy = useMemo(() => new Map(built.assets.map((a) => [a.path, a])), [built]);

  /** Правка _meta.json папки d. */
  const patchDir = (d: string, fn: (m: Json) => void) => {
    setMetas((all) => {
      const m = structuredClone(all[d] ?? {});
      fn(m);
      const next = { ...all };
      const p = prune(m);
      if (Object.keys(p).length) next[d] = p; else delete next[d];
      return next;
    });
    setDirty((s) => new Set(s).add(d));
  };

  // цели формы: сама папка или выбранные файлы
  const targets = (m: Json): Json[] => {
    if (!sel.length) return [m];
    m.files ??= {};
    return sel.map((f) => (m.files[f] ??= {}));
  };
  const cur = (metas[dir] ?? {}) as Json;
  const first: Json = sel.length ? cur.files?.[sel[0]] ?? {} : cur;
  const get = (k: string) => first[k];
  const set = (k: string, v: unknown) => patchDir(dir, (m) => { for (const t of targets(m)) { if (v === undefined) delete t[k]; else t[k] = v; } });
  const getR = (k: string) => first.rules?.[k];
  const setR = (k: string, v: unknown) => patchDir(dir, (m) => {
    for (const t of targets(m)) { t.rules ??= {}; if (v === undefined) delete t.rules[k]; else t.rules[k] = v; }
  });
  // что придёт по наследству (подсказка в пустых полях)
  const inherited = sel.length ? resolveDirMeta(dir, metas) : resolveDirMeta(dirOf(dir), dir ? metas : {});
  const inh = (k: string) => (inherited[k] === undefined ? '' : `↑ ${show(inherited[k])}`);
  const inhR = (k: string) => (inherited.rules[k] === undefined ? '' : `↑ ${show(inherited.rules[k])}`);

  const close = () => { if (!dirty.size || window.confirm(tr('Закрыть без сохранения? Изменения разметки пропадут.'))) onClose(); };
  const save = async () => {
    setBusy(true);
    try {
      await assets.updateMetas(packId, metas);
      if (!pack.local) toast(tr('Разметка канона применена до перезагрузки. Скачай ZIP, положи файлы в Assets/Maps/ и запусти node scripts/gen-map-assets.mjs.'));
      else if (await assets.writeMetasToDisk(packId, [...dirty])) toast(tr('Разметка сохранена в папку набора'));
      else toast(tr('Разметка сохранена в браузере. Чтобы она попала в папку на диске — «Скачать _meta.json».'));
      setDirty(new Set());
      onClose();
    } catch (e) {
      toast(tr('Не удалось сохранить: {0}', String(e)), 'error');
    } finally { setBusy(false); }
  };
  const zip = async () => download(await metasZip(metas), `${pack.id === 'canon' ? 'maps' : pack.label}-meta.zip`);

  const pick = (file: string, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) setSel((s) => (s.includes(file) ? s.filter((x) => x !== file) : [...s, file]));
    else setSel([file]);
  };
  const files = node.files.map(baseOf);
  const groups = [...new Set(Object.values(cur.files ?? {}).map((f: Json) => f?.group).filter(Boolean))] as string[];
  const targetsList = useMemo(() => {
    const tags = new Set<string>(), out: string[] = [];
    for (const a of built.assets) { a.tags.forEach((t) => tags.add(t)); out.push(`/${a.path}`); }
    return [...[...tags].map((t) => `#${t}`), ...files, ...out];
  }, [built, files]);

  const renderTree = (n: DirNode, depth: number): ReactNode => (
    <div key={n.path}>
      <button className={`meta-dir${n.path === dir ? ' on' : ''}${dirty.has(n.path) ? ' dirty' : ''}`} style={{ paddingLeft: 6 + depth * 12 }} onClick={() => setDir(n.path)}>
        {n.path ? `📁 ${nm(n.name, baseOf(n.path))}` : `🏛 ${pack.local ? pack.label : tr('Канон')}`}
        {metas[n.path] ? ' •' : ''}
      </button>
      {n.dirs.map((d) => renderTree(d, depth + 1))}
    </div>
  );

  const entry = sel.length ? builtBy.get(dir ? `${dir}/${sel[0]}` : sel[0]) : undefined;

  return (
    <Modal title={tr('Разметка набора «{0}»', pack.local ? pack.label : tr('Канон'))} onClose={close} xl>
      <div className="meta-ed">
        <nav className="meta-tree">{renderTree(pack.tree, 0)}</nav>
        <section className="meta-files">
          <button className={`meta-file meta-folder${!sel.length ? ' on' : ''}`} onClick={() => setSel([])}>
            <span className="thumb thumb-none" style={{ width: 52, height: 52 }}>📁</span>
            <span className="lib-name">{tr('Вся папка')}</span>
          </button>
          {files.map((f) => {
            const path = dir ? `${dir}/${f}` : f;
            const own = cur.files?.[f];
            return (
              <button key={f} className={`meta-file${sel.includes(f) ? ' on' : ''}`} title={f} onClick={(e) => pick(f, e)}>
                <Thumb assets={assets} k={assets.key(pack.id, path)} size={52} />
                <span className="lib-name">{nm(builtBy.get(path)?.name, f)}{own ? ' •' : ''}</span>
              </button>
            );
          })}
          <p className="hint meta-hint">{tr('Ctrl/Shift + щелчок — выбрать несколько файлов и править их вместе. Пустое поле — значение наследуется от папки (подсказка «↑»).')}</p>
        </section>
        <section className="meta-form">
          <h3>{sel.length ? (sel.length === 1 ? sel[0] : tr('Файлов: {0}', sel.length)) : tr('Папка «{0}»', dir || '/')}</h3>
          <div className="row">
            <Field label={tr('Название (рус.)')}><OptText value={nameOf(get('name')).ru} placeholder={entry ? nm(entry.name) : ''} onCommit={(v) => set('name', mkName(v, nameOf(get('name')).en))} /></Field>
            <Field label={tr('Название (англ.)')}><OptText value={nameOf(get('name')).en} onCommit={(v) => set('name', mkName(nameOf(get('name')).ru, v))} /></Field>
          </div>
          <div className="row">
            <Field label={tr('Вид')}>
              <select className="input" value={get('kind') ?? ''} onChange={(e) => set('kind', e.target.value || undefined)}>
                <option value="">{inh('kind') || tr('↑ объект')}</option>
                {KINDS.map((k) => <option key={k} value={k}>{tr(KIND_LABEL[k])}</option>)}
              </select>
            </Field>
            <Field label={tr('Слой')}>
              <select className="input" value={get('layer') ?? ''} onChange={(e) => set('layer', e.target.value || undefined)}>
                <option value="">{inh('layer') || tr('↑ под стенами')}</option>
                <option value="below">{tr('Под стенами')}</option>
                <option value="above">{tr('Над стенами')}</option>
              </select>
            </Field>
          </div>
          <div className="row">
            <Field label={tr('Пикселей на клетку')}><OptNum value={get('ppc')} placeholder={inh('ppc') || '↑ 256'} onCommit={(v) => set('ppc', v)} /></Field>
            <Field label={tr('Масштабируемый')}><Tri value={get('scalable')} inherit={inh('scalable')} onChange={(v) => set('scalable', v)} /></Field>
            <Field label={tr('Пиксель-арт')}><Tri value={get('pixelated')} inherit={inh('pixelated')} onChange={(v) => set('pixelated', v)} /></Field>
          </div>
          <Field label={tr('Теги (через запятую)')}><OptText value={show(get('tags'))} placeholder={inherited.tags.length ? `↑ ${inherited.tags.join(', ')}` : ''}
            onCommit={(v) => set('tags', v ? v.split(',').map((t) => t.trim()).filter(Boolean) : undefined)} /></Field>
          {sel.length > 0 && (
            <div className="row">
              <Field label={tr('Ширина, клеток')}><OptNum value={get('footprint')?.[0]} placeholder={entry && !get('footprint') ? `${entry.footprint[0]}` : tr('авто')}
                onCommit={(v) => set('footprint', v ? [v, get('footprint')?.[1] ?? entry?.footprint[1] ?? 1] : undefined)} /></Field>
              <Field label={tr('Высота, клеток')}><OptNum value={get('footprint')?.[1]} placeholder={entry && !get('footprint') ? `${entry.footprint[1]}` : tr('авто')}
                onCommit={(v) => set('footprint', v ? [get('footprint')?.[0] ?? entry?.footprint[0] ?? 1, v] : undefined)} /></Field>
              <Field label={tr('Группа вариантов')}>
                <OptText value={get('group')} list="meta-groups" placeholder={tr('нет')} onCommit={(v) => set('group', v || undefined)} />
                <datalist id="meta-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
              </Field>
            </div>
          )}

          <div className="subsec stack">
            <h3>{tr('Правила размещения')}</h3>
            <div className="row">
              <Field label={tr('Позиция')}>
                <select className="input" value={getR('place') ?? ''} onChange={(e) => setR('place', e.target.value || undefined)}>
                  <option value="">{inhR('place') || tr('↑ свободно')}</option>
                  {PLACES.map((p) => <option key={p} value={p}>{tr(PLACE_LABEL[p])}</option>)}
                </select>
              </Field>
              <Field label={tr('Где')}>
                <select className="input" value={getR('where') ?? ''} onChange={(e) => setR('where', e.target.value || undefined)}>
                  <option value="">{inhR('where') || tr('↑ где угодно')}</option>
                  {WHERE.map((p) => <option key={p} value={p}>{tr(WHERE_LABEL[p])}</option>)}
                </select>
              </Field>
            </div>
            <div className="row">
              <Field label={tr('Отступ от стены')}><OptNum value={getR('gap')} placeholder={inhR('gap') || '0'} min={0} onCommit={(v) => setR('gap', v)} /></Field>
              <Field label={tr('Лицом к комнате')}><Tri value={getR('face')} inherit={inhR('face')} onChange={(v) => setR('face', v)} /></Field>
              <Field label={tr('Не загораживать двери')}><Tri value={getR('clearDoors')} inherit={inhR('clearDoors')} onChange={(v) => setR('clearDoors', v)} /></Field>
            </div>
            <Field label={tr('Типы комнат (пусто — любые)')}>
              <Chips options={ROOM_TYPES.map((t) => t.id)} label={roomTypeName} value={getR('rooms')} inherited={inherited.rules.rooms} onChange={(v) => setR('rooms', v)} />
            </Field>
            <Field label={tr('Рядом с (стул — у стола)')}>
              <RelList value={getR('near')} inherited={inhR('near')} targets={targetsList} onChange={(v) => setR('near', v)} />
            </Field>
            <Field label={tr('Не ближе к')}>
              <RelList value={getR('avoid')} inherited={inhR('avoid')} targets={targetsList} onChange={(v) => setR('avoid', v)} />
            </Field>
            <div className="row">
              <Field label={tr('Вес (частота)')}><OptNum value={getR('weight')} placeholder={inhR('weight') || '1'} min={0} onCommit={(v) => setR('weight', v)} /></Field>
              <Field label={tr('Мин. на комнату')}><OptNum value={getR('min')} placeholder={inhR('min') || '0'} min={0} digits={0} onCommit={(v) => setR('min', v)} /></Field>
              <Field label={tr('Макс. на комнату')}><OptNum value={getR('max')} placeholder={inhR('max') || '∞'} min={0} digits={0} onCommit={(v) => setR('max', v)} /></Field>
            </div>
            <h3>{tr('Вариативность')}</h3>
            <div className="row">
              <Field label={tr('Поворот')}>
                <select className="input" value={getR('rotate') ?? ''} onChange={(e) => setR('rotate', e.target.value || undefined)}>
                  <option value="">{inhR('rotate') || tr('↑ без случайного поворота')}</option>
                  {ROTATE.map((p) => <option key={p} value={p}>{tr(ROTATE_LABEL[p])}</option>)}
                </select>
              </Field>
              <Field label={tr('Отражение')}><Tri value={getR('flip')} inherit={inhR('flip')} onChange={(v) => setR('flip', v)} /></Field>
            </div>
            <div className="row">
              <Field label={tr('Масштаб от')}><OptNum value={getR('scale')?.[0]} placeholder="1" min={0.05} onCommit={(v) => setR('scale', v ? [v, getR('scale')?.[1] ?? v] : undefined)} /></Field>
              <Field label={tr('Масштаб до')}><OptNum value={getR('scale')?.[1]} placeholder="1" min={0.05} onCommit={(v) => setR('scale', v ? [getR('scale')?.[0] ?? v, v] : undefined)} /></Field>
            </div>
            <Field label={tr('Оттенки (случайный из списка)')}><Colors value={getR('tint') ?? []} onChange={(v) => setR('tint', v.length ? v : undefined)} /></Field>
            <h3>{tr('Контекст (для генерации)')}</h3>
            <Field label={tr('Районы / фракции (через запятую)')}><OptText value={show(getR('districts'))} placeholder={inhR('districts')}
              onCommit={(v) => setR('districts', v ? v.split(',').map((t) => t.trim()).filter(Boolean) : undefined)} /></Field>
            <Field label={tr('Состояние')}><Chips options={CONDITIONS} label={(c) => tr(COND_LABEL[c] ?? c)} value={getR('state')} inherited={inherited.rules.state} onChange={(v) => setR('state', v)} /></Field>
          </div>

          {!sel.length && <SetsEditor sets={cur.sets} onChange={(sets) => patchDir(dir, (m) => { if (sets) m.sets = sets; else delete m.sets; })} />}

          {entry && (
            <div className="subsec stack">
              <h3>{tr('Итог для «{0}»', nm(entry.name))}</h3>
              <p className="hint">{tr(KIND_LABEL[entry.kind])} · {entry.footprint[0]}×{entry.footprint[1]} {tr('кл.')} · {entry.layer === 'above' ? tr('Над стенами') : tr('Под стенами')}
                {entry.scalable ? ` · ${tr('масштабируемый')}` : ''}{entry.group ? ` · ${tr('группа «{0}»', entry.group)}` : ''}{entry.tags.length ? ` · #${entry.tags.join(' #')}` : ''}</p>
              {entry.rules && <RuleSummary assets={assets} rules={entry.rules} dir={entry.dir} />}
            </div>
          )}
          {json && <textarea className="input meta-json" readOnly value={JSON.stringify(metas[dir] ?? {}, null, 2)} />}
        </section>
      </div>
      <div className="row end meta-foot">
        <label className="check" style={{ marginRight: 'auto' }}><input type="checkbox" checked={json} onChange={(e) => setJson(e.target.checked)} /> {tr('Показать _meta.json папки')}</label>
        <button className="btn" onClick={close}>{tr('Отмена')}</button>
        <button className="btn" onClick={() => void zip()} title={tr('Все _meta.json набора одним архивом — разложить по папкам набора')}>⇩ {tr('Скачать _meta.json')}</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>{pack.local && pack.handle ? tr('Сохранить в папку') : tr('Сохранить')}</button>
      </div>
    </Modal>
  );
}

// ---------- поля формы
/** Текст, который уходит в черновик при потере фокуса или Enter. */
function OptText({ value, onCommit, placeholder, list }: { value: string | undefined; onCommit(v: string | undefined): void; placeholder?: string; list?: string }) {
  const [t, setT] = useState(value ?? '');
  useEffect(() => setT(value ?? ''), [value]);
  const commit = () => { const v = t.trim(); if (v !== (value ?? '')) onCommit(v || undefined); };
  return <input className="input" value={t} list={list} placeholder={placeholder} onChange={(e) => setT(e.target.value)} onBlur={commit}
    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
}

/** Число или пусто (= наследовать). */
function OptNum({ value, onCommit, placeholder, min, digits = 3 }: { value: number | undefined; onCommit(v: number | undefined): void; placeholder?: string; min?: number; digits?: number }) {
  const fmt = (v: number | undefined) => (v === undefined ? '' : String(Math.round(v * 10 ** digits) / 10 ** digits));
  const [t, setT] = useState(fmt(value));
  useEffect(() => setT(fmt(value)), [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    if (!t.trim()) { if (value !== undefined) onCommit(undefined); return; }
    let v = Number(t.replace(',', '.'));
    if (!Number.isFinite(v)) { setT(fmt(value)); return; }
    if (min !== undefined) v = Math.max(min, v);
    v = Math.round(v * 10 ** digits) / 10 ** digits;
    if (v !== value) onCommit(v); else setT(fmt(value));
  };
  return <input className="input num" type="number" value={t} placeholder={placeholder} onChange={(e) => setT(e.target.value)} onBlur={commit}
    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
}

/** Да / нет / наследовать. */
function Tri({ value, inherit, onChange }: { value: boolean | undefined; inherit: string; onChange(v: boolean | undefined): void }) {
  return (
    <select className="input" value={value === undefined ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value === 'true')}>
      <option value="">{inherit ? inherit.replace('true', tr('да')).replace('false', tr('нет')) : tr('↑ авто')}</option>
      <option value="true">{tr('Да')}</option>
      <option value="false">{tr('Нет')}</option>
    </select>
  );
}

/** Выбор нескольких значений; не задано — наследуется (серые). */
function Chips({ options, label, value, inherited, onChange }: {
  options: string[]; label(v: string): string; value: string[] | undefined; inherited: unknown; onChange(v: string[] | undefined): void;
}) {
  const own = Array.isArray(value);
  const shown = own ? value : (Array.isArray(inherited) ? inherited as string[] : []);
  return (
    <div className={`chips${own ? '' : ' chips-inh'}`}>
      {options.map((o) => (
        <button key={o} type="button" className={`chip${shown.includes(o) ? ' on' : ''}`}
          onClick={() => onChange(shown.includes(o) ? shown.filter((x) => x !== o) : [...shown, o])}>{label(o)}</button>
      ))}
      {own && <button type="button" className="chip chip-reset" title={tr('Наследовать от папки')} onClick={() => onChange(undefined)}>↑</button>}
    </div>
  );
}

type Rel = { to: string; dist: number };
/** Список отношений «цель + расстояние». Цель: #тег, @группа, имя файла в папке или /путь от корня набора. */
function RelList({ value, inherited, targets, onChange }: { value: Rel[] | undefined; inherited: string; targets: string[]; onChange(v: Rel[] | undefined): void }) {
  const list = value ?? [];
  const id = useMemo(() => `rel-${Math.random().toString(36).slice(2)}`, []);
  const upd = (i: number, patch: Partial<Rel>) => onChange(list.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="stack rel-list">
      {!value && inherited && <p className="hint">{inherited}</p>}
      {list.map((r, i) => (
        <div key={i} className="row">
          <OptText value={r.to} list={id} placeholder={tr('#тег, файл или /путь')} onCommit={(to) => (to ? upd(i, { to }) : onChange(list.filter((_, j) => j !== i)))} />
          <span className="rel-dist"><OptNum value={r.dist} min={0} onCommit={(d) => upd(i, { dist: d ?? 1 })} /></span>
          <button type="button" className="mini danger" title={tr('Удалить')} onClick={() => onChange(list.length > 1 ? list.filter((_, j) => j !== i) : undefined)}>✕</button>
        </div>
      ))}
      <datalist id={id}>{targets.map((t) => <option key={t} value={t} />)}</datalist>
      <button type="button" className="btn btn-sm" onClick={() => onChange([...list, { to: targets[0] ?? '#', dist: 1 }])}>＋ {tr('Добавить')}</button>
    </div>
  );
}

function Colors({ value, onChange }: { value: string[]; onChange(v: string[]): void }) {
  return (
    <div className="row wrap">
      {value.map((c, i) => (
        <span key={`${c}-${i}`} className="color-chip">
          <input type="color" defaultValue={c} onBlur={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))} />
          <button type="button" className="mini danger" title={tr('Удалить')} onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</button>
        </span>
      ))}
      <button type="button" className="btn btn-sm" onClick={() => onChange([...value, '#c8b8a0'])}>＋ {tr('Оттенок')}</button>
    </div>
  );
}

/** Комплекты папки: название, позиция, удаление. Новые — с карты: выдели объекты → «Сохранить как комплект». */
function SetsEditor({ sets, onChange }: { sets: Json; onChange(v: Json): void }) {
  const entries = Object.entries((sets ?? {}) as Record<string, Json>);
  const upd = (key: string, fn: (s: Json) => void) => {
    const next = structuredClone(sets);
    fn(next[key]);
    onChange(next);
  };
  return (
    <div className="subsec stack">
      <h3>{tr('Комплекты папки')}</h3>
      {!entries.length && <p className="hint">{tr('Комплектов нет. Расставь объекты на карте, выдели их и нажми «Сохранить как комплект».')}</p>}
      {entries.map(([key, s]) => {
        const r = normRules(s.rules);
        return (
          <div key={key} className="set-row stack">
            <div className="row">
              <OptText value={typeof s.name === 'string' ? s.name : s.name?.ru} placeholder={key} onCommit={(v) => upd(key, (x) => { x.name = { ru: v ?? key, en: x.name?.en || v || key }; })} />
              <OptText value={s.name?.en} placeholder="EN" onCommit={(v) => upd(key, (x) => { x.name = { ru: x.name?.ru ?? (typeof x.name === 'string' ? x.name : key), en: v ?? '' }; })} />
              <button type="button" className="mini danger" title={tr('Удалить')} onClick={() => {
                if (!window.confirm(tr('Удалить комплект «{0}»?', key))) return;
                const next = { ...sets }; delete next[key]; onChange(Object.keys(next).length ? next : undefined);
              }}>✕</button>
            </div>
            <div className="row">
              <span className="hint">{tr('Предметов: {0}', Array.isArray(s.items) ? s.items.length : 0)}</span>
              <select className="input" value={s.rules?.place ?? ''} onChange={(e) => upd(key, (x) => {
                x.rules = { ...x.rules, place: e.target.value || undefined };
                if (!e.target.value) delete x.rules.place;
              })}>
                <option value="">{tr(PLACE_LABEL.free)}</option>
                {PLACES.filter((p) => p !== 'free').map((p) => <option key={p} value={p}>{tr(PLACE_LABEL[p])}</option>)}
              </select>
            </div>
            {r.place !== 'free' && <p className="hint">{tr('Комплект прилипает целиком, как один объект.')}</p>}
          </div>
        );
      })}
    </div>
  );
}
