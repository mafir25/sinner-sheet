/* Офис (office.html).
   Данные: offices/<id> в Firestore + подколлекция offices/<id>/agents (досье агентов)
   + offices/<id>/cards (открытые карточки досье: только поля, разрешённые настройками приватности).
   Полное досье читают менеджер и владелец досье, остальные участники — только карточки (это проверяют правила).
   Права проверяет firestore.rules: офис меняет создатель (менеджер); участник может добавить своё досье,
   обновлять досье, привязанные к нему, и покинуть офис.

   Как устроено:
   1. Открытый офис и его агенты слушаются в реальном времени (onSnapshot) — после любой записи
      страница перерисовывается из пришедшего снимка, без повторной загрузки всего офиса.
   2. Списки внутри документа (сводки, контракты, репутация, казна, склад) меняются транзакцией mutate():
      читаем свежий документ → меняем массив целиком → записываем. Так правка или удаление не «промахиваются»,
      даже если объект в базе отличается от того, что в памяти.
   3. Всё, что пришло из базы, выводится через esc() / safeUrl() / md() (DOMPurify). */
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where, onSnapshot,
  runTransaction, writeBatch, arrayUnion, arrayRemove, deleteField,
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';
import { db } from './firebase.js';
import { onAuth, findUserByNick, nicknamesOf } from './auth.js';

const T = (s) => (window.I18N ? window.I18N.t(s) : s);
const $ = (id) => document.getElementById(id);
const LOCALE = () => (window.I18N?.lang === 'en' ? 'en-US' : 'ru-RU');

/* ---------------- Безопасный вывод ---------------- */
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC_MAP[c]);
// только http(s) или относительные пути к картинкам сайта
const safeUrl = (v) => {
  const u = String(v ?? '').trim();
  if (/^https?:\/\/[^\s"'<>()\\]+$/i.test(u) || /^[\w\-./]+\.(png|jpe?g|gif|webp|svg|avif)$/i.test(u)) return u;
  return '';
};
if (window.DOMPurify) {
  window.DOMPurify.addHook('afterSanitizeAttributes', (n) => {
    if (n.tagName === 'A') { n.setAttribute('target', '_blank'); n.setAttribute('rel', 'noopener noreferrer'); }
  });
}
function md(text) {
  const src = String(text ?? '');
  try {
    return window.DOMPurify.sanitize(window.marked.parse(src, { breaks: true, gfm: true }), {
      FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select'], FORBID_ATTR: ['style'],
    });
  } catch (e) { return esc(src).replace(/\r?\n/g, '<br>'); }
}
const fmtNum = (n, digits = 0) => Number(n || 0).toLocaleString(LOCALE(), { maximumFractionDigits: digits });
const fmtTime = (ts) => new Date(ts).toLocaleString(LOCALE(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* id остаются в старом формате (строка из Date.now()), но не повторяются внутри списка.
   Дубли, оставшиеся от старых версий, менеджер чинит автоматически при открытии офиса (normalizeOffice). */
function newId(list, prefix = '') {
  const used = new Set((list || []).map((x) => String(x?.id)));
  let n = Date.now();
  while (used.has(prefix + n)) n++;
  return prefix + n;
}

/* ---------------- Константы ---------------- */
const GRADES = { 1: 'ЦВЕТНОЙ', 2: '1 РАНГ', 3: '2 РАНГ', 4: '3 РАНГ', 5: '4 РАНГ', 6: '5 РАНГ', 7: '6 РАНГ', 8: '7 РАНГ', 9: '8 РАНГ', 10: '9 РАНГ' };
const STATUSES = {
  open: { label: 'Доступен', icon: 'fa-circle-dot' },
  taken: { label: 'Взят', icon: 'fa-person-running' },
  done: { label: 'Выполнен', icon: 'fa-circle-check' },
  failed: { label: 'Провален', icon: 'fa-skull' },
};
const STATUS_ORDER = { open: 0, taken: 1, done: 2, failed: 3 };
const ICON_PRESETS = ['Burn', 'Bleed', 'Tremor', 'Rupture', 'Sinking', 'Poise', 'Charge', 'Other', 'phis'].map((n) => `Assets/Icons/${n}.png`);
// Старые задания хранят иконку как «Burn.png» (раньше иконки лежали в корне) — на сайте её отдаёт rewrite в vercel.json.
const iconName = (ic) => ic.replace(/^.*\//, '').replace(/\.png$/, '');
const DEFAULT_CS = { name: true, race: true, class: true, feats: true, desc: true, download: true };
const LEDGER_MAX = 300;
const STOCK_MAX = 300;
const NEWS_MAX = 500;
const PRESET_MAX = 590000;
const LS_LAST = 'office.last.';
const LS_TAB = 'office.tab';
const LS_RATES = 'office.rates.v1';
const LS_BUILDER_PRESET = 'builder.v2.preset'; // пишет site/builder.js
const LS_BUILDER_STATE = 'builder.v2.state';

/* ---------------- Состояние ---------------- */
const st = {
  user: null, nick: '', nickStatus: null,
  offices: [],           // [{ id, name, creator }]
  officeId: null, office: null, isCreator: false,
  agents: [], agentsReady: false,
  full: [], cards: [], fullReady: false, cardsReady: false, cardsSync: null,
  sessions: [], sessionsState: 'loading',
  unsub: [], token: 0, normalized: new Set(),
  names: new Map(),      // uid → свежий ник
  open: { grades: new Set(), quests: new Set(), agents: new Set(), sessions: new Set() },
  edit: { news: null, rep: null, quest: null, agent: null, session: null, stock: null },
};

/* ---------------- Уведомления ---------------- */
const TOAST_ICONS = { success: 'fa-check', error: 'fa-triangle-exclamation', loading: 'fa-circle-notch fa-spin', normal: 'fa-info-circle' };
function toast(msg, type = 'normal', ms = type === 'error' ? 6000 : 3000) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `<i class="fa-solid ${TOAST_ICONS[type] || TOAST_ICONS.normal}" aria-hidden="true"></i><span></span>`;
  el.querySelector('span').textContent = T(msg);
  $('toasts').appendChild(el);
  const kill = () => { el.classList.add('out'); setTimeout(() => el.remove(), 300); };
  if (ms) setTimeout(kill, ms);
  el.addEventListener('click', kill);
  while ($('toasts').children.length > 5) $('toasts').firstElementChild.remove();
  return kill;
}
function errText(e) {
  if (e?.code === 'permission-denied') return T('Нет прав на это действие');
  if (e?.code === 'unavailable') return T('Нет связи с сервером');
  if (e?.message === 'gone') return T('Офис удалён');
  return e?.userMessage || T('Не удалось выполнить операцию');
}
/** Выполнить действие с индикатором и итоговым уведомлением. Возвращает результат или undefined при ошибке. */
async function run(fn, { busy, ok, fail } = {}) {
  const stop = busy ? toast(busy, 'loading', 0) : null;
  try {
    const r = await fn();
    stop?.();
    if (ok) toast(ok, 'success');
    return r ?? true;
  } catch (e) {
    stop?.();
    console.error(e);
    toast(`${T(fail || 'Ошибка')}: ${errText(e)}`, 'error');
    return undefined;
  }
}
const userError = (msg) => Object.assign(new Error(msg), { userMessage: T(msg) });

/* ---------------- Окна ---------------- */
const modalStack = [];
function openModal(id, focusSel) {
  const el = $(id);
  if (!el.hidden) return;
  modalStack.push({ el, back: document.activeElement });
  el.hidden = false;
  const f = (focusSel && el.querySelector(focusSel)) || el.querySelector('input:not([hidden]):not([type=hidden]), textarea, select, button');
  setTimeout(() => f?.focus(), 0);
}
function closeModal(id) {
  const el = $(id);
  if (el.hidden) return;
  el.hidden = true;
  const i = modalStack.findIndex((m) => m.el === el);
  const [m] = i >= 0 ? modalStack.splice(i, 1) : [];
  if (el.onClosed) { const cb = el.onClosed; el.onClosed = null; cb(); }
  m?.back?.focus?.();
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (modalStack.length) { e.preventDefault(); closeModal(modalStack[modalStack.length - 1].el.id); return; }
  closeDropdown();
});
document.querySelectorAll('.modal-overlay').forEach((ov) => {
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) closeModal(ov.id); });
  ov.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) { e.preventDefault(); closeModal(ov.id); } });
});

/** Своё окно подтверждения / ввода вместо confirm() и prompt(). Возвращает Promise. */
function dialog({ title = 'ПОДТВЕРЖДЕНИЕ', message = '', input = null, ok = 'ОК', danger = false, preview = false } = {}) {
  return new Promise((resolve) => {
    $('dlg-title').textContent = T(title);
    $('dlg-msg').textContent = T(message);
    const inp = $('dlg-input');
    inp.hidden = !input;
    inp.value = input?.value || '';
    inp.placeholder = input?.placeholder ? T(input.placeholder) : '';
    const pv = $('dlg-preview');
    const updPreview = () => {
      const u = safeUrl(inp.value);
      pv.style.backgroundImage = u ? `url(${JSON.stringify(u)})` : 'none';
    };
    pv.hidden = !preview;
    if (preview) { updPreview(); inp.oninput = updPreview; } else inp.oninput = null;
    const okBtn = $('dlg-ok');
    okBtn.textContent = T(ok);
    okBtn.className = `btn ${danger ? 'red' : 'cyan'}`;
    let result = input ? null : false;
    $('dialog-form').onsubmit = (e) => {
      e.preventDefault();
      result = input ? inp.value : true;
      closeModal('dialogModal');
    };
    $('dialogModal').onClosed = () => resolve(result);
    openModal('dialogModal', input ? '#dlg-input' : '#dlg-ok');
  });
}
const confirmDlg = (message, opts = {}) => dialog({ message, ok: opts.ok || 'ПОДТВЕРДИТЬ', danger: opts.danger ?? true, title: opts.title });

/* ---------------- Меню офисов ---------------- */
function closeDropdown() {
  $('office-dropdown').classList.remove('active');
  $('office-dropdown-btn').setAttribute('aria-expanded', 'false');
}
$('office-dropdown-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  const on = !$('office-dropdown').classList.contains('active');
  $('office-dropdown').classList.toggle('active', on);
  $('office-dropdown-btn').setAttribute('aria-expanded', String(on));
  if (on) $('office-list').querySelector('button')?.focus();
});
document.addEventListener('click', (e) => { if (!e.target.closest('.dropdown')) closeDropdown(); });

function renderOfficeList() {
  const list = $('office-list');
  if (!st.user) { list.innerHTML = `<div class="dropdown-item muted">${esc(T('Войдите в аккаунт'))}</div>`; return; }
  list.innerHTML = st.offices.map((o) => `
    <button class="dropdown-item${o.id === st.officeId ? ' current' : ''}" data-act="open-office" data-id="${esc(o.id)}">
      <span class="notranslate">${esc(o.name || T('Без названия'))}</span>
      <span class="role">${esc(T(o.mine ? 'менеджер' : 'агент'))}</span>
    </button>`).join('')
    + `<button class="dropdown-item dropdown-create" data-act="create-office"><i class="fa-solid fa-plus" aria-hidden="true"></i> ${esc(T('СОЗДАТЬ ОФИС'))}</button>`;
}

// ник для записи в общие данные офиса — только заданный самим человеком (не начало email)
const myNick = () => String(st.user?.displayName || '').slice(0, 40);

const myEmails = () => {
  const e = st.user?.email || '';
  return [...new Set([e, e.toLowerCase()].filter(Boolean))];
};
const amCreatorOf = (d) => (d.creatorUid ? d.creatorUid === st.user.uid : myEmails().includes(d.creator));

async function loadUserOffices() {
  const u = st.user;
  const queries = [query(collection(db, 'offices'), where('memberUids', 'array-contains', u.uid))];
  // старый формат: доступ по email (в любом регистре)
  myEmails().forEach((e) => queries.push(query(collection(db, 'offices'), where('members', 'array-contains', e))));
  const found = new Map();
  let failed = 0;
  await Promise.all(queries.map(async (q) => {
    try {
      const snap = await getDocs(q);
      snap.forEach((d) => found.set(d.id, { id: d.id, name: d.data().name, mine: amCreatorOf(d.data()) }));
    } catch (e) { failed++; console.error(e); }
  }));
  if (st.user !== u) return;
  $('loading-gate').hidden = true;
  if (failed === queries.length) {
    toast('Ошибка доступа к базе офисов', 'error');
    $('office-list').innerHTML = `<div class="dropdown-item" style="color:var(--color-red)">${esc(T('Ошибка загрузки'))}</div>`;
    return;
  }
  st.offices = [...found.values()].sort((a, b) => (b.mine - a.mine) || String(a.name).localeCompare(String(b.name)));
  renderOfficeList();

  if (!st.offices.length) { showEmpty(); return; }
  if (!st.officeId || !found.has(st.officeId)) {
    let last = null;
    try { last = localStorage.getItem(LS_LAST + u.uid); } catch (e) { /* ignore */ }
    openOffice(found.has(last) ? last : st.offices[0].id);
  }
}

function showEmpty() {
  stopListening();
  st.officeId = null; st.office = null; setCreator(false);
  $('office-workspace').hidden = true;
  $('empty-gate').hidden = false;
  $('empty-nick').textContent = st.nickStatus === 'ok'
    ? `${T('Ваш никнейм:')} ${st.nick}`
    : T('Сначала задайте никнейм в настройках — по нему вас добавят в Офис.');
}

