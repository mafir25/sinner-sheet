// Боковая панель с описанием узла.
import { useMemo, useRef, useState } from 'react';
import { renderMarkdown } from '../model/markdown';
import { type ItemMap, type NodeItem, type Section, isLink, isNode } from '../model/schema';

function Markdown({ src }: { src: string }) {
  const html = useMemo(() => renderMarkdown(src), [src]);
  if (!html) return null;
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}

function SectionView({ s }: { s: Section }) {
  return (
    <details className="sec">
      <summary>
        <span className="sec-title"><ColorText text={s.title || 'Без названия'} /></span>
        {s.aliases.length > 0 && <span className="sec-aliases">{s.aliases.join(', ')}</span>}
      </summary>
      <div className="sec-body">
        <Markdown src={s.body} />
        {s.children.map((c) => <SectionView key={c.id} s={c} />)}
      </div>
    </details>
  );
}

/** Заголовки с {#hex}цветом{} — без HTML, только безопасные span */
export function ColorText({ text }: { text: string }) {
  const parts: { t: string; c?: string }[] = [];
  const re = /\{(#[0-9a-fA-F]{3,8})\}([\s\S]*?)\{\}/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ t: text.slice(last, m.index) });
    parts.push({ t: m[2], c: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ t: text.slice(last) });
  return <>{parts.map((p, i) => p.c ? <span key={i} style={{ color: p.c }}>{p.t}</span> : <span key={i}>{p.t}</span>)}</>;
}

export function Sidebar({ node, items, admin, onClose, onEdit, onFocus, onToggleHidden, onCopy }: {
  node: NodeItem; items: ItemMap; admin: boolean;
  onClose: () => void; onEdit: () => void; onFocus: (id: string) => void; onToggleHidden: () => void; onCopy: () => void;
}) {
  const [width, setWidth] = useState(() => Number(localStorage.getItem('shirm.sidebarW')) || 420);
  const drag = useRef<number | null>(null);
  const [allOpen, setAllOpen] = useState<boolean | null>(null);

  const related = useMemo(() => {
    const out: { id: string; title: string; label: string; dir: '→' | '←' }[] = [];
    for (const it of Object.values(items)) {
      if (!isLink(it)) continue;
      if (it.from === node.id && isNode(items[it.to])) out.push({ id: it.to, title: (items[it.to] as NodeItem).title, label: it.label, dir: '→' });
      if (it.to === node.id && isNode(items[it.from])) out.push({ id: it.from, title: (items[it.from] as NodeItem).title, label: it.label, dir: '←' });
    }
    return out;
  }, [items, node.id]);

  return (
    <aside className="sidebar no-pan" style={{ width }}>
      <div className="sidebar-resize"
        onPointerDown={(e) => { drag.current = e.clientX + width; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (drag.current !== null) setWidth(Math.min(window.innerWidth * 0.8, Math.max(280, drag.current - e.clientX))); }}
        onPointerUp={() => { drag.current = null; localStorage.setItem('shirm.sidebarW', String(width)); }} />
      <div className="sidebar-head">
        <h2 style={{ color: node.titleColor || node.color }}>{node.title || 'Без названия'}</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Закрыть">✕</button>
      </div>
      {node.aliases.length > 0 && <div className="aliases">{node.aliases.join(', ')}</div>}
      <div className="sidebar-actions">
        {admin && <button className="btn btn-sm" onClick={onEdit}>✎ Редактировать</button>}
        {admin && <button className="btn btn-sm" onClick={onToggleHidden}>{node.hidden ? '👁 Показать игрокам' : '🌫 Скрыть'}</button>}
        <button className="btn btn-sm" onClick={onCopy} title="Скопировать узел, чтобы вставить в свою ширму">⧉ Копировать</button>
      </div>
      {node.hidden && <div className="hidden-note">Скрыт от игроков (туман войны)</div>}
      {node.image && <img className="sidebar-img" src={node.image} alt="" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />}
      {node.tags.length > 0 && (
        <div className="tags">{node.tags.map((t, i) => <span key={i} className="tag" style={{ color: t.color, borderColor: t.color }}>{t.text}</span>)}</div>
      )}
      <Markdown src={node.body} />
      {node.sections.length > 0 && (
        <div className="sections" key={String(allOpen)} ref={(el) => {
          if (el && allOpen !== null) el.querySelectorAll('details').forEach((d) => ((d as HTMLDetailsElement).open = allOpen));
        }}>
          <div className="sections-head">
            <span>Подблоки</span>
            <button className="link-btn" onClick={() => setAllOpen(true)}>развернуть все</button>
            <button className="link-btn" onClick={() => setAllOpen(false)}>свернуть</button>
          </div>
          {node.sections.map((s) => <SectionView key={s.id} s={s} />)}
        </div>
      )}
      {related.length > 0 && (
        <div className="related">
          <div className="sections-head"><span>Связи</span></div>
          {related.map((r, i) => (
            <button key={i} className="related-item" onClick={() => onFocus(r.id)}>
              <span className="dir">{r.dir}</span> {r.title || 'Без названия'} {r.label && <em>— {r.label}</em>}
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
