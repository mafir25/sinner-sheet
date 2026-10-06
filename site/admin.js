// Админ-панель (admin.html).
// Роли и права — site/auth.js (Кодер → Гл-Админ → Админ), проверка на сервере — firestore.rules.
// Разделы: Обзор, Доступы, Канон, Пользователи, Модерация, Скрытое, Журнал. Каждое действие пишется
// в журнал audit/ одной пачкой с самим изменением.
import {
  collection, doc, getDocs, query, where, orderBy, limit, startAfter, writeBatch,
  serverTimestamp, getCountFromServer, Timestamp,
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';
import { db, auth } from './firebase.js';
import {
  onAuth, refreshAccess, ROLES, PERMS, CANON_GROUPS, CODER_EMAILS, can, canCanon, isHead,
  findUserByNick, normalizePerms, banActive,
} from './auth.js';
import * as Canon from './canon.js';

/* ============================================================
   Общее
   ============================================================ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const T = (s) => (window.I18N?.t ? window.I18N.t(s) : s);

let S = { ready: false };            // состояние входа и прав (site/auth.js)
const myNick = () => S.nick || (S.user?.email || '').split('@')[0];

function toast(msg, kind = '') {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.textContent = T(msg);
  box.appendChild(el);
  setTimeout(() => el.remove(), kind === 'err' ? 7000 : 3500);
}
/** Одно обновляемое уведомление для долгих операций. */
function progress(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  $('#toasts').appendChild(el);
  const set = (m) => { el.textContent = T(m); };
  set(msg);
  return { set, done: () => el.remove() };
}
function errText(e) {
  if (e?.code === 'permission-denied') return 'Нет прав на это действие (если права точно есть — опубликуйте свежие firestore.rules)';
  if (e?.code === 'unavailable') return 'Нет соединения с Firestore';
  return e?.message || 'Неизвестная ошибка';
}
function fail(e, what = 'Ошибка') { console.error(e); toast(`${T(what)}: ${T(errText(e))}`, 'err'); }

const toDate = (ts) => (ts?.toDate ? ts.toDate() : ts instanceof Date ? ts : null);
function fmt(ts) {
  const d = toDate(ts);
  return d ? d.toLocaleString(window.I18N?.lang === 'en' ? 'en-GB' : 'ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—';
}
function ago(ts) {
  const d = toDate(ts);
  if (!d) return '—';
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин назад`;
  if (m < 1440) return `${Math.round(m / 60)} ч назад`;
  return `${Math.round(m / 1440)} дн назад`;
}
const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(2) + ' МБ' : Math.max(1, Math.round(n / 1024)) + ' КБ');

/** Запись в журнал — добавляется в ту же пачку, что и само действие. */
function addAudit(batch, action, target, details = '') {
  batch.set(doc(collection(db, 'audit')), {
    at: serverTimestamp(), uid: auth.currentUser.uid, nick: myNick().slice(0, 40),
    action, target: String(target || '').slice(0, 300),
    details: (typeof details === 'string' ? details : JSON.stringify(details)).slice(0, 60000),
  });
}

/** Модальное окно. Возвращает { el, close }. */
function modal(title, bodyHtml, { wide = false } = {}) {
  const ov = document.createElement('div');
  ov.className = 'modal-ov';
  ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="${wide ? 'width:min(1200px,100%)' : ''}">
    <div class="modal-head"><h2 style="margin:0">${esc(title)}</h2><button class="btn ghost sm" data-x>✕</button></div>
    <div class="modal-body">${bodyHtml}</div></div>`;
  document.body.appendChild(ov);
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-x]')) close(); });
  return { el: ov, close };
}
function showJson(title, value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, jsonReplacer, 2);
  modal(title, `<pre class="json notranslate">${esc(text)}</pre>`, { wide: true });
}
function jsonReplacer(_k, v) {
  if (v && typeof v === 'object' && typeof v.toDate === 'function') return v.toDate().toISOString();
  return v;
}

/** Удалить все документы подколлекции пачками по 400. */
async function deleteCollection(path) {
  const snap = await getDocs(collection(db, ...path));
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = writeBatch(db);
    snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  return snap.size;
}

/* ============================================================
   Вкладки
   ============================================================ */
const TABS = [
  { id: 'overview', icon: 'fa-gauge', label: 'Обзор', allowed: (s) => !!s.role, render: renderOverview },
  { id: 'access', icon: 'fa-user-shield', label: 'Доступы', allowed: isHead, render: renderAccess },
  { id: 'canon', icon: 'fa-book', label: 'Канон', allowed: (s) => can(s, 'canon'), render: renderCanon },
  { id: 'users', icon: 'fa-users', label: 'Пользователи', allowed: (s) => can(s, 'monitor') || can(s, 'ban'), render: renderUsers },
  { id: 'moderation', icon: 'fa-gavel', label: 'Модерация', allowed: (s) => can(s, 'moderate'), render: renderModeration },
  { id: 'hidden', icon: 'fa-eye', label: 'Скрытое', allowed: isHead, render: renderHidden },
  { id: 'audit', icon: 'fa-clipboard-list', label: 'Журнал', allowed: (s) => can(s, 'monitor'), render: renderAudit },
];
let currentTab = null;
const view = () => $('#view');

function renderWho() {
  const who = $('#who');
  if (!S.user) { who.innerHTML = ''; return; }
  who.innerHTML = `<span class="notranslate">${esc(S.nick || S.user.email)}</span>
    ${S.role ? `<span class="role-badge role-${S.role}">${esc(T(ROLES[S.role]))}</span>` : ''}`;
}

function renderTabs() {
  const nav = $('#tabs');
  const tabs = TABS.filter((t) => t.allowed(S));
  nav.hidden = !tabs.length;
  nav.innerHTML = tabs.map((t) => `<button class="tab" role="tab" data-tab="${t.id}" aria-selected="${t.id === currentTab}">
    <i class="fa-solid ${t.icon}"></i>${esc(t.label)}</button>`).join('');
}

async function openTab(id, { push = true } = {}) {
  const tabs = TABS.filter((t) => t.allowed(S));
  const tab = tabs.find((t) => t.id === id) || tabs[0];
  if (!tab) return;
  if (currentTab === 'canon' && tab.id !== 'canon' && CS.dirty && !confirm(T('В каноне есть несохранённые изменения. Уйти без сохранения?'))) return;
  currentTab = tab.id;
  if (push && location.hash !== '#' + tab.id) history.replaceState(null, '', '#' + tab.id);
  renderTabs();
  view().innerHTML = '<div class="notice">Загрузка…</div>';
  try { await tab.render(view()); }
  catch (e) { console.error(e); view().innerHTML = `<div class="notice err">${esc(T(errText(e)))}</div>`; }
}

$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (b) openTab(b.dataset.tab);
});
window.addEventListener('hashchange', () => { const id = location.hash.slice(1); if (id && id !== currentTab) openTab(id, { push: false }); });
window.addEventListener('beforeunload', (e) => { if (CS.dirty) { e.preventDefault(); e.returnValue = ''; } });

let lastKey = '';
onAuth((a) => {
  S = a;
  renderWho();
  const key = `${a.user?.uid || ''}|${a.role || ''}|${JSON.stringify(a.perms || {})}`;
  if (key === lastKey) return;
  lastKey = key;
  if (!a.ready) return;
  if (!a.user) {
    $('#tabs').hidden = true;
    view().innerHTML = `<div class="notice">Админ-панель доступна только сотрудникам. Войдите в аккаунт.
      <div style="margin-top:10px"><button class="btn" id="login-btn">Войти</button></div></div>`;
    $('#login-btn').onclick = () => window.SiteUI?.open('login');
    return;
  }
  if (!a.role) {
    $('#tabs').hidden = true;
    view().innerHTML = `<div class="notice ${a.banned ? 'err' : ''}">${a.banned
      ? `Ваш аккаунт заблокирован${a.banned.until ? ' до ' + esc(fmt(a.banned.until)) : ''}.${a.banned.reason ? ' Причина: ' + esc(a.banned.reason) : ''}`
      : 'У вашего аккаунта нет доступа к админ-панели. Доступ выдаёт Гл-Админ или Кодер — сообщите им свой никнейм.'}</div>`;
    return;
  }
  $('#ban-note')?.remove();
  if (a.banned) {
    $('#tabs').insertAdjacentHTML('beforebegin', `<div class="notice err" id="ban-note" style="margin-bottom:12px">${esc(T('Ваш аккаунт заблокирован — изменения сохраняться не будут.'))}</div>`);
  }
  openTab(location.hash.slice(1) || currentTab || 'overview', { push: false });
});

/* ============================================================
   Обзор
   ============================================================ */
