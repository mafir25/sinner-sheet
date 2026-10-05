# Mephistopheles Terminal (Project Moon 5e)

Статический сайт + Ширма (React, `shirm-app/`). Сборка: `npm ci && npm run build` → `dist/` (Vercel делает это сам).

## Структура

| Путь | Что это |
|---|---|
| `*.html` в корне | страницы сайта (копируются в `dist` как есть) |
| `shirm-app/` | новая Ширма, собирается Vite в `dist/shirm.html` |
| `Assets/Rus/*.json`, `Assets/Eng/*.json` | данные на русском и английском |
| `site/` | общий слой для всех страниц (см. ниже) |
| `firestore.rules` | **полные** правила Firestore — вставлять в консоль Firebase целиком |
| `vercel.json` | сборка и заголовки безопасности (CSP и др.) |

### `site/` — общий слой

- `firebase-config.js` — единственное место с конфигурацией Firebase (его же импортирует Ширма).
- `firebase.js` — инициализация Firebase для статических страниц (`app`, `auth`, `db`).
- `auth.js` — единая авторизация: вход, регистрация, выход, никнейм, проверка админа,
  **ограничение попыток: не больше 5 неудачных за 60 секунд** (`MAX_ATTEMPTS`, `WINDOW_MS`).
- `ui.js` — окно «Настройки» (кнопка ⚙ в левом нижнем углу каждой страницы): язык и аккаунт.
  Открыть из кода страницы: `window.SiteUI.open('login' | 'register' | 'account')`.
- `i18n.js` — язык (RU по умолчанию), загрузка данных и перевод интерфейса.
- `i18n-en.js` — английский словарь интерфейса.
- `vendor/` — закреплённые версии marked и DOMPurify (раньше грузились с CDN без версии).

### Новая страница

```html
<script src="site/i18n.js"></script>            <!-- в <head>, первым -->
<script type="module" src="site/ui.js"></script> <!-- окно настроек -->
```
Данные — только через `I18N.fetchData('feats.json')`: путь подбирается сам
(`Assets/<Eng|Rus>/feats.json` → `Assets/Rus/feats.json` → `feats.json`).
Вход — через `onAuth` из `site/auth.js`; своё окно входа на странице не нужно.

### Английский язык

- Данные: файл в `Assets/Eng/` с тем же именем, что в `Assets/Rus/`. Чего нет — показывается русская версия.
  Английская карта для Ширмы — `Assets/Eng/world.json`.
- Интерфейс: добавьте пару `'русская строка': 'English'` в `site/i18n-en.js`.
  Строки с числами/именами — через `patterns` в том же файле.

## Безопасность

- Любые данные из базы выводятся только экранированными (`esc`) или через DOMPurify.
- Права проверяет сервер (`firestore.rules`), а не интерфейс. После изменения правил их нужно
  опубликовать в Firebase Console → Firestore Database → Rules.
- Админы: документ `admins/<email>` в Firestore или запасной список в `site/auth.js` и `firestore.rules`.
