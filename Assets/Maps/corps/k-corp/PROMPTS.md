# K Corp — промпты для доработки текстур

Текущие картинки — временные процедурные заготовки: верные размеры, тайлинг и палитра, но без деталей.
Отправляйте нейросети **заготовку + скриншот-референс + промпт**. Результат кладите поверх с тем же именем
и размером, затем `npm run gen:maps`.

## Общий стиль (добавлять к каждому промпту)
> Style: Limbus Company / Project Moon background art, K Corp headquarters. Painted anime background, clean
> sci-fi corporate interior. Palette: near-black green (#070d0b, #13201b), dark slate-green panels (#1d2b26),
> pale mint-grey polished stone (#cdd9d3, #eef4f0), glowing lime neon accents (#8dff3c) and teal neon (#2fe39a).
> Matte, calm surfaces — no haze, no light streaks, no lens glare. Sharp clean edges, no text, no people.
> Keep the exact canvas size and composition of the attached placeholder.

## Полы (вид строго сверху, бесшовные 256×256)
- `floors/hall.png` — *Seamless top-down texture of a polished pale mint-grey stone floor, large square slabs
  (2×2 per tile), thin dark seams, faint glossy reflections. Must tile seamlessly on all edges.*
- `floors/work.png` — *Seamless top-down texture of dark glossy slate-green floor tiles, 4×4 grid, black seams,
  subtle sheen.*
- `floors/service.png` — *Seamless top-down texture of dark perforated metal floor plates, 2×2 grid, with a lime
  diagonal hazard stripe across the middle.*
- `floors/runner.png` — *Seamless top-down texture of a deep emerald-green glossy floor runner, smooth with soft
  vertical reflections.*

## Стены (лицевая сторона, 256×256; повтор ТОЛЬКО по горизонтали, картинка целиком = высота грани)
Без ярких элементов: никакого неона и бликов на стенах — только панели, швы, плинтус.
- `walls/exterior.png` — *Front view of a matte dark slate-green wall made of tall panels (seam every 128 px),
  slightly lighter at the top, darker at the bottom, plain black plinth along the bottom edge. No neon, no glow,
  no highlights. Left and right edges must tile seamlessly.*
- `walls/interior.png` — *Front view of a matte light mint-grey corporate wall, tall panels (seam every 128 px),
  dark slate plinth along the bottom edge. No neon, no glow. Tiles horizontally.*
- `walls/glass.png` — *Front view of a glass curtain wall: thin dark frame top and sides, dark base strip, pale
  blue-grey semi-transparent glass with very faint reflection. Keep transparency (PNG alpha).*

## Двери и окна (вид спереди)
Картинка целиком растягивается **в вырез** проёма; перемычку и подоконник вокруг рисует сама стена.
Поэтому: никаких полос стены сверху/снизу, рамка — тонкая по краю, цвета створок — как у стены
(`door` — под `exterior`, `door-light` — под `interior`).
- `doors/door.png` / `doors/door-light.png` 256×256 — *Front view of a closed sliding double door filling the
  whole canvas: thin dark frame on the edges, two matte leaves in the same color as the wall (dark slate-green /
  light mint-grey), small vertical handles at the center seam, tiny dim green card-reader light on the right.
  No neon frame, no glow, nothing above the door.*
- `doors/gate.png` 512×256 — *Front view of a wide closed elevator door filling the canvas: thin dark frame,
  two frosted-glass leaves with soft pale-green light from inside. No glow, nothing above the door.*
- `windows/window.png` 256×256, `windows/window-wide.png` 512×256 — *Front view of a window filling the whole
  canvas: thin dark frame on all edges, mullion every 128 px, pale hazy sky-blue glass, very faint reflection.
  Keep glass semi-transparent.*

## Кровля (вид сверху, бесшовная 256×256)
- `roofs/roof.png` — *Seamless top-down texture of a dark corporate rooftop: slate-green panels, vent grilles,
  small lime status lights.*

## Вывески (`signs/`, SVG — можно оставить как есть или заменить PNG тех же размеров)
- `sign` 512×256, `emblem` 256×256, `floor-logo` 768×768 — логотип K: тёмная вертикальная стойка в белом
  контуре, верхняя диагональ лайм + белая полоса, нижняя диагональ тёмная в белом контуре.