async function renderOverview(v) {
  const permChips = Object.entries(PERMS).map(([k, label]) => {
    const on = k === 'canon' ? S.perms.canon.length > 0 : S.perms[k];
    const extra = k === 'canon' && on && S.perms.canon.length < CANON_GROUPS.length
      ? ': ' + S.perms.canon.map((g) => T(Canon.GROUP_NAMES[g] || g)).join(', ') : '';
    return `<span class="chip ${on ? 'on' : ''}">${on ? '✓' : '✕'} ${esc(T(label))}${esc(extra)}</span>`;
  }).join('');
  v.innerHTML = `
    <div class="panel" style="margin-bottom:14px">
      <h2>Ваш доступ</h2>
      <div class="row" style="margin-bottom:8px"><span class="role-badge role-${S.role}">${esc(T(ROLES[S.role]))}</span>
        <span class="muted small">${S.role === 'coder' ? 'Полный доступ, назначает Гл-Админов и Админов' : S.role === 'headadmin'
          ? 'Все права, видит скрытое, назначает Админов' : 'Права выдаёт Гл-Админ'}</span></div>
      <div class="chips">${permChips}${isHead(S) ? '<span class="chip on">✓ Скрытое содержимое</span>' : ''}</div>
    </div>
    <div class="panel" style="margin-bottom:14px"><h2>Статистика</h2><div class="stats" id="stats"></div></div>
    <div class="panel" id="recent" hidden><h2>Последние действия</h2><div id="recent-list"></div></div>`;

  const day = Timestamp.fromMillis(Date.now() - 864e5);
  const week = Timestamp.fromMillis(Date.now() - 7 * 864e5);
  const mon = can(S, 'monitor') || can(S, 'ban');
  const STATS = [
    ['Аккаунтов с ником', true, () => collection(db, 'users')],
    ['Активны за 24 ч', mon, () => query(collection(db, 'presence'), where('lastSeen', '>=', day))],
    ['Активны за 7 дней', mon, () => query(collection(db, 'presence'), where('lastSeen', '>=', week))],
    ['Записей в пользовательской базе', can(S, 'moderate'), () => collection(db, 'custom_content')],
    ['Из них приватных', can(S, 'moderate'), () => query(collection(db, 'custom_content'), where('isPrivate', '==', true))],
    ['Офисов', isHead(S), () => collection(db, 'offices')],
    ['Ширм', isHead(S), () => collection(db, 'custom_screens')],
    ['Сотрудников (кроме Кодера)', isHead(S) || can(S, 'monitor'), () => collection(db, 'roles')],
    ['Заблокировано', can(S, 'ban') || can(S, 'monitor'), () => collection(db, 'bans')],
    ['Файлов канона в Firestore', true, () => collection(db, 'canon')],
  ].filter((s) => s[1]);
  const box = $('#stats', v);
  box.innerHTML = STATS.map(([label], i) => `<div class="stat"><b id="st-${i}">…</b><span>${esc(T(label))}</span></div>`).join('');
  STATS.forEach(async ([, , q], i) => {
    try { $('#st-' + i, v).textContent = (await getCountFromServer(q())).data().count; }
    catch (e) { console.warn(e); $('#st-' + i, v).textContent = '—'; }
  });

  if (can(S, 'monitor')) {
    $('#recent', v).hidden = false;
    try {
      const snap = await getDocs(query(collection(db, 'audit'), orderBy('at', 'desc'), limit(10)));
      $('#recent-list', v).innerHTML = snap.empty ? '<div class="muted">Журнал пуст</div>' : auditTable(snap.docs);
      bindAuditDetails($('#recent-list', v), snap.docs);
    } catch (e) { $('#recent-list', v).innerHTML = `<div class="notice err">${esc(T(errText(e)))}</div>`; }
  }
}

/* ============================================================
   Доступы (роли)
   ============================================================ */
