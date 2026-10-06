// Единая система авторизации сайта.
// Все страницы входят, регистрируются и выходят только через этот модуль,
// а окно входа рисует site/ui.js. Состояние входа общее для всех страниц (Firebase хранит его в IndexedDB).
import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, updateProfile,
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';
import { doc, getDoc, runTransaction } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';
import { auth, db } from './firebase.js';

/* ---------------- Ограничение попыток ввода пароля ----------------
   Не больше MAX_ATTEMPTS неудачных попыток входа/регистрации за WINDOW_MS в этом браузере.
   Это защита от перебора с клиента и от случайного спама кнопкой; на сервере Firebase
   дополнительно сам блокирует подозрительную активность (ошибка auth/too-many-requests). */
export const MAX_ATTEMPTS = 5;
export const WINDOW_MS = 60_000;
const LS_ATTEMPTS = 'auth.failedAttempts';

function readAttempts() {
  try {
    const list = JSON.parse(localStorage.getItem(LS_ATTEMPTS) || '[]');
    const now = Date.now();
    return Array.isArray(list) ? list.filter((t) => typeof t === 'number' && now - t < WINDOW_MS && t <= now) : [];
  } catch { return []; }
}
function writeAttempts(list) {
  try { localStorage.setItem(LS_ATTEMPTS, JSON.stringify(list)); } catch { /* приватный режим */ }
}
// localStorage можно очистить, поэтому дублируем счётчик в памяти вкладки
let memAttempts = [];
function allAttempts() {
  const now = Date.now();
  memAttempts = memAttempts.filter((t) => now - t < WINDOW_MS);
  const ls = readAttempts();
  return ls.length >= memAttempts.length ? ls : memAttempts;
}
function recordFailure() {
  const list = [...allAttempts(), Date.now()];
  memAttempts = list;
  writeAttempts(list);
}

/** Сколько миллисекунд ещё ждать до следующей попытки (0 — можно пробовать). */
export function lockRemainingMs() {
  const list = allAttempts();
  if (list.length < MAX_ATTEMPTS) return 0;
  const oldest = Math.min(...list.slice(-MAX_ATTEMPTS));
  return Math.max(0, oldest + WINDOW_MS - Date.now());
}
export function attemptsLeft() { return Math.max(0, MAX_ATTEMPTS - allAttempts().length); }

/* ---------------- Ошибки ---------------- */
export class AuthError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}
const MESSAGES = {
  'auth/invalid-email': 'Некорректный email',
  'auth/missing-password': 'Введите пароль',
  'auth/invalid-credential': 'Неверный email или пароль',
  'auth/wrong-password': 'Неверный email или пароль',
  'auth/user-not-found': 'Неверный email или пароль',
  'auth/user-disabled': 'Аккаунт заблокирован',
  'auth/email-already-in-use': 'Этот email уже зарегистрирован',
  'auth/weak-password': 'Слишком простой пароль',
  'auth/password-does-not-meet-requirements': 'Пароль не соответствует требованиям',
  'auth/too-many-requests': 'Слишком много попыток. Сервер временно заблокировал вход, попробуйте позже',
  'auth/network-request-failed': 'Нет соединения с сервером',
  'auth/operation-not-allowed': 'Этот способ входа отключён',
};
const message = (e) => MESSAGES[e?.code] || 'Не удалось выполнить операцию';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD = 8;

function guard() {
  const ms = lockRemainingMs();
  if (ms > 0) throw new AuthError(`Слишком много попыток. Подождите ${Math.ceil(ms / 1000)} с`, 'local/rate-limited');
}

async function attempt(fn, isCredentialError) {
  guard();
  try {
    const res = await fn();
    memAttempts = []; writeAttempts([]);
    return res;
  } catch (e) {
    if (isCredentialError(e)) recordFailure();
    throw new AuthError(message(e), e?.code);
  }
}

// Ошибки сети не должны съедать попытки
const notNetwork = (e) => e?.code !== 'auth/network-request-failed';

export async function login(email, password) {
  email = String(email || '').trim();
  if (!EMAIL_RE.test(email)) throw new AuthError(MESSAGES['auth/invalid-email'], 'auth/invalid-email');
  if (!password) throw new AuthError(MESSAGES['auth/missing-password'], 'auth/missing-password');
  return attempt(() => signInWithEmailAndPassword(auth, email, password), notNetwork);
}

export async function register(email, password, password2) {
  email = String(email || '').trim();
  if (!EMAIL_RE.test(email)) throw new AuthError(MESSAGES['auth/invalid-email'], 'auth/invalid-email');
  if (String(password || '').length < MIN_PASSWORD) {
    throw new AuthError(`Пароль должен быть не короче ${MIN_PASSWORD} символов`, 'auth/weak-password');
  }
  if (password2 !== undefined && password !== password2) throw new AuthError('Пароли не совпадают', 'local/mismatch');
  return attempt(() => createUserWithEmailAndPassword(auth, email, password), notNetwork);
}

export const logout = () => signOut(auth);

/* ---------------- Никнейм ---------------- */
const LS_NICK = 'custom_nickname'; // ключ остался от старых страниц — чтобы ники не потерялись
export const NICK_MAX = 40;

export function nicknameOf(user) {
  if (!user) return '';
  let local = '';
  try { local = localStorage.getItem(LS_NICK) || ''; } catch { /* ignore */ }
  return user.displayName || local || (user.email || '').split('@')[0];
}

/* Реестр ников в Firestore — по нику другие находят аккаунт (например, чтобы пустить в Офис).
   nicknames/<nickId> = { uid, nick } — один документ на ник, поэтому ник уникален (без учёта регистра);
   users/<uid> = { nick, nickId } — текущий ник аккаунта. Оба пишутся одной транзакцией,
   а firestore.rules не дают держать больше одного ника и занять чужой. */
