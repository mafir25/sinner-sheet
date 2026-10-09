// Этажи (снизу вверх: первый в списке — нижний) и слои объектов текущего этажа.
import { type Editor, useEditor } from '../state/editor';
import { defaultLayers, newFloor, uid } from '../model/doc';
import { tr } from '../i18n';
import { toast } from './common';

function move<T>(arr: T[], i: number, d: number): T[] {
  const j = i + d;
  if (j < 0 || j >= arr.length) return arr;
  const out = arr.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

export function FloorsLayers({ ed }: { ed: Editor }) {
  const doc = useEditor(ed, (s) => s.doc);
  const floorId = useEditor(ed, (s) => s.floorId);
  const layerId = useEditor(ed, (s) => s.layerId);
  const floor = doc.floors.find((f) => f.id === floorId) ?? doc.floors[0];
  // сверху вниз, как этажи в здании
  const floorsTop = doc.floors.map((f, i) => ({ f, i })).reverse();

  const addFloor = () => {
    const f = newFloor(tr('Этаж {0}', doc.floors.length + 1));
    ed.commit((d) => { d.floors.push(f); });
    ed.setFloor(f.id);
  };
  const renameFloor = (id: string, name: string) => {
    const v = window.prompt(tr('Новое название'), name);
    if (v && v.trim()) ed.commit((d) => { const f = d.floors.find((x) => x.id === id); if (f) f.name = v.trim(); });
  };
  const delFloor = (id: string, name: string) => {
    if (doc.floors.length < 2) { toast(tr('Нельзя удалить единственный этаж'), 'error'); return; }
    if (!window.confirm(tr('Удалить этаж «{0}» со всем содержимым?', name))) return;
    ed.commit((d) => { d.floors = d.floors.filter((f) => f.id !== id); });
  };

  const addLayer = () => {
    const l = { ...defaultLayers()[1], id: uid('l'), name: tr('Слой {0}', floor.layers.length + 1) };
    ed.commitFloor((f) => { f.layers.push(l); });
    ed.setLayer(l.id);
  };
  const delLayer = (id: string, name: string) => {
    if (floor.layers.length < 2) { toast(tr('Нельзя удалить единственный слой'), 'error'); return; }
    const n = floor.objects.filter((o) => o.layer === id).length;
    if (n && !window.confirm(tr('Удалить слой «{0}» вместе с объектами ({1})?', name, n))) return;
    ed.commitFloor((f) => { f.layers = f.layers.filter((l) => l.id !== id); f.objects = f.objects.filter((o) => o.layer !== id); });
  };
  const updLayer = (id: string, patch: Partial<(typeof floor.layers)[number]>) =>
    ed.commitFloor((f) => { const l = f.layers.find((x) => x.id === id); if (l) Object.assign(l, patch); });
  const renameLayer = (id: string, name: string) => {
    const v = window.prompt(tr('Новое название'), name);
    if (v && v.trim()) updLayer(id, { name: v.trim() });
  };

  return (
    <>
      <section className="side-sec">
        <div className="sec-head"><h3>{tr('Этажи')}</h3><button className="btn btn-sm" onClick={addFloor}>＋ {tr('Новый этаж')}</button></div>
        <ul className="list">
          {floorsTop.map(({ f, i }) => (
            <li key={f.id} className={f.id === floorId ? 'on' : ''}>
              <button className="list-main" onClick={() => ed.setFloor(f.id)} onDoubleClick={() => renameFloor(f.id, f.name)}>{f.name}</button>
              <button className="mini" title={tr('Выше')} disabled={i === doc.floors.length - 1} onClick={() => ed.commit((d) => { d.floors = move(d.floors, i, 1); })}>▲</button>
              <button className="mini" title={tr('Ниже')} disabled={i === 0} onClick={() => ed.commit((d) => { d.floors = move(d.floors, i, -1); })}>▼</button>
              <button className="mini" title={tr('Переименовать')} onClick={() => renameFloor(f.id, f.name)}>✎</button>
              <button className="mini danger" title={tr('Удалить')} onClick={() => delFloor(f.id, f.name)}>✕</button>
            </li>
          ))}
        </ul>
      </section>
      <section className="side-sec">
        <div className="sec-head"><h3>{tr('Слои')}</h3><button className="btn btn-sm" onClick={addLayer}>＋ {tr('Новый слой')}</button></div>
        <ul className="list">
          {floor.layers.map((l, i) => ({ l, i })).reverse().map(({ l, i }) => (
            <li key={l.id} className={l.id === layerId ? 'on' : ''}>
              <button className="mini" title={tr('Показать/скрыть')} onClick={() => updLayer(l.id, { visible: !l.visible })}>{l.visible ? '👁' : '◌'}</button>
              <button className="list-main" onClick={() => ed.setLayer(l.id)} onDoubleClick={() => renameLayer(l.id, l.name)}>
                {l.name}{l.aboveWalls && <span className="tag" title={tr('Над стенами — слой рисуется поверх стен')}>▲▦</span>}
              </button>
              <button className={`mini${l.aboveWalls ? ' on' : ''}`} title={tr('Над стенами — слой рисуется поверх стен')} onClick={() => updLayer(l.id, { aboveWalls: !l.aboveWalls })}>▦</button>
              <button className={`mini${l.locked ? ' on' : ''}`} title={tr('Заблокировать')} onClick={() => updLayer(l.id, { locked: !l.locked })}>{l.locked ? '🔒' : '🔓'}</button>
              <button className="mini" title={tr('Выше')} disabled={i === floor.layers.length - 1} onClick={() => ed.commitFloor((f) => { f.layers = move(f.layers, i, 1); })}>▲</button>
              <button className="mini" title={tr('Ниже')} disabled={i === 0} onClick={() => ed.commitFloor((f) => { f.layers = move(f.layers, i, -1); })}>▼</button>
              <button className="mini" title={tr('Переименовать')} onClick={() => renameLayer(l.id, l.name)}>✎</button>
              <button className="mini danger" title={tr('Удалить')} onClick={() => delLayer(l.id, l.name)}>✕</button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