async function renderAccess(v) {
  const snap = await getDocs(collection(db, 'roles'));
  const rows = snap.docs.map((d) => ({ uid: d.id, ...d.data() }))
    .sort((a, b) => (a.role === b.role ? String(a.nick).localeCompare(String(b.nick)) : a.role === 'headadmin' ? -1 : 1));
  const canEdit = (r) => S.role === 'coder' || (r.role === 'admin' && r.uid !== S.user.uid);

  v.innerHTML = `
    <div class="panel" style="margin-bottom:14px">
      <h2>Выдать доступ</h2>
      <div class="row">
        <input class="in notranslate" id="acc-nick" placeholder="${esc(T('Никнейм пользователя'))}" style="max-width:320px" maxlength="40">
        <button class="btn green" id="acc-find"><i class="fa-solid fa-user-plus"></i> Найти и настроить</button>
      </div>
      <p class="muted small" style="margin-top:8px">Доступ выдаётся по никнейму (он задаётся в ⚙ Настройках). ${S.role === 'coder'
        ? 'Вы можете назначать Гл-Админов и Админов.' : 'Гл-Админ назначает Админов и выбирает их права; Гл-Админов назначает Кодер.'}</p>
    </div>
    <div class="panel">
      <h2>Сотрудники</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Ник</th><th>Роль</th><th>Права</th><th>Выдал</th><th>Изменено</th><th></th></tr></thead>
        <tbody>
          <tr><td class="notranslate">${esc(CODER_EMAILS.join(', '))}</td><td><span class="role-badge role-coder">${esc(T(ROLES.coder))}</span></td>
            <td class="muted small">Все права. Задаётся в коде (site/auth.js и firestore.rules)</td><td>—</td><td>—</td><td></td></tr>
          ${rows.map((r) => `<tr>
            <td><span class="notranslate">${esc(r.nick || '—')}</span><div class="muted mono">${esc(r.uid)}</div></td>
            <td><span class="role-badge role-${esc(r.role)}">${esc(T(ROLES[r.role] || r.role))}</span></td>
            <td>${r.role === 'headadmin' ? '<span class="chip on">Все права + скрытое</span>' : permChips(r.perms)}</td>
            <td class="notranslate">${esc(r.grantedByNick || '—')}</td>
            <td class="small">${esc(fmt(r.updatedAt))}</td>
            <td><div class="row">
              <button class="btn sm" data-edit="${esc(r.uid)}" ${canEdit(r) ? '' : 'disabled title="Нет прав"'}><i class="fa-solid fa-pen"></i></button>
              <button class="btn sm red" data-del="${esc(r.uid)}" ${canEdit(r) ? '' : 'disabled title="Нет прав"'}><i class="fa-solid fa-user-minus"></i></button>
            </div></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Пока никого</td></tr>'}
        </tbody></table></div>
    </div>`;

  const find = async () => {
    const nick = $('#acc-nick', v).value.trim();
    if (!nick) return;
    try {
      const u = await findUserByNick(nick);
      if (!u) return toast('Пользователь с таким ником не найден', 'err');
      const existing = rows.find((r) => r.uid === u.uid);
      if (existing && !canEdit(existing)) return toast('Этого сотрудника может менять только Кодер', 'err');
      if (u.uid === S.user.uid && S.role !== 'coder') return toast('Свои права менять нельзя', 'err');
      editRole({ uid: u.uid, nick: u.nick, role: existing?.role || 'admin', perms: existing?.perms }, !!existing);
    } catch (e) { fail(e, 'Поиск не удался'); }
  };
  $('#acc-find', v).onclick = find;
  $('#acc-nick', v).onkeydown = (e) => { if (e.key === 'Enter') find(); };
  v.onclick = async (e) => {
    const ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
    if (ed) { const r = rows.find((x) => x.uid === ed.dataset.edit); editRole(r, true); }
    if (del) {
      const r = rows.find((x) => x.uid === del.dataset.del);
      if (!confirm(`${T('Снять доступ с')} ${r.nick || r.uid}?`)) return;
      try {
        const batch = writeBatch(db);
        batch.delete(doc(db, 'roles', r.uid));
        addAudit(batch, 'role.remove', `${r.nick || ''} (${r.uid})`, { before: { role: r.role, perms: r.perms } });
        await batch.commit();
        toast('Доступ снят', 'ok');
        openTab('access');
      } catch (er) { fail(er, 'Не удалось снять доступ'); }
    }
  };
}

function permChips(perms) {
  const p = normalizePerms(perms);
  const list = [];
  if (p.canon.length) list.push(`<span class="chip on">${esc(T('Канон'))}: ${p.canon.length === CANON_GROUPS.length ? esc(T('всё'))
    : p.canon.map((g) => esc(T(Canon.GROUP_NAMES[g] || g))).join(', ')}</span>`);
  if (p.moderate) list.push(`<span class="chip on">${esc(T('Модерация'))}</span>`);
  if (p.monitor) list.push(`<span class="chip on">${esc(T('Мониторинг'))}</span>`);
  if (p.ban) list.push(`<span class="chip on">${esc(T('Блокировки'))}</span>`);
  return `<div class="chips">${list.join('') || `<span class="chip">${esc(T('нет прав'))}</span>`}</div>`;
}

function editRole(r, exists) {
  const p = normalizePerms(r.perms);
  const roles = S.role === 'coder' ? ['admin', 'headadmin'] : ['admin'];
  const m = modal(`${T(exists ? 'Изменить доступ' : 'Выдать доступ')}: ${r.nick || r.uid}`, `
    <div class="form">
      <label class="field"><span>Роль</span>
        <select class="in" id="r-role">${roles.map((x) => `<option value="${x}" ${x === r.role ? 'selected' : ''}>${esc(T(ROLES[x]))}</option>`).join('')}</select></label>
      <div id="r-perms">
        <h3 style="margin-top:4px">Права Админа</h3>
        <div class="form">
          ${['moderate', 'monitor', 'ban'].map((k) => `<label class="check"><input type="checkbox" data-perm="${k}" ${p[k] ? 'checked' : ''}> ${esc(T(PERMS[k]))}</label>`).join('')}
          <div><div class="muted small" style="margin-bottom:6px">${esc(T(PERMS.canon))} — по разделам:</div>
            <div class="row">${CANON_GROUPS.map((g) => `<label class="check"><input type="checkbox" data-canon="${g}" ${p.canon.includes(g) ? 'checked' : ''}> ${esc(T(Canon.GROUP_NAMES[g] || g))}</label>`).join('')}</div>
          </div>
        </div>
      </div>
      <div class="notice" id="r-head-note" hidden>Гл-Админ получает все права, видит скрытое содержимое (приватные записи, все Ширмы и Офисы) и сам назначает Админов.</div>
      <div class="row"><span class="spacer"></span><button class="btn ghost" data-x>Отмена</button><button class="btn green" id="r-save">Сохранить</button></div>
    </div>`);
  const sync = () => {
    const head = $('#r-role', m.el).value === 'headadmin';
    $('#r-perms', m.el).hidden = head;
    $('#r-head-note', m.el).hidden = !head;
  };
  $('#r-role', m.el).onchange = sync; sync();
  $('#r-save', m.el).onclick = async () => {
    const role = $('#r-role', m.el).value;
    const perms = role === 'headadmin' ? { canon: [...CANON_GROUPS], moderate: true, monitor: true, ban: true } : {
      canon: $$('[data-canon]', m.el).filter((c) => c.checked).map((c) => c.dataset.canon),
      moderate: $('[data-perm=moderate]', m.el).checked,
      monitor: $('[data-perm=monitor]', m.el).checked,
      ban: $('[data-perm=ban]', m.el).checked,
    };
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'roles', r.uid), {
        role, perms, nick: String(r.nick || '').slice(0, 40),
        grantedBy: S.user.uid, grantedByNick: myNick().slice(0, 40), updatedAt: serverTimestamp(),
      });
      addAudit(batch, exists ? 'role.update' : 'role.grant', `${r.nick || ''} (${r.uid})`,
        { role, perms, before: exists ? { role: r.role, perms: r.perms } : null });
      await batch.commit();
      m.close();
      toast('Доступ сохранён', 'ok');
      if (r.uid === S.user.uid) await refreshAccess();
      openTab('access');
    } catch (e) { fail(e, 'Не удалось сохранить доступ'); }
  };
}

/* ============================================================
   Канон
   ============================================================ */
const CS = {
  manifests: new Map(),
  sel: null,          // { lang, rel }
  manifest: null,     // манифест открытой версии (null — файла в Firestore нет)
  source: null,       // 'canon' | 'static' | 'none'
  data: undefined,    // разобранный JSON (рабочая копия)
  text: '',           // текст (для не-JSON файлов и режима «целиком»)
  path: [],           // путь к открытому списку внутри JSON
  key: null,          // выбранная запись в списке
  mode: 'entries',    // entries | raw
  entryJson: false,   // запись в виде JSON, а не формы
  dirty: false,
  changes: new Map(), // путь → { label, before, after }
  search: '',
};

const BUILDER_NOTE = 'Конструктор персонажа берёт черты, умения и предметы по порядку (индексу). Правка текста безопасна; '
  + 'добавление, удаление или перестановка записей требуют перегенерации Builder_*.json (node scripts/gen-builder-data.mjs) и их переноса.';

async function renderCanon(v) {
  try { CS.manifests = await Canon.listManifests(); } catch (e) { fail(e, 'Не удалось прочитать канон'); }
  const files = Canon.canonFiles();
  const groups = [...new Set(files.map((f) => f.group))];
  const editable = files.some((f) => canCanon(S, f.group));
  v.innerHTML = `
    <div class="panel" style="margin-bottom:14px">
      <div class="row between">
        <h2 style="margin:0">Каноничные данные</h2>
        <div class="row">
          <button class="btn sm ghost" id="cn-reload"><i class="fa-solid fa-rotate"></i> Обновить</button>
          ${editable ? '<button class="btn sm yellow" id="cn-import-all"><i class="fa-solid fa-cloud-arrow-up"></i> Перенести всё из Assets</button>' : ''}
        </div>
      </div>
      <p class="muted small" style="margin-top:8px">Сайт читает канон из Firestore (коллекция <span class="mono">canon</span>); если файла там нет
        или Firestore недоступен — из папки <span class="mono">Assets/</span> репозитория. Правки видны всем сразу после сохранения.
        Чтобы перенести правки обратно в репозиторий: <span class="mono">node scripts/canon-pull.mjs</span>.</p>
    </div>
    <div class="canon">
      <div class="files" id="cn-files">
        ${groups.map((g) => `<div class="file-group">${esc(T(Canon.GROUP_NAMES[g] || g))}${canCanon(S, g) ? '' : ' · <i class="fa-solid fa-lock"></i>'}</div>
          ${files.filter((f) => f.group === g).map((f) => Object.keys(Canon.LANG_DIRS).map((lang) => {
            const m = CS.manifests.get(Canon.fileId(lang, f.rel));
            const cur = CS.sel && CS.sel.lang === lang && CS.sel.rel === f.rel;
            return `<button class="file" data-lang="${lang}" data-rel="${esc(f.rel)}" aria-current="${!!cur}" ${canCanon(S, g) ? '' : 'disabled'}>
              <span class="notranslate">${esc(f.name)} <span class="muted small">${lang}</span></span>
              ${m ? `<span class="chip on">v${m.version}</span>` : '<span class="chip">Assets</span>'}</button>`;
          }).join('')).join('')}`).join('')}
      </div>
      <div id="cn-editor">${CS.sel ? '' : '<div class="notice">Выберите файл слева.</div>'}</div>
    </div>`;

  $('#cn-reload', v).onclick = () => { if (!CS.dirty || confirm(T('Отбросить несохранённые изменения?'))) { CS.dirty = false; CS.sel = null; openTab('canon'); } };
  $('#cn-import-all', v)?.addEventListener('click', importAll);
  $('#cn-files', v).onclick = (e) => {
    const b = e.target.closest('.file');
    if (b && !b.disabled) openFile(b.dataset.lang, b.dataset.rel);
  };
  if (CS.sel) {
    if (CS.data === undefined && !CS.text) await openFile(CS.sel.lang, CS.sel.rel, true);
    else renderEditor();
  }
}

async function importAll() {
  const todo = [];
  for (const f of Canon.canonFiles()) {
    if (!canCanon(S, f.group)) continue;
    for (const lang of Object.keys(Canon.LANG_DIRS)) if (!CS.manifests.has(Canon.fileId(lang, f.rel))) todo.push({ lang, ...f });
  }
  if (!todo.length) return toast('Все доступные вам файлы уже в Firestore', 'ok');
  if (!confirm(`${T('Перенести в Firestore файлов')}: ${todo.length}? ${T('Уже перенесённые файлы не трогаются.')}`)) return;
  let done = 0, skipped = 0;
  const pr = progress('Перенос…');
  for (const f of todo) {
    pr.set(`${T('Перенос')} ${done + skipped + 1}/${todo.length}: ${f.lang}/${f.rel}`);
    try {
      const text = await Canon.loadStatic(f.lang, f.rel);
      if (text == null) { skipped++; continue; }
      await Canon.saveCanon(f.lang, f.rel, text, { baseVersion: 0, nick: myNick(), note: 'Перенос из Assets', audit: { action: 'canon.import' } });
      done++;
    } catch (e) { fail(e, `${f.lang}/${f.rel}`); }
  }
  pr.done();
  toast(`${T('Перенесено')}: ${done}${skipped ? `, ${T('нет в Assets')}: ${skipped}` : ''}`, 'ok');
  openTab('canon');
}

async function openFile(lang, rel, force = false) {
  if (!force && CS.dirty && !confirm(T('Отбросить несохранённые изменения?'))) return;
  Object.assign(CS, { sel: { lang, rel }, manifest: null, source: null, data: undefined, text: '', path: [], key: null,
    mode: Canon.isJson(rel) ? 'entries' : 'raw', entryJson: false, dirty: false, changes: new Map(), search: '' });
  $$('#cn-files .file').forEach((b) => b.setAttribute('aria-current', String(b.dataset.lang === lang && b.dataset.rel === rel)));
  const ed = $('#cn-editor');
  ed.innerHTML = '<div class="notice">Загрузка файла…</div>';
  try {
    const c = await Canon.loadCanon(lang, rel);
    if (c) { CS.manifest = c.manifest; CS.source = 'canon'; CS.text = c.text; }
    else {
      const s = await Canon.loadStatic(lang, rel);
      CS.source = s == null ? 'none' : 'static';
      CS.text = s ?? '';
    }
    if (Canon.isJson(rel) && CS.text) CS.data = JSON.parse(CS.text);
  } catch (e) { ed.innerHTML = `<div class="notice err">${esc(T(errText(e)))}</div>`; return; }
  renderEditor();
}

function setDirty() { CS.dirty = true; renderDirtyBar(); }

function renderEditor() {
  const ed = $('#cn-editor');
  if (!ed || !CS.sel) return;
  const { lang, rel } = CS.sel;
  const m = CS.manifest;
  const group = rel.split('/')[0];
  const src = CS.source === 'canon' ? `<span class="chip on">Firestore v${m.version}</span>`
    : CS.source === 'static' ? '<span class="chip yellow">Только Assets — ещё не перенесён</span>'
      : '<span class="chip red">Файла нет</span>';
  ed.innerHTML = `
    <div class="panel">
      <div class="row between">
        <div><h2 style="margin:0" class="notranslate">${esc(lang)}/${esc(rel)}</h2>
          <div class="row small" style="margin-top:6px">${src}
            ${m ? `<span class="muted">${esc(kb(m.size))} · ${m.chunks} ${esc(T('кусков'))} · ${esc(fmt(m.updatedAt))} · <span class="notranslate">${esc(m.updatedByNick || '')}</span>${m.note ? ' · «' + esc(m.note) + '»' : ''}</span>` : ''}</div></div>
        <div class="row">
          ${Canon.isJson(rel) ? `<button class="btn sm ghost" id="ed-mode">${CS.mode === 'raw' ? '<i class="fa-solid fa-list"></i> По записям' : '<i class="fa-solid fa-code"></i> Файл целиком'}</button>` : ''}
          <button class="btn sm ghost" id="ed-export" ${CS.text || CS.data !== undefined ? '' : 'disabled'}><i class="fa-solid fa-download"></i> Скачать</button>
          <label class="btn sm ghost"><i class="fa-solid fa-upload"></i> Загрузить файл<input type="file" id="ed-upload" hidden accept="${Canon.isJson(rel) ? '.json,application/json' : '.html,.txt,text/*'}"></label>
          <button class="btn sm ghost" id="ed-static" title="${esc(T('Взять версию из репозитория (Assets/) в рабочую копию'))}"><i class="fa-solid fa-code-branch"></i> Из Assets</button>
          ${lang !== 'Rus' ? '<button class="btn sm ghost" id="ed-from-rus"><i class="fa-solid fa-language"></i> Копия русской</button>' : ''}
          ${CS.source === 'canon' ? '<button class="btn sm red" id="ed-reset"><i class="fa-solid fa-trash"></i> Убрать из Firestore</button>' : ''}
        </div>
      </div>
      ${group === 'builder' || ['characters/feats.json', 'characters/classes.json', 'items/equipment.json', 'characters/fixer.json', 'characters/bloodfiend.json', 'characters/bloodarch.json'].includes(rel)
        ? `<div class="notice warn small" style="margin-top:10px">${esc(T(BUILDER_NOTE))}</div>` : ''}
      ${CS.source === 'none' ? `<div class="notice" style="margin-top:10px">${esc(T('Файла на этом языке нет — сайт показывает русскую версию. Нажмите «Копия русской», чтобы начать перевод.'))}</div>` : ''}
      <div id="ed-body" style="margin-top:12px"></div>
      <div id="ed-dirty"></div>
    </div>`;

  $('#ed-mode', ed)?.addEventListener('click', () => {
    if (CS.mode === 'raw' && !applyRaw()) return;
    CS.mode = CS.mode === 'raw' ? 'entries' : 'raw';
    renderEditor();
  });
  $('#ed-export', ed).onclick = () => {
    const name = rel.split('/').pop();
    if (Canon.isJson(rel)) Canon.download(name, JSON.stringify(CS.data, null, 2) + '\n');
    else Canon.download(name, CS.text, 'text/html');
  };
  $('#ed-upload', ed).onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    loadIntoWorking(await f.text(), `файл ${f.name}`);
  };
  $('#ed-static', ed).onclick = async () => {
    const t = await Canon.loadStatic(lang, rel);
    if (t == null) return toast('В Assets/ нет такого файла', 'err');
    loadIntoWorking(t, 'Assets/');
  };
  $('#ed-from-rus', ed)?.addEventListener('click', async () => {
    try {
      const c = await Canon.loadCanon('Rus', rel);
      const t = c ? c.text : await Canon.loadStatic('Rus', rel);
      if (t == null) return toast('Русской версии нет', 'err');
      loadIntoWorking(t, 'русская версия');
    } catch (er) { fail(er); }
  });
  $('#ed-reset', ed)?.addEventListener('click', async () => {
    if (!confirm(T('Удалить файл из Firestore? Сайт снова будет брать его из Assets/ репозитория (правки, сделанные в панели, пропадут, если вы их не скачали).'))) return;
    try {
      await Canon.resetCanon(lang, rel, { nick: myNick() });
      toast('Файл убран из Firestore', 'ok');
      CS.dirty = false; CS.data = undefined; CS.text = '';
      openTab('canon');
    } catch (er) { fail(er, 'Не удалось убрать файл'); }
  });

  if (CS.mode === 'raw' || !Canon.isJson(rel)) renderRaw();
  else renderEntries();
  renderDirtyBar();
}

function loadIntoWorking(text, from) {
  const { rel } = CS.sel;
  try {
    if (Canon.isJson(rel)) CS.data = JSON.parse(text);
    CS.text = text;
  } catch (e) { return toast(`${T('Некорректный JSON')}: ${e.message}`, 'err'); }
  CS.changes.set('*', { label: `${T('весь файл заменён')}: ${from}` });
  CS.path = []; CS.key = null;
  setDirty();
  renderEditor();
  toast(`${T('Загружено в рабочую копию')}: ${from}. ${T('Не забудьте сохранить.')}`);
}

/* ---- Режим «файл целиком» ---- */
function renderRaw() {
  const body = $('#ed-body');
  const json = Canon.isJson(CS.sel.rel);
  const text = json ? (CS.data === undefined ? '' : JSON.stringify(CS.data, null, 2)) : CS.text;
  body.innerHTML = `<textarea class="in code notranslate" id="raw" spellcheck="false" style="min-height:60vh">${esc(text)}</textarea>
    <div class="row" style="margin-top:8px"><span class="muted small" id="raw-msg"></span><span class="spacer"></span>
      ${json ? '<button class="btn sm ghost" id="raw-check">Проверить JSON</button>' : ''}</div>`;
  const ta = $('#raw', body);
  ta.oninput = () => { CS.rawEdited = true; if (!CS.dirty) { CS.changes.set('*', { label: T('файл правился целиком') }); setDirty(); } };
  $('#raw-check', body)?.addEventListener('click', () => { if (applyRaw()) $('#raw-msg', body).textContent = T('JSON в порядке'); });
}
/** Забрать текст из режима «целиком» в рабочую копию. false — JSON с ошибкой. */
function applyRaw() {
  const ta = $('#raw');
  if (!ta || !CS.rawEdited) return true;
  if (!Canon.isJson(CS.sel.rel)) { CS.text = ta.value; return true; }
  try { CS.data = JSON.parse(ta.value); CS.rawEdited = false; return true; }
  catch (e) { toast(`${T('Некорректный JSON')}: ${e.message}`, 'err'); return false; }
}

/* ---- Режим «по записям» ---- */
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const getAt = (root, path) => path.reduce((o, k) => (o == null ? o : o[k]), root);
function textOf(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (isObj(v)) return textOf(v.ru ?? v.en ?? v.Name ?? v.name);
  return '';
}
function labelOf(v, k) {
  if (isObj(v)) {
    const l = textOf(v.Name ?? v.name ?? v.title ?? v.Title ?? v.id ?? v.label);
    if (l) return l;
  }
  if (typeof v === 'string') return v.length > 60 ? v.slice(0, 60) + '…' : v;
  return String(k);
}
function blankLike(v) {
  if (Array.isArray(v)) return [];
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, blankLike(x)]));
  if (typeof v === 'number') return 0;
  if (typeof v === 'boolean') return false;
  if (typeof v === 'string') return '';
  return null;
}
const pathKey = (p) => p.map(String).join(' › ');

function recordChange(path, label, before, after) {
  const key = pathKey(path);
  const prev = CS.changes.get(key);
  CS.changes.set(key, { label, before: prev ? prev.before : before, after });
  setDirty();
}

/** Применить открытую форму записи (если есть). false — в форме ошибка, действие нужно прервать. */
const applyOpenEntry = () => (CS.applyEntry ? CS.applyEntry() : true);

function renderEntries() {
  CS.applyEntry = null;
  const body = $('#ed-body');
  const container = getAt(CS.data, CS.path);
  if (container === undefined) { body.innerHTML = '<div class="notice">Пустой файл.</div>'; return; }
  if (!Array.isArray(container) && !isObj(container)) { CS.path = CS.path.slice(0, -1); return renderEntries(); }
  const isArr = Array.isArray(container);
  const keys = isArr ? container.map((_, i) => i) : Object.keys(container);
  const q = CS.search.trim().toLowerCase();
  const shown = keys.filter((k) => !q || labelOf(container[k], k).toLowerCase().includes(q) || String(k).includes(q));
  const changedHere = new Set([...CS.changes.keys()]);

  body.innerHTML = `
    <div class="crumbs notranslate"><button data-crumb="-1">${esc(CS.sel.rel.split('/').pop())}</button>
      ${CS.path.map((k, i) => `› <button data-crumb="${i}">${esc(labelOf(getAt(CS.data, CS.path.slice(0, i + 1)), k))}</button>`).join(' ')}</div>
    <div class="editor">
      <div>
        <div class="row" style="margin-bottom:6px">
          <input class="in" id="en-search" placeholder="${esc(T('Поиск'))}" value="${esc(CS.search)}" style="flex:1">
        </div>
        <div class="row" style="margin-bottom:6px">
          <button class="btn sm green" id="en-add" title="${esc(T('Добавить запись'))}"><i class="fa-solid fa-plus"></i></button>
          ${isArr ? `<button class="btn sm" id="en-dup" title="${esc(T('Дублировать'))}"><i class="fa-solid fa-clone"></i></button>
            <button class="btn sm" id="en-up" title="${esc(T('Выше'))}"><i class="fa-solid fa-arrow-up"></i></button>
            <button class="btn sm" id="en-down" title="${esc(T('Ниже'))}"><i class="fa-solid fa-arrow-down"></i></button>` : ''}
          <button class="btn sm red" id="en-del" title="${esc(T('Удалить запись'))}"><i class="fa-solid fa-trash"></i></button>
          <span class="muted small">${keys.length} ${esc(T('зап.'))}</span>
        </div>
        <div class="entries notranslate" id="en-list">
          ${shown.map((k) => `<button class="entry ${changedHere.has(pathKey([...CS.path, k])) ? 'changed' : ''}" data-key="${esc(k)}" aria-current="${String(k) === String(CS.key)}">
            <span class="idx">${isArr ? '#' + k : ''}</span><span>${esc(labelOf(container[k], k))}</span></button>`).join('') || '<div class="muted small" style="padding:8px">Ничего не найдено</div>'}
        </div>
      </div>
      <div id="en-edit">${CS.key == null || !(CS.key in container) ? '<div class="notice">Выберите запись.</div>' : ''}</div>
    </div>`;

  const s = $('#en-search', body);
  s.oninput = () => { CS.search = s.value; const pos = s.selectionStart; renderEntries(); const n = $('#en-search'); n.focus(); n.setSelectionRange(pos, pos); };
  $('.crumbs', body).onclick = (e) => {
    const b = e.target.closest('[data-crumb]');
    if (!b || !applyOpenEntry()) return;
    const i = Number(b.dataset.crumb);
    CS.key = i < 0 ? CS.path[0] ?? null : CS.path[i + 1] ?? null;
    CS.path = CS.path.slice(0, i + 1);
    CS.search = '';
    renderEntries();
  };
  $('#en-list', body).ondblclick = (e) => {
    const b = e.target.closest('[data-key]');
    const k = b && (isArr ? Number(b.dataset.key) : b.dataset.key);
    if (b && container[k] && typeof container[k] === 'object' && applyOpenEntry()) {
      CS.path = [...CS.path, k]; CS.key = null; CS.search = '';
      renderEntries();
    }
  };
  $('#en-list', body).onclick = (e) => {
    const b = e.target.closest('[data-key]');
    if (!b || !applyOpenEntry()) return;
    CS.key = isArr ? Number(b.dataset.key) : b.dataset.key;
    CS.entryJson = false;
    renderEntries();
  };
  $('#en-add', body).onclick = () => {
    if (!applyOpenEntry()) return;
    if (isArr) {
      const tpl = container.length ? blankLike(container[CS.key ?? 0] ?? container[0]) : {};
      container.push(tpl);
      CS.key = container.length - 1;
      recordChange([...CS.path, CS.key], T('новая запись'), null, tpl);
    } else {
      const name = prompt(T('Ключ новой записи:'));
      if (!name) return;
      if (name in container) return toast('Такой ключ уже есть', 'err');
      const sample = Object.values(container).find(isObj);
      container[name] = sample ? blankLike(sample) : '';
      CS.key = name;
      recordChange([...CS.path, name], name, null, container[name]);
    }
    renderEntries();
  };
  $('#en-del', body).onclick = () => {
    if (CS.key == null || !(CS.key in container)) return;
    const label = labelOf(container[CS.key], CS.key);
    if (!confirm(`${T('Удалить запись')} «${label}»?`)) return;
    const before = container[CS.key];
    if (isArr) container.splice(CS.key, 1); else delete container[CS.key];
    recordChange([...CS.path, CS.key, 'удалено'], `${T('удалено')}: ${label}`, before, null);
    CS.key = null;
    renderEntries();
  };
  const move = (d) => {
    if (!applyOpenEntry()) return;
    const i = CS.key;
    if (i == null || i + d < 0 || i + d >= container.length) return;
    [container[i], container[i + d]] = [container[i + d], container[i]];
    recordChange([...CS.path, 'порядок'], T('изменён порядок записей'), null, null);
    CS.key = i + d;
    renderEntries();
  };
  $('#en-up', body)?.addEventListener('click', () => move(-1));
  $('#en-down', body)?.addEventListener('click', () => move(1));
  $('#en-dup', body)?.addEventListener('click', () => {
    if (CS.key == null || !applyOpenEntry()) return;
    const copy = structuredClone(container[CS.key]);
    container.splice(CS.key + 1, 0, copy);
    CS.key += 1;
    recordChange([...CS.path, CS.key], `${T('копия')}: ${labelOf(copy, CS.key)}`, null, copy);
    renderEntries();
  });

  if (CS.key != null && CS.key in container) renderEntryEditor(container, CS.key);
}

function renderEntryEditor(container, key) {
  const box = $('#en-edit');
  const value = container[key];
  const path = [...CS.path, key];
  const label = labelOf(value, key);
  const asJson = CS.entryJson || !isObj(value);

  let fields = '';
  if (!asJson) {
    fields = Object.entries(value).map(([k, v]) => {
      const id = 'f-' + encodeURIComponent(k).replace(/%/g, '_');
      let input;
      if (typeof v === 'string') {
        const rows = Math.min(16, Math.max(1, Math.ceil(v.length / 90) + (v.match(/\n/g) || []).length));
        input = `<textarea class="in notranslate" id="${id}" data-f="${esc(k)}" data-t="string" rows="${rows}">${esc(v)}</textarea>`;
      } else if (typeof v === 'number') {
        input = `<input class="in notranslate" type="number" step="any" id="${id}" data-f="${esc(k)}" data-t="number" value="${esc(v)}">`;
      } else if (typeof v === 'boolean') {
        input = `<label class="check"><input type="checkbox" id="${id}" data-f="${esc(k)}" data-t="bool" ${v ? 'checked' : ''}> ${esc(T('да'))}</label>`;
      } else {
        const text = JSON.stringify(v, null, 2);
        const rows = Math.min(14, Math.max(2, (text.match(/\n/g) || []).length + 1));
        input = `<textarea class="in code notranslate" id="${id}" data-f="${esc(k)}" data-t="json" rows="${rows}" spellcheck="false">${esc(text)}</textarea>`;
      }
      const drill = (Array.isArray(v) && v.length) || (isObj(v) && Object.keys(v).length)
        ? ` <button class="btn sm ghost" data-drill="${esc(k)}" type="button"><i class="fa-solid fa-folder-open"></i> ${esc(T('Открыть списком'))}</button>` : '';
      return `<div class="field"><span class="notranslate">${esc(k)}${drill}</span>${input}</div>`;
    }).join('');
  }

  box.innerHTML = `
    <div class="row between" style="margin-bottom:8px">
      <h3 style="margin:0" class="notranslate">${esc(label)}</h3>
      <div class="row">
        ${(Array.isArray(value) && value.length) || (isObj(value) && Object.values(value).some((x) => x && typeof x === 'object'))
          ? `<button class="btn sm" id="ee-open"><i class="fa-solid fa-folder-open"></i> ${esc(T('Открыть списком'))}</button>` : ''}
        ${isObj(value) ? `<button class="btn sm ghost" id="ee-toggle">${asJson ? esc(T('Форма')) : 'JSON'}</button>` : ''}
        ${!asJson ? `<button class="btn sm ghost" id="ee-addf"><i class="fa-solid fa-plus"></i> ${esc(T('Поле'))}</button>` : ''}
      </div>
    </div>
    <div class="form">${asJson
      ? `<textarea class="in code notranslate" id="ee-json" rows="22" spellcheck="false">${esc(JSON.stringify(value, null, 2))}</textarea>`
      : fields}</div>
    <div class="row" style="margin-top:10px"><span class="muted small" id="ee-msg"></span><span class="spacer"></span>
      <button class="btn sm ghost" id="ee-cancel">Отменить</button>
      <button class="btn sm green" id="ee-apply"><i class="fa-solid fa-check"></i> Применить к записи</button></div>`;

  const read = () => {
    if (asJson) return JSON.parse($('#ee-json', box).value);
    const out = {};
    for (const el of $$('[data-f]', box)) {
      const k = el.dataset.f;
      if (el.dataset.t === 'string') out[k] = el.value;
      else if (el.dataset.t === 'number') { const n = Number(el.value); if (el.value === '' || Number.isNaN(n)) throw new Error(`${k}: ${T('нужно число')}`); out[k] = n; }
      else if (el.dataset.t === 'bool') out[k] = el.checked;
      else { try { out[k] = JSON.parse(el.value); } catch (e) { throw new Error(`${k}: ${e.message}`); } }
    }
    return out;
  };
  const apply = () => {
    let next;
    try { next = read(); } catch (e) { $('#ee-msg', box).textContent = e.message; $('#ee-msg', box).style.color = 'var(--red)'; return false; }
    const before = container[key];
    if (JSON.stringify(before) === JSON.stringify(next)) return true;
    container[key] = next;
    recordChange(path, labelOf(next, key), before, next);
    return true;
  };
  CS.applyEntry = apply;
  $('#ee-open', box)?.addEventListener('click', () => {
    if (!apply()) return;
    CS.path = path; CS.key = null; CS.search = '';
    renderEntries();
  });
  $('#ee-toggle', box)?.addEventListener('click', () => { if (apply()) { CS.entryJson = !CS.entryJson; renderEntries(); } });
  $('#ee-addf', box)?.addEventListener('click', () => {
    if (!apply()) return;
    const name = prompt(T('Название нового поля:'));
    if (!name || name in container[key]) return;
    const before = structuredClone(container[key]);
    container[key][name] = '';
    recordChange(path, labelOf(container[key], key), before, container[key]);
    renderEntries();
  });
  $('#ee-cancel', box).onclick = () => renderEntries();
  $('#ee-apply', box).onclick = () => { if (apply()) { renderEntries(); toast('Запись изменена в рабочей копии — сохраните файл', 'ok'); } };
  box.onclick = (e) => {
    const d = e.target.closest('[data-drill]');
    if (!d || !apply()) return;
    CS.path = [...path, d.dataset.drill];
    CS.key = null; CS.search = '';
    renderEntries();
  };
}

function renderDirtyBar() {
  const box = $('#ed-dirty');
  if (!box) return;
  if (!CS.dirty) { box.innerHTML = ''; return; }
  const list = [...CS.changes.values()].map((c) => c.label);
  box.innerHTML = `<div class="dirty-bar">
    <div class="row" style="margin-bottom:8px"><b class="oswald" style="color:var(--yellow)">${esc(T('Несохранённые изменения'))}: ${CS.changes.size}</b>
      <span class="muted small notranslate ellipsis" style="max-width:none;flex:1">${esc(list.slice(0, 8).join(' · '))}${list.length > 8 ? ' …' : ''}</span></div>
    <div class="row">
      <input class="in" id="sv-note" maxlength="300" placeholder="${esc(T('Комментарий к правке (попадёт в журнал)'))}" style="flex:1;min-width:200px">
      <button class="btn sm ghost" id="sv-discard">Отменить всё</button>
      <button class="btn sm green" id="sv-save"><i class="fa-solid fa-cloud-arrow-up"></i> Сохранить в Firestore</button>
    </div></div>`;
  $('#sv-discard', box).onclick = () => {
    if (!confirm(T('Отменить все несохранённые изменения?'))) return;
    CS.dirty = false;
    openFile(CS.sel.lang, CS.sel.rel, true);
  };
  $('#sv-save', box).onclick = saveFile;
}

async function saveFile() {
  if (CS.mode === 'raw' && !applyRaw()) return;
  // открытая форма записи могла быть не применена — применяем, чтобы не потерять правки
  if (CS.mode === 'entries' && !applyOpenEntry()) return;
  const { lang, rel } = CS.sel;
  const text = Canon.isJson(rel) ? JSON.stringify(CS.data) : CS.text;
  const note = $('#sv-note')?.value.trim() || '';
  // В журнал — что изменилось (с прежними значениями, чтобы правку можно было откатить вручную)
  const changes = [...CS.changes.entries()].map(([p, c]) => ({ path: p, label: c.label, before: c.before, after: c.after }));
  let details = JSON.stringify({ note, changes });
  if (details.length > 55000) details = JSON.stringify({ note, changes: changes.map(({ path, label }) => ({ path, label })), truncated: true });
  const btn = $('#sv-save');
  if (btn) btn.disabled = true;
  try {
    const r = await Canon.saveCanon(lang, rel, text, {
      baseVersion: CS.manifest?.version || 0, note, nick: myNick(),
      audit: { action: CS.manifest ? 'canon.save' : 'canon.import', details },
    });
    toast(`${T('Сохранено')}: v${r.version} (${kb(r.size)})`, 'ok');
    CS.dirty = false;
    const sel = CS.sel;
    CS.data = undefined; CS.text = '';
    CS.sel = sel;
    await renderCanon(view());
  } catch (e) {
    if (btn) btn.disabled = false;
    if (e.code === 'canon/conflict') toast(e.message, 'err');
    else fail(e, 'Не удалось сохранить');
  }
}

/* ============================================================
   Пользователи
   ============================================================ */
const US = { search: '', filter: 'all' };

async function renderUsers(v) {
  const canMon = can(S, 'monitor') || can(S, 'ban');
  const [users, presence, roles, bans] = await Promise.all([
    getDocs(collection(db, 'users')).catch(() => null),
    canMon ? getDocs(collection(db, 'presence')).catch(() => null) : null,
    isHead(S) || can(S, 'monitor') ? getDocs(collection(db, 'roles')).catch(() => null) : null,
    getDocs(collection(db, 'bans')).catch(() => null),
  ]);
  const map = new Map();
  const get = (uid) => { if (!map.has(uid)) map.set(uid, { uid }); return map.get(uid); };
  users?.forEach((d) => { get(d.id).nick = d.data().nick; });
  presence?.forEach((d) => Object.assign(get(d.id), { p: d.data(), nick: get(d.id).nick || d.data().nick }));
  roles?.forEach((d) => { get(d.id).role = d.data().role; });
  bans?.forEach((d) => { get(d.id).ban = d.data(); });
  const all = [...map.values()];
  const seen = (u) => toDate(u.p?.lastSeen)?.getTime() || 0;
  all.sort((a, b) => seen(b) - seen(a) || String(a.nick || '').localeCompare(String(b.nick || '')));

  v.innerHTML = `
    <div class="panel">
      <div class="row between" style="margin-bottom:10px">
        <h2 style="margin:0">Пользователи <span class="muted small">(${all.length})</span></h2>
        <div class="row">
          <input class="in" id="us-search" placeholder="${esc(T('Ник, email или uid'))}" value="${esc(US.search)}" style="width:240px">
          <select class="in" id="us-filter" style="width:auto">
            ${[['all', 'Все'], ['day', 'Активны за 24 ч'], ['banned', 'Заблокированные'], ['staff', 'Сотрудники']].map(([k, l]) =>
              `<option value="${k}" ${US.filter === k ? 'selected' : ''}>${esc(T(l))}</option>`).join('')}
          </select>
        </div>
      </div>
      <p class="muted small" style="margin-bottom:10px">Список собирается из реестра ников и отметок активности (их пишет сайт при заходе, не чаще раза в 10 минут).
        Аккаунты, которые ни разу не заходили после обновления сайта и не задали ник, здесь не видны.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Ник</th><th>Email</th><th>Роль</th><th>Был</th><th>Впервые</th><th>Страница</th><th>Статус</th><th></th></tr></thead>
        <tbody id="us-body"></tbody></table></div>
    </div>`;

  const draw = () => {
    const q = US.search.trim().toLowerCase();
    const day = Date.now() - 864e5;
    const rows = all.filter((u) => {
      if (US.filter === 'day' && seen(u) < day) return false;
      if (US.filter === 'banned' && !banActive(u.ban)) return false;
      if (US.filter === 'staff' && !u.role) return false;
      return !q || [u.nick, u.p?.email, u.uid].some((x) => String(x || '').toLowerCase().includes(q));
    });
    $('#us-body', v).innerHTML = rows.slice(0, 500).map((u) => {
      const banned = banActive(u.ban);
      const self = u.uid === S.user.uid;
      const canBanThis = can(S, 'ban') && !self && (!u.role || S.role === 'coder')
        && !CODER_EMAILS.includes(String(u.p?.email || '').toLowerCase());
      return `<tr>
        <td class="notranslate">${esc(u.nick || '—')}<div class="muted mono">${esc(u.uid)}</div></td>
        <td class="notranslate small">${esc(u.p?.email || '—')}</td>
        <td>${u.role ? `<span class="role-badge role-${esc(u.role)}">${esc(T(ROLES[u.role] || u.role))}</span>` : ''}</td>
        <td class="small" title="${esc(fmt(u.p?.lastSeen))}">${esc(T(ago(u.p?.lastSeen)))}</td>
        <td class="small">${esc(fmt(u.p?.firstSeen))}</td>
        <td class="small notranslate">${esc(u.p?.page || '—')}</td>
        <td>${banned ? `<span class="chip red" title="${esc(u.ban.reason || '')}">${esc(T('Заблокирован'))}${u.ban.until ? ' ' + esc(T('до')) + ' ' + esc(fmt(u.ban.until)) : ''}</span>`
          : u.ban ? `<span class="chip">${esc(T('бан истёк'))}</span>` : ''}</td>
        <td><div class="row">
          ${can(S, 'moderate') && u.p?.email ? `<button class="btn sm ghost" data-content="${esc(u.p.email)}" title="${esc(T('Записи пользователя'))}"><i class="fa-solid fa-database"></i></button>` : ''}
          ${can(S, 'ban') ? (u.ban
            ? `<button class="btn sm green" data-unban="${esc(u.uid)}" title="${esc(T('Снять блокировку'))}"><i class="fa-solid fa-unlock"></i></button>`
            : `<button class="btn sm red" data-ban="${esc(u.uid)}" ${canBanThis ? '' : `disabled title="${esc(T(self ? 'Себя заблокировать нельзя' : 'Сотрудника может заблокировать только Кодер'))}"`}><i class="fa-solid fa-ban"></i></button>`) : ''}
        </div></td></tr>`;
    }).join('') || '<tr><td colspan="8" class="muted">Никого не найдено</td></tr>';
  };
  draw();
  $('#us-search', v).oninput = (e) => { US.search = e.target.value; draw(); };
  $('#us-filter', v).onchange = (e) => { US.filter = e.target.value; draw(); };
  v.onclick = async (e) => {
    const c = e.target.closest('[data-content]');
    if (c) { MS.search = c.dataset.content; MS.vis = 'all'; MS.type = ''; return openTab('moderation'); }
    const b = e.target.closest('[data-ban]');
    if (b) return banDialog(map.get(b.dataset.ban));
    const u = e.target.closest('[data-unban]');
    if (u) {
      const user = map.get(u.dataset.unban);
      if (!confirm(`${T('Снять блокировку с')} ${user.nick || user.uid}?`)) return;
      try {
        const batch = writeBatch(db);
        batch.delete(doc(db, 'bans', user.uid));
        addAudit(batch, 'ban.remove', `${user.nick || ''} (${user.uid})`, { before: user.ban });
        await batch.commit();
        toast('Блокировка снята', 'ok');
        openTab('users');
      } catch (er) { fail(er, 'Не удалось снять блокировку'); }
    }
  };
}

function banDialog(u) {
  const m = modal(`${T('Заблокировать')}: ${u.nick || u.uid}`, `
    <div class="form">
      <p class="muted small">Заблокированный пользователь может входить и читать сайт, но не может ничего создавать и менять:
        записи базы, Офисы, досье, Ширмы, никнейм. Проверяется на сервере (firestore.rules).</p>
      <label class="field"><span>Срок</span><select class="in" id="b-term">
        <option value="1">1 ${esc(T('день'))}</option><option value="7">7 ${esc(T('дней'))}</option>
        <option value="30">30 ${esc(T('дней'))}</option><option value="0" selected>${esc(T('Навсегда'))}</option></select></label>
      <label class="field"><span>Причина</span><textarea class="in" id="b-reason" rows="3" maxlength="500"></textarea></label>
      <div class="row"><span class="spacer"></span><button class="btn ghost" data-x>Отмена</button><button class="btn red" id="b-ok">Заблокировать</button></div>
    </div>`);
  $('#b-ok', m.el).onclick = async () => {
    const days = Number($('#b-term', m.el).value);
    const data = {
      nick: String(u.nick || '').slice(0, 40), reason: $('#b-reason', m.el).value.trim().slice(0, 500),
      by: S.user.uid, byNick: myNick().slice(0, 40), at: serverTimestamp(),
    };
    if (days) data.until = Timestamp.fromMillis(Date.now() + days * 864e5);
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'bans', u.uid), data);
      addAudit(batch, 'ban.set', `${u.nick || ''} (${u.uid})`, { reason: data.reason, days: days || 'навсегда' });
      await batch.commit();
      m.close();
      toast('Пользователь заблокирован', 'ok');
      openTab('users');
    } catch (e) { fail(e, 'Не удалось заблокировать'); }
  };
}

/* ============================================================
   Модерация пользовательской базы (custom_content)
   ============================================================ */
const MS = { search: '', type: '', vis: 'all' };
const CONTENT_TYPES = { status: 'Статус', class: 'Архетип', feat: 'Черта', gift: 'Э.Г.О. гифт', equip: 'Снаряжение', bestiary: 'Бестиарий', rule: 'Правило', lore: 'Лор' };

async function renderModeration(v) {
  const snap = await getDocs(collection(db, 'custom_content'));
  const items = snap.docs.map((d) => {
    const x = d.data();
    return { id: d.id, raw: x, type: x.type, name: textOf(x.data?.Name ?? x.data?.name) || '—', creator: x.creator || '—',
      email: x.creatorEmail || '', priv: x.isPrivate, at: x.updatedAt };
  }).sort((a, b) => (toDate(b.at)?.getTime() || 0) - (toDate(a.at)?.getTime() || 0));
  const broken = items.filter((i) => typeof i.priv !== 'boolean');

  v.innerHTML = `
    <div class="panel">
      <div class="row between" style="margin-bottom:10px">
        <h2 style="margin:0">Пользовательская база <span class="muted small">(${items.length})</span></h2>
        <div class="row">
          <input class="in" id="md-search" placeholder="${esc(T('Название, автор или email'))}" value="${esc(MS.search)}" style="width:240px">
          <select class="in" id="md-type" style="width:auto"><option value="">${esc(T('Все типы'))}</option>
            ${Object.entries(CONTENT_TYPES).map(([k, l]) => `<option value="${k}" ${MS.type === k ? 'selected' : ''}>${esc(T(l))}</option>`).join('')}</select>
          <select class="in" id="md-vis" style="width:auto">
            ${[['all', 'Все'], ['public', 'Публичные'], ['private', 'Приватные']].map(([k, l]) => `<option value="${k}" ${MS.vis === k ? 'selected' : ''}>${esc(T(l))}</option>`).join('')}</select>
          ${broken.length ? `<button class="btn sm yellow" id="md-fix">${esc(T('Проставить флаг приватности'))} (${broken.length})</button>` : ''}
        </div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Тип</th><th>Название</th><th>Автор</th><th>Видимость</th><th>Изменено</th><th></th></tr></thead>
        <tbody id="md-body"></tbody></table></div>
    </div>`;

  const draw = () => {
    const q = MS.search.trim().toLowerCase();
    const rows = items.filter((i) => (!MS.type || i.type === MS.type)
      && (MS.vis === 'all' || (MS.vis === 'private' ? i.priv === true : i.priv !== true))
      && (!q || [i.name, i.creator, i.email, i.id].some((x) => String(x).toLowerCase().includes(q))));
    $('#md-body', v).innerHTML = rows.map((i) => `<tr>
      <td>${esc(T(CONTENT_TYPES[i.type] || i.type))}</td>
      <td class="notranslate ellipsis">${esc(i.name)}</td>
      <td class="notranslate small">${esc(i.creator)}<div class="muted">${esc(i.email)}</div></td>
      <td>${i.priv === true ? `<span class="chip yellow">${esc(T('Приватная'))}</span>` : i.priv === false ? `<span class="chip">${esc(T('Публичная'))}</span>` : `<span class="chip red">${esc(T('без флага'))}</span>`}</td>
      <td class="small">${esc(fmt(i.at))}</td>
      <td><div class="row">
        <button class="btn sm ghost" data-view="${esc(i.id)}" title="${esc(T('Посмотреть'))}"><i class="fa-solid fa-eye"></i></button>
        <button class="btn sm" data-priv="${esc(i.id)}" title="${esc(T(i.priv ? 'Сделать публичной' : 'Сделать приватной'))}"><i class="fa-solid ${i.priv ? 'fa-lock-open' : 'fa-lock'}"></i></button>
        <button class="btn sm red" data-del="${esc(i.id)}" title="${esc(T('Удалить'))}"><i class="fa-solid fa-trash"></i></button>
      </div></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Ничего не найдено</td></tr>';
  };
  draw();
  $('#md-search', v).oninput = (e) => { MS.search = e.target.value; draw(); };
  $('#md-type', v).onchange = (e) => { MS.type = e.target.value; draw(); };
  $('#md-vis', v).onchange = (e) => { MS.vis = e.target.value; draw(); };
  $('#md-fix', v)?.addEventListener('click', async () => {
    if (!confirm(`${T('Проставить isPrivate: false записям без флага')}: ${broken.length}?`)) return;
    try {
      for (let i = 0; i < broken.length; i += 300) {
        const batch = writeBatch(db);
        broken.slice(i, i + 300).forEach((x) => batch.set(doc(db, 'custom_content', x.id), { isPrivate: false }, { merge: true }));
        addAudit(batch, 'content.fixflags', `${broken.length}`, broken.slice(i, i + 300).map((x) => x.id).join(','));
        await batch.commit();
      }
      toast('Готово', 'ok');
      openTab('moderation');
    } catch (e) { fail(e); }
  });
  v.onclick = async (e) => {
    const find = (attr) => { const el = e.target.closest(`[${attr}]`); return el && items.find((i) => i.id === el.getAttribute(attr)); };
    let it;
    if ((it = find('data-view'))) return showJson(`${it.name} · ${it.creator}`, it.raw);
    if ((it = find('data-priv'))) {
      try {
        const batch = writeBatch(db);
        batch.update(doc(db, 'custom_content', it.id), { isPrivate: !it.priv });
        addAudit(batch, 'content.private', `${it.type}: ${it.name} (${it.id})`, { isPrivate: !it.priv, creator: it.email });
        await batch.commit();
        it.priv = !it.priv;
        draw();
      } catch (er) { fail(er); }
      return;
    }
    if ((it = find('data-del'))) {
      if (!confirm(`${T('Удалить запись')} «${it.name}» (${it.creator})? ${T('Копия попадёт в журнал.')}`)) return;
      try {
        const batch = writeBatch(db);
        batch.delete(doc(db, 'custom_content', it.id));
        addAudit(batch, 'content.delete', `${it.type}: ${it.name} (${it.id})`, JSON.stringify(it.raw, jsonReplacer));
        await batch.commit();
        items.splice(items.indexOf(it), 1);
        draw();
        toast('Запись удалена', 'ok');
      } catch (er) { fail(er, 'Не удалось удалить'); }
    }
  };
}

