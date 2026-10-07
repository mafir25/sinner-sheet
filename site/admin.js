// Админ-панель (admin.html).
// Роли и права — site/auth.js (Кодер → Гл-Админ → Админ), проверка на сервере — firestore.rules.
// Разделы: Обзор, Доступы, Канон, Пользователи, Модерация, Скрытое, Журнал. Каждое действие пишется
// в журнал audit/ одной пачкой с самим изменением.
import {
  collection, doc, getDoc, getDocs, query, where, orderBy, limit, startAfter, writeBatch,
  serverTimestamp, getCountFromServer, Timestamp,
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';
import { db, auth } from './firebase.js';
import {
  onAuth, refreshAccess, ROLES, PERMS, CANON_GROUPS, CODER_EMAILS, can, canCanon, isHead,
  findUserByNick, normalizePerms, banActive,
} from './auth.js';
import * as Canon from './canon.js';
import { diffLines, hunks, diffStats } from './diff.js';
import {
  SCHEMAS, formHtml, collectFields, repeatAction, canonSchemaFor, classFileRel, CLASS_REGISTRY, FILE_NAME_RE,
} from './fields.js';

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

// Timestamp, Date, ISO-строка (так пишет updatedAt База знаний) или число миллисекунд
const toDate = (ts) => {
  if (ts?.toDate) return ts.toDate();
  if (ts instanceof Date) return ts;
  if (typeof ts === 'string' || typeof ts === 'number') { const d = new Date(ts); return Number.isNaN(d.getTime()) ? null : d; }
  return null;
};
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
/** Подпись из значения: строка, число или { ru, en } / { Name } */
function textOf(v) {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'object' && !Array.isArray(v)) return textOf(v.ru ?? v.en ?? v.Name ?? v.name);
  return '';
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

/**
 * Действие + запись в журнал одной пачкой: fill(batch) добавляет сами изменения.
 * Показывает итог (ok — текст успеха) или ошибку; возвращает true, если получилось.
 */
async function logged(action, target, details, fill, { ok = '', failMsg = 'Ошибка' } = {}) {
  try {
    const batch = writeBatch(db);
    fill(batch);
    addAudit(batch, action, target, details);
    await batch.commit();
    if (ok) toast(ok, 'ok');
    return true;
  } catch (e) { fail(e, failMsg); return false; }
}
/** Подтверждение удаления вводом названия. */
function confirmName(message, name) {
  const typed = prompt(`${T(message)}: ${name}`);
  if (typed == null) return false;
  if (typed.trim().toUpperCase() === String(name || '').trim().toUpperCase()) return true;
  toast('Название не совпадает — ничего не удалено', 'err');
  return false;
}

/** Модальное окно. Возвращает { el, close }. */
function modal(title, bodyHtml, { wide = false } = {}) {
  const ov = document.createElement('div');
  ov.className = 'modal-ov';
  ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="${wide ? 'width:min(1200px,100%)' : ''}">
    <div class="modal-head"><h2 style="margin:0" class="notranslate">${esc(title)}</h2><button class="btn ghost sm" data-x>✕</button></div>
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

/* ---------- сравнение версий ---------- */
/** JSON — в одинаковом виде (отступ 2), чтобы сравнение шло по смыслу, а не по форматированию. */
function normText(text, rel) {
  if (text == null) return '';
  if (!Canon.isJson(rel)) return String(text);
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return String(text); }
}
function showDiff(title, before, after, { beforeLabel = 'было', afterLabel = 'стало' } = {}) {
  const ops = diffLines(String(before).split('\n'), String(after).split('\n'));
  const st = diffStats(ops);
  const hs = hunks(ops, 3);
  const MAX_ROWS = 4000;
  let rows = 0;
  const body = hs.length ? hs.map((h) => {
    if (rows > MAX_ROWS) return '';
    const lines = h.ops.map((o) => {
      rows++;
      const cls = o.op === '+' ? 'add' : o.op === '-' ? 'del' : '';
      return `<tr class="${cls}"><td class="ln">${o.a ?? ''}</td><td class="ln">${o.b ?? ''}</td><td class="sg">${o.op === '=' ? ' ' : o.op}</td><td class="tx">${esc(o.line)}</td></tr>`;
    }).join('');
    return `<tbody class="hunk">${lines}</tbody>`;
  }).join('') : '';
  modal(title, hs.length
    ? `<div class="row small" style="margin-bottom:8px"><span class="chip on">+${st.added}</span><span class="chip red">−${st.removed}</span>
        <span class="muted">${esc(T(beforeLabel))} → ${esc(T(afterLabel))}</span></div>
       <div class="diff-wrap"><table class="diff notranslate">${body}</table></div>
       ${rows > MAX_ROWS ? `<p class="muted small">${esc(T('Показаны не все изменения — их слишком много.'))}</p>` : ''}`
    : `<div class="notice">${esc(T('Различий нет.'))}</div>`, { wide: true });
}
/** Текст рабочей копии открытого файла канона. */
const workingText = () => (Canon.isJson(CS.sel.rel) ? JSON.stringify(CS.data, null, 2) : String(CS.data ?? ''));

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
  // Каждая вкладка рисуется в свой контейнер: если её данные придут после перехода на другую вкладку,
  // они попадут в уже снятый со страницы контейнер и ничего не испортят.
  const box = document.createElement('div');
  box.innerHTML = '<div class="notice">Загрузка…</div>';
  view().replaceChildren(box);
  try { await tab.render(box); }
  catch (e) { console.error(e); box.innerHTML = `<div class="notice err">${esc(T(errText(e)))}</div>`; }
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
  const key = `${a.user?.uid || ''}|${a.role || ''}|${JSON.stringify(a.perms || {})}|${a.role ? '' : a.nickStatus}`;
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
    view().innerHTML = a.banned
      ? `<div class="notice err">Ваш аккаунт заблокирован${a.banned.until ? ' до ' + esc(fmt(a.banned.until)) : ''}.${a.banned.reason ? ' Причина: ' + esc(a.banned.reason) : ''}</div>`
      : `<div class="notice">У вашего аккаунта нет доступа к админ-панели. Доступ выдаёт Гл-Админ или Кодер — отправьте им ID аккаунта:
          <div class="row" style="margin:10px 0"><code class="mono notranslate" id="my-uid" style="color:var(--cyan);font-size:.95rem">${esc(a.user.uid)}</code>
            <button class="btn sm" id="copy-uid"><i class="fa-solid fa-copy"></i> Скопировать</button></div>
          ${a.nickStatus === 'ok' ? `Или ваш никнейм: <b class="notranslate">${esc(a.nick)}</b>.`
            : 'Никнейм у вас не задан в реестре — по нику вас не найти. Задайте его в ⚙ Настройках (левый нижний угол).'}</div>`;
    $('#copy-uid')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(a.user.uid); toast('ID скопирован', 'ok'); }
      catch { getSelection().selectAllChildren($('#my-uid')); }
    });
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
        <input class="in notranslate" id="acc-nick" placeholder="${esc(T('Ник, email или ID аккаунта'))}" style="max-width:320px" maxlength="128">
        <button class="btn green" id="acc-find"><i class="fa-solid fa-user-plus"></i> Найти и настроить</button>
      </div>
      <p class="muted small" style="margin-top:8px">${S.role === 'coder'
        ? 'Вы можете назначать Гл-Админов и Админов.' : 'Гл-Админ назначает Админов и выбирает их права; Гл-Админов назначает Кодер.'}
      </p>
      <p class="muted small" style="margin-top:4px">Искать можно по нику (если человек задал его в ⚙ Настройках), по email (если он заходил на сайт после обновления) или по ID аккаунта — его человек видит, открыв admin.html, а Кодер — в Firebase Console → Authentication (столбец User UID).</p>
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
    const q = $('#acc-nick', v).value.trim();
    if (!q) return;
    try {
      const u = await findAccount(q);
      if (!u) return toast('Не найден ни по нику, ни по email, ни по ID — см. подсказку под полем', 'err');
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
      if (await logged('role.remove', `${r.nick || ''} (${r.uid})`, { before: { role: r.role, perms: r.perms } },
        (b) => b.delete(doc(db, 'roles', r.uid)), { ok: 'Доступ снят', failMsg: 'Не удалось снять доступ' })) openTab('access');
    }
  };
}

