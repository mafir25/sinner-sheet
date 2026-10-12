import sys
from iso import box, cyl, render4
OUT = sys.argv[1]
DARK, PANEL, PANEL2, MID, LIGHT, WHITE = '#13201b', '#1d2b26', '#2a3a34', '#5d726a', '#cdd9d3', '#eef4f0'
LIME, NEON, DEEP = '#8dff3c', '#2fe39a', '#0e5a3d'
OLIVE, OLIVE_L = '#8c7c3e', '#a8975a'

def sofa():  # диван из лаунжа (1-й кадр), 2×1
    return [box(72, 100, 440, 236, 0, 55, OLIVE),
            box(76, 104, 436, 230, 55, 72, OLIVE_L),
            box(72, 36, 440, 100, 0, 150, OLIVE),
            box(20, 36, 72, 236, 0, 100, OLIVE), box(440, 36, 492, 236, 0, 100, OLIVE)]

def reception():  # стойка ресепшена (2-й кадр), 2×1
    return [box(14, 70, 498, 226, 0, 110, DARK),
            box(4, 60, 508, 236, 110, 122, WHITE),
            box(14, 226, 498, 230, 34, 40, LIME, glow=0.9, outline=False),
            box(60, 76, 160, 92, 122, 190, '#101615'), box(66, 92, 154, 94, 128, 184, '#9fd8c0', glow=0.35, outline=False),
            box(352, 76, 452, 92, 122, 190, '#101615'), box(358, 92, 446, 94, 128, 184, '#9fd8c0', glow=0.35, outline=False)]

def hp_crate():  # открытый ящик с ампулами HP, 1×1: ровная сетка 4×3, круглые ампулы
    b = [box(28, 40, 228, 224, 0, 72, LIGHT, front='#9fb1a8'),
         box(38, 50, 218, 214, 72, 73, DARK, outline=False),
         box(28, 224, 228, 226, 20, 28, LIME, glow=0.8, outline=False)]
    for i in range(4):
        for j in range(3):
            cx = 128 + (i - 1.5) * 44; cy = 132 + (j - 1) * 52
            b.append(cyl(cx, cy, 15, 73, 100, '#8dff6a', front='#4cc24a', glow=0.3))
            b.append(cyl(cx, cy, 9, 100, 108, WHITE))
    return b

def armchair():  # кресло из лаунжа, 1×1
    return [box(40, 100, 216, 230, 0, 55, OLIVE), box(44, 104, 212, 226, 55, 70, OLIVE_L),
            box(40, 40, 216, 100, 0, 150, OLIVE), box(10, 40, 40, 230, 0, 95, OLIVE), box(216, 40, 246, 230, 0, 95, OLIVE)]

def coffee_table():  # низкий столик, 1×1
    return [box(40, 70, 216, 196, 0, 44, DARK), box(30, 60, 226, 206, 44, 52, '#cfe0dc', alpha=220)]

def server_lockers():  # шкаф с ячейками (1-й кадр, слева), 1×1, стоит у стены
    b = [box(24, 40, 232, 150, 0, 230, PANEL2, front='#3a4a44')]
    for r in range(5):
        z = 14 + r * 42
        b.append(box(36, 150, 220, 152, z, z + 34, '#c9d3ce', front='#b9c5bf', outline=False))
        b.append(box(44, 152, 120, 153, z + 12, z + 16, '#3a4a44', outline=False))
        b.append(box(196, 152, 208, 153, z + 12, z + 18, LIME, glow=0.6, outline=False))
    return b

def lab_table():  # лабораторный стол K Corp, 2×1
    b = [box(20, 60, 492, 210, 0, 100, LIGHT, front='#aebdb6'),
         box(10, 50, 502, 220, 100, 110, DARK),
         box(20, 210, 492, 212, 80, 86, LIME, glow=0.8, outline=False),
         box(380, 80, 470, 140, 110, 160, PANEL2), box(386, 140, 464, 142, 118, 154, '#9fd8c0', glow=0.35, outline=False)]
    b.append(box(50, 82, 240, 114, 110, 116, MID))   # штатив
    for i in range(5):
        cx = 145 + (i - 2) * 34
        b.append(cyl(cx, 98, 9, 116, 150, '#8dff6a', front='#4cc24a', glow=0.3))
        b.append(cyl(cx, 98, 6, 150, 156, WHITE))
    return b