/* ============================================================
   Скрытое: все Офисы и Ширмы (Гл-Админ и Кодер)
   ============================================================ */
async function renderHidden(v) {
  const [offices, screens] = await Promise.all([
    getDocs(collection(db, 'offices')),
    getDocs(collection(db, 'custom_screens')),
  ]);
  const off = offices.docs.map((d) => ({ id: d.id, ...d.data() }));
  const scr = screens.docs.map((d) => ({ id: d.id, ...d.data() }));
  v.innerHTML = `
    <div class="panel" style="margin-bottom:14px">
      <div class="row between"><h2 style="margin:0">Офисы <span class="muted small">(${off.length})</span></h2>
        ${can(S, 'moderate') ? '<button class="btn sm ghost" id="hd-private"><i class="fa-solid fa-lock"></i> Приватные записи базы</button>' : ''}</div>
      <div class="table-wrap" style="margin-top:10px"><table>
        <thead><tr><th>Название</th><th>Создатель</th><th>Участники</th><th>Казна</th><th></th></tr></thead>
        <tbody>${off.map((o) => `<tr>
          <td class="notranslate">${esc(o.name || '—')}<div class="muted mono">${esc(o.id)}</div></td>
          <td class="notranslate small">${esc(o.creator || '—')}</td>
          <td class="notranslate small">${esc(Object.values(o.memberNames || {}).join(', ') || '—')}${(o.members || []).length ? `<div class="muted">${esc((o.members || []).join(', '))}</div>` : ''}</td>
          <td class="small">${esc(o.treasury?.balance ?? '—')}</td>
          <td><div class="row"><button class="btn sm ghost" data-office="${esc(o.id)}"><i class="fa-solid fa-eye"></i></button>
            <button class="btn sm red" data-office-del="${esc(o.id)}"><i class="fa-solid fa-trash"></i></button></div></td></tr>`).join('')
          || '<tr><td colspan="5" class="muted">Офисов нет</td></tr>'}</tbody></table></div>
    </div>
    <div class="panel">
      <h2>Ширмы <span class="muted small">(${scr.length})</span></h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Название</th><th>Создатель</th><th>Доступ</th><th>Зрители / админы</th><th></th></tr></thead>
        <tbody>${scr.map((s) => `<tr>
          <td class="notranslate">${esc(s.name || '—')}<div class="muted mono">${esc(s.id)}</div></td>
          <td class="notranslate small">${esc(s.creatorEmail || '—')}</td>
          <td><span class="chip ${s.accessLevel === 'public' ? 'on' : s.accessLevel === 'friends' ? 'cyan' : 'yellow'}">${esc(s.accessLevel || 'private')}</span></td>
          <td class="notranslate small">${esc((s.allowedUsers || []).length)} / ${esc((s.adminUsers || []).length)}</td>
          <td><div class="row"><button class="btn sm ghost" data-screen="${esc(s.id)}"><i class="fa-solid fa-eye"></i></button>
            <button class="btn sm red" data-screen-del="${esc(s.id)}"><i class="fa-solid fa-trash"></i></button></div></td></tr>`).join('')
          || '<tr><td colspan="5" class="muted">Ширм нет</td></tr>'}</tbody></table></div>
    </div>`;

  $('#hd-private', v)?.addEventListener('click', () => { MS.vis = 'private'; MS.search = ''; MS.type = ''; openTab('moderation'); });
  v.onclick = async (e) => {
    const pick = (attr, list) => { const el = e.target.closest(`[${attr}]`); return el && list.find((x) => x.id === el.getAttribute(attr)); };
    let o, s;
    if ((o = pick('data-office', off))) return viewOffice(o);
    if ((s = pick('data-screen', scr))) return viewScreen(s);
    if ((o = pick('data-office-del', off))) {
      const typed = prompt(`${T('Офис, все досье, контракты и казна будут удалены навсегда. Введите название офиса для подтверждения')}: ${o.name}`);
      if (typed == null) return;
      if (typed.trim().toUpperCase() !== String(o.name || '').trim().toUpperCase()) return toast('Название не совпадает — офис не удалён', 'err');
      try {
        const n = await deleteCollection(['offices', o.id, 'agents']);
        const batch = writeBatch(db);
        batch.delete(doc(db, 'offices', o.id));
        const { treasury, news, ...meta } = o;
        addAudit(batch, 'office.delete', `${o.name} (${o.id})`, JSON.stringify({ ...meta, agentsDeleted: n }, jsonReplacer));
        await batch.commit();
        toast('Офис удалён', 'ok');
        openTab('hidden');
      } catch (er) { fail(er, 'Не удалось удалить офис'); }
      return;
    }
    if ((s = pick('data-screen-del', scr))) {
      const typed = prompt(`${T('Ширма и все её объекты будут удалены навсегда. Введите название для подтверждения')}: ${s.name}`);
      if (typed == null) return;
      if (typed.trim().toUpperCase() !== String(s.name || '').trim().toUpperCase()) return toast('Название не совпадает — ширма не удалена', 'err');
      try {
        const a = await deleteCollection(['custom_screens', s.id, 'items']);
        const b = await deleteCollection(['custom_screens', s.id, 'secret']);
        const batch = writeBatch(db);
        batch.delete(doc(db, 'custom_screens', s.id));
        const { graphData, ...meta } = s;
        addAudit(batch, 'screen.delete', `${s.name} (${s.id})`, JSON.stringify({ ...meta, items: a, secret: b }, jsonReplacer));
        await batch.commit();
        toast('Ширма удалена', 'ok');
        openTab('hidden');
      } catch (er) { fail(er, 'Не удалось удалить ширму'); }
    }
  };
}

