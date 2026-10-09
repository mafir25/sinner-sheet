// Ссылки из узлов Ширмы на карты редактора карт и записи Базы знаний (этап 5 редактора карт).
import { useEffect, useState } from 'react';
import { Modal, promptDialog } from './dialogs';
import { kbMarkdown, listLocalMaps, mapMarkdown } from '../../../site/site-links.js';

type MapRow = Awaited<ReturnType<typeof listLocalMaps>>[number];

/** Выбор карты из этого браузера → markdown-ссылка. */
export function MapPicker({ onPick, onClose }: { onPick: (md: string) => void; onClose: () => void }) {
  const [list, setList] = useState<MapRow[] | null>(null);
  useEffect(() => { listLocalMaps().then(setList).catch(() => setList([])); }, []);
  return (
    <Modal title="Ссылка на карту" onClose={onClose} width={560}>
      <p className="hint" style={{ marginBottom: 10 }}>
        Карты хранятся в браузере. Ссылка откроет карту там, где её рисовали или открывали из файла .pmmap.
      </p>
      {list === null ? <p className="hint">Загрузка…</p> : !list.length ? (
        <p className="hint">В этом браузере карт нет. <a href="/maps.html" target="_blank" rel="noopener noreferrer">Открыть Редактор карт</a></p>
      ) : (
        <div className="map-pick">
          {list.map((m) => (
            <button key={m.id} type="button" className="map-pick-item" onClick={() => { onPick(mapMarkdown(m.id, m.name)); onClose(); }}>
              {m.thumb ? <img src={m.thumb} alt="" /> : <span className="map-pick-ph">🗺</span>}
              <span>{m.name || 'Без названия'}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

/** Ссылка на запись Базы знаний: вставь адрес из кнопки «Ссылка» у карточки. */
export async function askKbLink(): Promise<string | null> {
  const raw = await promptDialog('Ссылка на запись Базы знаний', '', 'Вставь ссылку из кнопки «Ссылка» у карточки');
  if (!raw) return null;
  return kbMarkdown(raw);
}