def turnstile():  # турникет поста охраны (2-й кадр), 1×1: две тумбы и створки
    return [box(20, 60, 70, 210, 0, 110, MID, front='#4b5d56'), box(186, 60, 236, 210, 0, 110, MID, front='#4b5d56'),
            box(20, 60, 70, 210, 110, 114, LIGHT), box(186, 60, 236, 210, 110, 114, LIGHT),
            box(30, 80, 60, 104, 114, 118, LIME, glow=0.8, outline=False), box(196, 80, 226, 104, 114, 118, LIME, glow=0.8, outline=False),
            box(70, 130, 126, 136, 40, 100, '#e6f2ee', alpha=170), box(130, 130, 186, 136, 40, 100, '#e6f2ee', alpha=170)]

# ---------- ВАРИАНТЫ: та же модель с небольшими отличиями ----------
SLATE, SLATE_L = '#3d5049', '#566b62'          # вторая обивка: тёмно-серо-зелёная

def recolor(boxes, mapping):
    from iso import hexa, shade
    out = []
    for b in boxes:
        b = dict(b)
        for src, dst in mapping.items():
            if b['top'][:3] == hexa(src)[:3]:
                b['top'] = hexa(dst, b['top'][3]); b['front'] = shade(b['top'], 0.68)
        out.append(b)
    return out

def sofa_slate(): return recolor(sofa(), {OLIVE: SLATE, OLIVE_L: SLATE_L})
def sofa_seats():  # три подушки сиденья вместо одной
    b = [x for x in sofa() if not (x['z0'] == 55)]
    for i in range(3):
        x0 = 76 + i * 120
        b.append(box(x0, 104, x0 + 116, 230, 55, 72, OLIVE_L))
    return b
def sofa_pillow():  # с декоративной подушкой
    return sofa() + [box(88, 100, 150, 124, 72, 120, LIGHT, front='#aebdb6')]

def armchair_slate(): return recolor(armchair(), {OLIVE: SLATE, OLIVE_L: SLATE_L})
def armchair_pillow(): return armchair() + [box(70, 100, 130, 122, 70, 116, LIGHT, front='#aebdb6')]

def coffee_tablet():  # с планшетом и стопкой бумаг
    return coffee_table() + [box(60, 90, 120, 130, 52, 55, '#101615'), box(64, 94, 116, 126, 55, 56, '#9fd8c0', glow=0.3, outline=False),
                             box(140, 120, 196, 180, 52, 58, WHITE)]
def coffee_ampoules():  # с парой ампул
    return coffee_table() + [cyl(150, 120, 10, 52, 76, '#8dff6a', front='#4cc24a', glow=0.3), cyl(150, 120, 6, 76, 82, WHITE),
                             cyl(180, 140, 10, 52, 76, '#8dff6a', front='#4cc24a', glow=0.3), cyl(180, 140, 6, 76, 82, WHITE)]

def reception_one():  # один монитор
    return [b for b in reception() if not (b['x0'] >= 352 and b['z0'] >= 122)]
def reception_k():  # табличка K на фасаде
    return reception() + [box(220, 230, 292, 232, 54, 100, LIGHT, outline=False),
                          box(234, 232, 242, 233, 60, 94, DARK, outline=False),
                          box(244, 232, 278, 233, 78, 84, LIME, glow=0.5, outline=False)]

def lockers_open():  # один ящик выдвинут
    b = server_lockers()
    z = 14 + 2 * 42
    return b + [box(36, 150, 220, 200, z, z + 34, '#c9d3ce', front='#b9c5bf'), box(44, 160, 212, 196, z + 34, z + 35, PANEL2, outline=False)]