/** Найти аккаунт по нику, email (отметка активности presence/) или ID. { uid, nick } или null. */
async function findAccount(q) {
  if (q.includes('@')) {
    const snap = await getDocs(query(collection(db, 'presence'), where('email', '==', q.toLowerCase())));
    const d = snap.docs[0] || (await getDocs(query(collection(db, 'presence'), where('email', '==', q)))).docs[0];
    return d ? { uid: d.id, nick: d.data().nick || q.split('@')[0] } : null;
  }
  const byNick = await findUserByNick(q);
  if (byNick) return byNick;
  if (!/^[A-Za-z0-9]{20,40}$/.test(q)) return null;
  // ID аккаунта: ник берём из реестра или отметки активности, если они есть
  const [user, seen] = await Promise.all([getDoc(doc(db, 'users', q)), getDoc(doc(db, 'presence', q)).catch(() => null)]);
  const nick = (user.exists() && user.data().nick) || (seen?.exists() && (seen.data().nick || String(seen.data().email || '').split('@')[0])) || '';
  if (!nick && !confirm(T('Аккаунт с таким ID ещё ни разу не отмечался на сайте. Всё равно выдать доступ? Проверьте ID — ошибка в нём выдаст доступ «никому».'))) return null;
  return { uid: q, nick };
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
    const done = await logged(exists ? 'role.update' : 'role.grant', `${r.nick || ''} (${r.uid})`,
      { role, perms, before: exists ? { role: r.role, perms: r.perms } : null },
      (b) => b.set(doc(db, 'roles', r.uid), {
        role, perms, nick: String(r.nick || '').slice(0, 40),
        grantedBy: S.user.uid, grantedByNick: myNick().slice(0, 40), updatedAt: serverTimestamp(),
      }), { ok: 'Доступ сохранён', failMsg: 'Не удалось сохранить доступ' });
    if (!done) return;
    m.close();
    if (r.uid === S.user.uid) await refreshAccess();
    openTab('access');
  };
}

/* ============================================================
   Канон
   Редактор как конструктор Базы знаний: слева записи файла, справа запись в виде
   «Поля» (схема из site/fields.js — те же поля, что в navigation.html) или «Код» (JSON).
   Файлы без схемы (world.json, Builder_*, статьи) правятся только кодом.
   ============================================================ */
const CS = {
  manifests: new Map(),
  registry: [],       // реестр классов (characters/systems.json): [{ id, Name, BaseTitle, Base, Archetypes }]
  sel: null,          // { lang, rel }
  manifest: null,     // манифест открытой версии (null — файла в Firestore нет)
  source: null,       // 'canon' | 'static' | 'none'
  data: undefined,    // рабочая копия: разобранный JSON или текст (статьи)
  key: null,          // выбранная запись (индекс), null — весь файл
  view: 'fields',     // fields | code
  apply: null,        // применить открытую запись к рабочей копии → false, если в ней ошибка
  search: '',
  dirty: false,
  changes: new Map(), // запись → { label, before, after } — для журнала
};

const BUILDER_NOTE = 'Конструктор персонажа берёт черты, умения и предметы по порядку (индексу). Правка текста безопасна; '
  + 'добавление, удаление или перестановка записей требуют перегенерации Builder_*.json (node scripts/gen-builder-data.mjs) и их переноса.';
const BUILDER_LINKED = ['characters/feats.json', 'characters/classes.json', 'characters/fixer.json',
  'characters/bloodfiend.json', 'characters/bloodarch.json', 'items/equipment.json'];

const isList = () => Array.isArray(CS.data);
const schemaOf = () => SCHEMAS[canonSchemaFor(CS.sel?.rel, CS.registry)] || null;
const entryOf = () => (CS.key == null ? CS.data : CS.data[CS.key]);
const labelOf = (v, i) => textOf(v?.Name ?? v?.name ?? v?.id) || `#${i}`;

/* Markdown-поле: textarea + предпросмотр (как в конструкторе, без калькуляторов) */
const ADMIN_FIELDS = {
  md: (f, val) => `<div class="md-editor">
    <div class="md-toolbar"><span class="md-spacer"></span><button type="button" data-act="md-preview">Предпросмотр</button></div>
    <textarea class="cloud-input" data-f="${esc(f.k)}" placeholder="${esc(T('Поддерживается Markdown'))}">${esc(val ?? '')}</textarea>
    <div class="md-preview md" hidden></div></div>`,
};
function togglePreview(btn) {
  const wrap = btn.closest('.md-editor'), box = wrap.querySelector('.md-preview');
  btn.classList.toggle('on');
  box.hidden = !btn.classList.contains('on');
  if (!box.hidden) box.innerHTML = DOMPurify.sanitize(marked.parse(wrap.querySelector('textarea').value || ''));
}

/* ---- Реестр классов: класс → файл основы + файл архетипов (папка characters/) ---- */
async function loadRegistry() {
  try {
    const r = await Canon.loadText('Rus', CLASS_REGISTRY);
    const list = r ? JSON.parse(r.text) : [];
    return Array.isArray(list) ? list : [];
  } catch (e) { console.warn('Реестр классов не прочитан', e); return []; }
}
const registryRels = (reg) => reg.flatMap((c) => [classFileRel(c?.Base), classFileRel(c?.Archetypes)]).filter(Boolean);
/** Подпись файла класса в списке: «основа: Фиксер» / «архетипы: Фиксер». */
function classTag(rel) {
  for (const c of CS.registry) {
    if (classFileRel(c?.Base) === rel) return `${T('основа')}: ${textOf(c.Name) || c.id}`;
    if (classFileRel(c?.Archetypes) === rel) return `${T('архетипы')}: ${textOf(c.Name) || c.id}`;
  }
  return '';
}

