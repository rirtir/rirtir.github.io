"""顔と服を少数の色面で読む、名前付き部品の32px探索者。"""
from assemble import header, part, finish

lines = header((32, 48), (16, 40))
def sprite(name, rows, width=16):
    assert all(len(row) <= width for row in rows), name
    part(lines, name, [row.center(width, '.') for row in rows])

sprite('face_down', [
    '...rrrrrrrr...', '..rssssssssr..', '.rssuuusssssr.', '.rssuuuussusr.',
    '.rssssrsssssr.', '.rsssrWWrsssr.', '.rrsrWWWWrsrr.', '.rWEEWWWEEWr.',
    '.rWEEWWWEEWr.', '.rWE0WWW0EWr.', '..rWWWWWWWrr.', '..rWWWVWWWrr.',
    '...rWWWWWrr..', '....rrrrr....',
])
sprite('face_up', [
    '...rrrrrr...', '..rsssssssr..', '.rssuusssusr.', '.rsssssssssr.',
    '.rsssssssssr.', '.rsssssssssr.', '.rsssssssssr.', '.rsssssssssr.',
    '.rsssssssssr.', '.rsssssssssr.', '..rssssssrr..', '...rrrrrr...',
    '....AAAA....', '....0AA0....',
])
sprite('face_right', [
    '...rrrrrr...', '..rsssssssr..', '.rssuusssusr.', '.rsssssssssr.',
    '.rsssssssssr.', '.rsssssssssr.', '.rsssssWWWr..', '.rsssrWEEWrr.',
    '.rsssrWEEWrr.', '..rsrWW0EWWr.', '...rWWWWWWr..', '...rWWVWWWr..',
    '....rWVWWr...', '.....rrrr....',
])
sprite('coat_down', [
    '..0nnnnnn0..', '.0noooonnn0.', '.0nABBBBAAn0.', '0nnABBBBAAnn0',
    '0nnABBBBAAnn0', '.0nABBBBAAn0.', '.0nABABAAAn0.', '..0AAAAAAA0..',
    '..0HHJHHHH0..', '..0AAAAAAA0..', '...0AAAAA0...',
])
sprite('coat_up', [
    '..0AAAAAA0..', '.0nnnnnnnn0.', '0nnooooonnn0', '0nnnnnnnnnn0',
    '0nnnnnnnnnn0', '.0nnnnnnnn0.', '.0nnnnnnnn0.', '..0nnnnnn0..',
    '..0HHJHHH0..', '..0AAAAAA0..', '...0AAAA0...',
])
sprite('coat_right', [
    '...0nnnn0...', '..0noonnA0..', '..0nnnnAA0..', '..0nnnBAA0..',
    '..0nnnBAA0..', '..0nnnBAA0..', '..0nnnAAA0..', '...0nnAAA0..',
    '...0HHJHH0..', '...0AAAAA0..', '....0AAA0...',
])
sprite('arm', ['.00.', '0BB0', '0BB0', '0AA0', '0HH0', '0WW0', '.WW.', '.00.'], 4)
sprite('neck', ['0WW0', '0WW0', '0AA0'], 4)
sprite('hips', ['.0AAAAAA0.', '.0AAAAAA0.', '..0AAAA0..', '..0AA00AA0..', '..0AA00AA0..'], 12)
sprite('reach', ['..00....', '.0BB00..', '0BBHHW0.', '0AAHHWW0', '.000000.'], 8)
sprite('boot0', ['.AA...', '.AA...', '.0H...', '.0HJ..', '.0JJ0.', '.0000.'], 6)
sprite('boot1', ['..AA..', '..AA..', '.0H...', '.0HJ..', '0JJ0..', '0000..'], 6)
sprite('boot2', ['.AA...', '.AA...', '..0H..', '..0HJ.', '..0JJ0', '..0000'], 6)
sprite('tuck', ['....000000....', '..00nnnnnn00..', '.0nnooonnnnn0.',
    '0nnnnnnnnnnnn0', '0nnnnnnnnnnnn0', '0nnnnAAAAAnnn0', '0nnnAAHHAAAnn0',
    '.0nnAHJJHAnn0.', '..0nnHHHHnn0..', '...00000000...'], 16)

