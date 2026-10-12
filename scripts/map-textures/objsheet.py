import sys, os
from PIL import Image, ImageDraw
src, out, names = sys.argv[1], sys.argv[2], sys.argv[3].split(',')
floor = Image.open(sys.argv[4]).convert('RGBA').resize((128, 128))
sc = 0.5; W = 1300; sheet = Image.new('RGB', (W, 6000), (32, 32, 32)); dr = ImageDraw.Draw(sheet); y = 10
for n in names:
    x = 10; h = 0
    for d in 'snew':
        im = Image.open(os.path.join(src, f'{n}-{d}.png')).convert('RGBA')
        im = im.resize((int(im.width * sc), int(im.height * sc)), Image.LANCZOS)
        bg = Image.new('RGBA', im.size)
        for tx in range(0, im.width, 128):
            for ty in range(0, im.height, 128): bg.paste(floor, (tx, ty))
        bg.alpha_composite(im); sheet.paste(bg, (x, y)); dr.text((x, y + im.height + 3), f'{n}-{d}', fill=(220, 220, 220))
        x += im.width + 14; h = max(h, im.height)
    y += h + 26
sheet.crop((0, 0, W, y)).save(out)