async function renderCanon(v) {
  try { CS.manifests = await Canon.listManifests(); } catch (e) { fail(e, 'Не удалось прочитать канон'); }
  CS.registry = await loadRegistry();
  // В списке — файлы Assets/, созданные в панели (есть только в Firestore) и упомянутые в реестре классов
  const files = Canon.canonFiles([...Canon.manifestRels(CS.manifests), ...registryRels(CS.registry)]);
  const groups = [...new Set(files.map((f) => f.group))];
  const inAssets = new Set(window.I18N.canon.files());
  v.innerHTML = `
    <div class="panel" style="margin-bottom:14px">
      <div class="row between">
        <h2 style="margin:0">Каноничные данные</h2>
        <div class="row">
          <button class="btn sm ghost" id="cn-reload"><i class="fa-solid fa-rotate"></i> Обновить</button>
          ${CANON_GROUPS.some((g) => canCanon(S, g)) ? '<button class="btn sm green" id="cn-new-file"><i class="fa-solid fa-file-circle-plus"></i> Новый файл</button>' : ''}
          ${canCanon(S, 'characters') ? '<button class="btn sm green" id="cn-new-class"><i class="fa-solid fa-sitemap"></i> Новый класс</button>' : ''}
          ${files.some((f) => canCanon(S, f.group)) ? '<button class="btn sm yellow" id="cn-import-all"><i class="fa-solid fa-cloud-arrow-up"></i> Перенести всё из Assets</button>' : ''}
        </div>
      </div>
      <p class="muted small" style="margin-top:8px">Сайт читает канон из Firestore (коллекция canon); если файла там нет или Firestore недоступен — из папки Assets/ репозитория. Правки видны всем сразу после сохранения.</p>
      <p class="muted small">Чтобы перенести правки обратно в репозиторий: <span class="mono notranslate">node scripts/canon-pull.mjs</span></p>
      <p class="muted small">Классы перечислены в реестре <span class="mono notranslate">characters/systems.json</span>: у каждого класса — файл основы и файл архетипов. «Новый класс» создаёт оба файла и запись в реестре; привязать класс к уже существующим файлам можно там же или правкой реестра.</p>
    </div>
    <div class="canon">
      <div class="files" id="cn-files">
        ${groups.map((g) => `<div class="file-group">${esc(T(Canon.GROUP_NAMES[g] || g))}${canCanon(S, g) ? '' : ' · <i class="fa-solid fa-lock"></i>'}</div>
          ${files.filter((f) => f.group === g).map((f) => Object.keys(Canon.LANG_DIRS).map((lang) => {
            const m = CS.manifests.get(Canon.fileId(lang, f.rel));
            const cur = CS.sel?.lang === lang && CS.sel?.rel === f.rel;
            const tag = classTag(f.rel);
            return `<button class="file" data-lang="${lang}" data-rel="${esc(f.rel)}" aria-current="${cur}" ${canCanon(S, g) ? '' : 'disabled'}>
              <span style="min-width:0"><span class="notranslate">${esc(f.name)} <span class="muted small">${lang}</span></span>${tag
                ? `<span class="muted small" style="display:block"><i class="fa-solid fa-sitemap"></i> <span class="notranslate">${esc(tag)}</span></span>` : ''}</span>
              ${m ? `<span class="chip on">v${m.version}</span>` : inAssets.has(f.rel) ? '<span class="chip">Assets</span>'
                : `<span class="chip" title="${esc(T('Файла нет ни в Firestore, ни в Assets/'))}">${esc(T('нет'))}</span>`}</button>`;
          }).join('')).join('')}`).join('')}
      </div>
      <div id="cn-editor"><div class="notice">Выберите файл слева.</div></div>
    </div>`;

  $('#cn-reload', v).onclick = () => { if (confirmDiscard()) { CS.dirty = false; CS.sel = null; openTab('canon'); } };
  $('#cn-import-all', v)?.addEventListener('click', importAll);
  $('#cn-new-file', v)?.addEventListener('click', () => { if (confirmDiscard()) newFileDialog(); });
  $('#cn-new-class', v)?.addEventListener('click', () => { if (confirmDiscard()) newClassDialog(); });
  $('#cn-files', v).onclick = (e) => {
    const b = e.target.closest('.file');
    if (b && !b.disabled && confirmDiscard()) openFile(b.dataset.lang, b.dataset.rel);
  };
  if (CS.sel) await openFile(CS.sel.lang, CS.sel.rel);
}
const confirmDiscard = () => !CS.dirty || confirm(T('Отбросить несохранённые изменения?'));

async function importAll() {
  const todo = Canon.canonFiles().filter((f) => canCanon(S, f.group))
    .flatMap((f) => Object.keys(Canon.LANG_DIRS).map((lang) => ({ lang, ...f })))
    .filter((f) => !CS.manifests.has(Canon.fileId(f.lang, f.rel)));
  if (!todo.length) return toast('Все доступные вам файлы уже в Firestore', 'ok');
  if (!confirm(`${T('Перенести в Firestore файлов')}: ${todo.length}? ${T('Уже перенесённые файлы не трогаются.')}`)) return;
  let done = 0, skipped = 0;
  const pr = progress('Перенос…');
  for (const f of todo) {
    pr.set(`${T('Перенос')} ${done + skipped + 1}/${todo.length}: ${f.lang}/${f.rel}`);
    try {
      const text = await Canon.loadStatic(f.lang, f.rel);
      if (text == null) { skipped++; continue; }
      await Canon.saveCanon(f.lang, f.rel, text, { nick: myNick(), note: 'Перенос из Assets', audit: { action: 'canon.import' } });
      done++;
    } catch (e) { fail(e, `${f.lang}/${f.rel}`); }
  }
  pr.done();
  toast(`${T('Перенесено')}: ${done}${skipped ? `, ${T('нет в Assets')}: ${skipped}` : ''}`, 'ok');
  openTab('canon');
}

/* ---- Новый файл ---- */
const NEW_FILE_KINDS = { list: ['Список записей  [ ]', '[]'], object: ['Одна запись  { }', '{}'], text: ['Текст / HTML', ''] };
const extOk = (name) => /\.(json|html|txt)$/i.test(name);

function newFileDialog() {
  const groups = CANON_GROUPS.filter((g) => canCanon(S, g));
  const m = modal(T('Новый файл канона'), `
    <div class="form">
      <div class="row">
        <label class="field" style="flex:1;min-width:140px"><span>Раздел (папка)</span>
          <select class="in" id="nf-group">${groups.map((g) => `<option value="${g}">${esc(T(Canon.GROUP_NAMES[g] || g))} — ${g}/</option>`).join('')}</select></label>
        <label class="field" style="flex:2;min-width:180px"><span>Имя файла</span>
          <input class="in notranslate" id="nf-name" placeholder="my-file.json" maxlength="80"></label>
        <label class="field" style="width:120px"><span>Язык</span>
          <select class="in" id="nf-lang">${Object.entries(Canon.LANG_DIRS).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></label>
      </div>
      <label class="field"><span>Начальное содержимое</span>
        <select class="in" id="nf-kind">${Object.entries(NEW_FILE_KINDS).map(([k, [l]]) => `<option value="${k}">${esc(T(l))}</option>`).join('')}</select></label>
      <p class="muted small">Латиница, цифры, «_», «-», «.»; расширение .json, .html или .txt. Файл создаётся сразу в Firestore (в Assets/ его нет — перенести в репозиторий: <span class="mono notranslate">node scripts/canon-pull.mjs</span>). Сайт читает такой файл с папкой: <span class="mono notranslate">I18N.fetchData('characters/my-file.json')</span>; файлы классов подключает реестр классов.</p>
      <div class="row"><span class="small" id="nf-msg" style="color:var(--red)"></span><span class="spacer"></span>
        <button class="btn ghost" data-x>Отмена</button><button class="btn green" id="nf-ok"><i class="fa-solid fa-plus"></i> Создать</button></div>
    </div>`);
  const name = $('#nf-name', m.el), kind = $('#nf-kind', m.el), msg = $('#nf-msg', m.el);
  name.oninput = () => { if (/\.(html|txt)$/i.test(name.value)) kind.value = 'text'; else if (kind.value === 'text') kind.value = 'list'; };
  name.focus();
  $('#nf-ok', m.el).onclick = async () => {
    const group = $('#nf-group', m.el).value, lang = $('#nf-lang', m.el).value, n = name.value.trim();
    if (!FILE_NAME_RE.test(n) || !extOk(n)) { msg.textContent = T('Недопустимое имя файла'); return; }
    if (Canon.isJson(n) && kind.value === 'text') { msg.textContent = T('Для .json выберите список или запись'); return; }
    const rel = `${group}/${n}`;
    $('#nf-ok', m.el).disabled = true;
    try {
      if (await Canon.fileExists(lang, rel)) { msg.textContent = T('Такой файл уже есть'); $('#nf-ok', m.el).disabled = false; return; }
      await Canon.saveCanon(lang, rel, NEW_FILE_KINDS[kind.value][1], {
        baseVersion: 0, nick: myNick(), note: 'Новый файл', audit: { action: 'canon.create' },
      });
      m.close();
      toast(`${T('Файл создан')}: ${lang}/${rel}`, 'ok');
      CS.dirty = false; CS.sel = { lang, rel };
      openTab('canon', { push: false });
    } catch (e) { $('#nf-ok', m.el).disabled = false; fail(e, 'Не удалось создать файл'); }
  };
}

