# Лор-Ширма v2

Новая версия страницы `shirm.html`: React + Vite, собственная доска на d3-zoom.

## Как устроена сборка
- `npm run build` собирает Ширму в `dist/shirm.html`, а `scripts/copy-static.mjs` копирует
  остальные страницы, `site/` и `Assets/` в `dist/`. Vercel публикует `dist/` (см. `vercel.json`).
- Старый адрес `shirm-legacy.html` перенаправляется на `shirm.html` (`redirects` в `vercel.json`).

## Папки
- `src/model` — формат данных (zod), перевод старых ширм (`migrate.ts`), markdown, поиск.
- `src/data` — Firebase и работа с Firestore.
- `src/state/boardStore.ts` — состояние доски, отмена/повтор, автосохранение.
- `src/board` — доска, миникарта. `src/ui` — панели, редакторы, окна.

## Данные в Firestore
- `custom_screens/{id}` — название и доступы, `schemaVersion: 2`.
- `custom_screens/{id}/items/{itemId}` — узлы, рамки, связи.
- `custom_screens/{id}/secret/{itemId}` — скрытые объекты, читают только админы ширмы.
- `gm_notes/{uid}` — личные заметки (`text`) и инструменты мастера (`tools`: трекер инициативы, журнал бросков);
  пишутся с `merge`, чтобы не затирать друг друга.

## Инструменты мастера и показ
- «🎲 Мастер» (`src/ui/GmTools.tsx`): кубики (`src/model/dice.ts` — `2d6+3`, `4d6kh3`, `2d20kh1`/`kl1`, `d%`;
  тесты — `tests/unit/dice.test.mjs`) и трекер инициативы (раунды, ход, хиты, статусы; пустая инициатива — бросок d20,
  «+2» — d20+2). Сохраняется в `gm_notes/{uid}.tools`, виден с любого устройства.
- «▣ Показ» — доска на весь экран без панелей (для экрана игроков); Esc — выход.

Старые ширмы переводятся в новый формат автоматически, когда их открывает админ;
копия старых данных лежит в `secret/__legacy_backup`.

Правила доступа — в `../firestore.rules` (их нужно вставить в Firebase Console).