/* ---------------- Открытие офиса ---------------- */
function stopListening() {
  st.unsub.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });
  st.unsub = [];
  setSync('off');
}
function setSync(mode) {
  const d = $('sync-dot');
  d.className = 'sync-dot' + (mode === 'live' ? ' live' : mode === 'err' ? ' err' : '');
  d.title = T(mode === 'live' ? 'Синхронизация в реальном времени' : mode === 'err' ? 'Связь с офисом потеряна' : 'Нет связи с офисом');
}
function setCreator(on) {
  st.isCreator = on;
  document.body.classList.toggle('is-creator', on);
}

function openOffice(id) {
  closeDropdown();
  if (id === st.officeId && st.office) return;
  stopListening();
  const tok = ++st.token;
  st.officeId = id;
  st.office = null; st.agents = []; st.agentsReady = false;
  setCreator(false); // права появятся вместе с данными нового офиса
  st.open = { grades: new Set(), quests: new Set(), agents: new Set(), sessions: new Set() };
  st.sessions = []; st.sessionsState = 'loading';
  resetForms();
  $('empty-gate').hidden = true;
  $('office-workspace').hidden = false;
  try { localStorage.setItem(LS_LAST + st.user.uid, id); } catch (e) { /* ignore */ }
  renderOfficeList();
  const stopLoading = toast('Получение данных офиса...', 'loading', 0);

  const ref = doc(db, 'offices', id);
  st.unsub.push(onSnapshot(ref, (snap) => {
    if (tok !== st.token) return;
    stopLoading();
    if (!snap.exists()) {
      toast('Офис удалён или недоступен', 'error');
      st.officeId = null;
      loadUserOffices();
      return;
    }
    setSync('live');
    const first = !st.office;
    st.office = snap.data();
    setCreator(amCreatorOf(st.office));
    if (st.agentMode !== (st.isCreator ? 'creator' : 'member')) listenAgents(id, tok);
    const entry = st.offices.find((o) => o.id === id);
    if (entry && entry.name !== st.office.name) { entry.name = st.office.name; renderOfficeList(); }
    renderOffice();
    if (first) { refreshNames(); normalizeOffice(tok); }
  }, (err) => {
    if (tok !== st.token) return;
    stopLoading();
    console.error(err);
    setSync('err');
    if (err.code === 'permission-denied') {
      toast('Доступ к офису закрыт', 'error');
      st.officeId = null;
      loadUserOffices();
    } else toast(`${T('Связь с офисом потеряна')}: ${errText(err)}`, 'error');
  }));

  listenAgents(id, tok);

  st.unsub.push(onSnapshot(collection(db, 'offices', id, 'sessions'), (snap) => {
    if (tok !== st.token) return;
    st.sessions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    st.sessionsState = 'ok';
    renderSessions();
  }, (err) => {
    if (tok !== st.token) return;
    console.error(err);
    st.sessionsState = 'err';
    renderSessions();
  }));
}

/* Досье: менеджер слушает все полные досье; участник — свои полные досье и открытые карточки остальных.
   Кто менеджер, становится ясно из документа офиса, поэтому подписки на досье пересоздаются при смене роли. */
function listenAgents(id, tok) {
  st.agentUnsub?.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });
  st.agentUnsub = [];
  st.agentMode = st.isCreator ? 'creator' : 'member';
  st.full = []; st.cards = []; st.fullReady = false; st.cardsReady = st.isCreator;
  const sortAgents = (list) => list.sort((a, b) => (a.order ?? a.createdAt ?? 0) - (b.order ?? b.createdAt ?? 0));
  const update = () => {
    if (tok !== st.token) return;
    const own = new Set(st.full.map((a) => a.id));
    st.agents = sortAgents([...st.full.map((a) => ({ ...a, full: true })), ...st.cards.filter((c) => !own.has(c.id))]);
    st.agentsReady = st.fullReady && st.cardsReady;
    renderAgents();
    renderAssigneeOptions();
    if (st.agentsReady && st.isCreator) ensureCards(tok);
  };
  const fail = (err) => { if (tok !== st.token) return; console.error(err); st.fullReady = true; st.cardsReady = true; update(); };
  const agentsCol = collection(db, 'offices', id, 'agents');
  const q = st.isCreator ? agentsCol : query(agentsCol, where('ownerUid', '==', st.user.uid));
  st.agentUnsub.push(onSnapshot(q, (snap) => {
    st.full = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    st.fullReady = true;
    update();
  }, fail));
  if (!st.isCreator) {
    st.agentUnsub.push(onSnapshot(collection(db, 'offices', id, 'cards'), (snap) => {
      st.cards = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      st.cardsReady = true;
      update();
    }, fail));
  }
  st.unsub.push(() => st.agentUnsub.forEach((f) => f()));
}

/* Перевод офиса на новый формат и починка старых данных. Делает менеджер; участник — только свою запись. */
async function normalizeOffice(tok) {
  const d = st.office;
  if (!d || st.normalized.has(st.officeId)) return;
  st.normalized.add(st.officeId);
  const ref = doc(db, 'offices', st.officeId);
  const uid = st.user.uid;
  const nick = myNick();

  try {
    if (st.isCreator) {
      // досье из старого массива characters → подколлекция agents (id детерминированные — повтор безопасен)
      const legacy = Array.isArray(d.characters) ? d.characters : [];
      // по одному досье за пачку: правила карточки читают досье, а на пачку есть лимит обращений к документам
      for (const [i, c] of legacy.entries()) {
        const raw = c.rawJson && typeof c.rawJson === 'object' ? c.rawJson : null;
        await putAgent(`legacy_${String(c.id || '').replace(/[^\w-]/g, '')}_${i}`, {
          name: c.name, race: c.race, className: c.className, level: raw?.level ?? null,
          feats: featNames(c.feats), description: c.description || raw?.desc || '',
          presetJson: raw ? JSON.stringify(raw) : '', ownerUid: '', ownerName: '',
          createdAt: Number(c.id) || Date.now() + i, updatedAt: Date.now(), order: i,
        }, d);
      }
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return;
        const o = snap.data();
        const patch = {};
        if (!o.creatorUid) patch.creatorUid = uid;
        if (!(o.memberUids || []).includes(uid)) patch.memberUids = arrayUnion(uid);
        if (nick && (o.memberNames || {})[uid] !== nick) patch[`memberNames.${uid}`] = nick;
        if (Array.isArray(o.characters)) patch.characters = deleteField();
        if (o.schema !== 2) patch.schema = 2;
        // дубли id в списках
        ['news', 'reputations', 'customQuests'].forEach((k) => {
          const list = Array.isArray(o[k]) ? o[k] : [];
          const seen = new Set();
          let changed = false;
          const fixed = list.map((x) => {
            if (!x || typeof x !== 'object') return x;
            let id = String(x.id ?? '');
            if (!id || seen.has(id)) { id = newId([...list, ...[...seen].map((s) => ({ id: s }))], k === 'customQuests' ? 'custom_' : ''); changed = true; }
            seen.add(id);
            return id === x.id ? x : { ...x, id };
          });
          if (changed) patch[k] = fixed;
        });
        // в видимых остались только существующие контракты (системные квесты больше не загружаются)
        const quests = patch.customQuests || o.customQuests || [];
        const ids = new Set(quests.map((q) => q.id));
        const active = Array.isArray(o.activeQuests) ? o.activeQuests : [];
        const cleanActive = [...new Set(active.filter((x) => ids.has(x)))];
        if (cleanActive.length !== active.length) patch.activeQuests = cleanActive;
        if (Object.keys(patch).length) tx.update(ref, patch);
      });
    } else {
      // участник по старому списку email переносит себя в memberUids; заодно обновляет своё имя
      const patch = {};
      if (!(d.memberUids || []).includes(uid)) patch.memberUids = arrayUnion(uid);
      const emails = myEmails().filter((e) => (d.members || []).includes(e));
      if (emails.length) patch.members = arrayRemove(...emails);
      if (nick && (d.memberNames || {})[uid] !== nick) patch[`memberNames.${uid}`] = nick;
      if (Object.keys(patch).length) await updateDoc(ref, patch);
    }
  } catch (e) {
    if (tok === st.token) console.warn('Не удалось обновить формат офиса', e);
  }
}

/** Транзакция над документом офиса: fn(data) → патч или null. */
async function mutate(fn) {
  const ref = doc(db, 'offices', st.officeId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('gone');
    const patch = fn(snap.data());
    if (patch && Object.keys(patch).length) tx.update(ref, patch);
    return patch;
  });
}
const listOf = (d, k) => (Array.isArray(d?.[k]) ? d[k] : []);

/* ---------------- Отрисовка офиса ---------------- */
function renderOffice() {
  const d = st.office;
  if (!d) return;
  const name = $('office-name');
  if (document.activeElement !== name) name.value = d.name || '';
  name.readOnly = !st.isCreator;
  name.title = st.isCreator ? T('Нажмите, чтобы переименовать') : '';

  const logo = safeUrl(d.logoUrl);
  const la = $('office-logo');
  la.style.backgroundImage = logo ? `url(${JSON.stringify(logo)})` : 'none';
  la.classList.toggle('has-logo', !!logo);
  la.disabled = !st.isCreator;
  la.setAttribute('aria-label', T(st.isCreator ? 'Изменить логотип' : 'Логотип офиса'));

  $('role-badge').textContent = T(st.isCreator ? '[ МЕНЕДЖЕР ОФИСА ]' : '[ АГЕНТ ОФИСА ]');

  const cs = { ...DEFAULT_CS, ...(d.charSettings || {}) };
  document.querySelectorAll('[data-cs]').forEach((cb) => { cb.checked = !!cs[cb.dataset.cs]; });

  renderMembers();
  renderAgents();
  renderBoard();
  renderNews();
  renderSessions();
  renderReps();
  renderBank();
  renderStock();
  renderAssigneeOptions();
  if (!$('questManagerModal').hidden) renderQuestManager();
}

/* ---------------- Участники ---------------- */
async function refreshNames() {
  const uids = st.office?.memberUids || [];
  if (!uids.length) return;
  const names = await nicknamesOf(uids);
  names.forEach((n, uid) => st.names.set(uid, n));
  renderMembers();
  renderAgents();
}
const nameOf = (uid) => st.names.get(uid) || st.office?.memberNames?.[uid] || T('Без ника');

function renderMembers() {
  const box = $('members-list');
  if (!st.isCreator || !st.office) { box.innerHTML = ''; return; }
  const d = st.office;
  const rows = (d.memberUids || []).map((uid) => {
    const me = uid === st.user.uid;
    const tool = me
      ? `<span class="tag yellow">${esc(T('МЕНЕДЖЕР'))}</span>`
      : `<button class="icon-btn danger" data-act="remove-member" data-uid="${esc(uid)}" aria-label="${esc(T('Отозвать доступ'))}" title="${esc(T('Отозвать доступ'))}"><i class="fa-solid fa-user-minus" aria-hidden="true"></i></button>`;
    return `<div class="member-item"><span class="who notranslate">${esc(nameOf(uid))}</span>${tool}</div>`;
  });
  (d.members || []).filter((e) => !myEmails().includes(e)).forEach((email) => {
    rows.push(`<div class="member-item" title="${esc(T('Старый доступ по email: участник перейдёт на никнейм, когда сам откроет Офис'))}">
      <span class="who notranslate muted">${esc(email)}</span>
      <span class="row"><span class="tag dim">EMAIL</span>
      <button class="icon-btn danger" data-act="remove-email" data-email="${esc(email)}" aria-label="${esc(T('Отозвать доступ'))}" title="${esc(T('Отозвать доступ'))}"><i class="fa-solid fa-user-minus" aria-hidden="true"></i></button></span></div>`);
  });
  box.innerHTML = rows.join('') || `<p class="hint">${esc(T('Пока только вы.'))}</p>`;
}

$('member-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('new-member-nick');
  const nick = input.value.trim();
  if (!nick || !st.isCreator) return;
  await run(async () => {
    const found = await findUserByNick(nick);
    if (!found) throw userError('Аккаунт с таким никнеймом не найден. Игрок должен задать никнейм в настройках сайта (⚙)');
    if ((st.office.memberUids || []).includes(found.uid)) throw userError('Этот фиксер уже в офисе');
    await updateDoc(doc(db, 'offices', st.officeId), { memberUids: arrayUnion(found.uid), [`memberNames.${found.uid}`]: found.nick });
    st.names.set(found.uid, found.nick);
    input.value = '';
  }, { busy: 'Добавление агента...', ok: `${T('Агент добавлен:')} ${nick}`, fail: 'Ошибка добавления' });
});

async function removeMember(uid) {
  if (!await confirmDlg(`${T('Отозвать доступ к Офису у')} ${nameOf(uid)}?`)) return;
  await run(() => updateDoc(doc(db, 'offices', st.officeId), { memberUids: arrayRemove(uid), [`memberNames.${uid}`]: deleteField() }),
    { busy: 'Отзыв доступа...', ok: 'Доступ отозван', fail: 'Ошибка отзыва доступа' });
}
async function removeEmail(email) {
  if (!await confirmDlg(`${T('Отозвать доступ к Офису у')} ${email}?`)) return;
  await run(() => updateDoc(doc(db, 'offices', st.officeId), { members: arrayRemove(email) }),
    { busy: 'Отзыв доступа...', ok: 'Доступ отозван', fail: 'Ошибка отзыва доступа' });
}