/* ---- Новый класс: файл основы + файл архетипов + запись в реестре ---- */
const TRANSLIT = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
const slugOf = (s) => [...String(s).toLowerCase()].map((ch) => TRANSLIT[ch] ?? ch).join('')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const CLASS_ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

function newClassDialog() {
  const m = modal(T('Новый класс'), `
    <div class="form">
      <div class="row">
        <label class="field" style="flex:2;min-width:180px"><span>Название класса</span>
          <input class="in notranslate" id="nc-name" placeholder="${esc(T('Например: Коллекционер'))}" maxlength="80"></label>
        <label class="field" style="flex:1;min-width:140px"><span>ID (латиница)</span>
          <input class="in notranslate" id="nc-id" placeholder="collector" maxlength="40"></label>
      </div>
      <label class="field"><span>Заголовок панели «Основа»</span>
        <input class="in notranslate" id="nc-title" maxlength="120"></label>
      <div class="row">
        <label class="field" style="flex:1;min-width:180px"><span>Файл основы (characters/)</span>
          <input class="in notranslate" id="nc-base" maxlength="80"></label>
        <label class="field" style="flex:1;min-width:180px"><span>Файл архетипов (characters/)</span>
          <input class="in notranslate" id="nc-arch" maxlength="80"></label>
      </div>
      <p class="muted small">Файлы, которых ещё нет, создаются в Firestore (русская версия; английская по умолчанию берётся из русской). Если файл уже существует — класс просто привязывается к нему. ID нужен для ссылок: архетипы пользователей ссылаются на класс по нему, поэтому после публикации его лучше не менять.</p>
      <p class="muted small">Конструктор персонажа (builder.html) пока знает только Фиксера и Кровососа — новый класс появится в Базе знаний.</p>
      <div class="row"><span class="small" id="nc-msg" style="color:var(--red)"></span><span class="spacer"></span>
        <button class="btn ghost" data-x>Отмена</button><button class="btn green" id="nc-ok"><i class="fa-solid fa-plus"></i> Создать класс</button></div>
    </div>`);
  const f = (id) => $('#nc-' + id, m.el), msg = f('msg');
  // Пока поле не трогали руками, оно подстраивается под название / ID
  const auto = new Set(['id', 'title', 'base', 'arch']);
  ['id', 'title', 'base', 'arch'].forEach((k) => { f(k).oninput = () => { auto.delete(k); if (k === 'id') fill(); }; });
  const fill = () => {
    const name = f('name').value.trim();
    if (auto.has('id')) f('id').value = slugOf(name);
    const id = f('id').value.trim();
    if (auto.has('title')) f('title').value = name ? `${name} (${T('основной класс')})` : '';
    if (auto.has('base')) f('base').value = id ? `${id}.json` : '';
    if (auto.has('arch')) f('arch').value = id ? `${id}-arch.json` : '';
  };
  f('name').oninput = fill;
  f('name').focus();
  f('ok').onclick = async () => {
    const entry = {
      id: f('id').value.trim(), Name: f('name').value.trim(), BaseTitle: f('title').value.trim(),
      Base: f('base').value.trim(), Archetypes: f('arch').value.trim(),
    };
    const bad = (t) => { msg.textContent = T(t); };
    if (!entry.Name) return bad('Укажите название класса');
    if (!CLASS_ID_RE.test(entry.id)) return bad('ID: строчная латиница, цифры, «_» и «-»');
    if (![entry.Base, entry.Archetypes].every((n) => FILE_NAME_RE.test(n) && Canon.isJson(n))) return bad('Имена файлов: латиница и .json на конце');
    if (entry.Base === entry.Archetypes) return bad('Основа и архетипы должны быть разными файлами');
    f('ok').disabled = true;
    const pr = progress('Создание класса…');
    try {
      const reg = await Canon.loadText('Rus', CLASS_REGISTRY);
      const list = reg ? JSON.parse(reg.text) : [];
      if (!Array.isArray(list)) throw new Error(T('Реестр классов повреждён — ожидается массив'));
      if (list.some((c) => c?.id === entry.id)) throw new Error(`${T('Класс с таким ID уже есть')}: ${entry.id}`);
      const used = registryRels(list);
      const baseRel = classFileRel(entry.Base), archRel = classFileRel(entry.Archetypes);
      if (used.includes(baseRel) || used.includes(archRel)) throw new Error(T('Файл уже привязан к другому классу'));
      const make = async (rel, text) => {
        if (await Canon.fileExists('Rus', rel)) return false;
        await Canon.saveCanon('Rus', rel, text, { baseVersion: 0, nick: myNick(), note: `Новый класс: ${entry.Name}`, audit: { action: 'canon.create' } });
        return true;
      };
      pr.set(`${T('Файл основы')}: ${baseRel}`);
      const madeBase = await make(baseRel, JSON.stringify({ Name: entry.Name, BaseTitle: entry.BaseTitle, Desc: '', Talents: [] }));
      pr.set(`${T('Файл архетипов')}: ${archRel}`);
      const madeArch = await make(archRel, '[]');
      pr.set(T('Реестр классов'));
      list.push(entry);
      await Canon.saveCanon('Rus', CLASS_REGISTRY, JSON.stringify(list), {
        baseVersion: reg ? reg.version : 0, nick: myNick(), note: `Новый класс: ${entry.Name}`,
        audit: { action: 'canon.class', details: JSON.stringify({ entry, created: { base: madeBase, archetypes: madeArch } }) },
      });
      pr.done();
      m.close();
      toast(`${T('Класс создан')}: ${entry.Name}`, 'ok');
      CS.dirty = false; CS.sel = { lang: 'Rus', rel: baseRel };
      openTab('canon', { push: false });
    } catch (e) {
      pr.done();
      f('ok').disabled = false;
      if (e.code === 'canon/conflict') toast(e.message, 'err'); else fail(e, 'Не удалось создать класс');
    }
  };
}

let loadSeq = 0;
async function openFile(lang, rel) {
  const seq = ++loadSeq;   // быстрый клик по другому файлу: ответ для этого файла станет устаревшим
  Object.assign(CS, { sel: { lang, rel }, manifest: null, source: null, data: undefined, key: null, apply: null,
    view: 'fields', search: '', note: '', dirty: false, changes: new Map() });
  $$('#cn-files .file').forEach((b) => b.setAttribute('aria-current', String(b.dataset.lang === lang && b.dataset.rel === rel)));
  const ed = $('#cn-editor');
  if (!ed) return;
  ed.innerHTML = '<div class="notice">Загрузка файла…</div>';
  let manifest = null, source, text;
  try {
    const c = await Canon.loadCanon(lang, rel);
    if (c) { manifest = c.manifest; source = 'canon'; text = c.text; }
    else { text = await Canon.loadStatic(lang, rel); source = text == null ? 'none' : 'static'; }
  } catch (e) {
    if (seq === loadSeq) ed.innerHTML = `<div class="notice err">${esc(T(errText(e)))}</div>`;
    return;
  }
  if (seq !== loadSeq || !ed.isConnected) return;   // пока грузили, открыли другой файл или ушли с вкладки
  Object.assign(CS, { manifest, source, originalText: text ?? null });
  try { setWorking(text ?? (Canon.isJson(rel) ? '[]' : '')); }
  catch (e) { ed.innerHTML = `<div class="notice err">${esc(T('Некорректный JSON'))}: ${esc(e.message)}</div>`; return; }
  renderEditor();
}

