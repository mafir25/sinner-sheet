// Левая панель: настройки текущего инструмента и свойства выделенного.
import type { AssetStore } from '../assets/store';
import { findDir, switchDir, variantChain } from '../assets/tree.js';
import type { AssetKey, MapObject, WallStyle } from '../model/types';
import { type Editor, useEditor } from '../state/editor';
import { nm, tr } from '../i18n';
import { resizePortal } from '../geom/walls';
import { AssetPicker, Field, NumInput, Thumb, assetName, useStore } from './common';

function WallStyleEditor({ assets, value, onChange }: { assets: AssetStore; value: WallStyle; onChange(v: WallStyle): void }) {
  return (
    <div className="stack">
      <Field label={tr('Текстура стены')}>
        <AssetPicker assets={assets} kind="wall" value={value.asset} allowNone noneLabel={tr('Без текстуры')} onChange={(asset) => onChange({ ...value, asset })} />
      </Field>
      <div className="row">
        <Field label={tr('Цвет')} row><input type="color" value={value.color} onChange={(e) => onChange({ ...value, color: e.target.value })} /></Field>
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
    if (!settings.stamp) return <p className="hint">{tr('Щелчок — поставить объект. Q/E — поворот, F — отразить, Esc — выход.')}</p>;
    return (
      <div className="stack">
        <div className="row"><Thumb assets={assets} k={settings.stamp} size={64} /><b>{assetName(assets.entry(settings.stamp), settings.stamp)}</b></div>
        <Field label={tr('Разновидность')}><VariantPicker assets={assets} value={settings.stamp} onChange={(stamp) => ed.setSettings({ stamp })} /></Field>
        <div className="row">
          <Field label={tr('Поворот')} row><NumInput value={settings.stampRot} step={15} digits={1} onCommit={(v) => ed.setSettings({ stampRot: ((v % 360) + 360) % 360 })} /></Field>
          <button className={`btn btn-sm${settings.stampFlip ? ' btn-on' : ''}`} onClick={() => ed.setSettings({ stampFlip: !settings.stampFlip })}>{tr('Отразить ↔')}</button>
        </div>
      </div>
    );
  }
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
      {actions}
    </div>
  );
}
