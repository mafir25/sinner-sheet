// Общее окно «Настройки» для всех страниц: язык интерфейса + аккаунт (вход / регистрация / профиль).
// Подключение: <script type="module" src="site/ui.js"></script> (после site/i18n.js).
// Страницы открывают его так: window.SiteUI.open('account') — или слушают вход через onAuth из site/auth.js.
import {
  onAuth, login, register, logout, setNickname, lockRemainingMs, attemptsLeft,
  MAX_ATTEMPTS, WINDOW_MS, MIN_PASSWORD, NICK_MAX,
} from './auth.js';

const I18N = window.I18N || { lang: 'ru', langs: { ru: { label: 'Русский' } }, setLang() {}, t: (s) => s };
const t = (s) => I18N.t(s);

const CSS = `
.su-fab{position:fixed;left:14px;bottom:14px;z-index:9000;width:40px;height:40px;border:1px solid #45B3CB;background:#000;color:#45B3CB;
  cursor:pointer;font:600 18px/1 'Oswald',sans-serif;display:flex;align-items:center;justify-content:center;opacity:.75;transition:.2s}
.su-fab:hover,.su-fab:focus-visible{opacity:1;box-shadow:0 0 12px rgba(69,179,203,.45)}
.su-fab .su-dot{position:absolute;top:-4px;right:-4px;width:9px;height:9px;border-radius:50%;background:#8FCC2A;display:none}
.su-fab.su-in .su-dot{display:block}
.su-ov{position:fixed;inset:0;z-index:9001;background:rgba(0,0,0,.75);display:none;align-items:center;justify-content:center;padding:16px}
.su-ov.su-open{display:flex}
.su-box{width:min(420px,100%);max-height:calc(100vh - 32px);overflow:auto;background:#070707;border:1px solid #45B3CB;color:#E0D8C8;
  font-family:'Inter',sans-serif;font-size:14px;box-shadow:0 10px 40px rgba(0,0,0,.8)}
.su-head{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid #222;
  font:500 18px 'Oswald',sans-serif;letter-spacing:1px;text-transform:uppercase;color:#45B3CB}
.su-x{background:none;border:1px solid #333;color:#aaa;width:30px;height:30px;cursor:pointer;font-size:16px}
.su-x:hover{color:#C7243A;border-color:#C7243A}
.su-sec{padding:14px 16px;border-bottom:1px solid #1a1a1a}
.su-sec:last-child{border-bottom:none}
.su-t{font:500 13px 'Oswald',sans-serif;letter-spacing:1px;text-transform:uppercase;color:#696969;margin-bottom:10px}
.su-row{display:flex;gap:8px}
.su-seg{flex:1;padding:8px;border:1px solid #333;background:#000;color:#aaa;cursor:pointer;font:500 14px 'Oswald',sans-serif;letter-spacing:1px}
.su-seg[aria-pressed=true]{border-color:#45B3CB;color:#45B3CB;background:rgba(69,179,203,.08)}
.su-in-f{width:100%;box-sizing:border-box;padding:9px 10px;margin-bottom:8px;background:#000;border:1px solid #333;color:#E0D8C8;font:14px 'Inter',sans-serif}
.su-in-f:focus{outline:none;border-color:#45B3CB}
.su-btn{width:100%;padding:9px;margin-bottom:8px;border:1px solid #45B3CB;background:#000;color:#45B3CB;cursor:pointer;
  font:500 14px 'Oswald',sans-serif;letter-spacing:1px;text-transform:uppercase}
.su-btn:hover:not(:disabled){background:rgba(69,179,203,.12)}
.su-btn:disabled{opacity:.45;cursor:not-allowed}
.su-btn.su-red{border-color:#C7243A;color:#C7243A}
.su-btn.su-red:hover{background:rgba(199,36,58,.12)}
.su-link{background:none;border:none;color:#696969;cursor:pointer;text-decoration:underline;font:13px 'Inter',sans-serif;padding:0}
.su-link:hover{color:#E0D8C8}
.su-msg{min-height:18px;font-size:13px;margin-bottom:8px;color:#696969}
.su-msg.su-err{color:#C7243A}.su-msg.su-ok{color:#8FCC2A}
.su-mail{color:#45B3CB;word-break:break-all;margin-bottom:10px}
.su-hint{color:#696969;font-size:12px;line-height:1.4;margin-top:4px}
`;

const html = String.raw;
let root, fab, view = 'login', state = { ready: false, user: null, isAdmin: false, nick: '' }, timer = null;

function el(tag, attrs = {}, text) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}

function mount() {
  if (root) return;
  const style = el('style'); style.textContent = CSS; document.head.appendChild(style);

  fab = el('button', { class: 'su-fab', type: 'button', title: t('Настройки'), 'aria-label': t('Настройки') });
  fab.innerHTML = '⚙<span class="su-dot"></span>';
  fab.addEventListener('click', () => open());
  if (document.documentElement.dataset.siteUi !== 'no-fab') document.body.appendChild(fab);

  root = el('div', { class: 'su-ov', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'su-title' });
  root.innerHTML = html`
    <div class="su-box">
      <div class="su-head"><span id="su-title">Настройки</span><button class="su-x" type="button" data-su="close" aria-label="Закрыть">✕</button></div>
      <div class="su-sec">
        <div class="su-t">Язык / Language</div>
        <div class="su-row" id="su-langs"></div>
      </div>
      <div class="su-sec" id="su-account"></div>
    </div>`;
  document.body.appendChild(root);

  const langs = root.querySelector('#su-langs');
  for (const [code, info] of Object.entries(I18N.langs)) {
    const b = el('button', { class: 'su-seg notranslate', type: 'button', 'data-lang': code, 'aria-pressed': String(code === I18N.lang) }, info.label);
    b.addEventListener('click', () => I18N.setLang(code));
    langs.appendChild(b);
  }

  root.addEventListener('click', (e) => {
    if (e.target === root || e.target.closest('[data-su="close"]')) close();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && root.classList.contains('su-open')) close(); });
  renderAccount();
}

