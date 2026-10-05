// Создание ширмы, доступы, быстрый импорт из базы сайта.
import { useEffect, useState } from 'react';
import { Modal } from './dialogs';
import { renderMarkdown } from '../model/markdown';
import { type AccessLevel, type NodeItem, type ScreenMeta, emptyNode, uid } from '../model/schema';
import { type ImportCategory, clearLegacyData, loadImportList } from '../data/screens';
import { confirmDialog } from './dialogs';
import { toast } from './toast';

const ACCESS: { v: AccessLevel; t: string; d: string }[] = [
  { v: 'private', t: 'Приватная', d: 'Только ты и те, кого добавишь в доступы' },
  { v: 'friends', t: 'Для друзей', d: 'Ты и люди из списков зрителей и админов' },
  { v: 'public', t: 'Публичная', d: 'Видят все авторизованные пользователи сайта' },
];

export function NewScreenModal({ onCreate, onClose }: { onCreate: (name: string, a: AccessLevel) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  const [acc, setAcc] = useState<AccessLevel>('private');
  return (
    <Modal title="Новая ширма" width={480} onClose={onClose} footer={
      <><span className="grow" /><button className="btn" onClick={onClose}>Отмена</button>
        <button className="btn btn-primary" disabled={!name.trim()} onClick={() => onCreate(name.trim(), acc)}>Создать</button></>
    }>
      <div className="form">
        <label>Название<input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></label>
        <div className="radio-list">
          {ACCESS.map((a) => (
            <label key={a.v} className="radio"><input type="radio" checked={acc === a.v} onChange={() => setAcc(a.v)} />
              <span><b>{a.t}</b><small>{a.d}</small></span></label>
          ))}
        </div>
      </div>
    </Modal>
  );
}

const split = (s: string) => s.split(/[,\s;]+/).map((x) => x.trim().toLowerCase()).filter((x) => x.includes('@'));

export function AccessModal({ meta, isCreator, onSave, onClose }: {
  meta: ScreenMeta; isCreator: boolean;
  onSave: (p: { name: string; accessLevel: AccessLevel; allowedUsers: string[]; adminUsers: string[] }) => void; onClose: () => void;
}) {
  const [name, setName] = useState(meta.name);
  const [acc, setAcc] = useState(meta.accessLevel);
  const [viewers, setViewers] = useState(meta.allowedUsers.join(', '));
  const [admins, setAdmins] = useState(meta.adminUsers.join(', '));
  return (
    <Modal title="Настройки ширмы" width={560} onClose={onClose} footer={
      <><span className="grow" /><button className="btn" onClick={onClose}>Отмена</button>
        <button className="btn btn-primary" onClick={() => onSave({ name: name.trim() || meta.name, accessLevel: acc, allowedUsers: split(viewers), adminUsers: split(admins) })}>Сохранить</button></>
    }>
      <div className="form">
        <label>Название<input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        {isCreator ? (
          <>
            <div className="radio-list">
              {ACCESS.map((a) => (
                <label key={a.v} className="radio"><input type="radio" checked={acc === a.v} onChange={() => setAcc(a.v)} />
                  <span><b>{a.t}</b><small>{a.d}</small></span></label>
              ))}
            </div>
            <label>Зрители (email через запятую)
              <textarea className="input" rows={3} value={viewers} onChange={(e) => setViewers(e.target.value)} placeholder="player1@mail.com, player2@mail.com" />
            </label>
            <label>Администраторы — могут редактировать (email через запятую)
              <textarea className="input" rows={3} value={admins} onChange={(e) => setAdmins(e.target.value)} placeholder="gm2@mail.com" />
            </label>
          </>
        ) : <p className="hint">Доступы может менять только создатель ширмы ({meta.creatorEmail}).</p>}
        {isCreator && meta.hasLegacyData && (
          <div className="legacy-box">
            <p className="hint">У ширмы осталась копия в старом формате — её видит старая страница (shirm-legacy.html), и из неё игроки технически могут прочитать скрытые узлы. Когда новая Ширма будет на сайте, эту копию стоит удалить. Резервная копия для админов останется.</p>
            <button className="btn btn-danger btn-sm" onClick={async () => {
              if (!(await confirmDialog('Удалить старую копию данных?', 'Старая страница перестанет показывать эту ширму.', true))) return;
              try { await clearLegacyData(meta.id); meta.hasLegacyData = false; toast('Старая копия удалена'); } catch { toast('Не удалось удалить', 'error'); }
            }}>Удалить старую копию</button>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- импорт
const TYPES: Record<string, { name: string; color: string }> = { Burn: { name: 'Огонь', color: '#C7243A' }, Bleed: { name: 'Кровотечение', color: '#E67E22' }, Tremor: { name: 'Тремор', color: '#F1C40F' }, Rupture: { name: 'Разрыв', color: '#40E0D0' }, Sinking: { name: 'Утопание', color: '#45B3CB' }, Poise: { name: 'Уверенность', color: '#1E3A8A' }, Charge: { name: 'Заряд', color: '#9B59B6' }, Other: { name: 'Иное/Другое', color: '#27AE60' }, None: { name: 'Пустой/Физ.', color: '#696969' } };
const FEAT_BASES: Record<string, { name: string; color: string }> = { Background: { name: 'Предыстория', color: '#696969' }, Body: { name: 'Тело', color: '#E67E22' }, Mind: { name: 'Разум', color: '#1E3A8A' }, 'Martial Arts': { name: 'Боевые искусства', color: '#45B3CB' }, Affiliation: { name: 'Принадлежность', color: '#F1C40F' }, Weapon: { name: 'Оружие', color: '#C7243A' }, Status: { name: 'Статус', color: '#8FCC2A' }, Sin: { name: 'Грех', color: '#45B3CB' }, 'Shin and Mang': { name: 'Шин и Манг', color: '#D94285' }, 'E.G.O Feats': { name: 'Черты Э.Г.О.', color: '#27AE60' } };
const BEAST: Record<string, { name: string; color: string }> = { ZAYIN: { name: 'ZAYIN', color: '#27AE60' }, TETH: { name: 'TETH', color: '#45B3CB' }, HE: { name: 'HE', color: '#F1C40F' }, WAW: { name: 'WAW', color: '#9B59B6' }, ALEPH: { name: 'ALEPH', color: '#C7243A' }, City: { name: 'Город', color: '#696969' }, Distortions: { name: 'Искажения', color: '#E0D8C8' } };
const CAT_COLORS: Record<ImportCategory, string> = { status: '#45B3CB', class: '#1E3A8A', feat: '#C7243A', gift: '#E67E22', equip: '#9B59B6', bestiary: '#8FCC2A' };
const CATS: { v: ImportCategory; t: string }[] = [
  { v: 'status', t: 'Статусы' }, { v: 'class', t: 'Архетипы' }, { v: 'feat', t: 'Черты' }, { v: 'gift', t: 'Э.Г.О. Гифты' }, { v: 'equip', t: 'Снаряжение' }, { v: 'bestiary', t: 'Бестиарий' },
];

const tagsOf = (v: unknown, dict: Record<string, { name: string; color: string }>) =>
  (Array.isArray(v) ? v : v ? [v] : []).map((t: any) => ({ text: dict[t]?.name ?? String(t), color: dict[t]?.color ?? '#40E0D0' }));

/** Переводит запись из базы сайта в узел ширмы (та же логика, что в старой Ширме). */
export function importToNode(d: any, cat: ImportCategory, x: number, y: number): NodeItem {
  const n = emptyNode(x, y);
  n.title = String(d.Name || d.characterName || 'Без названия');
  n.shape = 'square'; n.color = CAT_COLORS[cat];
  const sec = (title: string, body: string) => ({ id: uid('s'), title, aliases: [], body: body || '', children: [] });
  let body = '';
  if (cat === 'status') {
    body = d.Effect || '';
    for (const se of d.SideEffects ?? []) n.sections.push(sec(se.sideeffectname, se.sideeffect));
  } else if (cat === 'class') {
    n.tags = tagsOf(d.Type, TYPES);
    body = `**Статы:** ${(d.Stats || []).join(', ')}`;
    for (const t of d.Talents ?? []) n.sections.push(sec(`[Ур. ${t.level}] ${t.name}`, t.desc));
  } else if (cat === 'feat') {
    n.tags = tagsOf(d.Base, FEAT_BASES);
    if (d.Need) body += `**Требования:** ${d.Need}\n\n`;
    body += d.desc || '';
  } else if (cat === 'gift') {
    n.tags = [...tagsOf(d.Type, TYPES), { text: `Ур. ${d.Level}`, color: '#E67E22' }];
    body = d.Description || '';
  } else if (cat === 'equip') {
    n.tags = [...tagsOf(d.Type, TYPES), { text: `Ур. ${d.Level}`, color: '#E67E22' }];
    if (d.Rarity) n.tags.push({ text: String(d.Rarity), color: '#9B59B6' });
    if (d.Need) body += `**Требования:** ${d.Need}\n\n`;
    if (d.Stats) body += `**Скейлинг:** ${(d.Stats || []).join(', ')}\n\n`;
    body += d.Desc || '';
  } else if (cat === 'bestiary') {
    n.tags = tagsOf(d.Category, BEAST);
    if (d.Meta) body += `*${d.Meta}*\n\n`;
    body += `**КД:** ${d.ArmorClass} | **ХП:** ${d.HitPoints} | **Скорость:** ${d.Speed}\n`;
    if (d.Stats) body += `**STR:** ${d.Stats.STR} | **DEX:** ${d.Stats.DEX} | **CON:** ${d.Stats.CON} | **INT:** ${d.Stats.INT} | **WIS:** ${d.Stats.WIS} | **CHA:** ${d.Stats.CHA}\n\n`;
    body += d.Lore || '';
    for (const t of d.Traits ?? []) n.sections.push(sec(`(Особенность) ${t.name}`, t.desc));
    for (const a of d.Actions ?? []) n.sections.push(sec(`(Действие) ${a.name}`, a.desc));
  }
  n.body = body;
  return n;
}

export function ImportModal({ email, onImport, onClose }: { email: string; onImport: (n: (x: number, y: number) => NodeItem) => void; onClose: () => void }) {
  const [cat, setCat] = useState<ImportCategory>('status');
  const [src, setSrc] = useState<'official' | 'custom'>('official');
  const [list, setList] = useState<any[] | null>(null);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<number | null>(null);
  useEffect(() => {
    let alive = true; setList(null); setPick(null);
    loadImportList(cat, src, email).then((l) => alive && setList(l)).catch(() => alive && setList([]));
    return () => { alive = false; };
  }, [cat, src, email]);
  const filtered = (list ?? []).map((d, i) => ({ d, i, name: String(d.Name || d.characterName || 'Без названия') }))
    .filter((x) => x.name.toLowerCase().includes(q.toLowerCase()));
  const preview = pick !== null && list ? importToNode(list[pick], cat, 0, 0) : null;
  return (
    <Modal title="Быстрый импорт из базы" width={720} onClose={onClose} footer={
      <><span className="grow" /><button className="btn" onClick={onClose}>Отмена</button>
        <button className="btn btn-primary" disabled={pick === null} onClick={() => list && pick !== null && onImport((x, y) => importToNode(list[pick], cat, x, y))}>Добавить на доску</button></>
    }>
      <div className="row">
        <select className="input" value={cat} onChange={(e) => setCat(e.target.value as ImportCategory)}>{CATS.map((c) => <option key={c.v} value={c.v}>{c.t}</option>)}</select>
        <select className="input" value={src} onChange={(e) => setSrc(e.target.value as any)}><option value="official">Официальные</option><option value="custom">Пользовательские</option></select>
        <input className="input grow" placeholder="Фильтр…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="import-grid">
        <div className="import-list">
          {list === null ? <div className="hint">Загрузка…</div> : filtered.length === 0 ? <div className="hint">Нет данных</div> :
            filtered.map((x) => <button key={x.i} className={`import-item${pick === x.i ? ' on' : ''}`} onClick={() => setPick(x.i)}>{x.name}</button>)}
        </div>
        <div className="import-preview">
          {preview ? (
            <>
              <h4>{preview.title}</h4>
              <div className="tags">{preview.tags.map((t, i) => <span key={i} className="tag" style={{ color: t.color, borderColor: t.color }}>{t.text}</span>)}</div>
              <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(preview.body) }} />
              {preview.sections.length > 0 && <div className="hint">+ подблоков: {preview.sections.length}</div>}
            </>
          ) : <div className="hint">Выбери элемент слева</div>}
        </div>
      </div>
    </Modal>
  );
}
