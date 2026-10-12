# Временные текстуры K Corp: процедурно, палитра со скриншотов. Запуск: python3 kcorp.py <выход>
import sys, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1]
rng = np.random.default_rng(11)
SS = 4  # суперсэмплинг для фигур

def hexc(h):
    h = h.lstrip('#'); return np.array([int(h[i:i+2], 16) for i in (0, 2, 4)], float) / 255

# палитра
BLACK = hexc('#070d0b'); DARK = hexc('#13201b'); PANEL = hexc('#1d2b26'); PANEL2 = hexc('#2a3a34')
MID = hexc('#5d726a'); LIGHT = hexc('#cdd9d3'); WHITE = hexc('#eef4f0')
LIME = hexc('#8dff3c'); NEON = hexc('#2fe39a'); DEEP = hexc('#0e5a3d'); GLASS = hexc('#bcd6da')

def noise(w, h, scale, aniso=(1, 1)):
    """Бесшовный шум: белый шум, отфильтрованный в частотной области (периодичен по построению)."""
    n = rng.standard_normal((h, w))
    fy = np.fft.fftfreq(h)[:, None] * aniso[1]; fx = np.fft.fftfreq(w)[None, :] * aniso[0]
    f = np.sqrt(fx**2 + fy**2)
    k = np.exp(-(f * scale) ** 2)
    r = np.real(np.fft.ifft2(np.fft.fft2(n) * k))
    r -= r.mean(); r /= (np.abs(r).max() + 1e-9)
    return r  # -1..1

def fill(w, h, c):
    return np.ones((h, w, 3)) * c

def lerp(a, b, t):
    t = np.asarray(t)[..., None] if np.ndim(t) else t
    return a * (1 - t) + b * t

def save(arr, name, alpha=None):
    arr = np.clip(arr, 0, 1)
    img = (arr * 255 + 0.5).astype(np.uint8)
    if alpha is not None:
        a = (np.clip(alpha, 0, 1) * 255 + 0.5).astype(np.uint8)
        im = Image.fromarray(np.dstack([img, a]), 'RGBA')
    else:
        im = Image.fromarray(img, 'RGB')
    p = os.path.join(OUT, name); os.makedirs(os.path.dirname(p), exist_ok=True); im.save(p, optimize=True)

def mask(w, h, draw_fn, wrap=False):
    """Маска фигур в суперсэмплинге. wrap — рисуем 3×3 копии для бесшовности."""
    im = Image.new('L', (w * SS, h * SS), 0); d = ImageDraw.Draw(im)
    offs = [(dx, dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)] if wrap else [(0, 0)]
    for dx, dy in offs:
        draw_fn(d, lambda x, y: ((x + dx * w) * SS, (y + dy * h) * SS))
    return np.asarray(im.resize((w, h), Image.LANCZOS), float) / 255

def rect(d, P, x0, y0, x1, y1, v=255):
    d.rectangle([*P(x0, y0), *(np.array(P(x1, y1)) - 1)], fill=v)

def blur(a, r, wrap=True):
    if wrap:
        h, w = a.shape; t = np.tile(a, (3, 3))
        b = np.asarray(Image.fromarray((t * 255).clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r)), float) / 255
        return b[h:2*h, w:2*w]
    return np.asarray(Image.fromarray((a * 255).clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r)), float) / 255

def glow(m, r, wrap=True):
    return np.clip(blur(m, r, wrap) * 1.6, 0, 1)

def tiles(w, h, step, seam, jitter):
    """Сетка плит: маска швов + слегка разный тон каждой плиты."""
    m = mask(w, h, lambda d, P: [rect(d, P, x, 0, x + seam, h) for x in range(0, w, step)] +
             [rect(d, P, 0, y, w, y + seam) for y in range(0, h, step)])
    tone = np.zeros((h, w))
    for ty in range(0, h, step):
        for tx in range(0, w, step):
            tone[ty:ty+step, tx:tx+step] = rng.uniform(-jitter, jitter)
    return m, tone

S = 256

# ---------- ПОЛЫ ----------
def floor_hall():
    m, tone = tiles(S, S, 128, 2, 0.025)
    n = noise(S, S, 18) * 0.03 + noise(S, S, 3) * 0.012
    base = lerp(LIGHT, WHITE, 0.35 + tone + n)
    base = lerp(base, MID * 0.9, m * 0.85)
    base = lerp(base, NEON, 0.04)
    save(base, 'floors/hall.png')

