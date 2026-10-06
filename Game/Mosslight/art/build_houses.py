"""32pxの地面に対して短縮した屋根と、背のある正面壁を描く。"""
from assemble import header, finish

for sheet, height, prefix in [('roofs',16,'roof'), ('roofs_full',24,'roof_full')]:
    lines = header((32, height), (0, 0))
    for i in range(27):
        tile, variation = i % 9, i // 9
        ex, ey = tile % 3, tile // 3
        name = f'{prefix}{tile}' + (f'_v{variation}' if variation else '')
        lines.extend((f'part {name} 32 {height}', f'rect 0 0 32 {height} T'))
        for y in range(0, height, 6):
            lines.extend((f'line 0 {y} 31 {y} S', f'line 0 {min(height-1,y+1)} 31 {min(height-1,y+1)} U'))
            for x in range(-5 if y % 12 else 0, 32, 11):
                if 0 <= x < 32:
                    lines.extend((f'line {x} {min(height-1,y+2)} {x} {min(height-1,y+5)} S', f'pixel {min(31,x+2)} {min(height-1,y+2)} V'))
        # 少数の瓦だけ退色・欠け・苔を加える。全瓦を同じ点模様にしない。
        tx = 7 + (tile * 5 + variation * 9) % 15
        ty = 2 + (tile * 3 + variation * 5) % (height-5)
        lines.extend((f'poly {tx} {ty} {tx+5} {ty} {tx+4} {ty+2} {tx+1} {ty+2} U',
                      f'line {tx+1} {ty+3} {tx+4} {ty+3} S'))
        if variation == 1:
            lines.extend((f'rect 18 {height-5} 5 2 H', f'line 18 {height-6} 21 {height-6} 3'))
        elif variation == 2:
            lines.extend((f'line 5 {height//2} 8 {height//2+1} S',
                          f'line 7 {height//2+2} 8 {height//2+3} S'))
        if ex in (0, 2):
            for y in range(height):
                inset = (height-1-y)//(height//8) if ey == 0 else y//(height//8) if ey == 2 else 0
                if inset:
                    x = 0 if ex == 0 else 32-inset
                    lines.append(f'rect {x} {y} {inset} 1 .')
                edge = inset if ex == 0 else 31-inset
                lines.append(f'pixel {edge} {y} r')
        if ey == 2:
            lines.extend((f'line 8 {height-3} 23 {height-3} U', f'line 8 {height-2} 23 {height-2} r', f'line 8 {height-1} 23 {height-1} 0'))
        lines.extend((f'frame {name} 140', 'tag roof', f'place sprite {name} 0 0'))
    finish(sheet, lines, (0, 0), 'tiles')

lines = header((32, 80), (16, 76))
for i in range(9):
    kind, variation = ('wall', 'window', 'door')[i % 3], i // 3
    name = f'facade_{kind}' + (f'_v{variation}' if variation else '')
    lines.extend((f'part {name} 32 80', 'rect 0 2 32 74 H', 'rect 2 4 28 68 L',
                  'rect 4 5 10 64 M', 'rect 17 5 11 64 K', 'rect 14 3 3 68 H',
                  'rect 0 1 32 3 r', 'rect 0 71 32 4 H', 'line 1 75 30 75 0',
                  'rect 0 4 3 68 I', 'rect 29 4 3 68 H', 'rect 2 26 28 3 H',
                  'line 4 8 12 25 H', 'line 18 8 27 25 H'))
    # 目立つ格子の形は保ちながら、漆喰の面と柱の材質を分ける。
    px = 5 + variation * 2
    lines.extend((f'poly {px} 30 {px+5} 31 {px+5} 36 {px+2} 38 {px} 36 K',
                  'poly 19 58 24 55 27 57 27 68 19 68 J',
                  'line 1 33 1 43 J', 'line 30 48 30 55 r',
                  'line 15 45 15 50 I', 'rect 3 68 10 3 K',
                  'line 5 72 10 72 I', 'line 23 72 27 72 I'))
    if kind == 'window':
        lines.extend(('rect 6 40 20 24 H', 'rect 8 42 16 20 9', 'rect 9 43 6 8 A',
                      'rect 17 43 6 8 B', 'rect 9 53 6 8 y', 'rect 17 53 6 8 A',
                      'rect 6 64 20 2 J', 'rect 4 41 2 23 I', 'rect 26 41 2 23 J'))
    if kind == 'door':
        lines.extend(('rect 6 33 20 42 r', 'rect 8 35 16 39 I', 'rect 9 36 5 37 J',
                      'rect 15 36 1 37 H', 'rect 21 36 1 37 H', 'rect 9 40 13 2 H',
                      'rect 9 66 13 2 H', 'rect 20 55 2 3 o', 'rect 5 74 22 3 N'))
    lines.extend((f'frame {name} 140', 'tag facade', f'place sprite {name} 0 0'))
finish('facades', lines, (16, 76), 'props')
