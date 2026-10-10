// Библиотека ассетов: наборы → папки → разновидности. Щелчок по ассету выбирает его для инструмента.
import { useMemo, useState } from 'react';
import { MetaEditor } from './MetaEditor';
import { type AssetStore, pickFolder } from '../assets/store';
import { findDir, firstAsset } from '../assets/tree.js';
import type { AssetKey, DirNode } from '../model/types';
import type { Editor } from '../state/editor';
import { useEditor } from '../state/editor';
import { nm, tr } from '../i18n';
import { resizePortal } from '../geom/walls';
import { SetThumb, Thumb, toast, useStore } from './common';

/** Выбор ассета: ставит его в настройки нужного инструмента и применяет к выделенному. */
export function applyAsset(ed: Editor, assets: AssetStore, key: AssetKey) {
  const e = assets.entry(key);
  if (!e) return;
  const sel = ed.state.sel;
  const has = (kind: string) => sel.some((s) => s.kind === kind);
  if (e.kind === 'floor') {
    ed.setSettings({ floor: key });
    if (has('room')) {
      const ids = new Set(sel.map((s) => s.id));
      ed.commitFloor((f) => { for (const r of f.rooms) if (ids.has(r.id)) r.floor = key; });
    } else if (ed.state.tool !== 'room' && ed.state.tool !== 'poly') ed.setTool('room');
  } else if (e.kind === 'wall') {
    ed.setSettings({ wall: { ...ed.state.settings.wall, asset: key } });
    if (has('room') || has('wall')) {
      const ids = new Set(sel.map((s) => s.id));
      ed.commitFloor((f) => {
        for (const r of f.rooms) if (ids.has(r.id)) r.wall = { ...r.wall, asset: key };
        for (const w of f.walls) if (ids.has(w.id)) w.wall = { ...w.wall, asset: key };
      });
    }
  } else if (e.kind === 'door' || e.kind === 'window') {
    ed.setSettings(e.kind === 'door' ? { door: key } : { window: key });
    const ids = new Set(sel.filter((s) => s.kind === 'portal').map((s) => s.id));
    if (ids.size) {
      ed.commitFloor((f) => {
        for (const p of f.portals) {
          if (ids.has(p.id) && p.kind === e.kind) Object.assign(p, { asset: key }, resizePortal(p, e.footprint[0]));
        }
      });
    } else ed.setTool(e.kind);
  } else if (e.kind === 'terrain') {
    ed.setSettings({ brush: { ...ed.state.settings.brush, asset: key, erase: false } });
    ed.setTool('brush');
  } else if (e.kind === 'roof') {
    ed.setSettings({ roof: { ...ed.state.settings.roof, asset: key } });
    const ids = new Set(sel.filter((s) => s.kind === 'roof').map((s) => s.id));
    if (ids.size) ed.commitFloor((f) => { for (const r of f.roofs) if (ids.has(r.id)) r.asset = key; });
    else ed.setTool('roof');
  } else {
    ed.setSettings({ stamp: key, stampSet: null });
    ed.setTool('stamp');
  }
}

/** Комплект — в инструмент «Объект». */
export function applySet(ed: Editor, key: string) {
  ed.setSettings({ stampSet: key });
  ed.setTool('stamp');
}

type Loc = { pack: string | null; path: string };