def floor_work():
    m, tone = tiles(S, S, 64, 2, 0.03)
    n = noise(S, S, 14) * 0.04
    base = lerp(PANEL, PANEL2, 0.5 + tone * 4 + n)
    base = lerp(base, BLACK, m * 0.9)
    edge = np.roll(m, 2, axis=0) * (1 - m)  # блик на кромке плиты
    base = lerp(base, MID, edge * 0.35)
    save(base, 'floors/work.png')

def floor_service():
    # тёмные металлические плиты 128 с перфорацией и лаймовым кантом по сетке
    m, tone = tiles(S, S, 128, 3, 0.02)
    holes = mask(S, S, lambda d, P: [d.ellipse([*P(x - 3, y - 3), *P(x + 3, y + 3)], fill=255)
                                      for x in range(16, S, 16) for y in range(16, S, 16)
                                      if (x % 128) not in (0,) and (y % 128) not in (0,)])
    n = noise(S, S, 10) * 0.05 + noise(S, S, 1.2) * 0.03
    base = lerp(hexc('#26322e'), hexc('#34433d'), 0.5 + tone * 5 + n)
    base = lerp(base, BLACK, holes * 0.85)
    base = lerp(base, BLACK, m)
    # лаймовый кант по шву сетки (через клетку) — сетка, а не отдельный элемент
    seam = mask(S, S, lambda d, P: [rect(d, P, 0, 0, 1, S), rect(d, P, S - 1, 0, S, S), rect(d, P, 0, 0, S, 1), rect(d, P, 0, S - 1, S, S)])
    base = lerp(base, LIME * 0.6, glow(seam, 3) * 0.35)
    base = lerp(base, LIME * 0.9, seam)
    save(base, 'floors/service.png')

def floor_runner():
    # тёмно-зелёная глянцевая «дорожка» как в холле на 2-м кадре
    n = noise(S, S, 20) * 0.05
    base = lerp(DEEP, hexc('#137a52'), 0.4 + n)
    save(base, 'floors/runner.png')

# ---------- СТЕНЫ (лицевая сторона: растягивается на грань целиком, повтор только по длине) ----------
# Без ярких элементов: только панели, швы, плинтус. Двери/окна берут те же цвета — стыкуются без артефактов.
EXT = (PANEL2, DARK)                      # тёмная панель: верх → низ
INT = (WHITE, LIGHT * 0.88)               # светлая панель
def wall_base(w, h, top, bottom, seam_c, plinth_c):
    n = noise(w, h, 18, aniso=(1, 6)) * 0.035
    g = np.linspace(0, 1, h)[:, None] * np.ones((1, w))
    base = lerp(top, bottom, g + n)
    seams = mask(w, h, lambda d, P: [rect(d, P, x, 0, x + 2, h) for x in range(0, w, 128)])
    base = lerp(base, seam_c, seams * 0.6)
    plinth = mask(w, h, lambda d, P: [rect(d, P, 0, h - 26, w, h)])
    return lerp(base, plinth_c, plinth)

def neon_line(base, m, core, r=5, k=0.45):
    """Неон: мягкое свечение + яркая сердцевина. Только сплошные линии — без одиночных пятен."""
    base = lerp(base, core * 0.7, glow(m, r) * k)
    return lerp(base, lerp(core, WHITE, 0.45), m)

def wall_exterior():
    base = wall_base(S, S, *EXT, BLACK, BLACK * 1.4)
    cap = mask(S, S, lambda d, P: [rect(d, P, 0, 0, S, 26)])
    base = lerp(base, BLACK * 1.3, cap)
    base = neon_line(base, mask(S, S, lambda d, P: [rect(d, P, 0, 26, S, 30)]), LIME)   # сплошной карниз
    save(base, 'walls/exterior.png')

def wall_interior():
    base = wall_base(S, S, *INT, MID, PANEL)
    base = neon_line(base, mask(S, S, lambda d, P: [rect(d, P, 0, 226, S, 230)]), NEON, 4, 0.35)  # кант над плинтусом
    save(base, 'walls/interior.png')

