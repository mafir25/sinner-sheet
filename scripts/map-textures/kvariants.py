# Варианты бесшовных текстур K Corp: рисуются поверх базовой картинки, края совпадают с базой пиксель в пиксель.
import sys, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
SRC, OUT = sys.argv[1], sys.argv[2]
SS = 4; S = 256; M = 12  # M — поле у края, где вариант не отличается от базы

def hexc(h): h = h.lstrip('#'); return np.array([int(h[i:i+2], 16) for i in (0, 2, 4)], float) / 255
BLACK, DARK, PANEL, PANEL2 = hexc('#070d0b'), hexc('#13201b'), hexc('#1d2b26'), hexc('#2a3a34')
MID, LIGHT, WHITE = hexc('#5d726a'), hexc('#cdd9d3'), hexc('#eef4f0')
LIME, NEON, DEEP = hexc('#8dff3c'), hexc('#2fe39a'), hexc('#0e5a3d')

def load(p):
    im = Image.open(os.path.join(SRC, p)); a = np.asarray(im.convert('RGBA'), float) / 255
    return a[..., :3].copy(), a[..., 3].copy(), im.mode == 'RGBA'
def lerp(a, b, t): t = np.asarray(t)[..., None] if np.ndim(t) else t; return a * (1 - t) + b * t
def mask(draw_fn):
    im = Image.new('L', (S * SS, S * SS), 0); d = ImageDraw.Draw(im)
    draw_fn(d, lambda x, y: (x * SS, y * SS))
    return np.asarray(im.resize((S, S), Image.LANCZOS), float) / 255
def R(x0, y0, x1, y1): return lambda d, P: d.rectangle([*P(x0, y0), *(np.array(P(x1, y1)) - 1)], fill=255)
def E(x0, y0, x1, y1): return lambda d, P: d.ellipse([*P(x0, y0), *P(x1, y1)], fill=255)
def many(*fs): return lambda d, P: [f(d, P) for f in fs]
def glow(m, r): return np.clip(np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r)), float) / 255 * 1.6, 0, 1)
y, x = np.mgrid[0:S, 0:S]
edge = np.clip(np.minimum.reduce([x, y, S - 1 - x, S - 1 - y]) / M, 0, 1)  # 0 у края → 1 внутри

class V:
    def __init__(self, base): self.base = base; self.c, self.a, self.rgba = load(base); self.c0, self.a0 = self.c.copy(), self.a.copy()
    def paint(self, m, color, k=1.0): self.c = lerp(self.c, color, m * k); return self
    def neon(self, m, color, core=None, r=5, k=0.45):
        self.paint(glow(m, r), color * 0.75, k); return self.paint(m, core if core is not None else lerp(color, WHITE, 0.4))
    def save(self, name):
        c = lerp(self.c0, self.c, edge); a = self.a0 * (1 - edge) + self.a * edge
        img = (np.clip(c, 0, 1) * 255 + .5).astype(np.uint8)
        im = Image.fromarray(np.dstack([img, (np.clip(a, 0, 1) * 255 + .5).astype(np.uint8)]), 'RGBA') if self.rgba else Image.fromarray(img, 'RGB')
        p = os.path.join(OUT, os.path.dirname(self.base), name); os.makedirs(os.path.dirname(p), exist_ok=True); im.save(p, optimize=True)
        print(os.path.relpath(p, OUT))

def bolts(cx, cy, w, h, r=3):
    return many(E(cx - w/2 + 8 - r, cy - h/2 + 8 - r, cx - w/2 + 8 + r, cy - h/2 + 8 + r), E(cx + w/2 - 8 - r, cy - h/2 + 8 - r, cx + w/2 - 8 + r, cy - h/2 + 8 + r),
                E(cx - w/2 + 8 - r, cy + h/2 - 8 - r, cx - w/2 + 8 + r, cy + h/2 - 8 + r), E(cx + w/2 - 8 - r, cy + h/2 - 8 - r, cx + w/2 - 8 + r, cy + h/2 - 8 + r))