/* ---------------- Название, логотип, приватность ---------------- */
$('office-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  if (e.key === 'Escape') { e.target.value = st.office?.name || ''; e.target.blur(); }
});
$('office-name').addEventListener('blur', async (e) => {
  if (!st.isCreator || !st.office) return;
  const name = e.target.value.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!name) { e.target.value = st.office.name || ''; toast('Название не может быть пустым', 'error'); return; }
  if (name === st.office.name) { e.target.value = name; return; }
  const ok = await run(() => updateDoc(doc(db, 'offices', st.officeId), { name }), { ok: 'Название сохранено', fail: 'Ошибка сохранения имени' });
  if (ok) {
    const entry = st.offices.find((o) => o.id === st.officeId);
    if (entry) { entry.name = name; renderOfficeList(); }
  } else e.target.value = st.office.name || '';
});

async function changeLogo() {
  if (!st.isCreator) return;
  const url = await dialog({
    title: 'ЛОГОТИП ОФИСА', message: 'Прямая ссылка на изображение (http:// или https://). Оставьте пустым, чтобы убрать логотип.',
    input: { value: st.office.logoUrl || '', placeholder: 'https://...' }, ok: 'СОХРАНИТЬ', preview: true,
  });
  if (url === null) return;
  const clean = safeUrl(url);
  if (url.trim() && !clean) { toast('Нужна прямая ссылка на изображение (http:// или https://)', 'error'); return; }
  await run(() => updateDoc(doc(db, 'offices', st.officeId), { logoUrl: clean }), { ok: 'Логотип обновлён', fail: 'Ошибка обновления логотипа' });
}

document.querySelectorAll('[data-cs]').forEach((cb) => cb.addEventListener('change', async () => {
  if (!st.isCreator) return;
  const settings = {};
  document.querySelectorAll('[data-cs]').forEach((x) => { settings[x.dataset.cs] = x.checked; });
  // сначала настройки (правила сверяют карточки с ними), затем карточки всех досье
  const ok = await run(async () => {
    await updateDoc(doc(db, 'offices', st.officeId), { charSettings: settings });
    await rebuildCards({ ...st.office, charSettings: settings });
  }, { busy: 'Обновление карточек досье...', ok: 'Настройки приватности сохранены', fail: 'Ошибка сохранения настроек' });
  if (!ok) renderOffice();
}));

/* ---------------- Создание / удаление / выход ---------------- */
async function createOffice() {
  closeDropdown();
  if (!st.user) return;
  const name = await dialog({ title: 'НОВЫЙ ОФИС', message: 'Название офиса:', input: { value: `${T('НОВЫЙ ОФИС')} ${Math.floor(Math.random() * 1000)}` }, ok: 'СОЗДАТЬ' });
  if (name === null) return;
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, 80) || T('НОВЫЙ ОФИС');
  const ref = doc(collection(db, 'offices'));
  const ok = await run(() => setDoc(ref, {
    schema: 2, name: clean,
    creator: st.user.email, creatorUid: st.user.uid,
    memberUids: [st.user.uid], memberNames: { [st.user.uid]: myNick() }, members: [],
    logoUrl: '', news: [], customQuests: [], activeQuests: [], reputations: [],
    treasury: { balance: 0, log: [] },
    charSettings: { ...DEFAULT_CS },
    privacy: 2,
  }), { busy: 'Создание офиса...', ok: 'Офис создан', fail: 'Ошибка создания офиса' });
  if (!ok) return;
  st.offices.push({ id: ref.id, name: clean, mine: true });
  openOffice(ref.id);
}

async function deleteOffice() {
  if (!st.isCreator) return;
  const name = st.office.name || '';
  const typed = await dialog({
    title: 'УДАЛЕНИЕ ОФИСА', danger: true, ok: 'УДАЛИТЬ НАВСЕГДА',
    message: `${T('Офис, все досье, контракты, сводки и казна будут удалены без возможности восстановления.')}\n${T('Введите название офиса для подтверждения:')} ${name}`,
    input: { placeholder: name },
  });
  if (typed === null) return;
  if (typed.trim().toUpperCase() !== name.trim().toUpperCase()) { toast('Название не совпадает — офис не удалён', 'error'); return; }
  const id = st.officeId;
  const ok = await run(async () => {
    for (const sub of ['sessions', 'cards', 'agents']) {
      const docs = (await getDocs(collection(db, 'offices', id, sub))).docs;
      for (let i = 0; i < docs.length; i += 400) {
        const batch = writeBatch(db);
        docs.slice(i, i + 400).forEach((a) => batch.delete(a.ref));
        await batch.commit();
      }
    }
    stopListening();
    await deleteDoc(doc(db, 'offices', id));
  }, { busy: 'Удаление офиса...', ok: 'Офис удалён', fail: 'Ошибка удаления офиса' });
  if (!ok) return;
  st.offices = st.offices.filter((o) => o.id !== id);
  st.officeId = null; st.office = null;
  loadUserOffices();
}

async function leaveOffice() {
  if (st.isCreator) return;
  if (!await confirmDlg(`${T('Покинуть офис')} «${st.office.name}»? ${T('Вернуться можно, только если менеджер добавит вас снова.')}`)) return;
  const id = st.officeId;
  const uid = st.user.uid;
  const patch = { memberUids: arrayRemove(uid), [`memberNames.${uid}`]: deleteField() };
  const emails = myEmails().filter((e) => (st.office.members || []).includes(e));
  if (emails.length) patch.members = arrayRemove(...emails);
  stopListening();
  const ok = await run(() => updateDoc(doc(db, 'offices', id), patch), { busy: 'Выход из офиса...', ok: 'Вы покинули офис', fail: 'Ошибка' });
  st.officeId = null; st.office = null;
  if (ok) st.offices = st.offices.filter((o) => o.id !== id);
  loadUserOffices();
}

/* ---------------- Агенты ---------------- */
const featNames = (feats) => (Array.isArray(feats) ? feats : [])
  .map((f) => (typeof f === 'string' ? f : (f && (f.Name || f.name)) || ''))
  .filter(Boolean).map((s) => String(s).slice(0, 120)).slice(0, 200);

// Firestore не принимает undefined — приводим поля к допустимому виду
function cleanAgent(a) {
  const level = Number(a.level);
  return {
    name: String(a.name || T('Неизвестно')).slice(0, 120),
    race: String(a.race || '').slice(0, 120),
    className: String(a.className || '').slice(0, 120),
    level: Number.isFinite(level) && level > 0 ? Math.round(level) : null,
    feats: featNames(a.feats),
    description: String(a.description || '').slice(0, 8000),
    presetJson: String(a.presetJson || ''),
    ownerUid: String(a.ownerUid || ''),
    ownerName: String(a.ownerName || '').slice(0, 40),
    createdAt: Number(a.createdAt) || Date.now(),
    updatedAt: Number(a.updatedAt) || Date.now(),
    order: Number(a.order) || 0,
  };
}
/** Поля досье из пресета конструктора (новый формат) или старого пресета. */
function agentFieldsFromPreset(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p) || !(p.characterName || p.builder)) {
    throw userError('Файл не похож на пресет персонажа из конструктора');
  }
  const json = JSON.stringify(p);
  if (json.length > PRESET_MAX) throw userError('Пресет слишком большой для сохранения в Офисе');
  return {
    name: p.characterName || p.builder?.name || T('Неизвестно'),
    race: p.race || '', className: p.className || '', level: p.level ?? p.builder?.level ?? null,
    feats: p.feats || [], description: p.desc || p.description || '', presetJson: json,
  };
}
const presetOf = (a) => { try { return a.presetJson ? JSON.parse(a.presetJson) : null; } catch (e) { return null; } };

/** Открытая карточка досье: только поля, разрешённые настройками приватности офиса (правила сверяют её с досье). */
function cardOf(a, office = st.office) {
  const cs = { ...DEFAULT_CS, ...(office?.charSettings || {}) };
  const c = { order: a.order, createdAt: a.createdAt, updatedAt: a.updatedAt };
  if (cs.name) c.name = a.name;
  if (cs.race) c.race = a.race;
  if (cs.class) { c.className = a.className; c.level = a.level; }
  if (cs.feats) c.feats = a.feats;
  if (cs.desc) c.description = a.description;
  if (cs.download) c.presetJson = a.presetJson;
  return c;
}
/** Записать досье целиком вместе с его карточкой (одной пачкой). */
async function putAgent(id, data, office = st.office) {
  const a = cleanAgent(data);
  const batch = writeBatch(db);
  batch.set(doc(db, 'offices', st.officeId, 'agents', id), a);
  batch.set(doc(db, 'offices', st.officeId, 'cards', id), cardOf(a, office));
  await batch.commit();
  return a;
}
const fullAgent = (a) => { const { id, full, ...rest } = a; return rest; };

/* Карточки всех досье — после смены настроек приватности и при первом открытии офиса после обновления
   (флаг privacy: 2). Каждая карточка — отдельная запись (лимит обращений правил на пачку). */
async function rebuildCards(office = st.office) {
  for (const a of st.full) await setDoc(doc(db, 'offices', st.officeId, 'cards', a.id), cardOf(cleanAgent(fullAgent(a)), office));
}
async function ensureCards(tok) {
  if (!st.isCreator || st.office?.privacy === 2 || st.cardsSync === st.officeId) return;
  st.cardsSync = st.officeId;
  try {
    await rebuildCards();
    if (tok === st.token) await updateDoc(doc(db, 'offices', st.officeId), { privacy: 2 });
  } catch (e) {
    st.cardsSync = null;
    console.warn('Не удалось обновить карточки досье', e);
  }
}
const canEditAgent = (a) => !!a.full && (st.isCreator || (a.ownerUid && a.ownerUid === st.user.uid));

async function addAgentFromPreset(p, source) {
  const fields = agentFieldsFromPreset(p);
  const mine = !st.isCreator;
  const ref = doc(collection(db, 'offices', st.officeId, 'agents'));
  const maxOrder = st.agents.reduce((m, a) => Math.max(m, Number(a.order) || 0), 0);
  await putAgent(ref.id, {
    ...fields, ownerUid: mine ? st.user.uid : '', ownerName: mine ? myNick() : '',
    createdAt: Date.now(), updatedAt: Date.now(), order: maxOrder + 1,
  });
  st.open.agents.add(ref.id);
  return fields.name + (source ? ` (${T(source)})` : '');
}
async function updateAgentFromPreset(agent, p) {
  const fields = agentFieldsFromPreset(p);
  await putAgent(agent.id, { ...fullAgent(agent), ...fields, updatedAt: Date.now() });
}

function renderAgents() {
  const box = $('agents-container');
  renderBuilderCard();
  if (!st.office) { box.innerHTML = ''; return; }
  if (!st.agentsReady) { box.innerHTML = `<p class="hint">${esc(T('Загрузка...'))}</p>`; return; }
  // офис ещё не переведён на карточки (менеджер не открывал его после обновления) — чужие досье не видны
  const pending = !st.isCreator && st.office.privacy !== 2
    ? `<p class="hint">${esc(T('Досье других агентов появятся, когда менеджер откроет офис.'))}</p>` : '';
  if (!st.agents.length) { box.innerHTML = pending || `<p class="hint">${esc(T('Досье отсутствуют.'))}</p>`; return; }
  const s = { ...DEFAULT_CS, ...(st.office.charSettings || {}) };

  box.innerHTML = st.agents.map((a) => {
    const mine = a.ownerUid && a.ownerUid === st.user.uid;
    const full = st.isCreator || mine;
    const see = (k) => full || s[k];
    const canDl = (st.isCreator || mine || s.download) && !!a.presetJson;
    const name = see('name') ? esc(a.name) : esc(T('[ СЕКРЕТНО ]'));
    const owner = a.ownerUid ? (st.names.get(a.ownerUid) || a.ownerName || st.office.memberNames?.[a.ownerUid] || '') : '';
    const ownerTag = mine ? `<span class="tag cyan">${esc(T('ВЫ'))}</span>`
      : (st.isCreator && owner ? `<span class="tag dim notranslate" title="${esc(T('Игрок'))}">${esc(owner)}</span>` : '');

    const tools = [];
    if (canDl) {
      tools.push(`<button class="icon-btn" data-act="agent-download" data-id="${esc(a.id)}" title="${esc(T('Скачать пресет'))}" aria-label="${esc(T('Скачать пресет'))}"><i class="fa-solid fa-download" aria-hidden="true"></i></button>`);
      tools.push(`<button class="icon-btn" data-act="agent-to-builder" data-id="${esc(a.id)}" title="${esc(T('Открыть в конструкторе'))}" aria-label="${esc(T('Открыть в конструкторе'))}"><i class="fa-solid fa-screwdriver-wrench" aria-hidden="true"></i></button>`);
    }
    if (canEditAgent(a)) {
      tools.push(`<button class="icon-btn" data-act="agent-edit" data-id="${esc(a.id)}" title="${esc(T('Редактировать досье'))}" aria-label="${esc(T('Редактировать досье'))}"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>`);
    }
    if (st.isCreator) {
      tools.push(`<button class="icon-btn danger" data-act="agent-delete" data-id="${esc(a.id)}" title="${esc(T('Удалить досье'))}" aria-label="${esc(T('Удалить досье'))}"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>`);
    }

    let details = '';
    if (see('race') && a.race) details += `<div class="kv"><b>${esc(T('РАСА:'))}</b> <span class="notranslate">${esc(a.race)}</span></div>`;
    if (see('class') && a.className) details += `<div class="kv"><b>${esc(T('КЛАСС:'))}</b> <span class="notranslate">${esc(a.className)}</span></div>`;
    if (see('class') && a.level) details += `<div class="kv"><b>${esc(T('УРОВЕНЬ:'))}</b> ${esc(a.level)}</div>`;
    if (see('feats') && a.feats?.length) details += `<div class="kv"><b>${esc(T('ЧЕРТЫ:'))}</b> <span class="notranslate">${esc(a.feats.join(', '))}</span></div>`;
    if (see('desc') && a.description) details += `<div class="kv"><b>${esc(T('ОПИСАНИЕ:'))}</b><div class="md notranslate">${md(a.description)}</div></div>`;
    if (!details) details = `<div class="muted" style="font-style: italic;">${esc(T('Информация скрыта настройками приватности.'))}</div>`;
    if (full && a.updatedAt) details += `<div class="hint" style="margin-top:6px;">${esc(T('Обновлено:'))} ${esc(fmtTime(a.updatedAt))}</div>`;

    const open = st.open.agents.has(a.id);
    return `
      <div class="preset-card${open ? ' expanded' : ''}${mine ? ' mine' : ''}">
        <div class="preset-header">
          <button class="preset-toggle" data-act="agent-toggle" data-id="${esc(a.id)}" aria-expanded="${open}">
            <span class="nm notranslate">${name}</span>${ownerTag}
          </button>
          <div class="preset-actions">${tools.join('')}</div>
        </div>
        <div class="preset-desc">${details}</div>
      </div>`;
  }).join('') + pending;
}