/** Положить текст файла в рабочую копию (бросает ошибку, если JSON битый). */
function setWorking(text) {
  CS.data = Canon.isJson(CS.sel.rel) ? JSON.parse(text) : String(text);
  CS.key = isList() && CS.data.length ? 0 : null;
}

function renderEditor() {
  const ed = $('#cn-editor');
  if (!ed || !CS.sel) return;
  const { lang, rel } = CS.sel, m = CS.manifest;
  const src = CS.source === 'canon' ? `<span class="chip on">Firestore v${m.version}</span>`
    : CS.source === 'static' ? '<span class="chip yellow">Только Assets — ещё не перенесён</span>'
      : '<span class="chip red">Файла нет</span>';
  ed.innerHTML = `
    <div class="panel">
      <div class="row between">
        <div style="min-width:0"><h2 style="margin:0;overflow-wrap:anywhere" class="notranslate">${esc(lang)}/${esc(rel)}</h2>
          <div class="row small" style="margin-top:6px">${src}
            ${m ? `<span class="muted">${esc(kb(m.size))} · ${esc(fmt(m.updatedAt))} · <span class="notranslate">${esc(m.updatedByNick || '')}</span>${m.note ? ' · «' + esc(m.note) + '»' : ''}</span>` : ''}</div></div>
        <div class="row">
          <button class="btn sm ghost" data-file="export"><i class="fa-solid fa-download"></i> Скачать</button>
          <label class="btn sm ghost"><i class="fa-solid fa-upload"></i> Загрузить файл<input type="file" id="ed-upload" hidden></label>
          <button class="btn sm ghost" data-file="static" title="${esc(T('Взять версию из репозитория (Assets/) в рабочую копию'))}"><i class="fa-solid fa-code-branch"></i> Из Assets</button>
          <button class="btn sm ghost" data-file="diff-assets" title="${esc(T('Чем рабочая копия отличается от версии в репозитории (Assets/)'))}"><i class="fa-solid fa-code-compare"></i> Сравнить с Assets</button>
          ${lang !== 'Rus' ? '<button class="btn sm ghost" data-file="rus"><i class="fa-solid fa-language"></i> Копия русской</button>' : ''}
          ${CS.source === 'canon' ? '<button class="btn sm red" data-file="reset"><i class="fa-solid fa-trash"></i> Убрать из Firestore</button>' : ''}
        </div>
      </div>
      ${rel.startsWith('builder/') || BUILDER_LINKED.includes(rel) ? `<div class="notice warn small" style="margin-top:10px">${esc(T(BUILDER_NOTE))}</div>` : ''}
      ${rel === 'world/world.json' ? `<div class="notice small" style="margin-top:10px">${esc(T('Карту базового мира удобнее править прямо в Ширме: откройте ширму из группы «Базовый мир» — у кого есть право на раздел «Мир», появится кнопка «Опубликовать в канон».'))}
        <a href="shirm.html" style="margin-left:6px">${esc(T('Открыть Ширму'))}</a></div>` : ''}
      ${rel === CLASS_REGISTRY ? `<div class="notice small" style="margin-top:10px">${esc(T('Реестр классов: у каждого класса — ID, название и два файла из папки characters/ (основа и архетипы). ID не меняйте — на него ссылаются архетипы пользователей. Удаление записи не удаляет сами файлы. Новый класс удобнее создать кнопкой «Новый класс».'))}</div>` : ''}
      ${CS.source === 'none' ? `<div class="notice" style="margin-top:10px">${esc(T('Файла на этом языке нет — сайт показывает русскую версию. Нажмите «Копия русской», чтобы начать перевод.'))}</div>` : ''}
      <div class="${isList() ? 'editor' : ''}" style="margin-top:12px">
        ${isList() ? '<div id="en-side"></div>' : ''}
        <div id="en-pane"></div>
      </div>
      <div id="ed-dirty"></div>
    </div>`;
  $('#ed-upload', ed).onchange = async (e) => { const f = e.target.files[0]; if (f) replaceFile(await f.text(), `${T('файл')} ${f.name}`); };
  ed.querySelector('.row').onclick = (e) => fileAction(e.target.closest('[data-file]')?.dataset.file);
  if (isList()) renderList();
  renderPane();
  renderDirtyBar();
}

async function fileAction(act) {
  if (!act) return;
  const { lang, rel } = CS.sel;
  try {
    if (act === 'export') {
      if (!CS.apply || CS.apply()) Canon.download(rel.split('/').pop(), Canon.isJson(rel) ? JSON.stringify(CS.data, null, 2) + '\n' : CS.data);
    } else if (act === 'diff-assets') {
      if (CS.apply && !CS.apply()) return;
      const t = await Canon.loadStatic(lang, rel);
      if (t == null) return toast('В Assets/ нет такого файла', 'err');
      showDiff(`${lang}/${rel}: Assets → ${T('рабочая копия')}`, normText(t, rel), normText(workingText(), rel), { beforeLabel: 'Assets/', afterLabel: 'рабочая копия' });
    } else if (act === 'static') {
      const t = await Canon.loadStatic(lang, rel);
      if (t == null) return toast('В Assets/ нет такого файла', 'err');
      replaceFile(t, 'Assets/');
    } else if (act === 'rus') {
      const c = await Canon.loadCanon('Rus', rel);
      const t = c ? c.text : await Canon.loadStatic('Rus', rel);
      if (t == null) return toast('Русской версии нет', 'err');
      replaceFile(t, T('русская версия'));
    } else if (act === 'reset') {
      if (!confirm(T('Удалить файл из Firestore? Сайт снова будет брать его из Assets/ репозитория (правки, сделанные в панели, пропадут, если вы их не скачали).')
        + (window.I18N.canon.files().includes(rel) ? '' : '\n\n' + T('Этого файла нет в Assets/ — он будет удалён совсем.')))) return;
      await Canon.resetCanon(lang, rel, { nick: myNick() });
      toast('Файл убран из Firestore', 'ok');
      CS.dirty = false;
      openTab('canon');
    }
  } catch (e) { fail(e); }
}

function replaceFile(text, from) {
  try { setWorking(text); } catch (e) { return toast(`${T('Некорректный JSON')}: ${e.message}`, 'err'); }
  markChanged('*', `${T('весь файл заменён')}: ${from}`);
  renderEditor();
  toast(`${T('Загружено в рабочую копию')}: ${from}. ${T('Не забудьте сохранить.')}`);
}

function markChanged(key, label, before, after) {
  const prev = CS.changes.get(key);
  CS.changes.set(key, { label, before: prev ? prev.before : before, after });
  CS.dirty = true;
  renderDirtyBar();
}

