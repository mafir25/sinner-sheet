# K Corp — промпты для доработки текстур

Текущие картинки — временные процедурные заготовки: верные размеры, тайлинг и палитра, но без деталей.
Отправляйте нейросети **заготовку + скриншот-референс + промпт**. Результат кладите поверх с тем же именем
и размером, затем `npm run gen:maps`.

## Общий стиль (добавлять к каждому промпту)
> Style: Limbus Company / Project Moon background art, K Corp headquarters. Painted anime background, clean
> sci-fi corporate interior. Palette: near-black green (#070d0b, #13201b), dark slate-green panels (#1d2b26),
> pale mint-grey polished stone (#cdd9d3, #eef4f0), glowing lime neon accents (#8dff3c) and teal neon (#2fe39a).
> Soft vertical light reflections on glossy surfaces, sharp clean edges, no text, no people.
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

## Стены (лицевая сторона, бесшовные по горизонтали, 256×256; верх картинки = верх стены)
- `walls/exterior.png` — *Front view of a dark slate-green wall panel, top cornice with a thin glowing lime neon
  line, one vertical lime neon strip, vertical panel seams. Tiles horizontally.*
- `walls/interior.png` — *Front view of a light mint-grey corporate wall with vertical panel seams, dark plinth at
  the bottom with a thin teal neon trim. Tiles horizontally.*
- `walls/glass.png` — *Front view of a glass curtain wall: dark mullions, pale blue-white semi-transparent glass
  with diagonal reflections, thin teal accent on the mullion. Keep transparency (PNG alpha).*

## Двери и окна (вид спереди)
- `doors/door.png` 256×256 — *Front view of a sliding sci-fi double door, dark panels, lime neon frame, small
  green floor plate above, lime card reader on the right.*
- `doors/gate.png` 512×256 — *Front view of a wide elevator / airlock door with frosted glass leaves glowing
  pale green from inside, lime neon frame, floor indicator plate above.*
- `windows/window.png` 256×256, `windows/window-wide.png` 512×256 — *Front view of a tall office window, dark
  frame, pale hazy city skyline behind glass, teal neon sill. Keep glass semi-transparent.*

## Кровля (вид сверху, бесшовная 256×256)
- `roofs/roof.png` — *Seamless top-down texture of a dark corporate rooftop: slate-green panels, vent grilles,
  small lime status lights.*

## Вывески (`signs/`, SVG — можно оставить как есть или заменить PNG тех же размеров)
- `sign` 512×256, `emblem` 256×256, `floor-logo` 768×768 — логотип K: тёмная вертикальная стойка в белом
  контуре, верхняя диагональ лайм + белая полоса, нижняя диагональ тёмная в белом контуре.