async function viewOffice(o) {
  const m = modal(`${T('Офис')}: ${o.name || o.id}`, '<div class="notice">Загрузка досье…</div>', { wide: true });
  try {
    const agents = await getDocs(collection(db, 'offices', o.id, 'agents'));
    const list = agents.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    $('.modal-body', m.el).innerHTML = `
      <div class="chips" style="margin-bottom:10px">
        <span class="chip">${esc(T('Создатель'))}: <span class="notranslate">${esc(o.creator || '—')}</span></span>
        <span class="chip">${esc(T('Казна'))}: ${esc(o.treasury?.balance ?? 0)}</span>
        <span class="chip">${esc(T('Контрактов'))}: ${esc((o.activeQuests || []).length + (o.customQuests || []).length)}</span>
        <span class="chip">${esc(T('Сводок'))}: ${esc((o.news || []).length)}</span>
      </div>
      <h3>Досье агентов (${list.length})</h3>
      <div class="table-wrap"><table><thead><tr><th>Имя</th><th>Раса / класс</th><th>Ур.</th><th>Игрок</th><th>Описание</th><th></th></tr></thead>
        <tbody>${list.map((a) => `<tr>
          <td class="notranslate">${esc(a.name)}</td><td class="notranslate small">${esc(a.race || '')} ${esc(a.className || '')}</td>
          <td>${esc(a.level ?? '')}</td><td class="notranslate small">${esc(a.ownerName || '')}</td>
          <td class="notranslate small ellipsis">${esc(a.description || '')}</td>
          <td><button class="btn sm ghost" data-agent="${esc(a.id)}"><i class="fa-solid fa-code"></i></button></td></tr>`).join('')
          || '<tr><td colspan="6" class="muted">Досье нет</td></tr>'}</tbody></table></div>
      <div class="row" style="margin-top:12px"><button class="btn sm ghost" id="of-raw"><i class="fa-solid fa-code"></i> Документ офиса целиком</button></div>`;
    $('#of-raw', m.el).onclick = () => showJson(o.name || o.id, o);
    $('.modal-body', m.el).addEventListener('click', (e) => {
      const b = e.target.closest('[data-agent]');
      if (!b) return;
      const a = list.find((x) => x.id === b.dataset.agent);
      let preset = null;
      try { preset = a.presetJson ? JSON.parse(a.presetJson) : null; } catch { /* ignore */ }
      showJson(a.name, { ...a, presetJson: preset ?? a.presetJson });
    });
  } catch (e) { $('.modal-body', m.el).innerHTML = `<div class="notice err">${esc(T(errText(e)))}</div>`; }
}