/* ---- Список записей ---- */
function renderList() {
  const side = $('#en-side');
  if (!side) return;
  const q = CS.search.trim().toLowerCase();
  const rows = CS.data.map((v, i) => [v, i]).filter(([v, i]) => !q || labelOf(v, i).toLowerCase().includes(q));
  side.innerHTML = `
    <input class="in" id="en-search" placeholder="${esc(T('Поиск'))}" value="${esc(CS.search)}" style="margin-bottom:6px">
    <div class="row" style="margin-bottom:6px">
      <button class="btn sm green" data-list="add" title="${esc(T('Добавить запись'))}"><i class="fa-solid fa-plus"></i></button>
      <button class="btn sm" data-list="dup" title="${esc(T('Дублировать'))}"><i class="fa-solid fa-clone"></i></button>
      <button class="btn sm" data-list="up" title="${esc(T('Выше'))}"><i class="fa-solid fa-arrow-up"></i></button>
      <button class="btn sm" data-list="down" title="${esc(T('Ниже'))}"><i class="fa-solid fa-arrow-down"></i></button>
      <button class="btn sm red" data-list="del" title="${esc(T('Удалить запись'))}"><i class="fa-solid fa-trash"></i></button>
      <span class="muted small">${CS.data.length} ${esc(T('зап.'))}</span>
    </div>
    <div class="entries notranslate">${rows.map(([v, i]) => `<button class="entry ${CS.changes.has(String(i)) ? 'changed' : ''}" data-key="${i}" aria-current="${i === CS.key}">
      <span class="idx">#${i}</span><span>${esc(labelOf(v, i))}</span></button>`).join('') || '<div class="muted small" style="padding:8px">Ничего не найдено</div>'}</div>`;
  const s = $('#en-search', side);
  s.oninput = () => { CS.search = s.value; renderList(); const n = $('#en-search'); n.focus(); n.setSelectionRange(s.value.length, s.value.length); };
  side.onclick = (e) => {
    const b = e.target.closest('[data-key],[data-list]');
    if (!b || (CS.apply && !CS.apply())) return;   // открытую запись сначала применяем
    if (b.dataset.key != null) CS.key = Number(b.dataset.key);
    else listAction(b.dataset.list);
    renderList(); renderPane();
  };
}

function listAction(act) {
  const list = CS.data, i = CS.key;
  if (act === 'add') {
    list.push({});
    CS.key = list.length - 1;
    markChanged(String(CS.key), T('новая запись'), null, {});
    return;
  }
  if (i == null || !(i in list)) return;
  if (act === 'dup') {
    list.splice(i + 1, 0, structuredClone(list[i]));
    CS.key = i + 1;
    markChanged(String(CS.key), `${T('копия')}: ${labelOf(list[i], i)}`, null, list[i + 1]);
  } else if (act === 'up' || act === 'down') {
    const j = act === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    CS.key = j;
    markChanged('order', T('изменён порядок записей'));
  } else if (act === 'del') {
    if (!confirm(`${T('Удалить запись')} «${labelOf(list[i], i)}»?`)) return;
    const [gone] = list.splice(i, 1);
    markChanged(`del:${labelOf(gone, i)}`, `${T('удалено')}: ${labelOf(gone, i)}`, gone, null);
    CS.key = list.length ? Math.min(i, list.length - 1) : null;
  }
}