function downloadAgent(a) {
  const p = presetOf(a);
  if (!p) { toast('У досье нет пресета', 'error'); return; }
  const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = String(a.name || 'Character').replace(/[\\/:*?"<>|]+/g, '_') + '_preset.json';
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function openAgentInBuilder(a) {
  const p = presetOf(a);
  if (!p) { toast('У досье нет пресета', 'error'); return; }
  if (!p.builder || p.builder.v !== 2) {
    toast('Этот пресет из старого конструктора — скачайте его и загрузите в конструкторе через «Загрузить пресет»', 'error', 8000);
    return;
  }
  const cur = readBuilderPreset();
  const msg = cur?.characterName
    ? `${T('Текущий персонаж конструктора')} «${cur.characterName}» ${T('будет заменён на')} «${a.name}». ${T('Продолжить?')}`
    : `${T('Открыть')} «${a.name}» ${T('в конструкторе?')}`;
  if (!await confirmDlg(msg, { danger: !!cur?.characterName, ok: 'ОТКРЫТЬ' })) return;
  try {
    localStorage.setItem(LS_BUILDER_STATE, JSON.stringify(p.builder));
    localStorage.removeItem(LS_BUILDER_PRESET);
  } catch (e) { toast('Не удалось записать данные в браузер', 'error'); return; }
  location.href = 'builder.html';
}

function openAgentEditor(a) {
  st.edit.agent = a.id;
  $('ag-name').value = a.name || '';
  $('ag-desc').value = a.description || '';
  const sel = $('ag-owner');
  const opts = [`<option value="">${esc(T('— не привязано —'))}</option>`]
    .concat((st.office.memberUids || []).map((uid) => `<option value="${esc(uid)}"${uid === a.ownerUid ? ' selected' : ''}>${esc(nameOf(uid))}${uid === st.user.uid ? ' ' + esc(T('(вы)')) : ''}</option>`));
  if (a.ownerUid && !(st.office.memberUids || []).includes(a.ownerUid)) {
    opts.push(`<option value="${esc(a.ownerUid)}" selected>${esc(a.ownerName || T('Бывший участник'))}</option>`);
  }
  sel.innerHTML = opts.join('');
  openModal('agentModal', '#ag-name');
}
$('agent-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const a = st.agents.find((x) => x.id === st.edit.agent);
  if (!a || !canEditAgent(a)) return;
  const name = $('ag-name').value.trim().slice(0, 120);
  if (!name) { toast('Введите имя', 'error'); return; }
  const patch = { name, description: $('ag-desc').value.slice(0, 8000), updatedAt: Date.now() };
  if (st.isCreator) {
    const uid = $('ag-owner').value;
    patch.ownerUid = uid;
    patch.ownerName = uid ? String(nameOf(uid)).slice(0, 40) : '';
  }
  const ok = await run(() => putAgent(a.id, { ...fullAgent(a), ...patch }), { ok: 'Досье сохранено', fail: 'Ошибка сохранения досье' });
  if (ok) closeModal('agentModal');
});

async function deleteAgent(a) {
  if (!await confirmDlg(`${T('Удалить досье')} «${a.name}» ${T('из Офиса?')}`)) return;
  await run(() => {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'offices', st.officeId, 'cards', a.id));
    batch.delete(doc(db, 'offices', st.officeId, 'agents', a.id));
    return batch.commit();
  }, { busy: 'Удаление досье...', ok: 'Досье удалено', fail: 'Ошибка удаления' });
}

const fileLabel = $('agent-file').closest('label');
fileLabel.tabIndex = 0;
fileLabel.setAttribute('role', 'button');
fileLabel.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('agent-file').click(); }
});
$('agent-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !st.officeId) return;
  const reader = new FileReader();
  reader.onload = async () => {
    let preset;
    try { preset = JSON.parse(reader.result); } catch (err) { toast('Ошибка формата JSON', 'error'); return; }
    await importPreset(preset, 'файл');
  };
  reader.readAsText(file);
});

/** Пресет → новое досье или обновление существующего (если у пользователя есть досье, которые он может менять). */
async function importPreset(preset, source) {
  try { agentFieldsFromPreset(preset); } catch (e) { toast(e.userMessage || 'Ошибка формата JSON', 'error'); return; }
  const editable = st.agents.filter(canEditAgent);
  const same = editable.find((a) => String(a.name).trim().toLowerCase() === String(preset.characterName || '').trim().toLowerCase());
  if (same) {
    const upd = await dialog({
      title: 'ДОСЬЕ УЖЕ ЕСТЬ', ok: 'ОБНОВИТЬ', danger: false,
      message: `${T('В офисе уже есть досье')} «${same.name}». ${T('Обновить его?')}`,
    });
    if (upd) {
      await run(() => updateAgentFromPreset(same, preset), { busy: 'Интеграция досье...', ok: 'Досье обновлено', fail: 'Ошибка обновления досье' });
      return;
    }
    if (!await confirmDlg('Добавить персонажа как новое досье?', { danger: false, ok: 'ДОБАВИТЬ' })) return;
  }
  await run(() => addAgentFromPreset(preset, source), { busy: 'Интеграция досье...', ok: 'Досье добавлено', fail: 'Ошибка добавления досье' });
}

/* ---------------- Связка с конструктором ---------------- */
function readBuilderPreset() {
  try {
    const p = JSON.parse(localStorage.getItem(LS_BUILDER_PRESET) || 'null');
    return p && typeof p === 'object' && p.format === 'sinner-sheet.character' ? p : null;
  } catch (e) { return null; }
}
function builderHasState() {
  try { return !!JSON.parse(localStorage.getItem(LS_BUILDER_STATE) || 'null')?.v; } catch (e) { return false; }
}

function renderBuilderCard() {
  const box = $('builder-card');
  if (!st.office) { box.hidden = true; return; }
  box.hidden = false;
  const p = readBuilderPreset();
  const head = `<div class="bc-head"><i class="fa-solid fa-screwdriver-wrench" aria-hidden="true"></i> ${esc(T('ИЗ КОНСТРУКТОРА'))}</div>`;
  if (!p || !String(p.characterName || '').trim()) {
    const text = builderHasState()
      ? T('Откройте конструктор и дайте персонажу имя — он появится здесь.')
      : T('В конструкторе пока нет персонажа.');
    box.innerHTML = `${head}<p class="hint">${esc(text)}</p><div class="bc-actions"><a class="btn cyan" href="builder.html"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i> ${esc(T('ОТКРЫТЬ КОНСТРУКТОР'))}</a></div>`;
    return;
  }
  const bits = [p.race, p.className, p.level ? `${T('ур.')} ${p.level}` : ''].filter(Boolean).map(esc).join(' · ');
  const editable = st.agents.filter(canEditAgent);
  const same = editable.find((a) => String(a.name).trim().toLowerCase() === String(p.characterName).trim().toLowerCase());
  const actions = [`<button class="btn cyan" data-act="builder-add"><i class="fa-solid fa-user-plus" aria-hidden="true"></i> ${esc(T('ДОБАВИТЬ'))}</button>`];
  if (editable.length) {
    actions.push(`<select class="field" id="builder-target" aria-label="${esc(T('Досье для обновления'))}" style="margin:0; flex: 1 1 100%; text-transform:none; font-family:'Inter';">
      ${editable.map((a) => `<option value="${esc(a.id)}"${same && same.id === a.id ? ' selected' : ''}>${esc(T('Обновить:'))} ${esc(a.name)}</option>`).join('')}
    </select>`);
    actions.push(`<button class="btn cyan" data-act="builder-update"><i class="fa-solid fa-rotate" aria-hidden="true"></i> ${esc(T('ОБНОВИТЬ ДОСЬЕ'))}</button>`);
  }
  box.innerHTML = `${head}
    <div class="bc-name notranslate">${esc(p.characterName)}</div>
    <div class="hint notranslate">${bits}</div>
    ${p.savedAt ? `<div class="hint">${esc(T('Сохранено:'))} ${esc(fmtTime(p.savedAt))}</div>` : ''}
    ${p.dmReview ? `<div class="hint" style="color:var(--color-yellow)">${esc(T('Есть пользовательские объекты — на усмотрение ДМ-а'))}</div>` : ''}
    <div class="bc-actions">${actions.join('')}</div>`;
}
// конструктор открыт в соседней вкладке — карточка обновляется сама
window.addEventListener('storage', (e) => { if (e.key === LS_BUILDER_PRESET || e.key === null) renderBuilderCard(); });
window.addEventListener('focus', () => { if (st.office) renderBuilderCard(); });

async function builderAdd() {
  const p = readBuilderPreset();
  if (!p) return;
  await importPreset(p, 'конструктор');
}
async function builderUpdate() {
  const p = readBuilderPreset();
  const a = st.agents.find((x) => x.id === $('builder-target')?.value);
  if (!p || !a) return;
  if (!await confirmDlg(`${T('Заменить досье')} «${a.name}» ${T('персонажем из конструктора')} «${p.characterName}»?`, { danger: false, ok: 'ОБНОВИТЬ' })) return;
  await run(() => updateAgentFromPreset(a, p), { busy: 'Интеграция досье...', ok: 'Досье обновлено', fail: 'Ошибка обновления досье' });
}

/* ---------------- Доска контрактов ---------------- */
const quests = () => listOf(st.office, 'customQuests');
const activeSet = () => new Set(listOf(st.office, 'activeQuests'));
const statusOf = (q) => (STATUSES[q.status] ? q.status : 'open');
function statusTag(q) {
  const s = statusOf(q);
  return `<span class="tag st-${s}"><i class="fa-solid ${STATUSES[s].icon}" aria-hidden="true"></i> ${esc(T(STATUSES[s].label).toUpperCase())}</span>`;
}

/* Награда контракта: при статусе «Выполнен» она одной транзакцией зачисляется в казну (paidId, paidAmount).
   Сняли статус или изменили награду — прежняя выплата отменяется и при необходимости зачисляется заново. */
function settleReward(d, q, patch) {
  const want = statusOf(q) === 'done' ? Math.max(0, Math.round(Number(q.reward) || 0)) : 0;
  const had = Number(q.paidAmount) || 0;
  if (want === had) return q;
  const t = patch.treasury || d.treasury || {};
  let log = Array.isArray(t.log) ? t.log : [];
  let balance = (Number(t.balance) || 0) - had;
  if (q.paidId) log = log.filter((l) => l.id !== q.paidId);
  const next = { ...q, paidId: '', paidAmount: 0 };
  if (want > 0) {
    const entry = { id: newId(log), ts: Date.now(), amount: want, note: `${T('Награда:')} ${q.name}`.slice(0, 200), by: myNick(), quest: q.id };
    log = [...log, entry].slice(-LEDGER_MAX);
    balance += want;
    next.paidId = entry.id;
    next.paidAmount = want;
  }
  patch.treasury = { balance, log };
  return next;
}

function renderStats() {
  const list = quests();
  const done = list.filter((q) => statusOf(q) === 'done');
  const failed = list.filter((q) => statusOf(q) === 'failed').length;
  const earned = done.reduce((sum, q) => sum + (Number(q.paidAmount) || 0), 0);
  $('office-stats').innerHTML = list.length
    ? `<span title="${esc(T('Выполнено контрактов'))}"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> ${done.length}</span>
       <span title="${esc(T('Провалено контрактов'))}"><i class="fa-solid fa-skull" aria-hidden="true"></i> ${failed}</span>
       <span title="${esc(T('Заработано наградами'))}"><i class="fa-solid fa-coins" aria-hidden="true"></i> ${esc(fmtNum(earned))} ${esc(T('Ан'))}</span>`
    : '';
}