def lockers_alert():  # одна ячейка с янтарным индикатором
    b = server_lockers()
    for x in b:
        if x['x0'] == 196 and x['z0'] == 14 + 3 * 42 + 12:
            x['top'] = x['front'] = (255, 176, 59, 255)
    return b

def turnstile_open():  # створки убраны, индикаторы бирюзовые
    b = [x for x in turnstile() if x['z0'] != 40]
    for x in b:
        if x['z0'] == 114: x['top'] = (47, 227, 154, 255)
    return b
def turnstile_alert():  # доступ запрещён: красные индикаторы
    b = turnstile()
    for x in b:
        if x['z0'] == 114: x['top'] = (255, 70, 70, 255)
    return b

def lab_microscope():  # микроскоп вместо пробирок
    b = [x for x in lab_table() if not (x['z0'] >= 110 and x['x1'] <= 250)]
    return b + [box(110, 80, 190, 140, 110, 118, PANEL2), box(140, 84, 160, 104, 118, 176, LIGHT, front='#aebdb6'),
                box(130, 104, 170, 128, 150, 164, DARK), cyl(150, 124, 6, 118, 150, MID)]
def lab_sparse():  # штатив наполовину пуст
    b = lab_table(); out = []; skip = 0
    for x in b:
        if x.get('cyl') and x['x0'] > 145 + 0 * 34: skip += 1; continue
        out.append(x)
    return out

def crate_partial():  # недостаёт четырёх ампул
    b = hp_crate(); gone = {(0, 0), (3, 0), (2, 1), (1, 2)}; out = []
    for x in b:
        if x.get('cyl'):
            cx, cy = (x['x0'] + x['x1']) / 2, (x['y0'] + x['y1']) / 2
            if (round((cx - 128) / 44 + 1.5), round((cy - 132) / 52 + 1)) in gone: continue
        out.append(x)
    return out
def crate_closed():  # закрытая крышка с лаймовой полосой
    return [box(28, 40, 228, 224, 0, 72, LIGHT, front='#9fb1a8'), box(24, 36, 232, 228, 72, 86, '#dfe7e3'),
            box(28, 224, 228, 226, 20, 28, LIME, glow=0.8, outline=False), box(24, 124, 232, 140, 86, 87, LIME, glow=0.5, outline=False)]

OBJS = {'sofa': (sofa, 512, 256), 'armchair': (armchair, 256, 256), 'coffee-table': (coffee_table, 256, 256),
        'reception': (reception, 512, 256), 'lockers': (server_lockers, 256, 256),
        'turnstile': (turnstile, 256, 256), 'lab-table': (lab_table, 512, 256), 'hp-crate': (hp_crate, 256, 256)}
VARS = {'sofa-slate': (sofa_slate, 512, 256), 'sofa-seats': (sofa_seats, 512, 256), 'sofa-pillow': (sofa_pillow, 512, 256),
        'armchair-slate': (armchair_slate, 256, 256), 'armchair-pillow': (armchair_pillow, 256, 256),
        'coffee-table-tablet': (coffee_tablet, 256, 256), 'coffee-table-ampoules': (coffee_ampoules, 256, 256),
        'reception-one': (reception_one, 512, 256), 'reception-k': (reception_k, 512, 256),
        'lockers-open': (lockers_open, 256, 256), 'lockers-alert': (lockers_alert, 256, 256),
        'turnstile-open': (turnstile_open, 256, 256), 'turnstile-alert': (turnstile_alert, 256, 256),
        'lab-table-microscope': (lab_microscope, 512, 256), 'lab-table-sparse': (lab_sparse, 512, 256),
        'hp-crate-partial': (crate_partial, 256, 256), 'hp-crate-closed': (crate_closed, 256, 256)}
for n, (f, W, D) in {**OBJS, **VARS}.items():
    render4(f(), W, D, OUT, n)
print(','.join(sorted({**OBJS, **VARS})))