const cleanNick = (nick) => String(nick || '').replace(/\s+/g, ' ').trim().slice(0, NICK_MAX);
export const nickId = (nick) => 'n_' + encodeURIComponent(cleanNick(nick).toLowerCase());

async function claimNickname(user, nick) {
  const id = nickId(nick);
  const userRef = doc(db, 'users', user.uid);
  await runTransaction(db, async (tx) => {
    const taken = await tx.get(doc(db, 'nicknames', id));
    if (taken.exists() && taken.data().uid !== user.uid) {
      throw new AuthError('Этот никнейм уже занят', 'local/nick-taken');
    }
    const me = await tx.get(userRef);
    const old = me.exists() ? me.data().nickId : null;
    if (old && old !== id) tx.delete(doc(db, 'nicknames', old));
    tx.set(doc(db, 'nicknames', id), { uid: user.uid, nick });
    tx.set(userRef, { nick, nickId: id });
  });
}

export async function setNickname(nick) {
  const user = auth.currentUser;
  nick = cleanNick(nick);
  if (!user) throw new AuthError('Вы не вошли в аккаунт', 'local/no-user');
  if (!nick) throw new AuthError('Никнейм не может быть пустым', 'local/empty');
  await claimNickname(user, nick);
  await updateProfile(user, { displayName: nick });
  try { localStorage.setItem(LS_NICK, nick); } catch { /* ignore */ }
  emit();
  return nick;
}

/** Найти аккаунт по нику: { uid, nick } или null. */
export async function findUserByNick(nick) {
  if (!cleanNick(nick)) return null;
  const snap = await getDoc(doc(db, 'nicknames', nickId(nick)));
  return snap.exists() ? { uid: snap.data().uid, nick: snap.data().nick } : null;
}

/** Текущие ники аккаунтов: Map uid → nick (кого нет в реестре — того нет и в ответе). */
export async function nicknamesOf(uids) {
  const out = new Map();
  await Promise.all([...new Set(uids)].map(async (uid) => {
    try {
      const snap = await getDoc(doc(db, 'users', uid));
      if (snap.exists() && snap.data().nick) out.set(uid, snap.data().nick);
    } catch { /* нет доступа или сети — покажем сохранённое имя */ }
  }));
  return out;
}

/** Состояние ника в реестре: 'ok' | 'none' (ник не задан) | 'taken' (занят другим — нужно сменить) | 'error'. */
let registry = { uid: null, status: null };
export const nickRegistryStatus = () => (registry.uid === auth.currentUser?.uid ? registry.status : null);

// Ники, заданные до появления реестра, регистрируем при входе (один раз за вкладку).
async function ensureRegistered(user) {
  if (registry.uid === user.uid && registry.status) return;
  registry = { uid: user.uid, status: null };
  // Ник «по умолчанию» (начало email) в общий реестр не отдаём — человек задаст свой в настройках.
  let local = '';
  try { local = localStorage.getItem(LS_NICK) || ''; } catch { /* ignore */ }
  const nick = cleanNick(user.displayName || local);
  if (!nick) { registry.status = 'none'; emit(); return; }
  let status = 'error';
  try {
    const me = await getDoc(doc(db, 'users', user.uid));
    if (me.exists() && me.data().nickId === nickId(nick)) status = 'ok';
    else { await claimNickname(user, nick); status = 'ok'; }
  } catch (e) {
    status = e?.code === 'local/nick-taken' ? 'taken' : 'error';
    if (status === 'error') console.warn('Реестр ников недоступен', e);
  }
  if (registry.uid === user.uid) { registry.status = status; emit(); }
}

/* ---------------- Администраторы ----------------
   Права админа: документ admins/<email> в Firestore (его читает только сам пользователь).
   BOOTSTRAP_ADMINS — запасной список на случай, если документы ещё не созданы.
   Он же продублирован в firestore.rules: реальные права проверяет сервер, здесь — только интерфейс. */
const BOOTSTRAP_ADMINS = ['nikkitamatveev2009@gmail.com', 'pavlovichpavel03@gmail.com'];
const adminCache = new Map();

export async function isAdmin(user = auth.currentUser) {
  if (!user?.email) return false;
  if (adminCache.has(user.uid)) return adminCache.get(user.uid);
  let ok = BOOTSTRAP_ADMINS.includes(user.email.toLowerCase());
  if (!ok) {
    try { ok = (await getDoc(doc(db, 'admins', user.email))).exists(); } catch { ok = false; }
  }
  adminCache.set(user.uid, ok);
  return ok;
}

/* ---------------- Подписка на состояние ---------------- */
const listeners = new Set();
let state = { ready: false, user: null, isAdmin: false, nick: '', nickStatus: null };

function emit() {
  state = { ...state, nick: nicknameOf(state.user), nickStatus: nickRegistryStatus() };
  for (const cb of listeners) { try { cb(state); } catch (e) { console.error(e); } }
}

onAuthStateChanged(auth, async (user) => {
  const admin = user ? await isAdmin(user) : false;
  if (auth.currentUser?.uid !== user?.uid) return; // за время проверки пользователь сменился
  state = { ready: true, user: user || null, isAdmin: admin, nick: nicknameOf(user), nickStatus: null };
  emit();
  if (user) ensureRegistered(user);
});

/** Подписка на вход/выход. cb({ ready, user, isAdmin, nick, nickStatus }). Возвращает функцию отписки. */
export function onAuth(cb) {
  listeners.add(cb);
  if (state.ready) cb(state);
  return () => listeners.delete(cb);
}
export const authState = () => state;
export { auth };

