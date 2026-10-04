# Лор-Ширма v2

Новая версия страницы `shirm.html`: React + Vite, собственная доска на d3-zoom.

## Как устроена сборка
- `npm run build` собирает Ширму в `dist/shirm.html`, а `scripts/copy-static.mjs` копирует
  все остальные страницы и json из корня репозитория в `dist/`. Vercel публикует `dist/` (см. `vercel.json`).
- Старая Ширма сохранена как `shirm-legacy.html`.

## Папки
- `src/model` — формат данных (zod), перевод старых ширм (`migrate.ts`), markdown, поиск.
- `src/data` — Firebase и работа с Firestore.
- `src/state/boardStore.ts` — состояние доски, отмена/повтор, автосохранение.
- `src/board` — доска, миникарта. `src/ui` — панели, редакторы, окна.

## Данные в Firestore
- `custom_screens/{id}` — название и доступы, `schemaVersion: 2`.
- `custom_screens/{id}/items/{itemId}` — узлы, рамки, связи.
- `custom_screens/{id}/secret/{itemId}` — скрытые объекты, читают только админы ширмы.
- `gm_notes/{uid}` — личные заметки.

Старые ширмы переводятся в новый формат автоматически, когда их открывает админ;
копия старых данных лежит в `secret/__legacy_backup`.

Правила доступа — в `../firestore.rules` (их нужно вставить в Firebase Console).
