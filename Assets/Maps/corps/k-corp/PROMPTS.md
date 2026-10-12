# K Corp — промпты для доработки текстур

Текущие картинки — временные процедурные заготовки: верные размеры, тайлинг и палитра, но без деталей.
Отправляйте нейросети **заготовку + скриншот-референс + промпт**. Результат кладите поверх с тем же именем
и размером, затем `npm run gen:maps`.

## Общий стиль (добавлять к каждому промпту)
> Style: Limbus Company / Project Moon background art, K Corp headquarters. Painted anime background, clean
> sci-fi corporate interior. Palette: near-black green (#070d0b, #13201b), dark slate-green panels (#1d2b26),
> pale mint-grey polished stone (#cdd9d3, #eef4f0), glowing lime neon accents (#8dff3c) and teal neon (#2fe39a).
> Calm surfaces — no haze, no light streaks, no lens glare. Neon only as continuous lines. Sharp clean edges, no text, no people.
> Keep the exact canvas size and composition of the attached placeholder.

## Полы (вид строго сверху, бесшовные 256×256)
- `floors/hall.png` — *Seamless top-down texture of a polished pale mint-grey stone floor, large square slabs
  (2×2 per tile), thin dark seams, faint glossy reflections. Must tile seamlessly on all edges.*
- `floors/work.png` — *Seamless top-down texture of dark glossy slate-green floor tiles, 4×4 grid, black seams,
  subtle sheen.*
- `floors/service.png` — *Seamless top-down texture of dark perforated metal floor plates, 2×2 grid, with a thin lime
  neon line along the outer tile edges (forms a continuous grid when tiled).*
- `floors/runner.png` — *Seamless top-down texture of a deep emerald-green glossy floor runner, smooth with soft
  vertical reflections.*

## Правило тайлинга (стены, полы, кровля)
- **Можно:** сплошные линии во всю длину (неоновый карниз, кант, плинтус), панели и сетка с равным шагом.
- **Нельзя:** одиночные элементы на тайле (полоска, лампа, решётка, логотип, пятно) — при повторе они встают
  через равные промежутки, выглядят обрывами и сдвигают визуальный центр. Такое — отдельными объектами.

## Стены (лицевая сторона, 256×256; повтор ТОЛЬКО по горизонтали, картинка целиком = высота грани)
Можно: сплошные горизонтальные линии (неон, карниз, плинтус), панели, сетка. Нельзя: одиночные элементы
(вертикальная неоновая полоса, лампа, табличка) — при повторе они встанут через каждую клетку.
- `walls/exterior.png` — *Front view of a dark slate-green wall made of tall panels (seam every 128 px), black
  cornice band at the top with one continuous glowing lime neon line right under it, black plinth at the bottom.
  No isolated details: everything must be continuous horizontally. Left and right edges must tile seamlessly.*
- `walls/interior.png` — *Front view of a light mint-grey corporate wall, tall panels (seam every 128 px), one
  continuous thin teal neon line above a dark slate plinth. No isolated details. Tiles horizontally.*
- `walls/glass.png` — *Front view of a glass curtain wall: dark frame top and sides with a thin teal line on the
  mullion, dark base strip with a continuous teal trim, pale blue-grey semi-transparent glass. Keep PNG alpha.*

## Двери и окна (вид спереди)
Картинка целиком растягивается **в вырез** проёма; перемычку и подоконник вокруг рисует сама стена.
Поэтому никаких полос стены сверху/снизу: рамка — по краю картинки, цвета створок — как у стены
(`door` — под `exterior`, `door-light` — под `interior`).
- `doors/door.png` / `doors/door-light.png` 256×256 — *Front view of a closed sliding double door filling the
  whole canvas: thin dark frame with a glowing lime neon line along the top and both sides, two leaves in the same
  color as the wall (dark slate-green / light mint-grey), small handles at the center seam, small lime card-reader
  light on the right. Nothing above the door.*
- `doors/gate.png` 512×256 — *Front view of a wide closed elevator door filling the canvas: lime neon frame on the
  top and sides, two frosted-glass leaves with soft pale-green light from inside. Nothing above the door.*
- `windows/window.png` 256×256, `windows/window-wide.png` 512×256 — *Front view of a window filling the whole
  canvas: thin dark frame, mullion every 128 px, continuous teal neon line along the sill, pale hazy sky-blue
  glass with a very faint reflection. Keep glass semi-transparent.*

## Кровля (вид сверху, бесшовная 256×256)
- `roofs/roof.png` — *Seamless top-down texture of a dark corporate rooftop: slate-green panels in a 2×2 grid, subtle wear. No vents,
  lights or other isolated details (those are separate objects).*

## Вывески (`signs/`, SVG — можно оставить как есть или заменить PNG тех же размеров)
- `sign` 512×256, `emblem` 256×256, `floor-logo` 768×768 — логотип K: тёмная вертикальная стойка в белом
  контуре, верхняя диагональ лайм + белая полоса, нижняя диагональ тёмная в белом контуре.

## Мебель (`objects/`, «три четверти», 4 ракурса)
Проекция как у объёмных стен: вид сверху под углом — виден верх предмета и его передняя грань, без перспективы.
Файлы `<имя>-s|-n|-e|-w.png` — лицом вниз / вверх / вправо / влево. **Отправлять все 4 ракурса одного предмета
вместе** и просить сохранить размер холста, положение на нём и прозрачный фон.
> Redraw these four views of the same object as clean painted game sprites in a 3/4 top-down (oblique) view: top
> surface plus the front face, no perspective. Keep each canvas size, the object's position and footprint, and the
> transparent background. All four views must show the same object consistently rotated (front facing down / up /
> right / left). Brutalist K Corp style: massive simple slabs, matte dark slate-green and pale mint-grey, thin lime
> neon accents only as lines.

- `hp-crate` — open crate of HP ampoules: round glass vials with glowing green liquid and white caps, even 4×3 grid.
- `lab-table` — lab bench: dark top, pale body, lime neon line, a rack of round test tubes, a small terminal.
- `reception` — reception desk: black body, white top slab, lime neon line along the front, two monitors.
- `lockers` — tall locker cabinet with five pale drawers and small lime indicator lights (stands against a wall).
- `turnstile` — two security posts with lime card readers and glass gates between them.
- `sofa`, `armchair`, `coffee-table` — lounge furniture: olive-yellow upholstery, low dark table with a glass top.