async function viewScreen(s) {
  const m = modal(`${T('Ширма')}: ${s.name || s.id}`, '<div class="notice">Загрузка объектов…</div>', { wide: true });
  try {
    const [items, secret] = await Promise.all([
      getDocs(collection(db, 'custom_screens', s.id, 'items')),
      getDocs(collection(db, 'custom_screens', s.id, 'secret')),
    ]);
    const all = [...items.docs.map((d) => ({ id: d.id, secret: false, ...d.data() })), ...secret.docs.map((d) => ({ id: d.id, secret: true, ...d.data() }))];
    const title = (x) => textOf(x.title ?? x.name ?? x.label ?? x.text) || x.kind || x.type || x.id;
    $('.modal-body', m.el).innerHTML = `
      <div class="chips" style="margin-bottom:10px">
        <span class="chip">${esc(T('Создатель'))}: <span class="notranslate">${esc(s.creatorEmail || '—')}</span></span>
        <span class="chip">${esc(T('Доступ'))}: ${esc(s.accessLevel || 'private')}</span>
        <span class="chip">${esc(T('Объектов'))}: ${items.size}</span>
        <span class="chip yellow">${esc(T('Скрытых («туман войны»)'))}: ${secret.size}</span>
      </div>
      <div class="muted small notranslate" style="margin-bottom:10px">${esc(T('Зрители'))}: ${esc((s.allowedUsers || []).join(', ') || '—')}<br>
        ${esc(T('Админы'))}: ${esc((s.adminUsers || []).join(', ') || '—')}</div>
      <div class="table-wrap" style="max-height:50vh"><table><thead><tr><th>Объект</th><th>Тип</th><th></th><th></th></tr></thead>
        <tbody>${all.slice(0, 500).map((x, i) => `<tr><td class="notranslate">${esc(title(x))}</td><td class="small">${esc(x.kind || x.type || '')}</td>
          <td>${x.secret ? `<span class="chip yellow">${esc(T('скрыт'))}</span>` : ''}</td>
          <td><button class="btn sm ghost" data-item="${i}"><i class="fa-solid fa-code"></i></button></td></tr>`).join('')
          || '<tr><td colspan="4" class="muted">Пусто</td></tr>'}</tbody></table></div>
      <div class="row" style="margin-top:12px"><button class="btn sm ghost" id="sc-raw"><i class="fa-solid fa-code"></i> Документ ширмы</button></div>`;
    $('#sc-raw', m.el).onclick = () => { const { graphData, ...meta } = s; showJson(s.name || s.id, graphData ? { ...meta, graphData: '(старый формат, ' + JSON.stringify(graphData).length + ' символов)' } : meta); };
    $('.modal-body', m.el).addEventListener('click', (e) => {
      const b = e.target.closest('[data-item]');
      if (b) showJson(title(all[Number(b.dataset.item)]), all[Number(b.dataset.item)]);
    });
  } catch (e) { $('.modal-body', m.el).innerHTML = `<div class="notice err">${esc(T(errText(e)))}</div>`; }
}

