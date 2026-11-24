// site/comments.js
// Единая система комментариев для общественных мест сайта:
// - Navigation (карточки базы знаний)
// - Office (контракты на доске и сессии в журнале)
// - Shirm (узлы ширмы и нефизические ноды)
// Хранение: Firestore (коллекция 'comments') с fallback в localStorage для оффлайна/локальной работы.

import {
  collection, doc, setDoc, deleteDoc, query, where, onSnapshot, getDocs,
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';
import { db } from './firebase.js';
import { onAuth, isCoder, canAudit } from './auth.js';

const COLL = 'comments';
const LS_VIS = 'site.comments.visible';
const LS_CACHE = 'site.comments.cache';

// ----------------------------------------------------------------
// 1. ВИДИМОСТЬ КОММЕНТАРИЕВ
// ----------------------------------------------------------------

export function getCommentsVisible() {
  try {
    return localStorage.getItem(LS_VIS) !== '0';
  } catch {
    return true;
  }
}

export function setCommentsVisible(visible) {
  const v = !!visible;
  try {
    localStorage.setItem(LS_VIS, v ? '1' : '0');
  } catch { /* приватный режим */ }
  applyVisibilityToDoc(v);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('site:comments-visibility', { detail: { visible: v } }));
  }
}

export function onCommentsVisibilityChange(cb) {
  if (typeof window === 'undefined') return () => {};
  const handler = (e) => cb(e.detail?.visible ?? getCommentsVisible());
  window.addEventListener('site:comments-visibility', handler);
  return () => window.removeEventListener('site:comments-visibility', handler);
}

function applyVisibilityToDoc(v) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.hideComments = (!v).toString();
  if (!v) document.documentElement.classList.add('hide-comments');
  else document.documentElement.classList.remove('hide-comments');
}

// Инициализируем при загрузке модуля
applyVisibilityToDoc(getCommentsVisible());

// ----------------------------------------------------------------
// 2. ЛОКАЛЬНЫЙ КЭШ (FALLBACK / OFFLINE)
// ----------------------------------------------------------------

function getLocalCache() {
  try {
    return JSON.parse(localStorage.getItem(LS_CACHE) || '{}');
  } catch {
    return {};
  }
}

function saveLocalCache(cache) {
  try {
    localStorage.setItem(LS_CACHE, JSON.stringify(cache));
  } catch { /* игнор */ }
}

function cacheAdd(c) {
  const cache = getLocalCache();
  if (!cache[c.targetId]) cache[c.targetId] = [];
  cache[c.targetId] = cache[c.targetId].filter((x) => x.id !== c.id);
  cache[c.targetId].push(c);
  saveLocalCache(cache);
}

function cacheRemove(id) {
  const cache = getLocalCache();
  for (const tid of Object.keys(cache)) {
    cache[tid] = cache[tid].filter((x) => x.id !== id);
  }
  saveLocalCache(cache);
}

// ----------------------------------------------------------------
// 3. ПОЛЬЗОВАТЕЛЬСКОЕ СОСТОЯНИЕ
// ----------------------------------------------------------------

let authState = { ready: false, user: null, nick: '', role: null, isStaff: false };
onAuth((s) => {
  authState = s;
});

export function getCurrentUser() {
  return authState.user;
}

export function getCurrentNick() {
  return authState.nick || (authState.user?.email ? authState.user.email.split('@')[0] : '');
}

// ----------------------------------------------------------------
// 4. ОПЕРАЦИИ С FIRESTORE
// ----------------------------------------------------------------

/**
 * Подписка на комментарии к объекту (realtime).
 * targetId — идентификатор поста/карточки/сессии/узла.
 */
export function subscribeComments(targetId, onData, onError) {
  if (!targetId) {
    onData([]);
    return () => {};
  }

  let unsubFirestore = null;
  let active = true;

  const emit = (list) => {
    if (!active) return;
    const sorted = [...list].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    onData(sorted);
  };

  try {
    const q = query(collection(db, COLL), where('targetId', '==', String(targetId)));
    unsubFirestore = onSnapshot(
      q,
      (snap) => {
        const list = [];
        snap.forEach((d) => {
          list.push({ id: d.id, ...d.data() });
        });
        emit(list);
      },
      (err) => {
        console.warn('Comments Firestore subscription fallback:', err);
        const cache = getLocalCache()[targetId] || [];
        emit(cache);
        if (onError) onError(err);
      }
    );
  } catch (err) {
    console.warn('Comments Firestore query error, using cache:', err);
    const cache = getLocalCache()[targetId] || [];
    emit(cache);
    if (onError) onError(err);
  }

  return () => {
    active = false;
    if (unsubFirestore) unsubFirestore();
  };
}

/**
 * Добавить комментарий к объекту
 */
export async function addComment({ targetId, page = 'navigation', text, extra = {} }) {
  const u = authState.user;
  if (!u) {
    throw new Error('Для добавления комментария необходимо войти в аккаунт');
  }
  const cleanText = String(text || '').trim().slice(0, 5000);
  if (!cleanText) {
    throw new Error('Комментарий не может быть пустым');
  }

  const commentId = 'cm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  const data = {
    targetId: String(targetId),
    page: String(page),
    authorUid: u.uid,
    authorNick: getCurrentNick() || u.email.split('@')[0],
    authorEmail: u.email || '',
    text: cleanText,
    createdAt: Date.now(),
    ...extra,
  };

  // Пишем в кэш
  cacheAdd({ id: commentId, ...data });

  // Пишем в Firestore
  try {
    const ref = doc(db, COLL, commentId);
    await setDoc(ref, data);
  } catch (e) {
    console.warn('Не удалось сохранить комментарий в Firestore (сохранено локально):', e);
  }

  return { id: commentId, ...data };
}