function renderBoard() {
  const box = $('grades-container');
  renderStats();
  if (!st.office) { box.innerHTML = ''; return; }
  const active = activeSet();
  const visible = quests().filter((q) => active.has(q.id));
  let html = '';
  for (let g = 1; g <= 10; g++) {
    const list = visible.filter((q) => parseInt(q.grade, 10) === g)
      .sort((a, b) => STATUS_ORDER[statusOf(a)] - STATUS_ORDER[statusOf(b)]);
    if (!list.length && !st.isCreator) continue; // игрокам пустые ранги не показываем
    const openCount = list.filter((q) => statusOf(q) === 'open').length;
    const expanded = st.open.grades.has(g);
    const icons = [...new Set(list.map((q) => safeUrl(q.Icon)).filter(Boolean))]
      .map((src) => `<img src="${esc(src)}" class="quest-icon" alt="" onerror="this.style.display='none'">`).join('');
    const items = list.length
      ? list.map(questHtml).join('')
      : `<div class="board-empty">${esc(T('НА ДАННЫЙ МОМЕНТ НЕТ АКТИВНЫХ КОНТРАКТОВ ЭТОГО РАНГА.'))}</div>`;
    html += `
      <div class="grade-block${expanded ? ' expanded' : ''}">
        <button class="grade-header" data-act="grade-toggle" data-grade="${g}" aria-expanded="${expanded}" aria-controls="grade-content-${g}">
          <span>${esc(T('КОНТРАКТЫ:'))} ${esc(T(GRADES[g]))}<span class="count" title="${esc(T('Доступно / всего на доске'))}">${openCount} / ${list.length}</span></span>
          <span class="row"><span class="header-icons">${icons}</span><i class="fa-solid fa-chevron-down chev" aria-hidden="true"></i></span>
        </button>
        <div class="grade-content" id="grade-content-${g}">${items}</div>
      </div>`;
  }
  if (!html) {
    html = `<div class="board-empty">${esc(T('Менеджер пока не опубликовал ни одного контракта.'))}</div>`;
  } else if (st.isCreator && !quests().length) {
    html = `<p class="hint" style="margin-bottom:10px;">${esc(T('Создайте первый контракт кнопкой «+» — он сразу появится на доске.'))}</p>` + html;
  }
  box.innerHTML = html;
}

function questHtml(q) {
  const s = statusOf(q);
  const open = st.open.quests.has(q.id);
  const icon = safeUrl(q.Icon);
  const assignee = q.assignee ? `<span><i class="fa-solid fa-user" aria-hidden="true"></i> <span class="notranslate">${esc(q.assignee)}</span></span>` : '';
  const reward = Number(q.reward) > 0
    ? `<span title="${esc(T(q.paidAmount ? 'Награда зачислена в казну' : 'Награда'))}"><i class="fa-solid fa-coins" aria-hidden="true"></i> ${esc(fmtNum(q.reward))} ${esc(T('Ан'))}${q.paidAmount ? ` <i class="fa-solid fa-check" aria-hidden="true"></i>` : ''}</span>` : '';
  const admin = st.isCreator ? `
    <div class="quest-admin">
      <select class="field" data-act="quest-status" data-id="${esc(q.id)}" aria-label="${esc(T('Статус'))}">
        ${Object.entries(STATUSES).map(([k, v]) => `<option value="${k}"${k === s ? ' selected' : ''}>${esc(T(v.label))}</option>`).join('')}
      </select>
      <input class="field" list="assignee-options" data-act="quest-assignee" data-id="${esc(q.id)}" value="${esc(q.assignee || '')}" placeholder="${esc(T('Исполнитель...'))}" maxlength="80" aria-label="${esc(T('Исполнитель'))}">
      <button class="icon-btn" data-act="quest-edit" data-id="${esc(q.id)}" title="${esc(T('Редактировать'))}" aria-label="${esc(T('Редактировать'))}"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>
      <button class="icon-btn" data-act="quest-hide" data-id="${esc(q.id)}" title="${esc(T('Скрыть с доски'))}" aria-label="${esc(T('Скрыть с доски'))}"><i class="fa-solid fa-eye-slash" aria-hidden="true"></i></button>
      <button class="icon-btn danger" data-act="quest-delete" data-id="${esc(q.id)}" title="${esc(T('Удалить контракт'))}" aria-label="${esc(T('Удалить контракт'))}"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
    </div>` : '';
  return `
    <div class="quest-item${open ? ' open' : ''}${s === 'done' || s === 'failed' ? ' closed-status' : ''}">
      <button class="quest-toggle" data-act="quest-toggle" data-id="${esc(q.id)}" aria-expanded="${open}">
        <span class="qn notranslate">${esc(q.name)}</span>
        ${icon ? `<img src="${esc(icon)}" class="quest-icon" alt="" onerror="this.style.display='none'">` : ''}
        ${s !== 'open' ? statusTag(q) : ''}
      </button>
      <div class="quest-body">
        <div class="quest-meta">${statusTag(q)}${assignee}${reward}</div>
        <div class="md notranslate">${q.desc ? md(q.desc) : `<span class="muted">${esc(T('Без описания.'))}</span>`}</div>
        ${admin}
      </div>
    </div>`;
}

function renderAssigneeOptions() {
  if (!st.office) return;
  const names = new Set();
  st.agents.forEach((a) => a.name && names.add(a.name));
  (st.office.memberUids || []).forEach((uid) => names.add(nameOf(uid)));
  $('assignee-options').innerHTML = [...names].map((n) => `<option value="${esc(n)}"></option>`).join('');
}

async function setQuestField(id, field, value) {
  await run(() => mutate((d) => {
    const list = listOf(d, 'customQuests');
    if (!list.some((q) => q.id === id)) throw new Error('gone');
    const patch = {};
    patch.customQuests = list.map((q) => (q.id === id ? settleReward(d, { ...q, [field]: value, updatedAt: Date.now() }, patch) : q));
    return patch;
  }), { ok: field === 'status' ? 'Статус контракта обновлён' : 'Исполнитель сохранён', fail: 'Ошибка сохранения контракта' });
}

/* Окно контракта */
function fillIconGrid(selected) {
  $('q-icon-grid').innerHTML = ICON_PRESETS.map((ic) => `
    <button type="button" class="q-icon-option" data-icon="${esc(ic)}" aria-pressed="${ic === selected}" title="${esc(iconName(ic))}" aria-label="${esc(iconName(ic))}"><img src="${esc(ic)}" alt=""></button>`).join('')
    + `<button type="button" class="q-icon-option none" data-icon="" aria-pressed="${!selected}">${esc(T('БЕЗ ИКОНКИ'))}</button>`;
}
$('q-icon-grid').addEventListener('click', (e) => {
  const b = e.target.closest('[data-icon]');
  if (!b) return;
  $('q-icon-url').value = b.dataset.icon;
  $('q-icon-grid').querySelectorAll('[data-icon]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
});
$('q-icon-url').addEventListener('input', (e) => {
  const v = e.target.value.trim();
  $('q-icon-grid').querySelectorAll('[data-icon]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.icon === v)));
});
$('q-status').innerHTML = Object.entries(STATUSES).map(([k, v]) => `<option value="${k}">${esc(T(v.label))}</option>`).join('');

function openQuestEditor(q = null, grade = null) {
  st.edit.quest = q ? q.id : null;
  $('qb-title').textContent = T(q ? 'РЕДАКТИРОВАНИЕ КОНТРАКТА' : 'СОЗДАНИЕ КОНТРАКТА');
  $('qb-more').hidden = !!q;
  $('q-name').value = q?.name || '';
  $('q-grade').value = String(q?.grade || grade || 1);
  $('q-status').value = q ? statusOf(q) : 'open';
  $('q-assignee').value = q?.assignee || '';
  $('q-reward').value = q?.reward ? String(q.reward) : '';
  $('q-icon-url').value = q?.Icon || '';
  $('q-desc').value = q?.desc || '';
  $('q-visible').checked = q ? activeSet().has(q.id) : true;
  fillIconGrid(q?.Icon || '');
  openModal('questBuilderModal', '#q-name');
}

$('quest-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const more = e.submitter?.dataset.more === '1';
  const name = $('q-name').value.trim().slice(0, 120);
  if (!name) { toast('Введите название контракта.', 'error'); $('q-name').focus(); return; }
  const icon = $('q-icon-url').value.trim();
  if (icon && !safeUrl(icon)) { toast('Нужна прямая ссылка на изображение (http:// или https://)', 'error'); return; }
  const data = {
    name, grade: parseInt($('q-grade').value, 10) || 1, Icon: icon,
    desc: $('q-desc').value.trim().slice(0, 8000), status: $('q-status').value,
    assignee: $('q-assignee').value.trim().slice(0, 80), updatedAt: Date.now(),
    reward: Math.max(0, Math.min(1e12, Math.round(parseFloat($('q-reward').value) || 0))),
  };
  const visible = $('q-visible').checked;
  const editId = st.edit.quest;
  const ok = await run(() => mutate((d) => {
    const list = listOf(d, 'customQuests');
    let active = listOf(d, 'activeQuests');
    let id = editId;
    const patch = {};
    if (editId) {
      if (!list.some((q) => q.id === editId)) throw new Error('gone');
      patch.customQuests = list.map((q) => (q.id === editId ? settleReward(d, { ...q, ...data }, patch) : q));
    } else {
      id = newId(list, 'custom_');
      patch.customQuests = [...list, settleReward(d, { id, ...data }, patch)];
    }
    active = active.filter((x) => x !== id);
    if (visible) active.push(id);
    patch.activeQuests = active;
    return patch;
  }), { busy: 'Сохранение контракта в базу...', ok: editId ? 'Контракт обновлён' : 'Контракт успешно добавлен', fail: 'Ошибка сохранения контракта' });
  if (!ok) return;
  st.open.grades.add(data.grade);
  renderBoard();
  if (more && !editId) {
    $('q-name').value = ''; $('q-desc').value = ''; $('q-assignee').value = ''; $('q-reward').value = '';
    $('q-name').focus();
  } else closeModal('questBuilderModal');
});

async function hideQuest(id) {
  await run(() => mutate((d) => ({ activeQuests: listOf(d, 'activeQuests').filter((x) => x !== id) })), { ok: 'Контракт скрыт с доски', fail: 'Ошибка' });
}
async function deleteQuest(id) {
  const q = quests().find((x) => x.id === id);
  if (!q || !await confirmDlg(`${T('Удалить контракт')} «${q.name}» ${T('навсегда?')}`)) return;
  await run(() => mutate((d) => ({
    customQuests: listOf(d, 'customQuests').filter((x) => x.id !== id),
    activeQuests: listOf(d, 'activeQuests').filter((x) => x !== id),
  })), { busy: 'Удаление контракта...', ok: 'Контракт удалён', fail: 'Ошибка удаления контракта' });
}

/* Управление доской: поиск, фильтр, «все / никого» по рангу */
let qmDraft = null; // id отмеченных контрактов, пока окно открыто
$('qm-status').innerHTML = `<option value="">${esc(T('Все статусы'))}</option>`
  + Object.entries(STATUSES).map(([k, v]) => `<option value="${k}">${esc(T(v.label))}</option>`).join('');
function openQuestManager() {
  qmDraft = activeSet();
  $('qm-search').value = '';
  $('qm-status').value = '';
  renderQuestManager();
  openModal('questManagerModal', '#qm-search');
}
function renderQuestManager() {
  if (!qmDraft) return;
  const ids = new Set(quests().map((q) => q.id));
  qmDraft = new Set([...qmDraft].filter((x) => ids.has(x)));
  const term = $('qm-search').value.trim().toLowerCase();
  const stf = $('qm-status').value;
  const match = (q) => (!term || `${q.name} ${q.desc || ''} ${q.assignee || ''}`.toLowerCase().includes(term)) && (!stf || statusOf(q) === stf);
  let html = '';
  for (let g = 1; g <= 10; g++) {
    const list = quests().filter((q) => parseInt(q.grade, 10) === g && match(q));
    if (!list.length) continue;
    html += `<div class="qm-grade"><span>${esc(T(GRADES[g]))} · ${list.filter((q) => qmDraft.has(q.id)).length}/${list.length}</span>
      <span class="row"><button class="btn yellow" data-act="qm-all" data-grade="${g}">${esc(T('ВСЕ'))}</button><button class="btn" data-act="qm-none" data-grade="${g}">${esc(T('НИКОГО'))}</button></span></div>`;
    html += list.map((q) => {
      const icon = safeUrl(q.Icon);
      return `<div class="qm-row">
        <label><input type="checkbox" class="qm-checkbox" value="${esc(q.id)}"${qmDraft.has(q.id) ? ' checked' : ''}>
          ${icon ? `<img src="${esc(icon)}" class="quest-icon" alt="" onerror="this.style.display='none'">` : ''}
          <span class="notranslate">${esc(q.name)}</span></label>
        <span class="row">${statusTag(q)}
          <button class="icon-btn" data-act="quest-edit" data-id="${esc(q.id)}" title="${esc(T('Редактировать'))}" aria-label="${esc(T('Редактировать'))}"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>
          <button class="icon-btn danger" data-act="quest-delete" data-id="${esc(q.id)}" title="${esc(T('Удалить контракт'))}" aria-label="${esc(T('Удалить контракт'))}"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
        </span></div>`;
    }).join('');
  }
  if (!html) html = `<p class="hint">${esc(T(quests().length ? 'Ничего не найдено.' : 'Контрактов пока нет — создайте первый кнопкой «+» на доске.'))}</p>`;
  $('qm-list').innerHTML = html;
}
$('qm-search').addEventListener('input', renderQuestManager);
$('qm-status').addEventListener('change', renderQuestManager);
$('qm-list').addEventListener('change', (e) => {
  if (!e.target.classList.contains('qm-checkbox')) return;
  if (e.target.checked) qmDraft.add(e.target.value); else qmDraft.delete(e.target.value);
  renderQuestManager();
});
$('questManagerModal').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act="qm-all"], [data-act="qm-none"]');
  if (!b) return;
  const g = Number(b.dataset.grade);
  $('qm-list').querySelectorAll('.qm-checkbox').forEach((cb) => {
    const q = quests().find((x) => x.id === cb.value);
    if (q && parseInt(q.grade, 10) === g) { if (b.dataset.act === 'qm-all') qmDraft.add(q.id); else qmDraft.delete(q.id); }
  });
  renderQuestManager();
});
async function saveQuestVisibility() {
  const active = [...qmDraft];
  const ok = await run(() => mutate((d) => {
    const ids = new Set(listOf(d, 'customQuests').map((q) => q.id));
    return { activeQuests: active.filter((x) => ids.has(x)) };
  }), { busy: 'Сохранение настроек доски...', ok: 'Доска контрактов обновлена', fail: 'Ошибка сохранения видимости' });
  if (ok) { qmDraft = null; closeModal('questManagerModal'); }
}