/* ============================================================
   Журнал
   ============================================================ */
const ACTIONS = {
  'canon.save': 'Канон: правка', 'canon.import': 'Канон: перенос', 'canon.reset': 'Канон: убран из Firestore',
  'role.grant': 'Доступ выдан', 'role.update': 'Доступ изменён', 'role.remove': 'Доступ снят',
  'ban.set': 'Блокировка', 'ban.remove': 'Снятие блокировки',
  'content.delete': 'Запись базы удалена', 'content.private': 'Видимость записи', 'content.fixflags': 'Флаги приватности',
  'office.delete': 'Офис удалён', 'screen.delete': 'Ширма удалена',
};
const AS = { docs: [], last: null, end: false, filter: '' };

function auditTable(docs) {
  return `<div class="table-wrap"><table><thead><tr><th>Когда</th><th>Кто</th><th>Действие</th><th>Объект</th><th></th></tr></thead><tbody>
    ${docs.map((d, i) => { const a = d.data(); return `<tr>
      <td class="small" title="${esc(fmt(a.at))}">${esc(fmt(a.at))}</td>
      <td class="notranslate">${esc(a.nick || a.uid)}</td>
      <td><span class="chip ${/delete|remove|reset|ban\.set/.test(a.action) ? 'red' : /canon/.test(a.action) ? 'cyan' : 'on'}">${esc(T(ACTIONS[a.action] || a.action))}</span></td>
      <td class="notranslate small ellipsis">${esc(a.target)}</td>
      <td>${a.details ? `<button class="btn sm ghost" data-details="${i}"><i class="fa-solid fa-magnifying-glass"></i></button>` : ''}</td></tr>`; }).join('')}
  </tbody></table></div>`;
}
function bindAuditDetails(box, docs) {
  box.onclick = (e) => {
    const b = e.target.closest('[data-details]');
    if (!b) return;
    const a = docs[Number(b.dataset.details)].data();
    let val = a.details;
    try { val = JSON.parse(a.details); } catch { /* обычный текст */ }
    showJson(`${T(ACTIONS[a.action] || a.action)} · ${a.target}`, val);
  };
}

