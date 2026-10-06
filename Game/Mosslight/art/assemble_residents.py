"""役割と向きを統一し、原画の向きの混入と足運びをWorkbenchで補正する。"""
from assemble import GAME, load, header, part, finish

lines = header((32,48), (16,40))
for role in ['cook', 'farmer', 'builder']:
    source = load(GAME/'art'/f'{role}.json')
    for direction in ['down','up','right','left']:
        for index in range(4):
            base_direction = 'right' if direction == 'left' else direction
            base_index = index
            mirror = direction == 'left'
            if role == 'builder':
                if direction == 'down' and index == 3:
                    base_index = 1  # 原画の右上セルは背面が混ざったため使用しない。
                if direction in ('right','left'):
                    base_direction = 'left' if index < 2 else 'right'
                    base_index = index % 2
                    mirror = (base_direction != direction)
            base = f'npc_{role}_{base_direction}_walk{base_index}'
            frame = next(f for f in source['frames'] if f['name']==base)
            pixels = source['parts'][frame['layers'][0]['part']]['rows']
            # 前後方向の2・3コマ目は、裾より下の足を逆にして交互の踏み出しを作る。
            if direction in ('down','up') and index >= 2:
                pixels = pixels[:28] + [row[::-1] for row in pixels[28:]]
            name = f'npc_{role}_{direction}_walk{index}'
            part(lines, name, pixels)
            lines.extend((f'frame {name} 160','tag resident',f'place sprite {name} 0 0'))
            if mirror:
                lines.append('mirror sprite x')
finish('residents',lines,(16,40),'actors')