def grille(x0, y0, x1, y1, step=8, vertical=False):
    if vertical: return many(*[R(xx, y0 + 4, xx + 3, y1 - 4) for xx in range(int(x0) + 6, int(x1) - 6, step)])
    return many(*[R(x0 + 4, yy, x1 - 4, yy + 3) for yy in range(int(y0) + 6, int(y1) - 6, step)])

# ---------- ПОЛЫ (плиты 128 у hall/service, 64 у work; швы на 0 и 128) ----------
v = V('floors/hall.png')   # решётка вентиляции в одной плите
v.paint(mask(R(150, 150, 234, 234)), MID * 0.8).paint(mask(grille(150, 150, 234, 234, 9)), BLACK, 0.9).save('hall-grate.png')
v = V('floors/hall.png')   # световая линия, утопленная в плиту (не до края)
v.neon(mask(R(146, 188, 238, 192)), LIME, r=4, k=0.35).save('hall-light.png')
v = V('floors/hall.png')   # чуть другой тон плиты + потёртость
v.paint(glow(mask(many(E(150, 40, 214, 70), E(176, 66, 236, 92), E(40, 168, 92, 196))), 10), MID, 0.12).save('hall-worn.png')
v = V('floors/hall.png')   # маленький инкрустированный знак K (ромб-метка) по центру плиты
v.paint(mask(lambda d, P: d.polygon([P(64, 44), P(84, 64), P(64, 84), P(44, 64)], fill=255)), DEEP, 0.9) \
 .neon(mask(lambda d, P: d.polygon([P(64, 54), P(74, 64), P(64, 74), P(54, 64)], fill=255)), LIME, r=3, k=0.3).save('hall-inlay.png')

v = V('floors/work.png')   # кабельный люк на 2×1 плитки
v.paint(mask(R(132, 68, 252, 124)), PANEL * 0.9).paint(mask(bolts(192, 96, 120, 56, 2.5)), MID).paint(mask(R(150, 92, 234, 100)), BLACK, 0.6).save('work-hatch.png')
v = V('floors/work.png')   # решётка в одной плитке
v.paint(mask(grille(68, 132, 124, 188, 7)), BLACK, 0.85).save('work-grate.png')
v = V('floors/work.png')   # индикатор в шве: короткая лаймовая метка
v.neon(mask(R(140, 190, 180, 193)), LIME, r=3, k=0.35).save('work-light.png')

v = V('floors/service.png')  # люк обслуживания с болтами
v.paint(mask(R(26, 26, 102, 102)), PANEL2).paint(mask(bolts(64, 64, 76, 76)), MID).paint(mask(R(54, 60, 74, 68)), BLACK).save('service-hatch.png')
v = V('floors/service.png')  # сток
v.paint(mask(E(160, 160, 224, 224)), BLACK * 1.5).paint(mask(grille(166, 166, 218, 218, 7, True)), MID, 0.6).save('service-drain.png')

v = V('floors/runner.png')   # тонкая неоновая кромка вдоль дорожки (в середине клетки, не до края)
v.neon(mask(R(16, 126, 240, 130)), LIME, r=4, k=0.3).save('runner-line.png')
v = V('floors/runner.png')   # знак K, инкрустированный в дорожку
v.paint(mask(lambda d, P: d.polygon([P(128, 84), P(172, 128), P(128, 172), P(84, 128)], fill=255)), DEEP * 0.7) \
 .neon(mask(many(R(112, 104, 120, 152), lambda d, P: d.polygon([P(120, 128), P(140, 104), P(148, 104), P(124, 132)], fill=255),
                 lambda d, P: d.polygon([P(124, 124), P(148, 152), P(140, 152), P(120, 130)], fill=255))), LIME, r=3, k=0.3).save('runner-k.png')