/* ---- Запись: Поля | Код ---- */
function renderPane() {
  const pane = $('#en-pane');
  CS.apply = null;
  if (!pane) return;
  if (isList() && (CS.key == null || !(CS.key in CS.data))) { pane.innerHTML = '<div class="notice">Выберите запись.</div>'; return; }
  const schema = schemaOf(), value = entryOf(), json = Canon.isJson(CS.sel.rel);
  const canFields = !!schema && value && typeof value === 'object' && !Array.isArray(value);
  const mode = canFields ? CS.view : 'code';
  const code = json ? JSON.stringify(value, null, 2) : value;

  pane.innerHTML = `
    <div class="row between" style="margin-bottom:10px">
      <h3 style="margin:0" class="notranslate">${esc(CS.key == null ? CS.sel.rel.split('/').pop() : labelOf(value, CS.key))}</h3>
      <div class="segs">
        <button class="seg ${mode === 'fields' ? 'on' : ''}" data-view="fields" ${canFields ? '' : `disabled title="${esc(T('Для этого файла нет полей конструктора — только код'))}"`}>Поля</button>
        <button class="seg ${mode === 'code' ? 'on' : ''}" data-view="code">Код</button>
      </div>
    </div>
    ${mode === 'fields'
      ? `<div class="nav-form" id="en-form">${formHtml(schema, value, ADMIN_FIELDS)}</div>`
      : `<textarea class="in code notranslate" id="en-code" spellcheck="false" style="min-height:${CS.key == null ? 60 : 45}vh">${esc(code)}</textarea>`}
    <div class="row" style="margin-top:10px"><span class="small" id="en-msg" style="color:var(--red)"></span><span class="spacer"></span>
      <button class="btn sm ghost" data-pane="cancel">Отменить</button>
      <button class="btn sm green" data-pane="apply"><i class="fa-solid fa-check"></i> ${esc(T(CS.key == null ? 'Применить' : 'Применить к записи'))}</button></div>`;

  const read = () => (mode === 'fields'
    ? collectFields(schema, $('#en-form', pane), value)
    : json ? JSON.parse($('#en-code', pane).value) : $('#en-code', pane).value);
  CS.apply = () => {
    let next;
    try { next = read(); } catch (e) { $('#en-msg', pane).textContent = `${T('Ошибка')}: ${e.message}`; return false; }
    if (JSON.stringify(next) === JSON.stringify(value)) return true;
    if (CS.key == null) CS.data = next; else CS.data[CS.key] = next;
    markChanged(String(CS.key ?? '*'), CS.key == null ? T('файл') : labelOf(next, CS.key), value, next);
    if (isList()) renderList();
    return true;
  };
  pane.onclick = (e) => {
    const el = e.target.closest('[data-view],[data-pane],[data-act]');
    if (!el) return;
    if (el.dataset.act === 'md-preview') return togglePreview(el);
    if (el.dataset.act) return repeatAction(el, schema, ADMIN_FIELDS);
    if (el.dataset.pane === 'cancel') return renderPane();
    if (!CS.apply()) return;
    if (el.dataset.view) CS.view = el.dataset.view;
    else toast('Изменено в рабочей копии — сохраните файл', 'ok');
    renderPane();
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
      <input class="in" id="sv-note" maxlength="300" placeholder="${esc(T('Комментарий к правке (попадёт в журнал)'))}" style="flex:1;min-width:200px" value="${esc(CS.note || '')}">
      <button class="btn sm ghost" id="sv-diff"><i class="fa-solid fa-code-compare"></i> Сравнить</button>
      <button class="btn sm ghost" id="sv-discard">Отменить всё</button>
      <button class="btn sm green" id="sv-save"><i class="fa-solid fa-cloud-arrow-up"></i> Сохранить в Firestore</button>
    </div></div>`;
  $('#sv-note', box).oninput = (e) => { CS.note = e.target.value; };
  $('#sv-diff', box).onclick = () => {
    if (CS.apply && !CS.apply()) return;
    const { lang, rel } = CS.sel;
    showDiff(`${lang}/${rel}: ${T('несохранённые изменения')}`, normText(CS.originalText, rel), normText(workingText(), rel),
      { beforeLabel: CS.manifest ? `Firestore v${CS.manifest.version}` : 'Assets/', afterLabel: 'рабочая копия' });
  };
  $('#sv-discard', box).onclick = () => { if (confirm(T('Отменить все несохранённые изменения?'))) { CS.dirty = false; openFile(CS.sel.lang, CS.sel.rel); } };
  $('#sv-save', box).onclick = saveFile;
}

async function saveFile() {
  if (CS.apply && !CS.apply()) return;   // открытая запись могла быть не применена
  const { lang, rel } = CS.sel;
  const note = $('#sv-note')?.value.trim() || '';
  // В журнал — что изменилось, с прежними значениями (чтобы правку можно было откатить вручную)
  const changes = [...CS.changes.values()];
  let details = JSON.stringify({ note, changes });
  if (details.length > 55000) details = JSON.stringify({ note, changes: changes.map((c) => c.label), truncated: true });
  $('#sv-save').disabled = true;
  try {
    const r = await Canon.saveCanon(lang, rel, Canon.isJson(rel) ? JSON.stringify(CS.data) : CS.data, {
      baseVersion: CS.manifest?.version || 0, note, nick: myNick(),
      audit: { action: CS.manifest ? 'canon.save' : 'canon.import', details },
    });
    toast(`${T('Сохранено')}: v${r.version} (${kb(r.size)})`, 'ok');
    CS.dirty = false;
    await openTab('canon', { push: false });
  } catch (e) {
    $('#sv-save').disabled = false;
    if (e.code === 'canon/conflict') toast(e.message, 'err'); else fail(e, 'Не удалось сохранить');
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
      <p class="muted small" style="margin-bottom:10px">Список собирается из реестра ников и отметок активности (сайт пишет их при заходе,
        не чаще раза в 10 минут). Полный список аккаунтов Firebase сайту недоступен без серверного кода (тариф Spark): здесь нет тех,
        кто не задал ник и не заходил после обновления сайта. Такой человек может открыть admin.html и прислать свой ID аккаунта;
        все аккаунты видны Кодеру в Firebase Console → Authentication.</p>
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
      if (await logged('ban.remove', `${user.nick || ''} (${user.uid})`, { before: user.ban },
        (b) => b.delete(doc(db, 'bans', user.uid)), { ok: 'Блокировка снята', failMsg: 'Не удалось снять блокировку' })) openTab('users');
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
    if (await logged('ban.set', `${u.nick || ''} (${u.uid})`, { reason: data.reason, days: days || 'навсегда' },
      (b) => b.set(doc(db, 'bans', u.uid), data), { ok: 'Пользователь заблокирован', failMsg: 'Не удалось заблокировать' })) {
      m.close();
      openTab('users');
    }
  };
}

/* ============================================================
   Модерация пользовательской базы (custom_content)
   ============================================================ */
const MS = { search: '', type: '', vis: 'all', fresh: false };
// «Новые» в модерации — изменённые после прошлого визита в раздел (время хранится в этом браузере)
const LS_MOD_SEEN = 'admin.moderation.seen';
const readSeen = () => { try { return Number(localStorage.getItem(LS_MOD_SEEN)) || 0; } catch { return 0; } };
const CONTENT_TYPES = { status: 'Статус', baseclass: 'Класс', class: 'Архетип', feat: 'Черта', gift: 'Э.Г.О. гифт', equip: 'Снаряжение', bestiary: 'Бестиарий', rule: 'Правило', lore: 'Лор' };

async function renderModeration(v) {
  const snap = await getDocs(collection(db, 'custom_content'));
  const items = snap.docs.map((d) => {
    const x = d.data();
    return { id: d.id, raw: x, type: x.type, name: textOf(x.data?.Name ?? x.data?.name) || '—', creator: x.creator || '—',
      email: x.creatorEmail || '', priv: x.isPrivate, at: x.updatedAt };
  }).sort((a, b) => (toDate(b.at)?.getTime() || 0) - (toDate(a.at)?.getTime() || 0));
  const broken = items.filter((i) => typeof i.priv !== 'boolean');
  const seen = readSeen();
  const isNew = (i) => (toDate(i.at)?.getTime() || 0) > seen;
  const freshCount = seen ? items.filter(isNew).length : 0;

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
          ${seen ? `<label class="row small" style="gap:4px"><input type="checkbox" id="md-fresh" ${MS.fresh ? 'checked' : ''}> ${esc(T('Новые с прошлого визита'))} (${freshCount})</label>` : ''}
          <button class="btn sm ghost" id="md-seen" title="${esc(T('Отметить всё как просмотренное'))}"><i class="fa-solid fa-check-double"></i></button>
          ${broken.length ? `<button class="btn sm yellow" id="md-fix">${esc(T('Проставить флаг приватности'))} (${broken.length})</button>` : ''}
        </div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Тип</th><th>Название</th><th>Автор</th><th>Видимость</th><th>Изменено</th><th></th></tr></thead>
        <tbody id="md-body"></tbody></table></div>
    </div>`;

  const draw = () => {
    const q = MS.search.trim().toLowerCase();
    const rows = items.filter((i) => (!MS.type || i.type === MS.type) && (!MS.fresh || isNew(i))
      && (MS.vis === 'all' || (MS.vis === 'private' ? i.priv === true : i.priv !== true))
      && (!q || [i.name, i.creator, i.email, i.id].some((x) => String(x).toLowerCase().includes(q))));
    $('#md-body', v).innerHTML = rows.map((i) => `<tr>
      <td>${esc(T(CONTENT_TYPES[i.type] || i.type))}</td>
      <td class="notranslate ellipsis">${seen && isNew(i) ? `<span class="chip cyan">${esc(T('новое'))}</span> ` : ''}${esc(i.name)}</td>
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
  $('#md-fresh', v)?.addEventListener('change', (e) => { MS.fresh = e.target.checked; draw(); });
  $('#md-seen', v).onclick = () => {
    try { localStorage.setItem(LS_MOD_SEEN, String(Date.now())); } catch { /* приватный режим */ }
    MS.fresh = false;
    toast('Отмечено как просмотренное', 'ok');
    openTab('moderation', { push: false });
  };
  $('#md-fix', v)?.addEventListener('click', async () => {
    if (!confirm(`${T('Проставить isPrivate: false записям без флага')}: ${broken.length}?`)) return;
    for (let i = 0; i < broken.length; i += 300) {
      const part = broken.slice(i, i + 300);
      if (!await logged('content.fixflags', `${broken.length}`, part.map((x) => x.id).join(','),
        (b) => part.forEach((x) => b.set(doc(db, 'custom_content', x.id), { isPrivate: false }, { merge: true })))) return;
    }
    toast('Готово', 'ok');
    openTab('moderation');
  });
  v.onclick = async (e) => {
    const find = (attr) => { const el = e.target.closest(`[${attr}]`); return el && items.find((i) => i.id === el.getAttribute(attr)); };
    let it;
    if ((it = find('data-view'))) return showJson(`${it.name} · ${it.creator}`, it.raw);
    if ((it = find('data-priv'))) {
      if (await logged('content.private', `${it.type}: ${it.name} (${it.id})`, { isPrivate: !it.priv, creator: it.email },
        (b) => b.update(doc(db, 'custom_content', it.id), { isPrivate: !it.priv }))) { it.priv = !it.priv; draw(); }
      return;
    }
    if ((it = find('data-del'))) {
      if (!confirm(`${T('Удалить запись')} «${it.name}» (${it.creator})? ${T('Копия попадёт в журнал.')}`)) return;
      if (await logged('content.delete', `${it.type}: ${it.name} (${it.id})`, JSON.stringify(it.raw, jsonReplacer),
        (b) => b.delete(doc(db, 'custom_content', it.id)), { ok: 'Запись удалена', failMsg: 'Не удалось удалить' })) {
        items.splice(items.indexOf(it), 1);
        draw();
      }
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
      if (!confirmName('Офис, все досье, контракты и казна будут удалены навсегда. Введите название офиса для подтверждения', o.name)) return;
      let n;
      try { await deleteCollection(['offices', o.id, 'sessions']); await deleteCollection(['offices', o.id, 'cards']); n = await deleteCollection(['offices', o.id, 'agents']); } catch (er) { return fail(er, 'Не удалось удалить офис'); }
      const { treasury, news, ...meta } = o;   // казну и сводки в журнал не тащим
      if (await logged('office.delete', `${o.name} (${o.id})`, JSON.stringify({ ...meta, agentsDeleted: n }, jsonReplacer),
        (b) => b.delete(doc(db, 'offices', o.id)), { ok: 'Офис удалён', failMsg: 'Не удалось удалить офис' })) openTab('hidden');
      return;
    }
    if ((s = pick('data-screen-del', scr))) {
      if (!confirmName('Ширма и все её объекты будут удалены навсегда. Введите название для подтверждения', s.name)) return;
      let items, secret;
      try {
        items = await deleteCollection(['custom_screens', s.id, 'items']);
        secret = await deleteCollection(['custom_screens', s.id, 'secret']);
      } catch (er) { return fail(er, 'Не удалось удалить ширму'); }
      const { graphData, ...meta } = s;   // старую карту целиком в журнал не тащим
      if (await logged('screen.delete', `${s.name} (${s.id})`, JSON.stringify({ ...meta, items, secret }, jsonReplacer),
        (b) => b.delete(doc(db, 'custom_screens', s.id)), { ok: 'Ширма удалена', failMsg: 'Не удалось удалить ширму' })) openTab('hidden');
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
  'office.delete': 'Офис удалён', 'screen.delete': 'Ширма удалена', 'audit.revert': 'Откат действия',
};
const AS = { docs: [], last: null, end: false, filter: '' };

/* Откат действия из журнала: по сохранённым прежним значениям. Сам откат тоже пишется в журнал (audit.revert).
   Права проверяют правила Firestore — откатить можно только то, что вам разрешено делать. */
const idFromTarget = (t) => /\(([^()]+)\)\s*$/.exec(String(t || ''))?.[1] || '';
const parseDetails = (a) => { try { return JSON.parse(a.details); } catch { return null; } };
/** Значение даты из журнала (JSON Timestamp: {seconds,…} или ISO-строка) → Timestamp. */
function tsFromJson(v) {
  if (v == null) return null;
  if (typeof v === 'object' && Number.isFinite(v.seconds)) return new Timestamp(v.seconds, v.nanoseconds || 0);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : Timestamp.fromDate(d);
}
const REVERT = {
  'role.grant': (a) => ({ text: 'Снять выданный доступ', fill: (b) => b.delete(doc(db, 'roles', idFromTarget(a.target))) }),
  'role.update': (a) => {
    const d = parseDetails(a);
    if (!d?.before) return null;
    return { text: `Вернуть прежний доступ: ${d.before.role}`, fill: (b) => b.set(doc(db, 'roles', idFromTarget(a.target)), roleDoc(a, d.before)) };
  },
  'role.remove': (a) => {
    const d = parseDetails(a);
    if (!d?.before?.role) return null;
    return { text: `Вернуть доступ: ${d.before.role}`, fill: (b) => b.set(doc(db, 'roles', idFromTarget(a.target)), roleDoc(a, d.before)) };
  },
  'ban.set': (a) => ({ text: 'Снять эту блокировку', fill: (b) => b.delete(doc(db, 'bans', idFromTarget(a.target))) }),
  'ban.remove': (a) => {
    const d = parseDetails(a);
    if (!d?.before) return null;
    const until = tsFromJson(d.before.until);
    if (until && until.toMillis() < Date.now()) return null;   // блокировка уже истекла бы
    return {
      text: 'Вернуть блокировку',
      fill: (b) => b.set(doc(db, 'bans', idFromTarget(a.target)), {
        nick: String(d.before.nick || '').slice(0, 40), reason: String(d.before.reason || '').slice(0, 500),
        until: until || null, by: S.user.uid, byNick: myNick().slice(0, 40), at: serverTimestamp(),
      }),
    };
  },
  'content.private': (a) => {
    const d = parseDetails(a);
    if (typeof d?.isPrivate !== 'boolean') return null;
    return { text: d.isPrivate ? 'Сделать запись снова публичной' : 'Сделать запись снова приватной',
      fill: (b) => b.update(doc(db, 'custom_content', idFromTarget(a.target)), { isPrivate: !d.isPrivate }) };
  },
  'content.delete': (a) => {
    const d = parseDetails(a);
    if (!d?.type || !d?.data || !d?.creatorEmail) return null;
    const restored = {
      type: d.type, data: d.data, isPrivate: d.isPrivate === true, creatorEmail: d.creatorEmail,
      updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : new Date().toISOString(),
      ...(d.creator ? { creator: String(d.creator).slice(0, 80) } : {}),
    };
    return { text: 'Восстановить удалённую запись', fill: (b) => b.set(doc(db, 'custom_content', idFromTarget(a.target)), restored) };
  },
};
function roleDoc(a, before) {
  return {
    role: before.role, perms: normalizePerms(before.perms || {}), nick: String(/^(.*)\s\([^()]+\)\s*$/.exec(a.target)?.[1] || '').trim().slice(0, 40),
    grantedBy: S.user.uid, grantedByNick: myNick().slice(0, 40), updatedAt: serverTimestamp(),
  };
}
async function revertAudit(d) {
  const a = d.data();
  const plan = REVERT[a.action]?.(a);
  if (!plan || !idFromTarget(a.target)) { toast('Это действие нельзя откатить автоматически — данных недостаточно', 'err'); return; }
  if (!confirm(`${T(plan.text)}?\n${T(ACTIONS[a.action] || a.action)} · ${a.target}\n${fmt(a.at)} · ${a.nick || a.uid}`)) return;
  const ok = await logged('audit.revert', `${a.action} · ${a.target}`, { of: d.id, action: a.action }, plan.fill,
    { ok: 'Откат выполнен', failMsg: 'Не удалось откатить' });
  if (ok) openTab('audit', { push: false });
}

function auditTable(docs) {
  return `<div class="table-wrap"><table><thead><tr><th>Когда</th><th>Кто</th><th>Действие</th><th>Объект</th><th></th></tr></thead><tbody>
    ${docs.map((d, i) => { const a = d.data(); return `<tr>
      <td class="small" title="${esc(fmt(a.at))}">${esc(fmt(a.at))}</td>
      <td class="notranslate">${esc(a.nick || a.uid)}</td>
      <td><span class="chip ${/delete|remove|reset|ban\.set/.test(a.action) ? 'red' : /canon/.test(a.action) ? 'cyan' : 'on'}">${esc(T(ACTIONS[a.action] || a.action))}</span></td>
      <td class="notranslate small ellipsis">${esc(a.target)}</td>
      <td><div class="row" style="flex-wrap:nowrap">${a.details ? `<button class="btn sm ghost" data-details="${i}" title="${esc(T('Подробности'))}"><i class="fa-solid fa-magnifying-glass"></i></button>` : ''}
        ${REVERT[a.action] ? `<button class="btn sm ghost" data-revert="${i}" title="${esc(T('Откатить это действие'))}"><i class="fa-solid fa-rotate-left"></i></button>` : ''}</div></td></tr>`; }).join('')}
  </tbody></table></div>`;
}
function bindAuditDetails(box, docs) {
  box.onclick = (e) => {
    const r = e.target.closest('[data-revert]');
    if (r) { revertAudit(docs[Number(r.dataset.revert)]); return; }
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
        ${[['canon', 'Канон'], ['role', 'Доступы'], ['ban', 'Блокировки'], ['content', 'Модерация'], ['office', 'Офисы'], ['screen', 'Ширмы'], ['audit', 'Откаты']]
          .map(([k, l]) => `<option value="${k}" ${AS.filter === k ? 'selected' : ''}>${esc(T(l))}</option>`).join('')}</select></div>
    <p class="muted small" style="margin-bottom:10px">Каждое действие в панели записывается сюда вместе с прежними значениями. Доступы, блокировки, видимость и удаление записей базы откатываются кнопкой <i class="fa-solid fa-rotate-left"></i>; правки канона — через «Сравнить» и «Из Assets» в разделе «Канон».</p>
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
