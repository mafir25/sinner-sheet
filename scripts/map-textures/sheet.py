import sys, os
from PIL import Image, ImageDraw
src, out = sys.argv[1], sys.argv[2]
L = lambda p: Image.open(os.path.join(src, p)).convert('RGBA')
def rep(im, nx, ny):
    t = Image.new('RGBA', (im.width * nx, im.height * ny))
    for x in range(nx):
        for y in range(ny): t.paste(im, (x * im.width, y * im.height))
    return t
def wall_mock(wall, parts, cells=7):
    """Как render.ts: стена вокруг выреза, картинка проёма растянута в вырез, тёмная кромка."""
    w = rep(L(wall), cells, 1); d = ImageDraw.Draw(w)
    for p, cx, top, bot in parts:
        im = L(p); cw = im.width; y0 = int(256 * top); y1 = int(256 * (1 - bot))
        hole = Image.new('RGBA', (cw, y1 - y0), (0, 0, 0, 255)); hole.alpha_composite(im.resize((cw, y1 - y0), Image.LANCZOS))
        w.paste(hole, (cx * 256, y0))
        d.rectangle([cx * 256, y0, cx * 256 + cw - 1, y1 - 1], outline=(0, 0, 0, 190), width=3)
    return w.resize((w.width // 2, w.height // 2), Image.LANCZOS)
rows = [
  [('floors/hall.png', rep(L('floors/hall.png'), 2, 2).resize((256, 256))),
   ('floors/work.png', rep(L('floors/work.png'), 2, 2).resize((256, 256))),
   ('floors/service.png', rep(L('floors/service.png'), 2, 2).resize((256, 256))),
   ('floors/runner.png', rep(L('floors/runner.png'), 2, 2).resize((256, 256)))],
  [(p, rep(L(p), 3, 1).resize((384, 128))) for p in ('walls/exterior.png', 'walls/interior.png')] +
  [('walls/glass.png', rep(L('walls/glass.png'), 3, 1).resize((384, 128)))],
  [(p, L(p).resize((L(p).width // 2, 128))) for p in ('doors/door.png', 'doors/door-light.png', 'doors/gate.png', 'windows/window.png', 'windows/window-wide.png')] + [('roofs/roof.png', rep(L('roofs/roof.png'), 2, 2).resize((128, 128)))],
  [('mock: exterior + door, window, gate, window-wide', wall_mock('walls/exterior.png',
     [('doors/door.png', 1, .15, 0), ('windows/window.png', 3, .3, .3), ('doors/gate.png', 4, .15, 0)]))],
  [('mock: interior + door-light, window-wide', wall_mock('walls/interior.png',
     [('doors/door-light.png', 1, .15, 0), ('windows/window-wide.png', 3, .3, .3)]))],
]
W = 1220; sheet = Image.new('RGB', (W, 3000), (32, 32, 32)); d = ImageDraw.Draw(sheet); y = 10
for row in rows:
    x = 10; h = 0
    for name, im in row:
        bg = Image.new('RGBA', im.size, (70, 70, 70, 255)); bg.alpha_composite(im)
        sheet.paste(bg, (x, y)); d.text((x, y + im.height + 4), name, fill=(220, 220, 220)); x += im.width + 12; h = max(h, im.height)
    y += h + 28
sheet.crop((0, 0, W, y)).save(out)
