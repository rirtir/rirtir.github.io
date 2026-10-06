"""地面の低い起伏を、形の異なる小さなクラスタと近い明度で描く。"""
from assemble import header, finish, GAME
import json

lines = header((32, 32), (0, 0))
palette = json.loads((GAME / 'art/props.json').read_text(encoding='utf-8'))['palette']

def blend(a, b, ratio):
    aa, bb = palette[a][1:], palette[b][1:]
    return '#' + ''.join(f'{round(int(aa[i:i+2],16)*(1-ratio)+int(bb[i:i+2],16)*ratio):02x}' for i in (0,2,4))

materials = [('moss','2','1','3'), ('cave','9','x','N'), ('grass','4','3','5'),
             ('darkgrass','3','2','4'), ('dirt','I','H','J'), ('path','J','I','K'), ('ruin','N','9','O')]
for i, (material, base, shadow, mid) in enumerate(materials):
    dark, light = chr(ord('a')+i*2), chr(ord('b')+i*2)
    lines.extend((f'palette {dark} {blend(base,shadow,.40)}', f'palette {light} {blend(base,mid,.35)}'))
    for variant in range(4):
        name = f'{material}{variant}'
        lines.extend((f'part {name} 32 32', f'rect 0 0 32 32 {base}'))
        if variant == 1:
            # 互いに離れた低い二つの石。
            lines.extend((f'poly 5 9 8 7 11 8 12 10 9 11 5 10 {light}',
                          f'line 5 11 9 12 12 11 {dark}',
                          f'poly 18 20 20 18 23 19 24 21 20 22 {light}',
                          f'line 19 23 23 23 {dark}'))
        elif variant == 2:
            # 切れた草筋 / 地層。閉じた舟形の輪郭にしない。
            lines.extend((f'line 5 17 7 14 8 10 {light}', f'line 8 17 11 15 13 15 {light}',
                          f'line 6 18 10 18 {dark}', f'line 21 24 23 22 27 21 {dark}'))
        elif variant == 3:
            # 薄い土溜まり。上下の明瞭な縁取りを省く。
            lines.extend((f'poly 13 7 20 6 25 8 26 11 23 13 15 12 12 10 {light}',
                          f'line 5 25 9 24 12 25 {dark}'))
        lines.extend((f'frame {name} 140', 'tag ground', f'place sprite {name} 0 0'))
finish('quiet_ground', lines, (0, 0), 'tiles')
