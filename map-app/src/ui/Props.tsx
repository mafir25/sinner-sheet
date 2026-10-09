// Левая панель: настройки текущего инструмента и свойства выделенного.
import type { AssetStore } from '../assets/store';
import { dirOf, findDir, switchDir, variantChain } from '../assets/tree.js';
import type { AssetKey, MapObject, Rules, WallStyle } from '../model/types';
import { ROOM_TYPES, checkObject } from '../geom/place';
import { objectCorners } from '../tools/hit';
import { ROTATE_LABEL, WHERE_LABEL, PLACE_LABEL, issueText, roomTypeName, targetName } from './issues';
import { type Editor, useEditor } from '../state/editor';
import { nm, tr } from '../i18n';
import { resizePortal } from '../geom/walls';
import { BrushPanel, LabelPanel, LightPanel, PathPanel, RoofPanel, SelectionExtras } from './Props2';
import { AssetPicker, ColorInput, Field, NumInput, SetThumb, Thumb, assetName, toast, useStore } from './common';

function WallStyleEditor({ assets, value, onChange }: { assets: AssetStore; value: WallStyle; onChange(v: WallStyle): void }) {
  return (
    <div className="stack">
      <Field label={tr('Текстура стены')}>
        <AssetPicker assets={assets} kind="wall" value={value.asset} allowNone noneLabel={tr('Без текстуры')} onChange={(asset) => onChange({ ...value, asset })} />
      </Field>
      <div className="row">
        <Field label={tr('Цвет')} row><ColorInput value={value.color} onCommit={(color) => onChange({ ...value, color })} /></Field>
        <Field label={tr('Толщина')} row><NumInput value={value.width} step={0.05} min={0.05} max={2} onCommit={(width) => onChange({ ...value, width })} /></Field>
      </div>
    </div>
  );
}

/** Цепочка списков «категория → подтип → разновидность», собранная из папок набора. */
export function VariantPicker({ assets, value, onChange }: { assets: AssetStore; value: AssetKey; onChange(k: AssetKey): void }) {
  const k = assets.parse(value);
  const pack = k ? assets.pack(k.packId) : undefined;
  if (!k || !pack || !pack.byPath.has(k.path)) return <p className="hint">{assetName(undefined, value)}</p>;
  const chain = variantChain(pack.tree, k.path);
  return (
    <div className="stack">
      {chain.map((lvl, i) => (
        <select key={i} className="input" value={lvl.value}
          onChange={(e) => {
            if (lvl.kind === 'file') { onChange(assets.key(pack.id, e.target.value)); return; }
            const next = switchDir(pack.tree, pack.assets, k.path, lvl.value, e.target.value);
            if (next) onChange(assets.key(pack.id, next));
          }}>
          {lvl.options.map((o) => (
            <option key={o} value={o}>{lvl.kind === 'file' ? nm(pack.byPath.get(o)?.name, o) : nm(findDir(pack.tree, o)?.name, o)}</option>
          ))}
        </select>
      ))}
    </div>
  );
}

/** Смена ассета объекта с сохранением масштаба. */
function swapAsset(assets: AssetStore, o: MapObject, key: AssetKey): Partial<MapObject> {
  const a = assets.entry(o.asset)?.footprint ?? [o.w, o.h];
  const b = assets.entry(key)?.footprint ?? a;
  const k = o.w / a[0];
  return { asset: key, w: b[0] * k, h: b[1] * k };
}