/* ---------------- Сводки ---------------- */
function renderNews() {
  const box = $('news-container');
  const list = listOf(st.office, 'news');
  if (!list.length) { box.innerHTML = `<p class="hint">${esc(T('Событий не зафиксировано.'))}</p>`; return; }
  const sorted = [...list].sort((a, b) => (!!b.pinned - !!a.pinned) || (parseInt(b.id, 10) || 0) - (parseInt(a.id, 10) || 0));
  box.innerHTML = sorted.map((n) => {
    const tools = st.isCreator ? `<div class="item-tools">
        <button class="icon-btn${n.pinned ? ' on' : ''}" data-act="news-pin" data-id="${esc(n.id)}" title="${esc(T(n.pinned ? 'Открепить' : 'Закрепить'))}" aria-label="${esc(T(n.pinned ? 'Открепить' : 'Закрепить'))}" aria-pressed="${!!n.pinned}"><i class="fa-solid fa-thumbtack" aria-hidden="true"></i></button>
        <button class="icon-btn" data-act="news-edit" data-id="${esc(n.id)}" title="${esc(T('Редактировать'))}" aria-label="${esc(T('Редактировать'))}"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>
        <button class="icon-btn danger" data-act="news-delete" data-id="${esc(n.id)}" title="${esc(T('Удалить сводку'))}" aria-label="${esc(T('Удалить сводку'))}"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
      </div>` : (n.pinned ? `<i class="fa-solid fa-thumbtack" style="color:var(--color-yellow)" title="${esc(T('Закреплено'))}"></i>` : '');
    return `<article class="news-item${n.pinned ? ' pinned' : ''}">
      <div class="news-top"><div><div class="news-date notranslate">${esc(n.date)}</div><div class="news-author notranslate">${esc(n.author)}</div></div>${tools}</div>
      <div class="news-text md notranslate">${md(n.text)}</div>
    </article>`;
  }).join('');
}

function resetNewsForm() {
  st.edit.news = null;
  $('news-form').reset();
  $('news-editing').hidden = true;
  $('news-submit').querySelector('span').textContent = T('ПУБЛИКОВАТЬ НОВОСТЬ');
}
function editNews(id) {
  const n = listOf(st.office, 'news').find((x) => x.id === id);
  if (!n) return;
  st.edit.news = id;
  $('news-author').value = n.author || '';
  $('news-date').value = n.date || '';
  $('news-input').value = n.text || '';
  $('news-pinned').checked = !!n.pinned;
  $('news-editing').hidden = false;
  $('news-submit').querySelector('span').textContent = T('СОХРАНИТЬ ИЗМЕНЕНИЯ');
  switchTab('news');
  $('news-input').focus();
}
$('news-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('news-input').value.trim().slice(0, 8000);
  if (!text) { toast('Введите текст сводки', 'error'); return; }
  const fields = {
    author: $('news-author').value.trim().slice(0, 80) || T('Менеджер'),
    date: $('news-date').value.trim().slice(0, 40) || new Date().toLocaleDateString(LOCALE()),
    text, pinned: $('news-pinned').checked,
  };
  const editId = st.edit.news;
  const ok = await run(() => mutate((d) => {
    const list = listOf(d, 'news');
    if (editId) {
      if (!list.some((n) => n.id === editId)) throw new Error('gone');
      return { news: list.map((n) => (n.id === editId ? { ...n, ...fields } : n)) };
    }
    return { news: [...list, { id: newId(list), ...fields }].slice(-NEWS_MAX) };
  }), { busy: 'Публикация сводки...', ok: editId ? 'Сводка обновлена' : 'Сводка опубликована', fail: 'Ошибка публикации' });
  if (ok) resetNewsForm();
});
async function togglePin(id) {
  await run(() => mutate((d) => ({ news: listOf(d, 'news').map((n) => (n.id === id ? { ...n, pinned: !n.pinned } : n)) })), { fail: 'Ошибка' });
}
async function deleteNews(id) {
  if (!await confirmDlg('Удалить сводку?')) return;
  await run(() => mutate((d) => ({ news: listOf(d, 'news').filter((n) => n.id !== id) })), { ok: 'Сводка удалена', fail: 'Ошибка удаления сводки' });
  if (st.edit.news === id) resetNewsForm();
}

/* ---------------- Журнал сессий ---------------- */
// offices/<id>/sessions/<sid> = { title, date, text, agents, num, createdAt, updatedAt, by } — пишет менеджер, читают участники.
const SESSION_TEXT_MAX = 20000;
function renderSessions() {
  const box = $('journal-container');
  if (!box) return;
  if (st.sessionsState === 'loading') { box.innerHTML = `<p class="hint">${esc(T('Загрузка...'))}</p>`; return; }
  if (st.sessionsState === 'err') { box.innerHTML = `<p class="hint">${esc(T('Журнал сессий недоступен.'))}</p>`; return; }
  if (!st.edit.session) $('session-num').placeholder = `#${(st.sessions.reduce((m, x) => Math.max(m, Number(x.num) || 0), 0) + 1)}`;
  if (!st.sessions.length) { box.innerHTML = `<p class="hint">${esc(T('Сессий пока не записано.'))}</p>`; return; }
  const list = [...st.sessions].sort((a, b) => (Number(b.num) || 0) - (Number(a.num) || 0) || (b.createdAt || 0) - (a.createdAt || 0));
  box.innerHTML = list.map((x) => {
    const open = st.open.sessions.has(x.id);
    const tools = st.isCreator ? `<div class="item-tools">
        <button class="icon-btn" data-act="session-edit" data-id="${esc(x.id)}" title="${esc(T('Редактировать'))}" aria-label="${esc(T('Редактировать'))}"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>
        <button class="icon-btn danger" data-act="session-delete" data-id="${esc(x.id)}" title="${esc(T('Удалить запись'))}" aria-label="${esc(T('Удалить запись'))}"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
      </div>` : '';
    const who = Array.isArray(x.agents) && x.agents.length
      ? `<div class="hint notranslate"><i class="fa-solid fa-users" aria-hidden="true"></i> ${esc(x.agents.join(', '))}</div>` : '';
    return `<article class="session-item${open ? ' open' : ''}">
      <div class="news-top">
        <button class="session-toggle" data-act="session-toggle" data-id="${esc(x.id)}" aria-expanded="${open}">
          <span class="session-num">#${esc(x.num || '?')}</span>
          <span class="notranslate">${esc(x.title || T('Без названия'))}</span>
          ${x.date ? `<span class="news-date notranslate">${esc(x.date)}</span>` : ''}
        </button>${tools}
      </div>
      <div class="session-body">${who}<div class="news-text md notranslate">${md(x.text)}</div></div>
    </article>`;
  }).join('');
}
function resetSessionForm() {
  st.edit.session = null;
  $('session-form').reset();
  $('session-editing').hidden = true;
  $('session-submit').querySelector('span').textContent = T('ЗАПИСАТЬ СЕССИЮ');
  $('session-num').placeholder = `#${(st.sessions.reduce((m, x) => Math.max(m, Number(x.num) || 0), 0) + 1)}`;
}
function editSession(id) {
  const x = st.sessions.find((y) => y.id === id);
  if (!x) return;
  st.edit.session = id;
  $('session-num').value = x.num || '';
  $('session-title').value = x.title || '';
  $('session-date').value = x.date || '';
  $('session-agents').value = (x.agents || []).join(', ');
  $('session-text').value = x.text || '';
  $('session-editing').hidden = false;
  $('session-submit').querySelector('span').textContent = T('СОХРАНИТЬ ИЗМЕНЕНИЯ');
  switchTab('journal');
  $('session-title').focus();
}
$('session-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!st.isCreator) return;
  const text = $('session-text').value.trim().slice(0, SESSION_TEXT_MAX);
  const title = $('session-title').value.trim().slice(0, 120);
  if (!text && !title) { toast('Введите название или итоги сессии', 'error'); return; }
  const editId = st.edit.session;
  const prev = editId ? st.sessions.find((y) => y.id === editId) : null;
  const nextNum = st.sessions.reduce((m, x) => Math.max(m, Number(x.num) || 0), 0) + 1;
  const num = Math.max(1, Math.min(100000, parseInt($('session-num').value, 10) || prev?.num || nextNum));
  const data = {
    num, title, text,
    date: $('session-date').value.trim().slice(0, 40) || prev?.date || new Date().toLocaleDateString(LOCALE()),
    agents: $('session-agents').value.split(',').map((v) => v.trim().slice(0, 80)).filter(Boolean).slice(0, 30),
    createdAt: prev?.createdAt || Date.now(), updatedAt: Date.now(), by: myNick(),
  };
  const ref = editId ? doc(db, 'offices', st.officeId, 'sessions', editId) : doc(collection(db, 'offices', st.officeId, 'sessions'));
  const ok = await run(() => setDoc(ref, data), { busy: 'Запись сессии...', ok: editId ? 'Запись обновлена' : 'Сессия записана', fail: 'Ошибка записи сессии' });
  if (ok) { st.open.sessions.add(ref.id); resetSessionForm(); }
});
async function deleteSession(id) {
  const x = st.sessions.find((y) => y.id === id);
  if (!x || !await confirmDlg(`${T('Удалить запись о сессии')} «${x.title || '#' + x.num}»?`)) return;
  await run(() => deleteDoc(doc(db, 'offices', st.officeId, 'sessions', id)), { ok: 'Запись удалена', fail: 'Ошибка удаления' });
  if (st.edit.session === id) resetSessionForm();
}

/* ---------------- Репутация ---------------- */
function repLevel(score) {
  if (score <= -60) return { label: 'Враждебны', color: 'var(--color-red)' };
  if (score <= -20) return { label: 'Недружелюбны', color: 'var(--color-orange)' };
  if (score < 20) return { label: 'Нейтральны', color: 'var(--text-main)' };
  if (score < 60) return { label: 'Дружелюбны', color: 'var(--color-cyan)' };
  return { label: 'Союзники', color: 'var(--accent-primary)' };
}
function renderReps() {
  const box = $('rep-container');
  const list = listOf(st.office, 'reputations');
  if (!list.length) { box.innerHTML = `<p class="hint">${esc(T('Данные о репутации отсутствуют.'))}</p>`; return; }
  box.innerHTML = [...list].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0)).map((r) => {
    const score = clamp(Math.round(Number(r.score) || 0), -100, 100);
    const lv = repLevel(score);
    const w = `${Math.abs(score)}%`;
    const icon = safeUrl(r.iconUrl);
    const tools = st.isCreator ? `<div class="item-tools">
        <button class="icon-btn" data-act="rep-edit" data-id="${esc(r.id)}" title="${esc(T('Редактировать'))}" aria-label="${esc(T('Редактировать'))}"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>
        <button class="icon-btn danger" data-act="rep-delete" data-id="${esc(r.id)}" title="${esc(T('Удалить фракцию'))}" aria-label="${esc(T('Удалить фракцию'))}"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
      </div>` : '';
    return `<div class="rep-item">
      <div class="rep-top">
        <span class="rep-name" style="color:${lv.color}">${icon ? `<img src="${esc(icon)}" alt="" onerror="this.style.display='none'">` : ''}<span class="notranslate">${esc(r.name)}</span></span>
        <span class="row"><span class="rep-score" style="color:${lv.color}">${score > 0 ? '+' : ''}${score} · ${esc(T(lv.label))}</span>${tools}</span>
      </div>
      <div class="rep-bar" role="meter" aria-valuemin="-100" aria-valuemax="100" aria-valuenow="${score}" aria-label="${esc(r.name)}: ${score}">
        <div class="rep-half neg">${score < 0 ? `<div class="rep-fill" style="width:${w}; background:${lv.color}"></div>` : ''}</div>
        <div class="rep-half pos">${score > 0 ? `<div class="rep-fill" style="width:${w}; background:${lv.color}"></div>` : ''}</div>
      </div>
      <div class="rep-scale"><span>-100</span><span>0</span><span>+100</span></div>
    </div>`;
  }).join('');
}
function resetRepForm() {
  st.edit.rep = null;
  $('rep-form').reset();
  $('rep-editing').hidden = true;
  $('rep-submit').querySelector('span').textContent = T('ДОБАВИТЬ / ОБНОВИТЬ');
}
function editRep(id) {
  const r = listOf(st.office, 'reputations').find((x) => x.id === id);
  if (!r) return;
  st.edit.rep = id;
  $('rep-name').value = r.name || '';
  $('rep-icon').value = r.iconUrl || '';
  $('rep-score').value = r.score ?? 0;
  $('rep-editing').hidden = false;
  $('rep-submit').querySelector('span').textContent = T('СОХРАНИТЬ ИЗМЕНЕНИЯ');
  switchTab('rep');
  $('rep-score').focus();
}
$('rep-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('rep-name').value.trim().slice(0, 80);
  const iconUrl = $('rep-icon').value.trim();
  const score = parseInt($('rep-score').value, 10);
  if (!name) { toast('Введите название фракции', 'error'); return; }
  if (Number.isNaN(score) || score < -100 || score > 100) { toast('Репутация должна быть от -100 до 100', 'error'); return; }
  if (iconUrl && !safeUrl(iconUrl)) { toast('Нужна прямая ссылка на изображение (http:// или https://)', 'error'); return; }
  const editId = st.edit.rep;
  const ok = await run(() => mutate((d) => {
    const list = listOf(d, 'reputations');
    // правка по id; без правки фракция с тем же названием обновляется, а не дублируется
    const target = editId ? list.find((r) => r.id === editId) : list.find((r) => String(r.name).toLowerCase() === name.toLowerCase());
    if (editId && !target) throw new Error('gone');
    if (target) return { reputations: list.map((r) => (r.id === target.id ? { ...r, name, score, iconUrl } : r)) };
    return { reputations: [...list, { id: newId(list), name, score, iconUrl }] };
  }), { busy: 'Обновление репутации...', ok: 'Репутация обновлена', fail: 'Ошибка обновления репутации' });
  if (ok) resetRepForm();
});
async function deleteRep(id) {
  if (!await confirmDlg('Удалить данные фракции?')) return;
  await run(() => mutate((d) => ({ reputations: listOf(d, 'reputations').filter((r) => r.id !== id) })), { ok: 'Фракция удалена', fail: 'Ошибка удаления репутации' });
  if (st.edit.rep === id) resetRepForm();
}