export function Library({ ed, assets }: { ed: Editor; assets: AssetStore }) {
  useStore(assets);
  const settings = useEditor(ed, (s) => s.settings);
  const [loc, setLoc] = useState<Loc>({ pack: 'canon', path: '' });
  const [q, setQ] = useState('');
  const [markup, setMarkup] = useState(false);
  const pack = loc.pack ? assets.pack(loc.pack) : undefined;
  const dir = pack ? findDir(pack.tree, loc.path) ?? pack.tree : null;
  const current = new Set([settings.stampSet ? null : settings.stamp, settings.floor, settings.wall.asset, settings.door, settings.window]);

  const found = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return null;
    return assets.all().filter(({ entry, pack: p }) => (!loc.pack || p.id === loc.pack)
      && `${entry.name.ru} ${entry.name.en} ${entry.path} ${entry.tags.join(' ')}`.toLowerCase().includes(s)).slice(0, 300);
  }, [q, assets, loc.pack, assets.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const addFolder = async () => {
    const picked = await pickFolder();
    if (!picked) return;
    try {
      const p = await assets.addLocalPack(picked.label, picked.files, undefined, picked.handle);
      if (!p) { toast(tr('В папке нет картинок'), 'error'); return; }
      toast(tr('Набор «{0}» подключён: {1} картинок', p.label, p.assets.length));
      setLoc({ pack: p.id, path: '' });
    } catch (e) { toast(tr('В браузере нет места: {0}', String(e)), 'error'); }
  };
  const removePack = async (id: string) => {
    const p = assets.pack(id);
    if (!p || !window.confirm(tr('Удалить набор «{0}» из браузера?', p.label))) return;
    await assets.removePack(id);
    setLoc({ pack: null, path: '' });
  };

  const packLabel = (id: string) => (id === 'canon' ? tr('Канон') : assets.pack(id)?.label ?? id);
  const crumbs: { label: string; loc: Loc }[] = [{ label: tr('Все наборы'), loc: { pack: null, path: '' } }];
  if (pack) {
    crumbs.push({ label: packLabel(pack.id), loc: { pack: pack.id, path: '' } });
    const parts = loc.path ? loc.path.split('/') : [];
    parts.forEach((_, i) => {
      const p = parts.slice(0, i + 1).join('/');
      crumbs.push({ label: nm(findDir(pack.tree, p)?.name, p), loc: { pack: pack.id, path: p } });
    });
  }

  const assetTile = (key: AssetKey, name: string, title?: string, count = 1, on = current.has(key)) => (
    <button key={key} className={`lib-item${on ? ' on' : ''}`} title={title ?? name} onClick={() => applyAsset(ed, assets, key)}>
      <Thumb assets={assets} k={key} size={56} />
      <span className="lib-name">{name}</span>
      {count > 1 && <span className="lib-badge" title={tr('Вариантов: {0}', count)}>×{count}</span>}
    </button>
  );
  /** Файлы папки: группа вариантов — одной плиткой (при установке берётся случайный вариант). */
  const fileTiles = (packId: string, files: string[]) => {
    const p = assets.pack(packId)!;
    const seen = new Set<string>();
    return files.map((path) => {
      const e = p.byPath.get(path)!;
      if (!e.group) return assetTile(assets.key(packId, path), nm(e.name));
      if (seen.has(e.group)) return null;
      seen.add(e.group);
      const members = files.filter((x) => p.byPath.get(x)?.group === e.group);
      // лицо группы — самый короткий файл (crate.svg, а не crate-steel.svg)
      const face = [...members].sort((x, y) => x.length - y.length || x.localeCompare(y))[0], fe = p.byPath.get(face)!;
      const on = members.some((x) => current.has(assets.key(packId, x)));
      return assetTile(assets.key(packId, face), nm(fe.name), `${nm(fe.name)} — ${tr('Вариантов: {0}', members.length)}`, members.length, on);
    });
  };
  const setTile = (packId: string, id: string) => {
    const key = assets.setKey(packId, id), found = assets.set(key);
    if (!found) return null;
    return (
      <button key={key} className={`lib-item${settings.stampSet === key ? ' on' : ''}`} title={`${nm(found.set.name)} — ${tr('Комплект')}`} onClick={() => applySet(ed, key)}>
        <SetThumb assets={assets} k={key} size={56} />
        <span className="lib-name">🧩 {nm(found.set.name)}</span>
      </button>
    );
  };
  const dirTile = (d: DirNode, packId: string) => {
    const first = firstAsset(d);
    return (
      <button key={d.path} className="lib-item lib-dir" onClick={() => setLoc({ pack: packId, path: d.path })} title={nm(d.name)}>
        <span className="lib-folder"><Thumb assets={assets} k={first ? assets.key(packId, first) : null} size={44} /></span>
        <span className="lib-name">📁 {nm(d.name)}</span>
      </button>
    );
  };

  return (
    <section className="side-sec lib">
      <div className="sec-head">
        <h3>{tr('Библиотека')}</h3>
        <div className="row">
          {pack && <button className="btn btn-sm" onClick={() => setMarkup(true)} title={tr('Разметка набора: названия, размеры, правила размещения, комплекты — без ручного JSON')}>✎ {tr('Разметить')}</button>}
          <button className="btn btn-sm" onClick={addFolder} title={tr('Подключить папку с картинками (PNG, WebP, JPG, SVG). Файлы остаются в браузере.')}>＋ {tr('Папка')}</button>
        </div>
      </div>
      <input className="input" placeholder={tr('Поиск…')} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="crumbs">
        {crumbs.map((c, i) => (
          <span key={i}>{i > 0 && <span className="crumb-sep">›</span>}
            <button className="crumb" onClick={() => { setLoc(c.loc); setQ(''); }}>{c.label}</button></span>
        ))}
        {pack?.local && <button className="crumb crumb-del" title={tr('Удалить')} onClick={() => removePack(pack.id)}>✕</button>}
      </div>
      <div className="lib-grid">
        {found ? (found.length ? found.map(({ key, entry, pack: p }) => assetTile(key, nm(entry.name), `${nm(entry.name)} — ${packLabel(p.id)}/${entry.path}`))
          : <p className="hint">{tr('Ничего не найдено')}</p>)
          : !pack ? assets.packs.map((p) => (
            <button key={p.id} className="lib-item lib-dir" onClick={() => setLoc({ pack: p.id, path: '' })}>
              <span className="lib-folder"><Thumb assets={assets} k={firstAsset(p.tree) ? assets.key(p.id, firstAsset(p.tree)!) : null} size={44} /></span>
              <span className="lib-name">{p.local ? '💾' : '🏛'} {packLabel(p.id)}</span>
            </button>
          ))
            : dir && <>
              {dir.dirs.map((d) => dirTile(d, pack.id))}
              {dir.sets.map((id) => setTile(pack.id, id))}
              {fileTiles(pack.id, dir.files)}
            </>}
      </div>
      {markup && pack && <MetaEditor assets={assets} packId={pack.id} startDir={loc.path} onClose={() => setMarkup(false)} />}
    </section>
  );
}