/**
 * Удалить комментарий
 */
export async function deleteComment(commentId) {
  cacheRemove(commentId);
  try {
    const ref = doc(db, COLL, commentId);
    await deleteDoc(ref);
  } catch (e) {
    console.warn('Не удалось удалить комментарий из Firestore:', e);
  }
}

// ----------------------------------------------------------------
// 5. UI КОМПОНЕНТ КОММЕНТАРИЕВ (ВСТРАИВАЕМЫЙ)
// ----------------------------------------------------------------

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ESC_MAP[c]);
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const lang = window.I18N?.lang === 'en' ? 'en-US' : 'ru-RU';
  return d.toLocaleString(lang, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Монтирует полноценный блок комментариев в DOM-элемент containerEl.
 * Возвращает функцию unmount().
 */
export function mountCommentsWidget(containerEl, targetId, page = 'navigation', opts = {}) {
  if (!containerEl) return () => {};

  containerEl.classList.add('comments-container');
  containerEl.innerHTML = `
    <div class="comments-head">
      <span class="comments-title"><i class="fa-regular fa-comments"></i> Комментарии</span>
      <span class="comments-count-badge">0</span>
    </div>
    <div class="comments-list"><div class="comments-loading">Загрузка комментариев…</div></div>
    <div class="comments-form-wrap"></div>
  `;

  const countBadge = containerEl.querySelector('.comments-count-badge');
  const listEl = containerEl.querySelector('.comments-list');
  const formWrap = containerEl.querySelector('.comments-form-wrap');

  function renderForm() {
    if (!authState.user) {
      formWrap.innerHTML = `
        <div class="comments-login-prompt">
          <button type="button" class="comments-login-btn" data-su-account="">Войти</button>, чтобы оставить комментарий
        </div>`;
      const btn = formWrap.querySelector('.comments-login-btn');
      btn?.addEventListener('click', () => {
        window.SiteUI?.open('login');
      });
      return;
    }

    formWrap.innerHTML = `
      <form class="comments-form" novalidate>
        <div class="comments-form-author">Вы: <strong>${esc(getCurrentNick())}</strong></div>
        <textarea class="comments-textarea" placeholder="Написать комментарий..." rows="2" maxlength="3000" required></textarea>
        <div class="comments-form-actions">
          <div class="comments-form-msg"></div>
          <button type="submit" class="comments-submit-btn"><i class="fa-solid fa-paper-plane"></i> Отправить</button>
        </div>
      </form>`;

    const form = formWrap.querySelector('.comments-form');
    const ta = form.querySelector('.comments-textarea');
    const msg = form.querySelector('.comments-form-msg');
    const submitBtn = form.querySelector('.comments-submit-btn');

    form.onsubmit = async (e) => {
      e.preventDefault();
      const text = ta.value.trim();
      if (!text) return;
      submitBtn.disabled = true;
      msg.textContent = 'Отправка…';
      try {
        await addComment({ targetId, page, text });
        ta.value = '';
        msg.textContent = '';
      } catch (err) {
        msg.textContent = err.message || 'Ошибка отправки';
        msg.classList.add('error');
      } finally {
        submitBtn.disabled = false;
      }
    };
  }

  function renderComments(comments) {
    countBadge.textContent = String(comments.length);
    if (opts.onCountChange) opts.onCountChange(comments.length);

    if (!comments.length) {
      listEl.innerHTML = `<div class="comments-empty">Комментариев пока нет. Будьте первым!</div>`;
      return;
    }

    const curUid = authState.user?.uid;
    const isStaff = isCoder(authState) || canAudit(authState);

    listEl.innerHTML = comments
      .map((c) => {
        const canDelete = curUid && (c.authorUid === curUid || isStaff);
        const safeText = esc(c.text).replace(/\n/g, '<br>');
        return `
          <div class="comment-item" id="comment-${esc(c.id)}">
            <div class="comment-header">
              <span class="comment-author notranslate"><i class="fa-solid fa-user-circle"></i> ${esc(c.authorNick || c.authorEmail || 'Пользователь')}</span>
              <span class="comment-date">${esc(formatDate(c.createdAt))}</span>
              ${canDelete ? `<button type="button" class="comment-del-btn" data-del-id="${esc(c.id)}" title="Удалить комментарий">✕</button>` : ''}
            </div>
            <div class="comment-text">${safeText}</div>
          </div>`;
      })
      .join('');

    listEl.querySelectorAll('[data-del-id]').forEach((b) => {
      b.onclick = async () => {
        const id = b.dataset.delId;
        if (!id) return;
        if (confirm('Удалить этот комментарий?')) {
          b.disabled = true;
          await deleteComment(id);
        }
      };
    });
  }

  renderForm();
  const unsubAuth = onAuth(() => renderForm());
  const unsubSnap = subscribeComments(targetId, renderComments);

  return () => {
    unsubAuth();
    unsubSnap();
  };
}

// Регистрируем в глобальной области видимости для легкого вызова
if (typeof window !== 'undefined') {
  window.SiteComments = {
    getCommentsVisible,
    setCommentsVisible,
    onCommentsVisibilityChange,
    subscribeComments,
    addComment,
    deleteComment,
    mountCommentsWidget,
  };
}