# ---------- СТЕНЫ (карниз сверху 0..30, плинтус снизу 230..256; панели со швом на 0 и 128) ----------
v = V('walls/exterior.png')  # вертикальный светодиод
v.neon(mask(R(190, 30, 195, 226)), LIME, core=hexc('#d6ffb0'), r=6).save('exterior-led.png')
v = V('walls/exterior.png')  # вентиляционная решётка
v.paint(mask(R(150, 150, 230, 210)), BLACK * 1.5).paint(mask(grille(150, 150, 230, 210, 9)), PANEL2, 0.9).save('exterior-vent.png')
v = V('walls/exterior.png')  # технический щиток с огоньком
v.paint(mask(R(40, 90, 88, 170)), PANEL2 * 1.15).paint(mask(bolts(64, 130, 48, 80, 2)), MID) \
 .neon(mask(R(58, 104, 70, 110)), LIME, r=3, k=0.4).save('exterior-panel.png')
v = V('walls/exterior.png')  # табличка с K
v.paint(mask(R(152, 70, 232, 150)), LIGHT * 0.9).paint(mask(many(R(170, 84, 180, 136),
     lambda d, P: d.polygon([P(180, 112), P(206, 84), P(218, 84), P(184, 120)], fill=255),
     lambda d, P: d.polygon([P(186, 116), P(218, 136), P(206, 136), P(180, 122)], fill=255))), DARK) \
 .paint(mask(lambda d, P: d.polygon([P(181, 110), P(206, 84), P(212, 84), P(183, 114)], fill=255)), LIME).save('exterior-k.png')

v = V('walls/interior.png')  # вертикальная бирюзовая подсветка
v.neon(mask(R(190, 16, 194, 222)), NEON, r=5, k=0.35).save('interior-led.png')
v = V('walls/interior.png')  # панель доступа (считыватель)
v.paint(mask(R(176, 100, 208, 150)), PANEL).neon(mask(R(186, 112, 198, 118)), NEON, r=3, k=0.4).save('interior-panel.png')
v = V('walls/interior.png')  # решётка вентиляции под потолком
v.paint(mask(R(30, 24, 110, 56)), MID * 1.2).paint(mask(grille(30, 24, 110, 56, 7, True)), PANEL, 0.8).save('interior-vent.png')
v = V('walls/interior.png')  # вертикальная полоса-табличка этажа
v.paint(mask(R(150, 60, 234, 96)), PANEL).paint(mask(R(160, 76, 224, 80)), NEON).save('interior-plate.png')

v = V('walls/glass.png')     # матовая вставка
v.paint(mask(R(14, 120, 250, 222)), WHITE, 0.5); v.a = np.maximum(v.a, mask(R(14, 120, 250, 222)) * 0.85); v.save('glass-frosted.png')
v = V('walls/glass.png')     # наклейка-полоса с K на стекле
v.paint(mask(R(14, 150, 250, 170)), DARK, 0.85); v.a = np.maximum(v.a, mask(R(14, 150, 250, 170)) * 0.9)
v.neon(mask(R(14, 159, 250, 161)), LIME, r=3, k=0.3).save('glass-band.png')

# ---------- КРОВЛЯ ----------
v = V('roofs/roof.png')      # вентиляционный короб
v.paint(mask(R(24, 24, 104, 104)), PANEL2 * 1.2).paint(mask(grille(24, 24, 104, 104, 8)), BLACK, 0.8).save('roof-vent.png')
v = V('roofs/roof.png')      # люк
v.paint(mask(R(150, 150, 234, 234)), PANEL2).paint(mask(bolts(192, 192, 84, 84)), MID).paint(mask(R(150, 188, 234, 196)), BLACK, 0.6).save('roof-hatch.png')
v = V('roofs/roof.png')      # сигнальный огонь
v.neon(mask(E(184, 56, 200, 72)), LIME, r=6, k=0.5).save('roof-beacon.png')