HANDS = {'down': [(6,-20),(8,-9),(-2,-13)], 'right': [(7,-22),(12,-13),(6,-16)], 'up': [(6,-25),(8,-27),(5,-20)]}
heads = {'down': ['...rrrrrrrr...','..rssssssssr..','.rssuuusssssr.','.rssuuuussusr.','.rssssrsssssr.','.rsssrWWrsssr.','.rrsrWWWWrsrr.','.rWEEWWWEEWr.','.rWEEWWWEEWr.','.rWE0WWW0EWr.','..rWWWWWWWrr.','..rWWWVWWWrr.','...rWWWWWrr..','....rrrrr....'],
         'up': ['...rrrrrr...','..rsssssssr..','.rssuusssusr.','.rsssssssssr.','.rsssssssssr.','.rsssssssssr.','.rsssssssssr.','.rsssssssssr.','.rsssssssssr.','.rsssssssssr.','..rssssssrr..','...rrrrrr...','....AAAA....','....0AA0....'],
         'right': ['...rrrrrr...','..rsssssssr..','.rssuusssusr.','.rsssssssssr.','.rsssssssssr.','.rsssssssssr.','.rsssssWWWr..','.rsssrWEEWrr.','.rsssrWEEWrr.','..rsrWW0EWWr.','...rWWWWWWr..','...rWWVWWWr..','....rWVWWr...','.....rrrr....']}
for direction, positions in HANDS.items():
    sprite(f'tuck_face_{direction}', [heads[direction][i] for i in (0,2,4,6,8,10,12,13)])
    for i, (gx,gy) in enumerate(positions):
        hx, hy = 16+gx, 40+gy
        sx, sy = 23 + [0,2,-1][i], 25
        lines.append(f'part strike_{direction}{i} 32 48')
        for dx in range(-2,3):
            for dy in range(-2,3):
                lines.append(f'line {sx+dx} {sy+dy} {hx+dx} {hy-2+dy} 0')
        for dx in (-1,0,1):
            for dy in (-1,0,1):
                lines.append(f'line {sx+dx} {sy+dy} {hx+dx} {hy-2+dy} A')
        lines.extend((f'line {sx-1} {sy-1} {hx-1} {hy-3} B', f'rect {hx-1} {hy-1} 3 3 W'))

for direction in ('down', 'up', 'left', 'right'):
    base = 'right' if direction == 'left' else direction
    for action, count in [('idle', 2), ('walk', 4), ('attack', 3), ('roll', 3)]:
        for i in range(count):
            name = f'hero_{direction}_{action}{i}'
            lines.extend((f'frame {name} {180 if action == "walk" else 100}', f'tag {action}'))
            bob = -1 if action == 'walk' and i % 2 else 0
            crouch = (4 if i == 0 else 2) if action == 'roll' else 0
            lean = [0, 2, -1][i] if action == 'attack' else [0,1,0,-1][i] if action == 'walk' else 0
            swing = [-1,1,1,-1][i] if action == 'walk' else 0
            if action == 'roll' and i == 1:
                lines.extend(('place ball tuck 8 28', f'place head tuck_face_{base} 8 25'))
                if direction == 'left':
                    lines.append('mirror head x')
            else:
                # 接地位置を固定し、足先の向きと前後の重なりを変える。
                left = (i % 3) if action == 'walk' else 0
                right = ((i+2) % 3) if action == 'walk' else 0
                lines.extend((f'place far_leg boot{right} 17 {33 + (1 if action == "walk" and i == 1 else 0)}',
                              f'place near_leg boot{left} 11 {33 - (1 if action == "walk" and i == 3 else 0)}',
                              f'place hips hips {10+lean} {30+crouch}',
                              f'place far_arm arm {8+lean} {24+bob+crouch-swing}',
                              f'place neck neck {14+lean} {19+bob+crouch}',
                              f'place coat coat_{base} {8+lean} {21+bob+crouch}',
                              f'place head face_{base} {8+lean} {6+bob+crouch}'))
                if action == 'attack':
                    lines.append(f'place near_arm strike_{base}{i} 0 0')
                else:
                    lines.append(f'place near_arm arm {21+lean} {24+bob+crouch+swing}')
            if direction == 'left':
                # 位置も32px幅内で反転し、右向きと同じ接地・握りを維持する。
                if not (action == 'roll' and i == 1):
                    lines.extend((f'pos hips {10-lean} {30+crouch}', f'pos neck {14-lean} {19+bob+crouch}'))
                for layer, width, x in [('far_leg',6,17),('near_leg',6,11),('far_arm',4,8+lean),('coat',16,8+lean),('head',16,8+lean),('near_arm',8 if action=='attack' else 4,(19+lean if i!=2 else 15) if action=='attack' else 21+lean)]:
                    if action == 'roll' and i == 1:
                        continue
                    if layer == 'near_arm' and action == 'attack':
                        lines.append('mirror near_arm x')
                        continue
                    ly = 33+(1 if action=='walk' and i==1 else 0) if layer=='far_leg' else 33-(1 if action=='walk' and i==3 else 0) if layer=='near_leg' else 21+bob+crouch if layer=='coat' else 6+bob+crouch if layer=='head' else 24+bob+crouch+(swing if layer=='near_arm' else -swing)
                    lines.extend((f'pos {layer} {32-x-width} {ly}', f'mirror {layer} x'))
finish('explorer', lines, (16, 40), 'actors')