def wall_glass():
    y = np.arange(S)[:, None]; x = np.arange(S)[None, :]
    g = lerp(GLASS, hexc('#dfeceb'), np.clip(1 - y / S, 0, 1) * 0.5)
    g = lerp(g, WHITE, ((x + y) % 128 < 18) * 0.12)
    a = np.ones((S, S)) * 0.6
    frame = mask(S, S, lambda d, P: [rect(d, P, 0, 0, 10, S), rect(d, P, 0, 0, S, 10), rect(d, P, 0, 226, S, S)])
    g = lerp(g, DARK, frame); a = np.maximum(a, frame)
    # тонкий бирюзовый кант по оси импоста и по низу — часть сетки, а не отдельный элемент
    acc = mask(S, S, lambda d, P: [rect(d, P, 4, 10, 6, 226), rect(d, P, 0, 228, S, 230)])
    g = lerp(g, NEON, acc)
    save(g, 'walls/glass.png', a)

# ---------- ДВЕРИ И ОКНА (вид спереди: картинка целиком = проём; стену вокруг рисует редактор) ----------
def door(w, name, pal, light_inside=False, accent=LIME):  # accent — неон той стены, под которую дверь
    h = S
    n = noise(w, h, 18, aniso=(1, 6)) * 0.03
    gy = np.linspace(0, 1, h)[:, None] * np.ones((1, w))
    top, bottom = pal
    leaf = lerp(top * 0.92, bottom * 0.92, gy + n)   # чуть темнее стены — читается как створка
    if light_inside:  # лифт: матовое стекло, за ним светлая кабина
        leaf = lerp(leaf, lerp(hexc('#dfe9e2'), hexc('#9fb5aa'), gy), 0.5)
    fr = mask(w, h, lambda d, P: [rect(d, P, 0, 0, w, 8), rect(d, P, 0, 0, 8, h), rect(d, P, w - 8, 0, w, h),
                                   rect(d, P, w // 2 - 2, 8, w // 2 + 2, h)])
    base = lerp(leaf, BLACK * 1.4, fr * 0.85)
    neon = mask(w, h, lambda d, P: [rect(d, P, 8, 8, w - 8, 12), rect(d, P, 8, 8, 12, h), rect(d, P, w - 12, 8, w - 8, h)])
    base = lerp(base, accent * 0.7, glow(neon, 6, wrap=False) * 0.35)
    base = lerp(base, lerp(accent, WHITE, 0.45), neon)
    handle = mask(w, h, lambda d, P: [rect(d, P, w // 2 - 14, 110, w // 2 - 8, 150), rect(d, P, w // 2 + 8, 110, w // 2 + 14, 150)])
    base = lerp(base, MID, handle * 0.8)
    reader = mask(w, h, lambda d, P: [rect(d, P, w - 26, 118, w - 18, 130)])
    base = lerp(base, accent, reader)
    save(base, f'doors/{name}.png')

def window(w, name):
    h = S
    y = np.arange(h)[:, None]; x = np.arange(w)[None, :]
    g = lerp(hexc('#e3edef'), hexc('#a7bec5'), np.clip(y / h, 0, 1) ** 1.4)
    g = lerp(g, WHITE, ((x + y * 0.6) % 160 < 22) * 0.12)
    a = np.ones((h, w)) * 0.8
    fr = mask(w, h, lambda d, P: [rect(d, P, 0, 0, w, 8), rect(d, P, 0, h - 8, w, h), rect(d, P, 0, 0, 8, h),
                                   rect(d, P, w - 8, 0, w, h)] + [rect(d, P, xx - 3, 0, xx + 3, h) for xx in range(128, w, 128)])
    g = lerp(g, DARK, fr); a = np.maximum(a, fr)
    sill = mask(w, h, lambda d, P: [rect(d, P, 0, h - 12, w, h - 8)])
    g = lerp(g, NEON, sill); a = np.maximum(a, sill)
    save(g, f'windows/{name}.png', a)

# ---------- КРОВЛЯ (вид сверху) ----------
def roof():
    m, tone = tiles(S, S, 128, 3, 0.02)
    n = noise(S, S, 8) * 0.05 + noise(S, S, 1.0) * 0.04
    base = lerp(hexc('#1f2925'), hexc('#2e3a35'), 0.5 + tone * 4 + n)
    base = lerp(base, BLACK, m)
    save(base, 'roofs/roof.png')

for f in [floor_hall, floor_work, floor_service, floor_runner, wall_exterior, wall_interior, wall_glass, roof]:
    f()
door(256, 'door', EXT); door(256, 'door-light', INT, accent=NEON); door(512, 'gate', EXT, True)
window(256, 'window'); window(512, 'window-wide')
print('ok')