async function renderAudit(v) {
  Object.assign(AS, { docs: [], last: null, end: false });
  v.innerHTML = `<div class="panel">
    <div class="row between" style="margin-bottom:10px"><h2 style="margin:0">Журнал действий</h2>
      <select class="in" id="au-filter" style="width:auto"><option value="">${esc(T('Все действия'))}</option>
        ${[['canon', 'Канон'], ['role', 'Доступы'], ['ban', 'Блокировки'], ['content', 'Модерация'], ['office', 'Офисы'], ['screen', 'Ширмы']]
          .map(([k, l]) => `<option value="${k}" ${AS.filter === k ? 'selected' : ''}>${esc(T(l))}</option>`).join('')}</select></div>
    <p class="muted small" style="margin-bottom:10px">Каждое действие в панели записывается сюда вместе с прежними значениями — по ним правку можно откатить вручную.</p>
    <div id="au-list"></div>
    <div class="row" style="margin-top:10px"><button class="btn sm ghost" id="au-more">Показать ещё</button></div></div>`;
  const more = async () => {
    const q = AS.last
      ? query(collection(db, 'audit'), orderBy('at', 'desc'), startAfter(AS.last), limit(50))
      : query(collection(db, 'audit'), orderBy('at', 'desc'), limit(50));
    const snap = await getDocs(q);
    AS.docs.push(...snap.docs);
    AS.last = snap.docs[snap.docs.length - 1] || AS.last;
    AS.end = snap.size < 50;
    draw();
  };
  const draw = () => {
    const docs = AS.docs.filter((d) => !AS.filter || String(d.data().action).startsWith(AS.filter + '.'));
    $('#au-list', v).innerHTML = docs.length ? auditTable(docs) : '<div class="muted">Записей нет</div>';
    bindAuditDetails($('#au-list', v), docs);
    $('#au-more', v).hidden = AS.end;
  };
  $('#au-filter', v).onchange = (e) => { AS.filter = e.target.value; draw(); };
  $('#au-more', v).onclick = () => more().catch((e) => fail(e));
  await more();
}
