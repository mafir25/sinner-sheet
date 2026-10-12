# Генераторы временных текстур («трафаретов») для наборов корпораций

Процедурные заготовки: верные размеры, тайлинг, палитра и форма. Их дальше дорабатывают нейросетью
(ComfyUI / SDXL img2img, Gemini) — промпты лежат в `Assets/Maps/corps/<x>-corp/PROMPTS.md`.
Нужен Python 3 с `numpy` и `Pillow`. Пример для K Corp (вывод — во временную папку, потом копируется в набор):

```sh
cd scripts/map-textures
python3 kcorp.py /tmp/k/out                 # полы, стены, двери, окна, кровля
python3 kvariants.py /tmp/k/out /tmp/k/var  # варианты бесшовных текстур (края = основа)
python3 kobjects.py /tmp/k/obj              # мебель «три четверти», 4 ракурса + варианты
# превью: sheet.py <out> <png>, varsheet.py <out> <var> <png>, objsheet.py <obj> <png> <имена,через,запятую> <пол.png>
```

- `iso.py` — рендер мебели из коробок (`box`) и цилиндров (`cyl`) в проекции объёмных стен; `render4` даёт `-s/-n/-e/-w`.
- Правила (что можно в бесшовных текстурах, двери/окна, ракурсы, варианты) — `Assets/Maps/corps/README.md`.
- Для новой корпорации: скопировать `kcorp.py`/`kvariants.py`/`kobjects.py`, сменить палитру и детали.