export function Props({ ed, assets }: { ed: Editor; assets: AssetStore }) {
  useStore(assets);
  const tool = useEditor(ed, (s) => s.tool);
  const settings = useEditor(ed, (s) => s.settings);
  const sel = useEditor(ed, (s) => s.sel);
  useEditor(ed, (s) => s.doc);
  const f = ed.floor;

  if (tool === 'room' || tool === 'poly') {
    return (
      <div className="stack">
        <div className="seg">
          <button className={!settings.subtract ? 'on' : ''} onClick={() => ed.setSettings({ subtract: false })}>＋ {tr('Добавить')}</button>
          <button className={settings.subtract ? 'on' : ''} onClick={() => ed.setSettings({ subtract: true })}>− {tr('Вырезать')}</button>
        </div>
        <Field label={tr('Материал пола')}>
          <AssetPicker assets={assets} kind="floor" value={settings.floor} allowNone noneLabel={tr('Без пола')} onChange={(floor) => ed.setSettings({ floor })} />
        </Field>
        <WallStyleEditor assets={assets} value={settings.wall} onChange={(wall) => ed.setSettings({ wall })} />
      </div>
    );
  }
  if (tool === 'wall') return <WallStyleEditor assets={assets} value={settings.wall} onChange={(wall) => ed.setSettings({ wall })} />;
  if (tool === 'door' || tool === 'window') {
    return (
      <Field label={tool === 'door' ? tr('Вид двери') : tr('Вид окна')}>
        <AssetPicker assets={assets} kind={tool} value={tool === 'door' ? settings.door : settings.window}
          onChange={(k) => ed.setSettings(tool === 'door' ? { door: k } : { window: k })} />
      </Field>
    );
  }
  if (tool === 'stamp') {
    const found = assets.set(settings.stampSet);
    if (!settings.stamp && !found) return <p className="hint">{tr('Щелчок — поставить объект. Q/E — поворот, F — отразить, Esc — выход.')}</p>;
    const entry = found ? undefined : assets.entry(settings.stamp);
    const rules = found ? found.set.rules : entry?.rules;
    return (
      <div className="stack">
        {found ? (
          <>
            <div className="row"><SetThumb assets={assets} k={settings.stampSet!} size={64} /><b>🧩 {nm(found.set.name)}</b></div>
            <p className="hint">{tr('Комплект: {0} предм.', found.set.items.length)}</p>
            {settings.stamp && <button className="btn btn-sm" onClick={() => ed.setSettings({ stampSet: null })}>{tr('Ставить один объект')}</button>}
          </>
        ) : settings.stamp && (
          <>
            <div className="row"><Thumb assets={assets} k={settings.stamp} size={64} /><b>{assetName(entry, settings.stamp)}</b></div>
            <Field label={tr('Разновидность')}><VariantPicker assets={assets} value={settings.stamp} onChange={(stamp) => ed.setSettings({ stamp })} /></Field>
            {entry?.group && <p className="hint">{tr('Группа вариантов «{0}»: при включённых вариациях ставится случайный.', entry.group)}</p>}
          </>
        )}
        <div className="row">
          <Field label={tr('Поворот')} row><NumInput value={settings.stampRot} step={15} digits={1} onCommit={(v) => ed.setSettings({ stampRot: ((v % 360) + 360) % 360 })} /></Field>
          <button className={`btn btn-sm${settings.stampFlip ? ' btn-on' : ''}`} onClick={() => ed.setSettings({ stampFlip: !settings.stampFlip })}>{tr('Отразить ↔')}</button>
        </div>
        <label className="check"><input type="checkbox" checked={settings.rules} onChange={(e) => ed.setSettings({ rules: e.target.checked })} /> {tr('Правила размещения (Alt — без них)')}</label>
        <label className="check"><input type="checkbox" checked={settings.vary} onChange={(e) => ed.setSettings({ vary: e.target.checked })} /> {tr('Случайные вариации')}</label>
        {rules ? <RuleSummary assets={assets} rules={rules} dir={found ? found.set.dir : entry?.dir ?? ''} />
          : <p className="hint">{tr('У этого объекта правил нет — их задают в «✎ Разметить» библиотеки.')}</p>}
      </div>
    );
  }
  if (tool === 'brush') return <BrushPanel ed={ed} assets={assets} />;
  if (tool === 'path') return <PathPanel ed={ed} assets={assets} />;
  if (tool === 'light') return <LightPanel ed={ed} />;
  if (tool === 'label') return <LabelPanel ed={ed} />;
  if (tool === 'roof') return <RoofPanel ed={ed} assets={assets} />;
  if (tool !== 'select') return null;

  // ---------- свойства выделенного
  if (!sel.length) return <p className="hint">{tr('Ничего не выбрано')}</p>;
  const objs = ed.selected('object'), rooms = ed.selected('room'), walls = ed.selected('wall'), portals = ed.selected('portal');
  const ids = new Set(sel.map((s) => s.id));
  const updObjs = (fn: (o: MapObject) => void) => ed.commitFloor((fl) => { for (const o of fl.objects) if (ids.has(o.id)) fn(o); });
  const actions = (
    <div className="row wrap">
      {objs.length > 0 && <button className="btn btn-sm" onClick={() => ed.duplicate()}>{tr('Дублировать (Ctrl+D)')}</button>}
      <button className="btn btn-sm btn-danger" onClick={() => ed.deleteSelection()}>{tr('Удалить (Del)')}</button>
    </div>
  );

  return (
    <div className="stack">
      <p className="hint">{tr('Выбрано: {0}', sel.length)}</p>
      {objs.length === 1 && (() => {
        const o = objs[0];
        const e = assets.entry(o.asset);
        const upd = (patch: Partial<MapObject>) => ed.commitFloor((fl) => { const x = fl.objects.find((y) => y.id === o.id); if (x) Object.assign(x, patch); });
        return (
          <>
            <div className="row"><Thumb assets={assets} k={o.asset} size={56} /><b>{assetName(e, o.asset)}</b></div>
            <Field label={tr('Разновидность')}><VariantPicker assets={assets} value={o.asset} onChange={(k) => upd(swapAsset(assets, o, k))} /></Field>
            <div className="row">
              <Field label={tr('Ширина')} row><NumInput value={o.w} min={0.05} max={200} onCommit={(w) => upd({ w, h: o.h * (w / o.w) })} /></Field>
              <Field label={tr('Высота')} row><NumInput value={o.h} min={0.05} max={200} onCommit={(h) => upd({ h, w: o.w * (h / o.h) })} /></Field>
            </div>
            <div className="row">
              <Field label={tr('Поворот')} row><NumInput value={o.rot} step={15} digits={1} onCommit={(v) => upd({ rot: ((v % 360) + 360) % 360 })} /></Field>
              <Field label={tr('Прозрачность')} row><NumInput value={o.opacity} step={0.1} min={0} max={1} onCommit={(opacity) => upd({ opacity })} /></Field>
            </div>
            {e && <button className="btn btn-sm" onClick={() => upd({ w: e.footprint[0], h: e.footprint[1] })}>{tr('Исходный размер')}</button>}
            <Issues assets={assets} list={checkObject(f, o, (k) => assets.entry(k)).map((i) => issueText(assets, i))} />
            {e?.rules && <RuleSummary assets={assets} rules={e.rules} dir={e.dir} />}
          </>
        );
      })()}
      {objs.length > 0 && (
        <>
          <div className="row wrap">
            <button className="btn btn-sm" onClick={() => updObjs((o) => { o.flipX = !o.flipX; })}>{tr('Отразить ↔')}</button>
            <button className="btn btn-sm" onClick={() => updObjs((o) => { o.flipY = !o.flipY; })}>{tr('Отразить ↕')}</button>
            <button className="btn btn-sm" title={tr('Наверх')} onClick={() => ed.commitFloor((fl) => { fl.objects = [...fl.objects.filter((o) => !ids.has(o.id)), ...fl.objects.filter((o) => ids.has(o.id))]; })}>⤒ {tr('Наверх')}</button>
            <button className="btn btn-sm" title={tr('Вниз')} onClick={() => ed.commitFloor((fl) => { fl.objects = [...fl.objects.filter((o) => ids.has(o.id)), ...fl.objects.filter((o) => !ids.has(o.id))]; })}>⤓ {tr('Вниз')}</button>
          </div>
          <Field label={tr('Оттенок')}>
            <div className="row">
              <ColorInput value={objs[0].tint ?? '#ffffff'} onCommit={(c) => updObjs((o) => { o.tint = c.toLowerCase() === '#ffffff' ? null : c; })} />
              {objs.some((o) => o.tint) && <button className="btn btn-sm" onClick={() => updObjs((o) => { o.tint = null; })}>{tr('Без оттенка')}</button>}
            </div>
          </Field>
          {objs.length > 1 && <button className="btn btn-sm" title={tr('Запомнить выбранные объекты как комплект набора — он появится в библиотеке')}
            onClick={() => void saveAsSet(ed, assets, objs)}>🧩 {tr('Сохранить как комплект')}</button>}
          <Field label={tr('Слой')}>
            <select className="input" value={objs.every((o) => o.layer === objs[0].layer) ? objs[0].layer : ''}
              onChange={(e) => { const layer = e.target.value; if (layer) updObjs((o) => { o.layer = layer; }); }}>
              {!objs.every((o) => o.layer === objs[0].layer) && <option value="">—</option>}
              {f.layers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
        </>
      )}
      {rooms.length > 0 && (
        <>
          <Field label={tr('Тип комнаты')}>
            <select className="input" value={rooms.every((r) => (r.type ?? '') === (rooms[0].type ?? '')) ? rooms[0].type ?? '' : '*'}
              onChange={(e) => { const t = e.target.value; if (t === '*') return; ed.commitFloor((fl) => { for (const r of fl.rooms) if (ids.has(r.id)) { if (t) r.type = t; else delete r.type; } }); }}>
              {!rooms.every((r) => (r.type ?? '') === (rooms[0].type ?? '')) && <option value="*">—</option>}
              <option value="">{tr('Не задан')}</option>
              {ROOM_TYPES.map((t) => <option key={t.id} value={t.id}>{roomTypeName(t.id)}</option>)}
            </select>
          </Field>
          <Field label={tr('Материал пола')}>
            <AssetPicker assets={assets} kind="floor" value={rooms[0].floor} allowNone noneLabel={tr('Без пола')}
              onChange={(k) => ed.commitFloor((fl) => { for (const r of fl.rooms) if (ids.has(r.id)) r.floor = k; })} />
          </Field>
          <WallStyleEditor assets={assets} value={rooms[0].wall}
            onChange={(w) => ed.commitFloor((fl) => { for (const r of fl.rooms) if (ids.has(r.id)) r.wall = { ...w }; })} />
        </>
      )}
      {walls.length > 0 && (
        <>
          <WallStyleEditor assets={assets} value={walls[0].wall}
            onChange={(w) => ed.commitFloor((fl) => { for (const x of fl.walls) if (ids.has(x.id)) x.wall = { ...w }; })} />
          {walls.length === 1 && walls[0].points.length > 2 && (
            <label className="check"><input type="checkbox" checked={walls[0].closed}
              onChange={(e) => { const closed = e.target.checked; ed.commitFloor((fl) => { const w = fl.walls.find((x) => x.id === walls[0].id); if (w) w.closed = closed; }); }} /> {tr('Замкнуть')}</label>
          )}
        </>
      )}
      {portals.length > 0 && (() => {
        const kind = portals[0].kind;
        const same = portals.every((p) => p.kind === kind);
        return same && (
          <Field label={kind === 'door' ? tr('Вид двери') : tr('Вид окна')}>
            <AssetPicker assets={assets} kind={kind} value={portals[0].asset}
              onChange={(k) => {
                const len = assets.entry(k)?.footprint[0] ?? 1;
                ed.commitFloor((fl) => {
                  for (const p of fl.portals) {
                    if (ids.has(p.id)) Object.assign(p, { asset: k }, resizePortal(p, len));
                  }
                });
              }} />
          </Field>
        );
      })()}
      <SelectionExtras ed={ed} assets={assets} />
      {actions}
    </div>
  );
}

function Issues({ list }: { assets: AssetStore; list: string[] }) {
  if (!list.length) return null;
  return <ul className="issues">{list.map((t, i) => <li key={i}>⚠ {t}</li>)}</ul>;
}

/** Короткая сводка правил объекта или комплекта. */
export function RuleSummary({ assets, rules: r, dir }: { assets: AssetStore; rules: Rules; dir: string }) {
  const parts: string[] = [];
  if (r.place !== 'free') parts.push(tr(PLACE_LABEL[r.place]) + (r.face ? ` · ${tr('лицом к комнате')}` : ''));
  if (r.where !== 'any') parts.push(tr(WHERE_LABEL[r.where]));
  if (r.rooms.length) parts.push(`${tr('Комнаты')}: ${r.rooms.map(roomTypeName).join(', ')}`);
  for (const n of r.near) parts.push(tr('Рядом с «{0}» (до {1} кл.)', targetName(assets, n.to, dir), n.dist));
  for (const n of r.avoid) parts.push(tr('Не ближе {1} кл. к «{0}»', targetName(assets, n.to, dir), n.dist));
  if (r.clearDoors) parts.push(tr('Не загораживать двери'));
  if (r.max) parts.push(tr('Не больше {0} на комнату', r.max));
  const vary: string[] = [];
  if (r.rotate !== 'none') vary.push(tr(ROTATE_LABEL[r.rotate]));
  if (r.flip) vary.push(tr('отражение'));
  if (r.scale[0] !== 1 || r.scale[1] !== 1) vary.push(tr('масштаб {0}–{1}', r.scale[0], r.scale[1]));
  if (r.tint.length) vary.push(tr('оттенки: {0}', r.tint.length));
  if (vary.length) parts.push(`${tr('Вариации')}: ${vary.join(', ')}`);
  if (!parts.length) return null;
  return <ul className="rules-sum">{parts.map((t, i) => <li key={i}>{t}</li>)}</ul>;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Выбранные объекты → комплект в _meta.json общей папки их набора. */
async function saveAsSet(ed: Editor, assets: AssetStore, objs: MapObject[]) {
  const keys = objs.map((o) => assets.parse(o.asset));
  const packId = keys[0]?.packId;
  if (!packId || keys.some((k) => !k || k.packId !== packId)) { toast(tr('Комплект собирается из объектов одного набора'), 'error'); return; }
  const pack = assets.pack(packId);
  if (!pack) return;
  const name = window.prompt(tr('Название комплекта'), '')?.trim();
  if (!name) return;
  // общая папка всех предметов
  let parts = dirOf(keys[0]!.path).split('/').filter(Boolean);
  for (const k of keys) {
    const d = dirOf(k!.path).split('/').filter(Boolean);
    let i = 0;
    while (i < parts.length && i < d.length && parts[i] === d[i]) i++;
    parts = parts.slice(0, i);
  }
  const dir = parts.join('/');
  const cs = objs.flatMap(objectCorners);
  const cx = (Math.min(...cs.map((q) => q.x)) + Math.max(...cs.map((q) => q.x))) / 2;
  const cy = (Math.min(...cs.map((q) => q.y)) + Math.max(...cs.map((q) => q.y))) / 2;
  const items = objs.map((o, i) => {
    const path = keys[i]!.path, e = pack.byPath.get(path);
    const scale = e ? o.w / e.footprint[0] : 1;
    return {
      file: dir ? path.slice(dir.length + 1) : path, x: r3(o.x - cx), y: r3(o.y - cy), rot: r3(o.rot),
      ...(o.flipX ? { flip: true } : {}), ...(Math.abs(scale - 1) > 0.01 ? { scale: r3(scale) } : {}),
    };
  });
  const metas = structuredClone(pack.metas) as Record<string, Record<string, unknown>>;
  const m = metas[dir] ?? {};
  const sets = { ...(m.sets as Record<string, unknown> | undefined) };
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'set';
  let key = base;
  for (let n = 2; sets[key]; n++) key = `${base}-${n}`;
  sets[key] = { name: { ru: name, en: name }, items };
  metas[dir] = { ...m, sets };
  await assets.updateMetas(packId, metas);
  const setId = dir ? `${dir}#${key}` : `#${key}`;
  ed.setSettings({ stampSet: assets.setKey(packId, setId) });
  if (!pack.local) toast(tr('Комплект «{0}» добавлен в канон до перезагрузки. Чтобы сохранить — «✎ Разметить» → «Скачать _meta.json».', name));
  else if (await assets.writeMetasToDisk(packId, [dir])) toast(tr('Комплект «{0}» сохранён в папку набора', name));
  else toast(tr('Комплект «{0}» сохранён в браузере', name));
}
