// Окно «Район и ссылки» (этап 5): Район Города из world.json (палитра карты и контекст генерации),
// ссылка на карту для узла Ширмы, ссылки карты на записи Базы знаний.
import { useEffect, useState } from 'react';
import type { District, SiteLink } from '../model/types';
import type { Editor } from '../state/editor';
import { useEditor } from '../state/editor';
import { districtPalette, loadDistricts } from '../data/world';
import { mapMarkdown, siteLink } from '../../../site/site-links.js';
import { lang, tr } from '../i18n';
import { Field, Modal, toast } from './common';

export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { window.prompt(tr('Скопируй вручную:'), text); return false; }
}

/** Открывает ссылку сайта в новой вкладке. */
export const openLink = (url: string) => window.open(url, '_blank', 'noopener');

export function LinksDialog({ ed, onClose }: { ed: Editor; onClose(): void }) {
  const doc = useEditor(ed, (s) => s.doc);
  const [districts, setDistricts] = useState<District[] | null>(null);
  const [palette, setPalette] = useState(true);
  const [paste, setPaste] = useState('');
  useEffect(() => { void loadDistricts(lang).then(setDistricts); }, []);

  const setDistrict = (d: District | undefined) => {
    ed.commit((x) => {
      if (d) x.district = d; else delete x.district;
      if (d && palette) {
        const p = districtPalette(d.color);
        x.background = p.background;
        x.lighting = { ...x.lighting, color: p.darkness };
      }
    });
    if (d && palette) ed.setSettings({ label: { ...ed.state.settings.label, color: districtPalette(d.color).label } });
  };
  const links = doc.links ?? [];
  const setLinks = (next: SiteLink[]) => ed.commit((x) => { if (next.length) x.links = next; else delete x.links; });
  const add = () => {
    const l = siteLink(paste);
    if (!l) { toast(tr('Это не похоже на ссылку'), 'error'); return; }
    setLinks([...links, l]);
    setPaste('');
  };
  const md = mapMarkdown(doc.id, doc.name);

  return (
    <Modal title={tr('Район и ссылки')} onClose={onClose} wide>
      <div className="stack">
        <h3>{tr('Район Города')}</h3>
        <p className="hint">{tr('Цвета Районов — с карты Города в Ширме (world.json). Район окрашивает карту и подсказывает генерации, что ставить: правила «Районы / фракции», оттенок стен и света, вывеска Крыла у входа.')}</p>
        <div className="row">
          <Field label={tr('Район')}>
            <select className="input" value={doc.district?.id ?? ''} disabled={!districts}
              onChange={(e) => setDistrict(districts?.find((d) => d.id === e.target.value))}>
              <option value="">{districts ? tr('Не выбран') : tr('Загрузка…')}</option>
              {doc.district && districts && !districts.some((d) => d.id === doc.district!.id) && <option value={doc.district.id}>{doc.district.name}</option>}
              {districts?.map((d) => <option key={d.id} value={d.id}>{d.name}{d.faction ? ` — ${d.faction}` : ''}</option>)}
            </select>
          </Field>
          {doc.district && <span className="swatch" style={{ background: doc.district.color }} title={doc.district.color} />}
        </div>
        <label className="check"><input type="checkbox" checked={palette} onChange={(e) => setPalette(e.target.checked)} /> {tr('Применить палитру: фон, цвет темноты, цвет новых подписей')}</label>
        {doc.district?.wing && <p className="hint">{tr('Крыло {0}: вывески — Assets/Maps/scalable/signs/wings/{1}-corp/ (если есть).', doc.district.wing, doc.district.wing.toLowerCase())}</p>}

        <div className="subsec stack">
          <h3>{tr('Ссылка для Ширмы')}</h3>
          <p className="hint">{tr('Вставь в описание узла Ширмы (или нажми 🗺 в его редакторе). Карта откроется в этом браузере; на другом устройстве сначала открой её файл .pmmap.')}</p>
          <div className="row">
            <input className="input" readOnly value={md} onFocus={(e) => e.target.select()} />
            <button className="btn btn-sm" onClick={async () => { if (await copyText(md)) toast(tr('Ссылка скопирована')); }}>{tr('Копировать')}</button>
          </div>
        </div>

        <div className="subsec stack">
          <h3>{tr('Ссылки карты')}</h3>
          <p className="hint">{tr('Записи Базы знаний (кнопка «Ссылка» у карточки) и другие страницы сайта, связанные с картой. Ссылку можно дать и отдельной подписи — в её свойствах.')}</p>
          {links.map((l, i) => (
            <div key={i} className="row">
              <input className="input" defaultValue={l.title} key={l.title}
                onBlur={(e) => { const t = e.target.value.trim(); if (t && t !== l.title) setLinks(links.map((x, j) => (j === i ? { ...x, title: t } : x))); }} />
              <button className="btn btn-sm" title={l.url} onClick={() => openLink(l.url)}>↗</button>
              <button className="mini danger" title={tr('Удалить')} onClick={() => setLinks(links.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <form className="row" onSubmit={(e) => { e.preventDefault(); add(); }}>
            <input className="input" value={paste} placeholder={tr('Вставь ссылку из Базы знаний…')} onChange={(e) => setPaste(e.target.value)} />
            <button className="btn btn-sm" type="submit" disabled={!paste.trim()}>＋ {tr('Добавить')}</button>
          </form>
        </div>
        <div className="row end"><button className="btn" onClick={onClose}>{tr('Закрыть')}</button></div>
      </div>
    </Modal>
  );
}
