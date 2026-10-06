"""原画の地層・石壁・瓦をWorkbenchで隣接マスクに組み立てる。N/E/S/W=1/2/4/8。"""
from assemble import GAME, load, header, part, finish

source = load(GAME / 'art/modules.json')['parts']
lines = header((32, 32), (0, 0))


def tile(name, rows):
    part(lines, name, rows)
    lines.extend((f'frame {name} 160', 'tag architecture', f'place sprite {name} 0 0'))


top = source['caveplateau_base']['rows']
timber = source['timber_base']['rows']
for mask in range(16):
    rows = []
    wall = []
    for y in range(32):
        rockrow, timberrow = '', ''
        for x in range(32):
            # 全面の連続した岩盤と、空いている辺の厚い縁。通路側へはみ出さない。
            edge = ((not mask & 1 and y < 3) or (not mask & 2 and x > 28)
                    or (not mask & 4 and y > 27) or (not mask & 8 and x < 3))
            rockrow += ('N' if y < 2 else '0') if edge else top[y][x]
            horizontal = y >= 12 and ((mask & 8 and x <= 20) or (mask & 2 and x >= 12))
            vertical = 12 <= x <= 20 and ((mask & 1 and y <= 20) or (mask & 4 and y >= 12) or not mask & 5 and y >= 12)
            p = timber[y][x] if horizontal else '.'
            if horizontal and y in (12, 13, 14):
                p = ['K','H','F'][y-12]
            if horizontal and y >= 30:
                p = 'F'
            if vertical:
                p = 'J' if x == 13 else 'G' if x in (12,20) else 'H'
            timberrow += p
        rows.append(rockrow)
        wall.append(timberrow)
    tile(f'cavewall_top{mask}', rows)
    tile(f'timber_wall{mask}', wall)

for prefix, base in [('cavewall_face', 'caveface_base'), ('copperwall_face', 'copperface_base'),
                     ('ironwall_face', 'ironface_base'), ('ruinwall_face', 'ruinface_base')]:
    original = source[base]['rows']
    for variant in range(4):
        # 反転と周期的な位相で鉱脈の位置を変え、地質は共通にする。
        rows = [row[::-1] if variant & 1 else row for row in original]
        if variant & 2:
            rows = [row[8:] + row[:8] for row in rows]
        tile(f'{prefix}{variant}', rows)

for index in range(9):
    edge_x, edge_y = index % 3, index // 3
    rows = []
    texture = source[f'rooftile{(edge_x + edge_y) & 3}']['rows']
    for y in range(32):
        row = ''
        for x in range(32):
            p = texture[y][x]
            if edge_x == 0 and x < 2 or edge_x == 2 and x >= 30:
                p = 'H' if x in (0, 31) else 'K'
            if edge_y == 0 and y < 3:
                p = 'L' if y == 0 else 'J' if y == 1 else 'H'
            if edge_y == 2 and y >= 28:
                p = ['J', 'H', 'F', '0'][y - 28]
            row += p
        rows.append(row)
    tile(f'roof{index}', rows)

tile('floor_wood', source['floor_wood']['rows'])
tile('floor', source['floor_wood']['rows'])
for index in range(4):
    rows = source['floor_wood']['rows']
    tile(f'timber_floor{index}', [row[::-1] if index & 1 else row for row in (rows[::-1] if index & 2 else rows)])
for side in ['left', 'right']:
    tile(f'cliff_{side}', [
        ''.join(('H' if x in ([0, 1] if side == 'left' else [30, 31]) else '.') for x in range(32))
        for y in range(32)
    ])
water = source['water_new']['rows']
palette = load(GAME / 'art/props.json')['palette']
def water_symbol(symbol, deep=False):
    color = palette[symbol].lstrip('#')
    rgb = [int(color[i:i+2], 16) for i in (0, 2, 4)]
    light = .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2]
    return ('y' if light < 115 else 'A') if deep else ('A' if light < 115 else 'B')
for index in range(4):
    shifted = [row[index:] + row[:index] for row in water]
    for material in ('water', 'deepwater'):
        tile(f'{material}{index}', [''.join(water_symbol(p, material == 'deepwater') for p in row) for row in shifted])
finish('architecture', lines, (0, 0), 'tiles')