/* ---------------- Казна и курс ---------------- */
// По канону Project Moon 1 Ан = 1 южнокорейская вона (KRW). Курсы — сколько Анов (вон) стоит 1 ₽ и 1 $.
const RATE_FALLBACK = { rub: 17, usd: 1400, date: '', source: 'offline' };
const RATE_TTL = 6 * 3600 * 1000;
const RATE_SOURCES = [
  { url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/krw.json', parse: (j) => ({ rub: 1 / j.krw.rub, usd: 1 / j.krw.usd, date: j.date }) },
  { url: 'https://latest.currency-api.pages.dev/v1/currencies/krw.json', parse: (j) => ({ rub: 1 / j.krw.rub, usd: 1 / j.krw.usd, date: j.date }) },
  { url: 'https://open.er-api.com/v6/latest/KRW', parse: (j) => ({ rub: 1 / j.rates.RUB, usd: 1 / j.rates.USD, date: String(j.time_last_update_utc || '').slice(5, 16) }) },
];
let rates = null;
function cachedRates() {
  try {
    const r = JSON.parse(localStorage.getItem(LS_RATES) || 'null');
    if (r && r.rub > 0 && r.usd > 0) return r;
  } catch (e) { /* ignore */ }
  return null;
}
async function loadRates(force = false) {
  const cached = cachedRates();
  if (cached) rates = cached;
  if (!force && cached && Date.now() - cached.at < RATE_TTL) { renderRates(); return; }
  for (const src of RATE_SOURCES) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(src.url, { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(timer);
      if (!res.ok) continue;
      const r = src.parse(await res.json());
      if (!(r.rub > 0 && r.usd > 0 && Number.isFinite(r.rub) && Number.isFinite(r.usd))) continue;
      rates = { ...r, at: Date.now(), source: 'live' };
      try { localStorage.setItem(LS_RATES, JSON.stringify(rates)); } catch (e) { /* ignore */ }
      renderRates();
      if (force) toast('Курс обновлён', 'success');
      return;
    } catch (e) { /* следующий источник */ }
  }
  if (!rates) rates = { ...RATE_FALLBACK, at: 0 };
  renderRates();
  if (force) toast('Не удалось получить курс — используется сохранённый или примерный', 'error');
}
function renderRates() {
  const r = rates || RATE_FALLBACK;
  const parts = [`1 ₽ ≈ ${fmtNum(r.rub, 2)} ${T('Ан')}`, `1 $ ≈ ${fmtNum(r.usd, 0)} ${T('Ан')}`];
  const when = r.source === 'offline' ? T('примерный курс, нет связи') : (r.date ? `${T('курс на')} ${r.date}` : '');
  $('conv-rate').textContent = parts.join(' · ') + (when ? ` (${when})` : '');
  convFrom(lastConv);
  renderBank();
}
let lastConv = 'ahn';
function convFrom(which) {
  const r = rates || RATE_FALLBACK;
  lastConv = which;
  const v = parseFloat($(`conv-${which}`).value);
  const set = (id, val) => { if (id !== which) $(`conv-${id}`).value = Number.isFinite(val) ? String(Math.round(val * 100) / 100) : ''; };
  if (!Number.isFinite(v)) { ['ahn', 'rub', 'usd'].forEach((k) => { if (k !== which) $(`conv-${k}`).value = ''; }); return; }
  const ahn = which === 'ahn' ? v : which === 'rub' ? v * r.rub : v * r.usd;
  set('ahn', ahn); set('rub', ahn / r.rub); set('usd', ahn / r.usd);
}
['ahn', 'rub', 'usd'].forEach((k) => $(`conv-${k}`).addEventListener('input', () => convFrom(k)));

function renderBank() {
  if (!st.office) return;
  const t = st.office.treasury || {};
  const bal = Number(t.balance) || 0;
  const r = rates || RATE_FALLBACK;
  $('bank-balance').textContent = `${fmtNum(bal)} ${T('Ан')}`;
  $('bank-balance').classList.toggle('neg', bal < 0);
  $('bank-balance-sub').textContent = `≈ ${fmtNum(bal / r.rub, 0)} ₽ · ≈ ${fmtNum(bal / r.usd, 2)} $`;
  const log = Array.isArray(t.log) ? [...t.log].sort((a, b) => (b.ts || 0) - (a.ts || 0)) : [];
  renderBankChart(bal, log);
  $('bank-log').innerHTML = log.length ? log.map((x) => {
    const amt = Number(x.amount) || 0;
    const tools = st.isCreator ? `<div class="item-tools"><button class="icon-btn danger" data-act="bank-undo" data-id="${esc(x.id)}" title="${esc(T('Отменить операцию'))}" aria-label="${esc(T('Отменить операцию'))}"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i></button></div>` : '';
    return `<div class="ledger-item">
      <div style="min-width:0;"><div class="notranslate">${esc(x.note || T(amt >= 0 ? 'Доход' : 'Расход'))}</div><div class="meta">${esc(x.ts ? fmtTime(x.ts) : '')}${x.by ? ' · <span class="notranslate">' + esc(x.by) + '</span>' : ''}</div></div>
      <div class="row"><span class="amt ${amt >= 0 ? 'plus' : 'minus'}">${amt >= 0 ? '+' : '−'}${fmtNum(Math.abs(amt))}</span>${tools}</div>
    </div>`;
  }).join('') : `<p class="hint" style="margin-bottom:8px;">${esc(T('Операций пока не было.'))}</p>`;
}
/** График баланса по журналу операций: баланс до первой записи = текущий − сумма всех записей журнала. */
function renderBankChart(bal, newestFirst) {
  const box = $('bank-chart');
  const log = [...newestFirst].reverse();
  if (log.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
  let cur = bal - log.reduce((s2, x) => s2 + (Number(x.amount) || 0), 0);
  const pts = [cur];
  log.forEach((x) => { cur += Number(x.amount) || 0; pts.push(cur); });
  const W = 300, H = 70, P = 4;
  const lo = Math.min(0, ...pts), hi = Math.max(0, ...pts);
  const span = hi - lo || 1;
  const xy = (v, i) => [P + (i * (W - 2 * P)) / (pts.length - 1), P + ((hi - v) * (H - 2 * P)) / span];
  const line = pts.map((v, i) => xy(v, i).map((n) => n.toFixed(1)).join(',')).join(' ');
  const zero = xy(0, 0)[1].toFixed(1);
  const [lx, ly] = xy(pts[pts.length - 1], pts.length - 1);
  box.hidden = false;
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(T('График баланса'))}">
      <line x1="${P}" x2="${W - P}" y1="${zero}" y2="${zero}" class="zero"/>
      <polyline points="${line}" class="${bal < 0 ? 'neg' : 'pos'}"/>
      <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.5" class="${bal < 0 ? 'neg' : 'pos'}"/>
    </svg>
    <div class="chart-scale"><span>${esc(fmtNum(lo))}</span><span>${esc(T('операций:'))} ${log.length}</span><span>${esc(fmtNum(hi))}</span></div>`;
}

$('bank-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const kind = e.submitter?.dataset.kind || 'in';
  const raw = parseFloat($('bank-amount').value);
  if (!Number.isFinite(raw) || raw <= 0) { toast('Введите сумму больше нуля', 'error'); return; }
  const amount = Math.round(raw) * (kind === 'out' ? -1 : 1);
  const note = $('bank-note').value.trim().slice(0, 200);
  const ok = await run(() => mutate((d) => {
    const t = d.treasury || {};
    const log = Array.isArray(t.log) ? t.log : [];
    const entry = { id: newId(log), ts: Date.now(), amount, note, by: myNick() };
    return { treasury: { balance: (Number(t.balance) || 0) + amount, log: [...log, entry].slice(-LEDGER_MAX) } };
  }), { ok: kind === 'out' ? 'Расход записан' : 'Доход записан', fail: 'Ошибка записи в казну' });
  if (ok) $('bank-form').reset();
});
async function undoLedger(id) {
  if (!await confirmDlg('Отменить операцию? Сумма вернётся на баланс, запись исчезнет из журнала.')) return;
  await run(() => mutate((d) => {
    const t = d.treasury || {};
    const log = Array.isArray(t.log) ? t.log : [];
    const x = log.find((l) => l.id === id);
    if (!x) throw new Error('gone');
    const patch = { treasury: { balance: (Number(t.balance) || 0) - (Number(x.amount) || 0), log: log.filter((l) => l.id !== id) } };
    // отменили выплату награды — контракт снова считается неоплаченным
    const qs = listOf(d, 'customQuests');
    if (qs.some((q) => q.paidId === id)) patch.customQuests = qs.map((q) => (q.paidId === id ? { ...q, paidId: '', paidAmount: 0 } : q));
    // отменили покупку или продажу — предмет остаётся на складе, но больше не ссылается на операцию
    const items = listOf(d, 'storage');
    if (items.some((x) => x.paidId === id)) patch.storage = items.map((x) => (x.paidId === id ? { ...x, paidId: '', cost: 0 } : x));
    return patch;
  }), { ok: 'Операция отменена', fail: 'Ошибка' });
}

/* ---------------- Склад ----------------
   storage: [{ id, name, qty, holder, note, shop, cost, paidId, ts, by }] в документе офиса, меняет менеджер.
   «Купить» одной транзакцией добавляет предмет и запись расхода в казну (paidId — id записи журнала, cost — цена),
   «Продать» уменьшает количество и записывает доход. Отмена записи в казне оставляет предмет, но снимает связь. */
const stockList = () => listOf(st.office, 'storage');
let stockNames = null;
async function loadStockNames() {
  if (stockNames) return;
  stockNames = [];
  for (const f of ['equipment.json', 'egogifts.json']) {
    try {
      const res = await window.I18N.fetchData(f);
      if (res.ok) (await res.json()).forEach((x) => { if (x?.Name) stockNames.push(String(x.Name)); });
    } catch (e) { /* подсказки не обязательны */ }
  }
  $('stock-suggest').innerHTML = [...new Set(stockNames)].sort((a, b) => a.localeCompare(b))
    .map((n) => `<option value="${esc(n)}"></option>`).join('');
}
$('stock-name').addEventListener('focus', loadStockNames);
$('stock-holder').addEventListener('focus', () => {
  $('stock-agents').innerHTML = [...new Set(st.agents.map((a) => a.name).filter(Boolean))].map((n) => `<option value="${esc(n)}"></option>`).join('');
});
$('stock-search').addEventListener('input', () => renderStock());

function renderStock() {
  if (!st.office) return;
  const q = $('stock-search').value.trim().toLowerCase();
  const all = stockList();
  const list = [...all]
    .filter((x) => !q || [x.name, x.holder, x.note, x.shop].some((v) => String(v || '').toLowerCase().includes(q)))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const spent = all.reduce((s2, x) => s2 + (Number(x.cost) || 0), 0);
  $('stock-stats').innerHTML = all.length
    ? `<span><i class="fa-solid fa-boxes-stacked" aria-hidden="true"></i> ${esc(T('позиций:'))} ${all.length}</span>
       <span><i class="fa-solid fa-hashtag" aria-hidden="true"></i> ${esc(T('штук:'))} ${esc(fmtNum(all.reduce((s2, x) => s2 + (Number(x.qty) || 0), 0)))}</span>
       ${spent ? `<span title="${esc(T('Потрачено на покупки'))}"><i class="fa-solid fa-coins" aria-hidden="true"></i> ${esc(fmtNum(spent))} ${esc(T('Ан'))}</span>` : ''}`
    : '';
  $('stock-list').innerHTML = list.length ? list.map((x) => {
    const tools = st.isCreator ? `<div class="item-tools">
        <button class="icon-btn" data-act="stock-sell" data-id="${esc(x.id)}" title="${esc(T('Продать'))}" aria-label="${esc(T('Продать'))}"><i class="fa-solid fa-hand-holding-dollar" aria-hidden="true"></i></button>
        <button class="icon-btn" data-act="stock-edit" data-id="${esc(x.id)}" title="${esc(T('Редактировать'))}" aria-label="${esc(T('Редактировать'))}"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>
        <button class="icon-btn danger" data-act="stock-delete" data-id="${esc(x.id)}" title="${esc(T('Списать со склада'))}" aria-label="${esc(T('Списать со склада'))}"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
      </div>` : '';
    const meta = [
      x.holder ? `<i class="fa-solid fa-user" aria-hidden="true"></i> <span class="notranslate">${esc(x.holder)}</span>` : '',
      x.shop ? `<i class="fa-solid fa-store" aria-hidden="true"></i> <span class="notranslate">${esc(x.shop)}</span>` : '',
      Number(x.cost) > 0 ? `${esc(T('куплено за'))} ${esc(fmtNum(x.cost))} ${esc(T('Ан'))}` : '',
    ].filter(Boolean).join(' · ');
    return `<div class="stock-item">
      <div style="min-width:0;">
        <div><span class="stock-name notranslate">${esc(x.name)}</span><span class="stock-qty">×${esc(fmtNum(x.qty))}</span></div>
        ${meta ? `<div class="meta">${meta}</div>` : ''}
        ${x.note ? `<div class="stock-note notranslate">${esc(x.note)}</div>` : ''}
      </div>${tools}
    </div>`;
  }).join('') : `<p class="hint">${esc(T(all.length ? 'Ничего не найдено.' : 'Склад пуст.'))}</p>`;
}
function resetStockForm() {
  st.edit.stock = null;
  $('stock-form').reset();
  $('stock-form').classList.remove('editing');
  $('stock-editing').hidden = true;
  $('stock-add').querySelector('span').textContent = T('ДОБАВИТЬ');
}
function editStock(id) {
  const x = stockList().find((i) => i.id === id);
  if (!x) return;
  st.edit.stock = id;
  $('stock-name').value = x.name || '';
  $('stock-qty').value = x.qty || 1;
  $('stock-holder').value = x.holder || '';
  $('stock-note').value = x.note || '';
  $('stock-form').classList.add('editing');
  $('stock-editing').hidden = false;
  $('stock-add').querySelector('span').textContent = T('СОХРАНИТЬ ИЗМЕНЕНИЯ');
  switchTab('stock');
  $('stock-name').focus();
}
$('stock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const buy = e.submitter?.dataset.kind === 'buy' && !st.edit.stock;
  const name = $('stock-name').value.replace(/\s+/g, ' ').trim().slice(0, 120);
  const qty = clamp(Math.round(Number($('stock-qty').value) || 1), 1, 9999);
  const holder = $('stock-holder').value.trim().slice(0, 80);
  const note = $('stock-note').value.trim().slice(0, 300);
  const shop = $('stock-shop').value.trim().slice(0, 80);
  const price = Math.round(Number($('stock-price').value) || 0);
  if (!name) { toast('Введите название предмета', 'error'); return; }
  if (buy && price <= 0) { toast('Укажите цену покупки в Анах', 'error'); return; }
  const editId = st.edit.stock;
  const ok = await run(() => mutate((d) => {
    const items = listOf(d, 'storage');
    if (editId) {
      if (!items.some((x) => x.id === editId)) throw userError('Предмет уже убран со склада');
      return { storage: items.map((x) => (x.id === editId ? { ...x, name, qty, holder, note } : x)) };
    }
    if (items.length >= STOCK_MAX) throw userError(`${T('На складе не больше')} ${STOCK_MAX} ${T('позиций')}`);
    const item = { id: newId(items), name, qty, holder, note, shop, cost: 0, paidId: '', ts: Date.now(), by: myNick() };
    const patch = {};
    if (buy) {
      const t = d.treasury || {};
      const log = Array.isArray(t.log) ? t.log : [];
      const entry = { id: newId(log), ts: Date.now(), amount: -price, note: `${T('Покупка:')} ${name}${qty > 1 ? ` ×${qty}` : ''}${shop ? ` (${shop})` : ''}`.slice(0, 200), by: myNick() };
      patch.treasury = { balance: (Number(t.balance) || 0) - price, log: [...log, entry].slice(-LEDGER_MAX) };
      item.cost = price;
      item.paidId = entry.id;
    }
    patch.storage = [...items, item];
    return patch;
  }), { ok: editId ? 'Предмет обновлён' : buy ? 'Куплено: цена списана из Казны' : 'Добавлено на склад', fail: 'Ошибка записи склада' });
  if (ok) resetStockForm();
});
async function sellStock(id) {
  const x = stockList().find((i) => i.id === id);
  if (!x) return;
  let n = 1;
  if ((Number(x.qty) || 1) > 1) {
    const raw = await dialog({ title: 'ПРОДАЖА', message: `${T('Сколько продать? Всего на складе:')} ${x.qty}`, input: { value: String(x.qty) }, ok: 'ДАЛЕЕ' });
    if (raw === null) return;
    n = Math.round(Number(raw));
    if (!(n >= 1 && n <= x.qty)) { toast('Количество должно быть от 1 до числа на складе', 'error'); return; }
  }
  const raw = await dialog({ title: 'ПРОДАЖА', message: `${T('Выручка за')} «${x.name}» ×${n}, ${T('Ан (0 — отдать без оплаты):')}`, input: { value: '' }, ok: 'ПРОДАТЬ' });
  if (raw === null) return;
  const amount = Math.round(Number(raw));
  if (!Number.isFinite(amount) || amount < 0) { toast('Введите сумму 0 или больше', 'error'); return; }
  await run(() => mutate((d) => {
    const items = listOf(d, 'storage');
    const cur = items.find((i) => i.id === id);
    if (!cur) throw userError('Предмет уже убран со склада');
    const left = (Number(cur.qty) || 1) - n;
    if (left < 0) throw userError('На складе уже меньше предметов');
    const patch = { storage: left > 0 ? items.map((i) => (i.id === id ? { ...i, qty: left } : i)) : items.filter((i) => i.id !== id) };
    if (amount > 0) {
      const t = d.treasury || {};
      const log = Array.isArray(t.log) ? t.log : [];
      const entry = { id: newId(log), ts: Date.now(), amount, note: `${T('Продажа:')} ${cur.name}${n > 1 ? ` ×${n}` : ''}`.slice(0, 200), by: myNick() };
      patch.treasury = { balance: (Number(t.balance) || 0) + amount, log: [...log, entry].slice(-LEDGER_MAX) };
    }
    return patch;
  }), { ok: amount > 0 ? 'Продано: выручка зачислена в Казну' : 'Списано со склада', fail: 'Ошибка продажи' });
  if (st.edit.stock === id && !stockList().some((i) => i.id === id)) resetStockForm();
}
async function deleteStock(id) {
  const x = stockList().find((i) => i.id === id);
  if (!x) return;
  if (!await confirmDlg(`${T('Списать')} «${x.name}» ${T('со склада? Казна не изменится.')}`)) return;
  await run(() => mutate((d) => ({ storage: listOf(d, 'storage').filter((i) => i.id !== id) })), { ok: 'Списано со склада', fail: 'Ошибка' });
  if (st.edit.stock === id) resetStockForm();
}

/* ---------------- Вкладки ---------------- */
const TABS = ['news', 'journal', 'rep', 'bank', 'stock'];
function switchTab(tab, focus = false) {
  if (!TABS.includes(tab)) tab = 'news';
  TABS.forEach((t) => {
    const b = $(`tab-${t}`);
    const on = t === tab;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    $(`wrapper-${t}`).hidden = !on;
  });
  if (focus) $(`tab-${tab}`).focus();
  try { localStorage.setItem(LS_TAB, tab); } catch (e) { /* ignore */ }
}
document.querySelector('[role=tablist]').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) switchTab(b.dataset.tab); });
document.querySelector('[role=tablist]').addEventListener('keydown', (e) => {
  const cur = TABS.findIndex((t) => $(`tab-${t}`).getAttribute('aria-selected') === 'true');
  let next = null;
  if (e.key === 'ArrowRight') next = (cur + 1) % TABS.length;
  if (e.key === 'ArrowLeft') next = (cur + TABS.length - 1) % TABS.length;
  if (e.key === 'Home') next = 0;
  if (e.key === 'End') next = TABS.length - 1;
  if (next !== null) { e.preventDefault(); switchTab(TABS[next], true); }
});
try { switchTab(localStorage.getItem(LS_TAB) || 'news'); } catch (e) { switchTab('news'); }

function resetForms() {
  resetNewsForm();
  resetSessionForm();
  resetRepForm();
  resetStockForm();
  $('bank-form').reset();
  ['agentModal', 'questBuilderModal', 'questManagerModal', 'dialogModal'].forEach(closeModal);
}

/* ---------------- Действия по клику ---------------- */
const findAgent = (id) => st.agents.find((a) => a.id === id);
const ACTIONS = {
  login: () => window.SiteUI?.open('login'),
  register: () => window.SiteUI?.open('register'),
  account: () => window.SiteUI?.open('account'),
  'open-office': (b) => openOffice(b.dataset.id),
  'create-office': createOffice,
  'delete-office': deleteOffice,
  'leave-office': leaveOffice,
  logo: changeLogo,
  'remove-member': (b) => removeMember(b.dataset.uid),
  'remove-email': (b) => removeEmail(b.dataset.email),
  'agent-toggle': (b) => {
    const id = b.dataset.id;
    if (st.open.agents.has(id)) st.open.agents.delete(id); else st.open.agents.add(id);
    b.closest('.preset-card').classList.toggle('expanded', st.open.agents.has(id));
    b.setAttribute('aria-expanded', String(st.open.agents.has(id)));
  },
  'agent-download': (b) => { const a = findAgent(b.dataset.id); if (a) downloadAgent(a); },
  'agent-to-builder': (b) => { const a = findAgent(b.dataset.id); if (a) openAgentInBuilder(a); },
  'agent-edit': (b) => { const a = findAgent(b.dataset.id); if (a) openAgentEditor(a); },
  'agent-delete': (b) => { const a = findAgent(b.dataset.id); if (a) deleteAgent(a); },
  'builder-add': builderAdd,
  'builder-update': builderUpdate,
  'grade-toggle': (b) => {
    const g = Number(b.dataset.grade);
    if (st.open.grades.has(g)) st.open.grades.delete(g); else st.open.grades.add(g);
    b.closest('.grade-block').classList.toggle('expanded', st.open.grades.has(g));
    b.setAttribute('aria-expanded', String(st.open.grades.has(g)));
  },
  'quest-toggle': (b) => {
    const id = b.dataset.id;
    if (st.open.quests.has(id)) st.open.quests.delete(id); else st.open.quests.add(id);
    b.closest('.quest-item').classList.toggle('open', st.open.quests.has(id));
    b.setAttribute('aria-expanded', String(st.open.quests.has(id)));
  },
  'new-quest': () => openQuestEditor(null, [...st.open.grades][0]),
  'quest-manager': openQuestManager,
  'quest-edit': (b) => { const q = quests().find((x) => x.id === b.dataset.id); if (q) openQuestEditor(q); },
  'quest-hide': (b) => hideQuest(b.dataset.id),
  'quest-delete': (b) => deleteQuest(b.dataset.id),
  'qm-save': saveQuestVisibility,
  'news-pin': (b) => togglePin(b.dataset.id),
  'news-edit': (b) => editNews(b.dataset.id),
  'news-delete': (b) => deleteNews(b.dataset.id),
  'news-cancel': resetNewsForm,
  'session-toggle': (b) => {
    const id = b.dataset.id;
    if (st.open.sessions.has(id)) st.open.sessions.delete(id); else st.open.sessions.add(id);
    b.closest('.session-item').classList.toggle('open', st.open.sessions.has(id));
    b.setAttribute('aria-expanded', String(st.open.sessions.has(id)));
  },
  'session-edit': (b) => editSession(b.dataset.id),
  'session-delete': (b) => deleteSession(b.dataset.id),
  'session-cancel': resetSessionForm,
  'session-fill-agents': () => {
    const names = st.agents.map((a) => a.name).filter(Boolean);
    $('session-agents').value = [...new Set(names)].join(', ');
  },
  'rep-edit': (b) => editRep(b.dataset.id),
  'rep-delete': (b) => deleteRep(b.dataset.id),
  'rep-cancel': resetRepForm,
  'bank-undo': (b) => undoLedger(b.dataset.id),
  'stock-edit': (b) => editStock(b.dataset.id),
  'stock-sell': (b) => sellStock(b.dataset.id),
  'stock-delete': (b) => deleteStock(b.dataset.id),
  'stock-cancel': resetStockForm,
  'rates-refresh': () => loadRates(true),
};
document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act], a[data-act]');
  if (!b || b.disabled) return;
  const fn = ACTIONS[b.dataset.act];
  if (fn) { e.preventDefault(); fn(b); }
});
// статус и исполнитель контракта меняются прямо на доске
document.addEventListener('change', (e) => {
  const el = e.target;
  if (!st.isCreator) return;
  if (el.dataset.act === 'quest-status') setQuestField(el.dataset.id, 'status', STATUSES[el.value] ? el.value : 'open');
  if (el.dataset.act === 'quest-assignee') {
    const q = quests().find((x) => x.id === el.dataset.id);
    const v = el.value.trim().slice(0, 80);
    if (q && v !== (q.assignee || '')) setQuestField(el.dataset.id, 'assignee', v);
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.dataset?.act === 'quest-assignee') { e.preventDefault(); e.target.blur(); }
});

/* ---------------- Вход ---------------- */
let authSeen = false;
onAuth(({ ready, user, nick, nickStatus }) => {
  if (!ready) return;
  const changed = !authSeen || (user?.uid || null) !== (st.user?.uid || null);
  authSeen = true;
  st.nick = nick; st.nickStatus = nickStatus;
  if (!changed) {
    if (!$('empty-gate').hidden) showEmpty();
    return;
  }
  stopListening();
  st.token++;
  st.user = user || null;
  st.officeId = null; st.office = null; st.offices = []; st.agents = [];
  st.normalized.clear(); st.names.clear();
  setCreator(false);
  resetForms();
  $('office-workspace').hidden = true;
  $('empty-gate').hidden = true;
  if (!user) {
    $('loading-gate').hidden = true;
    $('auth-gate').hidden = false;
    renderOfficeList();
    return;
  }
  $('auth-gate').hidden = true;
  $('loading-gate').hidden = false;
  loadUserOffices();
});

loadRates();
