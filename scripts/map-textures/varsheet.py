import sys, os, glob
import numpy as np
from PIL import Image, ImageDraw
base_dir, var_dir, out = sys.argv[1:4]
L = lambda p: Image.open(p).convert('RGBA')
# 1) края совпадают с базой
worst = 0
for p in sorted(glob.glob(f'{var_dir}/*/*.png')):
    kind, f = p.split('/')[-2:]; base = f.split('-')[0] + '.png'
    a = np.asarray(L(p), int); b = np.asarray(L(f'{base_dir}/{kind}/{base}'), int)
    e = max(abs(a[0] - b[0]).max(), abs(a[-1] - b[-1]).max(), abs(a[:, 0] - b[:, 0]).max(), abs(a[:, -1] - b[:, -1]).max())
    worst = max(worst, e)
print('макс. разница на краях:', worst)
# 2) раскладки
rows = [('floors', 'hall', 4, 3), ('floors', 'work', 4, 3), ('floors', 'service', 4, 2), ('floors', 'runner', 4, 2),
        ('walls', 'exterior', 8, 1), ('walls', 'interior', 8, 1), ('walls', 'glass', 8, 1), ('roofs', 'roof', 4, 2)]
rng = np.random.default_rng(3); W = 1300; sheet = Image.new('RGB', (W, 6000), (32, 32, 32)); dr = ImageDraw.Draw(sheet); y = 10
for kind, name, nx, ny in rows:
    vars_ = sorted(glob.glob(f'{var_dir}/{kind}/{name}-*.png')); base = L(f'{base_dir}/{kind}/{name}.png')
    cells = [L(v) for v in vars_]; seq = cells + [base] * (nx * ny - len(cells)); rng.shuffle(seq)
    t = 128 if kind != 'walls' else 144
    can = Image.new('RGBA', (nx * t, ny * t), (70, 70, 70, 255))
    for i, im in enumerate(seq): can.alpha_composite(im.resize((t, t), Image.LANCZOS), ((i % nx) * t, (i // nx) * t))
    sheet.paste(can, (10, y))
    dr.text((10, y + can.height + 3), f'{kind}/{name} + ' + ', '.join(os.path.basename(v)[len(name) + 1:-4] for v in vars_), fill=(220, 220, 220))
    y += can.height + 24
sheet.crop((0, 0, W, y)).save(out)
