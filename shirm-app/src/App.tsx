import { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from './data/firebase';
import { type ListedScreen, createScreen, deleteScreen, listScreens, loadBaseWorld, updateScreen } from './data/screens';
import { BoardStore } from './state/boardStore';
import { Panel } from './ui/Panel';
import { NotesPanel } from './ui/NotesPanel';
import { AccessModal, NewScreenModal } from './ui/ScreenDialogs';
import { DialogHost, Modal, confirmDialog } from './ui/dialogs';
import { Toasts, toast } from './ui/toast';

const LS = (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };
const LSset = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } };

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => onAuthStateChanged(auth, (u) => setUser(u)), []);

  if (user === undefined) return <div className="splash">Загрузка…</div>;
  if (user === null) {
    return (
      <div className="splash">
        <h1>Лор-Ширма</h1>
        <p>Чтобы открыть ширмы, войди в аккаунт в ХАБе.</p>
        <a className="btn btn-primary" href="custom.html">Перейти ко входу</a>
      </div>
    );
  }
  return <Workspace user={user} />;
}

function Workspace({ user }: { user: User }) {
  const email = user.email ?? '';
  const stores = useMemo(() => [new BoardStore('1'), new BoardStore('2')], []);
  const [screens, setScreens] = useState<ListedScreen[]>([]);
  const [picked, setPicked] = useState<[string, string]>([LS('shirm.panel1'), LS('shirm.panel2')]);
  const [split, setSplit] = useState(LS('shirm.split') === '1');
  const [active, setActive] = useState(0);
  const [newOpen, setNewOpen] = useState(false);
  const [settingsFor, setSettingsFor] = useState<number | null>(null);
  const [help, setHelp] = useState(false);

  const refresh = useCallback(async () => {
    const [base, mine] = await Promise.all([
      loadBaseWorld(),
      listScreens(email).catch((e) => { console.error(e); toast('Не удалось загрузить ширмы из базы', 'error'); return [] as ListedScreen[]; }),
    ]);
    const all = [...base.map((b) => ({ ...b, group: 'base' as const })), ...mine];
    setScreens(all);
    return all;
  }, [email]);

  useEffect(() => { void refresh(); }, [refresh]);

  // загрузка выбранных ширм в панели
  useEffect(() => {
    if (!screens.length) return;
    picked.forEach((id, i) => {
      const meta = screens.find((s) => s.id === id) ?? null;
      if ((stores[i].state.meta?.id ?? '') !== (meta?.id ?? '')) void stores[i].load(meta, email);
    });
  }, [picked, screens, stores, email]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (stores.some((s) => s.hasUnsaved)) { void stores.forEach((s) => s.flush()); e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [stores]);

  const pick = (i: number, id: string) => {
    const next: [string, string] = [...picked] as [string, string];
    next[i] = id; setPicked(next); LSset(`shirm.panel${i + 1}`, id);
  };

  const nick = LS('custom_nickname') || email;

  return (
    <div className="app">
      <header className="topbar">
        <nav>
          <a className="btn" href="index.html">⌂ ХАБ</a>
          <a className="btn" href="custom.html">База (custom)</a>
          <button className={`btn${split ? ' btn-on' : ''}`} onClick={() => { setSplit(!split); LSset('shirm.split', split ? '0' : '1'); }}>◫ Сплит-экран</button>
        </nav>
        <div className="topbar-right">
          <NotesPanel uid={user.uid} />
          <button className="btn" onClick={() => setHelp(true)}>? Управление</button>
          <span className="user">{nick}</span>
          <button className="btn btn-primary" onClick={() => setNewOpen(true)}>＋ Новая ширма</button>
        </div>
      </header>

      <main className={`workspace${split ? ' split' : ''}`}>
        {[0, 1].map((i) => (i === 1 && !split) ? null : (
          <Panel key={i} store={stores[i]} screens={screens} screenId={picked[i]} onPickScreen={(id) => pick(i, id)} email={email}
            active={active === i} onActivate={() => setActive(i)}
            onOpenSettings={() => setSettingsFor(i)}
            onDeleteScreen={async () => {
              const meta = stores[i].state.meta;
              if (!meta) return;
              if (!(await confirmDialog(`Удалить ширму «${meta.name}» навсегда?`, 'Все узлы, рамки и связи будут удалены. Это нельзя отменить.', true))) return;
              try { await deleteScreen(meta); toast('Ширма удалена'); pick(i, ''); await refresh(); }
              catch (e) { console.error(e); toast('Не удалось удалить ширму', 'error'); }
            }} />
        ))}
      </main>


      {newOpen && (
        <NewScreenModal onClose={() => setNewOpen(false)} onCreate={async (name, acc) => {
          try {
            const id = await createScreen(name, acc, email);
            setNewOpen(false);
            await refresh();
            pick(active, id);
            toast('Ширма создана. Правый клик по полю — создать узел.');
          } catch (e) { console.error(e); toast('Не удалось создать ширму', 'error'); }
        }} />
      )}
      {settingsFor !== null && stores[settingsFor].state.meta && (() => {
        const meta = stores[settingsFor].state.meta!;
        return (
          <AccessModal meta={meta} isCreator={meta.creatorEmail === email} onClose={() => setSettingsFor(null)}
            onSave={async (p) => {
              try {
                await updateScreen(meta.id, meta.creatorEmail === email ? p : { name: p.name });
                setSettingsFor(null);
                const all = await refresh();
                const fresh = all.find((s) => s.id === meta.id);
                if (fresh) stores.forEach((s) => s.state.meta?.id === meta.id && s.updateMeta(fresh, email));
                toast('Настройки сохранены');
              } catch (e) { console.error(e); toast('Не удалось сохранить настройки', 'error'); }
            }} />
        );
      })()}
      {help && <HelpModal onClose={() => setHelp(false)} />}
      <DialogHost />
      <Toasts />
    </div>
  );
}

function HelpModal({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['Перетаскивание по полю', 'двигать карту'], ['Колёсико', 'масштаб'], ['Клик по узлу', 'открыть описание'],
    ['Shift + перетаскивание по полю', 'выделить рамкой'], ['Shift/Ctrl + клик', 'добавить к выделению'],
    ['Перетаскивание узла', 'переместить (если ты админ ширмы)'], ['Двойной клик', 'редактировать'],
    ['Правый клик', 'меню: создать, связать, скрыть, копировать…'], ['Ctrl+Z / Ctrl+Y', 'отменить / повторить'],
    ['Ctrl+C / Ctrl+V', 'копировать / вставить (можно между ширмами)'], ['Delete', 'удалить выделенное'],
    ['F', 'показать всё (или выделенное)'], ['/', 'поиск'], ['Esc', 'снять выделение, закрыть панель'],
  ];
  return (
    <Modal title="Управление" width={560} onClose={onClose}>
      <table className="help">
        <tbody>{rows.map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}</tbody>
      </table>
      <p className="hint">Изменения сохраняются автоматически. Скрытые узлы («туман войны») вообще не загружаются у игроков.</p>
    </Modal>
  );
}