function setMsg(text, kind = '') {
  const m = root.querySelector('.su-msg');
  if (!m) return;
  m.className = 'su-msg' + (kind ? ' su-' + kind : '');
  m.textContent = t(text);
}

function lockText() {
  const ms = lockRemainingMs();
  if (ms > 0) return `Слишком много попыток. Подождите ${Math.ceil(ms / 1000)} с`;
  const left = attemptsLeft();
  return left < MAX_ATTEMPTS ? `Осталось попыток: ${left} из ${MAX_ATTEMPTS} (в течение ${WINDOW_MS / 1000} с)` : '';
}

function tickLock() {
  clearInterval(timer);
  const upd = () => {
    const submit = root.querySelector('[data-su="submit"]');
    const ms = lockRemainingMs();
    if (!submit || ms === 0) {
      clearInterval(timer); timer = null;
      if (submit) { submit.disabled = false; setMsg(''); }
      return;
    }
    submit.disabled = true;
    setMsg(lockText(), 'err');
  };
  upd();
  timer = setInterval(upd, 1000);
}

function renderAccount() {
  const box = root.querySelector('#su-account');
  clearInterval(timer); timer = null;
  if (!state.ready) { box.innerHTML = `<div class="su-t">Аккаунт</div><div class="su-msg">Загрузка…</div>`; return; }

  if (state.user) {
    box.innerHTML = html`
      <div class="su-t">Аккаунт</div>
      <div class="su-mail notranslate"></div>
      <label class="su-t" for="su-nick" style="display:block;margin-bottom:6px">Никнейм</label>
      <input id="su-nick" class="su-in-f" maxlength="${NICK_MAX}" autocomplete="nickname">
      <div class="su-msg"></div>
      <button class="su-btn" type="button" data-su="nick">Сохранить никнейм</button>
      <button class="su-btn su-red" type="button" data-su="logout">Выйти</button>`;
    box.querySelector('.su-mail').textContent = state.user.email + (state.isAdmin ? ` · ${t('админ')}` : '');
    box.querySelector('#su-nick').value = state.nick;
    if (state.nickStatus === 'taken') setMsg('Этот никнейм уже занят другим аккаунтом — выберите другой, иначе вас не найдут по нику', 'err');
    else if (state.nickStatus === 'none') setMsg('Задайте никнейм — по нему вас добавляют в Офис', 'err');
    box.querySelector('[data-su="nick"]').onclick = async () => {
      try { await setNickname(box.querySelector('#su-nick').value); setMsg('Никнейм сохранён', 'ok'); }
      catch (e) { setMsg(e.message || 'Не удалось сохранить никнейм', 'err'); }
    };
    box.querySelector('[data-su="logout"]').onclick = async () => { await logout(); close(); };
    return;
  }

  const reg = view === 'register';
  box.innerHTML = html`
    <div class="su-t">${reg ? 'Регистрация' : 'Вход в аккаунт'}</div>
    <form novalidate>
      <input class="su-in-f" type="email" name="email" placeholder="Email" autocomplete="username" required>
      <input class="su-in-f" type="password" name="pass" placeholder="Пароль" autocomplete="${reg ? 'new-password' : 'current-password'}" required>
      ${reg ? '<input class="su-in-f" type="password" name="pass2" placeholder="Повторите пароль" autocomplete="new-password" required>' : ''}
      <div class="su-msg" aria-live="polite"></div>
      <button class="su-btn" type="submit" data-su="submit">${reg ? 'Зарегистрироваться' : 'Войти'}</button>
    </form>
    <button class="su-link" type="button" data-su="switch">${reg ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Регистрация'}</button>
    ${reg ? `<div class="su-hint">Пароль — не короче ${MIN_PASSWORD} символов. Восстановления пароля по почте пока нет, поэтому запомните его.</div>` : ''}`;

  const form = box.querySelector('form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[data-su="submit"]');
    btn.disabled = true;
    setMsg(reg ? 'Регистрация…' : 'Вход…');
    try {
      if (reg) await register(form.email.value, form.pass.value, form.pass2.value);
      else await login(form.email.value, form.pass.value);
      form.pass.value = '';
      close();
    } catch (err) {
      form.pass.value = '';
      if (form.pass2) form.pass2.value = '';
      setMsg(err.message, 'err');
      const extra = lockText();
      if (extra && lockRemainingMs() === 0) {
        const m = root.querySelector('.su-msg');
        m.textContent += ' · ' + t(extra);
      }
    } finally {
      btn.disabled = lockRemainingMs() > 0;
      if (lockRemainingMs() > 0) tickLock();
    }
  };
  box.querySelector('[data-su="switch"]').onclick = () => { view = reg ? 'login' : 'register'; renderAccount(); };
  if (lockRemainingMs() > 0) tickLock();
}

export function open(section) {
  mount();
  if (section === 'register') view = 'register';
  else if (section === 'login') view = 'login';
  renderAccount();
  root.classList.add('su-open');
  const focus = root.querySelector(state.user ? '#su-nick' : 'input[name=email]') || root.querySelector('.su-x');
  setTimeout(() => focus?.focus(), 0);
}
export function close() {
  if (!root) return;
  root.classList.remove('su-open');
  clearInterval(timer); timer = null;
}

onAuth((s) => {
  state = s;
  if (fab) fab.classList.toggle('su-in', !!s.user);
  if (root) renderAccount();
});

window.SiteUI = { open, close, openAccount: () => open('account') };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
else mount();
