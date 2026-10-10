// Версии карты: снимки в браузере перед генерацией, по времени и перед возвратом версии; «Вернуть» — одно действие истории.
import { useEffect, useState } from 'react';
import type { AssetStore } from '../assets/store';
import type { MapDoc } from '../model/types';
import type { Editor } from '../state/editor';
import { type MapVersion, versions } from '../storage/idb';
import { thumbnail } from '../export/export';
import { lang, tr } from '../i18n';
import { Modal, toast } from './common';

export const AUTO_SNAPSHOT_MS = 10 * 60 * 1000;
const taken = new WeakSet<MapDoc>();
const drawn = (d: MapDoc) => d.floors.some((f) => f.rooms.length || f.walls.length || f.objects.length || f.paths.length || f.terrain.length || f.image);

/** Снимок версии карты (один раз на одно состояние документа; пустые карты не снимаются). */
export function snapshot(doc: MapDoc, assets: AssetStore, reason: MapVersion['reason']) {
  if (taken.has(doc) || !drawn(doc)) return;
  taken.add(doc);
  versions.add({ mapId: doc.id, at: Date.now(), reason, name: doc.name, thumb: thumbnail(doc, assets), doc }).catch(console.error);
}

const REASON: Record<MapVersion['reason'], string> = {
  gen: 'Перед генерацией', auto: 'Автоснимок', restore: 'Перед возвратом версии',
};

export function VersionsDialog({ ed, assets, onClose }: { ed: Editor; assets: AssetStore; onClose(): void }) {
  const [list, setList] = useState<MapVersion[] | null>(null);
  useEffect(() => { versions.list(ed.doc.id).then(setList).catch((e) => { console.error(e); setList([]); }); }, [ed]);
  const fmt = (t: number) => new Date(t).toLocaleString(lang === 'en' ? 'en-GB' : 'ru-RU', { dateStyle: 'short', timeStyle: 'short' });
  const restore = (v: MapVersion) => {
    snapshot(ed.doc, assets, 'restore');
    ed.commit((d) => { const id = d.id; Object.assign(d, structuredClone(v.doc), { id }); }, { keepSel: false });
    toast(tr('Версия от {0} возвращена (Ctrl+Z — отменить)', fmt(v.at)));
    onClose();
  };
  return (
    <Modal title={tr('Версии карты')} onClose={onClose} wide>
      <div className="stack">
        <p className="hint">{tr('Снимки хранятся в этом браузере: перед каждой генерацией и каждые 10 минут работы, последние 10. Это не замена файлу .pmmap.')}</p>
        {list && !list.length && <p className="hint">{tr('Снимков пока нет.')}</p>}
        <div className="versions">
          {list?.map((v) => (
            <div key={v.key} className="version">
              <span className="card-thumb">{v.thumb ? <img src={v.thumb} alt="" /> : null}</span>
              <span className="stack">
                <b>{fmt(v.at)}</b>
                <span className="hint">{tr(REASON[v.reason])}{v.name !== ed.doc.name ? ` · «${v.name}»` : ''}</span>
                <button className="btn btn-sm" onClick={() => restore(v)}>↺ {tr('Вернуть')}</button>
              </span>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
