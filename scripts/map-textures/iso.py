# Мебель в проекции «три четверти» (как объёмные стены): видны верх и передняя (южная) грань.
# Предмет описан коробками в координатах клеток (px при 256/клетку), лицом на юг (вниз). Четыре поворота.
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SS = 4
K = 0.55          # высота → сдвиг вверх на экране (px на px высоты)
OUTLINE = (6, 12, 10, 150)

def hexa(h, a=255):
    h = h.lstrip('#'); return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)

def shade(c, k):
    return tuple(int(max(0, min(255, v * k))) for v in c[:3]) + (c[3],)

def box(x0, y0, x1, y1, z0, z1, color, front=None, glow=0, alpha=255, outline=True):
    """Коробка: x0..x1 (ширина), y0..y1 (глубина, юг = больше), z0..z1 (высота)."""
    c = hexa(color, alpha) if isinstance(color, str) else color
    f = (hexa(front, alpha) if isinstance(front, str) else front) if front else shade(c, 0.68)
    return dict(x0=x0, y0=y0, x1=x1, y1=y1, z0=z0, z1=z1, top=c, front=f, glow=glow, outline=outline)

def cyl(cx, cy, r, z0, z1, color, front=None, glow=0, alpha=255, outline=True):
    """Вертикальный цилиндр (ампула, колонна): верх — круг, бок — от центра к зрителю."""
    b = box(cx - r, cy - r, cx + r, cy + r, z0, z1, color, front, glow, alpha, outline); b['cyl'] = True; return b

def rotate(b, W, D, d):
    pts = [(b['x0'], b['y0']), (b['x1'], b['y1'])]
    if d == 's': m = lambda x, y: (x, y)
    elif d == 'n': m = lambda x, y: (W - x, D - y)
    elif d == 'e': m = lambda x, y: (y, W - x)      # перед смотрит вправо
    else: m = lambda x, y: (D - y, x)               # 'w': перед смотрит влево
    (ax, ay), (bx, by) = [m(*p) for p in pts]
    r = dict(b); r.update(x0=min(ax, bx), x1=max(ax, bx), y0=min(ay, by), y1=max(ay, by)); return r

def draw_order(bx):
    """Что рисовать позже: стоящее сверху (z0 ≥ z1 другого) и стоящее спереди (y0 ≥ y1 другого)."""
    e = 0.5
    ox = lambda a, b: a['x0'] < b['x1'] - e and b['x0'] < a['x1'] - e
    def after(a, b):  # a рисуется после b
        if not ox(a, b): return False
        if a['z0'] >= b['z1'] - e: return True
        if b['z0'] >= a['z1'] - e: return False
        if a['y0'] >= b['y1'] - e: return True
        if b['y0'] >= a['y1'] - e: return False
        return a['z1'] > b['z1'] or (a['z1'] == b['z1'] and a['y1'] > b['y1'])  # пересекаются по глубине: выше — позже
    n = len(bx); deps = [[j for j in range(n) if j != i and after(bx[i], bx[j])] for i in range(n)]
    done, out = set(), []
    while len(out) < n:
        ready = [i for i in range(n) if i not in done and all(j in done for j in deps[i])]
        if not ready: ready = [min((i for i in range(n) if i not in done), key=lambda i: bx[i]['y1'])]
        i = min(ready, key=lambda i: (bx[i]['z0'], bx[i]['y1'])); done.add(i); out.append(bx[i])
    return out

def render(boxes, W, D, d, path):
    bw, bh = (W, D) if d in 'sn' else (D, W)
    bx = [rotate(b, W, D, d) for b in boxes]
    # вписать по высоте: самое высокое не должно вылезти за верх картинки
    top = min(b['y0'] - b['z1'] * K for b in bx)
    sy = bh / (bh - min(0, top)); oy = -min(0, top)
    P = lambda x, y, z: (x * SS, ((y - z * K) + oy) * sy * SS)
    img = Image.new('RGBA', (bw * SS, bh * SS), (0, 0, 0, 0))
    glow = Image.new('RGBA', img.size, (0, 0, 0, 0))
    # тень на полу
    sh = Image.new('L', img.size, 0); sd = ImageDraw.Draw(sh)
    for b in bx:
        if b['z0'] == 0:
            sd.rectangle([*P(b['x0'] + 6, b['y0'] + 8, 0), *P(b['x1'] + 6, b['y1'] + 8, 0)], fill=110)
    sh = sh.filter(ImageFilter.GaussianBlur(6 * SS))
    img = Image.composite(Image.new('RGBA', img.size, (0, 0, 0, 255)), img, sh)
    dr = ImageDraw.Draw(img); gd = ImageDraw.Draw(glow)
    for b in draw_order(bx):
        x0, x1, y0, y1, z0, z1 = b['x0'], b['x1'], b['y0'], b['y1'], b['z0'], b['z1']
        front = [P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)]
        topf = [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)]
        ol = OUTLINE if b['outline'] else None
        w = SS * 2 if ol else 0
        if b.get('cyl'):
            cx, cy, r = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2
            bot = [P(cx - r, cy - r, z0), P(cx + r, cy + r, z0)]
            topc = [P(cx - r, cy - r, z1), P(cx + r, cy + r, z1)]
            body = [P(cx - r, cy, z0), P(cx + r, cy, z0), P(cx + r, cy, z1), P(cx - r, cy, z1)]
            dr.ellipse(bot, fill=b['front'], outline=ol, width=w)
            dr.polygon(body, fill=b['front'])
            if ol:
                dr.line([body[0], body[3]], fill=ol, width=w); dr.line([body[1], body[2]], fill=ol, width=w)
            dr.ellipse(topc, fill=b['top'], outline=ol, width=w)
            if b['glow']:
                gc = b['top'][:3] + (int(255 * b['glow']),)
                gd.ellipse(bot, fill=gc); gd.polygon(body, fill=gc); gd.ellipse(topc, fill=gc)
            continue
        dr.polygon(front, fill=b['front'], outline=ol, width=w)
        dr.polygon(topf, fill=b['top'], outline=ol, width=w)
        if b['glow']:
            gd.polygon(front, fill=b['top'][:3] + (int(255 * b['glow']),)); gd.polygon(topf, fill=b['top'][:3] + (int(255 * b['glow']),))
    g = glow.filter(ImageFilter.GaussianBlur(7 * SS))
    out = Image.alpha_composite(Image.alpha_composite(img, g), Image.new('RGBA', img.size, (0, 0, 0, 0)))
    # свечение не должно гасить прозрачность: кладём glow поверх, затем снова предмет, чтобы края были чёткими
    out = Image.alpha_composite(g, img); out = Image.alpha_composite(out, Image.composite(g, Image.new('RGBA', img.size, (0, 0, 0, 0)), img.split()[3].point(lambda v: 0)))
    out = out.resize((bw, bh), Image.LANCZOS)
    os.makedirs(os.path.dirname(path), exist_ok=True); out.save(path, optimize=True)

def render4(boxes, W, D, out_dir, name):
    for d in 'snew':
        render(boxes, W, D, d, os.path.join(out_dir, f'{name}-{d}.png'))
